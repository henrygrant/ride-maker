import { LocationAdapter } from "../adapters/location-types";
import { SpeechAdapter } from "../adapters/speech-types";
import { DIAGNOSTIC_CUE_SCHEDULE, getNextDueCue } from "./cue-schedule";
import { DiagnosticStorage } from "./storage";
import {
  BACKGROUND_DIAGNOSTICS_TASK,
  cancelInFlightTasks,
  getInFlightTaskCount,
  onInFlightTasksDrained,
  waitForInFlightTasks,
} from "./task-handler";
import { DiagnosticSession } from "./types";

// Serialized lifecycle lock to prevent concurrent start/stop races
let activeLifecycleOp: "starting" | "stopping" | null = null;

export function getActiveLifecycleOp(): "starting" | "stopping" | null {
  return activeLifecycleOp;
}

export async function startDiagnosticsSession(
  storage: DiagnosticStorage,
  locationAdapter: LocationAdapter,
  speechAdapter: SpeechAdapter,
  taskName: string = BACKGROUND_DIAGNOSTICS_TASK
): Promise<DiagnosticSession> {
  // Acquire lifecycle lock synchronously before first await
  if (activeLifecycleOp !== null) {
    throw new Error(
      `Cannot start session: a lifecycle operation (${activeLifecycleOp}) is already in progress.`
    );
  }
  activeLifecycleOp = "starting";

  let nativeTrackingAttempted = false;
  let sessionCreatedInStorage = false;
  let createdSessionId: string | null = null;
  const now = Date.now();
  const sessionId = `diag-${now}-${Math.random().toString(36).slice(2, 7)}`;
  createdSessionId = sessionId;

  try {
    // Check if background tracking is supported
    const isBgAvailable = await locationAdapter.isBackgroundLocationAvailableAsync();
    if (!isBgAvailable) {
      throw new Error("Background location tracking is not supported on this device.");
    }

    // Check and request permissions at time of start
    const currentPerms = await locationAdapter.getPermissionsAsync();
    if (currentPerms.foreground !== "granted") {
      const fgRes = await locationAdapter.requestForegroundPermissionsAsync();
      if (fgRes !== "granted") {
        throw new Error("Foreground location permission is required for diagnostics.");
      }
    }

    // Request background location permission
    if (currentPerms.background !== "granted") {
      const bgRes = await locationAdapter.requestBackgroundPermissionsAsync();
      if (bgRes !== "granted") {
        throw new Error("Background location permission is required for locked-screen tracking.");
      }
    }

    // Guard against starting if already active in storage or native tracking
    const existing = await storage.getSession();
    if (existing && (existing.status === "running" || existing.status === "stopping")) {
      let isTracking = false;
      try {
        isTracking = await locationAdapter.hasStartedLocationUpdatesAsync(taskName);
      } catch {
        isTracking = false;
      }
      if (isTracking || existing.status === "running") {
        throw new Error("A diagnostic session is already running.");
      }
    }

    const session: DiagnosticSession = {
      sessionId,
      version: 1,
      status: "running",
      startedAt: now,
      sampleCount: 0,
      spokenCueIds: [],
      cuesLog: [],
    };

    // 1. Start native background location updates
    nativeTrackingAttempted = true;
    await locationAdapter.startBackgroundLocationUpdatesAsync(taskName, {
      notificationTitle: "Ride Maker Diagnostics Active",
      notificationBody: "Tracking background location and scheduled voice cues.",
      notificationColor: "#ec4b35",
    });

    // 2. Prepare initial cue and persist running session
    const startCue = getNextDueCue(DIAGNOSTIC_CUE_SCHEDULE, 0, []);
    if (startCue) {
      session.spokenCueIds.push(startCue.id);
      session.lastSpokenCue = startCue.id;
      session.lastSpokenAt = now;
      session.cuesLog.push({
        id: startCue.id,
        instruction: startCue.instruction,
        timestamp: now,
        status: "attempted",
      });
    }

    let createdSession: DiagnosticSession;
    if (storage.createSession) {
      createdSession = await storage.createSession(session);
    } else {
      await storage.saveSession(session);
      createdSession = session;
    }
    sessionCreatedInStorage = true;

    // 3. Dispatch initial voice cue
    if (startCue) {
      await speechAdapter.speak(startCue.instruction, {
        onDone: () => {
          void (async () => {
            await storage.updateSession(sessionId, (s) => {
              const entry = s.cuesLog.find((c) => c.id === startCue.id);
              if (entry && entry.status === "attempted") {
                entry.status = "completed";
              }
            });
          })();
        },
        onError: (err) => {
          void (async () => {
            await storage.updateSession(sessionId, (s) => {
              const entry = s.cuesLog.find((c) => c.id === startCue.id);
              if (entry && entry.status === "attempted") {
                entry.status = "failed";
                entry.errorMessage = err.message;
              }
            });
          })();
        },
      });
    }

    return createdSession;
  } catch (err) {
    if (nativeTrackingAttempted) {
      if (createdSessionId) {
        cancelInFlightTasks(createdSessionId);
      }

      let cleanupError: Error | null = null;
      try {
        await locationAdapter.stopBackgroundLocationUpdatesAsync(taskName);
      } catch (cErr) {
        cleanupError = cErr instanceof Error ? cErr : new Error(String(cErr));
      }

      try {
        await speechAdapter.stop();
      } catch (sErr) {
        if (!cleanupError) {
          cleanupError = sErr instanceof Error ? sErr : new Error(String(sErr));
        }
      }

      const errorMsg = cleanupError
        ? `${err instanceof Error ? err.message : String(err)} (rollback teardown failed: ${cleanupError.message})`
        : err instanceof Error ? err.message : String(err);

      if (sessionCreatedInStorage && createdSessionId) {
        try {
          await storage.updateSession(createdSessionId, (s) => {
            s.status = "error";
            s.errorMessage = errorMsg;
          });
        } catch {
          // Storage failure during rollback
        }
      } else if (createdSessionId) {
        // Native startup was attempted: save error session so storage reflects error instead of remaining unrecorded
        try {
          const errorSession: DiagnosticSession = {
            sessionId: createdSessionId,
            version: 1,
            status: "error",
            startedAt: now,
            sampleCount: 0,
            spokenCueIds: [],
            cuesLog: [],
            errorMessage: errorMsg,
          };
          await storage.saveSession(errorSession);
        } catch {
          // Ignore storage failure
        }
      }

      if (cleanupError) {
        throw new Error(
          `${err instanceof Error ? err.message : String(err)} (rollback teardown failed: ${cleanupError.message})`
        );
      }
    }

    throw err;
  } finally {
    activeLifecycleOp = null;
  }
}

