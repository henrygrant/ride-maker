import { describe, expect, it } from "vitest";
import type { RouteDocument, RoutePoint } from "@ride-maker/domain";
import { prepareGpxRoute } from "./prepare";
import type { TraceMatchingProvider } from "./types";

function original(): RouteDocument {
  return {
    schemaVersion: 1,
    id: "sol-trace",
    name: "Authored trace",
    source: { kind: "gpx", filename: "authored.gpx" },
    controlPoints: [],
    waypoints: [],
    maneuvers: [],
    segments: [{ id: "source", points: [
      { latitude: 40, longitude: -74 },
      { latitude: 40.0005, longitude: -74 },
      { latitude: 40.001, longitude: -74 },
      { latitude: 40.001, longitude: -73.9995 },
      { latitude: 40.001, longitude: -73.999 },
    ] }],
  };
}

function provider(transform: (points: RoutePoint[]) => RoutePoint[], instructions = true): TraceMatchingProvider {
  return {
    async matchTrace(request) {
      const points = transform(request.points.map(p => ({ ...p })));
      return {
        engine: "authored-fixture",
        discontinuities: [],
        matchedSegments: [{
          points,
          distanceMeters: 200,
          durationSeconds: 60,
          maneuvers: instructions ? [0, points.length - 1].map((shapeIndex, i) => ({
            id: `fixture-${i}`,
            segmentIndex: 0,
            shapeIndex,
            ...points[shapeIndex]!,
            instruction: i === 0 ? "Start" : "Arrive",
          })) : [],
        }],
      };
    },
  };
}

describe("Sol independent GPX preparation acceptance", () => {
  it("rejects reversed traversal of one straight edge despite zero unordered distance", async () => {
    const source = original();
    source.segments[0]!.points = [
      { latitude: 40, longitude: -74 },
      { latitude: 40.001, longitude: -74 },
    ];
    const result = await prepareGpxRoute(source, provider(points => points.reverse()));
    expect(result.metadata.status).not.toBe("ready");
  });
  it("does not call reversed geometry ready even when the same roads were matched", async () => {
    const source = original();
    const before = JSON.stringify(source);
    const result = await prepareGpxRoute(source, provider(p => p.reverse()));
    expect(result.metadata.status).not.toBe("ready");
    expect(result.metadata.warnings.some(w => w.code === "reversed_path" || w.code === "geometry_mismatch")).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("does not mark a match with no instructions ready for directions", async () => {
    const result = await prepareGpxRoute(original(), provider(p => p, false));
    expect(result.metadata.status).not.toBe("ready");
  });

  it("does not silently discard invalid maneuver references from a provider", async () => {
    const valid = provider(p => p);
    const invalid: TraceMatchingProvider = {
      async matchTrace(request) {
        const result = await valid.matchTrace(request);
        result.matchedSegments[0]!.maneuvers[0]!.shapeIndex = 999;
        return result;
      },
    };
    const result = await prepareGpxRoute(original(), invalid);
    expect(result.metadata.status).not.toBe("ready");
    expect(result.metadata.warnings.some(w => w.code === "validation_error" || w.code === "unmatched_section")).toBe(true);
  });
});
