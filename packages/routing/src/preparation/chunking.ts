import type { Maneuver, RoutePoint, RoutingProfile } from "@ride-maker/domain";
import { bearing, haversineDistance, polylineDistance, PolylineEdgeIndex } from "./geo";
import type {
  LocationBearingWarning,
  PreparationThresholds,
  TraceMatchedSegment,
  TraceMatchingProvider,
} from "./types";

export type ChunkSourceInterval = {
  startIndex: number;
  endIndex: number;
};

export type ProcessedChunk = {
  chunkIndex: number;
  sourceInterval: ChunkSourceInterval;
  requestInterval: ChunkSourceInterval;
  status: "matched" | "failed";
  segments: TraceMatchedSegment[];
  originalPoints: RoutePoint[];
  error?: string | undefined;
  discontinuities?: import("./types").TraceDiscontinuity[] | undefined;
};

export type ChunkMatchResult = {
  segments: TraceMatchedSegment[];
  warnings: LocationBearingWarning[];
  sourceCoverageDistanceMeters: number;
  segmentSourceIntervals: Array<ChunkSourceInterval & { matched: boolean }>;
};

export class TraceProviderValidationError extends Error {
  constructor(message: string) { super(message); this.name = "TraceProviderValidationError"; }
}

function validateMatchResult(value: unknown): asserts value is import("./types").TraceMatchResult {
  const r = value as import("./types").TraceMatchResult | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.matchedSegments) ||
      !Array.isArray(r.discontinuities) || typeof r.engine !== "string" || !r.engine.trim() ||
      (r.engineVersion !== undefined && typeof r.engineVersion !== "string")) {
    throw new TraceProviderValidationError("Trace provider returned a malformed result.");
  }
  if (r.matchedSegments.length > 10_000 || r.discontinuities.length > 10_000) throw new TraceProviderValidationError("Trace provider result exceeds output limits.");
  for (let i = 0; i < r.matchedSegments.length; i++) {
    const s = r.matchedSegments[i];
    if (!s || !Array.isArray(s.points) || s.points.length < 2 || s.points.length > 100_000 || !Array.isArray(s.maneuvers) ||
        typeof s.distanceMeters !== "number" || !Number.isFinite(s.distanceMeters) || s.distanceMeters < 0 ||
        typeof s.durationSeconds !== "number" || !Number.isFinite(s.durationSeconds) || s.durationSeconds < 0 ||
        (s.matched !== undefined && typeof s.matched !== "boolean")) throw new TraceProviderValidationError(`Trace provider returned an invalid matched segment at index ${i}.`);
    for (const p of s.points) {
      if (!p || !Number.isFinite(p.latitude) || p.latitude < -90 || p.latitude > 90 || !Number.isFinite(p.longitude) || p.longitude < -180 || p.longitude > 180 || (p.elevationMeters !== undefined && !Number.isFinite(p.elevationMeters)) || (p.time !== undefined && (typeof p.time !== "string" || !Number.isFinite(Date.parse(p.time))))) throw new TraceProviderValidationError(`Trace provider returned an invalid coordinate in segment ${i}.`);
    }
    for (const m of s.maneuvers) {
      if (!m || typeof m.id !== "string" || !m.id || !Number.isInteger(m.segmentIndex) || m.segmentIndex !== i ||
          !Number.isInteger(m.shapeIndex) || m.shapeIndex < 0 || m.shapeIndex >= s.points.length || typeof m.instruction !== "string" || !m.instruction.trim() ||
          !Number.isFinite(m.latitude) || m.latitude < -90 || m.latitude > 90 || !Number.isFinite(m.longitude) || m.longitude < -180 || m.longitude > 180 ||
          (m.verbalInstruction !== undefined && typeof m.verbalInstruction !== "string")) throw new TraceProviderValidationError(`Trace provider returned an invalid maneuver reference in segment ${i}.`);
      const p = s.points[m.shapeIndex]!;
      if (haversineDistance(p, m) > 1) throw new TraceProviderValidationError(`Trace provider maneuver coordinate does not match its shape index in segment ${i}.`);
    }
    if (s.matched === false && s.maneuvers.length > 0) throw new TraceProviderValidationError(`Unmatched segment ${i} must not contain guidance maneuvers.`);
  }
  for (const d of r.discontinuities) if (!d || !Number.isInteger(d.fromMatchedIndex) || d.fromMatchedIndex < 0 || d.fromMatchedIndex >= r.matchedSegments.length || !Number.isInteger(d.toMatchedIndex) || d.toMatchedIndex < 0 || d.toMatchedIndex >= r.matchedSegments.length || d.fromMatchedIndex === d.toMatchedIndex || (d.reason !== undefined && typeof d.reason !== "string")) throw new TraceProviderValidationError("Trace provider returned an invalid discontinuity reference.");
}

