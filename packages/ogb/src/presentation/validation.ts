import type { ValidationReport } from "../validation.js";

export function printValidationReport(report: ValidationReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("OpenCode Gemini Bridge Validation");
  console.log(`Project: ${report.projectRoot}`);
  console.log(`Outcome: ${report.outcome}`);
  for (const check of report.checks) console.log(`- ${check.status.toUpperCase()} ${check.name}: ${check.message}`);
}
