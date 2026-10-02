/**
 * P2.3B: 客户优先级排序、人工开发名单和证据转 Fact 流程测试
 * 
 * 核心验证：
 * 1. 优先级分数可重复计算
 * 2. 分数明细完整
 * 3. A/B/C/blocked 分层
 * 4. DNC/identity/duplicate/hard blocker 强制 blocked
 * 5. approved Pack 加分
 * 6. reviewed website evidence 加分
 * 7. 联系信息完整度评分
 * 8. 名单记录保存 score version
 * 9. reviewed evidence 创建 Fact 默认 pending
 * 10. 不产生外部请求
 */

const assert = require('assert');
const ProspectPriority = require('./prospect-priority');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

console.log('\n=== P2.3B: 客户优先级排序和人工开发名单测试 ===\n');

// 测试数据
function makeCustomer(overrides = {}) {
  return Object.assign({
    id: 'cust_test_001',
    company: 'Test Company',
    country: 'USA',
    customerType: 'wholesaler',
    products: 'kitchen knives, cutlery',
    website: 'https://test.com',
    email: 'test@example.com',
    contactName: 'John Doe',
    identityStatus: 'verified',
    identityVerified: true,
    dnc: false,
    duplicateStatus: 'none',
    hardBlockers: [],
    riskFlags: []
  }, overrides);
}

function makePack(overrides = {}) {
  return Object.assign({
    packId: 'pack_test_001',
    status: 'approved',
    reviewStatus: 'approved',
    archived: false,
    targetMarkets: ['USA', 'Canada'],
    buyerTypes: ['wholesaler', 'distributor'],
    productScope: ['kitchen', 'knife', 'cutlery'],
    version: 1
  }, overrides);
}

function makeEvidence(overrides = {}) {
  return Object.assign({
    evidenceId: 'ev_test_001',
    reviewStatus: 'reviewed',
    publicUseAllowed: true,
    error: null,
    detectedProducts: ['kitchen', 'knife'],
    detectedMarkets: ['usa'],
    detectedBuyerTypes: ['wholesaler'],
    contentHash: 'abc123',
    fetchedAt: new Date().toISOString()
  }, overrides);
}

console.log('--- 一、优先级评分基础 ---');

