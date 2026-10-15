import type { RouteDocument, RoutePoint } from "@ride-maker/domain";
import { encodePolyline6 } from "../polyline";

/**
 * 1. Normal curved ride fixture:
 * A curved cycling route with two turns (right turn, left turn) along city streets.
 */
export function createCurvedRideDocument(): RouteDocument {
  const points: RoutePoint[] = [
    { latitude: 45.501, longitude: -73.567 },
    { latitude: 45.5015, longitude: -73.567 },
    { latitude: 45.502, longitude: -73.567 },
    { latitude: 45.5025, longitude: -73.567 },
    { latitude: 45.503, longitude: -73.567 },
    { latitude: 45.503, longitude: -73.5665 },
    { latitude: 45.503, longitude: -73.566 },
    { latitude: 45.503, longitude: -73.5655 },
    { latitude: 45.503, longitude: -73.565 },
    { latitude: 45.5035, longitude: -73.565 },
    { latitude: 45.504, longitude: -73.565 },
    { latitude: 45.5045, longitude: -73.565 },
    { latitude: 45.505, longitude: -73.565 },
  ];

  return {
    schemaVersion: 1,
    id: "route-curved-1",
    name: "Curved City Ride",
    source: { kind: "gpx", filename: "curved.gpx" },
    segments: [{ id: "seg-curved", points }],
    controlPoints: [
      { id: "cp-start", kind: "start", latitude: 45.501, longitude: -73.567 },
      { id: "cp-finish", kind: "finish", latitude: 45.505, longitude: -73.565 },
    ],
    waypoints: [],
    maneuvers: [],
  };
}

/**
 * 2. Closed loop ride fixture:
 * Starts and finishes at the exact same coordinate with realistic GPS point density.
 */
export function createClosedLoopDocument(): RouteDocument {
  const points: RoutePoint[] = [
    // Northward leg
    { latitude: 45.500, longitude: -73.570 },
    { latitude: 45.501, longitude: -73.570 },
    { latitude: 45.502, longitude: -73.570 },
    { latitude: 45.503, longitude: -73.570 },
    { latitude: 45.504, longitude: -73.570 },
    // Eastward leg
    { latitude: 45.504, longitude: -73.569 },
    { latitude: 45.504, longitude: -73.568 },
    { latitude: 45.504, longitude: -73.567 },
    { latitude: 45.504, longitude: -73.566 },
    // Southward leg
    { latitude: 45.503, longitude: -73.566 },
    { latitude: 45.502, longitude: -73.566 },
    { latitude: 45.501, longitude: -73.566 },
    { latitude: 45.500, longitude: -73.566 },
    // Westward return leg to start
    { latitude: 45.500, longitude: -73.567 },
    { latitude: 45.500, longitude: -73.568 },
    { latitude: 45.500, longitude: -73.569 },
    { latitude: 45.500, longitude: -73.570 }, // Returns to start!
  ];

  return {
    schemaVersion: 1,
    id: "route-loop-1",
    name: "Mont-Royal Closed Loop",
    source: { kind: "gpx", filename: "loop.gpx" },
    segments: [{ id: "seg-loop", points }],
    controlPoints: [
      { id: "cp-start", kind: "start", latitude: 45.500, longitude: -73.570 },
      { id: "cp-finish", kind: "finish", latitude: 45.500, longitude: -73.570 },
    ],
    waypoints: [],
    maneuvers: [],
  };
}

/**
 * 3. Out-and-back ride fixture:
 * Rides outbound along a road, turns 180 degrees at apex (45.520, -73.580),
 * and rides back along the same road.
 */
