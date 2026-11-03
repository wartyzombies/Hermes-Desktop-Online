# Hermes Desktop Workbench

**Hermes Desktop's UI inside the Hermes Web Dashboard.** The plugin serves a prebuilt Hermes Desktop renderer from its installed package, so an installed plugin needs no local Desktop install, source checkout, or build tools. That renderer is build output rather than committed source: `scripts/install-local.sh` stages it from a Desktop dist directory at install time (see [Refresh the renderer payload](#refresh-the-renderer-payload-maintainers-only)). The Dashboard's `/workbench` tab loads that renderer in a same-origin iframe and installs a constrained browser replacement for the Electron `window.hermesDesktop` bridge. REST calls and the gateway WebSocket use the authenticated Dashboard plugin SDK; the desktop UI code is not reimplemented.

> **Compatibility:** the bridge is pinned to Hermes Agent/Desktop **0.22.2**. This is an experimental, version-specific adapter over an Electron preload interface that is not a supported public API. The Desktop UI renders, but native capabilities (local filesystem, terminal, OS windows, registry sources, updater, etc.) do not become browser capabilities. See [bridge limitations](desktop-web/README.md) and [security policy](SECURITY.md).

## What you get

- A Dashboard plugin tab at `/workbench`, full-window, with no second server or new authentication mechanism.
- A prebuilt Desktop renderer staged into the installed package (`dashboard/frame/`) and mounted on the existing `/dashboard-plugins/desktop-workbench/` route.
- A shim that forwards Desktop REST requests via `__HERMES_PLUGIN_SDK__.fetchJSON()` and gateway WebSocket auth through `buildWsUrl()`; it never reads Dashboard cookies, session tokens, or ticket credentials.
- `hermes desktop-workbench open|status|stop|build|sync` for operators.
- Tests for payload filtering, shim auth/profile flow, safety constraints, and plugin manifest routing.

## Requirements

