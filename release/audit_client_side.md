# KaiLionCrafts 外贸获客工作台 — 客户端代码深度审计报告

- **审计日期**: 2026-10-03
- **审计范围**: 客户端代码（浏览器端 + 共享 JS）
- **审计模式**: 只读审计，未修改任何代码
- **分支**: ark-html-workbench (HEAD 18778ef)
- **审计人**: AI 代码审计 Agent

---

## 一、问题汇总（按严重等级排序）

### 🔴 HIGH（3 个）

---

#### H-01 模板编辑器 innerHTML 未转义用户输入 → 存储型 XSS 风险

- **文件**: `app.js`
- **行号**: 15231–15237
- **严重等级**: high
- **问题描述**: 模板编辑器通过字符串拼接生成 modal HTML，模板名称、描述、主题、正文均未经过 `esc()` 转义直接拼接到 DOM。若模板内容（来自 CSV 导入或 AI 生成）包含 `"`、`</textarea>` 等字符，可突破属性或标签边界，执行任意 JS。

**问题代码片段**:
```javascript
// 第15231行 — tpl.name 未 esc
'<input id="tplName" type="text" class="form-control" value="' + (tpl.name||'') + '" ...>'

// 第15233行 — tpl.desc 未 esc
'<input id="tplDesc" ... value="' + (tpl.desc||'') + '" ...>'

// 第15235行 — tpl.subject 未 esc
'<input id="tplSubject" ... value="' + (tpl.subject||'') + '" ...>'

// 第15237行 — tpl.body 未 esc，直接注入 textarea 内容区
'<textarea id="tplBody" ...>' + (tpl.body||'') + '</textarea>'
```

- **修复建议**: 所有 `tpl.xxx` 值拼接前调用 `esc(tpl.xxx || '')`，与项目其他表单渲染保持一致风格。注意 textarea 内容虽不需要转义引号，但需转义 `</textarea>` 闭合标签。

---

#### H-02 SMTP 邮箱密码明文存储 localStorage 并渲染到 DOM

- **文件**: `app.js`
- **行号**: 16533（渲染）、32909–32914（保存）、6179（persist 持久化）
- **严重等级**: high
- **问题描述**: SMTP 授权码/邮箱密码被明文存入 `S.smtpConfig.pass`，经 `DB.save('smtpConfig', ...)` 持久化到浏览器 localStorage，且在设置页通过 `value="${...pass...}"` 渲染到 DOM。任何 XSS 漏洞即可读取该密码；同时 localStorage 明文存储密码不符合安全基线。

**问题代码片段**:
```javascript
// 第16533行 — 密码明文渲染到 input value
<input type="password" id="smtp_pass" ... value="${(S.smtpConfig&&S.smtpConfig.pass)||''}">

// 第32909行 — 直接读取 input 值，无脱敏
pass: document.getElementById('smtp_pass').value,

// 第6179行 — 整体 persist 包含 smtpConfig
DB.save('mailQueue',S.mailQueue); DB.save('mailLogs',S.mailLogs); DB.save('smtpConfig',S.smtpConfig);
```

- **修复建议**:
  1. 设置页回显密码时使用占位符（如 `••••••`），不回显明文；
  2. 保存时若密码字段未修改则不覆盖原配置；
  3. 长期方案：将 SMTP 凭据移至服务端 `api_config.json`，前端不存储明文。

---

#### H-03 CampaignTaskResilience 空对象覆盖导致集成检测失效

- **文件**: `app.js`
- **行号**: 14819–14822
- **严重等级**: high
- **问题描述**: 初始化逻辑中，`window.CampaignTaskResilience = window.CampaignTaskResilience || {}` 在模块脚本未加载时会创建一个空对象。但后续所有集成函数（如 `initCampaignTaskResilience` 第14800行）均以 `typeof window.CampaignTaskResilience === 'undefined'` 作为"模块是否可用"的判断依据。空对象会使该判断恒为 `false`，进而调用不存在的方法（如 `initAllTasks`）抛出 TypeError。虽然顶层有 try-catch 兜底（第13736行），但功能会静默失效，且开发者误以为模块已加载。

