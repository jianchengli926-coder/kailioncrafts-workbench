/**
 * test_model_router.js
 * P2.2B-2: 模型路由和故障转移测试
 *
 * 运行: node test_model_router.js
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

// ============================================================
// 同步测试
// ============================================================

function runSyncTests() {
  console.log('--- 模型链配置 ---');

  test('1. 普通文本四节点顺序', () => {
    const chain = ModelRouter.MODEL_CHAINS.text;
    assert.deepStrictEqual(chain, ['glm-4.7-flash', 'glm-4-flash', 'qwen3.5:9b', 'qwen2.5:7b']);
    assert.strictEqual(chain.length, 4);
  });

  test('2. qwen3.5 是第一本地模型', () => {
    const chain = ModelRouter.MODEL_CHAINS.text;
    const localModels = chain.filter(m => ModelRouter.isLocalModel(m));
    assert.strictEqual(localModels[0], 'qwen3.5:9b');
    assert.strictEqual(localModels.length, 2);
  });

  test('3. 推理链顺序', () => {
    assert.deepStrictEqual(ModelRouter.MODEL_CHAINS.reasoning, ['glm-4.7-flash', 'qwen3.5:9b', 'deepseek-r1:7b']);
  });

  test('4. 视觉链顺序', () => {
    assert.deepStrictEqual(ModelRouter.MODEL_CHAINS.vision, ['glm-4.6v-flash', 'qwen3.5:9b', 'qwen2.5vl:7b']);
  });

  test('5. 生图链顺序', () => {
    assert.deepStrictEqual(ModelRouter.MODEL_CHAINS.image, ['cogview-3-flash', 'x/flux2-klein:4b-fp4']);
  });

  test('6. Embedding 固定', () => {
    assert.deepStrictEqual(ModelRouter.MODEL_CHAINS.embedding, ['nomic-embed-text:latest']);
    assert.strictEqual(LocalModelLock.isEmbeddingModel('nomic-embed-text:latest'), true);
  });

  test('7. doubao 不在普通文本链', () => {
    assert.strictEqual(ModelRouter.MODEL_CHAINS.text.includes('doubao-seed-2-1-turbo'), false);
  });

  test('8. deepseek 不在普通文本链', () => {
    assert.strictEqual(ModelRouter.MODEL_CHAINS.text.includes('deepseek-r1:7b'), false);
  });

  test('9. qwen2.5vl 不在普通文本链', () => {
    assert.strictEqual(ModelRouter.MODEL_CHAINS.text.includes('qwen2.5vl:7b'), false);
  });

  console.log('--- 故障转移规则 ---');

  test('10. 408 允许故障转移', () => assert.strictEqual(ModelRouter.shouldFailover({ statusCode: 408 }), true));
  test('11. 429 允许故障转移', () => assert.strictEqual(ModelRouter.shouldFailover({ statusCode: 429 }), true));
  test('12. 503 允许故障转移', () => assert.strictEqual(ModelRouter.shouldFailover({ statusCode: 503 }), true));
  test('13. 500 允许故障转移', () => assert.strictEqual(ModelRouter.shouldFailover({ statusCode: 500 }), true));
  test('14. 401 不允许故障转移', () => assert.strictEqual(ModelRouter.shouldFailover({ statusCode: 401 }), false));
  test('15. 403 不允许故障转移', () => assert.strictEqual(ModelRouter.shouldFailover({ statusCode: 403 }), false));
  test('16. 400 不允许故障转移', () => assert.strictEqual(ModelRouter.shouldFailover({ statusCode: 400 }), false));
  test('17. 422 不允许故障转移', () => assert.strictEqual(ModelRouter.shouldFailover({ statusCode: 422 }), false));
  test('18. timeout 允许故障转移', () => assert.strictEqual(ModelRouter.shouldFailover({ type: 'timeout' }), true));
  test('19. connection_refused 允许故障转移', () => assert.strictEqual(ModelRouter.shouldFailover({ type: 'connection_refused' }), true));
  test('20. 内容审核拒绝不允许故障转移', () => {
    assert.strictEqual(ModelRouter.shouldFailover({ type: 'content_moderation' }), false);
    assert.strictEqual(ModelRouter.shouldFailover({ message: '内容审核拒绝' }), false);
  });

  console.log('--- 慢响应 ---');

  test('21. 单次超过30秒触发慢响应', () => {
    ModelRouter.clearSlowResponseState();
    const result = ModelRouter.checkSlowResponse('glm-4.7-flash', 35000);
    assert.strictEqual(result.isSlow, true);
    assert.strictEqual(result.reason, 'single_response_exceeds_30s');
    assert.strictEqual(ModelRouter.isModelSlow('glm-4.7-flash'), true);
  });

  test('22. 连续两次超过15秒触发慢响应', () => {
    ModelRouter.clearSlowResponseState();
    ModelRouter.recordResponseTime('glm-4.7-flash', 20000);
    ModelRouter.recordResponseTime('glm-4.7-flash', 18000);
    const result = ModelRouter.checkSlowResponse('glm-4.7-flash', 16000);
    assert.strictEqual(result.isSlow, true);
    assert.strictEqual(result.reason, 'consecutive_responses_exceed_15s');
  });

  test('23. 慢响应状态可清除', () => {
    ModelRouter.clearSlowResponseState();
    ModelRouter.markModelSlow('glm-4.7-flash');
    assert.strictEqual(ModelRouter.isModelSlow('glm-4.7-flash'), true);
    ModelRouter.clearSlowResponseState();
    assert.strictEqual(ModelRouter.isModelSlow('glm-4.7-flash'), false);
  });

  test('24. 正常响应不触发慢响应', () => {
    ModelRouter.clearSlowResponseState();
    const result = ModelRouter.checkSlowResponse('glm-4.7-flash', 5000);
    assert.strictEqual(result.isSlow, false);
  });

  console.log('--- Trace ---');

  test('25. Trace 保存源模型和目标模型', () => {
    ModelTrace.clearTraces();
    const trace = ModelTrace.createTrace({
      sourceModel: 'glm-4.7-flash', targetModel: 'qwen3.5:9b',
      reason: '429_rate_limited', elapsedMs: 1000, attempt: 2
    });
    assert.strictEqual(trace.sourceModel, 'glm-4.7-flash');
    assert.strictEqual(trace.targetModel, 'qwen3.5:9b');
    assert.strictEqual(trace.reason, '429_rate_limited');
  });

  test('26. Trace 不泄露 API Key', () => {
    const trace = ModelTrace.createTrace({
      sourceModel: 'glm-4.7-flash',
      request: { apiKey: 'sk-secret-12345', authorization: 'Bearer token', prompt: 'test' }
    });
    assert.strictEqual(trace.request.apiKey, '[REDACTED]');
    assert.strictEqual(trace.request.authorization, '[REDACTED]');
  });

  test('27. Trace 脱敏长文本', () => {
    const trace = ModelTrace.createTrace({ sourceModel: 'glm-4.7-flash', request: { content: 'A'.repeat(1000) } });
    assert.ok(trace.request.content.includes('[truncated]'));
  });

  test('28. Trace 故障转移详情记录', () => {
    ModelTrace.clearTraces();
    const trace = ModelTrace.createTrace({ sourceModel: 'glm-4.7-flash' });
    ModelTrace.markFailover(trace.traceId, 'qwen3.5:9b', '429', 5000);
    const updated = ModelTrace.getTrace(trace.traceId);
    assert.strictEqual(updated.failoverDetails.length, 1);
    assert.strictEqual(updated.failoverDetails[0].to, 'qwen3.5:9b');
  });

  console.log('--- 配置 ---');

  test('35. num_ctx 默认8192', () => {
    assert.strictEqual(ModelRouter.DEFAULT_CONFIG.numCtx, 8192);
    assert.strictEqual(ModelRouter.DEFAULT_CONFIG.numCtxLong, 16384);
    assert.strictEqual(ModelRouter.DEFAULT_CONFIG.numCtxMax, 32768);
  });

  test('36. keep_alive 默认0', () => {
    assert.strictEqual(ModelRouter.DEFAULT_CONFIG.keepAlive, 0);
  });

  test('42. Trace 脱敏 XSS 内容', () => {
    const trace = ModelTrace.createTrace({ sourceModel: 'glm-4.7-flash', request: { content: '<script>alert(1)</script>' } });
    assert.strictEqual(typeof trace.request.content, 'string');
  });

  test('43. 模型健康检查不泄露密钥', () => {
    const health = ModelRouter.getModelHealth();
    assert.ok(health.chains);
    assert.strictEqual(health.apiKey, undefined);
  });
}

// ============================================================
// 异步测试
// ============================================================

async function runAsyncTests() {
  console.log('--- 本地模型锁 ---');

  await asyncTest('29. 本地模型锁互斥', async () => {
    LocalModelLock.forceReleaseAll();
    const lock1 = await LocalModelLock.acquireLock('qwen3.5:9b', { owner: 'test1', waitTimeout: 1000 });
    assert.strictEqual(lock1.success, true);
    assert.strictEqual(lock1.lockAcquired, true);
    assert.strictEqual(LocalModelLock.getLockState().locked, true);
    LocalModelLock.releaseLock('test1');
    assert.strictEqual(LocalModelLock.getLockState().locked, false);
  });

  await asyncTest('30. 第二个本地任务等待', async () => {
    LocalModelLock.forceReleaseAll();
    await LocalModelLock.acquireLock('qwen3.5:9b', { owner: 'holder' });
    const waitPromise = LocalModelLock.acquireLock('qwen2.5:7b', { owner: 'waiter', waitTimeout: 500 });
    setTimeout(() => LocalModelLock.releaseLock('holder'), 100);
    const result = await waitPromise;
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reason, 'lock_acquired_from_queue');
    LocalModelLock.releaseLock('waiter');
  });

  await asyncTest('31. 锁等待超时', async () => {
    LocalModelLock.forceReleaseAll();
    await LocalModelLock.acquireLock('qwen3.5:9b', { owner: 'holder' });
    const result = await LocalModelLock.acquireLock('qwen2.5:7b', { owner: 'waiter', waitTimeout: 200 });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'wait_timeout');
    LocalModelLock.releaseLock('holder');
  });

  await asyncTest('32. 失败时释放锁', async () => {
    LocalModelLock.forceReleaseAll();
    await LocalModelLock.acquireLock('qwen3.5:9b', { owner: 'test' });
    LocalModelLock.releaseLock('test');
    assert.strictEqual(LocalModelLock.getLockState().locked, false);
  });

  await asyncTest('33. embedding 不被锁控制', async () => {
    LocalModelLock.forceReleaseAll();
    const result = await LocalModelLock.acquireLock('nomic-embed-text:latest');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.lockAcquired, false);
    assert.strictEqual(result.reason, 'embedding_model_no_lock_required');
  });

  await asyncTest('34. 非所有者不能释放锁', async () => {
    LocalModelLock.forceReleaseAll();
    await LocalModelLock.acquireLock('qwen3.5:9b', { owner: 'owner1' });
    const result = LocalModelLock.releaseLock('owner2');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'not_lock_owner');
    LocalModelLock.releaseLock('owner1');
  });

  console.log('--- 模型调用集成（mock） ---');

  await asyncTest('37. GLM链失败后最终切到 qwen3.5', async () => {
    ModelRouter.clearSlowResponseState();
    ModelTrace.clearTraces();
    const modelsCalled = [];
    const mockProvider = async (opts) => {
      modelsCalled.push(opts.model);
      if (opts.model === 'glm-4.7-flash') return { success: false, error: { statusCode: 429 } };
      if (opts.model === 'glm-4-flash') return { success: false, error: { statusCode: 503 } };
      if (opts.model === 'qwen3.5:9b') return { success: true, response: 'response from qwen3.5' };
      return { success: false, error: { message: 'unexpected' } };
    };
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', mockProvider });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.model, 'qwen3.5:9b');
    assert.strictEqual(result.failover, true);
    assert.deepStrictEqual(modelsCalled, ['glm-4.7-flash', 'glm-4-flash', 'qwen3.5:9b']);
  });

  await asyncTest('38. 手动模型失败不切换', async () => {
    ModelRouter.clearSlowResponseState();
    let callCount = 0;
    const mockProvider = async () => { callCount++; return { success: false, error: { statusCode: 429 } }; };
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', manualModel: 'glm-4.7-flash', mockProvider });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.manual, true);
    assert.strictEqual(result.failover, false);
    assert.strictEqual(callCount, 1);
  });

  await asyncTest('39. 401 不自动切换', async () => {
    ModelRouter.clearSlowResponseState();
    let callCount = 0;
    const mockProvider = async () => { callCount++; return { success: false, error: { statusCode: 401 } }; };
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', mockProvider });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.failover, false);
    assert.strictEqual(callCount, 1);
  });

  await asyncTest('40. qwen3.5 失败后切 qwen2.5', async () => {
    ModelRouter.clearSlowResponseState();
    const modelsCalled = [];
    const mockProvider = async (opts) => {
      modelsCalled.push(opts.model);
      if (opts.model === 'glm-4.7-flash') return { success: false, error: { statusCode: 429 } };
      if (opts.model === 'glm-4-flash') return { success: false, error: { statusCode: 503 } };
      if (opts.model === 'qwen3.5:9b') return { success: false, error: { type: 'timeout' } };
      if (opts.model === 'qwen2.5:7b') return { success: true, response: 'final' };
      return { success: false, error: { message: 'unexpected' } };
    };
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', mockProvider });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.model, 'qwen2.5:7b');
    assert.strictEqual(modelsCalled.length, 4);
  });

  await asyncTest('41. 慢响应模型被跳过', async () => {
    ModelRouter.clearSlowResponseState();
    ModelRouter.markModelSlow('glm-4.7-flash');
    const modelsCalled = [];
    const mockProvider = async (opts) => { modelsCalled.push(opts.model); return { success: true, response: 'ok' }; };
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', mockProvider });
    assert.strictEqual(result.success, true);
    assert.strictEqual(modelsCalled[0], 'glm-4-flash');
  });

  await asyncTest('44. 推理链使用正确模型顺序', async () => {
    ModelRouter.clearSlowResponseState();
    const modelsCalled = [];
    const mockProvider = async (opts) => {
      modelsCalled.push(opts.model);
      if (opts.model === 'glm-4.7-flash') return { success: false, error: { statusCode: 429 } };
      if (opts.model === 'qwen3.5:9b') return { success: true, response: 'reasoning result' };
      return { success: false, error: { message: 'unexpected' } };
    };
    const result = await ModelRouter.generate({ taskType: 'reasoning', prompt: 'think', mockProvider });
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(modelsCalled, ['glm-4.7-flash', 'qwen3.5:9b']);
  });

  await asyncTest('45. 视觉链使用正确模型顺序', async () => {
    ModelRouter.clearSlowResponseState();
    const modelsCalled = [];
    const mockProvider = async (opts) => {
      modelsCalled.push(opts.model);
      if (opts.model === 'glm-4.6v-flash') return { success: false, error: { statusCode: 503 } };
      if (opts.model === 'qwen3.5:9b') return { success: true, response: 'vision result' };
      return { success: false, error: { message: 'unexpected' } };
    };
    const result = await ModelRouter.generate({ taskType: 'vision', prompt: 'describe image', mockProvider });
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(modelsCalled, ['glm-4.6v-flash', 'qwen3.5:9b']);
  });

  await asyncTest('46. 所有模型失败返回错误', async () => {
    ModelRouter.clearSlowResponseState();
    const mockProvider = async () => ({ success: false, error: { statusCode: 500 } });
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', mockProvider });
    assert.strictEqual(result.success, false);
    assert.ok(result.traceId);
  });

  await asyncTest('47. 生成结果保存 traceId', async () => {
    ModelRouter.clearSlowResponseState();
    ModelTrace.clearTraces();
    const mockProvider = async () => ({ success: true, response: 'ok' });
    const result = await ModelRouter.generate({ taskType: 'text', prompt: 'test', mockProvider });
    assert.ok(result.traceId);
    const trace = ModelTrace.getTrace(result.traceId);
    assert.ok(trace);
    assert.strictEqual(trace.status, 'success');
  });

  await asyncTest('48. 本地模型调用传递 num_ctx 和 keep_alive', async () => {
    ModelRouter.clearSlowResponseState();
    LocalModelLock.forceReleaseAll();
    let capturedOptions = null;
    const mockProvider = async (opts) => {
      capturedOptions = opts;
      return { success: true, response: 'local ok' };
    };
    // 跳过云端模型，直接测试本地
    const result = await ModelRouter.generate({
      taskType: 'text', prompt: 'test',
      manualModel: 'qwen3.5:9b',
      numCtx: 8192,
      mockProvider
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(capturedOptions.numCtx, 8192);
    assert.strictEqual(capturedOptions.keepAlive, 0);
  });
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  console.log('');
  console.log('========================================');
  console.log('P2.2B-2 模型路由和故障转移测试');
  console.log('========================================');
  console.log('');

  runSyncTests();
  await runAsyncTests();

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