- Hermes Agent **0.22.2** (or a release whose Desktop preload and Dashboard SDK contracts have been re-audited).
- The Hermes web Dashboard extra/dependencies installed. The supported server command is `hermes dashboard`.
- Python 3.10+ for the plugin installer and operator commands; the plugin runtime uses Hermes' own Python interpreter and dependencies. No third-party JavaScript dependency is introduced here.
- [uv](https://docs.astral.sh/uv/) is optional for the test environment; no lockfile or production runtime dependency is required.
- Node.js is only needed for JavaScript syntax/test checks during development, not to install or run the bundled UI.
- For remotely accessed Dashboards, use the Dashboard's supported authentication configuration and HTTPS. This plugin itself adds no access control.

## First-time setup (cold start)

### 1. Validate and install the Agent plugin

The source repository is a portable Agent plugin package. Validate it before installing:

```bash
hermes plugins validate .
hermes plugins doctor . --ci
```

The `desktop-workbench` command is provided by this plugin, so it is **not available until after installation**. From a cloneable Git checkout, install this local package through Hermes' plugin manager (`file://` URLs are supported):

```bash
hermes plugins install "file://$(pwd)" --enable --yes-deps
```

For the simplest local install, use the included script instead; it copies the bundled renderer and enables the plugin without requiring a Git checkout:

```bash
bash scripts/install-local.sh
```

For a source directory without usable Git metadata, either run `bash scripts/install-local.sh` or copy the package directly:

```bash
mkdir -p "$HOME/.hermes/plugins/desktop-workbench"
rsync -a \
  --exclude='.git/' --exclude='.DS_Store' --exclude='.freebuff/' \
  --exclude='hermes-agent-main-dev/' --exclude='Hermes-Desktop-Online/' \
  --exclude='dashboard/frame/node_modules/' --exclude='.venv/' --exclude='__pycache__/' \
  --exclude='*.pyc' --exclude='.pytest_cache/' \
  ./ "$HOME/.hermes/plugins/desktop-workbench/"
hermes plugins enable desktop-workbench
```

`--yes-deps` is appropriate here because the plugin declares no production Python dependencies. Omit it if the manifest later gains dependencies and you want Hermes to request consent interactively.

Both `hermes plugins install` and the manual copy install only what the checkout contains, and a checkout has no renderer payload. Stage one first with `python3 scripts/build-payload.py --source <desktop dist>`, or use `scripts/install-local.sh`, which builds the payload straight into the install directory and needs neither a committed payload nor a Git checkout.

### 2. Open the Workbench

The installed plugin serves the renderer from `dashboard/frame/`; there is no build step for users of a staged install. On a checkout, `scripts/install-local.sh` builds that payload from a Desktop dist directory (`HERMES_DESKTOP_DIST`, `$HERMES_SOURCE/apps/desktop/dist`, `~/.hermes/hermes-agent/apps/desktop/dist`, `~/src/hermes-agent/apps/desktop/dist`, or a payload kept beside the repository). The `hermes desktop-workbench build` command refreshes the same payload for plugin maintainers.

Verify command discovery in a fresh Hermes CLI process if needed:

```bash
hermes desktop-workbench --help
```

### 3. Start/open the Dashboard

Start the existing Dashboard normally:

```bash
hermes dashboard --no-open
hermes desktop-workbench open
```

The `open` command prints and opens `http://127.0.0.1:9119/workbench`. If Dashboard isn't running and you specifically want Workbench to start it on loopback:

```bash
hermes desktop-workbench open --start
```

The plugin records a PID only for the Dashboard process that it itself starts; `stop` will only signal that owned process, and will not force-kill it:

```bash
hermes desktop-workbench status
hermes desktop-workbench stop
```

For another Dashboard origin, pass `--url https://dashboard.example` or set `HERMES_DASHBOARD_URL`. `open` accepts only an HTTP(S) origin with no credentials, path, query, or fragment. It does not start remote hosts.

## Development

### Code layout

- `__init__.py`, `cli/`: Hermes Agent plugin discovery and CLI command.
- `plugin.yaml`: Agent plugin manifest.
- `dashboard/manifest.json`: Dashboard tab registration and static bundle paths.
- `dashboard/src/index.js`: Dashboard SDK component registering `/workbench`.
- `dashboard/src/style.css`: full viewport frame and loading state styles.
- `dashboard/frame/`: staged Desktop renderer payload; build output, not committed source.
- `dashboard/plugin_api.py`: safe plugin status endpoint.
- `desktop-web/hermes-web-shim.js`: constrained Desktop preload browser adapter.
- `desktop-web/shim-capabilities.json`: versioned capabilities ledger.
- `scripts/build-payload.py`: allowlisted static payload staging.
- `tests/`: CLI, build and shim behavior tests.

Dashboard plugin SDK assets are loaded by Hermes from `dashboard/dist/index.js` and `dashboard/dist/style.css`; this repository does not bundle React or the Dashboard's SDK. For this repository the Dashboard source IIFE can be copied to `dist/index.js` directly and CSS similarly. Package/build directions must follow the target Hermes version's plugin asset conventions; the API and assets are discovered from the plugin package's `dashboard/` directory.

```bash
mkdir -p dashboard/dist
cp dashboard/src/index.js dashboard/dist/index.js
cp dashboard/src/style.css dashboard/dist/style.css
```

Run tests and syntax validation:

```bash
uv sync --extra test
uv run pytest -q
node --check dashboard/src/index.js
node --check desktop-web/hermes-web-shim.js
python3 -m py_compile __init__.py cli/__init__.py dashboard/plugin_api.py scripts/build-payload.py
hermes plugins validate .
hermes plugins doctor . --ci
```

### Refresh the renderer payload (maintainers only)

The renderer payload is gitignored build output: keep a clean package small enough to stay readable by `hermes plugins validate`, and ship the staged payload as a release artifact instead of committing it. To refresh it for a new supported Hermes release, use that release's documented Desktop build steps in a development checkout, then run `HERMES_SOURCE="$HOME/src/hermes-agent" hermes desktop-workbench build` or `python3 scripts/build-payload.py --source "$HOME/src/hermes-agent/apps/desktop/dist"`. Audit the preload interface and compatibility ledger before distributing the refreshed bundle.

### Iterate and sync

After editing plugin files, refresh the Dashboard bundle and sync the installed package:

```bash
cp dashboard/src/index.js dashboard/dist/index.js
cp dashboard/src/style.css dashboard/dist/style.css
hermes desktop-workbench sync
```

Use `hermes desktop-workbench sync --install` only after the plugin command has been installed; for a clean install, use the plugin manager command above. The renderer payload is synced with the plugin files once it exists; no separate build is needed for users.

After updating the Hermes Desktop source release, rebuild the renderer payload with `hermes desktop-workbench build`, then re-audit `preload.ts`/`global.d.ts` and update the compatibility ledger before release. The payload is gitignored, so it travels with a release artifact rather than a commit.

## Backend and session behavior

The intended transport is the already-running Dashboard. The shim's `getConnection` asks the documented Dashboard `buildWsUrl('/api/ws', {profile})` helper for the authenticated WebSocket URL, and its Desktop `api()` calls use Dashboard `fetchJSON` with the profile tag. Thus the UI addresses the Dashboard's configured Hermes runtime, not another process started by the plugin. Existing Dashboard authentication remains authoritative.

The shim does **not** provide full Desktop connection parity. Registry-scoped connection IDs are rejected; uploads/FormData are rejected; unsupported native operations fail closed. Session list/resume and messaging depend on the v0.22.2 renderer API calls being compatible with the Dashboard `/api/...` and gateway JSON-RPC contracts, and on the Dashboard exposing a WebSocket auth mode understood by the Electron renderer. A deployed/live Dashboard round-trip must be tested before claiming full parity; see Verification and known limits below.

## Verification and known limits

Automated local checks cover manifest shape, route path, accepted/rejected payload suffixes, shim initialization, profile-scoped JSON calls, and delegation of WebSocket auth to the Dashboard SDK. They do not prove a live Dashboard UI load, session persistence against a gateway, OAuth-gated socket compatibility, CLI/TUI parity, or streaming completion. Those need an authenticated running Hermes Dashboard and configured working agent model/provider.

A final manual integration check on the target Hermes release:

1. Verify the bundled `dashboard/frame/index.html` references the shim before its module scripts.
2. Run `hermes dashboard --no-open`; confirm it is bound only to the expected address and port.
3. Navigate to `http://127.0.0.1:9119/workbench`; confirm the Desktop renderer mounts and its assets return 200 with the expected content types.
4. Create a session and send a prompt. Confirm the response streams, then verify the session is listed/resumable from the ordinary Hermes CLI/TUI.
5. Repeat under Dashboard authentication, inspect browser network and console for failed REST/WS routes, and confirm no raw token/ticket is present in application logs.

The bundled renderer omits Electron-only artifacts and unsupported file types, including source maps, the `native/` directory, and native executable files. If the UI tries to fetch an excluded asset, it cannot load that feature through the current Dashboard plugin asset route without a deliberate upstream-compatible change; do not silently add a second listener or patch Hermes' checkout.

## Troubleshooting

- **`hermes desktop-workbench` is unknown:** confirm the package is synced under `~/.hermes/plugins/desktop-workbench`, enabled with `hermes plugins enable desktop-workbench`, and try a fresh Hermes CLI process. Hermes plugins are loaded on command discovery.
- **No `dashboard/frame/index.html`:** the install has no renderer payload. Rerun `bash scripts/install-local.sh` with a Desktop dist available (or `HERMES_DESKTOP_DIST=<dist>`); maintainers can stage the payload from a Hermes source checkout with `python3 scripts/build-payload.py --source ...`.
- **Dashboard has no Workbench tab:** verify it discovers/enables the plugin, ensure `dashboard/dist/index.js` and `style.css` exist and match manifest paths, then restart/reload Dashboard.
- **Frame never loads:** inspect the Dashboard browser network panel for `/dashboard-plugins/desktop-workbench/frame/index.html`; assets with unsupported suffixes are denied by the server's allowlist.
- **`window.hermesDesktop` missing / blank renderer:** check that the bridge was injected before the app's module script, and that the Dashboard plugin SDK is accessible from a same-origin parent frame.
- **WebSocket disconnect or auth loop:** inspect the Dashboard's `/api/ws` auth flow. OAuth tickets are single use and must be built afresh with `buildWsUrl`; do not copy a ticket or change the shim to read tokens directly.
- **Native control reports unavailable:** expected. Use Dashboard/browser APIs for the capability; this adapter does not grant shell, terminal, or filesystem access.
- **Source checkout remains read-only:** all building and install/sync actions use this plugin workspace, `dashboard/frame/`, and `~/.hermes/plugins/`; they never modify `~/.hermes/hermes-agent`.

## Upstream references

- [Hermes Agent plugins](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins)
- [Extending the Hermes Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard)
- [Hermes Desktop plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk) — separate from this Agent/Dashboard plugin
- [Hermes Desktop](https://hermes-agent.nousresearch.com/docs/user-guide/desktop)
- [Official `hermes-workbench` plugin](https://hermes-agent.nousresearch.com/docs/plugins/hermes-workbench)
- [Electron web embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)
- [Vite public base option](https://vite.dev/config/shared-options.html#base)

## License

This plugin is MIT licensed. The prebuilt renderer served from `dashboard/frame/` is generated from Hermes Desktop (build output, not committed) and distributed under Hermes' upstream MIT license; see [LICENSE-HERMES](LICENSE-HERMES).
