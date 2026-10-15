import type {
  Coordinate,
  Maneuver,
  RouteDocument,
  RoutePoint,
  RoutingProfile,
} from "@ride-maker/domain";

export type WarningCode =
  | "unmatched_section"
  | "high_deviation"
  | "sparse_route"
  | "discontinuity"
  | "chunk_seam_unresolved"
  | "reversed_path"
  | "geometry_mismatch"
  | "validation_error";

export type WarningSeverity = "info" | "warning" | "error";

export type LocationBearingWarning = {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
  coordinate: Coordinate;
  sourceSegmentIndex?: number | undefined;
  distanceAlongTraceMeters?: number | undefined;
  distanceMeters?: number | undefined;
};

export type DeviationFacts = {
  maxDeviationMeters: number;
  p50DeviationMeters: number;
  p95DeviationMeters: number;
  sourceToMatchedMaxMeters: number;
  matchedToSourceMaxMeters: number;
  /** Conservative maximum-distance uncertainty from bounded edge interpolation. */
  samplingErrorBudgetMeters: number;
};

export type CoverageFacts = {
  sourceDistanceMeters: number;
  matchedDistanceMeters: number;
  unmatchedDistanceMeters: number;
  coverageRatio: number;
};

export type PerSourceSegmentReview = {
  sourceSegmentIndex: number;
  sourcePointsCount: number;
  sourceDistanceMeters: number;
  matched: boolean;
  outputSegmentIndices: number[];
  coverageRatio: number;
};

/** Source-progress coverage assigned to one output segment. Point bounds are inclusive. */
export type OutputCoverage = {
  outputSegmentIndex: number;
  sourceSegmentIndex: number;
  sourceInterval: {
    startDistanceMeters: number;
    endDistanceMeters: number;
    startPointIndex: number;
    endPointIndex: number;
  };
  guidanceAvailable: boolean;
  matched: boolean;
};

export type OutputSourceInterval = {
  outputSegmentIndex: number;
  startPointIndex: number;
  endPointIndex: number;
  matched: boolean;
  guidanceAvailable: boolean;
};

export type PreparationStatus = "ready" | "partial" | "needs-choice" | "failed";

export type PreparationThresholds = {
  /** Maximum allowable deviation between source and matched geometry for 'ready' status (meters) */
  maxAllowedDeviationMeters: number;
  /** Deviation threshold triggering a warning (meters) */
  warningDeviationMeters: number;
  /** Minimum coverage ratio (matched / source distance) required for 'ready' status */
  minReadyCoverageRatio: number;
  /** Minimum coverage ratio below which preparation is marked 'failed' */
  minPartialCoverageRatio: number;
  /** Average point spacing threshold indicating a sparse planned route rather than recorded track (meters) */
  maxSparsePointSpacingMeters: number;
  /** Maximum perpendicular error budget for Douglas-Peucker simplification (meters) */
  simplificationToleranceMeters: number;
  /** Maximum number of points sent in a single chunk to the trace matching endpoint */
  maxChunkPoints: number;
  /** Number of overlapping points between adjacent chunks */
  chunkOverlapPoints: number;
  /** Maximum concurrent network requests to the matching provider */
  maxConcurrentRequests: number;
  /** Network timeout for trace matching requests (ms) */
  requestTimeoutMs: number;
};

export const DEFAULT_PREPARATION_THRESHOLDS: PreparationThresholds = {
  maxAllowedDeviationMeters: 50,
  warningDeviationMeters: 25,
  minReadyCoverageRatio: 0.95,
  minPartialCoverageRatio: 0.5,
  maxSparsePointSpacingMeters: 500,
  simplificationToleranceMeters: 2.0,
  maxChunkPoints: 800,
  chunkOverlapPoints: 50,
  maxConcurrentRequests: 2,
  requestTimeoutMs: 15_000,
};

export type PreparationReviewMetadata = {
  version: 1;
  sourceId: string;
  sourceKind: string;
  filename?: string | undefined;
  status: PreparationStatus;
  perSourceSegment: PerSourceSegmentReview[];
  outputCoverage: OutputCoverage[];
  coverage: CoverageFacts;
  deviations: DeviationFacts;
  warnings: LocationBearingWarning[];
  engineeringThresholds: PreparationThresholds;
};

export type TraceMatchRequest = {
  points: RoutePoint[];
  profile: RoutingProfile;
  signal?: AbortSignal | undefined;
};

export type TraceMatchedSegment = {
  points: RoutePoint[];
  maneuvers: Maneuver[];
  distanceMeters: number;
  durationSeconds: number;
  matched?: boolean | undefined;
};

export type TraceDiscontinuity = {
  fromMatchedIndex: number;
  toMatchedIndex: number;
  reason?: string | undefined;
};

export type TraceMatchResult = {
  matchedSegments: TraceMatchedSegment[];
  discontinuities: TraceDiscontinuity[];
  engine: string;
  engineVersion?: string | undefined;
  rawAttributes?: unknown;
};

export interface TraceMatchingProvider {
  matchTrace(request: TraceMatchRequest): Promise<TraceMatchResult>;
}

export type PrepareGpxOptions = {
  profile?: RoutingProfile | undefined;
  thresholds?: Partial<PreparationThresholds> | undefined;
  signal?: AbortSignal | undefined;
  /**
   * If true, allows routing inference on sparse route-only GPX points.
   * If false or undefined, sparse route inputs return a 'needs-choice' status.
   */
  allowSparseRouteInference?: boolean | undefined;
};

export type PreparedRouteResult = {
  document: RouteDocument;
  metadata: PreparationReviewMetadata;
};
