# 安全策略与敏感信息处理

> **仓库级别：内部私有（Private）**  
> **最后更新：** 2026-10-03（第二阶段审计更新）

## 1. 仓库安全分类

本仓库包含 KaiLionCrafts 外贸获客工作台的完整源代码和内部资料，属于**内部私有仓库**，不得公开。

### 1.1 敏感信息等级

| 等级 | 内容 | 处理方式 |
|------|------|----------|
| **机密（Confidential）** | API Key、密码、客户真实数据、报价/成本/底价、工厂信息、认证归属 | 绝不入库，仅存本机 |
| **内部（Internal）** | 知识库 internal 文档、开发流程、内部工具、交接文档 | 可入 Private 仓库，不可入 Public |
| **公开（Public）** | 产品介绍、公开功能说明、脱敏演示数据 | 可入 Public 演示仓库 |

## 2. 绝不入库的文件

以下文件**必须**在 `.gitignore` 中，且不得通过任何方式提交：

```
api_config.json          # AI 模型 API Key
kb_config.json           # 知识库路径配置
search_config.json       # Tavily 搜索 API Key
access_config.json       # 登录密码哈希和 salt
kb_index.json            # 知识库索引（含完整内容切片）
kb_index_*.json
公司知识库*/              # 公司知识库完整备份
公司核心事实清单_待核对.md
卖点与服务清单_待补充.md   # 含内部底价/成本
localStorage_backup*.json # 客户数据备份
*_backup_*.json
*_backup_*.zip
```

### 2.1 检查命令

提交前必须执行：

```bash
# 检查是否有敏感文件被跟踪
git ls-files | grep -iE "api_config|kb_config|search_config|access_config|kb_index|公司知识库|核心事实|卖点与服务|localStorage_backup"

# 检查历史中是否有敏感文件（需彻底清理）
git log --all --full-history -- "api_config.json" "kb_config.json" "公司知识库*"
```

### 2.2 已验证状态（2026-10-03）

- ✅ api_config.json、access_config.json、kb_index.json 均在 .gitignore 中
- ✅ Git 跟踪文件中无敏感配置文件（仅 kb_config.example.json 示例文件和 kb_indexer.py 代码文件）
- ✅ Git 历史中无敏感文件
- ✅ 前端源码中无硬编码 API Key（2026-10-03 已移除 14 处硬编码 Key）

## 3. API 端点安全

### 3.1 必须认证的端点

以下端点**必须**验证 session，不得匿名访问（已验证均返回 401）：

| 端点 | 状态 | 原因 |
|------|------|------|
| `/api/ai/config` | ✅ 401 | 暴露模型端点和配置 |
| `/api/kb/status` | ✅ 401 | 暴露知识库结构和分类 |
| `/api/kb/context` | ✅ 401 | 暴露知识库内容 |
| `/api/kb/search` | ✅ 401 | 暴露知识库内容 |
| `/api/ai/models` | ✅ 401 | 暴露模型列表 |

### 3.2 可匿名访问的端点（最小信息）

| 端点 | 允许返回 | 禁止返回 |
|------|----------|----------|
| `/api/health` | `{"status":"ok"}` | 服务器端口、Ollama 模型、API 状态 |
| `/api/access/status` | `{"hasPassword":true}` | `isDefault`、密码提示 |

### 3.3 安全响应头（当前实际状态）

**重要：Content-Security-Policy (CSP) 已临时移除。**

**移除原因**：CSP 响应头触发用户浏览器广告拦截扩展（如 AdBlock、uBlock Origin）的拦截规则，导致页面显示灰色空白页，无法正常使用。在无痕模式下（扩展禁用）页面正常。

**移除后的风险**：
- XSS 攻击防护能力下降（依赖代码层面的 esc() 转义）
- 无法限制外部资源加载
- 点击劫持防护减弱

**当前替代防护措施**：
- ✅ 所有用户输入使用 esc() 函数转义（2026-10-03 修复 2 处遗漏）
- ✅ 静态文件 denylist 禁止访问 .js/.json/.py 等源文件
- ✅ API 端点 requireAuth 认证
- ✅ Cookie HttpOnly 防止 XSS 窃取会话

**生产环境建议**：重新设计更宽松的 CSP 策略（如 `default-src 'self' 'unsafe-inline' 'unsafe-eval'`），而非永久放弃 CSP。

当前实际响应头：
```
X-Content-Type-Options: nosniff
```

### 3.4 Cookie 安全（实际状态）

```
Set-Cookie: kl_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800
# HTTPS 环境下自动追加 Secure 标志
```

- **HttpOnly**：✅ 已启用，防止 XSS 窃取
- **Secure**：✅ HTTPS 环境自动启用（HTTP 环境不设置，避免本地访问失败）
- **SameSite=Lax**：✅ 当前策略。对于本地单页应用足够；公网部署建议评估是否升级为 Strict
- **Max-Age=28800**：✅ 8 小时会话过期
- **会话过期后**：✅ 所有敏感接口返回 401

## 4. 登录安全（实际状态）

- ✅ 密码使用 scrypt + salt 哈希存储，不明文存储
- ✅ 5 次失败后锁定 30 秒（带抖动动画提示）
- ✅ 修改密码仅允许本机 + 已验证会话
- ✅ 默认密码已修改（密码 441723，非默认值）
- ✅ 登录失败有明确错误提示，不泄露具体原因
- ⚠️ 必须：公网 Tunnel 展示前配置 Cloudflare Access Zero Trust 作为第一道防线；工作台密码只能作为第二层保护
- ✅ 默认监听 `127.0.0.1`，防止局域网设备绕过 Cloudflare Access 直连；仅显式设置 `HOST=0.0.0.0` 时开放局域网监听
- ✅ 受控展示响应包含 `X-Robots-Tag: noindex, nofollow, noarchive`，并提供 `robots.txt` 禁止搜索引擎抓取

