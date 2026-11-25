import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { packAll, packAppDir, validateManifest } from "./pack.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("packs all official apps and inlines shared engine.js into chess bundle", () => {
  const catalog = packAll({ write: false });
  assert.ok(catalog.some((a) => a.id === "ommesh.chess" && a.appId === 0x0100));
  assert.ok(catalog.some((a) => a.id === "ommesh.lora-calc" && a.appId === 0));

  const { pkg } = packAppDir(join(ROOT, "apps", "chess"));
  assert.ok(pkg.html.includes("function buildManualSyncPackets"));
  assert.ok(pkg.workerJs.includes("function buildManualSyncPackets"));
  assert.ok(!pkg.html.includes("@include"));
  assert.ok(!pkg.workerJs.includes("@include"));
});

test("rejects invalid app manifests", () => {
  assert.ok(validateManifest({ schema: 1, id: "bad", appId: 0, version: "1.0.0", scope: "p2p", name: "X", author: "A", permissions: [] }));
  assert.ok(validateManifest({ schema: 1, id: "bad", appId: 1, version: "1.0.0", scope: "standalone", name: "X", author: "A", permissions: [] }));
});
