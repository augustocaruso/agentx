import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  applyOpenCodeAuthProviderSetup,
  normalizeAuthPluginSpecs,
  OPENCODE_AUTH_PLUGIN_SPECS,
} from "./opencode-auth-providers.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentx-auth-providers-"));
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("normalizeAuthPluginSpecs pins unofficial auth plugins before other plugins", () => {
  assert.deepEqual(normalizeAuthPluginSpecs([
    "opencode-gemini-auth@latest",
    "@ex-machina/opencode-anthropic-auth@1.8.0",
    "opencode-notify",
    "opencode-antigravity-auth@latest",
  ]), [
    ...OPENCODE_AUTH_PLUGIN_SPECS,
    "opencode-notify",
  ]);
});

test("applyOpenCodeAuthProviderSetup writes closed auth catalogs and migrates auth keys", () => {
  const homeDir = tempHome();
  const configDir = path.join(homeDir, ".config", "opencode");
  const authDir = path.join(homeDir, ".local", "share", "opencode");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "opencode.json"), `${JSON.stringify({
    plugin: ["opencode-gemini-auth@latest", "opencode-notify", "opencode-antigravity-auth@latest"],
    provider: {
      google: { models: { stale: {} } },
      anthropic: { models: { stale: {} } },
    },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(configDir, "antigravity.json"), `${JSON.stringify({
    cli_first: true,
    account_selection_strategy: "sticky",
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(authDir, "auth.json"), `${JSON.stringify({
    google: { type: "oauth", refresh: "gemini-refresh" },
    anthropic: { type: "oauth", refresh: "anthropic-refresh" },
    openai: { type: "oauth", refresh: "openai-refresh" },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(authDir, "auth-v2.json"), `${JSON.stringify({
    accounts: {
      a: { serviceID: "google" },
      b: { serviceID: "anthropic" },
    },
    active: {
      google: "a",
      anthropic: "b",
    },
  }, null, 2)}\n`);

  const report = applyOpenCodeAuthProviderSetup({
    homeDir,
    configDir,
    forceConfigure: true,
    managePluginList: true,
    patchPackages: true,
  });

  assert.equal(report.warnings.length, 0);
  const config = readJson(path.join(configDir, "opencode.json"));
  assert.deepEqual(config.plugin, [...OPENCODE_AUTH_PLUGIN_SPECS, "opencode-notify"]);
  assert.deepEqual(config.disabled_providers, ["google", "anthropic"]);
  assert.deepEqual(Object.keys(config.provider).sort(), ["anthropic-auth", "antigravity", "gemini-cli"]);
  assert.deepEqual(Object.keys(config.provider["gemini-cli"].models), [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
  ]);
  assert.deepEqual(Object.keys(config.provider.antigravity.models), [
    "gemini-3.5-flash",
    "gemini-3.1-pro",
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "gpt-oss-120b",
  ]);
  assert.deepEqual(Object.keys(config.provider["anthropic-auth"].models), [
    "claude-sonnet-4-6",
    "claude-opus-4-7",
    "claude-haiku-4-5",
  ]);
  assert.deepEqual(config.provider.antigravity.models["gemini-3.5-flash"].variants, {
    high: { thinkingConfig: { thinkingLevel: "high" } },
    medium: { thinkingConfig: { thinkingLevel: "medium" } },
  });
  assert.deepEqual(config.provider.antigravity.models["gemini-3.1-pro"].variants, {
    high: { thinkingConfig: { thinkingLevel: "high" } },
    low: { thinkingConfig: { thinkingLevel: "low" } },
  });
  assert.equal(config.provider.antigravity.models["claude-sonnet-4-6"].variants, undefined);
  assert.deepEqual(config.provider.antigravity.models["claude-opus-4-6"].variants, {
    low: { thinkingConfig: { thinkingBudget: 8192 } },
    max: { thinkingConfig: { thinkingBudget: 32768 } },
  });
  assert.deepEqual(config.provider["anthropic-auth"].models["claude-sonnet-4-6"].variants, {
    high: { thinking: { type: "enabled", budgetTokens: 16000 } },
    max: { thinking: { type: "enabled", budgetTokens: 32000 } },
  });
  assert.deepEqual(config.provider["anthropic-auth"].models["claude-opus-4-7"].variants, {
    high: { thinking: { type: "enabled", budgetTokens: 16000 } },
    max: { thinking: { type: "enabled", budgetTokens: 32000 } },
  });
  assert.equal(config.provider["anthropic-auth"].models["claude-haiku-4-5"].variants, undefined);

  const auth = readJson(path.join(authDir, "auth.json"));
  assert.deepEqual(Object.keys(auth).sort(), ["anthropic-auth", "gemini-cli", "openai"]);
  const authV2 = readJson(path.join(authDir, "auth-v2.json"));
  assert.equal(authV2.accounts.a.serviceID, "gemini-cli");
  assert.equal(authV2.accounts.b.serviceID, "anthropic-auth");
  assert.deepEqual(authV2.active, { "gemini-cli": "a", "anthropic-auth": "b" });
  assert.deepEqual(readJson(path.join(configDir, "antigravity.json")), {
    cli_first: false,
    account_selection_strategy: "sticky",
  });
});

test("applyOpenCodeAuthProviderSetup migrates stale OpenCode model state away from disabled providers", () => {
  const homeDir = tempHome();
  const configDir = path.join(homeDir, ".config", "opencode");
  const stateDir = path.join(homeDir, ".local", "state", "opencode");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "opencode.json"), `${JSON.stringify({
    plugin: ["opencode-gemini-auth@latest", "opencode-antigravity-auth@latest"],
    provider: {
      google: { models: { "gemini-3-flash-preview": {} } },
      anthropic: { models: { "claude-sonnet-4-6": {} } },
    },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(stateDir, "model.json"), `${JSON.stringify({
    recent: [
      { providerID: "google", modelID: "gemini-3-flash-preview" },
      { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      { providerID: "antigravity", modelID: "gemini-3.5-flash" },
    ],
    favorite: [
      { providerID: "google", modelID: "gemini-3.1-pro-preview" },
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    ],
    variant: {
      "google/gemini-3.1-pro-preview": "high",
      "anthropic/claude-opus-4-7": "max",
      "antigravity/gemini-3.5-flash": "high",
    },
  }, null, 2)}\n`);

  applyOpenCodeAuthProviderSetup({
    homeDir,
    configDir,
    forceConfigure: true,
    managePluginList: true,
    patchPackages: false,
  });

  const modelState = readJson(path.join(stateDir, "model.json"));
  assert.deepEqual(modelState.recent, [
    { providerID: "gemini-cli", modelID: "gemini-3-flash-preview" },
    { providerID: "anthropic-auth", modelID: "claude-sonnet-4-6" },
    { providerID: "antigravity", modelID: "gemini-3.5-flash" },
  ]);
  assert.deepEqual(modelState.favorite, [
    { providerID: "gemini-cli", modelID: "gemini-3.1-pro-preview" },
    { providerID: "anthropic-auth", modelID: "claude-opus-4-7" },
  ]);
  assert.deepEqual(modelState.variant, {
    "anthropic-auth/claude-opus-4-7": "max",
    "antigravity/gemini-3.5-flash": "high",
  });
});

test("applyOpenCodeAuthProviderSetup upgrades older Antigravity request routing patches", () => {
  const homeDir = tempHome();
  const requestPath = path.join(
    homeDir,
    ".cache",
    "opencode",
    "packages",
    "opencode-antigravity-auth@1.6.0",
    "node_modules",
    "opencode-antigravity-auth",
    "dist",
    "src",
    "plugin",
    "request.js",
  );
  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  fs.writeFileSync(requestPath, `                const modelWithoutQuota = rawModel.replace(/^antigravity-/i, "").toLowerCase();
                const variantThinkingLevel = typeof variantConfig?.thinkingLevel === "string"
                    ? variantConfig.thinkingLevel.toLowerCase()
                    : undefined;
                if (modelWithoutQuota === "gemini-3.5-flash") {
                    effectiveModel = variantThinkingLevel === "high" ? "gemini-3-flash-agent" : "gemini-3.5-flash-low";
                    if (variantThinkingLevel) {
                        tierThinkingLevel = variantThinkingLevel;
                        tierThinkingBudget = undefined;
                    }
                }
                else if (modelWithoutQuota === "gemini-3.1-pro") {
                    effectiveModel = variantThinkingLevel === "high" ? "gemini-pro-agent" : "gemini-3.1-pro-low";
                    if (variantThinkingLevel) {
                        tierThinkingLevel = variantThinkingLevel;
                        tierThinkingBudget = undefined;
                    }
                }
`);

  applyOpenCodeAuthProviderSetup({ homeDir, patchPackages: true });

  const patched = fs.readFileSync(requestPath, "utf8");
  assert.match(patched, /effectiveModel = "gemini-3-flash-agent";/);
  assert.doesNotMatch(patched, /gemini-3\.5-flash-low/);
  assert.match(patched, /tierThinkingLevel = variantThinkingLevel === "medium" \? "medium" : "high";/);
});

test("applyOpenCodeAuthProviderSetup routes public Antigravity Opus to the thinking backend model", () => {
  const homeDir = tempHome();
  const resolverPath = path.join(
    homeDir,
    ".cache",
    "opencode",
    "packages",
    "opencode-antigravity-auth@1.6.0",
    "node_modules",
    "opencode-antigravity-auth",
    "dist",
    "src",
    "plugin",
    "transform",
    "model-resolver.js",
  );
  fs.mkdirSync(path.dirname(resolverPath), { recursive: true });
  fs.writeFileSync(resolverPath, `export const MODEL_ALIASES = {
    "gemini-claude-opus-4-6-thinking-low": "claude-opus-4-6-thinking",
    "gemini-claude-opus-4-6-thinking-medium": "claude-opus-4-6-thinking",
    "gemini-claude-opus-4-6-thinking-high": "claude-opus-4-6-thinking",
    "gemini-claude-sonnet-4-6": "claude-sonnet-4-6",
};
`);

  applyOpenCodeAuthProviderSetup({ homeDir, patchPackages: true });

  const patched = fs.readFileSync(resolverPath, "utf8");
  assert.match(patched, /"claude-opus-4-6": "claude-opus-4-6-thinking"/);
});
