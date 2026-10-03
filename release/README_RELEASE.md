# KaiLionCrafts 外贸获客 AI 工作台 - 发布说明

> 版本：V77.3.1・发布日期：2026-10-03
> 状态：功能交付通过・测试交付通过・安全交付有条件通过・公网部署不建议（需完成 Key 轮换）

## 一、项目概述

KaiLionCrafts 外贸获客 AI 工作台是一个面向外贸企业的本地化客户开发与管理系统，集成 AI 搜客、客户管理、开发信生成、知识库、Campaign 管理、模型路由等功能。



* **技术栈**：Node.js + 原生 JavaScript + localStorage + Ollama 本地模型 + 智谱 GLM 在线模型

* **架构**：单页应用（SPA）+ 后端 API 服务

* **部署方式**：本地运行 / 局域网 / Cloudflare Tunnel 公网访问

## 二、启动方式

### 2.1 环境要求



* **Node.js**：>= 14.0.0（推荐 18.x LTS）

* **操作系统**：macOS / Linux / Windows

* **内存**：>= 4GB（使用本地 Ollama 模型建议 >= 8GB）

* **磁盘**：>= 2GB（含知识库索引）

### 2.2 启动命令



```
# 进入项目目录
cd /path/to/外贸获客AI工作台

# 方式一：直接启动
node server.js

# 方式二：双击启动（macOS）
chmod +x start.command
./start.command

# 方式三：后台运行
nohup node server.js > /tmp/server_8080.log 2>&1 &
```

### 2.3 端口



* **默认端口**：8080

