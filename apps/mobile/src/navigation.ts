import type { Coordinate, Maneuver, RouteDocument } from "@ride-maker/domain";

type TrackPoint = Coordinate & { distanceMeters: number };
type TrackEdge = { start: TrackPoint; end: TrackPoint };
export type TrackManeuver = { maneuver: Maneuver; distanceMeters: number };
export type NavigationTrack = {
  edges: TrackEdge[];
  maneuvers: TrackManeuver[];
  lengthMeters: number;
};
export type NavigationFix = {
  progressMeters: number;
  offRouteMeters: number;
  remainingMeters: number;
  next: TrackManeuver | null;
  distanceToNextMeters: number | null;
  arrived: boolean;
};

const METERS_PER_LATITUDE = 111_132;

export function buildNavigationTrack(document: RouteDocument): NavigationTrack | null {
  const edges: TrackEdge[] = [];
  const positions: TrackPoint[][] = [];
  let lengthMeters = 0;
  for (const segment of document.segments) {
    const points: TrackPoint[] = [];
    for (const point of segment.points) {
      const previous = points.at(-1);
      if (previous) lengthMeters += distanceMeters(previous, point);
      const next = { latitude: point.latitude, longitude: point.longitude, distanceMeters: lengthMeters };
      if (previous && next.distanceMeters > previous.distanceMeters) edges.push({ start: previous, end: next });
      points.push(next);
    }
    positions.push(points);
  }
  if (edges.length === 0) return null;
  const maneuvers = document.maneuvers.flatMap((maneuver) => {
    const point = positions[maneuver.segmentIndex]?.[maneuver.shapeIndex];
    return point && maneuver.instruction.trim()
      ? [{ maneuver, distanceMeters: point.distanceMeters }]
      : [];
  }).sort((a, b) => a.distanceMeters - b.distanceMeters);
  return { edges, maneuvers, lengthMeters };
}

export function navigationFix(track: NavigationTrack, location: Coordinate, previousProgressMeters = 0): NavigationFix {
  let bestDistance = Infinity;
  let bestScore = Infinity;
  let progressMeters = previousProgressMeters;
  for (const edge of track.edges) {
    const scale = Math.cos(location.latitude * Math.PI / 180) * 111_320;
    const ax = (edge.start.longitude - location.longitude) * scale;
    const ay = (edge.start.latitude - location.latitude) * METERS_PER_LATITUDE;
    const bx = (edge.end.longitude - location.longitude) * scale;
    const by = (edge.end.latitude - location.latitude) * METERS_PER_LATITUDE;
    const dx = bx - ax;
    const dy = by - ay;
    const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
    const offRouteMeters = Math.hypot(ax + fraction * dx, ay + fraction * dy);
    const candidateProgress = edge.start.distanceMeters + fraction * (edge.end.distanceMeters - edge.start.distanceMeters);
    const backwardPenalty = Math.max(0, previousProgressMeters - candidateProgress - 20) * 0.5;
    const jumpPenalty = Math.max(0, candidateProgress - previousProgressMeters - 500) * 0.1;
    const score = offRouteMeters + backwardPenalty + jumpPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestDistance = offRouteMeters;
      progressMeters = candidateProgress;
    }
  }
  progressMeters = Math.max(previousProgressMeters, progressMeters);
  const remainingMeters = Math.max(0, track.lengthMeters - progressMeters);
  const next = track.maneuvers.find((item) => item.distanceMeters + 10 > progressMeters) ?? null;
  return {
    progressMeters,
    offRouteMeters: bestDistance,
    remainingMeters,
    next,
    distanceToNextMeters: next ? Math.max(0, next.distanceMeters - progressMeters) : null,
    arrived: remainingMeters <= 20 && bestDistance <= 30,
  };
}

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const latitude = (a.latitude + b.latitude) / 2 * Math.PI / 180;
  const dx = (b.longitude - a.longitude) * Math.cos(latitude) * 111_320;
  const dy = (b.latitude - a.latitude) * METERS_PER_LATITUDE;
  return Math.hypot(dx, dy);
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
