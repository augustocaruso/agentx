import type { DoctorReport } from "../doctor.js";

export function printDoctorReport(report: DoctorReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("OpenCode Gemini Bridge Doctor");
  console.log(`Project: ${report.projectRoot}`);
  console.log(`GEMINI.md files: ${report.counts.geminiFiles}`);
  console.log(`Imports: ${report.counts.imports.ok} ok, ${report.counts.imports.warning} warning`);
  console.log(`Skills: ${report.counts.skills.ok} ok, ${report.counts.skills.warning} warning`);
  console.log(`MCPs: ${report.counts.mcps.ok} ok, ${report.counts.mcps.needs_review} needs review`);
  console.log(`Agents: ${report.counts.agents.ok} ok, ${report.counts.agents.needs_review} needs review`);
  console.log(`Commands: ${report.counts.commands.ok} ok, ${report.counts.commands.needs_review} needs review`);
  console.log(`Extension commands: ${report.extensionCompatibility.projectedCommands} projected`);
  console.log(`Model routing: ${report.extensionCompatibility.modelRoutingReport ? `${report.extensionCompatibility.modelRoutingDecisions} decision(s), ${report.extensionCompatibility.modelRoutingRouted} routed` : "missing"}`);
  console.log(`Runtime fallback: ${report.runtimeFallback.configured ? `${report.runtimeFallback.pluginActive ? "plugin active" : "plugin missing"}, config ${report.runtimeFallback.configExists ? "present" : "missing"}, ${report.runtimeFallback.agentFallbacks} agent chain(s)` : "disabled"}`);
  console.log(`Native capabilities: ${report.nativeCapabilities.reportExists ? `${report.nativeCapabilities.validatedNative.length} native, ${report.nativeCapabilities.fallbackCompat.length} fallback, ${report.nativeCapabilities.setupCompatibilityProjections.length} setup projection(s)` : "missing"}`);
  console.log(`Model resolution: ${report.modelResolution.message}`);
  console.log(`Generated files: ${report.generated.expandedGeminiVersion ?? "missing context"}, ${report.generated.generatedConfigVersion ?? "missing config"}`);
  console.log(`Startup sync: project ${report.startupSync.projectPlugin && report.startupSync.projectConfig ? "installed" : "missing"}, global ${report.startupSync.globalPlugin && report.startupSync.globalConfig ? "installed" : "missing"}${report.startupSync.lastState ? `, last ${report.startupSync.lastState}` : ""}`);
  console.log(`Rulesync: ${report.rulesync.available ? `available${report.rulesync.version ? ` (${report.rulesync.version})` : ""}` : "unavailable"}`);
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}
