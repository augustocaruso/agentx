import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDoctor } from "./doctor.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-doctor-"));
}

test("runDoctor prints one warning line for duplicate skill names", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  for (const root of [path.join(projectRoot, ".opencode", "skills", "gemini-importer"), path.join(projectRoot, ".opencode", "skill", "gemini-importer")]) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "SKILL.md"), "---\nname: gemini-importer\n---\n", "utf8");
  }

  const report = runDoctor({ projectRoot, homeDir, silent: true });
  const duplicateWarnings = report.warnings.filter((warning) => warning.startsWith("Skill warning: gemini-importer - Duplicate name"));

  assert.equal(report.counts.skills.warning, 2);
  assert.equal(duplicateWarnings.length, 1);
  assert.match(duplicateWarnings[0], /\.opencode\/skills\/gemini-importer/);
  assert.match(duplicateWarnings[0], /\.opencode\/skill\/gemini-importer/);
});

test("runDoctor matches OpenCode plugins by package name across versions", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), JSON.stringify({
    externalPlugins: {
      autoFallback: {
        enabled: true,
        plugin: "opencode-auto-fallback@0.4.2",
      },
    },
  }, null, 2), "utf8");
  fs.mkdirSync(path.join(homeDir, ".config", "opencode", "plugins"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({
    plugin: ["opencode-auto-fallback@0.4.3"],
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(homeDir, ".config", "opencode", "plugins", "fallback.json"), JSON.stringify({
    enabled: true,
    agentFallbacks: {
      helper: ["openai/gpt-5.4-mini"],
    },
  }), "utf8");

  const report = runDoctor({ projectRoot, homeDir, silent: true });

  assert.equal(report.runtimeFallback.pluginActive, true);
  assert.equal(report.warnings.some((warning) => /opencode-auto-fallback.*plugin is not active/i.test(warning)), false);
});
