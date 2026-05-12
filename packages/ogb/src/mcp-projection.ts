import type { GeminiMcpServer } from "./types.js";

const SENSITIVE_ENV_KEY = /(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|AUTH|PRIVATE)/i;
const ENV_REFERENCE = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;
const HIGH_CONFIDENCE_SECRET_VALUE = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b(?:sk-|ntn_|ghp_|github_pat_|xox[baprs]-|AIza)[A-Za-z0-9._-]{8,}/i,
  /["']?(?:authorization|api[_-]?key|token|secret|password)["']?\s*[:=]\s*["'][^"']{8,}["']/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

export function openCodeEnvReference(name: string): string {
  return `{env:${name}}`;
}

export function referencedEnvName(value: string): string | undefined {
  const match = value.trim().match(ENV_REFERENCE);
  return match?.[1] ?? match?.[2];
}

function valueLooksSensitive(value: string): boolean {
  return HIGH_CONFIDENCE_SECRET_VALUE.some((pattern) => pattern.test(value));
}

export function shouldStoreMcpEnvLiteral(key: string, value: string): boolean {
  return referencedEnvName(value) === undefined && (SENSITIVE_ENV_KEY.test(key) || valueLooksSensitive(value));
}

export function projectGeminiMcpEnvironment(
  rawEnv: unknown,
  options: {
    serverName: string;
    mapValue?: (input: string) => string;
  },
): { environment?: Record<string, string>; warnings: string[]; envKeys?: string[]; secretEnvKeys?: string[] } {
  if (rawEnv === undefined || rawEnv === null) return { warnings: [] };
  if (!isRecord(rawEnv)) {
    return {
      warnings: [`MCP environment warning: ${options.serverName}.env must be an object; skipping environment.`],
    };
  }

  const mapValue = options.mapValue ?? ((input: string) => input);
  const environment: Record<string, string> = {};
  const warnings: string[] = [];
  const secretEnvKeys: string[] = [];
  const envKeys = Object.keys(rawEnv).sort();

  for (const key of envKeys) {
    const rawValue = rawEnv[key];
    if (typeof rawValue !== "string") {
      warnings.push(`MCP environment warning: ${options.serverName}.${key} is not a string; skipping it.`);
      continue;
    }

    const mappedValue = mapValue(rawValue);
    const envName = referencedEnvName(mappedValue);
    if (envName) {
      environment[key] = openCodeEnvReference(envName);
      continue;
    }

    if (shouldStoreMcpEnvLiteral(key, mappedValue)) {
      environment[key] = openCodeEnvReference(key);
      secretEnvKeys.push(key);
      continue;
    }

    environment[key] = mappedValue;
  }

  return {
    environment: Object.keys(environment).length > 0 ? environment : undefined,
    warnings,
    envKeys,
    secretEnvKeys: secretEnvKeys.length > 0 ? secretEnvKeys : undefined,
  };
}

export function projectGeminiMcpServer(server: GeminiMcpServer): {
  name: string;
  config: Record<string, unknown>;
  warnings: string[];
} | undefined {
  const warnings = [...(server.environmentWarnings ?? [])];

  if (server.type === "stdio" && server.command) {
    const config: Record<string, unknown> = {
      type: "local",
      command: [server.command, ...(server.args ?? [])],
      enabled: true,
    };
    if (server.environment && Object.keys(server.environment).length > 0) {
      config.environment = server.environment;
    }
    if (typeof server.timeout === "number" && Number.isFinite(server.timeout) && server.timeout > 0) {
      config.timeout = server.timeout;
    }
    return { name: server.name, config, warnings };
  }

  if (server.type === "http" && server.url) {
    const config: Record<string, unknown> = {
      type: "remote",
      url: server.url,
      enabled: true,
    };
    if (typeof server.timeout === "number" && Number.isFinite(server.timeout) && server.timeout > 0) {
      config.timeout = server.timeout;
    }
    return { name: server.name, config, warnings };
  }

  return undefined;
}

export function projectOpenCodeMcpFromGeminiServers(servers: GeminiMcpServer[]): {
  mcp: Record<string, unknown>;
  warnings: string[];
} {
  const mcp: Record<string, unknown> = {};
  const warnings: string[] = [];

  for (const server of servers) {
    const projected = projectGeminiMcpServer(server);
    if (!projected) continue;
    mcp[projected.name] = projected.config;
    warnings.push(...projected.warnings);
  }

  return { mcp, warnings: uniqueWarnings(warnings) };
}

export function diagnoseOpenCodeMcpConfig(rawMcp: unknown, geminiServers: GeminiMcpServer[] = []): string[] {
  if (rawMcp === undefined || rawMcp === null) return [];
  if (!isRecord(rawMcp)) return ["OpenCode MCP shape warning: mcp must be an object."];

  const warnings: string[] = [];
  const geminiByName = new Map(geminiServers.map((server) => [server.name, server]));

  for (const [name, rawConfig] of Object.entries(rawMcp)) {
    if (!isRecord(rawConfig)) {
      warnings.push(`OpenCode MCP shape warning: ${name} must be an object.`);
      continue;
    }

    const commandIsGeminiString = typeof rawConfig.command === "string";
    if ("env" in rawConfig) warnings.push(`OpenCode MCP shape warning: ${name}.env uses Gemini shape; use environment.`);
    if ("args" in rawConfig) warnings.push(`OpenCode MCP shape warning: ${name}.args uses Gemini shape; fold args into command array.`);
    if (commandIsGeminiString) warnings.push(`OpenCode MCP shape warning: ${name}.command must be an array in OpenCode.`);
    if (rawConfig.type === undefined) warnings.push(`OpenCode MCP shape warning: ${name}.type is missing.`);
    else if (rawConfig.type !== "local" && rawConfig.type !== "remote") warnings.push(`OpenCode MCP shape warning: ${name}.type must be "local" or "remote".`);

    if ((rawConfig.type === "local" || rawConfig.command !== undefined) && !commandIsGeminiString) {
      if (!Array.isArray(rawConfig.command)) warnings.push(`OpenCode MCP shape warning: ${name}.command must be a non-empty string array for local servers.`);
      else if (rawConfig.command.length === 0 || rawConfig.command.some((item) => typeof item !== "string" || item.trim().length === 0)) {
        warnings.push(`OpenCode MCP shape warning: ${name}.command must be a non-empty string array for local servers.`);
      }
    }

    if (rawConfig.environment !== undefined && !isRecord(rawConfig.environment)) {
      warnings.push(`OpenCode MCP shape warning: ${name}.environment must be an object.`);
    }

    const expected = geminiByName.get(name);
    if (expected?.envKeys && expected.envKeys.length > 0) {
      const environment = isRecord(rawConfig.environment) ? rawConfig.environment : {};
      const missing = expected.envKeys.filter((key) => !(key in environment));
      if (missing.length > 0) {
        warnings.push(`OpenCode MCP shape warning: ${name}.environment is missing Gemini env key(s): ${missing.join(", ")}. Run ogb sync.`);
      }
    }
  }

  return uniqueWarnings(warnings);
}
