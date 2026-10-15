# Task007 pure engine acceptance

Sol, 2026-10-14. Accepted as a pure TypeScript engine boundary, with the bounded
runtime behavior below. This does not accept mobile integration, prepared GPX
matching, background delivery or physical riding behavior.

Fresh parent checks: `npm run test --workspace=@ride-maker/navigation` passes
43 tests across two files; `npm run check --workspace=@ride-maker/navigation`
passes. Independent authored review cases cover a complete dense out-and-back,
stationary overlapping start/finish, malformed geometry/indexes, true fractional
grid crossings, closed-loop completion, close turns, fresh-fix resume and an
uncovered intermediate section before a later covered maneuver. Implementation
replays also cover wrong-turn/rejoin, degraded/stale/implausible fixes, reversals,
segment gaps, cue deduplication and JSON state rehydration.

Review found and corrected the GPS-interruption rejection deadlock, stationary
geometry acceptance, string-index coercion, spatial-index truncation and missed
fractional cells, and prompts crossing unavailable sections. Coordinate-based
grid traversal now includes touched cells. Configurable per-fix candidate work
counts cover enumeration and projection, with deterministic stress assertions;
ordinary 100,000-point long-route and interruption recovery cases pass.

The compiler accepts at most 100,000 points and rejects unsupported long edges.
The default candidate-work budget is 20,000. A pathological dense/ambiguous trace
can return `SEARCH_LIMIT`: retain progress and reliable baseline, emit no turn or
arrival, mark positioning unavailable, and allow the next fix to retry. Consumers
must surface that condition instead of displaying reliable guidance or off-route
certainty. Thresholds are initial engineering values, not field-calibrated claims.

The mobile integration must compile validated per-output coverage into unavailable
segment indices, pass observation time for freshness/future-fix checks, and drive
speech from returned events. Durable sessions must bind checkpoints to immutable
geometry identity and validate persisted state before resuming. Those integrations
have separate contracts and acceptance gates.
