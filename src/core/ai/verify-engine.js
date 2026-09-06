// 证据验证引擎（V2.0 N3）：Claim + 候选来源原文 → 逐源判定 → 五态结论。
// 升级要求 §8：必须区分 来源存在 ≠ 来源相关 ≠ 来源支持 Claim；
// §9：五态严格互斥 not_needed / no_source / unsupported / partial / supported，不得混用。
// 双模式：代理模式（PROXY）请求经 CF Worker 中转，密钥不出服务器；直连模式保留为本地开发后门。
(function (global) {
'use strict';

var CONFIG = global.QIUZHEN_CONFIG || null;

// ---------- 代理模式（与 datasource.js 一致） ----------
function isProxy() { return !!(CONFIG && CONFIG.PROXY_ENABLED === true && CONFIG.PROXY_BASE_URL); }
function isLlmAvailable() { return isProxy() || !!(CONFIG && CONFIG.DEEPSEEK_API_KEY); }
// DeepSeek 请求的 URL 与认证头：代理模式走 Worker（Worker 注入真实密钥），直连模式走官方
function llmRequestParts() {
  if (isProxy()) {
    return { url: CONFIG.PROXY_BASE_URL + '/v1/chat/completions', auth: WCC_AUTH && WCC_AUTH.proxyAuthHeader ? WCC_AUTH.proxyAuthHeader() : '' };
  }
  return { url: CONFIG.DEEPSEEK_BASE_URL + '/chat/completions', auth: 'Bearer ' + CONFIG.DEEPSEEK_API_KEY };
}

var VERDICTS = ['not_needed', 'no_source', 'unsupported', 'partial', 'supported'];
var VERDICT_NAMES = {
  not_needed: '无需验证',
  no_source: '未找到可靠来源',
  unsupported: '来源不支持',
  partial: '部分支持',
  supported: '支持'
};

// ---------- 单源判定 prompt ----------
var SINGLE_PROMPT = [
  '你是严谨的事实核查员。给你一个【声明】和一个【来源原文】。',
  '请判断该来源对声明的支持程度，严格区分三个层次：',
  '- 来源存在 ≠ 来源相关：内容主题无关即 irrelevant；',
  '- 来源相关 ≠ 支持：提到同一话题但数据/结论与声明不符即 contradict 或 insufficient；',
  '- 支持分两档：full（核心信息一致且数字/事实准确）/ partial（支持部分内容，但原文有扩大、简化或推断）。',
  '',
  '判定枚举：',
  '- irrelevant：来源与声明主题不相关；',
  '- insufficient：相关但信息不足以下结论；',
  '- contradict：相关且与声明矛盾（须引用矛盾点）；',
  '- full：支持 核心声明（须引用支持片段）；',
  '- partial：部分支持（须说明哪部分支持、哪部分不符）。',
  '',
  '要求：verdict 引用的 quote 必须是来源原文的 逐字片段 （≤80字）；找不到逐字依据就不要编造。',
  '若输入含【来源正文中检测到的数值】块，请先据此核对声明中的数字与方向（如 35% 与"上涨"是否一致），再作判定；quote 仍必须逐字摘自【来源原文】。',
  '只输出 JSON：{ "verdict ": "full|partial|irrelevant|insufficient|contradict ", "quote ": "来源原文片段 ", "analysis ": "一句话分析 "}'
].join('\n');

// ---------- JSON 提取（与 analyzer 同策略） ----------
function extractJson(text) {
  if (!text) throw new Error('empty_response');
  var start = text.indexOf('{');
  if (start < 0) throw new Error('no_json_in_response');
  var depth = 0, inStr = false, esc = false;
  for (var i = start; i < text.length; i++) {
    var ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced_json');
}

function callLLM(system, user) {
  var body = {
    model: CONFIG.DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 1500
  };
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 45000);
  var parts = llmRequestParts();
  return fetch(parts.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': parts.auth
    },
    body: JSON.stringify(body),
    signal: controller.signal
  }).then(function (resp) {
    clearTimeout(timer);
    if (!resp.ok) throw new Error('http_' + resp.status);
    return resp.json();
  }).then(function (data) {
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('empty_response');
    return extractJson(content);
  });
}

