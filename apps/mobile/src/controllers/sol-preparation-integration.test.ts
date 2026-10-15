import { expect, it } from "vitest";
import type { RouteDocument } from "@ride-maker/domain";
import { serializeGpx } from "@ride-maker/gpx";
import { prepareGpxRoute, type TraceMatchingProvider } from "@ride-maker/routing";
import { prepareNavigationRide } from "@ride-maker/navigation";
import { InMemoryFileSystem } from "../storage/file-system-interface";
import { InMemoryRouteDb } from "../storage/sqlite-db";
import { LocalRouteStorage } from "../storage/local-route-storage";
import { buildSourceIdentityToken } from "../storage/types";

it("prepares, saves, reloads and compiles a real partial result without dropping the original ride tail", async () => {
  const original: RouteDocument = {
    schemaVersion: 1, id: "sol-boundary-ride", name: "Boundary ride",
    source: { kind: "gpx", filename: "boundary.gpx" },
    controlPoints: [], waypoints: [], maneuvers: [],
    segments: [
      { id: "covered", points: [
        { latitude: 40, longitude: -74 },
        { latitude: 40.0005, longitude: -74 },
        { latitude: 40.001, longitude: -74 },
        { latitude: 40.001, longitude: -73.9995 },
        { latitude: 40.001, longitude: -73.999 },
      ] },
      { id: "uncovered", points: [
        { latitude: 40.002, longitude: -73.998 },
        { latitude: 40.0025, longitude: -73.998 },
        { latitude: 40.003, longitude: -73.998 },
        { latitude: 40.003, longitude: -73.9975 },
        { latitude: 40.003, longitude: -73.997 },
      ] },
    ],
  };
  const provider: TraceMatchingProvider = {
    async matchTrace({ points }) {
      if (points[0]!.latitude > 40.0015) throw new Error("Authored unavailable section");
      return { engine: "authored-fixture", discontinuities: [], matchedSegments: [{
        points: points.map(point => ({ ...point })), distanceMeters: 200, durationSeconds: 60,
        maneuvers: [0, points.length - 1].map((shapeIndex, index) => ({
          id: `fixture-${index}`, segmentIndex: 0, shapeIndex,
          ...points[shapeIndex]!, instruction: index === 0 ? "Head north" : "Turn right",
        })),
      }] };
    },
  };
  const fs = new InMemoryFileSystem();
  const db = new InMemoryRouteDb();
  const storage = new LocalRouteStorage(db, fs);
  const bytes = serializeGpx(original);
  const record = await storage.saveImportedRoute({ document: original, gpxContent: bytes,
    originalFilename: "boundary.gpx", distanceMeters: 400 });
  const result = await prepareGpxRoute(original, provider);
  expect(result.metadata.status).toBe("partial");
  expect(result.document.id).toBe(original.id);
  expect(result.metadata.outputCoverage.some(row => !row.guidanceAvailable)).toBe(true);

  const accepted = await storage.acceptPreparation({ routeId: record.id, prepared: result,
    expectedSourceToken: buildSourceIdentityToken(record) });
  const reopened = await new LocalRouteStorage(db, fs).getRoute(record.id);
  expect(reopened.activeVersionId).toBe(accepted.activeVersionId);
  expect(reopened.originalGpx).toBe(bytes);
  expect(reopened.preparationMetadata?.status).toBe("partial");
  const unavailable = reopened.preparationMetadata!.outputCoverage.filter(row => !row.guidanceAvailable);
  expect(unavailable).toHaveLength(1);
  expect(reopened.document.segments[unavailable[0]!.outputSegmentIndex]!.points)
    .toEqual(original.segments[1]!.points);
  const compiled = prepareNavigationRide(reopened.document, {
    guidanceUnavailableSegmentIndices: unavailable.map(row => row.outputSegmentIndex),
  });
  expect(compiled.ok).toBe(true);
  if (compiled.ok) expect(compiled.ride.guidanceUnavailableSegmentIndices).toEqual([1]);
});

it("keeps a failed middle chunk navigable as an uncovered section after durable acceptance", async () => {
  const points = Array.from({ length: 601 }, (_, index) => ({
    latitude: 40 + index * 0.00002,
    longitude: -74 + Math.sin(index / 7) * 0.0002,
  }));
  const original: RouteDocument = {
    schemaVersion: 1, id: "sol-chunk-boundary", name: "Chunk boundary",
    source: { kind: "gpx", filename: "chunk.gpx" },
    controlPoints: [], waypoints: [], maneuvers: [],
    segments: [{ id: "recorded", points }],
  };
  let calls = 0;
  const provider: TraceMatchingProvider = { async matchTrace(request) {
    calls++;
    if (calls === 2) throw new Error("Authored middle-chunk failure");
    return { engine: "authored-fixture", discontinuities: [], matchedSegments: [{
      points: request.points.map(point => ({ ...point })), distanceMeters: 150, durationSeconds: 60,
      maneuvers: [{ id: `depart-${calls}`, segmentIndex: 0, shapeIndex: 0,
        ...request.points[0]!, instruction: "Continue" }],
    }] };
  } };
  const storage = new LocalRouteStorage(new InMemoryRouteDb(), new InMemoryFileSystem());
  const record = await storage.saveImportedRoute({ document: original, gpxContent: serializeGpx(original),
    originalFilename: "chunk.gpx", distanceMeters: 1500 });
  const result = await prepareGpxRoute(original, provider, { thresholds: {
    maxChunkPoints: 32, chunkOverlapPoints: 8, maxConcurrentRequests: 1, simplificationToleranceMeters: 0.5,
  } });
  expect(calls).toBeGreaterThan(2);
  expect(result.metadata.status).toBe("partial");
  const saved = await storage.acceptPreparation({ routeId: record.id, prepared: result,
    expectedSourceToken: buildSourceIdentityToken(record) });
  const unavailable = saved.preparationMetadata!.outputCoverage.filter(row => !row.guidanceAvailable);
  expect(unavailable.length).toBeGreaterThan(0);
  for (const row of unavailable) {
    expect(saved.document.segments[row.outputSegmentIndex]!.points)
      .toEqual(points.slice(row.sourceInterval.startPointIndex, row.sourceInterval.endPointIndex + 1));
  }
  const compiled = prepareNavigationRide(saved.document, {
    guidanceUnavailableSegmentIndices: unavailable.map(row => row.outputSegmentIndex),
  });
  expect(compiled.ok, compiled.ok ? "compiled" : compiled.error.message).toBe(true);
});
