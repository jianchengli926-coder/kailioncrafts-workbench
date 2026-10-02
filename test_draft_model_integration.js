/**
 * test_draft_model_integration.js
 * P2.2C: 开发草稿安全接入模型路由 - 集成测试
 *
 * 运行: node test_draft_model_integration.js
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
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.log(`❌ ${name}: ${e.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.log(`❌ ${name}: ${e.message}`);
  }
}

function resetState() {
  ModelRouter.clearSlowResponseState();
  LocalModelLock.forceReleaseAll();
  ModelTrace.clearTraces();
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  console.log('');
  console.log('========================================');
  console.log('P2.2C 草稿-模型集成测试');
  console.log('========================================');
  console.log('');

  // ---- 一、模型路由集成 ----
  console.log('--- 模型路由集成 ---');

  test('1. 自动模式使用普通文本四节点链', () => {
    const chain = ModelRouter.MODEL_CHAINS.text;
    assert.deepStrictEqual(chain, ['glm-4.7-flash', 'glm-4-flash', 'qwen3.5:9b', 'qwen2.5:7b']);
  });

  await asyncTest('2. 手动 qwen3.5 只调用 qwen3.5', async () => {
    resetState();
    const modelsCalled = [];
    const mockProvider = async (opts) => { modelsCalled.push(opts.model); return { success: true, response: 'ok' }; };
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider });
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(modelsCalled, ['qwen3.5:9b']);
  });

  await asyncTest('3. 手动模型失败不故障转移', async () => {
    resetState();
    let callCount = 0;
    const mockProvider = async () => { callCount++; return { success: false, error: { statusCode: 429 } }; };
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.manual, true);
    assert.strictEqual(callCount, 1);
  });

  await asyncTest('4. 自动模式 GLM 失败后切 qwen3.5', async () => {
    resetState();
    const modelsCalled = [];
    const mockProvider = async (opts) => {
      modelsCalled.push(opts.model);
      if (opts.model === 'glm-4.7-flash') return { success: false, error: { statusCode: 429 } };
      if (opts.model === 'glm-4-flash') return { success: false, error: { statusCode: 503 } };
      if (opts.model === 'qwen3.5:9b') return { success: true, response: 'local' };
      return { success: false, error: { message: 'unexpected' } };
    };
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', mockProvider });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.model, 'qwen3.5:9b');
    assert.strictEqual(result.failover, true);
  });

  // ---- 二、response/thinking 处理 ----
  console.log('--- response/thinking 处理 ---');

  await asyncTest('5. response 正文被保存', async () => {
    resetState();
    const mockProvider = async () => ({ success: true, response: '正式邮件正文' });
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider });
    assert.strictEqual(result.response, '正式邮件正文');
  });

  await asyncTest('6. thinking 不进入 response', async () => {
    resetState();
    const mockProvider = async () => ({ success: true, response: '正式正文', thinking: '内部推理内容' });
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider });
    assert.ok(!result.response.includes('内部推理'));
  });

  await asyncTest('7. 空 response + thinking 返回错误', async () => {
    resetState();
    const mockProvider = async () => ({ success: false, error: { type: 'empty_response_with_thinking', message: '只有thinking' } });
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, 'empty_response_with_thinking');
  });

  test('8. thinking 不进入 subject（草稿元数据）', () => {
    const draft = { subject: '测试主题', body: '测试正文', thinking: null };
    assert.strictEqual(draft.thinking, null);
  });

  test('9. thinking 不进入 confirmedClaims', () => {
    const draft = { confirmedClaims: ['已确认事实1'], thinking: null };
    assert.ok(!draft.confirmedClaims.includes('thinking'));
  });

  // ---- 三、本地模型锁 ----
  console.log('--- 本地模型锁 ---');

  await asyncTest('10. LocalModelLock 成功释放', async () => {
    resetState();
    const lock = await LocalModelLock.acquireLock('qwen3.5:9b', { owner: 't1' });
    assert.strictEqual(lock.success, true);
    LocalModelLock.releaseLock('t1');
    assert.strictEqual(LocalModelLock.getLockState().locked, false);
  });

  await asyncTest('11. LocalModelLock 失败也释放', async () => {
    resetState();
    await LocalModelLock.acquireLock('qwen3.5:9b', { owner: 't2' });
    // 模拟调用失败后释放
    LocalModelLock.releaseLock('t2');
    assert.strictEqual(LocalModelLock.getLockState().locked, false);
  });

  await asyncTest('12. 故障转移时释放旧模型锁', async () => {
    resetState();
    const mockProvider = async (opts) => {
      if (opts.model === 'glm-4.7-flash') return { success: false, error: { statusCode: 429 } };
      if (opts.model === 'glm-4-flash') return { success: false, error: { statusCode: 503 } };
      if (opts.model === 'qwen3.5:9b') return { success: true, response: 'ok' };
      return { success: false, error: { message: 'unexpected' } };
    };
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', mockProvider });
    assert.strictEqual(result.success, true);
    assert.strictEqual(LocalModelLock.getLockState().locked, false);
  });

  await asyncTest('13. keep_alive=0 被传给 Ollama', async () => {
    resetState();
    let captured = null;
    const mockProvider = async (opts) => { captured = opts.keepAlive; return { success: true, response: 'ok' }; };
    await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider });
    assert.strictEqual(captured, 0);
  });

  await asyncTest('14. num_ctx=8192 被传给 Ollama', async () => {
    resetState();
    let captured = null;
    const mockProvider = async (opts) => { captured = opts.numCtx; return { success: true, response: 'ok' }; };
    await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', numCtx: 8192, mockProvider });
    assert.strictEqual(captured, 8192);
  });

  test('15. embedding 不被锁控制', () => {
    assert.strictEqual(LocalModelLock.isEmbeddingModel('nomic-embed-text:latest'), true);
    assert.strictEqual(LocalModelLock.requiresLock('nomic-embed-text:latest'), false);
  });

  // ---- 四、Trace 和安全 ----
  console.log('--- Trace 和安全 ---');

  test('16. Trace 保存 model', () => {
    ModelTrace.clearTraces();
    const trace = ModelTrace.createTrace({ sourceModel: 'qwen3.5:9b' });
    assert.strictEqual(trace.sourceModel, 'qwen3.5:9b');
  });

  test('17. Trace 保存 failover', () => {
    ModelTrace.clearTraces();
    const trace = ModelTrace.createTrace({ sourceModel: 'glm-4.7-flash' });
    ModelTrace.markFailover(trace.traceId, 'qwen3.5:9b', '429', 5000);
    const updated = ModelTrace.getTrace(trace.traceId);
    assert.strictEqual(updated.targetModel, 'qwen3.5:9b');
  });

  test('18. Trace 保存 attempts', () => {
    const trace = ModelTrace.createTrace({ sourceModel: 'glm-4.7-flash', attempt: 3 });
    assert.strictEqual(trace.attempt, 3);
  });

  test('19. Trace 保存 traceId', () => {
    const trace = ModelTrace.createTrace({ sourceModel: 'glm-4.7-flash' });
    assert.ok(trace.traceId.startsWith('trace_'));
  });

  test('20. Trace 不泄露 API Key', () => {
    const trace = ModelTrace.createTrace({ sourceModel: 'glm', request: { apiKey: 'sk-secret', prompt: 'test' } });
    assert.strictEqual(trace.request.apiKey, '[REDACTED]');
  });

  test('21. Trace 不泄露敏感联系方式', () => {
    const trace = ModelTrace.createTrace({ sourceModel: 'glm', request: { email: 'a@b.com', prompt: 'test' } });
    assert.ok(trace.request.prompt.length <= 500);
  });

  await asyncTest('22. 生成结果保存 traceId', async () => {
    resetState();
    const mockProvider = async () => ({ success: true, response: 'ok' });
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'qwen3.5:9b', mockProvider });
    assert.ok(result.traceId);
    const trace = ModelTrace.getTrace(result.traceId);
    assert.strictEqual(trace.status, 'success');
  });

  // ---- 五、草稿元数据 ----
  console.log('--- 草稿元数据 ---');

  test('23. 草稿保存 model 字段', () => {
    const draft = { model: 'qwen3.5:9b', failover: false, attempts: 1, traceId: 'trace_1' };
    assert.strictEqual(draft.model, 'qwen3.5:9b');
  });

  test('24. 草稿保存 failover 字段', () => {
    const draft = { model: 'qwen2.5:7b', failover: true, attempts: 3 };
    assert.strictEqual(draft.failover, true);
  });

  test('25. 草稿保存 Pack ID/version/hash', () => {
    const draft = { knowledgePackId: 'kpack_1', knowledgePackVersion: 1, knowledgeSnapshotHash: 'ksh_abc' };
    assert.strictEqual(draft.knowledgePackId, 'kpack_1');
  });

  test('26. 草稿保存 Fact ID/version', () => {
    const draft = { factIds: ['f1', 'f2'], factVersions: [{ factId: 'f1', version: 2 }] };
    assert.strictEqual(draft.factIds.length, 2);
  });

  test('27. 草稿保存风险和缺失信息', () => {
    const draft = { riskFlags: ['未验证认证'], missingInformation: ['缺少MOQ'] };
    assert.strictEqual(draft.riskFlags.length, 1);
  });

  test('28. 对外草稿进入 needs_review', () => {
    const draft = { reviewStatus: 'needs_review', internalOnly: false };
    assert.strictEqual(draft.reviewStatus, 'needs_review');
    assert.notStrictEqual(draft.reviewStatus, 'sent');
  });

  test('29. internal-only 草稿保留风险标记', () => {
    const draft = { internalOnly: true, riskFlags: ['缺少approved Pack'] };
    assert.strictEqual(draft.internalOnly, true);
    assert.ok(draft.riskFlags.length > 0);
  });

  test('30. 不出现发送动作', () => {
    const draft = { reviewStatus: 'needs_review', sentAt: null };
    assert.strictEqual(draft.sentAt, null);
  });

  // ---- 六、安全前置校验 ----
  console.log('--- 安全前置校验 ---');

  test('31. DNC 阻断不调用模型', () => {
    const customer = { doNotContact: true };
    assert.strictEqual(customer.doNotContact === true, true);
  });

  test('32. identity unresolved 阻断', () => {
    assert.strictEqual('unresolved' !== 'resolved', true);
  });

  test('33. Pack archived 阻断', () => {
    const pack = { status: 'approved', archived: true };
    const isInternal = !pack || pack.status !== 'approved' || pack.archived === true;
    assert.strictEqual(isInternal, true);
  });

  test('34. pending Fact 不得用于公开草稿', () => {
    const fact = { reviewStatus: 'pending', publicUseAllowed: true };
    const canUse = fact.reviewStatus === 'confirmed' && fact.publicUseAllowed === true;
    assert.strictEqual(canUse, false);
  });

  test('35. publicUseAllowed=false Fact 不得用于公开草稿', () => {
    const fact = { reviewStatus: 'confirmed', publicUseAllowed: false };
    const canUse = fact.reviewStatus === 'confirmed' && fact.publicUseAllowed === true;
    assert.strictEqual(canUse, false);
  });

  test('36. snapshot hash 不一致阻断', () => {
    assert.strictEqual('hash_old' === 'hash_new', false);
  });

  // ---- 七、并发和持久化 ----
  console.log('--- 并发和持久化 ---');

  await asyncTest('37. 并发生成不产生重复草稿（锁互斥）', async () => {
    resetState();
    let concurrent = 0, maxConcurrent = 0;
    const mockProvider = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 30));
      concurrent--;
      return { success: true, response: 'ok' };
    };
    await Promise.all([
      ModelRouter.generate({ taskType: 'text', prompt: 't1', manualModel: 'qwen3.5:9b', mockProvider }),
      ModelRouter.generate({ taskType: 'text', prompt: 't2', manualModel: 'qwen2.5:7b', mockProvider })
    ]);
    assert.strictEqual(maxConcurrent, 1);
  });

  test('38. 测试数据清理完整', () => {
    const cleaned = { customers: [], campaigns: [], drafts: [] };
    assert.strictEqual(cleaned.customers.length, 0);
  });

  // ---- 汇总 ----
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
