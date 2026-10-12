# Task 003: local GPX import and saved routes

Status: ACCEPTED for Android import/preview/local route-data persistence (2026-10-12).
Owner: Sol; implementer: Gemini 3.1 Pro (High). Sol reviews before acceptance.
Prerequisite: task 002 accepted at `1b1bf9f`.

## Product decision

Henry chose GPX import and local storage before the nuanced navigation engine.
Keep the product dead simple. The eventual primary flow is Open GPX → preview →
Ride. This phase delivers import, preview, automatic saving and reopening.
Navigation, instruction generation and offline maps follow in separate tasks.
Route creation is deferred; the website remains an optional companion.

Home has one prominent Import GPX action and a compact saved-route list. Selecting
an imported route shows its name, distance and original geometry, with Back.
Save automatically after validation; no save wizard, account or setup questionnaire.
Retain shared-link access and diagnostics without making them the main journey.
Do not redesign the entire app or introduce routing preferences, training metrics,
social features, route editing or new settings.

A raw GPX has no generated maneuvers. Show a plain message such as “Route saved.
Turn-by-turn guidance is coming next.” Do not enable Ride for an unprepared
import or infer turns from bends. Existing prepared shared routes must retain
their current navigation behavior. Saved route data is available offline; map
backgrounds still require network. Never label an import ready for offline navigation.

## Scope and boundaries

- Extend the existing Expo app, shared GPX parser and domain contracts.
- Use the native Android document picker (Expo DocumentPicker) and copy selected
  content into app-private storage. Cancellation leaves existing state untouched.
- Use Expo SQLite for versioned local metadata and filesystem assets for original
  GPX bytes and a validated RouteDocument snapshot. Preserve the original exactly.
  Local record versioning is separate from the shared route schema version.
- Use the existing `@ride-maker/gpx` parser, with focused correctness fixes/tests
  if required. Preserve segment boundaries, direction, loops, waypoint data and
  supported track/route content. Never connect separated segments or silently
  flatten multiple GPX routes into a connecting line. If current parser semantics
  cannot preserve an input, either fix with shared tests or reject explicitly.
- Display distance as the sum of consecutive points within each segment only.
  Do not include gaps, fabricate duration or use a routing service for this phase.
- Validate finite/ranged coordinates, actual numeric coordinate attributes (missing
  or blank must not become zero), GPX root, meaningful geometry and storage schema.
  Require at least one segment with two distinct points. Reject DTD/entity declarations.
- Bound input before parsing: maximum 10 MiB UTF-8 bytes and 100,000 geometry
  points. Enforce actual file size, not merely provider-reported size; if unavailable,
  establish size on a private copy before reading. An oversized file must not
  enter XML parsing. Bound parsed counts before committing; clean temporary copies.
  Explain these limits in a useful error, not a settings UI.
- Track originals and snapshots by app-generated IDs, never provider filenames
  as paths. Repeated imports may create separate records; no deduplication UI.
- Commit a record only when all required assets are durably written. Failed or
  interrupted imports must not appear as successful saved routes. Handle orphan
  temporary files on startup without removing valid records. A corrupt/missing
  saved asset should show an actionable per-route error; other routes still open.
- No network or account needed to import, list or reopen. Do not automatically
  fetch public route lists as a prerequisite for the local home screen.
- Keep personal route data private: no uploads, raw coordinate logs, or fixture
  copies from the owner's phone. Use synthetic committed GPX fixtures.

Owned files: `apps/mobile/`, targeted `packages/gpx/` fixes/tests, synthetic E2E
fixtures/flows and `scripts/mobile-e2e/` extensions, dependency manifests/lockfile,
and relevant mobile docs. No server config, production deployment, web feature,
shared schema bump, navigation algorithm, GPS/background/audio behavior change,
or test baseline weakening. Add only compatible Expo SDK 57 dependencies via
Expo's version resolution; consult official documentation for APIs/compatibility.
Avoid adding a navigation/UI framework unless required; use existing structure.

## Implementation steps

1. Audit picker/parser/filesystem/SQLite compatibility and existing preview map
   helpers. Document the local record contract and import commit/cleanup ordering.
2. Implement bounded import, parser validation and storage adapters with focused
   tests for successful commit, write failure, interrupted commit, corruption,
   restart listing and original preservation. Keep the parser reusable.
3. Add simple home/list/preview states and actionable import errors. Render
   separate map lines and calculate correct distance without bridging gaps.
4. Add synthetic track, route, segmented, malformed and oversized fixtures.
   Extend the existing runner to push files to the dedicated emulator's picker
   storage. Exercise the actual picker; do not bypass it through a test import link.
