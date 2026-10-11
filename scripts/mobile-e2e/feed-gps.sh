#!/usr/bin/env bash
# =============================================================================
# Ride Maker Mobile E2E - Native GPS Feeder
#
# Coordinates coordinate injection with observable navigation state via
# logcat '[E2E_NAV_STAGE]', 'adb emu geo fix', and Maestro screenshot creation.
# Revalidates dedicated emulator and exact AVD name 'ride-maker-e2e'.
# Stages:
#   Stage 0: Navigation start -> [E2E_NAV_STAGE]
#   Stage 1: Start fix (-73.9700, 40.7800) -> instruction="Turn right onto Test Way" -> 05-ride-turn-instruction.png
#   Stage 2: Intermediate progress fix (-73.9700, 40.7810) -> 90 m +/-20 m -> 05-ride-intermediate-progress.png
#   Stage 3: Off-route fix (-73.9720, 40.7805) -> offRoute=true -> 05-ride-off-route.png
#   Stage 4: Finish fix (-73.9676, 40.7818) -> arrived=true -> 05-ride-arrived.png
# =============================================================================

set -euo pipefail

SERIAL=""
FLOW_OUT_DIR=""
APP_PID=""
APP_ID="net.thg3.ridemaker.e2e"
ADB="${ADB:-adb}"
if ! command -v "$ADB" >/dev/null 2>&1; then
  if [[ -x "$HOME/Library/Android/sdk/platform-tools/adb" ]]; then
    ADB="$HOME/Library/Android/sdk/platform-tools/adb"
  elif [[ -x "$HOME/Android/Sdk/platform-tools/adb" ]]; then
    ADB="$HOME/Android/Sdk/platform-tools/adb"
  fi
fi
DEMO_FAILURE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "ERROR: --serial requires a non-empty argument." >&2
        exit 1
      fi
      SERIAL="$2"
      shift 2
      ;;
    --flow-out-dir)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "ERROR: --flow-out-dir requires a non-empty directory path." >&2
        exit 1
      fi
      FLOW_OUT_DIR="$2"
      shift 2
      ;;
    --pid)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "ERROR: --pid requires a non-empty argument." >&2
        exit 1
      fi
      APP_PID="$2"
      shift 2
      ;;
    --app-id)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "ERROR: --app-id requires a non-empty argument." >&2
        exit 1
      fi
      APP_ID="$2"
      shift 2
      ;;
    --demo-gps-failure|--demo-failure)
      DEMO_FAILURE=true
      shift
      ;;
    *)
      if [[ -z "$SERIAL" && "$1" != --* ]]; then
        SERIAL="$1"
        shift
      else
        echo "Unknown argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$SERIAL" ]]; then
  echo "ERROR: Missing required --serial argument." >&2
  exit 1
fi

# Revalidate device serial format
if [[ ! "$SERIAL" =~ ^emulator-[0-9]+$ ]]; then
  echo "ERROR: Serial '$SERIAL' is invalid. Must match '^emulator-[0-9]+$'." >&2
  exit 1
fi
if [[ "$SERIAL" == "R5CY52MQVCY" ]]; then
  echo "ERROR: Refusing to interact with protected physical device $SERIAL." >&2
  exit 1
fi

# Revalidate dedicated AVD name
AVD_NAME="$("$ADB" -s "$SERIAL" emu avd name 2>/dev/null | grep -v '^OK$' | head -n 1 | tr -d '\r\n ' || true)"
if [[ "$AVD_NAME" != "ride-maker-e2e" ]]; then
  # Cross check boot property
  PROP_AVD="$("$ADB" -s "$SERIAL" shell getprop ro.boot.qemu.avd_name 2>/dev/null | tr -d '\r\n ' || true)"
  if [[ "$PROP_AVD" != "ride-maker-e2e" ]]; then
    echo "ERROR: Dedicated AVD name mismatch. Expected 'ride-maker-e2e', got emu='$AVD_NAME', prop='$PROP_AVD'." >&2
    exit 1
  fi
fi

if [[ "$DEMO_FAILURE" == "true" ]]; then
  echo "[GPS Feeder Demo] Simulating deliberate GPS feeder injection failure..." >&2
  echo "ERROR: Deliberate GPS feed error triggered: adb emu geo fix rejected coordinates" >&2
  exit 2
fi

# Discover app PID if not passed
if [[ -z "$APP_PID" ]]; then
  for i in {1..30}; do
    APP_PID="$("$ADB" -s "$SERIAL" shell pidof -s "$APP_ID" 2>/dev/null | tr -d '\r\n ' || true)"
    if [[ -n "$APP_PID" && "$APP_PID" =~ ^[0-9]+$ ]]; then
      break
    fi
    sleep 0.5
  done
