import type { InstallReport } from "./install.js";
import type { PassReport } from "./pass.js";
import { BINARY, DISPLAY } from "./brand.js";
import { INK_COLORS, LABELS } from "./presentation/theme.js";
import type { ResetReport } from "./reset.js";
import type { RitualFinishedJsonEvent, RitualProgressDefinition, RitualProgressEvent, RitualProgressSink, RitualProgressStatus } from "./ritual-progress.js";
import type { SelfUpdateReport } from "./self-update.js";

export type RitualKind = "install" | "check" | "reset" | "update";
export type RitualTone = "pass" | "warn" | "fail" | "preview" | "neutral";

export interface RitualMetric {
  label: string;
  value: string;
  tone?: RitualTone;
}

export interface RitualStep {
  label: string;
  status: RitualTone;
  detail?: string;
}

export interface RitualViewModel {
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: RitualTone;
  metrics: RitualMetric[];
  steps: RitualStep[];
  callouts: string[];
  next: string[];
  files: string[];
}

export interface LiveRitualStep extends RitualProgressDefinition {
  status: RitualProgressStatus;
  message?: string;
}

export interface LiveRitualModel {
  kind: RitualKind;
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: RitualTone;
  startedAt: number;
  finishedAt?: number;
  currentStepId?: string;
  steps: LiveRitualStep[];
  metrics: RitualMetric[];
  callouts: string[];
  next: string[];
  files: string[];
  final: boolean;
}

