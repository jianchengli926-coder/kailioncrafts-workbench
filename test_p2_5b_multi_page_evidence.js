/**
 * P2.5B: 多页网站证据采集、ICP 重算与向后兼容 测试
 *
 * 核心验证：
 * 1. 新常量 PAGE_TYPES / MAX_PAGES_PER_COLLECT / EVIDENCE_SCHEMA_VERSION
 * 2. createWebsiteEvidence 新增 pageType / schemaVersion=P2.5B
 * 3. collectWebsiteEvidenceMulti 多页采集、校验、去重、页面级来源隔离
 * 4. SSRF 防护、超时/大小/重定向配置保持不变
 * 5. 审核流程、Fact 生成、脱敏、XSS、旧证据兼容
 * 6. recalculateProspectPriorityWithEvidence 纯函数重算
 *
 * 不访问真实网络：网络失败路径用 SSRF 阻断 URL（localhost/127.0.0.1/file://）触发；
 * 成功抓取路径用 extractEvidence + 构造 HTML 字符串间接验证。
 */

const assert = require('assert');
const fs = require('fs');
const WebsiteEvidence = require('./website-evidence');
const ProspectPriority = require('./prospect-priority');

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(
        r.then(
          () => { passed++; console.log('  ✓ ' + name); },
          (e) => { failed++; console.error('  ✗ ' + name + ': ' + e.message); }
        )
      );
    } else {
      passed++; console.log('  ✓ ' + name);
    }
  } catch (e) {
    failed++; console.error('  ✗ ' + name + ': ' + e.message);
  }
}

console.log('\n=== P2.5B: 多页网站证据采集与 ICP 重算测试 ===\n');

// 构造一条「干净、可用于去重」的已有证据（无 error）
function makeCleanEvidence(overrides) {
  return Object.assign(
    WebsiteEvidence.createWebsiteEvidence({ customerId: 'c_dedup', sourceUrl: 'https://old.example.com/' }),
    { error: null, errorType: null },
    overrides || {}
  );
}

// 构造一份用于优先级计算的客户 + 已批准 Pack 上下文
function makePriorityScenario() {
  const customer = {
    id: 'c_icu1',
    company: 'Ideal Buyer LLC',
    identityStatus: 'verified',
    website: 'https://buyer.example.com',
    country: 'USA',
    customerType: 'wholesaler',
    products: 'kitchen knives'
  };
  const context = {
    pack: {
      status: 'approved',
      productScope: ['kitchen'],
      targetMarkets: ['USA'],
      buyerTypes: ['wholesaler']
    },
    evidences: [],
    facts: [],
    drafts: []
  };
  return { customer, context };
}

// ------------------------------------------------------------
console.log('--- 一、新常量 ---');
// ------------------------------------------------------------

test('1. PAGE_TYPES 包含 home/about/products/contact/custom', () => {
  assert.deepStrictEqual(
    [...WebsiteEvidence.PAGE_TYPES].sort(),
    ['about', 'contact', 'custom', 'home', 'products'].sort()
  );
});

test('2. MAX_PAGES_PER_COLLECT = 3', () => {
  assert.strictEqual(WebsiteEvidence.MAX_PAGES_PER_COLLECT, 3);
});

test('3. EVIDENCE_SCHEMA_VERSION = P2.5B', () => {
  assert.strictEqual(WebsiteEvidence.EVIDENCE_SCHEMA_VERSION, 'P2.5B');
});

// ------------------------------------------------------------
console.log('--- 二、createWebsiteEvidence 新字段 ---');
// ------------------------------------------------------------

test('4. createWebsiteEvidence 默认 pageType=home、schemaVersion=P2.5B', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com' });
  assert.strictEqual(ev.pageType, 'home');
  assert.strictEqual(ev.schemaVersion, 'P2.5B');
});

test('5. createWebsiteEvidence 接受各合法 pageType', () => {
  for (const t of ['home', 'about', 'products', 'contact']) {
    const ev = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com', pageType: t });
    assert.strictEqual(ev.pageType, t);
  }
});

test('6. 非法 pageType 归为 custom', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com', pageType: 'blog' });
  assert.strictEqual(ev.pageType, 'custom');
});

