#!/usr/bin/env python3
"""Compatibility shim for the shared AgentX Antigravity converter.

Older consumers looked for the converter under packages/ogb/scripts. The real
source now lives under packages/agentx/scripts.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path


TARGET = Path(__file__).resolve().parents[2] / "agentx" / "scripts" / "gemini_antigravity_converter.py"

if __name__ == "__main__":
    sys.argv[0] = str(TARGET)
    runpy.run_path(str(TARGET), run_name="__main__")
