# Task 003: local GPX import and saved routes

Status: READY FOR IMPLEMENTATION (2026-10-11).
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
