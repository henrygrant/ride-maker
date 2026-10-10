import { DiagnosticSample, DiagnosticSession } from "./types";
import {
  DiagnosticStorage,
  InMemoryDiagnosticStorage,
  MAX_SAMPLES_RETAINED,
} from "./storage";

export interface FileSystemInterface {
  documentDirectory: string | null;
  getInfoAsync(fileUri: string): Promise<{ exists: boolean }>;
  makeDirectoryAsync(fileUri: string, options?: { intermediates?: boolean }): Promise<void>;
  readAsStringAsync(fileUri: string): Promise<string>;
  writeAsStringAsync(
    fileUri: string,
    contents: string,
    options?: { append?: boolean }
  ): Promise<void>;
  deleteAsync(fileUri: string, options?: { idempotent?: boolean }): Promise<void>;
  moveAsync?(options: { from: string; to: string }): Promise<void>;
}

// Global serialized transaction queues keyed by normalized directory path
const directoryQueues = new Map<string, Promise<unknown>>();

function runInDirectoryLock<T>(dirKey: string, fn: () => Promise<T>): Promise<T> {
  const currentQueue = directoryQueues.get(dirKey) ?? Promise.resolve();
  const nextQueue = currentQueue.then(fn, fn);
  directoryQueues.set(dirKey, nextQueue);
  return nextQueue;
}

export class FileSystemDiagnosticStorage implements DiagnosticStorage {
  private fs: FileSystemInterface | null = null;
  private readonly customFs: FileSystemInterface | undefined;
  private readonly customDirectory: string | undefined;
  private dirPath = "";
  private sessionFilePath = "";
  private sessionTmpFilePath = "";
  private samplesFilePath = "";
  private memoryFallback: InMemoryDiagnosticStorage | null = null;
  private sampleAppendCount = 0;
  private initialized = false;

  constructor(customDirectory?: string, customFs?: FileSystemInterface) {
    this.customDirectory = customDirectory;
    this.customFs = customFs;
  }

  private getFs(): FileSystemInterface {
    if (!this.fs) {
      if (this.customFs) {
        this.fs = this.customFs;
      } else {
        try {
          // Lazy require prevents Vitest from loading native Flow code
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          this.fs = require("expo-file-system/legacy") as FileSystemInterface;
        } catch {
          this.memoryFallback = new InMemoryDiagnosticStorage();
          return {
            documentDirectory: null,
            getInfoAsync: async () => ({ exists: false }),
            makeDirectoryAsync: async () => {},
            readAsStringAsync: async () => "",
            writeAsStringAsync: async () => {},
            deleteAsync: async () => {},
          };
        }
      }
    }
    return this.fs;
  }

  private initPaths(): void {
    if (this.initialized) return;
    this.initialized = true;

    const fs = this.getFs();
    const baseDir =
      this.customDirectory ??
      (fs.documentDirectory ? `${fs.documentDirectory}diagnostics/` : "");
    if (!baseDir) {
      this.memoryFallback = new InMemoryDiagnosticStorage();
    }
    this.dirPath = baseDir;
    this.sessionFilePath = `${baseDir}session.json`;
    this.sessionTmpFilePath = `${baseDir}session.json.tmp`;
    this.samplesFilePath = `${baseDir}samples.jsonl`;
  }

  private async ensureDirectory(): Promise<void> {
    this.initPaths();
    if (this.memoryFallback) return;
    try {
      const fs = this.getFs();
      const info = await fs.getInfoAsync(this.dirPath);
      if (!info.exists) {
        await fs.makeDirectoryAsync(this.dirPath, { intermediates: true });
      }
    } catch {
      // Directory may already exist
    }
  }

  private async readSessionDirect(fs: FileSystemInterface): Promise<DiagnosticSession | null> {
    try {
      const info = await fs.getInfoAsync(this.sessionFilePath);
      if (!info.exists) {
        const tmpInfo = await fs.getInfoAsync(this.sessionTmpFilePath);
        if (tmpInfo.exists) {
          const tmpContent = await fs.readAsStringAsync(this.sessionTmpFilePath);
          return JSON.parse(tmpContent) as DiagnosticSession;
        }
        return null;
      }
      const content = await fs.readAsStringAsync(this.sessionFilePath);
      if (!content.trim()) return null;
      return JSON.parse(content) as DiagnosticSession;
    } catch {
      return null;
    }
  }

