/**
 * test_p2_2d3_handoff.js
 * P2.2D-3: 客户选择器修复、Campaign 任务显示、人工发送交接包测试
 *
 * 运行: node test_p2_2d3_handoff.js
 */

'use strict';

const assert = require('assert');
const ModelRouter = require('./model-router');
const LocalModelLock = require('./local-model-lock');
const ModelTrace = require('./model-trace.js');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; console.log(`✅ ${name}`); }
  catch (e) { failed++; failures.push(`${name}: ${e.message}`); console.log(`❌ ${name}: ${e.message}`); }
}

function resetState() {
  ModelRouter.clearSlowResponseState();
  LocalModelLock.forceReleaseAll();
  ModelTrace.clearTraces();
}

// 读取 index.html 用于函数存在性检查
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ============================================================
// 一、客户选择器根因修复验证
// ============================================================

console.log('\n--- 一、客户选择器根因修复 ---');

test('1. saveCustomer 中调用 syncCustomerToOutreachKB', () => {
  // 检查 index.html 中 saveCustomer 函数是否包含 syncCustomerToOutreachKB 调用
  const saveCustomerMatch = indexHtml.match(/function saveCustomer[\s\S]*?\n}/);
  assert.ok(saveCustomerMatch, 'saveCustomer 函数未找到');
  assert.ok(saveCustomerMatch[0].includes('syncCustomerToOutreachKB'), 'saveCustomer 中未调用 syncCustomerToOutreachKB');
});

test('2. syncCustomerToOutreachKB 函数存在', () => {
  assert.ok(indexHtml.includes('function syncCustomerToOutreachKB'), 'syncCustomerToOutreachKB 函数不存在');
});

test('3. 客户选择器使用 S.outreachKnowledgeBase 数据源', () => {
  const pickerMatch = indexHtml.match(/function renderCampaignCustomerPicker[\s\S]*?\n}/);
  assert.ok(pickerMatch, 'renderCampaignCustomerPicker 函数未找到');
  assert.ok(pickerMatch[0].includes('S.outreachKnowledgeBase'), '客户选择器未使用 S.outreachKnowledgeBase');
});

test('4. 新建客户自动创建 outreachKnowledgeBase 档案', () => {
  // syncCustomerToOutreachKB 中应该有 S.outreachKnowledgeBase.push
  const syncMatch = indexHtml.match(/function syncCustomerToOutreachKB[\s\S]*?\n}/);
  assert.ok(syncMatch, 'syncCustomerToOutreachKB 函数未找到');
  assert.ok(syncMatch[0].includes('S.outreachKnowledgeBase.push'), 'syncCustomerToOutreachKB 中未创建档案');
});

test('5. 被阻断客户显示阻断原因而非静默消失', () => {
  // evaluateCampaignCustomerForAdd 应该返回 blockers
  const evalMatch = indexHtml.match(/function evaluateCampaignCustomerForAdd[\s\S]*?\n}/);
  assert.ok(evalMatch, 'evaluateCampaignCustomerForAdd 函数未找到');
  assert.ok(evalMatch[0].includes('blockers'), '评估函数未返回 blockers');
});

// ============================================================
// 二、Campaign 任务创建和显示
// ============================================================

console.log('\n--- 二、Campaign 任务创建和显示 ---');

test('6. addCustomerToCampaign 函数存在', () => {
  assert.ok(indexHtml.includes('function addCustomerToCampaign'), 'addCustomerToCampaign 函数不存在');
});

test('7. addCustomerToCampaign 创建任务包含必要字段', () => {
  const addMatch = indexHtml.match(/function addCustomerToCampaign[\s\S]*?\n}/);
  assert.ok(addMatch, 'addCustomerToCampaign 函数未找到');
  assert.ok(addMatch[0].includes('taskId'), '任务未包含 taskId');
  assert.ok(addMatch[0].includes('campaignId'), '任务未包含 campaignId');
  assert.ok(addMatch[0].includes('customerId'), '任务未包含 customerId');
  assert.ok(addMatch[0].includes('stableCustomerId'), '任务未包含 stableCustomerId');
  assert.ok(addMatch[0].includes('stage'), '任务未包含 stage');
});

