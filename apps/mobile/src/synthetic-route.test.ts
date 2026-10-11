import { describe, expect, it, vi } from "vitest";
import { PocketBaseRouteRepository } from "@ride-maker/persistence";
import { buildNavigationTrack, navigationFix } from "./navigation";
import {
  SYNTHETIC_ROUTE_DOCUMENT,
  SYNTHETIC_ROUTE_ID,
  SYNTHETIC_SAVED_ROUTE,
} from "./fixtures/synthetic-routes";

describe("Synthetic Route Fixture & Navigation Contract", () => {
  it("builds a valid navigation track with maneuvers", () => {
    const track = buildNavigationTrack(SYNTHETIC_ROUTE_DOCUMENT);
    expect(track).not.toBeNull();
    if (!track) return;

    expect(track.edges.length).toBe(2);
    expect(track.lengthMeters).toBeGreaterThan(390);
    expect(track.lengthMeters).toBeLessThan(420);
    expect(track.maneuvers.length).toBe(2);
    expect(track.maneuvers[0]?.maneuver.instruction).toBe("Turn right onto Test Way");
    expect(track.maneuvers[1]?.maneuver.instruction).toBe("Arrive at destination");
  });

  it("calculates progression and next maneuver along the route", () => {
    const track = buildNavigationTrack(SYNTHETIC_ROUTE_DOCUMENT);
    expect(track).not.toBeNull();
    if (!track) return;

    // At Start: (40.7800, -73.9700)
    const fixStart = navigationFix(track, { latitude: 40.7800, longitude: -73.9700 }, 0);
    expect(fixStart.offRouteMeters).toBeLessThan(5);
    expect(fixStart.next?.maneuver.instruction).toBe("Turn right onto Test Way");
    expect(fixStart.distanceToNextMeters).toBeGreaterThan(180);
    expect(fixStart.arrived).toBe(false);

    // Halfway north: (40.7810, -73.9700)
    const fixMid1 = navigationFix(track, { latitude: 40.7810, longitude: -73.9700 }, fixStart.progressMeters);
    expect(fixMid1.offRouteMeters).toBeLessThan(5);
    expect(fixMid1.progressMeters).toBeGreaterThan(100);
    expect(fixMid1.distanceToNextMeters).toBeLessThan(100);
    expect(fixMid1.arrived).toBe(false);

    // Off-route detour west: (40.7810, -73.9720) ~170m away
    const fixOffRoute = navigationFix(track, { latitude: 40.7810, longitude: -73.9720 }, fixMid1.progressMeters);
    expect(fixOffRoute.offRouteMeters).toBeGreaterThan(100);

    // Near Finish: (40.7818, -73.9676)
    const fixEnd = navigationFix(track, { latitude: 40.7818, longitude: -73.9676 }, fixMid1.progressMeters);
    expect(fixEnd.offRouteMeters).toBeLessThan(5);
    expect(fixEnd.remainingMeters).toBeLessThan(10);
    expect(fixEnd.arrived).toBe(true);
  });

  it("exercises production PocketBaseRouteRepository against canonical fixture", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes(`/records/${SYNTHETIC_ROUTE_ID}`)) {
          return {
            ok: true,
            status: 200,
            json: async () => SYNTHETIC_SAVED_ROUTE,
          };
        }
        if (url.includes("/records/missingroute999")) {
          return {
            ok: false,
            status: 404,
            json: async () => ({ code: 404, message: "The requested resource wasn't found." }),
          };
        }
        if (url.includes("/records?filter=")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              page: 1,
              perPage: 50,
              totalItems: 1,
              totalPages: 1,
              items: [SYNTHETIC_SAVED_ROUTE],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }) as typeof fetch;

      const repo = new PocketBaseRouteRepository("http://127.0.0.1:8088/api");

      // List public routes
      const publicList = await repo.listPublic();
      expect(publicList).toHaveLength(1);
      expect(publicList[0]?.id).toBe(SYNTHETIC_ROUTE_ID);
      expect(publicList[0]?.document.name).toBe("Synthetic Test Route");

      // Get valid route by ID
      const fetched = await repo.get(SYNTHETIC_ROUTE_ID);
      expect(fetched.id).toBe(SYNTHETIC_SAVED_ROUTE.id);
      expect(fetched.document.name).toBe(SYNTHETIC_ROUTE_DOCUMENT.name);

      // Malformed ID (< 15 chars or invalid regex) rejects before fetch
      await expect(repo.get("invalidid")).rejects.toThrow("Invalid shared route link.");

      // Valid-format ID not on server rejects with 404
      await expect(repo.get("missingroute999")).rejects.toThrow("The requested resource wasn't found.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
