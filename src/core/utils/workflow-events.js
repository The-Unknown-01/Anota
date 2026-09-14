// V3.3 V0：求深/求异可观测工作流事件协议。
// 目标：真实阶段事件（start/heartbeat/candidate/done/error/timeout）替代前端定时器假进度；
// 事件带 requestId + seq，面板可丢弃过期/乱序事件；心跳只表示请求仍存活，不伪造完成进度。
(function (global) {
  'use strict';

  var MODES = Object.freeze(['deep', 'differ']);

  var PHASES = Object.freeze({
    deep: Object.freeze([
      { id: 'understand',   label: '理解 Claim',      hint: '判断问题类型与需要补充的知识' },
      { id: 'query',        label: '生成知乎查询',    hint: '把 Claim 转成知乎回答检索词' },
      { id: 'zhihu_search', label: '搜索知乎回答',    hint: '只召回知乎公开回答' },
      { id: 'answer_read',  label: '读取回答正文',    hint: '逐条读取，可引用性单独标记' },
      { id: 'quote_extract', label: '提取可引用片段', hint: '原文与模型总结分离' },
      { id: 'synthesis',    label: '生成原理与知识树', hint: '模型基于回答材料生成解释' },
      { id: 'bind',         label: '绑定辅助回答',    hint: '解释与知乎回答建立出处关系' }
    ]),
    differ: Object.freeze([
      { id: 'understand',   label: '理解 Claim',      hint: '判断立场、前提与争议点' },
      { id: 'query',        label: '生成知乎查询',    hint: '生成寻找不同立场的检索词' },
      { id: 'zhihu_search', label: '搜索知乎回答',    hint: '只召回知乎公开回答' },
      { id: 'filter',       label: '筛选去重',        hint: '去重并保留可读回答' },
      { id: 'answer_read',  label: '读取回答正文',    hint: '逐条读取，失败不阻塞整体' },
      { id: 'stance_judge', label: '判断立场',        hint: '支持 / 反例 / 补充视角 / 无法判定' },
      { id: 'bind',         label: '绑定立场与引用',  hint: '每个真实立场绑定知乎回答出处' },
      { id: 'synthesis',    label: '输出遗漏维度',    hint: '模型基于真实立场生成补充视角' }
    ])
  });

  var STATUSES = Object.freeze(['start', 'heartbeat', 'candidate', 'progress', 'done', 'error', 'timeout', 'cancelled']);

  var SOFT_TIMEOUT_MS = Object.freeze({
    zhihu_search: 15000,
    answer_read: 12000,
    stance_judge: 30000,
    synthesis: 60000,
    request: 150000
  });

  var HEARTBEAT_MS = 1000;
  var SILENCE_ALERT_MS = 5000;

  function phaseIds(mode) {
    return (PHASES[mode] || []).map(function (p) { return p.id; });
  }

  function isValidEvent(ev) {
    if (!ev || typeof ev !== 'object') return false;
    if (MODES.indexOf(ev.mode) < 0) return false;
    if (typeof ev.requestId !== 'number' || typeof ev.seq !== 'number') return false;
    if (phaseIds(ev.mode).indexOf(ev.phase) < 0) return false;
    if (STATUSES.indexOf(ev.status) < 0) return false;
    return true;
  }

  // 创建事件发射器：自动补 seq/elapsedMs；detail 只允许可序列化的普通对象。
  function createEmitter(mode, requestId, sink) {
    var seq = 0;
    var startedAt = Date.now();
    var phaseStartedAt = {};
    function emit(phase, status, detail) {
      var now = Date.now();
      if (status === 'start') phaseStartedAt[phase] = now;
      var ev = {
        type: 'WORKFLOW_STAGE',
        mode: mode,
        requestId: requestId,
        seq: ++seq,
        phase: phase,
        status: status,
        elapsedMs: now - startedAt,
        phaseElapsedMs: phaseStartedAt[phase] != null ? now - phaseStartedAt[phase] : 0,
        completed: detail && typeof detail.completed === 'number' ? detail.completed : null,
        total: detail && typeof detail.total === 'number' ? detail.total : null,
        detail: detail ? JSON.parse(JSON.stringify(detail)) : {}
      };
      if (!isValidEvent(ev)) return null;
      try { sink(ev); } catch (e) { /* 面板可能已关闭 */ }
      return ev;
    }
    return { emit: emit, get seq() { return seq; } };
  }

  // 面板侧事件门：丢弃 requestId 不匹配或 seq 回退的事件。
  function createGate(requestId) {
    var lastSeq = 0;
    return {
      accept: function (ev) {
        if (!isValidEvent(ev) || ev.requestId !== requestId) return false;
        if (ev.seq <= lastSeq) return false;
        lastSeq = ev.seq;
        return true;
      }
    };
  }

  // 心跳：定时发送 heartbeat，直到 stop；只表示存活，不推进完成。
  function startHeartbeat(emitter, phase, intervalMs) {
    var timer = setInterval(function () { emitter.emit(phase, 'heartbeat', {}); }, intervalMs || HEARTBEAT_MS);
    return function stop() { clearInterval(timer); };
  }

  // 阶段软超时：超时后 resolve fallback 并发 timeout 事件；正常完成时清理定时器。
  function withPhaseTimeout(emitter, phase, promise, ms, fallback) {
    var timer;
    return Promise.race([
      promise,
      new Promise(function (resolve) {
        timer = setTimeout(function () {
          emitter.emit(phase, 'timeout', { softTimeoutMs: ms });
          resolve(fallback);
        }, ms);
      })
    ]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  global.WCC_WORKFLOW = {
    MODES: MODES,
    PHASES: PHASES,
    STATUSES: STATUSES,
    SOFT_TIMEOUT_MS: SOFT_TIMEOUT_MS,
    HEARTBEAT_MS: HEARTBEAT_MS,
    SILENCE_ALERT_MS: SILENCE_ALERT_MS,
    phaseIds: phaseIds,
    isValidEvent: isValidEvent,
    createEmitter: createEmitter,
    createGate: createGate,
    startHeartbeat: startHeartbeat,
    withPhaseTimeout: withPhaseTimeout
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