**问题代码片段**:
```javascript
// 第14800行 — 以此判断模块是否加载
function initCampaignTaskResilience(){
  if(typeof window.CampaignTaskResilience === 'undefined') return;
  window.CampaignTaskResilience.initAllTasks(tasks); // 空对象时 initAllTasks 不存在 → TypeError
}

// 第14819-14822行 — 这里创建了空对象
if(typeof window !== 'undefined'){
  window.CampaignTaskResilience = window.CampaignTaskResilience || {};
  window.CampaignTaskResilience._manualRetryById = manualRetryCampaignTask;
}
```

- **修复建议**: 移除第14820行的 `|| {}` 兜底创建，改为先判断 `window.CampaignTaskResilience` 是否存在再挂载 `_manualRetryById`；或在所有集成函数中改用 `typeof window.CampaignTaskResilience?.initAllTasks === 'function'` 作为功能探测。

---

### 🟡 MEDIUM（8 个）

---

#### M-01 `esc()` 函数不转义单引号

- **文件**: `app.js`
- **行号**: 5874
- **严重等级**: medium
- **问题描述**: `esc()` 只转义 `& < > "`，不转义单引号 `'`。项目中大量使用 `onclick="func('${var}')"` 单引号包裹的属性拼接，若变量含单引号可突破属性。

```javascript
function esc(s){ return String(s==null?'':s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// 缺少 .replace(/'/g,'&#39;')
```

- **修复建议**: 在 esc() 中追加 `.replace(/'/g, '&#39;')`，使单引号属性也安全。

---

#### M-02 `persist()` 函数无整体 try-catch，localStorage 满时保存中断

- **文件**: `app.js`
- **行号**: 6153–6184
- **严重等级**: medium
- **问题描述**: `persist()` 连续调用约 60 次 `DB.save()`，DB.save 内部无 try-catch。若中途某个键触发 `QuotaExceededError`（localStorage 满），后续所有 `DB.save` 均不执行，且异常向上抛出可能导致 UI 渲染中断，部分数据丢失。

```javascript
function persist(){
  DB.save('customers',S.customers); DB.save('plans',S.plans); DB.save('drafts',S.drafts);
  // ... 约60行连续 DB.save，无 try-catch
}
```

- **修复建议**: 用 `try{ ... }catch(e){ console.error('[persist] 保存失败:', e); }` 包裹整个函数体，或在 DB.save 内部加 try-catch（参考第5862行，目前 save 无 catch）。

---

#### M-03 28 处空 catch 静默吞错

- **文件**: `app.js`
- **行号**: 47, 53, 60, 92, 917, 5706, 5846, 6895, 8673, 8745, 9699, 29834–29836, 30546, 31944, 32022, 32782, 32791, 32803, 33479, 33483, 33894, 34216, 34220, 35506, 39326
- **严重等级**: medium
- **问题描述**: 大量 `try{...}catch(e){}` 空块吞掉异常。其中多数是 `DB.save` 单点持久化失败（可接受，但至少应 console.warn），但以下两处影响业务逻辑：
  - **第9699行**: `try { runCustomerQualityCheck(cid); } catch(e){}` — 批量导入后自动质量评分失败时无任何提示，开发者无法发现评分模块异常。
  - **第917行**: `try { DB.save('campaigns', snapshot.campaigns); } catch(e2){}` — Campaign 快照保存失败静默。

- **修复建议**: 对 DB.save 类容错可保留空 catch 但加 `console.warn`；对业务逻辑调用（如 runCustomerQualityCheck）必须 log 错误或 toast 提示。

---

#### M-04 CampaignTaskResilience.renderTaskRow 中 taskId 未转义拼接到 onclick

- **文件**: `campaign-task-resilience.js`
- **行号**: 395, 398
- **严重等级**: medium
- **问题描述**: taskId 直接拼接到 `onclick="CampaignTaskResilience.manualRetryById('${task.taskId}')"` 单引号属性，未转义。taskId 由系统生成（`task_时间戳_随机`），风险较低，但若未来 taskId 来源扩展（如导入），存在 XSS 风险。

