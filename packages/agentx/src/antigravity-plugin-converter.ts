import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvAgentx } from "./env.js";
import { spawnCommandSync } from "./process.js";

export interface AntigravityCommandSkill {
  slug: string;
  publicName: string;
  description: string;
  markdown: string;
  warnings: string[];
}

export interface AntigravityCommandSkillInput {
  sourcePath: string;
  sourceRelPath: string;
  extensionName?: string;
  extensionDir?: string;
}

export interface AntigravityPluginConversionInput {
  sourceDir: string;
  outputDir: string;
  pluginName?: string;
}

export interface AntigravityPluginConversion {
  schema: string;
  status: string;
  pluginName: string;
  sourceDir: string;
  pluginDir: string;
  counts: {
    commandSkills: number;
    hooks: number;
    mcpServers: number;
    agents: number;
    skills: number;
    inventory: number;
  };
  warnings: string[];
  inventory: Array<{
    source: string;
    kind: string;
    destination: string;
    status: string;
    note: string;
  }>;
}

function converterScriptPath(): string {
  const override = readEnvAgentx("ANTIGRAVITY_CONVERTER");
  if (override) return override;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "scripts", "gemini_antigravity_converter.py");
}

function pythonCommands(): string[] {
  const override = readEnvAgentx("PYTHON_BIN");
  return override ? [override] : ["python3", "python"];
}

function converterEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform === "win32") return env;
  const currentPath = env.PATH ?? "";
  const parts = currentPath.split(path.delimiter).filter(Boolean);
  for (const fallback of ["/usr/local/bin", "/usr/bin", "/bin"]) {
    if (!parts.includes(fallback)) parts.push(fallback);
  }
  env.PATH = parts.join(path.delimiter);
  return env;
}

function resolvePythonCommand(command: string): string | undefined {
  if (process.platform === "win32") return command;
  if (path.isAbsolute(command) || command.includes("/")) return fs.existsSync(command) ? command : undefined;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function parseConverterOutput(stdout: string): AntigravityCommandSkill {
  const parsed = JSON.parse(stdout) as Partial<AntigravityCommandSkill>;
  if (
    typeof parsed.slug !== "string"
    || typeof parsed.publicName !== "string"
    || typeof parsed.description !== "string"
    || typeof parsed.markdown !== "string"
  ) {
    throw new Error("Antigravity converter returned an invalid command skill payload.");
  }
  return {
    slug: parsed.slug,
    publicName: parsed.publicName,
    description: parsed.description,
    markdown: parsed.markdown,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === "string") : [],
  };
}

function parsePluginConversionOutput(stdout: string): AntigravityPluginConversion {
  const parsed = JSON.parse(stdout) as Partial<AntigravityPluginConversion>;
  if (
    typeof parsed.schema !== "string"
    || typeof parsed.status !== "string"
    || typeof parsed.pluginName !== "string"
    || typeof parsed.sourceDir !== "string"
    || typeof parsed.pluginDir !== "string"
    || typeof parsed.counts !== "object"
    || parsed.counts === null
  ) {
    throw new Error("Antigravity converter returned an invalid plugin conversion payload.");
  }
  const counts = parsed.counts as Partial<AntigravityPluginConversion["counts"]>;
  return {
    schema: parsed.schema,
    status: parsed.status,
    pluginName: parsed.pluginName,
    sourceDir: parsed.sourceDir,
    pluginDir: parsed.pluginDir,
    counts: {
      commandSkills: Number(counts.commandSkills ?? 0),
      hooks: Number(counts.hooks ?? 0),
      mcpServers: Number(counts.mcpServers ?? 0),
      agents: Number(counts.agents ?? 0),
      skills: Number(counts.skills ?? 0),
      inventory: Number(counts.inventory ?? 0),
    },
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === "string") : [],
    inventory: Array.isArray(parsed.inventory)
      ? parsed.inventory.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          if (
            typeof row.source !== "string"
            || typeof row.kind !== "string"
            || typeof row.destination !== "string"
            || typeof row.status !== "string"
            || typeof row.note !== "string"
          ) {
            return [];
          }
          return [{
            source: row.source,
            kind: row.kind,
            destination: row.destination,
            status: row.status,
            note: row.note,
          }];
        })
      : [],
  };
}

