import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBeforeGeminiExtensionUpdatePatches, type GeminiExtensionPatchTarget, type OgbPatch, type PatchRunReport } from "./patches.js";
import { spawnCommandSync } from "./process.js";
import type { RitualProgressSink } from "./ritual-progress.js";

const DEFAULT_EXTENSION_UPDATE_TIMEOUT_MS = 120_000;
const AUTO_CONSENT_INPUT = `${"y\n".repeat(25)}`;
const INSTALL_METADATA_FILENAME = ".gemini-extension-install.json";

export interface ExtensionInstallOptions {
  source: string;
  ref?: string;
  autoUpdate?: boolean;
  preRelease?: boolean;
  trust?: boolean;
  dryRun?: boolean;
  geminiBin?: string;
}

export interface ExtensionUpdateOptions {
  name?: string;
  all?: boolean;
  dryRun?: boolean;
  geminiBin?: string;
  autoConsent?: boolean;
  timeoutMs?: number;
  cwd?: string;
  projectRoot?: string;
  homeDir?: string;
  patchRegistry?: readonly OgbPatch[];
  onPatchProgress?: RitualProgressSink;
}

export interface ExtensionSourceInspection {
  source: string;
  installSource: string;
  local: boolean;
  extensionRoot?: string;
  manifestPath?: string;
  hooks: string[];
  scripts: string[];
  warnings: string[];
}

export interface ExtensionCommandReport {
  status: "applied" | "preview" | "blocked" | "error";
  command: string[];
  inspection?: ExtensionSourceInspection;
  beforeExtensions?: InstalledGeminiExtension[];
  afterExtensions?: InstalledGeminiExtension[];
  patches?: PatchRunReport[];
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdoutTail?: string;
  stderrTail?: string;
  error?: string;
  timedOut?: boolean;
  repairedExtensions?: string[];
  repairCommands?: string[][];
}

export interface InstalledGeminiExtension extends GeminiExtensionPatchTarget {
  scope: "project" | "global";
}

type ExtensionInstallMetadata = {
  source?: unknown;
  type?: unknown;
  ref?: unknown;
  autoUpdate?: unknown;
  allowPreRelease?: unknown;
};

function isRemoteSource(source: string): boolean {
  return /^(https?:|git@|ssh:|git:)/.test(source) || source.endsWith(".git");
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function readJson(filePath: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJson(filePath: string, value: Record<string, unknown>): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function findManifestRoot(root: string): string | undefined {
  if (fileExists(path.join(root, "gemini-extension.json"))) return root;
  if (!dirExists(root)) return undefined;

  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name);
    if (fileExists(path.join(candidate, "gemini-extension.json"))) return candidate;
  }

  return undefined;
}

function listRiskFiles(root: string, relRoot = "", depth = 0): { hooks: string[]; scripts: string[] } {
  const hooks: string[] = [];
  const scripts: string[] = [];
  if (!dirExists(root) || depth > 3) return { hooks, scripts };

  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(root, entry.name);
    const relPath = path.join(relRoot, entry.name).split(path.sep).join("/");

    if (entry.isDirectory()) {
      const nested = listRiskFiles(fullPath, relPath, depth + 1);
      hooks.push(...nested.hooks);
      scripts.push(...nested.scripts);
      continue;
    }

    if (!entry.isFile()) continue;
    if (relPath === "hooks/hooks.json" || relPath.endsWith("/hooks/hooks.json") || entry.name === "hooks.json") hooks.push(relPath);
    if (/\.(sh|bash|zsh|ps1|bat|cmd)$/i.test(entry.name)) scripts.push(relPath);
  }

  return { hooks, scripts };
}

export function inspectExtensionSource(source: string): ExtensionSourceInspection {
  if (isRemoteSource(source)) {
    return {
      source,
      installSource: source,
      local: false,
      hooks: [],
      scripts: [],
      warnings: ["Remote extensions cannot be inspected before install; use --trust only for sources you trust."],
    };
  }

  const resolved = path.resolve(source);
  const extensionRoot = findManifestRoot(resolved);
  const warnings: string[] = [];
  if (!extensionRoot) warnings.push("Missing gemini-extension.json; Gemini CLI install may fail.");
  const risks = extensionRoot ? listRiskFiles(extensionRoot) : { hooks: [], scripts: [] };
  if (risks.hooks.length) warnings.push(`Hooks found: ${risks.hooks.join(", ")}`);
  if (risks.scripts.length) warnings.push(`Executable scripts found: ${risks.scripts.join(", ")}`);

  return {
    source,
    installSource: extensionRoot ?? resolved,
    local: true,
    extensionRoot,
    manifestPath: extensionRoot ? path.join(extensionRoot, "gemini-extension.json") : undefined,
    hooks: risks.hooks,
    scripts: risks.scripts,
    warnings,
  };
}

