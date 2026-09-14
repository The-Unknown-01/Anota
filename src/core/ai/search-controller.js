// Search Controller（V2.0 N1）：Claim → 所需来源类型 → 关键词 → 白名单过滤 → 优先级 → Search API。
// 升级要求 §6/§5：搜索不再由 AI 自由决定；来源类型影响权威性评分、搜索优先级与最终展示。
// 分类策略（TD2）：域名规则优先命中，未命中的批量交 LLM 兜底（省配额）。
// 白名单形态（TD3）：内置四级 seed 表（priority/allow/low/banned），不做设置 UI。
(function (global) {
  'use strict';

  var CONFIG = global.QIUZHEN_CONFIG || null;

  // ---------- Source Type 统一枚举（升级要求 §5） ----------

  var SOURCE_TYPES = [
    'gov',        // 政府机构
    'acad',       // 科研机构
    'paper',      // 学术论文
    'official',   // 官方组织
    'media',      // 权威媒体
    'industry',   // 专业媒体
    'corporate',  // 商业机构
    'securities', // 证券机构
    'company',    // 企业官方来源
    'zhihu',      // 知乎
    'other'       // 其他
  ];

  var SOURCE_TYPE_NAMES = {
    gov: '政府机构', acad: '科研机构', paper: '学术论文', official: '官方组织',
    media: '权威媒体', industry: '专业媒体', corporate: '商业机构', securities: '证券机构',
    company: '企业官方', zhihu: '知乎', other: '其他'
  };

  // 权威性基分（§5：来源类型必须影响权威性评分；0~100）
  var AUTHORITY_BASE = {
    gov: 95, acad: 92, paper: 90, official: 85,
    media: 78, industry: 65, corporate: 55, securities: 60,
    company: 50, zhihu: 40, other: 30
  };

  // ---------- 域名规则表（TD2：规则优先） ----------

  var DOMAIN_RULES = [
    { pattern: /\.gov\.cn$|\.gov$|\.eu$|un\.org$/, type: 'gov' },
    { pattern: /\.edu\.cn$|\.edu$|\.ac\.uk$/, type: 'acad' },
    { pattern: /arxiv\.org$|nature\.com$|science\.org$|sciencedirect\.com$|springer\.com$|ieee\.org$|acm\.org$|plos\.org$|frontiersin\.org$|mdpi\.com$/, type: 'paper' },
    { pattern: /who\.int$|worldbank\.org$|imf\.org$|unicef\.org$|ieee\.org$|iso\.org$/, type: 'official' },
    { pattern: /xinhuanet\.com$|people\.com\.cn$|cctv\.com$|reuters\.com$|apnews\.com$|bbc\.co\.uk$|nytimes\.com$|theguardian\.com$|bloomberg\.com$|caixin\.com$|thepaper\.cn$|chinanews\.com\.cn$/, type: 'media' },
    { pattern: /36kr\.com$|jiemian\.com$|yicai\.com$|eeo\.com\.cn$|latepost\.com$|huxiu\.com$|zaobao\.com$|wallstreetcn\.com$/, type: 'industry' },
    { pattern: /eastmoney\.com$|cs\.com\.cn$|stcn\.com$|cninfo\.com\.cn$|sse\.com\.cn$|szse\.cn$|hkex\.com\.hk$/, type: 'securities' },
    { pattern: /zhihu\.com$/, type: 'zhihu' },
    { pattern: /wikipedia\.org$|baike\.baidu\.com$/, type: 'other' }
  ];

  // ---------- 四级白名单（TD3：内置 seed 表） ----------
  // priority > allow > low > banned；不在表内的默认 allow

  var WHITELIST = {
    priority: [
      { pattern: /\.gov\.cn$|\.gov$/, reason: '政府权威' },
      { pattern: /arxiv\.org$|nature\.com$|science\.org$/, reason: '顶级学术' },
      { pattern: /who\.int$|worldbank\.org$|imf\.org$/, reason: '国际组织' },
      { pattern: /xinhuanet\.com$|people\.com\.cn$|reuters\.com$/, reason: '权威通讯社' },
      { pattern: /cninfo\.com\.cn$|sse\.com\.cn$|szse\.cn$/, reason: '官方披露平台' }
    ],
    allow: [],   // 未列出的域名默认允许
    low: [
      { pattern: /wikipedia\.org$|baike\.baidu\.com$/, reason: '百科（二手汇编）' },
      { pattern: /zhihu\.com$/, reason: '社区讨论' },
      { pattern: /weibo\.com$|tieba\.baidu\.com$|douyin\.com$/, reason: '社交媒体' }
    ],
    banned: []
  };

  function matchRules(url, rules) {
    var u = String(url || '').toLowerCase();
    // 取 URL 的 host 段做后缀匹配（$ 锚点只对 host 生效，路径不影响）
    var m = u.match(/^https?:\/\/([^\/?#]+)/);
    var host = m ? m[1] : u;
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].pattern.test(host)) return rules[i];
    }
    return null;
  }

  // 域名规则分类（同步、零成本）；返回 null 表示规则未命中
  function classifyByDomain(url) {
    var hit = matchRules(url, DOMAIN_RULES);
    return hit ? hit.type : null;
  }

  // 白名单等级：priority(3) / allow(2) / low(1) / banned(-1)
  function whitelistLevel(url) {
    if (matchRules(url, WHITELIST.banned)) return { level: -1, tier: 'banned', reason: matchRules(url, WHITELIST.banned).reason };
    var p = matchRules(url, WHITELIST.priority);
    if (p) return { level: 3, tier: 'priority', reason: p.reason };
    var l = matchRules(url, WHITELIST.low);
    if (l) return { level: 1, tier: 'low', reason: l.reason };
    return { level: 2, tier: 'allow', reason: '' };
  }

  // ---------- 关键词生成（§6：Claim → 搜索关键词） ----------

  // 从 Claim 文本生成主查询：去修饰、保留实体与数字
  function buildPrimaryQuery(claimText) {
    return String(claimText || '')
      .replace(/[「」『』""''《》"'（）()【】\[\]]/g, ' ')
      .replace(/据报道|据悉|有研究表明|数据显示|据统计|专家表示|业内人士|记者了解到/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  }

  // sourceRequirement → 站内限定词（global_search 的 site: 提示由各引擎自行处理，
  // 这里只生成"倾向性补充查询"，主查询保持自然语言）
  var SR_QUERY_HINTS = {
    gov: '政府 官方发布',
    acad: '论文 研究',
    official: '官方 组织',
    media: '新闻报道',
    industry: '行业 分析',
    corporate: '公司 官方',
    community: '讨论 经验',
    any: ''
  };

  // ---------- 候选来源排序（§7） ----------

  // 综合评分 = 来源类型权威基分 × 权重 + 白名单等级分 + 相关性(LLM/文本粗判) + 时间新近度
  // score = authority(0-100) * 0.45 + whitelistLevel(0-30→映射0-100) * 0.2 + relevance(0-100) * 0.25 + recency(0-100) * 0.1
  function scoreCandidate(item, claim) {
    var stype = item.sourceType || classifyByDomain(item.url) || 'other';
    if (stype === 'zhihu' && item.origin === 'global') stype = classifyByDomain(item.url) || 'other';
    var auth = AUTHORITY_BASE[stype] !== undefined ? AUTHORITY_BASE[stype] : AUTHORITY_BASE.other;
    // 知乎站内高赞回答适度加分（社区内质量信号）
    if (stype === 'zhihu' && item.votes > 100) auth += 8;

    var wl = whitelistLevel(item.url);
    var wlScore = wl.level < 0 ? 0 : wl.level / 3 * 100;

    // 文本粗相关性：claim 与 title/snippet 的字符 bigram 重合率（LLM 精排在 N2 做）
    var rel = textRelevance(claim.text || '', (item.title || '') + ' ' + (item.snippet || ''));

    // 时间新近度：EditTime 距今越近越高（无时间给中间值 50）
    var recency = 50;
    if (item.editTime) {
      var ageDays = (Date.now() / 1000 - item.editTime) / 86400;
      recency = Math.max(0, Math.min(100, 100 - ageDays / 365 * 20)); // 一年掉 20 分，下限 0
    }

    var score = auth * 0.45 + wlScore * 0.2 + rel * 0.25 + recency * 0.1;
    if (wl.level === 1) score -= 10;         // low 层降权
    if (wl.level < 0) score = -1;            // banned 直接出局

    return {
      score: Math.round(score),
      sourceType: stype,
      whitelist: { tier: wl.tier, level: wl.level, reason: wl.reason }
    };
  }

  // 字符 bigram 重合率（Dice 系数，中文友好，零依赖）
  function bigrams(s) {
    var out = new Set();
    s = String(s).toLowerCase().replace(/\s+/g, '');
    for (var i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }

  function textRelevance(a, b) {
    var A = bigrams(a), B = bigrams(b);
    if (!A.size || !B.size) return 0;
    var inter = 0;
    A.forEach(function (g) { if (B.has(g)) inter++; });
    return Math.round(inter * 2 / (A.size + B.size) * 100);
  }

  // ---------- 主流程：searchForClaim（§6 完整管线） ----------

  // claim: {text, sourceRequirement, objectType}
  // 返回 Promise<{candidates:[{...item, score, sourceType, whitelist, origin}], queries:[...]}>
  function searchForClaim(claim, options) {
    options = options || {};
    var ds = global.WCC_DATASOURCE;
    if (!ds || !ds.isAvailable()) return Promise.resolve({ candidates: [], queries: [], reason: 'datasource_unavailable' });

    var primary = buildPrimaryQuery(claim.text);
    if (!primary) return Promise.resolve({ candidates: [], queries: [], reason: 'empty_query' });

    // 关键词组：主查询 + 按来源需求的补充查询（补充查询仅用于 global 通道，避免站内噪声）
    var hint = SR_QUERY_HINTS[claim.sourceRequirement] || '';
    var secondary = hint ? (primary + ' ' + hint).slice(0, 80) : '';

    var answersOnly = options.zhihuAnswersOnly === true;
    var zhihuP = (answersOnly && ds.searchZhihuAnswers ? ds.searchZhihuAnswers(primary, 8) : ds.searchZhihu(primary, 5)).catch(function () { return []; });
    var globP = answersOnly ? Promise.resolve([]) : ds.searchGlobal(secondary || primary, 5).catch(function () { return []; });

    return Promise.all([zhihuP, globP]).then(function (r) {
      var seen = {};
      var candidates = [];
      r[0].forEach(function (it) { candidates.push(Object.assign({ origin: 'zhihu' }, it)); });
      r[1].forEach(function (it) { candidates.push(Object.assign({ origin: 'global' }, it)); });
      if (answersOnly && ds.isZhihuAnswer) candidates = candidates.filter(ds.isZhihuAnswer);

      // 去重（同 URL 保留先出现的=知乎通道优先）
      candidates = candidates.filter(function (c) {
        if (!c.url || seen[c.url]) return false;
        seen[c.url] = true;
        return true;
      });

      // 白名单过滤 + 打分排序
      candidates = candidates
        .map(function (c) {
          var s = scoreCandidate(c, { text: primary });
          c.score = s.score;
          c.sourceType = s.sourceType;
          c.whitelist = s.whitelist;
          return c;
        })
        .filter(function (c) { return c.whitelist.level >= 0; })
        .sort(function (a, b) { return b.score - a.score; });

      return {
        candidates: candidates,
        queries: { primary: primary, secondary: secondary },
        reason: answersOnly ? 'zhihu_answers_only' : 'ok',
        sourcePolicy: answersOnly ? 'zhihu_answers_only' : 'mixed'
      };
    });
  }

  global.WCC_SEARCH_CONTROLLER = {
    searchForClaim: searchForClaim,
    classifyByDomain: classifyByDomain,
    whitelistLevel: whitelistLevel,
    buildPrimaryQuery: buildPrimaryQuery,
    SOURCE_TYPES: SOURCE_TYPES,
    SOURCE_TYPE_NAMES: SOURCE_TYPE_NAMES,
    AUTHORITY_BASE: AUTHORITY_BASE
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
