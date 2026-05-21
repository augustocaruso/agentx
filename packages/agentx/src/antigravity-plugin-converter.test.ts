import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  convertGeminiCommandToAntigravitySkill,
  convertGeminiExtensionToAntigravityPlugin,
  isMissingPythonCommandResult,
} from "./antigravity-plugin-converter.js";

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

function bundledConverterPath(): string {
  return path.resolve("scripts", "gemini_antigravity_converter.py");
}

function availablePython(): string | undefined {
  for (const command of ["python3", "python"]) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8" });
    if (!result.error && result.status === 0) return command;
  }
  return undefined;
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
  assert.equal(
    isMissingPythonCommandResult(
      "python3",
      {
        error: undefined,
        status: 9009,
        stdout: "Python was not found; run without arguments to install from the Microsoft Store.",
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

test("Antigravity converter exposes full Gemini extension to Antigravity plugin conversion", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-plugin-wrapper-"));
  const binDir = path.join(root, "bin");
  const marker = path.join(root, "python-args.json");
  const sourceDir = path.join(root, "extension");
  const outputDir = path.join(root, "plugin");
  fs.mkdirSync(sourceDir, { recursive: true });
  const python = writeFakePythonCommand(
    binDir,
    "python",
    {
      schema: "agentx.gemini-antigravity-converter.v1",
      status: "converted",
      pluginName: "study-pack",
      sourceDir,
      pluginDir: outputDir,
      counts: { commandSkills: 2, hooks: 2, mcpServers: 1, agents: 1, skills: 3, inventory: 9 },
      warnings: [],
      inventory: [{ source: "GEMINI.md", kind: "instruction", destination: "rules/study-pack.md", status: "migrated", note: "ok" }],
    } as unknown as AntigravityPayload,
    { argsMarker: marker },
  );

  const previousConverter = process.env.AGENTX_ANTIGRAVITY_CONVERTER;
  const previousPython = process.env.AGENTX_PYTHON_BIN;
  delete process.env.AGENTX_ANTIGRAVITY_CONVERTER;
  process.env.AGENTX_PYTHON_BIN = python;
  try {
    const result = convertGeminiExtensionToAntigravityPlugin({
      sourceDir,
      outputDir,
      pluginName: "study-pack",
    });
    const args = JSON.parse(fs.readFileSync(marker, "utf8")) as string[];

    assert.equal(result.pluginName, "study-pack");
    assert.equal(result.counts.hooks, 2);
    assert.equal(result.counts.mcpServers, 1);
    assert.equal(result.inventory[0]?.destination, "rules/study-pack.md");
    assert.ok(args.some((arg) => arg.replace(/\\/g, "/").endsWith("scripts/gemini_antigravity_converter.py")));
    assert.ok(args.includes("convert-extension-plugin"));
    assert.ok(args.includes("--source-dir"));
    assert.ok(args.includes(sourceDir));
    assert.ok(args.includes("--output-dir"));
    assert.ok(args.includes(outputDir));
  } finally {
    if (previousConverter === undefined) delete process.env.AGENTX_ANTIGRAVITY_CONVERTER;
    else process.env.AGENTX_ANTIGRAVITY_CONVERTER = previousConverter;
    if (previousPython === undefined) delete process.env.AGENTX_PYTHON_BIN;
    else process.env.AGENTX_PYTHON_BIN = previousPython;
  }
});

test("bundled shared converter builds a complete Antigravity plugin", (context) => {
  const python = availablePython();
  if (!python) {
    context.skip("Python unavailable");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-antigravity-plugin-real-"));
  const sourceDir = path.join(root, "extension");
  const outputDir = path.join(root, "plugin");
  fs.mkdirSync(path.join(sourceDir, "commands", "study"), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, "agents"), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, "skills", "native-skill"), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, "src"), { recursive: true });
  const fakeNotionToken = `ntn_${"a".repeat(32)}`;
  fs.writeFileSync(path.join(sourceDir, "gemini-extension.json"), JSON.stringify({
    name: "study-pack",
    mcpServers: {
      notion: {
        command: "node",
        args: ["${extensionPath}${/}src${/}mcp-server.js"],
        env: {
          OPENAPI_MCP_HEADERS: "$OPENAPI_MCP_HEADERS",
          NOTION_TOKEN: fakeNotionToken,
        },
      },
    },
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(sourceDir, "GEMINI.md"), "Use ${extensionPath} as root; fallback ~/.gemini/extensions/study-pack.\n", "utf8");
  fs.writeFileSync(path.join(sourceDir, "README.md"), "Gemini CLI extension README\n\ngemini extensions validate dist/gemini-cli-extension\n", "utf8");
  fs.writeFileSync(path.join(sourceDir, "commands", "study", "review.toml"), "description = \"Review\"\nprompt = \"Review {{args}} with ${extensionPath}${/}docs and run uv run python scripts/study.py --config ~/.gemini/medical-notes-workbench/config.toml; run gemini extensions config study-pack STUDY_TOKEN if needed\"\n", "utf8");
  fs.writeFileSync(path.join(sourceDir, "agents", "helper.md"), "---\nname: helper\ndescription: Helper\nmodel: gemini-3-flash-preview\n---\nUse ${extensionPath}.\n", "utf8");
  fs.writeFileSync(path.join(sourceDir, "hooks", "hooks.json"), JSON.stringify({
    hooks: {
      BeforeTool: [{ matcher: "Bash", hooks: [{ type: "command", command: "node ${extensionPath}${/}scripts/hook.mjs" }] }],
      AfterTool: [{ matcher: "Bash", hooks: [{ type: "command", command: "node ${extensionPath}${/}scripts/after.mjs" }] }],
      BeforeAgent: [{ hooks: [{ type: "command", command: "node ${extensionPath}${/}scripts/before-agent.mjs" }] }],
    },
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(sourceDir, "skills", "native-skill", "SKILL.md"), "---\nname: native-skill\ndescription: Native\n---\nUse ${extensionPath}.\n", "utf8");
  fs.writeFileSync(path.join(sourceDir, "scripts", "hook.mjs"), "console.log('${extensionPath}');\n", "utf8");
  fs.mkdirSync(path.join(sourceDir, "scripts", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "scripts", "hooks", "runtime.mjs"), "console.log('${extensionPath}');\n", "utf8");
  fs.writeFileSync(path.join(sourceDir, "src", "mcp-server.js"), "console.log('${extensionPath}');\n", "utf8");

  const result = spawnSync(python, [
    bundledConverterPath(),
    "convert-extension-plugin",
    "--source-dir",
    sourceDir,
    "--output-dir",
    outputDir,
    "--json",
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const payload = JSON.parse(result.stdout) as { counts: Record<string, number>; warnings: string[] };
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, "plugin.json"), "utf8"));
  const mcp = JSON.parse(fs.readFileSync(path.join(outputDir, "mcp_config.json"), "utf8"));
  const hooks = JSON.parse(fs.readFileSync(path.join(outputDir, "hooks.json"), "utf8"));
  const commandSkill = fs.readFileSync(path.join(outputDir, "skills", "study-review", "SKILL.md"), "utf8");
  const copiedSkill = fs.readFileSync(path.join(outputDir, "skills", "native-skill", "SKILL.md"), "utf8");
  const agent = fs.readFileSync(path.join(outputDir, "agents", "helper.md"), "utf8");
  const readme = fs.readFileSync(path.join(outputDir, "README.md"), "utf8");
  const script = fs.readFileSync(path.join(outputDir, "scripts", "hook.mjs"), "utf8");
  const hookRuntime = fs.readFileSync(path.join(outputDir, "scripts", "hooks", "runtime.mjs"), "utf8");
  const server = fs.readFileSync(path.join(outputDir, "src", "mcp-server.js"), "utf8");
  const rules = fs.readFileSync(path.join(outputDir, "rules", "study-pack.md"), "utf8");
  const notes = fs.readFileSync(path.join(outputDir, "MIGRATION_NOTES.md"), "utf8");
  const mcpText = fs.readFileSync(path.join(outputDir, "mcp_config.json"), "utf8");

  assert.deepEqual(manifest, { name: "study-pack" });
  assert.deepEqual(mcp.mcpServers.notion.command, "node");
  assert.deepEqual(mcp.mcpServers.notion.args, [`.${path.sep}src${path.sep}mcp-server.js`]);
  assert.deepEqual(mcp.mcpServers.notion.env, {
    NOTION_TOKEN: "{env:NOTION_TOKEN}",
    OPENAPI_MCP_HEADERS: "{env:OPENAPI_MCP_HEADERS}",
  });
  assert.equal(mcpText.includes(fakeNotionToken), false);
  assert.equal(payload.counts.commandSkills, 1);
  assert.equal(payload.counts.mcpServers, 1);
  assert.equal(payload.counts.agents, 1);
  assert.ok(payload.warnings.some((warning) => warning.includes("NOTION_TOKEN")));
  assert.equal(hooks["study-pack-hooks"].PreToolUse.length, 1);
  assert.equal(hooks["study-pack-hooks"].PostToolUse.length, 1);
  assert.ok(payload.warnings.some((warning) => warning.includes("BeforeAgent")));
  assert.match(commandSkill, /SOURCE_KIND: gemini-antigravity-command-skill/);
  assert.match(commandSkill, /\$ARGUMENTS/);
  assert.doesNotMatch(commandSkill, /\{\{args\}\}/);
  assert.doesNotMatch(`${readme}\n${commandSkill}`, /gemini extensions /);
  assert.match(readme, /agy plugin validate/);
  assert.match(commandSkill, /configure STUDY_TOKEN in the Antigravity environment/);
  assert.match(commandSkill, /node "<plugin-root>\/scripts\/run_python\.mjs" scripts\/study\.py/);
  assert.doesNotMatch(commandSkill, /--config ~\/\.gemini\/medical-notes-workbench\/config\.toml/);
  assert.match(copiedSkill, /<plugin-root>/);
  assert.match(agent, /Gemini 3\.5 Flash \(High\)/);
  assert.match(agent, /Antigravity Plugin Root/);
  assert.match(script, /'\.'/);
  assert.match(hookRuntime, /'\.'/);
  assert.equal(fs.existsSync(path.join(outputDir, "hooks", "hooks.json")), false);
  assert.match(server, /'\.'/);
  assert.match(rules, /<plugin-root>/);
  assert.doesNotMatch(rules, /~\/\.gemini\/extensions/);
  assert.match(notes, /mcp_config\.json/);
  assert.doesNotMatch(`${mcpText}\n${script}\n${hookRuntime}\n${server}`, /\$\{extensionPath\}/);
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
