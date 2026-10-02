/**
 * P2.3B: 客户优先级排序、人工开发名单和证据转 Fact 流程
 * 
 * 评分可解释，0-100分，A/B/C/blocked 分层。
 * 硬性阻断优先于分数：DNC、identity unresolved、duplicate、hard blocker、
 * 未绑定 approved Knowledge Pack 等。
 * 
 * 业务边界：
 * - 只整理客户资料和优先级，不自动发送消息
 * - reviewed 证据只能作为评估依据，不能自动变成 confirmed Fact
 * - 不调用云端 AI
 */

const PRIORITY_VERSION = 'P2.3C-v1';

/**
 * 计算客户优先级评分
 * @param {Object} customer - 客户对象
 * @param {Object} context - 上下文（pack, evidences, drafts, campaigns）
 * @returns {Object} 优先级评分结果
 */
function calculateProspectPriority(customer, context = {}) {
  if (!customer) {
    return { success: false, error: '客户不存在' };
  }

  const result = {
    customerId: customer.id || customer.customerId || '',
    priorityScore: 0,
    priorityTier: 'blocked',
    scoreBreakdown: {
      icpMatch: 0,
      identityAndEvidence: 0,
      productMarketFit: 0,
      contactCompleteness: 0,
      outreachReadiness: 0
    },
    positiveReasons: [],
    missingEvidence: [],
    riskFlags: [],
    hardBlockers: [],
    recommendedNextAction: '',
    calculatedAt: new Date().toISOString(),
    calculationVersion: PRIORITY_VERSION
  };

  // ========== 硬性阻断检查（优先于分数）==========
  const blockers = detectHardBlockers(customer, context);
  result.hardBlockers = blockers;

  if (blockers.length > 0) {
    result.priorityTier = 'blocked';
    result.priorityScore = 0;
    result.recommendedNextAction = blockers[0].action || '解决硬性阻断后再评估';
    result.riskFlags = blockers.map(b => ({ type: b.type, severity: 'high', reason: b.reason }));
    return result;
  }

  // ========== 1. ICP 匹配（0-30分）==========
  const icpScore = calculateIcpMatchScore(customer, context);
  result.scoreBreakdown.icpMatch = icpScore.score;
  result.positiveReasons.push(...icpScore.positiveReasons);
  result.missingEvidence.push(...icpScore.missingEvidence);

  // ========== 2. 身份和网站证据（0-20分）==========
  const evidenceScore = calculateIdentityAndEvidenceScore(customer, context);
  result.scoreBreakdown.identityAndEvidence = evidenceScore.score;
  result.positiveReasons.push(...evidenceScore.positiveReasons);
  result.missingEvidence.push(...evidenceScore.missingEvidence);

  // ========== 3. 产品和市场匹配（0-20分）==========
  const productScore = calculateProductMarketFitScore(customer, context);
  result.scoreBreakdown.productMarketFit = productScore.score;
  result.positiveReasons.push(...productScore.positiveReasons);
  result.missingEvidence.push(...productScore.missingEvidence);

  // ========== 4. 联系信息完整度（0-15分）==========
  const contactScore = calculateContactCompletenessScore(customer);
  result.scoreBreakdown.contactCompleteness = contactScore.score;
  result.positiveReasons.push(...contactScore.positiveReasons);
  result.missingEvidence.push(...contactScore.missingEvidence);

  // ========== 5. 开发准备度（0-15分）==========
  const readinessScore = calculateOutreachReadinessScore(customer, context);
  result.scoreBreakdown.outreachReadiness = readinessScore.score;
  result.positiveReasons.push(...readinessScore.positiveReasons);
  result.missingEvidence.push(...readinessScore.missingEvidence);

  // ========== 计算总分 ==========
  const totalScore =
    result.scoreBreakdown.icpMatch +
    result.scoreBreakdown.identityAndEvidence +
    result.scoreBreakdown.productMarketFit +
    result.scoreBreakdown.contactCompleteness +
    result.scoreBreakdown.outreachReadiness;

  result.priorityScore = Math.min(100, Math.max(0, totalScore));

  // ========== 分层 ==========
  if (result.priorityScore >= 80) {
    result.priorityTier = 'A';
    result.recommendedNextAction = '优先人工开发：生成个性化草稿并审核';
  } else if (result.priorityScore >= 60) {
    result.priorityTier = 'B';
    result.recommendedNextAction = '补充资料后开发：' + (result.missingEvidence[0]?.reason || '完善客户信息');
  } else {
    result.priorityTier = 'C';
    result.recommendedNextAction = '暂缓开发：优先处理高优先级客户';
  }

  // 风险标记
  if (customer.riskFlags && Array.isArray(customer.riskFlags)) {
    result.riskFlags.push(...customer.riskFlags);
  }

  return result;
}

