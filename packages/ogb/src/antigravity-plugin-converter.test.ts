import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { convertGeminiCommandToAntigravitySkill } from "./antigravity-plugin-converter.js";

test("Antigravity converter renders nested Gemini command skills through the Python source", () => {
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
