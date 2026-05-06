import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCommand } from "./command-resolution.js";
import { commandForPlatform, normalizeCommandInput } from "./process.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-command-"));
}

test("resolveCommand prefers Windows npm cmd shim for an extensionless command path", () => {
  const root = tempRoot();
  const shim = path.join(root, "opencode");
  fs.writeFileSync(`${shim}.cmd`, "@echo off\n", "utf8");

  assert.equal(
    resolveCommand(shim, {
      platform: "win32",
      includeLookup: false,
      includeNpmPrefix: false,
    }),
    `${shim}.cmd`,
  );
});

test("resolveCommand searches the Windows AppData npm directory", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const appData = path.join(homeDir, "AppData", "Roaming");
  const npmDir = path.join(appData, "npm");
  fs.mkdirSync(npmDir, { recursive: true });
  const shim = path.join(npmDir, "opencode.cmd");
  fs.writeFileSync(shim, "@echo off\n", "utf8");

  assert.equal(
    resolveCommand("opencode", {
      homeDir,
      platform: "win32",
      env: { APPDATA: appData },
      includeLookup: false,
      includeNpmPrefix: false,
    }),
    shim,
  );
});

test("resolveCommand strips accidental quotes from Windows command paths", () => {
  const root = tempRoot();
  const shim = path.join(root, "quoted opencode");
  fs.writeFileSync(`${shim}.cmd`, "@echo off\n", "utf8");

  assert.equal(
    resolveCommand(` '"${shim}"' `, {
      platform: "win32",
      includeLookup: false,
      includeNpmPrefix: false,
    }),
    `${shim}.cmd`,
  );
});

test("normalizeCommandInput strips only surrounding command quotes", () => {
  assert.equal(normalizeCommandInput(` '"C:\\Program Files\\nodejs\\npm.cmd"' `), "C:\\Program Files\\nodejs\\npm.cmd");
  assert.equal(normalizeCommandInput(`\\"C:\\Program Files\\nodejs\\npm.cmd\\"`), "C:\\Program Files\\nodejs\\npm.cmd");
  assert.equal(normalizeCommandInput(`'\\"C:\\Program Files\\nodejs\\npm.cmd\\"'`), "C:\\Program Files\\nodejs\\npm.cmd");
  assert.equal(normalizeCommandInput(`"C:\\Tools\\node'\\"js\\npm.cmd"`), `C:\\Tools\\node'\\"js\\npm.cmd`);
  assert.equal(normalizeCommandInput(`C:\\Program Files\\node"js\\npm.cmd`), `C:\\Program Files\\node"js\\npm.cmd`);
});

test("commandForPlatform runs Windows cmd shims through cmd without call", () => {
  const command = commandForPlatform("C:\\Users\\leona\\AppData\\Roaming\\npm\\opencode.cmd", ["models"], "win32");

  assert.match(command.command, /cmd\.exe$/i);
  assert.deepEqual(command.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(command.args[3], '""C:\\Users\\leona\\AppData\\Roaming\\npm\\opencode.cmd" models"');
  assert.equal(command.windowsVerbatimArguments, true);
  assert.doesNotMatch(command.args[3], /^call /);
});

test("commandForPlatform quotes Windows cmd shims with spaces without call", () => {
  const command = commandForPlatform('"C:\\Program Files\\nodejs\\npm.cmd"', ["--version"], "win32");

  assert.match(command.command, /cmd\.exe$/i);
  assert.equal(command.args[3], '""C:\\Program Files\\nodejs\\npm.cmd" --version"');
  assert.equal(command.windowsVerbatimArguments, true);
  assert.doesNotMatch(command.args[3], /"""C:/);
});

test("commandForPlatform strips escaped accidental quotes before wrapping Windows cmd shims", () => {
  const command = commandForPlatform('\\"C:\\Program Files\\nodejs\\npm.cmd\\"', ["--version"], "win32");

  assert.match(command.command, /cmd\.exe$/i);
  assert.deepEqual(command.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(command.args[3], '""C:\\Program Files\\nodejs\\npm.cmd" --version"');
  assert.equal(command.windowsVerbatimArguments, true);
  assert.doesNotMatch(command.args[3], /\\"/);
});

test("commandForPlatform runs Windows exe commands directly", () => {
  const command = commandForPlatform("C:\\Program Files\\nodejs\\node.exe", ["--version"], "win32");

  assert.equal(command.command, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(command.args, ["--version"]);
  assert.equal(command.windowsVerbatimArguments, undefined);
});

test("commandForPlatform strips accidental quotes from Windows exe commands", () => {
  const command = commandForPlatform('"C:\\Program Files\\nodejs\\node.exe"', ["--version"], "win32");

  assert.equal(command.command, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(command.args, ["--version"]);
});
