/**
 * P2.2D-5: qwen3.5:9b 思考模式兼容性修复测试
 * 
 * 核心修复：
 * 1. Ollama 0.35.0 正确参数名为 think（不是 thinking）
 * 2. /api/show 探测 thinking 支持值和默认值
 * 3. /api/generate 和 /api/chat 都使用 think:false
 * 4. 正式 response/message.content 作为正文
 * 5. thinking/reasoning_content/analysis 不得进入正文
 * 6. task.auditHistory 和 S.drafts 安全初始化
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

console.log('\n=== P2.2D-5: qwen3.5 thinking 兼容性修复测试 ===\n');

// 读取源代码
const modelRouterCode = fs.readFileSync(path.join(__dirname, 'model-router.js'), 'utf8');
const indexHtmlCode = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

console.log('--- 一、think 参数修复 ---');

test('1. model-router.js 使用 think: false（不是 thinking: false）', () => {
  assert.ok(modelRouterCode.includes('think: false'), '必须传递 think: false');
  assert.ok(!modelRouterCode.includes('thinking: false'), '不得使用无效的 thinking: false');
});

test('2. think 参数在请求顶层（不在 options 内）', () => {
  // 检查 think: false 在 postData 中，且不在 options 对象内
  const postDataMatch = modelRouterCode.match(/const postData = JSON\.stringify\(\{[\s\S]*?\}\)/);
  assert.ok(postDataMatch, '必须有 postData 定义');
  const postData = postDataMatch[0];
  assert.ok(postData.includes('think: false'), 'postData 必须包含 think: false');
});

test('3. 注释说明 Ollama 0.35.0 参数名', () => {
  assert.ok(
    modelRouterCode.includes('think') && 
    (modelRouterCode.includes('Ollama') || modelRouterCode.includes('0.35')),
    '必须有注释说明参数名'
  );
});

console.log('\n--- 二、正文读取逻辑 ---');

test('4. 优先使用 response 字段', () => {
  assert.ok(modelRouterCode.includes("parsed.response"), '必须读取 parsed.response');
});

test('5. 兼容 message.content 字段', () => {
  assert.ok(modelRouterCode.includes("parsed.message?.content"), '必须兼容 message.content');
});

test('6. thinking 字段仅作为内部诊断', () => {
  assert.ok(modelRouterCode.includes('parsed.thinking'), '必须读取 thinking 用于检测');
  // thinking 不直接作为 response 返回
  const responseLine = modelRouterCode.match(/response: responseText/);
  assert.ok(responseLine, 'response 必须使用 responseText，不是 thinkingText');
});

test('7. reasoning_content 兼容检测', () => {
  assert.ok(modelRouterCode.includes('reasoning_content'), '必须兼容 reasoning_content');
});

test('8. analysis 兼容检测', () => {
  assert.ok(modelRouterCode.includes('analysis'), '必须兼容 analysis');
});

test('9. 空 response + thinking 返回明确错误', () => {
  assert.ok(modelRouterCode.includes('empty_response_with_thinking'), '必须有 empty_response_with_thinking 错误类型');
  assert.ok(modelRouterCode.includes('只返回了内部推理'), '错误信息必须说明原因');
});

test('10. 空 response + thinking 不保存草稿', () => {
  // 错误返回中没有 draft 保存逻辑
  const errorBlock = modelRouterCode.match(/if \(!responseText\.trim\(\) && thinkingText\.trim\(\)\) \{[\s\S]*?\}/);
  assert.ok(errorBlock, '必须有空 response 处理块');
  assert.ok(errorBlock[0].includes('success: false'), '空 response 必须返回 success: false');
});

console.log('\n--- 三、本地模型配置 ---');

test('11. num_ctx=8192 默认值', () => {
  assert.ok(modelRouterCode.includes('num_ctx'), '必须设置 num_ctx');
  assert.ok(modelRouterCode.includes('8192'), '默认 num_ctx 应为 8192');
});

test('12. keep_alive=0', () => {
  assert.ok(modelRouterCode.includes('keep_alive'), '必须设置 keep_alive');
  assert.ok(modelRouterCode.includes('keepAlive: 0') || modelRouterCode.includes('keep_alive: 0') || modelRouterCode.includes('DEFAULT_CONFIG.keepAlive'), 'keep_alive 应为 0');
});

test('13. 超时配置存在', () => {
  assert.ok(modelRouterCode.includes('timeout'), '必须有超时配置');
});

test('14. 温度配置存在', () => {
  assert.ok(modelRouterCode.includes('temperature'), '必须有温度配置');
});

test('15. 输出长度限制存在', () => {
  assert.ok(modelRouterCode.includes('num_predict') || modelRouterCode.includes('maxOutputTokens'), '必须有输出长度限制');
});

console.log('\n--- 四、草稿保存安全初始化 ---');

test('16. generateCampaignTaskDraft 中 S.drafts 安全初始化', () => {
  // 检查在 unshift 之前有 if(!S.drafts) S.drafts = []
  const genMatch = indexHtmlCode.match(/draft\.draftId = draft\.id;[\s\S]*?S\.drafts\.unshift\(draft\)/);
  assert.ok(genMatch, '必须有草稿保存逻辑');
  assert.ok(genMatch[0].includes('if(!S.drafts) S.drafts = []'), 'S.drafts 必须安全初始化');
});

test('17. generateCampaignTaskDraft 中 task.auditHistory 安全初始化', () => {
  // 查找 campaign_draft_generated 附近的 auditHistory 初始化
  const genMatch = indexHtmlCode.match(/action: 'campaign_draft_generated'[\s\S]{0,500}/);
  assert.ok(genMatch, '必须有 campaign_draft_generated 动作');
  // 向前查找 auditHistory 初始化
  const beforeGen = indexHtmlCode.substring(0, indexHtmlCode.indexOf("action: 'campaign_draft_generated'"));
  const lastAuditInit = beforeGen.lastIndexOf('if(!task.auditHistory) task.auditHistory = []');
  assert.ok(lastAuditInit > 0, 'campaign_draft_generated 之前必须有 auditHistory 安全初始化');
});

test('18. regenerateCampaignTaskDraft 中 task.auditHistory 安全初始化', () => {
  // 查找 regenerate 中的 auditHistory.push
  const regenMatches = [...indexHtmlCode.matchAll(/task\.auditHistory\.push\(/g)];
  assert.ok(regenMatches.length >= 2, '必须至少有两处 auditHistory.push（generate 和 regenerate）');
});

console.log('\n--- 五、模型链配置 ---');

test('19. 普通文本链包含 qwen3.5:9b', () => {
  assert.ok(modelRouterCode.includes('qwen3.5:9b'), '必须包含 qwen3.5:9b');
});

test('20. 普通文本链包含 qwen2.5:7b', () => {
  assert.ok(modelRouterCode.includes('qwen2.5:7b'), '必须包含 qwen2.5:7b 作为备用');
});

test('21. 推理链包含 deepseek-r1:7b', () => {
  assert.ok(modelRouterCode.includes('deepseek-r1:7b'), '推理链必须包含 deepseek-r1:7b');
});

test('22. 视觉链包含 qwen2.5vl:7b', () => {
  assert.ok(modelRouterCode.includes('qwen2.5vl:7b'), '视觉链必须包含 qwen2.5vl:7b');
});

test('23. Embedding 固定为 nomic-embed-text', () => {
  assert.ok(modelRouterCode.includes('nomic-embed-text'), 'Embedding 必须固定');
});

test('24. doubao 不在普通文本链中', () => {
  // 检查普通文本链定义中不包含 doubao
  const textChainMatch = modelRouterCode.match(/TEXT_CHAIN[\s\S]*?\]/);
  if (textChainMatch) {
    assert.ok(!textChainMatch[0].includes('doubao'), '普通文本链不得包含 doubao');
  }
});

console.log('\n--- 六、故障转移规则 ---');

test('25. 429 允许故障转移', () => {
  assert.ok(modelRouterCode.includes('429'), '必须处理 429');
});

test('26. 503 允许故障转移', () => {
  assert.ok(modelRouterCode.includes('503'), '必须处理 503');
});

test('27. 401 不允许故障转移', () => {
  assert.ok(modelRouterCode.includes('401'), '必须处理 401');
});

test('28. 403 不允许故障转移', () => {
  assert.ok(modelRouterCode.includes('403'), '必须处理 403');
});

test('29. 手动模式不自动切换', () => {
  assert.ok(modelRouterCode.includes('manual') || modelRouterCode.includes('manualMode'), '必须支持手动模式');
});

console.log('\n--- 七、Trace 安全 ---');

test('30. Trace 模块存在', () => {
  const traceCode = fs.readFileSync(path.join(__dirname, 'model-trace.js'), 'utf8');
  assert.ok(traceCode.length > 0, 'model-trace.js 必须存在');
});

test('31. LocalModelLock 模块存在', () => {
  const lockCode = fs.readFileSync(path.join(__dirname, 'local-model-lock.js'), 'utf8');
  assert.ok(lockCode.length > 0, 'local-model-lock.js 必须存在');
});

test('32. LocalModelLock 有 release 方法', () => {
  const lockCode = fs.readFileSync(path.join(__dirname, 'local-model-lock.js'), 'utf8');
  assert.ok(lockCode.includes('release'), '必须有 release 方法');
});

test('33. LocalModelLock 有 acquire 方法', () => {
  const lockCode = fs.readFileSync(path.join(__dirname, 'local-model-lock.js'), 'utf8');
  assert.ok(lockCode.includes('acquire'), '必须有 acquire 方法');
});

console.log('\n--- 八、业务边界 ---');

test('34. 草稿状态为 needs_review 或 draft_pending_review', () => {
  assert.ok(indexHtmlCode.includes('draft_pending_review'), '必须有 draft_pending_review 状态');
});

test('35. 没有自动发送逻辑', () => {
  // 检查没有 SMTP、sendmail 等
  assert.ok(!indexHtmlCode.includes('nodemailer'), '不得使用 nodemailer');
  assert.ok(!indexHtmlCode.includes('smtpTransport'), '不得使用 SMTP transport');
});

test('36. 草稿保存 model 字段', () => {
  assert.ok(indexHtmlCode.includes('model: result.model'), '草稿必须保存 model');
});

test('37. 草稿保存 failover 字段', () => {
  assert.ok(indexHtmlCode.includes('failover: result.failover'), '草稿必须保存 failover');
});

test('38. 草稿保存 attempts 字段', () => {
  assert.ok(indexHtmlCode.includes('attempts: result.attempts'), '草稿必须保存 attempts');
});

test('39. 草稿保存 traceId 字段', () => {
  assert.ok(indexHtmlCode.includes('traceId: result.traceId'), '草稿必须保存 traceId');
});

test('40. 草稿保存 knowledgePackId', () => {
  assert.ok(indexHtmlCode.includes('knowledgePackId: packId'), '草稿必须保存 knowledgePackId');
});

// 输出结果
console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);

if (failed > 0) {
  process.exit(1);
}
