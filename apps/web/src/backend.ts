import PocketBase from "pocketbase";
import { PocketBaseRouteRepository } from "@ride-maker/persistence";

export const pocketBase = new PocketBase(window.location.origin);

export const routeRepository = new PocketBaseRouteRepository("/api", () => {
  const record = pocketBase.authStore.record;
  return pocketBase.authStore.isValid && record?.collectionName === "users"
    ? { token: pocketBase.authStore.token, userId: record.id }
    : null;
});
