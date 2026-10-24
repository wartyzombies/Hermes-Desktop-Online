"""Unified Hermes Desktop Workbench plugin.

The package exposes an operator CLI and a Dashboard UI extension. Hermes Agent
plugins and Desktop plugins are distinct SDKs; this package uses the documented
Agent plugin CLI registration and the Dashboard plugin manifest/API.

Official contracts:
- https://hermes-agent.nousresearch.com/docs/developer-guide/plugins
- https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard
- https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk
"""

import importlib.util
from pathlib import Path

_cli_path = Path(__file__).resolve().parent / "cli" / "__init__.py"
_cli_spec = importlib.util.spec_from_file_location("desktop_workbench_cli", _cli_path)
if _cli_spec is None or _cli_spec.loader is None:
    raise ImportError(f"Could not load desktop-workbench CLI module: {_cli_path}")
_cli_module = importlib.util.module_from_spec(_cli_spec)
_cli_spec.loader.exec_module(_cli_module)
desktop_workbench_command = _cli_module.desktop_workbench_command
register_cli = _cli_module.register_cli


def register(ctx) -> None:
    """Register the `hermes desktop-workbench` command with Hermes Agent."""
    ctx.register_cli_command(
        name="desktop-workbench",
        help="Build and open the Hermes Desktop interface in the Web Dashboard",
        setup_fn=register_cli,
        handler_fn=desktop_workbench_command,
        description=(
            "Serve the installed Hermes Desktop renderer through the existing "
            "Web Dashboard. See README.md for setup, security and compatibility."
        ),
    )
