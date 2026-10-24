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

  var React = SDK.React;
  var useEffect = SDK.hooks.useEffect;
  var useState = SDK.hooks.useState;

  function getBasePath() {
    var raw = window.__HERMES_BASE_PATH__ || '';
    return raw ? (raw.startsWith('/') ? raw : '/' + raw).replace(/\/+$/, '') : '';
  }

  function getFrameUrl() {
    var url = new URL(getBasePath() + '/dashboard-plugins/' + PLUGIN + '/frame/index.html', window.location.origin);
    var query = new URLSearchParams(window.location.search);
    var profile = query.get('profile');
    var connectionId = query.get('connectionId');
    if (profile) url.searchParams.set('profile', profile);
    if (connectionId) url.searchParams.set('connectionId', connectionId);
    return url.toString();
  }

  function WorkbenchPage() {
    var statePair = useState('loading');
    var state = statePair[0];
    var setState = statePair[1];
    var framePair = useState(getFrameUrl());
    var frameUrl = framePair[0];
    var setFrameUrl = framePair[1];

    useEffect(function () {
      var handleMessage = function (event) {
        if (event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
        if (event.data.source !== 'desktop-workbench-frame') return;
        if (event.source !== document.querySelector('.desktop-workbench-frame')?.contentWindow) return;
        if (event.data.type === 'ready') setState('ready');
      };
      window.addEventListener('message', handleMessage);
      return function () { window.removeEventListener('message', handleMessage); };
    }, []);

    useEffect(function () {
      var updated = getFrameUrl();
      if (updated !== frameUrl) setFrameUrl(updated);
    }, [window.location.search]);

    return React.createElement('div', {
      className: 'desktop-workbench-shell',
      'data-workbench-state': state,
      style: { position: 'relative', height: '100%', width: '100%' },
      children: [
        state === 'loading' ? React.createElement('div', {
          className: 'desktop-workbench-loading',
          role: 'status',
          key: 'loading',
          children: 'Loading Hermes Desktop…'
        }) : null,
        React.createElement('iframe', {
          key: 'frame',
          className: 'desktop-workbench-frame',
          src: frameUrl,
          title: 'Hermes Desktop Workbench',
          referrerPolicy: 'same-origin',
          sandbox: 'allow-same-origin allow-scripts allow-forms allow-downloads allow-popups allow-modals',
          onLoad: function () { setState('loaded'); },
          onError: function () { setState('error'); },
          allow: 'clipboard-read; clipboard-write; microphone; camera; display-capture'
        }),
        state === 'error' ? React.createElement('div', {
          className: 'desktop-workbench-error',
          role: 'alert',
          key: 'error',
          children: 'The Desktop renderer could not load. Run `hermes desktop-workbench build` and reload the Dashboard.'
        }) : null
      ]
    });
  }

  window.__HERMES_PLUGINS__.register(PLUGIN, WorkbenchPage);
})();
