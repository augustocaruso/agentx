import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import { BUILT_IN_AGENTS, BUILT_IN_COMMANDS } from "./built-ins.js";
import { BINARY, DISPLAY, GENERATED_MARKDOWN_HEADER, LEGACY_BINARY, LEGACY_GENERATED_MARKDOWN_HEADER } from "./brand.js";
import { commandExists, resolveCommand } from "./command-resolution.js";
import { readEnvAgentx } from "./env.js";
import { buildInventory } from "./inventory.js";
import { readMcpEnvValues } from "./mcp-env-store.js";
import { AUTO_FALLBACK_PLUGIN, resolveFallbackConfigPath } from "./external-integrations.js";
import { sha256File, sha256Text } from "./file-hash.js";
import { diagnoseOpenCodeMcpConfig } from "./mcp-projection.js";
import { detectNativeCapabilitySources, summarizeNativeCapabilityReport, type NativeCapabilitySummary } from "./native-capability-resolver.js";
import { capabilityEntry, pluginPackageName } from "./native-capability-registry.js";
import { readOgbConfig } from "./ogb-config.js";
import { globalOpenCodeConfigDir, globalOpenCodeConfigFiles } from "./opencode-paths.js";
import { configReferencesExpandedGemini, projectConfigPath } from "./project-config.js";
import { resolveProjectPaths } from "./paths.js";
import { spawnCommandSync } from "./process.js";
import { resolveRulesyncCommand } from "./rulesync.js";
import { STARTUP_SYNC_PLUGIN_PATH, STARTUP_SYNC_PLUGIN_SOURCE } from "./setup-opencode.js";
import { globalStartupPluginSpec, isLegacyGlobalStartupPluginSpec, missingGlobalTuiRuntimeDependencies } from "./setup-ux.js";
import { recoverStaleStartupStatus } from "./startup-status.js";
import { readSyncState } from "./sync-state.js";
import { hookTrustKeys, hookTrustRecordMatches, readTrustFile } from "./trust.js";
import { GLOBAL_TUI_SIDEBAR_PLUGIN_PATH, TUI_SIDEBAR_PLUGIN_SOURCE, TUI_SIDEBAR_PLUGIN_SPEC } from "./tui-sidebar.js";
import { AGENTX_VERSION, type Inventory, type ResourceStatus, type StatusCounts } from "./types.js";

export interface DoctorOptions {
  projectRoot?: string;
  homeDir?: string;
  json?: boolean;
  strict?: boolean;
  silent?: boolean;
}

export interface DoctorReport {
  version: string;
  projectRoot: string;
  expandedContext: string | null;
  opencodeConfig: {
    path: string;
    exists: boolean;
    referencesExpandedGemini: boolean;
  };
  rulesync: {
    available: boolean;
    version?: string;
    lastStatus?: string;
    lastPromoted: number;
    lastConflicts: number;
  };
  generated: {
    expandedGeminiVersion?: string;
    expandedGeminiHasMarker: boolean;
    generatedConfigVersion?: string;
    generatedConfigHasMarker: boolean;
    syncStateVersion?: string;
  };
  builtIns: {
    missingAgents: string[];
    missingCommands: string[];
  };
  startupSync: {
    projectPlugin: boolean;
    projectConfig: boolean;
    globalPlugin: boolean;
    globalConfig: boolean;
    lastState?: string;
    lastStartedAt?: string;
    lastFinishedAt?: string;
    lastPid?: number;
  };
  extensionCompatibility: {
    mapExists: boolean;
    extensions: number;
    projectedCommands: number;
    availableAgents: number;
    modelFallbacks: number;
    modelRoutingReport: boolean;
    modelRoutingEnabled: boolean;
    modelRoutingDecisions: number;
    modelRoutingRouted: number;
    modelRoutingSkipped: number;
    ohMyOpenAgentConfig: boolean;
    ohMyOpenAgentPlugin: boolean;
    hooks: number;
    scripts: number;
  };
  runtimeFallback: {
    configured: boolean;
    pluginActive: boolean;
    configPath: string;
    configExists: boolean;
    configEnabled?: boolean;
    agentFallbacks: number;
    defaultFallbacks: number;
    cooldownMs?: number;
    maxRetries?: number;
    logging?: boolean;
  };
  nativeCapabilities: NativeCapabilitySummary & {
    reportExists: boolean;
    setupCompatibilityProjections: Array<{
      entityId: string;
      target: "gemini" | "antigravity";
      path: string;
      origin: string;
      status: "active" | "stale";
    }>;
  };
  modelResolution: {
    checked: boolean;
    command?: string;
    availableModels: number;
    referencedModels: number;
    unresolved: string[];
    message: string;
  };
  mcpCommandCheck: Array<{
    name: string;
    command?: string;
    ok: boolean;
    message?: string;
  }>;
  counts: {
    geminiFiles: number;
    imports: StatusCounts;
    mcps: StatusCounts;
    skills: StatusCounts;
    agents: StatusCounts;
    commands: StatusCounts;
    hooks: StatusCounts;
    extensions: StatusCounts;
  };
  warnings: string[];
  errors: string[];
}

