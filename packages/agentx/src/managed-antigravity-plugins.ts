import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandExists } from "./command-resolution.js";
import {
  nativeCapabilityEntriesForTarget,
  type AntigravityPluginNativeInstall,
  type NativeCapabilityEntityId,
} from "./native-capability-registry.js";
import { spawnCommandSync } from "./process.js";
import { AGENTX_VERSION } from "./types.js";

export interface ManagedAntigravityPluginSpec {
  entityId: NativeCapabilityEntityId;
  displayName: string;
  pluginName: string;
  source: string;
  ref: string;
}

export interface AntigravityPluginDestinations {
  primary: string;
  mirrors: string[];
}

export interface FetchedAntigravityPluginSource {
  sourceDir: string;
  revision?: string;
}

export type FetchManagedAntigravityPluginSource = (
  spec: ManagedAntigravityPluginSpec,
  options: {
    homeDir: string;
    cacheDir: string;
    gitBin?: string;
  },
) => FetchedAntigravityPluginSource;

export type DetectAntigravityCli = (options: {
  homeDir: string;
  agyBin?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}) => boolean;

export type ManagedAntigravityPluginStatus = "current" | "installed" | "preview" | "skipped" | "updated" | "error";

export interface ManagedAntigravityPluginResult {
  entityId: NativeCapabilityEntityId;
  displayName: string;
  pluginName: string;
  source: string;
  ref: string;
  status: ManagedAntigravityPluginStatus;
  reason?: string;
  revision?: string;
  destinations: AntigravityPluginDestinations;
  error?: string;
}

export interface ManagedAntigravityPluginUpdateReport {
  schema: "agentx.managed-antigravity-plugins.v1";
  outcome: "pass" | "preview" | "warn";
  homeDir: string;
  projectRoot: string;
  plugins: ManagedAntigravityPluginResult[];
  warnings: string[];
}

export interface UpdateManagedAntigravityPluginsOptions {
  projectRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  specs?: readonly ManagedAntigravityPluginSpec[];
  cacheDir?: string;
  gitBin?: string;
  agyBin?: string;
  detectAntigravityCli?: DetectAntigravityCli;
  fetchPluginSource?: FetchManagedAntigravityPluginSource;
}

interface ManagedPluginMetadata {
  schema: "agentx.managed-antigravity-plugin.v1";
  agentxVersion: string;
  pluginName: string;
  source: string;
  ref: string;
  revision?: string;
  installedAt: string;
  destinations: string[];
}

function isAntigravityPluginInstall(value: unknown): value is AntigravityPluginNativeInstall {
  return Boolean(value && typeof value === "object" && (value as { kind?: unknown }).kind === "antigravity-plugin");
}

function dirExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function readJson(filePath: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function safeCacheName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "plugin";
}

