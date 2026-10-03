# 模型路由报告

> 项目：KaiLionCrafts 外贸获客AI工作台  
> 版本：V77.3.1  
> 审计日期：2026-10-03

## 一、模型系统概述

工作台采用**在线优先 + 本地兜底**的双层模型架构，支持自动故障转移和手动模型切换。

### 1.1 架构图

```
用户请求
    ↓
模型路由器 (model-router.js)
    ↓
┌─────────────────────────────────────────┐
│  在线模型层（优先）                        │
│  ├─ glm-4.7-flash（智谱，深度思考）        │
│  └─ glm-4-flash（智谱，文本生成）          │
├─────────────────────────────────────────┤
│  本地模型层（兜底）                        │
│  ├─ qwen3.5:9b（Ollama，通用文本）        │
│  ├─ qwen2.5:7b（Ollama，轻量文本）        │
│  ├─ deepseek-r1:7b（Ollama，推理）        │
│  ├─ qwen2.5vl:7b（Ollama，视觉）          │
│  └─ nomic-embed-text（Ollama，Embedding） │
└─────────────────────────────────────────┘
    ↓
Trace记录（model-trace.js，脱敏）
```

## 二、模型链配置

### 2.1 文本生成链

```
glm-4.7-flash → glm-4-flash → qwen3.5:9b → qwen2.5:7b
```

| 顺序 | 模型 | 提供商 | 类型 | 用途 |
|------|------|--------|------|------|
| 1 | glm-4.7-flash | 智谱GLM | 在线 | 深度思考，优先使用 |
| 2 | glm-4-flash | 智谱GLM | 在线 | 文本生成，备用在线 |
| 3 | qwen3.5:9b | Ollama | 本地 | 通用文本，第一兜底 |
| 4 | qwen2.5:7b | Ollama | 本地 | 轻量文本，最终兜底 |

### 2.2 专用模型

| 任务类型 | 模型 | 提供商 | 说明 |
|----------|------|--------|------|
| 推理任务 | deepseek-r1:7b | Ollama | 复杂推理、逻辑分析 |
| 视觉任务 | qwen2.5vl:7b | Ollama | 图片理解、OCR |
| Embedding | nomic-embed-text | Ollama | 知识库向量化 |
| 图像生成 | cogview-3-flash | 智谱GLM | AI生图（可选） |

## 三、故障转移逻辑

### 3.1 自动故障转移触发条件

| 错误类型 | 是否转移 | 说明 |
|----------|----------|------|
| 超时 (timeout) | ✅ 转移 | 网络超时自动切换 |
| 429 Too Many Requests | ✅ 转移 | 限流自动切换 |
| 500 Internal Server Error | ✅ 转移 | 服务器错误自动切换 |
| 503 Service Unavailable | ✅ 转移 | 服务不可用自动切换 |
| Connection Refused | ✅ 转移 | 连接拒绝自动切换 |
| 401 Unauthorized | ❌ 不转移 | API Key错误，需用户处理 |
| 403 Forbidden | ❌ 不转移 | 权限问题，需用户处理 |
| 400 Bad Request | ❌ 不转移 | 请求格式错误，需修复 |
| 422 Unprocessable Entity | ❌ 不转移 | 参数错误，需修复 |

### 3.2 手动指定模型

- 用户在设置页手动选择模型时，**不执行自动故障转移**
- 手动指定的模型失败时，返回错误信息，由用户决定是否切换

### 3.3 本地模型并发锁

- 本地Ollama模型使用`local-model-lock.js`实现并发锁
- 同一时间只允许一个本地模型请求执行
- 锁在以下情况释放：
  - ✅ 请求成功完成
  - ✅ 请求失败
  - ✅ 请求超时
  - ✅ 用户取消
- 锁释放后，下一个请求可以执行

## 四、实测结果

### 4.1 在线GLM成功测试

```
请求：taskType=text, prompt="Say hello in one word"
结果：success=true
模型：glm-4.7-flash
故障转移：false（直接成功）
响应长度：5
错误：null
延迟：正常
```

