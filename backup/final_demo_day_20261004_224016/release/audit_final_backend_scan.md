# KaiLionCrafts 外贸获客工作台 — 最终后端代码扫描审计报告

**审计日期**: 2026-10-03
**分支**: ark-html-workbench (HEAD ee23eed)
**审计范围**: 后端全量代码只读扫描
**审计性质**: 只审计，不修改代码

---

## 1. 读取文件清单

| 文件名 | 行数 | 状态 |
|--------|------|------|
| server.js | 3827 | ✅ 完整读取 |
| model-router.js | 718 | ✅ 完整读取 |
| local-model-lock.js | 379 | ✅ 完整读取 |
| model-trace.js | 265 | ✅ 完整读取 |
| customer-import.js | 1221 | ✅ 完整读取 |
| prospect-priority.js | 625 | ✅ 完整读取 |
| website-evidence.js | 814 | ✅ 完整读取 |
| draft-quality.js | 779 | ✅ 完整读取 |
| lead-quality.js | 635 | ✅ 完整读取 |
| campaign-task-resilience.js | 520 | ✅ 完整读取 |
| start.command | 111 | ✅ 完整读取 |
| ~/Desktop/启动外贸客户开发工作台.command | 126 | ✅ 完整读取 |

**未纳入审计的文件**: 所有 `test_*.js`、`_test_backup*.js`、`*.backup`、`*.bak`、`release/` 目录下的历史报告（前端 app.js 2.3MB 为单文件前端应用，本次以后端为主）。

---

## 2. 前三轮修复验证结果

### 2.1 限速Map移到模块级后是否有作用域冲突

**结论**: ✅ 已正确修复，无作用域冲突

- `ACCESS_RATE_LIMIT` 定义在 `server.js:659`，位于 `http.createServer` 外部模块级作用域
- 注释明确标注"跨请求共享，必须在 http.createServer 外部"
- `checkAccessRateLimit()` 函数在模块级定义（约 line 661-670），通过闭包访问 Map
- 滑动窗口清理逻辑正确：删除超过2个窗口周期的旧记录
- 未发现其他同名 Map 变量冲突

### 2.2 demoStub()函数是否正确定义和调用

**结论**: ✅ 正确

- `demoStub` 定义在 `app.js:5897`：`function demoStub(featureName){ toast('「'+(featureName||'该功能')+'」为规划中功能，即将上线','info'); }`
- 全项目共约30处调用点，全部使用 `onclick="demoStub('功能名')"` 格式
- 函数内部调用 `toast()`，无 alert 残留
- 所有调用点参数均为字符串，无未定义变量引用

### 2.3 alert()替换为toast()后是否有语法问题

**结论**: ✅ 无残留、无语法问题

- `server.js` 中 `grep "alert("` 返回 0 结果
- `app.js` 中 `grep "alert("` 返回 0 结果
- `toast()` 函数在 app.js 中定义并全局可用
- 所有 toast 调用均为 `toast(msg)` 或 `toast(msg, 'err')` 格式，语法正确

### 2.4 重复函数重命名后是否有遗漏的调用点

**结论**: ✅ 无重复函数、无遗漏调用点

- `grep "^function \|^async function" server.js | sort | uniq -d` 返回空
- server.js 中所有顶层函数名唯一
- 模块导出函数与内部调用一致

### 2.5 proxyReq headersSent守卫是否正确

**结论**: ✅ 正确

- `server.js:560-564`: proxyReq error 事件中检查 `if (res.headersSent) { res.end(); return; }`
- `server.js:646`: 代理响应处理中也有 `if (!res.headersSent)` 守卫
- 两处守卫覆盖了错误回调和正常回调两个路径

---

## 3. 新发现问题

### 问题 1: 服务器绑定 0.0.0.0 暴露到所有网卡

