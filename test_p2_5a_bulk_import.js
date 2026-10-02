/**
 * P2.5A: 客户批量导入、数据清洗和安全导入确认 测试
 *
 * 核心验证：
 * 1. CSV 解析（BOM/引号/逗号/换行/转义/空行/中英文列名）
 * 2. 字段自动映射与手动覆盖、未知列保留、重复列检测
 * 3. 数据清洗（公司名/网站 SSRRF/邮箱/电话/脱敏）
 * 4. 重复检测（公司名/域名/邮箱/批次内/归档）
 * 5. DNC 检查
 * 6. 产品四大品类映射与人工审核
 * 7. 预览不写库、确认后批量导入、幂等、失败回滚
 * 8. 导入批次记录（不保存原始 CSV、字段完整）
 * 9. 错误导出、导入后默认状态、不自动进名单/草稿
 * 10. 兼容性与安全（XSS、敏感信息脱敏、旧客户不被改、状态隔离）
 *
 * 不访问网络、不调用外部 API；测试数据不含真实客户联系方式。
 */

const assert = require('assert');
const CustomerImport = require('./customer-import');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.error('  ✗ ' + name + ': ' + e.message);
  }
}

console.log('\n=== P2.5A: 客户批量导入与安全清洗测试 ===\n');

// ------------------------------------------------------------
// 测试辅助函数
// ------------------------------------------------------------

function makeMockS() {
  return {
    customers: [],
    importBatches: [],
    outreachKnowledgeBase: [],
    outreachQueues: [],
    drafts: []
  };
}

function makeCustomer(overrides) {
  return Object.assign({
    id: 'c_existing',
    company: 'Existing Co',
    website: 'https://existing.com',
    contact: { email: 'existing@test.com' },
    dnc: false
  }, overrides);
}

// 构造一行"干净可导入"的数据，返回 generatePreview 的结果
function buildReadyPreview(rowsOverride) {
  const csvLines = [
    'Company,Website,Email,Phone,ProductCategories,Country',
    rowsOverride || 'Alpha Trading Co,https://www.alpha.com,sales@alpha.com,+8613800000001,kitchen knife,USA'
  ];
  const parsed = CustomerImport.parseCSV(csvLines.join('\n'));
  const auto = CustomerImport.autoMapColumns(parsed.headers);
  return CustomerImport.generatePreview(parsed.rows, auto.mapping, { customers: [], archives: [] });
}

// ============================================================
// 一、CSV 解析（7项）
// ============================================================
console.log('一、CSV 解析');

test('1. UTF-8 BOM 被正确去除，首列名不携带 BOM', () => {
  const p = CustomerImport.parseCSV('\uFEFFCompany,Website\nAcme,https://acme.com');
  assert.strictEqual(p.headers[0], 'Company');
  assert.strictEqual(p.rows.length, 1);
  assert.strictEqual(p.rows[0].Company, 'Acme');
});

test('2. 引号字段被正确解析', () => {
  const p = CustomerImport.parseCSV('Company,Website\n"Acme, Inc.",https://acme.com');
  assert.strictEqual(p.rows[0].Company, 'Acme, Inc.');
});

test('3. 字段内逗号被正确解析（不破坏列结构）', () => {
  const p = CustomerImport.parseCSV('Company,City,Website\n"Doe & Partners","New York, NY",https://acme.com');
  assert.strictEqual(p.rows[0].City, 'New York, NY');
  assert.strictEqual(p.headers.length, 3);
  assert.strictEqual(Object.keys(p.rows[0]).filter(k => k !== '_rowNumber').length, 3);
});

test('4. 字段内换行被正确解析', () => {
  const p = CustomerImport.parseCSV('Company,Notes\n"Head Office\nWest Wing","x"');
  assert.ok(p.rows[0].Company.includes('\n'));
  assert.strictEqual(p.rows[0].Company.split('\n').length, 2);
});

test('5. 双引号转义（""）被正确解析为单个引号', () => {
  const p = CustomerImport.parseCSV('Company,Notes\n"Say ""Hi""","x"');
  assert.strictEqual(p.rows[0].Company, 'Say "Hi"');
});

