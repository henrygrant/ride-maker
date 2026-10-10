# Sol review: task 001

Status: revisions required before Android field testing. Gemini's implementation
is present as uncommitted changes; Sol preserved those changes and did not
accept or commit the implementation.

## Checks and evidence

- All workspace type checks pass.
- Existing mobile tests: 23 pass across six files.
- Web production build passes (existing bundle-size warning).
- Android Metro export passes: 699 modules bundled to Hermes bytecode.
- Two additional lifecycle reproductions fail: startup rollback and Stop racing
  a queued cue write. The reproduction source is in
  `001-lifecycle-reproductions.ts.txt`; copy it into
  `apps/mobile/src/diagnostics/sol-review-regressions.test.ts` to run with
  `npm test --workspace @ride-maker/mobile -- src/diagnostics/sol-review-regressions.test.ts`.
- Native APK and real-device field checks remain pending. Android SDK/JDK/adb
  are unavailable on this host; no installable binary was produced.

## Required corrections for Gemini

### 1. Serialize lifecycle changes and background callbacks

`task-handler.ts` reads a running session, records samples, reads it again, then
saves the cue claim and speaks. `stopDiagnosticsSession` can save stopped state
while the callback is awaiting its final write. The stale running write then
resurrects the session and schedules speech after Stop. This was reproduced
with a deliberately delayed save, not merely inferred.

Coordinate callbacks, start, stop, recovery, and clear through a shared
controller/storage transaction boundary. Separate storage instances in the UI
and registered task must coordinate over the same underlying store; an
instance-local mutex is insufficient. Guard updates by session identity and
status, drain/cancel in-flight work before resolving Stop, and ensure queued
callbacks from a previous session cannot mutate a newly started session.
Account for headless execution; if a JS queue relies on a single runtime, state
and verify that assumption or use transactional persistent storage. Return the
approach to Sol if a schema/storage change is needed.

Test overlapping callback batches, Stop during a pending write/speech operation,
and restart with an old callback outstanding. The invariant is that Stop does
not resolve successfully until no further samples/cues from that session can be
recorded or issued. Native speech already playing must also be stopped.

### 2. Make start/stop failures truthful

`startDiagnosticsSession` persists running state and the start cue before native
tracking succeeds. A rejected native start leaves a running session and a cue
marked spoken even though it was never dispatched. The reproduction confirms
the stale running state. Roll back to a recoverable interrupted/error state,
stop any partially started native service/audio, and surface the failure.

`stopDiagnosticsSession` currently swallows native stop failures and persists
stopped state. Do not report successful stop while the service may still be
active. Keep a visible retryable error and verify native tracking status.
Permission denial, unsupported background APIs, interrupted start, repeated
start, and start/stop failures need focused tests.

### 3. Test durable storage and distinguish audio attempts from success

The current storage tests exercise the in-memory implementation. The production
file store performs unlocked read-modify-write and rewrites its retained sample
file per fix. Test production behavior using a fake filesystem with delayed
reads/writes, interrupted writes, corrupt/missing records, and clear operations.
Avoid allowing partial JSON or stale writes to hide a running session.

Cue IDs are marked spoken before `Speech.speak` is called, and the adapter's
promise does not await native completion. A green checkmark therefore proves
only a dispatch attempt. Persist attempted/completed/failed state using native
callbacks where possible; distinguish those from the owner's confirmation that
the cue was audible. Do not label the UI "Locked Screen Audio Active" merely
because tracking started. Stale batched fixes must not replay several obsolete
scheduled checkpoints as though they happened on time.

### 4. Provide a reproducible Android install path

`apps/mobile/README.md` invokes `eas build --profile development` but there is
no `eas.json`. Add the appropriate development/internal Android APK profile and
explain the Expo account/project setup step. Do not fabricate a project ID,
signing key, authenticated build, or download URL. External build-service setup
and login remain owner steps unless already configured.

An EAS development client needs Metro. Document phone-to-nauvis connectivity
through Tailscale and what happens when reception is unavailable. For the
airplane-mode diagnostic test provide a build with a bundled JS runtime rather
than requiring a live Metro connection after cold launch; coordinate that build
profile with Sol. A cold-start offline build is necessary to prove independence
from the dev server.

Correct the README's location/speech versions against the installed lockfile,
workspace test commands (`npm test --workspace @ride-maker/mobile`), and native
build requirements. Do not promise a one-Hz sample count or specific GPS accuracy
as a guaranteed device result. Notification permission is declared but not
requested; document actual behavior or implement explicit permission handling
without blocking location solely because notification permission is denied.

Keep diagnostics isolated from route guidance and visible only in appropriate
development/test builds. Prevent simultaneously running foreground route speech
and diagnostic speech. Revert unrelated route-list/header styling changes; only
the minimum diagnostics entry/control additions belong to this task.

## Next handoff

Continue task 001 with these corrections, preserving unrelated work. Report
checks, Metro/native-build results, unresolved platform limitations, and the
exact owner step needed to install. Do not mark the milestone accepted without
the Android field test. Sol reviews the next diff before committing the task.
