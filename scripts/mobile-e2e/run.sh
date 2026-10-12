#!/usr/bin/env bash
# ==============================================================================
# Ride Maker Mobile E2E Test Suite Runner
#
# Implements complete Sol Baseline Review Requirements:
# 1. Strict safety guard against personal/owner devices (R5CY52MQVCY).
# 2. Strict verification of dedicated emulator serial regex and AVD ('ride-maker-e2e').
# 3. Atomic run lock via mkdir without race deletion; no automatic stale deletion.
# 4. Refuse occupied port 8088 and pre-existing reverse proxy mappings.
# 5. Signal trap handling: guaranteed nonzero exit, teardown tested app tracking,
#    kill only owned processes and reverse proxy, generate interrupted manifest.
# 6. Source & build env fingerprinting (bootstrap.sh) with clean-tree-safe git check.
# 7. Real JSON encoding of raw fields via Node env (no bash string interpolation).
# 8. Scoped logcat filtered to Ride Maker process tags / PID.
# 9. Deterministic Maestro per-flow artifacts via --test-output-dir; assert checkpoints.
# 10. Synchronized native GPS feed via exact observable UI state.
# 11. Complete diagnostics verification (invariance check, dumpsys service/listener check).
# 12. Local GPX import, persistence, and error handling verification (flows 06, 07, 08).
# ==============================================================================

set -euo pipefail

# Ensure Node and NVM are in PATH if available
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Configuration
TEST_APP_ID="net.thg3.ridemaker.e2e"
CONSUMER_APP_ID="net.thg3.ridemaker"
EXPECTED_AVD="ride-maker-e2e"
PROTECTED_DEVICE_SERIAL="R5CY52MQVCY"
FIXTURE_PORT=8088
SERIAL=""
BUILD_APK=false
RUN_FAILURE_DEMO=false
RUN_GPS_FAILURE_DEMO=false
RUN_INEFFECTIVE_CUT_DEMO=false
VERIFY_CONSUMER=false

# Parse Arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "ERROR: --serial requires a non-empty device serial argument." >&2
        exit 1
      fi
      SERIAL="$2"
      shift 2
      ;;\
    --build-apk)
      BUILD_APK=true
      shift
      ;;
    --verify-consumer)
      VERIFY_CONSUMER=true
      shift
      ;;
    --demo-failure)
      RUN_FAILURE_DEMO=true
      shift
      ;;
    --demo-gps-failure)
      RUN_GPS_FAILURE_DEMO=true
      shift
      ;;
    --demo-ineffective-cut)
      RUN_INEFFECTIVE_CUT_DEMO=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 --serial <emulator-serial> [--build-apk] [--verify-consumer] [--demo-failure] [--demo-gps-failure] [--demo-ineffective-cut]" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------
# 1. Strict Safety & Device Verification
# ---------------------------------------------------------
if [[ -z "$SERIAL" ]]; then
  echo "ERROR: Target device serial must be explicitly specified via --serial." >&2
  echo "Refusing to pick a default target device to protect personal devices." >&2
  exit 1
fi

if [[ "$SERIAL" == "$PROTECTED_DEVICE_SERIAL" ]]; then
  echo "SAFETY VIOLATION: Target serial matches protected personal device ($PROTECTED_DEVICE_SERIAL)." >&2
  echo "E2E automated testing is strictly prohibited on this device." >&2
  exit 1
fi

if [[ ! "$SERIAL" =~ ^emulator-[0-9]+$ ]]; then
  echo "SAFETY VIOLATION: Target serial '$SERIAL' does not match '^emulator-[0-9]+$'." >&2
  exit 1
fi

# Detect ANDROID_HOME and tools
if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -d "$HOME/Library/Android/sdk" ]]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  elif [[ -d "$HOME/Android/Sdk" ]]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  fi
fi

if [[ -z "${ANDROID_HOME:-}" || ! -d "$ANDROID_HOME" ]]; then
  echo "ERROR: ANDROID_HOME is not set and could not be detected." >&2
  exit 1
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

ADB="$ANDROID_HOME/platform-tools/adb"
if [[ ! -x "$ADB" ]]; then
  echo "ERROR: adb not executable at $ADB." >&2
  exit 1
fi

AAPT_BIN=""
if compgen -G "$ANDROID_HOME/build-tools/*" > /dev/null; then
  for bdir in $(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V -r); do
    if [[ -x "$bdir/aapt" ]]; then
      AAPT_BIN="$bdir/aapt"
      break
    fi
  done
fi

if [[ -z "$AAPT_BIN" || ! -x "$AAPT_BIN" ]]; then
  echo "ERROR: aapt executable not found in $ANDROID_HOME/build-tools." >&2
  exit 1
fi

# Java Discovery
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d "/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home" ]]; then
    export JAVA_HOME="/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home"
  elif [[ -d "/usr/lib/jvm/java-17-openjdk-amd64" ]]; then
    export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
  fi
fi
if [[ -n "${JAVA_HOME:-}" ]]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# Maestro Discovery
MAESTRO=""
if command -v maestro >/dev/null 2>&1; then
  MAESTRO="$(command -v maestro)"
elif [[ -x "$HOME/.maestro/bin/maestro" ]]; then
  MAESTRO="$HOME/.maestro/bin/maestro"
fi

if [[ -z "$MAESTRO" ]]; then
  echo "ERROR: Maestro CLI not found. Please install maestro or add to PATH." >&2
  exit 1
fi

# Verify emulator is running and online
DEVICE_STATE="$("$ADB" devices | grep -E "^${SERIAL}[[:space:]]+" | awk '{print $2}' || true)"
if [[ "$DEVICE_STATE" != "device" ]]; then
  echo "ERROR: Target emulator '$SERIAL' is not online (state: '${DEVICE_STATE:-not found}')." >&2
  exit 1
fi

# Verify dedicated AVD name strictly (NO 'OK' bypass)
AVD_NAME="$("$ADB" -s "$SERIAL" emu avd name 2>/dev/null | tr -d '\r' | grep -v '^OK$' | grep -v '^$' | head -n 1 | tr -d ' ' || true)"
if [[ "$AVD_NAME" != "$EXPECTED_AVD" ]]; then
  ALT_AVD="$("$ADB" -s "$SERIAL" shell getprop ro.boot.qemu.avd_name 2>/dev/null | tr -d '\r\n ' || true)"
  if [[ "$ALT_AVD" != "$EXPECTED_AVD" ]]; then
    echo "SAFETY VIOLATION: Target '$SERIAL' running AVD '$AVD_NAME' (alt: '$ALT_AVD'), not expected '$EXPECTED_AVD'." >&2
    exit 1
  fi
  AVD_NAME="$ALT_AVD"
fi

echo "[Safety] Target verified: $SERIAL running dedicated AVD '$EXPECTED_AVD'."

