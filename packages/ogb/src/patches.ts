import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createBackupSession, type BackupRecord, type BackupSession } from "./backup-policy.js";
import { mcpEnvStorePath } from "./mcp-env-store.js";
import { runNativeCommand, type NativeCommandResult, type NativeCommandSpec } from "./native-runner.js";
import { resolveProjectPaths, type ProjectPaths } from "./paths.js";
import { createPlatformAdapter, type PlatformAdapter, type SupportedInstallerPlatform } from "./platform-adapter.js";
import {
  CHECK_PROGRESS_STEPS,
  emitRitualProgress,
  type RitualProgressDefinition,
  type RitualProgressSink,
  type RitualProgressStatus,
} from "./ritual-progress.js";
import { readStateRecord, stateRecordPath, writeStateRecord } from "./state-store.js";
import { OGB_VERSION } from "./types.js";

export const PATCH_STATE_SCHEMA = "opencode-gemini-bridge.patches.v1";

export type PatchPhase =
  | "pre-install"
  | "post-install"
  | "pre-extension-update"
  | "before-gemini-extension-update"
  | "post-extension-update"
  | "pre-sync"
  | "post-sync"
  | "pre-doctor"
  | "post-check"
  | "post-update";

export type PatchRunStatus = "applied" | "preview" | "skipped" | "warning" | "failed";
export type PatchPlatform = SupportedInstallerPlatform | "all";
export type PatchCategory = "cleanup" | "compatibility" | "guardrail" | "migration" | "security";
export type PatchLifecycleStatus = "active" | "retirement-due" | "superseded";

export const PATCH_LIFECYCLE_SCHEMA = "opencode-gemini-bridge.patch-lifecycle.v1";

export interface PatchStateEntry {
  id: string;
  phase: PatchPhase;
  category?: PatchCategory;
  reason?: string;
  introducedIn: string;
  retireAfter?: string;
  removalCondition?: string;
  supersededBy?: string;
  appliedAt: string;
  status: "applied";
  message: string;
  writes: string[];
  backups: BackupRecord[];
}

export interface PatchStateRun {
  phase: PatchPhase;
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  outcome: "pass" | "warn" | "fail" | "skipped";
  applied: number;
  warnings: number;
  errors: number;
}

export interface PatchState {
  schema: typeof PATCH_STATE_SCHEMA;
  version: string;
  updatedAt: string;
  applied: Record<string, PatchStateEntry>;
  runs: PatchStateRun[];
}

export interface PatchContext {
  phase: PatchPhase;
  projectRoot: string;
  homeDir: string;
  homeMode: boolean;
  paths: ProjectPaths;
  adapter: PlatformAdapter;
  platform: SupportedInstallerPlatform;
  dryRun: boolean;
  force: boolean;
  state: PatchState;
  backupSession: BackupSession;
  now: Date;
  runCommand(spec: NativeCommandSpec): NativeCommandResult;
  extension?: GeminiExtensionPatchTarget;
}

export interface GeminiExtensionPatchTarget {
  name: string;
  extensionPath: string;
  manifestPath?: string;
  currentVersion?: string;
  targetVersion?: string;
  currentRef?: string;
  targetRef?: string;
  source?: string;
}

export interface PatchResult {
  status: PatchRunStatus;
  message: string;
  writes?: string[];
  backups?: BackupRecord[];
  stdoutTail?: string;
  stderrTail?: string;
  exitCode?: number | null;
  signal?: string | null;
  nextAction?: string;
}

export interface OgbPatch {
  id: string;
  title: string;
  description: string;
  category: PatchCategory;
  reason: string;
  introducedIn: string;
  retireAfter?: string;
  removalCondition?: string;
  supersededBy?: string;
  phase: PatchPhase;
  platforms?: PatchPlatform[];
  runOnce?: boolean;
  destructive?: boolean;
  needsBackup?: boolean;
  required?: boolean;
  timeoutMs?: number;
  applies(context: PatchContext): boolean;
  run(context: PatchContext): PatchResult;
}

export interface PatchRunResult extends PatchResult {
  id: string;
  stateKey: string;
  title: string;
  description: string;
  category: PatchCategory;
  reason: string;
  phase: PatchPhase;
  introducedIn: string;
  retireAfter?: string;
  removalCondition?: string;
  supersededBy?: string;
  required: boolean;
  runOnce: boolean;
  destructive: boolean;
  needsBackup: boolean;
  extension?: GeminiExtensionPatchTarget;
}

export interface PatchRunReport {
  schema: typeof PATCH_STATE_SCHEMA;
  version: string;
  projectRoot: string;
  homeDir: string;
  homeMode: boolean;
  phase: PatchPhase;
  dryRun: boolean;
  generatedAt: string;
  outcome: "pass" | "warn" | "fail" | "skipped";
  statePath: string;
  registered: number;
  applicable: number;
  results: PatchRunResult[];
  warnings: string[];
  errors: string[];
}

export interface RunPatchesOptions {
  phase: PatchPhase;
  projectRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
  registry?: readonly OgbPatch[];
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  extension?: GeminiExtensionPatchTarget;
  now?: Date;
  onProgress?: RitualProgressSink;
}

export interface NativeScriptPatchOptions extends Omit<OgbPatch, "run"> {
  command(context: PatchContext): NativeCommandSpec;
  successMessage?: string;
  failureMessage?: string;
}

export interface PatchLifecycleItem {
  id: string;
  title: string;
  description: string;
  category: PatchCategory;
  reason: string;
  phase: PatchPhase;
  platforms: PatchPlatform[];
  introducedIn: string;
  retireAfter?: string;
  removalCondition?: string;
  supersededBy?: string;
  lifecycleStatus: PatchLifecycleStatus;
  required: boolean;
  runOnce: boolean;
  destructive: boolean;
  needsBackup: boolean;
  applied: PatchStateEntry[];
  lastAppliedAt?: string;
  policyWarnings: string[];
}

export interface PatchLifecycleReport {
  schema: typeof PATCH_LIFECYCLE_SCHEMA;
  version: string;
  generatedAt: string;
  projectRoot: string;
  homeDir: string;
  homeMode: boolean;
  statePath: string;
  outcome: "pass" | "warn";
  registered: number;
  active: number;
  retirementDue: number;
  superseded: number;
  warnings: string[];
  patches: PatchLifecycleItem[];
}

