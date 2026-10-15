import {
  distanceMeters,
  headingDifferenceDegrees,
  isValidCoordinate,
  projectPointOnEdge,
} from "./geo.js";
import { queryCandidateEdgeIndicesBounded } from "./spatial-index.js";
import {
  DEFAULT_NAVIGATION_CONFIG,
  type AcceptedFixRecord,
  type ImmediateManeuverEvent,
  type LocationFixInput,
  type NavigationConfig,
  type NavigationEvent,
  type NavigationInput,
  type NavigationResult,
  type NavigationState,
  type PreparedEdge,
  type PreparedNavigationRide,
  type SegmentGapState,
  type UpcomingManeuverEvent,
} from "./types.js";

type EvaluatedCandidate = {
  readonly edge: PreparedEdge;
  readonly fraction: number;
  readonly lateralDistanceMeters: number;
  readonly distanceAlongRideMeters: number;
  readonly distanceAlongSegmentMeters: number;
  readonly score: number;
  readonly headingDiff: number | null;
  readonly deltaProgress: number;
};

type CandidateSearchResult = {
  readonly candidate: EvaluatedCandidate | null;
  readonly workCount: number;
  readonly limitExceeded: boolean;
};

export function reduceNavigation(
  ride: PreparedNavigationRide,
  previousState: NavigationState,
  input: NavigationInput,
  rawConfig?: NavigationConfig,
): NavigationResult {
  const config = rawConfig ?? DEFAULT_NAVIGATION_CONFIG;

  if (!isRecord(ride) || !Array.isArray(ride.edges) || !Array.isArray(ride.segments) || !Array.isArray(ride.maneuvers) || !Array.isArray(ride.guidanceUnavailableSegmentIndices) || !ride.spatialIndex || !(ride.spatialIndex.cells instanceof Map)) {
    return { state: previousState, events: [], error: { code: "INVALID_RIDE", message: "Prepared ride shape is invalid" } };
  }
  if (!isRecord(previousState) || !["active", "paused", "ended"].includes(previousState.lifecycle) || previousState.routeId !== ride.routeId || !Array.isArray(previousState.announcedCueIds) || previousState.announcedCueIds.some((id: unknown) => typeof id !== "string") || !Number.isInteger(previousState.currentEdgeIndex) || previousState.currentEdgeIndex < 0 || previousState.currentEdgeIndex >= ride.edges.length || !Number.isInteger(previousState.currentSegmentIndex) || previousState.currentSegmentIndex < 0 || previousState.currentSegmentIndex >= ride.segments.length || !Number.isFinite(previousState.progressMeters) || !Number.isFinite(previousState.remainingMeters) || !["unknown", "good", "degraded"].includes(previousState.quality) || (previousState.lastAcceptedFix !== null && (!isRecord(previousState.lastAcceptedFix) || !isValidCoordinate(previousState.lastAcceptedFix) || !Number.isFinite(previousState.lastAcceptedFix.timestamp) || !Number.isFinite(previousState.lastAcceptedFix.accuracyMeters)))) {
    return { state: previousState, events: [], error: { code: "INVALID_STATE", message: "Navigation state shape or route identity is invalid" } };
  }
  if (!isRecord(input) || typeof input.type !== "string") {
    return { state: previousState, events: [], error: { code: "INVALID_INPUT", message: "Navigation input must be an object with a type" } };
  }
  const configKeys = Object.keys(DEFAULT_NAVIGATION_CONFIG) as (keyof NavigationConfig)[];
  if (!isRecord(config) || configKeys.some((key) => typeof config[key] !== "number" || !Number.isFinite(config[key]) || config[key] < 0) || !Number.isInteger(config.offRouteConsecutiveFixes) || config.offRouteConsecutiveFixes < 1 || !Number.isInteger(config.rejoinConsecutiveFixes) || config.rejoinConsecutiveFixes < 1 || !Number.isInteger(config.maxCandidateWorkPerFix) || config.maxCandidateWorkPerFix < 1 || !Number.isInteger(config.maxFixStalenessMs) || config.maxFixStalenessMs < 1 || !Number.isInteger(config.maxFutureFixSkewMs) || config.candidateSearchRadiusMeters <= 0 || config.headingToleranceDegrees > 180) {
    return { state: previousState, events: [], error: { code: "INVALID_CONFIG", message: "Navigation configuration contains invalid values" } };
  }

  // Validate finite timestamp on any input
  if (typeof input.timestamp !== "number" || !Number.isSafeInteger(input.timestamp)) {
    return { state: previousState, events: [], error: { code: "INVALID_INPUT", message: "Input timestamp must be a safe integer epoch-millisecond value" } };
  }
  if (input.timestamp <= previousState.lifecycleTimestamp && input.type !== "location_fix") return { state: previousState, events: [] };

  // Terminal lifecycle check
  if (previousState.lifecycle === "ended") {
    return { state: previousState, events: [] };
  }

  switch (input.type) {
    case "end": {
      const event: NavigationEvent = {
        type: "lifecycle_changed",
        id: `lifecycle:${input.timestamp}:ended`,
        timestamp: input.timestamp,
        previousLifecycle: previousState.lifecycle,
        currentLifecycle: "ended",
      };
      return {
        state: { ...previousState, lifecycle: "ended", lifecycleTimestamp: input.timestamp },
        events: [event],
      };
    }

    case "pause": {
      if (previousState.lifecycle === "paused") {
        return { state: previousState, events: [] };
      }
      const event: NavigationEvent = {
        type: "lifecycle_changed",
        id: `lifecycle:${input.timestamp}:paused`,
        timestamp: input.timestamp,
        previousLifecycle: previousState.lifecycle,
        currentLifecycle: "paused",
      };
      return {
        state: { ...previousState, lifecycle: "paused", lifecycleTimestamp: input.timestamp },
        events: [event],
      };
    }

    case "resume": {
      if (previousState.lifecycle === "active") {
        return { state: previousState, events: [] };
      }
      const event: NavigationEvent = {
        type: "lifecycle_changed",
        id: `lifecycle:${input.timestamp}:active`,
        timestamp: input.timestamp,
        previousLifecycle: previousState.lifecycle,
        currentLifecycle: "active",
      };
      // On resume, reset hysteresis counters so recovery is clean
      return {
        state: {
          ...previousState,
          lifecycle: "active",
          lifecycleTimestamp: input.timestamp,
          freshFixRequiredAfter: input.timestamp,
          quality: "unknown",
          consecutiveOffRouteFixes: 0,
          consecutiveRejoinFixes: 0,
        },
        events: [event],
      };
    }

    case "repeat_instruction": {
      // Repeat must honor offroute / gap / degraded state and suppress misleading guidance
      const isOffRoute =
        previousState.isOffRoute ||
        previousState.lateralDistanceMeters > config.offRouteThresholdMeters;
      const isDegraded = previousState.quality !== "good" || previousState.lastAcceptedFix === null || (previousState.freshFixRequiredAfter !== null && previousState.lastAcceptedFix.timestamp <= previousState.freshFixRequiredAfter) || previousState.lifecycle !== "active";
      const isInGap = previousState.segmentGapState !== null;
      const repeatTarget = previousState.nextManeuverIndex === null ? null : ride.maneuvers[previousState.nextManeuverIndex] ?? null;
      const isUnavailable = isGuidanceUnavailable(ride, previousState.currentSegmentIndex) || (repeatTarget !== null && hasUnavailableSegmentBetween(ride, previousState.progressMeters, repeatTarget.distanceAlongRideMeters));

      let suppressionReason: "off_route" | "segment_gap" | "degraded_gps" | "no_fix" | "paused" | "unavailable" | undefined;
      if (isOffRoute) {
        suppressionReason = "off_route";
      } else if (isInGap) {
        suppressionReason = "segment_gap";
      } else if (isDegraded) {
        suppressionReason = previousState.lifecycle !== "active" ? "paused" : previousState.quality === "unknown" || previousState.lastAcceptedFix === null ? "no_fix" : "degraded_gps";
      } else if (isUnavailable) {
        suppressionReason = "unavailable";
      }

      const isSuppressed = suppressionReason !== undefined;
      const candidateManeuver =
        !isSuppressed && previousState.nextManeuverIndex !== null
          ? (ride.maneuvers[previousState.nextManeuverIndex] ?? null)
          : null;
      const maneuver = candidateManeuver && isGuidanceUnavailable(ride, candidateManeuver.segmentIndex) ? null : candidateManeuver;
      if (candidateManeuver && !maneuver) suppressionReason = "unavailable";

      const event: NavigationEvent = {
        type: "instruction_repeated",
        id: `repeat:${input.timestamp}:${maneuver?.id ?? "suppressed"}`,
        timestamp: input.timestamp,
        maneuver,
        distanceToManeuverMeters: !isSuppressed
          ? previousState.distanceToNextManeuverMeters
          : null,
        ...(suppressionReason ? { suppressionReason } : {}),
      };
      return {
        state: previousState,
        events: [event],
      };
    }

    case "location_fix": {
      return reduceLocationFix(ride, previousState, input, config);
    }
    default:
      return { state: previousState, events: [], error: { code: "INVALID_INPUT", message: "Unknown navigation input type" } };
  }
}

