# KaiLionCrafts 外贸获客工作台 — 服务端代码深度审计报告

**审计日期**: 2026-10-03
**审计分支**: ark-html-workbench (HEAD 18778ef)
**审计范围**: server.js, start.command, 桌面启动器.command
**审计性质**: 只读审计，未修改任何代码
**审计人**: AI 深度审计

---

## 一、审计文件清单

| 文件 | 行数 | 说明 |
|---|---|---|
| server.js | 3807 | 核心后端文件 |
| package.json | — | **不存在**（项目无 npm 依赖，纯 Node.js 内置模块） |
| start.command | 111 | 项目目录启动脚本 |
| ~/Desktop/启动外贸客户开发工作台.command | 126 | 桌面启动器（launchd 守护） |

**总行数**: 4044 行

---

## 二、问题清单（按严重等级排序）

---

### CRITICAL（严重，必须演示前修复）

#### C1. MX 记录查询端点存在双响应 Bug — DNS 回调在超时后重复发送 HTTP 响应

- **文件**: server.js
- **行号**: 1188–1207
- **描述**: `/api/lead-quality/mx-check` 设置了 5 秒超时定时器。当 DNS 查询超过 5 秒时，定时器触发并发送响应（`mxStatus:'unknown'`）。但 `dns.resolveMx` 的回调在之后仍会执行，此时 `clearTimeout(timer)` 是空操作，回调内再次调用 `res.writeHead(200,...)` 和 `res.end(...)`，触发 `ERR_HTTP_HEADERS_SENT` 异常。该异常发生在异步回调中，不在外层 try-catch 范围内，会被全局 `uncaughtException` 捕获并打印错误堆栈，但请求已经结束。
- **代码片段**:
```javascript
// 行 1188-1191: 超时定时器
const timer = setTimeout(() => {
  res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({success:true, domain, mxStatus:'unknown', records:[], error:'timeout', checkedAt:new Date().toISOString()}));
}, timeoutMs);
// 行 1192-1207: DNS 回调 — 定时器已触发后，此处再次 writeHead
dns.resolveMx(domain, (err, addresses) => {
  clearTimeout(timer);  // 空操作，定时器已触发
  if (err) {
    res.writeHead(200, ...);  // 💥 ERR_HTTP_HEADERS_SENT
    res.end(...);
  } else {
    res.writeHead(200, ...);  // 💥 同上
    res.end(...);
  }
});
```
- **修复建议**: 在 DNS 回调开头检查 `if (res.writableEnded) return;`，或使用一个 `responded` 标志位防止重复响应。

---

#### C2. 启动脚本硬编码并明文打印工作台密码

- **文件**: start.command（行 8）；~/Desktop/启动外贸客户开发工作台.command（行 6、行 108）
- **行号**: start.command:8；桌面启动器:6, 108
- **描述**: 两个启动脚本的注释和输出中均明文写入密码 `441723`。桌面启动器第 108 行直接在终端打印 `访问密码: 441723`。虽然工作台本身使用 scrypt 哈希存储密码，但启动脚本中的明文密码会出现在：终端历史、shell 历史记录、屏幕截图、日志文件、Git 仓库（如果脚本被提交）。
- **代码片段**:
```bash
# start.command 行 8
#   3. 输入密码 441723 进入工作台

# 桌面启动器 行 6
# 访问密码：441723

# 桌面启动器 行 108
echo "  - 访问密码: 441723"
```
- **修复建议**: 从脚本中移除所有明文密码。密码已存储在 `access_config.json`（scrypt 哈希），不需要在脚本中硬编码。如需提示用户，改为"密码见 access_config.json 或终端首次启动输出"。

---

#### C3. STATIC_DENYLIST 通配符模式实现错误 — `test_*.js`、`*backup*.json` 等模式不生效

- **文件**: server.js
- **行号**: 570–602
- **描述**: 静态文件敏感路径黑名单的通配符匹配逻辑有缺陷：
  - `test_*.js` 不以 `*` 开头也不以 `*` 结尾，被当作字面字符串 `/test_*.js` 匹配，永远不会匹配真实文件名（如 `test_p2_5a_bulk_import.js`）。
  - `*backup*.json` 以 `*` 开头，提取关键字 `backup*.json`（其中 `*` 是字面字符），检查路径是否包含 `backup*.json`，同样不会匹配 `backup_2026.json` 等真实文件。
  - 结果：`test_*.js` 文件（含测试逻辑和内部路径）、备份 JSON 文件可通过 HTTP 直接下载。