```javascript
html += `<button ... onclick="CampaignTaskResilience.manualRetryById('${task.taskId}')">重试</button>`;
```

- **修复建议**: 拼接前对 taskId 做 `String(task.taskId).replace(/'/g,"\\'")`，或由 app.js 传入已转义的安全 ID。

---

#### M-05 customer-import.js 回滚路径空 catch 吞持久化错误

- **文件**: `customer-import.js`
- **行号**: 1139
- **严重等级**: medium
- **问题描述**: 导入失败回滚后调用 `try { persistFn(); } catch (pe) { /* ignore */ }`，回滚持久化失败时完全静默。用户以为已回滚成功，但实际状态未保存，刷新页面后仍可能看到脏数据。

```javascript
if (result.success) {
  // ...
} else {
  try { rollbackSnapshot(); } catch (re) { /* log */ }
  try { persistFn(); } catch (pe) { /* ignore */ }  // ← 这里
}
```

- **修复建议**: 至少 `console.error('[ImportRollback] 回滚持久化失败:', pe)`，并 toast 提示用户"回滚保存失败，请手动刷新确认"。

---

#### M-06 index.html 第953行截断的 `</li>` 标签

- **文件**: `index.html`
- **行号**: 953
- **严重等级**: medium
- **问题描述**: HTML 标签截断，`</li>` 被写成 `</`，导致列表结构异常。浏览器容错渲染可能将下一个 `<li>` 合并到当前项，影响欢迎弹窗 UI。

```html
<li>🔄 自动故障转移：在线→本地，15个模型链式转移</
<li>🎯 手动切换：可在设置页面手动选择模型</li>
```

- **修复建议**: 补全为 `</li>`。

---

#### M-07 lead-quality.js 邮箱原文拼接到 issue.message，依赖渲染层转义

- **文件**: `lead-quality.js`
- **行号**: 167
- **严重等级**: medium
- **问题描述**: `message: '邮箱格式无效: ' + email` 将用户输入 email 原文拼接到 issue message。`renderQualityBadge` 本身不渲染 issues 数组，但 app.js 若未来在某处直接 `.message` 拼接 innerHTML（而非经过 esc），即触发 XSS。当前 draft-quality.js 的 renderQualityPanel 已正确 esc，但 lead-quality 的 badge 渲染路径未覆盖 issues。

- **修复建议**: 在 lead-quality.js 内部对 email 做长度截断 + 基本字符过滤，或在所有渲染 issue.message 的位置统一 esc。

---

#### M-08 app.js:9861 客户 ID 未转义拼接到 onclick 单引号

- **文件**: `app.js`
- **行号**: 9861
- **严重等级**: medium
- **问题描述**: `onclick="go('customers');setTimeout(()=>{try{openCustomerDetail('${cid}')}catch(e){}},120)"` — cid 直接拼接到两层单引号中。cid 由 `uid()` 生成（`id+时间戳+随机串`），当前无注入风险，但模式不安全。

- **修复建议**: 改用 `data-cid` 属性 + 事件委托，或对 cid 做单引号转义。

---

### 🟢 LOW（9 个）

---

#### L-01 68 处 console.log 调试日志遗留生产代码

- **文件**: `app.js`
- **行号**: 5923, 5957, 5964, 7000, 7005, 7039, 7055, 7069, 7345, 7388, 7398, 7403, 7414, 7415, 7425, 7608, 7656, 7661, 7673, 8832, 9897, 13729, 13731, 13733, 14044 等
- **严重等级**: low
- **问题描述**: 大量 `console.log('[Ollama检测] ...')`、`[链路测试]`、`[故障转移]`、`[Migration]` 调试输出。演示时打开 F12 会暴露内部链路细节。
- **修复建议**: 演示前用构建步骤剥离 console.log，或封装 `DEBUG` 开关。

---

#### L-02 index.html 版本号与实际不符

