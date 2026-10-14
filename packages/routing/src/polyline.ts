import type { RoutePoint } from "@ride-maker/domain";
import { RoutingError } from "./types";

export function decodePolyline6(encoded: string): RoutePoint[] {
  const points: RoutePoint[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const lat = decodeValue(encoded, index);
    index = lat.nextIndex;
    const lon = decodeValue(encoded, index);
    index = lon.nextIndex;
    latitude += lat.value;
    longitude += lon.value;
    points.push({ latitude: latitude / 1_000_000, longitude: longitude / 1_000_000 });
  }
  return points;
}

function decodeValue(encoded: string, startIndex: number) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte: number;
  do {
    if (index >= encoded.length) throw new RoutingError("Invalid route geometry.");
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);
  return { value: result & 1 ? ~(result >> 1) : result >> 1, nextIndex: index };
}

export function encodePolyline6(points: Array<{ latitude: number; longitude: number }>): string {
  let encoded = "";
  let prevLat = 0;
  let prevLon = 0;

  for (const point of points) {
    const lat = Math.round(point.latitude * 1_000_000);
    const lon = Math.round(point.longitude * 1_000_000);
    encoded += encodeValue(lat - prevLat);
    encoded += encodeValue(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return encoded;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let str = "";
  while (v >= 0x20) {
    str += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  str += String.fromCharCode(v + 63);
  return str;
}
