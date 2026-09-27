import type { ControlPoint, Maneuver, RoutePoint, RoutingProfile } from "@ride-maker/domain";

export type RouteRequest = {
  controlPoints: ControlPoint[];
  profile: RoutingProfile;
  signal?: AbortSignal;
};

export type RoutedPath = {
  segments: RoutePoint[][];
  maneuvers: Maneuver[];
  distanceMeters: number;
  durationSeconds: number;
  engine: string;
  engineVersion?: string;
};

export interface RoutingProvider {
  route(request: RouteRequest): Promise<RoutedPath>;
}

export class RoutingError extends Error {
  override name = "RoutingError";
}
