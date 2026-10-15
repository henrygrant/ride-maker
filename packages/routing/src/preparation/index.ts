export {
  assessBidirectionalDeviations,
  bearing,
  findCriticalAnchors,
  haversineDistance,
  headingChange,
  pointToPolylineDistance,
  pointToSegmentDistance,
  polylineDistance,
  samplePolyline,
  simplifyPolylineWithAnchors,
  simplifyPolylineWithAnchorsAndIndices,
  GeometryWorkLimitError,
  PolylineEdgeIndex,
  type DeviationAssessmentResult,
} from "./geo";

export {
  DEFAULT_PREPARATION_THRESHOLDS,
  type CoverageFacts,
  type DeviationFacts,
  type LocationBearingWarning,
  type PerSourceSegmentReview,
  type OutputCoverage,
  type OutputSourceInterval,
  type PreparationReviewMetadata,
  type PreparationStatus,
  type PreparationThresholds,
  type PrepareGpxOptions,
  type PreparedRouteResult,
  type TraceDiscontinuity,
  type TraceMatchedSegment,
  type TraceMatchingProvider,
  type TraceMatchRequest,
  type TraceMatchResult,
  type WarningCode,
  type WarningSeverity,
} from "./types";

export {
  ValhallaTraceMatchingProvider,
  type ValhallaTraceAdapterOptions,
} from "./valhalla-trace-adapter";

export {
  matchTraceWithChunking,
  reconcileChunkSeam,
  type ChunkMatchResult,
  type SeamReconcileResult,
} from "./chunking";

export {
  assessPreparation,
  detectSparseRoute,
  type AssessmentResult,
} from "./assessment";

export { prepareGpxRoute } from "./prepare";