- **文件**: `index.html`
- **行号**: 716
- **严重等级**: low
- **问题描述**: 页脚显示 `V29.0`，但 app.js 注释中已到 V77.x / V79.0A。版本号不一致。
- **修复建议**: 更新为当前版本号。

---

#### L-03 index.html 存在两个重复 AI 助手悬浮按钮

- **文件**: `index.html`
- **行号**: 765（aiFab）、782（aiAssistantFloat）
- **严重等级**: low
- **问题描述**: 页面同时存在两个 AI 助手悬浮入口，功能重复，UI 冗余。
- **修复建议**: 确认保留哪一个，删除另一个。

---

#### L-04 model-trace.js 敏感字段子串匹配过度脱敏

- **文件**: `model-trace.js`
- **行号**: 49
- **严重等级**: low
- **问题描述**: `SENSITIVE_KEYS.some(s => lowerKey.includes(s.toLowerCase()))` 用子串匹配，`tokenizer`、`secretary` 等正常字段会被误判为敏感而脱敏，影响日志可读性。安全方向正确（多脱敏不漏脱敏），但降低可调试性。
- **修复建议**: 改为精确匹配或词边界匹配。

---

#### L-05 local-model-lock.js 等待队列无上限

- **文件**: `local-model-lock.js`
- **行号**: 96–120
- **严重等级**: low
- **问题描述**: `waitingQueue` 无最大长度限制。极端情况下大量并发请求会无限堆积 Promise。当前单用户本地场景风险低。
- **修复建议**: 加队列长度上限（如 20），超限直接拒绝。

---

#### L-06 website-evidence.js IPv6 检测运算符优先级混乱

- **文件**: `website-evidence.js`
- **行号**: 124
- **严重等级**: low
- **问题描述**: `if (hostname.includes(':') && hostname.includes('::') || /^[0-9a-f:]+$/.test(hostname))` — `&&` 优先于 `||`，但表达式意图不清晰。实际行为正确（纯 hex+冒号串视为 IP），但可读性差。
- **修复建议**: 加括号明确分组。

---

#### L-07 model-router.js 每次生成请求同步读取 api_config.json

- **文件**: `model-router.js`
- **行号**: 369
- **严重等级**: low
- **问题描述**: `callCloudModel` 每次调用都 `require('fs').readFileSync(cfgPath, 'utf8')` 同步读盘。高并发下阻塞事件循环。当前单用户场景影响小。
- **修复建议**: 配置文件启动时读取一次，或加 mtime 缓存。

---

#### L-08 draft-quality.js 拼接 message 依赖渲染层 esc

- **文件**: `draft-quality.js`
- **行号**: 153, 190
- **严重等级**: low
- **问题描述**: `message: '客户状态为 ' + customer.status`、`message: '邮箱格式无效: ' + email`。renderQualityPanel 第719行已正确 `escHtml`，当前安全。记录此模式供未来重构参考。
- **修复建议**: 无需立即修改，保持现状即可。

---

#### L-09 model-router.js 外层 catch 重复释放锁

- **文件**: `model-router.js`
- **行号**: 657–665
- **严重等级**: low
- **问题描述**: 内层 try-finally 已在每次 attempt 结束释放锁并置 `lockOwner=null`，外层 catch 中再次 `if(lockOwner) releaseLock(lockOwner)`。逻辑上 lockOwner 此时必为 null，不会 double-release，但代码冗余易误读。
- **修复建议**: 移除外层 catch 中的冗余 releaseLock 调用。

---

## 二、审计要点逐项结论

