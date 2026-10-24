"""Operator CLI for desktop-workbench.

`hermes desktop-workbench` is registered by the native Hermes Agent plugin
loader. The CLI never starts a second HTTP listener: it delegates to the
existing `hermes dashboard` process and its `/dashboard-plugins/` static mount.

Official registration contract:
https://hermes-agent.nousresearch.com/docs/developer-guide/plugins
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

PLUGIN_NAME = "desktop-workbench"
DEFAULT_URL = "http://127.0.0.1:9119"


def register_cli(parser: argparse.ArgumentParser) -> None:
    """Create the Hermes CLI parser for `hermes desktop-workbench ...`."""
    subs = parser.add_subparsers(dest="workbench_command")
    open_parser = subs.add_parser("open", help="Open the Workbench route in your browser")
    open_parser.add_argument("--url", default=os.environ.get("HERMES_DASHBOARD_URL", DEFAULT_URL), help="Dashboard origin (default: %(default)s)")
    open_parser.add_argument("--start", action="store_true", help="Start the existing Hermes Dashboard if not already reachable")
    open_parser.add_argument("--host", default="127.0.0.1", help="Host passed to `hermes dashboard` only when --start is used")
    open_parser.add_argument("--port", type=int, default=9119, help="Dashboard port passed when starting it")
    subs.add_parser("status", help="Show renderer, Dashboard and installed payload status")
    stop_parser = subs.add_parser("stop", help="Stop a Dashboard process started by Workbench")
    stop_parser.add_argument("--timeout", type=float, default=8.0, help="Seconds to wait for graceful shutdown")
    subs.add_parser("build", help="Refresh the bundled renderer from a Hermes Desktop checkout (maintainers)")
    sync_parser = subs.add_parser("sync", help="Sync the plugin into ~/.hermes/plugins/desktop-workbench")
    sync_parser.add_argument("--install", action="store_true", help="Sync and enable the plugin in Hermes config")
    parser.set_defaults(func=desktop_workbench_command)


def _plugin_dir() -> Path:
    return Path(__file__).resolve().parent.parent


def _home() -> Path:
    configured = os.environ.get("HERMES_HOME")
    return Path(configured).expanduser() if configured else Path.home() / ".hermes"


def _source_checkout() -> Path:
    configured = os.environ.get("HERMES_SOURCE")
    candidates = [Path(configured).expanduser()] if configured else []
    candidates.extend((Path.home() / ".hermes" / "hermes-agent", Path.home() / "src" / "hermes-agent"))
    for candidate in candidates:
        if (candidate / "apps" / "desktop" / "dist" / "index.html").is_file():
            return candidate
    raise RuntimeError("Hermes Desktop build not found. Set HERMES_SOURCE to a Hermes Agent checkout with apps/desktop/dist/index.html.")


def _dashboard_url(origin: str, *, start: bool = False, host: str = "127.0.0.1", port: int = 9119) -> str:
    from urllib.parse import urlsplit
    parsed = urlsplit(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Dashboard URL must be an HTTP(S) origin without embedded credentials.")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("Pass only a Dashboard origin; path, query and fragment are not accepted.")
    base = origin.rstrip("/")
    workbench_url = base + "/workbench"
    if _probe(workbench_url):
        return workbench_url
    if not start:
        raise RuntimeError(f"Hermes Dashboard is not reachable at {workbench_url}. Start it with `hermes dashboard` or pass --start.")
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("--start only permits loopback binds; start remote dashboards separately with their documented authentication configuration.")
    pid_path = _pid_path()
    if pid_path.exists():
        try:
            pid = int(pid_path.read_text(encoding="ascii").strip())
            os.kill(pid, 0)
        except (ValueError, OSError):
            pid_path.unlink(missing_ok=True)
    if not pid_path.exists():
        command = ["hermes", "dashboard", "--no-open", "--host", host, "--port", str(port)]
        log_path = _home() / "logs" / "desktop-workbench-dashboard.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_file = log_path.open("ab")
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True)
        pid_path.parent.mkdir(parents=True, exist_ok=True)
        pid_path.write_text(str(process.pid), encoding="ascii")
    expected = f"http://{host}:{port}/workbench"
    for _ in range(80):
        if _probe(expected):
            return expected
        time.sleep(0.25)
    raise RuntimeError(f"Dashboard did not become ready at {expected}; inspect {_home() / 'logs' / 'desktop-workbench-dashboard.log'}.")


def _probe(url: str) -> bool:
    try:
        with urlopen(url, timeout=0.7) as response:
            return response.status < 500
    except (URLError, TimeoutError, OSError):
        return False


def _pid_path() -> Path:
    return _home() / "run" / "desktop-workbench-dashboard.pid"


def _copy_payload() -> dict:
    """Refresh the bundled renderer from a locally available Hermes checkout."""
    source = _source_checkout() / "apps" / "desktop" / "dist"
    destination = _plugin_dir() / "dashboard" / "frame"
    builder = _plugin_dir() / "scripts" / "build-payload.py"
    result = subprocess.run(
        [sys.executable, str(builder), "--source", str(source), "--destination", str(destination)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip() or f"builder exited with status {result.returncode}"
        raise RuntimeError(f"Payload build failed: {detail}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Payload builder returned invalid JSON.") from exc


def _sync(install: bool = False) -> Path:
    source = _plugin_dir()
    destination = _home() / "plugins" / PLUGIN_NAME
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = destination.with_name(destination.name + ".staging")
    if stage.exists():
        shutil.rmtree(stage)
    shutil.copytree(
        source,
        stage,
        ignore=shutil.ignore_patterns(
            ".git", "__pycache__", "*.pyc", ".DS_Store", "node_modules",
            "frame.staging", "frame.previous",
        ),
    )

    if destination.exists():
        backup = destination.with_name(destination.name + ".previous")
        if backup.exists():
            shutil.rmtree(backup)
        destination.rename(backup)
    else:
        backup = None
    stage.rename(destination)
    if backup:
        shutil.rmtree(backup, ignore_errors=True)
    if install:
        _enable_plugin()
    return destination


def _enable_plugin() -> None:
    result = subprocess.run(["hermes", "plugins", "enable", PLUGIN_NAME], check=False)
    if result.returncode:
        raise RuntimeError(
            f"Plugin files were synced, but Hermes could not enable {PLUGIN_NAME}; "
            f"run `hermes plugins enable {PLUGIN_NAME}` after resolving the reported issue."
        )


def _status() -> int:
    plugin = _plugin_dir()
    frame = plugin / "dashboard" / "frame" / "index.html"
    source = None
    try:
        source = _source_checkout()
    except RuntimeError:
        pass
    print(json.dumps({
        "plugin": str(plugin),
        "installed": (_home() / "plugins" / PLUGIN_NAME).is_dir(),
        "sourceCheckout": str(source) if source else None,
        "payloadBuilt": frame.is_file(),
        "payloadFiles": sum(1 for p in (frame.parent.rglob('*') if frame.parent.exists() else []) if p.is_file()),
        "dashboardPid": _read_pid(),
        "dashboardReachable": _probe(DEFAULT_URL + "/"),
        "workbenchReachable": _probe(DEFAULT_URL + "/workbench"),
    }, indent=2))
    return 0


def _read_pid() -> int | None:
    try:
        pid = int(_pid_path().read_text(encoding="ascii").strip())
        os.kill(pid, 0)
        return pid
    except (OSError, ValueError):
        return None


def _stop(timeout: float) -> int:
    path = _pid_path()
    pid = _read_pid()
    if pid is None:
        path.unlink(missing_ok=True)
        print("No Dashboard process started by desktop-workbench is running.")
        return 0
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        path.unlink(missing_ok=True)
        print("Dashboard process already exited.")
        return 0
    deadline = time.monotonic() + max(0.1, timeout)
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            path.unlink(missing_ok=True)
            print("Dashboard stopped.")
            return 0
        time.sleep(0.1)
    raise RuntimeError(f"Dashboard process {pid} did not exit within {timeout:g}s; no SIGKILL was sent.")


def desktop_workbench_command(args: argparse.Namespace) -> int:
    command = getattr(args, "workbench_command", None)
    try:
        if command == "build":
            print(json.dumps(_copy_payload(), indent=2))
            return 0
        if command == "sync":
            destination = _sync(install=bool(args.install))
            print(f"Synced {PLUGIN_NAME} to {destination}")
            return 0
        if command == "status":
            return _status()
        if command == "stop":
            return _stop(args.timeout)
        if command == "open":
            target = _dashboard_url(args.url, start=args.start, host=args.host, port=args.port)
            print(target)
            opener = shutil.which("open") if sys.platform == "darwin" else shutil.which("xdg-open")
            if opener:
                subprocess.Popen([opener, target], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return 0
        print("Usage: hermes desktop-workbench {open,status,stop,build,sync}", file=sys.stderr)
        return 2
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"desktop-workbench: {exc}", file=sys.stderr)
        return 1
