import { describe, expect, it } from "vitest";
import type { RouteDocument } from "@ride-maker/domain";
import { LocalRouteStorage, validateRouteInstructions } from "./local-route-storage";
import { ExpoSQLiteRouteDb, InMemoryRouteDb } from "./sqlite-db";
import { SavedRouteCorruptError } from "./types";
import type { FileSystemInterface } from "./file-system-interface";

class MockFileSystem implements FileSystemInterface {
  files = new Map<string, string>();
  dirs = new Set<string>();
  documentDirectory = "file:///app/files";

  async getInfoAsync(uri: string): Promise<{ exists: boolean; isDirectory?: boolean }> {
    if (this.dirs.has(uri)) return { exists: true, isDirectory: true };
    if (this.files.has(uri)) return { exists: true, isDirectory: false };
    return { exists: false };
  }

  async makeDirectoryAsync(uri: string, _options?: { intermediates?: boolean }): Promise<void> {
    this.dirs.add(uri);
  }

  async writeAsStringAsync(uri: string, contents: string): Promise<void> {
    this.files.set(uri, contents);
  }

  async readAsStringAsync(uri: string): Promise<string> {
    const val = this.files.get(uri);
    if (val === undefined) throw new Error(`File not found: ${uri}`);
    return val;
  }

  async deleteAsync(uri: string, _options?: { idempotent?: boolean }): Promise<void> {
    this.files.delete(uri);
    this.dirs.delete(uri);
    // Delete any children
    for (const key of Array.from(this.files.keys())) {
      if (key.startsWith(uri + "/")) this.files.delete(key);
    }
    for (const key of Array.from(this.dirs.keys())) {
      if (key.startsWith(uri + "/")) this.dirs.delete(key);
    }
  }

  async readDirectoryAsync(uri: string): Promise<string[]> {
    const names = new Set<string>();
    const prefix = uri.endsWith("/") ? uri : uri + "/";
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        const rest = file.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) names.add(name);
      }
    }
    for (const dir of this.dirs.keys()) {
      if (dir.startsWith(prefix) && dir !== uri) {
        const rest = dir.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) names.add(name);
      }
    }
    return Array.from(names);
  }
}

function createSampleRouteDoc(id = "sample-route-1", name = "Test Created Ride"): RouteDocument {
  return {
    schemaVersion: 1,
    id,
    name,
    source: { kind: "new" },
    segments: [
      {
        id: "seg-1",
        points: [
          { latitude: 40.785, longitude: -73.968 },
          { latitude: 40.786, longitude: -73.967 },
          { latitude: 40.787, longitude: -73.966 },
        ],
      },
    ],
    controlPoints: [
      { id: "cp-start", kind: "start", latitude: 40.785, longitude: -73.968 },
      { id: "cp-finish", kind: "finish", latitude: 40.787, longitude: -73.966 },
    ],
    waypoints: [],
    maneuvers: [
      {
        id: "m-1",
        segmentIndex: 0,
        shapeIndex: 0,
        instruction: "Head northeast on Park Drive",
        verbalInstruction: "Head northeast",
        latitude: 40.785,
        longitude: -73.968,
      },
      {
        id: "m-2",
        segmentIndex: 0,
        shapeIndex: 2,
        instruction: "You have arrived at your destination",
        latitude: 40.787,
        longitude: -73.966,
      },
    ],
    summary: {
      distanceMeters: 450,
      durationSeconds: 90,
    },
    routing: {
      engine: "valhalla",
      profile: "road",
    },
  };
}