export function createOutAndBackDocument(): RouteDocument {
  const points: RoutePoint[] = [
    // Outbound
    { latitude: 45.510, longitude: -73.580 },
    { latitude: 45.512, longitude: -73.580 },
    { latitude: 45.514, longitude: -73.580 },
    { latitude: 45.516, longitude: -73.580 },
    { latitude: 45.518, longitude: -73.580 },
    { latitude: 45.520, longitude: -73.580 }, // Turnaround apex!
    // Inbound
    { latitude: 45.518, longitude: -73.580 },
    { latitude: 45.516, longitude: -73.580 },
    { latitude: 45.514, longitude: -73.580 },
    { latitude: 45.512, longitude: -73.580 },
    { latitude: 45.510, longitude: -73.580 },
  ];

  return {
    schemaVersion: 1,
    id: "route-out-and-back-1",
    name: "Park Avenue Out and Back",
    source: { kind: "gpx", filename: "out-and-back.gpx" },
    segments: [{ id: "seg-oab", points }],
    controlPoints: [
      { id: "cp-start", kind: "start", latitude: 45.510, longitude: -73.580 },
      { id: "cp-finish", kind: "finish", latitude: 45.510, longitude: -73.580 },
    ],
    waypoints: [],
    maneuvers: [],
  };
}

/**
 * 4. Crossing / figure-8 ride fixture:
 * Path crosses itself at (45.502, -73.570) heading in different directions.
 */
export function createCrossingRideDocument(): RouteDocument {
  const points: RoutePoint[] = [
    // Northbound through intersection
    { latitude: 45.500, longitude: -73.570 },
    { latitude: 45.501, longitude: -73.570 },
    { latitude: 45.502, longitude: -73.570 }, // Intersection 1
    { latitude: 45.503, longitude: -73.570 },
    { latitude: 45.504, longitude: -73.570 },
    // Loop around to east
    { latitude: 45.504, longitude: -73.565 },
    { latitude: 45.503, longitude: -73.565 },
    { latitude: 45.502, longitude: -73.565 },
    // Westbound through intersection
    { latitude: 45.502, longitude: -73.568 },
    { latitude: 45.502, longitude: -73.570 }, // Intersection 2 (perpendicular heading!)
    { latitude: 45.502, longitude: -73.572 },
    { latitude: 45.502, longitude: -73.575 },
  ];

  return {
    schemaVersion: 1,
    id: "route-crossing-1",
    name: "Figure-8 Crossing Ride",
    source: { kind: "gpx", filename: "crossing.gpx" },
    segments: [{ id: "seg-crossing", points }],
    controlPoints: [
      { id: "cp-start", kind: "start", latitude: 45.500, longitude: -73.570 },
      { id: "cp-finish", kind: "finish", latitude: 45.502, longitude: -73.575 },
    ],
    waypoints: [],
    maneuvers: [],
  };
}

/**
 * 5. Separate segments and unmatched section fixture:
 * Segment 0: Clean road segment.
 * Segment 1: Off-road/gap segment separated by 1 km from Segment 0.
 */
export function createSeparateSegmentsDocument(): RouteDocument {
  const seg0Points: RoutePoint[] = [
    { latitude: 45.500, longitude: -73.570 },
    { latitude: 45.501, longitude: -73.570 },
    { latitude: 45.502, longitude: -73.570 },
    { latitude: 45.503, longitude: -73.570 },
    { latitude: 45.504, longitude: -73.570 },
  ];

  // 1 km physical gap to seg 1
  const seg1Points: RoutePoint[] = [
    { latitude: 45.515, longitude: -73.560 },
    { latitude: 45.516, longitude: -73.560 },
    { latitude: 45.517, longitude: -73.560 },
    { latitude: 45.518, longitude: -73.560 },
    { latitude: 45.519, longitude: -73.560 },
  ];

  return {
    schemaVersion: 1,
    id: "route-separate-segs-1",
    name: "Multi-segment Ride With Gap",
    source: { kind: "gpx", filename: "multi-segment.gpx" },
    segments: [
      { id: "seg-road", points: seg0Points },
      { id: "seg-trail", points: seg1Points },
    ],
    controlPoints: [
      { id: "cp-start", kind: "start", latitude: 45.500, longitude: -73.570 },
      { id: "cp-finish", kind: "finish", latitude: 45.519, longitude: -73.560 },
    ],
    waypoints: [],
    maneuvers: [],
  };
}

/**
 * 6. Dense long trace fixture:
 * Generates densely spaced points (every ~2 meters) along a curvy path
 * to exercise simplification, chunking, and seam reconciliation.
 */
