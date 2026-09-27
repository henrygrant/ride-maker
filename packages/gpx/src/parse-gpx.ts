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

export type ParseGpxOptions = {
  filename?: string;
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
  const segments = parseTrackSegments(tracks);
  const routePoints = routes.flatMap((route) =>
    asArray(route.rtept).map(asRequiredNode),
  );

  if (segments.length === 0 && routePoints.length > 0) {
    segments.push({
      id: createId("segment"),
      points: routePoints.map(parsePoint),
    });
  }

  if (segments.every((segment) => segment.points.length === 0)) {
    throw new GpxParseError("The GPX file does not contain a track or route.");
  }

  const metadata = asNode(gpx.metadata);
  const filenameName = stripGpxExtension(options.filename);
  const name =
    readText(metadata?.name) ??
    tracks.map((track) => readText(track.name)).find(isDefined) ??
    routes.map((route) => readText(route.name)).find(isDefined) ??
    filenameName ??
    "Imported route";
  const description =
    readText(metadata?.desc) ??
    tracks.map((track) => readText(track.desc)).find(isDefined) ??
    routes.map((route) => readText(route.desc)).find(isDefined);

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
  return tracks.flatMap((track) =>
    asArray(track.trkseg).map((rawSegment) => {
      const segment = asRequiredNode(rawSegment);
      return {
        id: createId("segment"),
        points: asArray(segment.trkpt).map(asRequiredNode).map(parsePoint),
      };
    }),
  );
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