| 审计要点 | 结论 |
|---|---|
| **1. XSS 漏洞** | 项目整体 XSS 防护良好（全局 esc() + sanitizeAiOutput + safeUrl），但模板编辑器（H-01）、onclick 单引号属性（M-01/M-04/M-08）存在缺口 |
| **2. 空 try-catch** | 28 处空 catch，多数为 DB.save 容错可接受；2 处业务逻辑空 catch 需修复（M-03） |
| **3. 未定义变量** | 未发现明显的未定义变量引用；全局 onerror/unhandledrejection 兜底完善 |
| **4. 未处理 Promise** | `fetch().then().then()` 主链路均有 .catch（第13733、18449行确认）；全局 unhandledrejection 兜底 |
| **5. 内存泄漏** | setInterval 仅 1 处（第5774行登录倒计时），有 clearInterval 清理；未发现泄漏 |
| **6. 硬编码密钥** | ✅ **未发现**任何硬编码 API Key / 密码 / Token。API Key 从 api_config.json 服务端读取，前端不持有 |
| **7. TODO/FIXME/占位符** | 152 处匹配全部为 HTML `placeholder` 属性，无真正 TODO/FIXME |
| **8. 空函数/未实现函数** | ✅ 0 处空函数 |
| **9. 重复代码** | innerHTML 拼接 269 处，渲染风格不统一（部分用模板字符串 esc，部分用字符串拼接未 esc）；模板编辑器是最典型的不一致 |
| **10. 37 个 NAV key** | ✅ **已逐行核对，37 个 key 完整未被修改**：dashboard, plans, autosearch, prospect, devplans, customers, drafts, outreachKB, campaigns, knowledgeFacts, knowledgePacks, inbox, schedule, inquiry, orders, products, knowledge, market, seo, expos, reports, pipeline, agents, activity, linkedin, socialmonitor, dailyWork, outreachQueue, reviewQueue, followUpPlan, outreachAnalytics, outreach, bulkImport, importHistory, tools, settings, manual |
| **11. 新功能集成点** | draft-quality / lead-quality / campaign-task-resilience 三大新模块集成点完整，但存在 H-03（空对象覆盖 bug）和 M-03（空 catch 吞评分错误） |
| **12. 数据持久化** | DB.load 有 try-catch；DB.save 无 try-catch；persist() 无整体兜底（M-02） |
| **13. 表单验证** | 关键表单（知识事实、SMTP、Campaign 新建）均有必填校验和 safeUrl 校验；SMTP 密码无长度/复杂度要求 |
| **14. 重复点击保护** | ✅ 20 处 `btn.disabled = true` 覆盖了所有关键提交按钮（导入、生成、测试、登录） |
| **15. 空/加载/错误状态** | 各模块均有空状态文案（"暂无..."）；加载态通过 btn.textContent='⏳...' 体现；错误态通过 toast + errEl 体现。新功能（draft-quality panel）有"尚未运行"空态 |

---

## 三、审计统计

| 指标 | 数量 |
|---|---|
| **读取文件数** | 11（app.js 通过 Grep+定点 Read，其余 10 个完整读取） |
| **app.js Grep 搜索模式数** | 14（空catch、TODO/FIXME、innerHTML、eval、setInterval、localStorage.setItem、console.*、硬编码密钥、fetch-then、空函数、disabled、style.display、NAV定义、新功能集成点） |
| **Grep 总命中数** | 约 500+（其中 innerHTML 269、console 68、空catch 28、TODO/placeholder 152） |
| **Read 定点验证行数** | 约 600 行（覆盖所有 high/medium 命中点） |
| **发现问题总数** | 20 |
| — Critical | 0 |
| — High | 3 |
| — Medium | 8 |
| — Low | 9 |

---

## 四、演示前建议优先级

1. **演示前必须修**: H-03（空对象覆盖，可能导致任务增强模块静默失效）、M-06（截断 </li> 标签，欢迎弹窗 UI 异常）
2. **演示前建议修**: H-01（模板编辑器 XSS，若演示不导入恶意模板则无感知）、L-02（版本号 V29.0 与实际不符，用户可见）
3. **演示后修复**: H-02（SMTP 密码存储）、M-01（esc 单引号）、M-02（persist 兜底）、其余 medium/low

---

## 五、审计约束遵守确认

- ✅ 未修改任何代码文件
- ✅ 未执行 Git 操作
- ✅ 未调用任何付费 API
- ✅ 未使用真实客户数据（所有审计基于代码静态分析）
- ✅ 报告中未写入任何密码明文（SMTP 密码仅指出存储位置，不记录值）
