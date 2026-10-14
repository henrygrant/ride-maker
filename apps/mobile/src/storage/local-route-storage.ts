import { ROUTE_DOCUMENT_SCHEMA_VERSION, type RouteDocument } from "@ride-maker/domain";
import { serializeGpx } from "@ride-maker/gpx";
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

      await this.recoverInterruptedOperations();
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
        sourceKind: "imported",
        hasInstructions: false,
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

        if (stagedGpxPath) {
          const stagedInfo = await this.fs.getInfoAsync(stagedGpxPath);
          if (!stagedInfo.exists) {
            throw new Error("Staged GPX file does not exist.");
          }
          if (this.fs.copyAsync) {
            await this.fs.copyAsync({ from: stagedGpxPath, to: originalGpxPath });
          } else {
            const content = await this.fs.readAsStringAsync(stagedGpxPath);
            await this.fs.writeAsStringAsync(originalGpxPath, content);
          }
        } else if (typeof gpxContent === "string") {
          await this.fs.writeAsStringAsync(originalGpxPath, gpxContent);
        } else {
          throw new Error("Either stagedGpxPath or gpxContent must be provided.");
        }

        await this.fs.writeAsStringAsync(snapshotPath, JSON.stringify(document));

        const gpxInfo = await this.fs.getInfoAsync(originalGpxPath);
        const snapInfo = await this.fs.getInfoAsync(snapshotPath);
        if (!gpxInfo.exists || !snapInfo.exists) {
          throw new Error("Failed to verify written route files.");
        }

        await this.db.insertRoute(record);
        return record;
      } catch (cause) {
        if (dirCreated) {
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

  async saveCreatedRoute(
    document: RouteDocument,
    options?: { createdAt?: string },
  ): Promise<LocalRouteRecord> {
    if (!this.initialized) await this.init();

    return this.runSerialized(async () => {
      if (!isValidRouteDocument(document)) {
        throw new Error("Invalid route document: cannot save malformed route.");
      }

      const routeId = document.id;
      const targetDir = `${this.baseDir}/data/${routeId}`;
      const originalGpxPath = `${targetDir}/original.gpx`;
      const snapshotPath = `${targetDir}/route.json`;

      const existingRecord = await this.db.getRoute(routeId);
      const existingDir = await this.fs.getInfoAsync(targetDir);
      if (Boolean(existingRecord) || existingDir.exists) {
        throw new Error("A route with this ID already exists. Existing route data was preserved.");
      }

      const pointCount = document.segments.reduce((sum, s) => sum + s.points.length, 0);
      const segmentCount = document.segments.length;
      const distanceMeters =
        typeof document.summary?.distanceMeters === "number" &&
        Number.isFinite(document.summary.distanceMeters) &&
        document.summary.distanceMeters >= 0
          ? document.summary.distanceMeters
          : 0;

      const instructionCheck = validateRouteInstructions(document);
      const hasInstructions = instructionCheck.ready;

      const record: LocalRouteRecord = {
        id: routeId,
        version: LOCAL_RECORD_VERSION,
        name: document.name,
        distanceMeters,
        pointCount,
        segmentCount,
        createdAt: options?.createdAt ?? new Date().toISOString(),
        originalGpxPath,
        snapshotPath,
        sourceKind: "created",
        hasInstructions,
      };

      const derivedGpx = serializeGpx(document);
      let dirCreated = false;
      try {
        await this.fs.makeDirectoryAsync(targetDir, { intermediates: true });
        dirCreated = true;

        await this.fs.writeAsStringAsync(originalGpxPath, derivedGpx);
        await this.fs.writeAsStringAsync(snapshotPath, JSON.stringify(document));

        const gpxInfo = await this.fs.getInfoAsync(originalGpxPath);
        const snapInfo = await this.fs.getInfoAsync(snapshotPath);
        if (!gpxInfo.exists || !snapInfo.exists) {
          throw new Error("Failed to verify written created route files.");
        }

        await this.db.insertRoute(record);
        return record;
      } catch (cause) {
        if (dirCreated) {
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

  async renameRoute(id: string, newName: string): Promise<LocalRouteRecord> {
    if (!this.initialized) await this.init();

    return this.runSerialized(async () => {
      const trimmed = newName.trim();
      if (trimmed.length === 0) {
        throw new Error("Ride name cannot be empty.");
      }

      const current = await this.getRoute(id);
      const oldName = current.record.name;
      if (oldName === trimmed) {
        return current.record;
      }

      const snapshotPath = current.record.snapshotPath;
      const tmpSnapshot = `${snapshotPath}.tmp`;
      const bakSnapshot = `${snapshotPath}.bak`;

      // Check if an unresolved journal already exists: refuse operation until safely resolved
      const bakInfo = await this.fs.getInfoAsync(bakSnapshot);
      if (bakInfo.exists) {
        throw new Error("Cannot rename: unresolved backup journal exists for route. Restart application to recover.");
      }

      const updatedDoc: RouteDocument = {
        ...current.document,
        name: trimmed,
      };

      // 1. Stage new snapshot to .tmp
      await this.fs.writeAsStringAsync(tmpSnapshot, JSON.stringify(updatedDoc));

      // 2. Backup current live snapshot to .bak
      const originalSnapshotContent = JSON.stringify(current.document);
      await this.fs.writeAsStringAsync(bakSnapshot, originalSnapshotContent);

      try {
        // 3. Replace live snapshot with updated content
        await this.fs.writeAsStringAsync(snapshotPath, JSON.stringify(updatedDoc));
        try {
          await this.fs.deleteAsync(tmpSnapshot, { idempotent: true });
        } catch {
          // Non-fatal tmp cleanup
        }

        // 4. Update SQLite database record
        await this.db.updateRouteName(id, trimmed);

        // 5. Success: safely clean backup
        try {
          await this.fs.deleteAsync(bakSnapshot, { idempotent: true });
        } catch {
          // Non-fatal backup removal
        }
      } catch (err) {
        // Rollback on caught failure
        try {
          await this.fs.writeAsStringAsync(snapshotPath, originalSnapshotContent);
          // Only delete backup if live snapshot was successfully restored
          await this.fs.deleteAsync(bakSnapshot, { idempotent: true });
          await this.fs.deleteAsync(tmpSnapshot, { idempotent: true });
        } catch {
          // If rollback write fails, retain .bak for startup recovery
        }
        throw err;
      }

      return {
        ...current.record,
        name: trimmed,
      };
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

    if (record.version !== 1 && record.version !== 2) {
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

    // Sol review: Check names and provenance consistency at load
    if (record.name !== document.name) {
      throw new SavedRouteCorruptError(
        `Saved route metadata name '${record.name}' does not match document name '${document.name}'.`,
      );
    }

    if (record.sourceKind === "created" && document.source.kind !== "new") {
      throw new SavedRouteCorruptError(
        `Saved route record provenance 'created' does not match document source '${document.source.kind}'.`,
      );
    }

    if (record.sourceKind === "imported" && document.source.kind !== "gpx") {
      throw new SavedRouteCorruptError(
        `Saved route record provenance 'imported' does not match document source '${document.source.kind}'.`,
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
    return this.runSerialized(async () => {
      // 1. Commit DB deletion FIRST: removes from library index immediately.
      await this.db.deleteRoute(id);

      // 2. Safely clean disk assets.
      const targetDir = `${this.baseDir}/data/${id}`;
      try {
        await this.fs.deleteAsync(targetDir, { idempotent: true });
      } catch {
        // Non-fatal; orphaned directory will be cleaned by cleanDataOrphans
      }
    });
  }

  private async recoverInterruptedOperations(): Promise<void> {
    const dataDir = `${this.baseDir}/data`;
    if (!this.fs.readDirectoryAsync) return;
    const entries = await this.fs.readDirectoryAsync(dataDir);
    for (const entry of entries) {
      const itemDir = `${dataDir}/${entry}`;
      const itemInfo = await this.fs.getInfoAsync(itemDir);
      if (!itemInfo.isDirectory) continue;

      // Clean stale temporary files
      const tmpPath = `${itemDir}/route.json.tmp`;
      const tmpInfo = await this.fs.getInfoAsync(tmpPath);
      if (tmpInfo.exists) {
        try {
          await this.fs.deleteAsync(tmpPath, { idempotent: true });
        } catch {
          // ignore
        }
      }

      // Recover backup if present
      const bakPath = `${itemDir}/route.json.bak`;
      const bakInfo = await this.fs.getInfoAsync(bakPath);
      if (bakInfo.exists) {
        const livePath = `${itemDir}/route.json`;
        const record = await this.db.getRoute(entry);
        if (record) {
          let liveMatchesDb = false;
          try {
            const liveContent = await this.fs.readAsStringAsync(livePath);
            const liveParsed = JSON.parse(liveContent) as { name?: string };
            if (liveParsed.name === record.name) {
              liveMatchesDb = true;
            }
          } catch {
            liveMatchesDb = false;
          }

          if (liveMatchesDb) {
            // DB was already updated and live snapshot has matching name: delete backup
            await this.fs.deleteAsync(bakPath, { idempotent: true });
          } else {
            // Interrupted before DB update or live snapshot corrupt: restore from backup
            const bakContent = await this.fs.readAsStringAsync(bakPath);
            await this.fs.writeAsStringAsync(livePath, bakContent);
            await this.fs.deleteAsync(bakPath, { idempotent: true });
          }
        }
      }
    }
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

export function validateRouteInstructions(doc: RouteDocument): { ready: boolean; reason?: string } {
  if (!Array.isArray(doc.maneuvers) || doc.maneuvers.length === 0) {
    return { ready: false, reason: "No turn maneuvers saved with route" };
  }
  if (!Array.isArray(doc.segments) || doc.segments.length === 0) {
    return { ready: false, reason: "Route contains no geometry segments" };
  }
  for (let i = 0; i < doc.maneuvers.length; i++) {
    const m = doc.maneuvers[i]!;
    if (
      typeof m !== "object" ||
      m === null ||
      typeof m.segmentIndex !== "number" ||
      !Number.isInteger(m.segmentIndex) ||
      m.segmentIndex < 0 ||
      m.segmentIndex >= doc.segments.length
    ) {
      return { ready: false, reason: `Maneuver ${i} references invalid segmentIndex` };
    }
    const seg = doc.segments[m.segmentIndex]!;
    if (
      typeof m.shapeIndex !== "number" ||
      !Number.isInteger(m.shapeIndex) ||
      m.shapeIndex < 0 ||
      m.shapeIndex >= seg.points.length
    ) {
      return { ready: false, reason: `Maneuver ${i} references invalid shapeIndex ${m.shapeIndex}` };
    }
    if (
      typeof m.latitude !== "number" ||
      !Number.isFinite(m.latitude) ||
      typeof m.longitude !== "number" ||
      !Number.isFinite(m.longitude)
    ) {
      return { ready: false, reason: `Maneuver ${i} has non-finite coordinates` };
    }
    const pt = seg.points[m.shapeIndex]!;
    const latDiff = Math.abs(pt.latitude - m.latitude);
    const lonDiff = Math.abs(pt.longitude - m.longitude);
    // Sol review: Exact index coordinate match (< 1e-6)
    if (latDiff > 1e-6 || lonDiff > 1e-6) {
      return { ready: false, reason: `Maneuver ${i} coordinates do not match indexed geometry point` };
    }
    if (typeof m.instruction !== "string" || m.instruction.trim().length === 0) {
      return { ready: false, reason: `Maneuver ${i} has empty instruction` };
    }
    if (
      m.verbalInstruction !== undefined &&
      (typeof m.verbalInstruction !== "string" || m.verbalInstruction.trim().length === 0)
    ) {
      return { ready: false, reason: `Maneuver ${i} has empty verbalInstruction` };
    }
  }
  return { ready: true };
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
      totalValidPoints++;
    }
    if (segment.points.length >= 2) {
      hasUsableSegment = true;
    }
  }

  // Maneuvers validation: if maneuvers present, must be array of valid objects
  if (doc.maneuvers !== undefined) {
    if (!Array.isArray(doc.maneuvers)) return false;
    for (const m of doc.maneuvers) {
      if (typeof m !== "object" || m === null) return false;
      const item = m as Record<string, unknown>;
      if (
        typeof item.instruction !== "string" ||
        typeof item.latitude !== "number" ||
        !Number.isFinite(item.latitude) ||
        typeof item.longitude !== "number" ||
        !Number.isFinite(item.longitude)
      ) {
        return false;
      }
    }
  }

  return totalValidPoints >= 2 && hasUsableSegment;
}

function normalize(path: string): string {
  return path.replace(/\/+$/, "");
}
