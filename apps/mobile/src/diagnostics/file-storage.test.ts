import { describe, expect, it } from "vitest";
import { FileSystemDiagnosticStorage, FileSystemInterface } from "./file-storage";
import { DiagnosticSample, DiagnosticSession } from "./types";

class FakeFileSystem implements FileSystemInterface {
  documentDirectory = "file:///data/user/0/com.ridemaker/files/";
  files = new Map<string, string>();
  readDelayMs = 0;
  writeDelayMs = 0;

  async getInfoAsync(fileUri: string): Promise<{ exists: boolean }> {
    return { exists: this.files.has(fileUri) };
  }

  async makeDirectoryAsync(_fileUri: string): Promise<void> {
    // No-op for in-memory fake
  }

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

describe("FileSystemDiagnosticStorage with FakeFileSystem", () => {
  it("persists and reads session through atomic writes", async () => {
    const fs = new FakeFileSystem();
    const storage = new FileSystemDiagnosticStorage(
      "file:///data/user/0/com.ridemaker/files/diag/",
      fs
    );

    const session: DiagnosticSession = {
      sessionId: "s1",
      version: 1,
      status: "running",
      startedAt: 1000,
      sampleCount: 0,
      spokenCueIds: [],
      cuesLog: [],
    };

    await storage.saveSession(session);
    const read = await storage.getSession();
    expect(read?.sessionId).toBe("s1");
    expect(read?.status).toBe("running");
  });

  it("recovers from temporary session file if main file was interrupted", async () => {
    const fs = new FakeFileSystem();
    const storage = new FileSystemDiagnosticStorage(
      "file:///data/user/0/com.ridemaker/files/diag/",
      fs
    );

    const session: DiagnosticSession = {
      sessionId: "s-tmp",
      version: 1,
      status: "running",
      startedAt: 2000,
      sampleCount: 0,
      spokenCueIds: [],
      cuesLog: [],
    };

    // Simulate an interrupted write where only .tmp exists
    fs.files.set(
      "file:///data/user/0/com.ridemaker/files/diag/session.json.tmp",
      JSON.stringify(session)
    );

    const read = await storage.getSession();
    expect(read?.sessionId).toBe("s-tmp");
  });

  it("appends samples without rewriting entire file every fix and tolerates corrupt lines", async () => {
    const fs = new FakeFileSystem();
    const storage = new FileSystemDiagnosticStorage(
      "file:///data/user/0/com.ridemaker/files/diag/",
      fs
    );

    await storage.saveSession({
      sessionId: "s-samples",
      version: 1,
      status: "running",
      startedAt: 1000,
      sampleCount: 0,
      spokenCueIds: [],
      cuesLog: [],
    });

    const sample1: DiagnosticSample = {
      timestamp: 1000,
      accuracy: 5,
      latitude: 40.71,
      longitude: -74.0,
      speed: 5.5,
      heading: 180,
    };
    await storage.recordSample(sample1);

    // Corrupt one line (e.g. power cutoff)
    const samplesPath = "file:///data/user/0/com.ridemaker/files/diag/samples.jsonl";
    const existing = fs.files.get(samplesPath) ?? "";
    fs.files.set(samplesPath, existing + "{corrupt-incomplete-json\n");

    const sample2: DiagnosticSample = {
      timestamp: 2000,
      accuracy: 4,
      latitude: 40.72,
      longitude: -74.01,
      speed: 6.0,
      heading: 185,
    };
    await storage.recordSample(sample2);

    const allSamples = await storage.getSamples();
    expect(allSamples.length).toBe(2);
    expect(allSamples[0]?.timestamp).toBe(1000);
    expect(allSamples[1]?.timestamp).toBe(2000);
  });

  it("serializes concurrent instances operating on the same directory", async () => {
    const fs = new FakeFileSystem();
    fs.writeDelayMs = 10;
    const dir = "file:///data/user/0/com.ridemaker/files/shared-diag/";

    const instance1 = new FileSystemDiagnosticStorage(dir, fs);
    const instance2 = new FileSystemDiagnosticStorage(dir, fs);

    await instance1.saveSession({
      sessionId: "concurrent-test",
      version: 1,
      status: "running",
      startedAt: 1000,
      sampleCount: 0,
      spokenCueIds: [],
      cuesLog: [],
    });

    // Record sample on instance 1 and read session on instance 2 concurrently
    const [_, sessionRead] = await Promise.all([
      instance1.recordSample({
        timestamp: 1500,
        accuracy: 3,
        latitude: 1,
        longitude: 1,
        speed: 1,
        heading: 0,
      }),
      instance2.getSession(),
    ]);

    expect(sessionRead).not.toBeNull();
    expect(sessionRead?.sessionId).toBe("concurrent-test");
  });

  it("prevents stale running session from overwriting stopped session on disk", async () => {
    const fs = new FakeFileSystem();
    const dir = "file:///data/user/0/com.ridemaker/files/stop-guard/";
    const storage = new FileSystemDiagnosticStorage(dir, fs);

    await storage.saveSession({
      sessionId: "guard-test",
      version: 2,
      status: "stopped",
      startedAt: 1000,
      stoppedAt: 2000,
      sampleCount: 5,
      spokenCueIds: ["diag-start"],
      cuesLog: [],
    });

    // Attempt to write an older/stale running snapshot
    await storage.saveSession({
      sessionId: "guard-test",
      version: 1,
      status: "running",
      startedAt: 1000,
      sampleCount: 4,
      spokenCueIds: [],
      cuesLog: [],
    });

    const current = await storage.getSession();
    expect(current?.status).toBe("stopped");
    expect(current?.version).toBe(2);
  });

  it("clears files on clear()", async () => {
    const fs = new FakeFileSystem();
    const dir = "file:///data/user/0/com.ridemaker/files/clear-test/";
    const storage = new FileSystemDiagnosticStorage(dir, fs);

    await storage.saveSession({
      sessionId: "to-clear",
      version: 1,
      status: "running",
      startedAt: 1000,
      sampleCount: 0,
      spokenCueIds: [],
      cuesLog: [],
    });

    await storage.clear();
    const read = await storage.getSession();
    expect(read).toBeNull();
    const samples = await storage.getSamples();
    expect(samples.length).toBe(0);
  });
});