export interface RitualUiOptions {
  json?: boolean;
  plain?: boolean;
  progressJson?: boolean;
  stdoutIsTTY?: boolean;
  stdoutColumns?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunWithRitualUiOptions<TReport extends InstallReport | PassReport | ResetReport | SelfUpdateReport> {
  kind: RitualKind;
  subtitle: string;
  steps: RitualProgressDefinition[];
  run: (sink: RitualProgressSink) => TReport | Promise<TReport>;
}

export interface RunWithRitualProcessUiOptions {
  kind: RitualKind;
  subtitle: string;
  steps: RitualProgressDefinition[];
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RitualProcessUiResult {
  exitCode: number;
  signal?: NodeJS.Signals | null;
}

export interface RenderRitualOptions {
  animate: boolean;
}

export function titleForKind(kind: RitualKind): string {
  if (kind === "install") return `${DISPLAY} install`;
  if (kind === "update") return `${DISPLAY} update`;
  if (kind === "reset") return `${DISPLAY} reset`;
  return `${DISPLAY} check`;
}

function toneFromOutcome(outcome: string | undefined): RitualTone {
  if (outcome === "pass" || outcome === "applied") return "pass";
  if (outcome === "warn") return "warn";
  if (outcome === "fail" || outcome === "error") return "fail";
  if (outcome === "preview" || outcome === "cancelled") return "preview";
  return "neutral";
}

function labelFromTone(tone: RitualTone): string {
  return LABELS[tone];
}

export function colorFromTone(tone: RitualTone): string {
  return INK_COLORS[tone];
}

export function toneFromProgress(status: RitualProgressStatus): RitualTone {
  if (status === "pass") return "pass";
  if (status === "warn") return "warn";
  if (status === "fail") return "fail";
  if (status === "skipped") return "preview";
  return "neutral";
}

function countChangedWrites(report: InstallReport | ResetReport): number | undefined {
  const writes = report.setup?.writes;
  if (!writes) return undefined;
  return writes.filter((write) => write.status !== "unchanged").length;
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1).replace(/\.0$/, "")}s`;
}

const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const MAX_DISPLAY_LINE_LENGTH = 280;
const MIN_RITUAL_UI_COLUMNS = 80;
export const RITUAL_UI_SPINNER_INTERVAL_MS = 1000;
const RITUAL_UI_MAX_FPS = 10;
const DEFAULT_RITUAL_UI_ROWS = 40;
const COMPACT_RITUAL_ROWS = 34;
const COMPACT_RITUAL_STEPS = 6;
const TIGHT_RITUAL_STEPS = 4;

function isTransferProgressLine(line: string): boolean {
  if (/^% Total\s+% Received\s+% Xferd/.test(line)) return true;
  if (/^Dload\s+Upload\s+Total\s+Spent\s+Left\s+Speed$/.test(line)) return true;
  if (/--:--:--/.test(line) && /^\d{1,3}\s+/.test(line)) return true;
  return false;
}

function truncateDisplayLine(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function compactDisplayLine(item: string | undefined, maxChars = MAX_DISPLAY_LINE_LENGTH): string | undefined {
  const text = item
    ?.replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r/g, "\n")
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !isTransferProgressLine(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return truncateDisplayLine(text, maxChars);
}

function uniqueLines(items: Array<string | undefined>, limit = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = compactDisplayLine(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function checkCallouts(report: PassReport | undefined, fallback: string[] = []): string[] {
  return uniqueLines([
    ...(report?.blockers.map((item) => `${item.source}: ${item.message}`) ?? []),
    ...fallback,
  ]);
}

function checkNext(report: PassReport | undefined, fallback: string[]): string[] {
  return uniqueLines([
    ...(report?.blockers.map((item) => item.action) ?? []),
    ...fallback,
  ], 4);
}

function postUpdateCallouts(report: SelfUpdateReport): string[] {
  return uniqueLines([
    report.message,
    report.stderrTail,
    report.stdoutTail,
    report.postUpdate?.message,
    ...(report.postUpdate?.summary?.callouts ?? []),
    report.postUpdate?.stderrTail,
    report.postUpdate?.summary ? undefined : report.postUpdate?.stdoutTail,
  ]);
}

function postUpdateNext(report: SelfUpdateReport): string[] {
  return uniqueLines([
    ...(report.postUpdate?.summary?.next ?? []),
    ...(report.postUpdate?.status === "fail" || report.postUpdate?.status === "error"
      ? ["Run `agentx check --plain --force` to inspect the post-update failure directly.", "Run `agentx dashboard --plain` for the last persisted bridge state."]
      : ["Run `agentx update --plain` so the release install log is printed without live progress.", "Check Node/npm/PowerShell PATH and network access, then retry the same release."]),
  ], 4);
}

function unexpectedErrorNext(kind: RitualKind, message: string): string[] {
  const command = `agentx ${kind} --plain`;
  const generic = [
    `Run \`${command}\` to see the classic logs without live progress.`,
    "Then run `agentx dashboard --plain` to inspect the last persisted bridge status.",
  ];
  if (/ENOENT|not found|command not found|no such file|n.o . reconhecido/i.test(message)) {
    return [
      `Check whether Node, npm, OpenCode and ${DISPLAY} resolve on PATH in this shell.`,
      `Run \`${command}\` after fixing PATH so the full native command output stays visible.`,
      "On Windows, open PowerShell 7 again after changing PATH or reinstalling shims.",
    ];
  }
  if (/EACCES|EPERM|permission|access denied|permiss/i.test(message)) {
    return [
      "Check file ownership/permissions for the path mentioned in the error.",
      `Run \`${command}\` again after granting write access or closing processes that may be locking the file.`,
    ];
  }
  if (/JSON|parse|Unexpected token/i.test(message)) {
    return [
      "Open the config file mentioned in the error and fix invalid JSON/JSONC syntax.",
      `Run \`${command}\` again; the same TODO item should move past FAIL once the file parses.`,
    ];
  }
  return generic;
}

function installModel(report: InstallReport): RitualViewModel {
  const tone = toneFromOutcome(report.outcome);
  const steps: RitualStep[] = [];
  if (report.cleanup) steps.push({ label: "home cleanup", status: report.cleanup.warnings.length > 0 ? "warn" : "pass", detail: `${report.cleanup.actions.length} action(s)` });
  if (report.setup) steps.push({
    label: "OpenCode profile",
    status: report.setup.warnings.length > 0 ? "warn" : "pass",
    detail: `${countChangedWrites(report) ?? 0} write(s), ${report.setup.commands.filter((item) => item.status !== "skipped").length} command(s)`,
  });
  steps.push(report.check
    ? { label: "full check", status: toneFromOutcome(report.check.outcome), detail: `${report.check.steps.length} step(s)` }
    : { label: "full check", status: "preview", detail: "skipped" });

  return {
    title: titleForKind("install"),
    subtitle: report.homeMode ? "home/global profile" : report.projectRoot,
    statusLabel: labelFromTone(tone),
    tone,
    metrics: [
      { label: "mode", value: report.homeMode ? "global" : "project" },
      { label: "version", value: report.version },
      { label: "warnings", value: String(report.warnings.length), tone: report.warnings.length > 0 ? "warn" : "pass" },
    ],
    steps,
    callouts: checkCallouts(report.check, report.warnings),
    next: tone === "fail"
      ? checkNext(report.check, ["Run `agentx dashboard --plain` for the persisted bridge state.", "Run `agentx check --plain` for the classic report."])
      : report.outcome === "preview"
        ? [`Run ${BINARY} install without --dry-run to apply this plan.`]
        : ["OpenCode profile is ready.", "Restart OpenCode to load updated plugin/sidebar code."],
    files: report.check ? [report.check.files.pass, report.check.files.dashboard] : [],
  };
}

