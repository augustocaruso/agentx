import { cleanupHomeProjectArtifacts, type HomeCleanupReport } from "./home-cleanup.js";
import { runPass, type PassReport } from "./pass.js";
import { resolveProjectPaths } from "./paths.js";
import { setupUx, type SetupUxReport } from "./setup-ux.js";
import { OGB_VERSION } from "./types.js";

export interface InstallOptions {
  projectRoot?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  force?: boolean;
  resetGlobal?: boolean;
  installOpenCode?: boolean;
  installPlugins?: boolean;
  installTuiDependencies?: boolean;
  writeProjectProfile?: boolean;
  cleanupHome?: boolean;
  check?: boolean;
  acceptHooks?: boolean;
  windows?: boolean;
}

export interface InstallReport {
  version: string;
  projectRoot: string;
  homeDir: string;
  homeMode: boolean;
  outcome: "pass" | "warn" | "fail" | "preview";
  cleanup?: HomeCleanupReport;
  setup: SetupUxReport;
  check?: PassReport;
  warnings: string[];
}

function installOutcome(options: InstallOptions, warnings: string[], check?: PassReport): InstallReport["outcome"] {
  if (options.dryRun) return "preview";
  if (check?.outcome) return check.outcome;
  return warnings.length > 0 ? "warn" : "pass";
}

export function runInstall(options: InstallOptions = {}): InstallReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const cleanup = options.cleanupHome === false
    ? undefined
    : cleanupHomeProjectArtifacts({ homeDir: paths.homeDir, dryRun: options.dryRun });
  const setup = setupUx({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    platform: options.platform,
    env: options.env,
    dryRun: options.dryRun,
    force: options.force,
    resetGlobal: options.resetGlobal,
    installOpenCode: options.installOpenCode,
    installPlugins: options.installPlugins,
    installTuiDependencies: options.installTuiDependencies,
    writeProjectProfile: options.writeProjectProfile,
  });
  const check = options.dryRun || options.check === false
    ? undefined
    : runPass({
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      dryRun: options.dryRun,
      force: options.force,
      acceptHooks: options.acceptHooks,
      windows: options.windows,
      silent: true,
      setExitCode: false,
    });
  const warnings = [
    ...(cleanup?.warnings ?? []),
    ...setup.warnings,
    ...(check?.blockers.filter((blocker) => blocker.severity === "warn").map((blocker) => `${blocker.source}: ${blocker.message}`) ?? []),
  ];

  return {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    homeMode: paths.homeMode,
    outcome: installOutcome(options, warnings, check),
    cleanup,
    setup,
    check,
    warnings,
  };
}

function outcomeLabel(outcome: InstallReport["outcome"]): string {
  if (outcome === "preview") return "PREVIEW";
  return outcome.toUpperCase();
}

export function printInstallReport(report: InstallReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const title = report.outcome === "preview"
    ? "OpenCode Gemini Bridge install preview"
    : "OpenCode Gemini Bridge install complete";
  console.log(title);
  console.log(`Project: ${report.projectRoot}`);
  console.log(`Mode: ${report.homeMode ? "home/global" : "project"}`);
  if (report.cleanup) {
    console.log(`Cleanup: ${report.cleanup.actions.length} action(s)${report.cleanup.backupDir ? `, backup ${report.cleanup.backupDir}` : ""}`);
  }
  const writes = report.setup.writes.filter((write) => write.status !== "unchanged").length;
  const commands = report.setup.commands.filter((command) => command.status !== "skipped").length;
  console.log(`Global UX: ${writes} changed/previewed write(s), ${commands} command(s)`);
  if (report.check) {
    console.log(`Check: ${outcomeLabel(report.check.outcome)}`);
    console.log(`Report: ${report.check.files.pass}`);
    console.log(`Dashboard: ${report.check.files.dashboard}`);
  } else {
    console.log("Check: skipped");
  }
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}
