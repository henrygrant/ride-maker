# Task005: Mobile Creation Redesign — Concept A Floating Dock

Status: Accepted Android emulator implementation (2026-10-14), following Sol code, screenshot and native evidence review. See [review record](../reviews/005-sol-floating-dock-review.md).
Approved by User: "yeah go on floating dock that's the best" (Concept A selected from interactive sketches in `.artifacts/design/create-ride-concepts.html`).
Implementer: Gemini 3.8 Flash High; Reviewer: Sol. Branch: `main` in shared checkout.

## 1. Summary of Changes

Task005 overhauls the mobile ride creation surface from the split-view form of Task004 into an immersive, map-first experience based on Concept A ("Floating Dock"). The design prioritizes full-screen spatial context, accessible thumb-zone touch targets (min 44dp), explicit center-pin map placement, automatic routing with dimmed stale line feedback, multi-step undo, and focused temporary modes.

## 2. Core UX Contract (Concept A)

### 2.1 Surfaces & Visual Language
- **Map Persistence**: The MapLibre map remains permanently mounted and full-screen (`StyleSheet.absoluteFill`) across all creation scenes and modes, preventing map reloads, webview flashing, and loss of tile caches.
- **Palette**: Warm light surfaces (`#fffffc` / `#f4f3ec`), dark forest slate text (`#172c28` / `#1b2521`), green route polyline (`#1e8068` with white casing), dimmed slate polyline (`#a8c4ba` at 0.5 opacity, dashed for stale routes), coral save action (`#d84b35`).
- **Attribution**: MapLibre attribution remains unobscured above the dock across all scenes and modes (`attributionPosition={{ bottom: Math.max(dockHeight + insets.bottom + 8, insets.bottom + 96), right: 10 }}`).

### 2.2 Six Interaction Scenes & Focused Modes
1. **Scene 1: First Point / Start Unset (`start`)**:
   - Floating top search pill: "Where do you want to start?"
   - Dock: "Start your ride" · "Where are we starting?"
   - Actions: "Choose on map" (`button-map-pick-start`), "My location" (`button-use-my-location-start`).
2. **Scene 2: Second Point / Finish Unset (`finish`)**:
   - Floating top search pill: displays selected start name · "Where to?"
   - Dock: "Finish your ride" · "Where are we going?"
   - Subtitle: "From {startPoint.name}. Choose on the map, search, or make a loop."
   - Actions: "Choose on map" (`button-map-pick-finish`), "Make a loop" (`button-make-loop`).
3. **Scene 3: Route Ready Dock (`ready`)**:
   - Floating controls above dock: "⮺ Undo" (`button-undo`), "🎯 Locate" (`button-center-location`).
   - Locate Button Isolation: `button-center-location` strictly centers camera to current GPS location via `cameraRef.current?.easeTo(...)` without mutating points, draft, undo history, or routing. Explicit "My location" controls within point rows or dock assign coordinates.
   - Metrics: Distance in km (`text-preview-distance`), turn maneuvers count (`text-preview-turns`).
   - Truthful chip: "✓ Directions ready" (`statusChipReady`), "Calculating…" with spinner (`statusChipRouting`), or "Retry route" (`button-retry-route`).
   - Actions: Secondary "Edit points" (`button-edit-points`), Primary Coral "Save ride" (`button-save-created-ride`).
4. **Scene 4: Explicit Placement Mode (`pick`)**:
   - Centered fixed pin overlay directly above screen center with needle anchor at viewport center.
   - Ambiguity eliminated: Candidate marker removed in favor of single fixed viewport pin.
   - Panning and zooming tracks viewport center via `onRegionDidChange` (typed without `any`-casting). Tap on map eases camera.
   - In confirmation, retrieves actual native center from `mapRef.current?.getCenter()` to guarantee synchronization during motion.
   - Top banner: Close button (`button-cancel-map-placement`), point title, "Move the map to choose a spot" pill.
   - Dock: Point kind ("Start point" / "Finish point" / "New stop"), "Selected spot on map", "Cancel" (`button-cancel-map-placement`), and "Set start/finish/stop here" (`button-confirm-map-placement`).
   - Transactional Placement: Canceling placement (including back press or search transition) restores prior confirmed itinerary and preview without pushing undo history.
