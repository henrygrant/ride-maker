import type { Coordinate } from "@ride-maker/domain";

export type GeocodingResult = Coordinate & {
  id: string;
  name: string;
  label: string;
};

export interface GeocodingProvider {
  search(query: string, options?: { focus?: Coordinate; signal?: AbortSignal }): Promise<GeocodingResult[]>;
  reverse(coordinate: Coordinate, signal?: AbortSignal): Promise<GeocodingResult | null>;
}

export class GeocodingError extends Error {
  override name = "GeocodingError";
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number | string;
    osm_type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    state?: string;
    country?: string;
  };
};

type PhotonResponse = { features?: PhotonFeature[] };

export interface PhotonOptions {
  timeoutMs?: number;
}

export class PhotonGeocodingProvider implements GeocodingProvider {
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly endpoint = "https://photon.komoot.io",
    options: PhotonOptions = {},
  ) {
    this.defaultTimeoutMs = options.timeoutMs ?? 10000;
  }

  async search(
    query: string,
    options: { focus?: Coordinate; signal?: AbortSignal } = {},
  ): Promise<GeocodingResult[]> {
    if (options.signal?.aborted) {
      throw new GeocodingError("Place search request was cancelled.");
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [];
    }

    const params = new URLSearchParams({ q: trimmed, limit: "5" });
    if (options.focus !== undefined) {
      const { latitude, longitude } = options.focus;
      if (
        typeof latitude === "number" &&
        Number.isFinite(latitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        typeof longitude === "number" &&
        Number.isFinite(longitude) &&
        longitude >= -180 &&
        longitude <= 180
      ) {
        params.set("lat", String(latitude));
        params.set("lon", String(longitude));
      }
    }
    return this.request(`/api?${params}`, options.signal);
  }

  async reverse(coordinate: Coordinate, signal?: AbortSignal): Promise<GeocodingResult | null> {
    if (signal?.aborted) {
      throw new GeocodingError("Reverse geocoding request was cancelled.");
    }

    const { latitude, longitude } = coordinate;
    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }

    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      limit: "1",
    });
    const results = await this.request(`/reverse?${params}`, signal);
    return results[0] ?? null;
  }

  private async request(path: string, externalSignal?: AbortSignal): Promise<GeocodingResult[]> {
    const { signal, cleanup } = createTimeoutSignal(this.defaultTimeoutMs, externalSignal);

    let response: Response;
    let data: PhotonResponse;
    try {
      response = await fetch(`${this.endpoint}${path}`, {
        signal,
        headers: { "X-Client-Id": "ride-maker-local-development" },
      });

      if (!response.ok) {
        throw new GeocodingError(`Place search failed (${response.status}).`);
      }

      try {
        data = (await response.json()) as PhotonResponse;
      } catch (err: unknown) {
        if (signal.aborted) {
          throw err;
        }
        throw new GeocodingError(`Geocoding returned invalid JSON response (${response.status}).`);
      }
    } catch (err: unknown) {
      if (err instanceof GeocodingError) throw err;
      const isAbort = (err as { name?: string })?.name === "AbortError" || signal.aborted;
      if (isAbort && externalSignal?.aborted) {
        throw new GeocodingError("Geocoding request was cancelled.");
      }
      if (isAbort) {
        throw new GeocodingError(`Geocoding request timed out after ${this.defaultTimeoutMs}ms.`);
      }
      throw new GeocodingError(`Geocoding network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      cleanup();
    }

    if (!data || typeof data !== "object") {
      throw new GeocodingError("Geocoding returned empty or non-object response.");
    }

    if (!Array.isArray(data.features)) {
      return [];
    }

    const results: GeocodingResult[] = [];
    for (const feature of data.features) {
      if (feature && typeof feature === "object") {
        const parsed = toResult(feature);
        if (parsed !== null) {
          results.push(parsed);
        }
      }
    }
    return results;
  }
}

function toResult(feature: PhotonFeature): GeocodingResult | null {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [longitude, latitude] = coords;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const props =
    typeof feature.properties === "object" && feature.properties !== null
      ? (feature.properties as Record<string, unknown>)
      : {};

  const nameRaw =
    typeof props.name === "string"
      ? props.name
      : typeof props.street === "string"
      ? props.street
      : "";
  const name = nameRaw.trim();
  if (name.length === 0) return null;

  const housenumber = typeof props.housenumber === "string" ? props.housenumber.trim() : "";
  const street = typeof props.street === "string" ? props.street.trim() : "";
  const houseAndStreet = housenumber ? `${housenumber} ${street}`.trim() : street;

  const parts = [
    houseAndStreet,
    typeof props.district === "string" ? props.district.trim() : "",
    typeof props.city === "string" ? props.city.trim() : "",
    typeof props.state === "string" ? props.state.trim() : "",
    typeof props.country === "string" ? props.country.trim() : "",
  ].filter((p): p is string => p.length > 0);

  const label = parts.length > 0 ? `${name}, ${parts.join(", ")}` : name;
  const osmId =
    props.osm_id !== undefined && props.osm_id !== null
      ? String(props.osm_id)
      : `${latitude},${longitude}`;

  return { id: osmId, name, label, latitude, longitude };
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
