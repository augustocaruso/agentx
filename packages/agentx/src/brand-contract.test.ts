import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { BINARY, BOOTSTRAP_TEMP_PREFIX, DISPLAY, GITHUB_REPO, LEGACY_BINARY, LEGACY_RELEASE_ASSET, PACKAGE, RELEASE_ASSET } from "./brand.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const packageRoot = path.join(repoRoot, "packages", "agentx");

function readRepoFile(...parts: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...parts), "utf8");
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listFiles(dir: string, predicate: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...listFiles(full, predicate));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

test("npm package metadata stays aligned with centralized brand constants", () => {
  const packageJson = readJson(path.join(packageRoot, "package.json"));
  const packageLock = readJson(path.join(packageRoot, "package-lock.json"));

  assert.equal(packageJson.name, PACKAGE);
  assert.equal(packageJson.repository.url, `git+https://github.com/${GITHUB_REPO}.git`);
  assert.equal(packageJson.homepage, `https://github.com/${GITHUB_REPO}#readme`);
  assert.equal(packageJson.bugs.url, `https://github.com/${GITHUB_REPO}/issues`);
  assert.equal(packageJson.bin[BINARY], "dist/cli.js");

  assert.equal(packageLock.name, PACKAGE);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].name, PACKAGE);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.equal(packageLock.packages[""].bin[BINARY], "dist/cli.js");
  assert.equal(packageLock.packages[""].bin[LEGACY_BINARY], undefined);
});

test("release workflow centralizes branded artifact names", () => {
  const workflow = readRepoFile(".github", "workflows", "release-pack.yml");

  assert.match(workflow, new RegExp(`PACKAGE_NAME:\\s+${PACKAGE}`));
  assert.match(workflow, /PACKAGE_DIR:\s+packages\/agentx/);
  assert.match(workflow, new RegExp(`RELEASE_ASSET:\\s+${RELEASE_ASSET}`));
  assert.match(workflow, new RegExp(`LEGACY_RELEASE_ASSET:\\s+${LEGACY_RELEASE_ASSET}`));
  assert.match(workflow, /zip -r "\$RELEASE_ASSET"/);
  assert.match(workflow, /cp "\$RELEASE_ASSET" "\$LEGACY_RELEASE_ASSET"/);
  assert.match(workflow, /name: \$\{\{ env\.PACKAGE_NAME \}\}-pack/);
  assert.match(workflow, /path:\s*\|[\s\S]*\$\{\{ env\.RELEASE_ASSET \}\}[\s\S]*\$\{\{ env\.LEGACY_RELEASE_ASSET \}\}/);
  assert.match(workflow, /files:\s*\|[\s\S]*\$\{\{ env\.RELEASE_ASSET \}\}[\s\S]*\$\{\{ env\.LEGACY_RELEASE_ASSET \}\}/);
  assert.match(workflow, /TELEMETRY_LEGACY_DEFAULTS_SCHEMA:\s+opencode-gemini-bridge\.telemetry-defaults\.v1/);
  assert.match(workflow, /j\.schema === process\.env\.TELEMETRY_LEGACY_DEFAULTS_SCHEMA/);
  assert.match(workflow, /j\.schema = process\.env\.TELEMETRY_DEFAULTS_SCHEMA/);
  assert.doesNotMatch(workflow, /opencode-gemini-bridge-\*\.tgz/);
  assert.doesNotMatch(workflow, /npm pack/);
  assert.doesNotMatch(workflow, /\.tgz/);
});

test("public bootstrap scripts keep repo and release asset names centralized", () => {
  for (const name of ["bootstrap-mac.sh", "bootstrap-linux.sh"]) {
    const script = readRepoFile("scripts", name);
    assert.match(script, /PRODUCT_NAME="\$\{AGENTX_PRODUCT_NAME:-agentX\}"/);
    assert.match(script, /DEFAULT_REPO="\$\{AGENTX_GITHUB_REPO:-augustocaruso\/agentx\}"/);
    assert.match(script, /RELEASE_ASSET="\$\{AGENTX_RELEASE_ASSET:-agentx-pack\.zip\}"/);
    assert.match(script, /TEMP_PREFIX="\$\{AGENTX_TEMP_PREFIX:-agentx-bootstrap\}"/);
    assert.match(script, /ZIP_NAME="\$\{AGENTX_RELEASE_ZIP_NAME:-agentx\.zip\}"/);
    assert.match(script, /REPO="\$\{OGB_GITHUB_REPO:-\$DEFAULT_REPO\}"/);
    assert.match(script, /RELEASE_URL="https:\/\/github\.com\/\$REPO\/releases\/latest\/download\/\$RELEASE_ASSET"/);
    assert.match(script, /echo "Downloading \$PRODUCT_NAME from \$RELEASE_URL\.\.\."/);
    assert.doesNotMatch(script, /ogb-bootstrap|ogb\.zip/);
  }
});

