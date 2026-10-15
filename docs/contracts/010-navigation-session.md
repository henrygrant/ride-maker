# Durable navigation session and background integration

Status: Sol contract, 2026-10-14. Implementation follows review of Task007 and
the prepared-route storage API. Existing background diagnostics are test evidence
for location delivery and speech only; they are not production ride navigation.

## One session, one engine

Foreground UI and the module-scope Expo TaskManager handler feed the same
navigation reducer through one durable session coordinator. Do not run independent
foreground and background engines or let React component lifetime own the ride.
Each location batch is ordered and deduplicated by its capture timestamp, with a
separate observation time for age checks. Invalid accuracy/speed/heading and old
batched fixes cannot produce fresh turn guidance.

Store a versioned session ID, revision, route ID, immutable geometry version,
engine state, voice preference and lifecycle in SQLite. Persist an independently
validated route snapshot at session start so library rename/reprepare/delete
cannot change an active ride's geometry. A checkpoint with an unknown schema or
wrong geometry must offer a clear restart/end path, never silently attach to the
current library route. Keep route/session files private and do not log locations
by default.

Use a DB transaction/revision check for state and cue claims. A per-instance
JavaScript promise lock alone does not protect headless callbacks against another
coordinator instance. Lifecycle actions and location updates must be serialized
against the same durable session identity. Delayed callbacks from an ended or
replaced session cannot advance progress or speak. Pause/end first invalidates
pending speech and durable ownership, then drains/stops owned native work.

Checkpoint cue claims before dispatch, and record attempted/completed/failed
delivery distinctly. Do not promise exactly-once audible delivery across process
death: claiming before speech can lose a cue, and replaying a claim can duplicate
it. Suppress stale backlog and provide **Repeat instruction** for rider recovery.
After pause or GPS interruption require a current reliable fix before resuming
turn announcements. Never repeat a turn while off route, in an uncovered section,
or on stale/degraded positioning; return the relevant state message instead.

## Start, permissions and recovery

Start requests foreground permission in context. Explain background guidance and
request background permission when needed; a denial leaves a usable explicit
foreground mode. A stopped/failed background service cannot be presented as
working locked-screen navigation. Start native location work while the app is
foregrounded, then publish running state only after startup succeeds. Roll back
partially started sessions/services on failure. End and pause stop only the task
owned by this session. Diagnostics and consumer navigation cannot own competing
background tasks; coordinate or refuse with a recoverable message.

On app relaunch, inspect the checkpoint and native task registration before
offering **Resume ride** / **End ride**. Never automatically resume speech from
old fixes. Recheck permission and start the native service from a valid foreground
transition. Display the most recent durable state when returning from background,
with position age and guidance availability handled honestly.

The native Android location foreground service needs a visible notification and
the configured location permissions. Force-stop and some vendor task removal
behavior stop location delivery; recovery on reopening is required, not a promise
to continue after termination. No automatic boot/start workaround is part of this
scope. iOS configuration is retained, but Android evidence does not prove iOS
background audio behavior.

## Focused evidence

Unit/integration tests use the real reducer and an injected clock/location/speech
boundary. Cover interleaved callbacks from two coordinator instances, stale
batches, pause/resume/end during pending speech, start failures, revoked
permissions, process recreation, geometry mismatch and deletion of the library
ride during an active session. Verify durable state/cue outcomes, not just mocked
function invocation counts.

On the dedicated Mac emulator, replay a synthetic ride through the production
TaskManager handler, background the app and lock the screen, then inspect durable
progress/cue records and native service state. Stop, reopen and resume; confirm
no stale backlog or duplicate foreground engine. Use a focused flow and preserve
the consumer library. Never target Henry's physical phone automatically.

Physical checks remain separate: real GPS drift, screen-off audible cues, headset
and audio interruptions, manufacturer battery restrictions and ride-length
battery use. Record emulator evidence and pending owner checks distinctly.

## Primary reference

[Expo Location](https://docs.expo.dev/versions/latest/sdk/location/), checked
2026-10-14: module-scope background task registration, permission/configuration
requirements, and termination limitations. Confirm the pinned SDK's behavior
against its installed source before implementation; do not upgrade dependencies
merely to match the latest documentation.
