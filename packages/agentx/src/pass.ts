import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { DISPLAY } from "./brand.js";
import { runDashboard, type DashboardReport } from "./dashboard.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { updateGeminiExtensions, type ExtensionCommandReport } from "./extensions.js";
import { buildInstallerPlan, type InstallerPlan } from "./installer-planner.js";
import { buildInventory } from "./inventory.js";
import {
  updateManagedAntigravityPlugins,
  type DetectAntigravityCli,
  type FetchManagedAntigravityPluginSource,
  type ManagedAntigravityPluginSpec,
  type ManagedAntigravityPluginUpdateReport,
} from "./managed-antigravity-plugins.js";
import { runPatchesForPhase, summarizePatchReport, type OgbPatch, type PatchPhase, type PatchRunReport } from "./patches.js";
import { globalOpenCodeConfigDir } from "./opencode-paths.js";
import { resolveProjectPaths } from "./paths.js";
import { runSecurityCheck, type SecurityReport } from "./security.js";
import { setupOpenCode, type SetupOpenCodeReport } from "./setup-opencode.js";
import { ensureGlobalStartupPlugin, setupUx, type SetupUxReport } from "./setup-ux.js";
import { syncToOpenCode, type SyncReport } from "./sync.js";
import { hookTrustHash, hookTrustKeys, readTrustFile, writeTrustFile } from "./trust.js";
import { ensureGlobalTuiSidebar } from "./tui-sidebar.js";
import { AGENTX_VERSION } from "./types.js";
import { runValidation, type ValidationReport } from "./validation.js";
import type { RulesyncMode } from "./rulesync.js";
import { CHECK_PROGRESS_STEPS, emitRitualProgress, progressStatusFromFindings, progressStatusFromOutcome, type RitualProgressSink } from "./ritual-progress.js";
import { writeStateRecord } from "./state-store.js";

export interface PassOptions {
  projectRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
  acceptHooks?: boolean;
  windows?: boolean;
  skipSetup?: boolean;
  skipSync?: boolean;
  skipExtensionUpdate?: boolean;
  skipAntigravityPluginUpdate?: boolean;
  skipPatches?: boolean;
  skipValidation?: boolean;
  skipSecurity?: boolean;
  skipDashboard?: boolean;
  silent?: boolean;
  setExitCode?: boolean;
  rulesyncMode?: RulesyncMode;
  patchRegistry?: readonly OgbPatch[];
  managedAntigravityPluginSpecs?: readonly ManagedAntigravityPluginSpec[];
  managedAntigravityAgyBin?: string;
  detectManagedAntigravityCli?: DetectAntigravityCli;
  fetchManagedAntigravityPluginSource?: FetchManagedAntigravityPluginSource;
  onProgress?: RitualProgressSink;
}

export interface PassBlocker {
  severity: "warn" | "fail";
  source: "doctor" | "validation" | "security" | "setup" | "extension-update" | "antigravity-plugin-update" | "sync" | "dashboard" | "patch";
  message: string;
  action: string;
}

export interface PassStep {
  name: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
}

export interface PassSyncSummary {
  generatedConfigPath: string;
  builtInAgents: number;
  extensionAgents: number;
  builtInCommands: number;
  extensionCommands: number;
  skills: number;
  tuiFiles: number;
  externalIntegrationFiles: number;
  rulesyncStatus: SyncReport["rulesync"]["status"];
  rulesyncPromoted: number;
  rulesyncDurationMs?: number;
  rulesyncFeatures?: NonNullable<SyncReport["rulesync"]["timing"]>["features"];
  notes: string[];
}

export interface PassPatchSummary {
  statePath: string;
  phases: Array<{
    phase: PatchPhase;
    outcome: PatchRunReport["outcome"];
    registered: number;
    applicable: number;
    applied: number;
    warnings: number;
    errors: number;
  }>;
}

export interface PassAntigravityPluginItem {
  displayName: string;
  pluginName: string;
  status: ManagedAntigravityPluginUpdateReport["plugins"][number]["status"];
  reason?: string;
  revision?: string;
  error?: string;
  source?: string;
  ref?: string;
  destinations?: ManagedAntigravityPluginUpdateReport["plugins"][number]["destinations"];
}

export interface PassAntigravityPluginSummary {
  outcome: ManagedAntigravityPluginUpdateReport["outcome"];
  active: number;
  installed: number;
  updated: number;
  current: number;
  skipped: number;
  errors: number;
  warnings: string[];
  plugins: PassAntigravityPluginItem[];
}

export interface PassReport {
  version: string;
  projectRoot: string;
  outcome: "pass" | "warn" | "fail";
  plan: InstallerPlan;
  automated: string[];
  steps: PassStep[];
  acceptedHooks: string[];
  blockers: PassBlocker[];
  sync?: PassSyncSummary;
  doctor: {
    warnings: number;
    errors: number;
  };
  validation?: {
    outcome: ValidationReport["outcome"];
  };
  security?: {
    outcome: SecurityReport["outcome"];
  };
  patches?: PassPatchSummary;
  antigravityPlugins?: PassAntigravityPluginSummary;
  dashboard?: {
    outcome: DashboardReport["outcome"];
  };
  timing?: {
    durationMs: number;
    steps: Array<{ name: string; durationMs: number }>;
  };
  files: {
    pass: string;
    doctor: string;
    dashboard: string;
  };
}

