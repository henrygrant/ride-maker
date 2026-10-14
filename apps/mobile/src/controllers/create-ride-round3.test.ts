import { describe, expect, it, vi } from "vitest";
import type { GeocodingResult } from "@ride-maker/geocoding";
import { CreateRideController } from "./create-ride-controller";

const startLoc: GeocodingResult = { id: "p1", name: "Start Point", label: "Start Point, NY", latitude: 40.785, longitude: -73.968 };
const finishLoc: GeocodingResult = { id: "p2", name: "Finish Point", label: "Finish Point, NY", latitude: 40.771, longitude: -73.974 };
const viaLoc: GeocodingResult = { id: "p3", name: "Sheep Meadow", label: "Sheep Meadow, NY", latitude: 40.775, longitude: -73.972 };
const altLoc: GeocodingResult = { id: "p4", name: "Harlem Meer Northern Shore Promenade", label: "Harlem Meer, NY", latitude: 40.795, longitude: -73.955 };

function setupController() {
  const route = vi.fn().mockResolvedValue({
    segments: [[startLoc, finishLoc]],
    maneuvers: [{ ...startLoc, id: "m1", segmentIndex: 0, shapeIndex: 0, instruction: "Head north" }],
    distanceMeters: 2500,
    durationSeconds: 300,
    engine: "valhalla",
  });
  const search = vi.fn().mockImplementation(async (query: string) => {
    if (query === "fail") throw new Error("Search network failed");
    if (query === "empty") return [];
    if (query === "Harlem") return [altLoc];
    return [viaLoc];
  });
  const reverse = vi.fn().mockResolvedValue({ name: "Reverse Place" });

  const controller = new CreateRideController({ route }, { search, reverse }, null, { autoRoute: true });
  controller.selectSearchResult("start", startLoc);
  controller.selectSearchResult("finish", finishLoc);

  return { controller, route, search, reverse };
}

