// Side Panel 工作台（M2）：三 Tab、Loading/Error/Empty 状态机、连续深读。
// 交互原则（PRD 05-UI-UX）：Tab 切换不改变 Claim；新选区自动重分析；结果逐层出现。
(function () {
  'use strict';

  var els = {
    empty: document.getElementById('empty-state'),
    overview: document.getElementById('overview-state'),
    ovTitle: document.getElementById('ov-title'),
    ovStats: document.getElementById('ov-stats'),
    ovList: document.getElementById('ov-list'),
    card: document.getElementById('claim-card'),
    text: document.getElementById('claim-text'),
    expand: document.getElementById('claim-expand'),
    backOverview: document.getElementById('back-overview'),
    sourceTitle: document.getElementById('claim-source-title'),
    tabs: document.getElementById('mode-tabs'),
    loading: document.getElementById('loading-state'),
    loadingTitle: document.getElementById('loading-title'),
    loadingSteps: document.getElementById('loading-steps'),
    error: document.getElementById('error-state'),
    errorTitle: document.getElementById('error-title'),
    errorDetail: document.getElementById('error-detail'),
    retryBtn: document.getElementById('retry-btn'),
    result: document.getElementById('result-state'),
    panes: {
      truth: document.getElementById('result-truth'),
      deep: document.getElementById('result-deep'),
      differ: document.getElementById('result-differ')
    },
    regen: document.getElementById('regen-btn'),
    foot: document.querySelector('.panel-foot'),
    cacheFlag: document.getElementById('cache-flag')
  };

  // ---------- 全局状态 ----------
  var state = {
    claimPayload: null,   // 当前 Active Selection payload
    docIndex: null,       // 本文 Claim Index（U4 概览态）
    mode: 'truth',        // 当前 Tab
    results: {},          // mode -> { result, cached }
    verified: {},         // claimId -> supportLevel（概览已核实统计）
    analyzing: false,
    seq: 0,               // 丢弃过期响应（连续深读时旧响应作废）
    reqSeq: 0             // V3.0：分析请求序号（ANALYZE_STAGE 事件按此路由）
  };

  var CLAIM_TYPE_NAMES = { fact: '事实', number: '数字', causal: '因果', compare: '比较', predict: '预测', define: '定义', person: '人物事件', other: '其他', opinion: '观点' };
  var OBJECT_TYPE_NAMES = {
    plain: '普通正文', fact: '事实', data: '数据', report: '报告',
    paper: '论文', govdoc: '政府文件', orginfo: '机构信息', media: '媒体',
    person: '人物事件', opinion: '观点', rhetoric: '修辞'
  };

  var LOADING_STEPS = {
    truth: ['解析当前 Claim', '检索相关知识', '核对表述与证据'],
    deep: ['解析当前 Claim', '梳理相关概念', '构建知识关系'],
    differ: ['解析当前 Claim', '寻找不同观点', '分析遗漏维度']
  };

  var MODE_NAMES = { truth: '求真', deep: '求深', differ: '求异' };

  // ---------- V3.0 M0：求真直播剧场（真实管线阶段） ----------
  var TRUTH_STAGES = [
    { id: 'understand', label: '理解目标', hint: '判断声明类型与要找的证据' },
    { id: 'search',     label: '多路检索', hint: 'Exa/metaso 等多引擎并行召回' },
    { id: 'filter',     label: '筛出来源', hint: '去重 → 可信先验 → 身份分析 → 聚簇 → 八维评分' },
    { id: 'trace',      label: '递归溯源', hint: '顺着引用追到源头（深度≤3、命中官方即停）' },
    { id: 'verify',     label: '逐条核对', hint: '读原文比对声明（存在≠相关≠支持）' },
    { id: 'bind',       label: '绑定结论', hint: '证据编号绑定 + 硬校验 + 数字核对' }
  ];
  // V3.0 filter 子流水线：筛出来源的内部步骤（数据逐级流动、默认展开）
  var FILTER_SUBSTEPS = [
    { id: 'dedupe',          label: 'URL 去重',      hint: '等待' },
    { id: 'page_candidate',  label: '当前页候选',    hint: '等待' },
    { id: 'registry',        label: '可信先验',      hint: '等待' },
    { id: 'source_analysis', label: '身份分析',      hint: '等待' },
    { id: 'academic',        label: '论文验证',      hint: '等待' },
    { id: 'clusters',        label: '证据聚簇',      hint: '等待' },
    { id: 'score',           label: '八维评分',      hint: '等待' }
  ];
  var TIER_ZH = { verified: '可信', restricted: '受限', candidate: '候选', unknown: '未识别' };
  var DUPLEVEL_ZH = { duplicate: '重复', likely: '疑似转载', possible: '可能转载', independent: '独立' };
  var filterSubDoms = {}; // subId -> { row, value }

  // 生成 filter 子步骤的可视化数据文本（原始数据，默认展示）
  function filterSubText(sub, detail) {
    var d = detail || {};
    switch (sub) {
      case 'dedupe': return d.rawCount + ' → ' + d.keptCount + '（丢弃 ' + d.droppedCount + '）';
      case 'page_candidate': return d.added ? '已加入当前页作为候选' : (d.hasContextPage ? '当前页已在候选/重复' : '无当前页上下文');
      case 'registry': {
        if (!d.dist) return '统计中';
        var parts = Object.keys(d.dist).map(function (k) { return (TIER_ZH[k] || k) + ' ' + d.dist[k]; });
        return parts.join(' · ') || '—';
      }
      case 'source_analysis': {
        var parts2 = [];
        if (d.typeDist) {
          parts2.push('类型 ' + Object.keys(d.typeDist).map(function (k) { return k + ':' + d.typeDist[k]; }).join(' '));
        }
        if (d.originDist) {
          parts2.push('一手 ' + (d.originDist.original || 0) + ' / 转载 ' + ((d.originDist.syndicated || 0) + (d.originDist.syndicated_likely || 0)));
        }
        return parts2.join(' · ') || '分析中';
      }
      case 'academic': return d.skipped ? '非论文声明，跳过' : ('目标 ' + d.target + ' · 相关 ' + d.related);
      case 'clusters': {
        var parts3 = ['簇 ' + d.clusterCount];
        if (d.dupLevels) {
          Object.keys(d.dupLevels).forEach(function (k) { if (d.dupLevels[k] > 0) parts3.push(DUPLEVEL_ZH[k] + ' ' + d.dupLevels[k]); });
        }
        return parts3.join(' · ');
      }
      case 'score': {
        if (d.topScore == null) return '打分中';
        var txt = 'Top ' + d.topScore.toFixed(0);
        if (d.dims) txt += ' · 权威' + (d.dims.authority || 0).toFixed(0) + ' 相关' + (d.dims.relevance || 0).toFixed(0);
        if (d.topTitle) txt += ' · ' + d.topTitle;
        return txt;
      }
      default: return '';
    }
  }
  // 当前剧场各阶段 DOM（phase id -> { row, sub, dot }）
  var theater = {};
  var ENGINES_ZH = { exa: 'Exa', metaso: 'metaso', zhihu: '知乎', explicit: '原文', current_page: '当前页' };

  // ---------- V3.0 M0b：渐进式产出（候选来源先上屏、逐条点亮） ----------
  var previewBox = document.getElementById('candidate-preview');
  var candidateList = document.getElementById('candidate-list');
  var SOURCE_TYPE_ZH = { gov: '官方', media: '媒体', academic: '学术', org: '机构', industry: '行业', community: '社区', corporate: '企业', paper: '论文', other: '其他' };

  // 用 title/url 去重：同一来源可能先出现在 search preview 再出现在 sortedPreview
  var previewSeen = {};

  function resetPreview() {
    if (!candidateList) return;
    candidateList.innerHTML = '';
    previewSeen = {};
    if (previewBox) previewBox.hidden = true;
  }

  // items: [{title,url,sourceType?,originality?,engine}]；mode: 'raw'（灰占位）/ 'sorted'（点亮+徽章）
  function appendPreview(items, mode) {
    if (!candidateList || !items || !items.length) return;
    if (previewBox) previewBox.hidden = false;
    items.forEach(function (it) {
      if (!it || !it.title) return;
      var key = it.url || it.title;
      if (previewSeen[key]) return; // 已在列表（去重）
      previewSeen[key] = true;
      var li = document.createElement('li');
      li.className = 'cand ' + (mode === 'sorted' ? 'lit' : 'dim');
      var type = document.createElement('span');
      type.className = 'cand-type';
      type.textContent = mode === 'sorted' ? (SOURCE_TYPE_ZH[it.sourceType] || '其他') : (ENGINES_ZH[it.engine] || '');
      var title = document.createElement('span');
      title.className = 'cand-title';
      title.textContent = it.title;
      var meta = document.createElement('span');
      meta.className = 'cand-meta';
      meta.textContent = mode === 'sorted' ? (it.originality || '') : '';
      li.appendChild(type); li.appendChild(title); li.appendChild(meta);
      candidateList.appendChild(li);
    });
  }

  function stageSubText(phase, detail) {
    // 生成阶段完成摘要（V1：完成阶段收起为一行摘要；进行中阶段展开 hint）
    if (!detail) return null;
    var d = detail;
    switch (phase) {
      case 'understand':
        return ['已理解目标', d.questionType ? '类型=' + d.questionType : '', d.targetType ? '目标=' + d.targetType : ''].filter(Boolean).join(' · ');
      case 'search': {
        var en = [];
        if (d.engine) en.push((ENGINES_ZH[d.engine] || d.engine) + ' ' + (d.hits || 0) + ' 条');
        if (d.rawCount != null) en.push('共 ' + d.rawCount + ' 条原始结果');
        return en.join(' · ') || null;
      }
      case 'filter': {
        var parts = ['筛出 ' + (d.uniqueCount != null ? d.uniqueCount : '?') + ' 个候选'];
        if (d.engineBreakdown) {
          parts.push(Object.keys(d.engineBreakdown).map(function (k) { return (ENGINES_ZH[k] || k) + ' ' + d.engineBreakdown[k]; }).join(' / '));
        }
        return parts.join(' · ');
      }
      case 'trace':
        return '追到 ' + (d.upstreamCount != null ? d.upstreamCount : 0) + ' 个上游' + ((d.stops && d.stops.length) ? '（停止：' + d.stops.join(',') + '）' : '');
      case 'verify':
        return '核对 ' + (d.readsOk != null ? d.readsOk : '?') + ' 条证据' + (d.error ? '（' + d.error + '）' : '');
      case 'bind':
        return '绑定完成' + (d.evidenceCount != null ? ' · ' + d.evidenceCount + ' 条证据' : '') + (d.verdict ? ' · ' + d.verdict : '');
      default: return null;
    }
  }

  function buildTheater() {
    if (!els.loadingSteps) return;
    els.loadingSteps.innerHTML = '';
    theater = {};
    filterSubDoms = {};
    resetPreview(); // V3.0 M0b：候选区随剧场重建
    TRUTH_STAGES.forEach(function (s, i) {
      var li = document.createElement('li');
      li.className = 'stage' + (i === 0 ? ' doing' : ''); // V1：第一行乐观展开（真实事件到达后接管）
      li.dataset.phase = s.id;
      var dot = document.createElement('span');
      dot.className = 'stage-dot';
      var name = document.createElement('span');
      name.className = 'stage-name';
      name.textContent = s.label;
      var sub = document.createElement('span');
      sub.className = 'stage-sub';
      sub.textContent = s.hint; // V1：当前进行阶段细节默认展开
      li.appendChild(dot); li.appendChild(name); li.appendChild(sub);
      // V3.0 filter 子流水线：7 个内部步骤图形化挂到 filter 行内
      if (s.id === 'filter') {
        var flow = document.createElement('ul');
        flow.className = 'stage-subflow';
        FILTER_SUBSTEPS.forEach(function (fs) {
          var row = document.createElement('li');
          row.className = 'subflow-node wait';
          row.dataset.sub = fs.id;
          var num = document.createElement('span');
          num.className = 'subflow-num';
          num.textContent = String(Array.prototype.indexOf.call(FILTER_SUBSTEPS, fs) + 1);
          var lbl = document.createElement('span');
          lbl.className = 'subflow-label';
          lbl.textContent = fs.label;
          var val = document.createElement('span');
          val.className = 'subflow-value';
          val.textContent = '…';
          row.appendChild(num); row.appendChild(lbl); row.appendChild(val);
          flow.appendChild(row);
          filterSubDoms[fs.id] = { row: row, value: val };
        });
        li.appendChild(flow);
      }
      els.loadingSteps.appendChild(li);
      theater[s.id] = { row: li, sub: sub };
    });
  }

  // 阶段状态更新（status: start/engine/done/error/sub）
  function applyStage(st) {
    if (!st || !st.phase || !theater[st.phase]) return;
    // V3.0 filter 子流水线：sub 事件驱动子步骤点亮（数据默认展开）
    if (st.status === 'sub' && st.phase === 'filter' && filterSubDoms[st.detail.sub]) {
      var fs = filterSubDoms[st.detail.sub];
      fs.row.classList.remove('wait');
      fs.row.classList.add('done');
      fs.value.textContent = filterSubText(st.detail.sub, st.detail);
      return;
    }
    var t = theater[st.phase];
    t.row.classList.remove('doing', 'done', 'error');
    if (st.status === 'start') {
      t.row.classList.add('doing');
      t.sub.textContent = (TRUTH_STAGES.filter(function (s) { return s.id === st.phase; })[0] || {}).hint || '进行中';
    } else if (st.status === 'engine') {
      // 检索中某引擎返回：追加实时行（V3.0 渐进式细节）
      var add = stageSubText('search', st.detail);
      if (add && t.sub.textContent.indexOf(add) === -1) {
        var cur = t.sub.textContent;
        var parts = cur.split(' · ').filter(function (p) { return p; });
        parts.push(add);
        // 只保留最近 3 条引擎消息 + 末尾原始计数
        t.sub.textContent = parts.slice(-4).join(' · ');
      }
      t.row.classList.add('doing');
    } else if (st.status === 'done') {
      t.row.classList.add('done');
      var sub = stageSubText(st.phase, st.detail) || ((TRUTH_STAGES.filter(function (s) { return s.id === st.phase; })[0] || {}).hint || '完成');
      t.sub.textContent = sub;
      // V3.0 M0b：渐进式产出——search done 上屏候选占位；filter done 升级点亮带徽章
      if (st.phase === 'search' && st.detail && st.detail.preview) {
        appendPreview(st.detail.preview, 'raw');
      } else if (st.phase === 'filter' && st.detail && st.detail.sortedPreview) {
        appendPreview(st.detail.sortedPreview, 'sorted');
      }
    } else if (st.status === 'error') {
      t.row.classList.add('error');
      t.sub.textContent = stageSubText(st.phase, st.detail) || '此步未成功';
    }
  }

  // ---------- 视图切换 ----------

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function renderView() {
    var hasClaim = !!state.claimPayload;
    els.card.hidden = !hasClaim;
    els.tabs.hidden = !hasClaim;
    show(els.empty); // 先统一显示 empty，再按需隐藏
    if (hasClaim) hide(els.empty);
    // 概览态（U4）：无 Claim 工作台但已有本文 Index（VD3：有 Index 默认概览）
    els.overview.hidden = !(!hasClaim && state.docIndex && state.docIndex.index && state.docIndex.index.claims.length > 0);
    if (!els.overview.hidden) {
      showOverview();
      hide(els.loading); hide(els.error); hide(els.result); hide(els.foot); hide(els.regen);
      return;
    }
    if (!hasClaim) {
      hide(els.loading); hide(els.error); hide(els.result); hide(els.foot); hide(els.regen);
      return;
    }

    var cached = state.results[state.mode];
    if (state.analyzing && !cached) {
      hide(els.result); hide(els.error); hide(els.regen); hide(els.foot);
      showLoading();
    } else if (cached) {
      hide(els.loading); hide(els.error);
      renderResult(state.mode, cached);
      show(els.result); show(els.regen); show(els.foot);
      els.cacheFlag.textContent = cached.verified
        ? (cached.cached ? '已核验 · 缓存' : '已核验')
        : (cached.cached ? '未联网核验 · 缓存' : '未联网核验');
    } else {
      // 该模式尚未分析：自动触发
      startAnalysis(state.mode);
    }
  }

  function showLoading() {
    if (state.mode === 'truth') {
      // V3.0 M0：求真直播剧场——真实管线阶段（由 ANALYZE_STAGE 事件驱动，不再假进度）
      els.loadingTitle.textContent = '求真分析中……';
      buildTheater();
      show(els.loading);
      return;
    }
    // deep/differ：轻量步骤提示（V3.0 M2 再接入事件直播）
    els.loadingTitle.textContent = MODE_NAMES[state.mode] + '分析中……';
    els.loadingSteps.innerHTML = '';
    LOADING_STEPS[state.mode].forEach(function (s, i) {
      var li = document.createElement('li');
      li.className = i === 0 ? 'doing' : (i === 1 ? 'todo' : 'todo');
      li.textContent = s;
      els.loadingSteps.appendChild(li);
    });
    // 分步推进的视觉节奏（真实进度不可知，但状态可感知）
    var stepEls = [].slice.call(els.loadingSteps.children);
    setTimeout(function () { stepEls[0] && stepEls[0].classList.replace('doing', 'done'); stepEls[1] && stepEls[1].classList.replace('todo', 'doing'); }, 1400);
    setTimeout(function () { stepEls[1] && stepEls[1].classList.replace('doing', 'done'); stepEls[2] && stepEls[2].classList.replace('todo', 'doing'); }, 3600);
    show(els.loading);
  }

  function showError(reason) {
    var map = {
      config_missing: ['未配置 API Key', '请在项目根放置 deepseek_api.key 并运行 node scripts/gen-config.js，然后重新加载扩展'],
      needs_login: ['需要登录', '请点击右上角「登录」输入邀请码后使用'],
      http_401: ['鉴权失败', 'API Key 无效或已过期'],
      http_402: ['额度不足', 'DeepSeek 账户余额不足'],
      http_429: ['请求过于频繁', '请稍后再试'],
      abort: ['请求超时', '网络较慢或服务繁忙，请重试']
    };
    var m = map[reason] || ['暂时无法完成深读', reason || '未知错误'];
    els.errorTitle.textContent = m[0];
    els.errorDetail.textContent = m[1];
    hide(els.result); hide(els.loading);
    show(els.error);
    // V2.8：未登录时自动展开登录弹层，引导输入邀请码
    if (reason === 'needs_login') openAuthPanel();
  }

  // ---------- 分析流程 ----------

  function startAnalysis(mode, force) {
    var seq = ++state.seq;
    if (force) delete state.results[mode];
    state.analyzing = true;
    state.mode = mode;
    state.reqSeq = (state.reqSeq || 0) + 1; // V3.0：本请求的舞台事件序号
    var myReq = state.reqSeq;
    renderView();
    try {
      chrome.runtime.sendMessage(
        { type: WCC_MSG.ANALYZE, mode: mode, payload: state.claimPayload, requestId: myReq },
        function (resp) {
          void chrome.runtime.lastError;
          if (seq !== state.seq) return; // 已有新 Claim/模式，丢弃过期响应
          state.analyzing = false;
          if (resp && resp.ok) {
            state.results[mode] = {
              result: resp.analysis.result,
              cached: resp.analysis.cached,
              verified: resp.analysis.verified,
              sources: resp.analysis.sources,
              verification: resp.analysis.verification || null // V2.5 溯源管线结果
            };
            // 记录概览"已核实"（从本文概览进入的求真）
            if (mode === 'truth' && state.claimPayload.__claimId && resp.analysis.result && resp.analysis.result.supportLevel) {
              state.verified[state.claimPayload.__claimId] = resp.analysis.result.supportLevel;
            }
          } else {
            state.results[mode] = null;
            state.lastError = (resp && resp.reason) || 'no_response';
          }
          renderView();
        }
      );
    } catch (e) {
      state.analyzing = false;
      showError('extension_reloaded');
    }
  }

  // ---------- 渲染 ----------

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var SUPPORT_BADGES = {
    supported: '✓ 有较充分证据支持', partial: '🟡 部分支持',
    insufficient: '⚠️ 证据不足', unsupported: '✕ 不支持', opinion: '◎ 观点表达'
  };

  function cardWith(label) {
    var c = el('div', 'card glass');
    c.appendChild(el('div', 'card-label', label));
    return c;
  }

  function esc(s) { return String(s == null ? '' : s); }

  function renderTruth(result, entry) {
    var pane = els.panes.truth;
    pane.innerHTML = '';
    var c1 = cardWith('支持程度');
    c1.appendChild(el('span', 'badge ' + esc(result.supportLevel), SUPPORT_BADGES[result.supportLevel] || result.supportLevel));
    c1.appendChild(el('div', 'summary-text', esc(result.summary)));
    // V2.5：策略与证据统计行（问题类型/引擎/独立证据数）+ upgrade.md Binding 状态
    var st = entry && entry.verification && entry.verification.strategy;
    var stats = entry && entry.verification && entry.verification.stats;
    var bind = entry && entry.verification && entry.verification.binding;
    if (st || stats || bind) {
      var metaParts = [];
      if (st) {
        var TYPE_NAMES = { fact: '事实查询', academic: '学术问题', policy: '政策问题', event: '时事事件', data: '数据核实', open: '开放研究' };
        metaParts.push(TYPE_NAMES[st.questionType] || st.questionType);
        if (st.degradedExternal) metaParts.push('外部引擎未配置·已降级');
      }
      if (stats) {
        metaParts.push('候选 ' + stats.uniqueCount + ' · 独立证据 ' + stats.clusterCount + '（去重前 ' + stats.rawCount + '）');
        if (typeof stats.independentCount === 'number') {
          metaParts.push('独立来源 ' + stats.independentCount + (stats.sharedUpstreamCount ? ' · 共享上游 ' + stats.sharedUpstreamCount : ''));
        }
      }
      if (bind) {
        if (bind.bindingStatus) metaParts.push('绑定:' + bind.bindingStatus);
        if (bind.entityResolutionStatus === 'AMBIGUOUS') metaParts.push('⚠ 主体歧义');
        if (bind.hardValidation && !bind.hardValidation.passed) metaParts.push('硬校验未过');
      }
      var metaLine = el('div', 'v25-meta');
      metaLine.appendChild(el('span', 'v25-meta-text', esc(metaParts.join(' · '))));
      c1.appendChild(metaLine);
    }
    pane.appendChild(c1);

    // V2.5 溯源来源（verifyClaimV25 候选列表：已排序、带六维评分与 whyText）
    var v25Candidates = entry && entry.verification && entry.verification.candidates;
    if (Array.isArray(v25Candidates) && v25Candidates.length) {
      var cs25 = cardWith('溯源来源（按可信度排序 · 前 ' + Math.min(8, v25Candidates.length) + '）');
      v25Candidates.slice(0, 8).forEach(function (it) {
        var line = el('div', 'src-line v25-src-line');
        var a = el('a', 'src-link', esc(it.title || '(无标题)'));
        a.href = it.url; a.target = '_blank'; a.rel = 'noopener';
        line.appendChild(a);
        // 类型徽章（source-analyzer 结果）
        var TYPE_BADGE = { gov: '政府', acad: '科研', paper: '论文', media: '媒体', org: '组织', biz: '企业', zhihu: '知乎', other: '网页' };
        var badgeTxt = TYPE_BADGE[it.sourceAnalysis && it.sourceAnalysis.sourceType] || '网页';
        if (it.registryInfo && it.registryInfo.tier === 'verified') badgeTxt = '✓' + badgeTxt;
        line.appendChild(el('span', 'src-badge', esc(badgeTxt)));
        // upgrade.md：论文身份 / 溯源独立性标记
        if (it.paperStatus === 'TARGET_PAPER') line.appendChild(el('span', 'src-badge', '目标论文'));
        else if (it.paperStatus === 'RELATED_PAPER') line.appendChild(el('span', 'src-badge', '相关论文'));
        if (it.independence === 'SHARED_UPSTREAM') line.appendChild(el('span', 'src-synd', '共享上游'));
        else if (it.independence === 'DERIVED') line.appendChild(el('span', 'src-synd', '衍生'));
        // 一手性标记
        if (it.sourceAnalysis && it.sourceAnalysis.originality === 'original') {
          line.appendChild(el('span', 'src-original', '一手'));
        } else if (it.suspectedSyndication) {
          line.appendChild(el('span', 'src-synd', '疑似转载'));
        }
        line.appendChild(el('div', 'src-why', esc(it.whyText || '')));
        cs25.appendChild(line);
      });
      pane.appendChild(cs25);
    }

    // 兼容 V2.0 结构的检索来源（知乎双通道 origin 分组）
    var srcs = entry && entry.sources;
    var srcItems = srcs ? (srcs.zhihu || []).concat(srcs.global || []) : [];
    if (srcItems.length) {
      var zhihuN = (srcs.zhihu || []).length;
      var globN = (srcs.global || []).length;
      var cs = cardWith('检索来源（知乎站内 ' + zhihuN + ' · 全网 ' + globN + '）');
      srcItems.slice(0, 8).forEach(function (it) {
        var line = el('div', 'src-line');
        var a = el('a', 'src-link', esc(it.title || '(无标题)'));
        a.href = it.url; a.target = '_blank'; a.rel = 'noopener';
        line.appendChild(a);
        line.appendChild(el('span', 'src-meta',
          esc((it.origin === 'global'
                ? '全网 · ' + (it.sourceType === 'Answer' ? '回答' : it.sourceType === 'Article' ? '文章' : '网页')
                : it.sourceType === 'Answer' ? '知乎回答' : it.sourceType === 'Article' ? '知乎文章' : '知乎') +
              (it.author ? ' · ' + it.author : '') +
              (it.votes ? ' · ' + it.votes + ' 赞' : ''))));
        cs.appendChild(line);
      });
      pane.appendChild(cs);
    }

    var evs = Array.isArray(result.evidences) ? result.evidences : [];
    if (evs.length) {
      var c2 = cardWith('证据（' + evs.length + '）');
      evs.forEach(function (ev) {
        var ec = el('div', 'ev-card glass');
        var head = el('div', 'ev-head');
        head.appendChild(el('span', 'ev-type', esc(ev.sourceType)));
        head.appendChild(el('div', 'ev-point', esc(ev.point)));
        ec.appendChild(head);
        if (ev.detail) ec.appendChild(el('div', 'ev-detail', esc(ev.detail)));
        c2.appendChild(ec);
      });
      pane.appendChild(c2);
    }

    var c3 = cardWith('原文 / 来源对照');
    if (result.comparison && result.comparison.original) {
      var cmp = result.comparison;
      c3.appendChild(el('div', 'compare-tag', '原文'));
      c3.appendChild(el('div', 'compare-original', '「' + esc(cmp.original) + '」'));
      c3.appendChild(el('div', 'compare-tag', '来源实际表达'));
      c3.appendChild(el('div', 'compare-actual', '「' + esc(cmp.actual) + '」'));
      if (cmp.gap) c3.appendChild(el('div', 'compare-gap', '⚠️ ' + esc(cmp.gap)));
    } else {
      c3.appendChild(el('div', 'compare-none', '暂无可靠来源可对照——本判断基于模型内部知识，建议自行检索核实。'));
    }
    pane.appendChild(c3);
  }

  // ---------- 探索循环（PRD 04 §8 / 05 §14.3）：知识节点点击 → 成为新 Claim 重新三连探索 ----------

  function exploreNode(text) {
    var t = String(text || '').trim();
    if (!t || !state.claimPayload) return;
    showClaim({
      title: String(state.claimPayload.title || '').replace(/ · 知识探索$/, '') + ' · 知识探索',
      url: state.claimPayload.url,
      selectedText: t,
      capturedAt: new Date().toISOString()
    });
  }

  function renderDeep(result) {
    var pane = els.panes.deep;
    pane.innerHTML = '';
    var c1 = cardWith('背后的原理');
    c1.appendChild(el('div', 'summary-text', esc(result.principle)));
    pane.appendChild(c1);

    var concepts = Array.isArray(result.concepts) ? result.concepts : [];
    if (concepts.length) {
      var c2 = cardWith('相关概念');
      concepts.forEach(function (cp) {
        var line = el('div', 'concept-line');
        line.appendChild(el('span', 'concept-name', esc(cp.name)));
        line.appendChild(el('span', 'muted', esc(cp.description)));
        c2.appendChild(line);
      });
      pane.appendChild(c2);
    }

    var tree = result.tree || {};
    var c3 = cardWith('知识树');
    if (tree.root) {
      c3.appendChild(el('div', '', '')).appendChild(el('span', 'tree-root', esc(tree.root)));
      (Array.isArray(tree.branches) ? tree.branches : []).forEach(function (br) {
        var branch = el('div', 'tree-branch');
        branch.appendChild(el('div', 'tree-label', esc(br.label)));
        var nodesWrap = el('div', 'tree-nodes');
        (Array.isArray(br.nodes) ? br.nodes : []).forEach(function (n) {
          var chip = el('span', 'node-chip', esc(n));
          chip.title = '以此节点继续深读';
          chip.addEventListener('click', function () { exploreNode(n); });
          nodesWrap.appendChild(chip);
        });
        branch.appendChild(nodesWrap);
        c3.appendChild(branch);
      });
    } else {
      c3.appendChild(el('div', 'compare-none', '知识树生成中不可用。'));
    }
    pane.appendChild(c3);

    var qs = Array.isArray(result.questions) ? result.questions : [];
    if (qs.length) {
      var c4 = cardWith('继续探索');
      var ul = el('ul', 'q-list');
      qs.forEach(function (q) {
        var li = el('li', 'q-link', esc(q));
        li.title = '点击复制到剪贴板';
        li.addEventListener('click', function () {
          navigator.clipboard && navigator.clipboard.writeText(String(q));
          li.style.color = 'var(--accent)';
          setTimeout(function () { li.style.color = ''; }, 800);
        });
        ul.appendChild(li);
      });
      c4.appendChild(ul);
      pane.appendChild(c4);
    }
  }

  var VP_DOTS = { '乐观派': 'g', '谨慎派': 'y', '怀疑派': 'r' };

  function renderDiffer(result) {
    var pane = els.panes.differ;
    pane.innerHTML = '';
    var c1 = cardWith('当前观点');
    c1.appendChild(el('div', 'summary-text', esc(result.currentStance)));
    pane.appendChild(c1);

    var vps = Array.isArray(result.viewpoints) ? result.viewpoints : [];
    if (vps.length) {
      var c2 = cardWith('不同观点（' + vps.length + '）');
      vps.forEach(function (vp, i) {
        var vc = el('div', 'vp-card glass');
        var head = el('div', 'vp-head');
        head.appendChild(el('span', 'vp-dot ' + (VP_DOTS[vp.stance] || ['b', 'g', 'y', 'r'][i % 4])));
        head.appendChild(el('span', 'vp-stance', esc(vp.stance)));
        vc.appendChild(head);
        vc.appendChild(el('div', 'vp-point', esc(vp.point)));
        if (vp.reason) vc.appendChild(el('div', 'vp-reason', esc(vp.reason)));
        c2.appendChild(vc);
      });
      pane.appendChild(c2);
    }

    var bs = Array.isArray(result.blindSpots) ? result.blindSpots : [];
    if (bs.length) {
      var c3 = cardWith('⚠️ 认知盲区');
      bs.forEach(function (b) {
        var line = el('div', 'concept-line');
        line.appendChild(el('span', 'concept-name', esc(b.topic)));
        line.appendChild(el('div', 'blind-why', esc(b.why)));
        c3.appendChild(line);
      });
      pane.appendChild(c3);
    }
  }

  var RENDERERS = { truth: renderTruth, deep: renderDeep, differ: renderDiffer };

  // ---------- 本文概览（U4） ----------

  function showOverview() {
    var di = state.docIndex;
    var index = di.index;
    var claims = index.claims || [];
    var objectStats = index.objectStats || {};
    els.ovTitle.textContent = di.title || '本文';
    els.ovStats.innerHTML = '';
    // v2：信息对象分布统计（升级要求 §2）+ 已核实计数
    var stats = [
      { label: '可溯源声明', n: claims.length, cls: '' },
      { label: '已核实', n: Object.keys(state.verified).length, cls: '' }
    ];
    Object.keys(objectStats).forEach(function (ot) {
      if (objectStats[ot] > 0) stats.push({ label: OBJECT_TYPE_NAMES[ot] || ot, n: objectStats[ot], cls: '' });
    });
    stats.forEach(function (s) {
      var span = el('span', 'ov-stat');
      span.innerHTML = esc(s.label) + ' <b>' + s.n + '</b>';
      els.ovStats.appendChild(span);
    });
    els.ovList.innerHTML = '';
    claims.forEach(function (claim) {
      var item = el('button', 'ov-item glass');
      var head = el('div', 'ov-item-head');
      head.appendChild(el('span', 'ov-type', CLAIM_TYPE_NAMES[claim.type] || '声明'));
      head.appendChild(el('span', 'ov-obj', OBJECT_TYPE_NAMES[claim.objectType] || ''));
      var v = state.verified[claim.id];
      if (v) head.appendChild(el('span', 'ov-verified', SUPPORT_BADGES[v] || v));
      item.appendChild(head);
      item.appendChild(el('div', 'ov-text', esc(claim.text)));
      item.addEventListener('click', function () {
        // N6：Claim ↔ 网页定位——通知 content script 滚动到声明句并高亮（§12）
        try {
          chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var tab = tabs && tabs[0];
            if (tab) chrome.tabs.sendMessage(tab.id, { type: 'QIUZHEN_LOCATE_CLAIM', claimId: claim.id, sentenceId: claim.sentenceId }, function () { void chrome.runtime.lastError; });
          });
        } catch (e) { /* 忽略 */ }
        showClaim({
          title: String(di.title || '') + ' · 本文声明',
          url: di.url || '',
          selectedText: claim.text,
          capturedAt: new Date().toISOString(),
          __claimId: claim.id,
          __sentenceId: claim.sentenceId,
          __sourceRequirement: claim.sourceRequirement || 'any'
        });
      });
      els.ovList.appendChild(item);
    });
    if (!claims.length) {
      els.ovList.appendChild(el('div', 'muted', '本文没有识别出具有溯源价值的声明。'));
    }
  }

  function renderResult(mode, entry) {
    hide(els.error);
    if (!entry) { // 该模式上次失败
      showError(state.lastError);
      return;
    }
    RENDERERS[mode](entry.result, entry);
    Object.keys(els.panes).forEach(function (m) {
      els.panes[m].hidden = (m !== mode);
    });
  }

  // ---------- Claim 展示 ----------

  function showClaim(payload) {
    var isNewClaim = !state.claimPayload ||
      state.claimPayload.selectedText !== payload.selectedText ||
      state.claimPayload.url !== payload.url;

    state.claimPayload = payload;
    if (isNewClaim) {
      state.results = {};   // 新 Claim 清空三模式缓存结果
      state.analyzing = false;
      state.seq++;          // 作废在途响应
    }

    var text = String(payload.selectedText || '');
    els.text.textContent = '“' + text + '”';
    els.expand.hidden = text.length <= 90;
    els.text.classList.remove('expanded');
    els.expand.textContent = '展开全文';
    els.sourceTitle.textContent = payload.title || '';
    els.backOverview.hidden = !state.docIndex; // 有本文 Index 时可返回概览
    renderView();
  }

  function resetToEmpty() {
    state.claimPayload = null;
    state.results = {};
    state.analyzing = false;
    state.seq++;
    renderView();
  }

  // ---------- 事件绑定 ----------

  els.tabs.addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (!tab) return;
    state.mode = tab.dataset.mode;
    [].forEach.call(els.tabs.querySelectorAll('.tab'), function (t) {
      var active = t === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderView(); // Tab 切换不改变 Claim（PRD 05-UI-UX §8.2）
  });

  els.expand.addEventListener('click', function () {
    var expanded = els.text.classList.toggle('expanded');
    els.expand.textContent = expanded ? '收起' : '展开全文';
  });

  els.retryBtn.addEventListener('click', function () {
    startAnalysis(state.mode, true);
  });

  els.regen.addEventListener('click', function () {
    startAnalysis(state.mode, true); // 绕过前端缓存重新请求
  });

  els.backOverview.addEventListener('click', function () {
    resetToEmpty(); // 保留 docIndex → renderView 回到概览态
  });

  // 面板打开时拉取当前 Active Selection + 本文 Index（U4 概览）
  try {
    chrome.runtime.sendMessage({ type: WCC_MSG.GET_ACTIVE_SELECTION }, function (resp) {
      if (chrome.runtime.lastError) return;
      if (resp && resp.ok && resp.selection && resp.selection.payload) {
        showClaim(resp.selection.payload);
        return;
      }
      // 无选区 → 读本文 Index → 概览态
      chrome.storage.session.get('docIndex', function (data) {
        if (data && data.docIndex) {
          state.docIndex = data.docIndex;
          state.verified = {};
        }
        renderView();
      });
    });
  } catch (e) { /* context invalidated */ }

  // 连续深读：面板开着时新选区实时更新并重分析。
  // 双通道（M4 修复）：storage.onChanged 为主（storage 变更在所有扩展上下文可靠触发，
  // 不受"onMessage 处理中再广播"的时序影响）；runtime 广播为辅助。
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'session') return;
    if (changes.activeSelection) {
      var v = changes.activeSelection.newValue;
      if (!v || !v.payload || !v.payload.selectedText) { resetToEmpty(); return; }
      showClaim(v.payload);
      return;
    }
    // 悬浮球 Ready 后 docIndex 更新 → 无选区工作台时切概览（U4）
    if (changes.docIndex && changes.docIndex.newValue && !state.claimPayload) {
      state.docIndex = changes.docIndex.newValue;
      state.verified = {};
      renderView();
    }
  });

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || message.type !== WCC_MSG.ACTIVE_SELECTION_UPDATED) return;
    if (!message.payload || !message.payload.selectedText) { resetToEmpty(); return; }
    showClaim(message.payload);
  });

  // 背景光斑（毛玻璃需要背后有内容）
  (function injectOrbs() {
    var wrap = document.createElement('div');
    wrap.className = 'orbs';
    wrap.appendChild(el('div', 'orb o1'));
    wrap.appendChild(el('div', 'orb o2'));
    document.body.prepend(wrap);
  })();

  // ---------- V2.8 登录门禁（邀请码 + JWT；仅代理模式显示入口） ----------

  var authArea = document.getElementById('auth-area');
  var authLoginBtn = document.getElementById('auth-login-btn');
  var authUser = document.getElementById('auth-user');
  var authLogoutBtn = document.getElementById('auth-logout-btn');
  var authPanel = document.getElementById('auth-panel');
  var authInput = document.getElementById('auth-code-input');
  var authSubmit = document.getElementById('auth-submit');
  var authCancel = document.getElementById('auth-cancel');
  var authError = document.getElementById('auth-error');
  var authHint = document.getElementById('auth-hint');

  function renderAuth(state) {
    if (!authArea) return;
    // DIRECT 模式（本地密钥）无登录概念 → 整区隐藏
    if (!state || state.mode !== 'proxy') { authArea.hidden = true; return; }
    authArea.hidden = false;
    authLoginBtn.hidden = !!state.loggedIn;
    authUser.hidden = !state.loggedIn;
    authLogoutBtn.hidden = !state.loggedIn;
    if (state.loggedIn) authUser.textContent = state.alias || '已登录';
  }

  function refreshAuthState() {
    chrome.runtime.sendMessage({ type: WCC_MSG.AUTH_STATE }, function (resp) {
      void chrome.runtime.lastError;
      if (resp && resp.ok) {
        renderAuth(resp.state);
        // V2.8：PROXY 未登录且无 Claim 工作台（悬浮球引导路径）→ 自动展开登录弹层
        if (resp.state && resp.state.mode === 'proxy' && !resp.state.loggedIn && !state.claimPayload) {
          openAuthPanel();
        }
      } else renderAuth(null);
    });
  }

  // V2.8：展开登录弹层（悬浮球/API 被门禁拦截时引导登录）
  function openAuthPanel() {
    if (!authPanel) return;
    if (authHint) authHint.hidden = true;
    authPanel.hidden = false;
    authError.hidden = true;
    authInput.value = '';
    authInput.focus();
  }

  if (authArea) {
    authLoginBtn.addEventListener('click', openAuthPanel);
    authCancel.addEventListener('click', function () { authPanel.hidden = true; });
    authLogoutBtn.addEventListener('click', function () {
      chrome.runtime.sendMessage({ type: WCC_MSG.AUTH_LOGOUT }, function () {
        void chrome.runtime.lastError;
        refreshAuthState();
      });
    });
    function submitCode() {
      var code = authInput.value.trim();
      if (!code) return;
      authSubmit.disabled = true;
      authError.hidden = true;
      chrome.runtime.sendMessage({ type: WCC_MSG.AUTH_LOGIN, inviteCode: code }, function (resp) {
        void chrome.runtime.lastError;
        authSubmit.disabled = false;
        if (resp && resp.ok) {
          authPanel.hidden = true;
          refreshAuthState();
          // V2.8：登录成功后自动重触发当前分析（面板刚被拦截的路径）
          if (state.claimPayload && !state.analyzing) {
            renderView(); // 无缓存 → startAnalysis 自动触发
          } else if (authHint) {
            // 悬浮球路径（无 Claim）：提示用户再点悬浮球即可开始扫描
            authHint.textContent = '已开通 ✓ 现在回到网页点击右上角「求」悬浮球即可开始全文扫描';
            authHint.hidden = false;
          }
        } else {
          var reason = (resp && resp.reason) || 'login_failed';
          var msgMap = {
            invalid_invite_code: '邀请码无效，请检查后重试',
            auth_not_configured: '登录服务未配置',
            auth_timeout: '网络超时，请重试',
            auth_network_error: '网络错误，请重试'
          };
          authError.textContent = msgMap[reason] || '登录失败，请重试';
          authError.hidden = false;
        }
      });
    }
    authSubmit.addEventListener('click', submitCode);
    authInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitCode(); });

    refreshAuthState();
  }

  // ---------- V3.0 M0：分析阶段直播监听（SW → panel） ----------
  // 只在「求真」进行中且 requestId 匹配当前请求时更新剧场；
  // 任意阶段出现 error（如引擎全挂）时由后台自动降级继续，UI 按最终响应渲染。
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== WCC_MSG.ANALYZE_STAGE) return;
    if (!state.analyzing || state.mode !== 'truth') return;
    if (msg.requestId !== state.reqSeq) return; // 过期请求的事件丢弃
    applyStage(msg.stage);
  });

  renderView();
})();