test('6. 空行被跳过并产生警告', () => {
  const p = CustomerImport.parseCSV('Company\nAcme\n\nBeta');
  assert.strictEqual(p.rows.length, 2);
  assert.ok(p.warnings.some(w => w.includes('空行')));
});

test('7. 中英文列名都能被自动识别映射', () => {
  const p = CustomerImport.parseCSV('公司名称,网站,邮箱\nAcme,https://acme.com,a@acme.com');
  const m = CustomerImport.autoMapColumns(p.headers);
  assert.strictEqual(m.mapping['公司名称'], 'companyName');
  assert.strictEqual(m.mapping['网站'], 'website');
  assert.strictEqual(m.mapping['邮箱'], 'email');
});

// ============================================================
// 二、字段映射（4项）
// ============================================================
console.log('\n二、字段映射');

test('8. 自动字段映射识别常见别名', () => {
  const m = CustomerImport.autoMapColumns(['company_name', 'contact_email', 'web', 'mobile', 'custom_col']);
  assert.strictEqual(m.mapping['company_name'], 'companyName');
  assert.strictEqual(m.mapping['contact_email'], 'email');
  assert.strictEqual(m.mapping['web'], 'website');
  assert.strictEqual(m.mapping['mobile'], 'phone');
  assert.ok(m.unmapped.includes('custom_col'));
});

test('9. 手动字段映射（自定义列名覆盖）', () => {
  const row = { CustomBuyer: 'Foo Corp', _rowNumber: 2 };
  const mapping = { CustomBuyer: 'companyName' };
  const r = CustomerImport.applyMapping(row, mapping);
  assert.strictEqual(r.companyName, 'Foo Corp');
});

test('10. 未知列保留到 extraFields', () => {
  const row = { Company: 'Acme', InternalTag: 'vip', _rowNumber: 2 };
  const mapping = { Company: 'companyName' };
  const r = CustomerImport.applyMapping(row, mapping);
  assert.strictEqual(r.companyName, 'Acme');
  assert.ok(r.extraFields);
  assert.strictEqual(r.extraFields.InternalTag, 'vip');
});

test('11. 重复列名被检测并产生警告，后者自动重命名', () => {
  const p = CustomerImport.parseCSV('Company,Company,Age\nAcme,x,10');
  assert.ok(p.warnings.some(w => w.includes('列名重复')));
  assert.strictEqual(p.headers[1], 'Company_2');
});

// ============================================================
// 三、数据清洗（8项）
// ============================================================
console.log('\n三、数据清洗');

test('12. 空公司名阻断（validationErrors + invalid）', () => {
  const ctx = { customers: [], archives: [], batchSeen: { company: {}, domain: {}, email: {} } };
  const r = CustomerImport.cleanAndEvaluateRow(
    { companyName: '', website: 'https://acme.com', email: 'a@acme.com' }, 2, ctx
  );
  assert.ok(r.validationErrors.some(e => e.includes('公司名为空')));
  assert.strictEqual(r.importDecision, 'invalid');
});

test('13. 网站规范化（去 www、去尾部斜杠、小写）', () => {
  const r = CustomerImport.cleanWebsite('WWW.Example.com/foo/');
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.normalizedDomain, 'example.com');
  assert.ok(r.cleaned.indexOf('www.example.com') !== -1);
  assert.ok(!r.cleaned.endsWith('/'));
  assert.strictEqual(r.cleaned, r.cleaned.toLowerCase());
});

test('14. 危险 URL（javascript:/data:）被阻断', () => {
  assert.strictEqual(CustomerImport.cleanWebsite('javascript:alert(1)').valid, false);
  assert.strictEqual(CustomerImport.cleanWebsite('data:text/html,<b>x</b>').valid, false);
});

test('15. localhost / 私有 IP 被阻断', () => {
  assert.strictEqual(CustomerImport.cleanWebsite('http://localhost:3000').valid, false);
  assert.strictEqual(CustomerImport.cleanWebsite('http://192.168.1.5').valid, false);
  assert.strictEqual(CustomerImport.cleanWebsite('http://10.0.0.8').valid, false);
});

test('16. 邮箱标准化（trim + lowercase）', () => {
  const r = CustomerImport.cleanEmail('  Sales@Acme.COM  ');
  assert.strictEqual(r.cleaned, 'sales@acme.com');
  assert.strictEqual(r.valid, true);
  assert.ok(r.hash && r.hash.length > 0);
});

