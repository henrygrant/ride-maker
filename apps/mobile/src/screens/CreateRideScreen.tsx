import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from "@maplibre/maplibre-react-native";
import type { RouteDocument, RoutePoint } from "@ride-maker/domain";
import type { GeocodingResult } from "@ride-maker/geocoding";
import { createDefaultGeocodingProvider, createDefaultRoutingProvider } from "../providers";
import {
  CreateRideController,
  type ControllerDraftSnapshot,
  type ControllerState,
  type DraftPointState,
} from "../controllers/create-ride-controller";

export type CreateRideScreenProps = {
  initialDraft?: ControllerDraftSnapshot | null;
  onSave: (document: RouteDocument) => Promise<void>;
  onBack: (discard: boolean) => void;
  onDraftChange?: (draft: ControllerDraftSnapshot) => void;
  isTestMode?: boolean;
};

const routingProvider = createDefaultRoutingProvider();
const geocodingProvider = createDefaultGeocodingProvider();

export function CreateRideScreen({
  initialDraft,
  onSave,
  onBack,
  onDraftChange,
  isTestMode,
}: CreateRideScreenProps) {
  const controllerRef = useRef<CreateRideController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CreateRideController(
      routingProvider,
      geocodingProvider,
      initialDraft,
    );
  }
  const controller = controllerRef.current;

  const [state, setState] = useState<ControllerState>(() => controller.getState());
  const [isInPreviewMode, setIsInPreviewMode] = useState<boolean>(() => Boolean(state.previewRoute));
  const [showExitModal, setShowExitModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const cameraRef = useRef<CameraRef>(null);
  const searchDebounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const cancelDebounceTimer = (pointId: string) => {
    const t = searchDebounceTimers.current[pointId];
    if (t) {
      clearTimeout(t);
      delete searchDebounceTimers.current[pointId];
    }
  };

  const cancelAllDebounceTimers = () => {
    for (const [id, t] of Object.entries(searchDebounceTimers.current)) {
      clearTimeout(t);
    }
    searchDebounceTimers.current = {};
  };

  // Subscribe to controller updates
  useEffect(() => {
    const unsubscribe = controller.subscribe((nextState) => {
      setState({ ...nextState,
        startPoint: { ...nextState.startPoint },
        finishPoint: { ...nextState.finishPoint },
        viaStops: nextState.viaStops.map(point => ({ ...point })),
      });
      if (!nextState.previewRoute) {
        setIsInPreviewMode(false);
      }
      if (onDraftChange) {
        onDraftChange(controller.exportDraft());
      }
    });

    return () => {
      unsubscribe();
      controller.dispose();
      cancelAllDebounceTimers();
    };
  }, [controller, onDraftChange]);

  // Hardware Back Press Handling
  useEffect(() => {
    const onHardwareBack = () => {
      if (state.placementTarget) {
        controller.cancelMapPlacement();
        return true;
      }
      if (isInPreviewMode) {
        setIsInPreviewMode(false);
        return true;
      }
      if (showExitModal) {
        setShowExitModal(false);
        return true;
      }
      if (controller.isDirty()) {
        setShowExitModal(true);
        return true;
      }
      onBack(false);
      return true;
    };

    const sub = BackHandler.addEventListener("hardwareBackPress", onHardwareBack);
    return () => sub.remove();
  }, [controller, state.placementTarget, isInPreviewMode, showExitModal, onBack]);

  const handleSearchChange = (pointId: string, text: string) => {
    controller.setSearchQuery(pointId, text);
    cancelDebounceTimer(pointId);

    if (text.trim().length === 0) return;

    const timer = setTimeout(() => {
      void controller.searchLocation(pointId, text);
    }, 300);
    searchDebounceTimers.current[pointId] = timer;
  };

  const handleSelectSearchResult = (pointId: string, item: GeocodingResult) => {
    cancelDebounceTimer(pointId);
    controller.selectSearchResult(pointId, item);
    cameraRef.current?.easeTo({ center: [item.longitude, item.latitude], zoom: 14, duration: 350 });
  };

  const handleStartMapPlacement = (pointId: string) => {
    cancelDebounceTimer(pointId);
    controller.startMapPlacement(pointId);
    const candidate = controller.getState().candidateCoordinate;
    if (candidate) cameraRef.current?.easeTo({ center: [candidate.longitude, candidate.latitude], zoom: 14, duration: 350 });
  };

  const handleConfirmMapPlacement = () => {
    if (state.placementTarget) {
      cancelDebounceTimer(state.placementTarget.pointId);
    }
    void controller.confirmMapPlacement();
  };

  const handleUseMyLocation = async (pointId: string) => {
    cancelDebounceTimer(pointId);
    await controller.useMyLocation(pointId, async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        return null;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
    });
    const current = controller.getState();
    const point = pointId === "start" ? current.startPoint : pointId === "finish"
      ? current.finishPoint : current.viaStops.find(stop => stop.id === pointId);
    if (point?.latitude != null && point.longitude != null) {
      cameraRef.current?.easeTo({ center: [point.longitude, point.latitude], zoom: 14, duration: 350 });
    }
  };

  const handlePreviewRoute = async () => {
    setSaveError(null);
    const routed = await controller.previewRoute();
    if (routed && routed.segments.length > 0) {
      setIsInPreviewMode(true);
    }
  };

  // Fit after the preview map mounts, including a preview restored from a draft.
  useEffect(() => {
    if (isInPreviewMode && state.previewRoute) {
      const flatPoints = state.previewRoute.segments.flat();
      if (flatPoints.length > 1) {
        let minLng = Infinity,
          minLat = Infinity,
          maxLng = -Infinity,
          maxLat = -Infinity;
        for (const p of flatPoints) {
          if (p.longitude < minLng) minLng = p.longitude;
          if (p.longitude > maxLng) maxLng = p.longitude;
          if (p.latitude < minLat) minLat = p.latitude;
          if (p.latitude > maxLat) maxLat = p.latitude;
        }
        cameraRef.current?.fitBounds([minLng, minLat, maxLng, maxLat], {
          padding: { top: 50, right: 50, bottom: 50, left: 50 },
          duration: 400,
        });
      }
    }
  }, [isInPreviewMode, state.previewRoute]);

  const handleSaveRide = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const doc = controller.buildRouteDocument();
      await onSave(doc);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save created ride.");
    } finally {
      setSaving(false);
    }
  };

  const handleBackPress = () => {
    if (isInPreviewMode) {
      setIsInPreviewMode(false);
      return;
    }
    if (controller.isDirty()) {
      setShowExitModal(true);
    } else {
      onBack(false);
    }
  };

  // MultiLineString geometry: renders distinct segments without flattening or segment bridging
  const previewMultiLineString = useMemo(() => {
    if (!state.previewRoute || state.previewRoute.segments.length === 0) return null;
    const legs = state.previewRoute.segments
      .filter((seg: RoutePoint[]) => seg.length >= 2)
      .map((seg: RoutePoint[]) => seg.map((p: RoutePoint) => [p.longitude, p.latitude]));
    return legs.length > 0 ? legs : null;
  }, [state.previewRoute]);

  // Confirmed via stop features

  const displayedError = saveError ?? state.error;

  const renderPointInput = (
    point: DraftPointState,
    label: string,
    testIdPrefix: string,
    options?: { onMoveUp?: () => void; onMoveDown?: () => void; onRemove?: () => void },
  ) => {
    return (
      <View key={point.id} style={styles.pointCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.pointHeaderActions}>
            {options?.onMoveUp && (
              <Pressable
                testID={`button-stop-up-${point.id}`}
                accessibilityLabel="Move stop up"
                onPress={options.onMoveUp}
                style={styles.touchTarget}
              >
                <Text style={styles.controlIcon}>▲</Text>
              </Pressable>
            )}
            {options?.onMoveDown && (
              <Pressable
                testID={`button-stop-down-${point.id}`}
                accessibilityLabel="Move stop down"
                onPress={options.onMoveDown}
                style={styles.touchTarget}
              >
                <Text style={styles.controlIcon}>▼</Text>
              </Pressable>
            )}
            {options?.onRemove && (
              <Pressable
                testID={`button-stop-remove-${point.id}`}
                accessibilityLabel="Remove stop"
                onPress={options.onRemove}
                style={styles.touchTarget}
              >
                <Text style={styles.removeIcon}>✕</Text>
              </Pressable>
            )}
            <Pressable
              testID={`button-map-pick-${point.id}`}
              accessibilityLabel={`Choose ${label} on map`}
              onPress={() => handleStartMapPlacement(point.id)}
              style={styles.pillButton}
            >
              <Text style={styles.pillButtonText}>📍 Map</Text>
            </Pressable>
            <Pressable
              testID={`button-use-my-location-${point.id}`}
              accessibilityLabel={`Use my location for ${label}`}
              onPress={() => void handleUseMyLocation(point.id)}
              style={styles.pillButton}
            >
              <Text style={styles.pillButtonText}>🎯 GPS</Text>
            </Pressable>
          </View>
        </View>

        <TextInput
          testID={`input-${testIdPrefix}`}
          style={styles.input}
          value={point.searchQuery}
          onChangeText={(text) => handleSearchChange(point.id, text)}
          onSubmitEditing={() => {
            cancelDebounceTimer(point.id);
            void controller.searchLocation(point.id, point.searchQuery);
          }}
          placeholder={`Search or tap Map / GPS`}
          returnKeyType="search"
        />

        {point.isSearching && (
          <View style={styles.searchingRow}>
            <ActivityIndicator size="small" color="#1479c9" />
            <Text style={styles.searchingText}>Searching locations…</Text>
          </View>
        )}

        {point.searchError && (
          <Text testID={`text-search-error-${point.id}`} style={styles.pointSearchError}>
            {point.searchError}
          </Text>
        )}

        {point.searchResults.length > 0 && (
          <View testID={`list-search-results-${point.id}`} style={styles.searchResultsList}>
            {point.searchResults.map((item) => (
              <Pressable
                key={item.id}
                testID={`search-item-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={item.name}
                onPress={() => handleSelectSearchResult(point.id, item)}
                style={styles.searchResultItem}
              >
                <Text style={styles.searchResultName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.label ? (
                  <Text style={styles.searchResultLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderPointMarker = (id: string, longitude: number, latitude: number, label: string, color: string) => (
    <Marker key={id} id={`point-${id}`} lngLat={[longitude, latitude]} pointerEvents="none">
      <View testID={`map-marker-${id}`} collapsable={false} accessibilityLabel={`Map point ${label}`}
        style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: "white",
          backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: color === "#eab308" ? "#1f2937" : "white", fontSize: 14, fontWeight: "700" }}>{label}</Text>
      </View>
    </Marker>
  );

  const renderMapView = (mapHeightStyle: any) => (
    <View testID="view-create-map" style={[styles.mapContainer, mapHeightStyle]}>
      {state.placementTarget && (
        <View style={styles.placementBanner}>
          <Text style={styles.placementTitle}>
            Tap map to place {state.placementTarget.label}
          </Text>
          <View style={styles.placementActions}>
            <Pressable
              testID="button-cancel-map-placement"
              accessibilityRole="button"
              accessibilityLabel="Cancel placement"
              onPress={() => controller.cancelMapPlacement()}
              style={[styles.placementButton, styles.placementCancelBtn]}
            >
              <Text style={styles.placementCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="button-confirm-map-placement"
              accessibilityRole="button"
              accessibilityLabel="Confirm location"
              onPress={handleConfirmMapPlacement}
              style={[styles.placementButton, styles.placementConfirmBtn]}
            >
              <Text style={styles.placementConfirmText}>Set location</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Map
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        style={styles.map}
        onPress={(event) => {
          if (state.placementTarget) {
            const native = event?.nativeEvent as {
              lngLat?: [number, number];
              geometry?: { coordinates?: [number, number] };
            };
            const coords =
              native?.lngLat ??
              native?.geometry?.coordinates ??
              (event as unknown as { geometry?: { coordinates?: [number, number] } })?.geometry?.coordinates;
            if (Array.isArray(coords) && coords.length >= 2) {
              controller.setCandidateCoordinate({
                longitude: coords[0]!,
                latitude: coords[1]!,
              });
            }
          }
        }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: [-73.968, 40.785], zoom: 12 }}
        />

        {/* Routed Polyline: MultiLineString rendering without segment bridging */}
        {previewMultiLineString && (
          <GeoJSONSource
            id="preview-line-src"
            data={{
              type: "Feature",
              geometry: {
                type: "MultiLineString",
                coordinates: previewMultiLineString,
              },
              properties: {},
            }}
          >
            <Layer
              id="preview-casing"
              type="line"
              paint={{ "line-color": "#ffffff", "line-width": 6 }}
            />
            <Layer
              id="preview-line"
              type="line"
              paint={{ "line-color": "#1479c9", "line-width": 4 }}
            />
          </GeoJSONSource>
        )}

        {state.startPoint.latitude !== null && state.startPoint.longitude !== null &&
          renderPointMarker("start", state.startPoint.longitude, state.startPoint.latitude, "S", "#2e7d32")}
        {!state.isLoop && state.finishPoint.latitude !== null && state.finishPoint.longitude !== null &&
          renderPointMarker("finish", state.finishPoint.longitude, state.finishPoint.latitude, "F", "#c62828")}
        {state.viaStops.map((point, index) => point.latitude !== null && point.longitude !== null
          ? renderPointMarker(`via-${index + 1}`, point.longitude, point.latitude, String(index + 1), "#1976d2") : null)}
        {state.candidateCoordinate && renderPointMarker("candidate", state.candidateCoordinate.longitude,
          state.candidateCoordinate.latitude, "?", "#eab308")}

      </Map>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          testID="button-create-back"
          accessibilityRole="button"
          accessibilityLabel="Back to rides"
          onPress={handleBackPress}
          style={styles.touchTarget}
        >
          <Text style={styles.backLink}>‹ Rides</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {isInPreviewMode ? "Route Preview" : "Create Ride"}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Main View: Preview Mode vs Edit Mode */}
      {isInPreviewMode && state.previewRoute ? (
        /* Preview Mode: Prominent Map + Summary / Action Card */
        <View style={styles.previewContainer}>
          {renderMapView(styles.previewMap)}

          <View style={styles.previewCard}>
            {/* Ride Name in Preview */}
            <View style={styles.previewNameSection}>
              <Text style={styles.label}>Ride Name</Text>
              <TextInput
                testID="input-created-ride-name"
                style={styles.input}
                value={state.name}
                onChangeText={(text) => controller.setName(text)}
                placeholder="e.g. Morning River Loop"
              />
            </View>

            {/* Distance prioritized over time per Sol review */}
            <View style={styles.statsCard}>
              <View style={styles.statBoxPrimary}>
                <Text style={styles.statLabelPrimary}>Distance</Text>
                <Text testID="text-preview-distance" style={styles.statValuePrimary}>
                  {(state.previewRoute.distanceMeters / 1000).toFixed(1)} km
                </Text>
              </View>
              <View style={styles.statBoxSecondary}>
                <Text style={styles.statLabelSecondary}>Turns</Text>
                <Text testID="text-preview-turns" style={styles.statValueSecondary}>
                  {state.previewRoute.maneuvers.length} directions
                </Text>
              </View>
            </View>

            {displayedError && (
              <View style={styles.errorBox}>
                <Text testID="text-create-error" style={styles.errorText}>
                  {displayedError}
                </Text>
              </View>
            )}

            {/* Actions: Primary Save ride, Secondary Edit points */}
            <View style={styles.previewButtonsRow}>
              <Pressable
                testID="button-edit-points"
                accessibilityRole="button"
                accessibilityLabel="Edit points"
                onPress={() => setIsInPreviewMode(false)}
                style={[styles.button, styles.editPointsButton]}
              >
                <Text style={styles.editPointsButtonText}>Edit points</Text>
              </Pressable>

              <Pressable
                testID="button-save-created-ride"
                accessibilityRole="button"
                accessibilityLabel="Save ride"
                onPress={() => void handleSaveRide()}
                disabled={!controller.canSave() || saving}
                style={[
                  styles.button,
                  styles.saveButton,
                  (!controller.canSave() || saving) && styles.disabledButton,
                ]}
              >
                <Text style={styles.saveButtonText}>Save Ride</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        /* Edit Mode: Visible Map on Top + Compact Point Panel Below */
        <View style={styles.editContainer}>
          {renderMapView(styles.editMap)}

          <ScrollView style={styles.pointPanel} keyboardShouldPersistTaps="handled">
            {displayedError && (
              <View style={styles.errorBox}>
                <Text testID="text-create-error" style={styles.errorText}>
                  {displayedError}
                </Text>
              </View>
            )}

            {/* Ride Name Input */}
            <View style={styles.section}>
              <Text style={styles.label}>Ride Name</Text>
              <TextInput
                testID="input-created-ride-name"
                style={styles.input}
                value={state.name}
                onChangeText={(text) => controller.setName(text)}
                placeholder="e.g. Morning River Loop"
              />
            </View>

            {/* Start Point */}
            {renderPointInput(state.startPoint, "Start Location", "start-location")}

            {/* Via Stops */}
            {state.viaStops.map((stop: DraftPointState, idx: number) =>
              renderPointInput(
                stop,
                `Via Stop ${idx + 1}`,
                `stop-${idx}`,
                {
                  ...(idx > 0 ? { onMoveUp: () => controller.moveViaStop(stop.id, "up") } : {}),
                  ...(idx < state.viaStops.length - 1
                    ? { onMoveDown: () => controller.moveViaStop(stop.id, "down") }
                    : {}),
                  onRemove: () => {
                    cancelDebounceTimer(stop.id);
                    controller.removeViaStop(stop.id);
                  },
                },
              ),
            )}

            {/* Add Stop & Loop Controls */}
            <View style={styles.actionRow}>
              {state.viaStops.length < 8 ? (
                <Pressable
                  testID="button-add-stop"
                  accessibilityRole="button"
                  accessibilityLabel="Add via stop"
                  onPress={() => controller.addViaStop()}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>+ Add via stop</Text>
                </Pressable>
              ) : (
                <Text style={styles.mutedText}>Max 8 stops</Text>
              )}

              <Pressable
                testID="button-make-loop"
                accessibilityRole="button"
                accessibilityLabel="Toggle loop ride"
                onPress={() => controller.toggleLoop()}
                style={[styles.secondaryButton, state.isLoop && styles.activeLoopButton]}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    state.isLoop && styles.activeLoopButtonText,
                  ]}
                >
                  {state.isLoop ? "✓ Loop Ride" : "↻ Make loop"}
                </Text>
              </Pressable>
            </View>

            {/* Finish Point (hidden if loop) */}
            {!state.isLoop &&
              renderPointInput(state.finishPoint, "Finish Location", "finish-location")}

            {/* Preview Action */}
            <View style={styles.previewActions}>
              <Pressable
                testID="button-preview-route"
                accessibilityRole="button"
                accessibilityLabel="Preview route"
                onPress={() => void handlePreviewRoute()}
                style={[styles.button, styles.previewButton]}
              >
                <Text style={styles.buttonText}>Preview Route</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      )}

      {/* Loading Overlay */}
      {(state.isRouting || saving) && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#ec4b35" size="large" />
        </View>
      )}

      {/* Draft Keep / Discard Confirmation Modal */}
      <Modal
        visible={showExitModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExitModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Keep your draft?</Text>
            <Text style={styles.modalMessage}>
              You have unsaved changes in this ride draft. You can keep it to continue later,
              or discard it.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                testID="button-draft-discard"
                accessibilityRole="button"
                accessibilityLabel="Discard draft"
                onPress={() => {
                  setShowExitModal(false);
                  onBack(true);
                }}
                style={[styles.modalBtn, styles.modalBtnDanger]}
              >
                <Text style={styles.modalBtnDangerText}>Discard</Text>
              </Pressable>
              <Pressable
                testID="button-draft-keep"
                accessibilityRole="button"
                accessibilityLabel="Keep draft"
                onPress={() => {
                  setShowExitModal(false);
                  onBack(false);
                }}
                style={[styles.modalBtn, styles.modalBtnPrimary]}
              >
                <Text style={styles.modalBtnPrimaryText}>Keep draft</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f6f1",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2937",
  },
  backLink: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ec4b35",
  },
  touchTarget: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
  },
  editContainer: {
    flex: 1,
  },
  editMap: {
    height: 250,
    width: "100%",
  },
  pointPanel: {
    flex: 1,
    padding: 16,
  },
  previewContainer: {
    flex: 1,
  },
  previewMap: {
    flex: 1,
    width: "100%",
  },
  previewCard: {
    backgroundColor: "#ffffff",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  previewNameSection: {
    marginBottom: 12,
  },
  previewButtonsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  mapContainer: {
    backgroundColor: "#e5e7eb",
    position: "relative",
  },
  map: {
    flex: 1,
  },
  placementBanner: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: "rgba(31, 41, 55, 0.95)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  placementTitle: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  placementActions: {
    flexDirection: "row",
    gap: 8,
  },
  placementButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  placementCancelBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  placementCancelText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  placementConfirmBtn: {
    backgroundColor: "#ec4b35",
  },
  placementConfirmText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  section: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4b5563",
    marginBottom: 4,
  },
  input: {
    minHeight: 44,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
  },
  pointCard: {
    backgroundColor: "#ffffff",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 10,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  pointHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  controlIcon: {
    fontSize: 14,
    color: "#6b7280",
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  removeIcon: {
    fontSize: 14,
    color: "#dc2626",
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  pillButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  pillButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
  },
  searchingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  searchingText: {
    fontSize: 12,
    color: "#6b7280",
  },
  pointSearchError: {
    fontSize: 12,
    color: "#dc2626",
    marginTop: 4,
  },
  searchResultsList: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  searchResultItem: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1f2937",
  },
  searchResultLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  secondaryButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    flex: 1,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  activeLoopButton: {
    borderColor: "#2e7d32",
    backgroundColor: "#f0fdf4",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
  },
  activeLoopButtonText: {
    color: "#2e7d32",
    fontWeight: "700",
  },
  mutedText: {
    fontSize: 13,
    color: "#9ca3af",
    alignSelf: "center",
  },
  previewActions: {
    marginTop: 8,
    marginBottom: 32,
  },
  button: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  previewButton: {
    backgroundColor: "#1479c9",
  },
  editPointsButton: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  editPointsButtonText: {
    color: "#374151",
    fontSize: 15,
    fontWeight: "600",
  },
  saveButton: {
    flex: 1,
    backgroundColor: "#ec4b35",
  },
  saveButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  disabledButton: {
    backgroundColor: "#9ca3af",
    opacity: 0.6,
  },
  statsCard: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  statBoxPrimary: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: "#e5e7eb",
    paddingRight: 8,
  },
  statBoxSecondary: {
    flex: 1,
    paddingLeft: 12,
  },
  statLabelPrimary: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
  },
  statValuePrimary: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    marginTop: 2,
  },
  statLabelSecondary: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
  },
  statValueSecondary: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginTop: 4,
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 13,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 20,
    width: "100%",
    maxWidth: 340,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    color: "#4b5563",
    lineHeight: 20,
    marginBottom: 18,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalBtn: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalBtnDanger: {
    backgroundColor: "#fee2e2",
  },
  modalBtnDangerText: {
    color: "#dc2626",
    fontWeight: "600",
  },
  modalBtnPrimary: {
    backgroundColor: "#ec4b35",
  },
  modalBtnPrimaryText: {
    color: "#ffffff",
    fontWeight: "600",
  },
});
