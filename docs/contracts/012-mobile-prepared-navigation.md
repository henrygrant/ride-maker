# Mobile prepared GPX and engine integration

Status: Sol contract, 2026-10-14. Implementation follows acceptance of Tasks007–009.
Henry selected Luna for implementation; Sol owns review and integration. Preserve
the full-screen map and floating controls introduced in Tasks005–006.

## Prepare, review, accept

A selected raw local GPX offers **Prepare directions** as its primary action.
Preparing is an explicit online action; opening/importing a ride never silently
uploads it to a matching service. Explain the online requirement in context.
Keep the map visible and use a floating progress/review dock. Cancel aborts work
and returns to the same original preview. Network/validation errors offer retry
and preserve the saved ride.

Review overlays the original and candidate geometries with distinct line styles
and a compact legend. Show localized warnings and uncovered sections, with tap to
focus relevant geometry. Summarize the actual distance/coverage changes in plain
language. A sparse planned GPX requires an explicit choice to infer cycling paths
through its points; keep that inference visible during review. Failed or
needs-choice results cannot be accepted. Partial results have a clear partial
directions label and explicit acceptance, never a whole-ride readiness badge.

Accept publishes through the reviewed storage API and refreshes the library plus
selected ride from disk. Reopening the app uses the accepted local version without
matching again. Offer original preview and revert through secondary ride actions;
corrupt prepared assets must still allow original recovery. Renaming keeps the
current library name. Import provenance and original filename remain intact.

## Controller and saved identity

Use an injected preparation controller with explicit idle/preparing/choice/review/
saving/error states. Matching reads the preserved original document and captures
its current storage identity token. Abort on selection change, close, replacement
request or unmount; reject delayed successes after cancellation. Acceptance uses
the original token and rechecks the selected route before displaying the result.
Do not allow stale requests or double taps to publish another route's directions.

Extend `DisplayRoute` to carry the validated preparation metadata, original
geometry, active version and source identity from `SavedLocalRoute`. Do not throw
these away in App's local load/import/save conversions. Original preview metrics
come from the original geometry, not active prepared record counts. Keep remote
created/shared rides compatible.

## One production foreground engine

Replace App's `buildNavigationTrack`/`navigationFix` foreground heuristic with the
accepted `@ride-maker/navigation` reducer. The same production path handles local
created, remote shared and prepared imported rides. No test-only navigation engine
or straight-line matcher. Keep existing distance formatting as appropriate, but
do not leave the old progress clamp governing user navigation.

Compile effective geometry with the explicit unavailable segment indices derived
from validated `outputCoverage`. Instructions and repeat are suppressed throughout
uncovered sections; show the engine's unavailable/off-route/poor-GPS state. Start
is based on validated instructions and preparation status/coverage, never solely
`sourceKind !== imported` or the DB's `hasInstructions` boolean. Raw GPXs remain
preview-only. Partial starts require the partial warning to remain accessible.

Location callbacks pass capture timestamp, observation time, validated accuracy,
speed and heading to the engine. Dispatch speech from engine events with stable
cue identities and cancellation when the ride ends/changes. Keep turn, arrival,
off-route, repeat and muted behavior consistent with engine state. The subsequent
durable session task replaces component ownership for background operation; do
not claim locked-screen readiness from this foreground integration alone.

## Focused evidence

Controller tests exercise prepare/cancel/retry/sparse choice/accept/partial/stale
selection/double acceptance with real preparation and storage boundaries where
feasible. Use authored fixtures, not booleans mirroring readiness implementation.
Run affected mobile and package typechecks/tests after interfaces settle.

On the dedicated Mac Android emulator, verify one import → prepare → review →
accept → restart → Ride flow, one cancellation/failure, partial-unavailable
guidance and revert/original recovery. The fixture server may provide realistic
HTTP trace-matching fixtures; record it distinctly from a small synthetic live
adapter check. Preserve consumer rides, owner Metro and physical phone. Avoid
unrelated whole-suite retries; rebuild only when the actual bundle/native changes
require it. Record source/artifact identity and the focused flow's real result.