function actionForWarning(warning: string): string {
  if (/^Hook needs review:/.test(warning)) return "Known Gemini hooks sync automatically through the agentX OpenCode plugin; review only custom hook events that do not have a compatible OpenCode projection yet.";
  if (/Duplicate name/i.test(warning)) return "Run `agentx check --json` or open `.opencode/generated/agentx-inventory.json` to inspect duplicate paths; keep one copy.";
  if (/model fallback config exists but is disabled/i.test(warning)) return "Enable the generated fallback config or disable `externalPlugins.autoFallback` in `.opencode/agentx.config.jsonc`.";
  if (/model fallback.*plugin is not active/i.test(warning)) return "Run `agentx setup-ux`, then restart OpenCode so the managed fallback plugin is loaded.";
  if (/model fallback/i.test(warning)) return "Review `externalPlugins.autoFallback` in `.opencode/agentx.config.jsonc` and the global OpenCode fallback plugin.";
  if (/opencode-auto-fallback config exists but is disabled/i.test(warning)) return "Enable the generated fallback config or disable `externalPlugins.autoFallback` in `.opencode/agentx.config.jsonc`.";
  if (/opencode-auto-fallback.*plugin is not active/i.test(warning)) return "Run `agentx setup-ux`, then restart OpenCode so the managed fallback plugin is loaded.";
  if (/opencode-auto-fallback/i.test(warning)) return "Review `externalPlugins.autoFallback` in `.opencode/agentx.config.jsonc` and the global OpenCode fallback plugin.";
  if (/Run agentx sync/i.test(warning)) return "`agentx check` already tried `agentx sync`; if this persists, review managed-file conflicts and rerun with `--force` only if safe.";
  if (/Model resolution warning/i.test(warning)) return "Review the models in `.opencode/agentx.config.jsonc` and compare them with `opencode models`.";
  if (/MCP command warning/i.test(warning)) return "Install the MCP command or remove/disable that MCP in the source configuration.";
  return `Read the doctor warning; if this is a ${DISPLAY}-managed resource, rerun \`agentx check --force\` after reviewing it.`;
}

function compactLine(value: string | undefined, maxChars = 180): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}…` : text;
}

function firstValidationIssue(report: ValidationReport | undefined, status: ValidationReport["outcome"]): string | undefined {
  const check = report?.checks.find((item) => item.status === status)
    ?? (status === "fail" ? report?.checks.find((item) => item.status === "warn") : undefined);
  if (!check) return undefined;
  const name = compactLine(check.name, 80);
  const message = compactLine(check.message, 220);
  if (name && message) return `${name}: ${message}`;
  return name ?? message;
}

function firstSecurityIssue(report: SecurityReport | undefined, status: SecurityReport["outcome"]): string | undefined {
  const finding = report?.findings.find((item) => item.status === status)
    ?? (status === "fail" ? report?.findings.find((item) => item.status === "warn") : undefined);
  if (!finding) return undefined;
  const name = compactLine(finding.name, 80);
  const message = compactLine(finding.message, 220);
  const files = finding.files?.slice(0, 2).map((file) => compactLine(file, 120)).filter((file): file is string => Boolean(file));
  const suffix = files && files.length > 0 ? ` (${files.join(", ")})` : "";
  if (name && message) return `${name}: ${message}${suffix}`;
  return name ?? message;
}

function firstDashboardIssue(report: DashboardReport | undefined, severity: "fail" | "warn"): string | undefined {
  const items = severity === "fail" ? report?.errors : report?.warnings;
  return compactLine(items?.find((item) => item.trim().length > 0), 240);
}

function extensionUpdateMessage(report: ExtensionCommandReport): string {
  if (report.status === "preview") return "Would run Gemini extension update.";
  if (report.status === "blocked") return report.error ?? "Gemini extension update was blocked before overwriting local extension changes.";
  if (report.status === "applied" && report.repairedExtensions?.length) return `Repaired Gemini extension update for ${report.repairedExtensions.join(", ")}.`;
  if (report.status === "applied") return report.stdoutTail ?? "Gemini extensions are up to date.";
  const detail = report.stderrTail ?? report.stdoutTail ?? report.error ?? `exit code ${String(report.exitCode ?? "unknown")}`;
  return report.timedOut ? `Gemini extension update timed out: ${detail}` : `Gemini extension update failed: ${detail}`;
}

function extensionUpdateAction(): string {
  return "Run `agentx update-extensions --auto-consent` to see the Gemini CLI error, then run `agentx check` again.";
}

function antigravityPluginUpdateMessage(report: ManagedAntigravityPluginUpdateReport): string {
  const active = report.plugins.filter((plugin) => plugin.status !== "skipped");
  if (report.outcome === "preview") return active.length > 0 ? `Would update ${active.length} managed Antigravity plugin(s).` : "No managed Antigravity plugins are active.";
  if (report.warnings.length > 0) return report.warnings[0] ?? "Managed Antigravity plugin update warning.";
  if (active.length === 0) return "No managed Antigravity plugins are active.";
  const installed = active.filter((plugin) => plugin.status === "installed").length;
  const updated = active.filter((plugin) => plugin.status === "updated").length;
  const current = active.filter((plugin) => plugin.status === "current").length;
  const parts = [
    installed > 0 ? `${installed} installed` : undefined,
    updated > 0 ? `${updated} updated` : undefined,
    current > 0 ? `${current} current` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? `Managed Antigravity plugins: ${parts.join(", ")}.` : "Managed Antigravity plugins checked.";
}

function antigravityPluginUpdateAction(): string {
  return "Run `agentx check --plain` to see the managed Antigravity plugin update error, then rerun after fixing Git/network access or the configured plugin branch.";
}

function validationAction(options: PassOptions): string {
  const command = options.windows ? "agentx validate --windows --plain" : "agentx validate --plain";
  return `Run \`${command}\` to see detailed checks and confirm whether the issue is a managed file, PATH/native command, or OpenCode config.`;
}

