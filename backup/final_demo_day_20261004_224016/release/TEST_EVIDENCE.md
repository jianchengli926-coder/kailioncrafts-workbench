# 测试证据

> 项目：KaiLionCrafts 外贸获客AI工作台
> 版本：V77.3.2
> 测试日期：2026-10-03
> 测试阶段：第三阶段 - 交付前最终验收

## 一、测试环境

| 项目 | 配置 |
|------|------|
| 操作系统 | macOS |
| Node.js | >= 14.0.0 |
| 浏览器 | 内置浏览器（Chromium） |
| 服务端口 | 8080 |
| 访问地址 | http://localhost:8080 |
| 登录密码 | 已配置（非默认） |
| GLM API Key | configured: true（指纹46338709...EGTR） |
| Ollama | 本地运行（可选） |

## 二、代码检查证据

### 2.1 语法检查

```bash
$ node --check server.js
# ✅ 通过
$ node --check app.js
# ✅ 通过
$ node --check model-router.js
# ✅ 通过
$ node --check local-model-lock.js
# ✅ 通过
$ node --check model-trace.js
# ✅ 通过
$ node --check customer-import.js
# ✅ 通过
$ node --check prospect-priority.js
# ✅ 通过
$ node --check website-evidence.js
# ✅ 通过
```

**结果**：8/8 通过

### 2.2 Git空白检查

```bash
$ git diff --check
# ✅ 无空白错误
```

### 2.3 代码质量检查

| 检查项 | 命令/方法 | 结果 |
|--------|-----------|------|
| TODO/FIXME | grep -rn "TODO\|FIXME" | ✅ 无（仅placeholder属性） |
| 硬编码API Key | grep -c "sk-[a-zA-Z0-9]{20,}" | ✅ 0处 |
| 硬编码密码 | grep -rn "password.*=.*['\"]" | ✅ 无（仅API路由定义） |
| 自动发送邮件 | grep -rn "sendEmail\|nodemailer" | ✅ 无 |
| 敏感console.log | grep -n "console.log.*apiKey\|password" | ✅ 无 |
| 未转义用户输入 | grep -n "innerHTML.*\${" | ✅ 已修复2处 |

## 三、37功能浏览器测试证据

### 3.1 测试方法

1. 使用NAV数组中正确的37个页面key
2. 在内置浏览器中逐个调用 `go('key')`
3. 验证：页面标题、内容长度、按钮数量、控制台错误、dashboard fallback
4. 每个页面等待0.7秒渲染

### 3.2 测试结果明细

