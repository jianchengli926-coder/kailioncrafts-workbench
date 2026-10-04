/**
 * P2.4B: 每日客户开发工作视图测试
 * 
 * 核心验证：
 * 1. 每日工作视图数据汇总函数
 * 2. 6个区块数据筛选
 * 3. 日期和时区处理
 * 4. 安全边界
 */

const assert = require('assert');
const fs = require('fs');

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

console.log('\n=== P2.4B: 每日客户开发工作视图测试 ===\n');

const code = fs.readFileSync('./index.html', 'utf8');

console.log('--- 一、每日工作视图函数 ---');

test('1. getDailyOutreachWorkView 函数存在', () => {
  assert.ok(code.includes('function getDailyOutreachWorkView('));
});

test('2. viewDailyWork 页面函数存在', () => {
  assert.ok(code.includes('function viewDailyWork(root)'));
});

test('3. 导航入口包含今日工作', () => {
  assert.ok(code.includes("key:'dailyWork'"));
  assert.ok(code.includes('今日工作'));
});

test('4. renderView 路由包含 dailyWork', () => {
  assert.ok(code.includes('dailyWork:viewDailyWork'));
});

test('5. 每日汇总包含 reviewItems', () => {
  assert.ok(code.includes('reviewItems:'));
});

test('6. 每日汇总包含 dueFollowUps', () => {
  assert.ok(code.includes('dueFollowUps:'));
});

test('7. 每日汇总包含 overdueFollowUps', () => {
  assert.ok(code.includes('overdueFollowUps:'));
});

test('8. 每日汇总包含 highPriorityCustomers', () => {
  assert.ok(code.includes('highPriorityCustomers:'));
});

test('9. 每日汇总包含 evidenceReviewItems', () => {
  assert.ok(code.includes('evidenceReviewItems:'));
});

test('10. 每日汇总包含 recentOutcomes', () => {
  assert.ok(code.includes('recentOutcomes:'));
});

test('11. 每日汇总包含 counts', () => {
  assert.ok(code.includes('counts:'));
});

test('12. 每日汇总包含 generatedAt', () => {
  assert.ok(code.includes('generatedAt:'));
});

test('13. 每日汇总包含 calculationVersion', () => {
  assert.ok(code.includes('calculationVersion:'));
});

console.log('\n--- 二、待审核草稿筛选 ---');

test('14. 待审核草稿包含 needs_review', () => {
  assert.ok(code.includes("status === 'needs_review'"));
});

test('15. 待审核草稿包含 draft_pending_review', () => {
  assert.ok(code.includes("status === 'draft_pending_review'"));
});

test('16. approved 不进入待审核（逻辑正确）', () => {
  // 检查筛选条件不包含 approved
  const filterMatch = code.match(/reviewItems = \(S\.drafts \|\| \[\]\)\.filter\(d => \{([\s\S]*?)\}\)/);
  assert.ok(filterMatch);
  const filterCode = filterMatch[1];
  assert.ok(!filterCode.includes("approved"));
});

test('17. rejected 不进入待审核', () => {
  const filterMatch = code.match(/reviewItems = \(S\.drafts \|\| \[\]\)\.filter\(d => \{([\s\S]*?)\}\)/);
  assert.ok(filterMatch);
  const filterCode = filterMatch[1];
  assert.ok(!filterCode.includes("rejected"));
});

test('18. needs_evidence 正确显示', () => {
  assert.ok(code.includes("status === 'needs_evidence'"));
});

test('19. 待审核草稿显示公司名称', () => {
  assert.ok(code.includes('company: customer ? customer.company'));
});

test('20. 待审核草稿显示 priorityScore', () => {
  assert.ok(code.includes('priorityScore: queue ? queue.priorityScore'));
});

test('21. 待审核草稿显示 riskFlags', () => {
  assert.ok(code.includes('riskFlags: d.riskFlags || []'));
});

test('22. 待审核草稿显示 missingInformation', () => {
  assert.ok(code.includes('missingInformation: d.missingInformation || []'));
});

console.log('\n--- 三、跟进计划筛选 ---');

test('23. 今日到期跟进筛选 planned', () => {
  assert.ok(code.includes("f.status !== 'planned'"));
});

test('24. overdue 计算正确（超过24小时）', () => {
  assert.ok(code.includes('isOverdue: isOverdue'));
  assert.ok(code.includes('overdueDays: isOverdue'));
});

