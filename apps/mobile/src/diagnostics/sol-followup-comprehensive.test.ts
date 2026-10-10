import { describe, expect, it, vi } from "vitest";
import { LocationAdapter } from "../adapters/location-types";
import { SpeechAdapter } from "../adapters/speech-types";
import {
  checkOrRecoverSession,
  startDiagnosticsSession,
  stopDiagnosticsSession,
} from "./session";
import { handleDiagnosticLocations } from "./task-handler";
import { FileSystemDiagnosticStorage, FileSystemInterface } from "./file-storage";
import { InMemoryDiagnosticStorage } from "./storage";
import { DiagnosticSession } from "./types";

class FakeDelayedFileSystem implements FileSystemInterface {
  documentDirectory = "file:///data/user/0/com.ridemaker/files/";
  files = new Map<string, string>();
  readDelayMs = 5;
  writeDelayMs = 5;

  async getInfoAsync(fileUri: string): Promise<{ exists: boolean }> {
    return { exists: this.files.has(fileUri) };
  }

  async makeDirectoryAsync(_fileUri: string): Promise<void> {}

  async readAsStringAsync(fileUri: string): Promise<string> {
    if (this.readDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.readDelayMs));
    }
    const val = this.files.get(fileUri);
    if (val === undefined) {
      throw new Error(`File not found: ${fileUri}`);
    }
    return val;
  }

  async writeAsStringAsync(
    fileUri: string,
    contents: string,
    options?: { append?: boolean }
  ): Promise<void> {
    if (this.writeDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.writeDelayMs));
    }
    if (options?.append) {
      const existing = this.files.get(fileUri) ?? "";
      this.files.set(fileUri, existing + contents);
    } else {
      this.files.set(fileUri, contents);
    }
  }

  async deleteAsync(fileUri: string): Promise<void> {
    this.files.delete(fileUri);
  }

  async moveAsync(options: { from: string; to: string }): Promise<void> {
    const val = this.files.get(options.from);
    if (val !== undefined) {
      this.files.set(options.to, val);
      this.files.delete(options.from);
    }
  }
}

const mockLocation = (): LocationAdapter => ({
  getPermissionsAsync: vi.fn(async () => ({
    foreground: "granted" as const,
    background: "granted" as const,
    canAskAgainForeground: true,
    canAskAgainBackground: true,
  })),
  requestForegroundPermissionsAsync: vi.fn(async () => "granted" as const),
  requestBackgroundPermissionsAsync: vi.fn(async () => "granted" as const),
  isBackgroundLocationAvailableAsync: vi.fn(async () => true),
  hasStartedLocationUpdatesAsync: vi.fn(async () => false),
  startBackgroundLocationUpdatesAsync: vi.fn(async () => {}),
  stopBackgroundLocationUpdatesAsync: vi.fn(async () => {}),
});

const mockSpeech = (): SpeechAdapter => {
  let speaking = true;
  return {
    speak: vi.fn(async () => {
      speaking = true;
    }),
    stop: vi.fn(async () => {
      speaking = false;
    }),
    isSpeakingAsync: vi.fn(async () => speaking),
  };
};

const baseSession = {
  version: 1,
  status: "running" as const,
  startedAt: 10000,
  sampleCount: 0,
  spokenCueIds: ["diag-start"],
  cuesLog: [],
};

const fix = (timestamp: number) => [
  { timestamp, coords: { latitude: 0, longitude: 0, accuracy: 5 } },
];

