#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function computeSha256(data) {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function parseStorageObservationFromLogs(logContent, tag) {
  const lines = logContent.split("\n");
  const routes = [];
  const chunkBuffers = new Map(); // key: routeIndex -> { total: number, chunks: Map<number, string> }
  let beginSeen = false;
  let endSeen = false;
  let expectedCount = -1;

  for (const line of lines) {
    if (line.includes(`[E2E_STORAGE_OBSERVE_ERROR] tag="${tag}"`)) {
      throw new Error(`Storage observation error logged for tag "${tag}": ${line}`);
    }
    if (line.includes(`[E2E_STORAGE_OBSERVE_BEGIN] tag="${tag}"`)) {
      beginSeen = true;
      const m = line.match(/count=(\d+)/);
      if (m && m[1]) expectedCount = parseInt(m[1], 10);
      routes.length = 0;
      chunkBuffers.clear();
    } else if (line.includes(`[E2E_STORAGE_OBSERVE_ROUTE]`)) {
      const markerIdx = line.indexOf(`[E2E_STORAGE_OBSERVE_ROUTE]`);
      const jsonStr = line.slice(markerIdx + `[E2E_STORAGE_OBSERVE_ROUTE]`.length).trim();
      let item;
      try {
        item = JSON.parse(jsonStr);
      } catch (err) {
        throw new Error(`Failed to parse route log for tag "${tag}": ${err.message}`);
      }
      if (!item.tag || item.tag === tag) {
        const idx = typeof item.index === "number" ? item.index : routes.length;
        routes[idx] = {
          id: item.id,
          name: item.name,
          distanceMeters: item.distanceMeters,
          pointCount: item.pointCount,
          segmentCount: item.segmentCount,
          snapshotGeometry: item.snapshotGeometry,
          originalBase64: item.originalBase64,
          sourceKind: item.sourceKind,
          hasInstructions: item.hasInstructions,
          instructionReadiness: item.instructionReadiness,
          controlPoints: item.controlPoints,
          maneuvers: item.maneuvers,
        };
      }
    } else if (line.includes(`[E2E_STORAGE_OBSERVE_CHUNK]`)) {
      const tagMatch = line.match(/tag="([^"]+)"/);
      const chunkTag = tagMatch ? tagMatch[1] : "";
      if (chunkTag === tag) {
        const rMatch = line.match(/routeIndex=(\d+)/);
        const cMatch = line.match(/chunkIndex=(\d+)/);
        const tMatch = line.match(/totalChunks=(\d+)/);
        const dataIdx = line.indexOf("data=");
        if (rMatch && cMatch && tMatch && dataIdx !== -1) {
          const rIdx = parseInt(rMatch[1], 10);
          const cIdx = parseInt(cMatch[1], 10);
          const totalChunks = parseInt(tMatch[1], 10);
          const chunkData = line.slice(dataIdx + 5);

          if (!chunkBuffers.has(rIdx)) {
            chunkBuffers.set(rIdx, { total: totalChunks, chunks: new Map() });
          }
          const buf = chunkBuffers.get(rIdx);
          buf.chunks.set(cIdx, chunkData);

          if (buf.chunks.size === buf.total) {
            let fullStr = "";
            for (let i = 0; i < buf.total; i++) {
              const part = buf.chunks.get(i);
              if (part === undefined) {
                throw new Error(`Missing chunk ${i}/${buf.total} for routeIndex ${rIdx} in tag "${tag}"`);
              }
              fullStr += part;
            }
            try {
              const item = JSON.parse(fullStr);
              routes[rIdx] = {
                id: item.id,
                name: item.name,
                distanceMeters: item.distanceMeters,
                pointCount: item.pointCount,
                segmentCount: item.segmentCount,
                snapshotGeometry: item.snapshotGeometry,
                originalBase64: item.originalBase64,
                sourceKind: item.sourceKind,
                hasInstructions: item.hasInstructions,
                instructionReadiness: item.instructionReadiness,
                controlPoints: item.controlPoints,
                maneuvers: item.maneuvers,
              };
              chunkBuffers.delete(rIdx);
            } catch (err) {
              throw new Error(`Failed to parse assembled chunked route JSON for routeIndex ${rIdx}: ${err.message}`);
            }
          }
        }
      }
    } else if (line.includes(`[E2E_STORAGE_OBSERVE_END] tag="${tag}"`)) {
      if (beginSeen) {
        endSeen = true;
        break;
      }
    }
  }

  if (chunkBuffers.size > 0) {
    const pendingIndices = Array.from(chunkBuffers.keys()).join(", ");
    throw new Error(`Incomplete chunked route observations for route indices [${pendingIndices}] in tag "${tag}"`);
  }

  const cleanRoutes = routes.filter((r) => Boolean(r && r.id));

  if (!beginSeen || !endSeen || cleanRoutes.length === 0) {
    throw new Error(
      `Failed to observe storage for tag "${tag}": beginSeen=${beginSeen}, endSeen=${endSeen}, routesCount=${cleanRoutes.length}`,
    );
  }
  if (expectedCount >= 0 && cleanRoutes.length !== expectedCount) {
    throw new Error(
      `Route count mismatch for tag "${tag}": expected ${expectedCount}, got ${cleanRoutes.length}`,
    );
  }

  return {
    timestamp: new Date().toISOString(),
    count: cleanRoutes.length,
    routeIds: cleanRoutes.map((r) => r.id),
    routes: cleanRoutes,
  };
}

