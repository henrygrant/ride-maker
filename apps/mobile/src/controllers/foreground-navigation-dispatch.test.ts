import { describe, expect, it } from "vitest";
import type { RouteDocument } from "@ride-maker/domain";
import { createNavigationState, DEFAULT_NAVIGATION_CONFIG, prepareNavigationRide } from "@ride-maker/navigation";
import { dispatchForegroundNavigation } from "./foreground-navigation-dispatch";

function denseRide() {
  const point = { latitude: 40, longitude: -74 };
  const document: RouteDocument = {
    schemaVersion: 1,
    id: "dense",
    name: "Dense",
    source: { kind: "new" },
    segments: [{ id: "dense-segment", points: [...Array.from({ length: 2_000 }, () => point), { latitude: 40.001, longitude: -74 }] }],
    controlPoints: [],
    waypoints: [],
    maneuvers: [0, 2_000].map((shapeIndex, index) => ({
      id: `maneuver-${index}`,
      segmentIndex: 0,
      shapeIndex,
      ...([point, { latitude: 40.001, longitude: -74 }][index]!),
      instruction: index === 0 ? "Start" : "Arrive",
    })),
  };
  const compiled = prepareNavigationRide(document);
  if (!compiled.ok) throw new Error("Expected dense route to compile");
  return compiled.ride;
}

describe("foreground navigation dispatch", () => {
  it("adopts SEARCH_LIMIT's degraded state and retains its error through repeat until a location fix recovers", () => {
    const ride = denseRide();
    const config = { ...DEFAULT_NAVIGATION_CONFIG, maxCandidateWorkPerFix: 100 };
    let state = createNavigationState(ride);
    const firstFix = dispatchForegroundNavigation(ride, state, {
      type: "location_fix", timestamp: 1_000, latitude: 40, longitude: -74, accuracyMeters: 3,
    }, null, config);
    state = firstFix.state;
    const limited = dispatchForegroundNavigation(ride, state, {
      type: "location_fix", timestamp: 2_000, latitude: 40, longitude: -74, accuracyMeters: 3,
    }, null, config);
    expect(limited.error).toContain("temporarily unavailable");
    expect(limited.state.quality).toBe("unknown");
    expect(limited.shouldAnnounce).toBe(false);

    const repeated = dispatchForegroundNavigation(ride, limited.state, {
      type: "repeat_instruction", timestamp: 3_000,
    }, limited.error, config);
    expect(repeated.error).toBe(limited.error);
    expect(repeated.state.quality).toBe("unknown");
    expect(repeated.shouldAnnounce).toBe(false);

    const recovered = dispatchForegroundNavigation(ride, repeated.state, {
      type: "location_fix", timestamp: 4_000, latitude: 40, longitude: -74, accuracyMeters: 3,
    }, repeated.error);
    expect(recovered.error).toBeNull();
    expect(recovered.state.quality).toBe("good");
  });
});
