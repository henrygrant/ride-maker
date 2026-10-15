# Prepared local route publication

Status: Sol implementation contract, 2026-10-14. Not implemented yet. Applies
after the Task008 preparation result types are reviewed. No native build is
needed for the storage implementation itself.

## Assets and commit point

Keep `data/<routeId>/original.gpx` byte-for-byte and `route.json` as the original
parsed geometry. Preparation must never rewrite either asset. A new immutable
version lives at `data/<routeId>/prepared/<versionId>/document.json` with a
`preparation.json` manifest. Generate safe opaque version IDs locally; reject
separators, dot segments and paths supplied by a provider.

The manifest contains its schema version, version ID, source route ID, preparation
assessment and coverage, and the matching document identity. Use the reviewed
Task008 metadata type rather than an unvalidated arbitrary JSON bag. Validate
source/output segment references, maneuver references, coverage and finite
assessment values again when loading disk data. Failed preparation cannot be
accepted. Partial preparation remains partial after saving and restarting.

Write both assets, read them back and validate the complete pair before publishing.
One SQLite UPDATE commits `active_preparation_id`, record version and active
geometry summary/counts/instruction readiness together. Before that UPDATE, any
exception or process death leaves the old pointer usable. After it, cleanup
failure must not roll back the committed version or report that acceptance failed.
Repreparation uses another version, never overwrites an active directory. Explicit
revert to original clears the pointer and restores original summary/counts in one
UPDATE. Neither accept nor revert changes imported provenance or filename.

## Additive schema and compatibility

Add nullable `active_preparation_id` to SQLite and the record interface; introduce
record v3 while continuing to open v1/v2. Keep `snapshot_path` pointing at original
`route.json`; derive active paths from validated local IDs, never loosen existing
private-path checks to accept arbitrary snapshot paths. Older rows need no eager
file migration. Created/shared rides continue to load with their existing saved
instructions and behavior.

For v3, SQLite owns the display name. Original and prepared asset names are
historical metadata: return document copies with the current library name rather
than mutating immutable geometry during rename. Keep strict name consistency and
existing journal recovery for legacy v1/v2. When upgrading a legacy row, finish
its pending rename recovery first. A v3 rename changes only the DB name and must
not invalidate a navigation checkpoint/version ID.

The original snapshot's geometry counts are validated independently. For an
active prepared version, library record counts and distance describe that version
and must match its validated document, rather than the original snapshot. Expose
original document, effective document and preparation metadata distinctly to the
caller; retain compatibility of `SavedLocalRoute.document` as effective geometry.
Offer an explicit original-read/revert path even if the prepared version is
missing/corrupt. Do not silently switch geometry beneath a resumed navigation
session. Surface corruption with a recoverable original-preview action.

## Recovery, concurrency and verification

Serialize accept/revert/rename/delete through the existing storage operation
queue. Accept checks the source identity/version still matches the ride reviewed
by the caller; cancellation, deletion or newer acceptance must not publish an old
async result. Match outside the storage lock. Reject unsafe route IDs before any
filesystem operation, including import/delete paths.

Startup retains the referenced version and removes unreferenced incomplete
preparation directories without following arbitrary paths. Cleanup failure is
nonfatal and retryable. Deletion removes the DB row first and then the entire
private ride directory, as today. Do not remove an active asset while its record
still references it. A navigation session will bind both route ID and immutable
version ID; its lifecycle and asset retention contract belongs to the subsequent
session integration task.

Focused tests inject failure before each file write/readback/DB publish, recreate
storage to simulate interruption, and assert original bytes plus the previous
active version survive. Cover v1/v2 migration, v3 rename/restart, accept/reaccept,
partial metadata, revert, corrupt active assets with original recovery, deletion,
stale acceptance, safe paths and failed cleanup after a successful DB commit.
Use authored expected documents and DB failure injection. Do not mirror the
implementation with a test that merely repeats its path-building algorithm.
