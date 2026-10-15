import type { Coordinate, RoutePoint } from "@ride-maker/domain";
import type { DeviationFacts } from "./types";

const EARTH_RADIUS_METERS = 6_371_000;
const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

/**
 * Geodesic distance between two coordinates in meters using the Haversine formula.
 * Normalizes longitude difference across the antimeridian.
 */
export function haversineDistance(a: Coordinate, b: Coordinate): number {
  const phi1 = a.latitude * TO_RAD;
  const phi2 = b.latitude * TO_RAD;
  const deltaPhi = (b.latitude - a.latitude) * TO_RAD;

  let deltaLonDeg = (b.longitude - a.longitude) % 360;
  if (deltaLonDeg > 180) deltaLonDeg -= 360;
  if (deltaLonDeg < -180) deltaLonDeg += 360;
  const deltaLambda = deltaLonDeg * TO_RAD;

  const sinHalfDeltaPhi = Math.sin(deltaPhi / 2);
  const sinHalfDeltaLambda = Math.sin(deltaLambda / 2);
  const h =
    sinHalfDeltaPhi * sinHalfDeltaPhi +
    Math.cos(phi1) * Math.cos(phi2) * sinHalfDeltaLambda * sinHalfDeltaLambda;
  const clampedH = Math.min(1, Math.max(0, h));
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(clampedH));
}

/**
 * Cumulative distance of a polyline in meters.
 */
export function polylineDistance(points: Coordinate[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineDistance(points[i]!, points[i + 1]!);
  }
  return total;
}

/**
 * Initial bearing from coordinate a to coordinate b in degrees [0, 360).
 */
export function bearing(a: Coordinate, b: Coordinate): number {
  const phi1 = a.latitude * TO_RAD;
  const phi2 = b.latitude * TO_RAD;
  let deltaLonDeg = (b.longitude - a.longitude) % 360;
  if (deltaLonDeg > 180) deltaLonDeg -= 360;
  if (deltaLonDeg < -180) deltaLonDeg += 360;
  const deltaLambda = deltaLonDeg * TO_RAD;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return ((theta * TO_DEG) + 360) % 360;
}

/**
 * Absolute heading change at point `current` coming from `prev` and heading to `next`.
 * Returns an angle in degrees [0, 180]. Full reversal (180 deg) is an out-and-back turnaround.
 */
export function headingChange(
  prev: Coordinate,
  current: Coordinate,
  next: Coordinate,
): number {
  const b1 = bearing(prev, current);
  const b2 = bearing(current, next);
  let diff = Math.abs(b2 - b1);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * Distance in meters from a point to a line segment AB, projected equirectangularly
 * centered at the segment midpoint for precision.
 */
export function pointToSegmentDistance(
  point: Coordinate,
  a: Coordinate,
  b: Coordinate,
): { distanceMeters: number; closestPoint: Coordinate; t: number } {
  const midLat = (a.latitude + b.latitude) / 2;
  const cosMidLat = Math.cos(midLat * TO_RAD);

  // Local flat-plane projection in meters centered at A
  const bx = (b.longitude - a.longitude) * TO_RAD * EARTH_RADIUS_METERS * cosMidLat;
  const by = (b.latitude - a.latitude) * TO_RAD * EARTH_RADIUS_METERS;

  const px = (point.longitude - a.longitude) * TO_RAD * EARTH_RADIUS_METERS * cosMidLat;
  const py = (point.latitude - a.latitude) * TO_RAD * EARTH_RADIUS_METERS;

  const segLenSq = bx * bx + by * by;
  if (segLenSq < 1e-12) {
    const d = Math.sqrt(px * px + py * py);
    return { distanceMeters: d, closestPoint: { latitude: a.latitude, longitude: a.longitude }, t: 0 };
  }

  const rawT = (px * bx + py * by) / segLenSq;
  const t = Math.max(0, Math.min(1, rawT));

  const cx = t * bx;
  const cy = t * by;

  const dx = px - cx;
  const dy = py - cy;
  const distanceMeters = Math.sqrt(dx * dx + dy * dy);

  const closestLat = a.latitude + (cy / EARTH_RADIUS_METERS) * TO_DEG;
  const closestLon = a.longitude + (cx / (EARTH_RADIUS_METERS * cosMidLat)) * TO_DEG;

  return {
    distanceMeters,
    closestPoint: { latitude: closestLat, longitude: closestLon },
    t,
  };
}

/**
 * Minimum distance from a coordinate to any segment in a polyline.
 */
export function pointToPolylineDistance(
  point: Coordinate,
  polyline: Coordinate[],
): { distanceMeters: number; closestPoint: Coordinate; segmentIndex: number } {
  if (polyline.length === 0) {
    return { distanceMeters: Infinity, closestPoint: point, segmentIndex: -1 };
  }
  if (polyline.length === 1) {
    return {
      distanceMeters: haversineDistance(point, polyline[0]!),
      closestPoint: polyline[0]!,
      segmentIndex: 0,
    };
  }

  let minDistance = Infinity;
  let bestPoint = polyline[0]!;
  let bestIndex = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const res = pointToSegmentDistance(point, polyline[i]!, polyline[i + 1]!);
    if (res.distanceMeters < minDistance) {
      minDistance = res.distanceMeters;
      bestPoint = res.closestPoint;
      bestIndex = i;
    }
  }

  return { distanceMeters: minDistance, closestPoint: bestPoint, segmentIndex: bestIndex };
}

