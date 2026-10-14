# Task004: mobile ride creation and three primary surfaces

Status: ACCEPTED — Android emulator baseline (2026-10-14).
Evidence: [Sol review and final run records](../reviews/004-sol-mobile-creation-review.md).
Physical locked-screen GPS/audio, offline maps and navigation-engine replay remain separate gates.
Owner: Sol; implementer: Gemini Pro. Baseline: accepted task003, `fd94b8f`.

## User decision and outcome

Henry wants a simple cycling app and needs route creation on the phone to test
navigation without obtaining external GPXs. He identified three main surfaces:
view/manage my rides, create a ride, navigate a ride. Implement that structure
with thoughtful native UX; this is a focused product change, not a desktop planner
ported into a small screen. No account needed for local rides.

The main journey: My rides → Create ride → choose points → Preview → Save ride →
ride detail → Ride. Import GPX and opening a shared link remain secondary entry
paths into the same library/detail concept. Navigation is an active mode entered
from a ride, not an empty third tab. Avoid extra onboarding, settings dashboards,
social/training features and advanced routing preferences.

## UX contract

### My rides

Home is titled My rides and gives the saved library priority. One primary Create
ride action; Import GPX is secondary. Empty state briefly explains both options.
Rows show ride name and distance, with a quiet truthful status: directions available
or GPX preview. No accounts/public feed between the rider and their own rides.
Shared-link access remains discoverable through a secondary action. Diagnostics
stays available to development/testing without dominating consumer navigation.

The list scrolls properly with many rides, keyboard hidden, safe-area padding and
long names. Provide rename and delete in ride details/overflow. Rename preserves
geometry, original import bytes, identity and directions; cancellation is harmless.
Delete asks for explicit confirmation naming the ride. Automation only manipulates
synthetic emulator rides; never delete/reset owner-phone data.

### Create a ride

Use a map with a compact native point list/panel. Start and finish have clear
labels. Start offers Use my location explicitly, requesting foreground permission
only on tap; denied/unavailable location still allows manual map/search selection.
Do not start GPS tracking or ask background/notification permission for creation.

Each point can be selected by place search or Choose on map. Map picking enters
an explicit Start/Finish/Stop placement mode with a clear confirmation and cancel;
ordinary map taps must not silently add points. Show identifiable markers and the
point list. Search is cancellable/debounced; stale results cannot replace a newer
query or a different point field. Use optional location bias only after permission.
Map selection stays usable when reverse geocoding fails; use a readable fallback
label, not raw coordinates as a required user input.

Optional Add stop (up to8 via points) is visible without a multi-step wizard.
Stops can be removed and moved up/down through labeled accessible controls.
Support returning to the start by selecting the start as finish; a loop requires
at least one distinct intermediate point. No automatic scenic loop generator.

Routing uses one sensible road-cycling default for now. Explicit Preview ride
requests routing after points are chosen; don't call on every map pan. Editing any
point invalidates the previous preview and Save/Ride until rerouted. Cancel or Back
retains the draft within the current process; returning to library with a nonempty
draft offers Keep editing or Discard. Don't add a separate draft library/version
history in this phase. Default draft does not claim to be a saved ride.

Preview clearly shows the whole routed line, chosen points, distance, generated
turns availability and a default editable name. Primary Save ride; secondary Edit
points. Save stores locally and returns to ride detail, without accidentally
starting tracking. Loading, no results, no routable path, timeout/rate-limit and
storage failure have useful retry feedback while preserving the point draft.
Back/cancel cancels in-flight work; stale requests cannot display/save obsolete
geometry. Avoid unnecessary estimated-time promises; provider distance/time may
be preserved in data but display distance as the main summary.

### Ride detail and Navigate

Detail previews the stored geometry and distance, with Ride for validated created
rides with generated instructions. Imported GPXs stay preview-only with truthful
status. Opening a shared prepared route retains current behavior.

Ride enters the existing foreground navigation mode with a prominent next-turn
instruction/distance and map. Mute/unmute and End ride have clear accessible labels
and thumb-accessible placement. Exiting active navigation requires confirmation;
cancelling keeps the ride active, confirming ends GPS/speech then returns to detail.
Hardware Back follows the same policy. Don't put creation/library controls on the
active ride screen. Don't introduce pause/resume or new navigation algorithms in
this task. Preserve existing cue timing, off-route, arrival and teardown behavior.
Use concise foreground-only/maps-require-network status until later milestones.

Use native typography, contrast, minimum44dp touch targets, safe areas and useful
accessibility labels. Don't cram all surfaces into one ever-growing App.tsx:
extract focused screens/components and controller/storage adapters. Keep the
existing pinned stack; a new navigation framework is not required for these modes.

## Technical contract

Reuse `@ride-maker/routing` (Valhalla bicycle geometry/maneuvers) and
`@ride-maker/geocoding` (Photon search). Keep adapters injected/configurable so the
normal consumer code and controlled E2E service use the same request/response path.
Add bounded timeouts/AbortSignal and deep validation of coordinates, summary,
maneuver instructions/segment/shape indexes before saving/executing data. Preserve
web API compatibility and add shared-provider tests for any correctness changes.

