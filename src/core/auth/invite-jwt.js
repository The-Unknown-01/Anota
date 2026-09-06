// Invite-JWT Auth（V2.8 O3）：扩展端登录门禁——邀请码兑换 / token 存取 / 过期静默刷新。
// 设计（WORKPLAN V2.8 OQ2-OQ4）：
//   - storage.local 持久化（重启免重登）
//   - access 24h + refresh 30d；401/过期 → 静默 refresh → 失败才置 loggedOut
//   - DIRECT 模式（本地密钥）完全不经过本模块
(function (global) {
  'use strict';

  var CONFIG = global.QIUZHEN_CONFIG;
  var STORAGE_KEY = 'qiuzhen_auth_v1';

  function isProxy() {
    return !!(CONFIG && CONFIG.PROXY_ENABLED === true && CONFIG.PROXY_BASE_URL);
  }

  // ---------- storage ----------
  function load() {
    return new Promise(function (resolve) {
      if (!(global.chrome && chrome.storage && chrome.storage.local)) return resolve(null);
      chrome.storage.local.get([STORAGE_KEY], function (o) {
        resolve((o && o[STORAGE_KEY]) || null);
      });
    });
  }
  function save(auth) {
    return new Promise(function (resolve) {
      if (!(global.chrome && chrome.storage && chrome.storage.local)) return resolve();
      var v = {}; v[STORAGE_KEY] = auth;
      chrome.storage.local.set(v, function () { resolve(); });
    });
  }

  // ---------- HTTP ----------
  function postJson(path, body) {
    var base = CONFIG.PROXY_BASE_URL.replace(/\/+$/, '');
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 15000);
    return fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal
    }).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (o) { return { status: r.status, body: o }; });
    }, function (e) {
      clearTimeout(timer);
      throw new Error(e && e.name === 'AbortError' ? 'auth_timeout' : 'auth_network_error');
    });
  }

  // ---------- 对外接口 ----------

  // redeem(inviteCode) → { ok, alias } 或 throw
  function redeem(inviteCode) {
    if (!isProxy()) return Promise.reject(new Error('not_proxy_mode'));
    return postJson('/auth/redeem', { inviteCode: inviteCode }).then(function (r) {
      if (r.status === 200 && r.body && r.body.access_token) {
        return save({
          accessToken: r.body.access_token,
          refreshToken: r.body.refresh_token || null,
          expiresAt: Date.now() + (r.body.expires_in || 86400) * 1000,
          alias: deriveAlias(r.body.access_token)
        }).then(function () { return { ok: true, alias: deriveAlias(r.body.access_token) }; });
      }
      var err = new Error((r.body && r.body.error) || 'redeem_failed');
      err.code = (r.body && r.body.error) || 'redeem_failed';
      throw err;
    });
  }

  function deriveAlias(jwt) {
    try {
      var payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return String(payload.sub || 'user');
    } catch (e) { return 'user'; }
  }

  // getAuthState() → { mode: 'proxy'|'direct', loggedIn, alias, needsLogin, expiresAt }
  function getAuthState() {
    if (!isProxy()) {
      var directOk = !!(CONFIG && CONFIG.DEEPSEEK_API_KEY);
      return Promise.resolve({ mode: 'direct', loggedIn: directOk, needsLogin: false, alias: null });
    }
    return load().then(function (a) {
      if (!a || !a.accessToken) return { mode: 'proxy', loggedIn: false, needsLogin: true, alias: null };
      return { mode: 'proxy', loggedIn: true, needsLogin: false, alias: a.alias, expiresAt: a.expiresAt };
    });
  }

  // getValidAccessToken() → Promise<token>；过期/即将过期 → 静默 refresh；失败 → throw needs_login
  function getValidAccessToken() {
    return load().then(function (a) {
      if (!a || !a.accessToken) { var e1 = new Error('needs_login'); e1.code = 'needs_login'; throw e1; }
      // 未过期（预留 60s 余量）→ 直接用
      if (a.expiresAt && a.expiresAt - Date.now() > 60000) return a.accessToken;
      // 静默刷新
      if (!a.refreshToken) { var e2 = new Error('needs_login'); e2.code = 'needs_login'; throw e2; }
      return postJson('/auth/refresh', { refreshToken: a.refreshToken }).then(function (r) {
        if (r.status === 200 && r.body && r.body.access_token) {
          var next = {
            accessToken: r.body.access_token,
            refreshToken: r.body.refresh_token || a.refreshToken,
            expiresAt: Date.now() + (r.body.expires_in || 86400) * 1000,
            alias: a.alias
          };
          return save(next).then(function () { return next.accessToken; });
        }
        var e3 = new Error('needs_login'); e3.code = 'needs_login'; throw e3;
      }, function () {
        var e4 = new Error('needs_login'); e4.code = 'needs_login'; throw e4;
      });
    });
  }

  // logout()
  function logout() {
    return save(null).then(function () { return { ok: true }; });
  }

  // isApiAllowed() → Promise<boolean>：门禁守卫（V2.8 交互修复）
  //   DIRECT 模式：有本地 DeepSeek key 即可（不受门禁影响）
  //   PROXY 模式：有有效 JWT（未过期或可静默刷新）才允许调用 API
  function isApiAllowed() {
    if (!isProxy()) {
      return Promise.resolve(!!(CONFIG && CONFIG.DEEPSEEK_API_KEY));
    }
    return getValidAccessToken().then(function () { return true; }, function () { return false; });
  }

  // proxyAuthHeader() → 'Bearer <JWT>' 或 ''（未登录）
  // 供各 LLM/检索模块的 llmRequestParts/datasource 使用：PROXY 模式认证只用 JWT，
  // 不再回落静态 PROXY_ACCESS_TOKEN（V2.8 交互修复：未登录必须被拒绝，而不是静默用静态令牌）。
  // 各模块在通过 guardApi 后才调用本函数，此时 _cachedAccessToken 已被 getValidAccessToken 刷新。
  function proxyAuthHeader() {
    if (!isProxy()) return '';
    var t = _cachedToken || '';
    return t ? 'Bearer ' + t : '';
  }

  global.WCC_AUTH = {
    isProxy: isProxy,
    redeem: redeem,
    getAuthState: getAuthState,
    getValidAccessToken: getValidAccessToken,
    isApiAllowed: isApiAllowed,
    proxyAuthHeader: proxyAuthHeader,
    logout: logout,
    // 同步给各 LLM 模块的 llmRequestParts 使用（登录后失效；静态 PROXY_ACCESS_TOKEN 兜底）
    get _cachedAccessToken() {
      try {
        // SW 内同步缓存：redeem/refresh 成功后立即更新；SW 冷启动时由 init() 异步回填
        return _cachedToken;
      } catch (e) { return null; }
    }
  };

  var _cachedToken = null;
  // SW 启动时预取登录态回填缓存（fire-and-forget）
  load().then(function (a) { if (a && a.accessToken) _cachedToken = a.accessToken; }).catch(function () {});

  // redeem/refresh 成功路径里同步更新缓存
  var _origRedeem = redeem, _origGetValid = getValidAccessToken;
  redeem = function (code) {
    return _origRedeem(code).then(function (r) {
      load().then(function (a) { if (a && a.accessToken) _cachedToken = a.accessToken; });
      return r;
    });
  };
  getValidAccessToken = function () {
    return _origGetValid().then(function (t) { _cachedToken = t; return t; });
  };
  global.WCC_AUTH.redeem = redeem;
  global.WCC_AUTH.getValidAccessToken = getValidAccessToken;
})(typeof globalThis !== 'undefined' ? globalThis : self);
