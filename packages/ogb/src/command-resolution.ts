import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPlatformAdapter, type PlatformAdapter } from "./platform-adapter.js";
import { normalizeCommandInput, spawnCommandSync } from "./process.js";

export interface CommandResolutionOptions {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  includeLookup?: boolean;
  includeNpmPrefix?: boolean;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeCommandInput).filter(Boolean))];
}

function pathExists(filePath: string): boolean {
  try {
    const stat = fs.statSync(normalizeCommandInput(filePath));
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

const npmPrefixCache = new Map<string, string>();

function npmPrefixCacheKey(adapter: PlatformAdapter, env: NodeJS.ProcessEnv): string {
  return JSON.stringify({
    platform: adapter.platform,
    homeDir: adapter.homeDir,
    path: env.PATH ?? env.Path ?? "",
    appData: env.APPDATA ?? "",
    npmConfigPrefix: env.npm_config_prefix ?? env.NPM_CONFIG_PREFIX ?? "",
  });
}

function isPathLike(command: string, platform: NodeJS.Platform): boolean {
  command = normalizeCommandInput(command);
  return path.isAbsolute(command)
    || (platform === "win32" && path.win32.isAbsolute(command))
    || command.includes("/")
    || command.includes("\\");
}

function lookupCandidates(command: string, adapter: PlatformAdapter, env: NodeJS.ProcessEnv): string[] {
  const lookup = adapter.platform === "win32" ? "where" : "which";
  const result = spawnCommandSync(lookup, [command], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error || result.status !== 0) return [];
  const lines = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.flatMap((line) => adapter.commandVariants(line));
}

function npmGlobalPrefix(adapter: PlatformAdapter, env: NodeJS.ProcessEnv): string {
  const key = npmPrefixCacheKey(adapter, env);
  if (npmPrefixCache.has(key)) return npmPrefixCache.get(key) ?? "";
  const result = spawnCommandSync("npm", ["prefix", "-g"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const prefix = !result.error && result.status === 0 ? normalizeCommandInput(String(result.stdout || "")) : "";
  npmPrefixCache.set(key, prefix);
  return prefix;
}

function npmPrefixCandidates(command: string, adapter: PlatformAdapter, env: NodeJS.ProcessEnv): string[] {
  const prefix = npmGlobalPrefix(adapter, env);
  if (!prefix) return [];
  const roots = adapter.platform === "win32" ? [prefix, adapter.join(prefix, "bin")] : [adapter.join(prefix, "bin"), prefix];
  return roots.flatMap((root) => adapter.commandVariants(adapter.join(root, command)));
}

export function resolveCommand(command: string, options: CommandResolutionOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const adapter = createPlatformAdapter({ platform, homeDir, env });
  command = normalizeCommandInput(command);

  if (isPathLike(command, platform)) {
    return adapter.commandVariants(command).map(normalizeCommandInput).find(pathExists);
  }

  const candidates = [
    ...(options.includeLookup === false ? [] : lookupCandidates(command, adapter, env)),
    ...(options.includeNpmPrefix === false ? [] : npmPrefixCandidates(command, adapter, env)),
    ...adapter.homeCommandCandidates(command),
  ];
  return unique(candidates).find(pathExists);
}

export function commandExists(command: string, options: CommandResolutionOptions = {}): boolean {
  return Boolean(resolveCommand(command, options));
}