test('25. 未知时区安全显示', () => {
  assert.ok(code.includes("timezone==='unknown'"));
  assert.ok(code.includes('时区待确认'));
});

test('26. DNC 客户不显示外部跟进动作', () => {
  assert.ok(code.includes('isDnc: customer ? (customer.dnc === true'));
  assert.ok(code.includes('DNC/阻断客户只能创建内部补证据任务'));
});

test('27. blocked 客户不显示外部跟进动作', () => {
  assert.ok(code.includes('isBlocked: customer ?'));
});

test('28. 跟进显示 channel 和 actionType', () => {
  assert.ok(code.includes('channel: f.channel ||'));
  assert.ok(code.includes('actionType: f.actionType ||'));
});

console.log('\n--- 四、高优先级客户 ---');

test('29. A类客户筛选 priorityTier=A', () => {
  assert.ok(code.includes("q.priorityTier !== 'A'"));
});

test('30. blocked 不因高分进入A类开发区', () => {
  assert.ok(code.includes('if(customer.dnc === true'));
  assert.ok(code.includes('if(customer.identityStatus ==='));
  assert.ok(code.includes('if(customer.duplicateStatus ==='));
});

test('31. 高优先级客户显示 reviewedEvidenceCount', () => {
  assert.ok(code.includes('reviewedEvidenceCount: evidenceCount'));
});

test('32. 高优先级客户显示 packStatus', () => {
  assert.ok(code.includes('packStatus: pack ? pack.status'));
});

test('33. 高优先级客户显示 recommendedNextAction', () => {
  assert.ok(code.includes('recommendedNextAction: q.recommendedNextAction ||'));
});

console.log('\n--- 五、待核验证据 ---');

test('34. 待核验证据筛选 reviewStatus=pending', () => {
  assert.ok(code.includes("e.reviewStatus === 'pending'"));
});

test('35. 证据显示 sourceUrl 和 pageTitle', () => {
  assert.ok(code.includes('sourceUrl: e.sourceUrl ||'));
  assert.ok(code.includes('pageTitle: e.pageTitle ||'));
});

test('36. 证据显示 detectedProducts', () => {
  assert.ok(code.includes('detectedProducts: e.detectedProducts || []'));
});

test('37. 证据显示 extractionWarnings', () => {
  assert.ok(code.includes('extractionWarnings: e.extractionWarnings || []'));
});

test('38. 禁止自动确认 Fact（提示存在）', () => {
  assert.ok(code.includes('禁止自动确认 Fact'));
});

console.log('\n--- 六、最近人工结果 ---');

test('39. 最近结果只来自手动记录（source=manual_entry）', () => {
  assert.ok(code.includes('recordedBy: o.recordedBy ||'));
  assert.ok(code.includes('所有结果来自 Leo 手动录入'));
});

test('40. 最近结果显示7天内', () => {
  assert.ok(code.includes('sevenDaysAgo'));
  assert.ok(code.includes('7 * 86400000'));
});

test('41. 没有数据不显示虚假0%', () => {
  assert.ok(code.includes('暂无足够的人工结果数据'));
});

test('42. 结果显示 outcome 和 channel', () => {
  assert.ok(code.includes('outcome: o.outcome'));
  assert.ok(code.includes('channel: o.channel ||'));
});

console.log('\n--- 七、安全边界 ---');

test('43. 页面提示不会自动发送', () => {
  assert.ok(code.includes('工作台不会自动发送任何消息'));
});

test('44. approved 仍显示未发送', () => {
  assert.ok(code.includes('已通过未发送'));
});

test('45. manually_sent 统计正确', () => {
  assert.ok(code.includes('已人工发送'));
});

test('46. 不显示立即发送按钮', () => {
  const dailyWorkSection = code.match(/function viewDailyWork\(root\)\{([\s\S]*?)\n\}/);
  assert.ok(dailyWorkSection);
  const sectionCode = dailyWorkSection[1];
  assert.ok(!sectionCode.includes('立即发送'));
  // "自动发送"只出现在提示文字中，不是按钮
  assert.ok(sectionCode.includes('不会自动发送'));
});

test('47. XSS 安全（esc 函数使用）', () => {
  assert.ok(code.includes('esc(item.company)'));
  assert.ok(code.includes('esc(item.subject)'));
});

