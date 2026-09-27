import { createId } from "@ride-maker/domain";
import { decodePolyline6 } from "./polyline";
import { RoutingError, type RoutedPath, type RouteRequest, type RoutingProvider } from "./types";

type ValhallaResponse = {
  trip?: {
    summary: { length: number; time: number };
    legs: Array<{
      shape: string;
      maneuvers?: Array<{
        begin_shape_index: number;
        instruction: string;
        verbal_pre_transition_instruction?: string;
      }>;
    }>;
  };
  error?: string;
};

export class ValhallaRoutingProvider implements RoutingProvider {
  constructor(private readonly endpoint = "https://valhalla1.openstreetmap.de/route") {}

  async route(request: RouteRequest): Promise<RoutedPath> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": "ride-maker-local-development" },
      body: JSON.stringify({
        locations: request.controlPoints.map((point, index) => ({
          lat: point.latitude,
          lon: point.longitude,
          type: index === 0 || index === request.controlPoints.length - 1 ? "break" : "through",
        })),
        costing: "bicycle",
        costing_options: { bicycle: { bicycle_type: bicycleType(request.profile) } },
        directions_options: { units: "kilometers", language: "en-US" },
      }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const data = (await response.json()) as ValhallaResponse;
    if (!response.ok || data.trip === undefined) {
      throw new RoutingError(data.error ?? `Routing failed (${response.status}).`);
    }

    const segments = data.trip.legs.map((leg) => decodePolyline6(leg.shape));
    const maneuvers = data.trip.legs.flatMap((leg, segmentIndex) =>
      (leg.maneuvers ?? []).map((maneuver) => {
        const coordinate = segments[segmentIndex]?.[maneuver.begin_shape_index];
        if (coordinate === undefined) throw new RoutingError("Route directions did not match its geometry.");
        return {
          id: createId("maneuver"),
          segmentIndex,
          shapeIndex: maneuver.begin_shape_index,
          instruction: maneuver.instruction,
          ...(maneuver.verbal_pre_transition_instruction === undefined
            ? {}
            : { verbalInstruction: maneuver.verbal_pre_transition_instruction }),
          ...coordinate,
        };
      }),
    );
    return {
      segments,
      maneuvers,
      distanceMeters: data.trip.summary.length * 1_000,
      durationSeconds: data.trip.summary.time,
      engine: "valhalla",
    };
  }
}

function bicycleType(profile: RouteRequest["profile"]): string {
  return profile === "road" ? "road" : profile === "gravel" ? "cross" : "mountain";
}
