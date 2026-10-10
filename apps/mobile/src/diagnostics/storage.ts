import {
  DiagnosticCue,
  DiagnosticSample,
  DiagnosticSession,
  DiagnosticSummary,
} from "./types";

export const MAX_SAMPLES_RETAINED = 2000;

export interface DiagnosticStorage {
  getSession(): Promise<DiagnosticSession | null>;
  createSession(session: DiagnosticSession): Promise<DiagnosticSession>;
  updateSession(
    sessionId: string,
    updater: (current: DiagnosticSession) => void | DiagnosticSession
  ): Promise<DiagnosticSession | null>;
  saveSession(session: DiagnosticSession): Promise<void>;
  recordSample(sample: DiagnosticSample, sessionId?: string): Promise<void>;
  getSamples(): Promise<DiagnosticSample[]>;
  clear(): Promise<void>;
}

export function buildDiagnosticSummary(
  session: DiagnosticSession | null,
  totalScheduledCues: number
): DiagnosticSummary | null {
  if (!session) return null;

  const now = Date.now();
  const endTimestamp = session.stoppedAt ?? session.interruptedAt ?? now;
  const elapsedSeconds = Math.max(0, Math.floor((endTimestamp - session.startedAt) / 1000));

  const avgIntervalMs =
    session.intervalCount && session.intervalCount > 0 && session.totalIntervalMs !== undefined
      ? Math.round(session.totalIntervalMs / session.intervalCount)
      : undefined;

  const completedCueCount = session.cuesLog.filter((c) => c.status === "completed").length;

  return {
    sessionId: session.sessionId,
    status: session.status,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    interruptedAt: session.interruptedAt,
    elapsedSeconds,
    sampleCount: session.sampleCount,
    minIntervalMs: session.minIntervalMs,
    maxIntervalMs: session.maxIntervalMs,
    avgIntervalMs,
    lastSampleAccuracy: session.lastSampleAccuracy,
    spokenCueCount: session.spokenCueIds.length,
    completedCueCount,
    totalScheduledCues,
    lastSpokenCue: session.lastSpokenCue,
    cuesLog: [...session.cuesLog],
    errorMessage: session.errorMessage,
  };
}

export class InMemoryDiagnosticStorage implements DiagnosticStorage {
  protected session: DiagnosticSession | null = null;
  protected samples: DiagnosticSample[] = [];

  async getSession(): Promise<DiagnosticSession | null> {
    return this.session ? JSON.parse(JSON.stringify(this.session)) : null;
  }

  async createSession(session: DiagnosticSession): Promise<DiagnosticSession> {
    if (this.session && (this.session.status === "running" || this.session.status === "stopping")) {
      throw new Error("A diagnostic session is already active.");
    }
    const created: DiagnosticSession = {
      ...JSON.parse(JSON.stringify(session)),
      version: session.version ?? 1,
    };
    await this.saveSession(created);
    return JSON.parse(JSON.stringify(this.session));
  }

  async updateSession(
    sessionId: string,
    updater: (current: DiagnosticSession) => void | DiagnosticSession
  ): Promise<DiagnosticSession | null> {
    if (!this.session || this.session.sessionId !== sessionId) {
      return null;
    }
    const copy: DiagnosticSession = JSON.parse(JSON.stringify(this.session));
    const result = updater(copy) ?? copy;
    result.version = (this.session.version ?? 0) + 1;
    await this.saveSession(result);
    return this.session ? JSON.parse(JSON.stringify(this.session)) : null;
  }

  async saveSession(session: DiagnosticSession): Promise<void> {
    if (this.session) {
      // 1. Same session: Guard against resurrecting a non-running session
      if (
        this.session.sessionId === session.sessionId &&
        (this.session.status === "stopped" ||
          this.session.status === "interrupted" ||
          this.session.status === "error") &&
        (session.status === "running" || session.status === "stopping")
      ) {
        // Discard stale running write from a racing callback
        return;
      }

      // 2. Same session: Guard against older versions overwriting newer versions
      if (
        this.session.sessionId === session.sessionId &&
        (this.session.version ?? 0) > (session.version ?? 0)
      ) {
        return;
      }

      // 3. Different session: Guard against overwriting an active session
      if (
        this.session.sessionId !== session.sessionId &&
        (this.session.status === "running" || this.session.status === "stopping")
      ) {
        return;
      }

      // 4. Different session: Guard against an older session write replacing a newer session
      if (
        this.session.sessionId !== session.sessionId &&
        (session.startedAt ?? 0) < (this.session.startedAt ?? 0)
      ) {
        return;
      }
    }

    this.session = JSON.parse(JSON.stringify(session));
  }

  async recordSample(sample: DiagnosticSample, sessionId?: string): Promise<void> {
    if (!this.session || this.session.status !== "running") {
      return;
    }

    if (sessionId !== undefined && this.session.sessionId !== sessionId) {
      return;
    }

    if (this.session.lastSampleTimestamp !== undefined) {
      const intervalMs = sample.timestamp - this.session.lastSampleTimestamp;
      if (intervalMs >= 0) {
        this.session.minIntervalMs =
          this.session.minIntervalMs === undefined
            ? intervalMs
            : Math.min(this.session.minIntervalMs, intervalMs);
        this.session.maxIntervalMs =
          this.session.maxIntervalMs === undefined
            ? intervalMs
            : Math.max(this.session.maxIntervalMs, intervalMs);
        this.session.totalIntervalMs = (this.session.totalIntervalMs ?? 0) + intervalMs;
        this.session.intervalCount = (this.session.intervalCount ?? 0) + 1;
      }
    }

    this.session.sampleCount += 1;
    this.session.version = (this.session.version ?? 0) + 1;
    this.session.lastSampleTimestamp = sample.timestamp;
    if (sample.accuracy !== null) {
      this.session.lastSampleAccuracy = sample.accuracy;
    }

    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES_RETAINED) {
      this.samples = this.samples.slice(-MAX_SAMPLES_RETAINED);
    }
  }

  async getSamples(): Promise<DiagnosticSample[]> {
    return [...this.samples];
  }

  async clear(): Promise<void> {
    this.session = null;
    this.samples = [];
  }
}
