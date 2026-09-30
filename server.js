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
// V77.0: 从 kb_config.json 读取知识库路径，不再硬编码旧目录
function loadKbRoot() {
  // V77.0 Phase 1.2: fail-closed。配置错误时返回null，不静默切回旧知识库。
  try {
    const cfgPath = path.join(ROOT_DIR, 'kb_config.json');
    if (!fs.existsSync(cfgPath)) {
      log('kb_config.json不存在，知识库不可用', 'ERROR');
      return null;
    }
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    if (!cfg.kbRoot) {
      log('kb_config.json中kbRoot为空，知识库不可用', 'ERROR');
      return null;
    }
    if (!fs.existsSync(cfg.kbRoot)) {
      log('kbRoot路径不存在: ' + cfg.kbRoot + '，知识库不可用', 'ERROR');
      return null;
    }
    return cfg.kbRoot;
  } catch(e) {
    log('kb_config.json读取失败: ' + e.message + '，知识库不可用(fail-closed)', 'ERROR');
    return null;
  }
}
const KB_ROOT = loadKbRoot();
const KB_INDEX_FILE = path.join(ROOT_DIR, 'kb_index.json');
const KB_META_DOCS_FILE = path.join(ROOT_DIR, 'kb_meta_docs.json');

// V77.2 知识库索引进程内缓存（基于文件mtime，不引入Redis/数据库）
let _kbIndexCache = { data: null, mtime: 0, path: null };

// V77.0 知识库索引格式兼容层：新版v2(chunks) → 旧版(slices)
function loadKbIndex() {
  // V77.2: 进程内缓存，文件未变化时复用内存对象
  try {
    if (fs.existsSync(KB_INDEX_FILE)) {
      const stat = fs.statSync(KB_INDEX_FILE);
      if (_kbIndexCache.data && _kbIndexCache.mtime === stat.mtimeMs && _kbIndexCache.path === KB_INDEX_FILE) {
        return _kbIndexCache.data;
      }
    }
  } catch(e) { log('索引缓存状态检查失败: ' + e.message, 'WARN'); }

  if (!fs.existsSync(KB_INDEX_FILE)) { _kbIndexCache = { data: null, mtime: 0, path: null }; return null; }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(KB_INDEX_FILE, 'utf-8'));
  } catch(e) {
    // JSON解析失败时fail-closed，不永久缓存失败结果
    log('kb_index.json解析失败(fail-closed): ' + e.message, 'ERROR');
    _kbIndexCache = { data: null, mtime: 0, path: null };
    return null;
  }
  if (data.schemaVersion === 'v2.0' || (data.chunks && !data.slices)) {
    data.slices = data.chunks.map(c => ({
      ...c,
      dirCategory: c.dirCategory || c.category,
      dirSubcategory: c.dirSubcategory || c.subcategory,
      fmCategory: c.fmCategory || c.category,
      fmSubcategory: c.fmSubcategory || c.subcategory,
      authority: c.authorityLevel || 'medium',
      titleChain: c.headingPath ? c.headingPath.split(' > ') : [c.title],
      filePath: c.relativePath,
      fileName: c.fileName || (c.relativePath ? c.relativePath.split('/').pop() : ''),
      outboundEligible: c.outboundEligible || false,
      contentRole: c.contentRole || 'article',
      conflictReview: c.conflictReview || false
    }));
    const stats = data.stats || {};
    data.stats = {
      total_files: stats.documents || data.totalFiles || 0,
      total_slices: stats.chunks || data.totalChunks || 0,
      by_sensitivity: stats.sensitivity || {}, by_category: {},
      authority_high: 0,
      deprecated: stats.status ? (stats.status.deprecated || 0) : 0, no_outbound: 0
    };
    // V77.0 Phase 1.2: 从documents实际计算authority_high、no_outbound、by_category(用dirCategory)
    let authHighCount = 0;
    let noOutboundCount = 0;
    for (const d of (data.documents || [])) {
      if (d.authorityLevel === 'high' || d.authority === 'high') authHighCount++;
      if (d.noOutbound) noOutboundCount++;
      const dc = d.dirCategory || d.category || '_root';
      data.stats.by_category[dc] = (data.stats.by_category[dc] || 0) + 1;
    }
    data.stats.authority_high = authHighCount;
    data.stats.no_outbound = noOutboundCount;
  }
  // V77.2: 写入缓存（记录mtime用于失效检测）
  try {
    const stat = fs.statSync(KB_INDEX_FILE);
    _kbIndexCache = { data: data, mtime: stat.mtimeMs, path: KB_INDEX_FILE };
  } catch(e) { _kbIndexCache = { data: data, mtime: Date.now(), path: KB_INDEX_FILE }; }
  return data;
}

// V77.2 统一知识库上下文检索层（精准开发/模块C复用，不建立第二套解析逻辑）
function retrieveKbContext(options) {
  const { query, purpose = 'internal_ai', provider = 'online_glm', accessScope = 'local', limit = 15, categories = [], factOnly = false, templateOnly = false } = options || {};
  const result = {
    query: query || '', purpose: purpose, provider: provider, accessScope: accessScope,
    totalMatched: 0, facts: [], templates: [], citations: [], excludedCount: 0,
    excludedByEligibilityCount: 0, factCount: 0, templateCount: 0,
    policy: { sensitivityAllowed: [], factOnly: factOnly, templateOnly: templateOnly },
    error: null, kbVersion: '', cacheHit: false
  };
  if (!query || !query.trim()) { result.error = 'empty_query'; return result; }
  // purpose/provider 严格白名单
  const VALID_PURPOSES = ['browse', 'internal_ai', 'outbound'];
  const VALID_PROVIDERS = ['none', 'online_glm', 'local_ollama'];
  if (!VALID_PURPOSES.includes(purpose)) { result.error = 'invalid_purpose'; return result; }
  if (!VALID_PROVIDERS.includes(provider)) { result.error = 'invalid_provider'; return result; }
  if (purpose === 'browse' && provider !== 'none') { result.error = 'invalid_combination'; return result; }
  if ((purpose === 'internal_ai' || purpose === 'outbound') && provider === 'none') { result.error = 'invalid_combination'; return result; }
  // 加载索引（带缓存）
  const indexData = loadKbIndex();
  if (!indexData) { result.error = 'index_unavailable'; return result; }
  result.kbVersion = indexData.kbVersion || indexData.version || '';
  let slices = indexData.slices || [];
  // 分类过滤
  if (categories && categories.length > 0) {
    slices = slices.filter(s => categories.includes(s.category) || categories.includes(s.dirCategory) || categories.includes(s.fmCategory));
  }
  // 访问范围过滤（99目录非local排除）
  slices = filterSlicesByScope(slices, accessScope);
  // purpose/provider 权限过滤
  let beforeCount = slices.length;
  if (purpose === 'internal_ai') {
    if (provider === 'online_glm') {
      slices = slices.filter(s => s.sensitivity === 'public');
      result.policy.sensitivityAllowed = ['public'];
    } else if (provider === 'local_ollama') {
      slices = slices.filter(s => s.sensitivity === 'public' || s.sensitivity === 'internal');
      result.policy.sensitivityAllowed = ['public', 'internal'];
    }
    slices = slices.filter(s => s.sensitivity !== 'confidential');
  } else if (purpose === 'outbound') {
    slices = slices.filter(s => {
      if (s.sensitivity !== 'public') return false;
      if (s.pending || s.demo || s.deprecated || s.conflictReview || s.noOutbound) return false;
      if (s.outboundEligible === false) return false;
      const st = (s.status || '').toLowerCase();
      return (st.includes('active') || st.includes('confirmed') || st.includes('正式') || st.includes('公开'));
    });
    result.policy.sensitivityAllowed = ['public'];
  } else {
    result.policy.sensitivityAllowed = accessScope === 'local' ? ['public','internal','confidential'] : (accessScope === 'lan' ? ['public','internal'] : ['public']);
  }
  result.excludedCount = beforeCount - slices.length;
  // 检索
  let metaDocs = { metaPatterns: [], boostKeywords: [], metaPenalty: 0.3 };
  try { if (fs.existsSync(KB_META_DOCS_FILE)) metaDocs = JSON.parse(fs.readFileSync(KB_META_DOCS_FILE, 'utf-8')); } catch(e) {}
  const searchResults = searchSlicesV2(slices, query, metaDocs);
  result.totalMatched = searchResults.length;
  // 按documentId去重
  const seenDocs = new Map();
  for (const r of searchResults) {
    const docId = r.slice.documentId || r.slice.id || r.slice.chunkId;
    if (!seenDocs.has(docId) || r.score > seenDocs.get(docId).score) seenDocs.set(docId, r);
  }
  const deduped = Array.from(seenDocs.values()).sort((a,b) => b.score - a.score);
  const top = deduped.slice(0, Math.min(limit, 50));
  // 事实与模板分离
  for (const r of top) {
    const s = r.slice;
    const item = {
      documentId: s.documentId || s.id || '',
      chunkId: s.chunkId || s.id || '',
      title: s.title || '',
      relativePath: s.relativePath || s.filePath || '',
      headingPath: s.headingPath || '',
      dirCategory: s.dirCategory || s.category || '',
      fmCategory: s.fmCategory || '',
      sensitivity: s.sensitivity || 'internal',
      status: s.status || '',
      authorityLevel: s.authorityLevel || s.authority || 'medium',
      confidence: s.confidence || 'medium',
      factEligible: s.factEligible === true,
      templateEligible: s.templateEligible === true,
      sourceUrl: s.sourceUrl || '',
      shortEvidence: (s.text || '').substring(0, 300),
      score: r.score
    };
    // factOnly/templateOnly 过滤
    if (factOnly && !item.factEligible) continue;
    if (templateOnly && !item.templateEligible) continue;
    // V77.2.2: 独立判断事实和模板资格，避免两者均为false时误入
    const isFact = item.factEligible === true;
    const isTemplate = item.templateEligible === true;
    if (isFact) result.facts.push(item);
    if (isTemplate) result.templates.push(item);
    // V77.2.2: citations只包含获资格的切片；两者均为false计入诊断
    if (isFact || isTemplate) {
      result.citations.push({ documentId: item.documentId, chunkId: item.chunkId, title: item.title, relativePath: item.relativePath, headingPath: item.headingPath, sensitivity: item.sensitivity, authorityLevel: item.authorityLevel, confidence: item.confidence, factEligible: item.factEligible, templateEligible: item.templateEligible, score: item.score });
    } else {
      result.excludedByEligibilityCount++;
    }
  }
  result.factCount = result.facts.length;
  result.templateCount = result.templates.length;
  return result;
}

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
function is99DirPath(relativePath) {
  if (!relativePath) return false;
  return relativePath.startsWith('99_') || relativePath.includes('/99_');
}

