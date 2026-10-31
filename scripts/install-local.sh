#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
export HERMES_HOME
DESTINATION="$HERMES_HOME/plugins/desktop-workbench"
PAYLOAD="$ROOT/dashboard/frame"

if ! command -v hermes >/dev/null 2>&1; then
  echo "install-local: Hermes CLI not found; install Hermes first." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "install-local: python3 is required." >&2
  exit 1
fi
if [[ ! -f "$PAYLOAD/index.html" || ! -f "$PAYLOAD/hermes-web-shim.js" ]]; then
  echo "install-local: the bundled Desktop renderer payload is incomplete at $PAYLOAD." >&2
  echo "Re-download or refresh the plugin package before installing." >&2
  exit 1
fi

mkdir -p "$(dirname "$DESTINATION")"
python3 - "$ROOT" "$DESTINATION" <<'PY'
import shutil
import sys
import tempfile
from pathlib import Path

source = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).expanduser()
if destination.is_symlink():
    raise SystemExit(f"install-local: refusing to replace symlink {destination}.")
destination = destination.resolve()
if source == destination or source.is_relative_to(destination) or destination.is_relative_to(source):
    raise SystemExit("install-local: plugin source and install directory must be separate.")
if not (source / "plugin.yaml").is_file():
    raise SystemExit(f"install-local: no plugin.yaml found in {source}.")
if destination.exists() and not (destination / "plugin.yaml").is_file():
    raise SystemExit(f"install-local: refusing to replace non-plugin directory {destination}.")

excluded = {
    ".git", ".DS_Store", ".build", ".freebuff", ".venv", "__pycache__", ".pytest_cache",
    "hermes-agent-main-dev", "Hermes-Desktop-Online", "node_modules", "frame.staging", "frame.previous",
}

def ignore(_directory: str, names: list[str]) -> set[str]:
    return {name for name in names if name in excluded or name.endswith(".pyc")}

staging = Path(tempfile.mkdtemp(prefix=".desktop-workbench-staging-", dir=destination.parent))
staging.rmdir()
backup = destination.with_name(destination.name + ".previous")
if backup.exists():
    raise SystemExit(f"install-local: backup already exists at {backup}; inspect it before retrying.")
try:
    shutil.copytree(source, staging, ignore=ignore)
    if destination.exists():
        destination.rename(backup)
    try:
        staging.rename(destination)
    except BaseException:
        if backup.exists() and not destination.exists():
            backup.rename(destination)
        raise
except BaseException:
    if staging.exists():
        shutil.rmtree(staging)
    raise
if backup.exists():
    shutil.rmtree(backup)
print(f"Copied plugin files to {destination}")
PY

printf 'Bundled Hermes Desktop renderer is ready.\n'
hermes plugins enable desktop-workbench
printf '\nInstalled and enabled desktop-workbench. Start the Dashboard, then run:\n'
printf '  hermes desktop-workbench open\n'
