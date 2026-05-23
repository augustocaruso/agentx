import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { bridgeConfigDirForHome, createBackupSession, type BackupSession } from "./backup-policy.js";
import { pluginPackageName } from "./native-capability-registry.js";
import { globalOpenCodeConfigDir } from "./opencode-paths.js";

export const OPENCODE_AUTH_PLUGIN_SPECS = [
  "opencode-gemini-auth@1.4.15",
  "opencode-antigravity-auth@1.6.0",
  "@ex-machina/opencode-anthropic-auth@1.8.1",
] as const;

const AUTH_PLUGIN_PACKAGES = new Set(OPENCODE_AUTH_PLUGIN_SPECS.map((plugin) => pluginPackageName(plugin)));
const SCHEMA_URL = "https://opencode.ai/config.json";
const TEXT_IMAGE_PDF = { input: ["text", "image", "pdf"], output: ["text"] };
const TEXT_ONLY = { input: ["text"], output: ["text"] };
const GEMINI_LARGE = { context: 1048576, output: 65536 };
const GEMINI_PRO = { context: 1048576, output: 65535 };
const ANTHROPIC_STANDARD = { context: 200000, output: 64000 };

export interface OpenCodeAuthProviderSetupOptions {
  homeDir?: string;
  configDir?: string;
  dryRun?: boolean;
  forceConfigure?: boolean;
  managePluginList?: boolean;
  patchPackages?: boolean;
  backupSession?: BackupSession;
}

export interface OpenCodeAuthProviderSetupChange {
  path: string;
  status: "updated" | "unchanged" | "missing" | "preview" | "skipped";
  message: string;
  backup?: string;
}

