# 修复记录：验收发现Bug修复 V85

**修复时间**: 2026-10-05 19:10 (Asia/Shanghai)
**项目**: 外贸获客AI工作台 - KaiLionCrafts
**基于**: FINAL_ACCEPTANCE_backend_model_V85.md 验收报告

---

## 修复清单

### 🔴 严重问题修复（1个）

#### Fix #1: 飞书广播自动发送 → 改为手动触发模式

**文件**: `phase5-feishu-broadcast.js`

**问题**: 
- `p5CheckScheduledPush()` 通过 `setInterval(60s)` + `setTimeout(3s)` 自动检查，到达设定时间后直接调用 `p5PushBroadcast(false)` 发送飞书消息，无需用户确认。
- 违反"零自动发送"核心安全原则。

**修改内容**:
1. **函数重写**（原第218-238行）: 
   - `p5CheckScheduledPush()` → 重命名为 `p5UpdatePushStatus()`
   - 移除 `p5PushBroadcast(false)` 自动调用
   - 改为仅更新页面状态提示元素（`#p5_push_status`），显示"今日已推送"/"到达推送时间请手动点击"/"距推送时间还有X分钟"

2. **定时器修改**:
   - `setInterval(p5CheckScheduledPush, 60000)` → `setInterval(p5UpdatePushStatus, 60000)`
   - `setTimeout(p5CheckScheduledPush, 3000)` → `setTimeout(p5UpdatePushStatus, 500)`

3. **UI新增状态显示**:
   - 在页面标题下方添加 `<div id="p5_push_status">` 状态提示区域

4. **警告文案更新**:
   - 原："到达推送时间后会自动推送一次"
   - 新："🔒 安全模式：定时设置仅用于显示'待推送'状态提示，**不会自动发送**。到达推送时间后，请手动点击上方'立即推送测试'按钮确认发送。"

**验证结果**: 
- ✅ `node --check phase5-feishu-broadcast.js` 通过
- ✅ grep确认：定时器中无 `p5PushBroadcast` 调用
- ✅ 手动推送按钮 `p5PushNow()` 保留，用户主动触发

---

### 🟡 中等问题修复（2个）

#### Fix #2: 未定义变量 kbToggleQuickFilter（IIFE作用域问题）

**文件**: `app.js`（第19235行后）

**问题**:
- 整个app.js被IIFE包裹（第4行 `(function(){`），内部函数不在window对象上
- inline `onclick="kbToggleQuickFilter('...')"` 无法访问IIFE内部函数，控制台报 `kbToggleQuickFilter is not defined`

**修改**:
```javascript
// 函数定义后添加window暴露
window.kbToggleQuickFilter = kbToggleQuickFilter;
```

**验证**: ✅ `node --check app.js` 通过

---

#### Fix #3: 未定义变量 prospectSearchResults（IIFE作用域 + TDZ问题）

**文件**: `app.js`

**问题**:
- `prospectSearchResults` 声明为IIFE内部 `let` 变量（原第34317行）
- inline `onchange="prospectSearchResults[i].selected=this.checked"` 无法访问
- `renderView()` 第10017行早期调用时，`let` 变量仍在暂时性死区(TDZ)，导致ReferenceError

**修改**:
1. 变量声明后添加window暴露（第34319-34320行）:
```javascript
let prospectSearchResults = [];
window.prospectSearchResults = prospectSearchResults;
```

2. renderView中引用改为安全访问（第10017行）:
```javascript
// 原: if(!window._prospectResultsLoaded && prospectSearchResults.length === 0){
// 新: if(!window._prospectResultsLoaded && (window.prospectSearchResults||[]).length === 0){
```

**验证**: ✅ `node --check app.js` 通过

---

#### Fix #4: SVG雷达图空数据NaN渲染

**文件**: `app.js`（radarChart函数，原第11232行）

**问题**:
- 雷达图在scores值为undefined时，`R*d.v/100` 产生NaN坐标
- 渲染出 `<circle cx="NaN" cy="NaN">` 和 `<polygon points="NaN,NaN...">`，控制台报错

**修改**:
1. 添加safe()函数，将undefined/NaN默认转为0:
```javascript
const safe = v => (typeof v === 'number' && !isNaN(v)) ? v : 0;
```
2. 所有维度评分使用 `safe()` 包裹
3. 全0时显示"暂无数据"占位，不渲染空polygon

**验证**: ✅ `node --check app.js` 通过

---

#### Fix #5: 业绩战报市场占比NaN + 除零保护

**文件**: `app.js`（业绩战报页面，原第20763-20800行）

**问题**:
1. 品类占比计算 `c.count/total*100`，total为0时除零 → NaN
2. `PROSPECT_KB.markets[2].name` - 数组不足3项时undefined报错
3. `PROSPECT_KB.categories[1].name` - 数组不足2项时undefined报错
4. `PROSPECT_KB.certifications[0].name` - 数组为空时undefined报错
5. 完成率 `actual/goal*100`，goal为0时除零 → NaN

**修改**:
1. 品类占比：用IIFE包裹，totalCount为0时默认1，空数组显示"暂无数据"
2. 市场优先级：空数组显示"暂无数据"
3. 增长抓手：所有数组索引访问添加存在性检查，默认显示"待确认"
4. 完成率：goal>0时计算百分比，否则显示0%，宽度clamp到100%

**验证**: ✅ `node --check app.js` 通过

---

### 🟢 调查结论（1个，非Bug）

#### Fix #6: API 401 Unauthorized - 正常安全行为

**调查结论**: 非代码bug，是预期的密码保护机制。

**说明**:
- server.js 使用 cookie-based session 认证（`kl_session` cookie）
- 所有 `/api/ai/*` 等受保护端点均通过 `requireAuth()` 中间件校验
- 浏览器同域fetch请求自动携带cookie，前端正常工作
- 自动化测试/curl未先登录获取session cookie，因此返回401
- 这是安全设计，不是bug

**建议**: 测试时先调用 `/api/access/verify` 登录获取cookie，再用该cookie访问受保护API。

---

## 语法验证汇总

| 文件 | 修复后语法检查 |
|------|---------------|
| phase5-feishu-broadcast.js | ✅ 通过 |
| app.js | ✅ 通过（多次修改后均验证） |

---

## 修复前后对比

| 问题 | 修复前 | 修复后 |
|------|--------|--------|
| 飞书自动发送 | 定时器自动发送，违反零自动发送原则 | 仅状态提示，必须手动点击发送 |
| kbToggleQuickFilter | 控制台报错 `is not defined` | window暴露，inline onclick正常 |
| prospectSearchResults | 控制台ReferenceError (TDZ) | window暴露 + 安全访问，无报错 |
| SVG雷达图NaN | 空数据时渲染NaN坐标，11条控制台错误 | 空数据显示占位，数值默认0 |
| 市场占比NaN | 除零+空数组导致NaN显示 | 除零保护 + 空数据占位 + 索引安全访问 |
| API 401 | 测试环境误判为bug | 确认为正常密码保护，无需修复 |

---

*修复记录结束 - 外贸获客AI工作台 V85*
