import assert from "node:assert/strict";
import {
  assertOfflineIsolation,
  assertOnlineControl,
  assertRestoredNetwork,
  classifyProbeResult,
} from "./network-probe-classifier.mjs";

console.log("Running network-probe-classifier tests...");

// 1. Missing tool
{
  const res = classifyProbeResult("sh: nc: not found", 127);
  assert.equal(res.type, "INFRASTRUCTURE_FAILURE");
  assert.equal(res.reason, "MISSING_TOOL_OR_PERMISSION");
}

// 2. Inaccessible tool
{
  const res = classifyProbeResult("/system/bin/sh: nc: inaccessible or not found", 127);
  assert.equal(res.type, "INFRASTRUCTURE_FAILURE");
}

// 3. Toybox tool missing
{
  const res = classifyProbeResult("toybox: nc: not found", 1);
  assert.equal(res.type, "INFRASTRUCTURE_FAILURE");
}

// 4. ADB error
{
  const res = classifyProbeResult("error: device offline", 1);
  assert.equal(res.type, "INFRASTRUCTURE_FAILURE");
  assert.equal(res.reason, "ADB_DEVICE_FAILURE");
}

// 5. Indeterminate empty output
{
  const res = classifyProbeResult("", 0);
  assert.equal(res.type, "INFRASTRUCTURE_FAILURE");
  assert.equal(res.reason, "EMPTY_INDETERMINATE_OUTPUT");
}

// 6. Reachable HTTP responses
{
  const res = classifyProbeResult("HTTP/1.0 200 OK\r\nContent-Length: 12\r\n\r\n", 0);
  assert.equal(res.type, "REACHABLE_HTTP");
  assert.equal(res.statusCode, 200);
}

// 7. Connection refused
{
  const res = classifyProbeResult("nc: connect to 127.0.0.1 port 8088: Connection refused", 1);
  assert.equal(res.type, "CONNECTION_FAILURE");
  assert.equal(res.reason, "NETWORK_UNREACHABLE_OR_REFUSED");
}

// 8. Network unreachable
{
  const res = classifyProbeResult("connect: Network is unreachable", 1);
  assert.equal(res.type, "CONNECTION_FAILURE");
}

// 9. Operation timed out
{
  const res = classifyProbeResult("nc: connect to 10.0.2.2 port 80: Operation timed out", 1);
  assert.equal(res.type, "CONNECTION_FAILURE");
}

// 10. assertOnlineControl passes with HTTP 200 and reachable
{
  const api = classifyProbeResult("HTTP/1.0 200 OK\r\n", 0);
  const ext = classifyProbeResult("HTTP/1.1 200 OK\r\n", 0);
  assert.doesNotThrow(() => assertOnlineControl(api, ext));
}

// 11. assertOnlineControl throws if API not 200
{
  const api = classifyProbeResult("HTTP/1.0 500 Internal Server Error\r\n", 0);
  const ext = classifyProbeResult("HTTP/1.1 200 OK\r\n", 0);
  assert.throws(() => assertOnlineControl(api, ext), /Positive online control failed/);
}

// 12. assertOfflineIsolation passes on genuine connection failure
{
  const api = classifyProbeResult("Connection refused", 1);
  const ext = classifyProbeResult("Network is unreachable", 1);
  assert.doesNotThrow(() => assertOfflineIsolation(api, ext));
}

// 13. assertOfflineIsolation fails when reachable (ineffective cut)
{
  const api = classifyProbeResult("HTTP/1.0 200 OK", 0);
  const ext = classifyProbeResult("HTTP/1.1 200 OK", 0);
  assert.throws(() => assertOfflineIsolation(api, ext), /endpoints remain reachable/);
}

// 14. assertOfflineIsolation fails on missing tool (false offline prevented!)
{
  const api = classifyProbeResult("sh: nc: not found", 127);
  const ext = classifyProbeResult("sh: nc: not found", 127);
  assert.throws(() => assertOfflineIsolation(api, ext), /infrastructure\/tool\/ADB failure/);
}

// 15. assertRestoredNetwork passes when settings match and HTTP 200 restored
{
  const api = classifyProbeResult("HTTP/1.0 200 OK", 0);
  assert.doesNotThrow(() => assertRestoredNetwork(api, true));
}

// 16. assertRestoredNetwork throws on settings mismatch
{
  const api = classifyProbeResult("HTTP/1.0 200 OK", 0);
  assert.throws(() => assertRestoredNetwork(api, false), /Settings restoration failed/);
}

console.log("All 16 network-probe-classifier tests passed!");
