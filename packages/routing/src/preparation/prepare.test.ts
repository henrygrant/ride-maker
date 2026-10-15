import { describe, expect, it } from "vitest";
import {
  createClosedLoopDocument,
  createCurvedRideDocument,
  createDenseLongTraceDocument,
  createOutAndBackDocument,
  createSeparateSegmentsDocument,
  createSparseRouteDocument,
} from "./fixtures";
import { haversineDistance, polylineDistance, simplifyPolylineWithAnchors } from "./geo";
import { prepareGpxRoute } from "./prepare";
import type {
  TraceMatchedSegment,
  TraceMatchingProvider,
  TraceMatchRequest,
  TraceMatchResult,
} from "./types";

/**
 * Creates a mock TraceMatchingProvider that returns the input points as matched road geometry,
 * simulating perfect road snapping.
 */
function createMockSnappingProvider(options: {
  delayMs?: number;
  throwOnCall?: number;
  customHandler?: (req: TraceMatchRequest) => Promise<TraceMatchResult>;
} = {}): TraceMatchingProvider & { calls: TraceMatchRequest[] } {
  const calls: TraceMatchRequest[] = [];
  let callCount = 0;

  return {
    calls,
    async matchTrace(request: TraceMatchRequest): Promise<TraceMatchResult> {
      calls.push(request);
      callCount++;

      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }

      if (options.throwOnCall && callCount === options.throwOnCall) {
        throw new Error(`Simulated matching failure on call ${callCount}`);
      }

      if (options.customHandler) {
        return options.customHandler(request);
      }

      const points = request.points;
      const distMeters = polylineDistance(points);
      const maneuvers = [
        {
          id: `m-0`,
          segmentIndex: 0,
          shapeIndex: 0,
          instruction: "Start route",
          latitude: points[0]!.latitude,
          longitude: points[0]!.longitude,
        },
        ...(points.length > 2
          ? [
              {
                id: `m-mid`,
                segmentIndex: 0,
                shapeIndex: Math.floor(points.length / 2),
                instruction: "Turn right onto Bike Path",
                latitude: points[Math.floor(points.length / 2)]!.latitude,
                longitude: points[Math.floor(points.length / 2)]!.longitude,
              },
            ]
          : []),
      ];

      return {
        matchedSegments: [
          {
            points: [...points],
            maneuvers,
            distanceMeters: distMeters,
            durationSeconds: Math.round(distMeters / 5), // ~18 km/h cycling
          },
        ],
        discontinuities: [],
        engine: "valhalla",
      };
    },
  };
}

