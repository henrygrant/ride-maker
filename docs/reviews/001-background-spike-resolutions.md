# Task 001: Background Spike — Review Resolutions & Planner Input Request

**Status**: Code reviewed; Android build and field acceptance pending
**Date**: October 10, 2026
**Target**: Android (Milestone 0 Background Feasibility Spike)
**Reference Reviews**: [`docs/reviews/001-background-spike.md`](./001-background-spike.md), [`docs/reviews/001-sol-followup.md`](./001-sol-followup.md)

---

## 1. Summary of Required Corrections Addressed

All required corrections from Sol's reviews (Rounds 1–5) have been implemented and verified against unit and regression test suites:

### Area 1: Transactional Session Boundary & Cross-Session Isolation
- **Separation of Create vs Update**:
  - Added `createSession(session: DiagnosticSession)` to [`DiagnosticStorage`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/storage.ts), rejecting session creation if an active session (`"running"` or `"stopping"`) is present.
  - Added atomic `updateSession(sessionId: string, updater: (current: DiagnosticSession) => void | DiagnosticSession)` to both [`InMemoryDiagnosticStorage`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/storage.ts) and [`FileSystemDiagnosticStorage`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/file-storage.ts). Updates apply transactional mutators directly against current on-disk/in-memory state inside the directory lock and monotonically increment versions.
- **Explicit Session-ID Guards & Stale Write Rejection**:
  - `saveSession()` guards against resurrection (`"stopped"`/`"interrupted"`/`"error"` cannot transition back to `"running"` or `"stopping"`), older version overwrites (`(current.version ?? 0) > (incoming.version ?? 0)`), overwriting active running/stopping sessions with different session IDs, and older session writes arriving after a newer session has already run.
  - Sample writes in `recordSample(sample, sessionId)` and cue callbacks in `handleDiagnosticLocations()` carry and validate the originating `sessionId`. Samples or callbacks for non-matching sessions are dropped without mutating the store.

### Area 2: Sol Follow-up Reproductions & Lifecycle Ownership
- **Reproduction 1 (Old running write overwriting newer session)**:
  - Addressed via active session guard in `saveSession()` and `createSession()`. Verified in both `InMemoryDiagnosticStorage` and `FileSystemDiagnosticStorage` with delayed fake I/O.
- **Reproduction 2 (Callbacks advancing versions during native Stop)**:
  - `stopDiagnosticsSession()` immediately establishes a persisted non-running stopping barrier (`status: "stopping"`) before halting native location updates.
  - Fix callbacks arriving during native stop see `status !== "running"`, immediately dropping sample records and cue claims.
  - The final stopped state is committed via `updateSession()` on the latest stored record rather than writing an in-memory stale version. Verified in both in-memory and production file storage with delayed fake I/O.