5. Verify all acceptance gates below, update docs with commands/evidence/limits,
   and hand the diff to Sol. Leave implementation uncommitted for review.

## Acceptance gates

- A normal track and route GPX both import through Android's real document picker;
  correct name (metadata or filename fallback), approximate expected distance and
  geometry are visible; screenshot review verifies lines and map rendering online.
- A segmented fixture renders separate lines and its distance excludes the gap.
  Unit tests assert geometry/direction and preservation of original bytes.
- Picker cancellation, malformed/non-GPX, missing/blank/out-of-range coordinates,
  unusable one-point geometry, DTD/entities, oversized file and point-limit failure
  produce bounded useful feedback, no completed record, and no lost saved routes.
  Test boundary cases in pure/storage tests; native E2E needs representative errors.
- Two saved imports are listed after force-stop/relaunch of a standalone APK with
  Metro unavailable. Reopening retains the same route ID/name/distance/geometry
  from app-private data even after removing the picker-source fixture file.
- Repeat reopening with network blocked; prove API/network unavailability. The
  saved route/list must work, with truthful network-dependent map feedback. This
  is route-data persistence evidence, not offline-map/navigation acceptance.
- Failed persistence and corrupt/missing saved data do not crash startup or block
  healthy routes; no incomplete import claims success. Exercise interruption at
  adapter boundaries with meaningful tests, not app implementation mirrors.
- All existing six E2E flows still pass with maintained assertions, plus new picker,
  cancellation/error and persistence journeys. Consumer isolation still passes;
  new test seams are absent or disabled in ordinary standalone builds.
- Run `npm run check`, `npm test`, shell/script syntax checks for edited runners,
  relevant standalone consumer verification, and three fresh runs of the expanded
  default emulator suite. Retain failures; investigate instead of blanket retries.

## Execution and handoff

Canonical source: `/home/henry/projects/ride-maker`. Mac build/test checkout:
`~/code/ride-maker` (`/Users/henry/Code/ride-maker`). Inspect and preserve work in
both checkouts. Synchronize only owned source changes; do not copy credentials,
node_modules, ignored native outputs or unrelated dirty files between hosts.

Use the task002 runner/bootstrap, explicit serial `emulator-5554` and exact AVD
`ride-maker-e2e`. Preserve its global device lock, fingerprint/cache verification,
owned process/forwarding cleanup, evidence manifests and negative failure checks.
Network/picker fixture changes must restore only state owned by the test run,
including on interruption. Do not add test sources to production GPX flow.

SSH: `ssh -i /home/henry/.ssh/id_ed25519_github_nauvis -o IdentitiesOnly=yes
-o BatchMode=yes henry@100.101.127.83`. On Mac source `~/.nvm/nvm.sh`, use
Zulu Java 17, Android SDK `~/Library/Android/sdk`, Maestro `~/.maestro/bin/maestro`.
Bootstrap documents the exact native test configuration. Owner package
`net.thg3.ridemaker`, physical serial `R5CY52MQVCY` and Metro8081 are protected.
No personal phone install/reset/GPS injection or owner Metro stop for this task.
No cloud EAS build is needed. Read applicable remote AGENTS explicitly.

Read `docs/mobile-plan.md`, `docs/mobile-testing.md`, task002 and its final Sol
review before editing. Prior Gemini handoffs overstated tests and changed unrelated
navigation behavior; Sol corrected these. Report actual evidence and limitations.
If a provider quota or infrastructure failure prevents completion, preserve work
and report exactly what ran, what failed and what remains. Do not claim acceptance.

Handoff: changed files and decisions; local contract/limits; exact build/test
commands and exit codes; APK/source/harness/fixture identities; per-flow results,
actual screenshots/logs under ignored `.artifacts/mobile-e2e/`; any failure and
fix; unverified gates. Update this task status to IMPLEMENTED — AWAITING SOL REVIEW
only if all implementation gates are evidenced. Sol owns acceptance and commit/push.

## Implementation evidence (2026-10-12)

### Verification summary
- `npm run check`: 8/8 packages passed typecheck (`turbo check`, `tsc -b`, `exactOptionalPropertyTypes`).
- `npm test`: 14 suites, 74 mobile tests, 11 GPX tests, 2 routing tests — 100% passing.
- APK build (`bootstrap.sh --variant all` on Mac):
  - Test APK: `868a49286671de0b2a2e52e1138152b47193b75b2f308233b95ed6a3464aab2e` (122,640,940 bytes, `usesCleartextTraffic=true`).
  - Consumer APK: `7062f14a266499b6edd3d25f27df8521aad4928be8b4a00664d00ddbf8ac4354` (122,639,780 bytes, `usesCleartextTraffic=false`).
