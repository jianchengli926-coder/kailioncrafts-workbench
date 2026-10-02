/**
 * P2.3A: 单客户网站证据采集与人工核验
 * 
 * 只处理 Leo 明确输入的单个客户网站，只读取公开页面。
 * 所有抓取结果默认 pending，必须人工核验后才能进入公开 Knowledge Pack。
 * 
 * 安全边界：
 * - 只允许 http:// 和 https://
 * - 阻断 localhost、127.0.0.1、私有 IP、内网域名
 * - 防止 SSRF
 * - 连接超时、响应大小上限、重定向次数上限
 * - 只解析 text/html
 * - 不执行网页 JavaScript
 * - 不保存完整网页 HTML
 * - 联系方式默认脱敏
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');

// ============== 配置 ==============
const CONFIG = {
  connectTimeout: 10000,      // 连接超时 10 秒
  totalTimeout: 30000,        // 总超时 30 秒
  maxResponseSize: 1024 * 1024, // 响应大小上限 1MB
  maxRedirects: 5,            // 重定向次数上限
  maxExcerptLength: 2000,     // 摘要最大长度
  userAgent: 'KaiLionCrafts-Prospect-Evidence/1.0 (+https://kailioncrafts.com)',
  allowedProtocols: ['http:', 'https:']
};

// ============== P2.5B: 多页证据采集 ==============
// 页面类型分类（home/about/products/contact/custom）
const PAGE_TYPES = ['home', 'about', 'products', 'contact', 'custom'];
// 单次采集最多页数
const MAX_PAGES_PER_COLLECT = 3;
// 证据 schema 版本（P2.5B：多页 + pageType）
const EVIDENCE_SCHEMA_VERSION = 'P2.5B';

/**
 * 规范化 pageType：必须属于 PAGE_TYPES，否则归为 custom
 * @param {string} pageType
 * @returns {string}
 */
function normalizePageType(pageType) {
  return PAGE_TYPES.includes(pageType) ? pageType : 'custom';
}

/**
 * 规范化 URL 用于去重比较：忽略末尾斜杠、大小写、首尾空白
 * @param {string} u
 * @returns {string}
 */
function normalizeUrlForCompare(u) {
  if (!u || typeof u !== 'string') return '';
  return u.trim().toLowerCase().replace(/\/+$/, '');
}

// ============== SSRF 防护 ==============

/**
 * 校验 URL 是否安全
 * @param {string} urlString - 待校验的 URL
 * @returns {Object} { valid, url, error }
 */
function validateUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, error: 'URL 为空' };
  }

  let parsed;
  try {
    parsed = new URL(urlString.trim());
  } catch (e) {
    return { valid: false, error: 'URL 格式无效: ' + e.message };
  }

  // 协议检查
  if (!CONFIG.allowedProtocols.includes(parsed.protocol)) {
    return { valid: false, error: '不允许的协议: ' + parsed.protocol + '（只允许 http/https）' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 阻断 localhost
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { valid: false, error: '禁止访问 localhost' };
  }

  // 阻断常见内网域名
  const internalDomains = [
    'internal', 'intranet', 'corp', 'local',
    '.local', '.internal', '.intranet', '.corp'
  ];
  for (const domain of internalDomains) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return { valid: false, error: '禁止访问内网域名: ' + hostname };
    }
  }

  // IP 地址检查
  if (isIpAddress(hostname)) {
    if (isPrivateIp(hostname)) {
      return { valid: false, error: '禁止访问私有 IP: ' + hostname };
    }
    if (hostname === '0.0.0.0' || hostname === '::') {
      return { valid: false, error: '禁止访问 0.0.0.0' };
    }
  }

  return { valid: true, url: parsed };
}

/**
 * 判断是否为 IP 地址
 */
function isIpAddress(hostname) {
  // IPv4
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(hostname)) return true;
  // IPv6 (简化检查)
  if (hostname.includes(':') && hostname.includes('::') || /^[0-9a-f:]+$/.test(hostname)) return true;
  return false;
}

/**
 * 判断是否为私有 IP
 */
