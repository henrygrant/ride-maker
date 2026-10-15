# Task008: GPX preparation core and Valhalla trace adapter

Status: interrupted by Gemini's usage quota; partial implementation is not
accepted. Three independent readiness probes fail; see
[initial Sol review](../reviews/007-009-sol-initial-review.md). Gemini implements;
Sol reviews. This bounded
pure-code task can run alongside Task007 because it owns a disjoint package and
does not touch root lockfiles, app/native files or the engine package.

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
