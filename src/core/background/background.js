// Background Service Worker：Active Selection 的唯一中转与持久点（MV3，无独立后端——D2=B）。
// 职责（PRD 06-技术架构 §4）：接收 CAPTURE_SELECTION → 存 storage.session → 广播/打开 Side Panel。
importScripts('../generated-config.js', '../utils/message-types.js', '../auth/invite-jwt.js', '../ai/datasource.js', '../ai/analyzer.js', '../ai/claim-detector.js', '../ai/search-controller.js', '../ai/web-reader.js', '../ai/evidence-extractor.js', '../ai/verify-engine.js', '../ai/query-analyzer.js', '../ai/url-utils.js', '../ai/source-registry.js', '../ai/source-analyzer.js', '../ai/evidence-graph.js', '../ai/scoring-engine.js', '../ai/v25-pipeline.js', '../ai/evidence-target.js', '../ai/academic.js', '../ai/provenance.js');

// ---------- Active Selection 状态 ----------

var latestSelection = null; // 内存副本（SW 可能被休眠，storage.session 是权威）

function saveSelection(payload, sender) {
  latestSelection = {
    payload: payload,
    tabId: sender && sender.tab ? sender.tab.id : null,
    receivedAt: new Date().toISOString()
  };
  try {
    chrome.storage.session.set({ activeSelection: latestSelection });
  } catch (e) {
    // storage 异常时仅保留内存副本
  }
}

// ---------- Side Panel 控制 ----------

// 打开 Side Panel；无论成功失败都以 done 回调应答（异步响应，listener 需 return true）
function openSidePanel(tabId, done) {
  if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && typeof tabId === 'number') {
    chrome.sidePanel.open({ tabId: tabId }).then(
      function () { done({ ok: true }); },
      function () {
        // 打开失败（如面板已打开/无 gesture）：走广播路径更新已开面板
        notifyPanel();
        done({ ok: true, panelOpened: false });
      }
    );
  } else {
    notifyPanel();
    done({ ok: true, panelOpened: false });
  }
}

function notifyPanel() {
  if (!latestSelection) return;
  chrome.runtime.sendMessage({
    type: WCC_MSG.ACTIVE_SELECTION_UPDATED,
    payload: latestSelection.payload
  }, function () {
    // Side Panel 未打开时此处产生 lastError：属正常路径，静默
    void chrome.runtime.lastError;
  });
}

// V2.8 门禁守卫：PROXY 模式必须已登录（有有效 JWT）才能调用任何 AI/检索 API。
// 未登录返回 needs_login，面板据此引导登录（悬浮球路径在 orb.js 先查 AUTH_STATE，
// 未登录直接打开面板、不发 DETECT_CLAIMS）。
function guardApi(sendResponse) {
  return WCC_AUTH.isApiAllowed().then(function (allowed) {
    if (allowed) return true;
    sendResponse({ ok: false, reason: 'needs_login' });
    return false;
  });
}

