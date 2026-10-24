from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_payload_builder():
    spec = importlib.util.spec_from_file_location("desktop_workbench_build_payload", ROOT / "scripts" / "build-payload.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_cli_parser_exposes_expected_commands():
    sys.path.insert(0, str(ROOT))
    from cli import register_cli
    import argparse

    parser = argparse.ArgumentParser()
    register_cli(parser)
    for command in ("open", "status", "stop", "build", "sync"):
        assert parser.parse_args([command]).workbench_command == command


def test_bundled_renderer_is_ready_for_plugin_only_install():
    frame = ROOT / "dashboard" / "frame"
    index = (frame / "index.html").read_text(encoding="utf-8")

    assert '<script src="./hermes-web-shim.js"></script>' in index
    assert (frame / "assets" / "index-upTXbJCg.js").is_file()
    assert not (frame / "node_modules").exists()
    assert not (frame / "native").exists()
    assert not any(frame.rglob("*.map"))
    assert not (frame / "electron-main.mjs").exists()
    assert not (frame / "electron-preload.js").exists()
    assert not (frame / "renderer-manifest.json").exists()


def test_build_payload_filters_native_files_and_injects_shim(tmp_path):
    builder = _load_payload_builder()
    source = tmp_path / "dist"
    (source / "assets").mkdir(parents=True)
    (source / "assets" / "app.js").write_text("console.log('ok')", encoding="utf-8")
    (source / "assets" / "style.css").write_text("body{}", encoding="utf-8")
    (source / "native").mkdir()
    (source / "native" / "addon.js").write_text("native-only", encoding="utf-8")
    (source / "native" / "addon.node").write_bytes(b"native")
    (source / "assets" / "source.js.map").write_text("{}", encoding="utf-8")
    (source / "node_modules" / "unused.js").parent.mkdir(parents=True)
    (source / "node_modules" / "unused.js").write_text("not for runtime", encoding="utf-8")
    (source / "electron-main.mjs").write_text("// Electron main process", encoding="utf-8")
    (source / "hermes-build.json").write_text("{}", encoding="utf-8")
    (source / "index.html").write_text("<!doctype html><html><head></head><body></body></html>", encoding="utf-8")
    destination = tmp_path / "plugin" / "frame"

    result = builder.build(source, destination)

    assert (destination / "assets" / "app.js").is_file()
    assert not (destination / "native").exists()
    assert not (destination / "native" / "addon.node").exists()
    assert not (destination / "assets" / "source.js.map").exists()
    assert not (destination / "node_modules").exists()
    assert not (destination / "electron-main.mjs").exists()
    assert not (destination / "hermes-build.json").exists()
    assert '<script src="./hermes-web-shim.js"></script>' in (destination / "index.html").read_text(encoding="utf-8")
    assert (destination / "hermes-web-shim.js").is_file()
    assert result["rejected"] == []


def test_build_payload_refuses_destination_inside_source(tmp_path):
    builder = _load_payload_builder()
    source = tmp_path / "source"
    source.mkdir()
    (source / "index.html").write_text("<head></head>", encoding="utf-8")
    try:
        builder.build(source, source / "generated")
    except ValueError:
        pass
    else:
        raise AssertionError("destination inside source must be refused")


def test_build_payload_refuses_missing_index(tmp_path):
    builder = _load_payload_builder()
    source = tmp_path / "empty"
    source.mkdir()
    try:
        builder.build(source, tmp_path / "output")
    except FileNotFoundError:
        pass
    else:
        raise AssertionError("missing index.html must be rejected")


def test_cli_build_delegates_to_shared_payload_builder(tmp_path, monkeypatch):
    from types import SimpleNamespace

    import cli

    source = tmp_path / "hermes-agent"
    source.mkdir()
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(returncode=0, stdout='{"copied": ["index.html"]}', stderr="")

    monkeypatch.setattr(cli, "_source_checkout", lambda: source)
    monkeypatch.setattr(cli.subprocess, "run", run)
    result = cli._copy_payload()

    assert result == {"copied": ["index.html"]}
    assert calls[0][0] == [
        sys.executable,
        str(ROOT / "scripts" / "build-payload.py"),
        "--source",
        str(source / "apps" / "desktop" / "dist"),
        "--destination",
        str(ROOT / "dashboard" / "frame"),
    ]
    assert calls[0][1]["check"] is False
    assert calls[0][1]["capture_output"] is True
    assert calls[0][1]["text"] is True


def test_cli_build_propagates_builder_failure(tmp_path, monkeypatch):
    from types import SimpleNamespace

    import cli

    source = tmp_path / "hermes-agent"
    source.mkdir()
    monkeypatch.setattr(cli, "_source_checkout", lambda: source)
    monkeypatch.setattr(
        cli.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=2, stdout="", stderr="missing index.html"),
    )

    try:
        cli._copy_payload()
    except RuntimeError as exc:
        assert "missing index.html" in str(exc)
    else:
        raise AssertionError("builder errors must be surfaced")