/**
 * Executes bounded chunking with concurrency limiting and deterministic seam reconciliation
 * for long input traces.
 *
 * Properties guaranteed:
 * - If a chunk fails, its ORIGINAL geometry is retained as an unmatched segment.
 * - Failed chunks are NEVER bridged or skipped; adjacent chunks remain disjoint.
 * - Seams verify ordered multi-point correspondence and direction alignment.
 * - Ambiguous seams (e.g. crossings, loops, out-and-back) are kept disjoint.
 * - Post-splice geometry distance and duration are strictly recomputed (no double-counting).
 * - Maneuver IDs are deterministic.
 */
export async function matchTraceWithChunking(
  points: RoutePoint[],
  provider: TraceMatchingProvider,
  profile: RoutingProfile,
  thresholds: PreparationThresholds,
  signal?: AbortSignal | undefined,
): Promise<ChunkMatchResult> {
  if (points.length <= thresholds.maxChunkPoints) {
    const res = await provider.matchTrace({
      points,
      profile,
      ...(signal !== undefined ? { signal } : {}),
    });
    validateMatchResult(res);
    const mapped = mapProviderSegmentsToSource(points, res.matchedSegments, 500);
    const resultWarnings: LocationBearingWarning[] = [
      ...(mapped ? [] : [{ code: "geometry_mismatch" as const, severity: "warning" as const, message: "Provider geometry could not be assigned to ordered source progress; review is required.", coordinate: points[0]! }]),
      ...res.discontinuities.map((d) => ({
        code: "discontinuity" as const,
        severity: "warning" as const,
        message: `Provider reported disconnected matched segments ${d.fromMatchedIndex} and ${d.toMatchedIndex}.`,
        coordinate: res.matchedSegments[d.toMatchedIndex]!.points[0]!,
        distanceMeters: 0,
      })),
    ];
    return {
      segments: mapped?.segments ?? [{ points: [...points], maneuvers: [], distanceMeters: polylineDistance(points), durationSeconds: 0, matched: false }],
      warnings: resultWarnings,
      sourceCoverageDistanceMeters: polylineDistance(points),
      segmentSourceIntervals: mapped?.intervals ?? [{ startIndex: 0, endIndex: points.length - 1, matched: false }],
    };
  }

  // 1. Slice trace into overlapping chunks with explicit source-progress intervals
  const chunkSize = thresholds.maxChunkPoints;
  const overlap = Math.min(thresholds.chunkOverlapPoints, Math.floor(chunkSize / 2));
  const step = chunkSize - overlap;

  type ChunkDefinition = {
    chunkIndex: number;
    sourceInterval: ChunkSourceInterval;
    points: RoutePoint[];
  };

  const chunkDefs: ChunkDefinition[] = [];
  let start = 0;
  while (start < points.length) {
    const end = Math.min(points.length, start + chunkSize);
    chunkDefs.push({
      chunkIndex: chunkDefs.length,
      sourceInterval: { startIndex: start, endIndex: end - 1 },
      points: points.slice(start, end),
    });
    if (end >= points.length) break;
    start += step;
  }
  if (chunkDefs.length > 256) {
    throw new Error("Preparation would require more than 256 trace requests. Increase the bounded chunk size or prepare a smaller trace.");
  }
  for (let i = 0; i < chunkDefs.length - 1; i++) {
    chunkDefs[i]!.sourceInterval.endIndex = chunkDefs[i + 1]!.sourceInterval.startIndex - 1;
  }

  // 2. Process chunks with bounded concurrency
  const processedChunks = new Array<ProcessedChunk>(chunkDefs.length);
  const concurrency = Math.max(1, thresholds.maxConcurrentRequests);

  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, chunkDefs.length) }, async () => {
    while (nextIndex < chunkDefs.length) {
      if (signal?.aborted) {
        throw new Error("Trace preparation aborted.");
      }
      const idx = nextIndex++;
      const def = chunkDefs[idx]!;

      try {
        const matchRes = await provider.matchTrace({
          points: def.points,
          profile,
          ...(signal !== undefined ? { signal } : {}),
        });
        validateMatchResult(matchRes);

        processedChunks[idx] = {
          chunkIndex: def.chunkIndex,
          sourceInterval: def.sourceInterval,
          requestInterval: { startIndex: def.sourceInterval.startIndex, endIndex: def.points.length - 1 + def.sourceInterval.startIndex },
          status: "matched",
          segments: matchRes.matchedSegments.map((s) => ({ ...s, matched: s.matched ?? true })),
          originalPoints: def.points,
          discontinuities: matchRes.discontinuities,
        };
      } catch (err) {
        if (err instanceof TraceProviderValidationError) throw err;
        if (signal?.aborted) throw new Error("Trace preparation aborted.");
        // Failed chunk: retain original points, mark failed
        const errMsg = err instanceof Error ? err.message : String(err);
        processedChunks[idx] = {
          chunkIndex: def.chunkIndex,
          sourceInterval: def.sourceInterval,
          requestInterval: { startIndex: def.sourceInterval.startIndex, endIndex: def.points.length - 1 + def.sourceInterval.startIndex },
          status: "failed",
          segments: [
            {
              points: [...def.points],
              maneuvers: [],
              distanceMeters: polylineDistance(def.points),
              durationSeconds: 0,
              matched: false,
            },
          ],
          originalPoints: def.points,
          error: errMsg,
        };
      }
    }
  });

  await Promise.all(workers);
  const outputPointCount = processedChunks.reduce((sum, c) => sum + c.segments.reduce((n, s) => n + s.points.length, 0), 0);
  if (outputPointCount > 200_000) throw new TraceProviderValidationError("Trace provider output exceeds the 200,000 point preparation limit.");

  // 3. Reconcile seams across consecutive chunks
  const outputSegments: TraceMatchedSegment[] = [];
  const segmentSourceIntervals: Array<ChunkSourceInterval & { matched: boolean }> = [];
  const warnings: LocationBearingWarning[] = [];

  for (const chunk of processedChunks) {
    if (chunk.status !== "matched") continue;
    for (const d of chunk.discontinuities ?? []) {
      const segment = chunk.segments[d.toMatchedIndex];
      if (segment) warnings.push({
        code: "discontinuity",
        severity: "warning",
        message: `Provider reported disconnected matched segments within source chunk ${chunk.chunkIndex}.`,
        coordinate: segment.points[0]!,
        sourceSegmentIndex: undefined,
      });
    }
  }

  for (let c = 0; c < processedChunks.length; c++) {
    const currentChunk = processedChunks[c]!;

    if (currentChunk.status === "failed") {
      const coord = currentChunk.originalPoints[0] ?? { latitude: 0, longitude: 0 };
      warnings.push({
        code: "unmatched_section",
        severity: "warning",
        message: `Chunk ${c} (points ${currentChunk.sourceInterval.startIndex}-${currentChunk.sourceInterval.endIndex}) matching failed: ${currentChunk.error ?? "unknown error"}. Original geometry retained without guidance.`,
        coordinate: { latitude: coord.latitude, longitude: coord.longitude },
        distanceMeters: Math.round(polylineDistance(currentChunk.originalPoints)),
      });
      // Retain original points as unmatched segment, never bridge
      const localStart = Math.max(0, currentChunk.sourceInterval.startIndex - currentChunk.requestInterval.startIndex);
      const localEnd = Math.min(currentChunk.originalPoints.length - 1, currentChunk.sourceInterval.endIndex - currentChunk.requestInterval.startIndex);
      const retained = currentChunk.originalPoints.slice(localStart, localEnd + 1);
      if (retained.length >= 2) {
        outputSegments.push({ points: retained, maneuvers: [], distanceMeters: polylineDistance(retained), durationSeconds: 0, matched: false });
        segmentSourceIntervals.push({ ...currentChunk.sourceInterval, matched: false });
      }
      continue;
    }

    if (outputSegments.length === 0) {
      const exact = exactClipChunk(currentChunk);
      outputSegments.push(...exact.segments);
      segmentSourceIntervals.push(...exact.intervals);
      continue;
    }

    const prevChunk = processedChunks[c - 1]!;
    // If previous chunk failed, do not attempt to reconcile seam; keep disjoint!
    if (prevChunk.status === "failed" || currentChunk.segments.length === 0) {
      const exact = exactClipChunk(currentChunk);
      outputSegments.push(...exact.segments);
      segmentSourceIntervals.push(...exact.intervals);
      continue;
    }

    const previousOutputInterval = segmentSourceIntervals.at(-1);
    const currentExact = exactClipChunk(currentChunk);
    if (previousOutputInterval?.matched && currentExact.intervals.length === 1 && currentExact.intervals[0]!.matched &&
        previousOutputInterval.endIndex + 1 === currentExact.intervals[0]!.startIndex && outputSegments.length > 0 && currentExact.segments.length === 1) {
      const left = outputSegments.at(-1)!;
      const right = currentExact.segments[0]!;
      const offset = left.points.length;
      const mergedPoints = [...left.points, ...right.points];
      const merged = {
        points: mergedPoints,
        maneuvers: [...left.maneuvers, ...right.maneuvers.map((m) => ({ ...m, shapeIndex: m.shapeIndex + offset }))],
        distanceMeters: polylineDistance(mergedPoints),
        durationSeconds: left.durationSeconds + right.durationSeconds,
        matched: true,
      } satisfies TraceMatchedSegment;
      outputSegments[outputSegments.length - 1] = merged;
      previousOutputInterval.endIndex = currentExact.intervals[0]!.endIndex;
      continue;
    }

    // Both previous and current chunk succeeded.
    // Attempt seam reconciliation between the last segment of outputSegments and the first of currentChunk.
    const prevSeg = outputSegments[outputSegments.length - 1]!;
    const firstCurrentSeg = currentChunk.segments[0]!;

    const seamResult = reconcileChunkSeam(
      prevSeg,
      firstCurrentSeg,
      thresholds.warningDeviationMeters,
      Math.max(0, Math.min(prevChunk.sourceInterval.endIndex, currentChunk.sourceInterval.endIndex) - Math.max(prevChunk.sourceInterval.startIndex, currentChunk.sourceInterval.startIndex) + 1),
    );

    if (seamResult.reconciled) {
      // Replace prevSeg with merged segment
      outputSegments[outputSegments.length - 1] = seamResult.mergedSegment;
      const priorInterval = segmentSourceIntervals[segmentSourceIntervals.length - 1]!;
      priorInterval.endIndex = currentChunk.sourceInterval.endIndex;
      // Append any remaining segments in current chunk
      for (let i = 1; i < currentChunk.segments.length; i++) {
        outputSegments.push(currentChunk.segments[i]!);
        segmentSourceIntervals.push({ ...currentChunk.sourceInterval, matched: true });
      }
    } else {
      // Seam could not be reconciled safely: retain both as disjoint segments
      warnings.push(seamResult.warning);
      const exact = exactClipChunk(currentChunk);
      outputSegments.push(...exact.segments);
      segmentSourceIntervals.push(...exact.intervals);
    }
  }

  return {
    segments: outputSegments,
    warnings,
    sourceCoverageDistanceMeters: coveredSourceDistance(points, processedChunks),
    segmentSourceIntervals,
  };
}

