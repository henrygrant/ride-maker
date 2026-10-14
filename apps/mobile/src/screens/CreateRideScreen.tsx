import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type CameraRef,
  type MapRef,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
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

type ScreenMode = "ready" | "edit-points" | "save";

export function CreateRideScreen({
  initialDraft,
  onSave,
  onBack,
  onDraftChange,
  isTestMode,
}: CreateRideScreenProps) {
  const insets = useSafeAreaInsets();
  const controllerRef = useRef<CreateRideController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CreateRideController(
      routingProvider,
      geocodingProvider,
      initialDraft,
      { autoRoute: true },
    );
  }
  const controller = controllerRef.current;

  const [state, setState] = useState<ControllerState>(() => controller.getState());
  const [mode, setMode] = useState<ScreenMode>("ready");
  const [activeSearchPointId, setActiveSearchPointId] = useState<string | null>(null);
  const [searchInputValue, setSearchInputValue] = useState("");
  const [showExitModal, setShowExitModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dockHeight, setDockHeight] = useState(220);
  const [activeMenuPointId, setActiveMenuPointId] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const latestViewportCenterRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const searchDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput | null>(null);

  // Subscribe to controller updates & trigger initial auto-route if routable
  useEffect(() => {
    const unsubscribe = controller.subscribe((nextState) => {
      setState({
        ...nextState,
        startPoint: { ...nextState.startPoint },
        finishPoint: { ...nextState.finishPoint },
        viaStops: nextState.viaStops.map((point) => ({ ...point })),
        newStopSearch: { ...nextState.newStopSearch },
      });
      if (onDraftChange) {
        onDraftChange(controller.exportDraft());
      }
    });

    // Synchronize initial snapshot
    setState(controller.getState());

    // Auto-route on initial mount if draft is already routable and preview is missing
    if (controller.canRoute() && !controller.getState().previewRoute && !controller.getState().isRouting) {
      void controller.previewRoute();
    }

    return () => {
      unsubscribe();
      controller.dispose();
      if (searchDebounceTimer.current) {
        clearTimeout(searchDebounceTimer.current);
      }
    };
  }, [controller, onDraftChange]);

  // Back action hierarchy: dismiss search -> cancel placement -> close save -> collapse edit -> exit modal / back
  const handleBackPress = () => {
    if (saving) return;
    if (activeSearchPointId) {
      closeSearch();
      return;
    }
    if (state.placementTarget) {
      controller.cancelMapPlacement();
      return;
    }
    if (mode === "save") {
      setMode("ready");
      return;
    }
    if (mode === "edit-points") {
      setActiveMenuPointId(null);
      setMode("ready");
      return;
    }
    if (controller.isDirty()) {
      setShowExitModal(true);
    } else {
      onBack(false);
    }
  };

  // Hardware Back Press Handling
  useEffect(() => {
    const onHardwareBack = () => {
      if (saving) return true;
      if (activeSearchPointId) {
        closeSearch();
        return true;
      }
      if (state.placementTarget) {
        controller.cancelMapPlacement();
        return true;
      }
      if (mode === "save") {
        setMode("ready");
        return true;
      }
      if (mode === "edit-points") {
        setActiveMenuPointId(null);
        setMode("ready");
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
  }, [controller, state.placementTarget, mode, activeSearchPointId, showExitModal, onBack, saving]);

  // Search Handling
  const openSearch = (pointId: string) => {
    if (saving) return;
    if (pointId === "new-stop" && state.viaStops.length >= 8) return;
    setActiveSearchPointId(pointId);
    const point = findPoint(pointId);
    setSearchInputValue(point?.searchQuery ?? "");
  };

  const closeSearch = () => {
    Keyboard.dismiss();
    if (activeSearchPointId) {
      controller.cancelSearch(activeSearchPointId);
    }
    if (searchDebounceTimer.current) {
      clearTimeout(searchDebounceTimer.current);
    }
    setActiveSearchPointId(null);
    setSearchInputValue("");
  };

  const handleSearchChange = (text: string) => {
    setSearchInputValue(text);
    if (!activeSearchPointId) return;

    controller.setSearchQuery(activeSearchPointId, text, { preserveSelection: true });
    if (searchDebounceTimer.current) {
      clearTimeout(searchDebounceTimer.current);
    }

    if (text.trim().length === 0) return;

    searchDebounceTimer.current = setTimeout(() => {
      if (activeSearchPointId) {
        void controller.searchLocation(activeSearchPointId, text);
      }
    }, 300);
  };

  const handleSelectSearchResult = (pointId: string, item: GeocodingResult) => {
    if (saving) return;
    if (searchDebounceTimer.current) {
      clearTimeout(searchDebounceTimer.current);
    }
    controller.selectSearchResult(pointId, item);
    Keyboard.dismiss();
    setActiveSearchPointId(null);
    setSearchInputValue("");
    cameraRef.current?.easeTo({
      center: [item.longitude, item.latitude],
      zoom: 14,
      duration: 350,
    });
  };

  // Map Placement Handling
  const handleStartMapPlacement = (pointId: string) => {
    if (saving) return;
    if (pointId === "new-stop" && state.viaStops.length >= 8) return;
    if (activeSearchPointId) closeSearch();
    if (mode === "edit-points") {
      setActiveMenuPointId(null);
      setMode("ready");
    }
    controller.startMapPlacement(pointId);
    const candidate = controller.getState().candidateCoordinate;
    if (candidate) {
      latestViewportCenterRef.current = candidate;
      cameraRef.current?.easeTo({
        center: [candidate.longitude, candidate.latitude],
        zoom: 14,
        duration: 350,
      });
    }
  };

  const handleConfirmMapPlacement = async () => {
    if (saving) return;
    let coords = latestViewportCenterRef.current ?? state.candidateCoordinate;
    if (mapRef.current) {
      try {
        const center = await mapRef.current.getCenter();
        if (center && Array.isArray(center) && center.length >= 2) {
          coords = { longitude: center[0]!, latitude: center[1]! };
        }
      } catch {
        // Fall back to candidateCoordinate
      }
    }
    if (coords) {
      controller.setCandidateCoordinate(coords);
    }
    void controller.confirmMapPlacement();
  };

  // Locate Button (Camera-only GPS centering - NEVER edits points or routes)
  const handleLocate = async () => {
    if (saving) return;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setSaveError("Location permission denied.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (loc?.coords) {
        cameraRef.current?.easeTo({
          center: [loc.coords.longitude, loc.coords.latitude],
          zoom: 14,
          duration: 500,
        });
      }
    } catch {
      // Best-effort viewport centering; no-op if device has no GPS fix yet
    }
  };

  // Explicit Point GPS Assignment
  const handleUseMyLocation = async (pointId: string) => {
    if (saving) return;
    if (activeSearchPointId) closeSearch();
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
    const point =
      pointId === "start"
        ? current.startPoint
        : pointId === "finish"
        ? current.finishPoint
        : current.viaStops.find((stop) => stop.id === pointId);
    if (point?.latitude != null && point.longitude != null) {
      cameraRef.current?.easeTo({
        center: [point.longitude, point.latitude],
        zoom: 14,
        duration: 350,
      });
    }
  };

  // Undo Handling
  const handleUndo = () => {
    if (saving) return;
    controller.undo();
  };

  // Save Handling
  const handleSaveRide = async () => {
    if (saving || !controller.canSave()) return;
    setSaveError(null);
    setSaving(true);
    try {
      const doc = controller.buildRouteDocument();
      await onSave(doc);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save created ride.");
      setSaving(false);
    }
  };

  // Helper to locate point
  const findPoint = (pointId: string): DraftPointState | null => {
    if (pointId === "start") return state.startPoint;
    if (pointId === "finish") return state.finishPoint;
    if (pointId === "new-stop") return state.newStopSearch;
    return state.viaStops.find((s) => s.id === pointId) ?? null;
  };

  // Auto-fit camera when previewRoute updates
  useEffect(() => {
    if (state.previewRoute && state.previewRoute.segments.length > 0) {
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
          padding: { top: 90, right: 60, bottom: 220, left: 60 },
          duration: 400,
        });
      }
    }
  }, [state.previewRoute]);

  // Active MultiLineString geometry
  const activeMultiLineString = useMemo(() => {
    if (!state.previewRoute || state.previewRoute.segments.length === 0) return null;
    const legs = state.previewRoute.segments
      .filter((seg: RoutePoint[]) => seg.length >= 2)
      .map((seg: RoutePoint[]) => seg.map((p: RoutePoint) => [p.longitude, p.latitude]));
    return legs.length > 0 ? legs : null;
  }, [state.previewRoute]);

  // Stale MultiLineString geometry (rendered dimmed while recalculating)
  const staleMultiLineString = useMemo(() => {
    if (state.previewRoute) return null;
    const route = state.stalePreviewRoute;
    if (!route || route.segments.length === 0) return null;
    const legs = route.segments
      .filter((seg: RoutePoint[]) => seg.length >= 2)
      .map((seg: RoutePoint[]) => seg.map((p: RoutePoint) => [p.longitude, p.latitude]));
    return legs.length > 0 ? legs : null;
  }, [state.previewRoute, state.stalePreviewRoute]);

  const displayedError = saveError ?? state.error;

  const isStartSet = state.startPoint.latitude !== null && state.startPoint.longitude !== null;
  const isFinishSet =
    state.isLoop || (state.finishPoint.latitude !== null && state.finishPoint.longitude !== null);

  const currentActiveSearchPoint = activeSearchPointId ? findPoint(activeSearchPointId) : null;
  const isAtStopLimit = state.viaStops.length >= 8;

  const searchTarget: string = !isStartSet
    ? "start"
    : !isFinishSet
    ? "finish"
    : state.isLoop
    ? isAtStopLimit
      ? ""
      : "new-stop"
    : "finish";

  const searchPillLabel = !isStartSet
    ? "Where do you want to start?"
    : !isFinishSet
    ? `${state.startPoint.name || "Start"} → Where to?`
    : state.isLoop
    ? isAtStopLimit
      ? `${state.startPoint.name || "Start"} (Loop) · Max 8 stops`
      : `${state.startPoint.name || "Start"} (Loop) → Add stop`
    : `${state.startPoint.name || "Start"} → ${state.finishPoint.name || "Finish"}`;

  const searchAccessibilityLabel = !isStartSet
    ? "Search start location"
    : !isFinishSet
    ? "Search destination"
    : state.isLoop
    ? "Search stop location"
    : "Search destination";

  return (
    <View style={styles.screenContainer}>
      {/* 1. Full Bleed Map View (always mounted) */}
      <View testID="view-create-map" style={StyleSheet.absoluteFill}>
        <Map
          ref={mapRef}
          mapStyle="https://tiles.openfreemap.org/styles/liberty"
          style={StyleSheet.absoluteFill}
          attributionPosition={{
            bottom: Math.max(dockHeight + insets.bottom + 8, insets.bottom + 96),
            right: 10,
          }}
          onPress={(event) => {
            if (state.placementTarget) {
              const native = event?.nativeEvent as {
                lngLat?: [number, number];
                geometry?: { coordinates?: [number, number] };
              };
              const coords =
                native?.lngLat ??
                native?.geometry?.coordinates ??
                (event as unknown as { geometry?: { coordinates?: [number, number] } })?.geometry
                  ?.coordinates;
              if (Array.isArray(coords) && coords.length >= 2) {
                const c = { longitude: coords[0]!, latitude: coords[1]! };
                latestViewportCenterRef.current = c;
                controller.setCandidateCoordinate(c);
                cameraRef.current?.easeTo({
                  center: [coords[0]!, coords[1]!],
                  duration: 250,
                });
              }
            }
          }}
          onRegionIsChanging={(event) => {
            if (state.placementTarget) {
              const center = event.nativeEvent.center;
              if (center && center.length >= 2) {
                latestViewportCenterRef.current = { longitude: center[0]!, latitude: center[1]! };
              }
            }
          }}
          onRegionDidChange={(event) => {
            if (state.placementTarget) {
              const center = event.nativeEvent.center;
              if (center && center.length >= 2) {
                const c = { longitude: center[0]!, latitude: center[1]! };
                latestViewportCenterRef.current = c;
                controller.setCandidateCoordinate(c);
              }
            }
          }}
        >
          <Camera
            ref={cameraRef}
            initialViewState={{ center: [-73.968, 40.785], zoom: 12 }}
          />

          {/* Stale polyline (dimmed while recalculating) */}
          {staleMultiLineString && (
            <GeoJSONSource
              id="stale-line-src"
              data={{
                type: "Feature",
                geometry: {
                  type: "MultiLineString",
                  coordinates: staleMultiLineString,
                },
                properties: {},
              }}
            >
              <Layer
                id="stale-line"
                type="line"
                paint={{
                  "line-color": "#a8c4ba",
                  "line-width": 4,
                  "line-opacity": 0.5,
                  "line-dasharray": [2, 2],
                }}
              />
            </GeoJSONSource>
          )}

          {/* Active polyline: forest green with crisp casing */}
          {activeMultiLineString && (
            <GeoJSONSource
              id="preview-line-src"
              data={{
                type: "Feature",
                geometry: {
                  type: "MultiLineString",
                  coordinates: activeMultiLineString,
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
                paint={{ "line-color": "#1e8068", "line-width": 4 }}
              />
            </GeoJSONSource>
          )}

          {/* Markers */}
          {isStartSet && (
            <Marker
              key="start"
              id="point-start"
              lngLat={[state.startPoint.longitude!, state.startPoint.latitude!]}
              pointerEvents="none"
            >
              <View
                testID="map-marker-start"
                collapsable={false}
                accessibilityLabel="Start point"
                style={[styles.markerBase, { backgroundColor: "#1e8068" }]}
              >
                <Text style={styles.markerText}>S</Text>
              </View>
            </Marker>
          )}

          {!state.isLoop &&
            state.finishPoint.latitude !== null &&
            state.finishPoint.longitude !== null && (
              <Marker
                key="finish"
                id="point-finish"
                lngLat={[state.finishPoint.longitude, state.finishPoint.latitude]}
                pointerEvents="none"
              >
                <View
                  testID="map-marker-finish"
                  collapsable={false}
                  accessibilityLabel="Finish point"
                  style={[styles.markerBase, { backgroundColor: "#d84b35" }]}
                >
                  <Text style={styles.markerText}>F</Text>
                </View>
              </Marker>
            )}

          {state.viaStops.map((point, index) =>
            point.latitude !== null && point.longitude !== null ? (
              <Marker
                key={point.id}
                id={`point-${point.id}`}
                lngLat={[point.longitude, point.latitude]}
                pointerEvents="none"
              >
                <View
                  testID={`map-marker-via-${index + 1}`}
                  collapsable={false}
                  accessibilityLabel={`Stop ${index + 1}`}
                  style={[styles.markerBase, { backgroundColor: "#2e6f61" }]}
                >
                  <Text style={styles.markerText}>{index + 1}</Text>
                </View>
              </Marker>
            ) : null,
          )}
        </Map>
      </View>

      {/* 2. Fixed Center Pin Overlay for Placement Mode (Single unambiguous candidate anchored at viewport center) */}
      {state.placementTarget && (
        <View style={styles.centerPinContainer} pointerEvents="none">
          <View style={styles.pinWrapper}>
            <View style={styles.centerPinHead}>
              <View style={styles.centerPinDot} />
            </View>
            <View style={styles.centerPinNeedle} />
          </View>
        </View>
      )}

      {/* 3. Floating Top Bar */}
      <View
        style={[
          styles.topBarContainer,
          { top: Math.max(insets.top + 8, 16) },
        ]}
      >
        {state.placementTarget ? (
          /* Placement Mode Top Bar */
          <View style={styles.placementTopBar}>
            <Pressable
              testID="button-cancel-map-placement"
              accessibilityRole="button"
              accessibilityLabel="Cancel placement"
              onPress={() => controller.cancelMapPlacement()}
              style={styles.circleIconButton}
            >
              <Text style={styles.circleIconText}>✕</Text>
            </Pressable>

            <View style={styles.placementTitleBox}>
              <Text testID="text-placement-title" style={styles.placementTitleText}>
                {state.placementTarget.label}
              </Text>
              <View style={styles.placementPill}>
                <Text style={styles.placementPillText}>Move the map to choose a spot</Text>
              </View>
            </View>

            <View style={{ width: 44 }} />
          </View>
        ) : activeSearchPointId ? (
          /* Search Mode Top Bar & Panel */
          <View style={styles.searchContainer}>
            <View style={styles.searchTargetDisclosure}>
              <Text style={styles.searchTargetDisclosureText}>
                {activeSearchPointId === "start"
                  ? "SEARCH START LOCATION"
                  : activeSearchPointId === "finish"
                  ? "SEARCH DESTINATION"
                  : activeSearchPointId === "new-stop"
                  ? "SEARCH STOP LOCATION"
                  : `SEARCH STOP ${state.viaStops.findIndex((s) => s.id === activeSearchPointId) + 1}`}
              </Text>
            </View>
            <View style={styles.searchBarRow}>
              <Pressable
                testID="button-close-search"
                accessibilityRole="button"
                accessibilityLabel="Close search"
                onPress={closeSearch}
                style={styles.circleIconButton}
              >
                <Text style={styles.circleIconText}>‹</Text>
              </Pressable>

              <View style={styles.searchInputWrapper}>
                <TextInput
                  ref={searchInputRef}
                  testID={
                    activeSearchPointId === "start"
                      ? "input-start-location"
                      : activeSearchPointId === "finish"
                      ? "input-finish-location"
                      : activeSearchPointId === "new-stop"
                      ? "input-stop-new"
                      : `input-stop-${state.viaStops.findIndex((s) => s.id === activeSearchPointId)}`
                  }
                  style={styles.searchTextInput}
                  value={searchInputValue}
                  onChangeText={handleSearchChange}
                  placeholder={
                    activeSearchPointId === "start"
                      ? "Search start address or place"
                      : activeSearchPointId === "finish"
                      ? "Search destination address or place"
                      : "Search stop address or place"
                  }
                  placeholderTextColor="#71827b"
                  autoFocus
                  returnKeyType="search"
                  onSubmitEditing={() => {
                    if (activeSearchPointId && searchInputValue.trim()) {
                      void controller.searchLocation(
                        activeSearchPointId,
                        searchInputValue,
                      );
                    }
                  }}
                />
                {searchInputValue.length > 0 && (
                  <Pressable
                    testID="button-clear-search"
                    accessibilityLabel="Clear search text"
                    onPress={() => handleSearchChange("")}
                    style={styles.clearSearchBtn}
                  >
                    <Text style={styles.clearSearchText}>✕</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* Results Floating Panel */}
            <View style={styles.searchResultsPanel}>
              {currentActiveSearchPoint?.isSearching && (
                <View style={styles.searchingRow}>
                  <ActivityIndicator size="small" color="#1e8068" />
                  <Text style={styles.searchingText}>Searching locations…</Text>
                </View>
              )}

              {currentActiveSearchPoint?.searchError && (
                <View style={styles.searchErrorBox}>
                  <Text
                    testID={`text-search-error-${activeSearchPointId}`}
                    style={styles.searchErrorText}
                  >
                    {currentActiveSearchPoint.searchError}
                  </Text>
                </View>
              )}

              {currentActiveSearchPoint?.searchResults &&
                currentActiveSearchPoint.searchResults.length > 0 && (
                  <ScrollView
                    style={styles.searchResultsList}
                    keyboardShouldPersistTaps="handled"
                  >
                    {currentActiveSearchPoint.searchResults.map((item) => (
                      <Pressable
                        key={item.id}
                        testID={`search-item-${item.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={item.name}
                        onPress={() => handleSelectSearchResult(activeSearchPointId, item)}
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
                  </ScrollView>
                )}
            </View>
          </View>
        ) : (
          /* Normal Top Bar */
          <View style={styles.normalTopBar}>
            <Pressable
              testID="button-create-back"
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={handleBackPress}
              style={styles.circleIconButton}
            >
              <Text style={styles.circleIconText}>‹</Text>
            </Pressable>

            {/* Search Pill Trigger with Explicit Target */}
            <Pressable
              testID="button-open-search"
              accessibilityRole="button"
              accessibilityLabel={searchAccessibilityLabel}
              onPress={() => {
                if (searchTarget) {
                  openSearch(searchTarget);
                }
              }}
              style={styles.searchPill}
            >
              <Text style={styles.searchIconSymbol}>🔍</Text>
              <Text style={styles.searchPillText} numberOfLines={1}>
                {searchPillLabel}
              </Text>
            </Pressable>

            {/* Test Badge overlay */}
            {isTestMode && (
              <View style={styles.topBadgeWrapper} pointerEvents="none">
                <Text testID="badge-test-mode" style={styles.testBadgeText}>
                  TEST MODE
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* 4. Global Error Banner */}
      {displayedError && !activeSearchPointId && !state.placementTarget && (
        <View style={[styles.floatingErrorBanner, { top: insets.top + 72 }]}>
          <Text testID="text-create-error" style={styles.floatingErrorText}>
            {displayedError}
          </Text>
          <Pressable
            testID="button-preview-route"
            accessibilityRole="button"
            accessibilityLabel="Retry route"
            onPress={() => void controller.previewRoute()}
            style={styles.retryBannerBtn}
          >
            <Text style={styles.retryBannerBtnText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* 5. Floating Controls above Dock (Undo & Locate) */}
      {!state.placementTarget && !activeSearchPointId && mode !== "edit-points" && mode !== "save" && (
        <View
          style={[
            styles.floatingControlsRow,
            { bottom: dockHeight + Math.max(insets.bottom + 8, 16) + 12 },
          ]}
          pointerEvents="box-none"
        >
          {state.canUndo ? (
            <Pressable
              testID="button-undo"
              accessibilityRole="button"
              accessibilityLabel="Undo last change"
              onPress={handleUndo}
              style={styles.floatingToolButton}
            >
              <Text style={styles.toolIconText}>↺</Text>
              <Text style={styles.toolLabelText}>Undo</Text>
            </Pressable>
          ) : (
            <View style={{ width: 80 }} />
          )}

          <Pressable
            testID="button-center-location"
            accessibilityRole="button"
            accessibilityLabel="Center map to location"
            onPress={handleLocate}
            style={styles.floatingToolButton}
          >
            <Text style={styles.toolIconText}>🎯</Text>
            <Text style={styles.toolLabelText}>Locate</Text>
          </Pressable>
        </View>
      )}

      {/* 6. Floating Bottom Dock */}
      <View
        style={[
          styles.dockWrapper,
          {
            bottom: keyboardHeight,
            paddingBottom: keyboardHeight > 0 ? 12 : Math.max(insets.bottom + 8, 16),
          },
        ]}
        onLayout={(e) => setDockHeight(e.nativeEvent.layout.height)}
        pointerEvents="box-none"
      >
        {state.placementTarget ? (
          /* Placement Dock */
          <View style={styles.dockCard}>
            <Text style={styles.dockMicro}>
              {state.placementTarget.pointId === "start"
                ? "Start point"
                : state.placementTarget.pointId === "finish"
                ? "Finish point"
                : "New stop"}
            </Text>
            <Text style={styles.dockTitle} numberOfLines={1}>
              {state.candidateCoordinate
                ? "Selected spot on map"
                : "Choose location on map"}
            </Text>
            <Text style={styles.dockSub}>The route changes only when you confirm.</Text>
            <View style={styles.dockActionsRow}>
              <Pressable
                testID="button-cancel-map-placement"
                accessibilityRole="button"
                accessibilityLabel="Cancel placement"
                onPress={() => controller.cancelMapPlacement()}
                style={[styles.btnBase, styles.btnSecondary]}
              >
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="button-confirm-map-placement"
                accessibilityRole="button"
                accessibilityLabel="Confirm location"
                onPress={handleConfirmMapPlacement}
                style={[styles.btnBase, styles.btnPrimary]}
              >
                <Text style={styles.btnPrimaryText}>
                  Set {state.placementTarget.pointId === "start" ? "start" : state.placementTarget.pointId === "finish" ? "finish" : "stop"} here
                </Text>
              </Pressable>
            </View>
          </View>
        ) : mode === "save" ? (
          /* Save Naming Sheet */
          <View style={styles.dockCard}>
            <Text style={styles.dockMicro}>Ready when you are</Text>
            <Text style={styles.dockTitle}>Give your ride a name</Text>
            <Text style={styles.dockSub}>
              {state.previewRoute
                ? `${(state.previewRoute.distanceMeters / 1000).toFixed(1)} km · Directions ready`
                : "Route ready"}
            </Text>
            <TextInput
              testID="input-created-ride-name"
              style={styles.nameInput}
              value={state.name}
              onChangeText={(text) => {
                if (!saving) controller.setName(text);
              }}
              placeholder="e.g. Morning River Loop"
              placeholderTextColor="#71827b"
            />
            {saveError && (
              <Text testID="text-create-error" style={styles.errorTextSmall}>
                {saveError}
              </Text>
            )}
            <View style={styles.dockActionsRow}>
              <Pressable
                testID="button-save-back"
                accessibilityRole="button"
                accessibilityLabel="Back to preview"
                onPress={() => {
                  if (!saving) setMode("ready");
                }}
                disabled={saving}
                style={[styles.btnBase, styles.btnSecondary, saving && styles.btnDisabled]}
              >
                <Text style={styles.btnSecondaryText}>Back</Text>
              </Pressable>
              <Pressable
                testID="button-save-created-ride"
                accessibilityRole="button"
                accessibilityLabel="Confirm save ride"
                onPress={() => void handleSaveRide()}
                disabled={!controller.canSave() || saving}
                style={[
                  styles.btnBase,
                  styles.btnCoral,
                  (!controller.canSave() || saving) && styles.btnDisabled,
                ]}
              >
                {saving ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.btnCoralText}>Save ride</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : mode === "edit-points" ? (
          /* Expanded Edit Points Sheet with Per-Point Options Menu */
          <View style={[styles.dockCard, styles.expandedSheet]}>
            <View style={styles.sheetHandleBar} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Route points</Text>
              <Pressable
                testID="button-edit-points"
                accessibilityRole="button"
                accessibilityLabel="Done editing points"
                onPress={() => {
                  setActiveMenuPointId(null);
                  setMode("ready");
                }}
                style={styles.doneBtn}
              >
                <Text style={styles.doneBtnText}>Done</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.pointsList} keyboardShouldPersistTaps="handled">
              {/* Start Point Row */}
              <View style={styles.pointRowWrapper}>
                <View style={styles.pointRow}>
                  <View style={[styles.pointBadge, { backgroundColor: "#1e8068" }]}>
                    <Text style={styles.pointBadgeText}>S</Text>
                  </View>
                  <Pressable
                    testID="button-search-start"
                    accessibilityRole="button"
                    accessibilityLabel="Edit start location"
                    onPress={() => openSearch("start")}
                    style={styles.pointInfo}
                  >
                    <Text style={styles.pointKind}>START</Text>
                    <Text style={styles.pointName} numberOfLines={1}>
                      {state.startPoint.name || "Set start location"}
                    </Text>
                  </Pressable>
                  <Pressable
                    testID="button-point-options-start"
                    accessibilityRole="button"
                    accessibilityLabel="Start options"
                    onPress={() => setActiveMenuPointId(activeMenuPointId === "start" ? null : "start")}
                    style={styles.pointMoreBtn}
                  >
                    <Text style={styles.pointMoreIcon}>{activeMenuPointId === "start" ? "✕" : "⋯"}</Text>
                  </Pressable>
                </View>

                {activeMenuPointId === "start" && (
                  <View style={styles.pointMenuPanel}>
                    <Pressable
                      testID="button-search-option-start"
                      accessibilityRole="button"
                      accessibilityLabel="Search"
                      onPress={() => {
                        setActiveMenuPointId(null);
                        openSearch("start");
                      }}
                      style={styles.pointMenuBtn}
                    >
                      <Text style={styles.pointMenuBtnIcon}>🔍</Text>
                      <Text style={styles.pointMenuBtnText}>Search</Text>
                    </Pressable>
                    <Pressable
                      testID="button-map-pick-start"
                      accessibilityRole="button"
                      accessibilityLabel="Move on map"
                      onPress={() => {
                        setActiveMenuPointId(null);
                        handleStartMapPlacement("start");
                      }}
                      style={styles.pointMenuBtn}
                    >
                      <Text style={styles.pointMenuBtnIcon}>📍</Text>
                      <Text style={styles.pointMenuBtnText}>Move on map</Text>
                    </Pressable>
                    <Pressable
                      testID="button-use-my-location-start"
                      accessibilityRole="button"
                      accessibilityLabel="My location"
                      onPress={() => {
                        setActiveMenuPointId(null);
                        void handleUseMyLocation("start");
                      }}
                      style={styles.pointMenuBtn}
                    >
                      <Text style={styles.pointMenuBtnIcon}>🎯</Text>
                      <Text style={styles.pointMenuBtnText}>My location</Text>
                    </Pressable>
                  </View>
                )}
              </View>

              {/* Via Stops */}
              {state.viaStops.map((stop, idx) => (
                <View key={stop.id} style={styles.pointRowWrapper}>
                  <View style={styles.pointRow}>
                    <View style={[styles.pointBadge, { backgroundColor: "#2e6f61" }]}>
                      <Text style={styles.pointBadgeText}>{idx + 1}</Text>
                    </View>
                    <Pressable
                      testID={`button-search-${stop.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit stop ${idx + 1}`}
                      onPress={() => openSearch(stop.id)}
                      style={styles.pointInfo}
                    >
                      <Text style={styles.pointKind}>STOP {idx + 1}</Text>
                      <Text style={styles.pointName} numberOfLines={1}>
                        {stop.name || `Set stop ${idx + 1}`}
                      </Text>
                    </Pressable>
                    <Pressable
                      testID={`button-point-options-stop-${idx}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Stop ${idx + 1} options`}
                      onPress={() => setActiveMenuPointId(activeMenuPointId === stop.id ? null : stop.id)}
                      style={styles.pointMoreBtn}
                    >
                      <Text style={styles.pointMoreIcon}>{activeMenuPointId === stop.id ? "✕" : "⋯"}</Text>
                    </Pressable>
                  </View>

                  {activeMenuPointId === stop.id && (
                    <View style={styles.pointMenuPanel}>
                      <Pressable
                        testID={`button-search-option-${stop.id}`}
                        accessibilityRole="button"
                        accessibilityLabel="Search"
                        onPress={() => {
                          setActiveMenuPointId(null);
                          openSearch(stop.id);
                        }}
                        style={styles.pointMenuBtn}
                      >
                        <Text style={styles.pointMenuBtnIcon}>🔍</Text>
                        <Text style={styles.pointMenuBtnText}>Search</Text>
                      </Pressable>
                      <Pressable
                        testID={`button-map-pick-${stop.id}`}
                        accessibilityRole="button"
                        accessibilityLabel="Move on map"
                        onPress={() => {
                          setActiveMenuPointId(null);
                          handleStartMapPlacement(stop.id);
                        }}
                        style={styles.pointMenuBtn}
                      >
                        <Text style={styles.pointMenuBtnIcon}>📍</Text>
                        <Text style={styles.pointMenuBtnText}>Move on map</Text>
                      </Pressable>
                      <Pressable
                        testID={`button-use-my-location-${stop.id}`}
                        accessibilityRole="button"
                        accessibilityLabel="My location"
                        onPress={() => {
                          setActiveMenuPointId(null);
                          void handleUseMyLocation(stop.id);
                        }}
                        style={styles.pointMenuBtn}
                      >
                        <Text style={styles.pointMenuBtnIcon}>🎯</Text>
                        <Text style={styles.pointMenuBtnText}>My location</Text>
                      </Pressable>

                      {idx > 0 && (
                        <Pressable
                          testID={`button-stop-up-stop-${idx}`}
                          accessibilityRole="button"
                          accessibilityLabel="Move stop up"
                          onPress={() => {
                            setActiveMenuPointId(null);
                            controller.moveViaStop(stop.id, "up");
                          }}
                          style={styles.pointMenuBtn}
                        >
                          <Text style={styles.pointMenuBtnIcon}>▲</Text>
                          <Text style={styles.pointMenuBtnText}>Move up</Text>
                        </Pressable>
                      )}
                      {idx < state.viaStops.length - 1 && (
                        <Pressable
                          testID={`button-stop-down-stop-${idx}`}
                          accessibilityRole="button"
                          accessibilityLabel="Move stop down"
                          onPress={() => {
                            setActiveMenuPointId(null);
                            controller.moveViaStop(stop.id, "down");
                          }}
                          style={styles.pointMenuBtn}
                        >
                          <Text style={styles.pointMenuBtnIcon}>▼</Text>
                          <Text style={styles.pointMenuBtnText}>Move down</Text>
                        </Pressable>
                      )}
                      <Pressable
                        testID={`button-stop-remove-stop-${idx}`}
                        accessibilityRole="button"
                        accessibilityLabel="Remove stop"
                        onPress={() => {
                          setActiveMenuPointId(null);
                          controller.removeViaStop(stop.id);
                        }}
                        style={[styles.pointMenuBtn, styles.pointMenuBtnDanger]}
                      >
                        <Text style={[styles.pointMenuBtnIcon, styles.pointMenuBtnDangerText]}>✕</Text>
                        <Text style={[styles.pointMenuBtnText, styles.pointMenuBtnDangerText]}>Remove</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}

              {/* Finish Point Row (if not loop) */}
              {!state.isLoop && (
                <View style={styles.pointRowWrapper}>
                  <View style={styles.pointRow}>
                    <View style={[styles.pointBadge, { backgroundColor: "#d84b35" }]}>
                      <Text style={styles.pointBadgeText}>F</Text>
                    </View>
                    <Pressable
                      testID="button-search-finish"
                      accessibilityRole="button"
                      accessibilityLabel="Edit finish location"
                      onPress={() => openSearch("finish")}
                      style={styles.pointInfo}
                    >
                      <Text style={styles.pointKind}>FINISH</Text>
                      <Text style={styles.pointName} numberOfLines={1}>
                        {state.finishPoint.name || "Set finish location"}
                      </Text>
                    </Pressable>
                    <Pressable
                      testID="button-point-options-finish"
                      accessibilityRole="button"
                      accessibilityLabel="Finish options"
                      onPress={() => setActiveMenuPointId(activeMenuPointId === "finish" ? null : "finish")}
                      style={styles.pointMoreBtn}
                    >
                      <Text style={styles.pointMoreIcon}>{activeMenuPointId === "finish" ? "✕" : "⋯"}</Text>
                    </Pressable>
                  </View>

                  {activeMenuPointId === "finish" && (
                    <View style={styles.pointMenuPanel}>
                      <Pressable
                        testID="button-search-option-finish"
                        accessibilityRole="button"
                        accessibilityLabel="Search"
                        onPress={() => {
                          setActiveMenuPointId(null);
                          openSearch("finish");
                        }}
                        style={styles.pointMenuBtn}
                      >
                        <Text style={styles.pointMenuBtnIcon}>🔍</Text>
                        <Text style={styles.pointMenuBtnText}>Search</Text>
                      </Pressable>
                      <Pressable
                        testID="button-map-pick-finish"
                        accessibilityRole="button"
                        accessibilityLabel="Move on map"
                        onPress={() => {
                          setActiveMenuPointId(null);
                          handleStartMapPlacement("finish");
                        }}
                        style={styles.pointMenuBtn}
                      >
                        <Text style={styles.pointMenuBtnIcon}>📍</Text>
                        <Text style={styles.pointMenuBtnText}>Move on map</Text>
                      </Pressable>
                      <Pressable
                        testID="button-use-my-location-finish"
                        accessibilityRole="button"
                        accessibilityLabel="My location"
                        onPress={() => {
                          setActiveMenuPointId(null);
                          void handleUseMyLocation("finish");
                        }}
                        style={styles.pointMenuBtn}
                      >
                        <Text style={styles.pointMenuBtnIcon}>🎯</Text>
                        <Text style={styles.pointMenuBtnText}>My location</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>

            {/* Bottom Actions inside Sheet */}
            <View style={styles.sheetBottomBar}>
              {state.viaStops.length < 8 ? (
                <Pressable
                  testID="button-add-stop"
                  accessibilityRole="button"
                  accessibilityLabel="Add via stop"
                  onPress={() => {
                    handleStartMapPlacement("new-stop");
                  }}
                  style={[styles.btnBase, styles.btnSecondary, { flex: 1 }]}
                >
                  <Text style={styles.btnSecondaryText}>+ Add stop</Text>
                </Pressable>
              ) : (
                <Text style={styles.mutedNote}>Max 8 stops</Text>
              )}

              <Pressable
                testID="button-make-loop"
                accessibilityRole="button"
                accessibilityLabel="Toggle loop"
                onPress={() => controller.toggleLoop()}
                style={[
                  styles.btnBase,
                  styles.btnSecondary,
                  state.isLoop && styles.btnActiveLoop,
                  { flex: 1 },
                ]}
              >
                <Text
                  style={[
                    styles.btnSecondaryText,
                    state.isLoop && styles.btnActiveLoopText,
                  ]}
                >
                  {state.isLoop ? "✓ Loop ride" : "↺ Make loop"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : !isStartSet ? (
          /* Scene: First Point / Start unset */
          <View style={styles.dockCard}>
            <Text style={styles.dockMicro}>Start your ride</Text>
            <Text style={styles.dockTitle}>Where are we starting?</Text>
            <Text style={styles.dockSub}>
              Use your location, search, or choose on the map.
            </Text>
            <View style={styles.dockActionsRow}>
              <Pressable
                testID="button-map-pick-start"
                accessibilityRole="button"
                accessibilityLabel="Choose start on map"
                onPress={() => handleStartMapPlacement("start")}
                style={[styles.btnBase, styles.btnSecondary]}
              >
                <Text style={styles.btnSecondaryText}>Choose on map</Text>
              </Pressable>
              <Pressable
                testID="button-use-my-location-start"
                accessibilityRole="button"
                accessibilityLabel="Use my location for start"
                onPress={() => void handleUseMyLocation("start")}
                style={[styles.btnBase, styles.btnCoral]}
              >
                <Text style={styles.btnCoralText}>My location</Text>
              </Pressable>
            </View>
          </View>
        ) : !isFinishSet ? (
          /* Scene: Second Point / Finish unset */
          <View style={styles.dockCard}>
            <Text style={styles.dockMicro}>Finish your ride</Text>
            <Text style={styles.dockTitle}>Where are we going?</Text>
            <Text style={styles.dockSub}>
              From {state.startPoint.name || "Start"}. Choose on the map, search, or make a loop.
            </Text>
            <View style={styles.dockActionsRow}>
              <Pressable
                testID="button-map-pick-finish"
                accessibilityRole="button"
                accessibilityLabel="Choose finish on map"
                onPress={() => handleStartMapPlacement("finish")}
                style={[styles.btnBase, styles.btnSecondary]}
              >
                <Text style={styles.btnSecondaryText}>Choose on map</Text>
              </Pressable>
              <Pressable
                testID="button-make-loop"
                accessibilityRole="button"
                accessibilityLabel="Make loop ride"
                onPress={() => controller.toggleLoop()}
                style={[styles.btnBase, styles.btnCoral]}
              >
                <Text style={styles.btnCoralText}>Make a loop</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          /* Scene: Route Ready */
          <View style={styles.dockCard}>
            <View style={styles.readyHeaderRow}>
              <Text style={styles.dockMicro}>
                {state.isLoop ? "Return to start" : "Your route"}
              </Text>
              {state.isRouting ? (
                <View style={styles.statusChipRouting}>
                  <ActivityIndicator size="small" color="#1e8068" />
                  <Text style={styles.statusChipRoutingText}>Calculating…</Text>
                </View>
              ) : state.error ? (
                <Pressable
                  testID="button-retry-route"
                  accessibilityRole="button"
                  accessibilityLabel="Retry route calculation"
                  onPress={() => void controller.previewRoute()}
                  style={styles.statusChipError}
                >
                  <Text style={styles.statusChipErrorText}>Retry route</Text>
                </Pressable>
              ) : state.previewRoute ? (
                <View style={styles.statusChipReady}>
                  <Text style={styles.statusChipReadyText}>✓ Directions ready</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.readyMetricsRow}>
              <Text testID="text-preview-distance" style={styles.distancePrimary}>
                {state.previewRoute
                  ? `${(state.previewRoute.distanceMeters / 1000).toFixed(1)} km`
                  : state.stalePreviewRoute
                  ? `${(state.stalePreviewRoute.distanceMeters / 1000).toFixed(1)} km`
                  : "--"}
              </Text>
              {state.previewRoute && (
                <Text testID="text-preview-turns" style={styles.turnsSecondary}>
                  {state.previewRoute.maneuvers.length} directions
                </Text>
              )}
            </View>

            <View style={styles.dockActionsRow}>
              <Pressable
                testID="button-edit-points"
                accessibilityRole="button"
                accessibilityLabel="Edit points"
                onPress={() => setMode("edit-points")}
                style={[styles.btnBase, styles.btnSecondary]}
              >
                <Text style={styles.btnSecondaryText}>Edit points</Text>
              </Pressable>
              <Pressable
                testID="button-save-created-ride"
                accessibilityRole="button"
                accessibilityLabel="Save ride"
                onPress={() => setMode("save")}
                disabled={!controller.isRouteReady() || saving}
                style={[
                  styles.btnBase,
                  styles.btnCoral,
                  (!controller.isRouteReady() || saving) && styles.btnDisabled,
                ]}
              >
                <Text style={styles.btnCoralText}>Save ride</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* 7. Exit Confirmation Modal */}
      <Modal
        visible={showExitModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!saving) setShowExitModal(false);
        }}
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
  screenContainer: {
    flex: 1,
    backgroundColor: "#f4f3ec",
  },
  markerBase: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2.5,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  markerText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  centerPinContainer: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  pinWrapper: {
    alignItems: "center",
    marginBottom: 50, // Needle tip anchored at exact screen center
  },
  centerPinHead: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1e8068",
    borderWidth: 3,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  centerPinDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#ffffff",
  },
  centerPinNeedle: {
    width: 3,
    height: 16,
    backgroundColor: "#1e8068",
    borderRadius: 1.5,
    marginTop: -2,
  },
  topBarContainer: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 100,
  },
  normalTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  circleIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fffffc",
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#172c28",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  circleIconText: {
    fontSize: 24,
    fontWeight: "600",
    color: "#172c28",
    marginTop: -2,
  },
  searchPill: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fffffc",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
    elevation: 5,
    shadowColor: "#172c28",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  searchIconSymbol: {
    fontSize: 16,
  },
  searchPillText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#172c28",
    flex: 1,
  },
  topBadgeWrapper: {
    position: "absolute",
    right: 4,
    top: 50,
  },
  testBadgeText: {
    fontSize: 10,
    color: "#855000",
    backgroundColor: "#fff0bf",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    overflow: "hidden",
  },
  placementTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  placementTitleBox: {
    alignItems: "center",
    gap: 4,
  },
  placementTitleText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#172c28",
    backgroundColor: "rgba(255, 255, 252, 0.95)",
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: "hidden",
  },
  placementPill: {
    backgroundColor: "rgba(23, 44, 40, 0.82)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  placementPillText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "500",
  },
  searchContainer: {
    gap: 8,
  },
  searchTargetDisclosure: {
    alignSelf: "center",
    backgroundColor: "rgba(30, 128, 104, 0.9)",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  searchTargetDisclosureText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.5,
  },
  searchBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInputWrapper: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fffffc",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    elevation: 6,
    shadowColor: "#172c28",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  searchTextInput: {
    flex: 1,
    fontSize: 15,
    color: "#172c28",
    paddingVertical: 8,
  },
  clearSearchBtn: {
    padding: 6,
  },
  clearSearchText: {
    color: "#71827b",
    fontSize: 14,
  },
  searchResultsPanel: {
    backgroundColor: "#fffffc",
    borderRadius: 16,
    maxHeight: 280,
    elevation: 8,
    shadowColor: "#172c28",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
    overflow: "hidden",
  },
  searchingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
  },
  searchingText: {
    fontSize: 14,
    color: "#1e8068",
  },
  searchErrorBox: {
    padding: 14,
    backgroundColor: "#fde8e8",
  },
  searchErrorText: {
    fontSize: 14,
    color: "#9b1c1c",
  },
  searchResultsList: {
    maxHeight: 250,
  },
  searchResultItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0eee4",
  },
  searchResultName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#172c28",
  },
  searchResultLabel: {
    fontSize: 13,
    color: "#6b7c75",
    marginTop: 2,
  },
  floatingErrorBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: "#fde8e8",
    borderWidth: 1,
    borderColor: "#f8b4b4",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    zIndex: 90,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  floatingErrorText: {
    color: "#9b1c1c",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  retryBannerBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#f8b4b4",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  retryBannerBtnText: {
    color: "#9b1c1c",
    fontSize: 14,
    fontWeight: "600",
  },
  floatingControlsRow: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 100,
  },
  floatingToolButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fffffc",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    elevation: 4,
    shadowColor: "#172c28",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  toolIconText: {
    fontSize: 16,
    color: "#1e8068",
    fontWeight: "700",
  },
  toolLabelText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#172c28",
  },
  dockWrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    zIndex: 90,
  },
  dockCard: {
    backgroundColor: "#fffffc",
    borderRadius: 22,
    padding: 18,
    elevation: 7,
    shadowColor: "#172c28",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
    gap: 8,
  },
  expandedSheet: {
    maxHeight: 540,
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d5ded8",
    alignSelf: "center",
    marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#172c28",
  },
  doneBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1e8068",
  },
  pointsList: {
    maxHeight: 360,
    marginVertical: 4,
  },
  pointRowWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: "#f0eee4",
  },
  pointRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  pointBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  pointBadgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  pointInfo: {
    flex: 1,
    flexShrink: 1,
    gap: 2,
  },
  pointKind: {
    fontSize: 11,
    fontWeight: "700",
    color: "#71827b",
    letterSpacing: 0.5,
  },
  pointName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#172c28",
  },
  pointMoreBtn: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#f4f3ec",
  },
  pointMoreIcon: {
    fontSize: 18,
    fontWeight: "700",
    color: "#172c28",
  },
  pointMenuPanel: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 38,
  },
  pointMenuBtn: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f4f3ec",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e3e0d5",
  },
  pointMenuBtnIcon: {
    fontSize: 14,
  },
  pointMenuBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#172c28",
  },
  pointMenuBtnDanger: {
    backgroundColor: "#fde8e8",
    borderColor: "#f8b4b4",
  },
  pointMenuBtnDangerText: {
    color: "#9b1c1c",
  },
  sheetBottomBar: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  mutedNote: {
    fontSize: 13,
    color: "#71827b",
    alignSelf: "center",
  },
  dockMicro: {
    fontSize: 12,
    fontWeight: "700",
    color: "#71827b",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  dockTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: "#172c28",
  },
  dockSub: {
    fontSize: 14,
    color: "#5b6b65",
    lineHeight: 20,
  },
  readyHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusChipReady: {
    backgroundColor: "#e8f5e9",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusChipReadyText: {
    color: "#2e7d32",
    fontSize: 12,
    fontWeight: "600",
  },
  statusChipRouting: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#e6f4ea",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusChipRoutingText: {
    color: "#1e8068",
    fontSize: 12,
    fontWeight: "600",
  },
  statusChipError: {
    backgroundColor: "#fde8e8",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusChipErrorText: {
    color: "#9b1c1c",
    fontSize: 12,
    fontWeight: "600",
  },
  readyMetricsRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 12,
    marginVertical: 4,
  },
  distancePrimary: {
    fontSize: 30,
    fontWeight: "800",
    color: "#172c28",
  },
  turnsSecondary: {
    fontSize: 15,
    fontWeight: "500",
    color: "#5b6b65",
  },
  dockActionsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
  },
  btnBase: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  btnSecondary: {
    backgroundColor: "#f4f3ec",
    borderWidth: 1,
    borderColor: "#e3e0d5",
  },
  btnSecondaryText: {
    color: "#172c28",
    fontSize: 15,
    fontWeight: "600",
  },
  btnPrimary: {
    backgroundColor: "#1e8068",
  },
  btnPrimaryText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  btnCoral: {
    backgroundColor: "#d84b35",
  },
  btnCoralText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  btnActiveLoop: {
    backgroundColor: "#e6f4ea",
    borderColor: "#b7dfc8",
  },
  btnActiveLoopText: {
    color: "#1e8068",
  },
  btnDisabled: {
    opacity: 0.5,
  },
  nameInput: {
    backgroundColor: "#f4f3ec",
    borderWidth: 1,
    borderColor: "#e3e0d5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#172c28",
    marginVertical: 4,
  },
  errorTextSmall: {
    color: "#9b1c1c",
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#fffffc",
    borderRadius: 20,
    padding: 22,
    gap: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: "#172c28",
  },
  modalMessage: {
    fontSize: 14,
    color: "#5b6b65",
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  modalBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnDanger: {
    backgroundColor: "#fde8e8",
  },
  modalBtnDangerText: {
    color: "#9b1c1c",
    fontSize: 15,
    fontWeight: "600",
  },
  modalBtnPrimary: {
    backgroundColor: "#1e8068",
  },
  modalBtnPrimaryText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
});
