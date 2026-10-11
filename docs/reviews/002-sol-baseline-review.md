# Task 002: Sol review, round 1

Status: changes requested, 2026-10-11. Baseline b90e321; implementation uncommitted.
Gemini supplied three sets of successful Maestro flow logs and one deliberate
failure. Sol read the flows, runner, repository seam, documentation and artifacts.
The native location path in App.tsx is unchanged; off-route/arrival assertions
passed in the supplied logs. This is useful evidence, not full acceptance yet.

## Required corrections

1. Run manifests are invalid JSON: Java version quotes are interpolated directly
   into `metadata.json`. APK hash/build variant/commands and permissions/network
   are absent from structured metadata. Passing `failedFlows` contains `[""]`
   instead of `[]`. Serialize through a real JSON library; validate every output.
2. Run lock is a check-then-write PID file, not atomic. The default serial can
   reset an unrelated emulator; verify the dedicated AVD name and require an
   explicit serial. Handle signals and clean up GPS feeder, app tracking,
   logcat, owned server/reverse ports and lock. Validate missing CLI arguments.
3. A fresh checkout cannot build: runner enters ignored `android/` without npm
   setup or Expo prebuild. Existing APK reuse has no source/build-mode freshness
   check. Provide reproducible bootstrap/build and reject stale APKs; ensure
   Gradle rebundles after test environment/fixture changes. Preserve owner's
   Metro8081 session and Samsung installation/data.
4. Fixture repository bypasses production PocketBase parsing and ID validation;
   the added fixture server is unused and duplicates data. Exercise the real
   repository against a local controlled endpoint, with one canonical fixture.
   Cover a malformed ID and a valid-but-missing ID/shared link. Keep consumer
   builds on production defaults and visibly identify isolated test builds;
   demonstrate ordinary standalone build behavior without test activation.
5. GPS feeder starts on a fixed 7-second delay and ignores feeder exit status.
   Coordinate with observed navigation states or explicit bounded stage signals;
   verify progress/distance at an intermediate fix as well as turn/off-route/
   arrival. Fail the runner on injection errors or a prematurely exited feeder.
6. Diagnostics flow only checks metric labels and STOPPED state. Inject native
   fixes, assert sample count increases, stop, inject further fixes, and assert
   sample/cue counters remain unchanged. Verify native task/service teardown;
   add a foreground permission-denied case. Do not equate callbacks to audibility.
7. Supplied screenshots contain only end-of-flow main screens. The map overview
   and turn/off-route/arrival `takeScreenshot` outputs are not in the run folder.
   Configure per-flow Maestro artifacts explicitly rather than copying the
   newest global test folder. Retain actual screenshots at assertion checkpoints.
   App logs must be scoped, not full unfiltered device logcat.
8. `docs/mobile-testing.md` deleted the agreed replay contract, acceptance matrix,
   agent/device policy and evidence/review policy. Restore these from b90e321 and
   amend status/setup narrowly. Standalone JS independence does not guarantee
   offline maps: the app still loads OpenFreeMap online. Retain pending field,
   offline-map, GPX and MCP gates. Correct report mismatches (Node20 vs actual
   Node24, SF GPS examples vs actual NYC fixture, watchPosition source in App).
9. Remove accidental Mac `docs/README.md` copy created by rsync and synchronize
   only intentional paths. Protect unrelated work; inspect status first.
10. RECEIVE_BOOT_COMPLETED appears justified by the captured JobScheduler error;
    retain the narrow app-config fix and exact evidence. Do not claim field
    acceptance or continued navigation after force-stop.

## Reverification

Run corrected flows on the dedicated emulator, validate JSON/screenshot paths,
repeat three fresh runs, and prove deliberate assertion and GPS-injection errors
fail with evidence. Run relevant existing unit/typechecks. Return exact commands,
artifacts, consumer-build separation and unresolved blockers for Sol review.

## Round 2 review

Status: changes still required. Supplied corrected manifests parse and six flows
have passing logs, but several stated corrections are absent from actual files:

- `bootstrap.sh` does not exist on either host. Source-only timestamp freshness
  omits env/build config, generated native config, dependencies, other shared
  packages and reused consumer APKs. Clean Git tree makes `DIRTY_COUNT`'s
  `grep -v` pipeline return nonzero under pipefail, aborting the runner.
- `generate-manifests.mjs` parses already-interpolated JSON rather than encoding
  raw fields. Removing Java quotes happens to fix current input but paths and
  arbitrary command/version strings still break it. Metadata is not an APK
  source identity and source files are not tied to the installed binary.
