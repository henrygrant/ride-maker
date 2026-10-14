import { describe, expect, it } from "vitest";
import { createRouteDocument, type RouteDocument } from "@ride-maker/domain";
import { validateRouteInstructions } from "../storage/local-route-storage";
import { routeGeometry } from "../route-view";

describe("Task006 Screenflow and Route Geometry Contracts", () => {
  const sampleRoadDocument: RouteDocument = {
    ...createRouteDocument({ id: "route-road-test-1", name: "Central Park Loop" }),
    segments: [
      {
        id: "seg-1",
        points: [
          { latitude: 40.782, longitude: -73.967 },
          { latitude: 40.785, longitude: -73.965 },
          { latitude: 40.790, longitude: -73.960 },
        ],
      },
    ],
    maneuvers: [
      {
        id: "maneuver-1",
        instruction: "Turn right onto East Drive",
        segmentIndex: 0,
        shapeIndex: 1,
        latitude: 40.785,
        longitude: -73.965,
      },
    ],
    summary: {
      distanceMeters: 2500,
      durationSeconds: 600,
    },
  };

  const sampleRawGpxDocument: RouteDocument = {
    ...createRouteDocument({ id: "route-gpx-test-1", name: "Hudson River Greenway Raw Track" }),
    segments: [
      {
        id: "seg-gpx-1",
        points: [
          { latitude: 40.712, longitude: -74.015 },
          { latitude: 40.720, longitude: -74.012 },
          { latitude: 40.730, longitude: -74.010 },
        ],
      },
    ],
    maneuvers: [], // No turn instructions from raw GPX
    summary: {
      distanceMeters: 4200,
      durationSeconds: 900,
    },
  };

  it("validates instructions readiness accurately", () => {
    const roadValidation = validateRouteInstructions(sampleRoadDocument);
    expect(roadValidation.ready).toBe(true);

    const gpxValidation = validateRouteInstructions(sampleRawGpxDocument);
    expect(gpxValidation.ready).toBe(false);
    expect(gpxValidation.reason).toBe("No turn maneuvers saved with route");
  });

  it("preserves MultiLineString segments without bridging gaps", () => {
    const multiSegmentDoc: RouteDocument = {
      ...sampleRoadDocument,
      segments: [
        {
          id: "seg-multi-1",
          points: [
            { latitude: 40.78, longitude: -73.96 },
            { latitude: 40.79, longitude: -73.95 },
          ],
        },
        {
          id: "seg-multi-2",
          points: [
            { latitude: 40.82, longitude: -73.92 },
            { latitude: 40.83, longitude: -73.91 },
          ],
        },
      ],
    };

    const geometry = routeGeometry(multiSegmentDoc);
    expect(geometry.shape.geometry.type).toBe("MultiLineString");
    expect(geometry.shape.geometry.coordinates).toHaveLength(2);
    // Segment 1 ends at [-73.95, 40.79] and Segment 2 starts at [-73.92, 40.82]
    expect(geometry.shape.geometry.coordinates[0]?.[1]).toEqual([-73.95, 40.79]);
    expect(geometry.shape.geometry.coordinates[1]?.[0]).toEqual([-73.92, 40.82]);
  });
});
