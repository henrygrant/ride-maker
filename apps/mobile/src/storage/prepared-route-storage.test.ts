import { describe, expect, it } from "vitest";
import type { RouteDocument } from "@ride-maker/domain";
import type { PreparedRouteResult } from "@ride-maker/routing";
import { InMemoryFileSystem } from "./file-system-interface";
import { InMemoryRouteDb } from "./sqlite-db";
import { LocalRouteStorage } from "./local-route-storage";
import { ExpoSQLiteRouteDb } from "./sqlite-db";
import { buildSourceIdentityToken, SavedRouteCorruptError, StalePreparationError } from "./types";

const gpx = `<gpx version="1.1"><trk><name>Original</name><trkseg><trkpt lat="40" lon="-74"/><trkpt lat="40.01" lon="-74"/></trkseg></trk></gpx>`;

function makePrepared(source: RouteDocument): PreparedRouteResult {
  const sourceSegment = source.segments[0]!;
  const matchedPoints = sourceSegment.points.slice(0, 2);
  const unmatchedPoints = sourceSegment.points.slice(1);
  const sourceDistance = lineDistance(sourceSegment.points);
  const matchedDistance = lineDistance(matchedPoints);
  const doc: RouteDocument = { ...source, segments: [
    { ...sourceSegment, points: matchedPoints },
    { ...sourceSegment, id: `${sourceSegment.id}-unmatched`, points: unmatchedPoints },
  ],
    maneuvers: [{ id: "turn-1", segmentIndex: 0, shapeIndex: 0, instruction: "Continue",
      latitude: matchedPoints[0]!.latitude, longitude: matchedPoints[0]!.longitude }],
    summary: { distanceMeters: sourceDistance, durationSeconds: 30 } };
  return { document: doc, metadata: { version: 1, sourceId: source.id,
    sourceKind: source.source.kind, filename: source.source.kind === "gpx" ? source.source.filename : undefined, status: "partial",
    perSourceSegment: [{ sourceSegmentIndex: 0, sourcePointsCount: sourceSegment.points.length,
      sourceDistanceMeters: sourceDistance, matched: false, outputSegmentIndices: [0, 1],
      coverageRatio: matchedDistance / sourceDistance }],
    outputCoverage: [{ outputSegmentIndex: 0, sourceSegmentIndex: 0,
      sourceInterval: { startDistanceMeters: 0, endDistanceMeters: matchedDistance,
        startPointIndex: 0, endPointIndex: 1 }, guidanceAvailable: true, matched: true },
      { outputSegmentIndex: 1, sourceSegmentIndex: 0,
        sourceInterval: { startDistanceMeters: matchedDistance, endDistanceMeters: sourceDistance,
          startPointIndex: 1, endPointIndex: sourceSegment.points.length - 1 }, guidanceAvailable: false, matched: false }],
    coverage: { sourceDistanceMeters: sourceDistance, matchedDistanceMeters: matchedDistance,
      unmatchedDistanceMeters: sourceDistance - matchedDistance, coverageRatio: matchedDistance / sourceDistance },
    deviations: { maxDeviationMeters: 5, p50DeviationMeters: 2, p95DeviationMeters: 4,
      sourceToMatchedMaxMeters: 5, matchedToSourceMaxMeters: 5, samplingErrorBudgetMeters: 2.5 }, warnings: [],
    engineeringThresholds: { maxAllowedDeviationMeters: 50, warningDeviationMeters: 25,
      minReadyCoverageRatio: 0.95, minPartialCoverageRatio: 0.5,
      maxSparsePointSpacingMeters: 500, simplificationToleranceMeters: 2,
      maxChunkPoints: 800, chunkOverlapPoints: 50, maxConcurrentRequests: 2,
      requestTimeoutMs: 15000 } } };
}

function lineDistance(points: RouteDocument["segments"][number]["points"]): number {
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const rad = Math.PI / 180;
    const lat1 = a.latitude * rad;
    const lat2 = b.latitude * rad;
    const dLat = (b.latitude - a.latitude) * rad;
    const dLon = (b.longitude - a.longitude) * rad;
    const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    distance += 6_371_000 * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
  }
  return distance;
}

