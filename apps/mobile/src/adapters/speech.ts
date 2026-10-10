import * as Speech from "expo-speech";
import { SpeechAdapter, SpeechOptions } from "./speech-types";

export * from "./speech-types";

// Module-scope cancellation generation and stopped flag shared across all adapter instances
// for the shared physical native speech engine.
let sharedGeneration = 0;
let sharedStopped = false;

export class ExpoSpeechAdapter implements SpeechAdapter {
  async speak(text: string, options?: SpeechOptions): Promise<void> {
    sharedStopped = false;
    const currentGen = ++sharedGeneration;

    await Speech.stop();

    if (sharedStopped || sharedGeneration !== currentGen) {
      // If stop() was called or a new utterance was scheduled while awaiting native stop, abort speech dispatch
      return;
    }

    const speechOptions: Speech.SpeechOptions = {
      language: options?.language ?? "en-US",
      pitch: options?.pitch ?? 1.0,
      rate: options?.rate ?? 0.95,
    };

    if (options?.onDone) {
      speechOptions.onDone = options.onDone;
    }
    if (options?.onError) {
      const errCb = options.onError;
      speechOptions.onError = (err) => errCb(new Error(err.message));
    }

    Speech.speak(text, speechOptions);
  }

  async stop(): Promise<void> {
    sharedStopped = true;
    sharedGeneration++;
    // Surface native failure - do not swallow false success
    await Speech.stop();
  }

  async isSpeakingAsync(): Promise<boolean> {
    return Speech.isSpeakingAsync();
  }
}
