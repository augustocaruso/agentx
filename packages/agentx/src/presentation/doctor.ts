import type { DoctorReport } from "../doctor.js";
import { kvRow, sectionHeader, statusRow } from "./format.js";
import { ICONS, INDENT, type Tone } from "./theme.js";

function toneFromStatus(status: string): Tone {
  const lower = status.toLowerCase();
  if (lower === "ok" || lower === "pass") return "pass";
  if (lower === "error" || lower === "fail" || lower === "missing") return "fail";
  if (lower === "warning" || lower === "warn" || lower === "needs_review") return "warn";
  return "neutral";
}

export function printDoctorReport(report: DoctorReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines: string[] = [];
  lines.push("agentX Doctor");
  lines.push(kvRow("Project:", report.projectRoot));

  lines.push(sectionHeader("Resources"));
  lines.push(`${INDENT}GEMINI.md files: ${report.counts.geminiFiles}`);
  lines.push(`${INDENT}Imports: ${report.counts.imports.ok} ok, ${report.counts.imports.warning} warning`);
  lines.push(`${INDENT}Skills: ${report.counts.skills.ok} ok, ${report.counts.skills.warning} warning`);
  lines.push(`${INDENT}MCPs: ${report.counts.mcps.ok} ok, ${report.counts.mcps.needs_review} needs review`);
  lines.push(`${INDENT}Agents: ${report.counts.agents.ok} ok, ${report.counts.agents.needs_review} needs review`);
  lines.push(`${INDENT}Commands: ${report.counts.commands.ok} ok, ${report.counts.commands.needs_review} needs review`);
  lines.push(`${INDENT}Extension commands: ${report.extensionCompatibility.projectedCommands} projected`);

  lines.push(sectionHeader("Integration"));
  lines.push(`${INDENT}Model routing: ${report.extensionCompatibility.modelRoutingReport ? `${report.extensionCompatibility.modelRoutingDecisions} decision(s), ${report.extensionCompatibility.modelRoutingRouted} routed` : "missing"}`);
  lines.push(`${INDENT}Runtime fallback: ${report.runtimeFallback.configured ? `${report.runtimeFallback.pluginActive ? "plugin active" : "plugin missing"}, config ${report.runtimeFallback.configExists ? "present" : "missing"}, ${report.runtimeFallback.agentFallbacks} agent chain(s)` : "disabled"}`);
  lines.push(`${INDENT}Native capabilities: ${report.nativeCapabilities.reportExists ? `${report.nativeCapabilities.validatedNative.length} native, ${report.nativeCapabilities.fallbackCompat.length} fallback, ${report.nativeCapabilities.setupCompatibilityProjections.length} setup projection(s)` : "missing"}`);
  lines.push(`${INDENT}Model resolution: ${report.modelResolution.message}`);
  lines.push(`${INDENT}Generated files: ${report.generated.expandedGeminiVersion ?? "missing context"}, ${report.generated.generatedConfigVersion ?? "missing config"}`);
  lines.push(`${INDENT}Startup sync: project ${report.startupSync.projectPlugin && report.startupSync.projectConfig ? "installed" : "missing"}, global ${report.startupSync.globalPlugin && report.startupSync.globalConfig ? "installed" : "missing"}${report.startupSync.lastState ? `, last ${report.startupSync.lastState}` : ""}`);
  lines.push(`${INDENT}Rulesync: ${report.rulesync.available ? `available${report.rulesync.version ? ` (${report.rulesync.version})` : ""}` : "unavailable"}`);

  if (report.warnings.length > 0) {
    lines.push(sectionHeader("Warnings"));
    for (const warning of report.warnings) lines.push(`${INDENT}${ICONS.warn} ${warning}`);
  }
  console.log(lines.join("\n"));
}
