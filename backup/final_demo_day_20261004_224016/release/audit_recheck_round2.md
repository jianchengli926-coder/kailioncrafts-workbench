# KaiLionCrafts 外贸获客工作台 — 第二轮独立代码复审报告

- **复审日期**: 2026-10-03
- **分支**: ark-html-workbench（HEAD 9920609）
- **复审性质**: 只读独立复审，**未修改任何代码**，未提交 Git，未调用付费 API
- **复审重点**: ①上轮10个修复是否真正生效/是否引入新问题 ②15个 deferred Medium 是否会在演示中暴露 ③异步错误/事件泄漏/定时器/重复函数/硬编码演示桩
- **上轮基线**: release/audit_server_side.md（3C+5H+7M+7L=22）+ release/audit_client_side.md（0C+3H+8M+9L=20）= 42 问题

---

## 一、上轮 10 个 Critical/High 修复验证结果

逐点用 grep + 定点 Read 验证（HEAD 9920609，修复提交 `9920609 fix(security): pre-demo audit fixes`）。

| # | 原编号 | 修复点 | 验证位置 | 结论 |
|---|---|---|---|---|
| 1 | C1 | MX 端点双响应守卫 `res.writableEnded` | server.js:1213 `if (res.writableEnded) return;` | ✅ 已生效 |
| 2 | C2 | 启动脚本移除明文密码 | start.command 与桌面启动器均无 `441723` | ✅ 已生效（grep 0 命中） |
| 3 | C3 | denylist glob-to-regex 重写 | server.js:586–605 `isSensitiveStaticPath`，`test_*.js`→`^test_.*\.js$` 对 fileName 匹配 | ✅ 已生效（逻辑正确） |
| 4 | H1 | `/api/access/verify` 调用 `checkAccessRateLimit` | server.js:983 已调用 | ⚠️ **代码已加调用，但实际无效（见 N-01）** |
| 5 | H2 | `decodeURIComponent` try-catch 返回 400 | server.js:745–751 | ✅ 已生效 |
| 6 | H3 | 静态流错误 `headersSent` 守卫 | server.js:644–651 | ⚠️ 仅修静态流；**proxy 错误回调未修（见 N-05）** |
| 7 | H5 | .gitignore 覆盖 `access_config.json.bak*` | .gitignore:41 | ✅ 已生效 |
| 8 | H-01 | 模板编辑器 `esc()` 转义 | app.js:15230/15232/15234/15236 | ✅ 已生效（含 textarea） |
| 9 | H-02 | SMTP 密码不回显 DOM、空值保留原密码 | app.js:16532 `value=""`；32904 空值保留 | ✅ 已生效 |
| 10 | H-03 | CampaignTaskResilience 空对象覆盖 | app.js:14819 `if(...&& window.CampaignTaskResilience)` | ✅ 已生效 |

**小结**: 10 个修复中 8 个完全生效；H1、H3 存在"修了一半/修而无效"的残留（转入新发现 N-01、N-05）。H4（searchCache 移模块级）按计划 deferred，未修。

---

## 二、新发现问题（本轮独立复审）

> 严重等级：H=high（演示前应处理）/ M=medium / L=low。"影响演示"列仅判断是否会在 30 分钟演示流程中暴露给观众。

### N-01 ｜ H（安全，不影响演示）｜ H1 修复实际无效：滑动窗口限速 Map 每请求重建

- **文件**: server.js
- **位置**: 960–974（`const ACCESS_RATE_LIMIT = new Map()` 与 `checkAccessRateLimit`）
- **描述**: 整个路由块位于 `http.createServer(async (req,res)=>{...})` 回调内（742–3780）。`ACCESS_RATE_LIMIT` 用 `const` 声明在回调体内，**每个 HTTP 请求都新建一个空 Map**。修复虽在 983 行加了 `if(!checkAccessRateLimit(ip))` 调用，但该函数从"当次请求才创建的空 Map"读数，`count` 恒为 1，永远返回 `true`。滑动窗口限速**状态跨请求不持久，等于没生效**。
- **对比**: 真正生效的 15 分钟锁定 `failedAttempts` 是模块级声明（657 行，回调外），所以暴力破解并非完全无防护；只是本次 H1 想加的"每分钟 10 次"窗口防护是空转。
- **影响演示**: ❌ 不影响（仅在连续失败登录时触发；演示用正确密码登录）。
- **修复建议**: 将 `const ACCESS_RATE_LIMIT = new Map()` 与 `checkAccessRateLimit` 移到 `createServer` 回调**外部**（与 656–657 行 `activeSessions`/`failedAttempts` 同级）。