  private async writeSessionDirect(
    fs: FileSystemInterface,
    session: DiagnosticSession
  ): Promise<void> {
    await this.ensureDirectory();
    const jsonStr = JSON.stringify(session, null, 2);
    try {
      if (fs.moveAsync) {
        await fs.writeAsStringAsync(this.sessionTmpFilePath, jsonStr);
        await fs.moveAsync({
          from: this.sessionTmpFilePath,
          to: this.sessionFilePath,
        });
      } else {
        await fs.writeAsStringAsync(this.sessionFilePath, jsonStr);
      }
    } catch {
      await fs.writeAsStringAsync(this.sessionFilePath, jsonStr);
    }
  }

  async getSession(): Promise<DiagnosticSession | null> {
    this.initPaths();
    if (this.memoryFallback) {
      return this.memoryFallback.getSession();
    }
    const fs = this.getFs();
    return runInDirectoryLock(this.dirPath, async () => {
      return this.readSessionDirect(fs);
    });
  }

  async createSession(session: DiagnosticSession): Promise<DiagnosticSession> {
    this.initPaths();
    if (this.memoryFallback) {
      return this.memoryFallback.createSession(session);
    }
    const fs = this.getFs();
    return runInDirectoryLock(this.dirPath, async () => {
      const current = await this.readSessionDirect(fs);
      if (current && (current.status === "running" || current.status === "stopping")) {
        throw new Error("A diagnostic session is already active.");
      }
      const created: DiagnosticSession = {
        ...JSON.parse(JSON.stringify(session)),
        version: session.version ?? 1,
      };
      await this.writeSessionDirect(fs, created);
      return created;
    });
  }

  async updateSession(
    sessionId: string,
    updater: (current: DiagnosticSession) => void | DiagnosticSession
  ): Promise<DiagnosticSession | null> {
    this.initPaths();
    if (this.memoryFallback) {
      return this.memoryFallback.updateSession(sessionId, updater);
    }
    const fs = this.getFs();
    return runInDirectoryLock(this.dirPath, async () => {
      const current = await this.readSessionDirect(fs);
      if (!current || current.sessionId !== sessionId) {
        return null;
      }
      const copy: DiagnosticSession = JSON.parse(JSON.stringify(current));
      const result = updater(copy) ?? copy;
      result.version = (current.version ?? 0) + 1;
      await this.writeSessionDirect(fs, result);
      return result;
    });
  }

  async saveSession(session: DiagnosticSession): Promise<void> {
    this.initPaths();
    if (this.memoryFallback) {
      return this.memoryFallback.saveSession(session);
    }
    const fs = this.getFs();
    return runInDirectoryLock(this.dirPath, async () => {
      const currentOnDisk = await this.readSessionDirect(fs);

      if (currentOnDisk) {
        // 1. Same session: Guard against resurrecting a stopped or interrupted session
        if (
          currentOnDisk.sessionId === session.sessionId &&
          (currentOnDisk.status === "stopped" ||
            currentOnDisk.status === "interrupted" ||
            currentOnDisk.status === "error") &&
          (session.status === "running" || session.status === "stopping")
        ) {
          return;
        }

        // 2. Same session: Guard against older version overwriting newer version
        if (
          currentOnDisk.sessionId === session.sessionId &&
          (currentOnDisk.version ?? 0) > (session.version ?? 0)
        ) {
          return;
        }

        // 3. Different session: Guard against overwriting an active session
        if (
          currentOnDisk.sessionId !== session.sessionId &&
          (currentOnDisk.status === "running" || currentOnDisk.status === "stopping")
        ) {
          return;
        }

        // 4. Different session: Guard against an older session write replacing a newer session
        if (
          currentOnDisk.sessionId !== session.sessionId &&
          (session.startedAt ?? 0) < (currentOnDisk.startedAt ?? 0)
        ) {
          return;
        }
      }

      await this.writeSessionDirect(fs, session);
    });
  }