/**
 * Identifies critical anchor indices that must not be removed during simplification:
 * - Start (0) and Finish (points.length - 1)
 * - Points where heading changes sharply (turnaround / out-and-back apex, sharp turn > turnAngleThresholdDegrees)
 * - Stationary/pause points with consecutive coordinates
 */
export function findCriticalAnchors(
  points: Coordinate[],
  turnAngleThresholdDegrees = 110,
): number[] {
  if (points.length <= 2) {
    return points.map((_, i) => i);
  }

  const anchors = new Set<number>();
  anchors.add(0);
  anchors.add(points.length - 1);

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;

    const d1 = haversineDistance(prev, cur);
    const d2 = haversineDistance(cur, next);

    // If movement is negligible (e.g. GPS pause or duplicate coordinate), preserve
    if (d1 < 1.0 || d2 < 1.0) {
      anchors.add(i);
      continue;
    }

    const angle = headingChange(prev, cur, next);
    if (angle >= turnAngleThresholdDegrees) {
      anchors.add(i);
    }
  }

  return Array.from(anchors).sort((a, b) => a - b);
}

/**
 * Standard Ramer-Douglas-Peucker simplification between startIndex and endIndex.
 */
function rdpSlice(
  points: RoutePoint[],
  startIndex: number,
  endIndex: number,
  toleranceMeters: number,
  outKeep: boolean[],
  work: { examined: number; exhausted: boolean },
) {
  const pending: Array<[number, number]> = [[startIndex, endIndex]];
  while (pending.length > 0) {
    const [start, end] = pending.pop()!;
    if (end <= start + 1) continue;
    if (work.examined + end - start - 1 > 5_000_000) {
      // Preserve all original points if the measured simplification budget is
      // reached; never return a coarser path that exceeds the error budget.
      for (let i = start; i <= end; i++) outKeep[i] = true;
      work.exhausted = true;
      continue;
    }
    const a = points[start]!;
    const b = points[end]!;
    let maxDist = 0;
    let maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      work.examined++;
      const res = pointToSegmentDistance(points[i]!, a, b);
      if (res.distanceMeters > maxDist) { maxDist = res.distanceMeters; maxIdx = i; }
    }
    if (maxDist > toleranceMeters) {
      outKeep[maxIdx] = true;
      pending.push([start, maxIdx], [maxIdx, end]);
    }
  }
}

/**
 * Simplifies a polyline using Ramer-Douglas-Peucker while guaranteeing that
 * all critical anchor indices are preserved without modification.
 */
export function simplifyPolylineWithAnchors(
  points: RoutePoint[],
  toleranceMeters = 2.0,
  customAnchors?: number[],
): RoutePoint[] {
  return simplifyPolylineWithAnchorsAndIndices(points, toleranceMeters, customAnchors).points;
}

