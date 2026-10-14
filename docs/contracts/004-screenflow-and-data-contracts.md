# Contract: Mobile Ride Creation, Primary Surfaces & Data Contracts

> [!NOTE]
> **Contract Lifecycle & Historical Baseline**:
> This document records the **accepted Android emulator baseline** for **Task 004** (split-view form creation, accepted 2026-10-14; see the [Task 004 Sol review](../reviews/004-sol-mobile-creation-review.md)).
>
> The active creation UX has been redesigned under **Task 005** to **Concept A Floating Dock** (immersive full-bleed map, floating thumb-zone dock, staged search, 8-stop reorderable via stops, Locate route preservation, and blank-name recovery). See [`docs/tasks/005-mobile-creation-redesign.md`](../tasks/005-mobile-creation-redesign.md) for the active Task 005 contract, which was **accepted on the Android emulator on 2026-10-14** after Sol review.

Status: Historical accepted Android emulator implementation (2026-10-14); see the task004 Sol review. Active Task 005 redesign is accepted on the Android emulator; see its task and review record.
Implements UX and technical requirements defined in `docs/tasks/004-mobile-ride-creation.md`.

---

## 1. Primary Surfaces and Screen Flow

The mobile app organizes user interaction into three primary surfaces and focused modes:
1. **My rides (`library`)**: Priority listing of local saved rides and secondary actions (Create, Import, Shared-link).
2. **Create a ride (`create`)**: Explicit point selection (Start, Stops, Finish), map placement mode, cancellable search, routed preview, and local saving.
3. **Ride detail (`detail`)**: Route geometry inspection, maneuvers readiness check, rename, delete confirmation, and entry to navigation.
4. **Active navigation (`navigate`)**: Foreground turn-by-turn guidance with confirmation dialog on exit.

```
                    +------------------------+
                    |    My rides (library)  |
                    +------------------------+
                     /          |           \
         Create ride/           |Import GPX  \Open shared
                   v            v             v
       +---------------+   +--------------------+
       |  Create ride  |   |    Ride detail     | <---+
       +---------------+   +--------------------+     |
               |                     |                |
          Preview & Save             |Ride (if valid) |Back (confirmed)
               |                     v                |
               +-------------> +--------------------+ |
                               | Active navigation  |-+
                               +--------------------+
```

### 1.1 My rides (`library`)
- **Title & Priority**: Titled "My rides". Local rides are given first priority in the UI with a full-height scrolling list.
- **Actions**:
  - Primary button: `+ Create ride` (`button-create-ride`).
  - Secondary button: `Import GPX file` (`button-import-gpx`).
  - Secondary section: Collapsed by default behind `button-toggle-secondary-links`. When expanded, exposes `input-route-id`, `button-view-route`, and public routes (preserving task001/task003 test selectors and backwards compatibility).
- **List UX**:
  - `FlatList` with `scrollEnabled={true}`, safe-area insets, keyboard dismissal on drag/interaction.
  - Handles 12+ rides with long names cleanly without text clipping.
  - Truthful status per item: `" · Directions available"` only when `item.hasInstructions === true`, otherwise `" · GPX preview"`.
  - Empty state explains both "Create a ride" and "Import GPX file".

### 1.2 Create a ride (`create`)
- **Point Configuration**:
  - Start point: Labeled "Start Location". Supports:
    - Explicit `Use my location` (`button-use-my-location-start`): requests foreground permission only on tap; if denied, sets an informative message, never invents mock coordinates, and leaves point unset.
    - `Choose on map` (`button-map-pick-start`): enters explicit map placement mode.
    - Place search: debounced, cancellable with `AbortController`, displays selectable result list with 44dp touch targets.
  - Intermediate stops: Up to 8 optional via points (`button-add-stop`).
    - Labeled controls to reorder: `Move up` (`button-stop-up-${i}`), `Move down` (`button-stop-down-${i}`).
    - Remove button (`button-stop-remove-${i}`).
  - Finish point: Labeled "Finish Location". Supports search, `Choose on map` (`button-map-pick-finish`), or returning to start (Loop route).
  - Loop constraint: If Start == Finish, requires at least one distinct intermediate stop.
