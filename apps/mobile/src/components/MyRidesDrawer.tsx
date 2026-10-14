import React, { useState } from "react";
import {
  Dimensions,
  FlatList,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { SavedRoute } from "@ride-maker/persistence";
import type { LocalRouteRecord } from "../storage/types";

export type MyRidesDrawerProps = {
  visible: boolean;
  localRoutes: LocalRouteRecord[];
  publicRoutes: SavedRoute[];
  input: string;
  onInputChange: (val: string) => void;
  onOpenInput: () => void;
  onSelectLocalRoute: (id: string) => void;
  onSelectPublicRoute: (id: string) => void;
  onCreateRide: () => void;
  onImportGpx: () => void;
  onClose: () => void;
  onRefreshPublicRoutes: () => void;
  onSeedSyntheticLibrary?: (() => void) | undefined;
  onOpenDiagnostics?: (() => void) | undefined;
  showDiagnostics?: boolean | undefined;
  localStorageError?: string | null | undefined;
  isTestMode?: boolean | undefined;
  bottomInset?: number | undefined;
  onLayout?: (e: LayoutChangeEvent) => void;
};

export function MyRidesDrawer({
  visible,
  localRoutes,
  publicRoutes,
  input,
  onInputChange,
  onOpenInput,
  onSelectLocalRoute,
  onSelectPublicRoute,
  onCreateRide,
  onImportGpx,
  onClose,
  onRefreshPublicRoutes,
  onSeedSyntheticLibrary,
  onOpenDiagnostics,
  showDiagnostics,
  localStorageError,
  isTestMode,
  bottomInset = 16,
  onLayout,
}: MyRidesDrawerProps) {
  const [showSecondaryLinks, setShowSecondaryLinks] = useState(false);
  const screenHeight = Dimensions.get("window").height;

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel="Dismiss drawer"
        onPress={onClose}
      />
      <View
        onLayout={onLayout}
        style={[
          styles.sheet,
          {
            maxHeight: Math.min(screenHeight * 0.82, screenHeight - 60),
            marginBottom: Math.max(bottomInset, 12) + 12,
          },
        ]}
      >
        <View style={styles.handle} />

        {/* Sheet Header */}
        <View style={styles.header}>
          <View style={styles.headerTextGroup}>
            <Text testID="text-library-title" style={styles.title}>
              My rides
            </Text>
            <Text style={styles.subtitle}>
              {localRoutes.length === 0
                ? "Your routes, ready when you are"
                : `${localRoutes.length} saved on this phone`}
            </Text>
          </View>
          <Pressable
            testID="button-close-my-rides"
            accessibilityRole="button"
            accessibilityLabel="Close My rides"
            onPress={onClose}
            style={styles.closeButton}
          >
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        {localStorageError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{localStorageError}</Text>
          </View>
        ) : null}

        {/* Scrollable Rides List */}
        <FlatList
          data={localRoutes}
          keyExtractor={(item) => item.id}
          scrollEnabled={true}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>Your first ride starts here.</Text>
              <Text style={styles.emptySubtitle}>
                Create a route or import a GPX. Your saved rides will live here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`button-open-local-route-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name}`}
              onPress={() => onSelectLocalRoute(item.id)}
              style={styles.routeRow}
            >
              <View
                style={[
                  styles.thumb,
                  item.hasInstructions ? styles.thumbReady : styles.thumbPreview,
                ]}
              >
                <Text
                  style={[
                    styles.thumbIcon,
                    item.hasInstructions ? styles.thumbIconReady : styles.thumbIconPreview,
                  ]}
                >
                  {item.hasInstructions ? "🚲" : "☡"}
                </Text>
              </View>
              <View style={styles.routeInfo}>
                <Text
                  testID={`text-route-name-${item.id}`}
                  style={styles.routeName}
                  numberOfLines={2}
                >
                  {item.name}
                </Text>
                <Text style={styles.routeMeta}>
                  {typeof item.distanceMeters === "number" && (
                    <Text testID={`text-route-distance-${item.id}`} style={styles.metaDistance}>
                      {(item.distanceMeters / 1000).toFixed(1)} km ·{" "}
                    </Text>
                  )}
                  <Text
                    style={
                      item.hasInstructions
                        ? styles.statusReadyText
                        : styles.statusPreviewText
                    }
                  >
                    {item.hasInstructions ? "Directions available" : "GPX preview"}
                  </Text>
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
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
                  {showSecondaryLinks
                    ? "▾ Hide shared links & public"
                    : "▸ Open shared link or public routes"}
                </Text>
              </Pressable>

              {showSecondaryLinks && (
                <View style={styles.secondaryCard}>
                  {/* Test Seeding Seam */}
                  {isTestMode && onSeedSyntheticLibrary && (
                    <Pressable
                      testID="button-test-seed-library"
                      accessibilityRole="button"
                      accessibilityLabel="Seed synthetic library"
                      onPress={onSeedSyntheticLibrary}
                      style={styles.testSeedButton}
                    >
                      <Text style={styles.testSeedButtonText}>
                        ⚡ Seed Synthetic Library (14+ Rides)
                      </Text>
                    </Pressable>
                  )}

                  {/* Dev / Test Diagnostics Toggle */}
                  {showDiagnostics && onOpenDiagnostics && (
                    <Pressable
                      testID="button-diagnostics-toggle"
                      accessibilityRole="button"
                      accessibilityLabel="Open diagnostics"
                      onPress={onOpenDiagnostics}
                      style={styles.diagButton}
                    >
                      <Text style={styles.diagButtonText}>Diagnostics ⚙</Text>
                    </Pressable>
                  )}

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
                    style={styles.viewRouteBtn}
                  >
                    <Text style={styles.viewRouteBtnText}>View route</Text>
                  </Pressable>

                  {/* Public routes */}
                  <View style={styles.publicSection}>
                    <View style={styles.listHeader}>
                      <Text style={styles.subSectionTitle}>Public routes</Text>
                      <Pressable
                        onPress={onRefreshPublicRoutes}
                        style={styles.refreshTarget}
                        accessibilityRole="button"
                        accessibilityLabel="Refresh public routes"
                      >
                        <Text style={styles.actionText}>Refresh</Text>
                      </Pressable>
                    </View>
                    {publicRoutes.length === 0 ? (
                      <Text style={styles.mutedText}>No public routes available.</Text>
                    ) : (
                      publicRoutes.map((pub) => (
                        <Pressable
                          key={pub.id}
                          onPress={() => onSelectPublicRoute(pub.id)}
                          style={styles.publicRow}
                          accessibilityRole="button"
                          accessibilityLabel={`View ${pub.document.name}`}
                        >
                          <Text style={styles.publicRouteName} numberOfLines={1}>
                            {pub.document.name}
                          </Text>
                          <Text style={styles.actionText}>View →</Text>
                        </Pressable>
                      ))
                    )}
                  </View>
                </View>
              )}
            </View>
          }
        />

        {/* Fixed Footer with Create & Import */}
        <View style={styles.footer}>
          <Pressable
            testID="button-create-ride"
            accessibilityRole="button"
            accessibilityLabel="Create ride"
            onPress={onCreateRide}
            style={[styles.footerButton, styles.createButton]}
          >
            <Text style={styles.createButtonText}>+ Create ride</Text>
          </Pressable>
          <Pressable
            testID="button-import-gpx"
            accessibilityRole="button"
            accessibilityLabel="Import GPX file"
            onPress={onImportGpx}
            style={[styles.footerButton, styles.importButton]}
          >
            <Text style={styles.importButtonText}>Import GPX</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(18, 34, 27, 0.3)",
  },
  sheet: {
    marginHorizontal: 16,
    backgroundColor: "#fffffc",
    borderRadius: 24,
    paddingTop: 12,
    shadowColor: "#12221b",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 12,
    borderWidth: 1,
    borderColor: "rgba(27, 62, 49, 0.1)",
    overflow: "hidden",
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#c5d1c9",
    alignSelf: "center",
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#ecefe9",
  },
  headerTextGroup: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#172c28",
  },
  subtitle: {
    fontSize: 13,
    color: "#5a6860",
    marginTop: 2,
  },
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f1f4ed",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  closeIcon: {
    fontSize: 18,
    fontWeight: "700",
    color: "#172c28",
  },
  errorBanner: {
    minHeight: 44,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    backgroundColor: "#fde8e8",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f8b4b4",
  },
  errorText: {
    color: "#991b1b",
    fontSize: 13,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
  },
  emptyContainer: {
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#172c28",
    marginBottom: 6,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#5a6860",
    textAlign: "center",
    lineHeight: 20,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fffffc",
    borderWidth: 1,
    borderColor: "#e7ebe4",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOpacity: 0.02,
    shadowRadius: 3,
    elevation: 1,
  },
  thumb: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  thumbReady: {
    backgroundColor: "#e8f3ed",
  },
  thumbPreview: {
    backgroundColor: "#f0f2ec",
  },
  thumbIcon: {
    fontSize: 18,
  },
  thumbIconReady: {
    color: "#1e8068",
  },
  thumbIconPreview: {
    color: "#5a6860",
  },
  routeInfo: {
    flex: 1,
  },
  routeName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#172c28",
    lineHeight: 20,
  },
  routeMeta: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  metaDistance: {
    fontWeight: "600",
    color: "#29493e",
  },
  statusReadyText: {
    color: "#1e8068",
    fontWeight: "600",
  },
  statusPreviewText: {
    color: "#6b7280",
  },
  chevron: {
    fontSize: 22,
    color: "#9ca3af",
    marginLeft: 8,
    fontWeight: "400",
  },
  secondarySection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e7ebe4",
  },
  secondaryToggle: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
  },
  secondaryToggleText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#5a6860",
  },
  secondaryCard: {
    backgroundColor: "#f8faf6",
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e3e7df",
  },
  subSectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#29493e",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: "#111827",
    marginBottom: 8,
  },
  viewRouteBtn: {
    minHeight: 44,
    backgroundColor: "#29493e",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  viewRouteBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  publicSection: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  refreshTarget: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  actionText: {
    color: "#d84b35",
    fontWeight: "600",
    fontSize: 13,
  },
  mutedText: {
    color: "#6b7280",
    fontSize: 13,
    fontStyle: "italic",
    paddingVertical: 4,
  },
  publicRow: {
    minHeight: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#ede9e0",
  },
  publicRouteName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#172c28",
    paddingRight: 8,
  },
  testSeedButton: {
    minHeight: 44,
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "#d97706",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  testSeedButtonText: {
    color: "#92400e",
    fontWeight: "700",
    fontSize: 13,
  },
  diagButton: {
    minHeight: 44,
    backgroundColor: "#e8eaed",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  diagButtonText: {
    color: "#3c4043",
    fontWeight: "600",
    fontSize: 13,
  },
  footer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#ecefe9",
    backgroundColor: "#fffffc",
  },
  footerButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  createButton: {
    flex: 1.2,
    backgroundColor: "#d84b35",
  },
  createButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
  importButton: {
    flex: 1,
    backgroundColor: "#f1f2e9",
    borderWidth: 1,
    borderColor: "#d4ddd2",
  },
  importButtonText: {
    color: "#254a3e",
    fontWeight: "700",
    fontSize: 15,
  },
});
