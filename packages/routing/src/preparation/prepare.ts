import type {
  Maneuver,
  RouteDocument,
  RoutePoint,
  RouteSegment,
} from "@ride-maker/domain";
import {
  assessPreparation,
  detectSparseRoute,
  type AssessmentSegmentMapping,
} from "./assessment";
import { matchTraceWithChunking, TraceProviderValidationError } from "./chunking";
import { polylineDistance, simplifyPolylineWithAnchorsAndIndices } from "./geo";
import {
  DEFAULT_PREPARATION_THRESHOLDS,
  type LocationBearingWarning,
  type PrepareGpxOptions,
  type PreparedRouteResult,
  type PreparationReviewMetadata,
  type PreparationThresholds,
  type TraceMatchingProvider,
  type OutputSourceInterval,
} from "./types";

/**
 * Prepares an imported GPX RouteDocument for turn-by-turn navigation by matching
 * its full recorded geometry against a road network using a trace-matching provider.
 *
 * Guaranteed properties:
 * - Inputs are never mutated.
 * - Source kind ("gpx") and filename are strictly preserved.
 * - Multi-segment GPX files never have artificial connecting edges between segment gaps.
 * - Out-and-back turnarounds, loops, and sharp turns are preserved during simplification.
 * - Large traces are safely chunked with bounded concurrency and overlap seam reconciliation.
 * - Failed chunks or unmatched sections retain original geometry with guidance-unavailable warnings.
 * - Disconnected Valhalla alternates are retained as separate segments.
 * - Bidirectional deviation assessment detects both missed source points and excessive routing detours.
 * - All generated segment, maneuver, and route identities are deterministic.
 */
