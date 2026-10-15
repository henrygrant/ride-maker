import type { Maneuver, RoutePoint, RoutingProfile } from "@ride-maker/domain";
import { decodePolyline6 } from "../polyline";
import { RoutingError } from "../types";
import type {
  TraceDiscontinuity,
  TraceMatchedSegment,
  TraceMatchingProvider,
  TraceMatchRequest,
  TraceMatchResult,
} from "./types";

const MAX_TRACE_POINTS = 100_000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024; // 20 MiB

type ValhallaManeuver = {
  begin_shape_index?: number;
  instruction?: string;
  verbal_pre_transition_instruction?: string;
};

type ValhallaLeg = {
  shape?: string;
  summary?: { length?: number; time?: number };
  maneuvers?: ValhallaManeuver[];
};

type ValhallaTrip = {
  summary?: { length?: number; time?: number };
  legs?: ValhallaLeg[];
  status?: number;
  status_message?: string;
};

type ValhallaAlternate = {
  trip?: ValhallaTrip;
};

type ValhallaTraceRouteResponse = {
  trip?: ValhallaTrip;
  alternates?: ValhallaAlternate[];
  error?: string;
  error_code?: number;
};

export interface ValhallaTraceAdapterOptions {
  timeoutMs?: number;
  clientId?: string;
}

/**
 * Valhalla Trace Route Matching Adapter.
 *
 * Implements `TraceMatchingProvider` by POSTing sampled trace shapes to Valhalla's
 * `/trace_route` endpoint using bicycle `shape_match: "map_snap"`.
 *
 * Note: The default endpoint (`https://valhalla1.openstreetmap.de/trace_route`)
 * is suitable for low-volume development testing only; it does not constitute
 * a production service availability guarantee.
 */
export class ValhallaTraceMatchingProvider implements TraceMatchingProvider {
  private readonly defaultTimeoutMs: number;
  private readonly clientId: string;

  constructor(
    private readonly endpoint = "https://valhalla1.openstreetmap.de/trace_route",
    options: ValhallaTraceAdapterOptions = {},
  ) {
    this.defaultTimeoutMs = options.timeoutMs ?? 15_000;
    this.clientId = options.clientId ?? "ride-maker-local-development";
    if (!Number.isFinite(this.defaultTimeoutMs) || this.defaultTimeoutMs <= 0 || this.defaultTimeoutMs > 120_000) {
      throw new RoutingError("Trace matching timeout must be between 1 and 120,000 milliseconds.");
    }
    let parsedEndpoint: URL;
    try { parsedEndpoint = new URL(this.endpoint); } catch { throw new RoutingError("Trace matching endpoint must be an absolute URL."); }
    if (parsedEndpoint.protocol !== "https:" && parsedEndpoint.protocol !== "http:") throw new RoutingError("Trace matching endpoint must use HTTP or HTTPS.");
  }

  async matchTrace(request: TraceMatchRequest): Promise<TraceMatchResult> {
    if (request.signal?.aborted) {
      throw new RoutingError("Trace matching request was cancelled.");
    }

    if (!request.points || request.points.length < 2) {
      throw new RoutingError("At least two coordinates are required for trace matching.");
    }
    if (!["road", "gravel", "mountain"].includes(request.profile)) throw new RoutingError("Invalid bicycle routing profile.");

    if (request.points.length > MAX_TRACE_POINTS) {
      throw new RoutingError(
        `Trace exceeds maximum allowed points limit of ${MAX_TRACE_POINTS.toLocaleString()}.`,
      );
    }

    // Validate all input coordinates without dumping sensitive coordinate arrays
    for (let i = 0; i < request.points.length; i++) {
      const pt = request.points[i]!;
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
        throw new RoutingError(`Invalid coordinate at index ${i}.`);
      }
    }

    const { signal, cleanup } = createTimeoutSignal(this.defaultTimeoutMs, request.signal);

    const bodyPayload = {
      shape: request.points.map((pt) => ({
        lat: pt.latitude,
        lon: pt.longitude,
        ...(pt.time !== undefined ? { time: formatPointTime(pt.time) } : {}),
      })),
      costing: "bicycle",
      costing_options: {
        bicycle: {
          bicycle_type: mapBicycleType(request.profile),
        },
      },
      shape_match: "map_snap",
      directions_options: {
        units: "kilometers",
        language: "en-US",
      },
    };

