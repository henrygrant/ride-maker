import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Camera, GeoJSONSource, Layer, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import type { DisplayRoute } from "../types";
import { routeGeometry } from "../route-view";
import { validateRouteInstructions } from "../storage/local-route-storage";

export type RideDetailScreenProps = {
  route: DisplayRoute;
  onBack: () => void;
  onStartNavigation: () => void;
  onRenameRide: (newName: string) => Promise<void>;
  onDeleteRide: () => Promise<void>;
  isTestMode?: boolean;
  testMapRendered?: boolean;
  onMapRendered?: () => void;
};

export function RideDetailScreen({
  route,
  onBack,
  onStartNavigation,
  onRenameRide,
  onDeleteRide,
  isTestMode,
  testMapRendered,
  onMapRendered,
}: RideDetailScreenProps) {
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState(route.document.name);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cameraRef = useRef<CameraRef>(null);

  const geometry = routeGeometry(route.document);
  const distance = route.distanceMeters ?? route.document.summary?.distanceMeters;

  const isImportedLocal =
    route.kind === "local" && (!route.sourceKind || route.sourceKind === "imported");
  const validation = validateRouteInstructions(route.document);
  const canNavigate = !isImportedLocal && validation.ready;

  useEffect(() => {
    setRenameInput(route.document.name);
  }, [route.document.name]);

  // Hardware back press handling
  useEffect(() => {
    const onHardwareBack = () => {
      if (showRenameModal) {
        setShowRenameModal(false);
        return true;
      }
      if (showDeleteModal) {
        setShowDeleteModal(false);
        return true;
      }
      onBack();
      return true;
    };

    const sub = BackHandler.addEventListener("hardwareBackPress", onHardwareBack);
    return () => sub.remove();
  }, [showRenameModal, showDeleteModal, onBack]);

  const handleConfirmRename = async () => {
    const trimmed = renameInput.trim();
    if (!trimmed) {
      setError("Ride name cannot be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRenameRide(trimmed);
      setShowRenameModal(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to rename ride.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDeleteRide();
      setShowDeleteModal(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete ride.");
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable testID="button-back" accessibilityRole="button" accessibilityLabel="Back to rides"
        onPress={onBack} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 20 }}>
        <Text style={{ color: "#ec4b35", fontSize: 16, fontWeight: "600" }}>‹ My rides</Text>
      </Pressable>
      <View style={styles.routeHeader}>
        <View style={styles.titleRow}>
          <Text testID="text-route-title" style={styles.routeTitle}>
            {route.document.name}
          </Text>
          {route.kind === "local" && (
            <View style={styles.headerActions}>
              <Pressable
                testID="button-rename-ride"
                accessibilityRole="button"
                accessibilityLabel="Rename ride"
                onPress={() => {
                  setRenameInput(route.document.name);
                  setError(null);
                  setShowRenameModal(true);
                }}
                style={styles.actionBtn}
              >
                <Text style={styles.actionBtnText}>Rename</Text>
              </Pressable>
              <Pressable
                testID="button-delete-ride"
                accessibilityRole="button"
                accessibilityLabel="Delete ride"
                onPress={() => {
                  setError(null);
                  setShowDeleteModal(true);
                }}
                style={[styles.actionBtn, styles.deleteBtn]}
              >
                <Text style={styles.deleteBtnText}>Delete</Text>
              </Pressable>
            </View>
          )}
        </View>

        {typeof distance === "number" && (
          <Text testID="text-route-distance" style={styles.muted}>
            {(distance / 1000).toFixed(1)} km
          </Text>
        )}
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text testID="text-route-error" style={styles.errorText}>
            {error}
          </Text>
        </View>
      )}

      {!canNavigate && (
        <View testID="view-guidance-notice" style={styles.noticeBox}>
          <Text testID="text-guidance-notice" style={styles.noticeText}>
            {isImportedLocal
              ? "Turn-by-turn guidance is not available for raw GPX imports."
              : validation.reason ?? "Turn-by-turn directions are not ready for this route."}
          </Text>
        </View>
      )}

      {isTestMode && testMapRendered && <Text testID="test-map-rendered">MAP_RENDERED</Text>}
      <View testID="view-map" style={styles.mapContainer}>
        <Map
          mapStyle="https://tiles.openfreemap.org/styles/liberty"
          style={styles.map}
          onDidFinishRenderingMapFully={onMapRendered ? () => onMapRendered() : () => {}}
        >
          <Camera
            key={route.id}
            ref={cameraRef}
            initialViewState={
              geometry?.bounds
                ? { bounds: geometry.bounds, padding: { top: 40, right: 40, bottom: 40, left: 40 } }
                : { center: [-73.9866, 40.7306], zoom: 10 }
            }
          />
          {geometry && (
            <GeoJSONSource id="route" data={geometry.shape}>
              <Layer id="route-casing" type="line" paint={{ "line-color": "#ffffff", "line-width": 8 }} />
              <Layer id="route-line" type="line" paint={{ "line-color": "#ec4b35", "line-width": 5 }} />
            </GeoJSONSource>
          )}
        </Map>
      </View>

      <View style={styles.navigationBar}>
        {canNavigate && (
          <Pressable
            testID="button-navigation-toggle"
            accessibilityRole="button"
            accessibilityLabel="Start navigation"
            onPress={onStartNavigation}
            style={[styles.button, styles.navigationButton]}
          >
            <Text style={styles.buttonText}>
              {route.kind === "remote" ? "Start navigation" : "Ride"}
            </Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.footer}>
        {route.kind === "local"
          ? "Saved route data is offline · foreground guidance only · maps require network"
          : "Foreground guidance only · maps require network"}
      </Text>

      {busy && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#ec4b35" size="large" />
        </View>
      )}

      {/* Rename Modal */}
      <Modal
        visible={showRenameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRenameModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Rename Ride</Text>
            <TextInput
              testID="input-rename-ride-name"
              style={styles.modalInput}
              value={renameInput}
              onChangeText={setRenameInput}
              placeholder="Ride name"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <Pressable
                testID="button-rename-cancel"
                accessibilityRole="button"
                accessibilityLabel="Cancel rename"
                onPress={() => setShowRenameModal(false)}
                style={[styles.modalBtn, styles.cancelBtn]}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="button-rename-confirm"
                accessibilityRole="button"
                accessibilityLabel="Confirm rename"
                onPress={() => void handleConfirmRename()}
                disabled={busy || !renameInput.trim()}
                style={[styles.modalBtn, styles.confirmBtn, (!renameInput.trim() || busy) && styles.disabledBtn]}
              >
                <Text style={styles.confirmBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Delete this ride?</Text>
            <Text testID="text-delete-confirm-message" style={styles.modalMessage}>
              Are you sure you want to delete "{route.document.name}"?
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                testID="button-delete-cancel"
                accessibilityRole="button"
                accessibilityLabel="Cancel delete"
                onPress={() => setShowDeleteModal(false)}
                style={[styles.modalBtn, styles.cancelBtn]}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="button-delete-confirm"
                accessibilityRole="button"
                accessibilityLabel="Confirm delete"
                onPress={() => void handleConfirmDelete()}
                disabled={busy}
                style={[styles.modalBtn, styles.deleteConfirmBtn, busy && styles.disabledBtn]}
              >
                <Text style={styles.deleteConfirmBtnText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f6f1" },
  routeHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e1d8",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  routeTitle: { fontSize: 20, fontWeight: "700", color: "#1b2521", flex: 1 },
  headerActions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#e5e1d8",
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  actionBtnText: { color: "#1b2521", fontSize: 13, fontWeight: "600" },
  deleteBtn: { backgroundColor: "#fee2e2" },
  deleteBtnText: { color: "#dc2626", fontSize: 13, fontWeight: "600" },
  muted: { color: "#616c66", fontSize: 13 },
  noticeBox: {
    marginHorizontal: 20,
    marginTop: 10,
    padding: 10,
    backgroundColor: "#fef3c7",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  noticeText: { color: "#92400e", fontSize: 13, lineHeight: 18 },
  errorBox: {
    marginHorizontal: 20,
    marginTop: 10,
    padding: 10,
    backgroundColor: "#fee2e2",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#fca5a5",
  },
  errorText: { color: "#dc2626", fontSize: 13 },
  mapContainer: { flex: 1, margin: 16, borderRadius: 10, overflow: "hidden" },
  map: { flex: 1 },
  navigationBar: { paddingHorizontal: 20, paddingBottom: 12 },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  navigationButton: { backgroundColor: "#ec4b35" },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    fontSize: 12,
    color: "#7a857f",
    textAlign: "center",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(255,255,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    width: "100%",
    maxWidth: 340,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#1b2521", marginBottom: 12 },
  modalInput: {
    backgroundColor: "#f8f6f1",
    borderWidth: 1,
    borderColor: "#ddd9d0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 16,
    minHeight: 44,
  },
  modalMessage: { fontSize: 14, color: "#4b5563", lineHeight: 20, marginBottom: 18 },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  cancelBtn: { backgroundColor: "#f3f4f6" },
  cancelBtnText: { color: "#4b5563", fontSize: 14, fontWeight: "600" },
  confirmBtn: { backgroundColor: "#1b2521" },
  confirmBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  deleteConfirmBtn: { backgroundColor: "#dc2626" },
  deleteConfirmBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  disabledBtn: { opacity: 0.5 },
});