// ---------- Phase 2：结构化数值块（Evidence Extraction 与判定分离的第一步） ----------
// 正则优先抽取正文数值 → 格式化注入判定 prompt；抽取结果挂到 candidate.numericEvidence 供后续绑定/展示。
function buildEvidenceBlock(sourceText, candidate) {
  var EE = global.WCC_EVIDENCE_EXTRACTOR;
  if (!EE || !EE.extractNumericEvidence) return '';
  var evs = EE.extractNumericEvidence(sourceText, 6);
  if (candidate) candidate.numericEvidence = evs;
  return (evs.length && EE.formatForPrompt) ? EE.formatForPrompt(evs) + '\n\n' : '';
}

// ---------- 单源判定 ----------
// candidate: {url, title, content?, snippet?, sourceType, whitelist, score}
// 返回 Promise<candidate & {judgment}>
function judgeOne(candidate, claim) {
  var sourceText = candidate.content || candidate.snippet || '';
  if (!sourceText || sourceText.length < 30) {
    candidate.judgment = { verdict: 'insufficient', quote: '', analysis: '未能读取来源正文，仅凭摘要无法判定' };
    return Promise.resolve(candidate);
  }
  var user = '【声明】' + claim.text + '\n\n【来源标题】' + (candidate.title || '') + '\n\n' + buildEvidenceBlock(sourceText, candidate) + '【来源原文】\n' + sourceText.slice(0, 4000);
  return callLLM(SINGLE_PROMPT, user).then(function (j) {
    var v = j.verdict;
    if (['full', 'partial', 'irrelevant', 'insufficient', 'contradict'].indexOf(v) < 0) v = 'insufficient';
    candidate.judgment = {
      verdict: v,
      quote: String(j.quote || '').slice(0, 200),
      analysis: String(j.analysis || '').slice(0, 300)
    };
    return candidate;
  }).catch(function () {
    // LLM 失败重试一次
    return callLLM(SINGLE_PROMPT, user).then(function (j) {
      candidate.judgment = {
        verdict: j.verdict,
        quote: String(j.quote || '').slice(0, 200),
        analysis: String(j.analysis || '').slice(0, 300)
      };
      return candidate;
    }).catch(function () {
      candidate.judgment = { verdict: 'insufficient', quote: '', analysis: '判定服务暂不可用' };
      return candidate;
    });
  });
}

// ---------- 多源综合 → 五态结论（§9） ----------
var VERDICT_WEIGHT = { full: 3, partial: 1, irrelevant: 0, insufficient: 0, contradict: -2 };

function aggregate(candidates, claimMeta) {
  var judged = candidates.filter(function (c) { return c.judgment; });
  if (!judged.length) return { verdict: 'no_source', detail: '没有可判定的来源' };
  var full = judged.filter(function (c) { return c.judgment.verdict === 'full'; });
  var partial = judged.filter(function (c) { return c.judgment.verdict === 'partial'; });
  var contradict = judged.filter(function (c) { return c.judgment.verdict === 'contradict'; });
  var relevant = judged.filter(function (c) { return ['full', 'partial', 'contradict'].indexOf(c.judgment.verdict) >= 0; });
  if (!relevant.length) return { verdict: 'no_source', detail: '找到候选但均与声明不相关或信息不足' };
  // 权威加权：score 前 50% 的来源意见权重 ×1.5
  var sortedByScore = judged.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  var halfCount = Math.max(1, Math.ceil(sortedByScore.length / 2));
  var topSet = {};
  sortedByScore.slice(0, halfCount).forEach(function (c) { topSet[c.url] = true; });
  var supportW = 0, contraW = 0;
  judged.forEach(function (c) {
    var w = VERDICT_WEIGHT[c.judgment.verdict] * (topSet[c.url] ? 1.5 : 1);
    if (w > 0) supportW += w; else contraW -= w;
  });
  var verdict;
  if (contraW > supportW && contradict.length > 0) verdict = 'unsupported';
  else if (supportW >= contraW && full.length > 0 && partial.length === 0) verdict = 'supported';
  else if (full.length > 0 || partial.length > 0) verdict = 'partial';
  else verdict = 'no_source';
  return {
    verdict: verdict,
    detail: '支持权重 ' + Math.round(supportW * 10) / 10 + ' / 反对权重 ' + Math.round(contraW * 10) / 10 +
            '（有效来源 ' + relevant.length + '/' + judged.length + '）'
  };
}

