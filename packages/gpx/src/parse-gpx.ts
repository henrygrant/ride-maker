import {
  ROUTE_DOCUMENT_SCHEMA_VERSION,
  createId,
  type ControlPoint,
  type RouteDocument,
  type RoutePoint,
  type RouteSegment,
  type RouteWaypoint,
} from "@ride-maker/domain";
import { XMLParser, XMLValidator } from "fast-xml-parser";

type XmlNode = Record<string, unknown>;

export const MAX_GEOMETRY_POINTS = 100_000;
export const MAX_GPX_BYTES = 10 * 1024 * 1024; // 10 MiB

export type ParseGpxOptions = {
  filename?: string | undefined;
  maxPoints?: number | undefined;
};

export class GpxParseError extends Error {
  override readonly name = "GpxParseError";
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

export function parseGpx(
  xml: string,
  options: ParseGpxOptions = {},
): RouteDocument {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new GpxParseError("DTD and entity declarations are not permitted.");
  }

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new GpxParseError(`Invalid XML: ${validation.err.msg}`);
  }

  const parsed = parser.parse(xml) as XmlNode;
  const gpx = asNode(parsed.gpx);
  if (gpx === undefined) {
    throw new GpxParseError("The file does not contain a GPX document.");
  }

  const tracks = asArray(gpx.trk).map(asRequiredNode);
  const routes = asArray(gpx.rte).map(asRequiredNode);
  const trackSegments = parseTrackSegments(tracks);
  const routeSegments = parseRouteSegments(routes);
  const segments = trackSegments.length > 0 ? trackSegments : routeSegments;

  const routePoints = routes.flatMap((route) =>
    asArray(route.rtept).map(asRequiredNode),
  );

  if (segments.length === 0 || segments.every((segment) => segment.points.length === 0)) {
    throw new GpxParseError("The GPX file does not contain a track or route.");
  }

  const maxPoints = options.maxPoints ?? MAX_GEOMETRY_POINTS;
  const totalPoints = segments.reduce((sum, s) => sum + s.points.length, 0);
  if (totalPoints > maxPoints) {
    throw new GpxParseError(`Route exceeds the maximum limit of ${maxPoints.toLocaleString()} points.`);
  }

  const hasUsableSegment = segments.some((segment) => {
    if (segment.points.length < 2) return false;
    const first = segment.points[0]!;
    return segment.points.some(
      (p) => p.latitude !== first.latitude || p.longitude !== first.longitude,
    );
  });
  if (!hasUsableSegment) {
    throw new GpxParseError("The GPX file does not contain usable geometry (requires at least two distinct points).");
  }

  const metadata = asNode(gpx.metadata);
  const filenameName = stripGpxExtension(options.filename);
  const name =
    readText(metadata?.name) ??
    (trackSegments.length > 0
      ? tracks.map((track) => readText(track.name)).find(isDefined)
      : routes.map((route) => readText(route.name)).find(isDefined)) ??
    (trackSegments.length > 0
      ? routes.map((route) => readText(route.name)).find(isDefined)
      : tracks.map((track) => readText(track.name)).find(isDefined)) ??
    filenameName ??
    "Imported route";
  const description =
    readText(metadata?.desc) ??
    (trackSegments.length > 0
      ? tracks.map((track) => readText(track.desc)).find(isDefined)
      : routes.map((route) => readText(route.desc)).find(isDefined)) ??
    (trackSegments.length > 0
      ? routes.map((route) => readText(route.desc)).find(isDefined)
      : tracks.map((track) => readText(track.desc)).find(isDefined));

  // Policy: if route points exist, they provide the control points (turn points / waypoints)
  // regardless of whether track segments provide the high-resolution line geometry,
  // preserving existing mixed GPX support. Otherwise infer endpoints from segments.
  const controlPoints =
    routePoints.length > 0
      ? parseControlPoints(routePoints)
      : inferEndpointControls(segments);
  const waypoints = asArray(gpx.wpt)
    .map(asRequiredNode)
    .map(parseWaypoint);
  const creator = readText(gpx["@_creator"]);

  return {
    schemaVersion: ROUTE_DOCUMENT_SCHEMA_VERSION,
    id: createId("route"),
    name,
    ...(description === undefined ? {} : { description }),
    source: {
      kind: "gpx",
      ...(options.filename === undefined ? {} : { filename: options.filename }),
      ...(creator === undefined ? {} : { creator }),
    },
    segments,
    controlPoints,
    waypoints,
    maneuvers: [],
  };
}

function parseTrackSegments(tracks: XmlNode[]): RouteSegment[] {
  return tracks.flatMap((track) => {
    const rawSegments = asArray(track.trkseg);
    return rawSegments.flatMap((rawSegment) => {
      const segment = asNode(rawSegment);
      if (segment === undefined) return [];
      const rawPoints = asArray(segment.trkpt);
      const points: RoutePoint[] = [];
      for (const p of rawPoints) {
        const pNode = asNode(p);
        if (pNode !== undefined) points.push(parsePoint(pNode));
      }
      if (points.length === 0) return [];
      return [{
        id: createId("segment"),
        points,
      }];
    });
  });
}

