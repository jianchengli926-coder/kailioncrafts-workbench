/**
 * P2.3A: 单客户网站证据采集与人工核验测试
 * 
 * 核心验证：
 * 1. SSRF 防护（危险协议、localhost、私有 IP）
 * 2. 证据字段完整性
 * 3. 默认 pending 和 publicUseAllowed=false
 * 4. 人工审核流程
 * 5. 联系方式脱敏
 * 6. XSS 安全
 * 7. 不发送消息、不调用云端 AI
 */

const assert = require('assert');
const WebsiteEvidence = require('./website-evidence');

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

console.log('\n=== P2.3A: 网站证据采集与人工核验测试 ===\n');

console.log('--- 一、SSRF 防护 ---');

test('1. 合法 HTTPS URL 通过校验', () => {
  const result = WebsiteEvidence.validateUrl('https://example.com');
  assert.strictEqual(result.valid, true);
  assert.ok(result.url);
});

test('2. 合法 HTTP URL 通过校验', () => {
  const result = WebsiteEvidence.validateUrl('http://example.com');
  assert.strictEqual(result.valid, true);
});

test('3. file:// 协议被阻断', () => {
  const result = WebsiteEvidence.validateUrl('file:///etc/passwd');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('不允许的协议'));
});

test('4. javascript: 协议被阻断', () => {
  const result = WebsiteEvidence.validateUrl('javascript:alert(1)');
  assert.strictEqual(result.valid, false);
});

test('5. data: 协议被阻断', () => {
  const result = WebsiteEvidence.validateUrl('data:text/html,<script>alert(1)</script>');
  assert.strictEqual(result.valid, false);
});

test('6. ftp: 协议被阻断', () => {
  const result = WebsiteEvidence.validateUrl('ftp://example.com/file');
  assert.strictEqual(result.valid, false);
});

test('7. localhost 被阻断', () => {
  const result = WebsiteEvidence.validateUrl('http://localhost:8080/admin');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('localhost'));
});

test('8. 127.0.0.1 被阻断', () => {
  const result = WebsiteEvidence.validateUrl('http://127.0.0.1:3000');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('私有 IP') || result.error.includes('回环'));
});

test('9. 0.0.0.0 被阻断', () => {
  const result = WebsiteEvidence.validateUrl('http://0.0.0.0:8080');
  assert.strictEqual(result.valid, false);
});

test('10. 私有 IP 10.x.x.x 被阻断', () => {
  const result = WebsiteEvidence.validateUrl('http://10.0.0.1/admin');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('私有 IP'));
});

test('11. 私有 IP 172.16.x.x 被阻断', () => {
  const result = WebsiteEvidence.validateUrl('http://172.16.0.1');
  assert.strictEqual(result.valid, false);
});

test('12. 私有 IP 192.168.x.x 被阻断', () => {
  const result = WebsiteEvidence.validateUrl('http://192.168.1.1');
  assert.strictEqual(result.valid, false);
});

test('13. 169.254 链路本地被阻断', () => {
  const result = WebsiteEvidence.validateUrl('http://169.254.169.254/latest/meta-data/');
  assert.strictEqual(result.valid, false);
});

test('14. .local 内网域名被阻断', () => {
  const result = WebsiteEvidence.validateUrl('http://printer.local');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('内网域名'));
});

test('15. .internal 内网域名被阻断', () => {
  const result = WebsiteEvidence.validateUrl('http://api.internal.corp');
  assert.strictEqual(result.valid, false);
});

test('16. 空 URL 被拒绝', () => {
  const result = WebsiteEvidence.validateUrl('');
  assert.strictEqual(result.valid, false);
});

test('17. 无效 URL 格式被拒绝', () => {
  const result = WebsiteEvidence.validateUrl('not-a-url');
  assert.strictEqual(result.valid, false);
});

console.log('\n--- 二、证据数据结构 ---');

test('18. createWebsiteEvidence 包含所有必要字段', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({
    customerId: 'cust_001',
    sourceUrl: 'https://example.com',
    finalUrl: 'https://example.com/',
    pageTitle: 'Example Company',
    httpStatus: 200,
    contentHash: 'abc123',
    excerpt: 'Test excerpt'
  });
  assert.ok(ev.evidenceId);
  assert.strictEqual(ev.customerId, 'cust_001');
  assert.strictEqual(ev.sourceUrl, 'https://example.com');
  assert.strictEqual(ev.finalUrl, 'https://example.com/');
  assert.strictEqual(ev.pageTitle, 'Example Company');
  assert.ok(ev.fetchedAt);
  assert.strictEqual(ev.httpStatus, 200);
  assert.strictEqual(ev.contentHash, 'abc123');
  assert.strictEqual(ev.excerpt, 'Test excerpt');
  assert.ok(ev.detectedProducts);
  assert.ok(ev.detectedMarkets);
  assert.ok(ev.detectedBuyerTypes);
  assert.ok(ev.contactHints);
  assert.ok(ev.extractionWarnings);
});

