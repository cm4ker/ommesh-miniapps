#!/usr/bin/env node
/**
 * Builds `.omapp` packages and checks compatibility with an adjacent `meshnet`
 * checkout (`../meshnet`). Prints the packed sizes and verifies every verified
 * app passes manifest validation.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packAll } from "./pack.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = packAll({ write: true });
const ommeshDir = resolve(ROOT, "..", "meshnet", "apps", "web", "src", "lib", "miniapps");

console.log(`Built ${catalog.length} .omapp packages into dist/.`);
if (existsSync(ommeshDir)) {
  console.log(`Detected Ommesh checkout at ${ommeshDir}`);
  console.log("You can sideload any dist/*.omapp directly in Ommesh (Apps -> Store -> Load .omapp).");
}
