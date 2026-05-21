import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDoctor } from "./doctor.js";
import { STARTUP_SYNC_PLUGIN_SOURCE } from "./setup-opencode.js";
import { globalStartupPluginSpec, LEGACY_GLOBAL_STARTUP_PLUGIN_SPEC } from "./setup-ux.js";
import { syncToOpenCode } from "./sync.js";
import { TUI_SIDEBAR_PLUGIN_SOURCE, TUI_SIDEBAR_PLUGIN_SPEC } from "./tui-sidebar.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-doctor-"));
}

function writeFakeOpenCode(binDir: string, body: string): string {
  fs.mkdirSync(binDir, { recursive: true });
  const runner = path.join(binDir, "opencode-runner.cjs");
  fs.writeFileSync(runner, `#!/usr/bin/env node\n${body}\n`, "utf8");
  fs.chmodSync(runner, 0o755);

  const command = path.join(binDir, "opencode");
  fs.writeFileSync(command, `#!/usr/bin/env sh\nexec "${process.execPath}" "${runner}" "$@"\n`, "utf8");
  fs.chmodSync(command, 0o755);
  fs.writeFileSync(path.join(binDir, "opencode.cmd"), `@echo off\r\n"${process.execPath}" "${runner}" %*\r\n`, "utf8");
  return command;
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
  assert.match(duplicateWarnings[0], /\.opencode[/\\]skills[/\\]gemini-importer/);
  assert.match(duplicateWarnings[0], /\.opencode[/\\]skill[/\\]gemini-importer/);
});

test("runDoctor ignores identical project/global OpenCode skill copies", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  const skillText = "---\nname: shared-skill\n---\n";
  for (const root of [
    path.join(projectRoot, ".opencode", "skills", "shared-skill"),
    path.join(homeDir, ".config", "opencode", "skills", "shared-skill"),
  ]) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "SKILL.md"), skillText, "utf8");
  }

  const report = runDoctor({ projectRoot, homeDir, silent: true });

  assert.equal(report.warnings.some((warning) => warning.includes("shared-skill")), false);
});

test("runDoctor counts OpenCode skills without double-counting Gemini sources in home mode", () => {
  const homeDir = tempRoot();
  for (const root of [
    path.join(homeDir, ".gemini", "skills", "projected"),
    path.join(homeDir, ".config", "opencode", "skills", "projected"),
    path.join(homeDir, ".config", "opencode", "skills", "opencode-only"),
    path.join(homeDir, ".opencode", "skills", "legacy-home-project"),
  ]) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "SKILL.md"), "---\nname: skill\n---\n", "utf8");
  }

  const report = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(report.counts.skills.ok, 2);
  assert.equal(report.warnings.some((warning) => warning.includes("legacy-home-project")), false);
});

test("runDoctor honors the OpenCode model lookup timeout environment", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  const binDir = path.join(tempRoot(), "bin");
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "agentx-model-routing.json"), JSON.stringify({
    decisions: [
      {
        chain: [
          { providerId: "openai", model: "gpt-slow" },
        ],
      },
    ],
  }, null, 2), "utf8");
  writeFakeOpenCode(binDir, `
    if (process.argv[2] === "models") {
      setTimeout(() => {
        console.log("openai/gpt-slow");
      }, 250);
    }
  `);
  const previousPath = process.env.PATH;
  const previousTimeout = process.env.OGB_OPENCODE_MODELS_TIMEOUT_MS;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
  process.env.OGB_OPENCODE_MODELS_TIMEOUT_MS = "1";
  try {
    const report = runDoctor({ projectRoot, homeDir, silent: true });

    assert.equal(report.modelResolution.checked, false);
    assert.equal(report.modelResolution.referencedModels, 1);
    assert.match(report.modelResolution.message, /timed out|ETIMEDOUT|timeout/i);
  } finally {
    process.env.PATH = previousPath;
    if (previousTimeout === undefined) delete process.env.OGB_OPENCODE_MODELS_TIMEOUT_MS;
    else process.env.OGB_OPENCODE_MODELS_TIMEOUT_MS = previousTimeout;
  }
});

