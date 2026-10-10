import { DIAGNOSTIC_CUE_SCHEDULE, getNextDueCue } from "./cue-schedule";
import { DiagnosticStorage } from "./storage";
import { SpeechAdapter } from "../adapters/speech-types";
import { DiagnosticCue } from "./types";

export const BACKGROUND_DIAGNOSTICS_TASK = "ride-maker-diagnostic-location";

// Max delay in seconds for a cue to still be considered fresh enough to speak
const MAX_CUE_STALENESS_SECONDS = 45;

export interface DiagnosticLocationFix {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
  };
  timestamp: number;
}

// In-flight callback tracking and cancellation
let inFlightCount = 0;
const inFlightDrainedCallbacks: Array<() => void | Promise<void>> = [];
const taskAbortControllers = new Map<string, AbortController>();

export function getTaskAbortSignal(sessionId: string): AbortSignal {
  let c = taskAbortControllers.get(sessionId);
  if (!c) {
    c = new AbortController();
    taskAbortControllers.set(sessionId, c);
  }
  return c.signal;
}

export function cancelInFlightTasks(sessionId: string): void {
  const c = taskAbortControllers.get(sessionId);
  if (c) {
    c.abort();
    taskAbortControllers.delete(sessionId);
  }
}

export function getInFlightTaskCount(): number {
  return inFlightCount;
}

export function waitForInFlightTasks(timeoutMs: number = 2000): Promise<void> {
  if (inFlightCount === 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let drainedCb: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (drainedCb) {
        const idx = inFlightDrainedCallbacks.indexOf(drainedCb);
        if (idx !== -1) {
          inFlightDrainedCallbacks.splice(idx, 1);
        }
      }
      reject(
        new Error(
          `In-flight diagnostics tasks failed to drain within ${timeoutMs}ms.`
        )
      );
    }, timeoutMs);
    drainedCb = () => {
      clearTimeout(timer);
      resolve();
    };
    inFlightDrainedCallbacks.push(drainedCb);
  });
}

export function onInFlightTasksDrained(cb: () => void | Promise<void>): void {
  if (inFlightCount === 0) {
    void cb();
  } else {
    inFlightDrainedCallbacks.push(() => {
      void cb();
    });
  }
}

function notifyInFlightDrained(): void {
  if (inFlightCount === 0) {
    while (inFlightDrainedCallbacks.length > 0) {
      const cb = inFlightDrainedCallbacks.shift();
      try {
        const res = cb?.();
        if (res && typeof (res as Promise<unknown>).catch === "function") {
          (res as Promise<unknown>).catch(() => {});
        }
      } catch {
        // Safe catch
      }
    }
  }
}

export async function handleDiagnosticLocations(
  locations: DiagnosticLocationFix[],
  storage: DiagnosticStorage,
  speech: SpeechAdapter
): Promise<void> {
  if (locations.length === 0) return;

  const session = await storage.getSession();
  if (!session || session.status !== "running") {
    return;
  }

  const sessionId = session.sessionId;
  const signal = getTaskAbortSignal(sessionId);
  if (signal.aborted) return;

  // Sort locations chronologically
  const sorted = [...locations].sort((a, b) => a.timestamp - b.timestamp);

  // Filter out fixes timestamped before this session started
  const validLocations = sorted.filter((loc) => loc.timestamp >= session.startedAt);
  if (validLocations.length === 0) return;

  for (const loc of validLocations) {
    if (signal.aborted) return;
    // Record sample carrying originating sessionId inside storage lock
    await storage.recordSample(
      {
        timestamp: loc.timestamp,
        accuracy: loc.coords.accuracy ?? null,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        speed: loc.coords.speed ?? null,
        heading: loc.coords.heading ?? null,
      },
      sessionId
    );
  }

  if (signal.aborted) return;

  const lastFix = validLocations[validLocations.length - 1];
  if (!lastFix) return;
  const latestTimestamp = lastFix.timestamp;

  // Atomically evaluate and claim due cues inside storage lock
  let claimedCue: DiagnosticCue | null = null;

  await storage.updateSession(sessionId, (s) => {
    if (s.status !== "running" || signal.aborted) return;

    const elapsedSeconds = Math.max(
      0,
      Math.floor((latestTimestamp - s.startedAt) / 1000)
    );

    // Evaluate and skip backlog cues
    let candidate = getNextDueCue(
      DIAGNOSTIC_CUE_SCHEDULE,
      elapsedSeconds,
      s.spokenCueIds
    );

    while (
      candidate &&
      elapsedSeconds - candidate.triggerElapsedSeconds > MAX_CUE_STALENESS_SECONDS
    ) {
      s.spokenCueIds.push(candidate.id);
      s.cuesLog.push({
        id: candidate.id,
        instruction: candidate.instruction,
        timestamp: Date.now(),
        status: "skipped",
        errorMessage: `Skipped: fix backlog elapsed ${elapsedSeconds}s vs scheduled ${candidate.triggerElapsedSeconds}s`,
      });
      candidate = getNextDueCue(
        DIAGNOSTIC_CUE_SCHEDULE,
        elapsedSeconds,
        s.spokenCueIds
      );
    }

    if (!candidate) return;

    // Atomically claim the due cue
    claimedCue = candidate;
    s.spokenCueIds.push(candidate.id);
    s.lastSpokenCue = candidate.id;
    s.lastSpokenAt = Date.now();
    s.cuesLog.push({
      id: candidate.id,
      instruction: candidate.instruction,
      timestamp: Date.now(),
      status: "attempted",
    });
  });

  if (!claimedCue || signal.aborted) return;
  const dueCue: DiagnosticCue = claimedCue;

  // Verify session has not been stopped before dispatching audio
  const confirmedSession = await storage.getSession();
  if (
    !confirmedSession ||
    confirmedSession.status !== "running" ||
    confirmedSession.sessionId !== sessionId ||
    signal.aborted
  ) {
    return;
  }

  inFlightCount += 1;
  try {
    // Dispatch speech with completion callbacks carrying originating sessionId
    await speech.speak(dueCue.instruction, {
      onDone: () => {
        void (async () => {
          await storage.updateSession(sessionId, (s) => {
            const entry = s.cuesLog.find((c) => c.id === dueCue.id);
            if (entry && entry.status === "attempted") {
              entry.status = "completed";
            }
          });
        })();
      },
      onError: (err) => {
        void (async () => {
          await storage.updateSession(sessionId, (s) => {
            const entry = s.cuesLog.find((c) => c.id === dueCue.id);
            if (entry && entry.status === "attempted") {
              entry.status = "failed";
              entry.errorMessage = err.message;
            }
          });
        })();
      },
    });
  } finally {
    inFlightCount = Math.max(0, inFlightCount - 1);
    notifyInFlightDrained();
  }
}
