// V2.5 溯源管线编排（upgrade.md 集成版）：
// Claim → [Evidence Targeting 前置决策] → Query Analyzer → 多引擎（含显式来源步）→ URL 去重 → Registry
//   → Source Analysis → [Academic Exact-Source 验证] → Evidence Clusters → Scoring → [Provenance Tracing]
//   → Top-N 多样性 → Web Reader → 五态结论 → [Binding + Hard Validation]。
// 保留机制（upgrade.md §3）：双核召回、中文关键词、keywordsEn、官方域 Query、八维评分、
//   preferredSources、firstPartyBonus、转载分级、Top-6 多样性、Evidence Binding、硬降级。
(function (global) {
  'use strict';

  var QA = global.WCC_QUERY_ANALYZER;
  var DS = global.WCC_DATASOURCE;
  var UU = global.WCC_URL_UTILS;
  var REG = global.WCC_SOURCE_REGISTRY;
  var SA = global.WCC_SOURCE_ANALYZER;
  var EG = global.WCC_EVIDENCE_GRAPH;
  var SE = global.WCC_SCORING_ENGINE;
  var READER = global.WCC_WEB_READER;
  var VE = global.WCC_VERIFY_ENGINE;
  // upgrade.md 新增模块
  var ET = global.WCC_EVIDENCE_TARGET;
  var AC = global.WCC_ACADEMIC;
  var PV = global.WCC_PROVENANCE;

  // ---------- 策略级会话缓存（TQ5）----------
  var strategyCache = {}; // claim.text -> strategy
  // 页面级上下文缓存（upgrade.md §5/§14：同页多次验证免重复抓取；10 条 / 10 分钟）
  var pageFetchCache = {};
  function fetchPageContext(url) {
    if (!url || !/^https?:\/\//i.test(String(url))) return Promise.resolve(null);
    var hit = pageFetchCache[url];
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Promise.resolve(hit);
    return READER.readUrl(url, { wantHtml: true }).then(function (r) {
      var entry = r.ok ? {
        ok: true,
        text: r.text,
        title: r.title,
        html: String(r.html || '').slice(0, 400000),   // Phase 5：保留 HTML 供 publisher/publishedAt 元数据抽取
        links: (ET && ET.extractExplicitSourcesFromHtml) ? ET.extractExplicitSourcesFromHtml(r.html) : [],
        at: Date.now()
      } : { ok: false, at: Date.now() };
      var keys = Object.keys(pageFetchCache);
      if (keys.length >= 10) delete pageFetchCache[keys[0]];
      pageFetchCache[url] = entry;
      return entry;
    }).catch(function () { return null; });
  }

  // search_advise §5.1：取消硬路由——所有问题类型都跑 Exa + Metaso 双核召回，
  // Zhihu 只做低配额社区补充；questionType 只影响各引擎预算配额，不再排除任何引擎。
  var ENGINE_BUDGET = {
    fact:     { exa: 4, metaso: 4, zhihu: 1 },
    academic: { exa: 5, metaso: 3, zhihu: 1 },
    policy:   { exa: 3, metaso: 5, zhihu: 1 },
    event:    { exa: 5, metaso: 4, zhihu: 1 },
    data:     { exa: 4, metaso: 4, zhihu: 1 },
    open:     { exa: 4, metaso: 4, zhihu: 2 }
  };

  // 产出执行计划：{ steps: [{engine, query, count, opts}], degraded }
  // 步序（upgrade.md §14.3 Source Priority）：显式来源步（Level 0~2）最优先 → 基础双核 → 官方域定向步
  function buildPlan(strategy, claimText, evidenceTarget) {
    var budget = ENGINE_BUDGET[strategy.questionType] || ENGINE_BUDGET.fact;
    var queries = QA.buildQueries(strategy, claimText);
    var zh = queries.zh[0] || String(claimText || '');
    var en = queries.en[0] || zh;
    var official = queries.official || [];

    var steps = [];
    var degraded = false;
    var et = evidenceTarget || {};

    // P0-2：Evidence Target 成为 buildPlan 的决策输入。searchStrategy 决定引擎预算档位；
    // targetType 的效果经 ET.ruleEvidenceTarget 已映射进 searchStrategy（EXACT_SOURCE 等），
    // 此处按 searchStrategy 微调引擎配额（基线仍是 questionType 的 ENGINE_BUDGET，不重写八维）。
    var ss = et.searchStrategy || 'BROAD_CORROBORATION';
    if (ss === 'EXACT_SOURCE' || ss === 'IDENTIFIER_SEARCH') {
      budget = { exa: budget.exa + 1, metaso: budget.metaso + 1, zhihu: 0 };          // 精确/标识符：收敛，压社区噪声
    } else if (ss === 'BROAD_CORROBORATION') {
      budget = { exa: budget.exa, metaso: budget.metaso, zhihu: Math.max(budget.zhihu, 2) }; // 广泛印证：扩大社区补充
    } else if (ss === 'PROVENANCE_SEARCH') {
      budget = { exa: budget.exa, metaso: budget.metaso + 1, zhihu: 1 };             // 溯源：加媒体召回
    }

    // §14/§15：显式来源步（页面已提供 DOI/URL/arXiv/PMID → 直接取原文，禁止先跳语义搜索）
    (et.explicitSources || []).slice(0, 2).forEach(function (s) {
      var url = null;
      if (s.kind === 'DOI') url = 'https://doi.org/' + s.value;
      else if (s.kind === 'ARXIV') url = 'https://arxiv.org/abs/' + s.value;
      else if (s.kind === 'PMID') url = 'https://pubmed.ncbi.nlm.nih.gov/' + s.value + '/';
      else if (s.kind === 'URL') url = s.value;
      if (url && /^https?:\/\//i.test(url)) {
        steps.push({ engine: 'explicit', query: url, count: 1, opts: { kind: s.kind, value: s.value } });
      }
    });

    if (DS.isExaAvailable()) {
      steps.push({ engine: 'exa', query: en, count: budget.exa, opts: {} });
    } else degraded = true;
    if (DS.isMetasoAvailable()) {
      steps.push({ engine: 'metaso', query: zh, count: budget.metaso, opts: {} });
    } else degraded = true;
    if (DS.isAvailable()) {
      steps.push({ engine: 'zhihu', query: zh, count: budget.zhihu, opts: {} });
    }

    // 官方域名定向步：保证官方源有机会进入候选池（NASA→nasa.gov 等）
    official.slice(0, 2).forEach(function (o) {
      if (DS.isExaAvailable()) steps.push({ engine: 'exa', query: o.query, count: 3, opts: { includeDomains: [o.domain] } });
      if (DS.isMetasoAvailable()) steps.push({ engine: 'metaso', query: o.query, count: 3, opts: { siteDomain: o.domain } });
    });

    if (!steps.length) return { steps: [], degraded: true };
    return { steps: steps, degraded: degraded };
  }

  // ---------- 主流程 ----------
  // verifyClaimV25(claim, meta, onStage) -> Promise<verification>
  // meta.context: { title, url, paragraph, surroundingText }（upgrade.md §5 Context Extraction 输入）
  // onStage(stage)（V3.0 M0）：真实管线阶段直播。stage = { phase, status, detail }
  //   phase 枚举：understand(理解目标)/search(检索)/filter(筛选)/trace(溯源)/verify(核对)/bind(绑定)
  //   status 枚举：start / done / error；detail 为各阶段上下文（search 含引擎级 detail）
  var STAGE_DEFS = [
    { id: 'understand', label: '理解目标' },
    { id: 'search',     label: '多路检索' },
    { id: 'filter',     label: '筛出来源' },
    { id: 'trace',      label: '递归溯源' },
    { id: 'verify',     label: '逐条核对' },
    { id: 'bind',       label: '绑定结论' }
  ];
  function makeEmitter(onStage) {
    var noop = function () {};
    if (typeof onStage !== 'function') return { start: noop, done: noop, error: noop };
    var safe = function (phase, status, detail) {
      try { onStage({ phase: phase, status: status, detail: detail || {}, def: (function () { for (var i = 0; i < STAGE_DEFS.length; i++) if (STAGE_DEFS[i].id === phase) return STAGE_DEFS[i]; return null; })() }); } catch (e) {}
    };
    return {
      start: function (phase) { safe(phase, 'start'); },
      done: function (phase, detail) { safe(phase, 'done', detail); },
      error: function (phase, detail) { safe(phase, 'error', detail); }
    };
  }

  function verifyClaimV25(claim, meta, onStage) {
    meta = meta || {};
    var STAGE = makeEmitter(onStage);
    var context = meta.context || { paragraph: claim.text };
    var claimText = String(claim.text || '');

    // ① 前置决策层（upgrade.md Phase1）：Evidence Targeting（与 Query Analyzer 并行，省一次串行等待）
    //    同时并行抓取文章页 HTML——论文超链接（<a href>）只有抓页面才能拿到（upgrade.md §14）
    STAGE.start('understand');
    var cachedStrategy = strategyCache[claimText];
    var strategyP = cachedStrategy
      ? Promise.resolve(cachedStrategy)
      : QA.analyzeQuery(claim).then(function (s) {
          s.enginesViaFallback = false;
          strategyCache[claimText] = s;
          return s;
        });
    var targetP = (ET && ET.analyze) ? ET.analyze(claim, context) : Promise.resolve(null);
    var pageP = fetchPageContext(context.url);

    return Promise.all([strategyP, targetP, pageP]).then(function (r) {
      var strategy = r[0];
      var evidenceTarget = r[1];
      var page = r[2];

      STAGE.done('understand', {
        questionType: strategy.questionType || 'unknown',
        targetType: (evidenceTarget && evidenceTarget.targetType) || null,
        sourceRequirement: strategy.sourceRequirement || null
      });

      // 页面超链接来源并入（论文以超链接引用时，显式来源从这里来；失败则静默降级）
      if (page && page.ok && ET && ET.mergeExplicitSources) {
        ET.mergeExplicitSources(evidenceTarget, page.text, page.links);
      }

      // 单点决策权（接线修复）：Evidence Target 是"找什么证据"的唯一策略源，
      // 覆盖 Query Analyzer 的同名字段。QA 只保留"理解类"字段（keywords/entities/
      // questionFocus/scopeLevel/questionType），不再与 ET 各自决定 preferredSources。
      if (evidenceTarget) {
        if (evidenceTarget.preferredSources && evidenceTarget.preferredSources.length) {
          strategy.preferredSources = evidenceTarget.preferredSources;
        }
        strategy.targetType = evidenceTarget.targetType || null;
        strategy.eventHints = evidenceTarget.eventHints || [];
        strategy.claimType = evidenceTarget.claimType || null;
        strategy.entityResolutionStatus = evidenceTarget.entityResolutionStatus || 'UNRESOLVED';
      }

      // ② 引擎计划与检索（串行执行各步；显式来源步优先；总候选上限 14）
      var plan = buildPlan(strategy, claimText, evidenceTarget);
      strategy.degradedExternal = plan.degraded;

      STAGE.start('search');

      var searchSeq = Promise.resolve({ merged: [], enginesUsed: [], queryLog: [] });
      var stepIdx = 0;

      function runStep(acc) {
        if (stepIdx >= plan.steps.length || acc.merged.length >= 14) {
          // 检索阶段结束（一次完整上报，供 UI 渐进式产出：候选先上屏）
          STAGE.done('search', {
            enginesUsed: acc.enginesUsed,
            rawCount: acc.merged.length,
            queryLog: acc.queryLog,
            // V3.0 M0b：候选预览（去重前原始结果，供 UI 渐进式点亮；最多 6 条）
            preview: acc.merged.slice(0, 6).map(function (it) {
              return {
                title: String(it.title || it.url || '').slice(0, 80),
                url: String(it.url || ''),
                engine: it.engine || 'unknown'
              };
            })
          });
          return acc;
        }
        var step = plan.steps[stepIdx++];
        var q = String(step.query || '').slice(0, 200);
        if (step.engine === 'explicit') {
          // §14 Explicit Source：直接读取原文（Web Reader），不进搜索引擎
          return READER.readUrl(q).then(function (res) {
            if (res.ok) {
              acc.merged.push({
                url: q,
                title: res.title || q,
                snippet: String(res.text || '').slice(0, 300),
                origin: 'global',
                engine: 'explicit',
                isExplicit: true,
                explicitKind: step.opts && step.opts.kind,
                explicitValue: step.opts && step.opts.value,
                publishedDate: null
              });
            }
            acc.enginesUsed.push('explicit(' + (res.ok ? 1 : 0) + ')');
            acc.queryLog.push({ engine: 'explicit', query: q, hits: res.ok ? 1 : 0 });
            return acc;
          }, function () {
            return acc;
          }).then(runStep);
        }
        return DS.engineSearch(step.engine, q, step.count, step.opts).then(function (items) {
          acc.enginesUsed.push(step.engine + '(' + items.length + ')');
          acc.queryLog.push({ engine: step.engine, query: q, hits: items.length });
          acc.merged = acc.merged.concat(items);
          // 引擎级直播：每路检索完成即上报（供 UI 显示"Exa 已回 5 条"）
          try { onStage && onStage({ phase: 'search', status: 'engine', detail: { engine: step.engine, hits: items.length, query: q } }); } catch (e2) {}
          return acc;
        }, function () {
          return acc;
        }).then(runStep);
      }

      return searchSeq.then(runStep).then(function (acc) {
        // ③ URL 规范化去重（§3）
        var dd = UU.dedupeByNormalizedUrl(acc.merged, function (it) { return it.url; });
        var candidates = dd.unique;
        STAGE.start('filter');

        // Phase 5：当前页面作为一等候选进入证据图（context source + candidate）。
        // 不是"当前页=权威"；其权威仍由 Registry/Source Analyzer 判定。有缓存正文供验证复用（免重复抓取）。
        if (context && context.url && page && page.ok) {
          var normCP = UU.normalizeUrl(context.url);
          var cpDup = candidates.some(function (c) { return UU.normalizeUrl(c.url) === normCP; });
          if (!cpDup) {
            var EE5 = global.WCC_EVIDENCE_EXTRACTOR;
            var pageMeta = (EE5 && EE5.extractPageMeta) ? EE5.extractPageMeta(page.html || '') : {};
            candidates.unshift({
              url: context.url,
              title: page.title || context.title || context.url,
              snippet: String(page.text || '').slice(0, 300),
              origin: 'page',
              engine: 'current_page',
              sourceKind: 'CURRENT_PAGE',
              publishedDate: pageMeta.publishedAt || null,
              cachedBody: page.text || '',
              cachedTitle: page.title || '',
              currentPageMeta: { publisher: pageMeta.publisher || null, author: pageMeta.author || null }
            });
          }
        }

        if (!candidates.length) {
          STAGE.error('filter', { reason: 'no_candidates' });
          return {
            verdict: 'no_source',
            detail: '多引擎检索无结果',
            evidences: [], readErrors: [],
            queries: acc.queryLog,
            strategy: strategy,
            evidenceTarget: evidenceTarget,
            binding: ET ? ET.buildBinding(null, evidenceTarget, []) : null,
            stats: { rawCount: acc.merged.length, uniqueCount: 0, filteredCount: 0 }
          };
        }

        // ④ Registry 先验 + ⑤ 来源分析（串行防限流）
        candidates.forEach(function (it) { it.registryInfo = REG.lookup(it.url); });
        return SA.analyzeSources(candidates).then(function (analyzed) {
          if (evidenceTarget && evidenceTarget.claimType === 'ACADEMIC' && AC) {
            var paperTarget = AC.buildTarget(evidenceTarget.explicitSources || [], claimText);
            if (paperTarget && (paperTarget.doi || paperTarget.arxiv || paperTarget.pmid || paperTarget.title)) {
              analyzed.forEach(function (it) {
                var pv = AC.validatePaper(it, paperTarget);
                it.paperStatus = pv.status;
                it.paperMatchedOn = pv.matchedOn;
              });
            }
          }

          // ⑥ 证据聚簇（§9）
          EG.buildClusters(analyzed);
          // ⑦ Scoring 排序（八维 + preferredSources + firstParty + 转载降权）
          var ranked = SE.rank(analyzed, strategy, claimText);
          STAGE.done('filter', {
            uniqueCount: ranked.ranked.length,
            engineBreakdown: (function () {
              var by = {};
              ranked.ranked.forEach(function (c) { by[c.engine] = (by[c.engine] || 0) + 1; });
              return by;
            })(),
            // V3.0 M0b：排序后候选（供 UI 渐进式点亮，带类型/一手性徽章；最多 6 条）
            sortedPreview: ranked.ranked.slice(0, 6).map(function (c) {
              var a = c.sourceAnalysis || {};
              return {
                title: String(c.title || c.url || '').slice(0, 80),
                url: String(c.url || ''),
                sourceType: a.sourceType || 'other',
                originality: a.originality === 'original' ? '一手' : (c.suspectedSyndication ? '疑似转载' : '二手'),
                engine: c.engine || 'unknown'
              };
            })
          });

          // ⑧ Provenance Tracing（upgrade.md §17~§24，预算受控；失败不阻断主流程）
          STAGE.start('trace');
          var traceP = (PV && PV.trace)
            ? PV.trace(ranked.ranked.slice(0, 8), claim, { maxUpstreamCandidates: 3, maxDepth: 3, maxPageReads: 5, maxAdditionalSearches: 5 })
              .catch(function () { return { traced: [], upstreamHits: [], stops: ['trace_error'] }; })
            : Promise.resolve({ traced: [], upstreamHits: [], stops: [] });

          return traceP.then(function (traceRes) {
            // 共同上游检测（§23/§28）：注入 provenanceClusterId / independence
            if (PV && PV.buildGraph) PV.buildGraph(ranked.ranked);
            STAGE.done('trace', {
              upstreamCount: (traceRes.traced || []).length,
              stops: traceRes.stops || []
            });

            // ⑨ Top-N 多样性验证（§19 + §29：同 provenance 簇不占多个验证位；复用已读正文）
            STAGE.start('verify');
            var topN = ranked.ranked.slice(0, 8);
            return VE.verifyClaim(claim, topN).then(function (v) {
              // ⑩ Binding + Hard Validation（§30/§31/§35）
              STAGE.done('verify', { readsOk: (v && v.evidences) ? v.evidences.length : 0 });
              STAGE.start('bind');
              var binding = (ET && ET.buildBinding) ? ET.buildBinding(v, evidenceTarget, ranked.ranked) : null;

              v.queries = acc.queryLog;
              v.candidates = ranked.ranked;         // 全量排序候选供面板展示
              v.strategy = strategy;
              v.evidenceTarget = evidenceTarget;    // 前置决策层结果
              v.binding = binding;                  // 绑定 + 硬校验
              v.provenance = {
                traced: traceRes.traced,
                upstreamHits: traceRes.upstreamHits,
                stops: traceRes.stops,
                clusters: ranked.ranked.reduce(function (acc2, c) {
                  if (c.provenanceClusterId && acc2.indexOf(c.provenanceClusterId) < 0) acc2.push(c.provenanceClusterId);
                  return acc2;
                }, []),
                confidence: PV ? PV.confidenceFor(ranked.ranked[0]) : 'NONE'
              };
              v.stats = {
                rawCount: acc.merged.length,
                uniqueCount: ranked.ranked.length,
                filteredCount: ranked.filtered + (acc.merged.length - dd.unique.length),
                clusterCount: Math.min(ranked.ranked.length, (function () {
                  var ids = {};
                  ranked.ranked.forEach(function (c) { ids[c.evidenceClusterId] = 1; });
                  return Object.keys(ids).length;
                })()),
                enginesUsed: acc.enginesUsed,
                independentCount: ranked.ranked.filter(function (c) { return c.independence === 'INDEPENDENT'; }).length,
                sharedUpstreamCount: ranked.ranked.filter(function (c) { return c.independence === 'SHARED_UPSTREAM'; }).length
              };
              STAGE.done('bind', {
                verdict: (binding && binding.verdict) || null,
                evidenceCount: (v.evidences || []).length,
                hardValidationPassed: !!(binding && binding.hardValidation && binding.hardValidation.passed)
              });
              return v;
            });
          });
        });
      });
    });
  }

  global.WCC_V25 = {
    verifyClaimV25: verifyClaimV25,
    buildPlan: buildPlan,
    ENGINE_BUDGET: ENGINE_BUDGET,
    _strategyCache: strategyCache
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
