// OAuth Auth（V3.1）：扩展端登录门禁——知乎官方授权 → 领取应用会话 JWT。
// 设计（WORKPLAN V3.1 AQ1-AQ7）：
//   - OAuth Token 永不下发扩展；扩展只保存 Worker 签发的应用 JWT
//   - storage.local 持久化应用 JWT；OAuth Token 过期后需重新授权，无 refresh token
//   - PROXY 模式只有 authMethod=zhihu_oauth 的有效 JWT 才允许调用 API
//   - DIRECT 模式（本地密钥）保留为开发模式，不经过本模块门禁
(function (global) {
  'use strict';

  var CONFIG = global.QIUZHEN_CONFIG || {};
  var STORAGE_KEY = 'qiuzhen_auth_v2';
  var OAUTH_POLL_MS = 1500;
  var OAUTH_POLL_TIMEOUT_MS = 10 * 60 * 1000;
  var _cachedToken = null;

  function isProxy() {
    return !!(CONFIG && CONFIG.PROXY_ENABLED === true && CONFIG.PROXY_BASE_URL);
  }

  function load() {
    return new Promise(function (resolve) {
      if (!(global.chrome && chrome.storage && chrome.storage.local)) return resolve(null);
      chrome.storage.local.get([STORAGE_KEY, 'qiuzhen_auth_v1'], function (o) {
        // v1 旧邀请码会话不再接受；读取仅用于一次性清理，不迁移。
        resolve((o && o[STORAGE_KEY]) || null);
      });
    });
  }

  function save(auth) {
    return new Promise(function (resolve) {
      if (!(global.chrome && chrome.storage && chrome.storage.local)) return resolve();
      var value = {}; value[STORAGE_KEY] = auth;
      chrome.storage.local.set(value, function () { resolve(); });
    });
  }

  function clearLegacy() {
    return new Promise(function (resolve) {
      if (!(global.chrome && chrome.storage && chrome.storage.local)) return resolve();
      chrome.storage.local.remove(['qiuzhen_auth_v1'], function () { resolve(); });
    });
  }

  function getJson(path) {
    var base = String(CONFIG.PROXY_BASE_URL || '').replace(/\/+$/, '');
    return fetch(base + path, { method: 'GET', cache: 'no-store' }).then(function (r) {
      return r.json().then(function (body) { return { status: r.status, body: body }; });
    });
  }

  function postJson(path, body) {
    var base = String(CONFIG.PROXY_BASE_URL || '').replace(/\/+$/, '');
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 15000);
    return fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctl.signal
    }).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (o) { return { status: r.status, body: o }; });
    }, function (e) {
      clearTimeout(timer);
      throw new Error(e && e.name === 'AbortError' ? 'auth_timeout' : 'auth_network_error');
    });
  }

  function decodeJwt(jwt) {
    try {
      var part = String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (part.length % 4) part += '=';
      return JSON.parse(atob(part));
    } catch (e) { return null; }
  }

  function saveOAuthSession(body) {
    var payload = decodeJwt(body && body.access_token);
    if (!payload || payload.auth !== 'zhihu_oauth') {
      var invalid = new Error('oauth_session_invalid'); invalid.code = 'oauth_session_invalid';
      return Promise.reject(invalid);
    }
    var displayName = String(body.display_name || payload.display_name || payload.sub || '').trim();
    var alias = displayName || '已授权知乎账号';
    var auth = {
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in || 86400) * 1000,
      alias: alias,
      displayName: displayName || null,
      zhihuUserId: body.zhihu_user_id || payload.zhihu_user_id || null,
      authMethod: 'zhihu_oauth'
    };
    _cachedToken = auth.accessToken;
    return save(auth).then(clearLegacy).then(function () {
      return { ok: true, alias: auth.alias, displayName: auth.displayName, zhihuUserId: auth.zhihuUserId, authMethod: auth.authMethod };
    });
  }

  function startOAuth() {
    if (!isProxy()) return Promise.reject(new Error('not_proxy_mode'));
    return postJson('/auth/zhihu/start', {}).then(function (r) {
      if (r.status === 200 && r.body && r.body.flow_id && r.body.authorize_url) {
        return { flowId: r.body.flow_id, authorizeUrl: r.body.authorize_url, expiresIn: r.body.expires_in || 600 };
      }
      var e = new Error((r.body && r.body.error) || 'oauth_start_failed'); e.code = (r.body && r.body.error) || 'oauth_start_failed';
      throw e;
    });
  }

  function checkOAuth(flowId) {
    if (!isProxy()) return Promise.reject(new Error('not_proxy_mode'));
    return getJson('/auth/zhihu/status?flow_id=' + encodeURIComponent(flowId)).then(function (r) {
      if (r.status === 200 && r.body && (r.body.status === 'pending' || (r.body.status === 'authorized' && r.body.access_token))) return r.body;
      var e = new Error((r.body && r.body.error) || 'oauth_status_failed'); e.code = (r.body && r.body.error) || 'oauth_status_failed';
      throw e;
    });
  }

  // 兼容旧调用方：不再让一次消息通道持有 10 分钟，改由调用方定时调用 checkOAuth。
  function pollOAuth(flowId, timeoutMs) {
    if (!isProxy()) return Promise.reject(new Error('not_proxy_mode'));
    var startedAt = Date.now();
    var limit = timeoutMs || OAUTH_POLL_TIMEOUT_MS;
    function tick() {
      return getJson('/auth/zhihu/status?flow_id=' + encodeURIComponent(flowId)).then(function (r) {
        if (r.status === 200 && r.body && r.body.status === 'authorized' && r.body.access_token) return saveOAuthSession(r.body);
        if (r.status === 200 && r.body && r.body.status === 'pending') {
          if (Date.now() - startedAt >= limit) { var t = new Error('oauth_timeout'); t.code = 'oauth_timeout'; throw t; }
          return new Promise(function (resolve) { setTimeout(function () { resolve(tick()); }, OAUTH_POLL_MS); });
        }
        var e = new Error((r.body && r.body.error) || 'oauth_status_failed'); e.code = (r.body && r.body.error) || 'oauth_status_failed';
        throw e;
      });
    }
    return tick();
  }

  function getAuthState() {
    if (!isProxy()) {
      var directOk = !!CONFIG.DEEPSEEK_API_KEY;
      return Promise.resolve({ mode: 'direct', loggedIn: directOk, needsLogin: false, alias: null });
    }
    return load().then(function (a) {
      if (!a || !a.accessToken || a.authMethod !== 'zhihu_oauth' || (a.expiresAt && a.expiresAt <= Date.now())) {
        return { mode: 'proxy', loggedIn: false, needsLogin: true, alias: null, displayName: null, authMethod: null };
      }
      _cachedToken = a.accessToken;
      return { mode: 'proxy', loggedIn: true, needsLogin: false, alias: a.alias, displayName: a.displayName || a.alias || null, zhihuUserId: a.zhihuUserId || null, expiresAt: a.expiresAt, authMethod: a.authMethod };
    });
  }

  function getValidAccessToken() {
    return load().then(function (a) {
      if (!a || !a.accessToken || a.authMethod !== 'zhihu_oauth' || (a.expiresAt && a.expiresAt <= Date.now())) {
        var e = new Error('needs_login'); e.code = 'needs_login'; throw e;
      }
      _cachedToken = a.accessToken;
      return a.accessToken;
    });
  }

  function isApiAllowed() {
    if (!isProxy()) return Promise.resolve(!!CONFIG.DEEPSEEK_API_KEY);
    return getValidAccessToken().then(function () { return true; }, function () { return false; });
  }

  function proxyAuthHeader() {
    if (!isProxy()) return '';
    return _cachedToken ? 'Bearer ' + _cachedToken : '';
  }

  function logout() {
    _cachedToken = null;
    return save(null).then(clearLegacy).then(function () { return { ok: true }; });
  }

  global.WCC_AUTH = {
    isProxy: isProxy,
    startOAuth: startOAuth,
    checkOAuth: checkOAuth,
    acceptOAuth: saveOAuthSession,
    pollOAuth: pollOAuth,
    getAuthState: getAuthState,
    getValidAccessToken: getValidAccessToken,
    isApiAllowed: isApiAllowed,
    proxyAuthHeader: proxyAuthHeader,
    logout: logout
  };

  load().then(function (a) {
    if (a && a.authMethod === 'zhihu_oauth' && a.accessToken && (!a.expiresAt || a.expiresAt > Date.now())) _cachedToken = a.accessToken;
    else if (a && a.authMethod !== 'zhihu_oauth') clearLegacy();
  }).catch(function () {});
})(typeof globalThis !== 'undefined' ? globalThis : self);