# ---------------------------------------------------------
# 2. Atomic Run Lock (No race deletion, no automatic stale deletion)
# ---------------------------------------------------------
LOCK_DIR="${TMPDIR:-/tmp}/ride-maker-e2e-${SERIAL}.lock"
mkdir -p "$(dirname "$LOCK_DIR")"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  EXISTING_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "unknown")"
  echo "ERROR: E2E Run Lock exists at $LOCK_DIR (held by PID: $EXISTING_PID)." >&2
  if [[ "$EXISTING_PID" != "unknown" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "ERROR: Active runner process ($EXISTING_PID) is currently executing. Refusing to run." >&2
  else
    echo "ERROR: Lock appears stale but automatic deletion is disabled for safety. Please inspect and resolve." >&2
  fi
  exit 1
fi
echo "$$" > "$LOCK_DIR/pid"

# Track background processes for clean owned teardown
LOGCAT_PID=""
MAESTRO_PID=""
FIXTURE_SERVER_PID=""
GPS_FEEDER_PID=""
SUMMARY_WRITTEN=false
REVERSE_OWNED=false
TEST_APP_OWNED=false
CONSUMER_APP_OWNED=false
RUN_START_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EMU_FIXTURE_DIR="/sdcard/Download/ride-maker-fixtures"
FIXTURES_PUSHED=false
NETWORK_MODIFIED=false

# Capture initial network states for clean restoration
INITIAL_AIRPLANE_MODE="$("$ADB" -s "$SERIAL" shell settings get global airplane_mode_on 2>/dev/null | tr -d "\r\n " || echo "0")"
INITIAL_WIFI_STATE="$("$ADB" -s "$SERIAL" shell settings get global wifi_on 2>/dev/null | tr -d "\r\n " || echo "1")"
INITIAL_DATA_STATE="$("$ADB" -s "$SERIAL" shell settings get global mobile_data 2>/dev/null | tr -d "\r\n " || echo "1")"

verify_nc_available() {
  local nc_check
  nc_check="$("$ADB" -s "$SERIAL" shell "which nc 2>&1 || nc -h 2>&1" | tr -d "\r" || true)"
  if [[ -z "$nc_check" ]] || echo "$nc_check" | grep -qiE "not found|inaccessible|permission denied"; then
    echo "ERROR: nc (netcat) is not available or working on device ($SERIAL). Cannot reliably probe network." >&2
    exit 1
  fi
}

probe_endpoint() {
  local host="$1"
  local port="$2"
  local req_path="$3"
  local raw=""
  local exit_code=0
  raw="$("$ADB" -s "$SERIAL" shell "(echo -e \"GET ${req_path} HTTP/1.0\\r\\nHost: ${host}\\r\\n\\r\\n\"; sleep 1) | nc -w 2 ${host} ${port} 2>&1" | tr -d "\r")" || exit_code=$?
  node "$SCRIPT_DIR/network-probe-classifier.mjs" classify "$exit_code" "$raw"
}

write_network_probes_json() {
  local online_api="${1:-unknown}"
  local online_ext="${2:-unknown}"
  local offline_api="${3:-unknown}"
  local offline_ext="${4:-unknown}"
  local offline_ping="${5:-unknown}"
  local restored_api="${6:-unknown}"
  local restored_ext="${7:-unknown}"
  local restored_ping="${8:-unknown}"

  node -e '
    const fs = require("fs");
    const safeParse = (str) => {
      try { return JSON.parse(str); } catch { return { raw: str }; }
    };
    const data = {
      recordedAt: new Date().toISOString(),
      onlineControl: {
        api: safeParse(process.argv[1]),
        external: safeParse(process.argv[2])
      },
      offlineCut: {
        api: safeParse(process.argv[3]),
        external: safeParse(process.argv[4]),
        ping: process.argv[5],
        isolated: safeParse(process.argv[3]).type === "CONNECTION_FAILURE" && safeParse(process.argv[4]).type === "CONNECTION_FAILURE"
      },
      restored: {
        api: safeParse(process.argv[6]),
        external: safeParse(process.argv[7]),
        ping: process.argv[8],
        restored: safeParse(process.argv[6]).type === "REACHABLE_HTTP" && safeParse(process.argv[6]).statusCode === 200
      }
    };
    fs.writeFileSync(process.argv[9], JSON.stringify(data, null, 2));
  ' "$online_api" "$online_ext" "$offline_api" "$offline_ext" "$offline_ping" "$restored_api" "$restored_ext" "$restored_ping" "$ARTIFACTS_DIR/network-probe-results.json"
}

cut_network() {
  echo "[Network] Establishing positive online API/external control before network cut..."
  verify_nc_available

  local online_probe_log="$ARTIFACTS_DIR/network-probe-online.log"
  echo "--- Network Probe (Online Control) ---" > "$online_probe_log"
  local api_online
  api_online="$(probe_endpoint "127.0.0.1" "${FIXTURE_PORT}" "/api/health")"
  echo "API Online Probe: $api_online" >> "$online_probe_log"
  local ext_online
  ext_online="$(probe_endpoint "tiles.openfreemap.org" "80" "/")"
  echo "External Online Probe: $ext_online" >> "$online_probe_log"
  echo "[Network Probe Online Control] API: $(echo "$api_online" | tr "\n" " " | cut -c1-60) | Ext: $(echo "$ext_online" | tr "\n" " " | cut -c1-60)"

  # Assert positive online control: API must be HTTP 200, Ext must be reachable HTTP
  if ! node "$SCRIPT_DIR/network-probe-classifier.mjs" assert-online "$api_online" "$ext_online"; then
    echo "ERROR: Positive online controls failed before network cut. Blocking non-zero." >&2
    exit 1
  fi

  if [[ "$RUN_INEFFECTIVE_CUT_DEMO" == "true" ]]; then
    echo "[Network Demo] Simulating deliberate ineffective network cut (network cut bypassed)..." >&2
  else
    echo "[Network] Cutting connectivity (airplane mode, wifi disabled, data disabled, remove reverse mapping)..."
    NETWORK_MODIFIED=true
    if [[ "$REVERSE_OWNED" == "true" ]]; then
      "$ADB" -s "$SERIAL" reverse --remove "tcp:$FIXTURE_PORT" 2>/dev/null || true
    fi
    "$ADB" -s "$SERIAL" shell "cmd connectivity airplane-mode enable" 2>/dev/null || true
    "$ADB" -s "$SERIAL" shell "svc wifi disable" 2>/dev/null || true
    "$ADB" -s "$SERIAL" shell "svc data disable" 2>/dev/null || true
    sleep 2
  fi

  local probe_log="$ARTIFACTS_DIR/network-probe-offline.log"
  echo "--- Network Probe (Offline) ---" > "$probe_log"
  local api_res
  api_res="$(probe_endpoint "127.0.0.1" "${FIXTURE_PORT}" "/api/health")"
  echo "API Probe: $api_res" >> "$probe_log"
  local ext_res
  ext_res="$(probe_endpoint "tiles.openfreemap.org" "80" "/")"
  echo "External Probe: $ext_res" >> "$probe_log"
  local ping_res
  ping_res="$("$ADB" -s "$SERIAL" shell "ping -c 1 -W 2 8.8.8.8 2>&1" || echo "PING_FAILED")"
  echo "Ping Probe: $(echo "$ping_res" | tr "\n" " " | cut -c1-60)" >> "$probe_log"
  echo "[Network Probe Offline] API: $(echo "$api_res" | tr "\n" " " | cut -c1-60) | Ext: $(echo "$ext_res" | tr "\n" " " | cut -c1-60)"

  write_network_probes_json "$api_online" "$ext_online" "$api_res" "$ext_res" "$ping_res" "{}" "{}" "pending"

  # Isolation assertion: fail if endpoints remain reachable or if infra failure occurred
  if ! node "$SCRIPT_DIR/network-probe-classifier.mjs" assert-offline "$api_res" "$ext_res"; then
    echo "ERROR: Network cut ineffective or infrastructure failure detected." >&2
    exit 1
  fi

  export MANIFEST_PROBE_OFFLINE="confirmed_offline"
}

restore_network() {
  if [[ "$NETWORK_MODIFIED" != "true" ]]; then
    return 0
  fi
  echo "[Network] Restoring connectivity to initial state..."
  if [[ "$INITIAL_AIRPLANE_MODE" == "0" ]]; then
    "$ADB" -s "$SERIAL" shell "cmd connectivity airplane-mode disable" 2>/dev/null || true
  else
    "$ADB" -s "$SERIAL" shell "cmd connectivity airplane-mode enable" 2>/dev/null || true
  fi
  if [[ "$INITIAL_WIFI_STATE" == "1" ]]; then
    "$ADB" -s "$SERIAL" shell "svc wifi enable" 2>/dev/null || true
  else
    "$ADB" -s "$SERIAL" shell "svc wifi disable" 2>/dev/null || true
  fi
  if [[ "$INITIAL_DATA_STATE" == "1" ]]; then
    "$ADB" -s "$SERIAL" shell "svc data enable" 2>/dev/null || true
  else
    "$ADB" -s "$SERIAL" shell "svc data disable" 2>/dev/null || true
  fi

  if [[ "$REVERSE_OWNED" == "true" ]]; then
    "$ADB" -s "$SERIAL" reverse "tcp:$FIXTURE_PORT" "tcp:$FIXTURE_PORT" 2>/dev/null || true
  fi
  sleep 2

  local curr_airplane
  curr_airplane="$("$ADB" -s "$SERIAL" shell settings get global airplane_mode_on 2>/dev/null | tr -d "\r\n " || echo "unknown")"
  local curr_wifi
  curr_wifi="$("$ADB" -s "$SERIAL" shell settings get global wifi_on 2>/dev/null | tr -d "\r\n " || echo "unknown")"
  local curr_data
  curr_data="$("$ADB" -s "$SERIAL" shell settings get global mobile_data 2>/dev/null | tr -d "\r\n " || echo "unknown")"

  local settings_match="true"
  if [[ "$curr_airplane" != "$INITIAL_AIRPLANE_MODE" ]] || [[ "$curr_wifi" != "$INITIAL_WIFI_STATE" ]] || [[ "$curr_data" != "$INITIAL_DATA_STATE" ]]; then
    echo "ERROR: Restored settings mismatch: airplane=$curr_airplane (init $INITIAL_AIRPLANE_MODE), wifi=$curr_wifi (init $INITIAL_WIFI_STATE), data=$curr_data (init $INITIAL_DATA_STATE)" >&2
    settings_match="false"
  fi

  local probe_log="$ARTIFACTS_DIR/network-probe-restored.log"
  echo "--- Network Probe (Restored) ---" > "$probe_log"
  local api_res
  api_res="$(probe_endpoint "127.0.0.1" "${FIXTURE_PORT}" "/api/health")"
  echo "API Probe: $api_res" >> "$probe_log"
  local ext_res
  ext_res="$(probe_endpoint "tiles.openfreemap.org" "80" "/")"
  echo "External Probe: $ext_res" >> "$probe_log"
  local ping_res
  ping_res="$("$ADB" -s "$SERIAL" shell "ping -c 1 -W 2 8.8.8.8 2>&1" || echo "PING_FAILED")"
  echo "Ping Probe: $(echo "$ping_res" | tr "\n" " " | cut -c1-60)" >> "$probe_log"
  echo "[Network Probe Restored] API: $(echo "$api_res" | tr "\n" " " | cut -c1-60) | Ext: $(echo "$ext_res" | tr "\n" " " | cut -c1-60)"

  local prev_api_online="{}"
  local prev_ext_online="{}"
  local prev_api_off="{}"
  local prev_ext_off="{}"
  local prev_ping_off="unknown"
  if [[ -f "$ARTIFACTS_DIR/network-probe-results.json" ]]; then
    prev_api_online="$(node -e 'try{console.log(JSON.stringify(require(process.argv[1]).onlineControl.api))}catch{}' "$ARTIFACTS_DIR/network-probe-results.json")"
    prev_ext_online="$(node -e 'try{console.log(JSON.stringify(require(process.argv[1]).onlineControl.external))}catch{}' "$ARTIFACTS_DIR/network-probe-results.json")"
    prev_api_off="$(node -e 'try{console.log(JSON.stringify(require(process.argv[1]).offlineCut.api))}catch{}' "$ARTIFACTS_DIR/network-probe-results.json")"
    prev_ext_off="$(node -e 'try{console.log(JSON.stringify(require(process.argv[1]).offlineCut.external))}catch{}' "$ARTIFACTS_DIR/network-probe-results.json")"
    prev_ping_off="$(node -e 'try{console.log(require(process.argv[1]).offlineCut.ping)}catch{}' "$ARTIFACTS_DIR/network-probe-results.json")"
  fi
  write_network_probes_json "$prev_api_online" "$prev_ext_online" "$prev_api_off" "$prev_ext_off" "$prev_ping_off" "$api_res" "$ext_res" "$ping_res"

  if ! node "$SCRIPT_DIR/network-probe-classifier.mjs" assert-restored "$api_res" "$settings_match"; then
    echo "ERROR: Network restoration verification failed." >&2
    return 1
  fi

  export MANIFEST_PROBE_RESTORED="confirmed_restored"
  NETWORK_MODIFIED=false
}

capture_storage_observation() {
  local tag="$1"
  local output="$2"
  local observation_pid
  observation_pid="$("$ADB" -s "$SERIAL" shell pidof -s "$TEST_APP_ID" | tr -d '\r\n ')"
  if [[ ! "$observation_pid" =~ ^[0-9]+$ ]]; then
    echo "ERROR: No current app process for storage observation." >&2
    return 1
  fi
  "$ADB" -s "$SERIAL" shell am start -W -a android.intent.action.VIEW -d "ridemaker://observe-storage?tag=$tag" "$TEST_APP_ID" > "${output%.log}-intent.log"
  for attempt in {1..120}; do
    "$ADB" -s "$SERIAL" logcat -d --pid="$observation_pid" -v time > "$output"
    if grep -Fq "[E2E_STORAGE_OBSERVE_ERROR] tag=\"$tag\"" "$output"; then
      echo "ERROR: App storage observation failed; see $output." >&2
      return 1
    fi
    if grep -Fq "[E2E_STORAGE_OBSERVE_END] tag=\"$tag\"" "$output"; then
      return 0
    fi
    sleep 0.25
  done
  echo "ERROR: Storage observation timed out; see $output." >&2
  return 1
}

verify_native_persistence() {
  local flow_out_dir="$1"
  echo "Verifying native route storage and GPX fidelity on device via test observation..."
  local persist_res_file="$ARTIFACTS_DIR/persistence-verification.json"
  local before_log="$flow_out_dir/storage-observe-before.log"
  local after_log="$flow_out_dir/storage-observe-after.log"

  if [[ ! -f "$before_log" ]] || [[ ! -f "$after_log" ]]; then
    echo "ERROR: Storage observation log files missing: before='$before_log', after='$after_log'" >&2
    exit 1
  fi

  if ! node "$SCRIPT_DIR/verify-persistence.mjs" \
    --before "$before_log" \
    --after "$after_log" \
    --fixtures-dir "$REPO_ROOT/apps/mobile/e2e/fixtures" \
    --output "$persist_res_file"; then
    echo "ERROR: Native persistence verification failed." >&2
    exit 1
  fi

  cp "$persist_res_file" "$flow_out_dir/persistence-verification.json" 2>/dev/null || true
  echo "Native persistence verification successfully passed."
}

check_fixture_collision() {
  local existing
  existing="$("$ADB" -s "$SERIAL" shell "ls -d $EMU_FIXTURE_DIR 2>/dev/null" | tr -d "\r\n " || true)"
  if [[ -n "$existing" ]]; then
    echo "ERROR: Fixture directory $EMU_FIXTURE_DIR already exists on device. Refusing collision." >&2
    exit 1
  fi
}

RUN_ID="run-$(date +%Y%m%d-%H%M%S)"
if [[ "$RUN_FAILURE_DEMO" == "true" ]]; then
  RUN_ID="${RUN_ID}-failure-demo"
elif [[ "$RUN_GPS_FAILURE_DEMO" == "true" ]]; then
  RUN_ID="${RUN_ID}-gps-failure-demo"
elif [[ "$RUN_INEFFECTIVE_CUT_DEMO" == "true" ]]; then
  RUN_ID="${RUN_ID}-ineffective-cut-demo"
elif [[ "$VERIFY_CONSUMER" == "true" ]]; then
  RUN_ID="${RUN_ID}-consumer-verify"
fi
ARTIFACTS_DIR="$REPO_ROOT/.artifacts/mobile-e2e/$RUN_ID"
mkdir -p "$ARTIFACTS_DIR/screenshots" "$ARTIFACTS_DIR/flows"

cleanup() {
  local exit_code=$?
  trap - INT TERM HUP EXIT

  echo ""
  echo "[Cleanup] Performing test environment cleanup..."

  if [[ -n "$MAESTRO_PID" ]] && kill -0 "$MAESTRO_PID" 2>/dev/null; then
    kill "$MAESTRO_PID" 2>/dev/null || true
    wait "$MAESTRO_PID" 2>/dev/null || true
  fi

  # Stop test application background tracking
  if [[ "$TEST_APP_OWNED" == "true" ]]; then
    "$ADB" -s "$SERIAL" shell am force-stop "$TEST_APP_ID" 2>/dev/null || true
  fi
  if [[ "$CONSUMER_APP_OWNED" == "true" ]]; then
    "$ADB" -s "$SERIAL" shell am force-stop "$CONSUMER_APP_ID" 2>/dev/null || true
  fi

  # Restore connectivity to initial state
  if ! restore_network; then
    echo "ERROR: Network restoration failed during cleanup." >&2
    if [[ $exit_code -eq 0 ]]; then
      exit_code=1
    fi
  fi

  # Delete owned fixtures directory ONLY
  if [[ "$FIXTURES_PUSHED" == "true" ]]; then
    "$ADB" -s "$SERIAL" shell "rm -rf $EMU_FIXTURE_DIR" 2>/dev/null || true
  fi

  # Kill owned background processes
  if [[ -n "$GPS_FEEDER_PID" ]] && kill -0 "$GPS_FEEDER_PID" 2>/dev/null; then
    kill -9 "$GPS_FEEDER_PID" 2>/dev/null || true
  fi
  if [[ -n "$LOGCAT_PID" ]] && kill -0 "$LOGCAT_PID" 2>/dev/null; then
    kill "$LOGCAT_PID" 2>/dev/null || true
  fi
  if [[ -n "$FIXTURE_SERVER_PID" ]] && kill -0 "$FIXTURE_SERVER_PID" 2>/dev/null; then
    kill "$FIXTURE_SERVER_PID" 2>/dev/null || true
  fi

  # Remove owned ADB reverse port mapping
  if [[ "$REVERSE_OWNED" == "true" ]]; then
    "$ADB" -s "$SERIAL" reverse --remove "tcp:$FIXTURE_PORT" 2>/dev/null || true
  fi

  # Write interrupted summary manifest if exiting unexpectedly
  if [[ "$SUMMARY_WRITTEN" != "true" ]]; then
    local status="interrupted"
    if [[ $exit_code -ne 0 ]]; then
      status="blocked"
    fi
    export MANIFEST_RUN_ID="$RUN_ID"
    export MANIFEST_STATUS="$status"
    export MANIFEST_STARTED_AT="$RUN_START_TIME"
    export MANIFEST_FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    export MANIFEST_SOURCE_FINGERPRINT="${SOURCE_FP:-unknown}"
    export MANIFEST_APK_HASH="${APK_SHA256:-unknown}"
    export MANIFEST_PASSED_FLOWS=""
    export MANIFEST_FAILED_FLOWS=""
    export MANIFEST_CHECKPOINTS=""
    [[ $exit_code -ge 128 ]] && status="interrupted"
    export MANIFEST_STATUS="$status" MANIFEST_EXIT_CODE="$exit_code"
    export MANIFEST_REASON="Process terminated prematurely (exit code $exit_code)"
    node "$SCRIPT_DIR/generate-manifests.mjs" metadata "$ARTIFACTS_DIR/metadata.json" >/dev/null 2>&1 || true
    node "$SCRIPT_DIR/generate-manifests.mjs" summary "$ARTIFACTS_DIR/summary.json" >/dev/null 2>&1 || true
  fi

  # Remove lock directory ONLY if owned by current PID
  if [[ -f "$LOCK_DIR/pid" ]] && [[ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" == "$$" ]]; then
    rm -rf "$LOCK_DIR" 2>/dev/null || true
  fi

  if [[ $exit_code -ne 0 ]]; then
    echo "[Cleanup] Exiting with failure status code $exit_code."
    exit "$exit_code"
  fi
}

handle_signal() {
  local sig="$1"
  echo "[Signal] Caught signal $sig, exiting..." >&2
  exit $((128 + sig))
}
trap 'handle_signal 2' INT
trap 'handle_signal 15' TERM
trap 'handle_signal 1' HUP
trap cleanup EXIT

# ---------------------------------------------------------
# 3. Port & Reverse Conflict Checks
# ---------------------------------------------------------
if lsof -i :$FIXTURE_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  OCCUPIED_PID="$(lsof -i :$FIXTURE_PORT -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true)"
  echo "ERROR: Fixture port $FIXTURE_PORT is already occupied by process $OCCUPIED_PID. Refusing to run." >&2
  exit 1
fi

EXISTING_REVERSE="$("$ADB" -s "$SERIAL" reverse --list 2>/dev/null || true)"
if echo "$EXISTING_REVERSE" | grep -q "tcp:$FIXTURE_PORT"; then
  echo "ERROR: Pre-existing reverse mapping for tcp:$FIXTURE_PORT found on $SERIAL: $EXISTING_REVERSE. Refusing to run." >&2
  exit 1
fi

# ---------------------------------------------------------
# 4. Source Fingerprint & Build Verification
# ---------------------------------------------------------
TARGET_VARIANT="test"
if [[ "$VERIFY_CONSUMER" == "true" ]]; then
  TARGET_VARIANT="consumer"
fi

echo "[Build] Computing $TARGET_VARIANT variant source and build env fingerprint..."
SOURCE_FP="$(node "$SCRIPT_DIR/fingerprint.mjs" "$TARGET_VARIANT")"
echo "Current Source Fingerprint: $SOURCE_FP"

TARGET_APK="$REPO_ROOT/.artifacts/mobile-e2e/builds/app-${TARGET_VARIANT}-release.apk"
FP_FILE="$TARGET_APK.fingerprint.json"
APK_REBUILD_NEEDED=false

if [[ "$BUILD_APK" == "true" ]]; then
  echo "[Build] APK build explicitly requested via --build-apk."
  APK_REBUILD_NEEDED=true
elif [[ ! -f "$TARGET_APK" ]]; then
  echo "[Build] APK not found at $TARGET_APK."
  APK_REBUILD_NEEDED=true
elif [[ ! -f "$FP_FILE" ]]; then
  echo "[Build] Fingerprint record missing at $FP_FILE."
  APK_REBUILD_NEEDED=true
elif ! grep -q "\"fingerprint\": \"$SOURCE_FP\"" "$FP_FILE"; then
  echo "[Build] Recorded APK fingerprint does not match current source fingerprint."
  APK_REBUILD_NEEDED=true
fi

if [[ "$APK_REBUILD_NEEDED" == "true" ]]; then
  echo "[Build] Invoking bootstrap.sh for variant '$TARGET_VARIANT'..."
  "$SCRIPT_DIR/bootstrap.sh" --variant "$TARGET_VARIANT"
fi

if [[ ! -f "$TARGET_APK" ]]; then
  echo "ERROR: Release APK not found at $TARGET_APK after build." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  APK_SHA256="$(sha256sum "$TARGET_APK" | awk '{print $1}')"
else
  APK_SHA256="$(shasum -a 256 "$TARGET_APK" | awk '{print $1}')"
fi
APK_SIZE="$(stat -f%z "$TARGET_APK" 2>/dev/null || stat -c%s "$TARGET_APK" 2>/dev/null || echo 0)"
node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1])); if(r.apkSha256!==process.argv[2] || r.fingerprint!==process.argv[3]) throw Error("APK hash/source differs from build record; rebuild with --build-apk");' "$FP_FILE" "$APK_SHA256" "$SOURCE_FP"

# Strict AAPT verification - FAIL on unknown/missing
ACTUAL_PKG="$("$AAPT_BIN" dump badging "$TARGET_APK" 2>/dev/null | sed -n "s/package: name='\([^']*\)'.*/\1/p" || true)"
if [[ -z "$ACTUAL_PKG" ]]; then
  echo "ERROR: aapt failed to extract package name from $TARGET_APK." >&2
  exit 1
