import {
  PocketBaseRouteRepository,
  type RouteRepository,
} from "@ride-maker/persistence";

export function createDefaultRouteRepository(): RouteRepository {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  return new PocketBaseRouteRepository(apiUrl || "https://ridemaker.thg3.net/api");
}