export interface InspectPatchesOptions {
  projectRoot?: string;
  homeDir?: string;
  registry?: readonly OgbPatch[];
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

const PATCH_PROGRESS_BY_PHASE: Record<PatchPhase, RitualProgressDefinition | undefined> = {
  "pre-install": undefined,
  "post-install": undefined,
  "pre-extension-update": CHECK_PROGRESS_STEPS.patchPreExtensionUpdate,
  "before-gemini-extension-update": CHECK_PROGRESS_STEPS.patchPreExtensionUpdate,
  "post-extension-update": CHECK_PROGRESS_STEPS.patchPostExtensionUpdate,
  "pre-sync": CHECK_PROGRESS_STEPS.patchPreSync,
  "post-sync": CHECK_PROGRESS_STEPS.patchPostSync,
  "pre-doctor": CHECK_PROGRESS_STEPS.patchPreDoctor,
  "post-check": CHECK_PROGRESS_STEPS.patchPostCheck,
  "post-update": undefined,
};

function emptyPatchState(now = new Date()): PatchState {
  return {
    schema: PATCH_STATE_SCHEMA,
    version: OGB_VERSION,
    updatedAt: now.toISOString(),
    applied: {},
    runs: [],
  };
}

function textTail(value: string | undefined, maxChars = 1200): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function currentPlatform(options: Pick<RunPatchesOptions, "platform" | "env">, homeDir: string): PlatformAdapter {
  return createPlatformAdapter({ homeDir, platform: options.platform ?? process.platform, env: options.env });
}

function patchSupportsPlatform(patch: OgbPatch, platform: SupportedInstallerPlatform): boolean {
  return !patch.platforms || patch.platforms.includes("all") || patch.platforms.includes(platform);
}

function readPatchState(options: Pick<RunPatchesOptions, "projectRoot" | "homeDir">, now = new Date()): PatchState {
  const record = readStateRecord<Record<string, unknown>>("patches", options);
  const data = record.data;
  if (
    data?.schema === PATCH_STATE_SCHEMA
    && typeof data.version === "string"
    && typeof data.updatedAt === "string"
    && data.applied
    && typeof data.applied === "object"
    && !Array.isArray(data.applied)
  ) {
    return {
      schema: PATCH_STATE_SCHEMA,
      version: data.version,
      updatedAt: data.updatedAt,
      applied: data.applied as Record<string, PatchStateEntry>,
      runs: Array.isArray(data.runs) ? data.runs as PatchStateRun[] : [],
    };
  }
  return emptyPatchState(now);
}

function patchStateKey(patch: OgbPatch, context: PatchContext): string {
  return context.extension ? `${patch.id}::${context.extension.name}` : patch.id;
}

function parseVersionParts(value: string | undefined): number[] | undefined {
  const normalized = value?.trim().replace(/^v/i, "");
  if (!normalized) return undefined;
  const parts = normalized.split(".").map((part) => {
    const match = /^(\d+)/.exec(part);
    return match ? Number.parseInt(match[1], 10) : Number.NaN;
  });
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareVersions(a: string | undefined, b: string | undefined): number {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  if (!left || !right) return 0;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function patchLifecycleStatus(patch: OgbPatch, currentVersion = OGB_VERSION): PatchLifecycleStatus {
  if (patch.supersededBy) return "superseded";
  if (patch.retireAfter && compareVersions(currentVersion, patch.retireAfter) >= 0) return "retirement-due";
  return "active";
}

function duplicatePatchIds(registry: readonly OgbPatch[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const patch of registry) {
    if (seen.has(patch.id)) duplicates.add(patch.id);
    seen.add(patch.id);
  }
  return duplicates;
}

function patchPolicyWarnings(patch: OgbPatch, duplicates: Set<string>, currentVersion = OGB_VERSION): string[] {
  const warnings: string[] = [];
  if (duplicates.has(patch.id)) warnings.push("Patch id is duplicated in the registry.");
  if ((patch.category === "cleanup" || patch.category === "migration") && !patch.retireAfter) {
    warnings.push("Cleanup and migration patches must declare retireAfter.");
  }
  if ((patch.category === "cleanup" || patch.category === "migration") && !patch.removalCondition) {
    warnings.push("Cleanup and migration patches must declare removalCondition.");
  }
  if (patch.retireAfter && patchLifecycleStatus(patch, currentVersion) === "retirement-due") {
    warnings.push(`Patch is due for retirement since ${patch.retireAfter}.`);
  }
  if (patch.supersededBy) warnings.push(`Patch is superseded by ${patch.supersededBy}.`);
  if (patch.destructive && !patch.needsBackup) warnings.push("Destructive patches must opt into central backups.");
  return warnings;
}

function writePatchState(state: PatchState, options: RunPatchesOptions): void {
  writeStateRecord("patches", state as unknown as Record<string, unknown>, options);
}

function emitPatchProgress(
  sink: RitualProgressSink | undefined,
  phase: PatchPhase,
  status: RitualProgressStatus,
  message?: string,
): void {
  const definition = PATCH_PROGRESS_BY_PHASE[phase];
  if (!definition) return;
  emitRitualProgress(sink, { ...definition, status, message });
}

function outcomeForResults(results: readonly PatchRunResult[]): PatchRunReport["outcome"] {
  if (results.some((result) => result.status === "failed" && result.required)) return "fail";
  if (results.some((result) => result.status === "failed" || result.status === "warning")) return "warn";
  if (results.length === 0 || results.every((result) => result.status === "skipped")) return "skipped";
  return "pass";
}

function progressStatusForReport(report: PatchRunReport): RitualProgressStatus {
  if (report.outcome === "fail") return "fail";
  if (report.outcome === "warn") return "warn";
  if (report.outcome === "skipped") return "skipped";
  return "pass";
}

function shouldShowPatchProgress(results: readonly PatchRunResult[]): boolean {
  return results.some((result) => result.status !== "skipped");
}

export function patchPhaseStepId(phase: PatchPhase): string | undefined {
  return PATCH_PROGRESS_BY_PHASE[phase]?.stepId;
}

export function summarizePatchReport(report: Pick<PatchRunReport, "results" | "registered" | "outcome">): string {
  if (report.registered === 0) return "No patches are registered for this phase.";
  if (report.results.length === 0) return "No patches apply in this environment.";
  const applied = report.results.filter((result) => result.status === "applied").length;
  const preview = report.results.filter((result) => result.status === "preview").length;
  const skipped = report.results.filter((result) => result.status === "skipped").length;
  const warnings = report.results.filter((result) => result.status === "warning" || (result.status === "failed" && !result.required)).length;
  const errors = report.results.filter((result) => result.status === "failed" && result.required).length;
  const parts = [
    applied > 0 ? `${applied} applied` : undefined,
    preview > 0 ? `${preview} previewed` : undefined,
    skipped > 0 ? `${skipped} skipped` : undefined,
    warnings > 0 ? `${warnings} warning(s)` : undefined,
    errors > 0 ? `${errors} error(s)` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : `Patch phase ${report.outcome}.`;
}

function resultFromPatchError(patch: OgbPatch, error: unknown, context?: PatchContext): PatchRunResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: patch.id,
    stateKey: context ? patchStateKey(patch, context) : patch.id,
    title: patch.title,
    description: patch.description,
    category: patch.category,
    reason: patch.reason,
    phase: patch.phase,
    introducedIn: patch.introducedIn,
    retireAfter: patch.retireAfter,
    removalCondition: patch.removalCondition,
    supersededBy: patch.supersededBy,
    required: Boolean(patch.required),
    runOnce: Boolean(patch.runOnce),
    destructive: Boolean(patch.destructive),
    needsBackup: Boolean(patch.needsBackup),
    extension: context?.extension,
    status: "failed",
    message,
    nextAction: `Revise o patch ${patch.id}; rode ogb check --plain para ver o diagnostico completo.`,
  };
}

function normalizePatchResult(patch: OgbPatch, result: PatchResult, context?: PatchContext): PatchRunResult {
  return {
    id: patch.id,
    stateKey: context ? patchStateKey(patch, context) : patch.id,
    title: patch.title,
    description: patch.description,
    category: patch.category,
    reason: patch.reason,
    phase: patch.phase,
    introducedIn: patch.introducedIn,
    retireAfter: patch.retireAfter,
    removalCondition: patch.removalCondition,
    supersededBy: patch.supersededBy,
    required: Boolean(patch.required),
    runOnce: Boolean(patch.runOnce),
    destructive: Boolean(patch.destructive),
    needsBackup: Boolean(patch.needsBackup),
    extension: context?.extension,
    ...result,
    writes: [...(result.writes ?? [])],
    backups: [...(result.backups ?? [])],
  };
}

function updateStateAfterRun(state: PatchState, report: PatchRunReport, now: Date): PatchState {
  const next: PatchState = {
    ...state,
    version: OGB_VERSION,
    updatedAt: now.toISOString(),
    applied: { ...state.applied },
    runs: [...state.runs],
  };

  for (const result of report.results) {
    if (result.status !== "applied") continue;
    next.applied[result.stateKey] = {
      id: result.id,
      phase: result.phase,
      category: result.category,
      reason: result.reason,
      introducedIn: result.introducedIn,
      retireAfter: result.retireAfter,
      removalCondition: result.removalCondition,
      supersededBy: result.supersededBy,
      appliedAt: now.toISOString(),
      status: "applied",
      message: result.message,
      writes: [...(result.writes ?? [])],
      backups: [...(result.backups ?? [])],
    };
  }

  next.runs.unshift({
    phase: report.phase,
    startedAt: report.generatedAt,
    finishedAt: now.toISOString(),
    dryRun: report.dryRun,
    outcome: report.outcome,
    applied: report.results.filter((result) => result.status === "applied").length,
    warnings: report.warnings.length,
    errors: report.errors.length,
  });
  next.runs = next.runs.slice(0, 50);
  return next;
}

export function resultFromNativeCommand(
  command: NativeCommandResult,
  options: { successMessage?: string; failureMessage?: string } = {},
): PatchResult {
  const stdoutTail = textTail(command.stdout);
  const stderrTail = textTail(command.stderr);
  if (command.ok) {
    return {
      status: "applied",
      message: options.successMessage ?? stdoutTail ?? "Command completed.",
      stdoutTail,
      stderrTail,
      exitCode: command.status,
      signal: command.signal,
    };
  }
  const detail = stderrTail ?? stdoutTail ?? command.error ?? `exit code ${String(command.status ?? "unknown")}`;
  return {
    status: "failed",
    message: `${options.failureMessage ?? "Command failed"}: ${detail}`,
    stdoutTail,
    stderrTail,
    exitCode: command.status,
    signal: command.signal,
  };
}

export function defineNativeScriptPatch(options: NativeScriptPatchOptions): OgbPatch {
  return {
    ...options,
    run(context) {
      const result = context.runCommand(options.command(context));
      return resultFromNativeCommand(result, {
        successMessage: options.successMessage,
        failureMessage: options.failureMessage,
      });
    },
  };
}

function appliedEntriesForPatch(state: PatchState, patch: OgbPatch): PatchStateEntry[] {
  return Object.entries(state.applied)
    .filter(([stateKey, entry]) => stateKey === patch.id || stateKey.startsWith(`${patch.id}::`) || entry.id === patch.id)
    .map(([, entry]) => entry)
    .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)));
}