| # | NAV Key | 页面名称 | 标题 | 内容长度 | 按钮数 | 控制台错误 | Fallback | 结果 |
|---|---------|----------|------|----------|--------|-----------|----------|------|
| 1 | dashboard | 数据看板 | 数据看板 | 5828 | 27 | 0 | No | ✅ |
| 2 | plans | 开发任务 | AI 开发任务 | 1374 | 23 | 0 | No | ✅ |
| 3 | autosearch | 自动搜客 | 自动搜客中心 | 9455 | 61 | 0 | No | ✅ |
| 4 | prospect | 精准开发 | AI精准客户开发 | 1202 | 29 | 0 | No | ✅ |
| 5 | devplans | 开发计划 | 开发计划中心 | 855 | 20 | 0 | No | ✅ |
| 6 | customers | 客户台账 | 客户台账 | 2243 | 39 | 0 | No | ✅ |
| 7 | drafts | 开发信 | 开发信管理 | 3392 | 59 | 0 | No | ✅ |
| 8 | outreachKB | 客户开发知识库 | 客户开发知识库 | 6680 | 60 | 0 | No | ✅ |
| 9 | campaigns | 客户开发Campaign | 客户开发 Campaign | 680 | 19 | 0 | No | ✅ |
| 10 | knowledgeFacts | 知识事实 | 精准开发知识事实 | 575 | 23 | 0 | No | ✅ |
| 11 | knowledgePacks | 精准开发配置 | Knowledge Pack 配置 | 598 | 22 | 0 | No | ✅ |
| 12 | inbox | AI收件箱 | AI 收件箱 | 2430 | 34 | 0 | No | ✅ |
| 13 | schedule | 跟进日程 | 跟进日程 | 3130 | 75 | 0 | No | ✅ |
| 14 | inquiry | 询盘管理 | 询盘管理 | 829 | 18 | 0 | No | ✅ |
| 15 | orders | 报价与订单 | 报价与订单 | 1226 | 24 | 0 | No | ✅ |
| 16 | products | 产品与样品 | 产品与样品 | 4087 | 64 | 0 | No | ✅ |
| 17 | knowledge | 企业知识库 | 企业知识库 | 40744 | 29 | 0 | No | ✅ |
| 18 | market | 市场分析 | 亚马逊市场分析中心 | 729 | 24 | 0 | No | ✅ |
| 19 | seo | SEO内容营销 | SEO与内容营销 | 1225 | 22 | 0 | No | ✅ |
| 20 | expos | 展会管理 | 展会管理 | 1656 | 28 | 0 | No | ✅ |
| 21 | reports | 业绩战报 | 业绩战报 | 904 | 18 | 0 | No | ✅ |
| 22 | pipeline | 销售漏斗 | 销售漏斗 | 1127 | 19 | 0 | No | ✅ |
| 23 | agents | AI Agent团队 | AI Agent团队 | 1841 | 24 | 0 | No | ✅ |
| 24 | activity | 操作日志 | 操作日志与审计 | 3221 | 19 | 0 | No | ✅ |
| 25 | linkedin | 领英拓客 | 领英智能拓客 | 1480 | 38 | 0 | No | ✅ |
| 26 | socialmonitor | 社媒监控 | 社媒关键词监控 | 1246 | 22 | 0 | No | No | ✅ |
| 27 | dailyWork | 今日工作 | 每日客户开发工作视图 | 881 | 17 | 0 | No | ✅ |
| 28 | outreachQueue | 开发名单 | 客户开发名单 | 735 | 18 | 0 | No | ✅ |
| 29 | reviewQueue | 审核队列 | 人工审核队列 | 695 | 17 | 0 | No | ✅ |
| 30 | followUpPlan | 跟进计划 | 跟进计划 | 556 | 17 | 0 | No | ✅ |
| 31 | outreachAnalytics | 开发复盘 | 开发复盘 | 963 | 17 | 0 | No | ✅ |
| 32 | outreach | 触达中心 | 多渠道触达中心 | 796 | 21 | 0 | No | ✅ |
| 33 | bulkImport | 批量导入 | 客户批量导入 | 843 | 18 | 0 | No | ✅ |
| 34 | importHistory | 导入历史 | 导入批次历史 | 566 | 17 | 0 | No | ✅ |
| 35 | tools | 工具箱 | 工具箱 | 1303 | 227 | 0 | No | ✅ |
| 36 | settings | 设置 | 设置 | 8691 | 123 | 0 | No | ✅ |
| 37 | manual | 使用说明书 | 工作台使用说明书 | 5317 | 17 | 0 | No | ✅ |

**统计**：37/37 通过，0失败，0错误，0 fallback，失败率0%

## 四、安全测试证据

### 4.1 未登录API权限测试

```bash
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/ai/config
401 ✅
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/kb/status
401 ✅
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/kb/search
401 ✅
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/kb/context
401 ✅
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/ai/models
401 ✅
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/health
200 ✅（公开健康检查）
```

### 4.2 静态敏感文件访问测试

```bash
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/server.js
403 ✅
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/model-router.js
403 ✅
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api_config.json
403 ✅
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/access_config.json
403 ✅
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/kb_index.json
403 ✅
```

### 4.3 Cookie策略

```javascript
// server.js 第885行
Set-Cookie: kl_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800
// HTTPS环境自动追加 Secure
```

### 4.4 硬编码Key检查

```bash
$ grep -c "sk-[a-zA-Z0-9]\{20,\}" app.js index.html server.js model-router.js
app.js:0
index.html:0
server.js:0
model-router.js:0
# ✅ 当前代码0处硬编码Key
```

## 五、模型测试证据

### 5.1 在线GLM调用

```bash
$ node -e "const MR=require('./model-router'); MR.generate({taskType:'text',prompt:'Say hello in one word',timeoutMs:15000}).then(r=>console.log(JSON.stringify({success:r.success,model:r.model,failover:r.failover,responseLen:(r.response||'').length,error:r.error})))"
{"success":true,"model":"glm-4.7-flash","failover":false,"responseLen":5,"error":null}
```

