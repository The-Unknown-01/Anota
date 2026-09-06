// 从仓库根配置生成扩展配置。两种模式：
//   PROXY  —— 存在 proxy_base.txt：密钥全置 null，扩展只知代理地址 + 访问令牌
//   DIRECT —— 无 proxy_base.txt：读本地 *_api.key（开发后门）
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const outFile = path.join(root, 'src', 'core', 'generated-config.js');

function readFile(file) {
  var p = path.join(root, file);
  if (!fs.existsSync(p)) return null;
  var v = fs.readFileSync(p, 'utf8').trim();
  return v || null;
}
function readKey(file, minLen) {
  var v = readFile(file);
  if (v && v.length < minLen) {
    console.error('[gen-config] ' + file + ' 内容过短，疑似无效。');
    process.exit(1);
  }
  return v;
}

// ---- 模式探测 ----
var proxyBase = readFile('proxy_base.txt');     // 如 https://api.anota.best
var proxyToken = readFile('proxy_token.txt');   // 用户访问令牌
var proxyEnabled = !!proxyBase;

// ---- 密钥：代理模式全部置 null，直连模式才读本地文件 ----
var deepseekKey, zhihuSecret, metasoKey, exaKey, metasoEndpoint;

if (proxyEnabled) {
  // ★ 核心：代理模式下不读取任何本地密钥文件
  deepseekKey = null;
  zhihuSecret = null;
  metasoKey = null;
  exaKey = null;
  metasoEndpoint = null;
} else {
  deepseekKey = readKey('deepseek_api.key', 20);
  if (!deepseekKey) {
    console.error('[gen-config] 直连模式需要 deepseek_api.key。若走代理，请创建 proxy_base.txt。');
    process.exit(1);
  }
  zhihuSecret = fs.existsSync(path.join(root, 'zhihu_api.key'))
    ? readKey('zhihu_api.key', 16) : readKey('zhihu_access_secret.key', 16);
  metasoKey = readKey('metaso_api.key', 8);
  exaKey = readKey('exa_api.key', 8);
  var epFile = readFile('metaso_endpoint.txt');
  metasoEndpoint = (epFile && /^https?:\/\//.test(epFile)) ? epFile : null;
}

function jstr(v) { return JSON.stringify(v); }
var lines = [
  '// 本文件由 scripts/gen-config.js 自动生成，已被 .gitignore 忽略，绝不提交。',
  '// 模式：' + (proxyEnabled ? 'PROXY（' + proxyBase + '）—— 密钥不在本文件，在 Worker Secrets' : 'DIRECT（本地密钥，仅开发用）'),
  'globalThis.QIUZHEN_CONFIG = Object.freeze({',
  '  PROXY_ENABLED: ' + jstr(proxyEnabled) + ',',
  '  PROXY_BASE_URL: ' + jstr(proxyBase) + ',',
  '  PROXY_ACCESS_TOKEN: ' + jstr(proxyToken) + ',',
  '  DEEPSEEK_API_KEY: ' + jstr(deepseekKey) + ',',
  '  DEEPSEEK_BASE_URL: \'https://api.deepseek.com\',',
  '  DEEPSEEK_MODEL: \'deepseek-chat\',',
  '  ZHIHU_ACCESS_SECRET: ' + jstr(zhihuSecret) + ',',
  '  ZHIHU_API_BASE: \'https://developer.zhihu.com/api/v1/content\',',
  '  METASO_API_KEY: ' + jstr(metasoKey) + ',',
  '  METASO_ENDPOINT: ' + jstr(metasoEndpoint || 'https://metaso.cn/api/v1/search') + ',',
  '  EXA_API_KEY: ' + jstr(exaKey) + ',',
  '});',
  ''
];
fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log('[gen-config] 已生成', path.relative(root, outFile),
  proxyEnabled ? '(PROXY → ' + proxyBase + '，零密钥)' : '(DIRECT，本地密钥)');