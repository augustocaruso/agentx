import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { projectRulesyncProjection, resolveRulesyncCommand } from "./rulesync.js";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("projectRulesyncProjection returns empty timing when Rulesync is disabled", () => {
  const projectRoot = tempDir("ogb-rulesync-project-");
  const homeDir = tempDir("ogb-rulesync-home-");

  const result = projectRulesyncProjection({ projectRoot, homeDir, mode: "off", features: ["mcp"] });

  assert.equal(result.status, "skipped");
  assert.ok(result.timing);
  assert.equal(result.timing.features.length, 0);
  assert.equal(typeof result.timing.durationMs, "number");
  assert.ok(result.timing.durationMs >= 0);
});

test("projectRulesyncProjection reports timing for each requested feature", (t) => {
  const projectRoot = tempDir("ogb-rulesync-project-");
  const homeDir = tempDir("ogb-rulesync-home-");
  if (!resolveRulesyncCommand(projectRoot)) t.skip("Rulesync command is unavailable");

  fs.writeFileSync(path.join(projectRoot, "GEMINI.md"), "Use project rules.\n", "utf8");

  const result = projectRulesyncProjection({
    projectRoot,
    homeDir,
    mode: "require",
    dryRun: true,
    features: ["mcp", "commands"],
  });

  assert.ok(result.timing);
  assert.equal(result.timing.features.length, 2);
  assert.deepEqual(result.timing.features.map((feature) => feature.feature), ["mcp", "commands"]);
  assert.ok(result.timing.durationMs >= 0);
  for (const feature of result.timing.features) {
    assert.match(feature.status, /^(success|error)$/);
    assert.ok(feature.durationMs >= 0);
  }
});
