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

export function pythonCommands(platform: NodeJS.Platform = process.platform): string[] {
  const override = readEnvAgentx("PYTHON_BIN");
  if (override) return [override];
  if (platform === "win32") return ["python", "python3", "py"];
  return ["python3", "python"];
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

function safeCommandSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "command";
}

function commandSegments(sourceRelPath: string): string[] {
  const normalized = sourceRelPath.replace(/\\/g, "/");
  const withoutCommands = normalized.startsWith("commands/") ? normalized.slice("commands/".length) : normalized;
  const extension = path.posix.extname(withoutCommands);
  const withoutExtension = extension ? withoutCommands.slice(0, -extension.length) : withoutCommands;
  return withoutExtension.split("/").map(safeCommandSegment).filter(Boolean);
}

function slugForCommand(sourceRelPath: string): string {
  return commandSegments(sourceRelPath).join("-") || "command";
}

function publicNameForCommand(sourceRelPath: string): string {
  const segments = commandSegments(sourceRelPath);
  if (segments.length > 1) return `${segments.slice(0, -1).join(":")}:${segments.at(-1)}`;
  return segments[0] ?? "command";
}

function parseQuotedValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("\"")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed.endsWith("\"") ? trimmed.slice(1, -1) : trimmed.slice(1);
    }
  }
  if (trimmed.startsWith("'")) return trimmed.endsWith("'") ? trimmed.slice(1, -1) : trimmed.slice(1);
  return trimmed;
}

