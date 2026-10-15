import type { Coordinate, RouteDocument } from "@ride-maker/domain";

export function createCleanTurnsRoute(): RouteDocument {
  return {
    schemaVersion: 1,
    id: "route-clean-turns",
    name: "Clean Turns Route",
    source: { kind: "new" },
    controlPoints: [],
    waypoints: [],
    segments: [
      {
        id: "seg-0",
        points: [
          { latitude: 40.0, longitude: -74.0 }, // 0m
          { latitude: 40.0018, longitude: -74.0 }, // ~200m North
          { latitude: 40.0018, longitude: -73.9976 }, // ~200m East (~400m total)
        ],
      },
    ],
    maneuvers: [
      {
        id: "m-start",
        segmentIndex: 0,
        shapeIndex: 0,
        latitude: 40.0,
        longitude: -74.0,
        instruction: "Head north on Main St",
      },
      {
        id: "m-turn",
        segmentIndex: 0,
        shapeIndex: 1,
        latitude: 40.0018,
        longitude: -74.0,
        instruction: "Turn right onto Oak St",
      },
      {
        id: "m-end",
        segmentIndex: 0,
        shapeIndex: 2,
        latitude: 40.0018,
        longitude: -73.9976,
        instruction: "Arrive at destination",
      },
    ],
  };
}

export function createCloseTurnsRoute(): RouteDocument {
  // Turn right at 100m, immediate turn left at 140m (40m apart)
  return {
    schemaVersion: 1,
    id: "route-close-turns",
    name: "Close Turns Route",
    source: { kind: "new" },
    controlPoints: [],
    waypoints: [],
    segments: [
      {
        id: "seg-0",
        points: [
          { latitude: 40.0, longitude: -74.0 }, // 0m
          { latitude: 40.0009, longitude: -74.0 }, // ~100m North
          { latitude: 40.0009, longitude: -73.9995 }, // ~40m East (~140m)
          { latitude: 40.002, longitude: -73.9995 }, // ~120m North (~260m)
        ],
      },
    ],
    maneuvers: [
      {
        id: "m-start",
        segmentIndex: 0,
        shapeIndex: 0,
        latitude: 40.0,
        longitude: -74.0,
        instruction: "Head north",
      },
      {
        id: "m-turn-1",
        segmentIndex: 0,
        shapeIndex: 1,
        latitude: 40.0009,
        longitude: -74.0,
        instruction: "Turn right onto 1st Ave",
      },
      {
        id: "m-turn-2",
        segmentIndex: 0,
        shapeIndex: 2,
        latitude: 40.0009,
        longitude: -73.9995,
        instruction: "Immediate turn left onto Elm St",
      },
      {
        id: "m-end",
        segmentIndex: 0,
        shapeIndex: 3,
        latitude: 40.002,
        longitude: -73.9995,
        instruction: "Arrive at destination",
      },
    ],
  };
}

export function createClosedLoopRoute(): RouteDocument {
  // A square loop starting and ending at exact same coordinate: (40.0, -74.0)
  // 0m: (40.0, -74.0) -> ~200m North
  // 200m: (40.0018, -74.0) -> ~200m East
  // 400m: (40.0018, -73.9976) -> ~200m South
  // 600m: (40.0, -73.9976) -> ~200m West
  // 800m: (40.0, -74.0) (End)
  return {
    schemaVersion: 1,
    id: "route-closed-loop",
    name: "Closed Loop Route",
    source: { kind: "new" },
    controlPoints: [],
    waypoints: [],
    segments: [
      {
        id: "seg-loop",
        points: [
          { latitude: 40.0, longitude: -74.0 }, // 0: start
          { latitude: 40.0018, longitude: -74.0 }, // 1: north
          { latitude: 40.0018, longitude: -73.9976 }, // 2: east
          { latitude: 40.0, longitude: -73.9976 }, // 3: south
          { latitude: 40.0, longitude: -74.0 }, // 4: finish (same as start!)
        ],
      },
    ],
    maneuvers: [
      {
        id: "loop-start",
        segmentIndex: 0,
        shapeIndex: 0,
        latitude: 40.0,
        longitude: -74.0,
        instruction: "Depart start on Loop Rd heading north",
      },
      {
        id: "loop-corner-1",
        segmentIndex: 0,
        shapeIndex: 1,
        latitude: 40.0018,
        longitude: -74.0,
        instruction: "Turn right onto Eastbound Rd",
      },
      {
        id: "loop-corner-2",
        segmentIndex: 0,
        shapeIndex: 2,
        latitude: 40.0018,
        longitude: -73.9976,
        instruction: "Turn right onto Southbound Rd",
      },
      {
        id: "loop-corner-3",
        segmentIndex: 0,
        shapeIndex: 3,
        latitude: 40.0,
        longitude: -73.9976,
        instruction: "Turn right onto Westbound Rd",
      },
      {
        id: "loop-finish",
        segmentIndex: 0,
        shapeIndex: 4,
        latitude: 40.0,
        longitude: -74.0,
        instruction: "Arrive at finish",
      },
    ],
  };
}