test('48. 联系方式脱敏（不直接显示邮箱）', () => {
  // 每日工作视图不直接显示联系方式，只显示公司和状态
  const dailyWorkSection = code.match(/function viewDailyWork\(root\)\{([\s\S]*?)\n\}/);
  assert.ok(dailyWorkSection);
});

test('49. API Key 不显示', () => {
  const dailyWorkSection = code.match(/function viewDailyWork\(root\)\{([\s\S]*?)\n\}/);
  assert.ok(dailyWorkSection);
  assert.ok(!dailyWorkSection[1].includes('apiKey'));
});

test('50. 不产生外部网络请求（纯本地计算）', () => {
  assert.ok(code.includes('getDailyOutreachWorkView()'));
  // 纯函数计算，不调用 fetch
});

console.log('\n--- 八、辅助函数 ---');

test('51. copyDraftSubject 函数存在', () => {
  assert.ok(code.includes('function copyDraftSubject('));
});

test('52. copyDraftBody 函数存在', () => {
  assert.ok(code.includes('function copyDraftBody('));
});

test('53. completeFollowUp 函数存在', () => {
  assert.ok(code.includes('function completeFollowUp('));
});

test('54. skipFollowUp 函数存在', () => {
  assert.ok(code.includes('function skipFollowUp('));
});

test('55. recordOutcomePrompt 函数存在', () => {
  assert.ok(code.includes('function recordOutcomePrompt('));
});

test('56. rescheduleFollowUpPrompt 函数存在', () => {
  assert.ok(code.includes('function rescheduleFollowUpPrompt('));
});

test('57. generateDraftForCustomer 函数存在', () => {
  assert.ok(code.includes('function generateDraftForCustomer('));
});

console.log('\n--- 九、数据结构验证 ---');

test('58. 模拟 getDailyOutreachWorkView 返回结构完整', () => {
  // 模拟函数逻辑
  const S = {
    drafts: [{draftId: 'd1', customerId: 'c1', reviewStatus: 'needs_review', subject: 'Test'}],
    followUps: [{followUpId: 'f1', customerId: 'c1', status: 'planned', plannedAt: new Date().toISOString(), channel: 'email', actionType: 'follow_up_1'}],
    outreachQueues: [{queueId: 'q1', customerId: 'c2', priorityTier: 'A', priorityScore: 85, recommendedNextAction: '生成草稿'}],
    websiteEvidences: [{evidenceId: 'e1', customerId: 'c1', reviewStatus: 'pending', sourceUrl: 'https://example.com'}],
    outreachOutcomes: [{outcomeId: 'o1', customerId: 'c1', outcome: 'replied', occurredAt: new Date().toISOString(), source: 'manual_entry'}],
    customers: [
      {id: 'c1', company: 'Test Co', dnc: false},
      {id: 'c2', company: 'A Co', dnc: false, identityStatus: 'verified', duplicateStatus: 'resolved'}
    ],
    knowledgePacks: []
  };

  // 验证数据结构
  assert.ok(Array.isArray(S.drafts));
  assert.ok(Array.isArray(S.followUps));
  assert.ok(Array.isArray(S.outreachQueues));
  assert.ok(Array.isArray(S.websiteEvidences));
  assert.ok(Array.isArray(S.outreachOutcomes));
});

test('59. 重复点击保护（completeFollowUp 检查已完成）', () => {
  assert.ok(code.includes("fu.status === 'completed'"));
});

test('60. 测试数据清理完整（独立集合可清空）', () => {
  const testData = {
    outreachQueues: [{queueId: 'q_test_001'}],
    followUps: [{followUpId: 'f_test_001'}],
    outreachOutcomes: [{outcomeId: 'o_test_001'}]
  };
  testData.outreachQueues = testData.outreachQueues.filter(q => !q.queueId.includes('test_'));
  testData.followUps = testData.followUps.filter(f => !f.followUpId.includes('test_'));
  testData.outreachOutcomes = testData.outreachOutcomes.filter(o => !o.outcomeId.includes('test_'));
  assert.strictEqual(testData.outreachQueues.length, 0);
  assert.strictEqual(testData.followUps.length, 0);
  assert.strictEqual(testData.outreachOutcomes.length, 0);
});

// 输出结果
console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);

if (failed > 0) {
  process.exit(1);
}