function parseTomlCommand(text: string): { description?: string; prompt: string; warnings: string[] } {
  const warnings: string[] = [];
  const descriptionMatch = text.match(/^\s*description\s*=\s*("[^"\n]*(?:\\.[^"\n]*)*"|'[^'\n]*'|[^\n#]+)/m);
  const blockMatch = text.match(/^\s*prompt\s*=\s*"""[\r\n]?([\s\S]*?)[\r\n]?"""/m)
    ?? text.match(/^\s*prompt\s*=\s*'''[\r\n]?([\s\S]*?)[\r\n]?'''/m);
  const linePromptMatch = text.match(/^\s*prompt\s*=\s*("[^"\n]*(?:\\.[^"\n]*)*"|'[^'\n]*'|[^\n#]+)/m);
  const description = parseQuotedValue(descriptionMatch?.[1]);
  let prompt = blockMatch?.[1] ?? parseQuotedValue(linePromptMatch?.[1]);
  if (!description) warnings.push("Missing description");
  if (!prompt?.trim()) {
    warnings.push("Missing prompt; copied raw TOML as fallback");
    prompt = text.trim();
  }
  return { description: description?.trim(), prompt: prompt.trim(), warnings };
}

function parseMarkdownCommand(text: string, fallbackDescription: string): { description: string; prompt: string; warnings: string[] } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { description: fallbackDescription, prompt: text.trim(), warnings: [] };

  const frontmatter = match[1] ?? "";
  const description = parseQuotedValue(frontmatter.match(/^\s*description\s*:\s*("[^"\n]*(?:\\.[^"\n]*)*"|'[^'\n]*'|[^\n]+)/m)?.[1])
    ?? fallbackDescription;
  return { description, prompt: text.slice(match[0].length).trim(), warnings: [] };
}

function normalizeCommandPrompt(prompt: string, extensionDir?: string): string {
  let output = prompt.replace(/\{\{\s*args\s*\}\}/g, "$ARGUMENTS");
  if (extensionDir) {
    output = output.replaceAll("${extensionPath}", extensionDir).replaceAll("${/}", path.sep);
    const runner = `node "${extensionDir}/scripts/run_python.mjs"`;
    output = output.replace(/\buv run --project\s+\S+\s+python\s+/g, `${runner} `);
    output = output.replace(/\buv run python\s+/g, `${runner} `);
  }
  output = output.replaceAll(" --config ~/.gemini/medical-notes-workbench/config.toml", "");
  output = output.replaceAll(
    "~/.gemini/medical-notes-workbench/config.toml",
    "config.toml resolved at runtime from MEDNOTES_HOME when set; otherwise the Workbench app home",
  );
  output = output.replace(/gemini extensions config\s+[\w.-]+\s+([A-Z0-9_]+)/g, "configure $1 in the Antigravity environment");
  return output.trim();
}

function convertWithInternalRenderer(input: AntigravityCommandSkillInput): AntigravityCommandSkill {
  const text = fs.readFileSync(input.sourcePath, "utf8");
  const fallbackDescription = `Gemini command: ${input.sourceRelPath}`;
  const parsed = input.sourcePath.toLowerCase().endsWith(".toml")
    ? parseTomlCommand(text)
    : parseMarkdownCommand(text, fallbackDescription);
  const description = parsed.description ?? fallbackDescription;
  const publicName = publicNameForCommand(input.sourceRelPath);
  const slug = slugForCommand(input.sourceRelPath);
  const sourceLines = input.extensionName
    ? [
        `<!-- Source extension: ${input.extensionName} -->`,
        `<!-- Source command: ${input.sourceRelPath} -->`,
      ]
    : [`<!-- Source command: ${input.sourceRelPath} -->`];
  const markdown = [
    "---",
    `name: ${JSON.stringify(publicName)}`,
    `description: ${JSON.stringify(`Use when the user invokes /${publicName}. ${description}`)}`,
    "---",
    "",
    `# /${publicName}`,
    "",
    "<!-- GENERATED BY agentX. DO NOT EDIT. -->",
    "<!-- SOURCE_KIND: gemini-antigravity-command-skill -->",
    ...sourceLines,
    `<!-- Source file: ${input.sourcePath} -->`,
    "",
    "This skill is the Antigravity launcher generated from a Gemini CLI command.",
    `When the user invokes /${publicName}, treat the text after the command as $ARGUMENTS.`,
    "",
    "## Launcher Instructions",
    "",
    normalizeCommandPrompt(parsed.prompt, input.extensionDir),
    "",
  ].join("\n");

  return {
    slug,
    publicName,
    description,
    markdown,
    warnings: parsed.warnings,
  };
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
  const hasPythonOverride = Boolean(readEnvAgentx("PYTHON_BIN"));
  for (const command of pythonCommands()) {
    const resolvedCommand = resolvePythonCommand(command);
    if (!resolvedCommand) {
      lastFailure = hasPythonOverride ? `${command} not found on PATH` : "python not found on PATH";
      if (!hasPythonOverride) continue;
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
      ? hasPythonOverride ? `${command} not found on PATH` : "python not found on PATH"
      : String(result.stderr || result.error?.message || `exit code ${String(result.status ?? "unknown")}`).trim();
    if (missingCommand && !hasPythonOverride) continue;
    break;
  }
  throw new Error(`Antigravity converter failed: ${lastFailure}`);
}

export function convertGeminiCommandToAntigravitySkill(input: AntigravityCommandSkillInput): AntigravityCommandSkill {
  try {
    return convertWithExternalPython(input);
  } catch {
    return convertWithInternalRenderer(input);
  }
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
  const hasPythonOverride = Boolean(readEnvAgentx("PYTHON_BIN"));
  for (const command of pythonCommands()) {
    const resolvedCommand = resolvePythonCommand(command);
    if (!resolvedCommand) {
      lastFailure = hasPythonOverride ? `${command} not found on PATH` : "python not found on PATH";
      if (!hasPythonOverride) continue;
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
      ? hasPythonOverride ? `${command} not found on PATH` : "python not found on PATH"
      : String(result.stderr || result.error?.message || `exit code ${String(result.status ?? "unknown")}`).trim();
    if (missingCommand && !hasPythonOverride) continue;
    break;
  }
  throw new Error(`Antigravity converter failed: ${lastFailure}`);
}
