# Task 006: Approved Map Home, My Rides Sheet, and Selected-Ride Dock

## Status: Accepted Android UI Pass (Focused Scope)

- **Status**: Implementation completed; focused UI smoke & consumer validation verified; accepted after Sol code, screenshot and recorded-command review; see [review record](../reviews/006-sol-map-home-review.md).
- **Scope**: Focused verification (Map Home, My Rides Drawer, Selected Ride Dock, and consumer isolation). Not a full 14-journey regression run.
- **Approved Design Reference**: `.artifacts/design/map-home-concepts.html` approved by user ("This looks great. Do it.").

---

## Overview

Task 006 implements the user-approved "One Map, Three Surfaces" architecture for Ride Maker on Android:
1. **Map Home**: A persistent, full-bleed MapLibre map on startup with safe-area floating brand pill ("Ride Maker"), "My rides" count pill, camera-only Locate button, and floating "Where to today?" welcome dock with primary "+ Create ride" and secondary "Import GPX" buttons.
2. **My Rides Drawer**: A floating sheet that slides up over the *same* permanently mounted map without unmounting or reloading map tiles. Features local ride rows (with name, distance, truthful instructions readiness, and chevron), an empty state, a fixed footer for Create/Import, and a collapsible secondary section for shared route links, public routes, and test/dev diagnostics.
3. **Selected Ride Dock**: When a route is selected (via the drawer, creation save, or GPX import), the map renders the route's MultiLineString geometry and fits camera bounds. The dock displays the route title, prominent distance, readiness status badge, 3-dots options menu (Rename ride and Delete ride with name confirmation), and a primary "Ride" button (enabled only when turn instructions are verified ready; raw GPX imports display guidance preview notice and no active Ride button).

---

## Approved Design & Architecture

Based on `.artifacts/design/map-home-concepts.html`:

### 1. Map Home
- **Full-bleed Map**: Persistent root MapLibre GL map mounted once.
- **Top Brand Surface**: Floating pill at top-left containing route icon and "Ride Maker" text (`testID="text-brand"`), minimum 44dp touch target.
- **Top My Rides Pill**: Floating pill at top-right containing list icon, "My rides", and route count badge (`testID="home-open-myrides"`). Remains visible on selected route screens alongside the back button.
- **Test Mode Badge**: Floating `TEST MODE` badge (`testID="badge-test-mode"`) visible in test builds.
- **Locate Button**: Floating circular button (`testID="button-locate-me"`, 44dp+ min) on the right above the dock. Requests foreground location permission only upon explicit user tap and eases camera to current position. Displays actionable feedback if location access is denied or unavailable without blocking app actions.
- **Welcome Dock**: Floating bottom card (`styles.dock`) with `marginHorizontal: 16`, `bottom: safeArea + 12`, `borderRadius: 24`, micro-label "Make room for a ride", title "Where to today?", subtitle "Create a route, or bring one with you.", primary "+ Create ride" (`button-create-ride`), and secondary "Import GPX" (`button-import-gpx`).
- **Resilience**: Map render assertions rely strictly on real MapLibre callbacks (`onDidFinishRenderingMapFully`) without artificial timeouts. Offline checks truthfully assert saved data and geometry without depending on network tiles.

### 2. My Rides Drawer
- **Persistent Map**: Floats over the *same* mounted map; switching between home, library, and detail never swaps or unmounts the map.
- **Floating Sheet**: Card with `marginHorizontal: 16`, bottom gap (`bottom: safeArea + 12`), and rounded corners (`borderRadius: 24`, `overflow: "hidden"`).
- **Header**: Sheet handle bar, title "My rides", subtitle indicating saved count (or empty prompt), and top-right circular close button (`button-close-my-rides`, 44dp min).
- **Local Route List**: Scrollable list of saved routes showing thumbnail icon, ride name, distance, and truthful status ("Directions available" vs "GPX preview"). Supports 14+ items with scrolling.
- **Empty Library State**: Friendly guidance when 0 rides exist ("Your first ride starts here. Create a route or import a GPX. Your saved rides will live here.").
- **Fixed Footer**: "+ Create ride" primary and "Import GPX" secondary buttons fixed at the bottom while list scrolls.
- **Secondary Section**: Collapsible drawer section for pasting route links / IDs (`button-toggle-secondary-links`, `input-route-id`, `button-view-route`), public routes, dev diagnostics (`button-diagnostics-toggle`), and test seeding (`button-test-seed-library`).
- **Selection Behavior**: Tapping a route fits camera to bounds, closes drawer, and presents Selected Ride Dock.
- **Dismiss Behavior**: Close button or hardware back returns to previous context (Map Home or previously selected ride).

