// Trusted Source Registry（V2.5 M2）：来源先验，不是绝对准入规则。
// 升级要求 §4：verified(已确认可信) / candidate(候选) / restricted(受限) 三层；
// 核心原则：未知来源不删除 → 进入候选池 → 来源分析 → 获得临时评价。
// 从 V2.0 四级白名单（priority/allow/low/banned）迁移升级：registry tier 影响
// Scoring Engine 的先验分（M5），仅 restricted 走硬过滤候选。
(function (global) {
  'use strict';

  // ---------- seed 表：host 正则（不带斜杠定界符的 JS RegExp 源串） ----------

  var REGISTRY = {
    verified: [
      // 政府
      { pattern: '\\.gov\\.cn$', label: '中国政府' },
      { pattern: '(\\.|^)gov$', label: '外国政府' },
      { pattern: '(\\.|^)gov\\.uk$', label: '英国政府' },
      { pattern: '(\\.|^)gov\\.au$', label: '澳大利亚政府' },
      { pattern: '(\\.|^)go\\.jp$', label: '日本政府' },
      { pattern: '(\\.|^)gouv\\.fr$', label: '法国政府' },
      { pattern: '(\\.|^)gov\\.[a-z]{2}$', label: '外国政府' },
      { pattern: '^un\\.org$', label: '联合国' },
      { pattern: '^who\\.int$', label: 'WHO' },
      { pattern: '(\\.|^)worldbank\\.org$', label: '世界银行' },
      // search_advise §14 / §23：重点官方机构域名（显式列出，label 供面板展示）
      { pattern: '^stats\\.gov\\.cn$', label: '国家统计局' },
      { pattern: '^npc\\.gov\\.cn$', label: '全国人大' },
      { pattern: '^court\\.gov\\.cn$', label: '最高人民法院' },
      { pattern: '^spp\\.gov\\.cn$', label: '最高人民检察院' },
      { pattern: '^pbc\\.gov\\.cn$', label: '中国人民银行' },
      { pattern: '^moe\\.gov\\.cn$', label: '教育部' },
      { pattern: '^miit\\.gov\\.cn$', label: '工信部' },
      { pattern: '^mof\\.gov\\.cn$', label: '财政部' },
      { pattern: '^nhc\\.gov\\.cn$', label: '国家卫健委' },
      { pattern: '^most\\.gov\\.cn$', label: '科技部' },
      // 国际机构（§24：NASA / ESA / FDA / EU / CDC / NIH 等）
      { pattern: '^nasa\\.gov$', label: 'NASA' },
      { pattern: '^esa\\.int$', label: 'ESA 欧洲航天局' },
      { pattern: '(\\.|^)[a-z0-9-]+\\.int$', label: '国际组织' },
      { pattern: '^fda\\.gov$', label: '美国 FDA' },
      { pattern: '(\\.|^)europa\\.eu$', label: '欧盟' },
      { pattern: '^cdc\\.gov$', label: '美国 CDC' },
      { pattern: '^nih\\.gov$', label: '美国 NIH' },
      { pattern: '^state\\.gov$', label: '美国国务院' },
      { pattern: '^whitehouse\\.gov$', label: '美国白宫' },
      // 学术科研
      { pattern: '\\.edu\\.cn$', label: '中国高校' },
      { pattern: '\\.edu$', label: '国外高校' },
      { pattern: '(\\.|^)ac\\.uk$', label: '英国高校' },
      { pattern: '(\\.|^)ac\\.jp$', label: '日本高校' },
      { pattern: '(\\.|^)edu\\.[a-z]{2}$', label: '国外高校' },
      { pattern: '(\\.|^)cas\\.cn$', label: '中科院' },
      { pattern: '^nature\\.com$', label: 'Nature' },
      { pattern: '^science\\.org$', label: 'Science' },
      { pattern: '(\\.|^)cell\\.com$', label: 'Cell' },
      { pattern: '(\\.|^)springer\\.com$', label: 'Springer' },
      { pattern: '(\\.|^)sciencedirect\\.com$', label: 'ScienceDirect' },
      { pattern: '^arxiv\\.org$', label: 'arXiv' },
      { pattern: '(\\.|^)ieee\\.org$', label: 'IEEE' },
      { pattern: '(\\.|^)acm\\.org$', label: 'ACM' },
      // 论文库
      { pattern: '(\\.|^)cnki\\.net$', label: '知网' },
      { pattern: '(\\.|^)wanfangdata\\.com\\.cn$', label: '万方' },
      { pattern: '^pubmed\\.ncbi\\.nlm\\.nih\\.gov$', label: 'PubMed' }
    ],
    restricted: [
      // 低质聚合/内容农场（seed 少而准；新发现走 candidate 分析后人工确认）
      { pattern: '^baijiahao\\.baidu\\.com$', label: '百家号' },
      { pattern: '(\\.|^)sohu\\.com$', label: '搜狐号聚合' },
      { pattern: '(\\.|^)toutiao\\.com$', label: '头条号聚合' },
      { pattern: '(\\.|^)163\\.com$', label: '网易号聚合' },
      { pattern: '(\\.|^)docin\\.com$', label: '文档库' },
      { pattern: '(\\.|^)doc88\\.com$', label: '文档库' },
      { pattern: '^wenku\\.baidu\\.com$', label: '百度文库' }
    ],
    candidate: [
      // 已知主体但需逐次分析的来源：权威媒体等
      { pattern: '^people\\.com\\.cn$', label: '人民日报' },
      { pattern: '^xinhuanet\\.com$', label: '新华社' },
      { pattern: '^news\\.cn$', label: '新华社' },
      { pattern: '(\\.|^)cctv\\.com$', label: '央视' },
      { pattern: '^thepaper\\.cn$', label: '澎湃新闻' },
      { pattern: '^caixin\\.com$', label: '财新' },
      { pattern: '^jiemian\\.com$', label: '界面新闻' },
      { pattern: '^21jingji\\.com$', label: '21财经' },
      { pattern: '^yicai\\.com$', label: '第一财经' },
      { pattern: '^stdaily\\.com$', label: '科技日报' },
      { pattern: '^sciencenet\\.cn$', label: '科学网' },
      { pattern: '^zhuanlan\\.zhihu\\.com$', label: '知乎专栏' },
      { pattern: '^zhihu\\.com$', label: '知乎' },
      // search_advise §15：微信公众号/微博——主体需 LLM 逐次识别，不预设高权威
      { pattern: '^mp\\.weixin\\.qq\\.com$', label: '微信公众号' },
      { pattern: '(\\.|^)weibo\\.com$', label: '微博' }
    ]
  };

  var PRIORS = { verified: 95, candidate: 60, unknown: 45, restricted: 15 };

  function extractHost(url) {
    var m = String(url || '').toLowerCase().match(/^https?:\/\/([^\/?#]+)/);
    if (!m) return '';
    var host = m[1];
    // 剥离 www. 前缀（registry 规则按裸域书写；与 url-utils 归一化口径一致）
    if (host.indexOf('www.') === 0) host = host.slice(4);
    return host;
  }

  function compile(src) {
    if (!src.__re) src.__re = new RegExp(src.pattern);
    return src.__re;
  }

  // lookup(url) -> { tier, prior(0-100), label, known }
  function lookup(url) {
    var host = extractHost(url);
    if (!host) return { tier: 'unknown', prior: PRIORS.unknown, label: '', known: false };
    var tiers = ['verified', 'restricted', 'candidate'];
    for (var t = 0; t < tiers.length; t++) {
      var list = REGISTRY[tiers[t]];
      for (var i = 0; i < list.length; i++) {
        if (compile(list[i]).test(host)) {
          return { tier: tiers[t], prior: PRIORS[tiers[t]], label: list[i].label || '', known: true };
        }
      }
    }
    // 未知来源：不删除 → 候选池默认先验（§4 核心原则）
    return { tier: 'unknown', prior: PRIORS.unknown, label: '', known: false };
  }

  global.WCC_SOURCE_REGISTRY = {
    lookup: lookup,
    REGISTRY: REGISTRY,
    PRIORS: PRIORS
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
