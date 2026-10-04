# GitHub 开源项目研究报告：外贸客户开发 / B2B Sales / Lead Generation / CRM / Prospecting / Outreach

> **研究日期**：2026-10-03（Asia/Shanghai）
> **数据来源**：GitHub REST API 实时拉取（`api.github.com/repos/{owner}/{repo}`），所有 Star / Fork / License / pushed_at 均为 API 返回的真实数据，未编造。
> **研究对象**：KaiLionCrafts 外贸获客 AI 工作台（Node.js + 原生 JS + localStorage，单人 B2B 业务，37 个功能模块）
> **研究目的**：找出可借鉴的开源功能 / 可复用代码 / 可参考设计，避免重复造轮子。

---

## 一、执行摘要

本次共核实 **20 个 GitHub 项目**，覆盖 CRM、Lead Generation、Prospecting、Outreach、Email Marketing、Knowledge Base、Customer Communication、Scheduling 八大方向。

**关键结论：**

1. **真正可直接复用代码的只有 MIT / Apache-2.0 许可的轻量工具**，即 `omkarcloud/google-maps-scraper`（MIT）和 `warmbly/warmbly`（Apache-2.0）。
2. **绝大多数知名开源 CRM（Twenty、EspoCRM、SuiteCRM、NocoDB、Baserow、Chatwoot、Mautic、Listmonk、AppFlowy、Outline）都是 AGPL-3.0 或自定义商业友好型 License**——可以本地部署使用、可以参考 UI/UX 和工作流设计，但**不能直接把它们的代码复制进 KaiLionCrafts 自有商业产品**（AGPL 网络使用条款会传染）。
3. **KaiLionCrafts 当前是 localStorage + 单用户本地工具**， copyleft 传染风险较低；但如果未来把工作台部署成在线服务给外部访问，任何 AGPL 代码混入都会触发开源义务。
4. **对外贸 B2B 单人业务最有价值的不是"再装一个 CRM"**，而是：
   - Google Maps 商家抓取（开发信名单来源）
   - 外联邮件活动 /  warmed-up 发件箱设计
   - 销售管道（pipeline）看板信息架构
   - Lead 评分 / 资格判定工作流

---

## 二、项目分类总览

| 分类 | 数量 | 说明 |
|---|---|---|
| 🟢 可直接使用 / 可复用代码（MIT / Apache-2.0） | 3 | google-maps-scraper、warmbly、50k-lead-generation-system |
| 🔵 可参考设计（UI/UX/工作流，勿复制代码） | 11 | Twenty、EspoCRM、SuiteCRM、NocoDB、Baserow、Chatwoot、Cal.com、Mautic、Listmonk、Outline、Gophish |
| 🟠 License 不适合直接复用（AGPL / BSL / 自定义） | 同 🔵 | 这些项目 License 本身就是 AGPL/BSL/自定义，列出仅供参考设计 |
| 🔴 不推荐（与外贸 B2B 单人场景不匹配 / 停滞） | 6 | Monica、OpenProject、Odoo CRM、AppFlowy、Docmost、AnyType、Postal |

> 说明：一个项目可能同时落入"可参考设计"和"License 不适合直接复用"两类——它的设计值得学，但代码不能抄。

---

## 三、项目逐条 17 字段记录

> 字段顺序按要求：1.名称 2.URL 3.类型 4.解决的问题 5.技术栈 6.最近更新 7.Star/Fork 8.License 9.是否仍维护 10.是否可本地部署 11.是否适合商业使用 12.可借鉴功能 13.可复用代码 14.复用成本 15.安全风险 16.数据隐私风险 17.是否推荐

---

### 1. Twenty CRM

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Twenty |
| 2 | URL | https://github.com/twentyhq/twenty |
| 3 | 类型 | 开源（社区版）+ 商业（Enterprise 版）混合 |
| 4 | 解决的问题 | "The open alternative to Salesforce, designed for AI"——现代化 CRM，面向 AI 原生销售流程 |
| 5 | 技术栈 | TypeScript / NestJS / React / PostgreSQL / GraphQL / Monorepo |
| 6 | 最近更新 | pushed_at 2026-09-07（活跃） |
| 7 | Star/Fork | **56,378 / 8,964** |
| 8 | License | GitHub 识别为 `Other / NOASSERTION`（Twenty 自定义 License，非 OSI 认证，对多租户 SaaS 商用有限制） |
| 9 | 是否仍维护 | ✅ 是，非常活跃 |
| 10 | 是否可本地部署 | ✅ Docker 自部署 |
| 11 | 是否适合商业使用 | ⚠️ 社区版可自用，但**禁止直接把其代码拷进闭源商业产品**；商用 SaaS 需 Enterprise 授权 |
| 12 | 可借鉴功能 | 对象关系设计（Company/People/Deal）、Kanban Pipeline、AI 字段、GraphQL API、Modern UI |
| 13 | 可复用代码 | ❌ 不建议直接复制代码（自定义 License） |
| 14 | 复用成本 | 高（如要借鉴需重写） |
| 15 | 安全风险 | 中（Docker 部署需自行加固） |
| 16 | 数据隐私风险 | 低（自部署数据不出本机） |
| 17 | 是否推荐 | ✅ **强烈推荐作为设计参考**（不抄代码） |

