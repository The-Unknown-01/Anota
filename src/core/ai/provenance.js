// Provenance Tracing（upgrade.md §17~§29，P1 + Phase4）
// 搜索后信源追踪：读取媒体/二手正文 → 提取上游线索 → 共同上游检测 → 受控上游检索 → Provenance Graph。
// 原则（§25）：不把"发布时间最早"当绝对首发，只追踪 Earliest Traceable Source；
// 预算（§33）：maxDepth / maxUpstreamCandidates / maxAdditionalSearches / maxPageReads 全部封顶。
(function (global) {
  'use strict';

  // ---------- §19 Provenance Extraction（规则式，零 LLM） ----------
  var UPSTREAM_PATTERNS = [
    // 中文引用："据 X 报道 / 援引 X / 来源 X"
    { re: /(?:据|按照|援引|引自|消息来源|来源|源自)\s*([\u4e00-\u9fa5A-Za-z0-9·]{2,24}?(?:社|通讯社|新闻社|通讯社|方面|官方|中心|部|局|署|委员会|研究所|大学|媒体|报|网|TV|News|Agency|Wire))/g, relation: 'EXPLICIT_CITATION' },
    // 中文转载："编译自 / 转载自 / 转自 / 摘编自 / 综合报道"
    { re: /(?:编译自|翻译自|综合自|转载自|转自|摘编自|内容(?:来源|源自)|本文(?:编译|综合)?(?:自|报道))[\s:：]*([^\s。；;]{2,30})/g, relation: 'REPOST' },
    // 英文引用
    { re: /(?:according to|reported by|as (?:quoted|reported) by|credit[\s:：]*)[\s:：]*([A-Za-z][A-Za-z0-9 .&'-]{2,40})/gi, relation: 'QUOTED_SOURCE' },
    // 原始采访
    { re: /(?:接受|在)[^，。]{0,24}?([\u4e00-\u9fa5A-Za-z]{2,14}?(?:社|TV|电视台|电台|报纸|网|记者|radio|television))[^，。]{0,16}?(?:采访|专访|时说|表示)/g, relation: 'INTERVIEW' }
  ];
  // 直接链接（"原文/来源: http..."）
  var LINK_HINTS = /(?:原文|来源|原报道|原链接|Source|Original|Read more|paper|doi)\s*[：: ]?\s*(https?:\/\/[^\s<>"']+)/gi;

  // 从正文提取上游线索 -> [{publisher, relation, evidence, url?}]
  function extractProvenance(text) {
    var clues = [];
    var seen = {};
    var t = String(text || '');
    if (!t) return clues;

    var i, p;
    for (i = 0; i < UPSTREAM_PATTERNS.length && clues.length < 6; i++) {
      p = UPSTREAM_PATTERNS[i];
      p.re.lastIndex = 0;
      var m;
      while ((m = p.re.exec(t)) !== null && clues.length < 6) {
        var name = String(m[1] || '').replace(/[，。；、\s：:]+$/g, '').trim();
        if (name.length >= 2 && !seen[p.relation + '|' + name]) {
          seen[p.relation + '|' + name] = true;
          clues.push({ publisher: name, relation: p.relation, evidence: m[0].slice(0, 60), url: null });
        }
      }
    }
    LINK_HINTS.lastIndex = 0;
    var lm;
    while ((lm = LINK_HINTS.exec(t)) !== null && clues.length < 8) {
      clues.push({ publisher: '', relation: 'EXPLICIT_LINK', evidence: lm[0].slice(0, 60), url: lm[1] });
    }
    return clues;
  }

  // ---------- §23 Common Provenance Detection / §28 Independence ----------
  // 输入：候选（含 provenanceClues）→ 注入 provenanceClusterId / independence / upstreamRoot
  function buildGraph(items) {
    var clusters = [];
    var clusterMap = {};
    items.forEach(function (it) {
      var clues = it.provenanceClues || [];
      // 取第一个非空上游（链接或具名引用）
      var up = null;
      for (var i = 0; i < clues.length; i++) {
        if (clues[i].url || clues[i].publisher) { up = clues[i]; break; }
      }
      if (up) {
        var key = up.url || up.publisher;
        if (!clusterMap[key]) {
          clusterMap[key] = 'pc-' + clusters.length;
          clusters.push({ root: key, rootUrl: up.url || null, members: [], relations: [] });
        }
        var cid = clusterMap[key];
        it.provenanceClusterId = cid;
        it.independence = 'SHARED_UPSTREAM';
        it.upstreamRoot = key;
        clusters[Number(cid.slice(3))].members.push(it.url);
        clusters[Number(cid.slice(3))].relations.push(up.relation);
      } else if (it.suspectedSyndication) {
        it.independence = 'DERIVED';
      } else {
        it.independence = 'INDEPENDENT';
      }
    });
    return { clusters: clusters, items: items };
  }

  // ---------- §24 / §31-33 Upstream Source Retrieval（Phase 3：受控递归溯源） ----------
  // trace(candidates, claim, budget):
  //   只追踪 media/org/疑似转载 候选（≤maxUpstreamCandidates）。
  //   递归：候选 → 线索 → 检索/直读上游 → 读上游 → 再抽线索 → 再追，直到：
  //     ① 命中一手/官方主源（域名特征或已无可追线索）② 环（visited）③ 深度 maxDepth ④ 预算耗尽。
  //   上游检索优先官方域定向（线索发布者命中官方域名表 → site:），否则 metaso（§16：复用统一检索的官方定向）。
  //   返回 { traced, upstreamHits, stops }（upstreamHits 带 depth/kind）。
  var PRIMARY_HOST = /(\.gov\b|\.gov\.|\.edu\b|\.edu\.|\.ac\.[a-z]{2}|\.mil\b|arxiv\.org|pubmed\.|who\.int|un\.org|\.int\b)/i;

  // 取最优线索：显式链接 > 具名引用（按已有顺序取第一条非空）
  function pickBestClue(clues) {
    if (!clues || !clues.length) return null;
    for (var i = 0; i < clues.length; i++) {
      if (clues[i].url) return clues[i];
    }
    for (var j = 0; j < clues.length; j++) {
      if (clues[j].publisher) return clues[j];
    }
    return null;
  }

  // 检索查询：线索带 URL → 直读；具名引用 → 引用主体 + 声明片段（避免泛搜）
  function upstreamQueryFor(clue, claim) {
    if (clue && clue.url) return clue.url;
    var pub = (clue && clue.publisher) || '';
    var ct = (claim && claim.text) ? String(claim.text) : '';
    return (pub + (ct ? ' ' + ct.slice(0, 40) : '')).slice(0, 120);
  }

  function trace(candidates, claim, budget) {
    var READER = global.WCC_WEB_READER;
    var DS = global.WCC_DATASOURCE;
    var QA = global.WCC_QUERY_ANALYZER;
    budget = budget || {};
    var maxUpstream = budget.maxUpstreamCandidates || 3;
    var maxDepth = budget.maxDepth || 3;
    var maxReads = budget.maxPageReads || 6;
    var maxSearches = budget.maxAdditionalSearches || 6;

    var targets = (candidates || []).filter(function (c) {
      var st = c.sourceAnalysis && c.sourceAnalysis.sourceType;
      return st === 'media' || st === 'org' || c.suspectedSyndication;
    }).slice(0, maxUpstream);
    if (!targets.length) return Promise.resolve({ traced: [], upstreamHits: [], stops: ['no_secondary_source'] });

    var acc = { reads: 0, searches: 0, stops: [], traced: [], upstreamHits: [] };
    var visited = {}; // url -> true，防环（根候选与上游共用）

    // 读 URL 正文并抽线索；返回 {url,title,text,clues} 或 null（失败/环/预算尽）
    function readAndClue(url) {
      if (visited[url]) { acc.stops.push('cycle'); return Promise.resolve(null); }
      if (acc.reads >= maxReads) { acc.stops.push('maxPageReads'); return Promise.resolve(null); }
      visited[url] = true;
      acc.reads++;
      return READER.readUrl(url).then(function (r) {
        if (!r.ok) { acc.stops.push('read_failed_' + (r.reason || 'unknown')); return null; }
        var clues = extractProvenance(r.text);
        acc.traced.push({ url: url, title: r.title || url, clues: clues });
        return { url: url, title: r.title || url, text: r.text, clues: clues };
      }).catch(function () { acc.stops.push('trace_error'); return null; });
    }

    // 判断是否已到主源/边界，否则递归追下一层
    function maybeRecurse(node, depth) {
      if (PRIMARY_HOST.test(String(node.url || ''))) { acc.stops.push('primary_source_reached'); return Promise.resolve(); }
      if (depth >= maxDepth) { acc.stops.push('maxDepth'); return Promise.resolve(); }
      var clue = pickBestClue(node.clues);
      if (!clue) { acc.stops.push('no_upstream_clue'); return Promise.resolve(); }
      return resolveClue(clue, node.url, depth);
    }

    // 解析一条上游线索：带 URL → 直读；具名引用 → 官方域定向/泛检索 → 读命中并递归
    function resolveClue(clue, fromUrl, depth) {
      if (clue && clue.url) {
        acc.upstreamHits.push({ from: fromUrl, clue: clue, hit: { url: clue.url, title: clue.publisher || '' }, depth: depth, kind: 'explicit_link' });
        return readAndClue(clue.url).then(function (n) { return n ? maybeRecurse(n, depth + 1) : Promise.resolve(); });
      }
      if (acc.searches >= maxSearches) { acc.stops.push('maxAdditionalSearches'); return Promise.resolve(); }
      var query = upstreamQueryFor(clue, claim);
      if (!query) { acc.stops.push('no_upstream_clue'); return Promise.resolve(); }
      // 官方域定向：线索发布者命中官方域名表 → 追加 site:
      var opts = {};
      var name = clue && clue.publisher ? String(clue.publisher).toLowerCase() : '';
      var ent = (QA && QA.ENTITY_OFFICIAL_DOMAINS) ? QA.ENTITY_OFFICIAL_DOMAINS[name] : null;
      if (ent && ent.domains && ent.domains[0]) opts = { siteDomain: ent.domains[0] };
      acc.searches++;
      return DS.engineSearch('metaso', query, 3, opts).catch(function () { return []; }).then(function (hits) {
        var hit = null;
        for (var i = 0; i < hits.length && !hit; i++) {
          var h = hits[i];
          if (!h || !h.url || h.url === fromUrl || visited[h.url]) continue;
          hit = h;
        }
        if (!hit) { acc.stops.push('no_upstream_hit'); return Promise.resolve(); }
        acc.upstreamHits.push({ from: fromUrl, clue: clue, hit: { url: hit.url, title: hit.title || '' }, depth: depth, kind: 'search' });
        return readAndClue(hit.url).then(function (n) { return n ? maybeRecurse(n, depth + 1) : Promise.resolve(); });
      });
    }

    // 串行处理各根候选（避免并发撞限流）
    var chain = Promise.resolve();
    targets.forEach(function (cand) {
      chain = chain.then(function () {
        return readAndClue(cand.url).then(function (n) {
          if (!n) return;
          cand.cachedBody = n.text;
          cand.cachedTitle = n.title;
          cand.provenanceClues = n.clues;
          var clue = pickBestClue(n.clues);
          if (!clue) { acc.stops.push('no_upstream_clue'); return; }
          return resolveClue(clue, cand.url, 1);
        });
      });
    });
    return chain.then(function () { return acc; });
  }

  // ---------- §26 Provenance Confidence（规则版） ----------
  function confidenceFor(item) {
    var clues = (item && item.provenanceClues) || [];
    if (!clues.length) return 'NONE';
    var hasLink = clues.some(function (c) { return c.relation === 'EXPLICIT_LINK' && c.url; });
    var hasCite = clues.some(function (c) { return c.relation === 'EXPLICIT_CITATION' || c.relation === 'QUOTED_SOURCE'; });
    if (hasLink && hasCite) return 'HIGH';
    if (hasLink || hasCite) return 'MEDIUM';
    return 'LOW'; // 仅 REPOST/INTERVIEW/推断
  }

  global.WCC_PROVENANCE = {
    extractProvenance: extractProvenance,
    buildGraph: buildGraph,
    trace: trace,
    confidenceFor: confidenceFor,
    UPSTREAM_PATTERNS: UPSTREAM_PATTERNS
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