test("Windows bootstrap keeps repo and release asset names centralized", () => {
  const script = readRepoFile("scripts", "bootstrap-windows.ps1");

  assert.match(script, /\$ProductName = if \(\$env:AGENTX_PRODUCT_NAME\) \{ \$env:AGENTX_PRODUCT_NAME \} else \{ "agentX" \}/);
  assert.match(script, /\$DefaultRepo = if \(\$env:AGENTX_GITHUB_REPO\) \{ \$env:AGENTX_GITHUB_REPO \} else \{ "augustocaruso\/agentx" \}/);
  assert.match(script, /\$ReleaseAsset = if \(\$env:AGENTX_RELEASE_ASSET\) \{ \$env:AGENTX_RELEASE_ASSET \} else \{ "agentx-pack\.zip" \}/);
  assert.match(script, /\$ZipName = if \(\$env:AGENTX_RELEASE_ZIP_NAME\) \{ \$env:AGENTX_RELEASE_ZIP_NAME \} else \{ "agentx\.zip" \}/);
  assert.match(script, /\$Repo = if \(\$Repo\) \{ \$Repo \} elseif \(\$env:OGB_GITHUB_REPO\) \{ \$env:OGB_GITHUB_REPO \} else \{ \$DefaultRepo \}/);
  assert.match(script, /releases\/latest\/download\/\$ReleaseAsset/);
  assert.match(script, /Write-Host "Downloading \$ProductName from \$ReleaseUrl\.\.\."/);
  assert.doesNotMatch(script, /ogb\.zip/);
});

test("display brand is the canonical public product name", () => {
  assert.equal(DISPLAY, "agentX");
});

const guardedBrandFiles = [
  ".github/workflows/release-pack.yml",
  "scripts/bootstrap-mac.sh",
  "scripts/bootstrap-linux.sh",
  "scripts/bootstrap-windows.ps1",
  "scripts/install-posix.sh",
  "scripts/install-windows.ps1",
];

