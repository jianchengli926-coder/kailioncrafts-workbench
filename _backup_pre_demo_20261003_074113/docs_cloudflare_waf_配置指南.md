# Cloudflare WAF / Rate Limit 手动配置指南

> 适用对象：`workbench.kailioncrafts.com`（KaiLionCrafts 企业 AI 工作台）
> 前提：Cloudflare 免费计划，现有 Cloudflare Tunnel 已运行
> 本文件仅提供手动操作步骤，不自动创建规则

---

## 一、为什么需要 WAF

公网入口 `https://workbench.kailioncrafts.com` 不使用 Cloudflare Access 邮箱验证，直接由工作台密码页保护。登录页可被互联网扫描器发现并尝试暴力破解。配置 WAF Rate Limit 可在密码页之外增加一层限速保护。

**剩余风险说明**：即使配置了 WAF，公网登录页仍可被扫描；WAF 仅降低高频攻击成功率，不能替代强密码和定期轮换。

---

## 二、Streamlit 请求路径分析

配置规则前需了解 Streamlit 的实际请求模式，避免误杀正常访问：

| 路径模式 | 用途 | 请求频率 | 是否应限速 |
|---|---|---|---|
| `/` | 主页面（含登录表单） | 每次页面加载 1 次 | ✅ 是 |
| `/static/*` | JS/CSS/字体/图片等静态资源 | 每次页面加载 ~15-20 次 | ❌ 否（批量加载） |
| `/_stcore/stream` | WebSocket 长连接（实时交互） | 每会话 1 条长连接 | ❌ 否（长连接非请求） |
| `/healthz` | 健康检查 | 低频 | ❌ 否 |
| `/_stcore/health` | Streamlit 健康检查 | 低频 | ❌ 否 |
| `/media/*` | 上传/下载媒体 | 低频 | ⚠️ 可选 |
| `/component/*` | 自定义组件资源 | 低频 | ❌ 否 |

**关键结论**：正常用户每次页面加载仅产生 1-2 次非静态 HTTP 请求（主页面 + 可能的 healthz），交互通过已有 WebSocket 完成，不产生新 HTTP 请求。因此对非静态路径设置限速阈值可以较宽松而不影响正常使用。

---

## 三、Cloudflare 免费计划可用能力

| 功能 | 免费计划额度 | 本方案使用 |
|---|---|---|
| Rate Limiting Rules | 1 条活跃规则 | ✅ 使用 1 条 |
| Custom Rules（原 Firewall Rules） | 5 条活跃规则 | 可选（见下文） |
| Managed Rules | Free Managed Ruleset | 建议保持默认开启 |
| Transform Rules | 10 条响应头修改 | 本轮不配置 X-Robots-Tag |

---

## 四、规则 1：Rate Limiting（核心，建议配置）

### 4.1 配置路径

Cloudflare Dashboard → 选择 `kailioncrafts.com` → Security → WAF → Rate limiting rules → Create rule

### 4.2 规则参数

| 字段 | 值 |
|---|---|
| Rule name | `workbench-rate-limit` |
| If incoming requests match… | 见下方表达式 |
| Then | 见下方动作 |
| With | 见下方阈值 |

### 4.3 匹配表达式（Field: Expression）

```
(http.host eq "workbench.kailioncrafts.com")
and (not starts_with(http.request.uri.path, "/static/"))
and (not starts_with(http.request.uri.path, "/_stcore/stream"))
and (not http.request.uri.path eq "/healthz")
and (not http.request.uri.path eq "/_stcore/health")
```

**说明**：
- 仅匹配 `workbench.kailioncrafts.com`，不影响 `crm/creator/prospect` 等其他子域名
- 排除静态资源（`/static/*`），避免页面加载时批量请求触发限速
- 排除 WebSocket（`/_stcore/stream`），避免长连接被误判
- 排除健康检查端点

### 4.4 阈值与动作

| 字段 | 值 | 说明 |
|---|---|---|
| Count | 50 | 请求数 |
| Period | 10 seconds | 统计窗口 |
| Action | Managed Challenge | 弹出 Cloudflare 验证（非直接阻断） |
| Duration | 10 minutes | 挑战持续时间 |
| Mitigation timeout | 10 minutes | 超时后重新计数 |

