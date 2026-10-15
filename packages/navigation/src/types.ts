import type { Coordinate } from "@ride-maker/domain";

/**
 * Units used throughout this package:
 * - Distances: meters (number, >= 0)
 * - Durations / Elapsed time: seconds (number)
 * - Timestamps: epoch milliseconds (number, integer)
 * - Speeds: meters per second (number, >= 0)
 * - Bearings / Headings: decimal degrees (number, 0 <= heading < 360, clockwise from true North)
 * - Coordinates: decimal degrees (latitude: -90..90, longitude: -180..180)
 */

export type PreparedPoint = Coordinate & {
  readonly pointIndex: number;
  readonly elevationMeters?: number;
  readonly time?: string;
  readonly distanceAlongSegmentMeters: number;
  readonly distanceAlongRideMeters: number;
};

export type BoundingBox = {
  readonly minLatitude: number;
  readonly maxLatitude: number;
  readonly minLongitude: number;
  readonly maxLongitude: number;
};

export type PreparedEdge = {
  readonly edgeIndex: number;
  readonly segmentIndex: number;
  readonly startPointIndex: number;
  readonly endPointIndex: number;
  readonly start: PreparedPoint;
  readonly end: PreparedPoint;
  readonly startDistanceMeters: number;
  readonly endDistanceMeters: number;
  readonly lengthMeters: number;
  readonly bearingDegrees: number;
  readonly boundingBox: BoundingBox;
};

export type PreparedSegment = {
  readonly id: string;
  readonly segmentIndex: number;
  readonly startDistanceMeters: number;
  readonly endDistanceMeters: number;
  readonly lengthMeters: number;
  readonly points: readonly PreparedPoint[];
  readonly startEdgeIndex: number;
  readonly endEdgeIndex: number; // inclusive
  readonly gapToNextMeters: number | null;
};

export type PreparedManeuver = Coordinate & {
  readonly id: string;
  readonly maneuverIndex: number;
  readonly segmentIndex: number;
  readonly shapeIndex: number;
  readonly edgeIndex: number;
  readonly distanceAlongSegmentMeters: number;
  readonly distanceAlongRideMeters: number;
  readonly instruction: string;
  readonly verbalInstruction?: string;
};

export type SpatialGridIndex = {
  readonly cellSizeDegrees: number;
  readonly cells: ReadonlyMap<string, readonly number[]>;
};

export type PreparedNavigationRide = {
  readonly version: 1;
  readonly routeId: string;
  readonly routeName: string;
  readonly totalDistanceMeters: number;
  readonly segments: readonly PreparedSegment[];
  readonly edges: readonly PreparedEdge[];
  readonly maneuvers: readonly PreparedManeuver[];
  readonly spatialIndex: SpatialGridIndex;
  /** Segments whose provider supplied geometry is retained without turn guidance. */
  readonly guidanceUnavailableSegmentIndices: readonly number[];
};

export type PrepareRideErrorCode =
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_COORDINATE"
  | "DEGENERATE_GEOMETRY"
  | "EMPTY_SEGMENT"
  | "INVALID_MANEUVER_REFERENCE"
  | "INVALID_MANEUVER_INSTRUCTION"
  | "COORDINATE_MISMATCH"
  | "NO_MANEUVERS"
  | "UNSUPPORTED_GEOMETRY";

export type PrepareRideError = {
  readonly code: PrepareRideErrorCode;
  readonly message: string;
  readonly details?: {
    readonly segmentIndex?: number;
    readonly pointIndex?: number;
    readonly maneuverId?: string;
    readonly maneuverIndex?: number;
  };
};

export type PrepareNavigationRideResult =
  | { readonly ok: true; readonly ride: PreparedNavigationRide }
  | { readonly ok: false; readonly error: PrepareRideError };

export type NavigationLifecycle = "active" | "paused" | "ended";

export type GpsQuality = "unknown" | "good" | "degraded";