const allowedBrandLiteralReferences: Record<string, RegExp[]> = {
  ".github/workflows/release-pack.yml": [
    /^\s*PACKAGE_NAME: agentx\s*$/,
    /^\s*PACKAGE_DIR: packages\/agentx\s*$/,
    /^\s*RELEASE_ASSET: agentx-pack\.zip\s*$/,
    /^\s*LEGACY_RELEASE_ASSET: opencode-gemini-bridge-pack\.zip\s*$/,
    /^\s*TELEMETRY_DEFAULTS_SCHEMA: agentx\.telemetry-defaults\.v2\s*$/,
    /^\s*TELEMETRY_LEGACY_DEFAULTS_SCHEMA: opencode-gemini-bridge\.telemetry-defaults\.v1\s*$/,
    /OGB_TELEMETRY_DEFAULTS_JSON/,
    /\$\{\{\s*env\.PACKAGE_NAME\s*\}\}/,
    /\$\{\{\s*env\.PACKAGE_DIR\s*\}\}/,
    /\$\{\{\s*env\.LEGACY_RELEASE_ASSET\s*\}\}/,
  ],
  "scripts/bootstrap-mac.sh": [
    /^\s*AGENTX_GITHUB_REPO=\$DEFAULT_REPO bash bootstrap-mac\.sh /,
    /^PRODUCT_NAME="\$\{AGENTX_PRODUCT_NAME:-agentX\}"$/,
    /^DEFAULT_REPO="\$\{AGENTX_GITHUB_REPO:-augustocaruso\/agentx\}"$/,
    /^RELEASE_ASSET="\$\{AGENTX_RELEASE_ASSET:-agentx-pack\.zip\}"$/,
    /^TEMP_PREFIX="\$\{AGENTX_TEMP_PREFIX:-agentx-bootstrap\}"$/,
    /^ZIP_NAME="\$\{AGENTX_RELEASE_ZIP_NAME:-agentx\.zip\}"$/,
    /^LEGACY_BINARY_NAME="\$\{AGENTX_LEGACY_BINARY:-ogb\}"$/,
    /^LEGACY_PACKAGE_NAME="\$\{AGENTX_LEGACY_PACKAGE:-opencode-gemini-bridge\}"$/,
    /^LEGACY_STABLE_CLI_DIR_NAME="\$\{AGENTX_LEGACY_STABLE_CLI_DIR:-opencode-gemini-bridge-cli\}"$/,
    /^REPO="\$\{OGB_GITHUB_REPO:-\$DEFAULT_REPO\}"$/,
    /^VERSION="\$\{OGB_RELEASE_VERSION:-latest\}"$/,
  ],
  "scripts/bootstrap-linux.sh": [
    /^\s*AGENTX_GITHUB_REPO=\$DEFAULT_REPO bash bootstrap-linux\.sh /,
    /^PRODUCT_NAME="\$\{AGENTX_PRODUCT_NAME:-agentX\}"$/,
    /^DEFAULT_REPO="\$\{AGENTX_GITHUB_REPO:-augustocaruso\/agentx\}"$/,
    /^RELEASE_ASSET="\$\{AGENTX_RELEASE_ASSET:-agentx-pack\.zip\}"$/,
    /^TEMP_PREFIX="\$\{AGENTX_TEMP_PREFIX:-agentx-bootstrap\}"$/,
    /^ZIP_NAME="\$\{AGENTX_RELEASE_ZIP_NAME:-agentx\.zip\}"$/,
    /^LEGACY_BINARY_NAME="\$\{AGENTX_LEGACY_BINARY:-ogb\}"$/,
    /^LEGACY_PACKAGE_NAME="\$\{AGENTX_LEGACY_PACKAGE:-opencode-gemini-bridge\}"$/,
    /^LEGACY_STABLE_CLI_DIR_NAME="\$\{AGENTX_LEGACY_STABLE_CLI_DIR:-opencode-gemini-bridge-cli\}"$/,
    /^REPO="\$\{OGB_GITHUB_REPO:-\$DEFAULT_REPO\}"$/,
    /^VERSION="\$\{OGB_RELEASE_VERSION:-latest\}"$/,
  ],
  "scripts/bootstrap-windows.ps1": [
    /^\$ProductName = if \(\$env:AGENTX_PRODUCT_NAME\) \{ \$env:AGENTX_PRODUCT_NAME \} else \{ "agentX" \}$/,
    /^\$DefaultRepo = if \(\$env:AGENTX_GITHUB_REPO\) \{ \$env:AGENTX_GITHUB_REPO \} else \{ "augustocaruso\/agentx" \}$/,
    /^\$ReleaseAsset = if \(\$env:AGENTX_RELEASE_ASSET\) \{ \$env:AGENTX_RELEASE_ASSET \} else \{ "agentx-pack\.zip" \}$/,
    /^\$StateDirName = if \(\$env:AGENTX_STATE_DIR\) \{ \$env:AGENTX_STATE_DIR \} else \{ "agentx" \}$/,
    /^\$TempPrefix = if \(\$env:AGENTX_TEMP_PREFIX\) \{ \$env:AGENTX_TEMP_PREFIX \} else \{ "agentx-bootstrap" \}$/,
    /^\$ZipName = if \(\$env:AGENTX_RELEASE_ZIP_NAME\) \{ \$env:AGENTX_RELEASE_ZIP_NAME \} else \{ "agentx\.zip" \}$/,
    /^\$LegacyBinaryName = if \(\$env:AGENTX_LEGACY_BINARY\) \{ \$env:AGENTX_LEGACY_BINARY \} else \{ "ogb" \}$/,
    /^\$LegacyPackageName = if \(\$env:AGENTX_LEGACY_PACKAGE\) \{ \$env:AGENTX_LEGACY_PACKAGE \} else \{ "opencode-gemini-bridge" \}$/,
    /^\$LegacyStableCliDirName = if \(\$env:AGENTX_LEGACY_STABLE_CLI_DIR\) \{ \$env:AGENTX_LEGACY_STABLE_CLI_DIR \} else \{ "opencode-gemini-bridge-cli" \}$/,
    /^\$Repo = if \(\$Repo\) \{ \$Repo \} elseif \(\$env:OGB_GITHUB_REPO\) \{ \$env:OGB_GITHUB_REPO \} else \{ \$DefaultRepo \}$/,
    /^\$Version = if \(\$Version\) \{ \$Version \} elseif \(\$env:OGB_RELEASE_VERSION\) \{ \$env:OGB_RELEASE_VERSION \} else \{ "latest" \}$/,
  ],
  "scripts/install-posix.sh": [
    /^PRODUCT_NAME="\$\{AGENTX_PRODUCT_NAME:-agentX\}"$/,
    /^BINARY_NAME="\$\{AGENTX_BINARY:-agentx\}"$/,
    /^LEGACY_BINARY_NAME="\$\{AGENTX_LEGACY_BINARY:-ogb\}"$/,
    /^PACKAGE_NAME="\$\{AGENTX_PACKAGE:-agentx\}"$/,
    /^LEGACY_PACKAGE_NAME="\$\{AGENTX_LEGACY_PACKAGE:-opencode-gemini-bridge\}"$/,
    /^STABLE_CLI_DIR_NAME="\$\{AGENTX_STABLE_CLI_DIR:-\$PACKAGE_NAME-cli\}"$/,
    /^LEGACY_STABLE_CLI_DIR_NAME="\$\{AGENTX_LEGACY_STABLE_CLI_DIR:-opencode-gemini-bridge-cli\}"$/,
    /^STATE_DIR_NAME="\$\{AGENTX_STATE_DIR:-agentx\}"$/,
    /^SOURCE_PACKAGE_DIR="\$\{AGENTX_SOURCE_PACKAGE_DIR:-agentx\}"$/,
    /\bAGENTX_PREFIX\b/,
    /\bOGB_PREFIX\b/,
  ],
  "scripts/install-windows.ps1": [
    /^\$ProductName = if \(\$env:AGENTX_PRODUCT_NAME\) \{ \$env:AGENTX_PRODUCT_NAME \} else \{ "agentX" \}$/,
    /^\$BinaryName = if \(\$env:AGENTX_BINARY\) \{ \$env:AGENTX_BINARY \} else \{ "agentx" \}$/,
    /^\$LegacyBinaryName = if \(\$env:AGENTX_LEGACY_BINARY\) \{ \$env:AGENTX_LEGACY_BINARY \} else \{ "ogb" \}$/,
    /^\$PackageName = if \(\$env:AGENTX_PACKAGE\) \{ \$env:AGENTX_PACKAGE \} else \{ "agentx" \}$/,
    /^\$LegacyPackageName = if \(\$env:AGENTX_LEGACY_PACKAGE\) \{ \$env:AGENTX_LEGACY_PACKAGE \} else \{ "opencode-gemini-bridge" \}$/,
    /^\$StableCliDirName = if \(\$env:AGENTX_STABLE_CLI_DIR\) \{ \$env:AGENTX_STABLE_CLI_DIR \} else \{ "\$PackageName-cli" \}$/,
    /^\$LegacyStableCliDirName = if \(\$env:AGENTX_LEGACY_STABLE_CLI_DIR\) \{ \$env:AGENTX_LEGACY_STABLE_CLI_DIR \} else \{ "opencode-gemini-bridge-cli" \}$/,
    /^\$StateDirName = if \(\$env:AGENTX_STATE_DIR\) \{ \$env:AGENTX_STATE_DIR \} else \{ "agentx" \}$/,
    /^\$SourcePackageDirName = if \(\$env:AGENTX_SOURCE_PACKAGE_DIR\) \{ \$env:AGENTX_SOURCE_PACKAGE_DIR \} else \{ "agentx" \}$/,
  ],
};

