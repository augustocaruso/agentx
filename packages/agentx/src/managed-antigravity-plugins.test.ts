import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  antigravityPluginDestinations,
  managedAntigravityPluginSpecs,
  updateManagedAntigravityPlugins,
  type ManagedAntigravityPluginSpec,
} from "./managed-antigravity-plugins.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentx-agy-plugin-"));
}

function writePluginSource(root: string, pluginName = "medical-notes-workbench"): string {
  const sourceDir = path.join(root, "source");
  fs.mkdirSync(path.join(sourceDir, "skills", "mednotes-status"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "plugin.json"), `${JSON.stringify({ name: pluginName }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(sourceDir, "README.md"), "MedNotes Antigravity plugin\n", "utf8");
  fs.writeFileSync(path.join(sourceDir, "skills", "mednotes-status", "SKILL.md"), "# Status\n", "utf8");
  return sourceDir;
}

function writeGeminiExtension(homeDir: string, name = "medical-notes-workbench"): void {
  const extensionDir = path.join(homeDir, ".gemini", "extensions", name);
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), `${JSON.stringify({ name })}\n`, "utf8");
}

function mednotesSpec(overrides: Partial<ManagedAntigravityPluginSpec> = {}): ManagedAntigravityPluginSpec {
  const spec = managedAntigravityPluginSpecs().find((item) => item.pluginName === "medical-notes-workbench");
  assert.ok(spec, "expected MedNotes to be declared as a managed Antigravity plugin");
  return { ...spec, ...overrides };
}

test("managed Antigravity plugin specs come from the native capability registry", () => {
  const spec = mednotesSpec();

  assert.equal(spec.entityId, "medical-notes-workbench");
  assert.equal(spec.source, "https://github.com/augustocaruso/medical-notes-workbench.git");
  assert.equal(spec.ref, "antigravity-plugin");
  assert.equal(spec.pluginName, "medical-notes-workbench");
});

test("Antigravity plugin destinations follow the Agy global plugin layout and existing import mirror", () => {
  const homeDir = tempRoot();
  const mirror = path.join(homeDir, ".gemini", "antigravity-cli", "plugins", "medical-notes-workbench");
  fs.mkdirSync(mirror, { recursive: true });

  const destinations = antigravityPluginDestinations(mednotesSpec(), homeDir);

  assert.equal(destinations.primary, path.join(homeDir, ".gemini", "config", "plugins", "medical-notes-workbench"));
  assert.deepEqual(destinations.mirrors, [mirror]);
});

test("updateManagedAntigravityPlugins installs MedNotes when the Gemini extension and Agy CLI are present", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const sourceDir = writePluginSource(root);
  writeGeminiExtension(homeDir);
  let fetched = false;

  const report = updateManagedAntigravityPlugins({
    projectRoot,
    homeDir,
    specs: [mednotesSpec()],
    detectAntigravityCli: () => true,
    fetchPluginSource: () => {
      fetched = true;
      return { sourceDir, revision: "rev-1" };
    },
  });

  const destination = path.join(homeDir, ".gemini", "config", "plugins", "medical-notes-workbench");
  assert.equal(report.outcome, "pass");
  assert.equal(fetched, true);
  assert.equal(report.plugins[0]?.status, "installed");
  assert.equal(fs.existsSync(path.join(destination, "plugin.json")), true);
  assert.equal(fs.existsSync(path.join(destination, "skills", "mednotes-status", "SKILL.md")), true);
  assert.match(
    fs.readFileSync(path.join(homeDir, ".config", "agentx", "antigravity-plugins", "medical-notes-workbench.json"), "utf8"),
    /"revision": "rev-1"/,
  );
});

test("updateManagedAntigravityPlugins skips Gemini-extension-triggered installs when Agy CLI is missing", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  writeGeminiExtension(homeDir);
  let fetched = false;

  const report = updateManagedAntigravityPlugins({
    projectRoot,
    homeDir,
    specs: [mednotesSpec()],
    detectAntigravityCli: () => false,
    fetchPluginSource: () => {
      fetched = true;
      throw new Error("should not fetch without Agy CLI");
    },
  });

  const destination = path.join(homeDir, ".gemini", "config", "plugins", "medical-notes-workbench");
  assert.equal(report.outcome, "pass");
  assert.equal(fetched, false);
  assert.equal(report.plugins[0]?.status, "skipped");
  assert.match(report.plugins[0]?.reason ?? "", /Antigravity CLI is not installed/);
  assert.equal(fs.existsSync(destination), false);
});

test("updateManagedAntigravityPlugins repairs an existing Antigravity import mirror", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const sourceDir = writePluginSource(root);
  const mirror = path.join(homeDir, ".gemini", "antigravity-cli", "plugins", "medical-notes-workbench");
  fs.mkdirSync(mirror, { recursive: true });
  fs.writeFileSync(path.join(mirror, "stale.txt"), "old\n", "utf8");

  const report = updateManagedAntigravityPlugins({
    projectRoot,
    homeDir,
    specs: [mednotesSpec()],
    detectAntigravityCli: () => true,
    fetchPluginSource: () => ({ sourceDir, revision: "rev-2" }),
  });

  assert.equal(report.outcome, "pass");
  assert.equal(report.plugins[0]?.status, "updated");
  assert.equal(fs.existsSync(path.join(mirror, "stale.txt")), false);
  assert.equal(fs.existsSync(path.join(mirror, "plugin.json")), true);
});

test("updateManagedAntigravityPlugins skips inactive managed plugins without fetching", () => {
  const root = tempRoot();
  let fetched = false;

  const report = updateManagedAntigravityPlugins({
    projectRoot: path.join(root, "project"),
    homeDir: path.join(root, "home"),
    specs: [mednotesSpec()],
    detectAntigravityCli: () => true,
    fetchPluginSource: () => {
      fetched = true;
      throw new Error("should not fetch inactive plugin");
    },
  });

  assert.equal(report.outcome, "pass");
  assert.equal(report.plugins[0]?.status, "skipped");
  assert.equal(fetched, false);
});

test("updateManagedAntigravityPlugins previews active plugins without network or writes", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  writeGeminiExtension(homeDir);

  const report = updateManagedAntigravityPlugins({
    projectRoot: path.join(root, "project"),
    homeDir,
    dryRun: true,
    specs: [mednotesSpec()],
    detectAntigravityCli: () => true,
    fetchPluginSource: () => {
      throw new Error("dry-run should not fetch");
    },
  });

  const destination = path.join(homeDir, ".gemini", "config", "plugins", "medical-notes-workbench");
  assert.equal(report.outcome, "preview");
  assert.equal(report.plugins[0]?.status, "preview");
  assert.equal(fs.existsSync(destination), false);
});
