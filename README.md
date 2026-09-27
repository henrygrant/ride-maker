# Ride Maker

Plan bicycle routes on the web and ride them with a native mobile app.

## Workspaces

- `apps/web` — Vite web planner
- `packages/ui` — shared React Strict DOM components and design tokens

The mobile app will be added as a separate Expo workspace when the shared web
foundation is established.

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
SSH tunnel. Runtime data lives at
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