/**
 * 检测硬性阻断
 */
function detectHardBlockers(customer, context) {
  const blockers = [];

  // DNC
  if (customer.dnc === true || customer.doNotContact === true || customer.status === 'dnc_blocked') {
    blockers.push({
      type: 'dnc',
      reason: '客户已标记 DNC（拒绝联系）',
      action: 'DNC 客户不得进入外联名单'
    });
  }

  // Identity unresolved
  if (customer.identityStatus === 'unverified' || customer.identityStatus === 'pending' ||
      customer.customerStatus === 'identity_pending' || customer.identityVerified === false) {
    blockers.push({
      type: 'identity_unresolved',
      reason: '客户身份未确认',
      action: '完成客户身份确认后再开发'
    });
  }

  // Duplicate 未处理
  if (customer.duplicateStatus === 'pending' || customer.duplicateStatus === 'confirmed' ||
      customer.customerStatus === 'duplicate_review') {
    blockers.push({
      type: 'duplicate_unresolved',
      reason: '存在未处理的重复客户',
      action: '处理重复客户后再开发'
    });
  }

  // Hard blockers
  if (customer.hardBlockers && Array.isArray(customer.hardBlockers) && customer.hardBlockers.length > 0) {
    const unresolved = customer.hardBlockers.filter(b => !b.resolved);
    if (unresolved.length > 0) {
      blockers.push({
        type: 'hard_blocker',
        reason: '存在 ' + unresolved.length + ' 个未解决的硬性阻断',
        action: '解决 hard blockers 后再开发'
      });
    }
  }

  // 未绑定 approved Knowledge Pack
  if (context.pack) {
    if (context.pack.status !== 'approved' && context.pack.reviewStatus !== 'approved') {
      blockers.push({
        type: 'pack_not_approved',
        reason: 'Knowledge Pack 未批准',
        action: '创建并批准 Knowledge Pack 后再开发'
      });
    }
    if (context.pack.archived === true) {
      blockers.push({
        type: 'pack_archived',
        reason: 'Knowledge Pack 已归档',
        action: '使用未归档的 approved Pack'
      });
    }
  } else if (!context.hasApprovedPack) {
    blockers.push({
      type: 'no_approved_pack',
      reason: '未绑定 approved Knowledge Pack',
      action: '绑定 approved Knowledge Pack 后再开发'
    });
  }

  // 明确拒绝联系
  if (customer.rejectedOutreach === true || customer.optOut === true) {
    blockers.push({
      type: 'rejected_contact',
      reason: '客户明确拒绝联系',
      action: '不得联系该客户'
    });
  }

  return blockers;
}

/**
 * 1. ICP 匹配评分（0-30分）
 */
function calculateIcpMatchScore(customer, context) {
  const result = { score: 0, positiveReasons: [], missingEvidence: [] };
  const pack = context.pack;

  if (!pack) {
    result.missingEvidence.push({ rule: 'icp_pack', reason: '未绑定 Knowledge Pack，无法评估 ICP 匹配' });
    return result;
  }

  // 产品匹配（0-12分）
  const customerProducts = (customer.products || customer.mainProducts || '').toLowerCase();
  if (pack.productScope && pack.productScope.length > 0) {
    const matched = pack.productScope.filter(p =>
      customerProducts.includes((p || '').toLowerCase())
    );
    if (matched.length > 0) {
      result.score += Math.min(12, matched.length * 4);
      result.positiveReasons.push({ category: 'icp', reason: '产品匹配: ' + matched.join(', ') });
    } else {
      result.missingEvidence.push({ rule: 'product_fit', reason: '未发现产品品类匹配' });
    }
  }

  // 市场匹配（0-10分）
  const customerCountry = (customer.country || '').toUpperCase();
  if (pack.targetMarkets && pack.targetMarkets.length > 0) {
    const marketMatch = pack.targetMarkets.some(m =>
      (m || '').toUpperCase() === customerCountry
    );
    if (marketMatch) {
      result.score += 10;
      result.positiveReasons.push({ category: 'icp', reason: '市场匹配: ' + customer.country });
    } else {
      result.missingEvidence.push({ rule: 'market_fit', reason: '客户国家不在目标市场' });
    }
  }

  // 买家类型匹配（0-8分）
  const customerType = (customer.customerType || customer.buyerType || '').toLowerCase();
  if (pack.buyerTypes && pack.buyerTypes.length > 0) {
    const buyerMatch = pack.buyerTypes.some(b =>
      customerType.includes((b || '').toLowerCase())
    );
    if (buyerMatch) {
      result.score += 8;
      result.positiveReasons.push({ category: 'icp', reason: '买家类型匹配: ' + customer.customerType });
    } else {
      result.missingEvidence.push({ rule: 'buyer_type', reason: '买家类型不匹配' });
    }
  }

  return result;
}

