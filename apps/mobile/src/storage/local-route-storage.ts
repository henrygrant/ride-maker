import { ROUTE_DOCUMENT_SCHEMA_VERSION, type RouteDocument } from "@ride-maker/domain";
import type { FileSystemInterface } from "./file-system-interface";
import {
  LOCAL_RECORD_VERSION,
  SavedRouteCorruptError,
  SavedRouteNotFoundError,
  type LocalRouteDb,
  type LocalRouteRecord,
  type SavedLocalRoute,
} from "./types";

export type SaveRouteParams = {
  stagedGpxPath?: string | undefined;
  gpxContent?: string | undefined;
  document: RouteDocument;
  originalFilename?: string | undefined;
  distanceMeters: number;
};

export class LocalRouteStorage {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private opLock: Promise<unknown> = Promise.resolve();
  private readonly baseDir: string;

  constructor(
    private readonly db: LocalRouteDb,
    private readonly fs: FileSystemInterface,
    customBaseDir?: string,
  ) {
    const docDir = fs.documentDirectory ?? "file:///data/user/0/net.thg3.ridemaker/files/";
    this.baseDir = normalize(customBaseDir ?? `${docDir}/local_routes`);
  }

  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.opLock.then(
      async () => operation(),
      async () => operation(),
    );
    this.opLock = next.catch(() => {});
    return next;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    const doInit = async () => {
      if (this.initialized) return;
      await this.db.init();

      await this.fs.makeDirectoryAsync(this.baseDir, { intermediates: true });
      await this.fs.makeDirectoryAsync(`${this.baseDir}/_staging`, { intermediates: true });
      await this.fs.makeDirectoryAsync(`${this.baseDir}/data`, { intermediates: true });

      await this.cleanStagingOrphans();
      await this.cleanDataOrphans();
      this.initialized = true;
    };

    const promise = doInit().catch((err) => {
      this.initPromise = null;
      throw err;
    });

    this.initPromise = promise;
    return promise;
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  getStagingDir(): string {
    return `${this.baseDir}/_staging`;
  }

  async saveImportedRoute(params: SaveRouteParams): Promise<LocalRouteRecord> {
    if (!this.initialized) await this.init();

    return this.runSerialized(async () => {
      const { stagedGpxPath, gpxContent, document, originalFilename, distanceMeters } = params;
      const routeId = document.id;
      const targetDir = `${this.baseDir}/data/${routeId}`;
      const originalGpxPath = `${targetDir}/original.gpx`;
      const snapshotPath = `${targetDir}/route.json`;

      const pointCount = document.segments.reduce((sum, s) => sum + s.points.length, 0);
      const segmentCount = document.segments.length;
      const createdAt = new Date().toISOString();

      const record: LocalRouteRecord = {
        id: routeId,
        version: LOCAL_RECORD_VERSION,
        name: document.name,
        distanceMeters,
        pointCount,
        segmentCount,
        createdAt,
        ...(originalFilename !== undefined ? { originalFilename } : {}),
        originalGpxPath,
        snapshotPath,
      };

      const existingRecord = await this.db.getRoute(routeId);
      const existingDir = await this.fs.getInfoAsync(targetDir);
      const alreadyExisted = Boolean(existingRecord) || existingDir.exists;
      if (alreadyExisted) {
        throw new Error("A route with this ID already exists. Existing route data was preserved.");
      }

      let dirCreated = false;
      try {
        if (!existingDir.exists) {
          await this.fs.makeDirectoryAsync(targetDir, { intermediates: true });
          dirCreated = true;
        }

        if (stagedGpxPath && this.fs.copyAsync) {
          await this.fs.copyAsync({ from: stagedGpxPath, to: originalGpxPath });
        } else if (stagedGpxPath) {
          const content = await this.fs.readAsStringAsync(stagedGpxPath);
          await this.fs.writeAsStringAsync(originalGpxPath, content);
        } else if (gpxContent !== undefined) {
          await this.fs.writeAsStringAsync(originalGpxPath, gpxContent);
        } else {
          throw new Error("No GPX content or staged file provided.");
        }

        await this.fs.writeAsStringAsync(snapshotPath, JSON.stringify(document));

        const gpxInfo = await this.fs.getInfoAsync(originalGpxPath);
        const snapInfo = await this.fs.getInfoAsync(snapshotPath);
        if (!gpxInfo.exists || !snapInfo.exists) {
          throw new Error("Failed to verify written route files.");
        }

        // SQLite commit only after all durable assets are written
        await this.db.insertRoute(record);
        return record;
      } catch (cause) {
        // Prevent deleting valid existing assets on ID collision or repeated save
        if (dirCreated && !alreadyExisted) {
          try {
            await this.fs.deleteAsync(targetDir, { idempotent: true });
          } catch {
            // Ignore deletion error during rollback
          }
        }
        throw cause;
      }
    });
  }

