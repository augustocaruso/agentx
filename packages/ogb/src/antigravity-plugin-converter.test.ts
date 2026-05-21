import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { convertGeminiCommandToAntigravitySkill } from "./antigravity-plugin-converter.js";

test("Antigravity converter renders nested Gemini command skills natively", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-converter-"));
  const extensionDir = path.join(root, "medical-notes-workbench");
  const commandPath = path.join(extensionDir, "commands", "mednotes", "fix-wiki.toml");
  fs.mkdirSync(path.dirname(commandPath), { recursive: true });
  fs.writeFileSync(commandPath, `description = "Fix wiki"\nprompt = """Run ${"${extensionPath}"}${"${/}"}scripts${"${/}"}fix.py for {{args}}"""\n`, "utf8");

  const skill = convertGeminiCommandToAntigravitySkill({
    sourcePath: commandPath,
    sourceRelPath: "commands/mednotes/fix-wiki.toml",
    extensionName: "medical-notes-workbench",
    extensionDir,
  });

  assert.equal(skill.slug, "mednotes-fix-wiki");
  assert.equal(skill.publicName, "mednotes:fix-wiki");
  assert.match(skill.markdown, /^name: "mednotes:fix-wiki"/m);
  assert.match(skill.markdown, /# \/mednotes:fix-wiki/);
  assert.match(skill.markdown, /\$ARGUMENTS/);
  assert.match(skill.markdown, new RegExp(path.join(extensionDir, "scripts", "fix.py").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Antigravity converter falls back from python3 to python", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-python-fallback-"));
  const binDir = path.join(root, "bin");
  const converter = path.join(root, "converter.py");
  const commandPath = path.join(root, "commands", "research.toml");
  const marker = path.join(root, "python-called");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.dirname(commandPath), { recursive: true });
  fs.writeFileSync(converter, "# fake converter\n", "utf8");
  fs.writeFileSync(commandPath, "description = \"Research\"\nprompt = \"Research {{args}}\"\n", "utf8");
  fs.writeFileSync(path.join(binDir, "python"), `#!/bin/sh\necho python > "${marker}"\nprintf '%s\\n' '{"slug":"research","publicName":"research","description":"Research","markdown":"name: research","warnings":[]}'\n`, { mode: 0o755 });

  const previousPath = process.env.PATH;
  const previousConverter = process.env.OGB_ANTIGRAVITY_CONVERTER;
  const previousPython = process.env.OGB_PYTHON_BIN;
  process.env.PATH = binDir;
  process.env.OGB_ANTIGRAVITY_CONVERTER = converter;
  delete process.env.OGB_PYTHON_BIN;
  try {
    const skill = convertGeminiCommandToAntigravitySkill({
      sourcePath: commandPath,
      sourceRelPath: "commands/research.toml",
    });

    assert.equal(skill.slug, "research");
    assert.equal(fs.readFileSync(marker, "utf8").trim(), "python");
  } finally {
    process.env.PATH = previousPath;
    if (previousConverter === undefined) delete process.env.OGB_ANTIGRAVITY_CONVERTER;
    else process.env.OGB_ANTIGRAVITY_CONVERTER = previousConverter;
    if (previousPython === undefined) delete process.env.OGB_PYTHON_BIN;
    else process.env.OGB_PYTHON_BIN = previousPython;
  }
});

test("Antigravity converter prefers the bundled Python converter when Python is available", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-bundled-python-"));
  const python = path.join(root, "python");
  const marker = path.join(root, "python-args.json");
  const commandPath = path.join(root, "commands", "shared.toml");
  fs.mkdirSync(path.dirname(commandPath), { recursive: true });
  fs.writeFileSync(commandPath, "description = \"Shared\"\nprompt = \"Shared {{args}}\"\n", "utf8");
  fs.writeFileSync(python, `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({
  slug: "from-python",
  publicName: "from-python",
  description: "Shared",
  markdown: "name: from-python",
  warnings: []
}) + "\\n");
`, { mode: 0o755 });

  const previousConverter = process.env.OGB_ANTIGRAVITY_CONVERTER;
  const previousPython = process.env.OGB_PYTHON_BIN;
  delete process.env.OGB_ANTIGRAVITY_CONVERTER;
  process.env.OGB_PYTHON_BIN = python;
  try {
    const skill = convertGeminiCommandToAntigravitySkill({
      sourcePath: commandPath,
      sourceRelPath: "commands/shared.toml",
    });
    const args = JSON.parse(fs.readFileSync(marker, "utf8")) as string[];

    assert.equal(skill.slug, "from-python");
    assert.ok(args.some((arg) => arg.endsWith("scripts/gemini_antigravity_converter.py")));
    assert.ok(args.includes("render-command-skill"));
  } finally {
    if (previousConverter === undefined) delete process.env.OGB_ANTIGRAVITY_CONVERTER;
    else process.env.OGB_ANTIGRAVITY_CONVERTER = previousConverter;
    if (previousPython === undefined) delete process.env.OGB_PYTHON_BIN;
    else process.env.OGB_PYTHON_BIN = previousPython;
  }
});