fi

HAS_CLEARTEXT="$(node "$SCRIPT_DIR/inspect-apk.mjs" "$AAPT_BIN" "$TARGET_APK")"

echo "[APK] Path:      $TARGET_APK"
echo "[APK] Size:      $APK_SIZE bytes"
echo "[APK] SHA-256:   $APK_SHA256"
echo "[APK] Package:   $ACTUAL_PKG"
echo "[APK] Cleartext: $HAS_CLEARTEXT"

EXPECTED_PKG="$TEST_APP_ID"
EXPECTED_CLEARTEXT="true"
if [[ "$TARGET_VARIANT" == "consumer" ]]; then
  EXPECTED_PKG="$CONSUMER_APP_ID"
  EXPECTED_CLEARTEXT="false"
fi

if [[ "$ACTUAL_PKG" != "$EXPECTED_PKG" ]]; then
  echo "ERROR: APK package name is '$ACTUAL_PKG', expected '$EXPECTED_PKG'." >&2
  exit 1
fi
if [[ "$HAS_CLEARTEXT" != "$EXPECTED_CLEARTEXT" ]]; then
  echo "ERROR: APK usesCleartextTraffic is $HAS_CLEARTEXT, expected $EXPECTED_CLEARTEXT." >&2
  exit 1
fi

