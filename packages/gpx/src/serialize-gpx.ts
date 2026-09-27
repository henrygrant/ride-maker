import type {
  ControlPoint,
  RouteDocument,
  RoutePoint,
  RouteWaypoint,
} from "@ride-maker/domain";
import { XMLBuilder } from "fast-xml-parser";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  suppressEmptyNode: true,
});

export function serializeGpx(document: RouteDocument): string {
  const gpx = {
    "@_xmlns": "http://www.topografix.com/GPX/1/1",
    "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "@_xsi:schemaLocation":
      "http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd",
    "@_version": "1.1",
    "@_creator": "Ride Maker",
    metadata: {
      name: document.name,
      ...(document.description === undefined
        ? {}
        : { desc: document.description }),
    },
    ...(document.waypoints.length === 0
      ? {}
      : { wpt: document.waypoints.map(buildWaypoint) }),
    ...(document.controlPoints.length === 0
      ? {}
      : {
          rte: {
            name: document.name,
            rtept: document.controlPoints.map(buildControlPoint),
          },
        }),
    trk: {
      name: document.name,
      ...(document.description === undefined
        ? {}
        : { desc: document.description }),
      trkseg: document.segments.map((segment) => ({
        trkpt: segment.points.map(buildTrackPoint),
      })),
    },
  };

  const xml = builder.build({ gpx });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

function buildTrackPoint(point: RoutePoint): Record<string, unknown> {
  return {
    "@_lat": point.latitude,
    "@_lon": point.longitude,
    ...(point.elevationMeters === undefined
      ? {}
      : { ele: point.elevationMeters }),
    ...(point.time === undefined ? {} : { time: point.time }),
  };
}

function buildControlPoint(point: ControlPoint): Record<string, unknown> {
  return {
    "@_lat": point.latitude,
    "@_lon": point.longitude,
    ...(point.elevationMeters === undefined
      ? {}
      : { ele: point.elevationMeters }),
    ...(point.name === undefined ? {} : { name: point.name }),
  };
}

function buildWaypoint(point: RouteWaypoint): Record<string, unknown> {
  return {
    "@_lat": point.latitude,
    "@_lon": point.longitude,
    ...(point.elevationMeters === undefined
      ? {}
      : { ele: point.elevationMeters }),
    ...(point.name === undefined ? {} : { name: point.name }),
    ...(point.description === undefined ? {} : { desc: point.description }),
  };
}