export interface OpenCodeAuthProviderSetupReport {
  status: "ok" | "partial" | "skipped";
  changes: OpenCodeAuthProviderSetupChange[];
  warnings: string[];
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function readJsoncObject(filePath: string): Record<string, any> | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const parsed = parseJsonc(fs.readFileSync(filePath, "utf8"));
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function readJsonObject(filePath: string): Record<string, any> | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return asRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

function writeJsonIfChanged(options: {
  filePath: string;
  value: unknown;
  dryRun?: boolean;
  backupSession: BackupSession;
  changes: OpenCodeAuthProviderSetupChange[];
  message: string;
}): void {
  const nextText = `${JSON.stringify(options.value, null, 2)}\n`;
  const current = fs.existsSync(options.filePath) ? fs.readFileSync(options.filePath, "utf8") : undefined;
  if (current === nextText) {
    options.changes.push({ path: options.filePath, status: "unchanged", message: options.message });
    return;
  }
  if (options.dryRun) {
    options.changes.push({ path: options.filePath, status: "preview", message: options.message });
    return;
  }
  const backup = current !== undefined ? options.backupSession.backupExisting(options.filePath) : undefined;
  fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
  fs.writeFileSync(options.filePath, nextText, "utf8");
  options.changes.push({ path: options.filePath, status: "updated", message: options.message, backup });
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function normalizeAuthPluginSpecs(plugins: readonly string[]): string[] {
  const nonAuth = plugins.filter((plugin) => !AUTH_PLUGIN_PACKAGES.has(pluginPackageName(plugin)));
  return unique([...OPENCODE_AUTH_PLUGIN_SPECS, ...nonAuth]);
}

function geminiCliModels(): Record<string, unknown> {
  return {
    "gemini-3.1-pro-preview": { name: "Gemini 3.1 Pro Preview", limit: GEMINI_PRO, modalities: TEXT_IMAGE_PDF },
    "gemini-3-flash-preview": { name: "Gemini 3 Flash Preview", limit: GEMINI_LARGE, modalities: TEXT_IMAGE_PDF },
    "gemini-3.1-flash-lite-preview": { name: "Gemini 3.1 Flash Lite Preview", limit: GEMINI_LARGE, modalities: TEXT_IMAGE_PDF },
    "gemini-2.5-pro": { name: "Gemini 2.5 Pro", limit: GEMINI_LARGE, modalities: TEXT_IMAGE_PDF },
    "gemini-2.5-flash": { name: "Gemini 2.5 Flash", limit: GEMINI_LARGE, modalities: TEXT_IMAGE_PDF },
    "gemini-2.5-flash-lite": { name: "Gemini 2.5 Flash Lite", limit: GEMINI_LARGE, modalities: TEXT_IMAGE_PDF },
    "gemma-4-31b-it": { name: "Gemma 4 31B IT", limit: GEMINI_PRO, modalities: TEXT_IMAGE_PDF },
    "gemma-4-26b-a4b-it": { name: "Gemma 4 26B A4B IT", limit: GEMINI_PRO, modalities: TEXT_ONLY },
  };
}

function antigravityModels(): Record<string, unknown> {
  return {
    "gemini-3.5-flash": {
      name: "Gemini 3.5 Flash",
      limit: GEMINI_LARGE,
      modalities: TEXT_IMAGE_PDF,
      variants: {
        high: { thinkingLevel: "high" },
        medium: { thinkingLevel: "medium" },
      },
    },
    "gemini-3.1-pro": {
      name: "Gemini 3.1 Pro",
      limit: GEMINI_PRO,
      modalities: TEXT_IMAGE_PDF,
      variants: {
        high: { thinkingLevel: "high" },
        low: { thinkingLevel: "low" },
      },
    },
    "claude-sonnet-4-6": { name: "Claude Sonnet 4.6", limit: ANTHROPIC_STANDARD, modalities: TEXT_IMAGE_PDF },
    "claude-opus-4-6": { name: "Claude Opus 4.6", limit: ANTHROPIC_STANDARD, modalities: TEXT_IMAGE_PDF },
    "gpt-oss-120b": {
      name: "GPT-OSS 120B",
      limit: { context: 131072, output: 32768 },
      modalities: TEXT_ONLY,
      tool_call: false,
    },
  };
}

function anthropicAuthModels(): Record<string, unknown> {
  return {
    "claude-sonnet-4-6": { name: "Sonnet 4.6", limit: { context: 1000000, output: 64000 }, modalities: TEXT_IMAGE_PDF },
    "claude-opus-4-7": { name: "Opus 4.7", limit: ANTHROPIC_STANDARD, modalities: TEXT_IMAGE_PDF },
    "claude-haiku-4-5": { name: "Haiku 4.5", limit: ANTHROPIC_STANDARD, modalities: TEXT_IMAGE_PDF },
  };
}

function authProviderConfig(): Record<string, unknown> {
  return {
    "gemini-cli": {
      name: "Gemini CLI",
      npm: "@ai-sdk/google",
      api: "google",
      models: geminiCliModels(),
    },
    antigravity: {
      name: "Antigravity",
      npm: "@ai-sdk/google",
      api: "google",
      models: antigravityModels(),
    },
    "anthropic-auth": {
      name: "Anthropic",
      npm: "@ai-sdk/anthropic",
      api: "anthropic",
      models: anthropicAuthModels(),
    },
  };
}

function configNeedsAuthSetup(config: Record<string, any>, auth?: Record<string, any>): boolean {
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  const provider = asRecord(config.provider);
  return plugins.some((plugin) => typeof plugin === "string" && AUTH_PLUGIN_PACKAGES.has(pluginPackageName(plugin)))
    || ["gemini-cli", "antigravity", "anthropic-auth", "google", "anthropic"].some((key) => provider[key])
    || Boolean(auth?.google || auth?.anthropic || auth?.["gemini-cli"] || auth?.["anthropic-auth"] || auth?.antigravity);
}

function configuredOpenCodeJsonPath(configDir: string): string {
  return path.join(configDir, "opencode.json");
}

function migrateConfig(options: {
  homeDir: string;
  configDir: string;
  dryRun?: boolean;
  forceConfigure?: boolean;
  managePluginList?: boolean;
  backupSession: BackupSession;
  changes: OpenCodeAuthProviderSetupChange[];
}): boolean {
  const configPath = configuredOpenCodeJsonPath(options.configDir);
  const authPath = path.join(options.homeDir, ".local", "share", "opencode", "auth.json");
  const current = readJsoncObject(configPath) ?? {};
  const auth = readJsonObject(authPath);
  if (!options.forceConfigure && !configNeedsAuthSetup(current, auth)) {
    options.changes.push({ path: configPath, status: "skipped", message: "No auth-provider setup detected in OpenCode config." });
    return false;
  }

  const next: Record<string, any> = { ...current };
  if (!next.$schema) next.$schema = SCHEMA_URL;
  if (options.managePluginList) {
    const currentPlugins = Array.isArray(next.plugin) ? next.plugin.filter((plugin: unknown): plugin is string => typeof plugin === "string") : [];
    next.plugin = normalizeAuthPluginSpecs(currentPlugins);
  }
  const provider = { ...asRecord(next.provider) };
  delete provider.google;
  delete provider.anthropic;
  Object.assign(provider, authProviderConfig());
  next.provider = provider;
  next.disabled_providers = unique([
    ...(Array.isArray(next.disabled_providers) ? next.disabled_providers.filter((item: unknown): item is string => typeof item === "string") : []),
    "google",
    "anthropic",
  ]);

  writeJsonIfChanged({
    filePath: configPath,
    value: next,
    dryRun: options.dryRun,
    backupSession: options.backupSession,
    changes: options.changes,
    message: "Configured closed auth-provider catalogs for Gemini CLI, Antigravity, and Anthropic OAuth.",
  });
  return true;
}

function migrateAuthJson(options: {
  homeDir: string;
  dryRun?: boolean;
  backupSession: BackupSession;
  changes: OpenCodeAuthProviderSetupChange[];
}): void {
  const filePath = path.join(options.homeDir, ".local", "share", "opencode", "auth.json");
  const auth = readJsonObject(filePath);
  if (!auth) {
    options.changes.push({ path: filePath, status: "missing", message: "OpenCode auth.json not present yet." });
    return;
  }
  const next = { ...auth };
  if (next.google && !next["gemini-cli"]) next["gemini-cli"] = next.google;
  if (next.anthropic && !next["anthropic-auth"]) next["anthropic-auth"] = next.anthropic;
  delete next.google;
  delete next.anthropic;
  writeJsonIfChanged({
    filePath,
    value: next,
    dryRun: options.dryRun,
    backupSession: options.backupSession,
    changes: options.changes,
    message: "Migrated OpenCode OAuth records to non-overlapping provider IDs.",
  });
}

function migrateAuthV2Json(options: {
  homeDir: string;
  dryRun?: boolean;
  backupSession: BackupSession;
  changes: OpenCodeAuthProviderSetupChange[];
}): void {
  const filePath = path.join(options.homeDir, ".local", "share", "opencode", "auth-v2.json");
  const auth = readJsonObject(filePath);
  if (!auth) {
    options.changes.push({ path: filePath, status: "missing", message: "OpenCode auth-v2.json not present yet." });
    return;
  }
  const next = { ...auth };
  const accounts = asRecord(next.accounts);
  for (const account of Object.values(accounts)) {
    if (!account || typeof account !== "object") continue;
    const record = account as Record<string, unknown>;
    if (record.serviceID === "google") record.serviceID = "gemini-cli";
    if (record.serviceID === "anthropic") record.serviceID = "anthropic-auth";
  }
  const active = { ...asRecord(next.active) };
  if (active.google && !active["gemini-cli"]) active["gemini-cli"] = active.google;
  if (active.anthropic && !active["anthropic-auth"]) active["anthropic-auth"] = active.anthropic;
  delete active.google;
  delete active.anthropic;
  next.accounts = accounts;
  next.active = active;
  writeJsonIfChanged({
    filePath,
    value: next,
    dryRun: options.dryRun,
    backupSession: options.backupSession,
    changes: options.changes,
    message: "Migrated OpenCode auth-v2 active provider IDs.",
  });
}

function packageCacheDirs(homeDir: string, packageName: string): string[] {
  const packagesRoot = path.join(homeDir, ".cache", "opencode", "packages");
  const dirs: string[] = [];
  const parts = packageName.split("/");
  if (packageName.startsWith("@") && parts.length === 2) {
    const [scope, name] = parts;
    const scopeDir = path.join(packagesRoot, scope);
    try {
      for (const entry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(`${name}@`)) continue;
        const packageDir = path.join(scopeDir, entry.name, "node_modules", scope, name);
        if (fs.existsSync(packageDir)) dirs.push(packageDir);
      }
    } catch {
      return dirs;
    }
    return dirs.sort();
  }

  try {
    for (const entry of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(`${packageName}@`)) continue;
      const packageDir = path.join(packagesRoot, entry.name, "node_modules", packageName);
      if (fs.existsSync(packageDir)) dirs.push(packageDir);
    }
  } catch {
    return dirs;
  }
  return dirs.sort();
}