export async function prepareGpxRoute(
  document: RouteDocument,
  provider: TraceMatchingProvider,
  options: PrepareGpxOptions = {},
): Promise<PreparedRouteResult> {
  const profile = options.profile ?? "road";
  const thresholds: PreparationThresholds = {
    ...DEFAULT_PREPARATION_THRESHOLDS,
    ...options.thresholds,
  };

  validateThresholds(thresholds);
  validateInputDocument(document);

  const warnings: LocationBearingWarning[] = [];

  // Check if signal already aborted
  if (options.signal?.aborted) {
    throw new Error("Preparation was cancelled.");
  }

  // 1. Validate input segments
  if (!document.segments || document.segments.length === 0) {
    const emptyMeta: PreparationReviewMetadata = {
      version: 1,
      sourceId: document.id,
      sourceKind: document.source.kind,
      ...(document.source.kind === "gpx" && document.source.filename !== undefined
        ? { filename: document.source.filename }
        : {}),
      status: "failed",
      perSourceSegment: [],
      coverage: {
        sourceDistanceMeters: 0,
        matchedDistanceMeters: 0,
        unmatchedDistanceMeters: 0,
        coverageRatio: 0,
      },
      deviations: {
        maxDeviationMeters: 0,
        p50DeviationMeters: 0,
        p95DeviationMeters: 0,
        sourceToMatchedMaxMeters: 0,
        matchedToSourceMaxMeters: 0,
        samplingErrorBudgetMeters: 2.5,
      },
      outputCoverage: [],
      warnings: [
        {
          code: "validation_error",
          severity: "error",
          message: "Route document contains no track segments.",
          coordinate: { latitude: 0, longitude: 0 },
        },
      ],
      engineeringThresholds: thresholds,
    };

    return {
      document: {
        ...document,
        id: document.id,
        source: { ...document.source },
        segments: [],
        maneuvers: [],
      },
      metadata: emptyMeta,
    };
  }

  // 2. Check for sparse route-only input
  let isSparse = false;
  for (const seg of document.segments) {
    if (detectSparseRoute(seg.points, thresholds.maxSparsePointSpacingMeters)) {
      isSparse = true;
      break;
    }
  }

  if (isSparse && options.allowSparseRouteInference !== true) {
    // Sparse route detected: return needs-choice without silently faking a recorded track
    const firstCoord = document.segments[0]?.points[0] ?? { latitude: 0, longitude: 0 };
    warnings.push({
      code: "sparse_route",
      severity: "warning",
      message:
        "Sparse route input detected. The coordinate density indicates planning waypoints rather than a recorded track. Review required before bicycle route generation.",
      coordinate: { latitude: firstCoord.latitude, longitude: firstCoord.longitude },
    });

    const assessment = assessPreparation(
      document.segments.map((s, idx) => ({ index: idx, points: s.points })),
      document.segments.map((s) => s.points),
      document.segments.map((s, idx) => ({
        sourceSegmentIndex: idx,
        sourcePointsCount: s.points.length,
        sourceDistanceMeters: polylineDistance(s.points),
        matched: false,
        outputSegmentIndices: [idx],
        matchedOutputSegmentIndices: [],
        outputSourceIntervals: [{ outputSegmentIndex: idx, startPointIndex: 0, endPointIndex: Math.max(0, s.points.length - 1), matched: false, guidanceAvailable: false }],
      })),
      thresholds,
      true, // isSparseNeedsChoice
      warnings,
    );

    return {
      document: {
        ...document,
        id: document.id,
        source: { ...document.source },
        segments: document.segments.map((s, sIdx) => ({
          id: `segment-${sIdx}-0`,
          points: [...s.points],
        })),
        maneuvers: [],
      },
      metadata: {
        version: 1,
        sourceId: document.id,
        sourceKind: document.source.kind,
        ...(document.source.kind === "gpx" && document.source.filename !== undefined
          ? { filename: document.source.filename }
          : {}),
        status: "needs-choice",
        perSourceSegment: assessment.perSourceSegment,
        coverage: assessment.coverage,
        deviations: assessment.deviations,
        outputCoverage: assessment.outputCoverage,
        warnings: assessment.warnings,
        engineeringThresholds: thresholds,
      },
    };
  }

  // 3. Process each source segment independently
  const outputSegments: RouteSegment[] = [];
  const allManeuvers: Maneuver[] = [];
  const segmentMappings: AssessmentSegmentMapping[] = [];

  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;

  for (let sIdx = 0; sIdx < document.segments.length; sIdx++) {
    const sourceSeg = document.segments[sIdx]!;
    const srcDist = polylineDistance(sourceSeg.points);

    if (sourceSeg.points.length < 2) {
      const outIdx = outputSegments.length;
      outputSegments.push({
        id: `segment-${sIdx}-0`,
        points: [...sourceSeg.points],
      });
      segmentMappings.push({
        sourceSegmentIndex: sIdx,
        sourcePointsCount: sourceSeg.points.length,
        sourceDistanceMeters: srcDist,
        matched: false,
        outputSegmentIndices: [outIdx],
        matchedOutputSegmentIndices: [],
        outputSourceIntervals: [{ outputSegmentIndex: outIdx, startPointIndex: 0, endPointIndex: 0, matched: false, guidanceAvailable: false }],
      });
      continue;
    }

    // Simplify within measured error budget while strictly preserving critical anchors
    const simplified = simplifyPolylineWithAnchorsAndIndices(
      sourceSeg.points,
      thresholds.simplificationToleranceMeters,
    );

    try {
      const matchResult = await matchTraceWithChunking(
        simplified.points,
        provider,
        profile,
        thresholds,
        options.signal,
      );

      warnings.push(...matchResult.warnings.map((w) => ({ ...w, sourceSegmentIndex: sIdx })));

      if (matchResult.segments.length === 0) {
        // Unmatched: retain original geometry
        const outIdx = outputSegments.length;
        outputSegments.push({
          id: `segment-${sIdx}-0`,
          points: [...sourceSeg.points],
        });
        totalDistanceMeters += srcDist;
        segmentMappings.push({
          sourceSegmentIndex: sIdx,
          sourcePointsCount: sourceSeg.points.length,
          sourceDistanceMeters: srcDist,
          matched: false,
          outputSegmentIndices: [outIdx],
          matchedOutputSegmentIndices: [],
          outputSourceIntervals: [{ outputSegmentIndex: outIdx, startPointIndex: 0, endPointIndex: Math.max(0, sourceSeg.points.length - 1), matched: false, guidanceAvailable: false }],
        });
      } else {
        const sourceRanges = normalizeOriginalSourceRanges(
          matchResult.segmentSourceIntervals,
          simplified.indices,
          sourceSeg.points.length,
        );
        const assignedOutputIndices: number[] = [];
        const matchedOutputIndices: number[] = [];
        let allMatched = true;

        for (let subIdx = 0; subIdx < matchResult.segments.length; subIdx++) {
          const matchedSeg = matchResult.segments[subIdx]!;
          const range = sourceRanges[subIdx];
          const sourceStartIndex = range?.startIndex ?? 0;
          const sourceEndIndex = range?.endIndex ?? sourceSeg.points.length - 1;
          const isSegMatched = matchedSeg.matched !== false && (range?.matched ?? false);
          const effectivePoints = isSegMatched
            ? matchedSeg.points
            : sourceSeg.points.slice(sourceStartIndex, sourceEndIndex + 1);
          if (!isSegMatched) {
            allMatched = false;
          }

          const globalSegIdx = outputSegments.length;
          assignedOutputIndices.push(globalSegIdx);
          if (isSegMatched) {
            matchedOutputIndices.push(globalSegIdx);
          }

          outputSegments.push({
            id: `segment-${sIdx}-${subIdx}`,
            points: effectivePoints,
          });

          totalDistanceMeters += isSegMatched ? matchedSeg.distanceMeters : polylineDistance(effectivePoints);
          if (isSegMatched) totalDurationSeconds += matchedSeg.durationSeconds;

          // Re-index maneuvers deterministically to point to the output segment
          for (const m of isSegMatched ? matchedSeg.maneuvers : []) {
            const coord = matchedSeg.points[m.shapeIndex];
            if (coord !== undefined) {
              allManeuvers.push({
                ...m,
                id: `maneuver-${globalSegIdx}-${m.shapeIndex}`,
                segmentIndex: globalSegIdx,
                latitude: coord.latitude,
                longitude: coord.longitude,
              });
            }
          }
        }

        const outputSourceIntervals: OutputSourceInterval[] = [];
        for (let subIdx = 0; subIdx < assignedOutputIndices.length; subIdx++) {
          const range = sourceRanges[subIdx];
          const startPointIndex = range?.startIndex ?? 0;
          const endPointIndex = range?.endIndex ?? sourceSeg.points.length - 1;
          const outputSegmentIndex = assignedOutputIndices[subIdx]!;
          const matched = (range?.matched ?? false) && matchedOutputIndices.includes(outputSegmentIndex);
          outputSourceIntervals.push({ outputSegmentIndex, startPointIndex, endPointIndex, matched, guidanceAvailable: matched && allManeuvers.some((m) => m.segmentIndex === outputSegmentIndex) });
        }

        segmentMappings.push({
          sourceSegmentIndex: sIdx,
          sourcePointsCount: sourceSeg.points.length,
          sourceDistanceMeters: srcDist,
          matched: allMatched,
          outputSegmentIndices: assignedOutputIndices,
          matchedOutputSegmentIndices: matchedOutputIndices,
          coveredSourceDistanceMeters: matchResult.sourceCoverageDistanceMeters,
          outputSourceIntervals,
        });
      }
    } catch (err) {
      if (options.signal?.aborted) throw new Error("Preparation was cancelled.");
      // Trace matching failed: retain original geometry with warning
      const firstCoord = sourceSeg.points[0] ?? { latitude: 0, longitude: 0 };
      warnings.push({
        code: err instanceof TraceProviderValidationError ? "validation_error" : "unmatched_section",
        severity: "warning",
        message: `Matching failed for segment ${sIdx}: ${err instanceof Error ? err.message : String(err)}`,
        coordinate: { latitude: firstCoord.latitude, longitude: firstCoord.longitude },
        sourceSegmentIndex: sIdx,
      });

      const outIdx = outputSegments.length;
      outputSegments.push({
        id: `segment-${sIdx}-0`,
        points: [...sourceSeg.points],
      });
      totalDistanceMeters += srcDist;
      segmentMappings.push({
        sourceSegmentIndex: sIdx,
        sourcePointsCount: sourceSeg.points.length,
        sourceDistanceMeters: srcDist,
        matched: false,
        outputSegmentIndices: [outIdx],
        matchedOutputSegmentIndices: [],
        outputSourceIntervals: [{ outputSegmentIndex: outIdx, startPointIndex: 0, endPointIndex: Math.max(0, sourceSeg.points.length - 1), matched: false, guidanceAvailable: false }],
      });
    }
  }

  // 4. Run bidirectional assessment
  const assessment = assessPreparation(
    document.segments.map((s, idx) => ({ index: idx, points: s.points })),
    outputSegments.map((s) => s.points),
    segmentMappings,
    thresholds,
    false, // isSparseNeedsChoice
    warnings,
  );

  // A geometrically plausible path without usable instructions cannot guide navigation.
  const matchedOutputSet = new Set(segmentMappings.flatMap((m) => m.matchedOutputSegmentIndices ?? []));
  const missingInstructionSegment = [...matchedOutputSet].find((segmentIndex) =>
    !allManeuvers.some((m) => m.segmentIndex === segmentIndex),
  );
  if (allManeuvers.length === 0 || missingInstructionSegment !== undefined) {
    if (assessment.status === "ready") assessment.status = "partial";
    assessment.warnings.push({
      code: "validation_error",
      severity: "warning",
      message: allManeuvers.length === 0
        ? "Matched geometry contains no validated maneuvers; turn-by-turn guidance is unavailable."
        : `Matched output segment ${missingInstructionSegment} contains no validated maneuvers; guidance is incomplete.`,
      coordinate: outputSegments[missingInstructionSegment ?? 0]?.points[0] ?? document.segments[0]?.points[0] ?? { latitude: 0, longitude: 0 },
    });
  }

  // 5. Build prepared document (preserving source kind and filename)
  const preparedDocument: RouteDocument = {
    schemaVersion: document.schemaVersion,
    id: document.id,
    name: document.name,
    ...(document.description !== undefined ? { description: document.description } : {}),
    source: { ...document.source },
    segments: outputSegments,
    controlPoints: document.controlPoints.map((cp, idx) => ({
      ...cp,
      id: `control-${idx}-${cp.kind}`,
    })),
    waypoints: document.waypoints.map((wp, idx) => ({
      ...wp,
      id: `waypoint-${idx}`,
    })),
    maneuvers: allManeuvers,
    summary: {
      distanceMeters: Math.round(totalDistanceMeters),
      durationSeconds: Math.round(totalDurationSeconds),
    },
    routing: {
      profile,
      engine: "valhalla",
    },
  };

  const metadata: PreparationReviewMetadata = {
    version: 1,
    sourceId: document.id,
    sourceKind: document.source.kind,
    ...(document.source.kind === "gpx" && document.source.filename !== undefined
      ? { filename: document.source.filename }
      : {}),
    status: assessment.status,
    perSourceSegment: assessment.perSourceSegment,
    coverage: assessment.coverage,
    deviations: assessment.deviations,
    outputCoverage: assessment.outputCoverage,
    warnings: assessment.warnings,
    engineeringThresholds: thresholds,
  };

  return {
    document: preparedDocument,
    metadata,
  };
}