- 3 consecutive complete E2E emulator runs (`emulator-5554` on dedicated AVD `ride-maker-e2e`):
  - Run 1: `run-20261011-225134` (9/9 flows passed, 35 screenshots).
  - Run 2: `run-20261011-225717` (9/9 flows passed, 35 screenshots).
  - Run 3: `run-20261011-230308` (9/9 flows passed, 35 screenshots).
- Consumer standalone verification:
  - Run `run-20261011-230855-consumer-verify` passed (`consumer-standalone.yaml` on `net.thg3.ridemaker`, zero test seams).
- Working tree uncommitted on both Linux canonical and remote Mac checkouts in identical dirty state.

## Sol round1 disposition

Not accepted. See [review findings](../reviews/003-sol-local-gpx-review.md).
The reported native passes exercise the current assertions; offline isolation,
runner ownership, storage rollback/recovery and snapshot validation need correction.
Sol added three reproducing failing storage regressions.

Sol round2 found remaining initialization retry/deadlock, malformed maneuver, and
network evidence issues; see the appended review. Native round2 runs are reported,
not independently accepted.


## Round 3 correction implementation (2026-10-12)

All code corrections, storage unit/regression tests, and runner hardening for Round 3 are completed and verified on canonical (`/home/henry/projects/ride-maker`):

1. **Storage Concurrency, Rollback & Validation**:
   - `apps/mobile/src/storage/sol-review-regressions.test.ts` passes all 7 tests (100% green).
   - Transient database errors in `init()` reset `this.initPromise = null`, allowing retry without caching rejection.
   - Decoupled `init()` from `runSerialized(this.opLock)` in `saveImportedRoute`, eliminating cold-save self-deadlock.
   - Rollback checks `alreadyExisted` before cleanup, preserving valid pre-existing assets on ID collision or failure.
   - Exhaustive corruption validation in `isValidRouteDocument` verifying every maneuver (id, lat, lon, bounded segmentIndex/shapeIndex, instruction), source kind/fields, controlPoints, waypoints, segments, and summary.
   - Path traversal and version validation in `getRoute`: strictly asserts expected asset paths under baseDir and matching geometry counts.

2. **Safe Defaults & Picker Cleanup**:
   - `createDefaultLocalStorage` in `apps/mobile/src/storage/index.ts` throws when native modules are absent; fakes are restricted to explicit unit test injection.
   - Picker cache cleanup deletes files only when strictly within `cacheDirectory`.\n
3. **UI Guidance & Navigation Controls**:
   - In `apps/mobile/src/App.tsx`, removed `isPrepared`. Local raw preview routes (`route.kind === "local"`) show the guidance notice (`view-guidance-notice`) and hide the navigation bar.
   - Remote routes (`route.kind !== "local"`) show navigation controls regardless of maneuvers and never display the local saved guidance notice.
   - Preserved baseline navigation algorithms and camera behavior.

4. **Parser Boundaries & Distance Location**:
   - Verified 10 MiB boundary in `storage.test.ts` (10 MiB accepted, 10 MiB + 1 byte rejected before reading, negative and missing size rejected before reading).
   - Clarified distance calculation implementation resides in `packages/gpx/src/parse-gpx.ts` (`@ride-maker/gpx`), correcting earlier erroneous reference to `distance.ts`.

5. **Runner Hardening & Fixtures**:
   - Restored baseline timeouts (35s feeder, 30s Maestro in flow 05).
   - Added UTF-8 BOM fixture `apps/mobile/e2e/fixtures/synthetic-utf8-bom.gpx` with international characters.
   - In `scripts/mobile-e2e/run.sh`:
     - Track seed Maestro PID under `MAESTRO_PID` for clean cancellation.
     - Enforce positive online control before cut, strict offline isolation assertion, and `--demo-ineffective-cut` returning nonzero.
     - Track `NETWORK_MODIFIED=true`, restoring network only when changed, verifying restoration against initial settings.
     - Added native persistence verification probe comparing native stored `original.gpx` SHA256 with fixture SHA256.
     - Refreshed metadata manifest and wrote `network-probe-results.json` and `persistence-verification.json`.

6. **Host Status & Native Verification Block**:
   - Mac SSH (`henry@100.101.127.83`) timed out (port 22 connection timed out).
   - Per directive, returning meaningful partial handoff with completed canonical fixes and tests verified; native emulator execution remains blocked pending Mac host availability.
   - Preserved all uncommitted work on canonical `main` (2a36f07).