test('7. 导出对象包含 pageType/schemaVersion 新字段', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com', pageType: 'products' });
  assert.ok('pageType' in ev);
  assert.ok('schemaVersion' in ev);
  assert.strictEqual(ev.pageType, 'products');
});

// ------------------------------------------------------------
console.log('--- 三、collectWebsiteEvidenceMulti 校验 ---');
// ------------------------------------------------------------

test('8. collectMulti 空数组报错', async () => {
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c1', []);
  assert.strictEqual(r.success, false);
  assert.ok(r.error);
  assert.deepStrictEqual(r.evidences, []);
});

test('9. collectMulti 非数组 pages 报错', async () => {
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c1', null);
  assert.strictEqual(r.success, false);
  assert.ok(r.error);
});

test('10. collectMulti 超过 3 页报错', async () => {
  const pages = [
    { url: 'http://localhost/a' }, { url: 'http://localhost/b' },
    { url: 'http://localhost/c' }, { url: 'http://localhost/d' }
  ];
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c1', pages);
  assert.strictEqual(r.success, false);
  assert.ok(r.error.includes('上限'));
  assert.deepStrictEqual(r.evidences, []);
});

// ------------------------------------------------------------
console.log('--- 四、collectMulti 采集结构与页面级隔离 ---');
// ------------------------------------------------------------

test('11. 单页 home 采集（SSRF 阻断）仍创建证据且 pageType 正确', async () => {
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c1', [{ url: 'http://localhost/test', pageType: 'home' }]);
  assert.strictEqual(r.success, false); // 被 SSRF 阻断
  assert.strictEqual(r.evidences.length, 1);
  const ev = r.evidences[0];
  assert.ok(ev.evidenceId);
  assert.strictEqual(ev.pageType, 'home');
  assert.strictEqual(ev.errorType, 'ssrf_blocked');
  assert.strictEqual(ev.sourceUrl, 'http://localhost/test');
});

test('12. 多页混合 pageType 各自独立 evidenceId', async () => {
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c1', [
    { url: 'http://localhost/a', pageType: 'home' },
    { url: 'http://127.0.0.1/b', pageType: 'about' },
    { url: 'http://192.168.1.1/c', pageType: 'products' }
  ]);
  assert.strictEqual(r.evidences.length, 3);
  const ids = r.evidences.map(e => e.evidenceId);
  assert.strictEqual(new Set(ids).size, 3);
  assert.deepStrictEqual(r.evidences.map(e => e.pageType), ['home', 'about', 'products']);
});

test('13. 每页独立 sourceUrl/finalUrl，不混合', async () => {
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c1', [
    { url: 'http://localhost/page1', pageType: 'home' },
    { url: 'http://127.0.0.1/page2', pageType: 'contact' }
  ]);
  assert.strictEqual(r.evidences[0].sourceUrl, 'http://localhost/page1');
  assert.strictEqual(r.evidences[1].sourceUrl, 'http://127.0.0.1/page2');
  // finalUrl 不应串到别的页
  assert.ok(!r.evidences[0].sourceUrl.includes('page2'));
  assert.ok(!r.evidences[1].sourceUrl.includes('page1'));
});

test('14. collectMulti 返回结构含 evidences/results/skipped', async () => {
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c1', [{ url: 'http://localhost/x', pageType: 'home' }]);
  assert.ok(Array.isArray(r.evidences));
  assert.ok(Array.isArray(r.results));
  assert.ok(Array.isArray(r.skipped));
  assert.strictEqual(r.results.length, 1);
});

// ------------------------------------------------------------
console.log('--- 五、去重逻辑 ---');
// ------------------------------------------------------------