describe("Task005 Round 3 Regressions", () => {
  describe("R3.1: Staged new-stop search in loop ride", () => {
    it("stages new-stop search query without mutating itinerary or invalidating preview", async () => {
      const { controller } = setupController();
      controller.toggleLoop();
      const viaStopId = controller.addViaStop();
      controller.selectSearchResult(viaStopId, viaLoc);
      await controller.previewRoute();

      expect(controller.isRouteReady()).toBe(true);
      const initialViaCount = controller.getState().viaStops.length;

      // Stage search query for new-stop
      controller.setSearchQuery("new-stop", "Conservatory");
      expect(controller.getState().newStopSearch.searchQuery).toBe("Conservatory");
      expect(controller.getState().viaStops.length).toBe(initialViaCount);
      // Itinerary was not mutated, preview remains ready
      expect(controller.isRouteReady()).toBe(true);
      expect(controller.getState().previewRoute).not.toBeNull();
    });

    it("handles search lifecycle: loading, results, empty, error, cancel", async () => {
      const { controller } = setupController();

      // Successful search
      controller.setSearchQuery("new-stop", "Sheep");
      const searchPromise = controller.searchLocation("new-stop", "Sheep");
      expect(controller.getState().newStopSearch.isSearching).toBe(true);
      await searchPromise;
      expect(controller.getState().newStopSearch.isSearching).toBe(false);
      expect(controller.getState().newStopSearch.searchResults).toEqual([viaLoc]);
      expect(controller.getState().newStopSearch.searchError).toBeNull();

      // Empty results
      controller.setSearchQuery("new-stop", "empty");
      await controller.searchLocation("new-stop", "empty");
      expect(controller.getState().newStopSearch.searchResults).toEqual([]);
      expect(controller.getState().newStopSearch.searchError).toBe('No results found for "empty".');

      // Search error
      controller.setSearchQuery("new-stop", "fail");
      await controller.searchLocation("new-stop", "fail");
      expect(controller.getState().newStopSearch.searchResults).toEqual([]);
      expect(controller.getState().newStopSearch.searchError).toBe("Search network failed");

      // Cancel search
      controller.cancelSearch("new-stop");
      expect(controller.getState().newStopSearch.searchQuery).toBe("");
      expect(controller.getState().newStopSearch.searchResults).toEqual([]);
      expect(controller.getState().newStopSearch.searchError).toBeNull();
      expect(controller.getState().newStopSearch.isSearching).toBe(false);
    });

    it("discards out-of-order stale search responses for new-stop", async () => {
      const { controller, search } = setupController();
      let resolveFirst!: (results: GeocodingResult[]) => void;
      let resolveSecond!: (results: GeocodingResult[]) => void;

      search.mockImplementationOnce(() => new Promise<GeocodingResult[]>((r) => { resolveFirst = r; }));
      search.mockImplementationOnce(() => new Promise<GeocodingResult[]>((r) => { resolveSecond = r; }));

      controller.setSearchQuery("new-stop", "First");
      const pending1 = controller.searchLocation("new-stop", "First");

      controller.setSearchQuery("new-stop", "Second");
      const pending2 = controller.searchLocation("new-stop", "Second");

      // Second completes first
      resolveSecond([altLoc]);
      await pending2;
      expect(controller.getState().newStopSearch.searchResults).toEqual([altLoc]);

      // First completes late -> rejected
      resolveFirst([viaLoc]);
      await pending1;
      expect(controller.getState().newStopSearch.searchResults).toEqual([altLoc]);
    });

    it("commits new-stop search with single undo and cleans staged state", async () => {
      const { controller } = setupController();
      controller.toggleLoop();
      const initialViaCount = controller.getState().viaStops.length;

      controller.setSearchQuery("new-stop", "Sheep");
      await controller.searchLocation("new-stop", "Sheep");

      // Commit
      controller.selectSearchResult("new-stop", viaLoc);
      expect(controller.getState().viaStops.length).toBe(initialViaCount + 1);
      expect(controller.getState().viaStops[initialViaCount]!.name).toBe(viaLoc.name);
      expect(controller.getState().newStopSearch.searchQuery).toBe("");
      expect(controller.getState().newStopSearch.searchResults).toEqual([]);

      // Undo reverts commit
      expect(controller.canUndo()).toBe(true);
      controller.undo();
      expect(controller.getState().viaStops.length).toBe(initialViaCount);
    });

    it("enforces MAX 8 via stops across all new-stop entry points", async () => {
      const { controller } = setupController();

      // Add 8 stops
      for (let i = 0; i < 8; i++) {
        const id = controller.addViaStop();
        controller.selectSearchResult(id, { ...viaLoc, id: `via-${i}`, name: `Stop ${i + 1}` });
      }
      expect(controller.getState().viaStops.length).toBe(8);

      // addViaStop throws at 8
      expect(() => controller.addViaStop()).toThrow("Maximum of 8 via stops reached.");

      // startMapPlacement for new-stop is rejected
      controller.startMapPlacement("new-stop");
      expect(controller.getState().placementTarget).toBeNull();

      // confirmMapPlacement for new-stop is rejected
      controller.confirmMapPlacement("new-stop");
      expect(controller.getState().viaStops.length).toBe(8);

      // setSearchQuery for new-stop sets error
      controller.setSearchQuery("new-stop", "Extra");
      expect(controller.getState().newStopSearch.searchError).toBe("Maximum of 8 stops reached.");

      // searchLocation for new-stop sets error
      await controller.searchLocation("new-stop", "Extra");
      expect(controller.getState().newStopSearch.searchError).toBe("Maximum of 8 stops reached.");

      // selectSearchResult for new-stop is ignored
      controller.selectSearchResult("new-stop", viaLoc);
      expect(controller.getState().viaStops.length).toBe(8);
    });
  });

  describe("R3.2: Blank name Save dead end fix", () => {
    it("keeps isRouteReady() true when ride name is erased, preventing ready dock dead-end", async () => {
      const { controller } = setupController();
      await controller.previewRoute();

      // Initially route is ready and name is "New Ride" -> canSave() is true
      expect(controller.isRouteReady()).toBe(true);
      expect(controller.canOpenSave()).toBe(true);
      expect(controller.canSave()).toBe(true);

      // User enters Save sheet and clears name completely
      controller.setName("");
      // canSave is false (blocking save confirm button)
      expect(controller.canSave()).toBe(false);
      // But isRouteReady remains true (keeping ready dock save button enabled)
      expect(controller.isRouteReady()).toBe(true);
      expect(controller.canOpenSave()).toBe(true);

      // Whitespace-only name also blocks canSave but keeps isRouteReady
      controller.setName("   ");
      expect(controller.canSave()).toBe(false);
      expect(controller.isRouteReady()).toBe(true);

      // User fixes name -> canSave is restored
      controller.setName("Morning River Loop");
      expect(controller.canSave()).toBe(true);
    });
  });
});