# ---------------------------------------------------------
# 5. Local Loopback Fixture Server & Port Forwarding
# ---------------------------------------------------------
if [[ "$VERIFY_CONSUMER" != "true" ]]; then
echo "[FixtureServer] Starting fixture server strictly bound to 127.0.0.1:$FIXTURE_PORT..."
FIXTURE_SERVER_PORT="$FIXTURE_PORT" node "$SCRIPT_DIR/fixture-server.mjs" > "$ARTIFACTS_DIR/fixture-server.log" 2>&1 &
FIXTURE_SERVER_PID=$!

sleep 1
if ! kill -0 "$FIXTURE_SERVER_PID" 2>/dev/null; then
  echo "ERROR: Fixture server failed to start. Log output:" >&2
  cat "$ARTIFACTS_DIR/fixture-server.log" >&2
  exit 1
fi

echo "[FixtureServer] Reverse forwarding tcp:$FIXTURE_PORT -> tcp:$FIXTURE_PORT on $SERIAL..."
"$ADB" -s "$SERIAL" reverse "tcp:$FIXTURE_PORT" "tcp:$FIXTURE_PORT"
REVERSE_OWNED=true
fi

# ---------------------------------------------------------
# 6. Install Tested APK & Record Structured Metadata
# ---------------------------------------------------------
echo "[Install] Installing $TARGET_APK onto $SERIAL..."
"$ADB" -s "$SERIAL" install -r "$TARGET_APK"
if [[ "$VERIFY_CONSUMER" == "true" ]]; then
  CONSUMER_APP_OWNED=true