function exactClipChunk(chunk: ProcessedChunk): { segments: TraceMatchedSegment[]; intervals: Array<ChunkSourceInterval & { matched: boolean }> } {
  const localStart = Math.max(0, chunk.sourceInterval.startIndex - chunk.requestInterval.startIndex);
  const localEnd = Math.min(chunk.originalPoints.length - 1, chunk.sourceInterval.endIndex - chunk.requestInterval.startIndex);
  const retainedSource = chunk.originalPoints.slice(localStart, localEnd + 1);
  if (chunk.segments.length === 1 && retainedSource.length >= 2) {
    const candidate = chunk.segments[0]!;
    const points = candidate.points;
    const full = chunk.originalPoints;
    const isExact = points.length === full.length && points.every((p, i) => haversineDistance(p, full[i]!) <= 0.05);
    if (isExact) {
      const clipped = points.slice(localStart, localEnd + 1);
      const maneuvers = candidate.maneuvers.filter((m) => m.shapeIndex >= localStart && m.shapeIndex <= localEnd).map((m) => ({ ...m, shapeIndex: m.shapeIndex - localStart, latitude: clipped[m.shapeIndex - localStart]!.latitude, longitude: clipped[m.shapeIndex - localStart]!.longitude }));
      return { segments: [{ ...candidate, points: clipped, maneuvers, distanceMeters: polylineDistance(clipped) }], intervals: [{ ...chunk.sourceInterval, matched: true }] };
    }
  }
  // For snapped output, establish ordered source progress for every provider
  // segment before accepting it. The mapper preserves uncovered source intervals.
  if (retainedSource.length >= 2 && chunk.segments.length > 0) {
    const mapped = mapProviderSegmentsToSource(retainedSource, chunk.segments, 500);
    if (mapped) return {
      segments: mapped.segments,
      intervals: mapped.intervals.map((interval) => ({
        startIndex: interval.startIndex + chunk.sourceInterval.startIndex,
        endIndex: interval.endIndex + chunk.sourceInterval.startIndex,
        matched: interval.matched,
      })),
    };
  }
  // Without a source-progress proof, retain only the disjoint original interval.
  return retainedSource.length >= 1
    ? { segments: [{ points: retainedSource, maneuvers: [], distanceMeters: polylineDistance(retainedSource), durationSeconds: 0, matched: false }], intervals: [{ ...chunk.sourceInterval, matched: false }] }
    : { segments: [], intervals: [] };
}