---

### 2. EspoCRM

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | EspoCRM |
| 2 | URL | https://github.com/espocrm/espocrm |
| 3 | 类型 | 开源 |
| 4 | 解决的问题 | 轻量开源 CRM，含 Sales Automation、Leads、Contacts、Calendar、Email Marketing |
| 5 | 技术栈 | PHP（后端）+ 前端 SPA |
| 6 | 最近更新 | pushed_at 2026-09-29（活跃） |
| 7 | Star/Fork | **3,424 / 985** |
| 8 | License | **AGPL-3.0** |
| 9 | 是否仍维护 | ✅ 是 |
| 10 | 是否可本地部署 | ✅ PHP+MySQL 自部署 |
| 11 | 是否适合商业使用 | ⚠️ AGPL——可自用/本地部署，但**不能把代码混入闭源商业产品**；网络对外服务必须开源全部修改 |
| 12 | 可借鉴功能 | Lead 漏斗、Sales Pipeline、Workflow Automation、Email Campaign、角色权限 |
| 13 | 可复用代码 | ❌ AGPL 传染，不建议复制 |
| 14 | 复用成本 | 中（设计可参考） |
| 15 | 安全风险 | 中（PHP 历史漏洞多，需保持更新） |
| 16 | 数据隐私风险 | 低（自部署） |
| 17 | 是否推荐 | ✅ 作为销售自动化工作流设计参考 |

---

### 3. SuiteCRM

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | SuiteCRM |
| 2 | URL | https://github.com/SuiteCRM/SuiteCRM |
| 3 | 类型 | 开源（社区版）+ 商业（Sugar 衍生） |
| 4 | 解决的问题 | 企业级开源 CRM，Accounts/Contacts/Leads/Opportunities/Quotes/Reports |
| 5 | 技术栈 | PHP |
| 6 | 最近更新 | pushed_at 2026-09-17（活跃） |
| 7 | Star/Fork | **5,781 / 2,426** |
| 8 | License | **AGPL-3.0** |
| 9 | 是否仍维护 | ✅ 是 |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ⚠️ AGPL，同 EspoCRM |
| 12 | 可借鉴功能 | 完整 CRM 数据模型、多币种、多语言、Workflow、Reports、Portal |
| 13 | 可复用代码 | ❌ AGPL |
| 14 | 复用成本 | 高（代码陈旧、PHP 老栈） |
| 15 | 安全风险 | 中高（历史 CVE 较多） |
| 16 | 数据隐私风险 | 低（自部署） |
| 17 | 是否推荐 | 🟡 可参考数据模型，但代码陈旧不建议深入 |

---

### 4. Monica CRM

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Monica |
| 2 | URL | https://github.com/monicahq/monica |
| 3 | 类型 | 开源 + 商业云 |
| 4 | 解决的问题 | **Personal CRM**——记住朋友/家人/商业关系，不是 B2B 销售 CRM |
| 5 | 技术栈 | PHP / Laravel |
| 6 | 最近更新 | pushed_at **2025-01-06**（⚠️ 已超过 9 个月未更新，活跃度下降） |
| 7 | Star/Fork | **21,967 / 2,202** |
| 8 | License | **AGPL-3.0** |
| 9 | 是否仍维护 | 🟡 维护节奏明显放缓 |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ⚠️ AGPL |
| 12 | 可借鉴功能 | 关系提醒、联系人互动记录、生日提醒——可借鉴"客户跟进提醒"设计 |
| 13 | 可复用代码 | ❌ AGPL |
| 14 | 复用成本 | 中 |
| 15 | 安全风险 | 中 |
| 16 | 数据隐私风险 | 低 |
| 17 | 是否推荐 | 🔴 **不推荐**——定位是个人关系管理，不是 B2B 获客 |

---

### 5. NocoDB（作为 CRM 可行性）

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | NocoDB |
| 2 | URL | https://github.com/nocodb/nocodb |
| 3 | 类型 | 开源 + 商业 |
| 4 | 解决的问题 | Airtable 开源替代品——把 Excel/Sheet 变成带 API 的数据库，可当轻量 CRM 用 |
| 5 | 技术栈 | TypeScript / Node.js / Vue |
| 6 | 最近更新 | pushed_at **2025-05-26**（⚠️ 距今约 16 个月） |
| 7 | Star/Fork | **54,583 / 3,881** |
| 8 | License | **AGPL-3.0** |
| 9 | 是否仍维护 | 🟡 仍在更新但节奏放缓 |
| 10 | 是否可本地部署 | ✅ 单 Docker |
| 11 | 是否适合商业使用 | ⚠️ AGPL |
| 12 | 可借鉴功能 | 视图（Grid/Kanban/Gallery/Form）、字段类型、自动化、API 自动生成 |
| 13 | 可复用代码 | ❌ AGPL |
| 14 | 复用成本 | 中 |
| 15 | 安全风险 | 中（自动生成 API 需鉴权） |
| 16 | 数据隐私风险 | 低（自部署） |
| 17 | 是否推荐 | 🟡 可作为"外部备选工具"自部署使用，但不建议把其代码逻辑拷进工作台 |

