# Ride Maker

Phone-first cycling navigation, with an optional web route planner. The current
mobile app creates and stores rides locally, imports GPX previews, and provides
foreground guidance for routes with saved directions.

## Workspaces

- `apps/web` — Vite web planner
- `apps/mobile` — Expo/React Native ride library, creation and navigation
- `packages/ui` — shared React Strict DOM components and design tokens
- `packages/domain` and `packages/persistence` — shared route format and PocketBase access

The phone opens **Map home**, with a floating **My rides** drawer, **Create ride**
as the primary action and **Import GPX** as a secondary option. Creation features an immersive full-screen
MapLibre map with a Floating Dock (Concept A), supporting direct route previews,
debounced geocoding search with error recovery, center-pin map placement, up to 8
reorderable/removable stops with multi-step undo, loop toggle, and blank-name save
recovery. Rename and confirmed deletion live in ride detail. No account is required
for local rides. Shared Ride Maker links and public routes remain available in a
collapsed section; web-created routes are unlisted by default, so the public list
can be empty.

For created or shared documents with valid saved maneuvers, **Ride** follows the
route with foreground GPS and spoken turns. Mute and Stop navigation remain on
the active ride screen; Back/Stop asks for confirmation. Raw GPX imports remain
previews until turn preparation is implemented. Saved route data and instructions
reopen without network; place search, routing and map tiles require network.
Off-route warnings do not reroute automatically. Locked-screen GPS/audio, offline
map packs and real riding conditions still need separate acceptance.

## Mobile development

MapLibre is a native module, so the mobile app needs an Expo development build;
it will not run in Expo Go. With Android tooling installed, run:

```sh
npm install
npm run android --workspace @ride-maker/mobile
npm run dev --workspace @ride-maker/mobile
```

On macOS with Xcode, use `npm run ios --workspace @ride-maker/mobile` instead.
Shared-route access reads routes from `https://ridemaker.thg3.net/api`. A custom URL such
as `ridemaker://route/ROUTE_ID` also opens a route. Web links currently need to
be pasted into the app; universal/app links are not configured yet.

The [mobile implementation plan](docs/mobile-plan.md) describes offline cycling
navigation, shared React Strict DOM UI, validation milestones, and Sol/Gemini
task handoffs. The
[mobile testing strategy](docs/mobile-testing.md) defines emulator/agent access,
Maestro flows, ride replay, standalone checks, and physical acceptance gates.
The [background navigation spike](docs/tasks/001-background-spike.md) awaits field
checks. [Task 004](docs/tasks/004-mobile-ride-creation.md) and its
[review record](docs/reviews/004-sol-mobile-creation-review.md) track the accepted historical
mobile creation baseline. [Task 005](docs/tasks/005-mobile-creation-redesign.md) defines the
accepted Concept A Floating Dock redesign. [Task 006](docs/tasks/006-map-home-and-library-sheet.md)
defines the user-approved "One Map, Three Surfaces" architecture (Map Home, My Rides Drawer,
and Selected Ride Dock).

Per user agreement, testing follows a selective testing policy: prioritize targeted
smoke and focused journey validation to catch genuine product and UI issues while halting
repeated full-suite or stale-state infrastructure loops. Historical 004/005 full-suite passes
remain valid baselines for their respective architectures, but do not imply or require
immediate 006 full regression runs on focused handoffs. Completed concrete actions are
reported directly without future completion promises.

## Commands

```sh
npm install
npm run dev
npm run check
npm run build
```

## Nauvis deployment

`deploy/compose.yaml` builds the static web app and PocketBase. The web server
serves only the app and the PocketBase endpoints it needs; the PocketBase admin
UI is not exposed through it. PocketBase's host port is loopback-only for an
SSH tunnel. Production disables automatic migration generation; committed
migrations still apply, while Dashboard settings remain in the database.
Runtime data lives at
`/home/henry/docker-data/ride-maker/pocketbase` and is covered by Nauvis's
server-state backup.

From `~/projects/ride-maker` on Nauvis, after creating the runtime data
directory owned by UID 1000:

```sh
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
```

The containers joining the `proxy` network does not publish the hostname.
Only add `ridemaker.thg3.net` to Nauvis's Caddyfile after the security review.
For admin setup, tunnel the loopback port with
`ssh -L 8091:127.0.0.1:8091 nauvis` and open
`http://127.0.0.1:8091/_/` locally. Do not expose that port publicly.
