import type { LocalRouteDb, LocalRouteRecord } from "./types";

export class ExpoSQLiteRouteDb implements LocalRouteDb {
  private db: unknown = null;

  async init(): Promise<void> {
    if (this.db) return;
    // Lazy require expo-sqlite to avoid failing in non-native test environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SQLite = require("expo-sqlite");
    const database = await SQLite.openDatabaseAsync("local-routes.db");
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
        snapshot_path TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_routes_created ON local_routes (created_at DESC);
    `);
    this.db = database;
  }

  async insertRoute(record: LocalRouteRecord): Promise<void> {
    const database = this.getDb();
    await database.runAsync(
      `INSERT INTO local_routes (
        id, version, name, distance_meters, point_count, segment_count,
        created_at, original_filename, original_gpx_path, snapshot_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
    );
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

  async init(): Promise<void> {
    // No-op for in-memory
  }

  async insertRoute(record: LocalRouteRecord): Promise<void> {
    this.records.set(record.id, { ...record });
  }

  async listRoutes(): Promise<LocalRouteRecord[]> {
    return Array.from(this.records.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async getRoute(id: string): Promise<LocalRouteRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record } : null;
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
    version: Number(row.version),
    name: String(row.name),
    distanceMeters: Number(row.distance_meters),
    pointCount: Number(row.point_count),
    segmentCount: Number(row.segment_count),
    createdAt: String(row.created_at),
    originalFilename:
      typeof row.original_filename === "string" ? row.original_filename : undefined,
    originalGpxPath: String(row.original_gpx_path),
    snapshotPath: String(row.snapshot_path),
  };
}