test('19. 新证据默认 reviewStatus=pending', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com'});
  assert.strictEqual(ev.reviewStatus, 'pending');
});

test('20. 新证据默认 publicUseAllowed=false', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com'});
  assert.strictEqual(ev.publicUseAllowed, false);
});

test('21. 证据包含 schemaVersion=P2.5B（P2.5B 起多页采集版本号升级）', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com'});
  assert.strictEqual(ev.schemaVersion, 'P2.5B');
});

console.log('\n--- 三、人工审核流程 ---');

test('22. reviewWebsiteEvidence 可将 pending 改为 reviewed', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com'});
  const result = WebsiteEvidence.reviewWebsiteEvidence(ev, 'reviewed', 'Leo', '内容准确');
  assert.strictEqual(result.success, true);
  assert.strictEqual(ev.reviewStatus, 'reviewed');
  assert.strictEqual(ev.reviewedBy, 'Leo');
  assert.ok(ev.reviewedAt);
  assert.strictEqual(ev.reviewNote, '内容准确');
});

test('23. reviewed 状态自动设置 publicUseAllowed=true', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com'});
  WebsiteEvidence.reviewWebsiteEvidence(ev, 'reviewed', 'Leo');
  assert.strictEqual(ev.publicUseAllowed, true);
});

test('24. rejected 状态 publicUseAllowed=false', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com'});
  WebsiteEvidence.reviewWebsiteEvidence(ev, 'rejected', 'Leo', '内容不准确');
  assert.strictEqual(ev.reviewStatus, 'rejected');
  assert.strictEqual(ev.publicUseAllowed, false);
});

test('25. conflict 状态 publicUseAllowed=false', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com'});
  WebsiteEvidence.reviewWebsiteEvidence(ev, 'conflict', 'Leo');
  assert.strictEqual(ev.reviewStatus, 'conflict');
  assert.strictEqual(ev.publicUseAllowed, false);
});

test('26. 无效审核状态被拒绝', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com'});
  const result = WebsiteEvidence.reviewWebsiteEvidence(ev, 'invalid_status');
  assert.strictEqual(result.success, false);
});

test('27. isEvidenceUsableForPublic 只允许 reviewed 且无错误', () => {
  const ev1 = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com'});
  assert.strictEqual(WebsiteEvidence.isEvidenceUsableForPublic(ev1), false);
  WebsiteEvidence.reviewWebsiteEvidence(ev1, 'reviewed', 'Leo');
  assert.strictEqual(WebsiteEvidence.isEvidenceUsableForPublic(ev1), true);
  const ev2 = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com', error: 'fail'});
  WebsiteEvidence.reviewWebsiteEvidence(ev2, 'reviewed', 'Leo');
  assert.strictEqual(WebsiteEvidence.isEvidenceUsableForPublic(ev2), false);
});

test('28. isEvidenceUsableForInternal 允许 pending 和 reviewed', () => {
  const ev1 = WebsiteEvidence.createWebsiteEvidence({customerId: 'c1', sourceUrl: 'https://x.com'});
  assert.strictEqual(WebsiteEvidence.isEvidenceUsableForInternal(ev1), true);
  WebsiteEvidence.reviewWebsiteEvidence(ev1, 'rejected', 'Leo');
  assert.strictEqual(WebsiteEvidence.isEvidenceUsableForInternal(ev1), false);
});

console.log('\n--- 四、内容提取与脱敏 ---');

test('29. extractEvidence 从 HTML 提取标题', () => {
  const html = '<html><head><title>Test Company - Kitchen Products</title></head><body>Hello</body></html>';
  const result = WebsiteEvidence.extractEvidence(html, 'https://example.com');
  assert.strictEqual(result.pageTitle, 'Test Company - Kitchen Products');
});

test('30. extractEvidence 检测产品关键词', () => {
  const html = '<html><body>We sell kitchen knives and stainless steel cutlery. OEM and private label available.</body></html>';
  const result = WebsiteEvidence.extractEvidence(html, 'https://example.com');
  assert.ok(result.detectedProducts.includes('kitchen'));
  assert.ok(result.detectedProducts.includes('knives'));
  assert.ok(result.detectedProducts.includes('oem'));
});

test('31. extractEvidence 检测市场关键词', () => {
  const html = '<html><body>Serving USA, Europe and global markets with international shipping.</body></html>';
  const result = WebsiteEvidence.extractEvidence(html, 'https://example.com');
  assert.ok(result.detectedMarkets.includes('usa'));
  assert.ok(result.detectedMarkets.includes('europe'));
});

test('32. extractEvidence 检测买家类型', () => {
  const html = '<html><body>We are a leading wholesaler and distributor for retailers.</body></html>';
  const result = WebsiteEvidence.extractEvidence(html, 'https://example.com');
  assert.ok(result.detectedBuyerTypes.includes('wholesaler'));
  assert.ok(result.detectedBuyerTypes.includes('distributor'));
});