Sol round3: eight storage regression tests pass after collision protection and
restoring baseline flow05. Remaining native persistence/network assertions are
listed in the review; latest source is not synced to or tested on the Mac.

### Implementation Progress — Test Observation & Network Classification Engine

1. **Test-Only Native Storage Observation**:
   - Implemented `apps/mobile/src/storage/test-observation.ts` (`observeLocalStorage`) reading committed route records, geometry snapshots, and base64-encoded raw original GPX bytes.
   - Wired deep link intent `ridemaker://observe-storage?tag=...` in `apps/mobile/src/App.tsx` behind `EXPO_PUBLIC_TEST_MODE === "true"`. Logs bounded markers (`[E2E_STORAGE_OBSERVE_BEGIN]`, `[E2E_STORAGE_OBSERVE_ROUTE]`, `[E2E_STORAGE_OBSERVE_END]`). Zero private data logged in consumer builds.
   - Built pure verifier `scripts/mobile-e2e/verify-persistence.mjs` and comprehensive test suite `scripts/mobile-e2e/test-verifier.mjs` (14/14 tests pass). Compares before-restart and after-restart observations: verifies non-empty evidence (>=2 routes), exact match of IDs, names, distances, point/segment counts, geometry, order, and SHA256 of raw bytes against expected fixtures including `synthetic-utf8-bom.gpx`.

2. **Network Probe Classifier & Restoration Verification**:
   - Implemented `scripts/mobile-e2e/network-probe-classifier.mjs` and test suite `scripts/mobile-e2e/test-network-classifier.mjs` (16/16 tests pass).
   - Categorizes probe output into `REACHABLE_HTTP`, `CONNECTION_FAILURE`, and `INFRASTRUCTURE_FAILURE`.
   - In `scripts/mobile-e2e/run.sh`:
     - Added `verify_nc_available` to ensure netcat is functional before probing.
     - Requires positive HTTP 200 API + reachable external controls before cutting network; exits non-zero if controls fail.
     - Enforces genuine offline isolation without treating infrastructure/tool failures as offline.
     - Verifies exact restoration of Android global settings (`airplane_mode_on`, `wifi_on`, `mobile_data`) and restored HTTP 200 API probe; restoration failure exits non-zero while completing owned cleanup.
     - Output metadata records states, results, and commands JSON.

3. **Status & Native Verification Gate**:
   - TypeScript checks pass 100% across all 8 packages in monorepo (`npm run check`).
   - Monorepo unit test suites pass 100% (`npm test`, 91 mobile tests including all 8 Sol storage regressions).
   - Pure runner test suites pass 100% (30 tests across `test-verifier.mjs` and `test-network-classifier.mjs`).

Sol round4 source checks: monorepo check/test pass; 30 verifier/classifier tests
pass. Corrected preview distance, storage Retry, health endpoint and PID-scoped
observation.

### Round 4 Native Verification Evidence (2026-10-12)

#### 1. Native Build & Fingerprints
- Test APK: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
  - SHA-256: `32e4fe812a0c0780c2052b2397874eb3461099788152187bfe27d2463c47ac3c`
  - Size: 122,657,416 bytes
  - Package: `net.thg3.ridemaker.e2e` (`usesCleartextTraffic=true`)
  - Source Fingerprint: `42bef235c64ed3133f2ab01e870d97dc65065efadd59a243826ff094b752e5d9`
  - Harness Fingerprint: `fd35b53ce836d39ec9b786d8fe41d2ea81e4fe486b21f5bc0fed068ca42cab90`
- Consumer APK:
  - SHA-256: `7670e34649cc1b98994fb266b28e56c2e800dc09bdb5788d87edf6315017294c`
  - Package: `net.thg3.ridemaker` (`usesCleartextTraffic=false`)

#### 2. Three Consecutive Clean E2E Suite Passes on Dedicated Emulator (`emulator-5554`)
All 9 flows passed consecutively across 3 fresh runs with identical source and APK:
- **Pass 1**: `run-20261012-113224` (exit 0, 9/9 flows passed, 39 screenshot artifacts recorded)
- **Pass 2**: `run-20261012-113938` (exit 0, 9/9 flows passed, 38 screenshot artifacts recorded)
- **Pass 3**: `run-20261012-114653` (exit 0, 9/9 flows passed, 38 screenshot artifacts recorded)
  - Flow 01: `01-startup-and-diagnostics` (PASS)
  - Flow 02: `02-invalid-route` (PASS)
  - Flow 03: `03-saved-route-navigation` (PASS)
  - Flow 04a: `04a-diagnostics-permission-denied` (PASS)
  - Flow 04: `04-diagnostics-lifecycle` (PASS)
  - Flow 05: `05-simulated-ride` (PASS)
  - Flow 06: `06-gpx-import-and-preview` (PASS)
  - Flow 07: `07-gpx-persistence-and-offline` (PASS)
  - Flow 08: `08-gpx-import-errors-and-cancel` (PASS)

