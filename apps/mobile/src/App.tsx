import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Camera, GeoJSONSource, Layer, Map } from "@maplibre/maplibre-react-native";
import { PocketBaseRouteRepository, type SavedRoute } from "@ride-maker/persistence";
import { routeGeometry, routeIdFromLink } from "./route-view";

const repository = new PocketBaseRouteRepository("https://ridemaker.thg3.net/api");

export default function App() {
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [route, setRoute] = useState<SavedRoute | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openRoute = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
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
  const distance = route?.document.summary?.distanceMeters;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          {route && <Pressable onPress={() => setRoute(null)}><Text style={styles.back}>‹ Routes</Text></Pressable>}
          <Text style={styles.brand}>Ride Maker</Text>
        </View>
        {route ? (
          <>
            <View style={styles.routeHeader}>
              <Text style={styles.routeTitle}>{route.document.name}</Text>
              {typeof distance === "number" && <Text style={styles.muted}>{(distance / 1000).toFixed(1)} km</Text>}
            </View>
            <View style={styles.mapContainer}>
              <Map mapStyle="https://tiles.openfreemap.org/styles/liberty" style={styles.map}>
                <Camera
                  key={route.id}
                  initialViewState={geometry?.bounds ? { bounds: geometry.bounds, padding: { top: 40, right: 40, bottom: 40, left: 40 } } : { center: [-73.9866, 40.7306], zoom: 10 }}
                />
                {geometry && <GeoJSONSource id="route" data={geometry.shape}>
                  <Layer id="route-casing" type="line" paint={{ "line-color": "#ffffff", "line-width": 8 }} />
                  <Layer id="route-line" type="line" paint={{ "line-color": "#ec4b35", "line-width": 5 }} />
                </GeoJSONSource>}
              </Map>
            </View>
            <Text style={styles.footer}>Route preview only · no navigation or location tracking</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8f6f1" },
  header: { minHeight: 58, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 16, borderBottomWidth: 1, borderBottomColor: "#ddd9d0" },
  brand: { fontSize: 19, fontWeight: "700", color: "#1b2521" },
  back: { color: "#ec4b35", fontSize: 16, fontWeight: "600" },
  routeHeader: { paddingHorizontal: 20, paddingVertical: 14, gap: 3 },
  routeTitle: { color: "#1b2521", fontSize: 22, fontWeight: "700" },
  muted: { color: "#69736f", fontSize: 14 },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  footer: { padding: 14, color: "#69736f", textAlign: "center", fontSize: 12 },
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
