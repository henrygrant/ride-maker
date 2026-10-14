import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type CameraRef,
  type MapRef,
} from "@maplibre/maplibre-react-native";
import * as Location from "expo-location";
import type { SavedRoute } from "@ride-maker/persistence";
import type { DisplayRoute } from "../types";
import type { LocalRouteRecord } from "../storage/types";
import { routeGeometry } from "../route-view";
import { MapHomeDock } from "../components/MapHomeDock";
import { MyRidesDrawer } from "../components/MyRidesDrawer";
import { SelectedRideDock } from "../components/SelectedRideDock";

export type MainMapScreenProps = {
  route: DisplayRoute | null;
  localRoutes: LocalRouteRecord[];
  publicRoutes: SavedRoute[];
  input: string;
  onInputChange: (val: string) => void;
  onOpenInput: () => void;
  onSelectLocalRoute: (id: string) => void;
  onSelectPublicRoute: (id: string) => void;
  onCreateRide: () => void;
  onImportGpx: () => void;
  onBackToHome: () => void;
  onStartNavigation: () => void;
  onRenameRide: (newName: string) => Promise<void>;
  onDeleteRide: () => Promise<void>;
  onRefreshPublicRoutes: () => void;
  onSeedSyntheticLibrary?: (() => void) | undefined;
  onOpenDiagnostics?: (() => void) | undefined;
  showDiagnostics?: boolean | undefined;
  localStorageError?: string | null | undefined;
  isTestMode?: boolean | undefined;
};

