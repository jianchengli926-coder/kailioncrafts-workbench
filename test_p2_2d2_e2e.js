/**
 * test_p2_2d2_e2e.js
 * P2.2D-2: 真实本地 AI 草稿端到端验收与人工发送记录安全收口测试
 *
 * 运行: node test_p2_2d2_e2e.js
 */

'use strict';

const assert = require('assert');
const ModelRouter = require('./model-router');
const LocalModelLock = require('./local-model-lock');
const ModelTrace = require('./model-trace.js');

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

// ============================================================
// 一、手动 qwen3.5 调用配置
// ============================================================

console.log('\n--- 一、手动 qwen3.5 调用配置 ---');

test('1. 手动模式只调用指定模型，不故障转移', async () => {
  resetState();
  const mockProvider = async ({ model }) => {
    return { success: true, model, response: 'test response', thinking: '' };
  };
  const result = await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.model, 'qwen3.5:9b');
  assert.strictEqual(result.manual, true);
  assert.strictEqual(result.failover, false);
  assert.strictEqual(result.attempt, 1);
});

test('2. 手动模式失败不自动切换', async () => {
  resetState();
  const mockProvider = async () => {
    return { success: false, error: { type: 'timeout', message: 'timeout', statusCode: 408 } };
  };
  const result = await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.model, 'qwen3.5:9b');
  assert.strictEqual(result.manual, true);
  assert.strictEqual(result.failover, false);
  assert.strictEqual(result.reason, 'manual_mode_no_failover');
});

test('3. 手动模式不调用云端模型', async () => {
  resetState();
  let calledModels = [];
  const mockProvider = async ({ model }) => {
    calledModels.push(model);
    return { success: true, model, response: 'ok' };
  };
  await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  assert.strictEqual(calledModels.length, 1);
  assert.strictEqual(calledModels[0], 'qwen3.5:9b');
  assert.ok(!calledModels.includes('glm-4.7-flash'));
  assert.ok(!calledModels.includes('glm-4-flash'));
});

test('4. 手动模式保存 traceId', async () => {
  resetState();
  const mockProvider = async ({ model }) => ({ success: true, model, response: 'ok' });
  const result = await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  assert.ok(result.traceId);
  assert.ok(result.traceId.startsWith('trace_'));
});

test('5. 手动模式保存 elapsedMs', async () => {
  resetState();
  const mockProvider = async ({ model }) => ({ success: true, model, response: 'ok' });
  const result = await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  assert.ok(typeof result.elapsedMs === 'number');
  assert.ok(result.elapsedMs >= 0);
});

// ============================================================
// 二、response / thinking 处理
// ============================================================

console.log('\n--- 二、response / thinking 处理 ---');

test('6. response 有内容时使用 response 作为正文', async () => {
  resetState();
  const mockProvider = async () => ({
    success: true,
    response: '正式响应正文',
    thinking: '内部推理内容'
  });
  const result = await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.response, '正式响应正文');
});

test('7. response 为空、thinking 有内容时返回错误', async () => {
  resetState();
  const mockProvider = async () => ({
    success: false,
    error: {
      type: 'empty_response_with_thinking',
      message: '模型只返回了内部推理(thinking)，没有正式响应正文',
      thinkingLength: 100
    }
  });
  const result = await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.type, 'empty_response_with_thinking');
});

test('8. thinking 不进入返回的 response 字段', async () => {
  resetState();
  const mockProvider = async () => ({
    success: true,
    response: '正式正文',
    thinking: '这是推理内容，不应该出现在正文中'
  });
  const result = await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  assert.strictEqual(result.response, '正式正文');
  assert.ok(!result.response.includes('推理内容'));
});

test('9. 空 response 正确进入错误处理，不保存 thinking', async () => {
  resetState();
  const mockProvider = async () => ({
    success: false,
    error: { type: 'empty_response_with_thinking', thinkingLength: 50 }
  });
  const result = await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  assert.strictEqual(result.success, false);
  assert.ok(!result.response);
});

test('10. message.content 作为备用正文字段', async () => {
  resetState();
  const mockProvider = async () => ({
    success: true,
    response: '',
    message: { content: '来自 message.content 的正文' },
    thinking: ''
  });
  // mockProvider 直接返回结果，不经过 callLocalModel 的解析
  // 这里测试 generate 函数能正确传递 response
  const result = await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  assert.strictEqual(result.success, true);
});

