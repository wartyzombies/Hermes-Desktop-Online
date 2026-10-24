# Compatibility and acceptance status

## Target

Hermes Agent/Desktop 0.22.2 (installed build version 2026.9.24), Dashboard plugin SDK contract 1.1.0. `plugin.yaml` constrains the supported Hermes range to `>=0.22.2, <0.23` until the shim is re-audited. Source was inspected under `~/.hermes/hermes-agent` and is kept read-only.

## Verified from source / automated local checks

- Hermes Dashboard SDK 1.1.0 applies `__HERMES_BASE_PATH__` inside both `fetchJSON()` and `buildWsUrl()`. Pass dashboard-relative paths (for example `/api/ws`) unchanged; pre-prefixing duplicates a reverse-proxy mount. The fixture now models this contract.
- Desktop boot/install overlays call `getBootstrapState()` while mounting, even when their UI is inactive; the browser supplies a settled no-op snapshot and inert `onBootstrapEvent` subscription. The main pet-overlay store also registers `onControl` and `onState` during initialization, so the browser exposes inert unsubscribe-capable hooks. These prevent native-only features from crashing web boot; they do not emulate install/bootstrap state or overlay windows.
- The Dashboard server discovers `dashboard/manifest.json`, registers plugin tabs, and serves static files through `/dashboard-plugins/<name>/<path>` using its explicit suffix allowlist.
- Dashboard plugin SDK exposes React/hooks, `fetchJSON`, and `buildWsUrl`; the latter mints either a gated single-use ticket or loopback session token without plugins reading credentials.
- The Desktop bundle is prebuilt and shipped in `dashboard/frame/`; its index has relative `./assets/` references, so the payload is hosted at one local directory below the static mount. Installers can use it without a local Desktop build or source checkout.
- The Desktop renderer and Dashboard share the one Hermes backend configured by the active Dashboard process, not independent connections.
- Python unit checks verify payload allowlist filtering/injection, manifest tab path, command parser and SDK-based REST/WS calls with path safety.

## Acceptance matrix

| Criterion | Current state | Evidence / blocker |
|---|---|---|
| A1 `hermes plugins validate .` + `doctor --ci` | Not yet verified | Requires Hermes runtime plugin validation; run after package is finalized. |
| A2 load `/workbench` and assert renderer | Verified live in browser | Opened the actual `/workbench` Dashboard tab. The embedded Desktop UI rendered and displayed the synthetic resumed conversation/timeline; the prior bootstrap crash disappeared after adding the settled bootstrap API. No shim-related console errors remained. |
| A3 load Desktop renderer without a local build | Bundled in the plugin | The committed `dashboard/frame/` payload is copied with the plugin; the browser route still needs acceptance testing after a fresh install. |
| A4 session create/resume cross-surface | Session list/resume/timeline verified in browser on synthetic data | The actual `/workbench` renderer listed and opened `desktop-workbench-contract-check`, displayed its `Verify resumed timeline` user prompt and `Fixture response`, and rendered the timeline jump entry. The record was created only in isolated harness `HERMES_HOME`; no production/home data changed. Cross-surface TUI and actual generated-session resume are not claimed. |
| A5 gateway prompt streaming | Not verified | No provider/model was configured in the isolated test home, so an authenticated prompt stream could not be proven. |
| A6 only existing Dashboard listener/auth | Design conforms | No server is created; CLI's optional start delegates to `hermes dashboard`. |
| A7 cold-start README | Written | Includes requirements, install/build/use/development/security/troubleshooting. |
| A8 no edits to Hermes checkout | Verified read-only | `git -C ~/.hermes/hermes-agent status --short --branch` reported a clean detached HEAD. |

## Known integration gaps

- Desktop bridge is internal and large. A browser shim cannot honestly promise full Desktop API parity.
- The Desktop supports local pool connections, registry-scoped remotes, per-source OAuth, file transfer and native OS operations. This adapter supports only one Dashboard backend and rejects source-specific REST requests.
- The bundled renderer intentionally excludes extensionless Electron runtime files, `.node` binaries, source maps, and other non-browser assets; a feature that tries to load one cannot work through the Dashboard static mount.
- SDK auth methods preserve Dashboard auth, but that does not prove Desktop renderer REST response contracts match Dashboard endpoints or that native-gateway JSON-RPC methods are served. Authenticated live requests to `/api/dashboard/plugins`, `/api/sessions?limit=10&offset=0&order=recent&profile=default`, `/api/sessions/desktop-workbench-contract-check?profile=default`, `/api/sessions/desktop-workbench-contract-check/messages?limit=10&order=latest&profile=default`, and `/api/sessions/desktop-workbench-contract-check/timeline?limit=10&profile=default` all returned 200; an unknown session returned 404 for timeline and messages. The synthetic session lived only in the isolated harness `HERMES_HOME`.
- The actual browser-driven `/workbench` session list/resume and timeline passed against a synthetic transcript in isolated `HERMES_HOME`. The Dashboard reported the backend as needing setup/offline, and no provider/model was configured; sending a prompt therefore could not test real gateway streaming. Cross-surface TUI behavior and model-backed message streaming remain unverified.