### N-02 ｜ H（影响演示）｜ 重复函数覆盖：客户详情页"预设标签"点击抛 TypeError

- **文件**: app.js
- **位置**: 定义 8203 `addCustomerTag(cid,tagId)` 与 13596 `addCustomerTag()`；调用 13250 `onclick="addCustomerTag('${cid}','${t.id}')"`；元素 18957–18958。
- **描述**: 同名函数后定义覆盖前定义（JS 函数声明提升，后者胜出）。13596 是"新建自定义标签"版（读取 `#newTagName`/`#newTagColor`），但它覆盖了 8203"给某客户挂预设标签"版。客户详情页 13250 渲染的 `+ 标签` 徽章调用 `addCustomerTag(cid, tagId)`，实际执行 13596：`document.getElementById('newTagName')` 在客户详情页为 `null` → `.value` 抛 **TypeError**，标签挂不上，仅被全局 error 处理器吞掉。
- **影响演示**: ✅ **会暴露**——若 Leo 在客户详情页点击任意"＋预设标签"徽章，按钮无反应（控制台报错）。
- **修复建议**: 将 13596 的新建标签函数改名（如 `createCustomerTag`），与 8203 的 `addCustomerTag(cid,tagId)` 区分；或把预设标签挂载改为 `data-` 属性 + 事件委托。

### N-03 ｜ M（可能影响演示）｜ 重复函数覆盖：草稿"拒绝"按钮永远提示"请填写拒绝原因"

- **文件**: app.js
- **位置**: 定义 15667 `rejectDraft(did)` 与 21244 `rejectDraft(draftId, reason)`；调用 15397 `onclick="rejectDraft('${d.id}')"`。
- **描述**: 21244（后定义）胜出，且 21245 行强制 `if(!reason||!reason.trim()){toast('请填写拒绝原因');return false;}`。草稿列表 15397 的"❌ 拒绝草稿"按钮只传 1 个参数，`reason=undefined` → 永远 toast"请填写拒绝原因"并 return，**按钮点了不生效**。
- **影响演示**: ⚠️ 取决于是否演示草稿审核拒绝动作。若点"拒绝"会显得按钮失灵。
- **修复建议**: 15397 改为先弹出原因输入框再以两参调用 21244；或让 21244 在缺 reason 时走 prompt。

### N-04 ｜ M（可能影响演示）｜ 重复函数覆盖：保存模板时 editIndex 被忽略

- **文件**: app.js
- **位置**: 定义 15252 `saveCustomTemplate(editIndex)` 与 24270 `saveCustomTemplate()`；调用 15241 `onclick="saveCustomTemplate('+(isEdit?editIndex:-1)+')"`。
- **描述**: 24270（无参）胜出，忽略传入的 editIndex。模板编辑器"💾 保存模板"在编辑已有模板时可能未按编辑索引覆盖，而是新建/存错位置。
- **影响演示**: ⚠️ 仅当演示"编辑已有邮件模板"时暴露；新建模板不受影响。
- **修复建议**: 合并两个定义，或重命名 24270 对应另一入口。

### N-05 ｜ L（残留 H3）｜ proxyReq 错误回调仍无 headersSent 守卫

- **文件**: server.js
- **位置**: 560–563 `proxyReq.on('error', ...)`
- **描述**: H3 只给静态流错误（644）加了守卫。此处代理 Ollama 时，若上游已 `writeHead`+`pipe` 后再断连，错误回调内 `res.writeHead(502)` 会触发 `ERR_HTTP_HEADERS_SENT`。
- **影响演示**: ❌ 不影响（仅 Ollama 中途断连时）。
- **修复建议**: 回调首行加 `if(res.headersSent){res.end();return;}`。

### N-06 ｜ H（演示导航风险）｜ 30 处硬编码"（演示）"桩按钮 + 1 处 alert 桩