function reduceLocationFix(
  ride: PreparedNavigationRide,
  previousState: NavigationState,
  fix: LocationFixInput,
  config: NavigationConfig,
): NavigationResult {
  // Paused navigation does not advance guidance or progress
  if (previousState.lifecycle === "paused") {
    return { state: previousState, events: [] };
  }
  if (previousState.freshFixRequiredAfter !== null && fix.timestamp <= previousState.freshFixRequiredAfter) {
    return { state: previousState, events: [] };
  }

  // Validate coordinates and finite numbers
  if (!isValidCoordinate(fix)) {
    return { state: previousState, events: [], error: { code: "INVALID_INPUT", message: "Location coordinates are invalid" } };
  }

  if (
    typeof fix.accuracyMeters !== "number" ||
    !Number.isFinite(fix.accuracyMeters) ||
    fix.accuracyMeters < 0
  ) {
    return { state: previousState, events: [], error: { code: "INVALID_INPUT", message: "Location accuracy must be finite and non-negative" } };
  }

  // Validate optional speed
  if (fix.speedMetersPerSecond !== undefined) {
    if (
      typeof fix.speedMetersPerSecond !== "number" ||
      !Number.isFinite(fix.speedMetersPerSecond) ||
      fix.speedMetersPerSecond < 0
    ) {
      return { state: previousState, events: [], error: { code: "INVALID_INPUT", message: "Location speed must be finite and non-negative" } };
    }
  }

  // Validate optional heading
  if (fix.headingDegrees !== undefined) {
    if (
      typeof fix.headingDegrees !== "number" ||
      !Number.isFinite(fix.headingDegrees) ||
      fix.headingDegrees < 0 ||
      fix.headingDegrees > 360
    ) {
      return { state: previousState, events: [], error: { code: "INVALID_INPUT", message: "Location heading must be finite and within 0..360 degrees" } };
    }
  }

  // Validate optional receivedAt
  if (fix.receivedAt !== undefined) {
    if (
      typeof fix.receivedAt !== "number" ||
      !Number.isSafeInteger(fix.receivedAt)
    ) {
      return { state: previousState, events: [], error: { code: "INVALID_INPUT", message: "Location receivedAt must be finite" } };
    }
    if (fix.timestamp > fix.receivedAt + config.maxFutureFixSkewMs) {
      return { state: previousState, events: [], error: { code: "INVALID_INPUT", message: "Location capture timestamp is too far in the future" } };
    }
  }

  // Reject out-of-order or duplicate timestamps relative to last accepted reliable fix
  if (
    previousState.lastAcceptedFix !== null &&
    fix.timestamp <= previousState.lastAcceptedFix.timestamp
  ) {
    return { state: previousState, events: [] };
  }

  // Handle fix staleness via independent receivedAt (wall-clock latency)
  if (fix.receivedAt !== undefined) {
    const fixAgeMs = fix.receivedAt - fix.timestamp;
    if (fixAgeMs > config.maxFixStalenessMs) {
      const events: NavigationEvent[] = [];
      if (previousState.quality !== "degraded") {
        events.push({
          type: "gps_degraded",
          id: `gps_degraded:${fix.timestamp}:stale`,
          timestamp: fix.timestamp,
          accuracyMeters: fix.accuracyMeters,
          reason: "stale",
        });
      }
      // Stale fix: do not overwrite reliable lastAcceptedFix baseline
      return {
        state: { ...previousState, quality: "degraded" },
        events,
      };
    }
  }

  // Inaccurate GPS fix: degrade GPS, but do NOT replace reliable jump/projection baseline
  if (fix.accuracyMeters > config.maxAcceptableAccuracyMeters) {
    const events: NavigationEvent[] = [];
    if (previousState.quality !== "degraded") {
      events.push({
        type: "gps_degraded",
        id: `gps_degraded:${fix.timestamp}:inaccurate`,
        timestamp: fix.timestamp,
        accuracyMeters: fix.accuracyMeters,
        reason: "inaccurate",
      });
    }

    // Do NOT overwrite lastAcceptedFix with inaccurate data
    return {
      state: {
        ...previousState,
        quality: "degraded",
      },
      events,
    };
  }

  // Check elapsed time from previous reliable fix
  const elapsedSeconds =
    previousState.lastAcceptedFix !== null
      ? (fix.timestamp - previousState.lastAcceptedFix.timestamp) / 1000
      : undefined;

  // Interruption detection: if elapsed time > 30s, this is an interruption/recovery,
  // NOT a continuous single-second fix. Speed-based jump detection should not trigger.
  const isInterruptionRecovery =
    elapsedSeconds !== undefined &&
    elapsedSeconds > config.maxFixStalenessMs / 1000;

  // Implausible jump check for continuous fixes (displacement speed > maxPlausibleSpeed)
  if (
    previousState.lastAcceptedFix !== null &&
    elapsedSeconds !== undefined &&
    elapsedSeconds > 0 &&
    !isInterruptionRecovery
  ) {
    const displacement = distanceMeters(previousState.lastAcceptedFix, fix);
    if (displacement > 50) {
      const apparentSpeed = displacement / elapsedSeconds;
      if (apparentSpeed > config.maxPlausibleSpeedMetersPerSecond) {
        const events: NavigationEvent[] = [];
        if (previousState.quality !== "degraded") {
          events.push({
            type: "gps_degraded",
            id: `gps_degraded:${fix.timestamp}:jump`,
            timestamp: fix.timestamp,
            accuracyMeters: fix.accuracyMeters,
            reason: "implausible_jump",
          });
        }
        return {
          state: { ...previousState, quality: "degraded" },
          events,
        };
      }
    }
  }

  const events: NavigationEvent[] = [];

  // GPS recovered from degraded
  if (previousState.quality === "degraded") {
    events.push({
      type: "gps_recovered",
      id: `gps_recovered:${fix.timestamp}`,
      timestamp: fix.timestamp,
      accuracyMeters: fix.accuracyMeters,
    });
  }

  // Reliable fix baseline record
  const reliableRecord: AcceptedFixRecord = {
    timestamp: fix.timestamp,
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracyMeters: fix.accuracyMeters,
    ...(fix.speedMetersPerSecond !== undefined
      ? { speedMetersPerSecond: fix.speedMetersPerSecond }
      : {}),
    ...(fix.headingDegrees !== undefined
      ? { headingDegrees: fix.headingDegrees }
      : {}),
  };

  // Find candidate edges
  const candidateSearch = selectBestCandidate(
    ride,
    previousState,
    fix,
    config,
    isInterruptionRecovery,
  );
  if (candidateSearch.limitExceeded) {
    return {
      state: { ...previousState, quality: "unknown" },
      events: [],
      error: {
        code: "SEARCH_LIMIT",
        message: "Position match exceeded the per-fix candidate work budget; retry with the next location fix",
        workCount: candidateSearch.workCount,
      },
    };
  }
  const bestCandidate = candidateSearch.candidate;

  const lateralDistance = bestCandidate
    ? bestCandidate.lateralDistanceMeters
    : config.offRouteThresholdMeters + 50;

  // Off-route and rejoin hysteresis
  let isOffRoute = previousState.isOffRoute;
  let consecutiveOffRouteFixes = previousState.consecutiveOffRouteFixes;
  let consecutiveRejoinFixes = previousState.consecutiveRejoinFixes;

  if (lateralDistance > config.offRouteThresholdMeters) {
    consecutiveOffRouteFixes += 1;
    consecutiveRejoinFixes = 0;
    // Debounce controls warning only
    if (
      consecutiveOffRouteFixes >= config.offRouteConsecutiveFixes &&
      !isOffRoute
    ) {
      isOffRoute = true;
      events.push({
        type: "off_route",
        id: `off_route:${fix.timestamp}`,
        timestamp: fix.timestamp,
        lateralDistanceMeters: lateralDistance,
        lastProgressMeters: previousState.progressMeters,
      });
    }
  } else if (isOffRoute) {
    if (lateralDistance <= config.rejoinThresholdMeters) {
      consecutiveRejoinFixes += 1;
      consecutiveOffRouteFixes = 0;
      if (consecutiveRejoinFixes >= config.rejoinConsecutiveFixes) {
        isOffRoute = false;
        consecutiveOffRouteFixes = 0;
        const rejoinedProgress = bestCandidate
          ? bestCandidate.distanceAlongRideMeters
          : previousState.progressMeters;
        const rejoinedEdge = bestCandidate
          ? bestCandidate.edge.edgeIndex
          : previousState.currentEdgeIndex;
        const rejoinedSegment = bestCandidate
          ? bestCandidate.edge.segmentIndex
          : previousState.currentSegmentIndex;
        events.push({
          type: "rejoined",
          id: `rejoined:${fix.timestamp}`,
          timestamp: fix.timestamp,
          progressMeters: rejoinedProgress,
          segmentIndex: rejoinedSegment,
          edgeIndex: rejoinedEdge,
        });
      }
    } else {
      consecutiveRejoinFixes = 0;
    }
  } else {
    consecutiveOffRouteFixes = 0;
    consecutiveRejoinFixes = 0;
  }

  // Guidance Suppression:
  // During first 1-2 off-route fixes before hysteresis flips, suppress misleading
  // progress advancement, cues, and arrival immediately on poor match.
  const isPoorMatch =
    isOffRoute || lateralDistance > config.offRouteThresholdMeters;

  let progressMeters = previousState.progressMeters;
  let currentEdgeIndex = previousState.currentEdgeIndex;
  let currentSegmentIndex = previousState.currentSegmentIndex;

  if (bestCandidate && !isPoorMatch) {
    progressMeters = bestCandidate.distanceAlongRideMeters;
    currentEdgeIndex = bestCandidate.edge.edgeIndex;
    currentSegmentIndex = bestCandidate.edge.segmentIndex;
  }

  const remainingMeters = Math.max(0, ride.totalDistanceMeters - progressMeters);

  // Segment gap management
  let segmentGapState: SegmentGapState | null = previousState.segmentGapState;
  const currentSegment = ride.segments[currentSegmentIndex];

  if (currentSegment && currentSegment.gapToNextMeters !== null) {
    const distanceToEndOfSeg = currentSegment.endDistanceMeters - progressMeters;
    if (distanceToEndOfSeg <= 30) {
      if (!segmentGapState) {
        segmentGapState = {
          fromSegmentIndex: currentSegmentIndex,
          toSegmentIndex: currentSegmentIndex + 1,
          gapDistanceMeters: currentSegment.gapToNextMeters,
        };
        events.push({
          type: "segment_gap",
          id: `segment_gap:${fix.timestamp}:${currentSegmentIndex}`,
          timestamp: fix.timestamp,
          fromSegmentIndex: currentSegmentIndex,
          toSegmentIndex: currentSegmentIndex + 1,
          gapDistanceMeters: currentSegment.gapToNextMeters,
        });
      }
    } else {
      segmentGapState = null;
    }
  } else {
    segmentGapState = null;
  }

  // Maneuver and cue tracking
  const announcedCueIds = [...previousState.announcedCueIds];
  let nextManeuverIndex: number | null = null;
  let distanceToNextManeuverMeters: number | null = null;

  const forwardManeuver = ride.maneuvers.find(
    (m) => m.distanceAlongRideMeters >= progressMeters - 5,
  );
  const guidanceUnavailable = isGuidanceUnavailable(ride, currentSegmentIndex);
  if (guidanceUnavailable && (previousState.lastAcceptedFix === null || previousState.currentSegmentIndex !== currentSegmentIndex)) {
    events.push({ type: "guidance_unavailable", id: `guidance_unavailable:${fix.timestamp}:${currentSegmentIndex}`, timestamp: fix.timestamp, segmentIndex: currentSegmentIndex });
  }

  if (forwardManeuver) {
    nextManeuverIndex = forwardManeuver.maneuverIndex;
    distanceToNextManeuverMeters = Math.max(
      0,
      forwardManeuver.distanceAlongRideMeters - progressMeters,
    );

    // Guidance cues are emitted only when match is solid, not off route, and not in gap
    const crossesUnavailableSegment = hasUnavailableSegmentBetween(
      ride,
      progressMeters,
      forwardManeuver.distanceAlongRideMeters,
    );
    if (!isPoorMatch && !segmentGapState && !guidanceUnavailable && !crossesUnavailableSegment && !previousState.arrived) {
      const speed = fix.speedMetersPerSecond ?? 0;
      const effectiveUpcomingDistance = Math.max(
        config.upcomingCueDistanceMeters,
        speed * config.upcomingCueLookaheadSeconds,
      );
      const effectiveImmediateDistance = Math.max(
        config.immediateCueDistanceMeters,
        speed * config.immediateCueLookaheadSeconds,
      );

      const upcomingCueId = `${forwardManeuver.id}::${forwardManeuver.maneuverIndex}::upcoming`;
      const immediateCueId = `${forwardManeuver.id}::${forwardManeuver.maneuverIndex}::immediate`;

      // Upcoming cue
      if (
        distanceToNextManeuverMeters <= effectiveUpcomingDistance &&
        distanceToNextManeuverMeters > effectiveImmediateDistance
      ) {
        if (!announcedCueIds.includes(upcomingCueId)) {
          announcedCueIds.push(upcomingCueId);
          const upcomingEvent: UpcomingManeuverEvent = {
            type: "upcoming_maneuver",
            id: upcomingCueId,
            timestamp: fix.timestamp,
            maneuver: forwardManeuver,
            distanceToManeuverMeters: distanceToNextManeuverMeters,
          };
          events.push(upcomingEvent);
        }
      }

      // Immediate cue
      if (distanceToNextManeuverMeters <= effectiveImmediateDistance) {
        if (!announcedCueIds.includes(immediateCueId)) {
          announcedCueIds.push(immediateCueId);
          const immediateEvent: ImmediateManeuverEvent = {
            type: "immediate_maneuver",
            id: immediateCueId,
            timestamp: fix.timestamp,
            maneuver: forwardManeuver,
            distanceToManeuverMeters: distanceToNextManeuverMeters,
          };
          events.push(immediateEvent);
        }
      }
    }
  }

  // Arrival detection (suppressed immediately on poor match)
  let arrived = previousState.arrived;
  const isFinalSegment =
    currentSegmentIndex === ride.segments.length - 1;
  const isWithinArrivalTolerance =
    remainingMeters <= config.arrivalToleranceMeters &&
    progressMeters >= ride.totalDistanceMeters - config.arrivalToleranceMeters;

  const isInitialFix = previousState.lastAcceptedFix === null;
  const canArrive =
    !isInitialFix || ride.totalDistanceMeters <= config.arrivalToleranceMeters;

  if (
    !arrived &&
    isFinalSegment &&
    isWithinArrivalTolerance &&
    canArrive &&
    !isPoorMatch
  ) {
    arrived = true;
    events.push({
      type: "arrival",
      id: `arrival:${fix.timestamp}`,
      timestamp: fix.timestamp,
      totalDistanceMeters: ride.totalDistanceMeters,
    });
  }

  const newState: NavigationState = {
    routeId: ride.routeId,
    rideVersion: 1,
    lifecycle: "active",
    lifecycleTimestamp: previousState.lifecycleTimestamp,
    freshFixRequiredAfter: previousState.freshFixRequiredAfter,
    quality: "good",
    currentSegmentIndex,
    currentEdgeIndex,
    progressMeters,
    remainingMeters,
    lateralDistanceMeters: lateralDistance,
    nextManeuverIndex,
    distanceToNextManeuverMeters,
    lastAcceptedFix: reliableRecord,
    consecutiveOffRouteFixes,
    consecutiveRejoinFixes,
    isOffRoute,
    announcedCueIds,
    arrived,
    segmentGapState,
  };

  return { state: newState, events };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUnavailableSegmentBetween(
  ride: PreparedNavigationRide,
  startDistanceMeters: number,
  endDistanceMeters: number,
): boolean {
  const from = Math.min(startDistanceMeters, endDistanceMeters) - 1e-6;
  const to = Math.max(startDistanceMeters, endDistanceMeters) + 1e-6;
  let low = 0;
  let high = ride.segments.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ride.segments[mid]!.endDistanceMeters < from) low = mid + 1;
    else high = mid;
  }
  const firstSegment = low;
  low = firstSegment;
  high = ride.segments.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ride.segments[mid]!.startDistanceMeters <= to) low = mid + 1;
    else high = mid;
  }
  const afterLastSegment = low;
  low = 0;
  high = ride.guidanceUnavailableSegmentIndices.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ride.guidanceUnavailableSegmentIndices[mid]! < firstSegment) low = mid + 1;
    else high = mid;
  }
  return low < ride.guidanceUnavailableSegmentIndices.length && ride.guidanceUnavailableSegmentIndices[low]! < afterLastSegment;
}

