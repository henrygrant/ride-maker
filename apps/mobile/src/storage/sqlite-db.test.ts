import { describe, expect, it } from "vitest";
import { ExpoSQLiteRouteDb } from "./sqlite-db";
import type { LocalRouteRecord } from "./types";
import { StalePreparationError } from "./types";

type Row = Record<string, unknown>;

class LegacySQLiteFixture {
  readonly schema: string[];
  readonly rows = new Map<string, Row>();
  readonly execStatements: string[] = [];
  readonly runStatements: Array<{ sql: string; params: unknown[] }> = [];

  constructor(columns: string[], row: Row) {
    this.schema = [...columns];
    this.rows.set(String(row.id), { ...row });
  }

  async openDatabaseAsync(): Promise<unknown> { return this; }
  async execAsync(sql: string): Promise<void> {
    this.execStatements.push(sql);
    const alter = sql.match(/ALTER TABLE local_routes ADD COLUMN ([a-z_]+)(?:\s+[^;]+)?/iu);
    if (alter && !this.schema.includes(alter[1]!)) {
      const name = alter[1]!;
      this.schema.push(name);
      for (const row of this.rows.values()) row[name] = name === "revision" ? 0 : name === "has_instructions" ? 0 : null;
    }
  }
  async getAllAsync(sql: string): Promise<Row[]> {
    if (sql.includes("PRAGMA table_info")) return this.schema.map((name, cid) => ({ cid, name }));
    if (sql.includes("SELECT * FROM local_routes")) return [...this.rows.values()].map((row) => ({ ...row }));
    return [];
  }
  async getFirstAsync(sql: string, params: unknown[] = []): Promise<Row | null> {
    if (sql.includes("SELECT * FROM local_routes WHERE id")) {
      const row = this.rows.get(String(params[0]));
      return row ? { ...row } : null;
    }
    return null;
  }
  async runAsync(sql: string, params: unknown[] = []): Promise<unknown> {
    this.runStatements.push({ sql, params });
    if (sql.startsWith("UPDATE local_routes SET storage_identity")) {
      const row = this.rows.get(String(params[1]));
      if (row) row.storage_identity = params[0];
      return;
    }
    if (sql.startsWith("UPDATE local_routes SET active_preparation_id")) {
      const id = String(params[5]);
      const row = this.rows.get(id);
      if (!row || Number(row.revision ?? 0) !== Number(params[6]) || row.storage_identity !== params[7])
        return { changes: 0 };
      if (row) Object.assign(row, { active_preparation_id: params[0], version: 3,
        distance_meters: params[1], point_count: params[2], segment_count: params[3],
        has_instructions: params[4], revision: Number(row.revision ?? 0) + 1 });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE local_routes SET name")) {
      const row = this.rows.get(String(params[1]));
      if (row) { row.name = params[0]; row.revision = Number(row.revision ?? 0) + 1; }
      return;
    }
  }
  async closeAsync(): Promise<void> {}
}

const legacyColumns = ["id", "version", "name", "distance_meters", "point_count", "segment_count",
  "created_at", "original_filename", "original_gpx_path", "snapshot_path"];

function legacyRow(version: number): Row {
  return { id: `legacy-${version}`, version, name: "Legacy", distance_meters: 4321,
    point_count: 17, segment_count: 2, created_at: "2026-10-14T12:00:00.000Z",
    original_filename: "recorded.gpx", original_gpx_path: `file:///private/data/legacy-${version}/original.gpx`,
    snapshot_path: `file:///private/data/legacy-${version}/route.json`,
    ...(version === 2 ? { source_kind: "imported", has_instructions: 0 } : {}) };
}