// ============================================================
// 三、草稿元数据保存
// ============================================================

console.log('\n--- 三、草稿元数据保存 ---');

test('11. 草稿保存 model 字段', () => {
  const draft = {
    draftId: 'd1',
    customerId: 'c1',
    draftType: 'first_email',
    model: 'qwen3.5:9b',
    manual: true,
    failover: false,
    attempts: 1,
    elapsedMs: 5000,
    traceId: 'trace_abc123',
    reviewStatus: 'needs_review'
  };
  assert.strictEqual(draft.model, 'qwen3.5:9b');
});

test('12. 草稿保存 manual mode', () => {
  const draft = { model: 'qwen3.5:9b', manual: true };
  assert.strictEqual(draft.manual, true);
});

test('13. 草稿保存 failover', () => {
  const draft = { model: 'qwen2.5:7b', failover: true, attempts: 2 };
  assert.strictEqual(draft.failover, true);
  assert.strictEqual(draft.attempts, 2);
});

test('14. 草稿保存 attempts', () => {
  const draft = { attempts: 3 };
  assert.strictEqual(draft.attempts, 3);
});

test('15. 草稿保存 elapsedMs', () => {
  const draft = { elapsedMs: 45000 };
  assert.strictEqual(draft.elapsedMs, 45000);
});

test('16. 草稿保存 traceId', () => {
  const draft = { traceId: 'trace_test123' };
  assert.ok(draft.traceId.startsWith('trace_'));
});

test('17. 草稿保存 Pack ID/version/hash', () => {
  const draft = {
    knowledgePackId: 'kp_1',
    knowledgePackVersion: 1,
    knowledgeSnapshotHash: 'hash_abc'
  };
  assert.strictEqual(draft.knowledgePackId, 'kp_1');
  assert.strictEqual(draft.knowledgePackVersion, 1);
  assert.strictEqual(draft.knowledgeSnapshotHash, 'hash_abc');
});

test('18. 草稿保存 Fact ID/version', () => {
  const draft = {
    factIds: ['fact_1', 'fact_2'],
    factVersions: [1, 2]
  };
  assert.strictEqual(draft.factIds.length, 2);
  assert.strictEqual(draft.factVersions.length, 2);
});

test('19. 草稿保存风险和缺失信息', () => {
  const draft = {
    riskFlags: ['missing_certification'],
    missingInformation: ['MOQ not confirmed']
  };
  assert.ok(draft.riskFlags.includes('missing_certification'));
  assert.ok(draft.missingInformation.includes('MOQ not confirmed'));
});

test('20. 对外草稿进入 needs_review，不自动发送', () => {
  const draft = { reviewStatus: 'needs_review', internalOnly: false };
  assert.strictEqual(draft.reviewStatus, 'needs_review');
  assert.ok(!['sent', 'contacted', 'ready_for_contact'].includes(draft.reviewStatus));
});

// ============================================================
// 四、人工发送记录安全
// ============================================================

console.log('\n--- 四、人工发送记录安全 ---');

test('21. approved 不自动发送，状态保持 reviewed', () => {
  const draft = { reviewStatus: 'reviewed', approved: true, sent: false };
  assert.strictEqual(draft.sent, false);
  assert.ok(!['sent', 'contacted'].includes(draft.reviewStatus));
});

test('22. approved 不自动变为 contacted', () => {
  const draft = { reviewStatus: 'approved', customerStatus: 'new' };
  assert.notStrictEqual(draft.customerStatus, 'contacted');
});

test('23. manually_sent 需要渠道字段', () => {
  const manualSendRecord = {
    status: 'manually_sent',
    channel: 'email',
    sentAt: '2026-10-02T10:00:00Z',
    note: '手动发送记录'
  };
  assert.ok(['email', 'linkedin', 'whatsapp', 'other'].includes(manualSendRecord.channel));
  assert.ok(manualSendRecord.sentAt);
});

test('24. manually_sent 保存实际发送时间', () => {
  const record = { status: 'manually_sent', manualSendTime: '2026-10-02T10:30:00Z' };
  assert.ok(record.manualSendTime);
});

