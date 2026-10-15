# GPX preparation design for the next implementation task

Status: Sol architecture draft, 2026-10-14; implementation follows review of
Task007. This is not an accepted or implemented feature.

## User workflow

Import preserves the original GPX and opens its preview as today. An explicit
**Prepare directions** action starts online matching. Present the original and
matched geometry together with localized deviation/gap warnings. Cancel or a
failed preparation retains the original ride. Accept publishes a prepared local
version. Starting a ride uses saved data without contacting the matching service.
Do not require an account or add general planning options to this flow.

Tracks are matched along their full recorded path, never reconstructed from only
the endpoints. A sparse route-only GPX needs an explicit distinction between
literal preview and bicycle routing through its points; do not silently assume
sparse points accurately describe every intervening road.

## Matching boundary

A pure/provider-independent preparation package owns validation, bounded input
simplification/chunking, segment/chunk identity, maneuver reconciliation, coverage
and deviation assessment. A Valhalla adapter uses bicycle `trace_route` with
`shape_match: map_snap`; supplementary `trace_attributes` can expose unmatched
input points. Shapes preserve source order and separate GPX segments. Overlapping
chunks require deterministic seam reconciliation; never duplicate turns or join
unrelated ends. Simplification must have a measured error budget and preserve
turn/reversal/intersection anchors, rather than dropping every nth point.

Valhalla can return disconnected trace continuations as alternates. An adapter
must inspect them rather than silently accepting only the first path. Failed or
unmatched sections retain original geometry and explicit guidance-unavailable
coverage. Assessment compares the whole source and output, including the reverse
direction (detours), not just input-point proximity. Return location-bearing
warnings, maximum/percentile deviations and coverage facts; no invented generic
confidence score. Thresholds are configuration with documented initial values.

Runtime input bounds, timeouts, cancellation and request concurrency are required.
Large GPXs (the existing importer accepts 100,000 points) must take a bounded
simplification/chunk path or give a clear recoverable preparation limitation;
never hang, silently truncate the ride or mark incomplete coverage fully ready.
Tests include loop, out-and-back, intersections, gaps and dense long traces.

## Persistence and navigation

Original GPX bytes and original parsed snapshot remain recoverable. Publish a
versioned prepared snapshot/metadata only after writing and validating the whole
version; the SQLite active-version pointer is the commit point. Interrupted work
must leave the previous active ride usable, with orphan cleanup on startup. Use
additive migrations for existing v1/v2 records. Do not repurpose imported
provenance as created just to enable Ride. Keep original and matched geometries
separate and carry warnings/coverage into the saved prepared version.

Readiness is based on validated prepared instructions and coverage, not simply
`sourceKind !== imported`. Partial guidance is visibly partial and the engine
suspends misleading instructions at uncovered gaps. Existing created/shared
routes remain compatible. Saved names, rename recovery, delete cleanup and
local-storage errors must account for prepared versions. Record version IDs in
navigation checkpoints to prevent restoring a session against changed geometry.

## Service and verification

Service implementation is distinct from deployment. A preparation gateway limits
body size, point count, concurrency and timeouts and returns structured errors;
it must not become an unrestricted public Valhalla proxy. A public demo endpoint
is acceptable only for low-volume development smoke checks, not a production
availability promise. Regional self-hosting coverage must be explicit and backed
by resource/update/attribution/recovery documentation before enabling production.
Nauvis currently has 32GiB RAM, 16 logical CPUs and about 310GiB free root disk;
this is a capacity observation, not approval of a planet import.

Use deterministic adapter fixtures for edge cases, plus a small separate live
matching check with synthetic or suitably licensed cycling traces. Mobile tests
focus on prepare/review/accept/cancel/fail and original-preserving restart. Do not
rerun unrelated UI matrices during pure matching work. Physical guidance remains
a separate gate.

## Primary references checked

- [Valhalla map matching](https://valhalla.github.io/valhalla/api/map-matching/):
  trace directions, input matching modes and disconnected-path handling.
- [Valhalla graph generation](https://valhalla.github.io/valhalla/mjolnir/getting_started_guide/):
  regional graph build and operational planning.

## Offline map follow-on

The pinned MapLibre native API provides offline region management. OpenFreeMap
currently permits bounded offline downloads with a per-download tile/size cap,
limited concurrency and an identifying User-Agent; implement conservative limits
and verify actual downloaded resources, styles, glyphs and sprites. Larger packs
need an authorized provider/self-hosted source, not artificial splitting to evade
limits. Packs must support cancellation/resume/removal and truthful incomplete
states. A cached foreground map is not evidence of offline completion.

- [MapLibre OfflineManager](https://maplibre.org/maplibre-react-native/docs/modules/offline-manager/)
- [OpenFreeMap mobile offline policy](https://openfreemap.org/quick_start/#mobile-apps)

Pinned-library audit: MapLibre React Native 11.4 exposes offline pack status
(resource/tile count and size), pause/resume, a tile-count ceiling, and native
request header transforms. Its JavaScript NetworkManager only controls
connectivity; it does not expose a request-concurrency setting. Do not assume
`createPack` alone satisfies a provider's concurrency limit. The offline follow-on
must configure native request dispatch or use an appropriately controlled source,
and verify identifying headers and concurrency before a public download smoke.