#### 3. Native Storage Persistence & Byte Fidelity (Flow 07)
Persistence verified across force-stop process restart and device-wide network cut:
- 3 routes seeded via native document picker and matched before/after restart:
  - `route-mv5fk4jv-qlmb3eor59c`: "München Über Berg Straße — Café René", SHA-256 `f60b99ebcf269cf8a313a87ed064fab57b87d4e3306f39a2c6507174dd39e5e0` (`synthetic-utf8-bom.gpx`)
  - `route-mv5fjqrf-kj154cm6kcr`: "Hudson Greenway Route", SHA-256 `abd5422844edbade2c0613e2e899ea6c2855febfcea30f639c6240261fbe6652` (`synthetic-route.gpx`)
  - `route-mv5fjf1h-30vy7eveqjj`: "Central Park Track", SHA-256 `83fa0397e65fc271500c0ded9fa381c47f7b8caf7a73a05d9d14a4921f81cf71` (`synthetic-track.gpx`)
- All verification flags evaluated to true in `persistence-verification.json`:
  - `matchingIds: true`
  - `matchingGeometry: true`
  - `matchingOriginalBytes: true`
  - `matchingOrder: true`
  - `fixtureHashesVerified: true`
  - `offlinePreserved: true`

#### 4. Real Offline Isolation & Restoration Probes
Logged in `network-probe-results.json`:
- **Positive Online Control**: API HTTP 200 OK + External HTTP 301.
- **Offline Cut**: Device airplane mode enabled, Wi-Fi disabled, mobile data disabled, reverse port forwarding removed.
  - API probe: `CONNECTION_FAILURE` (`nc: connect: Connection refused`).
  - External probe: `CONNECTION_FAILURE` (`nc: tiles.openfreemap.org:80: No address associated with hostname`).
  - Ping 8.8.8.8: Network unreachable. `isolated: true`.
- **Restoration**: Settings observed restored (`airplane_mode_on=0`, `wifi_on=1`, `mobile_data=1`).
  - API probe: HTTP 200 OK.
  - External probe: HTTP 301.
  - Ping 8.8.8.8: 0% packet loss. `restored: true`.

#### 5. Consumer Standalone Verification
- Run: `run-20261012-113204-consumer-verify` (exit 0)
- Package: `net.thg3.ridemaker`, cleartext `false`. Flow verified cold start without test seams.

#### 6. Negative Demonstrations & Failure Proofs
- `--demo-ineffective-cut`: Run `run-20261012-115424-ineffective-cut-demo` exited with code 1:
  `ERROR: Network cut ineffective or infrastructure failure detected.`
- `--demo-failure`: Run `run-20261012-115955-failure-demo` exited with code 1:
  `FAIL: failing-assertion-demo`
- `--demo-gps-failure`: Run `run-20261012-120032-gps-failure-demo` exited with code 1:
  `ERROR: Companion feeder failed with exit code 2. FAIL: 05-simulated-ride`

#### 7. Runner Ownership & Signal Cleanup Test
- In-flight run `run-20261012-120821` sent `SIGTERM` (signal 15) to runner PID during initialization:
  - Trapped signal, performed cleanup, exited with code 143 (`128 + 15`).
  - Zero leaked locks (`/tmp/mobile-e2e-*.lock` cleaned).
  - Reverse forwards cleanly removed (`adb reverse --list` empty).
  - Fixture server process cleanly terminated.
  - Pre-existing files in `/sdcard/Download/` (`synthetic-track.gpx`, `synthetic-route.gpx`, `synthetic-segmented.gpx`, `malformed-invalid-xml.gpx`, `malformed-oversized.gpx`) remained 100% intact.
  - Network state restored (`airplane=0`, `wifi=1`, `data=1`).

#### 8. Canonical Git State & Sol Review
All changes remain uncommitted on `main` at `2a36f07`. Full evidence synced to `.artifacts/mobile-e2e/`. Sol owns final review and acceptance.

## Final Sol acceptance

Accepted after independent source/harness/APK identity checks, three9/9 run
summaries, re-executed before/after native persistence verification, reviewed map
and BOM screenshots, online/offline/restored probes, negative failure summaries
and current monorepo/verifier checks. See the final review record for details.
Offline maps, turn preparation, engine replay and physical field navigation
remain future work. The owner phone was not installed/reset by this phase.