export function simplifyPolylineWithAnchorsAndIndices(
  points: RoutePoint[],
  toleranceMeters = 2.0,
  customAnchors?: number[],
): { points: RoutePoint[]; indices: number[] } {
  if (points.length <= 2) {
    return { points: [...points], indices: points.map((_, i) => i) };
  }

  const anchors = customAnchors ?? findCriticalAnchors(points);
  const keep = new Array<boolean>(points.length).fill(false);
  const work = { examined: 0, exhausted: false };

  for (const idx of anchors) {
    keep[idx] = true;
  }

  for (let a = 0; a < anchors.length - 1; a++) {
    const startIdx = anchors[a]!;
    const endIdx = anchors[a + 1]!;
    rdpSlice(points, startIdx, endIdx, toleranceMeters, keep, work);
  }

  const result: RoutePoint[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) {
      result.push(points[i]!);
      indices.push(i);
    }
  }
  return { points: result, indices };
}

/**
 * Samples points along a polyline at regular distance intervals (e.g. 25 meters),
 * ensuring that long straight segments have intermediate sample points for deviation assessment.
 */
export function samplePolyline(points: RoutePoint[], stepMeters = 25, maxPoints = 10_000): RoutePoint[] {
  if (points.length <= 1) return [...points];

  if (!Number.isInteger(maxPoints) || maxPoints < 2) throw new Error("maxPoints must be an integer of at least 2.");
  const totalDistance = polylineDistance(points);
  const effectiveStepMeters = Math.max(stepMeters, totalDistance / (maxPoints - 1));

  const sampled: RoutePoint[] = [points[0]!];
  let accumulatedAlongSegment = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const segLen = haversineDistance(a, b);
    if (segLen === 0) continue;

    let d = effectiveStepMeters - accumulatedAlongSegment;
    while (d < segLen) {
      const frac = d / segLen;
      sampled.push({
        latitude: a.latitude + (b.latitude - a.latitude) * frac,
        longitude: a.longitude + (b.longitude - a.longitude) * frac,
        ...(a.elevationMeters !== undefined && b.elevationMeters !== undefined
          ? { elevationMeters: a.elevationMeters + (b.elevationMeters - a.elevationMeters) * frac }
          : {}),
      });
      d += effectiveStepMeters;
    }
    accumulatedAlongSegment = segLen - (d - effectiveStepMeters);
    sampled.push(b);
  }

  return sampled;
}

export type DeviationAssessmentResult = {
  deviations: DeviationFacts;
  sourceCoverageIntervals: Array<{ startDistanceMeters: number; endDistanceMeters: number; startPointIndex: number; endPointIndex: number }>;
  reversed: boolean;
  sampledDistancesMeters: number[];
  highDeviationLocations: Array<{
    coordinate: Coordinate;
    distanceMeters: number;
    direction: "source_to_matched" | "matched_to_source";
  }>;
};

/** Edge interpolation spacing is 5m; distance to a polyline is 1-Lipschitz, so
 * nearest-sample max deviation can underestimate the continuous maximum by at
 * most half that spacing (2.5m). All supplied vertices are always sampled. */
export const GEOMETRY_SAMPLE_SPACING_METERS = 5;
export const GEOMETRY_SAMPLE_ERROR_BUDGET_METERS = GEOMETRY_SAMPLE_SPACING_METERS / 2;

export class GeometryWorkLimitError extends Error {
  constructor(message = "Geometry comparison exceeded its bounded spatial-index work budget. Reduce the trace size or raise the configured processing limit.") { super(message); }
}

type IndexedEdge = { a: Coordinate; b: Coordinate; ax: number; ay: number; bx: number; by: number; minX: number; maxX: number; minY: number; maxY: number; length: number; start: number; pointIndex: number };
type EdgeNode = { minX: number; maxX: number; minY: number; maxY: number; left?: EdgeNode; right?: EdgeNode; edges?: IndexedEdge[] };

/** BVH of real polyline edges; segment gaps are never represented as edges. */
export class PolylineEdgeIndex {
  private readonly root?: EdgeNode;
  private readonly scaleX: number;
  private readonly refLon: number;
  private readonly refLat: number;
  readonly totalLength: number;
  private visited = 0;