export function inspectPatches(options: InspectPatchesOptions = {}): PatchLifecycleReport {
  const now = options.now ?? new Date();
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const adapter = currentPlatform(options, paths.homeDir);
  const registry = options.registry ?? OGB_PATCHES;
  const state = readPatchState({ projectRoot: paths.projectRoot, homeDir: paths.homeDir }, now);
  const duplicates = duplicatePatchIds(registry);

  const patches = registry.map((patch): PatchLifecycleItem => {
    const applied = appliedEntriesForPatch(state, patch);
    return {
      id: patch.id,
      title: patch.title,
      description: patch.description,
      category: patch.category,
      reason: patch.reason,
      phase: patch.phase,
      platforms: patch.platforms ?? ["all"],
      introducedIn: patch.introducedIn,
      retireAfter: patch.retireAfter,
      removalCondition: patch.removalCondition,
      supersededBy: patch.supersededBy,
      lifecycleStatus: patchLifecycleStatus(patch),
      required: Boolean(patch.required),
      runOnce: Boolean(patch.runOnce),
      destructive: Boolean(patch.destructive),
      needsBackup: Boolean(patch.needsBackup),
      applied,
      lastAppliedAt: applied[0]?.appliedAt,
      policyWarnings: patchPolicyWarnings(patch, duplicates),
    };
  }).sort((a, b) => a.phase.localeCompare(b.phase) || a.id.localeCompare(b.id));

  const supported = patches.filter((patch) => patch.platforms.includes("all") || patch.platforms.includes(adapter.platform));
  const warnings = supported.flatMap((patch) => patch.policyWarnings.map((warning) => `${patch.id}: ${warning}`));
  return {
    schema: PATCH_LIFECYCLE_SCHEMA,
    version: OGB_VERSION,
    generatedAt: now.toISOString(),
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    homeMode: paths.homeMode,
    statePath: stateRecordPath("patches", { projectRoot: paths.projectRoot, homeDir: paths.homeDir }),
    outcome: warnings.length > 0 ? "warn" : "pass",
    registered: supported.length,
    active: supported.filter((patch) => patch.lifecycleStatus === "active").length,
    retirementDue: supported.filter((patch) => patch.lifecycleStatus === "retirement-due").length,
    superseded: supported.filter((patch) => patch.lifecycleStatus === "superseded").length,
    warnings,
    patches: supported,
  };
}

