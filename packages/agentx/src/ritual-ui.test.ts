import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildInstallerPlan } from "./installer-planner.js";
import { applyRitualProgressEvent, createLiveRitualModel, failLiveRitualModel, finishLiveRitualModel, ritualViewModel, shouldAnimateRitualUi, shouldUseRitualUi } from "./ritual-view-model.js";
import { DISPLAY } from "./brand.js";
import type { InstallReport } from "./install.js";
import type { PassReport } from "./pass.js";
import type { ResetReport } from "./reset.js";
import type { SelfUpdateReport } from "./self-update.js";

const projectRoot = "/tmp/ogb-project";
const homeDir = "/tmp/ogb-home";
const noisyBootstrapTail = [
  "% Total    % Received % Xferd  Average Speed   Time    Time     Time  Current",
  "                                 Dload  Upload   Total   Spent    Left  Speed",
  "\r  0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0",
  "\r100  817k  100  817k    0     0   484k      0  0:00:01  0:00:01 --:--:-- 1261k",
  "npm warn deprecated koa-router@14.0.0: Please use @koa/router instead, starting from v9!",
  "sync: Antigravity skill conflict: .gemini/antigravity/skills/process-medical-chats was edited manually; use --force to overwrite",
].join("\n");

test("interactive ritual UI is backed by Ink, with the line printer only as fallback", () => {
  const source = readFileSync(new URL("./ui/ink/ritual-ui.ts", import.meta.url), "utf8");

  assert.match(source, /from "ink"/);
  assert.match(source, /\brender\(/);
  assert.match(source, /function shouldUseLogFallback/);
  assert.match(source, /new RitualLogPrinter/);
});

function passReport(overrides: Partial<PassReport> = {}): PassReport {
  return {
    version: "0.0.61",
    projectRoot,
    outcome: "pass",
    plan: buildInstallerPlan({ intent: "check", projectRoot, homeDir }),
    automated: ["setup-opencode", "sync", "doctor", "validate", "security-check", "dashboard"],
    steps: [
      { name: "setup-opencode", status: "pass" },
      { name: "sync", status: "pass" },
      { name: "doctor", status: "pass" },
      { name: "validate", status: "pass" },
      { name: "security-check", status: "pass" },
      { name: "dashboard", status: "pass" },
    ],
    acceptedHooks: [],
    blockers: [],
    sync: {
      generatedConfigPath: `${projectRoot}/.opencode/generated/opencode.generated.json`,
      builtInAgents: 1,
      extensionAgents: 6,
      builtInCommands: 2,
      extensionCommands: 15,
      skills: 17,
      tuiFiles: 2,
      externalIntegrationFiles: 3,
      rulesyncStatus: "applied",
      rulesyncPromoted: 0,
      notes: [],
    },
    doctor: { warnings: 0, errors: 0 },
    validation: { outcome: "pass" },
    security: { outcome: "pass" },
    dashboard: { outcome: "pass" },
    files: {
      pass: `${projectRoot}/.opencode/generated/agentx-pass.json`,
      doctor: `${projectRoot}/.opencode/generated/agentx-doctor.json`,
      dashboard: `${projectRoot}/.opencode/generated/agentx-dashboard.md`,
    },
    ...overrides,
  };
}

test("live ritual progress is opt-in to an interactive human terminal", () => {
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: {} }), true);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: false, env: {} }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, json: true, env: {} }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, plain: true, env: {} }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, progressJson: true, env: {} }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { CI: "true" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { CODEX_CI: "1" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { CODEX_SHELL: "1" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { TERM: "dumb" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, stdoutColumns: 79, env: {} }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, stdoutColumns: 80, env: {} }), true);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { OGB_PLAIN: "1" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { OGB_UI: "0" } }), false);
});

test("ritual UI animation is on by default but can be disabled", () => {
  assert.equal(shouldAnimateRitualUi({}), true);
  assert.equal(shouldAnimateRitualUi({ OGB_UI_ANIMATE: "1" }), true);
  assert.equal(shouldAnimateRitualUi({ OGB_UI_ANIMATE: "0" }), false);
});

test("live progress model starts with every todo queued", () => {
  const model = createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin" },
    { stepId: "sync", label: "sync bridge assets" },
    { stepId: "doctor", label: "run doctor" },
  ], { now: 1000 });

  assert.equal(model.title, `${DISPLAY} check`);
  assert.equal(model.subtitle, projectRoot);
  assert.equal(model.statusLabel, "RUN");
  assert.equal(model.currentStepId, "setup");
  assert.equal(model.final, false);
  assert.deepEqual(model.steps.map((step) => step.label), ["setup OpenCode plugin", "sync bridge assets", "run doctor"]);
  assert.deepEqual(model.steps.map((step) => step.status), ["queued", "queued", "queued"]);
});

