# 开发流程与版本管理

> **仓库：** kailioncrafts-prospect（内部私有）  
> **主分支：** `main`  
> **开发分支：** `ark-html-workbench`  
> **最后更新：** 2026-09-30

## 1. 分支策略

| 分支 | 用途 | 保护 |
|------|------|------|
| `main` | 生产稳定版本，仅接受经过测试的 PR | ✅ 强制保护 |
| `ark-html-workbench` | 主开发分支，日常开发在此进行 | ⚠️ 建议保护 |
| `feature/*` | 新功能开发 | 临时 |
| `fix/*` | Bug 修复 | 临时 |
| `hotfix/*` | 生产紧急修复 | 临时 |

### 1.1 分支保护规则（main）

- 禁止直接 push 到 main
- 必须通过 Pull Request 合并
- 至少 1 人审核（个人项目可自审，但需记录）
- 必须通过语法检查：`node --check server.js`
- 必须通过：`git diff --check`

## 2. 提交规范

### 2.1 Commit Message 格式

```
<type>(<scope>): <简短描述>

[可选正文]
```

### 2.2 Type 类型

| Type | 用途 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(outreach): add customer knowledge base` |
| `fix` | Bug 修复 | `fix(outreach-kb): stabilize customer identities` |
| `chore` | 构建/工具/依赖 | `chore: update .gitignore` |
| `docs` | 文档 | `docs: add SECURITY.md` |
| `refactor` | 重构（不改变功能） | `refactor: extract identity resolution` |
| `test` | 测试 | `test: add mock tests for migration` |
| `perf` | 性能优化 | `perf: optimize kb search` |

### 2.3 Scope 常用值

- `outreach` — 开发信相关
- `outreach-kb` — 客户开发知识库
- `company-analysis` — 模块 C 公司深度分析
- `kb` — 知识库系统
- `security` — 安全加固
- `ui` — 界面优化
- `server` — 后端 server.js

### 2.4 提交前检查清单

```bash
# 1. 语法检查
node --check server.js

# 2. 内联 JS 语法检查
node -e "
const fs=require('fs');const html=fs.readFileSync('index.html','utf-8');
const re=/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;while((m=re.exec(html))!==null){try{new Function(m[1])}catch(e){console.log(e.message);process.exit(1)}}
console.log('OK');
"

# 3. 空白检查
git diff --check

# 4. 确认无敏感文件
git ls-files | grep -iE "api_config|kb_config|search_config|access_config|kb_index|公司知识库"

# 5. 确认未跟踪交接文档
git status --short
```

## 3. 版本号规则

当前使用 V 主版本.次版本.修订号格式：

| 版本 | 说明 | 示例 |
|------|------|------|
| V77.x | 知识库接入与事实源统一 | V77.4 统一事实访问层 |
| V78.x | 客户开发知识库工作台 | V78.0 知识库工作台 / V78.1 状态修复 / V78.2 ID稳定性 |
| V79.x | 模块 D 痛点识别（规划中） | — |

### 3.1 版本升级条件

- **主版本（V77→V78）**：核心模块新增或重大架构变更
- **次版本（V78.0→V78.1）**：功能修复、UI优化、小功能新增
- **修订号（V78.1.1）**：紧急Bug修复

## 4. 核心模块索引

| 模块 | 关键函数 | 文件位置 |
|------|----------|----------|
| 知识库检索 | `retrieveKbContext()` | server.js |
| 统一开发信入口 | `generateOutreachEmailDraft()` | index.html |
| 客户开发知识库 | `syncCustomerToOutreachKB()` | index.html |
| 客户身份解析 | `resolveCustomerByIdOrIdentity()` | index.html |
| 身份迁移 | `migrateCustomerIdentities()` | index.html |
| 模块 C 深度分析 | `deepAnalysis()` | index.html |
| 精准开发画像 | `retrieveKnowledgeForProfile()` | index.html |

## 5. 数据存储

| 数据 | 存储位置 | 备份策略 |
|------|----------|----------|
| 客户/草稿/沟通记录 | 浏览器 localStorage | 定期导出 JSON |
| 知识库源文件 | 本机 `公司知识库*/` | 不入库，单独备份 |
| 知识库索引 | `kb_index.json`（不入库） | 可通过 `kb_indexer.py` 重建 |
| API Key | `api_config.json`（不入库） | 密码管理器备份 |
| 登录密码 | `access_config.json`（不入库） | 密码管理器备份 |

## 6. 部署流程

> **注意：** 本仓库为内部私有，部署操作需谨慎。

### 6.1 本地开发

```bash
# 启动本地服务器
node server.js

# 访问
open http://localhost:8080
```

### 6.2 生产部署

1. 确保所有敏感文件不在 Git 中
2. 合并到 main 分支
3. 在生产服务器 pull 最新代码
4. 重启服务（launchd / pm2）
5. 验证 `/api/health` 返回正常
6. 验证登录功能正常

### 6.3 部署前安全检查

- [ ] 仓库为 Private
- [ ] 无敏感文件被跟踪
- [ ] 默认密码已修改
- [ ] API 端点已认证
- [ ] HTTPS 已配置
- [ ] Cloudflare Access 已配置（推荐）

## 7. 已知约束

- **不修改**：模块 C、模块 D、知识库源 Markdown、kb_indexer.py（除非明确授权）
- **不恢复**：PROSPECT_KB / getToolKBContext() 作为开发信事实来源
- **不调用**：真实 GLM、Ollama、Tavily（测试环境使用 mock）
- **不 push**：未确认的变更（需先报告并等待确认）
- **不部署**：未经过测试的代码