- **Map Placement Mode**:
  - Explicit mode entered by tapping "Choose on map" for a specific point slot.
  - Ordinary map taps do not silently mutate points outside this mode.
  - MapLibre `onPress` extracts coordinates from typed `event.nativeEvent.lngLat` (or geometry coordinates).
  - Shows candidate pin with clear confirmation ("Set location") and "Cancel".
  - Identified confirmed point markers on map: Start (green S with white border), Finish (red F, hidden if loop), numbered blue stops and an amber candidate marker. Native Marker views keep labels visible on Android.
  - Reverse geocoding provides a human-readable label if available; otherwise uses Start Location on Map, Finish Location on Map or Via Stop on Map without blocking selection.
- **Preview & Invalidation**:
  - Any edit to any point (move, delete, change coordinate, re-pick, clear text) immediately invalidates previous preview and candidate coordinates, hiding `Save ride` until re-previewed.
  - Explicit `Preview Route` (`button-preview-route`) triggers bicycle routing with `@ride-maker/routing`.
  - Preview displays: MultiLineString routed polyline on map (preserving separate geometry segments without bridging or flattening), confirmed markers, calculated distance in km (primary emphasis), turn maneuvers count, editable name (`input-created-ride-name`). Estimated-time UI is omitted.
  - Stale routing responses from cancelled or superseded requests are discarded via `AbortController` and generation counters.
- **Draft & Back Protection**:
  - Pressing Back with a non-empty draft shows a confirmation dialog: "Keep Draft", "Keep Editing", or "Discard Draft".
  - Draft is held in memory for the session; discard resets creation state.
  - Save errors are caught and surfaced with an informative message while keeping user draft intact on the create screen.
  - `Save ride` (`button-save-created-ride`) saves atomically to local storage and transitions directly to `detail` view without starting GPS tracking.

### 1.3 Ride detail (`detail`)
- **View Elements**:
  - Displays ride title (`text-route-title`), distance (`text-route-distance`), and Map preview (`view-map`).
  - Status notice:
    - If route has validated instructions (`validateRouteInstructions(doc).ready === true`): enables `Ride` button (`button-navigation-toggle`).
    - If imported GPX or route without valid instructions: displays truthful guidance notice and hides navigation entry.
- **Management Operations**:
  - Rename (`button-rename-ride`): Prompt/input modal to change ride name. Atomically updates SQLite metadata AND `route.json` snapshot via interruption-safe `.tmp`/`.bak` protocol. Never modifies original or derived GPX bytes.
  - Delete (`button-delete-ride`): Explicit confirmation dialog displaying the exact ride name (`Delete "${ride.name}"?`). Confirm deletes DB record first and filesystem directory `data/${id}` safely.

### 1.4 Active navigation (`navigate`)
- Entered via `Ride` (`button-navigation-toggle`).
- Displays prominent next-turn instruction (`view-guidance`), distance countdown, and following camera map (`easeTo`).
- Emits `[E2E_NAV_STAGE]` logs during test mode.
- Thumb-accessible controls:
  - `Mute` / `Unmute` toggle (`button-voice-toggle`).
  - `Stop navigation` (`button-navigation-toggle`).
- Exit Confirmation:
  - Pressing `Stop navigation` or hardware Back presents a mandatory exit confirmation dialog:
    "End this ride? Are you sure you want to end navigation?"
  - Cancel (`button-end-ride-cancel`) continues the active ride without interrupting GPS or speech.
  - Confirm (`button-end-ride-confirm`) tears down GPS subscription, stops Speech audio, and returns to `detail`.

---

## 2. Data and Persistence Contracts

### 2.1 Route Document Snapshot (`route.json`)
The canonical route is stored as a domain `RouteDocument` (Schema version 1, exactly matching `@ride-maker/domain`):
```typescript
interface RouteDocument {
  schemaVersion: 1;
  id: string; // local createId result or shared route ID
  name: string;
  description?: string;
  source: RouteSource; // { kind: "new" } for created, { kind: "gpx", filename?: string } for imported
  segments: RouteSegment[];
  controlPoints: ControlPoint[]; // Start, stops, finish
  waypoints: RouteWaypoint[];
  maneuvers: Maneuver[]; // Stored Valhalla maneuvers
  summary?: RouteSummary; // { distanceMeters, durationSeconds }
  routing?: RouteRoutingConfig; // { profile: "road", engine: "valhalla" }
}
```
*Note: RouteDocument does NOT contain `createdAt`. Creation timestamps are managed exclusively at the local persistence layer in SQLite.*

