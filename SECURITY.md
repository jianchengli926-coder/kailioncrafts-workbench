# 安全策略与敏感信息处理

> **仓库级别：内部私有（Private）**  
> **最后更新：** 2026-09-30

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

## 3. API 端点安全

### 3.1 必须认证的端点

以下端点**必须**验证 session，不得匿名访问：

| 端点 | 原因 |
|------|------|
| `/api/ai/config` | 暴露模型端点和配置 |
| `/api/kb/status` | 暴露知识库结构和分类 |
| `/api/kb/context` | 暴露知识库内容 |
| `/api/kb/search` | 暴露知识库内容 |
| `/api/company/facts` | 暴露公司事实数据 |
| `/api/proxy/*` | 已禁用（403） |

### 3.2 可匿名访问的端点（最小信息）

| 端点 | 允许返回 | 禁止返回 |
|------|----------|----------|
| `/api/health` | `{"status":"ok"}` | 服务器端口、Ollama 模型、API 状态 |
| `/api/access/status` | `{"hasPassword":true}` | `isDefault`、密码提示 |

### 3.3 安全响应头

所有响应必须包含：

```
Content-Security-Policy: default-src 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000
```

### 3.4 Cookie 安全

```
Set-Cookie: kl_session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800
```

- **HttpOnly**：防止 XSS 窃取 ✅
- **Secure**：仅 HTTPS 传输（需补充）
- **SameSite=Strict**：防止 CSRF（当前为 Lax，建议升级为 Strict）

## 4. 登录安全

- 密码使用 scrypt + salt 哈希存储，不明文存储
- 5 次失败 / IP 锁定 1 分钟（建议增强为 10 次 / 15 分钟）
- 修改密码仅允许本机 + 已验证会话
- **必须修改默认密码**（`/api/access/status` 不得返回 `isDefault:true`）
- 建议增加 Cloudflare Access Zero Trust 作为第一道防线

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

## 6. 漏洞报告

发现安全问题请立即：

1. 停止使用受影响功能
2. 通知仓库管理员
3. 不要在公开 Issue 中描述漏洞细节
4. 评估影响范围并修复

### 6.1 已知安全待办

- [ ] `/api/health` 移除 Ollama 模型和服务器信息暴露
- [ ] `/api/ai/config`、`/api/kb/status` 增加 session 认证
- [ ] Cookie 添加 `Secure` 标志
- [ ] 添加 CSP、X-Frame-Options、Referrer-Policy 等响应头
- [ ] 增强登录限速（10次/15分钟 + 长期IP封禁）
- [ ] 配置 Cloudflare Access Zero Trust
- [ ] 修改默认密码

## 7. 公网部署安全检查清单

部署到公网前必须确认：

- [ ] 仓库已设为 Private
- [ ] 所有 API 端点已认证
- [ ] 默认密码已修改
- [ ] HTTPS 已配置
- [ ] Cookie Secure 已启用
- [ ] 安全响应头已添加
- [ ] Cloudflare Access 已配置（推荐）
- [ ] 敏感文件已确认不在 Git 历史中
- [ ] 日志不记录密码和 API Key
- [ ] 服务器端口不直接暴露（仅通过 Cloudflare Tunnel）