else
  TEST_APP_OWNED=true
fi

COMMIT_HASH="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"
BRANCH_NAME="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
DIRTY_COUNT="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
DIRTY_FLAG="$([[ "$DIRTY_COUNT" -gt 0 ]] && echo "true" || echo "false")"

MAESTRO_VERSION="$("$MAESTRO" --version 2>/dev/null || echo "unknown")"
JAVA_VERSION="$(java -version 2>&1 | head -n 1 || echo "unknown")"
NODE_VERSION="$(node -v 2>/dev/null || echo "unknown")"
DEVICE_MODEL="$("$ADB" -s "$SERIAL" shell getprop ro.product.model 2>/dev/null | tr -d '\r\n')"
DEVICE_BUILD="$("$ADB" -s "$SERIAL" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r\n')"

export MANIFEST_RUN_ID="$RUN_ID"
export MANIFEST_STARTED_AT="$RUN_START_TIME"
export MANIFEST_DEVICE_SERIAL="$SERIAL"
export MANIFEST_DEVICE_MODEL="$DEVICE_MODEL"
export MANIFEST_DEVICE_AVD="$AVD_NAME"
export MANIFEST_DEVICE_OS="Android $DEVICE_BUILD"
export MANIFEST_GIT_COMMIT="$COMMIT_HASH"
export MANIFEST_GIT_BRANCH="$BRANCH_NAME"
export MANIFEST_GIT_DIRTY="$DIRTY_FLAG"
export MANIFEST_APK_VARIANT="$TARGET_VARIANT"
export MANIFEST_APK_PATH="$TARGET_APK"
export MANIFEST_APK_HASH="$APK_SHA256"
export MANIFEST_APK_SIZE="$APK_SIZE"
export MANIFEST_APK_PACKAGE="$ACTUAL_PKG"
export MANIFEST_APK_CLEARTEXT="$HAS_CLEARTEXT"
export MANIFEST_SOURCE_FINGERPRINT="$SOURCE_FP"
export MANIFEST_HARNESS_FINGERPRINT="$(node "$SCRIPT_DIR/fingerprint.mjs" harness)"
export MANIFEST_FIXTURE_PORT="$FIXTURE_PORT"
export MANIFEST_API_BASE_URL="http://127.0.0.1:${FIXTURE_PORT}/api"
export MANIFEST_CMD_BUILD="scripts/mobile-e2e/bootstrap.sh --variant $TARGET_VARIANT"
export MANIFEST_CMD_INSTALL="$ADB -s $SERIAL install -r $TARGET_APK"
export MANIFEST_CMD_REVERSE="$ADB -s $SERIAL reverse tcp:$FIXTURE_PORT tcp:$FIXTURE_PORT"
export MANIFEST_CMD_MAESTRO="$MAESTRO --device $SERIAL test <flow>"
export MANIFEST_JAVA_VERSION="$JAVA_VERSION"
export MANIFEST_NODE_VERSION="$NODE_VERSION"
export MANIFEST_MAESTRO_VERSION="$MAESTRO_VERSION"

