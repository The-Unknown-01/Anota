// 「求真」悬浮球（V1.5 U2）：页面右下角低干扰入口。
// 状态机：Idle → Analyzing → Ready / Error。点击才读取正文（v1.5_UPGRADE §8 隐私红线）。
// Idle：不读取任何内容；Analyzing：本地提取+SW Claim 识别；Ready：可再次点击（进入面板/概览）。
(function () {
  'use strict';

  if (window.__QIUZHEN_ORB_READY__) return; // 防重复注入
  window.__QIUZHEN_ORB_READY__ = true;

  var STATE = { IDLE: 'idle', ANALYZING: 'analyzing', READY: 'ready', ERROR: 'error' };
  var state = STATE.IDLE;
  var lastIndex = null; // 最近一次 Claim Index（本地保留，U3 Hover 用）
  var lastDocMeta = null; // {title, url}

  var orb = null;
  var badge = null;
  var spin = null;
  var label = null;

  // ---------- DOM ----------

  function ensureOrb() {
    if (orb) return orb;
    orb = document.createElement('div');
    orb.id = 'qiuzhen-orb';
    orb.setAttribute('role', 'button');
    orb.setAttribute('aria-label', '求真：分析本文可验证声明');
    orb.title = '求真 · 分析本文声明';
    orb.style.cssText = [
      'position: fixed', 'right: 18px', 'top: 56px', 'z-index: 2147483646', // 右上角，下移避开浏览器工具栏区（TD5）
      'width: 84px', 'height: 84px', 'border-radius: 50%', 'box-sizing: border-box', // O2：42px → 84px
      'display: flex', 'align-items: center', 'justify-content: center',
      'cursor: pointer', 'user-select: none',
      'font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      'font-size: 30px', 'font-weight: 700', 'color: #4f6ef7',            // O2：16px → 30px
      'background: rgba(250,250,253,.72)',
      'backdrop-filter: blur(10px)', '-webkit-backdrop-filter: blur(10px)',
      'border: 1px solid rgba(255,255,255,.8)',
      'box-shadow: 0 4px 18px rgba(30,40,80,.16)',
      'transition: transform .25s ease, box-shadow .25s ease, opacity .25s ease',
      'opacity: .55'
    ].join(';');

    // 标签（唯一文本载体，避免 textContent 赋值清掉兄弟节点）
    label = document.createElement('span');
    label.textContent = '求';
    label.style.cssText = 'position: relative; z-index: 1; line-height: 1;';
    orb.appendChild(label);

    badge = document.createElement('div');
    badge.style.cssText = [
      'position: absolute', 'top: -6px', 'left: -6px',                  // 徽标在左上（orb 居右上角时不溢出视口）
      'min-width: 26px', 'height: 26px', 'padding: 0 7px',
      'border-radius: 999px', 'background: #2f9e63', 'color: #fff',
      'font-size: 14px', 'font-weight: 700', 'line-height: 26px',
      'text-align: center', 'display: none', 'box-sizing: border-box',
      'z-index: 2'
    ].join(';');
    orb.appendChild(badge);

    spin = document.createElement('div');
    spin.style.cssText = [
      'position: absolute', 'inset: 0', 'border-radius: 50%',
      'border: 2px solid rgba(79,110,247,.18)', 'border-top-color: #4f6ef7',
      'display: none', 'animation: qiuzhen-spin .8s linear infinite'
    ].join(';');
    orb.appendChild(spin);

    // 动画 keyframes 注入一次
    if (!document.getElementById('qiuzhen-spin-style')) {
      var st = document.createElement('style');
      st.id = 'qiuzhen-spin-style';
      st.textContent = '@keyframes qiuzhen-spin { to { transform: rotate(360deg); } }';
      document.documentElement.appendChild(st);
    }

    orb.addEventListener('mouseenter', function () { orb.style.opacity = '1'; if (!dragging) orb.style.transform = 'scale(1.08)'; });
    orb.addEventListener('mouseleave', function () { if (state !== STATE.ANALYZING && !dragging) orb.style.transform = 'scale(1)'; });

    // N6：拖动 + 位置记忆（§12：自由拖动、限制可视区域、记忆上次位置）
    // 区分点击与拖动：位移超过 6px 视为拖动，抑制随后的 click
    var dragState = null;
    var dragging = false;
    orb.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var rect = orb.getBoundingClientRect();
      dragState = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false };
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragState) return;
      var dx = e.clientX - dragState.sx, dy = e.clientY - dragState.sy;
      if (!dragState.moved && Math.abs(dx) + Math.abs(dy) > 6) { dragState.moved = true; dragging = true; }
      if (!dragState.moved) return;
      var w = orb.offsetWidth || 84, h = orb.offsetHeight || 84;
      var nx = Math.max(4, Math.min(window.innerWidth - w - 4, dragState.ox + dx));
      var ny = Math.max(4, Math.min(window.innerHeight - h - 4, dragState.oy + dy));
      orb.style.left = nx + 'px';
      orb.style.top = ny + 'px';
      orb.style.right = 'auto';
    });
    document.addEventListener('mouseup', function () {
      if (!dragState) return;
      var wasDrag = dragState.moved;
      dragState = null;
      setTimeout(function () { dragging = false; }, 0);
      if (wasDrag) {
        // 拖动结束 → 记忆位置（storage.session，会话级）
        try {
          var rect = orb.getBoundingClientRect();
          chrome.storage.session.set({ orbPos: { x: Math.round(rect.left), y: Math.round(rect.top) } }, function () {});
        } catch (err) { /* 忽略 */ }
      }
    });

    orb.addEventListener('click', onOrbClick);
    // N6：恢复上次位置（默认右上角 top:56px——TD5 用户要求下移一点）
    try {
      chrome.storage.session.get('orbPos', function (data) {
        if (data && data.orbPos && typeof data.orbPos.x === 'number') {
          var w = orb.offsetWidth || 84, h = orb.offsetHeight || 84;
          orb.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, data.orbPos.x)) + 'px';
          orb.style.top = Math.max(4, Math.min(window.innerHeight - h - 4, data.orbPos.y)) + 'px';
          orb.style.right = 'auto';
        }
      });
    } catch (err) { /* 忽略 */ }
    document.documentElement.appendChild(orb);
    return orb;
  }

  // ---------- 状态机 ----------

  function setState(s, detail) {
    state = s;
    if (!orb) ensureOrb();
    spin.style.display = s === STATE.ANALYZING ? 'block' : 'none';
    orb.style.transform = s === STATE.ANALYZING ? 'scale(1)' : 'scale(1)';
    orb.title = s === STATE.IDLE ? '求真 · 分析本文声明'
      : s === STATE.ANALYZING ? '正在分析本文…'
      : s === STATE.READY ? '发现 ' + (detail || 0) + ' 个可验证声明，点击查看'
      : '分析失败，点击重试';

    if (s === STATE.READY) {
      orb.style.background = 'rgba(240,255,248,.86)';
      orb.style.borderColor = 'rgba(47,158,99,.5)';
      orb.style.color = '#1e7a47';
      label.textContent = '求';
      badge.textContent = String(detail || 0);
      badge.style.display = 'block';
      // 激活 Hover 声明交互层（U3）
      try {
        if (window.__QIUZHEN_HOVER__) window.__QIUZHEN_HOVER__.activate(lastIndex, lastDocMeta);
      } catch (e) { /* hover 层失败不阻塞悬浮球 */ }
    } else if (s === STATE.ERROR) {
      orb.style.background = 'rgba(255,244,242,.86)';
      orb.style.borderColor = 'rgba(207,75,60,.5)';
      orb.style.color = '#cf4b3c';
      label.textContent = '!';
      badge.style.display = 'none';
    } else {
      orb.style.background = 'rgba(250,250,253,.72)';
      orb.style.borderColor = 'rgba(255,255,255,.8)';
      orb.style.color = '#4f6ef7';
      label.textContent = '求';
      badge.style.display = 'none';
    }
    if (s === STATE.IDLE) orb.style.opacity = '0.55'; else orb.style.opacity = '1';
  }

  // ---------- 分析流程 ----------

  function analyze() {
    // 重新分析前清理旧 Hover 标记
    try { if (window.__QIUZHEN_HOVER__) window.__QIUZHEN_HOVER__.deactivate(); } catch (e) {}
    setState(STATE.ANALYZING);
    var doc;
    try {
      doc = window.__QIUZHEN_EXTRACTOR__.extractDocument();
    } catch (e) {
      setState(STATE.ERROR);
      return;
    }
    lastDocMeta = { title: doc.doc.title, url: doc.doc.url };
    try {
      chrome.runtime.sendMessage({ type: WCC_MSG.DETECT_CLAIMS, document: doc }, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) { setState(STATE.ERROR); return; }
        lastIndex = resp.index;
        setState(STATE.READY, (resp.index.claims || []).length);
      });
    } catch (e) {
      setState(STATE.ERROR); // extension context invalidated
    }
  }

  function onOrbClick() {
    if (state === STATE.ANALYZING) return;
    if (state === STATE.READY) {
      // 已分析：打开 Side Panel（U4 将在此进入「本文概览」态）
      try {
        chrome.runtime.sendMessage({ type: WCC_MSG.OPEN_PANEL_FOR_DOCUMENT, index: lastIndex, docUrl: location.href, docTitle: document.title || '' }, function () {});
      } catch (e) { /* context invalidated */ }
      return;
    }
    // idle / error → 先确认登录态（V2.8：PROXY 模式未登录必须先登录，不能直接调 API）
    try {
      chrome.runtime.sendMessage({ type: WCC_MSG.AUTH_STATE }, function (resp) {
        void chrome.runtime.lastError;
        var st = resp && resp.ok && resp.state;
        if (st && st.mode === 'proxy' && !st.loggedIn) {
          // 未登录：打开 Side Panel 引导登录（panel 顶部显示登录按钮/弹层），不触发分析
          try {
            chrome.runtime.sendMessage({ type: WCC_MSG.OPEN_PANEL_FOR_DOCUMENT, docUrl: location.href, docTitle: document.title || '' }, function () {});
          } catch (e2) { /* context invalidated */ }
          return;
        }
        analyze(); // 已登录或 DIRECT 模式 → 正常分析（缓存命中时 SW 秒回）
      });
    } catch (e) { /* context invalidated */ }
  }

  // ---------- 对外（U3 Hover 用） ----------

  window.__QIUZHEN_ORB__ = {
    getIndex: function () { return lastIndex; },
    setState: setState
  };

  ensureOrb(); // 注入即显示 Idle 悬浮球
})();