function checkModel(report: PassReport): RitualViewModel {
  const tone = toneFromOutcome(report.outcome);
  const syncNotes = report.sync?.notes ?? [];
  const timingMetrics: RitualMetric[] = [];
  if (report.timing) timingMetrics.push({ label: "duration", value: formatDurationMs(report.timing.durationMs) });
  if (report.sync?.rulesyncDurationMs !== undefined) timingMetrics.push({ label: "rulesync", value: formatDurationMs(report.sync.rulesyncDurationMs) });
  return {
    title: titleForKind("check"),
    subtitle: report.projectRoot,
    statusLabel: labelFromTone(tone),
    tone,
    metrics: [
      { label: "automated", value: String(report.automated.length) },
      ...timingMetrics,
      { label: "skills", value: String(report.sync?.skills ?? 0) },
      { label: "commands", value: String((report.sync?.builtInCommands ?? 0) + (report.sync?.extensionCommands ?? 0)) },
      { label: "agents", value: String((report.sync?.builtInAgents ?? 0) + (report.sync?.extensionAgents ?? 0)) },
      { label: "blockers", value: String(report.blockers.length), tone: report.blockers.some((item) => item.severity === "fail") ? "fail" : report.blockers.length > 0 ? "warn" : "pass" },
    ],
    steps: report.steps.map((step) => ({
      label: step.name,
      status: toneFromOutcome(step.status),
      detail: step.detail,
    })),
    callouts: [
      ...report.blockers.slice(0, 5).map((item) => `${item.source}: ${item.message}`),
      ...syncNotes.slice(0, Math.max(0, 5 - report.blockers.length)),
    ],
    next: report.blockers.length > 0
      ? report.blockers.slice(0, 3).map((item) => item.action)
      : ["Bridge is clean.", "OpenCode can start with the current global/project profile."],
    files: [report.files.pass, report.files.dashboard],
  };
}

function resetModel(report: ResetReport): RitualViewModel {
  const tone = toneFromOutcome(report.outcome);
  const steps: RitualStep[] = [
    { label: "websearch env", status: toneFromOutcome(report.exaEnv.status === "warning" ? "warn" : report.exaEnv.status === "preview" ? "preview" : "pass"), detail: report.exaEnv.message },
    { label: "home cleanup", status: report.cleanup.warnings.length > 0 ? "warn" : "pass", detail: `${report.cleanup.actions.length} action(s)` },
  ];
  if (report.setup) steps.push({ label: "global UX", status: report.setup.warnings.length > 0 ? "warn" : "pass", detail: `${countChangedWrites(report) ?? 0} write(s)` });
  if (report.sync) steps.push({ label: "global sync", status: report.sync.warnings.length > 0 ? "warn" : "pass", detail: `${report.sync.projectedSkills.length} skill(s), ${report.sync.projectedCommands.length} command(s)` });
  if (report.doctor) steps.push({ label: "doctor", status: report.doctor.errors.length > 0 ? "fail" : report.doctor.warnings.length > 0 ? "warn" : "pass", detail: `${report.doctor.errors.length} error(s), ${report.doctor.warnings.length} warning(s)` });
  if (report.check) steps.push({ label: "full check", status: toneFromOutcome(report.check.outcome), detail: `${report.check.steps.length} step(s)` });

  return {
    title: titleForKind("reset"),
    subtitle: report.homeDir,
    statusLabel: labelFromTone(tone),
    tone,
    metrics: [
      { label: "version", value: report.version },
      { label: "cleanup", value: String(report.cleanup.actions.length) },
      { label: "warnings", value: String(report.warnings.length), tone: report.warnings.length > 0 ? "warn" : "pass" },
    ],
    steps,
    callouts: checkCallouts(report.check, report.warnings),
    next: report.outcome === "preview"
      ? [`Run ${BINARY} reset --yes without --dry-run to apply this plan.`]
      : report.outcome === "cancelled"
        ? ["Nothing was changed."]
        : report.check?.outcome === "fail"
          ? checkNext(report.check, ["Run `agentx check --plain` for the classic report."])
          : ["Global OpenCode profile was rebuilt.", `Run ${BINARY} check if you want another verification pass.`],
    files: [report.globalConfigPath, ...(report.check ? [report.check.files.pass, report.check.files.dashboard] : [])],
  };
}

