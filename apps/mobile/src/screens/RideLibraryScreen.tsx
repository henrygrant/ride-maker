import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { SavedRoute } from "@ride-maker/persistence";
import type { LocalRouteRecord } from "../storage/types";

export type RideLibraryScreenProps = {
  localRoutes: LocalRouteRecord[];
  publicRoutes: SavedRoute[];
  input: string;
  onInputChange: (val: string) => void;
  onOpenInput: () => void;
  onOpenLocalRoute: (id: string) => void;
  onOpenPublicRoute: (id: string) => void;
  onCreateRide: () => void;
  onImportGpx: () => void;
  onRefreshLocalRoutes: () => void;
  onRefreshPublicRoutes: () => void;
  onSeedSyntheticLibrary?: (() => void) | undefined;
  localStorageError?: string | null;
  isTestMode?: boolean;
};

export function RideLibraryScreen({
  localRoutes,
  publicRoutes,
  input,
  onInputChange,
  onOpenInput,
  onOpenLocalRoute,
  onOpenPublicRoute,
  onCreateRide,
  onImportGpx,
  onRefreshLocalRoutes,
  onRefreshPublicRoutes,
  onSeedSyntheticLibrary,
  localStorageError,
  isTestMode,
}: RideLibraryScreenProps) {
  const [showSecondaryLinks, setShowSecondaryLinks] = useState(false);

  return (
    <View style={styles.container}>
      {/* Top Primary Actions */}
      <View style={styles.actionRow}>
        <Pressable
          testID="button-create-ride"
          accessibilityRole="button"
          accessibilityLabel="Create ride"
          onPress={onCreateRide}
          style={[styles.button, styles.createButton]}
        >
          <Text style={styles.createButtonText}>+ Create ride</Text>
        </Pressable>
        <Pressable
          testID="button-import-gpx"
          accessibilityRole="button"
          accessibilityLabel="Import GPX file"
          onPress={onImportGpx}
          style={[styles.button, styles.importButton]}
        >
          <Text style={styles.importButtonText}>Import GPX</Text>
        </Pressable>
      </View>

      {/* Test-Only Seam for 12+ Synthetic Library Verification */}
      {isTestMode && onSeedSyntheticLibrary && (
        <View style={styles.testSeedRow}>
          <Pressable
            testID="button-test-seed-library"
            accessibilityRole="button"
            accessibilityLabel="Seed synthetic library"
            onPress={onSeedSyntheticLibrary}
            style={styles.testSeedButton}
          >
            <Text style={styles.testSeedButtonText}>⚡ Seed Synthetic Library (14+ Rides)</Text>
          </Pressable>
        </View>
      )}

      {localStorageError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{localStorageError}</Text>
        </View>
      ) : null}

      {/* Main Saved Rides List */}
      <FlatList
        data={localRoutes}
        keyExtractor={(item) => item.id}
        scrollEnabled={true}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No saved rides yet</Text>
            <Text style={styles.emptySubtitle}>
              Create a ride or import a GPX file using the buttons above.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`button-open-local-route-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}`}
            onPress={() => onOpenLocalRoute(item.id)}
            style={styles.routeRow}
          >
            <View style={styles.routeInfo}>
              <Text
                testID={`text-route-name-${item.id}`}
                style={styles.routeName}
                numberOfLines={2}
              >
                {item.name}
              </Text>
              <View style={styles.routeMetaRow}>
                {typeof item.distanceMeters === "number" && (
                  <Text testID={`text-route-distance-${item.id}`} style={styles.metaDistance}>
                    {(item.distanceMeters / 1000).toFixed(1)} km
                  </Text>
                )}
                <Text style={styles.metaStatus}>
                  {item.hasInstructions
                    ? " · Directions available"
                    : " · GPX preview"}
                </Text>
              </View>
            </View>
            <View style={styles.chevronBox}>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          <View style={styles.secondarySection}>
            <Pressable
              testID="button-toggle-secondary-links"
              accessibilityRole="button"
              accessibilityLabel="Toggle shared route input"
              onPress={() => setShowSecondaryLinks((v) => !v)}
              style={styles.secondaryToggle}
            >
              <Text style={styles.secondaryToggleText}>
                {showSecondaryLinks ? "▾ Hide shared links & public" : "▸ Open shared link or public routes"}
              </Text>
            </Pressable>

            {showSecondaryLinks && (
              <View style={styles.inputArea}>
                <Text style={styles.subSectionTitle}>Open by link or ID</Text>
                <TextInput
                  testID="input-route-id"
                  accessibilityLabel="Route link or ID"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={onInputChange}
                  onSubmitEditing={onOpenInput}
                  placeholder="Paste route link or ID"
                  returnKeyType="go"
                  style={styles.input}
                  value={input}
                />
                <Pressable
                  testID="button-view-route"
                  accessibilityRole="button"
                  accessibilityLabel="View route"
                  onPress={onOpenInput}
                  style={[styles.button, styles.viewRouteBtn]}
                >
                  <Text style={styles.buttonText}>View route</Text>
                </Pressable>
              </View>
            )}

            {showSecondaryLinks && (
              <View style={styles.publicSection}>
                <View style={styles.listHeader}>
                  <Text style={styles.subSectionTitle}>Public routes</Text>
                  <Pressable onPress={onRefreshPublicRoutes} style={styles.refreshTarget}>
                    <Text style={styles.action}>Refresh</Text>
                  </Pressable>
                </View>
                {publicRoutes.length === 0 ? (
                  <Text style={styles.muted}>No public routes available.</Text>
                ) : (
                  publicRoutes.map((pub) => (
                    <Pressable
                      key={pub.id}
                      onPress={() => onOpenPublicRoute(pub.id)}
                      style={styles.publicRow}
                    >
                      <Text style={styles.routeName}>{pub.document.name}</Text>
                      <Text style={styles.action}>View →</Text>
                    </Pressable>
                  ))
                )}
              </View>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f6f1" },
  actionRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    gap: 10,
  },
  button: {},
  createButton: {
    minHeight: 44,
    flex: 1,
    backgroundColor: "#ec4b35",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  createButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  importButton: {
    minHeight: 44,
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ec4b35",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  importButtonText: { color: "#ec4b35", fontWeight: "700", fontSize: 15 },
  testSeedRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  testSeedButton: {
    minHeight: 44,
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "#d97706",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  testSeedButtonText: {
    color: "#92400e",
    fontWeight: "700",
    fontSize: 13,
  },
  errorBanner: {
    minHeight: 44,
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 10,
    backgroundColor: "#fde8e8",
    borderRadius: 6,
  },
  errorText: { color: "#991b1b", fontSize: 13 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#1b2521", marginBottom: 6 },
  emptySubtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    paddingHorizontal: 20,
    lineHeight: 20,
  },
  routeRow: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  routeInfo: { flex: 1 },
  routeName: { fontSize: 15, fontWeight: "600", color: "#1f2937", lineHeight: 20 },
  routeMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  metaDistance: { fontSize: 13, fontWeight: "600", color: "#4b5563" },
  metaStatus: { fontSize: 13, color: "#6b7280" },
  chevronBox: { marginLeft: 8, paddingHorizontal: 4 },
  chevron: { fontSize: 20, color: "#9ca3af" },
  secondarySection: { marginTop: 16, borderTopWidth: 1, borderTopColor: "#e5e7eb", paddingTop: 16 },
  secondaryToggle: { minHeight: 44, justifyContent: "center", paddingVertical: 8, alignItems: "center" },
  secondaryToggleText: { fontSize: 14, fontWeight: "600", color: "#6b7280" },
  inputArea: { marginTop: 12, backgroundColor: "#fff", padding: 12, borderRadius: 8 },
  subSectionTitle: { fontSize: 14, fontWeight: "700", color: "#374151", marginBottom: 8 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#111827",
    marginBottom: 8,
  },
  viewRouteBtn: {
    minHeight: 44,
    backgroundColor: "#1479c9",
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  publicSection: { marginTop: 16, backgroundColor: "#fff", padding: 12, borderRadius: 8 },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  refreshTarget: { minHeight: 44, minWidth: 44, justifyContent: "center" },
  action: { fontSize: 13, fontWeight: "600", color: "#1479c9" },
  muted: { fontSize: 13, color: "#9ca3af" },
  publicRow: {
    minHeight: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
});
