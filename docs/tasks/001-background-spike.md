# Task 001: background GPS and voice feasibility

Assignee: Gemini Flash. Reviewer/integrator: Sol. Status: revisions required.
Implementation is present; follow [Sol's review](../reviews/001-background-spike.md)
before Android field testing. The milestone is not yet accepted.
Read `docs/mobile-plan.md`, repository instructions, and the existing mobile
app before editing. Extend it; do not create a replacement Expo workspace.
The first real-device target is the owner's Android phone. Prioritize an
installable Android development build and its location foreground service;
keep iOS configuration compatible but mark iOS field checks as pending.

## Outcome

A clearly labeled development diagnostics mode in `apps/mobile` that proves
location updates and on-device spoken cues continue during a locked-screen
outing. Keep existing foreground navigation behavior until the real-device
gate is passed. This is a platform spike, not finished background navigation.

Current mobile code already opens shared routes and renders native MapLibre.
It watches foreground location inside a React effect and holds progress/cue
state in refs. Moving those refs into a background task is not a complete
solution: tasks may execute without the UI and require persistent state.

## Scope

- Audit the current dependency pins and Expo app configuration. Add compatible
  TaskManager and filesystem support using Expo's supported versions.
- Register an active-ride diagnostic location task at module scope. Persist
  timestamp, accuracy, and coordinates to a local app-private diagnostic file
  with bounded retention. No GPS data may be uploaded, logged to Git, or printed
  in the completion report. Report intervals/counts rather than personal tracks.
- Provide explicit start/stop diagnostics controls and permission-state feedback.
  Ask permissions when starting, not at startup. Stop tracking and audio cleanly.
  Configure iOS background location and the Android foreground service as needed.
- Implement a simple cue schedule for this mode with persistent cue IDs so
  speech can be exercised while locked without depending on React state. Use
  bundled instructions and make the diagnostics purpose obvious; do not present
  timed test cues as actual route directions.
- Isolate location and speech behind adapters usable by later navigation code.
  Begin with Expo APIs. If locked-screen speech or audio-session behavior cannot
  be supported reliably, return the evidence to Sol before adding a native module.
- Document build/start commands and the field checklist in
  `apps/mobile/README.md`; record the tested versions and unresolved blockers.

Own `apps/mobile/**`, minimal root lockfile changes, and this task's completion
notes. Do not change the existing navigation algorithm, route schema, web UI,
PocketBase auth, production deployment, or GPX/routing semantics. RSD integration
is a separate compatibility task; do not redesign UI during this spike.

## Verification

- Existing web and mobile checks/tests remain passing. Verify Metro bundles
  the diagnostic task registration without requiring a mounted screen.
- Build a native development binary if the toolchain allows it. A missing Android
  SDK, macOS/Xcode, signing account, or build-service login is a blocker to record,
  not a successful native build. Browser previews cannot validate this task.
- Owner-assisted real-device gate: start diagnostics, then run a 20-minute outing
  with screen locked; location samples and spoken cues continue. Repeat without
  network access. Exercise Bluetooth, silent mode, interruption by music, denied
  permissions, and stop/restart behavior. Record device/OS, gaps, cue failures,
  and battery use. State exactly which checks are pending if no phone is available.
- On stop, no further fixes or cues are produced. Reopening after force quit
  must show an interrupted session rather than claim navigation continued.

## Return to Sol

Report changed files, dependency/config changes, commands and outcomes, maximum
observed GPS gaps, audio behavior, and concrete device/build blockers. Provide
the next owner action needed to install/test. Mark implemented-awaiting-review
or blocked with evidence; only Sol accepts the task. Sol then defines the pure
navigation contracts before delegating algorithm and persistence implementation.