test("release/install surfaces keep raw brand literals only in reference declarations", () => {
  const brandLiteral = /\b(?:agentx|agentX|AGENTX|ogb|OGB|opencode-gemini-bridge)\b/;
  const violations: string[] = [];

  for (const file of guardedBrandFiles) {
    const text = readRepoFile(...file.split("/"));
    const allowed = allowedBrandLiteralReferences[file] ?? [];
    text.split(/\r?\n/).forEach((line, index) => {
      if (!brandLiteral.test(line)) return;
      if (allowed.some((pattern) => pattern.test(line))) return;
      violations.push(`${file}:${index + 1}: ${line}`);
    });
  }

  assert.deepEqual(violations, []);
});

test("validation release/install summaries interpolate brand constants", () => {
  const validation = readRepoFile("packages", "agentx", "src", "validation.ts");

  assert.match(validation, /thin installers run \$\{BINARY\} install/);
  assert.match(validation, /runs managed setup through the \$\{BINARY\} CLI/);
  assert.doesNotMatch(validation, /agentx CLI/);
  assert.doesNotMatch(validation, /ogb CLI/);
  assert.doesNotMatch(validation, /agentX installer/);
  assert.doesNotMatch(validation, /install ritual/);
});

test("CLI setup command help interpolates the binary brand", () => {
  const cli = readRepoFile("packages", "agentx", "src", "cli.ts");

  assert.match(cli, /Command used by the startup plugin instead of the current \$\{BINARY\} CLI/);
  assert.doesNotMatch(cli, /current (?:ogb|agentx) CLI/i);
});

