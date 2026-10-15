# Offline route maps

Status: Sol contract, 2026-10-14. Implementation pending the core navigation and
prepared-route work. First acceptance target is Android on the dedicated Mac
emulator; iOS must not inherit an unverified Android offline-readiness claim.

## Rider experience

Add **Download map** to the selected ride's secondary actions. Keep map home and
the floating ride controls as the primary surfaces. Download is explicit, with
the covered area/detail and estimated size presented before starting. One saved
route has one bounded map region. Show downloading/progress, paused, incomplete,
ready and failed states truthfully, with cancel/resume/remove actions. A saved
route and its turn directions already work without network; distinguish that
from a downloaded basemap. An incomplete region must not receive an offline-ready
badge. Removing a map must preserve the ride and directions.

Use the effective saved geometry (including prepared versions) to derive a padded
bounding region. Detect antimeridian/wide/invalid bounds explicitly. Do not request
the enormous bounding rectangle of a malformed or global route. Start with a
documented useful cycling detail level, conservatively estimate tile counts across
the source's zoom levels, and refuse oversize downloads with a recoverable message.
Do not split a large region to circumvent a provider's limit. Store the region's
geometry version and actual bounds; after route changes, coverage must be checked
again rather than silently transferring the ready badge.

## Provider and native requests

The existing OpenFreeMap style is the initial bounded provider. Its current mobile
policy permits at most 3,000 tiles OR 50 MB per download, at most four concurrent
requests, and an identifying User-Agent. Use conservative preflight limits plus
an enforced download bound for this provider. MapLibre's
`setOfflineMapboxTileCountLimit` applies only to Mapbox-hosted sources, so its
JavaScript `setTileCountLimit` wrapper does not establish an OpenFreeMap ceiling.
Record the native pack's actual completed/required
resource and tile counts/sizes. Any byte-based guard must account for in-flight
resources; a progress callback cannot guarantee zero byte overshoot by itself.

Pinned MapLibre React Native 11.4 has a specific Android trap:
`MLRNTransformRequestModule.ensureInterceptorAdded()` installs a new OkHttp client
whose dispatcher sets `maxRequestsPerHost = 20`. Its JavaScript NetworkManager
does not expose dispatcher configuration. Merely adding a User-Agent transform or
calling `createPack` does not meet the provider's concurrency rule. Configure and
verify the actual client used for pack downloads, preserving request transforms;
do not rely on a separate JS fetch limiter. If a reproducible local native module
or Expo plugin is necessary, keep it small, checked into the app, pinned to the
installed API, and fail clearly if upstream source/API assumptions change. Never
leave a manual untracked node_modules edit as the implementation.

Keep provider URL/identification and limits in one configuration shared by every
map surface. Do not download from OSM's standard public tile service. Preserve map
and OSM attribution online and offline. A different self-hosted provider needs its
own documented coverage/resources/updates; no planet download is implied.

## Durable packs and navigation

Wrap MapLibre OfflineManager behind an adapter with native pack enumeration,
create/status/pause/resume/delete and progress/error subscription. Reconcile
persisted route metadata with actual native packs on startup; a missing pack or
failed status check is not ready. Progress callbacks from old/deleted packs cannot
resurrect them. Serialize pack mutation, bound concurrent downloads, and unsubscribe
listeners when unused. Cancellation/deletion must leave a recoverable incomplete
state if native cleanup fails.

Use a stable pack/style identity that also covers style JSON, vector sources,
glyphs and sprites. Route lines and guidance are loaded from local data. A warm
map cache is insufficient evidence: reopening a cold app with network disabled
must render the downloaded region, road labels and route, and allow navigation.
Avoid exposing tile/native implementation terminology in rider-facing controls.

## Focused verification

Authored unit cases cover route bounds, tile estimates, limits, geometry changes,
pack reconciliation, pause/resume/remove races and incomplete/error states. A local
fixture source records request headers and peak concurrent requests from the
actual native downloader; exercise it before a low-volume public download smoke.
Use real native status records, not a test-only ready boolean.

On the dedicated emulator download one small synthetic route region, stop the
app, disable network, reopen and inspect style/labels/route plus stored guidance.
Verify pause/resume and removal without deleting the ride. Restore connectivity
after the run. Do not claim iOS or physical riding evidence from these checks.

## References checked

- [OpenFreeMap mobile policy](https://openfreemap.org/quick_start/#mobile-apps),
  checked 2026-10-14; recheck before the first public pack download.
- [MapLibre OfflineManager](https://maplibre.org/maplibre-react-native/docs/modules/offline-manager/).
- Installed source: `@maplibre/maplibre-react-native` 11.4.0,
  `src/modules/offline/` and Android `MLRNTransformRequestModule.kt`.
- [MapLibre Native offline observer contract](https://maplibre.org/maplibre-native/cpp/api/offline_8hpp_source.html):
  the Mapbox tile-count limit excludes other tile sources. Pinned Android
  `MLRNOfflineModule.setOfflineRegionObserver` also starts downloading when an
  observer is attached; observation must preserve paused state in this app.
