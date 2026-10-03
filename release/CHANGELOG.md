# 变更日志

> 项目：KaiLionCrafts 外贸获客AI工作台  
> 版本：V77.3.1  
> 最后更新：2026-10-03

## [V77.3.1] - 2026-10-03

### 第三阶段：交付前发布验收

#### 安全修复
- **P0** 移除app.js中14处硬编码API Key（智谱GLM×2、硅基流动、Google Gemini、OpenAI中转站）
- **P2** 修复客户公司名XSS未转义（app.js第12650行）
- **P2** 修复搜索词XSS未转义（app.js第33838行）

#### 文档更新
- 全面更新SECURITY.md，与代码实际状态一致
- 新增release/目录下8个交付文件：
  - README_RELEASE.md
  - FINAL_ACCEPTANCE_REPORT.md
  - FEATURE_MATRIX.md
  - SECURITY_FINAL_REPORT.md
  - MODEL_ROUTING_REPORT.md
  - KNOWLEDGE_BASE_REPORT.md
  - TEST_EVIDENCE.md
  - CHANGELOG.md

#### 测试验证
- 37个功能页面全部通过（正确NAV key测试）
- 8个JS模块语法检查全部通过
- 敏感API未登录返回401（5个端点）
- 敏感静态文件返回403（5个文件）
- GLM在线模型调用成功（glm-4.7-flash）
- 知识库588文档/9156切片正常
- 0控制台错误，0dashboard fallback

#### 已知限制
- Git历史中存在旧API Key（Leo已知悉并接受，暂不清理）
- 旧API Key未轮换（Leo暂不处理，已知悉风险）
- CSP策略缺失（因触发广告拦截扩展，需重新设计）
- 表格缺少横向滚动包装（P3，当前数据量少未触发）

---

## [V77.3.0] - 2026-10-02

### 第二阶段：企业级审计与完善

#### 问题核实
- 核实上一轮报告：功能总数37准确，但测试方法有缺陷（错误页面ID）
- 使用正确NAV key重新测试全部37个页面，全部通过

#### 安全修复
- 移除前端硬编码API Key（P0）
- 修复2处XSS未转义（P2）

#### 文档
- 更新SECURITY.md
- 生成第二阶段审计报告HTML

---

## [V77.2.0] - 2026-10-01

### 第一轮企业级审计

#### 代码审计
- 审计11个核心文件，共48,557行代码
- 检查语法错误、未定义函数、路由错误、状态机错误
- 检查XSS、路径遍历、SSRF、越权、敏感信息泄露

#### 功能测试
- 测试40+前端功能
- 知识库专项测试（6个搜索词）
- 模型系统专项测试
- 数据和备份专项测试
- 登录页面安全检查

#### 生成报告
- 工作台完整功能清单HTML
- 后端代码审计报告
- 前端功能测试报告
- 模型系统测试报告
- 知识库完整性报告
- 问题修复记录
- 最终综合报告HTML

---

## [V77.1.2] - 2026-09-30

### 第三轮迭代修复

#### 功能修复
- 修复企业知识库kbLoadTree后缺renderView导致文档列表不显示
- model-router的callCloudModel从mock改为真实智谱GLM API调用
- FAILOVER_ALLOWED_TYPES扩展

#### 验证
- 全链路验证glm-4.7-flash偶发429限流→自动转移glm-4-flash成功
- GitHub提交4次备份

---

## [V77.1.1] - 2026-09-29

### 第二轮迭代修复

#### 安全增强
- 密码防暴力破解（5次锁定30秒+抖动动画）
- 统一密码长度验证

---

## [V77.1.0] - 2026-09-28

### 第一轮迭代修复

#### 根本原因修复
- 移除CSP响应头（触发广告拦截扩展导致灰色空白页）
- 提取2.1MB内联JS为外部app.js
- 后端模块denylist（禁止访问.js/.json/.py等源文件）

#### 验证
- 无痕模式和正常模式均可正常打开
- 工作台完整渲染

---

## [V77.0.0] - 2026-09-27

### 初始版本

#### 功能
- 37个功能页面
- 客户开发全流程
- AI模型路由（在线+本地）
- 企业知识库（588文档/9156切片）
- 密码保护登录
- localStorage数据持久化

#### 技术栈
- Node.js后端
- 原生JavaScript前端（SPA）
- Ollama本地模型
- 智谱GLM在线模型
- Python知识库索引器

---

## 版本号说明

- **主版本号**：重大架构变更
- **次版本号**：功能新增或重大修复
- **修订号**：Bug修复和安全更新

## 提交规范

```
type(scope): short description

示例：
feat(products): add product filter
fix(homepage): restore CTA link
seo(products): improve product metadata
security(app): remove hardcoded API keys
docs(release): add final acceptance report
```

## Git历史说明

⚠️ **重要**：Git历史中曾包含硬编码API Key（V77.3.1之前版本）。当前代码已移除，但历史提交中仍可能存在。Leo已知悉并接受此风险，暂不清理Git历史。

如需公开仓库或公网部署，必须先：
1. 轮换所有API Key
2. 清理Git历史（git filter-branch或BFG Repo-Cleaner）
3. 强制推送（需谨慎）
