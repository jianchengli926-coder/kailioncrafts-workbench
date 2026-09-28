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

/* 判断访问来源：local / lan / public */
function getAccessScope(req) {
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  const cfRay = req.headers['cf-ray'];
  const xForwardedFor = req.headers['x-forwarded-for'];
  const host = (req.headers.host || '').toLowerCase();
  
  // Cloudflare Tunnel / Cloudflare CDN 特征
  if (cfConnectingIp || cfRay || host.includes('prospect.kailioncrafts.com')) {
    return 'public';
  }
  
  // 获取客户端IP
  let clientIp = req.socket.remoteAddress || '';
  if (xForwardedFor) {
    clientIp = xForwardedFor.split(',')[0].trim();
  }
  
  // 本机
  if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1') {
    // 但如果Host是公网域名，仍按公网处理
    if (host.includes('prospect.kailioncrafts.com')) return 'public';
    return 'local';
  }
  
  // 局域网私网段
  if (clientIp.startsWith('192.168.') || clientIp.startsWith('10.') || 
      clientIp.startsWith('172.16.') || clientIp.startsWith('172.17.') ||
      clientIp.startsWith('172.18.') || clientIp.startsWith('172.19.') ||
      clientIp.startsWith('172.2') || clientIp.startsWith('172.30.') ||
      clientIp.startsWith('172.31.') || clientIp.startsWith('::ffff:192.168.') ||
      clientIp.startsWith('::ffff:10.')) {
    return 'lan';
  }
  
  // 判断不确定时按公网处理
  return 'public';
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
          bySensitivity: stats.by_sensitivity || {},
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
  
  // 知识库单个文件内容
  if (pathname === '/api/kb/file') {
    const scope = getAccessScope(req);
    const relativePath = reqUrl.searchParams.get('path');
    
    if (!relativePath) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '缺少path参数' }));
      return;
    }
    
    // 路径穿越防护
    const fullPath = safeKbPath(relativePath);
    if (!fullPath) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '路径被拒绝（路径穿越防护）', path: relativePath }));
      log(`知识库文件访问被拒绝(路径穿越): ${relativePath}`, 'WARN');
      return;
    }
    
    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '文件不存在', path: relativePath }));
      return;
    }
    
    // 公网访问时检查文件敏感级别
    if (scope === 'public') {
      // 读取frontmatter检查sensitivity
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const sensMatch = fmMatch[1].match(/sensitivity:\s*(\w+)/);
          if (sensMatch) {
            const sensitivity = sensMatch[1].toLowerCase();
            if (sensitivity !== 'public') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: '公网访问仅允许public级别文件', sensitivity }));
              log(`知识库文件公网访问被拒绝: ${relativePath} (${sensitivity})`, 'WARN');
              return;
            }
          }
        }
      } catch (e) {
        // 读取失败时按公网严格策略拒绝
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '无法验证文件敏感级别，公网访问被拒绝' }));
        return;
      }
    }
    
    // 读取并返回文件内容
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const stats = fs.statSync(fullPath);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        path: relativePath,
        fileName: path.basename(relativePath),
        size: stats.size,
        lastModified: stats.mtime.toISOString(),
        accessScope: scope,
        content
      }, null, 2));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    log(`知识库文件: scope=${scope}, ${relativePath}`, 'REQUEST');
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