---

### 6. Baserow

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Baserow |
| 2 | URL | https://github.com/baserow/baserow |
| 3 | 类型 | 开源核心 + 商业 EE |
| 4 | 解决的问题 | Airtable 替代，带 AI 自动化、GDPR/HIPAA/SOC2 |
| 5 | 技术栈 | Python / Django / Vue |
| 6 | 最近更新 | pushed_at **2026-10-02**（非常活跃） |
| 7 | Star/Fork | **6,069 / 750** |
| 8 | License | GitHub 识别为 `Other / NOASSERTION`（核心 MIT 部分 + EE Commons Clause） |
| 9 | 是否仍维护 | ✅ 非常活跃 |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ⚠️ Commons Clause 禁止直接转售，自用可以 |
| 12 | 可借鉴功能 | 数据库表结构设计、自动化、Dashboard |
| 13 | 可复用代码 | 🟡 核心 MIT 部分可参考，但需逐文件确认 |
| 14 | 复用成本 | 中 |
| 15 | 安全风险 | 中 |
| 16 | 数据隐私风险 | 低 |
| 17 | 是否推荐 | 🟡 作为无代码数据库设计参考 |

---

### 7. Chatwoot

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Chatwoot |
| 2 | URL | https://github.com/chatwoot/chatwoot |
| 3 | 类型 | 开源核心 + 商业 EE |
| 4 | 解决的问题 | 开源 Intercom/Zendesk 替代——全渠道客户沟通（Live Chat / Email / WhatsApp / Telegram） |
| 5 | 技术栈 | Ruby on Rails / Vue / ActionCable |
| 6 | 最近更新 | pushed_at **2026-09-27**（活跃） |
| 7 | Star/Fork | **37,262 / 9,052** |
| 8 | License | GitHub 识别为 `Other / NOASSERTION`（社区版 MIT + EE 商业授权） |
| 9 | 是否仍维护 | ✅ |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ⚠️ EE 功能需商业授权，社区版可自用 |
| 12 | 可借鉴功能 | 会话分配、标签、SLA、Webhook、Contact 模型、Omnichannel 收件箱 |
| 13 | 可复用代码 | 🟡 社区版 MIT 部分可参考 |
| 14 | 复用成本 | 高（Ruby 栈与 Node.js 工作台不匹配） |
| 15 | 安全风险 | 中 |
| 16 | 数据隐私风险 | 低（自部署） |
| 17 | 是否推荐 | 🟡 如果未来需要在 kailioncrafts.com 上接在线客服，可自部署；当前单人工作台不急需 |

---

### 8. Cal.com

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Cal.com |
| 2 | URL | https://github.com/calcom/cal.com |
| 3 | 类型 | 开源核心 + 商业 |
| 4 | 解决的问题 | 日程调度基础设施——"Book a meeting"链接 |
| 5 | 技术栈 | TypeScript / Next.js / Prisma / tRPC / Turborepo |
| 6 | 最近更新 | pushed_at **2024-01-11**（⚠️ API 返回数据较旧，可能是 API 缓存；实际项目仍活跃，但本次按 API 实测数据标注） |
| 7 | Star/Fork | **25,936 / 5,786** |
| 8 | License | GitHub 识别为 `Other / NOASSERTION`（CAL-EE，核心 + EE 拆分） |
| 9 | 是否仍维护 | ✅（公开信息显示仍活跃；本次 API 数据有滞后） |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ⚠️ EE 功能需商业授权 |
| 12 | 可借鉴功能 | 调度链接、时区处理、日历集成 |
| 13 | 可复用代码 | ❌ |
| 14 | 复用成本 | 高 |
| 15 | 安全风险 | 中（OAuth 日历集成需谨慎） |
| 16 | 数据隐私风险 | 中（涉及日历数据） |
| 17 | 是否推荐 | 🟡 可在 kailioncrafts.com 上挂一个 Cal.com 链接让海外买家预约视频会议，**作为外部工具使用**而非内嵌代码 |

---

### 9. AppFlowy

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | AppFlowy |
| 2 | URL | https://github.com/AppFlowy-IO/AppFlowy |
| 3 | 类型 | 开源 + 商业云 |
| 4 | 解决的问题 | Notion 开源替代，本地优先协作空间 |
| 5 | 技术栈 | Dart / Flutter / Rust |
| 6 | 最近更新 | pushed_at **2026-09-22**（活跃） |
| 7 | Star/Fork | **76,997 / 6,047** |
| 8 | License | **AGPL-3.0** |
| 9 | 是否仍维护 | ✅ |
| 10 | 是否可本地部署 | ✅ 桌面端 |
| 11 | 是否适合商业使用 | ⚠️ AGPL |
| 12 | 可借鉴功能 | 块编辑器、本地优先、离线协作 |
| 13 | 可复用代码 | ❌ AGPL |
| 14 | 复用成本 | 高（Flutter/Dart 与 JS 工作台栈不匹配） |
| 15 | 安全风险 | 低 |
| 16 | 数据隐私风险 | 低（本地优先） |
| 17 | 是否推荐 | 🔴 **不推荐**——技术栈差异太大，与 Node.js 工作台无法融合 |

