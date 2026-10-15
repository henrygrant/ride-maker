import { describe, expect, it } from "vitest";
import { ForegroundSpeechQueue } from "./foreground-speech-queue";

describe("ForegroundSpeechQueue", () => {
  it("does not speak a queued event when end invalidates it during Speech.stop", async () => {
    let releaseStop!: () => void;
    const stopGate = new Promise<void>((resolve) => { releaseStop = resolve; });
    let enteredStop!: () => void;
    const stopEntered = new Promise<void>((resolve) => { enteredStop = resolve; });
    const spoken: string[] = [];
    const queue = new ForegroundSpeechQueue(async () => { enteredStop(); await stopGate; }, (text) => spoken.push(text));

    queue.enqueue("Turn left", () => true);
    await stopEntered;
    queue.invalidate();
    releaseStop();
    await Promise.resolve();
    await Promise.resolve();

    expect(spoken).toEqual([]);
  });

  it("invalidates later queued events and respects mute before stop starts", async () => {
    let enabled = true;
    const spoken: string[] = [];
    const queue = new ForegroundSpeechQueue(async () => {}, (text) => spoken.push(text));
    queue.enqueue("Arrival", () => enabled);
    queue.invalidate(); // route change/end before the microtask begins
    enabled = false;
    await Promise.resolve();
    await Promise.resolve();
    expect(spoken).toEqual([]);
  });
});
