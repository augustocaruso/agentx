# Compaction Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the agentX/OpenCode auto-fallback integration by default and add provider-diverse fallback models for the internal `compaction` agent.

**Architecture:** The OpenCode schema only allows a single `agent.compaction.model`, so keep the primary compaction model unchanged and express fallback through the existing generated `fallback.json` policy. The UX profile preset remains the source of truth for global OpenCode setup and project fallback profile generation.

**Tech Stack:** TypeScript, Node.js test runner, JSONC parsing, agentX UX profile preset generation.

---

## File Structure

- Modify `packages/agentx/src/setup-ux.test.ts`: add failing assertions for enabled fallback policy, enabled project fallback config, and `agentFallbacks.compaction` contents.
- Modify `packages/agentx/src/ux-profile.generated.ts`: enable fallback flags and add the compaction fallback entries.
- Keep `docs/superpowers/specs/2026-05-25-compaction-fallback-design.md`: approved design record; no implementation code lives here.

### Task 1: Add Regression Coverage for Enabled Compaction Fallback

**Files:**
- Modify: `packages/agentx/src/setup-ux.test.ts:163-175`
- Test: `packages/agentx/src/setup-ux.test.ts`

- [ ] **Step 1: Write the failing test assertions**

Replace the existing fallback assertions in `packages/agentx/src/setup-ux.test.ts` lines 163-175 with:

```ts
  const fallback = readJson(path.join(configDir, "plugins", "fallback.json"));
  assert.equal(fallback.enabled, true);
  assert.equal(fallback.cooldownMs, 60_000);
  assert.equal(fallback.maxRetries, 2);
  assert.equal(fallback.agentFallbacks["med-chat-triager"][0].model, "openai/gpt-5.4-mini");
  assert.equal(fallback.agentFallbacks["med-chat-triager"][0].reasoningEffort, "medium");
  assert.deepEqual(fallback.agentFallbacks.compaction, [
    {
      model: "anthropic-auth/claude-haiku-4-5",
      reasoningEffort: "high",
    },
    {
      model: "gemini-cli/gemini-3.1-flash-lite-preview",
      reasoningEffort: "medium",
    },
    {
      model: "antigravity/gemini-3.5-flash",
      reasoningEffort: "medium",
      variant: "medium",
    },
  ]);

  const projectConfig = parseJsonc(fs.readFileSync(path.join(projectRoot, ".opencode", "agentx.config.jsonc"), "utf8"));
  assert.equal(projectConfig.openCode.defaultAgent, "YOLO");
  assert.equal(projectConfig.externalPlugins.autoFallback.enabled, true);
  assert.equal(projectConfig.externalPlugins.autoFallback.plugin, "opencode-auto-fallback@0.4.3");
  assert.equal(projectConfig.externalPlugins.autoFallback.installProjectPlugin, false);
  assert.equal(projectConfig.modelFallbacks.agents["med-knowledge-architect"].model.variant, "high");
  assert.equal(projectConfig.modelFallbacks.agents["med-chat-triager"].model.variant, "high");
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- setup-ux.test.ts
```

from `packages/agentx`.

Expected: the test fails because `fallback.enabled` and `projectConfig.externalPlugins.autoFallback.enabled` are still `false`, and `fallback.agentFallbacks.compaction` is not defined.

### Task 2: Enable Auto-Fallback and Add Compaction Fallbacks

**Files:**
- Modify: `packages/agentx/src/ux-profile.generated.ts:191-259`
- Modify: `packages/agentx/src/ux-profile.generated.ts:287-294`
- Test: `packages/agentx/src/setup-ux.test.ts`

- [ ] **Step 1: Update `fallbackConfig` in the UX profile preset**

In `packages/agentx/src/ux-profile.generated.ts`, change the `fallbackConfig.enabled` value and add the `compaction` key inside `fallbackConfig.agentFallbacks` after the existing `med-publish-guard` entry:

```ts
    "enabled": true,
```

and:

```ts
      "compaction": [
        {
          "model": "anthropic-auth/claude-haiku-4-5",
          "reasoningEffort": "high"
        },
        {
          "model": "gemini-cli/gemini-3.1-flash-lite-preview",
          "reasoningEffort": "medium"
        },
        {
          "model": "antigravity/gemini-3.5-flash",
          "reasoningEffort": "medium",
          "variant": "medium"
        }
      ]
```

- [ ] **Step 2: Update project auto-fallback enable flag**

In `packages/agentx/src/ux-profile.generated.ts`, change `projectConfig.externalPlugins.autoFallback.enabled` to:

```ts
        "enabled": true,
```

- [ ] **Step 3: Run the focused test to verify it passes**

Run:

```bash
npm test -- setup-ux.test.ts
```

from `packages/agentx`.

Expected: PASS for `setup-ux.test.ts`.

### Task 3: Run Verification

**Files:**
- No source file changes expected.
- Verify: `packages/agentx`

- [ ] **Step 1: Run the full package test suite**

Run:

```bash
npm test
```

from `packages/agentx`.

Expected: all TypeScript tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

from `packages/agentx`.

Expected: TypeScript exits successfully with no errors.

- [ ] **Step 3: Inspect diff**

Run:

```bash
git diff -- docs/superpowers/specs/2026-05-25-compaction-fallback-design.md docs/superpowers/plans/2026-05-25-compaction-fallback-plan.md packages/agentx/src/setup-ux.test.ts packages/agentx/src/ux-profile.generated.ts
```

Expected: diff contains only the approved spec update, the implementation plan, enabled fallback flags, compaction fallback entries, and test assertions.
