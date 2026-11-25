#!/usr/bin/env node
/**
 * Builds `.omapp` packages and optionally syncs generated TypeScript bundles
 * into an adjacent `meshnet` checkout (`../meshnet/apps/web/src/lib/miniapps`).
 *
 * Usage:
 *   npm run sync-ommesh                # builds dist/*.omapp and checks adjacent checkout
 *   npm run sync-ommesh -- --write     # also updates checkersBundle.ts & battleshipBundle.ts in ../meshnet
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packAll, packAppDir } from "./pack.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = packAll({ write: true });
const ommeshDir = resolve(ROOT, "..", "meshnet", "apps", "web", "src", "lib", "miniapps");

console.log(`Built ${catalog.length} .omapp packages into dist/.`);

const writeBundles = process.argv.includes("--write");
const SYNC_TARGETS = [
  { slug: "chess", file: "chessBundle.ts", constPrefix: "CHESS", pkgExport: "chessPackage" },
  { slug: "checkers", file: "checkersBundle.ts", constPrefix: "CHECKERS", pkgExport: "checkersPackage" },
  { slug: "battleship", file: "battleshipBundle.ts", constPrefix: "BATTLESHIP", pkgExport: "battleshipPackage" },
  { slug: "lora-calc", file: "loraCalcBundle.ts", constPrefix: null, pkgExport: "loraCalcPackage" },
];

if (existsSync(ommeshDir)) {
  console.log(`Detected Ommesh checkout at ${ommeshDir}`);
  if (writeBundles) {
    for (const t of SYNC_TARGETS) {
      const appDir = join(ROOT, "apps", t.slug);
      const { pkg } = packAppDir(appDir);
      const enginePath = join(appDir, "engine.js");
      const hasEngine = t.constPrefix && existsSync(enginePath);
      const lines = [
        `/**`,
        ` * Auto-synced from \`ommesh-miniapps/apps/${t.slug}\` (${pkg.manifest.id}, v${pkg.manifest.version}, appId = 0x${pkg.manifest.appId.toString(16).padStart(4, "0")}).`,
        ` * Run \`npm run sync-ommesh -- --write\` inside \`ommesh-miniapps\` after editing the app sources.`,
        ` */`,
        ``,
        `import type { MiniAppPackage } from "@ommesh/miniapp-sdk";`,
        ``,
      ];
      if (t.constPrefix) {
        lines.push(`export const ${t.constPrefix}_APP_ID = 0x${pkg.manifest.appId.toString(16).padStart(4, "0")};`, ``);
      }
      if (hasEngine) {
        const engineJs = readFileSync(enginePath, "utf8");
        lines.push(`export const ${t.constPrefix}_ENGINE_JS = ${JSON.stringify(engineJs)};`, ``);
      }
      lines.push(`export const ${t.pkgExport}: MiniAppPackage = ${JSON.stringify(pkg, null, 2)};`, ``);
      writeFileSync(join(ommeshDir, t.file), lines.join("\n"), "utf8");
      console.log(`Synced ${t.file} (v${pkg.manifest.version})`);
    }
  } else {
    console.log("Run `npm run sync-ommesh -- --write` to update generated bundles in Ommesh, or sideload dist/*.omapp.");
  }
}
