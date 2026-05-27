import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BINARY, DISPLAY } from "./brand.js";
import { buildPostUpdateRitualCommand, buildSelfUpdateCommand, checkOgbUpdate, printSelfUpdateReport, runAutoUpdate, runSelfUpdate, writeSelfUpdateSuccessStatus } from "./self-update.js";
import { resolveProjectPaths } from "./paths.js";
import { RITUAL_PROGRESS_SCHEMA_VERSION, type RitualProgressEvent } from "./ritual-progress.js";
import { AGENTX_VERSION } from "./types.js";

function captureConsoleLog(callback: () => void): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    callback();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

test("buildSelfUpdateCommand uses GitHub bootstrap on POSIX platforms", () => {
  const command = buildSelfUpdateCommand({
    projectRoot: "/tmp/ogb project",
    prefix: "/tmp/ogb-prefix",
    rulesync: "off",
    setup: false,
    ux: false,
    installOpenCode: false,
    force: true,
  }, "darwin");

  assert.equal(command[0], "bash");
  assert.equal(command[1], "-lc");
  assert.match(command[2], /bootstrap-mac\.sh/);
  assert.match(command[2], /--repo/);
  assert.match(command[2], /augustocaruso\/agentx/);
  assert.match(command[2], /--version/);
  assert.match(command[2], /latest/);
  assert.match(command[2], /--project/);
  assert.match(command[2], /ogb project/);
  assert.match(command[2], /--skip-install-check/);
  assert.match(command[2], /--no-setup/);
  assert.match(command[2], /--no-ux/);
  assert.match(command[2], /--no-opencode/);
  assert.match(command[2], /--force/);
});

test("buildSelfUpdateCommand uses the Linux bootstrap on Linux", () => {
  const command = buildSelfUpdateCommand({
    projectRoot: "/tmp/ogb project",
    prefix: "/tmp/ogb-prefix",
    rulesync: "off",
    setup: false,
    ux: false,
    installOpenCode: false,
    force: true,
  }, "linux");

  assert.equal(command[0], "bash");
  assert.equal(command[1], "-lc");
  assert.match(command[2], /bootstrap-linux\.sh/);
  assert.doesNotMatch(command[2], /bootstrap-mac\.sh/);
  assert.match(command[2], /--project/);
  assert.match(command[2], /ogb project/);
  assert.match(command[2], /--skip-install-check/);
});

test("buildSelfUpdateCommand uses PowerShell bootstrap on Windows", () => {
  const command = buildSelfUpdateCommand({
    repo: "acme/bridge",
    version: "v9.9.9",
    projectRoot: "C:\\Users\\Friend\\Project",
    setup: false,
    ux: false,
    installOpenCode: false,
  }, "win32");

  assert.equal(command[0], "powershell.exe");
  assert.match(command.join(" "), /scripts\/bootstrap-windows\.ps1/);
  assert.match(command.join(" "), /PSNativeCommandUseErrorActionPreference = \$false/);
  assert.match(command.join(" "), /-Repo 'acme\/bridge'/);
  assert.match(command.join(" "), /-Version 'v9\.9\.9'/);
  assert.match(command.join(" "), /-Project 'C:\\Users\\Friend\\Project'/);
  assert.match(command.join(" "), /-SkipInstallCheck/);
  assert.match(command.join(" "), /-NoSetup/);
  assert.match(command.join(" "), /-NoUx/);
  assert.match(command.join(" "), /-NoOpenCode/);
});

