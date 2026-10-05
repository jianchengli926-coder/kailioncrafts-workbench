# 模型系统深度验证报告

- 验证时间：2026-10-05（周日 13:20–13:30 CST）
- 验证环境：工作台 `http://localhost:8080`（Node PID 35090，HTTP 200 正常）；Ollama `http://localhost:11434`（运行中）
- 验证方式：配置/代码静态审查 + 真实上游直连 curl + node 直接调用生产 `model-router.js` 路由 + Ollama `/api/generate` 实测
- 约束遵守：未修改 `api_config.json` 或任何代码文件；每个模型实测 1 次；全部 curl 均带 `--max-time`

---

## 一、模型配置总览

### 1.1 在线模型（api_config.json）

| 配置项 | 值 | 状态 |
|---|---|---|
| GLM endpoint | `https://open.bigmodel.cn/api/paas/v4` | ✅ |
| GLM model | `glm-4-flash` | ✅ |
| GLM apiKey | 已配置（明文） | ✅ 可用 |
| GLM timeout / maxRetries | 30000ms / 1（注：maxRetries 代码未实际使用） | ⚠️ |
| openai_proxy endpoint | `https://wawapi.top/v1` | ✅ |
| openai_proxy model（配置主模型） | `gpt-5.6-terra` | ✅ 可用 |
| openai_proxy apiKey | 已配置（明文 sk-...） | ✅ 可用 |
| openai_proxy timeout / maxRetries | 120000ms / 2（maxRetries 未实际使用） | ⚠️ |
| providerOrder | `["openai_proxy","glm","ollama"]` | 见问题 P2 |

### 1.2 在线模型实测结果

| 模型名称 | API 端点 | 配置状态 | 实际可用 | 响应时间 | 返回 |
|---|---|---|---|---|---|
| gpt-5.6-terra（wawapi 中转站） | `https://wawapi.top/v1/chat/completions` | 已配置 key | ✅ 可用 | **3.68s**（HTTP 200） | `hello` |
| glm-4-flash（智谱官方） | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | 已配置 key | ✅ 可用 | **0.48s**（HTTP 200） | `hello` |

> 注：gpt-5.6-terra 直连时 `prompt_tokens=4393`（其中 cached 3840），说明中转站注入了较大的系统提示词缓存，单次对话成本与延迟均高于 glm-4-flash。

### 1.3 wawapi 中转站真实模型清单（`GET /v1/models`，与代码硬编码严重不符）

中转站账号实际仅开放 8 个模型：

```
gpt-5.5、codex-auto-review、gpt-5.6-sol、gpt-5.6-terra、
gpt-6-astra、gpt-6-sol、gpt-6-luna、gpt-6.1-sol
```

**中转站不支持 `gpt-4o`**（直连实测返回 404：`Model "gpt-4o" is not supported by any configured account in this group`），也不支持 `gpt-4o-mini / gpt-4-turbo / claude-3-5-sonnet / gemini-2.0-flash`。

### 1.4 本地 Ollama 模型（6 个已安装）

| 模型名称 | 类型 | 参数/量化 | 在线状态 | 生成测试 |
|---|---|---|---|---|
| qwen3.5:9b | 文本 + 推理(thinking) + 视觉理解 + tools | 9.7B / Q4_K_M，6.6GB | ✅ 运行中 | ✅ 7.18s（含 6.74s 首次加载）→ `hello` |
| deepseek-r1:7b | 推理（thinking 链）+ 文本 | 7.6B / Q4_K_M，4.7GB | ✅ 运行中 | ✅ 返回 `thinking` 推理链 + `response:"hello"` |
| qwen2.5vl:7b | **视觉理解**（看图，非生图） | 8.3B / Q4_K_M，6.0GB | ✅ 运行中（当前驻留 VRAM） | ✅ 6.14s → `Hello` |
| qwen2.5:7b | 轻量文本 + tools | 7.6B / Q4_K_M，4.7GB | ✅ 运行中 | ✅ 7.14s → `Hello` |
| x/flux2-klein:4b-fp4 | **图片生成**（capabilities: image） | 4B / fp4，5.7GB | ✅ 已安装 | 未跑生成（生图耗时长，仅按 capabilities 判定） |
| nomic-embed-text:latest | Embedding（知识库向量化，不参与互斥锁） | 137M / F16，274MB | ✅ 已安装 | 未单独调用（嵌入模型） |