export function loadFixtures(fixturesDir) {
  const fixtures = [];
  if (!fs.existsSync(fixturesDir)) {
    throw new Error(`Fixtures directory not found: ${fixturesDir}`);
  }
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".gpx"));
  for (const f of files) {
    const filePath = path.join(fixturesDir, f);
    const bytes = fs.readFileSync(filePath);
    fixtures.push({
      name: f,
      sha256: computeSha256(bytes),
      bytes,
    });
  }
  return fixtures;
}

export function verifyPersistenceObservations(before, after, expectedFixtures, options = {}) {
  if (!before || !before.routes || before.routes.length === 0) {
    throw new Error("Empty evidence: 'before' observation contains zero saved routes.");
  }
  if (!after || !after.routes || after.routes.length === 0) {
    throw new Error("Empty evidence: 'after' observation contains zero saved routes.");
  }
  if (before.routes.length < (options.expectCreated ? 1 : 2)) {
    throw new Error(`Insufficient evidence: expected at least 2 saved routes, got ${before.routes.length}.`);
  }
  if (before.routes.length !== after.routes.length) {
    throw new Error(
      `Route count mismatch: before=${before.routes.length}, after=${after.routes.length}.`,
    );
  }

  let createdRoutesCount = 0;
  for (let i = 0; i < before.routes.length; i++) {
    const b = before.routes[i];
    const a = after.routes[i];

    if (!b.id || !a.id || b.id !== a.id) {
      throw new Error(`Route ID or order mismatch at index ${i}: before='${b?.id}', after='${a?.id}'.`);
    }
    if (b.name !== a.name) {
      throw new Error(`Route name mismatch for route '${b.id}': before='${b.name}', after='${a.name}'.`);
    }
    if (b.distanceMeters !== a.distanceMeters) {
      throw new Error(
        `Route distance mismatch for route '${b.id}': before=${b.distanceMeters}, after=${a.distanceMeters}.`,
      );
    }
    if (b.pointCount !== a.pointCount || b.segmentCount !== a.segmentCount) {
      throw new Error(`Point or segment count mismatch for route '${b.id}'.`);
    }

    if (JSON.stringify(b.snapshotGeometry) !== JSON.stringify(a.snapshotGeometry)) {
      throw new Error(`Snapshot geometry mismatch for route '${b.id}'.`);
    }

    for (const field of ["sourceKind", "hasInstructions", "instructionReadiness", "controlPoints", "maneuvers"]) {
      if (JSON.stringify(b[field]) !== JSON.stringify(a[field])) {
        throw new Error(`Stored ${field} mismatch for route '${b.id}'.`);
      }
    }
    if (b.sourceKind === "created") {
      createdRoutesCount++;
      if (b.hasInstructions !== true || b.instructionReadiness !== true ||
          !Array.isArray(b.controlPoints) || b.controlPoints.length < 2 ||
          !Array.isArray(b.maneuvers) || b.maneuvers.length === 0) {
        throw new Error(`Missing created directions evidence for route '${b.id}'.`);
      }
      for (const maneuver of b.maneuvers) {
        const point = b.snapshotGeometry?.[maneuver.segmentIndex]?.[maneuver.shapeIndex];
        if (!point || !Number.isFinite(maneuver.latitude) || !Number.isFinite(maneuver.longitude) ||
            Math.abs(point[0] - maneuver.latitude) > 1e-6 || Math.abs(point[1] - maneuver.longitude) > 1e-6 ||
            typeof maneuver.instruction !== "string" || !maneuver.instruction.trim()) {
          throw new Error(`Invalid created maneuver evidence for route '${b.id}'.`);
        }
      }
    }

    if (!b.originalBase64 || !a.originalBase64) {
      throw new Error(`Missing raw original GPX base64 bytes for route '${b.id}'.`);
    }

    const bBytes = Buffer.from(b.originalBase64, "base64");
    const aBytes = Buffer.from(a.originalBase64, "base64");

    if (!bBytes.equals(aBytes)) {
      throw new Error(`Original GPX bytes changed after restart for route '${b.id}'.`);
    }

    const bSha = computeSha256(bBytes);
    const aSha = computeSha256(aBytes);
    if (bSha !== aSha) {
      throw new Error(
        `Original GPX SHA256 mismatch for route '${b.id}': before=${bSha}, after=${aSha}.`,
      );
    }
  }

  const matchedFixtures = new Set();
  const storedGpxHashes = [];

  for (const route of before.routes) {
    if (options.expectCreated && route.sourceKind === "created") continue;
    const routeBytes = Buffer.from(route.originalBase64, "base64");
    const routeSha = computeSha256(routeBytes);

    const matchingFixture = expectedFixtures.find((f) => f.sha256 === routeSha);
    if (!matchingFixture) {
      throw new Error(
        `Unrecognized fixture hash for route '${route.id}' (${route.name}): SHA256 ${routeSha} does not match any expected fixture.`,
      );
    }
    matchedFixtures.add(matchingFixture.name);
    storedGpxHashes.push({
      routeId: route.id,
      name: route.name,
      sha256: routeSha,
      fixtureName: matchingFixture.name,
    });
  }

  const bomFixture = expectedFixtures.find((f) => f.name.includes("bom"));
  if (!options.expectCreated && bomFixture && !matchedFixtures.has(bomFixture.name)) {
    throw new Error(
      `Missing expected UTF-8 BOM fixture '${bomFixture.name}' in observed routes.`,
    );
  }

  if (options.expectCreated && createdRoutesCount === 0) {
    throw new Error("Missing expected created route evidence.");
  }

  return {
    createdRoutesCount,
    verifiedAt: new Date().toISOString(),
    status: "passed",
    routesCount: before.routes.length,
    routeIds: before.routes.map((r) => r.id),
    storedGpxHashes,
    matchingIds: true,
    matchingGeometry: true,
    matchingOriginalBytes: true,
    matchingOrder: true,
    fixtureHashesVerified: matchedFixtures.size > 0,
    matchingManeuvers: true,
    matchingControlPoints: true,
    offlinePreserved: true,
  };
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let beforeFile = "";
  let afterFile = "";
  let fixturesDir = path.resolve("apps/mobile/e2e/fixtures");
  let outputFile = "";
  let expectCreated = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--before" && args[i + 1]) beforeFile = args[++i];
    else if (args[i] === "--after" && args[i + 1]) afterFile = args[++i];
    else if (args[i] === "--fixtures-dir" && args[i + 1]) fixturesDir = args[++i];
    else if (args[i] === "--output" && args[i + 1]) outputFile = args[++i];
    else if (args[i] === "--expect-created") expectCreated = true;
  }

  if (!beforeFile || !afterFile) {
    console.error("Usage: verify-persistence.mjs --before <before.log> --after <after.log> [--fixtures-dir <dir>] [--output <out.json>]");
    process.exit(1);
  }

  try {
    const beforeLog = fs.readFileSync(beforeFile, "utf8");
    const afterLog = fs.readFileSync(afterFile, "utf8");

    const beforeObs = parseStorageObservationFromLogs(beforeLog, expectCreated ? "created-before" : "before");
    const afterObs = parseStorageObservationFromLogs(afterLog, expectCreated ? "created-after" : "after");

    const fixtures = loadFixtures(fixturesDir);
    const result = verifyPersistenceObservations(beforeObs, afterObs, fixtures, { expectCreated });

    console.log(`Persistence verified: ${result.routesCount} routes matched before/after restart.`);
    for (const h of result.storedGpxHashes) {
      console.log(`  - ${h.name} (${h.routeId}): SHA256 ${h.sha256} [${h.fixtureName}]`);
    }

    if (outputFile) {
      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf8");
      console.log(`Report written to ${outputFile}`);
    }

    process.exit(0);
  } catch (err) {
    console.error(`Persistence verification failed: ${err.message}`);
    process.exit(1);
  }
}