function isPrivateIp(ip) {
  // IPv4 私有范围
  const ipv4Parts = ip.split('.').map(Number);
  if (ipv4Parts.length === 4) {
    // 10.0.0.0/8
    if (ipv4Parts[0] === 10) return true;
    // 172.16.0.0/12
    if (ipv4Parts[0] === 172 && ipv4Parts[1] >= 16 && ipv4Parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (ipv4Parts[0] === 192 && ipv4Parts[1] === 168) return true;
    // 127.0.0.0/8 (回环)
    if (ipv4Parts[0] === 127) return true;
    // 169.254.0.0/16 (链路本地)
    if (ipv4Parts[0] === 169 && ipv4Parts[1] === 254) return true;
  }
  // IPv6 私有/回环
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) {
    return true;
  }
  return false;
}

// ============== 网页抓取 ==============

/**
 * 抓取网页（只读）
 * @param {string} urlString - 目标 URL
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 抓取结果
 */
function fetchWebsite(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    const validation = validateUrl(urlString);
    if (!validation.valid) {
      return resolve({
        success: false,
        error: validation.error,
        errorType: 'ssrf_blocked',
        sourceUrl: urlString
      });
    }

    const targetUrl = validation.url;
    const maxRedirects = options.maxRedirects || CONFIG.maxRedirects;
    let redirectCount = 0;

    function doFetch(currentUrl) {
      const isHttps = currentUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const requestOptions = {
        hostname: currentUrl.hostname,
        port: currentUrl.port || (isHttps ? 443 : 80),
        path: currentUrl.pathname + currentUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': CONFIG.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity'
        },
        timeout: CONFIG.connectTimeout
      };

      const req = client.request(requestOptions, (res) => {
        // 处理重定向
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectCount >= maxRedirects) {
            res.resume();
            return resolve({
              success: false,
              error: '重定向次数超过上限 (' + maxRedirects + ')',
              errorType: 'too_many_redirects',
              sourceUrl: urlString,
              finalUrl: currentUrl.href,
              httpStatus: res.statusCode
            });
          }
          redirectCount++;
          let redirectUrl;
          try {
            redirectUrl = new URL(res.headers.location, currentUrl);
          } catch (e) {
            return resolve({
              success: false,
              error: '无效的重定向地址',
              errorType: 'invalid_redirect',
              sourceUrl: urlString
            });
          }
          // 重定向 URL 也要校验
          const redirectValidation = validateUrl(redirectUrl.href);
          if (!redirectValidation.valid) {
            return resolve({
              success: false,
              error: '重定向到不安全地址: ' + redirectValidation.error,
              errorType: 'ssrf_redirect_blocked',
              sourceUrl: urlString,
              finalUrl: redirectUrl.href
            });
          }
          res.resume();
          return doFetch(redirectValidation.url);
        }

        // 检查 Content-Type
        const contentType = res.headers['content-type'] || '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          res.resume();
          return resolve({
            success: false,
            error: '非 HTML 响应: ' + contentType,
            errorType: 'non_html_response',
            sourceUrl: urlString,
            finalUrl: currentUrl.href,
            httpStatus: res.statusCode,
            contentType: contentType
          });
        }

        // 读取响应体（限制大小）
        let body = '';
        let size = 0;
        const totalTimer = setTimeout(() => {
          req.destroy();
          resolve({
            success: false,
            error: '请求总超时 (' + CONFIG.totalTimeout + 'ms)',
            errorType: 'timeout',
            sourceUrl: urlString,
            finalUrl: currentUrl.href,
            httpStatus: res.statusCode
          });
        }, CONFIG.totalTimeout);

        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > CONFIG.maxResponseSize) {
            clearTimeout(totalTimer);
            req.destroy();
            return resolve({
              success: false,
              error: '响应大小超过上限 (' + CONFIG.maxResponseSize + ' bytes)',
              errorType: 'response_too_large',
              sourceUrl: urlString,
              finalUrl: currentUrl.href,
              httpStatus: res.statusCode
            });
          }
          body += chunk.toString('utf8');
        });

        res.on('end', () => {
          clearTimeout(totalTimer);
          if (res.statusCode >= 400) {
            return resolve({
              success: false,
              error: 'HTTP 错误: ' + res.statusCode,
              errorType: 'http_error',
              sourceUrl: urlString,
              finalUrl: currentUrl.href,
              httpStatus: res.statusCode
            });
          }
          resolve({
            success: true,
            sourceUrl: urlString,
            finalUrl: currentUrl.href,
            httpStatus: res.statusCode,
            contentType: contentType,
            body: body,
            fetchedAt: new Date().toISOString()
          });
        });

        res.on('error', (err) => {
          clearTimeout(totalTimer);
          resolve({
            success: false,
            error: '响应错误: ' + err.message,
            errorType: 'response_error',
            sourceUrl: urlString,
            finalUrl: currentUrl.href
          });
        });
      });

      req.on('error', (err) => {
        resolve({
          success: false,
          error: '请求错误: ' + err.message,
          errorType: 'request_error',
          sourceUrl: urlString
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: '连接超时 (' + CONFIG.connectTimeout + 'ms)',
          errorType: 'connect_timeout',
          sourceUrl: urlString
        });
      });

      req.end();
    }

    doFetch(targetUrl);
  });
}