export function MainMapScreen({
  route,
  localRoutes,
  publicRoutes,
  input,
  onInputChange,
  onOpenInput,
  onSelectLocalRoute,
  onSelectPublicRoute,
  onCreateRide,
  onImportGpx,
  onBackToHome,
  onStartNavigation,
  onRenameRide,
  onDeleteRide,
  onRefreshPublicRoutes,
  onSeedSyntheticLibrary,
  onOpenDiagnostics,
  showDiagnostics,
  localStorageError,
  isTestMode = false,
}: MainMapScreenProps) {
  const insets = useSafeAreaInsets();
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [testMapRendered, setTestMapRendered] = useState(false);
  const [dockHeight, setDockHeight] = useState(230);
  const [drawerHeight, setDrawerHeight] = useState(380);
  const [locateFeedback, setLocateFeedback] = useState<string | null>(null);

  // Map render observation relies strictly on real MapLibre fully rendered callback
  const markMapRendered = useCallback(() => {
    console.log("[MAIN_MAP] onDidFinishRenderingMapFully fired");
    setTestMapRendered(true);
  }, []);

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const lastFittedGeometryKeyRef = useRef<string | null>(null);

  // Memoize geometry calculation keyed strictly on route document
  const geometry = useMemo(() => {
    return route ? routeGeometry(route.document) : null;
  }, [route?.document]);

  // Extract start and finish coordinates if available
  const startCoord: [number, number] | null =
    route?.document.segments[0]?.points[0]
      ? [
          route.document.segments[0].points[0].longitude,
          route.document.segments[0].points[0].latitude,
        ]
      : null;

  const lastSegment = route?.document.segments[route.document.segments.length - 1];
  const lastPoint = lastSegment?.points[lastSegment.points.length - 1];
  const finishCoord: [number, number] | null = lastPoint
    ? [lastPoint.longitude, lastPoint.latitude]
    : null;

  // Auto-close drawer when route is active
  useEffect(() => {
    if (route) {
      setIsLibraryOpen(false);
    }
  }, [route?.id]);

  // Fit camera bounds ONLY when actual route geometry changes (not on UI toggles, rename, drawer open, or ordinary pan)
  const routeGeometryKey = route
    ? `${route.id}:${route.document.segments.map((s) => s.points.length).join(",")}`
    : null;

  useEffect(() => {
    if (route && geometry?.bounds) {
      if (lastFittedGeometryKeyRef.current !== routeGeometryKey) {
        lastFittedGeometryKeyRef.current = routeGeometryKey;
        const bottomPadding = Math.max(dockHeight, 220) + insets.bottom + 20;
        cameraRef.current?.fitBounds(geometry.bounds, {
          padding: {
            top: insets.top + 70,
            right: 40,
            bottom: bottomPadding,
            left: 40,
          },
          duration: 400,
        });
      }
    } else {
      lastFittedGeometryKeyRef.current = null;
    }
  }, [route?.id, routeGeometryKey, geometry?.bounds, dockHeight, insets.top, insets.bottom]);

  // Back handler hierarchy: drawer first, then clear selected route to map home
  useEffect(() => {
    const handleBackPress = () => {
      if (isLibraryOpen) {
        setIsLibraryOpen(false);
        return true;
      }
      if (route) {
        onBackToHome();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener("hardwareBackPress", handleBackPress);
    return () => subscription.remove();
  }, [isLibraryOpen, route, onBackToHome]);

  // Auto-dismiss locate feedback after 4 seconds
  useEffect(() => {
    if (locateFeedback) {
      const timer = setTimeout(() => setLocateFeedback(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [locateFeedback]);

  // Camera-only locate action with localized, actionable user feedback
  const handleLocateMe = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocateFeedback("Location permission was denied. Enable location in device settings to center the map.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLocateFeedback(null);
      cameraRef.current?.easeTo({
        center: [loc.coords.longitude, loc.coords.latitude],
        zoom: 14,
        duration: 500,
      });
    } catch {
      setLocateFeedback("Unable to determine current location. Ensure GPS is enabled.");
    }
  };

  const attributionBottom =
    (isLibraryOpen ? drawerHeight : dockHeight) + Math.max(insets.bottom, 12) + 8;

  return (
    <View testID="view-map" style={styles.container}>
      {/* Persistent MapLibre Map across Home, Drawer, and Selected Detail */}
      <Map
        ref={mapRef}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        style={StyleSheet.absoluteFill}
        attributionPosition={{ bottom: attributionBottom, left: 14 }}
        onDidFinishRenderingMapFully={markMapRendered}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: [-73.968, 40.785], zoom: 12 }}
        />

        {/* Selected route geometry: MultiLineString */}
        {geometry && (
          <GeoJSONSource id="selected-route-source" data={geometry.shape}>
            <Layer
              id="selected-route-casing"
              type="line"
              paint={{ "line-color": "#ffffff", "line-width": 8 }}
            />
            <Layer
              id="selected-route-line"
              type="line"
              paint={{ "line-color": "#1e8068", "line-width": 5 }}
            />
          </GeoJSONSource>
        )}

        {/* Start Point Marker (S) */}
        {startCoord && (
          <Marker
            key={`start-${route?.id}`}
            id="point-start"
            lngLat={startCoord}
            pointerEvents="none"
          >
            <View style={[styles.markerBase, styles.markerStart]}>
              <Text style={styles.markerText}>S</Text>
            </View>
          </Marker>
        )}

        {/* Finish Point Marker (F) */}
        {finishCoord && (
          <Marker
            key={`finish-${route?.id}`}
            id="point-finish"
            lngLat={finishCoord}
            pointerEvents="none"
          >
            <View style={[styles.markerBase, styles.markerFinish]}>
              <Text style={styles.markerText}>F</Text>
            </View>
          </Marker>
        )}
      </Map>

      {/* Floating Top Navigation Bar */}
      <View
        style={[
          styles.topBar,
          { top: insets.top + 8, paddingHorizontal: 16 },
        ]}
        pointerEvents="box-none"
      >
        {route ? (
          <Pressable
            testID="button-back"
            accessibilityRole="button"
            accessibilityLabel="Back to map home"
            onPress={onBackToHome}
            style={styles.backCircleButton}
          >
            <Text style={styles.backCircleIcon}>‹</Text>
          </Pressable>
        ) : (
          <View style={styles.brandPill}>
            <Text style={styles.brandIcon}>☡</Text>
            <Text testID="text-brand" style={styles.brandText}>
              Ride Maker
            </Text>
          </View>
        )}

        <View style={styles.topRightGroup} pointerEvents="box-none">
          {isTestMode && (
            <View style={styles.testBadgeContainer}>
              <Text testID="badge-test-mode" style={styles.testBadge}>
                TEST MODE
              </Text>
              {testMapRendered && (
                <Text testID="test-map-rendered" style={styles.testMapMarker}>
                  MAP_RENDERED
                </Text>
              )}
            </View>
          )}

          {/* Diagnostics Link */}
          {showDiagnostics && onOpenDiagnostics && (
            <Pressable
              testID="button-diagnostics-toggle"
              accessibilityRole="button"
              accessibilityLabel="Open diagnostics"
              onPress={onOpenDiagnostics}
              style={styles.diagButton}
            >
              <Text style={styles.diagButtonText}>⚙</Text>
            </Pressable>
          )}

          {/* My rides pill remains visible on selected route per approved sketch */}
          <Pressable
            testID="home-open-myrides"
            accessibilityRole="button"
            accessibilityLabel="My rides"
            onPress={() => setIsLibraryOpen((v) => !v)}
            style={styles.myRidesPill}
          >
            <Text style={styles.myRidesIcon}>≡</Text>
            <Text style={styles.myRidesText}>My rides</Text>
            <View style={styles.countBadge}>
              <Text testID="text-my-rides-count" style={styles.countBadgeText}>
                {localRoutes.length}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>

      {/* Locate Feedback Toast */}
      {locateFeedback && (
        <Pressable
          testID="banner-locate-feedback"
          accessibilityRole="alert"
          accessibilityLabel="Dismiss location notice"
          onPress={() => setLocateFeedback(null)}
          style={[styles.locateToast, { top: insets.top + 64 }]}
        >
          <Text style={styles.locateToastText}>{locateFeedback}</Text>
        </Pressable>
      )}

      {/* Camera-only Locate Button on Map Home */}
      {!route && !isLibraryOpen && (
        <Pressable
          testID="button-locate-me"
          accessibilityRole="button"
          accessibilityLabel="Locate me"
          onPress={handleLocateMe}
          style={[
            styles.locateButton,
            { bottom: dockHeight + Math.max(insets.bottom, 12) + 20 },
          ]}
        >
          <Text style={styles.locateIcon}>⌖</Text>
        </Pressable>
      )}

      {/* Bottom Surfaces: Selected Ride Dock or Map Home Dock */}
      {route ? (
        <SelectedRideDock
          key={route.id}
          route={route}
          onOpenLibrary={() => setIsLibraryOpen(true)}
          onStartNavigation={onStartNavigation}
          onRenameRide={onRenameRide}
          onDeleteRide={onDeleteRide}
          bottomInset={insets.bottom}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0) setDockHeight(h);
          }}
        />
      ) : (
        <MapHomeDock
          onCreateRide={onCreateRide}
          onImportGpx={onImportGpx}
          bottomInset={insets.bottom}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0) setDockHeight(h);
          }}
        />
      )}

      {/* Slide-over Library Drawer */}
      <MyRidesDrawer
        visible={isLibraryOpen}
        localRoutes={localRoutes}
        publicRoutes={publicRoutes}
        input={input}
        onInputChange={onInputChange}
        onOpenInput={onOpenInput}
        onSelectLocalRoute={(id) => {
          setIsLibraryOpen(false);
          onSelectLocalRoute(id);
        }}
        onSelectPublicRoute={(id) => {
          setIsLibraryOpen(false);
          onSelectPublicRoute(id);
        }}
        onCreateRide={() => {
          setIsLibraryOpen(false);
          onCreateRide();
        }}
        onImportGpx={() => {
          setIsLibraryOpen(false);
          onImportGpx();
        }}
        onClose={() => setIsLibraryOpen(false)}
        onRefreshPublicRoutes={onRefreshPublicRoutes}
        onSeedSyntheticLibrary={onSeedSyntheticLibrary}
        onOpenDiagnostics={onOpenDiagnostics}
        showDiagnostics={showDiagnostics}
        localStorageError={localStorageError}
        isTestMode={isTestMode}
        bottomInset={insets.bottom}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) setDrawerHeight(h);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#e8ede7",
  },
  topBar: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 10,
  },
  topRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandPill: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fffffc",
    borderRadius: 22,
    paddingVertical: 8,
    paddingHorizontal: 16,
    shadowColor: "#12221b",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: "rgba(27,62,49,0.08)",
  },
  brandIcon: {
    fontSize: 16,
    color: "#1e8068",
    marginRight: 6,
    fontWeight: "700",
  },
  brandText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#172c28",
    letterSpacing: -0.2,
  },
  backCircleButton: {
    minWidth: 44,
    minHeight: 44,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fffffc",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#12221b",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: "rgba(27,62,49,0.08)",
  },
  backCircleIcon: {
    fontSize: 26,
    fontWeight: "700",
    color: "#172c28",
    lineHeight: 28,
  },
  testBadgeContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef3c7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#d97706",
  },
  testMapMarker: {
    fontSize: 9,
    fontWeight: "700",
    color: "#1e8068",
    marginLeft: 4,
  },
  testBadge: {
    color: "#92400e",
    fontWeight: "800",
    fontSize: 10,
    letterSpacing: 0.5,
  },
  myRidesPill: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fffffc",
    borderRadius: 22,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 10,
    shadowColor: "#12221b",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: "rgba(27,62,49,0.08)",
  },
  myRidesIcon: {
    fontSize: 15,
    color: "#254a3e",
    marginRight: 6,
    fontWeight: "800",
  },
  myRidesText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#172c28",
    marginRight: 6,
  },
  countBadge: {
    backgroundColor: "#e8f3ed",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#1e8068",
  },
  diagButton: {
    minWidth: 44,
    minHeight: 44,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fffffc",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#12221b",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: "rgba(27,62,49,0.08)",
  },
  diagButtonText: {
    fontSize: 16,
    color: "#254a3e",
  },
  locateButton: {
    position: "absolute",
    right: 16,
    minWidth: 44,
    minHeight: 44,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#fffffc",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#12221b",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1,
    borderColor: "rgba(27,62,49,0.08)",
    zIndex: 10,
  },
  locateIcon: {
    fontSize: 24,
    fontWeight: "700",
    color: "#172c28",
    lineHeight: 26,
  },
  locateToast: {
    position: "absolute",
    alignSelf: "center",
    maxWidth: "90%",
    backgroundColor: "rgba(23, 44, 40, 0.94)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 100,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  locateToastText: {
    color: "#fffffc",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 18,
  },
  markerBase: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#ffffff",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  markerStart: {
    backgroundColor: "#1e8068",
  },
  markerFinish: {
    backgroundColor: "#d84b35",
  },
  markerText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
});