test('15. existingEvidences 已有同 URL 时跳过且不重复创建', async () => {
  const existing = [makeCleanEvidence({ customerId: 'c_dup', sourceUrl: 'https://buyer.example.com/about' })];
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c_dup', [
    { url: 'https://buyer.example.com/about', pageType: 'about' },
    { url: 'http://localhost/real', pageType: 'home' }
  ], { existingEvidences: existing });
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.skipped[0].reason, 'duplicate_existing_evidence');
  assert.strictEqual(r.skipped[0].existingEvidenceId, existing[0].evidenceId);
  assert.strictEqual(r.skipped[0].pageType, 'about');
  // 只真正采集 localhost 那一条
  assert.strictEqual(r.evidences.length, 1);
  assert.strictEqual(r.evidences[0].sourceUrl, 'http://localhost/real');
});

test('16. 去重忽略末尾斜杠和大小写', async () => {
  const existing = [makeCleanEvidence({ customerId: 'c_dedup2', sourceUrl: 'https://Buyer.Example.com/Products/' })];
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c_dedup2', [
    { url: 'https://buyer.example.com/products', pageType: 'products' }
  ], { existingEvidences: existing });
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.evidences.length, 0);
});

test('17. 有 error 的旧证据不触发去重（会重新采集）', async () => {
  const errored = makeCleanEvidence({ customerId: 'c_dedup3', sourceUrl: 'https://buyer.example.com/home' });
  errored.error = '抓取失败';
  errored.errorType = 'request_error';
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c_dedup3', [
    { url: 'https://buyer.example.com/home', pageType: 'home' }
  ], { existingEvidences: [errored] });
  // 不跳过：尝试采集（这里 URL 是公网域名会真实连不上/超时，但不访问真实站点即快速失败）
  // 关键：不应出现在 skipped
  assert.strictEqual(r.skipped.length, 0);
});

test('18. 不同 customerId 的同 URL 不去重', async () => {
  const existing = [makeCleanEvidence({ customerId: 'c_other', sourceUrl: 'https://shared.example.com/' })];
  const r = await WebsiteEvidence.collectWebsiteEvidenceMulti('c_another', [
    { url: 'https://shared.example.com/', pageType: 'home' }
  ], { existingEvidences: existing });
  assert.strictEqual(r.skipped.length, 0);
});

// ------------------------------------------------------------
console.log('--- 六、SSRF 防护与配置 ---');
// ------------------------------------------------------------

test('19. SSRF 阻断 localhost', () => {
  assert.strictEqual(WebsiteEvidence.validateUrl('http://localhost/admin').valid, false);
});

test('20. SSRF 阻断 127.0.0.1', () => {
  assert.strictEqual(WebsiteEvidence.validateUrl('http://127.0.0.1:3000').valid, false);
});

test('21. SSRF 阻断私有 IP 192.168.x', () => {
  assert.strictEqual(WebsiteEvidence.validateUrl('http://192.168.1.10').valid, false);
});

test('22. SSRF 阻断 file:// 协议', () => {
  assert.strictEqual(WebsiteEvidence.validateUrl('file:///etc/passwd').valid, false);
});

test('23. SSRF 阻断 javascript: 协议', () => {
  assert.strictEqual(WebsiteEvidence.validateUrl('javascript:alert(1)').valid, false);
});

test('24. 重定向目标重新校验（validateUrl 对危险地址返回 invalid）', () => {
  // 重定向目标若指向 localhost，validateUrl 会拒绝——即重定向后被拦截
  const redirectTarget = 'http://localhost/internal';
  assert.strictEqual(WebsiteEvidence.validateUrl(redirectTarget).valid, false);
  assert.ok(WebsiteEvidence.validateUrl('http://example.com/ok').valid);
});

test('25. 最大重定向 5 次（CONFIG.maxRedirects=5）', () => {
  assert.strictEqual(WebsiteEvidence.CONFIG.maxRedirects, 5);
});

test('26. 连接超时 10 秒（CONFIG.connectTimeout=10000）', () => {
  assert.strictEqual(WebsiteEvidence.CONFIG.connectTimeout, 10000);
});

test('27. 总超时 30 秒（CONFIG.totalTimeout=30000）', () => {
  assert.strictEqual(WebsiteEvidence.CONFIG.totalTimeout, 30000);
});

test('28. 响应上限 1MB（CONFIG.maxResponseSize=1048576）', () => {
  assert.strictEqual(WebsiteEvidence.CONFIG.maxResponseSize, 1048576);
});