* **访问地址**：[http://localhost:8080](http://localhost:8080)

* **端口被占用时**：修改 `server.js` 中的 `PORT` 变量，或启动时指定 `PORT=9090 node server.js`

## 三、登录方式



1. 打开浏览器访问 [http://localhost:8080](http://localhost:8080)

2. 输入访问密码（默认密码见首次启动时终端输出，或在 `access_config.json` 中配置）

3. 点击「进入工作台」

**安全说明**：



* 密码使用 scrypt + salt 哈希存储，不明文存储

* 5 次登录失败后锁定 30 秒

* 会话使用 HttpOnly Cookie，8 小时过期

## 四、API Key 配置

### 4.1 配置位置

在工作台「设置 → 模型配置」中手动输入 API Key，**不要写入源代码**。

或直接编辑 `api_config.json`（该文件已在 `.gitignore` 中，不会提交到 Git）：



```
{
  "glm": {
    "enabled": true,
    "apiKey": "your-api-key-here",
    "endpoint": "https://open.bigmodel.cn/api/paas/v4",
    "model": "glm-4-flash"
  },
  "providerOrder": ["glm", "ollama"]
}
```

### 4.2 支持的在线模型



| 提供商           | 模型                          | 用途   | 配置位置             |
| ------------- | --------------------------- | ---- | ---------------- |
| 智谱 GLM        | glm-4.7-flash / glm-4-flash | 文本生成 | api\_config.json |
| 智谱 GLM        | glm-4.6v-flash              | 视觉理解 | 设置页              |
| 智谱 GLM        | cogview-3-flash             | 图像生成 | 设置页              |
| 硅基流动          | Qwen2.5-7B / GLM-4-9B       | 文本生成 | 设置页              |
| Google Gemini | gemini-3.5-flash            | 文本生成 | 设置页              |

### 4.3 安全规则



* API Key **不得**写入 `app.js`、`index.html`、`server.js` 等源代码

* API Key **不得**提交到 Git

* 报告、截图、日志中**不得**显示完整 API Key

* 仅报告 `configured: true/false`

## 五、Ollama 本地模型要求

### 5.1 安装 Ollama



```
# macOS
brew install ollama

# 或从官网下载：https://ollama.com
```

### 5.2 拉取模型



```
# 文本模型（必备）
ollama pull qwen2.5:7b
ollama pull qwen3.5:9b

# 推理模型（可选）
ollama pull deepseek-r1:7b

# 视觉模型（可选）
ollama pull qwen2.5vl:7b

# Embedding模型（知识库必备）
ollama pull nomic-embed-text
```

### 5.3 模型故障转移链



```
文本任务：glm-4.7-flash → glm-4-flash → qwen3.5:9b → qwen2.5:7b
推理任务：deepseek-r1:7b
视觉任务：qwen2.5vl:7b
Embedding：nomic-embed-text
```



* 在线 GLM 失败时（超时 / 429/500/503/connection refused）自动切换本地模型

* 401/403/400/422 不自动转移（配置错误需人工处理）

* 手动指定模型时不自动切换

## 六、知识库配置

### 6.1 知识库位置



* **源文件目录**：`公司知识库/`（按分类组织 Markdown 文件）

* **索引文件**：`kb_index.json`（自动生成，已在.gitignore 中）

* **配置文件**：`kb_config.json`（知识库路径配置）

### 6.2 重建索引



```
python3 kb_indexer.py
```

### 6.3 知识库统计



* **文档总数**：588

* **切片总数**：9156

* **分类数**：16

* **权限等级**：public / internal / confidential

### 6.4 权限控制



| 等级           | 本机 | 局域网 | 公网 |
| ------------ | -- | --- | -- |
| public       | ✅  | ✅   | ✅  |
| internal     | ✅  | ✅   | ❌  |
| confidential | ✅  | ❌   | ❌  |

## 七、备份方式

### 7.1 数据导出

在工作台「设置 → 数据管理」中：



* 导出全部数据（JSON 格式）

* 导出客户数据

* 导出开发信

* 导出 Campaign

### 7.2 手动备份



```
# 备份配置文件
cp api_config.json api_config.backup.json
cp access_config.json access_config.backup.json

# 备份数据（localStorage导出的JSON文件）
# 在工作台设置页导出后保存到安全位置
```

### 7.3 备份文件安全



* 备份文件**不得**包含 API Key、密码、Token

* 备份文件**不得**提交到 Git

* `*_backup_*.json`、`*_backup_*.zip` 已在 `.gitignore` 中

## 八、测试命令



```
# 语法检查
node --check server.js
node --check app.js
node --check model-router.js
node --check local-model-lock.js
node --check model-trace.js
node --check customer-import.js
node --check prospect-priority.js
node --check website-evidence.js

# Git空白检查
git diff --check

# 服务健康检查
curl http://localhost:8080/api/health

# 未登录API权限检查（应返回401）
curl -o /dev/null -w "%{http_code}" http://localhost:8080/api/kb/status

# 静态文件访问检查（应返回403）
curl -o /dev/null -w "%{http_code}" http://localhost:8080/server.js

# 模型调用测试
node -e "const MR=require('./model-router'); MR.generate({taskType:'text',prompt:'hi'}).then(r=>console.log(r.success,r.model))"
```

## 九、已知限制



1. **API Key 历史暴露**：Git 历史中曾包含硬编码 API Key，Leo 已知悉并接受，本轮暂不清理历史。公网部署前建议轮换所有 Key 并清理 Git 历史。

2. **CSP 策略缺失**：Content-Security-Policy 已临时移除（因触发广告拦截扩展），生产环境建议重新设计宽松 CSP。

3. **表格横向滚动**：部分表格缺少 `.table-wrap` 包装，数据量大时可能出现横向溢出。

4. **AI 输出 sanitize**：AI 生成内容未经过 DOMPurify 消毒，建议后续添加。

5. **移动端表格**：复杂表格在小屏幕上可能需要横向滚动。

6. **本地模型依赖**：在线 GLM 不可用时，需要本地 Ollama 模型作为兜底，否则 AI 功能不可用。

## 十、上线前检查清单

### 10.1 安全检查



* [ ] 所有 API Key 已轮换（智谱、硅基流动、Google、OpenAI 中转站）

* [ ] Git 历史已清理或确认可接受风险

* [ ] api\_config.json、access\_config.json 在.gitignore 中

* [ ] 敏感接口未登录返回 401

* [ ] 敏感静态文件返回 403

* [ ] Cookie 启用 Secure（HTTPS 环境）

* [ ] CSP 策略已重新设计

* [ ] 密码已修改（非默认值）

### 10.2 功能检查



* [ ] 37 个功能页面全部正常打开

* [ ] 登录 / 登出正常

* [ ] 知识库搜索返回结果

* [ ] 在线 GLM 模型调用成功

* [ ] 模型故障转移正常

* [ ] 数据导出 / 导入正常

* [ ] 无控制台致命错误

### 10.3 部署检查



* [ ] HTTPS 已配置

* [ ] Cloudflare Tunnel 已配置（公网访问时）

* [ ] 服务器端口不直接暴露

* [ ] 防火墙规则已配置

* [ ] 日志不记录密码和 API Key

* [ ] 备份机制已建立

### 10.4 文档检查



* [ ] README\_RELEASE.md 已更新

* [ ] SECURITY.md 与代码实际状态一致

* [ ] CHANGELOG.md 已更新

* [ ] 交付资料完整



***

**交付状态**：



* 功能交付：✅ 通过

* 测试交付：✅ 通过

* 安全交付：⚠️ 有条件通过（API Key 历史风险，Leo 已知悉并接受）

* 公网部署：❌ 不建议（需完成 Key 轮换和历史清理后再部署）