test("runDoctor matches OpenCode plugins by package name across versions", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "agentx.config.jsonc"), JSON.stringify({
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

test("runDoctor checks global OpenCode instructions when project root is home", () => {
  const homeDir = tempRoot();
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "GEMINI.md"), "Global rules\n", "utf8");

  const before = runDoctor({ projectRoot: homeDir, homeDir, silent: true });
  assert.ok(before.warnings.some((warning) => warning.includes("Missing global expanded Gemini context")));

  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });
  const after = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(after.opencodeConfig.path, path.join(homeDir, ".config", "opencode", "opencode.json"));
  assert.equal(after.opencodeConfig.referencesExpandedGemini, true);
  assert.equal(after.warnings.some((warning) => warning.includes("Global OpenCode config does not reference")), false);
  assert.equal(after.warnings.some((warning) => warning.includes("Missing global expanded Gemini context")), false);
});

test("runDoctor treats the global extension map as review inventory, not permanent extension warnings", () => {
  const homeDir = tempRoot();
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(path.join(extensionDir, "commands"), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "GEMINI.md"), "Extension rules\n", "utf8");
  fs.writeFileSync(path.join(extensionDir, "commands", "review.toml"), "description = \"Review\"\nprompt = \"Review: {{args}}\"\n", "utf8");
  fs.writeFileSync(path.join(extensionDir, "hooks", "hooks.json"), "{}\n", "utf8");

  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });
  const report = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(report.extensionCompatibility.mapExists, true);
  assert.equal(report.extensionCompatibility.extensions, 1);
  assert.equal(report.extensionCompatibility.hooks, 1);
  assert.equal(report.warnings.some((warning) => warning.startsWith("Extension needs review:")), false);
  assert.equal(report.warnings.some((warning) => warning.includes("Missing gemini-extension.json")), false);
});

test("runDoctor treats BeforeAgent hooks as compatible projection without trust opt-in", () => {
  const projectRoot = tempRoot();
  fs.mkdirSync(path.join(projectRoot, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    hooks: {
      BeforeAgent: [{ command: "echo before-agent" }],
    },
  }, null, 2), "utf8");

  const report = runDoctor({ projectRoot, homeDir: projectRoot, silent: true });

  assert.equal(report.warnings.some((warning) => warning.startsWith("Hook needs review: BeforeAgent")), false);
});

test("runDoctor reports native capability decisions from sync", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  const binDir = path.join(tempRoot(), "bin");
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "superpowers");
  const skillDir = path.join(extensionDir, "skills", "superpowers");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "superpowers" }), "utf8");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: superpowers\n---\n# Superpowers\n", "utf8");
  writeFakeOpenCode(binDir, `
    if (process.argv[2] === "debug" && process.argv[3] === "info") {
      console.log("superpowers plugin loaded");
      process.exit(0);
    }
  `);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
  try {
    syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
    const report = runDoctor({ projectRoot, homeDir, silent: true });

    assert.equal(report.nativeCapabilities.reportExists, true);
    assert.equal(report.nativeCapabilities.validatedNative.includes("superpowers"), true);
    assert.equal(report.nativeCapabilities.fallbackCompat.includes("superpowers"), false);
    assert.equal(report.warnings.some((warning) => /Native capability.*missing/i.test(warning)), false);
  } finally {
    process.env.PATH = previousPath;
  }
});

test("runDoctor reports native setup projections replicated to hosts without native setup", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  const binDir = path.join(tempRoot(), "bin");
  fs.writeFileSync(path.join(projectRoot, "opencode.jsonc"), JSON.stringify({
    plugin: ["@honcho-ai/opencode-honcho"],
  }, null, 2), "utf8");
  writeFakeOpenCode(binDir, `
    if (process.argv[2] === "debug" && process.argv[3] === "info") {
      console.log("honcho plugin loaded");
      process.exit(0);
    }
  `);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
  try {
    syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
    const report = runDoctor({ projectRoot, homeDir, silent: true });

    assert.deepEqual(report.nativeCapabilities.setupCompatibilityProjections.map((projection) => projection.path).sort(), [
      ".gemini/antigravity/skills/honcho-setup/SKILL.md",
      ".gemini/skills/honcho-setup/SKILL.md",
    ]);
    assert.deepEqual(report.nativeCapabilities.setupCompatibilityProjections.map((projection) => projection.target).sort(), [
      "antigravity",
      "gemini",
    ]);
    assert.equal(report.nativeCapabilities.setupCompatibilityProjections.every((projection) => projection.entityId === "honcho"), true);
    assert.equal(report.nativeCapabilities.setupCompatibilityProjections.every((projection) => projection.status === "active"), true);
  } finally {
    process.env.PATH = previousPath;
  }
});