test("buildSelfUpdateCommand preserves Windows drive paths while running on POSIX", () => {
  const command = buildSelfUpdateCommand({
    projectRoot: `'"C:\\Users\\leona"'`,
    prefix: `'\\"C:\\Users\\leona\\AppData\\Roaming\\npm\\"'`,
  }, "win32");
  const script = command.join(" ");

  assert.match(script, /-Project 'C:\\Users\\leona'/);
  assert.match(script, /-Prefix 'C:\\Users\\leona\\AppData\\Roaming\\npm'/);
  assert.doesNotMatch(script, /\/Users\/augustocaruso\/Documents\/opencode-gemini-bridge\/C:/);
  assert.doesNotMatch(script, /\\"C:\\Users/);
});

test("buildSelfUpdateCommand strips accidental quotes from project and prefix paths", () => {
  const projectRoot = path.join(os.tmpdir(), "ogb quoted project");
  const prefix = path.join(os.tmpdir(), "ogb quoted prefix");
  const command = buildSelfUpdateCommand({
    projectRoot: `'"${projectRoot}"'`,
    prefix: `"${prefix}"`,
  }, "win32");
  const script = command.join(" ");

  assert.match(script, new RegExp(`-Project '${projectRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.match(script, new RegExp(`-Prefix '${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.equal(script.includes("-Project '\""), false);
  assert.equal(script.includes("-Prefix '\""), false);
});

test("runSelfUpdate dry-run does not execute the release install command", () => {
  const report = runSelfUpdate({ dryRun: true, projectRoot: "/tmp/ogb" });

  assert.equal(report.status, "preview");
  assert.equal(report.plan.intent, "update");
  assert.equal(report.command[0], process.platform === "win32" ? "powershell.exe" : "bash");
  assert.match(report.message, /Would install/);
});

test("plain self-update report uses the current product brand", () => {
  const report = runSelfUpdate({ dryRun: true, projectRoot: "/tmp/ogb" });
  const output = captureConsoleLog(() => printSelfUpdateReport(report));

  assert.equal(output.split("\n")[0], `${DISPLAY} update: preview`);
  assert.match(report.message, new RegExp(`selected ${DISPLAY} release`));
  assert.match(output, new RegExp(`selected ${DISPLAY} release`));
  assert.match(output, new RegExp(`${BINARY} .* check --force`));
  assert.doesNotMatch(output, /check --force --no-extension-update/);
  assert.doesNotMatch(output, /OGB update|selected OGB|OpenCode Gemini Bridge/);
});

test("runSelfUpdate dry-run emits update ritual progress", () => {
  const events: RitualProgressEvent[] = [];
  const report = runSelfUpdate({
    dryRun: true,
    projectRoot: "/tmp/ogb",
    onProgress: (event) => events.push(event),
  });

  assert.equal(report.status, "preview");
  assert.deepEqual(events.map((event) => `${event.stepId}:${event.status}`), [
    "resolve:running",
    "resolve:pass",
    "download:skipped",
    "install:skipped",
    "post-check:skipped",
  ]);
});

test("runSelfUpdate progress presents a cargo-like update instead of bootstrap internals", () => {
  const events: RitualProgressEvent[] = [];
  const report = runSelfUpdate({
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "agentx-update-cargo-")),
    stdio: "pipe",
    onProgress: (event) => events.push(event),
    runCommand: (spec) => ({
      ok: true,
      command: spec.command,
      args: spec.args ?? [],
      status: 0,
      signal: null,
      stdout: "bootstrap ok",
      stderr: "",
    }),
    runPostUpdateCommand: (spec) => ({
      ok: true,
      command: spec.command,
      args: spec.args ?? [],
      status: 0,
      signal: null,
      stdout: "",
      stderr: "",
    }),
  });
  const progressText = events.map((event) => `${event.label}\n${event.detail ?? ""}\n${event.message ?? ""}`).join("\n");

  assert.equal(report.status, "applied");
  assert.doesNotMatch(progressText, /bootstrap/i);
  assert.doesNotMatch(progressText, /Apply the installer/i);
  assert.match(progressText, /Install the selected agentX release/i);
});

test("runSelfUpdate forwards post-update check progress in canonical order", () => {
  const events: RitualProgressEvent[] = [];
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-update-progress-"));
  const nestedProgress = [
    {
      schemaVersion: RITUAL_PROGRESS_SCHEMA_VERSION,
      ritualId: "check-test",
      kind: "check",
      timestamp: "2026-05-06T00:00:00.000Z",
      type: "ritual.step",
      stepId: "patches-pre-sync",
      label: "Apply agentX patches before sync.",
      status: "pass",
      message: "1 applied",
    },
    {
      schemaVersion: RITUAL_PROGRESS_SCHEMA_VERSION,
      ritualId: "check-test",
      kind: "check",
      timestamp: "2026-05-06T00:00:00.000Z",
      type: "ritual.step",
      stepId: "sync",
      label: "Sync Gemini resources into OpenCode.",
      status: "running",
    },
    {
      schemaVersion: RITUAL_PROGRESS_SCHEMA_VERSION,
      ritualId: "check-test",
      kind: "check",
      timestamp: "2026-05-06T00:00:00.000Z",
      type: "ritual.step",
      stepId: "sync",
      label: "Sync Gemini resources into OpenCode.",
      status: "pass",
    },
  ].map((event) => JSON.stringify(event)).join("\n");

  const report = runSelfUpdate({
    projectRoot,
    stdio: "pipe",
    onProgress: (event) => events.push(event),
    runCommand: (spec) => ({
      ok: true,
      command: spec.command,
      args: spec.args ?? [],
      status: 0,
      signal: null,
      stdout: "bootstrap ok",
      stderr: "",
    }),
    runPostUpdateCommand: (spec) => {
      assert.equal(spec.args?.includes("--progress-json"), true);
      return {
        ok: true,
        command: spec.command,
        args: spec.args ?? [],
        status: 0,
        signal: null,
        stdout: nestedProgress,
        stderr: "",
      };
    },
  });

  assert.equal(report.status, "applied");
  assert.deepEqual(events.map((event) => `${event.stepId}:${event.status}`), [
    "resolve:running",
    "resolve:pass",
    "download:running",
    "install:running",
    "download:pass",
    "install:pass",
    "post-check:running",
    "patches-pre-sync:pass",
    "sync:running",
    "sync:pass",
    "post-check:pass",
  ]);
});