function validateInputDocument(document: RouteDocument): void {
  if (!document || typeof document !== "object" || typeof document.id !== "string" ||
      !document.id || typeof document.name !== "string" || !document.name || document.schemaVersion !== 1 ||
      !document.source || !["gpx", "new"].includes(document.source.kind) || !Array.isArray(document.segments) || document.segments.length > 10_000 ||
      !Array.isArray(document.controlPoints) || !Array.isArray(document.waypoints) || !Array.isArray(document.maneuvers)) {
    throw new Error("Invalid route document or segment count.");
  }
  if (document.source.kind === "gpx" && ((document.source.filename !== undefined && typeof document.source.filename !== "string") || (document.source.creator !== undefined && typeof document.source.creator !== "string"))) throw new Error("Invalid GPX provenance fields.");
  if (document.summary !== undefined && (!Number.isFinite(document.summary.distanceMeters) || document.summary.distanceMeters < 0 || !Number.isFinite(document.summary.durationSeconds) || document.summary.durationSeconds < 0)) throw new Error("Invalid source route summary.");
  for (const [kind, points] of [["control point", document.controlPoints], ["waypoint", document.waypoints]] as const) {
    for (const p of points) {
      validatePoint(p, kind);
      if (typeof p.id !== "string" || !p.id) throw new Error(`Invalid ${kind} identity.`);
    }
  }
  let count = 0;
  for (const segment of document.segments) {
    if (!segment || typeof segment.id !== "string" || !Array.isArray(segment.points)) throw new Error("Invalid source segment.");
    count += segment.points.length;
    if (count > 100_000) throw new Error("GPX exceeds the 100,000 point preparation limit.");
    for (const p of segment.points) validatePoint(p, "source");
  }
  for (const m of document.maneuvers) {
    validatePoint(m, "source maneuver");
    if (!m || typeof m.id !== "string" || !m.id || !Number.isInteger(m.segmentIndex) || m.segmentIndex < 0 || m.segmentIndex >= document.segments.length ||
        !Number.isInteger(m.shapeIndex) || m.shapeIndex < 0 || m.shapeIndex >= document.segments[m.segmentIndex]!.points.length ||
        typeof m.instruction !== "string" || !m.instruction.trim() || (m.verbalInstruction !== undefined && typeof m.verbalInstruction !== "string")) {
      throw new Error("Invalid source maneuver or shape reference.");
    }
  }
}

