import assert from "node:assert/strict";
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

// 2. Empty before
{
  const before = createObservation([]);
  const after = createObservation([validRoute1, validRoute2]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Empty evidence.*before/);
}

// 3. Empty after
{
  const before = createObservation([validRoute1, validRoute2]);
  const after = createObservation([]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Empty evidence.*after/);
}

// 4. Insufficient evidence
{
  const before = createObservation([validRoute1]);
  const after = createObservation([validRoute1]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Insufficient evidence/);
}

// 5. Route count mismatch
{
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([validRoute1, validRoute2]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Route count mismatch/);
}

// 6. Changed route ID
{
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([validRoute1, { ...validRoute2, id: "changed-id" }, validRouteBom]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Route ID or order mismatch/);
}

// 7. Changed order
{
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([validRoute2, validRoute1, validRouteBom]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Route ID or order mismatch/);
}

// 8. Changed name
{
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([{ ...validRoute1, name: "Tampered" }, validRoute2, validRouteBom]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Route name mismatch/);
}

// 9. Changed distance
{
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([{ ...validRoute1, distanceMeters: 99999 }, validRoute2, validRouteBom]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Route distance mismatch/);
}

// 10. Changed snapshot geometry
{
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const after = createObservation([
    { ...validRoute1, snapshotGeometry: [[[1, 2], [3, 4]]] },
    validRoute2,
    validRouteBom,
  ]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Snapshot geometry mismatch/);
}

// 11. Changed original GPX raw bytes
{
  const before = createObservation([validRoute1, validRoute2, validRouteBom]);
  const tampered = Buffer.from("<tampered/>", "utf8").toString("base64");
  const after = createObservation([{ ...validRoute1, originalBase64: tampered }, validRoute2, validRouteBom]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Original GPX bytes changed/);
}

// 12. Unrecognized fixture hash
{
  const foreignBytes = Buffer.from("<foreign/>", "utf8").toString("base64");
  const before = createObservation([{ ...validRoute1, originalBase64: foreignBytes }, validRoute2, validRouteBom]);
  const after = createObservation([{ ...validRoute1, originalBase64: foreignBytes }, validRoute2, validRouteBom]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Unrecognized fixture hash/);
}

// 13. Missing BOM fixture
{
  const before = createObservation([validRoute1, validRoute2]);
  const after = createObservation([validRoute1, validRoute2]);
  assert.throws(() => verifyPersistenceObservations(before, after, expectedFixtures), /Missing expected UTF-8 BOM fixture/);
}

// 14. Log parsing
{
  const log = `
[E2E_STORAGE_OBSERVE_BEGIN] tag="test" count=2
[E2E_STORAGE_OBSERVE_ROUTE] {"index":0,"total":2,"tag":"test","id":"r1","name":"Route 1","distanceMeters":100,"pointCount":2,"segmentCount":1,"snapshotGeometry":[[[1,2],[3,4]]],"originalBase64":"YWJj"}
[E2E_STORAGE_OBSERVE_ROUTE] {"index":1,"total":2,"tag":"test","id":"r2","name":"Route 2","distanceMeters":200,"pointCount":2,"segmentCount":1,"snapshotGeometry":[[[5,6],[7,8]]],"originalBase64":"ZGVm"}
[E2E_STORAGE_OBSERVE_END] tag="test" count=2
`;
  const obs = parseStorageObservationFromLogs(log, "test");
  assert.equal(obs.count, 2);
  assert.equal(obs.routeIds[0], "r1");
  assert.equal(obs.routeIds[1], "r2");
}

console.log("All 14 persistence-verifier tests passed!");
