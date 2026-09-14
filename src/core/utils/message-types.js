// 消息类型常量：content script / background / side panel 三方共享。
// 命名与 PRD 06-技术架构 §5 消息协议一致。
(function (global) {
  'use strict';
  global.WCC_MSG = Object.freeze({
    // content script → background：用户点击「深读」，提交当前选区
    CAPTURE_SELECTION: 'CAPTURE_SELECTION',
    // side panel → background：拉取当前 Active Selection
    GET_ACTIVE_SELECTION: 'GET_ACTIVE_SELECTION',
    // background → side panel：Active Selection 已更新（面板打开时实时刷新）
    ACTIVE_SELECTION_UPDATED: 'ACTIVE_SELECTION_UPDATED',
    // side panel → background：请求 AI 深读分析（mode: truth/deep/differ）
    ANALYZE: 'ANALYZE',
    // content script → background：请求对整篇文档做 Claim 识别（V1.5 U1）
    DETECT_CLAIMS: 'DETECT_CLAIMS',
    // background → content script：请求提取正文结构（调试/面板刷新用）
    EXTRACT_DOCUMENT: 'EXTRACT_DOCUMENT',
    // background → side panel：溯源验证结果（V2.0 N3）
    VERIFICATION_RESULT: 'VERIFICATION_RESULT',
    VERIFY_CLAIM: 'VERIFY_CLAIM',
    DISCOVER_DIFFER: 'DISCOVER_DIFFER',
    AUTH_LOGIN: 'AUTH_LOGIN',        // V3.1：启动知乎官方 OAuth（兼容旧消息名，邀请码逻辑已移除）
    AUTH_OAUTH_POLL: 'AUTH_OAUTH_POLL', // V3.1：轮询 OAuth flow 并领取应用 JWT
    AUTH_STATE: 'AUTH_STATE',        // 查询 OAuth 登录态
    AUTH_LOGOUT: 'AUTH_LOGOUT',      // 退出 OAuth 应用会话
    ANALYZE_STAGE: 'ANALYZE_STAGE',  // V3.0：分析阶段直播事件（SW → panel，广播）
    WORKFLOW_STAGE: 'WORKFLOW_STAGE', // V3.3：求深/求异真实工作流事件（start/heartbeat/candidate/done/error/timeout）
    // content script → background：悬浮球 Ready 点击，打开面板并携带本文 Claim Index（U4 概览态用）
    OPEN_PANEL_FOR_DOCUMENT: 'OPEN_PANEL_FOR_DOCUMENT',
    // 诊断
    PING: 'PING'
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
