# Task 002: mobile E2E testing foundation

Status: ACCEPTED for the current Android emulator baseline (2026-10-11).
Implementer: Gemini Flash/Pro; corrections and integration: Sol.

See [the strategy](../mobile-testing.md), [the mobile plan](../mobile-plan.md),
and [the review findings](../reviews/002-sol-baseline-review.md).

## Scope and implementation

The baseline tests existing startup, malformed and missing route IDs, shared
links, the saved-route map and foreground navigation controls, denied foreground
location permission, diagnostics lifecycle, and a simulated native GPS ride.
It adds no GPX import, route preparation, offline tiles, or navigation algorithm.

Six Maestro flows live in `apps/mobile/e2e/flows/`. A controlled HTTP endpoint in
`scripts/mobile-e2e/fixture-server.mjs` serves the canonical synthetic NYC route
from `apps/mobile/src/fixtures/synthetic-routes.json`. The app retains its real
PocketBase repository and normal screens. Consumer builds default to the public
API; test builds use loopback port 8088 forwarded only to the dedicated emulator.

The test variant is `net.thg3.ridemaker.e2e`, visibly labeled TEST MODE. Only this
variant enables cleartext HTTP (the manifest setting allows HTTP generally; the
fixture server itself binds to loopback). Consumer `net.thg3.ridemaker` keeps
cleartext disabled and omits test controls. Neither variant needs Metro to launch.
Offline map coverage and physical screen-lock/audio acceptance remain pending.

## Mac setup and commands

Verified host: Mac checkout `~/code/ride-maker`, Node 24.16.0 (nvm), Java 17.0.19
(Zulu), Android SDK `~/Library/Android/sdk`, Maestro 2.11.0 at
`~/.maestro/bin/maestro`. AVD `ride-maker-e2e` uses Android 14/API34,
google_apis/arm64-v8a; tests currently target `emulator-5554`.

Run from the repository root on the Mac:

```bash
./scripts/mobile-e2e/bootstrap.sh --variant all
./scripts/mobile-e2e/run.sh --serial emulator-5554
./scripts/mobile-e2e/run.sh --serial emulator-5554 --build-apk
./scripts/mobile-e2e/run.sh --serial emulator-5554 --verify-consumer
./scripts/mobile-e2e/run.sh --serial emulator-5554 --demo-failure
./scripts/mobile-e2e/run.sh --serial emulator-5554 --demo-gps-failure
```

`bootstrap.sh` installs dependencies, disables local dotenv loading, prebuilds
Android from the controlled variant configuration, and bundles standalone release
APKs. It preserves the source tsconfig and validates package/cleartext settings.
Content fingerprints cover mobile/shared sources, dependencies, configuration,
and native build scripts. A separate harness fingerprint records flows and
runner scripts, allowing test-only edits without recompiling the app. The runner
checks both source identity and the cached
APK hash. Changed sources rebuild; a tampered binary fails with a rebuild hint.

Automation requires an explicit emulator serial and verifies the exact AVD name.
It rejects physical devices, including the owner's Samsung. An atomic directory
lock serializes runs; stale locks require inspection, never automatic eviction.
Busy ports or existing reverse mappings cause refusal. Cleanup removes only its
own forwarding/processes and stops only an app installed by this run. Signals
return nonzero and preserve a failure summary. Owner Metro8081 and phone data
are preserved.

## Assertions and evidence

The GPS feeder seeds the native provider at the start before navigation, then
injects native Android fixes at start, intermediate progress,
off-route deviation and arrival. The midpoint expects 90 m remaining with a
20 m native-provider tolerance; the start must show 200 m within the same
tolerance, proving a decrease in distance. Pure geometry expectations are unchanged. The route overview also waits for
MapLibre's native fully-rendered event before capturing its screenshot. Each stage waits for the observed production
guidance and the corresponding Maestro screenshot before advancing. Fresh app
processes and PID-scoped logs prevent previous-flow state satisfying a stage.
Coordinates are synthetic: start (-73.9700,40.7800), intermediate
(-73.9700,40.7810), deviation (-73.9720,40.7805), finish (-73.9676,40.7818).

Diagnostics asserts that persisted sample counts increase while running. After
Stop it verifies native service/provider teardown, injects additional fixes, then
waits for a fresh persisted-storage snapshot and compares fix/cue counters before
Clear. Test-only polling and verification signals expose observations; they do
not replace the native location adapter or production session logic. Speech
callbacks alone do not establish acoustic audibility.

Ignored `.artifacts/mobile-e2e/<run-id>/` contains JSON metadata/summary, exact
per-flow Maestro output, actual checkpoint screenshots, PID-scoped app logs, GPS
feeder output and native diagnostics evidence. The consumer flow asserts startup
controls and absence of test controls, so a blank/crashed screen cannot pass.
The deliberate failure commands must exit nonzero and retain their evidence.

## Earlier implementation evidence

Pro round4 reported three six-flow passes (`run-20261011-180223`, `180555`,
`180921`), assertion failure `181252-failure-demo`, GPS failure
`181332-gps-failure-demo`, and consumer launch `182023-consumer-verify`.
Sol found additional evidence/isolation gaps afterward; those earlier runs are
not acceptance of the final corrected implementation. Pro round5 stopped on a
provider usage quota; Sol preserved its changes and finished the corrections.

## Remaining gates

Pure navigation replay, GPX picker/import, saved offline rides and map tile/style
bundling are future work. Maestro MCP discovery is unverified; the working agent
access path is SSH to the Mac plus CLI flows and UI hierarchy/screenshots.
Locked-screen GPS, audible speaker/Bluetooth prompts, interruption behavior and
battery cost require the physical protocol under task001. Do not claim reliable
field navigation based on emulator results.

## Final Sol acceptance

Three fresh clean-tree runs of the corrected six-flow suite passed:
`run-20261011-190032`, `run-20261011-190350`, `run-20261011-190705`.
Consumer startup/isolation passed in `run-20261011-191021-consumer-verify`.
Deliberate assertion and GPS feeder failures returned exit 1 in
`run-20261011-191135-failure-demo` and `run-20261011-191207-gps-failure-demo`.

The [final review record](../reviews/002-sol-baseline-review.md#sol-final-acceptance--2026-10-11)
contains APK/source/harness hashes, native counter checks, screenshot review,
clean bootstrap, cancellation, cache integrity and ownership evidence. Artifacts
are ignored; the review and repeatable commands are committed. Typechecks and
unit tests pass. Future/physical gates above remain pending.

Bootstrap regenerates the ignored Android directory for its selected variant.
To return to an ordinary development build after test builds, regenerate native
configuration with test mode disabled before compiling:

```bash
cd apps/mobile
EXPO_PUBLIC_TEST_MODE=false APP_ENV=development npx expo prebuild --platform android --clean --no-install
```

This prepares normal package configuration; device installation remains an
explicit development action, separate from the emulator-only suite.