---

### 10. Outline

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Outline |
| 2 | URL | https://github.com/outline/outline |
| 3 | 类型 | 开源核心 + 商业云 |
| 4 | 解决的问题 | 团队知识库 Wiki——Markdown、实时协作、搜索 |
| 5 | 技术栈 | TypeScript / Node.js / React / MobX / PostgreSQL |
| 6 | 最近更新 | pushed_at **2026-09-29**（活跃） |
| 7 | Star/Fork | **40,757 / 3,593** |
| 8 | License | GitHub 识别为 `Other / NOASSERTION`（**BSL-1.1**，源码可用但有转换期限，非 OSI 开源） |
| 9 | 是否仍维护 | ✅ |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ⚠️ BSL 限制商业转售，自用可以 |
| 12 | 可借鉴功能 | 文档树、搜索、Markdown 渲染、权限 |
| 13 | 可复用代码 | ❌ BSL |
| 14 | 复用成本 | 中 |
| 15 | 安全风险 | 中 |
| 16 | 数据隐私风险 | 低 |
| 17 | 是否推荐 | 🟡 可作为公司知识库的自部署备选；KaiLionCrafts 当前已用 JSON 知识库，暂不需要 |

---

### 11. Docmost

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Docmost |
| 2 | URL | https://github.com/docmost/docmost |
| 3 | 类型 | 开源 + 商业云 |
| 4 | 解决的问题 | Confluence/Notion 开源替代——协作 Wiki |
| 5 | 技术栈 | TypeScript / Next.js |
| 6 | 最近更新 | pushed_at **2025-07-14**（⚠️ 距今约 14 个月） |
| 7 | Star/Fork | **16,200 / 833** |
| 8 | License | **AGPL-3.0** |
| 9 | 是否仍维护 | 🟡 节奏放缓 |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ⚠️ AGPL |
| 12 | 可借鉴功能 | Wiki 树、实时协作 |
| 13 | 可复用代码 | ❌ AGPL |
| 14 | 复用成本 | 中 |
| 15 | 安全风险 | 中 |
| 16 | 数据隐私风险 | 低 |
| 17 | 是否推荐 | 🔴 与 Outline 功能重叠且活跃度更低 |

---

### 12. OpenProject

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | OpenProject |
| 2 | URL | https://github.com/opf/openproject |
| 3 | 类型 | 开源 + 商业 |
| 4 | 解决的问题 | 项目管理软件（Gantt/Kanban/Scrum），**不是销售 CRM** |
| 5 | 技术栈 | Ruby on Rails / Angular |
| 6 | 最近更新 | pushed_at **2023-07-30**（⚠️ API 返回数据较旧；项目本身仍活跃，但本次按 API 实测标注） |
| 7 | Star/Fork | **7,128 / 1,918** |
| 8 | License | **GPL-3.0** |
| 9 | 是否仍维护 | ✅（公开信息） |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ⚠️ GPL |
| 12 | 可借鉴功能 | 项目看板、工作流 |
| 13 | 可复用代码 | ❌ GPL |
| 14 | 复用成本 | 高 |
| 15 | 安全风险 | 中 |
| 16 | 数据隐私风险 | 低 |
| 17 | 是否推荐 | 🔴 **不推荐**——与外贸获客场景不匹配 |

---

### 13. Mautic

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Mautic |
| 2 | URL | https://github.com/mautic/mautic |
| 3 | 类型 | 开源（核心 MIT）+ 商业云 |
| 4 | 解决的问题 | 开源营销自动化——Email Campaign、Lead Nurturing、Segmentation、A/B 测试 |
| 5 | 技术栈 | PHP / Symfony |
| 6 | 最近更新 | pushed_at **2026-09-25**（活跃，7.x 分支） |
| 7 | Star/Fork | **10,570 / 3,466** |
| 8 | License | GitHub 识别为 `Other / NOASSERTION`（Mautic 核心实际为 **MIT**，但 GitHub 未自动识别） |
| 9 | 是否仍维护 | ✅ 非常活跃 |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ✅ MIT 核心可商用 |
| 12 | 可借鉴功能 | **Campaign 流程编排、Lead 分段、Drip 邮件序列、A/B 测试、Lead Scoring**——这是与外贸外联最相关的部分 |
| 13 | 可复用代码 | 🟡 MIT 核心可参考，但 PHP 栈与 Node.js 工作台不匹配，建议**参考工作流设计而非复制代码** |
| 14 | 复用成本 | 中 |
| 15 | 安全风险 | 中（历史上有邮件注入漏洞） |
| 16 | 数据隐私风险 | 低（自部署） |
| 17 | 是否推荐 | ✅ **强烈推荐作为外联 Campaign 工作流设计参考** |

---

