import { ROUTE_DOCUMENT_SCHEMA_VERSION, type RouteDocument } from "@ride-maker/domain";
import type { OutputCoverage, PreparationReviewMetadata } from "@ride-maker/routing";
import { serializeGpx } from "@ride-maker/gpx";
import type { FileSystemInterface } from "./file-system-interface";
import {
  LOCAL_RECORD_VERSION,
  PREPARED_RECORD_VERSION,
  buildSourceIdentityToken,
  PreparationValidationError,
  StalePreparationError,
  SavedRouteCorruptError,
  SavedRouteNotFoundError,
  type LocalRouteDb,
  type LocalRouteRecord,
  type SavedLocalRoute,
  type AcceptPreparationParams,
  type PreparedRouteManifest,
} from "./types";

const PREPARATION_ORPHAN_GRACE_MS = 60 * 60 * 1000;

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
    assertSafeRouteId(params.document.id);
    if (!this.initialized) await this.init();

    return this.runSerialized(async () => {
      const { stagedGpxPath, gpxContent, document, originalFilename, distanceMeters } = params;
      const routeId = document.id;
      assertSafeRouteId(routeId);
      const targetDir = `${this.baseDir}/data/${routeId}`;
      const originalGpxPath = `${targetDir}/original.gpx`;
      const snapshotPath = `${targetDir}/route.json`;

      const pointCount = document.segments.reduce((sum, s) => sum + s.points.length, 0);
      const segmentCount = document.segments.length;
      const createdAt = new Date().toISOString();

      const record: LocalRouteRecord = {
        id: routeId,
        version: LOCAL_RECORD_VERSION,
        storageIdentity: makeVersionId(),
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
    assertSafeRouteId(document.id);
    if (!this.initialized) await this.init();

    return this.runSerialized(async () => {
      if (!isValidRouteDocument(document)) {
        throw new Error("Invalid route document: cannot save malformed route.");
      }

      const routeId = document.id;
      assertSafeRouteId(routeId);
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
        storageIdentity: makeVersionId(),
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
    assertSafeRouteId(id);
    if (!this.initialized) await this.init();

    return this.runSerialized(async () => {
      assertSafeRouteId(id);
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

      if (current.record.version === 3) {
        await this.db.updateRouteName(id, trimmed);
        return { ...current.record, name: trimmed };
      }

      const updatedDoc: RouteDocument = { ...current.document, name: trimmed };

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
    assertSafeRouteId(id);
    if (!this.initialized) await this.init();
    assertSafeRouteId(id);

    const record = await this.db.getRoute(id);
    if (!record) {
      throw new SavedRouteNotFoundError(`Saved route '${id}' was not found.`);
    }

    if (record.version !== 1 && record.version !== 2 && record.version !== 3) {
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

    const original = await this.readOriginalAssets(record, id);
    if (record.version === 3 && record.activePreparationId) {
      return this.readPreparedRoute(record, original.document, original.gpx, id);
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
    if (record.version !== 3 && record.name !== document.name) {
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

    if (record.version === 3) document = { ...document, name: record.name };
    return { record, document, originalGpx: original.gpx, originalDocument: document,
      activeVersionId: null };
  }

  async acceptPreparation(params: AcceptPreparationParams): Promise<SavedLocalRoute> {
    const { routeId, prepared, expectedSourceToken } = params;
    assertSafeRouteId(routeId);
    if (!this.initialized) await this.init();
    // Validate the provider result before entering the serialized commit section.
    validatePreparation(prepared, routeId);
    return this.runSerialized(async () => {
      const versionId = makeVersionId();
      const current = await this.getRoute(routeId);
      const expectedToken = typeof expectedSourceToken === "string"
        ? expectedSourceToken
        : `${routeId}:${expectedSourceToken.storageIdentity ?? "legacy"}:${expectedSourceToken.activePreparationId ?? "original"}:${expectedSourceToken.version ?? ""}:${expectedSourceToken.revision ?? 0}`;
      if (expectedToken !== buildSourceIdentityToken(current.record)) {
        throw new StalePreparationError("The route changed while preparation was running.");
      }
      const source = current.originalDocument ?? current.document;
      if (prepared.metadata.sourceId !== source.id || prepared.document.source.kind !== source.source.kind ||
          (source.source.kind === "gpx" && prepared.document.source.kind === "gpx" &&
            (prepared.document.source.filename !== source.source.filename ||
              prepared.document.source.creator !== source.source.creator))) {
        throw new PreparationValidationError("Preparation source does not match the saved route.");
      }
      validatePreparation(prepared, routeId, source);
      const name = current.record.name;
      const document = { ...prepared.document, name };
      const versionDir = `${this.baseDir}/data/${routeId}/prepared/${versionId}`;
      const documentPath = `${versionDir}/document.json`;
      const manifestPath = `${versionDir}/preparation.json`;
      const manifest: PreparedRouteManifest = { schemaVersion: 1, versionId,
        sourceRouteId: routeId, documentId: document.id, metadata: prepared.metadata,
        createdAt: new Date().toISOString() };
      try {
        await this.fs.makeDirectoryAsync(versionDir, { intermediates: true });
        await this.fs.writeAsStringAsync(documentPath, JSON.stringify(document));
        await this.fs.writeAsStringAsync(manifestPath, JSON.stringify(manifest));
        const readDocument = JSON.parse(await this.fs.readAsStringAsync(documentPath)) as unknown;
        const readManifest = JSON.parse(await this.fs.readAsStringAsync(manifestPath)) as unknown;
        if (!isValidRouteDocument(readDocument) || !validManifest(readManifest, routeId, versionId, readDocument, source))
          throw new PreparationValidationError("Prepared route files failed readback validation.");
        const counts = geometryCounts(readDocument);
      await this.db.commitActivePreparation({ id: routeId, version: PREPARED_RECORD_VERSION,
          expectedRevision: current.record.revision ?? 0,
          expectedStorageIdentity: current.record.storageIdentity ?? "",
          activePreparationId: versionId, ...counts, hasInstructions: validateRouteInstructions(readDocument).ready });
      } catch (error) {
        const committed = (await this.db.getRoute(routeId))?.activePreparationId === versionId;
        if (!committed) {
          try { await this.fs.deleteAsync(versionDir, { idempotent: true }); } catch { /* startup cleanup retries */ }
          throw error;
        }
      }
      try { await this.cleanPreparedOrphans(routeId); } catch { /* committed acceptance remains successful */ }
      return this.readPreparedRoute((await this.db.getRoute(routeId))!, current.originalDocument ?? current.document, current.originalGpx, routeId);
    });
  }

  async revertPreparation(id: string, expectedSourceToken?: string): Promise<SavedLocalRoute> {
    assertSafeRouteId(id);
    if (!this.initialized) await this.init();
    return this.runSerialized(async () => {
      const current = await this.getOriginalRoute(id);
      if (expectedSourceToken && expectedSourceToken !== buildSourceIdentityToken(current.record))
        throw new StalePreparationError("The route changed before revert could be committed.");
      const original = { document: current.originalDocument!, gpx: current.originalGpx };
      const counts = geometryCounts(original.document);
      await this.db.commitActivePreparation({ id, version: 3,
        expectedRevision: current.record.revision ?? 0,
        expectedStorageIdentity: current.record.storageIdentity ?? "",
        activePreparationId: null,
        ...counts, hasInstructions: current.record.sourceKind === "created" && validateRouteInstructions(original.document).ready });
      const updated = (await this.db.getRoute(id))!;
      return { record: updated, document: { ...original.document, name: updated.name },
        originalDocument: { ...original.document, name: updated.name }, originalGpx: original.gpx,
        activeVersionId: null, preparation: null, preparationMetadata: null };
    });
  }

  async getOriginalRoute(id: string): Promise<SavedLocalRoute> {
    assertSafeRouteId(id);
    if (!this.initialized) await this.init();
    const record = await this.db.getRoute(id);
    if (!record) throw new SavedRouteNotFoundError(`Saved route '${id}' was not found.`);
    const original = await this.readOriginalAssets(record, id);
    const document = { ...original.document, name: record.name };
    return { record, document, originalDocument: document, originalGpx: original.gpx,
      activeVersionId: record.activePreparationId ?? null };
  }

  async deleteRoute(id: string): Promise<void> {
    assertSafeRouteId(id);
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
      if (!isSafeRouteId(entry)) continue;
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
          if (isSafeRouteId(entry) && !committedIds.has(entry)) {
            await this.fs.deleteAsync(`${dataDir}/${entry}`, { idempotent: true });
          } else if (isSafeRouteId(entry) && committedIds.has(entry)) {
            await this.cleanPreparedOrphans(entry);
          }
        }
      }
    } catch {
      // Non-fatal if data orphan cleanup fails
    }
  }

  private async readOriginalAssets(record: LocalRouteRecord, id: string): Promise<{ document: RouteDocument; gpx: string }> {
    const expectedGpx = `${this.baseDir}/data/${id}/original.gpx`;
    const expectedSnapshot = `${this.baseDir}/data/${id}/route.json`;
    if (record.id !== id || record.originalGpxPath !== expectedGpx || record.snapshotPath !== expectedSnapshot)
      throw new SavedRouteCorruptError("Invalid route asset storage path: path outside expected private route location");
    try {
      const [gpxInfo, snapshotInfo] = await Promise.all([this.fs.getInfoAsync(expectedGpx), this.fs.getInfoAsync(expectedSnapshot)]);
      if (!gpxInfo.exists || !snapshotInfo.exists) throw new Error("missing original asset");
      const [gpx, raw] = await Promise.all([this.fs.readAsStringAsync(expectedGpx), this.fs.readAsStringAsync(expectedSnapshot)]);
      const value = JSON.parse(raw) as unknown;
      if (!isValidRouteDocument(value) || value.id !== id) throw new Error("invalid original document");
      if (record.version !== 3) {
        if (value.name !== record.name) throw new Error("legacy name mismatch");
      }
      if (record.sourceKind === "created" && value.source.kind !== "new") throw new Error("provenance mismatch");
      if (record.sourceKind === "imported" && value.source.kind !== "gpx") throw new Error("provenance mismatch");
      return { document: value, gpx };
    } catch (cause) {
      if (cause instanceof SavedRouteCorruptError) throw cause;
      throw new SavedRouteCorruptError("Could not open saved route: route data is missing or corrupted.");
    }
  }

  private async readPreparedRoute(record: LocalRouteRecord, originalDocument: RouteDocument, originalGpx: string, id: string): Promise<SavedLocalRoute> {
    const versionId = record.activePreparationId;
    if (!versionId || !isSafeVersionId(versionId)) throw new SavedRouteCorruptError("Invalid active preparation ID.");
    const dir = `${this.baseDir}/data/${id}/prepared/${versionId}`;
    try {
      const document = JSON.parse(await this.fs.readAsStringAsync(`${dir}/document.json`)) as unknown;
      const manifest = JSON.parse(await this.fs.readAsStringAsync(`${dir}/preparation.json`)) as unknown;
      if (!isValidRouteDocument(document) || !validManifest(manifest, id, versionId, document, originalDocument)) throw new Error("invalid version");
      const counts = geometryCounts(document);
      if (counts.pointCount !== record.pointCount || counts.segmentCount !== record.segmentCount ||
          counts.distanceMeters !== record.distanceMeters) throw new Error("record summary mismatch");
      if (document.id !== id || document.source.kind !== originalDocument.source.kind ||
          (document.source.kind === "gpx" && originalDocument.source.kind === "gpx" &&
            (document.source.filename !== originalDocument.source.filename ||
              document.source.creator !== originalDocument.source.creator))) throw new Error("source changed");
      const metadata = (manifest as PreparedRouteManifest).metadata;
      if (metadata.perSourceSegment.some((segment) => segment.sourceSegmentIndex >= originalDocument.segments.length) ||
          metadata.warnings.some((warning) => warning.sourceSegmentIndex !== undefined &&
            warning.sourceSegmentIndex >= originalDocument.segments.length)) throw new Error("source segment reference mismatch");
      const effective = { ...document, name: record.name };
      const prep = manifest as PreparedRouteManifest;
      return { record, document: effective, originalDocument: { ...originalDocument, name: record.name },
        originalGpx, preparation: prep, preparationMetadata: prep.metadata,
        activeVersionId: versionId };
    } catch {
      throw new SavedRouteCorruptError("Prepared route data is missing or corrupted. Open the original route to recover.");
    }
  }

  private async cleanPreparedOrphans(routeId: string): Promise<void> {
    if (!isSafeRouteId(routeId) || !this.fs.readDirectoryAsync) return;
    const record = await this.db.getRoute(routeId);
    const preparedDir = `${this.baseDir}/data/${routeId}/prepared`;
    const info = await this.fs.getInfoAsync(preparedDir);
    if (!info.exists || !info.isDirectory) return;
    const entries = await this.fs.readDirectoryAsync(preparedDir);
    for (const entry of entries) {
      const createdAt = preparedVersionCreatedAt(entry);
      if (isSafeVersionId(entry) && entry !== record?.activePreparationId && createdAt !== null &&
          Date.now() - createdAt >= PREPARATION_ORPHAN_GRACE_MS) {
        const versionDir = `${preparedDir}/${entry}`;
        const [documentInfo, manifestInfo] = await Promise.all([
          this.fs.getInfoAsync(`${versionDir}/document.json`),
          this.fs.getInfoAsync(`${versionDir}/preparation.json`),
        ]);
        if (!documentInfo.exists || !manifestInfo.exists)
          await this.fs.deleteAsync(versionDir, { idempotent: true });
      }
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

function isSafeRouteId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id) && id !== "." && id !== "..";
}

function assertSafeRouteId(id: string): void {
  if (!isSafeRouteId(id)) throw new SavedRouteCorruptError("Invalid route ID.");
}

function isSafeVersionId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id) && id !== "." && id !== "..";
}

function makeVersionId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  const id = cryptoObj?.randomUUID?.().replace(/-/gu, "") ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `p${Date.now().toString(36)}_${id}`;
}

function preparedVersionCreatedAt(id: string): number | null {
  const match = /^p([0-9a-z]+)_/u.exec(id);
  if (!match) return null;
  const timestamp = Number.parseInt(match[1]!, 36);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function geometryCounts(document: RouteDocument): { distanceMeters: number; pointCount: number; segmentCount: number } {
  const pointCount = document.segments.reduce((sum, segment) => sum + segment.points.length, 0);
  const distance = document.summary?.distanceMeters;
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0)
    throw new PreparationValidationError("Prepared document has an invalid distance summary.");
  return { distanceMeters: distance, pointCount, segmentCount: document.segments.length };
}

function validatePreparation(prepared: import("./types").AcceptPreparationParams["prepared"], routeId: string, original?: RouteDocument): void {
  const { document, metadata } = prepared;
  if (!isValidRouteDocument(document) || document.id !== routeId || document.source.kind !== "gpx")
    throw new PreparationValidationError("Preparation returned an invalid route document.");
  if (!metadata || metadata.version !== 1 || metadata.sourceId !== routeId ||
      !["ready", "partial", "needs-choice", "failed"].includes(metadata.status))
    throw new PreparationValidationError("Preparation metadata does not identify this source route.");
  if (metadata.status !== "ready" && metadata.status !== "partial")
    throw new PreparationValidationError("Only ready or partial preparation can be accepted.");
  if (original) validateMetadataAgainstOriginal(metadata, document, original);
  const finiteNonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const c = metadata.coverage;
  const d = metadata.deviations;
  if (!c || !finiteNonnegative(c.sourceDistanceMeters) || !finiteNonnegative(c.matchedDistanceMeters) ||
      !finiteNonnegative(c.unmatchedDistanceMeters) || !finiteNonnegative(c.coverageRatio) || c.coverageRatio > 1 ||
      !d || !finiteNonnegative(d.maxDeviationMeters) || !finiteNonnegative(d.p50DeviationMeters) ||
      !finiteNonnegative(d.p95DeviationMeters) || !finiteNonnegative(d.sourceToMatchedMaxMeters) ||
      !finiteNonnegative(d.matchedToSourceMaxMeters) || !finiteNonnegative(d.samplingErrorBudgetMeters) ||
      !Array.isArray(metadata.perSourceSegment) ||
      !Array.isArray(metadata.warnings)) throw new PreparationValidationError("Preparation assessment is invalid.");
  const thresholds = metadata.engineeringThresholds;
  const requiredThresholds = ["maxAllowedDeviationMeters", "warningDeviationMeters", "minReadyCoverageRatio",
    "minPartialCoverageRatio", "maxSparsePointSpacingMeters", "simplificationToleranceMeters",
    "maxChunkPoints", "chunkOverlapPoints", "maxConcurrentRequests", "requestTimeoutMs"] as const;
  if (!thresholds || requiredThresholds.some((key) => typeof thresholds[key] !== "number" ||
      !Number.isFinite(thresholds[key]) || thresholds[key] < 0) ||
      thresholds.minReadyCoverageRatio > 1 || thresholds.minPartialCoverageRatio > thresholds.minReadyCoverageRatio ||
      !Number.isInteger(thresholds.maxChunkPoints) ||
      thresholds.maxChunkPoints < 1 || !Number.isInteger(thresholds.chunkOverlapPoints) ||
      thresholds.chunkOverlapPoints >= thresholds.maxChunkPoints ||
      !Number.isInteger(thresholds.maxConcurrentRequests) || thresholds.maxConcurrentRequests < 1 ||
      !Number.isInteger(thresholds.requestTimeoutMs) || thresholds.requestTimeoutMs < 1)
    throw new PreparationValidationError("Preparation thresholds are invalid.");
  for (const segment of metadata.perSourceSegment) {
    if (!Number.isInteger(segment.sourceSegmentIndex) || segment.sourceSegmentIndex < 0 ||
        !Number.isInteger(segment.sourcePointsCount) || segment.sourcePointsCount < 0 ||
        typeof segment.matched !== "boolean" ||
        !finiteNonnegative(segment.sourceDistanceMeters) || !finiteNonnegative(segment.coverageRatio) ||
        segment.coverageRatio > 1 || !Array.isArray(segment.outputSegmentIndices) ||
        segment.outputSegmentIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= document.segments.length))
      throw new PreparationValidationError("Preparation segment coverage is invalid.");
  }
  for (const warning of metadata.warnings) {
    const point = warning?.coordinate;
    if (typeof warning?.code !== "string" || !["info", "warning", "error"].includes(warning.severity) ||
        typeof warning.message !== "string" || !point || !Number.isFinite(point.latitude) ||
        point.latitude < -90 || point.latitude > 90 || !Number.isFinite(point.longitude) ||
        point.longitude < -180 || point.longitude > 180 ||
        (warning.sourceSegmentIndex !== undefined && (!Number.isInteger(warning.sourceSegmentIndex) ||
          warning.sourceSegmentIndex < 0)) ||
        (warning.distanceAlongTraceMeters !== undefined && !finiteNonnegative(warning.distanceAlongTraceMeters)) ||
        (warning.distanceMeters !== undefined && !finiteNonnegative(warning.distanceMeters)))
      throw new PreparationValidationError("Preparation warning data is invalid.");
    if (warning.sourceSegmentIndex !== undefined && original && warning.sourceSegmentIndex >= original.segments.length)
      throw new PreparationValidationError("Preparation warning references an invalid original segment.");
  }
  const instructionCheck = validateRouteInstructions(document);
  if (!instructionCheck.ready) throw new PreparationValidationError("Prepared document has invalid maneuver references.");
  geometryCounts(document);
}

function validateMetadataAgainstOriginal(metadata: PreparationReviewMetadata, document: RouteDocument, original: RouteDocument): void {
  const fail = (message: string): never => { throw new PreparationValidationError(message); };
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1, Math.max(a, b) * 0.001);
  const closeRatio = (a: number, b: number): boolean => Math.abs(a - b) <= 0.001;
  if (metadata.sourceKind !== original.source.kind || metadata.filename !== (original.source.kind === "gpx" ? original.source.filename : undefined))
    fail("Preparation metadata source kind or filename does not match the original route.");
  if (!Array.isArray(metadata.outputCoverage) || metadata.outputCoverage.length !== document.segments.length ||
      !Array.isArray(metadata.perSourceSegment) || metadata.perSourceSegment.length !== original.segments.length)
    fail("Preparation coverage does not describe every source and output segment.");

  const sourceLengths = original.segments.map((segment) => segmentLength(segment.points));
  const sourcePointDistances = original.segments.map((segment) => cumulativeDistances(segment.points));
  const rowsBySource: OutputCoverage[][] = original.segments.map(() => []);
  const outputIndices = new Set<number>();
  let previousOutputSource = -1;
  for (const [outputPosition, row] of metadata.outputCoverage.entries()) {
    const interval = row.sourceInterval;
    if (!Number.isInteger(row.outputSegmentIndex) || row.outputSegmentIndex !== outputPosition || row.outputSegmentIndex >= document.segments.length ||
        outputIndices.has(row.outputSegmentIndex) || !Number.isInteger(row.sourceSegmentIndex) || row.sourceSegmentIndex < 0 ||
        row.sourceSegmentIndex >= original.segments.length || typeof row.matched !== "boolean" ||
        typeof row.guidanceAvailable !== "boolean" || (row.guidanceAvailable && !row.matched) ||
        !interval || !Number.isInteger(interval.startPointIndex) || !Number.isInteger(interval.endPointIndex) ||
        interval.startPointIndex < 0 || interval.endPointIndex < interval.startPointIndex ||
        interval.endPointIndex >= original.segments[row.sourceSegmentIndex]!.points.length ||
        !Number.isFinite(interval.startDistanceMeters) || !Number.isFinite(interval.endDistanceMeters) ||
        interval.startDistanceMeters < 0 || interval.endDistanceMeters < interval.startDistanceMeters ||
        (row.matched && interval.endDistanceMeters <= interval.startDistanceMeters))
      fail("Prepared output coverage contains an invalid source or output reference.");
    if (row.sourceSegmentIndex < previousOutputSource)
      fail("Prepared output segments do not preserve original source order.");
    previousOutputSource = row.sourceSegmentIndex;
    outputIndices.add(row.outputSegmentIndex);
    const distances = sourcePointDistances[row.sourceSegmentIndex]!;
    if (!close(interval.startDistanceMeters, distances[interval.startPointIndex]!) ||
        !close(interval.endDistanceMeters, distances[interval.endPointIndex]!))
      fail("Prepared output coverage distances do not match its original point bounds.");
    if (row.guidanceAvailable && !document.maneuvers.some((maneuver) => maneuver.segmentIndex === row.outputSegmentIndex))
      fail("Preparation claims guidance for an output segment without validated maneuvers.");
    rowsBySource[row.sourceSegmentIndex]!.push(row);
  }
  if (outputIndices.size !== document.segments.length) fail("Preparation does not map every output segment exactly once.");

  const totalSourceDistance = sourceLengths.reduce((sum, distance) => sum + distance, 0);
  let matchedDistance = 0;
  let allMatchedAndGuided = true;
  for (let sourceIndex = 0; sourceIndex < original.segments.length; sourceIndex++) {
    const rows = rowsBySource[sourceIndex]!;
    const points = original.segments[sourceIndex]!.points;
    const review = metadata.perSourceSegment[sourceIndex]!;
    if (review.sourceSegmentIndex !== sourceIndex || review.sourcePointsCount !== points.length ||
        !close(review.sourceDistanceMeters, sourceLengths[sourceIndex]!))
      fail("Per-source segment counts or distance do not match original geometry.");
    let union = 0;
    let previousEnd = 0;
    let previousEndPoint = 0;
    const expectedOutputIndices: number[] = [];
    for (const row of rows) {
      const { startDistanceMeters: start, endDistanceMeters: end } = row.sourceInterval;
      if (Math.abs(start - previousEnd) > 0.01 || row.sourceInterval.startPointIndex !== previousEndPoint)
        fail("Prepared output source intervals must form a complete ordered partition.");
      previousEnd = end;
      previousEndPoint = row.sourceInterval.endPointIndex;
      expectedOutputIndices.push(row.outputSegmentIndex);
      if (row.matched) union += end - start;
      if (!row.matched || !row.guidanceAvailable) allMatchedAndGuided = false;
      if (!row.matched) {
        const expectedPoints = points.slice(row.sourceInterval.startPointIndex, row.sourceInterval.endPointIndex + 1);
        const actualPoints = document.segments[row.outputSegmentIndex]!.points;
        if (actualPoints.length !== expectedPoints.length || actualPoints.some((point, index) =>
          point.latitude !== expectedPoints[index]!.latitude || point.longitude !== expectedPoints[index]!.longitude))
          fail("Unmatched output geometry must preserve its exact original source interval.");
      }
    }
    if (rows.length === 0 || Math.abs(rows[0]!.sourceInterval.startDistanceMeters) > 0.01 ||
        Math.abs(previousEnd - sourceLengths[sourceIndex]!) > 0.01 || previousEndPoint !== points.length - 1)
      fail("Prepared output does not retain the complete original source segment.");
    const expectedRatio = sourceLengths[sourceIndex]! > 0 ? Math.min(1, union / sourceLengths[sourceIndex]!) : 1;
    const expectedFullyMatched = sourceLengths[sourceIndex]! > 0 && rows.length > 0 &&
      rows.every((row) => row.matched) && expectedRatio >= metadata.engineeringThresholds.minReadyCoverageRatio;
    if (review.outputSegmentIndices.length !== expectedOutputIndices.length ||
        review.outputSegmentIndices.some((index, i) => index !== expectedOutputIndices[i]) ||
        review.matched !== expectedFullyMatched || !closeRatio(review.coverageRatio, expectedRatio))
      fail("Per-source output mapping or coverage ratio is inconsistent.");
    matchedDistance += union;
  }
  const expectedRatio = totalSourceDistance > 0 ? Math.min(1, matchedDistance / totalSourceDistance) : 0;
  if (!close(metadata.coverage.sourceDistanceMeters, totalSourceDistance) ||
      !close(metadata.coverage.matchedDistanceMeters, matchedDistance) ||
      !close(metadata.coverage.unmatchedDistanceMeters, Math.max(0, totalSourceDistance - matchedDistance)) ||
      !closeRatio(metadata.coverage.coverageRatio, expectedRatio))
    fail("Preparation coverage summary does not match source interval coverage.");

  const readyThresholds = metadata.engineeringThresholds;
  const hasBlockingWarning = metadata.warnings.some((warning) => warning.severity === "error" ||
    ["unmatched_section", "discontinuity", "chunk_seam_unresolved", "reversed_path", "geometry_mismatch", "validation_error"].includes(warning.code));
  if (metadata.status === "ready" && (!allMatchedAndGuided || expectedRatio < readyThresholds.minReadyCoverageRatio ||
      metadata.coverage.unmatchedDistanceMeters > Math.max(1, totalSourceDistance * 0.01) ||
      metadata.deviations.maxDeviationMeters > readyThresholds.maxAllowedDeviationMeters || hasBlockingWarning))
    fail("Preparation claims ready status despite partial coverage, warnings, or deviation.");
}

function cumulativeDistances(points: RouteDocument["segments"][number]["points"]): number[] {
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1]! + haversineDistance(points[i - 1]!, points[i]!));
  return distances;
}

function segmentLength(points: RouteDocument["segments"][number]["points"]): number {
  return cumulativeDistances(points).at(-1) ?? 0;
}

function haversineDistance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const lat1 = a.latitude * rad;
  const lat2 = b.latitude * rad;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function validManifest(value: unknown, routeId: string, versionId: string, document: RouteDocument, original: RouteDocument): value is PreparedRouteManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<PreparedRouteManifest>;
  if (manifest.schemaVersion !== 1 || manifest.versionId !== versionId || manifest.sourceRouteId !== routeId ||
      manifest.documentId !== document.id || typeof manifest.createdAt !== "string" ||
      Number.isNaN(Date.parse(manifest.createdAt))) return false;
  try { validatePreparation({ document, metadata: manifest.metadata! }, routeId, original); return true; }
  catch { return false; }
}
