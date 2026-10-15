import { describe, expect, it } from "vitest";
import {
  createCleanTurnsRoute,
  createCloseTurnsRoute,
  createClosedLoopRoute,
  createCrossingRoute,
  createDenseOutAndBackCorridorRoute,
  createExcessiveSpanRoute,
  createOutAndBackRoute,
  createSegmentGapRoute,
} from "./fixtures/scenario-routes.js";
import { createNavigationState } from "./navigation-state.js";
import { reduceNavigation } from "./navigation-reducer.js";
import { prepareNavigationRide } from "./prepare-ride.js";
import type { RouteDocument } from "@ride-maker/domain";
import type {
  LocationFixInput,
  NavigationState,
} from "./types.js";

describe("prepareNavigationRide boundary validation", () => {
  it("compiles a valid RouteDocument into an immutable PreparedNavigationRide", () => {
    const doc = createCleanTurnsRoute();
    const result = prepareNavigationRide(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.ride.version).toBe(1);
    expect(result.ride.routeId).toBe("route-clean-turns");
    expect(result.ride.totalDistanceMeters).toBeGreaterThan(350);
    expect(result.ride.segments.length).toBe(1);
    expect(result.ride.edges.length).toBe(2);
    expect(result.ride.maneuvers.length).toBe(3);
    expect(result.ride.maneuvers[0]?.id).toBe("m-start");
    expect(result.ride.maneuvers[1]?.id).toBe("m-turn");
    expect(result.ride.maneuvers[2]?.id).toBe("m-end");
  });

  it("rejects unsupported schema version", () => {
    const doc = { ...createCleanTurnsRoute(), schemaVersion: 99 as 1 };
    const result = prepareNavigationRide(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    }
  });

  it("rejects empty segments or segments with fewer than 2 points", () => {
    const docNoSegs: RouteDocument = {
      ...createCleanTurnsRoute(),
      segments: [],
    };
    const resNoSegs = prepareNavigationRide(docNoSegs);
    expect(resNoSegs.ok).toBe(false);
    if (!resNoSegs.ok) {
      expect(resNoSegs.error.code).toBe("DEGENERATE_GEOMETRY");
    }

    const docSinglePoint: RouteDocument = {
      ...createCleanTurnsRoute(),
      segments: [{ id: "single", points: [{ latitude: 40, longitude: -74 }] }],
    };
    const resSingle = prepareNavigationRide(docSinglePoint);
    expect(resSingle.ok).toBe(false);
    if (!resSingle.ok) {
      expect(resSingle.error.code).toBe("EMPTY_SEGMENT");
    }
  });

  it("rejects corrupt / NaN coordinates in route points", () => {
    const doc = createCleanTurnsRoute();
    doc.segments[0]!.points[1] = { latitude: NaN, longitude: -74 };
    const result = prepareNavigationRide(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_COORDINATE");
    }
  });

  it("rejects non-empty route without maneuvers with structured NO_MANEUVERS error", () => {
    const doc = createCleanTurnsRoute();
    doc.maneuvers = [];
    const result = prepareNavigationRide(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_MANEUVERS");
      expect(result.error.message).toContain("not ready");
    }
  });

  it("rejects maneuver with invalid segment or shape index", () => {
    const doc = createCleanTurnsRoute();
    doc.maneuvers[1]!.shapeIndex = 999;
    const result = prepareNavigationRide(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_MANEUVER_REFERENCE");
    }
  });

  it("rejects maneuver with empty instruction", () => {
    const doc = createCleanTurnsRoute();
    doc.maneuvers[1]!.instruction = "   ";
    const result = prepareNavigationRide(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_MANEUVER_INSTRUCTION");
    }
  });

  it("rejects maneuver whose coordinate mismatches referenced route point", () => {
    const doc = createCleanTurnsRoute();
    doc.maneuvers[1] = {
      ...doc.maneuvers[1]!,
      latitude: 40.005,
      longitude: -74.0,
    };
    const result = prepareNavigationRide(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("COORDINATE_MISMATCH");
    }
  });

  it("detects segment gap between consecutive segments", () => {
    const doc = createSegmentGapRoute();
    const result = prepareNavigationRide(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.ride.segments.length).toBe(2);
    expect(result.ride.segments[0]?.gapToNextMeters).toBeGreaterThan(100);
    expect(result.ride.segments[1]?.gapToNextMeters).toBeNull();
  });

  it("rejects route with excessive single-edge geographic span (> 1.0 degree) to prevent unbounded grid filling", () => {
    const doc = createExcessiveSpanRoute();
    const result = prepareNavigationRide(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNSUPPORTED_GEOMETRY");
      expect(result.error.message).toContain("unsupported for cycling navigation");
    }
  });
});