test("terminal ritual titles use the current product brand", () => {
  assert.equal(createLiveRitualModel("install", projectRoot, [], { now: 1000 }).title, `${DISPLAY} install`);
  assert.equal(createLiveRitualModel("update", projectRoot, [], { now: 1000 }).title, `${DISPLAY} update`);
  assert.equal(ritualViewModel("check", passReport()).title, `${DISPLAY} check`);
});

test("live progress events update the active todo without creating a second report model", () => {
  let model = createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin", detail: "wire plugin" },
    { stepId: "sync", label: "sync bridge assets", detail: "project resources" },
  ], { now: 1000 });

  model = applyRitualProgressEvent(model, {
    stepId: "setup",
    label: "setup OpenCode plugin",
    detail: "wire plugin",
    status: "running",
    message: "Checking plugin file.",
  });
  model = applyRitualProgressEvent(model, {
    stepId: "setup",
    label: "setup OpenCode plugin",
    status: "pass",
    message: "Startup sync wiring is present.",
  });
  model = applyRitualProgressEvent(model, {
    stepId: "sync",
    label: "sync bridge assets",
    status: "running",
  });

  assert.equal(model.currentStepId, "sync");
  assert.deepEqual(model.steps.map((step) => [step.stepId, step.status]), [
    ["setup", "pass"],
    ["sync", "running"],
  ]);
  assert.match(model.steps[0].message ?? "", /Startup sync/);
});

test("live progress model compacts noisy release install output before rendering", () => {
  const model = applyRitualProgressEvent(createLiveRitualModel("update", projectRoot, [
    { stepId: "install", label: "Install the selected agentX release." },
  ], { now: 1000 }), {
    stepId: "install",
    label: "Install the selected agentX release.",
    status: "fail",
    message: noisyBootstrapTail,
  });

  const message = model.steps[0].message ?? "";
  assert.match(message, /koa-router/);
  assert.doesNotMatch(message, /% Total|--:--:--|\r/);
  assert.ok(message.length <= 280);
});

test("finishing the live progress model turns the same todo list into the final report", () => {
  let model = createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin" },
    { stepId: "sync", label: "sync bridge assets" },
    { stepId: "doctor", label: "run doctor" },
    { stepId: "validate", label: "validate config" },
    { stepId: "security", label: "security guardrails" },
    { stepId: "dashboard", label: "dashboard summary" },
  ], { now: 1000 });
  for (const step of model.steps) {
    model = applyRitualProgressEvent(model, { ...step, status: "pass" });
  }

  const finished = finishLiveRitualModel(model, passReport(), { now: 3000 });

  assert.equal(finished.final, true);
  assert.equal(finished.statusLabel, "PASS");
  assert.equal(finished.finishedAt, 3000);
  assert.deepEqual(finished.steps.map((step) => step.status), ["pass", "pass", "pass", "pass", "pass", "pass"]);
  assert.deepEqual(finished.metrics.map((metric) => [metric.label, metric.value]), [
    ["automated", "6"],
    ["skills", "17"],
    ["commands", "17"],
    ["agents", "7"],
    ["blockers", "0"],
  ]);
  assert.ok(finished.next.some((item) => /Bridge is clean/.test(item)));
});

test("live progress model turns thrown errors into a visible failed todo", () => {
  const started = applyRitualProgressEvent(createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin" },
  ], { now: 1000 }), {
    stepId: "setup",
    label: "setup OpenCode plugin",
    status: "running",
  });

  const failed = failLiveRitualModel(started, new Error("boom"), { now: 2000 });

  assert.equal(failed.final, true);
  assert.equal(failed.statusLabel, "FAIL");
  assert.equal(failed.steps[0].status, "fail");
  assert.match(failed.callouts[0], /boom/);
  assert.match(failed.next[0], /plain/);
});

test("unexpected command errors get PATH-specific next actions", () => {
  const started = applyRitualProgressEvent(createLiveRitualModel("update", projectRoot, [
    { stepId: "install", label: "apply installer" },
  ], { now: 1000 }), {
    stepId: "install",
    label: "apply installer",
    status: "running",
  });

  const failed = failLiveRitualModel(started, new Error("ENOENT: opencode.cmd not found"), { now: 2000 });

  assert.match(failed.next[0], /PATH/);
  assert.match(failed.next[1], /agentx update --plain/);
});

