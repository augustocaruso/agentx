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

function pythonCommand(): string {
  return process.env.OGB_PYTHON_BIN || "python3";
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

export function convertGeminiCommandToAntigravitySkill(input: AntigravityCommandSkillInput): AntigravityCommandSkill {
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

  const result = spawnCommandSync(pythonCommand(), args, {
    cwd: path.dirname(script),
    env: process.env,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || "unknown converter failure").trim();
    throw new Error(`Antigravity converter failed: ${detail}`);
  }
  return parseConverterOutput(String(result.stdout || ""));
}
