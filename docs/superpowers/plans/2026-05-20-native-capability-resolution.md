# Native Capability Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native capability resolver so OGB prefers known validated native installs, falls back to managed compatibility ports, and can model cross-target entity replication such as Honcho.

**Architecture:** Add a static capability registry and resolver before projection. `sync` asks the resolver which OpenCode plugins to enable and which compatibility ports to suppress or remove; `doctor` reports native/fallback decisions. Honcho cross-target support starts as explicit registry/adapter data plus managed setup-skill projection for Gemini and Antigravity when the OpenCode native plugin is validated.

**Tech Stack:** TypeScript ESM, `node:test`, `jsonc-parser`, existing OGB sync state/backups, OpenCode `opencode.jsonc` plugin array.

---

## Scope Check

This plan covers one implementation slice:

- Native capability registry and resolver.
- OpenCode-native plugin preference for known entities, starting with Superpowers.
- Safe compatibility-port suppression/removal for OGB-managed projections.
- Doctor/check reporting.
- Honcho as a cross-target adapter model, with setup surface metadata and a minimal managed setup skill for Gemini/Antigravity targets that lack native setup commands.

Full Gemini CLI or Antigravity CLI target modes are still future work. The current implemented slice writes only the explicit `honcho-setup` compatibility skill and preserves secrets/config in shared local state, not in generated files.

## File Structure

- Create `packages/ogb/src/native-capability-registry.ts`
  Static registry, entity detection helpers, plugin package normalization.
- Create `packages/ogb/src/native-capability-resolver.ts`
  Pure decision engine and report writer.
- Create `packages/ogb/src/native-capability-resolver.test.ts`
  Unit tests for registry, decisions, native install preference, fallback, and Honcho cross-target modeling.
- Modify `packages/ogb/src/paths.ts`
  Add generated report path `nativeCapabilitiesPath`.
- Modify `packages/ogb/src/sync.ts`
  Call resolver before `ensureProjectConfig`; add native plugin specs; pass suppressed extension names into skill projection; include native decision summary in `SyncReport`.
- Modify `packages/ogb/src/doctor.ts`
  Read native capability report and include it in `DoctorReport`.
- Modify `packages/ogb/src/sync.test.ts`
  Add integration tests for Superpowers plugin preference and managed port removal.
- Modify `packages/ogb/src/doctor.test.ts`
  Add reporting tests.

## Task 1: Add Capability Registry

**Files:**
- Create: `packages/ogb/src/native-capability-registry.ts`
- Test: `packages/ogb/src/native-capability-resolver.test.ts`

- [ ] **Step 1: Write failing registry tests**

Add this new test file:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilityEntry,
  entityIdFromGeminiExtensionName,
  nativeCapabilityEntriesForTarget,
  pluginPackageName,
} from "./native-capability-registry.js";

test("native capability registry exposes Superpowers as OpenCode-native", () => {
  const entry = capabilityEntry("superpowers", "opencode");

  assert.equal(entry?.entityId, "superpowers");
  assert.equal(entry?.target, "opencode");
  assert.equal(entry?.nativeStatus, "available");
  assert.equal(entry?.nativeInstall?.plugin, "superpowers@git+https://github.com/obra/superpowers.git");
  assert.deepEqual(entry?.managedPortPrefixes, [
    ".opencode/skills/",
    ".config/opencode/skills/",
  ]);
});

test("native capability registry models Honcho cross-target fallback surfaces", () => {
  const opencode = capabilityEntry("honcho", "opencode");
  const gemini = capabilityEntry("honcho", "gemini-cli");
  const antigravity = capabilityEntry("honcho", "antigravity-cli");

  assert.equal(opencode?.nativeStatus, "available");
  assert.equal(opencode?.nativeInstall?.plugin, "@honcho-ai/opencode-honcho");
  assert.equal(gemini?.nativeStatus, "not_available");
  assert.equal(antigravity?.nativeStatus, "not_available");
  assert.deepEqual(gemini?.portableSurfaces, ["mcp", "config", "prompts", "commands", "hooks"]);
  assert.equal(gemini?.surfacesNeedingReview.includes("hooks"), true);
});

test("pluginPackageName normalizes npm, scoped, versioned, git, and file specs", () => {
  assert.equal(pluginPackageName("opencode-auto-fallback@0.4.3"), "opencode-auto-fallback");
  assert.equal(pluginPackageName("@honcho-ai/opencode-honcho@1.2.3"), "@honcho-ai/opencode-honcho");
  assert.equal(pluginPackageName("superpowers@git+https://github.com/obra/superpowers.git"), "superpowers");
  assert.equal(pluginPackageName("file:///tmp/plugin.js"), "file:///tmp/plugin.js");
});

test("entityIdFromGeminiExtensionName recognizes known entities conservatively", () => {
  assert.equal(entityIdFromGeminiExtensionName("superpowers"), "superpowers");
  assert.equal(entityIdFromGeminiExtensionName("gemini-superpowers"), "superpowers");
  assert.equal(entityIdFromGeminiExtensionName("medical-notes-workbench"), undefined);
});

