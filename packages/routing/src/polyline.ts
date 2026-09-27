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
