#!/usr/bin/env python3
"""Refresh the bundled Hermes Desktop renderer for the Dashboard plugin."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
ALLOWED_SUFFIXES = {
    ".js", ".mjs", ".css", ".json", ".html", ".svg", ".png", ".jpg",
    ".jpeg", ".gif", ".webp", ".ico", ".woff2", ".woff", ".ttf", ".otf",
}
EXCLUDED_NAMES = {"node_modules", ".DS_Store"}
EXCLUDED_DIRS = {"native"}
EXCLUDED_ROOT_FILES = {
    "electron-main.mjs", "electron-preload.js", "preview-guest-preload.js",
    "hermes-build.json", "renderer-manifest.json",
}


def build(source: Path, destination: Path = PLUGIN_ROOT / "dashboard" / "frame") -> dict:
    source = source.expanduser().resolve()
    resolved_destination = destination.expanduser().resolve()
    if resolved_destination.is_relative_to(source) or source.is_relative_to(resolved_destination):
        raise ValueError("Payload source and destination must be separate trees; refusing to overwrite or recurse into the Desktop source checkout.")
    index = source / "index.html"
    if not index.is_file():
        raise FileNotFoundError(f"Desktop renderer index not found: {index}")
    stage = destination.with_name(destination.name + ".staging")
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    copied: list[str] = []
    rejected: list[str] = []
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        if any(part in EXCLUDED_NAMES | EXCLUDED_DIRS for part in relative.parts):
            continue
        if not path.is_file():
            continue
        if relative.as_posix() in EXCLUDED_ROOT_FILES or path.suffix.lower() == ".map":
            continue
        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            rejected.append(relative.as_posix())
            continue
        target = stage / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        copied.append(relative.as_posix())
    if "index.html" not in copied:
        shutil.rmtree(stage, ignore_errors=True)
        raise RuntimeError("Desktop index.html was excluded by the suffix allowlist.")
    shim = PLUGIN_ROOT / "desktop-web" / "hermes-web-shim.js"
    shutil.copy2(shim, stage / shim.name)
    index_path = stage / "index.html"
    html = index_path.read_text(encoding="utf-8")
    if "<head>" not in html:
        shutil.rmtree(stage, ignore_errors=True)
        raise RuntimeError("Desktop index.html has no plain <head> tag; refusing unsafe shim injection.")
    if "hermes-web-shim.js" not in html:
        html = html.replace("<head>", '<head>\n    <script src="./hermes-web-shim.js"></script>', 1)
    index_path.write_text(html, encoding="utf-8")
    backup = destination.with_name(destination.name + ".previous")
    if backup.exists():
        shutil.rmtree(backup)
    if destination.exists():
        destination.rename(backup)
    try:
        stage.rename(destination)
    except Exception:
        if backup.exists() and not destination.exists():
            backup.rename(destination)
        raise
    shutil.rmtree(backup, ignore_errors=True)
    return {"source": str(source), "destination": str(destination), "copied": copied, "rejected": rejected}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Desktop dist directory used to refresh the bundled renderer")
    parser.add_argument("--destination", type=Path, default=PLUGIN_ROOT / "dashboard" / "frame")
    args = parser.parse_args(argv)
    source_root = Path(os.environ.get("HERMES_SOURCE", Path.home() / ".hermes" / "hermes-agent")).expanduser()
    source = args.source or source_root / "apps" / "desktop" / "dist"
    try:
        print(json.dumps(build(source, args.destination), indent=2))
    except (OSError, RuntimeError, ValueError) as error:
        print(f"build-payload: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