test("self-update bootstrap temp names use the brand reference", () => {
  const selfUpdate = readRepoFile("packages", "agentx", "src", "self-update.ts");

  assert.equal(BOOTSTRAP_TEMP_PREFIX, `${BINARY}-bootstrap`);
  assert.match(selfUpdate, /BOOTSTRAP_TEMP_PREFIX/);
  assert.doesNotMatch(selfUpdate, /ogb-bootstrap/);
});

test("public source copy does not leak legacy brand or PT-BR remediation text", () => {
  const scanned = [
    ...listFiles(path.join(packageRoot, "src"), (file) =>
      file.endsWith(".ts")
      && !file.endsWith(".test.ts")
      && !file.endsWith(".d.ts")
    ),
    path.join(packageRoot, "telemetry-email-worker", "worker.js"),
    path.join(packageRoot, "scripts", "gemini_antigravity_converter.py"),
    path.join(packageRoot, "schemas", "inventory.schema.json"),
    path.join(repoRoot, "scripts", "expand-gemini.mjs"),
    path.join(repoRoot, "scripts", "expand-gemini.ps1"),
  ];
  const forbidden = [
    /OpenCode Gemini Bridge/,
    /managed by ogb/i,
    /current ogb/i,
    /ogb resolves to/i,
    /\bOGB update\b/,
    /\bselected OGB\b/,
    /\b(?:Rode|Revise|gerenciados|conflitos|sobrescrever|indisponivel|falhou|limpo|diagnostico|proximos|avisos)\b/,
  ];
  const allowed = (relFile: string, line: string): boolean => {
    if (relFile === "packages/agentx/src/brand.ts") return /LEGACY_|publicBrandText|replace/.test(line);
    if (relFile === "packages/agentx/src/telemetry.ts" || relFile === "packages/agentx/telemetry-email-worker/worker.js") {
      return /generated by ogb|current ogb|ogb global binary|ogb resolves to|passou com avisos|precisa reiniciar|foi atualizado automaticamente/.test(line)
        || /X-OGB-Telemetry-Schema/.test(line);
    }
    if (relFile === "packages/agentx/src/pass.ts") return /Global \(\?:OGB\|agentX\)/.test(line);
    if (relFile === "packages/agentx/src/sync.ts") return /<!-- OGB/.test(line);
    return false;
  };
  const violations: string[] = [];

  for (const file of scanned) {
    const relFile = path.relative(repoRoot, file).replace(/\\/g, "/");
    const text = fs.readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      if (!forbidden.some((pattern) => pattern.test(line))) return;
      if (allowed(relFile, line)) return;
      violations.push(`${relFile}:${index + 1}: ${line.trim()}`);
    });
  }

  assert.deepEqual(violations, []);
});