function mapProviderSegmentsToSource(
  source: RoutePoint[],
  providerSegments: TraceMatchedSegment[],
  maxDeviationMeters: number,
): { segments: TraceMatchedSegment[]; intervals: Array<ChunkSourceInterval & { matched: boolean }> } | undefined {
  if (source.length < 2 || providerSegments.length === 0) return undefined;
  if (providerSegments.length === 1 && providerSegments[0]!.points.length === source.length &&
      providerSegments[0]!.points.every((point, i) => haversineDistance(point, source[i]!) <= 0.05)) {
    const candidate = providerSegments[0]!;
    return {
      segments: [{ ...candidate, matched: candidate.matched ?? true }],
      intervals: [{ startIndex: 0, endIndex: source.length - 1, matched: candidate.matched !== false }],
    };
  }
  const index = new PolylineEdgeIndex([source]);
  const ranges: Array<{ start: number; end: number; segment: TraceMatchedSegment }> = [];
  let previous = 0;
  for (const segment of providerSegments) {
    let first: ReturnType<PolylineEdgeIndex["nearest"]>;
    let last: ReturnType<PolylineEdgeIndex["nearest"]>;
    for (const point of segment.points) {
      const hit = index.nearest(point, Math.max(0, previous - 5), ranges.length === 0 && !first ? Math.max(20, index.totalLength * 0.02) : Infinity);
      if (!hit || hit.distanceMeters > maxDeviationMeters) return undefined;
      if (!first) first = hit;
      if (hit.progressMeters + 5 < previous) return undefined;
      previous = Math.max(previous, hit.progressMeters);
      last = hit;
    }
    if (!first || !last) return undefined;
    const start = first.edge.pointIndex;
    const end = last.edge.pointIndex + (last.fraction > 0 ? 1 : 0);
    if (end < start || (ranges.length > 0 && start < ranges[ranges.length - 1]!.end)) return undefined;
    ranges.push({ start, end: Math.min(source.length - 1, end), segment: { ...segment, matched: segment.matched ?? true } });
  }
  const segments: TraceMatchedSegment[] = [];
  const intervals: Array<ChunkSourceInterval & { matched: boolean }> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      const original = source.slice(cursor, range.start);
      if (original.length >= 1) {
        segments.push({ points: original, maneuvers: [], distanceMeters: polylineDistance(original), durationSeconds: 0, matched: false });
        intervals.push({ startIndex: cursor, endIndex: range.start - 1, matched: false });
      }
    }
    segments.push(range.segment);
    intervals.push({ startIndex: range.start, endIndex: range.end, matched: range.segment.matched !== false });
    cursor = Math.max(cursor, range.end + 1);
  }
  if (cursor < source.length) {
    const original = source.slice(cursor);
    if (original.length >= 1) {
      segments.push({ points: original, maneuvers: [], distanceMeters: polylineDistance(original), durationSeconds: 0, matched: false });
      intervals.push({ startIndex: cursor, endIndex: source.length - 1, matched: false });
    }
  }
  return { segments, intervals };
}