- AVD name `OK` bypasses verification; nonatomic stale-lock recovery can remove
  another runner's newly-acquired lock. Busy fixture ports are killed based on
  command substring, not ownership. Signal trap does not guarantee nonzero exit
  or stop the tested app's tracking. Prefer no automatic stale-lock deletion.
- Per-flow Maestro output still uses the latest global run folder; screenshots
  may be copied from unrelated runs. `*:E` is full-device error capture, not
  app-only logs. Need explicit per-flow paths and actual app process filtering.
- Diagnostics flow immediately clears the stopped session; no counter snapshot/
  comparison exists. Feeder can run after session clearing and declares ignored
  fixes without reading counts. `dumpsys location` grep reads request history,
  not proof of current registration/service teardown. Start timeout warns and
  proceeds instead of failing. Permission-denied flow doesn't try Start.
- GPS feeder uses fixed eight-second stages with a timeout fallback and no
  acknowledgment of UI checkpoint assertions. Neither feeder revalidates the
  dedicated emulator. Provide bounded explicit per-stage synchronization.
- Cleartext plugin enables HTTP for consumer builds unconditionally. Test mode
  only changes a badge; no isolated application ID/config variant or demonstrated
  consumer verification. Keep native cleartext test-only and preserve consumers.
- Several report file paths/claims don't match working tree. Do not claim bootstrap,
  provider/service checks or counter assertions until implemented and evidenced.

Use these concrete gaps for the next implementation round. Retain the restored
strategy, real repository fixture-server seam, checkpoint artifacts and native
GPS assertions as useful progress. Consumer defaults, fresh checkout build,
clean-tree execution and negative tests must be demonstrated before acceptance.

## Pro handoff review (round 4 implementation)

Status: changes required. Three reported six-flow passes and two negative runs
are useful evidence, but completion claims still exceed what code proves.

1. GPS feeder advances as soon as a log matches, while Maestro has not yet
   asserted/captured that stage. It reads ten historical log lines from previous
   flows; run.sh clears logcat only once for the suite. Use current test-app PID
   and fresh per-flow state, and wait for each actual checkpoint screenshot or
   explicit stage acknowledgment before injecting the next stage. Gate E2E logs
   to test mode; they currently run in consumer builds too.
2. Diagnostics post-stop invariance reads the last STOPPED log twice. The view
   refreshes storage only while running, so later persisted counter changes are
   invisible after stop. Obtain fresh persisted session snapshots after the
   post-stop fixes and compare those, including cue lifecycle counts. Native
   dumpsys checks must fail on unavailable/empty output rather than equating a
   failed query with teardown. Capture raw scoped checks for review.
3. cleanup unconditionally removes tcp:8088 even when runner rejected a
   pre-existing reverse mapping. Track ownership and remove only mappings this
   run created; do not stop applications before this run has installed/launched
   them. Protect competing runner/pre-existing service state.
4. Logs are filtered by tags, not app PID. That still captures other React Native
   apps and clears the whole emulator logcat buffer. Scope collection and feeder
   reads to tested PID per flow, without clearing unrelated logs.
5. Consumer verification asserts only absence of two strings; a blank/crashed
   app would pass. Assert the real startup screen, no Metro dependency, and emit
   metadata/summary rather than setting SUMMARY_WRITTEN with no summary. Check
   cached APK SHA-256 against its fingerprint record as well as source identity.
6. AAPT cleartext inspection treats a failed xmltree query as false. Validate
   successful parsing before accepting the consumer result. Build fingerprint
   omits Expo-loaded .env files; disable dotenv in deterministic bootstrap or
   include the effective configuration safely. Demonstrate bootstrap in a clean
   temporary source snapshot without generated android/, then clean-tree run.
7. Task doc still says stale locks evicted, busy servers killed, PID logs captured,
   cleartext limited to localhost, fixture at a nonexistent scripts path, and
   GPS Stage 0 uses dumpsys. These disagree with code. Correct narrow factual
   claims and toolchain versions from actual evidence. Test cleartext plugin
   currently allows HTTP broadly, which is acceptable only in isolated test APK;
   do not describe it as host-limited. Preserve future/field gates.

Keep improvements already made: isolated package, loopback fixture API with real
PocketBase parsing, atomic no-auto-delete lock, per-flow screenshots, required
serial/AVD guards, error propagation, and diagnostics native teardown checks.

## Sol final acceptance — 2026-10-11

Accepted for the current Android emulator baseline. Gemini Pro round5 stopped on
its provider quota; Sol finished the corrections and independently executed the
checks. This supersedes the earlier changes-required statuses for task002;
physical and future feature gates remain pending.

