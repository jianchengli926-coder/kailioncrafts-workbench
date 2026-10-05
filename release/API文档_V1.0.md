# 外贸获客AI工作台 — REST API 文档 V1.0

> Base URL: `http://localhost:8080/api/v1`
> 认证方式: `x-api-key` Header
> 日期: 2026-10-05

---

## 一、认证

### 1.1 API Key
所有业务接口需要在请求头中携带API Key：
```
x-api-key: kl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

获取API Key：
1. 打开工作台 → 🔌 API与集成 → API Keys → 生成新Key
2. 或使用Admin Token调用：`POST /api/v1/admin/api-keys`

> ⚠️ API Key仅在生成时完整返回一次，请立即保存。列表中只显示脱敏后的Key。

### 1.2 Admin Token
管理接口（创建/撤销API Key、管理Webhook）需要Admin Token：
```
x-admin-token: <admin_token>
```

Admin Token在服务器首次启动时自动生成并打印到终端，也存储在`data/admin_token.json`。
可通过环境变量`ADMIN_TOKEN`覆盖。

已登录工作台的浏览器会话也可访问管理接口（无需手动传token）。

### 1.3 限流
- 每个API Key：60次/分钟（滑动窗口）
- 超出限制返回：`429 Too Many Requests`

---

## 二、健康检查

### GET /health
免认证，用于监控API服务状态。

**响应示例：**
```json
{
  "status": "ok",
  "service": "kailion-open-api",
  "version": "1.0",
  "time": "2026-10-05T04:54:36.722Z"
}
```

---

## 三、客户接口

### GET /customers
获取客户列表，支持筛选和分页。

**Query参数：**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| page | int | 1 | 页码 |
| limit | int | 20 | 每页数量（最大100） |
| category | string | — | 品类筛选：outdoor_knives / kitchen_knives / professional_scissors / kitchen_accessories |
| status | string | — | 状态筛选：待联系 / 跟进中 / 已回复 / 不再联系 |
| search | string | — | 搜索关键词（匹配公司名、联系人、邮箱） |

**响应示例：**
```json
{
  "data": [
    {
      "id": "cust_abc123",
      "company": "ABC Kitchenware Inc.",
      "contact": {"name": "John Smith", "title": "Procurement Manager", "email": "john@abc.com"},
      "country": "USA",
      "productCategory": "kitchen_knives",
      "status": "跟进中",
      "leadScore": 85,
      "createdAt": "2026-09-15T08:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "pages": 8
  }
}
```

**curl示例：**
```bash
curl -H "x-api-key: kl_xxx" "http://localhost:8080/api/v1/customers?category=kitchen_knives&status=跟进中&page=1&limit=10"
```

### GET /customers/:id
获取单个客户详情。

**路径参数：**
- `id`: 客户ID

**响应示例：**
```json
{
  "data": {
    "id": "cust_abc123",
    "company": "ABC Kitchenware Inc.",
    "contact": {...},
    "products": ["chef knife", "cutting board"],
    "tags": ["VIP", "repeat-buyer"],
    "notes": "Interested in Damascus steel knives",
    "nextFollowUp": "2026-10-10",
    "timeline": [...]
  }
}
```

### POST /customers
新增客户。

**请求体：**
```json
{
  "company": "New Customer Ltd.",
  "contact": {
    "name": "Jane Doe",
    "title": "Buyer",
    "email": "jane@newcustomer.com",
    "phone": "+1-555-0100"
  },
  "country": "UK",
  "city": "London",
  "productCategory": "outdoor_knives",
  "website": "https://newcustomer.com",
  "source": "Manual Import",
  "notes": "Found at trade show"
}
```

**响应示例：**
```json
{
  "data": {
    "id": "cust_new456",
    "company": "New Customer Ltd.",
    "createdAt": "2026-10-05T05:00:00.000Z"
  }
}
```

**curl示例：**
```bash
curl -X POST -H "x-api-key: kl_xxx" -H "Content-Type: application/json" \
  -d '{"company":"Test Co","contact":{"email":"test@test.com"}}' \
  http://localhost:8080/api/v1/customers
```

---

## 四、开发信接口

### GET /drafts
获取开发信草稿列表。

**Query参数：**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| page | int | 1 | 页码 |
| limit | int | 20 | 每页数量 |
| status | string | — | 状态：待检查 / 已通过 / 已发送 / 已拒绝 |
| category | string | — | 品类筛选 |

**响应示例：**
```json
{
  "data": [
    {
      "id": "draft_xyz789",
      "customerId": "cust_abc123",
      "customerName": "ABC Kitchenware",
      "subject": "Premium Kitchen Knives from Yangjiang",
      "status": "待检查",
      "category": "kitchen_knives",
      "createdAt": "2026-10-04T10:00:00.000Z"
    }
  ],
  "total": 42
}
```

---

## 五、发送任务接口

### GET /send-tasks
获取今日发送任务列表。

**响应示例：**
```json
{
  "date": "2026-10-05",
  "data": [
    {
      "id": "task_001",
      "customerId": "cust_abc123",
      "customerName": "ABC Kitchenware",
      "email": "john@abc.com",
      "draftId": "draft_xyz789",
      "subject": "Premium Kitchen Knives",
      "account": "sales@kailioncrafts.com",
      "status": "pending",
      "category": "kitchen_knives"
    }
  ],
  "summary": {
    "total": 15,
    "completed": 8,
    "pending": 7
  }
}
```

---

## 六、复盘统计接口

### GET /analytics
获取开发复盘统计数据。

**响应示例：**
```json
{
  "customersTotal": 156,
  "sentTotal": 320,
  "replyTotal": 28,
  "replyRatePct": 8.75,
  "openRatePct": 45.2,
  "clickRatePct": 12.5,
  "bounceRatePct": 2.1,
  "conversionRatePct": 3.1,
  "byCategory": {
    "outdoor_knives": {"sent": 80, "replies": 8, "replyRate": 10.0},
    "kitchen_knives": {"sent": 100, "replies": 10, "replyRate": 10.0},
    "professional_scissors": {"sent": 70, "replies": 5, "replyRate": 7.1},
    "kitchen_accessories": {"sent": 70, "replies": 5, "replyRate": 7.1}
  },
  "activeApiKeys": 2,
  "totalApiCalls": 156,
  "updatedAt": "2026-10-05T05:00:00.000Z"
}
```

---

## 七、管理接口（需Admin Token）

### POST /admin/api-keys
生成新的API Key。

**请求体：**
```json
{
  "name": "My Integration",
  "scopes": ["customers:read", "drafts:read"]
}
```

**响应示例：**
```json
{
  "data": {
    "id": "ak_abc123",
    "name": "My Integration",
    "apiKey": "kl_24ccddd0946c0be7e3d91a27335473d71ec064a7de4d1db7",
    "createdAt": "2026-10-05T05:00:00.000Z"
  },
  "warning": "Save this key now — it will not be shown again."
}
```

### GET /admin/api-keys
列出所有API Key（脱敏）。

**响应示例：**
```json
{
  "data": [
    {
      "id": "ak_abc123",
      "name": "My Integration",
      "keyMasked": "kl_24cc...1db7",
      "status": "active",
      "callCount": 156,
      "lastUsedAt": "2026-10-05T05:30:00.000Z",
      "createdAt": "2026-10-05T05:00:00.000Z"
    }
  ],
  "recentCalls": [
    {
      "time": "2026-10-05T05:30:00.000Z",
      "endpoint": "GET /customers",
      "status": 200,
      "durationMs": 12,
      "apiKeyName": "My Integration"
    }
  ]
}
```

### DELETE /admin/api-keys/:id
撤销API Key。撤销后该Key立即失效。

**响应示例：**
```json
{"success": true, "message": "API key revoked"}
```

### POST /admin/sync-snapshot
同步前端localStorage数据到后端快照（使API返回真实数据）。

**请求体：**
```json
{
  "customers": [...],
  "drafts": [...],
  "sendTasks": {...},
  "analytics": {...}
}
```

---

## 八、Webhook接口

### POST /admin/webhooks
创建Webhook。

**请求体：**
```json
{
  "url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
  "events": ["customer.reply", "inquiry.new"],
  "name": "Feishu Bot"
}
```

**响应示例：**
```json
{
  "data": {
    "id": "wh_abc123",
    "url": "https://open.feishu.cn/...",
    "secret": "whsec_xxxxxxxxxxxxxxxx",
    "events": ["customer.reply", "inquiry.new"],
    "enabled": true,
    "createdAt": "2026-10-05T05:00:00.000Z"
  }
}
```

### GET /admin/webhooks
列出所有Webhook。

### DELETE /admin/webhooks/:id
删除Webhook。

### POST /webhooks/trigger
手动触发Webhook（内部测试用）。

**请求体：**
```json
{
  "event": "customer.reply",
  "payload": {
    "customerId": "cust_abc123",
    "customerName": "ABC Kitchenware",
    "replyPreview": "Hi, I'm interested in your knives..."
  }
}
```

---

## 九、Webhook事件说明

### 支持的事件类型

| 事件 | 说明 | payload字段 |
|------|------|-------------|
| `customer.reply` | 新客户回复 | customerId, customerName, replyPreview, repliedAt |
| `inquiry.new` | 新询盘 | inquiryId, customerName, product, message |
| `sendtask.completed` | 发送任务完成 | taskId, customerName, subject, sentAt |
| `followup.due` | 跟进提醒到期 | customerId, customerName, dueDate, notes |

### Webhook投递格式

```json
{
  "event": "customer.reply",
  "timestamp": "2026-10-05T05:00:00.000Z",
  "payload": {
    "customerId": "cust_abc123",
    "customerName": "ABC Kitchenware",
    "replyPreview": "Hi, I'm interested..."
  }
}
```

### 签名验证

HTTP头：
```
X-Webhook-Signature: sha256=<hex_digest>
X-Webhook-Timestamp: 2026-10-05T05:00:00.000Z
```

签名计算：
```
signature = HMAC-SHA256(secret, timestamp + '.' + JSON.stringify(payload))
```

**Python验证示例：**
```python
import hmac, hashlib, json

secret = "whsec_xxxxxxxx"
timestamp = request.headers["X-Webhook-Timestamp"]
signature = request.headers["X-Webhook-Signature"]
payload = request.get_data()

expected = hmac.new(
    secret.encode(),
    (timestamp + "." + payload.decode()).encode(),
    hashlib.sha256
).hexdigest()

if hmac.compare_digest(f"sha256={expected}", signature):
    # 验证通过
    pass
```

---

## 十、错误码

| HTTP状态码 | 错误码 | 说明 |
|-----------|--------|------|
| 401 | API_KEY_REQUIRED | 缺少x-api-key头 |
| 401 | API_KEY_INVALID | API Key无效或已撤销 |
| 401 | ADMIN_TOKEN_REQUIRED | 管理接口需要x-admin-token |
| 404 | NOT_FOUND | 资源不存在 |
| 429 | RATE_LIMITED | 超出限流（60次/分钟） |
| 400 | VALIDATION_ERROR | 请求参数验证失败 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |

**错误响应格式：**
```json
{
  "error": "Unauthorized",
  "code": "API_KEY_INVALID",
  "hint": "send header x-api-key"
}
```

---

## 十一、数据同步说明

后端API数据存储在`data/`目录的JSON文件中，与前端浏览器localStorage相互独立。

**使API返回真实业务数据的方法：**

1. **手动同步**：在工作台浏览器控制台执行：
   ```javascript
   // 收集前端数据
   const snapshot = {
     customers: S.customers,
     drafts: S.drafts,
     sendTasks: S.dailySendTasks,
     analytics: {} // 可自行计算
   };
   // 推送到后端
   fetch('/api/v1/admin/sync-snapshot', {
     method: 'POST',
     headers: {'Content-Type': 'application/json'},
     body: JSON.stringify(snapshot)
   });
   ```

2. **前端管理面板**：API与集成页面提供"同步数据"按钮（如已实现）

3. **定时同步**：建议设置每5分钟自动同步一次

---

## 十二、CORS

API端点支持跨域访问：
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: Content-Type, x-api-key, x-admin-token`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`

可直接从浏览器、Postman、curl、n8n、Dify等工具调用。
