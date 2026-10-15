# Task007: prepared-ride boundary and deterministic navigation engine

Status: pure engine accepted by Sol after independent review and a fresh 43-test
pass. Mobile integration and field acceptance remain pending. See
[acceptance evidence](../reviews/007-sol-engine-acceptance.md).
See [initial review](../reviews/007-009-sol-initial-review.md).
Sol defines this contract; Gemini began implementation and Luna completed review corrections;
Sol reviews and integrates. Follows accepted Task006 map home (focused Android UI
pass). User authorized continued work through GPX preparation, navigation
reliability, background readiness and offline maps without frequent check-ins.

## Outcome and order

Build the pure engine foundation needed for trustworthy prepared GPX navigation.
Then implement GPX matching/review/persistence against that boundary, integrate
the engine into the app, and proceed to background sessions and offline maps.
Physical locked-screen/audio/Bluetooth/battery evidence remains an owner-assisted
gate; emulator results must not be described as field acceptance.

The current foreground helper clamps progress forward and projects mostly by
nearest distance. It can pick the wrong leg of a loop or out-and-back. Do not
extend that heuristic piecemeal or introduce a second test-only engine.

## Owned scope

Add `packages/navigation` (pure TypeScript, workspace tooling consistent with
existing packages). Depend on shared domain types; no React/Expo, network, GPS,
storage, timers or speech inside this package. Minimal root workspace/lockfile
changes permitted. Do not change mobile UI, production routing endpoints,
existing persisted RouteDocument schema, auth or server deployment in this task.
Keep existing mobile navigation behavior unchanged until the reviewed integration
step. Use existing domain route geometry/maneuver indexes as the input boundary.

## Production interface

The `@ride-maker/navigation` package exports the following concrete types, interfaces, and functions:

### 1. `prepareNavigationRide(document: RouteDocument, options?: PrepareNavigationRideOptions): PrepareNavigationRideResult`

`PrepareNavigationRideOptions.guidanceUnavailableSegmentIndices` is an optional
array of unique input-document segment indices. `reduceNavigation` also validates its
persisted ride/state/input/config boundary and returns `NavigationResult.error`
with a stable error code for malformed values or `SEARCH_LIMIT` when deterministic
per-fix candidate work is exhausted. That result preserves progress and cues,
sets quality to `unknown`, and leaves the reliable-fix baseline unchanged so a
later input can retry safely. `createNavigationState` takes a
prepared ride and optional config and returns the initial serializable state.
- **Validation**:
  - Schema version check (`schemaVersion === 1`).
  - Point count & non-empty geometry checks (`segments.length > 0`, points per segment >= 2).
  - Point coordinate validity (`isValidCoordinate`: finite numbers, lat [-90, 90], lon [-180, 180]).
  - Single-edge geographic span bounded to <= 1.0 degree (`UNSUPPORTED_GEOMETRY`), protecting spatial compilation from unbounded resource allocation on world/antimeridian lines.
  - Zero-distance track rejection (`DEGENERATE_GEOMETRY`).
  - Structured rejection of routes without maneuvers (`code: "NO_MANEUVERS"`).
  - Maneuver reference validation (integer segmentIndex and shapeIndex, stable identity, route order, instruction non-empty).
  - Maneuver coordinate alignment tolerance: verifies maneuver coordinate is within 15 meters of referenced shape point (`COORDINATE_MISMATCH`).
- **Compilation**:
  - Produces immutable `PreparedNavigationRide` (version 1) with cumulative ride meters, segment meters, and global edge indexes.
  - Identifies physical segment gaps (> 10m) between consecutive segments and stores `gapToNextMeters`.
  - Builds a coordinate-based Amanatides-Woo supercover 2D grid index that includes every crossed cell, including corner-touch and grid-boundary cases. Compile input is capped at 100,000 points and edge spans at one degree; the 0.05 degree grid bounds per-edge traversal to a few dozen cells for accepted edges.
  - Optional `prepareNavigationRide(document, { guidanceUnavailableSegmentIndices })` retains geometry/progress for listed segments and suppresses turn/repeat cues there, as well as cues that would cross an unavailable segment to reach a later covered turn. The reducer emits `guidance_unavailable` when entering one.

