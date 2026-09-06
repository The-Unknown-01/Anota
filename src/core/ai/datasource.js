// 知乎开放平台数据源（M3）+ 外部搜索引擎（V2.5）。
// 双模式：代理模式（PROXY）请求经 CF Worker 中转，密钥不出服务器；
//         直连模式（DIRECT）保留为本地开发后门。模式由 generated-config.js 的
//         PROXY_ENABLED 决定，有 proxy_base.txt 即走代理。
// 无凭证且无代理时 isAvailable()=false，调用方走降级路径；配额保护靠 analyzer 的查询缓存。
(function (global) {
'use strict';

var CONFIG = global.QIUZHEN_CONFIG || null;

// ---------- 代理模式探测 ----------
function isProxy() {
  return !!(CONFIG && CONFIG.PROXY_ENABLED === true && CONFIG.PROXY_BASE_URL);
}

// ---------- 可用性（代理模式下视为可用，运行时错误由各引擎 .catch 兜底降级） ----------
function isAvailable() {
  return isProxy() || !!(CONFIG && CONFIG.ZHIHU_ACCESS_SECRET);
}

// ---------- 请求封装 ----------
var TIMEOUT_MS = 15000;

// 知乎站内/全网搜索（GET）。代理模式：请求 Worker，Worker 注入知乎密钥并补时间戳；
// 直连模式：原逻辑不变。响应结构两种模式完全一致（透明代理）。
function apiGet(path, params) {
  if (!isAvailable()) return Promise.reject(new Error('zhihu_not_configured'));
  var qs = Object.keys(params || {})
    .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  var useProxy = isProxy();
  var url = useProxy
    ? CONFIG.PROXY_BASE_URL + '/api/v1/content' + path + (qs ? '?' + qs : '')
    : CONFIG.ZHIHU_API_BASE + path + (qs ? '?' + qs : '');
  var headers = useProxy
    ? { 'Authorization': WCC_AUTH && WCC_AUTH.proxyAuthHeader ? WCC_AUTH.proxyAuthHeader() : '', 'Content-Type': 'application/json' }
    : { 'Authorization': 'Bearer ' + CONFIG.ZHIHU_ACCESS_SECRET, 'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)), 'Content-Type': 'application/json' };

  return fetch(url, {
    method: 'GET',
    headers: headers,
    signal: controller.signal
  }).then(function (resp) {
    clearTimeout(timer);
    if (!resp.ok) throw new Error('zhihu_http_' + resp.status);
    return resp.json();
  }).then(function (data) {
    // 业务错误码：0=成功 20001=鉴权失败 30001=频率限制
    if (data && typeof data.Code === 'number' && data.Code !== 0) {
      throw new Error('zhihu_code_' + data.Code);
    }
    return (data && data.Data) || {};
  }).catch(function (err) {
    clearTimeout(timer);
    throw err;
  });
}

// ---------- 归一化 ----------
// origin 标记来源接口（'zhihu'=站内搜索 / 'global'=全网搜索）：
// 注意 ContentType 只是内容形态（Answer/Article），全网结果也可能是 Answer，不能作为来源判断依据
function normalizeItems(data, origin) {
  var items = (data && data.Items) || [];
  return items.map(function (it) {
    return {
      title: it.Title || '',
      // 摘要去高亮 <em> 标签
      snippet: String(it.ContentText || '').replace(/<\/?em>/g, ''),
      url: it.Url || '',
      author: it.AuthorName || '',
      sourceType: it.ContentType || '',   // Answer / Article ...（内容形态）
      origin: origin,                     // zhihu / global（来源接口）
      votes: it.VoteUpCount || 0,
      authority: Number(it.AuthorityLevel) || 1  // 1低~4超高
    };
  });
}

// ---------- 对外接口 ----------
// searchZhihu(query, count) -> Promise<items[]>  知乎站内讨论/回答/文章
function searchZhihu(query, count) {
  return apiGet('/zhihu_search', { Query: String(query || '').slice(0, 100), Count: Math.min(count || 5, 10) })
    .then(function (data) { return normalizeItems(data, 'zhihu'); });
}

// searchGlobal(query, count) -> Promise<items[]>  知乎之外的全网来源
function searchGlobal(query, count) {
  return apiGet('/global_search', { Query: String(query || '').slice(0, 100), Count: Math.min(count || 5, 20) })
    .then(function (data) { return normalizeItems(data, 'global'); });
}

// searchBoth(query) -> Promise<{ zhihu, global }>，任一失败不拖垮整体（返回空数组）
function searchBoth(query) {
  return Promise.all([
    searchZhihu(query, 5).catch(function () { return []; }),
    searchGlobal(query, 5).catch(function () { return []; })
  ]).then(function (r) { return { zhihu: r[0], global: r[1] }; });
}

// ---------- V2.5 M1：外部搜索引擎 providers（metaso 广泛召回 / Exa 语义召回，TQ2/TQ3） ----------
// 归一化为统一 item 结构（与知乎通道字段对齐）
function normalizeExternal(raw, engine) {
  return {
    title: raw.title || raw.name || '',
    snippet: raw.snippet || raw.text || raw.summary || '',
    url: raw.url || raw.link || '',
    author: (raw.author && raw.author.name) || raw.author || '',
    sourceType: '',            // 由 source-analyzer 阶段判定
    origin: 'global',
    engine: engine,            // 'metaso' / 'exa'
    votes: 0,
    authority: 1,
    publishedDate: raw.publishedDate || raw.published_date || raw.datePublished || null
  };
}

function isMetasoAvailable() {
  return isProxy() || !!(CONFIG && CONFIG.METASO_API_KEY);
}

function isExaAvailable() {
  return isProxy() || !!(CONFIG && CONFIG.EXA_API_KEY);
}

// metaso：广泛召回。真实 API 为 https://metaso.cn/api/v1/search（M1 联调探明）。
// 代理模式：请求 Worker /metaso/search；直连模式：原逻辑。
// opts.siteDomain → 追加 site: 约束（search_advise §4.1）。
function searchMetaso(query, count, opts) {
  if (!isMetasoAvailable()) return Promise.reject(new Error('metaso_not_configured'));
  opts = opts || {};
  var q = String(query || '').slice(0, 100);
  if (opts.siteDomain && q.indexOf('site:') < 0) q += ' site:' + opts.siteDomain;
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  var useProxy = isProxy();
  var url = useProxy
    ? CONFIG.PROXY_BASE_URL + '/metaso/search'
    : (CONFIG.METASO_ENDPOINT || 'https://metaso.cn/search-api/playground');
  var headers = useProxy
    ? { 'Content-Type': 'application/json', 'Authorization': WCC_AUTH && WCC_AUTH.proxyAuthHeader ? WCC_AUTH.proxyAuthHeader() : '' }
    : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.METASO_API_KEY };

  return fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ q: q, count: Math.min(count || 5, 10) }),
    signal: controller.signal
  }).then(function (res) {
    clearTimeout(timer);
    if (!res.ok) throw new Error('metaso_http_' + res.status);
    return res.json();
  }).then(function (data) {
    if (data && typeof data.errCode === 'number' && data.errCode !== 0) throw new Error('metaso_code_' + data.errCode);
    var list = data.webpages || data.results || data.data || data.items || [];
    return list.map(function (it) { return normalizeExternal(it, 'metaso'); });
  }).catch(function (err) {
    clearTimeout(timer);
    throw err;
  });
}

