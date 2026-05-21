#!/usr/bin/env python3
"""Shared Gemini extension to Antigravity conversion helpers.

This module is intentionally Python because the first real-world converter was
validated in Medical Notes Workbench as a Python build script. Other projects
should import these functions, or call the JSON CLI below, instead of copying
conversion rules into their own runtime.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any


SCHEMA = "agentx.gemini-antigravity-converter.v1"
PLUGIN_ROOT_TOKEN = "<plugin-root>"
RUNTIME_ROOT_TOKEN = "."
ENV_REFERENCE_RE = re.compile(r"^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$")
OPENCODE_ENV_REFERENCE_RE = re.compile(r"^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$")
SENSITIVE_ENV_KEY_RE = re.compile(r"(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|AUTH|PRIVATE)", re.I)
HIGH_CONFIDENCE_SECRET_VALUE_RE = (
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{8,}", re.I),
    re.compile(r"\b(?:sk-|ntn_|ghp_|github_pat_|xox[baprs]-|AIza)[A-Za-z0-9._-]{8,}", re.I),
    re.compile(r"[\"']?(?:authorization|api[_-]?key|token|secret|password)[\"']?\s*[:=]\s*[\"'][^\"']{8,}[\"']", re.I),
)
TEXT_RUNTIME_SUFFIXES = {
    ".md",
    ".mdx",
    ".txt",
    ".json",
    ".jsonc",
    ".toml",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".css",
    ".scss",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".py",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".bat",
    ".cmd",
}
HOOK_EVENT_MAP = {
    "BeforeTool": "PreToolUse",
    "AfterTool": "PostToolUse",
}
AGENT_MODEL_MAP = {
    "gemini-3-flash-preview": "Gemini 3.5 Flash (High)",
    "google/gemini-3-flash-preview": "Gemini 3.5 Flash (High)",
    "gemini-3.1-flash-preview": "Gemini 3.5 Flash (High)",
    "google/gemini-3.1-flash-preview": "Gemini 3.5 Flash (High)",
    "gemini-3.1-pro-preview": "Gemini 3.1 Pro (High)",
    "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro (High)",
}
COPY_IGNORE = (
    "__pycache__",
    "*.pyc",
    ".venv",
    ".uv-cache",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "node_modules",
    ".DS_Store",
    ".env",
    "config.toml",
    ".telemetry-defaults.json",
    "telemetry.defaults.json",
    "extension-integrity-manifest.json",
    "gemini-extension.json",
    "GEMINI.md",
    "README.md",
    "commands",
)


def _safe_segment(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9._-]+", "-", value.strip().lower())
    normalized = normalized.strip("-")
    return normalized or "command"


def _command_segments(source_rel_path: str) -> list[str]:
    normalized = source_rel_path.replace(os.sep, "/")
    without_commands = normalized.removeprefix("commands/")
    suffix = Path(without_commands).suffix
    without_suffix = without_commands[: -len(suffix)] if suffix else without_commands
    return [_safe_segment(segment) for segment in without_suffix.split("/") if segment]


def slug_for_command(source_rel_path: str) -> str:
    return "-".join(_command_segments(source_rel_path)) or "command"


def public_name_for_command(source_rel_path: str) -> str:
    segments = _command_segments(source_rel_path)
    if len(segments) > 1:
        return f"{':'.join(segments[:-1])}:{segments[-1]}"
    return segments[0] if segments else "command"


def _parse_quoted_value(raw: str | None) -> str | None:
    if raw is None:
        return None
    trimmed = raw.strip()
    if not trimmed:
        return None
    if trimmed.startswith('"'):
        try:
            parsed = json.loads(trimmed)
            return parsed if isinstance(parsed, str) else trimmed
        except json.JSONDecodeError:
            return trimmed[1:-1] if trimmed.endswith('"') else trimmed[1:]
    if trimmed.startswith("'"):
        return trimmed[1:-1] if trimmed.endswith("'") else trimmed[1:]
    return trimmed


def parse_toml_command(text: str) -> tuple[str | None, str, list[str]]:
    warnings: list[str] = []
    description_match = re.search(r"^\s*description\s*=\s*(?P<value>\"[^\"\n]*(?:\\.[^\"\n]*)*\"|'[^'\n]*'|[^\n#]+)", text, re.M)
    block_match = re.search(r"^\s*prompt\s*=\s*(?P<quote>\"\"\"|''')\r?\n?(?P<value>[\s\S]*?)\r?\n?(?P=quote)", text, re.M)
    line_prompt_match = re.search(r"^\s*prompt\s*=\s*(?P<value>\"[^\"\n]*(?:\\.[^\"\n]*)*\"|'[^'\n]*'|[^\n#]+)", text, re.M)
    description = _parse_quoted_value(description_match.group("value") if description_match else None)
    prompt = block_match.group("value") if block_match else _parse_quoted_value(line_prompt_match.group("value") if line_prompt_match else None)

    if not description:
        warnings.append("Missing description")
    if not prompt or not prompt.strip():
        warnings.append("Missing prompt; copied raw TOML as fallback")
        prompt = text.strip()
    return description.strip() if description else None, prompt.strip(), warnings


def parse_markdown_command(text: str, fallback_description: str) -> tuple[str, str, list[str]]:
    match = re.match(r"^---\r?\n(?P<frontmatter>[\s\S]*?)\r?\n---\r?\n?", text)
    if not match:
        return fallback_description, text.strip(), []

    frontmatter = match.group("frontmatter") or ""
    description = fallback_description
    description_match = re.search(r"^\s*description\s*:\s*(?P<value>\"[^\"\n]*(?:\\.[^\"\n]*)*\"|'[^'\n]*'|[^\n]+)", frontmatter, re.M)
    raw_description = description_match.group("value").strip() if description_match else ""
    if raw_description.startswith('"'):
        try:
            parsed = json.loads(raw_description)
            if isinstance(parsed, str):
                description = parsed
        except json.JSONDecodeError:
            description = raw_description[1:-1] if raw_description.endswith('"') else raw_description[1:]
    elif raw_description.startswith("'"):
        description = raw_description[1:-1] if raw_description.endswith("'") else raw_description[1:]
    elif raw_description:
        description = raw_description

    return description, text[match.end() :].strip(), []


def normalize_command_prompt(prompt: str, extension_dir: str | None = None) -> str:
    output = re.sub(r"\{\{\s*args\s*\}\}", "$ARGUMENTS", prompt)
    if extension_dir:
        output = output.replace("${extensionPath}", extension_dir).replace("${/}", os.sep)
        runner = f'node "{extension_dir}/scripts/run_python.mjs"'
        output = re.sub(r"\buv run --project\s+\S+\s+python\s+", f"{runner} ", output)
        output = re.sub(r"\buv run python\s+", f"{runner} ", output)
    output = output.replace(" --config ~/.gemini/medical-notes-workbench/config.toml", "")
    output = output.replace(
        "~/.gemini/medical-notes-workbench/config.toml",
        "config.toml resolved at runtime from MEDNOTES_HOME when set; otherwise the Workbench app home",
    )
    output = re.sub(
        r"gemini extensions config\s+[\w.-]+\s+([A-Z0-9_]+)",
        r"configure \1 in the Antigravity environment",
        output,
    )
    return output.strip()


def render_command_skill(
    *,
    source_path: str,
    source_rel_path: str,
    description: str,
    prompt: str,
    extension_name: str | None = None,
    extension_dir: str | None = None,
) -> dict[str, Any]:
    public_name = public_name_for_command(source_rel_path)
    slug = slug_for_command(source_rel_path)
    source_lines = (
        [
            f"<!-- Source extension: {extension_name} -->",
            f"<!-- Source command: {source_rel_path} -->",
        ]
        if extension_name
        else [f"<!-- Source command: {source_rel_path} -->"]
    )
    body = "\n".join(
        [
            "---",
            f"name: {json.dumps(public_name)}",
            f"description: {json.dumps(f'Use when the user invokes /{public_name}. {description}')}",
            "---",
            "",
            f"# /{public_name}",
            "",
            "<!-- GENERATED BY agentX. DO NOT EDIT. -->",
            "<!-- SOURCE_KIND: gemini-antigravity-command-skill -->",
            *source_lines,
            f"<!-- Source file: {source_path} -->",
            "",
            "This skill is the Antigravity launcher generated from a Gemini CLI command.",
            f"When the user invokes /{public_name}, treat the text after the command as $ARGUMENTS.",
            "",
            "## Launcher Instructions",
            "",
            normalize_command_prompt(prompt, extension_dir),
            "",
        ]
    )
    return {
        "slug": slug,
        "publicName": public_name,
        "description": description,
        "markdown": body,
    }


def render_command_skill_from_file(
    *,
    source_path: str,
    source_rel_path: str,
    extension_name: str | None = None,
    extension_dir: str | None = None,
) -> dict[str, Any]:
    path = Path(source_path)
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".toml":
        description, prompt, warnings = parse_toml_command(text)
        description = description or f"Gemini command: {source_rel_path}"
    else:
        fallback = f"Gemini command: {source_rel_path}"
        description, prompt, warnings = parse_markdown_command(text, fallback)

    rendered = render_command_skill(
        source_path=source_path,
        source_rel_path=source_rel_path,
        description=description,
        prompt=prompt,
        extension_name=extension_name,
        extension_dir=extension_dir,
    )
    rendered["warnings"] = warnings
    return rendered


def _read_json(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(parsed, dict):
        raise RuntimeError(f"JSON root must be an object: {path}")
    return parsed


def _plugin_name(source_dir: Path, explicit: str | None = None) -> str:
    if explicit and explicit.strip():
        return _safe_segment(explicit)
    manifest = _read_json(source_dir / "gemini-extension.json")
    name = manifest.get("name")
    if isinstance(name, str) and name.strip():
        return _safe_segment(name)
    return _safe_segment(source_dir.name)


def _copy_extension_payload(source_dir: Path, output_dir: Path) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    shutil.copytree(source_dir, output_dir, ignore=shutil.ignore_patterns(*COPY_IGNORE))
    shutil.rmtree(output_dir / "hooks", ignore_errors=True)


def _sanitize_runtime_text(text: str, source_dir: Path, plugin_root_token: str = PLUGIN_ROOT_TOKEN) -> str:
    text = re.sub(
        r"gemini extensions config\s+[\w.-]+\s+([A-Z0-9_]+)",
        r"configure \1 in the Antigravity environment",
        text,
    )
    text = re.sub(r"~/.gemini/extensions/[\w.-]+", plugin_root_token, text)
    replacements = {
        str(source_dir): plugin_root_token,
        "${extensionPath}": plugin_root_token,
        "~/.gemini/extensions": "<antigravity-plugin-install-root>",
        "${/}": os.sep,
        "Gemini CLI extension": "Antigravity plugin",
        "Gemini CLI Extension": "Antigravity Plugin",
        "Gemini CLI hooks": "Antigravity hooks",
        "Gemini CLI hook": "Antigravity hook",
        "gemini extensions validate": "agy plugin validate",
        "gemini extensions install": "install the Antigravity plugin",
        "gemini extensions uninstall": "remove the Antigravity plugin",
        "gemini extensions list": "inspect Antigravity plugins/customizations",
        "gemini extensions update": "update the Antigravity plugin bundle",
        "gemini extensions": "Antigravity plugins",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def _sanitize_runtime_files(output_dir: Path, source_dir: Path) -> None:
    for base_name in ["skills", "rules", "agents", "docs"]:
        base = output_dir / base_name
        if not base.exists():
            continue
        for path in base.rglob("*.md"):
            path.write_text(_sanitize_runtime_text(path.read_text(encoding="utf-8"), source_dir), encoding="utf-8")
    for base_name in ["scripts", "src", "examples"]:
        base = output_dir / base_name
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in TEXT_RUNTIME_SUFFIXES:
                continue
            path.write_text(
                _sanitize_runtime_text(path.read_text(encoding="utf-8"), source_dir, RUNTIME_ROOT_TOKEN),
                encoding="utf-8",
            )


def _inventory_row(source: str, kind: str, destination: str, status: str, note: str) -> dict[str, str]:
    return {
        "source": source,
        "kind": kind,
        "destination": destination,
        "status": status,
        "note": note,
    }


def _write_manifest(output_dir: Path, plugin_name: str) -> None:
    (output_dir / "plugin.json").write_text(json.dumps({"name": plugin_name}, indent=2) + "\n", encoding="utf-8")


def _write_rules(source_dir: Path, output_dir: Path, plugin_name: str, inventory: list[dict[str, str]], warnings: list[str]) -> None:
    gemini_md = source_dir / "GEMINI.md"
    if not gemini_md.exists():
        warnings.append("Missing GEMINI.md; no Antigravity rules file generated.")
        return
    rules_dir = output_dir / "rules"
    rules_dir.mkdir(parents=True, exist_ok=True)
    rules_rel = f"rules/{plugin_name}.md"
    source_text = _sanitize_runtime_text(gemini_md.read_text(encoding="utf-8"), source_dir)
    rules = "\n".join(
        [
            f"# {plugin_name}",
            "",
            "These rules were generated from the canonical Gemini CLI extension GEMINI.md.",
            f"Inside Antigravity, treat `{PLUGIN_ROOT_TOKEN}` as the installed plugin root.",
            "",
            source_text,
            "",
        ]
    )
    (output_dir / rules_rel).write_text(rules, encoding="utf-8")
    inventory.append(_inventory_row("GEMINI.md", "instruction", rules_rel, "migrated", "projected to Antigravity rules"))


def _write_readme(source_dir: Path, output_dir: Path, plugin_name: str, inventory: list[dict[str, str]], warnings: list[str]) -> None:
    source_readme = source_dir / "README.md"
    if source_readme.exists():
        body = _sanitize_runtime_text(source_readme.read_text(encoding="utf-8"), source_dir)
    else:
        body = "This plugin was generated from a Gemini CLI extension."
        warnings.append("Missing README.md; generated a minimal Antigravity README.")
    readme = "\n".join(
        [
            f"# {plugin_name} Antigravity Plugin",
            "",
            "This bundle is generated from the canonical Gemini CLI extension source.",
            "Do not edit generated plugin files as source of truth.",
            "",
            body.strip(),
            "",
        ]
    )
    (output_dir / "README.md").write_text(readme, encoding="utf-8")
    inventory.append(_inventory_row("README.md", "docs", "README.md", "migrated", "sanitized for Antigravity runtime"))


def _command_files(source_dir: Path) -> list[Path]:
    commands_dir = source_dir / "commands"
    if not commands_dir.exists():
        return []
    return sorted([*commands_dir.rglob("*.toml"), *commands_dir.rglob("*.md")])


def _unique_segment(base: str, used: set[str]) -> str:
    candidate = _safe_segment(base)
    if candidate not in used:
        used.add(candidate)
        return candidate
    index = 2
    while f"{candidate}-{index}" in used:
        index += 1
    unique = f"{candidate}-{index}"
    used.add(unique)
    return unique


def _existing_skill_segments(output_dir: Path) -> set[str]:
    skills_dir = output_dir / "skills"
    if not skills_dir.exists():
        return set()
    return {path.name for path in skills_dir.iterdir() if path.is_dir()}


def _generate_command_skills(source_dir: Path, output_dir: Path, plugin_name: str, inventory: list[dict[str, str]], warnings: list[str]) -> int:
    count = 0
    used = _existing_skill_segments(output_dir)
    for source in _command_files(source_dir):
        source_rel_path = source.relative_to(source_dir).as_posix()
        converted = render_command_skill_from_file(
            source_path=str(source),
            source_rel_path=source_rel_path,
            extension_name=plugin_name,
            extension_dir=PLUGIN_ROOT_TOKEN,
        )
        target_slug = _unique_segment(str(converted["slug"]), used)
        destination = output_dir / "skills" / target_slug / "SKILL.md"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(str(converted["markdown"]).rstrip() + "\n", encoding="utf-8")
        for warning in converted.get("warnings") or []:
            warnings.append(f"Command {source_rel_path}: {warning}")
        note = f"converted by shared command renderer preserving /{converted['publicName']}"
        if target_slug != converted["slug"]:
            note += f"; destination slug changed from {converted['slug']} to avoid collision"
        inventory.append(_inventory_row(source_rel_path, "command", f"skills/{target_slug}/SKILL.md", "migrated", note))
        count += 1
    return count


def _rewrite_agent_models(output_dir: Path, source_dir: Path, warnings: list[str]) -> int:
    agents_dir = output_dir / "agents"
    if not agents_dir.exists():
        return 0
    count = 0
    note = (
        "## Antigravity Plugin Root\n\n"
        f"This agent is packaged inside an Antigravity plugin. Treat `{PLUGIN_ROOT_TOKEN}` "
        "as the installed plugin root at runtime.\n\n"
    )
    for path in sorted(agents_dir.glob("*.md")):
        text = _sanitize_runtime_text(path.read_text(encoding="utf-8"), source_dir)
        if text.startswith("---\n"):
            end = text.find("\n---", 4)
            if end > 0:
                frontmatter = text[4:end]
                body = text[end + len("\n---") :]
                model_match = re.search(
                    r"^(?P<prefix>\s*model\s*:\s*)(?P<quote>['\"]?)(?P<model>[^'\"\n]+)(?P=quote)\s*$",
                    frontmatter,
                    re.M,
                )
                if model_match:
                    source_model = model_match.group("model").strip()
                    target_model = AGENT_MODEL_MAP.get(source_model)
                    if target_model:
                        replacement = f"{model_match.group('prefix')}{json.dumps(target_model)}"
                        frontmatter = frontmatter[: model_match.start()] + replacement + frontmatter[model_match.end() :]
                    else:
                        warnings.append(f"Agent {path.relative_to(output_dir).as_posix()} has unmapped model {source_model!r}.")
                text = f"---\n{frontmatter}\n---{body}"
        if "## Antigravity Plugin Root" not in text:
            if text.startswith("---\n"):
                end = text.find("\n---", 4)
                if end > 0:
                    marker_end = end + len("\n---")
                    text = f"{text[:marker_end]}\n\n{note}{text[marker_end:].lstrip()}"
            else:
                text = f"{note}{text.lstrip()}"
        path.write_text(text, encoding="utf-8")
        count += 1
    return count


def _sanitize_hook_value(value: Any, source_dir: Path) -> Any:
    if isinstance(value, str):
        return _sanitize_runtime_text(value, source_dir, RUNTIME_ROOT_TOKEN)
    if isinstance(value, list):
        return [_sanitize_hook_value(item, source_dir) for item in value]
    if isinstance(value, dict):
        return {str(key): _sanitize_hook_value(item, source_dir) for key, item in value.items()}
    return value


def _write_hooks(source_dir: Path, output_dir: Path, plugin_name: str, inventory: list[dict[str, str]], warnings: list[str]) -> int:
    hooks_dir = source_dir / "hooks"
    if not hooks_dir.exists():
        return 0
    groups: dict[str, dict[str, Any]] = {}
    used_groups: set[str] = set()
    for hook_file in sorted(path for path in hooks_dir.rglob("*.json") if path.is_file()):
        parsed = _read_json(hook_file)
        root = parsed.get("hooks") if isinstance(parsed.get("hooks"), dict) else parsed
        group: dict[str, Any] = {}
        for source_event, target_event in HOOK_EVENT_MAP.items():
            entries = root.get(source_event)
            if isinstance(entries, list) and entries:
                group[target_event] = _sanitize_hook_value(entries, source_dir)
        for source_event in sorted(root):
            if source_event not in HOOK_EVENT_MAP:
                warnings.append(
                    f"Hook event {source_event} in {hook_file.relative_to(source_dir).as_posix()} has no generic Antigravity mapping; review manually."
                )
        if group:
            rel = hook_file.relative_to(hooks_dir).with_suffix("").as_posix()
            group_name = _unique_segment(f"{plugin_name}-{rel}", used_groups)
            groups[group_name] = group
            inventory.append(
                _inventory_row(
                    hook_file.relative_to(source_dir).as_posix(),
                    "hook",
                    "hooks.json",
                    "migrated",
                    "converted compatible Gemini hook events to Antigravity hook events",
                )
            )
    if not groups:
        return 0
    (output_dir / "hooks.json").write_text(json.dumps(groups, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return sum(len(events) for events in groups.values())


def _referenced_env_name(value: str) -> str | None:
    stripped = value.strip()
    match = ENV_REFERENCE_RE.match(stripped)
    if match:
        return match.group(1) or match.group(2)
    opencode_match = OPENCODE_ENV_REFERENCE_RE.match(stripped)
    if opencode_match:
        return opencode_match.group(1)
    return None


def _env_reference(name: str) -> str:
    return f"{{env:{name}}}"


def _value_looks_sensitive(value: str) -> bool:
    return any(pattern.search(value) for pattern in HIGH_CONFIDENCE_SECRET_VALUE_RE)


def _should_store_mcp_env_literal(key: str, value: str) -> bool:
    return _referenced_env_name(value) is None and (SENSITIVE_ENV_KEY_RE.search(key) is not None or _value_looks_sensitive(value))


def _sanitize_mcp_runtime_value(value: Any, source_dir: Path) -> Any:
    if isinstance(value, str):
        return _sanitize_runtime_text(value, source_dir, RUNTIME_ROOT_TOKEN)
    if isinstance(value, list):
        return [_sanitize_mcp_runtime_value(item, source_dir) for item in value]
    if isinstance(value, dict):
        return {str(key): _sanitize_mcp_runtime_value(item, source_dir) for key, item in value.items()}
    return value


def _project_mcp_env(server_name: str, raw_env: Any, source_dir: Path, warnings: list[str]) -> dict[str, str] | None:
    if raw_env is None:
        return None
    if not isinstance(raw_env, dict):
        warnings.append(f"MCP {server_name}.env must be an object; skipping environment.")
        return None
    projected: dict[str, str] = {}
    for key in sorted(raw_env):
        raw_value = raw_env[key]
        if not isinstance(key, str) or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            warnings.append(f"MCP {server_name}.env has an invalid env key; skipping it.")
            continue
        if not isinstance(raw_value, str):
            warnings.append(f"MCP {server_name}.env.{key} is not a string; skipping it.")
            continue
        value = _sanitize_runtime_text(raw_value, source_dir, RUNTIME_ROOT_TOKEN)
        env_name = _referenced_env_name(value)
        if env_name:
            projected[key] = _env_reference(env_name)
            continue
        if _should_store_mcp_env_literal(key, value):
            projected[key] = _env_reference(key)
            warnings.append(f"MCP {server_name}.env.{key} contains a sensitive literal; projected an env reference instead.")
            continue
        projected[key] = value
    return projected or None


def _project_mcp_servers(servers: dict[str, Any], source_dir: Path, warnings: list[str]) -> dict[str, Any]:
    projected: dict[str, Any] = {}
    for server_name in sorted(servers):
        raw_server = servers[server_name]
        if not isinstance(raw_server, dict):
            warnings.append(f"MCP {server_name} must be an object; skipping it.")
            continue
        server = {
            str(key): _sanitize_mcp_runtime_value(value, source_dir)
            for key, value in raw_server.items()
            if key != "env"
        }
        env = _project_mcp_env(str(server_name), raw_server.get("env"), source_dir, warnings)
        if env:
            server["env"] = env
        projected[str(server_name)] = server
    return projected


def _write_mcp_config(source_dir: Path, output_dir: Path, inventory: list[dict[str, str]], warnings: list[str]) -> int:
    manifest = _read_json(source_dir / "gemini-extension.json")
    servers = manifest.get("mcpServers")
    if servers is None:
        inventory.append(_inventory_row("gemini-extension.json:mcpServers", "mcp", "n/a", "not_applicable", "manifest does not define mcpServers"))
        return 0
    if not isinstance(servers, dict):
        raise RuntimeError("gemini-extension.json mcpServers must be an object when present")
    projected_servers = _project_mcp_servers(servers, source_dir, warnings)
    (output_dir / "mcp_config.json").write_text(json.dumps({"mcpServers": projected_servers}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    inventory.append(_inventory_row("gemini-extension.json:mcpServers", "mcp", "mcp_config.json", "migrated", "projected to Antigravity mcp_config.json"))
    return len(servers)


def _classify_source(path: Path, source_dir: Path) -> str:
    rel = path.relative_to(source_dir)
    parts = rel.parts
    if rel.name == "GEMINI.md":
        return "instruction"
    if rel.name == "gemini-extension.json":
        return "config"
    if rel.name == "README.md":
        return "docs"
    if parts and parts[0] == "commands":
        return "command"
    if parts and parts[0] == "hooks":
        return "hook"
    if parts and parts[0] == "agents":
        return "agent"
    if parts and parts[0] == "skills" and rel.name == "SKILL.md":
        return "skill"
    if parts and parts[0] in {"scripts", "src"}:
        return "script"
    if parts and parts[0] in {"docs", "examples"}:
        return "docs"
    return "file"


def _add_copy_inventory(source_dir: Path, output_dir: Path, inventory: list[dict[str, str]]) -> int:
    existing_sources = {row["source"] for row in inventory}
    for path in sorted(source_dir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(source_dir).as_posix()
        if rel in existing_sources or rel.startswith("commands/") or rel.startswith("hooks/") or rel in {"GEMINI.md", "README.md"}:
            continue
        if rel == "gemini-extension.json":
            destination = "plugin.json"
            note = "projected to Antigravity plugin manifest"
        else:
            destination = rel
            note = "copied from canonical extension source"
        inventory.append(_inventory_row(rel, _classify_source(path, source_dir), destination, "migrated", note))
    return len([path for path in (output_dir / "skills").glob("*/SKILL.md")]) if (output_dir / "skills").exists() else 0


def _write_migration_notes(output_dir: Path, inventory: list[dict[str, str]], warnings: list[str]) -> None:
    table = [
        "| Gemini CLI source | Type | Antigravity destination | Status | Note |",
        "|---|---|---|---|---|",
    ]
    for row in inventory:
        table.append(f"| `{row['source']}` | {row['kind']} | `{row['destination']}` | {row['status']} | {row['note']} |")
    warning_lines = "\n".join(f"- {warning}" for warning in warnings) or "- None"
    notes = f"""# Migration Notes

