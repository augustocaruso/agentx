import path from "node:path";
import { globalOpenCodeConfigDir } from "./opencode-paths.js";
import { normalizePathInput } from "./paths.js";

export type SupportedInstallerPlatform = "darwin" | "win32" | "linux";

export interface PlatformAdapterInput {
  platform?: NodeJS.Platform;
  homeDir: string;
  env?: NodeJS.ProcessEnv;
}

export interface PersistedEnvPlan {
  name: string;
  value: string;
  target: "windows-user-env" | "zsh-config";
  path?: string;
  command?: string[];
}

export interface PlatformAdapter {
  platform: SupportedInstallerPlatform;
  homeDir: string;
  globalConfigDir: string;
  scriptKind: "powershell" | "posix-shell";
  pathSeparator: ";" | ":";
  defaultInstallPrefix: string;
  persistEnv(name: string, value: string): PersistedEnvPlan;
}

function normalizePlatform(platform: NodeJS.Platform | undefined): SupportedInstallerPlatform {
  if (platform === "win32") return "win32";
  if (platform === "darwin") return "darwin";
  return "linux";
}

function useWin32Path(platform: SupportedInstallerPlatform, normalizedHomeDir: string): boolean {
  return platform === "win32" && !normalizedHomeDir.startsWith("/");
}

export function createPlatformAdapter(input: PlatformAdapterInput): PlatformAdapter {
  const platform = normalizePlatform(input.platform);
  const normalizedHomeDir = normalizePathInput(input.homeDir);
  const pathApi = useWin32Path(platform, normalizedHomeDir) ? path.win32 : path;
  const homeDir = pathApi.resolve(normalizedHomeDir);
  const env = input.env ?? process.env;
  const defaultInstallPrefix = platform === "win32"
    ? pathApi.join(env.APPDATA || pathApi.join(homeDir, "AppData", "Roaming"), "npm")
    : path.join(homeDir, ".local");

  return {
    platform,
    homeDir,
    globalConfigDir: globalOpenCodeConfigDir({ homeDir, platform, env }),
    scriptKind: platform === "win32" ? "powershell" : "posix-shell",
    pathSeparator: platform === "win32" ? ";" : ":",
    defaultInstallPrefix,
    persistEnv(name, value) {
      if (platform === "win32") {
        return {
          name,
          value,
          target: "windows-user-env",
          command: ["powershell.exe", "-NoProfile", "-Command", `[Environment]::SetEnvironmentVariable('${name}','${value}','User')`],
        };
      }
      return {
        name,
        value,
        target: "zsh-config",
        path: pathApi.join(homeDir, ".config", "zsh", ".zshrc"),
      };
    },
  };
}