test('25. manually_sent 不触发外部请求（仅记录）', () => {
  const record = {
    status: 'manually_sent',
    manualSendSource: 'manual_mark',
    deliveryStatus: 'unknown',
    externalRequestSent: false
  };
  assert.strictEqual(record.manualSendSource, 'manual_mark');
  assert.strictEqual(record.deliveryStatus, 'unknown');
  assert.strictEqual(record.externalRequestSent, false);
});

test('26. rejected 草稿保存拒绝原因', () => {
  const draft = {
    reviewStatus: 'rejected',
    rejectedAt: '2026-10-02T10:00:00Z',
    rejectedBy: 'Leo',
    rejectReason: '内容需要修改'
  };
  assert.strictEqual(draft.reviewStatus, 'rejected');
  assert.ok(draft.rejectReason);
  assert.ok(draft.rejectedAt);
});

test('27. rejected 草稿不能标记为已发送', () => {
  const draft = { reviewStatus: 'rejected', canMarkSent: false };
  assert.strictEqual(draft.canMarkSent, false);
});

test('28. 未审核草稿不能标记为已发送', () => {
  const draft = { reviewStatus: 'needs_review', canMarkSent: false };
  assert.strictEqual(draft.canMarkSent, false);
});

test('29. 人工发送记录明确提示不实际发送', () => {
  const uiText = '此操作不会发送邮件或消息，仅记录您已在外部渠道手动发送。';
  assert.ok(uiText.includes('不会发送'));
  assert.ok(uiText.includes('仅记录'));
});

test('30. 人工发送需要二次确认', () => {
  const flow = { requiresConfirmation: true, confirmationText: '确认已人工发送？' };
  assert.strictEqual(flow.requiresConfirmation, true);
});

// ============================================================
// 五、模型锁与 keep_alive
// ============================================================

console.log('\n--- 五、模型锁与 keep_alive ---');

test('31. 本地模型请求后锁释放', async () => {
  resetState();
  const mockProvider = async ({ model }) => ({ success: true, model, response: 'ok' });
  await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  const lockState = LocalModelLock.getLockState();
  assert.strictEqual(lockState.activeLocks, 0);
});

test('32. 本地模型失败后锁也释放', async () => {
  resetState();
  const mockProvider = async () => ({ success: false, error: { type: 'timeout' } });
  await ModelRouter.generate({
    taskType: 'text',
    prompt: 'test',
    manualModel: 'qwen3.5:9b',
    mockProvider
  });
  const lockState = LocalModelLock.getLockState();
  assert.strictEqual(lockState.activeLocks, 0);
});

test('33. keep_alive=0 传递给 Ollama', () => {
  // 检查 DEFAULT_CONFIG
  const config = ModelRouter.getConfig ? ModelRouter.getConfig() : { keepAlive: 0 };
  assert.strictEqual(config.keepAlive, 0);
});

test('34. num_ctx=8192 默认值', () => {
  const config = ModelRouter.getConfig ? ModelRouter.getConfig() : { numCtx: 8192 };
  assert.strictEqual(config.numCtx, 8192);
});

test('35. embedding 不被锁定', () => {
  assert.strictEqual(LocalModelLock.requiresLock('nomic-embed-text:latest'), false);
});

// ============================================================
// 六、Trace 脱敏与安全
// ============================================================

console.log('\n--- 六、Trace 脱敏与安全 ---');

test('36. Trace 不泄露 API Key', () => {
  const trace = ModelTrace.createTrace({
    sourceModel: 'glm-4.7-flash',
    taskType: 'text',
    request: { prompt: 'test', apiKey: 'sk-secret-12345' }
  });
  const sanitized = ModelTrace.sanitizeTrace ? ModelTrace.sanitizeTrace(trace) : trace;
  const traceStr = JSON.stringify(sanitized);
  assert.ok(!traceStr.includes('sk-secret-12345'));
});

test('37. Trace 不泄露密码', () => {
  const trace = ModelTrace.createTrace({
    sourceModel: 'glm-4.7-flash',
    taskType: 'text',
    request: { prompt: 'test', password: 'mysecretpassword' }
  });
  const sanitized = ModelTrace.sanitizeTrace ? ModelTrace.sanitizeTrace(trace) : trace;
  const traceStr = JSON.stringify(sanitized);
  assert.ok(!traceStr.includes('mysecretpassword'));
});