This file is generated by the shared AgentX Gemini-to-Antigravity converter.
The canonical source remains the Gemini CLI extension directory.

## Summary

- Commands were converted to Antigravity launcher skills.
- GEMINI.md was projected to rules when present.
- Compatible Gemini hook events were projected to Antigravity hook events.
- MCP servers were projected to mcp_config.json when present.

## Warnings

{warning_lines}

## Inventory

{chr(10).join(table)}
"""
    (output_dir / "MIGRATION_NOTES.md").write_text(notes, encoding="utf-8")


def _validate_bundle(output_dir: Path, source_dir: Path, plugin_name: str) -> None:
    manifest = _read_json(output_dir / "plugin.json")
    if manifest != {"name": plugin_name}:
        raise RuntimeError("Antigravity plugin manifest must be minimal and namespaced")
    runtime_files = [
        output_dir / "hooks.json",
        output_dir / "mcp_config.json",
        output_dir / "README.md",
        output_dir / "MIGRATION_NOTES.md",
    ]
    for rel_glob in [
        "rules/*.md",
        "agents/*.md",
        "docs/*.md",
        "skills/*/SKILL.md",
        "scripts/**/*",
        "src/**/*",
    ]:
        runtime_files.extend(output_dir.glob(rel_glob))
    for path in runtime_files:
        if not path.exists() or not path.is_file():
            continue
        if path.suffix and path.suffix.lower() not in TEXT_RUNTIME_SUFFIXES:
            continue
        text = path.read_text(encoding="utf-8")
        for token in ["${extensionPath}", str(source_dir)]:
            if token in text:
                raise RuntimeError(f"Forbidden Gemini runtime token {token!r} leaked into {path}")


def convert_extension_plugin(
    *,
    source_dir: str | Path,
    output_dir: str | Path,
    plugin_name: str | None = None,
) -> dict[str, Any]:
    source = Path(source_dir).resolve()
    output = Path(output_dir).resolve()
    if not source.is_dir():
        raise RuntimeError(f"Gemini extension source directory does not exist: {source}")
    name = _plugin_name(source, plugin_name)
    inventory: list[dict[str, str]] = []
    warnings: list[str] = []

    _copy_extension_payload(source, output)
    _write_manifest(output, name)
    _write_rules(source, output, name, inventory, warnings)
    mcp_servers = _write_mcp_config(source, output, inventory, warnings)
    command_skills = _generate_command_skills(source, output, name, inventory, warnings)
    _sanitize_runtime_files(output, source)
    agents = _rewrite_agent_models(output, source, warnings)
    hooks = _write_hooks(source, output, name, inventory, warnings)
    _write_readme(source, output, name, inventory, warnings)
    skills = _add_copy_inventory(source, output, inventory)
    _write_migration_notes(output, inventory, warnings)
    _validate_bundle(output, source, name)
    return {
        "schema": SCHEMA,
        "status": "converted",
        "pluginName": name,
        "sourceDir": str(source),
        "pluginDir": str(output),
        "counts": {
            "commandSkills": command_skills,
            "hooks": hooks,
            "mcpServers": mcp_servers,
            "agents": agents,
            "skills": skills,
            "inventory": len(inventory),
        },
        "warnings": warnings,
        "inventory": inventory,
    }


def _render_command_skill_cli(args: argparse.Namespace) -> int:
    rendered = render_command_skill_from_file(
        source_path=args.source_path,
        source_rel_path=args.source_rel_path,
        extension_name=args.extension_name,
        extension_dir=args.extension_dir,
    )
    sys.stdout.write(json.dumps(rendered, ensure_ascii=False) + "\n")
    return 0


def _convert_extension_plugin_cli(args: argparse.Namespace) -> int:
    payload = convert_extension_plugin(
        source_dir=args.source_dir,
        output_dir=args.output_dir,
        plugin_name=args.plugin_name,
    )
    if args.json:
        sys.stdout.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(f"Converted Antigravity plugin: {payload['pluginDir']}\n")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Shared Gemini to Antigravity converter.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    render = subparsers.add_parser("render-command-skill", description="Render one Gemini command as an Antigravity skill.")
    render.add_argument("--source-path", required=True)
    render.add_argument("--source-rel-path", required=True)
    render.add_argument("--extension-name")
    render.add_argument("--extension-dir")
    render.set_defaults(func=_render_command_skill_cli)
    convert = subparsers.add_parser("convert-extension-plugin", description="Convert a Gemini CLI extension directory into an Antigravity plugin directory.")
    convert.add_argument("--source-dir", required=True)
    convert.add_argument("--output-dir", required=True)
    convert.add_argument("--plugin-name")
    convert.add_argument("--json", action="store_true")
    convert.set_defaults(func=_convert_extension_plugin_cli)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