/**
 * 2. 身份和网站证据评分（0-20分）
 */
function calculateIdentityAndEvidenceScore(customer, context) {
  const result = { score: 0, positiveReasons: [], missingEvidence: [] };

  // 身份已确认（0-8分）
  if (customer.identityStatus === 'verified' || customer.identityVerified === true ||
      customer.customerStatus === 'identity_verified') {
    result.score += 8;
    result.positiveReasons.push({ category: 'identity', reason: '客户身份已确认' });
  } else {
    result.missingEvidence.push({ rule: 'identity', reason: '客户身份未确认' });
  }

  // 网站可访问（0-4分）
  if (customer.website || customer.url) {
    result.score += 4;
    result.positiveReasons.push({ category: 'evidence', reason: '有客户官网' });
  } else {
    result.missingEvidence.push({ rule: 'website', reason: '缺少客户官网' });
  }

  // reviewed 网站证据（0-8分）
  const evidences = context.evidences || [];
  const reviewedEvidences = evidences.filter(e =>
    e.reviewStatus === 'reviewed' && e.publicUseAllowed === true && !e.error
  );
  if (reviewedEvidences.length > 0) {
    result.score += Math.min(8, reviewedEvidences.length * 4);
    result.positiveReasons.push({
      category: 'evidence',
      reason: reviewedEvidences.length + ' 条已核验网站证据'
    });
  } else {
    const pendingEvidences = evidences.filter(e => e.reviewStatus === 'pending');
    if (pendingEvidences.length > 0) {
      result.missingEvidence.push({
        rule: 'evidence_review',
        reason: pendingEvidences.length + ' 条网站证据待人工核验'
      });
    } else {
      result.missingEvidence.push({ rule: 'evidence', reason: '缺少已核验的网站证据' });
    }
  }

  return result;
}

/**
 * 3. 产品和市场匹配评分（0-20分）
 */
function calculateProductMarketFitScore(customer, context) {
  const result = { score: 0, positiveReasons: [], missingEvidence: [] };
  const evidences = context.evidences || [];
  const reviewedEvidences = evidences.filter(e =>
    e.reviewStatus === 'reviewed' && e.publicUseAllowed === true
  );

  // reviewed evidence 中有目标市场（0-10分）
  const pack = context.pack;
  if (pack && pack.targetMarkets && pack.targetMarkets.length > 0) {
    const evidenceMarkets = new Set();
    reviewedEvidences.forEach(e => {
      (e.detectedMarkets || []).forEach(m => evidenceMarkets.add(m.toLowerCase()));
    });
    const matchedMarkets = pack.targetMarkets.filter(m =>
      evidenceMarkets.has((m || '').toLowerCase())
    );
    if (matchedMarkets.length > 0) {
      result.score += Math.min(10, matchedMarkets.length * 5);
      result.positiveReasons.push({
        category: 'market',
        reason: '网站证据显示目标市场: ' + matchedMarkets.join(', ')
      });
    }
  }

  // reviewed evidence 中有买家类型（0-10分）
  if (pack && pack.buyerTypes && pack.buyerTypes.length > 0) {
    const evidenceBuyerTypes = new Set();
    reviewedEvidences.forEach(e => {
      (e.detectedBuyerTypes || []).forEach(b => evidenceBuyerTypes.add(b.toLowerCase()));
    });
    const matchedBuyerTypes = pack.buyerTypes.filter(b =>
      evidenceBuyerTypes.has((b || '').toLowerCase())
    );
    if (matchedBuyerTypes.length > 0) {
      result.score += Math.min(10, matchedBuyerTypes.length * 5);
      result.positiveReasons.push({
        category: 'buyer',
        reason: '网站证据显示买家类型: ' + matchedBuyerTypes.join(', ')
      });
    }
  }

  if (result.score === 0 && reviewedEvidences.length === 0) {
    result.missingEvidence.push({ rule: 'product_market_evidence', reason: '缺少已核验的产品/市场证据' });
  }

  return result;
}