function isGuidanceUnavailable(ride: PreparedNavigationRide, segmentIndex: number): boolean {
  let low = 0;
  let high = ride.guidanceUnavailableSegmentIndices.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ride.guidanceUnavailableSegmentIndices[mid]! < segmentIndex) low = mid + 1;
    else high = mid;
  }
  return ride.guidanceUnavailableSegmentIndices[low] === segmentIndex;
}

function selectBestCandidate(
  ride: PreparedNavigationRide,
  state: NavigationState,
  fix: LocationFixInput,
  config: NavigationConfig,
  isInterruptionRecovery: boolean,
): CandidateSearchResult {
  let workCount = 0;
  const spend = (): boolean => {
    if (workCount >= config.maxCandidateWorkPerFix) return false;
    workCount++;
    return true;
  };
  const exceeded = (): CandidateSearchResult => ({ candidate: null, workCount, limitExceeded: true });
  const isInitialFix = state.lastAcceptedFix === null;
  const elapsedSeconds =
    state.lastAcceptedFix && !isInterruptionRecovery
      ? (fix.timestamp - state.lastAcceptedFix.timestamp) / 1000
      : undefined;

  // On initial fix, bound candidate search to the beginning of the route
  // to avoid jumping to loop finish or out-and-back return leg.
  if (isInitialFix) {
    const firstSegment = ride.segments[0];
    if (!firstSegment) return { candidate: null, workCount, limitExceeded: false };

    // Check first 30 edges of segment 0
    const maxEdge = Math.min(firstSegment.endEdgeIndex, firstSegment.startEdgeIndex + 30);
    let bestCandidate: EvaluatedCandidate | null = null;
    for (let e = firstSegment.startEdgeIndex; e <= maxEdge; e++) {
      if (!spend()) return exceeded();
      const edge = ride.edges[e];
      if (!edge) continue;
      if (!spend()) return exceeded();
      const candidate = evaluateCandidate(edge, fix, 0, config, undefined, false);
      if (!bestCandidate || candidate.score < bestCandidate.score) {
        bestCandidate = candidate;
      }
    }
    return { candidate: bestCandidate, workCount, limitExceeded: false };
  }

  // Route-distance bounded window:
  // Instead of a fixed 26-edge index count which fails on dense GPX points,
  // walk backward and forward along route distance from current progress.
  const backwardEdges: PreparedEdge[] = [];
  const minDist = state.progressMeters - config.maxLocalSearchDistanceBackwardMeters;
  const maxForward = Math.max(
    config.maxLocalSearchDistanceForwardMeters,
    (fix.speedMetersPerSecond ?? 10) * 15,
  );
  const maxDist = state.progressMeters + maxForward;

  // Walk backward
  let backIdx = state.currentEdgeIndex;
  while (backIdx >= 0) {
    if (!spend()) return exceeded();
    const edge = ride.edges[backIdx];
    if (!edge) break;
    if (edge.endDistanceMeters < minDist && backIdx < state.currentEdgeIndex - 5) {
      break;
    }
    backwardEdges.push(edge);
    backIdx--;
  }

  const localEdges = backwardEdges.reverse();

  // Walk forward
  let fwdIdx = state.currentEdgeIndex + 1;
  while (fwdIdx < ride.edges.length) {
    if (!spend()) return exceeded();
    const edge = ride.edges[fwdIdx];
    if (!edge) break;
    if (edge.startDistanceMeters > maxDist && fwdIdx > state.currentEdgeIndex + 5) {
      break;
    }
    localEdges.push(edge);
    fwdIdx++;
  }

  let bestLocal: EvaluatedCandidate | null = null;
  for (const edge of localEdges) {
    if (!spend()) return exceeded();
    const candidate = evaluateCandidate(
      edge,
      fix,
      state.progressMeters,
      config,
      elapsedSeconds,
      isInterruptionRecovery,
    );
    if (!bestLocal || candidate.score < bestLocal.score) {
      bestLocal = candidate;
    }
  }

  // Robust directional and continuity validation before accepting local candidate:
  // Must have good lateral distance, aligned direction, and plausible progress delta.
  const hasDirectionalMatch =
    bestLocal &&
    (bestLocal.headingDiff === null ||
      bestLocal.headingDiff <= config.headingToleranceDegrees);

  const hasPlausibleDelta =
    bestLocal &&
    bestLocal.deltaProgress >= -config.maxProjectionJumpBackwardMeters &&
    bestLocal.deltaProgress <=
      (elapsedSeconds !== undefined && elapsedSeconds > 0
        ? Math.max(
            config.maxProjectionJumpForwardMeters,
            elapsedSeconds * config.maxPlausibleSpeedMetersPerSecond,
          )
        : config.maxProjectionJumpForwardMeters);

  if (
    !isInterruptionRecovery &&
    bestLocal &&
    bestLocal.lateralDistanceMeters <= config.offRouteThresholdMeters &&
    hasDirectionalMatch &&
    hasPlausibleDelta
  ) {
    return { candidate: bestLocal, workCount, limitExceeded: false };
  }

  // Fallback / Interruption recovery: query 2D spatial grid index to find correct branch or rejoin point
  const spatialQuery = queryCandidateEdgeIndicesBounded(
    ride.spatialIndex,
    fix.latitude,
    fix.longitude,
    config.candidateSearchRadiusMeters,
    config.maxCandidateWorkPerFix - workCount,
  );
  workCount += spatialQuery.workCount;
  if (spatialQuery.limitExceeded) return exceeded();

  let bestGlobal: EvaluatedCandidate | null = isInterruptionRecovery ? null : bestLocal;
  for (const edgeIndex of spatialQuery.edgeIndices) {
    if (!spend()) return exceeded();
    const edge = ride.edges[edgeIndex];
    if (!edge) continue;
    const candidate = evaluateCandidate(
      edge,
      fix,
      state.progressMeters,
      config,
      elapsedSeconds,
      isInterruptionRecovery,
    );
    if (!bestGlobal || candidate.score < bestGlobal.score) {
      bestGlobal = candidate;
    }
  }

  return { candidate: bestGlobal ?? bestLocal, workCount, limitExceeded: false };
}

