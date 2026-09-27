import {
  ROUTE_DOCUMENT_SCHEMA_VERSION,
  type RouteDocument,
} from "@ride-maker/domain";

export type SavedRoute = {
  id: string;
  slug: string;
  visibility: "unlisted" | "public" | "private";
  document: RouteDocument;
};

export interface RouteRepository {
  createUnlisted(document: RouteDocument): Promise<SavedRoute>;
  get(id: string): Promise<SavedRoute>;
}

type PocketBaseRecord = {
  id?: unknown;
  slug?: unknown;
  visibility?: unknown;
  document?: unknown;
  message?: unknown;
};

export class PocketBaseRouteRepository implements RouteRepository {
  constructor(
    private readonly apiBaseUrl = "/api",
    private readonly getAuth: () => { token: string; userId: string } | null = () => null,
  ) {}

  async createUnlisted(document: RouteDocument): Promise<SavedRoute> {
    const auth = this.getAuth();
    if (auth === null) throw new Error("Sign in to save this route.");
    return this.request("/collections/routes/records", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth.token },
      body: JSON.stringify({
        name: document.name.trim() || "Untitled route",
        slug: createSlug(document.name),
        visibility: "unlisted",
        owner: auth.userId,
        document,
      }),
    });
  }

  async get(id: string): Promise<SavedRoute> {
    if (!/^[a-z0-9]{15}$/u.test(id)) throw new Error("Invalid shared route link.");
    return this.request(`/collections/routes/records/${id}`);
  }

  private async request(path: string, init?: RequestInit): Promise<SavedRoute> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, init);
    const data = (await response.json()) as PocketBaseRecord;
    if (!response.ok) {
      throw new Error(typeof data.message === "string" ? data.message : `Route request failed (${response.status}).`);
    }
    return parseSavedRoute(data);
  }
}

function parseSavedRoute(value: PocketBaseRecord): SavedRoute {
  if (
    typeof value.id !== "string" ||
    typeof value.slug !== "string" ||
    (value.visibility !== "unlisted" && value.visibility !== "public" && value.visibility !== "private") ||
    !isRouteDocument(value.document)
  ) {
    throw new Error("The saved route has an unsupported format.");
  }
  return { id: value.id, slug: value.slug, visibility: value.visibility, document: value.document };
}

function isRouteDocument(value: unknown): value is RouteDocument {
  if (typeof value !== "object" || value === null) return false;
  const route = value as Partial<RouteDocument>;
  return (
    route.schemaVersion === ROUTE_DOCUMENT_SCHEMA_VERSION &&
    typeof route.id === "string" &&
    typeof route.name === "string" &&
    Array.isArray(route.segments) &&
    Array.isArray(route.controlPoints) &&
    Array.isArray(route.waypoints) &&
    Array.isArray(route.maneuvers) &&
    typeof route.source === "object" &&
    route.source !== null
  );
}

function createSlug(name: string): string {
  const prefix = name.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 32) || "ride";
  const suffix = globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  return `${prefix}-${suffix}`;
}
