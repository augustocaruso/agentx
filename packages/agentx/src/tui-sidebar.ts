import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";
import { createBackupSession, type BackupRecord, type BackupSession } from "./backup-policy.js";
import { BINARY, DISPLAY } from "./brand.js";
import { sha256Text } from "./file-hash.js";
import { resolveProjectPaths } from "./paths.js";
import type { ProfileWriteReason, ProfileWriteStatus, ProfileWriter } from "./profile-writer.js";
import { emptySyncState, managedHashFor, readSyncState, upsertManagedFile, writeSyncState } from "./sync-state.js";
import { TUI_SIDEBAR_PLUGIN_SOURCE } from "./tui-sidebar-source.js";
import { AGENTX_VERSION } from "./types.js";

export { TUI_SIDEBAR_PLUGIN_SOURCE } from "./tui-sidebar-source.js";

export const TUI_SIDEBAR_PLUGIN_FILENAME = "ogb-sidebar.js";
export const TUI_SIDEBAR_PLUGIN_PATH = `.opencode/tui-plugins/${TUI_SIDEBAR_PLUGIN_FILENAME}`;
export const TUI_CONFIG_PATH = ".opencode/tui.jsonc";
export const GLOBAL_TUI_SIDEBAR_PLUGIN_PATH = `tui-plugins/${TUI_SIDEBAR_PLUGIN_FILENAME}`;
export const GLOBAL_TUI_CONFIG_PATH = "tui.json";
export const TUI_SIDEBAR_PLUGIN_SPEC = `./tui-plugins/${TUI_SIDEBAR_PLUGIN_FILENAME}`;
const TUI_SYNC_METADATA = {
  kind: "tui" as const,
  projection: "opencode" as const,
  origin: "ogb:tui-sidebar",
};

type TuiWriteStatus = Exclude<ProfileWriteStatus, "removed">;

export interface TuiSidebarResult {
  plugin: {
    path: string;
    relPath: string;
    status: TuiWriteStatus;
    message: string;
    backup?: string;
    reason?: ProfileWriteReason;
  };
  config: {
    path: string;
    relPath: string;
    status: TuiWriteStatus;
    message: string;
    backup?: string;
    reason?: ProfileWriteReason;
  };
  pluginCheck: {
    ok: boolean;
    message: string;
  };
  backups: BackupRecord[];
  warnings: string[];
}

function writeManagedText(options: {
  projectRoot: string;
  relPath: string;
  content: string;
  dryRun?: boolean;
  force?: boolean;
  backupSession: BackupSession;
  displayName?: string;
  managedContentMarkers?: readonly string[];
}): TuiSidebarResult["plugin"] {
  const absPath = path.join(options.projectRoot, ...options.relPath.split("/"));
  const desiredHash = sha256Text(options.content);
  const label = options.displayName ?? options.relPath;

  if (options.dryRun) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: fs.existsSync(absPath) ? "unchanged" : "preview",
      message: fs.existsSync(absPath) ? `Would leave existing ${label}` : `Would create ${label}`,
    };
  }

  const state = readSyncState(options.projectRoot) ?? emptySyncState(AGENTX_VERSION);
  const previousHash = managedHashFor(state, options.relPath, "ogb");
  const exists = fs.existsSync(absPath);
  const currentText = exists ? fs.readFileSync(absPath, "utf8") : "";
  const currentHash = exists ? sha256Text(currentText) : undefined;

  if (exists && currentHash === desiredHash) {
    upsertManagedFile(state, { path: options.relPath, sha256: desiredHash, source: "ogb", ...TUI_SYNC_METADATA });
    writeSyncState(state, options.projectRoot);
    return {
      path: absPath,
      relPath: options.relPath,
      status: "unchanged",
      message: `${label} already installed`,
    };
  }

  const recognizedRuntimeFile = exists
    && options.managedContentMarkers !== undefined
    && options.managedContentMarkers.some((marker) => currentText.includes(marker));
  if (exists && !options.force && previousHash !== currentHash && !recognizedRuntimeFile) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: "conflict",
      message: `${label} exists and is not managed by ${DISPLAY}; use --force to overwrite`,
    };
  }

  const backup = exists ? options.backupSession.backupExisting(absPath) : undefined;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, options.content, "utf8");
  upsertManagedFile(state, { path: options.relPath, sha256: desiredHash, source: "ogb", ...TUI_SYNC_METADATA });
  writeSyncState(state, options.projectRoot);

  return {
    path: absPath,
    relPath: options.relPath,
    status: exists ? "updated" : "created",
    backup,
    message: `${exists ? "Updated" : "Created"} ${label}`,
  };
}

