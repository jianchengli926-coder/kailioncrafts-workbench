/**
 * 锴利外贸获客工作台 - 本地服务器
 * 把Mac作为本地服务器运行工作台
 * 
 * 功能：
 * 1. 静态文件服务（index.html, logo.png等）
 * 2. API代理（解决浏览器CORS限制）
 * 3. Ollama本地模型健康检查
 * 4. 在线模型可用性检测
 * 5. 自动故障转移状态监控
 * 
 * 使用方法：node server.js
 * 访问地址：http://localhost:8080
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { URL } = require('url');
const dns = require('dns');

// ============ 全局异常保护（防止进程崩溃退出）============
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toLocaleString('zh-CN')}] [FATAL] 未捕获异常:`, err.message);
  console.error(err.stack);
  // 不退出进程，继续运行（launchd会在真正崩溃时自动重启）
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toLocaleString('zh-CN')}] [WARN] 未处理的Promise拒绝:`, reason);
});

// ============ 配置 ============
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 允许局域网访问
const ROOT_DIR = __dirname;
const OLLAMA_URL = 'http://localhost:11434';
const KB_ROOT = path.join(ROOT_DIR, '公司知识库备份_v5.7_2026-09-28');
const KB_INDEX_FILE = path.join(ROOT_DIR, 'kb_index.json');
const KB_META_DOCS_FILE = path.join(ROOT_DIR, 'kb_meta_docs.json');

// 在线模型API端点（用于健康检查）
const ONLINE_APIS = [
  { name: '智谱GLM', url: 'https://open.bigmodel.cn/api/paas/v4/models' },
  { name: '硅基流动', url: 'https://api.siliconflow.cn/v1/models' },
  { name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/models' }
];

// ============ MIME类型 ============
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

// ============ 工具函数 ============
function log(msg, type = 'INFO') {
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const colors = {
    'INFO': '\x1b[36m',    // 青色
    'SUCCESS': '\x1b[32m', // 绿色
    'WARN': '\x1b[33m',    // 黄色
    'ERROR': '\x1b[31m',   // 红色
    'REQUEST': '\x1b[90m'  // 灰色
  };
  const reset = '\x1b[0m';
  console.log(`${colors[type] || ''}[${time}] [${type}] ${msg}${reset}`);
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/* 路径穿越防护：确保请求路径在知识库根目录内 */
function safeKbPath(relativePath) {
  if (!relativePath) return null;
  // 拒绝绝对路径
  if (path.isAbsolute(relativePath)) return null;
  // 拒绝包含..的路径
  if (relativePath.includes('..')) return null;
  // 规范化路径
  const normalized = path.normalize(relativePath);
  // 再次检查
  if (normalized.startsWith('..')) return null;
  const fullPath = path.join(KB_ROOT, normalized);
  // 确保在KB_ROOT内
  if (!fullPath.startsWith(KB_ROOT)) return null;
  // 检查符号链接（如果存在且指向目录外则拒绝）
  try {
    const realPath = fs.realpathSync(fullPath);
    const realKbRoot = fs.realpathSync(KB_ROOT);
    if (!realPath.startsWith(realKbRoot)) return null;
  } catch (e) {
    // 文件不存在时realpathSync会抛错，这是正常的
  }
  return fullPath;
}

/* 判断访问来源：local / lan / public
 * 安全原则：可伪造头只能降权，不得提升权限。
 * 本机判定严格条件（必须同时满足）：
 *   1. socket IP 为回环地址
 *   2. 无任何 CF、X-Forwarded、Via 系列代理头
 *   3. Host 为 localhost 或 127.0.0.1
 */
const scopeLog = [];

function getAccessScope(req) {
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  const cfRay = req.headers['cf-ray'];
  const xForwardedFor = req.headers['x-forwarded-for'] || '';
  const xForwardedProto = req.headers['x-forwarded-proto'] || '';
  const via = req.headers['via'] || '';
  const host = (req.headers.host || '').toLowerCase();
  const socketIp = req.socket.remoteAddress || '';
  const reasons = [];
  let scope = null; // 未判定，有降权信号才设public

  const hasProxyHeaders = !!(cfConnectingIp || cfRay || xForwardedFor || xForwardedProto || via);
  const hasCfHeaders = !!(cfConnectingIp || cfRay);

  // 降权信号：任一存在即判公网
  if (hasCfHeaders) { reasons.push('CF头存在→公网'); scope = 'public'; }
  if (host.includes('prospect.kailioncrafts.com')) { reasons.push('Host含公网域名→公网'); scope = 'public'; }
  if (xForwardedFor) {
    const firstXff = xForwardedFor.split(',')[0].trim();
    const isPrivateXff = firstXff.startsWith('192.168.') || firstXff.startsWith('10.') ||
      firstXff.startsWith('172.1') || firstXff.startsWith('172.2') ||
      firstXff.startsWith('172.3') || firstXff === '127.0.0.1' || firstXff === '::1';
    if (!isPrivateXff && firstXff) { reasons.push('XFF含公网IP→公网'); scope = 'public'; }
  }

  const isLoopback = socketIp === '127.0.0.1' || socketIp === '::1' || socketIp === '::ffff:127.0.0.1';
  const isLocalhostHost = host === 'localhost' || host === '127.0.0.1' || host.startsWith('localhost:') || host.startsWith('127.0.0.1:');
  const isLan = socketIp.startsWith('192.168.') || socketIp.startsWith('10.') ||
    socketIp.startsWith('172.16.') || socketIp.startsWith('172.17.') ||
    socketIp.startsWith('172.18.') || socketIp.startsWith('172.19.') ||
    socketIp.startsWith('172.2') || socketIp.startsWith('172.30.') ||
    socketIp.startsWith('172.31.') || socketIp.startsWith('::ffff:192.168.') ||
    socketIp.startsWith('::ffff:10.');

  // 无降权信号时，根据socket IP判定
  if (scope === null) {
    if (isLoopback && !hasProxyHeaders && isLocalhostHost) {
      scope = 'local';
      reasons.push('本机:回环+无代理头+Host=localhost');
    } else if (isLoopback) {
      if (hasProxyHeaders) reasons.push('回环但有代理头→降权');
      if (!isLocalhostHost) reasons.push('回环但Host=' + host + '→降权');
      scope = 'public';
      reasons.push('不满足本机严格条件→公网');
    } else if (isLan) {
      scope = 'lan';
      reasons.push('socket局域网(' + socketIp + ')');
    } else {
      scope = 'public';
      reasons.push('socket公网(' + socketIp + ')');
    }
  }

  scopeLog.push({ time: new Date().toISOString(), scope, socketIp, host, hasCfHeaders, hasProxyHeaders, reasons });
  if (scopeLog.length > 20) scopeLog.shift();
  log('[KB Scope] ' + scope + ' | ' + reasons.join('; '), 'REQUEST');
  return scope;
}

/* 根据访问范围过滤切片敏感级别 */
function filterSlicesByScope(slices, scope) {
  if (scope === 'local') {
    return slices; // 本机可访问所有级别
  } else if (scope === 'lan') {
    return slices.filter(s => s.sensitivity === 'public' || s.sensitivity === 'internal');
  } else {
    return slices.filter(s => s.sensitivity === 'public');
  }
}

