import { DISPLAY } from "./brand.js";
import { resolveProjectPaths } from "./paths.js";
import { syncToOpenCode, type SyncReport } from "./sync.js";
import { AGENTX_VERSION } from "./types.js";

export interface StartupSyncOptions {
  projectRoot?: string;
  homeDir?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface StartupSyncReport {
  version: string;
  projectRoot: string;
  homeMode: boolean;
  outcome: "pass" | "fail";
  sync?: SyncReport;
  warnings: string[];
  errors: string[];
}

export function runStartupSync(options: StartupSyncOptions = {}): StartupSyncReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const sync = syncToOpenCode({
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      dryRun: options.dryRun,
      force: options.force,
      silent: true,
      rulesyncMode: "off",
    });
    warnings.push(...sync.warnings);
    return {
      version: AGENTX_VERSION,
      projectRoot: paths.projectRoot,
      homeMode: paths.homeMode,
      outcome: "pass",
      sync,
      warnings,
      errors,
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return {
      version: AGENTX_VERSION,
      projectRoot: paths.projectRoot,
      homeMode: paths.homeMode,
      outcome: "fail",
      warnings,
      errors,
    };
  }
}

export function printStartupSyncReport(report: StartupSyncReport, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`${DISPLAY} startup sync: ${report.outcome.toUpperCase()}`);
  console.log(`Project: ${report.projectRoot}`);
  if (report.homeMode) console.log("Mode: global home profile");
  if (report.sync) {
    console.log(`Commands: ${report.sync.projectedCommands.length}`);
    console.log(`Agents: ${report.sync.projectedAgents.length + report.sync.projectedExtensionAgents.length}`);
    console.log(`Skills: ${report.sync.projectedSkills.length}`);
  }
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  for (const error of report.errors) console.error(`Error: ${error}`);
}