export async function stopDiagnosticsSession(
  storage: DiagnosticStorage,
  locationAdapter: LocationAdapter,
  speechAdapter: SpeechAdapter,
  taskName: string = BACKGROUND_DIAGNOSTICS_TASK,
  drainTimeoutMs: number = 2000
): Promise<DiagnosticSession | null> {
  // Acquire lifecycle lock synchronously before first await
  if (activeLifecycleOp !== null) {
    throw new Error(
      `Cannot stop session: a lifecycle operation (${activeLifecycleOp}) is already in progress.`
    );
  }
  activeLifecycleOp = "stopping";
  let stoppingSessionId: string | null = null;

  try {
    const current = await storage.getSession();
    if (!current) return null;

    // If already stopped, return current state
    if (current.status === "stopped" || current.status === "interrupted") {
      return current;
    }

    const targetSessionId = current.sessionId;
    stoppingSessionId = targetSessionId;

    // 1. Establish persisted non-running stopping barrier for target session
    // This immediately prevents any incoming fixes from claiming new samples or cues.
    const barrierSession = await storage.updateSession(targetSessionId, (s) => {
      s.status = "stopping";
    });

    let teardownError: Error | null = null;

    // Guard: Verify target session has not been superseded before touching native services
    const latestBeforeTeardown = await storage.getSession();
    if (latestBeforeTeardown && latestBeforeTeardown.sessionId !== targetSessionId) {
      return latestBeforeTeardown;
    }

    // 2. Stop native tracking - do NOT swallow failures
    try {
      await locationAdapter.stopBackgroundLocationUpdatesAsync(taskName);
    } catch (err) {
      teardownError = err instanceof Error ? err : new Error(String(err));
    }

    // 3. Stop speech adapter to silence/cancel any pending speech dispatch
    try {
      await speechAdapter.stop();
    } catch (err) {
      if (!teardownError) {
        teardownError = err instanceof Error ? err : new Error(String(err));
      }
    }

    // 4. Cancel and drain in-flight task work before final native silence
    cancelInFlightTasks(targetSessionId);
    try {
      await waitForInFlightTasks(drainTimeoutMs);
    } catch (err) {
      if (!teardownError) {
        teardownError = err instanceof Error ? err : new Error(String(err));
      }
    }

    // 5. Final native speech stop to guarantee silence after draining in-flight work
    try {
      await speechAdapter.stop();
    } catch (err) {
      if (!teardownError) {
        teardownError = err instanceof Error ? err : new Error(String(err));
      }
    }

    // 6. Commit final stopped or error state through a transaction on the latest current record
    const finalSession = await storage.updateSession(targetSessionId, (s) => {
      if (teardownError) {
        s.status = "error";
        s.errorMessage = teardownError.message;
      } else {
        s.status = "stopped";
        s.stoppedAt = Date.now();
      }
    });

    // 7. Surface teardown failure if any
    if (teardownError) {
      throw teardownError;
    }

    return finalSession ?? barrierSession ?? current;
  } finally {
    if (getInFlightTaskCount() > 0) {
      // In-flight dispatch is still active: retain lifecycle ownership until tasks drain
      onInFlightTasksDrained(async () => {
        try {
          await speechAdapter.stop();
        } catch (err) {
          if (stoppingSessionId) {
            try {
              await storage.updateSession(stoppingSessionId, (s) => {
                s.status = "error";
                s.errorMessage = `Final speech teardown failed: ${err instanceof Error ? err.message : String(err)}`;
              });
            } catch {
              // The existing teardown error remains visible if storage is unavailable.
            }
          }
        } finally {
          if (activeLifecycleOp === "stopping") {
            activeLifecycleOp = null;
          }
        }
      });
    } else {
      activeLifecycleOp = null;
    }
  }
}

export async function checkOrRecoverSession(
  storage: DiagnosticStorage,
  locationAdapter: LocationAdapter,
  taskName: string = BACKGROUND_DIAGNOSTICS_TASK
): Promise<DiagnosticSession | null> {
  // If a lifecycle operation (starting or stopping) is currently in progress,
  // do NOT interfere with it or overwrite its lifecycle state.
  if (activeLifecycleOp !== null) {
    return storage.getSession();
  }

  const session = await storage.getSession();
  if (!session) return null;

  if (activeLifecycleOp !== null) {
    return session;
  }

  // Only mark interrupted if the session was running and native tracking stopped unexpectedly
  if (session.status === "running") {
    let isTracking = false;
    try {
      isTracking = await locationAdapter.hasStartedLocationUpdatesAsync(taskName);
    } catch {
      isTracking = false;
    }

    if (activeLifecycleOp !== null) {
      return session;
    }

    if (!isTracking) {
      const recovered = await storage.updateSession(session.sessionId, (s) => {
        if (s.status === "running") {
          s.status = "interrupted";
          s.interruptedAt = Date.now();
        }
      });
      return recovered ?? session;
    }
  }

  return session;
}