test("nativeCapabilityEntriesForTarget returns stable sorted entries", () => {
  const entries = nativeCapabilityEntriesForTarget("opencode").map((entry) => entry.entityId);
  assert.deepEqual(entries, [...entries].sort());
  assert.equal(entries.includes("superpowers"), true);
  assert.equal(entries.includes("honcho"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd packages/ogb
npm test -- src/native-capability-resolver.test.ts
```

Expected: FAIL with module-not-found errors for `native-capability-registry.js`.

- [ ] **Step 3: Implement registry**

Create `packages/ogb/src/native-capability-registry.ts`:

```ts
export type NativeCapabilityTarget = "opencode" | "gemini-cli" | "antigravity-cli" | "antigravity-legacy";
export type NativeCapabilityEntityId = "superpowers" | "honcho";
export type NativeCapabilityStatus = "available" | "not_available" | "experimental" | "blocked";
export type NativeSurface = "skills" | "mcp" | "config" | "prompts" | "commands" | "hooks" | "agents";

export interface NativeInstallSpec {
  kind: "opencode-plugin";
  plugin: string;
  installCommand?: string[];
}

export interface NativeCapabilityEntry {
  entityId: NativeCapabilityEntityId;
  target: NativeCapabilityTarget;
  nativeStatus: NativeCapabilityStatus;
  nativeInstall?: NativeInstallSpec;
  portableSurfaces: NativeSurface[];
  surfacesNeedingReview: NativeSurface[];
  managedPortPrefixes: string[];
  docs: string[];
  notes: string[];
}

export const NATIVE_CAPABILITY_REGISTRY: readonly NativeCapabilityEntry[] = [
  {
    entityId: "superpowers",
    target: "opencode",
    nativeStatus: "available",
    nativeInstall: {
      kind: "opencode-plugin",
      plugin: "superpowers@git+https://github.com/obra/superpowers.git",
      installCommand: ["opencode", "plugin", "superpowers@git+https://github.com/obra/superpowers.git", "--global"],
    },
    portableSurfaces: ["skills"],
    surfacesNeedingReview: [],
    managedPortPrefixes: [".opencode/skills/", ".config/opencode/skills/"],
    docs: ["https://github.com/obra/superpowers/blob/main/docs/README.opencode.md"],
    notes: ["Prefer the native OpenCode plugin when the runtime smoke proves skills are visible."],
  },
  {
    entityId: "honcho",
    target: "opencode",
    nativeStatus: "available",
    nativeInstall: {
      kind: "opencode-plugin",
      plugin: "@honcho-ai/opencode-honcho",
      installCommand: ["opencode", "plugin", "@honcho-ai/opencode-honcho", "--global"],
    },
    portableSurfaces: ["mcp", "config", "prompts", "commands", "hooks"],
    surfacesNeedingReview: [],
    managedPortPrefixes: [".opencode/commands/honcho", ".opencode/plugins/honcho"],
    docs: ["https://honcho.dev/docs/v3/guides/integrations/opencode"],
    notes: ["OpenCode is the richest known Honcho host; use it as an explicit source adapter only for the honcho entity."],
  },
  {
    entityId: "honcho",
    target: "gemini-cli",
    nativeStatus: "not_available",
    portableSurfaces: ["mcp", "config", "prompts", "commands", "hooks"],
    surfacesNeedingReview: ["prompts", "commands", "hooks"],
    managedPortPrefixes: [".gemini/settings.json#mcpServers/honcho"],
    docs: ["https://honcho.dev/docs/v3/guides/integrations/mcp"],
    notes: ["Use MCP metadata as the first compatibility surface; prompt/command/hook projection requires explicit adapter tests."],
  },
  {
    entityId: "honcho",
    target: "antigravity-cli",
    nativeStatus: "not_available",
    portableSurfaces: ["mcp", "config", "prompts", "commands", "hooks"],
    surfacesNeedingReview: ["prompts", "commands", "hooks"],
    managedPortPrefixes: [".gemini/antigravity-cli/mcp_config.json#mcpServers/honcho"],
    docs: ["https://honcho.dev/docs/v3/guides/integrations/mcp"],
    notes: ["Keep compatibility data explicit until a native Antigravity CLI plugin exists and passes smoke."],
  },
  {
    entityId: "superpowers",
    target: "antigravity-cli",
    nativeStatus: "not_available",
    portableSurfaces: ["skills"],
    surfacesNeedingReview: [],
    managedPortPrefixes: [".gemini/antigravity-cli/plugins/superpowers", ".gemini/antigravity-cli/skills/superpowers"],
    docs: ["https://github.com/obra/superpowers/blob/main/docs/README.opencode.md"],
    notes: ["Antigravity CLI support starts as a managed port until a native plugin is known and validatable."],
  },
] as const;

export function pluginPackageName(plugin: string): string {
  const trimmed = plugin.trim();
  if (trimmed.startsWith("file:")) return trimmed;
  const gitMarker = trimmed.indexOf("@git+");
  if (gitMarker > 0 && !trimmed.startsWith("@")) return trimmed.slice(0, gitMarker);
  if (trimmed.startsWith("@")) {
    const atVersion = trimmed.indexOf("@", 1);
    return atVersion > 0 ? trimmed.slice(0, atVersion) : trimmed;
  }
  return trimmed.split("@")[0] || trimmed;
}

export function nativeCapabilityEntriesForTarget(target: NativeCapabilityTarget): NativeCapabilityEntry[] {
  return NATIVE_CAPABILITY_REGISTRY
    .filter((entry) => entry.target === target)
    .slice()
    .sort((a, b) => a.entityId.localeCompare(b.entityId));
}

export function capabilityEntry(entityId: NativeCapabilityEntityId, target: NativeCapabilityTarget): NativeCapabilityEntry | undefined {
  return NATIVE_CAPABILITY_REGISTRY.find((entry) => entry.entityId === entityId && entry.target === target);
}

export function entityIdFromGeminiExtensionName(name: string): NativeCapabilityEntityId | undefined {
  const normalized = name.trim().toLowerCase();
  if (normalized === "superpowers" || normalized.endsWith("-superpowers") || normalized.includes("superpowers")) return "superpowers";
  if (normalized === "honcho" || normalized.endsWith("-honcho") || normalized.includes("honcho")) return "honcho";
  return undefined;
}
```

- [ ] **Step 4: Run registry test**

Run:

```bash
cd packages/ogb
npm test -- src/native-capability-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ogb/src/native-capability-registry.ts packages/ogb/src/native-capability-resolver.test.ts
git commit -m "feat: add native capability registry"
```

## Task 2: Add Resolver Decisions

**Files:**
- Modify: `packages/ogb/src/native-capability-resolver.test.ts`
- Create: `packages/ogb/src/native-capability-resolver.ts`

- [ ] **Step 1: Add failing resolver tests**

Append to `packages/ogb/src/native-capability-resolver.test.ts`:

```ts
import {
  resolveNativeCapabilities,
  type NativeSmokeProbe,
} from "./native-capability-resolver.js";

test("resolveNativeCapabilities installs OpenCode native plugin when known and smoke validates", () => {
  const smoke: NativeSmokeProbe = () => ({ status: "validated", message: "skills visible" });
  const report = resolveNativeCapabilities({
    target: "opencode",
    presentEntities: ["superpowers"],
    configuredPlugins: [],
    smoke,
  });

  assert.equal(report.decisions[0].entityId, "superpowers");
  assert.equal(report.decisions[0].action, "install_native");
  assert.deepEqual(report.openCodePluginsToEnable, ["superpowers@git+https://github.com/obra/superpowers.git"]);
  assert.deepEqual(report.suppressedGeminiExtensionEntities, ["superpowers"]);
});

test("resolveNativeCapabilities keeps compatibility when native smoke cannot validate", () => {
  const smoke: NativeSmokeProbe = () => ({ status: "unavailable", message: "OpenCode skill list is unavailable" });
  const report = resolveNativeCapabilities({
    target: "opencode",
    presentEntities: ["superpowers"],
    configuredPlugins: [],
    smoke,
  });

  assert.equal(report.decisions[0].action, "fallback_compat");
  assert.deepEqual(report.openCodePluginsToEnable, ["superpowers@git+https://github.com/obra/superpowers.git"]);
  assert.deepEqual(report.suppressedGeminiExtensionEntities, []);
  assert.match(report.warnings[0], /Native capability not validated/);
});

test("resolveNativeCapabilities reuses existing validated native plugin", () => {
  const smoke: NativeSmokeProbe = () => ({ status: "validated", message: "already active" });
  const report = resolveNativeCapabilities({
    target: "opencode",
    presentEntities: ["superpowers"],
    configuredPlugins: ["superpowers@git+https://github.com/obra/superpowers.git"],
    smoke,
  });

  assert.equal(report.decisions[0].action, "use_existing_native");
  assert.deepEqual(report.openCodePluginsToEnable, []);
  assert.deepEqual(report.suppressedGeminiExtensionEntities, ["superpowers"]);
});

test("resolveNativeCapabilities models Honcho Gemini CLI as explicit cross-target fallback", () => {
  const report = resolveNativeCapabilities({
    target: "gemini-cli",
    presentEntities: ["honcho"],
    configuredPlugins: [],
  });

  assert.equal(report.decisions[0].entityId, "honcho");
  assert.equal(report.decisions[0].action, "fallback_compat");
  assert.equal(report.decisions[0].sourceTarget, "opencode");
  assert.equal(report.decisions[0].portableSurfaces.includes("mcp"), true);
  assert.equal(report.decisions[0].surfacesNeedingReview.includes("hooks"), true);
});
```

- [ ] **Step 2: Run resolver tests to verify failure**

Run:

```bash
cd packages/ogb
npm test -- src/native-capability-resolver.test.ts
```

Expected: FAIL with module-not-found errors for `native-capability-resolver.js`.

- [ ] **Step 3: Implement resolver**

Create `packages/ogb/src/native-capability-resolver.ts`:

```ts
import {
  capabilityEntry,
  nativeCapabilityEntriesForTarget,
  pluginPackageName,
  type NativeCapabilityEntityId,
  type NativeCapabilityTarget,
  type NativeSurface,
} from "./native-capability-registry.js";
import { OGB_VERSION } from "./types.js";

export type NativeDecisionAction = "use_existing_native" | "install_native" | "fallback_compat" | "blocked";
export type NativeSmokeStatus = "validated" | "failed" | "unavailable";

export interface NativeSmokeResult {
  status: NativeSmokeStatus;
  message: string;
}

export type NativeSmokeProbe = (input: {
  entityId: NativeCapabilityEntityId;
  target: NativeCapabilityTarget;
  plugin?: string;
  configuredPlugins: string[];
}) => NativeSmokeResult;

export interface NativeCapabilityDecision {
  entityId: NativeCapabilityEntityId;
  target: NativeCapabilityTarget;
  action: NativeDecisionAction;
  reason: string;
  nativePlugin?: string;
  sourceTarget?: NativeCapabilityTarget;
  portableSurfaces: NativeSurface[];
  surfacesNeedingReview: NativeSurface[];
  managedPortPrefixes: string[];
  smoke?: NativeSmokeResult;
}

export interface NativeCapabilityReport {
  version: string;
  target: NativeCapabilityTarget;
  decisions: NativeCapabilityDecision[];
  openCodePluginsToEnable: string[];
  suppressedGeminiExtensionEntities: NativeCapabilityEntityId[];
  warnings: string[];
}

export interface ResolveNativeCapabilitiesOptions {
  target: NativeCapabilityTarget;
  presentEntities: NativeCapabilityEntityId[];
  configuredPlugins: string[];
  smoke?: NativeSmokeProbe;
}

function defaultSmoke(): NativeSmokeResult {
  return {
    status: "unavailable",
    message: "No native runtime smoke was provided.",
  };
}

function hasConfiguredPlugin(configuredPlugins: string[], expected: string): boolean {
  const expectedName = pluginPackageName(expected);
  return configuredPlugins.some((plugin) => pluginPackageName(plugin) === expectedName);
}

function sourceTargetForCompatibility(entityId: NativeCapabilityEntityId, target: NativeCapabilityTarget): NativeCapabilityTarget | undefined {
  if (entityId === "honcho" && target !== "opencode") return "opencode";
  return undefined;
}

export function resolveNativeCapabilities(options: ResolveNativeCapabilitiesOptions): NativeCapabilityReport {
  const decisions: NativeCapabilityDecision[] = [];
  const pluginsToEnable: string[] = [];
  const suppressed = new Set<NativeCapabilityEntityId>();
  const warnings: string[] = [];
  const configuredPlugins = options.configuredPlugins.slice();
  const smoke = options.smoke ?? (() => defaultSmoke());

  for (const entityId of [...new Set(options.presentEntities)].sort()) {
    const entry = capabilityEntry(entityId, options.target);
    if (!entry) continue;

    if (entry.nativeStatus === "available" && entry.nativeInstall?.kind === "opencode-plugin") {
      const plugin = entry.nativeInstall.plugin;
      const alreadyConfigured = hasConfiguredPlugin(configuredPlugins, plugin);
      const smokeResult = smoke({
        entityId,
        target: options.target,
        plugin,
        configuredPlugins,
      });
      if (!alreadyConfigured) pluginsToEnable.push(plugin);
      if (smokeResult.status === "validated") {
        suppressed.add(entityId);
        decisions.push({
          entityId,
          target: options.target,
          action: alreadyConfigured ? "use_existing_native" : "install_native",
          reason: alreadyConfigured ? "Native plugin is configured and validated." : "Native plugin is known and validated; enable it instead of projecting compatibility files.",
          nativePlugin: plugin,
          portableSurfaces: [...entry.portableSurfaces],
          surfacesNeedingReview: [...entry.surfacesNeedingReview],
          managedPortPrefixes: [...entry.managedPortPrefixes],
          smoke: smokeResult,
        });
        continue;
      }

      warnings.push(`Native capability not validated for ${entityId}/${options.target}: ${smokeResult.message}`);
      decisions.push({
        entityId,
        target: options.target,
        action: "fallback_compat",
        reason: "Native plugin is known, but smoke did not validate it; keep managed compatibility projection.",
        nativePlugin: plugin,
        portableSurfaces: [...entry.portableSurfaces],
        surfacesNeedingReview: [...entry.surfacesNeedingReview],
        managedPortPrefixes: [...entry.managedPortPrefixes],
        smoke: smokeResult,
      });
      continue;
    }

    decisions.push({
      entityId,
      target: options.target,
      action: "fallback_compat",
      reason: entry.nativeStatus === "not_available"
        ? "No native install is known for this target; use explicit compatibility adapter."
        : `Native status is ${entry.nativeStatus}; automatic install is not allowed.`,
      sourceTarget: sourceTargetForCompatibility(entityId, options.target),
      portableSurfaces: [...entry.portableSurfaces],
      surfacesNeedingReview: [...entry.surfacesNeedingReview],
      managedPortPrefixes: [...entry.managedPortPrefixes],
    });
  }

  return {
    version: OGB_VERSION,
    target: options.target,
    decisions,
    openCodePluginsToEnable: [...new Set(pluginsToEnable)],
    suppressedGeminiExtensionEntities: [...suppressed].sort(),
    warnings: [...new Set(warnings)],
  };
}

export function knownEntityIdsForTarget(target: NativeCapabilityTarget): NativeCapabilityEntityId[] {
  return nativeCapabilityEntriesForTarget(target).map((entry) => entry.entityId);
}
```

- [ ] **Step 4: Run resolver tests**

Run:

```bash
cd packages/ogb
npm test -- src/native-capability-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ogb/src/native-capability-resolver.ts packages/ogb/src/native-capability-resolver.test.ts
git commit -m "feat: resolve native capability decisions"
```

## Task 3: Write Native Capability Reports

**Files:**
- Modify: `packages/ogb/src/paths.ts`
- Modify: `packages/ogb/src/native-capability-resolver.ts`
- Modify: `packages/ogb/src/native-capability-resolver.test.ts`

- [ ] **Step 1: Add failing path/report tests**

Append to `packages/ogb/src/native-capability-resolver.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveProjectPaths } from "./paths.js";
import { writeNativeCapabilityReport } from "./native-capability-resolver.js";

test("resolveProjectPaths exposes native capability report path", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-native-project-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-native-home-"));
  const paths = resolveProjectPaths(projectRoot, homeDir);

  assert.equal(paths.nativeCapabilitiesPath, path.join(projectRoot, ".opencode", "generated", "ogb-native-capabilities.json"));
});

test("writeNativeCapabilityReport writes stable generated JSON", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-native-project-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-native-home-"));
  const report = resolveNativeCapabilities({
    target: "opencode",
    presentEntities: ["superpowers"],
    configuredPlugins: [],
    smoke: () => ({ status: "validated", message: "ok" }),
  });

  const output = writeNativeCapabilityReport({ projectRoot, homeDir, report });
  const parsed = JSON.parse(fs.readFileSync(output, "utf8"));

  assert.equal(parsed.version, report.version);
  assert.equal(parsed.target, "opencode");
  assert.equal(parsed.decisions[0].entityId, "superpowers");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd packages/ogb
npm test -- src/native-capability-resolver.test.ts
```

Expected: FAIL because `nativeCapabilitiesPath` and `writeNativeCapabilityReport` do not exist.

- [ ] **Step 3: Add path field**

Modify `packages/ogb/src/paths.ts`:

```ts
export interface ProjectPaths {
  projectRoot: string;
  homeDir: string;
  homeMode: boolean;
  bridgeConfigDir: string;
  generatedDir: string;
  inventoryPath: string;
  doctorPath: string;
  validationPath: string;
  securityPath: string;
  agentSyncAdoptionPath: string;
  bidirectionalSyncPath: string;
  extensionMapPath: string;
  nativeCapabilitiesPath: string;
  modelRoutingPath: string;
  dashboardPath: string;
  dashboardMarkdownPath: string;
  telemetryStatusPath: string;
  passPath: string;
  updateStatusPath: string;
  limitsPath: string;
  quotaPath: string;
  ogbConfigPath: string;
  ohMyOpenAgentConfigPath: string;
  trustPath: string;
  pluginStatusPath: string;
  syncStatePath: string;
  expandedGeminiPath: string;
  generatedOpenCodeConfigPath: string;
}
```

Add the returned path near `extensionMapPath`:

```ts
extensionMapPath: path.join(generatedDir, "ogb-extension-map.json"),
nativeCapabilitiesPath: path.join(generatedDir, "ogb-native-capabilities.json"),
modelRoutingPath: path.join(generatedDir, "ogb-model-routing.json"),
```

- [ ] **Step 4: Add report writer**

Append to `packages/ogb/src/native-capability-resolver.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { resolveProjectPaths } from "./paths.js";

export function writeNativeCapabilityReport(options: {
  projectRoot?: string;
  homeDir?: string;
  report: NativeCapabilityReport;
  dryRun?: boolean;
}): string {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(paths.nativeCapabilitiesPath), { recursive: true });
    fs.writeFileSync(paths.nativeCapabilitiesPath, `${JSON.stringify(options.report, null, 2)}\n`, "utf8");
  }
  return paths.nativeCapabilitiesPath;
}
```

Merge these imports with the existing imports at the top of the file; do not leave import statements below executable code.

- [ ] **Step 5: Run tests**

Run:

```bash
cd packages/ogb
npm test -- src/native-capability-resolver.test.ts src/paths.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ogb/src/paths.ts packages/ogb/src/native-capability-resolver.ts packages/ogb/src/native-capability-resolver.test.ts
git commit -m "feat: write native capability reports"
```

## Task 4: Integrate Resolver Into Project Sync

**Files:**
- Modify: `packages/ogb/src/sync.ts`
- Modify: `packages/ogb/src/sync.test.ts`

- [ ] **Step 1: Add failing sync tests**

Append to `packages/ogb/src/sync.test.ts`:

```ts
test("syncToOpenCode prefers validated native Superpowers plugin over compatibility skill projection", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionSkillDir = path.join(homeDir, ".gemini", "extensions", "superpowers", "skills", "using-superpowers");
  fs.mkdirSync(extensionSkillDir, { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "extensions", "superpowers", "gemini-extension.json"), JSON.stringify({ name: "superpowers" }));
  fs.writeFileSync(path.join(extensionSkillDir, "SKILL.md"), "---\nname: using-superpowers\n---\n# Use superpowers\n");

  const report = syncToOpenCode({
    projectRoot,
    homeDir,
    rulesyncMode: "off",
    silent: true,
    nativeCapabilitySmoke: () => ({ status: "validated", message: "skills visible" }),
  });

  const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));
  const nativeReport = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-native-capabilities.json"), "utf8"));

  assert.equal(projectConfig.plugin.includes("superpowers@git+https://github.com/obra/superpowers.git"), true);
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "skills", "using-superpowers", "SKILL.md")), false);
  assert.equal(report.projectedSkills.includes(".opencode/skills/using-superpowers"), false);
  assert.equal(report.nativeCapabilities.decisions[0].action, "install_native");
  assert.equal(nativeReport.decisions[0].entityId, "superpowers");
});

