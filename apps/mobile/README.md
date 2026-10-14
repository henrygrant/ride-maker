# Ride Maker Mobile App

Ride Maker mobile client built with React Native and Expo (SDK 57) for turn-by-turn cycling navigation.

## Tested Package Pins

Verified against `apps/mobile/package.json` and the root lockfile:
- **Expo**: `57.0.25`
- **React**: `19.2.3`
- **React Native**: `0.86.3`
- **expo-location**: `~57.0.20`
- **expo-task-manager**: `~57.0.21`
- **expo-file-system**: `~57.0.7`
- **expo-speech**: `~57.0.3`
- **expo-dev-client**: `~57.0.19`
- **@maplibre/maplibre-react-native**: `11.4.0`

## Mobile test strategy

See [the canonical testing strategy](../../docs/mobile-testing.md) and
[task 002](../../docs/tasks/002-mobile-test-foundation.md) for the Maestro
emulator harness, synthetic fixtures, standalone checks, and baseline verification.

### Automated End-to-End Tests (Maestro on Android Emulator)

The mobile E2E test suite executes fourteen automated journeys against a dedicated Android emulator (`emulator-5554`):
1. **01 Startup & Diagnostics**: App launch, brand title verification, diagnostics entry/exit.
2. **02 Invalid Route**: Invalid route ID entry, error banner assertion, tap dismissal.
3. **03 Saved Route Navigation**: Synthetic route load, distance & map assertions, foreground navigation start/stop, voice mute toggle.
4. **04a Permission Denied**: Deny foreground permission at Start and assert actionable error and IDLE state.
5. **04 Diagnostics Lifecycle**: Background tracking start/stop, metrics accumulation, and state teardown back to IDLE.
6. **05 Simulated Ride**: Real-time native GPS waypoint feeding via `feed-gps.sh`, driving Expo's location adapter through turn maneuvers, off-route detection (>50m), arrival, and navigation teardown.
7. **06 GPX Import & Preview**: Import track, route, and segmented GPX files via Android DocumentPicker, assert truthful distance/name/guidance notice, wait for fully rendered native map.
8. **07 GPX Persistence & Offline**: Self-contained flow verifying disk persistence across cold process restarts and device-wide network cut (airplane mode, disabled wifi/data, removed reverse mapping, verified by emulator probes).
9. **08 GPX Import Errors & Cancellation**: Verifies existing healthy routes survive document picker cancellation, malformed XML errors, and >10 MiB limit rejections.\n10. **09a Creation Permission Denied**: Denial keeps manual search available and blocks incomplete previews.
11. **09 Creation & Preview**: Concept A Floating Dock creation on full-bleed map, candidate map placement, geocoding search with error recovery, staged loop top search with cancellation vs commit, multi-stop management (up to 8 stops, 3+ long named stops, reorder up/down, remove, undo), Locate route preservation, blank name save recovery, and local save.
12. **09b Created Offline Navigation**: Runner-owned network cut and cold restart, stored instructions and geometry, unchanged imported originals.
13. **10 Created Ride Navigation**: Native GPS turn/progress, off-route, arrival, cancelled End/Back continuity and confirmed provider teardown.
14. **11 Library Management**: Fourteen long-name synthetic rides, scrolling, rename/restart, cancel/confirm deletion and storage preservation. The runner captures package-targeted observations between rename and the 11b deletion subflow.

### Baseline Execution Status (Task 005, accepted on Android emulator)
- **Baseline Run**: `run-20261014-135922` (14/14 passed, 0 failed).
- **Test APK**: `a18c0aef7908aa4af642e51de28ba88fc0b89e0706f7a5ee5327dd12add7c5ea` (122,771,000 bytes, `net.thg3.ridemaker.e2e`, cleartext: `true`).
- **Final Consumer APK**: `4d5d6b4be498ec20d6e9c478e7f23e4ce898e06762bee575aa84128f65bd9045` (122,767,776 bytes, `net.thg3.ridemaker`, cleartext: `false`). Installed `-r` preserving existing consumer route data; left foreground visible.
- **Final normalized creation/offline restart run**: `run-20261014-142822-focused-09-create-ride-and-preview` (2/2 passed). Source checkout normalization and non-destructive consumer verification are documented in [Sol’s review](../../docs/reviews/005-sol-floating-dock-review.md).
- **Unit Tests**: 21 test files, 145 tests passing.

### Selective Testing Policy (User Agreement)

Per user agreement, mobile verification adheres to a selective testing policy: prioritize discovering real product and UI defects through targeted, focused flows (such as `12-map-home-and-sheet` smoke and non-destructive `consumer-standalone` verification) while stopping stale-state infrastructure test loops. Historical 004/005 full passes demonstrate baseline validity for those stages, but do not imply or require immediate 006 full regression runs on focused handoffs. Completed concrete actions are recorded directly without future completion promises.