test("Antigravity converter uses native renderer by default even when python is on PATH", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-native-default-"));
  const binDir = path.join(root, "bin");
  const marker = path.join(root, "python-called");
  const commandPath = path.join(root, "commands", "shared.toml");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.dirname(commandPath), { recursive: true });
  fs.writeFileSync(commandPath, "description = \"Shared\"\nprompt = \"Shared {{args}}\"\n", "utf8");
  fs.writeFileSync(path.join(binDir, "python3"), `#!/bin/sh\necho called > "${marker}"\nprintf '%s\\n' '{"slug":"from-python","publicName":"from-python","description":"Shared","markdown":"name: from-python","warnings":[]}'\n`, { mode: 0o755 });

  const previousPath = process.env.PATH;
  const previousConverter = process.env.OGB_ANTIGRAVITY_CONVERTER;
  const previousPython = process.env.OGB_PYTHON_BIN;
  process.env.PATH = binDir;
  delete process.env.OGB_ANTIGRAVITY_CONVERTER;
  delete process.env.OGB_PYTHON_BIN;
  try {
    const skill = convertGeminiCommandToAntigravitySkill({
      sourcePath: commandPath,
      sourceRelPath: "commands/shared.toml",
    });

    assert.equal(skill.slug, "shared");
    assert.equal(fs.existsSync(marker), false);
  } finally {
    process.env.PATH = previousPath;
    if (previousConverter === undefined) delete process.env.OGB_ANTIGRAVITY_CONVERTER;
    else process.env.OGB_ANTIGRAVITY_CONVERTER = previousConverter;
    if (previousPython === undefined) delete process.env.OGB_PYTHON_BIN;
    else process.env.OGB_PYTHON_BIN = previousPython;
  }
});

test("Antigravity converter does not require Python at runtime", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-no-python-"));
  const extensionDir = path.join(root, "honcho");
  const commandPath = path.join(extensionDir, "commands", "honcho", "plan.md");
  fs.mkdirSync(path.dirname(commandPath), { recursive: true });
  fs.writeFileSync(commandPath, `---\ndescription: "Plan with Honcho"\n---\nRun honcho with {{args}}\n`, "utf8");

  const previousPath = process.env.PATH;
  const previousConverter = process.env.OGB_ANTIGRAVITY_CONVERTER;
  const previousPython = process.env.OGB_PYTHON_BIN;
  process.env.PATH = "";
  delete process.env.OGB_ANTIGRAVITY_CONVERTER;
  delete process.env.OGB_PYTHON_BIN;
  try {
    const skill = convertGeminiCommandToAntigravitySkill({
      sourcePath: commandPath,
      sourceRelPath: "commands/honcho/plan.md",
      extensionName: "honcho",
      extensionDir,
    });

    assert.equal(skill.slug, "honcho-plan");
    assert.equal(skill.publicName, "honcho:plan");
    assert.equal(skill.description, "Plan with Honcho");
    assert.match(skill.markdown, /\$ARGUMENTS/);
  } finally {
    process.env.PATH = previousPath;
    if (previousConverter === undefined) delete process.env.OGB_ANTIGRAVITY_CONVERTER;
    else process.env.OGB_ANTIGRAVITY_CONVERTER = previousConverter;
    if (previousPython === undefined) delete process.env.OGB_PYTHON_BIN;
    else process.env.OGB_PYTHON_BIN = previousPython;
  }
});
