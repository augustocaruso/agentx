import os from "node:os";
import { createPlatformAdapter, type PlatformAdapter } from "./platform-adapter.js";
import type { RulesyncMode } from "./rulesync.js";

export type InstallerIntent = "install" | "update" | "check" | "reset";

export interface InstallerPlanInput {
  intent: InstallerIntent;
  projectRoot?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  force?: boolean;
  release?: string;
  prefix?: string;
  rulesyncMode?: RulesyncMode;
  windows?: boolean;
}

export interface InstallerPlanStep {
  id: string;
  kind: "cleanup" | "setup" | "sync" | "check" | "update" | "reset" | "guard";
  writes: boolean;
  command?: {
    tool: "ogb";
    args: string[];
  };
}

export interface InstallerPlan {
  intent: InstallerIntent;
  projectRoot: string;
  homeDir: string;
  homeMode: boolean;
  platform: PlatformAdapter["platform"];
  dryRun: boolean;
  adapter: Pick<
    PlatformAdapter,
    "scriptKind"
    | "pathSeparator"
    | "globalConfigDir"
    | "globalConfigFiles"
    | "legacyGlobalConfigDir"
    | "bridgeConfigDir"
    | "generatedDir"
    | "defaultInstallPrefix"
    | "npmGlobalDir"
    | "shellCommand"
    | "powershellCommands"
  >;
  delegation: {
    command: "ogb";
    args: string[];
  };
  steps: InstallerPlanStep[];
  safety: {
    destructive: boolean;
    requiresHome: boolean;
    normalizedProjectInput: string;
  };
}

function baseDelegationArgs(plan: { projectRoot: string }, intent: InstallerIntent, input: InstallerPlanInput): string[] {
  const args = ["--project", plan.projectRoot, intent];
  if (input.dryRun) args.push("--dry-run");
  if (input.force) args.push("--force");
  if (input.rulesyncMode) args.push("--rulesync", input.rulesyncMode);
  if (input.windows) args.push("--windows");
  if (intent === "update" && input.release) args.push("--release", input.release);
  if (intent === "update" && input.prefix) args.push("--prefix", input.prefix);
  return args;
}

function step(id: string, kind: InstallerPlanStep["kind"], writes: boolean, command?: InstallerPlanStep["command"]): InstallerPlanStep {
  return { id, kind, writes, command };
}

export function buildInstallerPlan(input: InstallerPlanInput): InstallerPlan {
  const homeAdapter = createPlatformAdapter({
    platform: input.platform,
    homeDir: input.homeDir ?? os.homedir(),
    env: input.env,
  });
  const projectRoot = input.projectRoot ? homeAdapter.resolvePath(input.projectRoot) : homeAdapter.resolvePath(process.cwd());
  const homeDir = homeAdapter.homeDir;
  const homeMode = homeAdapter.isHomeProject(projectRoot);
  const adapter = createPlatformAdapter({
    platform: input.platform,
    homeDir,
    env: input.env,
  });
  const dryRun = input.dryRun === true;
  const delegationArgs = baseDelegationArgs({ projectRoot }, input.intent, input);
  const command = { tool: "ogb" as const, args: delegationArgs };
  const writes = !dryRun;
  const steps: InstallerPlanStep[] = [];

  if (input.intent === "install") {
    steps.push(step("cleanup-home-artifacts", "cleanup", writes));
    steps.push(step("apply-global-ux-profile", "setup", writes));
    steps.push(step("run-check", "check", writes, command));
  } else if (input.intent === "update") {
    steps.push(step("download-release-pack", "update", writes));
    steps.push(step("run-post-update-check", "check", writes, { tool: "ogb", args: ["--project", projectRoot, "check", "--force", "--no-extension-update", ...(input.windows ? ["--windows"] : [])] }));
  } else if (input.intent === "check") {
    steps.push(step("run-check", "check", writes, command));
  } else {
    steps.push(step("guard-home-reset", "guard", false));
    steps.push(step("cleanup-home-artifacts", "cleanup", writes));
    steps.push(step("reset-global-profile", "reset", writes));
    steps.push(step("run-check", "check", writes, { tool: "ogb", args: ["--project", projectRoot, "check", "--force", ...(input.windows ? ["--windows"] : [])] }));
  }

  return {
    intent: input.intent,
    projectRoot,
    homeDir,
    homeMode,
    platform: adapter.platform,
    dryRun,
    adapter: {
      scriptKind: adapter.scriptKind,
      pathSeparator: adapter.pathSeparator,
      globalConfigDir: adapter.globalConfigDir,
      globalConfigFiles: adapter.globalConfigFiles,
      legacyGlobalConfigDir: adapter.legacyGlobalConfigDir,
      bridgeConfigDir: adapter.bridgeConfigDir,
      generatedDir: adapter.generatedDir,
      defaultInstallPrefix: adapter.defaultInstallPrefix,
      npmGlobalDir: adapter.npmGlobalDir,
      shellCommand: adapter.shellCommand,
      powershellCommands: adapter.powershellCommands,
    },
    delegation: {
      command: "ogb",
      args: delegationArgs,
    },
    steps,
    safety: {
      destructive: input.intent === "reset",
      requiresHome: input.intent === "reset",
      normalizedProjectInput: projectRoot,
    },
  };
}
