import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { convertGeminiCommandToAntigravitySkill, isMissingPythonCommandResult } from "./antigravity-plugin-converter.js";

function writeFakePythonCommand(
  binDir: string,
  commandName: string,
  payload: AntigravityPayload,
  options: { argsMarker?: string; marker?: string; markerValue?: string } = {},
): string {
  fs.mkdirSync(binDir, { recursive: true });
  const runner = path.join(binDir, `${commandName}-shim.cjs`);
  const commandPath = path.join(binDir, process.platform === "win32" ? `${commandName}.cmd` : commandName);
  const markerLine = options.marker ? `fs.writeFileSync(${JSON.stringify(options.marker)}, ${JSON.stringify(options.markerValue ?? "")});` : "";
  const argsLine = options.argsMarker ? `fs.writeFileSync(${JSON.stringify(options.argsMarker)}, JSON.stringify(process.argv.slice(2)));` : "";
  fs.writeFileSync(
    runner,
    `const fs = require("node:fs");
${markerLine}
${argsLine}
process.stdout.write(JSON.stringify(${JSON.stringify(payload)}) + "\\n");
`,
    "utf8",
  );
  if (process.platform === "win32") {
    fs.writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "${runner}" %*\r\n`, "utf8");
  } else {
    fs.writeFileSync(commandPath, `#!/bin/sh\nexec "${process.execPath}" "${runner}" "$@"\n`, { mode: 0o755 });
  }
  return commandPath;
}

interface AntigravityPayload {
  slug: string;
  publicName: string;
  description: string;
  markdown: string;
  warnings: string[];
}

test("Antigravity converter treats Windows cmd not-recognized output as a missing Python command", () => {
  assert.equal(
    isMissingPythonCommandResult(
      "python3",
      {
        error: undefined,
        status: 1,
        stderr: "'python3' is not recognized as an internal or external command,\r\noperable program or batch file.",
      },
      "win32",
    ),
    true,
  );
});

test("Antigravity converter uses bundled Python converter by default", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-default-python-"));
  const binDir = path.join(root, "bin");
  const marker = path.join(root, "python-called");
  const commandPath = path.join(root, "commands", "mednotes", "fix-wiki.toml");
  fs.mkdirSync(path.dirname(commandPath), { recursive: true });
  fs.writeFileSync(commandPath, "description = \"Fix wiki\"\nprompt = \"Fix {{args}}\"\n", "utf8");
  writeFakePythonCommand(
    binDir,
    "python3",
    { slug: "from-python", publicName: "from-python", description: "Fix wiki", markdown: "name: from-python", warnings: [] },
    { marker, markerValue: "called\n" },
  );

  const previousPath = process.env.PATH;
  const previousConverter = process.env.AGENTX_ANTIGRAVITY_CONVERTER;
  const previousPython = process.env.AGENTX_PYTHON_BIN;
  process.env.PATH = binDir;
  delete process.env.AGENTX_ANTIGRAVITY_CONVERTER;
  delete process.env.AGENTX_PYTHON_BIN;
  try {
    const skill = convertGeminiCommandToAntigravitySkill({
      sourcePath: commandPath,
      sourceRelPath: "commands/mednotes/fix-wiki.toml",
      extensionName: "medical-notes-workbench",
      extensionDir: root,
    });

    assert.equal(skill.slug, "from-python");
    assert.equal(fs.readFileSync(marker, "utf8").trim(), "called");
  } finally {
    process.env.PATH = previousPath;
    if (previousConverter === undefined) delete process.env.AGENTX_ANTIGRAVITY_CONVERTER;
    else process.env.AGENTX_ANTIGRAVITY_CONVERTER = previousConverter;
    if (previousPython === undefined) delete process.env.AGENTX_PYTHON_BIN;
    else process.env.AGENTX_PYTHON_BIN = previousPython;
  }
});