export function buildInstallExtensionArgs(options: ExtensionInstallOptions): string[] {
  const inspection = inspectExtensionSource(options.source);
  const args = ["extensions", "install", inspection.installSource];
  if (options.ref) args.push("--ref", options.ref);
  if (options.autoUpdate ?? !inspection.local) args.push("--auto-update");
  if (options.preRelease) args.push("--pre-release");
  if (options.trust) args.push("--consent");
  return args;
}

export function buildUpdateExtensionsArgs(options: ExtensionUpdateOptions = {}): string[] {
  const args = ["extensions", "update"];
  if (options.name) args.push(options.name);
  else if (options.all !== false) args.push("--all");
  return args;
}

export function listInstalledGeminiExtensions(options: Pick<ExtensionUpdateOptions, "projectRoot" | "homeDir"> = {}): InstalledGeminiExtension[] {
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const roots = uniquePaths([
    path.join(projectRoot, ".gemini", "extensions"),
    path.join(homeDir, ".gemini", "extensions"),
  ]);
  const extensions: InstalledGeminiExtension[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!dirExists(root)) continue;
    const scope: InstalledGeminiExtension["scope"] = root.startsWith(path.join(homeDir, ".gemini")) ? "global" : "project";
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const extensionPath = path.join(root, entry.name);
      const key = path.resolve(extensionPath);
      if (seen.has(key)) continue;
      seen.add(key);
      const manifestPath = path.join(extensionPath, "gemini-extension.json");
      const manifest = fileExists(manifestPath) ? readJson(manifestPath) : undefined;
      const manifestName = typeof manifest?.name === "string" ? manifest.name : undefined;
      const currentVersion = typeof manifest?.version === "string" ? manifest.version : undefined;
      const currentRef = typeof manifest?.ref === "string"
        ? manifest.ref
        : typeof manifest?.revision === "string"
          ? manifest.revision
          : undefined;
      const source = typeof manifest?.repository === "string"
        ? manifest.repository
        : typeof manifest?.source === "string"
          ? manifest.source
          : undefined;
      extensions.push({
        name: manifestName ?? entry.name,
        extensionPath,
        manifestPath: fileExists(manifestPath) ? manifestPath : undefined,
        currentVersion,
        currentRef,
        source,
        scope,
      });
    }
  }

  return extensions.sort((a, b) => a.name.localeCompare(b.name) || a.extensionPath.localeCompare(b.extensionPath));
}

function targetExtensionsForUpdate(options: ExtensionUpdateOptions): InstalledGeminiExtension[] {
  const installed = listInstalledGeminiExtensions(options);
  if (options.name) return installed.filter((extension) => extension.name === options.name || path.basename(extension.extensionPath) === options.name);
  if (options.all === false) return [];
  return installed;
}

function runBeforeUpdatePatches(options: ExtensionUpdateOptions): {
  beforeExtensions: InstalledGeminiExtension[];
  patches: PatchRunReport[];
  blocked?: string;
} {
  const beforeExtensions = targetExtensionsForUpdate(options);
  const patches: PatchRunReport[] = [];
  for (const extension of beforeExtensions) {
    const report = runBeforeGeminiExtensionUpdatePatches({
      projectRoot: options.projectRoot,
      homeDir: options.homeDir,
      dryRun: options.dryRun,
      registry: options.patchRegistry,
      extension,
      onProgress: options.onPatchProgress,
    });
    patches.push(report);
  }
  const blocked = patches
    .flatMap((report) => report.errors)
    .find((error) => error.trim().length > 0);
  return { beforeExtensions, patches, blocked };
}