if [[ "$VERIFY_CONSUMER" == "true" ]]; then
  export MANIFEST_API_BASE_URL="https://ridemaker.thg3.net/api"
  export MANIFEST_CMD_REVERSE="none"
fi
node "$SCRIPT_DIR/generate-manifests.mjs" metadata "$ARTIFACTS_DIR/metadata.json"

if [[ "$VERIFY_CONSUMER" == "true" ]]; then
  "$MAESTRO" --device "$SERIAL" test --test-output-dir "$ARTIFACTS_DIR/flows/consumer" "$REPO_ROOT/apps/mobile/e2e/flows/consumer-standalone.yaml" > "$ARTIFACTS_DIR/consumer.log" 2>&1 &
  MAESTRO_PID=$!
  wait "$MAESTRO_PID"
  MAESTRO_PID=""
  find "$ARTIFACTS_DIR/flows/consumer" -type f -name '*.png' -exec cp {} "$ARTIFACTS_DIR/screenshots/" \;
  test -s "$ARTIFACTS_DIR/screenshots/consumer-standalone-main.png"
  export MANIFEST_STATUS=passed MANIFEST_PASSED_FLOWS=consumer-standalone MANIFEST_FAILED_FLOWS="" MANIFEST_CHECKPOINTS=consumer-standalone-main.png
  export MANIFEST_FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  node "$SCRIPT_DIR/generate-manifests.mjs" summary "$ARTIFACTS_DIR/summary.json"
  SUMMARY_WRITTEN=true
  echo "Consumer standalone verification PASSED: $RUN_ID"
  exit 0
fi

# Pre-grant standard permissions helper
grant_all_permissions() {
  "$ADB" -s "$SERIAL" shell pm grant "$TEST_APP_ID" android.permission.ACCESS_FINE_LOCATION 2>/dev/null || true
  "$ADB" -s "$SERIAL" shell pm grant "$TEST_APP_ID" android.permission.ACCESS_COARSE_LOCATION 2>/dev/null || true
  "$ADB" -s "$SERIAL" shell pm grant "$TEST_APP_ID" android.permission.ACCESS_BACKGROUND_LOCATION 2>/dev/null || true
  "$ADB" -s "$SERIAL" shell pm grant "$TEST_APP_ID" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
}

revoke_all_permissions() {
  "$ADB" -s "$SERIAL" shell pm revoke "$TEST_APP_ID" android.permission.ACCESS_BACKGROUND_LOCATION 2>/dev/null || true
  "$ADB" -s "$SERIAL" shell pm revoke "$TEST_APP_ID" android.permission.ACCESS_FINE_LOCATION 2>/dev/null || true
  "$ADB" -s "$SERIAL" shell pm revoke "$TEST_APP_ID" android.permission.ACCESS_COARSE_LOCATION 2>/dev/null || true
  "$ADB" -s "$SERIAL" shell pm revoke "$TEST_APP_ID" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
}

