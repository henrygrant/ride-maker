import { describe, expect, it } from "vitest";
import {
  BackgroundLocationOptions,
  LocationAdapter,
  LocationPermissionsStatus,
  PermissionStatus,
} from "../adapters/location-types";
import { SpeechAdapter } from "../adapters/speech-types";
import {
  checkOrRecoverSession,
  startDiagnosticsSession,
  stopDiagnosticsSession,
} from "./session";
import { InMemoryDiagnosticStorage } from "./storage";

class MockLocationAdapter implements LocationAdapter {
  foregroundStatus: PermissionStatus = "granted";
  backgroundStatus: PermissionStatus = "granted";
  trackingStarted = false;
  startedOptions: BackgroundLocationOptions | null = null;
  backgroundAvailable = true;
  stopThrows = false;

  async getPermissionsAsync(): Promise<LocationPermissionsStatus> {
    return {
      foreground: this.foregroundStatus,
      background: this.backgroundStatus,
      canAskAgainForeground: true,
      canAskAgainBackground: true,
    };
  }

  async requestForegroundPermissionsAsync(): Promise<PermissionStatus> {
    return this.foregroundStatus;
  }

  async requestBackgroundPermissionsAsync(): Promise<PermissionStatus> {
    return this.backgroundStatus;
  }

  async isBackgroundLocationAvailableAsync(): Promise<boolean> {
    return this.backgroundAvailable;
  }

  async hasStartedLocationUpdatesAsync(): Promise<boolean> {
    return this.trackingStarted;
  }

  async startBackgroundLocationUpdatesAsync(
    _taskName: string,
    options: BackgroundLocationOptions
  ): Promise<void> {
    this.trackingStarted = true;
    this.startedOptions = options;
  }

  async stopBackgroundLocationUpdatesAsync(): Promise<void> {
    if (this.stopThrows) {
      throw new Error("Native stop failed");
    }
    this.trackingStarted = false;
  }
}

class MockSpeechAdapter implements SpeechAdapter {
  spoken: string[] = [];
  stopped = false;

  async speak(text: string): Promise<void> {
    this.spoken.push(text);
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async isSpeakingAsync(): Promise<boolean> {
    return false;
  }
}

describe("session lifecycle", () => {
  it("starts diagnostics cleanly, registers task, and speaks start cue", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const location = new MockLocationAdapter();
    const speech = new MockSpeechAdapter();

    const session = await startDiagnosticsSession(storage, location, speech);
    expect(session.status).toBe("running");
    expect(location.trackingStarted).toBe(true);
    expect(location.startedOptions?.notificationTitle).toContain("Ride Maker");
    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0]).toContain("diagnostic test started");

    const saved = await storage.getSession();
    expect(saved?.status).toBe("running");
    expect(saved?.spokenCueIds).toContain("diag-start");
  });

  it("stops diagnostics cleanly and stops speech", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const location = new MockLocationAdapter();
    const speech = new MockSpeechAdapter();

    await startDiagnosticsSession(storage, location, speech);
    const stopped = await stopDiagnosticsSession(storage, location, speech);

    expect(stopped?.status).toBe("stopped");
    expect(location.trackingStarted).toBe(false);
    expect(speech.stopped).toBe(true);

    const saved = await storage.getSession();
    expect(saved?.status).toBe("stopped");
    expect(saved?.stoppedAt).toBeDefined();
  });

  it("detects force-quit / interrupted session on app reopen", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const location = new MockLocationAdapter();
    const speech = new MockSpeechAdapter();

    // Start session
    await startDiagnosticsSession(storage, location, speech);

    // Simulate force-quit: native service was killed so tracking is no longer active
    location.trackingStarted = false;

    // App is reopened after force quit
    const recovered = await checkOrRecoverSession(storage, location);
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.interruptedAt).toBeDefined();

    const saved = await storage.getSession();
    expect(saved?.status).toBe("interrupted");
  });

  it("rejects starting if foreground permission is denied", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const location = new MockLocationAdapter();
    location.foregroundStatus = "denied";
    const speech = new MockSpeechAdapter();

    await expect(startDiagnosticsSession(storage, location, speech)).rejects.toThrow(
      "Foreground location permission is required"
    );
    expect((await storage.getSession())?.status).not.toBe("running");
  });

  it("rejects starting if background permission is denied", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const location = new MockLocationAdapter();
    location.backgroundStatus = "denied";
    const speech = new MockSpeechAdapter();

    await expect(startDiagnosticsSession(storage, location, speech)).rejects.toThrow(
      "Background location permission is required"
    );
    expect((await storage.getSession())?.status).not.toBe("running");
  });

  it("rejects starting if background location API is unsupported on device", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const location = new MockLocationAdapter();
    location.backgroundAvailable = false;
    const speech = new MockSpeechAdapter();

    await expect(startDiagnosticsSession(storage, location, speech)).rejects.toThrow(
      "Background location tracking is not supported on this device."
    );
    expect((await storage.getSession())?.status).not.toBe("running");
  });

  it("rejects repeated start when a session is already active", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const location = new MockLocationAdapter();
    const speech = new MockSpeechAdapter();

    await startDiagnosticsSession(storage, location, speech);
    await expect(startDiagnosticsSession(storage, location, speech)).rejects.toThrow(
      "A diagnostic session is already running."
    );
  });

  it("surfaces native stop failure and records error state without reporting success", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const location = new MockLocationAdapter();
    const speech = new MockSpeechAdapter();

    await startDiagnosticsSession(storage, location, speech);
    location.stopThrows = true;

    await expect(stopDiagnosticsSession(storage, location, speech)).rejects.toThrow(
      "Native stop failed"
    );

    const session = await storage.getSession();
    expect(session?.status).not.toBe("stopped");
    expect(session?.errorMessage).toContain("Native stop failed");
  });
});