✅ 在线GLM模型调用成功，优先使用在线模型。

### 4.2 模型链验证

```javascript
// model-router.js 实际配置
MODEL_CHAINS.text = ['glm-4.7-flash', 'glm-4-flash', 'qwen3.5:9b', 'qwen2.5:7b']
```

✅ 模型链顺序正确，符合"在线优先，本地兜底"要求。

### 4.3 真实API实现验证

- `callCloudModel()`函数（model-router.js第357行）使用`https.request`调用
- 端点：`https://open.bigmodel.cn/api/paas/v4/chat/completions`
- 认证：`Authorization: Bearer <apiKey>`
- 非Mock实现，真实HTTP请求

✅ 确认真实API调用，非Mock。

### 4.4 API配置状态

```
glm.enabled: true
glm.keyPresent: true
glm.keyFingerprint: 46338709...EGTR
glm.endpoint: https://open.bigmodel.cn/api/paas/v4
providerOrder: ['glm', 'ollama']
```

✅ GLM API Key已配置（不显示完整Key）。

## 五、Trace与脱敏

### 5.1 Trace记录内容

- 模型名称
- 任务类型
- 成功/失败状态
- 延迟
- 错误类型（不记录完整错误信息）
- 是否故障转移
- 故障转移链

### 5.2 Trace脱敏规则

`model-trace.js`中敏感字段列表：
- `apiKey` / `api_key` / `apikey`
- `password` / `passwd`
- `token` / `access_token`
- `secret` / `secretKey`
- `cookie`
- `authorization`

✅ Trace不记录API Key、密码、完整Prompt、thinking内容和敏感客户信息。

## 六、thinking内容处理

- 推理模型（deepseek-r1）的thinking内容**不进入最终正文**
- thinking内容仅用于内部推理，不返回给用户
- Trace中不记录thinking内容

✅ thinking内容已正确隔离。

## 七、模型配置管理

### 7.1 配置位置

- **后端配置**：`api_config.json`（.gitignore保护）
- **前端配置**：工作台「设置 → 模型配置」页面
- **本地存储**：localStorage（用户手动输入的Key）

### 7.2 配置项

- 模型启用/禁用
- 模型设为默认
- API Key输入（不写入源代码）
- 温度(temperature)
- 模型端点(baseURL)

### 7.3 安全规则

- API Key不写入源代码 ✅
- API Key不提交Git ✅
- API Key不在报告/截图/日志中显示 ✅
- 仅报告configured: true/false ✅

## 八、已知限制

1. **本地模型依赖**：在线GLM不可用时，需要本地Ollama模型运行，否则AI功能不可用
2. **Ollama性能**：本地模型推理速度取决于硬件配置，M4 Mac mini可流畅运行7B模型
3. **GLM限流**：免费GLM模型可能触发429限流，已实现自动故障转移
4. **视觉模型**：qwen2.5vl:7b需要额外下载，约4.7GB
5. **Embedding模型**：nomic-embed-text需要额外下载，知识库搜索依赖此模型

## 九、模型系统验收结论

| 检查项 | 结果 |
|--------|------|
| 在线GLM成功时使用GLM | ✅ 通过 |
| GLM超时/429/500/503自动切换本地 | ✅ 通过（逻辑验证） |
| 401/403/400/422不盲目转移 | ✅ 通过 |
| 手动指定模型不自动切换 | ✅ 通过 |
| qwen3.5失败切换qwen2.5 | ✅ 通过（逻辑验证） |
| 推理任务用deepseek-r1 | ✅ 通过 |
| 视觉任务用qwen2.5vl | ✅ 通过 |
| thinking不进正文 | ✅ 通过 |
| 本地锁成功/失败/超时/取消都释放 | ✅ 通过 |
| Trace不记录Key/密码/完整Prompt/敏感信息 | ✅ 通过 |
| 模型配置可保存/启用/禁用/设默认 | ✅ 通过 |

**模型系统验收：✅ 通过**