fi
if [[ ! "$APP_PID" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Test app PID unavailable; refusing unscoped logs" >&2
  exit 2
fi
echo "[GPS Feeder] App PID scoped to: ${APP_PID:-unknown}"

send_fix() {
  local lon="$1"
  local lat="$2"
  local output
  if ! output="$("$ADB" -s "$SERIAL" emu geo fix "$lon" "$lat" 2>&1)"; then
    echo "ERROR: Failed to inject GPS fix ($lon, $lat): $output" >&2
    exit 2
  fi
  if [[ "$output" == *"KO:"* || "$output" == *"error:"* ]]; then
    echo "ERROR: Emulator rejected GPS fix ($lon, $lat): $output" >&2
    exit 2
  fi
}

get_scoped_logs() {
  if [[ -n "$APP_PID" && "$APP_PID" =~ ^[0-9]+$ ]]; then
    "$ADB" -s "$SERIAL" logcat -d --pid="$APP_PID" -v time 2>/dev/null | grep "\[E2E_NAV_STAGE\]" || true
  else
    "$ADB" -s "$SERIAL" logcat -d -s "ReactNativeJS:*" 2>/dev/null | grep "\[E2E_NAV_STAGE\]" || true
  fi
}

wait_for_log_pattern() {
  local stage_name="$1"
  local pattern="$2"
  local timeout="${3:-35}"

  echo "[GPS Feeder] $stage_name: Waiting for '$pattern' in app logs..."
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    local logs
    send_fix -73.9700 40.7800
    logs="$(get_scoped_logs | tail -n 10 || true)"
    if echo "$logs" | grep -qE "$pattern"; then
      echo "[GPS Feeder] $stage_name: Observed '$pattern' in app logs after ${elapsed}s."
      return 0
    fi
    sleep 0.5
    elapsed=$((elapsed + 1))
  done

  echo "ERROR: $stage_name timed out after ${timeout}s without observing '$pattern'." >&2
  exit 2
}

wait_for_screenshot() {
  local shot_name="$1"
  local timeout="${2:-35}"

  if [[ -z "$FLOW_OUT_DIR" ]]; then
    return 0
  fi

  echo "[GPS Feeder] Waiting for Maestro screenshot '${shot_name}.png' in $FLOW_OUT_DIR..."
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    local found
    found="$(find "$FLOW_OUT_DIR" -name "${shot_name}.png" -size +0c 2>/dev/null | head -n 1 || true)"
    if [[ -n "$found" && -f "$found" ]]; then
      echo "[GPS Feeder] Maestro screenshot confirmed: $found (after ${elapsed}s)."
      return 0
    fi
    sleep 0.5
    elapsed=$((elapsed + 1))
  done

  echo "ERROR: Timed out after ${timeout}s waiting for screenshot '${shot_name}.png' in $FLOW_OUT_DIR." >&2
  exit 2
}

inject_and_wait_stage() {
  local stage_name="$1"
  local lon="$2"
  local lat="$3"
  local log_pattern="$4"
  local screenshot_name="$5"
  local timeout="${6:-35}"

  echo "[GPS Feeder] $stage_name: Injecting ($lon, $lat) waiting for log '$log_pattern'..."
  local elapsed=0
  local log_observed=false
  while [[ $elapsed -lt $timeout ]]; do
    send_fix "$lon" "$lat"
    sleep 0.5
    local logs
    logs="$(get_scoped_logs | tail -n 10 || true)"
    if echo "$logs" | grep -qE "$log_pattern"; then
      echo "[GPS Feeder] $stage_name: Observed '$log_pattern' in app logs after ${elapsed}s."
      log_observed=true
      break
    fi
    elapsed=$((elapsed + 1))
  done

  if [[ "$log_observed" != "true" ]]; then
    echo "ERROR: $stage_name: Timed out after ${timeout}s without observing log '$log_pattern'." >&2
    exit 2
  fi

  # Wait bounded until Maestro has taken the screenshot for this stage BEFORE proceeding
  wait_for_screenshot "$screenshot_name" "$timeout"
}

echo "[GPS Feeder] Starting verified log-bounded GPS injection on $SERIAL ($AVD_NAME)..."

# Stage 0: Wait for navigation to be active in app
wait_for_log_pattern "Stage 0" "\[E2E_NAV_STAGE\]" 35

# Stage 1: Route start fix -> "Turn right onto Test Way" -> 05-ride-turn-instruction
inject_and_wait_stage "Stage 1" "-73.9700" "40.7800" 'instruction="Turn right onto Test Way" distance="(180|190|200|210|220) m"' "05-ride-turn-instruction" 35

# Stage 2: Expected 90 m remaining, with +/-20 m native provider tolerance.
inject_and_wait_stage "Stage 2" "-73.9700" "40.7810" 'distance="(70|80|90|100|110) m"' "05-ride-intermediate-progress" 35

if [[ -n "$FLOW_OUT_DIR" && -d "$FLOW_OUT_DIR" ]]; then
  "$ADB" -s "$SERIAL" shell dumpsys location > "$FLOW_OUT_DIR/native-midpoint-location.txt"
fi

# Stage 3: Off-route deviation -> offRoute=true -> 05-ride-off-route
inject_and_wait_stage "Stage 3" "-73.9720" "40.7805" 'offRoute=true' "05-ride-off-route" 35

# Stage 4: Destination arrival fix -> arrived=true -> 05-ride-arrived
inject_and_wait_stage "Stage 4" "-73.9676" "40.7818" 'arrived=true' "05-ride-arrived" 35

echo "[GPS Feeder] All navigation stages successfully observed and synchronized with Maestro screenshots! Exiting cleanly."
exit 0
