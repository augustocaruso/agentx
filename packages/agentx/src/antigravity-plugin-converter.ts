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

interface PythonCommandResult {
  error?: Error;
  status: number | null;
  stderr?: string | Buffer;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isMissingPythonCommandResult(command: string, result: PythonCommandResult, platform: NodeJS.Platform = process.platform): boolean {
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
  if (errorCode === "ENOENT") return true;
  if (platform !== "win32") return false;

  const text = String(result.stderr || result.error?.message || "");
  if (!/not recognized/i.test(text)) return false;

  const commandName = path.basename(command).replace(/\.(?:bat|cmd|com|exe)$/i, "");
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