// ============== 内容提取 ==============

/**
 * 从 HTML 中提取业务线索
 * @param {string} html - HTML 内容
 * @param {string} finalUrl - 最终 URL
 * @returns {Object} 提取结果
 */
function extractEvidence(html, finalUrl) {
  const warnings = [];
  const result = {
    pageTitle: '',
    detectedCompanyName: '',
    detectedProducts: [],
    detectedMarkets: [],
    detectedBuyerTypes: [],
    contactHints: [],
    excerpt: '',
    extractionWarnings: warnings
  };

  if (!html || typeof html !== 'string') {
    warnings.push('HTML 内容为空');
    return result;
  }

  // 提取页面标题
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    result.pageTitle = stripHtmlTags(titleMatch[1]).trim().substring(0, 200);
  }

  // 提取 meta description
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  let metaDesc = descMatch ? stripHtmlTags(descMatch[1]).trim() : '';

  // 提取正文文本（简化版：移除 script/style，然后取文本）
  const textContent = extractTextContent(html);

  // 生成摘要
  const combinedText = (metaDesc + ' ' + textContent).trim();
  result.excerpt = combinedText.substring(0, CONFIG.maxExcerptLength);
  if (combinedText.length > CONFIG.maxExcerptLength) {
    warnings.push('内容已截断，完整页面超过 ' + CONFIG.maxExcerptLength + ' 字符');
  }

  // 检测公司名称（从 title 或 h1）
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const h1Text = stripHtmlTags(h1Match[1]).trim();
    if (h1Text && h1Text.length < 100) {
      result.detectedCompanyName = h1Text;
    }
  }
  if (!result.detectedCompanyName && result.pageTitle) {
    // 从 title 中提取公司名（取 | 或 - 之前的部分）
    const companyPart = result.pageTitle.split(/[|\-–—]/)[0].trim();
    if (companyPart && companyPart.length < 80) {
      result.detectedCompanyName = companyPart;
    }
  }

  // 检测产品关键词
  const productKeywords = [
    'kitchen', 'knife', 'knives', 'cutlery', 'shears', 'scissors', 'tools',
    'hardware', 'stainless', 'steel', 'manufacturer', 'supplier',
    'factory', 'oem', 'odm', 'private label', 'wholesale',
    'distributor', 'import', 'export', 'products', 'catalog'
  ];
  const lowerText = textContent.toLowerCase();
  for (const keyword of productKeywords) {
    if (lowerText.includes(keyword)) {
      result.detectedProducts.push(keyword);
    }
  }
  result.detectedProducts = [...new Set(result.detectedProducts)].slice(0, 20);

  // 检测市场/地区
  const marketKeywords = [
    'usa', 'united states', 'europe', 'eu', 'uk', 'germany',
    'france', 'uk', 'australia', 'canada', 'japan', 'global',
    'worldwide', 'international', 'north america', 'european'
  ];
  for (const keyword of marketKeywords) {
    if (lowerText.includes(keyword)) {
      result.detectedMarkets.push(keyword);
    }
  }
  result.detectedMarkets = [...new Set(result.detectedMarkets)].slice(0, 10);

  // 检测买家类型
  const buyerTypeKeywords = [
    'wholesaler', 'distributor', 'retailer', 'importer', 'buyer',
    'reseller', 'dealer', 'agent', 'trading company', 'brand',
    'chain store', 'supermarket', 'online store', 'e-commerce'
  ];
  for (const keyword of buyerTypeKeywords) {
    if (lowerText.includes(keyword)) {
      result.detectedBuyerTypes.push(keyword);
    }
  }
  result.detectedBuyerTypes = [...new Set(result.detectedBuyerTypes)].slice(0, 10);

  // 检测联系方式（脱敏）
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = html.match(emailRegex) || [];
  for (const email of [...new Set(emails)].slice(0, 5)) {
    result.contactHints.push({ type: 'email', value: maskEmail(email) });
  }

  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}/g;
  const phones = html.match(phoneRegex) || [];
  for (const phone of [...new Set(phones)].slice(0, 3)) {
    if (phone.replace(/\D/g, '').length >= 7) {
      result.contactHints.push({ type: 'phone', value: maskPhone(phone) });
    }
  }

  // 检测高风险内容（需要人工确认）
  const highRiskKeywords = [
    'certified', 'certification', 'iso', 'bsci', 'sedex', 'audit',
    'factory', 'own factory', 'production line', 'capacity',
    'moq', 'minimum order', 'lead time', 'delivery time',
    'client', 'case study', 'testimonial'
  ];
  for (const keyword of highRiskKeywords) {
    if (lowerText.includes(keyword)) {
      warnings.push('检测到高风险内容关键词: "' + keyword + '"，需人工确认后才可使用');
    }
  }

  if (warnings.length === 0) {
    warnings.push('自动提取结果仅供参考，所有内容需人工核验');
  }

  return result;
}