function tail(value: unknown, maxChars = 1200): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function runGit(gitBin: string, args: string[], cwd?: string): string {
  const result = spawnCommandSync(gitBin, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = tail(result.stderr) || tail(result.stdout) || result.error?.message || `exit code ${String(result.status ?? "unknown")}`;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return String(result.stdout ?? "").trim();
}

function pluginMetadataPath(homeDir: string, pluginName: string): string {
  return path.join(homeDir, ".config", "agentx", "antigravity-plugins", `${pluginName}.json`);
}

function readPluginMetadata(homeDir: string, pluginName: string): ManagedPluginMetadata | undefined {
  const data = readJson(pluginMetadataPath(homeDir, pluginName));
  if (data?.schema !== "agentx.managed-antigravity-plugin.v1") return undefined;
  if (data.pluginName !== pluginName) return undefined;
  return data as unknown as ManagedPluginMetadata;
}

function writePluginMetadata(
  homeDir: string,
  spec: ManagedAntigravityPluginSpec,
  revision: string | undefined,
  destinations: string[],
): void {
  const filePath = pluginMetadataPath(homeDir, spec.pluginName);
  const metadata: ManagedPluginMetadata = {
    schema: "agentx.managed-antigravity-plugin.v1",
    agentxVersion: AGENTX_VERSION,
    pluginName: spec.pluginName,
    source: spec.source,
    ref: spec.ref,
    revision,
    installedAt: new Date().toISOString(),
    destinations,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function validatePluginSource(sourceDir: string, pluginName: string): void {
  const manifestPath = path.join(sourceDir, "plugin.json");
  const manifest = readJson(manifestPath);
  if (!manifest) throw new Error(`Missing or invalid ${manifestPath}.`);
  if (manifest.name !== pluginName) {
    throw new Error(`Unexpected Antigravity plugin name in ${manifestPath}: ${String(manifest.name ?? "")}`);
  }
}

function copyManagedPlugin(sourceDir: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const tmpDestination = path.join(path.dirname(destination), `.${path.basename(destination)}.tmp-${process.pid}-${Date.now()}`);
  fs.rmSync(tmpDestination, { recursive: true, force: true });
  fs.cpSync(sourceDir, tmpDestination, {
    recursive: true,
    filter: (source) => !path.relative(sourceDir, source).split(path.sep).includes(".git"),
  });
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(tmpDestination, destination);
}

function destinationHasPlugin(destination: string, pluginName: string): boolean {
  const manifest = readJson(path.join(destination, "plugin.json"));
  return manifest?.name === pluginName;
}

function hasGeminiExtension(projectRoot: string, homeDir: string, pluginName: string): boolean {
  return [
    path.join(projectRoot, ".gemini", "extensions", pluginName),
    path.join(homeDir, ".gemini", "extensions", pluginName),
  ].some(dirExists);
}

function pluginActive(
  spec: ManagedAntigravityPluginSpec,
  projectRoot: string,
  homeDir: string,
  destinations: AntigravityPluginDestinations,
  antigravityCliInstalled: boolean,
): { active: boolean; reason: string } {
  if (!antigravityCliInstalled) return { active: false, reason: "Antigravity CLI is not installed." };
  if (hasGeminiExtension(projectRoot, homeDir, spec.pluginName)) return { active: true, reason: "Gemini extension and Antigravity CLI are installed." };
  if (dirExists(destinations.primary)) return { active: true, reason: "Antigravity plugin is already installed." };
  if (destinations.mirrors.some(dirExists)) return { active: true, reason: "Antigravity import mirror is already installed." };
  return { active: false, reason: "No Gemini extension or Antigravity plugin install was found." };
}

export const defaultDetectAntigravityCli: DetectAntigravityCli = (options) => {
  const candidates = options.agyBin ? [options.agyBin] : ["agy", "antigravity"];
  return candidates.some((command) => commandExists(command, {
    homeDir: options.homeDir,
    env: options.env,
    platform: options.platform,
    includeNpmPrefix: false,
  }));
};

export function managedAntigravityPluginSpecs(): ManagedAntigravityPluginSpec[] {
  return nativeCapabilityEntriesForTarget("antigravity-cli")
    .flatMap((entry) => {
      const install = entry.nativeInstall;
      if (!isAntigravityPluginInstall(install) || entry.nativeStatus !== "available") return [];
      return [{
        entityId: entry.entityId,
        displayName: entry.displayName,
        pluginName: install.pluginName,
        source: install.source,
        ref: install.ref,
      }];
    })
    .sort((a, b) => a.pluginName.localeCompare(b.pluginName));
}

export function antigravityPluginDestinations(
  spec: Pick<ManagedAntigravityPluginSpec, "pluginName">,
  homeDir = os.homedir(),
): AntigravityPluginDestinations {
  const home = path.resolve(homeDir);
  const primary = path.join(home, ".gemini", "config", "plugins", spec.pluginName);
  const mirror = path.join(home, ".gemini", "antigravity-cli", "plugins", spec.pluginName);
  return {
    primary,
    mirrors: dirExists(mirror) ? [mirror] : [],
  };
}

export function fetchManagedAntigravityPluginSource(
  spec: ManagedAntigravityPluginSpec,
  options: {
    homeDir: string;
    cacheDir: string;
    gitBin?: string;
  },
): FetchedAntigravityPluginSource {
  const gitBin = options.gitBin ?? "git";
  const cacheDir = path.join(options.cacheDir, safeCacheName(spec.pluginName));
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });

  if (dirExists(path.join(cacheDir, ".git"))) {
    runGit(gitBin, ["fetch", "--depth", "1", "origin", spec.ref], cacheDir);
    runGit(gitBin, ["checkout", "--force", "FETCH_HEAD"], cacheDir);
  } else {
    const tmp = path.join(path.dirname(cacheDir), `.${path.basename(cacheDir)}.tmp-${process.pid}-${Date.now()}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    runGit(gitBin, ["clone", "--depth", "1", "--branch", spec.ref, spec.source, tmp]);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.renameSync(tmp, cacheDir);
  }

  return {
    sourceDir: cacheDir,
    revision: runGit(gitBin, ["rev-parse", "HEAD"], cacheDir),
  };
}

function updateOneManagedPlugin(
  spec: ManagedAntigravityPluginSpec,
  options: Required<Pick<UpdateManagedAntigravityPluginsOptions, "dryRun">> & {
    projectRoot: string;
    homeDir: string;
    cacheDir: string;
    gitBin?: string;
    antigravityCliInstalled: boolean;
    fetchPluginSource: FetchManagedAntigravityPluginSource;
  },
): ManagedAntigravityPluginResult {
  const destinations = antigravityPluginDestinations(spec, options.homeDir);
  const active = pluginActive(spec, options.projectRoot, options.homeDir, destinations, options.antigravityCliInstalled);
  const base = {
    entityId: spec.entityId,
    displayName: spec.displayName,
    pluginName: spec.pluginName,
    source: spec.source,
    ref: spec.ref,
    destinations,
  };

  if (!active.active) return { ...base, status: "skipped", reason: active.reason };
  if (options.dryRun) return { ...base, status: "preview", reason: active.reason };

  try {
    const existedBefore = dirExists(destinations.primary) || destinations.mirrors.some(dirExists);
    const fetched = options.fetchPluginSource(spec, {
      homeDir: options.homeDir,
      cacheDir: options.cacheDir,
      gitBin: options.gitBin,
    });
    validatePluginSource(fetched.sourceDir, spec.pluginName);
    const metadata = readPluginMetadata(options.homeDir, spec.pluginName);
    const allDestinations = [destinations.primary, ...destinations.mirrors];
    const alreadyCurrent = Boolean(
      fetched.revision
      && metadata?.source === spec.source
      && metadata.ref === spec.ref
      && metadata.revision === fetched.revision
      && allDestinations.every((destination) => destinationHasPlugin(destination, spec.pluginName)),
    );
    if (alreadyCurrent) {
      return { ...base, status: "current", reason: "Installed revision already matches the managed source.", revision: fetched.revision };
    }

    for (const destination of allDestinations) copyManagedPlugin(fetched.sourceDir, destination);
    writePluginMetadata(options.homeDir, spec, fetched.revision, allDestinations);
    return {
      ...base,
      status: existedBefore ? "updated" : "installed",
      reason: active.reason,
      revision: fetched.revision,
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      reason: active.reason,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function updateManagedAntigravityPlugins(
  options: UpdateManagedAntigravityPluginsOptions = {},
): ManagedAntigravityPluginUpdateReport {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const cacheDir = path.resolve(options.cacheDir ?? path.join(homeDir, ".config", "agentx", "antigravity-plugins", "cache"));
  const dryRun = options.dryRun === true;
  const fetchPluginSource = options.fetchPluginSource ?? fetchManagedAntigravityPluginSource;
  const antigravityCliInstalled = (options.detectAntigravityCli ?? defaultDetectAntigravityCli)({
    homeDir,
    agyBin: options.agyBin,
  });
  const specs = [...(options.specs ?? managedAntigravityPluginSpecs())];
  const plugins = specs.map((spec) => updateOneManagedPlugin(spec, {
    projectRoot,
    homeDir,
    cacheDir,
    gitBin: options.gitBin,
    dryRun,
    antigravityCliInstalled,
    fetchPluginSource,
  }));
  const warnings = plugins
    .filter((plugin) => plugin.status === "error")
    .map((plugin) => `${plugin.displayName} Antigravity plugin update failed: ${plugin.error ?? "unknown error"}`);
  const hasPreview = plugins.some((plugin) => plugin.status === "preview");
  return {
    schema: "agentx.managed-antigravity-plugins.v1",
    outcome: warnings.length > 0 ? "warn" : hasPreview ? "preview" : "pass",
    projectRoot,
    homeDir,
    plugins,
    warnings,
  };
}