test("runSelfUpdate caps slow OpenCode model lookup during the post-update check", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-update-fast-post-check-"));
  let postUpdateEnv: NodeJS.ProcessEnv | undefined;

  const report = runSelfUpdate({
    projectRoot,
    stdio: "pipe",
    runCommand: (spec) => ({
      ok: true,
      command: spec.command,
      args: spec.args ?? [],
      status: 0,
      signal: null,
      stdout: "bootstrap ok",
      stderr: "",
    }),
    runPostUpdateCommand: (spec) => {
      postUpdateEnv = spec.env;
      return {
        ok: true,
        command: spec.command,
        args: spec.args ?? [],
        status: 0,
        signal: null,
        stdout: "",
        stderr: "",
      };
    },
  });

  assert.equal(report.status, "applied");
  assert.equal(postUpdateEnv?.OGB_OPENCODE_MODELS_TIMEOUT_MS, "5000");
});

test("runSelfUpdate surfaces post-update progress summary instead of raw NDJSON", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-update-post-check-summary-"));
  const progress = [
    {
      schemaVersion: RITUAL_PROGRESS_SCHEMA_VERSION,
      ritualId: "check-test",
      kind: "check",
      timestamp: "2026-05-18T17:33:34.349Z",
      type: "ritual.step",
      stepId: "validate",
      label: "Validate the resolved OpenCode configuration.",
      status: "fail",
      message: "OpenCode resolved config: EEXIST: file already exists, mkdir 'C:\\Users\\leo\\.config\\opencode'",
    },
    {
      schemaVersion: RITUAL_PROGRESS_SCHEMA_VERSION,
      ritualId: "check-test",
      kind: "check",
      timestamp: "2026-05-18T17:33:34.350Z",
      type: "ritual.finished",
      outcome: "fail",
      exitCode: 2,
      summary: {
        callouts: [
          "validation: Validation falhou: OpenCode resolved config: EEXIST: file already exists, mkdir 'C:\\Users\\leo\\.config\\opencode'",
        ],
        next: ["OGB should repair the blocking OpenCode config path automatically."],
      },
      files: ["C:\\Users\\leo\\.config\\opencode-gemini-bridge\\generated\\ogb-pass.json"],
    },
  ].map((event) => JSON.stringify(event)).join("\n");

  const report = runSelfUpdate({
    projectRoot,
    stdio: "pipe",
    runCommand: (spec) => ({
      ok: true,
      command: spec.command,
      args: spec.args ?? [],
      status: 0,
      signal: null,
      stdout: "bootstrap ok",
      stderr: "",
    }),
    runPostUpdateCommand: (spec) => ({
      ok: false,
      command: spec.command,
      args: spec.args ?? [],
      status: 2,
      signal: null,
      stdout: progress,
      stderr: "",
    }),
  });

  assert.equal(report.status, "applied");
  assert.equal(report.postUpdate?.status, "fail");
  assert.match(report.message, /Post-update check needs attention/);
  assert.match(report.message, /Validation falhou: OpenCode resolved config/);
  assert.match(report.postUpdate?.message ?? "", /Validation falhou: OpenCode resolved config/);
  assert.doesNotMatch(report.postUpdate?.stdoutTail ?? "", /schemaVersion/);
  assert.match(report.postUpdate?.stdoutTail ?? "", /Reports:/);
});

test("runSelfUpdate reports release install stderr tail and specific progress failure", () => {
  const events: RitualProgressEvent[] = [];
  const report = runSelfUpdate({
    projectRoot: "/tmp/ogb",
    stdio: "pipe",
    onProgress: (event) => events.push(event),
    runCommand: (spec) => ({
      ok: false,
      command: spec.command,
      args: spec.args ?? [],
      status: 1,
      signal: null,
      stdout: "Downloading OGB...",
      stderr: "npm is not recognized as a command",
    }),
  });

  assert.equal(report.status, "error");
  assert.equal(report.stderrTail, "npm is not recognized as a command");
  assert.match(report.message, /release install exited with code 1/);
  const installFailure = events.find((event) => event.stepId === "install" && event.status === "fail");
  assert.match(installFailure?.message ?? "", /npm is not recognized/);
});

