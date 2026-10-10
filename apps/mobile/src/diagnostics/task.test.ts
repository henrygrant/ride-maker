import { describe, expect, it } from "vitest";
import { SpeechAdapter } from "../adapters/speech-types";
import { InMemoryDiagnosticStorage } from "./storage";
import { handleDiagnosticLocations, DiagnosticLocationFix } from "./task-handler";
import { DiagnosticSession } from "./types";

class MockSpeechAdapter implements SpeechAdapter {
  spoken: string[] = [];
  stopped = false;

  async speak(text: string, options?: { onDone?: () => void; onError?: (err: Error) => void }): Promise<void> {
    this.spoken.push(text);
    options?.onDone?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async isSpeakingAsync(): Promise<boolean> {
    return false;
  }
}

function createLocationObject(
  timestamp: number,
  latitude = 40.71,
  longitude = -74.00
): DiagnosticLocationFix {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 6,
      heading: 90,
      speed: 4.5,
    },
    timestamp,
  };
}

describe("task handleDiagnosticLocations", () => {
  it("processes locations and triggers cues when due", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const speech = new MockSpeechAdapter();

    const session: DiagnosticSession = {
      sessionId: "test-task",
      version: 1,
      status: "running",
      startedAt: 10000,
      sampleCount: 0,
      spokenCueIds: ["diag-start"],
      cuesLog: [],
    };
    await storage.saveSession(session);

    // Provide fix at 10s (elapsed 0s -> no new cue due)
    await handleDiagnosticLocations([createLocationObject(10000)], storage, speech);
    expect(speech.spoken).toHaveLength(0);

    let currentSession = await storage.getSession();
    expect(currentSession?.sampleCount).toBe(1);

    // Provide fix at 45s (elapsed 35s -> diag-30s cue due)
    await handleDiagnosticLocations([createLocationObject(45000)], storage, speech);
    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0]).toContain("thirty seconds elapsed");

    currentSession = await storage.getSession();
    expect(currentSession?.sampleCount).toBe(2);
    expect(currentSession?.spokenCueIds).toContain("diag-30s");
    expect(currentSession?.lastSpokenCue).toBe("diag-30s");
  });

  it("does not process locations or speak if session is stopped", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const speech = new MockSpeechAdapter();

    const session: DiagnosticSession = {
      sessionId: "stopped-task",
      version: 1,
      status: "stopped",
      startedAt: 10000,
      stoppedAt: 20000,
      sampleCount: 5,
      spokenCueIds: ["diag-start"],
      cuesLog: [],
    };
    await storage.saveSession(session);

    await handleDiagnosticLocations([createLocationObject(50000)], storage, speech);
    expect(speech.spoken).toHaveLength(0);

    const after = await storage.getSession();
    expect(after?.sampleCount).toBe(5);
  });

  it("handles overlapping callback batches safely", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const speech = new MockSpeechAdapter();

    const session: DiagnosticSession = {
      sessionId: "overlap-task",
      version: 1,
      status: "running",
      startedAt: 10000,
      sampleCount: 0,
      spokenCueIds: ["diag-start"],
      cuesLog: [],
    };
    await storage.saveSession(session);

    // Dispatch two batches simultaneously
    const batch1 = [createLocationObject(12000), createLocationObject(13000)];
    const batch2 = [createLocationObject(14000), createLocationObject(15000)];

    await Promise.all([
      handleDiagnosticLocations(batch1, storage, speech),
      handleDiagnosticLocations(batch2, storage, speech),
    ]);

    const after = await storage.getSession();
    expect(after?.sampleCount).toBe(4);
  });

  it("skips obsolete cues when stale batched fixes arrive after wake", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const speech = new MockSpeechAdapter();

    const session: DiagnosticSession = {
      sessionId: "wake-test",
      version: 1,
      status: "running",
      startedAt: 0,
      sampleCount: 0,
      spokenCueIds: ["diag-start"],
      cuesLog: [],
    };
    await storage.saveSession(session);

    // Phone woke up after 3 minutes (180s)
    // 30s, 60s, 120s are obsolete (>45s stale)
    await handleDiagnosticLocations([createLocationObject(180000)], storage, speech);

    const after = await storage.getSession();
    // Verify obsolete cues are marked skipped rather than played back-to-back
    const skippedCues = after?.cuesLog.filter((c) => c.status === "skipped");
    expect(skippedCues?.length).toBeGreaterThan(0);
    expect(speech.spoken).toHaveLength(0); // 180s has no active due cue
  });

  it("ignores outstanding callback from previous session when a new session has started", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const speech = new MockSpeechAdapter();

    // Session 1 started
    await storage.saveSession({
      sessionId: "session-1",
      version: 1,
      status: "stopped",
      startedAt: 10000,
      stoppedAt: 20000,
      sampleCount: 2,
      spokenCueIds: ["diag-start"],
      cuesLog: [],
    });

    // Session 2 started
    await storage.saveSession({
      sessionId: "session-2",
      version: 1,
      status: "running",
      startedAt: 30000,
      sampleCount: 0,
      spokenCueIds: ["diag-start"],
      cuesLog: [],
    });

    // Delayed callback from session-1 arrives with fixes from session-1
    await handleDiagnosticLocations([createLocationObject(15000)], storage, speech);

    const current = await storage.getSession();
    expect(current?.sessionId).toBe("session-2");
    // Session 2 must not have recorded session 1's sample
    expect(current?.sampleCount).toBe(0);
  });
});