  constructor(lines: Coordinate[][], private readonly operationLimit = 50_000_000) {
    const all = lines.flat();
    if (all.length === 0) { this.totalLength = 0; this.scaleX = 111_320; this.refLon = 0; this.refLat = 0; return; }
    this.refLat = all.reduce((s, p) => s + p.latitude, 0) / all.length;
    this.refLon = all[0]!.longitude;
    const maxAbsLat = all.reduce((m, p) => Math.max(m, Math.abs(p.latitude)), 0);
    this.scaleX = 111_320 * Math.max(0.01, Math.cos(maxAbsLat * TO_RAD));
    const edges: IndexedEdge[] = [];
    let progress = 0;
    for (const line of lines) for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!, b = line[i + 1]!;
      const [ax, ay] = this.project(a), [bx, by] = this.project(b);
      const length = haversineDistance(a, b);
      edges.push({ a, b, ax, ay, bx, by, minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minY: Math.min(ay, by), maxY: Math.max(ay, by), length, start: progress, pointIndex: i });
      progress += length;
    }
    this.totalLength = progress;
    if (edges.length) this.root = buildEdgeNode(edges);
  }

  nearest(point: Coordinate, minProgress = 0, maxProgress = Infinity): { distanceMeters: number; progressMeters: number; edge: IndexedEdge; fraction: number } | undefined {
    if (!this.root) return undefined;
    const [x, y] = this.project(point);
    let best = Infinity;
    let result: { distanceMeters: number; progressMeters: number; edge: IndexedEdge; fraction: number } | undefined;
    const visit = (node: EdgeNode) => {
      if (++this.visited > this.operationLimit) throw new GeometryWorkLimitError();
      if (boxDistance(x, y, node) > best) return;
      if (node.edges) {
        for (const e of node.edges) {
          if (++this.visited > this.operationLimit) throw new GeometryWorkLimitError();
          if (e.start + e.length < minProgress || e.start > maxProgress) continue;
          const dx = e.bx - e.ax, dy = e.by - e.ay;
          const l2 = dx * dx + dy * dy;
          const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - e.ax) * dx + (y - e.ay) * dy) / l2));
          const d = Math.hypot(x - (e.ax + t * dx), y - (e.ay + t * dy));
          if (d < best) { best = d; result = { distanceMeters: d, progressMeters: e.start + e.length * t, edge: e, fraction: t }; }
        }
      } else {
        const leftD = node.left ? boxDistance(x, y, node.left) : Infinity;
        const rightD = node.right ? boxDistance(x, y, node.right) : Infinity;
        if (leftD <= rightD) { if (node.left) visit(node.left); if (node.right) visit(node.right); }
        else { if (node.right) visit(node.right); if (node.left) visit(node.left); }
      }
    };
    visit(this.root);
    return result;
  }

  private project(point: Coordinate): [number, number] {
    let deltaLon = ((point.longitude - this.refLon + 540) % 360) - 180;
    return [deltaLon * this.scaleX, (point.latitude - this.refLat) * 111_320];
  }
}

function boxDistance(x: number, y: number, n: EdgeNode): number {
  const dx = x < n.minX ? n.minX - x : x > n.maxX ? x - n.maxX : 0;
  const dy = y < n.minY ? n.minY - y : y > n.maxY ? y - n.maxY : 0;
  return Math.hypot(dx, dy);
}

function buildEdgeNode(edges: IndexedEdge[]): EdgeNode {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const e of edges) { minX = Math.min(minX, e.minX); maxX = Math.max(maxX, e.maxX); minY = Math.min(minY, e.minY); maxY = Math.max(maxY, e.maxY); }
  if (edges.length <= 12) return { minX, maxX, minY, maxY, edges };
  const splitX = maxX - minX >= maxY - minY;
  edges.sort((a, b) => splitX ? (a.minX + a.maxX) - (b.minX + b.maxX) : (a.minY + a.maxY) - (b.minY + b.maxY));
  const mid = edges.length >>> 1;
  return { minX, maxX, minY, maxY, left: buildEdgeNode(edges.slice(0, mid)), right: buildEdgeNode(edges.slice(mid)) };
}

/**
 * Assesses geometry fidelity in BOTH directions:
 * 1. Source -> Matched (checks whether any recorded trace points were missed or cut off)
 * 2. Matched -> Source (checks whether the matched route took unrecorded detours or wrong parallel roads)
 */
