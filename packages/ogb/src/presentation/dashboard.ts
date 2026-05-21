import type { DashboardReport } from "../dashboard.js";
import type { StatusCounts } from "../types.js";

function total(counts: StatusCounts): number {
  return counts.ok + counts.warning + counts.needs_review + counts.error;
}

function formatMs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "tempo desconhecido";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function statusLabel(status: string): string {
  return status.toUpperCase();
}

function firstLines(items: string[], max = 6): string[] {
  if (items.length <= max) return items;
  return [...items.slice(0, max), `...mais ${items.length - max}`];
}

export function formatDashboard(report: DashboardReport): string {
  const startup = report.startupSync.lastState === "unknown"
    ? "sem execucao registrada"
    : `${statusLabel(report.startupSync.lastState)}${report.startupSync.lastFinishedAt ? ` em ${report.startupSync.lastFinishedAt}` : ""}${report.startupSync.lastDurationMs ? ` (${formatMs(report.startupSync.lastDurationMs)})` : ""}${report.startupSync.nextRetryAfter ? `, retry after ${report.startupSync.nextRetryAfter}` : ""}`;
  const modelRouting = report.extensionCompatibility.modelRoutingReport
    ? `OGB ${report.extensionCompatibility.modelRoutingEnabled ? "active" : "disabled"}, ${report.extensionCompatibility.modelRoutingDecisions} decision(s)${report.extensionCompatibility.modelRoutingRouted > 0 ? `, ${report.extensionCompatibility.modelRoutingRouted} routed` : ""}${report.extensionCompatibility.modelRoutingSkipped > 0 ? `, ${report.extensionCompatibility.modelRoutingSkipped} skipped` : ""}`
    : "missing - run `ogb sync`";
  const update = report.update.exists
    ? `${statusLabel(report.update.status)}${report.update.latestTag ? ` ${report.update.latestTag}` : ""}${report.update.restartRequired ? " - restart OpenCode" : ""}`
    : "MISSING - checked on next startup";
  const telemetry = report.telemetry.ready
    ? `READY - ${report.telemetry.payloadLevel}, outbox ${report.telemetry.outboxCount}, sent runs ${report.telemetry.sentRunCount}`
    : report.telemetry.enabled
      ? `ENABLED but not ready - outbox ${report.telemetry.outboxCount}`
      : `DISABLED${report.telemetry.outboxCount > 0 ? ` - outbox ${report.telemetry.outboxCount}` : ""}`;

  const lines = [
    "OpenCode Gemini Bridge Dashboard",
    `Project: ${report.projectRoot}`,
    `Outcome: ${statusLabel(report.outcome)}`,
    "",
    "Resumo:",
    `- Gemini context: ${report.resources.geminiFiles} GEMINI.md, context ${report.generated.contextVersion ?? "missing"}, config ${report.generated.configVersion ?? "missing"}`,
    `- OpenCode: ${total(report.resources.mcps)} MCPs, ${total(report.resources.skills)} skills, ${total(report.resources.agents)} agent(s), ${total(report.resources.commands)} commands`,
    `- Extensions: ${report.extensionCompatibility.extensions} extension(s), ${report.extensionCompatibility.projectedCommands} command(s), ${report.extensionCompatibility.availableAgents} agent(s) mapped`,
    `- Model routing: ${report.extensionCompatibility.modelFallbacks} configured agent(s), ${modelRouting}`,
    `- Runtime fallback: ${report.runtimeFallback.configured ? `${report.runtimeFallback.pluginActive ? "plugin active" : "plugin missing"}, config ${report.runtimeFallback.configExists ? "present" : "missing"}, ${report.runtimeFallback.agentFallbacks} agent chain(s), retries ${report.runtimeFallback.maxRetries ?? "n/a"}, cooldown ${report.runtimeFallback.cooldownMs ?? "n/a"}ms` : "disabled"}`,
    `- Model resolution: ${report.modelResolution.message}`,
    `- Extension hooks/scripts: ${report.extensionCompatibility.hooks} hook file(s) synced by OGB when compatible, ${report.extensionCompatibility.scripts} script(s) review-only`,
    `- Rulesync: ${report.rulesync.available ? `available${report.rulesync.version ? ` ${report.rulesync.version}` : ""}` : "unavailable"}${report.rulesync.lastStatus ? `, last ${report.rulesync.lastStatus}` : ""}`,
    `- Startup sync: ${startup}`,
    `- OGB update: ${update}`,
    `- Telemetry: ${telemetry}`,
    `- Usage limits: ${report.limits.exists ? `${statusLabel(report.limits.status)} - ${report.limits.providers} provider(s), OpenUsage ${report.limits.openusage}, OpenAI ${report.limits.openaiChatGPT}, Claude ${report.limits.anthropicClaude}, Gemini ${report.limits.geminiCodeAssist}` : "MISSING - run `ogb limits` or `/bridge`"}`,
    "",
    "Checks:",
    `- Doctor: ${statusLabel(report.reports.doctor.status)} - ${report.reports.doctor.message}`,
    `- Validation: ${statusLabel(report.reports.validation.status)} - ${report.reports.validation.message}`,
    `- Security: ${statusLabel(report.reports.security.status)} - ${report.reports.security.message}`,
  ];

  if (report.warnings.length > 0) {
    lines.push("", "Avisos:");
    for (const warning of firstLines(report.warnings)) lines.push(`- ${warning}`);
  }

  if (report.errors.length > 0) {
    lines.push("", "Erros:");
    for (const error of firstLines(report.errors)) lines.push(`- ${error}`);
  }

  lines.push("", "Proximos passos:");
  for (const step of report.nextSteps) lines.push(`- ${step}`);

  return `${lines.join("\n")}\n`;
}

export function printDashboard(report: DashboardReport, json = false): void {
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatDashboard(report).trimEnd());
}
