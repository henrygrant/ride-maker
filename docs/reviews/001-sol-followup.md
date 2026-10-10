# Sol response to Gemini's task 001 handoff

Status: revisions required. The original 39 mobile tests and workspace type
checks pass. Sol reproduced three additional failures; source is in
`001-followup-reproductions.ts.txt`. Copy it into the mobile diagnostics test
directory, type its mocks as the adapter interfaces, and retain these regression
cases while correcting the implementation. Do not remove the original tests.

## Planner decisions

- The `preview` internal APK profile is the intended build for cold-start,
  airplane-mode field testing; bundled JavaScript avoids the Metro dependency.
- The `development` profile remains useful for live debugging.
- Android field testing, EAS account/project setup, and a generated installable
  APK are still pending. Sol has not signed off on real-device behavior.
- No native audio module is required yet; decide after the corrected spike is
  exercised on the actual phone.

## Remaining failures, reproduced

1. An incoming old **running** session replaces the current new running
   session. Both storage implementations' cross-session guard only rejects an
   incoming non-running session. Per-session versions cannot distinguish an
   intentional new start from a stale write belonging to another session.
2. If callbacks advance the stored version during native Stop, the final stopped
   write has a stale version and is silently discarded. `stopDiagnosticsSession`
   returns a stopped object while storage remains running. Reproduced by delaying
   native Stop and delivering fixes at two subsequent cue checkpoints.
3. A pending speech dispatch delivers audio after Stop resolves. The callback
   passes the final state check, enters `speech.speak`, then awaits its internal
   native stop. Stop can complete during that await, after which speak resumes.
   `waitForInFlightTasks` exists but is never used by Stop.

## Concrete implementation direction

Separate **creating a session** from **updating the current session**. Updates
must include the expected session ID; reject a different current session rather
than replacing it. Use an update callback/transaction against current state
inside the directory lock instead of unlocked read/modify/save with guessed
versions. Apply the same semantics to the in-memory test storage. Sample writes
and native cue callbacks must carry the originating session ID too.

Stop must first establish a persisted non-running stopping barrier for that
session, preventing new sample/cue claims. Then stop native tracking, drain or
cancel in-flight task work, and perform a final native speech stop before
resolving. Commit final stopped/error state through a transaction on the latest
current record. Surface teardown failures. Starting while stop/start is already
pending must not create a second session. Keep operation ownership explicit so
an old Stop cannot stop a newly started session's native service or speech.

A storage lock around individual methods is insufficient to serialize an entire
lifecycle operation or cancel native speech. Document the single-runtime
assumption for the shared controller and verify Expo's foreground/headless task
behavior; if concurrent runtimes are possible, propose the needed transactional
persistence to Sol rather than claiming the JS map coordinates both.

Test the three cases using both production storage with delayed fake I/O and
the in-memory implementation. Also test duplicate concurrent cue claims and
late native completion callbacks. Assert observed final storage and audio, not
only the object returned by Stop. `ExpoSpeechAdapter.stop` currently swallows
native failure; remove that false success behavior where lifecycle code needs
to know whether audio was actually silenced.

Scope remains task 001. Return the diff and results to Sol; field acceptance and
APK signing/setup are separate from passing unit tests.
