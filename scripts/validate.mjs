#!/usr/bin/env node
/**
 * Validates all apps in `apps/*`, `templates/*` and `registry.json` without
 * requiring a build directory. Used by `npm run validate` and GitHub Actions CI.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packAll, packAppDir } from "./pack.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(join(ROOT, "registry.json"), "utf8"));

const catalog = packAll({ write: false });
const byId = new Map(catalog.map((c) => [c.id, c]));

for (const entry of registry.apps) {
  const built = byId.get(entry.id);
  if (!built) {
    throw new Error(`registry.json lists "${entry.id}", but no matching app was found under apps/`);
  }
  if (built.appId !== entry.appId) {
    throw new Error(`registry.json appId mismatch for "${entry.id}": registry=${entry.appId}, manifest=${built.appId}`);
  }
}

// Validate starter templates too so they never rot.
const templatesDir = join(ROOT, "templates");
for (const name of readdirSync(templatesDir)) {
  const dir = join(templatesDir, name);
  if (!statSync(dir).isDirectory()) continue;
  const { pkg, bytes } = packAppDir(dir);
  console.log(`template ok: ${name} (${pkg.manifest.id}, ${(bytes.length / 1024).toFixed(1)} KB)`);
}

console.log(`validated ${catalog.length} apps and registry.json successfully`);
