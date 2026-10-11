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
      })
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

  res.writeHead(404);
  res.end(JSON.stringify({ code: 404, message: "Not found", data: {} }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[FixtureServer] Listening on http://127.0.0.1:${PORT}`);
});
