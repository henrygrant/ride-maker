import type { ControlPoint, RouteDocument } from "@ride-maker/domain";
import type { GeocodingProvider, GeocodingResult } from "@ride-maker/geocoding";
import type { RoutingProvider, RoutedPath } from "@ride-maker/routing";

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface DraftPointState {
  id: string;
  kind: "start" | "via" | "finish";
  name: string;
  searchQuery: string;
  searchResults: GeocodingResult[];
  isSearching: boolean;
  searchError: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface CreateRideState {
  name: string;
  startPoint: DraftPointState;
  finishPoint: DraftPointState;
  viaStops: DraftPointState[];
  isLoop: boolean;
  newStopSearch: DraftPointState;
  placementTarget: { pointId: string; label: string } | null;
  candidateCoordinate: Coordinate | null;
  isRouting: boolean;
  previewRoute: RoutedPath | null;
  stalePreviewRoute: RoutedPath | null;
  previewInputSnapshot: ControlPoint[] | null;
  error: string | null;
  editGeneration: number;
  canUndo: boolean;
}

export type ControllerState = CreateRideState;

export interface ControllerDraftSnapshot {
  name: string;
  startPoint: DraftPointState;
  finishPoint: DraftPointState;
  viaStops: DraftPointState[];
  isLoop: boolean;
  previewRoute: RoutedPath | null;
  previewInputSnapshot: ControlPoint[] | null;
  editGeneration: number;
}

export interface CreateRideControllerOptions {
  autoRoute?: boolean;
}

function deriveNextStopSeq(viaStops: Array<{ id: string }>): number {
  let maxSeq = 0;
  for (const stop of viaStops) {
    const match = /^stop-(\d+)$/.exec(stop.id);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (Number.isFinite(num)) {
        maxSeq = Math.max(maxSeq, num + 1);
      }
    }
  }
  return maxSeq;
}

function createInitialNewStopSearch(): DraftPointState {
  return {
    id: "new-stop",
    kind: "via",
    name: "",
    searchQuery: "",
    searchResults: [],
    isSearching: false,
    searchError: null,
    latitude: null,
    longitude: null,
  };
}

export class CreateRideController {
  private geocodingProvider: GeocodingProvider;
  private routingProvider: RoutingProvider;
  private state: CreateRideState;
  private listeners = new Set<(state: CreateRideState) => void>();
  private searchAbortControllers = new Map<string, AbortController>();
  private searchGenerations = new Map<string, number>();
  private pointGenerations = new Map<string, number>();
  private reverseAbortControllers = new Map<string, AbortController>();
  private routingAbortController: AbortController | null = null;
  private pendingReplacements = new Map<string, number>();
  private undoStack: ControllerDraftSnapshot[] = [];
  private nextStopSeq = 0;
  private disposed = false;
  private autoRouteEnabled = false;