- **代码片段**:
```javascript
// 行 588-598: 匹配逻辑
for (const pattern of STATIC_DENYLIST) {
  if (pattern.startsWith('*')) {
    const keyword = pattern.substring(1).toLowerCase();
    if (normalized.includes(keyword)) return true;  // "backup*.json" 中的 * 是字面量
  } else if (pattern.endsWith('*')) {
    const prefix = pattern.substring(0, pattern.length - 1).toLowerCase();
    if (normalized.includes(prefix)) return true;
  } else {
    if (normalized.includes('/' + pattern.toLowerCase()) || ...) return true;
  }
}
```
- **修复建议**: 使用正规的 glob-to-regexp 匹配，或至少将 `test_*.js` 改为前缀匹配 `test_`，将 `*backup*.json` 改为 `backup` 关键字子串匹配。

---

### HIGH（高，演示前应修复）

#### H1. 滑动窗口速率限制器完全失效 — 函数定义后从未被调用

- **文件**: server.js
- **行号**: 946–960
- **描述**: `ACCESS_RATE_LIMIT` Map 和 `checkAccessRateLimit(ip)` 函数定义了一个每分钟 10 次的滑动窗口速率限制，但该函数在整个代码中**从未被调用**。`/api/access/verify` 端点只使用了基于 `failedAttempts` 的 15 分钟锁定（10 次失败后锁定），没有实现滑动窗口限制。这意味着攻击者可以在锁定前快速尝试大量密码组合（虽然 scrypt 哈希较慢，但缺乏请求频率限制）。
- **代码片段**:
```javascript
// 行 946-960: 定义了但从未调用
const ACCESS_RATE_LIMIT = new Map();
function checkAccessRateLimit(ip){
  const now = Date.now();
  const windowMs = 60000;
  const maxAttempts = 10;
  // ... 清理逻辑 ...
  return count <= maxAttempts;
}
// 行 962: /api/access/verify 端点中没有调用 checkAccessRateLimit
if (pathname === '/api/access/verify' && req.method === 'POST') {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) { ... }  // 只用了 failedAttempts 锁定
    // 💥 缺少: if (!checkAccessRateLimit(ip)) { res.writeHead(429)...; return; }
```
- **修复建议**: 在 `/api/access/verify` 中调用 `checkAccessRateLimit(ip)`，超限返回 429。

---

#### H2. decodeURIComponent 无 try-catch — 畸形 URL 导致请求挂起