function runGemini(geminiBin: string, args: string[], cwd = process.cwd()): boolean {
  const result = spawnCommandSync(geminiBin, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  return !result.error && result.status === 0;
}

function tail(value: string | Buffer | undefined, maxChars = 2000): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function appendTail(...parts: Array<string | undefined>): string | undefined {
  return tail(parts.filter((part): part is string => Boolean(part?.trim())).join("\n"));
}

function installMetadataPath(extension: InstalledGeminiExtension): string {
  return path.join(extension.extensionPath, INSTALL_METADATA_FILENAME);
}

function readInstallMetadata(extension: InstalledGeminiExtension): ExtensionInstallMetadata | undefined {
  const metadata = readJson(installMetadataPath(extension));
  return metadata as ExtensionInstallMetadata | undefined;
}

function normalizedGithubGitSource(source: string): string | undefined {
  const match = source.match(/^https:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!match) return undefined;
  const [, owner, repo] = match;
  if (!owner || !repo) return undefined;
  return `https://github.com/${owner}/${repo}.git`;
}

function repairGitInstallMetadataForUpdate(extensions: InstalledGeminiExtension[], dryRun = false): string[] {
  const repaired: string[] = [];
  for (const extension of extensions) {
    const metadataPath = installMetadataPath(extension);
    const metadata = readJson(metadataPath);
    if (!metadata || metadata.type !== "git" || typeof metadata.source !== "string") continue;
    const normalizedSource = normalizedGithubGitSource(metadata.source);
    if (!normalizedSource) continue;
    const next = { ...metadata };
    if (next.source !== normalizedSource) next.source = normalizedSource;
    if (typeof next.ref === "string" && next.ref.trim() && next.autoUpdate !== true) next.autoUpdate = true;
    if (JSON.stringify(next) === JSON.stringify(metadata)) continue;
    repaired.push(extension.name);
    if (!dryRun) writeJson(metadataPath, next);
  }
  return repaired;
}

function repairableGitInstallMetadata(extension: InstalledGeminiExtension): {
  source: string;
  ref?: string;
  autoUpdate: boolean;
  allowPreRelease: boolean;
} | undefined {
  const metadata = readInstallMetadata(extension);
  if (!metadata || metadata.type !== "git" || typeof metadata.source !== "string") return undefined;
  const source = normalizedGithubGitSource(metadata.source) ?? metadata.source;
  return {
    source,
    ref: typeof metadata.ref === "string" && metadata.ref.trim() ? metadata.ref : undefined,
    autoUpdate: metadata.autoUpdate === true,
    allowPreRelease: metadata.allowPreRelease === true,
  };
}

function integrityMismatchNames(report: ExtensionCommandReport): string[] {
  const text = `${report.stdoutTail ?? ""}\n${report.stderrTail ?? ""}\n${report.error ?? ""}`;
  const names = new Set<string>();
  for (const match of text.matchAll(/Integrity mismatch for "([^"]+)"/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

function runGeminiCaptured(geminiBin: string, args: string[], options: Pick<ExtensionUpdateOptions, "autoConsent" | "timeoutMs" | "cwd">): ExtensionCommandReport {
  const result = spawnCommandSync(geminiBin, args, {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    encoding: "utf8",
    input: options.autoConsent ? AUTO_CONSENT_INPUT : undefined,
    timeout: Math.max(1, Number(options.timeoutMs ?? DEFAULT_EXTENSION_UPDATE_TIMEOUT_MS)),
    maxBuffer: 1024 * 1024,
  });
  const errorCode = typeof (result.error as NodeJS.ErrnoException | undefined)?.code === "string"
    ? (result.error as NodeJS.ErrnoException).code
    : undefined;
  const timedOut = errorCode === "ETIMEDOUT";
  return {
    status: !result.error && result.status === 0 ? "applied" : "error",
    command: [geminiBin, ...args],
    exitCode: result.status,
    signal: result.signal,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    error: result.error ? result.error.message : undefined,
    timedOut,
  };
}

function reinstallIntegrityMismatchExtensions(
  report: ExtensionCommandReport,
  geminiBin: string,
  extensions: InstalledGeminiExtension[],
  options: Pick<ExtensionUpdateOptions, "autoConsent" | "timeoutMs" | "cwd">,
): ExtensionCommandReport {
  const names = integrityMismatchNames(report);
  if (names.length === 0) return report;

  const repairedExtensions: string[] = [];
  const repairCommands: string[][] = [];
  let stdoutTail = report.stdoutTail;
  let stderrTail = report.stderrTail;

  for (const name of names) {
    const extension = extensions.find((candidate) => candidate.name === name || path.basename(candidate.extensionPath) === name);
    const metadata = extension ? repairableGitInstallMetadata(extension) : undefined;
    if (!extension || !metadata) {
      return {
        ...report,
        status: "error",
        error: `Gemini extension ${name} has an integrity mismatch and no repairable git install metadata.`,
        repairedExtensions,
        repairCommands,
      };
    }

    const uninstallArgs = ["extensions", "uninstall", name];
    const uninstall = runGeminiCaptured(geminiBin, uninstallArgs, options);
    repairCommands.push([geminiBin, ...uninstallArgs]);
    stdoutTail = appendTail(stdoutTail, uninstall.stdoutTail);
    stderrTail = appendTail(stderrTail, uninstall.stderrTail, uninstall.error);
    if (uninstall.status !== "applied") {
      return {
        ...report,
        status: "error",
        stdoutTail,
        stderrTail,
        error: `Could not uninstall ${name} before reinstalling it.`,
        repairedExtensions,
        repairCommands,
      };
    }

    const installArgs = ["extensions", "install", metadata.source];
    if (metadata.ref) installArgs.push("--ref", metadata.ref);
    if (metadata.autoUpdate || metadata.ref) installArgs.push("--auto-update");
    if (metadata.allowPreRelease) installArgs.push("--pre-release");
    installArgs.push("--consent");
    const install = runGeminiCaptured(geminiBin, installArgs, { ...options, autoConsent: false });
    repairCommands.push([geminiBin, ...installArgs]);
    stdoutTail = appendTail(stdoutTail, install.stdoutTail);
    stderrTail = appendTail(stderrTail, install.stderrTail, install.error);
    if (install.status !== "applied") {
      return {
        ...report,
        status: "error",
        stdoutTail,
        stderrTail,
        error: `Could not reinstall ${name} after Gemini reported an integrity mismatch.`,
        repairedExtensions,
        repairCommands,
      };
    }
    repairedExtensions.push(name);
  }

  return {
    ...report,
    status: "applied",
    stdoutTail,
    stderrTail,
    repairedExtensions,
    repairCommands,
  };
}

export function installGeminiExtension(options: ExtensionInstallOptions): ExtensionCommandReport {
  const geminiBin = options.geminiBin ?? process.env.GEMINI_BIN ?? "gemini";
  const inspection = inspectExtensionSource(options.source);
  const command = [geminiBin, ...buildInstallExtensionArgs(options)];
  const hasLocalRisk = inspection.local && (inspection.hooks.length > 0 || inspection.scripts.length > 0);

  if (hasLocalRisk && !options.trust) {
    return { status: options.dryRun ? "preview" : "blocked", command, inspection };
  }

  if (options.dryRun) return { status: "preview", command, inspection };

  if (inspection.local && inspection.extensionRoot) {
    const valid = runGemini(geminiBin, ["extensions", "validate", inspection.extensionRoot]);
    if (!valid) return { status: "error", command, inspection };
  }

  return {
    status: runGemini(geminiBin, command.slice(1)) ? "applied" : "error",
    command,
    inspection,
  };
}

export function updateGeminiExtensions(options: ExtensionUpdateOptions = {}): ExtensionCommandReport {
  const geminiBin = options.geminiBin ?? process.env.GEMINI_BIN ?? "gemini";
  const command = [geminiBin, ...buildUpdateExtensionsArgs(options)];
  const preUpdate = runBeforeUpdatePatches(options);

  if (preUpdate.blocked) {
    return {
      status: "blocked",
      command,
      beforeExtensions: preUpdate.beforeExtensions,
      patches: preUpdate.patches,
      error: `Gemini extension update blocked before overwrite: ${preUpdate.blocked}`,
    };
  }

  if (options.dryRun) return { status: "preview", command, beforeExtensions: preUpdate.beforeExtensions, patches: preUpdate.patches };
  repairGitInstallMetadataForUpdate(preUpdate.beforeExtensions);
  if ((options.projectRoot || options.homeDir) && preUpdate.beforeExtensions.length === 0) {
    return {
      status: "applied",
      command,
      beforeExtensions: preUpdate.beforeExtensions,
      afterExtensions: [],
      patches: preUpdate.patches,
    };
  }
  if (options.autoConsent) {
    const report = runGeminiCaptured(geminiBin, command.slice(1), options);
    const repairedReport = reinstallIntegrityMismatchExtensions(report, geminiBin, preUpdate.beforeExtensions, options);
    return {
      ...repairedReport,
      ...report,
      status: repairedReport.status,
      beforeExtensions: preUpdate.beforeExtensions,
      afterExtensions: listInstalledGeminiExtensions(options),
      patches: preUpdate.patches,
      stdoutTail: repairedReport.stdoutTail,
      stderrTail: repairedReport.stderrTail,
      error: repairedReport.error,
      repairedExtensions: repairedReport.repairedExtensions,
      repairCommands: repairedReport.repairCommands,
    };
  }
  const applied = runGemini(geminiBin, command.slice(1));
  return {
    status: applied ? "applied" : "error",
    command,
    beforeExtensions: preUpdate.beforeExtensions,
    afterExtensions: listInstalledGeminiExtensions(options),
    patches: preUpdate.patches,
  };
}

export function formatCommand(command: string[]): string {
  return command.map((part) => /^[A-Za-z0-9_./:=@%+-]+$/.test(part) ? part : `'${part.replace(/'/g, "'\\''")}'`).join(" ");
}
