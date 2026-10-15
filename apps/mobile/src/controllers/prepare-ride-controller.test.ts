import { describe, expect, it } from "vitest";
import type { RouteDocument } from "@ride-maker/domain";
import { polylineDistance, type TraceMatchRequest, type TraceMatchResult, type TraceMatchingProvider } from "@ride-maker/routing";
import { createCurvedRideDocument, createSeparateSegmentsDocument, createSparseRouteDocument } from "../../../../packages/routing/src/preparation/fixtures";
import { InMemoryFileSystem } from "../storage/file-system-interface";
import { InMemoryRouteDb } from "../storage/sqlite-db";
import { LocalRouteStorage } from "../storage/local-route-storage";
import type { SavedLocalRoute } from "../storage/types";
import { buildSourceIdentityToken, SavedRouteCorruptError } from "../storage/types";
import { PrepareRideController, type PreparationState } from "./prepare-ride-controller";

const gpx = `<gpx version="1.1"><trk><name>Original</name><trkseg><trkpt lat="45.501" lon="-73.567"/><trkpt lat="45.505" lon="-73.565"/></trkseg></trk></gpx>`;

function perfectProvider(handler?: (request: TraceMatchRequest, call: number) => Promise<TraceMatchResult>): TraceMatchingProvider & { calls: number } {
  const provider = {
    calls: 0,
    async matchTrace(request: TraceMatchRequest): Promise<TraceMatchResult> {
      const call = ++provider.calls;
      if (handler) return handler(request, call);
      const points = request.points;
      const maneuvers = [{ id: "start", segmentIndex: 0, shapeIndex: 0, instruction: "Continue on the route", latitude: points[0]!.latitude, longitude: points[0]!.longitude }];
      return { matchedSegments: [{ points, maneuvers, distanceMeters: polylineDistance(points), durationSeconds: 600 }], discontinuities: [], engine: "authored-test-provider" };
    },
  };
  return provider;
}

async function setup(document: RouteDocument, provider: TraceMatchingProvider) {
  const fs = new InMemoryFileSystem();
  const db = new InMemoryRouteDb();
  const storage = new LocalRouteStorage(db, fs);
  await storage.init();
  const persistedDocument = document.summary ? document : { ...document, summary: { distanceMeters: 1000, durationSeconds: 0 } };
  const record = await storage.saveImportedRoute({ gpxContent: gpx, document: persistedDocument, originalFilename: document.source.kind === "gpx" ? document.source.filename : undefined, distanceMeters: 1000 });
  let selected: { id: string; kind: string; sourceKind: string } | null = { id: record.id, kind: "local", sourceKind: "imported" };
  const accepted: SavedLocalRoute[] = [];
  const controller = new PrepareRideController({ storage, provider, getSelectedRoute: () => selected, onAccepted: (saved) => { accepted.push(saved); } });
  return { fs, db, storage, record, controller, accepted, select: (value: typeof selected) => { selected = value; }, getSelection: () => selected };
}

function subscribeState(controller: PrepareRideController) {
  let state: PreparationState = controller.getState();
  controller.subscribe((next) => { state = next; });
  return () => state;
}

