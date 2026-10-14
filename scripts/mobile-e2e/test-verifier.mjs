import assert from "node:assert/strict";
import { verifyLibraryManagement } from "./verify-library-management.mjs";
import {
  computeSha256,
  parseStorageObservationFromLogs,
  verifyPersistenceObservations,
} from "./verify-persistence.mjs";

console.log("Running persistence-verifier tests...");

const gpx1Bytes = Buffer.from("<gpx><trk><name>Central Park Track</name></trk></gpx>", "utf8");
const gpx2Bytes = Buffer.from("<gpx><rte><name>Hudson Greenway Route</name></rte></gpx>", "utf8");
const gpxBomBytes = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from("<gpx><trk><name>München Über Berg Straße — Café René</name></trk></gpx>", "utf8"),
]);

const expectedFixtures = [
  {
    name: "synthetic-track.gpx",
    sha256: computeSha256(gpx1Bytes),
  },
  {
    name: "synthetic-route.gpx",
    sha256: computeSha256(gpx2Bytes),
  },
  {
    name: "synthetic-utf8-bom.gpx",
    sha256: computeSha256(gpxBomBytes),
  },
];

const validRoute1 = {
  id: "route-track-001",
  name: "Central Park Track",
  distanceMeters: 5200,
  pointCount: 120,
  segmentCount: 1,
  snapshotGeometry: [
    [
      [40.785, -73.968],
      [40.786, -73.967],
    ],
  ],
  originalBase64: gpx1Bytes.toString("base64"),
};

const validRoute2 = {
  id: "route-rte-002",
  name: "Hudson Greenway Route",
  distanceMeters: 3100,
  pointCount: 80,
  segmentCount: 1,
  snapshotGeometry: [
    [
      [40.712, -74.015],
      [40.713, -74.014],
    ],
  ],
  originalBase64: gpx2Bytes.toString("base64"),
};

const validRouteBom = {
  id: "route-bom-003",
  name: "München Über Berg Straße — Café René",
  distanceMeters: 1050,
  pointCount: 3,
  segmentCount: 1,
  snapshotGeometry: [
    [
      [48.1351, 11.582],
      [48.1375, 11.5755],
      [48.14, 11.57],
    ],
  ],
  originalBase64: gpxBomBytes.toString("base64"),
};

function createObservation(routes) {
  return {
    timestamp: new Date().toISOString(),
    count: routes.length,
    routeIds: routes.map((r) => r.id),
    routes: routes.map((r) => ({ ...r })),
  };
}

// 1. Success matching
{
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([validRoute1, validRoute2, validRouteBom]);
  const res = verifyPersistenceObservations(before, after, expectedFixtures);
  assert.equal(res.status, "passed");
  assert.equal(res.routesCount, 3);
  assert.equal(res.matchingIds, true);
  assert.equal(res.matchingGeometry, true);
  assert.equal(res.matchingOriginalBytes, true);
  assert.equal(res.matchingOrder, true);
  assert.equal(res.fixtureHashesVerified, true);
}

// 2. Count mismatch failure
{
  const before = createObservation([validRoute1, validRoute2]);
  const after = createObservation([validRoute1]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Route count mismatch/,
  );
}

// 3. ID / ordering mismatch failure
{
  const before = createObservation([validRoute1, validRoute2]);
  const after = createObservation([validRoute2, validRoute1]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Route ID or order mismatch/,
  );
}

// 4. Geometry change failure
{
  const mutatedRoute2 = {
    ...validRoute2,
    snapshotGeometry: [
      [
        [40.712, -74.015],
        [40.714, -74.014], // mutated coordinate
      ],
    ],
  };
  const before = createObservation([validRoute1, validRoute2]);
  const after = createObservation([validRoute1, mutatedRoute2]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Snapshot geometry mismatch/,
  );
}

// 5. Corrupted GPX bytes failure
{
  const mutatedBytesRoute1 = {
    ...validRoute1,
    originalBase64: Buffer.from("corrupted").toString("base64"),
  };
  const before = createObservation([validRoute1, validRoute2]);
  const after = createObservation([mutatedBytesRoute1, validRoute2]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Original GPX bytes changed after restart/,
  );
}

// 6. Unknown fixture SHA256 failure
{
  const unknownRoute = {
    ...validRoute1,
    id: "route-unknown-004",
    originalBase64: Buffer.from("<gpx>unregistered</gpx>").toString("base64"),
  };
  const before = createObservation([unknownRoute, validRoute2]);
  const after = createObservation([unknownRoute, validRoute2]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Unrecognized fixture hash/,
  );
}

// 7. Missing UTF-8 BOM fixture failure
{
  const before = createObservation([validRoute1, validRoute2]);
  const after = createObservation([validRoute1, validRoute2]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Missing expected UTF-8 BOM fixture/,
  );
}