function parseRouteSegments(routes: XmlNode[]): RouteSegment[] {
  return routes.flatMap((route) => {
    const rawPoints = asArray(route.rtept);
    const points: RoutePoint[] = [];
    for (const p of rawPoints) {
      const pNode = asNode(p);
      if (pNode !== undefined) points.push(parsePoint(pNode));
    }
    if (points.length === 0) return [];
    return [{
      id: createId("segment"),
      points,
    }];
  });
}

function parseControlPoints(points: XmlNode[]): ControlPoint[] {
  return points.map((point, index) => {
    const parsed = parsePoint(point);
    const name = readText(point.name);
    const kind =
      index === 0 ? "start" : index === points.length - 1 ? "finish" : "via";

    return {
      id: createId("control"),
      kind,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      ...(name === undefined ? {} : { name }),
      ...(parsed.elevationMeters === undefined
        ? {}
        : { elevationMeters: parsed.elevationMeters }),
    };
  });
}

function inferEndpointControls(segments: RouteSegment[]): ControlPoint[] {
  const populated = segments.filter((segment) => segment.points.length > 0);
  const first = populated[0]?.points[0];
  const lastSegment = populated.at(-1);
  const last = lastSegment?.points.at(-1);

  if (first === undefined || last === undefined) {
    return [];
  }

  return [
    {
      id: createId("control"),
      kind: "start",
      latitude: first.latitude,
      longitude: first.longitude,
      ...(first.elevationMeters === undefined
        ? {}
        : { elevationMeters: first.elevationMeters }),
    },
    {
      id: createId("control"),
      kind: "finish",
      latitude: last.latitude,
      longitude: last.longitude,
      ...(last.elevationMeters === undefined
        ? {}
        : { elevationMeters: last.elevationMeters }),
    },
  ];
}

function parseWaypoint(point: XmlNode): RouteWaypoint {
  const parsed = parsePoint(point);
  const name = readText(point.name);
  const description = readText(point.desc);

  return {
    id: createId("waypoint"),
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(parsed.elevationMeters === undefined
      ? {}
      : { elevationMeters: parsed.elevationMeters }),
  };
}

function parsePoint(point: XmlNode): RoutePoint {
  const latitude = readCoordinate(point["@_lat"], "latitude", -90, 90);
  const longitude = readCoordinate(point["@_lon"], "longitude", -180, 180);
  const elevationMeters = readOptionalNumber(point.ele, "elevation");
  const time = readText(point.time);

  return {
    latitude,
    longitude,
    ...(elevationMeters === undefined ? {} : { elevationMeters }),
    ...(time === undefined ? {} : { time }),
  };
}

function readCoordinate(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    typeof value === "boolean"
  ) {
    throw new GpxParseError(`Missing or blank ${label} value`);
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new GpxParseError(`Invalid ${label} value: ${String(value)}`);
  }
  return number;
}

function readOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new GpxParseError(`Invalid ${label} value: ${String(value)}`);
  }
  return number;
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const text = String(value).trim();
  return text.length === 0 ? undefined : text;
}

function stripGpxExtension(filename: string | undefined): string | undefined {
  if (filename === undefined) return undefined;
  const stripped = filename.replace(/\.gpx$/iu, "").trim();
  return stripped.length === 0 ? undefined : stripped;
}

function asNode(value: unknown): XmlNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as XmlNode)
    : undefined;
}

function asRequiredNode(value: unknown): XmlNode {
  const node = asNode(value);
  if (node === undefined) {
    throw new GpxParseError("The GPX file contains an invalid element.");
  }
  return node;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * Calculates geodesic distance between two WGS84 coordinates in meters
 * using the Haversine formula on a sphere of mean radius 6,371,000 meters.
 * Correctly accounts for antimeridian crossing by normalizing longitude delta to [-180, 180] deg.
 */
export function distanceBetweenCoordinates(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const phi1 = a.latitude * toRad;
  const phi2 = b.latitude * toRad;
  const deltaPhi = (b.latitude - a.latitude) * toRad;

  let deltaLonDeg = ((b.longitude - a.longitude) % 360);
  if (deltaLonDeg > 180) deltaLonDeg -= 360;
  if (deltaLonDeg < -180) deltaLonDeg += 360;
  const deltaLambda = deltaLonDeg * toRad;

  const sinHalfDeltaPhi = Math.sin(deltaPhi / 2);
  const sinHalfDeltaLambda = Math.sin(deltaLambda / 2);
  const h =
    sinHalfDeltaPhi * sinHalfDeltaPhi +
    Math.cos(phi1) * Math.cos(phi2) * sinHalfDeltaLambda * sinHalfDeltaLambda;
  const clampedH = Math.min(1, Math.max(0, h));
  return 2 * R * Math.asin(Math.sqrt(clampedH));
}

/**
 * Sums consecutive points within each segment strictly.
 * Gaps between distinct segments are not included in distance.
 */
export function calculateRouteDistanceMeters(document: RouteDocument): number {
  let total = 0;
  for (const segment of document.segments) {
    for (let i = 0; i < segment.points.length - 1; i++) {
      total += distanceBetweenCoordinates(segment.points[i]!, segment.points[i + 1]!);
    }
  }
  return total;
}
