import type {
  NavigationConfig,
  NavigationState,
  PreparedNavigationRide,
} from "./types.js";

export function createNavigationState(
  ride: PreparedNavigationRide,
  _config?: Partial<NavigationConfig>,
): NavigationState {
  const firstManeuver = ride.maneuvers[0];
  const nextManeuverIndex = firstManeuver ? 0 : null;
  const distanceToNextManeuverMeters = firstManeuver
    ? firstManeuver.distanceAlongRideMeters
    : null;

  return {
    routeId: ride.routeId,
    rideVersion: 1,
    lifecycle: "active",
    lifecycleTimestamp: 0,
    freshFixRequiredAfter: null,
    quality: "unknown",
    currentSegmentIndex: 0,
    currentEdgeIndex: 0,
    progressMeters: 0,
    remainingMeters: ride.totalDistanceMeters,
    lateralDistanceMeters: 0,
    nextManeuverIndex,
    distanceToNextManeuverMeters,
    lastAcceptedFix: null,
    consecutiveOffRouteFixes: 0,
    consecutiveRejoinFixes: 0,
    isOffRoute: false,
    announcedCueIds: [],
    arrived: false,
    segmentGapState: null,
  };
}