    let response: Response;
    let data: ValhallaTraceRouteResponse;

    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": this.clientId,
        },
        body: JSON.stringify(bodyPayload),
        signal,
      });

      // Bounded response size check
      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader !== null) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
          throw new RoutingError(`Trace matching response exceeded maximum limit of ${MAX_RESPONSE_BYTES} bytes.`);
        }
      }

      const responseText = await readBoundedText(response, MAX_RESPONSE_BYTES);

      try {
        data = JSON.parse(responseText) as ValhallaTraceRouteResponse;
      } catch (err: unknown) {
        if (signal.aborted) {
          throw err;
        }
        throw new RoutingError(`Trace matching returned invalid JSON (${response.status}).`);
      }
    } catch (err: unknown) {
      if (err instanceof RoutingError) throw err;
      const isAbort = (err as { name?: string })?.name === "AbortError" || signal.aborted;
      if (isAbort && request.signal?.aborted) {
        throw new RoutingError("Trace matching request was cancelled.");
      }
      if (isAbort) {
        throw new RoutingError(`Trace matching request timed out after ${this.defaultTimeoutMs}ms.`);
      }
      throw new RoutingError(`Trace matching network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      cleanup();
    }

    if (!data || typeof data !== "object") {
      throw new RoutingError("Trace matching returned empty or non-object response.");
    }

    if (!response.ok || !data.trip) {
      const msg = typeof data.error === "string" ? data.error : `Trace matching failed (${response.status}).`;
      throw new RoutingError(msg);
    }

    // Strict validation of trip status if present
    if (data.trip.status !== undefined && data.trip.status !== 0) {
      throw new RoutingError(`Trace matching returned error status: ${data.trip.status_message ?? String(data.trip.status)}`);
    }

    // Strict validation of primary trip summary: finite non-negative numbers, no defaulting
    validateTripSummary(data.trip.summary, "primary trip");

    // Inspect primary trip and any continuation alternates returned on discontinuities
    const allTrips: ValhallaTrip[] = [data.trip];
    if (data.alternates !== undefined) {
      if (!Array.isArray(data.alternates)) {
        throw new RoutingError("Trace matching alternates must be an array.");
      }
      for (let aIdx = 0; aIdx < data.alternates.length; aIdx++) {
        const alternate = data.alternates[aIdx];
        if (!alternate || typeof alternate !== "object" || !alternate.trip) {
          throw new RoutingError(`Trace alternate ${aIdx} missing valid trip object.`);
        }
        if (alternate.trip.status !== undefined && alternate.trip.status !== 0) {
          throw new RoutingError(`Trace alternate ${aIdx} returned error status: ${alternate.trip.status_message ?? String(alternate.trip.status)}`);
        }
        validateTripSummary(alternate.trip.summary, `alternate trip ${aIdx}`);
        allTrips.push(alternate.trip);
      }
    }

    const matchedSegments: TraceMatchedSegment[] = [];
    const discontinuities: TraceDiscontinuity[] = [];
    let prevTripLastSegmentIndex: number | undefined;

    for (let tripIdx = 0; tripIdx < allTrips.length; tripIdx++) {
      const trip = allTrips[tripIdx]!;
      if (!Array.isArray(trip.legs) || trip.legs.length === 0) {
        throw new RoutingError(`Trip ${tripIdx} returned no path legs.`);
      }

      const currentTripFirstSegmentIndex = matchedSegments.length;

      for (let legIdx = 0; legIdx < trip.legs.length; legIdx++) {
        const leg = trip.legs[legIdx]!;
        if (!leg || typeof leg !== "object") {
          throw new RoutingError(`Leg ${legIdx} in trip ${tripIdx} is invalid.`);
        }
        if (typeof leg.shape !== "string" || leg.shape.length === 0) {
          throw new RoutingError(`Leg ${legIdx} in trip ${tripIdx} missing shape geometry.`);
        }

        // Strict validation of leg summary: finite non-negative numbers, no defaulting
        validateLegSummary(leg.summary, legIdx, tripIdx);

        let points: RoutePoint[];
        try {
          points = decodePolyline6(leg.shape);
        } catch (err) {
          throw new RoutingError(
            `Failed to decode leg shape: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        if (points.length < 2) {
          throw new RoutingError(`Leg ${legIdx} decoded to fewer than 2 points.`);
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
            throw new RoutingError("Leg decoded out-of-bounds coordinates.");
          }
        }

        const legIndexInResult = matchedSegments.length;

        if (leg.maneuvers !== undefined && !Array.isArray(leg.maneuvers)) {
          throw new RoutingError(`Leg ${legIdx} maneuvers must be an array.`);
        }

        const maneuvers: Maneuver[] = (leg.maneuvers ?? []).map((m, mIdx) => {
          if (!m || typeof m !== "object") {
            throw new RoutingError(`Maneuver ${mIdx} is invalid.`);
          }
          const beginIdx = m.begin_shape_index;
          if (
            typeof beginIdx !== "number" ||
            !Number.isInteger(beginIdx) ||
            beginIdx < 0 ||
            beginIdx >= points.length
          ) {
            throw new RoutingError(
              `Maneuver ${mIdx} has invalid begin_shape_index: ${String(beginIdx)} (points length: ${points.length}).`,
            );
          }
          if (typeof m.instruction !== "string" || m.instruction.trim().length === 0) {
            throw new RoutingError(`Maneuver ${mIdx} has empty instruction.`);
          }
          if (
            m.verbal_pre_transition_instruction !== undefined &&
            typeof m.verbal_pre_transition_instruction !== "string"
          ) {
            throw new RoutingError(`Maneuver ${mIdx} has non-string verbal instruction.`);
          }

          const coord = points[beginIdx]!;
          return {
            id: `maneuver-${legIndexInResult}-${beginIdx}`,
            segmentIndex: legIndexInResult,
            shapeIndex: beginIdx,
            instruction: m.instruction.trim(),
            ...(m.verbal_pre_transition_instruction !== undefined
              ? { verbalInstruction: m.verbal_pre_transition_instruction.trim() }
              : {}),
            latitude: coord.latitude,
            longitude: coord.longitude,
          };
        });

        const legDistanceMeters = leg.summary!.length! * 1_000;
        const legDurationSeconds = Math.round(leg.summary!.time!);

        matchedSegments.push({
          points,
          maneuvers,
          distanceMeters: legDistanceMeters,
          durationSeconds: legDurationSeconds,
        });
      }

      // Record discontinuity with exact matched segment offsets (not trip indices!)
      if (tripIdx > 0 && prevTripLastSegmentIndex !== undefined) {
        discontinuities.push({
          fromMatchedIndex: prevTripLastSegmentIndex,
          toMatchedIndex: currentTripFirstSegmentIndex,
          reason: "Valhalla trace discontinuity alternate",
        });
      }

      prevTripLastSegmentIndex = matchedSegments.length - 1;
    }

    return {
      matchedSegments,
      discontinuities,
      engine: "valhalla",
    };
  }
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limit) throw new RoutingError(`Trace matching response exceeded maximum limit of ${limit} bytes.`);
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new RoutingError(`Trace matching response exceeded maximum limit of ${limit} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new RoutingError("Trace matching response is not valid UTF-8."); }
}

function validateTripSummary(
  summary: { length?: number; time?: number } | undefined,
  label: string,
): asserts summary is { length: number; time: number } {
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
    throw new RoutingError(`Trace matching ${label} missing valid finite non-negative summary length/time.`);
  }
}

function validateLegSummary(
  summary: { length?: number; time?: number } | undefined,
  legIdx: number,
  tripIdx: number,
): asserts summary is { length: number; time: number } {
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
    throw new RoutingError(`Leg ${legIdx} in trip ${tripIdx} missing valid finite non-negative summary length/time.`);
  }
}

function mapBicycleType(profile: RoutingProfile): string {
  switch (profile) {
    case "road":
      return "road";
    case "gravel":
      return "cross";
    case "mountain":
      return "mountain";
    default:
      return "road";
  }
}

function formatPointTime(time: string): number | undefined {
  const parsed = new Date(time).getTime();
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed / 1000);
  }
  return undefined;
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
