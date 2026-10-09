import type { RouteDocument } from "@ride-maker/domain";

export function routeIdFromLink(value: string): string | null {
  const input = value.trim();
  if (/^[a-z0-9]{15}$/u.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol === "ridemaker:") {
      const parts = [url.hostname, ...url.pathname.split("/").filter(Boolean)];
      const id = parts[0] === "route" ? parts[1] : null;
      return id && /^[a-z0-9]{15}$/u.test(id) ? id : null;
    }
    if (url.hostname === "ridemaker.thg3.net" && (url.protocol === "https:" || url.protocol === "http:")) {
      const id = url.searchParams.get("route");
      return id && /^[a-z0-9]{15}$/u.test(id) ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function routeGeometry(document: RouteDocument): {
  shape: GeoJSON.Feature<GeoJSON.MultiLineString>;
  bounds: [number, number, number, number] | null;
} {
  const lines = document.segments
    .map((segment) => segment.points.map((point) => [point.longitude, point.latitude] as [number, number]))
    .filter((points) => points.length >= 2);
  let bounds: [number, number, number, number] | null = null;
  for (const line of lines) {
    for (const [longitude, latitude] of line) {
      bounds = bounds === null
        ? [longitude, latitude, longitude, latitude]
        : [Math.min(bounds[0], longitude), Math.min(bounds[1], latitude), Math.max(bounds[2], longitude), Math.max(bounds[3], latitude)];
    }
  }
  return {
    shape: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } },
    bounds,
  };
}