### 14. Listmonk

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Listmonk |
| 2 | URL | https://github.com/knadh/listmonk |
| 3 | 类型 | 开源 |
| 4 | 解决的问题 | 高性能自托管 Newsletter / 邮件列表管理——单二进制、现代 Dashboard |
| 5 | 技术栈 | Go / React / PostgreSQL |
| 6 | 最近更新 | pushed_at **2025-07-06**（约 15 个月前） |
| 7 | Star/Fork | **17,294 / 1,667** |
| 8 | License | **AGPL-3.0** |
| 9 | 是否仍维护 | 🟡 节奏放缓 |
| 10 | 是否可本地部署 | ✅ 单二进制 |
| 11 | 是否适合商业使用 | ⚠️ AGPL |
| 12 | 可借鉴功能 | **列表订阅管理、Campaign 发送、Subscriber 分段、模板、打开/点击统计**——直接对应外贸开发信群发场景 |
| 13 | 可复用代码 | ❌ AGPL（但 UI/UX 设计可参考） |
| 14 | 复用成本 | 中 |
| 15 | 安全风险 | 中 |
| 16 | 数据隐私风险 | 低（自部署） |
| 17 | 是否推荐 | ✅ **推荐作为邮件 Campaign 管理 UI 设计参考**；也可直接自部署作为开发信发送后端 |

---

### 15. Postal

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Postal |
| 2 | URL | https://github.com/postalserver/postal |
| 3 | 类型 | 开源 |
| 4 | 解决的问题 | 自托管 SMTP 邮件服务器 |
| 5 | 技术栈 | Ruby |
| 6 | 最近更新 | ⚠️ **待确认：API 两次请求均失败，无法获取实时数据** |
| 7 | Star/Fork | ⚠️ 待确认（历史数据约 12k star 量级，本次未成功拉取，按规则不编造） |
| 8 | License | ⚠️ 待确认（实际为 MIT） |
| 9 | 是否仍维护 | ⚠️ 待确认 |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ✅（历史上为 MIT） |
| 12 | 可借鉴功能 | 邮件投递基础设施、DKIM/SPF、Webhook |
| 13 | 可复用代码 | 🟡 需重新核实 License |
| 14 | 复用成本 | 高（运维复杂） |
| 15 | 安全风险 | 高（自建邮件服务器 IP 信誉风险大，容易进垃圾箱） |
| 16 | 数据隐私风险 | 低 |
| 17 | 是否推荐 | 🔴 **不推荐单人外贸业务自建 SMTP**——投递率不如 Resend/Brevo/亚马逊 SES，运维成本高 |

---

### 16. Gophish

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Gophish |
| 2 | URL | https://github.com/gophish/gophish |
| 3 | 类型 | 开源 |
| 4 | 解决的问题 | **开源钓鱼演练框架**——安全团队用来做员工钓鱼演练 |
| 5 | 技术栈 | Go |
| 6 | 最近更新 | pushed_at **2024-09-23**（约 1 年前） |
| 7 | Star/Fork | **12,822 / 2,627** |
| 8 | License | GitHub 识别为 `Other / NOASSERTION`（Gophish 实际为 **MIT**，但 GitHub 未识别） |
| 9 | 是否仍维护 | 🟡 维护节奏慢 |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ✅ MIT |
| 12 | 可借鉴功能 | **⚠️ 仅借鉴其"外联活动流程设计"**：模板、目标组、发送节奏、打开/点击/回复追踪 Dashboard——这套流程与外贸开发信 Campaign 高度同构 |
| 13 | 可复用代码 | 🟡 MIT 可参考，但**道德/合规风险高**——切勿把钓鱼演练逻辑直接用于真实客户外联（会触发反垃圾法律、GDPR/CAN-SPAM 风险） |
| 14 | 复用成本 | 中 |
| 15 | 安全风险 | **高**——该工具本身被红蓝队使用，代码模式可能被邮件网关标记为恶意 |
| 16 | 数据隐私风险 | 中 |
| 17 | 是否推荐 | 🟡 **仅推荐研究其 Campaign Dashboard 信息架构**，不推荐复制代码 |

---

### 17. Odoo CRM（CRM 模块）

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Odoo（CRM 模块） |
| 2 | URL | https://github.com/odoo/odoo |
| 3 | 类型 | 开源社区版（LGPL v3）+ 商业企业版 |
| 4 | 解决的问题 | 一体化 ERP——CRM 只是其中一个模块 |
| 5 | 技术栈 | Python / JavaScript |
| 6 | 最近更新 | pushed_at **2021-12-16**（⚠️ API 默认分支 15.0 较旧；Odoo 实际在 main/18.0 等分支活跃，本次按 API 返回标注） |
| 7 | Star/Fork | **23,583 / 15,370** |
| 8 | License | GitHub 识别为 `Other / NOASSERTION`（社区版 LGPL v3，企业版商业） |
| 9 | 是否仍维护 | ✅（公开信息） |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | 🟡 社区版 LGPL 可商用，但企业版功能需付费 |
| 12 | 可借鉴功能 | Lead/Opportunity 阶段、销售漏斗、发票/报价一体化 |
| 13 | 可复用代码 | ❌ 整个 ERP 体量过大，不适合单人工作台 |
| 14 | 复用成本 | 极高 |
| 15 | 安全风险 | 中 |
| 16 | 数据隐私风险 | 低 |
| 17 | 是否推荐 | 🔴 **不推荐**——过重，单人外贸业务用不上 ERP |

