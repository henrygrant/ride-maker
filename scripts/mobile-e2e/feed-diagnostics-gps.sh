#!/usr/bin/env bash
# =============================================================================
# Ride Maker Mobile E2E - Native Diagnostics Feeder & Teardown Verifier
#
# Feeds GPS fixes during diagnostic tracking, verifies sample counter increments,
# snapshots stopped counts, injects post-stop fixes and asserts counter invariance
# against fresh post-stop storage snapshots, and verifies complete native service
# and location listener teardown.
# =============================================================================

set -euo pipefail

SERIAL=""
ARTIFACTS_DIR=""
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
    --artifacts-dir)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "ERROR: --artifacts-dir requires a non-empty argument." >&2
        exit 1
      fi
      ARTIFACTS_DIR="$2"
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

if [[ ! "$SERIAL" =~ ^emulator-[0-9]+$ ]]; then
  echo "ERROR: Serial '$SERIAL' is invalid. Must match '^emulator-[0-9]+$'." >&2
  exit 1
fi
if [[ "$SERIAL" == "R5CY52MQVCY" ]]; then
  echo "ERROR: Refusing to interact with protected physical device $SERIAL." >&2
  exit 1
fi

AVD_NAME="$("$ADB" -s "$SERIAL" emu avd name 2>/dev/null | grep -v '^OK$' | head -n 1 | tr -d '\r\n ' || true)"
if [[ "$AVD_NAME" != "ride-maker-e2e" ]]; then
  PROP_AVD="$("$ADB" -s "$SERIAL" shell getprop ro.boot.qemu.avd_name 2>/dev/null | tr -d '\r\n ' || true)"
  if [[ "$PROP_AVD" != "ride-maker-e2e" ]]; then
    echo "ERROR: Dedicated AVD name mismatch. Expected 'ride-maker-e2e', got emu='$AVD_NAME', prop='$PROP_AVD'." >&2
    exit 1
  fi
fi

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
echo "[Diag Feeder] Starting diagnostics feed & teardown verifier on $SERIAL (AVD: $AVD_NAME, PID: ${APP_PID:-unknown})..."

send_fix() {
  local lon="$1"
  local lat="$2"
  local output
  if ! output="$("$ADB" -s "$SERIAL" emu geo fix "$lon" "$lat" 2>&1)"; then
    echo "ERROR: Failed to inject fix ($lon, $lat): $output" >&2
    exit 2
  fi
  if [[ "$output" == *"KO:"* || "$output" == *"error:"* ]]; then
    echo "ERROR: Emulator rejected GPS fix ($lon, $lat): $output" >&2
    exit 2
  fi
}

get_diag_stage_line() {
  if [[ -n "$APP_PID" && "$APP_PID" =~ ^[0-9]+$ ]]; then
    "$ADB" -s "$SERIAL" logcat -d --pid="$APP_PID" -v time 2>/dev/null | grep "\[E2E_DIAG_STAGE\]" | tail -n 1 || true
  else
    "$ADB" -s "$SERIAL" logcat -d -s "ReactNativeJS:*" 2>/dev/null | grep "\[E2E_DIAG_STAGE\]" | tail -n 1 || true
  fi
}

is_service_running() {
  local services
  services="$("$ADB" -s "$SERIAL" shell dumpsys activity services "$APP_ID" 2>&1)" || exit 2
  if [[ "$services" != *"ACTIVITY MANAGER SERVICES"* || "$services" == *"Error"* ]]; then
    echo "ERROR: Failed to query dumpsys activity services: $services" >&2
    exit 2
  fi
  if [[ -n "$ARTIFACTS_DIR" && -d "$ARTIFACTS_DIR" ]]; then
    echo "$services" > "$ARTIFACTS_DIR/diagnostics-dumpsys-services.txt"
  fi
  echo "$services" | grep "LocationTaskService" -A 10 | grep -E -q "startRequested=true|isForeground=true"
}

is_gps_listener_active() {
  local loc_dump
  loc_dump="$("$ADB" -s "$SERIAL" shell dumpsys location 2>&1)" || exit 2
  if [[ -z "$loc_dump" || "$loc_dump" != *"Location Providers:"* ]]; then
    echo "ERROR: Failed to query dumpsys location: $loc_dump" >&2
    exit 2
  fi
  if [[ -n "$ARTIFACTS_DIR" && -d "$ARTIFACTS_DIR" ]]; then
    echo "$loc_dump" > "$ARTIFACTS_DIR/diagnostics-dumpsys-location.txt"
  fi
  local active_section
  active_section="$(echo "$loc_dump" | sed -n '/Location Providers:/,/GNSS Manager:/p')"
  if echo "$active_section" | grep -q "$APP_ID"; then
    return 0
  fi
  return 1
}

