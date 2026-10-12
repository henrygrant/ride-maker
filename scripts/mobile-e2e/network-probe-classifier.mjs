#!/usr/bin/env node

/**
 * Network probe classifier for Android emulator E2E tests.
 * Distinguishes genuine network-level connection failures (refused, unreachable, timed out)
 * from infrastructure/ADB/tool failures (missing nc, device offline, empty output).
 */

export function classifyProbeResult(rawOutput, exitCode = 0) {
  const trimmed = (rawOutput || "").trim();

  // 1. Missing tool or execution failure
  if (
    /not found/i.test(trimmed) ||
    /inaccessible/i.test(trimmed) ||
    /Permission denied/i.test(trimmed) ||
    /toybox:.*not found/i.test(trimmed)
  ) {
    return {
      type: "INFRASTRUCTURE_FAILURE",
      reason: "MISSING_TOOL_OR_PERMISSION",
      rawOutput,
      exitCode,
    };
  }

  // 2. ADB device errors
  if (
    /error: device offline/i.test(trimmed) ||
    /error: closed/i.test(trimmed) ||
    /error: device not found/i.test(trimmed) ||
    /daemon not running/i.test(trimmed)
  ) {
    return {
      type: "INFRASTRUCTURE_FAILURE",
      reason: "ADB_DEVICE_FAILURE",
      rawOutput,
      exitCode,
    };
  }

  // 3. Indeterminate / completely empty output
  if (!trimmed) {
    return {
      type: "INFRASTRUCTURE_FAILURE",
      reason: "EMPTY_INDETERMINATE_OUTPUT",
      rawOutput,
      exitCode,
    };
  }

  // 4. Reachable HTTP response
  const httpMatch =
    trimmed.match(/^HTTP\/[0-9.]+\s+([0-9]{3})/m) || trimmed.match(/HTTP\/[0-9.]+\s+([0-9]{3})/);
  if (httpMatch && httpMatch[1]) {
    const statusCode = parseInt(httpMatch[1], 10);
    return {
      type: "REACHABLE_HTTP",
      statusCode,
      reason: `HTTP_${statusCode}`,
      rawOutput,
      exitCode,
    };
  }

  // 5. Genuine network-level connection failures
  if (
    /Connection refused/i.test(trimmed) ||
    /Network is unreachable/i.test(trimmed) ||
    /No route to host/i.test(trimmed) ||
    /Operation timed out/i.test(trimmed) ||
    /Connection timed out/i.test(trimmed) ||
    /Connection reset by peer/i.test(trimmed) ||
    /bad address/i.test(trimmed) ||
    /no address/i.test(trimmed) ||
    /timed out/i.test(trimmed)
  ) {
    return {
      type: "CONNECTION_FAILURE",
      reason: "NETWORK_UNREACHABLE_OR_REFUSED",
      rawOutput,
      exitCode,
    };
  }

  // 6. Non-zero exit without recognized connection failure
  if (exitCode !== 0) {
    return {
      type: "INFRASTRUCTURE_FAILURE",
      reason: `SHELL_EXIT_${exitCode}`,
      rawOutput,
      exitCode,
    };
  }

  // Default fallback for unknown response
  return {
    type: "INFRASTRUCTURE_FAILURE",
    reason: "UNKNOWN_INDETERMINATE_RESPONSE",
    rawOutput,
    exitCode,
  };
}

export function assertOnlineControl(apiClassification, extClassification) {
  if (apiClassification.type !== "REACHABLE_HTTP" || apiClassification.statusCode !== 200) {
    throw new Error(
      `Positive online control failed for API probe: expected HTTP 200, got ${apiClassification.type} (${apiClassification.reason})`,
    );
  }
  if (extClassification.type !== "REACHABLE_HTTP") {
    throw new Error(
      `Positive online control failed for External probe: expected reachable HTTP, got ${extClassification.type} (${extClassification.reason})`,
    );
  }
}

export function assertOfflineIsolation(apiClassification, extClassification) {
  if (apiClassification.type === "REACHABLE_HTTP" || extClassification.type === "REACHABLE_HTTP") {
    throw new Error(
      `Offline isolation failed: endpoints remain reachable! API: ${apiClassification.reason}, Ext: ${extClassification.reason}`,
    );
  }
  if (
    apiClassification.type === "INFRASTRUCTURE_FAILURE" ||
    extClassification.type === "INFRASTRUCTURE_FAILURE"
  ) {
    throw new Error(
      `Offline isolation failed: infrastructure/tool/ADB failure detected instead of genuine network cut! API: ${apiClassification.reason}, Ext: ${extClassification.reason}`,
    );
  }
  if (
    apiClassification.type !== "CONNECTION_FAILURE" ||
    extClassification.type !== "CONNECTION_FAILURE"
  ) {
    throw new Error(
      `Offline isolation failed: expected CONNECTION_FAILURE, got API: ${apiClassification.type}, Ext: ${extClassification.type}`,
    );
  }
}

export function assertRestoredNetwork(apiClassification, settingsMatch) {
  if (!settingsMatch) {
    throw new Error(
      "Settings restoration failed: device global settings do not match initial state.",
    );
  }
  if (apiClassification.type !== "REACHABLE_HTTP" || apiClassification.statusCode !== 200) {
    throw new Error(
      `Restoration reachability failed: API probe not restored to HTTP 200: got ${apiClassification.type} (${apiClassification.reason})`,
    );
  }
}

// CLI driver if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === "classify") {
      const exitCode = parseInt(args[1] || "0", 10);
      const raw = args[2] || "";
      const result = classifyProbeResult(raw, exitCode);
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    } else if (command === "assert-online") {
      const api = JSON.parse(args[1]);
      const ext = JSON.parse(args[2]);
      assertOnlineControl(api, ext);
      console.log("Online control verified.");
      process.exit(0);
    } else if (command === "assert-offline") {
      const api = JSON.parse(args[1]);
      const ext = JSON.parse(args[2]);
      assertOfflineIsolation(api, ext);
      console.log("Offline isolation verified.");
      process.exit(0);
    } else if (command === "assert-restored") {
      const api = JSON.parse(args[1]);
      const settingsMatch = args[2] === "true";
      assertRestoredNetwork(api, settingsMatch);
      console.log("Network restoration verified.");
      process.exit(0);
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Assertion error: ${err.message}`);
    process.exit(1);
  }
}