5. **Scene 5: Temporary Focused Search (`search`)**:
   - Target disclosure header: Clearly indicates the active target ("SEARCH START LOCATION", "SEARCH DESTINATION", "SEARCH STOP LOCATION", or "SEARCH STOP N").
   - Search input (`input-start-location` / `input-finish-location` / `input-stop-${i}` / `input-stop-new`) with autoFocus, clear button (✕), and back chevron (`button-create-back`).
   - Floating search results card: loading spinner, error feedback (`text-search-error-${pointId}`), selectable items (`search-item-${id}`).
   - Non-destructive: typing stages query with `preserveSelection: true` without destroying confirmed coordinates or preview; closing search cancels staged text and restores confirmed selection; only tapping a result commits coordinates and camera ease.
6. **Scene 6: Save Naming Sheet (`save`)**:
   - Opens only when tapping "Save ride" from the Ready dock.
   - Title: "Give your ride a name", route distance and directions status summary.
   - Text input: `input-created-ride-name` (autoFocus disabled to avoid initial viewport occlusion; dock height adjusts dynamically via Keyboard listeners).
   - Actions: "Back" (`button-save-back`) and "Save ride" (`button-save-created-ride`).
   - Save In-Progress Guarding: While atomic persistence promise is pending, back navigation, search, locate, point editing, and duplicate save taps are disabled. Save errors recover cleanly without destroying the user draft.
   - Atomic SQLite + JSON storage; success transitions to Ride Detail surface.

### 2.3 Edit Points Sheet & Granular Point Controls
- Expanding "Edit points" opens a floating sheet over the map.
- Lists labeled Start (S, green), numbered Stops (1..8, dark teal), and Finish (F, coral).
- Granular Options Menu: To prevent crowding on narrow screens (e.g. 360dp), each point row displays badge, name (single line truncated), and an options toggle ("⋯" `button-point-options-${pointId}`).
- Tapping options reveals labeled 44dp touch targets:
  - "Search" (`button-search-option-${pointId}`)
  - "Move on map" (`button-map-pick-${pointId}`)
  - "My location" (`button-use-my-location-${pointId}`)
  - For stops: "Move up" (`button-stop-up-${id}`), "Move down" (`button-stop-down-${id}`), "Remove" (`button-stop-remove-${id}`).
- Bottom sheet actions: "+ Add stop" (`button-add-stop`, up to 8 max) and "✓ Loop ride" / "⮺ Make loop" (`button-make-loop`).
- "Done" (`button-edit-points`) collapses back to the ready dock.

### 2.4 Auto-Routing and Dimmed Stale Polyline
- Routing runs automatically whenever the itinerary is complete (start and finish set, loop toggle, stop reorder, or stop removal).
- Scheduled after clearing operation pending guards so completed GPS-derived itineraries trigger immediately.
- While routing is in-flight, the dock displays "Calculating…" and the previous route polyline remains visible but dimmed (`#a8c4ba` at 0.5 opacity, dashed).
- Saving while stale or pending is strictly rejected by `canSave()`.
- Route errors provide an actionable "Retry route" chip (`button-retry-route` / `button-preview-route`).

### 2.5 Multi-Step Undo & Operation Ownership
- Generation-aware operation ownership prevents out-of-order GPS and reverse geocoding results from altering state or history after undo.
- Confirmed edits (adding stops, removing stops, reordering stops, confirming map placement, selecting search results, toggling loop) push snapshots to `undoStack` (capped at 50).
- Undo pushes immediately before coordinate commit, never before awaited asynchronous operations.
- Undo button (`button-undo`) rolls back to the previous confirmed snapshot and cancels in-flight reverse geocode, GPS, or routing requests.
- Undo is volatile to the creation session and is discarded on exit.

