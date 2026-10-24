/*
 * Hermes Desktop browser bridge adapter.
 *
 * This is an explicit browser stand-in for the Electron preload global. It
 * reuses the same-origin Hermes Dashboard plugin SDK and never reads/stores
 * Dashboard tokens, opens native paths, or invents Electron operations.
 *
 * Official contracts:
 * - Desktop bridge (verified locally against Hermes 0.22.2):
 *   https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/electron/preload.ts
 * - Desktop renderer types:
 *   https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/global.d.ts
 * - Dashboard plugin SDK / auth helpers:
 *   https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard
 * - Desktop plugin SDK is a separate system:
 *   https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk
 */
(function installHermesDesktopWebShim(global) {
  'use strict';

  var SDK = global.parent && global.parent.__HERMES_PLUGIN_SDK__;
  var listeners = new Map();
  var route = readInitialRoute();
  var connectionCache = new Map();
  var apiOrigin = global.parent.location.origin;
  var dashboardBasePath = (global.parent.__HERMES_BASE_PATH__ || '').replace(/\/+$/, '');

  function basePath() { return dashboardBasePath; }

  function readInitialRoute() {
    var query = new URLSearchParams(global.location.search);
    return {
      connectionId: query.get('connectionId') || null,
      profile: query.get('profile') || (global.parent && global.parent.__HERMES_DASHBOARD_PROFILE__) || 'default'
    };
  }

  function sdk() {
    if (!SDK || typeof SDK.fetchJSON !== 'function' || typeof SDK.buildWsUrl !== 'function') {
      throw new Error('Hermes Dashboard plugin SDK unavailable; refresh or update the Dashboard.');
    }
    return SDK;
  }

  function parentAuthMode() {
    return global.parent && global.parent.__HERMES_AUTH_REQUIRED__ ? 'oauth' : 'token';
  }

  function normalizeProfile(profile) {
    return typeof profile === 'string' && profile.trim() ? profile.trim() : route.profile;
  }

  function isDashboardPrimary(connectionId) {
    return !connectionId || connectionId === 'dashboard' || connectionId === 'local';
  }

  function connectionRouteId(connectionId) {
    return connectionId === 'dashboard' || connectionId === 'local' ? null : connectionId;
  }

  function setQuery(name, value) {
    var url = new URL(global.location.href);
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
    global.history.replaceState(null, '', url.toString());
  }

  function withProfile(path, profile) {
    var p = normalizeProfile(profile);
    if (!p || /(?:\?|&)profile=/.test(path)) return path;
    // Desktop REST requests carry profile scope separately. Apply it to
    // profile-backed APIs only; login, plugin and profile-management APIs are
    // global to the authenticated Dashboard.
    if (!path.startsWith('/api/') || /^\/api\/(profiles|auth|plugins)(\/|\?|$)/.test(path)) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'profile=' + encodeURIComponent(p);
  }

  function request(path, method, body, profile, connectionId) {
    if (typeof path !== 'string' || path.charAt(0) !== '/' || !path.startsWith('/api/') || path.startsWith('//')) {
      return Promise.reject(new Error('Desktop bridge only allows absolute Dashboard /api paths.'));
    }
    if (!isDashboardPrimary(connectionId)) {
      return Promise.reject(new Error('Registry-scoped connections are not supported inside the browser Workbench.'));
    }
    var init = { method: method || 'GET' };
    if (body !== undefined && body !== null) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    var target = withProfile(path, profile);
    if (connectionId === 'local') target += (target.indexOf('?') >= 0 ? '&' : '?') + 'connectionId=local';
    return sdk().fetchJSON(target, init);
  }

  function makeConnection(profile, connectionId) {
    var p = normalizeProfile(profile);
    var id = connectionId || 'dashboard';
    var key = id + '::' + p;
    if (connectionCache.has(key)) return Promise.resolve(connectionCache.get(key));
    // Dashboard buildWsUrl is the only supported way to authenticate this
    // socket: it mints a single-use OAuth ticket on gated deployments, or uses
    // the Dashboard session token in loopback mode. The shim never sees it.
    return sdk().buildWsUrl('/api/ws', p ? { profile: p } : {}).then(function (wsUrl) {
      var descriptor = {
        authMode: parentAuthMode(),
        baseUrl: apiOrigin,
        connectionId: id,
        isFullscreen: false,
        mode: 'remote',
        nativeOverlayWidth: 0,
        profile: p,
        registryScoped: false,
        remoteKind: 'url',
        sharedPrimary: true,
        sharedRemote: false,
        targetProfile: p,
        token: '',
        windowButtonPosition: null,
        wsUrl: wsUrl,
        logs: []
      };
      connectionCache.set(key, descriptor);
      return descriptor;
    });
  }

  function getRoutes(profiles) {
    return request('/api/profiles').then(function (result) {
      var names = result && Array.isArray(result.profiles)
        ? result.profiles.map(function (item) { return item && item.name; }).filter(Boolean)
        : [];
      return (names.length ? names : (Array.isArray(profiles) ? profiles : [route.profile]))
        .filter(function (name) { return typeof name === 'string'; })
        .map(function (name) {
          return {
            connectionId: route.connectionId || 'dashboard',
            mode: 'remote',
            primary: name === route.profile ? true : undefined,
            profile: name,
            targetProfile: name
          };
        });
    });
  }

  function subscribe(name, callback) {
    if (typeof callback !== 'function') return function () {};
    var group = listeners.get(name) || new Set();
    group.add(callback);
    listeners.set(name, group);
    return function () {
      group.delete(callback);
      if (!group.size) listeners.delete(name);
    };
  }

  function notify(message) {
    // Never log payloads that might contain credentials or arbitrary message data.
    if (global.parent && typeof global.parent.dispatchEvent === 'function') {
      global.parent.dispatchEvent(new CustomEvent('hermes-workbench:notify', {
        detail: { message: String(message || 'Hermes notification') }
      }));
    }
  }

  function unavailable(name) {
    return Promise.resolve({ ok: false, available: false, error: name + ' is unavailable in a browser Dashboard.' });
  }

  function currentProfileInfo() {
    return request('/api/profiles/active').catch(function () {
      return { active: route.profile, current: route.profile };
    });
  }

  var bridge = {
    glassSupported: false,
    translucencySupported: false,
    localModelsEnabled: false,
    assumeFreshInstall: false,
    localSkin: null,
    getConnection: function (profile) { return makeConnection(profile); },
    getConnectionFor: function (payload) {
      if (payload && !isDashboardPrimary(payload.connectionId)) return Promise.reject(new Error('Registry-scoped connections are not supported inside the browser Workbench.'));
      return makeConnection(payload && payload.profile, payload && payload.connectionId);
    },
    getProfileRoutes: function (profiles) { return getRoutes(profiles); },
    getPoolLimits: function () { return Promise.resolve({ maxBackends: 1, idleMs: 0 }); },
    setPoolLimits: function () { return unavailable('setPoolLimits'); },
    getGatewayWsUrl: function (profile) {
      return sdk().buildWsUrl('/api/ws', profile ? { profile: profile } : {}).then(function (url) {
        return { ok: true, wsUrl: url };
      });
    },


    getGatewayWsUrlFor: function (payload) {
      if (payload && !isDashboardPrimary(payload.connectionId)) return Promise.resolve({ ok: false, error: 'Registry-scoped connections are not supported in the browser Workbench.' });
      return sdk().buildWsUrl('/api/ws', payload && payload.profile ? { profile: payload.profile } : {}).then(function (url) {
        return { ok: true, wsUrl: url };
      });
    },
    revalidateConnection: function () { return Promise.resolve({ ok: true, rebuilt: false }); },
    touchBackend: function () { return Promise.resolve({ ok: true }); },
    getAgentRoster: function () {
      return Promise.resolve({ agents: [], sources: [{ connectionId: 'dashboard', kind: 'local', label: 'Dashboard', reachable: true }], primaryConnectionId: 'dashboard' });
    },
    api: function (apiRequest) {
      if (!apiRequest || typeof apiRequest !== 'object') return Promise.reject(new Error('Desktop API request object is required.'));
      var path = apiRequest.path;
      var method = apiRequest.method;
      var body = apiRequest.body;
      if (apiRequest.formData) {
        return Promise.reject(new Error('Desktop FormData uploads are unavailable in this browser bridge.'));
      }
      return request(path, method, body, apiRequest.profile, apiRequest.connectionId);
    },
    setActiveConnectionRoute: function (next) {
      if (!next) return;
      if (!isDashboardPrimary(next.connectionId)) {
        return Promise.reject(new Error('Registry-scoped connections are not supported inside the browser Workbench.'));
      }
      route = { connectionId: connectionRouteId(next.connectionId), profile: normalizeProfile(next.profile) };
      connectionCache.clear();
      setQuery('profile', route.profile);
      setQuery('connectionId', null);
    },
    profile: {
      getDefault: function () {
        return currentProfileInfo().then(function (info) {
          return { connectionId: route.connectionId, profile: info.active || route.profile };
        });
      },
      setDefault: function (next) {
        if (!next || !next.profile) return Promise.reject(new Error('A profile name is required.'));
        if (!isDashboardPrimary(next.connectionId)) return Promise.reject(new Error('Registry-scoped profiles are not supported inside the browser Workbench.'));
        return request('/api/profiles/active', 'POST', { name: next.profile }).then(function (result) {
          route.profile = next.profile;
          route.connectionId = connectionRouteId(next.connectionId || route.connectionId);
          connectionCache.clear();
          return { connectionId: route.connectionId, profile: result.active || next.profile };
        });
      },
      onDefaultChanged: function (callback) { return subscribe('default-profile', callback); },
      get: function () { return currentProfileInfo().then(function (info) { return { profile: info.active || route.profile }; }); },
      remember: function (name) {
        route.profile = normalizeProfile(name);
        return Promise.resolve(route.profile);
      },
      set: function (name) {
        route.profile = normalizeProfile(name);
        connectionCache.clear();
        return Promise.resolve(route.profile);
      }
    },
    notify: function (payload) { notify(payload && payload.message); return Promise.resolve({ ok: true }); },
    openExternal: function (value) {
      try {
        var destination = new URL(String(value), global.parent.location.href);
        if (!['http:', 'https:'].includes(destination.protocol)) return Promise.resolve(false);
        global.parent.open(destination.href, '_blank', 'noopener,noreferrer');
        return Promise.resolve(true);
      } catch (_) { return Promise.resolve(false); }
    },
    writeClipboard: function (text) {
      return global.navigator.clipboard && global.navigator.clipboard.writeText
        ? global.navigator.clipboard.writeText(String(text || '')).then(function () { return { ok: true }; })
        : Promise.resolve({ ok: false, error: 'Clipboard access was not granted by the browser.' });
    },
    readClipboard: function () { return Promise.resolve(''); },
    getVersion: function () { return Promise.resolve('browser-workbench'); },
    getMachineProfile: function () {
      return Promise.resolve({ platform: 'web', arch: 'web', release: '', memoryGb: 0, cpuCount: 0 });
    },
    getRemoteDisplayReason: function () {
      return Promise.resolve({ reason: 'browser-workbench', message: 'Running in the Web Dashboard.' });
    },
    getPathForFile: function (file) { return file && file.name ? file.name : ''; },
    setTitleBarTheme: function () {},
    setNativeTheme: function () {},
    setKeepAwake: function () {},
    getLocalStorage: function (key) {
      try { return Promise.resolve(global.localStorage.getItem('hermes:' + String(key)) || null); }
      catch (_) { return Promise.resolve(null); }
    },
    setLocalStorage: function (key, value) {
      try { global.localStorage.setItem('hermes:' + String(key), String(value)); return Promise.resolve({ ok: true }); }
      catch (error) { return Promise.resolve({ ok: false, error: error.message }); }
    },
    removeLocalStorage: function (key) {
      try { global.localStorage.removeItem('hermes:' + String(key)); return Promise.resolve({ ok: true }); }
      catch (error) { return Promise.resolve({ ok: false, error: error.message }); }
    },
    chatOnboarding: { size: function () {} },
    getBootProgress: function () { return Promise.resolve({ stage: 'ready' }); },
    getBootstrapState: function () {
      return Promise.resolve({ active: false, bundled: false, error: null, log: [], stage: 'ready' });
    },
    onBootstrapEvent: function (callback) { return subscribe('bootstrap-event', callback); },
    saveConnectionConfig: function () { return unavailable('saveConnectionConfig'); },
    applyConnectionConfig: function () { return unavailable('applyConnectionConfig'); },
    testConnectionConfig: function () { return unavailable('testConnectionConfig'); },
    getSecretStorageEncryption: function () { return Promise.resolve({ enabled: false, available: false }); },
    setSecretStorageEncryption: function () { return unavailable('setSecretStorageEncryption'); },
    connections: { list: function () { return Promise.resolve({ connections: [], primaryId: route.connectionId || 'dashboard' }); }, onChanged: function (callback) { return subscribe('connections-changed', callback); } },
    cloud: { status: function () { return Promise.resolve({ authenticated: false, connected: false }); } },
    windowControls: {
      custom: false,
      minimize: function () {},
      toggleMaximize: function () {},
      close: function () { global.parent.location.assign(basePath() + '/'); }
    },
    windowRelay: {
      send: function (payload) {
        var group = listeners.get('relay');
        if (group) group.forEach(function (callback) { callback(payload); });
      },
      onMessage: function (callback) { return subscribe('relay', callback); }
    },
    onBrowserPopoutClosed: function (callback) { return subscribe('browser-popout-closed', callback); },
    readDir: function () { return Promise.resolve({ files: [], entries: [], unavailable: true }); },
    openDir: function () { return unavailable('openDir'); },
    revealPath: function () { return unavailable('revealPath'); },
    selectPaths: function () { return unavailable('selectPaths'); },
    selectSavePath: function () { return unavailable('selectSavePath'); },
    openSessionWindow: function () { return unavailable('openSessionWindow'); },
    openSessionInTerminal: function () { return unavailable('openSessionInTerminal'); },
    openWindow: function () { return unavailable('openWindow'); },
    openBrowserWindow: function () { return unavailable('openBrowserWindow'); },
    terminal: {
      start: function () { return unavailable('terminal.start'); },
      stop: function () { return unavailable('terminal.stop'); },
      write: function () { return unavailable('terminal.write'); },
      resize: function () { return unavailable('terminal.resize'); },
      onData: function (callback) { return subscribe('terminal-data', callback); },
      onExit: function (callback) { return subscribe('terminal-exit', callback); }
    },
    git: { repoStatus: function () { return unavailable('git.repoStatus'); }, status: function () { return unavailable('git.status'); } },
    petOverlay: {
      open: function () { return unavailable('petOverlay.open'); },
      close: function () { return Promise.resolve({ ok: true }); },
      onControl: function (callback) { return subscribe('pet-overlay-control', callback); },
      onState: function (callback) { return subscribe('pet-overlay-state', callback); }
    },
    hud: { open: function () { return unavailable('hud.open'); }, close: function () { return Promise.resolve({ ok: true }); }, onChanged: function (callback) { return subscribe('hud', callback); } },
    getEmbedHostOrigin: function () { return Promise.resolve(''); },
    readFileDataUrl: function () { return Promise.reject(new Error('Local file reads are unavailable in the browser.')); },
    readFileDataUrlForAttach: function () { return Promise.reject(new Error('Local file reads are unavailable in the browser.')); },
    readFileText: function () { return Promise.reject(new Error('Local file reads are unavailable in the browser.')); },
    readPluginSource: function () { return Promise.reject(new Error('Local plugin source reads are unavailable in the browser.')); },
    readWindowBelow: function () { return Promise.resolve(null); },
    requestMicrophoneAccess: function () { return global.navigator.mediaDevices && global.navigator.mediaDevices.getUserMedia ? global.navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) { stream.getTracks().forEach(function (track) { track.stop(); }); return { ok: true }; }).catch(function (error) { return { ok: false, error: error.message }; }) : Promise.resolve({ ok: false, error: 'Microphone access is unavailable.' }); },
    getRecentLogs: function () { return Promise.resolve([]); },
    onBootProgress: function (callback) { return subscribe('boot-progress', callback); },
    onKeepAwakeOffer: function (callback) { return subscribe('keep-awake-offer', callback); },
    onClosePreviewRequested: function (callback) { return subscribe('close-preview', callback); },
    onPreviewNav: function (callback) { return subscribe('preview-nav', callback); },
    onOpenFolderRequested: function (callback) { return subscribe('open-folder', callback); },
    onOpenUpdatesRequested: function (callback) { return subscribe('open-updates', callback); },
    onNotificationAction: function (callback) { return subscribe('notification-action', callback); },
    onNotificationActivate: function (callback) { return subscribe('notification-activate', callback); },
    onExternalOpenFailed: function (callback) { return subscribe('external-open-failed', callback); },
    onPreviewFileChanged: function (callback) { return subscribe('preview-file-changed', callback); },
    onPoolBackendRetiring: function (callback) { return subscribe('pool-backend-retiring', callback); },
    onPowerResume: function (callback) { return subscribe('power-resume', callback); },
    onConnectionApplied: function (callback) { return subscribe('connection-applied', callback); },
    onFocusSession: function (callback) { return subscribe('focus-session', callback); },
    onDeepLink: function (callback) { return subscribe('deep-link', callback); },
    onContextMenuSpellcheck: function (callback) { return subscribe('spellcheck', callback); },
    onF12Shortcut: function (callback) { return subscribe('f12', callback); },
    onFoundInPage: function (callback) { return subscribe('found-in-page', callback); },
    saveGatewayFile: function () { return unavailable('saveGatewayFile'); },
    watchPreviewFile: function () { return Promise.resolve({ ok: false }); },
    stopPreviewFileWatch: function () { return Promise.resolve({ ok: true }); },
    getOnBattery: function () { return Promise.resolve(false); },
    onBatteryChanged: function (callback) { return subscribe('battery', callback); },
    onBackendExit: function (callback) { return subscribe('backend-exit', callback); },
    onWindowStateChanged: function (callback) { return subscribe('window-state', callback); },
    onOpenFindBarRequested: function (callback) { return subscribe('find-open', callback); },
    findInPage: function () { return Promise.resolve({ count: 0, activeMatchOrdinal: 0 }); },
    stopFindInPage: function () { return Promise.resolve(); }
  };

  Object.defineProperty(global, 'hermesDesktop', {
    configurable: false, enumerable: true, writable: false, value: bridge
  });
  global.__HERMES_WORKBENCH_SHIM__ = {
    hermesVersion: '0.22.2',
    profile: route.profile,
    getBridgeKeys: function () { return Object.keys(bridge); }
  };

  // The plugin page listens only for same-origin messages from this exact frame.
  global.parent.postMessage({ source: 'desktop-workbench-frame', type: 'ready' }, global.location.origin);
})(window);
