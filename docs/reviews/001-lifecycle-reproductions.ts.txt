import { describe, expect, it, vi } from "vitest";
import { startDiagnosticsSession, stopDiagnosticsSession } from "./session";
import { handleDiagnosticLocations } from "./task-handler";
import { InMemoryDiagnosticStorage } from "./storage";
import type { DiagnosticSession } from "./types";

const location = () => ({
 getPermissionsAsync: vi.fn(async () => ({ foreground: "granted" as const, background: "granted" as const, canAskAgainForeground: true, canAskAgainBackground: true })),
 requestForegroundPermissionsAsync: vi.fn(async () => "granted" as const),
 requestBackgroundPermissionsAsync: vi.fn(async () => "granted" as const),
 isBackgroundLocationAvailableAsync: vi.fn(async () => true),
 hasStartedLocationUpdatesAsync: vi.fn(async () => true),
 startBackgroundLocationUpdatesAsync: vi.fn(async () => {}),
 stopBackgroundLocationUpdatesAsync: vi.fn(async () => {}),
});
const speech = () => ({ speak: vi.fn(async () => {}), stop: vi.fn(async () => {}), isSpeakingAsync: vi.fn(async () => false) });

describe("Sol lifecycle review", () => {
 it("does not leave a running session after native startup fails", async () => {
  const storage = new InMemoryDiagnosticStorage(); const l = location();
  l.startBackgroundLocationUpdatesAsync.mockRejectedValueOnce(new Error("native startup failed"));
  await expect(startDiagnosticsSession(storage,l,speech())).rejects.toThrow("native startup failed");
  expect((await storage.getSession())?.status).not.toBe("running");
 });
 it("does not resurrect a stopped session or speak after Stop wins a pending write", async () => {
  let entered!: () => void; let release!: () => void;
  const reached = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { release = r; });
  class DelayedStorage extends InMemoryDiagnosticStorage {
   override async saveSession(s: DiagnosticSession) {
    if(s.status === "running" && s.spokenCueIds.includes("diag-30s")) { entered(); await gate; }
    await super.saveSession(s);
   }
  }
  const storage = new DelayedStorage(); const l = location(); const sp = speech();
  await storage.saveSession({ sessionId:"review",status:"running",startedAt:10000,sampleCount:0,spokenCueIds:["diag-start"],cuesLog:[] });
  const pending = handleDiagnosticLocations([{timestamp:45000,coords:{latitude:0,longitude:0,accuracy:5}}],storage,sp);
  await reached; await stopDiagnosticsSession(storage,l,sp); release(); await pending;
  expect((await storage.getSession())?.status).toBe("stopped");
  expect(sp.speak).not.toHaveBeenCalled();
 });
});