test("check ritual view model highlights projected bridge assets", () => {
  const model = ritualViewModel("check", passReport({
    timing: {
      durationMs: 1234,
      steps: [],
    },
    sync: {
      generatedConfigPath: `${projectRoot}/.opencode/generated/opencode.generated.json`,
      builtInAgents: 1,
      extensionAgents: 6,
      builtInCommands: 2,
      extensionCommands: 15,
      skills: 17,
      tuiFiles: 2,
      externalIntegrationFiles: 3,
      rulesyncStatus: "applied",
      rulesyncPromoted: 0,
      rulesyncDurationMs: 842,
      notes: [],
    },
  }));

  assert.equal(model.title, `${DISPLAY} check`);
  assert.equal(model.statusLabel, "PASS");
  assert.deepEqual(model.metrics.map((metric) => [metric.label, metric.value]), [
    ["automated", "6"],
    ["duration", "1.2s"],
    ["rulesync", "842ms"],
    ["skills", "17"],
    ["commands", "17"],
    ["agents", "7"],
    ["blockers", "0"],
  ]);
  assert.ok(model.next.some((item) => /Bridge is clean/.test(item)));
});

test("check ritual view model keeps blocker actions visible", () => {
  const model = ritualViewModel("check", passReport({
    outcome: "warn",
    blockers: [{
      severity: "warn",
      source: "doctor",
      message: "MCP command warning: browsermcp - Command not found on PATH: npx",
      action: "Install npx or remove the MCP.",
    }],
  }));

  assert.equal(model.statusLabel, "WARN");
  assert.match(model.callouts[0], /browsermcp/);
  assert.equal(model.next[0], "Install npx or remove the MCP.");
});

test("check ritual view model surfaces non-blocking sync notes", () => {
  const model = ritualViewModel("check", passReport({
    sync: {
      generatedConfigPath: `${projectRoot}/.opencode/generated/opencode.generated.json`,
      builtInAgents: 1,
      extensionAgents: 6,
      builtInCommands: 2,
      extensionCommands: 15,
      skills: 17,
      tuiFiles: 2,
      externalIntegrationFiles: 3,
      rulesyncStatus: "applied",
      rulesyncPromoted: 0,
      notes: ["Antigravity skill skipped: defuddle (untrusted mount point)."],
    },
  }));

  assert.equal(model.statusLabel, "PASS");
  assert.equal(model.metrics.find((metric) => metric.label === "blockers")?.value, "0");
  assert.match(model.callouts.join("\n"), /Antigravity skill skipped: defuddle/);
});

test("install, reset and update models expose user-facing next steps", () => {
  const install: InstallReport = {
    version: "0.0.61",
    projectRoot,
    homeDir,
    homeMode: false,
    outcome: "pass",
    plan: buildInstallerPlan({ intent: "install", projectRoot, homeDir }),
    warnings: [],
    check: passReport(),
  };
  const reset: ResetReport = {
    version: "0.0.61",
    homeDir,
    outcome: "pass",
    plan: buildInstallerPlan({ intent: "reset", projectRoot: homeDir, homeDir }),
    globalConfigPath: `${homeDir}/.config/opencode/opencode.json`,
    exaEnv: { status: "configured", message: "OPENCODE_ENABLE_EXA=1 configured." },
    cleanup: { homeDir, dryRun: false, actions: [], warnings: [] },
    warnings: [],
    check: passReport(),
  };
  const update: SelfUpdateReport = {
    status: "applied",
    command: ["ogb", "update"],
    plan: buildInstallerPlan({ intent: "update", projectRoot, homeDir, release: "v0.0.61" }),
    message: `${DISPLAY} was updated and the bridge check was refreshed.`,
    postUpdate: {
      status: "pass",
      command: ["ogb", "check"],
      message: "Post-update check completed cleanly.",
      exitCode: 0,
    },
  };

  assert.ok(ritualViewModel("install", install).next.some((item) => /ready/.test(item)));
  assert.ok(ritualViewModel("reset", reset).next.some((item) => /rebuilt/.test(item)));
  assert.ok(ritualViewModel("update", update).next.some((item) => /Restart OpenCode/.test(item)));
});