interface PythonCommandResult {
  error?: Error;
  status: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isMissingPythonCommandResult(command: string, result: PythonCommandResult, platform: NodeJS.Platform = process.platform): boolean {
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
  if (errorCode === "ENOENT") return true;
  if (platform !== "win32") return false;

  const commandName = path.basename(command).replace(/\.(?:bat|cmd|com|exe)$/i, "");
  const text = `${String(result.stderr || "")}\n${String(result.stdout || "")}\n${result.error?.message || ""}`;
  if (result.status === 9009) return true;
  if (/python was not found|can't find a default python|no python at/i.test(text) && /^python\d*$|^py$/i.test(commandName)) return true;
  if (!/not recognized/i.test(text)) return false;

  const commandPattern = new RegExp(`(?:^|['"\\s\\\\/])${escapeRegExp(commandName)}(?:\\.(?:bat|cmd|com|exe))?(?:$|['"\\s:,.])`, "i");
  return commandPattern.test(text);
}

function convertWithExternalPython(input: AntigravityCommandSkillInput): AntigravityCommandSkill {
  const script = converterScriptPath();
  if (!fs.existsSync(script)) throw new Error(`Antigravity converter not found: ${script}`);
  const args = [
    script,
    "render-command-skill",
    "--source-path",
    input.sourcePath,
    "--source-rel-path",
    input.sourceRelPath,
  ];
  if (input.extensionName) args.push("--extension-name", input.extensionName);
  if (input.extensionDir) args.push("--extension-dir", input.extensionDir);

  let lastFailure = "unknown converter failure";
  for (const command of pythonCommands()) {
    const resolvedCommand = resolvePythonCommand(command);
    if (!resolvedCommand) {
      lastFailure = `${command} not found on PATH`;
      if (command === "python3" && !readEnvAgentx("PYTHON_BIN")) continue;
      break;
    }
    const result = spawnCommandSync(resolvedCommand, args, {
      cwd: path.dirname(script),
      env: converterEnv(),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    if (!result.error && result.status === 0) return parseConverterOutput(String(result.stdout || ""));
    const missingCommand = isMissingPythonCommandResult(command, result);
    lastFailure = missingCommand
      ? `${command} not found on PATH`
      : String(result.stderr || result.error?.message || `exit code ${String(result.status ?? "unknown")}`).trim();
    if (missingCommand && command === "python3" && !readEnvAgentx("PYTHON_BIN")) continue;
    break;
  }
  throw new Error(`Antigravity converter failed: ${lastFailure}`);
}

export function convertGeminiCommandToAntigravitySkill(input: AntigravityCommandSkillInput): AntigravityCommandSkill {
  return convertWithExternalPython(input);
}

export function convertGeminiExtensionToAntigravityPlugin(input: AntigravityPluginConversionInput): AntigravityPluginConversion {
  const script = converterScriptPath();
  if (!fs.existsSync(script)) throw new Error(`Antigravity converter not found: ${script}`);
  const args = [
    script,
    "convert-extension-plugin",
    "--source-dir",
    input.sourceDir,
    "--output-dir",
    input.outputDir,
    "--json",
  ];
  if (input.pluginName) args.push("--plugin-name", input.pluginName);

  let lastFailure = "unknown converter failure";
  for (const command of pythonCommands()) {
    const resolvedCommand = resolvePythonCommand(command);
    if (!resolvedCommand) {
      lastFailure = `${command} not found on PATH`;
      if (command === "python3" && !readEnvAgentx("PYTHON_BIN")) continue;
      break;
    }
    const result = spawnCommandSync(resolvedCommand, args, {
      cwd: path.dirname(script),
      env: converterEnv(),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    if (!result.error && result.status === 0) return parsePluginConversionOutput(String(result.stdout || ""));
    const missingCommand = isMissingPythonCommandResult(command, result);
    lastFailure = missingCommand
      ? `${command} not found on PATH`
      : String(result.stderr || result.error?.message || `exit code ${String(result.status ?? "unknown")}`).trim();
    if (missingCommand && command === "python3" && !readEnvAgentx("PYTHON_BIN")) continue;
    break;
  }
  throw new Error(`Antigravity converter failed: ${lastFailure}`);
}
