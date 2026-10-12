import type { RouteDocument } from "@ride-maker/domain";

export const LOCAL_RECORD_VERSION = 1;

export type LocalRouteRecord = {
  id: string;
  version: number;
  name: string;
  distanceMeters: number;
  pointCount: number;
  segmentCount: number;
  createdAt: string;
  originalFilename?: string | undefined;
  originalGpxPath: string;
  snapshotPath: string;
};

export type SavedLocalRoute = {
  record: LocalRouteRecord;
  document: RouteDocument;
  originalGpx: string;
};

export interface LocalRouteDb {
  init(): Promise<void>;
  insertRoute(record: LocalRouteRecord): Promise<void>;
  listRoutes(): Promise<LocalRouteRecord[]>;
  getRoute(id: string): Promise<LocalRouteRecord | null>;
  deleteRoute(id: string): Promise<void>;
  close(): Promise<void>;
}

export class GpxImportError extends Error {
  override readonly name = "GpxImportError";
}

export class SavedRouteNotFoundError extends Error {
  override readonly name = "SavedRouteNotFoundError";
}

export class SavedRouteCorruptError extends Error {
  override readonly name = "SavedRouteCorruptError";
}