function securityAction(): string {
  return "Run `agentx security-check --plain`, review the highlighted finding, and fix it before trusting the generated profile.";
}

function dashboardAction(): string {
  return "Run `agentx dashboard --plain` and open the dashboard Markdown file to inspect the persisted state.";
}

function needsGlobalTuiRepair(warnings: readonly string[]): boolean {
  return warnings.some((warning) => /Global (?:OGB|agentX) TUI sidebar plugin is (missing|stale)/i.test(warning));
}

function needsGlobalStartupRepair(warnings: readonly string[]): boolean {
  return warnings.some((warning) => /Global (?:OGB|agentX) startup plugin is (missing|stale)/i.test(warning));
}

function checkSetupWarnings(report: SetupOpenCodeReport | SetupUxReport): string[] {
  return report.warnings.filter((warning) =>
    !/^OpenCode is not installed\. Re-run with --install-opencode or install OpenCode first\.$/.test(warning)
  );
}

function patchAction(result: { nextAction?: string; id: string }): string {
  return result.nextAction ?? `Run \`agentx check --plain\` for details about patch ${result.id}; if the patch touches a managed file, rerun with \`--force\` only after reviewing it.`;
}

function blocker(source: PassBlocker["source"], severity: PassBlocker["severity"], message: string, action: string): PassBlocker {
  return { source, severity, message, action };
}

function acceptCurrentHooks(projectRoot: string, homeDir: string, dryRun?: boolean): string[] {
  const paths = resolveProjectPaths(projectRoot, homeDir);
  const inv = buildInventory({ projectRoot, homeDir });
  const trust = readTrustFile(projectRoot, homeDir);
  trust.hooks ??= {};
  const accepted: string[] = [];

  for (const hook of inv.hooks) {
    if (!fs.existsSync(hook.source)) continue;
    const record = {
      sha256: hookTrustHash(hook),
      trustedAt: new Date().toISOString(),
    };
    for (const key of hookTrustKeys(hook, paths.projectRoot, paths.homeDir)) trust.hooks[key] = record;
    accepted.push(`${hook.name} (${hook.source})`);
  }

  if (!dryRun && accepted.length > 0) writeTrustFile(paths.trustPath, trust);
  return accepted.sort();
}

