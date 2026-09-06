// Evidence Extractor（Phase 2 · 修订版 §20-23 / A2）：
// Web Reader → 【Evidence Extraction】 → Verify 的中间层。
// 原则：数字/百分比/金额/日期 用正则先抽（零 LLM、零成本）；
//       语义（同比/环比/方向归属/主体）留待后续 LLM 兜底（Phase 6 需要 dataPeriod 时再启用）。
// 关键目标：解决"AI 读到了整段话却说没有数字"——把正文里的数值显式结构化后交给 Verify 核对。
(function (global) {
  'use strict';

  // ---------- 数值抽取正则（保守、顺序敏感） ----------
  // percent(百分比) / amount_cn(万亿·亿·万) / count(带单位计数) / year(年份)
  var PATTERNS = [
    { kind: 'percent', re: /([\d,]+(?:\.\d+)?)\s*%/g },
    { kind: 'amount_cn', re: /([\d,]+(?:\.\d+)?)\s*(万亿|亿|万)/g },
    { kind: 'count', re: /([\d,]+(?:\.\d+)?)\s*(元|美元|人民币|人|名|起|例|次|辆|架|艘|吨|公里|千克|公斤|户|家)/g },
    { kind: 'year', re: /(20\d{2})\s*年/g }
  ];
  var DIR_UP = /(上涨|上升|增长|增加|提高|涨幅|提升|反弹|刷新|新高|增至|升至|攀至)/;
  var DIR_DOWN = /(下降|下跌|下滑|减少|降低|跌幅|回落|缩水|负增长|降至|跌至)/;

  // 命中上下文窗口（前后 ~30 字），用于方向判断与证据句
  function contextAround(text, index, len) {
    var start = Math.max(0, index - 30);
    var end = Math.min(text.length, index + len + 30);
    return text.slice(start, end).replace(/[ \t\r\f]+/g, ' ');
  }

  function detectDirection(ctx) {
    if (DIR_UP.test(ctx)) return 'increase';
    if (DIR_DOWN.test(ctx)) return 'decrease';
    return 'neutral';
  }

  // extractNumericEvidence(text, limit) -> [{kind, value, unit, direction, sentence}]
  // 纯规则、零 LLM。最多 limit 条（默认 8）；同值同句去重。
  function extractNumericEvidence(text, limit) {
    var t = String(text || '');
    var out = [];
    var seen = {};
    var lim = limit || 8;
    for (var p = 0; p < PATTERNS.length && out.length < lim; p++) {
      var pat = PATTERNS[p];
      pat.re.lastIndex = 0;
      var m;
      while ((m = pat.re.exec(t)) !== null && out.length < lim) {
        var val = m[1];
        var unit = pat.kind === 'percent' ? '%'
                 : pat.kind === 'amount_cn' ? m[2]
                 : pat.kind === 'count' ? (m[2] || '')
                 : '';
        var ctx = contextAround(t, m.index, m[0].length);
        var sentence = ctx.trim();
        var key = pat.kind + '|' + val + '|' + sentence.slice(0, 24);
        if (!seen[key]) {
          seen[key] = true;
          out.push({
            kind: pat.kind,
            value: val,
            unit: unit,
            direction: detectDirection(ctx),
            sentence: sentence
          });
        }
      }
    }
    return out;
  }

  // formatForPrompt(evs) -> string：注入判定 prompt 的结构化数值块（Phase 2 核心用途）
  function formatForPrompt(evs) {
    if (!evs || !evs.length) return '';
    var lines = evs.map(function (e, i) {
      var extra = e.direction !== 'neutral' ? '（趋势:' + e.direction + '）' : '';
      return '数值' + (i + 1) + ': ' + e.sentence + ' 【= ' + e.value + (e.unit || '') + extra + '】';
    });
    return '【来源正文中检测到的数值（据此核对声明中的数字与方向；引用仍须逐字摘自原文）】\n' + lines.join('\n');
  }

  // ---------- Phase 5（A4 前置）：当前页元数据抽取 ----------
  // 从 HTML 的 <meta> / JSON-LD 提取 publisher / publishedAt / author（尽力而为；缺失给空串）。
  function metaContent(html, key) {
    var s = String(html || '');
    var re = new RegExp('<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["\']' + key.replace(/"/g, '') + '["\'][^>]*>', 'i');
    var m = s.match(re);
    if (!m) return '';
    var cm = m[0].match(/content\s*=\s*["']([^"']*)["']/i);
    return cm ? cm[1].trim() : '';
  }
  function extractPageMeta(html) {
    var s = String(html || '');
    var publishedAt = metaContent(s, 'article:published_time') || metaContent(s, 'pubdate') ||
                      metaContent(s, 'datePublished') || metaContent(s, 'datepublished') || '';
    var author = metaContent(s, 'author') || metaContent(s, 'article:author') || '';
    var publisher = metaContent(s, 'article:publisher') || metaContent(s, 'og:site_name') || '';
    // JSON-LD 兜底（article / newsarticle 顶层字段）
    var ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i;
    var lm = s.match(ldRe);
    if (lm) {
      try {
        var j = JSON.parse(lm[1]);
        if (Array.isArray(j)) j = j[0] || {};
        if (!publishedAt) publishedAt = j.datePublished || '';
        if (!author) author = (j.author && (typeof j.author === 'string' ? j.author : j.author.name)) || '';
        if (!publisher) publisher = (j.publisher && j.publisher.name) || '';
      } catch (e) { /* JSON-LD 解析失败忽略 */ }
    }
    return {
      publisher: String(publisher || '').slice(0, 60),
      publishedAt: String(publishedAt || '').slice(0, 40),
      author: String(author || '').slice(0, 60)
    };
  }

  global.WCC_EVIDENCE_EXTRACTOR = {
    extractNumericEvidence: extractNumericEvidence,
    formatForPrompt: formatForPrompt,
    extractPageMeta: extractPageMeta,
    metaContent: metaContent
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
