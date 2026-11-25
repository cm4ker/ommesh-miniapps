#!/usr/bin/env node
/**
 * Scaffolds a new Ommesh mini-app under `apps/<slug>` from `templates/standalone`
 * or `templates/p2p`.
 *
 * Usage:
 *   npm run new -- my-tool --standalone
 *   npm run new -- my-game --p2p --app-id 0xff10
 */

import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const isP2p = args.includes("--p2p");
const appIdFlag = args.indexOf("--app-id");
const rawAppId = appIdFlag >= 0 ? args[appIdFlag + 1] : undefined;

if (!slug || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
  console.error("Usage: npm run new -- <slug> [--standalone | --p2p] [--app-id 0xff10]");
  process.exit(1);
}

const target = join(ROOT, "apps", slug);
if (existsSync(target)) {
  console.error(`Directory already exists: apps/${slug}`);
  process.exit(1);
}

const templateDir = join(ROOT, "templates", isP2p ? "p2p" : "standalone");
cpSync(templateDir, target, { recursive: true });

const manifestPath = join(target, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.id = `community.${slug}`;
manifest.name = { en: slug, ru: slug };
if (isP2p) {
  manifest.appId = rawAppId ? Number(rawAppId) : 0xff00 + Math.floor(Math.random() * 255);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`Created apps/${slug} (${isP2p ? `p2p, appId=0x${manifest.appId.toString(16)}` : "standalone"})`);
console.log("Next steps:");
console.log("  1. Edit apps/" + slug + "/manifest.json and index.html");
console.log("  2. Run `npm run build` -> produces dist/" + manifest.id + ".omapp");
console.log("  3. Sideload dist/" + manifest.id + ".omapp in Ommesh (Apps -> Store -> Load .omapp)");
