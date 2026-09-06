// Query Analyzer（V2.5 M0）：Claim → 问题类型 → 搜索策略。
// 升级要求 §1/§11：根据问题类型决定 关键词/来源类型/时间要求/搜索预算/是否双引擎。
// TQ1：一次轻量 LLM 调用输出完整策略 JSON；LLM 失败时按 claim.objectType 走确定性规则兜底。
(function (global) {
'use strict';
var CONFIG = global.QIUZHEN_CONFIG;

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

var TIMEOUT_MS = 15000;

// ---------- 问题类型 → 策略的静态映射（兜底 + LLM 结果校验用） ----------
// questionType: fact(事实查询) / academic(学术) / policy(政策) / event(时事事件) /
//               data(数据核实) / open(开放研究)
// V2.5 修复：fact 不再单路知乎——双核召回（Exa+Metaso）由 v25-pipeline 的 buildPlan 统一编排（search_advise §5.1）
var TYPE_STRATEGY = {
  fact:     { engines: ['metaso', 'zhihu_global'], preferredSources: ['gov', 'media'], timeWindow: null,  budget: 2, dualEngine: false },
  academic: { engines: ['zhihu_global', 'exa'], preferredSources: ['acad', 'paper'], timeWindow: '5y', budget: 2, dualEngine: true },
  policy:   { engines: ['metaso', 'zhihu_global'], preferredSources: ['gov'],      timeWindow: '3y', budget: 2, dualEngine: true },
  event:    { engines: ['metaso', 'zhihu_global'], preferredSources: ['media'],    timeWindow: '1y', budget: 2, dualEngine: true },
  data:     { engines: ['metaso', 'zhihu_global'], preferredSources: ['gov', 'paper', 'media'], timeWindow: '5y', budget: 2, dualEngine: true },
  open:     { engines: ['metaso', 'exa'],          preferredSources: [],           timeWindow: null, budget: 3, dualEngine: true }
};
// claim.objectType → questionType 的静态兜底映射（TQ1 规则兜底）
var OBJECT_TO_TYPE = {
  fact: 'fact', data: 'data', research_report: 'academic', paper: 'academic',
  gov_document: 'policy', org_info: 'fact', media_report: 'event',
  person_event: 'event', opinion: 'open', rhetoric: 'open', plain: 'fact'
};

// ---------- 实体 → 官方域名表（search_advise §3.3 / §24：官方源 Query 不靠模型猜域名） ----------
// 命中即生成 { name, en, domains }；domains 用于 site: 约束与 Exa includeDomains。
var ENTITY_OFFICIAL_DOMAINS = {
  'nasa': { en: 'NASA', domains: ['nasa.gov'] },
  '美国宇航局': { en: 'NASA', domains: ['nasa.gov'] },
  'who': { en: 'WHO', domains: ['who.int'] },
  '世界卫生组织': { en: 'WHO', domains: ['who.int'] },
  '世卫组织': { en: 'WHO', domains: ['who.int'] },
  'un': { en: 'UN', domains: ['un.org'] },
  '联合国': { en: 'United Nations', domains: ['un.org'] },
  'esa': { en: 'ESA', domains: ['esa.int'] },
  '欧洲航天局': { en: 'ESA', domains: ['esa.int'] },
  'fda': { en: 'FDA', domains: ['fda.gov'] },
  '美国食品药品监督管理局': { en: 'FDA', domains: ['fda.gov'] },
  'cdc': { en: 'CDC', domains: ['cdc.gov'] },
  'nih': { en: 'NIH', domains: ['nih.gov'] },
  'eu': { en: 'EU', domains: ['europa.eu'] },
  '欧盟': { en: 'European Union', domains: ['europa.eu'] },
  '国家统计局': { en: 'National Bureau of Statistics', domains: ['stats.gov.cn'] },
  '统计局': { en: 'statistics bureau', domains: ['stats.gov.cn'] },
  '全国人大': { en: 'NPC', domains: ['npc.gov.cn'] },
  '人大常委会': { en: 'NPC', domains: ['npc.gov.cn'] },
  '中国政府': { en: 'Chinese government', domains: ['gov.cn'] },
  '国务院': { en: 'State Council', domains: ['gov.cn'] },
  '最高法': { en: "Supreme People's Court", domains: ['court.gov.cn'] },
  '最高人民法院': { en: "Supreme People's Court", domains: ['court.gov.cn'] },
  '最高检': { en: "Supreme People's Procuratorate", domains: ['spp.gov.cn'] },
  '最高人民检察院': { en: "Supreme People's Procuratorate", domains: ['spp.gov.cn'] },
  '央行': { en: 'PBOC', domains: ['pbc.gov.cn'] },
  '中国人民银行': { en: 'PBOC', domains: ['pbc.gov.cn'] },
  '教育部': { en: 'Ministry of Education', domains: ['moe.gov.cn'] },
  '工信部': { en: 'MIIT', domains: ['miit.gov.cn'] },
  '财政部': { en: 'Ministry of Finance', domains: ['mof.gov.cn'] },
  '卫健委': { en: 'NHC', domains: ['nhc.gov.cn'] },
  '国家卫健委': { en: 'NHC', domains: ['nhc.gov.cn'] },
  '国家卫生健康委员会': { en: 'NHC', domains: ['nhc.gov.cn'] },
  '科技部': { en: 'MOST', domains: ['most.gov.cn'] },
  '中科院': { en: 'CAS', domains: ['cas.cn'] },
  '中国科学院': { en: 'CAS', domains: ['cas.cn'] }
};
// 从 claim 文本中检出已知实体（search_advise §3.1 实体识别，规则版；大小写不敏感）
function detectEntities(claimText) {
  var t = String(claimText || '').toLowerCase();
  var found = [];
  var seen = {};
  Object.keys(ENTITY_OFFICIAL_DOMAINS).forEach(function (key) {
    if (t.indexOf(key) >= 0 && !seen[key]) {
      seen[key] = true;
      found.push({ name: key, en: ENTITY_OFFICIAL_DOMAINS[key].en, domains: ENTITY_OFFICIAL_DOMAINS[key].domains });
    }
  });
  return found.slice(0, 3);
}
// 粗判问题地域范围（search_advise §10 Geographic Scope）：global/national/province/city/county/unknown
function detectScopeLevel(claimText, entities) {
  var t = String(claimText || '');
  if (/(全国|中国|国家|中央)/.test(t)) return 'national';
  if (/(全省|省级|自治区|直辖市)/.test(t)) return 'province';
  if (/(全市|市级|省会|[\u4e00-\u9fa5]{2}市)/.test(t)) return 'city';
  if (/(县|县域)/.test(t)) return 'county';
  // 实体里有国际机构域名 → global
  if (entities && entities.some(function (e) { return /\.(gov|int|org)$/.test((e.domains || [''])[0]) && !/\.cn$/.test((e.domains || [''])[0]); })) return 'global';
  if (/(全球|世界|国际|国外|美国|欧洲)/.test(t)) return 'global';
  return 'unknown';
}
// claim.sourceRequirement → questionType 映射（V2.5 修复：sourceRequirement 是
// claim-detector 的独立枚举 gov/acad/official/media/industry/corporate/community/any，
// 不能混用 OBJECT_TO_TYPE——此前误用导致 media→fact→单路知乎）
var REQUIREMENT_TO_TYPE = {
  gov: 'policy',        // 需要政府来源 → 政策类检索策略
  acad: 'academic',     // 需要科研/论文
  official: 'fact',     // 官方组织 → 事实查询（org 来源）
  media: 'event',       // 权威媒体 → 时事事件类（多引擎+1y 窗）
  industry: 'open',     // 行业媒体 → 开放研究（双引擎）
  corporate: 'fact',    // 企业官方
  community: 'open',    // 社区讨论 → 开放探索
  any: null             // 不限 → 走 LLM 判定或 objectType 映射
};
function validType(t) { return !!TYPE_STRATEGY[t]; }

// ---------- LLM 策略判定 ----------
var SYSTEM_PROMPT = [
  '你是搜索策略分析器。用户给你一条网页声明（claim）。',
  '请判断问题类型并输出搜索策略 JSON：',
  '- questionType: "fact"(事实查询，官方来源优先) / "academic"(学术问题，论文与研究机构优先) /',
  '  "policy"(政策问题，政府与监管机构优先) / "event"(时事事件) / "data"(数据核实) / "open"(开放研究)',
  '- keywords: 2~3 组中文搜索关键词数组（去口语化、含实体与数字）',
  '- keywordsEn: 当声明涉及国际实体/英文材料时给出 1~2 组英文搜索关键词，否则给空数组',
  '  （如 NASA 类问题必须给英文关键词，如 "NASA mission cancellation reason"）',
  '- entities: 声明中的核心主体数组（如 ["NASA"]，无则空数组）',
  '- scopeLevel: 问题涉及的地域范围：global/national/province/city/county/unknown',
  '  （如 "全国人口"=national，"某县"=county，"NASA"=global）',
  '- questionFocus: 问题真正要答案的点，一句短语（如 "颁布时间"/"人口数量"/"取消原因"），用于判断来源是否直接回答问题',
  '- preferredSources: 来源类型偏好数组，取值 gov/acad/paper/media/org/biz/zhihu/other',
  '- timeWindow: 时间要求，"1y"/"3y"/"5y" 或 null(不限)',
  '- temporalMode: 时间语义，取值 historical(历史事实)/current(当前状态)/recent(近期)/evolving(动态变化，如价格/死亡人数)/as_of(截至某时)/timeless(不随时间变化，如定律定义)',
  '- budget: 搜索预算 1~3（简单事实=1，需要多方印证=2，开放探索=3）',
  '- dualEngine: 是否需要双搜索引擎（广泛召回+语义召回），布尔值',
  '',
  '只输出 JSON：{ "questionType":"data", "keywords":["...", "..."], "keywordsEn":["..."], "entities":["..."], "scopeLevel":"national", "questionFocus":"人口数量", "preferredSources":["gov","paper"], "timeWindow":"5y", "temporalMode":"evolving", "budget":2, "dualEngine":true}'
].join('\n');

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
function callLLM(claimText) {
  var body = {
    model: CONFIG.DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: claimText }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 500
  };
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  var parts = llmRequestParts();
  return fetch(parts.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': parts.auth
    },
    body: JSON.stringify(body),
    signal: controller.signal
  }).then(function (res) {
    clearTimeout(timer);
    if (!res.ok) throw new Error('http_' + res.status);
    return res.json();
  }).then(function (data) {
    return extractJson(data.choices[0].message.content);
  }, function (err) {
    clearTimeout(timer);
    throw err;
  });
}