  async listRoutes(): Promise<LocalRouteRecord[]> {
    if (!this.initialized) await this.init();
    return this.db.listRoutes();
  }

  async getRoute(id: string): Promise<SavedLocalRoute> {
    if (!this.initialized) await this.init();

    const record = await this.db.getRoute(id);
    if (!record) {
      throw new SavedRouteNotFoundError(`Saved route '${id}' was not found.`);
    }

    if (record.version !== LOCAL_RECORD_VERSION) {
      throw new SavedRouteCorruptError(
        `Unsupported local route record version: ${record.version}`,
      );
    }

    if (
      record.id !== id ||
      typeof record.name !== "string" ||
      record.name.trim() === "" ||
      typeof record.distanceMeters !== "number" ||
      !Number.isFinite(record.distanceMeters) ||
      record.distanceMeters < 0 ||
      typeof record.pointCount !== "number" ||
      !Number.isInteger(record.pointCount) ||
      record.pointCount < 2 ||
      typeof record.segmentCount !== "number" ||
      !Number.isInteger(record.segmentCount) ||
      record.segmentCount < 1 ||
      typeof record.createdAt !== "string" ||
      Number.isNaN(Date.parse(record.createdAt)) ||
      (record.originalFilename !== undefined && typeof record.originalFilename !== "string")
    ) {
      throw new SavedRouteCorruptError(
        `Invalid local route record metadata for route '${id}'`,
      );
    }

    const expectedGpxPath = `${this.baseDir}/data/${id}/original.gpx`;
    const expectedSnapshotPath = `${this.baseDir}/data/${id}/route.json`;
    if (
      record.originalGpxPath !== expectedGpxPath ||
      record.snapshotPath !== expectedSnapshotPath
    ) {
      throw new SavedRouteCorruptError(
        `Invalid route asset storage path: path outside expected private route location`,
      );
    }

    let snapshotContent: string;
    try {
      const snapInfo = await this.fs.getInfoAsync(record.snapshotPath);
      if (!snapInfo.exists) {
        throw new SavedRouteCorruptError(
          `Could not open saved route: route snapshot file is missing.`,
        );
      }
      snapshotContent = await this.fs.readAsStringAsync(record.snapshotPath);
    } catch (cause) {
      if (cause instanceof SavedRouteCorruptError) throw cause;
      throw new SavedRouteCorruptError(
        `Could not open saved route: route data is missing or corrupted.`,
      );
    }

    let document: RouteDocument;
    try {
      const parsed = JSON.parse(snapshotContent) as unknown;
      if (!isValidRouteDocument(parsed) || parsed.id !== record.id) {
        throw new SavedRouteCorruptError(
          `Could not open saved route: route data is missing or corrupted.`,
        );
      }
      const totalPoints = parsed.segments.reduce((sum, s) => sum + s.points.length, 0);
      if (
        record.pointCount !== totalPoints ||
        record.segmentCount !== parsed.segments.length
      ) {
        throw new SavedRouteCorruptError(
          `Could not open saved route: recorded point or segment counts do not match document geometry.`,
        );
      }
      document = parsed;
    } catch (cause) {
      if (cause instanceof SavedRouteCorruptError) throw cause;
      throw new SavedRouteCorruptError(
        `Could not open saved route: route data is missing or corrupted.`,
      );
    }

    let originalGpx: string;
    try {
      const gpxInfo = await this.fs.getInfoAsync(record.originalGpxPath);
      if (!gpxInfo.exists) {
        throw new SavedRouteCorruptError(
          `Could not open saved route: original GPX file is missing.`,
        );
      }
      originalGpx = await this.fs.readAsStringAsync(record.originalGpxPath);
    } catch (cause) {
      if (cause instanceof SavedRouteCorruptError) throw cause;
      throw new SavedRouteCorruptError(
        `Could not open saved route: route data is missing or corrupted.`,
      );
    }

    return { record, document, originalGpx };
  }

