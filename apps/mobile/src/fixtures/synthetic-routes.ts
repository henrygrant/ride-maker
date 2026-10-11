import type { RouteDocument } from "@ride-maker/domain";
import type { SavedRoute } from "@ride-maker/persistence";
import canonicalFixture from "./synthetic-routes.json";

export const SYNTHETIC_SAVED_ROUTE = canonicalFixture as SavedRoute;
export const SYNTHETIC_ROUTE_ID = SYNTHETIC_SAVED_ROUTE.id;
export const SYNTHETIC_ROUTE_DOCUMENT: RouteDocument = SYNTHETIC_SAVED_ROUTE.document;
export const SYNTHETIC_ROUTES: SavedRoute[] = [SYNTHETIC_SAVED_ROUTE];
