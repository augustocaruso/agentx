import assert from "node:assert/strict";
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
  assert.equal(adapter.globalConfigDir, "C:\\Users\\leona\\.config\\opencode");

  const envPlan = adapter.persistEnv("OPENCODE_ENABLE_EXA", "1");
  assert.equal(envPlan.target, "windows-user-env");
  assert.deepEqual(envPlan.command, ["powershell.exe", "-NoProfile", "-Command", "[Environment]::SetEnvironmentVariable('OPENCODE_ENABLE_EXA','1','User')"]);
});

test("platform adapter contract returns POSIX shell config target", () => {
  const homeDir = path.join("/tmp", "ogb-home");
  const adapter = createPlatformAdapter({ platform: "darwin", homeDir, env: {} });

  assert.equal(adapter.platform, "darwin");
  assert.equal(adapter.scriptKind, "posix-shell");
  assert.equal(adapter.pathSeparator, ":");
  assert.equal(adapter.defaultInstallPrefix, path.join(homeDir, ".local"));
  assert.equal(adapter.persistEnv("OPENCODE_ENABLE_EXA", "1").path, path.join(homeDir, ".config", "zsh", ".zshrc"));
});

test("platform adapter contract preserves POSIX fixture paths while simulating Windows", () => {
  const homeDir = path.join("/tmp", "ogb-home");
  const adapter = createPlatformAdapter({ platform: "win32", homeDir, env: {} });

  assert.equal(adapter.homeDir, homeDir);
  assert.equal(adapter.globalConfigDir, path.join(homeDir, ".config", "opencode"));
  assert.equal(adapter.defaultInstallPrefix, path.join(homeDir, "AppData", "Roaming", "npm"));
});
