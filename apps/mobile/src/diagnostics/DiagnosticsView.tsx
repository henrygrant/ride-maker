import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ExpoLocationAdapter } from "../adapters/location";
import { LocationPermissionsStatus } from "../adapters/location-types";
import { ExpoSpeechAdapter } from "../adapters/speech";
import { DIAGNOSTIC_CUE_SCHEDULE } from "./cue-schedule";
import { FileSystemDiagnosticStorage } from "./file-storage";
import {
  checkOrRecoverSession,
  startDiagnosticsSession,
  stopDiagnosticsSession,
} from "./session";
import { buildDiagnosticSummary } from "./storage";
import { BACKGROUND_DIAGNOSTICS_TASK } from "./task-handler";
import { DiagnosticSession } from "./types";

const storage = new FileSystemDiagnosticStorage();
const locationAdapter = new ExpoLocationAdapter();
const speechAdapter = new ExpoSpeechAdapter();

export interface DiagnosticsViewProps {
  testVerified?: boolean;
  testSamplesReady?: boolean;
  onClearVerification?: () => void;
}

export function DiagnosticsView({
  testVerified,
  testSamplesReady,
  onClearVerification,
}: DiagnosticsViewProps = {}) {
  const isTestMode = process.env.EXPO_PUBLIC_TEST_MODE === "true";
  const [session, setSession] = useState<DiagnosticSession | null>(null);
  const [permissions, setPermissions] = useState<LocationPermissionsStatus | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(Date.now());
  const [snapshotCount, setSnapshotCount] = useState(0);

  const refreshState = useCallback(async () => {
    try {
      const perms = await locationAdapter.getPermissionsAsync();
      setPermissions(perms);

      const recovered = await checkOrRecoverSession(storage, locationAdapter);
      setSession(recovered);
      setSnapshotCount((prev) => prev + 1);

      const tracking = await locationAdapter.hasStartedLocationUpdatesAsync(
        BACKGROUND_DIAGNOSTICS_TASK
      );
      setIsTracking(tracking);
    } catch (err) {
      console.warn("Diagnostics refresh error:", err);
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  // Live timer tick every second while running, or continuously in test mode to guarantee fresh snapshots
  useEffect(() => {
    if (!isTestMode && session?.status !== "running") return;
    const interval = setInterval(() => {
      setTick(Date.now());
      void refreshState();
    }, 1000);
    return () => clearInterval(interval);
  }, [isTestMode, session?.status, refreshState]);

  const summary = useMemo(() => {
    return buildDiagnosticSummary(session, DIAGNOSTIC_CUE_SCHEDULE.length);
  }, [session, tick]);

  useEffect(() => {
    if (!isTestMode) return;
    const fixes = session?.sampleCount ?? 0;
    const cues = session?.spokenCueIds?.length ?? 0;
    const cueAttempts = session?.cuesLog?.length ?? 0;
    console.log(
      `[E2E_DIAG_STAGE] status="${session?.status ?? "none"}" isTracking=${isTracking} fixes=${fixes} cues=${cues} cueAttempts=${cueAttempts} snapshotCount=${snapshotCount}`
    );
  }, [
    isTestMode,
    session?.status,
    session?.sampleCount,
    session?.spokenCueIds?.length,
    session?.cuesLog?.length,
    isTracking,
    snapshotCount,
  ]);

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const newSession = await startDiagnosticsSession(
        storage,
        locationAdapter,
        speechAdapter
      );
      setSession(newSession);
      setIsTracking(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start diagnostics.");
    } finally {
      setBusy(false);
      void refreshState();
    }
  };

  const handleStop = async () => {
    setBusy(true);
    setError(null);
    try {
      const stoppedSession = await stopDiagnosticsSession(
        storage,
        locationAdapter,
        speechAdapter
      );
      setSession(stoppedSession);
      setIsTracking(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop diagnostics.");
    } finally {
      setBusy(false);
      void refreshState();
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setError(null);
    try {
      await storage.clear();
      setSession(null);
      onClearVerification?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear data.");
    } finally {
      setBusy(false);
      void refreshState();
    }
  };

  const formatElapsed = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const isRunning = session?.status === "running" && isTracking;
  const needsStop = isTracking || session?.status === "stopping" || session?.status === "error";
  const isInterrupted = session?.status === "interrupted";
  const sessionError = session?.errorMessage;

  return (
    <ScrollView testID="view-diagnostics-scroll" style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerBox}>
        <Text testID="text-diagnostics-title" style={styles.title}>Background Spike Diagnostics</Text>
        <Text style={styles.subtitle}>
          Exercises locked-screen background GPS tracking and scheduled speech cues for
          Milestone 0 feasibility.
        </Text>
      </View>

      {isInterrupted && (
        <View testID="alert-interrupted" style={styles.interruptedAlert}>
          <Text style={styles.alertTitle}>⚠️ Interrupted Session Detected</Text>
          <Text style={styles.alertBody}>
            The previous session was halted because the app was closed or killed before
            stopping cleanly. Tracking and speech did not continue while closed.
          </Text>
        </View>
      )}

      {isTestMode && testSamplesReady && (
        <Text testID="test-samples-ready">SAMPLES_CONFIRMED</Text>
      )}
      {isTestMode && testVerified && (
        <View testID="test-verification-signal" style={styles.verifiedAlert}>
          <Text>VERIFICATION_COMPLETE</Text>
        </View>
      )}

      {(error || sessionError) && (
        <View testID="banner-diagnostics-error" style={styles.errorBox}>
          <Text testID="text-diagnostics-error" style={styles.errorText}>{error ?? sessionError}</Text>
        </View>
      )}

      {/* Permissions Card */}
      <View testID="card-permissions" style={styles.card}>
        <Text style={styles.cardHeader}>Permission Status</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Foreground Location:</Text>
          <Text
            testID="badge-foreground-permission"
            style={[
              styles.badge,
              permissions?.foreground === "granted" ? styles.badgeSuccess : styles.badgeMuted,
            ]}
          >
            {permissions?.foreground ?? "checking..."}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Background Location:</Text>
          <Text
            testID="badge-background-permission"
            style={[
              styles.badge,
              permissions?.background === "granted" ? styles.badgeSuccess : styles.badgeMuted,
            ]}
          >
            {permissions?.background ?? "checking..."}
          </Text>
        </View>
        <Text style={styles.cardHint}>
          Permissions are requested when you tap &quot;Start Diagnostics&quot;. Android uses a
          persistent foreground service notification while tracking.
        </Text>
      </View>

      {/* Session Controls */}
      <View testID="card-session-controls" style={styles.card}>
        <Text style={styles.cardHeader}>Diagnostic Session Control</Text>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Current State:</Text>
          <Text
            testID="text-diagnostics-state"
            style={[
              styles.statusText,
              isRunning
                ? styles.textRunning
                : isInterrupted
                ? styles.textInterrupted
                : session?.status === "error"
                ? styles.textError
                : styles.textMuted,
            ]}
          >
            {isRunning
              ? "RUNNING (Background Tracking Active)"
              : isInterrupted
              ? "INTERRUPTED"
              : session?.status === "error"
              ? "ERROR"
              : session?.status === "stopping"
              ? "STOPPING"
              : session?.status === "stopped"
              ? "STOPPED"
              : "IDLE"}
          </Text>
        </View>

        <View style={styles.buttonRow}>
          {needsStop ? (
            <Pressable
              testID="button-diagnostics-stop"
              accessibilityRole="button"
              accessibilityLabel="Stop Diagnostics"
              onPress={handleStop}
              disabled={busy}
              style={[styles.button, styles.buttonStop]}
            >
              <Text style={styles.buttonText}>
                {busy ? "Stopping..." : "Stop Diagnostics"}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              testID="button-diagnostics-start"
              accessibilityRole="button"
              accessibilityLabel="Start Diagnostics"
              onPress={handleStart}
              disabled={busy}
              style={[styles.button, styles.buttonStart]}
            >
              <Text style={styles.buttonText}>
                {busy ? "Starting..." : "Start Diagnostics (20-min Spike)"}
              </Text>
            </Pressable>
          )}

          <Pressable
            testID="button-diagnostics-clear"
              accessibilityRole="button"
              accessibilityLabel="Clear Data"
              onPress={handleClear}
            disabled={busy || needsStop}
            style={[styles.button, styles.buttonSecondary]}
          >
            <Text style={styles.buttonSecondaryText}>Clear Data</Text>
          </Pressable>
        </View>
      </View>

      {/* Metrics Card */}
      {summary && (
        <View testID="card-metrics" style={styles.card}>
          <Text style={styles.cardHeader}>GPS Intervals &amp; Counts</Text>
          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Elapsed Time</Text>
              <Text style={styles.gridValue}>{formatElapsed(summary.elapsedSeconds)}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Fixes Recorded</Text>
              <Text testID="text-metrics-fixes" style={styles.gridValue}>{summary.sampleCount}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Last Accuracy</Text>
              <Text style={styles.gridValue}>
                {summary.lastSampleAccuracy !== undefined
                  ? `±${summary.lastSampleAccuracy.toFixed(1)} m`
                  : "—"}
              </Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Avg Interval</Text>
              <Text style={styles.gridValue}>
                {summary.avgIntervalMs !== undefined
                  ? `${summary.avgIntervalMs} ms`
                  : "—"}
              </Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Min Interval</Text>
              <Text style={styles.gridValue}>
                {summary.minIntervalMs !== undefined
                  ? `${summary.minIntervalMs} ms`
                  : "—"}
              </Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Max Interval Gap</Text>
              <Text style={styles.gridValue}>
                {summary.maxIntervalMs !== undefined
                  ? `${summary.maxIntervalMs} ms`
                  : "—"}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Cue Schedule Card */}
      <View testID="card-cues" style={styles.card}>
        <Text style={styles.cardHeader}>
          Voice Cue Schedule ({summary?.completedCueCount ?? 0} Completed /{" "}
          {DIAGNOSTIC_CUE_SCHEDULE.length} Scheduled)
        </Text>
        <Text style={styles.cardHint}>
          Voice cues trigger based on elapsed time without requiring React UI state. Note:
          &quot;✓&quot; indicates native speech callback resolved; it does not replace the
          rider&apos;s physical confirmation of audibility.
        </Text>

        <View style={styles.cueList}>
          {DIAGNOSTIC_CUE_SCHEDULE.map((cue) => {
            const entry = session?.cuesLog.find((c) => c.id === cue.id);
            const status = entry?.status;
            const isCompleted = status === "completed";
            const isAttempted = status === "attempted";
            const isSkipped = status === "skipped";
            const isFailed = status === "failed";

            let icon = "○";
            let statusLabel = "Pending";
            let iconStyle = styles.cueIconPending;

            if (isCompleted) {
              icon = "✓";
              statusLabel = "Completed";
              iconStyle = styles.cueIconCompleted;
            } else if (isAttempted) {
              icon = "▶";
              statusLabel = "Dispatched";
              iconStyle = styles.cueIconAttempted;
            } else if (isSkipped) {
              icon = "⊘";
              statusLabel = "Skipped (stale)";
              iconStyle = styles.cueIconSkipped;
            } else if (isFailed) {
              icon = "✕";
              statusLabel = "Failed";
              iconStyle = styles.cueIconFailed;
            }

            return (
              <View testID={`cue-item-${cue.id}`} key={cue.id} style={styles.cueRow}>
                <Text style={iconStyle}>{icon}</Text>
                <View style={styles.cueDetails}>
                  <View style={styles.cueHeaderRow}>
                    <Text
                      style={[
                        styles.cueTime,
                        (isCompleted || isAttempted) && styles.cueTimeActive,
                      ]}
                    >
                      {formatElapsed(cue.triggerElapsedSeconds)} ({cue.id})
                    </Text>
                    <Text
                      style={[
                        styles.cueStatusBadge,
                        isCompleted
                          ? styles.statusBadgeCompleted
                          : isAttempted
                          ? styles.statusBadgeAttempted
                          : isSkipped
                          ? styles.statusBadgeSkipped
                          : isFailed
                          ? styles.statusBadgeFailed
                          : styles.statusBadgePending,
                      ]}
                    >
                      {statusLabel}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.cueText,
                      isCompleted && styles.cueTextCompleted,
                    ]}
                  >
                    {cue.instruction}
                  </Text>
                  {entry?.errorMessage && (
                    <Text style={styles.cueError}>{entry.errorMessage}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerNote}>
          Privacy constraint: GPS coordinates are stored locally in the private app sandbox
          (bounded to 2,000 samples) and are never uploaded or committed to Git.
        </Text>
      </View>

      {busy && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#ec4b35" size="large" />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  verifiedAlert: { backgroundColor: "#d1e7dd", padding: 12, marginBottom: 16 },
  container: {
    flex: 1,
    backgroundColor: "#f7f7f8",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  headerBox: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
  },
  interruptedAlert: {
    backgroundColor: "#fff3cd",
    borderColor: "#ffeeba",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#856404",
    marginBottom: 4,
  },
  alertBody: {
    fontSize: 12,
    color: "#856404",
    lineHeight: 16,
  },
  errorBox: {
    backgroundColor: "#f8d7da",
    borderColor: "#f5c6cb",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    color: "#721c24",
    fontSize: 13,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 10,
  },
  cardHint: {
    fontSize: 12,
    color: "#777",
    marginTop: 8,
    lineHeight: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  label: {
    fontSize: 13,
    color: "#444",
  },
  badge: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
    textTransform: "uppercase",
  },
  badgeSuccess: {
    backgroundColor: "#e6f4ea",
    color: "#137333",
  },
  badgeMuted: {
    backgroundColor: "#f1f3f4",
    color: "#5f6368",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "700",
  },
  textRunning: {
    color: "#137333",
  },
  textInterrupted: {
    color: "#b06000",
  },
  textError: {
    color: "#d93025",
  },
  textMuted: {
    color: "#5f6368",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonStart: {
    backgroundColor: "#137333",
  },
  buttonStop: {
    backgroundColor: "#d93025",
  },
  buttonSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#ccc",
    flex: 0.6,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
  buttonSecondaryText: {
    color: "#444",
    fontWeight: "600",
    fontSize: 13,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  gridItem: {
    width: "47%",
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 8,
  },
  gridLabel: {
    fontSize: 11,
    color: "#666",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  gridValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111",
  },
  cueList: {
    marginTop: 8,
  },
  cueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  cueIconCompleted: {
    fontSize: 14,
    color: "#137333",
    fontWeight: "700",
    width: 22,
    marginTop: 2,
  },
  cueIconAttempted: {
    fontSize: 14,
    color: "#1a73e8",
    fontWeight: "700",
    width: 22,
    marginTop: 2,
  },
  cueIconSkipped: {
    fontSize: 14,
    color: "#888",
    width: 22,
    marginTop: 2,
  },
  cueIconFailed: {
    fontSize: 14,
    color: "#d93025",
    fontWeight: "700",
    width: 22,
    marginTop: 2,
  },
  cueIconPending: {
    fontSize: 14,
    color: "#ccc",
    width: 22,
    marginTop: 2,
  },
  cueDetails: {
    flex: 1,
  },
  cueHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cueTime: {
    fontSize: 12,
    fontWeight: "600",
    color: "#555",
  },
  cueTimeActive: {
    color: "#111",
  },
  cueStatusBadge: {
    fontSize: 10,
    fontWeight: "600",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  statusBadgeCompleted: {
    backgroundColor: "#e6f4ea",
    color: "#137333",
  },
  statusBadgeAttempted: {
    backgroundColor: "#e8f0fe",
    color: "#1a73e8",
  },
  statusBadgeSkipped: {
    backgroundColor: "#f1f3f4",
    color: "#5f6368",
  },
  statusBadgeFailed: {
    backgroundColor: "#fce8e6",
    color: "#d93025",
  },
  statusBadgePending: {
    backgroundColor: "#f8f9fa",
    color: "#9aa0a6",
  },
  cueText: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  cueTextCompleted: {
    color: "#222",
  },
  cueError: {
    fontSize: 11,
    color: "#d93025",
    marginTop: 2,
  },
  footerBox: {
    marginTop: 8,
    padding: 8,
  },
  footerNote: {
    fontSize: 11,
    color: "#888",
    textAlign: "center",
    lineHeight: 15,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
});