Creation/search requires network; already-saved local data never requires a live
routing/search/API request to reopen or start foreground guidance. Use existing
public provider defaults for this local development phase, documenting provider
terms, limited usage and lack of availability guarantee. Default automated tests
use the local fixture server for geocoding and routing, not public endpoints.
One separate low-volume synthetic live smoke may verify provider compatibility.
Do not deploy self-hosted services, spend money or alter production server config.
Self-hosted reliable service remains a release prerequisite, as in the mobile plan.

Persist a generated ride's FULL versioned RouteDocument snapshot, including valid
maneuvers. Never export to GPX then reparse to recover instructions (GPX exporter
omits them). Generated GPX is a derived geometry asset, not an original user import;
record imported/created provenance explicitly. Imported originals remain byte-exact
and are never rewritten by rename or planner changes. Keep shared domain schema1.
If SQLite/local-record schema needs extension, define additive migration and
backward compatibility for existing task003 rows; test upgrade/restart/rollback.
Store atomically, reject ID collisions before writes, preserve accepted init/retry/
corruption/cleanup behavior. Rename/delete operations must not leave mismatched
snapshot/metadata state; handle interruption and isolate corruption.

Navigation readiness is explicit local provenance + validated stored instructions,
not a blanket local-route exclusion or a fabricated readiness flag. Endpoints alone
are not a faithful preparation of imported GPXs: no rerouting imported tracks.
No account/cloud upload of created rides. No consumer raw-coordinate logs or test
links enabling seeding/observations. Test-only seams remain labeled and disabled
in ordinary standalone builds.

Owned scope: mobile UI/controllers/storage, targeted shared routing/geocoding
validation, dependency manifests if required, existing fixture server/runner/flows
and synthetic fixtures, relevant docs. No navigation-engine/diagnostics semantics,
GPX-preparation service, offline map downloads, production deployment, social or
training features. Do not replace the monorepo or introduce broad UI infrastructure.

## Acceptance and evidence

1. A rider creates a ride through real native controls: explicit map placement and
   place search, start/finish plus optional stop, routed preview and Save. Correct
   markers, geometry and turns/distance observed; review actual screenshots.
2. Point edits invalidate preview; stale search/routing responses, cancel/back,
   permission denial, no results/path and provider/storage errors preserve useful
   state and cannot save stale/incomplete routes. Pure controller/provider tests
   cover races with deferred responses and meaningful expected geometry/indexes.
3. Created ride survives standalone force-stop/restart with network/API/routing
   blocked and Metro unavailable. Same ID, points, direction/geometry, maneuvers,
   distance and provenance preserved. Original imported fixture bytes unchanged.
4. Created ride actually enters foreground guidance through stored production
   instructions; native GPS simulation observes expected turn/progress, off-route
   and arrival. Confirmed End stops location/audio; cancelled Back/End keeps session.
   No replay/locked-screen/offline-map claims from these results.
5. Library works with at least12 synthetic saved rides and long names; scroll to
   last, reopen correctly, rename then restart, cancel deletion, confirm deletion,
   verify other rides and imported originals remain intact. No lost records.
6. Existing nine task003 journeys still pass semantically. When UX moves controls,
   update selectors/navigation steps transparently, keep permission/GPS/persistence/
   failure assertions. No blanket optional taps/retries or weakened contracts.
7. Expand fixture server with controlled routing/search replies (real protocol),
   include failure and delayed responses, then require three fresh final expanded
   standalone suite passes, consumer isolation and existing negative demos.
8. Monorepo check/test, verifier/classifier tests, affected shell/JS checks, APK/
   source/harness/fixture identity and owned-resource/signal checks pass. Preserve
   failed evidence. Do not call screenshots merely existing a UI/map pass.

Handoff includes UX decisions and actual screen screenshots, contracts/migrations,
changed files, commands/exit statuses, failures/fixes,3fresh suite IDs, standalone
consumer/native guidance/storage/network evidence and remaining device gates.
Sol reviews assertions and results, then owns acceptance and commit/push.

## Execution and delegation

Canonical `/home/henry/projects/ride-maker`, Mac `~/code/ride-maker`
(`/Users/henry/Code/ride-maker`), clean main atfd94b8f. Inspect/preserve both checkouts
and applicable AGENTS. Use SSH key `/home/henry/.ssh/id_ed25519_github_nauvis`,
userhenry@100.101.127.83 withBatchMode/IdentitiesOnly/ConnectTimeout8. Mac nvmNode24.16,
ZuluJava17, SDK~/Library/Android/sdk, Maestro~/.maestro/bin/maestro. Run only dedicated
AVDride-maker-e2e/emulator-5554, package net.thg3.ridemaker.e2e; ownerphysical
R5CY52MQVCY andnet.thg3.ridemaker/Metro8081 protected. No personal phone installs,
resets/GPS spoofing or Metro stop for automation. Native dirs/APKs/logs/artifacts
ignored; test flags disabled before any later ordinary development build.

Read task003/final Sol review and accepted tests before changes. Previous Gemini
rounds had wrong success claims and regressions caused by replacing App wholesale;
implement incrementally, preserve validated behavior, verify source parity, report
only actual evidence. Do not commit/push/deploy; leave implementation for Sol review.
If quota/infrastructure blocks, preserve useful work and report exact pending gates.

## Provider references

- Existing contracts: `packages/routing/src/types.ts`, `valhalla.ts`, and
  `packages/geocoding/src/index.ts`.
- [Valhalla API](https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/).
- [Photon source and demo usage policy](https://github.com/komoot/photon): low-volume
  demo requests are allowed, availability is not guaranteed; no public-service E2E.