- **文件**: app.js
- **位置**: 共 30 处 `toast('…（演示）')`，外加 15392 `alert('已设置定时发送（演示）')`。
- **典型**: 13355 新增谈判记录、13370 社媒互动、14422/15000 A/B 测试、16036 待办、16081 询盘、16271 合同、17025 新建产品、17062 寄样品、19698 关键词、19744 外链、20233 展会、20368 发货单、20525 发布视频、20904 上传素材、22199 商机、22480 工作流、33015 重发、33195 开发策略、33233 updateCountryList、33384 十维评分应用等。
- **描述**: 这些二级模块的按钮点了只弹"xx（演示）"toast（定时发送是原生 alert），功能未实现。
- **影响演示**: ✅ **高导航风险**——一旦误点，观众直接看到"（演示）"字样，暴露该按钮是空壳。
- **修复建议**: 演示动线避开这些二级页；或演示前临时隐藏/置灰这些按钮（本轮不改代码，仅提示）。

### N-07 ｜ L（体验）｜ 14 处原生 alert() 残留

- **文件**: app.js
- **位置**: 6189/6213（导出空）、7131（检测本地模型）、34260–34317（Tavily Key 保存/测试/清除）、15392（见 N-06）。
- **描述**: 设置页保存/测试 Tavily Key 用原生 alert 弹窗，不专业。
- **影响演示**: ❌ 仅当打开设置页操作 Tavily 时出现；核心动线不触发。
- **修复建议**: 统一替换为 `toast()`。

---

## 三、15 个 deferred Medium 问题重新评估表

