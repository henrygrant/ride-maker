/// <reference types="node" />
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouteDocument } from "@ride-maker/domain";
import { ValhallaRoutingProvider } from "@ride-maker/routing";
import { PhotonGeocodingProvider } from "@ride-maker/geocoding";
import { CreateRideController } from "./controllers/create-ride-controller";
import { buildNavigationTrack, formatDistance, navigationFix, type NavigationTrack } from "./navigation";

describe("Created Ride Navigation with Fixture HTTP Server", () => {
  let server: ChildProcess;
  let serverPort: number;
  let routedDoc: RouteDocument;
  let track: NavigationTrack;

  beforeAll(async () => {
    // Run the exact native harness server, making syntax/protocol regressions visible.
    const fixturePath = fileURLToPath(new URL("../../../scripts/mobile-e2e/fixture-server.mjs", import.meta.url));
    server = spawn(process.execPath, [fixturePath], {
      env: { ...process.env, FIXTURE_SERVER_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
    });
    serverPort = await new Promise<number>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => { server.kill(); reject(new Error("Fixture startup timed out.")); }, 5000);
      server.once("error", (error) => { clearTimeout(timeout); reject(error); });
      server.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Fixture exited before startup: ${code} ${output}`)); });
      server.stdout?.on("data", (chunk) => {
        output += String(chunk);
        const match = output.match(/Running on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
      });
      server.stderr?.on("data", (chunk) => { output += String(chunk); });
    });
    const routingProvider = new ValhallaRoutingProvider(`http://127.0.0.1:${serverPort}/route`);
    const geocoding = new PhotonGeocodingProvider(`http://127.0.0.1:${serverPort}/geocoding`);
    const controller = new CreateRideController(routingProvider, geocoding);

    controller.setName("Morning River Loop");
    const places = await geocoding.search("Central Park");
    expect(places.map(place => place.name)).toEqual(["Central Park Loop", "Sheep Meadow"]);
    controller.selectSearchResult("start", places[0]!);
    const viaStopId = controller.addViaStop()!;
    controller.selectSearchResult(viaStopId, places[1]!);

    controller.toggleLoop();

    const preview = await controller.previewRoute();
    expect(preview).not.toBeNull();
    expect(preview?.segments).toHaveLength(2);

    routedDoc = controller.buildRouteDocument();
    const builtTrack = buildNavigationTrack(routedDoc);
    if (!builtTrack) {
      throw new Error("Failed to build navigation track from routed document");
    }
    track = builtTrack;
  });

  afterAll(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      await new Promise<void>((resolve) => { server.once("exit", () => resolve()); server.kill(); });
    }
  });

  it("builds navigation track via actual HTTP client with expected length and indexed maneuvers", () => {
    expect(track.lengthMeters).toBeGreaterThan(3200);
    expect(track.lengthMeters).toBeLessThan(3350);

    expect(track.maneuvers).toHaveLength(4);
    expect(track.maneuvers[0]!.maneuver.instruction).toBe("Depart start point.");
    expect(track.maneuvers[0]!.distanceMeters).toBeCloseTo(0, 0);

    expect(track.maneuvers[1]!.maneuver.instruction).toBe("Arrive at intermediate stop 1.");
    expect(track.maneuvers[1]!.distanceMeters).toBeGreaterThan(1600);
    expect(track.maneuvers[1]!.distanceMeters).toBeLessThan(1650);

    expect(track.maneuvers[3]!.maneuver.instruction).toBe("Arrive at finish.");
    expect(track.maneuvers[3]!.distanceMeters).toBeCloseTo(track.lengthMeters, 0);
  });

  it("calculates Stage 1 (start) progress and instructions", () => {
    const coords = { latitude: 40.785, longitude: -73.968, accuracy: 5 };
    const fix = navigationFix(track, coords, 0);

    expect(fix.arrived).toBe(false);
    expect(fix.offRouteMeters).toBeLessThan(10);
    expect(fix.next?.maneuver.instruction).toBe("Depart start point.");
    expect(formatDistance(fix.distanceToNextMeters!)).toBe("0 m");
  });

  it("calculates Stage 2 (midpoint) progress, instruction, and distance matching feeder regex", () => {
    // Stage 2 midpoint coordinate: 40.7781, -73.9709
    const coords = { latitude: 40.7781, longitude: -73.9709, accuracy: 5 };
    const fix = navigationFix(track, coords, 0);

    expect(fix.arrived).toBe(false);
    expect(fix.offRouteMeters).toBeLessThan(10);

    // Feeder step 2 requires fresh instruction: "Arrive at intermediate stop 1."
    expect(fix.next?.maneuver.instruction).toBe("Arrive at intermediate stop 1.");

    // Feeder step 2 requires distance: 830 m (or regex 810|820|830|840|850 m)
    const formattedDist = formatDistance(fix.distanceToNextMeters!);
    expect(/(810|820|830|840|850) m/.test(formattedDist)).toBe(true);
  });

  it("calculates Stage 3 (off-route) divergence beyond threshold", () => {
    // Stage 3 off-route coordinate: 40.7850, -73.9500 (~1.5 km east of track)
    const coords = { latitude: 40.785, longitude: -73.95, accuracy: 5 };
    const fix = navigationFix(track, coords, 831);

    expect(fix.offRouteMeters).toBeGreaterThan(1000);
    const isOffRoute = fix.offRouteMeters > Math.max(50, (coords.accuracy ?? 100) * 2);
    expect(isOffRoute).toBe(true);
  });

  it("calculates Stage 4 (finish) arrival", () => {
    // Stage 4 finish coordinate: 40.7850, -73.9680
    const coords = { latitude: 40.785, longitude: -73.968, accuracy: 5 };
    // Progress along track has reached the final leg (~3200 m)
    const fix = navigationFix(track, coords, 3200);

    expect(fix.arrived).toBe(true);
    expect(fix.remainingMeters).toBeLessThan(25);
  });

  it("reaches arrival through the feeder's actual sequential fixes", () => {
    let progress = 0;
    const start = navigationFix(track, { latitude: 40.785, longitude: -73.968 }, progress);
    progress = start.progressMeters;
    const midpoint = navigationFix(track, { latitude: 40.7781, longitude: -73.9709 }, progress);
    progress = midpoint.progressMeters;
    expect(midpoint.progressMeters).toBeGreaterThan(start.progressMeters);
    const deviation = navigationFix(track, { latitude: 40.785, longitude: -73.95 }, progress);
    expect(deviation.offRouteMeters).toBeGreaterThan(50);
    // Production App preserves progress during an off-route fix.
    const finish = navigationFix(track, { latitude: 40.785, longitude: -73.968 }, progress);
    expect(finish.arrived).toBe(true);
    expect(finish.remainingMeters).toBeLessThan(20);
  });
});
