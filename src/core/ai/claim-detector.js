// Claim Detection 管线 v2（V2.0 N0）：整篇文档句子 → LLM 批量分析 → Claim Index。
// V2.0 升级（v2.0_UPGRADE §2/§3/§4）：
//   1) 信息对象识别优先于主观/客观二分（11 类 objectType，§2）；
//   2) 「验证价值判断」取代「是否需要验证」（§3）：有溯源价值的才进 Claim Index；
//   3) 上下文 Claim（§4）：当前句 ± 前后文 + 所属段落联合判断；
//   4) 数据模型：{id, text, context, type, verifiable, objectType, sourceRequirement}。
// 职责边界不变：全文阶段只做「发现+分类+定位」，绝不验证、绝不搜索（TD4）。
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

var MAX_SENTENCES = 120;   // 截断策略沿用 VD1
var CHUNK_SIZE = 30;       // 每批句子数（v2 每句携带上下文，token 更大，批缩小）
var CONTEXT_RADIUS = 1;    // 上下文半径：前后各 1 句
var TIMEOUT_MS = 60000;
var PROMPT_VERSION = 'v2'; // 缓存键隔离：prompt 变更后旧缓存自动失效

// ---------- 缓存（内存 + storage.session 镜像） ----------
var CACHE_MAX = 30;
var cache = new Map();

function docFingerprint(documentPayload) {
  var sents = documentPayload.sentences || [];
  var head = '';
  for (var i = 0; i < Math.min(sents.length, 5); i++) head += sents[i].text;
  return PROMPT_VERSION + '|' + (documentPayload.doc.url || '') + '|' + sents.length + '|' + head.length;
}
function cacheGet(key) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return new Promise(function (resolve) {
    try {
      chrome.storage.session.get('claimIndexCache', function (data) {
        var m = (data && data.claimIndexCache) || {};
        resolve(m[key] || null);
      });
    } catch (e) { resolve(null); }
  });
}
function cacheSet(key, val) {
  cache.set(key, val);
  if (cache.size > CACHE_MAX) {
    var first = cache.keys().next().value;
    cache.delete(first);
  }
  try {
    chrome.storage.session.get('claimIndexCache', function (data) {
      var m = (data && data.claimIndexCache) || {};
      m[key] = val;
      var keys = Object.keys(m);
      while (keys.length > CACHE_MAX) delete m[keys.shift()];
      chrome.storage.session.set({ claimIndexCache: m });
    });
  } catch (e) { /* 仅内存缓存 */ }
}

// ---------- 信息对象类型（升级要求 §2） ----------
var OBJECT_TYPES = [
  'plain',       // 普通正文
  'fact',        // 事实陈述
  'data',        // 数据/数字
  'report',      // 研究报告/文件
  'paper',       // 论文
  'govdoc',      // 政府文件
  'orginfo',     // 机构信息
  'media',       // 媒体报道
  'person',      // 人物/事件
  'opinion',     // 观点/判断
  'rhetoric'     // 修辞/无意义文本
];
var OBJECT_TYPE_NAMES = {
  plain: '普通正文', fact: '事实陈述', data: '数据/数字', report: '研究报告',
  paper: '论文', govdoc: '政府文件', orginfo: '机构信息', media: '媒体报道',
  person: '人物/事件', opinion: '观点/判断', rhetoric: '修辞/无意义'
};

// ---------- 批量 LLM 分析 ----------
// v2 prompt（§2/§3/§4）：对象识别 → 验证价值 → Claim 提取，三步一体
var SYSTEM_PROMPT = [
  '你是中文网页信息分析器。用户给你一篇网页的结构化句子列表（JSON 数组，每项含 sid/text/prev/next/para）。',
  'prev/next 是该句的前一句与后一句文本；para 是所属段落全文。分析每一句时必须结合这些上下文。',
  '',
  '对每句话依次完成三个判断：',
  '一、objectType 信息对象识别（11 选 1）：',
  '  plain 普通正文 / fact 事实陈述 / data 数据数字 / report 研究报告 / paper 论文 / govdoc 政府文件 / orginfo 机构信息 / media 媒体报道 / person 人物事件 / opinion 观点判断 / rhetoric 修辞或无意义文本。',
  '二、traceable 验证价值判断（true/false）：该信息是否具有【外部验证/溯源价值】？',
  '  true：可外部验证的事实、数据、人物经历、时间地点事件、论文报告文件、机构发布的信息、具有明确来源的观点。',
  '  false：夸张性修辞、无外部事实意义的数字、单纯情绪表达、无信息价值文本、无法外部验证的纯个人感受。',
  '三、若 traceable=true，提取 claim：',
  '  - text：声明原文（通常就是当前句，也可依据上下文修正表述）；',
  '  - type 子类：fact(事实)/number(数据)/causal(因果)/compare(比较)/predict(预测)/define(定义)/person(人物事件)/other(其他)；',
  '  - sourceRequirement：验证它需要什么类型的来源（从以下选最合适的一种）：gov(政府机构)/acad(科研机构/论文)/official(官方组织)/media(权威媒体)/industry(专业媒体或行业)/corporate(企业官方)/community(社区讨论)/any(不限)。',
  '',
  '重要原则：',
  '- 上下文优先：一句话孤立看像观点，但上下文能验证的，应判为 traceable 并提取声明（§4 核心目的）；反之，看似事实但上下文表明是假设/引用虚构内容的，判 false。',
  '- 宁缺毋滥：拿不准 traceable 就 false。',
  '- 观点≠排除：带明确来源或具体事实支撑的观点有溯源价值（如 "某报告认为营收将翻倍"→true）；裸的个人喜好（如 "我觉得好看"）→false。',
  '',
  '只输出 JSON：{ "results":[{"sid":"s-0","objectType":"data","traceable":true,"claim":{"text":"...","type":"number","sourceRequirement":"media"}},{"sid":"s-1","objectType":"opinion","traceable":false}]}'
].join('\n');