test("syncToOpenCode keeps Superpowers compatibility projection when native smoke is unavailable", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionSkillDir = path.join(homeDir, ".gemini", "extensions", "superpowers", "skills", "using-superpowers");
  fs.mkdirSync(extensionSkillDir, { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "extensions", "superpowers", "gemini-extension.json"), JSON.stringify({ name: "superpowers" }));
  fs.writeFileSync(path.join(extensionSkillDir, "SKILL.md"), "---\nname: using-superpowers\n---\n# Use superpowers\n");

  const report = syncToOpenCode({
    projectRoot,
    homeDir,
    rulesyncMode: "off",
    silent: true,
    nativeCapabilitySmoke: () => ({ status: "unavailable", message: "skill probe unavailable" }),
  });

  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "skills", "using-superpowers", "SKILL.md")), true);
  assert.ok(report.projectedSkills.includes(".opencode/skills/using-superpowers"));
  assert.ok(report.warnings.some((warning) => warning.includes("Native capability not validated for superpowers/opencode")));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd packages/ogb
npm test -- src/sync.test.ts
```

Expected: FAIL because `SyncOptions.nativeCapabilitySmoke` and `SyncReport.nativeCapabilities` do not exist.

- [ ] **Step 3: Extend `SyncOptions` and `SyncReport`**

Modify imports near the top of `packages/ogb/src/sync.ts`:

```ts
import {
  resolveNativeCapabilities,
  writeNativeCapabilityReport,
  type NativeCapabilityReport,
  type NativeSmokeProbe,
} from "./native-capability-resolver.js";
import { entityIdFromGeminiExtensionName, type NativeCapabilityEntityId } from "./native-capability-registry.js";
import type { OgbConfig } from "./ogb-config.js";
```

Extend interfaces:

```ts
export interface SyncOptions {
  projectRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
  silent?: boolean;
  rulesyncMode?: RulesyncMode;
  rulesyncFeatures?: string[];
  nativeCapabilitySmoke?: NativeSmokeProbe;
}