// 8. Empty before evidence failure
{
  assert.throws(
    () => verifyPersistenceObservations(createObservation([]), createObservation([validRoute1]), expectedFixtures),
    /Empty evidence/,
  );
}

// 9. Single route insufficient evidence failure
{
  const before = createObservation([validRoute1]);
  const after = createObservation([validRoute1]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Insufficient evidence: expected at least 2 saved routes/,
  );
}

// 10. Distance mismatch failure
{
  const mutatedDistance = { ...validRoute1, distanceMeters: 9999 };
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([mutatedDistance, validRoute2, validRouteBom]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Route distance mismatch/,
  );
}

// 11. Point count mismatch failure
{
  const mutatedPoints = { ...validRoute1, pointCount: 999 };
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([mutatedPoints, validRoute2, validRouteBom]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Point or segment count mismatch/,
  );
}

// 12. Segment count mismatch failure
{
  const mutatedSegments = { ...validRoute1, segmentCount: 99 };
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([mutatedSegments, validRoute2, validRouteBom]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Point or segment count mismatch/,
  );
}

// 13. Route name mismatch failure
{
  const mutatedName = { ...validRoute1, name: "Renamed Track" };
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([mutatedName, validRoute2, validRouteBom]);
  assert.throws(
    () => verifyPersistenceObservations(before, after, expectedFixtures),
    /Route name mismatch/,
  );
}

// 14. parseStorageObservationFromLogs test
{
  const sampleLog = `
02-23 10:00:00.123 1234 1234 I ReactNativeJS: [E2E_STORAGE_OBSERVE_BEGIN] tag="test" count=2
02-23 10:00:00.124 1234 1234 I ReactNativeJS: [E2E_STORAGE_OBSERVE_ROUTE] {"id":"r1","name":"Route 1","distanceMeters":100,"pointCount":10,"segmentCount":1,"snapshotGeometry":[[[1,2]]],"originalBase64":"AAAA","index":0,"tag":"test"}
02-23 10:00:00.125 1234 1234 I ReactNativeJS: [E2E_STORAGE_OBSERVE_ROUTE] {"id":"r2","name":"Route 2","distanceMeters":200,"pointCount":20,"segmentCount":1,"snapshotGeometry":[[[3,4]]],"originalBase64":"BBBB","index":1,"tag":"test"}
02-23 10:00:00.126 1234 1234 I ReactNativeJS: [E2E_STORAGE_OBSERVE_END] tag="test" count=2
`;
  const obs = parseStorageObservationFromLogs(sampleLog, "test");
  assert.equal(obs.count, 2);
  assert.equal(obs.routeIds[0], "r1");
  assert.equal(obs.routeIds[1], "r2");
}

console.log("All 14 baseline persistence-verifier tests passed!");

// Generated routes use the same framed logger, retain full instructions, and
// permit one created route without relaxing the baseline imported-fixture gate.
const created = {
  ...validRoute1,
  id: "created-001",
  sourceKind: "created",
  hasInstructions: true,
  instructionReadiness: true,
  controlPoints: [
    { id: "start", kind: "start", name: "Start Point", elevationMeters: 25.5, latitude: 40.785, longitude: -73.968 },
    { id: "finish", kind: "finish", name: "Finish Point", elevationMeters: 30.0, latitude: 40.786, longitude: -73.967 },
  ],
  maneuvers: [
    {
      id: "m1",
      segmentIndex: 0,
      shapeIndex: 0,
      latitude: 40.785,
      longitude: -73.968,
      instruction: "Head north",
      verbalInstruction: "In 50 meters, head north on Central Park Loop",
    },
  ],
};
const generatedOptions = { expectCreated: true };
const createdBefore = createObservation([created]);
assert.equal(verifyPersistenceObservations(createdBefore, createObservation([created]), expectedFixtures,
  generatedOptions).createdRoutesCount, 1);
for (const field of ["sourceKind", "hasInstructions", "instructionReadiness", "controlPoints", "maneuvers"]) {
  assert.throws(() => verifyPersistenceObservations(createdBefore,
    createObservation([{ ...created, [field]: undefined }]), expectedFixtures, generatedOptions),
  new RegExp(`Stored ${field} mismatch`));
}
assert.throws(() => verifyPersistenceObservations(createObservation([validRoute1]),
  createObservation([validRoute1]), expectedFixtures, generatedOptions), /Missing expected created/);
const badCreated = { ...created, maneuvers: [{ ...created.maneuvers[0], latitude: 45 }] };
assert.throws(() => verifyPersistenceObservations(createObservation([badCreated]),
  createObservation([badCreated]), expectedFixtures, generatedOptions), /Invalid created maneuver/);
