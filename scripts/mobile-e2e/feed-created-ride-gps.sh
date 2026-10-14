#!/usr/bin/env bash
# =============================================================================
# Ride Maker Mobile E2E - Created Ride GPS Feeder
#
# Feeds GPS coordinates for a created route through stored provider instructions.
# Coordinates coordinate injection with observable navigation state via
# logcat '[E2E_NAV_STAGE]', 'adb emu geo fix', and Maestro screenshot creation.
# Revalidates dedicated emulator and exact AVD name 'ride-maker-e2e'.
# Stages:
#   Stage 0: Navigation start -> [E2E_NAV_STAGE]
#   Stage 1: Start fix (-73.9680, 40.7850) -> instruction="Depart start point." -> 10-created-ride-turn-instruction.png
#   Stage 2: Intermediate progress fix (-73.9709, 40.7781) -> instruction="Arrive at intermediate stop 1." distance="830 m" -> 10-created-ride-progress.png
#   Stage 3: Off-route fix (-73.9500, 40.7850) -> offRoute=true -> 10-created-ride-off-route.png
#   Stage 4: Arrival fix (-73.9680, 40.7850) -> arrived=true -> 10-created-ride-arrived.png
#   Teardown: Confirmed navigation teardown [E2E_NAV_ACTIVE] mounted=false
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
  PROP_AVD="$("$ADB" -s "$SERIAL" shell getprop ro.boot.qemu.avd_name 2>/dev/null | tr -d '\r\n ' || true)"
  if [[ "$PROP_AVD" != "ride-maker-e2e" ]]; then
    echo "ERROR: Dedicated AVD name mismatch. Expected 'ride-maker-e2e', got emu='$AVD_NAME', prop='$PROP_AVD'." >&2
    exit 1
  fi
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
echo "[Created Ride GPS Feeder] App PID scoped to: ${APP_PID:-unknown}"

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

get_all_scoped_logs() {
  if [[ -n "$APP_PID" && "$APP_PID" =~ ^[0-9]+$ ]]; then
    "$ADB" -s "$SERIAL" logcat -d --pid="$APP_PID" -v time 2>/dev/null | grep -E "(\\[E2E_NAV_STAGE\\]|\\[E2E_NAV_ACTIVE\\]|\\[E2E_NAV_CANCEL_END\\]|\\[E2E_NAV_CONFIRM_END\\]|\\[E2E_NAV_PROVIDER\\]|\\[E2E_NAV_PROVIDER_SAMPLE\\])" || true
  else
    "$ADB" -s "$SERIAL" logcat -d -s "ReactNativeJS:*" 2>/dev/null | grep -E "(\\[E2E_NAV_STAGE\\]|\\[E2E_NAV_ACTIVE\\]|\\[E2E_NAV_CANCEL_END\\]|\\[E2E_NAV_CONFIRM_END\\]|\\[E2E_NAV_PROVIDER\\]|\\[E2E_NAV_PROVIDER_SAMPLE\\])" || true
  fi
}

# Ignore prior rides in this still-running process (including offline flow09b).
MIN_LOG_LINE="$(get_all_scoped_logs | wc -l | tr -d ' ')"
ONLY_AFTER_CONFIRM=false
get_scoped_logs() {
  if [[ "$ONLY_AFTER_CONFIRM" == "true" ]]; then
    get_all_scoped_logs | awk -v first="$MIN_LOG_LINE" 'NR > first' | sed -n '/\[E2E_NAV_CONFIRM_END\]/,$p'
  else
    get_all_scoped_logs | awk -v first="$MIN_LOG_LINE" 'NR > first'
  fi
}

wait_for_log_pattern() {
  local stage_name="$1"
  local pattern="$2"
  local timeout="${3:-35}"

  echo "[Created Ride GPS Feeder] $stage_name: Waiting for '$pattern' in app logs..."
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    local logs
    logs="$(get_scoped_logs | tail -n 15 || true)"
    if echo "$logs" | grep -qE "$pattern"; then
      echo "[Created Ride GPS Feeder] $stage_name: Observed '$pattern' in app logs after ${elapsed}s."
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

  echo "[Created Ride GPS Feeder] Waiting for Maestro screenshot '${shot_name}.png' in $FLOW_OUT_DIR..."
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    local found
    found="$(find "$FLOW_OUT_DIR" -name "${shot_name}.png" -size +0c 2>/dev/null | head -n 1 || true)"
    if [[ -n "$found" && -f "$found" ]]; then
      echo "[Created Ride GPS Feeder] Maestro screenshot confirmed: $found (after ${elapsed}s)."
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

  echo "[Created Ride GPS Feeder] $stage_name: Injecting ($lon, $lat) waiting for log '$log_pattern'..."
  local elapsed=0
  local log_observed=false
  while [[ $elapsed -lt $timeout ]]; do
    send_fix "$lon" "$lat"
    sleep 0.5
    local logs
    logs="$(get_scoped_logs | tail -n 15 || true)"
    if echo "$logs" | grep -qE "$log_pattern"; then
      echo "[Created Ride GPS Feeder] $stage_name: Observed '$log_pattern' in app logs after ${elapsed}s."
      log_observed=true
      break
    fi
    elapsed=$((elapsed + 1))
  done

  if [[ "$log_observed" != "true" ]]; then
    echo "ERROR: $stage_name: Timed out after ${timeout}s without observing log '$log_pattern'." >&2
    exit 2
  fi

  wait_for_screenshot "$screenshot_name" "$timeout"
}