### 2.2 Provenance & Storage Record
`LocalRouteRecord` explicitly records provenance and instructions readiness:
```typescript
export type RouteProvenance = "imported" | "created";

export type LocalRouteRecord = {
  id: string;
  version: number; // 1 (task003 legacy) or 2 (task004)
  name: string;
  distanceMeters: number;
  pointCount: number;
  segmentCount: number;
  createdAt: string; // ISO 8601 string
  originalFilename?: string | undefined; // Present for imported GPX, undefined for created
  originalGpxPath: string; // original.gpx (raw import bytes OR derived GPX for created)
  snapshotPath: string; // route.json (canonical RouteDocument snapshot)
  sourceKind?: RouteProvenance; // legacy absence normalizes to "imported"
  hasInstructions?: boolean; // true if validated maneuvers exist
};
```

### 2.3 Additive SQLite Schema Migration
SQLite table `local_routes`:
```sql
CREATE TABLE IF NOT EXISTS local_routes (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  distance_meters REAL NOT NULL,
  point_count INTEGER NOT NULL,
  segment_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  original_filename TEXT,
  original_gpx_path TEXT NOT NULL,
  snapshot_path TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'imported',
  has_instructions INTEGER NOT NULL DEFAULT 0
);
```

**Migration Policy**:
- For existing task003 databases lacking `source_kind` or `has_instructions`, additive migrations run:
  `ALTER TABLE local_routes ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'imported';`
  `ALTER TABLE local_routes ADD COLUMN has_instructions INTEGER NOT NULL DEFAULT 0;`
- Any existing row is backward-compatible.
- Records with `version = 1` or `version = 2` are both recognized as valid by `LocalRouteStorage.getRoute`.

### 2.4 Direct File Commit and SQLite Commit Protocol
Route creation and import adhere to durable ordering:
1. Allocate target directory `data/${id}`.
2. Write `original.gpx` (raw uploaded bytes or serialized derived GPX) and verify with `getInfoAsync`.
3. Write `route.json` (canonical document snapshot) and verify with `getInfoAsync`.
4. Commit SQLite database row (`insertRoute`).
5. Rollback on failure: If disk writing fails before DB commit, target directory is removed. If process dies after files written but before DB commit, `cleanDataOrphans()` cleans unreferenced directories on next `init()`.

### 2.5 Interruption-Safe Rename Journal
Renaming a route updates both the live document snapshot `route.json` and SQLite metadata without modifying `original.gpx`:
1. Check for existing `route.json.bak`. If present, reject operation to prevent overwriting an unresolved journal.
2. Write updated document snapshot to `route.json.tmp`.
3. Backup current live snapshot to `route.json.bak`.
4. Write updated snapshot to `route.json` and delete `route.json.tmp`.
5. Update SQLite record `updateRouteName(id, name)`.
6. Delete `route.json.bak`.
7. Recovery on startup (`recoverInterruptedOperations()`):
   - If `liveParsed.name === record.name`: SQLite commit already succeeded; delete `route.json.bak`.
   - If `liveParsed.name !== record.name` or live file is corrupt: restore live `route.json` from `route.json.bak`, then delete `route.json.bak`.
   - Recovery errors are not swallowed; `init()` fails fast rather than silently ignoring a damaged journal.

### 2.6 Instruction Validation & Load Integrity
- `validateRouteInstructions(doc)` enforces:
  - Maneuvers array must be non-empty and every element must reference a valid segment index and shape index.
  - Maneuver coordinates must be finite and match indexed geometry coordinates within `< 1e-6` degrees (~0.1m precision).
  - Instruction strings must be non-empty.
- `getRoute(id)` enforces:
  - Loaded record metadata name must match document name.
  - Loaded record provenance must match document source kind (`created` <-> `source.kind === "new"`, `imported` <-> `source.kind === "gpx"`).
  - Throws `SavedRouteCorruptError` on discrepancy.