// ---------- 主流程 ----------
// §19：Top-N 多样性验证池——不再机械取前三。
// 输入已按 scoreTotal 降序；按来源类型限额挑选，保证验证对象来源多样。
// §29：同一 Provenance Cluster 只保留最优代表（A/B/C→D 时验证池优先 D，不让 A/B/C 占满）。
function selectDiverseTopN(items, n) {
  if (items.length <= n) return items;
  var capPerType = Math.max(1, Math.ceil(n / 2)); // 同类型最多占一半
  var capPerCluster = 1;                          // 同溯源簇最多 1 个代表
  var picked = [];
  var typeCount = {};
  var clusterCount = {};
  items.forEach(function (it) {
    if (picked.length >= n) return;
    var st = (it.sourceAnalysis && it.sourceAnalysis.sourceType) || 'other';
    if ((typeCount[st] || 0) >= capPerType) return;
    if (it.provenanceClusterId) {
      if ((clusterCount[it.provenanceClusterId] || 0) >= capPerCluster) return;
      clusterCount[it.provenanceClusterId] = (clusterCount[it.provenanceClusterId] || 0) + 1;
    }
    typeCount[st] = (typeCount[st] || 0) + 1;
    picked.push(it);
  });
  // 类型太少不足 n 时，放宽配额补齐（保持分数顺序）
  if (picked.length < n) {
    items.forEach(function (it) {
      if (picked.length >= n) return;
      if (picked.indexOf(it) >= 0) return;
      picked.push(it);
    });
  }
  return picked;
}