| 编号 | 问题 | 现状验证 | 影响演示？ | 处置建议 |
|---|---|---|---|---|
| M-1 | esc() 不转义单引号（app.js:5874） | 仍未转义；但项目主流用 `jsArg()`（144 行，JSON.stringify+HTML转义）安全序列化，原始单引号拼接处均为系统生成 ID（cid/evidenceId/taskId） | ❌ 不影响 | 保持 deferred；有用户数据进入 onclick 前再修 |
| M-2 | persist() 无整体 try-catch（app.js:6153） | 75 处 DB.save 连续调用，DB.save（5862）无 try-catch；localStorage 配额满时中断 | ❌ 不影响（演示数据量远小于 5–10MB 配额） | 保持 deferred |
| M-3 | 28 处空 catch | 多数为 DB.save 单点容错（调用处已 try-catch）；9699 批量质量评分空 catch 是防御性设计（单客户失败不中断批次） | ❌ 不影响 | 保持 deferred |
| M-4 | CampaignTaskResilience taskId 拼 onclick（395/398） | taskId 为 `task_时间戳_随机` 系统生成 | ❌ 不影响 | 保持 deferred |
| M-5 | customer-import 回滚空 catch（1139） | 回滚 persist 失败静默 | ❌ 不影响（导入正常时不走回滚） | 保持 deferred |
| M-6 | index.html:953 截断 `</li>` | 仍为 `…链式转移</`（缺 `li>`），位于欢迎弹窗 | ⚠️ 轻微（首次打开欢迎弹窗列表可能错行，但浏览器容错） | **演示前可补全 `</li>`（1 字符）** |
| M-7 | lead-quality email 拼 issue.message（167） | 渲染层已 esc | ❌ 不影响 | 保持 deferred |
| M-8 | cid 拼 onclick 单引号（9861） | cid 为 uid() 系统生成 | ❌ 不影响 | 保持 deferred |
| M-9 | activeSessions 无定期清理（server.js:656） | 过期会话仅在下次访问时删除 | ❌ 不影响（单会话短演示） | 保持 deferred |
| M-10 | failedAttempts 未达阈值条目不清理 | 同上 | ❌ 不影响 | 保持 deferred |
| M-11 | proxyRequest 无超时（server.js:537） | Ollama 挂起则代理请求无限等 | ⚠️ 边缘（演示前若 Ollama 正常则无感；Ollama 卡死会让 AI 按钮转圈） | 演示前确认 Ollama 健康即可；保持 deferred |
| M-12 | /api/* 未知路由返回 HTML 而非 JSON 404 | 仍走 SPA fallback | ❌ 不影响（前端不调用未知 API） | 保持 deferred |
| M-13 | readBody 超限未 destroy（server.js:2664） | 仍未 req.destroy() | ❌ 不影响（演示不上传 >1MB body） | 保持 deferred |
| M-14 | 请求处理器内重复创建函数/常量（性能） | searchCache/usageData（2168/2203）仍在回调内，每次搜索重读磁盘 | ❌ 不影响（本地小缓存） | 保持 deferred（即 H4） |
| M-15 | 公网 0.0.0.0 无 Cloudflare Access 前置认证 | server.js:47 仍 0.0.0.0，靠工作台密码 | ⚠️ 安全（非功能） | 演示期间建议 HOST=127.0.0.1 或确认密码强度 |

**结论**: 15 个 Medium 中，**仅 M-6（截断 </li>）属于演示前顺手可修的 1 字符瑕疵**；M-11/M-15 是"演示前确认环境"类注意项；其余 12 个均不影响演示。

---

## 四、建议立即修复（仅列会在演示中暴露的）

> 本轮为只读复审，不改代码。以下为给 Leo 的演示前最小动作清单，按优先级：

1. **N-02（最优先）**：客户详情页点"＋预设标签"会抛错无反应。
   - 动作：演示动线**避开客户详情页的预设标签徽章**；或把 13596 的新建标签函数改名 `createCustomerTag`（1 处重命名 + 18968 调用点同步）。
2. **N-03**：草稿"❌ 拒绝草稿"按钮永远提示"请填写拒绝原因"。
   - 动作：演示时若要展示拒绝，**先在弹窗内填原因再提交**（走 21544/22122 两参路径），别直接点列表里的单参按钮。
3. **N-06**：30 个"（演示）"桩按钮——**演示动线只走：数据看板 / 客户台账 / 开发信(质检) / 询盘管理 / 今日工作 / 设置**，避开产品/样品/发货/谈判/展会/工作流等二级空壳页。
4. **M-6**：index.html:953 补全 `</li>`（可选，欢迎弹窗视觉）。
5. **演示前环境确认**：① Ollama 健康（避免 M-11 代理挂起）② 工作台密码已改默认（M-15）。

**不影响演示、记入 backlog**: N-01（限速空转）、N-04（模板编辑索引）、N-05（proxy 守卫）、N-07（alert 替换）、其余 12 个 deferred Medium。

---

## 五、统计

| 指标 | 数量 |
|---|---|
| 完整读取的上轮报告 | 2（audit_server_side.md, audit_client_side.md） |
| 审计生产代码文件 | 12（server.js / app.js / index.html + 9 个共享模块） |
| server.js 定点 Read 块 | 约 10 块（742–875、945–1105、1160–1270、500–630、630–750、2661–2706、25–80、586–625、3782 区） |
| app.js Grep 搜索模式 | 14（alert / setInterval+clearInterval / addEventListener+removeEventListener / JSON.parse / onclick单引号拼接 / 空catch / console.log / 重复函数定义 / 硬编码"（演示）"/ TODO / newTagName / 版本号 / truncate li / jsArg定义） |
| 共享模块批量扫描 | 9 文件 × 4 模式（alert/setInterval/JSON.parse/空catch） |
| 上轮修复验证点 | 10（8 完全生效，2 残留） |
| **新发现问题** | **7**（N-01~N-07：2H影响演示 + 2M + 1H导航 + 2L） |
| 其中影响演示 | 3（N-02 / N-03 / N-06，加 M-6 轻微） |
| Medium 重评 | 15（12 保持 deferred，1 可选修，2 环境确认） |
| 建议立即修复（演示前） | 5 项动作（见第四节） |

### 新发现严重度分布

```
High     ███ 2（N-01安全空转、N-02重复函数覆盖）+ N-06导航高
Medium   ██  2（N-03、N-04 重复函数覆盖）
Low      ██  2（N-05 proxy残留、N-07 alert）
```

---

## 六、复审约束遵守确认

- ✅ 未修改任何代码文件
- ✅ 未执行 Git commit / push
- ✅ 未调用任何付费 API
- ✅ 报告中未写入任何密码明文（仅指出位置与存储方式）
- ✅ 全部结论基于静态代码 + grep 验证，未运行浏览器

---

*报告结束。本复审为只读审计，未改动工作台任何源码。*
