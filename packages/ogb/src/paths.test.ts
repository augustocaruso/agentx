import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isHomeProject, normalizePathInput, resolveProjectPaths } from "./paths.js";

test("resolveProjectPaths uses global agentX state paths when project root is home", () => {
  const homeDir = path.join(os.tmpdir(), "agentx-home-mode");
  const paths = resolveProjectPaths(homeDir, homeDir);

  assert.equal(isHomeProject(homeDir, homeDir), true);
  assert.equal(paths.homeMode, true);
  assert.equal(paths.generatedDir, path.join(homeDir, ".config", "agentx", "generated"));
  assert.equal(paths.agentxConfigPath, path.join(homeDir, ".config", "agentx", "agentx.config.jsonc"));
});

test("resolveProjectPaths treats accidentally quoted home paths as home mode", () => {
  const homeDir = path.join(os.tmpdir(), "agentx quoted home");

  for (const projectRoot of [homeDir, `"${homeDir}"`, `'${homeDir}'`, `'"${homeDir}"'`]) {
    const paths = resolveProjectPaths(projectRoot, homeDir);

    assert.equal(isHomeProject(projectRoot, homeDir), true);
    assert.equal(paths.homeMode, true);
    assert.equal(paths.projectRoot, path.resolve(homeDir));
    assert.equal(paths.generatedDir, path.join(homeDir, ".config", "agentx", "generated"));
  }
});

test("normalizePathInput strips only surrounding quotes", () => {
  assert.equal(normalizePathInput(` '"C:\\Users\\leona"' `), "C:\\Users\\leona");
  assert.equal(normalizePathInput(`'\\"C:\\Users\\leona\\"'`), "C:\\Users\\leona");
  assert.equal(normalizePathInput(`C:\\Users\\leo"na`), `C:\\Users\\leo"na`);
});
