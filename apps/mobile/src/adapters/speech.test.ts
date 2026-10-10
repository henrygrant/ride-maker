import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Speech from "expo-speech";
import { ExpoSpeechAdapter } from "./speech";

vi.mock("expo-speech", () => ({
  speak: vi.fn(),
  stop: vi.fn(async () => {}),
  isSpeakingAsync: vi.fn(async () => false),
}));

describe("ExpoSpeechAdapter", () => {
  let adapter: ExpoSpeechAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ExpoSpeechAdapter();
  });

  it("calls Speech.stop followed by Speech.speak with standard options", async () => {
    await adapter.speak("Hello rider");
    expect(Speech.stop).toHaveBeenCalledTimes(1);
    expect(Speech.speak).toHaveBeenCalledTimes(1);
    expect(Speech.speak).toHaveBeenCalledWith(
      "Hello rider",
      expect.objectContaining({
        language: "en-US",
        pitch: 1.0,
        rate: 0.95,
      })
    );
  });

  it("surfaces native stop failures when adapter.stop() is called", async () => {
    vi.mocked(Speech.stop).mockRejectedValueOnce(new Error("native speech crash"));
    await expect(adapter.stop()).rejects.toThrow("native speech crash");
  });

  it("aborts a pending speak if adapter.stop() is called while awaiting deferred Speech.stop()", async () => {
    let resolveNativeStop!: () => void;
    const nativeStopPromise = new Promise<void>((r) => {
      resolveNativeStop = r;
    });

    vi.mocked(Speech.stop).mockImplementationOnce(() => nativeStopPromise);

    const pendingSpeak = adapter.speak("Turn right at Main St");

    // adapter.stop() is called while speak() is still awaiting Speech.stop()
    const stopPromise = adapter.stop();

    // Release deferred native stop
    resolveNativeStop();

    await Promise.all([pendingSpeak, stopPromise]);

    // Native Speech.speak must not have been dispatched
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  it("prevents an old pending speak from resuming when a new session resets stopped boolean", async () => {
    let resolveFirstStop!: () => void;
    const firstStopPromise = new Promise<void>((r) => {
      resolveFirstStop = r;
    });

    // Session 1: Speech.stop() is slow / deferred
    vi.mocked(Speech.stop).mockImplementationOnce(() => firstStopPromise);

    const session1Speak = adapter.speak("Session 1: Stale cue");

    // Session 1 stops
    const session1Stop = adapter.stop();

    // Session 2 starts and issues a new speak (which resets this.stopped = false)
    const session2Speak = adapter.speak("Session 2: Fresh cue");

    // Now Session 1's slow native stop finally resolves
    resolveFirstStop();

    await Promise.all([session1Speak, session1Stop, session2Speak]);

    // Speech.speak must have been called for Session 2, but NEVER for Session 1
    expect(Speech.speak).toHaveBeenCalledTimes(1);
    expect(Speech.speak).toHaveBeenCalledWith(
      "Session 2: Fresh cue",
      expect.anything()
    );
  });
});

it("cancels pending native speech across UI and background adapter instances", async () => {
  vi.clearAllMocks();
  const background = new ExpoSpeechAdapter();
  const ui = new ExpoSpeechAdapter();
  let release!: () => void;
  vi.mocked(Speech.stop).mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
  const pending = background.speak("Old background cue");
  await ui.stop();
  release();
  await pending;
  expect(Speech.speak).not.toHaveBeenCalled();
});

it("does not dispatch new speech when native silence fails", async () => {
  vi.clearAllMocks();
  vi.mocked(Speech.stop).mockRejectedValueOnce(new Error("native silence failed"));
  await expect(new ExpoSpeechAdapter().speak("New cue")).rejects.toThrow("native silence failed");
  expect(Speech.speak).not.toHaveBeenCalled();
});