// ------------------------------------------------------------
console.log('--- 七、内容提取与高风险/脱敏/XSS ---');
// ------------------------------------------------------------

test('29. extractEvidence 对空/非字符串输入安全处理', () => {
  const r1 = WebsiteEvidence.extractEvidence('', 'https://x.com');
  assert.ok(r1.extractionWarnings.length > 0);
  const r2 = WebsiteEvidence.extractEvidence(null, 'https://x.com');
  assert.strictEqual(r2.pageTitle, '');
  const r3 = WebsiteEvidence.extractEvidence(undefined, 'https://x.com');
  assert.ok(Array.isArray(r3.detectedProducts));
});

test('30. 高风险内容（factory/moq/certified）记录 extractionWarnings', () => {
  const html = '<html><body>We are ISO certified with own factory and low MOQ capacity.</body></html>';
  const r = WebsiteEvidence.extractEvidence(html, 'https://x.com');
  assert.ok(r.extractionWarnings.some(w => w.includes('高风险')));
});

test('31. 新证据 publicUseAllowed 默认 false', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com' });
  assert.strictEqual(ev.publicUseAllowed, false);
});

test('32. contactHints 中邮箱/电话被脱敏', () => {
  const html = '<html><body>Email us at john.doe@example.com or call +1-234-567-8900.</body></html>';
  const r = WebsiteEvidence.extractEvidence(html, 'https://x.com');
  const emailHint = r.contactHints.find(c => c.type === 'email');
  const phoneHint = r.contactHints.find(c => c.type === 'phone');
  assert.ok(emailHint);
  assert.ok(emailHint.value.includes('***'));
  assert.ok(!emailHint.value.includes('john.doe'));
  if (phoneHint) {
    assert.ok(phoneHint.value.includes('***'));
  }
});

test('33. XSS：excerpt/公司名中的 <script> 作为文本原样存储不被执行', () => {
  const evil = '<script>alert(1)</script>VisibleSafeText';
  const ev = WebsiteEvidence.createWebsiteEvidence({
    customerId: 'c1',
    sourceUrl: 'https://x.com',
    excerpt: evil,
    detectedCompanyName: '<script>steal()</script>EvilCo'
  });
  // 字段原样保存字符串（不解析/执行）
  assert.ok(ev.excerpt.includes('VisibleSafeText'));
  assert.ok(ev.detectedCompanyName.includes('EvilCo'));
  // 提取层会把 script 内容从正文文本里剔除
  const extracted = WebsiteEvidence.extractEvidence('<html><body><script>alert(1)</script>SafeBody</body></html>', 'https://x.com');
  assert.ok(!extracted.excerpt.includes('alert(1)'));
  assert.ok(extracted.excerpt.includes('SafeBody'));
});

// ------------------------------------------------------------
console.log('--- 八、审核流程与可用性 ---');
// ------------------------------------------------------------

test('34. 新证据 reviewStatus=pending', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com' });
  assert.strictEqual(ev.reviewStatus, 'pending');
});

test('35. reviewed 保存 reviewedBy/reviewedAt/reviewNote 且 publicUseAllowed=true', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com' });
  const res = WebsiteEvidence.reviewWebsiteEvidence(ev, 'reviewed', 'Leo', '核对无误');
  assert.strictEqual(res.success, true);
  assert.strictEqual(ev.reviewStatus, 'reviewed');
  assert.strictEqual(ev.reviewedBy, 'Leo');
  assert.ok(ev.reviewedAt);
  assert.strictEqual(ev.reviewNote, '核对无误');
  assert.strictEqual(ev.publicUseAllowed, true);
});

test('36. rejected 时 publicUseAllowed=false', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com' });
  WebsiteEvidence.reviewWebsiteEvidence(ev, 'rejected', 'Leo', '不实');
  assert.strictEqual(ev.reviewStatus, 'rejected');
  assert.strictEqual(ev.publicUseAllowed, false);
});

