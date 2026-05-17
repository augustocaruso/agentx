import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlatformAdapter } from "./platform-adapter.js";

test("platform adapter contract returns Windows paths, shell, env persistence, and prefix", () => {
  const adapter = createPlatformAdapter({
    platform: "win32",
    homeDir: "C:\\Users\\leona",
    env: { APPDATA: "C:\\Users\\leona\\AppData\\Roaming" },
  });

  assert.equal(adapter.platform, "win32");
  assert.equal(adapter.scriptKind, "powershell");
  assert.equal(adapter.pathSeparator, ";");
  assert.equal(adapter.defaultInstallPrefix, "C:\\Users\\leona\\AppData\\Roaming\\npm");
  assert.equal(adapter.appDataDir, "C:\\Users\\leona\\AppData\\Roaming");
  assert.equal(adapter.npmGlobalDir, "C:\\Users\\leona\\AppData\\Roaming\\npm");
  assert.equal(adapter.globalConfigDir, "C:\\Users\\leona\\.config\\opencode");
  assert.deepEqual(adapter.globalConfigFiles, [
    "C:\\Users\\leona\\.config\\opencode\\opencode.json",
    "C:\\Users\\leona\\.config\\opencode\\opencode.jsonc",
  ]);
  assert.equal(adapter.legacyGlobalConfigDir, "C:\\Users\\leona\\AppData\\Roaming\\opencode");
  assert.equal(adapter.generatedDir, "C:\\Users\\leona\\.config\\opencode-gemini-bridge\\generated");
  assert.equal(adapter.resolvePath(`'"C:\\Users\\leona"'`), "C:\\Users\\leona");
  assert.equal(adapter.isHomeProject(`"C:\\Users\\leona"`), true);
  assert.equal(adapter.isHomeProject("c:\\users\\LEONA"), true);
  assert.deepEqual(adapter.commandVariants("opencode"), ["opencode.cmd", "opencode.exe", "opencode.bat", "opencode.ps1", "opencode"]);
  assert.ok(adapter.homeCommandCandidates("opencode").includes("C:\\Users\\leona\\AppData\\Roaming\\npm\\opencode.cmd"));

  const envPlan = adapter.persistEnv("OPENCODE_ENABLE_EXA", "1");
  assert.equal(envPlan.target, "windows-user-env");
  assert.deepEqual(envPlan.command, ["pwsh", "-NoProfile", "-Command", "[Environment]::SetEnvironmentVariable('OPENCODE_ENABLE_EXA','1','User')"]);
  assert.deepEqual(adapter.persistEnvCandidates("OPENCODE_ENABLE_EXA", "1").map((candidate) => candidate.command?.[0]), ["pwsh", "powershell.exe", "powershell"]);
});

test("platform adapter contract returns POSIX shell config target", () => {
  const homeDir = path.posix.join("/tmp", "ogb-home");
  const adapter = createPlatformAdapter({ platform: "darwin", homeDir, env: {} });

  assert.equal(adapter.platform, "darwin");
  assert.equal(adapter.scriptKind, "posix-shell");
  assert.equal(adapter.pathSeparator, ":");
  assert.equal(adapter.defaultInstallPrefix, path.posix.join(homeDir, ".local"));
  assert.equal(adapter.npmGlobalDir, path.posix.join(homeDir, ".local", "bin"));
  assert.equal(adapter.legacyGlobalConfigDir, undefined);
  assert.deepEqual(adapter.commandVariants("opencode"), ["opencode"]);
  assert.ok(adapter.homeCommandCandidates("opencode").includes(path.posix.join(homeDir, ".local", "bin", "opencode")));
  assert.equal(adapter.persistEnv("OPENCODE_ENABLE_EXA", "1").path, path.posix.join(homeDir, ".config", "zsh", ".zshrc"));
});