- **文件**: server.js
- **行号**: 737
- **描述**: `const pathname = decodeURIComponent(reqUrl.pathname);` 没有 try-catch。如果请求 URL 包含畸形的百分号编码（如 `%` 后跟非十六进制字符），`decodeURIComponent` 抛出 `URIError`。该异常发生在 async 请求回调的顶层，不会被任何路由的 try-catch 捕获，导致请求挂起（无响应发送），同时被全局 `uncaughtException` 记录。
- **代码片段**:
```javascript
// 行 736-737
const reqUrl = new URL(req.url, `http://${req.headers.host}`);
const pathname = decodeURIComponent(reqUrl.pathname);  // 💥 可能抛 URIError
```
- **修复建议**: 包裹 try-catch，异常时返回 400 Bad Request。

---

#### H3. 多处缺少 `res.headersSent` / `res.writableEnded` 检查 — 存在双响应风险

- **文件**: server.js
- **行号**: 多处（MX 检查 1188-1207、静态文件流错误 641-644、代理错误 560-563）
- **描述**: 全代码库中没有任何 `res.headersSent` 或 `res.writableEnded` 检查。除 C1 的 MX 检查外，以下场景也可能导致双响应：
  - `serveStaticFile` 的流错误处理器（行 641-644）在 `writeHead(200)` 已发送后，流错误时再次 `writeHead(500)`。
  - `proxyRequest`（行 560-563）的错误处理器在代理响应已 pipe 后触发时可能重复发送。
- **代码片段**:
```javascript
// 行 639-644: 静态文件流错误处理
const stream = fs.createReadStream(filePath);
stream.pipe(res);
stream.on('error', () => {
  res.writeHead(500);  // 💥 如果 headers 已发送，此处抛异常
  res.end('读取文件失败');
});
```
- **修复建议**: 在所有异步回调中的 `writeHead` 前加 `if (res.headersSent) { res.end(); return; }`。

---

#### H4. searchCache 和 usageData 在请求处理器内部声明 — 内存缓存完全失效

- **文件**: server.js
- **行号**: 2148–2153, 2183–2188
- **描述**: `searchCache`（行 2148）和 `usageData`（行 2183）使用 `let` 声明在 `http.createServer` 回调函数内部。这意味着**每个 HTTP 请求都会重新从磁盘加载** `search_cache.json` 和 `search_usage.json`，内存中的缓存对象在请求结束后被垃圾回收。设计意图是进程内缓存（避免每次搜索都读磁盘），但实际效果是每次搜索都同步读取整个 `search_cache.json`（可能数百 KB），阻塞事件循环。
- **代码片段**:
```javascript
// 行 2148-2153: 位于 createServer 回调内部
let searchCache = {};
try {
  if (fs.existsSync(SEARCH_CACHE_FILE)) {
    searchCache = JSON.parse(fs.readFileSync(SEARCH_CACHE_FILE, 'utf-8'));
  }
} catch(e) { searchCache = {}; }
// ↑ 每个请求都重新执行 fs.readFileSync
```
- **修复建议**: 将 `searchCache`、`usageData` 及相关函数移到 `createServer` 外部（模块级作用域），与 `activeSessions`、`failedAttempts` 保持一致。

---

#### H5. access_config.json 备份文件不在 .gitignore 覆盖范围内

- **文件**: .gitignore（行 `*.bak`）；实际文件 `access_config.json.bak_demo_audit`
- **行号**: .gitignore 中 `*.bak` 模式
- **描述**: `.gitignore` 有 `*.bak` 规则，但实际存在的备份文件名为 `access_config.json.bak_demo_audit`，不以 `.bak` 结尾，因此不被 `.gitignore` 覆盖。该文件包含密码哈希和盐值，如果被提交到 Git 仓库，凭据会泄露。
- **修复建议**: 重命名为 `access_config.json.bak` 或在 `.gitignore` 中添加 `access_config.json*`。

---

### MEDIUM（中等）

#### M1. activeSessions Map 无定期清理 — 过期会话内存累积

- **文件**: server.js
- **行号**: 649, 908–918
- **描述**: `activeSessions` Map 只在两种情况下清理：(1) 用户主动登出（行 995）；(2) 用户携带过期会话访问时删除（行 913-915）。如果用户登录后不再访问（关闭浏览器），会话条目会永久留在内存中，直到服务重启。8 小时 TTL 形同虚设——过期会话不删除，只是在下次使用时才发现已过期。
- **修复建议**: 添加定期清理定时器（如每小时扫描一次，删除过期会话）。

---

#### M2. failedAttempts Map 未达锁定阈值的条目永不清理

- **文件**: server.js
- **行号**: 650, 877–891
- **描述**: `failedAttempts` 只在达到 `MAX_FAILED_ATTEMPTS` 后且锁定过期时才清理（行 882）。如果一个 IP 失败了 3 次（未达 10 次阈值），然后用户成功登录，该条目在 `recordFailedAttempt` 后被删除（行 974）。但如果用户失败 3 次后不再访问，该条目永久留在内存中。对于本地工作台影响小，但公网暴露时可能累积大量 IP 记录。
- **修复建议**: 添加定期清理逻辑，删除超过锁定窗口的条目。

---

#### M3. proxyRequest 无超时控制

- **文件**: server.js
- **行号**: 537–566
- **描述**: `proxyRequest` 函数用于代理 Ollama 请求，没有设置超时。如果 Ollama 进程挂起，代理请求会无限等待，占用 socket 连接。
- **修复建议**: 添加 `timeout` 选项（如 30 秒），超时后 `req.destroy()` 并返回 504。

---

#### M4. /api/* 未匹配路由返回 SPA index.html 而非 404 JSON

- **文件**: server.js
- **行号**: 611–625, 3735–3758
- **描述**: 所有未匹配到 API 路由的请求（包括 `/api/nonexistent`）最终走到 `serveStaticFile`，文件不存在时返回 `index.html`（200 OK）。这意味着访问 `/api/unknown-endpoint` 会收到 HTML 而非 JSON 404，可能导致前端调试困难。
- **修复建议**: 在静态文件服务前，对 `pathname.startsWith('/api/')` 但未匹配任何路由的请求返回 JSON 404。

---

#### M5. readBody 在拒绝后未销毁请求 — 继续消耗数据

- **文件**: server.js
- **行号**: 2641–2650
- **描述**: `readBody` 在 body 超过 1MB 时调用 `reject(new Error('请求体过大'))`，但没有 `req.destroy()` 或 `req.unpipe()`。`data` 事件继续触发，服务器继续接收并拼接数据，直到客户端断开。
- **修复建议**: 超限后调用 `req.destroy()`。

---

#### M6. 函数和常量在请求处理器内部重复创建 — 性能损耗

- **文件**: server.js
- **行号**: 809–3721（整个 createServer 回调内部）
- **描述**: 大量函数（`hashPassword`、`verifyPassword`、`loadAccessConfig`、`fetchUrl`、`extractCompanyInfo` 等约 20 个函数，合计超过 2000 行代码）和常量（`ACCESS_CONFIG_FILE`、`SESSION_COOKIE_NAME`、`ONLINE_APIS` 等）定义在 `http.createServer` 回调内部。每个 HTTP 请求都会重新创建这些函数闭包和常量绑定。虽然 V8 引擎会优化，但 `extractCompanyInfo`（435 行）这种大函数的闭包创建仍有开销。
- **修复建议**: 将纯函数和常量移到模块级作用域。

---

#### M7. 公网绑定 0.0.0.0 无 Cloudflare Access 前置认证

- **文件**: server.js
- **行号**: 47
- **描述**: 默认监听 `0.0.0.0`，意味着局域网和公网（经 Cloudflare Tunnel）均可访问。安全完全依赖应用层密码认证。虽然代码注释明确说明了这一设计决策，但演示期间如果密码强度不足（当前密码 6 位数字），存在被暴力破解风险。
- **修复建议**: 演示期间临时设置 `HOST=127.0.0.1`，或启用 Cloudflare Access 作为前置认证。

---

### LOW（低）

#### L1. 空 catch 块（静默吞错）

- **文件**: server.js
- **行号**: 201, 729, 846, 857, 2178, 2201, 3160, 3523
- **描述**: 以下 catch 块为空或仅返回 false，不记录任何日志：
  - 行 201: `metaDocs` 读取失败 — 元文档配置静默缺失，检索排序可能异常
  - 行 729: `LocalModelLock.forceReleaseAll()` 失败 — 取消任务时锁未释放
  - 行 846: `access_config.json` 读取失败 — 会继续走首次运行逻辑
  - 行 857: 首次运行密码写入失败 — 用户看不到密码
  - 行 2178: `search_cache.json` 写入失败 — 缓存不持久化
  - 行 2201: `search_usage.json` 写入失败 — 用量统计丢失
  - 行 3160: ccTLD 解析失败 — 静默降级
  - 行 3523: robots 路径检查失败 — 可能错误放行
- **修复建议**: 至少添加 `console.warn` 或 `log()` 记录失败原因。

---

#### L2. 日期/时间处理依赖服务器本地时区

- **文件**: server.js
- **行号**: 2190–2193, 285
- **描述**: `getCurrentMonthKey()` 使用 `new Date()` 的本地时区获取月份。服务器运行在中国时区（UTC+8），当前无问题。但如果将来部署到其他时区服务器，月度统计的月份边界会偏差。
- **修复建议**: 如仅本地运行可接受；如需部署，硬编码 `timeZone: 'Asia/Shanghai'`。

---

#### L3. 静态文件 denylist 覆盖不全 — 内部审计报告和交接文档可通过 HTTP 访问

- **文件**: server.js（STATIC_DENYLIST，行 570–584）
- **描述**: 以下敏感文件/目录不在 denylist 中，可通过 HTTP 直接访问：
  - `审计报告_*.md`（5 个文件，含内部安全审计发现）
  - `项目交接文档_V77.3.1.md`、`项目交接文档_完整备份.md`
  - `安全架构与事实源说明.md`
  - `release/` 目录（含本次审计报告）
  - `research/` 目录
  - `备份/` 目录
- **修复建议**: 将 `审计报告`、`交接文档`、`安全架构`、`release`、`research`、`备份` 加入 denylist。

---

#### L4. 无 package.json — 依赖管理缺失

- **文件**: 项目根目录
- **描述**: 项目没有 `package.json`，无法记录 Node.js 版本要求、依赖列表和启动脚本。虽然当前只用内置模块，但：(1) 新开发者不知道需要哪个 Node.js 版本；(2) `npm start` 等标准命令不可用；(3) 无法通过 `npm audit` 检查漏洞（虽然没有第三方依赖）。
- **修复建议**: 创建最小 `package.json`，声明 Node.js 版本要求和 `start` 脚本。

---

#### L5. 无 npm 依赖 — 无已知依赖漏洞

- **描述**: 项目仅使用 Node.js 内置模块（http, https, fs, crypto, path, url, dns），无第三方 npm 依赖。因此不存在第三方依赖漏洞风险。这是好事。
- **注意**: Node.js 本身的安全补丁需保持更新。建议使用 Node.js 18 LTS 或更高版本。

---

#### L6. 启动脚本路径硬编码 — 移动目录后桌面启动器失效

- **文件**: ~/Desktop/启动外贸客户开发工作台.command
- **行号**: 11
- **描述**: `WORKBENCH_DIR="/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/外贸获客AI工作台"` 硬编码了外置 SSD 的挂载路径。如果 SSD 更换、盘符变化或未连接，脚本会报错退出（已有目录检查和提示，行 15-24）。
- **修复建议**: 当前已有目录存在性检查和用户提示，可接受。如需增强，支持环境变量或配置文件。

---

#### L7. start.command 端口占用检查后仍可强制启动

- **文件**: start.command
- **行号**: 89–98
- **描述**: 端口 8080 被占用时提示用户并等待确认，但用户输入 `y` 后继续启动 `node server.js`，会因 EADDRINUSE 直接退出（行 3791–3798）。提示与行为不一致。
- **修复建议**: 用户确认后先 kill 旧进程再启动，或直接退出。

---

## 三、审计要点逐项结论

| 审计要点 | 结论 |
|---|---|
| 1. 语法错误 | 无致命语法错误。`decodeURIComponent` 无保护（H2）。 |
| 2. 空 try-catch | 8 处空 catch 块（L1），多数可接受但建议加日志。 |
| 3. 硬编码 | 密码 441723 硬编码在启动脚本（C2）。Ollama URL、端口、公网域名为配置项，可接受。 |
| 4. API 端点认证 | 所有 `/api/ai/*`、`/api/kb/*`、`/api/lead-quality/*`、`/api/access/*`（除登录/登出/状态外）、`/api/search/*`、`/api/fetch`、`/api/company/fetch` 均有 `requireAuth`。`/api/health` 和 `/robots.txt` 公开，返回最小信息，可接受。**`/api/import/*`、`/api/export/*`、`/api/customer/*`、`/api/draft/*`、`/api/campaign/*`、`/api/inquiry/*`、`/api/backup/*` 端点不存在** — 客户数据和草稿存储在浏览器 localStorage，无服务端持久化。 |
| 5. 路由 404 fallback | 未匹配路由返回 index.html（200）而非 JSON 404（M4）。 |
| 6. 静态文件保护 | denylist 存在但通配符逻辑有缺陷（C3），部分内部文档未覆盖（L3）。`server.js`、`api_config.json`、`access_config.json`、`.env`、`kb_index.json` 均在 denylist 中。 |
| 7. 文件路径遍历 | `safeKbPath()`（行 302–325）防护完善：拒绝绝对路径、`..`、规范化后复查、realpath 符号链接检查。静态文件服务也有 `..` 检测和 ROOT_DIR 边界检查。 |
| 8. 数据验证 | POST body 通过 `readBody()` 解析 JSON 并有 1MB 限制。各端点有基本必填字段检查。密码修改有长度检查（≥6 位）。 |
| 9. XSS | 服务端 API 返回 JSON，前端负责转义。服务端无 HTML 输出。`/api/kb/file` 和 `/api/kb/document` 返回 markdown 原文，前端渲染时需自行转义（服务端不负责）。 |
| 10. 并发竞争 | `searchCache` 读-改-写存在竞态（H4 加剧了此问题，因为每次请求都重新读文件）。`writeFileSync` 同步执行，单请求内安全，但跨请求可能丢失缓存写入。对本地工作台影响小。 |
| 11. 内存泄漏 | `activeSessions` 过期会话不主动清理（M1）。`failedAttempts` 部分条目不清理（M2）。`asyncJobs` 完成后 1 小时自动删除（行 701），良好。`scopeLog` 限制 20 条，良好。 |
| 12. 错误处理 | 绝大多数 API 端点有 try-catch 并返回 500。全局 `uncaughtException` 和 `unhandledRejection` 防止进程崩溃。MX 检查存在双响应 bug（C1）。 |
| 13. 模型调用失败兜底 | `ModelRouter.generate()` 有故障转移机制（在线→本地）。异步任务有 try-catch 并记录错误。搜索有 Tavily→SearXNG 降级。良好。 |
| 14. 导入导出边界 | 服务端无导入导出端点。客户端 localStorage 导入导出不在服务端审计范围。 |
| 15. 日期时区 | 日志使用 `Asia/Shanghai` 时区。月度统计依赖服务器本地时区（L2）。可接受。 |
| 16. TODO/FIXME/占位符 | 未发现 TODO/FIXME/XXX/HACK。仅"临时密码"相关代码（行 858, 1032），属正常功能。 |
| 17. 死代码 | `checkAccessRateLimit` 函数定义后从未调用（H1）。`escapeRegex` 函数（行 489–491）定义后未使用。`ONLINE_APIS` 数组（行 254–258）定义后未被引用。 |
| 18. 依赖漏洞 | 无第三方 npm 依赖（L4/L5）。 |
| 19. 启动脚本 | start.command 功能完整但硬编码密码（C2）。桌面启动器硬编码路径（L6）和密码（C2）。launchd plist 依赖外置 SSD 路径。 |
| 20. DNS/MX 端点 | `/api/lead-quality/mx-check` 有认证、5 秒超时、错误分类。但存在双响应 bug（C1）。 |

---

## 四、死代码清单

| 函数/变量 | 行号 | 说明 |
|---|---|---|
| `checkAccessRateLimit()` | 947–960 | 定义后从未调用（H1） |
| `ACCESS_RATE_LIMIT` | 946 | 同上 |
| `escapeRegex()` | 489–491 | 定义后从未调用 |
| `ONLINE_APIS` | 254–258 | 定义后从未引用（健康检查已直接在启动时调用 checkOllama） |

---

## 五、统计汇总

| 指标 | 数量 |
|---|---|
| 审计文件数 | 4（server.js, start.command, 桌面启动器, package.json[不存在]） |
| 总代码行数 | 4044 |
| 发现问题总数 | 22 |
| **Critical** | **3** |
| **High** | **5** |
| **Medium** | **7** |
| **Low** | **7** |

### 按等级分布

```
Critical  ███ 3
High      █████ 5
Medium    ███████ 7
Low       ███████ 7
```

---

## 六、演示前优先修复建议

1. **C1**: MX 检查添加 `res.writableEnded` 守卫（5 分钟修复）
2. **C2**: 从两个 .command 脚本中删除明文密码（2 分钟修复）
3. **H1**: 在 `/api/access/verify` 中调用 `checkAccessRateLimit`（2 分钟修复）
4. **H2**: `decodeURIComponent` 包裹 try-catch（2 分钟修复）
5. **H4**: 将 `searchCache`/`usageData` 移到模块级（10 分钟修复）

以上 5 项修复预计耗时约 20 分钟，可消除所有 Critical 和主要 High 风险。

---

*报告结束。本审计为只读审计，未修改任何代码文件。*
