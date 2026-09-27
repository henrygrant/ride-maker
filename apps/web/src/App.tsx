import {
  createId,
  createRouteDocument,
  type Coordinate,
  type RouteDocument,
} from "@ride-maker/domain";
import { parseGpx, serializeGpx } from "@ride-maker/gpx";
import { ValhallaRoutingProvider } from "@ride-maker/routing";
import { Button } from "@ride-maker/ui";
// RSD/StyleX currently requires a direct source import for cross-workspace themes.
import { tokens } from "../../../packages/ui/src/tokens.css";
import { useEffect, useState, type ChangeEvent } from "react";
import { css, html } from "react-strict-dom";
import { RouteMap } from "./RouteMap";

const routingProvider = new ValhallaRoutingProvider();

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
  const [importError, setImportError] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [routingState, setRoutingState] = useState<
    { status: "idle" | "routing" } | { status: "error"; message: string }
  >({ status: "idle" });
  const routingKey = document?.controlPoints
    .map((point) => `${point.id}:${point.latitude}:${point.longitude}`).join("|") ?? "";

  useEffect(() => {
    if (document?.source.kind !== "new" || document.controlPoints.length < 2) {
      setRoutingState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const controlPoints = document.controlPoints;
    const pointIds = controlPoints.map((point) => point.id);
    const timeout = window.setTimeout(() => {
      setRoutingState({ status: "routing" });
      void routingProvider.route({ controlPoints, profile: "road", signal: controller.signal })
        .then((route) => {
          setDocument((current) => {
            if (current === null || !sameIds(current.controlPoints, pointIds)) return current;
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
  }, [routingKey, document?.source.kind]);

  const importGpx = () => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = ".gpx,application/gpx+xml";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (file === undefined) return;

        void file
          .text()
          .then((xml) => {
            setDocument(parseGpx(xml, { filename: file.name }));
            setIsPlanning(false);
            setImportError(null);
          })
          .catch((error: unknown) => {
            setImportError(
              error instanceof Error ? error.message : "Could not import GPX.",
            );
          });
      },
      { once: true },
    );
    input.click();
  };

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
    setDocument(createRouteDocument());
    setIsPlanning(true);
    setImportError(null);
  };

  const addControlPoint = (coordinate: Coordinate) => {
    if (!isPlanning) return;
    setDocument((current) =>
      current === null ? current : appendControlPoint(current, coordinate),
    );
  };

  const closeLoop = () => {
    if (!isPlanning) return;
    setDocument((current) => {
      const start = current?.controlPoints[0];
      if (current === null || start === undefined) return current;
      return appendControlPoint(current, start);
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

  const controlPointCount = document?.controlPoints.length ?? 0;
  const isNewRoute = document?.source.kind === "new";

  return (
    <html.div style={styles.app}>
      <html.header style={styles.header}>
        <html.h1 style={styles.brand}>Ride Maker</html.h1>
        <html.div style={styles.headerActions}>
          <Button onClick={importGpx} variant="quiet">
            Import GPX
          </Button>
          <Button onClick={exportGpx} variant="quiet">
            Export GPX
          </Button>
        </html.div>
      </html.header>
      <html.main style={styles.workspace}>
        <html.aside style={styles.sidebar}>
          <html.p style={styles.eyebrow}>
            {isPlanning
              ? "Planning route"
              : document === null || isNewRoute
                ? "New route"
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
              Create a route here or import a GPX using the button above.
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
          {importError === null ? null : (
            <html.p role="alert" style={styles.error}>
              {importError}
            </html.p>
          )}
          {routingState.status === "routing" ? (
            <html.p style={styles.copy}>Finding a bicycle route…</html.p>
          ) : routingState.status === "error" ? (
            <html.p role="alert" style={styles.error}>
              {routingState.message} The route could not be updated.
            </html.p>
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
                        <html.input
                          aria-label={`${controlPointLabel(index, controlPointCount)} name`}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => renameControlPoint(point.id, event.currentTarget.value)}
                          placeholder={controlPointLabel(index, controlPointCount)}
                          style={styles.pointNameInput}
                          type="text"
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
                <Button disabled={controlPointCount < 2} onClick={() => setIsPlanning(false)}>
                  Finish route
                </Button>
              </>
            ) : isNewRoute ? (
              <Button onClick={() => setIsPlanning(true)} variant="quiet">
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
): RouteDocument {
  const previous = document.controlPoints.map((point) => ({
    ...point,
    kind: point.kind === "finish" ? ("via" as const) : point.kind,
  }));
  const isFirst = previous.length === 0;
  const controlPoints = [
    ...previous,
    {
      id: createId("control"),
      kind: isFirst ? ("start" as const) : ("finish" as const),
      ...coordinate,
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
    return {
      ...document,
      controlPoints,
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

function sameIds(points: RouteDocument["controlPoints"], ids: string[]): boolean {
  return points.length === ids.length && points.every((point, index) => point.id === ids[index]);
}

function toFilename(name: string): string {
  const filename = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return filename.length === 0 ? "ride" : filename;
}
