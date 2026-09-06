// Evidence Targeting Layer（upgrade.md §10~§13 / §31~§32 / §35，P0 + Phase1/3）
// 搜索前决策：Context → Claim 分类 → Entity/Event 检测与解析状态 → Evidence Target → Search Strategy。
// 原则（upgrade.md 41-1）：先确定"找什么"，再搜索；禁止为生成答案强行绑定（AMBIGUOUS 允许存在）。
// 显式来源提取为纯规则（§14），LLM 只负责分类与目标判定（失败时全部规则兜底，零依赖可用）。
// 双模式：代理模式（PROXY）请求经 CF Worker 中转，密钥不出服务器；直连模式保留为本地开发后门。
(function (global) {
'use strict';
var CONFIG = global.QIUZHEN_CONFIG || null;

// ---------- 代理模式（与 datasource.js 一致） ----------
function isProxy() { return !!(CONFIG && CONFIG.PROXY_ENABLED === true && CONFIG.PROXY_BASE_URL); }
function isLlmAvailable() { return isProxy() || !!(CONFIG && CONFIG.DEEPSEEK_API_KEY); }
function llmRequestParts() {
  if (isProxy()) {
    return { url: CONFIG.PROXY_BASE_URL + '/v1/chat/completions', auth: WCC_AUTH && WCC_AUTH.proxyAuthHeader ? WCC_AUTH.proxyAuthHeader() : '' };
  }
  return { url: CONFIG.DEEPSEEK_BASE_URL + '/chat/completions', auth: 'Bearer ' + CONFIG.DEEPSEEK_API_KEY };
}

var TIMEOUT_MS = 15000;

var CLAIM_TYPES = [
  'PERSON', 'PERSON_EVENT', 'EVENT', 'PRODUCT', 'COMPANY', 'POLICY',
  'STATISTICS', 'ACADEMIC', 'ORIGINAL_REPORT', 'OFFICIAL_DOCUMENT', 'DATASET'
];
var TARGET_TYPES = [
  'EXACT_ENTITY', 'ENTITY_EVENT', 'EXACT_PAPER', 'ORIGINAL_REPORT',
  'OFFICIAL_DOCUMENT', 'OFFICIAL_PRODUCT', 'PRIMARY_DATA', 'DATASET', 'SECONDARY_CORROBORATION'
];
var STRATEGIES = [
  'EXACT_SOURCE', 'PREFERRED_SOURCE', 'IDENTIFIER_SEARCH',
  'SEMANTIC_SEARCH', 'BROAD_CORROBORATION', 'PROVENANCE_SEARCH'
];
var RESOLUTION_STATUS = ['RESOLVED', 'AMBIGUOUS', 'UNRESOLVED'];

// ---------- §14 Explicit Source / Link Extraction（规则式，零 LLM） ----------
// 从页面上下文提取：URL / DOI / arXiv / PubMed ID（Level 0~2）
// level: 0=直接链接（最高优先），2=唯一标识（DOI/ID）
function extractExplicitSources(context) {
  var sources = [];
  var seen = {};
  function push(kind, value, level) {
    value = String(value || '').trim().replace(/[)]}>，。；;、,]+$/, '');
    if (!value || seen[kind + '|' + value]) return;
    seen[kind + '|' + value] = true;
    sources.push({ kind: kind, value: value, level: level });
  }
  var text = String(context || '').replace(/[\r\n\t]+/g, ' ');
  if (!text) return sources;
  var m;
  var urlRe = /https?:\/\/[^\s<>"']+/g;
  while ((m = urlRe.exec(text)) !== null && sources.length < 8) {
    push('URL', m[0], 0);
  }
  var doiRe = /\b10\.\d{4,9}\/[-._;()\/:A-Za-z0-9]+/g;
  while ((m = doiRe.exec(text)) !== null && sources.length < 8) {
    push('DOI', m[0], 2);
  }
  var arxivRe = /\barXiv\s*[:#]?\s*(\d{4}\.\d{4,5})(?:v\d+)?/gi;
  while ((m = arxivRe.exec(text)) !== null && sources.length < 8) {
    push('ARXIV', m[1], 2);
  }
  var pmRe = /\b(?:PMID|PubMed)\s*[:#]?\s*(\d{5,9})\b/gi;
  while ((m = pmRe.exec(text)) !== null && sources.length < 8) {
    push('PMID', m[1], 2);
  }
  return sources;
}

// ---------- §14 超链接形式来源（upgrade.md：论文以 <a href> 嵌入页面，需从 HTML 锚点提取） ----------
// classifyLink(href)：把链接 URL 分类为 DOI/ARXIV/PMID/URL
function classifyLink(href) {
  var h = String(href || '').toLowerCase();
  var m;
  if ((m = h.match(/doi\.org\/(10\.\d{4,9}\/[^\s?#]+)/))) return { kind: 'DOI', value: m[1] };
  if ((m = h.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/))) return { kind: 'ARXIV', value: m[1] };
  if ((m = h.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/))) return { kind: 'PMID', value: m[1] };
  if (/^https?:\/\//.test(h)) return { kind: 'URL', value: String(href).trim() };
  return null;
}

// 从页面 HTML 提取超链接形式的显式来源（锚文本即论文标题提示）
// 站内导航/社交/搜索链接视为噪声，不作为显式来源（论文链接不会指向这些）
var LINK_NOISE = /zhihu\.com\/(question|answer|people|search|topic|hot|creators)|\.baidu\.com|bilibili\.com|weibo\.com|weixin\.qq\.com|douban\.com|#|javascript:/;
function extractExplicitSourcesFromHtml(html) {
  var links = [];
  if (global.WCC_WEB_READER && global.WCC_WEB_READER.extractLinks) {
    links = global.WCC_WEB_READER.extractLinks(html || '');
  }
  var sources = [];
  var have = {};
  links.forEach(function (l) {
    if (sources.length >= 8) return;
    var cls = classifyLink(l.href);
    if (!cls) return;
    if (cls.kind === 'URL' && LINK_NOISE.test(String(l.href))) return; // 只对普通 URL 做噪声过滤
    var key = cls.kind + '|' + cls.value;
    if (have[key]) return;
    have[key] = true;
    var s = { kind: cls.kind, value: cls.value, level: cls.kind === 'URL' ? 0 : 2, source: 'page_link' };
    var txt = String(l.text || '').trim();
    if (txt.length >= 2) s.anchorText = txt.slice(0, 120);
    sources.push(s);
  });
  return sources;
}

// 把页面级显式来源并入 evidenceTarget（去重；含任一命中即 directSourceAvailable=true）
function mergeExplicitSources(et, pageText, htmlLinkSources) {
  et = et || {};
  var existing = et.explicitSources || [];
  var have = {};
  existing.forEach(function (s) { have[s.kind + '|' + s.value] = true; });
  var added = [];
  (htmlLinkSources || []).forEach(function (s) {
    var key = s.kind + '|' + s.value;
    if (have[key] || added.length >= 8) return;
    have[key] = true;
    added.push(s);
  });
  var textSources = extractExplicitSources(pageText || '');
  textSources.forEach(function (s) {
    var key = s.kind + '|' + s.value;
    if (have[key] || added.length >= 8) return;
    have[key] = true;
    s.source = 'page_text';
    added.push(s);
  });
  if (added.length) {
    et.explicitSources = existing.concat(added).slice(0, 8);
    et.directSourceAvailable = true;
  }
  return et;
}

// ---------- §7 Claim Classification（规则兜底） ----------
// 顺序敏感：PERSON_EVENT（人物表态）必须先于 PRODUCT/COMPANY（"朱女士…某产品"是人物事件，不是产品问题）
function ruleClaimType(claimText) {
  var t = String(claimText || '');
  if (/《[^》]{4,60}》|论文|研究|doi\s*[:：]|arxiv|期刊|学术|发表于/.test(t)) return 'ACADEMIC';
  if (/数据集|数据库|dataset|开放数据/.test(t)) return 'DATASET';
  if (/统计|数据|人口|GDP|增速|增长|下降|%|万亿|亿|万元/.test(t)) return 'STATISTICS';
  if (/政策|规定|办法|条例|通知|意见|政府|部委|印发|发布/.test(t)) return 'OFFICIAL_DOCUMENT';
  if (/(女士|先生|教授|医生|CEO|创始人|董事长|发言人|记者)/.test(t) && /(表示|称|认为|指出|宣布|透露)/.test(t)) return 'PERSON_EVENT';
  if (/(女士|先生)/.test(t)) return 'PERSON';
  if (/产品|车型|配置|参数|售价|版本|规格|上市/.test(t)) return 'PRODUCT';
  if (/公司|企业|集团|品牌|财报|营收/.test(t)) return 'COMPANY';
  if (/采访|独家|首发|通讯社|援引/.test(t)) return 'ORIGINAL_REPORT';
  if (/事故|发射|坠毁|袭击|战争|峰会|宣布|事件/.test(t)) return 'EVENT';
  return 'EVENT';
}

// ---------- §11/§12 Evidence Target（规则版，映射到优先来源） ----------
function ruleEvidenceTarget(claimType, explicitSources) {
  if (claimType === 'ACADEMIC') return { type: 'EXACT_PAPER', preferredSources: ['paper', 'acad'], strategy: 'EXACT_SOURCE' };
  if (claimType === 'OFFICIAL_DOCUMENT' || claimType === 'POLICY') return { type: 'OFFICIAL_DOCUMENT', preferredSources: ['gov'], strategy: 'PREFERRED_SOURCE' };
  if (claimType === 'STATISTICS' || claimType === 'DATASET') return { type: 'PRIMARY_DATA', preferredSources: ['gov', 'paper'], strategy: 'PREFERRED_SOURCE' };
  if (claimType === 'PRODUCT') return { type: 'OFFICIAL_PRODUCT', preferredSources: ['biz'], strategy: 'PREFERRED_SOURCE' };
  if (claimType === 'PERSON' || claimType === 'PERSON_EVENT') return { type: 'ENTITY_EVENT', preferredSources: ['media', 'org'], strategy: 'IDENTIFIER_SEARCH' };
  if (claimType === 'ORIGINAL_REPORT') return { type: 'ORIGINAL_REPORT', preferredSources: ['media'], strategy: 'PROVENANCE_SEARCH' };
  if (claimType === 'COMPANY') return { type: 'EXACT_ENTITY', preferredSources: ['biz', 'media'], strategy: 'IDENTIFIER_SEARCH' };
  return { type: 'SECONDARY_CORROBORATION', preferredSources: ['media', 'gov'], strategy: 'BROAD_CORROBORATION' };
}

// ---------- §8 Entity–Event 解析状态（规则兜底） ----------
// 匿名人物（朱女士/某公司 等）→ AMBIGUOUS；有具体全名或机构语境 → RESOLVED；无法判断 → UNRESOLVED
function ruleEntityResolution(claimText) {
  var t = String(claimText || '');
  if (/(某[女士先生人公司机构]|女士|先生)/.test(t)) {
    // 有全名线索（如 "朱某某"）且带机构 → 仍可能歧义；保守处理：匿名即 AMBIGUOUS
    if (/[\u4e00-\u9fa5]{2,3}(女士|先生)/.test(t) && !/(某)/.test(t)) return 'RESOLVED';
    return 'AMBIGUOUS';
  }
  if (/(NASA|WHO|联合国|国家统计局|国务院|最高法|最高检|央行|中科院)/.test(t)) return 'RESOLVED';
  return 'UNRESOLVED';
}

// ---------- LLM 分析（1 次调用，失败/无凭证 → 规则） ----------
var SYSTEM_PROMPT = [
  '你是证据目标分析器。用户给你一条待验证的声明（claim）与页面上下文。',
  '请在【搜索之前】输出证据目标 JSON：',
  '- claimType: PERSON/PERSON_EVENT/EVENT/PRODUCT/COMPANY/POLICY/STATISTICS/ACADEMIC/ORIGINAL_REPORT/OFFICIAL_DOCUMENT/DATASET',
  '- entities: 声明中的核心主体数组（最多3个），每项 { "name": "...", "type": "PERSON|ORG|PRODUCT|EVENT" }',
  '  （匿名人物如 "朱女士" 也必须列出，不得跳过）',
  '- eventHints: 与主体相关的事件线索数组（如 ["停止生产"]）',
  '- targetType: EXACT_ENTITY/ENTITY_EVENT/EXACT_PAPER/ORIGINAL_REPORT/OFFICIAL_DOCUMENT/OFFICIAL_PRODUCT/PRIMARY_DATA/DATASET/SECONDARY_CORROBORATION',
  '- entityResolutionStatus: RESOLVED(有充分上下文可唯一确定)/AMBIGUOUS(存在多个合理候选)/UNRESOLVED(信息不足)',
  '- preferredSources: 优先来源类型数组（gov/acad/paper/media/org/biz/zhihu/other）',
  '- searchStrategy: EXACT_SOURCE(页面已给原文链接，直接验证)/PREFERRED_SOURCE/IDENTIFIER_SEARCH/SEMANTIC_SEARCH/BROAD_CORROBORATION/PROVENANCE_SEARCH',
  '',
  '原则：不得在无证据情况下强行确定匿名人物身份；无法区分时 entityResolutionStatus 必须为 AMBIGUOUS。',
  '只输出 JSON：{ "claimType": "PERSON_EVENT", "entities":[{"name": "朱女士", "type": "PERSON"}], "eventHints":["停止生产"], "targetType": "ENTITY_EVENT", "entityResolutionStatus": "AMBIGUOUS", "preferredSources":["media", "org"], "searchStrategy": "IDENTIFIER_SEARCH" }'
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

function callLLM(userContent) {
  var body = {
    model: CONFIG.DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 600
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

function sanitize(raw, claimText) {
  raw = raw || {};
  var claimType = CLAIM_TYPES.indexOf(raw.claimType) >= 0 ? raw.claimType : ruleClaimType(claimText);
  var entities = Array.isArray(raw.entities) ? raw.entities.slice(0, 3).map(function (e) {
    return { name: String((e && e.name) || '').slice(0, 40), type: String((e && e.type) || 'PERSON').toUpperCase().slice(0, 12) };
  }).filter(function (e) { return e.name; }) : [];
  var targetType = TARGET_TYPES.indexOf(raw.targetType) >= 0 ? raw.targetType : ruleEvidenceTarget(claimType, []).type;
  var status = RESOLUTION_STATUS.indexOf(raw.entityResolutionStatus) >= 0 ? raw.entityResolutionStatus : ruleEntityResolution(claimText);
  return {
    claimType: claimType,
    entities: entities,
    eventHints: Array.isArray(raw.eventHints) ? raw.eventHints.map(String).slice(0, 4) : [],
    targetType: targetType,
    entityResolutionStatus: status,
    ambiguity: status === 'AMBIGUOUS' || status === 'UNRESOLVED',
    preferredSources: Array.isArray(raw.preferredSources) && raw.preferredSources.length
      ? raw.preferredSources.map(String).slice(0, 4)
      : ruleEvidenceTarget(claimType, []).preferredSources,
    searchStrategy: STRATEGIES.indexOf(raw.searchStrategy) >= 0 ? raw.searchStrategy : ruleEvidenceTarget(claimType, []).strategy,
    viaFallback: false
  };
}

// ---------- 主入口 ----------
// analyze(claim, context) -> Promise<evidenceTarget>
// claim: {text}; context: {title, url, paragraph, surroundingText}
function analyze(claim, context) {
  var claimText = String((claim && claim.text) || '');
  context = context || {};
  var ctxText = [context.title, context.url, context.paragraph, context.surroundingText].filter(Boolean).join('\n');
  var explicitSources = extractExplicitSources(ctxText);
  function finish(raw) {
    var et = sanitize(raw, claimText);
    et.claim = claimText;
    et.explicitSources = explicitSources;
    et.directSourceAvailable = explicitSources.length > 0;
    // 目标类型覆盖：显式来源存在且 ACADEMIC → EXACT_SOURCE 策略
    if (et.directSourceAvailable && (et.claimType === 'ACADEMIC' || et.targetType === 'EXACT_PAPER')) {
      et.searchStrategy = 'EXACT_SOURCE';
      et.targetType = 'EXACT_PAPER';
    }
    // Entity 补全：规则表实体并入（带官方域，供官方定向步复用）
    if (global.WCC_QUERY_ANALYZER && global.WCC_QUERY_ANALYZER.detectEntities) {
      var ruleEnts = global.WCC_QUERY_ANALYZER.detectEntities(claimText);
      var names = {};
      et.entities.forEach(function (e) { names[e.name] = true; });
      ruleEnts.forEach(function (e) { if (!names[e.name]) { names[e.name] = true; et.entities.push(e); } });
      et.entities = et.entities.slice(0, 3);
    }
    return et;
  }
  if (!isLlmAvailable()) {
    var r = finish(null);
    r.viaFallback = true;
    return Promise.resolve(r);
  }
  var userContent = '【声明】' + claimText + '\n\n【页面上下文】\n' + ctxText.slice(0, 1500);
  return callLLM(userContent).then(finish).catch(function () {
    var r = finish(null);
    r.viaFallback = true;
    return r;
  });
}

// ---------- §30/§31/§35 Binding + Hard Validation（确定性） ----------
// buildBinding(verification, evidenceTarget, candidates) -> binding
function buildBinding(verification, et, candidates) {
  et = et || {};
  candidates = candidates || [];
  var verdict = verification && verification.verdict;
  var judged = (verification && verification.evidences) || [];
  var explicitUsed = candidates.some(function (c) { return c.isExplicit && c.content; }) ||
                     judged.some(function (e) { return e.isExplicit; });
  var paperOk = true, paperCheck = 'not_applicable';
  if (et.claimType === 'ACADEMIC' && et.explicitSources && et.explicitSources.length) {
    var targets = candidates.filter(function (c) { return c.paperStatus === 'TARGET_PAPER'; });
    paperOk = targets.length > 0 || et.explicitSources.every(function (s) { return s.kind === 'URL'; });
    paperCheck = paperOk ? 'target_paper_found' : 'no_target_paper';
  }
  var checks = [
    { id: 'claim_clear', passed: !!(et.claim && et.claim.trim().length > 0), detail: '声明明确' },
    { id: 'candidates_found', passed: candidates.length > 0, detail: '检索到 ' + candidates.length + ' 个候选' },
    { id: 'evidence_supports', passed: verdict === 'supported' || verdict === 'partial', detail: 'verdict=' + (verdict || 'none') },
    { id: 'explicit_source_used', passed: !et.directSourceAvailable || explicitUsed, detail: et.directSourceAvailable ? (explicitUsed ? '已优先验证显式来源' : '显式来源未用') : '无显式来源' },
    { id: 'academic_target', passed: paperOk, detail: paperCheck },
    { id: 'entity_resolution', passed: et.entityResolutionStatus !== 'AMBIGUOUS', detail: et.entityResolutionStatus || 'unknown' }
  ];
  var passed = checks.filter(function (c) { return !c.passed; }).length === 0;
  return {
    bindingStatus: (verdict === 'supported' || verdict === 'partial') ? 'BOUND' : 'UNBOUND',
    target: {
      entity: (et.entities && et.entities[0] && et.entities[0].name) || null,
      event: (et.eventHints && et.eventHints[0]) || null
    },
    entityResolutionStatus: et.entityResolutionStatus || 'UNRESOLVED',
    directSourceAvailable: !!et.directSourceAvailable,
    directSourceUsed: !!explicitUsed,
    paperStatus: paperCheck,
    hardValidation: { passed: passed, checks: checks },
    ambiguity: et.entityResolutionStatus === 'AMBIGUOUS' || et.entityResolutionStatus === 'UNRESOLVED' || !!et.ambiguity
  };
}

global.WCC_EVIDENCE_TARGET = {
  analyze: analyze,
  extractExplicitSources: extractExplicitSources,
  extractExplicitSourcesFromHtml: extractExplicitSourcesFromHtml,
  mergeExplicitSources: mergeExplicitSources,
  classifyLink: classifyLink,
  ruleClaimType: ruleClaimType,
  ruleEvidenceTarget: ruleEvidenceTarget,
  ruleEntityResolution: ruleEntityResolution,
  buildBinding: buildBinding,
  CLAIM_TYPES: CLAIM_TYPES,
  TARGET_TYPES: TARGET_TYPES,
  STRATEGIES: STRATEGIES,
  RESOLUTION_STATUS: RESOLUTION_STATUS
};
})(typeof globalThis !== 'undefined' ? globalThis : self);