export function assessBidirectionalDeviations(
  sourcePoints: RoutePoint[],
  matchedSegments: RoutePoint[][],
  warningThresholdMeters = 25,
): DeviationAssessmentResult {
  const highDeviationLocations: Array<{
    coordinate: Coordinate;
    distanceMeters: number;
    direction: "source_to_matched" | "matched_to_source";
  }> = [];

  if (sourcePoints.length === 0 || matchedSegments.length === 0) {
    return {
      deviations: {
        maxDeviationMeters: 0,
        p50DeviationMeters: 0,
        p95DeviationMeters: 0,
        sourceToMatchedMaxMeters: 0,
        matchedToSourceMaxMeters: 0,
        samplingErrorBudgetMeters: GEOMETRY_SAMPLE_ERROR_BUDGET_METERS,
      },
      sourceCoverageIntervals: [],
      reversed: false,
      sampledDistancesMeters: [],
      highDeviationLocations,
    };
  }

  const sourceSamples = sampleMeasuredPolyline(sourcePoints);
  const matchedSamples = matchedSegments.flatMap((s) => sampleMeasuredPolyline(s));
  if (sourceSamples.length + matchedSamples.length > 1_000_000) throw new GeometryWorkLimitError("Geometry comparison needs more than 1,000,000 bounded samples. Prepare a smaller trace or reduce interpolation detail; no route was marked ready.");
  const matchedIndex = new PolylineEdgeIndex(matchedSegments);
  const sourceIndex = new PolylineEdgeIndex([sourcePoints]);
  let previousMatchedProgress = 0;
  const forwardDeviations: number[] = [];
  for (const sample of sourceSamples) {
    const expected = sourceIndex.totalLength > 0 ? sample.progress / sourceIndex.totalLength * matchedIndex.totalLength : 0;
    const window = Math.max(50, matchedIndex.totalLength * 0.02);
    const hit = matchedIndex.nearest(sample.point, Math.max(previousMatchedProgress - 10, expected - window), Math.min(matchedIndex.totalLength, expected + window));
    const actual = hit ?? matchedIndex.nearest(sample.point);
    const d = actual?.distanceMeters ?? 0;
    if (hit) previousMatchedProgress = Math.max(previousMatchedProgress, hit.progressMeters);
    forwardDeviations.push(d);
    if (d >= warningThresholdMeters) highDeviationLocations.push({ coordinate: sample.point, distanceMeters: d, direction: "source_to_matched" });
  }
  let previousSourceProgress = 0;
  const reverseDeviations: number[] = [];
  const totalMatchedLength = matchedIndex.totalLength;
  let matchedProgressBase = 0;
  for (const segment of matchedSegments) {
    const local = sampleMeasuredPolyline(segment);
    const segLength = polylineDistance(segment);
    for (const sample of local) {
      const fraction = totalMatchedLength > 0 ? (matchedProgressBase + sample.progress) / totalMatchedLength : 0;
      const expected = fraction * sourceIndex.totalLength;
      const window = Math.max(50, sourceIndex.totalLength * 0.02);
      const hit = sourceIndex.nearest(sample.point, Math.max(previousSourceProgress - 10, expected - window), Math.min(sourceIndex.totalLength, expected + window));
      const actual = hit ?? sourceIndex.nearest(sample.point);
      const d = actual?.distanceMeters ?? 0;
      if (hit) previousSourceProgress = Math.max(previousSourceProgress, hit.progressMeters);
      reverseDeviations.push(d);
      if (d >= warningThresholdMeters) highDeviationLocations.push({ coordinate: sample.point, distanceMeters: d, direction: "matched_to_source" });
    }
    matchedProgressBase += segLength;
  }

  const sourceToMatchedMax = forwardDeviations.reduce((m, v) => Math.max(m, v), 0);
  const matchedToSourceMax = reverseDeviations.reduce((m, v) => Math.max(m, v), 0);
  const forwardDeviationsFinite = forwardDeviations.filter(Number.isFinite);
  const reverseDeviationsFinite = reverseDeviations.filter(Number.isFinite);
  const allDeviations = [...forwardDeviationsFinite, ...reverseDeviationsFinite].sort((a, b) => a - b);

  const maxDeviation = Math.max(sourceToMatchedMax, matchedToSourceMax);

  const sourceCoverageIntervals: DeviationAssessmentResult["sourceCoverageIntervals"] = [];
  for (let i = 1; i < sourceSamples.length; i++) {
    const a = sourceSamples[i - 1]!;
    const b = sourceSamples[i]!;
    const da = forwardDeviations[i - 1]!;
    const db = forwardDeviations[i]!;
    if (da > warningThresholdMeters || db > warningThresholdMeters) continue;
    const last = sourceCoverageIntervals.at(-1);
    if (last && Math.abs(last.endDistanceMeters - a.progress) < 0.01) {
      last.endDistanceMeters = b.progress;
      last.endPointIndex = Math.max(last.endPointIndex, b.sourcePointIndex + (b.distanceAlongEdge > 0 ? 1 : 0));
    } else sourceCoverageIntervals.push({
      startDistanceMeters: a.progress,
      endDistanceMeters: b.progress,
      startPointIndex: a.sourcePointIndex,
      endPointIndex: Math.min(sourcePoints.length - 1, b.sourcePointIndex + (b.distanceAlongEdge > 0 ? 1 : 0)),
    });
  }

  let unorderedMax = 0;
  for (const sample of sourceSamples) unorderedMax = Math.max(unorderedMax, matchedIndex.nearest(sample.point)?.distanceMeters ?? Infinity);
  for (const sample of matchedSamples) unorderedMax = Math.max(unorderedMax, sourceIndex.nearest(sample.point)?.distanceMeters ?? Infinity);
  const reversed = unorderedMax <= warningThresholdMeters && Math.max(sourceToMatchedMax, matchedToSourceMax) > warningThresholdMeters;

  const p50 = percentile(allDeviations, 0.5);
  const p95 = percentile(allDeviations, 0.95);

  return {
    deviations: {
      maxDeviationMeters: Math.round(maxDeviation * 10) / 10,
      p50DeviationMeters: Math.round(p50 * 10) / 10,
      p95DeviationMeters: Math.round(p95 * 10) / 10,
      sourceToMatchedMaxMeters: Math.round(sourceToMatchedMax * 10) / 10,
      matchedToSourceMaxMeters: Math.round(matchedToSourceMax * 10) / 10,
      samplingErrorBudgetMeters: GEOMETRY_SAMPLE_ERROR_BUDGET_METERS,
    },
    sourceCoverageIntervals,
    reversed,
    sampledDistancesMeters: allDeviations,
    highDeviationLocations,
  };
}

