import type { RouteDocument } from "@ride-maker/domain";
import type { RouteProvenance } from "./storage";
import type { PreparationReviewMetadata } from "@ride-maker/routing";

export type SurfaceMode = "library" | "create" | "detail" | "navigate" | "diagnostics";

export type DisplayRoute = {
  id: string;
  slug?: string;
  kind?: "local" | "remote";
  sourceKind?: RouteProvenance;
  distanceMeters?: number;
  document: RouteDocument;
  originalDocument?: RouteDocument;
  preparationMetadata?: PreparationReviewMetadata | null;
  activeVersionId?: string | null;
  recoveryAvailable?: boolean;
  previewingOriginal?: boolean;
  sourceIdentityToken?: string;
};