  async recordSample(sample: DiagnosticSample, sessionId?: string): Promise<void> {
    this.initPaths();
    if (this.memoryFallback) {
      return this.memoryFallback.recordSample(sample, sessionId);
    }

    const fs = this.getFs();
    return runInDirectoryLock(this.dirPath, async () => {
      const session = await this.readSessionDirect(fs);
      if (!session || session.status !== "running") return;

      if (sessionId !== undefined && session.sessionId !== sessionId) {
        return;
      }

      if (session.lastSampleTimestamp !== undefined) {
        const intervalMs = sample.timestamp - session.lastSampleTimestamp;
        if (intervalMs >= 0) {
          session.minIntervalMs =
            session.minIntervalMs === undefined
              ? intervalMs
              : Math.min(session.minIntervalMs, intervalMs);
          session.maxIntervalMs =
            session.maxIntervalMs === undefined
              ? intervalMs
              : Math.max(session.maxIntervalMs, intervalMs);
          session.totalIntervalMs = (session.totalIntervalMs ?? 0) + intervalMs;
          session.intervalCount = (session.intervalCount ?? 0) + 1;
        }
      }

      session.sampleCount += 1;
      session.lastSampleTimestamp = sample.timestamp;
      if (sample.accuracy !== null) {
        session.lastSampleAccuracy = sample.accuracy;
      }
      session.version = (session.version ?? 0) + 1;

      // Write session update
      await this.writeSessionDirect(fs, session);

      // Append sample to jsonl file without rewriting entire file every fix
      const line = JSON.stringify(sample) + "\n";
      try {
        await fs.writeAsStringAsync(this.samplesFilePath, line, { append: true });
        this.sampleAppendCount += 1;
      } catch {
        let currentContent = "";
        try {
          const sInfo = await fs.getInfoAsync(this.samplesFilePath);
          if (sInfo.exists) {
            currentContent = await fs.readAsStringAsync(this.samplesFilePath);
          }
        } catch {
          currentContent = "";
        }
        await fs.writeAsStringAsync(this.samplesFilePath, currentContent + line);
        this.sampleAppendCount += 1;
      }

      // Compact retained samples only every 250 appends
      if (this.sampleAppendCount > 250) {
        this.sampleAppendCount = 0;
        await this.compactSamples();
      }
    });
  }

  private async compactSamples(): Promise<void> {
    try {
      const fs = this.getFs();
      const info = await fs.getInfoAsync(this.samplesFilePath);
      if (!info.exists) return;
      const content = await fs.readAsStringAsync(this.samplesFilePath);
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length > MAX_SAMPLES_RETAINED) {
        const retainedLines = lines.slice(-MAX_SAMPLES_RETAINED);
        await fs.writeAsStringAsync(
          this.samplesFilePath,
          retainedLines.join("\n") + "\n"
        );
      }
    } catch {
      // Ignore compaction errors
    }
  }

  async getSamples(): Promise<DiagnosticSample[]> {
    this.initPaths();
    if (this.memoryFallback) {
      return this.memoryFallback.getSamples();
    }
    const fs = this.getFs();
    return runInDirectoryLock(this.dirPath, async () => {
      try {
        const info = await fs.getInfoAsync(this.samplesFilePath);
        if (!info.exists) return [];
        const content = await fs.readAsStringAsync(this.samplesFilePath);
        const samples: DiagnosticSample[] = [];
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            samples.push(JSON.parse(trimmed) as DiagnosticSample);
          } catch {
            // Skip individual corrupt lines (e.g. from crash during write)
          }
        }
        return samples;
      } catch {
        return [];
      }
    });
  }

  async clear(): Promise<void> {
    this.initPaths();
    if (this.memoryFallback) {
      return this.memoryFallback.clear();
    }
    const fs = this.getFs();
    return runInDirectoryLock(this.dirPath, async () => {
      try {
        await fs.deleteAsync(this.sessionFilePath, { idempotent: true });
        await fs.deleteAsync(this.sessionTmpFilePath, { idempotent: true });
        await fs.deleteAsync(this.samplesFilePath, { idempotent: true });
      } catch {
        // Files might not exist
      }
      this.sampleAppendCount = 0;
    });
  }
}
