import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  loadFixtures,
  parseStorageObservationFromLogs,
  verifyPersistenceObservations,
} from "./verify-persistence.mjs";

export function verifyLibraryManagement(before, renamed, after, fixtures) {
  const index = (observation) => {
    const records = new Map(observation.routes.map((route) => [route.id, route]));
    if (records.size !== observation.routes.length) throw new Error("Duplicate library IDs.");
    return records;
  };
  const original = index(before);
  const updated = index(renamed);
  const remaining = index(after);
  const ride = before.routes.find((route) => route.name === "Morning River Loop");
  if (!ride || ride.sourceKind !== "created") throw new Error("Missing UI-created ride.");
  if (updated.get(ride.id)?.name !== "Morning River Sunset Loop") throw new Error("Rename did not preserve ride ID.");
  if (remaining.has(ride.id)) throw new Error("Confirmed deletion left the ride in storage.");

  const normalizeName = (route) => route.id === ride.id ? { ...route, name: ride.name } : route;
  const comparableRenamed = { routes: before.routes.map((route) => normalizeName(updated.get(route.id) ?? {})) };
  verifyPersistenceObservations(before, comparableRenamed, fixtures, { expectCreated: true });
  const importsBefore = { routes: before.routes.filter((route) => route.sourceKind === "imported") };
  const importsAfter = { routes: importsBefore.routes.map((route) => remaining.get(route.id) ?? {}) };
  verifyPersistenceObservations(importsBefore, importsAfter, fixtures);

  // The fourteen seeded IDs must be new and must retain every observed field.
  for (let n = 1; n <= 14; n++) {
    const id = `synth-route-${String(n).padStart(2, "0")}`;
    if (original.has(id) || !updated.has(id) || !remaining.has(id)) throw new Error(`Missing newly seeded ride ${id}.`);
    verifyPersistenceObservations({ routes: [updated.get(id)] }, { routes: [remaining.get(id)] }, fixtures, { expectCreated: true });
  }
  if (updated.size !== original.size + 14 || remaining.size !== updated.size - 1) {
    throw new Error("Library management added or removed unexpected records.");
  }
  return { status: "passed", renamedId: ride.id, deletedId: ride.id, preservedImports: importsBefore.routes.length,
    seededRides: 14, remainingRides: remaining.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [beforeFile, renamedFile, afterFile, fixturesDir, outputFile] = process.argv.slice(2);
    const before = parseStorageObservationFromLogs(fs.readFileSync(beforeFile, "utf8"), "management-before");
    const finalLogs = fs.readFileSync(afterFile, "utf8");
    const renamed = parseStorageObservationFromLogs(fs.readFileSync(renamedFile, "utf8"), "management-renamed");
    const after = parseStorageObservationFromLogs(finalLogs, "management-after");
    const result = verifyLibraryManagement(before, renamed, after, loadFixtures(fixturesDir));
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
    console.log("Library rename, deletion and preservation verified.");
  } catch (error) {
    console.error(`Library verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
