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

detect_desktop_build() {
  local source_dir
  if [[ -n "${HERMES_SOURCE:-}" ]]; then
    source_dir="$HERMES_SOURCE/apps/desktop/dist"
    if [[ -f "$source_dir/index.html" ]]; then
      echo "$source_dir"
      return 0
    fi
  fi
  for candidate in \
    "$HOME/.hermes/hermes-agent/apps/desktop/dist" \
    "$HOME/src/hermes-agent/apps/desktop/dist" \
    "$HOME/Documents/GitHub/hermes-agent/apps/desktop/dist"
  do
    if [[ -f "$candidate/index.html" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

fetch_and_build_desktop() {
  echo "install-local: No Hermes Desktop build detected. Fetching from GitHub and building..." >&2
  if ! command -v git >/dev/null 2>&1; then
    echo "install-local: git is required to fetch Hermes Agent from GitHub." >&2
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "install-local: Node.js is required to build the Hermes Desktop renderer." >&2
    exit 1
  fi
  if ! command -v uv >/dev/null 2>&1 && ! command -v npm >/dev/null 2>&1; then
    echo "install-local: uv or npm is required to install dependencies for the Desktop build." >&2
    exit 1
  fi
  local git_repo="https://github.com/NousResearch/hermes-agent.git"
  local workdir="$ROOT/.hermes-agent-build-temp"
  rm -rf "$workdir"
  echo "install-local: Cloning Hermes Agent from $git_repo ..." >&2
  git clone --depth 1 --branch main "$git_repo" "$workdir"
  echo "install-local: Building Hermes Desktop renderer..." >&2
  cd "$workdir/apps/desktop"
  if command -v uv >/dev/null 2>&1; then
    uv sync --frozen 2>/dev/null || uv sync
  else
    npm install 2>/dev/null || true
  fi
  if [[ -f "package.json" ]]; then
    if command -v uv >/dev/null 2>&1; then
      uv run npm run build 2>/dev/null || npm run build 2>/dev/null || true
    else
      npm run build 2>/dev/null || true
    fi
  fi
  if [[ ! -f "dist/index.html" ]]; then
    echo "install-local: Desktop build did not produce dist/index.html. Check the build logs above." >&2
    rm -rf "$workdir"
    exit 1
  fi
  echo "$workdir/apps/desktop/dist"
}

build_payload_from_source() {
  local source_dir="$1"
  local builder="$ROOT/scripts/build-payload.py"
  echo "install-local: Building renderer payload from $source_dir ..." >&2
  python3 "$builder" --source "$source_dir" --destination "$PAYLOAD"
}

verify_payload() {
  local payload_dir="$PAYLOAD"
  echo "install-local: Verifying payload integrity..." >&2
  if [[ ! -f "$payload_dir/index.html" ]]; then
    echo "install-local: VERIFICATION FAILED - index.html missing" >&2
    return 1
  fi
  if [[ ! -f "$payload_dir/hermes-web-shim.js" ]]; then
    echo "install-local: VERIFICATION FAILED - hermes-web-shim.js missing" >&2
    return 1
  fi
  if ! grep -q 'hermes-web-shim.js' "$payload_dir/index.html"; then
    echo "install-local: VERIFICATION FAILED - shim not injected into index.html" >&2
    return 1
  fi
  if [[ -d "$payload_dir/node_modules" ]]; then
    echo "install-local: VERIFICATION FAILED - node_modules should be excluded" >&2
    return 1
  fi
  if [[ -d "$payload_dir/native" ]]; then
    echo "install-local: VERIFICATION FAILED - native dir should be excluded" >&2
    return 1
  fi
  if find "$payload_dir" -name "*.map" | grep -q .; then
    echo "install-local: VERIFICATION FAILED - source maps should be excluded" >&2
    return 1
  fi
  echo "install-local: Payload verification passed." >&2
  return 0
}

if [[ ! -f "$PAYLOAD/index.html" || ! -f "$PAYLOAD/hermes-web-shim.js" ]]; then
  echo "install-local: Bundled Desktop renderer payload not found at $PAYLOAD." >&2
  if desktop_dir=$(detect_desktop_build); then
    echo "install-local: Found existing Desktop build at $desktop_dir. Building payload..." >&2
    build_payload_from_source "$desktop_dir"
  else
    desktop_dir=$(fetch_and_build_desktop)
    build_payload_from_source "$desktop_dir"
    rm -rf "$ROOT/.hermes-agent-build-temp"
  fi
  if ! verify_payload; then
    echo "install-local: Payload verification failed. Installation aborted." >&2
    exit 1
  fi
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