function writeUnmanagedText(options: {
  filePath: string;
  relPath: string;
  content: string;
  dryRun?: boolean;
  backupSession?: BackupSession;
  profileWriter?: Pick<ProfileWriter, "writeText">;
}): TuiSidebarResult["plugin"] {
  if (options.profileWriter) {
    const write = options.profileWriter.writeText({
      filePath: options.filePath,
      text: options.content,
    });
    return {
      path: write.path,
      relPath: options.relPath,
      status: write.status as TuiWriteStatus,
      message: write.status === "protected"
        ? `Protected ${options.relPath} by local maintainer mode`
        : write.status === "unchanged"
          ? `${options.relPath} already installed`
          : write.status === "preview"
            ? `Would ${fs.existsSync(options.filePath) ? "update" : "create"} ${options.relPath}`
            : `${write.status === "updated" ? "Updated" : "Created"} ${options.relPath}`,
      backup: write.backup,
      reason: write.reason,
    };
  }

  const exists = fs.existsSync(options.filePath);
  const current = exists ? fs.readFileSync(options.filePath, "utf8") : "";
  if (current === options.content) {
    return {
      path: options.filePath,
      relPath: options.relPath,
      status: "unchanged",
      message: `${options.relPath} already installed`,
    };
  }
  if (options.dryRun) {
    return {
      path: options.filePath,
      relPath: options.relPath,
      status: "preview",
      message: exists ? `Would update ${options.relPath}` : `Would create ${options.relPath}`,
    };
  }

  const backup = exists ? options.backupSession?.backupExisting(options.filePath) : undefined;
  fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
  fs.writeFileSync(options.filePath, options.content, "utf8");
  return {
    path: options.filePath,
    relPath: options.relPath,
    status: exists ? "updated" : "created",
    backup,
    message: `${exists ? "Updated" : "Created"} ${options.relPath}`,
  };
}

function pluginSpecs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Array.isArray(item) ? item[0] : item)
    .filter((item): item is string => typeof item === "string");
}

function requiredTuiPluginSpecs(extraPlugins: string[] | undefined, basePlugins = [TUI_SIDEBAR_PLUGIN_SPEC]): string[] {
  return [...new Set([...(extraPlugins ?? []), ...basePlugins].map((item) => item.trim()).filter(Boolean))];
}