To run the automated suite:
```bash
# Run the full E2E suite
./scripts/mobile-e2e/run.sh --serial emulator-5554

# Rebuild standalone APK before testing
./scripts/mobile-e2e/run.sh --serial emulator-5554 --build-apk

# Focused diagnostics (not full-suite acceptance; 10/11 require a saved ride from 09)
./scripts/mobile-e2e/run.sh --serial emulator-5554 --flow 09-create-ride-and-preview

# Run intentional failure demonstration
./scripts/mobile-e2e/run.sh --serial emulator-5554 --demo-failure
```

Artifacts, screenshots, metadata, and logcat logs are saved to `.artifacts/mobile-e2e/<run-id>/`.

## Development Commands

Run commands from the repository root:

```bash
# Typecheck entire monorepo
npm run check

# Run all unit tests
npm test

# Run mobile workspace tests specifically
npm test --workspace @ride-maker/mobile

# Verify Metro bundling for Android
cd apps/mobile && npx expo export --platform android

# Verify Android native prebuild and permissions
cd apps/mobile && npx expo prebuild --platform android --clean --no-install

# Start Metro development bundler
cd apps/mobile && npx expo start --dev-client
```

## Toolchain Status & Build Environment

- **Remote Host (`nauvis`)**: Linux server without Android SDK (`ANDROID_HOME`), JDK (`javac`), `adb`, or macOS/Xcode.
- **Mac Build Host**: macOS with Android SDK (`~/Library/Android/sdk`), Java 17, Node (nvm), and Maestro CLI (`~/.maestro/bin/maestro`).
- **Safety Lockout**: Physical personal devices (e.g. Samsung `R5CY52MQVCY`) and active dev sessions on port 8081 are strictly protected; the test runner rejects non-emulator devices and runs against dedicated emulator `emulator-5554`.
- **EAS setup (2026-10-11)**: Authenticated on nauvis as `henrygrant`; linked to `@henrygrant/ride-maker` (project ID `b282abf3-3446-4e8b-a97f-bfd583a2e43c`). Android signing credentials are managed remotely by EAS. Account sessions and keys are not stored in Git.
- **Verification Completed Locally**:
  - Monorepo and workspace TypeScript checks pass (`npm run check`).
  - All mobile workspace unit and lifecycle regression tests pass (`npm test --workspace @ride-maker/mobile`: 22 test files, 147 tests passing).
  - All monorepo unit tests pass (`npm test`: all configured test workspaces).
  - Android native manifest includes required background permissions (`RECEIVE_BOOT_COMPLETED`, `ACCESS_BACKGROUND_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, and `POST_NOTIFICATIONS`).
  - Metro Android bundle export compiles cleanly to Hermes bytecode with module-scope background task registration.

---

## Android Build Profiles & Installation

The build configurations are defined in `apps/mobile/eas.json`:

1. **`preview` Profile (Standalone APK with Bundled JS — Recommended for Offline/Airplane Field Tests)**:
   Embeds the compiled JavaScript runtime directly inside the APK. It cold starts without Metro. Maps still require network; offline tiles/styles remain unimplemented. Locked-screen audio and GPS need physical field validation.
2. **`development` Profile (Dev Client APK)**:
   Includes `expo-dev-client` for live debugging and connecting to Metro on the development host (currently the Mac).

Local standalone builds need no Expo account or paid cloud build:

```bash
# Run from the repository root on the Mac
./scripts/mobile-e2e/bootstrap.sh --variant all
./scripts/mobile-e2e/run.sh --serial emulator-5554 --verify-consumer
```

The runner uses a separate test package. Do not use the consumer verification
command on a personal phone; automated testing requires AVD `ride-maker-e2e`.
The following EAS instructions remain an optional cloud alternative.

### Step 1: Expo Account Setup (Owner Step)

If not already configured, run on your machine:
```bash
npm install -g eas-cli
eas login
cd apps/mobile
eas project:init
```

### Step 2: Build the Standalone APK (for Airplane-Mode / Offline Testing)

To build a standalone APK that cold starts without Metro:
```bash
cd apps/mobile
eas build --profile preview --platform android
```
Once EAS completes the build, it provides a download link and QR code to install the APK directly on your Android phone.

### Step 3: Build the Development Client (for Live Metro Iteration)

To build the development client:
```bash
cd apps/mobile
eas build --profile development --platform android
```

#### Phone-to-Nauvis Connectivity via Tailscale
When using the development client build:
1. Ensure both your development host (`nauvis`) and your Android phone are joined to your **Tailscale** tailnet.
2. Start Metro with the host flag bound to your Tailscale IP or LAN IP:
   ```bash
   cd apps/mobile
   npx expo start --dev-client --host lan
   ```
3. **Behavior when reception drops**:
   - The development client requires an initial connection to Metro to fetch the bundle.
   - If cellular or WiFi reception drops during a ride, an active session will continue running in memory, but reloading the bundle or cold launching will fail until network connectivity is restored.
   - For uninterrupted field testing in poor-reception areas or airplane mode, use the **`preview`** profile build with bundled JS.

### Alternative: Local Android Studio Build (Requires Android SDK & Connected Device)

If you have Android Studio and USB debugging available locally:
```bash
cd apps/mobile
npx expo run:android
```

---

## Permissions & System Behavior

### Location Permissions
- **Foreground Location (`ACCESS_FINE_LOCATION`)**: Requested when starting diagnostics or route navigation.
- **Background Location (`ACCESS_BACKGROUND_LOCATION`)**: Requested on Android 10+ when starting diagnostics to permit tracking when the screen is locked or the app is minimized. The system dialog prompts for "Allow all the time".
- **Boot Completed (`RECEIVE_BOOT_COMPLETED`)**: Declared to permit Android 14 `JobScheduler` persistence for background location task registration without runtime exception.

### Notification Permissions (`POST_NOTIFICATIONS`)
- Declared in `AndroidManifest.xml` for Android 13+ (API 33+).
- The foreground service location tracking itself starts and runs at the system level regardless of whether notification display permission is granted.
- Denying notification permissions suppresses the persistent visual notification banner in the Android notification shade, but location updates and audio cues continue to be dispatched. Diagnostics does not block location tracking if notification permission is denied.

---

## 20-Minute Locked-Screen Field Test Protocol

This protocol tests Milestone 0 background feasibility (`docs/tasks/001-background-spike.md`):

### 1. Pre-Ride Setup
- [ ] Ensure device is adequately charged (note starting battery percentage).
- [ ] Set media volume to an audible level or pair Bluetooth cycling earbuds.
- [ ] Open the **Ride Maker** app.
- [ ] Tap **Diagnostics** in the header.
- [ ] Verify **Permission Status** card shows current permissions.

### 2. Starting the Spike
- [ ] Tap **Start Diagnostics (20-min Spike)**.
- [ ] Grant location permissions ("Allow all the time" for background) when prompted.
- [ ] **Verify Start Cue**: Confirm start audio cue plays:
  > *"Ride Maker diagnostic test started. Location tracking active."*
- [ ] **Verify Notification**: If notifications are allowed, confirm persistent notification:
  > **Ride Maker Diagnostics Active**
  > *Tracking background location and scheduled voice cues.*

### 3. Locked-Screen Test Period (20 Minutes)
- [ ] Press the power button to lock the screen.
- [ ] Place the device in your pocket, bag, or bike mount.
- [ ] Ride or walk outdoors for 20 minutes.
- [ ] Listen for scheduled diagnostic cues:
  - **0:30** — *"Diagnostic cue: thirty seconds elapsed. Screen lock check."*
  - **1:00** — *"Diagnostic cue: one minute elapsed. Tracking in progress."*
  - **2:00** — *"Diagnostic cue: two minutes elapsed."*
  - **5:00** — *"Diagnostic cue: five minutes elapsed."*
  - **10:00** — *"Diagnostic cue: ten minutes elapsed. Halfway mark."*
  - **15:00** — *"Diagnostic cue: fifteen minutes elapsed."*
  - **20:00** — *"Diagnostic cue: twenty minutes elapsed. Test period complete."*
- [ ] *Note on Throttling*: Fix intervals and GPS accuracy depend on OS Doze mode, satellite visibility, and device power management; 1-Hz sampling is not guaranteed by Android when locked.

### 4. Post-Ride Review
- [ ] Unlock phone and return to the **Diagnostics** screen.
- [ ] **Inspect Metrics**: Review recorded fix count, elapsed time, accuracy range, and min/max/average intervals.
- [ ] **Inspect Cue Status**: Check cue schedule indicators:
  - `✓ Completed`: Native speech callback completed.
  - `▶ Dispatched`: Audio cue dispatched to speech engine.
  - `⊘ Skipped`: Obsolete cue skipped due to batched fix backlog after deep sleep.
  - `✕ Failed`: Native speech returned an error.
- [ ] Note ending battery level to evaluate consumption.

### 5. Stop and Interruption Verification
- [ ] Tap **Stop Diagnostics**.
- [ ] Confirm tracking stops and persistent notification clears.
- [ ] **Force-Quit Test**:
  - Tap **Start Diagnostics**.
  - Force quit / swipe the app away from recent apps.
  - Reopen Ride Maker.
  - Confirm the yellow **Interrupted Session Detected** banner is displayed and no spurious running state persists.

## Local GPX imports

Import a GPX through the native picker to preview its name, distance and separate
segments. It saves automatically to app-private original/snapshot files and SQLite
metadata and can reopen without network access. Limits are 10 MiB and 100,000
geometry points. Imported tracks are preview-only until turn preparation lands;
map tiles still require network. No account or upload is needed.

Task003 acceptance and native persistence/network evidence are documented in
[the task](../../docs/tasks/003-local-gpx-import.md) and
[Sol review](../../docs/reviews/003-sol-local-gpx-review.md).
