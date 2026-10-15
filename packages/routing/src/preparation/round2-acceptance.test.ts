import { describe, expect, it } from "vitest";
import { createDenseLongTraceDocument } from "./fixtures";
import { assessBidirectionalDeviations, polylineDistance } from "./geo";
import { prepareGpxRoute } from "./prepare";
import type { RouteDocument, RoutePoint } from "@ride-maker/domain";
import type { TraceMatchingProvider } from "./types";

function document(points: RoutePoint[]): RouteDocument {
  return {
    schemaVersion: 1, id: "round2", name: "round2", source: { kind: "gpx", filename: "round2.gpx" },
    controlPoints: [], waypoints: [], maneuvers: [], segments: [{ id: "source", points }],
  };
}

function echoProvider(edit?: (points: RoutePoint[]) => RoutePoint[]): TraceMatchingProvider {
  return { async matchTrace({ points }) {
    const matched = edit ? edit(points.map((p) => ({ ...p }))) : points.map((p) => ({ ...p }));
    return { engine: "fixture", discontinuities: [], matchedSegments: [{
      points: matched, distanceMeters: polylineDistance(matched), durationSeconds: 100,
      maneuvers: [{ id: "start", segmentIndex: 0, shapeIndex: 0, instruction: "Start", ...matched[0]! }],
    }] };
  } };
}

describe("Task008 Sol round-two regressions", () => {
  it("checks a short detour between the former fixed decimation samples", () => {
    const points = Array.from({ length: 1400 }, (_, i) => ({ latitude: 40 + i * 0.00001, longitude: -74 }));
    const detour = points.map((p) => ({ ...p }));
    detour[701]!.longitude += 0.002;
    const result = assessBidirectionalDeviations(points, [detour]);
    expect(result.deviations.maxDeviationMeters).toBeGreaterThan(100);
  });

  it("detects a reversed closed loop with shared start and finish coordinates", () => {
    const points = [
      { latitude: 40, longitude: -74 }, { latitude: 40.001, longitude: -74 },
      { latitude: 40.001, longitude: -73.999 }, { latitude: 40, longitude: -73.999 },
      { latitude: 40, longitude: -74 },
    ];
    const result = assessBidirectionalDeviations(points, [[...points].reverse()]);
    expect(result.reversed).toBe(true);
  });

  it("detects reordered repeated passes even when the endpoints agree", () => {
    const loop = [
      { latitude: 40, longitude: -74 }, { latitude: 40.001, longitude: -74 },
      { latitude: 40.001, longitude: -73.999 }, { latitude: 40, longitude: -73.999 },
      { latitude: 40, longitude: -74 }, { latitude: 40.001, longitude: -74 },
      { latitude: 40.001, longitude: -73.999 }, { latitude: 40, longitude: -73.999 },
      { latitude: 40, longitude: -74 },
    ];
    const reordered = [...loop.slice(0, 4), ...loop.slice(4).reverse()];
    const result = assessBidirectionalDeviations(loop, [reordered]);
    expect(result.reversed || result.deviations.maxDeviationMeters > 50).toBe(true);
  });

  it("does not assign provider geometry without source correspondence", async () => {
    const source = document(Array.from({ length: 60 }, (_, i) => ({ latitude: 40, longitude: -74 + i * 0.0001 })));
    const provider: TraceMatchingProvider = { async matchTrace({ points }) {
      const elsewhere = points.map((p) => ({ ...p, latitude: p.latitude + 0.02 }));
      return { engine: "fixture", discontinuities: [], matchedSegments: [{
        points: elsewhere, distanceMeters: polylineDistance(elsewhere), durationSeconds: 100, maneuvers: [],
      }] };
    } };
    const result = await prepareGpxRoute(source, provider);
    expect(result.metadata.status).not.toBe("ready");
    expect(result.metadata.outputCoverage.every((coverage) => !coverage.matched && !coverage.guidanceAvailable)).toBe(true);
    expect(result.document.segments[0]!.points[0]).toEqual(source.segments[0]!.points[0]);
    expect(result.document.segments[0]!.points.every((point) => Math.abs(point.latitude - 40) < 0.001)).toBe(true);
  });

  it("maps a failed middle chunk to guidance unavailable source intervals", async () => {
    const source = createDenseLongTraceDocument(3000);
    let call = 0;
    const provider: TraceMatchingProvider = { async matchTrace({ points }) {
      call++;
      if (call === 2) throw new Error("synthetic middle failure");
      const p = points.map((v) => ({ ...v }));
      return { engine: "fixture", discontinuities: [], matchedSegments: [{
        points: p, distanceMeters: polylineDistance(p), durationSeconds: 100,
        maneuvers: [{ id: "start", segmentIndex: 0, shapeIndex: 0, instruction: "Start", ...p[0]! }],
      }] };
    } };
    const result = await prepareGpxRoute(source, provider, { thresholds: { maxChunkPoints: 100, chunkOverlapPoints: 20 } });
    expect(result.metadata.status).toBe("partial");
    const intervals = result.metadata.outputCoverage;
    expect(intervals.length).toBeGreaterThan(1);
    expect(intervals.some((i) => !i.guidanceAvailable && !i.matched)).toBe(true);
    for (const item of intervals) {
      expect(item.sourceInterval.startPointIndex).toBeLessThanOrEqual(item.sourceInterval.endPointIndex);
      expect(Number.isFinite(item.sourceInterval.startDistanceMeters)).toBe(true);
      expect(Number.isFinite(item.sourceInterval.endDistanceMeters)).toBe(true);
      if (!item.matched) {
        const output = result.document.segments[item.outputSegmentIndex]!;
        const expected = source.segments[item.sourceSegmentIndex]!.points.slice(
          item.sourceInterval.startPointIndex, item.sourceInterval.endPointIndex + 1,
        );
        expect(output.points).toEqual(expected);
      }
    }
    expect(result.metadata.coverage.unmatchedDistanceMeters).toBeGreaterThan(0);
    const ordered = intervals.filter((i) => i.sourceSegmentIndex === 0).slice().sort(
      (a, b) => a.sourceInterval.startPointIndex - b.sourceInterval.startPointIndex,
    );
    expect(ordered[0]!.sourceInterval.startPointIndex).toBe(0);
    expect(ordered.at(-1)!.sourceInterval.endPointIndex).toBe(source.segments[0]!.points.length - 1);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!.sourceInterval.startPointIndex).toBe(ordered[i - 1]!.sourceInterval.endPointIndex);
    }
    expect(result.document.segments.every((segment) => segment.points.length >= 2)).toBe(true);
  });

  it("boundedly assesses all vertices in a 100,000 point trace", () => {
    const source = createDenseLongTraceDocument(100_000).segments[0]!.points;
    const result = assessBidirectionalDeviations(source, [source]);
    expect(result.deviations.maxDeviationMeters).toBeLessThan(1);
    expect(result.sampledDistancesMeters.length).toBeGreaterThanOrEqual(source.length * 2);
    expect(result.sourceCoverageIntervals).toHaveLength(1);
    expect(result.sourceCoverageIntervals[0]!.endPointIndex).toBe(source.length - 1);
  });
});
