/**
 * P2.5A: 客户批量导入、数据清洗和安全导入确认
 *
 * 业务边界：
 * - 只做 CSV 本地导入、字段映射、数据清洗、重复检测、DNC 检查、导入预览
 * - Leo 确认后才写入客户库
 * - 绝对不自动发送邮件/消息、不调用外部 API、不访问真实网站
 *
 * 模块同时支持 Node（测试）和浏览器（<script> 加载）。
 */
(function (global) {
  'use strict';

  const CustomerImport = {};
  const SCHEMA_VERSION = 'P2.5A';

  // ============================================================
  // 一、标准字段与别名映射
  // ============================================================

  CustomerImport.STANDARD_FIELDS = [
    'companyName', 'website', 'country', 'region', 'buyerType',
    'productCategories', 'mainProducts', 'existingBrands',
    'procurementScenario', 'knownPainPoints',
    'contactName', 'contactTitle', 'email', 'linkedin', 'phone', 'whatsapp',
    'sourceDocument', 'sourceUrl', 'sourceCapturedAt', 'notes'
  ];

  CustomerImport.FIELD_ALIASES = {
    companyName: ['company', 'company_name', 'companyname', '公司名称', '公司', '客户名称', '客户公司', 'enterprise', 'business_name'],
    website: ['website', 'url', 'domain', 'site', 'web', '网站', '网址', '官网', '公司网站'],
    country: ['country', 'market', 'target_country', '国家', '目标市场', '国家/地区'],
    region: ['region', 'state', 'province', 'city', '地区', '省份', '城市', '区域'],
    buyerType: ['buyer_type', 'buyertype', 'customer_type', 'customertype', '客户类型', '买家类型', '采购类型'],
    productCategories: ['products', 'product_categories', 'category', 'categories', 'productcategory', '产品类别', '产品分类', '产品', '品类'],
    mainProducts: ['main_products', 'mainproducts', '主营产品', '主要产品', '核心产品'],
    existingBrands: ['existing_brands', 'brands', '现有品牌', '代理品牌', '品牌'],
    procurementScenario: ['procurement_scenario', 'scenario', '采购场景', '使用场景'],
    knownPainPoints: ['known_pain_points', 'pain_points', '痛点', '需求痛点'],
    contactName: ['contact', 'contact_name', 'person', 'contactname', '联系人', '联系人姓名', '姓名'],
    contactTitle: ['title', 'job_title', 'position', 'contacttitle', '职位', '职务', '头衔'],
    email: ['email', 'e-mail', 'contact_email', 'email_address', '邮箱', '电子邮件', '联系邮箱'],
    linkedin: ['linkedin', 'linkedin_url', '领英', 'linked_in'],
    phone: ['phone', 'telephone', 'mobile', 'tel', '电话', '手机', '联系电话'],
    whatsapp: ['whatsapp', 'wa', 'whats_app', 'whatsapp_number'],
    sourceDocument: ['source_document', 'sourcedocument', '来源文档', '资料来源'],
    sourceUrl: ['source_url', 'sourceurl', '来源链接', '来源网址'],
    sourceCapturedAt: ['source_captured_at', 'captured_at', 'capture_date', '采集时间', '获取时间'],
    notes: ['notes', 'remark', 'comments', 'comment', '备注', '说明', '注释']
  };

  // 四大核心品类
  CustomerImport.CORE_CATEGORIES = [
    'Kitchen Knives',
    'Professional Scissors',
    'Outdoor Knives',
    'Kitchen Accessories'
  ];

  // 品类关键词映射
  const CATEGORY_KEYWORDS = {
    'Kitchen Knives': ['kitchen knife', 'kitchen knives', 'chef knife', 'chef knives', 'cooking knife', 'cooking knives', '菜刀', '厨房刀', '厨师刀', '切肉刀', '水果刀', '面包刀', '刀组', '刀具套装', 'knife set', 'knife block', 'santoku', 'nakiri', 'gyuto', 'paring knife', 'utility knife', 'bread knife', 'cleaver', 'chopping knife'],
    'Professional Scissors': ['scissor', 'scissors', 'shear', 'shears', 'hair scissor', 'hair shear', 'barber', 'salon', '裁缝剪', '剪刀', '专业剪刀', '理发剪', '美发剪', '工业剪', '厨房剪', 'pinking shears', 'thread snips', 'pruning shears', 'garden shears'],
    'Outdoor Knives': ['outdoor knife', 'outdoor knives', 'hunting knife', 'hunting knives', 'fishing knife', 'fishing knives', 'camping knife', 'camping knives', 'survival knife', 'bushcraft', 'tactical knife', 'fixed blade', 'folding knife', 'pocket knife', '户外刀', '猎刀', '求生刀', '战术刀', '折叠刀', '口袋刀', '露营刀', '潜水刀', 'dive knife', 'machete', 'axe', 'hatchet'],
    'Kitchen Accessories': ['kitchen accessory', 'kitchen accessories', 'kitchen tool', 'kitchen tools', 'kitchen utensil', 'kitchen utensils', 'cutting board', 'chopping board', 'knife sharpener', 'whetstone', 'sharpening stone', 'peeler', 'grater', 'whisk', 'spatula', 'ladle', 'tongs', 'measuring cup', 'measuring spoon', '厨房配件', '厨房工具', '厨具', '砧板', '菜板', '磨刀器', '磨刀石', '削皮器', '擦丝器', '打蛋器', '锅铲', '汤勺', '夹子', '量杯', '量勺']
  };

  // ============================================================
  // 二、CSV 解析器（RFC 4180 兼容）
  // ============================================================

  /**
   * 解析 CSV 文本，返回 { headers, rows, warnings }
   * 支持：UTF-8 BOM、引号字段、字段内逗号/换行、双引号转义、空行
   */
  CustomerImport.parseCSV = function (text) {
    const warnings = [];
    if (typeof text !== 'string' || text.length === 0) {
      return { headers: [], rows: [], warnings: ['CSV 内容为空'] };
    }

    // 去除 UTF-8 BOM
    let content = text;
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.substring(1);
    }

    const records = [];
    let field = '';
    let record = [];
    let inQuotes = false;
    let i = 0;
    let lineCount = 1;

    while (i < content.length) {
      const ch = content[i];

      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < content.length && content[i + 1] === '"') {
            // 双引号转义
            field += '"';
            i += 2;
            continue;
          } else {
            inQuotes = false;
            i++;
            continue;
          }
        } else {
          field += ch;
          if (ch === '\n') lineCount++;
          i++;
          continue;
        }
      }

      if (ch === '"') {
        // 字段以引号开头（仅当字段为空时）
        if (field.length === 0) {
          inQuotes = true;
          i++;
          continue;
        } else {
          field += ch;
          i++;
          continue;
        }
      }

      if (ch === ',') {
        record.push(field);
        field = '';
        i++;
        continue;
      }

      if (ch === '\r') {
        i++;
        continue;
      }

      if (ch === '\n') {
        record.push(field);
        field = '';
        records.push({ fields: record, lineNumber: lineCount });
        record = [];
        lineCount++;
        i++;
        continue;
      }

      field += ch;
      i++;
    }

    // 处理最后一行（没有换行符结尾）
    if (field.length > 0 || record.length > 0) {
      record.push(field);
      records.push({ fields: record, lineNumber: lineCount });
    }

    if (inQuotes) {
      warnings.push('CSV 中存在未闭合的引号字段，可能导致解析异常');
    }

    if (records.length === 0) {
      return { headers: [], rows: [], warnings: ['CSV 没有数据行'] };
    }

    // 第一行为表头
    const headerRecord = records[0];
    let headers = headerRecord.fields.map(h => (h || '').trim());

    // 检测空表头列
    headers.forEach((h, idx) => {
      if (!h) {
        warnings.push('第 ' + (idx + 1) + ' 列列名为空，已自动命名为 column_' + (idx + 1));
        headers[idx] = 'column_' + (idx + 1);
      }
    });

    // 检测重复列名
    const seenHeaders = {};
    headers.forEach((h, idx) => {
      const lower = h.toLowerCase();
      if (seenHeaders[lower] !== undefined) {
        warnings.push('列名重复: "' + h + '" 出现在第 ' + (seenHeaders[lower] + 1) + ' 和第 ' + (idx + 1) + ' 列，后者将重命名为 ' + h + '_' + (idx + 1));
        headers[idx] = h + '_' + (idx + 1);
      } else {
        seenHeaders[lower] = idx;
      }
    });

    // 数据行（跳过空行）
    const rows = [];
    for (let r = 1; r < records.length; r++) {
      const rec = records[r];
      // 空行检测：所有字段都为空
      const isEmpty = rec.fields.every(f => !f || f.trim() === '');
      if (isEmpty) {
        warnings.push('第 ' + rec.lineNumber + ' 行为空行，已跳过');
        continue;
      }
      // 列数不匹配
      if (rec.fields.length !== headers.length) {
        if (rec.fields.length < headers.length) {
          // 补空
          while (rec.fields.length < headers.length) rec.fields.push('');
          warnings.push('第 ' + rec.lineNumber + ' 行列数不足，已补空值');
        } else {
          warnings.push('第 ' + rec.lineNumber + ' 行列数超出表头，多余列已忽略');
          rec.fields = rec.fields.slice(0, headers.length);
        }
      }
      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = rec.fields[idx] != null ? rec.fields[idx] : '';
      });
      rowObj._rowNumber = rec.lineNumber;
      rows.push(rowObj);
    }

    return { headers: headers, rows: rows, warnings: warnings };
  };

  // ============================================================
  // 三、字段映射
  // ============================================================

  /**
   * 自动映射列名到标准字段
   * 返回 { mapping: {columnName: standardField}, unmapped: [columnNames] }
   */
  CustomerImport.autoMapColumns = function (headers) {
    const mapping = {};
    const unmapped = [];
    const usedFields = {};

    headers.forEach(header => {
      if (!header) return;
      const normalized = header.toLowerCase().trim().replace(/[\s_-]/g, '');
      let matched = null;

      // 精确匹配标准字段
      if (CustomerImport.STANDARD_FIELDS.some(f => f.toLowerCase() === normalized)) {
        matched = CustomerImport.STANDARD_FIELDS.find(f => f.toLowerCase() === normalized);
      } else {
        // 别名匹配
        for (const field of CustomerImport.STANDARD_FIELDS) {
          const aliases = CustomerImport.FIELD_ALIASES[field] || [];
          if (aliases.some(a => a.toLowerCase().replace(/[\s_-]/g, '') === normalized)) {
            matched = field;
            break;
          }
        }
      }

      if (matched && !usedFields[matched]) {
        mapping[header] = matched;
        usedFields[matched] = true;
      } else if (matched && usedFields[matched]) {
        // 同名字段已映射，此列放入未映射
        unmapped.push(header);
      } else {
        unmapped.push(header);
      }
    });

    return { mapping: mapping, unmapped: unmapped };
  };

  /**
   * 应用映射，将原始行转换为标准字段对象
   * 未映射字段放入 extraFields
   */
  CustomerImport.applyMapping = function (row, mapping) {
    const result = {};
    const extraFields = {};

    Object.keys(row).forEach(col => {
      if (col === '_rowNumber') return;
      const value = row[col];
      const standardField = mapping[col];
      if (standardField) {
        result[standardField] = value;
      } else {
        extraFields[col] = value;
      }
    });

    if (Object.keys(extraFields).length > 0) {
      result.extraFields = extraFields;
    }

    return result;
  };

  // ============================================================
  // 四、数据清洗
  // ============================================================

  /**
   * 清洗公司名：trim、合并连续空格、保留原始值、生成 normalizedCompanyName
   */
  CustomerImport.cleanCompanyName = function (value) {
    const original = value != null ? String(value) : '';
    const trimmed = original.trim();
    const collapsed = trimmed.replace(/\s+/g, ' ');
    return {
      original: original,
      cleaned: collapsed,
      normalized: CustomerImport._normalizeCompanyName(collapsed)
    };
  };

  // 内部公司名标准化（与 index.html 中 normalizeCompanyName 保持一致）
  CustomerImport._normalizeCompanyName = function (name) {
    if (!name || typeof name !== 'string') return '';
    return name.toLowerCase()
      .replace(/[.,'&()\-]/g, ' ')
      .replace(/\b(co|corp|corporation|inc|ltd|limited|llc|gmbh|sarl|bv|pte|pty|kg|ag|sa|sl|spol|sro|oo|tovar|che|joint|stock|company)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  };

  /**
   * 清洗网站：只允许 http/https、去追踪参数、规范化、SSRF 阻断
   * 返回 { original, cleaned, normalizedDomain, valid, error }
   */
  CustomerImport.cleanWebsite = function (value) {
    const original = value != null ? String(value).trim() : '';
    if (!original) {
      return { original: '', cleaned: '', normalizedDomain: '', valid: true, error: null };
    }

    let url = original;

    // 如果没有协议，自动添加 https://
    if (!/^https?:\/\//i.test(url)) {
      if (/^\/\//.test(url)) {
        url = 'https:' + url;
      } else {
        url = 'https://' + url;
      }
    }

    // 协议检查
    if (!/^https?:\/\//i.test(url)) {
      return { original: original, cleaned: url, normalizedDomain: '', valid: false, error: '只允许 http/https 协议' };
    }

    // 危险协议检查（javascript:, file:, data:）
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('file:') || lowerUrl.startsWith('data:')) {
      return { original: original, cleaned: url, normalizedDomain: '', valid: false, error: '危险协议被阻断' };
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return { original: original, cleaned: url, normalizedDomain: '', valid: false, error: 'URL 格式无效: ' + e.message };
    }

    // SSRF 防护：localhost、私有 IP
    const hostname = parsed.hostname.toLowerCase();
    if (CustomerImport._isBlockedHost(hostname)) {
      return { original: original, cleaned: url, normalizedDomain: '', valid: false, error: '主机被阻断（localhost/私有IP/内网）' };
    }

    // 去除追踪参数
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'msclkid', 'ref', 'referrer', 'spm'];
    const paramsToDelete = [];
    parsed.searchParams.forEach((v, k) => {
      if (trackingParams.includes(k.toLowerCase())) paramsToDelete.push(k);
    });
    paramsToDelete.forEach(p => parsed.searchParams.delete(p));

    // 规范化：小写 hostname、去尾部斜杠、去 www
    let cleanPath = parsed.pathname.replace(/\/+$/, '');
    if (cleanPath === '/') cleanPath = '';

    const cleaned = parsed.protocol + '//' + parsed.hostname.toLowerCase() + cleanPath +
      (parsed.search && parsed.search !== '?' ? parsed.search : '') +
      (parsed.hash ? parsed.hash : '');

    const normalizedDomain = CustomerImport._normalizeDomain(cleaned);

    return { original: original, cleaned: cleaned, normalizedDomain: normalizedDomain, valid: true, error: null };
  };

  CustomerImport._normalizeDomain = function (url) {
    if (!url || typeof url !== 'string') return '';
    let d = url.trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^\/\//, '');
    d = d.split('/')[0].split('?')[0].split('#')[0];
    d = d.replace(/^www\./, '');
    return d.replace(/\/+$/, '');
  };

  CustomerImport._isBlockedHost = function (host) {
    if (!host) return true;
    const h = host.toLowerCase().trim();
    // localhost
    if (h === 'localhost' || h.endsWith('.localhost')) return true;
    // 回环地址
    if (/^127\./.test(h)) return true;
    if (h === '::1' || h === '[::1]') return true;
    // 私有 IP 段
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
    if (/^169\.254\./.test(h)) return true;
    // 链接本地
    if (h.endsWith('.local')) return true;
    // 内网域名常见模式
    if (h.endsWith('.internal') || h.endsWith('.intranet') || h.endsWith('.corp')) return true;
    return false;
  };

  /**
   * 清洗邮箱：trim + lowercase + 格式校验 + 生成 hash
   * 返回 { original, cleaned, valid, error, hash, masked }
   */
  CustomerImport.cleanEmail = function (value) {
    const original = value != null ? String(value) : '';
    if (!original.trim()) {
      return { original: '', cleaned: '', valid: true, error: null, hash: '', masked: '' };
    }
    const cleaned = original.trim().toLowerCase();
    // 基本格式校验
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(cleaned)) {
      return { original: original, cleaned: cleaned, valid: false, error: '邮箱格式无效', hash: '', masked: CustomerImport._maskEmail(cleaned) };
    }
    const hash = CustomerImport.hashValue(cleaned);
    return { original: original, cleaned: cleaned, valid: true, error: null, hash: hash, masked: CustomerImport._maskEmail(cleaned) };
  };

  CustomerImport._maskEmail = function (email) {
    if (!email || !email.includes('@')) return '***';
    const parts = email.split('@');
    const local = parts[0];
    const domain = parts[1];
    if (local.length <= 2) return local[0] + '***@' + domain;
    return local[0] + '***' + local[local.length - 1] + '@' + domain;
  };

  /**
   * 清洗电话：保留原始值、去除明显无效字符、生成 hash、脱敏显示
   * 不推断国家区号
   */
  CustomerImport.cleanPhone = function (value) {
    const original = value != null ? String(value) : '';
    if (!original.trim()) {
      return { original: '', cleaned: '', valid: true, error: null, hash: '', masked: '' };
    }
    // 去除非电话字符（保留 +、数字、空格、-、()）
    let cleaned = original.trim();
    const digitCount = cleaned.replace(/[^0-9]/g, '').length;
    if (digitCount < 4) {
      return { original: original, cleaned: cleaned, valid: false, error: '电话号码数字不足', hash: '', masked: CustomerImport._maskPhone(cleaned) };
    }
    // 标准化：去除空格和短横线，保留 + 和数字
    const normalized = cleaned.replace(/[\s\-]/g, '');
    const hash = CustomerImport.hashValue(normalized.toLowerCase());
    return { original: original, cleaned: cleaned, valid: true, error: null, hash: hash, masked: CustomerImport._maskPhone(cleaned) };
  };

  CustomerImport._maskPhone = function (phone) {
    if (!phone) return '';
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length <= 4) return '****';
    return digits.substring(0, 2) + '****' + digits.substring(digits.length - 2);
  };

  /**
   * 清洗国家/地区：trim，不擅自修改用户原始文本
   */
  CustomerImport.cleanCountry = function (value) {
    const original = value != null ? String(value) : '';
    return { original: original, cleaned: original.trim() };
  };

  /**
   * 映射产品类别到四大核心品类
   * 返回 { categories: [matched], needsReview: bool, unmatched: [raw values] }
   */
  CustomerImport.mapProductCategory = function (value) {
    if (!value || !String(value).trim()) {
      return { categories: [], needsReview: false, unmatched: [] };
    }
    const raw = String(value).trim();
    // 支持逗号、分号、竖线分隔
    const items = raw.split(/[,;|]/).map(s => s.trim()).filter(s => s);
    const matched = [];
    const unmatched = [];

    items.forEach(item => {
      const lower = item.toLowerCase();
      let found = null;
      for (const cat of CustomerImport.CORE_CATEGORIES) {
        const keywords = CATEGORY_KEYWORDS[cat] || [];
        if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
          found = cat;
          break;
        }
      }
      if (found) {
        if (!matched.includes(found)) matched.push(found);
      } else {
        unmatched.push(item);
      }
    });

    return {
      categories: matched,
      needsReview: unmatched.length > 0,
      unmatched: unmatched
    };
  };

  // ============================================================
  // 五、哈希函数
  // ============================================================

  /**
   * 简单字符串哈希（FNV-1a 32位），与 index.html hashIdentityKey 保持一致
   */
  CustomerImport.hashValue = function (str) {
    if (!str) return '00000000';
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36).padStart(7, '0');
  };

  // ============================================================
  // 六、重复检测（导入上下文）
  // ============================================================

  /**
   * 检测导入行与现有客户及批次内其他行的重复
   * context: { customers: [], archives: [], batchSeen: {company, domain, email} }
   * 返回 { duplicateStatus, duplicateMatches, isArchivedMatch }
   */
  CustomerImport.detectDuplicates = function (cleaned, context) {
    const customers = context.customers || [];
    const archives = context.archives || [];
    const batchSeen = context.batchSeen || { company: {}, domain: {}, email: {} };
    const matches = [];
    let hasActiveDuplicate = false;
    let hasArchivedDuplicate = false;
    let hasBatchDuplicate = false;

    const normCompany = cleaned.normalizedCompanyName || '';
    const normDomain = cleaned.normalizedDomain || '';
    const emailHash = cleaned.emailHash || '';

    // 1. 批次内重复检测
    if (normCompany && normCompany.length >= 3) {
      if (batchSeen.company[normCompany]) {
        hasBatchDuplicate = true;
        matches.push({
          matchedField: 'company_in_batch',
          matchedValue: normCompany.substring(0, 30),
          confidence: 0.80,
          evidence: '批次内公司名重复',
          inBatch: true,
          batchRow: batchSeen.company[normCompany]
        });
      }
    }
    if (normDomain) {
      if (batchSeen.domain[normDomain]) {
        hasBatchDuplicate = true;
        matches.push({
          matchedField: 'domain_in_batch',
          matchedValue: normDomain,
          confidence: 0.90,
          evidence: '批次内域名重复',
          inBatch: true,
          batchRow: batchSeen.domain[normDomain]
        });
      }
    }
    if (emailHash) {
      if (batchSeen.email[emailHash]) {
        hasBatchDuplicate = true;
        matches.push({
          matchedField: 'email_in_batch',
          matchedValueHash: emailHash,
          confidence: 0.95,
          evidence: '批次内邮箱重复',
          inBatch: true,
          batchRow: batchSeen.email[emailHash]
        });
      }
    }

    // 2. 现有客户域名匹配
    if (normDomain) {
      for (const c of customers) {
        const cDomain = CustomerImport._normalizeDomain(c.website);
        if (cDomain && cDomain === normDomain) {
          hasActiveDuplicate = true;
          matches.push({
            matchedCustomerId: c.id || c.stableId,
            matchedField: 'domain',
            matchedValue: normDomain,
            confidence: 0.90,
            evidence: '现有客户域名匹配',
            isArchived: false
          });
          break;
        }
      }
      // 归档客户域名匹配
      if (!hasActiveDuplicate) {
        for (const a of archives) {
          if (a.normalizedDomain && a.normalizedDomain === normDomain) {
            hasArchivedDuplicate = true;
            matches.push({
              matchedCustomerId: a.customerId || a.archiveId,
              matchedField: 'domain_archived',
              matchedValue: normDomain,
              confidence: 0.70,
              evidence: '归档客户域名匹配',
              isArchived: true
            });
            break;
          }
        }
      }
    }

    // 3. 现有客户公司名匹配
    if (!hasActiveDuplicate && normCompany && normCompany.length >= 3) {
      for (const c of customers) {
        const cCompany = CustomerImport._normalizeCompanyName(c.company || c.customerName || c.name);
        if (cCompany && cCompany === normCompany) {
          hasActiveDuplicate = true;
          matches.push({
            matchedCustomerId: c.id || c.stableId,
            matchedField: 'company',
            matchedValue: normCompany.substring(0, 30),
            confidence: 0.80,
            evidence: '现有客户公司名匹配',
            isArchived: false
          });
          break;
        }
      }
    }

    // 4. 现有客户邮箱匹配
    if (!hasActiveDuplicate && emailHash) {
      for (const c of customers) {
        const cEmail = c.contact && c.contact.email ? c.contact.email : (Array.isArray(c.emails) && c.emails.length ? c.emails[0] : '');
        if (cEmail) {
          const cHash = CustomerImport.hashValue(cEmail.trim().toLowerCase());
          if (cHash === emailHash) {
            hasActiveDuplicate = true;
            matches.push({
              matchedCustomerId: c.id || c.stableId,
              matchedField: 'email',
              matchedValueHash: emailHash,
              confidence: 0.95,
              evidence: '现有客户邮箱匹配',
              isArchived: false
            });
            break;
          }
        }
      }
    }

    // 确定 duplicateStatus
    let duplicateStatus = 'new';
    if (hasActiveDuplicate) {
      duplicateStatus = 'duplicate_active';
    } else if (hasBatchDuplicate) {
      duplicateStatus = 'duplicate_in_batch';
    } else if (hasArchivedDuplicate) {
      duplicateStatus = 'duplicate_archived';
    }

    return {
      duplicateStatus: duplicateStatus,
      duplicateMatches: matches,
      hasActiveDuplicate: hasActiveDuplicate,
      hasArchivedDuplicate: hasArchivedDuplicate,
      hasBatchDuplicate: hasBatchDuplicate
    };
  };

  // ============================================================
  // 七、DNC 检查
  // ============================================================

  /**
   * 检查导入行是否命中 DNC
   * context: { customers: [], dncList: [] }
   * 返回 { dncStatus, dncMatches }
   */
  CustomerImport.checkDNC = function (cleaned, context) {
    const customers = context.customers || [];
    const normDomain = cleaned.normalizedDomain || '';
    const emailHash = cleaned.emailHash || '';
    const normCompany = cleaned.normalizedCompanyName || '';
    const matches = [];

    // 检查现有客户中的 DNC 标记（通过域名/公司名/邮箱匹配）
    for (const c of customers) {
      const isDNC = c.dnc === true || c.doNotContact === true || c.customerStatus === 'dnc_blocked' || c.status === 'dnc_blocked';
      if (!isDNC) continue;

      let matched = false;
      let field = '';

      if (normDomain) {
        const cDomain = CustomerImport._normalizeDomain(c.website);
        if (cDomain && cDomain === normDomain) {
          matched = true;
          field = 'domain';
        }
      }
      if (!matched && emailHash && c.contact && c.contact.email) {
        const cHash = CustomerImport.hashValue(c.contact.email.trim().toLowerCase());
        if (cHash === emailHash) {
          matched = true;
          field = 'email';
        }
      }
      if (!matched && normCompany && normCompany.length >= 3) {
        const cCompany = CustomerImport._normalizeCompanyName(c.company || c.customerName || c.name);
        if (cCompany && cCompany === normCompany) {
          matched = true;
          field = 'company';
        }
      }

      if (matched) {
        matches.push({
          matchedCustomerId: c.id || c.stableId,
          matchedField: field,
          evidence: '命中现有 DNC 客户'
        });
      }
    }

    return {
      dncStatus: matches.length > 0 ? 'blocked' : 'clear',
      dncMatches: matches
    };
  };

  // ============================================================
  // 八、单行清洗与评估
  // ============================================================

  /**
   * 清洗单行数据并返回完整评估结果
   */
  CustomerImport.cleanAndEvaluateRow = function (mappedRow, rowNumber, context) {
    const validationErrors = [];
    const warnings = [];

    // 公司名
    const companyResult = CustomerImport.cleanCompanyName(mappedRow.companyName);
    if (!companyResult.cleaned) {
      validationErrors.push('公司名为空，无法导入');
    }

    // 网站
    const websiteResult = CustomerImport.cleanWebsite(mappedRow.website);
    if (!websiteResult.valid) {
      validationErrors.push('网站无效: ' + websiteResult.error);
    }

    // 邮箱
    const emailResult = CustomerImport.cleanEmail(mappedRow.email);
    if (!emailResult.valid) {
      validationErrors.push('邮箱无效: ' + emailResult.error);
    }

    // 电话
    const phoneResult = CustomerImport.cleanPhone(mappedRow.phone);
    if (!phoneResult.valid) {
      warnings.push('电话格式可能无效: ' + phoneResult.error);
    }

    // 国家
    const countryResult = CustomerImport.cleanCountry(mappedRow.country);

    // 产品类别映射
    const productResult = CustomerImport.mapProductCategory(mappedRow.productCategories || mappedRow.mainProducts);
    if (productResult.needsReview) {
      warnings.push('产品类别无法匹配核心品类: ' + productResult.unmatched.join(', ') + '，需人工审核');
    }

    // 构建清洗后对象
    const cleaned = {
      rowNumber: rowNumber,
      companyName: companyResult.cleaned,
      companyNameOriginal: companyResult.original,
      normalizedCompanyName: companyResult.normalized,
      website: websiteResult.valid ? websiteResult.cleaned : '',
      websiteOriginal: websiteResult.original,
      normalizedDomain: websiteResult.normalizedDomain,
      websiteValid: websiteResult.valid,
      country: countryResult.cleaned,
      region: mappedRow.region ? String(mappedRow.region).trim() : '',
      buyerType: mappedRow.buyerType ? String(mappedRow.buyerType).trim() : '',
      productCategories: productResult.categories,
      productCategoriesRaw: mappedRow.productCategories || '',
      mainProducts: mappedRow.mainProducts ? String(mappedRow.mainProducts).trim() : '',
      existingBrands: mappedRow.existingBrands ? String(mappedRow.existingBrands).trim() : '',
      procurementScenario: mappedRow.procurementScenario ? String(mappedRow.procurementScenario).trim() : '',
      knownPainPoints: mappedRow.knownPainPoints ? String(mappedRow.knownPainPoints).trim() : '',
      contactName: mappedRow.contactName ? String(mappedRow.contactName).trim() : '',
      contactTitle: mappedRow.contactTitle ? String(mappedRow.contactTitle).trim() : '',
      email: emailResult.cleaned,
      emailOriginal: emailResult.original,
      emailValid: emailResult.valid,
      emailHash: emailResult.hash,
      emailMasked: emailResult.masked,
      linkedin: mappedRow.linkedin ? String(mappedRow.linkedin).trim() : '',
      phone: phoneResult.cleaned,
      phoneOriginal: phoneResult.original,
      phoneHash: phoneResult.hash,
      phoneMasked: phoneResult.masked,
      whatsapp: mappedRow.whatsapp ? String(mappedRow.whatsapp).trim() : '',
      sourceDocument: mappedRow.sourceDocument ? String(mappedRow.sourceDocument).trim() : '',
      sourceUrl: mappedRow.sourceUrl ? String(mappedRow.sourceUrl).trim() : '',
      sourceCapturedAt: mappedRow.sourceCapturedAt ? String(mappedRow.sourceCapturedAt).trim() : '',
      notes: mappedRow.notes ? String(mappedRow.notes).trim() : '',
      extraFields: mappedRow.extraFields || {}
    };

    // 重复检测
    const dupResult = CustomerImport.detectDuplicates(cleaned, context);
    if (dupResult.hasActiveDuplicate) {
      warnings.push('与现有客户重复（active），不会自动覆盖');
    }
    if (dupResult.hasBatchDuplicate) {
      warnings.push('批次内存在重复，默认只保留第一条');
    }
    if (dupResult.hasArchivedDuplicate) {
      warnings.push('与归档客户匹配，请注意风险');
    }

    // DNC 检查
    const dncResult = CustomerImport.checkDNC(cleaned, context);
    if (dncResult.dncStatus === 'blocked') {
      validationErrors.push('命中 DNC 名单，禁止导入');
    }

    // 确定导入决策
    let importDecision = 'ready';
    if (validationErrors.length > 0) {
      if (dncResult.dncStatus === 'blocked') {
        importDecision = 'dnc_blocked';
      } else if (!companyResult.cleaned || !websiteResult.valid) {
        importDecision = 'invalid';
      } else {
        importDecision = 'invalid';
      }
    } else if (dupResult.hasActiveDuplicate) {
      importDecision = 'duplicate_blocked';
    } else if (warnings.length > 0 || productResult.needsReview) {
      importDecision = 'needs_review';
    }

    // 如果有无效但不是 DNC，标记为 invalid
    if (validationErrors.some(e => e.includes('公司名为空') || e.includes('网站无效'))) {
      importDecision = 'invalid';
    }

    return {
      rowNumber: rowNumber,
      normalizedCompanyName: cleaned.normalizedCompanyName,
      normalizedDomain: cleaned.normalizedDomain,
      emailHash: cleaned.emailHash,
      phoneHash: cleaned.phoneHash,
      duplicateStatus: dupResult.duplicateStatus,
      duplicateMatches: dupResult.duplicateMatches,
      dncStatus: dncResult.dncStatus,
      validationErrors: validationErrors,
      warnings: warnings,
      importDecision: importDecision,
      cleaned: cleaned
    };
  };

  // ============================================================
  // 九、导入预览（不写入正式数据）
  // ============================================================

  /**
   * 生成导入预览
   * @param {Array} rows - 原始行数组（来自 parseCSV）
   * @param {Object} mapping - 字段映射 {column: standardField}
   * @param {Object} context - { customers, archives }
   * @returns {Object} 预览结果
   */
  CustomerImport.generatePreview = function (rows, mapping, context) {
    context = context || {};
    const batchSeen = { company: {}, domain: {}, email: {} };
    const evaluatedRows = [];
    const stats = {
      totalRows: rows.length,
      ready: 0,
      needsReview: 0,
      duplicateBlocked: 0,
      dncBlocked: 0,
      invalid: 0,
      duplicates: 0,
      dnc: 0
    };

    rows.forEach(row => {
      const rowNumber = row._rowNumber;
      const mapped = CustomerImport.applyMapping(row, mapping);
      const rowContext = {
        customers: context.customers || [],
        archives: context.archives || [],
        batchSeen: batchSeen
      };
      const evaluated = CustomerImport.cleanAndEvaluateRow(mapped, rowNumber, rowContext);
      evaluatedRows.push(evaluated);

      // 更新批次内已见
      if (evaluated.normalizedCompanyName && evaluated.normalizedCompanyName.length >= 3) {
        if (!batchSeen.company[evaluated.normalizedCompanyName]) {
          batchSeen.company[evaluated.normalizedCompanyName] = rowNumber;
        }
      }
      if (evaluated.normalizedDomain) {
        if (!batchSeen.domain[evaluated.normalizedDomain]) {
          batchSeen.domain[evaluated.normalizedDomain] = rowNumber;
        }
      }
      if (evaluated.emailHash) {
        if (!batchSeen.email[evaluated.emailHash]) {
          batchSeen.email[evaluated.emailHash] = rowNumber;
        }
      }

      // 统计
      switch (evaluated.importDecision) {
        case 'ready': stats.ready++; break;
        case 'needs_review': stats.needsReview++; break;
        case 'duplicate_blocked': stats.duplicateBlocked++; stats.duplicates++; break;
        case 'dnc_blocked': stats.dncBlocked++; stats.dnc++; break;
        case 'invalid': stats.invalid++; break;
      }
      if (evaluated.duplicateStatus !== 'new' && evaluated.duplicateStatus !== 'invalid') {
        stats.duplicates++;
      }
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      stats: stats,
      rows: evaluatedRows,
      mapping: mapping
    };
  };

  // ============================================================
  // 十、执行导入（事务式，支持回滚）
  // ============================================================

  /**
   * 执行批量导入
   * @param {Object} previewResult - generatePreview 的结果
   * @param {Object} context - { S, persistFn, uidFn, options }
   * @returns {Object} { success, batchId, importedCount, skippedCount, blockedCount, errorCount, errors, snapshot }
   */
  CustomerImport.executeImport = function (previewResult, context) {
    const S = context.S;
    const persistFn = context.persistFn || function () {};
    const uidFn = context.uidFn || function () { return 'id_' + Math.random().toString(36).substr(2, 9); };
    const options = context.options || {};
    const fileName = options.fileName || 'unknown.csv';
    const fileHash = options.fileHash || '';
    const importedBy = options.importedBy || 'Leo';

    // 幂等检查：防止重复点击
    if (context._importInProgress) {
      return { success: false, error: '导入正在进行中，请勿重复点击', batchId: null };
    }
    context._importInProgress = true;

    // 1. 保存快照（用于回滚）
    const snapshot = {
      customers: JSON.parse(JSON.stringify(S.customers || [])),
      importBatches: JSON.parse(JSON.stringify(S.importBatches || []))
    };

    const result = {
      success: false,
      batchId: null,
      importedCount: 0,
      skippedCount: 0,
      blockedCount: 0,
      errorCount: 0,
      errors: [],
      snapshot: snapshot
    };

    try {
      // 确保 importBatches 集合存在
      if (!Array.isArray(S.importBatches)) S.importBatches = [];

      const importBatchId = 'batch_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
      result.batchId = importBatchId;

      const importedCustomers = [];
      const now = new Date().toISOString();

      // 2. 逐行处理
      for (const row of previewResult.rows) {
        try {
          // 只导入 ready 和 needs_review（needs_review 标记后导入）
          if (row.importDecision === 'duplicate_blocked') {
            result.skippedCount++;
            continue;
          }
          if (row.importDecision === 'dnc_blocked') {
            result.blockedCount++;
            continue;
          }
          if (row.importDecision === 'invalid') {
            result.errorCount++;
            result.errors.push({ row: row.rowNumber, errors: row.validationErrors });
            continue;
          }

          // ready 或 needs_review 都可以导入（needs_review 导入后标记）
          const cleaned = row.cleaned;
          const customerId = uidFn();

          const customer = {
            id: customerId,
            stableId: 'cust_' + CustomerImport.hashValue(
              (cleaned.normalizedDomain || cleaned.normalizedCompanyName || customerId)
            ),
            company: cleaned.companyName,
            companyNameOriginal: cleaned.companyNameOriginal,
            normalizedCompanyName: cleaned.normalizedCompanyName,
            website: cleaned.website,
            normalizedDomain: cleaned.normalizedDomain,
            country: cleaned.country,
            region: cleaned.region,
            buyerType: cleaned.buyerType,
            products: cleaned.productCategories,
            productCategoriesRaw: cleaned.productCategoriesRaw,
            mainProducts: cleaned.mainProducts,
            existingBrands: cleaned.existingBrands,
            procurementScenario: cleaned.procurementScenario,
            knownPainPoints: cleaned.knownPainPoints,
            contact: {
              name: cleaned.contactName,
              title: cleaned.contactTitle,
              email: cleaned.email,
              phone: cleaned.phone,
              linkedin: cleaned.linkedin,
              whatsapp: cleaned.whatsapp
            },
            emailHash: cleaned.emailHash,
            phoneHash: cleaned.phoneHash,
            source: cleaned.sourceDocument || 'bulk_import',
            sourceDocument: cleaned.sourceDocument,
            sourceUrl: cleaned.sourceUrl,
            sourceCapturedAt: cleaned.sourceCapturedAt,
            notes: cleaned.notes,
            extraFields: cleaned.extraFields,
            customerStatus: row.importDecision === 'needs_review' ? 'identity_pending' : 'new',
            identityResolutionStatus: 'pending',
            importBatchId: importBatchId,
            importWarnings: row.warnings,
            importDecision: row.importDecision,
            duplicateStatus: row.duplicateStatus,
            dncStatus: row.dncStatus,
            createdAt: now,
            updatedAt: now,
            isDemo: false
          };

          // 确保 scores 字段
          customer.scores = { grade: 'C', total: 0 };

          S.customers.push(customer);
          importedCustomers.push(customer);
          result.importedCount++;
        } catch (rowErr) {
          result.errorCount++;
          result.errors.push({ row: row.rowNumber, error: rowErr.message });
        }
      }

      // 3. 创建导入批次记录
      const batchRecord = {
        importBatchId: importBatchId,
        fileName: fileName,
        fileHash: fileHash,
        schemaVersion: SCHEMA_VERSION,
        importedAt: now,
        importedBy: importedBy,
        rowCount: previewResult.stats.totalRows,
        importedCount: result.importedCount,
        skippedCount: result.skippedCount,
        blockedCount: result.blockedCount,
        errorCount: result.errorCount,
        mapping: previewResult.mapping,
        summary: {
          stats: previewResult.stats,
          importedCustomerIds: importedCustomers.map(c => c.id),
          errors: result.errors
        },
        status: 'completed'
      };
      S.importBatches.push(batchRecord);

      // 4. 持久化
      persistFn();

      result.success = true;
      result.batchRecord = batchRecord;
    } catch (e) {
      // 5. 回滚
      result.errors.push({ fatal: true, error: e.message });
      CustomerImport.rollbackImport(snapshot, S);
      try { persistFn(); } catch (pe) {
        // S4: Persist after rollback failed. Memory state is rolled back, but disk may still
        // contain partial import data. On next restart the disk version will be loaded and
        // the rollback will be lost. This is a data-inconsistency event that must not be silent.
        console.error('[IMPORT ROLLBACK] FATAL: persist after rollback failed:', pe.message);
        console.error('[IMPORT ROLLBACK] Data inconsistency detected - memory rolled back but disk may have partial import. Manual intervention required.');
        result.rollbackPersistError = pe.message;
      }
    } finally {
      context._importInProgress = false;
    }

    return result;
  };

  /**
   * 回滚导入：恢复快照
   */
  CustomerImport.rollbackImport = function (snapshot, S) {
    if (snapshot.customers) {
      S.customers = JSON.parse(JSON.stringify(snapshot.customers));
    }
    if (snapshot.importBatches) {
      S.importBatches = JSON.parse(JSON.stringify(snapshot.importBatches));
    }
  };

  // ============================================================
  // 十一、错误行 CSV 导出
  // ============================================================

  /**
   * 导出错误/警告行为 CSV
   */
  CustomerImport.exportErrorRowsCSV = function (previewResult) {
    const errorRows = previewResult.rows.filter(r =>
      r.importDecision !== 'ready' || r.warnings.length > 0
    );

    if (errorRows.length === 0) return '';

    const headers = ['行号', '公司名', '网站', '邮箱(脱敏)', '导入决策', '错误', '警告'];
    const lines = [headers.join(',')];

    errorRows.forEach(row => {
      const fields = [
        row.rowNumber,
        CustomerImport._csvEscape(row.cleaned.companyName || ''),
        CustomerImport._csvEscape(row.cleaned.website || ''),
        CustomerImport._csvEscape(row.cleaned.emailMasked || ''),
        row.importDecision,
        CustomerImport._csvEscape(row.validationErrors.join('; ')),
        CustomerImport._csvEscape(row.warnings.join('; '))
      ];
      lines.push(fields.join(','));
    });

    return lines.join('\n');
  };

  CustomerImport._csvEscape = function (value) {
    if (value == null) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  // ============================================================
  // 十二、文件哈希
  // ============================================================

  /**
   * 简单文件内容哈希（用于批次记录，不保存原始内容）
   */
  CustomerImport.computeFileHash = function (content) {
    return CustomerImport.hashValue(content.substring(0, 10000)) + '_' + content.length.toString(36);
  };

  // ============================================================
  // 导出（Node）或挂载全局（浏览器）
  // ============================================================
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CustomerImport;
  } else {
    global.CustomerImport = CustomerImport;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