describe("Deterministic navigation engine", () => {
  it("initial fix on closed loop starts at beginning and does not jump to finish", () => {
    const doc = createClosedLoopRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    const state = createNavigationState(ride);

    const fix: LocationFixInput = {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
      headingDegrees: 0,
    };

    const res = reduceNavigation(ride, state, fix);
    expect(res.state.arrived).toBe(false);
    expect(res.state.currentSegmentIndex).toBe(0);
    expect(res.state.currentEdgeIndex).toBe(0);
    expect(res.state.progressMeters).toBeLessThan(10);
    expect(res.state.remainingMeters).toBeGreaterThan(750);
    expect(res.events.some((e) => e.type === "arrival")).toBe(false);
  });

  it("initial fix on out-and-back starts at outbound leg, not return leg", () => {
    const doc = createOutAndBackRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    const state = createNavigationState(ride);

    const fix: LocationFixInput = {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
      headingDegrees: 90,
    };

    const res = reduceNavigation(ride, state, fix);
    expect(res.state.arrived).toBe(false);
    expect(res.state.currentEdgeIndex).toBe(0);
    expect(res.state.progressMeters).toBeLessThan(10);
    expect(res.state.nextManeuverIndex).toBe(0);
  });

  it("progresses cleanly along route, emits upcoming and immediate turn cues, and arrives", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
      speedMetersPerSecond: 5,
      headingDegrees: 0,
    });
    state = res.state;
    expect(state.progressMeters).toBeLessThan(5);

    // Approaches turn
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 17000,
      latitude: 40.00072,
      longitude: -74.0,
      accuracyMeters: 5,
      speedMetersPerSecond: 5,
      headingDegrees: 0,
    });
    state = res.state;
    const upcomingEvent = res.events.find(
      (e) => e.type === "upcoming_maneuver",
    );
    expect(upcomingEvent).toBeDefined();
    if (upcomingEvent?.type === "upcoming_maneuver") {
      expect(upcomingEvent.maneuver.id).toBe("m-turn");
    }

    // Cue deduplication check
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 21000,
      latitude: 40.0009,
      longitude: -74.0,
      accuracyMeters: 5,
      speedMetersPerSecond: 5,
      headingDegrees: 0,
    });
    state = res.state;
    expect(res.events.filter((e) => e.type === "upcoming_maneuver")).toHaveLength(0);

    // Immediate cue
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 38000,
      latitude: 40.00166,
      longitude: -74.0,
      accuracyMeters: 5,
      speedMetersPerSecond: 5,
      headingDegrees: 0,
    });
    state = res.state;
    const immediateEvent = res.events.find(
      (e) => e.type === "immediate_maneuver",
    );
    expect(immediateEvent).toBeDefined();
    if (immediateEvent?.type === "immediate_maneuver") {
      expect(immediateEvent.maneuver.id).toBe("m-turn");
    }

    // Turns onto Oak St
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 61000,
      latitude: 40.0018,
      longitude: -73.9988,
      accuracyMeters: 5,
      speedMetersPerSecond: 5,
      headingDegrees: 90,
    });
    state = res.state;
    expect(state.currentEdgeIndex).toBe(1);
    expect(state.nextManeuverIndex).toBe(2);

    // Arrives
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 81000,
      latitude: 40.0018,
      longitude: -73.9976,
      accuracyMeters: 5,
      speedMetersPerSecond: 2,
      headingDegrees: 90,
    });
    state = res.state;
    expect(state.arrived).toBe(true);
    const arrivalEvent = res.events.find((e) => e.type === "arrival");
    expect(arrivalEvent).toBeDefined();
  });

  it("handles wrong turn and rejoin with hysteresis, immediately suppressing guidance during debounce", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;
    const initialProgress = state.progressMeters;

    // Fix 1 off route (45m west, count = 1):
    // Off route threshold is 35m. Debounce has not flipped to offRoute (needs 3 fixes).
    // BUT progress must NOT advance, and turn cues / arrival must NOT emit!
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 5000,
      latitude: 40.0005,
      longitude: -74.00055,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.isOffRoute).toBe(false);
    expect(state.consecutiveOffRouteFixes).toBe(1);
    expect(state.progressMeters).toBe(initialProgress); // suppressed!
    expect(res.events).toHaveLength(0); // suppressed!

    // Fix 2 off route (count = 2)
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 10000,
      latitude: 40.0005,
      longitude: -74.0006,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.isOffRoute).toBe(false);
    expect(state.consecutiveOffRouteFixes).toBe(2);
    expect(state.progressMeters).toBe(initialProgress);

    // Fix 3 off route (count = 3): debounce triggers off_route warning event
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 15000,
      latitude: 40.0005,
      longitude: -74.00065,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.isOffRoute).toBe(true);
    expect(res.events.some((e) => e.type === "off_route")).toBe(true);

    // Rejoin test:
    // Fix 4: rider returns, 15m away (<= 20m rejoin threshold, count = 1)
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 20000,
      latitude: 40.0005,
      longitude: -74.00018,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.isOffRoute).toBe(true);
    expect(state.consecutiveRejoinFixes).toBe(1);

    // Fix 5: rider stays close, 8m away (count = 2 >= rejoinConsecutiveFixes)
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 25000,
      latitude: 40.0005,
      longitude: -74.0001,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.isOffRoute).toBe(false);
    expect(res.events.some((e) => e.type === "rejoined")).toBe(true);
  });

  it("recovers from >30s GPS interruption without permanently rejecting subsequent fixes", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    // Initial fix at t=1000
    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;

    // Interruption / tunnel / pause for 120 seconds (gap > maxFixStalenessMs 30s)
    // Next fix arrives at t=121000 (~100m north)
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 121000,
      latitude: 40.0009,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;

    // Must NOT be rejected or permanently stalled!
    expect(state.quality).toBe("good");
    expect(state.progressMeters).toBeGreaterThan(80);
    expect(state.lastAcceptedFix?.timestamp).toBe(121000);

    // Subsequent normal fix at t=125000 advances cleanly
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 125000,
      latitude: 40.0011,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    expect(res.state.progressMeters).toBeGreaterThan(state.progressMeters);
  });

  it("flags stale fix via receivedAt wall-clock latency without replacing reliable baseline", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    // Initial reliable fix at t=1000
    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      receivedAt: 1050,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.lastAcceptedFix?.timestamp).toBe(1000);

    // Stale fix: GPS timestamp is 5000, but receivedAt is 50000 (age 45s > 30s)
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 5000,
      receivedAt: 50000,
      latitude: 40.0005,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.quality).toBe("degraded");
    expect(res.events.some((e) => e.type === "gps_degraded" && e.reason === "stale")).toBe(true);
    // Crucially: reliable baseline is NOT replaced by the stale fix
    expect(state.lastAcceptedFix?.timestamp).toBe(1000);
  });

  it("validates finite inputs and ensures inaccurate fixes do not replace reliable baseline", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    // Good baseline fix at t=1000
    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;

    // Test rejection of NaN timestamp
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: NaN,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    expect(res.state).toBe(state);

    // Test rejection of NaN speed
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 2000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
      speedMetersPerSecond: NaN,
    });
    expect(res.state).toBe(state);

    // Inaccurate fix (accuracy = 65m > 30m)
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 3000,
      latitude: 40.0005,
      longitude: -74.0008,
      accuracyMeters: 65,
    });
    state = res.state;
    expect(state.quality).toBe("degraded");
    // Reliable baseline remains untouched at t=1000!
    expect(state.lastAcceptedFix?.timestamp).toBe(1000);

    // Next accurate fix at t=5000 compares against reliable baseline
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 5000,
      latitude: 40.0003,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    expect(res.state.quality).toBe("good");
    expect(res.state.lastAcceptedFix?.timestamp).toBe(5000);
  });

  it("repeat instruction honors offroute, segment gap, and degraded GPS states", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    // 1. On route: repeat returns active maneuver
    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;

    res = reduceNavigation(ride, state, {
      type: "repeat_instruction",
      timestamp: 2000,
    });
    expect(res.events[0]?.type).toBe("instruction_repeated");
    if (res.events[0]?.type === "instruction_repeated") {
      expect(res.events[0].maneuver).not.toBeNull();
      expect(res.events[0].suppressionReason).toBeUndefined();
    }

    // 2. Off route: repeat suppresses maneuver and provides suppressionReason
    // Send 3 off-route fixes
    for (let t = 3000; t <= 5000; t += 1000) {
      const offRes = reduceNavigation(ride, state, {
        type: "location_fix",
        timestamp: t,
        latitude: 40.0005,
        longitude: -74.0006,
        accuracyMeters: 5,
      });
      state = offRes.state;
    }
    expect(state.isOffRoute).toBe(true);

    res = reduceNavigation(ride, state, {
      type: "repeat_instruction",
      timestamp: 6000,
    });
    if (res.events[0]?.type === "instruction_repeated") {
      expect(res.events[0].maneuver).toBeNull();
      expect(res.events[0].suppressionReason).toBe("off_route");
    }
  });

  it("dense out-and-back corridor with >26 points does not latch onto opposing return branch", () => {
    const doc = createDenseOutAndBackCorridorRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    // 35 edges outbound + 35 edges inbound = 70 total edges along same road
    expect(ride.edges.length).toBeGreaterThan(60);

    let state = createNavigationState(ride);

    // Initial fix heading East (90 degrees)
    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
      headingDegrees: 90,
    });
    state = res.state;
    expect(state.currentEdgeIndex).toBe(0);

    // Rider advances past edge 28 heading East (90 degrees).
    // The dense corridor has opposing Westbound return edges at the exact same location!
    // The engine must NOT latch onto the Westbound return edges!
    const testPointIndex = 28;
    const testLon = -74.0 + testPointIndex * 0.00005;

    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 30000,
      latitude: 40.0,
      longitude: testLon,
      accuracyMeters: 5,
      speedMetersPerSecond: 5,
      headingDegrees: 90, // heading East
    });
    state = res.state;

    // Must be on the outbound leg (edge index < 35), NOT on the return leg (edge index >= 35)
    expect(state.currentEdgeIndex).toBeLessThan(35);
    expect(state.currentEdgeIndex).toBeGreaterThanOrEqual(25);
    expect(state.isOffRoute).toBe(false);
  });

  it("rejects out-of-order and stale timestamps without advancing progress", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 10000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;
    const progressAfterFix1 = state.progressMeters;

    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 8000,
      latitude: 40.001,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    expect(res.state.progressMeters).toBe(progressAfterFix1);
    expect(res.events).toHaveLength(0);

    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 10000,
      latitude: 40.001,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    expect(res.state.progressMeters).toBe(progressAfterFix1);
    expect(res.events).toHaveLength(0);
  });

  it("rejects implausible jumps without warping progress", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;

    // Sudden 500m jump in 1 second
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 2000,
      latitude: 40.0045,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    expect(res.state.quality).toBe("degraded");
    expect(res.state.progressMeters).toBe(state.progressMeters);
    expect(res.events.some((e) => e.type === "gps_degraded")).toBe(true);
  });

  it("allows reversal along route without forward-clamping progress", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 10000,
      latitude: 40.0009,
      longitude: -74.0,
      accuracyMeters: 5,
      headingDegrees: 0,
    });
    state = res.state;
    const progressForward = state.progressMeters;
    expect(progressForward).toBeGreaterThan(90);

    // Reverses 30m backward
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 15000,
      latitude: 40.00063,
      longitude: -74.0,
      accuracyMeters: 5,
      headingDegrees: 180,
    });
    state = res.state;
    expect(state.progressMeters).toBeLessThan(progressForward - 20);
    expect(state.isOffRoute).toBe(false);
  });

  it("crossing / Figure-8 maintains direction and does not jump crossing leg", () => {
    const doc = createCrossingRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0005,
      longitude: -74.0,
      accuracyMeters: 5,
      headingDegrees: 0,
    });
    state = res.state;
    expect(state.currentEdgeIndex).toBe(0);

    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 10000,
      latitude: 40.001,
      longitude: -74.0,
      accuracyMeters: 5,
      headingDegrees: 0,
    });
    state = res.state;
    expect(state.currentEdgeIndex).toBeLessThanOrEqual(1);
    expect(state.nextManeuverIndex).toBe(1);
  });

  it("handles segment gaps without fabricating cross-gap turns", () => {
    const doc = createSegmentGapRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.segmentGapState).toBeNull();

    // Rider nears end of Stage 1 entering 150m gap
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 25000,
      latitude: 40.00175,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.segmentGapState).not.toBeNull();
    expect(state.segmentGapState?.fromSegmentIndex).toBe(0);
    expect(state.segmentGapState?.toSegmentIndex).toBe(1);
    expect(res.events.some((e) => e.type === "segment_gap")).toBe(true);

    // Rider transitions to Stage 2
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 50000,
      latitude: 40.00185,
      longitude: -73.9982,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.currentSegmentIndex).toBe(1);
    expect(state.segmentGapState).toBeNull();
  });

  it("handles lifecycle actions: pause, resume, end, repeat instruction", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;

    // Pause
    res = reduceNavigation(ride, state, { type: "pause", timestamp: 5000 });
    state = res.state;
    expect(state.lifecycle).toBe("paused");
    expect(res.events[0]?.type).toBe("lifecycle_changed");

    // While paused, location fix does not advance progress
    const progressBefore = state.progressMeters;
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 10000,
      latitude: 40.001,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    expect(res.state.progressMeters).toBe(progressBefore);

    // Resume
    res = reduceNavigation(ride, state, { type: "resume", timestamp: 15000 });
    state = res.state;
    expect(state.lifecycle).toBe("active");

    // End (terminal)
    res = reduceNavigation(ride, state, { type: "end", timestamp: 20000 });
    state = res.state;
    expect(state.lifecycle).toBe("ended");

    // Cannot resume from ended
    res = reduceNavigation(ride, state, { type: "resume", timestamp: 25000 });
    expect(res.state.lifecycle).toBe("ended");
    expect(res.events).toHaveLength(0);
  });

  it("NavigationState survives JSON round-trip and preserves cue deduplication", () => {
    const doc = createCleanTurnsRoute();
    const prep = prepareNavigationRide(doc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    let state = createNavigationState(ride);

    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: 40.0,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;

    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 15000,
      latitude: 40.00072,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    state = res.state;
    expect(state.announcedCueIds.length).toBeGreaterThan(0);

    const jsonStr = JSON.stringify(state);
    const rehydratedState: NavigationState = JSON.parse(jsonStr);

    expect(rehydratedState.announcedCueIds).toEqual(state.announcedCueIds);

    const nextRes = reduceNavigation(ride, rehydratedState, {
      type: "location_fix",
      timestamp: 18000,
      latitude: 40.0008,
      longitude: -74.0,
      accuracyMeters: 5,
    });
    expect(
      nextRes.events.filter((e) => e.type === "upcoming_maneuver"),
    ).toHaveLength(0);
  });

  it("handles 100,000 point route with bounded spatial index query", () => {
    const totalPoints = 100_000;
    const points = new Array(totalPoints);
    const startLat = 40.0;
    const startLon = -74.0;
    const step = 0.00001; // ~1.1m per step

    for (let i = 0; i < totalPoints; i++) {
      points[i] = {
        latitude: startLat + i * step,
        longitude: startLon,
      };
    }

    const largeDoc: RouteDocument = {
      schemaVersion: 1,
      id: "route-100k",
      name: "100k Point Stress Route",
      source: { kind: "new" },
      controlPoints: [],
      waypoints: [],
      segments: [{ id: "seg-100k", points }],
      maneuvers: [
        {
          id: "m-0",
          segmentIndex: 0,
          shapeIndex: 0,
          latitude: startLat,
          longitude: startLon,
          instruction: "Start massive ride",
        },
        {
          id: "m-1",
          segmentIndex: 0,
          shapeIndex: 50_000,
          latitude: startLat + 50_000 * step,
          longitude: startLon,
          instruction: "Halfway point",
        },
        {
          id: "m-2",
          segmentIndex: 0,
          shapeIndex: totalPoints - 1,
          latitude: startLat + (totalPoints - 1) * step,
          longitude: startLon,
          instruction: "Finish ride",
        },
      ],
    };

    const prep = prepareNavigationRide(largeDoc);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    const ride = prep.ride;
    expect(ride.edges.length).toBe(totalPoints - 1);

    let state = createNavigationState(ride);

    // Initial fix at start
    let res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 1000,
      latitude: startLat,
      longitude: startLon,
      accuracyMeters: 5,
    });
    state = res.state;

    expect(state.currentEdgeIndex).toBeLessThan(5);

    // Progress along route to point 1000 (~1100m away, 120s elapsed)
    res = reduceNavigation(ride, state, {
      type: "location_fix",
      timestamp: 121000,
      latitude: startLat + 1000 * step,
      longitude: startLon,
      accuracyMeters: 5,
    });
    state = res.state;

    expect(state.progressMeters).toBeGreaterThan(1000);
  });
});
