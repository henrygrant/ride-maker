import type { FileSystemInterface } from "./file-system-interface";
import { type LocalRouteStorage, validateRouteInstructions } from "./local-route-storage";

export interface RouteObservation {
  id: string;
  name: string;
  distanceMeters: number;
  pointCount: number;
  segmentCount: number;
  snapshotGeometry: Array<Array<[number, number]>>;
  originalBase64: string;
  sourceKind: string;
  hasInstructions: boolean;
  instructionReadiness: boolean;
  controlPoints: Array<{
    id: string;
    kind: string;
    name: string;
    elevationMeters?: number;
    latitude: number;
    longitude: number;
  }>;
  maneuvers: Array<{
    id: string;
    segmentIndex: number;
    shapeIndex: number;
    instruction: string;
    verbalInstruction?: string;
    latitude: number;
    longitude: number;
  }>;
}

export interface StorageObservation {
  timestamp: string;
  count: number;
  routeIds: string[];
  routes: RouteObservation[];
}

/**
 * Read-only TEST-only observation through actual production LocalRouteStorage & native FileSystem.
 * Disabled in consumer builds (behind EXPO_PUBLIC_TEST_MODE).
 * Observes committed IDs, names, distances, snapshot geometry/order, base64 raw original bytes,
 * sourceKind, instruction readiness, controlPoints, and full maneuvers.
 */
export async function observeLocalStorage(
  storage: LocalRouteStorage,
  fs: FileSystemInterface,
): Promise<StorageObservation> {
  const records = await storage.listRoutes();
  const routes: RouteObservation[] = [];

  for (const record of records) {
    const loaded = await storage.getRoute(record.id);
    const originalBase64 = await fs.readAsStringAsync(record.originalGpxPath, {
      encoding: "base64",
    });
    const validation = validateRouteInstructions(loaded.document);

    routes.push({
      id: record.id,
      name: record.name,
      distanceMeters: record.distanceMeters,
      pointCount: record.pointCount,
      segmentCount: record.segmentCount,
      snapshotGeometry: loaded.document.segments.map((seg) =>
        seg.points.map((pt) => [pt.latitude, pt.longitude] as [number, number]),
      ),
      originalBase64,
      sourceKind: record.sourceKind ?? loaded.document.source.kind,
      hasInstructions: Boolean(record.hasInstructions),
      instructionReadiness: validation.ready,
      controlPoints: (loaded.document.controlPoints ?? []).map((cp) => ({
        id: cp.id,
        kind: cp.kind,
        name: cp.name ?? "",
        ...(typeof cp.elevationMeters === "number" ? { elevationMeters: cp.elevationMeters } : {}),
        latitude: cp.latitude,
        longitude: cp.longitude,
      })),
      maneuvers: (loaded.document.maneuvers ?? []).map((m) => ({
        id: m.id,
        segmentIndex: m.segmentIndex,
        shapeIndex: m.shapeIndex,
        instruction: m.instruction,
        ...(typeof m.verbalInstruction === "string" && m.verbalInstruction.trim()
          ? { verbalInstruction: m.verbalInstruction }
          : {}),
        latitude: m.latitude,
        longitude: m.longitude,
      })),
    });
  }

  return {
    timestamp: new Date().toISOString(),
    count: routes.length,
    routeIds: routes.map((r) => r.id),
    routes,
  };
}