function tuiConfigTextWithPlugin(currentText: string | undefined, extraPlugins?: string[], defaults?: Record<string, unknown>): { text?: string; changed: boolean; error?: string } {
  const basePlugins = pluginSpecs(defaults?.plugin);
  const requiredPlugins = requiredTuiPluginSpecs(extraPlugins, basePlugins.length > 0 ? basePlugins : [TUI_SIDEBAR_PLUGIN_SPEC]);
  const defaultConfig = defaults
    ? { ...defaults, plugin: requiredPlugins }
    : {
      $schema: "https://opencode.ai/tui.json",
      plugin: requiredPlugins,
    };

  if (!currentText) {
    return {
      changed: true,
      text: `${JSON.stringify(defaultConfig, null, 2)}\n`,
    };
  }

  let parsed: any;
  try {
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    parsed = parseJsonc(currentText, errors);
    if (errors.length > 0) return { changed: false, error: "TUI config has invalid JSONC syntax" };
  } catch (error) {
    return { changed: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { changed: false, error: "TUI config root is not an object" };
  }

  if (parsed.plugin !== undefined && !Array.isArray(parsed.plugin)) {
    return { changed: false, error: "TUI config plugin field is not an array" };
  }

  if (defaults) {
    const nextConfig = { ...parsed, ...defaultConfig };
    const nextText = `${JSON.stringify(nextConfig, null, 2)}\n`;
    return { changed: nextText !== currentText, text: nextText };
  }

  const existingPlugins = pluginSpecs(parsed.plugin);
  const missingPlugins = requiredPlugins.filter((plugin) => !existingPlugins.includes(plugin));
  if (missingPlugins.length === 0) {
    return { changed: false, text: currentText };
  }

  try {
    if (parsed.plugin === undefined) {
      const edits = modify(currentText, ["plugin"], requiredPlugins, {
          formattingOptions: {
            insertSpaces: true,
            tabSize: 2,
          },
        });
      return { changed: true, text: `${applyEdits(currentText, edits).trimEnd()}\n` };
    }

    let text = currentText;
    for (const plugin of missingPlugins) {
      const edits = modify(text, ["plugin", -1], plugin, {
          formattingOptions: {
            insertSpaces: true,
            tabSize: 2,
          },
        });
      text = applyEdits(text, edits);
    }
    return { changed: true, text: `${text.trimEnd()}\n` };
  } catch (error) {
    return { changed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function ensureTuiConfigFile(options: {
  configPath: string;
  relPath: string;
  dryRun?: boolean;
  extraPlugins?: string[];
  configDefaults?: Record<string, unknown>;
  stateProjectRoot?: string;
  backupSession?: BackupSession;
  profileWriter?: Pick<ProfileWriter, "writeText">;
}): TuiSidebarResult["config"] {
  const absPath = options.configPath;
  const exists = fs.existsSync(absPath);
  const currentText = exists ? fs.readFileSync(absPath, "utf8") : undefined;
  const next = tuiConfigTextWithPlugin(currentText, options.extraPlugins, options.configDefaults);

  if (next.error) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: "conflict",
      message: `${options.relPath} could not be updated: ${next.error}`,
    };
  }

  if (options.dryRun) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: exists ? "unchanged" : "preview",
      message: next.changed ? `Would ${exists ? "update" : "create"} ${options.relPath}` : `${options.relPath} already references ${TUI_SIDEBAR_PLUGIN_SPEC}`,
    };
  }

  if (!next.text) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: "unchanged",
      message: `${options.relPath} already references ${TUI_SIDEBAR_PLUGIN_SPEC}`,
    };
  }

  if (!next.changed) {
    if (options.stateProjectRoot) {
      const state = readSyncState(options.stateProjectRoot) ?? emptySyncState(AGENTX_VERSION);
      upsertManagedFile(state, { path: options.relPath, sha256: sha256Text(next.text), source: "ogb", ...TUI_SYNC_METADATA });
      writeSyncState(state, options.stateProjectRoot);
    }
    return {
      path: absPath,
      relPath: options.relPath,
      status: "unchanged",
      message: `${options.relPath} already references ${TUI_SIDEBAR_PLUGIN_SPEC}`,
    };
  }

  if (options.profileWriter) {
    const write = options.profileWriter.writeText({
      filePath: absPath,
      text: next.text,
    });
    return {
      path: write.path,
      relPath: options.relPath,
      status: write.status as TuiWriteStatus,
      message: write.status === "protected"
        ? `Protected ${options.relPath} by local maintainer mode`
        : write.status === "unchanged"
          ? `${options.relPath} already references ${TUI_SIDEBAR_PLUGIN_SPEC}`
          : write.status === "preview"
            ? `Would ${exists ? "update" : "create"} ${options.relPath}`
            : `${write.status === "updated" ? "Updated" : "Created"} ${options.relPath}`,
      backup: write.backup,
      reason: write.reason,
    };
  }

  const backup = exists ? options.backupSession?.backupExisting(absPath) : undefined;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, next.text, "utf8");
  if (options.stateProjectRoot) {
    const state = readSyncState(options.stateProjectRoot) ?? emptySyncState(AGENTX_VERSION);
    upsertManagedFile(state, { path: options.relPath, sha256: sha256Text(next.text), source: "ogb", ...TUI_SYNC_METADATA });
    writeSyncState(state, options.stateProjectRoot);
  }

  return {
    path: absPath,
    relPath: options.relPath,
    status: exists ? "updated" : "created",
    backup,
    message: `${exists ? "Updated" : "Created"} ${options.relPath}`,
  };
}

function ensureTuiConfig(options: { projectRoot: string; dryRun?: boolean; extraPlugins?: string[]; backupSession: BackupSession }): TuiSidebarResult["config"] {
  return ensureTuiConfigFile({
    configPath: path.join(options.projectRoot, ...TUI_CONFIG_PATH.split("/")),
    relPath: TUI_CONFIG_PATH,
    dryRun: options.dryRun,
    extraPlugins: options.extraPlugins,
    stateProjectRoot: options.projectRoot,
    backupSession: options.backupSession,
  });
}

