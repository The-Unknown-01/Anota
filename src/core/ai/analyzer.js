// AI 深读分析链路（M1）：在 Background Service Worker 内调用 DeepSeek。
// 代理模式下经 CF Worker 中转（密钥不出服务器）；直连模式保留为本地开发后门。
// 三种模式（PRD 04-功能需求）：truth=求真 / deep=求深 / differ=求异。
// 原则：结构化 JSON 输出；不制造虚假确定性；查询缓存防配额击穿（PRD 06-技术架构 §14）。
(function (global) {
'use strict';
var CONFIG = global.QIUZHEN_CONFIG || null;

// ---------- 代理模式（与 datasource.js 一致） ----------
function isProxy() { return !!(CONFIG && CONFIG.PROXY_ENABLED === true && CONFIG.PROXY_BASE_URL); }
function isLlmAvailable() { return isProxy() || !!(CONFIG && CONFIG.DEEPSEEK_API_KEY); }
// DeepSeek 请求的 URL 与认证头：代理模式走 Worker（Worker 注入真实密钥），直连模式走官方
// V2.8：代理模式认证只用 JWT（WCC_AUTH.proxyAuthHeader）——未登录返回空认证，
// 由 background 门禁守卫（guardApi）在入口拦截，不再回落静态 PROXY_ACCESS_TOKEN
function llmRequestParts() {
  if (isProxy()) {
    var jwt = WCC_AUTH && WCC_AUTH.proxyAuthHeader ? WCC_AUTH.proxyAuthHeader() : '';
    return { url: CONFIG.PROXY_BASE_URL + '/v1/chat/completions', auth: jwt };
  }
  return { url: CONFIG.DEEPSEEK_BASE_URL + '/chat/completions', auth: 'Bearer ' + CONFIG.DEEPSEEK_API_KEY };
}

// ---------- 三模式 Prompt ----------
var SYSTEM_PROMPTS = {
  truth: [
    '你是严谨的事实核查助手。用户给你一段网页中选中的话（Claim），请基于你的知识核查它。',
    '要求：',
    '1. 先给 Claim 分类（type 字段）：数值/时间/地理/排名比较/科学/法律政策/人物机构/因果关系/预测/主观观点。',
    '2. 若属 "主观观点"，supportLevel 固定为 "opinion"，并在 summary 说明 "该内容属于观点表达，无需事实溯源"。',
    '3. supportLevel 四选一：supported(有较充分证据支持)/partial(部分支持)/insufficient(证据不足)/unsupported(不支持)。不确定时宁可 insufficient，不要猜测。',
    '4. 【证据绑定，最高优先级】你只能依据下方【溯源检索结果】中给出的来源作答：',
    '   - 每个来源都有编号（如 E1、E2…）。evidences 每项必须含 evidenceId 字段，引用对应来源编号；',
    '   - 若检索结果中没有支持该 Claim 的来源，supportLevel 必须为 insufficient 或 unsupported，evidences 留空数组；',
    '   - 严禁用你自身的训练知识或上下文推断来 "补全" 检索结果中不存在的数字/日期/结论。',
    '5. evidences 给出 1~4 条支持或反驳的证据。每项固定字段：evidenceId(对应检索来源编号，如 "E1")、sourceType(五选一:原始研究/官方资料/权威报告/专业媒体/社区讨论)、point(一句话结论)、detail(简要说明)。无法给出可靠来源时留空数组。',
    '6. comparison 必须诚实对照 "原文说了什么" 与 "来源实际表达了什么"。固定字段：original(原文表述)、actual(来源实际表达)、gap(差异判断，如把相关性夸大为因果/绝对化/以偏概全)。没有可靠来源时 comparison 为 null。',
    '7. 输出 JSON 必须包含全部字段：type、supportLevel、summary、evidences、comparison。',
    '8. 只输出 JSON，不要输出任何其他文字。'
  ].join('\n'),
  deep: [
    '你是深入浅出的知识讲解者。用户给你一段网页中选中的话（Claim），请解释它背后的原理与知识。',
    '要求：',
    '1. principle：用平实语言解释这句话背后的原理或机制，120 字以内，先结论后展开。',
    '2. concepts：3~6 个关键概念节点，每项固定字段：name(概念名)、description(一句话简介)。',
    '3. tree：围绕 Claim 的知识树。固定结构：root(核心概念名)、branches 数组，每支固定字段：label(维度名如 原理/应用/争议)、nodes(字符串数组，具体节点名)。branches 取 2~4 个维度，每支挂 2~4 个节点。',
    '4. questions：3 条值得继续追问的问题（为什么/怎么实现/有什么局限）。',
    '5. 知识不足的领域如实说明，不要编造术语。',
    '6. 输出 JSON 必须包含全部字段：principle、concepts、tree、questions。',
    '7. 只输出 JSON，不要输出任何其他文字。'
  ].join('\n'),
  differ: [
    '你是多元视角分析助手。用户给你一段网页中选中的话（Claim）及其出处，请呈现不同立场与被忽略的维度。',
    '注意：本模式仅用于用户主动选中文本的深入语义分析。若系统已提供「真实来源的不同观点」（differSources 字段），你必须优先基于它们作答，禁止编造立场。',
    '要求：',
    '1. currentStance：概括当前内容的立场倾向。',
    '2. viewpoints：2~4 个不同立场。每项固定字段：stance(中文短语如 乐观派/谨慎派/怀疑派)、point(核心论点)、reason(主要理由)。立场必须有实质差异，不是同义反复。若 differSources 非空，每个 viewpoint 必须对应其中一条真实来源（sourceUrl 字段填其 URL），不得虚构立场数量。',
    '3. blindSpots：1~4 个当前内容较少讨论但重要的维度（认知盲区）。每项固定字段：topic(维度名)、why(为什么重要)。',
    '4. 观点要能代表真实世界中存在的讨论，不虚构边缘立场。若 differSources 为空数组且你无法确知真实讨论存在，viewpoints 可以为空数组并在 currentStance 中说明「暂未找到可靠的不同观点」。',
    '5. 输出 JSON 必须包含全部字段：currentStance、viewpoints、blindSpots。',
    '6. 只输出 JSON，不要输出任何其他文字。'
  ].join('\n')
};
var USER_TEMPLATE = [
  'Claim（用户选中的话）：',
  '「{{CLAIM}}」',
  '',
  '出处页面：{{TITLE}}（{{URL}}）',
  '',
  '请按要求输出 JSON。'
].join('\n');

// ---------- 缓存（内存 + storage.session 镜像，防 SW 休眠丢失） ----------
var CACHE_MAX = 60;
var cache = new Map(); // key -> { result, at }
function cacheKey(mode, claim, url) {
  return mode + '|' + claim + '|' + (url || '');
}
function cacheGet(key) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return new Promise(function (resolve) {
    try {
      chrome.storage.session.get('analysisCache', function (data) {
        var stored = (data && data.analysisCache && data.analysisCache[key]) || null;
        if (stored) { // 回填内存
          cache.set(key, stored);
        }
        resolve(stored);
      });
    } catch (e) { resolve(null); }
  });
}
function cacheSet(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    var firstKey = cache.keys().next().value; // 简单 FIFO 淘汰
    cache.delete(firstKey);
  }
  try {
    chrome.storage.session.get('analysisCache', function (data) {
      var all = (data && data.analysisCache) || {};
      all[key] = value;
      chrome.storage.session.set({ analysisCache: all });
    });
  } catch (e) { /* 仅内存 */ }
}

