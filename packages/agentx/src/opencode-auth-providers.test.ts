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

  const auth = readJson(path.join(authDir, "auth.json"));
  assert.deepEqual(Object.keys(auth).sort(), ["anthropic-auth", "gemini-cli", "openai"]);
  const authV2 = readJson(path.join(authDir, "auth-v2.json"));
  assert.equal(authV2.accounts.a.serviceID, "gemini-cli");
  assert.equal(authV2.accounts.b.serviceID, "anthropic-auth");
  assert.deepEqual(authV2.active, { "gemini-cli": "a", "anthropic-auth": "b" });
});
