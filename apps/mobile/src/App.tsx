import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import * as DocumentPicker from "expo-document-picker";
import { useKeepAwake } from "expo-keep-awake";
import type { RouteDocument } from "@ride-maker/domain";
import type { SavedRoute } from "@ride-maker/persistence";
import { formatDistance } from "./navigation";
import { createNavigationState, prepareNavigationRide, type NavigationEvent, type NavigationInput, type NavigationState, type PreparedNavigationRide } from "@ride-maker/navigation";
import { createDefaultTraceMatchingProvider } from "./providers";
import { polylineDistance } from "@ride-maker/routing";
import { routeIdFromLink } from "./route-view";
import { DiagnosticsView } from "./diagnostics/DiagnosticsView";
import { FileSystemDiagnosticStorage } from "./diagnostics/file-storage";
import { createDefaultRouteRepository } from "./route-repository";
import {
  createDefaultLocalStorage,
  observeLocalStorage,
  buildSourceIdentityToken,
  type LocalRouteRecord,
} from "./storage";
import { seedSyntheticLibrary } from "./storage/synthetic-library";

import type { DisplayRoute } from "./types";
import { CreateRideScreen } from "./screens/CreateRideScreen";
import type { ControllerDraftSnapshot } from "./controllers/create-ride-controller";
import { ActiveNavigationScreen } from "./screens/ActiveNavigationScreen";
import { MainMapScreen } from "./screens/MainMapScreen";
import { PrepareRideController, type PreparationState } from "./controllers/prepare-ride-controller";
import { ForegroundSpeechQueue } from "./controllers/foreground-speech-queue";
import { dispatchForegroundNavigation } from "./controllers/foreground-navigation-dispatch";
export type { DisplayRoute };

const repository = createDefaultRouteRepository();
const diagnosticStorage = new FileSystemDiagnosticStorage();
const traceMatchingProvider = createDefaultTraceMatchingProvider();

let defaultLocalStorage: ReturnType<typeof createDefaultLocalStorage> | null = null;
function getLocalStorage() {
  if (!defaultLocalStorage) {
    defaultLocalStorage = createDefaultLocalStorage();
  }
  return defaultLocalStorage;
}

function displayLocalRoute(loaded: import("./storage").SavedLocalRoute, recoveryAvailable = false): DisplayRoute {
  const distanceFor = (document: RouteDocument) => document.summary?.distanceMeters ?? document.segments.reduce((sum, segment) => sum + polylineDistance(segment.points), 0);
  const showOriginal = recoveryAvailable;
  return {
    id: loaded.record.id,
    kind: "local",
    sourceKind: loaded.record.sourceKind ?? (loaded.document.source.kind === "gpx" ? "imported" : "created"),
    distanceMeters: showOriginal ? distanceFor(loaded.originalDocument ?? loaded.document) : loaded.record.distanceMeters,
    document: loaded.document,
    ...(loaded.originalDocument ? { originalDocument: loaded.originalDocument } : {}),
    ...(loaded.preparationMetadata !== undefined ? { preparationMetadata: loaded.preparationMetadata } : {}),
    ...(loaded.activeVersionId !== undefined ? { activeVersionId: loaded.activeVersionId } : {}),
    recoveryAvailable,
    sourceIdentityToken: buildSourceIdentityToken(loaded.record),
  };
}

