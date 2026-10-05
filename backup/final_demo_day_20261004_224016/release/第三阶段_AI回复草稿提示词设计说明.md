# AI回复草稿提示词设计说明

> 第三阶段核心功能 · 配合 `phase3-reply-timeline.js` 使用 · 2026-10-05

---

## 一、设计目标

为外贸B2B场景下的客户回复生成**专业、可信、可直接使用**的邮件草稿，核心原则：

1. **基于真实上下文**：不凭空生成，必须结合客户原文、客户档案、历史沟通、企业知识库
2. **中英双语**：外语回复附中文翻译，中文回复附英文翻译，降低Leo的语言切换成本
3. **意图驱动**：6种客户意图对应6种回复策略，不千篇一律
4. **不编造事实**：价格、MOQ、认证、产能等敏感信息严格使用已确认数据，未确认则标注"待确认"
5. **人工审核优先**：AI只生成草稿，最终发送由Leo手动完成

---

## 二、输入上下文构建

每次AI回复生成时，系统组装以下上下文传入prompt：

### 2.1 客户档案
```
公司名: {customer.company}
国家: {customer.country}
品类: {customer.productCategory}（户外刀/厨房刀/剪刀/厨房用品）
联系人: {customer.contact.name}
客户状态: {customer.status}
客户评分: {customer.scores.grade}（A/B/C）
```

### 2.2 历史沟通摘要
```
历史开发信总数: {sendRecords.length}
首次发送主题: {firstSend.subject}
最近发送主题: {lastSend.subject}
历史打开次数: {openCount}
历史点击次数: {clickCount}
是否曾回复: {hasReplied ? '是' : '否'}
```

### 2.3 客户最新邮件
```
主题: {inbox.subject}
正文: {inbox.body}
```

### 2.4 AI预分析（aiSummary）
```
客户意图: {aiSummary.intent}
关注产品: {aiSummary.product}
关键问题: {aiSummary.question}
紧急程度: {aiSummary.urgency}
```

### 2.5 企业知识库（S.companyFacts，仅使用非空字段）
```
品牌: {brandName}
公司: {companyName}
官网: {website}
MOQ: {moq}（为空则不提及）
交付周期: {leadTime}（为空则不提及）
认证: {certifications}（为空则不提及）
```

---

## 三、意图分类与回复策略

系统先通过正则匹配 subject + body + aiSummary.intent，将客户回复分为6类：

| 意图 | 识别关键词 | 回复策略 | CTA |
|------|-----------|----------|-----|
| **interested（感兴趣）** | interested, like, catalog, more info, 感兴趣, 目录 | 热情回应 + 产品目录概览 + 重点品类卖点 | 邀请提问 / 发送详细目录 |
| **quote（需报价）** | price, quote, cost, MOQ, 价格, 报价, 多少钱 | 不编造价格，确认数量/规格/包装，承诺24h内正式报价 | 请求规格细节 / 提供报价单模板 |
| **purchased（已购买）** | order, received, bought, 订单, 收到, 购买 | 感谢信任 + 询问使用反馈 + 配件/复购建议 | 邀请评价 / 推荐配件 |
| **unsubscribe（退订）** | unsubscribe, remove, stop, no more, 退订, 不要再发 | 礼貌确认退订，立即停止，不强推 | 无CTA，保持专业 |
| **sample（需样品）** | sample, prototype, 样品, 样板, 试用 | 说明样品政策（样品费+运费，大货可退），索要快递账号/地址 | 请求收货地址 / 确认样品型号 |
| **other（其他）** | 以上均不匹配 | 直接回应客户具体问题 + 提供下一步选项 | 开放式提问 / 邀请视频通话 |

---

## 四、Prompt 模板

```
You are Leo Li, founder of {brandName}, a B2B export company specializing in 
{category} products from Yangjiang, China. Write a professional email reply 
to a customer inquiry.

## Customer Profile
- Company: {company}
- Country: {country}
- Contact: {contactName}
- Product Category: {categoryLabel}
- History: {historySummary}

## Customer's Latest Email
Subject: {subject}
Body:
{body}

## AI Analysis
- Intent: {intent}
- Product of Interest: {product}
- Key Question: {question}
- Urgency: {urgency}

## Company Facts (use ONLY these, do NOT invent)
{companyFactsBlock}

## Reply Strategy for Intent "{intent}"
{strategyInstructions}

## Requirements
1. Greeting: "Dear {contactName},"
2. Body: directly address the customer's question/need, then add 1-2 relevant 
   product selling points for {categoryLabel}, then a clear CTA.
3. Keep body under 250 words. Professional, warm, B2B tone.
4. Signature: Leo Li, {brandName}, {website}
5. DO NOT invent prices, MOQ numbers, certifications, factory size, or client cases.
   If a fact is not provided above, say "I will confirm and get back to you within 24 hours."
6. The customer wrote in {detectedLanguage}. Write the main reply in 
   {detectedLanguage}, then provide a translation in {otherLanguage}.

## Output Format (strict)
===REPLY_START===
{email subject line}
{email body}
===REPLY_END===
===TRANSLATION_START===
{translation}
===TRANSLATION_END===
```

