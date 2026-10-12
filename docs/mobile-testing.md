# Mobile testing strategy

Decision recorded 2026-10-11. Ride Maker is phone-first: import GPX, prepare and
save a ride locally, then navigate offline with spoken turns and the screen
locked. The website is an optional planning/sharing companion. A local ride
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

As of 2026-10-12 (Tasks 002 and 003 accepted Android emulator baseline):

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

- `apps/mobile/e2e/flows/`: committed Maestro flows (startup, invalid route, saved route, diagnostics, simulated ride, GPX import/preview, GPX persistence/offline, GPX import errors/cancel).
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