test("runSelfUpdate persists detailed update diagnostics when release install fails", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-update-error-"));
  const report = runSelfUpdate({
    projectRoot,
    stdio: "pipe",
    runCommand: (spec) => ({
      ok: false,
      command: spec.command,
      args: spec.args ?? [],
      status: 1,
      signal: null,
      stdout: "Downloading agentX from release pack...",
      stderr: "npm is not recognized as a command",
    }),
  });
  const saved = JSON.parse(fs.readFileSync(resolveProjectPaths(projectRoot).updateStatusPath, "utf8"));

  assert.equal(report.status, "error");
  assert.equal(saved.status, "error");
  assert.equal(saved.restartRequired, false);
  assert.equal(saved.selfUpdate.status, "error");
  assert.equal(saved.selfUpdate.stderrTail, "npm is not recognized as a command");
  assert.match(saved.message, /release install exited with code 1/);
  assert.match(saved.selfUpdate.stdoutTail, /Downloading agentX/);
  assert.equal(saved.agentxVersion, AGENTX_VERSION);
  assert.equal(typeof saved.finishedAt, "string");
});

test("writeSelfUpdateSuccessStatus overwrites stale update errors", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-update-success-"));
  const paths = resolveProjectPaths(projectRoot);
  fs.mkdirSync(path.dirname(paths.updateStatusPath), { recursive: true });
  fs.writeFileSync(paths.updateStatusPath, JSON.stringify({
    version: 1,
    status: "error",
    message: "old failure",
    restartRequired: false,
  }), "utf8");

  const report = writeSelfUpdateSuccessStatus({
    projectRoot,
    version: "v0.0.53",
  }, new Date("2026-05-06T20:00:00.000Z"));
  const saved = JSON.parse(fs.readFileSync(paths.updateStatusPath, "utf8"));

  assert.equal(report.status, "updated");
  assert.equal(saved.status, "updated");
  assert.equal(saved.latestTag, "v0.0.53");
  assert.equal(saved.restartRequired, true);
  assert.equal(saved.agentxVersion, AGENTX_VERSION);
  assert.equal(typeof saved.generatedAt, "string");
  assert.match(saved.message, /full bridge check/);
  assert.doesNotMatch(saved.message, /reset --yes/);
  assert.doesNotMatch(saved.message, /old failure/);
});

test("buildPostUpdateRitualCommand runs a focused forced check with extension updates after update", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-post-update-"));
  const command = buildPostUpdateRitualCommand({ projectRoot }, "win32");

  assert.deepEqual(command.slice(-5), ["--project", projectRoot, "check", "--force", "--windows"]);
  assert.equal(command.includes("--no-extension-update"), false);
});

test("buildSelfUpdateCommand rejects invalid repo names", () => {
  assert.throws(() => buildSelfUpdateCommand({ repo: "bad;repo" }), /OWNER\/REPO/);
});

test("checkOgbUpdate reports available releases and writes status", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-update-"));
  const report = await checkOgbUpdate({
    projectRoot,
    currentVersion: "0.0.38",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v0.0.39",
        html_url: "https://github.com/acme/bridge/releases/tag/v0.0.39",
      }),
    }),
    now: new Date("2026-05-06T12:00:00.000Z"),
  });

  assert.equal(report.status, "available");
  assert.equal(report.latestVersion, "0.0.39");
  assert.equal(report.latestTag, "v0.0.39");
  const saved = JSON.parse(fs.readFileSync(resolveProjectPaths(projectRoot).updateStatusPath, "utf8"));
  assert.equal(saved.status, "available");
  assert.equal(saved.checkedAt, "2026-05-06T12:00:00.000Z");
  assert.equal(typeof saved.generatedAt, "string");
  assert.equal(saved.agentxVersion, AGENTX_VERSION);
});

test("checkOgbUpdate reports current when latest tag matches current version", async () => {
  const report = await checkOgbUpdate({
    currentVersion: "0.0.38",
    write: false,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: "v0.0.38" }),
    }),
  });

  assert.equal(report.status, "current");
});

test("runAutoUpdate dry-run builds an update command without installing OpenCode", async () => {
  const report = await runAutoUpdate({
    currentVersion: "0.0.38",
    projectRoot: "/tmp/ogb-auto",
    dryRun: true,
    write: false,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: "v0.0.39" }),
    }),
  });

  assert.equal(report.status, "available");
  assert.equal(report.restartRequired, false);
  assert.equal(report.plan.intent, "update");
  assert.ok(report.selfUpdate);
  assert.equal(report.selfUpdate.plan.intent, "update");
  assert.match(report.selfUpdate.command.join(" "), /v0\.0\.39/);
  assert.match(report.selfUpdate.command.join(" "), /no-?opencode/i);
  assert.equal(report.selfUpdate.postUpdate?.status, "preview");
});

test("checkOgbUpdate reports unknown when the release lookup fails", async () => {
  const report = await checkOgbUpdate({
    currentVersion: "0.0.38",
    write: false,
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }),
  });

  assert.equal(report.status, "unknown");
  assert.match(report.message, /HTTP 500/);
});