function patchTextFile(options: {
  filePath: string;
  transform: (text: string) => string;
  dryRun?: boolean;
  backupSession: BackupSession;
  changes: OpenCodeAuthProviderSetupChange[];
  message: string;
}): void {
  if (!fs.existsSync(options.filePath)) {
    options.changes.push({ path: options.filePath, status: "missing", message: options.message });
    return;
  }
  const current = fs.readFileSync(options.filePath, "utf8");
  const next = options.transform(current);
  if (next === current) {
    options.changes.push({ path: options.filePath, status: "unchanged", message: options.message });
    return;
  }
  if (options.dryRun) {
    options.changes.push({ path: options.filePath, status: "preview", message: options.message });
    return;
  }
  const backup = options.backupSession.backupExisting(options.filePath);
  fs.writeFileSync(options.filePath, next, "utf8");
  options.changes.push({ path: options.filePath, status: "updated", message: options.message, backup });
}

function patchGeminiAuthIndex(text: string): string {
  let next = text.replace(/var GEMINI_PROVIDER_ID = ["'][^"']+["'];/, 'var GEMINI_PROVIDER_ID = "gemini-cli";');
  next = next.replace(/provider\.google\.options\.projectId/g, "provider.gemini-cli.options.projectId");
  next = next.replace(
    /function isGenerativeLanguageRequest\(input\) {\n\s+return toRequestUrlString\(input\)\.includes\("generativelanguage\.googleapis\.com"\);\n}/,
    'function isGenerativeLanguageRequest(input) {\n  const url2 = toRequestUrlString(input);\n  return url2.includes("generativelanguage.googleapis.com") || /\\/models\\/[^:]+:\\w+/.test(url2);\n}',
  );
  return next;
}