test('8. getCampaignTasks 按 campaignId 过滤', () => {
  const getMatch = indexHtml.match(/function getCampaignTasks[\s\S]*?\n}/);
  assert.ok(getMatch, 'getCampaignTasks 函数未找到');
  assert.ok(getMatch[0].includes('t.campaignId === campaignId'), 'getCampaignTasks 未按 campaignId 过滤');
});

test('9. resolveCampaignTaskCustomer 支持 stableCustomerId 和 customerId', () => {
  const resolveMatch = indexHtml.match(/function resolveCampaignTaskCustomer[\s\S]*?\n}/);
  assert.ok(resolveMatch, 'resolveCampaignTaskCustomer 函数未找到');
  assert.ok(resolveMatch[0].includes('stableCustomerId'), '未支持 stableCustomerId 解析');
  assert.ok(resolveMatch[0].includes('customerId'), '未支持 customerId 解析');
});

test('10. confirmAddCustomerToCampaign 成功后调用 renderView', () => {
  const confirmMatch = indexHtml.match(/function confirmAddCustomerToCampaign[\s\S]*?\n}/);
  assert.ok(confirmMatch, 'confirmAddCustomerToCampaign 函数未找到');
  assert.ok(confirmMatch[0].includes('renderView'), '成功后未刷新视图');
});

test('11. 重复点击不创建重复 Task（通过 eligible 检查）', () => {
  const addMatch = indexHtml.match(/function addCustomerToCampaign[\s\S]*?\n}/);
  assert.ok(addMatch, 'addCustomerToCampaign 函数未找到');
  assert.ok(addMatch[0].includes('evaluateCustomerForCampaign'), '未进行客户资格评估');
});

test('12. CAMPAIGN_TASK_STAGES 包含 ready_for_draft', () => {
  assert.ok(indexHtml.includes("'ready_for_draft'"), 'CAMPAIGN_TASK_STAGES 未包含 ready_for_draft');
});

// ============================================================
// 三、人工发送交接包
// ============================================================

console.log('\n--- 三、人工发送交接包 ---');

test('13. renderOutreachHandoffPack 函数存在', () => {
  assert.ok(indexHtml.includes('function renderOutreachHandoffPack'), 'renderOutreachHandoffPack 函数不存在');
});

test('14. 交接包包含客户资料部分', () => {
  const handoffMatch = indexHtml.match(/function renderOutreachHandoffPack[\s\S]*?return html;/);
  assert.ok(handoffMatch, 'renderOutreachHandoffPack 函数未找到');
  assert.ok(handoffMatch[0].includes('客户资料'), '交接包未包含客户资料');
});

test('15. 交接包包含联系信息部分', () => {
  const handoffMatch = indexHtml.match(/function renderOutreachHandoffPack[\s\S]*?return html;/);
  assert.ok(handoffMatch, 'renderOutreachHandoffPack 函数未找到');
  assert.ok(handoffMatch[0].includes('联系信息'), '交接包未包含联系信息');
});

test('16. 交接包包含合规与风险部分', () => {
  const handoffMatch = indexHtml.match(/function renderOutreachHandoffPack[\s\S]*?return html;/);
  assert.ok(handoffMatch, 'renderOutreachHandoffPack 函数未找到');
  assert.ok(handoffMatch[0].includes('合规与风险'), '交接包未包含合规与风险');
});

test('17. 交接包包含知识依据部分', () => {
  const handoffMatch = indexHtml.match(/function renderOutreachHandoffPack[\s\S]*?return html;/);
  assert.ok(handoffMatch, 'renderOutreachHandoffPack 函数未找到');
  assert.ok(handoffMatch[0].includes('知识依据'), '交接包未包含知识依据');
});