/* 中文2-gram + 英文词元 分词 */
function tokenizeQuery(q) {
  const tokens = [];
  const parts = q.toLowerCase().split(/\s+/).filter(p => p.length > 0);
  for (const part of parts) {
    if (/[\u4e00-\u9fa5]/.test(part)) {
      tokens.push({ term: part, type: 'cn-original', weight: 3 });
      for (let i = 0; i < part.length - 1; i++) {
        const bigram = part.substring(i, i + 2);
        if (!tokens.find(t => t.term === bigram)) {
          tokens.push({ term: bigram, type: 'cn-bigram', weight: 1 });
        }
      }
    } else {
      tokens.push({ term: part, type: 'en', weight: 1 });
    }
  }
  return tokens;
}

/* 改进版检索：标题链>文件名>正文，AND优先，元文档降权，同文件最多2结果 */
function searchSlicesV2(slices, q, metaDocs) {
  const tokens = tokenizeQuery(q);
  const originalTerms = tokens.filter(t => t.type !== 'cn-bigram').map(t => t.term);
  const queryContainsMetaKeyword = metaDocs.boostKeywords.some(kw => q.toLowerCase().includes(kw.toLowerCase()));
  
  const scored = [];
  const fileResultCount = {};
  
  for (const slice of slices) {
    let score = 0;
    const matchedTerms = [];
    const titleText = (slice.titleChain || []).join(' ').toLowerCase();
    const bodyText = (slice.text || '').toLowerCase();
    const fileName = (slice.fileName || '').toLowerCase();
    const filePath = (slice.filePath || '').toLowerCase();
    
    let allOriginalHit = true;
    
    for (const token of tokens) {
      const kw = token.term;
      let hits = 0;
      if (titleText.includes(kw)) { hits += 4; if (!matchedTerms.includes(kw)) matchedTerms.push(kw); }
      if (fileName.includes(kw) || filePath.includes(kw)) { hits += 2; if (!matchedTerms.includes(kw)) matchedTerms.push(kw); }
      if (bodyText.includes(kw)) { hits += 1; if (!matchedTerms.includes(kw)) matchedTerms.push(kw); }
      if (hits === 0 && token.type !== 'cn-bigram') allOriginalHit = false;
      score += hits * token.weight;
    }
    
    if (score === 0) continue;
    if (allOriginalHit && originalTerms.length > 1) score *= 2.5;
    // 单匹配降权：只匹配了1个原词且非AND的，降权50%
    const matchedOriginalCount = originalTerms.filter(t => matchedTerms.includes(t)).length;
    if (!allOriginalHit && matchedOriginalCount <= 1 && originalTerms.length > 1) score *= 0.5;
    if (slice.authority === 'high') score *= 1.5;
    if (slice.deprecated) score *= 0.3;
    if (slice.noOutbound) score *= 0.5;
    
    const isMeta = metaDocs.metaPatterns.some(p =>
      slice.filePath.includes(p) || slice.fileName.includes(p) || titleText.includes(p)
    );
    if (isMeta && !queryContainsMetaKeyword) score *= metaDocs.metaPenalty;
    
    const fp = slice.filePath;
    fileResultCount[fp] = (fileResultCount[fp] || 0) + 1;
    if (fileResultCount[fp] > 2) continue;
    
    scored.push({ slice, score: Math.round(score * 100) / 100, matchedTerms, allOriginalHit });
  }
  
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(r => r.score >= 3);
}


