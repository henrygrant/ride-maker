import { createId } from "@ride-maker/domain";
import { decodePolyline6 } from "./polyline";
import { RoutingError, type RoutedPath, type RouteRequest, type RoutingProvider } from "./types";

type ValhallaResponse = {
  trip?: {
    summary?: { length?: number; time?: number };
    legs?: Array<{
      shape?: string;
      maneuvers?: Array<{
        begin_shape_index?: number;
        instruction?: string;
        verbal_pre_transition_instruction?: string;
      }>;
    }>;
  };
  error?: string;
  error_code?: number;
};

export interface ValhallaOptions {
  timeoutMs?: number;
}

export class ValhallaRoutingProvider implements RoutingProvider {
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly endpoint = "https://valhalla1.openstreetmap.de/route",
    options: ValhallaOptions = {},
  ) {
    this.defaultTimeoutMs = options.timeoutMs ?? 15000;
  }

  async route(request: RouteRequest): Promise<RoutedPath> {
    if (request.signal?.aborted) {
      throw new RoutingError("Routing request was cancelled.");
    }

    if (!request.controlPoints || request.controlPoints.length < 2) {
      throw new RoutingError("At least two control points are required for routing.");
    }

    for (let i = 0; i < request.controlPoints.length; i++) {
      const pt = request.controlPoints[i]!;
      if (
        typeof pt.latitude !== "number" ||
        !Number.isFinite(pt.latitude) ||
        pt.latitude < -90 ||
        pt.latitude > 90 ||
        typeof pt.longitude !== "number" ||
        !Number.isFinite(pt.longitude) ||
        pt.longitude < -180 ||
        pt.longitude > 180
      ) {
        throw new RoutingError(`Invalid coordinate at control point ${i}: (${pt.latitude}, ${pt.longitude})`);
      }
    }

    const { signal, cleanup } = createTimeoutSignal(this.defaultTimeoutMs, request.signal);

    let response: Response;
    let data: ValhallaResponse;
    try {
      response = await fetch(this.endpoint, {
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
        signal,
      });

      try {
        data = (await response.json()) as ValhallaResponse;
      } catch (err: unknown) {
        if (signal.aborted) {
          throw err;
        }
        throw new RoutingError(`Routing returned invalid JSON response (${response.status}).`);
      }
    } catch (err: unknown) {
      if (err instanceof RoutingError) throw err;
      const isAbort = (err as { name?: string })?.name === "AbortError" || signal.aborted;
      if (isAbort && request.signal?.aborted) {
        throw new RoutingError("Routing request was cancelled.");
      }
      if (isAbort) {
        throw new RoutingError(`Routing request timed out after ${this.defaultTimeoutMs}ms.`);
      }
      throw new RoutingError(`Routing network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      cleanup();
    }

    if (!data || typeof data !== "object") {
      throw new RoutingError("Routing returned empty or non-object response.");
    }

    if (!response.ok || !data.trip) {
      const msg = typeof data.error === "string" ? data.error : `Routing failed (${response.status}).`;
      throw new RoutingError(msg);
    }

    const trip = data.trip;
    if (typeof trip !== "object" || trip === null) {
      throw new RoutingError("Routing response missing valid trip object.");
    }

    const summary = trip.summary;
    if (
      !summary ||
      typeof summary !== "object" ||
      typeof summary.length !== "number" ||
      !Number.isFinite(summary.length) ||
      summary.length < 0 ||
      typeof summary.time !== "number" ||
      !Number.isFinite(summary.time) ||
      summary.time < 0
    ) {
      throw new RoutingError("Routing response missing valid summary distance/time.");
    }

    if (!Array.isArray(trip.legs) || trip.legs.length === 0) {
      throw new RoutingError("Routing returned no path legs.");
    }

    const segments = trip.legs.map((leg, legIndex) => {
      if (!leg || typeof leg !== "object") {
        throw new RoutingError(`Routing leg ${legIndex} is null or invalid.`);
      }
      if (typeof leg.shape !== "string" || leg.shape.length === 0) {
        throw new RoutingError(`Routing leg ${legIndex} missing shape geometry.`);
      }
      try {
        const points = decodePolyline6(leg.shape);
        if (points.length < 2) {
          throw new RoutingError(`Routing leg ${legIndex} decoded to fewer than 2 points.`);
        }
        for (const pt of points) {
          if (
            typeof pt.latitude !== "number" ||
            !Number.isFinite(pt.latitude) ||
            pt.latitude < -90 ||
            pt.latitude > 90 ||
            typeof pt.longitude !== "number" ||
            !Number.isFinite(pt.longitude) ||
            pt.longitude < -180 ||
            pt.longitude > 180
          ) {
            throw new RoutingError(`Routing leg ${legIndex} decoded out-of-bounds coordinates.`);
          }
        }
        return points;
      } catch (err) {
        if (err instanceof RoutingError) throw err;
        throw new RoutingError(
          `Failed to decode geometry for leg ${legIndex}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    const maneuvers = trip.legs.flatMap((leg, segmentIndex) => {
      if (leg.maneuvers !== undefined && !Array.isArray(leg.maneuvers)) {
        throw new RoutingError(`Leg ${segmentIndex} maneuvers is not an array.`);
      }
      const legManeuvers = leg.maneuvers ?? [];
      const segmentPoints = segments[segmentIndex]!;
      return legManeuvers.map((maneuver, maneuverIndex) => {
        if (!maneuver || typeof maneuver !== "object") {
          throw new RoutingError(`Maneuver ${maneuverIndex} in leg ${segmentIndex} is invalid.`);
        }
        const beginIdx = maneuver.begin_shape_index;
        if (
          typeof beginIdx !== "number" ||
          !Number.isInteger(beginIdx) ||
          beginIdx < 0 ||
          beginIdx >= segmentPoints.length
        ) {
          throw new RoutingError(
            `Maneuver ${maneuverIndex} in leg ${segmentIndex} has out-of-bounds begin_shape_index: ${beginIdx}`,
          );
        }
        if (typeof maneuver.instruction !== "string" || maneuver.instruction.trim().length === 0) {
          throw new RoutingError(`Maneuver ${maneuverIndex} in leg ${segmentIndex} has empty instruction.`);
        }
        if (
          maneuver.verbal_pre_transition_instruction !== undefined &&
          typeof maneuver.verbal_pre_transition_instruction !== "string"
        ) {
          throw new RoutingError(
            `Maneuver ${maneuverIndex} in leg ${segmentIndex} has non-string verbal instruction.`,
          );
        }
        const coordinate = segmentPoints[beginIdx];
        if (coordinate === undefined) {
          throw new RoutingError("Route directions did not match its geometry.");
        }
        return {
          id: createId("maneuver"),
          segmentIndex,
          shapeIndex: beginIdx,
          instruction: maneuver.instruction.trim(),
          ...(typeof maneuver.verbal_pre_transition_instruction === "string"
            ? { verbalInstruction: maneuver.verbal_pre_transition_instruction.trim() }
            : {}),
          ...coordinate,
        };
      });
    });

    return {
      segments,
      maneuvers,
      distanceMeters: summary.length * 1_000,
      durationSeconds: Math.round(summary.time),
      engine: "valhalla",
    };
  }
}

function bicycleType(profile: RouteRequest["profile"]): string {
  return profile === "road" ? "road" : profile === "gravel" ? "cross" : "mountain";
}

function createTimeoutSignal(timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  const onAbort = () => {
    if (timer) clearTimeout(timer);
    controller.abort(externalSignal?.reason ?? new Error("Aborted by caller"));
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onAbort();
    } else {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onAbort);
      }
    },
  };
}