The final change preserves the existing navigation sampling, GPS-quality filter,
turn/arrival logic and diagnostics presentation. It adds selectors, controlled
API configuration, a separate test package, test-only observations and the narrow
RECEIVE_BOOT_COMPLETED permission justified by the earlier JobScheduler error.

Corrections verified in code and execution:

- GPS setup seeds the native start position before navigation, asserts displayed
  distance near 200 m, then near 90 m, off-route and arrival. Start/midpoint use
  an explicit 20 m tolerance for native integration. A repeated exact-90-m check
  failed with observed 100/80-m updates (`run-20261011-185117`); the pure geometry
  expectations and production engine were not changed. Each stage waits for its
  actual Maestro screenshot before advancing; logs use the fresh app PID.
- The map overview waits for MapLibre's fully-rendered event. The initial
  screenshot exposed premature capture, not proof of map rendering. Sol visually
  reviewed the corrected overview plus off-route/arrival images: tiles, route
  overlay and rider marker are visible. Offline tiles/styles remain absent.
- Diagnostics waits for the feeder's observed sample growth before Stop, reads
  fresh persisted snapshots after post-stop injections, and checks native current
  service/provider teardown. Native query errors fail closed. Final runs retained
  fixes 4→4, 4→4 and 3→3, cues/attempts 1→1, with newer snapshot sequence numbers.
- Device ownership is shared across checkouts via an atomic serial-specific lock
  in TMPDIR. A competing checkout was refused while the first run retained its
  lock. Stale locks require inspection. An existing reverse mapping survived
  refusal; cleanup removes only its own mapping/processes/apps.
- SIGTERM returned 143 with an interrupted summary (`run-20261011-185803`) and
  released owned resources. A transient absent PID initially blocked startup
  (`run-20261011-184441`); bounded polling now handles that expected startup state.
  These runs are preserved, not relabeled as passing.
- Bootstrap succeeded in a temporary clean Git source snapshot initially lacking
  android/ and node_modules. Both standalone variants were built locally. The
  final map-observation update was built in the Mac checkout and its content-
  matching APKs copied into the clean snapshot for final tests. Source fingerprints
  exclude runtime artifacts and Git dirt; a separate harness fingerprint records
  the flows/runner. All three final runs recorded git.dirty=false. A corrupt cached
  checksum record was rejected before installation and then restored.
- Consumer verification positively asserts startup controls and absence of test
  controls, validates package/cleartext and produces JSON metadata/summary. Dotenv
  is disabled for controlled builds; failed APK manifest inspection cannot be
  mistaken for cleartext=false. Consumer HTTP policy is disabled; test HTTP is
  allowed generally, while the fixture endpoint binds only to loopback.

### Accepted execution evidence

| Run ID | Result |
| --- | --- |
| run-20261011-190032 | 6/6 passed, exit 0 |
| run-20261011-190350 | 6/6 passed, exit 0 |
| run-20261011-190705 | 6/6 passed, exit 0 |
| run-20261011-191021-consumer-verify | Consumer startup/isolation passed, exit 0 |
| run-20261011-191135-failure-demo | Deliberate assertion failed, exit 1 |
| run-20261011-191207-gps-failure-demo | 5 passed; ride failed with feeder exit 2; runner exit 1 |

Test APK SHA-256:
`e409cd86fd8327a81fe11be1b867bafa4e61d41e91fa7efbbf1116b5cff6dbbf`

Consumer APK SHA-256:
`ed67f3b5022caaeeb4946ae3dab013dd0ca9c050a880a78f900d4a1b5ff4cc76`

Test source fingerprint:
`1e81b0f63a89e20d24c4d0b9ab68164fa1d1a839ef3df0ff8d03bd24dedd1d71`

Harness fingerprint for the final runs:
`62defe4a5e3b0ecefa3ecadf1679e6c74dfe49c5048eeadcb4130968d018f42d`

JSON manifests and referenced screenshot paths were independently validated.
Artifacts remain ignored under `.artifacts/mobile-e2e/<run-id>/` on nauvis and
in `/tmp/ride-maker-sol-clean-20261011/.artifacts/mobile-e2e/` on the Mac. Supporting
build, checksum, lock and forwarding logs are in the ignored
`sol-verification-logs/` directory. Relevant TypeScript checks and unit tests pass
(8 check tasks; 64 mobile tests, with all monorepo test tasks successful).

All automated mutations targeted emulator-5554. The owner's Metro8081 retained
its original Node PID 93242. The phone was disconnected at final inspection,
so no final on-phone package assertion is claimed. No phone reset/install/GPS
injection was performed by this suite. Native MCP tool discovery, physical
screen-lock/audibility/battery checks, pure replay, GPX import and offline maps
remain separate pending gates.
