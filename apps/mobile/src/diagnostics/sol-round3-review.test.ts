import { expect, it, vi } from "vitest";
import * as Speech from "expo-speech";
import { ExpoSpeechAdapter } from "../adapters/speech";
import { InMemoryDiagnosticStorage } from "./storage";
import { startDiagnosticsSession, stopDiagnosticsSession } from "./session";
import { handleDiagnosticLocations } from "./task-handler";
import type { LocationAdapter } from "../adapters/location-types";
import type { SpeechAdapter } from "../adapters/speech-types";

vi.mock("expo-speech", () => ({
  speak: vi.fn(),
  stop: vi.fn(async () => {}),
  isSpeakingAsync: vi.fn(async () => false),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function location(): LocationAdapter {
  return {
    isBackgroundLocationAvailableAsync: vi.fn(async () => true),
    getPermissionsAsync: vi.fn(async () => ({ foreground: "granted" as const, background: "granted" as const, canAskAgainForeground: true, canAskAgainBackground: true })),
    requestForegroundPermissionsAsync: vi.fn(async () => "granted" as const),
    requestBackgroundPermissionsAsync: vi.fn(async () => "granted" as const),
    hasStartedLocationUpdatesAsync: vi.fn(async () => false),
    startBackgroundLocationUpdatesAsync: vi.fn(async () => {}),
    stopBackgroundLocationUpdatesAsync: vi.fn(async () => {}),
  };
}
function speech(): SpeechAdapter {
  return { speak: vi.fn(async () => {}), stop: vi.fn(async () => {}), isSpeakingAsync: vi.fn(async () => false) };
}

it("starts native tracking only once for simultaneous Start requests", async () => {
  const storage = new InMemoryDiagnosticStorage();
  const l = location(), sp = speech();
  await Promise.allSettled([startDiagnosticsSession(storage, l, sp), startDiagnosticsSession(storage, l, sp)]);
  await stopDiagnosticsSession(storage, l, sp);
  expect(l.startBackgroundLocationUpdatesAsync).toHaveBeenCalledTimes(1);
});

it("rolls native tracking back if session persistence fails after native startup", async () => {
  const storage = new InMemoryDiagnosticStorage();
  const l = location(), sp = speech();
  vi.spyOn(storage, "createSession").mockRejectedValue(new Error("disk unavailable"));
  await expect(startDiagnosticsSession(storage, l, sp)).rejects.toThrow("disk unavailable");
  expect(l.stopBackgroundLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(sp.stop).toHaveBeenCalledTimes(1);
});

it("does not report a clean Stop while a speech dispatch remains in flight", async () => {
  const storage = new InMemoryDiagnosticStorage();
  const l = location(), sp = speech();
  await storage.createSession({ sessionId: "slow-dispatch", status: "running", startedAt: 10000, sampleCount: 0, spokenCueIds: ["diag-start"], cuesLog: [] });
  const entered = deferred(), release = deferred();
  vi.mocked(sp.speak).mockImplementation(async () => { entered.resolve(); await release.promise; });
  const callback = handleDiagnosticLocations([{ timestamp: 45000, coords: { latitude: 0, longitude: 0 } }], storage, sp);
  await entered.promise;
  let cleanStopResolved = false;
  const stopping = stopDiagnosticsSession(storage, l, sp).then(() => { cleanStopResolved = true; });
  await new Promise(r => setTimeout(r, 100));
  const resolvedBeforeDispatchSettled = cleanStopResolved;
  release.resolve();
  await Promise.all([callback, stopping]);
  expect(resolvedBeforeDispatchSettled).toBe(false);
});

it("does not silence the active session when a duplicate Start is rejected", async () => {
  const storage = new InMemoryDiagnosticStorage();
  const l = location(), sp = speech();
  await startDiagnosticsSession(storage, l, sp);
  vi.mocked(sp.stop).mockClear();
  await expect(startDiagnosticsSession(storage, l, sp)).rejects.toThrow("already running");
  const stopsOnRejectedStart = vi.mocked(sp.stop).mock.calls.length;
  await stopDiagnosticsSession(storage, l, sp);
  expect(stopsOnRejectedStart).toBe(0);
});

it("attempts native teardown when startup rejects after partial activation", async () => {
  const storage = new InMemoryDiagnosticStorage();
  const l = location(), sp = speech();
  vi.mocked(l.startBackgroundLocationUpdatesAsync).mockRejectedValueOnce(new Error("partial native startup"));
  await expect(startDiagnosticsSession(storage, l, sp)).rejects.toThrow("partial native startup");
  expect(l.stopBackgroundLocationUpdatesAsync).toHaveBeenCalledTimes(1);
});

it("retains lifecycle ownership across adapter instances during timeout until drain and final silence before accepting new Start", async () => {
  const storage = new InMemoryDiagnosticStorage();
  const l = location();
  // Validate real ExpoSpeechAdapter instances with mocked expo-speech
  const backgroundSpeech = new ExpoSpeechAdapter();
  const uiSpeech = new ExpoSpeechAdapter();

  // Start session with UI adapter
  const session = await startDiagnosticsSession(storage, l, uiSpeech);
  expect(session.status).toBe("running");

  // Clear mock calls from startup cue
  vi.mocked(Speech.speak).mockClear();
  vi.mocked(Speech.stop).mockClear();

  // Background dispatch receives fix that triggers due cue, but native Speech.stop hangs
  const enteredNativeStop = deferred();
  const releaseNativeStop = deferred();
  vi.mocked(Speech.stop).mockImplementationOnce(async () => {
    enteredNativeStop.resolve();
    await releaseNativeStop.promise;
  });

  const bgDispatch = handleDiagnosticLocations(
    [{ timestamp: session.startedAt + 35000, coords: { latitude: 0, longitude: 0 } }],
    storage,
    backgroundSpeech
  );
  await enteredNativeStop.promise;

  // UI calls stop with short drain timeout (50ms), dispatch is longer than timeout
  await expect(
    stopDiagnosticsSession(storage, l, uiSpeech, undefined, 50)
  ).rejects.toThrow("In-flight diagnostics tasks failed to drain within 50ms.");

  // While pending dispatch is still draining, new Start must be rejected
  await expect(startDiagnosticsSession(storage, l, uiSpeech)).rejects.toThrow(
    "Cannot start session: a lifecycle operation (stopping) is already in progress."
  );

  // Now release the hanging native stop so pending task can drain
  releaseNativeStop.resolve();
  await bgDispatch;

  // Wait a microtask tick for onInFlightTasksDrained completion
  await new Promise(r => setTimeout(r, 10));

  // Verify final native state:
  // 1. Pending background speech was aborted/cancelled across instances; native speak was NOT called after stop
  expect(Speech.speak).not.toHaveBeenCalled();
  // 2. Drain completion ran final native silence
  expect(Speech.stop).toHaveBeenCalled();

  // Now that drain completion and final native silence have run, new Start is accepted
  const newSession = await startDiagnosticsSession(storage, l, uiSpeech);
  expect(newSession.status).toBe("running");
  expect(newSession.sessionId).not.toBe(session.sessionId);
  await stopDiagnosticsSession(storage, l, uiSpeech);
});
