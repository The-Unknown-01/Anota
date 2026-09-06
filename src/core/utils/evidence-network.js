// V3.0 M1：证据网络数据模型（SW 与 panel 共用；纯函数、可单测）
// 输入 verification（verifyClaimV25 结果）与 LLM result（五态 + summary），
// 输出面板「证据网络图」需要的分组/节点/数字绑定模型。
// 渲染层（panel.js）只消费此模型，不直接读管线对象——保证可视层与算法结构解耦。
(function (global) {
  'use strict';

  // 与 analyzer.js DATA_TOKEN_RE 同源：只认带数据单位的数字（35% / 3.5万亿 / 37人）
  var DATA_TOKEN_RE = /\d+(?:\.\d+)?\s*(?:%|‰|万亿|亿|万|美元|元|人|名|起|例|次|辆|架|艘|吨|户|家|公里|千克)/g;
  function extractTokens(text) {
    var out = [], seen = {}, m, re = DATA_TOKEN_RE;
    re.lastIndex = 0;
    var s = String(text || '');
    while ((m = re.exec(s)) !== null && out.length < 8) {
      var tok = m[0].replace(/\s+/g, '');
      if (!seen[tok]) { seen[tok] = true; out.push(tok); }
    }
    return out;
  }

  var JUDGMENT_GROUP = {
    full: 'support', partial: 'support', contradict: 'contradict', irrelevant: 'unknown', insufficient: 'unknown'
  };
  var VERDICT_ZH = {
    full: '支持', partial: '部分支持', contradict: '矛盾', irrelevant: '不相关', insufficient: '无法判定'
  };

  // buildEvidenceNetwork(verification, llmResult) -> model
  //   verification: v25 结果（evidences[]/candidates[]/provenance/stats/binding）
  //   llmResult: { supportLevel, summary, evidences }（LLM 层）
  // model = {
  //   supportLevel, summary,
  //   groups: { support: [node], contradict: [node], unknown: [node] },
  //   groupOrder: ['support','contradict','unknown'],
  //   claimedTokens: [...],            // 结论 summary 中带单位数字
  //   provenance: { upstreamHits: [...], traced: [...] },   // 溯源链（原始结构）
  //   stats: { judged, readFailed, recovered }
  // }
  // node = { url, title, judgment, sourceType, originality, scoreTotal,
  //          quote, analysis, numbers: [{value,unit,direction}], 数字绑定 matched: [token],
  //          readError, recovered, provenanceChain: [from→url] }
  function buildEvidenceNetwork(verification, llmResult) {
    var model = {
      supportLevel: (llmResult && llmResult.supportLevel) || null,
      summary: (llmResult && llmResult.summary) || '',
      groups: { support: [], contradict: [], unknown: [] },
      groupOrder: ['support', 'contradict', 'unknown'],
      claimedTokens: extractTokens((llmResult && llmResult.summary) || ''),
      provenance: null,
      stats: { judged: 0, readFailed: 0, recovered: 0 }
    };
    if (!verification) return model;

    // url → candidate（补 sourceAnalysis/originality/scoreTotal/provenanceClusterId）
    var candByUrl = {};
    (verification.candidates || []).forEach(function (c) {
      if (c && c.url && !candByUrl[c.url]) candByUrl[c.url] = c;
    });

    // 每个候选的溯源链（来自 upstreamHits：这条候选被哪些上游引用 / 它引用到哪）
    var upByFrom = {}, upHitByUrl = {};
    var prov = verification.provenance || {};
    (prov.upstreamHits || []).forEach(function (h) {
      if (!h) return;
      if (h.from) (upByFrom[h.from] = upByFrom[h.from] || []).push(h);
      if (h.hit && h.hit.url) (upHitByUrl[h.hit.url] = upHitByUrl[h.hit.url] || []).push(h);
    });
    model.provenance = {
      upstreamHits: prov.upstreamHits || [],
      traced: prov.traced || [],
      upByFrom: upByFrom,
      upHitByUrl: upHitByUrl
    };

    // 逐源判定节点（v.evidences：judgedAll 明细）
    (verification.evidences || []).forEach(function (ev) {
      if (!ev || !ev.judgment) return;
      var v = ev.judgment.verdict || 'insufficient';
      var group = JUDGMENT_GROUP[v] || 'unknown';
      var cand = candByUrl[ev.url] || {};
      var srcA = cand.sourceAnalysis || {};
      var node = {
        url: ev.url || '',
        title: ev.title || ev.url || '(无标题)',
        judgment: v,
        judgmentZh: VERDICT_ZH[v] || v,
        sourceType: srcA.sourceType || (ev.sourceType === 'Answer' ? 'zhihu' : ev.sourceType) || 'other',
        registryVerified: !!(cand.registryInfo && cand.registryInfo.tier === 'verified'),
        originality: (srcA.originality === 'original') ? '一手'
          : (ev.suspectedSyndication || cand.suspectedSyndication) ? '疑似转载' : null,
        scoreTotal: cand.scoreTotal != null ? Math.round(cand.scoreTotal) : null,
        quote: ev.judgment.quote || '',
        analysis: ev.judgment.analysis || '',
        numbers: (ev.numbers || []).map(function (n) { return { value: n.value, unit: n.unit || '', direction: n.direction || '' }; }),
        readError: ev.readError || null,
        recovered: !!ev.recovered,
        recoveredUrl: ev.recoveredUrl || null,
        evidenceClusterId: ev.evidenceClusterId || null,
        provenanceChain: (upByFrom[ev.url] || []).map(function (h) {
          return { url: h.hit && h.hit.url, title: (h.hit && h.hit.title) || '', depth: h.depth, kind: h.kind };
        })
      };
      // 数字绑定：该证据页抽取的数值 token
      var evTokens = [];
      node.numbers.forEach(function (n) { evTokens.push(String(n.value) + String(n.unit)); });
      (ev.quote || '').split(/[，。；\s]/).forEach(function (seg) {
        extractTokens(seg).forEach(function (t) { if (evTokens.indexOf(t) < 0) evTokens.push(t); });
      });
      node.matched = model.claimedTokens.filter(function (t) { return evTokens.indexOf(t) >= 0; });
      model.groups[group].push(node);
      model.stats.judged++;
      if (ev.readError) model.stats.readFailed++;
      if (ev.recovered) model.stats.recovered++;
    });

    // 组内按分数降序
    ['support', 'contradict', 'unknown'].forEach(function (g) {
      model.groups[g].sort(function (a, b) { return (b.scoreTotal || 0) - (a.scoreTotal || 0); });
    });
    return model;
  }

  global.WCC_EVIDENCE_NETWORK = {
    buildEvidenceNetwork: buildEvidenceNetwork,
    extractTokens: extractTokens,
    VERDICT_ZH: VERDICT_ZH
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