function validatePoint(p: unknown, label: string): asserts p is RoutePoint {
  const v = p as RoutePoint | null;
  if (!v || typeof v !== "object" || !Number.isFinite(v.latitude) || v.latitude < -90 || v.latitude > 90 ||
      !Number.isFinite(v.longitude) || v.longitude < -180 || v.longitude > 180 ||
      (v.elevationMeters !== undefined && !Number.isFinite(v.elevationMeters)) ||
      (v.time !== undefined && (typeof v.time !== "string" || !Number.isFinite(Date.parse(v.time))))) {
    throw new Error(`Invalid ${label} coordinate or point attributes.`);
  }
}

function normalizeOriginalSourceRanges(
  ranges: Array<{ startIndex: number; endIndex: number; matched: boolean }>,
  simplifiedIndices: number[],
  sourcePointCount: number,
): Array<{ startIndex: number; endIndex: number; matched: boolean }> {
  if (ranges.length === 0) return [];
  const normalized = ranges.map((range) => ({
    startIndex: simplifiedIndices[range.startIndex] ?? 0,
    endIndex: simplifiedIndices[range.endIndex] ?? sourcePointCount - 1,
    matched: range.matched,
  }));
  normalized[0]!.startIndex = 0;
  for (let i = 1; i < normalized.length; i++) {
    const previous = normalized[i - 1]!;
    const current = normalized[i]!;
    const boundary = current.startIndex > previous.endIndex + 1
      ? current.startIndex
      : previous.endIndex;
    previous.endIndex = boundary;
    current.startIndex = boundary;
    if (current.endIndex < boundary) {
      current.endIndex = boundary;
      current.matched = false;
    }
  }
  normalized[normalized.length - 1]!.endIndex = sourcePointCount - 1;
  return normalized;
}