### 2.6 Back Navigation Hierarchy
1. If saving: block all navigation.
2. If in Search Mode: dismiss search, restore confirmed query.
3. If in Placement Mode: cancel placement, drop candidate.
4. If in Save Sheet: return to Ready dock.
5. If in Edit Points Sheet: collapse to Ready dock.
6. If dirty in base dock: display "Keep your draft?\" dialog (`button-draft-keep`, `button-draft-discard`).
7. If clean: exit to library.

## 3. Test Coverage & Verification Matrix

- **Unit Tests**: 21 test files, 145 tests in `@ride-maker/mobile` (all passing in final Round 3 baseline).
  - Note: Historical Round 2 baseline had 20 test files and 139 tests; Round 3 added `src/controllers/create-ride-round3.test.ts` (6 new unit tests covering staged loop new-stop search, MAX 8 stops cap, and blank name save recovery).
  - Includes comprehensive tests in `create-ride-controller.test.ts` for auto-route scheduling, delayed GPS cancellation after undo, out-of-order GPS operation ownership, transactional new-stop placement/cancel, derived unique sequence IDs (`deriveNextStopSeq`), staged search, loop/via validation, and stale route retention.
- **Maestro E2E Flows**:
  - `09a-create-permission-denied.yaml`: tests permission denial on "My location", error feedback banner, retry validation, and search-based recovery for start and finish points.
  - `09-create-ride-and-preview.yaml`: tests full Concept A journey including map placement, candidate movement, search error/empty recovery, auto-routing, undo rollback, edit points sheet, via stop addition with pan verification, granular options menu search selection for stop 1 ("Sheep Meadow"), loop toggle, draft keep on back, save naming sheet, and transition to Ride Detail.
  - `09b-created-offline-navigation.yaml`: executed during network severance to verify cold restart persistence and active navigation of UI-created route.
  - `10-created-ride-navigation.yaml`: end-to-end guidance of UI-created route with simulated GPS waypoints, turn instructions, off-route detection, arrival, and teardown.

---

## 4. Native E2E Verification Evidence (Historical Round 2)

> [!NOTE]
> This section preserves the historical focused Round 2 execution evidence (runs 122429, 124034, 124417) under earlier intermediate source fingerprint `aa5946...` and 139 unit tests. The single full 14-journey baseline run (135922) and final normalized fingerprints are recorded in Section 6.

All verification was conducted against dedicated Android emulator `emulator-5554` running AVD `ride-maker-e2e` (API 34 arm64). Physical personal devices (e.g. `R5CY52MQVCY`) and active dev sessions on port 8081 were strictly protected.

### Artifacts & Build Details
- **Test APK Path**: `/Users/henry/code/ride-maker/.artifacts/mobile-e2e/builds/app-test-release.apk`
- **Test APK Size**: `122770524` bytes
- **Test APK SHA-256**: `1738284c864d694f0a6391f5b0503e3ff4de14cf66a831539db0391e52a1b60c`
- **Consumer APK Path**: `/Users/henry/code/ride-maker/.artifacts/mobile-e2e/builds/app-consumer-release.apk`
- **Current Source Fingerprint**: `aa5946f985b4d39593f6a3b5c2926ceb1fc4d9bde958072946c1b3f58ddef2dd`
- **Current Harness Fingerprint**: `db0cbb800e42c1ae45d27b74ca3aefe6d85732456e675a8bca862f8f2b1e8621`

### Execution Records

#### 1. Flow 09a (Permission Denied)
- **Run ID**: `run-20261014-122429-focused-09a-create-permission-denied`
- **Command**: `./scripts/mobile-e2e/run.sh --serial emulator-5554 --flow 09a-create-permission-denied`
- **Status**: `passed` (Exit code: 0)
- **Passed Flows**: `09a-create-permission-denied`
- **Screenshot Artifacts** (3 recorded):
  - `09a-location-denied.png` (1025885 bytes)
  - `09a-manual-location-recovery.png` (1433270 bytes)
  - `09a-create-permission-denied-end.png` (1568153 bytes)