// ---------- LLM 输出校验 + 兜底字段填充 ----------
var SCOPE_LEVELS = ['global', 'national', 'province', 'city', 'county', 'unknown'];
// ---------- temporalMode（P0-4：时间语义，单点计算于 QA） ----------
// historical(历史事实) / current(当前状态) / recent(近期) / evolving(动态变化) / as_of(截至某时) / timeless(不随时间变化)
var TEMPORAL_MODES = ['historical', 'current', 'recent', 'evolving', 'as_of', 'timeless'];
function ruleTemporalMode(claimText) {
  var t = String(claimText || '');
  if (/截至|截止|as\s*of/i.test(t)) return 'as_of';
  if (/定律|定理|定义|原理|公式|常数|词义|概念/.test(t) && !/(上涨|下降|变化|增长|死亡|发布|出台|人数)/.test(t)) return 'timeless';
  if (/(死亡|受伤|失踪|遇难|伤亡|人数|计票|进展|损失|价格|汇率|股价|涨幅|跌幅|增长|下降|增加|减少)/.test(t)) return 'evolving';
  if (/(?:19|20)\d{2}年/.test(t) && !/(现在|目前|当前|近期|最近|最新)/.test(t)) return 'historical';
  if (/(现在|目前|当前|近期|最近|最新)/.test(t)) return 'current';
  return 'recent';
}
// 提取 as_of 声明的截至时间（"截至 2026-09-02" / "截止 8月30日"），供成稿时间限定使用
function extractAsOfDate(claimText) {
  var t = String(claimText || '');
  var m = t.match(/(?:截至|截止)\s*(?:北京时间)?\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}\s*年)/);
  if (m) return m[1].replace(/\s+/g, '');
  return null;
}
function sanitizeStrategy(raw, fallbackType, claimText) {
  var s = TYPE_STRATEGY[fallbackType];
  var out = {
    questionType: validType(raw && raw.questionType) ? raw.questionType : fallbackType
  };
  var base = TYPE_STRATEGY[out.questionType];
  out.keywords = Array.isArray(raw && raw.keywords) && raw.keywords.length
    ? raw.keywords.map(String).slice(0, 4)
    : null; // null → 调用方用 claim.text 原文作为关键词
  out.keywordsEn = Array.isArray(raw && raw.keywordsEn) && raw.keywordsEn.length
    ? raw.keywordsEn.map(String).slice(0, 2)
    : [];
  // 实体：LLM 给出的主体名 → 关联官方域名（来自 ENTITY_OFFICIAL_DOMAINS，模型不猜域名）
  var rawEntities = Array.isArray(raw && raw.entities) ? raw.entities.map(String).slice(0, 3) : [];
  out.entities = resolveEntities(rawEntities, claimText);
  out.scopeLevel = SCOPE_LEVELS.indexOf(raw && raw.scopeLevel) >= 0 ? raw.scopeLevel : detectScopeLevel(claimText, out.entities);
  out.questionFocus = typeof (raw && raw.questionFocus) === 'string' && raw.questionFocus.trim()
    ? raw.questionFocus.trim().slice(0, 20)
    : null;
  out.preferredSources = Array.isArray(raw && raw.preferredSources) && raw.preferredSources.length
    ? raw.preferredSources.map(String).slice(0, 4)
    : base.preferredSources;
  out.timeWindow = typeof (raw && raw.timeWindow) === 'string' ? raw.timeWindow : base.timeWindow;
  out.temporalMode = TEMPORAL_MODES.indexOf(raw && raw.temporalMode) >= 0 ? raw.temporalMode : ruleTemporalMode(claimText);
  // Phase 6：as_of / 动态声明的截至参考时间（仅记录，供成稿端做"截至[时间]"限定）
  out.referenceTime = (out.temporalMode === 'as_of') ? (extractAsOfDate(claimText) || null) : null;
  var b = Number(raw && raw.budget);
  out.budget = (b >= 1 && b <= 3) ? Math.round(b) : base.budget;
  out.dualEngine = typeof (raw && raw.dualEngine) === 'boolean' ? raw.dualEngine : base.dualEngine;
  return out;
}
// LLM 实体名 + 规则表交叉：只保留表内已知实体的官方域名（§3.3 原则：不信任模型自造域名）
function resolveEntities(llmNames, claimText) {
  var ruleEntities = detectEntities(claimText);
  var out = [];
  var seen = {};
  function push(e) {
    if (!e || seen[e.name]) return;
    seen[e.name] = true;
    out.push(e);
  }
  ruleEntities.forEach(push);                       // 规则表优先（带官方域名）
  (llmNames || []).forEach(function (n) {
    if (!n) return;
    var hit = ENTITY_OFFICIAL_DOMAINS[n.toLowerCase()] || ENTITY_OFFICIAL_DOMAINS[n];
    if (hit) push({ name: n, en: hit.en, domains: hit.domains });
    else push({ name: n, en: '', domains: [] });    // 表外实体：保留名字用于 Entity Match，无域名
  });
  return out.slice(0, 3);
}
function ruleFallback(claim) {
  // 兜底优先级：sourceRequirement（若提供且可映射）> objectType > fact
  var t = null;
  if (claim && claim.sourceRequirement && REQUIREMENT_TO_TYPE[claim.sourceRequirement]) {
    t = REQUIREMENT_TO_TYPE[claim.sourceRequirement];
  }
  if (!t) t = OBJECT_TO_TYPE[claim.objectType] || 'fact';
  var strategy = sanitizeStrategy(null, t, claim && claim.text);
  strategy.viaFallback = true;
  return strategy;
}