| 项目 | 内容 |
|------|------|
| 文件 | `server.js:47` |
| 描述 | `const HOST = process.env.HOST || '0.0.0.0'` 默认绑定所有网络接口 |
| 严重等级 | **HIGH** |
| 是否影响演示 | ⚠️ 是 — 如果在公司/咖啡厅等公共 WiFi 环境运行，同网段任何人都可访问工作台 |
| 修复建议 | 默认改为 `127.0.0.1`，如需局域网访问再通过环境变量显式开启：`const HOST = process.env.HOST || '127.0.0.1'` |

### 问题 2: 桌面启动器硬编码外部卷路径

| 项目 | 内容 |
|------|------|
| 文件 | `~/Desktop/启动外贸客户开发工作台.command:11` |
| 描述 | `WORKBENCH_DIR="/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/外贸获客AI工作台"` 硬编码了外置硬盘路径 |
| 严重等级 | **MEDIUM** |
| 是否影响演示 | ⚠️ 是 — 如果外置硬盘未挂载或盘符变化，启动器会失败 |
| 修复建议 | 启动器内增加挂载检测和友好提示，或改为相对路径/搜索定位 |

### 问题 3: async路由中await调用的错误覆盖度

| 项目 | 内容 |
|------|------|
| 文件 | `server.js` 多处 |
| 描述 | server.js 中共21处 `await` 调用，分布在多个异步路由处理函数中。虽然整体有61个try-catch块覆盖主要路由，但部分嵌套异步操作（如证据采集内部await链）的错误传播依赖内层函数自身的错误处理 |
| 严重等级 | **MEDIUM** |
| 是否影响演示 | 低 — 核心路由均有外层try-catch兜底 |
| 修复建议 | 关键异步端点（/api/evidence/collect, /api/ai/generate-async）已正确包裹，其余可后续加固 |

### 问题 4: console.log 调试残留

| 项目 | 内容 |
|------|------|
| 文件 | `server.js` |
| 描述 | 共15处 console.log 调用 |
| 严重等级 | **LOW** |
| 是否影响演示 | 否 — 仅控制台输出，不影响功能 |
| 修复建议 | 演示前可保留关键启动日志，其余可改为 debug 级别或移除 |

### 问题 5: 密码验证的明文回退路径

| 项目 | 内容 |
|------|------|
| 文件 | `server.js:854-861` |
| 描述 | `verifyPassword()` 中有明文密码回退分支：`if (config.password && typeof config.password === 'string')`。虽然有自动升级为hash的逻辑（line 857-861），但首次加载时如果access_config.json中存的是明文，会先以明文比较一次再升级 |
| 严重等级 | **LOW** |
| 是否影响演示 | 否 |
| 修复建议 | 确保生产环境 access_config.json 中只存 passwordHash + salt，不保留明文字段。当前代码已会自动删除明文字段，风险可控 |

---

## 4. 模型代码专项审查结果

### 4.1 model-router.js — 模型链配置与故障转移

**结论**: ✅ 整体设计合理

- **模型链配置**: `buildModelChain()` 按 provider 分组，优先在线模型、本地模型兜底，配置驱动
- **故障转移逻辑**: `routeRequest()` 中 try/catch 包裹模型调用链，失败后自动 fallback 到下一个模型
- **慢响应检测**: 有超时控制机制，在线模型和本地模型分别设置超时
- **错误分类**: `ERROR_CLASSIFICATION` 表覆盖网络错误、认证错误、速率限制、内容审核等场景
- **重试逻辑**: 对可重试错误（网络/5xx）有重试机制

**潜在改进点（LOW）**:
- 故障转移时的 trace 记录完整性依赖调用方正确传递 traceId
- 本地模型锁与故障转移的交互：如果本地模型被锁定，故障转移会直接跳到下一个在线模型（合理设计）

### 4.2 local-model-lock.js — 锁机制

**结论**: ✅ 锁机制正确

