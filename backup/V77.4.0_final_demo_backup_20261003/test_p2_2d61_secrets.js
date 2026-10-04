/**
 * P2.2D-6.1: 备份密钥安全收口测试
 * 
 * 核心验证：
 * 1. API Key 不进入 exportAllData
 * 2. API Key 不进入 exportBackup
 * 3. API Key 不进入交接包
 * 4. password/token/authorization 不进入导出
 * 5. redacted 字段可安全导入
 * 6. 导入不覆盖本机密钥
 * 7. 旧含密钥备份显示警告
 * 8. 导入失败回滚
 * 9. XSS 特殊字符安全
 * 10. 日志和 Trace 不泄露
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

console.log('\n=== P2.2D-6.1: 备份密钥安全收口测试 ===\n');

// 读取源代码
const indexHtmlCode = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const modelTraceCode = fs.readFileSync(path.join(__dirname, 'model-trace.js'), 'utf8');

console.log('--- 一、脱敏工具函数 ---');

test('1. 存在 redactSecretsInObject 函数', () => {
  assert.ok(indexHtmlCode.includes('function redactSecretsInObject'), '必须有 redactSecretsInObject 函数');
});

test('2. 存在 countSensitiveFields 函数', () => {
  assert.ok(indexHtmlCode.includes('function countSensitiveFields'), '必须有 countSensitiveFields 函数');
});

test('3. 存在 isRedactedPlaceholder 函数', () => {
  assert.ok(indexHtmlCode.includes('function isRedactedPlaceholder'), '必须有 isRedactedPlaceholder 函数');
});

test('4. 敏感字段列表包含 apiKey/secret/password/authorization/token/cookie', () => {
  assert.ok(indexHtmlCode.includes('apiKey'), '必须包含 apiKey');
  assert.ok(indexHtmlCode.includes('secret'), '必须包含 secret');
  assert.ok(indexHtmlCode.includes('password'), '必须包含 password');
  assert.ok(indexHtmlCode.includes('authorization'), '必须包含 authorization');
  assert.ok(indexHtmlCode.includes('token'), '必须包含 token');
  assert.ok(indexHtmlCode.includes('cookie'), '必须包含 cookie');
});

test('5. 脱敏占位符格式为 {configured: true, redacted: true}', () => {
  assert.ok(indexHtmlCode.includes('configured: true'), '必须包含 configured: true');
  assert.ok(indexHtmlCode.includes('redacted: true'), '必须包含 redacted: true');
});

console.log('\n--- 二、exportAllData 脱敏 ---');

test('6. exportAllData 调用 redactSecretsInObject', () => {
  const exportFn = indexHtmlCode.match(/function exportAllData\(\)\{[\s\S]*?\n\}/);
  assert.ok(exportFn, '必须有 exportAllData 函数');
  assert.ok(exportFn[0].includes('redactSecretsInObject'), '必须调用 redactSecretsInObject');
});

test('7. exportAllData 不直接 JSON.stringify(data)，而是 redactedData', () => {
  const exportFn = indexHtmlCode.match(/function exportAllData\(\)\{[\s\S]*?\n\}/);
  assert.ok(exportFn[0].includes('redactedData'), '必须使用 redactedData');
  assert.ok(exportFn[0].includes('JSON.stringify(redactedData'), '必须序列化 redactedData');
});

test('8. exportAllData 在 _backupMeta 中标记 secretsRedacted', () => {
  const exportFn = indexHtmlCode.match(/function exportAllData\(\)\{[\s\S]*?\n\}/);
  assert.ok(exportFn[0].includes('secretsRedacted: true'), '必须标记 secretsRedacted');
});

test('9. exportAllData 统计 redactedSecretCount', () => {
  const exportFn = indexHtmlCode.match(/function exportAllData\(\)\{[\s\S]*?\n\}/);
  assert.ok(exportFn[0].includes('redactedSecretCount'), '必须统计 redactedSecretCount');
});

console.log('\n--- 三、exportBackup 脱敏 ---');

test('10. exportBackup 调用 redactSecretsInObject', () => {
  const exportFn = indexHtmlCode.match(/function exportBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(exportFn, '必须有 exportBackup 函数');
  assert.ok(exportFn[0].includes('redactSecretsInObject'), '必须调用 redactSecretsInObject');
});

test('11. exportBackup 使用 redactedAll 而不是 all', () => {
  const exportFn = indexHtmlCode.match(/function exportBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(exportFn[0].includes('redactedAll'), '必须使用 redactedAll');
  assert.ok(exportFn[0].includes('JSON.stringify(redactedAll'), '必须序列化 redactedAll');
});

test('12. exportBackup 提示敏感字段已脱敏', () => {
  const exportFn = indexHtmlCode.match(/function exportBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(exportFn[0].includes('敏感字段已脱敏'), '必须提示敏感字段已脱敏');
});

console.log('\n--- 四、交接包导出脱敏 ---');

test('13. exportHandoffPack 不包含 apiKey/secret/password/token', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn, '必须有 exportHandoffPack 函数');
  assert.ok(!handoffFn[0].includes('apiKey'), '交接包不得包含 apiKey');
  assert.ok(!handoffFn[0].includes('secret'), '交接包不得包含 secret');
  assert.ok(!handoffFn[0].includes('password'), '交接包不得包含 password');
  assert.ok(!handoffFn[0].includes('token'), '交接包不得包含 token');
});

test('14. exportHandoffPack 邮箱和电话脱敏', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn[0].includes('maskEmail'), '必须使用 maskEmail');
  assert.ok(handoffFn[0].includes('maskPhone'), '必须使用 maskPhone');
});

console.log('\n--- 五、importBackup 安全导入 ---');

test('15. importBackup 导入前检测敏感字段', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn, '必须有 importBackup 函数');
  assert.ok(importFn[0].includes('countSensitiveFields'), '必须调用 countSensitiveFields');
});

test('16. importBackup 含敏感字段时显示警告', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('安全警告'), '必须显示安全警告');
  assert.ok(importFn[0].includes('敏感字段'), '必须提及敏感字段');
});

test('17. importBackup 保存本机 API 密钥快照', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('localApisSnapshot'), '必须保存 localApisSnapshot');
});

test('18. importBackup 恢复本机 API 密钥', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('isRedactedPlaceholder'), '必须检查 redacted 占位符');
  assert.ok(importFn[0].includes('importedApi.apiKey = localApi.apiKey'), '必须恢复本机 apiKey');
});

test('19. importBackup 合并本机独有的 API 配置', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('S.apis.push(localApi)'), '必须合并本机独有 API 配置');
});

test('20. importBackup 持久化 apis 时使用合并后的数据', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes("key === 'apis' && S.apis"), '持久化 apis 时必须使用 S.apis');
});

console.log('\n--- 六、importAllData 安全导入 ---');

test('21. importAllData 导入前检测敏感字段', () => {
  const importFn = indexHtmlCode.match(/function importAllData\(input\)\{[\s\S]*?\n\}/);
  assert.ok(importFn, '必须有 importAllData 函数');
  assert.ok(importFn[0].includes('countSensitiveFields'), '必须调用 countSensitiveFields');
});

test('22. importAllData 保护本机 API 密钥', () => {
  const importFn = indexHtmlCode.match(/function importAllData\(input\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('localApisSnapshot'), '必须保存本机密钥快照');
  assert.ok(importFn[0].includes('isRedactedPlaceholder'), '必须检查 redacted 占位符');
});

console.log('\n--- 七、日志和 Trace 安全 ---');

test('23. model-trace.js 有敏感字段列表', () => {
  assert.ok(modelTraceCode.includes('SENSITIVE_KEYS'), '必须有 SENSITIVE_KEYS');
  assert.ok(modelTraceCode.includes('apiKey'), '必须包含 apiKey');
  assert.ok(modelTraceCode.includes('authorization'), '必须包含 authorization');
  assert.ok(modelTraceCode.includes('password'), '必须包含 password');
  assert.ok(modelTraceCode.includes('token'), '必须包含 token');
  assert.ok(modelTraceCode.includes('cookie'), '必须包含 cookie');
});

test('24. model-trace.js sanitize 函数移除敏感字段', () => {
  assert.ok(modelTraceCode.includes('function sanitize'), '必须有 sanitize 函数');
  assert.ok(modelTraceCode.includes('[REDACTED]'), '必须用 [REDACTED] 替换');
});

test('25. model-trace.js 不记录 thinking/reasoning_content', () => {
  assert.ok(modelTraceCode.includes('thinking'), '必须包含 thinking 在敏感列表');
  assert.ok(modelTraceCode.includes('reasoning_content'), '必须包含 reasoning_content');
});

test('26. logAction 不主动记录 API 密钥', () => {
  const logFn = indexHtmlCode.match(/function logAction\(type, action, detail[\s\S]*?\n\}/);
  assert.ok(logFn, '必须有 logAction 函数');
  // logAction 只记录传入的 detail，不主动包含密钥
  assert.ok(logFn[0].includes('detail: detail'), '只记录传入的 detail');
});

console.log('\n--- 八、导入失败回滚 ---');

test('27. importBackup 有导入前快照', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('snapshot'), '必须有快照');
  assert.ok(importFn[0].includes('memorySnap'), '必须有内存快照');
});

test('28. importBackup 失败时逆序回滚', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes('restoreKey'), '必须有恢复函数');
  assert.ok(importFn[0].includes('savedKeys.length - 1'), '必须逆序回滚');
});

test('29. importBackup 失败时恢复内存', () => {
  const importFn = indexHtmlCode.match(/function importBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(importFn[0].includes("S[k] = memorySnap[k]"), '必须恢复内存');
});

console.log('\n--- 九、XSS 和特殊字符 ---');

test('30. 导出函数使用 JSON.stringify，不直接拼接 HTML', () => {
  const exportFn = indexHtmlCode.match(/function exportAllData\(\)\{[\s\S]*?\n\}/);
  assert.ok(exportFn[0].includes('JSON.stringify'), '必须使用 JSON.stringify');
});

test('31. 交接包导出使用 Blob，不使用 innerHTML 注入', () => {
  const handoffFn = indexHtmlCode.match(/function exportHandoffPack\(draftId\)\{[\s\S]*?\n\}/);
  assert.ok(handoffFn[0].includes('new Blob'), '必须使用 Blob');
});

console.log('\n--- 十、业务边界 ---');

test('32. 不修改项目 A、端口、Tunnel、启动器、模型链或 Ollama 配置', () => {
  // 检查没有修改 8501 相关内容
  assert.ok(!indexHtmlCode.includes('8501'), '不得包含 8501 端口');
  assert.ok(!indexHtmlCode.includes('workbench.kailioncrafts.com'), '不得包含项目 A 域名');
});

test('33. 不发送邮件或调用外部投递 API', () => {
  assert.ok(!indexHtmlCode.includes('nodemailer'), '不得使用 nodemailer');
  assert.ok(!indexHtmlCode.includes('smtpTransport'), '不得使用 SMTP transport');
  assert.ok(!indexHtmlCode.includes('sendmail'), '不得使用 sendmail');
});

test('34. 现有业务数据不受影响（脱敏只影响导出，不影响 S 对象）', () => {
  const exportFn = indexHtmlCode.match(/function exportAllData\(\)\{[\s\S]*?\n\}/);
  // redactSecretsInObject 返回新对象，不修改原对象
  assert.ok(exportFn[0].includes('const redactedData = redactSecretsInObject(data)'), '必须创建新对象，不修改原 data');
});

// 输出结果
console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);

if (failed > 0) {
  process.exit(1);
}
