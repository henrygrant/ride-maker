import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import * as DocumentPicker from "expo-document-picker";
import { useKeepAwake } from "expo-keep-awake";
import { Camera, GeoJSONSource, Layer, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import type { RouteDocument } from "@ride-maker/domain";
import type { SavedRoute } from "@ride-maker/persistence";
import { buildNavigationTrack, formatDistance, navigationFix, type NavigationFix } from "./navigation";
import { routeGeometry, routeIdFromLink } from "./route-view";
import { DiagnosticsView } from "./diagnostics/DiagnosticsView";
import { FileSystemDiagnosticStorage } from "./diagnostics/file-storage";
import { createDefaultRouteRepository } from "./route-repository";
import {
  createDefaultLocalStorage,
  observeLocalStorage,
  type LocalRouteRecord,
} from "./storage";

export type DisplayRoute = {
  id: string;
  slug?: string;
  kind?: "local" | "remote";
  distanceMeters?: number;
  document: RouteDocument;
};

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
  const [viewMode, setViewMode] = useState<"routes" | "diagnostics">("routes");
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [localStorageError, setLocalStorageError] = useState<string | null>(null);
  const [localRoutes, setLocalRoutes] = useState<LocalRouteRecord[]>([]);
  const [route, setRoute] = useState<DisplayRoute | null>(null);
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
  const [testMapRendered, setTestMapRendered] = useState(false);
  const cameraRef = useRef<CameraRef>(null);
  const progressRef = useRef(0);
  const spokenRef = useRef(new Set<string>());
  const importInProgressRef = useRef(false);

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

  const openRoute = useCallback(async (id: string) => {
    setTestMapRendered(false);
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
    setTestMapRendered(false);
    setBusy(true);
    setError(null);
    try {
      setNavigating(false);
      const { storage } = getLocalStorage();
      const loaded = await storage.getRoute(id);
      setRoute({
        id: loaded.record.id,
        kind: "local",
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
  }, [isTestMode, openRoute, emitTestObservation]);

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
      setTestMapRendered(false);
      setNavigating(false);
      setRoute({
        id: loaded.record.id,
        kind: "local",
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

  const geometry = useMemo(() => (route ? routeGeometry(route.document) : null), [route]);
  const track = useMemo(() => (route ? buildNavigationTrack(route.document) : null), [route]);
  const distance = route?.distanceMeters ?? route?.document.summary?.distanceMeters;

  const stopNavigation = useCallback(() => {
    setNavigating(false);
    setOffRoute(false);
    setPoorGps(false);
    setFix(null);
    setPosition(null);
    void Speech.stop();
  }, []);

  const startNavigation = async () => {
    if (!track) {
      setError("This route has no usable track to follow.");
      return;
    }

    // Prevent concurrent route speech and diagnostic session speech
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

  useEffect(() => {
    if (!navigating || !track) return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
      (location) => {
        if (cancelled) return;
        const { coords } = location;
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
      if (cancelled) result.remove();
      else subscription = result;
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setNavigating(false);
        setError(cause instanceof Error ? cause.message : "Location tracking failed.");
      }
    });
    return () => {
      cancelled = true;
      subscription?.remove();
      void Speech.stop();
    };
  }, [navigating, track, voiceEnabled]);

  useEffect(() => {
    if (navigating && position) {
      cameraRef.current?.easeTo({ center: [position.longitude, position.latitude], zoom: 16, duration: 350 });
    }
  }, [navigating, position]);

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

  const showDiagnosticsToggle = !route && (__DEV__ || process.env.EXPO_PUBLIC_ENABLE_DIAGNOSTICS === "true");

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          {route && <Pressable testID="button-back" accessibilityRole="button" accessibilityLabel="Back to routes" onPress={() => { stopNavigation(); setRoute(null); }}><Text style={styles.back}>‹ Routes</Text></Pressable>}
          <Text testID="text-brand" style={styles.brand}>Ride Maker</Text>
          {isTestMode && <Text testID="badge-test-mode" style={styles.testBadge}>TEST MODE</Text>}
          {showDiagnosticsToggle && (
            <Pressable
              testID="button-diagnostics-toggle"
              accessibilityRole="button"
              accessibilityLabel={viewMode === "diagnostics" ? "Back to routes" : "Open diagnostics"}
              onPress={() => {
                void Speech.stop();
                setViewMode((prev) => (prev === "routes" ? "diagnostics" : "routes"));
              }}
              style={styles.diagToggle}
            >
              <Text style={styles.diagToggleText}>
                {viewMode === "diagnostics" ? "‹ Routes" : "Diagnostics"}
              </Text>
            </Pressable>
          )}
        </View>
        {route ? (
          <>
            {navigating && <KeepScreenAwake />}
            <View style={styles.routeHeader}>
              <Text testID="text-route-title" style={styles.routeTitle}>{route.document.name}</Text>
              {typeof distance === "number" && <Text testID="text-route-distance" style={styles.muted}>{(distance / 1000).toFixed(1)} km</Text>}
            </View>
            {route.kind === "local" && (
              <View testID="view-guidance-notice" style={styles.guidanceNotice}>
                <Text testID="text-guidance-notice" style={styles.guidanceNoticeText}>
                  Route saved. Turn-by-turn guidance is coming next.
                </Text>
              </View>
            )}
            {navigating && <View testID="view-guidance" style={styles.guidance}>
              <Text style={styles.guidanceDistance}>
                {poorGps ? "Waiting for accurate GPS" : offRoute ? "Off route" : fix?.arrived ? "Arrived" : !fix ? "Locating…" : formatDistance(fix.distanceToNextMeters ?? fix.remainingMeters)}
              </Text>
              <Text style={styles.guidanceInstruction}>
                {poorGps ? "Move to an open area." : offRoute ? "Return to the route line. Automatic rerouting isn't available yet." : fix?.arrived ? "You reached the end of the route." : fix?.next?.maneuver.instruction ?? (track?.maneuvers.length ? "Continue to finish" : "No turn directions saved with this route.")}
              </Text>
              {fix && !offRoute && !poorGps && <Text style={styles.guidanceRemaining}>{formatDistance(fix.remainingMeters)} remaining</Text>}
            </View>}
            {isTestMode && testMapRendered && <Text testID="test-map-rendered">MAP_RENDERED</Text>}
            <View testID="view-map" style={styles.mapContainer}>
              <Map
                mapStyle="https://tiles.openfreemap.org/styles/liberty"
                style={styles.map}
                onDidFinishRenderingMapFully={() => {
                  if (isTestMode) setTestMapRendered(true);
                }}
              >
                <Camera
                  key={route.id}
                  ref={cameraRef}
                  initialViewState={geometry?.bounds ? { bounds: geometry.bounds, padding: { top: 40, right: 40, bottom: 40, left: 40 } } : { center: [-73.9866, 40.7306], zoom: 10 }}
                />
                {geometry && <GeoJSONSource id="route" data={geometry.shape}>
                  <Layer id="route-casing" type="line" paint={{ "line-color": "#ffffff", "line-width": 8 }} />
                  <Layer id="route-line" type="line" paint={{ "line-color": "#ec4b35", "line-width": 5 }} />
                </GeoJSONSource>}
                {position && <GeoJSONSource id="rider" data={{ type: "Point", coordinates: [position.longitude, position.latitude] }}>
                  <Layer id="rider-halo" type="circle" paint={{ "circle-color": "#ffffff", "circle-radius": 11 }} />
                  <Layer id="rider-dot" type="circle" paint={{ "circle-color": "#1479c9", "circle-radius": 7 }} />
                </GeoJSONSource>}
              </Map>
            </View>
            {route.kind !== "local" && (
              <View style={styles.navigationBar}>
                {navigating && <Pressable testID="button-voice-toggle" accessibilityRole="button" accessibilityLabel={voiceEnabled ? "Mute voice guidance" : "Unmute voice guidance"} onPress={() => setVoiceEnabled((value) => !value)} style={styles.voiceButton}><Text style={styles.action}>{voiceEnabled ? "Mute" : "Unmute"}</Text></Pressable>}
                <Pressable testID="button-navigation-toggle" accessibilityRole="button" accessibilityLabel={navigating ? "Stop navigation" : "Start navigation"} onPress={() => navigating ? stopNavigation() : void startNavigation()} style={[styles.button, styles.navigationButton]}>
                  <Text style={styles.buttonText}>{navigating ? "Stop navigation" : "Start navigation"}</Text>
                </Pressable>
              </View>
            )}
            <Text style={styles.footer}>
              {route.kind === "local"
                ? "Saved route data is offline · foreground guidance only · maps require network"
                : "Foreground guidance only · maps require network"}
            </Text>
          </>
        ) : viewMode === "diagnostics" ? (
          <DiagnosticsView testVerified={testVerified} testSamplesReady={testSamplesReady} onClearVerification={() => { setTestVerified(false); setTestSamplesReady(false); }} />
        ) : (
          <>
            <View style={styles.importArea}>
              <Pressable
                testID="button-import-gpx"
                accessibilityRole="button"
                accessibilityLabel="Import GPX"
                onPress={() => void handleImportGpx()}
                style={[styles.button, styles.importButton]}
              >
                <Text style={styles.buttonText}>Import GPX file</Text>
              </Pressable>
            </View>
            {localStorageError && <View testID="banner-storage-error" style={styles.inputArea}>
              <Text>{localStorageError}</Text>
              <Pressable testID="button-retry-saved-routes" accessibilityRole="button" accessibilityLabel="Retry saved routes" onPress={() => void refreshLocalRoutes()}><Text style={styles.action}>Retry</Text></Pressable>
            </View>}
            <View style={styles.inputArea}>
              <Text style={styles.sectionTitle}>Open a route</Text>
              <TextInput
                testID="input-route-id"
                accessibilityLabel="Route link or ID"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setInput}
                onSubmitEditing={openInput}
                placeholder="Paste a route link or ID"
                returnKeyType="go"
                style={styles.input}
                value={input}
              />
              <Pressable testID="button-view-route" accessibilityRole="button" accessibilityLabel="View route" onPress={openInput} style={styles.button}><Text style={styles.buttonText}>View route</Text></Pressable>
            </View>
            <View style={styles.listHeader}>
              <Text testID="text-local-routes-section" style={styles.sectionTitle}>Saved routes</Text>
              <Pressable onPress={() => void refreshLocalRoutes()}><Text style={styles.action}>Refresh</Text></Pressable>
            </View>
            <FlatList
              data={localRoutes}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              ListEmptyComponent={<Text style={styles.empty}>No saved routes yet. Import a GPX file above.</Text>}
              renderItem={({ item }) => (
                <Pressable
                  testID={`button-open-local-route-${item.id}`}
                  onPress={() => void openLocalRoute(item.id)}
                  style={styles.routeRow}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeName}>{item.name}</Text>
                    {typeof item.distanceMeters === "number" && (
                      <Text style={styles.muted}>{(item.distanceMeters / 1000).toFixed(1)} km</Text>
                    )}
                  </View>
                  <Text style={styles.action}>View →</Text>
                </Pressable>
              )}
            />
            <View style={styles.listHeader}>
              <Text style={styles.sectionTitle}>Public routes</Text>
              <Pressable onPress={() => void refresh()}><Text style={styles.action}>Refresh</Text></Pressable>
            </View>
            <FlatList
              data={routes}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={<Text style={styles.empty}>No public routes yet. Unlisted routes can be opened with their link.</Text>}
              renderItem={({ item }) => <Pressable onPress={() => void openRoute(item.id)} style={styles.routeRow}>
                <Text style={styles.routeName}>{item.document.name}</Text>
                <Text style={styles.action}>View →</Text>
              </Pressable>}
            />
          </>
        )}
        {busy && <View style={styles.loading}><ActivityIndicator color="#ec4b35" /></View>}
        {error && <Pressable testID="banner-error" accessibilityRole="button" accessibilityLabel="Dismiss error" onPress={() => setError(null)} style={styles.error}><Text style={styles.errorText}>{error}</Text></Pressable>}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function KeepScreenAwake() {
  useKeepAwake();
  return null;
}

const styles = StyleSheet.create({
  testBadge: { fontSize: 10, color: "#855000", backgroundColor: "#fff0bf", padding: 3 },
  screen: { flex: 1, backgroundColor: "#f8f6f1" },
  header: { minHeight: 58, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 16, borderBottomWidth: 1, borderBottomColor: "#ddd9d0" },
  brand: { fontSize: 19, fontWeight: "700", color: "#1b2521" },
  back: { color: "#ec4b35", fontSize: 16, fontWeight: "600" },
  diagToggle: {
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
  routeHeader: { paddingHorizontal: 20, paddingVertical: 14, gap: 3 },
  routeTitle: { color: "#1b2521", fontSize: 22, fontWeight: "700" },
  muted: { color: "#69736f", fontSize: 14 },
  guidanceNotice: { backgroundColor: "#eef6f2", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#cce5d6" },
  guidanceNoticeText: { color: "#1b5e3b", fontSize: 14, fontWeight: "600" },
  guidance: { backgroundColor: "#28312d", paddingHorizontal: 20, paddingVertical: 14, gap: 3 },
  guidanceDistance: { color: "#fff", fontSize: 28, fontWeight: "800" },
  guidanceInstruction: { color: "#fff", fontSize: 17, fontWeight: "600" },
  guidanceRemaining: { color: "#c4cbc6", fontSize: 13, marginTop: 3 },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  navigationBar: { flexDirection: "row", padding: 12, alignItems: "center", gap: 12 },
  navigationButton: { flex: 1 },
  voiceButton: { paddingHorizontal: 10, paddingVertical: 12 },
  button: { backgroundColor: "#ec4b35", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  action: { color: "#ec4b35", fontSize: 14, fontWeight: "600" },
  importArea: { paddingHorizontal: 20, paddingTop: 16 },
  importButton: { backgroundColor: "#1b2521" },
  inputArea: { padding: 20, gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#1b2521" },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd9d0", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  listHeader: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  routeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#ede9e0" },
  routeName: { fontSize: 16, fontWeight: "600", color: "#1b2521" },
  empty: { padding: 20, textAlign: "center", color: "#69736f", fontStyle: "italic" },
  loading: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(255,255,255,0.7)", alignItems: "center", justifyContent: "center" },
  error: { margin: 20, padding: 12, backgroundColor: "#fde8e8", borderRadius: 8, borderWidth: 1, borderColor: "#f8b4b4" },
  errorText: { color: "#9b1c1c", fontSize: 14 },
  footer: { padding: 12, textAlign: "center", fontSize: 12, color: "#69736f", backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#ddd9d0" },
});
