# Task012 source integration review

Sol, 2026-10-14. Accepted at the source/controller boundary; Android workflow
acceptance remains pending. This does not establish background operation or a
physical riding result.

The selected imported ride offers explicit online preparation with upload
disclosure, original/candidate map review, partial acceptance, original preview
and revert/recovery. Acceptance uses the storage identity token and locks
selection during atomic publication. Created, shared and prepared imported rides
use the production navigation reducer; unavailable output segments are supplied
to its compiler. Raw imports remain preview-only.

Parent verification passed the mobile typecheck and 18 tests across preparation
controller, provider, created-ride navigation, foreground dispatch and speech queue
suites. Cross-package preparation/storage/reload tests were accepted separately
under Tasks008–009. Review fixed a discarded SEARCH_LIMIT degraded state and
queued speech that could dispatch after pause/end during awaited cancellation.
Regression cases exercise the actual dense-route reducer and a deferred speech
cancellation boundary.

Remaining gates: native picker → preparation → review → accept → restart → Ride,
cancel/service failure, partial guidance, original recovery, visible map review
and consumer isolation. Task010 will replace component-owned location/speech with
the durable coordinator; Task011 will supply shared map configuration and offline
controls. Neither integration is claimed by this source review.
