#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
export HERMES_HOME
DESTINATION="$HERMES_HOME/plugins/desktop-workbench"
PAYLOAD="$ROOT/dashboard/frame"
INSTALLED_PAYLOAD="$DESTINATION/dashboard/frame"

# The Desktop renderer is build output, not package source (see .gitignore), so a clean
# checkout has no payload. Use one already built here, otherwise stage one from a Desktop
# dist directory: an explicit HERMES_DESKTOP_DIST, a Hermes checkout, or a payload kept
# beside this repository.
renderer_source() {
  local candidate
  for candidate in \
    "${HERMES_DESKTOP_DIST:-}" \
    "${HERMES_SOURCE:+$HERMES_SOURCE/apps/desktop/dist}" \
    "$HERMES_HOME/hermes-agent/apps/desktop/dist" \
    "$HOME/src/hermes-agent/apps/desktop/dist" \
    "$ROOT/../hermes-desktop-frame-payload"; do
    if [[ -n "$candidate" && -f "$candidate/index.html" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! command -v hermes >/dev/null 2>&1; then
  echo "install-local: Hermes CLI not found; install Hermes first." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "install-local: python3 is required." >&2
  exit 1
fi
RENDERER_SOURCE="$(renderer_source || true)"
if [[ ! -f "$PAYLOAD/index.html" && -z "$RENDERER_SOURCE" ]]; then
  echo "install-local: no renderer payload in this checkout and no Desktop dist directory to build one from." >&2
  echo "Nothing was installed. Point HERMES_DESKTOP_DIST (or HERMES_SOURCE) at a Hermes Desktop build, then rerun:" >&2
  echo "  HERMES_DESKTOP_DIST=\$HOME/src/hermes-agent/apps/desktop/dist bash scripts/install-local.sh" >&2
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
PY

printf 'Copied plugin files to %s\n' "$DESTINATION"

if [[ -f "$PAYLOAD/index.html" ]]; then
  printf 'Using the renderer payload already built in this checkout.\n'
elif [[ -n "$RENDERER_SOURCE" ]]; then
  printf 'Building the Desktop renderer payload from %s\n' "$RENDERER_SOURCE"
  if ! python3 "$ROOT/scripts/build-payload.py" --source "$RENDERER_SOURCE" --destination "$INSTALLED_PAYLOAD" >/dev/null; then
    echo "install-local: the plugin was copied but the renderer payload could not be built;" >&2
    echo "the /workbench tab will report a missing payload until it is." >&2
    exit 1
  fi
fi

printf 'Desktop renderer payload is ready.\n'
hermes plugins enable desktop-workbench
printf '\nInstalled and enabled desktop-workbench. Start the Dashboard, then run:\n'
printf '  hermes desktop-workbench open\n'
