# Compaction Fallback Design

## Context

agentX currently configures OpenCode's internal `compaction` agent with a single
model: `openai/gpt-5.4-mini`. If OpenAI quota is exhausted, context compaction can
fail and leave the session unable to free context.

The UX profile already includes the `opencode-auto-fallback` plugin in the
installable global plugin list, but the generated fallback policy is disabled.
That means several model-fallback flows can be present in configuration while not
actually protecting the session at runtime.

OpenCode's public config schema exposes `agent.<name>.model` as a single string;
it does not expose a native fallback list on the agent itself. agentX already
ships and generates `opencode-auto-fallback` configuration through
`fallback.json`, including per-agent fallback lists under `agentFallbacks`.

## Goal

Make compaction resilient to OpenAI quota exhaustion by giving the internal
`compaction` agent one fallback model from each configured non-OpenAI provider.
Enable the generated auto-fallback policy in the UX profile so fallback works by
default for compaction and other configured fallback flows.

## Non-goals

- Do not change the primary compaction model.
- Do not change medical-agent fallback policies.
- Do not add unsupported fields to OpenCode's `agent.compaction` config.
- Do not remove or weaken existing medical-agent fallback policies.

## Selected Approach

Keep `agent.compaction.model = "openai/gpt-5.4-mini"`, enable the generated
auto-fallback policy in the UX profile, and add `agentFallbacks.compaction` to
the generated fallback profile.

Fallback activation changes:

- Keep `opencode-auto-fallback@0.4.3` in `safePlugins` so setup installs it.
- Set `fallbackConfig.enabled = true` so the generated `fallback.json` is active.
- Set `projectConfig.externalPlugins.autoFallback.enabled = true` so project
  profile state reports and regenerates the fallback integration as enabled.

Fallback order:

1. `anthropic-auth/claude-haiku-4-5` — small, fast Anthropic-auth fallback suited
   to summarization.
2. `gemini-cli/gemini-3.1-flash-lite-preview` — lightweight Gemini CLI fallback
   with large context capacity.
3. `antigravity/gemini-3.5-flash` — Antigravity-backed Gemini fallback, providing
   a distinct provider/auth path from Gemini CLI.

## Implementation Notes

- Update `UX_PROFILE_PRESET.fallbackConfig.agentFallbacks` in
  `packages/agentx/src/ux-profile.generated.ts`.
- Update the UX profile fallback enable flags in
  `packages/agentx/src/ux-profile.generated.ts`.
- Add/adjust tests in `packages/agentx/src/setup-ux.test.ts` to assert that the
  generated `fallback.json` is enabled and includes `agentFallbacks.compaction`
  with exactly one entry for `anthropic-auth`, `gemini-cli`, and `antigravity`.
- Add/adjust tests to assert that `projectConfig.externalPlugins.autoFallback`
  is enabled in the generated project profile.
- Preserve existing assertions for `agent.compaction.model`.

## Testing

- Run the focused setup UX test suite or full `npm test` for `packages/agentx`.
- Run typecheck if the test command does not cover TypeScript compilation.

## Risks

- If `opencode-auto-fallback` does not intercept the internal `compaction` agent,
  this config will be harmless but insufficient. The schema-compatible placement
  still makes the intended fallback policy explicit and testable.
- Model IDs must match the provider catalogs that agentX configures. The selected
  IDs are already present in agentX's auth-provider catalogs.
- Enabling fallback by default changes runtime behavior for users. This is an
  intended safety improvement because fallback is important for several agentX
  flows and prevents quota exhaustion from blocking critical work.
