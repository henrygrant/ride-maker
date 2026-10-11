#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const variant = process.argv[2] || "test";

const hash = crypto.createHash("sha256");

// 1. Variant and Environment configuration (content & build identity)
hash.update(`VARIANT:${variant}\n`);
hash.update("ENV:EXPO_NO_DOTENV=1\n");
if (variant === "test") {
  hash.update("ENV:EXPO_PUBLIC_ENABLE_DIAGNOSTICS=true\n");
  hash.update("ENV:EXPO_PUBLIC_TEST_MODE=true\n");
  hash.update("ENV:EXPO_PUBLIC_API_URL=http://127.0.0.1:8088/api\n");
  hash.update("ENV:APP_ENV=test\n");
  hash.update("PKG:net.thg3.ridemaker.e2e\n");
  hash.update("CLEARTEXT:true\n");
} else {
  hash.update("ENV:EXPO_PUBLIC_ENABLE_DIAGNOSTICS=false\n");
  hash.update("ENV:EXPO_PUBLIC_TEST_MODE=false\n");
  hash.update("ENV:EXPO_PUBLIC_API_URL=\n");
  hash.update("ENV:APP_ENV=production\n");
  hash.update("PKG:net.thg3.ridemaker\n");
  hash.update("CLEARTEXT:false\n");
}

// 2. Pure content-based identity of all bundled source, dependencies, and configuration.
// Excludes git HEAD and git status so clean worktrees and dirty trees with identical
// files produce the exact same fingerprint.

const EXCLUDE_NAMES = new Set([
  ".turbo",
  ".DS_Store",
  "node_modules",
  ".expo",
  "build",
  "dist",
]);

function isExcluded(filePath) {
  const parts = filePath.split(path.sep);
  for (const part of parts) {
    if (EXCLUDE_NAMES.has(part)) return true;
  }
  if (filePath.endsWith(".tsbuildinfo") || filePath.endsWith(".log")) {
    return true;
  }
  return false;
}

function collectFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (isExcluded(fullPath)) continue;
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

const individualFiles = [
  path.join(REPO_ROOT, "package.json"),
  path.join(REPO_ROOT, "package-lock.json"),
  path.join(REPO_ROOT, "tsconfig.base.json"),
  path.join(REPO_ROOT, "turbo.json"),
  path.join(REPO_ROOT, "apps/mobile/package.json"),
  path.join(REPO_ROOT, "apps/mobile/app.json"),
  path.join(REPO_ROOT, "apps/mobile/app.config.js"),
  path.join(REPO_ROOT, "apps/mobile/tsconfig.json"),
  path.join(REPO_ROOT, "apps/mobile/index.ts"),
  path.join(REPO_ROOT, "scripts/mobile-e2e/bootstrap.sh"),
  path.join(REPO_ROOT, "scripts/mobile-e2e/fingerprint.mjs"),
  path.join(REPO_ROOT, "scripts/mobile-e2e/inspect-apk.mjs"),
];

const directories = [
  path.join(REPO_ROOT, "apps/mobile/plugins"),
  path.join(REPO_ROOT, "apps/mobile/src"),
  path.join(REPO_ROOT, "packages/domain"),
  path.join(REPO_ROOT, "packages/persistence"),
  path.join(REPO_ROOT, "packages/ui"),
  path.join(REPO_ROOT, "packages/routing"),
  path.join(REPO_ROOT, "packages/geocoding"),
  path.join(REPO_ROOT, "packages/gpx"),
];

if (variant === "harness") {
  directories.push(path.join(REPO_ROOT, "apps/mobile/e2e/flows"), path.join(REPO_ROOT, "scripts/mobile-e2e"));
}

const allFiles = new Set();

for (const file of individualFiles) {
  if (fs.existsSync(file) && !isExcluded(file)) {
    allFiles.add(file);
  }
}

for (const dir of directories) {
  for (const file of collectFiles(dir)) {
    // Exclude fingerprint.mjs itself from circular dependency if modified during dev,
    // but include all test scripts and flows
    allFiles.add(file);
  }
}

const sortedFiles = Array.from(allFiles).sort();

for (const filePath of sortedFiles) {
  if (fs.existsSync(filePath)) {
    const relativePath = path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
    const content = fs.readFileSync(filePath);
    const fileHash = crypto.createHash("sha256").update(content).digest("hex");
    hash.update(`FILE:${relativePath}:${fileHash}\n`);
  }
}

const finalFingerprint = hash.digest("hex");
console.log(finalFingerprint);