test("runDoctor marks preserved setup projections stale when the native setup source is no longer validated", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  const binDir = path.join(tempRoot(), "bin");
  const projectConfigPath = path.join(projectRoot, "opencode.jsonc");
  fs.writeFileSync(projectConfigPath, JSON.stringify({
    plugin: ["@honcho-ai/opencode-honcho"],
  }, null, 2), "utf8");
  writeFakeOpenCode(binDir, `
    if (process.argv[2] === "debug" && process.argv[3] === "info") {
      console.log("honcho plugin loaded");
      process.exit(0);
    }
  `);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
  try {
    syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
    const geminiSetupSkill = path.join(homeDir, ".gemini", "skills", "honcho-setup", "SKILL.md");
    fs.appendFileSync(geminiSetupSkill, "\nManual local setup note.\n", "utf8");
    fs.writeFileSync(projectConfigPath, JSON.stringify({ plugin: [] }, null, 2), "utf8");
    syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });

    const report = runDoctor({ projectRoot, homeDir, silent: true });
    const staleProjection = report.nativeCapabilities.setupCompatibilityProjections.find((projection) =>
      projection.path === ".gemini/skills/honcho-setup/SKILL.md"
    );

    assert.equal(staleProjection?.status, "stale");
    assert.equal(report.warnings.some((warning) =>
      warning.includes("honcho")
      && warning.includes("setup projection")
      && warning.includes("no validated native source")
    ), true);
  } finally {
    process.env.PATH = previousPath;
  }
});

test("runDoctor recovers stale global startup sync status when project root is home", () => {
  const homeDir = tempRoot();
  const generatedDir = path.join(homeDir, ".config", "agentx", "generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, "agentx-plugin-status.json"), JSON.stringify({
    version: 1,
    state: "running",
    reason: "plugin.init",
    pid: 99999999,
    startedAt: "2026-05-06T12:00:00.000Z",
    command: "ogb",
    args: ["--project", homeDir, "sync"],
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(generatedDir, "agentx-startup-sync.lock"), JSON.stringify({
    pid: 99999999,
    startedAt: "2026-05-06T12:00:00.000Z",
  }) + "\n", "utf8");

  runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  const status = JSON.parse(fs.readFileSync(path.join(generatedDir, "agentx-plugin-status.json"), "utf8"));
  assert.equal(status.state, "pass");
  assert.equal(status.reason, "doctor.recovered-stale");
  assert.equal(fs.existsSync(path.join(generatedDir, "agentx-startup-sync.lock")), false);
});

test("runDoctor warns when global TUI plugin runtime dependencies are missing", () => {
  const homeDir = tempRoot();
  const configDir = path.join(homeDir, ".config", "opencode");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "tui.json"), JSON.stringify({
    plugin: [TUI_SIDEBAR_PLUGIN_SPEC],
  }, null, 2), "utf8");

  const report = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(report.warnings.some((warning) =>
    warning.includes("Global OGB TUI runtime dependencies are missing")
    && warning.includes("@opentui/solid@0.2.2")
    && warning.includes("solid-js@1.9.12")
  ), true);
});

test("runDoctor warns when the global TUI sidebar plugin is stale", () => {
  const homeDir = tempRoot();
  const configDir = path.join(homeDir, ".config", "opencode");
  const pluginPath = path.join(configDir, "tui-plugins", "ogb-sidebar.js");
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(path.join(configDir, "tui.json"), JSON.stringify({
    plugin: [TUI_SIDEBAR_PLUGIN_SPEC],
  }, null, 2), "utf8");
  fs.writeFileSync(pluginPath, `${TUI_SIDEBAR_PLUGIN_SOURCE}\n// old local copy\n`, "utf8");

  const report = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(report.warnings.some((warning) =>
    warning.includes("Global OGB TUI sidebar plugin is stale")
    && warning.includes("agentx check")
    && warning.includes("repair it automatically")
    && warning.includes("restart OpenCode")
  ), true);
});

