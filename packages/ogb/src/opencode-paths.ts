import os from "node:os";
import path from "node:path";
import { normalizePathInput } from "./paths.js";

export interface OpenCodePathOptions {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

function useWin32Path(platform: NodeJS.Platform, normalizedHomeDir: string): boolean {
  return platform === "win32" && !normalizedHomeDir.startsWith("/");
}

function resolvedHomeDir(homeDir: string | undefined, platform = process.platform): string {
  const normalized = normalizePathInput(homeDir ?? os.homedir());
  return useWin32Path(platform, normalized) ? path.win32.resolve(normalized) : path.resolve(normalized);
}

export function globalOpenCodeConfigDir(options: OpenCodePathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const normalizedHomeDir = normalizePathInput(options.homeDir ?? os.homedir());
  const pathApi = useWin32Path(platform, normalizedHomeDir) ? path.win32 : path;
  const homeDir = resolvedHomeDir(options.homeDir, platform);
  const env = options.env ?? process.env;

  if (platform !== "win32" && env.XDG_CONFIG_HOME && homeDir === path.resolve(os.homedir())) {
    return path.join(env.XDG_CONFIG_HOME, "opencode");
  }

  return pathApi.join(homeDir, ".config", "opencode");
}

export function globalOpenCodeConfigFiles(options: OpenCodePathOptions = {}): string[] {
  const root = globalOpenCodeConfigDir(options);
  return [
    path.join(root, "opencode.json"),
    path.join(root, "opencode.jsonc"),
  ];
}

export function legacyWindowsAppDataOpenCodeConfigDir(options: OpenCodePathOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return undefined;

  const normalizedHomeDir = normalizePathInput(options.homeDir ?? os.homedir());
  const pathApi = useWin32Path(platform, normalizedHomeDir) ? path.win32 : path;
  const homeDir = resolvedHomeDir(options.homeDir, platform);
  const env = options.env ?? process.env;
  const appData = env.APPDATA || pathApi.join(homeDir, "AppData", "Roaming");
  return pathApi.join(appData, "opencode");
}
