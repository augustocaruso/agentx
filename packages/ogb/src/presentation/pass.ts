import path from "node:path";
import type { PassBlocker, PassReport, PassStep, PassSyncSummary } from "../pass.js";

function statusText(status: PassStep["status"] | PassReport["outcome"] | PassBlocker["severity"]): string {
  if (status === "pass") return "OK";
  if (status === "fail") return "FAIL";
  return "WARN";
}

function stepStatusDetail(step: PassStep): string {
  return step.detail ? `  ${step.detail}` : "";
}

function relativeReportPath(projectRoot: string, filePath: string): string {
  const rel = path.relative(projectRoot, filePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return filePath;
  return rel;
}

function plural(count: number, singular: string, pluralText = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralText}`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
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
    plural(sync.builtInCommands, "comando"),
    plural(sync.extensionCommands, "comando de extensao", "comandos de extensao"),
    plural(sync.skills, "skill"),
  ].filter((item) => !item.startsWith("0 "));
  return parts.length > 0 ? parts.join(", ") : "sem arquivos projetados";
}

function friendlyBlockerMessage(item: PassBlocker): string {
  if (/opencode-auto-fallback.*plugin is not active/i.test(item.message)) {
    return "Auto fallback esta ligado, mas o plugin externo nao carregou.";
  }
  if (item.source === "validation" && item.severity === "warn") return "Validation encontrou avisos.";
  if (item.source === "security" && item.severity === "warn") return "Security-check encontrou avisos.";
  if (item.source === "dashboard" && item.severity === "warn") return "Dashboard herdou avisos dos checks anteriores.";
  if (item.source === "patch" && item.severity === "warn") return "Um patch OGB precisa de revisao.";
  return item.message;
}

export function formatPassReport(report: PassReport): string {
  const lines = [
    `OGB check ${statusText(report.outcome)}`,
    `Project   ${report.projectRoot}`,
    ...(report.timing ? [`Duration  ${formatDuration(report.timing.durationMs)}`] : []),
    "",
    "Checks",
    ...report.steps.map((step) => `  ${statusText(step.status).padEnd(5)} ${step.name}${stepStatusDetail(step)}`),
  ];

  if (report.sync) {
    lines.push(
      "",
      "Sync",
      `  ${syncSummaryLine(report.sync)}`,
      `  rulesync: ${report.sync.rulesyncStatus}${rulesyncTimingDetail(report.sync)}`,
    );
  }

  if ((report.sync?.notes.length ?? 0) > 0) {
    lines.push("", "Notes");
    for (const note of report.sync!.notes) lines.push(`- ${note}`);
  }

  if (report.acceptedHooks.length > 0) {
    lines.push("", "Trusted Hooks");
    for (const hook of report.acceptedHooks) lines.push(`- ${hook}`);
  }

  if (report.blockers.length > 0) {
    lines.push("", "Needs Attention");
    for (const item of report.blockers) {
      lines.push(`  ${statusText(item.severity).padEnd(5)} ${item.source}: ${friendlyBlockerMessage(item)}`);
      lines.push(`        fix: ${item.action}`);
    }
  } else {
    lines.push("", "No pending fixes.");
  }

  lines.push(
    "",
    "Files",
    `  report:    ${relativeReportPath(report.projectRoot, report.files.pass)}`,
    `  dashboard: ${relativeReportPath(report.projectRoot, report.files.dashboard)}`,
  );
  return `${lines.join("\n")}\n`;
}

export function printPassReport(report: PassReport, json = false): void {
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatPassReport(report).trimEnd());
}