push_gpx_fixtures() {
  echo "Setting up GPX test fixtures on emulator in owned directory $EMU_FIXTURE_DIR..."
  "$ADB" -s "$SERIAL" shell "mkdir -p $EMU_FIXTURE_DIR"
  FIXTURES_PUSHED=true

  local gen_dir="$ARTIFACTS_DIR/generated-fixtures"
  mkdir -p "$gen_dir"
  local gen_oversized="$gen_dir/malformed-oversized.gpx"
  if [[ ! -f "$gen_oversized" ]]; then
    node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], "x".repeat(10.5 * 1024 * 1024));' "$gen_oversized"
  fi
  export MANIFEST_OVERSIZED_FIXTURE_PATH="$gen_oversized"

  for fix_file in "$REPO_ROOT/apps/mobile/e2e/fixtures"/* "$gen_oversized"; do
    if [[ -f "$fix_file" ]]; then
      local base_name="$(basename "$fix_file")"
      "$ADB" -s "$SERIAL" push "$fix_file" "$EMU_FIXTURE_DIR/$base_name" >/dev/null 2>&1
      "$ADB" -s "$SERIAL" shell "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://$EMU_FIXTURE_DIR/$base_name" >/dev/null 2>&1
    fi
  done
}

# ---------------------------------------------------------
# 7. Execute Test Flows with Explicit Artifact Directories
# ---------------------------------------------------------
FLOWS_DIR="$REPO_ROOT/apps/mobile/e2e/flows"
FAILED_FLOWS=()
PASSED_FLOWS=()
COLLECTED_CHECKPOINTS=()

run_flow() {
  local flow_file="$1"
  local flow_name="$(basename "$flow_file" .yaml)"
  local flow_out_dir="$ARTIFACTS_DIR/flows/$flow_name"
  local log_file="$ARTIFACTS_DIR/${flow_name}.log"

  mkdir -p "$flow_out_dir"
  echo ""
  echo ">>> Running flow: $flow_name"

  # Reset process and data state cleanly for test isolation (except persistence flow 07)
  if [[ "$flow_name" != "07-gpx-persistence-and-offline" ]]; then
    "$ADB" -s "$SERIAL" shell pm clear "$TEST_APP_ID" >/dev/null 2>&1 || true
    sleep 1
  fi

  # Handle special permission conditions for flow 04a
  if [[ "$flow_name" == *"04a-diagnostics-permission-denied"* ]]; then
    revoke_all_permissions
  else
    grant_all_permissions
  fi

  # Prepare persistence & offline test state for flow 07
  if [[ "$flow_name" == "07-gpx-persistence-and-offline" ]]; then
    echo "Preparing self-contained persistence & offline test..."
    # 1. Clean app state and grant permissions
    "$ADB" -s "$SERIAL" shell pm clear "$TEST_APP_ID" >/dev/null 2>&1 || true
    grant_all_permissions
    sleep 1

    # 2. Push fixtures to owned directory
    push_gpx_fixtures

    # 3. Launch app online and seed routes
    echo "Seeding routes into app storage..."
    "$ADB" -s "$SERIAL" shell am start -n "$TEST_APP_ID/.MainActivity" > "$flow_out_dir/seed-launch.log"
    sleep 2
    local seed_flow="$REPO_ROOT/apps/mobile/e2e/flows/07-seed-persistence.yaml"
    set +e
    "$MAESTRO" --device "$SERIAL" test --test-output-dir "$flow_out_dir/seed" "$seed_flow" > "$flow_out_dir/seed.log" 2>&1 &
    MAESTRO_PID=$!
    wait "$MAESTRO_PID"
    local seed_status=$?
    MAESTRO_PID=""
    set -e
    if [[ $seed_status -ne 0 ]]; then
      echo "ERROR: Seed flow failed with exit code $seed_status." >&2
      exit "$seed_status"
    fi

    # Trigger test observation before source removal & restart
    echo "Triggering test storage observation (before)..."
    capture_storage_observation "before" "$flow_out_dir/storage-observe-before.log"

    # 4. Remove owned source fixtures from emulator Download directory
    echo "Removing owned source fixtures from $EMU_FIXTURE_DIR..."
    "$ADB" -s "$SERIAL" shell "rm -rf $EMU_FIXTURE_DIR/*"

    # 5. Cut all network connectivity and verify offline via probes
    cut_network

    # 6. Force-stop the app process
    echo "Force-stopping app process to verify disk persistence on restart..."
    "$ADB" -s "$SERIAL" shell am force-stop "$TEST_APP_ID"
    sleep 2
  fi

  # Re-push fixtures for flow 08 after flow 07 cleaned them up
  if [[ "$flow_name" == "08-gpx-import-errors-and-cancel" ]]; then
    push_gpx_fixtures
  fi

  # Start one process for this flow; Maestro keeps it alive with stopApp:false.
  "$ADB" -s "$SERIAL" shell am start -n "$TEST_APP_ID/.MainActivity" > "$flow_out_dir/launch.log"
  local app_pid=""
  for attempt in {1..20}; do
    app_pid="$("$ADB" -s "$SERIAL" shell pidof -s "$TEST_APP_ID" 2>/dev/null | tr -d '\r\n ' || true)"
    [[ "$app_pid" =~ ^[0-9]+$ ]] && break
    sleep 0.5
  done
  if [[ ! "$app_pid" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Test app did not start" >&2
    exit 1
  fi
  "$ADB" -s "$SERIAL" logcat --pid="$app_pid" -v time > "$flow_out_dir/app-logcat.log" 2>&1 &
  LOGCAT_PID=$!

  # Launch companion feeders if required
  local CURRENT_FEEDER_PID=""
  if [[ "$flow_name" == *"05-simulated-ride"* ]]; then
    echo "Starting synchronized companion GPS feeder for simulated ride..."
    local FEEDER_ARGS=(--serial "$SERIAL" --pid "$app_pid" --flow-out-dir "$flow_out_dir")
    if [[ "$RUN_GPS_FAILURE_DEMO" == "true" ]]; then
      FEEDER_ARGS+=(--demo-gps-failure)
    fi
    ADB="$ADB" "$SCRIPT_DIR/feed-gps.sh" "${FEEDER_ARGS[@]}" > "$ARTIFACTS_DIR/gps-feeder.log" 2>&1 &
    CURRENT_FEEDER_PID=$!
    GPS_FEEDER_PID=$CURRENT_FEEDER_PID
  elif [[ "$flow_name" == *"04-diagnostics-lifecycle"* ]]; then
    echo "Starting companion diagnostics feeder and teardown verifier..."
    ADB="$ADB" "$SCRIPT_DIR/feed-diagnostics-gps.sh" --serial "$SERIAL" --pid "$app_pid" --artifacts-dir "$flow_out_dir" > "$ARTIFACTS_DIR/diagnostics-feeder.log" 2>&1 &
    CURRENT_FEEDER_PID=$!
    GPS_FEEDER_PID=$CURRENT_FEEDER_PID
  fi

  set +e
  "$MAESTRO" --device "$SERIAL" test --test-output-dir "$flow_out_dir" "$flow_file" > "$log_file" 2>&1 &
  MAESTRO_PID=$!
  wait "$MAESTRO_PID"
  local flow_status=$?
  MAESTRO_PID=""
  set -e

  # Check feeder status if active
  local feeder_failed=false
  if [[ -n "$CURRENT_FEEDER_PID" ]]; then
    set +e
    wait "$CURRENT_FEEDER_PID"
    local feeder_status=$?
    set -e
    GPS_FEEDER_PID=""
    if [[ $feeder_status -ne 0 ]]; then
      echo "ERROR: Companion feeder failed with exit code $feeder_status." >&2
      feeder_failed=true
    fi
  fi

  kill "$LOGCAT_PID" 2>/dev/null || true
  wait "$LOGCAT_PID" 2>/dev/null || true
  LOGCAT_PID=""

  # Restore network if persistence flow just finished
  if [[ "$flow_name" == "07-gpx-persistence-and-offline" ]]; then
    echo "Triggering test storage observation (after)..."
    capture_storage_observation "after" "$flow_out_dir/storage-observe-after.log"

    verify_native_persistence "$flow_out_dir"
    restore_network
  fi

  # Take end-of-flow screenshot
  local end_shot="$ARTIFACTS_DIR/screenshots/${flow_name}-end.png"
  "$ADB" -s "$SERIAL" exec-out screencap -p > "$end_shot" 2>/dev/null || true

  # Harvest flow screenshots from Maestro flow output directory
  find "$flow_out_dir" -type f -name "*.png" -exec cp {} "$ARTIFACTS_DIR/screenshots/" \; 2>/dev/null || true

  # Checkpoint assertions
  local missing_checkpoint=false
  for cp_img in "$ARTIFACTS_DIR/screenshots"/*.png; do
    if [[ -f "$cp_img" ]] && [[ ! -s "$cp_img" ]]; then
      echo "ERROR: Corrupt 0-byte screenshot artifact: $cp_img" >&2
      missing_checkpoint=true
    fi
  done

  # Verify expected checkpoint screenshots exist for the flow
  case "$flow_name" in
    01-startup-and-diagnostics)
      for exp in 01-main-screen.png 01-diagnostics-idle.png; do
        if [[ ! -s "$ARTIFACTS_DIR/screenshots/$exp" ]]; then
          echo "ERROR: Expected checkpoint screenshot '$exp' missing!" >&2
          missing_checkpoint=true
        fi
      done
      ;;
    02-invalid-route)
      for exp in 02-malformed-id-error.png 02-missing-id-404-error.png 02-shared-link-success.png; do
        if [[ ! -s "$ARTIFACTS_DIR/screenshots/$exp" ]]; then
          echo "ERROR: Expected checkpoint screenshot '$exp' missing!" >&2
          missing_checkpoint=true
        fi
      done
      ;;
    03-saved-route-navigation)
      for exp in 03-route-map-overview.png 03-route-navigation-active.png; do
        if [[ ! -s "$ARTIFACTS_DIR/screenshots/$exp" ]]; then
          echo "ERROR: Expected checkpoint screenshot '$exp' missing!" >&2
          missing_checkpoint=true
        fi
      done
      ;;
    04a-diagnostics-permission-denied)
      for exp in 04a-diagnostics-permission-denied.png; do
        if [[ ! -s "$ARTIFACTS_DIR/screenshots/$exp" ]]; then
          echo "ERROR: Expected checkpoint screenshot '$exp' missing!" >&2
          missing_checkpoint=true
        fi
      done
      ;;
    04-diagnostics-lifecycle)
      for exp in 04-diagnostics-running.png 04-diagnostics-fixes-accumulated.png 04-diagnostics-stopped.png 04-diagnostics-verified.png 04-diagnostics-cleared.png; do
        if [[ ! -s "$ARTIFACTS_DIR/screenshots/$exp" ]]; then
          echo "ERROR: Expected checkpoint screenshot '$exp' missing!" >&2
          missing_checkpoint=true
        fi
      done
      ;;
    05-simulated-ride)
      for exp in 05-ride-turn-instruction.png 05-ride-intermediate-progress.png 05-ride-off-route.png 05-ride-arrived.png; do
        if [[ ! -s "$ARTIFACTS_DIR/screenshots/$exp" ]]; then
          echo "ERROR: Expected checkpoint screenshot '$exp' missing!" >&2
          missing_checkpoint=true
        fi
      done
      ;;
    06-gpx-import-and-preview)
      for exp in 06-import-track-preview.png 06-import-route-preview.png 06-import-segmented-preview.png; do
        if [[ ! -s "$ARTIFACTS_DIR/screenshots/$exp" ]]; then
          echo "ERROR: Expected checkpoint screenshot '$exp' missing!" >&2
          missing_checkpoint=true
        fi
      done
      ;;
    07-gpx-persistence-and-offline)
      for exp in 07-reopen-saved-route.png 07-reopen-second-saved-route.png 07-reopen-third-saved-route-bom.png; do
        if [[ ! -s "$ARTIFACTS_DIR/screenshots/$exp" ]]; then
          echo "ERROR: Expected checkpoint screenshot '$exp' missing!" >&2
          missing_checkpoint=true
        fi
      done
      ;;
    08-gpx-import-errors-and-cancel)
      for exp in 08-picker-canceled.png 08-malformed-gpx-error.png 08-oversized-gpx-error.png; do
        if [[ ! -s "$ARTIFACTS_DIR/screenshots/$exp" ]]; then
          echo "ERROR: Expected checkpoint screenshot '$exp' missing!" >&2
          missing_checkpoint=true
        fi
      done
      ;;
  esac

  if [[ $flow_status -eq 0 ]] && [[ "$feeder_failed" == "false" ]] && [[ "$missing_checkpoint" == "false" ]]; then
    echo "PASS: $flow_name"
    PASSED_FLOWS+=("$flow_name")
  else
    echo "FAIL: $flow_name (maestro: $flow_status, feeder_failed: $feeder_failed, missing_checkpoint: $missing_checkpoint)"
    tail -n 25 "$log_file" || true
    FAILED_FLOWS+=("$flow_name")
  fi

  sleep 2
}

if [[ "$RUN_FAILURE_DEMO" == "true" ]]; then
  echo "Running deliberate assertion failure demonstration..."
  DEMO_FAIL_FLOW="$FLOWS_DIR/failing-assertion-demo.yaml"
  run_flow "$DEMO_FAIL_FLOW"
else
  # Check for pre-existing collision in owned fixture directory
  check_fixture_collision
  # Push initial GPX fixtures to emulator
  push_gpx_fixtures

  # Standard test suite execution: flows 01 through 08
  FLOWS=(
    "$FLOWS_DIR/01-startup-and-diagnostics.yaml"
    "$FLOWS_DIR/02-invalid-route.yaml"
    "$FLOWS_DIR/03-saved-route-navigation.yaml"
    "$FLOWS_DIR/04a-diagnostics-permission-denied.yaml"
    "$FLOWS_DIR/04-diagnostics-lifecycle.yaml"
    "$FLOWS_DIR/05-simulated-ride.yaml"
    "$FLOWS_DIR/06-gpx-import-and-preview.yaml"
    "$FLOWS_DIR/07-gpx-persistence-and-offline.yaml"
    "$FLOWS_DIR/08-gpx-import-errors-and-cancel.yaml"
  )

  for flow in "${FLOWS[@]}"; do
    if [[ -f "$flow" ]]; then
      run_flow "$flow"
    else
      echo "ERROR: Flow file not found: $flow" >&2
      FAILED_FLOWS+=("$(basename "$flow" .yaml)")
    fi
  done
fi

# Stop logcat
if [[ -n "$LOGCAT_PID" ]] && kill -0 "$LOGCAT_PID" 2>/dev/null; then
  kill "$LOGCAT_PID" 2>/dev/null || true
  LOGCAT_PID=""
fi

# ---------------------------------------------------------
# 8. Summary Manifest Recording & Exit
# ---------------------------------------------------------
for f in "$ARTIFACTS_DIR/screenshots"/*.png; do
  if [[ -f "$f" ]]; then
    COLLECTED_CHECKPOINTS+=("$(basename "$f")")
  fi
done

PASSED_JOINED="$(IFS=,; echo "${PASSED_FLOWS[*]:-}")"
FAILED_JOINED="$(IFS=,; echo "${FAILED_FLOWS[*]:-}")"
CHECKPOINTS_JOINED="$(IFS=,; echo "${COLLECTED_CHECKPOINTS[*]:-}")"

FINAL_STATUS="passed"
if [[ ${#FAILED_FLOWS[@]} -gt 0 ]]; then
  FINAL_STATUS="failed"
fi

export MANIFEST_RUN_ID="$RUN_ID"
export MANIFEST_STATUS="$FINAL_STATUS"
export MANIFEST_STARTED_AT="$RUN_START_TIME"
export MANIFEST_FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export MANIFEST_SOURCE_FINGERPRINT="$SOURCE_FP"
export MANIFEST_APK_HASH="$APK_SHA256"
export MANIFEST_PASSED_FLOWS="$PASSED_JOINED"
export MANIFEST_FAILED_FLOWS="$FAILED_JOINED"
export MANIFEST_CHECKPOINTS="$CHECKPOINTS_JOINED"

node "$SCRIPT_DIR/generate-manifests.mjs" summary "$ARTIFACTS_DIR/summary.json"
SUMMARY_WRITTEN=true

echo ""
echo "=========================================================="
echo "Run Complete: $RUN_ID"
echo "Status:       $FINAL_STATUS"
echo "Passed Flows: ${#PASSED_FLOWS[@]} (${PASSED_JOINED})"
echo "Failed Flows: ${#FAILED_FLOWS[@]} (${FAILED_JOINED})"
echo "Screenshots:  ${#COLLECTED_CHECKPOINTS[@]} artifacts recorded"
echo "Summary:      $ARTIFACTS_DIR/summary.json"
echo "=========================================================="

if [[ "$FINAL_STATUS" != "passed" ]]; then
  exit 1
fi
exit 0
