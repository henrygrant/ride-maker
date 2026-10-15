import type { RoutePoint } from "@ride-maker/domain";
import { assessBidirectionalDeviations, haversineDistance, polylineDistance } from "./geo";
import { GEOMETRY_SAMPLE_ERROR_BUDGET_METERS } from "./geo";
import type {
  CoverageFacts,
  LocationBearingWarning,
  PerSourceSegmentReview,
  OutputCoverage,
  OutputSourceInterval,
  PreparationStatus,
  PreparationThresholds,
} from "./types";

export type AssessmentSegmentMapping = {
  sourceSegmentIndex: number;
  sourcePointsCount: number;
  sourceDistanceMeters: number;
  matched: boolean;
  outputSegmentIndices: number[];
  matchedOutputSegmentIndices?: number[] | undefined;
  coveredSourceDistanceMeters?: number | undefined;
  outputSourceIntervals?: OutputSourceInterval[] | undefined;
  guidedOutputSegmentIndices?: number[] | undefined;
};

export type AssessmentResult = {
  status: PreparationStatus;
  coverage: CoverageFacts;
  deviations: ReturnType<typeof assessBidirectionalDeviations>["deviations"];
  warnings: LocationBearingWarning[];
  perSourceSegment: PerSourceSegmentReview[];
  outputCoverage: OutputCoverage[];
};

/**
 * Checks if input points represent a sparse planned route (e.g. route waypoints)
 * rather than a densely recorded GPS track.
 */
