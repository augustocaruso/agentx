import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  if (process.env.OGB_ANTIGRAVITY_CONVERTER) return process.env.OGB_ANTIGRAVITY_CONVERTER;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "scripts", "gemini_antigravity_converter.py");
}

function pythonCommands(): string[] {
  return process.env.OGB_PYTHON_BIN ? [process.env.OGB_PYTHON_BIN] : ["python3", "python"];
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
      if (command === "python3" && !process.env.OGB_PYTHON_BIN) continue;
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
    lastFailure = String(result.stderr || result.error?.message || `exit code ${String(result.status ?? "unknown")}`).trim();
    const missingCommand = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
    if (missingCommand && command === "python3" && !process.env.OGB_PYTHON_BIN) continue;
    break;
  }
  throw new Error(`Antigravity converter failed: ${lastFailure}`);
}

function safeSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "command";
}

function commandSegments(sourceRelPath: string): string[] {
  const normalized = sourceRelPath.replace(/[\\/]+/g, "/");
  const withoutCommands = normalized.startsWith("commands/") ? normalized.slice("commands/".length) : normalized;
  const suffix = path.extname(withoutCommands);
  const withoutSuffix = suffix ? withoutCommands.slice(0, -suffix.length) : withoutCommands;
  return withoutSuffix.split("/").filter(Boolean).map(safeSegment);
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
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed.slice(1);
    }
  }
  if (trimmed.startsWith("'")) return trimmed.endsWith("'") ? trimmed.slice(1, -1) : trimmed.slice(1);
  return trimmed;
}

function parseTomlCommand(text: string): { description?: string; prompt: string; warnings: string[] } {
  const warnings: string[] = [];
  const descriptionMatch = text.match(/^\s*description\s*=\s*(?<value>"[^"\n]*(?:\\.[^"\n]*)*"|'[^'\n]*'|[^\n#]+)/m);
  const blockMatch = text.match(/^\s*prompt\s*=\s*(?<quote>"""|''')\r?\n?(?<value>[\s\S]*?)\r?\n?\k<quote>/m);
  const linePromptMatch = text.match(/^\s*prompt\s*=\s*(?<value>"[^"\n]*(?:\\.[^"\n]*)*"|'[^'\n]*'|[^\n#]+)/m);
  const description = parseQuotedValue(descriptionMatch?.groups?.value)?.trim();
  let prompt = blockMatch?.groups?.value ?? parseQuotedValue(linePromptMatch?.groups?.value);

  if (!description) warnings.push("Missing description");
  if (!prompt?.trim()) {
    warnings.push("Missing prompt; copied raw TOML as fallback");
    prompt = text.trim();
  }

  return { description: description || undefined, prompt: prompt.trim(), warnings };
}

function parseMarkdownCommand(text: string, fallbackDescription: string): { description: string; prompt: string; warnings: string[] } {
  const match = text.match(/^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { description: fallbackDescription, prompt: text.trim(), warnings: [] };

  const frontmatter = match.groups?.frontmatter ?? "";
  let description = fallbackDescription;
  const descriptionMatch = frontmatter.match(/^\s*description\s*:\s*(?<value>"[^"\n]*(?:\\.[^"\n]*)*"|'[^'\n]*'|[^\n]+)/m);
  const rawDescription = descriptionMatch?.groups?.value?.trim();
  if (rawDescription) description = parseQuotedValue(rawDescription) ?? description;

  return { description, prompt: text.slice(match[0].length).trim(), warnings: [] };
}

function normalizeCommandPrompt(prompt: string, extensionDir?: string): string {
  let output = prompt.replace(/\{\{\s*args\s*\}\}/g, "$ARGUMENTS");
  if (extensionDir) output = output.replace(/\$\{extensionPath\}/g, extensionDir).replace(/\$\{\/\}/g, path.sep);
  return output.trim();
}

function renderCommandSkill(input: AntigravityCommandSkillInput, description: string, prompt: string): AntigravityCommandSkill {
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
    "<!-- GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT. -->",
    "<!-- SOURCE_KIND: gemini-antigravity-command-skill -->",
    ...sourceLines,
    `<!-- Source file: ${input.sourcePath} -->`,
    "",
    "This skill is the Antigravity launcher generated from a Gemini CLI command.",
    `When the user invokes /${publicName}, treat the text after the command as $ARGUMENTS.`,
    "",
    "## Launcher Instructions",
    "",
    normalizeCommandPrompt(prompt, input.extensionDir),
    "",
  ].join("\n");

  return { slug, publicName, description, markdown, warnings: [] };
}

function convertNatively(input: AntigravityCommandSkillInput): AntigravityCommandSkill {
  const text = fs.readFileSync(input.sourcePath, "utf8");
  const parsed = path.extname(input.sourcePath).toLowerCase() === ".toml"
    ? parseTomlCommand(text)
    : parseMarkdownCommand(text, `Gemini command: ${input.sourceRelPath}`);
  const description = parsed.description ?? `Gemini command: ${input.sourceRelPath}`;
  return {
    ...renderCommandSkill(input, description, parsed.prompt),
    warnings: parsed.warnings,
  };
}

export function convertGeminiCommandToAntigravitySkill(input: AntigravityCommandSkillInput): AntigravityCommandSkill {
  if (process.env.OGB_ANTIGRAVITY_CONVERTER || process.env.OGB_PYTHON_BIN) return convertWithExternalPython(input);
  return convertNatively(input);
}