function durationMsSince(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

type CheckProgressKey = keyof typeof CHECK_PROGRESS_STEPS;

function emitCheckProgress(
  sink: RitualProgressSink | undefined,
  key: CheckProgressKey,
  status: Parameters<typeof emitRitualProgress>[1]["status"],
  message?: string,
): void {
  const step = CHECK_PROGRESS_STEPS[key];
  emitRitualProgress(sink, { ...step, status, message });
}

function statusFromFindings(fail: boolean, warn: boolean): PassStep["status"] {
  if (fail) return "fail";
  if (warn) return "warn";
  return "pass";
}

function buildSyncSummary(sync: SyncReport | undefined): PassSyncSummary | undefined {
  if (!sync) return undefined;
  return {
    generatedConfigPath: sync.generatedConfigPath,
    builtInAgents: sync.projectedAgents.length,
    extensionAgents: sync.projectedExtensionAgents.length,
    builtInCommands: Math.max(0, sync.projectedCommands.length - sync.projectedExtensionCommands.length),
    extensionCommands: sync.projectedExtensionCommands.length,
    skills: sync.projectedSkills.length,
    tuiFiles: sync.projectedTuiFiles.length,
    externalIntegrationFiles: sync.projectedExternalIntegrationFiles.length,
    rulesyncStatus: sync.rulesync.status,
    rulesyncPromoted: sync.rulesync.promoted.length,
    rulesyncDurationMs: sync.rulesync.timing?.durationMs,
    rulesyncFeatures: sync.rulesync.timing?.features,
    notes: sync.notes,
  };
}

function buildPatchSummary(reports: readonly PatchRunReport[]): PassPatchSummary | undefined {
  if (reports.length === 0) return undefined;
  return {
    statePath: reports[0]?.statePath ?? "",
    phases: reports.map((report) => ({
      phase: report.phase,
      outcome: report.outcome,
      registered: report.registered,
      applicable: report.applicable,
      applied: report.results.filter((result) => result.status === "applied").length,
      warnings: report.warnings.length,
      errors: report.errors.length,
    })),
  };
}

function buildAntigravityPluginSummary(report: ManagedAntigravityPluginUpdateReport | undefined): PassAntigravityPluginSummary | undefined {
  if (!report) return undefined;
  return {
    outcome: report.outcome,
    active: report.plugins.filter((plugin) => plugin.status !== "skipped").length,
    installed: report.plugins.filter((plugin) => plugin.status === "installed").length,
    updated: report.plugins.filter((plugin) => plugin.status === "updated").length,
    current: report.plugins.filter((plugin) => plugin.status === "current").length,
    skipped: report.plugins.filter((plugin) => plugin.status === "skipped").length,
    errors: report.plugins.filter((plugin) => plugin.status === "error").length,
    warnings: report.warnings,
    plugins: report.plugins.map((plugin) => ({
      displayName: plugin.displayName,
      pluginName: plugin.pluginName,
      status: plugin.status,
      reason: plugin.reason,
      revision: plugin.revision,
      error: plugin.error,
      source: plugin.source,
      ref: plugin.ref,
      destinations: plugin.destinations,
    })),
  };
}

function patchReportStepStatus(report: PatchRunReport): PassStep["status"] {
  if (report.errors.length > 0) return "fail";
  if (report.warnings.length > 0) return "warn";
  return "pass";
}

function patchResultIsVisible(result: PatchRunReport["results"][number]): boolean {
  return result.status !== "skipped";
}

function patchReportHasVisibleResults(report: PatchRunReport): boolean {
  return report.results.some(patchResultIsVisible);
}

export function runPass(options: PassOptions = {}): PassReport {
  const passStartedAt = performance.now();
  const timingSteps: Array<{ name: string; durationMs: number }> = [];
  const recordTiming = (name: string, startedAt: number) => {
    timingSteps.push({ name, durationMs: durationMsSince(startedAt) });
  };
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const plan = buildInstallerPlan({
    intent: "check",
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    dryRun: options.dryRun,
    force: options.force,
    windows: options.windows,
    rulesyncMode: options.rulesyncMode,
  });
  const automated: string[] = [];
  const blockers: PassBlocker[] = [];
  let setup: SetupOpenCodeReport | undefined;
  let globalSetup: SetupUxReport | undefined;
  let setupWarnings: string[] = [];
  let extensionUpdate: ExtensionCommandReport | undefined;
  let antigravityPluginUpdate: ManagedAntigravityPluginUpdateReport | undefined;
  let globalSync: SyncReport | undefined;
  let sync: SyncReport | undefined;
  const patchReports: PatchRunReport[] = [];
  let validation: ValidationReport | undefined;
  let security: SecurityReport | undefined;
  let dashboard: DashboardReport | undefined;
  let globalTuiRepaired = false;
  let globalStartupRepaired = false;

  if (!options.skipSetup) {
    const setupStartedAt = performance.now();
    emitCheckProgress(options.onProgress, "setup", "running");
    try {
      if (paths.homeMode) {
        globalSetup = setupUx({
          projectRoot: paths.projectRoot,
          homeDir: paths.homeDir,
          dryRun: options.dryRun,
          force: options.force,
          installOpenCode: false,
          installPlugins: false,
          installTuiDependencies: false,
          installTuiSidebar: false,
        });
        setupWarnings = checkSetupWarnings(globalSetup);
      } else {
        setup = setupOpenCode({
          projectRoot: paths.projectRoot,
          homeDir: paths.homeDir,
          dryRun: options.dryRun,
          force: options.force,
          skipDoctor: true,
          skipCommandCheck: true,
        });
        setupWarnings = checkSetupWarnings(setup);
      }
    } catch (error) {
      emitCheckProgress(options.onProgress, "setup", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(
      options.onProgress,
      "setup",
      setupWarnings.length > 0 ? "warn" : "pass",
      setupWarnings.length > 0
        ? `${setupWarnings.length} warning(s)`
        : paths.homeMode
          ? "Global OpenCode profile is present."
          : "Startup sync wiring is present.",
    );
    automated.push(paths.homeMode ? "setup-ux" : "setup-opencode");
    for (const warning of setupWarnings) blockers.push(blocker("setup", "warn", warning, "Review setup conflicts; rerun `agentx check --force` only if you want to overwrite managed files."));
    recordTiming(paths.homeMode ? "setup-ux" : "setup-opencode", setupStartedAt);
  }

  function runPatchPhase(phase: PatchPhase): PatchRunReport | undefined {
    if (options.skipPatches) return undefined;
    const patchStartedAt = performance.now();
    let report: PatchRunReport;
    try {
      report = runPatchesForPhase({
        phase,
        projectRoot: paths.projectRoot,
        homeDir: paths.homeDir,
        dryRun: options.dryRun,
        force: options.force,
        registry: options.patchRegistry,
        onProgress: options.onProgress,
      });
    } finally {
      recordTiming(`patches:${phase}`, patchStartedAt);
    }
    patchReports.push(report);
    if (patchReportHasVisibleResults(report)) automated.push(`patches:${phase}`);
    recordPatchBlockers(report);
    return report;
  }

  function recordPatchBlockers(report: PatchRunReport): void {
    for (const result of report.results) {
      if (result.status === "failed") {
        blockers.push(blocker(
          "patch",
          result.required ? "fail" : "warn",
          `${DISPLAY} patch found a problem in ${result.id}: ${result.message}`,
          patchAction(result),
        ));
      } else if (result.status === "warning") {
        blockers.push(blocker("patch", "warn", `${DISPLAY} patch needs attention in ${result.id}: ${result.message}`, patchAction(result)));
      }
    }
  }

  if (!options.skipSync && !options.skipExtensionUpdate) {
    runPatchPhase("pre-extension-update");
    const extensionUpdateStartedAt = performance.now();
    emitCheckProgress(options.onProgress, "extensionUpdate", "running");
    extensionUpdate = updateGeminiExtensions({
      all: true,
      dryRun: options.dryRun,
      autoConsent: true,
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      patchRegistry: options.patchRegistry,
      onPatchProgress: options.onProgress,
    });
    if (extensionUpdate.patches?.length) {
      patchReports.push(...extensionUpdate.patches);
      for (const report of extensionUpdate.patches) recordPatchBlockers(report);
      if (extensionUpdate.patches.some(patchReportHasVisibleResults)) automated.push("patches:before-gemini-extension-update");
    }
    const message = extensionUpdateMessage(extensionUpdate);
    emitCheckProgress(
      options.onProgress,
      "extensionUpdate",
      extensionUpdate.status === "error" || extensionUpdate.status === "blocked" ? "warn" : progressStatusFromOutcome(extensionUpdate.status),
      message,
    );
    automated.push("update-extensions");
    if (extensionUpdate.status === "error" || extensionUpdate.status === "blocked") {
      blockers.push(blocker("extension-update", "warn", message, extensionUpdateAction()));
    }
    recordTiming("extension-update", extensionUpdateStartedAt);
    runPatchPhase("post-extension-update");
  }

  if (!options.skipSync && !options.skipAntigravityPluginUpdate) {
    const antigravityPluginUpdateStartedAt = performance.now();
    emitCheckProgress(options.onProgress, "antigravityPluginUpdate", "running");
    antigravityPluginUpdate = updateManagedAntigravityPlugins({
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      dryRun: options.dryRun,
      specs: options.managedAntigravityPluginSpecs,
      agyBin: options.managedAntigravityAgyBin,
      detectAntigravityCli: options.detectManagedAntigravityCli,
      fetchPluginSource: options.fetchManagedAntigravityPluginSource,
    });
    const message = antigravityPluginUpdateMessage(antigravityPluginUpdate);
    emitCheckProgress(
      options.onProgress,
      "antigravityPluginUpdate",
      progressStatusFromOutcome(antigravityPluginUpdate.outcome),
      message,
    );
    if (antigravityPluginUpdate.plugins.some((plugin) => plugin.status !== "skipped")) automated.push("update-antigravity-plugins");
    for (const warning of antigravityPluginUpdate.warnings) {
      blockers.push(blocker("antigravity-plugin-update", "warn", warning, antigravityPluginUpdateAction()));
    }
    recordTiming("antigravity-plugin-update", antigravityPluginUpdateStartedAt);
  }

  if (!options.skipSync) {
    runPatchPhase("pre-sync");
    const syncStartedAt = performance.now();
    emitCheckProgress(options.onProgress, "sync", "running");
    try {
      if (!paths.homeMode) {
        const globalSyncStartedAt = performance.now();
        globalSync = syncToOpenCode({
          projectRoot: paths.homeDir,
          homeDir: paths.homeDir,
          dryRun: options.dryRun,
          force: options.force,
          silent: true,
          rulesyncMode: "off",
        });
        recordTiming("global-sync", globalSyncStartedAt);
      }
      const projectSyncStartedAt = performance.now();
      sync = syncToOpenCode({
        projectRoot: paths.projectRoot,
        homeDir: paths.homeDir,
        dryRun: options.dryRun,
        force: options.force,
        silent: true,
        rulesyncMode: options.rulesyncMode,
      });
      recordTiming("project-sync", projectSyncStartedAt);
    } catch (error) {
      emitCheckProgress(options.onProgress, "sync", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      recordTiming("sync", syncStartedAt);
    }
    const syncWarnings = [...(globalSync?.warnings ?? []), ...sync.warnings];
    emitCheckProgress(
      options.onProgress,
      "sync",
      syncWarnings.length > 0 ? "warn" : "pass",
      syncWarnings.length > 0
        ? `${syncWarnings.length} warning(s)`
        : `${sync.projectedSkills.length} skill(s), ${sync.projectedCommands.length} command(s), ${sync.projectedAgents.length + sync.projectedExtensionAgents.length} agent(s) projected.`,
    );
    if (globalSync) automated.push("global-sync");
    automated.push("sync");
    for (const warning of syncWarnings) blockers.push(blocker("sync", "warn", warning, "Review sync conflicts; rerun `agentx check --force` only if you want to overwrite managed files."));
    runPatchPhase("post-sync");
  }

  runPatchPhase("pre-doctor");
  const doctorStartedAt = performance.now();
  emitCheckProgress(options.onProgress, "doctor", "running");
  let doctor: DoctorReport;
  try {
    doctor = runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
  } catch (error) {
    emitCheckProgress(options.onProgress, "doctor", "fail", error instanceof Error ? error.message : String(error));
    throw error;
  }
  emitCheckProgress(
    options.onProgress,
    "doctor",
    progressStatusFromFindings(doctor.errors.length, doctor.warnings.length),
    doctor.errors.length > 0
      ? `${doctor.errors.length} error(s)`
      : doctor.warnings.length > 0
        ? `${doctor.warnings.length} warning(s)`
        : "Doctor is clean.",
  );
  automated.push("doctor");

  const shouldRepairGlobalStartup = !options.dryRun && needsGlobalStartupRepair(doctor.warnings);
  const shouldRepairGlobalTui = !options.dryRun && needsGlobalTuiRepair(doctor.warnings);
  if (shouldRepairGlobalStartup || shouldRepairGlobalTui) {
    emitCheckProgress(options.onProgress, "doctor", "running", "Repairing global OpenCode plugin files.");
    if (shouldRepairGlobalStartup) {
      const repair = ensureGlobalStartupPlugin({
        homeDir: paths.homeDir,
      });
      automated.push("repair-global-startup-plugin");
      globalStartupRepaired = repair.plugin.status === "created" || repair.plugin.status === "updated";
      if (!repair.pluginCheck.ok) blockers.push(blocker("setup", "warn", repair.pluginCheck.message, "Run `agentx setup-ux` to reinstall the global startup plugin."));
      for (const warning of repair.warnings) blockers.push(blocker("setup", "warn", warning, "Run `agentx setup-ux` to review the global startup plugin."));
    }
    if (shouldRepairGlobalTui) {
      const repair = ensureGlobalTuiSidebar({
        configDir: globalOpenCodeConfigDir({ homeDir: paths.homeDir }),
      });
      automated.push("repair-global-tui-sidebar");
      globalTuiRepaired = repair.plugin.status === "created" || repair.plugin.status === "updated";
      if (!repair.pluginCheck.ok) blockers.push(blocker("setup", "warn", repair.pluginCheck.message, "Run `agentx setup-ux` to reinstall the global TUI plugin."));
      for (const warning of repair.warnings) blockers.push(blocker("setup", "warn", warning, "Run `agentx setup-ux` to review the global TUI profile."));
    }
    doctor = runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
    emitCheckProgress(
      options.onProgress,
      "doctor",
      progressStatusFromFindings(doctor.errors.length, doctor.warnings.length),
      globalStartupRepaired || globalTuiRepaired
        ? "Global OpenCode plugin files repaired; restart OpenCode."
        : doctor.warnings.length > 0
          ? `${doctor.warnings.length} warning(s)`
          : "Doctor is clean.",
      );
  }
  recordTiming("doctor", doctorStartedAt);

  let acceptedHooks: string[] = [];
  const hookReviewStartedAt = options.acceptHooks ? performance.now() : undefined;
  if (options.acceptHooks) {
    emitCheckProgress(options.onProgress, "hookReview", "running");
    try {
      acceptedHooks = acceptCurrentHooks(paths.projectRoot, paths.homeDir, options.dryRun);
    } catch (error) {
      emitCheckProgress(options.onProgress, "hookReview", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(options.onProgress, "hookReview", "pass", `${acceptedHooks.length} hook(s) accepted.`);
  }
  if (acceptedHooks.length > 0) {
    emitCheckProgress(options.onProgress, "doctor", "running", "Rechecking after hook trust update.");
    doctor = runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
    emitCheckProgress(
      options.onProgress,
      "doctor",
      progressStatusFromFindings(doctor.errors.length, doctor.warnings.length),
      doctor.errors.length > 0
        ? `${doctor.errors.length} error(s)`
        : doctor.warnings.length > 0
          ? `${doctor.warnings.length} warning(s)`
          : "Doctor is clean after hook review.",
    );
    automated.push("doctor-after-hook-acceptance");
  }
  if (hookReviewStartedAt !== undefined) recordTiming("hook-review", hookReviewStartedAt);

  if (!options.skipValidation) {
    const validationStartedAt = performance.now();
    emitCheckProgress(options.onProgress, "validate", "running");
    try {
      validation = runValidation({
        projectRoot: paths.projectRoot,
        homeDir: paths.homeDir,
        silent: true,
        windows: options.windows,
        doctorReport: doctor,
        skipOpenCodeDebugConfig: true,
        skipToolVersionChecks: true,
      });
    } catch (error) {
      emitCheckProgress(options.onProgress, "validate", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(
      options.onProgress,
      "validate",
      progressStatusFromOutcome(validation.outcome),
      validation.outcome === "pass" ? "Validation is clean." : firstValidationIssue(validation, validation.outcome) ?? `Validation outcome: ${validation.outcome}.`,
    );
    automated.push("validate");
    recordTiming("validate", validationStartedAt);
  }

  if (!options.skipSecurity) {
    const securityStartedAt = performance.now();
    emitCheckProgress(options.onProgress, "security", "running");
    try {
      security = runSecurityCheck({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
    } catch (error) {
      emitCheckProgress(options.onProgress, "security", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(
      options.onProgress,
      "security",
      progressStatusFromOutcome(security.outcome),
      security.outcome === "pass" ? "Security guardrails are clean." : firstSecurityIssue(security, security.outcome) ?? `Security outcome: ${security.outcome}.`,
    );
    automated.push("security-check");
    recordTiming("security-check", securityStartedAt);
  }

  if (!options.skipDashboard) {
    const dashboardStartedAt = performance.now();
    emitCheckProgress(options.onProgress, "dashboard", "running");
    try {
      dashboard = runDashboard({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true, refresh: false, doctorReport: doctor });
    } catch (error) {
      emitCheckProgress(options.onProgress, "dashboard", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(
      options.onProgress,
      "dashboard",
      progressStatusFromOutcome(dashboard.outcome),
      dashboard.outcome === "pass" ? "Dashboard refreshed." : firstDashboardIssue(dashboard, dashboard.outcome === "fail" ? "fail" : "warn") ?? `Dashboard outcome: ${dashboard.outcome}.`,
    );
    automated.push("dashboard");
    recordTiming("dashboard", dashboardStartedAt);
  }

  runPatchPhase("post-check");

  for (const error of doctor.errors) blockers.push(blocker("doctor", "fail", error, "Fix the doctor error and run `agentx check` again."));
  for (const warning of doctor.warnings) blockers.push(blocker("doctor", "warn", warning, actionForWarning(warning)));
  if (globalStartupRepaired) blockers.push(blocker("setup", "warn", `Global ${DISPLAY} startup plugin was repaired automatically.`, "Restart OpenCode to load the automatic usage refresh."));
  if (globalTuiRepaired) blockers.push(blocker("setup", "warn", `Global ${DISPLAY} TUI sidebar plugin was repaired automatically.`, "Restart OpenCode to load the new TUI."));
  if (validation?.outcome === "fail") blockers.push(blocker("validation", "fail", `Validation failed: ${firstValidationIssue(validation, "fail") ?? "a required check failed."}`, validationAction(options)));
  if (validation?.outcome === "warn") blockers.push(blocker("validation", "warn", `Validation passed with warnings: ${firstValidationIssue(validation, "warn") ?? "some checks need review."}`, validationAction(options)));
  if (security?.outcome === "fail") blockers.push(blocker("security", "fail", `Security check failed: ${firstSecurityIssue(security, "fail") ?? "a required guardrail failed."}`, securityAction()));
  if (security?.outcome === "warn") blockers.push(blocker("security", "warn", `Security check passed with warnings: ${firstSecurityIssue(security, "warn") ?? "some guardrails need review."}`, securityAction()));
  if (dashboard?.outcome === "fail") blockers.push(blocker("dashboard", "fail", `Final dashboard failed: ${firstDashboardIssue(dashboard, "fail") ?? "the final summary recorded an error."}`, dashboardAction()));
  if (dashboard?.outcome === "warn") blockers.push(blocker("dashboard", "warn", `Final dashboard passed with warnings: ${firstDashboardIssue(dashboard, "warn") ?? "the final summary recorded warnings."}`, dashboardAction()));

  const outcome = blockers.some((item) => item.severity === "fail")
    ? "fail"
    : blockers.length > 0
      ? "warn"
      : "pass";

  const steps: PassStep[] = [];
  const appendPatchStep = (phase: PatchPhase) => {
    const reports = patchReports.filter((item) => item.phase === phase || (phase === "pre-extension-update" && item.phase === "before-gemini-extension-update"));
    if (reports.length === 0 || reports.every((report) => !patchReportHasVisibleResults(report))) return;
    const errors = reports.reduce((count, report) => count + report.errors.length, 0);
    const warnings = reports.reduce((count, report) => count + report.warnings.length, 0);
    const resultCount = reports.reduce((count, report) => count + report.results.filter(patchResultIsVisible).length, 0);
    steps.push({
      name: `patches:${phase}`,
      status: errors > 0 ? "fail" : warnings > 0 ? "warn" : "pass",
      detail: reports.length === 1 ? summarizePatchReport(reports[0]) : `${resultCount} patch result(s) across ${reports.length} report(s)`,
    });
  };
  if (setup) {
    steps.push({
      name: "setup-opencode",
      status: setupWarnings.length > 0 ? "warn" : "pass",
      detail: setupWarnings.length > 0 ? `${setupWarnings.length} warning(s)` : undefined,
    });
  }
  if (globalSetup) {
    steps.push({
      name: "setup-ux",
      status: setupWarnings.length > 0 ? "warn" : "pass",
      detail: setupWarnings.length > 0 ? `${setupWarnings.length} warning(s)` : undefined,
    });
  }
  appendPatchStep("pre-extension-update");
  if (extensionUpdate) {
    steps.push({
      name: "update-extensions",
      status: extensionUpdate.status === "error" ? "warn" : "pass",
      detail: extensionUpdate.status === "preview" ? "preview" : extensionUpdate.status === "error" ? "warning" : undefined,
    });
  }
  appendPatchStep("post-extension-update");
  if (antigravityPluginUpdate) {
    steps.push({
      name: "update-antigravity-plugins",
      status: antigravityPluginUpdate.outcome === "warn" ? "warn" : "pass",
      detail: antigravityPluginUpdate.outcome === "preview"
        ? "preview"
        : antigravityPluginUpdate.plugins.every((plugin) => plugin.status === "skipped")
          ? "no active plugins"
          : antigravityPluginUpdateMessage(antigravityPluginUpdate).replace(/\.$/, ""),
    });
  }
  appendPatchStep("pre-sync");
  if (sync) {
    const syncWarnings = [...(globalSync?.warnings ?? []), ...sync.warnings];
    steps.push({
      name: "sync",
      status: syncWarnings.length > 0 ? "warn" : "pass",
      detail: syncWarnings.length > 0 ? `${syncWarnings.length} warning(s)` : undefined,
    });
  }
  appendPatchStep("post-sync");
  appendPatchStep("pre-doctor");
  if (acceptedHooks.length > 0) {
    steps.push({ name: "hook review", status: "pass", detail: `${acceptedHooks.length} accepted` });
  }
  steps.push({
    name: "doctor",
    status: statusFromFindings(doctor.errors.length > 0, doctor.warnings.length > 0 || globalStartupRepaired || globalTuiRepaired),
    detail: doctor.errors.length > 0
      ? `${doctor.errors.length} error(s)`
      : globalStartupRepaired || globalTuiRepaired
        ? [
          globalStartupRepaired ? "global startup repaired" : "",
          globalTuiRepaired ? "global TUI repaired" : "",
        ].filter(Boolean).join(", ")
        : doctor.warnings.length > 0
        ? `${doctor.warnings.length} warning(s)`
        : undefined,
  });
  if (validation) steps.push({ name: "validate", status: validation.outcome, detail: validation.outcome === "pass" ? undefined : validation.outcome });
  if (security) steps.push({ name: "security-check", status: security.outcome, detail: security.outcome === "pass" ? undefined : security.outcome });
  if (dashboard) steps.push({ name: "dashboard", status: dashboard.outcome, detail: dashboard.outcome === "pass" ? undefined : dashboard.outcome });
  appendPatchStep("post-check");

  const report: PassReport = {
    version: AGENTX_VERSION,
    projectRoot: paths.projectRoot,
    outcome,
    plan,
    automated,
    steps,
    acceptedHooks,
    blockers,
    sync: buildSyncSummary(sync),
    doctor: {
      warnings: doctor.warnings.length,
      errors: doctor.errors.length,
    },
    validation: validation ? { outcome: validation.outcome } : undefined,
    security: security ? { outcome: security.outcome } : undefined,
    patches: buildPatchSummary(patchReports),
    antigravityPlugins: buildAntigravityPluginSummary(antigravityPluginUpdate),
    dashboard: dashboard ? { outcome: dashboard.outcome } : undefined,
    timing: {
      durationMs: durationMsSince(passStartedAt),
      steps: timingSteps,
    },
    files: {
      pass: paths.passPath,
      doctor: paths.doctorPath,
      dashboard: paths.dashboardMarkdownPath,
    },
  };

  if (!options.dryRun) writeStateRecord("check", report as unknown as Record<string, unknown>, { projectRoot: paths.projectRoot, homeDir: paths.homeDir });
  if (options.setExitCode !== false) process.exitCode = outcome === "fail" ? 2 : outcome === "warn" ? 1 : 0;
  return report;
}
