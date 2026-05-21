import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { migrateFromOgb } from "./migrate-from-ogb.js";

interface Fixture {
  homeDir: string;
  projectRoot: string;
}

function setup(t: TestContext): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentx-migrate-"));
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { homeDir, projectRoot };
}

test("returns no-legacy-state when neither home nor project has legacy artifacts", (t) => {
  const { homeDir, projectRoot } = setup(t);
  const report = migrateFromOgb({ homeDir, projectRoot });

  assert.equal(report.status, "no-legacy-state");
  assert.deepEqual(report.renamedFiles, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "agentx")), false);
});

test("short-circuits to already-done when marker is present", (t) => {
  const { homeDir, projectRoot } = setup(t);
  const newHome = path.join(homeDir, ".config", "agentx");
  fs.mkdirSync(newHome, { recursive: true });
  fs.writeFileSync(path.join(newHome, ".migrated-from-ogb"), "migrated\n", "utf8");

  const legacyHome = path.join(homeDir, ".config", "opencode-gemini-bridge");
  fs.mkdirSync(legacyHome, { recursive: true });
  fs.writeFileSync(path.join(legacyHome, "stays.txt"), "x", "utf8");

  const report = migrateFromOgb({ homeDir, projectRoot });

  assert.equal(report.status, "already-done");
  assert.equal(fs.existsSync(path.join(legacyHome, "stays.txt")), true);
});

test("migrates legacy home dir and renames the generated/ prefix", (t) => {
  const { homeDir, projectRoot } = setup(t);
  const legacyHome = path.join(homeDir, ".config", "opencode-gemini-bridge");
  fs.mkdirSync(path.join(legacyHome, "generated"), { recursive: true });
  fs.writeFileSync(path.join(legacyHome, "ogb.config.jsonc"), "{}", "utf8");
  fs.writeFileSync(path.join(legacyHome, "generated", "ogb-doctor.json"), "{}", "utf8");
  fs.writeFileSync(path.join(legacyHome, "generated", "ogb-pass.json"), "{}", "utf8");
  fs.writeFileSync(path.join(legacyHome, "generated", "GEMINI.expanded.md"), "...", "utf8");

  const report = migrateFromOgb({ homeDir, projectRoot });

  const newHome = path.join(homeDir, ".config", "agentx");
  assert.equal(report.status, "migrated");
  assert.equal(report.movedHomeDir?.from, legacyHome);
  assert.equal(report.movedHomeDir?.to, newHome);
  assert.equal(fs.existsSync(legacyHome), false);
  assert.equal(fs.existsSync(path.join(newHome, "ogb.config.jsonc")), true);
  assert.equal(fs.existsSync(path.join(newHome, "generated", "agentx-doctor.json")), true);
  assert.equal(fs.existsSync(path.join(newHome, "generated", "agentx-pass.json")), true);
  assert.equal(fs.existsSync(path.join(newHome, "generated", "ogb-doctor.json")), false);
  assert.equal(fs.existsSync(path.join(newHome, "generated", "GEMINI.expanded.md")), true);
  assert.equal(fs.existsSync(path.join(newHome, ".migrated-from-ogb")), true);
});

test("migrates legacy project files and renames .opencode/generated prefix", (t) => {
  const { homeDir, projectRoot } = setup(t);
  const opencodeDir = path.join(projectRoot, ".opencode");
  fs.mkdirSync(path.join(opencodeDir, "generated"), { recursive: true });
  fs.writeFileSync(path.join(opencodeDir, "ogb.config.jsonc"), "{}", "utf8");
  fs.writeFileSync(path.join(opencodeDir, "ogb-trust.jsonc"), "{}", "utf8");
  fs.writeFileSync(path.join(opencodeDir, "generated", "ogb-inventory.json"), "{}", "utf8");
  fs.writeFileSync(path.join(opencodeDir, "generated", "opencode.generated.json"), "{}", "utf8");

  const report = migrateFromOgb({ homeDir, projectRoot });

  assert.equal(report.status, "migrated");
  assert.equal(fs.existsSync(path.join(opencodeDir, "ogb.config.jsonc")), false);
  assert.equal(fs.existsSync(path.join(opencodeDir, "agentx.config.jsonc")), true);
  assert.equal(fs.existsSync(path.join(opencodeDir, "ogb-trust.jsonc")), false);
  assert.equal(fs.existsSync(path.join(opencodeDir, "agentx-trust.jsonc")), true);
  assert.equal(fs.existsSync(path.join(opencodeDir, "generated", "agentx-inventory.json")), true);
  assert.equal(fs.existsSync(path.join(opencodeDir, "generated", "ogb-inventory.json")), false);
  assert.equal(fs.existsSync(path.join(opencodeDir, "generated", "opencode.generated.json")), true);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "agentx", ".migrated-from-ogb")), true);
});

test("merges into existing new home and warns on collisions", (t) => {
  const { homeDir, projectRoot } = setup(t);
  const legacyHome = path.join(homeDir, ".config", "opencode-gemini-bridge");
  const newHome = path.join(homeDir, ".config", "agentx");
  fs.mkdirSync(legacyHome, { recursive: true });
  fs.mkdirSync(newHome, { recursive: true });
  fs.writeFileSync(path.join(legacyHome, "ogb.config.jsonc"), "legacy", "utf8");
  fs.writeFileSync(path.join(legacyHome, "untouched.txt"), "from-legacy", "utf8");
  fs.writeFileSync(path.join(newHome, "ogb.config.jsonc"), "current", "utf8");

  const report = migrateFromOgb({ homeDir, projectRoot });

  assert.equal(report.status, "migrated");
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /ogb\.config\.jsonc/);
  assert.equal(fs.readFileSync(path.join(newHome, "ogb.config.jsonc"), "utf8"), "current");
  assert.equal(fs.readFileSync(path.join(newHome, "untouched.txt"), "utf8"), "from-legacy");
  assert.equal(fs.existsSync(path.join(legacyHome, "ogb.config.jsonc")), true);
  assert.equal(fs.existsSync(path.join(legacyHome, "untouched.txt")), false);
});

test("idempotent: a second run after migration reports already-done", (t) => {
  const { homeDir, projectRoot } = setup(t);
  const opencodeDir = path.join(projectRoot, ".opencode");
  fs.mkdirSync(opencodeDir, { recursive: true });
  fs.writeFileSync(path.join(opencodeDir, "ogb.config.jsonc"), "{}", "utf8");

  const first = migrateFromOgb({ homeDir, projectRoot });
  assert.equal(first.status, "migrated");

  const second = migrateFromOgb({ homeDir, projectRoot });
  assert.equal(second.status, "already-done");
  assert.deepEqual(second.renamedFiles, []);
});

test("skips a generated rename when the target file already exists", (t) => {
  const { homeDir, projectRoot } = setup(t);
  const generatedDir = path.join(projectRoot, ".opencode", "generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, "ogb-doctor.json"), "legacy", "utf8");
  fs.writeFileSync(path.join(generatedDir, "agentx-doctor.json"), "current", "utf8");

  const report = migrateFromOgb({ homeDir, projectRoot });

  assert.equal(report.status, "migrated");
  assert.equal(report.warnings.length, 1);
  assert.equal(fs.readFileSync(path.join(generatedDir, "agentx-doctor.json"), "utf8"), "current");
  assert.equal(fs.existsSync(path.join(generatedDir, "ogb-doctor.json")), true);
});
