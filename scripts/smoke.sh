#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PYTHON="${PYTHON:-python3}"
"$PYTHON" -m pytest -q
node --check dashboard/src/index.js
node --check dashboard/dist/index.js
node --check desktop-web/hermes-web-shim.js
"$PYTHON" -m py_compile __init__.py cli/__init__.py dashboard/plugin_api.py scripts/build-payload.py tests/test_plugin.py
"$PYTHON" - <<'PY'
import json
from pathlib import Path
plugin = Path.cwd()
manifest = json.loads((plugin / "dashboard/manifest.json").read_text())
assert manifest["tab"]["path"] == "/workbench"
assert (plugin / "dashboard/dist/index.js").is_file()
assert (plugin / "dashboard/dist/style.css").is_file()
assert not (plugin / "dashboard/frame/index.html").exists() or "hermes-web-shim.js" in (plugin / "dashboard/frame/index.html").read_text()
print("manifest and payload integrity: ok")
PY