> 视觉澄清：`qwen2.5vl:7b` 是**理解图片**（输入图→输出文字），**不是生成图片**；本地真正的**图片生成**模型是 `x/flux2-klein:4b-fp4`。

---

## 二、在线模型调用测试详情

### 2.1 gpt-5.6-terra（wawapi.top）

- **工作台 HTTP 路径**：不存在 `/api/ai/chat`。实际路由为 `POST /api/ai/generate`（body：`{taskType, prompt, manualModel, numCtx, images}`），需登录 cookie，未认证返回 `401 {"error":"未认证，请先登录","code":"AUTH_REQUIRED"}`。
- **直连上游实测**：HTTP 200，3.68s，正文 `hello`，usage 正常。
- **经生产路由 `model-router.js` 实测（手动模式）**：
  - `manualModel='gpt-5.6-terra'` → **失败**，209ms 返回 `400 模型不存在，请检查模型代码。(code 1211)`。
  - 原因：`gpt-5.6-terra` 不在 `model-router.js` 硬编码的 `OPENAI_PROXY_MODELS` 集合内，`getModelProvider()` 兜底返回 `'glm'`，被错误地发到智谱 `open.bigmodel.cn`，智谱不认此模型名。
- **结论**：上游 key/端点本身**可用**；但当前代码路由把它错配到 GLM，**经工作台手动调用不可用**（见问题 P1）。

### 2.2 glm-4-flash（智谱）

- 直连上游：HTTP 200，0.48s，`hello`。
- 经生产路由手动模式：HTTP 200，353ms，`hello`，`success:true`。
- **结论**：✅ 完全可用，延迟最低，免费额度，是当前最稳的在线模型。

### 2.3 自动链路实测（taskType=text，无手动指定）

生产链路 `text = [gpt-4o, gpt-4o-mini, glm-4-flash, qwen3.5:9b, qwen2.5:7b]`：

| 跳 | 模型 | 结果 |
|---|---|---|
| attempt 1 | gpt-4o（→wawapi） | ❌ 404 `model_not_available`（中转站无此模型） |
| attempt 2 | gpt-4o-mini（→wawapi） | ❌ `model_not_available` |
| attempt 3 | glm-4-flash（→智谱） | ✅ 成功，774ms |

- 整次自动调用 2102ms，`failover:true, attempt:3, failoverReason:"model_not_available"`。
- **结论：故障转移机制本身工作正常**，但因为链路前两跳指向中转站根本不存在的模型，自动模式**永远先白跑 2 次 404（约 1.3s 额外开销）再落到 glm-4-flash**，付费中转站 `gpt-5.6-terra` 在自动模式下从不被使用（见问题 P2）。

---

## 三、本地模型测试详情

| 模型 | 首包耗时 | 正文 | thinking | 结论 |
|---|---|---|---|---|
| qwen2.5:7b | 7.14s（load 6.75s） | `Hello` | 无 | ✅ 可用，轻量兜底 |
| qwen3.5:9b | 7.18s（load 6.74s） | `hello` | `think:false` 关闭 | ✅ 可用，本地主力文本/推理 |
| deepseek-r1:7b | （含推理链） | `hello` | 输出完整思考链 | ✅ 可用；路由已正确区分 `thinking` 与正式 `response`，不会把推理链当成开发信正文 |
| qwen2.5vl:7b | 6.14s（load 5.90s，当前驻留 VRAM） | `Hello` | — | ✅ 可用（视觉理解） |

- 本地模型首次调用需加载权重（6–7s），同会话再次调用会快很多（Ollama 默认 keep_alive 驻留）。
- 路由对 deepseek-r1 这类“只回 thinking 不回正文”的情况有专门保护（`empty_response_with_thinking` 错误），本次实测正文非空，未触发。

---

## 四、故障转移机制验证

### 4.1 转移顺序（代码 `MODEL_CHAINS`）

