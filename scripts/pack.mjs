#!/usr/bin/env node
/**
 * Packs every mini-app under `apps/<dir>` into a validated self-contained
 * `dist/<manifest.id>.omapp` bundle, generates `dist/catalog.json` (with
 * SHA-256 digests and inline monochrome icons for the remote Ommesh store),
 * and emits a minimal static `dist/index.html` + `.nojekyll` for GitHub Pages.
 *
 * Supports local file inlining so authors can split JS/CSS cleanly:
 * - In HTML: `<script src="./file.js"></script>` and `<link rel="stylesheet" href="./file.css" />`
 * - In JS/HTML: `/* @include ./file.js *\/`
 */

import { createHash } from "node:crypto";
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
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { pkg, bytes, sha256 };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderCatalogIndexHtml(catalog, updatedAt) {
  const rows = catalog
    .map((item) => {
      const nameRu = pickText(item.name, "ru");
      const nameEn = pickText(item.name, "en");
      const title = nameRu && nameEn && nameRu !== nameEn ? `${nameRu} / ${nameEn}` : (nameRu || nameEn);
      const desc = pickText(item.description, "ru") || pickText(item.description, "en");
      const kb = Math.max(1, Math.round(item.sizeBytes / 1024));
      const appIdStr = item.appId ? `0x${item.appId.toString(16).padStart(4, "0")}` : "offline";
      return `      <article class="card">
        <div class="head">
          <div class="icon">${item.iconSvg}</div>
          <div>
            <h2>${escapeHtml(title)}</h2>
            <div class="meta"><code>${escapeHtml(item.id)}</code> · v${escapeHtml(item.version)} · ${kb} KB · ${appIdStr}</div>
          </div>
        </div>
        <p>${escapeHtml(desc)}</p>
        <div class="foot">
          <a class="btn" href="./${encodeURIComponent(item.file)}" download>Download .omapp</a>
          <span class="hash" title="SHA-256">${item.sha256.slice(0, 16)}…</span>
        </div>
      </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Ommesh Mini-Apps Catalog</title>
  <style>
    :root { color-scheme: light dark; --bg: #0f1218; --card: #181c24; --border: #2a3140; --text: #e6ebf4; --muted: #98a2b3; --accent: #5c78e2; }
    @media (prefers-color-scheme: light) { :root { --bg: #f6f7fa; --card: #ffffff; --border: #e2e6ef; --text: #1b2029; --muted: #5c6575; --accent: #4c68d7; } }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 18px 48px; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    main { max-width: 860px; margin: 0 auto; }
    header { margin-bottom: 24px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .sub { margin: 0; color: var(--muted); }
    .sub a { color: var(--accent); text-decoration: none; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .head { display: flex; gap: 12px; align-items: center; }
    .icon { width: 42px; height: 42px; border-radius: 10px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; flex: none; color: var(--accent); }
    .icon svg { width: 24px; height: 24px; }
    h2 { margin: 0; font-size: 16px; }
    .meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
    p { margin: 0; font-size: 13.5px; color: var(--muted); flex: 1; }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 4px; }
    .btn { display: inline-block; padding: 7px 12px; border-radius: 8px; background: var(--accent); color: #fff; text-decoration: none; font-size: 13px; font-weight: 600; }
    .hash { font: 11px ui-monospace, Consolas, monospace; color: var(--muted); }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Ommesh Mini-Apps Catalog</h1>
      <p class="sub">Official LoRa mini-app registry · <a href="./catalog.json">catalog.json</a> · updated ${escapeHtml(updatedAt)}</p>
    </header>
    <section class="grid">
${rows}
    </section>
  </main>
</body>
</html>
`;
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
    const { pkg, bytes, sha256 } = packAppDir(dir);
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
      sha256,
      iconSvg: pkg.iconSvg,
      file,
    });
  }

  if (write) {
    const updatedAt = new Date().toISOString();
    writeFileSync(
      join(DIST_DIR, "catalog.json"),
      JSON.stringify({ schema: 1, updatedAt, apps: catalog }, null, 2) + "\n",
      "utf8",
    );
    writeFileSync(join(DIST_DIR, "index.html"), renderCatalogIndexHtml(catalog, updatedAt), "utf8");
    writeFileSync(join(DIST_DIR, ".nojekyll"), "", "utf8");
  }
  return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = packAll({ write: true });
  for (const item of catalog) {
    console.log(
      `packed ${item.file} (v${item.version}, ${(item.sizeBytes / 1024).toFixed(1)} KB, appId=0x${item.appId.toString(16).padStart(4, "0")}, sha256=${item.sha256.slice(0, 12)})`,
    );
  }
  console.log(`wrote dist/catalog.json & dist/index.html (${catalog.length} apps)`);
}