  constructor(
    arg1: GeocodingProvider | RoutingProvider,
    arg2: GeocodingProvider | RoutingProvider,
    initialDraft?: ControllerDraftSnapshot | null,
    options?: CreateRideControllerOptions,
  ) {
    if ("route" in arg1 && "search" in arg2) {
      this.routingProvider = arg1 as RoutingProvider;
      this.geocodingProvider = arg2 as GeocodingProvider;
    } else {
      this.geocodingProvider = arg1 as GeocodingProvider;
      this.routingProvider = arg2 as RoutingProvider;
    }

    this.autoRouteEnabled = options?.autoRoute ?? false;

    if (initialDraft) {
      this.state = {
        name: initialDraft.name,
        startPoint: { ...initialDraft.startPoint, searchResults: [] },
        finishPoint: { ...initialDraft.finishPoint, searchResults: [] },
        viaStops: initialDraft.viaStops.map((s) => ({ ...s, searchResults: [] })),
        isLoop: initialDraft.isLoop,
        newStopSearch: createInitialNewStopSearch(),
        placementTarget: null,
        candidateCoordinate: null,
        isRouting: false,
        previewRoute: initialDraft.previewRoute,
        stalePreviewRoute: null,
        previewInputSnapshot: initialDraft.previewInputSnapshot,
        error: null,
        editGeneration: initialDraft.editGeneration ?? 0,
        canUndo: false,
      };
      this.nextStopSeq = deriveNextStopSeq(initialDraft.viaStops);
    } else {
      this.state = {
        name: "New Ride",
        startPoint: {
          id: "start",
          kind: "start",
          name: "",
          searchQuery: "",
          searchResults: [],
          isSearching: false,
          searchError: null,
          latitude: null,
          longitude: null,
        },
        finishPoint: {
          id: "finish",
          kind: "finish",
          name: "",
          searchQuery: "",
          searchResults: [],
          isSearching: false,
          searchError: null,
          latitude: null,
          longitude: null,
        },
        viaStops: [],
        isLoop: false,
        newStopSearch: createInitialNewStopSearch(),
        placementTarget: null,
        candidateCoordinate: null,
        isRouting: false,
        previewRoute: null,
        stalePreviewRoute: null,
        previewInputSnapshot: null,
        error: null,
        editGeneration: 0,
        canUndo: false,
      };
      this.nextStopSeq = 0;
    }

    this.pointGenerations.set("start", 0);
    this.pointGenerations.set("finish", 0);
    this.pointGenerations.set("new-stop", 0);
    for (const stop of this.state.viaStops) {
      this.pointGenerations.set(stop.id, 0);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    for (const ctrl of this.searchAbortControllers.values()) {
      ctrl.abort();
    }
    this.searchAbortControllers.clear();
    for (const ctrl of this.reverseAbortControllers.values()) {
      ctrl.abort();
    }
    this.reverseAbortControllers.clear();
    if (this.routingAbortController) {
      this.routingAbortController.abort();
      this.routingAbortController = null;
    }
    this.undoStack = [];
    this.pendingReplacements.clear();
  }

  subscribe(listener: (state: CreateRideState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): Readonly<CreateRideState> {
    return this.state;
  }

  getDraftSnapshot(): ControllerDraftSnapshot {
    return {
      name: this.state.name,
      startPoint: { ...this.state.startPoint },
      finishPoint: { ...this.state.finishPoint },
      viaStops: this.state.viaStops.map((s) => ({ ...s })),
      isLoop: this.state.isLoop,
      previewRoute: this.state.previewRoute,
      previewInputSnapshot: this.state.previewInputSnapshot
        ? [...this.state.previewInputSnapshot]
        : null,
      editGeneration: this.state.editGeneration,
    };
  }

  exportDraft(): ControllerDraftSnapshot {
    return this.getDraftSnapshot();
  }

  isDirty(): boolean {
    if (this.state.name !== "New Ride") return true;
    if (this.state.startPoint.latitude !== null || this.state.startPoint.searchQuery !== "") return true;
    if (this.state.finishPoint.latitude !== null || this.state.finishPoint.searchQuery !== "") return true;
    if (this.state.viaStops.length > 0) return true;
    if (this.state.isLoop) return true;
    return false;
  }

  isRouteReady(): boolean {
    if (this.state.isRouting) return false;
    if (this.state.placementTarget !== null) return false;
    if (this.pendingReplacements.size > 0) return false;
    if (!this.state.previewRoute) return false;
    if (!this.state.previewInputSnapshot) return false;

    // Verify current points match snapshot that was routed
    const currentControlPoints = this.buildCurrentControlPoints();
    if (!currentControlPoints) return false;

    const snap = this.state.previewInputSnapshot;
    if (currentControlPoints.length !== snap.length) return false;

    for (let i = 0; i < currentControlPoints.length; i++) {
      const cur = currentControlPoints[i]!;
      const s = snap[i]!;
      if (cur.id !== s.id) return false;
      if (cur.latitude !== s.latitude || cur.longitude !== s.longitude) return false;
    }

    return true;
  }

  canOpenSave(): boolean {
    return this.isRouteReady();
  }

  canSave(): boolean {
    if (!this.isRouteReady()) return false;
    if (!this.state.name.trim()) return false;
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.restoreDraft(previous, { clearUndo: false });
    if (this.autoRouteEnabled && this.canRoute() && !this.state.previewRoute) {
      void this.previewRoute();
    }
    return true;
  }

  setName(name: string): void {
    this.state.name = name;
    this.emit();
  }

  setSearchQuery(pointId: string, query: string, options: { preserveSelection?: boolean } = {}): void {
    if (pointId === "new-stop") {
      if (this.state.viaStops.length >= 8) {
        this.state.newStopSearch.searchError = "Maximum of 8 stops reached.";
        this.state.newStopSearch.searchResults = [];
        this.state.newStopSearch.isSearching = false;
        this.emit();
        return;
      }
      const prevCtrl = this.searchAbortControllers.get("new-stop");
      if (prevCtrl) prevCtrl.abort();
      this.searchAbortControllers.delete("new-stop");
      this.searchGenerations.set("new-stop", (this.searchGenerations.get("new-stop") ?? 0) + 1);

      this.state.newStopSearch.searchQuery = query;
      this.state.newStopSearch.searchResults = [];
      this.state.newStopSearch.isSearching = false;
      this.state.newStopSearch.searchError = null;
      this.emit();
      return;
    }

    const pt = this.findPoint(pointId);
    if (!pt) return;

    this.pendingReplacements.delete(pointId);
    this.bumpPointGeneration(pointId);

    // Cancel in-flight search
    const prevCtrl = this.searchAbortControllers.get(pointId);
    if (prevCtrl) prevCtrl.abort();
    this.searchAbortControllers.delete(pointId);
    this.searchGenerations.set(pointId, (this.searchGenerations.get(pointId) ?? 0) + 1);

    pt.searchQuery = query;
    pt.searchResults = [];
    pt.isSearching = false;
    pt.searchError = null;

    // Focused search can stage a query without changing the confirmed itinerary.
    if (options.preserveSelection) {
      this.emit();
      return;
    }

    // Clear coordinate selection when search query changes away from established point
    pt.name = query;
    pt.latitude = null;
    pt.longitude = null;

    if (this.state.isLoop && pointId === "start") {
      this.bumpPointGeneration("finish");
      this.state.finishPoint.searchQuery = query;
      this.state.finishPoint.name = query;
      this.state.finishPoint.latitude = null;
      this.state.finishPoint.longitude = null;
    }

    this.invalidatePreview();
    this.emit();
  }

  cancelSearch(pointId: string): void {
    const pt = this.findPoint(pointId);
    if (!pt) return;
    this.searchAbortControllers.get(pointId)?.abort();
    this.searchAbortControllers.delete(pointId);
    this.searchGenerations.set(pointId, (this.searchGenerations.get(pointId) ?? 0) + 1);
    pt.searchQuery = pt.name;
    pt.searchResults = [];
    pt.searchError = null;
    pt.isSearching = false;
    this.emit();
  }

  canRoute(): boolean {
    if (this.pendingReplacements.size > 0 || this.state.placementTarget) return false;
    const points = this.buildCurrentControlPoints();
    if (!points) return false;
    if (this.state.isLoop) {
      const start = points[0]!;
      return (
        this.state.viaStops.length > 0 &&
        this.state.viaStops.every(
          (point) => point.latitude !== null && point.longitude !== null &&
            (point.latitude !== start.latitude || point.longitude !== start.longitude),
        )
      );
    }
    return true;
  }

  // Undo restores confirmed data while cancelling every request from the discarded edit.
  restoreDraft(draft: ControllerDraftSnapshot, options?: { clearUndo?: boolean }): void {
    if (options?.clearUndo) {
      this.undoStack = [];
    }
    this.routingAbortController?.abort();
    this.routingAbortController = null;
    for (const ctrl of this.searchAbortControllers.values()) ctrl.abort();
    for (const ctrl of this.reverseAbortControllers.values()) ctrl.abort();
    this.searchAbortControllers.clear();
    this.reverseAbortControllers.clear();
    this.pendingReplacements.clear();
    for (const id of this.pointGenerations.keys()) this.bumpPointGeneration(id);
    for (const [id, gen] of this.searchGenerations) this.searchGenerations.set(id, gen + 1);
    const clean = (point: DraftPointState): DraftPointState => ({
      ...point,
      searchQuery: point.name,
      searchResults: [],
      isSearching: false,
      searchError: null,
    });
    this.state = {
      ...draft,
      startPoint: clean(draft.startPoint),
      finishPoint: clean(draft.finishPoint),
      viaStops: draft.viaStops.map(clean),
      newStopSearch: createInitialNewStopSearch(),
      placementTarget: null,
      candidateCoordinate: null,
      isRouting: false,
      stalePreviewRoute: null,
      error: null,
      editGeneration: this.state.editGeneration + 1,
      canUndo: this.undoStack.length > 0,
    };
    for (const point of this.state.viaStops) {
      this.pointGenerations.set(point.id, (this.pointGenerations.get(point.id) ?? 0) + 1);
    }
    this.nextStopSeq = deriveNextStopSeq(this.state.viaStops);
    this.emit();
  }

  async searchLocation(pointId: string, query: string): Promise<void> {
    if (pointId === "new-stop" && this.state.viaStops.length >= 8) {
      this.state.newStopSearch.searchResults = [];
      this.state.newStopSearch.isSearching = false;
      this.state.newStopSearch.searchError = "Maximum of 8 stops reached.";
      this.emit();
      return;
    }

    const pt = this.findPoint(pointId);
    if (!pt) return;

    // Reject obsolete query invocation immediately
    if (query !== pt.searchQuery) return;

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      pt.searchResults = [];
      pt.isSearching = false;
      pt.searchError = null;
      this.emit();
      return;
    }

    // Cancel in-flight search for this point
    const prevCtrl = this.searchAbortControllers.get(pointId);
    if (prevCtrl) prevCtrl.abort();

    const ctrl = new AbortController();
    this.searchAbortControllers.set(pointId, ctrl);
    const gen = (this.searchGenerations.get(pointId) ?? 0) + 1;
    this.searchGenerations.set(pointId, gen);

    pt.isSearching = true;
    pt.searchError = null;
    this.emit();

    try {
      const results = await this.geocodingProvider.search(trimmed, { signal: ctrl.signal });
      if (this.disposed) return;
      if (this.searchGenerations.get(pointId) !== gen) return;
      if (ctrl.signal.aborted) return;
      if (pt.searchQuery !== query) return;

      pt.isSearching = false;
      pt.searchResults = results;
      if (results.length === 0) {
        pt.searchError = `No results found for "${trimmed}".`;
      }
      this.emit();
    } catch (err) {
      if (this.disposed) return;
      if (this.searchGenerations.get(pointId) !== gen) return;
      if (ctrl.signal.aborted) return;
      if (pt.searchQuery !== query) return;

      pt.isSearching = false;
      pt.searchResults = [];
      pt.searchError = err instanceof Error ? err.message : "Search request failed.";
      this.emit();
    }
  }

  selectSearchResult(pointId: string, result: GeocodingResult): void {
    if (pointId === "new-stop") {
      if (this.state.viaStops.length >= 8) return;
      this.pushUndo();
      const id = `stop-${this.nextStopSeq++}`;
      const newStop: DraftPointState = {
        id,
        kind: "via",
        name: result.name,
        searchQuery: result.name,
        searchResults: [],
        isSearching: false,
        searchError: null,
        latitude: result.latitude,
        longitude: result.longitude,
      };
      this.pointGenerations.set(id, 0);
      this.bumpPointGeneration(id);
      this.state.viaStops.push(newStop);
      this.state.newStopSearch = createInitialNewStopSearch();
      this.invalidatePreview();
      this.emit();

      if (this.autoRouteEnabled && this.canRoute()) {
        void this.previewRoute();
      }
      return;
    }

    const pt = this.findPoint(pointId);
    if (!pt) return;

    this.pushUndo();

    this.pendingReplacements.delete(pointId);
    this.bumpPointGeneration(pointId);

    // Cancel pending searches and reverse
    const prevCtrl = this.searchAbortControllers.get(pointId);
    if (prevCtrl) prevCtrl.abort();
    this.searchAbortControllers.delete(pointId);
    this.searchGenerations.set(pointId, (this.searchGenerations.get(pointId) ?? 0) + 1);

    const prevRev = this.reverseAbortControllers.get(pointId);
    if (prevRev) prevRev.abort();
    this.reverseAbortControllers.delete(pointId);

    pt.name = result.name;
    pt.searchQuery = result.name;
    pt.latitude = result.latitude;
    pt.longitude = result.longitude;
    pt.searchResults = [];
    pt.isSearching = false;
    pt.searchError = null;

    if (this.state.isLoop && pointId === "start") {
      this.bumpPointGeneration("finish");
      this.state.finishPoint.name = result.name;
      this.state.finishPoint.searchQuery = result.name;
      this.state.finishPoint.latitude = result.latitude;
      this.state.finishPoint.longitude = result.longitude;
      this.state.finishPoint.searchResults = [];
      this.state.finishPoint.isSearching = false;
      this.state.finishPoint.searchError = null;
    }

    this.invalidatePreview();
    this.emit();

    if (this.autoRouteEnabled && this.canRoute()) {
      void this.previewRoute();
    }
  }

  addViaStop(): string {
    if (this.state.viaStops.length >= 8) {
      throw new Error("Maximum of 8 via stops reached.");
    }
    this.pushUndo();

    const id = `stop-${this.nextStopSeq++}`;
    const newStop: DraftPointState = {
      id,
      kind: "via",
      name: "",
      searchQuery: "",
      searchResults: [],
      isSearching: false,
      searchError: null,
      latitude: null,
      longitude: null,
    };
    this.pointGenerations.set(id, 0);
    this.state.viaStops.push(newStop);
    this.state.error = null;
    this.invalidatePreview();
    this.emit();
    return id;
  }

  removeViaStop(pointId: string): void {
    this.pushUndo();

    const prevCtrl = this.searchAbortControllers.get(pointId);
    if (prevCtrl) prevCtrl.abort();
    this.searchAbortControllers.delete(pointId);
    this.searchGenerations.delete(pointId);
    this.pointGenerations.delete(pointId);

    const prevRev = this.reverseAbortControllers.get(pointId);
    if (prevRev) prevRev.abort();
    this.reverseAbortControllers.delete(pointId);
    this.pendingReplacements.delete(pointId);

    this.state.viaStops = this.state.viaStops.filter((s) => s.id !== pointId);
    this.state.error = null;
    this.invalidatePreview();
    this.emit();

    if (this.autoRouteEnabled && this.canRoute()) {
      void this.previewRoute();
    }
  }

  moveViaStop(pointId: string, direction: "up" | "down"): void {
    const index = this.state.viaStops.findIndex((s) => s.id === pointId);
    if (index === -1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= this.state.viaStops.length) return;

    this.pushUndo();

    const stops = [...this.state.viaStops];
    const temp = stops[index]!;
    stops[index] = stops[targetIndex]!;
    stops[targetIndex] = temp;

    this.state.viaStops = stops;
    this.invalidatePreview();
    this.emit();

    if (this.autoRouteEnabled && this.canRoute()) {
      void this.previewRoute();
    }
  }

  setLoop(isLoop: boolean): void {
    this.pushUndo();

    this.state.isLoop = isLoop;
    if (isLoop) {
      this.bumpPointGeneration("finish");
      this.state.finishPoint.name = this.state.startPoint.name;
      this.state.finishPoint.latitude = this.state.startPoint.latitude;
      this.state.finishPoint.longitude = this.state.startPoint.longitude;
      this.state.finishPoint.searchQuery = this.state.startPoint.searchQuery;
      this.state.finishPoint.searchResults = [];
      this.state.finishPoint.searchError = null;
    }

    this.invalidatePreview();
    this.emit();

    if (this.autoRouteEnabled && this.canRoute()) {
      void this.previewRoute();
    }
  }

  toggleLoop(): void {
    this.setLoop(!this.state.isLoop);
  }

  startMapPlacement(pointId: string, initialCoordinate?: Coordinate): void {
    if (pointId === "new-stop") {
      if (this.state.viaStops.length >= 8) return;
      const initialCoord =
        initialCoordinate ??
        (this.state.startPoint.latitude !== null && this.state.startPoint.longitude !== null
          ? { latitude: this.state.startPoint.latitude, longitude: this.state.startPoint.longitude }
          : { latitude: 40.785, longitude: -73.968 });

      this.state.placementTarget = { pointId: "new-stop", label: "Add Stop" };
      this.state.candidateCoordinate = initialCoord;
      this.state.error = null;
      this.emit();
      return;
    }

    const pt = this.findPoint(pointId);
    if (!pt) return;

    const gen = this.bumpPointGeneration(pointId);
    this.pendingReplacements.set(pointId, gen);

    const label =
      pt.kind === "start"
        ? "Start Location"
        : pt.kind === "finish"
        ? "Finish Location"
        : `Via Stop ${this.state.viaStops.findIndex((s) => s.id === pointId) + 1}`;

    const initialCoord =
      initialCoordinate ??
      (pt.latitude !== null && pt.longitude !== null
        ? { latitude: pt.latitude, longitude: pt.longitude }
        : this.state.startPoint.latitude !== null && this.state.startPoint.longitude !== null
        ? { latitude: this.state.startPoint.latitude, longitude: this.state.startPoint.longitude }
        : { latitude: 40.785, longitude: -73.968 });

    this.state.placementTarget = { pointId, label };
    this.state.candidateCoordinate = initialCoord;
    this.state.error = null;
    this.emit();
  }

  setCandidateCoordinate(coord: Coordinate): void {
    if (!this.state.placementTarget) return;
    this.state.candidateCoordinate = coord;
    this.emit();
  }

  async confirmMapPlacement(pointIdArg?: string): Promise<void> {
    if (!this.state.placementTarget || !this.state.candidateCoordinate) return;

    const pointId = pointIdArg ?? this.state.placementTarget.pointId;
    const coords = this.state.candidateCoordinate;

    if (pointId === "new-stop") {
      if (this.state.viaStops.length >= 8) {
        this.state.placementTarget = null;
        this.state.candidateCoordinate = null;
        this.emit();
        return;
      }
      this.pushUndo();

      this.state.placementTarget = null;
      this.state.candidateCoordinate = null;

      const id = `stop-${this.nextStopSeq++}`;
      const newStop: DraftPointState = {
        id,
        kind: "via",
        name: "Map-selected place",
        searchQuery: "Map-selected place",
        searchResults: [],
        isSearching: false,
        searchError: null,
        latitude: coords.latitude,
        longitude: coords.longitude,
      };
      this.pointGenerations.set(id, 0);
      const gen = this.bumpPointGeneration(id);
      this.state.viaStops.push(newStop);

      const revCtrl = new AbortController();
      this.reverseAbortControllers.set(id, revCtrl);

      this.invalidatePreview();
      this.emit();

      if (this.autoRouteEnabled && this.canRoute()) {
        void this.previewRoute();
      }

      void this.geocodingProvider
        .reverse(coords, revCtrl.signal)
        .then((rev) => {
          if (this.disposed || revCtrl.signal.aborted || this.pointGenerations.get(id) !== gen) return;
          if (!rev?.name) return;
          newStop.name = rev.name;
          newStop.searchQuery = rev.name;
          this.emit();
        })
        .catch(() => {})
        .finally(() => {
          if (this.reverseAbortControllers.get(id) === revCtrl) {
            this.reverseAbortControllers.delete(id);
          }
        });
      return;
    }

    const pt = this.findPoint(pointId);
    this.pushUndo();

    this.pendingReplacements.delete(pointId);
    this.state.placementTarget = null;
    this.state.candidateCoordinate = null;

    if (!pt) {
      this.emit();
      return;
    }

    const gen = this.bumpPointGeneration(pointId);

    // Cancel in-flight search and prior reverse
    const prevCtrl = this.searchAbortControllers.get(pointId);
    if (prevCtrl) prevCtrl.abort();
    this.searchAbortControllers.delete(pointId);
    this.searchGenerations.set(pointId, (this.searchGenerations.get(pointId) ?? 0) + 1);

    const prevRev = this.reverseAbortControllers.get(pointId);
    if (prevRev) prevRev.abort();

    const revCtrl = new AbortController();
    this.reverseAbortControllers.set(pointId, revCtrl);

    // Promptly assign coordinates with a human-readable fallback label without raw GPS
    const fallbackName =
      pt.kind === "start"
        ? "Start Location on Map"
        : pt.kind === "finish"
        ? "Finish Location on Map"
        : `Via Stop on Map`;

    pt.name = fallbackName;
    pt.latitude = coords.latitude;
    pt.longitude = coords.longitude;
    pt.searchQuery = fallbackName;
    pt.searchResults = [];
    pt.searchError = null;

    if (this.state.isLoop && pointId === "start") {
      this.bumpPointGeneration("finish");
      this.state.finishPoint.name = fallbackName;
      this.state.finishPoint.latitude = coords.latitude;
      this.state.finishPoint.longitude = coords.longitude;
      this.state.finishPoint.searchQuery = fallbackName;
    }

    this.invalidatePreview();
    this.emit();

    if (this.autoRouteEnabled && this.canRoute()) {
      void this.previewRoute();
    }

    // Asynchronously enrich with reverse-geocoded place name
    void this.geocodingProvider
      .reverse(coords, revCtrl.signal)
      .then((rev) => {
        if (this.disposed || revCtrl.signal.aborted || this.pointGenerations.get(pointId) !== gen) return;
        if (!rev?.name) return;

        pt.name = rev.name;
        pt.searchQuery = rev.name;
        if (this.state.isLoop && pointId === "start") {
          this.state.finishPoint.name = rev.name;
          this.state.finishPoint.searchQuery = rev.name;
        }
        this.emit();
      })
      .catch(() => {
        // Keep human-readable fallback name
      })
      .finally(() => {
        if (this.reverseAbortControllers.get(pointId) === revCtrl) {
          this.reverseAbortControllers.delete(pointId);
        }
      });
  }

  cancelMapPlacement(): void {
    if (this.state.placementTarget) {
      const targetId = this.state.placementTarget.pointId;
      if (targetId !== "new-stop") {
        this.pendingReplacements.delete(targetId);
      }
    }
    this.state.placementTarget = null;
    this.state.candidateCoordinate = null;
    this.emit();
  }

  async useMyLocation(
    pointId: string,
    locationGetter: () => Promise<{ latitude: number; longitude: number } | null>,
  ): Promise<void> {
    const pt = this.findPoint(pointId);
    if (!pt) return;

    this.state.error = null;
    const gen = this.bumpPointGeneration(pointId);

    // Cancel in-flight search and reverse
    const prevCtrl = this.searchAbortControllers.get(pointId);
    if (prevCtrl) prevCtrl.abort();
    this.searchAbortControllers.delete(pointId);
    this.searchGenerations.set(pointId, (this.searchGenerations.get(pointId) ?? 0) + 1);

    const prevRev = this.reverseAbortControllers.get(pointId);
    if (prevRev) prevRev.abort();

    const revCtrl = new AbortController();
    this.reverseAbortControllers.set(pointId, revCtrl);

    // Intentional replacement in flight with token ownership
    this.pendingReplacements.set(pointId, gen);
    this.emit();

    let coords: { latitude: number; longitude: number } | null = null;
    try {
      try {
        coords = await locationGetter();
      } catch (err) {
        if (this.disposed || this.pointGenerations.get(pointId) !== gen) return;
        this.state.error = err instanceof Error ? err.message : "Failed to get location.";
        return;
      }

      if (this.disposed || this.pointGenerations.get(pointId) !== gen) return;

      if (!coords) {
        // Permission denied or unavailable: DO NOT invent fake coordinates
        this.state.error = "Location permission denied. Search for an address or choose on the map.";
        return;
      }

      let pointName = "My Location";
      try {
        const rev = await this.geocodingProvider.reverse(coords, revCtrl.signal);
        if (this.disposed || revCtrl.signal.aborted || this.pointGenerations.get(pointId) !== gen) return;
        if (rev?.name) pointName = rev.name;
      } catch {
        // Retain readable "My Location"
      }

      if (this.disposed || this.pointGenerations.get(pointId) !== gen) return;

      // Push undo immediately before actual coordinate commit, not before reverse!
      this.pushUndo();

      pt.name = pointName;
      pt.latitude = coords.latitude;
      pt.longitude = coords.longitude;
      pt.searchQuery = pointName;
      pt.searchResults = [];
      pt.searchError = null;

      if (this.state.isLoop && pointId === "start") {
        this.bumpPointGeneration("finish");
        this.state.finishPoint.name = pointName;
        this.state.finishPoint.latitude = coords.latitude;
        this.state.finishPoint.longitude = coords.longitude;
        this.state.finishPoint.searchQuery = pointName;
      }

      // Clear operation pending state BEFORE scheduling canRoute / auto-routing
      if (this.pendingReplacements.get(pointId) === gen) {
        this.pendingReplacements.delete(pointId);
      }

      this.invalidatePreview();
      this.emit();

      if (this.autoRouteEnabled && this.canRoute()) {
        void this.previewRoute();
      }
    } finally {
      // Only clear pending state if this operation still owns it
      if (this.pendingReplacements.get(pointId) === gen) {
        this.pendingReplacements.delete(pointId);
      }
      if (this.reverseAbortControllers.get(pointId) === revCtrl) {
        this.reverseAbortControllers.delete(pointId);
      }
      this.emit();
    }
  }

  async previewRoute(): Promise<RoutedPath | null> {
    this.state.error = null;

    const { startPoint, finishPoint, viaStops, isLoop } = this.state;
    if (startPoint.latitude === null || startPoint.longitude === null) {
      this.state.error = "Please choose a start location.";
      this.emit();
      return null;
    }

    if (!isLoop && (finishPoint.latitude === null || finishPoint.longitude === null)) {
      this.state.error = "Please choose a finish location.";
      this.emit();
      return null;
    }

    for (let i = 0; i < viaStops.length; i++) {
      const stop = viaStops[i]!;
      if (stop.latitude === null || stop.longitude === null) {
        this.state.error = `Please choose a location for via stop ${i + 1}.`;
        this.emit();
        return null;
      }
    }

    if (isLoop) {
      if (viaStops.length === 0) {
        this.state.error = "A loop ride requires at least one via stop.";
        this.state.previewRoute = null;
        this.state.previewInputSnapshot = null;
        this.emit();
        return null;
      }
      const duplicateVia = viaStops.find(
        (s) => s.latitude === startPoint.latitude && s.longitude === startPoint.longitude,
      );
      if (duplicateVia) {
        this.state.error = "A loop route via stop cannot be the same location as the start.";
        this.state.previewRoute = null;
        this.state.previewInputSnapshot = null;
        this.emit();
        return null;
      }
    }

    const controlPoints: ControlPoint[] = [
      {
        id: "start",
        kind: "start",
        name: startPoint.name || "Start",
        latitude: startPoint.latitude,
        longitude: startPoint.longitude,
      },
      ...viaStops.map((stop, idx) => ({
        id: stop.id,
        kind: "via" as const,
        name: stop.name || `Stop ${idx + 1}`,
        latitude: stop.latitude!,
        longitude: stop.longitude!,
      })),
      {
        id: "finish",
        kind: "finish",
        name: isLoop ? startPoint.name || "Start" : finishPoint.name || "Finish",
        latitude: isLoop ? startPoint.latitude : finishPoint.latitude!,
        longitude: isLoop ? startPoint.longitude : finishPoint.longitude!,
      },
    ];

    if (this.routingAbortController) {
      this.routingAbortController.abort();
    }
    const ctrl = new AbortController();
    this.routingAbortController = ctrl;

    this.state.isRouting = true;
    this.emit();

    try {
      const routed = await this.routingProvider.route({
        controlPoints,
        profile: "road",
        signal: ctrl.signal,
      });
      if (this.disposed || ctrl.signal.aborted) return null;

      this.state.isRouting = false;
      this.state.previewRoute = routed;
      this.state.stalePreviewRoute = null;
      this.state.previewInputSnapshot = controlPoints;
      this.emit();
      return routed;
    } catch (err) {
      if (this.disposed || ctrl.signal.aborted) return null;

      this.state.isRouting = false;
      this.state.previewRoute = null;
      this.state.previewInputSnapshot = null;
      this.state.error = err instanceof Error ? err.message : "Routing calculation failed.";
      this.emit();
      return null;
    }
  }

  buildRouteDocument(): RouteDocument {
    if (!this.canSave()) {
      throw new Error("Cannot save route: preview is not valid or state has changed.");
    }

    const preview = this.state.previewRoute!;
    const snapshot = this.state.previewInputSnapshot!;

    return {
      schemaVersion: 1,
      id: `route-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      name: this.state.name.trim(),
      source: { kind: "new" },
      segments: preview.segments.map((leg, legIdx) => ({
        id: `segment-${legIdx}`,
        points: leg.map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
        })),
      })),
      controlPoints: snapshot.map((cp) => ({
        id: cp.id,
        kind: cp.kind,
        name: cp.name || (cp.kind === "start" ? "Start" : cp.kind === "finish" ? "Finish" : "Stop"),
        latitude: cp.latitude,
        longitude: cp.longitude,
      })),
      waypoints: [],
      maneuvers: preview.maneuvers.map((m) => ({
        id: m.id,
        segmentIndex: m.segmentIndex,
        shapeIndex: m.shapeIndex,
        instruction: m.instruction,
        ...(m.verbalInstruction ? { verbalInstruction: m.verbalInstruction } : {}),
        latitude: m.latitude,
        longitude: m.longitude,
      })),
      summary: {
        distanceMeters: Math.round(preview.distanceMeters),
        durationSeconds: Math.round(preview.durationSeconds),
      },
    };
  }

  private buildCurrentControlPoints(): ControlPoint[] | null {
    const { startPoint, finishPoint, viaStops, isLoop } = this.state;
    if (startPoint.latitude === null || startPoint.longitude === null) return null;
    if (!isLoop && (finishPoint.latitude === null || finishPoint.longitude === null)) return null;
    for (const stop of viaStops) {
      if (stop.latitude === null || stop.longitude === null) return null;
    }

    return [
      {
        id: "start",
        kind: "start",
        name: startPoint.name || "Start",
        latitude: startPoint.latitude,
        longitude: startPoint.longitude,
      },
      ...viaStops.map((stop, idx) => ({
        id: stop.id,
        kind: "via" as const,
        name: stop.name || `Stop ${idx + 1}`,
        latitude: stop.latitude!,
        longitude: stop.longitude!,
      })),
      {
        id: "finish",
        kind: "finish",
        name: isLoop ? startPoint.name || "Start" : finishPoint.name || "Finish",
        latitude: isLoop ? startPoint.latitude : finishPoint.latitude!,
        longitude: isLoop ? startPoint.longitude : finishPoint.longitude!,
      },
    ];
  }

  private findPoint(pointId: string): DraftPointState | null {
    if (pointId === "start") return this.state.startPoint;
    if (pointId === "finish") return this.state.finishPoint;
    if (pointId === "new-stop") return this.state.newStopSearch;
    return this.state.viaStops.find((s) => s.id === pointId) ?? null;
  }

  private bumpPointGeneration(pointId: string): number {
    const next = (this.pointGenerations.get(pointId) ?? 0) + 1;
    this.pointGenerations.set(pointId, next);
    return next;
  }

  private invalidatePreview(): void {
    this.state.stalePreviewRoute = this.state.previewRoute ?? this.state.stalePreviewRoute;
    this.state.previewRoute = null;
    this.state.previewInputSnapshot = null;
    this.state.editGeneration++;
    if (this.routingAbortController) {
      this.routingAbortController.abort();
      this.routingAbortController = null;
    }
    this.state.isRouting = false;
  }

  private pushUndo(): void {
    this.undoStack.push(this.getDraftSnapshot());
    if (this.undoStack.length > 50) {
      this.undoStack.shift();
    }
    this.state.canUndo = true;
  }

  private emit(): void {
    this.state.canUndo = this.undoStack.length > 0;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
