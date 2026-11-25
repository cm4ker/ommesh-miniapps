#!/usr/bin/env node
/**
 * Packs every mini-app under `apps/<dir>` into a validated self-contained
 * `dist/<manifest.id>.omapp` bundle and generates `dist/catalog.json`.
 *
 * Supports local file inlining so authors can split JS/CSS cleanly:
 * - In HTML: `<script src="./file.js"></script>` and `<link rel="stylesheet" href="./file.css" />`
 * - In JS/HTML: `/* @include ./file.js *\/`
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPS_DIR = join(ROOT, "apps");
const DIST_DIR = join(ROOT, "dist");
const REGISTRY_PATH = join(ROOT, "registry.json");

export const MAX_OMAPP_BYTES = 512 * 1024;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const VALID_SCOPES = new Set(["standalone", "p2p", "channel"]);
const VALID_PERMISSIONS = new Set(["peerData", "storage", "notifications"]);

export function pickText(text, locale = "en") {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text[locale] ?? text.en ?? text.ru ?? Object.values(text).find((v) => typeof v === "string") ?? "";
}

export function validateManifest(m) {
  if (!m || typeof m !== "object") return "manifest must be an object";
  if (m.schema !== 1) return "manifest.schema must be 1";
  if (typeof m.id !== "string" || !ID_PATTERN.test(m.id)) return `invalid manifest.id: ${m.id}`;
  if (typeof m.version !== "string" || !m.version.trim() || m.version.length > 32) return "invalid manifest.version";
  if (!VALID_SCOPES.has(m.scope)) return `invalid manifest.scope: ${m.scope}`;
  if (!Number.isInteger(m.appId) || m.appId < 0 || m.appId > 0xffff) return `appId out of range: ${m.appId}`;
  if (m.scope === "p2p" && m.appId === 0) return "p2p mini-apps must declare a non-zero appId";
  if (m.scope === "standalone" && m.appId !== 0) return "standalone mini-apps must use appId 0";
  if (!pickText(m.name, "en")) return "manifest.name is required";
  if (typeof m.author !== "string" || !m.author.trim()) return "manifest.author is required";
  if (!Array.isArray(m.permissions) || m.permissions.some((p) => !VALID_PERMISSIONS.has(p))) {
    return "manifest.permissions contains an unsupported permission";
  }
  return null;
}

function inlineIncludes(text, baseDir, seen = new Set()) {
  let out = text.replace(/\/\*\s*@include\s+([^\s*]+)\s*\*\//g, (_, rel) => {
    const target = resolve(baseDir, rel);
    if (seen.has(target)) throw new Error(`circular @include: ${target}`);
    const nextSeen = new Set(seen);
    nextSeen.add(target);
    return inlineIncludes(readFileSync(target, "utf8"), dirname(target), nextSeen);
  });
  out = out.replace(/<script\s+src="(\.\/[^"]+)"\s*><\/script>/gi, (_, rel) => {
    const target = resolve(baseDir, rel);
    const code = inlineIncludes(readFileSync(target, "utf8"), dirname(target), seen);
    return `<script>\n${code.replace(/<\/script>/gi, "<\\/script>")}\n</script>`;
  });
  out = out.replace(/<link\s+rel="stylesheet"\s+href="(\.\/[^"]+)"\s*\/?>/gi, (_, rel) => {
    const target = resolve(baseDir, rel);
    const css = readFileSync(target, "utf8");
    return `<style>\n${css}\n</style>`;
  });
  return out;
}

export function packAppDir(appDir) {
  const manifest = JSON.parse(readFileSync(join(appDir, "manifest.json"), "utf8"));
  const err = validateManifest(manifest);
  if (err) throw new Error(`${appDir}: ${err}`);

  const iconSvg = readFileSync(join(appDir, "icon.svg"), "utf8").trim();
  if (!iconSvg.includes("<svg")) throw new Error(`${manifest.id}: icon.svg must contain <svg>`);
  if (/<script\b/i.test(iconSvg)) throw new Error(`${manifest.id}: icon.svg must not contain <script>`);

  const html = inlineIncludes(readFileSync(join(appDir, "index.html"), "utf8"), appDir).trim();
  if (!html) throw new Error(`${manifest.id}: index.html is empty`);

  const pkg = { format: "omapp-v1", manifest, iconSvg, html };
  const workerPath = join(appDir, "worker.js");
  try {
    if (statSync(workerPath).isFile()) {
      pkg.workerJs = inlineIncludes(readFileSync(workerPath, "utf8"), appDir).trim();
    }
  } catch {
    // Optional background worker
  }

  const json = JSON.stringify(pkg);
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > MAX_OMAPP_BYTES) {
    throw new Error(`${manifest.id}: bundle is ${bytes.length} bytes (max ${MAX_OMAPP_BYTES})`);
  }
  return { pkg, bytes };
}

export function packAll({ write = true } = {}) {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const verifiedIds = new Set(registry.apps.filter((a) => a.verified).map((a) => a.id));
  const dirs = readdirSync(APPS_DIR)
    .map((name) => join(APPS_DIR, name))
    .filter((p) => statSync(p).isDirectory())
    .sort();

  const seenIds = new Set();
  const seenAppIds = new Map();
  const catalog = [];

  if (write) mkdirSync(DIST_DIR, { recursive: true });

  for (const dir of dirs) {
    const { pkg, bytes } = packAppDir(dir);
    const { id, appId, version, name, description, author, scope, permissions, minProtocol } = pkg.manifest;
    if (seenIds.has(id)) throw new Error(`duplicate manifest id: ${id}`);
    seenIds.add(id);
    if (appId !== 0) {
      if (seenAppIds.has(appId)) {
        throw new Error(`duplicate appId 0x${appId.toString(16)} (${seenAppIds.get(appId)} and ${id})`);
      }
      seenAppIds.set(appId, id);
    }
    const file = `${id}.omapp`;
    if (write) writeFileSync(join(DIST_DIR, file), bytes);
    catalog.push({
      id,
      appId,
      version,
      name,
      description,
      author,
      scope,
      ...(minProtocol ? { minProtocol } : {}),
      permissions,
      verified: verifiedIds.has(id),
      sizeBytes: bytes.length,
      file,
    });
  }

  if (write) {
    writeFileSync(
      join(DIST_DIR, "catalog.json"),
      JSON.stringify({ schema: 1, updatedAt: new Date().toISOString(), apps: catalog }, null, 2) + "\n",
      "utf8",
    );
  }
  return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = packAll({ write: true });
  for (const item of catalog) {
    console.log(`packed ${item.file} (v${item.version}, ${(item.sizeBytes / 1024).toFixed(1)} KB, appId=0x${item.appId.toString(16).padStart(4, "0")})`);
  }
  console.log(`wrote dist/catalog.json (${catalog.length} apps)`);
}
