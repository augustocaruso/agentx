import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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
import { createOpenCodeNativeSmoke, resolveNativeCapabilities } from "./native-capability-resolver.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-native-capability-"));
}

function writeFakeOpenCodeDebugInfo(binDir: string, marker: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(binDir, "opencode.cmd"),
      [
        "@echo off",
        `echo call>>"${marker}"`,
        "echo superpowers honcho plugin loaded",
        "",
      ].join("\r\n"),
      "utf8",
    );
    return;
  }

  fs.writeFileSync(path.join(binDir, "opencode"), `#!/usr/bin/env sh\necho call >> "${marker}"\necho "superpowers honcho plugin loaded"\n`, { mode: 0o755 });
}

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
  assert.ok(honcho?.setupSurfaces?.some((surface) =>
    surface.kind === "operator-command"
    && surface.command === "/honcho:setup"
    && surface.replicateAs?.includes("minimal-skill")
  ));
  assert.ok(honcho?.setupSurfaces?.some((surface) =>
    surface.kind === "shared-config"
    && surface.path === "~/.honcho/config.json"
  ));
  assert.ok(capabilityEntry("honcho", "gemini-cli")?.setupSurfaces?.some((surface) =>
    surface.kind === "minimal-skill"
    && surface.name === "honcho-setup"
  ));
  assert.ok(capabilityEntry("honcho", "antigravity-cli")?.setupSurfaces?.some((surface) =>
    surface.kind === "minimal-skill"
    && surface.name === "honcho-setup"
  ));
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
  const honchoDecision = report.decisions.find((decision) => decision.entityId === "honcho");
  assert.equal(honchoDecision?.action, "use_existing_native");
  assert.ok(honchoDecision?.setupSurfaces.some((surface) =>
    surface.kind === "operator-command"
    && surface.command === "/honcho:setup"
  ));
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

test("resolveNativeCapabilities replicates Honcho setup surfaces to targets without native plugins", () => {
  const sources = [
    { entityId: "honcho" as const, sourceKind: "opencode-plugin" as const, sourceName: "@honcho-ai/opencode-honcho" },
  ];

  const gemini = resolveNativeCapabilities({
    projectRoot: "/tmp/project",
    homeDir: "/tmp/home",
    target: "gemini-cli",
    sources,
  });
  const antigravity = resolveNativeCapabilities({
    projectRoot: "/tmp/project",
    homeDir: "/tmp/home",
    target: "antigravity-cli",
    sources,
  });

  assert.equal(gemini.decisions[0].action, "replicate_compat");
  assert.deepEqual(gemini.replicatedCompat, ["honcho"]);
  assert.ok(gemini.decisions[0].setupSurfaces.some((surface) =>
    surface.kind === "minimal-skill"
    && surface.name === "honcho-setup"
  ));
  assert.equal(antigravity.decisions[0].action, "replicate_compat");
  assert.deepEqual(antigravity.replicatedCompat, ["honcho"]);
  assert.ok(antigravity.decisions[0].setupSurfaces.some((surface) =>
    surface.kind === "minimal-skill"
    && surface.name === "honcho-setup"
  ));
});

test("resolveNativeCapabilities reuses previous passed native smoke evidence", () => {
  const previous = resolveNativeCapabilities({
    projectRoot: "/tmp/project",
    homeDir: "/tmp/home",
    target: "opencode",
    sources: [
      { entityId: "superpowers", sourceKind: "gemini-extension", sourceName: "superpowers" },
    ],
    currentOpenCodePlugins: ["superpowers@git+https://github.com/obra/superpowers.git"],
    smoke: () => ({ status: "passed", message: "previous smoke" }),
  });
  let smokeCalls = 0;

  const report = resolveNativeCapabilities({
    projectRoot: "/tmp/project",
    homeDir: "/tmp/home",
    target: "opencode",
    sources: [
      { entityId: "superpowers", sourceKind: "gemini-extension", sourceName: "superpowers" },
    ],
    currentOpenCodePlugins: ["superpowers@git+https://github.com/obra/superpowers.git"],
    previousReport: previous,
    smoke: () => {
      smokeCalls += 1;
      return { status: "failed", message: "should not run" };
    },
  } as Parameters<typeof resolveNativeCapabilities>[0] & { previousReport: typeof previous });

  assert.equal(smokeCalls, 0);
  assert.deepEqual(report.validatedNative, ["superpowers"]);
  assert.match(report.decisions[0].smoke.message, /previous native smoke/i);
});

test("createOpenCodeNativeSmoke reuses identical OpenCode debug probes", () => {
  const root = tempRoot();
  const binDir = path.join(root, "bin");
  const marker = path.join(root, "opencode-debug-calls.txt");
  writeFakeOpenCodeDebugInfo(binDir, marker);

  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };
  const smoke = createOpenCodeNativeSmoke({ projectRoot: root, homeDir: root, env });
  assert.ok(smoke);
  const superpowers = smoke({
    nativeInstall: {
      kind: "opencode-plugin",
      plugin: "superpowers@git+https://github.com/obra/superpowers.git",
      smokeOutputHints: ["superpowers"],
    },
  } as any, "use_existing_native");
  const honcho = smoke({
    nativeInstall: {
      kind: "opencode-plugin",
      plugin: "@honcho-ai/opencode-honcho",
      smokeOutputHints: ["honcho"],
    },
  } as any, "use_existing_native");

  assert.equal(superpowers.status, "passed");
  assert.equal(honcho.status, "passed");
  assert.equal(fs.readFileSync(marker, "utf8").trim().split(/\r?\n/).length, 1);
});