test("runDoctor warns when the global startup plugin is stale", () => {
  const homeDir = tempRoot();
  const configDir = path.join(homeDir, ".config", "opencode");
  const pluginPath = path.join(configDir, "plugins", "ogb-startup-sync.js");
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    plugin: [globalStartupPluginSpec(pluginPath)],
  }, null, 2), "utf8");
  fs.writeFileSync(pluginPath, `${STARTUP_SYNC_PLUGIN_SOURCE}\n// old local copy\n`, "utf8");

  const report = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(report.warnings.some((warning) =>
    warning.includes("Global OGB startup plugin is stale")
    && warning.includes("agentx check")
    && warning.includes("repair it automatically")
    && warning.includes("restart OpenCode")
  ), true);
});

test("runDoctor warns when global config still has the legacy relative startup plugin spec", () => {
  const homeDir = tempRoot();
  const configDir = path.join(homeDir, ".config", "opencode");
  const pluginPath = path.join(configDir, "plugins", "ogb-startup-sync.js");
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    plugin: [
      globalStartupPluginSpec(pluginPath),
      LEGACY_GLOBAL_STARTUP_PLUGIN_SPEC,
    ],
  }, null, 2), "utf8");
  fs.writeFileSync(pluginPath, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");

  const report = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(report.warnings.some((warning) =>
    warning.includes("legacy OGB startup plugin")
    && warning.includes(LEGACY_GLOBAL_STARTUP_PLUGIN_SPEC)
    && warning.includes("ogb setup-ux --force")
  ), true);
});

test("runDoctor reports OpenCode MCP entries written with Gemini shape", () => {
  const homeDir = tempRoot();
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      notion: {
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        env: {
          OPENAPI_MCP_HEADERS: "$OPENAPI_MCP_HEADERS",
        },
      },
    },
  }, null, 2), "utf8");
  fs.mkdirSync(path.join(homeDir, ".config", "opencode"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({
    mcp: {
      notion: {
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        env: {
          OPENAPI_MCP_HEADERS: "$OPENAPI_MCP_HEADERS",
        },
        enabled: true,
      },
    },
  }, null, 2), "utf8");

  const report = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.ok(report.warnings.some((warning) => warning.includes("notion.env uses Gemini shape")));
  assert.ok(report.warnings.some((warning) => warning.includes("notion.args uses Gemini shape")));
  assert.ok(report.warnings.some((warning) => warning.includes("notion.command must be an array")));
  assert.ok(report.warnings.some((warning) => warning.includes("notion.type is missing")));
  assert.ok(report.warnings.some((warning) => warning.includes("notion.environment is missing Gemini env key(s): OPENAPI_MCP_HEADERS")));
});

test("runDoctor reports sensitive OpenCode MCP env references missing from the OGB env store", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  const fakeNotionToken = "ntn_" + "c".repeat(32);
  const originalHeaders = process.env.OPENAPI_MCP_HEADERS;
  delete process.env.OPENAPI_MCP_HEADERS;
  try {
    fs.mkdirSync(path.join(projectRoot, ".gemini"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
      mcpServers: {
        notion: {
          command: "npx",
          args: ["-y", "@notionhq/notion-mcp-server"],
          env: {
            OPENAPI_MCP_HEADERS: `{"Authorization":"Bearer ${fakeNotionToken}","Notion-Version":"2022-06-28"}`,
          },
        },
      },
    }, null, 2), "utf8");
    fs.writeFileSync(path.join(projectRoot, "opencode.jsonc"), JSON.stringify({
      mcp: {
        notion: {
          type: "local",
          command: ["npx", "-y", "@notionhq/notion-mcp-server"],
          enabled: true,
          environment: {
            OPENAPI_MCP_HEADERS: "{env:OPENAPI_MCP_HEADERS}",
          },
        },
      },
    }, null, 2), "utf8");

    const report = runDoctor({ projectRoot, homeDir, silent: true });

    assert.ok(report.warnings.some((warning) =>
      warning.includes("notion.environment.OPENAPI_MCP_HEADERS")
      && warning.includes("missing from the OGB MCP env store")
    ));
    assert.equal(JSON.stringify(report).includes(fakeNotionToken), false);
  } finally {
    if (originalHeaders === undefined) delete process.env.OPENAPI_MCP_HEADERS;
    else process.env.OPENAPI_MCP_HEADERS = originalHeaders;
  }
});