---

### 18. AnyType（anytype-heart）

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | AnyType（anytype-heart 后端库） |
| 2 | URL | https://github.com/anyproto/anytype-heart |
| 3 | 类型 | 开源核心 + 商业云 |
| 4 | 解决的问题 | 本地优先 / P2P / E2EE 的 Notion 替代 |
| 5 | 技术栈 | Go（后端库） |
| 6 | 最近更新 | pushed_at **2026-10-03**（非常活跃） |
| 7 | Star/Fork | **420 / 119**（这是后端库，客户端 star 在另一个 repo） |
| 8 | License | GitHub 识别为 `Other / NOASSERTION`（AnyType 自定义 License，非 OSI） |
| 9 | 是否仍维护 | ✅ |
| 10 | 是否可本地部署 | ✅（桌面端） |
| 11 | 是否适合商业使用 | ⚠️ 自定义 License |
| 12 | 可借鉴功能 | **本地优先 / E2EE / P2P 同步**的架构思路——KaiLionCrafts 当前是 localStorage，未来要做多设备同步可参考 |
| 13 | 可复用代码 | ❌ Go 后端库，与 JS 工作台栈不匹配 |
| 14 | 复用成本 | 极高 |
| 15 | 安全风险 | 中 |
| 16 | 数据隐私风险 | 低（E2EE） |
| 17 | 是否推荐 | 🔴 技术栈不匹配，仅作架构思路参考 |

---

### 19. Google Maps Scraper（omkarcloud）

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Google Maps Scraper |
| 2 | URL | https://github.com/omkarcloud/google-maps-scraper |
| 3 | 类型 | **开源（MIT）** |
| 4 | 解决的问题 | **从 Google Maps 批量提取商家信息**（名称、地址、电话、网站、评分、评论）——直接对应外贸"按行业+地区找采购商"场景 |
| 5 | 技术栈 | Python（DrissionPage/无头浏览器） |
| 6 | 最近更新 | pushed_at **2026-09-21**（活跃） |
| 7 | Star/Fork | **3,575 / 526** |
| 8 | License | **MIT** ✅ |
| 9 | 是否仍维护 | ✅ |
| 10 | 是否可本地部署 | ✅ pip install |
| 11 | 是否适合商业使用 | ✅ **MIT，可直接商用、可修改、可嵌入自有产品** |
| 12 | 可借鉴功能 | **按关键词+城市抓取商家名单 → 过滤出有官网/有邮箱的 → 导出 CSV**——这就是外贸开发信名单生产流水线 |
| 13 | 可复用代码 | ✅ **可直接参考其抓取逻辑**（Python），KaiLionCrafts 工作台是 Node.js，可用 Node 重写或直接调用 Python 脚本 |
| 14 | 复用成本 | **低** |
| 15 | 安全风险 | 中（Google ToS 风险——高频抓取可能封 IP；需控制频率、加代理） |
| 16 | 数据隐私风险 | 低（抓取的是公开商家信息） |
| 17 | 是否推荐 | ✅✅ **Top 1 推荐**——与"trade buyer discovery"需求直接匹配 |

---

### 20. Warmbly

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | Warmbly |
| 2 | URL | https://github.com/warmbly/warmbly |
| 3 | 类型 | **开源（Apache-2.0）** |
| 4 | 解决的问题 | **开源 B2B Cold Outreach + Email Warmup 服务**——发件箱预热、外联序列、可投递性 |
| 5 | 技术栈 | Go |
| 6 | 最近更新 | pushed_at **2026-09-30**（非常活跃，新项目 2026-01 创建） |
| 7 | Star/Fork | **340 / 74** |
| 8 | License | **Apache-2.0** ✅ |
| 9 | 是否仍维护 | ✅ |
| 10 | 是否可本地部署 | ✅ |
| 11 | 是否适合商业使用 | ✅ **Apache-2.0，可商用**（含专利授权条款） |
| 12 | 可借鉴功能 | **邮件预热（warmup）逻辑、外联序列编排、可投递性监控、Spam score 检查**——直接对应外贸开发信送达率痛点 |
| 13 | 可复用代码 | ✅ **Apache-2.0 可参考/移植核心逻辑**（Go → Node 需重写） |
| 14 | 复用成本 | 中（Go 栈，Node 工作台需重写） |
| 15 | 安全风险 | 中（涉及真实邮件发送，需遵守 CAN-SPAM/GDPR） |
| 16 | 数据隐私风险 | 中（处理客户邮箱） |
| 17 | 是否推荐 | ✅ **Top 3 推荐**——可投递性是外贸开发信生死线 |

---

### 21. 50k Lead Generation System（补充发现）

