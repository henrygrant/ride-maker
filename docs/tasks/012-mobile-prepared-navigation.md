# Task012: mobile prepared GPX and foreground navigation integration

Status: source/controller integration accepted by Sol; see the
[source review](../reviews/012-sol-mobile-integration-review.md). The pure
navigation package was accepted in commit `74403c2`; routing and prepared
storage were accepted in commit `2eff98d`. This work has not been accepted end
to end, built natively, or verified on the dedicated Mac emulator.

## Implementation

- Raw imported GPX rides remain preview-only. The floating map dock offers an
  explicit online **Prepare directions** action and clearly says before the
  action that it sends the GPX trace to the online matching service. A
  cancellable controller uses the saved original
  document and source identity token, handles sparse-waypoint choice, provider
  errors and retry, stale selection, single acceptance, and ready/partial
  review states.
- Preparation review keeps the map visible with original and candidate line
  styles, a compact legend, distance and coverage summary, sparse-inference
  disclosure, and tappable location warnings. Failed and needs-choice results
  cannot be accepted. Partial acceptance is explicit.
- Acceptance publishes through `LocalRouteStorage.acceptPreparation`, reloads
  the selected ride and library from storage, and preserves import provenance,
  source filename, original geometry, prepared metadata, active version and
  source identity through the App conversion. Saving is an atomic UI phase that
  locks route selection, back, creation, import, rename and deletion until the
  storage write and refresh finish. Preparing/review remains cancelable. The
  menu offers original preview and revert; failed prepared assets fall back to
  the stored original and offer recovery.
- Foreground navigation compiles the accepted geometry with unavailable output
  segment indexes from `outputCoverage` and uses the production
  `@ride-maker/navigation` reducer for local created, shared, and accepted
  imported rides. Fixes include capture and receipt times; invalid Android
  speed/heading values are omitted. State-driven speech uses engine cue IDs;
  queued announcements are invalidated on mute, pause, route change, and end,
  including while awaiting speech cancellation. A bounded-search failure adopts
  the engine's degraded state, keeps the guidance error through repeat/pause,
  and clears only after a successful location fix. Repeat, pause and resume
  controls are exposed. Raw GPX remains preview-only.
- The trace provider accepts `EXPO_PUBLIC_TRACE_MATCHING_URL`, derives the test
  fixture `/trace_route` endpoint only under strict test mode, and otherwise
  uses the documented low-volume public development endpoint.

## Focused verification

- `npm run check --workspace=@ride-maker/mobile` — passed after the app and
  controller changes.
- `npx vitest run apps/mobile/src/controllers/prepare-ride-controller.test.ts apps/mobile/src/providers.test.ts apps/mobile/src/created-ride-navigation.test.ts` — 15 tests passed. The controller tests cover
  actual preparation and storage acceptance/reopen/corrupt-asset recovery,
  sparse choice, provider failure/retry, cancellation and stale success,
  partial acceptance, stale selection, double taps and the save-time selection
  lock. The HTTP fixture navigation test now compiles and replays the actual
  created ride through the production navigation reducer.
- `npx vitest run apps/mobile/src/controllers/foreground-navigation-dispatch.test.ts apps/mobile/src/controllers/foreground-speech-queue.test.ts` — added regression coverage for retaining SEARCH_LIMIT's degraded state until a recovery fix and suppressing queued speech invalidated during cancellation.
- `npm install --package-lock-only --ignore-scripts` updated only the mobile
  workspace dependency entry for `@ride-maker/navigation` in the root lockfile.

The focused mobile check and tests passed after the routing and storage
acceptance commits. No native build, emulator flow, Maestro run, background-session integration, or physical
ride acceptance is claimed here. The dedicated Mac import → prepare → review →
accept → restart → Ride flow, cancellation/failure flow, partial-unavailable
guidance, and original recovery remain required gates after Sol review.