export type AcceptedFixRecord = {
  readonly timestamp: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
  readonly speedMetersPerSecond?: number;
  readonly headingDegrees?: number;
};

export type SegmentGapState = {
  readonly fromSegmentIndex: number;
  readonly toSegmentIndex: number;
  readonly gapDistanceMeters: number;
};

/**
 * Serializable state representing runtime navigation progress.
 * All fields are plain serializable values that survive JSON round-trip.
 */
export type NavigationState = {
  readonly routeId: string;
  readonly rideVersion: 1;
  readonly lifecycle: NavigationLifecycle;
  readonly lifecycleTimestamp: number;
  readonly freshFixRequiredAfter: number | null;
  readonly quality: GpsQuality;
  readonly currentSegmentIndex: number;
  readonly currentEdgeIndex: number;
  readonly progressMeters: number;
  readonly remainingMeters: number;
  readonly lateralDistanceMeters: number;
  readonly nextManeuverIndex: number | null;
  readonly distanceToNextManeuverMeters: number | null;
  readonly lastAcceptedFix: AcceptedFixRecord | null;
  readonly consecutiveOffRouteFixes: number;
  readonly consecutiveRejoinFixes: number;
  readonly isOffRoute: boolean;
  readonly announcedCueIds: readonly string[];
  readonly arrived: boolean;
  readonly segmentGapState: SegmentGapState | null;
};

export type LocationFixInput = {
  readonly type: "location_fix";
  readonly timestamp: number;
  readonly receivedAt?: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
  readonly speedMetersPerSecond?: number;
  readonly headingDegrees?: number;
};

export type PauseInput = {
  readonly type: "pause";
  readonly timestamp: number;
};

export type ResumeInput = {
  readonly type: "resume";
  readonly timestamp: number;
};

export type EndInput = {
  readonly type: "end";
  readonly timestamp: number;
};

export type RepeatInstructionInput = {
  readonly type: "repeat_instruction";
  readonly timestamp: number;
};

export type NavigationInput =
  | LocationFixInput
  | PauseInput
  | ResumeInput
  | EndInput
  | RepeatInstructionInput;

export type UpcomingManeuverEvent = {
  readonly type: "upcoming_maneuver";
  readonly id: string;
  readonly timestamp: number;
  readonly maneuver: PreparedManeuver;
  readonly distanceToManeuverMeters: number;
};

export type ImmediateManeuverEvent = {
  readonly type: "immediate_maneuver";
  readonly id: string;
  readonly timestamp: number;
  readonly maneuver: PreparedManeuver;
  readonly distanceToManeuverMeters: number;
};

export type OffRouteEvent = {
  readonly type: "off_route";
  readonly id: string;
  readonly timestamp: number;
  readonly lateralDistanceMeters: number;
  readonly lastProgressMeters: number;
};

export type RejoinedEvent = {
  readonly type: "rejoined";
  readonly id: string;
  readonly timestamp: number;
  readonly progressMeters: number;
  readonly segmentIndex: number;
  readonly edgeIndex: number;
};

export type GpsDegradedEvent = {
  readonly type: "gps_degraded";
  readonly id: string;
  readonly timestamp: number;
  readonly accuracyMeters: number;
  readonly reason: "inaccurate" | "stale" | "implausible_jump";
};

export type GpsRecoveredEvent = {
  readonly type: "gps_recovered";
  readonly id: string;
  readonly timestamp: number;
  readonly accuracyMeters: number;
};

export type SegmentGapEvent = {
  readonly type: "segment_gap";
  readonly id: string;
  readonly timestamp: number;
  readonly fromSegmentIndex: number;
  readonly toSegmentIndex: number;
  readonly gapDistanceMeters: number;
};

export type GuidanceUnavailableEvent = {
  readonly type: "guidance_unavailable";
  readonly id: string;
  readonly timestamp: number;
  readonly segmentIndex: number;
};