// ---------- JSON 提取与校验 ----------
// 模型可能输出 ```json 包裹或前后杂文，提取首个平衡的 JSON 对象
function extractJson(text) {
  if (!text) throw new Error('empty_response');
  var start = text.indexOf('{');
  if (start === -1) throw new Error('no_json_in_response');
  var depth = 0, inStr = false, esc = false;
  for (var i = start; i < text.length; i++) {
    var ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { if (inStr) esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced_json');
}
var REQUIRED_FIELDS = {
  truth: ['type', 'supportLevel', 'summary'],
  deep: ['principle', 'concepts', 'questions'],
  differ: ['currentStance', 'viewpoints', 'blindSpots']
};
function validate(mode, obj) {
  var missing = (REQUIRED_FIELDS[mode] || []).filter(function (f) { return !(f in obj); });
  if (missing.length) throw new Error('missing_fields:' + missing.join(','));
  return obj;
}

// ---------- DeepSeek 调用 ----------
var TIMEOUT_MS = 45000;
function callDeepseek(mode, payload, extraContext) {
  if (!isLlmAvailable()) {
    return Promise.reject(new Error('config_missing'));
  }
  var userMsg = USER_TEMPLATE
    .replace('{{CLAIM}}', String(payload.selectedText || '').slice(0, 1200))
    .replace('{{TITLE}}', String(payload.title || '').slice(0, 200))
    .replace('{{URL}}', String(payload.url || '').slice(0, 300));
  if (extraContext) userMsg += '\n\n' + extraContext;
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  var parts = llmRequestParts();
  return fetch(parts.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': parts.auth
    },
    body: JSON.stringify({
      model: CONFIG.DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS[mode] },
        { role: 'user', content: userMsg }
      ],
      temperature: mode === 'differ' ? 0.9 : 0.3,
      max_tokens: 1600,
      response_format: { type: 'json_object' }
    }),
    signal: controller.signal
  }).then(function (resp) {
    clearTimeout(timer);
    if (!resp.ok) {
      // 透传状态码便于 UI 区分配额/鉴权问题
      throw new Error('http_' + resp.status);
    }
    return resp.json();
  }).then(function (data) {
    var text = data && data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content;
    return validate(mode, extractJson(text));
  }).catch(function (err) {
    clearTimeout(timer);
    throw err;
  });
}

