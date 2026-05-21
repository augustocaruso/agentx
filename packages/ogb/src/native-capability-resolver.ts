import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { commandExists, resolveCommand } from "./command-resolution.js";
import { readEnvAgentx } from "./env.js";
import {
  capabilityEntry,
  entityIdFromGeminiExtensionName,
  entityIdFromMcpServer,
  entityIdFromOpenCodePlugin,
  entityIdFromSkillName,
  nativeCapabilityEntriesForTarget,
  pluginPackageName,
  type NativeCapabilityEntityId,
  type NativeCapabilityEntry,
  type NativeCapabilityTarget,
  type NativeInstallSpec,
  type NativeSetupSurface,
} from "./native-capability-registry.js";
import { globalOpenCodeConfigFiles } from "./opencode-paths.js";
import { spawnCommandSync } from "./process.js";
import { OGB_VERSION } from "./types.js";

export type NativeCapabilitySourceKind = "gemini-extension" | "gemini-skill" | "gemini-mcp" | "opencode-plugin" | "opencode-mcp";
export type NativeCapabilityAction = "blocked" | "fallback_compat" | "install_native" | "replicate_compat" | "use_existing_native";
export type NativeCapabilitySmokeStatus = "failed" | "passed" | "skipped";

export interface NativeCapabilitySource {
  entityId: NativeCapabilityEntityId;
  sourceKind: NativeCapabilitySourceKind;
  sourceName: string;
  sourcePath?: string;
}

export interface NativeCapabilitySmokeResult {
  status: NativeCapabilitySmokeStatus;
  message: string;
  command?: string[];
}

export interface NativeCapabilityDecision {
  entityId: NativeCapabilityEntityId;
  displayName: string;
  target: NativeCapabilityTarget;
  action: NativeCapabilityAction;
  nativeStatus: NativeCapabilityEntry["nativeStatus"];
  nativeInstall?: NativeInstallSpec;
  sources: NativeCapabilitySource[];
  smoke: NativeCapabilitySmokeResult;
  portableSurfaces: NativeCapabilityEntry["portableSurfaces"];
  surfacesNeedingReview: NativeCapabilityEntry["surfacesNeedingReview"];
  setupSurfaces: NativeSetupSurface[];
  managedPortPrefixes: string[];
  message: string;
}

export interface NativeCapabilityReport {
  _generated: {
    tool: "ogb";
    version: string;
    warning: string;
  };
  projectRoot: string;
  homeDir: string;
  target: NativeCapabilityTarget;
  generatedAt: string;
  decisions: NativeCapabilityDecision[];
  openCodePlugins: string[];
  suppressedExtensionNames: string[];
  suppressedSkillNames: string[];
  validatedNative: NativeCapabilityEntityId[];
  fallbackCompat: NativeCapabilityEntityId[];
  blocked: NativeCapabilityEntityId[];
  replicatedCompat: NativeCapabilityEntityId[];
  warnings: string[];
}

export interface NativeCapabilitySummary {
  reportPath?: string;
  decisions: number;
  openCodePlugins: string[];
  suppressedExtensionNames: string[];
  suppressedSkillNames: string[];
  validatedNative: NativeCapabilityEntityId[];
  fallbackCompat: NativeCapabilityEntityId[];
  blocked: NativeCapabilityEntityId[];
  replicatedCompat: NativeCapabilityEntityId[];
  warnings: string[];
}

