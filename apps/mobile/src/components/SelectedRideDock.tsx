import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { DisplayRoute } from "../types";
import { validateRouteInstructions } from "../storage/local-route-storage";

export type SelectedRideDockProps = {
  route: DisplayRoute;
  onOpenLibrary: () => void;
  onStartNavigation: () => void;
  onPrepareDirections: () => void;
  onPreviewOriginal: () => void;
  onRevertPreparation: () => void;
  onRenameRide: (newName: string) => Promise<void>;
  onDeleteRide: () => Promise<void>;
  bottomInset?: number;
  onLayout?: (e: LayoutChangeEvent) => void;
};

export function SelectedRideDock({
  route,
  onOpenLibrary,
  onStartNavigation,
  onPrepareDirections,
  onPreviewOriginal,
  onRevertPreparation,
  onRenameRide,
  onDeleteRide,
  bottomInset = 16,
  onLayout,
}: SelectedRideDockProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState(route.document.name);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState(230);

  const busyRef = useRef(false);
  const targetRouteIdRef = useRef(route.id);

  // Sync draft and target on route change
  useEffect(() => {
    targetRouteIdRef.current = route.id;
    setRenameInput(route.document.name);
    setShowMenu(false);
    setShowRenameModal(false);
    setShowDeleteModal(false);
    setBusy(false);
    busyRef.current = false;
    setError(null);
  }, [route.id, route.document.name]);

  // Production hardware back press hierarchy for SelectedRideDock:
  // 1. If busy: block back to protect atomic writes
  // 2. If rename modal open: dismiss modal
  // 3. If delete modal open: dismiss modal
  // 4. If options menu open: dismiss menu first (do not clear route)
  useEffect(() => {
    if (!showMenu && !showRenameModal && !showDeleteModal) return;

    const onHardwareBack = () => {
      if (busyRef.current) {
        return true;
      }
      if (showRenameModal) {
        setShowRenameModal(false);
        return true;
      }
      if (showDeleteModal) {
        setShowDeleteModal(false);
        return true;
      }
      if (showMenu) {
        setShowMenu(false);
        return true;
      }
      return false;
    };

    const sub = BackHandler.addEventListener("hardwareBackPress", onHardwareBack);
    return () => sub.remove();
  }, [showMenu, showRenameModal, showDeleteModal]);

  const distance = route.distanceMeters ?? route.document.summary?.distanceMeters;
  const isImportedLocal =
    route.kind === "local" && (!route.sourceKind || route.sourceKind === "imported");
  const validation = validateRouteInstructions(route.document);
  const prep = route.preparationMetadata;
  const preparedStatus = prep?.status === "ready" || prep?.status === "partial";
  const coverageRows = prep?.outputCoverage ?? [];
  const coverageValid = coverageRows.length === route.document.segments.length &&
    new Set(coverageRows.map((row) => row.outputSegmentIndex)).size === route.document.segments.length &&
    coverageRows.every((row) => Number.isInteger(row.outputSegmentIndex) && row.outputSegmentIndex >= 0 && row.outputSegmentIndex < route.document.segments.length && (!row.guidanceAvailable || row.matched)) &&
    coverageRows.some((row) => row.guidanceAvailable && row.matched) &&
    (prep?.status !== "ready" || coverageRows.every((row) => row.guidanceAvailable && row.matched));
  const canNavigate = !route.previewingOriginal && validation.ready && (
    route.kind === "remote" || route.sourceKind === "created" ||
    (isImportedLocal && preparedStatus && coverageValid)
  );
  const isPartial = canNavigate && prep?.status === "partial";

  const handleDockLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) {
      setMeasuredHeight(h);
    }
    onLayout?.(e);
  };

  const handleConfirmRename = async () => {
    if (busyRef.current) return;
    const trimmed = renameInput.trim();
    if (!trimmed) {
      setError("Ride name cannot be empty.");
      return;
    }
    const capturedId = route.id;
    targetRouteIdRef.current = capturedId;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onRenameRide(trimmed);
      if (targetRouteIdRef.current === capturedId) {
        setShowRenameModal(false);
      }
    } catch (cause) {
      if (targetRouteIdRef.current === capturedId) {
        setError(cause instanceof Error ? cause.message : "Failed to rename ride.");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (busyRef.current) return;
    const capturedId = route.id;
    targetRouteIdRef.current = capturedId;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onDeleteRide();
      if (targetRouteIdRef.current === capturedId) {
        setShowDeleteModal(false);
      }
    } catch (cause) {
      if (targetRouteIdRef.current === capturedId) {
        setError(cause instanceof Error ? cause.message : "Failed to delete ride.");
      }
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      {/* Popover Options Menu with tap-outside dismiss */}
      {showMenu && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShowMenu(false)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss menu"
          />
          <View
            style={[
              styles.menuPopover,
              { bottom: measuredHeight + Math.max(bottomInset, 12) + 16 },
            ]}
          >
            <Pressable
              testID="button-rename-ride"
              accessibilityRole="button"
              accessibilityLabel="Rename ride"
              onPress={() => {
                setShowMenu(false);
                setRenameInput(route.document.name);
                setError(null);
                setShowRenameModal(true);
              }}
              style={styles.menuItem}
            >
              <Text style={styles.menuItemText}>Rename ride</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable
              testID="button-delete-ride"
              accessibilityRole="button"
              accessibilityLabel="Delete ride"
              onPress={() => {
                setShowMenu(false);
                setError(null);
                setShowDeleteModal(true);
              }}
              style={[styles.menuItem, styles.menuItemDelete]}
            >
              <Text style={styles.menuItemDeleteText}>Delete ride</Text>
            </Pressable>
            {route.activeVersionId && route.originalDocument && !route.recoveryAvailable && <>
              <View style={styles.menuDivider} />
              <Pressable accessibilityRole="button" accessibilityLabel={route.previewingOriginal ? "Preview prepared directions" : "Preview original GPX"} onPress={onPreviewOriginal} style={styles.menuItem}>
                <Text style={styles.menuItemText}>{route.previewingOriginal ? "Preview prepared directions" : "Preview original GPX"}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Revert to original GPX" onPress={onRevertPreparation} style={styles.menuItem}>
                <Text style={styles.menuItemText}>Revert to original GPX</Text>
              </Pressable>
            </>}
            {route.recoveryAvailable && <>
              <View style={styles.menuDivider} />
              <Pressable accessibilityRole="button" accessibilityLabel="Recover original GPX" onPress={onRevertPreparation} style={styles.menuItem}>
                <Text style={styles.menuItemText}>Recover original GPX</Text>
              </Pressable>
            </>}
          </View>
        </View>
      )}

      {/* Floating Selected Ride Dock Card */}
      <View
        onLayout={handleDockLayout}
        style={[
          styles.dock,
          { bottom: Math.max(bottomInset, 12) + 12 },
        ]}
      >
        {/* Title and Options */}
        <View style={styles.titleRow}>
          <View style={styles.titleGroup}>
            <Text style={styles.micro}>
              {route.kind === "remote"
                ? "SHARED ROUTE"
                : isImportedLocal
                ? "IMPORTED GPX"
                : "SAVED RIDE"}
            </Text>
            <Text testID="text-route-title" style={styles.title} numberOfLines={2}>
              {route.document.name}
            </Text>
          </View>
          {route.kind === "local" && (
            <Pressable
              testID="button-ride-options"
              accessibilityRole="button"
              accessibilityLabel="Ride options"
              onPress={() => setShowMenu((v) => !v)}
              style={styles.optionsButton}
            >
              <Text style={styles.optionsIcon}>⋯</Text>
            </Pressable>
          )}
        </View>

        {/* Metrics Row */}
        <View style={styles.metricsRow}>
          {typeof distance === "number" && (
            <Text testID="text-route-distance" style={styles.distance}>
              {(distance / 1000).toFixed(1)} <Text style={styles.distanceUnit}>km</Text>
            </Text>
          )}
          <View
            style={[
              styles.readyBadge,
              canNavigate ? styles.readyBadgeActive : styles.readyBadgePreview,
            ]}
          >
            <Text
              style={[
                styles.readyBadgeText,
                canNavigate ? styles.readyBadgeTextActive : styles.readyBadgeTextPreview,
              ]}
            >
              {isPartial ? "Partial directions" : canNavigate ? "Directions ready" : "Preview only"}
            </Text>
          </View>
        </View>

        {error && !showRenameModal && !showDeleteModal && (
          <View style={styles.errorBox}>
            <Text testID="text-route-error" style={styles.errorText}>
              {error}
            </Text>
          </View>
        )}

        {/* Guidance Notice if Turn-by-Turn Unavailable */}
        {!canNavigate && (
          <View testID="view-guidance-notice" style={styles.noticeBox}>
            <Text testID="text-guidance-notice" style={styles.noticeText}>
              {route.recoveryAvailable
                ? "Prepared directions could not be opened. The original GPX is available for recovery."
                : route.previewingOriginal
                ? "You are previewing the original GPX. Prepared directions remain saved."
                : isImportedLocal && prep?.status === "partial"
                ? "Some sections have no turn guidance. That warning remains accessible during navigation."
                : isImportedLocal
                ? "Preparing directions sends this GPX trace to the online matching service. Raw GPX imports stay preview only until you prepare them."
                : validation.reason ?? "Turn-by-turn directions are not ready for this route."}
            </Text>
          </View>
        )}

        {/* Actions Row */}
        <View style={styles.actions}>
          <Pressable
            testID="button-open-my-rides"
            accessibilityRole="button"
            accessibilityLabel="My rides"
            onPress={onOpenLibrary}
            style={[styles.button, styles.secondaryButton]}
          >
            <Text style={styles.secondaryButtonText}>≡ My rides</Text>
          </Pressable>
          {isImportedLocal && !route.recoveryAvailable && !route.activeVersionId && (
            <Pressable testID="button-prepare-directions" accessibilityRole="button" accessibilityLabel="Prepare directions online" onPress={onPrepareDirections} style={[styles.button, styles.primaryButton]}>
              <Text style={styles.primaryButtonText}>Prepare directions</Text>
            </Pressable>
          )}
          {canNavigate && (
            <Pressable
              testID="button-navigation-toggle"
              accessibilityRole="button"
              accessibilityLabel={route.kind === "remote" ? "Start navigation" : "Ride"}
              onPress={onStartNavigation}
              style={[styles.button, styles.primaryButton]}
            >
              <Text style={styles.primaryButtonText}>
                {isPartial ? "Ride with partial directions" : route.kind === "remote" ? "Start navigation" : "Ride"}
              </Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.footerNote}>
          {route.kind === "local"
            ? "Saved route data is offline · foreground guidance only · maps require network"
            : "Foreground guidance only · maps require network"}
        </Text>
      </View>

      {/* Rename Modal with internal busy guard and error display */}
      <Modal
        visible={showRenameModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busyRef.current) setShowRenameModal(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <ScrollView
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Rename Ride</Text>

              {error && (
                <View style={styles.modalErrorBox}>
                  <Text testID="text-route-error" style={styles.modalErrorText}>
                    {error}
                  </Text>
                </View>
              )}

              <TextInput
                testID="input-rename-ride-name"
                accessibilityLabel="Ride name"
                style={[styles.modalInput, busy && styles.inputDisabled]}
                value={renameInput}
                onChangeText={setRenameInput}
                editable={!busy}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={handleConfirmRename}
              />
              <View style={styles.modalActions}>
                <Pressable
                  testID="button-rename-cancel"
                  accessibilityRole="button"
                  accessibilityLabel="Cancel rename"
                  disabled={busy}
                  onPress={() => {
                    if (!busy) setShowRenameModal(false);
                  }}
                  style={[styles.modalButton, styles.modalCancelButton, busy && styles.buttonDisabled]}
                >
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  testID="button-rename-confirm"
                  accessibilityRole="button"
                  accessibilityLabel="Save name"
                  disabled={busy}
                  onPress={handleConfirmRename}
                  style={[styles.modalButton, styles.modalSaveButton, busy && styles.buttonDisabled]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.modalSaveButtonText}>Save name</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete Modal with internal busy guard and error display */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busyRef.current) setShowDeleteModal(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <ScrollView
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Delete this ride?</Text>

              {error && (
                <View style={styles.modalErrorBox}>
                  <Text testID="text-route-error" style={styles.modalErrorText}>
                    {error}
                  </Text>
                </View>
              )}

              <Text testID="text-delete-confirm-message" style={styles.deleteMessage}>
                Are you sure you want to delete "{route.document.name}"? This action cannot be undone.
              </Text>
              <View style={styles.modalActions}>
                <Pressable
                  testID="button-delete-cancel"
                  accessibilityRole="button"
                  accessibilityLabel="Cancel delete"
                  disabled={busy}
                  onPress={() => {
                    if (!busy) setShowDeleteModal(false);
                  }}
                  style={[styles.modalButton, styles.modalCancelButton, busy && styles.buttonDisabled]}
                >
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  testID="button-delete-confirm"
                  accessibilityRole="button"
                  accessibilityLabel="Delete ride"
                  disabled={busy}
                  onPress={handleConfirmDelete}
                  style={[styles.modalButton, styles.modalDeleteConfirmButton, busy && styles.buttonDisabled]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.modalDeleteConfirmButtonText}>Delete ride</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: "#fffffc",
    borderRadius: 24,
    padding: 18,
    shadowColor: "#12221b",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
    borderWidth: 1,
    borderColor: "rgba(27,62,49,0.08)",
  },
  menuPopover: {
    position: "absolute",
    right: 20,
    width: 160,
    backgroundColor: "#fffffc",
    borderRadius: 16,
    shadowColor: "#12221b",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 12,
    borderWidth: 1,
    borderColor: "rgba(27,62,49,0.12)",
    zIndex: 40,
    overflow: "hidden",
  },
  menuItem: {
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#172c28",
  },
  menuDivider: {
    height: 1,
    backgroundColor: "#ede9e0",
  },
  menuItemDelete: {
    backgroundColor: "#fffdfd",
  },
  menuItemDeleteText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#d84b35",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  titleGroup: {
    flex: 1,
    paddingRight: 10,
  },
  micro: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.9,
    color: "#1e8068",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 21,
    fontWeight: "800",
    color: "#172c28",
    lineHeight: 26,
  },
  optionsButton: {
    minWidth: 44,
    minHeight: 44,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f1f4ed",
    alignItems: "center",
    justifyContent: "center",
  },
  optionsIcon: {
    fontSize: 22,
    fontWeight: "800",
    color: "#172c28",
    lineHeight: 24,
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    marginBottom: 12,
  },
  distance: {
    fontSize: 27,
    fontWeight: "800",
    color: "#172c28",
  },
  distanceUnit: {
    fontSize: 15,
    fontWeight: "600",
    color: "#5a6860",
  },
  readyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  readyBadgeActive: {
    backgroundColor: "#e8f3ed",
    borderColor: "#c2ded0",
  },
  readyBadgePreview: {
    backgroundColor: "#f1f2e9",
    borderColor: "#d4ddd2",
  },
  readyBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  readyBadgeTextActive: {
    color: "#1e8068",
  },
  readyBadgeTextPreview: {
    color: "#5a6860",
  },
  noticeBox: {
    backgroundColor: "#f3f5ed",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#d9e2d5",
  },
  noticeText: {
    color: "#465e52",
    fontSize: 13,
    lineHeight: 18,
  },
  errorBox: {
    backgroundColor: "#fde8e8",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#f8b4b4",
  },
  errorText: {
    color: "#991b1b",
    fontSize: 13,
  },
  modalErrorBox: {
    backgroundColor: "#fde8e8",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#f8b4b4",
  },
  modalErrorText: {
    color: "#991b1b",
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
  },
  button: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: "#f1f2e9",
    borderWidth: 1,
    borderColor: "#d4ddd2",
  },
  secondaryButtonText: {
    color: "#254a3e",
    fontSize: 15,
    fontWeight: "700",
  },
  primaryButton: {
    flex: 1.2,
    backgroundColor: "#d84b35",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  footerNote: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 11,
    color: "#6b7280",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(18, 34, 27, 0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    width: "100%",
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fffffc",
    borderRadius: 20,
    padding: 22,
    shadowColor: "#12221b",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 10,
    borderWidth: 1,
    borderColor: "rgba(27,62,49,0.1)",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#172c28",
    marginBottom: 14,
  },
  modalInput: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: "#111827",
    marginBottom: 16,
  },
  inputDisabled: {
    backgroundColor: "#f3f4f6",
    color: "#9ca3af",
  },
  deleteMessage: {
    fontSize: 14,
    color: "#4b5563",
    lineHeight: 20,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalButton: {
    minHeight: 46,
    minWidth: 92,
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  modalCancelButton: {
    backgroundColor: "#f1f2e9",
  },
  modalCancelButtonText: {
    color: "#374151",
    fontWeight: "600",
    fontSize: 14,
  },
  modalSaveButton: {
    backgroundColor: "#29493e",
  },
  modalSaveButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  modalDeleteConfirmButton: {
    backgroundColor: "#d84b35",
  },
  modalDeleteConfirmButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
});
