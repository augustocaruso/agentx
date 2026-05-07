import os from "node:os";
import { createPlatformAdapter } from "./platform-adapter.js";

export interface OpenCodePathOptions {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

function adapterFor(options: OpenCodePathOptions) {
  return createPlatformAdapter({
    platform: options.platform,
    homeDir: options.homeDir ?? os.homedir(),
    env: options.env,
  });
}

export function globalOpenCodeConfigDir(options: OpenCodePathOptions = {}): string {
  return adapterFor(options).globalConfigDir;
}

export function globalOpenCodeConfigFiles(options: OpenCodePathOptions = {}): string[] {
  return adapterFor(options).globalConfigFiles;
}

export function legacyWindowsAppDataOpenCodeConfigDir(options: OpenCodePathOptions = {}): string | undefined {
  return adapterFor(options).legacyGlobalConfigDir;
}
