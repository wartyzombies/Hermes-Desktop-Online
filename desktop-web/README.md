# Desktop renderer bridge shim

`hermes-web-shim.js` is loaded before the Desktop renderer module entry and supplies `window.hermesDesktop` inside the same-origin Dashboard iframe. It is a browser adapter for a **version-pinned, internal Electron preload contract**, not a supported replacement preload.

## Contracts and data flow

- Hermes Desktop 0.22.2 bridge: [`apps/desktop/electron/preload.ts`](https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/electron/preload.ts) and [`apps/desktop/src/global.d.ts`](https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/global.d.ts) (read-only local interface truth).
- Hermes Dashboard public plugin API: [`extending-the-dashboard`](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard) and Dashboard public SDK types at `web/src/plugins/sdk.d.ts` in the matching source tree.
- The Dashboard and Desktop plugin SDKs are separate systems; see the [Desktop plugin SDK docs](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk).

`api()` forwards JSON requests through the public Dashboard `fetchJSON()` SDK, preserving auth handling in the parent Dashboard. The renderer's request profile is appended as `?profile=...` for regular `/api/...` routes; authentication, plugin and profile administration requests remain global. The Dashboard SDK's `fetchJSON` accepts dashboard-relative paths and applies the configured `__HERMES_BASE_PATH__` internally; pass `/api/...` unchanged (manually prefixing it would double the mount path behind a reverse proxy). Gateway connections use the public `buildWsUrl('/api/ws', params)` helper, which applies the same base path and mints a new ticket for gated auth or attaches the loopback token as appropriate. The shim exposes inert `petOverlay.onControl` and `onState` subscriptions because the Desktop renderer registers both during initialization. It also returns a settled bootstrap snapshot and inert `onBootstrapEvent` listener because boot/install overlays call that API during mount even when not displayed. Those browser-safe placeholders prevent crashes; native overlay and install/bootstrap behavior remain unsupported. The shim never reads `__HERMES_SESSION_TOKEN__`, session cookies, or ticket parameters. No new listener or login system is introduced.

The gateway descriptor represents only the one backend served by that Dashboard. Desktop APIs that require an independent local pool, remote/registry connection, per-connection cookie jar, local child process, or shell action cannot be implemented through this narrow adapter. For safety, requests with a `connectionId` are rejected; `getConnectionFor` is not an alias to another source.

## Security boundary

- Only same-origin Dashboard pages may provide the SDK. The parent is captured once; the renderer must not run under a remote iframe.
- REST path is restricted to absolute same-origin `/api/...` paths. Uploads are rejected rather than silently serialized incorrectly.
- Socket credentials come only from `buildWsUrl`, never from a hand-built URL or copied ticket.
- Browser `localStorage` methods namespace keys with `hermes:`; no token or password is placed there.
- Local filesystem, process execution, terminal, OS keychain, native window control, local plugin source and arbitrary Electron IPC are not simulated.
- `openExternal` accepts only HTTP(S) and uses `noopener,noreferrer`. `notify` emits a non-sensitive same-origin event.
- The Desktop renderer itself is first-party Hermes code and can make arbitrary requests within its own same-origin page authority; installing this plugin is a trust decision equivalent to enabling other Dashboard extensions.

## Capability inventory

The current inventory is maintained in [`shim-capabilities.json`](shim-capabilities.json). Browser-safe REST, profile metadata, WebSocket creation, clipboard write (permission permitting), file name lookup, basic route and in-frame storage are implemented. Native methods return clear unavailability, harmless no-ops or empty read-only placeholders. A placeholder is not proof of semantic parity.

The actual authenticated Dashboard browser has rendered `/workbench`, listed and opened a synthetic two-message session, and displayed both transcript and timeline entries. The Dashboard API also returned expected 200s for list/detail/messages/timeline and 404 for a missing session. These checks used only an isolated harness `HERMES_HOME`; they do not prove cross-surface TUI parity or prompt streaming. The harness has no configured provider/model and the gateway reports offline/setup-needed, so a real streamed reply remains blocked. The Dashboard SDK only defines auth transport; it does not promise every Desktop REST endpoint and Gateway JSON-RPC method exists or matches. Do not claim end-to-end parity beyond those checks.

## Build and development

The plugin ships the prebuilt renderer in `dashboard/frame/`; users need no Desktop source or build. Maintainers can refresh it with `python3 scripts/build-payload.py --source /path/to/hermes-agent/apps/desktop/dist` (or `hermes desktop-workbench build` with `HERMES_SOURCE` set). The builder copies browser-allowlisted files, excludes Electron-only code, the `native/` directory, node_modules and source maps, and injects the shim before the renderer module. It never modifies the Hermes checkout.

After an upstream Desktop update, compare the complete `contextBridge.exposeInMainWorld('hermesDesktop', { ... })` members and public TypeScript interface, then test all required method shapes—not only property names. Update the compatibility version and ledger with every change. Compare API request behavior to `apps/desktop/src/api/client.ts`, `web/src/lib/api.ts`, WebSocket URL shapes to `apps/shared/src/websocket-url.ts`, and actual server routes under `hermes_cli/web_routers/`.

## Known limitations

- Static plugin assets are unauthenticated by design and served under the Dashboard's allowlisted suffix route, with no new web server. Extensionless executables and the `native/` directory are intentionally excluded.
- Source bundle references to blocked `.wasm`, video, or other unsupported asset suffixes will fail. The builder reports rejected files; the exact built UI must be checked in a browser/network panel.
- Same-origin frames preserve Dashboard auth integration but share the host page's authority. No secrets are ever added to URLs by this shim.
- Browser microphone/camera APIs require browser permission/secure context. Electron-specific permission prompts are not carried over.
- Native helpers, OS window lifecycle, terminal, profiles across connections, file uploads, hardware features and updater are unavailable.
- `Cache-Control: no-store` on plugin assets can require roughly a thousand bundled renderer chunks to be fetched again on subsequent loads.
