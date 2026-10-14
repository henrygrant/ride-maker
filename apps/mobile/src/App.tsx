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
import { buildNavigationTrack, formatDistance, navigationFix, type NavigationFix } from "./navigation";
import { routeIdFromLink } from "./route-view";
import { DiagnosticsView } from "./diagnostics/DiagnosticsView";
import { FileSystemDiagnosticStorage } from "./diagnostics/file-storage";
import { createDefaultRouteRepository } from "./route-repository";
import {
  createDefaultLocalStorage,
  observeLocalStorage,
  type LocalRouteRecord,
} from "./storage";
import { seedSyntheticLibrary } from "./storage/synthetic-library";

import type { DisplayRoute } from "./types";
import { CreateRideScreen } from "./screens/CreateRideScreen";
import type { ControllerDraftSnapshot } from "./controllers/create-ride-controller";
import { ActiveNavigationScreen } from "./screens/ActiveNavigationScreen";
import { MainMapScreen } from "./screens/MainMapScreen";
export type { DisplayRoute };

const repository = createDefaultRouteRepository();
const diagnosticStorage = new FileSystemDiagnosticStorage();

let defaultLocalStorage: ReturnType<typeof createDefaultLocalStorage> | null = null;
function getLocalStorage() {
  if (!defaultLocalStorage) {
    defaultLocalStorage = createDefaultLocalStorage();
  }
  return defaultLocalStorage;
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
  const [fix, setFix] = useState<NavigationFix | null>(null);
  const [offRoute, setOffRoute] = useState(false);
  const [poorGps, setPoorGps] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [testVerified, setTestVerified] = useState(false);
  const [testSamplesReady, setTestSamplesReady] = useState(false);
  const progressRef = useRef(0);
  const spokenRef = useRef(new Set<string>());
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

  const handleSeedSyntheticLibrary = useCallback(async () => {
    if (!isTestMode) return;
    try {
      const { storage } = getLocalStorage();
      await seedSyntheticLibrary(storage);
      await refreshLocalRoutes();
    } catch (err) {
      console.error("[SEED_SYNTHETIC_LIBRARY_ERROR]", err);
    }
  }, [isTestMode, refreshLocalRoutes]);

  const openRoute = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setNavigating(false);
      const fetched = await repository.get(id);
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
  }, []);

  const openLocalRoute = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setNavigating(false);
      const { storage } = getLocalStorage();
      const loaded = await storage.getRoute(id);
      setRoute({
        id: loaded.record.id,
        kind: "local",
        sourceKind: loaded.record.sourceKind ?? "imported",
        distanceMeters: loaded.record.distanceMeters,
        document: loaded.document,
      });
      setViewMode("routes");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load saved route.");
    } finally {
      setBusy(false);
    }
  }, []);

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
    if (importInProgressRef.current) return;
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
      setNavigating(false);
      setRoute({
        id: loaded.record.id,
        kind: "local",
        sourceKind: loaded.record.sourceKind ?? "imported",
        distanceMeters: loaded.record.distanceMeters,
        document: loaded.document,
      });
      setViewMode("routes");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to import GPX file.");
    } finally {
      importInProgressRef.current = false;
      setBusy(false);
    }
  }, []);

  const openInput = useCallback(() => {
    const id = routeIdFromLink(input);
    if (!id) {
      setError("Please paste a route link or 15-character route ID.");
      return;
    }
    void openRoute(id);
  }, [input, openRoute]);

  const saveCreated = useCallback(async (document: RouteDocument) => {
    const { storage } = getLocalStorage();
    const record = await storage.saveCreatedRoute(document);
    await refreshLocalRoutes();
    setDraftRide(null);
    setRoute({ id: record.id, kind: "local", sourceKind: "created", distanceMeters: record.distanceMeters, document });
    setNavigating(false);
    setViewMode("routes");
  }, [refreshLocalRoutes]);

  const renameRide = useCallback(async (name: string) => {
    if (!route || route.kind !== "local") return;
    const { storage } = getLocalStorage();
    await storage.renameRoute(route.id, name);
    const saved = await storage.getRoute(route.id);
    setRoute({ ...route, document: saved.document });
    await refreshLocalRoutes();
  }, [route, refreshLocalRoutes]);

  const deleteRide = useCallback(async () => {
    if (!route || route.kind !== "local") return;
    const { storage } = getLocalStorage();
    await storage.deleteRoute(route.id);
    setRoute(null);
    setViewMode("routes");
    await refreshLocalRoutes();
  }, [route, refreshLocalRoutes]);

  const track = useMemo(() => {
    if (!route) return null;
    return buildNavigationTrack(route.document);
  }, [route]);

  const startNavigation = async () => {
    if (!track) {
      setError("This route has no usable track to follow.");
      return;
    }

    try {
      const activeDiag = await diagnosticStorage.getSession();
      if (activeDiag && activeDiag.status === "running") {
        setError("Please stop active background diagnostics before starting route navigation.");
        return;
      }
    } catch {
      // Continue if diagnostic storage check fails
    }

    void Speech.stop();

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError("Allow location access to follow this route.");
        return;
      }
      progressRef.current = 0;
      spokenRef.current.clear();
      setError(null);
      setNavigating(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start location tracking.");
    }
  };

  const stopNavigation = useCallback(() => {
    setNavigating(false);
    setOffRoute(false);
    setPoorGps(false);
    setFix(null);
    setPosition(null);
    void Speech.stop();
  }, []);

  useEffect(() => {
    if (!navigating || !track) return;
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
        const accuracy = coords.accuracy ?? 100;
        const unreliable = accuracy > 100;
        setPoorGps(unreliable);
        if (unreliable) return;
        const nextFix = navigationFix(track, coords, progressRef.current);
        const isOffRoute = nextFix.offRouteMeters > Math.max(50, accuracy * 2);
        setOffRoute(isOffRoute);
        if (isOffRoute) return;
        progressRef.current = Math.max(progressRef.current, nextFix.progressMeters);
        setFix(nextFix);
        if (!voiceEnabled) return;
        if (nextFix.arrived) {
          if (!spokenRef.current.has("arrived")) {
            spokenRef.current.add("arrived");
            void Speech.stop().then(() => { if (!cancelled) Speech.speak("You have arrived."); });
          }
          return;
        }
        const next = nextFix.next;
        const meters = nextFix.distanceToNextMeters;
        if (!next || meters === null) return;
        const nowKey = `${next.maneuver.id}:now`;
        const approachKey = `${next.maneuver.id}:approach`;
        if (meters <= 30 && !spokenRef.current.has(nowKey)) {
          spokenRef.current.add(nowKey);
          spokenRef.current.add(approachKey);
          void Speech.stop().then(() => { if (!cancelled) Speech.speak(next.maneuver.instruction); });
        } else if (meters <= 150 && !spokenRef.current.has(approachKey)) {
          spokenRef.current.add(approachKey);
          void Speech.stop().then(() => { if (!cancelled) Speech.speak(`In ${formatDistance(meters)}, ${next.maneuver.instruction}`); });
        }
      },
      (cause) => { if (!cancelled) setError(cause); },
    ).then((result) => {
      if (cancelled) {
        result.remove();
        if (isTestMode) {
          console.log(`[E2E_NAV_PROVIDER] unsubscribed=true totalSamples=${sampleCounterRef.current}`);
        }
      } else {
        subscription = result;
        if (isTestMode) console.log("[E2E_NAV_PROVIDER] subscribed=true");
      }
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setNavigating(false);
        setError(cause instanceof Error ? cause.message : "Location tracking failed.");
      }
    });
    return () => {
      cancelled = true;
      if (subscription) {
        subscription.remove();
        if (isTestMode) {
          console.log(`[E2E_NAV_PROVIDER] unsubscribed=true totalSamples=${sampleCounterRef.current}`);
        }
      }
      void Speech.stop();
    };
  }, [navigating, track, voiceEnabled, isTestMode]);

  useEffect(() => {
    if (!navigating) return;
    const instruction = poorGps
      ? "Move to an open area."
      : offRoute
      ? "Return to the route line. Automatic rerouting isn't available yet."
      : fix?.arrived
      ? "You reached the end of the route."
      : fix?.next?.maneuver.instruction ?? (track?.maneuvers.length ? "Continue to finish" : "No turn directions saved with this route.");
    const distanceText = poorGps
      ? "Waiting for accurate GPS"
      : offRoute
      ? "Off route"
      : fix?.arrived
      ? "Arrived"
      : !fix
      ? "Locating…"
      : formatDistance(fix.distanceToNextMeters ?? fix.remainingMeters);
    if (isTestMode) {
      console.log(`[E2E_NAV_STAGE] instruction="${instruction}" distance="${distanceText}" arrived=${Boolean(fix?.arrived)} offRoute=${Boolean(offRoute)}`);
    }
  }, [isTestMode, navigating, poorGps, offRoute, fix, track]);

  const backToLibrary = () => { stopNavigation(); setRoute(null); setViewMode("routes"); };

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

        {route && navigating ? (
          <>
            <KeepScreenAwake />
            <ActiveNavigationScreen
              route={route}
              track={track}
              fix={fix}
              offRoute={offRoute}
              poorGps={poorGps}
              voiceEnabled={voiceEnabled}
              position={position}
              onToggleVoice={() => setVoiceEnabled((value) => !value)}
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