test('33. extractEvidence 提取并脱敏邮箱', () => {
  const html = '<html><body>Contact: john.doe@example.com for inquiries.</body></html>';
  const result = WebsiteEvidence.extractEvidence(html, 'https://example.com');
  const emailHint = result.contactHints.find(c => c.type === 'email');
  assert.ok(emailHint);
  assert.ok(emailHint.value.includes('***'));
  assert.ok(!emailHint.value.includes('john.doe'));
});

test('34. maskEmail 正确脱敏邮箱', () => {
  assert.strictEqual(WebsiteEvidence.maskEmail('john@example.com'), 'j***n@example.com');
  assert.strictEqual(WebsiteEvidence.maskEmail('ab@example.com'), 'a***@example.com');
});

test('35. maskPhone 正确脱敏电话', () => {
  const masked = WebsiteEvidence.maskPhone('+1-234-567-8900');
  assert.ok(masked.includes('***'));
  assert.ok(masked.length < '+1-234-567-8900'.length);
});

test('36. extractEvidence 检测高风险内容并警告', () => {
  const html = '<html><body>We are ISO certified with our own factory and 10000 units monthly capacity.</body></html>';
  const result = WebsiteEvidence.extractEvidence(html, 'https://example.com');
  assert.ok(result.extractionWarnings.length > 0);
  assert.ok(result.extractionWarnings.some(w => w.includes('高风险')));
});

test('37. computeContentHash 生成稳定哈希', () => {
  const hash1 = WebsiteEvidence.computeContentHash('test content');
  const hash2 = WebsiteEvidence.computeContentHash('test content');
  const hash3 = WebsiteEvidence.computeContentHash('different content');
  assert.strictEqual(hash1, hash2);
  assert.notStrictEqual(hash1, hash3);
  assert.strictEqual(hash1.length, 16);
});

console.log('\n--- 五、XSS 和安全 ---');

test('38. extractEvidence 不执行 JavaScript', () => {
  const html = '<html><body><script>document.location="http://evil.com"</script>Normal text</body></html>';
  const result = WebsiteEvidence.extractEvidence(html, 'https://example.com');
  assert.ok(!result.excerpt.includes('document.location'));
  assert.ok(result.excerpt.includes('Normal text'));
});

test('39. stripHtmlTags 移除所有标签', () => {
  const result = WebsiteEvidence.stripHtmlTags('<p>Hello <b>World</b></p>');
  assert.ok(!result.includes('<p>'));
  assert.ok(!result.includes('<b>'));
  assert.ok(result.includes('Hello'));
  assert.ok(result.includes('World'));
});

test('40. extractTextContent 移除 script 和 style', () => {
  const html = '<html><head><style>.x{color:red}</style></head><body><script>alert(1)</script>Visible text</body></html>';
  const result = WebsiteEvidence.extractTextContent(html);
  assert.ok(!result.includes('alert'));
  assert.ok(!result.includes('color:red'));
  assert.ok(result.includes('Visible text'));
});

console.log('\n--- 六、业务边界 ---');

test('41. 不包含发送邮件或消息功能', () => {
  const fs = require('fs');
  const code = fs.readFileSync('./website-evidence.js', 'utf8');
  assert.ok(!code.includes('nodemailer'));
  assert.ok(!code.includes('sendmail'));
  assert.ok(!code.includes('smtp'));
  assert.ok(!code.includes('linkedin'));
  assert.ok(!code.includes('whatsapp'));
});

test('42. 不调用云端 AI API', () => {
  const fs = require('fs');
  const code = fs.readFileSync('./website-evidence.js', 'utf8');
  assert.ok(!code.includes('openai'));
  assert.ok(!code.includes('zhipu'));
  assert.ok(!code.includes('glm'));
  assert.ok(!code.includes('api.openai.com'));
});

test('43. 只使用 http/https 内置模块', () => {
  const fs = require('fs');
  const code = fs.readFileSync('./website-evidence.js', 'utf8');
  assert.ok(code.includes("require('http')"));
  assert.ok(code.includes("require('https')"));
});

test('44. 配置包含超时和大小限制', () => {
  assert.ok(WebsiteEvidence.CONFIG.connectTimeout > 0);
  assert.ok(WebsiteEvidence.CONFIG.totalTimeout > 0);
  assert.ok(WebsiteEvidence.CONFIG.maxResponseSize > 0);
  assert.ok(WebsiteEvidence.CONFIG.maxRedirects > 0);
});

test('45. EVIDENCE_REVIEW_STATUSES 包含四个状态', () => {
  assert.deepStrictEqual(
    WebsiteEvidence.EVIDENCE_REVIEW_STATUSES.sort(),
    ['conflict', 'pending', 'rejected', 'reviewed'].sort()
  );
});

// 输出结果
console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);

if (failed > 0) {
  process.exit(1);
}