echo "[Created Ride GPS Feeder] Starting synchronized GPS injection for created ride on $SERIAL ($AVD_NAME)..."

# Stage 0: Wait for navigation to be active in app and provider subscribed
wait_for_log_pattern "Stage 0 (Provider subscription)" "\\[E2E_NAV_PROVIDER\\] subscribed=true" 35
wait_for_log_pattern "Stage 0 (Navigation active)" "\\[E2E_NAV_STAGE\\]" 35

# Stage 1: Route start fix -> "Depart start point." -> 10-created-ride-turn-instruction
inject_and_wait_stage "Stage 1" "-73.9680" "40.7850" 'instruction="Depart start point\.".*distance="0 m".*arrived=false offRoute=false' "10-created-ride-turn-instruction" 35

# Stage 2: Intermediate progress fix -> "Arrive at intermediate stop 1." -> 10-created-ride-progress
inject_and_wait_stage "Stage 2" "-73.9709" "40.7781" 'instruction="Arrive at intermediate stop 1\.".*distance="(810|820|830|840|850) m".*arrived=false offRoute=false' "10-created-ride-progress" 35

# Stage 3: Off-route deviation fix (-73.9500, 40.7850) -> offRoute=true -> 10-created-ride-off-route
inject_and_wait_stage "Stage 3" "-73.9500" "40.7850" 'offRoute=true' "10-created-ride-off-route" 35

# Stage 4: Arrival fix at finish (-73.9680, 40.7850) -> arrived=true -> 10-created-ride-arrived
inject_and_wait_stage "Stage 4" "-73.9680" "40.7850" 'arrived=true' "10-created-ride-arrived" 35

# Cancellation check: observe fresh cancel log during Maestro cancel step
wait_for_log_pattern "Cancellation observation" "\\[E2E_NAV_CANCEL_END\\]" 35

# Require a fresh native sample after Cancel. Move off route so the UI must
# change from Arrived to Off route before Maestro can continue to Confirm End.
sample_baseline="$(get_scoped_logs | grep -F '[E2E_NAV_PROVIDER_SAMPLE]' | tail -n 1 || true)"
continuity_verified=false
for attempt in {1..30}; do
  send_fix "-73.9500" "40.7850"
  sleep 0.5
  sample_after="$(get_scoped_logs | grep -F '[E2E_NAV_PROVIDER_SAMPLE]' | tail -n 1 || true)"
  if [[ -n "$sample_after" && "$sample_after" != "$sample_baseline" && "$sample_after" == *"lon=-73.95"* ]]; then
    continuity_verified=true
    break
  fi
done
if [[ "$continuity_verified" != "true" ]]; then
  echo "ERROR: No fresh provider sample after Cancel." >&2
  exit 2
fi
wait_for_screenshot "10-created-cancel-continues" 15

# Provider teardown must occur AFTER this ride's explicit Confirm event.
wait_for_log_pattern "Confirmed end" "\\[E2E_NAV_CONFIRM_END\\]" 35
ONLY_AFTER_CONFIRM=true
wait_for_log_pattern "Teardown UI unmount" "\\[E2E_NAV_ACTIVE\\] mounted=false" 35
wait_for_log_pattern "Provider teardown confirmed" "\\[E2E_NAV_PROVIDER\\] unsubscribed=true" 35

# Final assertion: inject GPS fix and assert NO new provider samples arrive after unmount
echo "[Created Ride GPS Feeder] Post-teardown check: Verifying no provider samples received after unmount..."
ONLY_AFTER_CONFIRM=false
sample_baseline="$(get_scoped_logs | grep -E "\\[E2E_NAV_PROVIDER_SAMPLE\\]" | tail -n 1 || true)"
send_fix "-73.9680" "40.7850"
sleep 1.5
sample_after="$(get_scoped_logs | grep -E "\\[E2E_NAV_PROVIDER_SAMPLE\\]" | tail -n 1 || true)"
if [[ -z "$sample_baseline" || "$sample_baseline" != "$sample_after" ]]; then
  echo "ERROR: Provider continued receiving samples after confirmed end teardown!" >&2
  echo "Baseline: $sample_baseline" >&2
  echo "After:    $sample_after" >&2
  exit 2
fi
echo "[Created Ride GPS Feeder] Verified no new samples received after provider teardown."

echo "[Created Ride GPS Feeder] All navigation stages successfully observed and synchronized with Maestro screenshots! Exiting cleanly."
exit 0