function evaluateCandidate(
  edge: PreparedEdge,
  fix: LocationFixInput,
  previousProgress: number,
  config: NavigationConfig,
  elapsedSeconds?: number,
  isInterruptionRecovery = false,
): EvaluatedCandidate {
  const proj = projectPointOnEdge(fix, edge);
  const deltaProgress = proj.distanceAlongRideMeters - previousProgress;

  let progressPenalty = 0;
  if (!isInterruptionRecovery) {
    const maxAllowedForward =
      elapsedSeconds !== undefined && elapsedSeconds > 0
        ? Math.max(
            config.maxProjectionJumpForwardMeters,
            elapsedSeconds * config.maxPlausibleSpeedMetersPerSecond,
          )
        : config.maxProjectionJumpForwardMeters;

    if (deltaProgress >= 0) {
      if (deltaProgress > maxAllowedForward) {
        progressPenalty = (deltaProgress - maxAllowedForward) * 1.5;
      }
    } else {
      // Backward progress (reversal)
      const backwardDist = -deltaProgress;
      if (backwardDist <= config.maxProjectionJumpBackwardMeters) {
        // Modest penalty for small backward adjustments
        progressPenalty = backwardDist * 0.15;
      } else {
        progressPenalty =
          (backwardDist - config.maxProjectionJumpBackwardMeters) * 2;
      }
    }
  }

  let headingDiff: number | null = null;
  let headingPenalty = 0;
  if (fix.headingDegrees !== undefined) {
    // When moving backward along the route (deltaProgress < 0), expected heading
    // is aligned with backward motion (edge.bearingDegrees + 180)
    const expectedBearing =
      deltaProgress < -5
        ? (edge.bearingDegrees + 180) % 360
        : edge.bearingDegrees;

    headingDiff = headingDifferenceDegrees(
      fix.headingDegrees,
      expectedBearing,
    );
    if (headingDiff > config.headingToleranceDegrees) {
      if (headingDiff > 90) {
        // Strongly penalize opposing direction (e.g. out-and-back wrong branch)
        headingPenalty = (headingDiff - config.headingToleranceDegrees) * 2.0 + 80;
      } else {
        headingPenalty = (headingDiff - config.headingToleranceDegrees) * 0.5;
      }
    }
  }

  const score = proj.lateralDistanceMeters + progressPenalty + headingPenalty;

  return {
    edge,
    fraction: proj.fraction,
    lateralDistanceMeters: proj.lateralDistanceMeters,
    distanceAlongRideMeters: proj.distanceAlongRideMeters,
    distanceAlongSegmentMeters: proj.distanceAlongSegmentMeters,
    score,
    headingDiff,
    deltaProgress,
  };
}