export interface SyncReport {
  version: string;
  projectRoot: string;
  generatedConfigPath: string;
  nativeCapabilities: NativeCapabilityReport;
  projectedAgents: string[];
  projectedExtensionAgents: string[];
  projectedModelFallbackConfig?: string;
  projectedModelRoutingConfig?: string;
  removedAgents: string[];
  projectedCommands: string[];
  projectedExtensionCommands: string[];
  removedExtensionCommands: string[];
  projectedSkills: string[];
  removedSkills: string[];
  projectedAntigravitySkills: string[];
  removedAntigravitySkills: string[];
  projectedAntigravityAgents: string[];
  removedAntigravityAgents: string[];
  projectedAntigravityWorkflows: string[];
  removedAntigravityWorkflows: string[];
  projectedAntigravityMcps: string[];
  removedAntigravityMcps: string[];
  projectedTuiFiles: string[];
  projectedExternalPlugins: string[];
  projectedExternalIntegrationFiles: string[];
  rulesync: RulesyncProjectionResult;
  backups: BackupRecord[];
  notes: string[];
  warnings: string[];
}
```

- [ ] **Step 4: Add entity detection helper in `sync.ts`**

Add near `listGlobalExtensionRoots`:

```ts
function presentNativeEntitiesFromGeminiExtensions(homeDir: string): NativeCapabilityEntityId[] {
  return [...new Set(listGlobalExtensionRoots(homeDir)
    .map((extension) => entityIdFromGeminiExtensionName(extension.name))
    .filter((entity): entity is NativeCapabilityEntityId => Boolean(entity)))]
    .sort();
}
```

- [ ] **Step 5: Add suppression option to `projectExtensionSkills`**

Change the signature:

```ts
function projectExtensionSkills(options: {
  projectRoot: string;
  homeDir: string;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
  suppressedEntities?: readonly NativeCapabilityEntityId[];
}): ProjectSkillDirsResult {
```

Inside the function, before the loop:

```ts
const suppressedEntities = new Set(options.suppressedEntities ?? []);
```

At the start of the loop:

```ts
const entityId = entityIdFromGeminiExtensionName(skill.extensionName);
if (entityId && suppressedEntities.has(entityId)) continue;
```

This lets stale managed skills be removed by `removeStaleManagedSkillDirs` because skipped skills are not added to `keepSkillFiles`.

- [ ] **Step 6: Call resolver in project sync**

Add this helper near `presentNativeEntitiesFromGeminiExtensions`:

```ts
function configuredOpenCodePluginsForSync(options: { projectRoot: string; homeDir: string; homeMode: boolean; config: OgbConfig }): string[] {
  const files = options.homeMode
    ? [globalConfigPath(globalOpenCodeConfigDir({ homeDir: options.homeDir }))]
    : [path.join(options.projectRoot, "opencode.jsonc")];
  const configured: string[] = [];
  for (const filePath of files) {
    if (!fileExists(filePath)) continue;
    const parsed = parseJsonc(fs.readFileSync(filePath, "utf8"));
    if (Array.isArray(parsed?.plugin)) {
      for (const plugin of parsed.plugin) if (typeof plugin === "string") configured.push(plugin);
    }
  }
  return [...new Set([...configured, ...externalOpenCodePlugins(options.config)])];
}
```

In `syncToOpenCode`, after `const ogbConfig = readOgbConfig(...)`, add:

```ts
const nativeCapabilities = resolveNativeCapabilities({
  target: "opencode",
  presentEntities: presentNativeEntitiesFromGeminiExtensions(paths.homeDir),
  configuredPlugins: configuredOpenCodePluginsForSync({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    homeMode: paths.homeMode,
    config: ogbConfig,
  }),
  smoke: options.nativeCapabilitySmoke,
});
writeNativeCapabilityReport({
  projectRoot: paths.projectRoot,
  homeDir: paths.homeDir,
  report: nativeCapabilities,
  dryRun: options.dryRun,
});
```

Change plugin list:

```ts
const openCodePlugins = [
  ...externalOpenCodePlugins(ogbConfig),
  ...nativeCapabilities.openCodePluginsToEnable,
];
```

Pass suppression:

```ts
const projectedSkills = projectExtensionSkills({
  projectRoot: paths.projectRoot,
  homeDir: paths.homeDir,
  backupSession,
  dryRun: options.dryRun,
  force: options.force,
  suppressedEntities: nativeCapabilities.suppressedGeminiExtensionEntities,
});
warnings.push(...nativeCapabilities.warnings, ...projectedSkills.warnings);
```

Add `nativeCapabilities` to the returned report object.

- [ ] **Step 7: Add native report to global sync return**

In `syncGlobalOpenCode`, create a report from `presentNativeEntitiesFromGeminiExtensions(paths.homeDir)` because global extension projection also reads `~/.gemini/extensions`. Use the same resolver and writer:

```ts
const nativeCapabilities = resolveNativeCapabilities({
  target: "opencode",
  presentEntities: presentNativeEntitiesFromGeminiExtensions(paths.homeDir),
  configuredPlugins: configuredOpenCodePluginsForSync({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    homeMode: paths.homeMode,
    config: ogbConfig,
  }),
  smoke: options.nativeCapabilitySmoke,
});
writeNativeCapabilityReport({
  projectRoot: paths.projectRoot,
  homeDir: paths.homeDir,
  report: nativeCapabilities,
  dryRun: options.dryRun,
});
```

Add `nativeCapabilities` to the global `SyncReport`.

- [ ] **Step 8: Run sync tests**

Run:

```bash
cd packages/ogb
npm test -- src/sync.test.ts src/native-capability-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/ogb/src/sync.ts packages/ogb/src/sync.test.ts packages/ogb/src/native-capability-resolver.ts packages/ogb/src/native-capability-registry.ts
git commit -m "feat: prefer validated native capabilities during sync"
```

## Task 5: Report Native Decisions In Doctor

**Files:**
- Modify: `packages/ogb/src/doctor.ts`
- Modify: `packages/ogb/src/doctor.test.ts`

- [ ] **Step 1: Add failing doctor test**

Append to `packages/ogb/src/doctor.test.ts`:

```ts
test("runDoctor reports native capability decisions from generated report", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-doctor-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const generatedDir = path.join(projectRoot, ".opencode", "generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, "ogb-native-capabilities.json"), JSON.stringify({
    version: OGB_VERSION,
    target: "opencode",
    decisions: [{
      entityId: "superpowers",
      target: "opencode",
      action: "fallback_compat",
      reason: "Native plugin is known, but smoke did not validate it; keep managed compatibility projection.",
      nativePlugin: "superpowers@git+https://github.com/obra/superpowers.git",
      portableSurfaces: ["skills"],
      surfacesNeedingReview: [],
      managedPortPrefixes: [".opencode/skills/"],
      smoke: { status: "unavailable", message: "skill probe unavailable" },
    }],
    openCodePluginsToEnable: ["superpowers@git+https://github.com/obra/superpowers.git"],
    suppressedGeminiExtensionEntities: [],
    warnings: ["Native capability not validated for superpowers/opencode: skill probe unavailable"],
  }, null, 2));

  const report = runDoctor({ projectRoot, homeDir, silent: true });

  assert.equal(report.nativeCapabilities.reportExists, true);
  assert.equal(report.nativeCapabilities.decisions, 1);
  assert.equal(report.nativeCapabilities.nativeValidated, 0);
  assert.equal(report.nativeCapabilities.fallbackCompat, 1);
  assert.ok(report.warnings.some((warning) => warning.includes("Native capability not validated for superpowers/opencode")));
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd packages/ogb
npm test -- src/doctor.test.ts
```

Expected: FAIL because `DoctorReport.nativeCapabilities` does not exist.

- [ ] **Step 3: Extend doctor report type**

In `packages/ogb/src/doctor.ts`, add to `DoctorReport`:

```ts
nativeCapabilities: {
  reportExists: boolean;
  target?: string;
  decisions: number;
  nativeValidated: number;
  fallbackCompat: number;
  blocked: number;
  replicatedFromOtherTarget: number;
};
```

- [ ] **Step 4: Read native report**

Inside `runDoctor`, after `const modelRouting = readJsonc(paths.modelRoutingPath);`, add:

```ts
const nativeCapabilityReport = readJsonc(paths.nativeCapabilitiesPath);
```

Before building `report`, add:

```ts
const nativeDecisions = Array.isArray(nativeCapabilityReport?.decisions) ? nativeCapabilityReport.decisions : [];
const nativeCapabilities = {
  reportExists: fs.existsSync(paths.nativeCapabilitiesPath),
  target: typeof nativeCapabilityReport?.target === "string" ? nativeCapabilityReport.target : undefined,
  decisions: nativeDecisions.length,
  nativeValidated: nativeDecisions.filter((decision: any) => decision.action === "use_existing_native" || decision.action === "install_native").length,
  fallbackCompat: nativeDecisions.filter((decision: any) => decision.action === "fallback_compat").length,
  blocked: nativeDecisions.filter((decision: any) => decision.action === "blocked").length,
  replicatedFromOtherTarget: nativeDecisions.filter((decision: any) => typeof decision.sourceTarget === "string" && decision.sourceTarget !== decision.target).length,
};
```

Add generated warnings:

```ts
for (const warning of nativeCapabilityReport?.warnings ?? []) warnings.push(warning);
```

Add `nativeCapabilities` to the `report` object.

- [ ] **Step 5: Update human doctor output**

In the non-JSON output block, after runtime fallback:

```ts
console.log(`Native capabilities: ${report.nativeCapabilities.reportExists ? `${report.nativeCapabilities.nativeValidated} native, ${report.nativeCapabilities.fallbackCompat} fallback` : "missing report"}`);
```

- [ ] **Step 6: Run doctor tests**

Run:

```bash
cd packages/ogb
npm test -- src/doctor.test.ts src/sync.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ogb/src/doctor.ts packages/ogb/src/doctor.test.ts
git commit -m "feat: report native capability decisions"
```

## Task 6: Add Honcho Cross-Target Metadata Helpers

**Files:**
- Create: `packages/ogb/src/honcho-capability.ts`
- Modify: `packages/ogb/src/native-capability-resolver.test.ts`

- [ ] **Step 1: Add failing Honcho metadata tests**

Append to `packages/ogb/src/native-capability-resolver.test.ts`:

```ts
import { honchoMcpCompatibilitySurface } from "./honcho-capability.js";