export function detectSparseRoute(
  points: RoutePoint[],
  maxSparsePointSpacingMeters: number,
): boolean {
  if (points.length < 2) return true;

  const totalDist = polylineDistance(points);
  const avgSpacing = totalDist / (points.length - 1);

  // Very sparse input: average spacing exceeds threshold (e.g. 500m)
  if (avgSpacing > maxSparsePointSpacingMeters) {
    return true;
  }

  // Few points with large spacing (> 250m between points on a small waypoint list)
  if (points.length <= 5 && avgSpacing > 250) {
    return true;
  }

  // Long gaps: more than 40% of segments have a huge jump (> 1000m) with few points
  if (points.length <= 15) {
    let hugeGaps = 0;
    for (let i = 0; i < points.length - 1; i++) {
      if (haversineDistance(points[i]!, points[i + 1]!) > 1000) {
        hugeGaps++;
      }
    }
    if (hugeGaps >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates fidelity, coverage, bidirectional deviations, and status across the whole trace.
 */
export function assessPreparation(
  sourceSegments: Array<{ index: number; points: RoutePoint[] }>,
  outputSegments: RoutePoint[][],
  segmentMappings: AssessmentSegmentMapping[],
  thresholds: PreparationThresholds,
  isSparseNeedsChoice: boolean,
  externalWarnings: LocationBearingWarning[] = [],
): AssessmentResult {
  const warnings: LocationBearingWarning[] = [...externalWarnings];

  // 1. Compare full source/output geometry and derive covered source intervals.
  let totalSourceDist = 0;
  let totalMatchedDist = 0;
  const sourceByIndex = new Map(sourceSegments.map((source) => [source.index, source.points]));
  const geometryBySource = new Map<number, ReturnType<typeof assessBidirectionalDeviations>>();
  const matchedIndexBySource = new Map<number, Set<number>>();
  const deviationResults = sourceSegments.map((source) => {
    const mapped = segmentMappings.find((m) => m.sourceSegmentIndex === source.index);
    const indices = mapped?.matchedOutputSegmentIndices ?? (mapped?.matched ? mapped.outputSegmentIndices : []);
    const outputs = indices.map((i) => outputSegments[i]).filter((s): s is RoutePoint[] => !!s);
    matchedIndexBySource.set(source.index, new Set(indices));
    const result = assessBidirectionalDeviations(source.points, outputs, thresholds.warningDeviationMeters);
    geometryBySource.set(source.index, result);
    return result;
  });

  const perSourceSegment: PerSourceSegmentReview[] = segmentMappings.map((m) => {
    totalSourceDist += m.sourceDistanceMeters;
    const coverageIntervals = geometryBySource.get(m.sourceSegmentIndex)?.sourceCoverageIntervals ?? [];
    const sourcePoints = sourceByIndex.get(m.sourceSegmentIndex) ?? [];
    const cumulative = cumulativeDistances(sourcePoints);
    const declaredPointIntervals = (m.outputSourceIntervals ?? [])
      .filter((i) => i.matched)
      .map((i) => [i.startPointIndex, i.endPointIndex] as const);
    let matchedDist = declaredPointIntervals.length > 0
      ? unionSourceIndexDistance(declaredPointIntervals, cumulative)
      : unionIntervalLength(coverageIntervals.map((i) => [i.startDistanceMeters, i.endDistanceMeters] as const));
    matchedDist = Math.min(m.sourceDistanceMeters, matchedDist);
    totalMatchedDist += matchedDist;

    const segCoverage =
      m.sourceDistanceMeters > 0
        ? Math.min(1.0, Math.round((matchedDist / m.sourceDistanceMeters) * 1000) / 1000)
        : 1.0;

    const isFullyMatched = m.matched && segCoverage >= thresholds.minReadyCoverageRatio;

    if (!isFullyMatched) {
      const srcPoints = sourceByIndex.get(m.sourceSegmentIndex) ?? [];
      const coord = srcPoints[0] ?? { latitude: 0, longitude: 0 };
      const alreadyHasWarning = warnings.some(
        (w) => w.code === "unmatched_section" && w.sourceSegmentIndex === m.sourceSegmentIndex,
      );
      if (!alreadyHasWarning) {
        warnings.push({
          code: "unmatched_section",
          severity: "warning",
          message: `Source segment ${m.sourceSegmentIndex} has unmatched sections. Original geometry is preserved without guidance.`,
          coordinate: { latitude: coord.latitude, longitude: coord.longitude },
          sourceSegmentIndex: m.sourceSegmentIndex,
          distanceMeters: Math.round(m.sourceDistanceMeters - matchedDist),
        });
      }
    }

    return {
      sourceSegmentIndex: m.sourceSegmentIndex,
      sourcePointsCount: m.sourcePointsCount,
      sourceDistanceMeters: Math.round(m.sourceDistanceMeters * 10) / 10,
      matched: isFullyMatched,
      outputSegmentIndices: m.outputSegmentIndices,
      coverageRatio: segCoverage,
    };
  });

  const unmatchedDist = Math.max(0, totalSourceDist - totalMatchedDist);
  const overallCoverage =
    totalSourceDist > 0
      ? Math.min(1.0, Math.round((totalMatchedDist / totalSourceDist) * 1000) / 1000)
      : 0;

  const coverage: CoverageFacts = {
    sourceDistanceMeters: Math.round(totalSourceDist * 10) / 10,
    matchedDistanceMeters: Math.round(totalMatchedDist * 10) / 10,
    unmatchedDistanceMeters: Math.round(unmatchedDist * 10) / 10,
    coverageRatio: overallCoverage,
  };

  // 2. Bidirectional deviations assessment
  const highDeviationLocations = deviationResults.flatMap((r) => r.highDeviationLocations);
  const maxSource = Math.max(0, ...deviationResults.map((r) => r.deviations.sourceToMatchedMaxMeters));
  const maxMatched = Math.max(0, ...deviationResults.map((r) => r.deviations.matchedToSourceMaxMeters));
  const allSampledDistances = deviationResults.flatMap((r) => r.sampledDistancesMeters).sort((a, b) => a - b);
  const deviations = {
    sourceToMatchedMaxMeters: maxSource,
    matchedToSourceMaxMeters: maxMatched,
    maxDeviationMeters: Math.max(maxSource, maxMatched),
    p50DeviationMeters: percentile(allSampledDistances, 0.5),
    p95DeviationMeters: percentile(allSampledDistances, 0.95),
    samplingErrorBudgetMeters: GEOMETRY_SAMPLE_ERROR_BUDGET_METERS,
  };

  const reversed = deviationResults.some((r) => r.reversed);
  if (reversed) {
    const p = sourceSegments[0]?.points[0] ?? { latitude: 0, longitude: 0 };
    warnings.push({ code: "reversed_path", severity: "warning", message: "Matched geometry runs opposite to the source trace direction.", coordinate: p });
  }

  for (const h of highDeviationLocations) {
    warnings.push({
      code: "high_deviation",
      severity: h.distanceMeters > thresholds.maxAllowedDeviationMeters ? "warning" : "info",
      message: `Geometry deviation of ${Math.round(h.distanceMeters)}m detected (${h.direction === "matched_to_source" ? "matched path deviates from original" : "original path not followed"}).`,
      coordinate: h.coordinate,
      distanceMeters: Math.round(h.distanceMeters),
    });
  }

  // 3. Determine overall preparation status
  let status: PreparationStatus = "ready";

  if (isSparseNeedsChoice) {
    status = "needs-choice";
  } else if (
    totalMatchedDist === 0 ||
    overallCoverage < thresholds.minPartialCoverageRatio
  ) {
    status = "failed";
  } else if (
    overallCoverage < thresholds.minReadyCoverageRatio ||
    deviations.maxDeviationMeters + deviations.samplingErrorBudgetMeters > thresholds.maxAllowedDeviationMeters ||
    perSourceSegment.some((s) => !s.matched) || reversed ||
    warnings.some((w) => w.code === "discontinuity" || w.code === "chunk_seam_unresolved" || w.code === "geometry_mismatch")
  ) {
    status = "partial";
  }

  const outputCoverage: OutputCoverage[] = [];
  for (const m of segmentMappings) {
    const source = sourceByIndex.get(m.sourceSegmentIndex);
    if (!source) continue;
    const cumulative = cumulativeDistances(source);
    const sourceDist = cumulative.at(-1) ?? 0;
    const outputSet = matchedIndexBySource.get(m.sourceSegmentIndex) ?? new Set<number>();
    if (m.outputSourceIntervals) {
      for (const interval of m.outputSourceIntervals) {
        const startPointIndex = Math.max(0, Math.min(source.length - 1, interval.startPointIndex));
        const endPointIndex = Math.max(startPointIndex, Math.min(source.length - 1, interval.endPointIndex));
        outputCoverage.push({
          outputSegmentIndex: interval.outputSegmentIndex,
          sourceSegmentIndex: m.sourceSegmentIndex,
          sourceInterval: { startDistanceMeters: cumulative[startPointIndex]!, endDistanceMeters: cumulative[endPointIndex]!, startPointIndex, endPointIndex },
          guidanceAvailable: interval.guidanceAvailable && interval.matched,
          matched: interval.matched,
        });
      }
      continue;
    }
    for (const outputSegmentIndex of m.outputSegmentIndices) {
      const isMatched = outputSet.has(outputSegmentIndex);
      outputCoverage.push({
        outputSegmentIndex,
        sourceSegmentIndex: m.sourceSegmentIndex,
          sourceInterval: { startDistanceMeters: 0, endDistanceMeters: sourceDist, startPointIndex: 0, endPointIndex: Math.max(0, source.length - 1) },
        guidanceAvailable: isMatched && (m.guidedOutputSegmentIndices?.includes(outputSegmentIndex) ?? false),
        matched: isMatched,
      });
    }
  }

  return {
    status,
    coverage,
    deviations,
    warnings,
    perSourceSegment,
    outputCoverage,
  };
}

function cumulativeDistances(points: RoutePoint[]): number[] {
  const result = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length; i++) result[i] = result[i - 1]! + haversineDistance(points[i - 1]!, points[i]!);
  return result;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
}

function unionIntervalLength(intervals: ReadonlyArray<readonly [number, number]>): number {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  let total = 0, start = NaN, end = NaN;
  for (const [a, b] of sorted) {
    if (b <= a) continue;
    if (!Number.isFinite(start)) { start = a; end = b; }
    else if (a > end) { total += end - start; start = a; end = b; }
    else end = Math.max(end, b);
  }
  return total + (Number.isFinite(start) ? end - start : 0);
}

function unionSourceIndexDistance(intervals: ReadonlyArray<readonly [number, number]>, cumulative: number[]): number {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  let total = 0, start = -1, end = -1;
  for (const [a, b] of sorted) {
    if (b < a) continue;
    if (start < 0) { start = a; end = b; }
    else if (a <= end + 1) end = Math.max(end, b);
    else { total += (cumulative[end] ?? 0) - (cumulative[start] ?? 0); start = a; end = b; }
  }
  return total + (start < 0 ? 0 : (cumulative[end] ?? 0) - (cumulative[start] ?? 0));
}