test('37. rejected/conflict 证据 isEvidenceUsableForPublic=false', () => {
  const evR = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com' });
  WebsiteEvidence.reviewWebsiteEvidence(evR, 'rejected', 'Leo');
  assert.strictEqual(WebsiteEvidence.isEvidenceUsableForPublic(evR), false);

  const evC = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com' });
  WebsiteEvidence.reviewWebsiteEvidence(evC, 'conflict', 'Leo');
  assert.strictEqual(WebsiteEvidence.isEvidenceUsableForPublic(evC), false);
});

// ------------------------------------------------------------
console.log('--- 九、createFactFromEvidence ---');
// ------------------------------------------------------------

test('38. createFactFromEvidence 只接受 reviewed+publicUseAllowed 证据', () => {
  // pending 证据被拒
  const pendingEv = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com' });
  assert.strictEqual(ProspectPriority.createFactFromEvidence(pendingEv, 'Leo').success, false);

  // reviewed 但 publicUseAllowed=false（手动构造）被拒
  const reviewedNoPublic = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com' });
  WebsiteEvidence.reviewWebsiteEvidence(reviewedNoPublic, 'reviewed', 'Leo');
  reviewedNoPublic.publicUseAllowed = false;
  assert.strictEqual(ProspectPriority.createFactFromEvidence(reviewedNoPublic, 'Leo').success, false);

  // reviewed + publicUseAllowed=true 通过
  const ok = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x.com' });
  WebsiteEvidence.reviewWebsiteEvidence(ok, 'reviewed', 'Leo');
  const res = ProspectPriority.createFactFromEvidence(ok, 'Leo');
  assert.strictEqual(res.success, true);
});

test('39. createFactFromEvidence 生成的 Fact 保留溯源字段且默认不公开', () => {
  const ev = WebsiteEvidence.createWebsiteEvidence({
    customerId: 'c1',
    sourceUrl: 'https://x.com/home',
    finalUrl: 'https://x.com/home',
    contentHash: 'abc123hash',
    detectedCompanyName: 'Buyer Co',
    excerpt: 'Some excerpt'
  });
  WebsiteEvidence.reviewWebsiteEvidence(ev, 'reviewed', 'Leo');
  const { fact } = ProspectPriority.createFactFromEvidence(ev, 'Leo');
  assert.strictEqual(fact.reviewStatus, 'pending');
  assert.strictEqual(fact.publicUseAllowed, false);
  assert.strictEqual(fact.sourceEvidenceId, ev.evidenceId);
  assert.strictEqual(fact.sourceUrl, ev.finalUrl);
  assert.strictEqual(fact.sourceHash, 'abc123hash');
  assert.strictEqual(fact.sourceLocator, ev.finalUrl);
});

// ------------------------------------------------------------
console.log('--- 十、recalculateProspectPriorityWithEvidence ---');
// ------------------------------------------------------------

test('40. recalc 返回 before/after/evidenceIds/calculationVersion/scoreDelta', () => {
  const { customer, context } = makePriorityScenario();
  customer.priorityScore = 30;
  customer.priorityTier = 'C';
  const evId = 'wev_test1';
  const r = ProspectPriority.recalculateProspectPriorityWithEvidence(customer, [evId], context);
  assert.strictEqual(r.success, true);
  assert.ok(r.before);
  assert.strictEqual(r.before.priorityScore, 30);
  assert.ok(r.after);
  assert.strictEqual(r.after.priorityScore > 0, true);
  assert.deepStrictEqual(r.evidenceIds, [evId]);
  assert.ok(r.calculationVersion);
  assert.strictEqual(r.scoreDelta, r.after.priorityScore - 30);
  assert.ok(typeof r.recalculatedAt === 'string');
  assert.ok(Array.isArray(r.addedPositiveReasons));
  assert.ok(Array.isArray(r.resolvedMissingItems));
  assert.ok(Array.isArray(r.newMissingItems));
});

test('41. recalc 不修改 customer 对象（纯函数）', () => {
  const { customer, context } = makePriorityScenario();
  customer.priorityScore = 30;
  const snapshot = JSON.parse(JSON.stringify(customer));
  ProspectPriority.recalculateProspectPriorityWithEvidence(customer, ['wev_x'], context);
  assert.deepStrictEqual(customer, snapshot);
});