export default function App() {
  const [viewMode, setViewMode] = useState<"routes" | "diagnostics" | "create">("routes");
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [localStorageError, setLocalStorageError] = useState<string | null>(null);
  const [localRoutes, setLocalRoutes] = useState<LocalRouteRecord[]>([]);
  const [route, setRoute] = useState<DisplayRoute | null>(null);
  const [draftRide, setDraftRide] = useState<ControllerDraftSnapshot | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [position, setPosition] = useState<Location.LocationObjectCoords | null>(null);
  const [navigationRide, setNavigationRide] = useState<PreparedNavigationRide | null>(null);
  const [navigationState, setNavigationState] = useState<NavigationState | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [preparationState, setPreparationState] = useState<PreparationState>({ status: "idle" });
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [testVerified, setTestVerified] = useState(false);
  const [testSamplesReady, setTestSamplesReady] = useState(false);
  const spokenRef = useRef(new Set<string>());
  const navigationStateRef = useRef<NavigationState | null>(null);
  const navigationRideRef = useRef<PreparedNavigationRide | null>(null);
  const navigationErrorRef = useRef<string | null>(null);
  const voiceEnabledRef = useRef(true);
  const routeRef = useRef<DisplayRoute | null>(null);
  const speechQueueRef = useRef<ForegroundSpeechQueue | null>(null);
  if (speechQueueRef.current === null) {
    speechQueueRef.current = new ForegroundSpeechQueue(() => Speech.stop(), (text) => Speech.speak(text));
  }

  routeRef.current = route;
  voiceEnabledRef.current = voiceEnabled;
  navigationStateRef.current = navigationState;
  navigationRideRef.current = navigationRide;
  navigationErrorRef.current = navigationError;
  const importInProgressRef = useRef(false);
  const sampleCounterRef = useRef(0);

  const isTestMode = process.env.EXPO_PUBLIC_TEST_MODE === "true";

  const emitTestObservation = useCallback(async (tag: string) => {
    if (!isTestMode) return;
    try {
      const { storage, fs } = getLocalStorage();
      const obs = await observeLocalStorage(storage, fs);
      console.log(`[E2E_STORAGE_OBSERVE_BEGIN] tag="${tag}" count=${obs.count}`);
      obs.routes.forEach((r, idx) => {
        console.log(`[E2E_STORAGE_OBSERVE_ROUTE] ${JSON.stringify({ ...r, index: idx, total: obs.count, tag })}`);
      });
      console.log(`[E2E_STORAGE_OBSERVE_END] tag="${tag}" count=${obs.count}`);
    } catch (err) {
      console.error(`[E2E_STORAGE_OBSERVE_ERROR] tag="${tag}" error="${err instanceof Error ? err.message : String(err)}"`);
    }
  }, [isTestMode]);

  const refreshLocalRoutes = useCallback(async () => {
    try {
      const { storage } = getLocalStorage();
      const list = await storage.listRoutes();
      setLocalRoutes(list);
      setLocalStorageError(null);
    } catch (cause) {
      setLocalStorageError(cause instanceof Error ? cause.message : "Could not load saved routes.");
    }
  }, []);

  const preparationController = useMemo(() => new PrepareRideController({
    storage: getLocalStorage().storage,
    provider: traceMatchingProvider,
    getSelectedRoute: () => routeRef.current,
    onAccepted: async (saved) => {
      setRoute(displayLocalRoute(saved));
      setViewMode("routes");
      await refreshLocalRoutes();
    },
  }), [refreshLocalRoutes]);

  useEffect(() => preparationController.subscribe(setPreparationState), [preparationController]);
  useEffect(() => () => preparationController.cancel(), [preparationController]);
  useEffect(() => { preparationController.selectionChanged(); }, [preparationController, route?.id]);

  const handleSeedSyntheticLibrary = useCallback(async () => {
    if (!isTestMode || !preparationController.canChangeSelection()) return;
    try {
      const { storage } = getLocalStorage();
      await seedSyntheticLibrary(storage);
      await refreshLocalRoutes();
    } catch (err) {
      console.error("[SEED_SYNTHETIC_LIBRARY_ERROR]", err);
    }
  }, [isTestMode, refreshLocalRoutes, preparationController]);

  const openRoute = useCallback(async (id: string) => {
    if (!preparationController.canChangeSelection()) return;
    setBusy(true);
    setError(null);
    try {
      setNavigating(false);
      const fetched = await repository.get(id);
      if (!preparationController.canChangeSelection()) return;
      setRoute({
        id: fetched.id,
        slug: fetched.slug,
        kind: "remote",
        document: fetched.document,
      });
      setViewMode("routes");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load route.");
    } finally {
      setBusy(false);
    }
  }, [preparationController]);

  const openLocalRoute = useCallback(async (id: string) => {
    if (!preparationController.canChangeSelection()) return;
    setBusy(true);
    setError(null);
    try {
      setNavigating(false);
      const { storage } = getLocalStorage();
      let loaded: import("./storage").SavedLocalRoute;
      let recoveryAvailable = false;
      try { loaded = await storage.getRoute(id); }
      catch (cause) {
        loaded = await storage.getOriginalRoute(id);
        recoveryAvailable = Boolean(loaded.record.activePreparationId);
        if (!recoveryAvailable) throw cause;
      }
      if (!preparationController.canChangeSelection()) return;
      setRoute(displayLocalRoute(loaded, recoveryAvailable));
      setViewMode("routes");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load saved route.");
    } finally {
      setBusy(false);
    }
  }, [preparationController]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [remoteList] = await Promise.all([
        repository.listPublic(),
        refreshLocalRoutes(),
      ]);
      setRoutes(remoteList);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load routes.");
    } finally {
      setBusy(false);
    }
  }, [refreshLocalRoutes]);

  useEffect(() => {
    void refreshLocalRoutes();
    void repository.listPublic().then(setRoutes).catch(() => {});
  }, [refreshLocalRoutes]);

  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      if (isTestMode && event.url === "ridemaker://test-samples-ready") {
        setTestSamplesReady(true);
        return;
      }
      if (isTestMode && event.url === "ridemaker://test-verified") {
        setTestVerified(true);
        return;
      }
      if (isTestMode && event.url === "ridemaker://test-seed-library") {
        void handleSeedSyntheticLibrary();
        return;
      }
      if (isTestMode && event.url.includes("observe-storage")) {
        const tagMatch = event.url.match(/[?&]tag=([^&]+)/);
        const tag = tagMatch && tagMatch[1] ? decodeURIComponent(tagMatch[1]) : "default";
        void emitTestObservation(tag);
        return;
      }
      const id = routeIdFromLink(event.url);
      if (id) void openRoute(id);
    };
    const subscription = Linking.addEventListener("url", handleUrl);
    void Linking.getInitialURL().then((url) => {
      if (url) {
        if (isTestMode && url === "ridemaker://test-verified") {
          setTestVerified(true);
          return;
        }
        if (isTestMode && url === "ridemaker://test-seed-library") {
          void handleSeedSyntheticLibrary();
          return;
        }
        if (isTestMode && url.includes("observe-storage")) {
          const tagMatch = url.match(/[?&]tag=([^&]+)/);
          const tag = tagMatch && tagMatch[1] ? decodeURIComponent(tagMatch[1]) : "default";
          void emitTestObservation(tag);
          return;
        }
        const id = routeIdFromLink(url);
        if (id) void openRoute(id);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [isTestMode, openRoute, emitTestObservation, handleSeedSyntheticLibrary]);

  const handleImportGpx = useCallback(async () => {
    if (importInProgressRef.current || !preparationController.canChangeSelection()) return;
    importInProgressRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }
      if (!preparationController.canChangeSelection()) return;

      const asset = result.assets[0];
      if (!asset) return;
      const { importService, storage } = getLocalStorage();
      const record = await importService.importFromUri(asset.uri, {
        filename: asset.name,
      });

      const list = await storage.listRoutes();
      setLocalRoutes(list);

      // Open imported route in preview mode
      const loaded = await storage.getRoute(record.id);
      if (!preparationController.canChangeSelection()) return;
      setNavigating(false);
      setRoute(displayLocalRoute(loaded));
      setViewMode("routes");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to import GPX file.");
    } finally {
      importInProgressRef.current = false;
      setBusy(false);
    }
  }, [preparationController]);

  const openInput = useCallback(() => {
    const id = routeIdFromLink(input);
    if (!id) {
      setError("Please paste a route link or 15-character route ID.");
      return;
    }
    void openRoute(id);
  }, [input, openRoute]);

  const saveCreated = useCallback(async (document: RouteDocument) => {
    if (!preparationController.canChangeSelection()) return;
    const { storage } = getLocalStorage();
    const record = await storage.saveCreatedRoute(document);
    if (!preparationController.canChangeSelection()) return;
    await refreshLocalRoutes();
    setDraftRide(null);
    setRoute(displayLocalRoute(await storage.getRoute(record.id)));
    setNavigating(false);
    setViewMode("routes");
  }, [refreshLocalRoutes, preparationController]);

  const renameRide = useCallback(async (name: string) => {
    if (!route || route.kind !== "local" || !preparationController.canChangeSelection()) return;
    const { storage } = getLocalStorage();
    await storage.renameRoute(route.id, name);
    const saved = await storage.getRoute(route.id);
    setRoute(displayLocalRoute(saved));
    await refreshLocalRoutes();
  }, [route, refreshLocalRoutes, preparationController]);

  const deleteRide = useCallback(async () => {
    if (!route || route.kind !== "local" || !preparationController.canChangeSelection()) return;
    const { storage } = getLocalStorage();
    await storage.deleteRoute(route.id);
    setRoute(null);
    setViewMode("routes");
    await refreshLocalRoutes();
  }, [route, refreshLocalRoutes, preparationController]);

  const unavailableSegmentIndices = useMemo(() => route?.preparationMetadata?.outputCoverage
    .filter((coverage) => !coverage.guidanceAvailable || !coverage.matched)
    .map((coverage) => coverage.outputSegmentIndex) ?? [], [route?.preparationMetadata]);
  const navigationCandidate = useMemo(() => route
    ? prepareNavigationRide(route.document, { guidanceUnavailableSegmentIndices: unavailableSegmentIndices })
    : null, [route?.document, unavailableSegmentIndices]);

  const announceEvents = useCallback((events: readonly NavigationEvent[]) => {
    const lifecycleEnded = events.some((event) => event.type === "lifecycle_changed" && event.currentLifecycle !== "active");
    if (lifecycleEnded) {
      spokenRef.current.clear();
      speechQueueRef.current?.invalidate();
      void Speech.stop();
      return;
    }
    if (!voiceEnabledRef.current) return;
    const event = events.find((item) => item.type === "arrival" || item.type === "immediate_maneuver" || item.type === "instruction_repeated" || item.type === "off_route" || item.type === "gps_degraded" || item.type === "guidance_unavailable" || item.type === "upcoming_maneuver");
    if (!event || spokenRef.current.has(event.id)) return;
    spokenRef.current.add(event.id);
    const text = event.type === "arrival" ? "You have arrived."
      : event.type === "immediate_maneuver" ? event.maneuver.instruction
      : event.type === "upcoming_maneuver" ? `In ${formatDistance(event.distanceToManeuverMeters)}, ${event.maneuver.instruction}`
      : event.type === "instruction_repeated" ? (event.maneuver ? event.maneuver.instruction : "Guidance is unavailable right now.")
      : event.type === "off_route" ? "You are off route. Follow the map to rejoin the route."
      : event.type === "gps_degraded" ? "GPS signal is poor. Waiting for a reliable location."
      : event.type === "guidance_unavailable" ? "Turn guidance is unavailable for this section."
      : null;
    if (!text) return;
    speechQueueRef.current?.enqueue(text, () => voiceEnabledRef.current);
  }, []);

  const dispatchNavigation = useCallback((inputValue: NavigationInput) => {
    const activeRide = navigationRideRef.current;
    const previous = navigationStateRef.current;
    if (!activeRide || !previous) return;
    const outcome = dispatchForegroundNavigation(activeRide, previous, inputValue, navigationErrorRef.current);
    navigationStateRef.current = outcome.state;
    navigationErrorRef.current = outcome.error;
    setNavigationState(outcome.state);
    setNavigationError(outcome.error);
    if (outcome.shouldAnnounce) announceEvents(outcome.events);
  }, [announceEvents]);

  const startNavigation = async () => {
    if (!route || !navigationCandidate?.ok) {
      setError(navigationCandidate && !navigationCandidate.ok ? navigationCandidate.error.message : "This route has no usable directions to follow.");
      return;
    }
    const prep = route.preparationMetadata;
    const outputCoverage = prep?.outputCoverage ?? [];
    const hasGuidedCoverage = outputCoverage.length === route.document.segments.length &&
      new Set(outputCoverage.map((coverage) => coverage.outputSegmentIndex)).size === route.document.segments.length &&
      outputCoverage.every((coverage) => Number.isInteger(coverage.outputSegmentIndex) && coverage.outputSegmentIndex >= 0 && coverage.outputSegmentIndex < route.document.segments.length && (!coverage.guidanceAvailable || coverage.matched)) &&
      outputCoverage.some((coverage) => coverage.guidanceAvailable && coverage.matched) &&
      (prep?.status !== "ready" || outputCoverage.every((coverage) => coverage.guidanceAvailable && coverage.matched));
    const importedPrepared = route.kind === "local" && route.sourceKind === "imported" && !route.previewingOriginal &&
      (prep?.status === "ready" || prep?.status === "partial") && prep.sourceId === route.id && prep.sourceKind === route.document.source.kind && hasGuidedCoverage;
    const validatedDirections = route.document.maneuvers.length > 0 && (route.kind === "remote" || route.sourceKind === "created" || importedPrepared);
    if (!validatedDirections) {
      setError("Prepare and review directions before navigating this GPX.");
      return;
    }
    try {
      const activeDiag = await diagnosticStorage.getSession();
      if (activeDiag && activeDiag.status === "running") {
        setError("Please stop active background diagnostics before starting route navigation.");
        return;
      }
    } catch { /* Continue when diagnostic storage is unavailable. */ }
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") { setError("Allow location access to follow this route."); return; }
      void Speech.stop();
      speechQueueRef.current?.invalidate();
      spokenRef.current.clear();
      const engineRide = navigationCandidate.ride;
      const initialState = createNavigationState(engineRide);
      navigationRideRef.current = engineRide;
      navigationStateRef.current = initialState;
      setNavigationRide(engineRide);
      setNavigationState(initialState);
      setNavigationError(null);
      setPosition(null);
      setError(null);
      setNavigating(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start location tracking.");
    }
  };

  const stopNavigation = useCallback(() => {
    speechQueueRef.current?.invalidate();
    dispatchNavigation({ type: "end", timestamp: Date.now() });
    setNavigating(false);
    setPosition(null);
    navigationRideRef.current = null;
    navigationStateRef.current = null;
    setNavigationRide(null);
    setNavigationState(null);
    setNavigationError(null);
    void Speech.stop();
  }, [dispatchNavigation]);

  useEffect(() => {
    if (!voiceEnabled) {
      speechQueueRef.current?.invalidate();
      void Speech.stop();
    }
  }, [voiceEnabled]);

  useEffect(() => {
    speechQueueRef.current?.invalidate();
    spokenRef.current.clear();
    void Speech.stop();
  }, [route?.id]);

  useEffect(() => {
    if (!navigating || !navigationRide) return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
      (location) => {
        if (cancelled) return;
        const { coords } = location;
        if (isTestMode) {
          sampleCounterRef.current += 1;
          console.log(`[E2E_NAV_PROVIDER_SAMPLE] count=${sampleCounterRef.current} lat=${coords.latitude} lon=${coords.longitude}`);
        }
        setPosition(coords);
        const inputValue: NavigationInput = {
          type: "location_fix",
          timestamp: Math.trunc(location.timestamp),
          receivedAt: Date.now(),
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyMeters: coords.accuracy ?? 100,
          ...(typeof coords.speed === "number" && coords.speed >= 0 ? { speedMetersPerSecond: coords.speed } : {}),
          ...(typeof coords.heading === "number" && coords.heading >= 0 && coords.heading <= 360 ? { headingDegrees: coords.heading } : {}),
        };
        dispatchNavigation(inputValue);
      },
      (cause) => { if (!cancelled) setNavigationError(cause); },
    ).then((result) => {
      if (cancelled) result.remove();
      else { subscription = result; if (isTestMode) console.log("[E2E_NAV_PROVIDER] subscribed=true"); }
    }).catch((cause: unknown) => {
      if (!cancelled) { setNavigating(false); setNavigationError(cause instanceof Error ? cause.message : "Location tracking failed."); }
    });
    return () => {
      cancelled = true;
      subscription?.remove();
      speechQueueRef.current?.invalidate();
      void Speech.stop();
      if (isTestMode) console.log(`[E2E_NAV_PROVIDER] unsubscribed=true totalSamples=${sampleCounterRef.current}`);
    };
  }, [navigating, navigationRide, dispatchNavigation, isTestMode]);

  const repeatInstruction = useCallback(() => dispatchNavigation({ type: "repeat_instruction", timestamp: Date.now() }), [dispatchNavigation]);
  const togglePauseNavigation = useCallback(() => {
    const lifecycle = navigationStateRef.current?.lifecycle;
    if (lifecycle === "active") dispatchNavigation({ type: "pause", timestamp: Date.now() });
    else if (lifecycle === "paused") dispatchNavigation({ type: "resume", timestamp: Date.now() });
  }, [dispatchNavigation]);

  const previewOriginal = useCallback(() => {
    if (!route || !route.originalDocument || route.recoveryAvailable || !preparationController.canChangeSelection()) return;
    if (route.previewingOriginal) {
      void getLocalStorage().storage.getRoute(route.id).then((saved) => {
        if (preparationController.canChangeSelection() && routeRef.current?.id === route.id) setRoute(displayLocalRoute(saved));
      }).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not reopen prepared directions."));
    } else {
      const original = route.originalDocument;
      const distanceMeters = original.summary?.distanceMeters ?? original.segments.reduce((sum, segment) => sum + polylineDistance(segment.points), 0);
      setRoute({ ...route, document: original, distanceMeters, previewingOriginal: true });
    }
  }, [route, preparationController]);

  const revertPreparation = useCallback(async () => {
    if (!route || route.kind !== "local" || !preparationController.canChangeSelection()) return;
    try {
      const { storage } = getLocalStorage();
      const current = await storage.getOriginalRoute(route.id);
      if (!preparationController.canChangeSelection() || routeRef.current?.id !== route.id) return;
      const reverted = await storage.revertPreparation(route.id, buildSourceIdentityToken(current.record));
      setRoute(displayLocalRoute(reverted));
      await refreshLocalRoutes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not recover the original GPX.");
    }
  }, [route, refreshLocalRoutes, preparationController]);

  const backToLibrary = () => {
    if (!preparationController.canChangeSelection()) return;
    stopNavigation(); setRoute(null); setViewMode("routes");
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView
        style={styles.screen}
        edges={viewMode === "diagnostics" ? ["top", "bottom", "left", "right"] : []}
      >
        {viewMode === "diagnostics" && (
          <View style={styles.header}>
            <Text testID="text-brand" style={styles.brand}>
              Diagnostics
            </Text>
            {isTestMode && <Text testID="badge-test-mode" style={styles.testBadge}>TEST MODE</Text>}
            <Pressable
              testID="button-diagnostics-toggle"
              accessibilityRole="button"
              accessibilityLabel="Back to routes"
              onPress={() => setViewMode("routes")}
              style={styles.diagToggle}
            >
              <Text style={styles.diagToggleText}>‹ Routes</Text>
            </Pressable>
          </View>
        )}

        {route && navigating && navigationRide && navigationState ? (
          <>
            <KeepScreenAwake />
            <ActiveNavigationScreen
              route={route}
              ride={navigationRide}
              state={navigationState}
              engineError={navigationError}
              voiceEnabled={voiceEnabled}
              position={position}
              onToggleVoice={() => setVoiceEnabled((value) => !value)}
              onRepeatInstruction={repeatInstruction}
              onTogglePause={togglePauseNavigation}
              onEndNavigation={stopNavigation}
              isTestMode={isTestMode}
            />
          </>
        ) : viewMode === "create" ? (
          <CreateRideScreen
            initialDraft={draftRide}
            onSave={saveCreated}
            onDraftChange={setDraftRide}
            onBack={(discard) => {
              if (discard) setDraftRide(null);
              setViewMode("routes");
            }}
            isTestMode={isTestMode}
          />
        ) : viewMode === "diagnostics" ? (
          <DiagnosticsView
            testVerified={testVerified}
            testSamplesReady={testSamplesReady}
            onClearVerification={() => {
              setTestVerified(false);
              setTestSamplesReady(false);
            }}
          />
        ) : (
          <MainMapScreen
            route={route}
            localRoutes={localRoutes}
            publicRoutes={routes}
            input={input}
            onInputChange={setInput}
            onOpenInput={openInput}
            onSelectLocalRoute={(id) => void openLocalRoute(id)}
            onSelectPublicRoute={(id) => void openRoute(id)}
            onCreateRide={() => setViewMode("create")}
            onImportGpx={() => void handleImportGpx()}
            onBackToHome={backToLibrary}
            onStartNavigation={() => void startNavigation()}
            preparationState={preparationState}
            selectionLocked={!preparationController.canChangeSelection()}
            onPrepareDirections={() => void preparationController.prepare(false)}
            onCancelPreparation={() => preparationController.cancel()}
            onRetryPreparation={() => void preparationController.retry()}
            onChooseSparseInference={() => void preparationController.prepare(true)}
            onAcceptPreparation={(partial) => { if (!busy) void preparationController.accept(partial); }}
            onFocusPreparationWarning={() => {}}
            onPreviewOriginal={previewOriginal}
            onRevertPreparation={() => void revertPreparation()}
            onRenameRide={renameRide}
            onDeleteRide={deleteRide}
            onRefreshPublicRoutes={() => void refresh()}
            onSeedSyntheticLibrary={isTestMode ? handleSeedSyntheticLibrary : undefined}
            onOpenDiagnostics={() => setViewMode("diagnostics")}
            showDiagnostics={__DEV__ || process.env.EXPO_PUBLIC_ENABLE_DIAGNOSTICS === "true"}
            localStorageError={localStorageError}
            isTestMode={isTestMode}
          />
        )}

        {busy && (
          <View style={styles.loading}>
            <ActivityIndicator color="#d84b35" size="large" />
          </View>
        )}

        {error && (
          <Pressable
            testID="banner-error"
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
            onPress={() => setError(null)}
            style={styles.error}
          >
            <Text style={styles.errorText}>{error}</Text>
          </Pressable>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function KeepScreenAwake() {
  useKeepAwake();
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8f6f1" },
  header: {
    minHeight: 58,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd9d0",
  },
  brand: { fontSize: 19, fontWeight: "700", color: "#1b2521" },
  testBadge: { fontSize: 10, color: "#855000", backgroundColor: "#fff0bf", padding: 3, fontWeight: "800" },
  diagToggle: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    marginLeft: "auto",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#e8eaed",
  },
  diagToggleText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#3c4043",
  },
  loading: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(255,255,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 99,
  },
  error: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    minHeight: 44,
    justifyContent: "center",
    padding: 12,
    backgroundColor: "#fde8e8",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f8b4b4",
    zIndex: 100,
  },
  errorText: { color: "#9b1c1c", fontSize: 14 },
});
