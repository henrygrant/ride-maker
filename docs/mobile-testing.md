# Mobile testing strategy

Decision recorded 2026-10-11. Ride Maker is phone-first: create or import a ride, save it locally, and ultimately navigate offline
with spoken turns and the screen locked. The website is an optional planning/sharing companion. A local ride
must not require an account or the production website.

This document defines the test strategy and acceptance policy. It does not
claim that future replay, offline tile, or field gates are already satisfied.
Foundation implementation details and review gates are tracked in
[task 002](tasks/002-mobile-test-foundation.md).

## Decisions

- Use Maestro for native UI regression flows and interactive agent inspection.
  Its accessibility-based React Native support works with Expo development
  builds and standalone APKs; its MCP server provides agent interaction.
  Verify compatibility with our pinned Expo/React Native versions before
  adopting a specific Maestro version. Do not start by adding Detox or Appium.
- Run everyday automation against a dedicated Android emulator on the Mac.
  Keep the owner's Samsung for device smoke checks and physical field evidence.
  All automation scripts enforce strict device locking (`emulator-*` only;
  physical devices such as `R5CY52MQVCY` are blacklisted).
- Use deterministic ride replay for navigation decisions, and separate native
  GPS/audio checks for platform behavior. Replay is not evidence of background
  task delivery or audible speech.
- Test both development builds and standalone APKs. A standalone cold start
  without Metro is required for offline acceptance.
- Store assertions and fixtures in Git. Gemini explores the UI, reproduces
  failures, and writes repeatable flows; an agent's description alone is not a
  passing test result. Sol reviews changes and evidence against the contract.
- Keep the default suite local and independent of paid cloud runners, public
  routing services, production accounts, and mutable shared routes.

