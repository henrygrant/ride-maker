# Tasks008–009 core acceptance

Sol, 2026-10-14. Accepted for provider-independent GPX preparation, the Valhalla
adapter's tested HTTP contract, and durable prepared-route persistence. Mobile UI,
native transport, background behavior and physical riding remain separate gates.

Fresh parent checks pass:

- Routing typecheck and all 44 tests across six files.
- Storage plus the independently authored preparation → persistence → reload →
  navigation-compile tests: 50 tests across six files (48 storage, two integration).
- Mobile typecheck at this boundary, before concurrent session work began.
- One additional small synthetic trace through the actual development Valhalla
  adapter passed. This is a connectivity/response-contract check, not an uptime
  promise or personal-GPX upload. Deterministic tests use authored fixtures.

The integration cases prove a failed source segment and a failed middle chunk
retain the exact original uncovered geometry, pass storage's full ordered source
partition validation, survive reload, and compile with unavailable sections marked.
Review caught and fixed interval gaps, overlap ownership and simplified fallback
geometry that would otherwise fail acceptance or truncate the rider's itinerary.

Matching checks all vertices plus interpolation at most 5m apart using indexed
real edges; readiness accounts for the reported 2.5m sampling error budget. Ordered
correspondence detects reversed/changed traversal. Ambiguous snapped seams remain
separate and visibly partial; request, geometry and processing bounds fail
explicitly. Source route identity and filename are preserved.

Persistence publishes immutable document/manifest pairs after readback validation
through one conditional SQLite update with storage identity and revision checks.
Original bytes/snapshot survive. Evidence includes real SQLite v1/v2 migrations,
every pre-publication write/read phase failure, post-commit cleanup failure,
corrupt-active original recovery/revert, stale and ABA tokens, competing instances,
and rejection of truncated/reordered or inconsistent persisted coverage. Incomplete
orphan cleanup uses a documented age grace to avoid deleting another writer's work.

The generic HTTP adapter supports a non-streaming fallback whose byte limit is
checked after buffering. Expo SDK57 installs streaming `expo/fetch` globally by
default, confirmed in the pinned source and [Expo documentation](https://docs.expo.dev/versions/v57.0.0/sdk/expo/).
Native verification must confirm that default path; opting into React Native's
non-streaming fetch changes the memory-bound guarantee. Production matching
deployment/availability is not accepted by this development-service smoke.