# Stage 1: Wait for RUNNING state in app logs
echo "[Diag Feeder] Stage 1: Waiting for session RUNNING state in app logs..."
stage1_elapsed=0
stage1_timeout=35
while [[ $stage1_elapsed -lt $stage1_timeout ]]; do
  line="$(get_diag_stage_line)"
  if echo "$line" | grep -q 'status="running"'; then
    echo "[Diag Feeder] Session state is RUNNING after ${stage1_elapsed}s ($line)."
    break
  fi
  sleep 0.5
  stage1_elapsed=$((stage1_elapsed + 1))
done

if [[ $stage1_elapsed -ge $stage1_timeout ]]; then
  echo "ERROR: Session did not transition to RUNNING within ${stage1_timeout}s." >&2
  exit 2
fi

# Verify active background service (bounded retry)
service_active=false
for i in {1..10}; do
  if is_service_running; then
    service_active=true
    break
  fi
  sleep 0.5
done

if [[ "$service_active" == "true" ]]; then
  echo "[Diag Feeder] Verified: Native LocationTaskService is ACTIVE."
else
  echo "ERROR: Diagnostics session is RUNNING but LocationTaskService not active in dumpsys activity services." >&2
  exit 2
fi

line="$(get_diag_stage_line)"
initial_fixes="$(python3 -c "import re; m = re.search(r'fixes=(\d+)', '$line'); print(m.group(1) if m else '0')")"
echo "[Diag Feeder] Initial fixes count: $initial_fixes"

# Stage 2: Inject fixes while RUNNING to accumulate samples
echo "[Diag Feeder] Stage 2: Injecting active fixes to accumulate samples..."
stage2_elapsed=0
stage2_timeout=30
running_fixes="$initial_fixes"
while [[ $stage2_elapsed -lt $stage2_timeout ]]; do
  send_fix -73.9700 40.7800
  sleep 0.5
  line="$(get_diag_stage_line)"
  current_fixes="$(python3 -c "import re; m = re.search(r'fixes=(\d+)', '$line'); print(m.group(1) if m else '0')")"
  if [[ "$current_fixes" =~ ^[0-9]+$ ]] && [[ "$current_fixes" -gt "$initial_fixes" ]]; then
    running_fixes="$current_fixes"
    echo "[Diag Feeder] Fixes successfully accumulated: $initial_fixes -> $running_fixes (after ${stage2_elapsed}s)."
    break
  fi
  stage2_elapsed=$((stage2_elapsed + 1))
done

if [[ "$running_fixes" -le "$initial_fixes" ]]; then
  echo "ERROR: Fixes count did not increase while session was RUNNING ($initial_fixes -> $running_fixes)." >&2
  exit 2
fi

"$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d "ridemaker://test-samples-ready" "$APP_ID" >/dev/null

# Stage 3: Wait for session to be STOPPED by Maestro
echo "[Diag Feeder] Stage 3: Waiting for session STOPPED state..."
stage3_elapsed=0
stage3_timeout=30
stopped_fixes=""
stopped_cues=""
stopped_cue_attempts=""
stopped_snapshot=""
while [[ $stage3_elapsed -lt $stage3_timeout ]]; do
  line="$(get_diag_stage_line)"
  if echo "$line" | grep -q 'status="stopped"'; then
    stopped_fixes="$(python3 -c "import re; m = re.search(r'fixes=(\d+)', '$line'); print(m.group(1) if m else '0')")"
    stopped_cues="$(python3 -c "import re; m = re.search(r'cues=(\d+)', '$line'); print(m.group(1) if m else '0')")"
    stopped_cue_attempts="$(python3 -c "import re; m = re.search(r'cueAttempts=(\d+)', '$line'); print(m.group(1) if m else '0')")"
    stopped_snapshot="$(python3 -c "import re; m = re.search(r'snapshotCount=(\d+)', '$line'); print(m.group(1) if m else '0')")"
    echo "[Diag Feeder] Session state is STOPPED after ${stage3_elapsed}s."
    echo "  Snapshot fixes: $stopped_fixes, cues: $stopped_cues, cue attempts: $stopped_cue_attempts, snapshot count: $stopped_snapshot"
    break
  fi
  sleep 0.5
  stage3_elapsed=$((stage3_elapsed + 1))
done

if [[ -z "$stopped_fixes" ]]; then
  echo "ERROR: Session did not reach STOPPED state within ${stage3_timeout}s." >&2
  exit 2
fi

