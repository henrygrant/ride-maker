import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { useKeepAwake } from "expo-keep-awake";
import { Camera, GeoJSONSource, Layer, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import { PocketBaseRouteRepository, type SavedRoute } from "@ride-maker/persistence";
import { buildNavigationTrack, formatDistance, navigationFix, type NavigationFix } from "./navigation";
import { routeGeometry, routeIdFromLink } from "./route-view";

const repository = new PocketBaseRouteRepository("https://ridemaker.thg3.net/api");

export default function App() {
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [route, setRoute] = useState<SavedRoute | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [position, setPosition] = useState<Location.LocationObjectCoords | null>(null);
  const [fix, setFix] = useState<NavigationFix | null>(null);
  const [offRoute, setOffRoute] = useState(false);
  const [poorGps, setPoorGps] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const cameraRef = useRef<CameraRef>(null);
  const progressRef = useRef(0);
  const spokenRef = useRef(new Set<string>());

  const openRoute = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setNavigating(false);
      setRoute(await repository.get(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load route.");
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRoutes(await repository.listPublic());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load routes.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleUrl = (url: string | null) => {
      if (!url) return;
      const id = routeIdFromLink(url);
      if (id) void openRoute(id);
    };
    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener("url", (event) => handleUrl(event.url));
    return () => subscription.remove();
  }, [openRoute, refresh]);

  const openInput = () => {
    const id = routeIdFromLink(input);
    if (id) void openRoute(id);
    else setError("Paste a Ride Maker route link or a 15-character route ID.");
  };

  const geometry = useMemo(() => route ? routeGeometry(route.document) : null, [route]);
  const track = useMemo(() => route ? buildNavigationTrack(route.document) : null, [route]);
  const distance = route?.document.summary?.distanceMeters;

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

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          {route && <Pressable onPress={() => { stopNavigation(); setRoute(null); }}><Text style={styles.back}>‹ Routes</Text></Pressable>}
          <Text style={styles.brand}>Ride Maker</Text>
        </View>
        {route ? (
          <>
            {navigating && <KeepScreenAwake />}
            <View style={styles.routeHeader}>
              <Text style={styles.routeTitle}>{route.document.name}</Text>
              {typeof distance === "number" && <Text style={styles.muted}>{(distance / 1000).toFixed(1)} km</Text>}
            </View>
            {navigating && <View style={styles.guidance}>
              <Text style={styles.guidanceDistance}>
                {poorGps ? "Waiting for accurate GPS" : offRoute ? "Off route" : fix?.arrived ? "Arrived" : !fix ? "Locating…" : formatDistance(fix.distanceToNextMeters ?? fix.remainingMeters)}
              </Text>
              <Text style={styles.guidanceInstruction}>
                {poorGps ? "Move to an open area." : offRoute ? "Return to the route line. Automatic rerouting isn't available yet." : fix?.arrived ? "You reached the end of the route." : fix?.next?.maneuver.instruction ?? (track?.maneuvers.length ? "Continue to finish" : "No turn directions saved with this route.")}
              </Text>
              {fix && !offRoute && !poorGps && <Text style={styles.guidanceRemaining}>{formatDistance(fix.remainingMeters)} remaining</Text>}
            </View>}
            <View style={styles.mapContainer}>
              <Map mapStyle="https://tiles.openfreemap.org/styles/liberty" style={styles.map}>
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
            <View style={styles.navigationBar}>
              {navigating && <Pressable onPress={() => setVoiceEnabled((value) => !value)} style={styles.voiceButton}><Text style={styles.action}>{voiceEnabled ? "Mute" : "Unmute"}</Text></Pressable>}
              <Pressable onPress={() => navigating ? stopNavigation() : void startNavigation()} style={[styles.button, styles.navigationButton]}>
                <Text style={styles.buttonText}>{navigating ? "Stop navigation" : "Start navigation"}</Text>
              </Pressable>
            </View>
            <Text style={styles.footer}>Foreground guidance only · keep the app open while riding</Text>
          </>
        ) : (
          <>
            <View style={styles.inputArea}>
              <Text style={styles.sectionTitle}>Open a route</Text>
              <TextInput
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
              <Pressable onPress={openInput} style={styles.button}><Text style={styles.buttonText}>View route</Text></Pressable>
            </View>
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
        {error && <Pressable onPress={() => setError(null)} style={styles.error}><Text style={styles.errorText}>{error}</Text></Pressable>}
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
  header: { minHeight: 58, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 16, borderBottomWidth: 1, borderBottomColor: "#ddd9d0" },
  brand: { fontSize: 19, fontWeight: "700", color: "#1b2521" },
  back: { color: "#ec4b35", fontSize: 16, fontWeight: "600" },
  routeHeader: { paddingHorizontal: 20, paddingVertical: 14, gap: 3 },
  routeTitle: { color: "#1b2521", fontSize: 22, fontWeight: "700" },
  muted: { color: "#69736f", fontSize: 14 },
  guidance: { backgroundColor: "#28312d", paddingHorizontal: 20, paddingVertical: 14, gap: 3 },
  guidanceDistance: { color: "#fff", fontSize: 28, fontWeight: "800" },
  guidanceInstruction: { color: "#fff", fontSize: 17, fontWeight: "600" },
  guidanceRemaining: { color: "#c4cbc6", fontSize: 13, marginTop: 3 },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  navigationBar: { flexDirection: "row", padding: 12, alignItems: "center", gap: 12 },
  navigationButton: { flex: 1 },
  voiceButton: { paddingHorizontal: 10, paddingVertical: 12 },
  footer: { paddingBottom: 10, color: "#69736f", textAlign: "center", fontSize: 12 },
  inputArea: { padding: 20, gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#1b2521" },
  input: { borderWidth: 1, borderColor: "#d8d3c9", borderRadius: 8, backgroundColor: "#fff", padding: 13, fontSize: 15 },
  button: { backgroundColor: "#ec4b35", borderRadius: 8, padding: 13, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  listHeader: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: "row", justifyContent: "space-between" },
  action: { color: "#ec4b35", fontWeight: "600" },
  routeRow: { marginHorizontal: 20, paddingVertical: 17, borderBottomColor: "#ddd9d0", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between" },
  routeName: { color: "#1b2521", fontSize: 16, fontWeight: "600" },
  empty: { color: "#69736f", lineHeight: 20, paddingHorizontal: 20, paddingTop: 8 },
  loading: { position: "absolute", right: 20, top: 70, padding: 8, backgroundColor: "#fff", borderRadius: 20 },
  error: { position: "absolute", bottom: 20, left: 20, right: 20, backgroundColor: "#28312d", borderRadius: 8, padding: 14 },
  errorText: { color: "#fff" },
});
