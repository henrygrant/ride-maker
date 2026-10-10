import { describe, expect, it } from "vitest";
import {
  buildDiagnosticSummary,
  InMemoryDiagnosticStorage,
  MAX_SAMPLES_RETAINED,
} from "./storage";
import { DiagnosticSample, DiagnosticSession } from "./types";

describe("storage", () => {
  it("saves and retrieves session correctly", async () => {
    const storage = new InMemoryDiagnosticStorage();
    expect(await storage.getSession()).toBeNull();

    const session: DiagnosticSession = {
      sessionId: "test-session-1",
      status: "running",
      startedAt: 1000,
      sampleCount: 0,
      spokenCueIds: [],
      cuesLog: [],
    };

    await storage.saveSession(session);
    const retrieved = await storage.getSession();
    expect(retrieved).toEqual(session);
  });

  it("calculates sample intervals and updates statistics", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const session: DiagnosticSession = {
      sessionId: "test-session-2",
      status: "running",
      startedAt: 1000,
      sampleCount: 0,
      spokenCueIds: [],
      cuesLog: [],
    };
    await storage.saveSession(session);

    const sample1: DiagnosticSample = {
      timestamp: 1000,
      accuracy: 5.2,
      latitude: 40.71,
      longitude: -74.00,
      speed: 3.5,
      heading: 90,
    };
    await storage.recordSample(sample1);

    let updated = await storage.getSession();
    expect(updated?.sampleCount).toBe(1);
    expect(updated?.lastSampleTimestamp).toBe(1000);
    expect(updated?.lastSampleAccuracy).toBe(5.2);
    expect(updated?.minIntervalMs).toBeUndefined();

    // Second sample 1200ms later
    const sample2: DiagnosticSample = {
      timestamp: 2200,
      accuracy: 4.8,
      latitude: 40.7101,
      longitude: -74.0001,
      speed: 3.8,
      heading: 92,
    };
    await storage.recordSample(sample2);

    updated = await storage.getSession();
    expect(updated?.sampleCount).toBe(2);
    expect(updated?.lastSampleTimestamp).toBe(2200);
    expect(updated?.minIntervalMs).toBe(1200);
    expect(updated?.maxIntervalMs).toBe(1200);

    // Third sample 800ms later
    const sample3: DiagnosticSample = {
      timestamp: 3000,
      accuracy: 4.0,
      latitude: 40.7102,
      longitude: -74.0002,
      speed: 4.0,
      heading: 91,
    };
    await storage.recordSample(sample3);

    updated = await storage.getSession();
    expect(updated?.sampleCount).toBe(3);
    expect(updated?.minIntervalMs).toBe(800);
    expect(updated?.maxIntervalMs).toBe(1200);
    expect(updated?.totalIntervalMs).toBe(2000);
    expect(updated?.intervalCount).toBe(2);

    const summary = buildDiagnosticSummary(updated, 8);
    expect(summary?.avgIntervalMs).toBe(1000);
    expect(summary?.sampleCount).toBe(3);
    expect(summary?.minIntervalMs).toBe(800);
    expect(summary?.maxIntervalMs).toBe(1200);
  });

  it("enforces bounded retention on stored samples", async () => {
    const storage = new InMemoryDiagnosticStorage();
    const session: DiagnosticSession = {
      sessionId: "retention-test",
      status: "running",
      startedAt: 0,
      sampleCount: 0,
      spokenCueIds: [],
      cuesLog: [],
    };
    await storage.saveSession(session);

    const totalToInsert = MAX_SAMPLES_RETAINED + 50;
    for (let i = 0; i < totalToInsert; i++) {
      await storage.recordSample({
        timestamp: i * 1000,
        accuracy: 5,
        latitude: 40 + i * 0.0001,
        longitude: -74,
        speed: 4,
        heading: 0,
      });
    }

    const samples = await storage.getSamples();
    expect(samples.length).toBe(MAX_SAMPLES_RETAINED);
    const lastSample = samples[samples.length - 1];
    expect(lastSample?.timestamp).toBe((totalToInsert - 1) * 1000);
  });

  it("clears storage cleanly", async () => {
    const storage = new InMemoryDiagnosticStorage();
    await storage.saveSession({
      sessionId: "to-clear",
      status: "running",
      startedAt: 0,
      sampleCount: 0,
      spokenCueIds: [],
      cuesLog: [],
    });
    await storage.recordSample({
      timestamp: 100,
      accuracy: 5,
      latitude: 40,
      longitude: -74,
      speed: null,
      heading: null,
    });

    await storage.clear();
    expect(await storage.getSession()).toBeNull();
    expect(await storage.getSamples()).toHaveLength(0);
  });
});