export type ArrivalEvent = {
  readonly type: "arrival";
  readonly id: string;
  readonly timestamp: number;
  readonly totalDistanceMeters: number;
};

export type InstructionRepeatedEvent = {
  readonly type: "instruction_repeated";
  readonly id: string;
  readonly timestamp: number;
  readonly maneuver: PreparedManeuver | null;
  readonly distanceToManeuverMeters: number | null;
  readonly suppressionReason?: "off_route" | "segment_gap" | "degraded_gps" | "no_fix" | "paused" | "unavailable";
};

export type LifecycleChangedEvent = {
  readonly type: "lifecycle_changed";
  readonly id: string;
  readonly timestamp: number;
  readonly previousLifecycle: NavigationLifecycle;
  readonly currentLifecycle: NavigationLifecycle;
};

export type NavigationEvent =
  | UpcomingManeuverEvent
  | ImmediateManeuverEvent
  | OffRouteEvent
  | RejoinedEvent
  | GpsDegradedEvent
  | GpsRecoveredEvent
  | SegmentGapEvent
  | GuidanceUnavailableEvent
  | ArrivalEvent
  | InstructionRepeatedEvent
  | LifecycleChangedEvent;

export type NavigationResult = {
  readonly state: NavigationState;
  readonly events: readonly NavigationEvent[];
  readonly error?: NavigationRuntimeError;
};

export type NavigationRuntimeError = {
  readonly code: "INVALID_RIDE" | "INVALID_STATE" | "INVALID_INPUT" | "INVALID_CONFIG" | "SEARCH_LIMIT";
  readonly message: string;
  readonly workCount?: number;
};

export type NavigationConfig = {
  readonly maxAcceptableAccuracyMeters: number;
  readonly maxPlausibleSpeedMetersPerSecond: number;
  readonly maxFixStalenessMs: number;
  readonly offRouteThresholdMeters: number;
  readonly offRouteConsecutiveFixes: number;
  readonly rejoinThresholdMeters: number;
  readonly rejoinConsecutiveFixes: number;
  readonly upcomingCueDistanceMeters: number;
  readonly upcomingCueLookaheadSeconds: number;
  readonly immediateCueDistanceMeters: number;
  readonly immediateCueLookaheadSeconds: number;
  readonly arrivalToleranceMeters: number;
  readonly headingToleranceDegrees: number;
  readonly maxProjectionJumpForwardMeters: number;
  readonly maxProjectionJumpBackwardMeters: number;
  readonly candidateSearchRadiusMeters: number;
  readonly maxLocalSearchDistanceForwardMeters: number;
  readonly maxLocalSearchDistanceBackwardMeters: number;
  /** Maximum deterministic enumeration and projection work units for one fix. */
  readonly maxCandidateWorkPerFix: number;
  /** Allowed capture clock skew when comparing timestamp with receivedAt. */
  readonly maxFutureFixSkewMs: number;
};

export const DEFAULT_NAVIGATION_CONFIG: NavigationConfig = {
  maxAcceptableAccuracyMeters: 30,
  maxPlausibleSpeedMetersPerSecond: 40,
  maxFixStalenessMs: 30_000,
  offRouteThresholdMeters: 35,
  offRouteConsecutiveFixes: 3,
  rejoinThresholdMeters: 20,
  rejoinConsecutiveFixes: 2,
  upcomingCueDistanceMeters: 150,
  upcomingCueLookaheadSeconds: 15,
  immediateCueDistanceMeters: 30,
  immediateCueLookaheadSeconds: 3,
  arrivalToleranceMeters: 25,
  headingToleranceDegrees: 60,
  maxProjectionJumpForwardMeters: 300,
  maxProjectionJumpBackwardMeters: 80,
  candidateSearchRadiusMeters: 120,
  maxLocalSearchDistanceForwardMeters: 250,
  maxLocalSearchDistanceBackwardMeters: 80,
  maxCandidateWorkPerFix: 20_000,
  maxFutureFixSkewMs: 5_000,
};
