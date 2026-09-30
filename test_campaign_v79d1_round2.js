/**
 * V79.0D1 第二轮阻断修复 — Mock 测试套件
 * 从 index.html 提取内联脚本，在 Node vm 中构建 mock 浏览器环境运行。
 * 覆盖：身份 fail-closed、迁移完整性、独占关联双向校验、未定义函数修复、
 *       异步二次校验、reconciliation archive 同步、人工发送安全检查、普通 Draft 幂等。
 *
 * 运行：node test_campaign_v79d1_round2.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scriptBlocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
if (scriptBlocks.length !== 2) { console.error('Expected 2 inline script blocks, got', scriptBlocks.length); process.exit(1); }

// ---- Mock 浏览器环境 ----
function makeMockElement() {
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'value' || prop === 'textContent' || prop === 'innerHTML' || prop === 'outerHTML') return '';
      if (prop === 'checked' || prop === 'disabled' || prop === 'hidden') return false;
      if (prop === 'style' || prop === 'dataset') return {};
      if (prop === 'classList') return { add(){}, remove(){}, toggle(){}, contains(){return false;} };
      if (prop === 'files') return [];
      if (prop === 'children' || prop === 'childNodes') return [];
      if (prop === 'parentNode') return null;
      if (prop === 'offsetWidth' || prop === 'offsetHeight') return 0;
      if (typeof prop === 'string') return function() { return makeMockElement(); };
      return undefined;
    },
    set() { return true; }
  });
}

const _ls = {};
const localStorageMock = {
  _s: _ls,
  getItem(k) { return k in _ls ? _ls[k] : null; },
  setItem(k, v) { _ls[k] = String(v); },
  removeItem(k) { delete _ls[k]; },
  clear() { for (const k in _ls) delete _ls[k]; },
};

const context = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, RangeError, Promise,
  parseInt, parseFloat, isNaN, isFinite, isInteger: Number.isInteger,
  encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
  btoa: s => Buffer.from(s).toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString(),
  alert() {}, confirm() { return true; }, prompt() { return null; },
  FileReader: function() { this.readAsText = () => {}; this.readAsDataURL = () => {}; },
  File: function() {}, Blob: function() {},
  URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
  FormData: function() { this.append = () => {}; },
  XMLHttpRequest: function() {},
  indexedDB: { open: function() { return { onsuccess: null, onerror: null, onupgradeneeded: null, result: {} }; } },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
  location: { href: 'http://localhost:8080/', origin: 'http://localhost:8080', pathname: '/', hostname: 'localhost', protocol: 'http:', reload() {} },
  history: { pushState() {}, replaceState() {}, back() {} },
  navigator: { userAgent: 'Mozilla/5.0 (test)', language: 'zh-CN', clipboard: { writeText: async () => {} } },
  localStorage: localStorageMock,
  sessionStorage: { _s:{}, getItem(k){return this._s[k]??null;}, setItem(k,v){this._s[k]=String(v);}, removeItem(k){delete this._s[k];} },
  document: {
    readyState: 'complete',
    title: 'test',
    cookie: '',
    getElementById() { return makeMockElement(); },
    querySelector(sel) { if (sel === '.app') return makeMockElement(); return null; },
    querySelectorAll() { return []; },
    createElement() { return makeMockElement(); },
    createTextNode() { return makeMockElement(); },
    addEventListener() {},
    removeEventListener() {},
    body: makeMockElement(),
    head: makeMockElement(),
    documentElement: makeMockElement(),
    location: { href: 'http://localhost:8080/', origin: 'http://localhost:8080', pathname: '/' },
  },
  S: {},
  DB: {
    load(key) { try { const v = _ls['kailion_ark_' + key]; return v ? JSON.parse(v) : null; } catch(e) { return null; } },
    save(key, val) { _ls['kailion_ark_' + key] = JSON.stringify(val); },
  },
  process,
  _ls,
  addEventListener() {}, removeEventListener() {},
  matchMedia() { return { matches: false, addListener() {}, removeListener() {} }; },
  innerWidth: 1024, innerHeight: 768,
};
context.window = context;
context.global = context;
context.self = context;
context.top = context;

vm.createContext(context);

// ---- 测试代码（与脚本同一词法作用域，可访问 let S / const now / const uid / 各 function）----
const testCode = `
// ===== 测试基础设施 =====
let __passed = 0, __failed = 0;
const __failures = [];
function __assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function __assertEq(a, b, msg) { if (a !== b) throw new Error((msg||'') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

async function __test(name, fn) {
  try {
    __resetState();
    await fn();
    console.log('✅ ' + name);
    __passed++;
  } catch(e) {
    console.log('❌ ' + name + ' — ' + e.message);
    __failures.push(name + ': ' + e.message);
    __failed++;
  }
}

function __resetState() {
  S.customers = [];
  S.drafts = [];
  S.outreachKnowledgeBase = [];
  S.communications = [];
  S.campaigns = [];
  S.campaignCustomerTasks = [];
  S.inquiries = []; S.plans = []; S.quotes = []; S.contracts = []; S.followups = [];
  for (const k in _ls) delete _ls[k];
}

// 测试数据构造器
function __mkCustomer(overrides) {
  return Object.assign({
    id: 'cust_1', company: 'Test GmbH', country: '德国', website: 'https://test.de',
    stableId: 'stable_test', identityKey: 'test_gmbh', identityAliases: ['domain:test.de'],
    doNotContact: false, contact: { email: 'info@test.de' },
  }, overrides || {});
}
function __mkArchive(overrides) {
  return Object.assign({
    archiveId: 'okb_1', customerId: 'cust_1', stableCustomerId: 'stable_test',
    identityResolutionStatus: 'resolved', duplicateStatus: 'unique',
    doNotContact: false, normalizedDomain: 'test.de',
    customerName: 'Test GmbH', country: '德国',
  }, overrides || {});
}
function __mkCampaign(overrides) {
  return Object.assign({ campaignId: 'camp_1', name: 'Test Campaign', status: 'active', providerPolicy: 'online_safe' }, overrides || {});
}
function __mkTask(overrides) {
  return Object.assign({
    taskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1', stableCustomerId: 'stable_test',
    outreachArchiveId: 'okb_1', stage: 'queued', assignedDraftId: null,
    auditHistory: [], priority: 'medium', addedAt: now(), lastUpdatedAt: now(),
  }, overrides || {});
}
function __mkDraft(overrides) {
  return Object.assign({
    id: 'draft_1', customerId: 'cust_1', campaignId: null, campaignTaskId: null,
    status: '待审核', reviewStatus: 'unreviewed', sentAt: null,
    subject: 'Test', body: 'Test body', content: 'Test body',
    createdAt: now(), manuallyEdited: false, previousVersions: [],
  }, overrides || {});
}

// Mock generateOutreachEmailDraft
let __generateCalled = false;
let __generateMock = async function() {
  __generateCalled = true;
  return { subject: 'Mock Subject', body: 'Mock body content', aiNotes: ['mock'], knowledgeContext: 'mock ctx' };
};
// 保存原始引用（脚本中是 async function 声明，可重赋值）
const __origGenerate = generateOutreachEmailDraft;

function __installGenerateMock(fn) {
  __generateCalled = false;
  generateOutreachEmailDraft = fn || __generateMock;
}
function __restoreGenerate() { generateOutreachEmailDraft = __origGenerate; }

// ===== 测试用例 =====

async function runAllTests() {

// --- 一、身份 fail-closed ---

await __test('1. evaluateCustomerForCampaign: unknown identity 不因 customerId 匹配而通过', () => {
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: undefined }));
  S.campaigns.push(__mkCampaign());
  const r = evaluateCustomerForCampaign('camp_1', 'cust_1');
  __assert(!r.eligible, 'should not be eligible');
  __assert(r.blockers.some(b => b.indexOf('身份') >= 0), 'should have identity blocker, got: ' + JSON.stringify(r.blockers));
});

await __test('2. evaluateCustomerForCampaign: ambiguous identity 被阻断', () => {
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'ambiguous' }));
  S.campaigns.push(__mkCampaign());
  const r = evaluateCustomerForCampaign('camp_1', 'cust_1');
  __assert(!r.eligible, 'ambiguous should not be eligible');
});

await __test('3. evaluateCustomerForCampaign: resolved identity 通过', () => {
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  const r = evaluateCustomerForCampaign('camp_1', 'cust_1');
  __assert(r.eligible, 'resolved should be eligible, blockers: ' + JSON.stringify(r.blockers));
});

await __test('4. generateCampaignTaskDraft: 初步身份 unknown 时不调用生成 mock', async () => {
  __installGenerateMock();
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: undefined }));
  S.campaigns.push(__mkCampaign());
  S.campaignCustomerTasks.push(__mkTask({ stage: 'queued' }));
  const r = await generateCampaignTaskDraft('task_1');
  __assert(!r.success, 'should fail');
  __assert(!__generateCalled, 'generate mock should NOT be called for unknown identity');
  __restoreGenerate();
});

await __test('5. generateCampaignTaskDraft: resolved identity 正常生成', async () => {
  __installGenerateMock();
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  S.campaignCustomerTasks.push(__mkTask({ stage: 'queued' }));
  const r = await generateCampaignTaskDraft('task_1');
  __assert(r.success, 'should succeed, got: ' + JSON.stringify(r.errors));
  __assert(r.draft, 'should return draft');
  __assertEq(r.task.stage, 'draft_pending_review', 'task stage');
  __assertEq(r.task.assignedDraftId, r.draft.id, 'task assignedDraftId');
  __assertEq(r.draft.campaignTaskId, 'task_1', 'draft campaignTaskId');
  __restoreGenerate();
});

await __test('6. regenerateCampaignTaskDraft: unknown identity 被阻断', async () => {
  __installGenerateMock();
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: undefined }));
  S.campaigns.push(__mkCampaign());
  const draft = __mkDraft({ campaignId: 'camp_1', campaignTaskId: 'task_1', reviewStatus: 'reviewed', status: '已审核' });
  S.drafts.push(draft);
  S.campaignCustomerTasks.push(__mkTask({ stage: 'reviewed_ready', assignedDraftId: 'draft_1' }));
  const r = await regenerateCampaignTaskDraft('task_1');
  __assert(!r.success, 'should fail for unknown identity');
  __assert(!__generateCalled, 'generate mock should NOT be called');
  __restoreGenerate();
});

// --- 二、迁移完整性 ---

await __test('7. completed migration + customer 缺 stableId → 自动修复并持久化', () => {
  _ls['kailion_ark_customerIdentityMigration'] = JSON.stringify({ version: 'v78.2', status: 'completed' });
  S.customers.push(__mkCustomer({ stableId: undefined, identityKey: undefined, identityAliases: undefined }));
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: undefined }));
  const r = migrateCustomerIdentities();
  __assert(S.customers[0].stableId, 'customer should get stableId');
  __assert(S.customers[0].identityKey, 'customer should get identityKey');
  __assert(Array.isArray(S.customers[0].identityAliases), 'customer should get identityAliases');
  // 持久化验证
  const saved = JSON.parse(_ls['kailion_ark_customers']);
  __assert(saved && saved[0] && saved[0].stableId, 'customers should be persisted');
});

await __test('8. completed migration + archive 缺状态 → 重新执行完整性修复', () => {
  _ls['kailion_ark_customerIdentityMigration'] = JSON.stringify({ version: 'v78.2', status: 'completed' });
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: undefined }));
  const r = migrateCustomerIdentities();
  const archive = S.outreachKnowledgeBase[0];
  __assert(archive.identityResolutionStatus === 'resolved', 'archive should get resolved, got: ' + archive.identityResolutionStatus);
  const savedArchive = JSON.parse(_ls['kailion_ark_outreachKnowledgeBase']);
  __assert(savedArchive && savedArchive[0] && savedArchive[0].identityResolutionStatus === 'resolved', 'archive should be persisted with resolved');
});

await __test('9. ambiguous archive 不因直接 customerId 猜测而改成 resolved', () => {
  _ls['kailion_ark_customerIdentityMigration'] = JSON.stringify({ version: 'v78.2', status: 'completed' });
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'ambiguous', customerId: 'cust_1' }));
  // 完整性检查会因 archive 状态合法（ambiguous 是合法值）而通过？
  // 不——完整性检查只检查 unknown 状态，ambiguous 是合法的。所以 completed + ambiguous 会跳过。
  // 但我们要测试的是：即使重新运行，ambiguous 也不会被改成 resolved。
  // 强制重新运行：删除 migration state
  delete _ls['kailion_ark_customerIdentityMigration'];
  const r = migrateCustomerIdentities();
  __assertEq(S.outreachKnowledgeBase[0].identityResolutionStatus, 'ambiguous', 'ambiguous should remain');
});

await __test('10. 手工绑定的 resolved archive 保持不变', () => {
  delete _ls['kailion_ark_customerIdentityMigration'];
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved', identityResolutionMethod: 'manual', identityResolvedAt: '2026-01-01' }));
  const before = JSON.stringify(S.outreachKnowledgeBase[0]);
  const r = migrateCustomerIdentities();
  const after = JSON.stringify(S.outreachKnowledgeBase[0]);
  __assertEq(after, before, 'manual resolved archive should not change');
});

await __test('11. 完整数据 + completed 状态 → 真正跳过 (alreadyMigrated)', () => {
  _ls['kailion_ark_customerIdentityMigration'] = JSON.stringify({ version: 'v78.2', status: 'completed' });
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  const r = migrateCustomerIdentities();
  __assert(r.alreadyMigrated === true, 'should return alreadyMigrated');
  __assertEq(r.status, 'completed', 'status');
});

await __test('12. 迁移失败时恢复内存', () => {
  delete _ls['kailion_ark_customerIdentityMigration'];
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: undefined, customerId: 'legacy_old' }));
  const beforeCustomers = JSON.stringify(S.customers);
  const beforeArchives = JSON.stringify(S.outreachKnowledgeBase);
  // 让 DB.save 抛出
  const origSave = DB.save;
  DB.save = function(key) { if (key === 'outreachKnowledgeBase') throw new Error('simulated save failure'); origSave.apply(this, arguments); };
  try {
    const r = migrateCustomerIdentities();
    __assertEq(r.status, 'failed', 'should report failed');
  } finally {
    DB.save = origSave;
  }
  // 内存应已恢复（archive 不应被修改为 resolved 并保留）
  // 注意：safePersist 会恢复内存，catch 也会恢复
  __assertEq(JSON.stringify(S.customers), beforeCustomers, 'customers memory restored');
});

// --- 三、独占关联严格双向 ---

await __test('13. 单边 draft.campaignTaskId（task.assignedDraftId 为空）被阻断', () => {
  S.drafts.push(__mkDraft({ campaignTaskId: 'task_1', campaignId: 'camp_1' }));
  S.campaignCustomerTasks.push(__mkTask({ assignedDraftId: null }));
  const r = getExclusiveCampaignTaskByDraftId('draft_1');
  __assert(!r.success, 'should fail');
  __assertEq(r.conflict, 'missing_reverse_link', 'conflict type');
});

await __test('14. 单边 task.assignedDraftId（draft.campaignTaskId 为空）被阻断', () => {
  S.drafts.push(__mkDraft({ campaignTaskId: null, campaignId: null }));
  S.campaignCustomerTasks.push(__mkTask({ assignedDraftId: 'draft_1' }));
  const r = getExclusiveCampaignTaskByDraftId('draft_1');
  __assert(!r.success, 'should fail');
  __assertEq(r.conflict, 'missing_forward_link', 'conflict type');
});

await __test('15. draft 指向 A、另一个 task B 引用同一 Draft 被阻断', () => {
  S.drafts.push(__mkDraft({ campaignTaskId: 'task_A', campaignId: 'camp_1' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_A', assignedDraftId: 'draft_1' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_B', assignedDraftId: 'draft_1' }));
  const r = getExclusiveCampaignTaskByDraftId('draft_1');
  __assert(!r.success, 'should fail for multiple references');
  __assertEq(r.conflict, 'multiple_task_references', 'conflict type');
});

await __test('16. campaignId 不一致被阻断', () => {
  S.drafts.push(__mkDraft({ campaignTaskId: 'task_1', campaignId: 'camp_OTHER' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', campaignId: 'camp_1', assignedDraftId: 'draft_1' }));
  const r = getExclusiveCampaignTaskByDraftId('draft_1');
  __assert(!r.success, 'should fail');
  __assertEq(r.conflict, 'campaign_mismatch', 'conflict type');
});

await __test('17. customerId 不一致被阻断', () => {
  S.drafts.push(__mkDraft({ campaignTaskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_OTHER' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1', assignedDraftId: 'draft_1' }));
  const r = getExclusiveCampaignTaskByDraftId('draft_1');
  __assert(!r.success, 'should fail');
  __assertEq(r.conflict, 'customer_mismatch', 'conflict type');
});

await __test('18. 严格双向一致关联通过', () => {
  S.drafts.push(__mkDraft({ campaignTaskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1', assignedDraftId: 'draft_1' }));
  const r = getExclusiveCampaignTaskByDraftId('draft_1');
  __assert(r.success, 'should succeed');
  __assertEq(r.task.taskId, 'task_1', 'task id');
});

await __test('19. 普通非 Campaign Draft 返回 noLink', () => {
  S.drafts.push(__mkDraft({ campaignTaskId: null, campaignId: null }));
  const r = getExclusiveCampaignTaskByDraftId('draft_1');
  __assert(r.success, 'should succeed');
  __assert(r.noLink === true, 'should be noLink');
  __assert(r.task === null, 'task should be null');
});

// --- 四、syncCampaignTasksFromDraft 无 ReferenceError ---

await __test('20. syncCampaignTasksFromDraft() 实际调用无 ReferenceError', () => {
  S.drafts.push(__mkDraft({ campaignTaskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1', assignedDraftId: 'draft_1', stage: 'queued' }));
  let threw = false;
  try {
    const r = syncCampaignTasksFromDraft('draft_1');
    __assert(r.success, 'should succeed, got: ' + JSON.stringify(r));
  } catch(e) {
    threw = true;
    if (e instanceof ReferenceError) throw new Error('ReferenceError: ' + e.message);
    throw e;
  }
  __assert(!threw, 'should not throw');
});

await __test('21. syncCampaignTasksFromDraft 无关联返回空结果', () => {
  S.drafts.push(__mkDraft({ campaignTaskId: null, campaignId: null }));
  const r = syncCampaignTasksFromDraft('draft_1');
  __assert(r.success, 'should succeed');
  __assert(r.noLink === true, 'should be noLink');
  __assertEq(r.synced, 0, 'synced count');
});

await __test('22. sync 遇关联冲突不修改数据', () => {
  S.drafts.push(__mkDraft({ campaignTaskId: 'task_1', campaignId: 'camp_1' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', assignedDraftId: null, stage: 'queued' }));
  const beforeStage = S.campaignCustomerTasks[0].stage;
  const r = syncCampaignTasksFromDraft('draft_1');
  __assert(!r.success, 'should fail for conflict');
  __assertEq(S.campaignCustomerTasks[0].stage, beforeStage, 'task stage should not change');
});

// --- 五、异步二次校验 ---

await __test('23. 重新生成期间身份变 ambiguous 被阻断', async () => {
  __installGenerateMock(async function() {
    __generateCalled = true;
    const a = S.outreachKnowledgeBase.find(x => x.archiveId === 'okb_1');
    if (a) a.identityResolutionStatus = 'ambiguous';
    return { subject: 'M', body: 'B', aiNotes: ['m'], knowledgeContext: 'k' };
  });
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignId: 'camp_1', campaignTaskId: 'task_1', reviewStatus: 'reviewed', status: '已审核' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', stage: 'reviewed_ready', assignedDraftId: 'draft_1' }));
  const r = await regenerateCampaignTaskDraft('task_1');
  __assert(!r.success, 'should fail');
  __assert(r.errors.some(e => e.indexOf('身份') >= 0), 'should mention identity, got: ' + JSON.stringify(r.errors));
  __restoreGenerate();
});

await __test('24. 重新生成期间去重变 duplicate 被阻断', async () => {
  __installGenerateMock(async function() {
    __generateCalled = true;
    const a = S.outreachKnowledgeBase.find(x => x.archiveId === 'okb_1');
    if (a) a.duplicateStatus = 'duplicate';
    return { subject: 'M', body: 'B', aiNotes: ['m'], knowledgeContext: 'k' };
  });
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved', duplicateStatus: 'unique' }));
  S.campaigns.push(__mkCampaign());
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignId: 'camp_1', campaignTaskId: 'task_1', reviewStatus: 'reviewed', status: '已审核' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', stage: 'reviewed_ready', assignedDraftId: 'draft_1' }));
  const r = await regenerateCampaignTaskDraft('task_1');
  __assert(!r.success, 'should fail');
  __assert(r.errors.some(e => e.indexOf('去重') >= 0), 'should mention duplicate, got: ' + JSON.stringify(r.errors));
  __restoreGenerate();
});

await __test('25. 重新生成期间 task 变 suppressed 被阻断', async () => {
  __installGenerateMock(async function() {
    __generateCalled = true;
    const t = S.campaignCustomerTasks.find(x => x.taskId === 'task_1');
    if (t) t.stage = 'suppressed';
    return { subject: 'M', body: 'B', aiNotes: ['m'], knowledgeContext: 'k' };
  });
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignId: 'camp_1', campaignTaskId: 'task_1', reviewStatus: 'reviewed', status: '已审核' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', stage: 'reviewed_ready', assignedDraftId: 'draft_1' }));
  const r = await regenerateCampaignTaskDraft('task_1');
  __assert(!r.success, 'should fail when task becomes suppressed during regeneration');
  __restoreGenerate();
});

await __test('26. 重新生成期间 Draft 改绑其他 task 被阻断', async () => {
  __installGenerateMock(async function() {
    __generateCalled = true;
    const t = S.campaignCustomerTasks.find(x => x.taskId === 'task_1');
    if (t) t.assignedDraftId = 'draft_OTHER';
    return { subject: 'M', body: 'B', aiNotes: ['m'], knowledgeContext: 'k' };
  });
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignId: 'camp_1', campaignTaskId: 'task_1', reviewStatus: 'reviewed', status: '已审核' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', stage: 'reviewed_ready', assignedDraftId: 'draft_1' }));
  const r = await regenerateCampaignTaskDraft('task_1');
  __assert(!r.success, 'should fail');
  __restoreGenerate();
});

// --- 六、发送 reconciliation ---

await __test('27. send reconciliation 同步并持久化 archive', () => {
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignId: 'camp_1', campaignTaskId: 'task_1', customerId: 'cust_1', status: '已发送', sentAt: '2026-01-01', reviewStatus: 'reviewed' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1', stage: 'reviewed_ready', assignedDraftId: 'draft_1' }));
  const r = markCampaignTaskManuallySent('task_1');
  __assert(r.success, 'should succeed, got: ' + JSON.stringify(r.errors));
  __assert(r.reconciled === true, 'should be reconciled');
  __assertEq(S.campaignCustomerTasks[0].stage, 'sent', 'task stage should be sent');
  // archive 应被持久化
  const savedArchive = JSON.parse(_ls['kailion_ark_outreachKnowledgeBase']);
  __assert(savedArchive && savedArchive.length > 0, 'archive should be persisted');
});

await __test('28. reconciliation archive 保存失败完整补偿', () => {
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignId: 'camp_1', campaignTaskId: 'task_1', customerId: 'cust_1', status: '已发送', sentAt: '2026-01-01', reviewStatus: 'reviewed' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1', stage: 'reviewed_ready', assignedDraftId: 'draft_1' }));
  const beforeStage = S.campaignCustomerTasks[0].stage;
  const origSave = DB.save;
  DB.save = function(key) { if (key === 'outreachKnowledgeBase') throw new Error('simulated archive save failure'); origSave.apply(this, arguments); };
  try {
    const r = markCampaignTaskManuallySent('task_1');
    __assert(!r.success, 'should fail');
  } finally {
    DB.save = origSave;
  }
  // 内存应恢复：task stage 不应是 sent
  __assertEq(S.campaignCustomerTasks[0].stage, beforeStage, 'task stage should be restored after failure');
});

// --- 七、人工发送安全检查 ---

await __test('29. queued task 即使 Draft reviewed 也不能直接标记发送', () => {
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignId: 'camp_1', campaignTaskId: 'task_1', customerId: 'cust_1', reviewStatus: 'reviewed', status: '已审核' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1', stage: 'queued', assignedDraftId: 'draft_1' }));
  const r = markCampaignTaskManuallySent('task_1');
  __assert(!r.success, 'should fail for queued task');
  __assert(r.conflict === 'stage_mismatch' || (r.errors && r.errors.some(e => e.indexOf('阶段') >= 0)), 'should report stage mismatch, got: ' + JSON.stringify(r));
  __assertEq(S.campaignCustomerTasks[0].stage, 'queued', 'stage should remain queued');
});

await __test('30. reviewed_ready task + reviewed draft 正常标记发送', () => {
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignId: 'camp_1', campaignTaskId: 'task_1', customerId: 'cust_1', reviewStatus: 'reviewed', status: '已审核' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1', stage: 'reviewed_ready', assignedDraftId: 'draft_1' }));
  const r = markCampaignTaskManuallySent('task_1');
  __assert(r.success, 'should succeed, got: ' + JSON.stringify(r.errors));
  __assertEq(S.campaignCustomerTasks[0].stage, 'sent', 'task stage');
  __assertEq(S.drafts[0].status, '已发送', 'draft status');
  __assertEq(S.drafts[0].manualSendSource, 'manual_mark', 'manualSendSource');
  __assertEq(S.drafts[0].deliveryStatus, 'unknown', 'deliveryStatus');
});

await __test('31. alreadySent 幂等：已 sent 状态直接返回不修改', () => {
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignId: 'camp_1', campaignTaskId: 'task_1', customerId: 'cust_1', status: '已发送', sentAt: '2026-01-01T00:00:00Z', reviewStatus: 'reviewed', manualSendSource: 'manual_mark', deliveryStatus: 'unknown' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', campaignId: 'camp_1', customerId: 'cust_1', stage: 'sent', assignedDraftId: 'draft_1' }));
  const beforeSentAt = S.drafts[0].sentAt;
  const r = markCampaignTaskManuallySent('task_1');
  __assert(r.success, 'should succeed');
  __assert(r.alreadySent === true, 'should be alreadySent');
  __assertEq(S.drafts[0].sentAt, beforeSentAt, 'sentAt should not change');
});

await __test('32. 关联冲突时标记发送被阻断', () => {
  S.customers.push(__mkCustomer());
  S.outreachKnowledgeBase.push(__mkArchive({ identityResolutionStatus: 'resolved' }));
  S.campaigns.push(__mkCampaign());
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignTaskId: 'task_1', campaignId: 'camp_1', reviewStatus: 'reviewed' }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', assignedDraftId: null, stage: 'reviewed_ready' }));
  const r = markCampaignTaskManuallySent('task_1');
  __assert(!r.success, 'should fail for missing reverse link');
});

// --- 八、普通非 Campaign Draft 幂等 ---

await __test('33. 普通 Draft 重复标记发送不覆盖 sentAt', () => {
  S.customers.push(__mkCustomer());
  S.drafts.push(__mkDraft({ id: 'draft_1', customerId: 'cust_1', campaignId: null, campaignTaskId: null, status: '已发送', sentAt: '2026-01-01T00:00:00Z', reviewStatus: 'reviewed' }));
  const beforeSentAt = S.drafts[0].sentAt;
  // markSent 是 UI 函数，会调用 toast/closeDrawer/renderView，这些在 mock 环境中存在
  markSent('draft_1');
  __assertEq(S.drafts[0].sentAt, beforeSentAt, 'sentAt should not be overwritten');
  __assertEq(S.drafts[0].status, '已发送', 'status should remain 已发送');
});

await __test('34. 普通 Draft 重复标记发送不执行 DB.save', () => {
  S.customers.push(__mkCustomer());
  S.drafts.push(__mkDraft({ id: 'draft_1', customerId: 'cust_1', campaignId: null, campaignTaskId: null, status: '已发送', sentAt: '2026-01-01T00:00:00Z', reviewStatus: 'reviewed' }));
  const origSave = DB.save;
  let saveCalled = false;
  DB.save = function() { saveCalled = true; origSave.apply(this, arguments); };
  try {
    markSent('draft_1');
  } finally {
    DB.save = origSave;
  }
  __assert(!saveCalled, 'DB.save should NOT be called for idempotent markSent');
});

// --- 九、回归测试（原有功能不被破坏）---

await __test('35. normalizeIdentityResolutionStatus: 空值返回 unknown', () => {
  __assertEq(normalizeIdentityResolutionStatus(null), 'unknown');
  __assertEq(normalizeIdentityResolutionStatus(undefined), 'unknown');
  __assertEq(normalizeIdentityResolutionStatus(''), 'unknown');
  __assertEq(normalizeIdentityResolutionStatus('garbage'), 'unknown');
});

await __test('36. normalizeIdentityResolutionStatus: 合法值正确映射', () => {
  __assertEq(normalizeIdentityResolutionStatus('resolved'), 'resolved');
  __assertEq(normalizeIdentityResolutionStatus('Resolved'), 'resolved');
  __assertEq(normalizeIdentityResolutionStatus('ambiguous'), 'ambiguous');
  __assertEq(normalizeIdentityResolutionStatus('unresolved'), 'unresolved');
});

await __test('37. normalizeDraftReviewStatus: reviewed/unreviewed/rejected/unknown', () => {
  __assertEq(normalizeDraftReviewStatus({reviewStatus:'reviewed'}), 'reviewed');
  __assertEq(normalizeDraftReviewStatus({reviewStatus:'approved'}), 'reviewed');
  __assertEq(normalizeDraftReviewStatus({reviewStatus:'unreviewed'}), 'unreviewed');
  __assertEq(normalizeDraftReviewStatus({reviewStatus:'rejected'}), 'rejected');
  __assertEq(normalizeDraftReviewStatus({status:'已审核'}), 'reviewed');
  __assertEq(normalizeDraftReviewStatus({status:'待审核'}), 'unreviewed');
  __assertEq(normalizeDraftReviewStatus({}), 'unknown');
});

await __test('38. safePersistOutreachWorkflowData: 成功保存', () => {
  S.drafts = [{id:'d1'}];
  const snap = createOutreachWorkflowSnapshot();
  S.drafts[0].id = 'd1_modified';
  const r = safePersistOutreachWorkflowData(snap, ['drafts']);
  __assert(r.success, 'should succeed');
  __assert(r.compensationComplete, 'compensation complete');
});

await __test('39. safePersistOutreachWorkflowData: 失败时补偿恢复', () => {
  S.drafts = [{id:'d1'}];
  S.outreachKnowledgeBase = [{archiveId:'a1'}];
  const snap = createOutreachWorkflowSnapshot();
  S.drafts[0].id = 'd1_modified';
  S.outreachKnowledgeBase[0].archiveId = 'a1_modified';
  const origSave = DB.save;
  DB.save = function(key) { if (key === 'outreachKnowledgeBase') throw new Error('fail'); origSave.apply(this, arguments); };
  try {
    const r = safePersistOutreachWorkflowData(snap, ['drafts','outreachKnowledgeBase']);
    __assert(!r.success, 'should fail');
  } finally {
    DB.save = origSave;
  }
  // 内存应恢复
  __assertEq(S.drafts[0].id, 'd1', 'drafts restored');
  __assertEq(S.outreachKnowledgeBase[0].archiveId, 'a1', 'archive restored');
});

await __test('40. linkDraftToCampaignTask: 正常关联', () => {
  S.drafts.push(__mkDraft({ id: 'draft_1', campaignId: null, campaignTaskId: null }));
  S.campaignCustomerTasks.push(__mkTask({ taskId: 'task_1', assignedDraftId: null }));
  const r = linkDraftToCampaignTask('task_1', 'draft_1');
  __assert(r.success, 'should succeed');
  __assertEq(S.campaignCustomerTasks[0].assignedDraftId, 'draft_1');
  __assertEq(S.drafts[0].campaignTaskId, 'task_1');
});

// ===== 五、迁移损坏关联修复与事务原子性（第三轮新增） =====

await __test('41. completed + resolved invalid customerId + 唯一候选 → 修复为 resolved', () => {
  DB.save('customerIdentityMigration', { version: CUSTOMER_IDENTITY_MIGRATION_VERSION, status: 'completed' });
  S.customers.push({ id: 'cust_real', company: 'Real Co', stableId: 'st_real', identityKey: 'key_real', identityAliases: ['domain:real.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'old_nonexistent', identityResolutionStatus: 'resolved', identityResolutionMethod: 'direct_id', normalizedDomain: 'real.de' });
  migrateCustomerIdentities();
  const arch = S.outreachKnowledgeBase[0];
  __assertEq(arch.customerId, 'cust_real', 'should re-bind to real customer');
  __assertEq(arch.identityResolutionStatus, 'resolved', 'should remain resolved');
  __assert(arch.legacyCustomerIds && arch.legacyCustomerIds.includes('old_nonexistent'), 'should preserve old id in legacyCustomerIds');
});

await __test('42. completed + resolved invalid customerId + 同分候选 → ambiguous', () => {
  DB.save('customerIdentityMigration', { version: CUSTOMER_IDENTITY_MIGRATION_VERSION, status: 'completed' });
  S.customers.push({ id: 'cust_a', company: 'A Co', stableId: 'st_a', identityKey: 'key_a', identityAliases: ['domain:shared.de'] });
  S.customers.push({ id: 'cust_b', company: 'B Co', stableId: 'st_b', identityKey: 'key_b', identityAliases: ['domain:shared.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'old_nonexistent', identityResolutionStatus: 'resolved', identityResolutionMethod: 'direct_id', normalizedDomain: 'shared.de' });
  migrateCustomerIdentities();
  const arch = S.outreachKnowledgeBase[0];
  __assertEq(arch.identityResolutionStatus, 'ambiguous', 'should become ambiguous');
  __assert(arch.identityCandidates && arch.identityCandidates.length === 2, 'should have 2 candidates');
});

await __test('43. completed + resolved invalid customerId + 无候选 → unresolved', () => {
  DB.save('customerIdentityMigration', { version: CUSTOMER_IDENTITY_MIGRATION_VERSION, status: 'completed' });
  S.customers.push({ id: 'cust_a', company: 'A Co', stableId: 'st_a', identityKey: 'key_a', identityAliases: ['domain:other.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'old_nonexistent', identityResolutionStatus: 'resolved', identityResolutionMethod: 'direct_id', normalizedDomain: 'nomatch.de' });
  migrateCustomerIdentities();
  const arch = S.outreachKnowledgeBase[0];
  __assertEq(arch.identityResolutionStatus, 'unresolved', 'should become unresolved');
});

await __test('44. 已人工绑定的 resolved archive 不被覆盖', () => {
  DB.save('customerIdentityMigration', { version: CUSTOMER_IDENTITY_MIGRATION_VERSION, status: 'completed' });
  S.customers.push({ id: 'cust_a', company: 'A Co', stableId: 'st_a', identityKey: 'key_a', identityAliases: ['domain:manual.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'old_invalid', identityResolutionStatus: 'resolved', identityResolutionMethod: 'manual_bind', normalizedDomain: 'manual.de' });
  migrateCustomerIdentities();
  const arch = S.outreachKnowledgeBase[0];
  __assertEq(arch.customerId, 'old_invalid', 'manual_bind should not be overwritten');
  __assertEq(arch.identityResolutionMethod, 'manual_bind', 'method should remain manual_bind');
});

await __test('45. 修复后 checkIdentityMigrationIntegrity() 返回 complete:true', () => {
  DB.save('customerIdentityMigration', { version: CUSTOMER_IDENTITY_MIGRATION_VERSION, status: 'completed' });
  S.customers.push({ id: 'cust_real', company: 'Real Co', stableId: 'st_real', identityKey: 'key_real', identityAliases: ['domain:real.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'old_nonexistent', identityResolutionStatus: 'resolved', identityResolutionMethod: 'direct_id', normalizedDomain: 'real.de' });
  migrateCustomerIdentities();
  const integrity = checkIdentityMigrationIntegrity();
  __assertEq(integrity.complete, true, 'integrity should be complete after repair, issues: ' + JSON.stringify(integrity.issues));
});

await __test('46. ambiguous/unresolved 不被自动升级', () => {
  DB.save('customerIdentityMigration', { version: CUSTOMER_IDENTITY_MIGRATION_VERSION, status: 'completed' });
  S.customers.push({ id: 'cust_a', company: 'A Co', stableId: 'st_a', identityKey: 'key_a', identityAliases: ['domain:amb.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'cust_a', identityResolutionStatus: 'ambiguous', normalizedDomain: 'amb.de' });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_2', customerId: 'cust_a', identityResolutionStatus: 'unresolved', normalizedDomain: 'amb.de' });
  migrateCustomerIdentities();
  __assertEq(S.outreachKnowledgeBase[0].identityResolutionStatus, 'ambiguous', 'ambiguous should not be upgraded');
  __assertEq(S.outreachKnowledgeBase[1].identityResolutionStatus, 'unresolved', 'unresolved should not be upgraded');
});

await __test('47. migrationState 保存失败时数据集合和 migrationState 均恢复存储原值', () => {
  DB.save('customerIdentityMigration', { version: CUSTOMER_IDENTITY_MIGRATION_VERSION, status: 'completed' });
  S.customers.push({ id: 'cust_real', company: 'Real Co', stableId: 'st_real', identityKey: 'key_real', identityAliases: ['domain:real.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'old_nonexistent', identityResolutionStatus: 'resolved', identityResolutionMethod: 'direct_id', normalizedDomain: 'real.de' });
  const origSave = DB.save;
  DB.save = function(key) {
    if (key === 'customerIdentityMigration') throw new Error('migrationState save failure');
    return origSave.apply(this, arguments);
  };
  try {
    const r = migrateCustomerIdentities();
    __assertEq(r.status, 'failed', 'should report failed');
  } finally {
    DB.save = origSave;
  }
  const storedArchives = DB.load('outreachKnowledgeBase');
  __assertEq(storedArchives[0].customerId, 'old_nonexistent', 'archive storage should be rolled back');
  const storedMigration = DB.load('customerIdentityMigration');
  __assertEq(storedMigration.status, 'completed', 'migrationState should remain original completed');
});

await __test('48. 中间集合保存失败时 migrationState 不被更新', () => {
  DB.save('customerIdentityMigration', { version: CUSTOMER_IDENTITY_MIGRATION_VERSION, status: 'completed' });
  S.customers.push({ id: 'cust_real', company: 'Real Co', stableId: 'st_real', identityKey: 'key_real', identityAliases: ['domain:real.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'old_nonexistent', identityResolutionStatus: 'resolved', identityResolutionMethod: 'direct_id', normalizedDomain: 'real.de' });
  const origSave = DB.save;
  DB.save = function(key) {
    if (key === 'outreachKnowledgeBase') throw new Error('archive save failure');
    return origSave.apply(this, arguments);
  };
  try {
    const r = migrateCustomerIdentities();
    __assertEq(r.status, 'failed', 'should report failed');
  } finally {
    DB.save = origSave;
  }
  const storedMigration = DB.load('customerIdentityMigration');
  __assertEq(storedMigration.status, 'completed', 'migrationState should not be updated');
});

await __test('49. safePersistMigrationTransaction 补偿失败返回 compensationComplete:false', () => {
  S.drafts = [{ id: 'd1' }];
  S.outreachKnowledgeBase = [{ archiveId: 'a1' }];
  const snapshot = createOutreachWorkflowSnapshot();
  const origSave = DB.save;
  let saveCount = 0;
  DB.save = function(key) {
    saveCount++;
    if (key === 'outreachKnowledgeBase') throw new Error('save failure');
    if (key === 'drafts' && saveCount > 1) throw new Error('compensation failure');
    return origSave.apply(this, arguments);
  };
  try {
    const r = safePersistMigrationTransaction(snapshot, ['drafts', 'outreachKnowledgeBase'], { status: 'completed' });
    __assertEq(r.success, false, 'should fail');
    __assertEq(r.compensationComplete, false, 'compensationComplete should be false');
  } finally {
    DB.save = origSave;
  }
});

await __test('50. 成功迁移后 migrationState 与数据集合一致落盘', () => {
  DB.save('customerIdentityMigration', { version: CUSTOMER_IDENTITY_MIGRATION_VERSION, status: 'completed' });
  S.customers.push({ id: 'cust_real', company: 'Real Co', stableId: 'st_real', identityKey: 'key_real', identityAliases: ['domain:real.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'old_nonexistent', identityResolutionStatus: 'resolved', identityResolutionMethod: 'direct_id', normalizedDomain: 'real.de' });
  const r = migrateCustomerIdentities();
  __assertEq(r.status, 'completed', 'should complete');
  const storedMigration = DB.load('customerIdentityMigration');
  __assertEq(storedMigration.status, 'completed', 'migrationState should be completed in storage');
  const storedArchives = DB.load('outreachKnowledgeBase');
  __assertEq(storedArchives[0].customerId, 'cust_real', 'archive should be persisted with new customerId');
});

await __test('51. safePersistMigrationTransaction 成功后所有集合与 migrationState 一致', () => {
  S.customers = [{ id: 'c1', stableId: 's1', identityKey: 'k1', identityAliases: [] }];
  S.outreachKnowledgeBase = [{ archiveId: 'a1' }];
  const snapshot = createOutreachWorkflowSnapshot();
  const r = safePersistMigrationTransaction(snapshot, ['customers', 'outreachKnowledgeBase'], { status: 'completed', version: 1 });
  __assertEq(r.success, true, 'should succeed');
  __assertEq(r.compensationComplete, true, 'compensationComplete should be true');
  const storedMigration = DB.load('customerIdentityMigration');
  __assertEq(storedMigration.status, 'completed', 'migrationState persisted');
  const storedCustomers = DB.load('customers');
  __assertEq(storedCustomers[0].id, 'c1', 'customers persisted');
});

// ===== 六、MigrationState dirty-write 原子补偿（第四轮新增） =====

await __test('52. migrationState 原本存在 + dirty write 后抛错 → 核心集合与 migrationState 均恢复原值', () => {
  // 预设原始 migrationState
  DB.save('customerIdentityMigration', { version: CUSTOMER_IDENTITY_MIGRATION_VERSION, status: 'completed', originalMarker: 'ORIGINAL' });
  S.customers.push({ id: 'cust_real', company: 'Real Co', stableId: 'st_real', identityKey: 'key_real', identityAliases: ['domain:real.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'old_nonexistent', identityResolutionStatus: 'resolved', identityResolutionMethod: 'direct_id', normalizedDomain: 'real.de' });
  const origSave = DB.save;
  DB.save = function(key, value) {
    if (key === 'customerIdentityMigration') {
      origSave.apply(this, arguments); // dirty write：先写入新值
      throw new Error('dirty write failure after write');
    }
    return origSave.apply(this, arguments);
  };
  try {
    const r = migrateCustomerIdentities();
    __assertEq(r.status, 'failed', 'should report failed');
  } finally {
    DB.save = origSave;
  }
  // 核心集合恢复：archive 仍为旧 customerId
  const storedArchives = DB.load('outreachKnowledgeBase');
  __assertEq(storedArchives[0].customerId, 'old_nonexistent', 'archive storage rolled back');
  // migrationState 恢复为原对象
  const storedMigration = DB.load('customerIdentityMigration');
  __assertEq(storedMigration.originalMarker, 'ORIGINAL', 'migrationState restored to original object');
  __assertEq(storedMigration.status, 'completed', 'migrationState status restored');
});

await __test('53. migrationState 原本不存在 + dirty write 后抛错 → 最终该 key 不存在', () => {
  // 确保 key 不存在
  DB.remove('customerIdentityMigration');
  S.customers.push({ id: 'cust_real', company: 'Real Co', stableId: 'st_real', identityKey: 'key_real', identityAliases: ['domain:real.de'] });
  S.outreachKnowledgeBase.push({ archiveId: 'arch_1', customerId: 'old_nonexistent', identityResolutionStatus: 'resolved', identityResolutionMethod: 'direct_id', normalizedDomain: 'real.de' });
  const origSave = DB.save;
  DB.save = function(key, value) {
    if (key === 'customerIdentityMigration') {
      origSave.apply(this, arguments); // dirty write
      throw new Error('dirty write failure after write');
    }
    return origSave.apply(this, arguments);
  };
  try {
    const r = migrateCustomerIdentities();
    __assertEq(r.status, 'failed', 'should report failed');
  } finally {
    DB.save = origSave;
  }
  // key 应被删除（补偿时 DB.remove）
  const raw = localStorage.getItem(PREFIX + 'customerIdentityMigration');
  __assertEq(raw, null, 'customerIdentityMigration key should not exist after compensation');
});

await __test('54. migrationState 补偿失败 → compensationComplete:false 且 errors 含 customerIdentityMigration', () => {
  DB.save('customerIdentityMigration', { status: 'completed', originalMarker: 'ORIG' });
  S.drafts = [{ id: 'd1' }];
  S.outreachKnowledgeBase = [{ archiveId: 'a1' }];
  const snapshot = createOutreachWorkflowSnapshot();
  const origSave = DB.save;
  let migCallCount = 0;
  DB.save = function(key, value) {
    if (key === 'customerIdentityMigration') {
      migCallCount++;
      if (migCallCount === 1) {
        origSave.apply(this, arguments); // dirty write
        throw new Error('dirty write failure');
      }
      // 补偿调用（第 2 次及以后）也抛错
      throw new Error('migrationState compensation failure');
    }
    return origSave.apply(this, arguments);
  };
  try {
    const r = safePersistMigrationTransaction(snapshot, ['drafts', 'outreachKnowledgeBase'], { status: 'pending_review' });
    __assertEq(r.success, false, 'should fail');
    __assertEq(r.compensationComplete, false, 'compensationComplete should be false');
    const hasMigError = r.compensationErrors.some(e => e.key === 'customerIdentityMigration');
    __assert(hasMigError, 'compensationErrors should contain customerIdentityMigration, got: ' + JSON.stringify(r.compensationErrors));
  } finally {
    DB.save = origSave;
  }
});

await __test('55. 补偿按逆序执行：migrationState 先于核心集合补偿', () => {
  DB.save('customerIdentityMigration', { status: 'completed' });
  S.drafts = [{ id: 'd1' }];
  S.outreachKnowledgeBase = [{ archiveId: 'a1' }];
  S.customers = [{ id: 'c1', stableId: 's1', identityKey: 'k1', identityAliases: [] }];
  const snapshot = createOutreachWorkflowSnapshot();
  const origSave = DB.save;
  const compensationOrder = [];
  let failureOccurred = false;
  DB.save = function(key, value) {
    if (key === 'customerIdentityMigration' && !failureOccurred) {
      failureOccurred = true;
      origSave.apply(this, arguments); // dirty write
      throw new Error('dirty write');
    }
    if (failureOccurred) compensationOrder.push(key);
    return origSave.apply(this, arguments);
  };
  try {
    safePersistMigrationTransaction(snapshot, ['drafts', 'outreachKnowledgeBase', 'customers'], { status: 'pending_review' });
  } finally {
    DB.save = origSave;
  }
  // migrationState 最后写入，应最先补偿
  __assertEq(compensationOrder[0], 'customerIdentityMigration', 'first compensated should be migrationState, got: ' + JSON.stringify(compensationOrder));
  // 核心集合按逆序：customers（最后保存）→ outreachKnowledgeBase → drafts（最先保存）
  // allKeys 顺序: drafts, campaignCustomerTasks, outreachKnowledgeBase, communications, customers
  // 所以保存顺序: drafts, outreachKnowledgeBase, customers
  // 逆序补偿: customers, outreachKnowledgeBase, drafts
  __assertEq(compensationOrder[1], 'customers', 'second should be customers');
  __assertEq(compensationOrder[2], 'outreachKnowledgeBase', 'third should be outreachKnowledgeBase');
  __assertEq(compensationOrder[3], 'drafts', 'fourth should be drafts');
});

// ===== 输出结果 =====
console.log('');
console.log('========================================');
console.log('V79.0D1 第三轮阻断修复测试结果');
console.log('通过: ' + __passed + ' / ' + (__passed + __failed));
console.log('失败: ' + __failed);
if (__failures.length > 0) {
  console.log('');
  console.log('失败详情:');
  __failures.forEach((f, i) => console.log('  ' + (i+1) + '. ' + f));
}
console.log('========================================');
if (__failed > 0) process.exit(1);
}

runAllTests().catch(e => { console.error('Test runner fatal:', e); process.exit(1); });
`;

// 拼接脚本 + 测试代码，在同一 vm 上下文中执行
const fullCode = scriptBlocks[0] + '\n;\n' + scriptBlocks[1] + '\n;\n' + testCode;

try {
  vm.runInContext(fullCode, context, { timeout: 60000 });
} catch (e) {
  console.error('FATAL: vm execution error:', e.message);
  console.error(e.stack);
  process.exit(1);
}