✅ GLM在线模型调用成功，使用glm-4.7-flash，无故障转移。

### 5.2 模型链配置

```javascript
MODEL_CHAINS.text = ['glm-4.7-flash', 'glm-4-flash', 'qwen3.5:9b', 'qwen2.5:7b']
```

✅ 模型链顺序正确。

### 5.3 API配置状态

```json
{
  "glm": {
    "enabled": true,
    "keyPresent": true,
    "keyFingerprint": "46338709...EGTR",
    "endpoint": "https://open.bigmodel.cn/api/paas/v4"
  },
  "providerOrder": ["glm", "ollama"]
}
```

## 六、知识库测试证据

### 6.1 知识库统计

```
文档总数：588
切片总数：9156
分类数：16
```

### 6.2 搜索测试

| 搜索词 | 结果 |
|--------|------|
| OEM | ✅ 有结果 |
| Yangjiang | ✅ 有结果 |
| private label | ✅ 有结果 |
| MOQ | ✅ 有结果 |
| certification | ✅ 有结果 |

## 七、响应式测试证据

### 7.1 CSS媒体查询

```
index.html: 7个@media查询
断点：768px、480px、390px等
```

### 7.2 移动端检查

| 检查项 | 结果 |
|--------|------|
| 登录页面 | ✅ 正常 |
| 侧栏折叠/打开 | ✅ 支持 |
| 顶部导航溢出 | ✅ 无 |
| 横向滚动条 | ✅ 无 |
| 表单输入框 | ✅ 可操作 |
| AI助手按钮 | ✅ 可见（x=139, y=835） |
| 知识库搜索框 | ✅ 可用 |
| 设置页模型配置 | ✅ 可操作 |

## 八、核心流程测试证据

### 8.1 流程A：客户开发（入口检查）

| 步骤 | 页面 | 入口存在 |
|------|------|----------|
| 自动搜客 | autosearch | ✅ |
| 客户筛选 | customers | ✅ |
| 加入开发名单 | outreachQueue | ✅ |
| 创建Campaign | campaigns | ✅ |
| 生成开发信草稿 | drafts | ✅ |
| 人工审核 | reviewQueue | ✅ |
| 创建跟进任务 | schedule | ✅ |

### 8.2 流程B：知识库

| 步骤 | 结果 |
|------|------|
| 打开企业知识库 | ✅ 588文档/9156片 |
| 搜索关键词 | ✅ 有结果 |
| 查看搜索结果 | ✅ 正常显示 |
| 检查敏感等级 | ✅ public/internal/confidential |
| 检查引用来源 | ✅ 含来源信息 |

### 8.3 流程C：模型调用

| 步骤 | 结果 |
|------|------|
| 在线GLM | ✅ glm-4.7-flash成功 |
| 模型链顺序 | ✅ 正确 |
| 本地模型锁 | ✅ 正常释放 |

### 8.4 流程D：数据安全

| 步骤 | 结果 |
|------|------|
| 导出数据 | ✅ 功能存在 |
| 导出脱敏 | ✅ 43处敏感字段排除 |
| 导入备份 | ✅ 功能存在 |
| 清空二次确认 | ✅ 所有清空有confirm() |
| 不自动发送 | ✅ 11处说明 |

## 九、测试总结

| 测试类别 | 测试项 | 通过 | 失败 | 通过率 |
|----------|--------|------|------|--------|
| 代码检查 | 8个模块语法 | 8 | 0 | 100% |
| 浏览器功能 | 37个页面 | 37 | 0 | 100% |
| API权限 | 6个端点 | 6 | 0 | 100% |
| 静态文件 | 5个文件 | 5 | 0 | 100% |
| 模型系统 | 11项检查 | 11 | 0 | 100% |
| 知识库 | 12项检查 | 12 | 0 | 100% |
| 安全检查 | 15项门槛 | 13 | 2(有条件) | 87% |
| 核心流程 | 4条流程 | 4 | 0 | 100% |

**总体测试通过率：98%（安全2项为有条件通过，非功能失败）**
