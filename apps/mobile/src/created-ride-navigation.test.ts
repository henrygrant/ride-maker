/// <reference types="node" />
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouteDocument } from "@ride-maker/domain";
import { ValhallaRoutingProvider } from "@ride-maker/routing";
import { PhotonGeocodingProvider } from "@ride-maker/geocoding";
import { CreateRideController } from "./controllers/create-ride-controller";
import { formatDistance } from "./navigation";
import { bearingDegrees, createNavigationState, distanceMeters, prepareNavigationRide, reduceNavigation, type NavigationState, type PreparedNavigationRide } from "@ride-maker/navigation";

describe("Created Ride Navigation with Fixture HTTP Server", () => {
  let server: ChildProcess;
  let serverPort: number;
  let routedDoc: RouteDocument;
  let navigationRide: PreparedNavigationRide;

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
    const builtRide = prepareNavigationRide(routedDoc);
    if (!builtRide.ok) throw new Error(`Failed to compile navigation ride: ${builtRide.error.message}`);
    navigationRide = builtRide.ride;
  });

  afterAll(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      await new Promise<void>((resolve) => { server.once("exit", () => resolve()); server.kill(); });
    }
  });

  it("compiles the actual routed document into the production navigation engine", () => {
    expect(navigationRide.totalDistanceMeters).toBeGreaterThan(3200);
    expect(navigationRide.totalDistanceMeters).toBeLessThan(3350);

    expect(navigationRide.maneuvers).toHaveLength(4);
    expect(navigationRide.maneuvers[0]!.instruction).toBe("Depart start point.");
    expect(navigationRide.maneuvers[0]!.distanceAlongRideMeters).toBeCloseTo(0, 0);

    expect(navigationRide.maneuvers[1]!.instruction).toBe("Arrive at intermediate stop 1.");
    expect(navigationRide.maneuvers[1]!.distanceAlongRideMeters).toBeGreaterThan(1600);
    expect(navigationRide.maneuvers[1]!.distanceAlongRideMeters).toBeLessThan(1650);

    expect(navigationRide.maneuvers[3]!.instruction).toBe("Arrive at finish.");
    expect(navigationRide.maneuvers[3]!.distanceAlongRideMeters).toBeCloseTo(navigationRide.totalDistanceMeters, 0);
  });

  function replay(points: Array<{ latitude: number; longitude: number }>): NavigationState {
    let state = createNavigationState(navigationRide);
    let timestamp = 1_000;
    let previous: { latitude: number; longitude: number } | null = null;
    for (let index = 0; index < points.length; index++) {
      const point = points[index]!;
      const following = points[index + 1] ?? point;
      timestamp += previous ? Math.ceil(Math.max(2_000, distanceMeters(previous, point) / 5 * 1000 + 2_000)) : 2_000;
      state = reduceNavigation(navigationRide, state, {
        type: "location_fix", timestamp, receivedAt: timestamp, accuracyMeters: 5,
        headingDegrees: bearingDegrees(previous ?? point, previous ? point : following), ...point,
      }).state;
      previous = point;
    }
    return state;
  }

  it("tracks the start fix and uses the engine's maneuver progress", () => {
    const state = replay([{ latitude: 40.785, longitude: -73.968 }]);
    expect(state.progressMeters).toBeLessThan(10);
    expect(state.lateralDistanceMeters).toBeLessThan(10);
    expect(state.nextManeuverIndex).not.toBeNull();
    expect(formatDistance(state.distanceToNextManeuverMeters ?? 0)).toBe("0 m");
  });

  it("advances along the route and evaluates off-route state through engine events", () => {
    const state = replay([
      { latitude: 40.785, longitude: -73.968 },
      { latitude: 40.7781, longitude: -73.9709 },
    ]);
    expect(state.progressMeters).toBeGreaterThan(0);
    expect(state.lateralDistanceMeters).toBeLessThan(20);
    expect(state.distanceToNextManeuverMeters).not.toBeNull();
    expect(formatDistance(state.distanceToNextManeuverMeters ?? 0)).toMatch(/\d+ (m|\.\d km)/u);
    const offRoute = replay([
      { latitude: 40.785, longitude: -73.968 },
      { latitude: 40.7781, longitude: -73.9709 },
      { latitude: 40.785, longitude: -73.95 },
      { latitude: 40.785, longitude: -73.95 },
      { latitude: 40.785, longitude: -73.95 },
    ]);
    expect(offRoute.lateralDistanceMeters).toBeGreaterThan(1000);
    expect(offRoute.isOffRoute).toBe(true);
  });

  it("reaches arrival by replaying the authored routed geometry in order", () => {
    const points = routedDoc.segments.flatMap((segment) => {
      const result: Array<{ latitude: number; longitude: number }> = [];
      for (let i = 1; i < segment.points.length; i++) {
        const start = segment.points[i - 1]!;
        const end = segment.points[i]!;
        const steps = Math.max(1, Math.ceil(distanceMeters(start, end) / 50));
        for (let step = 0; step < steps; step++) {
          const fraction = step / steps;
          result.push({ latitude: start.latitude + (end.latitude - start.latitude) * fraction, longitude: start.longitude + (end.longitude - start.longitude) * fraction });
        }
      }
      const final = segment.points.at(-1);
      if (final) result.push(final);
      return result;
    });
    const state = replay(points);
    expect(state.arrived).toBe(true);
    expect(state.remainingMeters).toBeLessThan(30);
  });
});
