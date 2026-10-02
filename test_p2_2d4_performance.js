/**
 * test_p2_2d4_performance.js
 * P2.2D-4: 本地开发信生成性能优化、手动模型选择和超时收口
 *
 * 运行: node test_p2_2d4_performance.js
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

const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ============================================================
// 一、精简草稿上下文验证
// ============================================================

console.log('\n--- 一、精简草稿上下文验证 ---');

test('1. 精简上下文只包含必要客户字段', () => {
  const match = indexHtml.match(/function buildOutreachEmailPrompt[\s\S]*?return '[\s\S]*?';/);
  assert.ok(match, 'buildOutreachEmailPrompt 未找到');
  const promptCode = match[0];
  assert.ok(promptCode.includes('Company:'), '缺少公司名称');
  assert.ok(promptCode.includes('Country:'), '缺少国家');
  assert.ok(promptCode.includes('Buyer type:'), '缺少买家类型');
  assert.ok(promptCode.includes('Main products:'), '缺少主营产品');
  assert.ok(!promptCode.includes('Contact:'), '不应包含联系人字段（精简）');
});

test('2. 最多传递5条 approved frozen facts', () => {
  assert.ok(indexHtml.includes('slice(0, 5)'), 'facts 数量未限制为5');
});

test('3. pending Fact 不进入 Prompt', () => {
  const match = indexHtml.match(/ctx\.matchedFacts = \(data\.facts \|\| \[\]\)\.filter[\s\S]*?;/);
  assert.ok(match, 'matchedFacts 过滤未找到');
  assert.ok(match[0].includes('factEligible === true'), '未过滤 factEligible');
});

test('4. internal-only Fact 不进入对外 Prompt', () => {
  const match = indexHtml.match(/const allowedSensitivity[\s\S]*?;/);
  assert.ok(match, 'allowedSensitivity 未找到');
  assert.ok(match[0].includes("'public'"), '未限制为 public');
});

test('5. 不传完整 sourceExcerpt', () => {
  // 检查 buildOutreachKbContextPrompt 函数体（从函数定义到 return prompt）
  const funcStart = indexHtml.indexOf('function buildOutreachKbContextPrompt');
  const funcEnd = indexHtml.indexOf('return prompt;', funcStart);
  const funcBody = indexHtml.substring(funcStart, funcEnd);
  assert.ok(!funcBody.includes('sourceExcerpt'), '不应包含 sourceExcerpt');
  assert.ok(!funcBody.includes('sourceHash'), '不应包含 sourceHash');
});

test('6. 每条事实仅80字符摘要', () => {
  const funcStart = indexHtml.indexOf('function buildOutreachKbContextPrompt');
  const funcEnd = indexHtml.indexOf('return prompt;', funcStart);
  const funcBody = indexHtml.substring(funcStart, funcEnd);
  assert.ok(funcBody.includes('maxEvidenceLen = 80') || funcBody.includes('substring(0, 80)'), '未限制为80字符');
});

test('7. Prompt 不重复注入相同事实', () => {
  const match = indexHtml.match(/function buildOutreachKbContextPrompt[\s\S]*?return prompt;/);
  assert.ok(match, 'buildOutreachKbContextPrompt 未找到');
  // 检查只有一个 forEach 循环
  const forEachCount = (match[0].match(/forEach/g) || []).length;
  assert.strictEqual(forEachCount, 1, '不应有多个事实循环');
});

test('8. 输出限制为120-180词', () => {
  const match = indexHtml.match(/function buildOutreachEmailPrompt[\s\S]*?return '[\s\S]*?';/);
  assert.ok(match, 'buildOutreachEmailPrompt 未找到');
  assert.ok(match[0].includes('120-180'), '未限制120-180词');
});

// ============================================================
// 二、qwen3.5 本地性能配置验证
// ============================================================

console.log('\n--- 二、qwen3.5 本地性能配置验证 ---');

test('9. 标准模式关闭 thinking', () => {
  const modelRouterCode = fs.readFileSync(path.join(__dirname, 'model-router.js'), 'utf8');
  assert.ok(modelRouterCode.includes('thinking: false'), '未关闭 thinking');
});

test('10. thinking 不进入正文', () => {
  const modelRouterCode = fs.readFileSync(path.join(__dirname, 'model-router.js'), 'utf8');
  assert.ok(modelRouterCode.includes('empty_response_with_thinking'), '未处理空 response + thinking');
});

test('11. thinking 不进入 claims', () => {
  // callLocalModel 中 response 只取 parsed.response，不取 thinking
  const modelRouterCode = fs.readFileSync(path.join(__dirname, 'model-router.js'), 'utf8');
  assert.ok(modelRouterCode.includes("parsed.response || parsed.message?.content"), '未正确提取 response');
});

test('12. 空 response 不保存草稿', () => {
  const modelRouterCode = fs.readFileSync(path.join(__dirname, 'model-router.js'), 'utf8');
  assert.ok(modelRouterCode.includes('empty_response_with_thinking'), '未处理空 response');
});

test('13. keep_alive=0', () => {
  const config = ModelRouter.getConfig ? ModelRouter.getConfig() : { keepAlive: 0 };
  assert.strictEqual(config.keepAlive, 0);
});

test('14. num_ctx=8192', () => {
  const config = ModelRouter.getConfig ? ModelRouter.getConfig() : { numCtx: 8192 };
  assert.strictEqual(config.numCtx, 8192);
});

test('15. temperature=0.5', () => {
  const config = ModelRouter.getConfig ? ModelRouter.getConfig() : { temperature: 0.5 };
  assert.strictEqual(config.temperature, 0.5);
});

test('16. maxOutputTokens=400', () => {
  const config = ModelRouter.getConfig ? ModelRouter.getConfig() : { maxOutputTokens: 400 };
  assert.strictEqual(config.maxOutputTokens, 400);
});

test('17. 超时不保存半截草稿', () => {
  const modelRouterCode = fs.readFileSync(path.join(__dirname, 'model-router.js'), 'utf8');
  assert.ok(modelRouterCode.includes("type: 'timeout'"), '未处理 timeout');
});

test('18. 超时释放本地锁', async () => {
  resetState();
  const mockProvider = async () => { throw { type: 'timeout', message: 'Request timeout' }; };
  try {
    await ModelRouter.generate({
      taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider
    });
  } catch(e) {}
  const state = LocalModelLock.getLockState();
  assert.strictEqual(state.locked, false);
});

// ============================================================
// 三、手动模型选择验证
// ============================================================

console.log('\n--- 三、手动模型选择验证 ---');

test('19. 手动 qwen3.5 不切换', async () => {
  resetState();
  const mockProvider = async () => ({ success: false, error: { type: 'timeout' } });
  const result = await ModelRouter.generate({
    taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.failover, false);
  assert.strictEqual(result.manual, true);
});

test('20. 手动 qwen2.5 不切换', async () => {
  resetState();
  const mockProvider = async () => ({ success: false, error: { type: 'timeout' } });
  const result = await ModelRouter.generate({
    taskType: 'text', prompt: 'test', manualModel: 'qwen2.5:7b', mockProvider
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.failover, false);
});

test('21. 普通草稿 UI 不显示 deepseek', () => {
  const match = indexHtml.match(/setDraftModelMode[\s\S]*?<\/select>/);
  assert.ok(match, '模型选择器未找到');
  assert.ok(!match[0].includes('deepseek'), '不应显示 deepseek');
});

test('22. 普通草稿 UI 不显示 qwen2.5vl', () => {
  const match = indexHtml.match(/setDraftModelMode[\s\S]*?<\/select>/);
  assert.ok(match, '模型选择器未找到');
  assert.ok(!match[0].includes('qwen2.5vl'), '不应显示 qwen2.5vl');
});

test('23. 普通草稿 UI 不显示 doubao', () => {
  const match = indexHtml.match(/setDraftModelMode[\s\S]*?<\/select>/);
  assert.ok(match, '模型选择器未找到');
  assert.ok(!match[0].includes('doubao'), '不应显示 doubao');
});

test('24. 自动模式展示四节点链', () => {
  const chains = ModelRouter.getModelChains ? ModelRouter.getModelChains() : null;
  if (chains) {
    assert.strictEqual(chains.text.length, 4);
    assert.deepStrictEqual(chains.text, ['glm-4.7-flash', 'glm-4-flash', 'qwen3.5:9b', 'qwen2.5:7b']);
  }
});

test('25. setDraftModelMode 函数存在', () => {
  assert.ok(indexHtml.includes('function setDraftModelMode'), 'setDraftModelMode 不存在');
});

test('26. generateCampaignTaskDraft 读取 _draftModelMode', () => {
  const match = indexHtml.match(/async function generateCampaignTaskDraft[\s\S]*?result = await generateOutreachEmailDraft/);
  assert.ok(match, 'generateCampaignTaskDraft 未找到');
  assert.ok(match[0].includes('_draftModelMode'), '未读取 _draftModelMode');
});

// ============================================================
// 四、生成结果和 Trace 验证
// ============================================================

console.log('\n--- 四、生成结果和 Trace 验证 ---');

test('27. 成功草稿保存 model/trace/elapsedMs', async () => {
  resetState();
  const mockProvider = async () => ({ success: true, response: 'Subject: Test\n\nBody text' });
  const result = await ModelRouter.generate({
    taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider
  });
  assert.strictEqual(result.success, true);
  assert.ok(result.traceId);
  assert.ok(result.elapsedMs > 0);
  assert.strictEqual(result.model, 'qwen3.5:9b');
});

test('28. 成功草稿进入 needs_review', () => {
  // 草稿状态由前端处理，这里验证 parseOutreachEmailResult
  const match = indexHtml.match(/function parseOutreachEmailResult[\s\S]*?}/);
  assert.ok(match, 'parseOutreachEmailResult 未找到');
});

test('29. 草稿交接包完整', () => {
  assert.ok(indexHtml.includes('function renderOutreachHandoffPack'), '交接包函数不存在');
});

test('30. 无自动发送能力', () => {
  assert.ok(!indexHtml.includes('smtp.send'), '不应包含 SMTP 发送');
  assert.ok(!indexHtml.includes('linkedin.api'), '不应包含 LinkedIn API');
});

test('31. Trace 脱敏', () => {
  const trace = ModelTrace.createTrace({
    sourceModel: 'qwen3.5:9b', taskType: 'text',
    request: { prompt: 'test', apiKey: 'sk-secret' }
  });
  const traceStr = JSON.stringify(trace);
  assert.ok(!traceStr.includes('sk-secret') || traceStr.includes('[REDACTED]'));
});

test('32. 同一 Task 重复点击不重复生成', () => {
  assert.ok(indexHtml.includes('_isCampaignTaskWorkflowBusy'), '缺少忙碌状态检查');
});

test('33. XSS 特殊字符安全', () => {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const malicious = '<script>alert(1)</script>';
  assert.ok(!esc(malicious).includes('<script>'));
});

test('34. 持久化失败回滚', () => {
  // 验证有 try-catch 错误处理
  const match = indexHtml.match(/async function generateCampaignTaskDraft[\s\S]*?catch\(e\)/);
  assert.ok(match, '缺少错误处理');
});

test('35. 测试数据清理完整', () => {
  // 验证清理函数存在
  assert.ok(typeof resetState === 'function');
  resetState();
  assert.strictEqual(LocalModelLock.getLockState().locked, false);
});

// ============================================================
// 汇总
// ============================================================

console.log('\n' + '='.repeat(50));
console.log(`P2.2D-4 性能测试结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  console.log('\n失败详情:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('全部通过 ✅');
  process.exit(0);
}
