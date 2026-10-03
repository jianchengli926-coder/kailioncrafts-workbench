/**
 * DraftQualityChecker - 开发信质量检查器
 * 纯规则实现，不调用AI，不调用外部API
 * 规则版本: 1.0.0
 *
 * 输出字段: score(0-100), grade(A/B/C/D), blockingIssues, reviewWarnings,
 *           suggestions, checkedAt, ruleVersion, evidenceSummary
 *
 * 门控规则:
 * - blockingIssues非空: 不允许进入reviewed_ready/可发送状态
 * - reviewWarnings: 允许进入人工审核队列，显示醒目警告
 * - suggestions: 只显示建议，不阻塞
 */
(function(global){
  'use strict';

  const RULE_VERSION = '1.0.0';

  // ── 常量配置 ──────────────────────────────────────────────
  const FREE_EMAIL_DOMAINS = [
    'gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com',
    'protonmail.com','proton.me','mail.com','zoho.com','gmx.com',
    'aol.com','mail.ru','yandex.com','live.com','msn.com',
    'qq.com','163.com','126.com','sina.com','foxmail.com'
  ];

  const DISPOSABLE_DOMAINS = [
    'tempmail.com','guerrillamail.com','throwawaymail.com','temp-mail.org',
    '10minutemail.com','sharklasers.com','guerrillamail.net','mailinator.com',
    'trashmail.com','getnada.com','mohmal.com','tempmailo.com'
  ];

  const ROLE_EMAIL_PREFIXES = [
    'info','sales','contact','support','admin','hello','office',
    'enquiries','enquiry','inquiry','marketing','team','general',
    'management','ceo','owner','director','manager','hr','jobs',
    'careers','press','media','accounts','finance','billing','orders'
  ];

  const SPAM_TRIGGER_WORDS = [
    'free gift','100% guaranteed','limited time offer','act now',
    'urgent response','click here','buy now','order now',
    'don\'t miss out','once in a lifetime','risk free','no obligation',
    'exclusive deal','best price ever','unbeatable price','lowest price',
    'guaranteed results','make money','work from home','double your'
  ];

  const UNVERIFIED_CLAIM_PATTERNS = [
    { pattern: /\bMOQ\b|\bminimum order(?: quantity)?\b/i, label: 'MOQ/起订量', type: 'moq' },
    { pattern: /\b(?:unit )?price\b|\bcost\b|\bquotation\b|\bquote\b/i, label: '价格/报价', type: 'price' },
    { pattern: /\blead time\b|\bdelivery time\b|\bturnaround\b|\bshipping time\b/i, label: '交期/发货时间', type: 'delivery' },
    { pattern: /\bproduction capacity\b|\bmonthly capacity\b|\bannual output\b|\bcapacity of\b/i, label: '产能', type: 'capacity' },
    { pattern: /\b(?:ISO|CE|FDA|BSCI|SEDex|SA8000)\s?\d{0,4}\b|\bcertified?\b|\bcertification\b/i, label: '认证', type: 'certification' },
    { pattern: /\bclient(?:s)?\b|\bcustomer case\b|\btestimonial\b|\bwe supply\b|\bwe export to\b|\byears of experience\b/i, label: '客户案例/经验', type: 'case' },
    { pattern: /\bfactory\b|\bmanufacturer\b|\bown production\b|\bin-house\b/i, label: '工厂/生产', type: 'factory' }
  ];

  const SENSITIVE_INFO_PATTERNS = [
    { pattern: /api[_-]?key\s*[:=]\s*[\w-]{10,}/i, label: 'API Key' },
    { pattern: /password\s*[:=]\s*\S+/i, label: '密码' },
    { pattern: /secret\s*[:=]\s*\S+/i, label: '密钥' },
    { pattern: /token\s*[:=]\s*[\w-]{20,}/i, label: 'Token' },
    { pattern: /\bcost price\b|\bbottom price\b|\bprofit margin\b|\binternal cost\b|\blanded cost\b/i, label: '内部价格/成本' },
    { pattern: /\b(?:skype|wechat|whatsapp)\s*[:=]?\s*[\w-]{5,}/i, label: '私人联系方式' }
  ];

  const DANGEROUS_HTML_PATTERNS = [
    { pattern: /<script\b/i, label: '<script>标签' },
    { pattern: /<iframe\b/i, label: '<iframe>标签' },
    { pattern: /javascript:/i, label: 'javascript: URI' },
    { pattern: /on(?:click|load|error|mouseover|focus|blur|submit|change)\s*=/i, label: '事件属性' },
    { pattern: /<object\b|<embed\b|<applet\b/i, label: '危险插件标签' },
    { pattern: /eval\s*\(/i, label: 'eval()调用' },
    { pattern: /document\.cookie/i, label: 'cookie访问' }
  ];

  const CTA_PATTERNS = [
    /\bwould you be available\b/i, /\bworth a\s+(?:15|20|30)?\s*-?\s*min(?:ute)?\s*call\b/i,
    /\bcan we schedule\b/i, /\blet me know if\b/i, /\bare you open to\b/i,
    /\bcould we connect\b/i, /\bhappy to send\b/i, /\bwould it help\b/i,
    /\bshall i send\b/i, /\bopen to a quick\b/i, /\binterested in\b/i,
    /\bplease let me know\b/i, /\blooking forward to\b/i
  ];

  const PERSONALIZATION_PATTERNS = [
    /\b(?:your|you r|you're)\s+(?:company|team|business|product|brand|range|collection|catalog|catalogue|store|website)\b/i,
    /\b(?:based in|located in|headquartered in)\s+\w+/i,
    /\b(?:speciali[sz]ing in|focused on|known for)\b/i
  ];

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

  function countWords(text){
    if(!text) return 0;
    return String(text).trim().split(/\s+/).filter(Boolean).length;
  }

  function draftBodyText(draft){
    return String(draft.body || draft.content || draft.message || '');
  }

  function draftSubjectText(draft){
    return String(draft.subject || draft.title || '');
  }

  function draftFullText(draft){
    return draftSubjectText(draft) + '\n' + draftBodyText(draft);
  }

  // ── 12项检查 ─────────────────────────────────────────────

  /**
   * 检查1: DNC/suppressed/disqualified/closed等硬阻断状态
   */
  function checkHardBlockers(draft, context, issues){
    const customer = context.customer || {};
    const status = String(customer.status || '').toLowerCase();
    const dnc = customer.dnc === true || customer.doNotContact === true ||
                customer.rejectedOutreach === true || customer.optOut === true ||
                status === 'dnc' || status === 'dnc_blocked' || status === 'do_not_contact';

    if(dnc){
      issues.blocking.push({
        rule: 'hard_blocker_dnc',
        severity: 'critical',
        message: '客户已标记 DNC / 拒绝联系，禁止生成或发送开发信',
        suggestion: '将客户状态改为 DNC，从外联名单中移除'
      });
    }

    if(status === 'disqualified' || status === 'closed' || status === 'closed_lost' || status === 'suppressed'){
      issues.blocking.push({
        rule: 'hard_blocker_status',
        severity: 'critical',
        message: '客户状态为 ' + customer.status + '，不允许外联',
        suggestion: '确认客户状态是否正确，如为误标请更新状态'
      });
    }

    // 客户优先级 blocked
    if(customer.priorityTier === 'blocked' || (customer.hardBlockers && customer.hardBlockers.length > 0)){
      issues.blocking.push({
        rule: 'hard_blocker_priority',
        severity: 'critical',
        message: '客户优先级为 blocked，存在未解决的硬性阻断',
        suggestion: '解决硬性阻断（身份确认/重复处理/Pack绑定）后再生成开发信'
      });
    }
  }

  /**
   * 检查2: 缺少有效收件邮箱
   */
  function checkRecipientEmail(draft, context, issues){
    const customer = context.customer || {};
    const email = draft.recipientEmail || customer.contact?.email || customer.email || '';

    if(isEmpty(email)){
      issues.blocking.push({
        rule: 'no_recipient_email',
        severity: 'critical',
        message: '缺少收件人邮箱，无法发送',
        suggestion: '在客户台账中补充联系人邮箱'
      });
      return;
    }

    if(!isValidEmailFormat(email)){
      issues.blocking.push({
        rule: 'invalid_email_format',
        severity: 'critical',
        message: '邮箱格式无效: ' + email,
        suggestion: '检查并修正邮箱格式'
      });
    }

    const domain = getEmailDomain(email);
    const prefix = getEmailPrefix(email);

    if(FREE_EMAIL_DOMAINS.includes(domain)){
      issues.warnings.push({
        rule: 'free_email',
        severity: 'medium',
        message: '使用免费邮箱 (' + domain + ')，可能不是企业采购决策人',
        suggestion: '尝试通过 LinkedIn 或公司网站找到企业邮箱'
      });
    }

    if(DISPOSABLE_DOMAINS.includes(domain)){
      issues.blocking.push({
        rule: 'disposable_email',
        severity: 'critical',
        message: '使用一次性邮箱 (' + domain + ')，高风险',
        suggestion: '不建议向一次性邮箱发送开发信'
      });
    }

    if(ROLE_EMAIL_PREFIXES.includes(prefix)){
      issues.warnings.push({
        rule: 'role_email',
        severity: 'low',
        message: '使用角色邮箱 (' + prefix + '@)，可能无法直达决策人',
        suggestion: '尽量找到具体采购负责人的个人邮箱'
      });
    }
  }

  /**
   * 检查3: 使用未确认 Fact
   */
  function checkUnconfirmedFacts(draft, context, issues, evidenceSummary){
    const factIds = draft.factIds || [];
    const facts = context.facts || [];
    let unconfirmedCount = 0;
    let confirmedCount = 0;

    factIds.forEach(fid => {
      const fact = facts.find(f => f.factId === fid || f.id === fid);
      if(!fact) return;
      if(fact.reviewStatus === 'confirmed' && fact.publicUseAllowed === true){
        confirmedCount++;
      } else {
        unconfirmedCount++;
      }
    });

    evidenceSummary.factsUsed = confirmedCount;

    if(unconfirmedCount > 0){
      issues.warnings.push({
        rule: 'unconfirmed_facts',
        severity: 'medium',
        message: '引用了 ' + unconfirmedCount + ' 条未确认或不可公开使用的 Fact',
        suggestion: '在 Knowledge Facts 页面审核并确认这些 Fact'
      });
    }

    // inferredClaims 检查
    const inferred = draft.inferredClaims || [];
    if(inferred.length > 0){
      issues.warnings.push({
        rule: 'inferred_claims',
        severity: 'medium',
        message: '草稿包含 ' + inferred.length + ' 条 AI 推断声明，需人工核实',
        suggestion: '逐条核实推断声明，确认后标记为 confirmed'
      });
    }
  }

  /**
   * 检查4: 包含 confidential/internal 内容
   */
  function checkSensitiveContent(draft, context, issues){
    const kc = draft.knowledgeContext || {};
    const excluded = kc.excludedBySensitivity || kc.excludedByEligibility || 0;

    // 检查草稿文本中是否包含 internal/confidential 标记
    const text = draftFullText(draft);
    if(/\b(?:confidential|internal only|not for external|do not share|内部资料|机密)\b/i.test(text)){
      issues.blocking.push({
        rule: 'confidential_content',
        severity: 'critical',
        message: '草稿文本包含机密/内部标记内容',
        suggestion: '移除所有 confidential/internal 内容，仅使用 public 已确认事实'
      });
    }

    // draft.internalOnly 标记
    if(draft.internalOnly === true){
      issues.warnings.push({
        rule: 'internal_only_draft',
        severity: 'medium',
        message: '草稿标记为 internalOnly，仅供内部参考',
        suggestion: '如需对外发送，请移除 internalOnly 标记并审核内容'
      });
    }
  }

  /**
   * 检查5: 未经证实的 MOQ/价格/交期/产能/认证/客户案例
   */
  function checkUnverifiedClaims(draft, context, issues){
    const text = draftFullText(draft);
    const confirmedClaims = draft.confirmedClaims || [];
    const foundClaims = [];

    UNVERIFIED_CLAIM_PATTERNS.forEach(item => {
      if(item.pattern.test(text)){
        // 检查是否在 confirmedClaims 中
        const isConfirmed = confirmedClaims.some(c =>
          String(c).toLowerCase().includes(item.type) ||
          String(c).toLowerCase().includes(item.label.toLowerCase())
        );
        if(!isConfirmed){
          foundClaims.push(item.label);
        }
      }
    });

    if(foundClaims.length > 0){
      issues.warnings.push({
        rule: 'unverified_claims',
        severity: 'medium',
        message: '包含未经证实的事实声明: ' + foundClaims.join('、'),
        suggestion: '确认这些数据有知识库 Fact 支撑，或标记为"待确认"',
        details: foundClaims
      });
    }
  }

  /**
   * 检查6: 敏感信息（API Key/密码/内部价格）
   */
  function checkSensitiveInfo(draft, issues){
    const text = draftFullText(draft);
    const found = [];

    SENSITIVE_INFO_PATTERNS.forEach(item => {
      if(item.pattern.test(text)){
        found.push(item.label);
      }
    });

    if(found.length > 0){
      issues.blocking.push({
        rule: 'sensitive_info',
        severity: 'critical',
        message: '草稿包含敏感信息: ' + found.join('、'),
        suggestion: '立即移除所有 API Key/密码/内部价格/私人联系方式',
        details: found
      });
    }
  }

  /**
   * 检查7: 缺少明确 CTA
   */
  function checkCTA(draft, issues){
    const body = draftBodyText(draft);
    const hasCTA = CTA_PATTERNS.some(p => p.test(body));

    if(!hasCTA){
      issues.warnings.push({
        rule: 'missing_cta',
        severity: 'medium',
        message: '缺少明确的行动号召（CTA）',
        suggestion: '添加低摩擦 CTA，如 "Worth a 15-min call?" 或 "Can I send our catalog?"'
      });
    }

    // 检查是否有多个 CTA（分散注意力）
    const ctaCount = CTA_PATTERNS.filter(p => p.test(body)).length;
    if(ctaCount > 2){
      issues.suggestions.push({
        rule: 'too_many_ctas',
        severity: 'low',
        message: '包含 ' + ctaCount + ' 个 CTA，可能分散收件人注意力',
        suggestion: '保留一个主要 CTA，最多不超过两个'
      });
    }
  }

  /**
   * 检查8: 过短或过长
   */
  function checkLength(draft, issues){
    const body = draftBodyText(draft);
    const wordCount = countWords(body);
    const subject = draftSubjectText(draft);

    // 正文最佳范围: 60-150 词
    if(wordCount < 40){
      issues.warnings.push({
        rule: 'draft_too_short',
        severity: 'medium',
        message: '正文过短（' + wordCount + ' 词），可能缺少关键信息',
        suggestion: '最佳范围 60-150 词，补充个性化内容和价值主张'
      });
    } else if(wordCount > 200){
      issues.warnings.push({
        rule: 'draft_too_long',
        severity: 'medium',
        message: '正文过长（' + wordCount + ' 词），可能降低阅读率',
        suggestion: '精简到 150 词以内，突出核心价值和 CTA'
      });
    } else if(wordCount >= 60 && wordCount <= 150){
      // 最佳范围，不提示
    } else {
      issues.suggestions.push({
        rule: 'length_near_optimal',
        severity: 'low',
        message: '正文 ' + wordCount + ' 词，接近最佳范围（60-150）',
        suggestion: '可微调至最佳范围'
      });
    }

    // 主题行最佳: <60 字符
    if(subject.length > 70){
      issues.warnings.push({
        rule: 'subject_too_long',
        severity: 'low',
        message: '主题行过长（' + subject.length + ' 字符），移动端可能被截断',
        suggestion: '控制在 60 字符以内'
      });
    }

    if(subject.length < 15){
      issues.suggestions.push({
        rule: 'subject_too_short',
        severity: 'low',
        message: '主题行过短（' + subject.length + ' 字符）',
        suggestion: '添加具体个性化信息提高打开率'
      });
    }
  }

  /**
   * 检查9: 危险 HTML/script/事件属性/注入内容
   */
  function checkDangerousHTML(draft, issues){
    const text = draftFullText(draft);
    const found = [];

    DANGEROUS_HTML_PATTERNS.forEach(item => {
      if(item.pattern.test(text)){
        found.push(item.label);
      }
    });

    if(found.length > 0){
      issues.blocking.push({
        rule: 'dangerous_html',
        severity: 'critical',
        message: '草稿包含危险 HTML/脚本内容: ' + found.join('、'),
        suggestion: '移除所有 script/iframe/事件属性，开发信应使用纯文本或安全 HTML',
        details: found
      });
    }

    // 检查不平衡标签
    const openTags = (text.match(/<[a-z][^>]*>/gi) || []).length;
    const closeTags = (text.match(/<\/[a-z]+>/gi) || []).length;
    if(openTags !== closeTags && openTags > 0){
      issues.warnings.push({
        rule: 'unbalanced_html',
        severity: 'low',
        message: 'HTML 标签不平衡（开标签 ' + openTags + '，闭标签 ' + closeTags + '）',
        suggestion: '检查 HTML 标签是否正确闭合'
      });
    }
  }

  /**
   * 检查10: 缺少客户个性化证据
   */
  function checkPersonalization(draft, context, issues){
    const body = draftBodyText(draft);
    const customer = context.customer || {};
    const evidence = context.evidence || [];

    // 检查是否引用了客户公司名
    const companyName = customer.company || customer.customerName || '';
    const mentionsCompany = companyName && body.toLowerCase().includes(companyName.toLowerCase());

    // 检查是否有个性化表达
    const hasPersonalization = PERSONALIZATION_PATTERNS.some(p => p.test(body));

    // 检查是否引用了证据
    const reviewedEvidence = evidence.filter(e => e.reviewStatus === 'reviewed' && e.publicUseAllowed === true);
    evidenceSummary.evidenceUsed = reviewedEvidence.length;

    if(!mentionsCompany && !hasPersonalization){
      issues.warnings.push({
        rule: 'missing_personalization',
        severity: 'medium',
        message: '缺少客户个性化内容，可能被视为群发邮件',
        suggestion: '引用客户公司名、产品、市场或最近动态，至少一处个性化'
      });
    }

    if(reviewedEvidence.length === 0){
      issues.warnings.push({
        rule: 'no_reviewed_evidence',
        severity: 'medium',
        message: '客户没有已审核的网站证据，个性化缺乏事实支撑',
        suggestion: '先运行网站证据采集并人工审核，再生成开发信'
      });
    }
  }

  /**
   * 检查11: 引用了已归档 Knowledge Pack
   */
  function checkArchivedPack(draft, context, issues, evidenceSummary){
    const packId = draft.knowledgePackId;
    const packs = context.knowledgePacks || [];

    if(!packId){
      issues.suggestions.push({
        rule: 'no_knowledge_pack',
        severity: 'low',
        message: '草稿未绑定 Knowledge Pack',
        suggestion: '绑定 approved 状态的 Knowledge Pack 以确保事实一致性'
      });
      evidenceSummary.packStatus = 'not_bound';
      return;
    }

    const pack = packs.find(p => p.packId === packId);
    if(!pack){
      issues.warnings.push({
        rule: 'pack_not_found',
        severity: 'medium',
        message: '绑定的 Knowledge Pack 不存在: ' + packId,
        suggestion: '重新绑定有效的 Knowledge Pack'
      });
      evidenceSummary.packStatus = 'not_found';
      return;
    }

    evidenceSummary.packStatus = pack.status;

    if(pack.status === 'archived'){
      issues.blocking.push({
        rule: 'archived_pack',
        severity: 'critical',
        message: '引用了已归档的 Knowledge Pack (' + pack.name + ')',
        suggestion: '切换到当前 approved 的 Knowledge Pack 后重新生成'
      });
    } else if(pack.status !== 'approved'){
      issues.warnings.push({
        rule: 'pack_not_approved',
        severity: 'medium',
        message: 'Knowledge Pack 状态为 ' + pack.status + '（非 approved）',
        suggestion: '仅 approved 状态的 Pack 应用于对外开发信'
      });
    }

    // 版本检查
    if(draft.knowledgePackVersion && pack.version && draft.knowledgePackVersion !== pack.version){
      issues.warnings.push({
        rule: 'pack_version_mismatch',
        severity: 'low',
        message: 'Pack 版本不匹配（草稿: ' + draft.knowledgePackVersion + '，当前: ' + pack.version + '）',
        suggestion: '考虑使用最新版本的 Pack 重新生成'
      });
    }
  }

  /**
   * 检查12: 重复草稿或重复触达风险
   */
  function checkDuplicateRisk(draft, context, issues){
    const allDrafts = context.allDrafts || [];
    const customerId = draft.customerId;
    const customer = context.customer || {};

    // 同一客户的其他草稿
    const customerDrafts = allDrafts.filter(d =>
      d.customerId === customerId && d.id !== draft.id && d.id !== draft.draftId
    );

    // 最近30天内已发送的草稿
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentSent = customerDrafts.filter(d => {
      const sentAt = d.sentAt ? new Date(d.sentAt).getTime() : 0;
      return (d.status === '已发送' || d.reviewStatus === 'sent') && sentAt > thirtyDaysAgo;
    });

    if(recentSent.length > 0){
      issues.warnings.push({
        rule: 'recent_outreach',
        severity: 'medium',
        message: '该客户近30天内已有 ' + recentSent.length + ' 封开发信发送记录',
        suggestion: '避免频繁触达，建议间隔至少14天，或使用跟进序列而非新开发信'
      });
    }

    // 待审核的重复草稿
    const pendingDrafts = customerDrafts.filter(d =>
      d.reviewStatus === 'needs_review' || d.reviewStatus === 'unreviewed' ||
      d.status === '待审核' || d.status === '待检查'
    );

    if(pendingDrafts.length > 0){
      issues.warnings.push({
        rule: 'duplicate_pending_draft',
        severity: 'low',
        message: '该客户已有 ' + pendingDrafts.length + ' 封待审核草稿',
        suggestion: '先审核现有草稿，避免重复生成'
      });
    }

    // 沟通记录检查
    const communications = context.communications || [];
    const customerComms = communications.filter(c => c.customerId === customerId);
    const recentReply = customerComms.find(c =>
      (c.type === 'reply' || c.direction === 'inbound' || c.status === 'replied') &&
      c.createdAt && new Date(c.createdAt).getTime() > thirtyDaysAgo
    );

    if(recentReply){
      issues.suggestions.push({
        rule: 'recent_reply_exists',
        severity: 'low',
        message: '该客户近期有回复记录，建议优先跟进回复而非发送新开发信',
        suggestion: '查看收件箱中的客户回复，制定针对性跟进策略'
      });
    }
  }

  // ── 评分计算 ─────────────────────────────────────────────
  function calculateScore(issues){
    let score = 100;

    // blocking issues: 每个扣20分，至少扣到0
    issues.blocking.forEach(() => { score = Math.max(0, score - 20); });

    // warnings: 每个扣8分
    issues.warnings.forEach(() => { score = Math.max(0, score - 8); });

    // suggestions: 每个扣2分
    issues.suggestions.forEach(() => { score = Math.max(0, score - 2); });

    return score;
  }

  // ── 主入口 ───────────────────────────────────────────────
  /**
   * 检查开发信质量
   * @param {Object} draft - 草稿对象
   * @param {Object} context - 上下文 {customer, facts, evidence, knowledgePacks, allDrafts, communications}
   * @returns {Object} 质量报告
   */
  function checkDraft(draft, context){
    context = context || {};
    const issues = { blocking: [], warnings: [], suggestions: [] };
    const evidenceSummary = { factsUsed: 0, evidenceUsed: 0, packStatus: 'unknown' };

    try {
      checkHardBlockers(draft, context, issues);
      checkRecipientEmail(draft, context, issues);
      checkUnconfirmedFacts(draft, context, issues, evidenceSummary);
      checkSensitiveContent(draft, context, issues);
      checkUnverifiedClaims(draft, context, issues);
      checkSensitiveInfo(draft, issues);
      checkCTA(draft, issues);
      checkLength(draft, issues);
      checkDangerousHTML(draft, issues);
      checkPersonalization(draft, context, issues);
      checkArchivedPack(draft, context, issues, evidenceSummary);
      checkDuplicateRisk(draft, context, issues);
    } catch(e){
      // 检查器异常不应阻塞草稿流程
      issues.warnings.push({
        rule: 'checker_error',
        severity: 'low',
        message: '质量检查器运行异常: ' + e.message,
        suggestion: '请人工审核草稿内容'
      });
    }

    const score = calculateScore(issues);
    const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';

    return {
      score: score,
      grade: grade,
      blockingIssues: issues.blocking,
      reviewWarnings: issues.warnings,
      suggestions: issues.suggestions,
      checkedAt: new Date().toISOString(),
      ruleVersion: RULE_VERSION,
      evidenceSummary: evidenceSummary,
      canSend: issues.blocking.length === 0,
      needsReview: issues.warnings.length > 0
    };
  }

  /**
   * 渲染质量报告为 HTML（用于在草稿页面展示）
   * @param {Object} report - checkDraft 返回的报告
   * @returns {string} HTML 字符串
   */
  function renderQualityPanel(report){
    if(!report) return '<div class="card card-pad">质量检查未运行</div>';

    const gradeColors = { A: '#2f855a', B: '#2b6cb0', C: '#d69e2e', D: '#c53030' };
    const gradeColor = gradeColors[report.grade] || '#718096';

    let html = '<div class="card card-pad" style="border-left:4px solid ' + gradeColor + ';margin-bottom:12px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html += '<strong style="font-size:14px">📋 开发信质量检查</strong>';
    html += '<span style="font-size:20px;font-weight:800;color:' + gradeColor + '">' + report.score + '分 / ' + report.grade + '级</span>';
    html += '</div>';

    if(report.blockingIssues.length > 0){
      html += '<div style="background:#fff5f5;padding:8px 12px;border-radius:6px;margin-bottom:8px">';
      html += '<div style="color:#c53030;font-weight:700;margin-bottom:4px">🚫 阻断问题（' + report.blockingIssues.length + '）- 禁止发送</div>';
      report.blockingIssues.forEach(function(iss){
        html += '<div style="font-size:12px;color:#c53030;margin:2px 0">• ' + escHtml(iss.message) + '</div>';
        if(iss.suggestion){
          html += '<div style="font-size:11px;color:#718096;margin-left:12px">→ ' + escHtml(iss.suggestion) + '</div>';
        }
      });
      html += '</div>';
    }

    if(report.reviewWarnings.length > 0){
      html += '<div style="background:#fffff0;padding:8px 12px;border-radius:6px;margin-bottom:8px">';
      html += '<div style="color:#975a16;font-weight:700;margin-bottom:4px">⚠️ 警告（' + report.reviewWarnings.length + '）- 需人工审核</div>';
      report.reviewWarnings.forEach(function(iss){
        html += '<div style="font-size:12px;color:#975a16;margin:2px 0">• ' + escHtml(iss.message) + '</div>';
        if(iss.suggestion){
          html += '<div style="font-size:11px;color:#718096;margin-left:12px">→ ' + escHtml(iss.suggestion) + '</div>';
        }
      });
      html += '</div>';
    }

    if(report.suggestions.length > 0){
      html += '<div style="background:#f0fff4;padding:8px 12px;border-radius:6px;margin-bottom:8px">';
      html += '<div style="color:#2f855a;font-weight:700;margin-bottom:4px">💡 建议（' + report.suggestions.length + '）</div>';
      report.suggestions.forEach(function(iss){
        html += '<div style="font-size:12px;color:#2f855a;margin:2px 0">• ' + escHtml(iss.message) + '</div>';
      });
      html += '</div>';
    }

    // 证据摘要
    html += '<div style="font-size:11px;color:#718096;margin-top:8px;display:flex;gap:16px;flex-wrap:wrap">';
    html += '<span>已确认Fact: ' + report.evidenceSummary.factsUsed + '</span>';
    html += '<span>已审核证据: ' + report.evidenceSummary.evidenceUsed + '</span>';
    html += '<span>Pack状态: ' + report.evidenceSummary.packStatus + '</span>';
    html += '<span>规则版本: ' + report.ruleVersion + '</span>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function escHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 导出
  global.DraftQualityChecker = {
    checkDraft: checkDraft,
    renderQualityPanel: renderQualityPanel,
    RULE_VERSION: RULE_VERSION,
    isEmpty: isEmpty,
    isValidEmailFormat: isValidEmailFormat,
    getEmailDomain: getEmailDomain,
    FREE_EMAIL_DOMAINS: FREE_EMAIL_DOMAINS,
    DISPOSABLE_DOMAINS: DISPOSABLE_DOMAINS,
    ROLE_EMAIL_PREFIXES: ROLE_EMAIL_PREFIXES
  };

})(typeof window !== 'undefined' ? window : globalThis);