export function createDenseLongTraceDocument(totalPoints = 1500): RouteDocument {
  const points: RoutePoint[] = [];
  const startLat = 45.500;
  const startLon = -73.570;

  for (let i = 0; i < totalPoints; i++) {
    // 2-meter increments along latitude with sine wave curve
    const latOffset = (i * 0.00003);
    const lonOffset = Math.sin(i / 15) * 0.003;
    points.push({
      latitude: startLat + latOffset,
      longitude: startLon + lonOffset,
      time: new Date(1700000000000 + i * 1000).toISOString(),
    });
  }

  return {
    schemaVersion: 1,
    id: "route-dense-long-1",
    name: "Dense High-Frequency 1Hz Track",
    source: { kind: "gpx", filename: "long-dense.gpx" },
    segments: [{ id: "seg-dense-long", points }],
    controlPoints: [
      { id: "cp-start", kind: "start", latitude: points[0]!.latitude, longitude: points[0]!.longitude },
      { id: "cp-finish", kind: "finish", latitude: points[points.length - 1]!.latitude, longitude: points[points.length - 1]!.longitude },
    ],
    waypoints: [],
    maneuvers: [],
  };
}

/**
 * 7. Sparse route-only fixture:
 * 4 points separated by 2.5 km (total 7.5 km) indicating planned waypoints rather than a track.
 */
export function createSparseRouteDocument(): RouteDocument {
  const points: RoutePoint[] = [
    { latitude: 45.500, longitude: -73.570 },
    { latitude: 45.522, longitude: -73.570 },
    { latitude: 45.544, longitude: -73.570 },
    { latitude: 45.566, longitude: -73.570 },
  ];

  return {
    schemaVersion: 1,
    id: "route-sparse-1",
    name: "Sparse Planned Route",
    source: { kind: "gpx", filename: "sparse.gpx" },
    segments: [{ id: "seg-sparse", points }],
    controlPoints: points.map((p, i) => ({
      id: `cp-${i}`,
      kind: i === 0 ? "start" : i === points.length - 1 ? "finish" : "via",
      latitude: p.latitude,
      longitude: p.longitude,
    })),
    waypoints: [],
    maneuvers: [],
  };
}

/**
 * Creates synthetic Valhalla API response JSON matching Valhalla's /trace_route schema.
 */
export function createSyntheticValhallaResponse(
  points: RoutePoint[],
  options: {
    distanceKm?: number;
    durationSec?: number;
    maneuvers?: Array<{ begin_shape_index: number; instruction: string; verbal?: string }>;
    alternates?: Array<{
      points: RoutePoint[];
      distanceKm?: number;
      durationSec?: number;
      maneuvers?: Array<{ begin_shape_index: number; instruction: string }>;
    }>;
  } = {},
) {
  const shape = encodePolyline6(points);
  const distanceKm = options.distanceKm ?? 1.2;
  const durationSec = options.durationSec ?? 300;

  const defaultManeuvers = options.maneuvers ?? [
    { begin_shape_index: 0, instruction: "Start on Main St", verbal: "Start on Main Street" },
    { begin_shape_index: Math.floor(points.length / 2), instruction: "Turn right onto Oak Ave" },
  ];

  return {
    trip: {
      status: 0,
      status_message: "Found route between points",
      summary: { length: distanceKm, time: durationSec },
      legs: [
        {
          shape,
          summary: { length: distanceKm, time: durationSec },
          maneuvers: defaultManeuvers.map((m) => ({
            begin_shape_index: m.begin_shape_index,
            instruction: m.instruction,
            verbal_pre_transition_instruction: m.verbal,
          })),
        },
      ],
    },
    ...(options.alternates !== undefined
      ? {
          alternates: options.alternates.map((alt) => {
            const altShape = encodePolyline6(alt.points);
            const altDist = alt.distanceKm ?? 0.8;
            const altTime = alt.durationSec ?? 200;
            return {
              trip: {
                status: 0,
                summary: { length: altDist, time: altTime },
                legs: [
                  {
                    shape: altShape,
                    summary: { length: altDist, time: altTime },
                    maneuvers: (alt.maneuvers ?? [
                      { begin_shape_index: 0, instruction: "Continue on Park Rd" },
                    ]).map((m) => ({
                      begin_shape_index: m.begin_shape_index,
                      instruction: m.instruction,
                    })),
                  },
                ],
              },
            };
          }),
        }
      : {}),
  };
}
