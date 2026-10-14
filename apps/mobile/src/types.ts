import type { RouteDocument } from "@ride-maker/domain";
import type { RouteProvenance } from "./storage";

export type SurfaceMode = "library" | "create" | "detail" | "navigate" | "diagnostics";

export type DisplayRoute = {
  id: string;
  slug?: string;
  kind?: "local" | "remote";
  sourceKind?: RouteProvenance;
  distanceMeters?: number;
  document: RouteDocument;
};