## 5. 知识库访问控制

| 知识库级别 | 本机 | 局域网 | 公网 |
|-----------|------|--------|------|
| public | ✅ | ✅ | ✅ |
| internal | ✅ | ✅ | ❌ |
| confidential | ✅ | ❌ | ❌ |

- `online_safe` 模式仅允许 public 知识库条目
- `local_only` 模式允许 public + internal，始终排除 confidential
- `factEligible=true` 才能作为公司事实写入开发信
- `templateEligible` 仅可作为写作结构参考，不得写成公司能力
- ✅ 知识库搜索 API 需登录认证（401）
- ✅ 知识库索引文件 kb_index.json 禁止静态访问（403）

## 6. XSS 防护

### 6.1 已实现

- ✅ esc() 函数转义 &、<、>、" 字符
- ✅ 267 处 innerHTML 使用，大部分已正确转义
- ✅ 2026-10-03 修复 2 处遗漏：客户公司名（第12650行）、搜索词（第33838行）

### 6.2 剩余风险

- ⚠️ AI 输出内容直接渲染时可能包含 HTML，需确保 AI 输出经过 sanitize
- ⚠️ 建议增加 DOMPurify 等库对富文本内容进行消毒

## 7. API Key 安全（2026-10-03 重大修复）

### 7.1 已修复问题

**P0 级安全问题**：app.js 的 `defaultApis()` 函数中硬编码了 5 个真实 API Key（使用 base64 编码，但可轻松解码）：
- OpenAI 中转站 Key
- 智谱 GLM Key（2个不同Key）
- 硅基流动 Key
- Google Gemini Key

**修复措施**：
- ✅ 所有硬编码 API Key 已替换为空字符串
- ✅ 保留模型名称、baseURL、model 等非敏感配置
- ✅ 用户需在「设置 → 模型配置」中手动输入 Key
- ✅ 后端 model-router.js 使用 api_config.json 中的 Key（.gitignore 保护）

### 7.2 必须执行的操作

⚠️ **由于这些 Key 已暴露在前端源码中（即使已删除，Git 历史中可能仍有记录），建议立即在对应平台轮换：**
1. 智谱开放平台 (open.bigmodel.cn)
2. 硅基流动 (siliconflow.cn)
3. Google AI Studio
4. OpenAI 中转站 (wawapi.top)

### 7.3 Trace 脱敏

- ✅ model-trace.js 中 apiKey、api_key、apikey 等字段在敏感字段列表中，记录时自动脱敏
- ✅ 不记录完整 Prompt 和敏感客户信息

## 8. 数据安全

### 8.1 导出安全

- ✅ 导出功能不包含 apiKey、password、token、cookie、secret 等敏感字段
- ✅ webhookSecret 在敏感字段排除列表中

### 8.2 清空数据

- ✅ 所有清空操作均有 confirm() 二次确认
- ✅ 操作日志、AI生图历史、视觉分析历史、WhatsApp话术、客户画像、翻译历史、分析历史均有确认

### 8.3 导入安全

- ✅ 选择文件后仅本地预览，不自动写入客户库
- ✅ 导入需人工勾选确认
- ✅ 不会自动发送任何邮件/消息

### 8.4 外部通信

- ✅ 工作台不会调用 SMTP、邮件 API 或 Webhook 自动发送任何消息
- ✅ 实际投递由用户在外部邮箱中人工完成
- ✅ 不删除原始知识库文件

## 9. 漏洞报告

发现安全问题请立即：

1. 停止使用受影响功能
2. 通知仓库管理员
3. 不要在公开 Issue 中描述漏洞细节
4. 评估影响范围并修复

### 9.1 安全待办（更新于 2026-10-03）

**已完成**：
- [x] 前端硬编码 API Key 移除（P0）
- [x] XSS 遗漏修复（2处）
- [x] /api/ai/config、/api/kb/status 等端点 session 认证
- [x] Cookie HttpOnly 启用
- [x] Cookie Secure（HTTPS 自动启用）
- [x] 静态敏感文件 denylist（403）
- [x] 登录失败限速（5次/30秒）
- [x] 默认密码已修改

**待完成**：
- [ ] 重新设计宽松 CSP 策略（当前已移除）
- [ ] Cookie SameSite 评估是否升级为 Strict（公网部署时）
- [ ] 增强登录限速（10次/15分钟 + 长期IP封禁）
- [ ] 配置 Cloudflare Access Zero Trust（公网部署时）
- [ ] AI 输出内容 sanitize（DOMPurify）
- [ ] 轮换已暴露的 API Key（用户手动操作）

## 10. 公网部署安全检查清单

部署到公网前必须确认：

- [ ] 仓库已设为 Private
- [ ] 所有 API 端点已认证
- [ ] 默认密码已修改（✅ 已完成）
- [ ] HTTPS 已配置
- [ ] Cookie Secure 已启用（✅ HTTPS 自动启用）
- [ ] 安全响应头已添加（CSP 需重新设计）
- [ ] Cloudflare Access 已配置（推荐）
- [ ] 敏感文件已确认不在 Git 历史中（✅ 已验证）
- [ ] 日志不记录密码和 API Key（✅ Trace 已脱敏）
- [ ] 服务器端口不直接暴露（仅通过 Cloudflare Tunnel）
- [ ] 已暴露的 API Key 已轮换
- [ ] 前端源码无硬编码密钥（✅ 已清理）
