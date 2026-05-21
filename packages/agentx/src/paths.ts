import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProjectPaths {
  projectRoot: string;
  homeDir: string;
  homeMode: boolean;
  bridgeConfigDir: string;
  generatedDir: string;
  inventoryPath: string;
  doctorPath: string;
  validationPath: string;
  securityPath: string;
  agentSyncAdoptionPath: string;
  bidirectionalSyncPath: string;
  extensionMapPath: string;
  nativeCapabilitiesPath: string;
  modelRoutingPath: string;
  dashboardPath: string;
  dashboardMarkdownPath: string;
  telemetryStatusPath: string;
  passPath: string;
  updateStatusPath: string;
  limitsPath: string;
  quotaPath: string;
  agentxConfigPath: string;
  ohMyOpenAgentConfigPath: string;
  trustPath: string;
  pluginStatusPath: string;
  syncStatePath: string;
  expandedGeminiPath: string;
  generatedOpenCodeConfigPath: string;
}

export function normalizePathInput(value: string): string {
  let normalized = value.trim();
  let changed = true;
  while (changed && normalized.length >= 2) {
    changed = false;
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      normalized = normalized.slice(1, -1).trim();
      changed = true;
      continue;
    }
    if (normalized.length >= 4) {
      const escapedFirst = normalized.slice(0, 2);
      const escapedLast = normalized.slice(-2);
      if ((escapedFirst === "\\\"" && escapedLast === "\\\"") || (escapedFirst === "\\'" && escapedLast === "\\'")) {
        normalized = normalized.slice(2, -2).trim();
        changed = true;
      }
    }
  }
  return normalized;
}

export function isHomeProject(projectRoot = process.cwd(), homeDir = os.homedir()): boolean {
  return path.resolve(normalizePathInput(projectRoot)) === path.resolve(normalizePathInput(homeDir));
}

export function resolveProjectPaths(projectRoot = process.cwd(), homeDir = os.homedir()): ProjectPaths {
  const root = path.resolve(normalizePathInput(projectRoot));
  const home = path.resolve(normalizePathInput(homeDir));
  const homeMode = isHomeProject(root, home);
  const bridgeConfigDir = path.join(home, ".config", "agentx");
  const generatedDir = homeMode
    ? path.join(bridgeConfigDir, "generated")
    : path.join(root, ".opencode", "generated");
  const agentxConfigPath = homeMode
    ? path.join(bridgeConfigDir, "agentx.config.jsonc")
    : path.join(root, ".opencode", "agentx.config.jsonc");
  const trustPath = homeMode
    ? path.join(bridgeConfigDir, "agentx-trust.jsonc")
    : path.join(root, ".opencode", "agentx-trust.jsonc");

  return {
    projectRoot: root,
    homeDir: home,
    homeMode,
    bridgeConfigDir,
    generatedDir,
    inventoryPath: path.join(generatedDir, "agentx-inventory.json"),
    doctorPath: path.join(generatedDir, "agentx-doctor.json"),
    validationPath: path.join(generatedDir, "agentx-validation.json"),
    securityPath: path.join(generatedDir, "agentx-security.json"),
    agentSyncAdoptionPath: path.join(generatedDir, "agentx-agent-sync-adoption.json"),
    bidirectionalSyncPath: path.join(generatedDir, "agentx-bidirectional-sync.json"),
    extensionMapPath: path.join(generatedDir, "agentx-extension-map.json"),
    nativeCapabilitiesPath: path.join(generatedDir, "agentx-native-capabilities.json"),
    modelRoutingPath: path.join(generatedDir, "agentx-model-routing.json"),
    dashboardPath: path.join(generatedDir, "agentx-dashboard.json"),
    dashboardMarkdownPath: path.join(generatedDir, "agentx-dashboard.md"),
    telemetryStatusPath: path.join(generatedDir, "agentx-telemetry-status.json"),
    passPath: path.join(generatedDir, "agentx-pass.json"),
    updateStatusPath: path.join(generatedDir, "agentx-update-status.json"),
    limitsPath: path.join(generatedDir, "agentx-limits.json"),
    quotaPath: path.join(generatedDir, "agentx-quota.json"),
    agentxConfigPath,
    ohMyOpenAgentConfigPath: path.join(root, ".opencode", "oh-my-openagent.jsonc"),
    trustPath,
    pluginStatusPath: path.join(generatedDir, "agentx-plugin-status.json"),
    syncStatePath: path.join(generatedDir, "agentx-sync-state.json"),
    expandedGeminiPath: path.join(generatedDir, "GEMINI.expanded.md"),
    generatedOpenCodeConfigPath: path.join(generatedDir, "opencode.generated.json"),
  };
}

export function defaultGeminiInput(projectRoot = process.cwd(), homeDir = os.homedir()): string {
  projectRoot = path.resolve(normalizePathInput(projectRoot));
  homeDir = path.resolve(normalizePathInput(homeDir));
  const projectGemini = path.join(projectRoot, "GEMINI.md");
  if (fs.existsSync(projectGemini)) return projectGemini;

  const globalGemini = path.join(homeDir, ".gemini", "GEMINI.md");
  if (fs.existsSync(globalGemini)) return globalGemini;

  return projectGemini;
}

export function toPosixRelative(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}
