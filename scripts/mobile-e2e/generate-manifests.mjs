#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mode = process.argv[2];
const outputFile = process.argv[3];

if (!mode || !outputFile) {
  console.error("Usage: generate-manifests.mjs <metadata|summary> <output-file>");
  process.exit(1);
}

try {
  let data = {};

  if (mode === "metadata") {
    const parseList = (val) => {
      if (!val) return [];
      return val
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    };

    const declaredPermissions = [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "POST_NOTIFICATIONS",
      "RECEIVE_BOOT_COMPLETED",
    ];

    // Read committed GPX fixture hashes
    const gpxFixtures = [];
    const fixturesDir = path.resolve(__dirname, "../../apps/mobile/e2e/fixtures");
    if (fs.existsSync(fixturesDir)) {
      for (const fname of fs.readdirSync(fixturesDir).sort()) {
        const fpath = path.join(fixturesDir, fname);
        if (fs.statSync(fpath).isFile()) {
          const buf = fs.readFileSync(fpath);
          gpxFixtures.push({
            name: fname,
            size: buf.length,
            sha256: crypto.createHash("sha256").update(buf).digest("hex"),
          });
        }
      }
    }

    // Generated oversized fixture
    let oversizedFixture = null;
    const oversizedPath = process.env.MANIFEST_OVERSIZED_FIXTURE_PATH;
    if (oversizedPath && fs.existsSync(oversizedPath)) {
      const buf = fs.readFileSync(oversizedPath);
      oversizedFixture = {
        path: oversizedPath,
        size: buf.length,
        sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      };
    }

    const networkProbes = {
      offlineProbe: process.env.MANIFEST_PROBE_OFFLINE || null,
      restoredProbe: process.env.MANIFEST_PROBE_RESTORED || null,
    };

    const isConsumer = process.env.MANIFEST_APK_VARIANT === "consumer";
    const fixtureBytes = isConsumer ? null : fs.readFileSync(new URL("../../apps/mobile/src/fixtures/synthetic-routes.json", import.meta.url));
    const fixture = fixtureBytes ? JSON.parse(fixtureBytes.toString()) : null;
    data = {
      fixture: fixture ? { id: fixture.id, schemaVersion: fixture.document.schemaVersion, sha256: crypto.createHash("sha256").update(fixtureBytes).digest("hex") } : null,
      gpxFixtures,
      oversizedFixture,
      networkProbes,
      permissionSetup: isConsumer ? "consumer startup defaults" : { default: "grant fine/coarse/background location and notifications before launch", "04a-diagnostics-permission-denied": "revoke location/notifications, deny runtime prompt" },
      runId: process.env.MANIFEST_RUN_ID || "",
      startedAt: process.env.MANIFEST_STARTED_AT || new Date().toISOString(),
      device: {
        serial: process.env.MANIFEST_DEVICE_SERIAL || "",
        model: process.env.MANIFEST_DEVICE_MODEL || "",
        avdName: process.env.MANIFEST_DEVICE_AVD || "",
        osVersion: process.env.MANIFEST_DEVICE_OS || "",
      },
      git: {
        commit: process.env.MANIFEST_GIT_COMMIT || "",
        branch: process.env.MANIFEST_GIT_BRANCH || "",
        dirty: process.env.MANIFEST_GIT_DIRTY === "true",
      },
      apk: {
        variant: process.env.MANIFEST_APK_VARIANT || "test",
        path: process.env.MANIFEST_APK_PATH || "",
        sha256: process.env.MANIFEST_APK_HASH || "",
        fileSize: Number(process.env.MANIFEST_APK_SIZE || 0),
        packageName: process.env.MANIFEST_APK_PACKAGE || "",
        cleartextTraffic: process.env.MANIFEST_APK_CLEARTEXT === "true",
      },
      sourceFingerprint: process.env.MANIFEST_SOURCE_FINGERPRINT || "",
      harnessFingerprint: process.env.MANIFEST_HARNESS_FINGERPRINT || "",
      commands: {
        build: process.env.MANIFEST_CMD_BUILD || "scripts/mobile-e2e/bootstrap.sh --variant test",
        install: process.env.MANIFEST_CMD_INSTALL || `adb -s ${process.env.MANIFEST_DEVICE_SERIAL || "emulator-5554"} install -r app-test-release.apk`,
        reverse: process.env.MANIFEST_CMD_REVERSE || `adb -s ${process.env.MANIFEST_DEVICE_SERIAL || "emulator-5554"} reverse tcp:${process.env.MANIFEST_FIXTURE_PORT || 8088} tcp:${process.env.MANIFEST_FIXTURE_PORT || 8088}`,
        maestro: process.env.MANIFEST_CMD_MAESTRO || `maestro --device ${process.env.MANIFEST_DEVICE_SERIAL || "emulator-5554"} test <flow>`,
      },
      declaredPermissions,
      network: {
        fixturePort: isConsumer ? null : Number(process.env.MANIFEST_FIXTURE_PORT || 8088),
        apiBaseUrl: process.env.MANIFEST_API_BASE_URL || "http://127.0.0.1:8088/api",
        reverseMapping: isConsumer ? null : `tcp:${process.env.MANIFEST_FIXTURE_PORT || 8088} -> tcp:${process.env.MANIFEST_FIXTURE_PORT || 8088}`,
        offlineTiles: "unimplemented (MapLibre external style requires online network)",
      },
      toolchain: {
        javaVersion: process.env.MANIFEST_JAVA_VERSION || "",
        nodeVersion: process.env.MANIFEST_NODE_VERSION || "",
        maestroVersion: process.env.MANIFEST_MAESTRO_VERSION || "",
      },
    };

    if (!data.runId || !data.device.serial) {
      throw new Error("Metadata missing required fields: MANIFEST_RUN_ID or MANIFEST_DEVICE_SERIAL");
    }
  } else if (mode === "summary") {
    const parseList = (val) => {
      if (!val) return [];
      return val
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    };

    const passedFlows = parseList(process.env.MANIFEST_PASSED_FLOWS);
    const failedFlows = parseList(process.env.MANIFEST_FAILED_FLOWS);
    const checkpoints = parseList(process.env.MANIFEST_CHECKPOINTS);

    data = {
      runId: process.env.MANIFEST_RUN_ID || "",
      status: process.env.MANIFEST_STATUS || (failedFlows.length === 0 ? "passed" : "failed"),
      startedAt: process.env.MANIFEST_STARTED_AT || "",
      finishedAt: process.env.MANIFEST_FINISHED_AT || new Date().toISOString(),
      sourceFingerprint: process.env.MANIFEST_SOURCE_FINGERPRINT || "",
      harnessFingerprint: process.env.MANIFEST_HARNESS_FINGERPRINT || "",
      apkHash: process.env.MANIFEST_APK_HASH || "",
      exitCode: process.env.MANIFEST_EXIT_CODE ? Number(process.env.MANIFEST_EXIT_CODE) : (process.env.MANIFEST_STATUS === "passed" ? 0 : 1),
      total: passedFlows.length + failedFlows.length,
      passed: passedFlows.length,
      failed: failedFlows.length,
      passedFlows,
      failedFlows,
      checkpoints,
    };

    if (process.env.MANIFEST_REASON) {
      data.reason = process.env.MANIFEST_REASON;
    }
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }

  const serialized = JSON.stringify(data, null, 2);
  // Verify can roundtrip cleanly in-memory
  JSON.parse(serialized);

  fs.writeFileSync(outputFile, serialized + "\n", "utf8");
  // Read back and parse file from disk to ensure disk integrity
  JSON.parse(fs.readFileSync(outputFile, "utf8"));
  console.log(`[Manifests] Successfully generated and verified ${outputFile}`);
} catch (err) {
  console.error(`[Manifests] Error generating ${mode}:`, err);
  process.exit(1);
}