  async deleteRoute(id: string): Promise<void> {
    if (!this.initialized) await this.init();
    const targetDir = `${this.baseDir}/data/${id}`;
    try {
      await this.fs.deleteAsync(targetDir, { idempotent: true });
    } catch {
      // Ignore directory removal failure
    }
    await this.db.deleteRoute(id);
  }

  private async cleanStagingOrphans(): Promise<void> {
    try {
      const stagingDir = `${this.baseDir}/_staging`;
      if (this.fs.readDirectoryAsync) {
        const entries = await this.fs.readDirectoryAsync(stagingDir);
        for (const entry of entries) {
          await this.fs.deleteAsync(`${stagingDir}/${entry}`, { idempotent: true });
        }
      } else {
        await this.fs.deleteAsync(stagingDir, { idempotent: true });
        await this.fs.makeDirectoryAsync(stagingDir, { intermediates: true });
      }
    } catch {
      // Non-fatal if staging cleanup fails
    }
  }

  private async cleanDataOrphans(): Promise<void> {
    try {
      const dataDir = `${this.baseDir}/data`;
      if (this.fs.readDirectoryAsync) {
        const committed = await this.db.listRoutes();
        const committedIds = new Set(committed.map((r) => r.id));
        const entries = await this.fs.readDirectoryAsync(dataDir);
        for (const entry of entries) {
          if (!committedIds.has(entry)) {
            await this.fs.deleteAsync(`${dataDir}/${entry}`, { idempotent: true });
          }
        }
      }
    } catch {
      // Non-fatal if data orphan cleanup fails
    }
  }
}

