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
const path = require('path');
const { URL } = require('url');

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
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key'
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
function serveStaticFile(req, res, filePath) {
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
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*'
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
  
  // CORS预检
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key'
    });
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
  
  // Ollama代理API（解决浏览器CORS）
  if (pathname.startsWith('/api/ollama/')) {
    const targetPath = pathname.replace('/api/ollama', '');
    const targetUrl = `${OLLAMA_URL}${targetPath}${reqUrl.search}`;
    log(`Ollama代理: ${req.method} ${targetPath}`, 'REQUEST');
    proxyRequest(req, res, targetUrl);
    return;
  }
  
  // 在线模型API代理（可选，解决CORS）
  if (pathname.startsWith('/api/proxy/')) {
    const targetUrl = reqUrl.searchParams.get('url');
    if (targetUrl) {
      log(`API代理: ${req.method} ${targetUrl.substring(0, 60)}...`, 'REQUEST');
      proxyRequest(req, res, targetUrl);
      return;
    }
  }
  
  // ============ 知识库API（只读） ============
  
  // 访问范围调试接口（仅本机可访问）
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

  // ============ 静态文件 ============
  let filePath;
  if (pathname === '/' || pathname === '') {
    filePath = path.join(ROOT_DIR, 'index.html');
  } else {
    // 防止路径遍历攻击
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