describe("Sol Followup Comprehensive Test Suite", () => {
  describe("Production FileStorage with Delayed Fake I/O", () => {
    it("Case 1: keeps newer session when an old running write arrives in file storage", async () => {
      const fakeFs = new FakeDelayedFileSystem();
      const storage = new FileSystemDiagnosticStorage(
        "file:///data/user/0/com.ridemaker/files/diagnostics/",
        fakeFs
      );
      await storage.saveSession({
        ...baseSession,
        sessionId: "new-file-session",
        version: 10,
        startedAt: 20000,
      });
      await storage.saveSession({
        ...baseSession,
        sessionId: "old-file-session",
        version: 2,
        startedAt: 10000,
      });

      const finalSession = await storage.getSession();
      expect(finalSession?.sessionId).toBe("new-file-session");
    });

    it("Case 2: persists stopped state even when callbacks advance versions during native stop in file storage", async () => {
      let entered!: () => void, release!: () => void;
      const reached = new Promise<void>((r) => {
        entered = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });

      const fakeFs = new FakeDelayedFileSystem();
      const storage = new FileSystemDiagnosticStorage(
        "file:///data/user/0/com.ridemaker/files/diagnostics/",
        fakeFs
      );
      const l = mockLocation();
      const sp = mockSpeech();

      await storage.saveSession({
        ...baseSession,
        sessionId: "stop-version-file",
      });

      (l.stopBackgroundLocationUpdatesAsync as any).mockImplementation(async () => {
        entered();
        await gate;
      });

      const stopping = stopDiagnosticsSession(storage, l, sp);
      await reached;

      // Concurrent location fixes arriving while native stop is pending
      await handleDiagnosticLocations(fix(45000), storage, sp);
      await handleDiagnosticLocations(fix(75000), storage, sp);

      release();
      await stopping;

      const persisted = await storage.getSession();
      expect(persisted?.status).toBe("stopped");
    });

    it("Case 3: does not dispatch deferred speech after Stop resolves in file storage", async () => {
      let entered!: () => void, release!: () => void;
      const reached = new Promise<void>((r) => {
        entered = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });

      const fakeFs = new FakeDelayedFileSystem();
      const storage = new FileSystemDiagnosticStorage(
        "file:///data/user/0/com.ridemaker/files/diagnostics/",
        fakeFs
      );
      const l = mockLocation();
      const sp = mockSpeech();
      const delivered: string[] = [];

      await storage.saveSession({
        ...baseSession,
        sessionId: "deferred-speech-file",
      });

      (sp.speak as any).mockImplementation(async (text: string) => {
        entered();
        await gate;
        if (!(await sp.isSpeakingAsync())) return;
        delivered.push(text);
      });

      const pending = handleDiagnosticLocations(fix(45000), storage, sp);
      await reached;
      const stopping = stopDiagnosticsSession(storage, l, sp);
      await new Promise((r) => setTimeout(r, 40));
      release();
      await Promise.all([stopping, pending]);

      expect(delivered).toHaveLength(0);
      expect(await sp.isSpeakingAsync()).toBe(false);
    });
  });

  describe("Duplicate Concurrent Cue Claims", () => {
    it("claims and speaks a cue exactly once when two location batches arrive concurrently", async () => {
      const storage = new InMemoryDiagnosticStorage();
      const sp = mockSpeech();

      await storage.saveSession({
        ...baseSession,
        sessionId: "concurrent-cues",
        startedAt: 10000,
      });

      // Two concurrent fixes at 45000 (35s elapsed, cue diag-30s is due)
      const batchA = handleDiagnosticLocations(fix(45000), storage, sp);
      const batchB = handleDiagnosticLocations(fix(45000), storage, sp);

      await Promise.all([batchA, batchB]);

      const session = await storage.getSession();
      // diag-30s should be in cuesLog exactly once
      const cueEntries = session?.cuesLog.filter((c) => c.id === "diag-30s");
      expect(cueEntries).toHaveLength(1);
      // speech.speak should have been called exactly once for diag-30s
      expect(sp.speak).toHaveBeenCalledTimes(1);
    });
  });

  describe("Late Native Completion Callbacks", () => {
    it("updates cue status without resurrecting a stopped session", async () => {
      const storage = new InMemoryDiagnosticStorage();
      let capturedOnDone: (() => void) | undefined;

      const sp: SpeechAdapter = {
        speak: vi.fn(async (_text, opts) => {
          capturedOnDone = opts?.onDone;
        }),
        stop: vi.fn(async () => {}),
        isSpeakingAsync: vi.fn(async () => false),
      };

      await storage.saveSession({
        ...baseSession,
        sessionId: "late-cb-test",
        startedAt: 10000,
      });

      await handleDiagnosticLocations(fix(45000), storage, sp);
      expect(capturedOnDone).toBeDefined();

      // Session stops before speech onDone arrives
      const l = mockLocation();
      await stopDiagnosticsSession(storage, l, sp);

      const stoppedSession = await storage.getSession();
      expect(stoppedSession?.status).toBe("stopped");

      // Late native completion fires
      capturedOnDone?.();
      // Give async microtasks time to execute
      await new Promise((r) => setTimeout(r, 20));

      const finalSession = await storage.getSession();
      expect(finalSession?.status).toBe("stopped");
      const cueEntry = finalSession?.cuesLog.find((c) => c.id === "diag-30s");
      expect(cueEntry?.status).toBe("completed");
    });

    it("does not mutate a new session when an old callback arrives", async () => {
      const storage = new InMemoryDiagnosticStorage();
      let oldOnDone: (() => void) | undefined;

      const sp: SpeechAdapter = {
        speak: vi.fn(async (_text, opts) => {
          oldOnDone = opts?.onDone;
        }),
        stop: vi.fn(async () => {}),
        isSpeakingAsync: vi.fn(async () => false),
      };

      // Session 1
      await storage.saveSession({
        ...baseSession,
        sessionId: "session-1",
        startedAt: 10000,
      });
      await handleDiagnosticLocations(fix(45000), storage, sp);

      // Stop Session 1 and start Session 2
      const l = mockLocation();
      await stopDiagnosticsSession(storage, l, sp);

      await storage.saveSession({
        ...baseSession,
        sessionId: "session-2",
        startedAt: 50000,
        spokenCueIds: ["diag-start"],
        cuesLog: [],
      });

      // Old onDone from session 1 arrives
      oldOnDone?.();
      await new Promise((r) => setTimeout(r, 20));

      const session2 = await storage.getSession();
      expect(session2?.sessionId).toBe("session-2");
      // Session 2 should not have diag-30s from session 1
      expect(session2?.cuesLog).toHaveLength(0);
    });
  });

  describe("Speech Teardown Failure", () => {
    it("surfaces speech stop failure and sets session status to error", async () => {
      const storage = new InMemoryDiagnosticStorage();
      const l = mockLocation();
      const sp = mockSpeech();
      (sp.stop as any).mockRejectedValueOnce(new Error("Native audio engine failed to stop"));

      await storage.saveSession({
        ...baseSession,
        sessionId: "speech-teardown-fail",
      });

      await expect(stopDiagnosticsSession(storage, l, sp)).rejects.toThrow(
        "Native audio engine failed to stop"
      );

      const session = await storage.getSession();
      expect(session?.status).toBe("error");
      expect(session?.errorMessage).toContain("Native audio engine failed to stop");
    });
  });
});