function lifecycleBadge(status: PatchLifecycleStatus): string {
  if (status === "retirement-due") return "RETIRE";
  if (status === "superseded") return "SUPERSEDED";
  return "ACTIVE";
}

export function formatPatchLifecycleReport(report: PatchLifecycleReport): string {
  const lines = [
    "OGB patches",
    `Project: ${report.projectRoot}`,
    `Outcome: ${report.outcome.toUpperCase()}`,
    "",
    `Registry: ${report.registered} patch(es), ${report.active} active, ${report.retirementDue} due for retirement, ${report.superseded} superseded`,
    `State: ${report.statePath}`,
  ];

  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  lines.push("", "Patches:");
  for (const patch of report.patches) {
    lines.push(`- [${lifecycleBadge(patch.lifecycleStatus)}] ${patch.id}`);
    lines.push(`  ${patch.title}`);
    lines.push(`  phase=${patch.phase} category=${patch.category} introduced=${patch.introducedIn}`);
    lines.push(`  reason: ${patch.reason}`);
    if (patch.retireAfter) lines.push(`  retire after: ${patch.retireAfter}`);
    if (patch.removalCondition) lines.push(`  removal: ${patch.removalCondition}`);
    if (patch.supersededBy) lines.push(`  superseded by: ${patch.supersededBy}`);
    if (patch.lastAppliedAt) lines.push(`  last applied: ${patch.lastAppliedAt}`);
    if (patch.policyWarnings.length > 0) {
      for (const warning of patch.policyWarnings) lines.push(`  warning: ${warning}`);
    }
  }

  if (report.patches.length === 0) lines.push("- no patches registered for this platform");
  lines.push("", "Rule: patches repair legacy state or guard risky transitions; normal features belong in the core flow.");
  return `${lines.join("\n")}\n`;
}

export function runPatchesForPhase(options: RunPatchesOptions): PatchRunReport {
  const now = options.now ?? new Date();
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const adapter = currentPlatform(options, paths.homeDir);
  const state = readPatchState({ ...options, projectRoot: paths.projectRoot, homeDir: paths.homeDir }, now);
  const registry = options.registry ?? OGB_PATCHES;
  const phasePatches = registry
    .filter((patch) => patch.phase === options.phase)
    .filter((patch) => patchSupportsPlatform(patch, adapter.platform));
  const backupSession = createBackupSession({
    bridgeConfigDir: paths.bridgeConfigDir,
    operation: `patch-${options.phase}`,
    dryRun: options.dryRun,
    now,
    roots: [
      { root: paths.homeDir, prefix: "home" },
      { root: paths.projectRoot, prefix: "project" },
    ],
  });
  const context: PatchContext = {
    phase: options.phase,
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    homeMode: paths.homeMode,
    paths,
    adapter,
    platform: adapter.platform,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    state,
    backupSession,
    now,
    extension: options.extension,
    runCommand(spec) {
      return runNativeCommand({
        cwd: paths.projectRoot,
        platform: adapter.platform,
        timeoutMs: spec.timeoutMs,
        ...spec,
      });
    },
  };

  const results: PatchRunResult[] = [];
  const runnable: OgbPatch[] = [];

  for (const patch of phasePatches) {
    const stateKey = patchStateKey(patch, context);
    const previouslyApplied = state.applied[stateKey];
    if (patch.runOnce && previouslyApplied && !options.force) {
      results.push(normalizePatchResult(patch, {
        status: "skipped",
        message: `Already applied at ${previouslyApplied.appliedAt}.`,
      }, context));
      continue;
    }

    let applies = false;
    try {
      applies = patch.applies(context);
    } catch (error) {
      results.push(resultFromPatchError(patch, error, context));
      continue;
    }
    if (!applies) continue;
    runnable.push(patch);
  }

  for (const patch of runnable) {
    try {
      const result = patch.run(context);
      results.push(normalizePatchResult(patch, result, context));
    } catch (error) {
      results.push(resultFromPatchError(patch, error, context));
    }
  }

  const warnings = results
    .filter((result) => result.status === "warning" || (result.status === "failed" && !result.required))
    .map((result) => `${result.id}: ${result.message}`);
  const errors = results
    .filter((result) => result.status === "failed" && result.required)
    .map((result) => `${result.id}: ${result.message}`);
  const outcome = outcomeForResults(results);
  const report: PatchRunReport = {
    schema: PATCH_STATE_SCHEMA,
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    homeMode: paths.homeMode,
    phase: options.phase,
    dryRun: Boolean(options.dryRun),
    generatedAt: now.toISOString(),
    outcome,
    statePath: stateRecordPath("patches", { projectRoot: paths.projectRoot, homeDir: paths.homeDir }),
    registered: phasePatches.length,
    applicable: results.filter((result) => result.status !== "skipped").length,
    results,
    warnings,
    errors,
  };

  const finishedAt = options.now ?? new Date();
  if (!options.dryRun) {
    writePatchState(updateStateAfterRun(state, report, finishedAt), {
      ...options,
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      now: finishedAt,
    });
  }

  if (shouldShowPatchProgress(results)) {
    emitPatchProgress(options.onProgress, options.phase, progressStatusForReport(report), summarizePatchReport(report));
  }
  return report;
}

function legacyHomeStartupLockPath(context: PatchContext): string {
  return context.adapter.join(context.homeDir, ".opencode", "generated", "ogb-startup-sync.lock");
}

