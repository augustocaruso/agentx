import fs from "node:fs";
import path from "node:path";

const LEGACY_HOME_DIR_NAME = "opencode-gemini-bridge";
const NEW_HOME_DIR_NAME = "agentx";
const MARKER_FILENAME = ".migrated-from-ogb";

const LEGACY_PROJECT_FILES = ["ogb.config.jsonc", "ogb-trust.jsonc"] as const;
const NEW_PROJECT_FILES = ["agentx.config.jsonc", "agentx-trust.jsonc"] as const;
const LEGACY_GENERATED_PREFIX = "ogb-";
const NEW_GENERATED_PREFIX = "agentx-";

export interface MigrateFromOgbInput {
  projectRoot: string;
  homeDir: string;
}

export type MigrationStatus = "already-done" | "no-legacy-state" | "migrated";

export interface RenamedEntry {
  from: string;
  to: string;
}

export interface MigrationReport {
  status: MigrationStatus;
  movedHomeDir?: RenamedEntry;
  renamedFiles: RenamedEntry[];
  warnings: string[];
  durationMs: number;
}

interface LegacyPaths {
  homeRoot: string;
  projectConfig: readonly string[];
  projectGenerated: string;
}

interface NewPaths {
  homeRoot: string;
  homeGenerated: string;
  projectConfig: readonly string[];
}

function legacyPaths(input: MigrateFromOgbInput): LegacyPaths {
  const homeRoot = path.join(input.homeDir, ".config", LEGACY_HOME_DIR_NAME);
  return {
    homeRoot,
    projectConfig: LEGACY_PROJECT_FILES.map((f) => path.join(input.projectRoot, ".opencode", f)),
    projectGenerated: path.join(input.projectRoot, ".opencode", "generated"),
  };
}

function newPaths(input: MigrateFromOgbInput): NewPaths {
  const homeRoot = path.join(input.homeDir, ".config", NEW_HOME_DIR_NAME);
  return {
    homeRoot,
    homeGenerated: path.join(homeRoot, "generated"),
    projectConfig: NEW_PROJECT_FILES.map((f) => path.join(input.projectRoot, ".opencode", f)),
  };
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function hasLegacyPrefixedEntry(dir: string): boolean {
  if (!isDir(dir)) return false;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(LEGACY_GENERATED_PREFIX)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function detectLegacyArtifacts(legacy: LegacyPaths): boolean {
  if (isDir(legacy.homeRoot)) return true;
  for (const file of legacy.projectConfig) {
    if (fs.existsSync(file)) return true;
  }
  return hasLegacyPrefixedEntry(legacy.projectGenerated);
}

function moveOrCopy(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

function renameLegacyPrefixedFiles(dir: string, renamed: RenamedEntry[], warnings: string[]): void {
  if (!isDir(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(LEGACY_GENERATED_PREFIX)) continue;
    const target = `${NEW_GENERATED_PREFIX}${name.slice(LEGACY_GENERATED_PREFIX.length)}`;
    const fromPath = path.join(dir, name);
    const toPath = path.join(dir, target);
    if (fs.existsSync(toPath)) {
      warnings.push(`skipped ${fromPath} (target ${toPath} already exists)`);
      continue;
    }
    fs.renameSync(fromPath, toPath);
    renamed.push({ from: fromPath, to: toPath });
  }
}

function mergeLegacyHomeIntoNew(legacyHome: string, newHome: string, renamed: RenamedEntry[], warnings: string[]): void {
  for (const name of fs.readdirSync(legacyHome)) {
    const fromPath = path.join(legacyHome, name);
    const toPath = path.join(newHome, name);
    if (fs.existsSync(toPath)) {
      warnings.push(`skipped ${fromPath} (target ${toPath} already exists)`);
      continue;
    }
    moveOrCopy(fromPath, toPath);
    renamed.push({ from: fromPath, to: toPath });
  }
  try {
    fs.rmdirSync(legacyHome);
  } catch {
    // Leave it if non-empty due to skipped collisions.
  }
}

export function migrateFromOgb(input: MigrateFromOgbInput): MigrationReport {
  const started = Date.now();
  const legacy = legacyPaths(input);
  const next = newPaths(input);
  const marker = path.join(next.homeRoot, MARKER_FILENAME);

  if (fs.existsSync(marker)) {
    return {
      status: "already-done",
      renamedFiles: [],
      warnings: [],
      durationMs: Date.now() - started,
    };
  }

  if (!detectLegacyArtifacts(legacy)) {
    return {
      status: "no-legacy-state",
      renamedFiles: [],
      warnings: [],
      durationMs: Date.now() - started,
    };
  }

  const renamedFiles: RenamedEntry[] = [];
  const warnings: string[] = [];
  let movedHomeDir: RenamedEntry | undefined;

  if (isDir(legacy.homeRoot)) {
    if (!fs.existsSync(next.homeRoot)) {
      fs.mkdirSync(path.dirname(next.homeRoot), { recursive: true });
      moveOrCopy(legacy.homeRoot, next.homeRoot);
      movedHomeDir = { from: legacy.homeRoot, to: next.homeRoot };
    } else {
      mergeLegacyHomeIntoNew(legacy.homeRoot, next.homeRoot, renamedFiles, warnings);
    }
  }

  renameLegacyPrefixedFiles(next.homeGenerated, renamedFiles, warnings);

  for (let i = 0; i < LEGACY_PROJECT_FILES.length; i++) {
    const from = legacy.projectConfig[i];
    const to = next.projectConfig[i];
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) {
      warnings.push(`skipped ${from} (target ${to} already exists)`);
      continue;
    }
    fs.renameSync(from, to);
    renamedFiles.push({ from, to });
  }

  renameLegacyPrefixedFiles(legacy.projectGenerated, renamedFiles, warnings);

  fs.mkdirSync(next.homeRoot, { recursive: true });
  fs.writeFileSync(marker, `migrated ${new Date().toISOString()}\n`, "utf8");

  return {
    status: "migrated",
    movedHomeDir,
    renamedFiles,
    warnings,
    durationMs: Date.now() - started,
  };
}