// ---------- 对外入口 ----------
// 从 Claim 生成检索查询：截断到 60 字符，去掉引号等噪声
function buildQuery(claim) {
  return String(claim || '')
    .replace(/[「」『』""''《》]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}
// V2.5：溯源候选压缩为注入 prompt 的文本块（含排序/类型/一手性/whyText）
// search_advise §20：每条带编号 E1/E2/...，LLM 的 evidences[].evidenceId 必须引用这些编号
function formatV25EvidenceForPrompt(v25) {
  if (!v25 || !Array.isArray(v25.candidates) || !v25.candidates.length) return '';
  var lines = ['【溯源检索结果（按可信度排序，前 5；E 编号 = 证据 ID，结论必须绑定这些编号）】'];
  v25.candidates.slice(0, 5).forEach(function (it, i) {
    var a = it.sourceAnalysis || {};
    lines.push('E' + (i + 1) + '.[' + (a.sourceType || 'other') + '|' +
      (a.originality === 'original' ? '一手' : it.suspectedSyndication ? '疑似转载' : '二手') +
      '|score=' + it.scoreTotal + '] ' + (it.title || '') + ' ' + (it.url || '') + '：' +
      String(it.snippet || '').slice(0, 100));
  });
  return lines.join('\n');
}
function formatSourcesForPrompt(sources) {
  if (!sources || (!sources.zhihu.length && !sources.global.length)) return '';
  var lines = ['【联网检索结果（知乎开放平台）】'];
  sources.zhihu.slice(0, 4).forEach(function (it, i) {
    lines.push((i + 1) + '.[知乎|' + it.sourceType + '|' + it.author + '] ' + it.title + '：' + it.snippet.slice(0, 120));
  });
  sources.global.slice(0, 4).forEach(function (it, i) {
    lines.push((i + 1) + '.[全网|' + it.author + '] ' + it.title + '：' + it.snippet.slice(0, 120));
  });
  lines.push('核查时应优先依据以上检索结果；若与你的内部知识冲突，以检索结果为准并指出冲突。');
  return lines.join('\n');
}

// ---------- Phase 7：数据数字标记（用于结论数字与证据数字的确定性核对） ----------
// 只认"带数据单位"的数字（35% / 3.5万亿 / 37人），避免把年份等误当数据结论。
var DATA_TOKEN_RE = /\d+(?:\.\d+)?\s*(?:%|‰|万亿|亿|万|美元|元|人|名|起|例|次|辆|架|艘|吨|户|家|公里|千克)/g;
function collectEvidenceTokens(evidences) {
  var pool = [];
  function push(text) {
    var m; var re = DATA_TOKEN_RE;
    re.lastIndex = 0;
    var s = String(text || '');
    while ((m = re.exec(s)) !== null) pool.push(m[0].replace(/\s+/g, ''));
  }
  (evidences || []).forEach(function (ev) {
    (ev.numbers || []).forEach(function (n) { push(String(n.value || '') + (n.unit || '')); });
    push(ev.quote);
  });
  return pool;
}
function extractClaimedDataTokens(text) {
  var out = []; var seen = {};
  var m; var re = DATA_TOKEN_RE;
  re.lastIndex = 0;
  var s = String(text || '');
  while ((m = re.exec(s)) !== null && out.length < 8) {
    var tok = m[0].replace(/\s+/g, '');
    if (!seen[tok]) { seen[tok] = true; out.push(tok); }
  }
  return out;
}

// analyze(mode, payload, opts) -> Promise<result>
// result: { mode, result, cached, sources?, verified }
// opts.onStage（V3.0 M0）：分析阶段直播回调（透传至 verifyClaimV25 等）
// V2.0 N5 双模式分离：本入口是「主动询问」链路（用户选中/Hover 点击），
// 允许深入语义判断；「自动扫描」走 claim-detector（只发现+分类+定位，不验证）。
// differ 模式额外注入真实不同立场来源（N4），禁止 AI 编造。
function analyze(mode, payload, opts) {
  opts = opts || {};
  var onStage = (typeof opts.onStage === 'function') ? opts.onStage : null;
  if (!SYSTEM_PROMPTS[mode]) return Promise.reject(new Error('unknown_mode'));
  var key = cacheKey(mode, String(payload.selectedText || ''), payload.url);
  return cacheGet(key).then(function (hit) {
    if (hit) return { mode: mode, result: hit.result, cached: true, sources: hit.sources, verified: hit.verified };
    // differ 模式：先挖真实对立观点，作为 differSources 注入 prompt（§10）
    var differPrep = (mode === 'differ' && WCC_SEARCH_CONTROLLER && WCC_SEARCH_CONTROLLER.searchForClaim)
      ? WCC_SEARCH_CONTROLLER.searchForClaim({ text: payload.selectedText, sourceRequirement: 'any' })
          .then(function (sr) { return sr.candidates.length ? WCC_VERIFY_ENGINE.discoverDifferViewpoints({ text: payload.selectedText }, sr.candidates) : { found: false, viewpoints: [] }; })
          .then(function (d) {
            if (!d.viewpoints.length) return '';
            var lines = ['【系统检索到的真实不同观点（必须优先基于这些作答，禁止编造）】'];
            d.viewpoints.forEach(function (v, i) {
              lines.push((i + 1) + '. ' + v.viewpoint + '（来源: ' + v.title + ' ' + v.url + '；原文片段:「' + v.quote + '」）');
            });
            return lines.join('\n');
          }).catch(function () { return ''; })
      : Promise.resolve('');
    var query = buildQuery(payload.selectedText);
    // V2.5：truth 模式走完整溯源管线（verifyClaimV25）；其他模式维持知乎双通道
    // V2.5 修复：sourceRequirement 与 objectType 是两套枚举，原样传递，
    // 由 query-analyzer 的 REQUIREMENT_TO_TYPE 映射（此前误当 objectType 导致 media→fact→单路知乎）
    var prep = (mode === 'truth' && global.WCC_V25)
      ? global.WCC_V25.verifyClaimV25(
          { text: payload.selectedText, sourceRequirement: payload.__sourceRequirement || 'any', id: payload.__claimId },
          // upgrade.md §5：Context Extraction 输入（页面上下文，供 Evidence Targeting 使用）
          { context: { title: payload.title || '', url: payload.url || '', paragraph: payload.selectedText || '', surroundingText: '' } },
          onStage // V3.0 M0：真实管线阶段直播
        ).then(function (v) {
          // upgrade.md §32/§31：主体歧义 / 硬校验未通过 → 提示合成层保守作答
          var caution = '';
          if (v && v.binding) {
            if (v.binding.ambiguity) {
              caution = '【注意】主体-事件绑定状态为 ' + (v.binding.entityResolutionStatus || 'AMBIGUOUS') +
                '（存在歧义）。若无证据明确区分身份，supportLevel 不得为 supported。';
            } else if (v.binding.hardValidation && !v.binding.hardValidation.passed) {
              caution = '【注意】证据硬校验未全部通过。结论必须保守：无证据支持的部分不得断言为已核实（supportLevel 优先 insufficient）。';
            }
          }
          // Phase 6：动态/时效声明 → 成稿必须带时间限定（"截至[时间]"），不得输出无时间截面的绝对结论
          var vstrat = v && v.strategy;
          if (vstrat && vstrat.temporalMode && vstrat.temporalMode !== 'historical' && vstrat.temporalMode !== 'timeless') {
            var ref = vstrat.referenceTime || '';
            caution = (caution ? caution + '\n' : '') + '【注意】该声明涉及动态/时效性数据' +
              (ref ? '（声明指向截至 ' + ref + ' 的状态）' : '') +
              '。若结论涉及数字或状态，必须以"截至[来源发布时间或检索时间]"限定时间截面，并说明数字对应的时间点；不得输出无时间限定的绝对结论。';
          }
          return { v25: v, sources: null, extra: caution };
        }).catch(function () { return { v25: null, sources: null, extra: '' }; })
      : Promise.all([
        (WCC_DATASOURCE && WCC_DATASOURCE.isAvailable() && query.length >= 4)
          ? WCC_DATASOURCE.searchBoth(query).catch(function () { return null; })
          : Promise.resolve(null),
        differPrep
      ]).then(function (r) { return { sources: r[0], extra: r[1] }; });
    return prep.then(function (r) {
      var sources = r.sources;
      var extra = r.extra;
      var v25 = r.v25 || null;
      var contextText = [formatSourcesForPrompt(sources), extra,
        v25 && v25.candidates ? formatV25EvidenceForPrompt(v25) : ''].filter(Boolean).join('\n\n');
      return callDeepseek(mode, payload, contextText).catch(function (err) {
        if (String(err.message).indexOf('missing_fields') === 0 ||
            err.message === 'unbalanced_json' || err.message === 'no_json_in_response') {
          return callDeepseek(mode, payload, contextText);
        }
        throw err;
      }).then(function (parsed) {
        // search_advise §20/§22：Evidence-Grounded 硬校验——
        // 检索没有可用来源（v25 候选为空 且 知乎来源为空）时，
        // 禁止 LLM 凭训练知识输出"已核实"结论：supported/partial 一律降级 insufficient。
        var hasRetrievedEvidence = !!(v25 && v25.candidates && v25.candidates.length) ||
          !!(sources && ((sources.zhihu && sources.zhihu.length) || (sources.global && sources.global.length)));
        if (mode === 'truth' && !hasRetrievedEvidence && parsed.supportLevel &&
            parsed.supportLevel !== 'insufficient' && parsed.supportLevel !== 'unsupported' && parsed.supportLevel !== 'opinion') {
          parsed.supportLevel = 'insufficient';
          parsed.summary = String(parsed.summary || '') + '（检索未返回可核实的来源，已自动降级为证据不足）';
          if (!Array.isArray(parsed.evidences)) parsed.evidences = [];
        }
        // §20.1：LLM 声称 supported/partial 但 evidences 未绑定任何检索编号 → 也降级
        if (mode === 'truth' && hasRetrievedEvidence && (parsed.supportLevel === 'supported' || parsed.supportLevel === 'partial')) {
          var evs = Array.isArray(parsed.evidences) ? parsed.evidences : [];
          var bound = evs.some(function (ev) { return ev && typeof ev.evidenceId === 'string' && /^E\d+$/.test(ev.evidenceId); });
          if (!bound) {
            parsed.supportLevel = 'partial';
            parsed.summary = String(parsed.summary || '') + '（结论未逐条绑定检索来源编号，已降级为部分支持）';
          }
        }
        // Phase 7：结论声称的数据数字必须能在已绑定证据中找到（确定性核对）。
        // 声称了数字但在任何证据的 numbers/quote 里都找不到 → 保守处理：supported 降 partial 并加注。
        if (mode === 'truth' && parsed.supportLevel && parsed.supportLevel !== 'insufficient' &&
            parsed.supportLevel !== 'unsupported' && v25 && v25.evidences && v25.evidences.length) {
          var pool = collectEvidenceTokens(v25.evidences);
          var claimedNums = extractClaimedDataTokens(String(parsed.summary || ''));
          var missingNums = claimedNums.filter(function (tok) { return pool.indexOf(tok) < 0; });
          if (claimedNums.length && missingNums.length) {
            parsed.summary = String(parsed.summary || '') + '（结论中的数字 ' + missingNums.slice(0, 4).join('/') + ' 未在已绑定证据原文中找到，已保守处理）';
            if (parsed.supportLevel === 'supported') parsed.supportLevel = 'partial';
          }
        }
        var verifiedSources = hasRetrievedEvidence;
        var entry = { result: parsed, at: Date.now(), sources: sources, verified: verifiedSources, verification: v25 };
        cacheSet(key, entry);
        return { mode: mode, result: parsed, cached: false, sources: sources, verified: verifiedSources, verification: v25 };
      });
    });
  });
}

global.WCC_ANALYZER = {
  analyze: analyze,
  isConfigured: function () { return isLlmAvailable(); },
  _phase7: { extractClaimedDataTokens: extractClaimedDataTokens, collectEvidenceTokens: collectEvidenceTokens }
};
})(typeof globalThis !== 'undefined' ? globalThis : self);