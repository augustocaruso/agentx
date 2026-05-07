import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildInstallerPlan } from "./installer-planner.js";

test("planner contract builds a Mac install plan without executing", () => {
  const projectRoot = path.join("/tmp", "project");
  const homeDir = path.join("/tmp", "home");
  const plan = buildInstallerPlan({
    intent: "install",
    projectRoot,
    homeDir,
    platform: "darwin",
    dryRun: true,
    rulesyncMode: "off",
  });

  assert.equal(plan.intent, "install");
  assert.equal(plan.platform, "darwin");
  assert.equal(plan.homeMode, false);
  assert.equal(plan.dryRun, true);
  assert.deepEqual(plan.delegation, {
    command: "ogb",
    args: ["--project", projectRoot, "install", "--dry-run", "--rulesync", "off"],
  });
  assert.deepEqual(plan.steps.map((step) => [step.id, step.kind, step.writes]), [
    ["cleanup-home-artifacts", "cleanup", false],
    ["apply-global-ux-profile", "setup", false],
    ["run-check", "check", false],
  ]);
});

test("planner contract builds a Windows install plan and exposes adapter details", () => {
  const plan = buildInstallerPlan({
    intent: "install",
    projectRoot: "C:\\Users\\leona\\project",
    homeDir: "C:\\Users\\leona",
    platform: "win32",
    env: { APPDATA: "C:\\Users\\leona\\AppData\\Roaming" },
    force: true,
    windows: true,
  });

  assert.equal(plan.platform, "win32");
  assert.equal(plan.adapter.scriptKind, "powershell");
  assert.equal(plan.adapter.pathSeparator, ";");
  assert.equal(plan.delegation.args.at(-1), "--windows");
  assert.ok(plan.delegation.args.includes("--force"));
});

test("planner contract detects home/global and normalizes quoted paths before comparison", () => {
  const homeDir = path.join("/tmp", "ogb home");
  const plan = buildInstallerPlan({
    intent: "reset",
    projectRoot: `'"${homeDir}"'`,
    homeDir,
    platform: "darwin",
  });

  assert.equal(plan.homeMode, true);
  assert.equal(plan.projectRoot, homeDir);
  assert.equal(plan.safety.destructive, true);
  assert.equal(plan.safety.requiresHome, true);
  assert.equal(plan.steps[0].id, "guard-home-reset");
});

test("planner contract separates project mode from home/global mode", () => {
  const homeDir = path.join("/tmp", "home");
  const projectRoot = path.join(homeDir, "work", "project");
  const plan = buildInstallerPlan({
    intent: "check",
    projectRoot,
    homeDir,
    platform: "darwin",
  });

  assert.equal(plan.homeMode, false);
  assert.equal(plan.projectRoot, projectRoot);
  assert.deepEqual(plan.steps.map((step) => step.kind), ["check"]);
});

test("planner contract builds update and check delegation commands", () => {
  const projectRoot = path.join("/tmp", "project");
  const update = buildInstallerPlan({
    intent: "update",
    projectRoot,
    homeDir: "/tmp/home",
    release: "v1.2.3",
    prefix: "/tmp/prefix",
  });
  const check = buildInstallerPlan({
    intent: "check",
    projectRoot,
    homeDir: "/tmp/home",
    dryRun: true,
  });

  assert.deepEqual(update.delegation.args, ["--project", projectRoot, "update", "--release", "v1.2.3", "--prefix", "/tmp/prefix"]);
  assert.deepEqual(update.steps.map((step) => step.id), ["download-release-pack", "run-post-update-check"]);
  assert.deepEqual(check.delegation.args, ["--project", projectRoot, "check", "--dry-run"]);
});
