import { ValhallaRoutingProvider, type RoutingProvider } from "@ride-maker/routing";
import { PhotonGeocodingProvider, type GeocodingProvider } from "@ride-maker/geocoding";

/**
 * Creates default routing provider.
 *
 * Configuration policy (Sol review finding 10):
 * - Explicit override via EXPO_PUBLIC_ROUTING_URL takes precedence.
 * - Test mode derivation from EXPO_PUBLIC_API_URL is STRICTLY gated on EXPO_PUBLIC_TEST_MODE === "true".
 * - Default production/consumer endpoint is public OpenStreetMap Valhalla instance.
 *
 * Note: The default OpenStreetMap Valhalla instance is a shared, donation-supported service.
 * It is suitable for low-volume development and non-commercial exploration, without an SLA.
 */
export function createDefaultRoutingProvider(): RoutingProvider {
  if (process.env.EXPO_PUBLIC_ROUTING_URL) {
    return new ValhallaRoutingProvider(process.env.EXPO_PUBLIC_ROUTING_URL);
  }

  const isTestMode = process.env.EXPO_PUBLIC_TEST_MODE === "true";
  if (isTestMode && process.env.EXPO_PUBLIC_API_URL) {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL.replace(/\/api\/?$/, "");
    return new ValhallaRoutingProvider(`${baseUrl}/route`);
  }

  return new ValhallaRoutingProvider();
}

/**
 * Creates default geocoding provider.
 *
 * Configuration policy (Sol review finding 10):
 * - Explicit override via EXPO_PUBLIC_GEOCODING_URL takes precedence.
 * - Test mode derivation from EXPO_PUBLIC_API_URL is STRICTLY gated on EXPO_PUBLIC_TEST_MODE === "true".
 * - Default production/consumer endpoint is public Komoot Photon instance.
 *
 * Note: The default Komoot Photon service is a free, shared public geocoder.
 * It is suitable for low-volume interactive queries, without an SLA.
 */
export function createDefaultGeocodingProvider(): GeocodingProvider {
  if (process.env.EXPO_PUBLIC_GEOCODING_URL) {
    return new PhotonGeocodingProvider(process.env.EXPO_PUBLIC_GEOCODING_URL);
  }

  const isTestMode = process.env.EXPO_PUBLIC_TEST_MODE === "true";
  if (isTestMode && process.env.EXPO_PUBLIC_API_URL) {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL.replace(/\/api\/?$/, "");
    return new PhotonGeocodingProvider(`${baseUrl}/geocoding`);
  }

  return new PhotonGeocodingProvider();
}
