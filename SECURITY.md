# Security policy

`desktop-workbench` is a trusted, single-user Hermes plugin. The Dashboard plugin's IIFE executes in the Dashboard page, and the embedded renderer is served from the same origin. This is intentional: the iframe must share the authenticated Dashboard's transport. Installing the plugin therefore grants its code the same page-level authority as other enabled dashboard plugins; do not install unreviewed copies.

The plugin does not create an HTTP listener, read or print Dashboard session credentials, or put tokens in local storage. Its browser bridge calls the Dashboard's official `fetchJSON`, `authedFetch`, and `buildWsUrl` SDK functions. In gated mode the SDK handles cookies and mints one-use WebSocket tickets; in loopback mode it attaches the Dashboard's session header. The Desktop renderer can still access the host Dashboard because it is same-origin content.

Keep Hermes Dashboard loopback-bound for local use. For remote access, follow the official Dashboard authentication and TLS requirements; do not expose an unauthenticated listener to the public Internet. The plugin's `--host` handling never binds a separate service. It starts only `hermes dashboard --host 127.0.0.1` when needed.

The shim maps Electron-only APIs to explicit browser equivalents or safe unavailable results. It must not be expanded to expose arbitrary filesystem, shell, OS-keychain, or Electron IPC access. Review every bridge addition against the target release's official `apps/desktop/electron/preload.ts` and `apps/desktop/src/global.d.ts` before release.

Report security concerns privately through the maintainer contact in the repository metadata. Do not include session cookies, WebSocket tickets, API keys, or personal paths in issue reports.
