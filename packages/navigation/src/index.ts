export {
  distanceMeters,
  bearingDegrees,
  headingDifferenceDegrees,
  isValidCoordinate,
  projectPointOnEdge,
  type EdgeProjectionResult,
} from "./geo.js";

export { prepareNavigationRide, type PrepareNavigationRideOptions } from "./prepare-ride.js";

export { createNavigationState } from "./navigation-state.js";

export { reduceNavigation } from "./navigation-reducer.js";

export {
  queryCandidateEdgeIndices,
} from "./spatial-index.js";

export {
  DEFAULT_NAVIGATION_CONFIG,
  type AcceptedFixRecord,
  type ArrivalEvent,
  type BoundingBox,
  type EndInput,
  type GpsDegradedEvent,
  type GpsQuality,
  type GpsRecoveredEvent,
  type GuidanceUnavailableEvent,
  type ImmediateManeuverEvent,
  type InstructionRepeatedEvent,
  type LifecycleChangedEvent,
  type LocationFixInput,
  type NavigationConfig,
  type NavigationEvent,
  type NavigationInput,
  type NavigationLifecycle,
  type NavigationResult,
  type NavigationRuntimeError,
  type NavigationState,
  type OffRouteEvent,
  type PauseInput,
  type PreparedEdge,
  type PreparedManeuver,
  type PreparedNavigationRide,
  type PreparedPoint,
  type PreparedSegment,
  type PrepareNavigationRideResult,
  type PrepareRideError,
  type PrepareRideErrorCode,
  type RejoinedEvent,
  type RepeatInstructionInput,
  type ResumeInput,
  type SegmentGapEvent,
  type SegmentGapState,
  type SpatialGridIndex,
  type UpcomingManeuverEvent,
} from "./types.js";
