import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENTX_VERSION, type GeminiImport } from "./types.js";

export interface FlattenOptions {
  input: string;
  output?: string;
  maxDepth?: number;
  write?: boolean;
  homeDir?: string;
}

export interface FlattenResult {
  content: string;
  input: string;
  output?: string;
  imports: GeminiImport[];
  warnings: string[];
  errors: string[];
}

function isWindowsAbsolute(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p);
}

export function resolveImportPath(raw: string, baseDir: string, homeDir = os.homedir()): string {
  let p = raw.trim();
  if ((p.startsWith("\"") && p.endsWith("\"")) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1);
  }

  if (p.startsWith("~/") || p.startsWith("~\\")) return path.resolve(homeDir, p.slice(2));
  if (path.isAbsolute(p) || isWindowsAbsolute(p)) return path.normalize(p);
  return path.resolve(baseDir, p);
}

interface GeminiImportToken {
  raw: string;
  start: number;
  end: number;
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function importPathCanStart(raw: string): boolean {
  return raw.startsWith(".") || raw.startsWith("/") || raw.startsWith("~") || isWindowsAbsolute(raw) || /^[A-Za-z]/.test(raw);
}

function importPathLooksMarkdown(raw: string): boolean {
  return raw.toLowerCase().endsWith(".md");
}

function inlineCodeRegions(line: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  const regex = /(`+)([\s\S]*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    regions.push([match.index, match.index + match[0].length]);
  }
  return regions;
}

function isInsideRegion(index: number, regions: Array<[number, number]>): boolean {
  return regions.some(([start, end]) => index >= start && index < end);
}

function parseGeminiImportTokens(line: string): GeminiImportToken[] {
  const imports: GeminiImportToken[] = [];
  const codeRegions = inlineCodeRegions(line);
  let index = 0;

  while (index < line.length) {
    const start = line.indexOf("@", index);
    if (start === -1) break;
    if (isInsideRegion(start, codeRegions) || (start > 0 && !isWhitespace(line[start - 1]))) {
      index = start + 1;
      continue;
    }

    let cursor = start + 1;
    const quote = line[cursor];
    let raw = "";

    if (quote === "\"" || quote === "'") {
      cursor += 1;
      const rawStart = cursor;
      while (cursor < line.length && line[cursor] !== quote) cursor += 1;
      if (cursor >= line.length) {
        index = start + 1;
        continue;
      }
      raw = line.slice(rawStart, cursor);
      cursor += 1;
    } else {
      const rawStart = cursor;
      while (cursor < line.length && !isWhitespace(line[cursor])) cursor += 1;
      raw = line.slice(rawStart, cursor);
    }

    if (raw.length > 0 && importPathCanStart(raw) && importPathLooksMarkdown(raw)) {
      imports.push({ raw, start, end: cursor });
    }
    index = Math.max(cursor, start + 1);
  }

  return imports;
}

export function parseGeminiImportLine(line: string): string[] {
  return parseGeminiImportTokens(line).map((token) => token.raw);
}

function isFenceToggle(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

function importComment(text: string): string {
  return ["", `<!-- OGB: ${text} -->`, ""].join("\n");
}

export function flattenGeminiMd(options: FlattenOptions): FlattenResult {
  const maxDepth = options.maxDepth ?? 10;
  const write = options.write ?? true;
  const homeDir = options.homeDir ?? os.homedir();
  const imports: GeminiImport[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  function expand(file: string, depth: number, stack: string[]): string {
    const full = path.resolve(file);

    if (depth > maxDepth) {
      const message = `Max import depth reached at ${full}`;
      warnings.push(message);
      return importComment(message);
    }

    if (stack.includes(full)) {
      const message = `Skipped circular import: ${[...stack, full].join(" -> ")}`;
      warnings.push(message);
      return importComment(message);
    }

    if (!fs.existsSync(full)) {
      const message = `Missing import: ${full}`;
      warnings.push(message);
      return importComment(message);
    }

    const base = path.dirname(full);
    const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
    const out: string[] = ["", `<!-- OGB BEGIN: ${full} -->`, ""];
    let inFence = false;

    for (const line of lines) {
      if (isFenceToggle(line)) {
        inFence = !inFence;
        out.push(line);
        continue;
      }

      const rawImports = inFence ? [] : parseGeminiImportTokens(line);
      if (rawImports.length === 0) {
        out.push(line);
        continue;
      }

      let expandedLine = "";
      let lastIndex = 0;
      for (const token of rawImports) {
        expandedLine += line.slice(lastIndex, token.start);
        lastIndex = token.end;
        const target = resolveImportPath(token.raw, base, homeDir);
        const exists = fs.existsSync(target);
        const circular = stack.includes(path.resolve(target)) || path.resolve(target) === full;
        const tooDeep = depth + 1 > maxDepth;
        const status = !exists || circular || tooDeep ? "warning" : "ok";
        imports.push({
          source: full,
          target,
          raw: token.raw,
          depth: depth + 1,
          status,
          message: !exists
            ? "Missing import"
            : circular
              ? "Circular import"
              : tooDeep
                ? "Max depth reached"
                : undefined,
        });
        expandedLine += expand(target, depth + 1, [...stack, full]);
      }
      expandedLine += line.slice(lastIndex);
      if (expandedLine.length > 0) out.push(expandedLine);
    }

    out.push("", `<!-- OGB END: ${full} -->`, "");
    return out.join("\n");
  }

  const input = path.resolve(options.input);
  const header = [
    "# GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT.",
    "",
    `Generator: ogb ${AGENTX_VERSION}`,
    `Source: ${input}`,
    "",
  ].join("\n");

  const content = header + expand(input, 0, []);

  if (write) {
    if (!options.output) throw new Error("flattenGeminiMd requires output when write is enabled");
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, content, "utf8");
  }

  return {
    content,
    input,
    output: options.output,
    imports,
    warnings,
    errors,
  };
}