function updateModel(report: SelfUpdateReport): RitualViewModel {
  const postUpdateTone = toneFromOutcome(report.postUpdate?.status);
  const postUpdateNeedsAttention = report.status === "applied" && (postUpdateTone === "warn" || postUpdateTone === "fail");
  const tone = postUpdateNeedsAttention
    ? "warn"
    : toneFromOutcome(report.status);
  const releaseFlagIndex = report.plan.delegation.args.indexOf("--release");
  const release = releaseFlagIndex >= 0 ? report.plan.delegation.args[releaseFlagIndex + 1] : undefined;
  const installDetail = report.status === "preview"
    ? "Release install would run."
    : report.status === "applied"
      ? "Release installed."
      : "Release install did not complete.";
  return {
    title: titleForKind("update"),
    subtitle: report.message,
    statusLabel: labelFromTone(tone),
    tone,
    metrics: [
      { label: "release", value: release ?? "latest" },
      { label: "post-check", value: report.postUpdate?.status ?? "skipped", tone: report.postUpdate ? postUpdateTone : "neutral" },
      { label: "mode", value: report.status === "preview" ? "dry-run" : "apply" },
    ],
    steps: [
      { label: "release install", status: tone, detail: installDetail },
      ...(report.postUpdate ? [{ label: "post-update check", status: postUpdateTone, detail: report.postUpdate.message }] : []),
    ],
    callouts: report.status === "error" || postUpdateNeedsAttention ? postUpdateCallouts(report) : [],
    next: report.status === "preview"
      ? [`Run ${BINARY} update without --dry-run to apply this release.`]
      : report.status === "applied" && !postUpdateNeedsAttention
        ? ["Restart OpenCode so the new plugin/sidebar code is loaded.", `Then run ${BINARY} check if you want a fresh human-readable pass.`]
        : postUpdateNext(report),
    files: report.postUpdate?.files ?? [],
  };
}

export function ritualViewModel(kind: RitualKind, report: InstallReport | PassReport | ResetReport | SelfUpdateReport): RitualViewModel {
  if (kind === "install") return installModel(report as InstallReport);
  if (kind === "reset") return resetModel(report as ResetReport);
  if (kind === "update") return updateModel(report as SelfUpdateReport);
  return checkModel(report as PassReport);
}

export function createLiveRitualModel(
  kind: RitualKind,
  subtitle: string,
  steps: RitualProgressDefinition[],
  options: { now?: number } = {},
): LiveRitualModel {
  return {
    kind,
    title: titleForKind(kind),
    subtitle,
    statusLabel: "RUN",
    tone: "neutral",
    startedAt: options.now ?? Date.now(),
    currentStepId: steps[0]?.stepId,
    steps: (steps.length > 0 ? steps : [{ stepId: "prepare", label: "Prepare ritual.", detail: "Loading the workflow." }]).map((step) => ({
      ...step,
      status: "queued",
    })),
    metrics: [],
    callouts: [],
    next: [],
    files: [],
    final: false,
  };
}

export function applyRitualProgressEvent(model: LiveRitualModel, event: RitualProgressEvent): LiveRitualModel {
  const existingIndex = model.steps.findIndex((step) => step.stepId === event.stepId);
  const existing = existingIndex >= 0 ? model.steps[existingIndex] : undefined;
  const nextStep: LiveRitualStep = {
    stepId: event.stepId,
    label: event.label,
    detail: compactDisplayLine(event.detail, 180) ?? existing?.detail,
    optional: existing?.optional,
    status: event.status,
    message: compactDisplayLine(event.message),
  };
  const steps = existingIndex >= 0
    ? model.steps.map((step, index) => index === existingIndex ? { ...step, ...nextStep } : step)
    : [...model.steps, nextStep];
  return {
    ...model,
    steps,
    currentStepId: event.status === "running" ? event.stepId : model.currentStepId,
  };
}

export function visibleTodoSteps(steps: LiveRitualStep[]): LiveRitualStep[] {
  return steps.filter((step) => !(step.optional && (step.status === "queued" || step.status === "skipped")));
}

