import { describe, expect, it, vi } from "vitest";
import type { GeocodingResult } from "@ride-maker/geocoding";
import { CreateRideController } from "./create-ride-controller";

const start: GeocodingResult = { id: "a", name: "A", label: "A", latitude: 40, longitude: -73 };
const finish: GeocodingResult = { id: "b", name: "B", label: "B", latitude: 41, longitude: -73 };
function setup() {
  const route = vi.fn().mockResolvedValue({
    segments: [[start, finish]],
    maneuvers: [{ ...start, id: "m", segmentIndex: 0, shapeIndex: 0, instruction: "Continue" }],
    distanceMeters: 1000, durationSeconds: 100, engine: "valhalla",
  });
  const search = vi.fn().mockResolvedValue([]);
  const reverse = vi.fn().mockResolvedValue(null);
  const controller = new CreateRideController({ route }, { search, reverse });
  controller.selectSearchResult("start", start);
  controller.selectSearchResult("finish", finish);
  return { controller, route, search, reverse };
}

describe("Sol task004 remaining regressions", () => {
  it("invalidates a preview immediately when destination text changes", async () => {
    const { controller } = setup();
    await controller.previewRoute();
    expect(controller.canSave()).toBe(true);
    controller.setSearchQuery("finish", "A different destination");
    expect(controller.canSave()).toBe(false);
    expect(controller.getState().previewRoute).toBeNull();
  });

  it("does not display an old search result after the query is cleared", async () => {
    const { controller, search } = setup();
    let resolve!: (results: GeocodingResult[]) => void;
    search.mockImplementation(() => new Promise<GeocodingResult[]>((r) => { resolve = r; }));
    controller.setSearchQuery("start", "Old query");
    const pending = controller.searchLocation("start", "Old query");
    controller.setSearchQuery("start", "");
    resolve([start]);
    await pending;
    expect(controller.getState().startPoint.searchResults).toEqual([]);
  });

  it("does not overwrite manual selection with a delayed location result", async () => {
    const { controller } = setup();
    let resolve!: (coords: { latitude: number; longitude: number }) => void;
    const pending = controller.useMyLocation("start", () => new Promise((r) => { resolve = r; }));
    controller.selectSearchResult("start", finish);
    resolve({ latitude: 39, longitude: -72 });
    await pending;
    expect(controller.getState().startPoint.latitude).toBe(finish.latitude);
    expect(controller.getState().startPoint.longitude).toBe(finish.longitude);
  });

  it("rejects unresolved stops rather than silently omitting them", async () => {
    const { controller, route } = setup();
    const stop = controller.addViaStop()!;
    controller.setSearchQuery(stop, "Unresolved stop");
    expect(await controller.previewRoute()).toBeNull();
    expect(route).not.toHaveBeenCalled();
  });

  it("rejects a loop whose only via point equals its start", async () => {
    const { controller, route } = setup();
    controller.toggleLoop();
    controller.selectSearchResult(controller.addViaStop()!, start);
    expect(await controller.previewRoute()).toBeNull();
    expect(route).not.toHaveBeenCalled();
  });
});