describe("prepared GPX controller", () => {
  it("runs matching through real storage, accepts once, and reopens the saved offline version", async () => {
    const provider = perfectProvider();
    const h = await setup(createCurvedRideDocument(), provider);
    const state = subscribeState(h.controller);
    await h.controller.prepare();
    const firstReview = state();
    expect(firstReview.status).toBe("review");
    if (firstReview.status !== "review") throw new Error("expected review");
    expect(firstReview.result.metadata.status).toBe("ready");
    await Promise.all([h.controller.accept(false), h.controller.accept(false)]);
    const afterAccept = state();
    if (afterAccept.status === "error") throw new Error(afterAccept.message);
    expect(h.accepted).toHaveLength(1);
    expect(h.accepted[0]!.activeVersionId).toBeTruthy();
    const restartedStorage = new LocalRouteStorage(h.db, h.fs);
    const reopened = await restartedStorage.getRoute(h.record.id);
    expect(reopened.activeVersionId).toBe(h.accepted[0]!.activeVersionId);
    expect(reopened.preparationMetadata?.status).toBe("ready");
    const preparedPath = `${restartedStorage.getBaseDir()}/data/${h.record.id}/prepared/${reopened.activeVersionId}/document.json`;
    await h.fs.writeAsStringAsync(preparedPath, "broken prepared asset");
    await expect(restartedStorage.getRoute(h.record.id)).rejects.toBeInstanceOf(SavedRouteCorruptError);
    expect((await restartedStorage.getOriginalRoute(h.record.id)).document.id).toBe(h.record.id);
    expect((await restartedStorage.revertPreparation(h.record.id, buildSourceIdentityToken(reopened.record))).activeVersionId).toBeNull();
    expect(provider.calls).toBe(1);
  });

  it("requires an explicit sparse inference choice before calling the provider", async () => {
    const provider = perfectProvider();
    const h = await setup(createSparseRouteDocument(), provider);
    const state = subscribeState(h.controller);
    await h.controller.prepare();
    expect(state().status).toBe("choice");
    expect(provider.calls).toBe(0);
    await h.controller.accept(true);
    expect(state().status).toBe("choice");
    expect((await h.storage.getRoute(h.record.id)).activeVersionId).toBeNull();
    await h.controller.prepare(true);
    expect(state().status).toBe("review");
    expect(provider.calls).toBeGreaterThan(0);
  });

  it("offers retry after provider failure and keeps the original saved route intact", async () => {
    const provider = perfectProvider(async (request, call) => {
      if (call === 1) throw new Error("network unavailable");
      const points = request.points;
      return { matchedSegments: [{ points, maneuvers: [{ id: "start", segmentIndex: 0, shapeIndex: 0, instruction: "Continue", latitude: points[0]!.latitude, longitude: points[0]!.longitude }], distanceMeters: polylineDistance(points), durationSeconds: 500 }], discontinuities: [], engine: "authored-test-provider" };
    });
    const doc = createCurvedRideDocument();
    const h = await setup(doc, provider);
    const state = subscribeState(h.controller);
    await h.controller.prepare();
    expect(state().status).toBe("error");
    await h.controller.accept(true);
    expect((await h.storage.getRoute(h.record.id)).activeVersionId).toBeNull();
    expect((await h.storage.getOriginalRoute(h.record.id)).document.segments[0]!.points).toEqual(doc.segments[0]!.points);
    await h.controller.retry();
    expect(state().status).toBe("review");
    expect(provider.calls).toBe(2);
  });

  it("aborts and ignores a delayed provider success after cancellation or selection change", async () => {
    let resolveMatch!: (result: TraceMatchResult) => void;
    let matchSignal: AbortSignal | undefined;
    const doc = createCurvedRideDocument();
    let enteredResolve!: () => void;
    let entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    const provider: TraceMatchingProvider = { matchTrace: (request) => { matchSignal = request.signal; enteredResolve(); return new Promise((resolve) => { resolveMatch = resolve; }); } };
    const h = await setup(doc, provider);
    const state = subscribeState(h.controller);
    const pending = h.controller.prepare();
    await entered;
    expect(matchSignal?.aborted).toBe(false);
    h.controller.cancel();
    expect(matchSignal?.aborted).toBe(true);
    resolveMatch({ matchedSegments: [], discontinuities: [], engine: "late-provider" });
    await pending;
    expect(state()).toEqual({ status: "idle" });
    expect((await h.storage.getRoute(h.record.id)).activeVersionId).toBeNull();

    entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    const h2 = await setup(doc, provider);
    const state2 = subscribeState(h2.controller);
    const pending2 = h2.controller.prepare();
    await entered;
    h2.select(null);
    h2.controller.selectionChanged();
    expect(matchSignal?.aborted).toBe(true);
    resolveMatch({ matchedSegments: [], discontinuities: [], engine: "late-provider" });
    await pending2;
    expect(state2()).toEqual({ status: "idle" });
  });

  it("requires explicit partial acceptance and publishes only the prepared candidate", async () => {
    const provider = perfectProvider(async (request, call) => {
      if (call === 2) throw new Error("one source section was unavailable");
      const points = request.points;
      return { matchedSegments: [{ points, maneuvers: [{ id: "start", segmentIndex: 0, shapeIndex: 0, instruction: "Continue", latitude: points[0]!.latitude, longitude: points[0]!.longitude }], distanceMeters: polylineDistance(points), durationSeconds: 400 }], discontinuities: [], engine: "authored-test-provider" };
    });
    const h = await setup(createSeparateSegmentsDocument(), provider);
    const state = subscribeState(h.controller);
    await h.controller.prepare();
    const review = state();
    expect(review.status).toBe("review");
    if (review.status !== "review") throw new Error("expected review");
    expect(review.result.metadata.status).toBe("partial");
    await h.controller.accept(false);
    expect(h.accepted).toHaveLength(0);
    await h.controller.accept(true);
    const afterAccept = state();
    if (afterAccept.status === "error") throw new Error(afterAccept.message);
    expect(h.accepted).toHaveLength(1);
    expect(h.accepted[0]!.preparationMetadata?.status).toBe("partial");
  });

  it("does not accept stale selected routes or republish on a double tap", async () => {
    const provider = perfectProvider();
    const h = await setup(createCurvedRideDocument(), provider);
    const state = subscribeState(h.controller);
    await h.controller.prepare();
    h.select({ id: "another-route", kind: "local", sourceKind: "imported" });
    await h.controller.accept(false);
    expect(h.accepted).toHaveLength(0);
    expect(state().status).toBe("review");
    h.controller.cancel();
  });

  it("locks route selection during the atomic storage save and ignores cancellation until it finishes", async () => {
    const h = await setup(createCurvedRideDocument(), perfectProvider());
    const state = subscribeState(h.controller);
    await h.controller.prepare();
    let enterSave!: () => void;
    const entered = new Promise<void>((resolve) => { enterSave = resolve; });
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const accept = h.storage.acceptPreparation.bind(h.storage);
    h.storage.acceptPreparation = async (params) => {
      enterSave();
      await saveGate;
      return accept(params);
    };
    const pending = h.controller.accept(false);
    await entered;
    expect(h.controller.canChangeSelection()).toBe(false);
    if (h.controller.canChangeSelection()) h.select(null);
    h.controller.selectionChanged();
    h.controller.cancel();
    expect(h.getSelection()?.id).toBe(h.record.id);
    expect(state().status).toBe("saving");
    releaseSave();
    await pending;
    expect(h.accepted).toHaveLength(1);
    expect(state().status).toBe("idle");
  });
});