// Exa：语义召回（官方 https://api.exa.ai/search）
// 代理模式：请求 Worker /exa/search；直连模式：原逻辑。
// opts.includeDomains → 限定官方域名（search_advise §4.1 / §24）
function searchExa(query, count, opts) {
  if (!isExaAvailable()) return Promise.reject(new Error('exa_not_configured'));
  opts = opts || {};
  var body = {
    query: String(query || '').slice(0, 200),
    numResults: Math.min(count || 5, 10),
    type: 'neural',
    contents: { text: { maxCharacters: 300 } }
  };
  if (opts.includeDomains && opts.includeDomains.length) body.includeDomains = opts.includeDomains.slice(0, 3);
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  var useProxy = isProxy();
  var url = useProxy
    ? CONFIG.PROXY_BASE_URL + '/exa/search'
    : 'https://api.exa.ai/search';
  var headers = useProxy
    ? { 'Content-Type': 'application/json', 'Authorization': WCC_AUTH && WCC_AUTH.proxyAuthHeader ? WCC_AUTH.proxyAuthHeader() : '' }
    : { 'Content-Type': 'application/json', 'x-api-key': CONFIG.EXA_API_KEY };

  return fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
    signal: controller.signal
  }).then(function (res) {
    clearTimeout(timer);
    if (!res.ok) throw new Error('exa_http_' + res.status);
    return res.json();
  }).then(function (data) {
    var list = data.results || [];
    return list.map(function (it) { return normalizeExternal(it, 'exa'); });
  }).catch(function (err) {
    clearTimeout(timer);
    throw err;
  });
}

// buildEngineQuery(engine, query, constraints)：search_advise §4.1 ——
// 每个引擎自己决定如何处理 site:/domain/语言约束，返回该引擎可执行的查询参数。
// constraints: { domain?: string }
function buildEngineQuery(engine, query, constraints) {
  constraints = constraints || {};
  if (engine === 'exa') {
    return { query: String(query || '').replace(/\s*site:[^\s]+/g, ''), includeDomains: constraints.domain ? [constraints.domain] : null };
  }
  if (engine === 'metaso') {
    return { query: constraints.domain && String(query || '').indexOf('site:') < 0 ? String(query) + ' site:' + constraints.domain : String(query) };
  }
  // zhihu / zhihu_global 不支持 site:，原样返回
  return { query: String(query || '') };
}

// engineSearch(engine, query, count, opts)：按名派发，供 search-controller / v25-pipeline 按策略调用。
// 引擎失败返回 []（不拖垮整体——调用方聚合时统一兜底）。opts: { includeDomains?, siteDomain? }
function engineSearch(engine, query, count, opts) {
  try {
    if (engine === 'zhihu') return searchZhihu(query, count).catch(function () { return []; });
    if (engine === 'zhihu_global' || engine === 'zhihu-global') return searchGlobal(query, count).catch(function () { return []; });
    if (engine === 'metaso') return searchMetaso(query, count, opts).catch(function () { return []; });
    if (engine === 'exa') return searchExa(query, count, opts).catch(function () { return []; });
    return Promise.resolve([]);
  } catch (e) {
    return Promise.resolve([]);
  }
}

global.WCC_DATASOURCE = {
  isAvailable: isAvailable,
  searchZhihu: searchZhihu,
  searchGlobal: searchGlobal,
  searchBoth: searchBoth,
  // V2.5 新增
  engineSearch: engineSearch,
  isMetasoAvailable: isMetasoAvailable,
  isExaAvailable: isExaAvailable,
  searchMetaso: searchMetaso,
  searchExa: searchExa,
  // search_advise 新增
  buildEngineQuery: buildEngineQuery
};
})(typeof globalThis !== 'undefined' ? globalThis : self);