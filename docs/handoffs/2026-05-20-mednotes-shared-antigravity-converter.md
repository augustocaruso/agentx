# Handoff: Shared Gemini To Antigravity Converter

## Context

Medical Notes Workbench already had a Python build script that converted a Gemini CLI extension into an Antigravity plugin bundle. AgentX also needs Antigravity projections, but it should import only the helpers it uses in sync. The agreed contract is one shared full-extension converter, with smaller importable helpers inside it, not two divergent builders.

## Source Of Truth

Use this Python module as the preferred source:

```text
packages/agentx/scripts/gemini_antigravity_converter.py
```

It exposes importable functions and a JSON CLI for the full plugin conversion:

```bash
python packages/agentx/scripts/gemini_antigravity_converter.py convert-extension-plugin \
  --source-dir <gemini-extension-dir> \
  --output-dir <antigravity-plugin-dir> \
  --plugin-name <optional-plugin-name> \
  --json
```

The full-conversion JSON payload includes:

```json
{
  "schema": "agentx.gemini-antigravity-converter.v1",
  "status": "converted",
  "pluginName": "medical-notes-workbench",
  "pluginDir": ".../dist/antigravity-plugin",
  "counts": {
    "commandSkills": 14,
    "hooks": 2,
    "mcpServers": 1,
    "agents": 5,
    "skills": 20,
    "inventory": 40
  },
  "warnings": [],
  "inventory": []
}
```

It also keeps the smaller helper CLI for AgentX sync and other targeted projections:

```bash
python packages/agentx/scripts/gemini_antigravity_converter.py render-command-skill \
  --source-path <command-file> \
  --source-rel-path <path-inside-extension> \
  --extension-name <optional-extension-name> \
  --extension-dir <optional-extension-dir>
```

The JSON payload is:

```json
{
  "slug": "mednotes-fix-wiki",
  "publicName": "mednotes:fix-wiki",
  "description": "Fix wiki",
  "markdown": "...SKILL.md...",
  "warnings": []
}
```

## AgentX Behavior

AgentX exposes two TypeScript entry points:

- `convertGeminiCommandToAntigravitySkill(...)`: used by sync when only a command launcher skill is needed.
- `convertGeminiExtensionToAntigravityPlugin(...)`: used by external builders or future AgentX flows that need the full plugin bundle.

The Python converter remains the source of truth. AgentX's TypeScript wrapper honors `AGENTX_ANTIGRAVITY_CONVERTER`/`OGB_ANTIGRAVITY_CONVERTER` and `AGENTX_PYTHON_BIN`/`OGB_PYTHON_BIN`. MedNotes can keep honoring `MEDNOTES_ANTIGRAVITY_CONVERTER` before invoking or importing the same shared module.

Relevant files:

```text
packages/agentx/src/antigravity-plugin-converter.ts
packages/agentx/src/antigravity-plugin-converter.test.ts
packages/agentx/scripts/gemini_antigravity_converter.py
packages/ogb/scripts/gemini_antigravity_converter.py
```

`packages/ogb/scripts/gemini_antigravity_converter.py` is a compatibility shim for older consumers that still look under the old OGB path. New integrations should use `packages/agentx/scripts/gemini_antigravity_converter.py`.

## MedNotes Alignment

MedNotes should replace private full-plugin conversion rules with one of these two approaches:

1. Import `convert_extension_plugin(...)` and helper functions from `gemini_antigravity_converter.py` when running in-process Python.
2. Call `convert-extension-plugin --json` when the caller is not Python.

MedNotes-specific code should keep only project-specific policy: README copy, custom hook wrappers, domain validation, install/publish commands, and any runtime smoke that is genuinely MedNotes-specific. Generic conversion of commands, agents, hooks, MCP config, manifest, rules, copied skills/scripts/docs, runtime path sanitization, and migration inventory belongs in the shared converter.

During the test phase, if MedNotes needs to improve generic conversion behavior, patch this shared Python converter first and then update AgentX wrapper/tests. Do not evolve a private MedNotes-only converter unless it is explicitly marked temporary and scheduled for upstreaming.

## Safety Contract

- The converter handles full extension-to-plugin projection: manifest, commands, existing skills, agents, compatible hooks, MCP config, rules, README, scripts/docs copy, and migration inventory.
- Generated Antigravity skill markdown must carry source markers and source paths.
- `${extensionPath}`, `${/}`, and `{{args}}` are normalized by the shared converter.
- Runtime JSON/code surfaces such as `mcp_config.json`, `hooks.json`, `scripts/`, and `src/` must not contain raw `${extensionPath}` or the source checkout path after conversion.
- MCP env references such as `$OPENAPI_MCP_HEADERS` are projected as `{env:OPENAPI_MCP_HEADERS}`. Sensitive literal env values are not written into generated plugin JSON; the converter emits a warning and writes an env reference instead.
- Compatible Gemini hook events are mapped to Antigravity events (`BeforeTool` -> `PreToolUse`, `AfterTool` -> `PostToolUse`). Unsupported hook events are warnings, not silent migrations.
- Gemini extension `mcpServers` is projected to `mcp_config.json`.
- Agent model ids are mapped where the Antigravity label is known; unknown model ids emit warnings.
- Missing prompt/description cases must emit warnings rather than silently inventing semantics.
- If Python is unavailable in AgentX runtime, full plugin conversion cannot run. AgentX sync should continue to degrade conservatively and avoid stale cleanup if conversion fails.

## Current Related OGB Work

- Gemini commands are projected to Antigravity skills through the command helper inside this converter.
- Complete Gemini extensions can now be projected to Antigravity plugins through `convert-extension-plugin`.
- Honcho setup is modeled separately through native capability setup surfaces and a managed `honcho-setup` skill for Gemini/Antigravity hosts without native `/honcho:setup`.
- OpenCode-only resources such as YOLO agents, global OpenCode `AGENTS.md`, TUI plugin files, and OpenCode command projections are marked by target/origin metadata in sync state and reports.