type MeasuredSample = { point: Coordinate; progress: number; sourcePointIndex: number; distanceAlongEdge: number };
function sampleMeasuredPolyline(points: RoutePoint[], spacingMeters = GEOMETRY_SAMPLE_SPACING_METERS): MeasuredSample[] {
  const total = polylineDistance(points);
  const needed = points.length + Math.ceil(total / spacingMeters);
  if (needed > 1_000_000) throw new GeometryWorkLimitError("Geometry comparison needs more than 1,000,000 bounded samples. Prepare a smaller trace; no route was marked ready.");
  const result: MeasuredSample[] = [];
  let progress = 0;
  let next = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    result.push({ point: p, progress, sourcePointIndex: i, distanceAlongEdge: 0 });
    if (i === points.length - 1) break;
    const q = points[i + 1]!;
    const edge = haversineDistance(p, q);
    const end = progress + edge;
    while (next < end) {
      const d = next - progress;
      if (d > 0.01 && d < edge - 0.01) result.push({ point: interpolate(p, q, d / edge), progress: next, sourcePointIndex: i, distanceAlongEdge: d });
      next += spacingMeters;
    }
    progress = end;
  }
  return result;
}

function interpolate(a: Coordinate, b: Coordinate, t: number): Coordinate {
  let deltaLon = ((b.longitude - a.longitude + 540) % 360) - 180;
  let lon = a.longitude + deltaLon * t;
  lon = ((lon + 540) % 360) - 180;
  return { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: lon };
}

function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) return 0;
  const index = Math.min(
    sortedArray.length - 1,
    Math.max(0, Math.floor(p * sortedArray.length)),
  );
  return sortedArray[index] ?? 0;
}