describe("SQLite prepared-route migrations", () => {
  for (const version of [1, 2]) {
    it(`adds v3 columns to v${version} without changing saved row values`, async () => {
      const columns = version === 1 ? legacyColumns : [...legacyColumns, "source_kind", "has_instructions"];
      const sqlite = new LegacySQLiteFixture(columns, legacyRow(version));
      const db = new ExpoSQLiteRouteDb(sqlite);
      await db.init();

      const row = await db.getRoute(`legacy-${version}`);
      expect(row).toMatchObject({ id: `legacy-${version}`, version, name: "Legacy",
        distanceMeters: 4321, pointCount: 17, segmentCount: 2,
        originalFilename: "recorded.gpx", originalGpxPath: `file:///private/data/legacy-${version}/original.gpx`,
        snapshotPath: `file:///private/data/legacy-${version}/route.json`, sourceKind: "imported",
        hasInstructions: false, activePreparationId: null, revision: 0 });
      expect(row?.storageIdentity).toBeTruthy();
      expect(sqlite.schema).toContain("active_preparation_id");
      expect(sqlite.schema).toContain("revision");
      expect(sqlite.rows.get(`legacy-${version}`)?.original_filename).toBe("recorded.gpx");
      expect(sqlite.rows.get(`legacy-${version}`)?.snapshot_path).toBe(`file:///private/data/legacy-${version}/route.json`);

      const beforeStatements = sqlite.runStatements.length;
      await db.commitActivePreparation({ id: `legacy-${version}`, version: 3,
        expectedRevision: row?.revision ?? 0, expectedStorageIdentity: row?.storageIdentity ?? "",
        activePreparationId: "prepared-a", distanceMeters: 1234, pointCount: 9,
        segmentCount: 1, hasInstructions: true });
      const after = await db.getRoute(`legacy-${version}`);
      expect(after).toMatchObject({ version: 3, revision: 1, activePreparationId: "prepared-a",
        distanceMeters: 1234, pointCount: 9, segmentCount: 1, hasInstructions: true });
      expect(sqlite.runStatements).toHaveLength(beforeStatements + 1);
      expect(sqlite.runStatements.at(-1)?.sql.match(/UPDATE local_routes/gu)).toHaveLength(1);
    });
  }

  it("migrates real SQLite v1 and v2 databases without altering original data or asset paths", async () => {
    type NativeStatement = {
      all(...params: Array<string | number | null>): Row[];
      get(...params: Array<string | number | null>): Row | undefined;
      run(...params: Array<string | number | null>): unknown;
    };
    type NativeDatabase = {
      exec(sql: string): void;
      prepare(sql: string): NativeStatement;
      close(): void;
    };
    const sqliteModule = require("node:sqlite") as { DatabaseSync: new (name: string) => NativeDatabase };
    for (const version of [1, 2]) {
      const native = new sqliteModule.DatabaseSync(":memory:");
      const cols = legacyColumns.map((col) => `${col} ${col === "id" ? "TEXT PRIMARY KEY" : "TEXT"}`);
      for (const numeric of ["version", "distance_meters", "point_count", "segment_count"])
        cols[legacyColumns.indexOf(numeric)] = `${numeric} INTEGER`;
      if (version === 2) cols.push("source_kind TEXT", "has_instructions INTEGER");
      native.exec(`CREATE TABLE local_routes (${cols.join(", ")})`);
      const row = legacyRow(version);
      const keys = Object.keys(row);
      native.prepare(`INSERT INTO local_routes (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
        .run(...keys.map((key) => row[key] as string | number | null));
      const driver = { openDatabaseAsync: async () => ({
        execAsync: async (sql: string) => native.exec(sql),
        getAllAsync: async (sql: string, params: unknown[] = []) => native.prepare(sql).all(...params as Array<string | number | null>),
        getFirstAsync: async (sql: string, params: unknown[] = []) => native.prepare(sql).get(...params as Array<string | number | null>) ?? null,
        runAsync: async (sql: string, params: unknown[] = []) => native.prepare(sql).run(...params as Array<string | number | null>),
        closeAsync: async () => native.close(),
      }) };
      const db = new ExpoSQLiteRouteDb(driver);
      await db.init();
      const migrated = await db.getRoute(`legacy-${version}`);
      expect(migrated).toMatchObject({ version, name: "Legacy", distanceMeters: 4321, pointCount: 17,
        segmentCount: 2, originalFilename: "recorded.gpx", originalGpxPath: row.original_gpx_path,
        snapshotPath: row.snapshot_path, sourceKind: "imported", activePreparationId: null, revision: 0 });
      expect(migrated?.storageIdentity).toBeTruthy();
      expect(native.prepare("PRAGMA table_info(local_routes)").all().map((column) => column.name))
        .toEqual(expect.arrayContaining(["active_preparation_id", "revision", "storage_identity"]));
      expect(native.prepare("SELECT original_gpx_path, snapshot_path, original_filename FROM local_routes WHERE id = ?")
        .get(`legacy-${version}`)).toMatchObject({ original_gpx_path: row.original_gpx_path,
          snapshot_path: row.snapshot_path, original_filename: "recorded.gpx" });
      const expected = migrated!;
      const publication = { id: expected.id, version: 3, expectedRevision: expected.revision ?? 0,
        expectedStorageIdentity: expected.storageIdentity!, activePreparationId: "prepared-cas",
        distanceMeters: 1234, pointCount: 9, segmentCount: 1, hasInstructions: true };
      await db.commitActivePreparation(publication);
      await expect(db.commitActivePreparation({ ...publication, activePreparationId: "prepared-stale" }))
        .rejects.toBeInstanceOf(StalePreparationError);
      expect((await db.getRoute(expected.id))?.activePreparationId).toBe("prepared-cas");
      await db.close();
    }
  });
});