export function runBeforeGeminiExtensionUpdatePatches(
  options: Omit<RunPatchesOptions, "phase"> & { extension: GeminiExtensionPatchTarget },
): PatchRunReport {
  return runPatchesForPhase({ ...options, phase: "before-gemini-extension-update" });
}

function readJsonFile(filePath: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function safeSnapshotPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "snapshot";
}

function commandFailed(result: NativeCommandResult, allowedStatus: Array<number | null> = [0]): boolean {
  if (result.error) return true;
  return !allowedStatus.includes(result.status);
}

function gitCommand(): string {
  const configured = process.env.OGB_GIT_BIN?.trim();
  if (configured) return configured;
  if (process.platform !== "win32") {
    for (const candidate of ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "git";
}

const MEDNOTES_SNAPSHOT_ALLOWED_EXACT = new Set(["GEMINI.md"]);
const MEDNOTES_SNAPSHOT_ALLOWED_PREFIXES = [
  "commands/",
  "skills/",
  "agents/",
  "knowledge/",
  "hooks/",
  "scripts/",
  "src/",
  "docs/",
];
const MEDNOTES_SNAPSHOT_DENY_BASENAMES = new Set([".env", ".env.local", ".gemini-extension-install.json", "telemetry.defaults.json"]);
const MEDNOTES_SCRIPT_EXTENSIONS = new Set([".py", ".js", ".mjs", ".cjs", ".sh", ".ps1", ".cmd"]);
const MEDNOTES_MAX_GENERATED_SCRIPT_BYTES = 96 * 1024;
const MEDNOTES_INTEGRITY_MANIFEST = "extension-integrity-manifest.json";
const MEDNOTES_CAPTURE_SCRIPT_REL = "scripts/mednotes/capture_extension_diff.py";
const MEDNOTES_MAX_GIT_HISTORY_COMMITS = 600;

interface ManifestDrift {
  changed: string[];
  missing: string[];
  lineEndingOnly: string[];
  patches: string[];
  baselineRecoveredCount: number;
  gitDiffEmptyCount: number;
  unavailable: Array<{ path: string; reason: string }>;
}

function git(context: PatchContext, args: string[], timeoutMs = 60_000): NativeCommandResult {
  return context.runCommand({
    command: gitCommand(),
    args,
    cwd: context.extension?.extensionPath ?? context.projectRoot,
    stdio: "pipe",
    timeoutMs,
  });
}

function normalizeGitStatusPath(value: string): string {
  return value.trim().replace(/^"|"$/g, "").replaceAll("\\", "/");
}

function isMedNotesSnapshotPathAllowed(relPath: string): boolean {
  const normalized = normalizeGitStatusPath(relPath);
  if (!normalized || normalized.includes("..")) return false;
  const basename = path.posix.basename(normalized);
  if (MEDNOTES_SNAPSHOT_DENY_BASENAMES.has(basename) || basename.startsWith(".env")) return false;
  if (MEDNOTES_SNAPSHOT_ALLOWED_EXACT.has(normalized)) return true;
  return MEDNOTES_SNAPSHOT_ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function parseGitStatus(stdout: string): { changed: string[]; untracked: string[]; ignored: string[] } {
  const lines = stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const changed: string[] = [];
  const untracked: string[] = [];
  const ignored: string[] = [];
  for (const line of lines) {
    const relPath = normalizeGitStatusPath(line.slice(3).split(" -> ").pop() ?? "");
    if (!relPath) continue;
    const allowed = isMedNotesSnapshotPathAllowed(relPath);
    if (!allowed) {
      ignored.push(relPath);
      continue;
    }
    if (line.startsWith("?? ")) {
      untracked.push(relPath);
    } else {
      changed.push(relPath);
    }
  }
  return { changed, untracked, ignored };
}

function uniqueSnapshotDir(baseDir: string): string {
  if (!fs.existsSync(baseDir)) return baseDir;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${baseDir}.${index}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  return `${baseDir}.${Date.now()}`;
}

function writeUntrackedDiff(context: PatchContext, snapshotDir: string, untracked: string[]): string {
  const emptyPath = path.join(snapshotDir, "__empty__");
  fs.writeFileSync(emptyPath, "", "utf8");
  const chunks: string[] = [];
  const extensionPath = context.extension?.extensionPath ?? context.projectRoot;

  for (const relPath of untracked) {
    const fullPath = path.resolve(extensionPath, relPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    const result = context.runCommand({
      command: gitCommand(),
      args: ["diff", "--binary", "--no-index", "--", emptyPath, fullPath],
      cwd: extensionPath,
      stdio: "pipe",
      timeoutMs: 60_000,
    });
    if (commandFailed(result, [0, 1])) {
      throw new Error(result.stderr ?? result.error ?? `git diff --no-index failed for ${relPath}`);
    }
    const normalized = result.stdout
      .replaceAll(emptyPath, "/dev/null")
      .replaceAll(fullPath, relPath.split(path.sep).join("/"));
    if (normalized.trim()) chunks.push(normalized.trimEnd());
  }

  fs.rmSync(emptyPath, { force: true });
  return chunks.length > 0 ? `${chunks.join("\n")}\n` : "";
}

function medNotesPathspecs(): string[] {
  return [
    ...MEDNOTES_SNAPSHOT_ALLOWED_EXACT,
    ...MEDNOTES_SNAPSHOT_ALLOWED_PREFIXES.map((prefix) => prefix.replace(/\/$/, "")),
  ];
}

function languageForScript(relPath: string): string {
  switch (path.posix.extname(relPath).toLowerCase()) {
    case ".py":
      return "python";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".sh":
      return "shell";
    case ".ps1":
      return "powershell";
    case ".cmd":
      return "batch";
    default:
      return "text";
  }
}

function generatedScriptsFromDrift(extensionPath: string, paths: string[]): Array<Record<string, unknown>> {
  const scripts: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const relPath of paths) {
    const normalized = normalizeGitStatusPath(relPath);
    if (seen.has(normalized) || !MEDNOTES_SCRIPT_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) continue;
    seen.add(normalized);
    const fullPath = path.resolve(extensionPath, normalized);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    const size = fs.statSync(fullPath).size;
    if (size > MEDNOTES_MAX_GENERATED_SCRIPT_BYTES) {
      scripts.push({
        path: normalized,
        language: languageForScript(normalized),
        size_bytes: size,
        source: "ogb_update_patch",
        capture_method: "medical-notes-workbench-pre-update-snapshot",
        content_omitted_reason: "script_too_large",
      });
      continue;
    }
    const content = fs.readFileSync(fullPath, "utf8");
    scripts.push({
      path: normalized,
      language: languageForScript(normalized),
      size_bytes: Buffer.byteLength(content, "utf8"),
      source: "ogb_update_patch",
      capture_method: "medical-notes-workbench-pre-update-snapshot",
      content,
    });
  }
  return scripts;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeGitStatusPath(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function emptyManifestDrift(): ManifestDrift {
  return {
    changed: [],
    missing: [],
    lineEndingOnly: [],
    patches: [],
    baselineRecoveredCount: 0,
    gitDiffEmptyCount: 0,
    unavailable: [],
  };
}

function manifestFileEntries(manifest: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  const files = manifest?.files;
  return Array.isArray(files) ? files.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
}

function recoverManifestBaseline(context: PatchContext, extensionPath: string, relPath: string, expected: Record<string, unknown>): { content?: string; source?: string } {
  const expectedSha = typeof expected.sha256 === "string" ? expected.sha256 : "";
  const expectedNormalizedSha = typeof expected.normalized_sha256 === "string" ? expected.normalized_sha256 : "";
  const history = git(context, ["-C", extensionPath, "rev-list", "--all", "--", relPath], 60_000);
  if (commandFailed(history)) return {};
  const commits = history.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, MEDNOTES_MAX_GIT_HISTORY_COMMITS);
  for (const commit of commits) {
    const show = git(context, ["-C", extensionPath, "show", `${commit}:${relPath}`], 60_000);
    if (commandFailed(show)) continue;
    const content = show.stdout;
    if (expectedSha && sha256Text(content) === expectedSha) return { content, source: `git:${commit.slice(0, 12)}` };
    if (expectedNormalizedSha && sha256Text(normalizeLineEndings(content)) === expectedNormalizedSha) {
      return { content, source: `git:${commit.slice(0, 12)}:normalized` };
    }
  }
  return {};
}

function patchLines(value: string): string[] {
  const normalized = normalizeLineEndings(value);
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function wholeFilePatch(relPath: string, oldText: string, newText: string, baselineSource: string): string {
  const oldLines = patchLines(oldText);
  const newLines = patchLines(newText);
  const oldCount = Math.max(1, oldLines.length);
  const newCount = Math.max(1, newLines.length);
  const lines = [
    `diff --git a/${relPath} b/${relPath}`,
    `# baseline-source: ${baselineSource}`,
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ];
  return `${lines.join("\n")}\n`;
}

function inspectManifestDrift(context: PatchContext, extensionPath: string): ManifestDrift {
  const manifest = readJsonFile(path.join(extensionPath, MEDNOTES_INTEGRITY_MANIFEST));
  const entries = manifestFileEntries(manifest);
  if (entries.length === 0) return emptyManifestDrift();
  const drift = emptyManifestDrift();

  for (const entry of entries) {
    const relPath = normalizeGitStatusPath(String(entry.path ?? ""));
    if (!isMedNotesSnapshotPathAllowed(relPath)) continue;
    const fullPath = path.resolve(extensionPath, relPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      drift.missing.push(relPath);
      const recovered = recoverManifestBaseline(context, extensionPath, relPath, entry);
      if (recovered.content !== undefined) {
        drift.baselineRecoveredCount += 1;
        drift.gitDiffEmptyCount += 1;
        drift.patches.push(wholeFilePatch(relPath, recovered.content, "", recovered.source ?? "git"));
      } else {
        drift.unavailable.push({ path: relPath, reason: "manifest_baseline_not_found" });
      }
      continue;
    }

    const current = fs.readFileSync(fullPath, "utf8");
    const expectedSha = typeof entry.sha256 === "string" ? entry.sha256 : "";
    const expectedNormalizedSha = typeof entry.normalized_sha256 === "string" ? entry.normalized_sha256 : "";
    if (expectedSha && sha256Text(current) === expectedSha) continue;
    if (expectedNormalizedSha && sha256Text(normalizeLineEndings(current)) === expectedNormalizedSha) {
      drift.lineEndingOnly.push(relPath);
      continue;
    }

    drift.changed.push(relPath);
    const directDiff = git(context, ["-C", extensionPath, "diff", "--binary", "--", relPath], 60_000);
    if (!commandFailed(directDiff) && directDiff.stdout.trim()) continue;
    drift.gitDiffEmptyCount += 1;
    const recovered = recoverManifestBaseline(context, extensionPath, relPath, entry);
    if (recovered.content !== undefined) {
      drift.baselineRecoveredCount += 1;
      drift.patches.push(wholeFilePatch(relPath, recovered.content, current, recovered.source ?? "git"));
    } else {
      drift.unavailable.push({ path: relPath, reason: "git_diff_empty_and_manifest_baseline_not_found" });
    }
  }

  drift.changed = uniqueStrings(drift.changed);
  drift.missing = uniqueStrings(drift.missing);
  drift.lineEndingOnly = uniqueStrings(drift.lineEndingOnly);
  return drift;
}

function combineDiffs(...parts: string[]): string {
  const chunks = parts.map((part) => part.trim()).filter(Boolean);
  return chunks.length > 0 ? `${chunks.join("\n\n")}\n` : "";
}

function medicalNotesCaptureScriptPath(extensionPath: string): string | undefined {
  const scriptPath = path.join(extensionPath, ...MEDNOTES_CAPTURE_SCRIPT_REL.split("/"));
  return fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile() ? scriptPath : undefined;
}

function pythonCandidates(context: PatchContext): Array<{ command: string; argsPrefix: string[] }> {
  const envPython = context.adapter.env.OGB_PYTHON || context.adapter.env.PYTHON;
  const candidates: Array<{ command: string; argsPrefix: string[] }> = [];
  if (envPython) candidates.push({ command: envPython, argsPrefix: [] });
  if (context.platform === "win32") candidates.push({ command: "py", argsPrefix: ["-3"] });
  else {
    for (const command of ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"]) {
      if (fs.existsSync(command)) candidates.push({ command, argsPrefix: [] });
    }
  }
  candidates.push({ command: "python3", argsPrefix: [] }, { command: "python", argsPrefix: [] });
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.command}\0${candidate.argsPrefix.join("\0")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSnapshotWrites(snapshotDir: string): string[] {
  return [
    "snapshot.json",
    "tracked.diff",
    "staged.diff",
    "untracked.diff",
    "extension-full.diff",
    "telemetry-envelope.json",
    "capture-result.json",
    "capture.zip",
    "send-result.json",
    "diff-unavailable.json",
    "existing-pre-update-snapshots.json",
  ].map((filename) => path.join(snapshotDir, filename)).filter((filePath) => fs.existsSync(filePath));
}

function snapshotDirUseful(snapshotDir: string): boolean {
  for (const filename of ["tracked.diff", "staged.diff", "untracked.diff", "extension-full.diff"]) {
    const filePath = path.join(snapshotDir, filename);
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8").trim()) return true;
  }
  const snapshot = readJsonFile(path.join(snapshotDir, "snapshot.json"));
  const generatedScripts = snapshot?.generated_scripts;
  return Array.isArray(generatedScripts) && generatedScripts.length > 0;
}

function runMedicalNotesCaptureScript(context: PatchContext, scriptPath: string, snapshotDir: string): PatchResult | undefined {
  const extension = context.extension;
  if (!extension) return undefined;
  const errors: string[] = [];
  for (const candidate of pythonCandidates(context)) {
    const result = context.runCommand({
      command: candidate.command,
      args: [
        ...candidate.argsPrefix,
        scriptPath,
        "--extension-path",
        extension.extensionPath,
        "--output-dir",
        snapshotDir,
        "--no-flush",
        "--no-existing-snapshots",
      ],
      cwd: extension.extensionPath,
      stdio: "pipe",
      timeoutMs: 120_000,
    });
    if (commandFailed(result)) {
      errors.push(`${candidate.command}: ${result.stderr || result.error || `exit ${result.status}`}`);
      continue;
    }
    if (!snapshotDirUseful(snapshotDir)) {
      errors.push(`${candidate.command}: capture_extension_diff.py completed but did not write a useful snapshot`);
      continue;
    }
    return {
      status: "applied",
      message: `Snapshot saved via capture_extension_diff.py for ${extension.name}: ${snapshotDir}`,
      writes: collectSnapshotWrites(snapshotDir),
      stdoutTail: result.stdout.trim().slice(-2000),
      stderrTail: result.stderr.trim().slice(-2000),
      exitCode: result.status,
      signal: result.signal,
    };
  }
  if (errors.length > 0) {
    return {
      status: "warning",
      message: `capture_extension_diff.py could not run; falling back to native OGB snapshot. ${errors.slice(0, 2).join(" ")}`,
    };
  }
  return undefined;
}

function createMedicalNotesPreUpdateSnapshot(context: PatchContext): PatchResult {
  const extension = context.extension;
  if (!extension) return { status: "skipped", message: "No Gemini extension context was provided." };
  const extensionPath = extension.extensionPath;
  const insideWorkTree = git(context, ["-C", extensionPath, "rev-parse", "--is-inside-work-tree"]);
  if (commandFailed(insideWorkTree)) return { status: "skipped", message: `${extension.name} is not a git worktree.` };

  const status = git(context, ["-C", extensionPath, "status", "--porcelain=v1", "-uall"]);
  if (commandFailed(status)) {
    return {
      status: "failed",
      message: `Could not inspect local drift: ${status.stderr ?? status.error ?? "git status failed"}`,
      nextAction: "Revise a extensao manualmente; o update foi bloqueado para nao sobrescrever alteracoes locais sem snapshot.",
    };
  }
  const drift = parseGitStatus(status.stdout);
  const manifestDrift = inspectManifestDrift(context, extensionPath);
  const changedPaths = uniqueStrings([...drift.changed, ...manifestDrift.changed, ...manifestDrift.missing]);
  if (changedPaths.length === 0 && drift.untracked.length === 0) {
    const ignored = drift.ignored.length ? ` Ignored non-extension drift: ${drift.ignored.slice(0, 5).join(", ")}.` : "";
    return { status: "skipped", message: `${extension.name} has no allowlisted local drift.${ignored}` };
  }

  const head = git(context, ["-C", extensionPath, "rev-parse", "HEAD"]);
  const gitHead = commandFailed(head) ? "unknown" : head.stdout.trim();
  const snapshotId = safeSnapshotPart(`${context.now.toISOString()}-${gitHead.slice(0, 12)}`);
  const snapshotBase = context.adapter.join(
    context.homeDir,
    ".gemini",
    "medical-notes-workbench",
    "feedback",
    "pre-update-snapshots",
    snapshotId,
  );
  const snapshotDir = uniqueSnapshotDir(snapshotBase);
  const snapshotJsonPath = path.join(snapshotDir, "snapshot.json");
  const trackedDiffPath = path.join(snapshotDir, "tracked.diff");
  const stagedDiffPath = path.join(snapshotDir, "staged.diff");
  const untrackedDiffPath = path.join(snapshotDir, "untracked.diff");
  const extensionFullDiffPath = path.join(snapshotDir, "extension-full.diff");
  const writes = [snapshotJsonPath, trackedDiffPath, stagedDiffPath, untrackedDiffPath, extensionFullDiffPath];

  if (context.dryRun) {
    return {
      status: "preview",
      message: medicalNotesCaptureScriptPath(extensionPath)
        ? `Would run capture_extension_diff.py and snapshot ${extension.name} local drift before update.`
        : `Would snapshot ${extension.name} local drift before update.`,
      writes,
    };
  }

  try {
    fs.mkdirSync(snapshotDir, { recursive: true });
    const captureScript = medicalNotesCaptureScriptPath(extensionPath);
    if (captureScript) {
      const scriptResult = runMedicalNotesCaptureScript(context, captureScript, snapshotDir);
      if (scriptResult?.status === "applied") return scriptResult;
    }

    const pathspecs = medNotesPathspecs();
    const tracked = git(context, ["-C", extensionPath, "diff", "--binary", "--", ...pathspecs]);
    const staged = git(context, ["-C", extensionPath, "diff", "--cached", "--binary", "--", ...pathspecs]);
    if (commandFailed(tracked)) throw new Error(tracked.stderr ?? tracked.error ?? "git diff failed");
    if (commandFailed(staged)) throw new Error(staged.stderr ?? staged.error ?? "git diff --cached failed");
    const untrackedDiff = writeUntrackedDiff(context, snapshotDir, drift.untracked);
    const trackedWithManifest = combineDiffs(tracked.stdout, ...manifestDrift.patches);
    const extensionFullDiff = combineDiffs(trackedWithManifest, staged.stdout, untrackedDiff);
    const generatedScripts = generatedScriptsFromDrift(extensionPath, [...changedPaths, ...drift.untracked]);
    const snapshotUseful = Boolean(extensionFullDiff.trim() || generatedScripts.length > 0);
    if (!snapshotUseful) {
      throw new Error("allowlisted drift was detected, but no useful diff or script content was captured");
    }

    fs.writeFileSync(trackedDiffPath, trackedWithManifest, "utf8");
    fs.writeFileSync(stagedDiffPath, staged.stdout, "utf8");
    fs.writeFileSync(untrackedDiffPath, untrackedDiff, "utf8");
    fs.writeFileSync(extensionFullDiffPath, extensionFullDiff, "utf8");

    const manifest = extension.manifestPath ? readJsonFile(extension.manifestPath) : undefined;
    const snapshot = {
      schema: "medical-notes-workbench.pre-update-extension-snapshot.v1",
      snapshot_id: path.basename(snapshotDir),
      recorded_at: context.now.toISOString(),
      extension_name: extension.name,
      extension_path: extension.extensionPath,
      snapshot_path: snapshotDir,
      current_version: extension.currentVersion ?? (typeof manifest?.version === "string" ? manifest.version : undefined),
      target_version: extension.targetVersion,
      current_ref: extension.currentRef,
      target_ref: extension.targetRef,
      git_head: gitHead,
      changed_path_count: changedPaths.length,
      untracked_path_count: drift.untracked.length,
      ignored_path_count: drift.ignored.length,
      changed_paths: changedPaths,
      untracked_paths: drift.untracked,
      ignored_paths: drift.ignored,
      manifest_drift_path_count: manifestDrift.changed.length + manifestDrift.missing.length,
      manifest_drift_paths: uniqueStrings([...manifestDrift.changed, ...manifestDrift.missing]),
      line_ending_only_count: manifestDrift.lineEndingOnly.length,
      line_ending_only_paths: manifestDrift.lineEndingOnly,
      baseline_recovered_count: manifestDrift.baselineRecoveredCount,
      git_diff_empty_count: manifestDrift.gitDiffEmptyCount,
      diff_unavailable: manifestDrift.unavailable,
      snapshot_useful: snapshotUseful,
      generated_scripts: generatedScripts,
    };
    fs.writeFileSync(snapshotJsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

    return {
      status: "applied",
      message: `Snapshot saved for ${extension.name}: ${snapshotDir}`,
      writes,
    };
  } catch (error) {
    return {
      status: "failed",
      message: `Could not write pre-update snapshot for ${extension.name}: ${error instanceof Error ? error.message : String(error)}`,
      writes,
      nextAction: "Corrija a permissao/caminho do snapshot ou rode o update com confirmacao manual depois de salvar o drift.",
    };
  }
}

export const OGB_PATCHES: readonly OgbPatch[] = [
  {
    id: "medical-notes-workbench-pre-update-snapshot",
    title: "Snapshot Medical Notes Workbench drift before extension update",
    description: "Captures tracked, staged and untracked git diffs before Gemini CLI updates the medical-notes-workbench extension.",
    category: "guardrail",
    reason: "Protect user and agent edits inside the installed Medical Notes Workbench extension before Gemini CLI replaces extension files.",
    introducedIn: "0.1.8",
    removalCondition: "Remove only when Gemini CLI or the extension provides equivalent pre-update drift snapshotting.",
    phase: "before-gemini-extension-update",
    platforms: ["all"],
    runOnce: false,
    destructive: false,
    needsBackup: false,
    required: true,
    applies(context) {
      return context.extension?.name === "medical-notes-workbench"
        && fs.existsSync(context.extension.extensionPath);
    },
    run: createMedicalNotesPreUpdateSnapshot,
  },
  {
    id: "cleanup-legacy-home-startup-lock",
    title: "Remove legacy home startup lock",
    description: "Removes the old startup-sync lock that a previous Windows/home bug could leave under ~/.opencode/generated.",
    category: "cleanup",
    reason: "Repair legacy home/global startup lock state left by the Windows quoted-path and home-project bugs.",
    introducedIn: "0.1.8",
    retireAfter: "0.2.0",
    removalCondition: "Remove after two stable releases show no telemetry/status hits for the legacy ~/.opencode/generated lock.",
    phase: "pre-extension-update",
    platforms: ["all"],
    destructive: true,
    needsBackup: true,
    runOnce: false,
    required: false,
    applies(context) {
      return context.homeMode && fs.existsSync(legacyHomeStartupLockPath(context));
    },
    run(context) {
      const lockPath = legacyHomeStartupLockPath(context);
      const backup = context.backupSession.backupExisting(lockPath);
      if (!context.dryRun) fs.rmSync(lockPath, { force: true });
      return {
        status: context.dryRun ? "preview" : "applied",
        message: context.dryRun
          ? `Would remove legacy startup lock at ${lockPath}.`
          : `Removed legacy startup lock at ${lockPath}.`,
        writes: [lockPath],
        backups: backup ? [...context.backupSession.backups] : [],
      };
    },
  },
  {
    id: "ensure-mcp-env-store-private",
    title: "Harden MCP env store permissions",
    description: "Keeps the OGB MCP environment store private after sync writes sensitive local values.",
    category: "security",
    reason: "Ensure locally materialized MCP environment values stay private on POSIX systems after sync.",
    introducedIn: "0.1.8",
    removalCondition: "Keep while OGB can persist sensitive MCP env values locally.",
    phase: "post-sync",
    platforms: ["darwin", "linux"],
    runOnce: false,
    required: false,
    applies(context) {
      const storePath = mcpEnvStorePath({ homeDir: context.homeDir, platform: context.platform, env: context.adapter.env });
      if (!fs.existsSync(storePath)) return false;
      const stat = fs.statSync(storePath);
      return stat.isFile() && (stat.mode & 0o777) !== 0o600;
    },
    run(context) {
      const storePath = mcpEnvStorePath({ homeDir: context.homeDir, platform: context.platform, env: context.adapter.env });
      if (!context.dryRun) fs.chmodSync(storePath, 0o600);
      return {
        status: context.dryRun ? "preview" : "applied",
        message: context.dryRun
          ? `Would set private permissions on ${storePath}.`
          : `Set private permissions on ${storePath}.`,
        writes: [storePath],
      };
    },
  },
];