test("platform adapter persists Linux env to profile and bash rc without macOS zsh config", () => {
  const homeDir = path.posix.join("/tmp", "ogb-linux-home");
  const adapter = createPlatformAdapter({ platform: "linux", homeDir, env: { SHELL: "/bin/bash" } });

  assert.equal(adapter.platform, "linux");
  assert.equal(adapter.persistEnv("OPENCODE_ENABLE_EXA", "1").path, path.posix.join(homeDir, ".profile"));
  assert.deepEqual(adapter.persistEnvCandidates("OPENCODE_ENABLE_EXA", "1").map((candidate) => candidate.path), [
    path.posix.join(homeDir, ".profile"),
    path.posix.join(homeDir, ".bashrc"),
  ]);
  assert.equal(adapter.persistEnvCandidates("OPENCODE_ENABLE_EXA", "1").some((candidate) =>
    candidate.path?.includes(path.posix.join(".config", "zsh", ".zshrc"))
  ), false);
});

test("platform adapter includes zsh rc as an additional Linux env target when zsh is the shell", () => {
  const homeDir = path.posix.join("/tmp", "ogb-linux-zsh-home");
  const adapter = createPlatformAdapter({ platform: "linux", homeDir, env: { SHELL: "/usr/bin/zsh" } });

  assert.deepEqual(adapter.persistEnvCandidates("OPENCODE_ENABLE_EXA", "1").map((candidate) => candidate.path), [
    path.posix.join(homeDir, ".profile"),
    path.posix.join(homeDir, ".zshrc"),
  ]);
});

test("platform adapter includes fish config as an additional Linux env target when fish is the shell", () => {
  const homeDir = path.posix.join("/tmp", "ogb-linux-fish-home");
  const adapter = createPlatformAdapter({ platform: "linux", homeDir, env: { SHELL: "/usr/bin/fish" } });
  const candidates = adapter.persistEnvCandidates("OPENCODE_ENABLE_EXA", "1");

  assert.deepEqual(candidates.map((candidate) => candidate.path), [
    path.posix.join(homeDir, ".profile"),
    path.posix.join(homeDir, ".config", "fish", "config.fish"),
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.target), [
    "posix-shell-config",
    "fish-config",
  ]);
});

test("platform adapter contract preserves POSIX fixture paths while simulating Windows", { skip: process.platform === "win32" ? "POSIX fixture path simulation is covered on POSIX runners" : false }, () => {
  const homeDir = path.posix.join("/tmp", "ogb-home");
  const adapter = createPlatformAdapter({ platform: "win32", homeDir, env: {} });

  assert.equal(adapter.homeDir, homeDir);
  assert.equal(adapter.globalConfigDir, path.join(homeDir, ".config", "opencode"));
  assert.equal(adapter.defaultInstallPrefix, path.join(homeDir, "AppData", "Roaming", "npm"));
  assert.equal(adapter.legacyGlobalConfigDir, path.join(homeDir, "AppData", "Roaming", "opencode"));
  assert.ok(adapter.homeCommandCandidates("ogb").includes(path.join(homeDir, "AppData", "Roaming", "npm", "ogb.cmd")));
});

test("platform adapter escapes PowerShell env values without touching internal path quotes", () => {
  const adapter = createPlatformAdapter({
    platform: "win32",
    homeDir: "C:\\Users\\leona",
    env: {},
  });

  const envPlan = adapter.persistEnv("OGB_TEST", "value with 'single' quote");

  assert.deepEqual(envPlan.command, [
    "pwsh",
    "-NoProfile",
    "-Command",
    "[Environment]::SetEnvironmentVariable('OGB_TEST','value with ''single'' quote','User')",
  ]);
});

test("platform adapter honors XDG config on the current POSIX home only", { skip: process.platform === "win32" ? "XDG current-home behavior is POSIX-only" : false }, () => {
  const homeDir = os.homedir();
  const adapter = createPlatformAdapter({
    platform: "darwin",
    homeDir,
    env: { XDG_CONFIG_HOME: "/tmp/xdg-config" },
  });

  assert.equal(adapter.globalConfigDir, "/tmp/xdg-config/opencode");
});

test("platform adapter does not append duplicate opencode segment to XDG config", { skip: process.platform === "win32" ? "XDG current-home behavior is POSIX-only" : false }, () => {
  const homeDir = os.homedir();
  const adapter = createPlatformAdapter({
    platform: "darwin",
    homeDir,
    env: { XDG_CONFIG_HOME: path.join(homeDir, ".config", "opencode") },
  });

  assert.equal(adapter.globalConfigDir, path.join(homeDir, ".config", "opencode"));
});
