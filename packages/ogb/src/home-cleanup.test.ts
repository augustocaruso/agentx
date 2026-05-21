import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupHomeProjectArtifacts } from "./home-cleanup.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-clean-home-"));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test("cleanupHomeProjectArtifacts backs up and removes old home project files", () => {
  const homeDir = tempHome();
  const staleBackup = path.join(homeDir, ".config", "agentx", "backups", "home-cleanup", "2000-01-01T00-00-00-000Z");
  fs.mkdirSync(staleBackup, { recursive: true });
  fs.writeFileSync(path.join(staleBackup, "old.txt"), "old backup\n", "utf8");
  writeFile(path.join(homeDir, "opencode.jsonc"), JSON.stringify({
    instructions: [".opencode/generated/GEMINI.expanded.md"],
  }, null, 2));
  writeFile(path.join(homeDir, ".opencode", "generated", "agentx-sync-state.json"), JSON.stringify({
    managedFiles: [
      { path: ".opencode/commands/custom.md", sha256: "old", source: "ogb" },
      { path: ".opencode/skills/project-skill/SKILL.md", sha256: "old", source: "ogb" },
    ],
  }, null, 2));
  writeFile(path.join(homeDir, ".opencode", "commands", "sync.md"), "OGB sync\n");
  writeFile(path.join(homeDir, ".opencode", "commands", "custom.md"), "Custom projected command\n");
  writeFile(path.join(homeDir, ".opencode", "commands", ".DS_Store"), "finder metadata\n");
  writeFile(path.join(homeDir, ".opencode", "skills", "project-skill", "SKILL.md"), "Projected skill\n");
  writeFile(path.join(homeDir, ".opencode", "agents", "YOLO.md"), "YOLO\n");
  writeFile(path.join(homeDir, ".opencode", "bin", "opencode"), "keep me\n");
  writeFile(path.join(homeDir, ".opencode", "notes.txt"), "keep me too\n");

  const report = cleanupHomeProjectArtifacts({ homeDir });

  assert.ok(report.actions.some((action) => action.relPath === "opencode.jsonc" && action.status === "removed"));
  assert.ok(report.actions.some((action) => action.relPath === ".opencode/commands" && action.status === "removed"));
  assert.ok(report.actions.some((action) => action.relPath === ".opencode/skills" && action.status === "removed"));
  assert.equal(fs.existsSync(path.join(homeDir, "opencode.jsonc")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "commands", "sync.md")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "commands", "custom.md")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "commands")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "skills", "project-skill", "SKILL.md")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "skills")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "agents", "YOLO.md")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "bin", "opencode")), true);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "notes.txt")), true);
  assert.ok(report.backupDir);
  assert.ok(report.backupDir.startsWith(path.join(homeDir, ".config", "agentx", "backups", "home-cleanup")));
  assert.ok(report.backups.length > 0);
  assert.equal(fs.existsSync(path.join(report.backupDir!, "opencode.jsonc")), true);
  assert.equal(fs.existsSync(path.join(report.backupDir!, ".opencode", "commands", "custom.md")), true);
  assert.equal(fs.existsSync(staleBackup), false);
});

test("cleanupHomeProjectArtifacts removes nested global OpenCode config left by duplicate XDG paths", () => {
  const homeDir = tempHome();
  const nestedRoot = path.join(homeDir, ".config", "opencode", "opencode");
  writeFile(path.join(nestedRoot, "opencode.json"), JSON.stringify({
    instructions: [path.join(homeDir, ".config", "agentx", "generated", "GEMINI.expanded.md")],
  }, null, 2));
  writeFile(path.join(nestedRoot, "skills", "obsidian-ops", "SKILL.md"), "# Obsidian ops\n");

  const report = cleanupHomeProjectArtifacts({ homeDir });

  assert.ok(report.actions.some((action) => action.relPath === ".config/opencode/opencode" && action.status === "removed"));
  assert.equal(fs.existsSync(nestedRoot), false);
  assert.ok(report.backupDir);
  assert.equal(fs.existsSync(path.join(report.backupDir!, ".config", "opencode", "opencode", "opencode.json")), true);
});

test("cleanupHomeProjectArtifacts removes old home .opencode symlink directories without deleting their target", (t) => {
  const homeDir = tempHome();
  const globalAgents = path.join(homeDir, ".config", "opencode", "agents");
  const legacyAgents = path.join(homeDir, ".opencode", "agents");
  writeFile(path.join(globalAgents, "YOLO.md"), "global agent\n");
  fs.mkdirSync(path.dirname(legacyAgents), { recursive: true });
  try {
    fs.symlinkSync(globalAgents, legacyAgents, "dir");
  } catch (error) {
    t.skip(`symlink creation is not available in this test environment: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const report = cleanupHomeProjectArtifacts({ homeDir });
  const action = report.actions.find((item) => item.relPath === ".opencode/agents");

  assert.equal(action?.status, "removed");
  assert.equal(fs.existsSync(legacyAgents), false);
  assert.equal(fs.existsSync(path.join(globalAgents, "YOLO.md")), true);
  assert.ok(action?.backup?.endsWith(".symlink.txt"));
  assert.equal(fs.readFileSync(action.backup, "utf8").trim(), globalAgents);
});

test("cleanupHomeProjectArtifacts dry-run leaves files in place", () => {
  const homeDir = tempHome();
  writeFile(path.join(homeDir, "opencode.jsonc"), JSON.stringify({
    instructions: [".opencode/generated/GEMINI.expanded.md"],
  }, null, 2));

  const report = cleanupHomeProjectArtifacts({ homeDir, dryRun: true });

  assert.ok(report.actions.some((action) => action.relPath === "opencode.jsonc" && action.status === "preview"));
  assert.equal(fs.existsSync(path.join(homeDir, "opencode.jsonc")), true);
  assert.ok(report.backupDir);
  assert.equal(report.backups[0]?.dryRun, true);
  assert.equal(fs.existsSync(report.actions.find((action) => action.relPath === "opencode.jsonc")?.backup ?? ""), false);
});
