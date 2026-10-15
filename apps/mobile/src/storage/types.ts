import type { RouteDocument } from "@ride-maker/domain";
import type { PreparationReviewMetadata, PreparedRouteResult } from "@ride-maker/routing";

export const LOCAL_RECORD_VERSION = 2;
export const LOCAL_RECORD_VERSION_V3 = 3;
export const PREPARED_RECORD_VERSION = 3;

export type RouteProvenance = "imported" | "created";

export type LocalRouteRecord = {
  id: string;
  version: number;
  revision?: number | undefined;
  storageIdentity?: string | undefined;
  name: string;
  distanceMeters: number;
  pointCount: number;
  segmentCount: number;
  createdAt: string;
  originalFilename?: string | undefined;
  originalGpxPath: string;
  snapshotPath: string;
  sourceKind?: RouteProvenance;
  hasInstructions?: boolean;
  activePreparationId?: string | null | undefined;
};

export type PreparedRouteManifest = {
  schemaVersion: 1;
  versionId: string;
  sourceRouteId: string;
  documentId: string;
  metadata: PreparationReviewMetadata;
  createdAt: string;
};

export type SavedLocalRoute = {
  record: LocalRouteRecord;
  document: RouteDocument;
  originalGpx: string;
  originalDocument?: RouteDocument | undefined;
  preparation?: PreparedRouteManifest | null | undefined;
  preparationMetadata?: PreparationReviewMetadata | null | undefined;
  activeVersionId?: string | null | undefined;
};

export type CommitActivePreparationParams = {
  id: string;
  version: number;
  expectedRevision: number;
  expectedStorageIdentity: string;
  activePreparationId: string | null;
  distanceMeters: number;
  pointCount: number;
  segmentCount: number;
  hasInstructions: boolean;
};

export interface LocalRouteDb {
  init(): Promise<void>;
  insertRoute(record: LocalRouteRecord): Promise<void>;
  updateRouteName(id: string, name: string): Promise<void>;
  commitActivePreparation(params: CommitActivePreparationParams): Promise<void>;
  listRoutes(): Promise<LocalRouteRecord[]>;
  getRoute(id: string): Promise<LocalRouteRecord | null>;
  deleteRoute(id: string): Promise<void>;
  close(): Promise<void>;
}

export type SourceIdentityToken =
  | {
      activePreparationId?: string | null | undefined;
      version?: number | undefined;
      revision?: number | undefined;
      storageIdentity?: string | undefined;
    }
  | string;

export function buildSourceIdentityToken(record: LocalRouteRecord): string {
  return `${record.id}:${record.storageIdentity ?? "legacy"}:${record.activePreparationId ?? "original"}:${record.version}:${record.revision ?? 0}`;
}

export type AcceptPreparationParams = {
  routeId: string;
  prepared: PreparedRouteResult;
  expectedSourceToken: SourceIdentityToken;
};

export class GpxImportError extends Error {
  override readonly name = "GpxImportError";
}

export class SavedRouteNotFoundError extends Error {
  override readonly name = "SavedRouteNotFoundError";
}

export class SavedRouteCorruptError extends Error {
  override readonly name = "SavedRouteCorruptError";
}

export class StalePreparationError extends Error {
  override readonly name = "StalePreparationError";
}

export class PreparationValidationError extends Error {
  override readonly name = "PreparationValidationError";
}
