import type { SecurityReport } from "../security.js";
import { kvRow, sectionHeader, statusRow } from "./format.js";
import { ICONS, type Tone } from "./theme.js";

function toneFromStatus(status: string): Tone {
  const lower = status.toLowerCase();
  if (lower === "pass" || lower === "ok") return "pass";
  if (lower === "fail" || lower === "error") return "fail";
  if (lower === "warn" || lower === "warning") return "warn";
  return "neutral";
}

export function printSecurityReport(report: SecurityReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines: string[] = [];
  lines.push("agentX Security Check");
  lines.push(kvRow("Project:", report.projectRoot));
  lines.push(`  Outcome: ${ICONS[toneFromStatus(report.outcome)]} ${report.outcome.toUpperCase()}`);

  if (report.findings.length > 0) {
    lines.push(sectionHeader("Findings"));
    for (const finding of report.findings) {
      lines.push(statusRow(toneFromStatus(finding.status), `${finding.name}: ${finding.message}`));
    }
  }
  console.log(lines.join("\n"));
}