export function checkTuiSidebarPluginSyntax(pluginPath?: string, source = TUI_SIDEBAR_PLUGIN_SOURCE): TuiSidebarResult["pluginCheck"] {
  let target = pluginPath;
  let tempDir: string | undefined;

  if (!target) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${BINARY}-sidebar-check-`));
    target = path.join(tempDir, `${BINARY}-sidebar.js`);
    fs.writeFileSync(target, source, "utf8");
  }

  const result = spawnSync(process.execPath, ["--check", target], {
    encoding: "utf8",
    timeout: 10_000,
  });

  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });

  if (result.error) {
    return {
      ok: false,
      message: `Could not run node --check: ${result.error.message}`,
    };
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      message: `TUI sidebar plugin syntax check failed${detail ? `: ${detail}` : ""}`,
    };
  }

  return {
    ok: true,
    message: "TUI sidebar plugin syntax check passed",
  };
}

export function ensureTuiSidebar(options: { projectRoot?: string; homeDir?: string; dryRun?: boolean; force?: boolean; extraPlugins?: string[]; backupSession?: BackupSession } = {}): TuiSidebarResult {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const projectRoot = paths.projectRoot;
  const backupSession = options.backupSession ?? createBackupSession({
    bridgeConfigDir: paths.bridgeConfigDir,
    operation: "tui-sidebar",
    roots: [{ root: projectRoot, prefix: "project" }],
    dryRun: options.dryRun,
  });
  const warnings: string[] = [];
  const plugin = writeManagedText({
    projectRoot,
    relPath: TUI_SIDEBAR_PLUGIN_PATH,
    content: TUI_SIDEBAR_PLUGIN_SOURCE,
    dryRun: options.dryRun,
    force: options.force,
    backupSession,
    displayName: `${DISPLAY} TUI sidebar plugin`,
    managedContentMarkers: ["ogb:sidebar", "agentx:sidebar", "shouldRegisterOgbSidebar", "shouldRegisterAgentxSidebar"],
  });
  if (plugin.status === "conflict") warnings.push(plugin.message);

  const config = ensureTuiConfig({ projectRoot, dryRun: options.dryRun, extraPlugins: options.extraPlugins, backupSession });
  if (config.status === "conflict") warnings.push(config.message);

  const pluginCheck = options.dryRun || plugin.status === "conflict"
    ? checkTuiSidebarPluginSyntax()
    : checkTuiSidebarPluginSyntax(plugin.path);
  if (!pluginCheck.ok) warnings.push(pluginCheck.message);

  return {
    plugin,
    config,
    pluginCheck,
    backups: backupSession.backups,
    warnings: [...new Set([...warnings, ...backupSession.retention.warnings])],
  };
}

export function ensureGlobalTuiSidebar(options: { configDir: string; dryRun?: boolean; extraPlugins?: string[]; profileWriter?: Pick<ProfileWriter, "writeText">; backupSession?: BackupSession; pluginSource?: string; configDefaults?: Record<string, unknown> }): TuiSidebarResult {
  const configDir = path.resolve(options.configDir);
  const warnings: string[] = [];
  const pluginPath = path.join(configDir, ...GLOBAL_TUI_SIDEBAR_PLUGIN_PATH.split("/"));
  const pluginSource = options.pluginSource ?? TUI_SIDEBAR_PLUGIN_SOURCE;
  const plugin = writeUnmanagedText({
    filePath: pluginPath,
    relPath: GLOBAL_TUI_SIDEBAR_PLUGIN_PATH,
    content: pluginSource,
    dryRun: options.dryRun,
    backupSession: options.backupSession,
    profileWriter: options.profileWriter,
  });

  const config = ensureTuiConfigFile({
    configPath: path.join(configDir, GLOBAL_TUI_CONFIG_PATH),
    relPath: GLOBAL_TUI_CONFIG_PATH,
    dryRun: options.dryRun,
    extraPlugins: options.extraPlugins,
    configDefaults: options.configDefaults,
    backupSession: options.backupSession,
    profileWriter: options.profileWriter,
  });
  if (config.status === "conflict") warnings.push(config.message);

  const pluginCheck = options.dryRun || plugin.status === "protected"
    ? checkTuiSidebarPluginSyntax(undefined, pluginSource)
    : checkTuiSidebarPluginSyntax(plugin.path);
  if (!pluginCheck.ok) warnings.push(pluginCheck.message);

  return {
    plugin,
    config,
    pluginCheck,
    backups: options.backupSession?.backups ?? [],
    warnings: [...new Set([...warnings, ...(options.backupSession?.retention.warnings ?? [])])],
  };
}