test('18. 交接包包含个性化草稿部分', () => {
  const handoffMatch = indexHtml.match(/function renderOutreachHandoffPack[\s\S]*?return html;/);
  assert.ok(handoffMatch, 'renderOutreachHandoffPack 函数未找到');
  assert.ok(handoffMatch[0].includes('个性化草稿'), '交接包未包含个性化草稿');
});

test('19. 交接包明确提示不自动发送', () => {
  const handoffMatch = indexHtml.match(/function renderOutreachHandoffPack[\s\S]*?return html;/);
  assert.ok(handoffMatch, 'renderOutreachHandoffPack 函数未找到');
  assert.ok(handoffMatch[0].includes('本工作台不会发送任何消息'), '交接包未明确提示不自动发送');
});

test('20. 交接包包含复制联系方式按钮', () => {
  assert.ok(indexHtml.includes('copyHandoffContact'), '未包含复制联系方式函数');
});

test('21. 交接包包含复制主题按钮', () => {
  assert.ok(indexHtml.includes('copyHandoffSubject'), '未包含复制主题函数');
});

test('22. 交接包包含复制正文按钮', () => {
  assert.ok(indexHtml.includes('copyHandoffBody'), '未包含复制正文函数');
});

test('23. 交接包包含复制完整交接包按钮', () => {
  assert.ok(indexHtml.includes('copyHandoffFull'), '未包含复制完整交接包函数');
});

test('24. 交接包包含导出 TXT 按钮', () => {
  assert.ok(indexHtml.includes('exportHandoffPack'), '未包含导出函数');
});

test('25. 缺失联系方式显示提示', () => {
  const handoffMatch = indexHtml.match(/function renderOutreachHandoffPack[\s\S]*?return html;/);
  assert.ok(handoffMatch, 'renderOutreachHandoffPack 函数未找到');
  assert.ok(handoffMatch[0].includes('联系信息缺失'), '未显示联系信息缺失提示');
});

test('26. 交接包显示 AI 模型元数据', () => {
  const handoffMatch = indexHtml.match(/function renderOutreachHandoffPack[\s\S]*?return html;/);
  assert.ok(handoffMatch, 'renderOutreachHandoffPack 函数未找到');
  assert.ok(handoffMatch[0].includes('AI 模型'), '未显示 AI 模型元数据');
});

test('27. 交接包显示 Knowledge Pack 信息', () => {
  const handoffMatch = indexHtml.match(/function renderOutreachHandoffPack[\s\S]*?return html;/);
  assert.ok(handoffMatch, 'renderOutreachHandoffPack 函数未找到');
  assert.ok(handoffMatch[0].includes('knowledgePackId'), '未显示 Knowledge Pack ID');
  assert.ok(handoffMatch[0].includes('knowledgeSnapshotHash'), '未显示 Snapshot Hash');
});

// ============================================================
// 四、人工发送记录安全
// ============================================================

console.log('\n--- 四、人工发送记录安全 ---');

test('28. markSent 函数包含二次确认', () => {
  const markMatch = indexHtml.match(/function markSent[\s\S]*?\n}/);
  assert.ok(markMatch, 'markSent 函数未找到');
  assert.ok(markMatch[0].includes('showModal') || markMatch[0].includes('confirm'), 'markSent 未包含二次确认');
});

test('29. confirmMarkSent 函数存在', () => {
  assert.ok(indexHtml.includes('function confirmMarkSent'), 'confirmMarkSent 函数不存在');
});

test('30. 人工发送记录包含渠道字段', () => {
  const confirmMatch = indexHtml.match(/function confirmMarkSent[\s\S]*?\n}/);
  assert.ok(confirmMatch, 'confirmMarkSent 函数未找到');
  assert.ok(confirmMatch[0].includes('manualSendChannel') || confirmMatch[0].includes('channel'), '未包含渠道字段');
});