/**
 * 4. 联系信息完整度评分（0-15分）
 */
function calculateContactCompletenessScore(customer) {
  const result = { score: 0, positiveReasons: [], missingEvidence: [] };

  // 公司网站（0-3分）
  if (customer.website || customer.url) {
    result.score += 3;
    result.positiveReasons.push({ category: 'contact', reason: '有公司网站' });
  } else {
    result.missingEvidence.push({ rule: 'contact_website', reason: '缺少公司网站' });
  }

  // 联系人（0-4分）
  if (customer.contactName || customer.contactPerson || customer.primaryContact) {
    result.score += 4;
    result.positiveReasons.push({ category: 'contact', reason: '有联系人' });
  } else {
    result.missingEvidence.push({ rule: 'contact_person', reason: '缺少联系人' });
  }

  // 邮箱或 LinkedIn（0-5分）
  if (customer.email || customer.contactEmail || customer.linkedin) {
    result.score += 5;
    result.positiveReasons.push({ category: 'contact', reason: '有邮箱或 LinkedIn' });
  } else {
    result.missingEvidence.push({ rule: 'contact_email', reason: '缺少邮箱或 LinkedIn' });
  }

  // 国家/地区（0-3分）
  if (customer.country || customer.region) {
    result.score += 3;
    result.positiveReasons.push({ category: 'contact', reason: '有国家/地区信息' });
  } else {
    result.missingEvidence.push({ rule: 'contact_country', reason: '缺少国家/地区' });
  }

  return result;
}

/**
 * 5. 开发准备度评分（0-15分）
 */
function calculateOutreachReadinessScore(customer, context) {
  const result = { score: 0, positiveReasons: [], missingEvidence: [] };

  // approved Knowledge Pack（0-5分）
  if (context.pack && (context.pack.status === 'approved' || context.pack.reviewStatus === 'approved')) {
    result.score += 5;
    result.positiveReasons.push({ category: 'readiness', reason: '已绑定 approved Knowledge Pack' });
  } else {
    result.missingEvidence.push({ rule: 'readiness_pack', reason: '缺少 approved Knowledge Pack' });
  }

  // 无 hard blockers（0-3分）- 已在阻断检查中确认，这里加分
  result.score += 3;
  result.positiveReasons.push({ category: 'readiness', reason: '无未解决 hard blockers' });

  // 非 DNC（0-2分）- 已在阻断检查中确认
  result.score += 2;
  result.positiveReasons.push({ category: 'readiness', reason: '非 DNC 客户' });

  // 无未处理 duplicate（0-2分）- 已在阻断检查中确认
  result.score += 2;
  result.positiveReasons.push({ category: 'readiness', reason: '无未处理重复客户' });

  // 已有可用草稿或待生成草稿（0-3分）
  const drafts = context.drafts || [];
  const usableDrafts = drafts.filter(d =>
    d.customerId === customer.id &&
    (d.reviewStatus === 'needs_review' || d.reviewStatus === 'draft_pending_review' ||
     d.reviewStatus === 'reviewed' || d.reviewStatus === 'approved')
  );
  if (usableDrafts.length > 0) {
    result.score += 3;
    result.positiveReasons.push({ category: 'readiness', reason: usableDrafts.length + ' 份可用草稿' });
  } else {
    result.missingEvidence.push({ rule: 'readiness_draft', reason: '暂无可用草稿，可生成' });
  }

  return result;
}

/**
 * 从 reviewed 网站证据创建 pending Knowledge Fact（不自动 confirmed）
 * @param {Object} evidence - 网站证据对象
 * @param {string} createdBy - 创建人
 * @returns {Object} Fact 草稿
 */
