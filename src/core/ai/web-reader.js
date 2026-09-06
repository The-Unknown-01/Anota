// Web Reader（V2.0 N2）：URL → fetch 原文 → 轻量正文抽取 → 供验证引擎判定。
// 升级要求 §8：排序后的 URL 才进入 Web Reader；必须区分 存在≠相关≠支持。
// 失败降级（T-3）：反爬/超时 → 返回 null，调用方明示「未能读取原文」并退回 snippet 级判断。
// 正文抽取（TD1）：自研轻量实现——去 script/style/nav，取文本密度最高主体块，零依赖。
(function (global) {
  'use strict';

  var TIMEOUT_MS = 12000;
  var MAX_TEXT = 6000;      // 注入 LLM 前的正文截断（token 控制）
  var MIN_BODY_LEN = 80;    // 抽取结果低于此长度视为失败

  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

  // ---------- HTML 清洗 ----------

  // 剥离对语义无贡献的块级标签及其内容
  var STRIP_BLOCKS = /<(script|style|noscript|svg|iframe|nav|header|footer|aside|form|button)[^>]*>[\s\S]*?<\/\1>/gi;
  var STRIP_COMMENTS = /<!--[\s\S]*?-->/g;

  function htmlToText(html) {
    var s = String(html || '');
    s = s.replace(STRIP_COMMENTS, '');
    // 多轮剥离嵌套块（如 <script> 内含 </script> 字符串的极端情况不处理——演示场景足够）
    for (var i = 0; i < 3; i++) {
      var next = s.replace(STRIP_BLOCKS, '');
      if (next === s) break;
      s = next;
    }
    // 块级标签转换行，保持段落结构
    s = s.replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    // 去掉全部剩余标签
    s = s.replace(/<[^>]+>/g, ' ');
    // 实体还原（常见集合）
    s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
         .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&hellip;/g, '…');
    // 压缩空白
    s = s.replace(/[ \t\r\f]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return s;
  }

  // ---------- 正文块选择（文本密度法） ----------

  // 把纯文本按行分块，取累计字数最高且连续密度最高的窗口
  function pickMainBody(text) {
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
    if (!lines.length) return '';

    // 过滤明显的导航/菜单残渣（超短行占比过高的头部区域）
    var body = lines.filter(function (l) { return l.length >= 12; });
    if (body.length < 3) body = lines; // 极短页面兜底

    // 取前 MAX_TEXT 字符（正文抽取后按序截断即可——排序已由 N1 完成，
    // 这里不需要复杂窗口算法；保留开头信息密度最高的部分）
    var out = [];
    var total = 0;
    for (var i = 0; i < body.length && total < MAX_TEXT; i++) {
      out.push(body[i]);
      total += body[i].length + 1;
    }
    return out.join('\n');
  }

  // ---------- 主流程 ----------

  // 从 HTML 提取 <a href> 链接（upgrade.md §14：论文超链接在 href 属性里，
  // htmlToText 会丢属性，必须在剥离标签前提取）-> [{href, text}]（去重，上限 50）
  function extractLinks(html) {
    var out = [];
    var seen = {};
    var re = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null && out.length < 50) {
      var href = String(m[1] || '').trim();
      var text = String(m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!/^https?:\/\//i.test(href)) continue;
      if (href.length > 300) continue;
      if (seen[href]) continue;
      seen[href] = true;
      out.push({ href: href, text: text });
    }
    return out;
  }

  // 从 HTML 提取 canonical URL（<link rel="canonical" href="...">，属性顺序不敏感）
  function extractCanonical(html) {
    var s = String(html || '');
    var re = /<link\b[^>]*>/gi;
    var m;
    while ((m = re.exec(s)) !== null) {
      var tag = m[0];
      if (/rel\s*=\s*["']?canonical["']?/i.test(tag)) {
        var hm = tag.match(/href\s*=\s*["']([^"']+)["']/i);
        if (hm) return hm[1].trim();
      }
    }
    return null;
  }

  // 正文过薄时的尽力分类（启发式，非硬事实——普通 fetch 无法精确区分 JS 渲染/登录/反爬）
  function classifyThinContent(html) {
    var h = String(html || '').toLowerCase();
    if (/(登录|login|sign\s?in|验证码|captcha)/.test(h)) return 'LOGIN_REQUIRED';
    if (/(enable\s?javascript|请.{0,6}(?:启用|开启).{0,4}(?:javascript|js|脚本))/i.test(h)) return 'JS_REQUIRED';
    if (/<(script|noscript)[^>]*>/.test(h) && /(react|vue|angular|__nuxt|__next|window\.__|id\s*=\s*["'](root|app)["'])/.test(h)) return 'JS_REQUIRED';
    return 'EMPTY_CONTENT';
  }

  // readUrl(url, opts) -> Promise<{ ok:true, text, title, html?, ...meta } | { ok:false, reason, accessStatus?, ...meta }>
  // opts.wantHtml=true 时额外返回原始 HTML（供 extractLinks / 显式来源提取使用）
  function readUrl(url, opts) {
    if (!url || !/^https?:\/\//i.test(url)) {
      return Promise.resolve({ ok: false, reason: 'invalid_url', accessStatus: 'INVALID_URL', requestedUrl: url, fetchedAt: Date.now() });
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
      }
    }).then(function (resp) {
      clearTimeout(timer);
      // Phase 1：统一记录硬事实（finalUrl/redirected/status/fetchedAt）；完整 redirectChain fetch 拿不到，不做
      var meta = { requestedUrl: url, finalUrl: resp.url || url, redirected: !!resp.redirected, status: resp.status, fetchedAt: Date.now() };
      if (!resp.ok) {
        var as = resp.status === 404 || resp.status === 410 ? 'NOT_FOUND'
               : resp.status === 401 ? 'LOGIN_REQUIRED'
               : resp.status === 403 ? 'BLOCKED'
               : 'HTTP_' + resp.status;
        return Object.assign({ ok: false, reason: 'http_' + resp.status, accessStatus: as }, meta);
      }
      var ct = resp.headers.get('content-type') || '';
      if (ct.indexOf('html') < 0 && ct.indexOf('text') < 0 && ct.indexOf('json') < 0) {
        return Object.assign({ ok: false, reason: 'not_html', accessStatus: 'NOT_HTML' }, meta);
      }
      // 大小防护：最多读 2MB
      var lenHeader = parseInt(resp.headers.get('content-length') || '0', 10);
      if (lenHeader > 2 * 1024 * 1024) {
        return Object.assign({ ok: false, reason: 'too_large', accessStatus: 'TOO_LARGE', contentLength: lenHeader }, meta);
      }
      return resp.text().then(function (html) {
        if (html.length > 2 * 1024 * 1024) html = html.slice(0, 2 * 1024 * 1024);
        var title = '';
        var tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (tm) title = tm[1].replace(/<[^>]+>/g, '').trim().slice(0, 120);
        var canonicalUrl = extractCanonical(html);
        var text = pickMainBody(htmlToText(html));
        var m2 = { requestedUrl: url, finalUrl: meta.finalUrl, redirected: meta.redirected, status: meta.status, fetchedAt: meta.fetchedAt, contentLength: html.length, canonicalUrl: canonicalUrl };
        if (text.length < MIN_BODY_LEN) {
          // 正文过薄：尽力分类（登录墙/JS 渲染/空内容），不代表"不存在"
          return Object.assign({ ok: false, reason: 'thin_content', accessStatus: classifyThinContent(html) }, m2);
        }
        var res = Object.assign({ ok: true, accessStatus: meta.redirected ? 'REDIRECTED' : 'READABLE', text: text.slice(0, MAX_TEXT), title: title }, m2);
        if (opts && opts.wantHtml) res.html = html;
        return res;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      var reason = err && err.name === 'AbortError' ? 'timeout' : 'fetch_failed';
      return { ok: false, reason: reason, accessStatus: reason === 'timeout' ? 'TIMEOUT' : 'NETWORK_ERROR', requestedUrl: url, fetchedAt: Date.now() };
    });
  }

  // 批量读取（串行避免并发压力），失败项标记 readError 而非中断
  // items: [{url, ...}] → 返回带 content/contentError 的副本
  function readAll(items) {
    var chain = Promise.resolve([]);
    var results = [];
    items.forEach(function (it) {
      chain = chain.then(function (acc) {
        return readUrl(it.url).then(function (r) {
          var copy = Object.assign({}, it);
          // Phase 1：访问元数据传递到候选（供下游区分"打不开"与"不存在/不可信"）
          if (r.accessStatus) copy.accessStatus = r.accessStatus;
          if (r.finalUrl) copy.finalUrl = r.finalUrl;
          if (r.canonicalUrl) copy.canonicalUrl = r.canonicalUrl;
          copy.redirected = !!r.redirected;
          if (r.ok) { copy.content = r.text; copy.contentTitle = r.title; }
          else { copy.readError = r.reason; }
          acc.push(copy);
          return acc;
        });
      });
      results = chain;
    });
    return results;
  }

  global.WCC_WEB_READER = {
    readUrl: readUrl,
    readAll: readAll,
    htmlToText: htmlToText,
    extractLinks: extractLinks,
    extractCanonical: extractCanonical,
    classifyThinContent: classifyThinContent,
    MAX_TEXT: MAX_TEXT
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