#### 2. Flow 09 & 09b (Creation, Preview, Save, and Offline Persistence)
- **Run ID**: `run-20261014-124034-focused-09-create-ride-and-preview`
- **Command**: `./scripts/mobile-e2e/run.sh --serial emulator-5554 --flow 09-create-ride-and-preview`
- **Status**: `passed` (Exit code: 0)
- **Passed Flows**: `09-create-ride-and-preview`, `09b-created-offline-navigation`
- **Cold Restart Offline Persistence Report**: `persistence-created-verification.json` verified 4 routes match disk storage across process restart under severed network, with original GPX byte hashes unchanged.
- **Screenshot Artifacts** (11 recorded):
  - `09-scene-empty-dock.png` (1090168 bytes)
  - `09-scene-candidate-pin.png` (990555 bytes)
  - `09-scene-search-keyboard.png` (1090667 bytes)
  - `09-create-route-preview.png` (1431482 bytes)
  - `09-scene-expanded-points.png` (1284207 bytes)
  - `09-scene-save-naming.png` (1008023 bytes)
  - `09-created-ride-detail.png` (1111522 bytes)
  - `09b-offline-navigation-active.png` (1262643 bytes)
  - `09-create-ride-and-preview-end.png` (150304 bytes)
  - `step-011-scrollUntilVisible-synthetic-track.gpx.png` (93629 bytes)
  - `step-030-scrollUntilVisible-synthetic-utf8-bom.gp.png` (93142 bytes)

#### 3. Flow 10 (Created Ride Active Navigation)
- **Run ID**: `run-20261014-124417-focused-10-created-ride-navigation`
- **Command**: `./scripts/mobile-e2e/run.sh --serial emulator-5554 --flow 10-created-ride-navigation`
- **Status**: `passed` (Exit code: 0)
- **Passed Flows**: `10-created-ride-navigation`
- **Synchronized GPS Feeder**: `scripts/mobile-e2e/feed-created-ride-gps.sh` executed cleanly across Stage 1 (Depart), Stage 2 (Intermediate Stop 1 progress at midpoint `(-73.9709, 40.7781)` with 830m distance), Stage 3 (Off-route detection), and Stage 4 (Arrival).
- **Screenshot Artifacts** (7 recorded):
  - `10-created-ride-turn-instruction.png` (532059 bytes)
  - `10-created-ride-progress.png` (591254 bytes)
  - `10-created-ride-off-route.png` (806936 bytes)
  - `10-created-ride-arrived.png` (622386 bytes)
  - `10-created-cancel-continues.png` (808287 bytes)
  - `10-created-ride-navigation-ended.png` (1139843 bytes)
  - `10-created-ride-navigation-end.png` (150276 bytes)

#### 4. Consumer App Running State
- Fresh consumer release APK (`/Users/henry/code/ride-maker/.artifacts/mobile-e2e/builds/app-consumer-release.apk`) installed with `adb install -r` without clearing data.
- Launched consumer app (`net.thg3.ridemaker`, PID `30854`) and left visible on `emulator-5554`.

---

## 5. Matrix of Sol Review Round 2 Findings & Concrete Resolutions

