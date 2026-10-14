#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../apps/mobile/src/fixtures/synthetic-routes.json");

if (!fs.existsSync(FIXTURE_PATH)) {
  console.error(`[FixtureServer] Error: Canonical fixture not found at ${FIXTURE_PATH}`);
  process.exit(1);
}

const SYNTHETIC_SAVED_ROUTE = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
const PORT = Number(process.env.FIXTURE_SERVER_PORT || 8088);

function encodePolyline6(points) {
  let encoded = "";
  let prevLat = 0;
  let prevLon = 0;

  for (const point of points) {
    const lat = Math.round(point.latitude * 1_000_000);
    const lon = Math.round(point.longitude * 1_000_000);
    encoded += encodeValue(lat - prevLat);
    encoded += encodeValue(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return encoded;
}

function encodeValue(value) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let str = "";
  while (v >= 0x20) {
    str += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  str += String.fromCharCode(v + 63);
  return str;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check: GET /api/health
  if (url.pathname === "/api/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // PocketBase: GET /api/collections/routes/records
  if (url.pathname === "/api/collections/routes/records") {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        page: 1,
        perPage: 50,
        totalItems: 1,
        totalPages: 1,
        items: [SYNTHETIC_SAVED_ROUTE],
      }),
    );
    return;
  }

  // PocketBase: GET /api/collections/routes/records/:id
  const match = url.pathname.match(/^\/api\/collections\/routes\/records\/([^/]+)$/);
  if (match) {
    const id = match[1];
    if (id === SYNTHETIC_SAVED_ROUTE.id) {
      res.writeHead(200);
      res.end(JSON.stringify(SYNTHETIC_SAVED_ROUTE));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ code: 404, message: "The requested resource wasn't found.", data: {} }));
    return;
  }

  // Photon Place Search: GET /geocoding/api or /api
  if (url.pathname === "/geocoding/api" || url.pathname === "/api") {
    const q = (url.searchParams.get("q") || "").trim();
    const delayMs = Number(url.searchParams.get("test_delay") || req.headers["x-test-delay"] || 0);
    const shouldFail = url.searchParams.get("test_fail") === "true" || req.headers["x-test-fail"] === "true";

    const respond = () => {
      if (shouldFail || q === "fail") {
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Simulated geocoding failure" }));
        return;
      }

      if (q === "empty") {
        res.writeHead(200);
        res.end(JSON.stringify({ features: [] }));
        return;
      }

      const features = [
        {
          geometry: { coordinates: [-73.968, 40.785] },
          properties: {
            osm_id: 1001,
            osm_type: "way",
            name: "Central Park Loop",
            city: "New York",
            state: "NY",
            country: "USA",
          },
        },
        {
          geometry: { coordinates: [-73.974, 40.771] },
          properties: {
            osm_id: 1002,
            osm_type: "way",
            name: "Sheep Meadow",
            city: "New York",
            state: "NY",
            country: "USA",
          },
        },
      ];

      res.writeHead(200);
      res.end(JSON.stringify({ features }));
    };

    if (delayMs > 0) {
      setTimeout(respond, delayMs);
    } else {
      respond();
    }
    return;
  }

  // Photon Reverse Geocoding: GET /geocoding/reverse or /reverse
  if (url.pathname === "/geocoding/reverse" || url.pathname === "/reverse") {
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));

    if (isNaN(lat) || isNaN(lon)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Missing or invalid lat/lon parameters" }));
      return;
    }

    const feature = {
      geometry: { coordinates: [lon, lat] },
      properties: {
        osm_id: 2001,
        osm_type: "node",
        name: "Map-selected place",
        street: "Park Drive",
        city: "New York",
        state: "NY",
        country: "USA",
      },
    };

    res.writeHead(200);
    res.end(JSON.stringify({ features: [feature] }));
    return;
  }

  // Valhalla Routing: POST /route
  if (url.pathname === "/route" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const delayMs = Number(url.searchParams.get("test_delay") || req.headers["x-test-delay"] || 0);
      const shouldFail = url.searchParams.get("test_fail") === "true" || req.headers["x-test-fail"] === "true";

      const respond = () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (shouldFail) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: "Simulated Valhalla failure" }));
          return;
        }

        const locations = parsed.locations;
        if (!Array.isArray(locations) || locations.length < 2) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "At least two locations required" }));
          return;
        }

        const legs = [];
        let totalDistanceKm = 0;
        let totalTimeSec = 0;

        for (let i = 0; i < locations.length - 1; i++) {
          const start = locations[i];
          const end = locations[i + 1];

          const pStart = { latitude: start.lat, longitude: start.lon };
          const pMid = {
            latitude: (start.lat + end.lat) / 2 + 0.0001,
            longitude: (start.lon + end.lon) / 2 + 0.0001,
          };
          const pEnd = { latitude: end.lat, longitude: end.lon };

          const legPoints = [pStart, pMid, pEnd];
          const shape = encodePolyline6(legPoints);

          const distMeters =
            haversineMeters(pStart.latitude, pStart.longitude, pMid.latitude, pMid.longitude) +
            haversineMeters(pMid.latitude, pMid.longitude, pEnd.latitude, pEnd.longitude);
          const distKm = distMeters / 1000;
          const timeSec = Math.round(distMeters / 5.5); // ~20 km/h cycling speed

          totalDistanceKm += distKm;
          totalTimeSec += timeSec;

          const maneuvers = [
            {
              begin_shape_index: 0,
              instruction: i === 0 ? "Depart start point." : `Depart intermediate stop ${i}.`,
              verbal_pre_transition_instruction: "Depart onto path.",
            },
            {
              begin_shape_index: 2,
              instruction:
                i === locations.length - 2 ? "Arrive at finish." : `Arrive at intermediate stop ${i + 1}.`,
              verbal_pre_transition_instruction: "Arrive at waypoint.",
            },
          ];

          legs.push({
            shape,
            summary: { length: distKm, time: timeSec },
            maneuvers,
          });
        }

        const responsePayload = {
          trip: {
            summary: { length: totalDistanceKm, time: totalTimeSec },
            legs,
          },
        };

        res.writeHead(200);
        res.end(JSON.stringify(responsePayload));
      };

      if (delayMs > 0) {
        setTimeout(respond, delayMs);
      } else {
        respond();
      }
    });
    return;
  }

  // Fallback 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: `Not found: ${url.pathname}` }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[FixtureServer] Running on http://127.0.0.1:${server.address().port}`);
});