- **Reproduction 3 (Deferred speech dispatch after Stop resolves)**:
  - `stopDiagnosticsSession()` sets the stopping barrier, stops native location updates, aborts in-flight tasks via `cancelInFlightTasks(sessionId)`, drains in-flight speech dispatch with `waitForInFlightTasks()`, and executes a final native speech stop before resolving.
  - [`ExpoSpeechAdapter`](file:///home/henry/projects/ride-maker/apps/mobile/src/adapters/speech.ts) implements generational cancellation: each `speak()` call captures an incremented generation counter (`currentGen = ++this.generation`). If `stop()` is invoked while `Speech.stop()` is being awaited, `this.stopped` is set to `true` and `this.generation` increments, immediately aborting the pending dispatch before calling native `Speech.speak()`.
  - Generational immunity ensures that if a subsequent session starts and resets `this.stopped = false`, a stale pending `speak()` from an earlier session is permanently cancelled and will not fire. Verified in `apps/mobile/src/adapters/speech.test.ts`.
  - `ExpoSpeechAdapter.stop()` no longer swallows native failures; speech teardown errors are propagated to `stopDiagnosticsSession()`, which transitions session status to `"error"` and records the failure message truthfully.

### Area 3: Round 4 Regressions & Lifecycle Serialization
- **Synchronous Lifecycle Ownership**:
  - `startDiagnosticsSession()` immediately checks and sets `activeLifecycleOp = "starting"` **synchronously before any async await** (such as permission or availability checks).
  - `stopDiagnosticsSession()` immediately checks and sets `activeLifecycleOp = "stopping"` **synchronously before any async await**.
  - All early abort paths (such as rejected permissions or missing background location capabilities) execute inside `try ... finally` blocks to ensure `activeLifecycleOp` is reliably reset.
  - Concurrent start or stop requests (including overlapping starts, start-during-stop, and duplicate stops) are immediately rejected with descriptive lifecycle in-progress errors.
  - An older stop operation verifies the target session ID has not been superseded by a newer session before touching native services.
- **Comprehensive Startup Rollback**:
  - If any step of session startup fails after native background location tracking has begun (including persistence failures in `createSession` or initial voice cue dispatch errors), the entire startup sequence is rolled back:
    1. In-flight tasks are cancelled via `cancelInFlightTasks(sessionId)`.
    2. Background location updates are halted via `stopBackgroundLocationUpdatesAsync(taskName)`.
    3. Audio playback is silenced via `speechAdapter.stop()`.
    4. Session status in storage is persisted as `"error"` with the actual failure message.
    5. The original failure is truthfully rethrown (e.g. `"disk unavailable"`).
- **Truthful In-Flight Task Drain**:
  - `waitForInFlightTasks()` in [`task-handler.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/task-handler.ts) tracks active speech dispatch.
  - If tasks do not drain within the timeout, `waitForInFlightTasks()` now explicitly rejects with an error rather than silently resolving.
  - If in-flight dispatch remains active on timeout, `stopDiagnosticsSession()` marks the session as `"error"`, throws the timeout error, and retains lifecycle ownership until all in-flight callbacks have completely drained (`onInFlightTasksDrained`).
- **Recovery Polling Protection**:
  - `checkOrRecoverSession()` guards against executing while `activeLifecycleOp !== null`, preventing recovery polling from interrupting an in-progress Start or Stop operation or overwriting transitioning lifecycle state.
  - Only sessions in `"running"` status where native tracking has actually stopped unexpectedly are transitioned to `"interrupted"`.

### Area 4: Round 5 Sol Regressions (Resource Ownership, Partial Startup, Cross-Instance Cancellation)
- **Fix 1: Startup Rollback Resource Ownership Guard**:
  - Problem: A duplicate Start rejected while a session was running unconditionally called `speechAdapter.stop()`, disrupting audio in the active ride.
  - Resolution: `startDiagnosticsSession()` distinguishes between early validation rejections (unsupported background location, missing foreground/background permissions, or session already running/stopping) and failures after native startup has been initiated. Teardown of native location, speech silencing, and storage error recording are executed only if `nativeTrackingAttempted === true`. Duplicate starts and permission validation rejections do not touch native audio or location resources.
- **Fix 2: Partial Native Startup Teardown & Cleanup Failure Reporting**:
  - Problem: `nativeTrackingStarted` flag was set after `await locationAdapter.startBackgroundLocationUpdatesAsync(...)`. If native start partially succeeded and then rejected, no native tracking cleanup was attempted, and cleanup failures were swallowed.
  - Resolution: `nativeTrackingAttempted = true` is set immediately before calling `locationAdapter.startBackgroundLocationUpdatesAsync(taskName, ...)`. If startup rejects with partial activation, rollback executes `stopBackgroundLocationUpdatesAsync(taskName)` and `speechAdapter.stop()`. Any error occurring during cleanup (`cleanupError`) is captured, surfaced in the session storage `errorMessage`, and rethrown in the raised error (`... (rollback teardown failed: ...)`), preventing false reporting of safe state when teardown fails.
- **Fix 3: Cross-Instance Speech Cancellation & Stop Timeout Drain**:
  - Problem: The UI (`DiagnosticsView.tsx`) and background task (`task.ts`) instantiate separate `ExpoSpeechAdapter` instances. Because `generation` and `stopped` were instance variables, `ui.stop()` did not cancel background `speak()` dispatches awaiting native `Speech.stop()`. Furthermore, when `waitForInFlightTasks()` timed out during Stop, lifecycle ownership was released when tasks drained without running final native speech silence.
  - Resolution:
    1. In [`ExpoSpeechAdapter`](file:///home/henry/projects/ride-maker/apps/mobile/src/adapters/speech.ts), cancellation generation and stopped state are promoted to module scope (`sharedGeneration`, `sharedStopped`) for the shared native speech engine. Calling `stop()` on any adapter instance immediately aborts pending `speak()` dispatches on all other adapter instances before native `Speech.speak()` can be invoked.
    2. In [`stopDiagnosticsSession`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/session.ts), when in-flight tasks exceed `drainTimeoutMs`, lifecycle ownership (`activeLifecycleOp = "stopping"`) is retained until tasks drain. Upon drain completion, `onInFlightTasksDrained` executes final native speech silence (`await speechAdapter.stop()`) and only then releases lifecycle ownership (`activeLifecycleOp = null`).
    3. Added regression test in [`sol-round3-review.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/sol-round3-review.test.ts) validating real `ExpoSpeechAdapter` with mocked `expo-speech`: verifies dispatch longer than timeout retains lifecycle ownership, rejects new Start during drain, runs final native silence upon drain, and only then accepts a new Start.

### Area 5: Native Runtime Implementation Evidence & Single-Runtime JS Constraints
- **Installed Native Module Source Evidence (Android)**:
  - **`expo-task-manager`**:
    - Location on disk: [`node_modules/expo-task-manager/android/src/main/java/expo/modules/taskManager/TaskService.java`](file:///home/henry/projects/ride-maker/node_modules/expo-task-manager/android/src/main/java/expo/modules/taskManager/TaskService.java)
    - Lines 245–256: Maintains two separate maps: `sTaskManagers` (for foreground React contexts) and `sHeadlessTaskManagers` (for background headless runtimes).
    - Lines 405–413: `maybeStartHeadlessTask` integrates with `com.facebook.react.jstasks.HeadlessJsTaskContext` to acquire wakelocks and keep the JS event loop alive while running background jobs.
    - Lines 420–435: When the host activity is inactive, `getAppLoader().loadApp(...)` spins up an isolated headless React Native application context.
  - **`expo-location`**:
    - Location on disk: [`node_modules/expo-location/android/src/main/java/expo/modules/location/taskConsumers/LocationTaskConsumer.kt`](file:///home/henry/projects/ride-maker/node_modules/expo-location/android/src/main/java/expo/modules/location/taskConsumers/LocationTaskConsumer.kt)
    - Lines 75–100: `didReceiveBroadcast` and `handleLocationUpdate` check `mIsHostPaused`. When the host is active, fixes are dispatched immediately to the foreground task manager (`reportLocationsImmediately`). When paused or in the background, fixes are queued and batched (`deferLocations`).
    - Lines 305–325: `executeTaskWithLocationBundles` bundles fixes and dispatches them via `mTask?.execute(...)`.
- **Single-Runtime JS Locking Constraints**:
  - While the React Native host application process is alive (foreground or backgrounded with a foreground service), `expo-task-manager` dispatches location callbacks into the **main application JavaScript runtime** on the primary JS thread.
  - In this single-runtime mode, the in-memory directory promise queue (`runInDirectoryLock` / `directoryQueues`) serializes asynchronous operations inside the process.
  - If the Android OS terminates the host activity and later invokes an isolated headless TaskService, Android instantiates an independent headless JavaScript runtime. An in-memory JavaScript `Map` cannot synchronize across separate OS processes or distinct JS runtime contexts. If subsequent milestones require cross-runtime concurrency without an active host process, SQLite with WAL mode and transactions or POSIX file locks (`flock`) should be adopted.
- **Filesystem Atomicity & Fallback Caveats**:
  - In `FileSystemDiagnosticStorage.writeSessionDirect()`, atomic replacement is provided by writing to a temporary file (`session.json.tmp`) and atomically renaming it to `session.json` via `moveAsync()`.
  - **Non-Atomic Fallback Caveat**: When the underlying filesystem implementation does not provide `moveAsync` and falls back to direct `writeAsStringAsync()` on `session.json`, write operations do **not** provide atomic replacement guarantees. An unexpected process termination mid-write could result in truncated or invalid JSON.

---

## 2. Test & Verification Results

| Test Suite | File | Tests | Result |
|---|---|---|---|
| Sol Round 5 Regressions & Drain Tests | [`sol-round3-review.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/sol-round3-review.test.ts) | 6 | **Passed** |
| Expo Speech Adapter Cross-Instance Tests | [`speech.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/adapters/speech.test.ts) | 5 | **Passed** |
| Sol Followup Reproductions | [`sol-followup.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/sol-followup.test.ts) | 3 | **Passed** |
| Sol Comprehensive Extensions | [`sol-followup-comprehensive.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/sol-followup-comprehensive.test.ts) | 7 | **Passed** |
| Sol Lifecycle Review Regressions | [`sol-review-regressions.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/sol-review-regressions.test.ts) | 2 | **Passed** |
| Fake FileSystem Storage | [`file-storage.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/file-storage.test.ts) | 6 | **Passed** |
| Session Lifecycle & Errors | [`session.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/session.test.ts) | 8 | **Passed** |
| Task Handler & Concurrency | [`task.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/task.test.ts) | 5 | **Passed** |
| In-Memory Storage | [`storage.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/storage.test.ts) | 4 | **Passed** |
| Cue Schedule Logic | [`cue-schedule.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/diagnostics/cue-schedule.test.ts) | 6 | **Passed** |
| Navigation Engine | [`navigation.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/navigation.test.ts) | 5 | **Passed** |
| Route View Logic | [`route-view.test.ts`](file:///home/henry/projects/ride-maker/apps/mobile/src/route-view.test.ts) | 3 | **Passed** |
| **All Mobile Tests** | `npm test --workspace @ride-maker/mobile` | **60** | **Passed** |
| **Monorepo Typecheck** | `npm run check` | 8 pkgs | **Passed** |
| **Monorepo Test Suite** | `npm test` | 14 tasks | **Passed** |
| **Metro Android Export** | `npx expo export --platform android` | 699 modules | **Passed** (1.8MB HBC) |

---

## 3. Pending Items (Truthfully Reported)

1. **Physical Device Field Acceptance Gate**:
   - Requires executing the 20-minute locked-screen cycling/walking test protocol on a physical Android handset with GPS and text-to-speech hardware.
   - Remains pending until the owner installs the build on physical test hardware.

2. **APK Signing & Cloud Build**:
   - EAS Build credentials (`eas login` / project init) and local Android SDK toolchains are not configured on the remote headless Linux development environment.
   - Standalone APK configuration is complete in `apps/mobile/eas.json` for immediate cloud build execution by the repository owner.


## Sol integration (2026-10-10)

The integrated version passes 61 mobile tests, workspace checks/tests, and Android
Metro export. Sol kept Stop and blocked Clear Data for active tracking or error/
stopping state, propagated pre-dispatch native speech stop failure, and recorded
late drain speech teardown failures. The historical round tables above describe
Gemini's report before these integration changes. See `001-sol-integration.md`
for current scope and remaining gates.
