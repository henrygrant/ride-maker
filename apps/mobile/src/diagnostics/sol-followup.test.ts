import { describe, expect, it, vi } from "vitest";
import { DiagnosticSession } from "./types";
import {
  DiagnosticStorage,
  InMemoryDiagnosticStorage,
} from "./storage";
import { LocationAdapter } from "../adapters/location-types";
import { SpeechAdapter } from "../adapters/speech-types";
import { stopDiagnosticsSession } from "./session";
import { handleDiagnosticLocations } from "./task-handler";

const base: DiagnosticSession = {
  sessionId: "s1",
  version: 1,
  status: "running",
  startedAt: 10000,
  sampleCount: 0,
  spokenCueIds: [],
  cuesLog: [],
};

const location = (): LocationAdapter => ({
  getPermissionsAsync: vi.fn(async () => ({
    foreground: "granted" as const,
    background: "granted" as const,
    canAskAgainForeground: true,
    canAskAgainBackground: true,
  })),
  requestForegroundPermissionsAsync: vi.fn(async () => "granted" as const),
  requestBackgroundPermissionsAsync: vi.fn(async () => "granted" as const),
  isBackgroundLocationAvailableAsync: vi.fn(async () => true),
  hasStartedLocationUpdatesAsync: vi.fn(async () => true),
  startBackgroundLocationUpdatesAsync: vi.fn(async () => {}),
  stopBackgroundLocationUpdatesAsync: vi.fn(async () => {}),
});

const speech = (): SpeechAdapter => {
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

const fix = (t: number) => [{ timestamp: t, coords: { latitude: 0, longitude: 0, accuracy: 5 } }];

describe("Sol followup", () => {
  it("keeps the newer session when an old running write arrives", async () => {
    const s = new InMemoryDiagnosticStorage();
    await s.saveSession({ ...base, sessionId: "new-session", version: 10 });
    await s.saveSession({ ...base, sessionId: "old-session", version: 2 });
    expect((await s.getSession())?.sessionId).toBe("new-session");
  });

  it("persists stopped state even when callbacks advance versions during native stop", async () => {
    const s = new InMemoryDiagnosticStorage();
    const l = location();
    await s.saveSession({ ...base, sessionId: "advancing" });
    (l.stopBackgroundLocationUpdatesAsync as any).mockImplementation(async () => {
      await handleDiagnosticLocations(fix(45000), s, speech());
      await handleDiagnosticLocations(fix(75000), s, speech());
    });
    await stopDiagnosticsSession(s, l, speech());
    expect((await s.getSession())?.status).toBe("stopped");
  });

  it("does not dispatch deferred speech after Stop resolves", async () => {
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const s = new InMemoryDiagnosticStorage();
    const l = location();
    const sp = speech();
    const delivered: string[] = [];
    await s.saveSession({ ...base, sessionId: "deferred-speech" });
    sp.speak = vi.fn(async (text: string) => {
      entered();
      await gate;
      if (!(await sp.isSpeakingAsync())) return;
      delivered.push(text);
    });
    const pending = handleDiagnosticLocations(fix(45000), s, sp);
    await reached;
    const stopping = stopDiagnosticsSession(s, l, sp);
    await new Promise((r) => setTimeout(r, 20));
    release();
    await Promise.all([stopping, pending]);
    expect(delivered).toHaveLength(0);
  });
});
