import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { OGB_VERSION } from "./types.js";

test("OGB_VERSION matches package.json", () => {
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.join(srcDir, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  assert.equal(OGB_VERSION, packageJson.version);
});