- text：`gpt-4o → gpt-4o-mini → glm-4-flash → qwen3.5:9b → qwen2.5:7b`
- reasoning：`gpt-4o → glm-4-flash → qwen3.5:9b → deepseek-r1:7b`
- vision：`gpt-4o → glm-4.6v-flash → qwen3.5:9b → qwen2.5vl:7b`
- image：`cogview-3-flash → x/flux2-klein:4b-fp4`
- embedding：`nomic-embed-text:latest`（固定，不参与锁）

### 4.2 触发条件（`shouldFailover`）

- **允许转移**：408 / 429 / 5xx、timeout、abort、connection_refused、网络错误、慢响应、rate_limited、not_configured、empty_response、parse_error、`model_not_available`(404)。
- **禁止转移**：400 / 401 / 403 / 422、`invalid_api_key`、`content_moderation`、参数错误。
- **手动模式（manualModel）**：设计上**不自动切换**，失败即返回（`reason:"manual_mode_no_failover"`）。

### 4.3 代码逻辑分析

- ✅ 链式 `for` 循环逐跳尝试，成功即返回；慢模型（单次>30s 或连续两次>15s，5 分钟过期）在自动模式下自动跳过。
- ✅ `callOpenAICompatible` 全程 `resolve` 不 `reject`，不会产生未处理 Promise rejection；`callLocalModel` 的 `parse_error` reject 被 `generate()` 的 try/catch 兜住。
- ✅ 本地模型锁在 `finally` 块释放，成功/失败/异常三条路径都会释放。
- ⚠️ `api_config.json` 里的 `maxRetries`（glm:1、proxy:2）**是死配置**：路由并不重试同一模型，而是直接跳到链路下一个模型。
- ⚠️ 云端调用硬编码 `temperature:0.7`，与本地 `DEFAULT_CONFIG.temperature=0.5` 不一致（不影响可用性）。

### 4.4 结论

**故障转移机制代码完整、实测有效**（自动 text 调用真实发生了 404→404→glm 成功的转移）。缺陷不在“转移逻辑”，而在“链路里写死的模型名与中转站真实清单不匹配”，导致前两跳必然 404。

---

## 五、手动切换功能验证

- 入口：设置页「🌐 GPT 中转站 · 手动模型切换」下拉（`renderAiModelRouterCard`，app.js:40523）。
- `setManualModel(m)`：写入 `S.settings.aiManualModel` 并 `DB.save`，toast 提示「已切换手动模型 / 已恢复自动路由」，**立即生效、无页面刷新、无数据丢失**。
- 下拉可选项：`自动路由(默认)、gpt-4o、gpt-4o-mini、gpt-4-turbo、claude-3-5-sonnet、gemini-2.0-flash、glm-4-flash、qwen3.5:9b`。
- **问题**：其中 `gpt-4o / gpt-4o-mini / gpt-4-turbo / claude-3-5-sonnet / gemini-2.0-flash` 在真实中转站**均不存在**；手动选中任一后，因手动模式**关闭故障转移**，会直接向用户返回 404 错误。真正选了能成功的只有 `glm-4-flash` 与 `qwen3.5:9b`（以及“自动路由”）。
- 开发信草稿另有 `_draftModelMode`（auto / qwen3.5:9b / qwen2.5:7b）三档，本地模型走异步任务，逻辑正常。

---

## 六、local-model-lock.js 并发锁检查

- ✅ 进程级互斥锁：大模型（qwen*/deepseek*/flux）共用一把锁，同时只跑一个本地大模型；embedding（nomic-embed-text）豁免。
- ✅ 等待队列 + 等待超时（60s）；释放时唤醒队首并过户锁。
- ✅ 显式禁用同 owner 重入（防止双重释放）；释放时校验 `lockOwner`，非 owner 拒绝；双重释放被拦截。
- ✅ 正常路径在 `generate()` 的 `finally` 中释放，无死锁。
- ⚠️ **小隐患**：`DEFAULT_LOCK_TIMEOUT=120000` 定义了“锁持有超时”，但 `acquireLock` **并未实现看门狗**——若持锁方异常卡住且未走 `finally`，锁会一直占用，后续调用者只能等 60s 等待超时后放弃（不会永久死锁，但会空等 1 分钟）。建议后续加一个锁持有超时强制释放定时器（非本次修复范围）。

