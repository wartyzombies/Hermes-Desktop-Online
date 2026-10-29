/*
 * Dashboard plugin bundle for Hermes Desktop Workbench.
 *
 * Official SDK contracts:
 * - https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard
 *   (window.__HERMES_PLUGIN_SDK__, React, hooks, register)
 * - https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk
 *   (a separate SDK; this file deliberately does not use it)
 *
 * The iframe is same-origin and serves the desktop renderer copied into this
 * plugin's own `frame/` directory. This is the documented Dashboard asset route
 * `/dashboard-plugins/<name>/<path>`, not a new server or Electron webview.
 */
(function () {
  'use strict';

  var PLUGIN = 'desktop-workbench';
  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !SDK.React || !SDK.hooks || !window.__HERMES_PLUGINS__) {
    console.error('[desktop-workbench] Hermes Dashboard plugin SDK is unavailable.');
    return;
  }

  var useEffect = SDK.hooks.useEffect;
  var useRef = SDK.hooks.useRef;
  var useState = SDK.hooks.useState;

  function getBasePath() {
    var raw = window.__HERMES_BASE_PATH__ || '';
    return raw ? (raw.startsWith('/') ? raw : '/' + raw).replace(/\/+$/, '') : '';
  }

  function copyContextParams(url) {
    var query = new URLSearchParams(window.location.search);
    var profile = query.get('profile');
    var connectionId = query.get('connectionId');
    if (profile) url.searchParams.set('profile', profile);
    if (connectionId) url.searchParams.set('connectionId', connectionId);
    return url.toString();
  }

  function getFrameUrl() {
    return copyContextParams(new URL(
      getBasePath() + '/dashboard-plugins/' + PLUGIN + '/frame/index.html',
      window.location.origin
    ));
  }

  function getDashboardUrl() {
    return copyContextParams(new URL(getBasePath() + '/chat', window.location.origin));
  }

  function WorkbenchPage() {
    var frameUrlPair = useState(getFrameUrl());
    var frameUrl = frameUrlPair[0];
    var setFrameUrl = frameUrlPair[1];
    var frameRef = useRef(null);

    useEffect(function () {
      var shell = document.createElement('dialog');
      shell.className = 'desktop-workbench-shell';
      shell.dataset.workbenchState = 'loading';
      shell.style.cssText = 'position:fixed;inset:0;margin:0;width:100vw;height:100vh;max-width:none;max-height:none;padding:0;border:0;overflow:hidden;background:#111;color:#eee;';
      shell.addEventListener('cancel', function (event) { event.preventDefault(); });

      var loading = document.createElement('div');
      loading.className = 'desktop-workbench-loading';
      loading.setAttribute('role', 'status');
      loading.textContent = 'Loading Hermes Desktop…';

      var iframe = document.createElement('iframe');
      iframe.className = 'desktop-workbench-frame';
      iframe.title = 'Hermes Desktop Workbench';
      iframe.referrerPolicy = 'same-origin';
      iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-downloads allow-popups allow-modals');
      iframe.setAttribute('allow', 'clipboard-read; clipboard-write; microphone; camera; display-capture');

      var backLink = document.createElement('a');
      backLink.className = 'desktop-workbench-back';
      backLink.href = getDashboardUrl();
      backLink.setAttribute('aria-label', 'Return to Hermes Dashboard');
      backLink.textContent = '← Dashboard';

      var error = document.createElement('div');
      error.className = 'desktop-workbench-error';
      error.setAttribute('role', 'alert');
      error.textContent = 'The Desktop renderer could not load. Run `hermes desktop-workbench build` and reload the Dashboard.';
      error.hidden = true;

      shell.append(iframe, loading, error, backLink);
      document.body.appendChild(shell);
      shell.showModal();
      frameRef.current = iframe;

      function setState(state) {
        shell.dataset.workbenchState = state;
        if (state === 'loaded' || state === 'ready') loading.hidden = true;
        if (state === 'error') error.hidden = false;
      }

      function handleMessage(event) {
        if (event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
        if (event.data.source !== 'desktop-workbench-frame' || event.source !== iframe.contentWindow) return;
        if (event.data.type === 'ready') setState('ready');
      }

      function handleLoad() { setState('loaded'); }
      function handleError() { setState('error'); }
      window.addEventListener('message', handleMessage);
      iframe.addEventListener('load', handleLoad);
      iframe.addEventListener('error', handleError);
      iframe.src = frameUrl;

      return function () {
        window.removeEventListener('message', handleMessage);
        iframe.removeEventListener('load', handleLoad);
        iframe.removeEventListener('error', handleError);
        frameRef.current = null;
        shell.close();
        shell.remove();
      };
    }, []);

    useEffect(function () {
      var updated = getFrameUrl();
      if (updated !== frameUrl) setFrameUrl(updated);
    }, [window.location.search]);

    useEffect(function () {
      if (frameRef.current && frameRef.current.src !== frameUrl) frameRef.current.src = frameUrl;
    }, [frameUrl]);

    return null;
  }

  window.__HERMES_PLUGINS__.register(PLUGIN, WorkbenchPage);
})();