function patchAnthropicAuthIndex(text: string): string {
  return text
    .replace(/provider: ['"]anthropic['"]/g, "provider: 'anthropic-auth'")
    .replace(/id: ['"]anthropic['"]/g, "id: 'anthropic-auth'");
}

function patchAnthropicTransform(text: string): string {
  let next = text;
  if (!next.includes("function requestUrlString(input)")) {
    next = next.replace(
      "/**\n * Rewrite the request URL to add ?beta=true for /v1/messages requests.",
      `function requestUrlString(input) {
    if (typeof input === 'string') {
        return input;
    }
    if (input instanceof URL) {
        return input.toString();
    }
    if (input instanceof Request) {
        return input.url;
    }
    const candidate = input?.url;
    if (typeof candidate === 'string') {
        return candidate;
    }
    return String(input ?? '');
}
/**
 * Rewrite the request URL to add ?beta=true for /v1/messages requests.`,
    );
  }
  if (!next.includes("rawUrl.startsWith('anthropic/')")) {
    next = next.replace(
      "    let requestUrl = null;\n    try {\n        if (typeof input === 'string' || input instanceof URL) {\n            requestUrl = new URL(input.toString());\n        }\n        else if (input instanceof Request) {\n            requestUrl = new URL(input.url);\n        }\n    }\n    catch {",
      `    let requestUrl = null;
    let wasRelative = false;
    try {
        const rawUrl = requestUrlString(input);
        if (rawUrl.startsWith('anthropic/')) {
            wasRelative = true;
            requestUrl = new URL(\`/v1/\${rawUrl.slice('anthropic/'.length)}\`, resolveBaseUrl()?.origin ?? 'https://api.anthropic.com');
        }
        else if (rawUrl.startsWith('/') || /^v\\d+\\//.test(rawUrl)) {
            wasRelative = true;
            requestUrl = new URL(rawUrl.startsWith('/') ? rawUrl : \`/\${rawUrl}\`, resolveBaseUrl()?.origin ?? 'https://api.anthropic.com');
        }
        else {
            requestUrl = new URL(rawUrl);
        }
    }
    catch {`,
    );
  }
  next = next.replace("    if (requestUrl.href === originalHref) {", "    if (!wasRelative && requestUrl.href === originalHref) {");
  return next;
}

function antigravityModelsJs(): string {
  return `const DEFAULT_MODALITIES = {
    input: ["text", "image", "pdf"],
    output: ["text"],
};
export const OPENCODE_MODEL_DEFINITIONS = ${JSON.stringify(antigravityModels(), null, 4)};
//# sourceMappingURL=models.js.map
`;
}

function patchAntigravityConstants(text: string): string {
  return text.replace(/ANTIGRAVITY_PROVIDER_ID = ["'][^"']+["']/g, 'ANTIGRAVITY_PROVIDER_ID = "antigravity"');
}

function patchAntigravityUpdater(text: string): string {
  return text
    .replace(/provider\.google/g, "provider.antigravity")
    .replace(/provider\.antigravity\.antigravity/g, "provider.antigravity")
    .replace(/`provider\.antigravity\.models`/g, "`provider.antigravity.models`")
    .replace(/"opencode-antigravity-auth@latest"/g, '"opencode-antigravity-auth@1.6.0"');
}

function patchAntigravityRequest(text: string): string {
  let next = text;
  if (!next.includes("function requestUrlString(input)")) {
    next = next.replace(
      "const STREAM_ACTION = \"streamGenerateContent\";\n",
      `const STREAM_ACTION = "streamGenerateContent";
function requestUrlString(input) {
    if (typeof input === "string") {
        return input;
    }
    const candidate = input?.url;
    if (typeof candidate === "string") {
        return candidate;
    }
    return String(input ?? "");
}
`,
    );
  }
  next = next.replace(
    /export function isGenerativeLanguageRequest\(input\) {\n\s+return typeof input === "string" && input\.includes\("generativelanguage\.googleapis\.com"\);\n}/,
    `export function isGenerativeLanguageRequest(input) {
    const url = requestUrlString(input);
    return url.includes("generativelanguage.googleapis.com") || /\\/models\\/[^:]+:\\w+/.test(url);
}`,
  );
  next = next.replace(
    "    const match = input.match(/\\/models\\/([^:]+):(\\w+)/);\n",
    "    const requestUrl = requestUrlString(input);\n    const match = requestUrl.match(/\\/models\\/([^:]+):(\\w+)/);\n",
  );
  if (!next.includes("const isGptOssModel = effectiveModel.toLowerCase().startsWith(\"gpt-oss-\");")) {
    next = next.replace(
      "    const isClaudeThinking = isClaudeThinkingModel(resolved.actualModel);\n",
      "    const isClaudeThinking = isClaudeThinkingModel(resolved.actualModel);\n    const isGptOssModel = effectiveModel.toLowerCase().startsWith(\"gpt-oss-\");\n",
    );
  }
  if (!next.includes("if (isGptOssModel) {\n                    delete req.tools;")) {
    next = next.replace(
      "                    stripInjectedDebugFromRequestPayload(req);\n",
      `                    stripInjectedDebugFromRequestPayload(req);
                    if (isGptOssModel) {
                        delete req.tools;
                        delete req.toolConfig;
                        delete req.thinkingConfig;
                        delete req.thinking;
                        if (req.generationConfig && typeof req.generationConfig === "object") {
                            delete req.generationConfig.thinkingConfig;
                        }
                    }
`,
    );
  }
  next = next.replace(
    "                const variantConfig = extractVariantThinkingConfig(requestPayload.providerOptions, rawGenerationConfig);\n",
    "                const variantConfig = isGptOssModel ? undefined : extractVariantThinkingConfig(requestPayload.providerOptions, rawGenerationConfig);\n",
  );
  if (!next.includes("const modelWithoutQuota = rawModel.replace(/^antigravity-/i, \"\").toLowerCase();")) {
    next = next.replace(
      "                const variantConfig = isGptOssModel ? undefined : extractVariantThinkingConfig(requestPayload.providerOptions, rawGenerationConfig);\n",
      `                const variantConfig = isGptOssModel ? undefined : extractVariantThinkingConfig(requestPayload.providerOptions, rawGenerationConfig);
                if (isGptOssModel) {
                    delete requestPayload.tools;
                    delete requestPayload.toolConfig;
                    delete requestPayload.thinkingConfig;
                    delete requestPayload.thinking;
                    if (rawGenerationConfig && typeof rawGenerationConfig === "object") {
                        delete rawGenerationConfig.thinkingConfig;
                    }
                    if (extraBody && typeof extraBody === "object") {
                        delete extraBody.thinkingConfig;
                        delete extraBody.thinking;
                    }
                }
                const modelWithoutQuota = rawModel.replace(/^antigravity-/i, "").toLowerCase();
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
`,
    );
  }
  return next;
}

function patchInstalledPackages(options: {
  homeDir: string;
  dryRun?: boolean;
  backupSession: BackupSession;
  changes: OpenCodeAuthProviderSetupChange[];
}): void {
  const packagePatches: Array<{ packageName: string; relPath: string; message: string; transform: (text: string) => string }> = [
    { packageName: "opencode-gemini-auth", relPath: "dist/index.js", message: "Patched Gemini CLI OAuth provider ID and relative URL interception.", transform: patchGeminiAuthIndex },
    { packageName: "@ex-machina/opencode-anthropic-auth", relPath: "dist/index.js", message: "Patched Anthropic OAuth provider ID.", transform: patchAnthropicAuthIndex },
    { packageName: "@ex-machina/opencode-anthropic-auth", relPath: "dist/transform.js", message: "Patched Anthropic OAuth relative URL rewriting.", transform: patchAnthropicTransform },
    { packageName: "opencode-antigravity-auth", relPath: "dist/src/constants.js", message: "Patched Antigravity provider ID.", transform: patchAntigravityConstants },
    { packageName: "opencode-antigravity-auth", relPath: "dist/src/constants.d.ts", message: "Patched Antigravity provider ID type declaration.", transform: patchAntigravityConstants },
    { packageName: "opencode-antigravity-auth", relPath: "dist/src/plugin/config/updater.js", message: "Patched Antigravity updater to preserve its own provider namespace.", transform: patchAntigravityUpdater },
    { packageName: "opencode-antigravity-auth", relPath: "dist/src/plugin/config/models.js", message: "Patched Antigravity model catalog with native variants.", transform: () => antigravityModelsJs() },
    { packageName: "opencode-antigravity-auth", relPath: "dist/src/plugin/request.js", message: "Patched Antigravity request routing, variants, and GPT-OSS payload cleanup.", transform: patchAntigravityRequest },
  ];

  const seen = new Set<string>();
  for (const patch of packagePatches) {
    const packageDirs = packageCacheDirs(options.homeDir, patch.packageName);
    if (packageDirs.length === 0) {
      options.changes.push({
        path: path.join(options.homeDir, ".cache", "opencode", "packages", patch.packageName),
        status: "missing",
        message: `${patch.packageName} is not installed in the OpenCode package cache yet.`,
      });
      continue;
    }
    for (const packageDir of packageDirs) {
      const filePath = path.join(packageDir, ...patch.relPath.split("/"));
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      patchTextFile({ ...options, filePath, message: patch.message, transform: patch.transform });
    }
  }
}

export function applyOpenCodeAuthProviderSetup(options: OpenCodeAuthProviderSetupOptions = {}): OpenCodeAuthProviderSetupReport {
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const configDir = path.resolve(options.configDir ?? globalOpenCodeConfigDir({ homeDir }));
  const changes: OpenCodeAuthProviderSetupChange[] = [];
  const warnings: string[] = [];
  const backupSession = options.backupSession ?? createBackupSession({
    bridgeConfigDir: bridgeConfigDirForHome(homeDir),
    operation: "opencode-auth-providers",
    roots: [
      { root: homeDir, prefix: "home" },
      { root: configDir, prefix: "opencode-config" },
    ],
    dryRun: options.dryRun,
  });

  const configured = migrateConfig({
    homeDir,
    configDir,
    dryRun: options.dryRun,
    forceConfigure: options.forceConfigure,
    managePluginList: options.managePluginList,
    backupSession,
    changes,
  });
  if (configured || options.forceConfigure) {
    migrateAuthJson({ homeDir, dryRun: options.dryRun, backupSession, changes });
    migrateAuthV2Json({ homeDir, dryRun: options.dryRun, backupSession, changes });
  }
  if (options.patchPackages !== false) {
    patchInstalledPackages({ homeDir, dryRun: options.dryRun, backupSession, changes });
  }

  const updated = changes.some((change) => change.status === "updated" || change.status === "preview");
  const missingPackage = changes.some((change) => change.status === "missing" && change.path.includes(".cache/opencode/packages"));
  return {
    status: updated ? "ok" : missingPackage ? "partial" : "skipped",
    changes,
    warnings,
  };
}
