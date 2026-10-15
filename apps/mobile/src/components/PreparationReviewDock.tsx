import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { LocationBearingWarning } from "@ride-maker/routing";
import type { PreparationState } from "../controllers/prepare-ride-controller";

export type PreparationReviewDockProps = {
  state: PreparationState;
  onCancel: () => void;
  onRetry: () => void;
  onChooseSparseInference: () => void;
  onAccept: (partial: boolean) => void;
  onFocusWarning: (warning: LocationBearingWarning) => void;
};

export function PreparationReviewDock({ state, onCancel, onRetry, onChooseSparseInference, onAccept, onFocusWarning }: PreparationReviewDockProps) {
  if (state.status === "idle") return null;
  const busy = state.status === "preparing" || state.status === "saving";
  const reviewState = state.status === "review" ? state : null;
  const review = reviewState?.result ?? null;
  const partial = review?.metadata.status === "partial";
  const warnings = review?.metadata.warnings ?? [];
  const sourceMeters = review?.metadata.coverage.sourceDistanceMeters;
  const candidateMeters = review?.document.summary?.distanceMeters;
  const delta = sourceMeters !== undefined && candidateMeters !== undefined ? candidateMeters - sourceMeters : null;
  return (
    <View testID="view-preparation-dock" style={styles.dock}>
      <View style={styles.header}>
        <Text style={styles.title}>{state.status === "preparing" ? "Preparing directions" : state.status === "saving" ? "Saving directions" : state.status === "choice" ? "Route inference choice" : state.status === "error" ? "Preparation needs attention" : partial ? "Partial directions" : "Review directions"}</Text>
        {busy && <ActivityIndicator color="#d84b35" />}
      </View>
      {state.status === "preparing" && <Text style={styles.body}>Matching this GPX online. Your saved route stays available.</Text>}
      {state.status === "saving" && <Text style={styles.body}>Checking the saved original and publishing this reviewed version…</Text>}
      {state.status === "choice" && <>
        <Text style={styles.body}>{state.message} This sends the saved waypoints to the online matching service.</Text>
        <View style={styles.actions}>
          <Action label="Cancel" onPress={onCancel} />
          <Action label="Infer cycling paths" primary onPress={onChooseSparseInference} />
        </View>
      </>}
      {state.status === "error" && <>
        <Text style={styles.body}>{state.message}</Text>
        <View style={styles.actions}>
          <Action label="Close" onPress={onCancel} />
          {state.retryable && <Action label="Retry" primary onPress={onRetry} />}
        </View>
      </>}
      {review && <>
        <View style={styles.legend}><Text style={styles.originalLegend}>━━ Original GPX</Text><Text style={styles.candidateLegend}>━━ Candidate directions</Text></View>
        <Text style={styles.body}>
          {delta === null ? "Review the matched route and its coverage." : `Route distance ${delta >= 0 ? "increases" : "decreases"} by ${Math.abs(delta) >= 1000 ? `${(Math.abs(delta) / 1000).toFixed(1)} km` : `${Math.round(Math.abs(delta))} m`}. `}
          {Math.round(review.metadata.coverage.coverageRatio * 100)}% of the original route has directions.
          {partial ? " Some sections have no turn guidance." : " Directions cover the full route."}
        </Text>
        {reviewState?.result.metadata.warnings.some((warning) => warning.code === "sparse_route") && <Text style={styles.sparse}>Cycling paths were inferred through sparse planning points.</Text>}
        {warnings.length > 0 && <ScrollView style={styles.warningList} nestedScrollEnabled>
          {warnings.map((warning, index) => <Pressable key={`${warning.code}:${index}`} accessibilityRole="button" accessibilityLabel={`Focus warning: ${warning.message}`} onPress={() => onFocusWarning(warning)} style={styles.warning}>
            <Text style={styles.warningText}>{warning.message}  ›</Text>
          </Pressable>)}
        </ScrollView>}
        <View style={styles.actions}>
          <Action label="Cancel" onPress={onCancel} />
          <Action label={partial ? "Accept partial directions" : "Accept directions"} primary onPress={() => onAccept(partial)} />
        </View>
      </>}
    </View>
  );
}

function Action({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.button, primary && styles.primary]}><Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 16, right: 16, bottom: 24, maxHeight: "65%", backgroundColor: "#fffffc", borderRadius: 22, padding: 18, borderWidth: 1, borderColor: "#dbe4dc", shadowColor: "#12221b", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }, title: { color: "#172c28", fontSize: 18, fontWeight: "800" }, body: { color: "#465e52", fontSize: 13, lineHeight: 19 }, legend: { flexDirection: "row", gap: 14, marginVertical: 8 }, originalLegend: { color: "#1c7f9a", fontSize: 12, fontWeight: "700" }, candidateLegend: { color: "#dc4e36", fontSize: 12, fontWeight: "700" }, sparse: { color: "#8b5b00", fontSize: 12, marginTop: 6, fontWeight: "700" }, warningList: { maxHeight: 90, marginTop: 6 }, warning: { paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#eee9df" }, warningText: { color: "#7a4a00", fontSize: 12, lineHeight: 17 }, actions: { flexDirection: "row", gap: 10, marginTop: 12 }, button: { flex: 1, minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#f1f2e9" }, primary: { backgroundColor: "#d84b35" }, buttonText: { color: "#254a3e", fontSize: 14, fontWeight: "700", textAlign: "center" }, primaryText: { color: "white" },
});