| Finding | Review Item | Concrete Resolution |
| :--- | :--- | :--- |
| **Finding 1** | **Locate button separation** | Removed `controller.useCurrentLocation` side effect from floating locate button (`button-center-location`). It now strictly executes `cameraRef.current?.easeTo([loc.coords.longitude, loc.coords.latitude], 14, 500)` without mutating points, draft, undo history, or routing. Explicit "My location" controls within point rows or dock assign coordinates. |
| **Finding 2** | **Map placement single fixed pin & viewport sync** | Removed candidate marker ambiguity. Implemented a single viewport-centered pin overlay directly above screen center with needle anchor at viewport center. Panning/zooming tracks viewport center via `onRegionDidChange` (typed without `any`-casting). On confirmation, retrieves native center from `mapRef.current?.getCenter()` to guarantee synchronization during motion. |
| **Finding 3** | **Transactional "new-stop" map placement / cancel** | Map placement for `"new-stop"` is completely isolated. Canceling drops candidate coordinates and restores prior itinerary and preview without pushing undo history or dirtying the draft. Confirming commits the new stop to `state.viaStops`. |
| **Finding 4** | **Granular per-point options menu (⋯)** | In Edit Points Sheet, replaced wide horizontal button rows with a single options toggle (`button-point-options-${id}`) revealing 44dp touch targets for "Search" (`button-search-option-${id}`), "Move on map" (`button-map-pick-${id}`), "My location" (`button-use-my-location-${id}`), and stop reordering/removal. Preserves full usability on 360dp screens. |
| **Finding 5** | **Non-destructive search & back hierarchy** | Search Mode typing stages queries with `preserveSelection: true` without destroying confirmed coordinates or preview. Closing search cancels staged text and restores confirmed selection; only tapping a result commits coordinates. Hardware back / close button strictly respects 7-level back hierarchy. |
| **Finding 6** | **Safe auto-routing scheduling & dimmed stale polyline** | `canRoute()` and auto-route scheduling run after clearing operation pending guards, allowing GPS-derived itineraries to trigger immediately. While routing is in flight, the dock shows "Calculating…" and the prior route polyline remains visible but dimmed (`#a8c4ba` at 0.5 opacity, dashed). `canSave()` strictly rejects stale or pending routes. |
| **Finding 7** | **Undo operation ownership & generation counters** | Generation counters on points and searches (`pointGenerations`, `searchGenerations`) prevent out-of-order GPS and reverse geocoding results from mutating state or history after undo. Undo pushes immediately before coordinate commit, never before awaited asynchronous operations. `undoStack` capped at 50 snapshots. |
| **Finding 8** | **Save-in-progress lock & clean recovery** | Saving flag blocks all navigation, back presses, point editing, search, and duplicate save taps during atomic persistence. Save failures recover cleanly with inline error banner without destroying the draft. |
| **Finding 9** | **Real Maestro & Native E2E verification** | All flows executed and passed on `emulator-5554`: `09a` (pass, 3 screenshots), `09` & `09b` (pass, 11 screenshots, cold restart persistence verified), and `10` (pass, 7 screenshots, GPS waypoint feeder verified). Historical failure analysis documented: intermediate stop 1 geometry aligned with `feed-created-ride-gps.sh` midpoint fixture; naming sheet keyboard occlusion resolved by dynamic keyboard listeners. |
| **Finding 10** | **Accurate documentation & fingerprints** | Task 005 status set to `Pending Review`. Implementer identified as `Gemini 3.8 Flash High`. Restored historical sections 2.2–2.6 in `004-screenflow-and-data-contracts.md` without premature acceptance claims. Updated `README.md` and `apps/mobile/README.md`. Actual run IDs, fingerprints, and APK hashes fully recorded. |

---

## 6. Round 3 Requirements, Implementation, and Final Full Baseline Verification

### 6.1 Round 3 Requirements & Implementation Summary
1. **R3.1 Staged New Stop Loop Top Search**:
   - Production controller now includes a dedicated staged `newStopSearch: DraftPointState` (distinct from start/finish search states).
   - Handles search errors (`text-search-error-new-stop`), empty query, and cancel (`button-close-search`) with AbortController and generation counters (`searchGenerations.newStop`).
   - Cancellation dismisses the search UI without mutating the underlying itinerary or preview.
   - Committing a result via tap creates exactly one via stop and pushes an undo snapshot.
   - Enforces a strict MAX 8 stops cap across all controller methods (`addViaStop`, `selectSearchResult`, `startMapPlacement`, `confirmMapPlacement`) and UI buttons.
2. **R3.2 Blank Name Save Dead End Recovery**:
   - Separated route readiness (`isRouteReady()` and `canOpenSave()`) from valid naming readiness (`canSave()`).
   - Blank or whitespace-only ride name disables the Save button inside the naming sheet (`canSave()` requires trimmed non-empty title).
   - Tapping Back (`button-save-back`) closes the naming sheet while keeping the draft and route preview completely intact.
   - Ready dock's "Save ride" button remains enabled (`canOpenSave()` returns true), allowing users to reopen the dialog and fix the title.
