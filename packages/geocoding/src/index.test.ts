import { describe, expect, it, vi } from "vitest";
import { GeocodingError, PhotonGeocodingProvider } from "./index";

const VALID_PHOTON_RESPONSE = {
  features: [
    {
      geometry: { coordinates: [-73.968, 40.785] },
      properties: {
        osm_id: 12345,
        osm_type: "N",
        name: "Central Park",
        city: "New York",
        state: "NY",
        country: "USA",
      },
    },
  ],
};

describe("PhotonGeocodingProvider", () => {
  it("searches and parses features with label and coordinates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => VALID_PHOTON_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new PhotonGeocodingProvider("http://mock-photon");
    const results = await provider.search("Central Park");

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("Central Park");
    expect(results[0]?.latitude).toBe(40.785);
    expect(results[0]?.longitude).toBe(-73.968);
    expect(results[0]?.label).toContain("Central Park");
  });

  it("returns empty array for empty query without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new PhotonGeocodingProvider("http://mock-photon");
    const results = await provider.search("   ");

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discards features with invalid or missing coordinates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [NaN, 40.785] },
            properties: { name: "Bad Lon" },
          },
          {
            geometry: { coordinates: [-73.968, 200] },
            properties: { name: "Bad Lat" },
          },
          VALID_PHOTON_RESPONSE.features[0],
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new PhotonGeocodingProvider("http://mock-photon");
    const results = await provider.search("Park");

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("Central Park");
  });

  it("handles malformed features: {} or non-array without throwing TypeError", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        features: {}, // Not an array
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new PhotonGeocodingProvider("http://mock-photon");
    const results = await provider.search("Park");

    expect(results).toEqual([]);
  });

  it("handles numeric name and non-string properties without throwing TypeError", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [-73.968, 40.785] },
            properties: {
              osm_id: 9999,
              name: 12345, // numeric instead of string
              street: "Valid Street",
              city: 42, // numeric city
              country: null,
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new PhotonGeocodingProvider("http://mock-photon");
    const results = await provider.search("Park");

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("Valid Street");
  });

  it("reverse geocodes coordinates to a single result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => VALID_PHOTON_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new PhotonGeocodingProvider("http://mock-photon");
    const result = await provider.reverse({ latitude: 40.785, longitude: -73.968 });

    expect(result).not.toBeNull();
    expect(result?.name).toBe("Central Park");
  });

  it("returns null for invalid coordinates in reverse geocode without fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new PhotonGeocodingProvider("http://mock-photon");
    const result = await provider.reverse({ latitude: 999, longitude: -73.968 });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles cancelled AbortSignal in search", async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new PhotonGeocodingProvider("http://mock-photon");
    await expect(
      provider.search("Central Park", { signal: controller.signal }),
    ).rejects.toThrow(GeocodingError);
  });

  it("times out if response body parsing hangs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("AbortError")), 200);
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new PhotonGeocodingProvider("http://mock-photon", { timeoutMs: 50 });
    await expect(provider.search("Park")).rejects.toThrow(/timed out/i);
  });

  it("rejects malformed non-object response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => null,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new PhotonGeocodingProvider("http://mock-photon");
    await expect(provider.search("Park")).rejects.toThrow(GeocodingError);
  });
});
