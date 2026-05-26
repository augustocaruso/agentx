import fs from "node:fs";
import path from "node:path";
import { resolveProjectPaths } from "./paths.js";
import { AGENTX_VERSION } from "./types.js";

export interface ManagedFileState {
  path: string;
  sha256: string;
  source: "ogb" | "rulesync";
  kind?: "agent" | "command" | "config" | "context" | "mcp" | "plugin" | "skill" | "tui" | "unknown" | "workflow";
  projection?: "gemini" | "opencode" | "antigravity" | "rulesync";
  origin?: string;
}

export type ManagedFileKind = NonNullable<ManagedFileState["kind"]>;
export type ManagedProjection = NonNullable<ManagedFileState["projection"]>;

export interface SyncResourceMarker {
  path: string;
  kind: ManagedFileKind;
  target: ManagedProjection | "gemini";
  exclusive: boolean;
  origin: string;
}

export interface SyncState {
  version: string;
  managedFiles: ManagedFileState[];
  lastRulesync?: {
    status: string;
    command?: string[];
    promoted: string[];
    conflicts: string[];
    skippedReason?: string;
  };
}

export function emptySyncState(version: string): SyncState {
  return {
    version,
    managedFiles: [],
  };
}

export function readSyncState(projectRoot = process.cwd(), homeDir?: string): SyncState | undefined {
  const statePath = resolveProjectPaths(projectRoot, homeDir).syncStatePath;
  if (!fs.existsSync(statePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8")) as SyncState;
  } catch {
    return undefined;
  }
}

export function writeSyncState(state: SyncState, projectRoot = process.cwd(), homeDir?: string): void {
  const statePath = resolveProjectPaths(projectRoot, homeDir).syncStatePath;
  state.version = AGENTX_VERSION;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function upsertManagedFile(state: SyncState, file: ManagedFileState): void {
  const index = state.managedFiles.findIndex((item) => item.path === file.path && item.source === file.source);
  if (index >= 0) state.managedFiles[index] = file;
  else state.managedFiles.push(file);
  state.managedFiles.sort((a, b) => `${a.source}:${a.path}`.localeCompare(`${b.source}:${b.path}`));
}

export function managedHashFor(state: SyncState | undefined, relPath: string, source: ManagedFileState["source"]): string | undefined {
  return state?.managedFiles.find((item) => item.path === relPath && item.source === source)?.sha256;
}