// ---------- 消息路由 ----------

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || typeof message.type !== 'string') return false;

  switch (message.type) {
    case WCC_MSG.CAPTURE_SELECTION:
      if (!message.payload || typeof message.payload.selectedText !== 'string' ||
          message.payload.selectedText.trim().length === 0) {
        sendResponse({ ok: false, reason: 'empty_selection' });
        return false;
      }
      saveSelection(message.payload, sender);
      // PRD 06-技术架构 §8：先存后开。
      // 面板已打开 → 广播实时更新；面板未打开 → open 后由 GET_ACTIVE_SELECTION 拉取。
      notifyPanel();
      openSidePanel(sender && sender.tab ? sender.tab.id : null, sendResponse);
      return true; // 异步响应（等 sidePanel.open 结果）

    case WCC_MSG.GET_ACTIVE_SELECTION:
      // 面板刚打开时拉取当前 Active Selection
      if (latestSelection) {
        sendResponse({ ok: true, selection: latestSelection });
      } else {
        // SW 被休眠后内存为空：回退读 storage.session
        chrome.storage.session.get('activeSelection', function (data) {
          latestSelection = (data && data.activeSelection) || null;
          sendResponse({ ok: true, selection: latestSelection });
        });
        return true; // 异步响应
      }
      return false;

    case WCC_MSG.ANALYZE:
      // M1：Side Panel 请求 AI 深读分析（truth/deep/differ）
      if (!message.payload || typeof message.payload.selectedText !== 'string') {
        sendResponse({ ok: false, reason: 'bad_payload' });
        return false;
      }
      guardApi(sendResponse).then(function (allowed) {
        if (!allowed) return;
        // V3.0 M0：分析阶段直播广播（truth 全管线阶段事件，按 requestId 路由回发起 panel）
        var reqId = message.requestId || 0;
        function stageBroadcast(stage) {
          try {
            chrome.runtime.sendMessage({ type: WCC_MSG.ANALYZE_STAGE, requestId: reqId, stage: stage }, function () { void chrome.runtime.lastError; });
          } catch (e) { /* 面板可能已关闭 */ }
        }
        WCC_ANALYZER.analyze(message.mode, message.payload, { onStage: stageBroadcast }).then(
          function (res) {
            sendResponse({
              ok: true,
              analysis: {
                result: res.result,
                cached: res.cached,
                verified: res.verified,
                sources: res.sources || null,
                verification: res.verification || null // V2.5 溯源管线结果
              }
            });
          },
          function (err) {
            sendResponse({ ok: false, reason: String(err && err.message || 'analyze_failed') });
          }
        );
      });
      return true; // 异步响应

    case WCC_MSG.DETECT_CLAIMS:
      // V1.5 U1：全文 Claim 识别（发现+分类+定位，不验证不搜索）
      if (!message.document || !Array.isArray(message.document.sentences)) {
        sendResponse({ ok: false, reason: 'bad_document' });
        return false;
      }
      guardApi(sendResponse).then(function (allowed) {
        if (!allowed) return;
        WCC_CLAIM_DETECTOR.detectClaims(message.document).then(
          function (res) {
            sendResponse({ ok: true, index: { claims: res.claims, objectStats: res.objectStats || {}, analyzed: res.analyzed, truncated: res.truncated }, cached: res.cached });
          },
          function (err) {
            sendResponse({ ok: false, reason: String(err && err.message || 'detect_failed') });
          }
        );
      });
      return true; // 异步响应

    case WCC_MSG.OPEN_PANEL_FOR_DOCUMENT:
      // U2/U4：悬浮球 Ready 点击 → 保存本文 Claim Index（面板概览态读取）+ 打开面板。
      // 同时清空 Active Selection：悬浮球入口是「本文模式」，面板应显示概览而非旧选区（VD3）。
      latestSelection = null;
      try { chrome.storage.session.remove('activeSelection'); } catch (e) { /* 忽略 */ }
      if (message.index && message.index.claims) {
        try {
          chrome.storage.session.set({
            docIndex: {
              url: message.docUrl,
              title: message.docTitle,
              index: message.index,
              at: Date.now()
            }
          });
        } catch (e) { /* 忽略 */ }
      }
      chrome.sidePanel.open({ windowId: sender && sender.tab ? sender.tab.windowId : undefined })
        .then(function () { sendResponse({ ok: true, panelOpened: true }); })
        .catch(function () { sendResponse({ ok: true, panelOpened: false }); });
      return true; // 异步响应

    case WCC_MSG.PING:
      sendResponse({ ok: true, pong: true, at: Date.now() });
      return false;

    // ---------- V2.8 登录门禁（邀请码 + JWT） ----------
    case WCC_MSG.AUTH_LOGIN:
      (function () {
        var code = String((message && message.inviteCode) || '').trim();
        if (!code) { sendResponse({ ok: false, reason: 'invite_code_required' }); return; }
        WCC_AUTH.redeem(code).then(
          function (r) { sendResponse({ ok: true, alias: r.alias }); },
          function (err) { sendResponse({ ok: false, reason: String(err && err.code || err.message || 'login_failed') }); }
        );
      })();
      return true; // 异步响应

    case WCC_MSG.AUTH_STATE:
      WCC_AUTH.getAuthState().then(
        function (s) { sendResponse({ ok: true, state: s }); },
        function () { sendResponse({ ok: false, reason: 'state_failed' }); }
      );
      return true;

    case WCC_MSG.AUTH_LOGOUT:
      WCC_AUTH.logout().then(
        function () { sendResponse({ ok: true }); },
        function () { sendResponse({ ok: false, reason: 'logout_failed' }); }
      );
      return true;

    case WCC_MSG.VERIFY_CLAIM:
      // V2.5：溯源管线升级——Query Analyzer → 多引擎检索 → URL 去重 → Registry 先验
      //        → 来源分析 → 证据聚簇 → Scoring 排序 → Top-N Web Reader → 五态结论
      if (!message.claim || !message.claim.text) {
        sendResponse({ ok: false, reason: 'bad_claim' });
        return false;
      }
      guardApi(sendResponse).then(function (allowed) {
        if (!allowed) return;
        (function (claim) {
          WCC_V25.verifyClaimV25(claim).then(
            function (result) { sendResponse({ ok: true, verification: result }); },
            function (err) { sendResponse({ ok: false, reason: String(err && err.message || 'verify_failed') }); }
          );
        })(message.claim);
      });
      return true; // 异步响应

    case WCC_MSG.DISCOVER_DIFFER:
      // V2.0 N4：求异真实来源化——检索 → 读原文 → 提取真实不同观点（§10 禁止编造）
      if (!message.claim || !message.claim.text) {
        sendResponse({ ok: false, reason: 'bad_claim' });
        return false;
      }
      guardApi(sendResponse).then(function (allowed) {
        if (!allowed) return;
        (function (claim) {
          // 求异查询加对立倾向词，扩大不同立场召回
          var differClaim = Object.assign({}, claim);
          WCC_SEARCH_CONTROLLER.searchForClaim(differClaim).then(function (searchRes) {
            return WCC_VERIFY_ENGINE.discoverDifferViewpoints(claim, searchRes.candidates);
          }).then(
            function (result) { sendResponse({ ok: true, differ: result }); },
            function (err) { sendResponse({ ok: false, reason: String(err && err.message || 'differ_failed') }); }
          );
        })(message.claim);
      });
      return true; // 异步响应

    default:
      return false;
  }
});

// 能力检测：点击扩展图标时打开 Side Panel（openPanelOnActionClick）。
// 同时作为「深读」按钮失效时的手动入口（PRD 05-UI-UX §28 最后一行）。
if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
}
