import path from "node:path";
import type { PassBlocker, PassReport, PassStep, PassSyncSummary } from "../pass.js";
import { formatDuration, kvRow, sectionHeader, statusRow } from "./format.js";
import { ICONS, INDENT, type Tone } from "./theme.js";

function toneFromStep(status: PassStep["status"] | PassReport["outcome"] | PassBlocker["severity"]): Tone {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  return "warn";
}

function stepDetail(step: PassStep): string | undefined {
  return step.detail ? step.detail : undefined;
}

function relativeReportPath(projectRoot: string, filePath: string): string {
  const rel = path.relative(projectRoot, filePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return filePath;
  return rel;
}

function plural(count: number, singular: string, pluralText = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralText}`;
}

function rulesyncTimingDetail(sync: PassSyncSummary): string {
  const features = sync.rulesyncFeatures ?? [];
  const parts = [
    sync.rulesyncPromoted > 0 ? `${sync.rulesyncPromoted} promoted` : undefined,
    sync.rulesyncDurationMs !== undefined ? formatDuration(sync.rulesyncDurationMs) : undefined,
    features.length > 0
      ? features.map((feature) => `${feature.feature}${feature.status === "error" ? " error" : ""} ${formatDuration(feature.durationMs)}`).join(", ")
      : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? `, ${parts.join("; ")}` : "";
}

function syncSummaryLine(sync: PassSyncSummary): string {
  const parts = [
    plural(sync.builtInAgents, "agent"),
    plural(sync.extensionAgents, "subagent"),
    plural(sync.builtInCommands, "command"),
    plural(sync.extensionCommands, "extension command"),
    plural(sync.skills, "skill"),
  ].filter((item) => !item.startsWith("0 "));
  return parts.length > 0 ? parts.join(", ") : "no projected artifacts";
}

function friendlyBlockerMessage(item: PassBlocker): string {
  if (/opencode-auto-fallback.*plugin is not active/i.test(item.message)) {
    return "Auto fallback is enabled but the external plugin did not load.";
  }
  if (item.source === "validation" && item.severity === "warn") return "Validation surfaced warnings.";
  if (item.source === "security" && item.severity === "warn") return "Security check surfaced warnings.";
  if (item.source === "dashboard" && item.severity === "warn") return "Dashboard inherited warnings from earlier checks.";
  if (item.source === "patch" && item.severity === "warn") return "An agentX patch needs review.";
  return item.message;
}

export function formatPassReport(report: PassReport): string {
  const lines: string[] = [];
  lines.push(`agentX check ${ICONS[toneFromStep(report.outcome)]}`);
  lines.push(kvRow("Project", report.projectRoot));
  if (report.timing) lines.push(kvRow("Duration", formatDuration(report.timing.durationMs)));

  lines.push(sectionHeader("Checks"));
  for (const step of report.steps) {
    lines.push(statusRow(toneFromStep(step.status), step.name, stepDetail(step)));
  }

  if (report.sync) {
    lines.push(sectionHeader("Sync"));
    lines.push(`${INDENT}${syncSummaryLine(report.sync)}`);
    lines.push(`${INDENT}rulesync: ${report.sync.rulesyncStatus}${rulesyncTimingDetail(report.sync)}`);
  }

  if ((report.sync?.notes.length ?? 0) > 0) {
    lines.push(sectionHeader("Notes"));
    for (const note of report.sync!.notes) lines.push(`${INDENT}${ICONS.neutral} ${note}`);
  }

  if (report.acceptedHooks.length > 0) {
    lines.push(sectionHeader("Trusted Hooks"));
    for (const hook of report.acceptedHooks) lines.push(`${INDENT}${ICONS.neutral} ${hook}`);
  }

  if (report.blockers.length > 0) {
    lines.push(sectionHeader("Needs Attention"));
    for (const item of report.blockers) {
      lines.push(statusRow(toneFromStep(item.severity), `${item.source}: ${friendlyBlockerMessage(item)}`));
      lines.push(`${INDENT}${INDENT}fix: ${item.action}`);
    }
  } else {
    lines.push(sectionHeader("No pending fixes."));
  }

  lines.push(sectionHeader("Files"));
  lines.push(kvRow("report:", relativeReportPath(report.projectRoot, report.files.pass)));
  lines.push(kvRow("dashboard:", relativeReportPath(report.projectRoot, report.files.dashboard)));
  return `${lines.join("\n")}\n`;
}

export function printPassReport(report: PassReport, json = false): void {
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatPassReport(report).trimEnd());
}
