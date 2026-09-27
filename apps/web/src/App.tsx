import {
  createId,
  createRouteDocument,
  type Coordinate,
  type RouteDocument,
} from "@ride-maker/domain";
import { serializeGpx } from "@ride-maker/gpx";
import { PhotonGeocodingProvider, type GeocodingResult } from "@ride-maker/geocoding";
import { ValhallaRoutingProvider } from "@ride-maker/routing";
import { Button } from "@ride-maker/ui";
// RSD/StyleX currently requires a direct source import for cross-workspace themes.
import { tokens } from "../../../packages/ui/src/tokens.css";
import { useEffect, useState, type ChangeEvent } from "react";
import { css, html } from "react-strict-dom";
import { RouteMap } from "./RouteMap";
import { PlaceSearchInput } from "./PlaceSearchInput";
import { AuthPanel } from "./AuthPanel";
import { pocketBase, routeRepository } from "./backend";

const routingProvider = new ValhallaRoutingProvider();
const geocodingProvider = new PhotonGeocodingProvider();

const styles = css.create({
  app: {
    backgroundColor: tokens.canvas,
    color: tokens.ink,
    display: "flex",
    flexDirection: "column",
    fontFamily: tokens.font,
    height: "100%",
  },
  header: {
    alignItems: "center",
    backgroundColor: tokens.surface,
    borderBottomColor: tokens.border,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 64,
    paddingInline: 20,
    zIndex: 2,
  },
  brand: {
    fontSize: 19,
    fontWeight: 750,
    letterSpacing: "-0.025em",
    margin: 0,
  },
  headerActions: {
    alignItems: "center",
    display: "flex",
    flexDirection: "row",
    gap: 8,
  },
  workspace: {
    display: "flex",
    flexDirection: "row",
    flexGrow: 1,
    minHeight: 0,
  },
  sidebar: {
    backgroundColor: tokens.surface,
    borderRightColor: tokens.border,
    borderRightStyle: "solid",
    borderRightWidth: 1,
    display: "flex",
    flexDirection: "column",
    gap: 20,
    overflowY: "auto",
    padding: 20,
    width: 320,
    zIndex: 1,
  },
  eyebrow: {
    color: tokens.muted,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    margin: 0,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 28,
    letterSpacing: "-0.04em",
    lineHeight: 1.05,
    margin: 0,
  },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  fieldLabel: { color: tokens.muted, fontSize: 12, fontWeight: 700 },
  routeNameInput: {
    backgroundColor: tokens.surface,
    borderColor: tokens.border,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    color: tokens.ink,
    fontFamily: tokens.font,
    fontSize: 16,
    fontWeight: 700,
    minHeight: 42,
    paddingInline: 11,
  },
  copy: {
    color: tokens.muted,
    fontSize: 14,
    lineHeight: 1.5,
    margin: 0,
  },
  error: {
    color: "#b42318",
    fontSize: 13,
    lineHeight: 1.4,
    margin: 0,
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  itinerary: { display: "flex", flexDirection: "column", gap: 8 },
  itineraryHeading: {
    color: tokens.muted, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em",
    margin: 0, textTransform: "uppercase",
  },
  pointList: {
    display: "flex", flexDirection: "column", gap: 6, listStyle: "none", margin: 0, padding: 0,
  },
  pointRow: {
    alignItems: "center", backgroundColor: tokens.canvas, borderRadius: 10,
    display: "flex", flexDirection: "row", gap: 10, minHeight: 54,
    paddingBlock: 8, paddingInline: 10,
  },
  pointNumber: {
    alignItems: "center", backgroundColor: tokens.ink, borderRadius: 999,
    color: tokens.surface, display: "flex", flexShrink: 0, fontSize: 12,
    fontWeight: 750, height: 26, justifyContent: "center", width: 26,
  },
  pointDetails: {
    display: "flex", flexDirection: "column", flexGrow: 1, gap: 2, minWidth: 0,
  },
  pointNameInput: {
    backgroundColor: "transparent", borderStyle: "none", color: tokens.ink,
    fontFamily: tokens.font, fontSize: 14, fontWeight: 700, minWidth: 0,
    padding: 0, width: "100%",
  },
  pointLabel: {
    fontSize: 14,
    fontWeight: 700,
    margin: 0,
  },
  pointCoordinate: {
    color: tokens.muted, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11, margin: 0,
  },
  removePoint: {
    alignItems: "center", backgroundColor: { default: "transparent", ":hover": "#ddd9cf" },
    borderStyle: "none", borderRadius: 999, color: tokens.muted, cursor: "pointer",
    display: "flex", flexShrink: 0, fontSize: 18, height: 30,
    justifyContent: "center", padding: 0, width: 30,
  },
  map: {
    flexGrow: 1,
    minWidth: 0,
    position: "relative",
  },
});

export function App() {
  const [document, setDocument] = useState<RouteDocument | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [account, setAccount] = useState(pocketBase.authStore.record);
  const [routingState, setRoutingState] = useState<
    { status: "idle" | "routing" } | { status: "error"; message: string }
  >({ status: "idle" });
  const [sharingState, setSharingState] = useState<
    | { status: "idle" | "saving" | "loading" }
    | { status: "saved"; url: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const routingKey = document === null ? "" : controlPointKey(document.controlPoints);

  useEffect(() => pocketBase.authStore.onChange(() => setAccount(pocketBase.authStore.record), true), []);

  useEffect(() => {
    const routeId = new URL(window.location.href).searchParams.get("route");
    if (routeId === null) return;
    setSharingState({ status: "loading" });
    void routeRepository.get(routeId)
      .then((savedRoute) => {
        setDocument(savedRoute.document);
        setIsPlanning(false);
        setSharingState({ status: "saved", url: window.location.href });
      })
      .catch((error: unknown) => {
        setSharingState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load the shared route.",
        });
      });
  }, []);

  useEffect(() => {
    if (!isPlanning || document?.source.kind !== "new" || document.controlPoints.length < 2 || document.routing !== undefined) {
      setRoutingState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const controlPoints = document.controlPoints;
    const timeout = window.setTimeout(() => {
      setRoutingState({ status: "routing" });
      void routingProvider.route({ controlPoints, profile: "road", signal: controller.signal })
        .then((route) => {
          if (controller.signal.aborted) return;
          setDocument((current) => {
            if (current === null || controlPointKey(current.controlPoints) !== routingKey) return current;
            return {
              ...current,
              segments: route.segments.map((points) => ({ id: createId("segment"), points })),
              maneuvers: route.maneuvers,
              summary: { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds },
              routing: { profile: "road", engine: route.engine },
            };
          });
          setRoutingState({ status: "idle" });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setRoutingState({ status: "error", message: error instanceof Error ? error.message : "Could not find a route." });
        });
    }, 250);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [routingKey, document?.source.kind, document?.routing, isPlanning]);

  const exportGpx = () => {
    if (document === null) return;

    const blob = new Blob([serializeGpx(document)], {
      type: "application/gpx+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${toFilename(document.name)}.gpx`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const startRoute = () => {
    clearSharedRouteUrl();
    setDocument(createRouteDocument());
    setIsPlanning(true);
    setSharingState({ status: "idle" });
  };

  const finishRoute = () => {
    if (document === null || !isPlanning || document.routing === undefined || sharingState.status === "saving") return;
    if (!pocketBase.authStore.isValid || pocketBase.authStore.record?.collectionName !== "users") {
      setAuthOpen(true);
      return;
    }
    setIsPlanning(false);
    setSharingState({ status: "saving" });
    void routeRepository.createUnlisted(document)
      .then((savedRoute) => {
        const url = new URL(window.location.href);
        url.searchParams.set("route", savedRoute.id);
        window.history.replaceState(null, "", url);
        setDocument(savedRoute.document);
        setIsPlanning(false);
        setSharingState({ status: "saved", url: url.toString() });
      })
      .catch((error: unknown) => {
        setIsPlanning(true);
        setSharingState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not save the route.",
        });
      });
  };

  const editRoute = () => {
    if (document === null) return;
    clearSharedRouteUrl();
    setDocument({ ...document, id: createId("route") });
    setSharingState({ status: "idle" });
    setIsPlanning(true);
  };

  const addControlPoint = (coordinate: Coordinate) => {
    if (!isPlanning) return;
    const pointId = createId("control");
    setDocument((current) =>
      current === null ? current : appendControlPoint(current, coordinate, pointId),
    );
    void geocodingProvider.reverse(coordinate).then((result) => {
      if (result === null) return;
      setDocument((current) =>
        current === null ? current : renameControlPointById(current, pointId, result.name),
      );
    }).catch(() => undefined);
  };

  const closeLoop = () => {
    if (!isPlanning) return;
    setDocument((current) => {
      const start = current?.controlPoints[0];
      if (current === null || start === undefined) return current;
      return appendControlPoint(current, start, createId("control"), start.name);
    });
  };

  const removeControlPoint = (pointId: string) => {
    setDocument((current) => current === null ? current : removeControlPointById(current, pointId));
  };

  const renameRoute = (name: string) => {
    setDocument((current) => current === null ? current : { ...current, name });
  };

  const renameControlPoint = (pointId: string, name: string) => {
    setDocument((current) => current === null ? current : renameControlPointById(current, pointId, name));
  };

  const selectPlace = (pointId: string, result: GeocodingResult) => {
    setDocument((current) =>
      current === null ? current : moveControlPoint(current, pointId, result),
    );
  };

  const controlPointCount = document?.controlPoints.length ?? 0;
  const isNewRoute = document?.source.kind === "new";

  return (
    <html.div style={styles.app}>
      <html.header style={styles.header}>
        <html.h1 style={styles.brand}>Ride Maker</html.h1>
        <html.div style={styles.headerActions}>
          {account?.collectionName === "users" && pocketBase.authStore.isValid ? (
            <>
              <html.span style={styles.copy}>{account.email || "Signed in"}</html.span>
              <Button onClick={() => pocketBase.authStore.clear()} variant="quiet">Sign out</Button>
            </>
          ) : (
            <Button onClick={() => setAuthOpen(true)} variant="quiet">Sign in</Button>
          )}
          {document === null || isPlanning || sharingState.status !== "saved" ? null : (
            <Button
              onClick={() => { void copyShareUrl(sharingState.url); }}
              variant="quiet"
            >
              Copy link
            </Button>
          )}
          {document !== null && !isPlanning ? (
            <Button onClick={exportGpx} variant="quiet">
              Export GPX
            </Button>
          ) : null}
        </html.div>
      </html.header>
      {authOpen ? <AuthPanel onClose={() => setAuthOpen(false)} /> : null}
      <html.main style={styles.workspace}>
        <html.aside style={styles.sidebar}>
          <html.p style={styles.eyebrow}>
            {isPlanning
              ? "Planning route"
              : document === null
                ? "New route"
                : isNewRoute
                  ? "Saved route"
                : "Imported route"}
          </html.p>
          {planningTitle(document, isPlanning) === null ? null : (
            <html.h2 style={styles.title}>
              {planningTitle(document, isPlanning)}
            </html.h2>
          )}
          {document === null || !isPlanning ? null : (
            <html.label style={styles.field}>
              <html.span style={styles.fieldLabel}>Route name</html.span>
              <html.input
                aria-label="Route name"
                onChange={(event: ChangeEvent<HTMLInputElement>) => renameRoute(event.currentTarget.value)}
                placeholder="Untitled route"
                style={styles.routeNameInput}
                type="text"
                value={document.name}
              />
            </html.label>
          )}
          {document === null || (isNewRoute && controlPointCount === 0) ? (
            <html.p style={styles.copy}>
              Create a route to get started.
            </html.p>
          ) : isPlanning ? (
            <html.p style={styles.copy}>
              Each click adds another control point. The routing engine will
              eventually choose the roads between them.
            </html.p>
          ) : (
            <html.p style={styles.copy}>
              {formatRouteSummary(document)}
            </html.p>
          )}
          {routingState.status === "routing" ? (
            <html.p style={styles.copy}>Finding a bicycle route…</html.p>
          ) : routingState.status === "error" ? (
            <html.p role="alert" style={styles.error}>
              {routingState.message} The route could not be updated.
            </html.p>
          ) : null}
          {sharingState.status === "loading" ? (
            <html.p style={styles.copy}>Loading shared route…</html.p>
          ) : sharingState.status === "error" ? (
            <html.p role="alert" style={styles.error}>{sharingState.message}</html.p>
          ) : sharingState.status === "saving" ? (
            <html.p style={styles.copy}>Saving route…</html.p>
          ) : sharingState.status === "saved" ? (
            <html.p style={styles.copy}>Saved. Anyone with the link can view this route.</html.p>
          ) : null}
          {isNewRoute && controlPointCount > 0 && document !== null ? (
            <html.section aria-label="Route points" style={styles.itinerary}>
              <html.h3 style={styles.itineraryHeading}>Route points</html.h3>
              <html.ol style={styles.pointList}>
                {document.controlPoints.map((point, index) => (
                  <html.li key={point.id} style={styles.pointRow}>
                    <html.span style={styles.pointNumber}>{index + 1}</html.span>
                    <html.div style={styles.pointDetails}>
                      {isPlanning ? (
                        <PlaceSearchInput
                          focus={point}
                          label={controlPointLabel(index, controlPointCount)}
                          onNameChange={(name) => renameControlPoint(point.id, name)}
                          onSelect={(result) => selectPlace(point.id, result)}
                          provider={geocodingProvider}
                          value={point.name ?? ""}
                        />
                      ) : (
                        <html.p style={styles.pointLabel}>
                          {point.name ?? controlPointLabel(index, controlPointCount)}
                        </html.p>
                      )}
                      <html.p style={styles.pointCoordinate}>{formatCoordinate(point)}</html.p>
                    </html.div>
                    {isPlanning ? (
                      <html.button
                        aria-label={`Remove ${controlPointLabel(index, controlPointCount).toLowerCase()}`}
                        onClick={() => removeControlPoint(point.id)}
                        style={styles.removePoint}
                        type="button"
                      >×</html.button>
                    ) : null}
                  </html.li>
                ))}
              </html.ol>
            </html.section>
          ) : null}
          <html.div style={styles.actions}>
            {document === null ? (
              <Button onClick={startRoute}>Create a route</Button>
            ) : null}
            {isPlanning ? (
              <>
                <Button
                  disabled={controlPointCount < 2 || document?.routing === undefined || sharingState.status === "saving"}
                  onClick={finishRoute}
                >
                  {sharingState.status === "saving" ? "Saving…" : "Finish route"}
                </Button>
              </>
            ) : isNewRoute ? (
              <Button disabled={sharingState.status === "saving"} onClick={editRoute} variant="quiet">
                Edit route
              </Button>
            ) : null}
          </html.div>
        </html.aside>
        <html.div style={styles.map}>
          <RouteMap
            document={document}
            isPlanning={isPlanning}
            onCloseLoop={closeLoop}
            onMapClick={addControlPoint}
          />
        </html.div>
      </html.main>
    </html.div>
  );
}

function planningTitle(
  document: RouteDocument | null,
  isPlanning: boolean,
): string | null {
  if (!isPlanning) return document?.name ?? "Where are we riding?";
  const count = document?.controlPoints.length ?? 0;
  if (count === 0) return "Choose a starting point";
  if (count === 1) return "Choose your destination";
  return null;
}

function appendControlPoint(
  document: RouteDocument,
  coordinate: Coordinate,
  id: string,
  name?: string,
): RouteDocument {
  const previous = document.controlPoints.map((point) => ({
    ...point,
    kind: point.kind === "finish" ? ("via" as const) : point.kind,
  }));
  const isFirst = previous.length === 0;
  const controlPoints = [
    ...previous,
    {
      id,
      kind: isFirst ? ("start" as const) : ("finish" as const),
      ...coordinate,
      ...(name === undefined ? {} : { name }),
    },
  ];

  return routeFromControlPoints(document, controlPoints);
}

function removeControlPointById(document: RouteDocument, pointId: string): RouteDocument {
  return routeFromControlPoints(
    document,
    normalizeControlPoints(document.controlPoints.filter((point) => point.id !== pointId)),
  );
}

function renameControlPointById(document: RouteDocument, pointId: string, name: string): RouteDocument {
  return {
    ...document,
    controlPoints: document.controlPoints.map((point) => {
      if (point.id !== pointId) return point;
      const { name: _name, ...pointWithoutName } = point;
      return name.trim().length === 0 ? pointWithoutName : { ...pointWithoutName, name };
    }),
  };
}

function moveControlPoint(
  document: RouteDocument,
  pointId: string,
  result: GeocodingResult,
): RouteDocument {
  return routeFromControlPoints(
    document,
    document.controlPoints.map((point) =>
      point.id === pointId
        ? { ...point, name: result.name, latitude: result.latitude, longitude: result.longitude }
        : point,
    ),
  );
}

function normalizeControlPoints(controlPoints: RouteDocument["controlPoints"]): RouteDocument["controlPoints"] {
  return controlPoints.map((point, index, points) => ({
    ...point,
    kind:
      index === 0
        ? ("start" as const)
        : index === points.length - 1
          ? ("finish" as const)
          : ("via" as const),
  }));
}

function routeFromControlPoints(
  document: RouteDocument,
  controlPoints: RouteDocument["controlPoints"],
): RouteDocument {
  if (controlPoints.length >= 2) {
    const { routing: _routing, summary: _summary, ...documentWithoutRoute } = document;
    return {
      ...documentWithoutRoute,
      controlPoints,
      maneuvers: [],
    };
  }

  const { routing: _routing, summary: _summary, ...documentWithoutRoute } = document;
  return {
    ...documentWithoutRoute,
    controlPoints,
    maneuvers: [],
    segments: [],
  };
}

function formatRouteSummary(document: RouteDocument): string {
  if (document.summary !== undefined) {
    return `${formatDistance(document.summary.distanceMeters)} · ${formatDuration(document.summary.durationSeconds)} · ${document.maneuvers.length} directions`;
  }
  const pointCount = document.segments.reduce(
    (total, segment) => total + segment.points.length,
    0,
  );
  const segmentLabel = document.segments.length === 1 ? "segment" : "segments";
  const pointLabel = pointCount === 1 ? "point" : "points";
  return `${document.segments.length} ${segmentLabel} · ${pointCount} ${pointLabel}`;
}

function controlPointLabel(index: number, pointCount: number): string {
  if (index === 0) return "Start";
  if (index === pointCount - 1) return "Destination";
  return `Stop ${index}`;
}

function formatCoordinate(coordinate: Coordinate): string {
  return `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}`;
}

function formatDistance(meters: number): string {
  const miles = meters / 1_609.344;
  return `${miles < 10 ? miles.toFixed(1) : miles.toFixed(0)} mi`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours === 0 ? `${minutes} min` : `${hours} hr ${remainingMinutes} min`;
}

function controlPointKey(points: RouteDocument["controlPoints"]): string {
  return points.map((point) => `${point.id}:${point.latitude}:${point.longitude}`).join("|");
}

function clearSharedRouteUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("route");
  window.history.replaceState(null, "", url);
}

async function copyShareUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // The URL remains in the address bar if clipboard permission is unavailable.
  }
}

function toFilename(name: string): string {
  const filename = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return filename.length === 0 ? "ride" : filename;
}
