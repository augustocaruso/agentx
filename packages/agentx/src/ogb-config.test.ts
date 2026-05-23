import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeFallbackEntry,
  normalizeOpenCodeModelId,
  resolveAgentFallback,
  type OgbConfig,
} from "./ogb-config.js";

test("normalizeOpenCodeModelId maps legacy OAuth provider IDs to split auth providers", () => {
  assert.equal(normalizeOpenCodeModelId("google/gemini-3-flash-preview"), "gemini-cli/gemini-3-flash-preview");
  assert.equal(normalizeOpenCodeModelId("anthropic/claude-haiku-4-5"), "anthropic-auth/claude-haiku-4-5");
  assert.equal(normalizeOpenCodeModelId("gemini-2.5-flash"), "gemini-cli/gemini-2.5-flash");
  assert.equal(normalizeOpenCodeModelId("openai/gpt-5.4-mini"), "openai/gpt-5.4-mini");
});

test("resolveAgentFallback normalizes legacy model fallback policies", () => {
  const config: OgbConfig = {
    modelFallbacks: {
      agents: {
        helper: {
          model: { id: "google/gemini-3.1-pro-preview", variant: "high" },
          fallback_models: [
            { model: "anthropic/claude-sonnet-4-6", effort: "high" },
            "gemini-2.5-flash",
          ],
        },
      },
    },
  };

  const fallback = resolveAgentFallback({
    config,
    extensionName: "study-pack",
    agentName: "helper",
    importedModel: "google/gemini-3-flash-preview",
  });

  assert.equal(fallback.model, "gemini-cli/gemini-3.1-pro-preview");
  assert.deepEqual(fallback.fallbackModels, [
    { model: "anthropic-auth/claude-sonnet-4-6", effort: "high", reasoningEffort: "high" },
    "gemini-cli/gemini-2.5-flash",
  ]);
  assert.deepEqual(normalizeFallbackEntry({ model: "anthropic/claude-haiku-4-5", effort: "low" }), {
    model: "anthropic-auth/claude-haiku-4-5",
    effort: "low",
    reasoningEffort: "low",
  });
});
