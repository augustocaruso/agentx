import type { SecurityReport } from "../security.js";

export function printSecurityReport(report: SecurityReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("OpenCode Gemini Bridge Security Check");
  console.log(`Project: ${report.projectRoot}`);
  console.log(`Outcome: ${report.outcome}`);
  for (const finding of report.findings) console.log(`- ${finding.status.toUpperCase()} ${finding.name}: ${finding.message}`);
}
