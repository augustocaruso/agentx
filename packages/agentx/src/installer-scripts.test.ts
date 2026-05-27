import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function script(name: string): string {
  return fs.readFileSync(path.join(repoRoot, "scripts", name), "utf8");
}

function assertScriptExists(name: string): void {
  assert.equal(fs.existsSync(path.join(repoRoot, "scripts", name)), true, `Expected scripts/${name} to exist.`);
}

test("posix installer contract runs managed setup through agentx install", () => {
  assertScriptExists("install-posix.sh");
  const text = script("install-posix.sh");

  assert.match(text, /INSTALL_ARGS=\(--project "\$PROJECT_DIR" install --rulesync "\$RULESYNC_MODE"\)/);
  assert.match(text, /INSTALL_ARGS\+=\(--force\)/);
  assert.ok(text.indexOf("INSTALL_ARGS+=(--force)") < text.indexOf('if [[ "$RUN_UX" -eq 0 ]]'));
  assert.doesNotMatch(text.match(/if \[\[ "\$FORCE"[\s\S]*?\nfi/)?.[0] ?? "", /INSTALL_ARGS\+=\(--force\)/);
  assert.match(text, /Configuring \$PRODUCT_NAME for/);
  assert.match(text, /\$PRODUCT_NAME install completed with notes; continuing setup/);
  assert.doesNotMatch(text, /install ritual|continuing bootstrap/);
  assert.match(text, /enable_installer_tui\(\)/);
  assert.match(text, /AGENTX_RITUAL_UI=ink/);
  assert.ok(text.indexOf("enable_installer_tui") < text.indexOf('"$PRIMARY_BIN" "${INSTALL_ARGS[@]}"'));
  assert.match(text, /--no-ux/);
  assert.match(text, /--no-install-opencode/);
  assert.doesNotMatch(text, /--no-extension-update/);
  assert.match(text, /--skip-install-check/);
  assert.match(text, /SKIP_INSTALL_CHECK=1/);
  assert.match(text, /--no-check/);
  assert.match(text, /--reset-global/);
  assert.match(text, /INSTALL_STATUS=\$\?/);
  assert.match(text, /"\$INSTALL_STATUS" -eq 1/);
  assert.match(text, /exit "\$INSTALL_STATUS"/);
  assert.doesNotMatch(text, /\bsetup-ux\b/);
  assert.doesNotMatch(text, /\bsetup-opencode\b/);
  assert.doesNotMatch(text, /\bcleanup-home\b/);
  assert.doesNotMatch(text, /\brun_final_check\b/);
});

test("posix installer repairs a file blocking the OpenCode config dir before mkdir", () => {
  assertScriptExists("install-posix.sh");
  const text = script("install-posix.sh");

  assert.match(text, /repair_directory_blocker\(\)/);
  assert.match(text, /mv "\$dir" "\$backup_path"/);
  assert.match(text, /Repaired file blocking OpenCode config directory/);
  assert.ok(
    text.indexOf('repair_directory_blocker "$HOME/.config/opencode" "posix-installer"')
    < text.indexOf('mkdir -p "$HOME/.config/opencode"'),
  );
});

test("mac installer remains a darwin wrapper around the shared POSIX installer", () => {
  const text = script("install-mac.sh");

  assert.match(text, /install-posix\.sh/);
  assert.match(text, /--platform darwin/);
  assert.match(script("bootstrap-mac.sh"), /run_installer/);
  assert.match(script("bootstrap-mac.sh"), /cleanup_legacy/);
  assert.match(script("bootstrap-mac.sh"), /--keep-legacy/);
  assert.match(script("bootstrap-mac.sh"), /\$\{#INSTALLER_ARGS\[@\]\}/);
});

test("linux public scripts wrap the shared POSIX implementation", () => {
  for (const name of ["install-linux.sh", "bootstrap-linux.sh", "upgrade-linux.sh", "uninstall-linux.sh"]) {
    assertScriptExists(name);
  }

  assert.match(script("install-linux.sh"), /install-posix\.sh/);
  assert.match(script("install-linux.sh"), /--platform linux/);
  assert.match(script("bootstrap-linux.sh"), /install-linux\.sh/);
  assert.match(script("bootstrap-linux.sh"), /install-posix\.sh/);
  assert.match(script("bootstrap-linux.sh"), /install-mac\.sh/);
  assert.match(script("bootstrap-linux.sh"), /legacy POSIX installer/);
  assert.match(script("bootstrap-linux.sh"), /agentx-pack\.zip/);
  assert.match(script("bootstrap-linux.sh"), /run_installer/);
  assert.match(script("bootstrap-linux.sh"), /cleanup_legacy/);
  assert.match(script("bootstrap-linux.sh"), /--keep-legacy/);
  assert.match(script("bootstrap-linux.sh"), /\$\{#INSTALLER_ARGS_PREFIX\[@\]\}/);
  assert.match(script("bootstrap-linux.sh"), /\$\{#INSTALLER_ARGS\[@\]\}/);
  assert.match(script("upgrade-linux.sh"), /install-linux\.sh/);
  assert.match(script("uninstall-linux.sh"), /uninstall-posix\.sh/);
});

test("linux POSIX installer persists env without macOS zsh config", () => {
  assertScriptExists("install-posix.sh");
  const text = script("install-posix.sh");

  assert.match(text, /linux_profile_targets/);
  assert.match(text, /\.profile/);
  assert.match(text, /\.bashrc/);
  assert.match(text, /\.zshrc/);
  assert.match(text, /\.config\/fish\/config\.fish/);
  assert.match(text, /set -gx OPENCODE_ENABLE_EXA 1/);
  assert.match(text, /contains "\$PREFIX\/bin" \\\$PATH/);
  assert.match(text, /OPENCODE_ENABLE_EXA/);
  assert.match(text, /install_stable_cli/);
  assert.match(text, /Installing \$BINARY_NAME into a stable local folder/);
  assert.match(text, /rm -f "\$PRIMARY_BIN"/);
  assert.match(text, /rm -f "\$LEGACY_BIN"/);
  assert.match(text, /WRITE_LEGACY_ALIAS/);
  assert.match(text, /exec node/);
  assert.match(text, /Installed \$BINARY_NAME at \$PRIMARY_BIN, but it did not run/);
  const linuxTargets = text.match(/linux_profile_targets\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(linuxTargets, /\.config\/zsh/);
});

test("posix installer installs agentx into a stable local folder instead of a global npm package", () => {
  assertScriptExists("install-posix.sh");
  const text = script("install-posix.sh");

  assert.match(text, /STABLE_CLI_DIR_NAME="\$\{AGENTX_STABLE_CLI_DIR:-\$PACKAGE_NAME-cli\}"/);
  assert.match(text, /CLI_INSTALL_DIR="\$HOME\/\.ai\/opencode-pack\/\$STABLE_CLI_DIR_NAME"/);
  assert.match(text, /install_stable_cli "\$CLI_DIR" "\$CLI_INSTALL_DIR"/);
  assert.match(text, /copy_stable_cli_payload\(\)/);
  assert.match(text, /lock_dir="\$parent_dir\/\.\$base_name\.install\.lock"/);
  assert.match(text, /staging_dir="\$\(mktemp -d "\$parent_dir\/\.\$base_name\.install\.XXXXXX"\)"/);
  assert.match(text, /copy_stable_cli_payload "\$source_dir" "\$staging_dir" "\$install_dir"/);
  assert.match(text, /mv "\$install_dir" "\$backup_dir"/);
  assert.match(text, /mv "\$staging_dir" "\$install_dir"/);
  assert.match(text, /rm -rf "\$backup_dir"/);
  assert.match(text, /cp -R "\$source_dir\/scripts" "\$target_dir\/scripts"/);
  assert.match(text, /cp -R "\$previous_dir\/node_modules" "\$target_dir\/node_modules"/);
  assert.match(text, /npm --prefix "\$target_dir" install --omit=dev --no-audit --no-fund --prefer-offline/);
  assert.match(text, /write_primary_binary "\$PRIMARY_BIN" "\$CLI_TARGET"/);
  assert.match(text, /cp -R "\$source_dir\/runtime-plugins" "\$target_dir\/runtime-plugins"/);
  assert.doesNotMatch(text, /npm pack --pack-destination/);
  assert.doesNotMatch(text, /package_tgz/);
  assert.doesNotMatch(text, /npm install --prefix "\$PREFIX" -g/);
  assert.doesNotMatch(text, /npm install --prefix "\$PREFIX" -g "\$CLI_DIR"/);
});

test("posix installer reuses prebuilt release dist before falling back to a local build", () => {
  const text = script("install-posix.sh");

  assert.match(text, /ensure_cli_dist\(\)/);
  assert.match(text, /\[\[ -f "\$cli_target" \]\]/);
  assert.match(text, /Using prebuilt \$PRODUCT_NAME CLI from release pack/);
  assert.match(text, /ensure_cli_dist "\$CLI_DIR"/);
  assert.ok(text.indexOf('ensure_cli_dist "$CLI_DIR"') < text.indexOf('install_stable_cli "$CLI_DIR" "$CLI_INSTALL_DIR"'));
});

test("installers fail early when Node is older than 22", () => {
  const posix = script("install-posix.sh");
  const windows = script("install-windows.ps1");

  assert.match(posix, /require_node_22/);
  assert.match(posix, /Node\.js >=22 is required before installing \$PRODUCT_NAME/);
  assert.match(windows, /Require-Node22/);
  assert.match(windows, /Node\.js >=22 is required before installing \$ProductName/);
});

test("windows installer contract runs managed setup through agentx install", () => {
  const text = script("install-windows.ps1");

  assert.match(text, /\$script:NodeCommand = Require-Node22/);
  assert.match(text, /\$InstallArgs = @\("--project", \$Project, "install", "--rulesync", \$Rulesync, "--windows"\)/);
  assert.match(text, /\$InstallArgs \+= "--force"/);
  assert.ok(text.indexOf('$InstallArgs += "--force"') < text.indexOf("if ($NoUx)"));
  assert.doesNotMatch(text.match(/if \(\$Force\)[\s\S]*?\n\}/)?.[0] ?? "", /\$InstallArgs \+= "--force"/);
  assert.match(text, /Configuring \$ProductName for/);
  assert.match(text, /\$ProductName install completed with notes; continuing setup/);
  assert.doesNotMatch(text, /install ritual|continuing bootstrap/);
  assert.match(text, /& \$script:NodeCommand \$CliTarget @InstallArgs/);
  assert.match(
    text,
    /Copy-Item -Path \(Join-Path \$SourceDir "scripts"\) -Destination \(Join-Path \$TargetDir "scripts"\) -Recurse -Force/,
  );
  assert.match(
    text,
    /Copy-Item -Path \(Join-Path \$SourceDir "runtime-plugins"\) -Destination \(Join-Path \$TargetDir "runtime-plugins"\) -Recurse -Force/,
  );
  assert.match(text, /\[switch\]\$SkipInstallCheck/);
  assert.match(text, /function Copy-StableCliPayload/);
  assert.match(text, /\$LockDir = Join-Path \$ParentDir "\.\$BaseName\.install\.lock"/);
  assert.match(text, /New-Item -ItemType Directory -Path \$LockDir -ErrorAction Stop/);
  assert.match(text, /Copy-StableCliPayload \$SourceDir \$StagingDir \$InstallDir/);
  assert.match(text, /Move-Item -LiteralPath \$InstallDir -Destination \$BackupDir -Force/);
  assert.match(text, /Move-Item -LiteralPath \$StagingDir -Destination \$InstallDir -Force/);
  assert.doesNotMatch(text, /& \$PrimaryBin @InstallArgs/);
  assert.match(text, /%USERPROFILE%\\\.ai\\opencode-pack\\\$StableCliDirName\\dist\\cli\.js/);
  assert.match(text, /\$PrimaryBin = Join-Path \$Prefix "\$BinaryName\.cmd"/);
  assert.match(text, /\$LegacyBin = Join-Path \$Prefix "\$LegacyBinaryName\.cmd"/);
  assert.match(text, /if \(\$KeepLegacy -and \$LegacyBinaryName -ne \$BinaryName\)/);
  assert.match(text, /--no-ux/);
  assert.match(text, /--no-install-opencode/);
  assert.doesNotMatch(text, /--no-extension-update/);
  assert.match(text, /\$SkipInstallCheck/);
  assert.match(text, /--no-check/);
  assert.match(text, /--reset-global/);
  assert.match(text, /\$InstallStatus = \$LASTEXITCODE/);
  assert.match(text, /\$InstallStatus -eq 1/);
  assert.match(text, /exit \$InstallStatus/);
  assert.doesNotMatch(text, /node `"\$CliTarget`" %\*/);
  assert.doesNotMatch(text, /\bsetup-ux\b/);
  assert.doesNotMatch(text, /\bsetup-opencode\b/);
  assert.doesNotMatch(text, /\bcleanup-home\b/);
  assert.doesNotMatch(text, /\bInvoke-FinalOgbCheck\b/);
});

test("windows installer reuses prebuilt release dist before falling back to a local build", () => {
  const text = script("install-windows.ps1");

  assert.match(text, /function Ensure-CliDist/);
  assert.match(text, /\$CliTarget = Join-Path \$CliDir "dist\\cli\.js"/);
  assert.match(text, /Using prebuilt \$ProductName CLI from release pack/);
  assert.match(text, /Ensure-CliDist \$CliDir/);
  assert.ok(text.indexOf("Ensure-CliDist $CliDir") < text.indexOf("Install-StableCli $CliDir $CliInstallDir"));
});