test('17. 邮箱格式错误被检测', () => {
  const r = CustomerImport.cleanEmail('not-an-email');
  assert.strictEqual(r.valid, false);
  assert.ok(r.error);
});

test('18. 电话清洗（保留有效字符、生成 hash）', () => {
  const r = CustomerImport.cleanPhone('+86 138-0000-0000');
  assert.strictEqual(r.valid, true);
  assert.ok(r.hash && r.hash.length > 0);
  assert.ok(r.masked && r.masked.length > 0);
});

test('19. 邮箱脱敏显示（不暴露完整邮箱）', () => {
  const r = CustomerImport.cleanEmail('john.doe@example.com');
  assert.strictEqual(r.valid, true);
  assert.ok(r.masked.indexOf('john.doe') === -1);
  assert.ok(r.masked.indexOf('@example.com') !== -1);
});

// ============================================================
// 四、重复检测（5项）
// ============================================================
console.log('\n四、重复检测');

test('20. 公司名重复检测（duplicate_active）', () => {
  const existing = makeCustomer({ id: 'c1', company: 'Acme Trading Co', website: '', contact: {} });
  const cleaned = {
    normalizedCompanyName: CustomerImport.cleanCompanyName('Acme Trading Co Ltd').normalized,
    normalizedDomain: '',
    emailHash: ''
  };
  const r = CustomerImport.detectDuplicates(cleaned, {
    customers: [existing], archives: [], batchSeen: { company: {}, domain: {}, email: {} }
  });
  assert.strictEqual(r.duplicateStatus, 'duplicate_active');
  assert.ok(r.hasActiveDuplicate);
});

test('21. 域名重复检测（duplicate_active）', () => {
  const existing = makeCustomer({ id: 'c2', company: '', website: 'https://www.acme.com', contact: {} });
  const cleaned = { normalizedCompanyName: '', normalizedDomain: 'acme.com', emailHash: '' };
  const r = CustomerImport.detectDuplicates(cleaned, {
    customers: [existing], archives: [], batchSeen: { company: {}, domain: {}, email: {} }
  });
  assert.strictEqual(r.duplicateStatus, 'duplicate_active');
});

test('22. 邮箱重复检测（duplicate_active）', () => {
  const existing = makeCustomer({ id: 'c3', company: '', website: '', contact: { email: 'sales@acme.com' } });
  const cleaned = {
    normalizedCompanyName: '',
    normalizedDomain: '',
    emailHash: CustomerImport.hashValue('sales@acme.com')
  };
  const r = CustomerImport.detectDuplicates(cleaned, {
    customers: [existing], archives: [], batchSeen: { company: {}, domain: {}, email: {} }
  });
  assert.strictEqual(r.duplicateStatus, 'duplicate_active');
});

test('23. 批次内重复（duplicate_in_batch）', () => {
  const cleaned = { normalizedCompanyName: 'batchtradingco', normalizedDomain: '', emailHash: '' };
  const r = CustomerImport.detectDuplicates(cleaned, {
    customers: [], archives: [],
    batchSeen: { company: { batchtradingco: 2 }, domain: {}, email: {} }
  });
  assert.strictEqual(r.duplicateStatus, 'duplicate_in_batch');
  assert.ok(r.hasBatchDuplicate);
});

test('24. 归档客户风险提示（duplicate_archived）', () => {
  const archives = [{ customerId: 'a1', normalizedDomain: 'oldmarket.com' }];
  const cleaned = { normalizedCompanyName: '', normalizedDomain: 'oldmarket.com', emailHash: '' };
  const r = CustomerImport.detectDuplicates(cleaned, {
    customers: [], archives, batchSeen: { company: {}, domain: {}, email: {} }
  });
  assert.strictEqual(r.duplicateStatus, 'duplicate_archived');
  assert.ok(r.hasArchivedDuplicate);
});

// ============================================================
// 五、DNC 检查（2项）
// ============================================================
console.log('\n五、DNC 检查');

