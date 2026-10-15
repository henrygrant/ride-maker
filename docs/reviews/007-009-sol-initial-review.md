# Initial Sol review of navigation and prepared GPX work

2026-10-14. **Not accepted.** These are review findings against work in progress,
not completion evidence for a mobile feature. No app integration or native build
has been performed for these tasks.

## Provider interruption

Task008 (`ride-maker-task008-gpx-core-round1-20261015`) and Task009
(`ride-maker-task009-prepared-storage-round1-20261015`) ended with the provider
message **Usage Limit Reached**, reporting a reset in 23 hours, 35 minutes.
Their terminal orchestration status is completed, but their implementations are
unfinished. Do not interpret terminal status as task acceptance. Task007 also
terminated on the usage limit (reporting 23 hours, 33 minutes), after making further
engine corrections. The owner has been asked whether Codex may implement while
Gemini is unavailable; existing work is preserved meanwhile. No Gemini task
remains active.

## Executed evidence

- Navigation package typecheck passes at this working snapshot.
- Routing package typecheck passes at this working snapshot.
- Nine authored Valhalla-adapter tests pass, but do not cover the failing
  provider-independent readiness cases below.
- Mobile typecheck fails because Task009 added required
  `LocalRouteDb.commitActivePreparation` but stopped before implementing the DB
  adapters and updating test doubles. This is an unfinished interface change,
  not an accepted app regression or evidence of working storage.
- The first navigation package test run had 20 passes and two failures: reversal
  progress, and the large-route replay expecting an implausible instantaneous
  jump. Gemini was still revising this code; rerun after it settles.
- Independent `packages/navigation/src/sol-review.test.ts`: the full 161-fix dense
  out-and-back replay passes, including return-leg progress and arrival. Two
  boundary probes initially failed: all-identical stationary geometry and a
  malformed persisted maneuver with string shape index were accepted. Gemini
  subsequently corrected both: a fresh full package run passed all 30 tests.
  A fourth independently authored probe then passed: three stationary fixes at an
  out-and-back start, with reversed heading, do not trigger finish or progress.
- Independent `packages/routing/src/preparation/sol-review.test.ts`: all three
  probes fail. Reversed matched geometry, a match with no maneuvers, and a provider
  result containing an invalid maneuver reference are each reported `ready`.

Commands: `npm run check --workspace=@ride-maker/navigation`,
`npm run check --workspace=@ride-maker/routing`, and each package's `npm run test`
with the named review test path. The focused behavioral failures contradict
readiness despite passing static checks. No broad regression claim follows.

## Required corrections and further review

Task007 now rejects degenerate runtime geometry and validates integer reference
types rather than relying on JavaScript array lookup coercion. Earlier in-flight
findings covered the GPS-interruption rejection deadlock, reliable-fix baselines,
immediate suppression of misleading off-route cues, dense corridor search and
bounded spatial-index construction. Recheck the final implementation and tests
for each; intermediate edits are not verification. Gemini also removed brittle
wall-clock assertions and corrected the implausible replay timing. Passing engine
checks do not establish completed mobile integration or physical guidance.

Task008 must validate arbitrary provider output as well as the HTTP adapter's
response. Never silently drop invalid maneuver references and then call the
remaining route ready. Instruction readiness needs validated instructions and
coverage. Geometric nearest-distance assessment cannot establish traversal
direction: reversed paths require ordered correspondence checks.

Additional code-review findings needing tests/corrections:

- Failed chunks are currently skipped, with possible reconciliation across the
  missing chunk. Preserve original geometry for each unmatched source interval.
- Nearest point-pair seam selection can splice unrelated passes of an intersection
  or out-and-back. Use known overlap progress and ordered multi-point agreement.
- Full chunk summary addition double-counts overlap. Recompute reconciled distance
  and account truthfully for duration.
- Coverage based on matched path length divided by source length can label a
  detour fully covered while hiding unmatched source intervals. Use source coverage.
- Flattening separate source segments for reverse deviation assessment introduces
  fictitious cross-gap edges. Keep segment boundaries in both directions.
- Deviation assessment currently scans each source point against all output edges
  and vice versa. Bound work for 100,000-point imports with an appropriate index
  and bounded sampling/error strategy; do not rely on a tiny fixture's timing.
- Validate finite summaries, coordinate/index/instruction types and all configuration
  bounds. Bound requests, output sizes and HTTP response processing. Cancellation
  must propagate rather than become an ordinary partial match.
- Discontinuity references need global matched-segment offsets when a trip has
  multiple legs. Stable IDs cannot depend on random `createId` calls.

Task009 stopped after beginning type changes; SQLite publication, immutable assets,
rename compatibility, recovery and failure-injection evidence remain unimplemented.
Continue from `docs/contracts/009-prepared-route-storage.md` and the reviewed
Task008 metadata shape. Do not enable imported-ride navigation based on the new
optional fields alone.

Remaining end-to-end scope is unchanged: GPX review/accept/recovery UI, integration
with the accepted engine, durable production background sessions, bounded offline
map downloads and focused Android evidence. Physical ride/audio/battery checks
remain owner-assisted gates after emulator acceptance.
