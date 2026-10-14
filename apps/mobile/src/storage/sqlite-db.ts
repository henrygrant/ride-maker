import type { LocalRouteDb, LocalRouteRecord } from "./types";

export class ExpoSQLiteRouteDb implements LocalRouteDb {
  private db: unknown = null;
  private readonly sqliteModule: unknown;

  constructor(customSqlite?: unknown) {
    this.sqliteModule = customSqlite ?? null;
  }

  async init(): Promise<void> {
    if (this.db) return;
    try {
      // Lazy require expo-sqlite to avoid failing in non-native test environments unless injected
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SQLite = (this.sqliteModule as { openDatabaseAsync: (name: string) => Promise<unknown> }) ?? require("expo-sqlite");
      const database = (await SQLite.openDatabaseAsync("local-routes.db")) as {
        execAsync: (sql: string) => Promise<void>;
        getAllAsync: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
        getFirstAsync: (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>;
        runAsync: (sql: string, params?: unknown[]) => Promise<unknown>;
        closeAsync: () => Promise<void>;
      };

      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS local_routes (
          id TEXT PRIMARY KEY,
          version INTEGER NOT NULL DEFAULT 1,
          name TEXT NOT NULL,
          distance_meters REAL NOT NULL,
          point_count INTEGER NOT NULL,
          segment_count INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          original_filename TEXT,
          original_gpx_path TEXT NOT NULL,
          snapshot_path TEXT NOT NULL,
          source_kind TEXT NOT NULL DEFAULT 'imported',
          has_instructions INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_local_routes_created ON local_routes (created_at DESC);
      `);

      // Additive migration: check if source_kind and has_instructions columns exist
      const tableInfo = (await database.getAllAsync("PRAGMA table_info(local_routes);")) as Array<{
        name?: unknown;
      }>;
      const hasSourceKind = tableInfo.some((col) => col.name === "source_kind");
      if (!hasSourceKind) {
        await database.execAsync(
          "ALTER TABLE local_routes ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'imported';",
        );
      }

      const hasInstructions = tableInfo.some((col) => col.name === "has_instructions");
      if (!hasInstructions) {
        await database.execAsync(
          "ALTER TABLE local_routes ADD COLUMN has_instructions INTEGER NOT NULL DEFAULT 0;",
        );
      }

      this.db = database;
    } catch (err) {
      this.db = null;
      throw err;
    }
  }

  async insertRoute(record: LocalRouteRecord): Promise<void> {
    const database = this.getDb();
    await database.runAsync(
      `INSERT INTO local_routes (
        id, version, name, distance_meters, point_count, segment_count,
        created_at, original_filename, original_gpx_path, snapshot_path, source_kind, has_instructions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.version,
        record.name,
        record.distanceMeters,
        record.pointCount,
        record.segmentCount,
        record.createdAt,
        record.originalFilename ?? null,
        record.originalGpxPath,
        record.snapshotPath,
        record.sourceKind ?? "imported",
        record.hasInstructions ? 1 : 0,
      ],
    );
  }

  async updateRouteName(id: string, name: string): Promise<void> {
    const database = this.getDb();
    await database.runAsync("UPDATE local_routes SET name = ? WHERE id = ?", [name, id]);
  }

  async listRoutes(): Promise<LocalRouteRecord[]> {
    const database = this.getDb();
    const rows = await database.getAllAsync(
      "SELECT * FROM local_routes ORDER BY created_at DESC",
    );
    return rows.map(rowToRecord);
  }

  async getRoute(id: string): Promise<LocalRouteRecord | null> {
    const database = this.getDb();
    const row = await database.getFirstAsync(
      "SELECT * FROM local_routes WHERE id = ?",
      [id],
    );
    return row ? rowToRecord(row) : null;
  }

  async deleteRoute(id: string): Promise<void> {
    const database = this.getDb();
    await database.runAsync("DELETE FROM local_routes WHERE id = ?", [id]);
  }

  async close(): Promise<void> {
    if (this.db) {
      await (this.db as { closeAsync: () => Promise<void> }).closeAsync();
      this.db = null;
    }
  }

  private getDb(): {
    runAsync: (sql: string, params?: unknown[]) => Promise<unknown>;
    getAllAsync: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    getFirstAsync: (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>;
  } {
    if (!this.db) throw new Error("Database not initialized. Call init() first.");
    return this.db as {
      runAsync: (sql: string, params?: unknown[]) => Promise<unknown>;
      getAllAsync: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
      getFirstAsync: (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>;
    };
  }
}

export class InMemoryRouteDb implements LocalRouteDb {
  private records = new Map<string, LocalRouteRecord>();

  async init(): Promise<void> {}

  async insertRoute(record: LocalRouteRecord): Promise<void> {
    this.records.set(record.id, { ...record });
  }

  async updateRouteName(id: string, name: string): Promise<void> {
    const existing = this.records.get(id);
    if (!existing) return;
    this.records.set(id, { ...existing, name });
  }

  async listRoutes(): Promise<LocalRouteRecord[]> {
    return Array.from(this.records.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async getRoute(id: string): Promise<LocalRouteRecord | null> {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }

  async deleteRoute(id: string): Promise<void> {
    this.records.delete(id);
  }

  async close(): Promise<void> {
    this.records.clear();
  }
}

function rowToRecord(row: Record<string, unknown>): LocalRouteRecord {
  return {
    id: String(row.id),
    version: Number(row.version ?? 1),
    name: String(row.name),
    distanceMeters: Number(row.distance_meters),
    pointCount: Number(row.point_count),
    segmentCount: Number(row.segment_count),
    createdAt: String(row.created_at),
    originalFilename: row.original_filename ? String(row.original_filename) : undefined,
    originalGpxPath: String(row.original_gpx_path),
    snapshotPath: String(row.snapshot_path),
    sourceKind: row.source_kind === "created" ? "created" : "imported",
    hasInstructions: Boolean(row.has_instructions),
  };
}