describe("prepareGpxRoute Core Preparation Suite", () => {
  it("Shape 1: Normal curved ride prepares with clean ready status, preserved source, and maneuvers", async () => {
    const doc = createCurvedRideDocument();
    const originalDocJson = JSON.stringify(doc);
    const provider = createMockSnappingProvider();

    const result = await prepareGpxRoute(doc, provider);

    // Inputs must remain completely unmodified
    expect(JSON.stringify(doc)).toBe(originalDocJson);

    // Prepared document attributes
    expect(result.document.id).toBe(doc.id);
    expect(result.document.name).toBe("Curved City Ride");
    expect(result.document.source.kind).toBe("gpx");
    expect(result.document.source).toEqual(doc.source);
    expect(result.document.segments).toHaveLength(1);
    expect(result.document.segments[0]!.id).toBe("segment-0-0");
    expect(result.document.maneuvers.length).toBeGreaterThan(0);
    expect(result.document.maneuvers[0]!.id).toBe("maneuver-0-0");
    expect(result.document.maneuvers[0]!.segmentIndex).toBe(0);

    // Review metadata
    expect(result.metadata.sourceId).toBe(doc.id);
    expect(result.metadata.sourceKind).toBe("gpx");
    expect(result.metadata.status).toBe("ready");
    expect(result.metadata.coverage.coverageRatio).toBeCloseTo(1.0, 2);
    expect(result.metadata.deviations.maxDeviationMeters).toBeLessThan(1.0);
    expect(result.metadata.perSourceSegment).toHaveLength(1);
    expect(result.metadata.perSourceSegment[0]!.matched).toBe(true);
  });

  it("Shape 2: Closed loop ride preserves identical start and finish coordinates without collapsing", async () => {
    const doc = createClosedLoopDocument();
    const provider = createMockSnappingProvider();

    const result = await prepareGpxRoute(doc, provider);

    expect(result.metadata.status).toBe("ready");
    const outputPoints = result.document.segments[0]!.points;
    const firstPoint = outputPoints[0]!;
    const lastPoint = outputPoints[outputPoints.length - 1]!;

    // Start and finish must be at identical coordinates
    expect(firstPoint.latitude).toBe(lastPoint.latitude);
    expect(firstPoint.longitude).toBe(lastPoint.longitude);

    // The loop must have preserved all points and not collapsed to a single point
    expect(outputPoints.length).toBeGreaterThan(2);
    expect(result.document.summary!.distanceMeters).toBeGreaterThan(500);
  });

  it("Shape 3: Out-and-back ride preserves 180-degree turnaround apex and distinct outbound/inbound paths", async () => {
    const doc = createOutAndBackDocument();
    const provider = createMockSnappingProvider();

    // Verify anchor detection finds turnaround apex (reversal)
    const simplified = simplifyPolylineWithAnchors(doc.segments[0]!.points, 2.0);
    const apex = doc.segments[0]!.points.find((p) => p.latitude === 45.520 && p.longitude === -73.580)!;
    const hasApex = simplified.some(
      (p) => p.latitude === apex.latitude && p.longitude === apex.longitude,
    );
    expect(hasApex).toBe(true);

    const result = await prepareGpxRoute(doc, provider);
    expect(result.metadata.status).toBe("ready");

    const outPts = result.document.segments[0]!.points;
    const apexInResult = outPts.find(
      (p) => p.latitude === apex.latitude && p.longitude === apex.longitude,
    );
    expect(apexInResult).toBeDefined();

    // Total distance must reflect both outbound and return legs (~2.2 km)
    expect(result.document.summary!.distanceMeters).toBeGreaterThan(2000);
  });

  it("Shape 4: Crossing / chunk seam ride reconciles multi-point overlap without duplicate turns or double-counted distance", async () => {
    const doc = createCurvedRideDocument();
    const expandedPoints = [];
    for (let i = 0; i < 40; i++) {
      expandedPoints.push({
        latitude: 45.500 + i * 0.0005,
        longitude: -73.567 + Math.sin(i / 3) * 0.0005,
      });
    }
    doc.segments[0]!.points = expandedPoints;

    const provider = createMockSnappingProvider();

    // Force chunking with maxChunkPoints: 20, chunkOverlapPoints: 8
    const result = await prepareGpxRoute(doc, provider, {
      thresholds: {
        maxChunkPoints: 20,
        chunkOverlapPoints: 8,
        simplificationToleranceMeters: 0.1,
      },
    });

    // Seam should be cleanly reconciled into 1 continuous segment
    expect(result.document.segments).toHaveLength(1);
    expect(result.metadata.status).toBe("ready");

    // Spliced distance must not double-count the overlap
    const directDist = polylineDistance(result.document.segments[0]!.points);
    expect(result.document.summary!.distanceMeters).toBeCloseTo(directDist, 0);

    // All maneuver IDs must be deterministic and valid
    for (const m of result.document.maneuvers) {
      expect(m.id).toMatch(/^maneuver-/);
      expect(m.shapeIndex).toBeLessThan(result.document.segments[0]!.points.length);
    }
  });

  it("Shape 5: Separate segments and unmatched section retains original geometry without artificial edges", async () => {
    const doc = createSeparateSegmentsDocument();

    // Segment 0 matches cleanly; Segment 1 fails to match (e.g. off-road trail)
    const provider = createMockSnappingProvider({
      customHandler: async (req) => {
        // If request is near segment 1 (latitude > 45.51), throw matching error
        if (req.points[0]!.latitude > 45.51) {
          throw new Error("No OSM road candidate found for off-road trail");
        }
        return {
          matchedSegments: [
            {
              points: [...req.points],
              maneuvers: [
                {
                  id: "m-0",
                  segmentIndex: 0,
                  shapeIndex: 0,
                  instruction: "Follow paved road",
                  latitude: req.points[0]!.latitude,
                  longitude: req.points[0]!.longitude,
                },
              ],
              distanceMeters: polylineDistance(req.points),
              durationSeconds: 100,
            },
          ],
          discontinuities: [],
          engine: "valhalla",
        };
      },
    });

    const result = await prepareGpxRoute(doc, provider);

    // Segments must stay separate: exactly 2 distinct segments in output
    expect(result.document.segments).toHaveLength(2);

    // There must be NO artificial edge connecting segment 0's end to segment 1's start
    const seg0End = result.document.segments[0]!.points.at(-1)!;
    const seg1Start = result.document.segments[1]!.points[0]!;
    const gapDistance = haversineDistance(seg0End, seg1Start);
    expect(gapDistance).toBeGreaterThan(1000); // 1 km gap preserved

    // Segment 1 retained its exact original points
    expect(result.document.segments[1]!.points).toEqual(doc.segments[1]!.points);

    // Status is 'partial' because segment 1 could not be matched
    expect(result.metadata.status).toBe("partial");
    expect(result.metadata.perSourceSegment[0]!.matched).toBe(true);
    expect(result.metadata.perSourceSegment[1]!.matched).toBe(false);

    // Contains guidance-unavailable warning for segment 1
    const unmatchedWarning = result.metadata.warnings.find((w) => w.code === "unmatched_section");
    expect(unmatchedWarning).toBeDefined();
    expect(unmatchedWarning!.sourceSegmentIndex).toBe(1);

    // Maneuvers are attached ONLY to segment 0; no fake maneuvers for unmatched segment 1
    expect(result.document.maneuvers.every((m) => m.segmentIndex === 0)).toBe(true);
  });

  it("Dense long trace exercises anchor-preserving simplification and bounded chunk processing", async () => {
    const doc = createDenseLongTraceDocument(2500);
    const provider = createMockSnappingProvider();

    const result = await prepareGpxRoute(doc, provider, {
      thresholds: {
        maxChunkPoints: 80,
        chunkOverlapPoints: 20,
        simplificationToleranceMeters: 0.5,
      },
    });

    expect(result.metadata.status).toBe("ready");
    expect(result.metadata.coverage.coverageRatio).toBeGreaterThan(0.95);
    expect(result.document.segments.length).toBeGreaterThanOrEqual(1);

    // Concurrency check: multiple chunks were processed
    expect(provider.calls.length).toBeGreaterThan(1);
    for (const call of provider.calls) {
      expect(call.points.length).toBeLessThanOrEqual(80);
    }
  });

  it("Sparse route-only input returns discriminated needs-choice status without faking a recorded track", async () => {
    const doc = createSparseRouteDocument();
    const provider = createMockSnappingProvider();

    // Default call without allowSparseRouteInference
    const result = await prepareGpxRoute(doc, provider);

    expect(result.metadata.status).toBe("needs-choice");
    expect(result.document.maneuvers).toHaveLength(0);

    const sparseWarning = result.metadata.warnings.find((w) => w.code === "sparse_route");
    expect(sparseWarning).toBeDefined();
    expect(sparseWarning!.severity).toBe("warning");

    // Provider should not even be called when choice is required
    expect(provider.calls).toHaveLength(0);

    // With explicit allowSparseRouteInference: true, routing proceeds
    const allowedResult = await prepareGpxRoute(doc, provider, {
      allowSparseRouteInference: true,
    });
    expect(allowedResult.metadata.status).toBe("ready");
    expect(provider.calls.length).toBeGreaterThan(0);
  });

  it("Bidirectional deviation assessment detects large routing detours and wrong parallel roads", async () => {
    const doc = createCurvedRideDocument();

    // Provider returns a detour that strays 150m away from the recorded path
    const provider = createMockSnappingProvider({
      customHandler: async (req) => {
        const detourPoints = req.points.map((p, i) => {
          if (i === 1) {
            // Push point 150m west
            return { latitude: p.latitude, longitude: p.longitude - 0.002 };
          }
          return p;
        });

        return {
          matchedSegments: [
            {
              points: detourPoints,
              maneuvers: [],
              distanceMeters: polylineDistance(detourPoints),
              durationSeconds: 100,
            },
          ],
          discontinuities: [],
          engine: "valhalla",
        };
      },
    });

    const result = await prepareGpxRoute(doc, provider, {
      thresholds: {
        maxAllowedDeviationMeters: 50,
        warningDeviationMeters: 25,
      },
    });

    // Max deviation should be ~150m
    expect(result.metadata.deviations.maxDeviationMeters).toBeGreaterThan(100);
    expect(result.metadata.status).toBe("partial"); // Exceeds maxAllowedDeviationMeters

    const highDevWarning = result.metadata.warnings.find(
      (w) => w.code === "high_deviation" && (w.distanceMeters ?? 0) > 100,
    );
    expect(highDevWarning).toBeDefined();
    expect(highDevWarning!.distanceMeters).toBeGreaterThan(100);
  });

  it("Never bridges across a failed chunk: retains original geometry and leaves adjacent chunks disjoint", async () => {
    const doc = createDenseLongTraceDocument(2500);

    // Fail chunk 2 specifically (throw on call 2)
    const provider = createMockSnappingProvider({
      throwOnCall: 2,
    });

    const result = await prepareGpxRoute(doc, provider, {
      thresholds: {
        maxChunkPoints: 80,
        chunkOverlapPoints: 20,
        simplificationToleranceMeters: 0.5,
      },
    });

    // Chunk 2 failed: it must NOT be skipped, bridged, or omitted!
    // It must be retained as an unmatched segment, producing multiple disjoint segments!
    expect(result.document.segments.length).toBeGreaterThan(1);
    expect(result.metadata.status).toBe("partial");

    const unmatchedWarning = result.metadata.warnings.find((w) => w.code === "unmatched_section");
    expect(unmatchedWarning).toBeDefined();
    expect(unmatchedWarning!.message).toContain("Chunk 1");
  });

  it("Reconciliation flags ambiguous seams (e.g. crossings / figure-8) as disjoint without fake connections", async () => {
    const segA: TraceMatchedSegment = {
      points: [
        { latitude: 45.500, longitude: -73.570 },
        { latitude: 45.501, longitude: -73.570 },
        { latitude: 45.502, longitude: -73.570 },
      ],
      maneuvers: [],
      distanceMeters: 200,
      durationSeconds: 40,
    };

    // segB is crossing perpendicular to segA at 45.502 (heading west instead of north)
    const segB: TraceMatchedSegment = {
      points: [
        { latitude: 45.502, longitude: -73.570 },
        { latitude: 45.502, longitude: -73.572 },
        { latitude: 45.502, longitude: -73.574 },
      ],
      maneuvers: [],
      distanceMeters: 200,
      durationSeconds: 40,
    };

    const { reconcileChunkSeam } = await import("./chunking");
    const seamResult = reconcileChunkSeam(segA, segB, 25);

    // Heading differs by 90 degrees: seam reconciliation must reject and flag disjoint!
    expect(seamResult.reconciled).toBe(false);
    if (!seamResult.reconciled) {
      expect(seamResult.warning.code).toBe("chunk_seam_unresolved");
    }
  });

  it("Ensures deterministic IDs across repeated preparation runs", async () => {
    const doc = createCurvedRideDocument();
    const provider = createMockSnappingProvider();

    const run1 = await prepareGpxRoute(doc, provider);
    const run2 = await prepareGpxRoute(doc, provider);

    expect(run1.document.id).toBe(run2.document.id);
    expect(run1.document.segments.map((s) => s.id)).toEqual(run2.document.segments.map((s) => s.id));
    expect(run1.document.maneuvers.map((m) => m.id)).toEqual(run2.document.maneuvers.map((m) => m.id));
  });
});