describe("prepared route storage", () => {
  it("publishes immutable partial preparation, survives recreation and DB-owned rename, then reverts", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const first = new LocalRouteStorage(db, fs);
    await first.init();
    const record = await first.saveImportedRoute({ gpxContent: gpx,
      document: { schemaVersion: 1, id: "route-a", name: "Original", source: { kind: "gpx", filename: "ride.gpx" },
        segments: [{ id: "source-seg", points: [{ latitude: 40, longitude: -74 }, { latitude: 40.01, longitude: -74 }, { latitude: 40.02, longitude: -74 }] }],
        controlPoints: [], waypoints: [], maneuvers: [], summary: { distanceMeters: 2224, durationSeconds: 0 } },
      originalFilename: "ride.gpx", distanceMeters: 2224 });
    const originalBytes = await fs.readAsStringAsync(record.originalGpxPath);
    const originalSnapshot = await fs.readAsStringAsync(record.snapshotPath);
    const token = buildSourceIdentityToken(record);
    const accepted = await first.acceptPreparation({ routeId: record.id, prepared: makePrepared(JSON.parse(originalSnapshot)), expectedSourceToken: token });
    expect(accepted.preparationMetadata?.status).toBe("partial");
    expect(accepted.activeVersionId).toBeTruthy();
    expect(await fs.readAsStringAsync(record.originalGpxPath)).toBe(originalBytes);
    expect(await fs.readAsStringAsync(record.snapshotPath)).toBe(originalSnapshot);

    const restarted = new LocalRouteStorage(db, fs);
    await restarted.init();
    expect((await restarted.getRoute(record.id)).activeVersionId).toBe(accepted.activeVersionId);
    await restarted.renameRoute(record.id, "Renamed");
    const renamed = await restarted.getRoute(record.id);
    expect(renamed.document.name).toBe("Renamed");
    expect(renamed.originalDocument?.name).toBe("Renamed");
    expect(renamed.record.originalFilename).toBe("ride.gpx");
    const reverted = await restarted.revertPreparation(record.id, buildSourceIdentityToken(renamed.record));
    expect(reverted.activeVersionId).toBeNull();
    expect(reverted.document.maneuvers).toHaveLength(0);
    expect(reverted.record.name).toBe("Renamed");
    await expect(restarted.acceptPreparation({ routeId: record.id, prepared: makePrepared(reverted.document),
      expectedSourceToken: token })).rejects.toBeInstanceOf(StalePreparationError);
  });

  it("retains the previous pointer on publish failure and allows original recovery from corrupt prepared data", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();
    const record = await storage.saveImportedRoute({ gpxContent: gpx,
      document: { schemaVersion: 1, id: "route-b", name: "Original", source: { kind: "gpx" },
        segments: [{ id: "source-seg", points: [{ latitude: 40, longitude: -74 }, { latitude: 40.01, longitude: -74 }, { latitude: 40.02, longitude: -74 }] }],
        controlPoints: [], waypoints: [], maneuvers: [], summary: { distanceMeters: 2224, durationSeconds: 0 } },
      distanceMeters: 2224 });
    const first = await storage.acceptPreparation({ routeId: record.id,
      prepared: makePrepared((await storage.getRoute(record.id)).document),
      expectedSourceToken: buildSourceIdentityToken(record) });
    const oldId = first.activeVersionId!;
    const current = await db.getRoute(record.id);
    const commit = db.commitActivePreparation.bind(db);
    db.commitActivePreparation = async () => { throw new Error("sqlite failure"); };
    await expect(storage.acceptPreparation({ routeId: record.id,
      prepared: makePrepared((await storage.getRoute(record.id)).originalDocument!),
      expectedSourceToken: buildSourceIdentityToken(current!) })).rejects.toThrow("sqlite failure");
    expect((await db.getRoute(record.id))?.activePreparationId).toBe(oldId);
    db.commitActivePreparation = commit;
    await expect(storage.acceptPreparation({ routeId: record.id, prepared: makePrepared((await storage.getOriginalRoute(record.id)).document),
      expectedSourceToken: "stale" })).rejects.toBeInstanceOf(StalePreparationError);

    const preparedDocPath = `${storage.getBaseDir()}/data/${record.id}/prepared/${oldId}/document.json`;
    await fs.writeAsStringAsync(preparedDocPath, "broken");
    await expect(storage.getRoute(record.id)).rejects.toBeInstanceOf(SavedRouteCorruptError);
    expect((await storage.getOriginalRoute(record.id)).document.name).toBe("Original");
    await fs.writeAsStringAsync(preparedDocPath, JSON.stringify(makePrepared(
      (await storage.getOriginalRoute(record.id)).document).document));
    await fs.writeAsStringAsync(`${storage.getBaseDir()}/data/${record.id}/prepared/${oldId}/preparation.json`, "broken");
    await expect(storage.getRoute(record.id)).rejects.toBeInstanceOf(SavedRouteCorruptError);
    const reverted = await storage.revertPreparation(record.id, buildSourceIdentityToken(current!));
    expect(reverted.activeVersionId).toBeNull();
    expect((await storage.getRoute(record.id)).document.maneuvers).toHaveLength(0);
  });

  it("keeps original bytes and the previous active version after failure at every publication phase and restart", async () => {
    const phases = ["mkdir", "write-document", "write-manifest", "read-document", "read-manifest", "publish"] as const;
    for (const phase of phases) {
      const fs = new InMemoryFileSystem();
      const db = new InMemoryRouteDb();
      const storage = new LocalRouteStorage(db, fs);
      await storage.init();
      const record = await storage.saveImportedRoute({ gpxContent: gpx,
        document: { schemaVersion: 1, id: `phase-${phase}`, name: "Original", source: { kind: "gpx" },
          segments: [{ id: "source-seg", points: [{ latitude: 40, longitude: -74 },
            { latitude: 40.01, longitude: -74 }, { latitude: 40.02, longitude: -74 }] }],
          controlPoints: [], waypoints: [], maneuvers: [], summary: { distanceMeters: 2224, durationSeconds: 0 } },
        distanceMeters: 2224 });
      const originalBytes = await fs.readAsStringAsync(record.originalGpxPath);
      const initial = await storage.acceptPreparation({ routeId: record.id,
        prepared: makePrepared((await storage.getRoute(record.id)).document),
        expectedSourceToken: buildSourceIdentityToken(record) });
      const previousId = initial.activeVersionId!;
      const targetPath = `/prepared/`;
      let failed = false;
      const failOnce = () => { if (!failed) { failed = true; throw new Error(`injected ${phase}`); } };
      if (phase === "mkdir") {
        const original = fs.makeDirectoryAsync.bind(fs);
        fs.makeDirectoryAsync = async (path, options) => {
          if (path.includes(targetPath) && !path.includes(`/${previousId}/`)) failOnce();
          return original(path, options);
        };
      } else if (phase.startsWith("write-")) {
        const original = fs.writeAsStringAsync.bind(fs);
        const suffix = phase === "write-document" ? "/document.json" : "/preparation.json";
        fs.writeAsStringAsync = async (path, content, options) => {
          if (path.includes(targetPath) && path.endsWith(suffix) && !path.includes(`/${previousId}/`)) failOnce();
          return original(path, content, options);
        };
      } else if (phase.startsWith("read-")) {
        const original = fs.readAsStringAsync.bind(fs);
        const suffix = phase === "read-document" ? "/document.json" : "/preparation.json";
        fs.readAsStringAsync = async (path, options) => {
          if (path.includes(targetPath) && path.endsWith(suffix) && !path.includes(`/${previousId}/`)) failOnce();
          return original(path, options);
        };
      } else {
        db.commitActivePreparation = async () => failOnce();
      }
      const before = await db.getRoute(record.id);
      await expect(storage.acceptPreparation({ routeId: record.id,
        prepared: makePrepared((await storage.getOriginalRoute(record.id)).document),
        expectedSourceToken: buildSourceIdentityToken(before!) })).rejects.toThrow(`injected ${phase}`);
      expect((await db.getRoute(record.id))?.activePreparationId).toBe(previousId);
      expect(await fs.readAsStringAsync(record.originalGpxPath)).toBe(originalBytes);
      const restarted = new LocalRouteStorage(db, fs);
      await restarted.init();
      const restored = await restarted.getRoute(record.id);
      expect(restored.activeVersionId).toBe(previousId);
      expect(await fs.readAsStringAsync(record.originalGpxPath)).toBe(originalBytes);
      expect(await fs.getInfoAsync(`${storage.getBaseDir()}/data/${record.id}/prepared/${previousId}/document.json`)
        .then((info) => info.exists)).toBe(true);
    }
  });

  it("treats cleanup failure after publication as success and retains the new active version", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();
    const record = await storage.saveImportedRoute({ gpxContent: gpx,
      document: { schemaVersion: 1, id: "cleanup-route", name: "Original", source: { kind: "gpx" },
        segments: [{ id: "source-seg", points: [{ latitude: 40, longitude: -74 },
          { latitude: 40.01, longitude: -74 }, { latitude: 40.02, longitude: -74 }] }],
        controlPoints: [], waypoints: [], maneuvers: [], summary: { distanceMeters: 2224, durationSeconds: 0 } },
      distanceMeters: 2224 });
    const first = await storage.acceptPreparation({ routeId: record.id,
      prepared: makePrepared((await storage.getRoute(record.id)).document),
      expectedSourceToken: buildSourceIdentityToken(record) });
    const agedOrphan = `${storage.getBaseDir()}/data/${record.id}/prepared/p0_stale`;
    await fs.makeDirectoryAsync(agedOrphan, { intermediates: true });
    await fs.writeAsStringAsync(`${agedOrphan}/document.json`, "orphan");
    let failed = false;
    const remove = fs.deleteAsync.bind(fs);
    fs.deleteAsync = async (path, options) => {
      if (!failed && path === agedOrphan) {
        failed = true;
        throw new Error("injected post-commit cleanup failure");
      }
      return remove(path, options);
    };
    const before = await db.getRoute(record.id);
    const accepted = await storage.acceptPreparation({ routeId: record.id,
      prepared: makePrepared((await storage.getOriginalRoute(record.id)).document),
      expectedSourceToken: buildSourceIdentityToken(before!) });
    expect(accepted.activeVersionId).not.toBe(first.activeVersionId);
    expect((await db.getRoute(record.id))?.activePreparationId).toBe(accepted.activeVersionId);
    const restarted = new LocalRouteStorage(db, fs);
    await restarted.init();
    expect((await restarted.getRoute(record.id)).activeVersionId).toBe(accepted.activeVersionId);
  });

  it("rejects tampered source mappings and readiness claims before publishing", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();
    const record = await storage.saveImportedRoute({ gpxContent: gpx,
      document: { schemaVersion: 1, id: "semantic-route", name: "Original", source: { kind: "gpx", filename: "ride.gpx" },
        segments: [{ id: "source-seg", points: [{ latitude: 40, longitude: -74 },
          { latitude: 40.01, longitude: -74 }, { latitude: 40.02, longitude: -74 }] }],
        controlPoints: [], waypoints: [], maneuvers: [], summary: { distanceMeters: 2224, durationSeconds: 0 } },
      distanceMeters: 2224 });
    const source = (await storage.getOriginalRoute(record.id)).document;
    const token = buildSourceIdentityToken(record);
    const base = makePrepared(source);
    const corruptions: PreparedRouteResult[] = [];
    const truncated = structuredClone(base);
    truncated.document.segments.pop();
    truncated.document.summary = { distanceMeters: lineDistance(truncated.document.segments[0]!.points), durationSeconds: 30 };
    truncated.metadata.outputCoverage.pop();
    truncated.metadata.perSourceSegment[0]!.outputSegmentIndices.pop();
    corruptions.push(truncated);
    const falselyReady = structuredClone(base);
    falselyReady.metadata.status = "ready";
    corruptions.push(falselyReady);
    const fakeInterval = structuredClone(base);
    fakeInterval.metadata.outputCoverage[0]!.sourceInterval.endPointIndex = 2;
    corruptions.push(fakeInterval);
    const fakeMapping = structuredClone(base);
    fakeMapping.metadata.outputCoverage[0]!.sourceSegmentIndex = 2;
    corruptions.push(fakeMapping);
    const wrongSource = structuredClone(base);
    wrongSource.metadata.filename = "other.gpx";
    corruptions.push(wrongSource);
    const overlapping = structuredClone(base);
    overlapping.document.segments.push({ ...overlapping.document.segments[0]!, id: "duplicate-output" });
    overlapping.document.summary = { distanceMeters: (overlapping.document.summary?.distanceMeters ?? 0) * 2,
      durationSeconds: 60 };
    overlapping.metadata.outputCoverage.push({ ...overlapping.metadata.outputCoverage[0]!, outputSegmentIndex: 1 });
    overlapping.metadata.perSourceSegment[0]!.outputSegmentIndices.push(1);
    corruptions.push(overlapping);
    for (const prepared of corruptions) {
      await expect(storage.acceptPreparation({ routeId: record.id, prepared, expectedSourceToken: token }))
        .rejects.toThrow();
      expect((await db.getRoute(record.id))?.activePreparationId).toBeNull();
    }
  });

  it("rejects incomplete or reordered source partitions when loading a persisted version", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const storage = new LocalRouteStorage(db, fs);
    await storage.init();
    const record = await storage.saveImportedRoute({ gpxContent: gpx,
      document: { schemaVersion: 1, id: "partition-route", name: "Original", source: { kind: "gpx" },
        segments: [{ id: "source-seg", points: [{ latitude: 40, longitude: -74 },
          { latitude: 40.01, longitude: -74 }, { latitude: 40.02, longitude: -74 }] }],
        controlPoints: [], waypoints: [], maneuvers: [], summary: { distanceMeters: 2224, durationSeconds: 0 } },
      distanceMeters: 2224 });
    const accepted = await storage.acceptPreparation({ routeId: record.id, prepared: makePrepared((await storage.getOriginalRoute(record.id)).document),
      expectedSourceToken: buildSourceIdentityToken(record) });
    const versionDir = `${storage.getBaseDir()}/data/${record.id}/prepared/${accepted.activeVersionId}`;
    const manifestPath = `${versionDir}/preparation.json`;
    const validManifest = await fs.readAsStringAsync(manifestPath);
    const manifest = JSON.parse(validManifest);
    manifest.metadata.outputCoverage[1].sourceInterval.startDistanceMeters += 10;
    await fs.writeAsStringAsync(manifestPath, JSON.stringify(manifest));
    await expect(storage.getRoute(record.id)).rejects.toBeInstanceOf(SavedRouteCorruptError);
    manifest.metadata.outputCoverage[1].sourceInterval.startDistanceMeters -= 10;
    await fs.writeAsStringAsync(manifestPath, JSON.stringify(manifest));
    const preparedPath = `${versionDir}/document.json`;
    const document = JSON.parse(await fs.readAsStringAsync(preparedPath));
    document.segments.reverse();
    await fs.writeAsStringAsync(preparedPath, JSON.stringify(document));
    await expect(storage.getRoute(record.id)).rejects.toBeInstanceOf(SavedRouteCorruptError);
  });

  it("uses SQLite revision compare-and-swap across two concurrent storage instances", async () => {
    type NativeStatement = {
      all(...params: Array<string | number | null>): Array<Record<string, unknown>>;
      get(...params: Array<string | number | null>): Record<string, unknown> | undefined;
      run(...params: Array<string | number | null>): unknown;
    };
    type NativeDatabase = { exec(sql: string): void; prepare(sql: string): NativeStatement; close(): void };
    const native = new (require("node:sqlite") as { DatabaseSync: new (name: string) => NativeDatabase }).DatabaseSync(":memory:");
    const db = new ExpoSQLiteRouteDb({ openDatabaseAsync: async () => ({
      execAsync: async (sql: string) => native.exec(sql),
      getAllAsync: async (sql: string, params: unknown[] = []) => native.prepare(sql).all(...params as Array<string | number | null>),
      getFirstAsync: async (sql: string, params: unknown[] = []) => native.prepare(sql).get(...params as Array<string | number | null>) ?? null,
      runAsync: async (sql: string, params: unknown[] = []) => native.prepare(sql).run(...params as Array<string | number | null>),
      closeAsync: async () => native.close(),
    }) });
    const fs = new InMemoryFileSystem();
    const a = new LocalRouteStorage(db, fs);
    const b = new LocalRouteStorage(db, fs);
    await a.init();
    await b.init();
    const record = await a.saveImportedRoute({ gpxContent: gpx,
      document: { schemaVersion: 1, id: "concurrent-route", name: "Original", source: { kind: "gpx" },
        segments: [{ id: "source-seg", points: [{ latitude: 40, longitude: -74 },
          { latitude: 40.01, longitude: -74 }, { latitude: 40.02, longitude: -74 }] }],
        controlPoints: [], waypoints: [], maneuvers: [], summary: { distanceMeters: 2224, durationSeconds: 0 } },
      distanceMeters: 2224 });
    const token = buildSourceIdentityToken(record);
    const firstVersion = makePrepared((await a.getOriginalRoute(record.id)).document);
    const secondVersion = makePrepared((await b.getOriginalRoute(record.id)).document);
    const commit = db.commitActivePreparation.bind(db);
    let waiting = 0;
    let release!: () => void;
    const bothAtCommit = new Promise<void>((resolve) => { release = resolve; });
    db.commitActivePreparation = async (params) => {
      waiting++;
      if (waiting === 2) release();
      await bothAtCommit;
      return commit(params);
    };
    const results = await Promise.allSettled([
      a.acceptPreparation({ routeId: record.id, prepared: firstVersion, expectedSourceToken: token }),
      b.acceptPreparation({ routeId: record.id, prepared: secondVersion, expectedSourceToken: token }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(StalePreparationError);
    const committed = await db.getRoute(record.id);
    expect(committed?.revision).toBe(1);
    expect(committed?.activePreparationId).toBeTruthy();
    const restarted = new LocalRouteStorage(db, fs);
    await restarted.init();
    expect((await restarted.getRoute(record.id)).activeVersionId).toBe(committed?.activePreparationId);
    expect((await fs.getInfoAsync(`${a.getBaseDir()}/data/${record.id}/prepared/${committed?.activePreparationId}/document.json`)).exists).toBe(true);
    await db.close();
  });
});