// 从响应中提取 JSON（兼容 ```json 包裹/前后杂文）
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

function callChunk(chunk) {
  var body = {
    model: CONFIG.DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(chunk) }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 6000
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
  }).then(function (resp) {
    clearTimeout(timer);
    if (!resp.ok) throw new Error('http_' + resp.status);
    return resp.json();
  }).then(function (data) {
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('empty_response');
    var parsed = extractJson(content);
    if (!parsed || !Array.isArray(parsed.results)) throw new Error('missing_fields:results');
    return parsed.results;
  });
}

// ---------- 组装带上下文的批次输入 ----------
function buildChunkInputs(work, paragraphsById) {
  return work.map(function (s, idx) {
    var prev = idx > 0 && work[idx - 1].paraId === s.paraId ? work[idx - 1].text : '';
    var next = idx < work.length - 1 && work[idx + 1].paraId === s.paraId ? work[idx + 1].text : '';
    var para = paragraphsById[s.paraId];
    return {
      sid: s.id,
      text: s.text,
      prev: prev.slice(-60),
      next: next.slice(0, 60),
      para: para ? para.text.slice(0, 300) : s.text
    };
  });
}

// ---------- 汇总为 Claim Index（v2 数据模型，升级要求 §4） ----------
function validObjectType(t) { return OBJECT_TYPES.indexOf(t) >= 0; }
function buildIndex(sentences, resultsBySid, truncated) {
  var claims = [];
  var objects = [];   // 每句的对象分类（概览统计用）
  sentences.forEach(function (s, i) {
    var r = resultsBySid[s.id];
    var ot = r && validObjectType(r.objectType) ? r.objectType : 'plain';
    objects.push(ot);
    if (!r || !r.traceable) return; // 验证价值判断：无溯源价值不进 Claim Index
    var c = r.claim || {};
    claims.push({
      id: 'claim-' + i,
      text: String(c.text || s.text),
      type: c.type || 'other',
      verifiable: true,
      objectType: ot,
      sourceRequirement: c.sourceRequirement || 'any',
      sentenceId: s.id,
      position: { paraId: s.paraId, start: s.start, end: s.end }
    });
  });
  var objectStats = {};
  objects.forEach(function (ot) { objectStats[ot] = (objectStats[ot] || 0) + 1; });
  return { claims: claims, objectStats: objectStats, analyzed: sentences.length, truncated: !!truncated };
}

// ---------- 对外入口 ----------
// detectClaims(documentPayload) -> Promise<{claims, objectStats, analyzed, truncated, cached}>
function detectClaims(documentPayload) {
  if (!isLlmAvailable()) return Promise.reject(new Error('config_missing'));
  var doc = documentPayload || {};
  var sentences = doc.sentences || [];
  var paragraphsById = {};
  (doc.paragraphs || []).forEach(function (p) { paragraphsById[p.id] = p; });
  if (!sentences.length) {
    return Promise.resolve({ claims: [], objectStats: {}, analyzed: 0, truncated: false, cached: false });
  }
  var key = docFingerprint(doc);
  return cacheGet(key).then(function (hit) {
    if (hit) {
      return { claims: hit.claims, objectStats: hit.objectStats || {}, analyzed: hit.analyzed, truncated: hit.truncated, cached: true };
    }
    var truncated = sentences.length > MAX_SENTENCES;
    var work = sentences.slice(0, MAX_SENTENCES);
    // 串行分批（并发会撞 DeepSeek 限流）
    var chunks = [];
    for (var i = 0; i < work.length; i += CHUNK_SIZE) chunks.push(work.slice(i, i + CHUNK_SIZE));
    var chain = Promise.resolve([]);
    chunks.forEach(function (chunk) {
      chain = chain.then(function (acc) {
        var inputs = buildChunkInputs(chunk, paragraphsById);
        return callChunk(inputs).then(function (results) {
          return acc.concat(results);
        }).catch(function () {
          // 单批失败重试一次，仍失败则整批按 plain/不可溯源兜底（不拖垮整体）
          return callChunk(inputs).catch(function () {
            return chunk.map(function (s) { return { sid: s.id, objectType: 'plain', traceable: false }; });
          });
        });
      });
    });
    return chain.then(function (allResults) {
      var resultsBySid = {};
      allResults.forEach(function (r) {
        if (r && r.sid) resultsBySid[r.sid] = r;
      });
      var index = buildIndex(work, resultsBySid, truncated);
      var entry = { claims: index.claims, objectStats: index.objectStats, analyzed: index.analyzed, truncated: index.truncated };
      cacheSet(key, entry);
      return { claims: index.claims, objectStats: index.objectStats, analyzed: index.analyzed, truncated: index.truncated, cached: false };
    });
  });
}

global.WCC_CLAIM_DETECTOR = {
  detectClaims: detectClaims,
  OBJECT_TYPES: OBJECT_TYPES,
  OBJECT_TYPE_NAMES: OBJECT_TYPE_NAMES
};
})(typeof globalThis !== 'undefined' ? globalThis : self);