### 2. `createNavigationState(ride: PreparedNavigationRide, config?: NavigationConfig): NavigationState`
- Returns pure JSON-serializable state:
  - `lifecycle`: `"active" | "paused" | "ended"`, plus serializable lifecycle timestamp and fresh-fix-after-resume threshold
  - `quality`: `"unknown" | "good" | "degraded"`
  - `progressMeters`: cumulative progress along ride itinerary
  - `remainingMeters`: remaining distance to destination
  - `lateralDistanceMeters`: perpendicular displacement from route
  - `currentSegmentIndex`, `currentEdgeIndex`, `nextManeuverIndex`, `distanceToNextManeuverMeters`
  - `lastAcceptedFix`: reliable baseline record (`timestamp`, `latitude`, `longitude`, `accuracyMeters`, optional `speed`, `heading`)
  - `consecutiveOffRouteFixes`, `consecutiveRejoinFixes`, `isOffRoute`
  - `announcedCueIds`: list of deduplicated cue keys (survives JSON rehydration)
  - `segmentGapState`: non-null when navigating near a segment discontinuity
  - `arrived`: boolean terminal arrival state

### 3. `reduceNavigation(ride: PreparedNavigationRide, previousState: NavigationState, input: NavigationInput, config?: NavigationConfig): NavigationResult`
- **Pure Reducer**: `(ride, state, input) => { state, events }`.
- **Inputs (`NavigationInput`)**:
  - `location_fix`: `{ timestamp, latitude, longitude, accuracyMeters, speedMetersPerSecond?, headingDegrees?, receivedAt? }`
  - `pause`: `{ timestamp }`
  - `resume`: `{ timestamp }`
  - `end`: `{ timestamp }` (terminal state; subsequent inputs return previous state without mutation)
  - `repeat_instruction`: `{ timestamp }`
- **Events (`NavigationEvent`)**:
  - `upcoming_maneuver`: emitted at speed-adapted lookahead distance
  - `immediate_maneuver`: emitted near turn execution threshold
  - `off_route`: emitted after `offRouteConsecutiveFixes` (default 3) consecutive fixes exceeding `offRouteThresholdMeters` (default 35m)
  - `rejoined`: emitted after `rejoinConsecutiveFixes` (default 2) consecutive fixes within `rejoinThresholdMeters` (default 20m)
  - `gps_degraded`: emitted when fix is inaccurate, stale (receivedAt - timestamp > 30s), or an implausible jump (> 40 m/s) occurs
  - `gps_recovered`: emitted when GPS quality recovers to good
  - `segment_gap`: emitted when approaching a physical discontinuity between segments
  - `guidance_unavailable`: emitted on first accepted fix in a segment whose provider instructions are unavailable
  - `instruction_repeated`: emitted on user request, returning active maneuver or suppression reason (`"off_route" | "segment_gap" | "degraded_gps" | "no_fix" | "paused" | "unavailable"`)
  - `arrival`: emitted when reaching destination on final segment within tolerance
  - `lifecycle_changed`: tracks active/paused/ended transitions

### Configurable Defaults (`NavigationConfig`)
- `maxFixStalenessMs`: 30,000 ms (staleness evaluated against `receivedAt` when provided; elapsed time between fixes > 30s treated as interruption recovery)
- `maxAcceptableAccuracyMeters`: 30 m (inaccurate fixes degrade quality but do NOT replace reliable baseline)
- `maxPlausibleSpeedMetersPerSecond`: 40 m/s (~144 km/h)
- `maxProjectionJumpForwardMeters`: 300 m
- `maxProjectionJumpBackwardMeters`: 80 m (allows genuine reversal without forward clamping)
- `maxLocalSearchDistanceForwardMeters`: 250 m (route-distance bounded window)
- `maxLocalSearchDistanceBackwardMeters`: 80 m
- `maxCandidateWorkPerFix`: 20,000 deterministic work units (enumerated grid cells/edge references and projected candidates); exhaustion yields `SEARCH_LIMIT`, never a partial accepted match
- `maxFutureFixSkewMs`: 5,000 ms (capture timestamps farther ahead than `receivedAt` are rejected without changing the reliable baseline)
- `candidateSearchRadiusMeters`: 120 m (spatial grid radius)
- `headingToleranceDegrees`: 60 deg (directional check; opposing headings > 90 deg heavily penalized unless reversing)
- `offRouteThresholdMeters`: 35 m
- `offRouteConsecutiveFixes`: 3 fixes
- `rejoinThresholdMeters`: 20 m
- `rejoinConsecutiveFixes`: 2 fixes
- `upcomingCueDistanceMeters`: 150 m
- `upcomingCueLookaheadSeconds`: 10 s
- `immediateCueDistanceMeters`: 35 m
- `immediateCueLookaheadSeconds`: 3 s
- `arrivalToleranceMeters`: 30 m