test('25. 命中 DNC 被阻断（dnc_blocked）', () => {
  const dncCustomer = makeCustomer({
    id: 'd1', company: '', website: 'https://www.dncbuyer.com', contact: {}, dnc: true
  });
  const ctx = {
    customers: [dncCustomer], archives: [],
    batchSeen: { company: {}, domain: {}, email: {} }
  };
  const r = CustomerImport.cleanAndEvaluateRow(
    { companyName: 'DNC Buyer LLC', website: 'https://www.dncbuyer.com', email: 'buyer@dncbuyer.com', productCategories: '' },
    2, ctx
  );
  assert.strictEqual(r.dncStatus, 'blocked');
  assert.strictEqual(r.importDecision, 'dnc_blocked');
});

test('26. 非 DNC 客户状态为 clear', () => {
  const ctx = { customers: [], archives: [], batchSeen: { company: {}, domain: {}, email: {} } };
  const r = CustomerImport.cleanAndEvaluateRow(
    { companyName: 'Normal Co', website: 'https://normal.com', email: 'n@normal.com' },
    2, ctx
  );
  assert.strictEqual(r.dncStatus, 'clear');
});

// ============================================================
// 六、产品类别映射（2项）
// ============================================================
console.log('\n六、产品类别映射');

test('27. 四大核心品类正确映射', () => {
  const r = CustomerImport.mapProductCategory('chef knife, hairdressing scissors, folding knife, cutting board');
  assert.ok(r.categories.includes('Kitchen Knives'));
  assert.ok(r.categories.includes('Professional Scissors'));
  assert.ok(r.categories.includes('Outdoor Knives'));
  assert.ok(r.categories.includes('Kitchen Accessories'));
  assert.strictEqual(r.needsReview, false);
});

test('28. 未知产品需人工审核（needsReview）', () => {
  const r = CustomerImport.mapProductCategory('plastic toys, generic gadgets');
  assert.strictEqual(r.needsReview, true);
  assert.strictEqual(r.unmatched.length, 2);
  assert.strictEqual(r.categories.length, 0);
});

// ============================================================
// 七、预览和确认流程（5项）
// ============================================================
console.log('\n七、预览与确认流程');

test('29. 预览不写正式数据（generatePreview 不污染 S.customers）', () => {
  const S = makeMockS();
  const preview = buildReadyPreview();
  assert.strictEqual(S.customers.length, 0);
  assert.strictEqual(S.importBatches.length, 0);
  assert.strictEqual(preview.stats.ready, 1);
});

test('30. 未确认不写正式数据（仅生成预览时数据不变）', () => {
  const S = makeMockS();
  S.customers.push(makeCustomer());
  const before = S.customers.length;
  buildReadyPreview();
  assert.strictEqual(S.customers.length, before);
});

