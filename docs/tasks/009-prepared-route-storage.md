# Task 009: prepared route storage

Status: core persistence accepted by Sol on 2026-10-14. See the
[core acceptance](../reviews/008-009-sol-core-acceptance.md). Core persistence
lives in `apps/mobile/src/storage`; native and navigation/UI integration remain
separate gates.

`LocalRouteStorage.acceptPreparation` writes an immutable prepared document and
manifest beneath `data/<routeId>/prepared/<versionId>`, reads both back through
the document and metadata validators, then publishes the version and summary in
one SQLite update. The original GPX bytes and original parsed `route.json` remain
untouched. A failed pre-publication write leaves the previous active pointer in
place. Startup and post-publication cleanup remove unreferenced, incomplete
prepared directories older than one hour when directory listing is supported.
The age grace protects a version being written by another live storage
instance. Complete historical versions are retained for the later navigation
session retention policy. Cleanup failures do not undo a committed acceptance.

SQLite adds nullable `active_preparation_id`, monotonic `revision`, and
`storage_identity`, while keeping v1/v2 rows readable. The v1 and v2 migrations
preserve existing names, summaries, provenance, filenames, and asset paths.
Accepted rows use record version 3, whose library name is authoritative. Rename
updates that DB name while returned original and prepared document copies receive
the current name. Imported provenance and original filename remain unchanged.
`SavedLocalRoute.document` is the effective geometry; `originalDocument`,
`preparationMetadata`, and `activeVersionId` expose the preserved source and
prepared state. `getOriginalRoute` supports recovery when prepared files are
corrupt, and `revertPreparation` clears the pointer while restoring the original
geometry summary.

Acceptance requires ready or partial metadata and valid saved maneuvers; failed
and needs-choice results are rejected. The stored `outputCoverage` is checked
against original point counts and distances, output segment references,
per-source mappings, complete ordered source partitions, exact retained geometry
for unmatched intervals, coverage arithmetic, and readiness thresholds. This
prevents partial preparations from truncating the original ride. Source identity tokens include the persisted storage
identity and revision. The SQLite publication uses both as compare-and-swap
conditions, preventing a slower second storage instance from replacing a newer
acceptance or publishing after a revert. Route and version identifiers are
restricted to local safe path components.

Validation on 2026-10-14:

- `npm run test --workspace=@ride-maker/mobile -- src/storage/prepared-route-storage.test.ts src/storage/sqlite-db.test.ts src/storage/storage.test.ts src/storage/task004-storage.test.ts src/storage/sol-review-regressions.test.ts` — 5 files, 48 tests passed. Coverage includes actual in-memory SQLite v1/v2 migration fixtures, SQLite compare-and-swap, two-instance publication race, failure injection at directory creation, both writes, both readbacks and DB publication, restart recovery, post-commit cleanup failure, corrupt-active revert, stale results after revert, tampered metadata rejection, truncated candidate rejection, and persisted partition corruption on load.
- `npm run check --workspace=@ride-maker/mobile` — passed after the concurrent controller test fixes.
- `git diff --check -- apps/mobile/src/storage docs/tasks/009-prepared-route-storage.md` — passed.

The SQLite migration fixture uses Node's built-in `node:sqlite` in-memory
database, plus a focused injected-driver fixture that checks migration SQL and
single-statement publication. The one-hour orphan grace means a newly abandoned
directory can remain until a later startup or acceptance after that interval.
