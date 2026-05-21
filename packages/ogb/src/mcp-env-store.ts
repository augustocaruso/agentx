import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { shouldStoreMcpEnvLiteral } from "./mcp-projection.js";
import { createPlatformAdapter } from "./platform-adapter.js";

const STORE_SCHEMA = "agentx.mcp-env.v2";
const LEGACY_STORE_SCHEMAS = new Set<string>(["opencode-gemini-bridge.mcp-env.v1"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface McpEnvStore {
  schema: typeof STORE_SCHEMA;
  updatedAt: string;
  values: Record<string, string>;
}

function readJsonc(filePath: string): any {
  try {
    return parseJsonc(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of paths) {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(item);
  }
  return out;
}

function listDirs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function expandGeminiExtensionValue(value: string, extensionDir: string): string {
  return value
    .replaceAll("${extensionPath}", extensionDir)
    .replaceAll("${/}", path.sep);
}

function readStore(filePath: string): McpEnvStore | undefined {
  const parsed = readJsonc(filePath);
  const schemaOk = parsed?.schema === STORE_SCHEMA || (typeof parsed?.schema === "string" && LEGACY_STORE_SCHEMAS.has(parsed.schema));
  if (!schemaOk || !parsed.values || typeof parsed.values !== "object" || Array.isArray(parsed.values)) return undefined;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.values)) {
    if (ENV_NAME.test(key) && typeof value === "string") values[key] = value;
  }
  return {
    schema: STORE_SCHEMA,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    values,
  };
}

export function mcpEnvStorePath(options: {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
} = {}): string {
  const homeDir = options.homeDir ?? os.homedir();
  const adapter = createPlatformAdapter({ homeDir, platform: options.platform, env: options.env });
  return adapter.join(adapter.bridgeConfigDir, "mcp-env.json");
}

export function readMcpEnvValues(options: {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
} = {}): Record<string, string> {
  return readStore(mcpEnvStorePath(options))?.values ?? {};
}

function collectFromMcpServers(
  out: Map<string, string>,
  warnings: string[],
  servers: Record<string, any>,
  source: string,
  mapValue: (input: string) => string = (input) => input,
): void {
  for (const [serverName, cfg] of Object.entries<any>(servers ?? {})) {
    const env = cfg?.env;
    if (!env || typeof env !== "object" || Array.isArray(env)) continue;
    for (const [key, rawValue] of Object.entries(env)) {
      if (!ENV_NAME.test(key) || typeof rawValue !== "string") continue;
      if (!shouldStoreMcpEnvLiteral(key, rawValue)) continue;
      const value = mapValue(rawValue);
      const existing = out.get(key);
      if (existing !== undefined && existing !== value) {
        warnings.push(`MCP environment warning: ${serverName}.${key} has different sensitive literals in multiple Gemini MCP sources; keeping the first value found. Check ${source}.`);
        continue;
      }
      out.set(key, value);
    }
  }
}

function collectSensitiveMcpEnvLiterals(projectRoot: string, homeDir: string): {
  values: Record<string, string>;
  warnings: string[];
} {
  const values = new Map<string, string>();
  const warnings: string[] = [];
  const settingsPaths = uniquePaths([
    path.join(projectRoot, ".gemini", "settings.json"),
    path.join(homeDir, ".gemini", "settings.json"),
  ]);
  const extensionRoots = uniquePaths([
    path.join(projectRoot, ".gemini", "extensions"),
    path.join(homeDir, ".gemini", "extensions"),
  ]);

  for (const settingsPath of settingsPaths) {
    const parsed = readJsonc(settingsPath);
    collectFromMcpServers(values, warnings, parsed?.mcpServers ?? {}, settingsPath);
  }

  for (const extensionRoot of extensionRoots) {
    for (const extensionDir of listDirs(extensionRoot)) {
      const manifestPath = path.join(extensionDir, "gemini-extension.json");
      const parsed = readJsonc(manifestPath);
      collectFromMcpServers(
        values,
        warnings,
        parsed?.mcpServers ?? {},
        manifestPath,
        (input) => expandGeminiExtensionValue(input, extensionDir),
      );
    }
  }

  return { values: Object.fromEntries(values), warnings: [...new Set(warnings)] };
}

export function syncMcpEnvStore(options: {
  projectRoot: string;
  homeDir: string;
  dryRun?: boolean;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): { path: string; stored: string[]; warnings: string[] } {
  const storePath = mcpEnvStorePath(options);
  const collected = collectSensitiveMcpEnvLiterals(options.projectRoot, options.homeDir);
  const stored = Object.keys(collected.values).sort();
  if (stored.length === 0) return { path: storePath, stored, warnings: collected.warnings };

  if (options.dryRun) return { path: storePath, stored, warnings: collected.warnings };

  const current = readStore(storePath);
  const next: McpEnvStore = {
    schema: STORE_SCHEMA,
    updatedAt: new Date().toISOString(),
    values: {
      ...(current?.values ?? {}),
      ...collected.values,
    },
  };

  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(storePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(storePath, 0o600);
  } catch (error: any) {
    return {
      path: storePath,
      stored,
      warnings: [
        ...collected.warnings,
        `MCP environment warning: could not store local MCP env values in ${storePath}: ${String(error?.message || error)}`,
      ],
    };
  }

  return { path: storePath, stored, warnings: collected.warnings };
}
