# Ride Maker

Plan bicycle routes on the web and view them in a native mobile app.

## Workspaces

- `apps/web` — Vite web planner
- `apps/mobile` — Expo/React Native route viewer
- `packages/ui` — shared React Strict DOM components and design tokens
- `packages/domain` and `packages/persistence` — shared route format and PocketBase access

The mobile app is a viewer for now: it can list public routes or open any
unlisted route by pasting its Ride Maker link or route ID. It does not edit
routes, use location, or provide navigation. Since routes finished on the web
are currently saved as **unlisted**, the public list may be empty; use a link
to open one.

## Mobile development

MapLibre is a native module, so the mobile app needs an Expo development build;
it will not run in Expo Go. With Android tooling installed, run:

```sh
npm install
npm run android --workspace @ride-maker/mobile
npm run dev --workspace @ride-maker/mobile
```

On macOS with Xcode, use `npm run ios --workspace @ride-maker/mobile` instead.
The viewer reads routes from `https://ridemaker.thg3.net/api`. A custom URL such
as `ridemaker://route/ROUTE_ID` also opens a route. Web links currently need to
be pasted into the app; universal/app links are not configured yet.

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