test("update final model shows warning when the post-update check warns", () => {
  const model = ritualViewModel("update", {
    status: "applied",
    command: ["ogb", "update"],
    plan: buildInstallerPlan({ intent: "update", projectRoot, homeDir, release: "v0.0.61" }),
    message: `${DISPLAY} was updated. Full bridge check ran with warnings; see agentx check/dashboard for details.`,
    postUpdate: {
      status: "warn",
      command: ["ogb", "check"],
      message: "Post-update check completed with warnings.",
      exitCode: 1,
    },
  });

  assert.equal(model.statusLabel, "WARN");
  assert.equal(model.tone, "warn");
});

test("install and reset final models keep nested check blockers specific", () => {
  const failingCheck = passReport({
    outcome: "fail",
    blockers: [{
      severity: "fail",
      source: "validation",
      message: "Validation falhou: Global OpenCode config: opencode.json is missing.",
      action: "Rode `agentx validate --plain` para ver os checks detalhados.",
    }],
  });
  const install: InstallReport = {
    version: "0.0.61",
    projectRoot,
    homeDir,
    homeMode: false,
    outcome: "fail",
    plan: buildInstallerPlan({ intent: "install", projectRoot, homeDir }),
    warnings: ["fallback warning"],
    check: failingCheck,
  };
  const reset: ResetReport = {
    version: "0.0.61",
    homeDir,
    outcome: "pass",
    plan: buildInstallerPlan({ intent: "reset", projectRoot: homeDir, homeDir }),
    globalConfigPath: `${homeDir}/.config/opencode/opencode.json`,
    exaEnv: { status: "configured", message: "OPENCODE_ENABLE_EXA=1 configured." },
    cleanup: { homeDir, dryRun: false, actions: [], warnings: [] },
    warnings: [],
    check: failingCheck,
  };

  const installModel = ritualViewModel("install", install);
  const resetModel = ritualViewModel("reset", reset);

  assert.match(installModel.callouts[0], /Global OpenCode config/);
  assert.match(installModel.next[0], /agentx validate --plain/);
  assert.match(resetModel.callouts[0], /Global OpenCode config/);
  assert.match(resetModel.next[0], /agentx validate --plain/);
});

test("update final model surfaces release install tails and useful retry actions", () => {
  const model = ritualViewModel("update", {
    status: "error",
    command: ["bash", "-lc", "install-release"],
    plan: buildInstallerPlan({ intent: "update", projectRoot, homeDir, release: "v0.0.61" }),
    message: "agentX release install exited with code 1.",
    stderrTail: "npm is not recognized as a command",
    stdoutTail: "Downloading OGB",
  });

  assert.equal(model.statusLabel, "FAIL");
  assert.match(model.callouts.join("\n"), /npm is not recognized/);
  assert.match(model.next[0], /agentx update --plain/);
});

test("update final model surfaces post-update check summary without raw progress JSON", () => {
  const model = ritualViewModel("update", {
    status: "applied",
    command: ["ogb", "update"],
    plan: buildInstallerPlan({ intent: "update", projectRoot, homeDir, release: "v0.0.61" }),
    message: `${DISPLAY} was updated. Post-update check needs attention: Post-update check failed.`,
    postUpdate: {
      status: "fail",
      command: ["ogb", "check", "--force"],
      message: "Post-update check failed: validation: Validation falhou: OpenCode resolved config.",
      exitCode: 2,
      stdoutTail: "{\"schemaVersion\":\"ogb.progress.v1\",\"type\":\"ritual.step\"}",
      summary: {
        callouts: ["validation: Validation falhou: OpenCode resolved config."],
        next: ["OGB should repair this automatically."],
      },
      files: ["C:\\Users\\leo\\.config\\agentx\\generated\\agentx-pass.json"],
    },
  });

  const text = model.callouts.join("\n");
  assert.equal(model.statusLabel, "WARN");
  assert.equal(model.tone, "warn");
  assert.match(text, /Validation falhou: OpenCode resolved config/);
  assert.doesNotMatch(text, /schemaVersion/);
  assert.match(model.next[0], /repair this automatically/);
  assert.match(model.files[0], /agentx-pass\.json/);
});

test("update final model compacts noisy release install tails for terminal progress", () => {
  const model = ritualViewModel("update", {
    status: "error",
    command: ["bash", "-lc", "install-release"],
    plan: buildInstallerPlan({ intent: "update", projectRoot, homeDir, release: "v0.0.61" }),
    message: "agentX release install exited with code 1.",
    stdoutTail: noisyBootstrapTail,
  });

  const text = model.callouts.join("\n");
  assert.match(text, /koa-router/);
  assert.doesNotMatch(text, /% Total|--:--:--|\r/);
  assert.ok(model.callouts.every((item) => item.length <= 280));
});
