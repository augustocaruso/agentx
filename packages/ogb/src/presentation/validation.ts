import type { ValidationReport } from "../validation.js";
import { kvRow, sectionHeader, statusRow } from "./format.js";
import { ICONS, type Tone } from "./theme.js";

function toneFromStatus(status: string): Tone {
  const lower = status.toLowerCase();
  if (lower === "pass" || lower === "ok") return "pass";
  if (lower === "fail" || lower === "error") return "fail";
  if (lower === "warn" || lower === "warning") return "warn";
  return "neutral";
}

export function printValidationReport(report: ValidationReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines: string[] = [];
  lines.push("agentX Validation");
  lines.push(kvRow("Project:", report.projectRoot));
  lines.push(`  Outcome: ${ICONS[toneFromStatus(report.outcome)]} ${report.outcome.toUpperCase()}`);

  if (report.checks.length > 0) {
    lines.push(sectionHeader("Checks"));
    for (const check of report.checks) {
      lines.push(statusRow(toneFromStatus(check.status), `${check.name}: ${check.message}`));
    }
  }
  console.log(lines.join("\n"));
}