---

## 五、各意图策略指令详情

### 5.1 interested（感兴趣）
```
Strategy: Be warm and enthusiastic. Acknowledge their interest. 
Give a brief overview of our {categoryLabel} range (2-3 product types). 
Mention OEM/ODM and private label capability. 
CTA: Ask which specific product type they want to focus on, offer to send a detailed catalog.
```

### 5.2 quote（需报价）
```
Strategy: Do NOT give specific prices. Acknowledge their price request. 
Explain that pricing depends on quantity, material, packaging, and customization. 
Ask for: target quantity, preferred material/grade, packaging requirements, destination port. 
Promise to send a formal quotation within 24 hours after receiving these details.
CTA: Provide the required details so we can prepare an accurate quote.
```

### 5.3 purchased（已购买）
```
Strategy: Thank them sincerely for their order/trust. Ask about their experience 
with the products so far. Suggest complementary accessories or repeat order benefits.
CTA: Ask for feedback and offer priority support for future orders.
```

### 5.4 unsubscribe（退订）
```
Strategy: Be polite and brief. Confirm we have removed them from our outreach list. 
Do NOT push products. Wish them well. Leave the door open if they need anything in future.
CTA: None. Keep it professional and respectful.
```

### 5.5 sample（需样品）
```
Strategy: Explain our sample policy: sample fee + shipping cost (refundable on bulk order). 
Ask which specific model(s) they want samples of, their shipping address, and courier account (if any).
Provide estimated sample lead time.
CTA: Confirm sample model(s) and shipping details.
```

### 5.6 other（其他）
```
Strategy: Directly answer the customer's specific question or address their concern. 
If the question is unclear, ask for clarification. Offer a video call for complex discussions.
CTA: Invite them to schedule a call or ask follow-up questions.
```

---

## 六、语言检测逻辑

```javascript
function detectLanguage(text) {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  if (cjk > latin * 0.3) return 'zh';  // 中文为主
  return 'en';                          // 默认英文
}
```

- 客户用中文 → 主回复中文 + 英文翻译
- 客户用英文/其他 → 主回复英文 + 中文翻译
- 翻译质量要求：专业外贸术语准确，不是逐字机器翻译

---

## 七、输出解析

前端通过正则提取AI返回内容：

```javascript
const replyMatch = result.content.match(/===REPLY_START===\n([\s\S]*?)===REPLY_END===/);
const transMatch = result.content.match(/===TRANSLATION_START===\n([\s\S]*?)===TRANSLATION_END===/);
const replyText = replyMatch ? replyMatch[1].trim() : result.content;
const translation = transMatch ? transMatch[1].trim() : '';
```

如果分隔符解析失败（AI未严格遵循格式），降级为将整个返回作为回复正文，翻译为空。

---

## 八、安全与事实约束

### 8.1 禁止编造清单
- ❌ 具体价格（"$2.50/pc"）
- ❌ MOQ数字（"MOQ 500 pcs"）——除非 S.companyFacts.moq 有值
- ❌ 认证名称（"FDA certified"）——除非 S.companyFacts.certifications 有值
- ❌ 工厂规模（"10000 sqm factory"）
- ❌ 出口国家数量（"export to 50+ countries"）
- ❌ 客户案例（"Walmart is our client"）
- ❌ 产能数字（"monthly capacity 500K pcs"）

### 8.2 安全替代话术
- 价格："I will prepare a detailed quotation based on your specifications."
- MOQ："Our standard MOQ varies by product — I'll confirm the exact number for your selected items."
- 认证："We hold relevant industry certifications — happy to share specific certificates for the products you're interested in."

---

## 九、调用参数

```javascript
const result = await callAI(
  [{ role: 'user', content: assembledPrompt }],
  {
    purpose: 'reply',
    timeout: 90000,        // 90秒超时
    temperature: 0.5       // 中等创造性，保持专业稳定
  }
);
```

模型路由：gpt-5.6-terra 优先 → 故障转移 glm → ollama（由服务端 model-router 自动处理）。

---

## 十、迭代优化方向

1. **反馈闭环**：用户标记"已发送"后，可记录该草稿是否带来回复，用于后续prompt优化
2. **模板库**：高频意图（quote/sample）可沉淀为可复用模板，AI仅做个性化填充
3. **多轮上下文**：当前仅取最新一封客户邮件，未来可纳入完整邮件线程
4. **品类深度知识**：当前引用 S.companyFacts 概览，未来可接入 `公司知识库/02_产品知识库/` 的品类级详细卖点
5. **语气调节**：根据客户等级（A/B/C）调整回复详细程度，A级客户更详尽