- **锁获取**: `acquireLock()` 使用 Map 存储锁状态，带 TTL 超时自动过期
- **锁释放**: `releaseLock()` 精确释放指定 owner 的锁，避免误删他人锁
- **超时处理**: 锁对象包含 `expiresAt`，过期锁会被视为可获取
- **看门狗**: 有定期清理过期锁的机制
- **owner验证**: 释放时检查 owner，防止误释放

**无发现bug**。

### 4.3 model-trace.js — Trace记录

**结论**: ✅ 记录完整

- Trace 包含：traceId、请求时间、模型链、每步耗时、最终结果、错误信息
- 支持持久化到文件（JSONL 格式追加写入）
- 有 trace 查询和单条 trace 详情的 API
- trace 数据结构包含 enough context 用于调试

**LOW**: trace 文件无自动轮转机制，长期运行可能导致文件过大。

### 4.4 在线模型调用 (callCloudModel)

**结论**: ✅ 正确

- **API Key读取**: 从 `glmCfg.apiKey` 读取，空key时自动故障转移（line 380-386）
- **请求构建**: 正确设置 Authorization Bearer header、Content-Type、请求体
- **错误处理**: HTTP状态码分类、网络错误捕获、超时控制
- **响应解析**: 正确解析 GLM API 返回格式

**安全**: API Key 不打印到日志，不返回给前端（只返回 configured: true/false）。

### 4.5 本地模型调用 (callLocalModel)

**结论**: ✅ 正确

- **Ollama请求**: 正确构造 POST 请求到 Ollama API
- **超时**: 有超时控制
- **响应解析**: 正确解析 Ollama 返回的 JSON 流
- **图片输入**: 支持 images 参数（视觉模型）

### 4.6 视觉模型/生图模型特殊处理

**结论**: ✅ 有处理

- `callLocalModel()` 接受 `images` 参数，传给 Ollama 的多模态接口
- `callCloudModel()` 当前主要处理文本对话模型
- 生图模型（DALL-E/SD等）在当前代码中未见专门调用路径 — 属于规划中功能

---

## 5. API端点错误处理统计

### 路由清单（共约30+个端点）

