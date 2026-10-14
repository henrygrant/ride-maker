# Task006 map home review

Accepted as a focused Android UI pass on 2026-10-14. Gemini 3.8 Flash High
implemented the approved map-home sketches; Sol reviewed code, native screenshots
and actual Maestro command records. The updated full regression suite is not
accepted as a whole by this review.

## Result

The app opens on a map with floating Create/Import controls and My rides access.
The rides drawer and selected-ride dock use the same mounted map. Selecting a
route fits saved geometry and exposes Ride only with valid directions; raw GPX
remains preview-only. Rename and confirmed Delete are behind the options menu.
Task005 creation and existing foreground navigation remain in place.

## Corrections verified in source

- Removed a test-only timer that falsely reported a rendered map after 800ms;
  observation now comes from the native fully-rendered callback.
- Memoized geometry and guarded camera fitting to avoid refits during ordinary
  UI updates. Measured dock/drawer heights inform attribution placement.
- Restored floating cards, safe-area gaps and accessible targets to match the
  approved concept. My rides stays available with a selected route.
- Rename/Delete use synchronous pending guards, disabled dialog controls,
  in-dialog errors and cancellation protection. Hardware Back dismisses the
  options menu before clearing selection. Route-keyed docks reset modal state.
- Locate denial/unavailability gives localized feedback without blocking actions.
- Removed a unit test that tested its own invented Back implementation.

## Evidence checked directly

- Mobile TypeScript check passes; 147 mobile unit tests pass in 22 files.
- Mac direct Maestro folder `~/.maestro/tests/2026-10-14_165523/12-map-home-and-sheet/`:
  56 completed commands. Home, drawer, route selection, options-menu Back,
  rename cancellation, delete cancellation and return home pass.
  Screenshots reviewed: `12-map-home-initial.png`, `12-my-rides-drawer-open.png`,
  `12-selected-ride-dock.png`, `12-returned-to-map-home.png`.
- Consumer folder `~/.maestro/tests/2026-10-14_165752/consumer-standalone/`:
  22 completed commands, two screenshots. Ordinary home/library controls render,
  test seams are absent and the existing 2.9km local ride remains present.
  Installed with `-r`; no data clear. Later reusable-flow edits remove checks of
  that specific ride name/distance, preserving generic assertions.
- Test source: `a7340ce2157148963046b617494a9aa9c0cf6344f672daa9a5e82dc0c890d767`.
  APK: `210285e0053d5aefb9e070950e8c77874e94a785fc1275f66d62f8b3cdbcc854`.
- Consumer source: `21cd3acf8d802003c8dce26c7872546d23c231a79649fdb69d2a32ce5c98add8`.
  APK: `efc9007a5da87a8f93a059b9a39bfc610b9a3a11dda271312689b60cc4499b4d`.
- Final harness: `3f303775511b5371f5d07aa1376cc86302489b9cbe07854fb09cbc4e3c863092`.
  Local and Mac source fingerprints match the APK sidecars.
- Mac consumer MainActivity remains foreground on visible emulator-5554.
  Task-owned orphan fixture server/reverse port 8088 were cleaned up. Owner
  phone was untouched; Metro PID 93242 remains running.

## Failures and scope

Earlier library-management retries used stale renamed data and are not passes.
Direct smoke folder 165446 failed its initial Locate assertion; 165710 failed a
saved-name lookup. Both remain recorded; the later direct runs above passed.
Runner run `run-20261014-164040-focused-09-create-ride-and-preview` ends with
completed creation UI commands but has no summary. Its offline subflow and
post-processing remain unverified; it is not a passing suite run.

This acceptance covers the new Android portrait UI and recorded focused
interactions. Updated flows for other journeys are committed but not certified by
these smoke checks. Successful Rename/Delete writes, offline restart/navigation,
full route-load race scenarios, iOS and broader viewport/accessibility behavior
need their relevant checks when next exercised. Existing storage logic and
routing engine were not rewritten. Locked-screen guidance and offline tiles
remain separate future acceptance gates.

The user prefers testing that finds real issues, while avoiding repeated runs
caused by stale fixtures or infrastructure mistakes. Future UI polish should use
focused checks; broad regression is reserved for appropriate release/integration
work, with unresolved failures reported explicitly.