# Verify Native Teardown with bounded polling
echo "[Diag Feeder] Stage 3b: Verifying native background service & provider teardown..."
service_stopped=false
for i in {1..12}; do
  if ! is_service_running; then
    service_stopped=true
    break
  fi
  sleep 0.5
done

if [[ "$service_stopped" != "true" ]]; then
  echo "ERROR: Native teardown failed: LocationTaskService still active in dumpsys activity services after STOP!" >&2
  exit 2
fi
echo "[Diag Feeder] Verified: LocationTaskService cleanly terminated."

listener_stopped=false
for i in {1..12}; do
  if ! is_gps_listener_active; then
    listener_stopped=true
    break
  fi
  sleep 0.5
done

if [[ "$listener_stopped" != "true" ]]; then
  echo "ERROR: Native teardown failed: GPS provider listener still active for $APP_ID after STOP!" >&2
  exit 2
fi
echo "[Diag Feeder] Verified: Native GPS provider listener cleanly deregistered."

# Stage 4: Feed post-stop fixes and assert counter invariance against fresh persisted storage
echo "[Diag Feeder] Stage 4: Injecting post-stop fixes to verify counter invariance..."
for i in {1..4}; do
  send_fix -73.9700 40.7810
  sleep 0.3
done

# Baseline AFTER injection: the next snapshot must read storage after the final fix.
line="$(get_diag_stage_line)"
stopped_snapshot="$(echo "$line" | sed -n 's/.*snapshotCount=\([0-9]*\).*/\1/p')"
[[ "$stopped_snapshot" =~ ^[0-9]+$ ]] || exit 2

# Wait for a fresh persisted snapshot read after post-stop injection
echo "[Diag Feeder] Awaiting fresh post-stop storage snapshot (snapshotCount > $stopped_snapshot)..."
post_snapshot=""
post_fixes=""
post_cues=""
post_cue_attempts=""
for wait_tick in {1..20}; do
  sleep 0.5
  line="$(get_diag_stage_line)"
  cur_snap="$(python3 -c "import re; m = re.search(r'snapshotCount=(\d+)', '$line'); print(m.group(1) if m else '0')")"
  if [[ "$cur_snap" =~ ^[0-9]+$ ]] && [[ "$cur_snap" -gt "$stopped_snapshot" ]]; then
    post_snapshot="$cur_snap"
    post_fixes="$(python3 -c "import re; m = re.search(r'fixes=(\d+)', '$line'); print(m.group(1) if m else '0')")"
    post_cues="$(python3 -c "import re; m = re.search(r'cues=(\d+)', '$line'); print(m.group(1) if m else '0')")"
    post_cue_attempts="$(python3 -c "import re; m = re.search(r'cueAttempts=(\d+)', '$line'); print(m.group(1) if m else '0')")"
    break
  fi
done

if [[ -z "$post_snapshot" ]]; then
  echo "ERROR: Did not observe fresh persisted storage snapshot after post-stop injection." >&2
  exit 2
fi

echo "[Diag Feeder] Counter & Lifecycle Invariance Verification (Fresh Snapshot #$post_snapshot):"
echo "  Fixes:        before post-feed = $stopped_fixes, after post-feed = $post_fixes"
echo "  Cues:         before post-feed = $stopped_cues, after post-feed = $post_cues"
echo "  Cue Attempts: before post-feed = $stopped_cue_attempts, after post-feed = $post_cue_attempts"
echo "  [Note] Speech callbacks confirm native TTS lifecycle dispatch, not acoustic audibility on device."

if [[ "$post_fixes" != "$stopped_fixes" ]]; then
  echo "ERROR: Invariance failure: Fixes counter changed post-stop ($stopped_fixes -> $post_fixes)!" >&2
  exit 2
fi

if [[ "$post_cues" != "$stopped_cues" ]]; then
  echo "ERROR: Invariance failure: Cues counter changed post-stop ($stopped_cues -> $post_cues)!" >&2
  exit 2
fi

if [[ "$post_cue_attempts" != "$stopped_cue_attempts" ]]; then
  echo "ERROR: Invariance failure: Cue attempts counter changed post-stop ($stopped_cue_attempts -> $post_cue_attempts)!" >&2
  exit 2
fi

echo "[Diag Feeder] Verified: Counter and lifecycle invariance confirmed across fresh post-stop disk snapshot."

# Stage 5: Signal Maestro that verification is complete
echo "[Diag Feeder] Stage 5: Signaling verification completion to app..."
"$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d "ridemaker://test-verified" "$APP_ID" >/dev/null 2>&1 || true

echo "[Diag Feeder] Teardown, fresh snapshot verification, and counter invariance verified successfully! Exiting cleanly."
exit 0