| 端点 | 方法 | try-catch | 备注 |
|------|------|-----------|------|
| /api/health | GET | N/A | 健康检查，无副作用 |
| /robots.txt | GET | N/A | 静态文件 |
| /api/ollama/* | 代理 | ✅ | 代理转发，有错误处理 |
| /api/proxy/* | 代理 | ✅ | 代理转发，有headersSent守卫 |
| /api/access/status | GET | ✅ | 登录状态查询 |
| /api/access/verify | POST | ✅ | 密码验证，有失败限速 |
| /api/access/logout | POST | ✅ | 登出 |
| /api/access/password | POST | ✅ | 修改密码 |
| /api/ai/config | GET/POST | ✅ | AI配置读写 |
| /api/ai/models | GET | ✅ | 模型列表 |
| /api/evidence/collect | POST | ✅ | 网站证据采集 |
| /api/evidence/validate | POST | ✅ | URL校验 |
| /api/lead-quality/mx-check | POST | ✅ | MX记录检查 |
| /api/ai/generate | POST | ✅ | 同步AI生成 |
| /api/ai/generate-async | POST | ✅ | 异步AI生成 |
| /api/ai/traces | GET | ✅ | Trace列表 |
| /api/ai/traces/:id | GET | ✅ | Trace详情 |
| /api/kb/* (8个端点) | 多种 | ✅ | 知识库全套 |
| /api/search/* (6个端点) | 多种 | ✅ | 搜索配置/测试/使用统计 |
| /api/fetch | POST | ✅ | 网页抓取 |
| /api/company/fetch | POST | ✅ | 公司信息抓取 |
| /api/search/cache | DELETE | ✅ | 清缓存 |

### 统计结果

- **try-catch 块**: 61 个
- **catch 块**: 61 个（一一对应）
- **404 fallback**: 存在多个端点内404处理 + 静态文件404
- **unhandledRejection**: ✅ 有全局监听（server.js:37-40）
- **uncaughtException**: ✅ 有全局监听（server.js:31-35）
- **未捕获 Promise rejection**: 全局兜底已覆盖，单个异步路由错误由内层try-catch处理

---

## 6. console.log 残留统计

| 文件 | console.log 数量 |
|------|-----------------|
| server.js | 15 |
| model-router.js | 0 |
| local-model-lock.js | 0 |
| model-trace.js | 0 |
| customer-import.js | 0 |
| prospect-priority.js | 0 |
| website-evidence.js | 0 |
| draft-quality.js | 0 |
| lead-quality.js | 0 |
| campaign-task-resilience.js | 0 |
| **合计** | **15** |

全部集中在 server.js，主要是启动日志、模型调用日志、错误日志。属于可接受的开发阶段日志，不影响演示。

---

## 7. 启动脚本和锁屏流程审查

### 7.1 start.command

**结论**: ✅ 基本正确

- 自动定位脚本所在目录为工作目录
- 检查 node 是否可用
- 启动 `node server.js`
- 自动打开浏览器
- **无硬编码密码**
- **无硬编码API Key**
- 有错误提示（端口占用等）

### 7.2 桌面启动器

**结论**: ⚠️ 有硬编码路径

- `WORKBENCH_DIR` 硬编码为外置卷路径
- 其余逻辑与 start.command 一致
- 无密码/Key硬编码

### 7.3 锁屏/登录流程

**结论**: ✅ 安全设计合理

- **access_config.json读取**: 延迟加载 + 缓存
- **密码验证**: scrypt 哈希 + timingSafeEqual（防时序攻击）
- **session管理**: HttpOnly Cookie + 服务端Session Map + 过期时间
- **登出**: 撤销服务端session + 清除Cookie
- **失败限速**: 滑动窗口限速（ACCESS_RATE_LIMIT Map）
- **密码修改**: 验证旧密码 → 设置新hash → 删除明文

**LOW风险**:
- session 存储在内存中（Map），服务重启后所有session失效（可接受，本地工作台场景）
- 无 session 持久化（重启后需重新登录，这是安全特性而非bug）

### 7.4 优雅关闭

**结论**: ✅ 有

- `server.js:3821-3825`: SIGINT 信号处理 → server.close() → 退出
- 有 uncaughtException 和 unhandledRejection 全局兜底

---

## 8. 总结

### 问题统计

| 严重等级 | 数量 |
|----------|------|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 2 |
| LOW | 3 |

### HIGH问题详情

**HOST绑定 0.0.0.0** — 本地工作台默认绑定所有网卡，在公共网络环境下存在被访问风险。建议演示前确认网络环境，或改为 127.0.0.1。

### MEDIUM问题详情

1. **桌面启动器硬编码路径** — 依赖外置卷挂载路径，盘符变化时启动失败
2. **async路由错误覆盖度** — 核心路由已覆盖，嵌套异步链的深层错误可后续加固

### 建议立即修复的问题

1. **【HIGH】修改 HOST 默认值为 127.0.0.1**（server.js:47）
   - 原因: 本地B2B工作台不应暴露到局域网
   - 修复成本: 1行代码
   - 影响: 如需远程访问再通过环境变量开启

### 前三轮修复质量评价

前三轮修复质量良好，未发现因修复引入的新bug：
- 限速Map模块级化正确，无作用域冲突
- demoStub/toast替换彻底，无alert残留
- 重复函数已全部重命名，无遗漏调用点
- proxyReq守卫正确覆盖错误和正常两条路径

### 模型代码整体评价

模型路由层设计成熟：故障转移链清晰、锁机制严谨、trace完整、API Key安全处理。在线/本地双模式切换可靠，错误分类细致。无发现影响演示的模型代码bug。

---

**审计人**: AI 代码审计 Agent
**审计完成时间**: 2026-10-03
**审计结论**: 可进入演示阶段，建议优先修复 HOST 绑定问题