// ---------- Query 展开（search_advise §3 / §5：中 / 英 / 官方 三路 Query） ----------
// 返回 { zh: [...], en: [...], official: [{query, domain}] }
function buildQueries(strategy, claimText) {
  var zh = (strategy.keywords && strategy.keywords.length) ? strategy.keywords
    : [String(claimText || '').replace(/[「」『』""''《》"'（）()【】[]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)];
  var en = (strategy.keywordsEn && strategy.keywordsEn.length) ? strategy.keywordsEn : [];
  var official = [];
  (strategy.entities || []).forEach(function (e) {
    (e.domains || []).forEach(function (d) {
      var base = en[0] || zh[0] || String(claimText || '').slice(0, 60);
      official.push({ query: base + ' site:' + d, domain: d });
    });
  });
  return { zh: zh, en: en, official: official };
}

// ---------- 对外入口 ----------
// analyzeQuery(claim) -> Promise<strategy>
// claim 推荐携带：text（必需）、objectType、sourceRequirement（两者都传时映射更准）
// strategy: { questionType, keywords, preferredSources, timeWindow, budget, dualEngine, viaFallback? }
function analyzeQuery(claim) {
  if (!isLlmAvailable()) {
    return Promise.resolve(ruleFallback(claim)); // 无凭证 → 纯规则（仍可用）
  }
  return callLLM(claim.text).then(function (raw) {
    var fallbackT = null;
    if (claim.sourceRequirement && REQUIREMENT_TO_TYPE[claim.sourceRequirement]) {
      fallbackT = REQUIREMENT_TO_TYPE[claim.sourceRequirement];
    }
    if (!fallbackT) fallbackT = OBJECT_TO_TYPE[claim.objectType] || 'fact';
    var st = sanitizeStrategy(raw, fallbackT, claim.text);
    st.viaFallback = false;
    return st;
  }).catch(function () {
    return ruleFallback(claim); // LLM 失败/超时/解析失败 → 规则兜底
  });
}

global.WCC_QUERY_ANALYZER = {
  analyzeQuery: analyzeQuery,
  ruleFallback: ruleFallback,
  buildQueries: buildQueries,
  TYPE_STRATEGY: TYPE_STRATEGY,
  OBJECT_TO_TYPE: OBJECT_TO_TYPE,
  REQUIREMENT_TO_TYPE: REQUIREMENT_TO_TYPE,
  ENTITY_OFFICIAL_DOMAINS: ENTITY_OFFICIAL_DOMAINS,
  detectEntities: detectEntities,
  detectScopeLevel: detectScopeLevel,
  ruleTemporalMode: ruleTemporalMode,
  extractAsOfDate: extractAsOfDate,
  TEMPORAL_MODES: TEMPORAL_MODES
};
})(typeof globalThis !== 'undefined' ? globalThis : self);