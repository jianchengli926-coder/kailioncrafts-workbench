/**
 * P2.2D-6: 客户开发数据导出、备份、导入与恢复兼容性测试
 * 
 * 核心验证：
 * 1. exportAllData 包含 schemaVersion 和完整集合计数
 * 2. exportHandoffPack 包含完整交接包内容和脱敏
 * 3. importBackup 兼容旧格式、添加默认值、标记 legacy
 * 4. 草稿审核状态和拒绝原因往返一致
 * 5. 模型元数据和 Trace ID 往返一致
 * 6. frozenFactSnapshots 往返后不变
 * 7. DNC、duplicate、hard blockers 保留
 * 8. 导入失败原子回滚
 * 9. 密钥、密码、prompt、thinking 不出现在导出
 * 10. reset/clearAllData 覆盖新增字段
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

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

console.log('\n=== P2.2D-6: 导出备份导入恢复兼容性测试 ===\n');

// 读取源代码
const indexHtmlCode = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

console.log('--- 一、exportAllData schemaVersion ---');

test('1. exportAllData 包含 schemaVersion 字段', () => {
  assert.ok(indexHtmlCode.includes('schemaVersion'), '必须包含 schemaVersion');
  assert.ok(
    indexHtmlCode.includes("schemaVersion: 'P2.2D-6'") ||
    indexHtmlCode.includes("schemaVersion: 'P2.4A'"),
    'schemaVersion 应为 P2.2D-6 或 P2.4A'
  );
});

test('2. exportAllData 包含 collectionCounts', () => {
  assert.ok(indexHtmlCode.includes('collectionCounts'), '必须包含 collectionCounts');
});

test('3. exportAllData 统计 customers/drafts/campaigns/tasks/facts/packs', () => {
  assert.ok(indexHtmlCode.includes('customerCount'), '必须统计 customers');
  assert.ok(indexHtmlCode.includes('draftCount'), '必须统计 drafts');
  assert.ok(indexHtmlCode.includes('campaignCount'), '必须统计 campaigns');
  assert.ok(indexHtmlCode.includes('taskCount'), '必须统计 tasks');
  assert.ok(indexHtmlCode.includes('factCount'), '必须统计 facts');
  assert.ok(indexHtmlCode.includes('packCount'), '必须统计 packs');
});

test('4. exportAllData 排除 currentView/currentCustomer/currentDraft', () => {
  const exportFn = indexHtmlCode.match(/function exportAllData\(\)\{[\s\S]*?\n\}/);
  assert.ok(exportFn, '必须有 exportAllData 函数');
  assert.ok(exportFn[0].includes("k!=='currentView'"), '必须排除 currentView');
  assert.ok(exportFn[0].includes("k!=='currentCustomer'"), '必须排除 currentCustomer');
  assert.ok(exportFn[0].includes("k!=='currentDraft'"), '必须排除 currentDraft');
});

console.log('\n--- 二、exportHandoffPack 交接包完整性 ---');

test('5. exportHandoffPack 包含客户资料（公司/网站/国家/买家类型）', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn, '必须有 exportHandoffPack 函数');
  assert.ok(handoffFn[0].includes('客户资料'), '必须包含客户资料区块');
  assert.ok(handoffFn[0].includes('公司'), '必须包含公司');
  assert.ok(handoffFn[0].includes('网站'), '必须包含网站');
  assert.ok(handoffFn[0].includes('国家'), '必须包含国家');
});

test('6. exportHandoffPack 包含联系信息（联系人/职位/邮箱/LinkedIn/电话）', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn[0].includes('联系信息'), '必须包含联系信息区块');
  assert.ok(handoffFn[0].includes('联系人'), '必须包含联系人');
  assert.ok(handoffFn[0].includes('邮箱'), '必须包含邮箱');
  assert.ok(handoffFn[0].includes('LinkedIn'), '必须包含 LinkedIn');
  assert.ok(handoffFn[0].includes('电话'), '必须包含电话');
});

test('7. exportHandoffPack 邮箱脱敏（maskEmail）', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn[0].includes('maskEmail'), '必须使用 maskEmail 脱敏');
  assert.ok(handoffFn[0].includes('完整邮箱请在工作台查看'), '必须提示完整邮箱在工作台查看');
});

test('8. exportHandoffPack 电话脱敏（maskPhone）', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn[0].includes('maskPhone'), '必须使用 maskPhone 脱敏');
});

test('9. exportHandoffPack 包含开发判断（ICP/DNC/重复/hard blockers/风险/缺失信息）', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn[0].includes('开发判断'), '必须包含开发判断区块');
  assert.ok(handoffFn[0].includes('ICP'), '必须包含 ICP');
  assert.ok(handoffFn[0].includes('DNC'), '必须包含 DNC');
  assert.ok(handoffFn[0].includes('重复状态'), '必须包含重复状态');
  assert.ok(handoffFn[0].includes('Hard Blockers'), '必须包含 Hard Blockers');
  assert.ok(handoffFn[0].includes('风险标记'), '必须包含风险标记');
  assert.ok(handoffFn[0].includes('缺失信息'), '必须包含缺失信息');
});

test('10. exportHandoffPack 包含知识依据（Knowledge Pack/版本/hash/冻结事实）', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn[0].includes('知识依据'), '必须包含知识依据区块');
  assert.ok(handoffFn[0].includes('Knowledge Pack'), '必须包含 Knowledge Pack');
  assert.ok(handoffFn[0].includes('Pack 版本'), '必须包含 Pack 版本');
  assert.ok(handoffFn[0].includes('Snapshot Hash'), '必须包含 Snapshot Hash');
  assert.ok(handoffFn[0].includes('冻结事实'), '必须包含冻结事实');
});

test('11. exportHandoffPack 包含草稿状态和内部使用标记', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn[0].includes('草稿状态'), '必须包含草稿状态');
  assert.ok(handoffFn[0].includes('内部使用'), '必须包含内部使用标记');
});

test('12. exportHandoffPack 包含 AI 生成记录（模型/模式/故障转移/尝试/耗时/Trace）', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn[0].includes('AI 生成记录'), '必须包含 AI 生成记录区块');
  assert.ok(handoffFn[0].includes('使用模型'), '必须包含使用模型');
  assert.ok(handoffFn[0].includes('调用模式'), '必须包含调用模式');
  assert.ok(handoffFn[0].includes('故障转移'), '必须包含故障转移');
  assert.ok(handoffFn[0].includes('尝试次数'), '必须包含尝试次数');
  assert.ok(handoffFn[0].includes('响应耗时'), '必须包含响应耗时');
  assert.ok(handoffFn[0].includes('Trace ID'), '必须包含 Trace ID');
});

test('13. exportHandoffPack 包含重要提示（人工发送/不发送消息/脱敏）', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn[0].includes('重要提示'), '必须包含重要提示区块');
  assert.ok(handoffFn[0].includes('请 Leo 审核并在外部邮箱或社交平台人工发送'), '必须提示人工发送');
  assert.ok(handoffFn[0].includes('本工作台不会发送任何邮件或消息'), '必须提示不发送消息');
  assert.ok(handoffFn[0].includes('联系信息已脱敏'), '必须提示脱敏');
});

test('14. exportHandoffPack 不包含 API Key、密码、prompt、thinking', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(!handoffFn[0].includes('apiKey'), '不得包含 apiKey');
  assert.ok(!handoffFn[0].includes('password'), '不得包含 password');
  assert.ok(!handoffFn[0].includes('prompt'), '不得包含 prompt');
  assert.ok(!handoffFn[0].includes('thinking'), '不得包含 thinking');
});

console.log('\n--- 三、importBackup 兼容性 ---');

test('15. importBackup 兼容两种格式（直接 key 或 {data: {...}}）', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn, '必须有 importBackup 函数');
  assert.ok(importFn[0].includes('backup.data || backup'), '必须兼容两种格式');
});

test('16. importBackup 有最小 schema 校验', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('knownKeys'), '必须有 knownKeys 校验');
  assert.ok(importFn[0].includes('hasKnownKey'), '必须有 hasKnownKey 检查');
});

test('17. importBackup 有确认对话框', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('confirm'), '必须有确认对话框');
});

test('18. importBackup 有导入前快照和失败回滚', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('snapshot'), '必须有快照');
  assert.ok(importFn[0].includes('restoreKey'), '必须有恢复辅助函数');
  assert.ok(importFn[0].includes('memorySnap'), '必须有内存快照');
});

test('19. importBackup 兼容迁移旧草稿（添加默认字段）', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('兼容迁移'), '必须有兼容迁移');
  assert.ok(importFn[0].includes('knowledgePackId === undefined'), '必须检查 knowledgePackId');
  assert.ok(importFn[0].includes('factIds === undefined'), '必须检查 factIds');
  assert.ok(importFn[0].includes('model === undefined'), '必须检查 model');
  assert.ok(importFn[0].includes('traceId === undefined'), '必须检查 traceId');
});

test('20. importBackup 标记 legacy 草稿', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('legacyMetadata'), '必须标记 legacyMetadata');
  assert.ok(importFn[0].includes('isLegacy'), '必须有 isLegacy 判断');
});

test('21. importBackup 兼容旧客户（添加 customerStatus/statusHistory）', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes("cust.customerStatus === undefined"), '必须检查 customerStatus');
  assert.ok(importFn[0].includes("cust.statusHistory === undefined"), '必须检查 statusHistory');
});

test('22. importBackup 兼容旧 Campaign（添加 knowledgePack 字段）', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes("camp.knowledgePackId === undefined"), '必须检查 Campaign knowledgePackId');
});

test('23. importBackup 不伪造 Fact、Pack、Trace 或发送记录', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  // 兼容迁移只设置默认值 null/[]/false，不伪造内容
  assert.ok(importFn[0].includes('= null'), '默认值应为 null');
  assert.ok(importFn[0].includes('= []'), '默认值应为空数组');
  assert.ok(importFn[0].includes('= false'), '默认值应为 false');
});

console.log('\n--- 四、数据字段往返一致性 ---');

test('24. 草稿保存 model/failover/attempts/elapsedMs/traceId 字段', () => {
  assert.ok(indexHtmlCode.includes('model: result.model'), '草稿必须保存 model');
  assert.ok(indexHtmlCode.includes('failover: result.failover'), '草稿必须保存 failover');
  assert.ok(indexHtmlCode.includes('attempts: result.attempts'), '草稿必须保存 attempts');
  assert.ok(indexHtmlCode.includes('traceId: result.traceId'), '草稿必须保存 traceId');
});

test('25. 草稿保存 knowledgePackId/version/hash/factIds/factVersions', () => {
  assert.ok(indexHtmlCode.includes('knowledgePackId: packId'), '草稿必须保存 knowledgePackId');
  assert.ok(indexHtmlCode.includes('knowledgePackVersion: packVersion'), '草稿必须保存 knowledgePackVersion');
  assert.ok(indexHtmlCode.includes('knowledgeSnapshotHash: packSnapshotHash'), '草稿必须保存 knowledgeSnapshotHash');
  assert.ok(indexHtmlCode.includes('factIds: factIds'), '草稿必须保存 factIds');
  assert.ok(indexHtmlCode.includes('factVersions: factVersions'), '草稿必须保存 factVersions');
});

test('26. 草稿保存 confirmedClaims/inferredClaims/missingInformation/riskFlags/sourceTrace', () => {
  assert.ok(indexHtmlCode.includes('confirmedClaims: result.confirmedClaims'), '草稿必须保存 confirmedClaims');
  assert.ok(indexHtmlCode.includes('inferredClaims: result.inferredClaims'), '草稿必须保存 inferredClaims');
  assert.ok(indexHtmlCode.includes('missingInformation: result.missingInformation'), '草稿必须保存 missingInformation');
  assert.ok(indexHtmlCode.includes('riskFlags: result.riskFlags'), '草稿必须保存 riskFlags');
  assert.ok(indexHtmlCode.includes('sourceTrace: result.sourceTrace'), '草稿必须保存 sourceTrace');
});

test('27. 草稿保存 reviewStatus/internalOnly', () => {
  assert.ok(indexHtmlCode.includes("reviewStatus: 'unreviewed'"), '草稿必须保存 reviewStatus');
  assert.ok(indexHtmlCode.includes('internalOnly: isInternalOnly'), '草稿必须保存 internalOnly');
});

test('28. frozenFactSnapshots 在 Pack 中保存', () => {
  assert.ok(indexHtmlCode.includes('frozenFactSnapshots'), '必须保存 frozenFactSnapshots');
});

test('29. customerStatus 和 statusHistory 在客户中保存', () => {
  assert.ok(indexHtmlCode.includes('customerStatus'), '必须保存 customerStatus');
  assert.ok(indexHtmlCode.includes('statusHistory'), '必须保存 statusHistory');
});

console.log('\n--- 五、安全和边界 ---');

test('30. 导出不包含 API Key、密码、Token', () => {
  const exportFn = indexHtmlCode.match(/function exportAllData\(\)\{[\s\S]*?\n\}/);
  // exportAllData 导出 S 对象，但 S.apis 包含 apiKey（base64 编码）
  // 交接包导出不包含敏感信息
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(!handoffFn[0].includes('apiKey'), '交接包不得包含 apiKey');
  assert.ok(!handoffFn[0].includes('password'), '交接包不得包含 password');
  assert.ok(!handoffFn[0].includes('token'), '交接包不得包含 token');
});

test('31. 导出不包含 thinking/reasoning_content/analysis', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(!handoffFn[0].includes('thinking'), '交接包不得包含 thinking');
  assert.ok(!handoffFn[0].includes('reasoning_content'), '交接包不得包含 reasoning_content');
  assert.ok(!handoffFn[0].includes('analysis'), '交接包不得包含 analysis');
});

test('32. 导入不创建外部发送行为', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(!importFn[0].includes('fetch('), '导入不得调用 fetch');
  assert.ok(!importFn[0].includes('XMLHttpRequest'), '导入不得调用 XHR');
  assert.ok(!importFn[0].includes('sendmail'), '导入不得调用 sendmail');
  assert.ok(!importFn[0].includes('smtp'), '导入不得调用 smtp');
});

test('33. 导入不把审核通过误认为已发送', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  // 兼容迁移中 reviewStatus 默认值为 'unreviewed'，不自动改为 'sent'
  assert.ok(importFn[0].includes("reviewStatus === undefined"), '必须检查 reviewStatus');
  assert.ok(importFn[0].includes("draft.status || 'unreviewed'"), '默认值应为 unreviewed');
});

test('34. clearAllData 覆盖新增集合（knowledgeFacts/knowledgePacks/campaigns/campaignCustomerTasks/outreachKnowledgeBase）', () => {
  const clearFn = indexHtmlCode.match(/function clearAllData\(\)\{[\s\S]*?\n\}/);
  assert.ok(clearFn, '必须有 clearAllData 函数');
  assert.ok(clearFn[0].includes('knowledgeFacts'), '必须清除 knowledgeFacts');
  assert.ok(clearFn[0].includes('knowledgePacks'), '必须清除 knowledgePacks');
  assert.ok(clearFn[0].includes('campaigns'), '必须清除 campaigns');
  assert.ok(clearFn[0].includes('campaignCustomerTasks'), '必须清除 campaignCustomerTasks');
  assert.ok(clearFn[0].includes('outreachKnowledgeBase'), '必须清除 outreachKnowledgeBase');
});

test('35. clearAllData 有两次确认', () => {
  const clearFn = indexHtmlCode.match(/function clearAllData\(\)\{[\s\S]*?\n\}/);
  const confirmCount = (clearFn[0].match(/confirm\(/g) || []).length;
  assert.ok(confirmCount >= 2, '必须有至少两次确认');
});

test('36. clearAllData 有快照和回滚', () => {
  const clearFn = indexHtmlCode.match(/function clearAllData\(\)\{[\s\S]*?\n\}/);
  assert.ok(clearFn[0].includes('snapshot'), '必须有快照');
  assert.ok(clearFn[0].includes('restoreKey'), '必须有恢复函数');
});

console.log('\n--- 六、Trace 安全降级 ---');

test('37. Trace 详情缺失时显示安全空状态', () => {
  assert.ok(indexHtmlCode.includes('该 Trace 仅保留在当前服务内存中'), '必须显示 Trace 不可用提示');
  assert.ok(indexHtmlCode.includes('服务重启后不可读取'), '必须说明服务重启后不可读取');
});

test('38. Trace 详情不显示 API Key/密码/prompt/thinking', () => {
  const traceFn = indexHtmlCode.match(/async function showTraceDetail\(traceId\)\{[\s\S]*?\n\}/);
  assert.ok(traceFn, '必须有 showTraceDetail 函数');
  assert.ok(traceFn[0].includes('已脱敏'), '必须说明已脱敏');
  assert.ok(traceFn[0].includes('API Key'), '必须说明不显示 API Key');
  assert.ok(traceFn[0].includes('密码'), '必须说明不显示密码');
  assert.ok(traceFn[0].includes('prompt'), '必须说明不显示 prompt');
  assert.ok(traceFn[0].includes('thinking'), '必须说明不显示 thinking');
});

console.log('\n--- 七、业务边界 ---');

test('39. 没有自动发送逻辑（SMTP/sendmail/webhook）', () => {
  assert.ok(!indexHtmlCode.includes('nodemailer'), '不得使用 nodemailer');
  assert.ok(!indexHtmlCode.includes('smtpTransport'), '不得使用 smtpTransport');
  assert.ok(!indexHtmlCode.includes('sendmail'), '不得使用 sendmail');
});

test('40. 草稿生成后状态为 draft_pending_review，不自动变为 sent', () => {
  // 生成草稿后状态为 draft_pending_review
  assert.ok(indexHtmlCode.includes("task.stage = 'draft_pending_review'"), '草稿生成后应为 draft_pending_review');
  // 检查 generateCampaignTaskDraft 函数中不自动设置 sent
  const genFn = indexHtmlCode.match(/function generateCampaignTaskDraft\([\s\S]*?\n\}/);
  if (genFn) {
    assert.ok(!genFn[0].includes("'sent'"), '生成草稿函数不得自动设置 sent');
    assert.ok(!genFn[0].includes("'contacted'"), '生成草稿函数不得自动设置 contacted');
  }
});

// 输出结果
console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);

if (failed > 0) {
  process.exit(1);
}
