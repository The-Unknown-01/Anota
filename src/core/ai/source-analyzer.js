// Source Analyzer（V2.5 M3）：LLM 理解来源——输入 URL/标题/摘要 → 结构化来源画像。
// 升级要求 §5/§8：LLM 只负责理解来源（类型/一手性/机构/领域），不做可信度打分；
// 评分由 Scoring Engine 综合。TQ4：一手性启发式优先、LLM 辅助、标注"疑似"。
// 缓存：按 (domain + normalizedUrl path) 会话级缓存——同域名路径相同即复用，跨 Claim 免分析。
(function (global) {
'use strict';
var CONFIG = global.QIUZHEN_CONFIG;
var URL_UTILS = global.WCC_URL_UTILS;

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

var TIMEOUT_MS = 20000;

// ---------- 会话级缓存 ----------
var cache = {}; // key -> analysis
function cacheKey(item) {
  var norm = (item.normalizedUrl || item.url || '').toLowerCase();
  // domain+path 级：去 query（同文档不同 tracking 参数共享缓存）
  return norm.split('?')[0];
}

var SOURCE_TYPES = ['gov', 'acad', 'paper', 'media', 'org', 'biz', 'zhihu', 'other'];
var ORIGINALITY_LEVELS = ['original', 'secondary', 'tertiary'];
var SCOPE_LEVELS = ['global', 'national', 'province', 'city', 'county', 'unknown'];
// search_advise §14.1 / §15 / §16：来源身份类型（发布主体身份），与 sourceType 分离。
// sourceType 用于评分兼容（八类旧枚举），identityType 记录真实主体身份。
var IDENTITY_TYPES = [
  'government_official', 'international_org', 'company_official', 'academic_institution',
  'professional_association', 'mainstream_media', 'specialized_media', 'community_platform',
  'forum', 'blog', 'social_media', 'aggregator', 'syndication', 'unknown'
];
// 身份 → 评分用八类映射（search_advise §16：判发布主体，不判文章内容）
var IDENTITY_TO_SOURCE_TYPE = {
  government_official: 'gov',
  international_org: 'org',
  company_official: 'biz',
  academic_institution: 'acad',
  professional_association: 'org',
  mainstream_media: 'media',
  specialized_media: 'media',
  community_platform: 'zhihu',
  forum: 'zhihu',
  blog: 'other',
  social_media: 'other',
  aggregator: 'other',
  syndication: 'media',
  unknown: 'other'
};
// 明显非政府主体后缀（微信公众号上的学会/协会/公司等）：命中即不得判 government_official（§15）
var NON_GOV_SUFFIX = /(学会|协会|研究会|基金会|商会|俱乐部|公司|集团|工作室|中心|研究院)$/;

var SYSTEM_PROMPT = [
  '你是来源分析器。给你一个网页的 URL、标题和内容摘要。',
  '请理解该来源并输出结构化 JSON：',
  '最重要原则：来源类型必须根据【发布主体是谁】判断（Who published it），而不是根据文章内容谈论了什么（What does it talk about）。',
  '  —— 例如：微信公众号 "河北省健康管理学会" 发布的人口分析文章，发布主体是专业学会，不是政府。',
  '  —— 例如：某县检察院官网的 "民法典实施案例" 页面，发布主体是司法机关，属于 gov。',
  '- publisher: 发布主体名称（如 "国家统计局"/"河北省健康管理学会"/"澎湃新闻"，未知给空串）',
  '- identityType: 发布主体身份，取值 government_official(政府机关)/international_org(国际组织)/',
  '  company_official(企业官方)/academic_institution(科研院校)/professional_association(专业学会协会)/',
  '  mainstream_media(主流媒体)/specialized_media(行业媒体)/community_platform(社区平台如知乎)/',
  '  forum(论坛)/blog(个人博客)/social_media(社交媒体如微博公众号)/aggregator(内容聚合)/syndication(转载号)/unknown',
  '- sourceType: 来源类型（兼容旧枚举），取值 gov(政府机构)/acad(科研机构)/paper(学术论文)/media(媒体)/',
  '  org(官方组织或学会协会)/biz(企业)/zhihu(知乎等社区)/other；必须与 identityType 一致',
  '- originality: 一手性，取值 original(原始发布：官方公告/论文原文/当事人陈述/一手数据) /',
  '  secondary(转载或报道他人内容) / tertiary(聚合汇编多处来源)',
  '- originalityConfidence: high / medium / low（低置信时下游只标 "疑似"）',
  '- org: 所属机构名（中文，未知给空串）',
  '- domain: 专业领域短语（如 财经/公共卫生/AI 技术，未知给空串）',
  '- scopeLevel: 该来源主体覆盖的地域范围：global/national/province/city/county/unknown',
  '  （如 国家统计局=national，某县统计局=county，WHO=global，某省级媒体=province）',
  '- citationHint: 摘要中是否引用了其他来源（"cites"/"none"）',
  '- platform: 页面托管平台（Phase 4 身份三层）。若 URL 是第三方平台（微信公众号 mp.weixin.qq.com / 微博 / 知乎 / 今日头条 / 百家号 等）填平台名；机构自建官网留空字符串',
  '- claimedOrigin: 内容声称的原始来源（仅当正文/摘要明确写"据X报道/转载自X/来源X"才填，如 "央视新闻"/"路透社"；未声称给空串）。claimedOrigin ≠ publisher',
  '- identityConfidence: 身份确认置信度，取值 HIGH(官方域名或平台官方认证)/MEDIUM(名称与机构一致但无法验证)/LOW(仅凭自称或第三方转载无法确认)',
  '',
  '只输出 JSON：{ "publisher":"河北省健康管理学会", "identityType":"professional_association", "sourceType":"org", "originality":"secondary", "originalityConfidence":"medium", "org":"河北省健康管理学会", "domain":"健康管理", "scopeLevel":"province", "citationHint":"none", "platform":"微信公众号", "claimedOrigin":"", "identityConfidence":"MEDIUM"}'
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
    max_tokens: 400
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

// 微信/微博等自媒体平台守卫（§15）：主体带明显非政府后缀 → 强制降级为专业学会/企业
function weixinIdentityGuard(raw, isWeixin) {
  if (!isWeixin && !/weixin|wechat/.test(String(raw && raw.org || '') + String(raw && raw.publisher || ''))) return raw;
  var pub = String((raw && (raw.publisher || raw.org)) || '');
  if (raw && raw.identityType === 'government_official' && NON_GOV_SUFFIX.test(pub)) {
    raw.identityType = 'professional_association';
    raw.sourceType = 'org';
  }
  return raw;
}
// sanitize：非法值回落 other/secondary/low
function sanitize(raw, isWeixin) {
  raw = weixinIdentityGuard(raw || {}, isWeixin);
  var idt = IDENTITY_TYPES.indexOf(raw.identityType) >= 0 ? raw.identityType : 'unknown';
  var st = SOURCE_TYPES.indexOf(raw.sourceType) >= 0 ? raw.sourceType : IDENTITY_TO_SOURCE_TYPE[idt];
  var og = ORIGINALITY_LEVELS.indexOf(raw.originality) >= 0 ? raw.originality : 'secondary';
  var conf = ['high', 'medium', 'low'].indexOf(raw.originalityConfidence) >= 0 ? raw.originalityConfidence : 'low';
  var idConf = ['HIGH', 'MEDIUM', 'LOW'].indexOf(raw.identityConfidence) >= 0 ? raw.identityConfidence : 'LOW';
  return {
    sourceType: st,
    identityType: idt,
    publisher: typeof raw.publisher === 'string' ? raw.publisher.slice(0, 40) : '',
    originality: og,
    originalityConfidence: conf,
    org: typeof raw.org === 'string' ? raw.org.slice(0, 40) : '',
    domain: typeof raw.domain === 'string' ? raw.domain.slice(0, 30) : '',
    scopeLevel: SCOPE_LEVELS.indexOf(raw.scopeLevel) >= 0 ? raw.scopeLevel : 'unknown',
    citationHint: raw.citationHint === 'cites' ? 'cites' : 'none',
    // Phase 4：身份三层（页面托管平台 ≠ 实际发布者 ≠ 声称的原作者）
    platform: typeof raw.platform === 'string' ? raw.platform.slice(0, 30) : '',
    claimedOrigin: typeof raw.claimedOrigin === 'string' ? raw.claimedOrigin.slice(0, 40) : '',
    identityConfidence: idConf
  };
}
// 规则兜底（无 LLM / 失败时）：URL 特征粗判
// 平台检测：第三方内容平台才有 platform；自建官网留空
function detectPlatform(url) {
  var u = String(url || '').toLowerCase();
  if (u.indexOf('mp.weixin.qq.com') >= 0) return '微信公众号';
  if (u.indexOf('weibo.com') >= 0) return '微博';
  if (u.indexOf('zhihu.com') >= 0) return '知乎';
  if (u.indexOf('toutiao.com') >= 0 || u.indexOf('dongchedi.com') >= 0) return '今日头条';
  if (u.indexOf('baijiahao.baidu.com') >= 0) return '百家号';
  if (u.indexOf('163.com') >= 0) return '网易号';
  if (u.indexOf('sohu.com') >= 0) return '搜狐号';
  return '';
}
function heuristicFallback(item) {
  var url = String(item.normalizedUrl || item.url || '').toLowerCase();
  var st = 'other';
  var idt = 'unknown';
  if (/mp.weixin.qq.com/.test(url)) { st = 'other'; idt = 'social_media'; }
  else if (/(^|\.)gov($|\.|\/)|(^|\.)go\.jp($|\.|\/)|(^|\.)gouv\.fr($|\.|\/)|(^|\.)edu($|\.|\/)|(^|\.)ac\.uk($|\.|\/)|(^|\.)ac\.jp($|\.|\/)|^arxiv\.org|^pubmed\./.test(url)) st = url.indexOf('/abs/') >= 0 || /\.pdf/.test(url) ? 'paper' : 'gov';
  else if (/thepaper.cn|caixin.com|xinhuanet.com|people.com.cn|cctv.com|jiemian.com|yicai.com/.test(url)) st = 'media';
  else if (/zhihu.com/.test(url)) st = 'zhihu';
  if (st === 'gov') idt = 'government_official';
  else if (st === 'media') idt = 'mainstream_media';
  else if (st === 'zhihu') idt = 'community_platform';
  else if (st === 'paper' || st === 'acad') idt = 'academic_institution';
  var idConf = st === 'gov' || st === 'paper' || st === 'acad' ? 'HIGH' : 'LOW';
  return {
    sourceType: st,
    identityType: idt,
    publisher: '',
    originality: 'secondary',
    originalityConfidence: 'low',
    org: '',
    domain: '',
    scopeLevel: 'unknown',
    citationHint: 'none',
    platform: detectPlatform(url),
    claimedOrigin: '',
    identityConfidence: idConf
  };
}

// ---------- 对外入口 ----------
// analyzeSource(item) -> Promise<analysis>
// item: 搜索结果条目（url/title/snippet/normalizedUrl）
// analysis: { sourceType, identityType, publisher, originality, originalityConfidence, org, domain, scopeLevel, citationHint, viaFallback }
function analyzeSource(item) {
  var key = cacheKey(item);
  if (cache[key]) return Promise.resolve(cache[key]);
  var url = String(item.normalizedUrl || item.url || '').toLowerCase();
  var isWeixin = /mp\.weixin\.qq\.com/.test(url) || /weixin|wechat/.test(url);
  var platformHint = isWeixin
    ? '\n\n注意：这是微信公众号页面（mp.weixin.qq.com），发布主体是公众号的运营机构，请务必按【公众号主体】判断身份，而不是按文章内容。'
    : '';
  var userContent = [
    'URL: ' + (item.normalizedUrl || item.url || ''),
    '标题: ' + (item.title || ''),
    '摘要: ' + String(item.snippet || '').slice(0, 260)
  ].join('\n') + platformHint;
  // 无凭证时同样走启发式兜底（v2.5 原则：来源分析在任何配置下都可用，只是质量不同）
  var p = (!isLlmAvailable())
    ? Promise.resolve().then(function () {
        var a = heuristicFallback(item);
        a.viaFallback = true;
        return a;
      })
    : callLLM(userContent).then(function (raw) {
        return sanitize(raw, isWeixin);
      }).then(function (a) { a.viaFallback = false; return a; })
      .catch(function () {
        var a = heuristicFallback(item);
        a.viaFallback = true;
        return a;
      });
  return p.then(function (a) {
    cache[key] = a;
    return a;
  });
}
// analyzeSources(items) -> Promise<items'>（逐条注入 sourceAnalysis；串行防限流）
function analyzeSources(items) {
  var chain = Promise.resolve();
  items.forEach(function (it) {
    chain = chain.then(function () {
      return analyzeSource(it).then(function (a) { it.sourceAnalysis = a; });
    });
  });
  return chain.then(function () { return items; });
}

global.WCC_SOURCE_ANALYZER = {
  analyzeSource: analyzeSource,
  analyzeSources: analyzeSources,
  SOURCE_TYPES: SOURCE_TYPES,
  _cache: cache
};
})(typeof globalThis !== 'undefined' ? globalThis : self);