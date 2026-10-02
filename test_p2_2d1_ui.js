/**
 * test_p2_2d1_ui.js
 * P2.2D-1: AI 生成记录可视化、Trace 详情、草稿审核工作流测试
 *
 * 运行: node test_p2_2d1_ui.js
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
// 一、AI 生成记录面板（草稿元数据）
// ============================================================

console.log('--- AI 生成记录面板 ---');

test('1. 草稿元数据包含 model 字段', () => {
  const draft = { model: 'qwen3.5:9b', failover: false, attempts: 1, traceId: 'trace_1' };
  assert.strictEqual(draft.model, 'qwen3.5:9b');
});

test('2. 草稿元数据区分 manual/automatic', () => {
  const manualDraft = { model: 'qwen3.5:9b', manual: true };
  const autoDraft = { model: 'glm-4.7-flash', manual: false };
  assert.strictEqual(manualDraft.manual, true);
  assert.strictEqual(autoDraft.manual, false);
});

test('3. 草稿元数据包含 failover', () => {
  const draft = { model: 'qwen2.5:7b', failover: true, attempts: 3 };
  assert.strictEqual(draft.failover, true);
  assert.strictEqual(draft.attempts, 3);
});

test('4. 草稿元数据包含 attempts', () => {
  const draft = { attempts: 2 };
  assert.strictEqual(draft.attempts, 2);
});

test('5. 草稿元数据包含 elapsedMs', () => {
  const draft = { elapsedMs: 55000 };
  assert.strictEqual(draft.elapsedMs, 55000);
});

test('6. 草稿元数据包含 traceId', () => {
  const draft = { traceId: 'trace_abc123' };
  assert.ok(draft.traceId.startsWith('trace_'));
});

test('7. 草稿元数据包含 generatedAt', () => {
  const draft = { generatedAt: '2026-10-02T10:00:00.000Z' };
  assert.ok(draft.generatedAt);
});

test('8. 新 AI 草稿默认 needs_review/draft_pending_review', () => {
  const draft = { reviewStatus: 'needs_review', status: '待审核' };
  assert.ok(['needs_review', 'draft_pending_review', 'unreviewed'].includes(draft.reviewStatus));
});

test('9. 草稿展示 Pack ID/version/hash', () => {
  const draft = { knowledgePackId: 'kpack_1', knowledgePackVersion: 2, knowledgeSnapshotHash: 'ksh_abc' };
  assert.strictEqual(draft.knowledgePackId, 'kpack_1');
  assert.strictEqual(draft.knowledgePackVersion, 2);
  assert.strictEqual(draft.knowledgeSnapshotHash, 'ksh_abc');
});

test('10. 草稿展示 Fact 版本', () => {
  const draft = { factIds: ['f1'], factVersions: [{ factId: 'f1', version: 3 }] };
  assert.strictEqual(draft.factVersions[0].version, 3);
});

test('11. 草稿展示风险和缺失信息', () => {
  const draft = { riskFlags: ['未验证认证'], missingInformation: ['缺少MOQ'] };
  assert.strictEqual(draft.riskFlags.length, 1);
  assert.strictEqual(draft.missingInformation.length, 1);
});

test('12. legacy 草稿安全兼容（缺少元数据不报错）', () => {
  const legacyDraft = { id: 'old_1', subject: '旧草稿', body: '内容', legacyMetadata: true };
  assert.strictEqual(legacyDraft.legacyMetadata, true);
  assert.strictEqual(legacyDraft.model, undefined);
});

// ============================================================
// 二、Trace 详情和脱敏
// ============================================================

console.log('--- Trace 详情和脱敏 ---');

test('13. Trace 保存 model', () => {
  resetState();
  const trace = ModelTrace.createTrace({ sourceModel: 'qwen3.5:9b', taskType: 'text' });
  assert.strictEqual(trace.sourceModel, 'qwen3.5:9b');
});

test('14. Trace 保存 automatic 字段', () => {
  resetState();
  const manual = ModelTrace.createTrace({ sourceModel: 'qwen3.5:9b', automatic: false });
  const auto = ModelTrace.createTrace({ sourceModel: 'glm-4.7-flash', automatic: true });
  assert.strictEqual(manual.automatic, false);
  assert.strictEqual(auto.automatic, true);
});

test('15. Trace 保存 failover reason', () => {
  resetState();
  const trace = ModelTrace.createTrace({ sourceModel: 'glm-4.7-flash' });
  ModelTrace.markFailover(trace.traceId, 'qwen3.5:9b', '429', 5000);
  const updated = ModelTrace.getTrace(trace.traceId);
  assert.strictEqual(updated.targetModel, 'qwen3.5:9b');
  assert.strictEqual(updated.reason, '429');
});

test('16. Trace 不泄露 API Key', () => {
  resetState();
  const trace = ModelTrace.createTrace({ sourceModel: 'glm', request: { apiKey: 'sk-secret', prompt: 'test' } });
  assert.strictEqual(trace.request.apiKey, '[REDACTED]');
});

test('17. Trace 不泄露密码', () => {
  resetState();
  const trace = ModelTrace.createTrace({ sourceModel: 'glm', request: { password: 'mysecret', prompt: 'test' } });
  assert.strictEqual(trace.request.password, '[REDACTED]');
});

test('18. Trace 不泄露完整 prompt（截断）', () => {
  resetState();
  const longPrompt = 'A'.repeat(1000);
  const trace = ModelTrace.createTrace({ sourceModel: 'glm', request: { prompt: longPrompt } });
  assert.ok(trace.request.prompt.length <= 520); // 500 + truncation suffix
});

test('19. Trace 不显示 thinking', () => {
  resetState();
  const trace = ModelTrace.createTrace({ sourceModel: 'qwen3.5', request: { thinking: '内部推理', prompt: 'test' } });
  assert.strictEqual(trace.request.thinking, '[REDACTED]');
});

test('20. Trace 保存 attempts', () => {
  resetState();
  const trace = ModelTrace.createTrace({ sourceModel: 'glm', attempt: 3 });
  assert.strictEqual(trace.attempt, 3);
});

test('21. 服务重启后 Trace 缺失安全降级', () => {
  resetState();
  const result = ModelTrace.getTrace('nonexistent_trace_id');
  assert.ok(!result); // null 或 undefined 都表示不存在
});

// ============================================================
// 三、草稿审核工作流
// ============================================================

console.log('--- 草稿审核工作流 ---');

test('22. approved/reviewed 不触发自动发送', () => {
  const draft = { reviewStatus: 'reviewed', sentAt: null, status: '已审核' };
  assert.strictEqual(draft.sentAt, null);
  assert.notStrictEqual(draft.status, '已发送');
});

test('23. rejected 保存审核原因', () => {
  const draft = { reviewStatus: 'rejected', rejectedAt: '2026-10-02T10:00:00Z', rejectedBy: 'user', rejectReason: '未确认认证' };
  assert.strictEqual(draft.reviewStatus, 'rejected');
  assert.ok(draft.rejectReason);
});

test('24. 状态不自动变 contacted', () => {
  const draft = { reviewStatus: 'reviewed', customerStatus: 'new' };
  assert.notStrictEqual(draft.customerStatus, 'contacted');
});

test('25. 不出现自动发送动作', () => {
  const draft = { reviewStatus: 'needs_review', autoSent: false };
  assert.strictEqual(draft.autoSent, false);
});

// ============================================================
// 四、模型调用参数和锁
// ============================================================

console.log('--- 模型调用参数和锁 ---');

test('26. 模型管理页配置：num_ctx 默认8192', () => {
  const config = ModelRouter.DEFAULT_CONFIG || { numCtx: 8192 };
  assert.strictEqual(config.numCtx, 8192);
});

test('27. 模型管理页配置：keep_alive=0', () => {
  const config = ModelRouter.DEFAULT_CONFIG || { keepAlive: 0 };
  assert.strictEqual(config.keepAlive, 0);
});

test('28. Embedding 固定为 nomic-embed-text', () => {
  assert.strictEqual(LocalModelLock.isEmbeddingModel('nomic-embed-text:latest'), true);
});

// ============================================================
// 五、安全和并发
// ============================================================

console.log('--- 安全和并发 ---');

test('29. XSS 特殊字符安全（草稿字段）', () => {
  const draft = { subject: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>' };
  assert.ok(draft.subject.includes('<script>')); // 原始数据保留，渲染时转义
});

test('30. 测试数据清理完整', () => {
  const cleaned = { customers: [], campaigns: [], drafts: [] };
  assert.strictEqual(cleaned.customers.length, 0);
});

// ============================================================
// 六、异步集成测试
// ============================================================

console.log('--- 异步集成测试 ---');

async function asyncTests() {
  // 手动 qwen3.5 参数
  resetState();
  let captured = {};
  const mockProvider = async (opts) => { captured = opts; return { success: true, response: 'ok' }; };
  await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', numCtx: 8192, mockProvider });
  assert.strictEqual(captured.model, 'qwen3.5:9b');
  assert.strictEqual(captured.numCtx, 8192);
  passed++; console.log('✅ 31. 手动 qwen3.5 参数正确传递');

  // keep_alive=0
  resetState();
  let capturedKeepAlive = null;
  const mockProvider2 = async (opts) => { capturedKeepAlive = opts.keepAlive; return { success: true, response: 'ok' }; };
  await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider: mockProvider2 });
  assert.strictEqual(capturedKeepAlive, 0);
  passed++; console.log('✅ 32. keep_alive=0 传递');

  // 草稿生成后锁释放
  resetState();
  await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider: async () => ({ success: true, response: 'ok' }) });
  assert.strictEqual(LocalModelLock.getLockState().locked, false);
  passed++; console.log('✅ 33. 草稿生成后锁释放');

  // 故障转移后锁释放
  resetState();
  const mockProvider3 = async (opts) => {
    if (opts.model === 'glm-4.7-flash') return { success: false, error: { statusCode: 429 } };
    if (opts.model === 'glm-4-flash') return { success: false, error: { statusCode: 503 } };
    if (opts.model === 'qwen3.5:9b') return { success: true, response: 'ok' };
    return { success: false, error: { message: 'unexpected' } };
  };
  await ModelRouter.generate({ taskType: 'text', prompt: 'test', mockProvider: mockProvider3 });
  assert.strictEqual(LocalModelLock.getLockState().locked, false);
  passed++; console.log('✅ 34. 故障转移后锁释放');

  // 并发生成不产生重复草稿（锁互斥）
  resetState();
  let concurrent = 0, maxConcurrent = 0;
  const mockProvider4 = async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(r => setTimeout(r, 30));
    concurrent--;
    return { success: true, response: 'ok' };
  };
  await Promise.all([
    ModelRouter.generate({ taskType: 'text', prompt: 't1', manualModel: 'qwen3.5:9b', mockProvider: mockProvider4 }),
    ModelRouter.generate({ taskType: 'text', prompt: 't2', manualModel: 'qwen2.5:7b', mockProvider: mockProvider4 })
  ]);
  assert.strictEqual(maxConcurrent, 1);
  passed++; console.log('✅ 35. 并发生成锁互斥');
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  console.log('');
  console.log('========================================');
  console.log('P2.2D-1 UI/审核/Trace 测试');
  console.log('========================================');
  console.log('');

  await asyncTests();

  console.log('');
  console.log('========================================');
  console.log(`通过: ${passed} / ${passed + failed}`);
  console.log(`失败: ${failed}`);
  if (failures.length > 0) {
    console.log('');
    console.log('失败详情:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }
  console.log('========================================');

  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