const createdLog = `[E2E_STORAGE_OBSERVE_BEGIN] tag="created-before" count=1
[E2E_STORAGE_OBSERVE_ROUTE] ${JSON.stringify({ ...created, index: 0, total: 1, tag: "created-before" })}
[E2E_STORAGE_OBSERVE_END] tag="created-before" count=1`;
const parsedCreated = parseStorageObservationFromLogs(createdLog, "created-before");
assert.deepEqual(parsedCreated.routes[0].maneuvers, created.maneuvers);
assert.equal(parsedCreated.routes[0].sourceKind, "created");
assert.throws(() => parseStorageObservationFromLogs(createdLog, "created-after"), /Failed to observe/);
assert.throws(() => parseStorageObservationFromLogs(createdLog.split("[E2E_STORAGE_OBSERVE_END]")[0],
  "created-before"), /Failed to observe/);

// Verify chunked log parsing
const payload = JSON.stringify({ ...created, index: 0, total: 1, tag: "created-before" });
const chunk1 = payload.slice(0, 100);
const chunk2 = payload.slice(100);
const chunkedLog = `[E2E_STORAGE_OBSERVE_BEGIN] tag="created-before" count=1
[E2E_STORAGE_OBSERVE_CHUNK] tag="created-before" routeIndex=0 chunkIndex=0 totalChunks=2 data=${chunk1}
[E2E_STORAGE_OBSERVE_CHUNK] tag="created-before" routeIndex=0 chunkIndex=1 totalChunks=2 data=${chunk2}
[E2E_STORAGE_OBSERVE_END] tag="created-before" count=1`;
const parsedChunked = parseStorageObservationFromLogs(chunkedLog, "created-before");
assert.deepEqual(parsedChunked.routes[0].maneuvers, created.maneuvers);
assert.equal(parsedChunked.routes[0].maneuvers[0].verbalInstruction, "In 50 meters, head north on Central Park Loop");
assert.equal(parsedChunked.routes[0].controlPoints[0].elevationMeters, 25.5);

// Verify incomplete chunk fails closed
const incompleteChunkedLog = `[E2E_STORAGE_OBSERVE_BEGIN] tag="created-before" count=1
[E2E_STORAGE_OBSERVE_CHUNK] tag="created-before" routeIndex=0 chunkIndex=0 totalChunks=2 data=${chunk1}
[E2E_STORAGE_OBSERVE_END] tag="created-before" count=1`;
assert.throws(() => parseStorageObservationFromLogs(incompleteChunkedLog, "created-before"), /Incomplete chunked route/);

// Verify mixed storage (imported fixtures + created route preserved together)
const mixedBefore = createObservation([validRoute1, validRoute2, validRouteBom, created]);
const mixedAfter = createObservation([validRoute1, validRoute2, validRouteBom, created]);
const mixedRes = verifyPersistenceObservations(mixedBefore, mixedAfter, expectedFixtures, { expectCreated: true });
assert.equal(mixedRes.status, "passed");
assert.equal(mixedRes.routesCount, 4);
assert.equal(mixedRes.createdRoutesCount, 1);
assert.equal(mixedRes.fixtureHashesVerified, true);
assert.equal(mixedRes.storedGpxHashes.length, 3); // 3 imported fixture hashes verified

console.log("All 11 generated persistence-verifier checks passed!");

const imports = [validRoute1, validRoute2, validRouteBom].map((route) => ({ ...route, sourceKind: "imported" }));
const managementBefore = createObservation([{ ...created, name: "Morning River Loop" }, ...imports]);
const seeded = Array.from({ length: 14 }, (_, i) => ({ ...created,
  id: `synth-route-${String(i + 1).padStart(2, "0")}`, name: `Seeded ride ${i + 1}` }));
const managementRenamed = createObservation([{ ...created, name: "Morning River Sunset Loop" }, ...imports, ...seeded]);
const managementAfter = createObservation([...imports, ...seeded]);
assert.equal(verifyLibraryManagement(managementBefore, managementRenamed, managementAfter, expectedFixtures).remainingRides, 17);
const clone = (value) => JSON.parse(JSON.stringify(value));
const changedRename = clone(managementRenamed);
changedRename.routes[0].snapshotGeometry[0][0][0] += 1;
assert.throws(() => verifyLibraryManagement(managementBefore, changedRename, managementAfter, expectedFixtures), /geometry mismatch/);
const changedImport = clone(managementAfter);
changedImport.routes[0].originalBase64 = Buffer.from("corrupted").toString("base64");
assert.throws(() => verifyLibraryManagement(managementBefore, managementRenamed, changedImport, expectedFixtures), /GPX bytes changed/);
assert.throws(() => verifyLibraryManagement(managementBefore, managementRenamed,
  createObservation(managementAfter.routes.slice(0, -1)), expectedFixtures), /Missing newly seeded ride/);
assert.throws(() => verifyLibraryManagement(managementBefore, managementRenamed,
  createObservation([...managementAfter.routes, created]), expectedFixtures), /deletion left the ride/);
console.log("All 5 library management preservation checks passed!");
