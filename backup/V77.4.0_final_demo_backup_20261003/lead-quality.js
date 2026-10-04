/**
 * LeadQualityChecker - 线索/邮箱质量评分
 * 纯规则评分，不使用收费 API
 * MX 查询使用 Node.js 内置 dns 模块（通过 /api/lead-quality/mx-check 端点）
 * 规则版本: 1.0.0
 *
 * 输出字段: leadQualityScore(0-100), leadQualityGrade(A/B/C/D),
 *           emailValidationStatus(valid/invalid/risky/unknown/pending),
 *           mxStatus, emailType(corporate/free/role/disposable/unknown),
 *           qualityReasons, recommendedAction, checkedAt, nextRetryAt
 */
(function(global){
  'use strict';

  const RULE_VERSION = '1.0.0';

  // ── 常量配置 ──────────────────────────────────────────────
  const FREE_EMAIL_DOMAINS = [
    'gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com',
    'protonmail.com','proton.me','mail.com','zoho.com','gmx.com',
    'aol.com','mail.ru','yandex.com','live.com','msn.com',
    'qq.com','163.com','126.com','sina.com','foxmail.com',
    '139.com','aliyun.com','sina.cn','yeah.net','21cn.com'
  ];

  const DISPOSABLE_DOMAINS = [
    'tempmail.com','guerrillamail.com','throwawaymail.com','temp-mail.org',
    '10minutemail.com','sharklasers.com','guerrillamail.net','mailinator.com',
    'trashmail.com','getnada.com','mohmal.com','tempmailo.com',
    'fakeinbox.com','maildrop.cc','throwawaymail.com','yopmail.com'
  ];

  const ROLE_EMAIL_PREFIXES = [
    'info','sales','contact','support','admin','hello','office',
    'enquiries','enquiry','inquiry','marketing','team','general',
    'management','ceo','owner','director','manager','hr','jobs',
    'careers','press','media','accounts','finance','billing','orders',
    'purchase','procurement','buyer','imports','export','wholesale',
    'distribution','retail','service','help','noreply','no-reply',
    'donotreply','do-not-reply','mailer','notification','notifications'
  ];

  // MX 缓存（减少重复查询）
  const mxCache = {};
  const MX_CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时

  // 查询队列（避免并发过多）
  const mxQueue = [];
  let mxQueueRunning = false;
  const MX_CONCURRENCY = 3;
  let mxActiveCount = 0;

  // ── 工具函数 ──────────────────────────────────────────────
  function isEmpty(v){ return v === null || v === undefined || String(v).trim() === ''; }

  function isValidEmailFormat(email){
    if(!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  }

  function getEmailDomain(email){
    if(!email) return '';
    const parts = String(email).split('@');
    return parts.length === 2 ? parts[1].toLowerCase().trim() : '';
  }

  function getEmailPrefix(email){
    if(!email) return '';
    const parts = String(email).split('@');
    return parts.length === 2 ? parts[0].toLowerCase().trim() : '';
  }

  function classifyEmailType(email){
    if(!isValidEmailFormat(email)) return 'unknown';
    const domain = getEmailDomain(email);
    const prefix = getEmailPrefix(email);
    if(DISPOSABLE_DOMAINS.includes(domain)) return 'disposable';
    if(FREE_EMAIL_DOMAINS.includes(domain)) return 'free';
    if(ROLE_EMAIL_PREFIXES.includes(prefix)) return 'role';
    return 'corporate';
  }

  function isValidWebsiteUrl(url){
    if(!url) return false;
    return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url.trim());
  }

  function daysBetween(dateStr, now){
    if(!dateStr) return null;
    try {
      const d = new Date(dateStr).getTime();
      if(isNaN(d)) return null;
      return Math.floor((now - d) / (24*60*60*1000));
    } catch(e){ return null; }
  }

  // ── MX 查询 ───────────────────────────────────────────────
  async function queryMx(domain){
    if(!domain) return { mxStatus: 'unknown', records: [] };
    const cacheKey = domain.toLowerCase();
    const cached = mxCache[cacheKey];
    if(cached && (Date.now() - cached.checkedAt) < MX_CACHE_TTL){
      return cached;
    }
    try {
      const resp = await fetch('/api/lead-quality/mx-check', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({domain: cacheKey})
      });
      const data = await resp.json();
      const result = {
        mxStatus: data.mxStatus || 'unknown',
        records: data.records || [],
        error: data.error || null,
        checkedAt: data.checkedAt || new Date().toISOString()
      };
      mxCache[cacheKey] = result;
      return result;
    } catch(e){
      return { mxStatus: 'unknown', records: [], error: e.message, checkedAt: new Date().toISOString() };
    }
  }

  // MX 队列处理（按优先级，限制并发）
  function enqueueMxCheck(domain, priority, callback){
    mxQueue.push({domain, priority: priority||0, callback, addedAt: Date.now()});
    processMxQueue();
  }

  function processMxQueue(){
    if(mxQueueRunning) return;
    mxQueueRunning = true;
    function tick(){
      if(mxActiveCount >= MX_CONCURRENCY){ setTimeout(tick, 200); return; }
      // 按优先级排序
      mxQueue.sort((a,b) => b.priority - a.priority || a.addedAt - b.addedAt);
      const item = mxQueue.shift();
      if(!item){ mxQueueRunning = false; return; }
      mxActiveCount++;
      queryMx(item.domain).then(result => {
        mxActiveCount--;
        if(item.callback) item.callback(result);
        tick();
      }).catch(() => {
        mxActiveCount--;
        if(item.callback) item.callback({mxStatus:'unknown', records:[]});
        tick();
      });
    }
    tick();
  }

  // ── 11项检查 ─────────────────────────────────────────────

  /**
   * 检查1: 邮箱基础格式
   */
  function checkEmailFormat(customer, issues){
    const email = customer.contact?.email || customer.email || '';
    if(isEmpty(email)){
      issues.push({rule:'no_email', severity:'critical', message:'缺少邮箱地址', score:-15,
        suggestion:'在客户台账中补充联系人邮箱'});
      return { valid: false, email: '' };
    }
    if(!isValidEmailFormat(email)){
      issues.push({rule:'invalid_email_format', severity:'critical', message:'邮箱格式无效: '+email, score:-15,
        suggestion:'检查并修正邮箱格式'});
      return { valid: false, email: email };
    }
    issues.push({rule:'email_format_ok', severity:'ok', message:'邮箱格式有效', score:0});
    return { valid: true, email: email };
  }

  /**
   * 检查2: 域名是否存在（通过 MX 缓存或标记待查）
   */
  function checkDomainExists(emailInfo, customer, issues, mxResult){
    if(!emailInfo.valid) return;
    const domain = getEmailDomain(emailInfo.email);
    if(mxResult && mxResult.mxStatus === 'valid'){
      issues.push({rule:'domain_mx_valid', severity:'ok', message:'域名 '+domain+' 有有效MX记录', score:0});
    } else if(mxResult && mxResult.mxStatus === 'no_mx'){
      issues.push({rule:'domain_no_mx', severity:'critical', message:'域名 '+domain+' 无MX记录，邮箱可能无效', score:-20,
        suggestion:'该域名无法接收邮件，建议核实邮箱'});
    } else {
      issues.push({rule:'domain_pending', severity:'low', message:'域名MX记录待查询', score:-3,
        suggestion:'系统将在后台自动查询MX记录'});
    }
  }

  /**
   * 检查3: DNS/MX 查询结果
   */
  function checkMxResult(mxResult, issues){
    if(!mxResult) return;
    if(mxResult.mxStatus === 'valid' && mxResult.records && mxResult.records.length > 0){
      issues.push({rule:'mx_records', severity:'ok', message:'MX记录: '+mxResult.records.length+' 条', score:0});
    }
  }

  /**
   * 检查4: free mailbox / corporate mailbox 分类
   */
  function checkEmailType(emailInfo, issues){
    if(!emailInfo.valid) return;
    const type = classifyEmailType(emailInfo.email);
    if(type === 'free'){
      issues.push({rule:'free_email', severity:'medium', message:'使用免费邮箱 ('+getEmailDomain(emailInfo.email)+')', score:-8,
        suggestion:'尝试通过LinkedIn或公司网站找到企业邮箱'});
    } else if(type === 'corporate'){
      issues.push({rule:'corporate_email', severity:'ok', message:'企业邮箱', score:0});
    }
    return type;
  }

  /**
   * 检查5: disposable 邮箱特征
   */
  function checkDisposableEmail(emailInfo, issues){
    if(!emailInfo.valid) return;
    const type = classifyEmailType(emailInfo.email);
    if(type === 'disposable'){
      issues.push({rule:'disposable_email', severity:'critical', message:'一次性邮箱 ('+getEmailDomain(emailInfo.email)+')', score:-25,
        suggestion:'不建议向一次性邮箱发送开发信'});
    }
  }

  /**
   * 检查6: role 邮箱特征
   */
  function checkRoleEmail(emailInfo, issues){
    if(!emailInfo.valid) return;
    const type = classifyEmailType(emailInfo.email);
    if(type === 'role'){
      issues.push({rule:'role_email', severity:'low', message:'角色邮箱 ('+getEmailPrefix(emailInfo.email)+'@)', score:-3,
        suggestion:'尽量找到具体采购负责人的个人邮箱'});
    }
    return type;
  }

  /**
   * 检查7: 网站 URL 是否有效
   */
  function checkWebsite(customer, issues){
    const website = customer.website || '';
    if(isEmpty(website)){
      issues.push({rule:'no_website', severity:'medium', message:'缺少公司网站', score:-8,
        suggestion:'补充公司网站URL，可用于证据采集和背调'});
      return false;
    }
    if(!isValidWebsiteUrl(website)){
      issues.push({rule:'invalid_website', severity:'low', message:'网站URL格式可能无效: '+website, score:-3,
        suggestion:'检查网站URL格式（需包含http://或https://）'});
      return false;
    }
    issues.push({rule:'website_valid', severity:'ok', message:'有公司网站', score:0});
    return true;
  }

  /**
   * 检查8: 公司名、国家、买家类型和联系人职位完整度
   */
  function checkCompleteness(customer, issues){
    const missing = [];
    let score = 0;
    if(isEmpty(customer.company)){ missing.push('公司名'); score -= 5; }
    if(isEmpty(customer.country)){ missing.push('国家'); score -= 5; }
    if(isEmpty(customer.customerType) && isEmpty(customer.buyerType)){ missing.push('买家类型'); score -= 3; }
    if(isEmpty(customer.contact?.name) && isEmpty(customer.contactName)){ missing.push('联系人姓名'); score -= 3; }
    if(isEmpty(customer.contact?.title) && isEmpty(customer.contactTitle)){ missing.push('联系人职位'); score -= 2; }
    if(isEmpty(customer.products) && (!customer.productCategories || customer.productCategories.length===0)){ missing.push('产品信息'); score -= 2; }

    if(missing.length > 0){
      issues.push({rule:'incomplete_profile', severity:'medium', message:'资料不完整，缺少: '+missing.join('、'), score:score,
        suggestion:'补充客户资料以提高评分和开发信个性化程度'});
    } else {
      issues.push({rule:'profile_complete', severity:'ok', message:'客户资料完整', score:0});
    }
    return missing.length;
  }

  /**
   * 检查9: 证据新鲜度
   */
  function checkEvidenceFreshness(customer, evidence, issues){
    const reviewed = (evidence||[]).filter(e => e.reviewStatus === 'reviewed' && e.publicUseAllowed === true);
    if(reviewed.length === 0){
      issues.push({rule:'no_reviewed_evidence', severity:'medium', message:'无已审核的网站证据', score:-8,
        suggestion:'先运行网站证据采集并人工审核，再生成开发信'});
      return null;
    }
    const now = Date.now();
    const latest = reviewed.reduce((max, e) => {
      const t = e.fetchedAt ? new Date(e.fetchedAt).getTime() : 0;
      return t > max ? t : max;
    }, 0);
    const days = latest ? Math.floor((now - latest)/(24*60*60*1000)) : null;
    if(days === null){
      issues.push({rule:'evidence_no_date', severity:'low', message:'证据无采集时间', score:-2});
    } else if(days <= 30){
      issues.push({rule:'evidence_fresh', severity:'ok', message:'证据新鲜（'+days+'天前）', score:0});
    } else if(days <= 90){
      issues.push({rule:'evidence_aging', severity:'low', message:'证据 '+days+' 天前采集，建议更新', score:-3});
    } else {
      issues.push({rule:'evidence_stale', severity:'medium', message:'证据已超过 '+days+' 天，可能过时', score:-8,
        suggestion:'重新采集网站证据以确保信息准确'});
    }
    return days;
  }

  /**
   * 检查10: DNC、重复、黑名单、状态异常
   */
  function checkStatusFlags(customer, issues){
    const dnc = customer.dnc === true || customer.doNotContact === true ||
                customer.rejectedOutreach === true || customer.optOut === true;
    const status = String(customer.status || '').toLowerCase();

    if(dnc || status === 'dnc' || status === 'dnc_blocked' || status === 'do_not_contact'){
      issues.push({rule:'dnc', severity:'critical', message:'客户已标记DNC/拒绝联系', score:-50,
        suggestion:'该客户不应再发送开发信'});
    }
    if(customer.duplicateStatus === 'pending' || customer.duplicateStatus === 'confirmed'){
      issues.push({rule:'duplicate', severity:'medium', message:'客户存在重复记录待处理', score:-5,
        suggestion:'处理重复客户后再进行开发'});
    }
    if(status === 'disqualified' || status === 'closed' || status === 'closed_lost'){
      issues.push({rule:'disqualified', severity:'critical', message:'客户状态为 '+customer.status, score:-30,
        suggestion:'确认客户状态是否正确'});
    }
    if(customer.priorityTier === 'blocked'){
      issues.push({rule:'priority_blocked', severity:'critical', message:'客户优先级为blocked', score:-20,
        suggestion:'解决硬性阻断（身份确认/重复/Pack绑定）后再开发'});
    }
  }

  /**
   * 检查11: 是否存在可用 LinkedIn、电话或其他联系人渠道
   */
  function checkAlternativeChannels(customer, issues){
    const channels = [];
    if(!isEmpty(customer.linkedin)) channels.push('LinkedIn');
    if(!isEmpty(customer.contact?.phone) || !isEmpty(customer.phone)) channels.push('电话');
    if(!isEmpty(customer.whatsapp)) channels.push('WhatsApp');
    if(!isEmpty(customer.website)) channels.push('网站');

    if(channels.length <= 1){
      issues.push({rule:'few_channels', severity:'low', message:'联系渠道较少（仅邮箱）', score:-3,
        suggestion:'补充LinkedIn、电话等多渠道联系方式，提高触达成功率'});
    } else {
      issues.push({rule:'multi_channel', severity:'ok', message:'多渠道联系方式: '+channels.join('、'), score:0});
    }
    return channels;
  }

  // ── 主评分函数 ───────────────────────────────────────────
  /**
   * 评估线索质量（同步，不包含MX查询）
   * @param {Object} customer - 客户对象
   * @param {Object} context - {evidence, mxResult}
   * @returns {Object} 质量报告
   */
  function evaluateLead(customer, context){
    context = context || {};
    const evidence = context.evidence || [];
    const mxResult = context.mxResult || null;
    const issues = [];
    let score = 100;

    // 1. 邮箱格式
    const emailInfo = checkEmailFormat(customer, issues);
    // 2. 域名存在
    checkDomainExists(emailInfo, customer, issues, mxResult);
    // 3. MX结果
    checkMxResult(mxResult, issues);
    // 4. 邮箱类型
    const emailType = checkEmailType(emailInfo, issues) || 'unknown';
    // 5. disposable
    checkDisposableEmail(emailInfo, issues);
    // 6. role邮箱
    checkRoleEmail(emailInfo, issues);
    // 7. 网站
    checkWebsite(customer, issues);
    // 8. 资料完整度
    checkCompleteness(customer, issues);
    // 9. 证据新鲜度
    checkEvidenceFreshness(customer, evidence, issues);
    // 10. 状态标记
    checkStatusFlags(customer, issues);
    // 11. 多渠道
    checkAlternativeChannels(customer, issues);

    // 计算分数
    issues.forEach(i => { if(i.score && i.score < 0) score = Math.max(0, score + i.score); });

    const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';

    // 邮箱验证状态
    let emailValidationStatus = 'unknown';
    if(!emailInfo.valid){
      emailValidationStatus = 'invalid';
    } else if(classifyEmailType(emailInfo.email) === 'disposable'){
      emailValidationStatus = 'risky';
    } else if(mxResult && mxResult.mxStatus === 'valid'){
      emailValidationStatus = 'valid';
    } else if(mxResult && mxResult.mxStatus === 'no_mx'){
      emailValidationStatus = 'invalid';
    } else {
      emailValidationStatus = 'pending';
    }

    // 推荐操作
    let recommendedAction = '正常开发';
    if(score < 40) recommendedAction = '暂缓开发，先补充资料';
    else if(score < 60) recommendedAction = '补充资料后开发';
    else if(issues.some(i => i.severity === 'critical')) recommendedAction = '解决阻断问题后开发';

    const qualityReasons = issues.filter(i => i.severity !== 'ok').map(i => ({
      rule: i.rule, severity: i.severity, message: i.message, suggestion: i.suggestion
    }));

    return {
      leadQualityScore: score,
      leadQualityGrade: grade,
      emailValidationStatus: emailValidationStatus,
      mxStatus: mxResult ? mxResult.mxStatus : 'not_checked',
      emailType: emailType,
      qualityReasons: qualityReasons,
      recommendedAction: recommendedAction,
      checkedAt: new Date().toISOString(),
      nextRetryAt: emailValidationStatus === 'pending' ?
        new Date(Date.now() + 60*60*1000).toISOString() : null,
      ruleVersion: RULE_VERSION
    };
  }

  /**
   * 异步评估（包含MX查询）
   * @param {Object} customer
   * @param {Object} context
   * @param {Number} priority - 队列优先级
   * @returns {Promise<Object>}
   */
  async function evaluateLeadAsync(customer, context, priority){
    context = context || {};
    const email = customer.contact?.email || customer.email || '';
    const domain = getEmailDomain(email);

    let mxResult = context.mxResult || null;

    // 如果有域名且没有MX结果，入队查询
    if(domain && isValidEmailFormat(email) && (!mxResult || mxResult.mxStatus === 'not_checked')){
      mxResult = await new Promise(resolve => {
        enqueueMxCheck(domain, priority || 0, resolve);
      });
    }

    return evaluateLead(customer, { ...context, mxResult: mxResult });
  }

  /**
   * 批量评估（同步部分，MX异步入队）
   * @param {Array} customers
   * @param {Function} onProgress - 进度回调
   */
  function batchEvaluateLeads(customers, onProgress){
    const results = [];
    customers.forEach((c, idx) => {
      const evidence = (c.websiteEvidence || []).filter(e => e.customerId === c.id);
      const report = evaluateLead(c, { evidence: evidence });
      results.push({ customerId: c.id, report: report });

      // 如果邮箱待查MX，入队
      const email = c.contact?.email || c.email || '';
      const domain = getEmailDomain(email);
      if(domain && isValidEmailFormat(email) && report.mxStatus === 'not_checked'){
        const priority = c.priorityTier === 'A' ? 2 : c.priorityTier === 'B' ? 1 : 0;
        enqueueMxCheck(domain, priority, (mxResult) => {
          const updated = evaluateLead(c, { evidence: evidence, mxResult: mxResult });
          if(onProgress) onProgress(c.id, updated, true);
        });
      }

      if(onProgress) onProgress(c.id, report, false);
    });
    return results;
  }

  /**
   * 渲染质量徽章 HTML
   */
  function renderQualityBadge(report){
    if(!report) return '<span class="badge badge-gray">未评</span>';
    const colors = {
      A: {bg:'#dcfce7', color:'#166534'},
      B: {bg:'#dbeafe', color:'#1e40af'},
      C: {bg:'#fef9c3', color:'#854d0e'},
      D: {bg:'#fee2e2', color:'#991b1b'}
    };
    const c = colors[report.leadQualityGrade] || colors.D;
    const mxIcon = report.mxStatus === 'valid' ? '✓' : report.mxStatus === 'no_mx' ? '✗' : '⏳';
    return `<span class="badge" style="background:${c.bg};color:${c.color};font-weight:700">${report.leadQualityScore}分 ${report.leadQualityGrade} ${mxIcon}</span>`;
  }

  // 导出
  global.LeadQualityChecker = {
    evaluateLead: evaluateLead,
    evaluateLeadAsync: evaluateLeadAsync,
    batchEvaluateLeads: batchEvaluateLeads,
    renderQualityBadge: renderQualityBadge,
    queryMx: queryMx,
    enqueueMxCheck: enqueueMxCheck,
    classifyEmailType: classifyEmailType,
    isValidEmailFormat: isValidEmailFormat,
    getEmailDomain: getEmailDomain,
    RULE_VERSION: RULE_VERSION,
    FREE_EMAIL_DOMAINS: FREE_EMAIL_DOMAINS,
    DISPOSABLE_DOMAINS: DISPOSABLE_DOMAINS,
    ROLE_EMAIL_PREFIXES: ROLE_EMAIL_PREFIXES
  };

})(typeof window !== 'undefined' ? window : globalThis);
