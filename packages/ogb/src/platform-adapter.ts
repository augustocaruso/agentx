import os from "node:os";
import path from "node:path";
import { normalizePathInput } from "./paths.js";

export type SupportedInstallerPlatform = "darwin" | "win32" | "linux";
type PathApi = typeof path;

export interface PlatformAdapterInput {
  platform?: NodeJS.Platform;
  homeDir: string;
  env?: NodeJS.ProcessEnv;
}

export interface PersistedEnvPlan {
  name: string;
  value: string;
  target: "windows-user-env" | "zsh-config" | "posix-shell-config" | "fish-config";
  path?: string;
  command?: string[];
}

export interface PlatformAdapter {
  platform: SupportedInstallerPlatform;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  pathApi: PathApi;
  globalConfigDir: string;
  globalConfigFiles: string[];
  legacyGlobalConfigDir?: string;
  bridgeConfigDir: string;
  generatedDir: string;
  appDataDir?: string;
  npmGlobalDir: string;
  scriptKind: "powershell" | "posix-shell";
  pathSeparator: ";" | ":";
  defaultInstallPrefix: string;
  shellCommand: string[];
  powershellCommands: string[];
  join(...segments: string[]): string;
  resolvePath(value: string): string;
  isHomeProject(projectRoot: string): boolean;
  commandVariants(command: string): string[];
  homeCommandCandidates(command: string): string[];
  installOpenCodeCommand(): string[];
  persistEnv(name: string, value: string): PersistedEnvPlan;
  persistEnvCandidates(name: string, value: string): PersistedEnvPlan[];
}

function normalizePlatform(platform: NodeJS.Platform | undefined): SupportedInstallerPlatform {
  const effectivePlatform = platform ?? process.platform;
  if (effectivePlatform === "win32") return "win32";
  if (effectivePlatform === "darwin") return "darwin";
  return "linux";
}

function useWin32Path(platform: SupportedInstallerPlatform, normalizedHomeDir: string): boolean {
  return platform === "win32" && !normalizedHomeDir.startsWith("/");
}

function powershellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function createPlatformAdapter(input: PlatformAdapterInput): PlatformAdapter {
  const platform = normalizePlatform(input.platform);
  const normalizedHomeDir = normalizePathInput(input.homeDir);
  const pathApi = useWin32Path(platform, normalizedHomeDir) ? path.win32 : path;
  const homeDir = pathApi.resolve(normalizedHomeDir);
  const env = input.env ?? process.env;
  const appDataDir = platform === "win32"
    ? pathApi.resolve(normalizePathInput(env.APPDATA || pathApi.join(homeDir, "AppData", "Roaming")))
    : undefined;
  const defaultInstallPrefix = platform === "win32"
    ? pathApi.join(appDataDir ?? pathApi.join(homeDir, "AppData", "Roaming"), "npm")
    : pathApi.join(homeDir, ".local");
  const globalConfigDir = platform !== "win32" && env.XDG_CONFIG_HOME && homeDir === path.resolve(os.homedir())
    ? path.join(normalizePathInput(env.XDG_CONFIG_HOME), "opencode")
    : pathApi.join(homeDir, ".config", "opencode");
  const bridgeConfigDir = pathApi.join(homeDir, ".config", "opencode-gemini-bridge");
  const generatedDir = pathApi.join(bridgeConfigDir, "generated");
  const npmGlobalDir = platform === "win32" ? defaultInstallPrefix : pathApi.join(defaultInstallPrefix, "bin");
  const powershellCommands = platform === "win32" ? ["pwsh", "powershell.exe", "powershell"] : [];

  function join(...segments: string[]): string {
    return pathApi.join(...segments);
  }

  function resolvePath(value: string): string {
    return pathApi.resolve(normalizePathInput(value));
  }

  function samePath(left: string, right: string): boolean {
    const normalizedLeft = resolvePath(left);
    const normalizedRight = resolvePath(right);
    return platform === "win32"
      ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
      : normalizedLeft === normalizedRight;
  }

  function commandVariants(command: string): string[] {
    const normalized = normalizePathInput(command);
    if (platform !== "win32") return [normalized];
    if (pathApi.extname(normalized)) return [normalized];
    return [`${normalized}.cmd`, `${normalized}.exe`, `${normalized}.bat`, `${normalized}.ps1`, normalized];
  }

  function homeCommandCandidates(command: string): string[] {
    const roots = platform === "win32"
      ? [
        npmGlobalDir,
        pathApi.join(homeDir, "AppData", "Roaming", "npm"),
        pathApi.join(homeDir, ".opencode", "bin"),
        pathApi.join(homeDir, ".local", "bin"),
      ]
      : [
        pathApi.join(homeDir, ".opencode", "bin"),
        npmGlobalDir,
      ];
    return [...new Set(roots.flatMap((root) => commandVariants(pathApi.join(root, command))))];
  }

  function persistWindowsEnv(name: string, value: string, command: string): PersistedEnvPlan {
    const script = `[Environment]::SetEnvironmentVariable(${powershellSingleQuoted(name)},${powershellSingleQuoted(value)},'User')`;
    return {
      name,
      value,
      target: "windows-user-env",
      command: [command, "-NoProfile", "-Command", script],
    };
  }

  function persistPosixEnv(name: string, value: string): PersistedEnvPlan {
    return {
      name,
      value,
      target: "zsh-config",
      path: pathApi.join(homeDir, ".config", "zsh", ".zshrc"),
    };
  }

  function shellBasename(): string {
    return (env.SHELL ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
  }

  function uniquePlans(
    entries: Array<{ path: string; target: PersistedEnvPlan["target"] }>,
    name: string,
    value: string,
  ): PersistedEnvPlan[] {
    const seen = new Set<string>();
    return entries.flatMap((entry) => {
      if (seen.has(entry.path)) return [];
      seen.add(entry.path);
      return [{
        name,
        value,
        target: entry.target,
        path: entry.path,
      }];
    });
  }

  function persistLinuxEnvCandidates(name: string, value: string): PersistedEnvPlan[] {
    const entries: Array<{ path: string; target: PersistedEnvPlan["target"] }> = [
      { path: pathApi.join(homeDir, ".profile"), target: "posix-shell-config" },
    ];
    const shell = shellBasename();
    if (shell === "bash") entries.push({ path: pathApi.join(homeDir, ".bashrc"), target: "posix-shell-config" });
    if (shell === "zsh") entries.push({ path: pathApi.join(homeDir, ".zshrc"), target: "posix-shell-config" });
    if (shell === "fish") entries.push({ path: pathApi.join(homeDir, ".config", "fish", "config.fish"), target: "fish-config" });
    return uniquePlans(entries, name, value);
  }

  return {
    platform,
    homeDir,
    env,
    pathApi,
    globalConfigDir,
    globalConfigFiles: [
      pathApi.join(globalConfigDir, "opencode.json"),
      pathApi.join(globalConfigDir, "opencode.jsonc"),
    ],
    legacyGlobalConfigDir: platform === "win32" && appDataDir ? pathApi.join(appDataDir, "opencode") : undefined,
    bridgeConfigDir,
    generatedDir,
    appDataDir,
    npmGlobalDir,
    scriptKind: platform === "win32" ? "powershell" : "posix-shell",
    pathSeparator: platform === "win32" ? ";" : ":",
    defaultInstallPrefix,
    shellCommand: platform === "win32" ? ["cmd.exe", "/d", "/s", "/c"] : ["bash", "-lc"],
    powershellCommands,
    join,
    resolvePath,
    isHomeProject(projectRoot: string) {
      return samePath(projectRoot, homeDir);
    },
    commandVariants,
    homeCommandCandidates,
    installOpenCodeCommand() {
      return platform === "win32"
        ? ["npm", "install", "-g", "opencode-ai@latest"]
        : ["sh", "-c", "curl -fsSL https://opencode.ai/install | bash"];
    },
    persistEnv(name, value) {
      if (platform === "win32") {
        return persistWindowsEnv(name, value, powershellCommands[0] ?? "powershell.exe");
      }
      if (platform === "linux") return persistLinuxEnvCandidates(name, value)[0];
      return persistPosixEnv(name, value);
    },
    persistEnvCandidates(name, value) {
      if (platform === "win32") return powershellCommands.map((command) => persistWindowsEnv(name, value, command));
      if (platform === "linux") return persistLinuxEnvCandidates(name, value);
      return [persistPosixEnv(name, value)];
    },
  };
}
