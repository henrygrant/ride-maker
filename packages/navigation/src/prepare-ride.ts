import type { RouteDocument } from "@ride-maker/domain";
import {
  bearingDegrees,
  distanceMeters,
  isValidCoordinate,
} from "./geo.js";
import { buildSpatialGridIndex } from "./spatial-index.js";
import type {
  BoundingBox,
  PreparedEdge,
  PreparedManeuver,
  PreparedNavigationRide,
  PreparedPoint,
  PreparedSegment,
  PrepareNavigationRideResult,
} from "./types.js";

const MANEUVER_COORDINATE_TOLERANCE_METERS = 15;
const MAX_EDGE_SPAN_DEGREES = 1.0; // ~110km max span for a single edge
const MAX_ROUTE_POINTS = 100_000;

export type PrepareNavigationRideOptions = {
  /** Original segment indices with no validated provider instruction coverage. */
  readonly guidanceUnavailableSegmentIndices?: readonly number[];
};

export function prepareNavigationRide(
  document: RouteDocument,
  options: PrepareNavigationRideOptions = {},
): PrepareNavigationRideResult {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return fail("INVALID_COORDINATE", "Route document must be an object");
  }
  if (!Array.isArray(document.segments) || !Array.isArray(document.maneuvers)) {
    return fail("INVALID_COORDINATE", "Route segments and maneuvers must be arrays");
  }
  // Validate schema version
  if (document.schemaVersion !== 1) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_SCHEMA_VERSION",
        message: `Unsupported schema version: ${document.schemaVersion}. Expected 1.`,
      },
    };
  }

  // Validate geometry non-empty
  if (!document.segments || document.segments.length === 0) {
    return {
      ok: false,
      error: {
        code: "DEGENERATE_GEOMETRY",
        message: "Route document must contain at least one segment",
      },
    };
  }

  // Validate segments and point counts
  let pointCount = 0;
  for (let s = 0; s < document.segments.length; s++) {
    const segment = document.segments[s];
    if (!segment || !segment.points || segment.points.length < 2) {
      return {
        ok: false,
        error: {
          code: "EMPTY_SEGMENT",
          message: `Segment at index ${s} must have at least 2 points`,
          details: { segmentIndex: s },
        },
      };
    }
    if (typeof segment.id !== "string" || segment.id.trim() === "") {
      return fail("EMPTY_SEGMENT", `Segment ${s} has no stable identity`, { segmentIndex: s });
    }
    pointCount += segment.points.length;
    if (pointCount > MAX_ROUTE_POINTS) {
      return fail("UNSUPPORTED_GEOMETRY", `Route exceeds the ${MAX_ROUTE_POINTS} point compilation limit`);
    }

    for (let p = 0; p < segment.points.length; p++) {
      const point = segment.points[p];
      if (!point || !isValidCoordinate(point)) {
        return {
          ok: false,
          error: {
            code: "INVALID_COORDINATE",
            message: `Segment ${s} point ${p} has invalid coordinates`,
            details: { segmentIndex: s, pointIndex: p },
          },
        };
      }
      if (point.elevationMeters !== undefined && !Number.isFinite(point.elevationMeters)) {
        return fail("INVALID_COORDINATE", `Segment ${s} point ${p} has invalid elevation`, { segmentIndex: s, pointIndex: p });
      }
      if (point.time !== undefined && typeof point.time !== "string") {
        return fail("INVALID_COORDINATE", `Segment ${s} point ${p} has invalid time`, { segmentIndex: s, pointIndex: p });
      }
    }
  }

  const unavailable = options.guidanceUnavailableSegmentIndices ?? [];
  if (!Array.isArray(unavailable) || unavailable.some((i) => !Number.isInteger(i) || i < 0 || i >= document.segments.length) || new Set(unavailable).size !== unavailable.length) {
    return fail("INVALID_MANEUVER_REFERENCE", "Guidance-unavailable segment indices must be unique valid segment indices");
  }
  if (typeof document.id !== "string" || document.id.trim() === "" || typeof document.name !== "string") {
    return fail("INVALID_MANEUVER_REFERENCE", "Route identity and name must be strings");
  }

  // Non-empty route without maneuvers must be structured as not ready
  if (!document.maneuvers || document.maneuvers.length === 0) {
    return {
      ok: false,
      error: {
        code: "NO_MANEUVERS",
        message:
          "Route contains no maneuvers and is not ready for turn-by-turn guidance",
      },
    };
  }

  // Compile segments and edges
  const preparedSegments: PreparedSegment[] = [];
  const preparedEdges: PreparedEdge[] = [];
  let rideCumulativeMeters = 0;
  let nextGlobalEdgeIndex = 0;

  for (let s = 0; s < document.segments.length; s++) {
    const segment = document.segments[s]!;
    const segmentStartDistance = rideCumulativeMeters;
    const preparedPoints: PreparedPoint[] = [];
    const segmentStartEdgeIndex = nextGlobalEdgeIndex;
    let segmentCumulativeMeters = 0;

    // First point of segment
    const firstPoint = segment.points[0]!;
    preparedPoints.push({
      latitude: firstPoint.latitude,
      longitude: firstPoint.longitude,
      pointIndex: 0,
      distanceAlongSegmentMeters: 0,
      distanceAlongRideMeters: rideCumulativeMeters,
      ...(firstPoint.elevationMeters !== undefined
        ? { elevationMeters: firstPoint.elevationMeters }
        : {}),
      ...(firstPoint.time !== undefined ? { time: firstPoint.time } : {}),
    });

    for (let p = 1; p < segment.points.length; p++) {
      const prevPt = segment.points[p - 1]!;
      const currPt = segment.points[p]!;

      // Guard against excessive diagonal/world/antimeridian edge spans
      const latSpan = Math.abs(currPt.latitude - prevPt.latitude);
      const lonSpan = Math.abs(currPt.longitude - prevPt.longitude);
      if (latSpan > MAX_EDGE_SPAN_DEGREES || lonSpan > MAX_EDGE_SPAN_DEGREES) {
        return {
          ok: false,
          error: {
            code: "UNSUPPORTED_GEOMETRY",
            message: `Segment ${s} edge ${p - 1} spans excessive geographic distance (> ${MAX_EDGE_SPAN_DEGREES} degree), unsupported for cycling navigation`,
            details: { segmentIndex: s, pointIndex: p },
          },
        };
      }

      const edgeLen = distanceMeters(prevPt, currPt);

      segmentCumulativeMeters += edgeLen;
      rideCumulativeMeters += edgeLen;

      const preparedCurrPoint: PreparedPoint = {
        latitude: currPt.latitude,
        longitude: currPt.longitude,
        pointIndex: p,
        distanceAlongSegmentMeters: segmentCumulativeMeters,
        distanceAlongRideMeters: rideCumulativeMeters,
        ...(currPt.elevationMeters !== undefined
          ? { elevationMeters: currPt.elevationMeters }
          : {}),
        ...(currPt.time !== undefined ? { time: currPt.time } : {}),
      };
      preparedPoints.push(preparedCurrPoint);

      const prevPreparedPoint = preparedPoints[p - 1]!;
      const edgeBearing = bearingDegrees(prevPt, currPt);

      const boundingBox: BoundingBox = {
        minLatitude: Math.min(prevPt.latitude, currPt.latitude),
        maxLatitude: Math.max(prevPt.latitude, currPt.latitude),
        minLongitude: Math.min(prevPt.longitude, currPt.longitude),
        maxLongitude: Math.max(prevPt.longitude, currPt.longitude),
      };

      const edge: PreparedEdge = {
        edgeIndex: nextGlobalEdgeIndex,
        segmentIndex: s,
        startPointIndex: p - 1,
        endPointIndex: p,
        start: prevPreparedPoint,
        end: preparedCurrPoint,
        startDistanceMeters: rideCumulativeMeters - edgeLen,
        endDistanceMeters: rideCumulativeMeters,
        lengthMeters: edgeLen,
        bearingDegrees: edgeBearing,
        boundingBox,
      };

      preparedEdges.push(edge);
      nextGlobalEdgeIndex++;
    }

    const segmentEndDistance = rideCumulativeMeters;
    const segmentEndEdgeIndex = nextGlobalEdgeIndex - 1;

    // Detect segment gaps between consecutive segments
    let gapToNextMeters: number | null = null;
    if (s < document.segments.length - 1) {
      const nextSeg = document.segments[s + 1]!;
      const lastPointOfCurrent = segment.points[segment.points.length - 1]!;
      const firstPointOfNext = nextSeg.points[0]!;
      const gapDistance = distanceMeters(lastPointOfCurrent, firstPointOfNext);
      // If gap is greater than 10 meters, track it explicitly as a segment gap
      if (gapDistance > 10) {
        gapToNextMeters = gapDistance;
      }
    }

    preparedSegments.push({
      id: segment.id,
      segmentIndex: s,
      startDistanceMeters: segmentStartDistance,
      endDistanceMeters: segmentEndDistance,
      lengthMeters: segmentCumulativeMeters,
      points: preparedPoints,
      startEdgeIndex: segmentStartEdgeIndex,
      endEdgeIndex: segmentEndEdgeIndex,
      gapToNextMeters,
    });
  }

  // Reject entirely stationary / zero-distance routes
  if (rideCumulativeMeters <= 0.001) {
    return {
      ok: false,
      error: {
        code: "DEGENERATE_GEOMETRY",
        message: "Route geometry has zero total distance and cannot be navigated",
      },
    };
  }

  // Validate and compile maneuvers
  const preparedManeuvers: PreparedManeuver[] = [];
  const maneuverIds = new Set<string>();
  for (let m = 0; m < document.maneuvers.length; m++) {
    const maneuver = document.maneuvers[m]!;

    if (!maneuver || typeof maneuver !== "object" || typeof maneuver.id !== "string" || maneuver.id.trim() === "") {
      return fail("INVALID_MANEUVER_REFERENCE", `Maneuver ${m} has no stable identity`, { maneuverIndex: m });
    }
    if (maneuverIds.has(maneuver.id)) return fail("INVALID_MANEUVER_REFERENCE", `Maneuver identity ${maneuver.id} is duplicated`, { maneuverIndex: m, maneuverId: maneuver.id });
    maneuverIds.add(maneuver.id);
    if (m > 0 && (maneuver.segmentIndex < document.maneuvers[m - 1]!.segmentIndex || (maneuver.segmentIndex === document.maneuvers[m - 1]!.segmentIndex && maneuver.shapeIndex < document.maneuvers[m - 1]!.shapeIndex))) {
      return fail("INVALID_MANEUVER_REFERENCE", `Maneuver ${m} is out of route order`, { maneuverIndex: m, maneuverId: maneuver.id });
    }
    if (maneuver.verbalInstruction !== undefined && typeof maneuver.verbalInstruction !== "string") {
      return fail("INVALID_MANEUVER_INSTRUCTION", `Maneuver ${m} has invalid verbal instruction`, { maneuverIndex: m, maneuverId: maneuver.id });
    }

    if (
      typeof maneuver.segmentIndex !== "number" ||
      !Number.isInteger(maneuver.segmentIndex) ||
      maneuver.segmentIndex < 0 ||
      typeof maneuver.shapeIndex !== "number" ||
      !Number.isInteger(maneuver.shapeIndex) ||
      maneuver.shapeIndex < 0
    ) {
      return {
        ok: false,
        error: {
          code: "INVALID_MANEUVER_REFERENCE",
          message: `Maneuver at index ${m} has non-integer or malformed segment/shape index`,
          details: { maneuverIndex: m, maneuverId: maneuver.id },
        },
      };
    }

    if (!isValidCoordinate(maneuver)) {
      return {
        ok: false,
        error: {
          code: "INVALID_COORDINATE",
          message: `Maneuver at index ${m} has invalid coordinates`,
          details: { maneuverIndex: m, maneuverId: maneuver.id },
        },
      };
    }

    if (!maneuver.instruction || maneuver.instruction.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: "INVALID_MANEUVER_INSTRUCTION",
          message: `Maneuver at index ${m} has empty instruction`,
          details: { maneuverIndex: m, maneuverId: maneuver.id },
        },
      };
    }

    const seg = preparedSegments[maneuver.segmentIndex];
    if (!seg) {
      return {
        ok: false,
        error: {
          code: "INVALID_MANEUVER_REFERENCE",
          message: `Maneuver ${maneuver.id} references invalid segmentIndex ${maneuver.segmentIndex}`,
          details: { maneuverIndex: m, maneuverId: maneuver.id },
        },
      };
    }

    const targetPoint = seg.points[maneuver.shapeIndex];
    if (!targetPoint) {
      return {
        ok: false,
        error: {
          code: "INVALID_MANEUVER_REFERENCE",
          message: `Maneuver ${maneuver.id} references invalid shapeIndex ${maneuver.shapeIndex}`,
          details: { maneuverIndex: m, maneuverId: maneuver.id },
        },
      };
    }

    // Verify coordinate alignment with the referenced shape point
    const coordDiscrepancy = distanceMeters(maneuver, targetPoint);
    if (coordDiscrepancy > MANEUVER_COORDINATE_TOLERANCE_METERS) {
      return {
        ok: false,
        error: {
          code: "COORDINATE_MISMATCH",
          message: `Maneuver ${maneuver.id} coordinates mismatch shape point by ${coordDiscrepancy.toFixed(1)}m (tolerance: ${MANEUVER_COORDINATE_TOLERANCE_METERS}m)`,
          details: { maneuverIndex: m, maneuverId: maneuver.id },
        },
      };
    }

    // Map maneuver to closest edge in the segment
    let edgeIndex = seg.startEdgeIndex + Math.min(maneuver.shapeIndex, seg.endEdgeIndex - seg.startEdgeIndex);
    if (edgeIndex > seg.endEdgeIndex) {
      edgeIndex = seg.endEdgeIndex;
    }

    preparedManeuvers.push({
      id: maneuver.id,
      maneuverIndex: m,
      segmentIndex: maneuver.segmentIndex,
      shapeIndex: maneuver.shapeIndex,
      edgeIndex,
      latitude: maneuver.latitude,
      longitude: maneuver.longitude,
      distanceAlongSegmentMeters: targetPoint.distanceAlongSegmentMeters,
      distanceAlongRideMeters: targetPoint.distanceAlongRideMeters,
      instruction: maneuver.instruction,
      ...(maneuver.verbalInstruction
        ? { verbalInstruction: maneuver.verbalInstruction }
        : {}),
    });
  }

  // Build 2D spatial grid index for fast bounded edge queries
  const spatialIndex = buildSpatialGridIndex(preparedEdges);

  return {
    ok: true,
    ride: {
      version: 1,
      routeId: document.id,
      routeName: document.name,
      totalDistanceMeters: rideCumulativeMeters,
      segments: preparedSegments,
      edges: preparedEdges,
      maneuvers: preparedManeuvers,
      spatialIndex,
      guidanceUnavailableSegmentIndices: [...unavailable].sort((a, b) => a - b),
    },
  };
}

function fail(code: import("./types.js").PrepareRideErrorCode, message: string, details?: { segmentIndex?: number; pointIndex?: number; maneuverId?: string; maneuverIndex?: number }): PrepareNavigationRideResult {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}