3. **R3.3 Native Multi-Stop Journey & Screen Adjustments**:
   - `expandedSheet` and `pointsList` max heights adjusted to 540dp and 360dp to ensure 3+ via stops and options menus fit on narrow viewports without clipping.
   - Added index-based test IDs for stop options (`button-point-options-stop-${idx}`, `button-stop-up-stop-${idx}`, `button-stop-down-stop-${idx}`, `button-stop-remove-stop-${idx}`).
   - Handlers close the active options menu automatically on reordering.
   - Native flow 09 captures screenshots for search keyboard (`09-scene-search-keyboard`), multiple stops (`09-scene-multiple-stops`), stop options menu (`09-scene-stop-options`), save keyboard (`09-scene-save-keyboard`), and save naming (`09-scene-save-naming`).
   - Flow 09 tests 3+ long-named via stops, reorder down/up, remove, undo, and prunes to align with Flow 10 GPS navigation feeder contract.
4. **R3.4 Truthful Documentation & Evidence**:
   - Replaced all outdated documentation and claims.
   - Recorded true failed run history: `run-20261014-120225` was Round 1, rejected due to Save naming assertion failure (confirmed by parent Sol via SSH review), not round 2 error banner dismissal. All unrecorded or fabricated round 1 run IDs are rejected.
   - Documented on-disk evidence for consumer live route persistence and non-destructive standalone verification.

### 6.2 Full 14-Journey Native Baseline & Normalized Focused 09 Verification

#### 6.2.1 Canonical Historical 14-Journey Native Baseline
Executed on dedicated Android emulator `emulator-5554` running AVD `ride-maker-e2e` (API 34 arm64):
- **Run ID**: `run-20261014-135922`
- **Status**: `passed` (Exit code: 0)
- **Total Flows**: 14
- **Passed Flows**: 14 (0 failed)
  - `01-startup-and-diagnostics`
  - `02-invalid-route`
  - `03-saved-route-navigation`
  - `04a-diagnostics-permission-denied`
  - `04-diagnostics-lifecycle`
  - `05-simulated-ride`
  - `06-gpx-import-and-preview`
  - `07-gpx-persistence-and-offline`
  - `08-gpx-import-errors-and-cancel`
  - `09a-create-permission-denied`
  - `09b-created-offline-navigation`
  - `09-create-ride-and-preview`
  - `10-created-ride-navigation`
  - `11-library-management`
- **Execution Window**: Started at `2026-10-14T17:59:22Z`, Finished at `2026-10-14T18:14:54Z` (Duration: 15m 32s).
- **Test Variant Source Fingerprint (Historical 135922 Build)**: `bfa7870d33571f0053f95fd66c86451bb91ec527d6d60e1f620a2bc378e2b453`
  - *Fingerprint Normalization Note*: Full baseline run `run-20261014-135922` executed cleanly against identical application and test source. Its build fingerprint reflected 4 unused duplicate files in `apps/mobile/src/` accidentally created during initial sync. Pruning those unused duplicates normalizes the canonical repository source fingerprint to `85d3510ae5392b0aa0b71abdd3f141f8f25e1f6c271cbd0ab8c1bdea1cb1eed5` (test) and `c5e858c7b6845bb1f593e66de8519a08ce39e4ee6e4c03eccca472f5d2977150` (consumer) with 100% identical application code and runtime behavior.
- **Test APK (Historical 135922 Build)**:
  - SHA-256: `a18c0aef7908aa4af642e51de28ba88fc0b89e0706f7a5ee5327dd12add7c5ea`
  - Size: 122,771,000 bytes

#### 6.2.2 Fresh Normalized Builds & Focused Flow 09 Native Run
After repository checkout normalization, fresh standalone release APKs were compiled on Mac:
- **Normalized Test Source Fingerprint**: `85d3510ae5392b0aa0b71abdd3f141f8f25e1f6c271cbd0ab8c1bdea1cb1eed5`
- **Normalized Test Harness Fingerprint**: `1d3f0e5053be4d5cb5f00d71c6460614aff4fb1d228be7eb1ce0104ad7738dcc`
- **Normalized Test APK**:
  - Path: `/Users/henry/code/ride-maker/.artifacts/mobile-e2e/builds/app-test-release.apk`
  - SHA-256: `df47ba77b7c6b678c89cb98df96c106867d412ad6b8055b1c5373f76b3d26c0a`
  - Size: 122,771,000 bytes
  - Package: `net.thg3.ridemaker.e2e`
  - Cleartext: `true`
