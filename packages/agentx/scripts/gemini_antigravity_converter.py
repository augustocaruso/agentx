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
import sys
from pathlib import Path
from typing import Any


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
            "<!-- GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT. -->",
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


def _render_command_skill_cli(args: argparse.Namespace) -> int:
    rendered = render_command_skill_from_file(
        source_path=args.source_path,
        source_rel_path=args.source_rel_path,
        extension_name=args.extension_name,
        extension_dir=args.extension_dir,
    )
    sys.stdout.write(json.dumps(rendered, ensure_ascii=False) + "\n")
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
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
