import type { FileSystemInterface } from "./file-system-interface";
import type { LocalRouteStorage } from "./local-route-storage";

export interface RouteObservation {
  id: string;
  name: string;
  distanceMeters: number;
  pointCount: number;
  segmentCount: number;
  snapshotGeometry: Array<Array<[number, number]>>;
  originalBase64: string;
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
 * Observes committed IDs, names, distances, snapshot geometry/order, and base64 raw original bytes.
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
    });
  }

  return {
    timestamp: new Date().toISOString(),
    count: routes.length,
    routeIds: routes.map((r) => r.id),
    routes,
  };
}
