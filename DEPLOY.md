# 锴利外贸获客工作台 - 本地服务器部署指南

## 📋 目录
1. [快速开始](#快速开始)
2. [环境要求](#环境要求)
3. [本地模型配置](#本地模型配置)
4. [在线模型配置](#在线模型配置)
5. [故障转移机制](#故障转移机制)
6. [服务器功能说明](#服务器功能说明)
7. [公网部署（Cloudflare Tunnel）](#公网部署cloudflare-tunnel)
8. [常见问题](#常见问题)

---

## 🚀 快速开始

### 方式一：一键启动（推荐）

双击 `start.command` 文件，或在终端执行：

```bash
cd /Volumes/Kingston\ 1TB\ NV1\ 40Gbps/豆包独立站SEO项目/外贸获客AI工作台
./start.command
```

脚本会自动：
- ✅ 检查 Node.js 环境
- ✅ 检查并启动 Ollama 服务
- ✅ 列出本地已安装模型
- ✅ 启动本地服务器
- ✅ 自动打开浏览器

### 方式二：手动启动

```bash
cd /Volumes/Kingston\ 1TB\ NV1\ 40Gbps/豆包独立站SEO项目/外贸获客AI工作台
node server.js
```

指定端口：
```bash
PORT=8081 node server.js
```

### 访问工作台

启动后，在浏览器打开：
- **本地访问**：http://localhost:8080
- **局域网访问**：http://<你的Mac的IP>:8080
- **健康检查**：http://localhost:8080/api/health
- **访问密码**：`441723`

---

## 💻 环境要求

### 必需软件

| 软件 | 用途 | 安装方法 |
|------|------|----------|
| **Node.js** v18+ | 运行本地服务器 | https://nodejs.org/ 或 `brew install node` |
| **Ollama** | 运行本地大模型 | https://ollama.com/ 或 `brew install ollama` |

### 验证安装

```bash
node --version    # 应显示 v18.x 或更高
ollama --version  # 应显示版本号
```

---

## 🤖 本地模型配置

### 已配置的本地模型

工作台已预置3个本地模型，全部通过 Ollama 运行：

| 模型 | 用途 | 大小 | 安装命令 |
|------|------|------|----------|
| **qwen2.5:7b** | 文本生成（主力） | 4.4GB | `ollama pull qwen2.5:7b` |
| **deepseek-r1:7b** | 推理/思考任务 | 4.4GB | `ollama pull deepseek-r1:7b` |
| **qwen2.5vl:7b** | 视觉理解（识图） | 5.6GB | `ollama pull qwen2.5vl:7b` |

### 安装本地模型

```bash
# 启动Ollama服务（如果未运行）
ollama serve &

# 下载模型
ollama pull qwen2.5:7b
ollama pull deepseek-r1:7b
ollama pull qwen2.5vl:7b

# 验证模型
ollama list
```

### 测试本地模型

```bash
# 测试文本模型
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:7b",
  "prompt": "你好，请回复测试成功",
  "stream": false
}'

# 查看已安装模型
curl http://localhost:11434/api/tags
```

---

## 🌐 在线模型配置

工作台已预置以下免费在线模型，无需额外配置即可使用：

### 智谱 GLM（4个免费模型）

| 模型 | 用途 | 说明 |
|------|------|------|
| **glm-4-flash** | 文本生成（默认） | 免费，响应快 |
| **glm-4.7-flash** | 深度思考 | 免费，复杂推理 |
| **glm-4.6v-flash** | 视觉理解 | 免费，图片分析 |
| **cogview-3-flash** | 图像生成 | 免费，AI画图 |

- API地址：`https://open.bigmodel.cn/api/paas/v4`
- 工作台已内置API Key，开箱即用

### 硅基流动（4个免费模型）

| 模型 | 用途 | 说明 |
|------|------|------|
| **Qwen2.5-7B** | 通用文本 | 免费，速度最快（~450ms） |
| **GLM-4-9B** | 通用文本 | 免费，能力较强 |
| **InternLM2.5-7B** | 推理任务 | 免费，推理优先 |
| **Qwen2-7B** | 轻量文本 | 免费，响应快 |

- API地址：`https://api.siliconflow.cn/v1`
- 工作台已内置API Key，开箱即用

### Google Gemini（3个模型）

| 模型 | 用途 | 说明 |
|------|------|------|
| **gemini-3.5-flash-lite** | 轻量文本 | 免费层级，推荐主力 |
| **gemini-3.5-flash** | 标准文本 | 免费层级 |
| **gemini-3.5-pro** | 高阶文本 | 免费层级 |

- API地址：`https://generativelanguage.googleapis.com/v1beta`
- 工作台已内置API Key，开箱即用

### 管理在线模型

打开工作台 → ⚙️ 设置 → 供应商管理，可以：
- ✅ 启用/禁用单个模型
- ✅ 设置默认模型
- ✅ 测试单个模型连接
- ✅ 一键测速所有模型
- ✅ 查看模型调用统计

---

## 🔄 故障转移机制

### 工作原理

工作台采用**多级故障转移**策略，确保AI功能始终可用：

```
用户发起AI请求
    ↓
第1级：默认模型（当前设为默认的在线模型）
    ↓ 失败？
第2级：其他在线模型（按任务类型智能排序）
    ├─ 推理任务 → 优先推理模型（InternLM/DeepSeek）
    └─ 生成任务 → 优先生成模型（Qwen/GLM/Gemini）
    ↓ 全部失败？
第3级：本地Ollama模型（最后兜底）
    ├─ qwen2.5:7b（文本）
    ├─ deepseek-r1:7b（推理）
    └─ qwen2.5vl:7b（视觉）
    ↓ 全部失败？
返回错误提示
```

### 故障转移触发条件

- ❌ HTTP错误（4xx/5xx状态码）
- ❌ 网络连接失败
- ❌ 请求超时（45秒）
- ❌ API返回错误格式
- ❌ 月度预算用完（自动跳过在线模型，只用本地）

### 查看故障转移状态

每次AI调用后，工作台会显示：
- 使用的模型名称
- 响应延迟（毫秒）
- 故障转移次数（如果>0表示切换过模型）

### 健康检查API

访问 `http://localhost:8080/api/health` 可查看：
- Ollama服务状态和已安装模型
- 各在线API可用性
- 故障转移策略状态

---

## 🖥️ 服务器功能说明

### 核心功能

| 功能 | 说明 |
|------|------|
| **静态文件服务** | 提供 index.html、logo.png 等文件访问 |
| **SPA路由支持** | 任意路径都返回 index.html（单页应用） |
| **CORS代理** | 解决浏览器跨域限制，代理API请求 |
| **Ollama代理** | `/api/ollama/*` 代理到本地Ollama服务 |
| **健康检查API** | `/api/health` 返回服务器和模型状态 |
| **智能缓存** | HTML不缓存，静态资源缓存1小时 |
| **安全防护** | 防止路径遍历攻击 |

### 局域网访问

服务器绑定 `0.0.0.0`，允许局域网内其他设备访问：

1. 查看Mac的IP地址：
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```

2. 其他设备浏览器打开：`http://<Mac的IP>:8080`

3. 确保Mac防火墙允许8080端口入站连接

### 开机自启（可选）

创建 LaunchAgent 实现开机自动启动：

```bash
# 创建plist文件
cat > ~/Library/LaunchAgents/com.kailion.workbench.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.kailion.workbench</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/外贸获客AI工作台/server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/workbench.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/workbench-error.log</string>
</dict>
</plist>
EOF

# 加载服务
launchctl load ~/Library/LaunchAgents/com.kailion.workbench.plist

# 查看状态
launchctl list | grep kailion
```


---

## 🌐 公网部署（Cloudflare Tunnel）

通过 Cloudflare Tunnel 将本地工作台暴露到公网，无需公网IP、无需端口映射、免费HTTPS。

### 前提条件
- 域名已托管在 Cloudflare（如 kailioncrafts.com）
- 已安装 cloudflared：`brew install cloudflared`
- 本地服务器已启动（端口8080）

### 已配置的子域名

| 子域名 | 本地端口 | 用途 |
|--------|----------|------|
| crm.kailioncrafts.com | 5188 | CRM系统 |
| workbench.kailioncrafts.com | 8501 | 通用工作台 |
| creator.kailioncrafts.com | 8766 | 创作工具 |
| **prospect.kailioncrafts.com** | **8080** | **外贸获客工作台** |

### 配置文件位置
`~/.cloudflared/config.yml`

```yaml
tunnel: 0df6566a-2cb5-4dbd-aaeb-30b7c973cc2b
credentials-file: /Users/a123/.cloudflared/0df6566a-2cb5-4dbd-aaeb-30b7c973cc2b.json
ingress:
  - hostname: crm.kailioncrafts.com
    service: http://127.0.0.1:5188
  - hostname: workbench.kailioncrafts.com
    service: http://127.0.0.1:8501
  - hostname: creator.kailioncrafts.com
    service: http://127.0.0.1:8766
  - hostname: prospect.kailioncrafts.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

### 常用命令

```bash
# 登录Cloudflare（首次）
cloudflared tunnel login

# 创建Tunnel
cloudflared tunnel create kailion-workbench

# 添加DNS记录
cloudflared tunnel route dns kailion-workbench prospect.kailioncrafts.com

# 验证配置
cloudflared tunnel ingress validate

# 启动Tunnel（前台）
cloudflared tunnel run kailion-workbench

# 启动Tunnel（后台）
nohup cloudflared tunnel run kailion-workbench > /tmp/cloudflared.log 2>&1 &

# 查看Tunnel状态
cloudflared tunnel list

# 查看日志
tail -f /tmp/cloudflared.log
```

### 访问方式
- 公网地址：**https://prospect.kailioncrafts.com**
- 访问密码：**441723**
- 任何人在任何地方只要有网络就能访问

### 注意事项
1. **保持本地服务器运行**：Mac不能关机、不能休眠
2. **保持cloudflared运行**：Tunnel进程不能关闭
3. **数据存储在本地**：所有数据存在Mac的浏览器localStorage中
4. **多用户共享**：所有人访问的是同一份数据，修改实时同步
5. **安全建议**：工作台已有密码保护，敏感操作建议二次确认

---

## ❓ 常见问题

### Q1: 启动时提示"端口已被占用"

**A**: 修改端口启动：
```bash
PORT=8081 node server.js
```
或查找并关闭占用端口的进程：
```bash
lsof -i :8080
kill -9 <PID>
```

### Q2: 本地模型无法调用

**A**: 按顺序检查：
1. Ollama是否安装：`which ollama`
2. Ollama服务是否运行：`curl http://localhost:11434/api/tags`
3. 模型是否已下载：`ollama list`
4. 启动服务：`ollama serve &`

### Q3: 在线模型全部失败，只有本地模型能用

**A**: 可能原因：
- 网络无法访问国外API（Gemini需要科学上网）
- API Key额度用完
- API服务暂时不可用

工作台会自动故障转移到本地模型，不影响使用。可在设置页面查看各模型状态。

### Q4: 局域网其他设备无法访问

**A**: 检查：
1. Mac和其他设备在同一局域网
2. Mac防火墙允许8080端口：系统设置 → 网络 → 防火墙
3. 使用正确的IP地址访问

### Q5: 如何更新工作台

**A**: 工作台是单文件HTML，更新方法：
1. 停止服务器（Ctrl+C）
2. 替换 `index.html` 文件
3. 重新启动服务器

### Q6: 数据存储在哪里

**A**: 工作台所有数据存储在浏览器的 localStorage 中：
- 客户数据、开发信、报价、订单等
- API配置、模型设置
- 生成历史记录

**注意**：清除浏览器数据会丢失所有工作台数据！建议定期使用工作台的「数据导出与备份」功能导出JSON备份。

---

## 📞 技术支持

如遇问题，请检查：
1. 服务器控制台日志（启动服务器的终端窗口）
2. 浏览器开发者工具 → Console 标签
3. 健康检查页面：http://localhost:8080/api/health

---

**锴利外贸获客工作台 v1.0 | 本地服务器部署版**