function createFactFromEvidence(evidence, createdBy) {
  if (!evidence) {
    return { success: false, error: '证据不存在' };
  }
  if (evidence.reviewStatus !== 'reviewed') {
    return { success: false, error: '只有 reviewed 证据才能创建 Fact' };
  }
  if (evidence.publicUseAllowed !== true) {
    return { success: false, error: '证据 publicUseAllowed 不为 true' };
  }

  const now = new Date().toISOString();
  const factTitle = evidence.detectedCompanyName
    ? evidence.detectedCompanyName + ' - 网站证据'
    : '网站证据 - ' + (evidence.pageTitle || evidence.sourceUrl);

  const factContent = [
    evidence.excerpt ? evidence.excerpt.substring(0, 500) : '',
    evidence.detectedProducts && evidence.detectedProducts.length > 0
      ? '检测到产品: ' + evidence.detectedProducts.join(', ')
      : '',
    evidence.detectedMarkets && evidence.detectedMarkets.length > 0
      ? '检测到市场: ' + evidence.detectedMarkets.join(', ')
      : '',
    evidence.detectedBuyerTypes && evidence.detectedBuyerTypes.length > 0
      ? '检测到买家类型: ' + evidence.detectedBuyerTypes.join(', ')
      : ''
  ].filter(Boolean).join('\n\n');

  const fact = {
    factId: 'fact_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8),
    type: 'customer_evidence',
    title: factTitle.substring(0, 200),
    content: factContent,
    sourceType: 'website_evidence',
    sourceDocument: evidence.pageTitle || '客户官网',
    sourceLocator: evidence.finalUrl || evidence.sourceUrl,
    sourceExcerpt: evidence.excerpt ? evidence.excerpt.substring(0, 300) : '',
    sourceUrl: evidence.finalUrl || evidence.sourceUrl,
    sourceHash: evidence.contentHash || '',
    sourceCapturedAt: evidence.fetchedAt || now,
    sourceEvidenceId: evidence.evidenceId,
    reviewStatus: 'pending',  // 默认 pending，不自动 confirmed
    reviewedBy: null,
    reviewedAt: null,
    version: 1,
    confidence: 50,  // 需人工确认后提升
    claimSubject: evidence.detectedCompanyName || '',
    publicUseAllowed: false,  // 默认不允许公开使用
    tags: ['website_evidence', 'customer_research'],
    linkedProductCategories: evidence.detectedProducts || [],
    createdAt: now,
    updatedAt: now,
    createdBy: createdBy || 'Leo',
    schemaVersion: 'P2.3B',
    warnings: [
      '此 Fact 由网站证据自动创建，默认 pending，需人工审核后才能 confirmed',
      '高风险内容（认证、工厂、产能、MOQ）必须人工确认',
      '不得将客户官网内容写成 KaiLionCrafts 自有事实'
    ]
  };

  return { success: true, fact };
}

/**
 * 检查客户是否可以生成公开草稿
 */
function canGeneratePublicDraft(customer, context) {
  const priority = calculateProspectPriority(customer, context);
  if (priority.priorityTier === 'blocked') {
    return { allowed: false, reason: priority.hardBlockers[0]?.reason || '存在硬性阻断' };
  }

  // 至少有一条 confirmed + publicUseAllowed=true 的公司/产品事实
  const facts = context.facts || [];
  const usableFacts = facts.filter(f =>
    f.reviewStatus === 'confirmed' && f.publicUseAllowed === true
  );
  if (usableFacts.length === 0) {
    return { allowed: false, reason: '缺少 confirmed + publicUseAllowed=true 的公司/产品事实' };
  }

  // 联系信息达到最低要求
  if (!customer.email && !customer.contactEmail && !customer.linkedin) {
    return { allowed: false, reason: '缺少邮箱或 LinkedIn，无法生成公开草稿' };
  }

  return { allowed: true, reason: '可以生成公开草稿' };
}

module.exports = {
  PRIORITY_VERSION,
  calculateProspectPriority,
  detectHardBlockers,
  calculateIcpMatchScore,
  calculateIdentityAndEvidenceScore,
  calculateProductMarketFitScore,
  calculateContactCompletenessScore,
  calculateOutreachReadinessScore,
  createFactFromEvidence,
  canGeneratePublicDraft
};