export interface ResolveNativeCapabilitiesOptions {
  projectRoot: string;
  homeDir: string;
  target: NativeCapabilityTarget;
  sources: NativeCapabilitySource[];
  currentOpenCodePlugins?: string[];
  availableMcpServers?: string[];
  previousReport?: NativeCapabilityReport;
  smoke?: (entry: NativeCapabilityEntry, action: Exclude<NativeCapabilityAction, "fallback_compat" | "blocked" | "replicate_compat">) => NativeCapabilitySmokeResult;
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function readJsonc(filePath: string): any {
  try {
    return parseJsonc(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function readJson(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function listDirs(root: string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function listOpenCodePlugins(projectRoot: string, homeDir: string): string[] {
  const files = [
    path.join(projectRoot, "opencode.jsonc"),
    path.join(projectRoot, "opencode.json"),
    ...globalOpenCodeConfigFiles({ homeDir }),
  ];
  const plugins: string[] = [];
  for (const filePath of files) {
    const config = readJsonc(filePath);
    if (!Array.isArray(config?.plugin)) continue;
    for (const plugin of config.plugin) if (typeof plugin === "string") plugins.push(plugin);
  }
  return uniqueSorted(plugins);
}

function collectMcpSourcesFromObject(config: unknown, sourceKind: NativeCapabilitySourceKind): NativeCapabilitySource[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const mcpServers = (config as Record<string, unknown>).mcpServers;
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) return [];
  const out: NativeCapabilitySource[] = [];
  for (const [name, server] of Object.entries(mcpServers)) {
    const entityId = entityIdFromMcpServer(name, server);
    if (entityId) out.push({ entityId, sourceKind, sourceName: name });
  }
  return out;
}

export function detectNativeCapabilitySources(options: {
  projectRoot: string;
  homeDir: string;
  currentOpenCodePlugins?: string[];
  ignoredGeminiSkillDirs?: Iterable<string>;
}): NativeCapabilitySource[] {
  const sources: NativeCapabilitySource[] = [];
  const seen = new Set<string>();
  const ignoredGeminiSkillDirs = new Set(
    [...(options.ignoredGeminiSkillDirs ?? [])].map((dir) => path.resolve(dir)),
  );
  const add = (source: NativeCapabilitySource) => {
    const key = `${source.entityId}:${source.sourceKind}:${source.sourceName}:${source.sourcePath ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(source);
  };

  for (const root of [
    path.join(options.projectRoot, ".gemini", "extensions"),
    path.join(options.homeDir, ".gemini", "extensions"),
  ]) {
    for (const dir of listDirs(root)) {
      const name = path.basename(dir);
      const entityId = entityIdFromGeminiExtensionName(name);
      if (entityId) add({ entityId, sourceKind: "gemini-extension", sourceName: name, sourcePath: dir });
      const manifest = readJson(path.join(dir, "gemini-extension.json"));
      for (const source of collectMcpSourcesFromObject(manifest, "gemini-mcp")) add({ ...source, sourcePath: path.join(dir, "gemini-extension.json") });
    }
  }

  for (const root of [
    path.join(options.projectRoot, ".gemini", "skills"),
    path.join(options.homeDir, ".gemini", "skills"),
  ]) {
    for (const dir of listDirs(root)) {
      if (ignoredGeminiSkillDirs.has(path.resolve(dir))) continue;
      const name = path.basename(dir);
      const entityId = entityIdFromSkillName(name);
      if (entityId) add({ entityId, sourceKind: "gemini-skill", sourceName: name, sourcePath: dir });
    }
  }

  for (const settingsPath of [
    path.join(options.projectRoot, ".gemini", "settings.json"),
    path.join(options.homeDir, ".gemini", "settings.json"),
  ]) {
    for (const source of collectMcpSourcesFromObject(readJson(settingsPath), "gemini-mcp")) add({ ...source, sourcePath: settingsPath });
  }

  for (const plugin of options.currentOpenCodePlugins ?? listOpenCodePlugins(options.projectRoot, options.homeDir)) {
    const entityId = entityIdFromOpenCodePlugin(plugin);
    if (entityId) add({ entityId, sourceKind: "opencode-plugin", sourceName: plugin });
  }

  return sources.sort((a, b) => `${a.entityId}:${a.sourceKind}:${a.sourceName}`.localeCompare(`${b.entityId}:${b.sourceKind}:${b.sourceName}`));
}

function mergePluginSpecs(existing: string[], additions: string[]): string[] {
  const byPackage = new Map(existing.map((plugin) => [pluginPackageName(plugin), plugin]));
  for (const plugin of additions) {
    const name = pluginPackageName(plugin);
    if (!byPackage.has(name)) byPackage.set(name, plugin);
  }
  return [...byPackage.values()].sort((a, b) => pluginPackageName(a).localeCompare(pluginPackageName(b)));
}

function groupedSources(sources: NativeCapabilitySource[]): Map<NativeCapabilityEntityId, NativeCapabilitySource[]> {
  const out = new Map<NativeCapabilityEntityId, NativeCapabilitySource[]>();
  for (const source of sources) out.set(source.entityId, [...(out.get(source.entityId) ?? []), source]);
  return out;
}

function skippedSmoke(message: string): NativeCapabilitySmokeResult {
  return { status: "skipped", message };
}

function nativeInstallKey(install: NativeInstallSpec | undefined): string {
  return JSON.stringify(install ?? null);
}

function reusablePreviousSmoke(options: {
  previousReport?: NativeCapabilityReport;
  entityId: NativeCapabilityEntityId;
  nativeInstall?: NativeInstallSpec;
  target: NativeCapabilityTarget;
}): NativeCapabilitySmokeResult | undefined {
  const previous = options.previousReport?.decisions.find((decision) =>
    decision.entityId === options.entityId
    && decision.target === options.target
    && (decision.action === "install_native" || decision.action === "use_existing_native")
    && decision.smoke.status === "passed"
    && nativeInstallKey(decision.nativeInstall) === nativeInstallKey(options.nativeInstall)
  );
  if (!previous) return undefined;
  return {
    status: "passed",
    message: `Reused previous native smoke evidence: ${previous.smoke.message}`,
    command: previous.smoke.command,
  };
}

export function resolveNativeCapabilities(options: ResolveNativeCapabilitiesOptions): NativeCapabilityReport {
  const grouped = groupedSources(options.sources);
  const currentPackages = new Set((options.currentOpenCodePlugins ?? []).map(pluginPackageName));
  const nativePlugins: string[] = [];
  const decisions: NativeCapabilityDecision[] = [];
  const suppressedExtensionNames: string[] = [];
  const suppressedSkillNames: string[] = [];
  const warnings: string[] = [];

  for (const [entityId, sources] of grouped) {
    const entry = capabilityEntry(entityId, options.target);
    if (!entry) continue;
    const base = {
      entityId,
      displayName: entry.displayName,
      target: options.target,
      nativeStatus: entry.nativeStatus,
      nativeInstall: entry.nativeInstall,
      sources,
      portableSurfaces: entry.portableSurfaces,
      surfacesNeedingReview: entry.surfacesNeedingReview,
      setupSurfaces: entry.setupSurfaces ?? [],
      managedPortPrefixes: entry.managedPortPrefixes,
    };

    if (entry.nativeStatus !== "available" || !entry.nativeInstall) {
      const canReplicateSetup = (entry.setupSurfaces?.length ?? 0) > 0;
      decisions.push({
        ...base,
        action: canReplicateSetup ? "replicate_compat" : "fallback_compat",
        smoke: skippedSmoke(canReplicateSetup
          ? "No validated native install is registered for this target; setup surfaces will be replicated through compatibility resources."
          : "No validated native install is registered for this target."),
        message: canReplicateSetup
          ? `${entry.displayName} has no native ${options.target} install; replicating setup through compatibility resources.`
          : `${entry.displayName} has no validated native ${options.target} install; keeping compatibility projection.`,
      });
      continue;
    }

    if (entry.nativeInstall.kind === "opencode-mcp") {
      const available = new Set(options.availableMcpServers ?? []);
      const sourceHasMcp = sources.some((source) => source.sourceKind === "gemini-mcp" || source.sourceKind === "opencode-mcp");
      const active = available.has(entry.nativeInstall.mcpName) || sourceHasMcp;
      decisions.push({
        ...base,
        action: active ? "use_existing_native" : "fallback_compat",
        smoke: active
          ? { status: "passed", message: `${entry.displayName} MCP is available through generated OpenCode MCP config.` }
          : skippedSmoke(`${entry.displayName} MCP source was not available.`),
        message: active
          ? `${entry.displayName} uses OpenCode MCP config as the native surface.`
          : `${entry.displayName} MCP is not active; keeping compatibility projection.`,
      });
      continue;
    }

    nativePlugins.push(entry.nativeInstall.plugin);
    const pluginPackage = pluginPackageName(entry.nativeInstall.plugin);
    const pluginAlreadyConfigured = currentPackages.has(pluginPackage);
    const intendedAction: "install_native" | "use_existing_native" = pluginAlreadyConfigured ? "use_existing_native" : "install_native";
    const smoke = pluginAlreadyConfigured
      ? reusablePreviousSmoke({ previousReport: options.previousReport, entityId, nativeInstall: entry.nativeInstall, target: options.target })
        ?? options.smoke?.(entry, intendedAction)
        ?? skippedSmoke("Native runtime smoke was not run.")
      : options.smoke?.(entry, intendedAction) ?? skippedSmoke("Native runtime smoke was not run.");
    if (smoke.status !== "passed") {
      const message = `${entry.displayName} native install was not confirmed: ${smoke.message}; keeping compatibility projection.`;
      warnings.push(message);
      decisions.push({
        ...base,
        action: "fallback_compat",
        smoke,
        message,
      });
      continue;
    }

    for (const source of sources) {
      if (source.sourceKind === "gemini-extension") suppressedExtensionNames.push(source.sourceName);
      if (source.sourceKind === "gemini-skill") suppressedSkillNames.push(source.sourceName);
    }
    decisions.push({
      ...base,
      action: intendedAction,
      smoke,
      message: pluginAlreadyConfigured
        ? `${entry.displayName} native OpenCode plugin is configured and passed smoke.`
        : `${entry.displayName} native OpenCode plugin was added and passed smoke.`,
    });
  }

  return {
    _generated: {
      tool: "ogb",
      version: OGB_VERSION,
      warning: "DO NOT EDIT. Regenerate with ogb sync.",
    },
    projectRoot: options.projectRoot,
    homeDir: options.homeDir,
    target: options.target,
    generatedAt: new Date().toISOString(),
    decisions: decisions.sort((a, b) => a.entityId.localeCompare(b.entityId)),
    openCodePlugins: mergePluginSpecs([], nativePlugins),
    suppressedExtensionNames: uniqueSorted(suppressedExtensionNames),
    suppressedSkillNames: uniqueSorted(suppressedSkillNames),
    validatedNative: uniqueSorted(decisions
      .filter((decision) => decision.action === "install_native" || decision.action === "use_existing_native")
      .map((decision) => decision.entityId)),
    fallbackCompat: uniqueSorted(decisions.filter((decision) => decision.action === "fallback_compat").map((decision) => decision.entityId)),
    blocked: uniqueSorted(decisions.filter((decision) => decision.action === "blocked").map((decision) => decision.entityId)),
    replicatedCompat: uniqueSorted(decisions.filter((decision) => decision.action === "replicate_compat").map((decision) => decision.entityId)),
    warnings: uniqueSorted(warnings),
  };
}

function smokeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(readEnvAgentx("NATIVE_CAPABILITY_SMOKE_TIMEOUT_MS", env));
  if (!Number.isFinite(parsed) || parsed <= 0) return 15_000;
  return Math.min(120_000, Math.max(1, Math.trunc(parsed)));
}

export function createOpenCodeNativeSmoke(options: {
  projectRoot: string;
  homeDir: string;
  env?: NodeJS.ProcessEnv;
}): ResolveNativeCapabilitiesOptions["smoke"] {
  const probes = new Map<string, { output: string; error?: string; status?: number | null; command: string[] }>();
  return (entry) => {
    const install = entry.nativeInstall;
    if (install?.kind !== "opencode-plugin") return { status: "passed", message: "No plugin runtime smoke required." };
    const command = resolveCommand("opencode", { homeDir: options.homeDir, env: options.env });
    if (!command || !commandExists(command, { homeDir: options.homeDir, env: options.env, includeLookup: false, includeNpmPrefix: false })) {
      return { status: "skipped", message: "OpenCode command was not found on PATH.", command: ["opencode", "debug", "info"] };
    }
    const args = install.smokeCommand?.slice(1) ?? ["debug", "info"];
    const cacheKey = JSON.stringify({ command, args, cwd: options.projectRoot });
    let probe = probes.get(cacheKey);
    if (!probe) {
      const result = spawnCommandSync(command, args, {
        cwd: options.projectRoot,
        encoding: "utf8",
        timeout: smokeTimeoutMs(options.env),
        env: { ...process.env, ...(options.env ?? {}), NO_COLOR: "1", OGB_STARTUP_SYNC: "0" },
      });
      probe = {
        output: `${result.stdout || ""}\n${result.stderr || ""}`,
        error: result.error?.message,
        status: result.status,
        command: [command, ...args],
      };
      probes.set(cacheKey, probe);
    }
    if (probe.error || probe.status !== 0) {
      return {
        status: "failed",
        message: probe.error ?? (probe.output.trim() || "opencode debug info failed."),
        command: probe.command,
      };
    }
    const hints = install.smokeOutputHints ?? [];
    const hasHints = hints.length === 0 || hints.some((hint) => probe.output.toLowerCase().includes(hint.toLowerCase()));
    return {
      status: hasHints ? "passed" : "failed",
      message: hasHints ? "opencode debug info completed and matched native capability smoke hints." : `opencode debug info did not mention ${hints.join(", ")}.`,
      command: probe.command,
    };
  };
}

export function summarizeNativeCapabilityReport(report: NativeCapabilityReport | undefined, reportPath?: string): NativeCapabilitySummary {
  return {
    reportPath,
    decisions: Array.isArray(report?.decisions) ? report.decisions.length : 0,
    openCodePlugins: Array.isArray(report?.openCodePlugins) ? report.openCodePlugins : [],
    suppressedExtensionNames: Array.isArray(report?.suppressedExtensionNames) ? report.suppressedExtensionNames : [],
    suppressedSkillNames: Array.isArray(report?.suppressedSkillNames) ? report.suppressedSkillNames : [],
    validatedNative: Array.isArray(report?.validatedNative) ? report.validatedNative : [],
    fallbackCompat: Array.isArray(report?.fallbackCompat) ? report.fallbackCompat : [],
    blocked: Array.isArray(report?.blocked) ? report.blocked : [],
    replicatedCompat: Array.isArray(report?.replicatedCompat) ? report.replicatedCompat : [],
    warnings: Array.isArray(report?.warnings) ? report.warnings : [],
  };
}
