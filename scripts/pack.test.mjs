import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { packAll, packAppDir, validateManifest } from "./pack.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("packs all official apps and inlines shared engine.js into P2P bundles", () => {
  const catalog = packAll({ write: false });
  assert.ok(catalog.some((a) => a.id === "ommesh.chess" && a.appId === 0x0100));
  assert.ok(catalog.some((a) => a.id === "ommesh.checkers" && a.appId === 0x0101));
  assert.ok(catalog.some((a) => a.id === "ommesh.battleship" && a.appId === 0x0102));
  assert.ok(catalog.some((a) => a.id === "ommesh.lora-calc" && a.appId === 0));

  for (const item of catalog) {
    assert.match(item.sha256, /^[0-9a-f]{64}$/, `${item.id} missing valid sha256`);
    assert.ok(item.iconSvg.includes("<svg") && !/<script/i.test(item.iconSvg), `${item.id} invalid iconSvg`);
  }

  for (const slug of ["chess", "checkers", "battleship"]) {
    const { pkg } = packAppDir(join(ROOT, "apps", slug));
    assert.ok(pkg.html.includes("function buildManualSyncPackets"), `${slug} html missing engine`);
    assert.ok(pkg.workerJs.includes("function buildManualSyncPackets"), `${slug} worker missing engine`);
    assert.ok(!pkg.html.includes("@include"), `${slug} html has unexpanded @include`);
    assert.ok(!pkg.workerJs.includes("@include"), `${slug} worker has unexpanded @include`);
  }
});

test("rejects invalid app manifests", () => {
  assert.ok(validateManifest({ schema: 1, id: "bad", appId: 0, version: "1.0.0", scope: "p2p", name: "X", author: "A", permissions: [] }));
  assert.ok(validateManifest({ schema: 1, id: "bad", appId: 1, version: "1.0.0", scope: "standalone", name: "X", author: "A", permissions: [] }));
});
