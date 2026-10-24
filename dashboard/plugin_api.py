"""Authenticated API for the desktop-workbench Dashboard extension.

The bundled renderer is static and never fetched through this API. The route
exists to expose safe plugin metadata via the documented plugin API pattern.
"""

from __future__ import annotations

from pathlib import Path


def get_routes():
    """Return plugin API route definitions for the Hermes Dashboard host."""
    from fastapi import APIRouter

    router = APIRouter()
    plugin_root = Path(__file__).resolve().parent

    @router.get("/status")
    async def status():
        frame = plugin_root / "frame" / "index.html"
        return {
            "ok": True,
            "plugin": "desktop-workbench",
            "payload_built": frame.is_file(),
            "renderer": "Hermes Desktop dist",
        }

    return router