test("honchoMcpCompatibilitySurface describes Gemini-compatible stdio bridge without secrets", () => {
  const surface = honchoMcpCompatibilitySurface({
    apiKeyEnv: "HONCHO_API_KEY",
    userNameEnv: "HONCHO_USER_NAME",
  });

  assert.equal(surface.name, "honcho");
  assert.equal(surface.server.command, "npx");
  assert.deepEqual(surface.server.args.slice(0, 2), ["mcp-remote", "https://mcp.honcho.dev"]);
  assert.deepEqual(surface.server.env, {
    AUTH_HEADER: "$HONCHO_API_KEY",
    USER_NAME: "$HONCHO_USER_NAME",
  });
  assert.equal(JSON.stringify(surface).includes("hch-"), false);
});

test("honchoMcpCompatibilitySurface marks hooks and commands as review-only", () => {
  const surface = honchoMcpCompatibilitySurface({
    apiKeyEnv: "HONCHO_API_KEY",
    userNameEnv: "HONCHO_USER_NAME",
  });

  assert.deepEqual(surface.reviewOnlySurfaces, ["prompts", "commands", "hooks"]);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd packages/ogb
npm test -- src/native-capability-resolver.test.ts
```

Expected: FAIL because `honcho-capability.js` does not exist.

- [ ] **Step 3: Implement Honcho surface helper**

Create `packages/ogb/src/honcho-capability.ts`:

```ts
import type { GeminiMcpServer } from "./types.js";

export interface HonchoMcpCompatibilitySurface {
  name: "honcho";
  server: Pick<GeminiMcpServer, "name" | "source" | "type" | "command" | "args" | "environment" | "status"> & {
    env: Record<string, string>;
  };
  reviewOnlySurfaces: Array<"prompts" | "commands" | "hooks">;
  docs: string[];
}

export function honchoMcpCompatibilitySurface(options: {
  apiKeyEnv: string;
  userNameEnv: string;
}): HonchoMcpCompatibilitySurface {
  return {
    name: "honcho",
    server: {
      name: "honcho",
      source: "native-capability:honcho",
      type: "stdio",
      command: "npx",
      args: [
        "mcp-remote",
        "https://mcp.honcho.dev",
        "--header",
        "Authorization:${AUTH_HEADER}",
        "--header",
        "X-Honcho-User-Name:${USER_NAME}",
      ],
      env: {
        AUTH_HEADER: `$${options.apiKeyEnv}`,
        USER_NAME: `$${options.userNameEnv}`,
      },
      environment: {
        AUTH_HEADER: `$${options.apiKeyEnv}`,
        USER_NAME: `$${options.userNameEnv}`,
      },
      status: "needs_review",
    },
    reviewOnlySurfaces: ["prompts", "commands", "hooks"],
    docs: ["https://honcho.dev/docs/v3/guides/integrations/mcp"],
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd packages/ogb
npm test -- src/native-capability-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ogb/src/honcho-capability.ts packages/ogb/src/native-capability-resolver.test.ts
git commit -m "feat: model Honcho compatibility surfaces"
```

## Task 7: Add Pass/Check Summary Wiring

**Files:**
- Modify: `packages/ogb/src/pass.ts`
- Modify: `packages/ogb/src/pass.test.ts`

- [ ] **Step 1: Add failing pass summary test**

Append to `packages/ogb/src/pass.test.ts`:

```ts
test("runPass includes native capability counts in sync summary", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-pass-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionSkillDir = path.join(homeDir, ".gemini", "extensions", "superpowers", "skills", "using-superpowers");
  fs.mkdirSync(extensionSkillDir, { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "extensions", "superpowers", "gemini-extension.json"), JSON.stringify({ name: "superpowers" }));
  fs.writeFileSync(path.join(extensionSkillDir, "SKILL.md"), "---\nname: using-superpowers\n---\n# Use superpowers\n");

  const report = runPass({
    projectRoot,
    homeDir,
    noSetup: true,
    noExtensionUpdate: true,
    noValidation: true,
    noSecurity: true,
    noDashboard: true,
    rulesyncMode: "off",
    silent: true,
    nativeCapabilitySmoke: () => ({ status: "validated", message: "skills visible" }),
  });

  assert.equal(report.sync?.nativeCapabilities, 1);
  assert.equal(report.sync?.nativeFallbacks, 0);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd packages/ogb
npm test -- src/pass.test.ts
```

Expected: FAIL because `runPass` options and summary do not include native capability fields.

- [ ] **Step 3: Thread smoke option through pass**

In `packages/ogb/src/pass.ts`, import `NativeSmokeProbe`:

```ts
import type { NativeSmokeProbe } from "./native-capability-resolver.js";
```

Add to `PassOptions`:

```ts
nativeCapabilitySmoke?: NativeSmokeProbe;
```

Pass it into `syncToOpenCode`:

```ts
sync = syncToOpenCode({
  projectRoot: paths.projectRoot,
  homeDir: paths.homeDir,
  dryRun: options.dryRun,
  force: options.force,
  silent: true,
  rulesyncMode: options.rulesyncMode,
  nativeCapabilitySmoke: options.nativeCapabilitySmoke,
});
```

- [ ] **Step 4: Extend pass sync summary**

In `PassSyncSummary`, add these fields:

```ts
nativeCapabilities: number;
nativeFallbacks: number;
```

In `buildSyncSummary`, add:

```ts
nativeCapabilities: sync.nativeCapabilities.decisions.filter((decision) =>
  decision.action === "use_existing_native" || decision.action === "install_native"
).length,
nativeFallbacks: sync.nativeCapabilities.decisions.filter((decision) =>
  decision.action === "fallback_compat"
).length,
```

In `syncSummaryLine`, append native/fallback counts when non-zero:

```ts
if (sync.nativeCapabilities > 0) parts.push(plural(sync.nativeCapabilities, "native capability", "native capabilities"));
if (sync.nativeFallbacks > 0) parts.push(plural(sync.nativeFallbacks, "native fallback"));
```

- [ ] **Step 5: Run pass tests**

Run:

```bash
cd packages/ogb
npm test -- src/pass.test.ts src/sync.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ogb/src/pass.ts packages/ogb/src/pass.test.ts
git commit -m "feat: summarize native capabilities in check"
```

## Task 8: Documentation Updates

**Files:**
- Modify: `docs/17-cli-command-spec.md`
- Modify: `docs/05-resource-mapping.md`
- Modify: `README.md`

- [ ] **Step 1: Update CLI command spec**

In `docs/17-cli-command-spec.md`, add a short subsection under `ogb sync`:

```md
### Native capability resolution

Before generating compatibility files, `ogb sync` checks known entities against the native capability registry. If a native install is known and the smoke check validates it, OGB enables the native target integration and removes only OGB-managed compatibility ports. If the smoke check cannot validate the native path, OGB keeps the compatibility projection.

Examples:

- Superpowers prefers the native OpenCode plugin when validated.
- Honcho may use an OpenCode-native package as the explicit source adapter while Gemini CLI or Antigravity CLI use compatibility surfaces such as MCP until they have native plugins.
```

- [ ] **Step 2: Update resource mapping**

In `docs/05-resource-mapping.md`, add after the table:

```md
## Native-first compatibility

For known entities, OGB resolves native capability before projecting files. Native installation wins only when it is known and validated. Managed compatibility projections remain the fallback and are removable when a native integration becomes valid later.
```

- [ ] **Step 3: Update README**

Add a paragraph near the setup/check explanation:

```md
OGB prefers native integrations when they are known and validated. For example, a known OpenCode-native plugin can replace a generated compatibility port after smoke validation. If validation fails, OGB keeps the generated compatibility files and reports the reason in `doctor`/`check`.
```

- [ ] **Step 4: Verify docs mention no internal-only UX as required user flow**

Run:

```bash
rg -n "native capability|Superpowers|Honcho|smoke|compatibility port" README.md docs/05-resource-mapping.md docs/17-cli-command-spec.md
```

Expected: Shows the new sections and does not tell a normal user to manually edit hashes, receipts, or generated state.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/05-resource-mapping.md docs/17-cli-command-spec.md
git commit -m "docs: explain native-first compatibility"
```

## Task 9: Full Verification

**Files:**
- No code edits unless verification finds a failure.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
cd packages/ogb
npm test -- src/native-capability-resolver.test.ts src/sync.test.ts src/doctor.test.ts src/pass.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
cd packages/ogb
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd packages/ogb
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run build**

Run:

```bash
cd packages/ogb
npm run build
```

Expected: PASS and `dist/cli.js` exists.

- [ ] **Step 5: Run local dry-run smoke**

Run from repo root:

```bash
node packages/ogb/dist/cli.js --project "$PWD" sync --dry-run --rulesync off
```

Expected: exits 0 and prints generated OpenCode config JSON. If no Superpowers extension exists locally, no native plugin should be added.

- [ ] **Step 6: Run local doctor**

Run:

```bash
node packages/ogb/dist/cli.js --project "$PWD" doctor --json
```

Expected: exits 0 and JSON includes `nativeCapabilities`.

- [ ] **Step 7: Final git status**

Run:

```bash
git status --short
```

Expected: only intended implementation files are modified. Existing unrelated files such as `.claude/` remain untouched.

- [ ] **Step 8: Commit verification fixes if needed**

If verification required fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize native capability verification"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

Spec coverage:

- Native known/validatable install preference: Tasks 1, 2, 4, 5, 7.
- Fallback compatibility when smoke fails: Tasks 2 and 4.
- Removal/suppression of managed ports: Task 4.
- Antigravity future-native path: Task 1 registry entries and Task 2 fallback decisions.
- Honcho cross-target replication model: Tasks 1, 2, 6.
- UX/reporting: Tasks 5, 7, 8.
- Tests and validation: Tasks 1 through 9.

Placeholder scan:

- No `TODO`, `TBD`, `fill in`, or unspecified test steps are intended in this plan.

Type consistency:

- Registry uses `NativeCapabilityEntityId`, `NativeCapabilityTarget`, and `NativeSurface`.
- Resolver uses `NativeCapabilityReport` and `NativeSmokeProbe`.
- `SyncReport.nativeCapabilities` reuses `NativeCapabilityReport`.
- `DoctorReport.nativeCapabilities` is a summary, not the full resolver report.
