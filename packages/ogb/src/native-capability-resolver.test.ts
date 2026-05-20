import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  capabilityEntry,
  entityIdFromGeminiExtensionName,
  entityIdFromMcpServer,
  entityIdFromOpenCodePlugin,
  nativeCapabilityEntriesForTarget,
  pluginPackageName,
} from "./native-capability-registry.js";
import { resolveNativeCapabilities } from "./native-capability-resolver.js";

test("native capability registry exposes known native and portable capabilities", () => {
  const superpowers = capabilityEntry("superpowers", "opencode");
  const honcho = capabilityEntry("honcho", "opencode");
  const anki = capabilityEntry("anki", "opencode");
  const playwright = capabilityEntry("playwright-mcp", "opencode");
  const notion = capabilityEntry("notion-mcp", "opencode");
  const googleWorkspace = capabilityEntry("google-workspace-mcp", "opencode");

  assert.equal(superpowers?.nativeStatus, "available");
  assert.equal(superpowers?.nativeInstall?.kind, "opencode-plugin");
  assert.equal(superpowers?.nativeInstall?.plugin, "superpowers@git+https://github.com/obra/superpowers.git");
  assert.deepEqual(superpowers?.managedPortPrefixes, [
    ".opencode/skills/",
    ".config/opencode/skills/",
  ]);

  assert.equal(honcho?.nativeInstall?.kind, "opencode-plugin");
  assert.equal(honcho?.nativeInstall?.plugin, "@honcho-ai/opencode-honcho");
  assert.equal(anki?.nativeInstall?.kind, "opencode-mcp");
  assert.equal(anki?.nativeInstall?.mcpName, "anki");
  assert.equal(playwright?.nativeInstall?.kind, "opencode-mcp");
  assert.equal(playwright?.nativeInstall?.mcpName, "playwright");
  assert.equal(notion?.nativeInstall?.kind, "opencode-mcp");
  assert.equal(notion?.nativeInstall?.mcpName, "notion");
  assert.equal(googleWorkspace?.nativeInstall?.kind, "opencode-mcp");
  assert.equal(googleWorkspace?.nativeInstall?.mcpName, "gws");
  assert.deepEqual(googleWorkspace?.nativeInstall?.args, ["mcp"]);
});

test("native capability registry recognizes package and source names conservatively", () => {
  assert.equal(pluginPackageName("opencode-auto-fallback@0.4.3"), "opencode-auto-fallback");
  assert.equal(pluginPackageName("@honcho-ai/opencode-honcho@1.2.3"), "@honcho-ai/opencode-honcho");
  assert.equal(pluginPackageName("superpowers@git+https://github.com/obra/superpowers.git"), "superpowers");
  assert.equal(pluginPackageName("file:///tmp/plugin.js"), "file:///tmp/plugin.js");

  assert.equal(entityIdFromGeminiExtensionName("superpowers"), "superpowers");
  assert.equal(entityIdFromGeminiExtensionName("gemini-superpowers"), "superpowers");
  assert.equal(entityIdFromGeminiExtensionName("medical-notes-workbench"), undefined);
  assert.equal(entityIdFromOpenCodePlugin("@honcho-ai/opencode-honcho@1.2.3"), "honcho");
  assert.equal(entityIdFromMcpServer("anki-mcp", { command: "uvx", args: ["anki-mcp"] }), "anki");
  assert.equal(entityIdFromMcpServer("playwright", { command: "npx", args: ["-y", "@playwright/mcp"] }), "playwright-mcp");
  assert.equal(entityIdFromMcpServer("notion", { command: "npx", args: ["-y", "@notionhq/notion-mcp-server"] }), "notion-mcp");
  assert.equal(entityIdFromMcpServer("gws", { command: "gws", args: ["mcp"] }), "google-workspace-mcp");
  assert.equal(entityIdFromMcpServer("google-workspace", { command: "npx", args: ["-y", "@googleworkspace/cli", "mcp"] }), "google-workspace-mcp");
});

test("nativeCapabilityEntriesForTarget returns stable sorted entries", () => {
  const entries = nativeCapabilityEntriesForTarget("opencode").map((entry) => entry.entityId);
  assert.deepEqual(entries, [...entries].sort());
  assert.equal(entries.includes("superpowers"), true);
  assert.equal(entries.includes("honcho"), true);
  assert.equal(entries.includes("anki"), true);
  assert.equal(entries.includes("playwright-mcp"), true);
  assert.equal(entries.includes("notion-mcp"), true);
  assert.equal(entries.includes("google-workspace-mcp"), true);
});

test("resolveNativeCapabilities installs validated native plugins and marks MCP setup portable", () => {
  const report = resolveNativeCapabilities({
    projectRoot: "/tmp/project",
    homeDir: "/tmp/home",
    target: "opencode",
    sources: [
      { entityId: "superpowers", sourceKind: "gemini-extension", sourceName: "superpowers", sourcePath: path.join("/tmp/home", ".gemini", "extensions", "superpowers") },
      { entityId: "honcho", sourceKind: "opencode-plugin", sourceName: "@honcho-ai/opencode-honcho" },
      { entityId: "anki", sourceKind: "gemini-mcp", sourceName: "anki-mcp" },
      { entityId: "playwright-mcp", sourceKind: "gemini-mcp", sourceName: "playwright" },
      { entityId: "notion-mcp", sourceKind: "gemini-mcp", sourceName: "notion" },
      { entityId: "google-workspace-mcp", sourceKind: "gemini-mcp", sourceName: "gws" },
    ],
    currentOpenCodePlugins: ["@honcho-ai/opencode-honcho@1.2.3"],
    availableMcpServers: ["anki", "gws", "notion", "playwright"],
    smoke: () => ({ status: "passed", message: "fake smoke" }),
  });

  assert.deepEqual(report.openCodePlugins, ["@honcho-ai/opencode-honcho", "superpowers@git+https://github.com/obra/superpowers.git"]);
  assert.deepEqual(report.suppressedExtensionNames, ["superpowers"]);
  assert.deepEqual(report.suppressedSkillNames, []);
  assert.equal(report.decisions.find((decision) => decision.entityId === "superpowers")?.action, "install_native");
  assert.equal(report.decisions.find((decision) => decision.entityId === "honcho")?.action, "use_existing_native");
  assert.equal(report.decisions.find((decision) => decision.entityId === "anki")?.action, "use_existing_native");
  assert.equal(report.decisions.find((decision) => decision.entityId === "playwright-mcp")?.action, "use_existing_native");
  assert.equal(report.decisions.find((decision) => decision.entityId === "notion-mcp")?.action, "use_existing_native");
  assert.equal(report.decisions.find((decision) => decision.entityId === "google-workspace-mcp")?.action, "use_existing_native");
});

test("resolveNativeCapabilities keeps compatibility ports when native smoke fails", () => {
  const report = resolveNativeCapabilities({
    projectRoot: "/tmp/project",
    homeDir: "/tmp/home",
    target: "opencode",
    sources: [
      { entityId: "superpowers", sourceKind: "gemini-extension", sourceName: "superpowers" },
    ],
    currentOpenCodePlugins: [],
    smoke: () => ({ status: "failed", message: "plugin did not load" }),
  });

  assert.deepEqual(report.openCodePlugins, ["superpowers@git+https://github.com/obra/superpowers.git"]);
  assert.deepEqual(report.suppressedExtensionNames, []);
  assert.equal(report.decisions[0].action, "fallback_compat");
  assert.match(report.decisions[0].message, /native.*not.*confirmed|plugin did not load/i);
});
