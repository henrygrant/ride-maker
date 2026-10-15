import type { Coordinate } from "@ride-maker/domain";
import type { PreparedEdge } from "./types.js";

const METERS_PER_LATITUDE_DEGREE = 111_132;
const EQUATORIAL_METERS_PER_LONGITUDE_DEGREE = 111_320;
const TO_RADIANS = Math.PI / 180;
const TO_DEGREES = 180 / Math.PI;

export function isValidCoordinate(coord: {
  readonly latitude?: unknown;
  readonly longitude?: unknown;
}): boolean {
  if (
    typeof coord.latitude !== "number" ||
    typeof coord.longitude !== "number" ||
    !Number.isFinite(coord.latitude) ||
    !Number.isFinite(coord.longitude)
  ) {
    return false;
  }
  return (
    coord.latitude >= -90 &&
    coord.latitude <= 90 &&
    coord.longitude >= -180 &&
    coord.longitude <= 180
  );
}

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const midLatRad = ((a.latitude + b.latitude) / 2) * TO_RADIANS;
  const dx =
    (b.longitude - a.longitude) *
    Math.cos(midLatRad) *
    EQUATORIAL_METERS_PER_LONGITUDE_DEGREE;
  const dy = (b.latitude - a.latitude) * METERS_PER_LATITUDE_DEGREE;
  return Math.hypot(dx, dy);
}

export function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const dLon = (to.longitude - from.longitude) * TO_RADIANS;
  const lat1 = from.latitude * TO_RADIANS;
  const lat2 = to.latitude * TO_RADIANS;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  const brng = Math.atan2(y, x) * TO_DEGREES;
  return (brng + 360) % 360;
}

export function headingDifferenceDegrees(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export type EdgeProjectionResult = {
  readonly fraction: number;
  readonly lateralDistanceMeters: number;
  readonly distanceAlongRideMeters: number;
  readonly distanceAlongSegmentMeters: number;
};

export function projectPointOnEdge(
  point: Coordinate,
  edge: PreparedEdge,
): EdgeProjectionResult {
  const latRad = point.latitude * TO_RADIANS;
  const metersPerLon =
    Math.cos(latRad) * EQUATORIAL_METERS_PER_LONGITUDE_DEGREE;

  const ax = (edge.start.longitude - point.longitude) * metersPerLon;
  const ay = (edge.start.latitude - point.latitude) * METERS_PER_LATITUDE_DEGREE;
  const bx = (edge.end.longitude - point.longitude) * metersPerLon;
  const by = (edge.end.latitude - point.latitude) * METERS_PER_LATITUDE_DEGREE;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq <= 0.000001) {
    const lateralDistanceMeters = Math.hypot(ax, ay);
    return {
      fraction: 0,
      lateralDistanceMeters,
      distanceAlongRideMeters: edge.startDistanceMeters,
      distanceAlongSegmentMeters: edge.start.distanceAlongSegmentMeters,
    };
  }

  const t = -(ax * dx + ay * dy) / lenSq;
  const fraction = Math.max(0, Math.min(1, t));
  const cx = ax + fraction * dx;
  const cy = ay + fraction * dy;
  const lateralDistanceMeters = Math.hypot(cx, cy);

  const edgeDistanceOffset = fraction * edge.lengthMeters;

  return {
    fraction,
    lateralDistanceMeters,
    distanceAlongRideMeters: edge.startDistanceMeters + edgeDistanceOffset,
    distanceAlongSegmentMeters:
      edge.start.distanceAlongSegmentMeters + edgeDistanceOffset,
  };
}