### 3. Selected Ride Dock
- **Geometry Display**: Stored MultiLineString coordinates rendered cleanly without bridging or distortion. Start (green S) and Finish (coral F) markers displayed.
- **Camera Bounds**: Memoized geometry (`route?.document`); camera `fitBounds` triggers strictly on selected route geometry change, not on UI toggles, renames, drawer opens, or ordinary pans. Dynamic bottom padding dynamically accounts for measured dock height and safe area insets.
- **Top Bar**: Back circle button (`button-back`, 44dp min) on top-left to clear selection and return to Map Home; "My rides" pill (`home-open-myrides`) on top-right to re-open library.
- **Dock Header**: Micro-label ("Saved ride", "Imported GPX", or "Shared route"), title (`text-route-title`), and 3-dots options menu button (`button-ride-options`, 44dp min).
- **Metrics**: Prominent distance display (`text-route-distance`) and readiness chip ("Directions ready" vs "Preview only").
- **Guidance Notice**: For routes without verified instructions (e.g. raw GPX imports), displays `text-guidance-notice` ("Turn-by-turn guidance is not available for raw GPX imports.") and omits or disables the Ride button.
- **Actions**: Secondary "My rides" button and Primary "Ride" button (`button-navigation-toggle`).
- **Options Menu & Dialogs**:
  - Tapping `button-ride-options` reveals popover menu with "Rename ride" (`button-rename-ride`) and "Delete ride" (`button-delete-ride`). Hardware back dismisses popover menu first before clearing route selection.
  - Rename dialog: atomic rename in storage via `input-rename-ride-name`, `button-rename-cancel`, `button-rename-confirm`. Ref busy guard protects double-execution; modal controls are disabled while pending; error messages are rendered inside the modal dialog; draft input value is retained on failure for easy retry; `KeyboardAvoidingView` supports small portrait screens.
  - Delete dialog: confirms deletion with exact ride name displayed (`text-delete-confirm-message`), `button-delete-cancel`, `button-delete-confirm`. Ref busy guard protects double-execution; error messages are rendered inside the modal dialog.
  - Switching routes unmounts/resets dock state via `key={route.id}` and target route ID refs prevent mutating mismatched routes.

---

## Parent Review Corrections Completed

1. **Map Render Test Hook**: Removed artificial 800ms timer setting `testMapRendered = true`. Observation relies strictly on real `onDidFinishRenderingMapFully` MapLibre callback.
2. **Camera Fit & Safe Area Padding**: Geometry memoized keyed on `route?.document`. Camera `fitBounds` guarded against re-fitting on UI toggle, rename, drawer open, or pan. Attribution position and camera padding dynamically measure actual dock and drawer heights.
3. **Floating Dock Design**: `MapHomeDock`, `SelectedRideDock`, and `MyRidesDrawer` updated to approved floating cards (`marginHorizontal: 16`, `bottom: safeArea + 12`, `borderRadius: 24`). Top "My rides" pill remains visible on selected ride view. Minimum touch targets >= 44dp.
4. **SelectedRideDock State Safety**: Popover menu dismissed by hardware back first. Ref busy guards prevent concurrent rename/delete writes. Controls disabled while busy. Modal error displays inside dialogs with draft retained. Target route ID refs prevent operations on mismatched routes.
5. **Locate Feedback**: Localized, actionable banner displayed when location permission is denied or location cannot be determined, leaving main actions unblocked.
6. **Pure Test Cleanup**: Removed mock implementations (`handleBack`, constant `canNavigate`) from `screenflow-transitions.test.ts`. Retained genuine production assertions for `validateRouteInstructions` and `routeGeometry`.

---

## Selective Testing Policy (User Agreement)

Per user agreement, mobile verification adheres to a selective testing policy:
- Prioritize targeted smoke and focused journey validation to catch genuine product, layout, and UI issues.
- Halt repetitive full-suite regression runs and stale-state infrastructure loops during focused UI handoffs.
- Historical full passes for Task 004 (14/14) and Task 005 (14/14, `run-20261014-135922`) stand as accepted historical baselines for their respective architectures, but do not imply or require an immediate 006 full regression suite run.
- No future completion promises; report completed concrete actions.

---

## Verification Evidence & Actual Executions

### 1. Pure Unit Tests & Typechecks
- **Unit Test Suite**: 147 tests passing across 22 test files (`npm run test --workspaces` in `@ride-maker/mobile`).
- **TypeScript Typecheck**: 0 errors across monorepo (`npm run check` / `npm --prefix apps/mobile run check`).

### 2. Actual Fresh Build Artifacts (Full 64-Character SHA-256 Hashes)
- **Test Release APK**:
  - Path: `/Users/henry/code/ride-maker/.artifacts/mobile-e2e/builds/app-test-release.apk`
  - SHA-256: `210285e0053d5aefb9e070950e8c77874e94a785fc1275f66d62f8b3cdbcc854`
  - Size: `122784120` bytes
  - Package: `net.thg3.ridemaker.e2e`
  - Cleartext Traffic: `true`
  - Source Fingerprint: `a7340ce2157148963046b617494a9aa9c0cf6344f672daa9a5e82dc0c890d767`