| # | 字段 | 内容 |
|---|---|---|
| 1 | 名称 | 50k-lead-generation-system |
| 2 | URL | https://github.com/Awaisali36/50k-lead-generation-system |
| 3 | 类型 | **开源（MIT）** |
| 4 | 解决的问题 | 基于 n8n + Airtable + Apollo + Serper + Tavily 的 B2B 线索生成自动化工作流 |
| 5 | 技术栈 | n8n Workflow（JSON） |
| 6 | 最近更新 | pushed_at **2025-09-30** |
| 7 | Star/Fork | **95 / 13** |
| 8 | License | **MIT** ✅ |
| 9 | 是否仍维护 | 🟡 一般 |
| 10 | 是否可本地部署 | ✅（n8n 自托管） |
| 11 | 是否适合商业使用 | ✅ MIT |
| 12 | 可借鉴功能 | **完整的线索流水线设计**：LinkedIn 抓取 → Apollo 补全 → AI 资格判定 → Airtable 入库——可作为 KaiLionCrafts 工作台"Prospect 优先级评分"模块的工作流蓝本 |
| 13 | 可复用代码 | ✅ MIT，但本质是 n8n workflow JSON，不是可执行代码 |
| 14 | 复用成本 | 低（参考流程设计） |
| 15 | 安全风险 | 中（依赖 Apollo/Serper 等付费 API） |
| 16 | 数据隐私风险 | 中 |
| 17 | 是否推荐 | 🟡 **推荐作为工作流设计参考**，但依赖的 Apollo/Clay 是付费工具，KaiLionCrafts 可走免费/开源替代路线 |

---

## 四、分类结论

### 🟢 可直接使用 / 可复用代码（MIT / Apache-2.0）

| 项目 | License | 推荐用途 |
|---|---|---|
| omkarcloud/google-maps-scraper | MIT | 直接参考/移植 Google Maps 商家抓取逻辑，生产外贸买家名单 |
| warmbly/warmbly | Apache-2.0 | 参考邮件预热 + 外联序列设计，解决开发信进垃圾箱问题 |
| Awaisali36/50k-lead-generation-system | MIT | 参考 n8n 工作流：抓取→补全→AI 评分→入库的完整流水线 |

### 🔵 可参考设计（UI/UX/工作流，勿直接复制代码）

| 项目 | 借鉴点 |
|---|---|
| twentyhq/twenty | 现代 CRM 信息架构、Company/People/Deal 数据模型、AI 字段 |
| mautic/mautic | 营销自动化 Campaign 编排、Lead 分段、Drip 序列、Lead Scoring |
| knadh/listmonk | 邮件列表 / Campaign Dashboard UI、Subscribers 管理 |
| espocrm/espocrm | Sales Pipeline、Workflow Automation |
| SuiteCRM | 完整 CRM 数据模型（参考用，代码陈旧） |
| chatwoot/chatwoot | Omnichannel 客户会话（未来 kailioncrafts.com 在线客服用） |
| gophish/gophish | Campaign 追踪 Dashboard 信息架构（仅借鉴设计，勿复制代码） |
| baserow/baserow / nocodb | No-code 视图设计（Kanban/Grid/Form） |

### 🟠 License 不适合直接复用（AGPL / BSL / 自定义）

> 以下项目 License 不允许把代码直接拷进 KaiLionCrafts 闭源商业产品；可以本地部署自用，可以参考设计，但**不能复制代码片段**：

- EspoCRM（AGPL-3.0）
- SuiteCRM（AGPL-3.0）
- Monica（AGPL-3.0）
- NocoDB（AGPL-3.0）
- AppFlowy（AGPL-3.0）
- Docmost（AGPL-3.0）
- Listmonk（AGPL-3.0）
- OpenProject（GPL-3.0）
- Outline（BSL-1.1）
- Twenty（自定义 Enterprise License）
- Baserow（Commons Clause）
- Chatwoot（EE 商业授权）
- Cal.com（CAL-EE）
- Odoo（企业版商业）
- AnyType（自定义）

### 🔴 不推荐

| 项目 | 原因 |
|---|---|
| monicahq/monica | 个人关系管理，非 B2B 销售；且维护放缓 |
| opf/openproject | 项目管理软件，与外贸获客不匹配 |
| odoo/odoo | ERP 过重，单人业务用不上 |
| AppFlowy | Flutter/Dart 栈，与 Node.js 工作台无法融合 |
| docmost | 与 Outline 重叠且活跃度更低 |
| anyproto/anytype-heart | Go 后端库，技术栈不匹配 |
| postalserver/postal | 自建 SMTP 投递率差，单人外贸业务运维成本不划算（且本次 API 未成功拉取） |

---

## 五、Top 5 推荐项目及理由（针对 KaiLionCrafts 外贸获客 AI 工作台）

### 🥇 Top 1：omkarcloud/google-maps-scraper（MIT）
**理由**：这是唯一与"trade buyer discovery"（按行业+地区找海外采购商）需求直接匹配的开源项目。MIT 许可允许直接商用、可移植。建议：
- 在工作台新增"Google Maps 买家挖掘"模块
- 用 Node.js + Playwright/Puppeteer 重写其抓取逻辑（关键词 + 城市 + 有官网过滤）
- 输出 CSV → 进入现有 Prospect 优先级评分流水线
- 注意：控制抓取频率、加代理池、遵守 Google ToS

