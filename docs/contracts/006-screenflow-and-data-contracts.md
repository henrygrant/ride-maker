# Screenflow and Data Contracts (Task 006)

## Screenflow State Machine

The top-level UI architecture centers on **One Map, Three Surfaces**:

```
                   ┌───────────────────────────────┐
                   │           MAP HOME            │
                   │  - Persistent MapLibre Map    │
                   │  - Brand Pill ("Ride Maker")  │
                   │  - "My rides" Pill (Count)    │
                   │  - Locate Button (Camera)     │
                   │  - Welcome Dock ("Where to?") │
                   └────────┬──────────────▲───────┘
           Tap "My rides"   │              │ Back / Deselect
                            ▼              │
                   ┌───────────────────────┴───────┐
                   │        MY RIDES DRAWER        │
                   │  - Sheet over SAME Map        │
                   │  - Header + Close Button      │
                   │  - Scrollable Local Rides     │
                   │  - Fixed Footer (Create/Imp)  │
                   │  - Secondary (Links/Diag/Seed)│
                   └────────┬──────────────▲───────┘
             Select Route   │              │ Tap "My rides"
                            ▼              │
                   ┌───────────────────────┴───────┐
                   │      SELECTED RIDE DOCK       │
                   │  - Same Map with Polyline     │
                   │  - Camera fit to bounds       │
                   │  - Title, Distance, Readiness │
                   │  - 3-Dots Options (Rename/Del)│
                   │  - Secondary: "My rides"      │
                   │  - Primary: "Ride" (if ready) │
                   └────────┬──────────────▲───────┘
             Tap "Ride"    │              │ End Navigation
                           ▼              │
                   ┌───────────────────────┴───────┐
                   │    ACTIVE NAVIGATION SCREEN   │
                   │  - Fullscreen Navigation UI   │
                   │  - Real-time Cues & Voice     │
                   └───────────────────────────────┘

    Global Mode Transitions:
    - Tap "+ Create ride" (from Home Dock or Drawer Footer) -> CREATE RIDE SCREEN (Task 005)
      - On Save -> transitions to SELECTED RIDE DOCK
      - On Back/Discard -> transitions to MAP HOME
    - Tap "Diagnostics" (from Drawer secondary, dev/test only) -> DIAGNOSTICS VIEW
      - On Close -> returns to DRAWER
```

## Back Hierarchy Contract

When hardware back or the primary back control is pressed:
1. **Modal Dialogs (Atomic writes in-flight)**: While an atomic write is pending, hardware back is blocked (`busyRef.current`). When idle, dismisses the active modal dialog.
2. **Options Popover Menu**: If Selected Ride 3-dots popover menu is visible, dismisses menu first without clearing selected route.
3. **My Rides Drawer**: If My Rides drawer is open, dismisses drawer and restores prior context (either Map Home or previously Selected Ride).
4. **Selected Ride Dock**: If Selected Ride Dock is active, clears selected route and returns to Map Home (`setRoute(null)`).
5. **Create Ride Screen**: Follows Task 005 draft keep / discard dialog before exiting to Map Home.

## Data Contracts

### 1. Selected Route Geometry Display
- Geometry source: `routeGeometry(route.document)`, memoized keyed on `route?.document`.
- Camera `fitBounds` trigger: strictly keyed on route geometry changes (`${route.id}:${segments.map(s => s.points.length).join(",")}`), preventing refits on UI toggles, rename modal open/close, drawer interactions, or user pan.
- Camera bottom padding & attribution: dynamically measured from actual dock / drawer height + safe area insets.
- Segment preservation: MultiLineString array coordinates `[[[lng, lat], ...], [[lng, lat], ...]]` rendered directly to `GeoJSONSource` without joining separate segments with straight lines.
- Casing layer: color `#ffffff`, width 8.
- Line layer: color `#1e8068`, width 5.
- Start pin: green `#1e8068` circle at start coordinate `document.segments[0].points[0]`.
- Finish pin: coral `#d84b35` circle at terminal coordinate `document.segments[last].points[last]`.

### 2. Readiness Validation Contract
- Evaluated via `validateRouteInstructions(route.document)`.
- If `ready === true` and not raw GPX:
  - Readiness chip displays: `Directions ready` (`#e8f3ed` background, `#1e8068` text).
  - Primary action: "Ride" (`button-navigation-toggle`) is active and prominent coral (`#d84b35`).
