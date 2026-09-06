// Scoring Engine（V2.5 M5 + search_advise §7~§13）：结构化来源信息 → 八维评分 → 综合排序。
// 升级要求 §6/§7/§8 + search_advise：
//   - Authority 与 Originality 分离（高权威媒体≠一手来源）；
//   - 八维：authority/relevance/directness/entity/scope/temporal/originality/evidence 各 0-100；
//   - preferredSources 真正进入评分（§6.1）；Evidence Directness / Entity / Geo Scope / Temporal（§8~§11）；
//   - LLM 只理解来源，本引擎做确定性综合排序；
//   - 流程：硬过滤 → 分类/分析已由上游完成 → 评分 → 排序。
(function (global) {
  'use strict';

  var REGISTRY = global.WCC_SOURCE_REGISTRY;

  // ---------- 权重（search_advise §7 / §12：八维综合评分） ----------
  // authority 0.25：来源可靠性根基（registry 先验 + 类型先验取大）
  // relevance 0.20：与 claim 关键词重合度（纯文本信号，不再独占高权重）
  // directness 0.15：是否直接回答当前问题（§8 Evidence Directness）
  // entity 0.12：来源主体与问题主体是否一致（§9 Entity Match）
  // scope 0.08：地域范围匹配（§10 Geographic Scope，解决"全国人口 vs 县级报告"）
  // temporal 0.06：时间匹配（§11 Temporal Match，避免 2023 报告顶替 2025 数据）
  // originality 0.08：一手性（原始发布 vs 转载/汇编）
  // evidence 0.06：内容证据强度启发式（数字/官方文件词根）
  var WEIGHTS = {
    authority: 0.25, relevance: 0.20, directness: 0.15, entity: 0.12,
    scope: 0.08, temporal: 0.06, originality: 0.08, evidence: 0.06
  };

  var SCORE_TYPE = {
    // 来源类型先验 authority 表（registry prior 与类型先验融合取较大者）
    gov: 95, paper: 92, acad: 88, org: 78, media: 70, biz: 55, zhihu: 50, other: 45
  };
  // 一手性得分（originality 维度；与 authority 完全独立计算）
  var SCORE_ORIGINALITY = { original: 95, secondary: 45, tertiary: 20 };

  // ---------- 硬过滤（§7 先过滤后评分） ----------
  function hardFilter(item) {
    if (!item || !item.url) return false;                 // 无 URL
    if (item.junk === true) return false;                  // 明显垃圾
    var t = item.registryInfo && item.registryInfo.tier;
    if (t === 'restricted') return false;                  // 受限来源出局（唯一硬准入点）
    return true;
  }

  function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

  function hostOf(url) {
    var m = String(url || '').toLowerCase().match(/^https?:\/\/([^\/?#]+)/);
    if (!m) return '';
    var h = m[1];
    if (h.indexOf('www.') === 0) h = h.slice(4);
    return h;
  }

  // freshScore(publishedDate|recencyHint)：有时间窗时按年份距当前衰减
  function freshnessScore(item, timeWindow) {
    var d = null;
    if (item.publishedDate) {
      d = new Date(item.publishedDate);
      if (isNaN(d.getTime())) d = null;
    }
    if (!d) {
      // metaso 常给中文日期串（"2025年03月17日"），尝试解析
      var m = String(item.publishedDate || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
      if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    if (!d) return 50; // 无日期：中性分
    var years = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
    var windowYears = timeWindow ? parseInt(timeWindow, 10) || null : null;
    var cap = windowYears || 10;
    var score = 100 - Math.min(100, (years / cap) * 100);
    return clamp(score);
  }

  // relevanceScore(item, strategy)：snippet/title 与关键词组（中 + 英）的重合度（确定性计算）
  // search_advise §3.2：keywordsEn 参与匹配——英文官方页对英文 Query 命中，不再被中文关键词误伤
  function relevanceScore(item, strategy) {
    var text = String((item.title || '') + ' ' + (item.snippet || '')).toLowerCase();
    var kws = [].concat((strategy && strategy.keywords) || [], (strategy && strategy.keywordsEn) || []);
    if (!kws.length) return 60;
    var hits = 0;
    kws.forEach(function (k) {
      // 关键词可能是词组：拆单字词与整组都算命中信号
      if (text.indexOf(String(k).toLowerCase()) >= 0) hits += 1;
      else {
        var parts = String(k).split(/\s+/);
        var sub = parts.filter(function (p) { return p.length >= 2 && text.indexOf(p.toLowerCase()) >= 0; }).length;
        hits += sub / Math.max(1, parts.length) * 0.8;
      }
    });
    return clamp(hits / kws.length * 100);
  }

  // §8 Evidence Directness：来源是否直接回答当前问题（确定性近似）
  // 标题命中关键词/聚焦短语/问题数字 = 直接回答的强信号；
  // 实体官方域直中（如 nasa.gov 回答 NASA 问题）= 第一手口径，直接性加成（§24）
  function directnessScore(item, strategy, claimText) {
    var title = String(item.title || '').toLowerCase();
    var text = String((item.title || '') + ' ' + (item.snippet || '')).toLowerCase();
    var score = 20; // 基准分
    var kws = [].concat((strategy && strategy.keywords) || [], (strategy && strategy.keywordsEn) || []);
    if (kws.length) {
      var titleHits = 0, textHits = 0;
      kws.forEach(function (k) {
        var kl = String(k).toLowerCase();
        if (!kl) return;
        if (title.indexOf(kl) >= 0) { titleHits += 1; return; }
        if (text.indexOf(kl) >= 0) { textHits += 1; return; }
        // 词组拆部分词（如 "民法典 颁布 时间" → 民法典/颁布/时间）：部分命中计入弱信号
        var parts = kl.split(/\s+/).filter(function (p) { return p.length >= 2; });
        if (parts.length > 1) {
          var titleParts = parts.filter(function (p) { return title.indexOf(p) >= 0; }).length;
          var textParts = parts.filter(function (p) { return text.indexOf(p) >= 0; }).length;
          titleHits += titleParts / parts.length;
          textHits += Math.max(0, textParts - titleParts) / parts.length;
        }
      });
      score += titleHits / kws.length * 55;
      score += textHits / kws.length * 25;
    } else {
      score += 35;
    }
    // 问题聚焦短语（questionFocus）：标题含"颁布时间"这类短语 = 直接回答
    var focus = strategy && strategy.questionFocus ? String(strategy.questionFocus).toLowerCase() : '';
    if (focus) {
      if (title.indexOf(focus) >= 0) score += 25;
      else if (text.indexOf(focus) >= 0) score += 12;
    }
    // 问题中的年份/数字出现在来源文本 → 强直接信号（民法典颁布年份 vs 案例实施年份）
    var nums = String(claimText || '').match(/\d{4}|[\d,.]+(?:万|亿|%)/g) || [];
    var hasNum = nums.some(function (n) { return text.indexOf(n.toLowerCase()) >= 0; });
    if (hasNum) score += 15;
    // 实体官方域直中（§24）：nasa.gov 回答 NASA 问题 = 第一手口径，直接性加成
    var ents = (strategy && strategy.entities) || [];
    var host = hostOf(item.url);
    if (ents.some(function (e) {
      return (e.domains || []).some(function (d) { return host === d || host.indexOf('.' + d) >= 0; });
    })) score += 30;
    return clamp(score);
  }

  // §9 Entity Match：来源主体 = 问题主体？（实体名命中标题/摘要，或来源域名即实体官方域）
  function entityMatchScore(item, strategy) {
    var ents = (strategy && strategy.entities) || [];
    if (!ents.length) return 50; // 无实体信息：中性
    var text = String((item.title || '') + ' ' + (item.snippet || '')).toLowerCase();
    var host = hostOf(item.url);
    var best = 0;
    ents.forEach(function (e) {
      var domains = e.domains || [];
      // 官方域名直中 → 满分（最强信号，如 nasa.gov 命中 NASA）
      if (domains.some(function (d) { return host === d || host.indexOf('.' + d) >= 0; })) {
        if (best < 100) best = 100;
        return;
      }
      var name = String(e.name || '').toLowerCase();
      if (!name) return;
      if (text.indexOf(name) >= 0) { if (best < 90) best = 90; return; }
      // 实体名前缀弱命中（≥3 字时取前 60%）
      if (name.length >= 3) {
        var prefix = name.slice(0, Math.max(2, Math.floor(name.length * 0.6)));
        if (text.indexOf(prefix) >= 0) { if (best < 60) best = 60; }
      }
    });
    return best || 0; // 有实体但来源完全不含实体 → 0（宁可严格）
  }

  // §10 Geographic Scope Match：问题地域范围 vs 来源主体地域范围
  var SCOPE_LEVEL = { global: 5, national: 4, province: 3, city: 2, county: 1, unknown: 0 };
  function scopeMatchScore(item, strategy) {
    var q = strategy && strategy.scopeLevel;
    var s = item.sourceAnalysis && item.sourceAnalysis.scopeLevel;
    if (!q || q === 'unknown' || !s || s === 'unknown') return 50; // 信息不足 → 中性
    var a = SCOPE_LEVEL[q], b = SCOPE_LEVEL[s];
    if (a === b) return 100;
    var diff = Math.abs(a - b);
    if (diff === 1) return 70;
    if (diff === 2) return 40;
    return 20; // 全国 vs 县级 → 严重不匹配（§10 核心场景）
  }

  // §11 Temporal Match：问题年份 vs 来源发布时间（防止 2023 报告顶替 2025 数据）
  // P0-4：接入 temporalMode —— timeless 时间不参与；historical 无年份不惩罚旧资料；
  //       其余（current/recent/evolving/as_of）沿用年份匹配 + 新近度衰减。
  function temporalMatchScore(item, strategy, claimText) {
    var mode = (strategy && strategy.temporalMode) || 'recent';
    if (mode === 'timeless') return 50; // 不随时间变化：时间维度中性
    var m = String(claimText || '').match(/(20\d{2}|19\d{2})年?/);
    var qYear = m ? Number(m[1]) : null;
    var srcYear = null;
    if (item.publishedDate) {
      var dm = String(item.publishedDate).match(/(20\d{2}|19\d{2})/);
      if (dm) srcYear = Number(dm[1]);
    }
    if (!qYear && !srcYear) return 50;
    if (!qYear) {
      if (!srcYear) return 50;
      if (mode === 'historical') return 50; // 历史事实：不因来源旧而惩罚
      var age = new Date().getFullYear() - srcYear;
      return clamp(age <= 1 ? 85 : age <= 3 ? 70 : age <= 5 ? 55 : 30);
    }
    if (!srcYear) return 55; // 问题有年份、来源无年份：不给高分但不惩罚
    var diff = Math.abs(qYear - srcYear);
    if (diff === 0) return 100;
    if (diff === 1) return 80;
    if (diff === 2) return 60;
    return clamp(100 - diff * 15);
  }

  // evidenceScore(item)：内容证据强度启发式（数字/百分号/文件词根存在性）
  function evidenceScore(item) {
    var s = String(item.snippet || '');
    var score = 40;
    if (/\d+(?:\.\d+)?%/.test(s)) score += 20;
    if (/[\d,.]+(?:万|亿|万亿)/.test(s)) score += 20;
    if (/文件|通知|公告|报告|论文|数据显示|研究表明/.test(s)) score += 15;
    if (s.length > 120) score += 5;
    return clamp(score);
  }

  // §新 Event Fit：候选是否谈论同一事件（用 ET.eventHints 的事件线索匹配 title/snippet）。
  // 事件线索如 ["价格上涨"] / ["停止生产"]；命中越多越高。无事件线索 → 中性 50。
  function eventFitScore(item, strategy) {
    var hints = (strategy && strategy.eventHints) || [];
    if (!hints.length) return 50; // 无事件线索：中性
    var text = String((item.title || '') + ' ' + (item.snippet || '')).toLowerCase();
    var hits = 0;
    hints.forEach(function (h) {
      if (h && text.indexOf(String(h).toLowerCase()) >= 0) hits += 1;
    });
    return clamp(Math.round(hits / hints.length * 100));
  }

  // ---------- Target Compatibility 门控（接线修复） ----------
  // 在八维加权之前，先判断"候选是否真的适配当前 Evidence Target"。
  // 原则：强降级而非硬排除（宁漏判不错杀）——不匹配 → 总分乘折扣，保留但沉底。
  // 复用已计算的 entity/temporal/scope 维度（来自 dims），补上缺失的 event fit 与 source-type fit。
  // 返回 { multiplier, reasons, event }。
  function targetCompatibility(item, strategy, dims) {
    var a = item.sourceAnalysis || {};
    var st = a.sourceType || 'other';
    var reasons = [];
    var multiplier = 1;

    // 1) Source-type fit：候选来源类型是否在 ET.preferredSources 里
    var preferred = (strategy && strategy.preferredSources) || [];
    if (preferred.length && preferred.indexOf(st) < 0) {
      reasons.push('source_type_mismatch');
      multiplier *= 0.5;
    }

    // 2) Entity fit：复用 dims.entity；匿名/未解析主体（AMBIGUOUS/UNRESOLVED）不惩罚
    var ambiguous = !!(strategy && (strategy.entityResolutionStatus === 'AMBIGUOUS' || strategy.entityResolutionStatus === 'UNRESOLVED'));
    var hasEntity = !!(strategy && strategy.entities && strategy.entities.length);
    if (hasEntity && !ambiguous && dims.entity < 30) {
      reasons.push('entity_mismatch');
      multiplier *= 0.4;
    }

    // 3) Event fit：候选是否谈论同一事件
    var ev = eventFitScore(item, strategy);
    if ((strategy && strategy.eventHints && strategy.eventHints.length) && ev < 30) {
      reasons.push('event_mismatch');
      multiplier *= 0.4;
    }

    // 4) Temporal fit：严重时间不符（>5 年旧资料等）才降级
    if (dims.temporal <= 40) {
      reasons.push('temporal_mismatch');
      multiplier *= 0.6;
    }

    // 5) Scope fit：全国 vs 县级这类严重地域不符才降级
    if (dims.scope <= 20) {
      reasons.push('scope_mismatch');
      multiplier *= 0.6;
    }

    return { multiplier: multiplier, reasons: reasons, event: ev };
  }

  // ---------- 对外入口 ----------

  // rank(items, strategy, claimText) -> { ranked, filtered }
  // 前置要求：items 已过 url-utils 归一、source-analyzer 分析、evidence-graph 聚簇。
  // 每条注入 scores{8维} + prefBonus + scoreTotal + whyText。
  // §6.1：preferredSources 真正进入评分（来源类型先验加分）；§13：高权威 + 高直接 = 第一优先级。
  function rank(items, strategy, claimText) {
    claimText = String(claimText || '');
    var kept = items.filter(hardFilter);
    var filtered = items.length - kept.length;

    var preferred = (strategy && strategy.preferredSources) || [];

    kept.forEach(function (it) {
      var reg = it.registryInfo || REGISTRY.lookup(it.url);
      var a = it.sourceAnalysis || {};
      var st = a.sourceType;
      var typeAuth = SCORE_TYPE[st] || SCORE_TYPE.other;

      var dims = {
        authority: clamp(Math.max(reg.prior, typeAuth)),
        relevance: relevanceScore(it, strategy),
        directness: directnessScore(it, strategy, claimText),
        entity: entityMatchScore(it, strategy),
        scope: scopeMatchScore(it, strategy),
        temporal: temporalMatchScore(it, strategy, claimText),
        originality: SCORE_ORIGINALITY[a.originality] || SCORE_ORIGINALITY.secondary,
        evidence: evidenceScore(it)
      };

      // §6.1：preferredSources 作为来源类型先验加分（策略字段必须真正生效）
      var prefBonus = preferred.indexOf(st) >= 0 ? 8 : 0;
      // §13 First-Party Bonus：原始发布 + 官方/学术/论文类型
      var firstPartyBonus = (a.originality === 'original' && (st === 'gov' || st === 'paper' || st === 'acad')) ? 5 : 0;
      // §17/§18：转载惩罚（媒体数量 ≠ 独立证据数量）
      var syndPenalty = it.suspectedSyndication ? 6 : 0;
      // upgrade.md §15/§16：确认是目标论文（TARGET_PAPER）→ 身份奖励
      var targetPaperBonus = it.paperStatus === 'TARGET_PAPER' ? 6 : 0;

      // Target Compatibility 门控（新增）：加权后按 Evidence Target 适配度乘法降级。
      var tc = targetCompatibility(it, strategy, dims);

      var total = 0;
      for (var k in WEIGHTS) total += dims[k] * WEIGHTS[k];
      total += (prefBonus + firstPartyBonus + targetPaperBonus - syndPenalty);
      total = total * tc.multiplier;

      it.scores = dims;
      it.prefBonus = prefBonus;
      it.targetCompat = tc;
      it.scoreTotal = clamp(total);

      // 一句话解释（面板展示用）
      var reasons = [];
      if (reg.tier === 'verified') reasons.push(reg.label || '权威机构');
      if (it.paperStatus === 'TARGET_PAPER') reasons.push('目标论文');
      else if (it.paperStatus === 'RELATED_PAPER') reasons.push('相关论文');
      if (dims.entity >= 90) reasons.push('主体匹配');
      if (dims.scope >= 100) reasons.push('地域范围匹配');
      if (dims.directness >= 75) reasons.push('直接回应问题');
      if (prefBonus) reasons.push('来源类型优先');
      if (dims.originality >= 95) reasons.push('原始发布');
      else if (it.suspectedSyndication) reasons.push('疑似转载自 ' + ((it.sameAsOriginal && it.sameAsOriginal.title) || '').slice(0, 14));
      if (dims.authority >= 85) reasons.push('来源类型' + ({ gov: '政府', paper: '学术论文', acad: '科研机构', org: '官方组织' }[st] || '权威'));
      it.whyText = reasons.slice(0, 2).join(' · ') || '综合匹配';
      if (tc.reasons.length) it.whyText += ' · 不适配(' + tc.reasons.join(',') + ')';
    });

    // 转载页排序降权（§18：同簇内非代表条目总分 ×0.75，不剔除）
    var seenClusterRep = {};
    kept.forEach(function (it) {
      if (it.suspectedSyndication) {
        if (!seenClusterRep[it.evidenceClusterId]) seenClusterRep[it.evidenceClusterId] = true;
        else it.scoreTotal = clamp(it.scoreTotal * 0.75);
      }
    });

    kept.sort(function (a, b) { return b.scoreTotal - a.scoreTotal; });
    return { ranked: kept, filtered: filtered };
  }

  global.WCC_SCORING_ENGINE = {
    rank: rank,
    WEIGHTS: WEIGHTS,
    hardFilter: hardFilter,
    _internals: {
      freshnessScore: freshnessScore, relevanceScore: relevanceScore,
      evidenceScore: evidenceScore, directnessScore: directnessScore,
      entityMatchScore: entityMatchScore, scopeMatchScore: scopeMatchScore,
      temporalMatchScore: temporalMatchScore,
      eventFitScore: eventFitScore, targetCompatibility: targetCompatibility
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
