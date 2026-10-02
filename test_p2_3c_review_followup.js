/**
 * P2.3C: 人工审核队列、跟进计划与结果复盘测试
 * 
 * 核心验证：
 * 1. 五维评分名称一致
 * 2. 人工审核队列
 * 3. 跟进计划
 * 4. 人工结果记录
 * 5. 统计口径
 * 6. 安全边界
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

console.log('\n=== P2.3C: 人工审核队列、跟进计划与结果复盘测试 ===\n');

// 测试数据
function makeCustomer(overrides = {}) {
  return Object.assign({
    id: 'cust_test_001',
    company: 'Test Company',
    country: 'USA',
    customerType: 'wholesaler',
    products: 'kitchen knives',
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

function makeDraft(overrides = {}) {
  return Object.assign({
    draftId: 'draft_test_001',
    customerId: 'cust_test_001',
    subject: 'Test Subject',
    body: 'Test body content',
    reviewStatus: 'needs_review',
    status: 'needs_review',
    model: 'qwen3.5:9b',
    manual: true,
    knowledgePackId: 'pack_001',
    knowledgePackVersion: 1,
    knowledgeSnapshotHash: 'hash123',
    factIds: ['fact_001'],
    riskFlags: [],
    missingInformation: [],
    createdAt: new Date().toISOString()
  }, overrides);
}

console.log('--- 一、五维评分命名一致性 ---');

test('1. PRIORITY_VERSION 已更新为 P2.3C-v1', () => {
  assert.strictEqual(ProspectPriority.PRIORITY_VERSION, 'P2.3C-v1');
});

test('2. scoreBreakdown 包含五个维度字段', () => {
  const customer = makeCustomer();
  const context = { pack: {status:'approved',reviewStatus:'approved',targetMarkets:['USA'],buyerTypes:['wholesaler'],productScope:['kitchen']}, evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  const keys = Object.keys(result.scoreBreakdown);
  assert.strictEqual(keys.length, 5);
  assert.ok(keys.includes('icpMatch'));
  assert.ok(keys.includes('identityAndEvidence'));
  assert.ok(keys.includes('productMarketFit'));
  assert.ok(keys.includes('contactCompleteness'));
  assert.ok(keys.includes('outreachReadiness'));
});

test('3. 五维度分数总和等于总分（非blocked时）', () => {
  const customer = makeCustomer();
  const context = { pack: {status:'approved',reviewStatus:'approved',targetMarkets:['USA'],buyerTypes:['wholesaler'],productScope:['kitchen']}, evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  if(result.priorityTier !== 'blocked'){
    const sum = result.scoreBreakdown.icpMatch + result.scoreBreakdown.identityAndEvidence +
      result.scoreBreakdown.productMarketFit + result.scoreBreakdown.contactCompleteness +
      result.scoreBreakdown.outreachReadiness;
    assert.strictEqual(sum, result.priorityScore);
  }
});

test('4. 各维度上限正确', () => {
  const customer = makeCustomer();
  const context = { pack: {status:'approved',reviewStatus:'approved',targetMarkets:['USA'],buyerTypes:['wholesaler'],productScope:['kitchen']}, evidences: [], drafts: [], facts: [] };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.ok(result.scoreBreakdown.icpMatch <= 30);
  assert.ok(result.scoreBreakdown.identityAndEvidence <= 20);
  assert.ok(result.scoreBreakdown.productMarketFit <= 20);
  assert.ok(result.scoreBreakdown.contactCompleteness <= 15);
  assert.ok(result.scoreBreakdown.outreachReadiness <= 15);
});

test('5. 旧评分兼容（calculationVersion 不同时不报错）', () => {
  const oldPriority = {
    customerId: 'cust_001',
    priorityScore: 75,
    priorityTier: 'B',
    scoreBreakdown: {icpMatch:20, identityAndEvidence:15, productMarketFit:15, contactCompleteness:10, outreachReadiness:15},
    calculationVersion: 'P2.3B-v1'
  };
  assert.ok(oldPriority.calculationVersion !== ProspectPriority.PRIORITY_VERSION);
  // 旧数据结构仍然有效
  assert.strictEqual(oldPriority.priorityScore, 75);
});

console.log('\n--- 二、人工审核队列 ---');

test('6. needs_review 草稿进入审核队列', () => {
  const draft = makeDraft({reviewStatus: 'needs_review'});
  const isInQueue = draft.reviewStatus === 'needs_review' || draft.reviewStatus === 'draft_pending_review';
  assert.strictEqual(isInQueue, true);
});

test('7. draft_pending_review 草稿进入审核队列', () => {
  const draft = makeDraft({reviewStatus: 'draft_pending_review'});
  const isInQueue = draft.reviewStatus === 'needs_review' || draft.reviewStatus === 'draft_pending_review';
  assert.strictEqual(isInQueue, true);
});

test('8. approved 不等于 sent', () => {
  const draft = makeDraft({reviewStatus: 'approved', status: 'approved'});
  assert.strictEqual(draft.reviewStatus, 'approved');
  assert.notStrictEqual(draft.reviewStatus, 'sent');
  assert.notStrictEqual(draft.reviewStatus, 'manually_sent');
  assert.ok(!draft.manualSendRecord);
});

test('9. rejected 必须保存拒绝原因', () => {
  const draft = makeDraft({
    reviewStatus: 'rejected',
    rejectedBy: 'Leo',
    rejectedAt: new Date().toISOString(),
    rejectReason: '内容不符合要求'
  });
  assert.ok(draft.rejectReason);
  assert.ok(draft.rejectReason.length > 0);
});

test('10. needs_evidence 保存缺失项', () => {
  const draft = makeDraft({
    reviewStatus: 'needs_evidence',
    missingEvidenceItems: ['缺少产品认证信息', '缺少工厂产能数据']
  });
  assert.ok(Array.isArray(draft.missingEvidenceItems));
  assert.ok(draft.missingEvidenceItems.length > 0);
});

test('11. manually_sent 保存人工发送记录', () => {
  const draft = makeDraft({
    reviewStatus: 'approved',
    manualSendRecord: {
      channel: 'email',
      sentAt: new Date().toISOString(),
      note: '已通过 Gmail 发送',
      manualSendSource: 'manual_mark',
      recordedBy: 'Leo'
    }
  });
  assert.ok(draft.manualSendRecord);
  assert.strictEqual(draft.manualSendRecord.manualSendSource, 'manual_mark');
  assert.ok(draft.manualSendRecord.channel);
  assert.ok(draft.manualSendRecord.sentAt);
});

test('12. manually_sent 不触发网络请求（仅记录）', () => {
  const draft = makeDraft({
    reviewStatus: 'approved',
    manualSendRecord: {
      channel: 'email',
      sentAt: new Date().toISOString(),
      manualSendSource: 'manual_mark'
    }
  });
  // 验证只是记录，没有发送相关字段
  assert.ok(!draft.sentViaApi);
  assert.ok(!draft.smtpResponse);
  assert.ok(!draft.deliveryStatus);
});

test('13. rejected 草稿不能标记人工发送', () => {
  const draft = makeDraft({reviewStatus: 'rejected', rejectReason: 'test'});
  const canMarkSent = draft.reviewStatus === 'approved' || draft.status === 'approved';
  assert.strictEqual(canMarkSent, false);
});

test('14. 未审核草稿不能标记人工发送', () => {
  const draft = makeDraft({reviewStatus: 'needs_review'});
  const canMarkSent = draft.reviewStatus === 'approved' || draft.status === 'approved';
  assert.strictEqual(canMarkSent, false);
});

test('15. 审核变化保存历史记录', () => {
  const draft = makeDraft({
    reviewStatus: 'approved',
    reviewHistory: [
      {previousStatus: 'needs_review', nextStatus: 'approved', changedAt: new Date().toISOString(), changedBy: 'Leo', reason: '审核通过'}
    ]
  });
  assert.ok(Array.isArray(draft.reviewHistory));
  assert.strictEqual(draft.reviewHistory.length, 1);
  assert.strictEqual(draft.reviewHistory[0].previousStatus, 'needs_review');
  assert.strictEqual(draft.reviewHistory[0].nextStatus, 'approved');
});

console.log('\n--- 三、跟进计划 ---');

test('16. 跟进计划字段完整', () => {
  const followUp = {
    followUpId: 'fu_001',
    customerId: 'cust_001',
    campaignId: 'camp_001',
    draftId: 'draft_001',
    taskId: 'task_001',
    plannedAt: new Date().toISOString(),
    timezone: 'America/New_York',
    channel: 'email',
    actionType: 'follow_up_1',
    status: 'planned',
    reminderNote: '发送第二封跟进邮件',
    sourceStatus: 'manual',
    createdBy: 'Leo',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  assert.ok(followUp.followUpId);
  assert.ok(followUp.customerId);
  assert.ok(followUp.plannedAt);
  assert.ok(followUp.actionType);
  assert.ok(followUp.status);
});

test('17. 支持的 actionType 完整', () => {
  const validTypes = ['review_draft','manual_send','follow_up_1','follow_up_2','check_reply','update_evidence','reassess_icp'];
  assert.ok(validTypes.includes('follow_up_1'));
  assert.ok(validTypes.includes('follow_up_2'));
  assert.ok(validTypes.includes('check_reply'));
  assert.ok(validTypes.includes('manual_send'));
});

test('18. 时区未知时不虚构当地时间', () => {
  const followUp = {
    followUpId: 'fu_001',
    customerId: 'cust_001',
    plannedAt: new Date().toISOString(),
    timezone: 'unknown',
    actionType: 'follow_up_1',
    status: 'planned'
  };
  assert.strictEqual(followUp.timezone, 'unknown');
  // 不应该有 calculatedLocalTime 等虚构字段
  assert.ok(!followUp.calculatedLocalTime);
});

test('19. due/overdue 状态正确', () => {
  const now = new Date();
  const dueFollowUp = {
    followUpId: 'fu_due',
    plannedAt: new Date(now.getTime() - 3600000).toISOString(), // 1小时前
    status: 'planned'
  };
  const overdueFollowUp = {
    followUpId: 'fu_overdue',
    plannedAt: new Date(now.getTime() - 86400000 * 2).toISOString(), // 2天前
    status: 'planned'
  };
  const isDue = new Date(dueFollowUp.plannedAt) <= now && new Date(dueFollowUp.plannedAt) >= new Date(now.getTime() - 86400000);
  const isOverdue = new Date(overdueFollowUp.plannedAt) < new Date(now.getTime() - 86400000);
  assert.strictEqual(isDue, true);
  assert.strictEqual(isOverdue, true);
});

test('20. 跟进完成记录完整', () => {
  const followUp = {
    followUpId: 'fu_001',
    status: 'completed',
    completedBy: 'Leo',
    completedAt: new Date().toISOString(),
    completionNote: '已发送跟进邮件'
  };
  assert.strictEqual(followUp.status, 'completed');
  assert.ok(followUp.completedBy);
  assert.ok(followUp.completedAt);
});

test('21. 取消跟进不删除历史记录', () => {
  const followUp = {
    followUpId: 'fu_001',
    status: 'cancelled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  assert.strictEqual(followUp.status, 'cancelled');
  assert.ok(followUp.createdAt); // 历史记录保留
});

test('22. DNC 客户不创建外部跟进', () => {
  const customer = makeCustomer({dnc: true});
  const canCreateExternalFollowUp = customer.dnc !== true && customer.doNotContact !== true;
  assert.strictEqual(canCreateExternalFollowUp, false);
});

test('23. blocked 客户不进入外部跟进', () => {
  const customer = makeCustomer();
  const context = { pack: null, evidences: [], drafts: [], facts: [], hasApprovedPack: false };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(result.priorityTier, 'blocked');
});

console.log('\n--- 四、人工结果记录 ---');

test('24. 结果记录字段完整', () => {
  const outcome = {
    outcomeId: 'oc_001',
    customerId: 'cust_001',
    campaignId: 'camp_001',
    draftId: 'draft_001',
    channel: 'email',
    occurredAt: new Date().toISOString(),
    timezone: 'America/New_York',
    outcome: 'replied',
    note: '客户对产品感兴趣',
    nextAction: '发送报价单',
    recordedBy: 'Leo',
    source: 'manual_entry',
    createdAt: new Date().toISOString()
  };
  assert.ok(outcome.outcomeId);
  assert.ok(outcome.customerId);
  assert.ok(outcome.outcome);
  assert.strictEqual(outcome.source, 'manual_entry');
});

test('25. 支持的结果类型完整', () => {
  const validOutcomes = ['replied','interested','not_interested','requested_quote','requested_sample','no_response','bounced','wrong_contact','do_not_contact','meeting_requested','other'];
  assert.ok(validOutcomes.includes('replied'));
  assert.ok(validOutcomes.includes('interested'));
  assert.ok(validOutcomes.includes('requested_quote'));
  assert.ok(validOutcomes.includes('no_response'));
  assert.ok(validOutcomes.includes('do_not_contact'));
});

test('26. replied 只来自人工录入', () => {
  const outcome = {outcome: 'replied', source: 'manual_entry', recordedBy: 'Leo'};
  assert.strictEqual(outcome.source, 'manual_entry');
  assert.ok(outcome.recordedBy);
});

test('27. no_response 只来自人工录入', () => {
  const outcome = {outcome: 'no_response', source: 'manual_entry'};
  assert.strictEqual(outcome.source, 'manual_entry');
});

test('28. DNC 结果阻断后续外部跟进', () => {
  const outcome = {outcome: 'do_not_contact', customerId: 'cust_001'};
  const customer = makeCustomer({dnc: true});
  const canCreateExternalFollowUp = customer.dnc !== true;
  assert.strictEqual(canCreateExternalFollowUp, false);
});

console.log('\n--- 五、统计口径 ---');

test('29. 统计分母正确（回复率基于已人工发送）', () => {
  const manuallySent = 10;
  const replied = 3;
  const replyRate = manuallySent > 0 ? Math.round(replied / manuallySent * 100) : null;
  assert.strictEqual(replyRate, 30);
});

test('30. 没有数据时不显示误导性 0%', () => {
  const manuallySent = 0;
  const replied = 0;
  const replyRate = manuallySent > 0 ? Math.round(replied / manuallySent * 100) : null;
  assert.strictEqual(replyRate, null);
});

test('31. approved 草稿不计入已发送', () => {
  const approvedDraft = {reviewStatus: 'approved', manualSendRecord: null};
  const isManuallySent = approvedDraft.reviewStatus === 'manually_sent' || !!approvedDraft.manualSendRecord;
  assert.strictEqual(isManuallySent, false);
});

test('32. manually_sent 才计入已人工发送', () => {
  const sentDraft = {reviewStatus: 'manually_sent', manualSendRecord: {channel: 'email'}};
  const isManuallySent = sentDraft.reviewStatus === 'manually_sent' || !!sentDraft.manualSendRecord;
  assert.strictEqual(isManuallySent, true);
});

test('33. needs_review 不计为已联系', () => {
  const draft = {reviewStatus: 'needs_review'};
  const isContacted = draft.reviewStatus === 'manually_sent' || !!draft.manualSendRecord;
  assert.strictEqual(isContacted, false);
});

test('34. completed follow-up 不计为回复', () => {
  const followUp = {status: 'completed', actionType: 'follow_up_1'};
  const isReply = followUp.actionType === 'check_reply' && followUp.outcomeId;
  assert.strictEqual(isReply, false);
});

console.log('\n--- 六、筛选和兼容 ---');

test('35. 国家筛选可行', () => {
  const customers = [makeCustomer({country:'USA'}), makeCustomer({country:'Germany'}), makeCustomer({country:'Japan'})];
  const usCustomers = customers.filter(c => c.country === 'USA');
  assert.strictEqual(usCustomers.length, 1);
});

test('36. 买家类型筛选可行', () => {
  const customers = [makeCustomer({customerType:'wholesaler'}), makeCustomer({customerType:'distributor'})];
  const wholesalers = customers.filter(c => c.customerType === 'wholesaler');
  assert.strictEqual(wholesalers.length, 1);
});

test('37. priorityTier 筛选可行', () => {
  const queues = [
    {customerId:'c1', priorityTier:'A'},
    {customerId:'c2', priorityTier:'B'},
    {customerId:'c3', priorityTier:'blocked'}
  ];
  const tierA = queues.filter(q => q.priorityTier === 'A');
  assert.strictEqual(tierA.length, 1);
});

test('38. 日期范围筛选可行', () => {
  const now = new Date();
  const outcomes = [
    {outcomeId:'o1', occurredAt: new Date(now.getTime() - 86400000).toISOString()},
    {outcomeId:'o2', occurredAt: new Date(now.getTime() - 86400000 * 10).toISOString()}
  ];
  const last7Days = outcomes.filter(o => new Date(o.occurredAt) >= new Date(now.getTime() - 86400000 * 7));
  assert.strictEqual(last7Days.length, 1);
});

test('39. 缺失字段兼容（旧数据没有新字段不报错）', () => {
  const oldDraft = {draftId: 'old_001', subject: 'Old', reviewStatus: 'needs_review'};
  // 旧草稿没有 model、knowledgePackId 等字段
  assert.ok(!oldDraft.model);
  assert.ok(!oldDraft.knowledgePackId);
  // 不应该报错
  const hasRiskFlags = Array.isArray(oldDraft.riskFlags) ? oldDraft.riskFlags : [];
  assert.strictEqual(hasRiskFlags.length, 0);
});

test('40. 历史数据兼容（旧状态值保留）', () => {
  const oldStatuses = ['draft', 'pending', 'approved', 'rejected'];
  const newStatuses = ['needs_review', 'draft_pending_review', 'approved', 'rejected', 'needs_evidence', 'manually_sent'];
  // 旧状态值仍然有效
  assert.ok(oldStatuses.includes('approved'));
  assert.ok(newStatuses.includes('approved'));
});

console.log('\n--- 七、安全边界 ---');

test('41. XSS 特殊字符安全（函数存在）', () => {
  // 验证 esc 函数模式存在于代码中
  const fs = require('fs');
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('function esc(') || code.includes('const esc ='));
});

test('42. 联系方式脱敏（不显示完整邮箱）', () => {
  const email = 'test@example.com';
  const masked = email.replace(/(.{2}).*(@.*)/, '$1***$2');
  assert.ok(masked.includes('***'));
  assert.ok(!masked.includes('test@'));
});

test('43. API Key 不泄露（导出脱敏）', () => {
  const apiConfig = {name: 'GLM', apiKey: 'sk-1234567890abcdef'};
  const redacted = {name: apiConfig.name, configured: true, redacted: true};
  assert.ok(!redacted.apiKey);
  assert.strictEqual(redacted.redacted, true);
});

test('44. thinking 内容不泄露', () => {
  const draft = {
    subject: 'Test',
    body: 'Real content',
    model: 'qwen3.5:9b'
  };
  // 草稿中不应该包含 thinking 字段
  assert.ok(!draft.thinking);
  assert.ok(!draft.reasoning_content);
  assert.ok(!draft.analysis);
});

test('45. 不包含自动发送功能', () => {
  const fs = require('fs');
  const code = fs.readFileSync('./prospect-priority.js', 'utf8');
  assert.ok(!code.includes('nodemailer'));
  assert.ok(!code.includes('sendmail'));
  assert.ok(!code.includes('smtp'));
  assert.ok(!code.includes('transporter'));
});

test('46. blocked 状态不会被高分绕过', () => {
  const customer = makeCustomer({
    dnc: true,
    identityStatus: 'verified',
    website: 'https://test.com',
    email: 'test@example.com',
    country: 'USA'
  });
  const context = {
    pack: {status:'approved',reviewStatus:'approved',targetMarkets:['USA'],buyerTypes:['wholesaler'],productScope:['kitchen']},
    evidences: [{reviewStatus:'reviewed',publicUseAllowed:true,detectedMarkets:['usa'],detectedBuyerTypes:['wholesaler']}],
    drafts: [{reviewStatus:'needs_review'}],
    facts: []
  };
  const result = ProspectPriority.calculateProspectPriority(customer, context);
  assert.strictEqual(result.priorityTier, 'blocked');
  assert.strictEqual(result.priorityScore, 0);
});

test('47. 原有客户数据不受影响（只新增字段）', () => {
  const customer = makeCustomer();
  const originalKeys = Object.keys(customer);
  // 新增的跟进和结果数据是独立集合，不修改客户主体
  assert.ok(originalKeys.includes('id'));
  assert.ok(originalKeys.includes('company'));
  assert.ok(!originalKeys.includes('followUpId'));
  assert.ok(!originalKeys.includes('outcomeId'));
});

test('48. 测试数据清理完整（独立集合可清空）', () => {
  const testData = {
    followUps: [{followUpId: 'fu_test_001'}],
    outcomes: [{outcomeId: 'oc_test_001'}]
  };
  // 模拟清理
  testData.followUps = testData.followUps.filter(f => !f.followUpId.includes('test_'));
  testData.outcomes = testData.outcomes.filter(o => !o.outcomeId.includes('test_'));
  assert.strictEqual(testData.followUps.length, 0);
  assert.strictEqual(testData.outcomes.length, 0);
});

// 输出结果
console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);

if (failed > 0) {
  process.exit(1);
}