- If `ready === false` or raw GPX:
  - Readiness chip displays: `Preview only` (`#f1f2e9` background, `#5a6860` text).
  - Guidance notice banner: `testID="text-guidance-notice"` displays:
    `Turn-by-turn guidance is not available for raw GPX imports.` (or `Turn-by-turn directions are not ready for this route.`).
  - Primary "Ride" button is omitted or disabled (no navigation started).

### 3. Options Menu & Storage Mutations
- `button-ride-options`: 3-dots circular button in Selected Ride Dock.
- Options:
  - "Rename ride" (`button-rename-ride`) -> opens atomic rename dialog with `input-rename-ride-name`.
  - "Delete ride" (`button-delete-ride`) -> opens deletion confirmation dialog displaying exact ride name in `text-delete-confirm-message`.
- Atomic mutations:
  - Ref busy guard (`busyRef.current`) prevents concurrent or double-submit executions.
  - Dialog inputs and cancel/confirm buttons are disabled while operation is pending.
  - Errors are rendered directly inside the dialog (`testID="text-route-error"`), with draft values preserved for easy retry.
  - Target route ID refs ensure switching routes never renames or deletes the wrong ride.
  - Rename invokes `storage.renameRoute(route.id, newName)`. On success, updates selected route and refreshes library.
  - Delete invokes `storage.deleteRoute(route.id)`. On success, clears selected route (`setRoute(null)`), returns to Map Home, and refreshes library.

## TestID & Accessibility Specification

| Surface | Element | testID | accessibilityRole / Label |
|---|---|---|---|
| Map Home | Brand pill | `text-brand` | "Ride Maker" |
| Map Home / Detail | Test badge | `badge-test-mode` | "TEST MODE" |
| Map Home / Detail | My rides pill | `home-open-myrides` | button / "My rides" |
| Map Home | My rides count | `text-my-rides-count` | Route count |
| Map Home | Locate button | `button-locate-me` | button / "Locate me" |
| Map Home | Locate Feedback | `banner-locate-feedback` | alert / "Dismiss location notice" |
| Map Home / Drawer | Create ride | `button-create-ride` | button / "Create ride" |
| Map Home / Drawer | Import GPX | `button-import-gpx` | button / "Import GPX file" |
| Drawer | Close button | `button-close-my-rides`| button / "Close My rides" |
| Drawer | Route Row | `button-open-local-route-${id}` | button / "Open ${name}" |
| Drawer | Route Name | `text-route-name-${id}` | - |
| Drawer | Route Distance | `text-route-distance-${id}` | - |
| Drawer | Secondary toggle | `button-toggle-secondary-links` | button / "Toggle shared route input" |
| Drawer | Route ID Input | `input-route-id` | "Route link or ID" |
| Drawer | View Route | `button-view-route` | button / "View route" |
| Drawer (Test) | Seed library | `button-test-seed-library` | button / "Seed synthetic library" |
| Drawer (Test/Dev)| Diagnostics | `button-diagnostics-toggle` | button / "Open diagnostics" |
| Detail | Back button | `button-back` | button / "Back to map home" |
| Detail | Route title | `text-route-title` | - |
| Detail | Route distance | `text-route-distance`| - |
| Detail | Options button | `button-ride-options` | button / "Ride options" |
| Detail | Guidance notice | `text-guidance-notice` | - |
| Detail | My rides action | `button-open-my-rides` | button / "My rides" |
| Detail | Ride action | `button-navigation-toggle` | button / "Ride" |
| Detail Menu | Rename ride | `button-rename-ride` | button / "Rename ride" |
| Detail Menu | Delete ride | `button-delete-ride` | button / "Delete ride" |
| Rename Dialog | Name input | `input-rename-ride-name` | "Ride name" |
| Rename Dialog | Cancel | `button-rename-cancel` | button / "Cancel" |
| Rename Dialog | Confirm | `button-rename-confirm` | button / "Save name" |
| Delete Dialog | Message | `text-delete-confirm-message` | - |
| Delete Dialog | Cancel | `button-delete-cancel` | button / "Cancel" |
| Delete Dialog | Confirm | `button-delete-confirm` | button / "Delete ride" |