function coveredSourceDistance(points: RoutePoint[], chunks: ProcessedChunk[]): number {
  const coverageDelta = new Int16Array(points.length + 1);
  for (const chunk of chunks) {
    if (chunk.status !== "matched") continue;
    coverageDelta[chunk.sourceInterval.startIndex]!++;
    coverageDelta[Math.min(points.length, chunk.sourceInterval.endIndex + 1)]!--;
  }
  let covered = 0;
  let active = 0;
  for (let edge = 0; edge < points.length - 1; edge++) {
    active += coverageDelta[edge]!;
    if (active > 0) covered += haversineDistance(points[edge]!, points[edge + 1]!);
  }
  return covered;
}

export type SeamReconcileResult =
  | {
      reconciled: true;
      mergedSegment: TraceMatchedSegment;
    }
  | {
      reconciled: false;
      warning: LocationBearingWarning;
    };

/**
 * Reconciles the seam between two overlapping matched segments.
 *
 * Verifies ordered multi-point correspondence and direction alignment in the known overlap.
 * If correspondence is ambiguous, multiple candidates conflict, or direction differs,
 * reconciliation is safely aborted to leave disjoint segments without fake connecting geometry.
 */
export function reconcileChunkSeam(
  segmentA: TraceMatchedSegment,
  segmentB: TraceMatchedSegment,
  maxAllowableSeamDistanceMeters: number,
  expectedOverlapPoints?: number,
): SeamReconcileResult {
  const ptsA = segmentA.points;
  const ptsB = segmentB.points;

  if (ptsA.length < 3 || ptsB.length < 3) {
    const seamCoord = ptsA[ptsA.length - 1] ?? { latitude: 0, longitude: 0 };
    return {
      reconciled: false,
      warning: {
        code: "chunk_seam_unresolved",
        severity: "warning",
        message: "Chunk seam has insufficient points for safe multi-point reconciliation.",
        coordinate: { latitude: seamCoord.latitude, longitude: seamCoord.longitude },
      },
    };
  }

  // Exact ordered overlap is strong progress evidence (common for deterministic
  // providers and preserved-point snaps). It disambiguates loops and crossings.
  const maxOverlap = Math.min(80, ptsA.length - 1, ptsB.length - 1);
  const overlapCandidates = expectedOverlapPoints !== undefined
    ? [expectedOverlapPoints]
    : Array.from({ length: Math.max(0, maxOverlap - 1) }, (_, i) => maxOverlap - i);
  for (const count of overlapCandidates) {
    if (count < 2 || count > maxOverlap) continue;
    let agrees = true;
    for (let i = 0; i < count; i++) {
      if (haversineDistance(ptsA[ptsA.length - count + i]!, ptsB[i]!) > 0.5) { agrees = false; break; }
      if (i > 0) {
        const aBearing = bearing(ptsA[ptsA.length - count + i - 1]!, ptsA[ptsA.length - count + i]!);
        const bBearing = bearing(ptsB[i - 1]!, ptsB[i]!);
        let angle = Math.abs(aBearing - bBearing);
        if (angle > 180) angle = 360 - angle;
        if (angle > 20) { agrees = false; break; }
      }
    }
    if (!agrees) continue;
    const mergedPoints = [...ptsA, ...ptsB.slice(count)];
    const offset = ptsA.length - count;
    const shifted = segmentB.maneuvers.filter((m) => m.shapeIndex >= count).map((m) => {
      const shapeIndex = offset + m.shapeIndex;
      return { ...m, id: `maneuver-merged-${shapeIndex}`, shapeIndex, latitude: mergedPoints[shapeIndex]!.latitude, longitude: mergedPoints[shapeIndex]!.longitude };
    });
    return { reconciled: true, mergedSegment: {
      points: mergedPoints,
      maneuvers: [...segmentA.maneuvers.filter((m) => m.shapeIndex < offset), ...shifted],
      distanceMeters: polylineDistance(mergedPoints),
      durationSeconds: Math.round(segmentA.durationSeconds + segmentB.durationSeconds * (polylineDistance(ptsB.slice(count - 1)) / Math.max(1, segmentB.distanceMeters))),
      matched: true,
    } };
  }

  const seamCoord = ptsA[ptsA.length - 1]!;
  return {
    reconciled: false,
    warning: {
      code: "chunk_seam_unresolved",
      severity: "warning",
      message: `Chunk seam has no ordered overlap correspondence within ${maxAllowableSeamDistanceMeters}m. Retaining both matched portions as disjoint segments.`,
      coordinate: { latitude: seamCoord.latitude, longitude: seamCoord.longitude },
    },
  };
}
