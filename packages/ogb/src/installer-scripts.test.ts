import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function script(name: string): string {
  return fs.readFileSync(path.join(repoRoot, "scripts", name), "utf8");
}

test("mac installer contract delegates the ritual to ogb install", () => {
  const text = script("install-mac.sh");

  assert.match(text, /INSTALL_ARGS=\(--project "\$PROJECT_DIR" install --rulesync "\$RULESYNC_MODE"\)/);
  assert.match(text, /Running OGB install ritual/);
  assert.match(text, /--no-ux/);
  assert.match(text, /--no-install-opencode/);
  assert.match(text, /--no-check/);
  assert.match(text, /--reset-global/);
  assert.doesNotMatch(text, /\bsetup-ux\b/);
  assert.doesNotMatch(text, /\bsetup-opencode\b/);
  assert.doesNotMatch(text, /\bcleanup-home\b/);
  assert.doesNotMatch(text, /\brun_final_check\b/);
});

test("windows installer contract delegates the ritual to ogb install", () => {
  const text = script("install-windows.ps1");

  assert.match(text, /\$InstallArgs = @\("--project", \$Project, "install", "--rulesync", \$Rulesync, "--windows"\)/);
  assert.match(text, /Running OGB install ritual/);
  assert.match(text, /--no-ux/);
  assert.match(text, /--no-install-opencode/);
  assert.match(text, /--no-check/);
  assert.match(text, /--reset-global/);
  assert.doesNotMatch(text, /\bsetup-ux\b/);
  assert.doesNotMatch(text, /\bsetup-opencode\b/);
  assert.doesNotMatch(text, /\bcleanup-home\b/);
  assert.doesNotMatch(text, /\bInvoke-FinalOgbCheck\b/);
});