describe("Task004 Storage Contracts", () => {
  it("saves a created route with full maneuvers and derived GPX asset", async () => {
    const db = new InMemoryRouteDb();
    const fs = new MockFileSystem();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();

    const doc = createSampleRouteDoc("created-ride-01", "Central Park Loop");
    const record = await storage.saveCreatedRoute(doc);

    expect(record.id).toBe("created-ride-01");
    expect(record.name).toBe("Central Park Loop");
    expect(record.sourceKind).toBe("created");
    expect(record.hasInstructions).toBe(true);
    expect(record.distanceMeters).toBe(450);
    expect(record.pointCount).toBe(3);
    expect(record.segmentCount).toBe(1);

    // Verify retrieval
    const loaded = await storage.getRoute("created-ride-01");
    expect(loaded.record.sourceKind).toBe("created");
    expect(loaded.record.hasInstructions).toBe(true);
    expect(loaded.document.maneuvers).toHaveLength(2);
    expect(loaded.document.maneuvers[0]?.instruction).toBe("Head northeast on Park Drive");
    expect(loaded.originalGpx).toContain("<gpx");
  });

  it("preserves multi-leg route segments and maneuvers per leg without flattening", async () => {
    const db = new InMemoryRouteDb();
    const fs = new MockFileSystem();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();

    const multiLegDoc: RouteDocument = {
      schemaVersion: 1,
      id: "multi-leg-ride",
      name: "Two Leg Ride",
      source: { kind: "new" },
      segments: [
        {
          id: "seg-1",
          points: [
            { latitude: 40.785, longitude: -73.968 },
            { latitude: 40.786, longitude: -73.967 },
          ],
        },
        {
          id: "seg-2",
          points: [
            { latitude: 40.786, longitude: -73.967 },
            { latitude: 40.787, longitude: -73.966 },
          ],
        },
      ],
      controlPoints: [
        { id: "cp-start", kind: "start", latitude: 40.785, longitude: -73.968 },
        { id: "cp-via", kind: "via", latitude: 40.786, longitude: -73.967 },
        { id: "cp-finish", kind: "finish", latitude: 40.787, longitude: -73.966 },
      ],
      waypoints: [],
      maneuvers: [
        {
          id: "m-leg0",
          segmentIndex: 0,
          shapeIndex: 0,
          instruction: "Depart start.",
          latitude: 40.785,
          longitude: -73.968,
        },
        {
          id: "m-leg1",
          segmentIndex: 1,
          shapeIndex: 1,
          instruction: "Arrive at finish.",
          latitude: 40.787,
          longitude: -73.966,
        },
      ],
      summary: { distanceMeters: 600, durationSeconds: 120 },
    };

    const record = await storage.saveCreatedRoute(multiLegDoc);
    expect(record.segmentCount).toBe(2);
    expect(record.pointCount).toBe(4);

    const loaded = await storage.getRoute("multi-leg-ride");
    expect(loaded.document.segments).toHaveLength(2);
    expect(loaded.document.maneuvers).toHaveLength(2);
    expect(loaded.document.maneuvers[0]?.segmentIndex).toBe(0);
    expect(loaded.document.maneuvers[0]?.shapeIndex).toBe(0);
    expect(loaded.document.maneuvers[1]?.segmentIndex).toBe(1);
    expect(loaded.document.maneuvers[1]?.shapeIndex).toBe(1);

    const validation = validateRouteInstructions(loaded.document);
    expect(validation.ready).toBe(true);
  });

  it("validates instructions and detects missing maneuvers, non-finite coords, or tight geometry mismatch", () => {
    const doc = createSampleRouteDoc("val-doc");

    // Valid doc passes
    expect(validateRouteInstructions(doc).ready).toBe(true);

    // Empty maneuvers fails
    expect(validateRouteInstructions({ ...doc, maneuvers: [] }).ready).toBe(false);

    // Invalid segment index fails
    expect(
      validateRouteInstructions({
        ...doc,
        maneuvers: [{ ...doc.maneuvers[0]!, segmentIndex: 9 }],
      }).ready,
    ).toBe(false);

    // Invalid shape index fails
    expect(
      validateRouteInstructions({
        ...doc,
        maneuvers: [{ ...doc.maneuvers[0]!, shapeIndex: 99 }],
      }).ready,
    ).toBe(false);

    // Non-finite coordinates fail
    expect(
      validateRouteInstructions({
        ...doc,
        maneuvers: [{ ...doc.maneuvers[0]!, latitude: NaN }],
      }).ready,
    ).toBe(false);

    // 0.0005 degrees mismatch (~50m) must be rejected under strict < 1e-6 check
    expect(
      validateRouteInstructions({
        ...doc,
        maneuvers: [{ ...doc.maneuvers[0]!, latitude: 40.7855 }],
      }).ready,
    ).toBe(false);

    // Empty instruction text fails
    expect(
      validateRouteInstructions({
        ...doc,
        maneuvers: [{ ...doc.maneuvers[0]!, instruction: "   " }],
      }).ready,
    ).toBe(false);
  });

  it("renames a ride atomically while keeping original GPX bytes intact", async () => {
    const db = new InMemoryRouteDb();
    const fs = new MockFileSystem();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();

    const doc = createSampleRouteDoc("ride-to-rename", "Original Title");
    await storage.saveCreatedRoute(doc);

    const initialGpx = fs.files.get("file:///app/files/local_routes/data/ride-to-rename/original.gpx");
    expect(initialGpx).toBeDefined();

    // Perform rename
    const updatedRecord = await storage.renameRoute("ride-to-rename", "Updated Title");
    expect(updatedRecord.name).toBe("Updated Title");

    // Check DB and loaded document
    const loaded = await storage.getRoute("ride-to-rename");
    expect(loaded.record.name).toBe("Updated Title");
    expect(loaded.document.name).toBe("Updated Title");

    // CRITICAL: original.gpx must NOT be touched or modified
    const gpxAfterRename = fs.files.get("file:///app/files/local_routes/data/ride-to-rename/original.gpx");
    expect(gpxAfterRename).toBe(initialGpx);
  });

  it("recovers from process crash during rename before DB update", async () => {
    const db = new InMemoryRouteDb();
    const fs = new MockFileSystem();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();

    const doc = createSampleRouteDoc("crash-ride", "Original Name");
    await storage.saveCreatedRoute(doc);

    // Simulate crash after writing updated snapshot and creating .bak, but before DB update:
    const dataDir = "file:///app/files/local_routes/data/crash-ride";
    await fs.writeAsStringAsync(`${dataDir}/route.json.bak`, JSON.stringify(doc));
    await fs.writeAsStringAsync(
      `${dataDir}/route.json`,
      JSON.stringify({ ...doc, name: "Uncommitted Interrupted Name" }),
    );
    await fs.writeAsStringAsync(`${dataDir}/route.json.tmp`, "stale tmp");

    // Simulate app restart by constructing new storage and init()
    const restartStorage = new LocalRouteStorage(db, fs);
    await restartStorage.init();

    // Tmp file cleaned
    expect(fs.files.has(`${dataDir}/route.json.tmp`)).toBe(false);
    // Bak file cleaned
    expect(fs.files.has(`${dataDir}/route.json.bak`)).toBe(false);

    // Document restored to match DB original name
    const loaded = await restartStorage.getRoute("crash-ride");
    expect(loaded.record.name).toBe("Original Name");
    expect(loaded.document.name).toBe("Original Name");
  });

  it("recovers from process crash after DB update where .bak cleanup was interrupted", async () => {
    const db = new InMemoryRouteDb();
    const fs = new MockFileSystem();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();

    const doc = createSampleRouteDoc("post-commit-crash", "Original Name");
    await storage.saveCreatedRoute(doc);

    // DB committed with new name, live file has new name, but .bak still lingering
    const dataDir = "file:///app/files/local_routes/data/post-commit-crash";
    await db.updateRouteName("post-commit-crash", "Committed New Name");
    await fs.writeAsStringAsync(
      `${dataDir}/route.json`,
      JSON.stringify({ ...doc, name: "Committed New Name" }),
    );
    await fs.writeAsStringAsync(`${dataDir}/route.json.bak`, JSON.stringify(doc));

    const restartStorage = new LocalRouteStorage(db, fs);
    await restartStorage.init();

    // Since live snapshot matches committed DB name, recovery cleanly removes .bak
    expect(fs.files.has(`${dataDir}/route.json.bak`)).toBe(false);
    const loaded = await restartStorage.getRoute("post-commit-crash");
    expect(loaded.record.name).toBe("Committed New Name");
    expect(loaded.document.name).toBe("Committed New Name");
  });

  it("recovers from partial/corrupt live snapshot using valid backup", async () => {
    const db = new InMemoryRouteDb();
    const fs = new MockFileSystem();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();

    const doc = createSampleRouteDoc("corrupt-live-crash", "Safe Original Name");
    await storage.saveCreatedRoute(doc);

    const dataDir = "file:///app/files/local_routes/data/corrupt-live-crash";
    // Corrupted live write
    await fs.writeAsStringAsync(`${dataDir}/route.json`, "{ corrupted json truncation");
    await fs.writeAsStringAsync(`${dataDir}/route.json.bak`, JSON.stringify(doc));

    const restartStorage = new LocalRouteStorage(db, fs);
    await restartStorage.init();

    expect(fs.files.has(`${dataDir}/route.json.bak`)).toBe(false);
    const loaded = await restartStorage.getRoute("corrupt-live-crash");
    expect(loaded.record.name).toBe("Safe Original Name");
    expect(loaded.document.name).toBe("Safe Original Name");
  });

  it("refuses rename if an unresolved backup journal already exists", async () => {
    const db = new InMemoryRouteDb();
    const fs = new MockFileSystem();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();

    const doc = createSampleRouteDoc("pending-bak-ride", "Initial Name");
    await storage.saveCreatedRoute(doc);

    const dataDir = "file:///app/files/local_routes/data/pending-bak-ride";
    await fs.writeAsStringAsync(`${dataDir}/route.json.bak`, "unresolved journal");

    await expect(
      storage.renameRoute("pending-bak-ride", "Another Name"),
    ).rejects.toThrow(/unresolved backup journal exists/);
  });

  it("getRoute rejects mismatched metadata name or provenance at load", async () => {
    const db = new InMemoryRouteDb();
    const fs = new MockFileSystem();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();

    const doc = createSampleRouteDoc("tampered-ride", "Document Name");
    await storage.saveCreatedRoute(doc);

    // Tamper with SQLite record name
    await db.updateRouteName("tampered-ride", "Mismatched DB Name");
    await expect(storage.getRoute("tampered-ride")).rejects.toThrow(SavedRouteCorruptError);

    // Restore name, tamper with provenance
    await db.updateRouteName("tampered-ride", "Document Name");
    const rec = (await db.getRoute("tampered-ride"))!;
    await db.deleteRoute("tampered-ride");
    await db.insertRoute({ ...rec, sourceKind: "imported" }); // DB says imported, but doc.source.kind is "new"

    await expect(storage.getRoute("tampered-ride")).rejects.toThrow(SavedRouteCorruptError);
  });

  it("deletes a route DB-first, keeping assets safe if DB delete fails and cleaning orphans on restart", async () => {
    const db = new InMemoryRouteDb();
    const fs = new MockFileSystem();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();

    const doc = createSampleRouteDoc("ride-to-delete", "To Delete");
    await storage.saveCreatedRoute(doc);

    expect(await db.getRoute("ride-to-delete")).not.toBeNull();
    expect(fs.files.has("file:///app/files/local_routes/data/ride-to-delete/route.json")).toBe(true);

    // If DB delete fails, route remains untouched
    const failingDb = {
      ...db,
      init: db.init.bind(db),
      getRoute: db.getRoute.bind(db),
      listRoutes: db.listRoutes.bind(db),
      insertRoute: db.insertRoute.bind(db),
      updateRouteName: db.updateRouteName.bind(db),
      close: db.close.bind(db),
      deleteRoute: async () => {
        throw new Error("DB delete failed");
      },
    };
    const storageWithFailingDb = new LocalRouteStorage(failingDb, fs);
    await storageWithFailingDb.init();
    await expect(storageWithFailingDb.deleteRoute("ride-to-delete")).rejects.toThrow("DB delete failed");

    // Assets are still intact
    expect(fs.files.has("file:///app/files/local_routes/data/ride-to-delete/route.json")).toBe(true);

    // Normal delete: DB deleted first
    await storage.deleteRoute("ride-to-delete");
    expect(await db.getRoute("ride-to-delete")).toBeNull();
    expect(fs.files.has("file:///app/files/local_routes/data/ride-to-delete/route.json")).toBe(false);

    // Simulate orphaned folder (e.g. process crashed before fs delete)
    await fs.makeDirectoryAsync("file:///app/files/local_routes/data/orphan-dir");
    await fs.writeAsStringAsync("file:///app/files/local_routes/data/orphan-dir/route.json", "{}");

    // On next init(), cleanDataOrphans cleans it
    const newStorage = new LocalRouteStorage(db, fs);
    await newStorage.init();
    expect(fs.files.has("file:///app/files/local_routes/data/orphan-dir/route.json")).toBe(false);
  });

  it("handles SQLite migration to add source_kind and fails with retryable init on error", async () => {
    let tableCols = ["id", "version", "name"]; // Missing source_kind (legacy v1 table)
    let shouldFailAlter = true;

    const mockDb = {
      execAsync: async (sql: string) => {
        if (sql.includes("ALTER TABLE local_routes ADD COLUMN source_kind") && shouldFailAlter) {
          throw new Error("Disk I/O error during migration");
        }
        if (sql.includes("ALTER TABLE local_routes ADD COLUMN source_kind")) {
          tableCols.push("source_kind");
        }
      },
      getAllAsync: async (sql: string) => {
        if (sql.includes("PRAGMA table_info")) {
          return tableCols.map((c) => ({ name: c }));
        }
        return [];
      },
      getFirstAsync: async () => null,
      runAsync: async () => ({}),
      closeAsync: async () => {},
    };

    const mockSqlite = {
      openDatabaseAsync: async () => mockDb,
    };

    const sqliteDb = new ExpoSQLiteRouteDb(mockSqlite);

    // First attempt fails migration
    await expect(sqliteDb.init()).rejects.toThrow("Disk I/O error during migration");

    // Second attempt (retry) succeeds after migration issue resolved
    shouldFailAlter = false;
    await expect(sqliteDb.init()).resolves.toBeUndefined();
    expect(tableCols).toContain("source_kind");
  });
});
