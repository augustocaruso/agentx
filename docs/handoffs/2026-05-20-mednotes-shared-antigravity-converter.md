# Handoff: Shared Gemini To Antigravity Converter

## Context

Medical Notes Workbench already had a Python build script that converted Gemini CLI command surfaces into Antigravity plugin/skill surfaces. OGB now needs the same behavior. The agreed contract is one shared converter, not two divergent implementations.

## Source Of Truth

Use this Python module as the preferred source:

```text
packages/ogb/scripts/gemini_antigravity_converter.py
```

It exposes importable functions and a JSON CLI:

```bash
python packages/ogb/scripts/gemini_antigravity_converter.py render-command-skill \
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

## OGB Behavior

OGB's TypeScript wrapper now prefers the bundled Python converter when Python is available. The TypeScript implementation remains only as a portability fallback when Python is absent. If `OGB_ANTIGRAVITY_CONVERTER` or `OGB_PYTHON_BIN` is set, that explicit Python path is authoritative.

Relevant files:

```text
packages/ogb/src/antigravity-plugin-converter.ts
packages/ogb/src/antigravity-plugin-converter.test.ts
packages/ogb/scripts/gemini_antigravity_converter.py
```

## MedNotes Alignment

MedNotes should replace any copied conversion rules with one of these two approaches:

1. Import functions from `gemini_antigravity_converter.py` when running in-process Python.
2. Call the JSON CLI above when the caller is not Python.

During the test phase, if MedNotes needs to improve conversion behavior, patch this shared Python converter first and then update the OGB wrapper/tests. Do not evolve a private MedNotes-only converter unless it is explicitly marked temporary and scheduled for upstreaming.

## Safety Contract

- The converter renders prompts/commands only; it does not read or write secrets.
- Generated Antigravity skill markdown must carry source markers and source paths.
- `${extensionPath}`, `${/}`, and `{{args}}` are normalized by the shared converter.
- Missing prompt/description cases must emit warnings rather than silently inventing semantics.
- If Python is unavailable in OGB runtime, the TypeScript fallback keeps sync usable, but it is not the preferred source for converter evolution.

## Current Related OGB Work

- Gemini commands are projected to Antigravity skills through this converter.
- Honcho setup is modeled separately through native capability setup surfaces and a managed `honcho-setup` skill for Gemini/Antigravity hosts without native `/honcho:setup`.
- OpenCode-only resources such as YOLO agents, global OpenCode `AGENTS.md`, TUI plugin files, and OpenCode command projections are marked by target/origin metadata in sync state and reports.