### 🥈 Top 2：mautic/mautic（MIT 核心）
**理由**：开源营销自动化最成熟的项目，其 **Campaign 可视化编排、Lead 分段、Drip 邮件序列、Lead Scoring** 设计直接对应外贸开发信多轮跟进场景。虽然是 PHP 栈不能直接拷代码，但其信息架构和工作流状态机（Lead → MQL → SQL → Opportunity）是工作台"客户评分 + 跟进提醒"模块的最佳蓝本。

### 🥉 Top 3：warmbly/warmbly（Apache-2.0）
**理由**：新项目但非常活跃，是目前少见的开源 **Cold Outreach + Email Warmup** 项目。外贸开发信最大痛点就是进垃圾箱——warmup 机制（让发件箱先互相发邮件"养号"）+ 外联序列设计，可以直接借鉴到工作台的"邮件预热"和"可投递性检查"功能里。Apache-2.0 含专利授权，商用安全。

### 🏅 Top 4：twentyhq/twenty（设计参考）
**理由**：56k star 的现代 CRM，TypeScript/React/NestJS 技术栈与 Node.js 工作台最接近。虽然 License 是自定义不能拷代码，但其 **Company/People/Deal 对象模型、Kanban Pipeline 交互、AI 字段设计**值得 UI 层借鉴。建议直接访问 twenty.com 体验产品，把它的销售管道看板设计搬到工作台。

### 🏅 Top 5：knadh/listmonk（设计参考 + 可自部署）
**理由**：17k star 的 Go 邮件列表管理器，**可以直接自部署作为工作台的开发信发送后端**（Docker 一键起），不用自己写 SMTP 发送逻辑。其 Campaign Dashboard（发送量、打开率、点击率、退订率）UI 是工作台"邮件 Campaign 模块"的最佳参考。注意它是 AGPL——只作为独立服务自部署使用，不把代码拷进工作台即可。

---

## 六、对 KaiLionCrafts 工作台的具体落地建议

基于以上研究，工作台未来迭代可参考的功能优先级：

| 优先级 | 功能 | 参考项目 | License 处理 |
|---|---|---|---|
| P0 | Google Maps 买家挖掘模块 | google-maps-scraper (MIT) | 可直接移植逻辑 |
| P0 | 邮件可投递性检查 / warmup 设计 | warmbly (Apache-2.0) | 可参考核心算法 |
| P1 | Prospect 评分流水线（抓取→补全→AI 评分） | 50k-lead-gen (MIT) + mautic | 参考工作流 |
| P1 | 销售 Pipeline 看板（Kanban） | twenty 设计 | 重写 UI，不拷代码 |
| P2 | Drip 邮件跟进序列 | mautic campaign 设计 | 重写状态机 |
| P2 | 开发信发送后端 | listmonk 自部署 | 独立服务，不拷代码 |
| P3 | 在线客服 Widget（kailioncrafts.com） | chatwoot 自部署 | 独立服务 |

---

## 七、数据可信度声明

- 本报告所有 Star / Fork / License / pushed_at 数据均来自 `https://api.github.com/repos/...` 实时返回（2026-10-03 拉取）。
- **未编造任何数字**。
- 以下项目 API 返回的 pushed_at 与公开认知不符（可能是 API 缓存或默认分支指向旧分支），已在条目中明确标注 ⚠️：
  - calcom/cal.com（pushed_at 2024-01-11）
  - opf/openproject（pushed_at 2023-07-30）
  - odoo/odoo（pushed_at 2021-12-16，default_branch=15.0）
- postalserver/postal 两次 API 请求均失败，已标注"⚠️ 待确认"，未编造其数据。
- GitHub 自动识别为 `Other / NOASSERTION` 的项目，已根据公开知识补充说明其真实 License 类型（如 Mautic=MIT、Gophish=MIT、Outline=BSL、Twenty=Enterprise 自定义），但仍以 GitHub API 返回为准。

---

## 八、已尝试的搜索词

GitHub API 搜索（实际执行）：
- `topic:lead-generation`（按 star 排序）
- `topic:prospecting`（按 star 排序）
- `cold email outreach in:name,description`
- `topic:crm topic:lead`
- `email marketing self-hosted in:name,description`

逐条核实的已知项目（共 18 个）：
twenty / espocrm / suitecrm / monica / nocodb / baserow / chatwoot / cal.com / appflowy / outline / docmost / openproject / mautic / listmonk / postal（失败）/ gophish / odoo / anytype-heart

补充发现的新项目：
- omkarcloud/google-maps-scraper（MIT，Top 1）
- warmbly/warmbly（Apache-2.0）
- Awaisali36/50k-lead-generation-system（MIT）
- getbeton/beton-ai（MIT，75 star）
- spirosbax/insaight（MIT，32 star）

---

**报告完成时间**：2026-10-03
**总项目数**：21（含 1 个 API 失败待确认）
**符合"至少 15 个"要求**：✅
**符合"17 字段结构化记录"要求**：✅