function statusCounts<T extends { status: ResourceStatus }>(items: T[]): StatusCounts {
  return items.reduce<StatusCounts>((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { ok: 0, warning: 0, error: 0, needs_review: 0 });
}

function opencodeStatusCounts<T extends { source?: string; status: ResourceStatus }>(items: T[]): StatusCounts {
  return statusCounts(items.filter((item) => item.source === "opencode"));
}

function hookIsTrusted(hook: Inventory["hooks"][number], projectRoot: string, homeDir: string): boolean {
  const trust = readTrustFile(projectRoot, homeDir);
  return hookTrustKeys(hook, projectRoot, homeDir).some((key) => {
    const record = trust.hooks?.[key];
    return record ? hookTrustRecordMatches(hook, record) : false;
  });
}

function collectWarnings(inv: Inventory, projectRoot: string, homeDir: string): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const pushWarning = (warning: string) => {
    if (seen.has(warning)) return;
    seen.add(warning);
    warnings.push(warning);
  };
  const skillHash = (skill: Inventory["skills"][number]): string | undefined => {
    const skillPath = path.join(skill.path, "SKILL.md");
    if (!fs.existsSync(skillPath)) return undefined;
    return sha256File(skillPath);
  };
  const pushDuplicateSkillWarnings = () => {
    const duplicateSkills = inv.skills.filter((skill) => skill.status !== "ok" && /duplicate name/i.test(skill.message ?? ""));
    const byName = new Map<string, typeof duplicateSkills>();
    for (const skill of duplicateSkills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
    for (const [name, skills] of byName) {
      const hashes = new Set(skills.map(skillHash));
      const scopes = new Set(skills.map((skill) => skill.scope));
      const sameContentAcrossProjectAndGlobal = hashes.size === 1 && !hashes.has(undefined) && scopes.has("project") && scopes.has("global");
      if (sameContentAcrossProjectAndGlobal) continue;
      pushWarning(`Skill warning: ${name} - Duplicate name (${skills.map((skill) => skill.path).join("; ")})`);
    }
    return new Set(duplicateSkills.map((skill) => skill.path));
  };
  const duplicateSkillPaths = pushDuplicateSkillWarnings();

  for (const item of inv.imports) if (item.status !== "ok") pushWarning(`Import warning: ${item.raw} in ${item.source} - ${item.message}`);
  for (const skill of inv.skills) if (skill.status !== "ok" && !duplicateSkillPaths.has(skill.path)) pushWarning(`Skill warning: ${skill.name} - ${skill.message}`);
  for (const mcp of inv.mcps) if (mcp.status !== "ok") pushWarning(`MCP warning: ${mcp.name} - ${mcp.message}`);
  for (const agent of inv.agents) if (agent.status === "needs_review") pushWarning(`Agent needs review: ${agent.name}`);
  for (const command of inv.commands) if (command.status === "needs_review") pushWarning(`Command needs review: ${command.name}`);
  for (const hook of inv.hooks) {
    if (hook.status === "ok") continue;
    if (hook.status === "warning") continue;
    if (!hookIsTrusted(hook, projectRoot, homeDir)) pushWarning(`Hook needs review: ${hook.name} - ${hook.message}`);
  }
  for (const extension of inv.extensions) pushWarning(`Extension needs review: ${extension.name} - ${extension.message}`);

  return warnings;
}

function readJsonc(filePath: string): any {
  try {
    return parseJsonc(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function readText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function configHasPlugin(filePath: string, pattern: RegExp): boolean {
  const config = readJsonc(filePath);
  const plugins: unknown[] = Array.isArray(config?.plugin) ? config.plugin : [];
  return plugins.some((plugin: unknown) => typeof plugin === "string" && pattern.test(plugin));
}

function configHasPluginSpec(filePath: string, spec: string): boolean {
  const config = readJsonc(filePath);
  const plugins = Array.isArray(config?.plugin) ? config.plugin : [];
  return plugins.some((plugin: unknown) => typeof plugin === "string" && plugin === spec);
}

function legacyGlobalStartupPluginSpecs(filePath: string): string[] {
  const config = readJsonc(filePath);
  const plugins: unknown[] = Array.isArray(config?.plugin) ? config.plugin : [];
  return plugins.filter((plugin): plugin is string => typeof plugin === "string" && isLegacyGlobalStartupPluginSpec(plugin));
}

function configuredMcpNames(filePath: string): Set<string> {
  const config = readJsonc(filePath);
  const mcp = config?.mcp;
  return mcp && typeof mcp === "object" && !Array.isArray(mcp)
    ? new Set(Object.keys(mcp))
    : new Set();
}

function pathIsInside(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function hasGlobalGeminiContextSource(homeDir: string, inv: Inventory): boolean {
  const globalGemini = path.join(homeDir, ".gemini", "GEMINI.md");
  const extensionsRoot = path.join(homeDir, ".gemini", "extensions");
  return inv.geminiFiles.some((filePath) =>
    path.resolve(filePath) === path.resolve(globalGemini)
    || pathIsInside(extensionsRoot, filePath)
  );
}

function listConfiguredPlugins(projectRoot: string, homeDir: string): string[] {
  const files = [
    path.join(projectRoot, "opencode.jsonc"),
    ...globalOpenCodeConfigFiles({ homeDir }),
  ];
  const plugins: string[] = [];
  for (const filePath of files) {
    const config = readJsonc(filePath);
    if (!Array.isArray(config?.plugin)) continue;
    for (const plugin of config.plugin) if (typeof plugin === "string") plugins.push(plugin);
  }
  return [...new Set(plugins)];
}

function hasConfiguredPlugin(plugins: string[], expected: string): boolean {
  const expectedName = pluginPackageName(expected);
  return plugins.some((plugin) => pluginPackageName(plugin) === expectedName);
}

const NATIVE_SETUP_SURFACE_ORIGIN_SUFFIX = ":setup-surface";

function nativeSetupCompatibilityProjectionsFromState(
  state: ReturnType<typeof readSyncState>,
  validatedNative: readonly string[],
): DoctorReport["nativeCapabilities"]["setupCompatibilityProjections"] {
  if (!state) return [];
  const activeEntities = new Set(validatedNative);
  return state.managedFiles
    .filter((file) =>
      file.source === "ogb"
      && file.kind === "skill"
      && (file.projection === "gemini" || file.projection === "antigravity")
      && typeof file.origin === "string"
      && file.origin.endsWith(NATIVE_SETUP_SURFACE_ORIGIN_SUFFIX)
    )
    .flatMap((file) => {
      const origin = file.origin;
      if (typeof origin !== "string") return [];
      const entityId = origin.slice(0, -NATIVE_SETUP_SURFACE_ORIGIN_SUFFIX.length);
      const status: "active" | "stale" = activeEntities.has(entityId) ? "active" : "stale";
      return [{
        entityId,
        target: file.projection as "gemini" | "antigravity",
        path: file.path,
        origin,
        status,
      }];
    })
    .sort((a, b) => `${a.entityId}:${a.target}:${a.path}`.localeCompare(`${b.entityId}:${b.target}:${b.path}`));
}

function readRuntimeFallback(projectRoot: string, homeDir: string) {
  const ogbConfig = readOgbConfig(projectRoot, homeDir);
  const fallbackConfigPath = resolveFallbackConfigPath(ogbConfig, homeDir);
  const fallbackConfig = readJsonc(fallbackConfigPath);
  const plugins = listConfiguredPlugins(projectRoot, homeDir);
  const configured = ogbConfig.externalPlugins?.autoFallback?.enabled === true;
  const pluginName = ogbConfig.externalPlugins?.autoFallback?.plugin || AUTO_FALLBACK_PLUGIN;
  const agentFallbacks = fallbackConfig?.agentFallbacks && typeof fallbackConfig.agentFallbacks === "object" && !Array.isArray(fallbackConfig.agentFallbacks)
    ? Object.keys(fallbackConfig.agentFallbacks).length
    : 0;
  const defaultFallbacks = Array.isArray(fallbackConfig?.defaultFallback) ? fallbackConfig.defaultFallback.length : 0;
  return {
    configured,
    pluginActive: hasConfiguredPlugin(plugins, pluginName),
    configPath: fallbackConfigPath,
    configExists: fs.existsSync(fallbackConfigPath),
    configEnabled: typeof fallbackConfig?.enabled === "boolean" ? fallbackConfig.enabled : undefined,
    agentFallbacks,
    defaultFallbacks,
    cooldownMs: typeof fallbackConfig?.cooldownMs === "number" ? fallbackConfig.cooldownMs : undefined,
    maxRetries: typeof fallbackConfig?.maxRetries === "number" ? fallbackConfig.maxRetries : undefined,
    logging: typeof fallbackConfig?.logging === "boolean" ? fallbackConfig.logging : undefined,
  };
}

function collectReferencedModels(modelRouting: any): Array<{ model: string; providerId?: string }> {
  const out: Array<{ model: string; providerId?: string }> = [];
  for (const decision of Array.isArray(modelRouting?.decisions) ? modelRouting.decisions : []) {
    for (const item of Array.isArray(decision?.chain) ? decision.chain : []) {
      if (typeof item?.model === "string" && item.model.trim()) {
        out.push({ model: item.model.trim(), providerId: typeof item.providerId === "string" ? item.providerId : undefined });
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = `${item.providerId || ""}/${item.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function modelCandidates(model: string, providerId?: string): string[] {
  const trimmed = model.trim();
  const candidates = [trimmed];
  if (providerId && !trimmed.includes("/")) candidates.push(`${providerId}/${trimmed}`);
  if (providerId === "google" && trimmed.startsWith("gemini-")) candidates.push(`google/${trimmed}`);
  return [...new Set(candidates)];
}

function openCodeModelsTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = readEnvAgentx("OPENCODE_MODELS_TIMEOUT_MS", env);
  const parsed = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30_000;
  return Math.min(120_000, Math.max(1, Math.trunc(parsed)));
}

function resolveOpenCodeModels(projectRoot: string, homeDir: string, modelRouting: any): DoctorReport["modelResolution"] {
  const referenced = collectReferencedModels(modelRouting);
  if (referenced.length === 0) {
    return {
      checked: false,
      availableModels: 0,
      referencedModels: 0,
      unresolved: [],
      message: "No routed/fallback models referenced.",
    };
  }

  const command = resolveCommand("opencode", { homeDir });
  if (!command) {
    return {
      checked: false,
      availableModels: 0,
      referencedModels: referenced.length,
      unresolved: [],
      message: "opencode is not on PATH; model resolution skipped.",
    };
  }

  const timeoutMs = openCodeModelsTimeoutMs();
  const result = spawnCommandSync(command, ["models"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, NO_COLOR: process.env.NO_COLOR ?? "1", OGB_STARTUP_SYNC: "0" },
  });
  if (result.error || result.status !== 0) {
    const errorCode = typeof (result.error as NodeJS.ErrnoException | undefined)?.code === "string"
      ? (result.error as NodeJS.ErrnoException).code
      : "";
    const errorMessage = result.error?.message ?? "";
    const timedOut = /ETIMEDOUT|timeout|timed out/i.test(`${errorCode} ${errorMessage}`);
    return {
      checked: false,
      command,
      availableModels: 0,
      referencedModels: referenced.length,
      unresolved: [],
      message: timedOut
        ? `opencode models timed out after ${timeoutMs}ms; model resolution skipped.`
        : result.error?.message ?? "opencode models failed; model resolution skipped.",
    };
  }

  const available = new Set(String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(line)));
  const unresolved = referenced
    .filter((item) => !modelCandidates(item.model, item.providerId).some((candidate) => available.has(candidate)))
    .map((item) => item.model)
    .sort();
  return {
    checked: true,
    command,
    availableModels: available.size,
    referencedModels: referenced.length,
    unresolved,
    message: unresolved.length
      ? `${unresolved.length} referenced model(s) were not found in opencode models.`
      : "All referenced routed/fallback models were found in opencode models.",
  };
}

function generatedMarkdownVersion(text: string | undefined): string | undefined {
  return text?.match(/^Generator:\s+(?:ogb|agentx)\s+(.+)$/m)?.[1]?.trim();
}

function missingBuiltIns(projectRoot: string, relDir: ".opencode/agents" | ".opencode/commands", names: string[]): string[] {
  return names.filter((name) => !fs.existsSync(path.join(projectRoot, relDir, `${name}.md`)));
}

function globalOpenCodeConfigPath(homeDir: string): string {
  const files = globalOpenCodeConfigFiles({ homeDir });
  return files.find((filePath) => fs.existsSync(filePath)) ?? path.join(globalOpenCodeConfigDir({ homeDir }), "opencode.json");
}

function globalTuiConfigPath(homeDir: string): string {
  const root = globalOpenCodeConfigDir({ homeDir });
  const files = [path.join(root, "tui.json"), path.join(root, "tui.jsonc")];
  return files.find((filePath) => fs.existsSync(filePath)) ?? files[0];
}

function globalTuiPluginPath(homeDir: string): string {
  return path.join(globalOpenCodeConfigDir({ homeDir }), ...GLOBAL_TUI_SIDEBAR_PLUGIN_PATH.split("/"));
}

function globalStartupPluginFilePath(homeDir: string): string {
  return path.join(globalOpenCodeConfigDir({ homeDir }), ...STARTUP_SYNC_PLUGIN_PATH.replace(/^\.opencode\//, "").split("/"));
}

function resolveConfigPathReference(configPath: string, reference: string, homeDir: string): string {
  if (reference.startsWith("~/")) return path.resolve(homeDir, reference.slice(2));
  if (path.isAbsolute(reference)) return path.resolve(reference);
  return path.resolve(path.dirname(configPath), reference);
}

function configReferencesInstruction(configPath: string, instructionPath: string, homeDir: string): boolean {
  const config = readJsonc(configPath);
  const instructions = Array.isArray(config?.instructions) ? config.instructions : [];
  const expected = path.resolve(instructionPath);
  return instructions.some((item: unknown) =>
    typeof item === "string" && resolveConfigPathReference(configPath, item, homeDir) === expected
  );
}

export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const inv = buildInventory({ projectRoot: paths.projectRoot, homeDir: paths.homeDir });
  fs.mkdirSync(path.dirname(paths.inventoryPath), { recursive: true });
  fs.writeFileSync(paths.inventoryPath, `${JSON.stringify(inv, null, 2)}\n`, "utf8");

  const expandedExists = fs.existsSync(paths.expandedGeminiPath);
  const expandedText = readText(paths.expandedGeminiPath);
  const opencodeConfig = paths.homeMode
    ? globalOpenCodeConfigPath(paths.homeDir)
    : projectConfigPath(paths.projectRoot);
  const opencodeConfigObject = readJsonc(opencodeConfig);
  const rulesyncCommand = resolveRulesyncCommand(paths.projectRoot);
  const state = readSyncState(paths.projectRoot, paths.homeDir);
  let warnings = collectWarnings(inv, paths.projectRoot, paths.homeDir);
  const errors: string[] = [];
  const generatedConfig = readJsonc(paths.generatedOpenCodeConfigPath);
  const extensionMap = readJsonc(paths.extensionMapPath);
  const nativeCapabilityReport = readJsonc(paths.nativeCapabilitiesPath);
  const modelRouting = readJsonc(paths.modelRoutingPath);
  recoverStaleStartupStatus({
    statusPath: paths.pluginStatusPath,
    lockPath: path.join(paths.generatedDir, "agentx-startup-sync.lock"),
    cwd: paths.projectRoot,
    reason: "doctor.recovered-stale",
  });
  const pluginStatus = readJsonc(paths.pluginStatusPath);
  const startupLock = readJsonc(path.join(paths.generatedDir, "agentx-startup-sync.lock"));
  const startupPid = Number(pluginStatus?.pid ?? startupLock?.pid);
  const rawStartupState = typeof pluginStatus?.state === "string" ? pluginStatus.state : undefined;
  const startupState = rawStartupState === "running" && !Number.isInteger(startupPid) ? "stale" : rawStartupState;
  const expandedGeminiVersion = generatedMarkdownVersion(expandedText);
  const expandedGeminiHasMarker = (expandedText?.startsWith(GENERATED_MARKDOWN_HEADER) || expandedText?.startsWith(LEGACY_GENERATED_MARKDOWN_HEADER)) ?? false;
  const generatedConfigVersion = typeof generatedConfig?._generated?.version === "string" ? generatedConfig._generated.version : undefined;
  const generatedConfigTool = generatedConfig?._generated?.tool;
  const generatedConfigHasMarker = (generatedConfigTool === BINARY || generatedConfigTool === LEGACY_BINARY) && typeof generatedConfig?._generated?.warning === "string";
  const homeGlobalConfigOk = paths.homeMode
    && fs.existsSync(opencodeConfig)
    && configReferencesInstruction(opencodeConfig, paths.expandedGeminiPath, paths.homeDir);
  const displayedConfigVersion = paths.homeMode
    ? (homeGlobalConfigOk ? "global config" : undefined)
    : generatedConfigVersion;
  const missingAgents = paths.homeMode ? [] : missingBuiltIns(paths.projectRoot, ".opencode/agents", BUILT_IN_AGENTS.map((agent) => agent.name));
  const missingCommands = paths.homeMode ? [] : missingBuiltIns(paths.projectRoot, ".opencode/commands", BUILT_IN_COMMANDS.map((command) => command.name));
  const startupSync = {
    projectPlugin: !paths.homeMode && fs.existsSync(path.join(paths.projectRoot, ...STARTUP_SYNC_PLUGIN_PATH.split("/"))),
    projectConfig: !paths.homeMode && fs.existsSync(path.join(paths.projectRoot, ".opencode", "generated", "agentx-startup-sync.json")),
    globalPlugin: fs.existsSync(globalStartupPluginFilePath(paths.homeDir)),
    globalConfig: fs.existsSync(path.join(paths.generatedDir, "agentx-startup-sync.json")),
    lastState: startupState,
    lastStartedAt: typeof pluginStatus?.startedAt === "string" ? pluginStatus.startedAt : undefined,
    lastFinishedAt: typeof pluginStatus?.finishedAt === "string" ? pluginStatus.finishedAt : undefined,
    lastPid: Number.isInteger(startupPid) ? startupPid : undefined,
  };
  const globalStartupPluginPath = globalStartupPluginFilePath(paths.homeDir);
  const globalConfigPath = globalOpenCodeConfigPath(paths.homeDir);
  const globalStartupPluginConfigured = configHasPluginSpec(globalConfigPath, globalStartupPluginSpec(globalStartupPluginPath))
    || configHasPluginSpec(globalConfigPath, pathToFileURL(globalStartupPluginPath).href);
  const legacyGlobalStartupPluginConfig = legacyGlobalStartupPluginSpecs(globalConfigPath);
  const modelRoutingDecisions = Array.isArray(modelRouting?.decisions) ? modelRouting.decisions : [];
  const extensionCompatibility = {
    mapExists: fs.existsSync(paths.extensionMapPath),
    extensions: Array.isArray(extensionMap?.extensions) ? extensionMap.extensions.length : 0,
    projectedCommands: Array.isArray(extensionMap?.projectedCommands) ? extensionMap.projectedCommands.length : 0,
    availableAgents: Array.isArray(extensionMap?.extensions)
      ? extensionMap.extensions.reduce((sum: number, extension: any) => sum + (Array.isArray(extension.agents) ? extension.agents.length : 0), 0)
      : 0,
    modelFallbacks: Array.isArray(extensionMap?.modelFallbacks) ? extensionMap.modelFallbacks.length : 0,
    modelRoutingReport: fs.existsSync(paths.modelRoutingPath),
    modelRoutingEnabled: modelRouting?.enabled !== false,
    modelRoutingDecisions: modelRoutingDecisions.length,
    modelRoutingRouted: modelRoutingDecisions.filter((decision: any) => Number(decision?.selected?.chainIndex ?? 0) > 0).length,
    modelRoutingSkipped: modelRoutingDecisions.reduce((sum: number, decision: any) => sum + (Array.isArray(decision?.skipped) ? decision.skipped.length : 0), 0),
    ohMyOpenAgentConfig: fs.existsSync(paths.ohMyOpenAgentConfigPath),
    ohMyOpenAgentPlugin: configHasPlugin(path.join(paths.projectRoot, "opencode.jsonc"), /oh-my-(openagent|opencode)/i)
      || globalOpenCodeConfigFiles({ homeDir: paths.homeDir }).some((filePath) => configHasPlugin(filePath, /oh-my-(openagent|opencode)/i)),
    hooks: Array.isArray(extensionMap?.extensions)
      ? extensionMap.extensions.reduce((sum: number, extension: any) => sum + (Array.isArray(extension.hooks) ? extension.hooks.length : 0), 0)
      : 0,
    scripts: Array.isArray(extensionMap?.extensions)
      ? extensionMap.extensions.reduce((sum: number, extension: any) => sum + (Array.isArray(extension.scripts) ? extension.scripts.length : 0), 0)
      : 0,
  };
  const runtimeFallback = readRuntimeFallback(paths.projectRoot, paths.homeDir);
  const configuredPlugins = listConfiguredPlugins(paths.projectRoot, paths.homeDir);
  const nativeCapabilitySummary = summarizeNativeCapabilityReport(nativeCapabilityReport, paths.nativeCapabilitiesPath);
  const nativeCapabilities = {
    ...nativeCapabilitySummary,
    reportExists: fs.existsSync(paths.nativeCapabilitiesPath),
    setupCompatibilityProjections: nativeSetupCompatibilityProjectionsFromState(state, nativeCapabilitySummary.validatedNative),
  };
  const modelResolution = resolveOpenCodeModels(paths.projectRoot, paths.homeDir, modelRouting);
  warnings.push(...diagnoseOpenCodeMcpConfig(opencodeConfigObject?.mcp, inv.mcps, {
    storedEnvValues: readMcpEnvValues({ homeDir: paths.homeDir }),
    processEnv: process.env,
  }));
  const mcpCommandCheck = inv.mcps.map((mcp) => {
    if (mcp.type !== "stdio") return { name: mcp.name, command: mcp.command, ok: true };
    if (!mcp.command) return { name: mcp.name, command: mcp.command, ok: false, message: "Missing stdio command" };
    const ok = commandExists(mcp.command, { homeDir: paths.homeDir });
    return {
      name: mcp.name,
      command: mcp.command,
      ok,
      message: ok ? undefined : `Command not found on PATH: ${mcp.command}`,
    };
  });

  if (paths.homeMode) {
    if (hasGlobalGeminiContextSource(paths.homeDir, inv)) {
      if (!expandedExists) warnings.push("Missing global expanded Gemini context. Run agentx sync.");
      else if (!expandedGeminiHasMarker) warnings.push("Global expanded GEMINI file is missing generated DO NOT EDIT marker. Run agentx sync.");
      else if (expandedGeminiVersion && expandedGeminiVersion !== AGENTX_VERSION) warnings.push(`Global expanded GEMINI file was generated by ${DISPLAY} ${expandedGeminiVersion}; current ${DISPLAY} is ${AGENTX_VERSION}. Run ${BINARY} sync.`);

      if (!fs.existsSync(opencodeConfig)) warnings.push(`Missing global OpenCode config. Run ${BINARY} setup-ux or ${BINARY} sync.`);
      else if (!configReferencesInstruction(opencodeConfig, paths.expandedGeminiPath, paths.homeDir)) warnings.push(`Global OpenCode config does not reference the ${DISPLAY} expanded Gemini context. Run ${BINARY} sync.`);
    }
    if (inv.mcps.length > 0 && fs.existsSync(opencodeConfig)) {
      const configuredMcps = configuredMcpNames(opencodeConfig);
      const missingMcps = inv.mcps
        .filter((mcp) => mcp.status === "ok" || mcp.status === "warning")
        .map((mcp) => mcp.name)
        .filter((name) => !configuredMcps.has(name));
      if (missingMcps.length > 0) warnings.push(`Global OpenCode config is missing Gemini MCP server(s): ${missingMcps.join(", ")}. Run agentx sync.`);
    }
  } else {
    if (!expandedExists) warnings.push("Missing .opencode/generated/GEMINI.expanded.md. Run agentx flatten.");
    else if (!expandedGeminiHasMarker) warnings.push("Expanded GEMINI file is missing generated DO NOT EDIT marker. Run agentx sync.");
    else if (expandedGeminiVersion && expandedGeminiVersion !== AGENTX_VERSION) warnings.push(`Expanded GEMINI file was generated by ${DISPLAY} ${expandedGeminiVersion}; current ${DISPLAY} is ${AGENTX_VERSION}. Run ${BINARY} sync.`);

    if (!fs.existsSync(paths.generatedOpenCodeConfigPath)) warnings.push(`Missing .opencode/generated/opencode.generated.json. Run ${BINARY} sync.`);
    else if (!generatedConfigHasMarker) warnings.push(`Generated OpenCode config is missing ${DISPLAY} DO NOT EDIT metadata. Run ${BINARY} sync.`);
    else if (generatedConfigVersion && generatedConfigVersion !== AGENTX_VERSION) warnings.push(`Generated OpenCode config was generated by ${DISPLAY} ${generatedConfigVersion}; current ${DISPLAY} is ${AGENTX_VERSION}. Run ${BINARY} sync.`);
  }
  if (extensionCompatibility.mapExists) {
    warnings = warnings.filter((warning) => !warning.startsWith("Extension needs review:"));
    for (const warning of extensionMap?.warnings ?? []) warnings.push(`Extension projection warning: ${warning}`);
  }
  if (!paths.homeMode && inv.extensions.length > 0 && !extensionCompatibility.mapExists) warnings.push("Missing .opencode/generated/agentx-extension-map.json. Run agentx sync.");
  else if (extensionMap?._generated?.version && extensionMap._generated.version !== AGENTX_VERSION) warnings.push(`Extension map was generated by ${DISPLAY} ${extensionMap._generated.version}; current ${DISPLAY} is ${AGENTX_VERSION}. Run ${BINARY} sync.`);

  if (state?.version && state.version !== AGENTX_VERSION) warnings.push(`Sync state was written by ${DISPLAY} ${state.version}; current ${DISPLAY} is ${AGENTX_VERSION}. Run ${BINARY} sync.`);
  if (missingAgents.length) warnings.push(`Missing built-in OpenCode agents: ${missingAgents.join(", ")}. Run agentx sync.`);
  if (missingCommands.length) warnings.push(`Missing built-in OpenCode commands: ${missingCommands.join(", ")}. Run agentx sync.`);
  for (const check of mcpCommandCheck) if (!check.ok && check.message) warnings.push(`MCP command warning: ${check.name} - ${check.message}`);

  if (!paths.homeMode) {
    if (!fs.existsSync(opencodeConfig)) warnings.push("Missing opencode.jsonc. Run agentx import or agentx init.");
    else if (!configReferencesExpandedGemini(paths.projectRoot)) warnings.push("opencode.jsonc does not reference .opencode/generated/GEMINI.expanded.md.");
  }
  if (!paths.homeMode && !rulesyncCommand) warnings.push("Rulesync is unavailable; agentx sync will use bridge-native projection only.");
  if (state?.lastRulesync?.conflicts?.length) warnings.push(`Rulesync has unresolved conflicts: ${state.lastRulesync.conflicts.join(", ")}`);
  else if (state?.lastRulesync?.status === "error") warnings.push("Last Rulesync run failed. Run agentx sync --rulesync require --dry-run for details.");
  if (paths.homeMode && startupSync.globalPlugin && !globalStartupPluginConfigured) warnings.push(`Global ${DISPLAY} startup plugin exists but is not listed in the OpenCode global plugin config. Run ${BINARY} setup-ux --reset-global.`);
  if (legacyGlobalStartupPluginConfig.length > 0) warnings.push(`Global OpenCode config still references legacy startup plugin spec(s): ${legacyGlobalStartupPluginConfig.join(", ")}. Run ${BINARY} setup-ux --force to replace them with the absolute local plugin URL, then restart OpenCode.`);
  if (globalStartupPluginConfigured) {
    if (!startupSync.globalPlugin) {
      warnings.push(`Global ${DISPLAY} startup plugin is missing. Run ${BINARY} check to repair it automatically, then restart OpenCode.`);
    } else if (sha256File(globalStartupPluginPath) !== sha256Text(STARTUP_SYNC_PLUGIN_SOURCE)) {
      warnings.push(`Global ${DISPLAY} startup plugin is stale. Run ${BINARY} check to repair it automatically, then restart OpenCode.`);
    }
  }
  const globalTuiConfig = globalTuiConfigPath(paths.homeDir);
  if (configHasPluginSpec(globalTuiConfig, TUI_SIDEBAR_PLUGIN_SPEC)) {
    const missingTuiRuntime = missingGlobalTuiRuntimeDependencies(globalOpenCodeConfigDir({ homeDir: paths.homeDir }));
    if (missingTuiRuntime.length > 0) warnings.push(`Global ${DISPLAY} TUI runtime dependencies are missing: ${missingTuiRuntime.join(", ")}. Run ${BINARY} setup-ux.`);
    const globalTuiPlugin = globalTuiPluginPath(paths.homeDir);
    if (!fs.existsSync(globalTuiPlugin)) {
      warnings.push(`Global ${DISPLAY} TUI sidebar plugin is missing. Run ${BINARY} check to repair it automatically, then restart OpenCode.`);
    } else if (sha256File(globalTuiPlugin) !== sha256Text(TUI_SIDEBAR_PLUGIN_SOURCE)) {
      warnings.push(`Global ${DISPLAY} TUI sidebar plugin is stale. Run ${BINARY} check to repair it automatically, then restart OpenCode.`);
    }
  }
  if (startupSync.lastState === "fail") warnings.push(`Last OpenCode startup sync failed. Run ${BINARY} dashboard for details.`);
  if (startupSync.lastState === "stale") warnings.push("OpenCode startup sync got stuck in running, but the process no longer exists. Restart OpenCode to load the new plugin.");
  if (!paths.homeMode && extensionCompatibility.modelFallbacks > 0 && !extensionCompatibility.modelRoutingReport) {
    warnings.push(`Model fallbacks are configured, but the ${DISPLAY} model routing report is missing. Run ${BINARY} sync.`);
  } else if (modelRouting?.version && modelRouting.version !== AGENTX_VERSION) {
    warnings.push(`Model routing report was generated by ${DISPLAY} ${modelRouting.version}; current ${DISPLAY} is ${AGENTX_VERSION}. Run ${BINARY} sync.`);
  }
  if (runtimeFallback.configured && !runtimeFallback.pluginActive) warnings.push(`opencode-auto-fallback is enabled in ${DISPLAY} config, but the OpenCode plugin is not active; disable externalPlugins.autoFallback or install a compatible plugin version.`);
  if (runtimeFallback.configured && !runtimeFallback.configExists) warnings.push(`opencode-auto-fallback config is missing: ${runtimeFallback.configPath}. Run ${BINARY} sync.`);
  if (runtimeFallback.configured && runtimeFallback.configEnabled === false) warnings.push("opencode-auto-fallback config exists but is disabled.");
  const nativeSources = detectNativeCapabilitySources({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    currentOpenCodePlugins: configuredPlugins,
  });
  const hasPluginNativeSource = nativeSources.some((source) => capabilityEntry(source.entityId, "opencode")?.nativeInstall?.kind === "opencode-plugin");
  if (hasPluginNativeSource && !nativeCapabilities.reportExists) warnings.push("Native capability report is missing. Run agentx sync.");
  if (nativeCapabilityReport?._generated?.version && nativeCapabilityReport._generated.version !== AGENTX_VERSION) {
    warnings.push(`Native capability report was generated by ${DISPLAY} ${nativeCapabilityReport._generated.version}; current ${DISPLAY} is ${AGENTX_VERSION}. Run ${BINARY} sync.`);
  }
  for (const decision of Array.isArray(nativeCapabilityReport?.decisions) ? nativeCapabilityReport.decisions : []) {
    const plugin = decision?.nativeInstall?.kind === "opencode-plugin" ? decision.nativeInstall.plugin : undefined;
    if ((decision?.action === "install_native" || decision?.action === "use_existing_native") && plugin && !hasConfiguredPlugin(configuredPlugins, plugin)) {
      warnings.push(`Native capability warning: ${decision.displayName ?? decision.entityId} expects OpenCode plugin ${plugin}, but it is not configured. Run agentx sync.`);
    }
  }
  for (const projection of nativeCapabilities.setupCompatibilityProjections) {
    if (projection.status === "stale") {
      warnings.push(`Native setup projection warning: ${projection.entityId} setup projection ${projection.path} remains managed, but no validated native source is active. Review local edits, then run agentx sync --force if it is safe to remove stale generated setup.`);
    }
  }
  for (const warning of nativeCapabilities.warnings) warnings.push(`Native capability warning: ${warning}`);
  for (const model of modelResolution.unresolved) warnings.push(`Model resolution warning: ${model} was not found in opencode models.`);

  const report: DoctorReport = {
    version: AGENTX_VERSION,
    projectRoot: paths.projectRoot,
    expandedContext: expandedExists ? paths.expandedGeminiPath : null,
    opencodeConfig: {
      path: opencodeConfig,
      exists: fs.existsSync(opencodeConfig),
      referencesExpandedGemini: fs.existsSync(opencodeConfig) && (paths.homeMode
        ? configReferencesInstruction(opencodeConfig, paths.expandedGeminiPath, paths.homeDir)
        : configReferencesExpandedGemini(paths.projectRoot)),
    },
    rulesync: {
      available: Boolean(rulesyncCommand),
      version: rulesyncCommand?.version,
      lastStatus: state?.lastRulesync?.status,
      lastPromoted: state?.lastRulesync?.promoted.length ?? 0,
      lastConflicts: state?.lastRulesync?.conflicts.length ?? 0,
    },
    generated: {
      expandedGeminiVersion,
      expandedGeminiHasMarker,
      generatedConfigVersion: displayedConfigVersion,
      generatedConfigHasMarker: paths.homeMode ? homeGlobalConfigOk : generatedConfigHasMarker,
      syncStateVersion: state?.version,
    },
    builtIns: {
      missingAgents,
      missingCommands,
    },
    startupSync,
    extensionCompatibility,
    runtimeFallback,
    nativeCapabilities,
    modelResolution,
    mcpCommandCheck,
    counts: {
      geminiFiles: inv.geminiFiles.length,
      imports: statusCounts(inv.imports),
      mcps: statusCounts(inv.mcps),
      skills: opencodeStatusCounts(inv.skills),
      agents: opencodeStatusCounts(inv.agents),
      commands: opencodeStatusCounts(inv.commands),
      hooks: statusCounts(inv.hooks),
      extensions: statusCounts(inv.extensions),
    },
    warnings,
    errors,
  };

  fs.mkdirSync(path.dirname(paths.doctorPath), { recursive: true });
  fs.writeFileSync(paths.doctorPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.strict && warnings.length > 0) process.exitCode = 1;
  if (errors.length > 0) process.exitCode = 2;
  return report;
}