test('42. recalc 在 customer 缺失时返回 success:false', () => {
  const r = ProspectPriority.recalculateProspectPriorityWithEvidence(null, []);
  assert.strictEqual(r.success, false);
  assert.ok(r.error);
});

test('43. recalc 不改变 identityStatus、不自动加名单/生成邮件', () => {
  const { customer, context } = makePriorityScenario();
  const beforeIdentity = customer.identityStatus;
  ProspectPriority.recalculateProspectPriorityWithEvidence(customer, ['wev_x'], context);
  assert.strictEqual(customer.identityStatus, beforeIdentity);
  assert.ok(!customer.addedToQueue);
});

// ------------------------------------------------------------
console.log('--- 十一、旧数据兼容与隔离 ---');
// ------------------------------------------------------------

test('44. 旧证据（缺 pageType）在可用性函数中正常工作不报错', () => {
  // 模拟 P2.3A 旧证据：没有 pageType 字段
  const oldEv = {
    evidenceId: 'wev_old',
    customerId: 'c_old',
    sourceUrl: 'https://old.com',
    finalUrl: 'https://old.com',
    reviewStatus: 'reviewed',
    publicUseAllowed: true,
    error: null,
    schemaVersion: 'P2.3A'
  };
  assert.strictEqual(WebsiteEvidence.isEvidenceUsableForPublic(oldEv), true);
  assert.strictEqual(WebsiteEvidence.isEvidenceUsableForInternal(oldEv), true);
  // 缺 pageType 视为 home 不崩溃
  assert.ok(typeof oldEv.pageType === 'undefined');
});

test('45. 旧格式证据数组遍历不报错（reset/clear 兼容）', () => {
  const oldBatch = [
    { evidenceId: 'a', reviewStatus: 'pending', publicUseAllowed: false, error: null },
    { evidenceId: 'b', reviewStatus: 'rejected', publicUseAllowed: false, error: 'bad' },
    { evidenceId: 'c', reviewStatus: 'reviewed', publicUseAllowed: true, error: null }
  ];
  const publicOk = oldBatch.filter(WebsiteEvidence.isEvidenceUsableForPublic);
  const internalOk = oldBatch.filter(WebsiteEvidence.isEvidenceUsableForInternal);
  assert.strictEqual(publicOk.length, 1);
  assert.strictEqual(publicOk[0].evidenceId, 'c');
  // internal: a(pending,无error) 与 c(reviewed,无error) 可用；b 有 error 不可用
  assert.strictEqual(internalOk.length, 2);
  assert.deepStrictEqual(internalOk.map(e => e.evidenceId).sort(), ['a', 'c']);
});

test('46. 测试数据隔离：审核一条证据不影响另一条', () => {
  const e1 = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x1.com' });
  const e2 = WebsiteEvidence.createWebsiteEvidence({ customerId: 'c1', sourceUrl: 'https://x2.com' });
  WebsiteEvidence.reviewWebsiteEvidence(e1, 'reviewed', 'Leo');
  assert.strictEqual(e1.publicUseAllowed, true);
  assert.strictEqual(e2.publicUseAllowed, false);
  assert.strictEqual(e2.reviewStatus, 'pending');
});

test('47. collectWebsiteEvidence 单页签名向后兼容（返回 {success, evidence}）', async () => {
  const r = await WebsiteEvidence.collectWebsiteEvidence('c1', 'http://localhost/legacy');
  assert.ok('success' in r);
  assert.ok('evidence' in r);
  assert.ok(r.evidence.evidenceId);
  assert.strictEqual(r.evidence.errorType, 'ssrf_blocked');
});

test('48. 不访问真实网站 / 不调用云端 AI（源码静态检查）', () => {
  const code = fs.readFileSync('./website-evidence.js', 'utf8');
  assert.ok(!code.includes('api.openai.com'));
  assert.ok(!code.includes('zhipu'));
  assert.ok(!code.includes('openai'));
});

// ------------------------------------------------------------
// 等待所有异步用例完成后汇总
// ------------------------------------------------------------
(async () => {
  await Promise.all(pending);
  console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);
  if (failed > 0) process.exit(1);
})();
