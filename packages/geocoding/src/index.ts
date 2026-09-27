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

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
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

export class PhotonGeocodingProvider implements GeocodingProvider {
  constructor(private readonly endpoint = "https://photon.komoot.io") {}

  async search(
    query: string,
    options: { focus?: Coordinate; signal?: AbortSignal } = {},
  ): Promise<GeocodingResult[]> {
    const params = new URLSearchParams({ q: query, limit: "5" });
    if (options.focus !== undefined) {
      params.set("lat", String(options.focus.latitude));
      params.set("lon", String(options.focus.longitude));
    }
    return this.request(`/api?${params}`, options.signal);
  }

  async reverse(coordinate: Coordinate, signal?: AbortSignal): Promise<GeocodingResult | null> {
    const params = new URLSearchParams({
      lat: String(coordinate.latitude),
      lon: String(coordinate.longitude),
      limit: "1",
    });
    return (await this.request(`/reverse?${params}`, signal))[0] ?? null;
  }

  private async request(path: string, signal?: AbortSignal): Promise<GeocodingResult[]> {
    const response = await fetch(`${this.endpoint}${path}`, signal === undefined ? {} : { signal });
    if (!response.ok) throw new Error(`Place search failed (${response.status}).`);
    const data = (await response.json()) as PhotonResponse;
    return (data.features ?? []).map(toResult);
  }
}

function toResult(feature: PhotonFeature): GeocodingResult {
  const [longitude, latitude] = feature.geometry.coordinates;
  const properties = feature.properties;
  const streetAddress = [properties.housenumber, properties.street].filter(Boolean).join(" ");
  const name = properties.name ?? (streetAddress || properties.city || "Unnamed place");
  const context = [
    streetAddress === name ? undefined : streetAddress,
    properties.city ?? properties.district,
    properties.state,
    properties.country,
  ].filter((part): part is string => Boolean(part));
  return {
    id: `${properties.osm_type ?? "place"}-${properties.osm_id ?? `${longitude}-${latitude}`}`,
    name,
    label: [...new Set([name, ...context])].join(", "),
    latitude,
    longitude,
  };
}
