import { useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Camera, GeoJSONSource, Layer, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import * as Location from "expo-location";
import { formatDistance, type NavigationFix, type NavigationTrack } from "../navigation";
import { routeGeometry } from "../route-view";
import type { DisplayRoute } from "../types";

export interface ActiveNavigationScreenProps {
  route: DisplayRoute;
  track: NavigationTrack | null;
  fix: NavigationFix | null;
  offRoute: boolean;
  poorGps: boolean;
  voiceEnabled: boolean;
  position: Location.LocationObjectCoords | null;
  onToggleVoice: () => void;
  onEndNavigation: () => void;
  isTestMode?: boolean;
}

export function ActiveNavigationScreen({
  route,
  track,
  fix,
  offRoute,
  poorGps,
  voiceEnabled,
  position,
  onToggleVoice,
  onEndNavigation,
  isTestMode = false,
}: ActiveNavigationScreenProps) {
  const [showEndModal, setShowEndModal] = useState(false);
  const cameraRef = useRef<CameraRef>(null);

  const geometry = useMemo(() => routeGeometry(route.document), [route.document]);

  const instruction = poorGps
    ? "Move to an open area."
    : offRoute
    ? "Return to the route line. Automatic rerouting isn't available yet."
    : fix?.arrived
    ? "You reached the end of the route."
    : fix?.next?.maneuver.instruction ??
      (track?.maneuvers.length ? "Continue to finish" : "No turn directions saved with this route.");

  const distanceText = poorGps
    ? "Waiting for accurate GPS"
    : offRoute
    ? "Off route"
    : fix?.arrived
    ? "Arrived"
    : !fix
    ? "Locating…"
    : formatDistance(fix.distanceToNextMeters ?? fix.remainingMeters);

  // Active navigation mount/unmount tracking
  useEffect(() => {
    if (isTestMode) {
      console.log("[E2E_NAV_ACTIVE] mounted=true");
      return () => {
        console.log("[E2E_NAV_ACTIVE] mounted=false");
      };
    }
  }, [isTestMode]);

  // Camera follow rider position
  useEffect(() => {
    if (position && cameraRef.current) {
      cameraRef.current.easeTo({
        center: [position.longitude, position.latitude],
        zoom: 16,
        duration: 350,
      });
    }
  }, [position?.latitude, position?.longitude]);

  // E2E Nav Stage logging in test mode
  useEffect(() => {
    if (isTestMode) {
      console.log(
        `[E2E_NAV_STAGE] instruction="${instruction}" distance="${distanceText}" arrived=${Boolean(
          fix?.arrived,
        )} offRoute=${Boolean(offRoute)}`,
      );
    }
  }, [isTestMode, instruction, distanceText, fix?.arrived, offRoute]);

  // Hardware Back press handling
  useEffect(() => {
    const onHardwareBack = () => {
      if (showEndModal) {
        setShowEndModal(false);
        if (isTestMode) console.log("[E2E_NAV_CANCEL_END] cancelled=true");
      } else {
        setShowEndModal(true);
        if (isTestMode) console.log("[E2E_NAV_REQUEST_END] requested=true");
      }
      return true;
    };

    const sub = BackHandler.addEventListener("hardwareBackPress", onHardwareBack);
    return () => sub.remove();
  }, [showEndModal, isTestMode]);

  const handleRequestEnd = () => {
    setShowEndModal(true);
    if (isTestMode) console.log("[E2E_NAV_REQUEST_END] requested=true");
  };

  const handleCancelEnd = () => {
    setShowEndModal(false);
    if (isTestMode) console.log("[E2E_NAV_CANCEL_END] cancelled=true");
  };

  const handleConfirmEnd = () => {
    setShowEndModal(false);
    if (isTestMode) console.log("[E2E_NAV_CONFIRM_END] confirmed=true");
    onEndNavigation();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          testID="button-back"
          accessibilityRole="button"
          accessibilityLabel="End navigation"
          onPress={handleRequestEnd}
          style={styles.touchTarget}
        >
          <Text style={styles.backLink}>‹ Ride</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {route.document.name}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      <View testID="view-guidance" style={styles.guidance}>
        <Text testID="text-guidance-distance" style={styles.guidanceDistance}>{distanceText}</Text>
        <Text testID="text-guidance-instruction" style={styles.guidanceInstruction}>{instruction}</Text>
        {fix && !offRoute && !poorGps && (
          <Text style={styles.guidanceRemaining}>
            {formatDistance(fix.remainingMeters)} remaining
          </Text>
        )}
      </View>

      <View testID="view-map" style={styles.mapContainer}>
        <Map mapStyle="https://tiles.openfreemap.org/styles/liberty" style={styles.map}>
          <Camera
            key={route.id}
            ref={cameraRef}
            initialViewState={
              position
                ? { center: [position.longitude, position.latitude], zoom: 16 }
                : geometry?.bounds
                ? { bounds: geometry.bounds, padding: { top: 40, right: 40, bottom: 40, left: 40 } }
                : { center: [-73.9866, 40.7306], zoom: 14 }
            }
          />
          {geometry && (
            <GeoJSONSource id="route" data={geometry.shape}>
              <Layer id="route-casing" type="line" paint={{ "line-color": "#ffffff", "line-width": 8 }} />
              <Layer id="route-line" type="line" paint={{ "line-color": "#ec4b35", "line-width": 5 }} />
            </GeoJSONSource>
          )}
          {position && (
            <GeoJSONSource
              id="rider"
              data={{ type: "Point", coordinates: [position.longitude, position.latitude] }}
            >
              <Layer id="rider-halo" type="circle" paint={{ "circle-color": "#ffffff", "circle-radius": 11 }} />
              <Layer id="rider-dot" type="circle" paint={{ "circle-color": "#1479c9", "circle-radius": 7 }} />
            </GeoJSONSource>
          )}
        </Map>
      </View>

      <View style={styles.navigationBar}>
        <Pressable
          testID="button-voice-toggle"
          accessibilityRole="button"
          accessibilityLabel={voiceEnabled ? "Mute voice guidance" : "Unmute voice guidance"}
          onPress={onToggleVoice}
          style={styles.voiceButton}
        >
          <Text style={styles.actionText}>{voiceEnabled ? "Mute" : "Unmute"}</Text>
        </Pressable>

        <Pressable
          testID="button-navigation-toggle"
          accessibilityRole="button"
          accessibilityLabel="End ride"
          onPress={handleRequestEnd}
          style={[styles.button, styles.endButton]}
        >
          <Text style={styles.buttonText}>Stop navigation</Text>
        </Pressable>
      </View>

      {/* End Navigation Confirmation Modal */}
      <Modal
        visible={showEndModal}
        transparent
        animationType="fade"
        onRequestClose={handleCancelEnd}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>End this ride?</Text>
            <Text testID="text-end-ride-confirm-message" style={styles.modalMessage}>
              Are you sure you want to end navigation?
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                testID="button-end-ride-cancel"
                accessibilityRole="button"
                accessibilityLabel="Continue ride"
                onPress={handleCancelEnd}
                style={[styles.modalBtn, styles.cancelBtn]}
              >
                <Text style={styles.cancelBtnText}>Continue ride</Text>
              </Pressable>
              <Pressable
                testID="button-end-ride-confirm"
                accessibilityRole="button"
                accessibilityLabel="Confirm end ride"
                onPress={handleConfirmEnd}
                style={[styles.modalBtn, styles.confirmEndBtn]}
              >
                <Text style={styles.confirmEndBtnText}>End ride</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f6f1" },
  header: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd9d0",
  },
  touchTarget: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingVertical: 8, paddingRight: 8 },
  backLink: { color: "#ec4b35", fontSize: 16, fontWeight: "600" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: "#1b2521" },
  guidance: {
    backgroundColor: "#1b2521",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  guidanceDistance: {
    color: "#a8d5ba",
    fontSize: 24,
    fontWeight: "800",
  },
  guidanceInstruction: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 2,
  },
  guidanceRemaining: {
    color: "#a0a8a4",
    fontSize: 12,
    marginTop: 4,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  navigationBar: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#ddd9d0",
  },
  voiceButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd9d0",
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1b2521",
  },
  button: {
    flex: 2,
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  endButton: {
    backgroundColor: "#ec4b35",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1b2521",
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    color: "#5f6368",
    marginBottom: 20,
    lineHeight: 20,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: "#ddd9d0",
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1b2521",
  },
  confirmEndBtn: {
    backgroundColor: "#ec4b35",
  },
  confirmEndBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
});
