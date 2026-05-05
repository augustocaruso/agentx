import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";

export interface OpenCodeAgentPreference {
  agent: string;
  source: string;
}

export function resolveLaunchAgent(options: { agent?: string; yolo?: boolean }): string | undefined {
  const requested = typeof options.agent === "string" ? options.agent.trim() : "";
  if (options.yolo && requested && requested.toLowerCase() !== "yolo") {
    throw new Error(`Use --yolo or --agent ${requested}, not both.`);
  }
  if (options.yolo) return "YOLO";
  return requested || undefined;
}

export function buildOpenCodeLaunchArgs(options: { agent?: string; yolo?: boolean }): string[] {
  const agent = resolveLaunchAgent(options);
  return agent ? ["--agent", agent] : [];
}

function readJsoncObject(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const parsed = parseJsonc(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nestedStringValue(source: Record<string, unknown> | undefined, pathParts: string[]): string | undefined {
  let current: unknown = source;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return stringValue(current);
}

export function projectOpenCodeAgentPreference(projectRoot: string): OpenCodeAgentPreference | undefined {
  for (const configName of ["opencode.jsonc", "opencode.json"]) {
    const configPath = path.join(projectRoot, configName);
    const agent = nestedStringValue(readJsoncObject(configPath), ["default_agent"]);
    if (agent) return { agent, source: configName };
  }

  for (const configName of ["ogb.config.jsonc", "ogb.config.json"]) {
    const configPath = path.join(projectRoot, ".opencode", configName);
    const agent = nestedStringValue(readJsoncObject(configPath), ["openCode", "defaultAgent"]);
    if (agent) return { agent, source: path.join(".opencode", configName) };
  }

  return undefined;
}

export function resolveOpenCodeOpenAgent(options: {
  projectRoot?: string;
  agent?: string;
  yolo?: boolean;
  fallbackAgent?: string;
}): OpenCodeAgentPreference {
  const explicit = resolveLaunchAgent({ agent: options.agent, yolo: options.yolo });
  if (explicit) return { agent: explicit, source: options.yolo ? "--yolo" : "--agent" };

  if (options.projectRoot) {
    const projectPreference = projectOpenCodeAgentPreference(options.projectRoot);
    if (projectPreference) return projectPreference;
  }

  return { agent: options.fallbackAgent ?? "YOLO", source: "ogb-default" };
}

export function buildOpenCodeOpenArgs(options: {
  projectRoot?: string;
  agent?: string;
  yolo?: boolean;
  fallbackAgent?: string;
}): string[] {
  const preference = resolveOpenCodeOpenAgent(options);
  return ["--agent", preference.agent];
}