def test_shim_uses_dashboard_sdk_and_rejects_non_api_paths():
    script = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(process.argv[1], 'utf8');
const calls = [];
const basePath = '/hermes';
const parent = {
  location: { origin: 'http://127.0.0.1:9119', href: 'http://127.0.0.1:9119/hermes/workbench' },
  __HERMES_BASE_PATH__: basePath,
  __HERMES_AUTH_REQUIRED__: true,
  __HERMES_PLUGIN_SDK__: {
    // Mirror web/src/lib/api.ts: both public helpers apply the injected base path.
    fetchJSON: async (path, init) => { calls.push({ path: basePath + path, init }); return { profiles: [{ name: 'default' }], current: 'default' }; },
    buildWsUrl: async (path, params) => 'ws://127.0.0.1:9119' + basePath + path + '?ticket=one-use'
  },
  postMessage: () => {}, dispatchEvent: () => {}, open: () => {}
};
const location = { search: '?profile=research', href: 'http://127.0.0.1:9119/hermes/dashboard-plugins/desktop-workbench/frame/index.html?profile=research' };
const window = { parent, location, history: { replaceState() {} }, localStorage: { getItem(){return null}, setItem(){}, removeItem(){} }, navigator: {}, URL, URLSearchParams, Map, Set, Promise, CustomEvent: function(){}, Object };
vm.runInNewContext(code, { window, URL, URLSearchParams, Map, Set, Promise, CustomEvent: function(){}, Object });
(async () => {
  const bridge = window.hermesDesktop;
  const stopControl = bridge.petOverlay.onControl(() => {});
  const stopState = bridge.petOverlay.onState(() => {});
  stopControl();
  stopState();
  const bootstrap = await bridge.getBootstrapState();
  if (bootstrap.stage !== 'ready' || bootstrap.active) throw Error('browser bootstrap state must be a settled safe snapshot');
  if (typeof bridge.onBootstrapEvent !== 'function') throw Error('bootstrap event subscription must be callable');
  const bootstrapUnsub = bridge.onBootstrapEvent(() => {});
  if (typeof bootstrapUnsub !== 'function') throw Error('bootstrap subscription must return cleanup');
  bootstrapUnsub();
  const conn = await bridge.getConnection('research');
  if (conn.authMode !== 'oauth') throw Error('gated auth mode not detected');
  if (conn.wsUrl !== 'ws://127.0.0.1:9119/hermes/api/ws?ticket=one-use') throw Error('SDK URL must include Dashboard base path');
  await bridge.getProfileRoutes(['fallback']);
  if (calls[0].path !== '/hermes/api/profiles') throw Error('profile management request must stay global: ' + calls[0].path);
  await bridge.api({ path: '/api/status', profile: 'research team' });
  if (calls[1].path !== '/hermes/api/status?profile=research%20team') throw Error('profile scope or base path missing: ' + calls[1].path);
  if (typeof bridge.petOverlay.onControl !== 'function' || typeof bridge.petOverlay.onState !== 'function') throw Error('renderer pet overlay listener contracts must be callable');
  let rejected = false;
  try { await bridge.api({ path: 'https://evil.example/api/status' }); } catch (_) { rejected = true; }
  if (!rejected) throw Error('absolute external API URL must be rejected');
  rejected = false;
  try { await bridge.api({ path: '/api/status', connectionId: 'remote' }); } catch (_) { rejected = true; }
  if (!rejected) throw Error('registry source must not silently route to dashboard backend');
  if (conn.token !== '') throw Error('bridge must not duplicate credentials into descriptor');
})().catch(e => { console.error(e); process.exitCode = 1; });
"""
    run = subprocess.run(["node", "-e", script, str(ROOT / "desktop-web" / "hermes-web-shim.js")], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr


def test_dashboard_manifest_and_shim_payload_contract():
    manifest = json.loads((ROOT / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["tab"]["path"] == "/workbench"
    assert manifest["entry"] == "dist/index.js"
    assert "buildWsUrl" in (ROOT / "desktop-web" / "hermes-web-shim.js").read_text(encoding="utf-8")