## Algorithm Tradeoffs and Potential Limits

1. **Route-Distance Bounded Local Window vs. Index Offset**:
   - Fixed index windows (e.g. currentEdge - 5 .. + 20) fail on dense GPX recordings where 30 points may cover only 10 meters. We use route-distance bounding (`progressMeters - 80m .. progressMeters + 250m`).
   - *Tradeoff*: Local search requires summing edge lengths along the route; since edges store precalculated cumulative start/end distances, bounds checking is O(k) where k is the number of local edges.
2. **Reversals vs. Opposing Branch Disambiguation**:
   - When a rider makes a U-turn and moves backward along a road (`deltaProgress < -5m`), their heading naturally opposes the forward edge bearing. We calculate expected heading for backward movement as `(bearing + 180) % 360`, allowing legitimate backward progress without forward-clamping while continuing to strongly penalize oncoming branches during forward motion.
   - *Limit*: If a rider reverses for more than `maxProjectionJumpBackwardMeters` (80m), the reducer begins treating them as off-route rather than rolling back cumulative ride distance indefinitely.
3. **Interruption Recovery vs. Implausible Jump**:
   - If a GPS fix arrives after > 30s gap (tunnel, pause/resume, lockscreen sleep), elapsed displacement speed cannot be evaluated against 1-second intervals. We classify fixes with `elapsedSeconds > 30s` as interruption recoveries: speed-based jump penalties are cleared, and the spatial index re-anchors the rider onto the closest physical edge.
4. **Immediate Guidance Suppression vs. Debounce Warning**:
   - Debounce hysteresis (3 fixes) prevents noisy off-route alerts from false GPS spikes. However, allowing progress to advance or turn cues to fire during the first 1-2 fixes off-route would give misleading instructions. The reducer immediately suppresses progress updates and cue announcements on poor match (`lateralDistance > 35m`), while debounce controls only the user-facing `off_route` event.
5. **Spatial Index Memory & Line Traversal**:
   - Naive bounding-box allocation can allocate huge numbers of cells for diagonals, while integer Bresenham traversal can omit valid edges with fractional endpoints. The grid uses coordinate-based supercover traversal, a 0.05-degree cell, a 100,000-point compile limit, and the existing one-degree maximum edge span. These bounds make compile allocation finite and include endpoint cells for all accepted edges.
6. **Per-fix Work Bound**:
   - Both route-distance local enumeration and fallback grid-cell/reference enumeration are charged against `maxCandidateWorkPerFix`, as are projections. Exhaustion returns `SEARCH_LIMIT` with the work count and retains the prior progress/cue state. The default budget is 20,000 units; pathological superdense traces may remain temporarily unavailable while ordinary 100,000-point rides and long-interruption recovery fit within the budget.
7. **Capture Clock Skew**:
   - A capture timestamp may be up to 5 seconds later than `receivedAt` to allow small device-clock skew. Larger future timestamps are rejected before they can replace the reliable fix baseline.

## Verification Status

Sol's fresh focused checks pass: `npm run check --workspace=@ride-maker/navigation`
and `npm run test --workspace=@ride-maker/navigation` (43/43 tests). Scoped diff
checks pass. See the linked acceptance review for scope, failures corrected and
remaining integration gates; earlier workspace and foreground-helper checks are
historical and do not establish the current app's acceptance.
