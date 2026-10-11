# Mobile testing strategy

Decision recorded 2026-10-11. Ride Maker is phone-first: import GPX, prepare and
save a ride locally, then navigate offline with spoken turns and the screen
locked. The website is an optional planning/sharing companion. A local ride
must not require an account or the production website.

This document defines the test strategy and acceptance policy. It does not
claim that the proposed harness, emulator, or flows are implemented. Start
implementation with [task 002](tasks/002-mobile-test-foundation.md).

## Decisions

- Use Maestro for native UI regression flows and interactive agent inspection.
  Its accessibility-based React Native support works with Expo development
  builds; its MCP server provides agent interaction. Verify compatibility with
  our pinned Expo/React Native versions and actual Gemini provider before
  adopting a specific Maestro version. Do not start by adding Detox or Appium.
- Run everyday automation against a dedicated Android emulator on the Mac.
  Keep the owner's Samsung for device smoke checks and physical field evidence.
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

As of 2026-10-11:

- The existing app opens shared routes, renders MapLibre, and provides foreground
  guidance. Local GPX import and durable offline rides are not implemented.
- Background diagnostics have 61 mobile unit/lifecycle tests and a built preview
  APK. Actual locked-screen GPS/audio and battery results remain pending; see
  [task 001](tasks/001-background-spike.md).
- A local Expo Android development APK was built on the Mac from commit
  `996cf37`, installed on the owner's Samsung, and loaded from Mac Metro over
  USB. This was a manual smoke check, not an automated E2E suite.
- Mac checkout: `~/code/ride-maker`; Android SDK:
  `~/Library/Android/sdk`; Java 17; Node is managed by nvm. Noninteractive SSH
  sessions need explicit toolchain initialization.
- No AVD was listed by `emulator -list-avds`; Maestro was not found on the
  noninteractive SSH command path. Installation and provider MCP access are
  unverified. No repository Maestro flows, replay harness, or E2E runner exist.

## Test layers and what they prove

| Layer | Execution | Evidence and limitations |
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

Proposed repository layout (create as the foundation is implemented):

- `apps/mobile/e2e/flows/`: committed Maestro flows grouped by smoke and feature.
- `apps/mobile/e2e/fixtures/`: GPX, prepared routes, replay fixes, expected events,
  and fixture provenance/version notes.
- `scripts/mobile-e2e/`: Mac runner, toolchain/device checks, build/install,
  fixture staging, evidence capture, teardown, and exit-status handling.
- Pure replay tests beside the eventual `packages/navigation` engine.
- `.artifacts/mobile-e2e/<run-id>/`: ignored local output; add its ignore rule
  when the runner is introduced. Never commit generated recordings or device data.

Test controls must be absent or disabled in consumer production builds. Use an
explicit test build configuration; a public deep link must never activate fake
GPS, seed state, or expose traces in the production app. Label simulated mode
visibly. Also verify ordinary standalone builds without harness activation.

## Coverage and acceptance matrix

Rows for future features become required when the feature lands. Mark them
pending now; an absent flow is not a pass.

| Journey | Assertions | Acceptance evidence |
| --- | --- | --- |
| Existing startup/shared route | Fixed route opens; native map renders; load error is actionable | Automated emulator flow plus screenshot review |
| Diagnostics start/stop | Permission feedback; service starts; state persists; stop prevents later fixes/cues | Unit lifecycle tests, UI flow and native integration |
| Local GPX import | Picker accepts track/route files; cancellation is harmless; malformed/oversized input gives a useful error | UI flows with real files; parser edge cases in unit tests |
| Preparation | Original preserved; gaps/deviations visible; instructions/indexes valid; unavailable service handled | Controlled service responses, pure validation and opt-in integration |
| Active navigation | Next turn/progress update; cues occur once; off-route/rejoin and correct arrival | Replay assertions plus UI integration |
| Pause/resume/end | No guidance while paused; resume policy explicit; end stops location/audio | Replay, UI and native teardown checks |
| Offline ride | Completed download reopens after force-stop with network blocked and Metro stopped; map/turns usable | Standalone APK cold-start flow and physical check |
| Interrupted download/session | Incomplete ride cannot claim ready; resume/recovery explicit; force-stop cannot claim continued tracking | Persistence/relaunch flows and device check |
| Permissions/settings | Foreground denied; background denied; cannot-ask-again; notification denied; location disabled | Emulator flows and Samsung spot checks |
| Screen lock/audio | Fixes and cues continue, stop succeeds, music/Bluetooth interruptions handled | Real 20-minute outing with counts/gaps, listening notes and battery delta |

For offline checks, prove the API/network is unreachable and Metro is stopped;
keep ADB connected for control if useful. Assert tile/style/font/sprite coverage
as well as saved route data. Force-stop/relaunch is distinct from merely
backgrounding the app. Do not promise navigation survives Android force-stop.

## Build, device, and agent execution

The Mac owns the SDK, emulator/device, build, and Maestro process. An agent on
nauvis cannot use a Mac-local stdio MCP server simply by declaring it locally.
Prefer a Gemini provider running in the Mac's T3 environment with Maestro MCP.
If implementation remains on nauvis, use a documented SSH runner to execute
Maestro on the Mac and return evidence. Verify provider tool discovery instead
of assuming Gemini CLI instructions configure the managed Antigravity provider.

For foundation setup, test both interactive inspection (screen hierarchy,
screenshot, tap, assertion) and CLI flow execution. Pin and record the working
Maestro version, AVD system image/API/ABI, Java/Node and app dependency versions.
Do not expose ADB or an unauthenticated device-control endpoint publicly.

Use explicit device serials and serialize access: one device owner at a time,
no simultaneous Sol/Gemini/manual taps. Default to the emulator. A personal
phone check must preserve existing app data unless its reset is explicitly
requested; run destructive reset scenarios on the dedicated emulator.

Development builds plus Metro provide the quick iteration loop. Rebuild native
binaries when native dependencies/configuration change. Standalone test APKs
bundle JavaScript, need no EAS payment, and must be tested with Metro stopped.
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
   SSH CLI fallback, one reproducible startup flow, standalone launch, evidence
   capture and documented commands. No routing/navigation behavior changes.
2. Add deterministic local route/service fixtures and existing diagnostics
   permission/start/stop coverage. Extend only observable/test seams required.
3. Define production navigation engine interfaces and the replay fixture format,
   then build the replay matrix alongside the engine milestone.
4. Develop GPX import and local ride storage with picker/persistence flows.
5. Add offline/native/background acceptance flows as those features land and
   complete the physical field protocol before claiming reliable navigation.
6. Once local runs are stable, reuse the runner on a CI host with an emulator;
   keep real-device/field results a separate gate. iOS follows with its own
   simulator, permission/audio lifecycle, and physical-device evidence.
