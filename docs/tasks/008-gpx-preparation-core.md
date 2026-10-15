# Task008: GPX preparation core and Valhalla trace adapter

Status: pure preparation/storage boundary accepted by Sol; native transport and
mobile workflow acceptance remain pending. See
[core acceptance](../reviews/008-009-sol-core-acceptance.md). The original Gemini
handoff was incomplete and three independent readiness probes failed; see
[initial Sol review](../reviews/007-009-sol-initial-review.md). This bounded
pure-code task can run alongside Task007 because it owns a disjoint package and
does not touch root lockfiles, app/native files or the engine package.

## Luna implementation update (2026-10-14)

The routing preparation core and Valhalla `trace_route` adapter are implemented
in `packages/routing/src/preparation/` and exported from the routing package.
The provider-independent readiness probes now reject reversed paths, absent
instructions, and malformed maneuver references. Runtime input/provider checks,
finite configuration bounds, request/response caps, cancellation handling,
chunk failure retention, separate source segments, stable generated identities,
and conservative source-interval coverage are in place. Exact ordered overlap
is required to merge chunks; unresolved seams remain disjoint and lower readiness.
Disconnected provider legs remain separate and create a partial-readiness warning.

Round-two implementation notes (2026-10-14): provider outputs are runtime
validated and must be assigned to ordered source progress before they contribute
coverage. Otherwise the original source interval is retained without guidance.
Required `outputCoverage` metadata maps each output segment to inclusive source
point and cumulative-distance bounds and records whether validated maneuvers are
available. Coverage uses the union of those source intervals, so overlapping
chunks do not double count. Assessment indexes every source/output edge, checks
every supplied vertex, and interpolates at most 5m apart; its reported 2.5m
sampling error budget is included conservatively in readiness. Work and request
limits fail explicitly instead of truncating or claiming readiness. Prepared
documents retain the source route ID; storage owns its immutable preparation
version identity.

Verification performed:

- `npm run check --workspace=@ride-maker/routing` — passed.
- `npm run test --workspace=@ride-maker/routing` — passed, 44 tests in 6 files.
- Authored regressions cover malformed/reversed outputs, a short localized
  detour, reversed closed loops, reordered repeated passes, a failed middle
  chunk, unavailable output correspondence, and bounded 100,000-point geometry.
- A one-off three-point synthetic trace against the documented development
  Valhalla endpoint passed through the actual adapter; no personal GPX was used.

Known review gates: network-snapped chunk overlaps without a provable seam are
kept as separate source-clipped portions and require review; no speculative seam
is invented. The adapter's React Native non-streaming response fallback can
enforce the byte cap only after `text()` buffers the body; streaming runtimes
enforce it while reading. Native transport and storage/mobile integration remain
separate review gates.

## Scope and API responsibilities

Implement under `packages/routing/src/preparation/`, export through the routing
package index. Follow [the design](../contracts/008-gpx-preparation-design.md).
No deployment, persistence migration, mobile UI or live personal GPX uploads.
The existing `/route` provider behavior must stay compatible.

- Define a typed trace-matching provider and validated response (matched segments,
  stable maneuver indexes, unmatched/disconnected observations). A Valhalla adapter
  POSTs full sampled trace shapes to `trace_route` using bicycle `map_snap`, not
  endpoint routing. Optional matching attributes can supplement coverage evidence.
  Endpoint, timeout and request cancellation are injectable. Defaults may be the
  existing low-volume development endpoint; document that this is not a production
  service guarantee. No silent retry against a different provider.
- `prepareGpxRoute(document, provider, options)` (or clearly equivalent exported
  API) returns a new matched document plus versioned review metadata: source ID,
  per-source-segment output mapping, coverage, location-bearing warnings, deviation
  facts and ready/partial/failed status. Inputs remain unchanged. Preserve source
  kind and filename; do not turn an import into a created route to bypass gating.
- Validate every input/output coordinate, segment, maneuver reference, instruction
  and summary. Disconnected Valhalla alternates are part of the response contract,
  not ignored. Missing/unmatched geometry retains its original section with a
  guidance-unavailable warning; it must not be mislabeled matched or fully ready.
- Track GPX kind/sampling when known. Sparse route-only input is never silently
  interpreted as a faithful recorded track. Return a review-required warning or a
  discriminated needs-choice outcome, ready for later explicit UI selection.

## Trace fidelity, long inputs and chunk boundaries

Preserve direction, loops, out-and-back reversals and separate GPX segments.
Never create an edge connecting segment gaps. Use bounded simplification with an
explicit small error budget and preserve source endpoints/critical anchors.
For 100,000-point imports, chunk bounded trace requests with overlap; reconcile
seams by geometry/progress correspondence and deterministic maneuver identities.
Do not concatenate full overlaps or remove turns only by instruction text.
If a seam cannot be reconciled safely, retain both disjoint portions and flag the
problem; do not invent a connection. Limit requests, output size and concurrent
requests, and return an actionable error rather than truncation.

Assess matched-vs-original geometry in both directions across the whole trace;
input points close to a large output detour are insufficient evidence. Report
coverage and concrete maximum/percentile deviations with documented configurable
engineering thresholds. The tests must catch reversed/wrong parallel paths and
extra detours, not just confirm that a polyline was returned. No generic invented
confidence percentage. Do not claim a prepared route is instruction-ready if any
indexes fail validation or material uncovered sections are hidden.

## Focused verification and ownership

Use real adapter-shaped fixtures for clean trace, failure/timeout/abort, malformed
JSON, disconnected alternates and malformed indexes. Include preparation fixtures
for five representative cycling shapes: normal curved ride, closed loop,
out-and-back, crossing/chunk seam and separate segments/unmatched section; plus a
dense long trace that exercises bounded processing. Expected geometry and warning
facts must be independently authored. Fixtures are synthetic or clearly licensed.

Run routing package checks/tests and any affected consumer typechecks once. A
small synthetic public-service smoke may be used if it proves the adapter contract,
but never make deterministic tests depend on it. Record actual failures, commands,
tradeoffs and remaining integration gates. Do not run native builds/Maestro or
full UI regressions. No package-lock/root package changes (no new dependencies),
no writes in `packages/navigation`, no app source edits, no commit/push until Sol
review. Edit only routing package files and this task's completion notes; leave
other agents' work intact.