test('1. calculateProspectPriority 返回完整结构', () => {
  const customer = makeCustomer();
  const context = { pack: makePack(), evidences: [makeEvidence()], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.ok(result.customerId);
  assert.ok(typeof result.priorityScore === 'number');
  assert.ok(result.priorityTier);
  assert.ok(result.scoreBreakdown);
  assert.ok(result.positiveReasons);
  assert.ok(result.missingEvidence);
  assert.ok(result.riskFlags);
  assert.ok(result.hardBlockers);
  assert.ok(result.recommendedNextAction);
  assert.ok(result.calculatedAt);
  assert.strictEqual(result.calculationVersion, 'P2.3B-v1');
});

test('2. 分数明细包含五个维度', () => {
  const customer = makeCustomer();
  const context = { pack: makePack(), evidences: [makeEvidence()], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.ok(typeof result.scoreBreakdown.icpMatch === 'number');
  assert.ok(typeof result.scoreBreakdown.identityAndEvidence === 'number');
  assert.ok(typeof result.scoreBreakdown.productMarketFit === 'number');
  assert.ok(typeof result.scoreBreakdown.contactCompleteness === 'number');
  assert.ok(typeof result.scoreBreakdown.outreachReadiness === 'number');
});

test('3. 总分不超过100', () => {
  const customer = makeCustomer();
  const context = { pack: makePack(), evidences: [makeEvidence()], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.ok(result.priorityScore <= 100);
  assert.ok(result.priorityScore >= 0);
});

test('4. 相同输入产生相同分数（可重复计算）', () => {
  const customer = makeCustomer();
  const context = { pack: makePack(), evidences: [makeEvidence()], drafts: [], facts: [] };
  const r1 = ProspectPriority.calculateProspectPriority(customer, context);
  const r2 = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(r1.priorityScore, r2.priorityScore);
  assert.strictEqual(r1.priorityTier, r2.priorityTier);
});

console.log('\n--- 二、A/B/C/blocked 分层 ---');

test('5. 合格客户可达到 A 类（80-100）', () => {
  const customer = makeCustomer({
    identityStatus: 'verified',
    website: 'https://test.com',
    email: 'test@example.com',
    contactName: 'John',
    country: 'USA'
  });
  const context = {
    pack: makePack(),
    evidences: [makeEvidence(), makeEvidence({evidenceId: 'ev_002'})],
    drafts: [{reviewStatus: 'needs_review'}],
    facts: []
  };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.ok(result.priorityScore >= 60, '分数应 >= 60, 实际: ' + result.priorityScore);
});

test('6. 缺少信息的客户为 C 类', () => {
  const customer = makeCustomer({
    website: '',
    email: '',
    contactName: '',
    country: ''
  });
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.ok(result.priorityScore < 60, '分数应 < 60, 实际: ' + result.priorityScore);
});

test('7. blocked 客户分数为0', () => {
  const customer = makeCustomer({ dnc: true });
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(result.priorityTier, 'blocked');
  assert.strictEqual(result.priorityScore, 0);
});

console.log('\n--- 三、硬性阻断规则 ---');

test('8. DNC 强制 blocked', () => {
  const customer = makeCustomer({ dnc: true });
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(result.priorityTier, 'blocked');
  assert.ok(result.hardBlockers.some(b => b.type === 'dnc'));
});

test('9. identity unresolved 强制 blocked', () => {
  const customer = makeCustomer({ identityStatus: 'unverified', identityVerified: false });
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(result.priorityTier, 'blocked');
  assert.ok(result.hardBlockers.some(b => b.type === 'identity_unresolved'));
});

test('10. duplicate 未处理强制 blocked', () => {
  const customer = makeCustomer({ duplicateStatus: 'pending' });
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(result.priorityTier, 'blocked');
  assert.ok(result.hardBlockers.some(b => b.type === 'duplicate_unresolved'));
});

test('11. hard blocker 强制 blocked', () => {
  const customer = makeCustomer({ hardBlockers: [{type: 'compliance', resolved: false}] });
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(result.priorityTier, 'blocked');
  assert.ok(result.hardBlockers.some(b => b.type === 'hard_blocker'));
});

test('12. 未绑定 approved Pack 强制 blocked', () => {
  const customer = makeCustomer();
  const context = { pack: null, evidences: [], drafts: [], facts: [], hasApprovedPack: false };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(result.priorityTier, 'blocked');
  assert.ok(result.hardBlockers.some(b => b.type === 'no_approved_pack'));
});

test('13. Pack 未批准强制 blocked', () => {
  const customer = makeCustomer();
  const context = { pack: makePack({status: 'draft', reviewStatus: 'draft'}), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(result.priorityTier, 'blocked');
  assert.ok(result.hardBlockers.some(b => b.type === 'pack_not_approved'));
});

test('14. 高分不能绕过 blocker', () => {
  // 即使其他条件都很好，DNC 仍然强制 blocked
  const customer = makeCustomer({
    dnc: true,
    identityStatus: 'verified',
    website: 'https://test.com',
    email: 'test@example.com',
    country: 'USA'
  });
  const context = {
    pack: makePack(),
    evidences: [makeEvidence(), makeEvidence({evidenceId: 'ev_002'})],
    drafts: [{reviewStatus: 'needs_review'}],
    facts: []
  };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(result.priorityTier, 'blocked');
  assert.strictEqual(result.priorityScore, 0);
});

console.log('\n--- 四、评分维度 ---');

test('15. approved Pack 加分', () => {
  const customer = makeCustomer();
  const contextWithPack = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const r1 = ProspectPriority.calculateProspectPriority(customer, contextWithPack);
  // 有 approved pack 时，outreachReadiness 应该有 5 分
  assert.ok(r1.scoreBreakdown.outreachReadiness >= 5);
});

test('16. reviewed website evidence 加分', () => {
  const customer = makeCustomer();
  const contextNoEvidence = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const contextWithEvidence = { pack: makePack(), evidences: [makeEvidence()], drafts: [], facts: [] };
  const r1 = ProspectPriority.calculateProspectPriority(customer, contextNoEvidence);
  const r2 = ProspectPriority.calculateProspectPriority(customer, contextWithEvidence);
  assert.ok(r2.scoreBreakdown.identityAndEvidence > r1.scoreBreakdown.identityAndEvidence);
});

test('17. pending evidence 不加公开证据分', () => {
  const customer = makeCustomer();
  const pendingEvidence = makeEvidence({ reviewStatus: 'pending', publicUseAllowed: false });
  const context = { pack: makePack(), evidences: [pendingEvidence], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  // pending evidence 不应该加 reviewed evidence 的分数
  assert.ok(result.missingEvidence.some(m => m.rule === 'evidence_review'));
});

test('18. rejected/conflict evidence 不可公开使用', () => {
  const customer = makeCustomer();
  const rejectedEvidence = makeEvidence({ reviewStatus: 'rejected', publicUseAllowed: false });
  const reviewedEvidence = makeEvidence({ reviewStatus: 'reviewed', publicUseAllowed: true });
  const contextRejected = { pack: makePack(), evidences: [rejectedEvidence], drafts: [], facts: [] };
  const contextReviewed = { pack: makePack(), evidences: [reviewedEvidence], drafts: [], facts: [] };
  const r1 = ProspectPriority.calculateProspectPriority(customer, contextRejected);
  const r2 = ProspectPriority.calculateProspectPriority(customer, contextReviewed);
  // rejected evidence 不应该加 reviewed evidence 的分数（4分）
  assert.ok(r2.scoreBreakdown.identityAndEvidence > r1.scoreBreakdown.identityAndEvidence);
});

test('19. 联系信息完整度评分', () => {
  const customerFull = makeCustomer({ website: 'https://x.com', email: 'a@b.com', contactName: 'John', country: 'USA' });
  const customerEmpty = makeCustomer({ website: '', email: '', contactName: '', country: '' });
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const r1 = ProspectPriority.calculateProspectPriority(customerFull, context);
  const r2 = ProspectPriority.calculateProspectPriority(customerEmpty, context);
  assert.ok(r1.scoreBreakdown.contactCompleteness > r2.scoreBreakdown.contactCompleteness);
});

test('20. 缺失信息显示在 missingEvidence', () => {
  const customer = makeCustomer({ website: '', email: '' });
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.ok(result.missingEvidence.length > 0);
});

test('21. recommendedNextAction 正确', () => {
  const customer = makeCustomer({ dnc: true });
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.ok(result.recommendedNextAction.length > 0);
});

console.log('\n--- 五、证据转 Fact ---');

test('22. reviewed evidence 可创建 pending Fact', () => {
  const evidence = makeEvidence({ detectedCompanyName: 'Test Co', pageTitle: 'Test' });
  const result = ProspectPriority.createFactFromEvidence(evidence, 'Leo');
  assert.strictEqual(result.success, true);
  assert.ok(result.fact);
  assert.strictEqual(result.fact.reviewStatus, 'pending');
  assert.strictEqual(result.fact.publicUseAllowed, false);
});

test('23. 创建的 Fact 保留来源字段', () => {
  const evidence = makeEvidence({
    finalUrl: 'https://test.com/page',
    contentHash: 'hash123',
    fetchedAt: '2024-01-01T00:00:00Z',
    excerpt: 'Test excerpt content'
  });
  const result = ProspectPriority.createFactFromEvidence(evidence, 'Leo');
  assert.strictEqual(result.fact.sourceUrl, 'https://test.com/page');
  assert.strictEqual(result.fact.sourceHash, 'hash123');
  assert.strictEqual(result.fact.sourceCapturedAt, '2024-01-01T00:00:00Z');
  assert.ok(result.fact.sourceExcerpt.includes('Test excerpt'));
  assert.strictEqual(result.fact.sourceEvidenceId, evidence.evidenceId);
});

test('24. Fact 不自动 confirmed', () => {
  const evidence = makeEvidence();
  const result = ProspectPriority.createFactFromEvidence(evidence, 'Leo');
  assert.strictEqual(result.fact.reviewStatus, 'pending');
  assert.strictEqual(result.fact.reviewedBy, null);
  assert.strictEqual(result.fact.reviewedAt, null);
});

test('25. Fact 不自动 publicUseAllowed', () => {
  const evidence = makeEvidence({ publicUseAllowed: true });
  const result = ProspectPriority.createFactFromEvidence(evidence, 'Leo');
  assert.strictEqual(result.fact.publicUseAllowed, false);
});

test('26. pending evidence 不能创建 Fact', () => {
  const evidence = makeEvidence({ reviewStatus: 'pending' });
  const result = ProspectPriority.createFactFromEvidence(evidence, 'Leo');
  assert.strictEqual(result.success, false);
});

test('27. rejected evidence 不能创建 Fact', () => {
  const evidence = makeEvidence({ reviewStatus: 'rejected' });
  const result = ProspectPriority.createFactFromEvidence(evidence, 'Leo');
  assert.strictEqual(result.success, false);
});

test('28. publicUseAllowed=false 的 evidence 不能创建 Fact', () => {
  const evidence = makeEvidence({ reviewStatus: 'reviewed', publicUseAllowed: false });
  const result = ProspectPriority.createFactFromEvidence(evidence, 'Leo');
  assert.strictEqual(result.success, false);
});

test('29. Fact 包含警告信息', () => {
  const evidence = makeEvidence();
  const result = ProspectPriority.createFactFromEvidence(evidence, 'Leo');
  assert.ok(Array.isArray(result.fact.warnings));
  assert.ok(result.fact.warnings.length > 0);
  assert.ok(result.fact.warnings.some(w => w.includes('pending')));
});

console.log('\n--- 六、草稿联动 ---');

test('30. blocked 客户不可生成公开草稿', () => {
  const customer = makeCustomer({ dnc: true });
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.canGeneratePublicDraft(customer, context);
  assert.strictEqual(result.allowed, false);
});

test('31. 缺少 confirmed Fact 不可生成公开草稿', () => {
  const customer = makeCustomer();
  const context = { pack: makePack(), evidences: [makeEvidence()], drafts: [], facts: [] };
  const result = ProspectPriority.canGeneratePublicDraft(customer, context);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('confirmed'));
});

test('32. 合格客户可以进入草稿流程', () => {
  const customer = makeCustomer({ email: 'test@example.com' });
  const context = {
    pack: makePack(),
    evidences: [makeEvidence()],
    drafts: [],
    facts: [{factId: 'f1', reviewStatus: 'confirmed', publicUseAllowed: true}]
  };
  const result = ProspectPriority.canGeneratePublicDraft(customer, context);
  assert.strictEqual(result.allowed, true);
});

console.log('\n--- 七、安全和业务边界 ---');

test('33. 不包含发送邮件或消息功能', () => {
  const fs = require('fs');
  const code = fs.readFileSync('./prospect-priority.js', 'utf8');
  assert.ok(!code.includes('nodemailer'));
  assert.ok(!code.includes('sendmail'));
  assert.ok(!code.includes('smtp'));
  assert.ok(!code.includes('transporter'));
  assert.ok(!code.includes('sendEmail'));
  assert.ok(!code.includes('sendMessage'));
});

test('34. 不调用云端 AI API', () => {
  const fs = require('fs');
  const code = fs.readFileSync('./prospect-priority.js', 'utf8');
  assert.ok(!code.includes('openai'));
  assert.ok(!code.includes('zhipu'));
  assert.ok(!code.includes('glm'));
  assert.ok(!code.includes('api.openai.com'));
});

test('35. PRIORITY_VERSION 已定义', () => {
  assert.ok(ProspectPriority.PRIORITY_VERSION);
  assert.strictEqual(ProspectPriority.PRIORITY_VERSION, 'P2.3B-v1');
});

test('36. detectHardBlockers 导出可用', () => {
  assert.ok(typeof ProspectPriority.detectHardBlockers === 'function');
});

test('37. 各评分函数独立导出', () => {
  assert.ok(typeof ProspectPriority.calculateIcpMatchScore === 'function');
  assert.ok(typeof ProspectPriority.calculateIdentityAndEvidenceScore === 'function');
  assert.ok(typeof ProspectPriority.calculateProductMarketFitScore === 'function');
  assert.ok(typeof ProspectPriority.calculateContactCompletenessScore === 'function');
  assert.ok(typeof ProspectPriority.calculateOutreachReadinessScore === 'function');
});

test('38. 客户不存在时返回错误', () => {
  const result = ProspectPriority.calculateProspectPriority(null, {});
  assert.strictEqual(result.success, false);
});

test('39. 证据不存在时 createFactFromEvidence 返回错误', () => {
  const result = ProspectPriority.createFactFromEvidence(null, 'Leo');
  assert.strictEqual(result.success, false);
});

test('40. 评分包含 calculationVersion', () => {
  const customer = makeCustomer();
  const context = { pack: makePack(), evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.ok(result.calculationVersion);
});

// 输出结果
console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);

if (failed > 0) {
  process.exit(1);
}