export function createOutAndBackRoute(): RouteDocument {
  // Outbound: (40.0, -74.0) -> (40.0, -73.995) (~425m)
  // Inbound: (40.0, -73.995) -> (40.0, -74.0) (~425m)
  // Total ~850m
  return {
    schemaVersion: 1,
    id: "route-out-and-back",
    name: "Out and Back Route",
    source: { kind: "new" },
    controlPoints: [],
    waypoints: [],
    segments: [
      {
        id: "seg-out-and-back",
        points: [
          { latitude: 40.0, longitude: -74.0 }, // 0: start
          { latitude: 40.0, longitude: -73.9975 }, // 1: mid outbound
          { latitude: 40.0, longitude: -73.995 }, // 2: turnaround point
          { latitude: 40.0, longitude: -73.9975 }, // 3: mid inbound
          { latitude: 40.0, longitude: -74.0 }, // 4: finish
        ],
      },
    ],
    maneuvers: [
      {
        id: "ob-start",
        segmentIndex: 0,
        shapeIndex: 0,
        latitude: 40.0,
        longitude: -74.0,
        instruction: "Head east on Ridge Rd",
      },
      {
        id: "ob-turnaround",
        segmentIndex: 0,
        shapeIndex: 2,
        latitude: 40.0,
        longitude: -73.995,
        instruction: "Make a U-turn and head west",
      },
      {
        id: "ob-finish",
        segmentIndex: 0,
        shapeIndex: 4,
        latitude: 40.0,
        longitude: -74.0,
        instruction: "Arrive back at start",
      },
    ],
  };
}

export function createCrossingRoute(): RouteDocument {
  // Figure 8 intersection:
  // Northbound passage at shapeIndex 1 (intersection at 40.001, -74.0)
  // Eastbound passage later at shapeIndex 5 (same intersection at 40.001, -74.0)
  return {
    schemaVersion: 1,
    id: "route-crossing",
    name: "Crossing Route",
    source: { kind: "new" },
    controlPoints: [],
    waypoints: [],
    segments: [
      {
        id: "seg-crossing",
        points: [
          { latitude: 40.0, longitude: -74.0 }, // 0
          { latitude: 40.001, longitude: -74.0 }, // 1: intersection (heading north)
          { latitude: 40.002, longitude: -74.0 }, // 2: loop around
          { latitude: 40.002, longitude: -74.001 }, // 3
          { latitude: 40.001, longitude: -74.001 }, // 4
          { latitude: 40.001, longitude: -74.0 }, // 5: same intersection (heading east)
          { latitude: 40.001, longitude: -73.999 }, // 6: finish
        ],
      },
    ],
    maneuvers: [
      {
        id: "cx-start",
        segmentIndex: 0,
        shapeIndex: 0,
        latitude: 40.0,
        longitude: -74.0,
        instruction: "Head north",
      },
      {
        id: "cx-turn-1",
        segmentIndex: 0,
        shapeIndex: 2,
        latitude: 40.002,
        longitude: -74.0,
        instruction: "Turn left",
      },
      {
        id: "cx-turn-2",
        segmentIndex: 0,
        shapeIndex: 4,
        latitude: 40.001,
        longitude: -74.001,
        instruction: "Turn left towards intersection",
      },
      {
        id: "cx-cross",
        segmentIndex: 0,
        shapeIndex: 5,
        latitude: 40.001,
        longitude: -74.0,
        instruction: "Continue straight through intersection",
      },
      {
        id: "cx-end",
        segmentIndex: 0,
        shapeIndex: 6,
        latitude: 40.001,
        longitude: -73.999,
        instruction: "Arrive at finish",
      },
    ],
  };
}