function validateThresholds(t: PreparationThresholds): void {
  const positive = ["maxAllowedDeviationMeters", "warningDeviationMeters", "maxSparsePointSpacingMeters", "simplificationToleranceMeters", "requestTimeoutMs"] as const;
  for (const key of positive) if (!Number.isFinite(t[key]) || t[key] <= 0 || t[key] > 120_000) throw new Error(`Invalid preparation threshold: ${key}.`);
  if (!Number.isFinite(t.minReadyCoverageRatio) || t.minReadyCoverageRatio <= 0 || t.minReadyCoverageRatio > 1 ||
      !Number.isFinite(t.minPartialCoverageRatio) || t.minPartialCoverageRatio < 0 || t.minPartialCoverageRatio > t.minReadyCoverageRatio ||
      !Number.isInteger(t.maxChunkPoints) || t.maxChunkPoints < 2 || t.maxChunkPoints > 10_000 ||
      !Number.isInteger(t.chunkOverlapPoints) || t.chunkOverlapPoints < 0 || t.chunkOverlapPoints >= t.maxChunkPoints ||
      !Number.isInteger(t.maxConcurrentRequests) || t.maxConcurrentRequests < 1 || t.maxConcurrentRequests > 8) {
    throw new Error("Invalid preparation bounds or coverage thresholds.");
  }
}