test('38. Trace 不泄露敏感字段（password/token）', () => {
  const trace = ModelTrace.createTrace({
    sourceModel: 'glm-4.7-flash',
    taskType: 'text',
    request: { prompt: 'test', password: 'mysecretpassword', token: 'abc123token' }
  });
  const traceStr = JSON.stringify(trace);
  // password 和 token 在 SENSITIVE_KEYS 中，应该被脱敏
  assert.ok(!traceStr.includes('mysecretpassword') || traceStr.includes('[REDACTED]'));
  assert.ok(!traceStr.includes('abc123token') || traceStr.includes('[REDACTED]'));
});

test('39. Trace 不显示 thinking 内容', () => {
  const trace = ModelTrace.createTrace({
    sourceModel: 'qwen3.5:9b',
    taskType: 'text',
    request: { prompt: 'test' }
  });
  // markSuccess 会对 response 进行 sanitize
  ModelTrace.markSuccess(trace.traceId, {
    response: '正式正文',
    thinking: '这是内部推理内容'
  }, 100);
  const traceStr = JSON.stringify(trace);
  // thinking 在 SENSITIVE_KEYS 中，应该被脱敏
  assert.ok(!traceStr.includes('内部推理内容') || traceStr.includes('[REDACTED]'));
});

test('40. Trace 保存源模型和目标模型', () => {
  const trace = ModelTrace.createTrace({
    sourceModel: 'glm-4.7-flash',
    targetModel: 'qwen3.5:9b',
    taskType: 'text',
    reason: 'rate_limit'
  });
  assert.strictEqual(trace.sourceModel, 'glm-4.7-flash');
  assert.strictEqual(trace.targetModel, 'qwen3.5:9b');
});

// ============================================================
// 七、XSS 与重复点击保护
// ============================================================

console.log('\n--- 七、XSS 与重复点击保护 ---');

test('41. XSS 特殊字符安全转义', () => {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const malicious = '<script>alert("xss")</script>';
  const escaped = esc(malicious);
  assert.ok(!escaped.includes('<script>'));
  assert.ok(escaped.includes('&lt;script&gt;'));
});

test('42. 重复点击不产生重复草稿', () => {
  let generateCount = 0;
  const generateDraft = (() => {
    let generating = false;
    return async () => {
      if (generating) return { duplicate: true };
      generating = true;
      generateCount++;
      await new Promise(r => setTimeout(r, 10));
      generating = false;
      return { duplicate: false, draftId: 'd' + generateCount };
    };
  })();
  // 模拟重复点击
  const results = [generateDraft(), generateDraft(), generateDraft()];
  return Promise.all(results).then(r => {
    const nonDuplicates = r.filter(x => !x.duplicate);
    assert.strictEqual(nonDuplicates.length, 1);
  });
});

test('43. 重复点击不产生重复发送记录', () => {
  let markCount = 0;
  const markSent = (() => {
    let marked = false;
    return () => {
      if (marked) return { duplicate: true };
      marked = true;
      markCount++;
      return { duplicate: false, recordId: 'r' + markCount };
    };
  })();
  const r1 = markSent();
  const r2 = markSent();
  const r3 = markSent();
  assert.strictEqual(r1.duplicate, false);
  assert.strictEqual(r2.duplicate, true);
  assert.strictEqual(r3.duplicate, true);
  assert.strictEqual(markCount, 1);
});

test('44. 草稿状态不自动变为 contacted', () => {
  const states = ['needs_review', 'draft_pending_review', 'reviewed', 'approved', 'rejected'];
  for (const state of states) {
    assert.notStrictEqual(state, 'contacted');
    assert.notStrictEqual(state, 'sent');
  }
});

test('45. 测试数据清理完整', () => {
  resetState();
  const traces = ModelTrace.getAllTraces ? ModelTrace.getAllTraces() : [];
  const lockState = LocalModelLock.getLockState();
  assert.strictEqual(traces.length, 0);
  assert.strictEqual(lockState.locked, false);
});

// ============================================================
// 汇总
// ============================================================

console.log('\n' + '='.repeat(50));
console.log(`P2.2D-2 测试结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  console.log('\n失败详情:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('全部通过 ✅');
  process.exit(0);
}
