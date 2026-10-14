import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultGeocodingProvider, createDefaultRoutingProvider } from "./providers";
import { ValhallaRoutingProvider } from "@ride-maker/routing";
import { PhotonGeocodingProvider } from "@ride-maker/geocoding";

describe("Provider Configuration Isolation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_ROUTING_URL;
    delete process.env.EXPO_PUBLIC_GEOCODING_URL;
    delete process.env.EXPO_PUBLIC_TEST_MODE;
    delete process.env.EXPO_PUBLIC_API_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to public OSM Valhalla and Komoot Photon when no env vars are set", () => {
    const routing = createDefaultRoutingProvider() as unknown as { endpoint: string };
    const geocoding = createDefaultGeocodingProvider() as unknown as { endpoint: string };

    expect(routing).toBeInstanceOf(ValhallaRoutingProvider);
    expect(routing.endpoint).toBe("https://valhalla1.openstreetmap.de/route");

    expect(geocoding).toBeInstanceOf(PhotonGeocodingProvider);
    expect(geocoding.endpoint).toBe("https://photon.komoot.io");
  });

  it("does NOT derive test endpoints from EXPO_PUBLIC_API_URL unless EXPO_PUBLIC_TEST_MODE is strictly 'true'", () => {
    process.env.EXPO_PUBLIC_API_URL = "http://10.0.2.2:8088/api";
    process.env.EXPO_PUBLIC_TEST_MODE = "false";

    const routing = createDefaultRoutingProvider() as unknown as { endpoint: string };
    const geocoding = createDefaultGeocodingProvider() as unknown as { endpoint: string };

    // Must remain isolated on public endpoints
    expect(routing.endpoint).toBe("https://valhalla1.openstreetmap.de/route");
    expect(geocoding.endpoint).toBe("https://photon.komoot.io");
  });

  it("derives test fixture endpoints when EXPO_PUBLIC_TEST_MODE === 'true'", () => {
    process.env.EXPO_PUBLIC_API_URL = "http://10.0.2.2:8088/api";
    process.env.EXPO_PUBLIC_TEST_MODE = "true";

    const routing = createDefaultRoutingProvider() as unknown as { endpoint: string };
    const geocoding = createDefaultGeocodingProvider() as unknown as { endpoint: string };

    expect(routing.endpoint).toBe("http://10.0.2.2:8088/route");
    expect(geocoding.endpoint).toBe("http://10.0.2.2:8088/geocoding");
  });

  it("honors explicit overrides over test mode derivation", () => {
    process.env.EXPO_PUBLIC_API_URL = "http://10.0.2.2:8088/api";
    process.env.EXPO_PUBLIC_TEST_MODE = "true";
    process.env.EXPO_PUBLIC_ROUTING_URL = "http://custom-valhalla.internal/route";
    process.env.EXPO_PUBLIC_GEOCODING_URL = "http://custom-photon.internal";

    const routing = createDefaultRoutingProvider() as unknown as { endpoint: string };
    const geocoding = createDefaultGeocodingProvider() as unknown as { endpoint: string };

    expect(routing.endpoint).toBe("http://custom-valhalla.internal/route");
    expect(geocoding.endpoint).toBe("http://custom-photon.internal");
  });
});