/**
 * 提取文本内容（移除 script/style/标签）
 */
function extractTextContent(html) {
  let text = html;
  // 移除 script
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  // 移除 style
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  // 移除注释
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  // 移除标签
  text = stripHtmlTags(text);
  // 清理空白
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * 移除 HTML 标签
 */
function stripHtmlTags(str) {
  return str.replace(/<[^>]*>/g, ' ');
}

/**
 * 邮箱脱敏
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 2) return local[0] + '***@' + domain;
  return local[0] + '***' + local[local.length - 1] + '@' + domain;
}

/**
 * 电话脱敏
 */
function maskPhone(phone) {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return digits.substring(0, 2) + '***' + digits.substring(digits.length - 2);
}

/**
 * 计算内容 hash
 */
function computeContentHash(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex').substring(0, 16);
}

// ============== 证据管理 ==============

const EVIDENCE_REVIEW_STATUSES = ['pending', 'reviewed', 'rejected', 'conflict'];

/**
 * 创建网站证据记录
 * @param {Object} input - 输入参数
 * @returns {Object} 证据对象
 */
function createWebsiteEvidence(input) {
  const now = new Date().toISOString();
  // pageType：未提供视为 home；提供但非法归为 custom（旧证据缺该字段时由使用处兼容为 home）
  const pageType = input.pageType
    ? (PAGE_TYPES.includes(input.pageType) ? input.pageType : 'custom')
    : 'home';
  return {
    evidenceId: 'wev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8),
    customerId: input.customerId || '',
    sourceUrl: input.sourceUrl || '',
    finalUrl: input.finalUrl || input.sourceUrl || '',
    pageType: pageType,
    pageTitle: input.pageTitle || '',
    fetchedAt: input.fetchedAt || now,
    httpStatus: input.httpStatus || 0,
    contentHash: input.contentHash || '',
    excerpt: input.excerpt || '',
    detectedCompanyName: input.detectedCompanyName || '',
    detectedProducts: Array.isArray(input.detectedProducts) ? input.detectedProducts : [],
    detectedMarkets: Array.isArray(input.detectedMarkets) ? input.detectedMarkets : [],
    detectedBuyerTypes: Array.isArray(input.detectedBuyerTypes) ? input.detectedBuyerTypes : [],
    contactHints: Array.isArray(input.contactHints) ? input.contactHints : [],
    reviewStatus: 'pending',  // 默认 pending
    publicUseAllowed: false,   // 默认不允许公开使用
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: '',
    extractionWarnings: Array.isArray(input.extractionWarnings) ? input.extractionWarnings : [],
    error: input.error || null,
    errorType: input.errorType || null,
    createdAt: now,
    updatedAt: now,
    schemaVersion: EVIDENCE_SCHEMA_VERSION
  };
}

/**
 * 审核网站证据
 * @param {Object} evidence - 证据对象
 * @param {string} status - 审核状态
 * @param {string} reviewer - 审核人
 * @param {string} note - 审核备注
 * @returns {Object} 审核结果
 */
function reviewWebsiteEvidence(evidence, status, reviewer, note) {
  if (!EVIDENCE_REVIEW_STATUSES.includes(status)) {
    return { success: false, error: '无效的审核状态: ' + status };
  }
  if (!evidence) {
    return { success: false, error: '证据不存在' };
  }

  evidence.reviewStatus = status;
  evidence.reviewedBy = reviewer || 'user';
  evidence.reviewedAt = new Date().toISOString();
  evidence.reviewNote = note || '';
  evidence.updatedAt = new Date().toISOString();

  // 只有 reviewed 状态才允许公开使用
  evidence.publicUseAllowed = (status === 'reviewed');

  return { success: true, evidence };
}

/**
 * 检查证据是否可用于公开内容
 */
function isEvidenceUsableForPublic(evidence) {
  return evidence &&
    evidence.reviewStatus === 'reviewed' &&
    evidence.publicUseAllowed === true &&
    !evidence.error;
}

/**
 * 检查证据是否可用于内部 ICP 评估
 */
function isEvidenceUsableForInternal(evidence) {
  return evidence &&
    (evidence.reviewStatus === 'pending' || evidence.reviewStatus === 'reviewed') &&
    !evidence.error;
}

// ============== 完整采集流程 ==============

/**
 * 采集客户网站证据（完整流程）
 * @param {string} customerId - 客户 ID
 * @param {string} url - 网站 URL
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 采集结果
 */
async function collectWebsiteEvidence(customerId, url, options = {}) {
  // 1. URL 校验
  const validation = validateUrl(url);
  if (!validation.valid) {
    return {
      success: false,
      evidence: createWebsiteEvidence({
        customerId,
        sourceUrl: url,
        error: validation.error,
        errorType: 'ssrf_blocked'
      }),
      error: validation.error
    };
  }

  // 2. 抓取网页
  const fetchResult = await fetchWebsite(url, options);

  // 3. 如果抓取失败，返回失败证据
  if (!fetchResult.success) {
    return {
      success: false,
      evidence: createWebsiteEvidence({
        customerId,
        sourceUrl: fetchResult.sourceUrl,
        finalUrl: fetchResult.finalUrl,
        httpStatus: fetchResult.httpStatus || 0,
        error: fetchResult.error,
        errorType: fetchResult.errorType
      }),
      error: fetchResult.error
    };
  }

  // 4. 提取内容
  const extracted = extractEvidence(fetchResult.body, fetchResult.finalUrl);

  // 5. 计算 hash
  const contentHash = computeContentHash(fetchResult.body);

  // 6. 创建证据记录
  const evidence = createWebsiteEvidence({
    customerId,
    sourceUrl: fetchResult.sourceUrl,
    finalUrl: fetchResult.finalUrl,
    pageTitle: extracted.pageTitle,
    fetchedAt: fetchResult.fetchedAt,
    httpStatus: fetchResult.httpStatus,
    contentHash,
    excerpt: extracted.excerpt,
    detectedCompanyName: extracted.detectedCompanyName,
    detectedProducts: extracted.detectedProducts,
    detectedMarkets: extracted.detectedMarkets,
    detectedBuyerTypes: extracted.detectedBuyerTypes,
    contactHints: extracted.contactHints,
    extractionWarnings: extracted.extractionWarnings
  });

  return { success: true, evidence };
}

/**
 * P2.5B: 多页采集客户网站证据
 *
 * - pages 为数组，每项 {url, pageType}，pageType 默认 'home'。
 * - 校验：pages 必须是非空数组且长度 <= MAX_PAGES_PER_COLLECT。
 * - 去重：若 options.existingEvidences 为数组，对每个待采集页面，若同 customerId 下
 *   已存在 sourceUrl 或 finalUrl 完全匹配（忽略末尾斜杠、大小写）且无 error 的证据，则跳过。
 * - 对每个未跳过页面调用现有 collectWebsiteEvidence，把 evidence.pageType 设为该页 pageType。
 * - 每页独立 evidenceId，页面级来源可追溯，绝不混合多页内容。
 *
 * @param {string} customerId - 客户 ID
 * @param {Array<{url:string, pageType?:string}>} pages - 待采集页面
 * @param {Object} options - { existingEvidences: Array }
 * @returns {Promise<Object>} { success, evidences, results, skipped, error? }
 */
async function collectWebsiteEvidenceMulti(customerId, pages, options = {}) {
  const bad = { success: false, evidences: [], results: [], skipped: [] };

  if (!Array.isArray(pages) || pages.length === 0) {
    return Object.assign(bad, { error: 'pages 必须是非空数组' });
  }
  if (pages.length > MAX_PAGES_PER_COLLECT) {
    return Object.assign(bad, {
      error: '单次采集页数超过上限 (' + MAX_PAGES_PER_COLLECT + ')'
    });
  }

  const existing = Array.isArray(options.existingEvidences) ? options.existingEvidences : [];
  const evidences = [];
  const results = [];
  const skipped = [];
  let allSuccess = true;

  for (const page of pages) {
    const url = (page && page.url) || '';
    const pageType = normalizePageType(page && page.pageType ? page.pageType : 'home');

    // 去重：同 customerId 下已有 sourceUrl/finalUrl 匹配且无 error 的证据则跳过
    const normUrl = normalizeUrlForCompare(url);
    const dup = existing.find(e =>
      e &&
      e.customerId === customerId &&
      !e.error &&
      (normalizeUrlForCompare(e.sourceUrl) === normUrl ||
       normalizeUrlForCompare(e.finalUrl) === normUrl)
    );
    if (dup) {
      skipped.push({
        url: url,
        pageType: pageType,
        reason: 'duplicate_existing_evidence',
        existingEvidenceId: dup.evidenceId
      });
      continue;
    }

    // 单页独立采集（保持 collectWebsiteEvidence 原有签名与返回格式）
    let result;
    try {
      result = await collectWebsiteEvidence(customerId, url, options);
    } catch (e) {
      result = {
        success: false,
        evidence: createWebsiteEvidence({
          customerId,
          sourceUrl: url,
          error: e.message,
          errorType: 'collect_exception'
        }),
        error: e.message
      };
    }

    // 页面级来源标记：把该页 pageType 落到证据上（绝不混合多页内容）
    if (result && result.evidence) {
      result.evidence.pageType = pageType;
    }

    results.push(result);
    if (result && result.evidence) {
      evidences.push(result.evidence);
    }
    if (!result || !result.success) {
      allSuccess = false;
    }
  }

  return {
    success: allSuccess,
    evidences: evidences,
    results: results,
    skipped: skipped
  };
}

module.exports = {
  CONFIG,
  PAGE_TYPES,
  MAX_PAGES_PER_COLLECT,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_REVIEW_STATUSES,
  validateUrl,
  isIpAddress,
  isPrivateIp,
  fetchWebsite,
  extractEvidence,
  extractTextContent,
  stripHtmlTags,
  maskEmail,
  maskPhone,
  computeContentHash,
  createWebsiteEvidence,
  reviewWebsiteEvidence,
  isEvidenceUsableForPublic,
  isEvidenceUsableForInternal,
  collectWebsiteEvidence,
  collectWebsiteEvidenceMulti
};
