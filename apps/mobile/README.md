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
- **EAS setup (2026-10-11)**: Authenticated on nauvis as `henrygrant`; linked to `@henrygrant/ride-maker` (project ID `b282abf3-3446-4e8b-a97f-bfd583a2e43c`). Android signing credentials are managed remotely by EAS. Account sessions and keys are not stored in Git. The first `preview` cloud build finished successfully on 2026-10-11; phone testing remains pending.
- **Verification Completed Locally**:
  - Monorepo and workspace TypeScript checks pass (`npm run check`).
  - All mobile workspace unit and lifecycle regression tests pass (`npm test --workspace @ride-maker/mobile`).
  - Android native manifest generation verified (`AndroidManifest.xml` includes `ACCESS_BACKGROUND_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, and `POST_NOTIFICATIONS`).
  - Metro Android bundle export compiles cleanly to Hermes bytecode with module-scope background task registration.

---

## Android Build Profiles & Installation

The build configurations are defined in `apps/mobile/eas.json`:

1. **`preview` Profile (Standalone APK with Bundled JS — Recommended for Offline/Airplane Field Tests)**:
   Embeds the compiled JavaScript runtime directly inside the APK. It does not require a running Metro server or network connection after installation, making it suitable for testing offline operation and airplane mode.
2. **`development` Profile (Dev Client APK)**:
   Includes `expo-dev-client` for live debugging and connecting to the Metro bundler running on `nauvis`.

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


## Review status and runtime limit

Sol reviewed the diagnostics code on 2026-10-10. The 61 mobile tests, workspace
checks/tests, and Android JavaScript export pass. The first standalone APK cloud build finished successfully on 2026-10-11;
physical locked-screen results remain pending. The web UI cannot exercise this native
spike. Existing route navigation remains foreground-only.

Lifecycle locks, directory queues, and speech cancellation coordinate instances
inside one JavaScript runtime. They do not coordinate distinct foreground and
headless runtimes; Expo's TaskService maintains separate task-manager tables.
This spike does not establish safe overlapping headless/foreground execution.
Process death, force quit, and reopening need physical verification. A subsequent
production background-navigation implementation must resolve this with native
transactional persistence and explicit audio ownership if concurrent runtimes
occur. Do not infer field acceptance from unit tests.

After any teardown error, use Stop again before clearing diagnostic data or
starting another session. The screen keeps Stop available for native tracking,
error, and stopping states.


## First Android test build

The 2026-10-11 `preview` build completed successfully:
[build details](https://expo.dev/accounts/henrygrant/projects/ride-maker/builds/44173fb1-9fd4-4dc7-a85e-2c7af656a625).
Download the APK from that build page on the Android phone and install it.
Allow the browser to install this app if Android requests permission. Open Ride
Maker, select Diagnostics, and start with a short locked-screen audio/GPS check
before the full field protocol above. This build bundles JavaScript and does
not need Metro. Physical GPS gaps, speech audibility, and battery use are still
unverified.