- **Consumer Release APK**:
  - Path: `/Users/henry/code/ride-maker/.artifacts/mobile-e2e/builds/app-consumer-release.apk`
  - SHA-256: `efc9007a5da87a8f93a059b9a39bfc610b9a3a11dda271312689b60cc4499b4d`
  - Size: `122780872` bytes
  - Package: `net.thg3.ridemaker`
  - Cleartext Traffic: `false`
  - Consumer Fingerprint: `21cd3acf8d802003c8dce26c7872546d23c231a79649fdb69d2a32ce5c98add8`
  - Installation: Installed via `adb install -r` preserving user's persistent data; verified visible in foreground (`mCurrentFocus=Window{... net.thg3.ridemaker/net.thg3.ridemaker.MainActivity}`).

### 3. Actual Maestro Runs & Test Directory IDs (Direct Maestro CLI)
Executed directly via Maestro CLI on the Mac (`~/.maestro/bin/maestro --device emulator-5554 test <flow>`):

- **Passing Smoke Test Flow 12**:
  - Test Directory: `~/.maestro/tests/2026-10-14_165523/12-map-home-and-sheet/`
  - Command: `~/.maestro/bin/maestro --device emulator-5554 test apps/mobile/e2e/flows/12-map-home-and-sheet.yaml`
  - Outcome: 56 COMPLETED commands, 4 screenshots captured (`12-map-home-initial`, `12-my-rides-drawer-open`, `12-selected-ride-dock`, `12-returned-to-map-home`).
  - Journey Validated: Map Home launch -> Open My Rides drawer -> Select Morning River Loop -> 3-dots options menu -> Back dismisses menu -> Rename ride modal -> Cancel -> Delete ride modal -> Cancel -> Back to Map Home.
- **Passing Non-Destructive Consumer Standalone**:
  - Test Directory: `~/.maestro/tests/2026-10-14_165752/consumer-standalone/`
  - Command: `~/.maestro/bin/maestro --device emulator-5554 test apps/mobile/e2e/flows/consumer-standalone.yaml`
  - Outcome: 22 COMPLETED commands, 2 screenshots captured (`consumer-standalone-main`, `consumer-foreground`).
  - Journey Validated: Cold launch with `clearState: false`, brand visible, drawer opens, preserved saved user route ("New Ride", 2.9 km · Directions available), toggle secondary links, no `TEST MODE` badge, no test seed button, no diagnostics toggle, close drawer back to Map Home. Parent direct read VERIFIED.

### 4. Preserved Failed Smoke Runs & Root Cause Disclosures
Failure records are retained for auditing rather than erased:

- **Run `~/.maestro/tests/2026-10-14_165446/12-map-home-and-sheet/`**:
  - Failed at command 9: `assertConditionCommand: idRegex: button-locate-me`.
  - Cause: Initial state locate control check timing before drawer open.
  - Correction: Corrected flow step sequencing and timing in run `165523`, completing all 56 commands.
- **Run `~/.maestro/tests/2026-10-14_165710/consumer-standalone/`**:
  - Failed at command 12: `assertConditionCommand: textRegex: NewRide`.
  - Cause: Text lookup regex omitted the space between "New" and "Ride".
  - Correction: Corrected regex to match `"New Ride"` in run `165752`, completing all 22 commands. Reusable flow `consumer-standalone.yaml` was subsequently updated to decouple from user-specific route names so it serves as a generic, reusable baseline on any dataset.

---

## Prior Run 164040 Status & Task-Owned Cleanup

### Run Audit
- Path: `/Users/henry/code/ride-maker/.artifacts/mobile-e2e/run-20261014-164040-focused-09-create-ride-and-preview`
- Contents: `metadata.json` and `09-create-ride-and-preview.log` exist, but **NO** `summary.json` was generated.
- Log Analysis: `09-create-ride-and-preview.log` ended with `Tap on id: button-close-my-rides... COMPLETED`.
- Status: Runner-owned 09b offline and post-processing steps were not recorded. This run is **NOT** claimed as PASSED overall. Recorded as UI journey completed in log; runner/09b acceptance status is unknown/incomplete.

### Task-Owned Orphan Process & Network Cleanup
- Orphan Detection: Fixture server process PID 97842 (ppid 1, `node /Users/henry/code/ride-maker/scripts/mobile-e2e/fixture-server.mjs`) remained listening on port 8088 (`radan-http`), with ADB reverse port mapping `tcp:8088 tcp:8088`. No runner shell process was active.
- Lock & Ownership Policy: Process audited before modification in compliance with runner ownership policies.
- Cleanup Executed:
  1. Removed ADB reverse mapping: `adb -s emulator-5554 reverse --remove tcp:8088`.
  2. Terminated orphan fixture server: `kill 97842`.
  3. Verified Metro process (PID 93242 on port 8081) was strictly untouched.
- Clean State Verified: Port 8088 free; emulator in clean consumer state (`mCurrentFocus=Window{... net.thg3.ridemaker/net.thg3.ridemaker.MainActivity}`). No further 09, 11, or full suite runs were started.
