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
  var arc = null;    // 雷达探针外圈（A 透镜 + B 探针）
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
      // A·透镜：衬线"求"字 + 品牌渐变墨色（由 label 应用），字体走系统衬线栈
      'font-family: "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", serif',
      'font-size: 27px', 'font-weight: 700',
      // A·玻璃透镜：左上径向高光 + 靛蓝→紫的浅玻璃渐变（状态色由 setState 覆盖同构渐变）
      'background: radial-gradient(circle at 30% 24%, rgba(255,255,255,.95), rgba(255,255,255,0) 55%), linear-gradient(145deg, rgba(255,255,255,.86), rgba(224,230,255,.55) 60%, rgba(197,206,255,.42))',
      'backdrop-filter: blur(12px)', '-webkit-backdrop-filter: blur(12px)',
      'border: 1px solid rgba(255,255,255,.9)',
      'box-shadow: 0 8px 22px rgba(40,50,120,.18), inset 0 1px 6px rgba(255,255,255,.85)',
      'transition: transform .25s ease, box-shadow .3s ease, opacity .25s ease',
      'opacity: .5'
    ].join(';');

    // 标签（"求"）：品牌渐变墨色（background-clip: text；错误态在 setState 覆盖为纯色 !）
    label = document.createElement('span');
    label.textContent = '求';
    label.style.cssText = 'position: relative; z-index: 1; line-height: 1;' +
      'background: linear-gradient(180deg, #5b6cf0 0%, #8b5cf6 100%);' +
      '-webkit-background-clip: text; background-clip: text; color: transparent;';
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

    // B·雷达探针：外圈一段"扫描弧"（conic-gradient 勾亮 ~120°，其余透明；分析时整环旋转扫描）
    arc = document.createElement('div');
    arc.style.cssText = [
      'position: absolute', 'inset: -3px', 'border-radius: 50%', 'pointer-events: none',
      'background: conic-gradient(from -90deg, #5b6cf0 0deg 120deg, rgba(91,108,240,0) 124deg 360deg)',
      '-webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))',
      'mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))',
      'opacity: .35', 'transition: opacity .25s ease'
    ].join(';');
    orb.appendChild(arc);

    // 动画 keyframes 注入一次（B·雷达扫描 + 就绪脉冲）
    if (!document.getElementById('qiuzhen-spin-style')) {
      var st = document.createElement('style');
      st.id = 'qiuzhen-spin-style';
      st.textContent = '@keyframes qiuzhen-sweep { to { transform: rotate(360deg); } }' +
        '@keyframes qiuzhen-pulse { from { box-shadow: 0 0 0 0 rgba(47,158,99,.5); } to { box-shadow: 0 0 0 14px rgba(47,158,99,0); } }';
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
    // B·雷达探针：分析中整环扫描，其余静止
    arc.style.animation = s === STATE.ANALYZING ? 'qiuzhen-sweep 1.1s linear infinite' : 'none';
    arc.style.opacity = (s === STATE.IDLE || s === STATE.ERROR) ? '.35' : '.9';
    arc.style.background = s === STATE.ERROR
      ? 'conic-gradient(from -90deg, #e05c4f 0deg 120deg, rgba(224,92,79,0) 124deg 360deg)'
      : 'conic-gradient(from -90deg, #5b6cf0 0deg 120deg, rgba(91,108,240,0) 124deg 360deg)';
    orb.style.animation = 'none'; // 清上一次 ready 脉冲
    orb.style.transform = 'scale(1)';
    orb.title = s === STATE.IDLE ? '求真 · 分析本文声明'
      : s === STATE.ANALYZING ? '正在分析本文…'
      : s === STATE.READY ? '发现 ' + (detail || 0) + ' 个可验证声明，点击查看'
      : '分析失败，点击重试';

    if (s === STATE.READY) {
      // 透镜转薄荷态 + 一次柔和呼吸脉冲
      orb.style.background = 'radial-gradient(circle at 30% 24%, rgba(255,255,255,.95), rgba(255,255,255,0) 55%), linear-gradient(145deg, rgba(255,255,255,.86), rgba(214,250,232,.62) 60%, rgba(176,240,205,.4))';
      orb.style.borderColor = 'rgba(47,158,99,.55)';
      orb.style.boxShadow = '0 8px 22px rgba(47,158,99,.22), inset 0 1px 6px rgba(255,255,255,.85)';
      orb.style.animation = 'qiuzhen-pulse .55s ease-out 1';
      label.textContent = '求';
      badge.textContent = String(detail || 0);
      badge.style.display = 'block';
      // 激活 Hover 声明交互层（U3）
      try {
        if (window.__QIUZHEN_HOVER__) window.__QIUZHEN_HOVER__.activate(lastIndex, lastDocMeta);
      } catch (e) { /* hover 层失败不阻塞悬浮球 */ }
    } else if (s === STATE.ERROR) {
      orb.style.background = 'radial-gradient(circle at 30% 24%, rgba(255,255,255,.95), rgba(255,255,255,0) 55%), linear-gradient(145deg, rgba(255,255,255,.86), rgba(255,236,232,.6) 60%, rgba(255,206,198,.42))';
      orb.style.borderColor = 'rgba(207,75,60,.5)';
      orb.style.boxShadow = '0 8px 22px rgba(207,75,60,.18), inset 0 1px 6px rgba(255,255,255,.85)';
      label.textContent = '!';
      label.style.cssText = 'position: relative; z-index: 1; line-height: 1; color: #cf4b3c;';
      badge.style.display = 'none';
    } else {
      // idle / analyzing：玻璃透镜常态 + 渐变墨色"求"
      orb.style.background = 'radial-gradient(circle at 30% 24%, rgba(255,255,255,.95), rgba(255,255,255,0) 55%), linear-gradient(145deg, rgba(255,255,255,.86), rgba(224,230,255,.55) 60%, rgba(197,206,255,.42))';
      orb.style.borderColor = 'rgba(255,255,255,.9)';
      orb.style.boxShadow = '0 8px 22px rgba(40,50,120,.18), inset 0 1px 6px rgba(255,255,255,.85)';
      label.textContent = '求';
      label.style.cssText = 'position: relative; z-index: 1; line-height: 1;' +
        'background: linear-gradient(180deg, #5b6cf0 0%, #8b5cf6 100%);' +
        '-webkit-background-clip: text; background-clip: text; color: transparent;';
      badge.style.display = 'none';
    }
    if (s === STATE.IDLE) orb.style.opacity = '0.5'; else orb.style.opacity = '1';
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