test("Antigravity converter falls back from python3 to python", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-python-fallback-"));
  const binDir = path.join(root, "bin");
  const converter = path.join(root, "converter.py");
  const commandPath = path.join(root, "commands", "research.toml");
  const marker = path.join(root, "python-called");
  fs.mkdirSync(path.dirname(commandPath), { recursive: true });
  fs.writeFileSync(converter, "# fake converter\n", "utf8");
  fs.writeFileSync(commandPath, "description = \"Research\"\nprompt = \"Research {{args}}\"\n", "utf8");
  writeFakePythonCommand(
    binDir,
    "python",
    { slug: "research", publicName: "research", description: "Research", markdown: "name: research", warnings: [] },
    { marker, markerValue: "python\n" },
  );

  const previousPath = process.env.PATH;
  const previousConverter = process.env.AGENTX_ANTIGRAVITY_CONVERTER;
  const previousPython = process.env.AGENTX_PYTHON_BIN;
  process.env.PATH = binDir;
  process.env.AGENTX_ANTIGRAVITY_CONVERTER = converter;
  delete process.env.AGENTX_PYTHON_BIN;
  try {
    const skill = convertGeminiCommandToAntigravitySkill({
      sourcePath: commandPath,
      sourceRelPath: "commands/research.toml",
    });

    assert.equal(skill.slug, "research");
    assert.equal(fs.readFileSync(marker, "utf8").trim(), "python");
  } finally {
    process.env.PATH = previousPath;
    if (previousConverter === undefined) delete process.env.AGENTX_ANTIGRAVITY_CONVERTER;
    else process.env.AGENTX_ANTIGRAVITY_CONVERTER = previousConverter;
    if (previousPython === undefined) delete process.env.AGENTX_PYTHON_BIN;
    else process.env.AGENTX_PYTHON_BIN = previousPython;
  }
});

test("Antigravity converter prefers the bundled Python converter when Python is available", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-bundled-python-"));
  const binDir = path.join(root, "bin");
  const marker = path.join(root, "python-args.json");
  const commandPath = path.join(root, "commands", "shared.toml");
  fs.mkdirSync(path.dirname(commandPath), { recursive: true });
  fs.writeFileSync(commandPath, "description = \"Shared\"\nprompt = \"Shared {{args}}\"\n", "utf8");
  const python = writeFakePythonCommand(
    binDir,
    "python",
    { slug: "from-python", publicName: "from-python", description: "Shared", markdown: "name: from-python", warnings: [] },
    { argsMarker: marker },
  );

  const previousConverter = process.env.AGENTX_ANTIGRAVITY_CONVERTER;
  const previousPython = process.env.AGENTX_PYTHON_BIN;
  delete process.env.AGENTX_ANTIGRAVITY_CONVERTER;
  process.env.AGENTX_PYTHON_BIN = python;
  try {
    const skill = convertGeminiCommandToAntigravitySkill({
      sourcePath: commandPath,
      sourceRelPath: "commands/shared.toml",
    });
    const args = JSON.parse(fs.readFileSync(marker, "utf8")) as string[];

    assert.equal(skill.slug, "from-python");
    assert.ok(args.some((arg) => arg.replace(/\\/g, "/").endsWith("scripts/gemini_antigravity_converter.py")));
    assert.ok(args.includes("render-command-skill"));
  } finally {
    if (previousConverter === undefined) delete process.env.AGENTX_ANTIGRAVITY_CONVERTER;
    else process.env.AGENTX_ANTIGRAVITY_CONVERTER = previousConverter;
    if (previousPython === undefined) delete process.env.AGENTX_PYTHON_BIN;
    else process.env.AGENTX_PYTHON_BIN = previousPython;
  }
});

test("Antigravity converter fails clearly when Python is unavailable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-no-python-"));
  const extensionDir = path.join(root, "honcho");
  const commandPath = path.join(extensionDir, "commands", "honcho", "plan.md");
  fs.mkdirSync(path.dirname(commandPath), { recursive: true });
  fs.writeFileSync(commandPath, `---\ndescription: "Plan with Honcho"\n---\nRun honcho with {{args}}\n`, "utf8");

  const previousPath = process.env.PATH;
  const previousConverter = process.env.AGENTX_ANTIGRAVITY_CONVERTER;
  const previousPython = process.env.AGENTX_PYTHON_BIN;
  process.env.PATH = "";
  delete process.env.AGENTX_ANTIGRAVITY_CONVERTER;
  delete process.env.AGENTX_PYTHON_BIN;
  try {
    assert.throws(
      () =>
        convertGeminiCommandToAntigravitySkill({
          sourcePath: commandPath,
          sourceRelPath: "commands/honcho/plan.md",
          extensionName: "honcho",
          extensionDir,
        }),
      /Antigravity converter failed: python not found on PATH/,
    );
  } finally {
    process.env.PATH = previousPath;
    if (previousConverter === undefined) delete process.env.AGENTX_ANTIGRAVITY_CONVERTER;
    else process.env.AGENTX_ANTIGRAVITY_CONVERTER = previousConverter;
    if (previousPython === undefined) delete process.env.AGENTX_PYTHON_BIN;
    else process.env.AGENTX_PYTHON_BIN = previousPython;
  }
});
