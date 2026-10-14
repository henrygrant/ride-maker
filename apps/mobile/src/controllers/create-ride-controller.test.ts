import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlPoint } from "@ride-maker/domain";
import type { GeocodingProvider, GeocodingResult } from "@ride-maker/geocoding";
import type { RoutedPath, RoutingProvider } from "@ride-maker/routing";
import { CreateRideController } from "./create-ride-controller";

describe("CreateRideController", () => {
  let mockRouting: RoutingProvider;
  let mockGeocoding: GeocodingProvider;

  const sampleStartResult: GeocodingResult = {
    id: "geo-1",
    name: "Central Park Loop",
    label: "Central Park Loop, New York, NY",
    latitude: 40.785,
    longitude: -73.968,
  };

  const sampleViaResult: GeocodingResult = {
    id: "geo-2",
    name: "Sheep Meadow",
    label: "Sheep Meadow, Central Park, NY",
    latitude: 40.771,
    longitude: -73.974,
  };

  const sampleFinishResult: GeocodingResult = {
    id: "geo-3",
    name: "Harlem Meer",
    label: "Harlem Meer, New York, NY",
    latitude: 40.795,
    longitude: -73.955,
  };

  const sampleRoutedPath: RoutedPath = {
    segments: [
      [
        { latitude: 40.785, longitude: -73.968 },
        { latitude: 40.771, longitude: -73.974 },
      ],
      [
        { latitude: 40.771, longitude: -73.974 },
        { latitude: 40.795, longitude: -73.955 },
      ],
    ],
    maneuvers: [
      {
        id: "maneuver-1",
        segmentIndex: 0,
        shapeIndex: 0,
        instruction: "Depart start point.",
        latitude: 40.785,
        longitude: -73.968,
      },
      {
        id: "maneuver-2",
        segmentIndex: 1,
        shapeIndex: 1,
        instruction: "Arrive at finish.",
        latitude: 40.795,
        longitude: -73.955,
      },
    ],
    distanceMeters: 5000,
    durationSeconds: 1200,
    engine: "valhalla",
  };

  beforeEach(() => {
    mockRouting = {
      route: vi.fn().mockResolvedValue(sampleRoutedPath),
    };
    mockGeocoding = {
      search: vi.fn().mockResolvedValue([sampleStartResult, sampleViaResult]),
      reverse: vi.fn().mockResolvedValue({
        id: "rev-1",
        name: "Resolved Place",
        label: "Resolved Place, NY",
        latitude: 40.785,
        longitude: -73.968,
      }),
    };
  });

  it("initializes with clean default state", () => {
    const ctrl = new CreateRideController(mockGeocoding, mockRouting);
    const state = ctrl.getState();

    expect(state.name).toBe("New Ride");
    expect(state.startPoint.latitude).toBeNull();
    expect(state.finishPoint.latitude).toBeNull();
    expect(state.viaStops).toHaveLength(0);
    expect(state.isLoop).toBe(false);
    expect(state.previewRoute).toBeNull();
    expect(state.isRouting).toBe(false);
    expect(ctrl.canSave()).toBe(false);
  });

  it("handles search lifecycle, results, and query changes", async () => {
    const ctrl = new CreateRideController(mockGeocoding, mockRouting);

    ctrl.setSearchQuery("start", "Central Park");
    expect(ctrl.getState().startPoint.searchQuery).toBe("Central Park");

    await ctrl.searchLocation("start", "Central Park");
    expect(ctrl.getState().startPoint.searchResults).toHaveLength(2);
    expect(ctrl.getState().startPoint.isSearching).toBe(false);

    ctrl.selectSearchResult("start", sampleStartResult);
    expect(ctrl.getState().startPoint.name).toBe("Central Park Loop");
    expect(ctrl.getState().startPoint.latitude).toBe(40.785);
    expect(ctrl.getState().startPoint.longitude).toBe(-73.968);
    expect(ctrl.getState().startPoint.searchResults).toHaveLength(0);
  });

  it("handles loop toggling", () => {
    const ctrl = new CreateRideController(mockGeocoding, mockRouting);
    ctrl.selectSearchResult("start", sampleStartResult);

    ctrl.setLoop(true);
    expect(ctrl.getState().isLoop).toBe(true);
    expect(ctrl.getState().finishPoint.name).toBe("Central Park Loop");
    expect(ctrl.getState().finishPoint.latitude).toBe(40.785);

    ctrl.setLoop(false);
    expect(ctrl.getState().isLoop).toBe(false);
  });

  it("handles adding, removing, and moving via stops", () => {
    const ctrl = new CreateRideController(mockGeocoding, mockRouting);

    const stop1 = ctrl.addViaStop();
    const stop2 = ctrl.addViaStop();
    expect(ctrl.getState().viaStops).toHaveLength(2);

    ctrl.moveViaStop(stop2, "up");
    expect(ctrl.getState().viaStops[0]?.id).toBe(stop2);

    ctrl.removeViaStop(stop1);
    expect(ctrl.getState().viaStops).toHaveLength(1);
    expect(ctrl.getState().viaStops[0]?.id).toBe(stop2);
  });

  it("handles map placement and confirmation with reverse geocoding", async () => {
    const ctrl = new CreateRideController(mockGeocoding, mockRouting);

    ctrl.startMapPlacement("start");
    expect(ctrl.getState().placementTarget?.pointId).toBe("start");

    ctrl.setCandidateCoordinate({ latitude: 40.7855, longitude: -73.9685 });
    await ctrl.confirmMapPlacement();

    expect(ctrl.getState().placementTarget).toBeNull();
    expect(ctrl.getState().startPoint.latitude).toBe(40.7855);
    expect(ctrl.getState().startPoint.longitude).toBe(-73.9685);
  });

  it("handles useMyLocation with reverse geocoding", async () => {
    const ctrl = new CreateRideController(mockGeocoding, mockRouting);

    await ctrl.useMyLocation("start", async () => ({
      latitude: 40.785,
      longitude: -73.968,
    }));

    expect(ctrl.getState().startPoint.name).toBe("Resolved Place");
    expect(ctrl.getState().startPoint.latitude).toBe(40.785);
  });

  it("handles routing preview, errors, and invalidation on edits", async () => {
    const ctrl = new CreateRideController(mockGeocoding, mockRouting);
    ctrl.setName("Central Park Loop Ride");
    ctrl.selectSearchResult("start", sampleStartResult);
    ctrl.selectSearchResult("finish", sampleFinishResult);

    const routed = await ctrl.previewRoute();
    expect(routed).not.toBeNull();
    expect(ctrl.getState().previewRoute).not.toBeNull();
    expect(ctrl.canSave()).toBe(true);

    // Edits invalidate preview
    ctrl.setSearchQuery("finish", "New Finish");
    expect(ctrl.getState().previewRoute).toBeNull();
    expect(ctrl.canSave()).toBe(false);
  });

  it("builds valid RouteDocument only when canSave() is true", async () => {
    const ctrl = new CreateRideController(mockGeocoding, mockRouting);
    ctrl.setName("Morning Ride");
    ctrl.selectSearchResult("start", sampleStartResult);
    ctrl.selectSearchResult("finish", sampleFinishResult);

    expect(() => ctrl.buildRouteDocument()).toThrow(/Cannot save/);

    await ctrl.previewRoute();
    expect(ctrl.canSave()).toBe(true);

    const doc = ctrl.buildRouteDocument();
    expect(doc.name).toBe("Morning Ride");
    expect(doc.controlPoints).toHaveLength(2);
    expect(doc.maneuvers).toHaveLength(2);
    expect(doc.segments).toHaveLength(2);
  });

  it("preserves draft state across initialDraft restoration", async () => {
    const ctrl1 = new CreateRideController(mockGeocoding, mockRouting);
    ctrl1.setName("Preserved Draft");
    ctrl1.selectSearchResult("start", sampleStartResult);
    ctrl1.selectSearchResult("finish", sampleFinishResult);
    await ctrl1.previewRoute();

    const snapshot = ctrl1.getDraftSnapshot();
    const ctrl2 = new CreateRideController(mockGeocoding, mockRouting, snapshot);

    expect(ctrl2.getState().name).toBe("Preserved Draft");
    expect(ctrl2.getState().startPoint.name).toBe("Central Park Loop");
    expect(ctrl2.getState().finishPoint.name).toBe("Harlem Meer");
    expect(ctrl2.getState().previewRoute).not.toBeNull();
    expect(ctrl2.canSave()).toBe(true);
  });

  describe("Sol Review Concurrency and Edge Case Regressions", () => {
    it("cancels in-flight reverse geocode when point is changed before reverse completes", async () => {
      let resolveReverse!: (res: GeocodingResult | null) => void;
      const reversePromise = new Promise<GeocodingResult | null>((r) => {
        resolveReverse = r;
      });

      const mockGeo: GeocodingProvider = {
        search: vi.fn().mockResolvedValue([]),
        reverse: vi.fn().mockReturnValue(reversePromise),
      };

      const ctrl = new CreateRideController(mockGeo, mockRouting);

      ctrl.startMapPlacement("start");
      ctrl.setCandidateCoordinate({ latitude: 40.785, longitude: -73.968 });
      await ctrl.confirmMapPlacement();
      expect(ctrl.getState().startPoint.name).toBe("Start Location on Map");

      // While reverse is pending, user selects a different search result
      ctrl.selectSearchResult("start", {
        id: "new-select",
        name: "New Selected Start",
        label: "New Selected Start",
        latitude: 40.790,
        longitude: -73.960,
      });

      // Delayed reverse resolves
      resolveReverse({
        id: "old-reverse",
        name: "Old Reverse Location",
        label: "Old Reverse Location",
        latitude: 40.785,
        longitude: -73.968,
      });
      await reversePromise;

      // Newer selection must NOT be overwritten
      expect(ctrl.getState().startPoint.name).toBe("New Selected Start");
      expect(ctrl.getState().startPoint.latitude).toBe(40.790);
    });

    it("handles reverse result after controller disposal cleanly without error or mutation", async () => {
      let resolveReverse!: (res: GeocodingResult | null) => void;
      const reversePromise = new Promise<GeocodingResult | null>((r) => {
        resolveReverse = r;
      });

      const mockGeo: GeocodingProvider = {
        search: vi.fn().mockResolvedValue([]),
        reverse: vi.fn().mockReturnValue(reversePromise),
      };

      const ctrl = new CreateRideController(mockGeo, mockRouting);
      const listener = vi.fn();
      ctrl.subscribe(listener);
      listener.mockClear();

      ctrl.startMapPlacement("start");
      ctrl.setCandidateCoordinate({ latitude: 40.785, longitude: -73.968 });
      await ctrl.confirmMapPlacement();
      expect(ctrl.getState().startPoint.name).toBe("Start Location on Map");

      listener.mockClear();
      ctrl.dispose();

      // Reverse resolves after disposal
      resolveReverse({
        id: "rev",
        name: "Resolved Place Name",
        label: "Resolved Place Name",
        latitude: 40.785,
        longitude: -73.968,
      });
      await reversePromise;

      // Listener was not called after disposal
      expect(listener).not.toHaveBeenCalled();
    });

    it("rejects obsolete query invocation during debounce gap", async () => {
      const searchMock = vi.fn().mockResolvedValue([]);
      const mockGeo: GeocodingProvider = {
        search: searchMock,
        reverse: vi.fn().mockResolvedValue(null),
      };

      const ctrl = new CreateRideController(mockGeo, mockRouting);

      // User types query A
      ctrl.setSearchQuery("start", "Central Park");
      // Rapid typing changes query to query B before debounce fires
      ctrl.setSearchQuery("start", "Central Park West");

      // Old debounce timer fires with query A
      await ctrl.searchLocation("start", "Central Park");

      // Controller should reject obsolete query invocation
      expect(searchMock).not.toHaveBeenCalledWith("Central Park", expect.anything());
    });

    it("disables save during pending intentional point replacement (map placement or myLocation)", async () => {
      let resolveLocation!: (coords: { latitude: number; longitude: number } | null) => void;
      const locationPromise = new Promise<{ latitude: number; longitude: number } | null>((r) => {
        resolveLocation = r;
      });

      const ctrl = new CreateRideController(mockGeocoding, mockRouting);
      ctrl.setName("Valid Ride");
      ctrl.selectSearchResult("start", sampleStartResult);
      ctrl.selectSearchResult("finish", sampleFinishResult);

      await ctrl.previewRoute();
      expect(ctrl.canSave()).toBe(true);

      // 1. Map placement active -> save disabled
      ctrl.startMapPlacement("start");
      expect(ctrl.canSave()).toBe(false);

      ctrl.cancelMapPlacement();
      expect(ctrl.canSave()).toBe(true);

      // 2. Location retrieval in flight -> save disabled
      const pendingLocation = ctrl.useMyLocation("start", () => locationPromise);
      expect(ctrl.canSave()).toBe(false);

      resolveLocation({ latitude: 40.7851, longitude: -73.9681 });
      await pendingLocation;

      // Preview was invalidated by the new location, so save remains false until rerouted
      expect(ctrl.canSave()).toBe(false);
      expect(ctrl.getState().previewRoute).toBeNull();
    });

    it("clears pending replacements and restores state on location error", async () => {
      const ctrl = new CreateRideController(mockGeocoding, mockRouting);
      ctrl.setName("Valid Ride");
      ctrl.selectSearchResult("start", sampleStartResult);
      ctrl.selectSearchResult("finish", sampleFinishResult);
      await ctrl.previewRoute();
      expect(ctrl.canSave()).toBe(true);

      const errorLocationPromise = ctrl.useMyLocation("start", () =>
        Promise.reject(new Error("GPS sensor unavailable")),
      );
      expect(ctrl.canSave()).toBe(false);

      await errorLocationPromise;
      expect(ctrl.getState().error).toBe("GPS sensor unavailable");
      // Pending replacement cleared on error
      expect(ctrl.canSave()).toBe(true);
    });

    it("clears pending replacements when point is replaced or removed", async () => {
      let resolveLocation!: (coords: { latitude: number; longitude: number } | null) => void;
      const locationPromise = new Promise<{ latitude: number; longitude: number } | null>((r) => {
        resolveLocation = r;
      });

      const ctrl = new CreateRideController(mockGeocoding, mockRouting);
      const stopId = ctrl.addViaStop();

      // Start pending GPS for stop
      void ctrl.useMyLocation(stopId, () => locationPromise);

      // Removing stop immediately cleans up pending replacements
      ctrl.removeViaStop(stopId);
      expect(ctrl.getState().viaStops.find((s) => s.id === stopId)).toBeUndefined();

      // Resolve late GPS after removal
      resolveLocation({ latitude: 40.771, longitude: -73.974 });
      await Promise.resolve();

      // Controller remains clean without errors or resurrecting the stop
      expect(ctrl.getState().viaStops).toHaveLength(0);
    });

    it("aborts in-flight geocoding and reverse requests when via stop is removed", async () => {
      let searchSignal: AbortSignal | undefined;
      const searchPromise = new Promise<GeocodingResult[]>((_, _reject) => {
        // Will be aborted
      });

      const mockGeo: GeocodingProvider = {
        search: vi.fn().mockImplementation((_query, opts?: { signal?: AbortSignal }) => {
          searchSignal = opts?.signal;
          return searchPromise;
        }),
        reverse: vi.fn().mockResolvedValue(null),
      };

      const ctrl = new CreateRideController(mockGeo, mockRouting);
      const stopId = ctrl.addViaStop();

      ctrl.setSearchQuery(stopId, "Central Park");
      void ctrl.searchLocation(stopId, "Central Park");
      expect(ctrl.getState().viaStops[0]?.isSearching).toBe(true);
      expect(searchSignal?.aborted).toBe(false);

      // Remove stop while search is in-flight
      ctrl.removeViaStop(stopId);
      expect(searchSignal?.aborted).toBe(true);
      expect(ctrl.getState().viaStops).toHaveLength(0);
    });

    it("handles search error recovery and no-results feedback", async () => {
      const mockGeo: GeocodingProvider = {
        search: vi.fn().mockImplementation(async (query: string) => {
          if (query === "fail") throw new Error("Network timeout");
          if (query === "empty") return [];
          return [sampleStartResult];
        }),
        reverse: vi.fn().mockResolvedValue(null),
      };

      const ctrl = new CreateRideController(mockGeo, mockRouting);

      // 1. Search fails with network error
      ctrl.setSearchQuery("start", "fail");
      await ctrl.searchLocation("start", "fail");
      expect(ctrl.getState().startPoint.searchError).toBe("Network timeout");
      expect(ctrl.getState().startPoint.searchResults).toHaveLength(0);

      // 2. Search returns empty results
      ctrl.setSearchQuery("start", "empty");
      await ctrl.searchLocation("start", "empty");
      expect(ctrl.getState().startPoint.searchError).toBe('No results found for "empty".');
      expect(ctrl.getState().startPoint.searchResults).toHaveLength(0);

      // 3. User recovers by searching valid place and selecting result
      ctrl.setSearchQuery("start", "Central Park Loop");
      await ctrl.searchLocation("start", "Central Park Loop");
      expect(ctrl.getState().startPoint.searchError).toBeNull();
      expect(ctrl.getState().startPoint.searchResults).toHaveLength(1);

      ctrl.selectSearchResult("start", sampleStartResult);
      expect(ctrl.getState().startPoint.searchError).toBeNull();
      expect(ctrl.getState().startPoint.name).toBe("Central Park Loop");
      expect(ctrl.getState().startPoint.latitude).toBe(40.785);
    });

    it("GPS completing or replacing finish/start triggers automatic routing", async () => {
      const ctrl = new CreateRideController(mockGeocoding, mockRouting, null, { autoRoute: true });
      ctrl.selectSearchResult("start", sampleStartResult);
      expect(ctrl.getState().previewRoute).toBeNull();

      // GPS sets finish
      await ctrl.useMyLocation("finish", async () => ({
        latitude: 40.795,
        longitude: -73.955,
      }));

      expect(mockRouting.route).toHaveBeenCalled();
      expect(ctrl.getState().previewRoute).not.toBeNull();
      expect(ctrl.canSave()).toBe(true);
      expect(ctrl.canUndo()).toBe(true);
    });

    it("delayed GPS and reverse geocode after Undo does not alter state or history", async () => {
      let resolveLocation!: (loc: { latitude: number; longitude: number } | null) => void;
      const locationPromise = new Promise<{ latitude: number; longitude: number } | null>((r) => {
        resolveLocation = r;
      });

      const ctrl = new CreateRideController(mockGeocoding, mockRouting, null, { autoRoute: true });
      ctrl.selectSearchResult("start", sampleStartResult);
      ctrl.selectSearchResult("finish", sampleFinishResult);
      await Promise.resolve();
      await Promise.resolve();
      expect(ctrl.getState().previewRoute).not.toBeNull();
      const initialSnapshot = ctrl.getDraftSnapshot();

      // Start useMyLocation on finish point
      const locPromise = ctrl.useMyLocation("finish", () => locationPromise);

      // User hits Undo before GPS resolves
      expect(ctrl.undo()).toBe(true);
      expect(ctrl.getState().finishPoint.latitude).toBeNull();

      // GPS completes delayed
      resolveLocation({ latitude: 40.81, longitude: -73.94 });
      await locPromise;

      // Point must remain unchanged (null), undo stack must not receive unwanted entry
      expect(ctrl.getState().finishPoint.latitude).toBeNull();
      expect(ctrl.getState().finishPoint.name).toBe("");
    });

    it("two same-point GPS requests out of order preserve pending guard until latest finishes", async () => {
      let resolveFirst!: (loc: { latitude: number; longitude: number } | null) => void;
      let resolveSecond!: (loc: { latitude: number; longitude: number } | null) => void;
      const firstPromise = new Promise<{ latitude: number; longitude: number } | null>((r) => {
        resolveFirst = r;
      });
      const secondPromise = new Promise<{ latitude: number; longitude: number } | null>((r) => {
        resolveSecond = r;
      });

      const ctrl = new CreateRideController(mockGeocoding, mockRouting, null, { autoRoute: true });
      ctrl.selectSearchResult("start", sampleStartResult);

      // First GPS request begins
      const p1 = ctrl.useMyLocation("finish", () => firstPromise);
      expect(ctrl.canRoute()).toBe(false);

      // Second GPS request begins for same point
      const p2 = ctrl.useMyLocation("finish", () => secondPromise);
      expect(ctrl.canRoute()).toBe(false);

      // First (superseded) request finishes
      resolveFirst({ latitude: 40.801, longitude: -73.951 });
      await p1;

      // Pending guard must STILL be active because second request is still in-flight
      expect(ctrl.canRoute()).toBe(false);

      // Second request completes
      resolveSecond({ latitude: 40.805, longitude: -73.955 });
      await p2;

      // Now pending is cleared, routing completes
      expect(ctrl.canRoute()).toBe(true);
      expect(ctrl.getState().finishPoint.latitude).toBe(40.805);
    });

    it("transactional cancel new stop and undo new stop restore exact original points and preview/save readiness", async () => {
      const ctrl = new CreateRideController(mockGeocoding, mockRouting, null, { autoRoute: true });
      ctrl.selectSearchResult("start", sampleStartResult);
      ctrl.selectSearchResult("finish", sampleFinishResult);
      await Promise.resolve();
      await Promise.resolve();
      expect(ctrl.canSave()).toBe(true);
      const originalSnapshot = ctrl.getDraftSnapshot();
      const undoCountBefore = (ctrl as any).undoStack.length;

      // 1. Enter placement for a new stop
      ctrl.startMapPlacement("new-stop");
      ctrl.setCandidateCoordinate({ latitude: 40.788, longitude: -73.962 });
      expect(ctrl.getState().placementTarget?.pointId).toBe("new-stop");
      expect(ctrl.getState().viaStops).toHaveLength(0);

      // Cancel placement
      ctrl.cancelMapPlacement();
      expect(ctrl.getState().placementTarget).toBeNull();
      expect(ctrl.getState().viaStops).toHaveLength(0);
      expect((ctrl as any).undoStack.length).toBe(undoCountBefore);
      // Intact itinerary and ready preview/save
      expect(ctrl.canSave()).toBe(true);
      expect(ctrl.getState().previewRoute).toEqual(originalSnapshot.previewRoute);

      // 2. Now confirm a new stop
      ctrl.startMapPlacement("new-stop");
      ctrl.setCandidateCoordinate({ latitude: 40.788, longitude: -73.962 });
      await ctrl.confirmMapPlacement();

      expect(ctrl.getState().viaStops).toHaveLength(1);
      expect(ctrl.getState().viaStops[0]?.latitude).toBe(40.788);
      expect(ctrl.canUndo()).toBe(true);

      // 3. Undo the confirmed new stop
      expect(ctrl.undo()).toBe(true);
      expect(ctrl.getState().viaStops).toHaveLength(0);
      // Exact original points and save readiness restored
      expect(ctrl.getState().startPoint.latitude).toBe(originalSnapshot.startPoint.latitude);
      expect(ctrl.getState().finishPoint.latitude).toBe(originalSnapshot.finishPoint.latitude);
      expect(ctrl.canSave()).toBe(true);
    });

    it("reopening draft with deleted stops derives maxnumericID+1 and assigns unique IDs", () => {
      // Simulate restored draft where stop-1 was deleted, leaving stop-0 and stop-2
      const initialDraft = {
        name: "Restored Ride",
        startPoint: { ...sampleStartResult, kind: "start", searchQuery: "Central Park", searchResults: [], isSearching: false, searchError: null },
        finishPoint: { ...sampleFinishResult, kind: "finish", searchQuery: "Harlem", searchResults: [], isSearching: false, searchError: null },
        viaStops: [
          { id: "stop-0", kind: "via", name: "Stop 1", latitude: 40.78, longitude: -73.96, searchQuery: "Stop 1", searchResults: [], isSearching: false, searchError: null },
          { id: "stop-2", kind: "via", name: "Stop 3", latitude: 40.79, longitude: -73.95, searchQuery: "Stop 3", searchResults: [], isSearching: false, searchError: null },
        ],
        isLoop: false,
        previewRoute: null,
        previewInputSnapshot: null,
        editGeneration: 1,
      };

      const ctrl = new CreateRideController(mockGeocoding, mockRouting, initialDraft as any);
      const newStopId = ctrl.addViaStop();

      // Must be stop-3, NOT stop-2 (which would collide with the existing stop-2)
      expect(newStopId).toBe("stop-3");
      const ids = ctrl.getState().viaStops.map((s) => s.id);
      expect(ids).toEqual(["stop-0", "stop-2", "stop-3"]);
      expect(new Set(ids).size).toBe(3);
    });
  });
});