---

## 七、模型系统问题清单

### 严重问题（影响演示/真实使用）

- **P1｜付费主模型 gpt-5.6-terra 被错路由**：`gpt-5.6-terra` 不在 `OPENAI_PROXY_MODELS` 集合，`getModelProvider()` 兜底到 `glm`，经工作台手动调用会发到智谱并返回 `400 模型不存在(code 1211)`。（实测复现）
- **P2｜自动链路前两跳必然 404**：text/reasoning/vision 链路都以 `gpt-4o` 开头，但 wawapi 中转站并不提供 `gpt-4o`（及 gpt-4o-mini/gpt-4-turbo/claude-3.5/gemini）。结果：①自动模式从不使用付费强模型；②每次自动生成白跑约 1.3s 的两次 404 才落到 glm-4-flash。（实测复现 attempt=3）
- **P3｜手动切换下拉里 5 个模型名是“空气模型”**：用户在设置里选 `gpt-4o` 等会硬失败且无故障转移（手动模式禁用 failover），演示时若误点会直接报错。

### 中等问题

- **P4**：`api_config.json` 两个 API Key 均为明文存储（已入 .gitignore，属本地工作台设计，但仍属敏感信息，勿外发/勿提交公开仓库）。
- **P5**：`maxRetries` 配置项未被路由使用（死配置），易误导维护者。
- **P6**：锁模块未实现“锁持有超时看门狗”，异常卡住时后续调用会空等 60s。
- **P7**：云端 `temperature=0.7` 与本地 `0.5` 不一致；`glm-4.6v-flash`（vision 链路第 2 跳）未在本次单独实测，可能同样存在模型名与智谱实际清单不符的风险。

> 说明：以上 P1–P3 均为**配置/模型清单与代码硬编码不一致**所致，修复方向是把 `OPENAI_PROXY_MODELS` 与 `MODEL_CHAINS` 里的模型名改成中转站真实清单（gpt-5.6-terra 等），或直接从 `api_config.json` 的 `openai_proxy.models` 动态读取。**本次按要求未改动任何文件。**

---

## 八、演示可用性评估

### 演示时推荐使用的模型

1. **在线首选：`glm-4-flash`** —— 0.5s 返回、免费、稳定、经路由实测成功。演示开发信/分析时自动链路最终也会落到它，体验最顺。
2. **本地首选：`qwen3.5:9b`** —— 本地主力文本/推理，首次约 7s 加载，之后很快；可演示“离线也能跑”。
3. **推理演示：`deepseek-r1:7b`** —— 展示 thinking 推理链（注意它会先输出较长思考过程）。
4. **付费强模型 gpt-5.6-terra**：上游本身可用（3.7s），但**当前经工作台手动/自动都调不到**，演示时不要承诺“已接入并使用 GPT-5.6”，除非先按 P1/P2 修复路由。

### 在线模型不可用时的备用方案

- 自动链路已内置兜底：`中转站(404) → glm-4-flash → 本地 qwen3.5:9b → qwen2.5:7b`。即使外网全断，仍会落到本地 qwen3.5:9b（需本机 Ollama 运行）。
- 断网演示预案：在设置里把手动模型固定为 `qwen3.5:9b`（或开发信模式选 qwen35），走异步任务，完全不依赖外网。

### 需要 Leo 手动确认的事项

1. **是否授权修复 P1–P3**：将 `OPENAI_PROXY_MODELS` / `MODEL_CHAINS` / 手动下拉更新为中转站真实模型清单（gpt-5.6-terra、gpt-6-* 等），让付费模型真正可用——本次未改，待你确认后再动。
2. **演示口径**：对外宣传时，在线模型统一口径为“智谱 GLM-4-Flash（主）+ 本地 Qwen3.5-9B（兜底）”，不要把“GPT-5.6 已接入”作为既定事实展示。
3. **密钥安全**：`api_config.json` 含明文 Key，请勿随仓库/截图外发。
4. **Ollama 需常驻**：本地兜底依赖 `localhost:11434`，演示前确认 Ollama 已启动。