export function createSegmentGapRoute(): RouteDocument {
  // Two segments separated by a 150m gap
  return {
    schemaVersion: 1,
    id: "route-gap",
    name: "Route with Segment Gap",
    source: { kind: "new" },
    controlPoints: [],
    waypoints: [],
    segments: [
      {
        id: "seg-stage-1",
        points: [
          { latitude: 40.0, longitude: -74.0 }, // 0
          { latitude: 40.0018, longitude: -74.0 }, // ~200m North
        ],
      },
      {
        id: "seg-stage-2",
        // Starts ~150m away to the east
        points: [
          { latitude: 40.0018, longitude: -73.9982 }, // start of stage 2
          { latitude: 40.0036, longitude: -73.9982 }, // ~200m North
        ],
      },
    ],
    maneuvers: [
      {
        id: "gap-m-1",
        segmentIndex: 0,
        shapeIndex: 0,
        latitude: 40.0,
        longitude: -74.0,
        instruction: "Start Stage 1 heading north",
      },
      {
        id: "gap-m-2",
        segmentIndex: 1,
        shapeIndex: 0,
        latitude: 40.0018,
        longitude: -73.9982,
        instruction: "Resume Stage 2 heading north",
      },
      {
        id: "gap-m-3",
        segmentIndex: 1,
        shapeIndex: 1,
        latitude: 40.0036,
        longitude: -73.9982,
        instruction: "Arrive at Stage 2 end",
      },
    ],
  };
}

/**
 * Creates a dense corridor fixture with >26 points on outbound leg and >26 points on inbound return leg.
 * Both legs share the exact same physical corridor, testing directional check and route-distance bounded window.
 */
export function createDenseOutAndBackCorridorRoute(): RouteDocument {
  const points: Coordinate[] = [];
  const startLat = 40.0;
  const startLon = -74.0;
  const step = 0.00005; // ~5m per point

  // 35 points heading East (34 edges)
  for (let i = 0; i <= 35; i++) {
    points.push({ latitude: startLat, longitude: startLon + i * step });
  }

  // 35 points heading West back to start along same corridor (35 edges)
  for (let i = 34; i >= 0; i--) {
    points.push({ latitude: startLat, longitude: startLon + i * step });
  }

  return {
    schemaVersion: 1,
    id: "route-dense-corridor",
    name: "Dense Corridor Route",
    source: { kind: "new" },
    controlPoints: [],
    waypoints: [],
    segments: [{ id: "seg-dense", points }],
    maneuvers: [
      {
        id: "dense-start",
        segmentIndex: 0,
        shapeIndex: 0,
        latitude: startLat,
        longitude: startLon,
        instruction: "Head east on dense corridor",
      },
      {
        id: "dense-turnaround",
        segmentIndex: 0,
        shapeIndex: 35,
        latitude: startLat,
        longitude: startLon + 35 * step,
        instruction: "Turn around and head west",
      },
      {
        id: "dense-finish",
        segmentIndex: 0,
        shapeIndex: points.length - 1,
        latitude: startLat,
        longitude: startLon,
        instruction: "Arrive at finish",
      },
    ],
  };
}

export function createExcessiveSpanRoute(): RouteDocument {
  return {
    schemaVersion: 1,
    id: "route-excessive",
    name: "Excessive Span Route",
    source: { kind: "new" },
    controlPoints: [],
    waypoints: [],
    segments: [
      {
        id: "seg-excessive",
        points: [
          { latitude: 40.0, longitude: -74.0 },
          { latitude: 42.5, longitude: -74.0 }, // 2.5 degrees span!
        ],
      },
    ],
    maneuvers: [
      {
        id: "m-excessive-1",
        segmentIndex: 0,
        shapeIndex: 0,
        latitude: 40.0,
        longitude: -74.0,
        instruction: "Start",
      },
      {
        id: "m-excessive-2",
        segmentIndex: 0,
        shapeIndex: 1,
        latitude: 42.5,
        longitude: -74.0,
        instruction: "End",
      },
    ],
  };
}
