import React from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type MapHomeDockProps = {
  onCreateRide: () => void;
  onImportGpx: () => void;
  bottomInset?: number;
  onLayout?: (e: LayoutChangeEvent) => void;
};

export function MapHomeDock({
  onCreateRide,
  onImportGpx,
  bottomInset = 16,
  onLayout,
}: MapHomeDockProps) {
  return (
    <View
      onLayout={onLayout}
      style={[
        styles.dock,
        { bottom: Math.max(bottomInset, 12) + 12 },
      ]}
    >
      <Text style={styles.micro}>MAKE ROOM FOR A RIDE</Text>
      <Text style={styles.title}>Where to today?</Text>
      <Text style={styles.subtitle}>Create a route, or bring one with you.</Text>
      <View style={styles.actions}>
        <Pressable
          testID="button-create-ride"
          accessibilityRole="button"
          accessibilityLabel="Create ride"
          onPress={onCreateRide}
          style={[styles.button, styles.primaryButton]}
        >
          <Text style={styles.primaryButtonText}>+ Create ride</Text>
        </Pressable>
        <Pressable
          testID="button-import-gpx"
          accessibilityRole="button"
          accessibilityLabel="Import GPX"
          onPress={onImportGpx}
          style={[styles.button, styles.secondaryButton]}
        >
          <Text style={styles.secondaryButtonText}>Import GPX</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: "#fffffc",
    borderRadius: 24,
    padding: 18,
    shadowColor: "#12221b",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
    borderWidth: 1,
    borderColor: "rgba(27,62,49,0.08)",
  },
  micro: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.9,
    color: "#1e8068",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#172c28",
    marginBottom: 4,
    lineHeight: 28,
  },
  subtitle: {
    fontSize: 14,
    color: "#5a6860",
    marginBottom: 16,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButton: {
    flex: 1.2,
    backgroundColor: "#d84b35",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: "#f1f2e9",
    borderWidth: 1,
    borderColor: "#d4ddd2",
  },
  secondaryButtonText: {
    color: "#254a3e",
    fontSize: 15,
    fontWeight: "700",
  },
});