/* 转义正则特殊字符 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============ 健康检查 ============
async function checkOllama() {
  return new Promise((resolve) => {
    const req = http.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const models = (json.models || []).map(m => m.name);
          resolve({ running: true, models });
        } catch {
          resolve({ running: false, models: [], error: '解析响应失败' });
        }
      });
    });
    req.on('error', () => resolve({ running: false, models: [], error: '连接失败' }));
    req.on('timeout', () => { req.destroy(); resolve({ running: false, models: [], error: '连接超时' }); });
  });
}

async function checkOnlineAPI(name, url) {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout: 3000,  // V73 缩短到3秒，避免Gemini网络超时拖慢健康检查
      headers: { 'Content-Type': 'application/json' }
    };
    const req = https.request(options, (res) => {
      // 401/403表示服务在线但需要认证，也算可用
      const available = res.statusCode < 500;
      resolve({ name, available, status: res.statusCode });
    });
    req.on('error', () => resolve({ name, available: false, status: 0, error: '连接失败' }));
    req.on('timeout', () => { req.destroy(); resolve({ name, available: false, status: 0, error: '超时' }); });
    req.end();
  });
}

// ============ API代理（解决CORS） ============
function proxyRequest(req, res, targetUrl) {
  const parsedUrl = new URL(targetUrl);
  const isHttps = parsedUrl.protocol === 'https:';
  const httpModule = isHttps ? https : http;
  
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: req.method,
    headers: { ...req.headers }
  };
  delete options.headers.host;
  delete options.headers.origin;
  delete options.headers.referer;
  
  const proxyReq = httpModule.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers
    });
    proxyRes.pipe(res);
  });
  
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '代理请求失败', detail: err.message }));
  });
  
  req.pipe(proxyReq);
}

// ============ 静态文件服务 ============
// 敏感文件denylist（禁止通过静态文件路由下载）
const STATIC_DENYLIST = [
  'access_config.json', 'search_config.json', 'search_cache.json', 'search_usage.json',
  'api_config.json',
  '.env', '.git', 'node_modules', '*.log', '*backup*.json', '*backup*.zip',
  'kb_index.json', 'kb_index_', '公司核心事实清单', '卖点与服务清单',
  '公司知识库', '.kb_hash_cache', 'kb_meta_docs.json', 'kb_search_tests.json',
  '外贸客户开发知识库.json',
  'server.js', 'kb_indexer.py', '*.py', '*.sh', '*.command',
  'README.md', 'DEPLOY.md', '工作交接文档.md', '工作台功能深度分析报告.md',
  '完整使用说明书', '工作台使用说明书', '工作台功能思维导图',
  'package.json', 'package-lock.json'
];

function isSensitiveStaticPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  for (const pattern of STATIC_DENYLIST) {
    if (pattern.startsWith('*')) {
      const keyword = pattern.substring(1).toLowerCase();
      if (normalized.includes(keyword)) return true;
    } else if (pattern.endsWith('*')) {
      const prefix = pattern.substring(0, pattern.length - 1).toLowerCase();
      if (normalized.includes(prefix)) return true;
    } else {
      if (normalized.includes('/' + pattern.toLowerCase()) || normalized.endsWith('/' + pattern.toLowerCase())) return true;
    }
  }
  // 额外检查：.git目录及其子路径
  if (normalized.includes('/.git')) return true;
  return false;
}

function serveStaticFile(req, res, filePath) {
  // denylist检查：禁止下载敏感文件
  if (isSensitiveStaticPath(filePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // 如果文件不存在，返回index.html（SPA支持）
      const indexPath = path.join(ROOT_DIR, 'index.html');
      fs.readFile(indexPath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        }
      });
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = getMimeType(filePath);
    
    // 缓存策略：HTML不缓存，静态资源缓存1小时
    const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': cacheControl
    });
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => {
      res.writeHead(500);
      res.end('读取文件失败');
    });
  });
}

// ============ 创建HTTP服务器 ============
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(reqUrl.pathname);
  
  // CORS预检（同源策略，不使用通配符）
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // ============ API路由 ============
  
  // 健康检查API
  if (pathname === '/api/health') {
    const ollama = await checkOllama();
    const onlineChecks = await Promise.all(
      ONLINE_APIS.map(api => checkOnlineAPI(api.name, api.url))
    );
    
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      server: { host: HOST, port: PORT },
      ollama: {
        running: ollama.running,
        models: ollama.models,
        url: OLLAMA_URL
      },
      onlineApis: onlineChecks,
      fallback: {
        onlineAvailable: onlineChecks.some(a => a.available),
        localAvailable: ollama.running,
        strategy: '在线模型优先 → 全部失败时自动切换到本地Ollama模型'
      }
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(health, null, 2));
    log(`健康检查: Ollama=${ollama.running ? '运行中' : '未运行'}, 在线=${onlineChecks.filter(a=>a.available).length}/${onlineChecks.length}`, 'SUCCESS');
    return;
  }
  
  // Ollama代理API（公网禁用）
  if (pathname.startsWith('/api/ollama/')) {
    const scope = getAccessScope(req);
    if (scope === 'public') {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '公网访问已禁用本地模型接口' }));
      return;
    }
    const targetPath = pathname.replace('/api/ollama', '');
    const targetUrl = `${OLLAMA_URL}${targetPath}${reqUrl.search}`;
    log(`Ollama代理: ${req.method} ${targetPath}`, 'REQUEST');
    proxyRequest(req, res, targetUrl);
    return;
  }
  
  // 在线模型API代理已关闭（SSRF风险，无明确当前用途）
  if (pathname.startsWith('/api/proxy/')) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '代理接口已禁用', reason: 'SSRF安全风险，无明确当前用途' }));
    return;
  }
  
  // ============ 访问密码API（scrypt哈希+HttpOnly会话+失败限制+公网权限） ============
  
  const ACCESS_CONFIG_FILE = path.join(ROOT_DIR, 'access_config.json');
  const SESSION_COOKIE_NAME = 'kl_session';
  const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8小时
  const MAX_FAILED_ATTEMPTS = 5;
  const FAIL_LOCKOUT_MS = 60 * 1000; // 1分钟
  
  // 内存会话存储（不写磁盘）
  const activeSessions = new Map();
  const failedAttempts = new Map(); // ip -> {count, firstFailTime}
  
  function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }
  
  function verifyPassword(password, config) {
    if (config.passwordHash && config.salt) {
      const hash = hashPassword(password, Buffer.from(config.salt, 'hex'));
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(config.passwordHash, 'hex'));
    }
    // 兼容旧明文配置（自动迁移）
    if (config.password && typeof config.password === 'string') {
      const match = password === config.password;
      if (match) {
        // 迁移为哈希
        const salt = crypto.randomBytes(16);
        config.passwordHash = hashPassword(password, salt);
        config.salt = salt.toString('hex');
        delete config.password; // 移除明文
        config.migratedAt = new Date().toISOString();
        saveAccessConfig(config);
      }
      return match;
    }
    return false;
  }
  
  function loadAccessConfig() {
    try {
      if (fs.existsSync(ACCESS_CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(ACCESS_CONFIG_FILE, 'utf-8'));
      }
    } catch(e) {}
    // 首次运行：生成随机密码并立即哈希存储
    const randomPassword = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
    const salt = crypto.randomBytes(16);
    const config = {
      passwordHash: hashPassword(randomPassword, salt),
      salt: salt.toString('hex'),
      createdAt: new Date().toISOString(),
      changed: false,
      tempPassword: randomPassword // 仅首次生成时保留，供用户在终端查看
    };
    try { fs.writeFileSync(ACCESS_CONFIG_FILE, JSON.stringify(config, null, 2)); } catch(e) {}
    console.log('\n🔐 首次运行临时密码（请立即修改）: ' + randomPassword + '\n');
    return config;
  }
  
  function saveAccessConfig(config) {
    try { fs.writeFileSync(ACCESS_CONFIG_FILE, JSON.stringify(config, null, 2)); return true; } catch(e) { return false; }
  }
  
  function getClientIp(req) {
    return req.socket.remoteAddress || 'unknown';
  }
  
  function isRateLimited(ip) {
    const record = failedAttempts.get(ip);
    if (!record) return false;
    if (record.count >= MAX_FAILED_ATTEMPTS) {
      if (Date.now() - record.firstFailTime < FAIL_LOCKOUT_MS) return true;
      failedAttempts.delete(ip); // 锁定过期，重置
    }
    return false;
  }
  
  function recordFailedAttempt(ip) {
    const record = failedAttempts.get(ip) || { count: 0, firstFailTime: Date.now() };
    record.count++;
    failedAttempts.set(ip, record);
  }
  
  function createSession(res) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
    return token;
  }
  
  function validateSession(req) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(new RegExp(SESSION_COOKIE_NAME + '=([^;]+)'));
    if (!match) return false;
    const token = match[1];
    const session = activeSessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      activeSessions.delete(token);
      return false;
    }
    return true;
  }
  
  function destroySession(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }
  
  // 访问密码状态（公开，不泄露密码）
  if (pathname === '/api/access/status' && req.method === 'GET') {
    const config = loadAccessConfig();
    const ip = getClientIp(req);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      hasPassword: !!(config.passwordHash || config.password),
      isDefault: config.changed === false,
      passwordHint: config.changed === false ? '首次运行已生成临时密码，请在本机登录后立即修改' : null,
      authenticated: validateSession(req),
      rateLimited: isRateLimited(ip)
    }));
    return;
  }
  
  // 验证密码（登录）
  if (pathname === '/api/access/verify' && req.method === 'POST') {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ valid: false, error: '尝试次数过多，请1分钟后再试' }));
      return;
    }
    try {
      const body = await readBody(req);
      const config = loadAccessConfig();
      const valid = verifyPassword(body.password, config);
      if (valid) {
        failedAttempts.delete(ip);
        createSession(res);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ valid: true }));
        log('访问密码验证成功（会话已创建）', 'SUCCESS');
      } else {
        recordFailedAttempt(ip);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ valid: false }));
        log('访问密码验证失败', 'WARN');
      }
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // 登出
  if (pathname === '/api/access/logout' && req.method === 'POST') {
    destroySession(res);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
    return;
  }
  
  // 修改密码（仅本机+已验证会话可调用）
  if (pathname === '/api/access/password' && req.method === 'POST') {
    const scope = getAccessScope(req);
    if (scope !== 'local') {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '仅允许在本机修改密码' }));
      return;
    }
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '请先登录' }));
      return;
    }
    try {
      const body = await readBody(req);
      const config = loadAccessConfig();
      if (!verifyPassword(body.oldPassword, config)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '旧密码错误' }));
        return;
      }
      if (!body.newPassword || body.newPassword.length < 8) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '新密码至少8位' }));
        return;
      }
      const salt = crypto.randomBytes(16);
      config.passwordHash = hashPassword(body.newPassword, salt);
      config.salt = salt.toString('hex');
      delete config.password; // 确保移除明文
      delete config.tempPassword; // 移除临时密码
      config.changed = true;
      config.changedAt = new Date().toISOString();
      saveAccessConfig(config);
      // 使所有现有会话失效，要求重新登录
      activeSessions.clear();
      destroySession(res);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: '密码修改成功，请重新登录' }));
      log('访问密码已修改（scrypt哈希，所有会话已失效）', 'SUCCESS');
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // ============ 知识库API（只读） ============
  
  // 访问范围调试接口（仅本机可访问）
  // AI模型配置接口（读取api_config.json，不返回完整Key）
  if (pathname === '/api/ai/config') {
    try {
      const configPath = require('path').join(ROOT_DIR, 'api_config.json');
      if (!require('fs').existsSync(configPath)) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({configured:false, glm:{configured:false,model:null,endpoint:null}, ollama:{configured:false,baseURL:null}}));
        return;
      }
      const cfg = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
      const glm = cfg.glm || {};
      const ollama = cfg.ollama || {};
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({
        configured: true,
        glm: {
          enabled: glm.enabled !== false,
          configured: !!(glm.apiKey && glm.apiKey.length > 0),
          model: glm.model || null,
          endpoint: glm.endpoint || null,
          timeout: glm.timeout || 30000
        },
        ollama: {
          enabled: ollama.enabled !== false,
          baseURL: ollama.baseURL || 'http://localhost:11434/v1'
        },
        providerOrder: cfg.providerOrder || ['glm', 'ollama']
      }));
      return;
    } catch(e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({configured:false, error:'配置读取失败'}));
      return;
    }
  }

  if (pathname === '/api/kb/scope-debug') {
    const scope = getAccessScope(req);
    if (scope !== 'local') {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '仅本机可访问调试接口' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      rule: '本机判定需同时满足: 回环IP + 无代理头 + Host=localhost',
      currentScope: scope,
      recentRequests: scopeLog
    }));
    return;
  }
  
  // 知识库状态
  if (pathname === '/api/kb/status') {
    const scope = getAccessScope(req);
    try {
      if (fs.existsSync(KB_INDEX_FILE)) {
        const indexData = JSON.parse(fs.readFileSync(KB_INDEX_FILE, 'utf-8'));
        const stats = indexData.stats || {};
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          available: true,
          kbVersion: indexData.kbVersion || 'v5.7',
          generatedAt: indexData.generatedAtReadable || indexData.generatedAt,
          totalFiles: stats.total_files || 0,
          totalSlices: stats.total_slices || 0,
          byCategory: stats.by_category || {},
          bySensitivity: scope === 'public' ? { public: (stats.by_sensitivity || {}).public || 0 } : (stats.by_sensitivity || {}),
          authorityHigh: stats.authority_high || 0,
          deprecated: stats.deprecated || 0,
          noOutbound: stats.no_outbound || 0,
          accessScope: scope,
          kbRootExists: fs.existsSync(KB_ROOT)
        }, null, 2));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          available: false,
          error: '索引文件不存在，请先运行 生成知识库索引.command',
          accessScope: scope
        }));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ available: false, error: e.message }));
    }
    log(`知识库状态: scope=${scope}`, 'REQUEST');
    return;
  }
  
  // 知识库索引（支持分页和分类过滤）
  if (pathname === '/api/kb/index') {
    const scope = getAccessScope(req);
    const category = reqUrl.searchParams.get('category');
    const page = parseInt(reqUrl.searchParams.get('page') || '0');
    const pageSize = parseInt(reqUrl.searchParams.get('pageSize') || '500');
    
    try {
      if (!fs.existsSync(KB_INDEX_FILE)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '索引文件不存在' }));
        return;
      }
      const indexData = JSON.parse(fs.readFileSync(KB_INDEX_FILE, 'utf-8'));
      let slices = indexData.slices || [];
      
      // 分类过滤
      if (category) {
        slices = slices.filter(s => s.category === category);
      }
      
      // 敏感级别过滤（根据访问范围）
      const beforeFilter = slices.length;
      slices = filterSlicesByScope(slices, scope);
      const afterFilter = slices.length;
      
      // 分页
      const total = slices.length;
      const start = page * pageSize;
      const paged = slices.slice(start, start + pageSize);
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        kbVersion: indexData.kbVersion,
        generatedAt: indexData.generatedAtReadable,
        accessScope: scope,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        filteredBySensitivity: beforeFilter - afterFilter,
        slices: paged
      }, null, 2));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    log(`知识库索引: scope=${scope}, category=${category || 'all'}, page=${page}`, 'REQUEST');
    return;
  }
  
  // 知识库单个文件内容（增强敏感过滤）
  if (pathname === '/api/kb/file') {
    const scope = getAccessScope(req);
    const relativePath = reqUrl.searchParams.get('path');
    
    // 统一拒绝函数（不泄露文件是否存在）
    function denyFile(msg) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: msg || '访问被拒绝' }));
    }
    
    if (!relativePath) {
      denyFile('缺少path参数');
      return;
    }
    
    // 只允许.md后缀
    if (!relativePath.toLowerCase().endsWith('.md')) {
      denyFile('仅允许访问.md文件');
      log(`知识库文件拒绝(非md): ${relativePath}`, 'WARN');
      return;
    }
    
    // 拒绝99目录
    if (relativePath.startsWith('99_') || relativePath.includes('/99_')) {
      denyFile('访问被拒绝');
      log(`知识库文件拒绝(99目录): ${relativePath}`, 'WARN');
      return;
    }
    
    // 路径穿越防护
    const fullPath = safeKbPath(relativePath);
    if (!fullPath) {
      denyFile('访问被拒绝');
      log(`知识库文件拒绝(路径穿越): ${relativePath}`, 'WARN');
      return;
    }
    
    // 检查文件是否存在（不存在也返回403，不泄露存在性）
    if (!fs.existsSync(fullPath)) {
      denyFile('访问被拒绝');
      return;
    }
    
    // 读取文件并检查frontmatter sensitivity
    let sensitivity = 'confidential'; // 缺失默认confidential
    let content = '';
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const sensMatch = fmMatch[1].match(/sensitivity:\s*(\w+)/);
        if (sensMatch) {
          sensitivity = sensMatch[1].toLowerCase();
          if (!['public', 'internal', 'confidential'].includes(sensitivity)) {
            sensitivity = 'confidential';
          }
        }
      }
    } catch (e) {
      denyFile('访问被拒绝');
      return;
    }
    
    // 按访问范围过滤
    if (scope === 'public' && sensitivity !== 'public') {
      denyFile('访问被拒绝');
      log(`知识库文件公网拒绝: ${relativePath} (${sensitivity})`, 'WARN');
      return;
    }
    if (scope === 'lan' && sensitivity === 'confidential') {
      denyFile('访问被拒绝');
      log(`知识库文件局域网拒绝: ${relativePath} (confidential)`, 'WARN');
      return;
    }
    
    // 返回文件内容
    try {
      const stats = fs.statSync(fullPath);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        path: relativePath,
        fileName: path.basename(relativePath),
        size: stats.size,
        lastModified: stats.mtime.toISOString(),
        accessScope: scope,
        sensitivity,
        content
      }, null, 2));
    } catch (e) {
      denyFile('访问被拒绝');
    }
    log(`知识库文件: scope=${scope}, sens=${sensitivity}, ${relativePath}`, 'REQUEST');
    return;
  }
  

  // 知识库服务端检索（前端不再全量拉取索引）
  if (pathname === '/api/kb/search') {
    const scope = getAccessScope(req);
    const q = (reqUrl.searchParams.get('q') || '').trim();
    const categories = (reqUrl.searchParams.get('categories') || '').split(',').filter(c => c);
    const topK = Math.min(parseInt(reqUrl.searchParams.get('topK') || '20'), 100);
    
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '缺少查询参数q' }));
      return;
    }
    
    try {
      if (!fs.existsSync(KB_INDEX_FILE)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '索引文件不存在' }));
        return;
      }
      const indexData = JSON.parse(fs.readFileSync(KB_INDEX_FILE, 'utf-8'));
      let slices = indexData.slices || [];
      
      // 分类过滤
      if (categories.length > 0) {
        slices = slices.filter(s => categories.includes(s.category) || categories.includes(s.dirCategory) || categories.includes(s.fmCategory));
      }
      
      // 敏感级别过滤（根据访问范围）
      slices = filterSlicesByScope(slices, scope);
      
      // 跳过no_outbound切片（对外场景不引用财务数据）
      // 注意：本机内部分析场景仍可通过/api/kb/index获取
      
      // 加载元文档配置
      let metaDocs = { metaPatterns: [], boostKeywords: [], metaPenalty: 0.3 };
      try {
        if (fs.existsSync(KB_META_DOCS_FILE)) {
          metaDocs = JSON.parse(fs.readFileSync(KB_META_DOCS_FILE, 'utf-8'));
        }
      } catch(e) { log('元文档配置读取失败: ' + e.message, 'ERROR'); }
      
      // 改进版检索（V2）
      const results = searchSlicesV2(slices, q, metaDocs);
      const totalMatches = results.length;
      const topResults = results.slice(0, topK);
      
      const scored = topResults.map(r => {
        const slice = r.slice;
        let snippet = '';
        const bodyText = (slice.text || '').toLowerCase();
        // 提取所有匹配词的上下文，优先选择包含最多匹配词的片段
        const matchPositions = [];
        for (const term of r.matchedTerms) {
          let idx = bodyText.indexOf(term);
          while (idx >= 0 && matchPositions.length < 5) {
            matchPositions.push(idx);
            idx = bodyText.indexOf(term, idx + 1);
          }
        }
        if (matchPositions.length > 0) {
          // 选择第一个匹配位置，扩大窗口到300字以包含更多匹配词
          const idx = matchPositions[0];
          const start = Math.max(0, idx - 100);
          const end = Math.min(slice.text.length, idx + 200);
          snippet = (start > 0 ? '...' : '') + slice.text.substring(start, end) + (end < slice.text.length ? '...' : '');
        }
        if (!snippet) snippet = slice.text.substring(0, 200) + '...';
        
        return {
          id: slice.id,
          filePath: slice.filePath,
          fileName: slice.fileName,
          category: slice.category,
          dirCategory: slice.dirCategory,
          fmCategory: slice.fmCategory,
          titleChain: slice.titleChain,
          snippet,
          sensitivity: slice.sensitivity,
          authority: slice.authority,
          deprecated: slice.deprecated,
          noOutbound: slice.noOutbound,
          version: slice.version,
          lastUpdated: slice.lastUpdated,
          score: r.score,
          matchedTerms: r.matchedTerms,
          allOriginalHit: r.allOriginalHit
        };
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        query: q,
        accessScope: scope,
        totalCandidates: slices.length,
        totalMatches: totalMatches,
        returned: scored.length,
        topK,
        results: scored
      }, null, 2));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    log(`知识库检索: scope=${scope}, q="${q}", matches=${scored ? scored.length : 0}`, 'REQUEST');
    return;
  }


  // ============ AI精准客户开发 - 搜索与抓取API ============
  
  // 搜索配置文件（用户自行填入Tavily API Key，不硬编码）
  const SEARCH_CONFIG_FILE = path.join(ROOT_DIR, 'search_config.json');
  
  function loadSearchConfig() {
    try {
      if (fs.existsSync(SEARCH_CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(SEARCH_CONFIG_FILE, 'utf-8'));
      }
    } catch(e) { log('搜索配置读取失败: ' + e.message, 'WARN'); }
    return { tavilyApiKey: '', searxngUrl: 'http://localhost:8888', searchCacheHours: 24 };
  }
  
  function saveSearchConfig(config) {
    try {
      fs.writeFileSync(SEARCH_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      return true;
    } catch(e) { return false; }
  }
  
  // 搜索缓存（24小时）
  const SEARCH_CACHE_FILE = path.join(ROOT_DIR, 'search_cache.json');
  let searchCache = {};
  try {
    if (fs.existsSync(SEARCH_CACHE_FILE)) {
      searchCache = JSON.parse(fs.readFileSync(SEARCH_CACHE_FILE, 'utf-8'));
    }
  } catch(e) { searchCache = {}; }
  
  function getCacheKey(provider, query, params) {
    return provider + ':' + query + ':' + JSON.stringify(params || {});
  }
  
  function getCachedSearch(key, cacheHours) {
    const entry = searchCache[key];
    if (!entry) return null;
    const age = (Date.now() - entry.timestamp) / (1000 * 60 * 60);
    if (age > (cacheHours || 24)) {
      delete searchCache[key];
      return null;
    }
    return { ...entry.data, cached: true, cacheAgeHours: Math.round(age * 10) / 10 };
  }
  
  function setCachedSearch(key, data) {
    searchCache[key] = { timestamp: Date.now(), data };
    // 限制缓存大小，只保留最近500条
    const keys = Object.keys(searchCache);
    if (keys.length > 500) {
      keys.sort((a,b) => searchCache[a].timestamp - searchCache[b].timestamp);
      for (let i = 0; i < keys.length - 500; i++) delete searchCache[keys[i]];
    }
    try { fs.writeFileSync(SEARCH_CACHE_FILE, JSON.stringify(searchCache), 'utf-8'); } catch(e) {}
  }
  
  // 额度使用统计
  const USAGE_FILE = path.join(ROOT_DIR, 'search_usage.json');
  let usageData = { monthly: {} };
  try {
    if (fs.existsSync(USAGE_FILE)) {
      usageData = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
    }
  } catch(e) { usageData = { monthly: {} }; }
  
  function getCurrentMonthKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  
  function recordUsage(provider, credits, query) {
    const month = getCurrentMonthKey();
    if (!usageData.monthly[month]) usageData.monthly[month] = { tavily: 0, searxng: 0, totalQueries: 0, lastQuery: '' };
    usageData.monthly[month][provider] = (usageData.monthly[month][provider] || 0) + credits;
    usageData.monthly[month].totalQueries++;
    usageData.monthly[month].lastQuery = query.substring(0, 100);
    try { fs.writeFileSync(USAGE_FILE, JSON.stringify(usageData, null, 2), 'utf-8'); } catch(e) {}
  }
  
  // ============ SSRF防护（升级版：连接层IP校验 + DNS重绑定防御） ============
  
  // 检查IP是否为内网/保留地址（支持IPv4和IPv6）
  function isPrivateIP(ip) {
    if (!ip) return true;
    // IPv4 点分十进制
    const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const [, a, b, c, d] = v4.map(Number);
      if (a === 0) return true;          // 本网络
      if (a === 10) return true;         // 私网 10.0.0.0/8
      if (a === 127) return true;        // 回环 127.0.0.0/8
      if (a === 169 && b === 254) return true; // link-local
      if (a === 172 && b >= 16 && b <= 31) return true; // 私网 172.16.0.0/12
      if (a === 192 && b === 168) return true; // 私网 192.168.0.0/16
      if (a >= 224) return true;         // 组播/保留
      return false;
    }
    // IPv6
    const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (v6 === '::1' || v6 === '::ffff:127.0.0.1' || v6 === '::ffff:7f00:1') return true;
    if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // ULA 私网
    if (v6.startsWith('fe80')) return true; // link-local
    if (v6 === '::') return true; // 未指定地址
    return false;
  }
  
  // 将十进制/十六进制数字转换为IPv4点分格式（用于检测绕过）
  function normalizeNumericIP(hostname) {
    // 纯十进制数字，如 2130706433 = 127.0.0.1
    if (/^\d+$/.test(hostname)) {
      const num = parseInt(hostname, 10);
      if (num <= 0xFFFFFFFF) {
        return [(num >>> 24) & 0xFF, (num >>> 16) & 0xFF, (num >>> 8) & 0xFF, num & 0xFF].join('.');
      }
    }
    // 十六进制，如 0x7f000001 = 127.0.0.1
    if (/^0x[0-9a-fA-F]+$/.test(hostname)) {
      const num = parseInt(hostname, 16);
      if (num <= 0xFFFFFFFF) {
        return [(num >>> 24) & 0xFF, (num >>> 16) & 0xFF, (num >>> 8) & 0xFF, num & 0xFF].join('.');
      }
    }
    return null;
  }
  
  // 自定义DNS lookup：在连接层校验解析后的IP，防御DNS重绑定
  // 注意：Node.js v22+ 的 http.request 会传递 all:true，此时 dns.lookup 返回数组
  function safeLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const wantAll = options.all === true;
    dns.lookup(hostname, options, (err, result, family) => {
      if (err) return callback(err);
      // 统一处理：all:true 时 result 是 [{address,family}] 数组，否则是单个地址字符串
      const addrList = wantAll ? (Array.isArray(result) ? result : []) : [{address: result, family: family}];
      // 检查所有解析到的IP，任何一个是内网/保留地址都拒绝
      for (const addr of addrList) {
        if (addr && addr.address && isPrivateIP(addr.address)) {
          return callback(new Error('SSRF防护：DNS解析到内网/保留地址 ' + addr.address + '（主机: ' + hostname + '）'));
        }
      }
      // 全部安全，按原格式返回
      if (wantAll) {
        callback(null, result);
      } else {
        callback(null, result, family);
      }
    });
  }
  
  // URL安全检查（字符串层面预检查，连接层还有safeLookup二次校验）
  function isUrlSafe(urlStr) {
    try {
      const u = new URL(urlStr);
      const hostname = u.hostname.toLowerCase();
      // 只允许http和https
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      // 拒绝localhost和常见回环
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') return false;
      // 检测十进制/十六进制IP绕过
      const numericIP = normalizeNumericIP(hostname);
      if (numericIP && isPrivateIP(numericIP)) return false;
      // 标准IPv4检测
      const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (ipMatch && isPrivateIP(hostname)) return false;
      // IPv6检测
      if (hostname.startsWith('[') && hostname.endsWith(']')) {
        const inner = hostname.slice(1, -1);
        if (isPrivateIP(inner)) return false;
      }
      // 拒绝0.0.0.0
      if (hostname === '0.0.0.0') return false;
      // 拒绝metadata服务
      if (hostname === 'metadata.google.internal' || hostname === '169.254.169.254') return false;
      return true;
    } catch(e) {
      return false;
    }
  }
  
  // 网页抓取（升级版：连接层SSRF校验 + 最多3次重定向 + 2MB响应上限 + 递归重定向校验）
  function fetchUrl(urlStr, opts = {}) {
    const maxRedirects = opts.maxRedirects !== undefined ? opts.maxRedirects : 3;
    const timeout = opts.timeout || 15000;
    const maxSize = opts.maxSize || 2 * 1024 * 1024; // 最大2MB
    const visited = opts._visited || [];
    
    return new Promise((resolve, reject) => {
      // 字符串层面预检查
      if (!isUrlSafe(urlStr)) {
        reject(new Error('SSRF防护：禁止访问内网或本地地址（URL预检查失败）'));
        return;
      }
      // 防止重定向循环
      if (visited.includes(urlStr)) {
        reject(new Error('重定向循环检测：' + urlStr));
        return;
      }
      visited.push(urlStr);
      
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const options = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity'
        },
        timeout: timeout,
        lookup: safeLookup  // 连接层二次校验：DNS解析后检查IP
      };
      
      const req = client.request(options, (res) => {
        // 处理重定向（递归，每次都经过isUrlSafe和safeLookup双重校验）
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (visited.length > maxRedirects) {
            req.destroy();
            reject(new Error('重定向次数超过上限(' + maxRedirects + '次)'));
            return;
          }
          let redirectUrl;
          try {
            redirectUrl = new URL(res.headers.location, urlStr).href;
          } catch(e) {
            req.destroy();
            reject(new Error('重定向URL解析失败: ' + e.message));
            return;
          }
          // 重定向目标字符串预检查
          if (!isUrlSafe(redirectUrl)) {
            req.destroy();
            reject(new Error('SSRF防护：重定向目标为内网地址（' + redirectUrl + '）'));
            return;
          }
          req.destroy();
          // 递归跟随重定向（safeLookup会在连接层再次校验）
          fetchUrl(redirectUrl, { ...opts, maxRedirects, timeout, maxSize, _visited: visited })
            .then(resolve).catch(reject);
          return;
        }
        
        let data = '';
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxSize) {
            req.destroy();
            reject(new Error('响应体超过最大限制(' + (maxSize / 1024 / 1024).toFixed(1) + 'MB)，已中止'));
            return;
          }
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            url: urlStr,
            finalUrl: visited[visited.length - 1],
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
            size: size,
            redirectCount: visited.length - 1,
            fetchedAt: new Date().toISOString()
          });
        });
      });
      
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时(' + timeout + 'ms)')); });
      req.end();
    });
  }
  
  // 从HTML中提取纯文本
  function extractTextFromHtml(html) {
    if (!html) return '';
    let text = html;
    // 移除script和style
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    // 移除注释
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    // 移除标签
    text = text.replace(/<[^>]+>/g, ' ');
    // 解码HTML实体
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    // 清理空白
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }
  
  // Tavily搜索
  async function tavilySearch(query, opts = {}) {
    const config = loadSearchConfig();
    if (!config.tavilyApiKey) {
      throw new Error('Tavily API Key 未配置。请在设置中填入 API Key，或使用 SearXNG 降级搜索。');
    }
    const cacheKey = getCacheKey('tavily', query, opts);
    const cached = getCachedSearch(cacheKey, config.searchCacheHours);
    if (cached && !opts.forceRefresh) return cached;
    
    const searchDepth = opts.searchDepth || 'basic'; // basic=1 credit, advanced=2 credits
    const maxResults = Math.min(opts.maxResults || 10, 20);
    const includeDomains = opts.includeDomains || [];
    const excludeDomains = opts.excludeDomains || [];
    
    const postData = JSON.stringify({
      api_key: config.tavilyApiKey,
      query: query,
      search_depth: searchDepth,
      max_results: maxResults,
      include_domains: includeDomains,
      exclude_domains: excludeDomains,
      include_answer: false,
      include_raw_content: false
    });
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.tavily.com',
        port: 443,
        path: '/search',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 30000
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.error) {
              reject(new Error('Tavily API错误: ' + result.error));
              return;
            }
            const credits = searchDepth === 'advanced' ? 2 : 1;
            recordUsage('tavily', credits, query);
            const output = {
              provider: 'tavily',
              query: query,
              searchDepth: searchDepth,
              results: (result.results || []).map(r => ({
                title: r.title,
                url: r.url,
                content: r.content,
                score: r.score || 0,
                source: 'tavily'
              })),
              creditsUsed: credits,
              fetchedAt: new Date().toISOString()
            };
            setCachedSearch(cacheKey, output);
            resolve(output);
          } catch(e) {
            reject(new Error('Tavily响应解析失败: ' + e.message));
          }
        });
      });
      req.on('error', (e) => reject(new Error('Tavily请求失败: ' + e.message)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Tavily请求超时(30s)')); });
      req.write(postData);
      req.end();
    });
  }
  

  // Tavily官方用量查询（接入官方API，返回真实已用/剩余额度）
  function tavilyGetUsage() {
    return new Promise((resolve, reject) => {
      const config = loadSearchConfig();
      if (!config.tavilyApiKey) {
        resolve({ available: false, reason: 'API Key未配置' });
        return;
      }
      const options = {
        hostname: 'api.tavily.com',
        port: 443,
        path: '/usage',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + config.tavilyApiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.error) {
              resolve({ available: false, reason: result.error, httpStatus: res.statusCode });
              return;
            }
            // 解析Tavily返回的用量数据（兼容多种返回格式）
            const monthlyUsage = result.usage?.monthly?.credits ?? result.usage?.credits ?? result.monthly?.credits ?? 0;
            const monthlyLimit = result.limit?.monthly?.credits ?? result.limit?.credits ?? result.plan?.monthly_credits ?? 1000;
            resolve({
              available: true,
              httpStatus: res.statusCode,
              creditsUsed: monthlyUsage,
              creditsLimit: monthlyLimit,
              creditsRemaining: Math.max(0, monthlyLimit - monthlyUsage),
              raw: result,
              fetchedAt: new Date().toISOString()
            });
          } catch(e) {
            resolve({ available: false, reason: '响应解析失败: ' + e.message, httpStatus: res.statusCode });
          }
        });
      });
      req.on('error', (e) => resolve({ available: false, reason: '请求失败: ' + e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ available: false, reason: '请求超时(10s)' }); });
      req.end();
    });
  }
  
  // SearXNG降级搜索
  async function searxngSearch(query, opts = {}) {
    const config = loadSearchConfig();
    const searxngUrl = config.searxngUrl || 'http://localhost:8888';
    const cacheKey = getCacheKey('searxng', query, opts);
    const cached = getCachedSearch(cacheKey, config.searchCacheHours);
    if (cached && !opts.forceRefresh) return cached;
    
    const maxResults = Math.min(opts.maxResults || 10, 20);
    const searchUrl = searxngUrl + '/search?q=' + encodeURIComponent(query) + '&format=json&categories=general&language=en';
    
    return new Promise((resolve, reject) => {
      const u = new URL(searchUrl);
      const options = {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        timeout: 15000
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            const results = (result.results || []).slice(0, maxResults).map(r => ({
              title: r.title,
              url: r.url,
              content: r.content,
              score: r.score || 0,
              source: 'searxng'
            }));
            recordUsage('searxng', 0, query); // SearXNG免费
            const output = {
              provider: 'searxng',
              query: query,
              results: results,
              creditsUsed: 0,
              fetchedAt: new Date().toISOString()
            };
            setCachedSearch(cacheKey, output);
            resolve(output);
          } catch(e) {
            reject(new Error('SearXNG响应解析失败: ' + e.message));
          }
        });
      });
      req.on('error', (e) => reject(new Error('SearXNG请求失败（可能未启动）: ' + e.message)));
      req.on('timeout', () => { req.destroy(); reject(new Error('SearXNG请求超时(15s)')); });
      req.end();
    });
  }
  
  // 统一搜索接口（Tavily优先，失败降级SearXNG）
  async function unifiedSearch(query, opts = {}) {
    const config = loadSearchConfig();
    const errors = [];
    // 优先Tavily
    if (config.tavilyApiKey && opts.provider !== 'searxng') {
      try {
        return await tavilySearch(query, opts);
      } catch(e) {
        errors.push('Tavily: ' + e.message);
        log('Tavily搜索失败，降级SearXNG: ' + e.message, 'WARN');
      }
    }
    // 降级SearXNG
    try {
      return await searxngSearch(query, opts);
    } catch(e) {
      errors.push('SearXNG: ' + e.message);
      throw new Error('所有搜索提供商均失败:\n' + errors.join('\n'));
    }
  }
  
  // 公网模式检查：公网访问时禁用搜索和抓取
  function denyIfPublic(req, res, scope) {
    if (scope === 'public') {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '公网访问已禁用搜索与抓取功能，请在本机或局域网使用' }));
      return true;
    }
    return false;
  }
  
  // 读取POST body
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) reject(new Error('请求体过大')); });
      req.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}); } catch(e) { reject(new Error('JSON解析失败: ' + e.message)); }
      });
      req.on('error', reject);
    });
  }
  
  // ============ 搜索API路由 ============
  
  // 搜索配置（读取/保存）
  // 公网权限控制：搜索/抓取/配置接口公网禁用
  const isSearchOrFetchApi = pathname.startsWith('/api/search') || pathname === '/api/fetch';
  if (isSearchOrFetchApi) {
    const scope = getAccessScope(req);
    if (scope === 'public') {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '公网访问已禁用搜索和抓取功能' }));
      return;
    }
  }
  
  if (pathname === '/api/search/config' && req.method === 'GET') {
    const scope = getAccessScope(req);
    if (denyIfPublic(req, res, scope)) return;
    const config = loadSearchConfig();
    // API Key打码返回
    const maskedKey = config.tavilyApiKey ? config.tavilyApiKey.substring(0, 4) + '...' + config.tavilyApiKey.substring(config.tavilyApiKey.length - 4) : '';
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ tavilyApiKey: maskedKey, hasTavilyKey: !!config.tavilyApiKey, searxngUrl: config.searxngUrl, searchCacheHours: config.searchCacheHours || 24 }));
    return;
  }
  
  if (pathname === '/api/search/config' && req.method === 'POST') {
    const scope = getAccessScope(req);
    if (denyIfPublic(req, res, scope)) return;
    try {
      const body = await readBody(req);
      const config = loadSearchConfig();
      if (body.tavilyApiKey && body.tavilyApiKey !== '' && !body.tavilyApiKey.includes('...')) {
        config.tavilyApiKey = body.tavilyApiKey;
      }
      if (body.searxngUrl) config.searxngUrl = body.searxngUrl;
      if (body.searchCacheHours) config.searchCacheHours = parseInt(body.searchCacheHours);
      saveSearchConfig(config);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: '配置已保存' }));
    } catch(e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // 统一搜索
  if (pathname === '/api/search' && req.method === 'POST') {
    const scope = getAccessScope(req);
    if (denyIfPublic(req, res, scope)) return;
    try {
      const body = await readBody(req);
      const query = (body.query || '').trim();
      if (!query) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: '缺少query参数' })); return; }
      const result = await unifiedSearch(query, body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
      log(`搜索: scope=${scope}, provider=${result.provider}, q="${query}", results=${result.results.length}, credits=${result.creditsUsed}`, 'REQUEST');
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
      log(`搜索失败: ${e.message}`, 'ERROR');
    }
    return;
  }
  
  // 额度使用统计（接入Tavily官方用量，本地计数作补充）
  if (pathname === '/api/search/usage' && req.method === 'GET') {
    const scope = getAccessScope(req);
    if (denyIfPublic(req, res, scope)) return;
    const month = getCurrentMonthKey();
    const monthly = usageData.monthly[month] || { tavily: 0, searxng: 0, totalQueries: 0, failedQueries: 0, cacheHits: 0 };
    
    // 尝试获取Tavily官方用量
    let officialUsage = null;
    try {
      officialUsage = await Promise.race([
        tavilyGetUsage(),
        new Promise(resolve => setTimeout(() => resolve({ available: false, reason: '查询超时(8s)' }), 8000))
      ]);
    } catch(e) {
      officialUsage = { available: false, reason: e.message };
    }
    
    // 以官方数据为准，本地计数作补充
    let creditsUsed, creditsLimit, creditsRemaining, dataSource;
    if (officialUsage && officialUsage.available) {
      creditsUsed = officialUsage.creditsUsed;
      creditsLimit = officialUsage.creditsLimit;
      creditsRemaining = officialUsage.creditsRemaining;
      dataSource = 'official';
    } else {
      creditsUsed = monthly.tavily || 0;
      creditsLimit = 1000;
      creditsRemaining = Math.max(0, creditsLimit - creditsUsed);
      dataSource = 'local';
    }
    
    const percentUsed = creditsLimit > 0 ? Math.round((creditsUsed / creditsLimit) * 100) : 0;
    
    // 本地计数与官方数据差异检测（超过10%时提示）
    let discrepancyWarning = null;
    if (officialUsage && officialUsage.available && monthly.tavily > 0) {
      const diff = Math.abs(officialUsage.creditsUsed - monthly.tavily);
      const diffPct = officialUsage.creditsUsed > 0 ? (diff / officialUsage.creditsUsed) * 100 : 0;
      if (diffPct > 10) {
        discrepancyWarning = '本地计数(' + monthly.tavily + ')与官方数据(' + officialUsage.creditsUsed + ')差异' + diffPct.toFixed(1) + '%，以官方数据为准';
      }
    }
    
    // 分别估算可发现候选公司数和可深度分析数
    const searchCreditsPerCompany = 3; // 每家客户约3组搜索词
    const discoverableCompanies = Math.floor(creditsRemaining / searchCreditsPerCompany);
    // 深度分析消耗：阶段2完成后按实际消耗更新，当前预估每家约2 credits（抓取+提取不消耗Tavily，AI分析用模型不消耗搜索额度）
    const deepAnalysisCreditsPerCompany = 0; // 深度分析主要消耗模型token，不消耗Tavily搜索额度
    const deepAnalyzableCompanies = deepAnalysisCreditsPerCompany > 0 ? Math.floor(creditsRemaining / deepAnalysisCreditsPerCompany) : null;
    
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      month: month,
      dataSource: dataSource,
      officialAvailable: !!(officialUsage && officialUsage.available),
      officialReason: officialUsage ? officialUsage.reason : null,
      tavilyCreditsUsed: creditsUsed,
      tavilyCreditsLimit: creditsLimit,
      tavilyRemaining: creditsRemaining,
      tavilyPercentUsed: percentUsed,
      localCreditsUsed: monthly.tavily || 0,
      localFailedQueries: monthly.failedQueries || 0,
      localCacheHits: monthly.cacheHits || 0,
      searxngQueries: monthly.searxng || 0,
      totalQueries: monthly.totalQueries || 0,
      lowBalanceWarning: creditsRemaining < creditsLimit * 0.2,
      balanceExhausted: creditsRemaining <= 0,
      discrepancyWarning: discrepancyWarning,
      capacity: {
        discoverableCompanies: discoverableCompanies,
        discoverableCreditsPerCompany: searchCreditsPerCompany,
        deepAnalyzableCompanies: deepAnalyzableCompanies,
        deepAnalysisCreditsPerCompany: deepAnalysisCreditsPerCompany,
        note: '可发现候选公司按每家3 credits估算（3组搜索词×basic搜索）。深度分析主要消耗模型token，不消耗Tavily搜索额度，阶段2完成后按实际消耗更新。'
      },
      usageNote: '失败请求和缓存命中不计入本地消耗。官方数据以Tavily API返回为准。'
    }));
    return;
  }
  
  // 网页抓取
  if (pathname === '/api/fetch' && req.method === 'POST') {
    const scope = getAccessScope(req);
    if (denyIfPublic(req, res, scope)) return;
    try {
      const body = await readBody(req);
      const url = (body.url || '').trim();
      if (!url) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: '缺少url参数' })); return; }
      const result = await fetchUrl(url, body);
      // 提取纯文本
      const plainText = extractTextFromHtml(result.body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        url: result.url,
        statusCode: result.statusCode,
        size: result.size,
        fetchedAt: result.fetchedAt,
        contentType: result.headers['content-type'] || '',
        plainText: plainText.substring(0, 10000), // 最多返回1万字
        plainTextLength: plainText.length,
        truncated: plainText.length > 10000
      }));
      log(`抓取: scope=${scope}, url=${url}, size=${result.size}, status=${result.statusCode}`, 'REQUEST');
    } catch(e) {
      const isSSRF = e.message.includes('SSRF');
      res.writeHead(isSSRF ? 403 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message, ssrfBlocked: isSSRF }));
      log(`抓取失败: ${e.message}`, isSSRF ? 'WARN' : 'ERROR');
    }
    return;
  }
  
  // 清除搜索缓存
  if (pathname === '/api/search/cache' && req.method === 'DELETE') {
    const scope = getAccessScope(req);
    if (denyIfPublic(req, res, scope)) return;
    searchCache = {};
    try { fs.writeFileSync(SEARCH_CACHE_FILE, '{}', 'utf-8'); } catch(e) {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: '搜索缓存已清除' }));
    return;
  }
  
  // ============ 静态文件 ============
  let filePath;
  if (pathname === '/' || pathname === '') {
    filePath = path.join(ROOT_DIR, 'index.html');
  } else {
    // 防止路径遍历攻击：检测..序列和URL编码的..
    if (pathname.includes('..') || pathname.includes('%2e') || pathname.includes('%2E')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    filePath = path.join(ROOT_DIR, safePath);
  }
  
  // 安全检查：确保文件在ROOT_DIR内
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  
  log(`${req.method} ${pathname}`, 'REQUEST');
  serveStaticFile(req, res, filePath);
});

// ============ 启动服务器 ============
server.listen(PORT, HOST, async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   🚀 锴利外贸获客工作台 - 本地服务器已启动                  ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  
  log(`本地访问: http://localhost:${PORT}`, 'SUCCESS');
  log(`局域网访问: http://<你的IP>:${PORT}`, 'INFO');
  log(`工作台文件: ${ROOT_DIR}`, 'INFO');
  log(`Ollama服务: ${OLLAMA_URL}`, 'INFO');
  console.log('');
  
  // 启动时检查Ollama状态
  const ollama = await checkOllama();
  if (ollama.running) {
    log(`Ollama运行正常，已安装 ${ollama.models.length} 个模型: ${ollama.models.join(', ')}`, 'SUCCESS');
  } else {
    log(`Ollama未运行！本地模型将不可用。请运行: ollama serve`, 'WARN');
  }
  
  console.log('');
  log('按 Ctrl+C 停止服务器', 'INFO');
  console.log('');
});

// 错误处理
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`端口 ${PORT} 已被占用，请使用其他端口: PORT=8081 node server.js`, 'ERROR');
  } else {
    log(`服务器错误: ${err.message}`, 'ERROR');
  }
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', () => {
  log('正在关闭服务器...', 'WARN');
  server.close(() => {
    log('服务器已关闭', 'INFO');
    process.exit(0);
  });
});