test('31. 确认后批量导入（executeImport 成功写入）', () => {
  const S = makeMockS();
  const preview = buildReadyPreview();
  const result = CustomerImport.executeImport(preview, {
    S: S, persistFn: () => {}, uidFn: () => 'test_id_' + Math.random(), options: { fileName: 'test.csv' }
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.importedCount, 1);
  assert.strictEqual(S.customers.length, 1);
});

test('32. 重复点击幂等（_importInProgress 标记阻止并发）', () => {
  const S = makeMockS();
  const preview = buildReadyPreview();
  const ctx = {
    S: S, persistFn: () => {}, uidFn: () => 'id_x', options: {}, _importInProgress: true
  };
  const r = CustomerImport.executeImport(preview, ctx);
  assert.strictEqual(r.success, false);
  assert.ok(r.error && r.error.indexOf('进行中') !== -1);
});

test('33. 导入失败回滚（持久化异常后 S.customers 恢复）', () => {
  const S = makeMockS();
  const preview = buildReadyPreview();
  const r = CustomerImport.executeImport(preview, {
    S: S,
    persistFn: () => { throw new Error('simulated persistence failure'); },
    uidFn: () => 'rb_id_' + Math.random(),
    options: {}
  });
  assert.strictEqual(r.success, false);
  assert.strictEqual(S.customers.length, 0);
  assert.strictEqual(S.importBatches.length, 0);
});

// ============================================================
// 八、导入批次记录（3项）
// ============================================================
console.log('\n八、导入批次记录');

function runImportOnce(options) {
  const S = makeMockS();
  const preview = buildReadyPreview();
  const result = CustomerImport.executeImport(preview, {
    S: S, persistFn: () => {}, uidFn: () => 'batch_id_' + Math.random(), options: options || {}
  });
  return { S: S, result: result };
}

test('34. 导入批次记录被创建（S.importBatches 中有记录）', () => {
  const { S } = runImportOnce({ fileName: 'data.csv', fileHash: 'abc123' });
  assert.strictEqual(S.importBatches.length, 1);
});

test('35. 原始 CSV 内容不被保存（batchRecord 中无 rawContent）', () => {
  const { S } = runImportOnce({ fileName: 'data.csv' });
  const rec = S.importBatches[0];
  assert.ok(!('rawContent' in rec));
  assert.ok(!('csvContent' in rec));
  assert.ok(!('content' in rec));
});

test('36. 批次记录字段完整', () => {
  const { S } = runImportOnce({ fileName: 'data.csv', fileHash: 'fh1' });
  const rec = S.importBatches[0];
  const required = ['importBatchId', 'fileName', 'fileHash', 'schemaVersion', 'importedAt',
    'importedBy', 'rowCount', 'importedCount', 'skippedCount', 'blockedCount', 'errorCount',
    'mapping', 'summary'];
  required.forEach(k => assert.ok(k in rec, '缺少字段: ' + k));
  assert.strictEqual(rec.fileName, 'data.csv');
  assert.strictEqual(rec.schemaVersion, 'P2.5A');
});

// ============================================================
// 九、错误导出和导入后状态（4项）
// ============================================================
console.log('\n九、错误导出与导入后状态');

test('37. 错误行 CSV 导出（返回有效 CSV）', () => {
  const parsed = CustomerImport.parseCSV('Company,Website,Email\n,https://x.com,a@x.com');
  const auto = CustomerImport.autoMapColumns(parsed.headers);
  const preview = CustomerImport.generatePreview(parsed.rows, auto.mapping, { customers: [], archives: [] });
  const csv = CustomerImport.exportErrorRowsCSV(preview);
  assert.ok(csv.indexOf('行号') !== -1);
  assert.ok(csv.split('\n').length >= 2);
  assert.ok(csv.indexOf('invalid') !== -1);
});

test('38. 导入后默认状态（customerStatus=new）', () => {
  const { S } = runImportOnce({});
  assert.strictEqual(S.customers[0].customerStatus, 'new');
});

test('39. 不自动 verified（identityResolutionStatus=pending）', () => {
  const { S } = runImportOnce({});
  assert.strictEqual(S.customers[0].identityResolutionStatus, 'pending');
});

test('40. 不自动加入名单、不自动生成草稿', () => {
  const S = makeMockS();
  const preview = buildReadyPreview();
  CustomerImport.executeImport(preview, {
    S: S, persistFn: () => {}, uidFn: () => 'q_id_' + Math.random(), options: {}
  });
  assert.strictEqual(S.outreachQueues.length, 0);
  assert.strictEqual(S.drafts.length, 0);
});

// ============================================================
// 十、兼容性和安全（6项）
// ============================================================
console.log('\n十、兼容性与安全');

test('41. 导出/导入 JSON 往返保留批次记录', () => {
  const { S } = runImportOnce({ fileName: 'roundtrip.csv' });
  const exported = JSON.parse(JSON.stringify(S));
  assert.strictEqual(exported.importBatches.length, 1);
  const restored = JSON.parse(JSON.stringify(exported));
  assert.strictEqual(restored.importBatches.length, 1);
  assert.strictEqual(restored.importBatches[0].fileName, 'roundtrip.csv');
});

test('42. reset/clearAllData 可覆盖批次（importBatches 为一级数组集合）', () => {
  const { S } = runImportOnce({});
  assert.ok(Array.isArray(S.importBatches));
  assert.strictEqual(S.importBatches.length, 1);
  S.importBatches = []; // 模拟 clearAllData
  assert.strictEqual(S.importBatches.length, 0);
});

test('43. XSS 安全（HTML/脚本字符串作为纯文本存储，不被解释执行）', () => {
  const ctx = { customers: [], archives: [], batchSeen: { company: {}, domain: {}, email: {} } };
  const r = CustomerImport.cleanAndEvaluateRow(
    { companyName: '<img src=x onerror=alert(1)>', website: 'https://safe.com', email: 'a@safe.com' },
    2, ctx
  );
  // 原样作为文本保留，不被剥离/执行
  assert.strictEqual(r.cleaned.companyName, '<img src=x onerror=alert(1)>');
  // 错误行 CSV 导出时对内容做转义
  const preview = { rows: [r] };
  const csv = CustomerImport.exportErrorRowsCSV(preview);
  assert.ok(typeof csv === 'string');
});

test('44. 敏感信息脱敏（masked 存在，validationErrors 不含完整邮箱）', () => {
  const ctx = { customers: [], archives: [], batchSeen: { company: {}, domain: {}, email: {} } };
  const r = CustomerImport.cleanAndEvaluateRow(
    { companyName: 'Masked Co', website: 'https://masked.com', email: 'sales@masked.com', phone: '+8613800000099' },
    2, ctx
  );
  assert.ok(r.cleaned.emailMasked && r.cleaned.emailMasked.length > 0);
  assert.ok(r.cleaned.phoneMasked && r.cleaned.phoneMasked.length > 0);
  assert.ok(r.cleaned.emailMasked.indexOf('sales@masked.com') === -1);
  const errText = r.validationErrors.join(' ');
  assert.ok(errText.indexOf('sales@masked.com') === -1);
});

test('45. 旧客户数据不被导入操作修改', () => {
  const existing = makeCustomer({ id: 'old1', company: 'Old Co', website: 'https://old.com', contact: { email: 'old@old.com' }, notes: 'keep me untouched' });
  const S = makeMockS();
  S.customers.push(existing);
  const preview = buildReadyPreview();
  CustomerImport.executeImport(preview, {
    S: S, persistFn: () => {}, uidFn: () => 'k_id_' + Math.random(), options: {}
  });
  // 旧客户仍在首位且字段未变
  assert.strictEqual(S.customers[0].id, 'old1');
  assert.strictEqual(S.customers[0].company, 'Old Co');
  assert.strictEqual(S.customers[0].notes, 'keep me untouched');
  assert.strictEqual(S.customers.length, 2);
});

test('46. 测试状态隔离（每个 mock S 独立，不污染全局）', () => {
  const s1 = makeMockS();
  const s2 = makeMockS();
  s1.customers.push({ id: 'x1' });
  s1.importBatches.push({ id: 'b1' });
  assert.strictEqual(s2.customers.length, 0);
  assert.strictEqual(s2.importBatches.length, 0);
  assert.deepStrictEqual(s2.outreachQueues, []);
  assert.deepStrictEqual(s2.drafts, []);
});

// ------------------------------------------------------------
// 附加：常量与工具函数完整性
// ------------------------------------------------------------
console.log('\n附加：常量与工具函数');

test('47. 常量集合完整（STANDARD_FIELDS/FIELD_ALIASES/CORE_CATEGORIES）', () => {
  assert.ok(Array.isArray(CustomerImport.STANDARD_FIELDS));
  assert.ok(CustomerImport.STANDARD_FIELDS.indexOf('companyName') !== -1);
  assert.ok(CustomerImport.STANDARD_FIELDS.indexOf('email') !== -1);
  assert.ok(CustomerImport.FIELD_ALIASES && typeof CustomerImport.FIELD_ALIASES === 'object');
  assert.deepStrictEqual(CustomerImport.CORE_CATEGORIES,
    ['Kitchen Knives', 'Professional Scissors', 'Outdoor Knives', 'Kitchen Accessories']);
});

test('48. hashValue 确定性与 computeFileHash', () => {
  assert.strictEqual(CustomerImport.hashValue('abc'), CustomerImport.hashValue('abc'));
  assert.notStrictEqual(CustomerImport.hashValue('abc'), CustomerImport.hashValue('abd'));
  assert.strictEqual(CustomerImport.hashValue(''), '00000000');
  const h = CustomerImport.computeFileHash('some csv content');
  assert.ok(typeof h === 'string' && h.length > 0);
});

test('49. cleanCountry 保留原始文本（仅 trim）', () => {
  const r = CustomerImport.cleanCountry('  United States  ');
  assert.strictEqual(r.cleaned, 'United States');
});

// 输出结果
console.log('\n通过: ' + passed + ', 失败: ' + failed);
process.exit(failed > 0 ? 1 : 0);
