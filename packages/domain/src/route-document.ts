export const ROUTE_DOCUMENT_SCHEMA_VERSION = 1 as const;

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type RoutePoint = Coordinate & {
  elevationMeters?: number;
  time?: string;
};

export type RouteSegment = {
  id: string;
  points: RoutePoint[];
};

export type ControlPointKind = "start" | "finish" | "via" | "shaping";

export type ControlPoint = Coordinate & {
  id: string;
  kind: ControlPointKind;
  name?: string;
  elevationMeters?: number;
};

export type RouteWaypoint = Coordinate & {
  id: string;
  name?: string;
  description?: string;
  elevationMeters?: number;
};

export type Maneuver = Coordinate & {
  id: string;
  segmentIndex: number;
  shapeIndex: number;
  instruction: string;
  verbalInstruction?: string;
};

export type RoutingProfile = "road" | "gravel" | "mountain";

export type RouteSource =
  | { kind: "new" }
  | {
      kind: "gpx";
      filename?: string;
      creator?: string;
    };

export type RouteDocument = {
  schemaVersion: typeof ROUTE_DOCUMENT_SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  source: RouteSource;
  segments: RouteSegment[];
  controlPoints: ControlPoint[];
  waypoints: RouteWaypoint[];
  maneuvers: Maneuver[];
  summary?: {
    distanceMeters: number;
    durationSeconds: number;
  };
  routing?: {
    profile: RoutingProfile;
    engine: string;
    engineVersion?: string;
  };
};

export type CreateRouteDocumentOptions = {
  id?: string;
  name?: string;
};

export function createRouteDocument(
  options: CreateRouteDocumentOptions = {},
): RouteDocument {
  return {
    schemaVersion: ROUTE_DOCUMENT_SCHEMA_VERSION,
    id: options.id ?? createId("route"),
    name: options.name ?? "Untitled route",
    source: { kind: "new" },
    segments: [],
    controlPoints: [],
    waypoints: [],
    maneuvers: [],
  };
}

export function createId(prefix: string): string {
  const cryptoApi = (
    globalThis as typeof globalThis & {
      crypto?: { randomUUID?: () => string };
    }
  ).crypto;
  const suffix =
    cryptoApi?.randomUUID === undefined
      ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      : cryptoApi.randomUUID();

  return `${prefix}-${suffix}`;
}
