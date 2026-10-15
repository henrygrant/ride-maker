import { describe, expect, it } from "vitest";
import type { RouteDocument } from "@ride-maker/domain";
import { createNavigationState, DEFAULT_NAVIGATION_CONFIG, prepareNavigationRide, queryCandidateEdgeIndices, reduceNavigation } from "./index.js";

function authoredRide(points: Array<{ latitude: number; longitude: number }>): RouteDocument {
  return {
    schemaVersion: 1,
    id: "sol-authored-ride",
    name: "Review ride",
    source: { kind: "new" },
    segments: [{ id: "main", points }],
    controlPoints: [],
    waypoints: [],
    maneuvers: [0, points.length - 1].map((shapeIndex, index) => ({
      id: `turn-${index}`,
      segmentIndex: 0,
      shapeIndex,
      ...points[shapeIndex]!,
      instruction: index === 0 ? "Head north" : "Arrive",
    })),
  };
}

describe("Sol independent navigation acceptance", () => {
  it("does not announce a later covered turn across an intervening uncovered segment", () => {
    const document = authoredRide([{ latitude: 40, longitude: -74 }, { latitude: 40.0012, longitude: -74 }]);
    document.segments = [0, 1, 2].map(index => ({
      id: `part-${index}`,
      points: [
        { latitude: 40 + index * 0.0004, longitude: -74 },
        { latitude: 40 + (index + 1) * 0.0004, longitude: -74 },
      ],
    }));
    document.maneuvers = [
      { id: "depart", segmentIndex: 0, shapeIndex: 0, latitude: 40, longitude: -74, instruction: "Depart" },
      { id: "later", segmentIndex: 2, shapeIndex: 0, latitude: 40.0008, longitude: -74, instruction: "Turn right" },
    ];
    const compiled = prepareNavigationRide(document, { guidanceUnavailableSegmentIndices: [1] });
    if (!compiled.ok) throw new Error("Valid partial itinerary must compile");
    const update = reduceNavigation(compiled.ride, createNavigationState(compiled.ride), {
      type: "location_fix", timestamp: 1000, latitude: 40.0002, longitude: -74,
      accuracyMeters: 3, headingDegrees: 0, speedMetersPerSecond: 3,
    });
    expect(update.events.some(event => event.type === "upcoming_maneuver" || event.type === "immediate_maneuver")).toBe(false);
    const repeated = reduceNavigation(compiled.ride, update.state, { type: "repeat_instruction", timestamp: 2000 });
    const event = repeated.events.find(event => event.type === "instruction_repeated");
    expect(event?.type === "instruction_repeated" ? event.maneuver : null).toBeNull();
  });
  it("indexes a shallow edge using its real subcell endpoints", () => {
    const result = prepareNavigationRide(authoredRide([
      { latitude: 40.049, longitude: -74.001 },
      { latitude: 40.051, longitude: -73.901 },
    ]));
    if (!result.ok) throw new Error("Valid bounded geometry must compile");
    expect(queryCandidateEdgeIndices(result.ride.spatialIndex, 40.0495, -73.976, 5)).toContain(0);
  });
  it("indexes the full length of an accepted one-degree edge", () => {
    const result = prepareNavigationRide(authoredRide([
      { latitude: 40, longitude: -74 },
      { latitude: 41, longitude: -74 },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Authored ride must compile");
    const endpointCandidates = queryCandidateEdgeIndices(result.ride.spatialIndex, 41, -74, 1);
    expect(endpointCandidates).toContain(0);
  });

  it("indexes known physical points across shallow, steep, negative, axis and corner crossings", () => {
    const cases = [
      { a: { latitude: 40.049, longitude: -74.001 }, b: { latitude: 40.051, longitude: -73.901 }, q: { latitude: 40.0495, longitude: -73.976 } },
      { a: { latitude: 40.001, longitude: -74.049 }, b: { latitude: 40.101, longitude: -74.051 }, q: { latitude: 40.076, longitude: -74.0505 } },
      { a: { latitude: 40.001, longitude: -73.901 }, b: { latitude: 40.101, longitude: -74.001 }, q: { latitude: 40.051, longitude: -73.951 } },
      { a: { latitude: 40, longitude: -74 }, b: { latitude: 40.1, longitude: -74 }, q: { latitude: 40.037, longitude: -74 } },
      { a: { latitude: 40, longitude: -74 }, b: { latitude: 40, longitude: -73.9 }, q: { latitude: 40, longitude: -73.947 } },
      { a: { latitude: 40, longitude: -74 }, b: { latitude: 40.1, longitude: -73.9 }, q: { latitude: 40.05, longitude: -73.95 } },
    ];
    for (const { a, b, q } of cases) {
      const result = prepareNavigationRide(authoredRide([a, b]));
      if (!result.ok) throw new Error("Traversal case must compile");
      expect(queryCandidateEdgeIndices(result.ride.spatialIndex, q.latitude, q.longitude, 5), `${JSON.stringify({ a, b, q })}`).toContain(0);
    }
  });

  it("requires a fresh reliable fix after resume and rejects stale lifecycle actions", () => {
    const result = prepareNavigationRide(authoredRide([
      { latitude: 40, longitude: -74 },
      { latitude: 40.01, longitude: -74 },
    ]));
    if (!result.ok) throw new Error("Authored ride must compile");
    let state = createNavigationState(result.ride);
    state = reduceNavigation(result.ride, state, { type: "location_fix", timestamp: 1_000, latitude: 40, longitude: -74, accuracyMeters: 3 }).state;
    state = reduceNavigation(result.ride, state, { type: "pause", timestamp: 2_000 }).state;
    state = reduceNavigation(result.ride, state, { type: "resume", timestamp: 3_000 }).state;
    expect(reduceNavigation(result.ride, state, { type: "location_fix", timestamp: 2_500, latitude: 40.001, longitude: -74, accuracyMeters: 3 }).state).toBe(state);
    const repeat = reduceNavigation(result.ride, state, { type: "repeat_instruction", timestamp: 3_100 }).events[0];
    expect(repeat?.type).toBe("instruction_repeated");
    if (repeat?.type === "instruction_repeated") expect(repeat.suppressionReason).toBe("no_fix");
    expect(reduceNavigation(result.ride, state, { type: "pause", timestamp: 2_500 }).state).toBe(state);
    const fresh = reduceNavigation(result.ride, state, { type: "location_fix", timestamp: 4_000, latitude: 40.001, longitude: -74, accuracyMeters: 3 });
    expect(fresh.state.quality).toBe("good");
    expect(reduceNavigation(result.ride, fresh.state, { type: "repeat_instruction", timestamp: 4_100 }).events[0]).toMatchObject({ type: "instruction_repeated", maneuver: expect.any(Object) });
  });

  it("returns structured errors for malformed persisted state, input and config shapes", () => {
    const result = prepareNavigationRide(authoredRide([
      { latitude: 40, longitude: -74 },
      { latitude: 40.01, longitude: -74 },
    ]));
    if (!result.ok) throw new Error("Authored ride must compile");
    const state = createNavigationState(result.ride);
    expect(reduceNavigation(result.ride, { ...state, announcedCueIds: {} } as never, { type: "repeat_instruction", timestamp: 1 }).error?.code).toBe("INVALID_STATE");
    expect(reduceNavigation(result.ride, state, null as never).error?.code).toBe("INVALID_INPUT");
    expect(reduceNavigation(result.ride, state, { type: "repeat_instruction", timestamp: 1 }, {} as never).error?.code).toBe("INVALID_CONFIG");
  });

  it("bounds local dense-trace work without accepting a partial candidate", () => {
    const a = { latitude: 40, longitude: -74 };
    const points = [...Array.from({ length: 2_000 }, () => a), { latitude: 40.001, longitude: -74 }];
    const result = prepareNavigationRide(authoredRide(points));
    if (!result.ok) throw new Error("Dense route must compile");
    const config = { ...DEFAULT_NAVIGATION_CONFIG, maxCandidateWorkPerFix: 100 };
    let state = reduceNavigation(result.ride, createNavigationState(result.ride), {
      type: "location_fix", timestamp: 1_000, ...a, accuracyMeters: 3,
    }, config).state;
    const progressBefore = state.progressMeters;
    const limited = reduceNavigation(result.ride, state, {
      type: "location_fix", timestamp: 2_000, ...a, accuracyMeters: 3,
    }, config);
    expect(limited.error).toMatchObject({ code: "SEARCH_LIMIT", workCount: 100 });
    expect(limited.state.progressMeters).toBe(progressBefore);
    expect(limited.state.quality).toBe("unknown");
    expect(limited.events).toHaveLength(0);
    expect(reduceNavigation(result.ride, limited.state, {
      type: "repeat_instruction", timestamp: 3_000,
    }, config).events[0]).toMatchObject({ type: "instruction_repeated", suppressionReason: "no_fix" });
  });

  it("bounds clustered fallback-index work during interruption recovery", () => {
    const a = { latitude: 40.01, longitude: -74.01 };
    const b = { latitude: 40.011, longitude: -74.009 };
    const points = Array.from({ length: 2_000 }, (_, i) => i % 2 === 0 ? a : b);
    const result = prepareNavigationRide(authoredRide(points));
    if (!result.ok) throw new Error("Looping route must compile");
    const config = { ...DEFAULT_NAVIGATION_CONFIG, maxCandidateWorkPerFix: 100 };
    let state = reduceNavigation(result.ride, createNavigationState(result.ride), {
      type: "location_fix", timestamp: 1_000, ...a, accuracyMeters: 3,
    }, config).state;
    const progressBefore = state.progressMeters;
    const limited = reduceNavigation(result.ride, state, {
      type: "location_fix", timestamp: 121_000, ...a, accuracyMeters: 3,
    }, config);
    expect(limited.error).toMatchObject({ code: "SEARCH_LIMIT", workCount: 100 });
    expect(limited.state.progressMeters).toBe(progressBefore);
    expect(limited.events).toHaveLength(0);
  });

  it("rejects capture timestamps beyond configured future clock skew without poisoning the baseline", () => {
    const result = prepareNavigationRide(authoredRide([
      { latitude: 40, longitude: -74 },
      { latitude: 40.01, longitude: -74 },
    ]));
    if (!result.ok) throw new Error("Authored ride must compile");
    const initial = createNavigationState(result.ride);
    const rejected = reduceNavigation(result.ride, initial, {
      type: "location_fix", timestamp: 10_000, receivedAt: 1_000,
      latitude: 40, longitude: -74, accuracyMeters: 3,
    });
    expect(rejected.error?.code).toBe("INVALID_INPUT");
    expect(rejected.state.lastAcceptedFix).toBeNull();
    const accepted = reduceNavigation(result.ride, rejected.state, {
      type: "location_fix", timestamp: 2_000, receivedAt: 2_000,
      latitude: 40, longitude: -74, accuracyMeters: 3,
    });
    expect(accepted.state.lastAcceptedFix?.timestamp).toBe(2_000);
  });

  it("suppresses turns attached to guidance-unavailable segments while retaining progress geometry", () => {
    const doc = authoredRide([
      { latitude: 40, longitude: -74 },
      { latitude: 40.001, longitude: -74 },
      { latitude: 40.002, longitude: -74 },
    ]);
    doc.maneuvers = [1, 2].map((shapeIndex) => ({ id: `m-${shapeIndex}`, segmentIndex: 0, shapeIndex, ...doc.segments[0]!.points[shapeIndex]!, instruction: "Continue" }));
    const result = prepareNavigationRide(doc, { guidanceUnavailableSegmentIndices: [0] });
    if (!result.ok) throw new Error("Authored ride must compile");
    let state = createNavigationState(result.ride);
    state = reduceNavigation(result.ride, state, { type: "location_fix", timestamp: 1_000, latitude: 40.001, longitude: -74, accuracyMeters: 3 }).state;
    expect(state.progressMeters).toBeGreaterThan(100);
    expect(state.announcedCueIds).toHaveLength(0);
    const repeated = reduceNavigation(result.ride, state, { type: "repeat_instruction", timestamp: 2_000 }).events[0];
    expect(repeated?.type).toBe("instruction_repeated");
    if (repeated?.type === "instruction_repeated") expect(repeated.suppressionReason).toBe("unavailable");
  });

  it("rejects an entirely stationary track even when it contains instructions", () => {
    const result = prepareNavigationRide(authoredRide([
      { latitude: 40, longitude: -74 },
      { latitude: 40, longitude: -74 },
      { latitude: 40, longitude: -74 },
    ]));
    expect(result.ok).toBe(false);
  });

  it("rejects a string geometry index from a malformed persisted document", () => {
    const document = authoredRide([
      { latitude: 40, longitude: -74 },
      { latitude: 40.001, longitude: -74 },
    ]);
    const malformed = JSON.parse(JSON.stringify(document));
    malformed.maneuvers[1].shapeIndex = "1";
    expect(prepareNavigationRide(malformed).ok).toBe(false);
  });

  it("tracks the whole dense out-and-back without latching onto its overlapping outbound leg", () => {
    const outbound = Array.from({ length: 81 }, (_, i) => ({
      latitude: 40 + i * 0.00002,
      longitude: -74,
    }));
    const points = [...outbound, ...outbound.slice(0, -1).reverse()];
    const result = prepareNavigationRide(authoredRide(points));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Authored cycling route must compile");
    let state = createNavigationState(result.ride);
    for (let i = 0; i < points.length; i++) {
      const update = reduceNavigation(result.ride, state, {
        type: "location_fix",
        timestamp: 1_000 + i * 1_000,
        ...points[i]!,
        accuracyMeters: 3,
        speedMetersPerSecond: 2.22,
        headingDegrees: i <= 80 ? 0 : 180,
      });
      state = update.state;
      // Independent physical distance: each point is about 2.22m farther along
      // the authored itinerary, including after the turnaround.
      expect(state.progressMeters, `sample ${i}`).toBeGreaterThanOrEqual(i * 2.22 - 10);
      expect(state.progressMeters, `sample ${i}`).toBeLessThanOrEqual(i * 2.22 + 10);
      if (i < 148) expect(state.arrived, `sample ${i}`).toBe(false);
    }
    expect(state.arrived).toBe(true);
    expect(state.isOffRoute).toBe(false);
  });

  it("replays a closed loop to its finish without arriving at the overlapping start", () => {
    const points = [
      { latitude: 40, longitude: -74 },
      { latitude: 40.0005, longitude: -74 },
      { latitude: 40.0005, longitude: -73.9995 },
      { latitude: 40, longitude: -73.9995 },
      { latitude: 40, longitude: -74 },
    ];
    const result = prepareNavigationRide(authoredRide(points));
    if (!result.ok) throw new Error("Closed loop must compile");
    let state = createNavigationState(result.ride);
    for (let i = 0; i < points.length; i++) {
      state = reduceNavigation(result.ride, state, {
        type: "location_fix",
        timestamp: 1_000 + i * 25_000,
        ...points[i]!,
        accuracyMeters: 3,
        speedMetersPerSecond: 2,
      }).state;
      if (i < points.length - 1) expect(state.arrived, `loop sample ${i}`).toBe(false);
    }
    expect(state.arrived).toBe(true);
    expect(state.progressMeters).toBeGreaterThan(result.ride.totalDistanceMeters - 5);
  });

  it("replays consecutive close turns in order without losing the later instruction", () => {
    const points = [
      { latitude: 40, longitude: -74 },
      { latitude: 40.0004, longitude: -74 },
      { latitude: 40.0004, longitude: -73.9996 },
      { latitude: 40.0008, longitude: -73.9996 },
      { latitude: 40.0008, longitude: -73.9992 },
    ];
    const document = authoredRide(points);
    document.maneuvers = [1, 2, 3, 4].map((shapeIndex) => ({
      id: `turn-${shapeIndex}`, segmentIndex: 0, shapeIndex,
      ...points[shapeIndex]!, instruction: `Turn ${shapeIndex}`,
    }));
    const result = prepareNavigationRide(document);
    if (!result.ok) throw new Error("Close-turn route must compile");
    let state = createNavigationState(result.ride);
    const spoken: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const update = reduceNavigation(result.ride, state, {
        type: "location_fix", timestamp: 1_000 + i * 20_000,
        ...points[i]!, accuracyMeters: 3, speedMetersPerSecond: 2,
      });
      state = update.state;
      for (const event of update.events) if (event.type === "upcoming_maneuver" || event.type === "immediate_maneuver") spoken.push(event.maneuver.id);
    }
    expect(new Set(spoken)).toEqual(new Set(["turn-1", "turn-2", "turn-3", "turn-4"]));
    expect(state.progressMeters).toBeGreaterThan(100);
  });

  it("does not finish an out-and-back while stationary at its start with a reversed heading", () => {
    const outbound = Array.from({ length: 81 }, (_, i) => ({
      latitude: 40 + i * 0.00002,
      longitude: -74,
    }));
    const points = [...outbound, ...outbound.slice(0, -1).reverse()];
    const result = prepareNavigationRide(authoredRide(points));
    if (!result.ok) throw new Error("Authored cycling route must compile");
    let state = createNavigationState(result.ride);
    for (let i = 0; i < 3; i++) {
      state = reduceNavigation(result.ride, state, {
        type: "location_fix",
        timestamp: 1_000 + i * 1_000,
        ...points[0]!,
        accuracyMeters: 3,
        speedMetersPerSecond: 0,
        headingDegrees: 180,
      }).state;
      expect(state.arrived).toBe(false);
      expect(state.progressMeters).toBeLessThan(10);
    }
  });
});