// ---------- Phase1 §5：URL 失效有限恢复（预算受控） ----------
// 读取失败 ≠ 无证据。顺序：① canonical URL 重试 → ② 标题+发布者定向重搜同一内容的可访问版本。
// 恢复的是"同一证据的可访问版本"，不是泛搜相似文章。预算由调用方限制候选数（≤2）。
// 成功：给 candidate 注入 content / recovered / recoveredVia / recoveredUrl，并清除 readError。
function recoverCandidate(c) {
  var READER = global.WCC_WEB_READER;
  var DS = global.WCC_DATASOURCE;
  function adopt(recovered, via) {
    if (!recovered) return false;
    c.recovered = true;
    c.recoveredVia = via;
    c.recoveredUrl = recovered.url;
    c.content = recovered.content;
    c.contentTitle = recovered.title || c.title;
    c.accessStatus = 'READABLE';
    delete c.readError;
    return true;
  }
  function tryRead(u) {
    if (!u || /^https?:\/\//i.test(String(u)) === false) return Promise.resolve(null);
    return READER.readUrl(u).then(function (r) {
      return (r.ok && r.text && r.text.length >= 30) ? { url: u, title: r.title || '', content: r.text } : null;
    }).catch(function () { return null; });
  }
  function titleSearch() {
    var title = String(c.title || '');
    if (title.length < 8 || !DS || !DS.engineSearch) return Promise.resolve(false);
    var pub = (c.sourceAnalysis && c.sourceAnalysis.publisher) || '';
    var query = (title + (pub ? ' ' + pub : '')).slice(0, 120);
    return DS.engineSearch('metaso', query, 3).catch(function () { return []; }).then(function (hits) {
      var target = null;
      for (var i = 0; i < hits.length && !target; i++) {
        var h = hits[i];
        if (!h || !h.url || h.url === c.url) continue;
        if (diceTitleSim(h.title || '', title) >= 0.5) target = h;
      }
      if (!target) return Promise.resolve(false);
      return tryRead(target.url).then(function (r) { return adopt(r, 'title_search'); });
    });
  }
  // ① canonical 重试：读失败响应里可能已带 canonicalUrl
  if (c.canonicalUrl && c.canonicalUrl !== c.url) {
    return tryRead(c.canonicalUrl).then(function (r) {
      if (adopt(r, 'canonical')) return c;
      return titleSearch().then(function () { return c; });
    });
  }
  // ② 标题 + 发布者重搜
  return titleSearch().then(function () { return c; });
}

// 标题 bigram Dice 相似度（与 evidence-graph 口径一致）
function diceTitleSim(a, b) {
  var A = titleBigrams(a), B = titleBigrams(b);
  if (!A.size || !B.size) return 0;
  var inter = 0;
  A.forEach(function (g) { if (B.has(g)) inter++; });
  return inter * 2 / (A.size + B.size);
}
function titleBigrams(s) {
  var out = new Set();
  s = String(s).toLowerCase().replace(/[\s·:：\-—・]/g, '');
  for (var i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

// verifyClaim({text, sourceRequirement}, candidates) ->
//   Promise<{verdict, detail, evidences:[{url,title,sourceType,judgment}], readErrors:[...]}>
function verifyClaim(claim, candidates) {
  if (!isLlmAvailable()) return Promise.reject(new Error('config_missing'));
  if (!candidates || !candidates.length) {
    return Promise.resolve({ verdict: 'no_source', detail: '搜索无结果', evidences: [], readErrors: [] });
  }
  // §19：Top-6 多样性验证池（T-4：控制读原文成本的同时保证来源多样性；§29：同溯源簇取代表）
  var TOP_N = Math.min(candidates.length, 6);
  var top = selectDiverseTopN(candidates, TOP_N);
  // 读原文（N2）：复用 Provenance Tracing 已读正文（cachedBody），避免重复抓取
  var toRead = top.filter(function (c) { return !c.cachedBody; });
  return global.WCC_WEB_READER.readAll(toRead).then(function (withContent) {
    var all = top.map(function (c) {
      if (c.cachedBody) return Object.assign({}, c, { content: c.cachedBody, contentTitle: c.cachedTitle || c.title });
      for (var i = 0; i < withContent.length; i++) {
        if (withContent[i].url === c.url) return withContent[i];
      }
      return Object.assign({}, c, { readError: 'not_read', accessStatus: 'EMPTY_CONTENT' });
    });
    // Phase1 §5：读取失败的候选做"有限恢复"（canonical 重试 / 标题+发布者重搜可访问版本），预算 ≤2。
    // 恢复成功即注入正文；仍失败则保留 readError + accessStatus，交给 judgeOne 按摘要降级判定。
    var failures = all.filter(function (c) { return !c.content && !c.cachedBody && c.readError; }).slice(0, 2);
    return failures.reduce(function (p, c) {
      return p.then(function () { return recoverCandidate(c); });
    }, Promise.resolve()).then(function () {
      // 串行逐源判定（避免并发撞限流）
      var chain = Promise.resolve([]);
      all.forEach(function (cand) {
        chain = chain.then(function (acc) {
          return judgeOne(cand, claim).then(function (judged) { acc.push(judged); return acc; });
        });
      });
      return chain.then(function (judgedAll) {
        var agg = aggregate(judgedAll, claim);
        return {
          verdict: agg.verdict,
          detail: agg.detail,
          evidences: judgedAll.map(function (c) {
            return {
              url: c.url,
              title: c.title || c.url,
              sourceType: c.sourceType,
              whitelistTier: c.whitelist ? c.whitelist.tier : 'allow',
              origin: c.origin,
              judgment: c.judgment,
              hadFullText: !!c.content,
              accessStatus: c.accessStatus || null,
              readError: c.readError || null,
              recovered: !!c.recovered,
              recoveredUrl: c.recoveredUrl || null,
              recoveredVia: c.recoveredVia || null,
              numbers: (c.numericEvidence || []).slice(0, 5).map(function (e) { return { value: e.value, unit: e.unit || null, direction: e.direction === 'neutral' ? null : e.direction }; }),
              isExplicit: !!c.isExplicit,
              paperStatus: c.paperStatus || null,
              independence: c.independence || null,
              provenanceClusterId: c.provenanceClusterId || null
            };
          }),
          readErrors: judgedAll.filter(function (c) { return c.readError; }).map(function (c) { return { url: c.url, finalUrl: c.finalUrl || null, accessStatus: c.accessStatus || null, reason: c.readError }; })
        };
      });
    });
  });
}

// ---------- 求异：真实不同立场挖掘（V2.0 N4，§10） ----------
// 禁止 AI 编造立场；必须来自真实来源原文
var DIFFER_PROMPT = [
  '你是观点调研员。给你一个【原始声明】和一个【来源原文】。',
  '请判断该来源是否表达了与声明不同或相反的观点/结论/数据解读。',
  '- different：表达了明显不同的立场、结论或质疑（须逐字引用关键句）；',
  '- same：观点与声明一致或仅是复述；',
  '- irrelevant：主题不相关。',
  '要求：quote 必须是来源原文的 逐字片段 （≤100字）；viewpoint 用一句话概括该来源的立场。',
  '找不到真实依据就不要编造——宁报 same/irrelevant 也不虚构不同观点。',
  '只输出 JSON：{ "verdict ": "different|same|irrelevant ", "viewpoint ": "一句话立场概括 ", "quote ": "逐字片段 "}'
].join('\n');

function judgeDifferOne(candidate, claim) {
  var sourceText = candidate.content || candidate.snippet || '';
  if (!sourceText || sourceText.length < 30) {
    candidate.differJudgment = { verdict: 'irrelevant', viewpoint: '', quote: '', note: '未能读取正文' };
    return Promise.resolve(candidate);
  }
  var user = '【原始声明】' + claim.text + '\n\n【来源标题】' + (candidate.title || '') + '\n\n【来源原文】\n' + sourceText.slice(0, 4000);
  return callLLM(DIFFER_PROMPT, user).then(function (j) {
    var v = j.verdict;
    if (['different', 'same', 'irrelevant'].indexOf(v) < 0) v = 'same';
    candidate.differJudgment = {
      verdict: v,
      viewpoint: String(j.viewpoint || '').slice(0, 200),
      quote: String(j.quote || '').slice(0, 250)
    };
    return candidate;
  }).catch(function () {
    candidate.differJudgment = { verdict: 'same', viewpoint: '', quote: '', note: '判定失败保守归为同立场' };
    return candidate;
  });
}

// discoverDifferViewpoints(claim, candidates) ->
//   Promise<{found:boolean, viewpoints:[{url,title,sourceType,origin,viewpoint,quote}]}>
function discoverDifferViewpoints(claim, candidates) {
  if (!candidates || !candidates.length) {
    return Promise.resolve({ found: false, viewpoints: [], detail: '没有候选来源' });
  }
  var TOP_N = Math.min(candidates.length, 5); // §19：求异需要更广覆盖 + 来源多样性
  var top = selectDiverseTopN(candidates, TOP_N);
  return global.WCC_WEB_READER.readAll(top).then(function (withContent) {
    var chain = Promise.resolve([]);
    withContent.forEach(function (cand) {
      chain = chain.then(function (acc) {
        return judgeDifferOne(cand, claim).then(function (j) { acc.push(j); return acc; });
      });
    });
    return chain.then(function (judged) {
      var differ = judged.filter(function (c) { return c.differJudgment && c.differJudgment.verdict === 'different'; });
      return {
        found: differ.length > 0,
        viewpoints: differ.map(function (c) {
          return {
            url: c.url,
            title: c.title || c.url,
            sourceType: c.sourceType,
            origin: c.origin,
            viewpoint: c.differJudgment.viewpoint,
            quote: c.differJudgment.quote
          };
        }),
        scanned: judged.length,
        detail: differ.length ? '' : '已检索并阅读 ' + judged.length + ' 个来源，暂未找到可靠的不同观点'
      };
    });
  });
}

global.WCC_VERIFY_ENGINE = {
  verifyClaim: verifyClaim,
  judgeOne: judgeOne,
  aggregate: aggregate,
  discoverDifferViewpoints: discoverDifferViewpoints,
  selectDiverseTopN: selectDiverseTopN,
  recoverCandidate: recoverCandidate,
  diceTitleSim: diceTitleSim,
  VERDICTS: VERDICTS,
  VERDICT_NAMES: VERDICT_NAMES
};
})(typeof globalThis !== 'undefined' ? globalThis : self);