function isValidRouteDocument(value: unknown): value is RouteDocument {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Partial<RouteDocument>;
  if (doc.schemaVersion !== ROUTE_DOCUMENT_SCHEMA_VERSION) return false;
  if (typeof doc.id !== "string" || doc.id.trim() === "") return false;
  if (typeof doc.name !== "string" || doc.name.trim() === "") return false;
  if (doc.description !== undefined && typeof doc.description !== "string") return false;

  // Source validation
  if (typeof doc.source !== "object" || doc.source === null) return false;
  const source = doc.source as { kind?: unknown; filename?: unknown; creator?: unknown };
  if (source.kind !== "new" && source.kind !== "gpx") return false;
  if (source.kind === "gpx") {
    if (source.filename !== undefined && typeof source.filename !== "string") return false;
    if (source.creator !== undefined && typeof source.creator !== "string") return false;
  }

  if (!Array.isArray(doc.segments) || doc.segments.length === 0) return false;

  let totalValidPoints = 0;
  let hasUsableSegment = false;

  for (const segment of doc.segments) {
    if (typeof segment !== "object" || segment === null) return false;
    if (typeof segment.id !== "string" || segment.id.trim() === "" || !Array.isArray(segment.points)) {
      return false;
    }
    for (const point of segment.points) {
      if (typeof point !== "object" || point === null) return false;
      if (
        typeof point.latitude !== "number" ||
        !Number.isFinite(point.latitude) ||
        point.latitude < -90 ||
        point.latitude > 90
      ) {
        return false;
      }
      if (
        typeof point.longitude !== "number" ||
        !Number.isFinite(point.longitude) ||
        point.longitude < -180 ||
        point.longitude > 180
      ) {
        return false;
      }
      if (
        point.elevationMeters !== undefined &&
        (typeof point.elevationMeters !== "number" || !Number.isFinite(point.elevationMeters))
      ) {
        return false;
      }
      if (point.time !== undefined && typeof point.time !== "string") {
        return false;
      }
      totalValidPoints++;
    }
    if (segment.points.length >= 2) {
      const first = segment.points[0]!;
      if (
        segment.points.some(
          (p) => p.latitude !== first.latitude || p.longitude !== first.longitude,
        )
      ) {
        hasUsableSegment = true;
      }
    }
  }

  if (!hasUsableSegment || totalValidPoints === 0) return false;

  if (!Array.isArray(doc.controlPoints)) return false;
  for (const cp of doc.controlPoints) {
    if (typeof cp !== "object" || cp === null) return false;
    if (
      typeof cp.id !== "string" ||
      cp.id.trim() === "" ||
      typeof cp.kind !== "string" ||
      !["start", "finish", "via"].includes(cp.kind)
    ) {
      return false;
    }
    if (
      typeof cp.latitude !== "number" ||
      !Number.isFinite(cp.latitude) ||
      cp.latitude < -90 ||
      cp.latitude > 90
    ) {
      return false;
    }
    if (
      typeof cp.longitude !== "number" ||
      !Number.isFinite(cp.longitude) ||
      cp.longitude < -180 ||
      cp.longitude > 180
    ) {
      return false;
    }
  }

  if (!Array.isArray(doc.waypoints)) return false;
  for (const wp of doc.waypoints) {
    if (typeof wp !== "object" || wp === null) return false;
    if (typeof wp.id !== "string" || wp.id.trim() === "") return false;
    if (
      typeof wp.latitude !== "number" ||
      !Number.isFinite(wp.latitude) ||
      wp.latitude < -90 ||
      wp.latitude > 90
    ) {
      return false;
    }
    if (
      typeof wp.longitude !== "number" ||
      !Number.isFinite(wp.longitude) ||
      wp.longitude < -180 ||
      wp.longitude > 180
    ) {
      return false;
    }
  }

  if (!Array.isArray(doc.maneuvers)) return false;
  for (const m of doc.maneuvers) {
    if (typeof m !== "object" || m === null) return false;
    if (typeof m.id !== "string" || m.id.trim() === "") return false;
    if (
      typeof m.latitude !== "number" ||
      !Number.isFinite(m.latitude) ||
      m.latitude < -90 ||
      m.latitude > 90
    ) {
      return false;
    }
    if (
      typeof m.longitude !== "number" ||
      !Number.isFinite(m.longitude) ||
      m.longitude < -180 ||
      m.longitude > 180
    ) {
      return false;
    }
    if (
      typeof m.segmentIndex !== "number" ||
      !Number.isInteger(m.segmentIndex) ||
      m.segmentIndex < 0 ||
      m.segmentIndex >= doc.segments.length
    ) {
      return false;
    }
    if (
      typeof m.shapeIndex !== "number" ||
      !Number.isInteger(m.shapeIndex) ||
      m.shapeIndex < 0 ||
      m.shapeIndex >= (doc.segments[m.segmentIndex]?.points.length ?? 0)
    ) {
      return false;
    }
    if (typeof m.instruction !== "string" || m.instruction.trim() === "") {
      return false;
    }
    if (m.verbalInstruction !== undefined && typeof m.verbalInstruction !== "string") {
      return false;
    }
  }

  if (doc.summary !== undefined) {
    if (typeof doc.summary !== "object" || doc.summary === null) return false;
    if (
      typeof doc.summary.distanceMeters !== "number" ||
      !Number.isFinite(doc.summary.distanceMeters) ||
      doc.summary.distanceMeters < 0
    ) {
      return false;
    }
    if (
      typeof doc.summary.durationSeconds !== "number" ||
      !Number.isFinite(doc.summary.durationSeconds) ||
      doc.summary.durationSeconds < 0
    ) {
      return false;
    }
  }

  if (doc.routing !== undefined) {
    if (typeof doc.routing !== "object" || doc.routing === null) return false;
    if (typeof doc.routing.engine !== "string") return false;
    if (!["road", "gravel", "mountain"].includes(doc.routing.profile)) return false;
  }

  return true;
}

function normalize(path: string): string {
  return path.replace(/\/+$/u, "");
}