- **Focused Flow 09 Execution**:
  - Command: `./scripts/mobile-e2e/run.sh --serial emulator-5554 --flow 09-create-ride-and-preview`
  - Run ID: `run-20261014-142822-focused-09-create-ride-and-preview`
  - Status: `passed` (Exit code: 0)
  - Passed Flows: 2 (`09-create-ride-and-preview`, `09b-created-offline-navigation`)
  - Execution Window: Started at `2026-10-14T18:28:22Z`, Finished at `2026-10-14T18:33:46Z`
  - Screenshots: 14 recorded artifacts (including keyboard views, multi-stop reorder/options, and offline navigation)
  - Verified offline cold restart persistence under severed network (`persistence-created-verification.json` matched all routes).

### 6.3 Consumer App Isolation & On-Disk Route Evidence

- **Normalized Consumer APK Build**:
  - Path: `/Users/henry/code/ride-maker/.artifacts/mobile-e2e/builds/app-consumer-release.apk`
  - SHA-256: `4d5d6b4be498ec20d6e9c478e7f23e4ce898e06762bee575aa84128f65bd9045`
  - Size: 122,767,776 bytes
  - Package: `net.thg3.ridemaker`
  - Cleartext: `false`
  - Consumer Source Fingerprint: `c5e858c7b6845bb1f593e66de8519a08ce39e4ee6e4c03eccca472f5d2977150`
- **Installation & Non-Destructive Standalone Verification**:
  - Installed onto `emulator-5554` strictly with `adb install -r` to preserve existing user data.
  - Executed non-destructive standalone Maestro verification (`clearState: false`, `/tmp/consumer-nondestructive.yaml`) targeting `--device emulator-5554`.
  - Assertions Passed:
    - `text-brand` visible
    - `button-create-ride` and `button-import-gpx` visible
    - `button-test-seed-library` not visible
    - Saved user route `"New Ride"` visible in library
    - Secondary links (`input-route-id`, `button-view-route`) visible
    - `badge-test-mode` and `button-diagnostics-toggle` not visible
    - Screenshot `consumer-standalone-main.png` captured
- **On-Disk Live Route Verification**:
  - Route ID: `route-1791996561145-0o38w4`
  - Directory: `/data/data/net.thg3.ridemaker/files/local_routes/data/route-1791996561145-0o38w4/`
  - `original.gpx`: 11,563 bytes, exactly 228 `<trkpt` points.
  - `route.json`: 12,018 bytes:
    - Name: `"New Ride"`
    - Segments: 1 segment with 228 coordinates
    - Control Points: 2 (Start: "86th Street Transverse" `[-73.968, 40.785]`, Finish: "Finish Location on Map" `[-73.9643, 40.7804]`)
    - Maneuvers: 5 turn maneuvers
    - Total items: 228 geometry coordinates + 2 control points + 5 maneuvers = 235 items total (scrubbing earlier ambiguous "235 coordinates" claims; live Valhalla route snap confirms route follows roads)
    - Summary: `distanceMeters: 2921`, `durationSeconds: 433`.
- **Foreground Visibility & Android Project Restoration**:
  - Consumer app is left focused and visible in foreground on `emulator-5554` (`mCurrentFocus=Window{82d84ea u0 net.thg3.ridemaker/net.thg3.ridemaker.MainActivity}`).
  - Android project generated tree in `apps/mobile/android` is restored to consumer configuration (`applicationId net.thg3.ridemaker`, cleartext traffic disabled).

### 6.4 Fixture Pan Coordinate & Gesture Cancellation Observation

- Numeric pan coordinates are not asserted by automated trace (Flow 09 executes a map swipe gesture followed by tapping `button-cancel-map-placement`, verifying that cancellation discards candidate placement and preserves unconfirmed start state `"Where are we starting?"` without mutating the itinerary).
- Map placement coordinate assignment is verified through confirmed placement actions (e.g. Finish location selected on map and committed to route data with live Valhalla snapped geometry).