**阈值设计理由**：
- 正常用户每次页面加载仅 1-2 次非静态请求，50 次/10 秒远高于正常使用
- 暴力破解工具通常每秒发送数十次请求，会被快速触发
- Managed Challenge 而非直接 Block：避免误杀正常用户（如快速切换页面），同时对自动化工具构成障碍
- 不影响本机或局域网直连 `8501`：这些流量不经过 Cloudflare

### 4.5 部署后验证

1. 正常访问 `https://workbench.kailioncrafts.com`，确认页面加载正常、无挑战
2. 快速刷新页面 5-10 次，确认不触发挑战
3. （可选）用 `curl` 快速发送 60 次请求到 `/`，确认触发 Managed Challenge：
   ```bash
   for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code} " https://workbench.kailioncrafts.com/; done
   ```
   预期：前 ~50 次返回 200，之后返回 403（挑战页）

---

## 五、规则 2（可选）：Custom Rule — 挑战已知恶意 User-Agent

如果需要额外防护，可添加一条 Custom Rule 对常见扫描器 User-Agent 直接挑战。

### 5.1 配置路径

Security → WAF → Custom rules → Create rule

### 5.2 匹配表达式

```
(http.host eq "workbench.kailioncrafts.com")
and (
  (http.user_agent contains "sqlmap")
  or (http.user_agent contains "nikto")
  or (http.user_agent contains "nmap")
  or (http.user_agent contains "masscan")
  or (http.user_agent contains "dirbuster")
  or (http.user_agent contains "gobuster")
  or (http.user_agent contains "hydra")
  or (lower(http.user_agent) contains "curl/") and (not http.request.uri.path eq "/healthz")
)
```

### 5.3 动作

Managed Challenge（或 Block，视严格程度）

> **注意**：包含 `curl/` 的规则可能影响合法的健康检查脚本。建议仅在确认无外部监控使用 curl 时启用，或排除 `/healthz` 和 `/_stcore/health`（上方表达式已排除 healthz）。

---

## 六、不建议配置的规则

| 规则类型 | 原因 |
|---|---|
| 对 `/static/*` 限速 | 页面加载需批量下载 15-20 个静态文件，限速会破坏页面加载 |
| 对 `/_stcore/stream` 限速 | WebSocket 长连接是 Streamlit 核心，限速会导致页面无响应 |
| 对所有路径设置过低阈值（如 10 次/分钟） | 正常用户快速操作可能被误杀 |
| IP 黑名单（固定 IP 阻断） | 维护成本高，且正常用户可能使用动态 IP |
| Country/Region 阻断 | 可能误杀合法的海外同事或客户 |
| Browser Integrity Check 对 WebSocket | 可能干扰 Streamlit 的 WebSocket 握手 |

---

## 七、回滚步骤

1. 登录 Cloudflare Dashboard → `kailioncrafts.com` → Security → WAF
2. 找到 `workbench-rate-limit` 规则
3. 点击开关将其禁用（Disable），或点击 Delete 删除
4. 规则立即生效（全球边缘节点通常 30 秒内同步）
5. 验证：`curl -sI https://workbench.kailioncrafts.com` 确认不再触发挑战

---

## 八、监控与调整

配置后观察 1-2 周：

1. **WAF 概览**：Security → WAF → Overview，查看被挑战/阻断的请求数
2. **事件日志**：Security → WAF → Events，确认是否有误杀正常用户
3. **调整阈值**：
   - 如果正常用户被挑战：将 Count 从 50 提高到 100，或 Period 从 10s 缩短到 5s
   - 如果攻击仍能通过：将 Count 从 50 降低到 30，或将 Action 从 Managed Challenge 改为 Block

---

## 九、与 noindex 的关系

- 本工作台已在 `app.py` 中添加页面级 `<meta name="robots" content="noindex, nofollow, noarchive">`
- 未配置 Cloudflare `X-Robots-Tag` Transform Rule（本轮不要求）
- WAF Rate Limit 与 noindex 是独立的安全措施：noindex 降低搜索引擎收录概率，WAF 降低暴力破解风险
- 两者都不能保证绝对安全，强密码 + 定期轮换仍是基础

---

*文档生成时间：2026-10-03 | 仅适用于 workbench.kailioncrafts.com | 不包含任何 API Token 或凭据*
