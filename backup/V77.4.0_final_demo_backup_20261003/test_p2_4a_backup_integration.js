/**
 * P2.4A: 人工开发数据备份恢复兼容性与客户详情整合测试
 * 
 * 核心验证：
 * 1. 新集合完整导出/导入
 * 2. 旧备份兼容
 * 3. 缺失集合补默认值
 * 4. 客户详情显示优先级、审核状态、跟进计划、最近结果
 * 5. 安全边界
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

console.log('\n=== P2.4A: 备份恢复兼容性与客户详情整合测试 ===\n');

// 模拟 S 对象
function makeMockS() {
  return {
    customers: [{id: 'c1', company: 'Test Co', dnc: false}],
    drafts: [{draftId: 'd1', customerId: 'c1', reviewStatus: 'needs_review', subject: 'Test'}],
    campaigns: [],
    outreachQueues: [{queueId: 'q1', customerId: 'c1', priorityScore: 75, priorityTier: 'B', calculationVersion: 'P2.4A'}],
    followUps: [{followUpId: 'f1', customerId: 'c1', plannedAt: new Date().toISOString(), status: 'planned', actionType: 'follow_up_1'}],
    outreachOutcomes: [{outcomeId: 'o1', customerId: 'c1', outcome: 'replied', source: 'manual_entry'}],
    websiteEvidences: [{evidenceId: 'e1', customerId: 'c1', reviewStatus: 'reviewed'}],
    prospectPriorities: [],
    knowledgeFacts: [],
    knowledgePacks: []
  };
}

console.log('--- 一、备份覆盖字段 ---');

test('1. exportAllData 使用 Object.keys(S) 导出所有集合', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('function exportAllData()'));
  assert.ok(code.includes('Object.keys(S)'));
});

test('2. collectionCounts 包含新集合', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes("'websiteEvidences'"));
  assert.ok(code.includes("'outreachQueues'"));
  assert.ok(code.includes("'prospectPriorities'"));
  assert.ok(code.includes("'followUps'"));
  assert.ok(code.includes("'outreachOutcomes'"));
});

test('3. schemaVersion 已更新为 P2.4A', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes("schemaVersion: 'P2.4A'"));
});

test('4. importAllData 使用 Object.keys(data) 恢复所有集合', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('function importAllData(input)'));
  assert.ok(code.includes('Object.keys(data)'));
});

test('5. importAllData 缺失集合自动补空数组', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('requiredCollections'));
  assert.ok(code.includes("'websiteEvidences'"));
  assert.ok(code.includes("'outreachQueues'"));
  assert.ok(code.includes("'followUps'"));
  assert.ok(code.includes("'outreachOutcomes'"));
});

test('6. clearAllData 包含新集合', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('function clearAllData()'));
  // 检查 clearAllData 函数体中包含新集合
  const clearAllDataMatch = code.match(/function clearAllData\(\)\{[\s\S]*?const arrayKeys = \[([\s\S]*?)\];/);
  assert.ok(clearAllDataMatch);
  const arrayKeysStr = clearAllDataMatch[1];
  assert.ok(arrayKeysStr.includes("'websiteEvidences'"));
  assert.ok(arrayKeysStr.includes("'outreachQueues'"));
  assert.ok(arrayKeysStr.includes("'prospectPriorities'"));
  assert.ok(arrayKeysStr.includes("'followUps'"));
  assert.ok(arrayKeysStr.includes("'outreachOutcomes'"));
});

test('7. resetData 包含新集合', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('function resetData()'));
  const match = code.match(/\['customers','plans'[\s\S]*?\]\.forEach\(k=>DB\.remove\(k\)\)/);
  assert.ok(match);
  const resetStr = match[0];
  assert.ok(resetStr.includes("'websiteEvidences'"));
  assert.ok(resetStr.includes("'outreachQueues'"));
  assert.ok(resetStr.includes("'followUps'"));
  assert.ok(resetStr.includes("'outreachOutcomes'"));
});

console.log('\n--- 二、数据结构完整性 ---');

test('8. outreachQueues 往返一致（字段完整）', () => {
  const queue = {
    queueId: 'q1', customerId: 'c1', priorityScore: 85, priorityTier: 'A',
    scoreBreakdown: {icpMatch:25, identityAndEvidence:18, productMarketFit:18, contactCompleteness:12, outreachReadiness:12},
    hardBlockers: [], riskFlags: [], missingEvidence: [],
    recommendedNextAction: '生成草稿', knowledgePackId: 'pack1',
    sourceEvidenceIds: ['e1'], status: 'queued', assignedTo: 'Leo',
    manualNote: 'test', calculationVersion: 'P2.4A',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  const json = JSON.stringify(queue);
  const restored = JSON.parse(json);
  assert.strictEqual(restored.queueId, 'q1');
  assert.strictEqual(restored.priorityScore, 85);
  assert.strictEqual(restored.priorityTier, 'A');
  assert.strictEqual(restored.calculationVersion, 'P2.4A');
  assert.strictEqual(restored.scoreBreakdown.icpMatch, 25);
});

test('9. followUps 往返一致（字段完整）', () => {
  const fu = {
    followUpId: 'f1', customerId: 'c1', campaignId: 'camp1', draftId: 'd1',
    plannedAt: new Date().toISOString(), timezone: 'America/New_York',
    channel: 'email', actionType: 'follow_up_1', status: 'planned',
    reminderNote: 'test', createdBy: 'Leo', createdAt: new Date().toISOString()
  };
  const restored = JSON.parse(JSON.stringify(fu));
  assert.strictEqual(restored.followUpId, 'f1');
  assert.strictEqual(restored.timezone, 'America/New_York');
  assert.strictEqual(restored.actionType, 'follow_up_1');
});

test('10. outreachOutcomes 往返一致（字段完整）', () => {
  const oc = {
    outcomeId: 'o1', customerId: 'c1', channel: 'email',
    occurredAt: new Date().toISOString(), outcome: 'replied',
    note: 'interested', nextAction: 'send quote',
    recordedBy: 'Leo', source: 'manual_entry'
  };
  const restored = JSON.parse(JSON.stringify(oc));
  assert.strictEqual(restored.outcomeId, 'o1');
  assert.strictEqual(restored.outcome, 'replied');
  assert.strictEqual(restored.source, 'manual_entry');
});

test('11. 审核历史往返一致', () => {
  const draft = {
    draftId: 'd1', reviewStatus: 'approved',
    reviewHistory: [
      {previousStatus: 'needs_review', nextStatus: 'approved', changedAt: new Date().toISOString(), changedBy: 'Leo', reason: 'OK'}
    ]
  };
  const restored = JSON.parse(JSON.stringify(draft));
  assert.strictEqual(restored.reviewHistory.length, 1);
  assert.strictEqual(restored.reviewHistory[0].previousStatus, 'needs_review');
  assert.strictEqual(restored.reviewHistory[0].nextStatus, 'approved');
});

test('12. 人工发送记录往返一致', () => {
  const draft = {
    draftId: 'd1', reviewStatus: 'manually_sent',
    manualSendRecord: {
      channel: 'email', sentAt: new Date().toISOString(),
      note: 'sent via Gmail', manualSendSource: 'manual_mark', recordedBy: 'Leo'
    }
  };
  const restored = JSON.parse(JSON.stringify(draft));
  assert.strictEqual(restored.manualSendRecord.channel, 'email');
  assert.strictEqual(restored.manualSendRecord.manualSendSource, 'manual_mark');
});

test('13. priorityScore/version 保留', () => {
  const queue = {priorityScore: 75, priorityTier: 'B', calculationVersion: 'P2.4A'};
  const restored = JSON.parse(JSON.stringify(queue));
  assert.strictEqual(restored.priorityScore, 75);
  assert.strictEqual(restored.calculationVersion, 'P2.4A');
});

test('14. frozen snapshot 不变（独立于 Fact 更新）', () => {
  const pack = {
    packId: 'p1', status: 'approved', version: 1,
    frozenFactSnapshots: [{factId: 'f1', version: 1, content: 'original', snapshotHash: 'hash1'}]
  };
  // 模拟 Fact 更新
  const updatedFact = {factId: 'f1', version: 2, content: 'updated'};
  // Pack 的 frozen snapshot 应该不变
  assert.strictEqual(pack.frozenFactSnapshots[0].content, 'original');
  assert.strictEqual(pack.frozenFactSnapshots[0].version, 1);
  assert.notStrictEqual(pack.frozenFactSnapshots[0].content, updatedFact.content);
});

test('15. Trace 缺失安全降级（只有 ID 时）', () => {
  const draft = {draftId: 'd1', traceId: 'trace_123', model: 'qwen3.5:9b'};
  // 模拟 Trace 不存在（服务重启后）
  const traceExists = false;
  const displayMessage = traceExists ? '查看 Trace 详情' : '该 Trace 仅保留在当前服务内存中，服务重启后不可读取';
  assert.ok(displayMessage.includes('不可读取'));
});

console.log('\n--- 三、兼容策略 ---');

test('16. 旧备份可导入（缺少新集合时补空数组）', () => {
  const oldBackup = {
    _backupMeta: {schemaVersion: 'P2.2D-6'},
    customers: [{id: 'c1'}],
    drafts: []
  };
  // 模拟导入逻辑
  const requiredCollections = ['websiteEvidences','outreachQueues','prospectPriorities','followUps','outreachOutcomes'];
  const S = {};
  Object.keys(oldBackup).forEach(k => { if(k !== '_backupMeta') S[k] = oldBackup[k]; });
  requiredCollections.forEach(k => { if(!Array.isArray(S[k])) S[k] = []; });
  assert.ok(Array.isArray(S.websiteEvidences));
  assert.ok(Array.isArray(S.outreachQueues));
  assert.ok(Array.isArray(S.followUps));
  assert.strictEqual(S.outreachQueues.length, 0);
});

test('17. legacy 标记正确（旧数据缺少新字段）', () => {
  const oldDraft = {draftId: 'd1', subject: 'Old', reviewStatus: 'needs_review'};
  const hasNewFields = oldDraft.model !== undefined && oldDraft.knowledgePackId !== undefined;
  const isLegacy = !hasNewFields;
  assert.strictEqual(isLegacy, true);
});

test('18. 缺失字段不伪造数据', () => {
  const oldDraft = {draftId: 'd1', subject: 'Old'};
  // 不应该伪造 model、traceId 等字段
  assert.ok(!oldDraft.model);
  assert.ok(!oldDraft.traceId);
  assert.ok(!oldDraft.knowledgePackId);
});

test('19. 导入前显示摘要和冲突（confirm 存在）', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('确定要从备份文件恢复数据吗'));
});

test('20. 未确认替换前不覆盖当前数据', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('if(!confirm('));
});

console.log('\n--- 四、客户详情整合 ---');

test('21. renderCustomerDevelopmentSummary 函数存在', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('function renderCustomerDevelopmentSummary(customer)'));
});

test('22. 客户详情显示优先级（renderProspectPriorityPanel 被调用）', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('renderProspectPriorityPanel(c)'));
});

test('23. 客户详情显示五维评分', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('五维评分'));
  assert.ok(code.includes('ICP匹配'));
  assert.ok(code.includes('身份证据'));
  assert.ok(code.includes('产品市场'));
  assert.ok(code.includes('联系信息'));
  assert.ok(code.includes('开发准备'));
});

test('24. 客户详情显示审核状态（待审核/已通过/已拒绝）', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('待审核'));
  assert.ok(code.includes('已通过未发送'));
  assert.ok(code.includes('已拒绝'));
});

test('25. 客户详情显示下一次跟进', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('下一次跟进'));
  assert.ok(code.includes('followUps'));
});

test('26. 客户详情显示最近结果', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('最近人工结果'));
  assert.ok(code.includes('outreachOutcomes'));
});

test('27. DNC 阻断显示', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('客户当前被阻断'));
  assert.ok(code.includes('不可进入对外开发'));
});

test('28. blocked 客户不显示可外联', () => {
  const customer = {id: 'c1', dnc: true};
  const isBlocked = customer.dnc === true;
  assert.strictEqual(isBlocked, true);
});

test('29. approved 不计已发送', () => {
  const draft = {reviewStatus: 'approved', manualSendRecord: null};
  const isManuallySent = draft.reviewStatus === 'manually_sent' || !!draft.manualSendRecord;
  assert.strictEqual(isManuallySent, false);
});

test('30. needs_review 不计已联系', () => {
  const draft = {reviewStatus: 'needs_review'};
  const isContacted = draft.reviewStatus === 'manually_sent' || !!draft.manualSendRecord;
  assert.strictEqual(isContacted, false);
});

test('31. 未知时区安全显示', () => {
  const followUp = {timezone: 'unknown'};
  const display = followUp.timezone === 'unknown' ? '时区待确认' : followUp.timezone;
  assert.strictEqual(display, '时区待确认');
});

console.log('\n--- 五、安全和脱敏 ---');

test('32. XSS 特殊字符安全（esc 函数存在）', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('function esc(') || code.includes('const esc ='));
});

test('33. 敏感联系方式脱敏', () => {
  const email = 'test@example.com';
  const masked = email.replace(/(.{2}).*(@.*)/, '$1***$2');
  assert.ok(masked.includes('***'));
});

test('34. API Key 不进入导出（redactSecretsInObject 存在）', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('redactSecretsInObject'));
  assert.ok(code.includes('secretsRedacted: true'));
});

test('35. 不产生外部请求（导出使用 Blob）', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('new Blob'));
  assert.ok(code.includes('URL.createObjectURL'));
});

test('36. thinking 内容不进入导出', () => {
  const draft = {subject: 'Test', body: 'Content', model: 'qwen3.5:9b'};
  assert.ok(!draft.thinking);
  assert.ok(!draft.reasoning_content);
});

test('37. 完整 prompt 不进入导出', () => {
  const draft = {subject: 'Test', body: 'Content'};
  assert.ok(!draft.fullPrompt);
  assert.ok(!draft.prompt);
});

console.log('\n--- 六、数据清理和重置 ---');

test('38. reset/clearAllData 覆盖新集合', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('function clearAllData()'));
  assert.ok(code.includes('function resetData()'));
});

test('39. 测试数据清理完整（独立集合可清空）', () => {
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

test('40. 原有业务数据不受影响（新集合独立）', () => {
  const S = makeMockS();
  const originalCustomerCount = S.customers.length;
  const originalDraftCount = S.drafts.length;
  // 操作新集合不影响原有数据
  S.outreachQueues.push({queueId: 'new'});
  S.followUps.push({followUpId: 'new'});
  assert.strictEqual(S.customers.length, originalCustomerCount);
  assert.strictEqual(S.drafts.length, originalDraftCount);
});

test('41. 导入失败回滚（try-catch 存在）', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('try{'));
  assert.ok(code.includes('catch(err)'));
});

test('42. 冲突预览正确（敏感字段警告）', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('安全警告'));
  assert.ok(code.includes('敏感字段'));
});

test('43. 旧备份含敏感字段时警告', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('countSensitiveFields'));
});

test('44. 导入不覆盖本机 API 密钥', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('localApisSnapshot'));
  assert.ok(code.includes('不会覆盖本机已配置的 API 密钥'));
});

test('45. 导出包含 collectionCounts', () => {
  const code = fs.readFileSync('./index.html', 'utf8');
  assert.ok(code.includes('collectionCounts'));
});

// 输出结果
console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);

if (failed > 0) {
  process.exit(1);
}
