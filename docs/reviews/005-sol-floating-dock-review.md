# Task005 floating dock review

Accepted on the Android emulator, 2026-10-14. Gemini 3.8 Flash High implemented;
Sol reviewed source, test assertions, recorded manifests and native screenshots.
User approved Concept A from the interactive sketches before implementation.

## Accepted behavior

Creation keeps a full-screen MapLibre map mounted behind floating controls and a
compact route dock. Start/finish selection, focused search, explicit center-pin
placement, stop options and Save naming are separate modes. Confirmed edits
recalculate bicycle routes automatically; a stale line remains dimmed and cannot
be saved. Locate moves only the camera. Up to eight stops support reordering,
removal and undo. Cancelling a new stop or staged search preserves the itinerary.
Blank names block final saving but allow returning to the naming sheet. Draft
keep/discard and save errors preserve the existing storage contract.

## Review findings and resolution

- Round 1 changed finish through Locate, failed to schedule routes after GPS,
  committed unresolved cancelled stops and crowded point controls. These were
  corrected with camera-only location, owned pending-operation tokens,
  transactional stop placement and labelled options menus.
- Round 2 left loop Add stop search disconnected from a results state and made
  a blank title prevent reopening Save. Dedicated staged new-stop search and
  separate route/name readiness corrected both. Controller tests cover late
  results, undo, GPS ownership, stop limits and blank-name recovery.
- Initial reports cited unrecorded passing runs. Those reports were rejected.
  Actual run `run-20261014-120225-focused-09-create-ride-and-preview` failed its
  Save naming assertion. Later reports were checked directly on the Mac disk.
- Sync created unused duplicate files on the Mac, including four files under
  `apps/mobile/src`, and accidentally overwrote its root README. Exact file
  comparison and normalization restored checkout parity. No actual app source
  differed between the passing full run and the final checkout. Fresh normalized
  builds and a focused creation/offline restart pass verified the final identity.

## Evidence independently checked

- `npm run check`: all eight packages pass.
- `npm test`: all configured workspaces pass; mobile has 145 tests in 21 files.
- Full native run `run-20261014-135922`: 14/14 journeys pass, including existing
  imports, permissions, navigation, offline route-data restart and management.
  Historical source `bfa7870d33571f0053f95fd66c86451bb91ec527d6d60e1f620a2bc378e2b453`;
  APK `a18c0aef7908aa4af642e51de28ba88fc0b89e0706f7a5ee5327dd12add7c5ea`.
- Final normalized run `run-20261014-142822-focused-09-create-ride-and-preview`:
  2/2 creation and offline restart journeys pass, with 14 screenshot artifacts.
  Source `85d3510ae5392b0aa0b71abdd3f141f8f25e1f6c271cbd0ab8c1bdea1cb1eed5`;
  harness `1d3f0e5053be4d5cb5f00d71c6460614aff4fb1d228be7eb1ce0104ad7738dcc`;
  APK `df47ba77b7c6b678c89cb98df96c106867d412ad6b8055b1c5373f76b3d26c0a`.
- Native screenshots reviewed: initial dock, candidate pin, search, expanded
  points, four stops with long names, labelled stop options and Save keyboard.
  Controls are visible in the tested portrait viewport; point list scrolls.
- Final consumer source `c5e858c7b6845bb1f593e66de8519a08ce39e4ee6e4c03eccca472f5d2977150`;
  APK `4d5d6b4be498ec20d6e9c478e7f23e4ce898e06762bee575aa84128f65bd9045`.
  Package `net.thg3.ridemaker`, cleartext disabled, installed with `-r`.
  Non-destructive Maestro commands, manifest and screenshot at
  `~/.maestro/tests/2026-10-14_143420/consumer-nondestructive/` complete successfully:
  ordinary library actions, saved ride and shared controls present; test seeding,
  test badge and diagnostics absent. Consumer data preserved.
- Mac and Nauvis final source/consumer/harness fingerprints match. Generated
  native configuration restored to consumer. Consumer MainActivity remains
  foreground on visible `ride-maker-e2e` / `emulator-5554`. Owner phone untouched;
  owner's Metro PID 93242 remains running.

## Road routing and limits of acceptance

The test package deliberately uses a near-straight synthetic three-point route.
The ordinary app uses the same public Valhalla bicycle provider as the website.
The live consumer screenshot shows a curved road-following 2.9 km route with five
maneuvers; its saved document has 228 geometry points, two control points and five
maneuvers. The earlier claim of 235 geometry points was corrected.

Numeric pan coordinates are not asserted by an automated trace. The native flow
covers pan cancellation and confirmed placement; live consumer route creation
provides separate map-selection/routing evidence. Reorder coverage uses UI actions
and subsequent route/navigation assertions; it is not a complete geometry matrix.

Acceptance covers the tested Android portrait emulator and current foreground
navigation baseline. iOS, physical riding, locked-screen GPS/audio, offline map
tiles and broad small-screen/landscape/accessibility scaling acceptance remain
separate gates. Offline saved route data does not imply offline map availability.
