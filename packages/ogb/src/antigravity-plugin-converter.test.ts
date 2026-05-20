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