function canonicalStepId(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("setup")) return "setup";
  if (normalized.includes("sync")) return "sync";
  if (normalized.includes("doctor")) return "doctor";
  if (normalized.includes("validate")) return "validate";
  if (normalized.includes("security")) return "security";
  if (normalized.includes("dashboard")) return "dashboard";
  if (normalized.includes("cleanup")) return "cleanup";
  if (normalized.includes("profile") || normalized.includes("ux")) return "profile";
  if (normalized.includes("plugin")) return "plugins";
  if (normalized.includes("check")) return "check";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function finalStepStatus(model: RitualViewModel, step: LiveRitualStep): LiveRitualStep {
  if (step.status !== "queued" && step.status !== "running") return step;
  const match = model.steps.find((candidate) => canonicalStepId(candidate.label) === step.stepId || candidate.label === step.label);
  if (!match) return { ...step, status: step.status === "running" ? "pass" : "skipped" };
  return {
    ...step,
    status: match.status === "pass" ? "pass" : match.status === "warn" ? "warn" : match.status === "fail" ? "fail" : "skipped",
    message: match.detail,
  };
}

export function finishLiveRitualModel(
  model: LiveRitualModel,
  report: InstallReport | PassReport | ResetReport | SelfUpdateReport,
  options: { now?: number } = {},
): LiveRitualModel {
  const view = ritualViewModel(model.kind, report);
  return {
    ...model,
    title: view.title,
    subtitle: view.subtitle,
    statusLabel: view.statusLabel,
    tone: view.tone,
    finishedAt: options.now ?? Date.now(),
    currentStepId: undefined,
    steps: model.steps.map((step) => finalStepStatus(view, step)),
    metrics: view.metrics,
    callouts: view.callouts,
    next: view.next,
    files: view.files,
    final: true,
  };
}

export function finishLiveRitualModelFromProgressEvent(
  model: LiveRitualModel,
  event: RitualFinishedJsonEvent,
  options: { now?: number } = {},
): LiveRitualModel {
  const tone = toneFromOutcome(event.outcome);
  return {
    ...model,
    statusLabel: event.summary?.statusLabel ?? labelFromTone(tone),
    tone,
    finishedAt: options.now ?? Date.now(),
    currentStepId: undefined,
    steps: model.steps.map((step) => step.status === "queued" || step.status === "running"
      ? { ...step, status: step.status === "running" ? progressStatusFromTone(tone) : "skipped" }
      : step),
    metrics: event.summary?.metrics ?? [],
    callouts: event.summary?.callouts ?? [],
    next: event.summary?.next ?? [],
    files: event.files ?? [],
    final: true,
  };
}

export function failLiveRitualModel(model: LiveRitualModel, error: unknown, options: { now?: number } = {}): LiveRitualModel {
  const message = error instanceof Error ? error.message : String(error);
  const steps = model.steps.map((step) => step.stepId === model.currentStepId || step.status === "running"
    ? { ...step, status: "fail" as const, message }
    : step);
  return {
    ...model,
    statusLabel: "FAIL",
    tone: "fail",
    finishedAt: options.now ?? Date.now(),
    steps,
    callouts: [message],
    next: unexpectedErrorNext(model.kind, message),
    final: true,
  };
}

function progressStatusFromTone(tone: RitualTone): RitualProgressStatus {
  if (tone === "pass") return "pass";
  if (tone === "warn") return "warn";
  if (tone === "fail") return "fail";
  if (tone === "preview") return "skipped";
  return "pass";
}

export function shouldUseRitualUi(options: RitualUiOptions = {}): boolean {
  if (options.json || options.plain || options.progressJson) return false;
  const env = options.env ?? process.env;
  const term = (env.TERM ?? "").toLowerCase();
  const columns = options.stdoutColumns ?? process.stdout.columns;
  if (
    env.CI
    || env.CODEX_CI
    || env.CODEX_SHELL
    || term === "dumb"
    || env.OGB_PLAIN === "1"
    || env.OGB_UI === "0"
  ) return false;
  if (typeof columns === "number" && columns > 0 && columns < MIN_RITUAL_UI_COLUMNS) return false;
  return options.stdoutIsTTY ?? process.stdout.isTTY ?? false;
}

export function shouldAnimateRitualUi(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OGB_UI_ANIMATE !== "0";
}