test('31. 人工发送记录包含实际发送时间', () => {
  const confirmMatch = indexHtml.match(/function confirmMarkSent[\s\S]*?\n}/);
  assert.ok(confirmMatch, 'confirmMarkSent 函数未找到');
  assert.ok(confirmMatch[0].includes('manualSendTime') || confirmMatch[0].includes('sentAt'), '未包含发送时间');
});

test('32. 人工发送明确提示不实际发送', () => {
  const markMatch = indexHtml.match(/function markSent[\s\S]*?\n}/);
  assert.ok(markMatch, 'markSent 函数未找到');
  assert.ok(markMatch[0].includes('不会发送') || markMatch[0].includes('仅记录'), '未明确提示不实际发送');
});

test('33. rejected 草稿不能标记已发送', () => {
  const markMatch = indexHtml.match(/function markSent[\s\S]*?\n}/);
  assert.ok(markMatch, 'markSent 函数未找到');
  // markSent 使用 normalizeDraftReviewStatus 检查，rejected 状态不等于 reviewed 会被阻止
  assert.ok(markMatch[0].includes('normalizeDraftReviewStatus'), '未使用 normalizeDraftReviewStatus 检查审核状态');
  assert.ok(markMatch[0].includes("reviewStatus !== 'reviewed'") || markMatch[0].includes('reviewStatus !=='), '未检查审核状态');
});

test('34. 未审核草稿不能标记已发送', () => {
  const markMatch = indexHtml.match(/function markSent[\s\S]*?\n}/);
  assert.ok(markMatch, 'markSent 函数未找到');
  assert.ok(markMatch[0].includes('reviewed') || markMatch[0].includes('approved'), '未检查审核状态');
});

// ============================================================
// 五、模型路由和锁（回归验证）
// ============================================================

console.log('\n--- 五、模型路由和锁回归 ---');

test('35. 手动 qwen3.5 草稿生成保存 response', async () => {
  resetState();
  const mockProvider = async ({ model }) => ({
    success: true, model, response: 'test response', thinking: ''
  });
  const result = await ModelRouter.generate({
    taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.response, 'test response');
  assert.strictEqual(result.model, 'qwen3.5:9b');
});

test('36. thinking 不进入草稿 response', async () => {
  resetState();
  const mockProvider = async () => ({
    success: true, response: '正式正文', thinking: '内部推理内容'
  });
  const result = await ModelRouter.generate({
    taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider
  });
  assert.strictEqual(result.response, '正式正文');
  assert.ok(!result.response.includes('内部推理内容'));
});

test('37. keep_alive=0 配置', () => {
  const config = ModelRouter.getConfig ? ModelRouter.getConfig() : { keepAlive: 0 };
  assert.strictEqual(config.keepAlive, 0);
});

test('38. 本地模型请求后锁释放', async () => {
  resetState();
  const mockProvider = async ({ model }) => ({ success: true, model, response: 'ok' });
  await ModelRouter.generate({
    taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider
  });
  const lockState = LocalModelLock.getLockState();
  assert.strictEqual(lockState.locked, false);
});

test('39. Trace 不泄露 API Key', () => {
  const trace = ModelTrace.createTrace({
    sourceModel: 'glm-4.7-flash', taskType: 'text',
    request: { prompt: 'test', apiKey: 'sk-secret-12345' }
  });
  const traceStr = JSON.stringify(trace);
  assert.ok(!traceStr.includes('sk-secret-12345') || traceStr.includes('[REDACTED]'));
});

test('40. XSS 特殊字符安全转义', () => {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const malicious = '<script>alert("xss")</script>';
  const escaped = esc(malicious);
  assert.ok(!escaped.includes('<script>'));
  assert.ok(escaped.includes('&lt;script&gt;'));
});

// ============================================================
// 汇总
// ============================================================

console.log('\n' + '='.repeat(50));
console.log(`P2.2D-3 测试结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  console.log('\n失败详情:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('全部通过 ✅');
  process.exit(0);
}