function filterSlicesByScope(slices, scope) {
  // V77.1.2: 99目录仅 local 可见
  const filter99 = (s) => scope === 'local' || !is99DirPath(s.relativePath);
  if (scope === 'local') {
    return slices.filter(filter99); // 本机可访问所有级别
  } else if (scope === 'lan') {
    return slices.filter(s => (s.sensitivity === 'public' || s.sensitivity === 'internal') && filter99(s));
  } else {
    return slices.filter(s => s.sensitivity === 'public' && filter99(s));
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
  'kb_index.json', 'kb_index_', 'kb_config.json', 'kb_manifest.json', 'kb_tree.json', 'kb_build_report.json',
  '公司核心事实清单', '卖点与服务清单',
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

// ============ 全局会话与限速存储（跨请求共享，必须在 http.createServer 外部） ============
const activeSessions = new Map();
const failedAttempts = new Map(); // ip -> {count, firstFailTime}

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

  // ============ 可信代理边界判断 ============
  // 只有来自本机回环地址的请求才可能是本机 Cloudflare Tunnel 反代
  // 非回环直连请求一律忽略所有 X-Forwarded-* 和 CF-* 代理头（防伪造）
  function isTrustedTunnelRequest(req) {
    const socketIp = req.socket.remoteAddress || '';
    return socketIp === '127.0.0.1' || socketIp === '::1' || socketIp === '::ffff:127.0.0.1';
  }

  // ============ 安全响应头 ============
  // isHttps 仅在直连 TLS 或可信 Tunnel + x-forwarded-proto=https 时成立
  const isHttps = !!req.socket.encrypted || (isTrustedTunnelRequest(req) && req.headers['x-forwarded-proto'] === 'https');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // CSP: 允许内联脚本（现有单文件架构）、ECharts CDN、data:图片
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'");
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // ============ API路由 ============

  // 健康检查API（最小信息，不暴露内部配置）
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // Ollama代理API（需认证+公网禁用）
  if (pathname.startsWith('/api/ollama/')) {
    if (!requireAuth(req, res)) return;
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
  const MAX_FAILED_ATTEMPTS = 10;
  const FAIL_LOCKOUT_MS = 15 * 60 * 1000; // 15分钟

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
    const socketIp = req.socket.remoteAddress || 'unknown';
    // 仅可信 Tunnel 请求（回环地址）才读取 cf-connecting-ip
    // 非回环直连请求忽略所有代理头，防止伪造
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    if (isTrustedTunnelRequest(req) && cfConnectingIp && typeof cfConnectingIp === 'string') {
      return cfConnectingIp.split(',')[0].trim();
    }
    return socketIp;
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
    const secureFlag = isHttps ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secureFlag}`);
    return token;
  }

  /* 从请求 Cookie 提取当前 session token */
  function getSessionToken(req) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(new RegExp(SESSION_COOKIE_NAME + '=([^;]+)'));
    return match ? match[1] : null;
  }

  function validateSession(req) {
    const token = getSessionToken(req);
    if (!token) return false;
    const session = activeSessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      activeSessions.delete(token);
      return false;
    }
    return true;
  }

  /* 统一认证中间件：未认证返回 401，已认证返回 true */
  function requireAuth(req, res) {
    if (validateSession(req)) return true;
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '未认证，请先登录', code: 'AUTH_REQUIRED' }));
    return false;
  }

  function destroySession(res) {
    const secureFlag = isHttps ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`);
  }

  // 访问密码状态（公开最小信息：是否已设置密码 + 当前请求是否已认证）
  if (pathname === '/api/access/status' && req.method === 'GET') {
    const config = loadAccessConfig();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      hasPassword: !!(config.passwordHash || config.password),
      authenticated: validateSession(req)
    }));
    return;
  }

  // 验证密码（登录）
  if (pathname === '/api/access/verify' && req.method === 'POST') {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ valid: false, error: '尝试次数过多，请15分钟后再试' }));
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

  // 登出（撤销服务端 session + 清除 Cookie）
  if (pathname === '/api/access/logout' && req.method === 'POST') {
    const token = getSessionToken(req);
    if (token) activeSessions.delete(token);
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
  // AI模型配置接口（需认证，读取api_config.json，不返回完整Key）
  if (pathname === '/api/ai/config') {
    if (!requireAuth(req, res)) return;
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
    if (!requireAuth(req, res)) return;
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

  // 知识库状态（需认证）
  if (pathname === '/api/kb/status') {
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    try {
      // V77.0 Phase 1.2: KB_ROOT为null时fail-closed
      if (!KB_ROOT) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          available: false,
          error: 'kb_config.json配置错误或kbRoot路径不存在，知识库不可用(fail-closed)',
          accessScope: scope,
          kbRootConfigured: false
        }));
        return;
      }
      if (fs.existsSync(KB_INDEX_FILE)) {
        const indexData = loadKbIndex();
        const stats = indexData.stats || {};
        // 按 scope 计算可见文档和切片
        const allDocs = indexData.documents || [];
        const allSlices = indexData.slices || indexData.chunks || [];
        function is99Dir(relativePath) {
          if (!relativePath) return false;
          return relativePath.startsWith('99_') || relativePath.includes('/99_');
        }
        function canSeeDoc(doc) {
          const sens = doc.sensitivity;
          if (scope === 'public') { if (sens !== 'public') return false; }
          if (scope === 'lan') { if (sens !== 'public' && sens !== 'internal') return false; }
          if (scope !== 'local' && is99Dir(doc.relativePath)) return false;
          return true;
        }
        const visibleDocs = allDocs.filter(d => canSeeDoc(d));
        const visibleSlices = allSlices.filter(s => canSeeDoc(s));
        // 按 scope 统计 byCategory
        const visibleByCategory = {};
        for (const d of visibleDocs) {
          const cat = d.dirCategory || d.category || '未分类';
          if (!visibleByCategory[cat]) visibleByCategory[cat] = 0;
          visibleByCategory[cat]++;
        }
        // 按 scope 统计 bySensitivity
        const visibleBySensitivity = { public: 0, internal: 0, confidential: 0 };
        for (const d of visibleDocs) {
          if (visibleBySensitivity[d.sensitivity] !== undefined) visibleBySensitivity[d.sensitivity]++;
        }
        // authorityHigh 按可见文档统计
        const visibleAuthorityHigh = visibleDocs.filter(d => d.authorityLevel === 'high').length;

        // V77.1.2: public/LAN 不返回 *All 全库统计字段，避免泄露被过滤知识库总量
        const statusResp = {
          available: true,
          kbVersion: indexData.kbVersion || 'v5.7',
          generatedAt: indexData.generatedAtReadable || indexData.generatedAt,
          totalFiles: visibleDocs.length,
          totalSlices: visibleSlices.length,
          byCategory: visibleByCategory,
          bySensitivity: visibleBySensitivity,
          authorityHigh: visibleAuthorityHigh,
          deprecated: visibleDocs.filter(d => d.status === 'deprecated' || d.deprecated === true).length,
          noOutbound: visibleDocs.filter(d => d.noOutbound).length,
          accessScope: scope,
          kbRootExists: fs.existsSync(KB_ROOT)
        };
        if (scope === 'local') {
          statusResp.totalFilesAll = stats.total_files || 0;
          statusResp.totalSlicesAll = stats.total_slices || 0;
          statusResp.byCategoryAll = stats.by_category || {};
          statusResp.authorityHighAll = stats.authority_high || 0;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(statusResp, null, 2));
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
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    // V77.0 Phase 1.2: KB_ROOT为null时fail-closed
    if (!KB_ROOT) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '知识库未配置(fail-closed)，请检查kb_config.json' }));
      return;
    }
    const category = reqUrl.searchParams.get('category');
    const page = parseInt(reqUrl.searchParams.get('page') || '0');
    const pageSize = parseInt(reqUrl.searchParams.get('pageSize') || '500');

    try {
      if (!fs.existsSync(KB_INDEX_FILE)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '索引文件不存在' }));
        return;
      }
      const indexData = loadKbIndex();
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
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    // V77.0 Phase 1.2: KB_ROOT为null时fail-closed
    if (!KB_ROOT) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '知识库未配置(fail-closed)，请检查kb_config.json' }));
      return;
    }
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


  // V77.1 知识库分类树（按访问范围过滤）
  if (pathname === '/api/kb/tree') {
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    if (!KB_ROOT) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '知识库未配置(fail-closed)' }));
      return;
    }
    try {
      const treeFile = path.join(ROOT_DIR, 'kb_tree.json');
      if (!fs.existsSync(treeFile)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '分类树不存在' }));
        return;
      }
      const rawTree = JSON.parse(fs.readFileSync(treeFile, 'utf-8'));

      // V77.1.2: 加载完整索引，建立 documentId -> 完整 metadata Map
      const indexFile = path.join(ROOT_DIR, 'kb_index.json');
      let docMetaMap = {};
      if (fs.existsSync(indexFile)) {
        const fullIndex = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
        if (Array.isArray(fullIndex.documents)) {
          for (const d of fullIndex.documents) {
            if (d.documentId) docMetaMap[d.documentId] = d;
          }
        }
      }

      // 合并完整元数据
      function mergeDocMeta(d) {
        const full = docMetaMap[d.documentId] || {};
        return {
          documentId: d.documentId,
          title: full.title || d.title || '',
          relativePath: full.relativePath || d.relativePath || '',
          sensitivity: full.sensitivity || d.sensitivity || 'public',
          status: full.status || d.status || 'active',
          pending: full.pending === true || (full.status && String(full.status).includes('pending')),
          deprecated: full.deprecated === true || full.status === 'deprecated' || full.status === 'archived',
          conflictReview: full.conflictReview === true,
          contentRole: full.contentRole || d.contentRole || 'article',
          authorityLevel: full.authorityLevel || d.authorityLevel || 'medium',
          sourceUrl: full.sourceUrl || d.sourceUrl || '',
          factEligible: full.factEligible === true,
          templateEligible: full.templateEligible === true,
          region: full.region || d.region || '',
          tags: full.tags || d.tags || [],
          lastUpdated: full.lastUpdated || d.lastUpdated || '',
          confidence: full.confidence || d.confidence || ''
        };
      }

      // V77.1.2: 99目录仅 local 可见
      function is99Dir(relativePath) {
        if (!relativePath) return false;
        return relativePath.startsWith('99_') || relativePath.includes('/99_');
      }

      // 按scope过滤文档可见性
      function canSeeDoc(doc) {
        const sens = doc.sensitivity;
        if (scope === 'public') { if (sens !== 'public') return false; }
        if (scope === 'lan') { if (sens !== 'public' && sens !== 'internal') return false; }
        // local: 全部可见
        // 99目录仅 local 可见
        if (scope !== 'local' && is99Dir(doc.relativePath)) return false;
        return true;
      }

      function filterSubcategory(sub) {
        if (!sub || !sub.documents) return { ...sub, documents: [], documentCount: 0, sensitivity: {public:0,internal:0,confidential:0} };
        const visibleDocs = sub.documents.filter(d => canSeeDoc(mergeDocMeta(d)));
        const sensCount = {public:0, internal:0, confidential:0};
        visibleDocs.forEach(d => { if(sensCount[d.sensitivity]!==undefined) sensCount[d.sensitivity]++; });
        return {
          name: sub.name,
          documentCount: visibleDocs.length,
          sensitivity: sensCount,
          documents: visibleDocs.map(d => mergeDocMeta(d))
        };
      }

      function filterCategory(cat) {
        if (!cat) return null;
        const visibleSubs = {};
        let totalDocs = 0;
        const sensTotal = {public:0, internal:0, confidential:0};
        const statusTotal = {active:0, pending:0, deprecated:0};

        if (cat.subcategories) {
          for (const [subName, sub] of Object.entries(cat.subcategories)) {
            const filtered = filterSubcategory(sub);
            visibleSubs[subName] = filtered;
            totalDocs += filtered.documentCount;
            for (const k of ['public','internal','confidential']) sensTotal[k] += filtered.sensitivity[k] || 0;
          }
        }
        // 一级分类下直接挂的文档
        if (cat.documents) {
          const visible = cat.documents.filter(d => canSeeDoc(mergeDocMeta(d)));
          totalDocs += visible.length;
          visible.forEach(d => { if(sensTotal[d.sensitivity]!==undefined) sensTotal[d.sensitivity]++; });
        }

        return {
          name: cat.name,
          documentCount: totalDocs,
          sensitivity: sensTotal,
          status: cat.status || statusTotal,
          subcategories: visibleSubs,
          documents: cat.documents ? cat.documents.filter(d => canSeeDoc(mergeDocMeta(d))).map(d => mergeDocMeta(d)) : []
        };
      }

      const filteredTree = {};
      for (const [catName, cat] of Object.entries(rawTree)) {
        const filtered = filterCategory(cat);
        if (filtered && filtered.documentCount > 0) {
          filteredTree[catName] = filtered;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        accessScope: scope,
        categoryCount: Object.keys(filteredTree).length,
        totalVisibleDocuments: Object.values(filteredTree).reduce((s,c) => s + c.documentCount, 0),
        tree: filteredTree
      }, null, 2));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    log(`知识库分类树: scope=${scope}`, 'REQUEST');
    return;
  }

  // V77.1 知识库文档详情
  if (pathname === '/api/kb/document') {
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    if (!KB_ROOT) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '知识库未配置(fail-closed)' }));
      return;
    }
    const documentId = reqUrl.searchParams.get('id');
    const relativePath = reqUrl.searchParams.get('path');

    if (!documentId && !relativePath) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '缺少id或path参数' }));
      return;
    }

    try {
      // 从索引中查找文档metadata
      const indexData = loadKbIndex();
      let docMeta = null;
      if (documentId) {
        docMeta = (indexData.documents || []).find(d => d.documentId === documentId);
      } else if (relativePath) {
        docMeta = (indexData.documents || []).find(d => d.relativePath === relativePath);
      }

      if (!docMeta) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '文档不存在' }));
        return;
      }

      // 按scope过滤
      const sens = docMeta.sensitivity || 'confidential';
      if (scope === 'public' && sens !== 'public') {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '访问被拒绝' }));
        return;
      }
      if (scope === 'lan' && sens === 'confidential') {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '访问被拒绝' }));
        return;
      }

      // 99_ 目录策略：仅本机(local)可浏览，lan/public 拒绝
      const rp = docMeta.relativePath;
      const is99Dir = rp.startsWith('99_') || rp.includes('/99_');
      if (is99Dir && scope !== 'local') {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '访问被拒绝' }));
        return;
      }

      // 路径安全检查
      const fullPath = safeKbPath(rp);
      if (!fullPath || !fs.existsSync(fullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '文档不存在' }));
        return;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');

      // 提取headings
      const headings = [];
      const headingRegex = /^(#{1,4})\s+(.+)$/gm;
      let hm;
      while ((hm = headingRegex.exec(content)) !== null) {
        headings.push({ level: hm[1].length, text: hm[2].trim(), position: hm.index });
      }

      // 统计相关chunk数量
      const chunkCount = (indexData.chunks || []).filter(c => c.documentId === docMeta.documentId).length;

      // 同分类相关文档（按当前访问范围过滤，V77.1.2: 99目录仅local可见）
      function canSeeRelatedDoc(doc) {
        const sens = doc.sensitivity;
        if (scope === 'public') { if (sens !== 'public') return false; }
        if (scope === 'lan') { if (sens !== 'public' && sens !== 'internal') return false; }
        if (scope !== 'local' && is99DirPath(doc.relativePath)) return false;
        return true;
      }
      const relatedDocs = (indexData.documents || [])
        .filter(d => d.dirCategory === docMeta.dirCategory && d.documentId !== docMeta.documentId && canSeeRelatedDoc(d))
        .slice(0, 10)
        .map(d => ({ documentId: d.documentId, title: d.title, relativePath: d.relativePath, sensitivity: d.sensitivity }));

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        document: {
          documentId: docMeta.documentId,
          title: docMeta.title,
          relativePath: docMeta.relativePath,
          fileName: docMeta.fileName,
          dirCategory: docMeta.dirCategory,
          dirSubcategory: docMeta.dirSubcategory,
          sensitivity: docMeta.sensitivity,
          status: docMeta.status,
          contentRole: docMeta.contentRole,
          authorityLevel: docMeta.authorityLevel,
          confidence: docMeta.confidence,
          version: docMeta.version,
          lastUpdated: docMeta.lastUpdated,
          dataSource: docMeta.dataSource,
          source: docMeta.source,
          useCase: docMeta.useCase,
          region: docMeta.region,
          tags: docMeta.tags,
          sourceUrl: docMeta.sourceUrl,
          sourceName: docMeta.sourceName,
          factEligible: docMeta.factEligible,
          templateEligible: docMeta.templateEligible,
          conflictReview: docMeta.conflictReview,
          pending: docMeta.pending,
          deprecated: docMeta.deprecated,
          demo: docMeta.demo,
          noOutbound: docMeta.noOutbound,
          charCount: docMeta.charCount
        },
        content: content,
        headings: headings,
        chunkCount: chunkCount,
        relatedDocuments: relatedDocs,
        accessScope: scope
      }, null, 2));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    log(`知识库文档详情: scope=${scope}, id=${documentId || 'N/A'}, path=${relativePath || 'N/A'}`, 'REQUEST');
    return;
  }

  // 知识库服务端检索（前端不再全量拉取索引）
  if (pathname === '/api/kb/search') {
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    // V77.0 Phase 1.2: KB_ROOT为null时fail-closed
    if (!KB_ROOT) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '知识库未配置(fail-closed)，请检查kb_config.json' }));
      return;
    }
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
      const indexData = loadKbIndex();
      let slices = indexData.slices || [];

      // 分类过滤
      if (categories.length > 0) {
        slices = slices.filter(s => categories.includes(s.category) || categories.includes(s.dirCategory) || categories.includes(s.fmCategory));
      }

      // 敏感级别过滤（根据访问范围）
      slices = filterSlicesByScope(slices, scope);

      // V77.0 Phase 1.2: purpose/provider 严格白名单，非法组合返回400
      const VALID_PURPOSES = ['browse', 'internal_ai', 'outbound'];
      const VALID_PROVIDERS = ['none', 'online_glm', 'local_ollama'];
      const purpose = (reqUrl.searchParams.get('purpose') || 'browse').toLowerCase();
      const providerRaw = reqUrl.searchParams.get('provider');
      const provider = providerRaw ? providerRaw.toLowerCase() : 'none';
      // 严格白名单校验
      if (!VALID_PURPOSES.includes(purpose)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '非法purpose参数，允许值: browse/internal_ai/outbound', purpose: purpose }));
        return;
      }
      if (!VALID_PROVIDERS.includes(provider)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '非法provider参数，允许值: none/online_glm/local_ollama', provider: provider }));
        return;
      }
      // 组合校验: browse只允许provider=none; internal_ai/outbound必须明确传online_glm或local_ollama
      if (purpose === 'browse' && provider !== 'none') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'browse模式不允许指定provider，请使用provider=none或省略provider' }));
        return;
      }
      if ((purpose === 'internal_ai' || purpose === 'outbound') && (provider === 'none')) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: purpose + '模式必须明确指定provider=online_glm或local_ollama' }));
        return;
      }
      let purposeFiltered = 0;
      if (purpose === 'internal_ai') {
        // AI 模型范围: online_glm仅public, local_ollama public+internal, confidential不得发给任何AI
        if (provider === 'online_glm') {
          const before = slices.length;
          slices = slices.filter(s => s.sensitivity === 'public');
          purposeFiltered = before - slices.length;
        } else if (provider === 'local_ollama') {
          const before = slices.length;
          slices = slices.filter(s => s.sensitivity === 'public' || s.sensitivity === 'internal');
          purposeFiltered = before - slices.length;
        }
        // confidential 始终排除
        const before2 = slices.length;
        slices = slices.filter(s => s.sensitivity !== 'confidential');
        purposeFiltered += before2 - slices.length;
      } else if (purpose === 'outbound') {
        // 对外内容: 仅public + active/confirmed + 排除pending/demo/deprecated/conflictReview/noOutbound
        const before = slices.length;
        slices = slices.filter(s => {
          if (s.sensitivity !== 'public') return false;
          if (s.pending) return false;
          if (s.demo) return false;
          if (s.deprecated) return false;
          if (s.conflictReview) return false;
          if (s.noOutbound) return false;
          if (s.outboundEligible === false) return false;
          const st = (s.status || '').toLowerCase();
          if (!(st.includes('active') || st.includes('confirmed') || st.includes('正式') || st.includes('公开'))) return false;
          return true;
        });
        purposeFiltered = before - slices.length;
      }
      // browse 模式: 不额外过滤，仅供人工浏览

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
      // 按 documentId 去重，保留最高分的 chunk
      const seenDocs = new Map();
      for (const r of results) {
        const docId = r.slice.documentId || r.slice.id || r.slice.chunkId;
        if (!seenDocs.has(docId) || r.score > seenDocs.get(docId).score) {
          seenDocs.set(docId, r);
        }
      }
      const dedupedResults = Array.from(seenDocs.values()).sort((a,b) => b.score - a.score);
      const totalUniqueDocs = dedupedResults.length;
      const topResults = dedupedResults.slice(0, topK);

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
          documentId: slice.documentId || slice.id || slice.chunkId,
          chunkId: slice.chunkId,
          title: slice.title || slice.fileName,
          filePath: slice.filePath || slice.relativePath,
          relativePath: slice.relativePath || slice.filePath,
          fileName: slice.fileName,
          category: slice.category,
          dirCategory: slice.dirCategory,
          fmCategory: slice.fmCategory,
          titleChain: slice.titleChain || slice.headingPath,
          snippet,
          sensitivity: slice.sensitivity,
          authority: slice.authorityLevel || slice.authority,
          authorityLevel: slice.authorityLevel,
          contentRole: slice.contentRole,
          status: slice.status,
          factEligible: slice.factEligible,
          templateEligible: slice.templateEligible,
          sourceUrl: slice.sourceUrl,
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
        purpose: purpose,
        provider: provider,
        purposeFiltered: purposeFiltered,
        totalCandidates: slices.length,
        totalMatches: totalMatches,
        totalUniqueDocs: totalUniqueDocs,
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

  // V77.2 统一知识库上下文检索API（精准开发客户画像/模块C复用）
  if (pathname === '/api/kb/context') {
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    if (!KB_ROOT) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '知识库未配置(fail-closed)，请检查kb_config.json' }));
      return;
    }
    const q = (reqUrl.searchParams.get('q') || '').trim();
    const purpose = (reqUrl.searchParams.get('purpose') || 'internal_ai').toLowerCase();
    const providerRaw = reqUrl.searchParams.get('provider');
    const provider = providerRaw ? providerRaw.toLowerCase() : 'online_glm';
    const limit = Math.min(parseInt(reqUrl.searchParams.get('limit') || '15'), 50);
    const categories = (reqUrl.searchParams.get('categories') || '').split(',').filter(c => c);
    const factOnly = reqUrl.searchParams.get('factOnly') === 'true';
    const templateOnly = reqUrl.searchParams.get('templateOnly') === 'true';
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '缺少查询参数q' }));
      return;
    }
    try {
      const ctx = retrieveKbContext({ query: q, purpose: purpose, provider: provider, accessScope: scope, limit: limit, categories: categories, factOnly: factOnly, templateOnly: templateOnly });
      if (ctx.error === 'invalid_purpose' || ctx.error === 'invalid_provider' || ctx.error === 'invalid_combination') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '非法purpose/provider组合: ' + ctx.error, purpose: purpose, provider: provider }));
        return;
      }
      if (ctx.error === 'index_unavailable') {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '知识库索引不可用(fail-closed)' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        query: ctx.query, accessScope: scope, purpose: ctx.purpose, provider: ctx.provider,
        kbVersion: ctx.kbVersion, totalMatched: ctx.totalMatched,
        facts: ctx.facts, templates: ctx.templates, citations: ctx.citations,
        excludedCount: ctx.excludedCount, excludedByEligibilityCount: ctx.excludedByEligibilityCount, policy: ctx.policy,
        factCount: ctx.facts.length, templateCount: ctx.templates.length
      }, null, 2));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '检索失败' })); // 不返回原始堆栈
    }
    log(`知识库上下文检索: scope=${scope}, purpose=${purpose}, provider=${provider}, q="${q}", facts=${0}`, 'REQUEST');
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
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    if (denyIfPublic(req, res, scope)) return;
    const config = loadSearchConfig();
    // V75.8 掩码格式：tvly-••••••••abcd（前4后4，中间8个点）
    let maskedKey = '';
    if (config.tavilyApiKey && config.tavilyApiKey.length > 8) {
      maskedKey = config.tavilyApiKey.substring(0, 4) + '••••••••' + config.tavilyApiKey.substring(config.tavilyApiKey.length - 4);
    } else if (config.tavilyApiKey) {
      maskedKey = config.tavilyApiKey.substring(0, 2) + '••••' + config.tavilyApiKey.substring(config.tavilyApiKey.length - 2);
    }
    const hasKey = !!config.tavilyApiKey;
    const configuredAt = config.configuredAt || null;
    const lastUpdated = config.lastUpdated || configuredAt || null;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    // 不返回完整tavilyApiKey，只返回maskedKey
    res.end(JSON.stringify({
      provider: 'tavily',
      hasTavilyKey: hasKey,
      maskedKey: maskedKey,
      configuredAt: configuredAt,
      lastUpdated: lastUpdated,
      searchCacheHours: config.searchCacheHours || 24,
      searxngEnabled: false,
      note: 'Tavily仅用于精准开发联网搜客，不参与AI文案生成。Key只存服务端search_config.json，不返回前端完整Key。'
    }));
    return;
  }

  if (pathname === '/api/search/config' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    if (denyIfPublic(req, res, scope)) return;
    try {
      const body = await readBody(req);
      const config = loadSearchConfig();
      let action = 'updated';
      // V75.8 支持清除Key
      if (body.clearKey === true) {
        config.tavilyApiKey = '';
        config.configuredAt = null;
        action = 'cleared';
      } else if (body.tavilyApiKey && body.tavilyApiKey !== '' && !body.tavilyApiKey.includes('••••') && !body.tavilyApiKey.includes('...')) {
        // 只接受完整Key（不含掩码字符），不接受掩码作为新Key
        config.tavilyApiKey = body.tavilyApiKey.trim();
        config.configuredAt = new Date().toISOString();
        action = 'saved';
      }
      if (body.searchCacheHours) config.searchCacheHours = parseInt(body.searchCacheHours);
      config.lastUpdated = new Date().toISOString();
      saveSearchConfig(config);
      // 不返回完整Key
      const maskedKey = config.tavilyApiKey && config.tavilyApiKey.length > 8
        ? config.tavilyApiKey.substring(0, 4) + '••••••••' + config.tavilyApiKey.substring(config.tavilyApiKey.length - 4)
        : '';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, action: action, hasTavilyKey: !!config.tavilyApiKey, maskedKey: maskedKey, message: action === 'cleared' ? 'Key已清除' : '配置已保存' }));
    } catch(e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // V75.8 Tavily连接测试（不消耗搜索额度，调用usage接口验证Key有效性）
  if (pathname === '/api/search/test' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    if (denyIfPublic(req, res, scope)) return;
    try {
      const config = loadSearchConfig();
      if (!config.tavilyApiKey) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, status: 'not_configured', message: 'Tavily API Key 未配置' }));
        return;
      }
      // 调用Tavily usage接口验证Key（不消耗搜索credits）
      const testStart = Date.now();
      const usageResult = await Promise.race([
        tavilyGetUsage(),
        new Promise(resolve => setTimeout(() => resolve({ available: false, reason: '连接超时(10s)' }), 10000))
      ]);
      const latency = Date.now() - testStart;
      if (usageResult && usageResult.available) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          status: 'connected',
          latency: latency,
          creditsUsed: usageResult.creditsUsed,
          creditsLimit: usageResult.creditsLimit,
          creditsRemaining: usageResult.creditsRemaining,
          message: 'Tavily连接成功，Key有效'
        }));
      } else {
        // usage接口不可用时，尝试一次basic搜索（消耗1 credit）验证Key
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          status: 'usage_unavailable',
          latency: latency,
          message: 'Tavily用量接口暂不可用（' + (usageResult ? usageResult.reason : '未知') + '），Key可能有效但无法验证额度'
        }));
      }
    } catch(e) {
      const errMsg = e.message || '未知错误';
      // 不泄露Key
      const safeMsg = errMsg.replace(/tvly-[a-zA-Z0-9]+/g, 'tvly-••••');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, status: 'error', message: '连接测试失败: ' + safeMsg }));
    }
    return;
  }

  // 统一搜索
  if (pathname === '/api/search' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
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
    if (!requireAuth(req, res)) return;
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
    if (!requireAuth(req, res)) return;
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

  // ============ V76.0 模块C：公司官网深度分析抓取接口 ============

  // 从HTML中确定性提取公司信息
  function extractCompanyInfo(html, url) {
    const info = {
      title: '',
      metaDescription: '',
      metaKeywords: '',
      language: '',
      companyName: '',
      emails: [],
      phones: [],
      addresses: [],
      socialLinks: [],
      productCategories: [],
      wholesaleSignals: [],
      privateLabelSignals: [],
      contactUrl: '',
      aboutUrl: '',
      productsUrl: '',
      wholesaleUrl: '',
      allLinks: [],
      // V76.1 新增：国家识别
      country: '',
      countryConfidence: 'unknown',
      countryEvidence: '',
      countryEvidenceUrl: '',
      // V76.1 新增：客户类型识别
      customerTypes: [],
      // V76.1 新增：证据
      evidence: [],
      // V76.1 新增：Amazon链接
      amazonLinks: []
    };

    try {
      // 页面标题
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch) info.title = titleMatch[1].trim().replace(/\s+/g, ' ');

      // Meta Description
      const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
      if (descMatch) info.metaDescription = descMatch[1].trim();

      // Meta Keywords
      const kwMatch = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']*)["']/i);
      if (kwMatch) info.metaKeywords = kwMatch[1].trim();

      // 页面语言
      const langMatch = html.match(/<html[^>]+lang=["']([^"']*)["']/i);
      if (langMatch) info.language = langMatch[1].trim();

      // 公开邮箱（去重）
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = html.match(emailRegex) || [];
      info.emails = [...new Set(emails.filter(e => !e.includes('example.com') && !e.includes('domain.com')))];

      // V76.2 公开电话（四级证据等级，严格过滤误判）
      info.phoneDetails = [];
      const seenPhones = new Set();

      function isValidPhone(raw) {
        const digits = raw.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) return false;
        // 排除年份
        if (/^(19|20)\d{2}$/.test(digits)) return false;
        // 排除纯4位
        if (/^\d{4}$/.test(digits)) return false;
        return true;
      }

      function normalizePhone(raw) {
        return raw.replace(/[\s\-()]/g, '').trim();
      }

      function addPhone(raw, confidence, sourceType, context) {
        if (!raw || !isValidPhone(raw)) return;
        const normalized = normalizePhone(raw);
        if (seenPhones.has(normalized)) return;
        seenPhones.add(normalized);
        info.phoneDetails.push({
          raw: raw.trim(),
          normalized: normalized,
          confidence: confidence,
          sourceUrl: url,
          sourceType: sourceType,
          context: (context || '').substring(0, 100)
        });
      }

      // 1. tel: 链接（high confidence）
      const telLinks = html.match(/href=["']tel:([^"']+)["']/gi);
      if (telLinks) {
        for (const tl of telLinks) {
          const num = tl.replace(/href=["']tel:/i, '').replace(/["']/g, '');
          addPhone(num, 'high', 'tel_link', 'tel:链接');
        }
      }

      // 2. JSON-LD telephone（high confidence）
      const jsonLdPhone = html.match(/"telephone"\s*:\s*"([^"]+)"/i) || html.match(/"telephone"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"/i);
      if (jsonLdPhone) {
        addPhone(jsonLdPhone[1], 'high', 'json_ld', 'JSON-LD telephone字段');
      }

      // 3. Contact/Imprint页面带标签的号码（medium/high）
      const isContactPage = /contact|impressum|imprint|about|company|联系/i.test(url) || /contact|impressum|imprint/i.test(html.substring(0, 5000).toLowerCase());
      if (isContactPage) {
        const labeledPhoneRegex = /(?:Phone|Tel|Telephone|Call|Fax|Telefon|电话|联系电话)\s*[:：]\s*([+()\d\-\s.]{7,20})/gi;
        let labeledMatch;
        while ((labeledMatch = labeledPhoneRegex.exec(html)) !== null) {
          addPhone(labeledMatch[1], 'high', 'contact_labeled', labeledMatch[0].substring(0, 50));
        }
      }

      // 4. 普通正文正则（low confidence，严格过滤上下文）
      const bodyPhoneRegex = /(?:\+\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]\d{3,4}(?:[-.\s]\d{1,4})?/g;
      const bodyPhones = html.match(bodyPhoneRegex) || [];
      for (const p of bodyPhones) {
        // 必须包含分隔符或+号
        if (!p.includes('+') && !p.includes('-') && !p.includes(' ') && !p.includes('(') && !p.includes(')')) continue;
        // 检查附近上下文是否有排除词
        const pIdx = html.indexOf(p);
        if (pIdx > 0) {
          const before = html.substring(Math.max(0, pIdx - 60), pIdx).toLowerCase();
          const after = html.substring(pIdx, Math.min(html.length, pIdx + 60)).toLowerCase();
          const excludeWords = ['sku', 'model', 'item', 'price', 'usd', 'eur', '£', '$', '€', 'year', 'years', 'warranty', 'guarantee', 'page', 'pages', 'item no', 'product code'];
          let hasExclude = false;
          for (const ew of excludeWords) {
            if (before.includes(ew) || after.includes(ew)) { hasExclude = true; break; }
          }
          if (hasExclude) continue;
        }
        addPhone(p, 'low', 'body_regex', '正文正则匹配');
      }

      // 最终phones数组只保留medium以上置信度
      info.phones = info.phoneDetails.filter(p => p.confidence !== 'low').map(p => p.raw);

      // V76.1 地址提取（简单模式：匹配常见地址格式）
      const addressRegex = /(\d+\s+[A-Za-z0-9\s.,'-]+?(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Square|Sq|Gasse|Straße|Str|Weg|Platz|Ring|Allee|Damm|Ufer|Chaussee|Drove|Close|Gardens|Estate|Industrial|Estate|Park|Way)\.?[^,\n]{0,80})/gi;
      const addresses = html.match(addressRegex) || [];
      info.addresses = [...new Set(addresses.map(a => a.trim().replace(/\s+/g, ' ')).filter(a => a.length > 10 && a.length < 200))].slice(0, 5);

      // V76.2 国家识别（严格证据等级，排除配送/货币/语言选择器）
      info.addresses = info.addresses || [];
      info.countryAddresses = [];

      // 提取页面正文（排除header/footer/nav/select选项）
      const mainContent = html
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<select[\s\S]*?<\/select>/gi, '')
        .replace(/<option[\s\S]*?<\/option>/gi, '');
      const mainText = mainContent.replace(/<[^>]*>/g, ' ');

      // 1. JSON-LD PostalAddress/addressCountry（high）
      const jsonLdAddress = html.match(/"address"\s*:\s*\{([^}]+)\}/i);
      const jsonLdCountry = html.match(/"addressCountry"\s*:\s*"([^"]+)"/i) || html.match(/"addressCountry"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i);
      if (jsonLdCountry) {
        info.country = jsonLdCountry[1].trim();
        info.countryConfidence = 'high';
        info.countryEvidence = 'JSON-LD addressCountry: ' + info.country;
        info.countryEvidenceUrl = url;
        info.countryAddresses.push({type: 'json_ld', address: jsonLdAddress ? jsonLdAddress[1].substring(0, 200) : info.country, sourceUrl: url, confidence: 'high'});
      }

      // 2. Contact/Imprint页面完整地址（high）
      const isContactOrImprint = /contact|impressum|imprint|about|company|联系|关于/i.test(url);
      if (isContactOrImprint && !info.country) {
        // 匹配完整地址模式（街道+城市+国家）
        const addressRegex = /(\d+\s+[A-Za-z0-9\s.,'-]+?(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Square|Sq|Gasse|Straße|Str|Weg|Platz|Ring|Allee|Damm|Ufer|Chaussee)\.?[^,\n]{0,120})/gi;
        const addresses = html.match(addressRegex) || [];
        for (const addr of addresses) {
          if (addr.length > 15 && addr.length < 300) {
            info.countryAddresses.push({type: 'contact_address', address: addr.trim().replace(/\s+/g, ' '), sourceUrl: url, confidence: 'high'});
            // 从地址中提取国家
            const countryInAddr = addr.match(/\b(United States|USA|Germany|Deutschland|United Kingdom|UK|France|Italy|Spain|Netherlands|Belgium|Austria|Switzerland|Sweden|Norway|Denmark|Finland|Poland|Czech|Australia|Canada|Japan|China)\b/i);
            if (countryInAddr && !info.country) {
              info.country = countryInAddr[1];
              info.countryConfidence = 'high';
              info.countryEvidence = 'Contact页面地址包含: ' + countryInAddr[1];
              info.countryEvidenceUrl = url;
            }
          }
        }
      }

      // 3. 公司注册号/法律声明（high）
      const legalRegex = /(?:GmbH|AG|Ltd|LLC|Inc|Corp|Corporation|Limited|S\.A\.|S\.r\.l\.)[^.]{0,100}(?:Register|Registration|HRB|HRB\s*\d+|Court|Amtsgericht)/gi;
      const legalMatch = html.match(legalRegex);
      if (legalMatch && !info.country) {
        const legalText = legalMatch[0];
        if (/Amtsgericht|HRB|GmbH/i.test(legalText)) {
          info.country = 'Germany';
          info.countryConfidence = 'high';
          info.countryEvidence = '法律声明/注册号: ' + legalText.substring(0, 80);
          info.countryEvidenceUrl = url;
        } else if (/Companies House|Ltd|Limited/i.test(legalText)) {
          info.country = 'United Kingdom';
          info.countryConfidence = 'high';
          info.countryEvidence = '法律声明/注册号: ' + legalText.substring(0, 80);
          info.countryEvidenceUrl = url;
        }
      }

      // 4. 电话国际区号+地址上下文（medium）
      if (!info.country && info.phoneDetails && info.phoneDetails.length > 0) {
        const highPhone = info.phoneDetails.find(p => p.confidence === 'high');
        if (highPhone) {
          const phoneCountryMap = {'+1': 'United States/Canada', '+44': 'United Kingdom', '+49': 'Germany', '+33': 'France', '+39': 'Italy', '+34': 'Spain', '+31': 'Netherlands', '+32': 'Belgium', '+43': 'Austria', '+41': 'Switzerland', '+46': 'Sweden', '+47': 'Norway', '+45': 'Denmark', '+358': 'Finland', '+48': 'Poland', '+420': 'Czech Republic', '+61': 'Australia', '+81': 'Japan', '+86': 'China'};
          for (const [code, country] of Object.entries(phoneCountryMap)) {
            if (highPhone.normalized.startsWith(code.replace(/\D/g, ''))) {
              info.country = country;
              info.countryConfidence = 'medium';
              info.countryEvidence = '高置信度电话区号 ' + code + ' -> ' + country;
              info.countryEvidenceUrl = highPhone.sourceUrl;
              break;
            }
          }
        }
      }

      // 5. ccTLD（medium/low，.com不判定）
      if (!info.country) {
        try {
          const hostname = new URL(url).hostname;
          const parts = hostname.split('.');
          const tld = parts.pop().toLowerCase();
          const secondTld = parts.length > 1 ? parts.pop().toLowerCase() + '.' + tld : '';
          const tldCountryMap = {'de': 'Germany', 'uk': 'United Kingdom', 'co.uk': 'United Kingdom', 'fr': 'France', 'it': 'Italy', 'es': 'Spain', 'nl': 'Netherlands', 'be': 'Belgium', 'at': 'Austria', 'ch': 'Switzerland', 'se': 'Sweden', 'no': 'Norway', 'dk': 'Denmark', 'fi': 'Finland', 'pl': 'Poland', 'cz': 'Czech Republic', 'au': 'Australia', 'ca': 'Canada', 'jp': 'Japan'};
          if (tldCountryMap[secondTld]) {
            info.country = tldCountryMap[secondTld];
            info.countryConfidence = 'medium';
            info.countryEvidence = 'ccTLD .' + secondTld + ' -> ' + info.country;
            info.countryEvidenceUrl = url;
          } else if (tldCountryMap[tld] && tld !== 'com' && tld !== 'org' && tld !== 'net') {
            info.country = tldCountryMap[tld];
            info.countryConfidence = 'low';
            info.countryEvidence = 'ccTLD .' + tld + ' -> ' + info.country + ' (弱信号)';
            info.countryEvidenceUrl = url;
          }
        } catch(e) {}
      }

      // 6. 页面普通正文出现国家名称（low，仅在主内容区，排除配送/货币/语言选择器）
      if (!info.country) {
        const countryNames = ['United States', 'Germany', 'Deutschland', 'United Kingdom', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Austria', 'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Poland', 'Australia', 'Canada', 'Japan'];
        for (const cn of countryNames) {
          const re = new RegExp('\\b' + cn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
          if (re.test(mainText)) {
            // 排除"配送至XX国家"、"货币选择"等上下文
            const cnIdx = mainText.toLowerCase().indexOf(cn.toLowerCase());
            if (cnIdx > 0) {
              const before = mainText.substring(Math.max(0, cnIdx - 40), cnIdx).toLowerCase();
              if (before.includes('ship to') || before.includes('shipping to') || before.includes('deliver to') || before.includes('currency') || before.includes('language')) continue;
            }
            info.country = cn;
            info.countryConfidence = 'low';
            info.countryEvidence = '页面正文包含: ' + cn + ' (弱信号，需人工确认)';
            info.countryEvidenceUrl = url;
            break;
          }
        }
      }

      // V76.2 三维度分离：businessRoles / commercialSignals / relationshipFit
      const bodyTextLower = html.replace(/<[^>]*>/g, ' ').toLowerCase();
      info.businessRoles = [];
      info.commercialSignals = [];
      info.relationshipFit = 'unknown';

      // 1. businessRoles（公司角色，需要明确业务证据）
      const roleRules = [
        {role: 'wholesaler', patterns: ['wholesale', 'trade account', 'trade customer', 'bulk purchasing', 'b2b wholesale', 'wholesale supplier'], confidence: 'high'},
        {role: 'distributor', patterns: ['distributor', 'dealer network', 'stockist', 'authorized dealer', 'distribution network'], confidence: 'high'},
        {role: 'importer', patterns: ['importer', 'import and distribution', 'import/distribution', 'importing'], confidence: 'medium'},
        {role: 'retailer', patterns: ['shop online', 'buy online', 'retail store', 'our stores', 'visit our store', 'online shop'], confidence: 'medium'},
        {role: 'brand_owner', patterns: ['our brand', 'brand story', 'brand history', 'trademark', 'registered trademark'], confidence: 'high'},
        {role: 'manufacturer', patterns: ['manufacturing facility', 'our factory', 'production facility', 'we manufacture', 'factory direct'], confidence: 'high'},
        {role: 'marketplace_seller', patterns: ['amazon store', 'amazon shop', 'ebay store', 'sell on amazon'], confidence: 'high'}
      ];
      for (const rule of roleRules) {
        for (const pattern of rule.patterns) {
          if (bodyTextLower.includes(pattern)) {
            if (!info.businessRoles.find(r => r.role === rule.role)) {
              info.businessRoles.push({role: rule.role, confidence: rule.confidence, evidence: pattern, sourceUrl: url});
            }
            break;
          }
        }
      }

      // 2. commercialSignals（合作信号，不等于采购需求）
      const signalRules = [
        {signal: 'wholesale_available', patterns: ['wholesale', 'wholesale prices', 'wholesale inquiry'], confidence: 'medium'},
        {signal: 'trade_account', patterns: ['trade account', 'trade login', 'trade customer'], confidence: 'high'},
        {signal: 'dealer_program', patterns: ['dealer program', 'become a dealer', 'dealer application'], confidence: 'high'},
        {signal: 'distributor_program', patterns: ['distributor program', 'become a distributor', 'distribution partner'], confidence: 'high'},
        {signal: 'bulk_orders', patterns: ['bulk order', 'bulk orders', 'volume discount', 'large quantity'], confidence: 'medium'},
        {signal: 'custom_branding', patterns: ['custom branding', 'custom logo', 'branding options'], confidence: 'medium'},
        {signal: 'oem_offered', patterns: ['oem service', 'oem manufacturing', 'we offer oem', 'oem available'], confidence: 'high'},
        {signal: 'odm_offered', patterns: ['odm service', 'odm manufacturing', 'we offer odm', 'odm available'], confidence: 'high'},
        {signal: 'private_label_offered', patterns: ['private label service', 'private label manufacturing', 'we offer private label', 'private label available', 'private label programs'], confidence: 'high'},
        {signal: 'amazon_store_linked', patterns: [], confidence: 'high'} // 由Amazon链接检测设置
      ];
      for (const rule of signalRules) {
        if (rule.signal === 'amazon_store_linked') continue;
        for (const pattern of rule.patterns) {
          if (bodyTextLower.includes(pattern)) {
            if (!info.commercialSignals.find(s => s.signal === rule.signal)) {
              info.commercialSignals.push({signal: rule.signal, confidence: rule.confidence, evidence: pattern, sourceUrl: url, note: '对方提供的服务，不等于采购需求'});
            }
            break;
          }
        }
      }
      // Amazon链接检测
      if (info.amazonLinks && info.amazonLinks.length > 0) {
        info.commercialSignals.push({signal: 'amazon_store_linked', confidence: 'high', evidence: '官网链接到Amazon店铺', sourceUrl: url, note: '可能是Amazon卖家'});
      }

      // 3. relationshipFit（关系适配判断）
      const hasBuyerSignal = info.businessRoles.some(r => ['wholesaler', 'distributor', 'importer', 'retailer', 'marketplace_seller'].includes(r.role) && r.confidence === 'high');
      const hasBrandSignal = info.businessRoles.some(r => r.role === 'brand_owner' && r.confidence === 'high');
      const hasManufacturerSignal = info.businessRoles.some(r => r.role === 'manufacturer' && r.confidence === 'high');
      const offersOEMODM = info.commercialSignals.some(s => ['oem_offered', 'odm_offered', 'private_label_offered'].includes(s.signal) && s.confidence === 'high');

      if (hasManufacturerSignal && offersOEMODM) {
        info.relationshipFit = 'competitor_supplier';
        info.relationshipFitReason = '对方是制造商且对外提供OEM/ODM，可能是竞争供应商而非买家';
      } else if (hasBuyerSignal && hasBrandSignal) {
        info.relationshipFit = 'mixed_role';
        info.relationshipFitReason = '同时具有买家渠道和自有品牌，需进一步确认采购需求';
      } else if (hasBuyerSignal) {
        info.relationshipFit = 'buyer_candidate';
        info.relationshipFitReason = '具有明确的批发/分销/进口/零售业务信号';
      } else if (hasBrandSignal && !hasBuyerSignal) {
        info.relationshipFit = 'brand_candidate';
        info.relationshipFitReason = '品牌商，可能需要OEM/ODM供应商';
      } else {
        info.relationshipFit = 'unknown';
        info.relationshipFitReason = '证据不足，无法判断关系适配';
      }

      // 兼容旧字段customerTypes（保留但标记为deprecated）
      info.customerTypes = info.businessRoles.map(r => ({type: r.role, confidence: r.confidence, evidence: r.evidence, sourceUrl: r.sourceUrl}));

      // V76.1 Amazon链接识别
      const amazonLinkRegex = /href=["']([^"']*amazon\.[^"']*)["']/gi;
      let amazonMatch;
      while ((amazonMatch = amazonLinkRegex.exec(html)) !== null) {
        if (!info.amazonLinks.includes(amazonMatch[1])) {
          info.amazonLinks.push(amazonMatch[1]);
        }
      }

      // 提取所有链接
      const linkRegex = /<a[^>]+href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let linkMatch;
      while ((linkMatch = linkRegex.exec(html)) !== null) {
        const href = linkMatch[1].trim();
        const text = linkMatch[2].replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          info.allLinks.push({ href, text });
          const lowerHref = href.toLowerCase();
          const lowerText = text.toLowerCase();

          // 识别关键页面
          if (lowerHref.includes('contact') || lowerText.includes('contact') || lowerText.includes('联系')) {
            if (!info.contactUrl) info.contactUrl = href;
          }
          if (lowerHref.includes('about') || lowerText.includes('about') || lowerText.includes('关于') || lowerText.includes('company')) {
            if (!info.aboutUrl) info.aboutUrl = href;
          }
          if (lowerHref.includes('product') || lowerHref.includes('category') || lowerHref.includes('shop') || lowerHref.includes('catalog') || lowerText.includes('product') || lowerText.includes('产品')) {
            if (!info.productsUrl) info.productsUrl = href;
            if (text && text.length < 50 && !info.productCategories.includes(text)) {
              info.productCategories.push(text);
            }
          }
          if (lowerHref.includes('wholesale') || lowerHref.includes('b2b') || lowerHref.includes('distributor') || lowerText.includes('wholesale') || lowerText.includes('批发') || lowerText.includes('经销')) {
            if (!info.wholesaleUrl) info.wholesaleUrl = href;
            if (text && text.length < 50) info.wholesaleSignals.push(text);
          }
          if (lowerHref.includes('private-label') || lowerHref.includes('private label') || lowerHref.includes('oem') || lowerHref.includes('odm') || lowerText.includes('private label') || lowerText.includes('贴牌') || lowerText.includes('定制')) {
            if (text && text.length < 50) info.privateLabelSignals.push(text);
          }

          // 社交媒体链接
          const socialDomains = ['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com', 'pinterest.com'];
          for (const sd of socialDomains) {
            if (lowerHref.includes(sd)) {
              info.socialLinks.push({ platform: sd.replace('.com',''), url: href });
              break;
            }
          }
        }
      }

      // 正文中的Wholesale/B2B信号
      const bodyText = html.replace(/<[^>]*>/g, ' ').toLowerCase();
      const wholesaleKeywords = ['wholesale', 'distributor', 'b2b', 'bulk order', 'reseller', 'dealer', '批发', '经销', '代理'];
      for (const kw of wholesaleKeywords) {
        if (bodyText.includes(kw) && !info.wholesaleSignals.includes(kw)) {
          info.wholesaleSignals.push(kw);
        }
      }

      // Private Label/OEM信号
      const plKeywords = ['private label', 'oem', 'odm', 'custom branding', 'own brand', '贴牌', '定制', '代工'];
      for (const kw of plKeywords) {
        if (bodyText.includes(kw) && !info.privateLabelSignals.includes(kw)) {
          info.privateLabelSignals.push(kw);
        }
      }

      // 公司名称（从title或og:site_name提取）
      const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i);
      if (ogSiteName) {
        info.companyName = ogSiteName[1].trim();
      } else if (info.title) {
        // 从title中提取公司名（取|或-之前的部分）
        const namePart = info.title.split(/[|\-–—]/)[0].trim();
        if (namePart && namePart.length < 60) info.companyName = namePart;
      }

    } catch(e) {
      console.error('提取公司信息失败:', e.message);
    }

    // 限制数组长度
    info.productCategories = info.productCategories.slice(0, 20);
    info.allLinks = info.allLinks.slice(0, 50);
    info.socialLinks = [...new Map(info.socialLinks.map(s => [s.url, s])).values()];

    return info;
  }

  // V76.1 robots.txt解析函数
  function parseRobotsTxt(text) {
    const rules = { allow: [], disallow: [], crawlDelay: null, sitemap: [] };
    if (!text) return rules;
    let currentAgent = '*';
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const value = trimmed.substring(colonIdx + 1).trim();
      if (key === 'user-agent') currentAgent = value;
      else if (key === 'allow' && (currentAgent === '*' || currentAgent === 'KaiLionCraftsBot')) rules.allow.push(value);
      else if (key === 'disallow' && (currentAgent === '*' || currentAgent === 'KaiLionCraftsBot')) rules.disallow.push(value);
      else if (key === 'crawl-delay') rules.crawlDelay = parseInt(value) || null;
      else if (key === 'sitemap') rules.sitemap.push(value);
    }
    return rules;
  }

  // V76.1 检查路径是否被robots.txt允许
  function isPathAllowedByRobots(path, rules) {
    if (!rules || rules.disallow.length === 0) return true;
    for (const disallowed of rules.disallow) {
      if (!disallowed) continue;
      if (disallowed === '/' ) return false;
      if (path.startsWith(disallowed)) return false;
    }
    return true;
  }

  // V76.1 抓取状态分类辅助函数
  function classifyFetchStatus(statusCode, error) {
    if (error) {
      if (error.includes('timeout') || error.includes('Timeout')) return 'timeout';
      if (error.includes('size') || error.includes('too large')) return 'size_limit';
      if (error.includes('跨域名')) return 'cross_domain_skipped';
      if (error.includes('SSRF')) return 'ssrf_blocked';
      if (error.includes('robots')) return 'robots_blocked';
      return 'failed';
    }
    if (statusCode >= 200 && statusCode < 300) return 'success';
    if (statusCode === 404) return 'not_found';
    if (statusCode === 403 || statusCode === 429) return 'blocked';
    if (statusCode >= 500) return 'server_error';
    return 'other';
  }

  // 模块C：批量抓取公司官网并提取信息
  if (pathname === '/api/company/fetch' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    const scope = getAccessScope(req);
    if (denyIfPublic(req, res, scope)) return;
    try {
      const body = await readBody(req);
      const baseUrl = (body.url || '').trim();
      if (!baseUrl) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: '缺少url参数' })); return; }

      // SSRF预检查
      if (!isUrlSafe(baseUrl)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'SSRF防护：禁止访问内网或本地地址' }));
        return;
      }

      const baseDomain = new URL(baseUrl).hostname.replace(/^www\./, '');

      // V76.1 robots.txt显式检查
      const robotsUrl = new URL('/robots.txt', baseUrl).href;
      let robotsStatus = 'unavailable';
      let robotsRules = null;
      let robotsFetchedAt = null;
      let crawlDelay = 1000; // 默认1秒
      try {
        if (isUrlSafe(robotsUrl)) {
          const robotsResult = await fetchUrl(robotsUrl, { timeout: 10000, maxSize: 512*1024 });
          robotsFetchedAt = new Date().toISOString();
          if (robotsResult.statusCode === 200) {
            robotsStatus = 'available';
            robotsRules = parseRobotsTxt(robotsResult.body);
            if (robotsRules.crawlDelay) crawlDelay = Math.max(1000, robotsRules.crawlDelay * 1000);
          } else if (robotsResult.statusCode === 404) {
            robotsStatus = 'unavailable';
          } else {
            robotsStatus = 'error';
          }
        }
      } catch(e) {
        robotsStatus = 'error';
        log(`robots.txt请求失败: ${e.message}`, 'WARN');
      }

      // 确定要抓取的页面（最多5个）
      const pagesToFetch = [{ url: baseUrl, type: 'homepage', label: '首页' }];

      // 先抓取首页，从中发现About/Contact/Products/Wholesale页面
      log(`模块C抓取: scope=${scope}, url=${baseUrl}, robots=${robotsStatus}`, 'REQUEST');

      const fetchedPages = [];
      const failedPages = [];
      const skippedPages = [];
      const blockedPages = [];
      let attemptedPages = 0;
      let homepageInfo = null;

      try {
        attemptedPages++;
        // V76.1 检查robots.txt是否允许首页
        let homeRobotsAllowed = true;
        if (robotsRules && !isPathAllowedByRobots('/', robotsRules)) {
          homeRobotsAllowed = false;
        }

        if (!homeRobotsAllowed) {
          blockedPages.push({ url: baseUrl, type: 'homepage', label: '首页', status: 'robots_blocked', error: 'robots.txt禁止抓取' });
          throw new Error('robots.txt禁止抓取首页');
        }

        const homeResult = await fetchUrl(baseUrl, { timeout: 15000, maxSize: 2*1024*1024 });
        const homeStatus = classifyFetchStatus(homeResult.statusCode, null);
        homepageInfo = extractCompanyInfo(homeResult.body, baseUrl);
        const homePageEntry = {
          url: homeResult.finalUrl || baseUrl,
          type: 'homepage',
          label: '首页',
          statusCode: homeResult.statusCode,
          status: homeStatus,
          size: homeResult.size,
          fetchedAt: homeResult.fetchedAt,
          info: homepageInfo
        };
        if (homeStatus === 'success') {
          fetchedPages.push(homePageEntry);
        } else if (homeStatus === 'blocked' || homeStatus === 'robots_blocked') {
          blockedPages.push(homePageEntry);
        } else {
          failedPages.push(homePageEntry);
        }

        // 从首页发现的链接中选择要抓取的页面
        const discoveredPages = [];
        if (homepageInfo.aboutUrl) discoveredPages.push({ url: resolveUrl(baseUrl, homepageInfo.aboutUrl), type: 'about', label: '关于我们' });
        if (homepageInfo.contactUrl) discoveredPages.push({ url: resolveUrl(baseUrl, homepageInfo.contactUrl), type: 'contact', label: '联系我们' });
        if (homepageInfo.productsUrl) discoveredPages.push({ url: resolveUrl(baseUrl, homepageInfo.productsUrl), type: 'products', label: '产品' });
        if (homepageInfo.wholesaleUrl) discoveredPages.push({ url: resolveUrl(baseUrl, homepageInfo.wholesaleUrl), type: 'wholesale', label: '批发/B2B' });

        // 抓取发现的页面（同一域名，使用crawlDelay间隔）
        for (const page of discoveredPages.slice(0, 4)) {
          attemptedPages++;
          try {
            // 确保同一根域名
            const pageDomain = new URL(page.url).hostname.replace(/^www\./, '');
            if (pageDomain !== baseDomain && !pageDomain.endsWith('.' + baseDomain) && !baseDomain.endsWith('.' + pageDomain)) {
              skippedPages.push({ url: page.url, type: page.type, label: page.label, status: 'cross_domain_skipped', error: '跨域名，跳过' });
              continue;
            }
            // V76.1 robots.txt路径检查
            if (robotsRules) {
              try {
                const pagePath = new URL(page.url).pathname;
                if (!isPathAllowedByRobots(pagePath, robotsRules)) {
                  blockedPages.push({ url: page.url, type: page.type, label: page.label, status: 'robots_blocked', error: 'robots.txt禁止抓取: ' + pagePath });
                  continue;
                }
              } catch(e) {}
            }
            await new Promise(r => setTimeout(r, crawlDelay)); // 使用robots.txt的crawl-delay
            const result = await fetchUrl(page.url, { timeout: 15000, maxSize: 2*1024*1024 });
            const pageStatus = classifyFetchStatus(result.statusCode, null);
            const pageInfo = extractCompanyInfo(result.body, page.url);
            const pageEntry = {
              url: result.finalUrl || page.url,
              type: page.type,
              label: page.label,
              statusCode: result.statusCode,
              status: pageStatus,
              size: result.size,
              fetchedAt: result.fetchedAt,
              info: pageInfo
            };
            if (pageStatus === 'success') {
              fetchedPages.push(pageEntry);
            } else if (pageStatus === 'blocked' || pageStatus === 'robots_blocked') {
              blockedPages.push(pageEntry);
            } else if (pageStatus === 'not_found') {
              failedPages.push(pageEntry);
            } else {
              failedPages.push(pageEntry);
            }
          } catch(e) {
            const errStatus = classifyFetchStatus(null, e.message);
            const errEntry = { url: page.url, type: page.type, label: page.label, status: errStatus, error: e.message };
            if (errStatus === 'cross_domain_skipped') skippedPages.push(errEntry);
            else if (errStatus === 'robots_blocked' || errStatus === 'ssrf_blocked') blockedPages.push(errEntry);
            else failedPages.push(errEntry);
          }
        }
      } catch(e) {
        failedPages.push({ url: baseUrl, type: 'homepage', label: '首页', error: e.message });
      }

      // 合并所有页面的提取信息
      const mergedInfo = {
        title: homepageInfo?.title || '',
        metaDescription: homepageInfo?.metaDescription || '',
        language: homepageInfo?.language || '',
        companyName: homepageInfo?.companyName || '',
        emails: [],
        phones: [],
        addresses: [],
        socialLinks: [],
        productCategories: [],
        wholesaleSignals: [],
        privateLabelSignals: [],
        keyPages: {},
        // V76.1 新增
        country: '',
        countryConfidence: 'unknown',
        countryEvidence: '',
        countryEvidenceUrl: '',
        customerTypes: [],
        evidence: [],
        amazonLinks: []
      };

      for (const page of fetchedPages) {
        // 跳过非success状态页面的信息提取
        if (page.status !== 'success') continue;
        const info = page.info;
        if (info.emails) mergedInfo.emails.push(...info.emails);
        if (info.phones) mergedInfo.phones.push(...info.phones);
        if (info.addresses) mergedInfo.addresses.push(...info.addresses);
        if (info.socialLinks) mergedInfo.socialLinks.push(...info.socialLinks);
        if (info.productCategories) mergedInfo.productCategories.push(...info.productCategories);
        if (info.wholesaleSignals) mergedInfo.wholesaleSignals.push(...info.wholesaleSignals);
        if (info.privateLabelSignals) mergedInfo.privateLabelSignals.push(...info.privateLabelSignals);
        if (info.amazonLinks) mergedInfo.amazonLinks.push(...info.amazonLinks);
        if (page.type) mergedInfo.keyPages[page.type] = { url: page.url, statusCode: page.statusCode, status: page.status, label: page.label };

        // V76.1 国家识别：取最高置信度
        if (info.country && info.countryConfidence) {
          const confidenceOrder = { high: 3, medium: 2, low: 1, unknown: 0 };
          const currentConf = confidenceOrder[mergedInfo.countryConfidence] || 0;
          const newConf = confidenceOrder[info.countryConfidence] || 0;
          if (newConf > currentConf || !mergedInfo.country) {
            mergedInfo.country = info.country;
            mergedInfo.countryConfidence = info.countryConfidence;
            mergedInfo.countryEvidence = info.countryEvidence;
            mergedInfo.countryEvidenceUrl = info.countryEvidenceUrl;
          }
        }

        // V76.1 客户类型合并（去重）
        if (info.customerTypes) {
          for (const ct of info.customerTypes) {
            const existing = mergedInfo.customerTypes.find(c => c.type === ct.type);
            if (!existing) {
              mergedInfo.customerTypes.push(ct);
            } else {
              // 取更高置信度
              const confOrder = { high: 3, medium: 2, low: 1 };
              if ((confOrder[ct.confidence] || 0) > (confOrder[existing.confidence] || 0)) {
                existing.confidence = ct.confidence;
                existing.evidence = ct.evidence;
                existing.sourceUrl = ct.sourceUrl;
              }
            }
          }
        }

        // V76.1 证据生成（确定性提取）
        const pageUrl = page.url;
        const sourceType = page.label || page.type || '页面';
        if (info.companyName && !mergedInfo.evidence.find(e => e.claim === '公司名称')) {
          mergedInfo.evidence.push({ claim: '公司名称', value: info.companyName, sourceUrl: pageUrl, sourceType, shortEvidence: '页面标题/og:site_name', confidence: 'high', extractionMethod: 'deterministic', verifiedAt: new Date().toISOString() });
        }
        if (info.emails?.length > 0 && !mergedInfo.evidence.find(e => e.claim === '公开邮箱')) {
          mergedInfo.evidence.push({ claim: '公开邮箱', value: info.emails.join(', '), sourceUrl: pageUrl, sourceType, shortEvidence: '页面正则提取', confidence: 'high', extractionMethod: 'deterministic', verifiedAt: new Date().toISOString() });
        }
        if (info.phones?.length > 0 && !mergedInfo.evidence.find(e => e.claim === '公开电话')) {
          mergedInfo.evidence.push({ claim: '公开电话', value: info.phones.join(', '), sourceUrl: pageUrl, sourceType, shortEvidence: '页面正则提取', confidence: 'medium', extractionMethod: 'deterministic', verifiedAt: new Date().toISOString() });
        }
        if (info.language && !mergedInfo.evidence.find(e => e.claim === '网站语言')) {
          mergedInfo.evidence.push({ claim: '网站语言', value: info.language, sourceUrl: pageUrl, sourceType, shortEvidence: 'html lang属性', confidence: 'high', extractionMethod: 'deterministic', verifiedAt: new Date().toISOString() });
        }
        if (info.productCategories?.length > 0 && !mergedInfo.evidence.find(e => e.claim === '产品分类')) {
          mergedInfo.evidence.push({ claim: '产品分类', value: info.productCategories.slice(0,5).join(', '), sourceUrl: pageUrl, sourceType, shortEvidence: '导航/产品页链接', confidence: 'medium', extractionMethod: 'deterministic', verifiedAt: new Date().toISOString() });
        }
        if (info.wholesaleSignals?.length > 0 && !mergedInfo.evidence.find(e => e.claim === 'Wholesale/B2B信号')) {
          mergedInfo.evidence.push({ claim: 'Wholesale/B2B信号', value: info.wholesaleSignals.slice(0,3).join(', '), sourceUrl: pageUrl, sourceType, shortEvidence: '页面关键词匹配', confidence: 'medium', extractionMethod: 'deterministic', verifiedAt: new Date().toISOString() });
        }
        if (info.privateLabelSignals?.length > 0 && !mergedInfo.evidence.find(e => e.claim === 'OEM/Private Label信号')) {
          mergedInfo.evidence.push({ claim: 'OEM/Private Label信号', value: info.privateLabelSignals.slice(0,3).join(', '), sourceUrl: pageUrl, sourceType, shortEvidence: '页面关键词匹配', confidence: 'medium', extractionMethod: 'deterministic', verifiedAt: new Date().toISOString() });
        }
        if (info.country && !mergedInfo.evidence.find(e => e.claim === '国家')) {
          mergedInfo.evidence.push({ claim: '国家', value: info.country, sourceUrl: info.countryEvidenceUrl || pageUrl, sourceType, shortEvidence: info.countryEvidence, confidence: info.countryConfidence, extractionMethod: 'deterministic', verifiedAt: new Date().toISOString() });
        }
        if (info.customerTypes?.length > 0) {
          for (const ct of info.customerTypes) {
            if (!mergedInfo.evidence.find(e => e.claim === '客户类型:' + ct.type)) {
              mergedInfo.evidence.push({ claim: '客户类型:' + ct.type, value: ct.type, sourceUrl: ct.sourceUrl || pageUrl, sourceType, shortEvidence: ct.evidence, confidence: ct.confidence, extractionMethod: 'deterministic', verifiedAt: new Date().toISOString() });
            }
          }
        }
        if (info.amazonLinks?.length > 0 && !mergedInfo.evidence.find(e => e.claim === 'Amazon官方链接')) {
          mergedInfo.evidence.push({ claim: 'Amazon官方链接', value: info.amazonLinks[0], sourceUrl: pageUrl, sourceType, shortEvidence: '页面链接到Amazon', confidence: 'high', extractionMethod: 'deterministic', verifiedAt: new Date().toISOString() });
        }
      }

      // 去重
      mergedInfo.emails = [...new Set(mergedInfo.emails)];
      mergedInfo.phones = [...new Set(mergedInfo.phones)];
      mergedInfo.addresses = [...new Set(mergedInfo.addresses)];
      mergedInfo.socialLinks = [...new Map(mergedInfo.socialLinks.map(s => [s.url, s])).values()];
      mergedInfo.productCategories = [...new Set(mergedInfo.productCategories)].slice(0, 30);
      mergedInfo.wholesaleSignals = [...new Set(mergedInfo.wholesaleSignals)].slice(0, 20);
      mergedInfo.privateLabelSignals = [...new Set(mergedInfo.privateLabelSignals)].slice(0, 20);
      mergedInfo.amazonLinks = [...new Set(mergedInfo.amazonLinks)];
      // 客户类型去重
      const seenTypes = new Set();
      mergedInfo.customerTypes = mergedInfo.customerTypes.filter(ct => {
        if (seenTypes.has(ct.type)) return false;
        seenTypes.add(ct.type);
        return true;
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        rootDomain: baseDomain,
        // V76.1 抓取统计（数字相互一致）
        attemptedPages: attemptedPages,
        fetchedPages: fetchedPages,
        failedPages: failedPages,
        skippedPages: skippedPages,
        blockedPages: blockedPages,
        // V76.1 robots.txt信息
        robots: {
          status: robotsStatus,
          url: robotsUrl,
          fetchedAt: robotsFetchedAt,
          crawlDelay: crawlDelay,
          disallowCount: robotsRules?.disallow?.length || 0,
          allowCount: robotsRules?.allow?.length || 0
        },
        extractedInfo: mergedInfo,
        analyzedAt: new Date().toISOString()
      }));

      log(`模块C抓取完成: ${baseDomain}, 尝试${attemptedPages}页, 成功${fetchedPages.length}页, 失败${failedPages.length}页, 跳过${skippedPages.length}页, 阻止${blockedPages.length}页`, 'REQUEST');
    } catch(e) {
      const isSSRF = e.message.includes('SSRF');
      res.writeHead(isSSRF ? 403 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message, ssrfBlocked: isSSRF }));
      log(`模块C抓取失败: ${e.message}`, isSSRF ? 'WARN' : 'ERROR');
    }
    return;
  }

  // URL解析辅助函数
  function resolveUrl(base, relative) {
    try { return new URL(relative, base).href; } catch(e) { return relative; }
  }

  // 清除搜索缓存
  if (pathname === '/api/search/cache' && req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
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