Primary references: [Maestro React Native support](https://docs.maestro.dev/get-started/supported-platform/react-native),
[Maestro MCP](https://docs.maestro.dev/get-started/maestro-mcp), and
[Expo's Maestro example](https://docs.expo.dev/eas/workflows/examples/e2e-tests/).
The Expo example is a reference; EAS Workflows is not required for our local runner.

## Current baseline

As of 2026-10-14 (Tasks 002–004 accepted Android emulator baseline):

- The existing app opens shared routes, renders MapLibre, and provides foreground
  guidance using `Location.watchPositionAsync` in `App.tsx`.
- Standalone JS independence does not guarantee offline maps: the app loads
  OpenFreeMap external styles online (`https://tiles.openfreemap.org/styles/liberty`).
  Offline map tiles and offline styles remain unimplemented; the app footer
  explicitly informs riders that open maps require network.
- Background diagnostics have unit/lifecycle tests and a preview APK.
  Physical locked-screen GPS/audio and battery field results remain pending; see
  [task 001](tasks/001-background-spike.md).
- Automated baseline runner (`scripts/mobile-e2e/run.sh`) executes on the Mac:
  target device is dedicated AVD `ride-maker-e2e` (Android 14, API 34, ARM64) on
  `emulator-5554`; owner Samsung `R5CY52MQVCY` is strictly protected.
- Mac checkout: `~/code/ride-maker`; Android SDK: `~/Library/Android/sdk`;
  Java 17 (`zulu-17.jdk`); Node is managed by nvm (`v24.16.0`);
  Maestro CLI version: `2.11.0`.
- Synthetic route fixture is located in NYC (`synthetictest01`): Start (-73.9700, 40.7800),
  turn right onto Test Way at (-73.9700, 40.7818), and destination arrival at (-73.9676, 40.7818).
  Native GPS injection uses `adb -s emulator-5554 emu geo fix <lon> <lat>`.
- Noninteractive execution uses authorized SSH key `id_ed25519_github_nauvis`.
  Direct provider MCP access remains unverified and pending.
- Six current-functionality flows passed three fresh runs; native GPS ride
  checkpoints and persisted post-stop invariance are independently reviewed.
  Consumer isolation and deliberate failure cases pass their expected checks.
- Local GPX import and durable route-data storage are accepted under task003:
  native picker, segmented previews, errors/cancel and byte-exact original
  persistence across cold restart with network blocked. Nine flows passed three
  fresh runs. Route preparation, offline maps and pure-engine replay remain pending.

Task004 creation and library management are accepted on the Android emulator.
Three fresh standalone runs passed all fourteen journeys; consumer isolation,
negative demos and mid-offline signal/ownership checks passed their required outcomes. Its expanded suite contains
fourteen journeys, including the runner-owned 09b offline subflow and 11b deletion
subflow. Native evidence is tracked in
[the task004 review](reviews/004-sol-mobile-creation-review.md).

### Task005 Concept A Floating Dock Baseline (accepted Android emulator pass)

The active creation flow has been overhauled under Task 005 to Concept A Floating Dock (full-bleed map, floating dock, staged search, 8-stop reorderable via stops, Locate route preservation, and blank name save recovery).

- **Baseline Status**: Single coherent full 14-journey baseline executed and PASSED (14/14 flows passed, 0 failed).
- **Run ID**: `run-20261014-135922` (Duration: 15m 32s; Started: 2026-10-14T17:59:22Z, Finished: 2026-10-14T18:14:54Z).
- **Test APK**:
  - SHA-256: `a18c0aef7908aa4af642e51de28ba88fc0b89e0706f7a5ee5327dd12add7c5ea`
  - Size: 122,771,000 bytes
  - Package: `net.thg3.ridemaker.e2e`
  - Cleartext Traffic: `true`
  - Source Fingerprint: `bfa7870d33571f0053f95fd66c86451bb91ec527d6d60e1f620a2bc378e2b453`
  - Harness Fingerprint: `3f9d3982939e13fb9a01ae506fc163ce0a99788aabffcfbd5940830a9ac3517d`
- **Unit Test Baseline**: 21 test files, 145 tests passing in `@ride-maker/mobile` (`vitest`). Includes 6 Round 3 tests in `src/controllers/create-ride-round3.test.ts`. (Historical Round 2 baseline had 20 files, 139 tests).
- **Rejected Historical Runs**:
  - Run `run-20261014-120225` was round 1, rejected due to Save naming assertion failure (confirmed by parent Sol via SSH review), not round 2 error banner dismissal.
  - Fabricated or unrecorded round 1 run IDs are explicitly rejected.
- **Fixture Pan & Placement Observation**:
  - Numeric pan coordinates are not asserted by automated trace (Flow 09 executes a map swipe gesture followed by tapping `button-cancel-map-placement`, verifying that cancellation discards candidate placement and preserves unconfirmed start state `"Where are we starting?"` without mutating the itinerary).
  - Map placement coordinate assignment is verified through confirmed placement actions (e.g. Finish location selected on map and committed to route data with live Valhalla snapped geometry).
- **Consumer Isolation & Live Route Persistence Evidence**:
  - Consumer APK: SHA-256 `c266b97b5e70b3395e76313684821c429b1cb23b16f8389999f8f8184202ddbf` (122,767,776 bytes, `net.thg3.ridemaker`, cleartext `false`).
  - Restored onto `emulator-5554` via `adb install -r` without clearing data; verified foreground visible (`mCurrentFocus=Window{... net.thg3.ridemaker/net.thg3.ridemaker.MainActivity}`).
  - On-disk verification of live consumer route `route-1791996561145-0o38w4` at `/data/data/net.thg3.ridemaker/files/local_routes/data/route-1791996561145-0o38w4/`:
    - `original.gpx`: 11,563 bytes, 228 `<trkpt` points.
    - `route.json`: 12,018 bytes, name "New Ride", 1 segment with 228 geometry coordinates, 2 control points, 5 maneuvers (235 items total), distance 2,921m, duration 433s. Live Valhalla route snap confirms the route follows roads (2.9km, 5 directions).

Final checkout audit removed unused duplicate files on the Mac; all actual app
source and test logic matched the reviewed Nauvis checkout. The full run above
remains evidence for the same implementation, with its original build identity.
Fresh builds from the normalized checkout passed creation and offline restart in
`run-20261014-142822-focused-09-create-ride-and-preview` (2/2). Final test source:
`85d3510ae5392b0aa0b71abdd3f141f8f25e1f6c271cbd0ab8c1bdea1cb1eed5`;
harness: `1d3f0e5053be4d5cb5f00d71c6460614aff4fb1d228be7eb1ce0104ad7738dcc`;
test APK: `df47ba77b7c6b678c89cb98df96c106867d412ad6b8055b1c5373f76b3d26c0a`.
Final consumer APK: `4d5d6b4be498ec20d6e9c478e7f23e4ce898e06762bee575aa84128f65bd9045`.
Non-destructive consumer checks (`clearState: false`) are recorded in the Mac's
`~/.maestro/tests/2026-10-14_143420/consumer-nondestructive/`: completed commands,
manifest and screenshot verify ordinary controls, no test badge/diagnostics,
and preservation of the existing local ride. The app remains on the visible
emulator. See [Sol's review](reviews/005-sol-floating-dock-review.md) for acceptance
scope and limitations.

## Test layers and what they prove

| Layer | Execution | Evidence and limitations |\
| --- | --- | --- |
| Pure logic | Vitest, no device | GPX validation, projection, maneuver order, cue deduplication, state transitions; no native guarantees |
| Ride replay | Pure engine and selected app UI flows | Timestamped fixes produce expected progress/events/screens; injected fixes bypass native GPS |
| Native UI E2E | Maestro on emulator | Import picker, permissions, route screens, start/pause/resume/end, storage/relaunch and visible errors |
| Device integration | Emulator native location injection, then Samsung | Location adapter, foreground service, task registration, speech callbacks and teardown; callbacks do not prove audibility |
| Field acceptance | Samsung, owner-assisted rides | Locked-screen continuity, audible prompts, Bluetooth behavior, GPS gaps and battery consumption |

Use a small set of UI flows to verify integration; cover the larger geometry
and timing matrix in fast pure tests. Include at least one route through the
native location adapter, so the replay path cannot conceal broken GPS wiring.
MapLibre's canvas contents are not reliably represented in accessibility trees:
assert visible maneuver/distance/status text, capture map screenshots, and
review overlays separately. A screen appearing does not prove map tiles loaded.

## Deterministic replay contract

Before implementing replay, define a reviewed interface around the production
navigation engine described in [the mobile plan](mobile-plan.md#navigation-contract).
Do not create a second algorithm just for tests.

A fixture contains a versioned prepared route, initial state, timestamped fixes
with accuracy/speed/heading where applicable, explicit pause/resume/end actions,
and expected events/checkpoints. Use an injected clock; avoid wall-clock sleeps
for maneuver timing. The same fixes and configuration must produce the same
result on repeated runs.

The app harness substitutes the location source, clock, and controlled service
responses at adapter boundaries while retaining production engine, screens,
and persistence. Record speech events separately as requested, dispatched,
completed, cancelled, or failed. A fake speech adapter proves scheduling only;
native callback tests and listening tests remain separate.

Required fixture cases: clean ride; missed turn and rejoin; inaccurate/drifting
GPS; stale and out-of-order fixes; implausible jumps; adjacent parallel paths;
loop with overlapping start/end; out-and-back; reversal; segment gaps;
closely spaced turns; pause/resume; stop during speech; interrupted session;
and arrival at the correct ending.

Expected results must be authored from the scenario, not regenerated from the
implementation being tested. Assert event order, maneuver IDs, deduplication,
progress/next-turn distances with stated tolerances, and meaningful error state.
Use synthetic or licensed/redacted fixtures, not the owner's private GPS track.

## UI test design and isolation

Use stable React Native `testID`s for actionable controls and important status
fields, plus useful accessibility labels for people and agent inspection. Prefer
IDs or labels over coordinates. Wait for observable state with bounded timeouts;
avoid arbitrary sleeps and blanket retries that hide races.

Each flow declares build type, fixture, starting permission/storage state,
network conditions, assertions, and teardown. Independent flows reset only the
dedicated test installation; a restart/persistence flow preserves data within
its own scenario. Set locale, units, and emulator profile explicitly.

Local/shared-route tests use a controlled API response and fixed prepared route.
Keep one separate opt-in staging contract test for real server integration.
Never create/delete production routes as part of the default suite. Future GPX
flows must exercise the Android document picker and verify copied app-private
storage, including access after restart, rather than only seeding parsed data.

Repository layout:

- `apps/mobile/e2e/flows/`: committed Maestro flows (startup, invalid route, saved route, diagnostics, simulated ride, GPX import/preview, GPX persistence/offline, GPX import errors/cancel, creation permission recovery, preview/save, created offline/GPS navigation, library rename/delete).
- `apps/mobile/e2e/fixtures/`: committed standard GPX fixtures (`standard-track.gpx`, `standard-route.gpx`, `malformed-syntax.gpx`).
- `apps/mobile/src/fixtures/`: canonical JSON fixtures (`synthetic-routes.json`) used by the controlled local API and fixture unit tests.
- `scripts/mobile-e2e/`: Mac runner (`run.sh`), synchronized native GPS feeder (`feed-gps.sh`), diagnostics verifier (`feed-diagnostics-gps.sh`), fixture server (`fixture-server.mjs`), manifest validator (`generate-manifests.mjs`).
- Pure replay tests beside the eventual `packages/navigation` engine.
- `.artifacts/mobile-e2e/<run-id>/`: ignored local output with manifests, summaries, scoped logs, and screenshots. Never commit generated recordings or device data.

Test controls must be absent or disabled in consumer production builds. Use an
explicit test build configuration; a public deep link must never activate fake
GPS, seed state, or expose traces in the production app. Label simulated mode
visibly (`TEST MODE` badge rendered when `EXPO_PUBLIC_TEST_MODE=true`). Also
verify ordinary standalone builds without harness activation.

## Coverage and acceptance matrix

Rows for future features become required when the feature lands. Mark them
pending now; an absent flow is not a pass.

| Journey | Assertions | Acceptance evidence |
| --- | --- | --- |
| Existing startup/shared route | Fixed route opens; native map renders; load error is actionable | Automated emulator flow plus screenshot review |
| Diagnostics start/stop | Permission feedback; service starts; state persists; stop prevents later fixes/cues | Unit lifecycle tests, UI flow and native integration |
| Local GPX import | Picker accepts track/route files; cancellation is harmless; malformed/oversized input gives a useful error | UI flows with real files (06-gpx-import-and-preview, 07-gpx-persistence-and-offline, 08-gpx-import-errors-and-cancel); parser and storage edge cases in unit tests |
| Preparation | Original preserved; gaps/deviations visible; instructions/indexes valid; unavailable service handled | Controlled service responses, pure validation and opt-in integration (Pending) |
| Active navigation | Next turn/progress update; cues occur once; off-route/rejoin and correct arrival | Replay assertions plus UI integration (Baseline native GPS verified; pure replay pending) |
| Pause/resume/end | No guidance while paused; resume policy explicit; end stops location/audio | Replay, UI and native teardown checks (Pending) |
| Offline ride | Completed download reopens after force-stop with network blocked and Metro stopped; map/turns usable | Standalone APK cold-start flow and physical check (Pending offline tile bundling) |
| Interrupted download/session | Incomplete ride cannot claim ready; resume/recovery explicit; force-stop cannot claim continued tracking | Persistence/relaunch flows and device check (Pending) |
| Permissions/settings | Foreground denied; background denied; cannot-ask-again; notification denied; location disabled | Emulator flows and Samsung spot checks |
| Screen lock/audio | Fixes and cues continue, stop succeeds, music/Bluetooth interruptions handled | Real 20-minute outing with counts/gaps, listening notes and battery delta (Pending task 001) |

For offline checks, prove the API/network is unreachable and Metro is stopped;
keep ADB connected for control if useful. In task 003, real offline evidence cuts
the device network via airplane mode, wifi/data disablement, and ADB reverse port removal.
Device-side socket and ICMP ping probes verify unreachable status and record to
`network-probe-offline.log`. Fixtures are managed within an owned folder
`/sdcard/Download/ride-maker-fixtures/` without blanket deletion of user Downloads.
Assert truthful UI status ("Saved route data is offline · foreground guidance only · maps require network"),
persistence after force-stop, and local storage retry banner handling.

## Build, device, and agent execution

The Mac owns the SDK, emulator/device, build, and Maestro process. An agent on
nauvis cannot use a Mac-local stdio MCP server simply by declaring it locally.
Prefer a Gemini provider running in the Mac's T3 environment with Maestro MCP.
If implementation remains on nauvis, use a documented SSH runner to execute
Maestro on the Mac and return evidence. Verify provider tool discovery instead
of assuming Gemini CLI instructions configure the managed Antigravity provider.

For foundation setup, test both interactive inspection (screen hierarchy,
screenshot, tap, assertion) and CLI flow execution. Pin and record the working
Maestro version (`2.11.0`), AVD system image/API/ABI (`ride-maker-e2e`, API 34,
ARM64), Java (`zulu-17.jdk`), Node (`v24.16.0`), and app dependency versions.
Do not expose ADB or an unauthenticated device-control endpoint publicly.

Use explicit device serials and serialize access: one device owner at a time,
no simultaneous Sol/Gemini/manual taps. Default to the emulator (`emulator-5554`).
A personal phone check must preserve existing app data unless its reset is explicitly
requested; run destructive reset scenarios on the dedicated emulator.

Development builds plus Metro provide the quick iteration loop. Rebuild native
binaries when native dependencies/configuration change. Standalone test APKs
bundle JavaScript and need no EAS payment. The dedicated emulator has no Metro
port forwarding; cold-start assertions verify independence while the owner
phone's separate Metro session stays running. Future offline gates must also
block network access.
Record the build command/profile and APK hash, not just the branch name.

## Run evidence and review policy

Each run produces a manifest with commit and dirty-tree status, APK hash/build
variant, fixture version, toolchain/device/OS, permissions/network conditions,
exact commands, exit status, and pass/fail/blocked results. Preserve failed runs
before retrying. Infrastructure failure is blocked; an assertion failure is
failed. A retry passing does not erase the first failure; investigate flakiness.

Capture flow reports, targeted screenshots, app-scoped logs, and navigation
traces. Traces include session/sequence IDs, fix timestamps/quality, selected
segment/progress/maneuver, state transitions, and speech lifecycle events. Keep
raw coordinates restricted to synthetic fixtures by default. Retain local run
artifacts for 14 days; copy selected redacted failure evidence to review storage
before expiry. Commit concise findings and artifact references, not raw logs,
credentials, account identifiers, or private location histories.

Gemini's feature handoff must include the reproduced journey, tests added,
commands/results, artifact locations, and remaining device/field gates. Sol
reviews both assertions and evidence. Do not weaken expectations to get green
without documenting and reviewing a changed product contract.

For each mobile feature: run relevant pure tests/typechecks and native UI flows;
for navigation changes add replay evidence; for offline/native/lifecycle changes
add standalone checks; for GPS/audio/background changes add physical evidence.
Label changes implemented-awaiting-field-validation until that gate passes.
Existing locked-screen acceptance remains pending under task 001.

## Implementation order

1. Complete task 002: Mac emulator and Maestro setup, verified Gemini access or
   SSH CLI fallback, reproducible startup flow, standalone launch, evidence
   capture and documented commands. No routing/navigation behavior changes.
2. Add deterministic local route/service fixtures and existing diagnostics
   permission/start/stop coverage. Extend only observable/test seams required.
3. Develop GPX import and local ride storage with picker/persistence flows under
   [task 003](tasks/003-local-gpx-import.md). Raw imports remain preview-only until
   turn preparation is implemented; offline route data does not imply offline maps.
4. Define production navigation engine interfaces and the replay fixture format,
   then build the replay matrix alongside the engine milestone.
5. Add offline/native/background acceptance flows as those features land and
   complete the physical field protocol before claiming reliable navigation.
6. Once local runs are stable, reuse the runner on a CI host with an emulator;
   keep real-device/field results a separate gate. iOS follows with its own
   simulator, permission/audio lifecycle, and physical-device evidence.
