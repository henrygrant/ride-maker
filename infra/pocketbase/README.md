# PocketBase development backend

The root Compose file builds PocketBase from the pinned version in
`compose.yaml`, applies the committed migrations in `pb_migrations`, and stores
local state under `.data/pocketbase`.

Start it from the repository root:

```sh
npm run backend:up
```

PocketBase endpoints:

- API: http://127.0.0.1:8090/api/
- Admin UI: http://127.0.0.1:8090/_/
- Health check: http://127.0.0.1:8090/api/health

On first use, open the Admin UI and follow the installer flow to create a local
superuser. Never commit `.data` or superuser credentials.

Stop the service with `npm run backend:down`. Local database files remain in
`.data/pocketbase` until explicitly removed.

## Sign-in

The web app accepts Google or Apple sign-in only. Finishing a route requires a
signed-in `users` account; viewing an unlisted link does not. Old
unlisted routes remain viewable even though they have no owner.

To enable Google or Apple, open the PocketBase dashboard, edit the `users`
collection, then enable the provider under Options → OAuth2. Enter credentials
from the corresponding provider console. The redirect URL for the SDK's
all-in-one flow is `<web app origin>/api/oauth2-redirect` (for a local Vite app
at `http://localhost:5173`, use `http://localhost:5173/api/oauth2-redirect`).
The app discovers
enabled providers automatically; no OAuth secrets belong in the web bundle or
repository. For deployment, use the public HTTPS PocketBase origin and ensure
the reverse proxy forwards `/api/oauth2-redirect` and PocketBase realtime
requests to PocketBase.
