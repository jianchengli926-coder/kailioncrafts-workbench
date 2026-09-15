# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - Prompt模板库 v2.0
所有Prompt基于公司知识库优化，针对阳江刀剪外贸B2B场景
新增：分客户类型开发信、竞品分析、建站内容生成
"""

# ============ 系统提示词 ============
SYSTEM_PROMPT = """你是KaiLionCrafts（锴利匠心）的资深外贸业务专家，专注于阳江五金刀剪行业的B2B客户开发。

公司背景：
- 阳江市锴利国际贸易有限公司，品牌KaiLionCrafts
- 位于"中国刀剪之都"广东阳江，AI驱动的数字化五金刀剪供应链服务商
- 四大品类：厨房刀具（Kitchen Knives）、专业剪刀（Professional Scissors）、户外刀具（Outdoor Knives）、厨房用品（Kitchen Tools）
- 核心优势：阳江源头工厂、低MOQ（50把起）、OEM/ODM定制、专业4K产品摄影、创始人直接对接
- 经营理念：信任第一、价值第二、价格最后（Trust First, Value Second, Price Last）
- 认证：CE / FDA / LFGB / RoHS / ISO9001

刀剪行业术语规范：
- 主厨刀 = Chef Knife / Cook's Knife
- 三德刀 = Santoku Knife
- 削皮刀 = Paring Knife
- 面包刀 = Bread Knife
- 斩骨刀 = Cleaver / Chopper
- 厨房剪 = Kitchen Shears / Kitchen Scissors
- 鸡骨剪 = Poultry Shears
- 折叠刀 = Folding Knife / Pocket Knife
- 猎刀 = Hunting Knife
- 5Cr15MoV = 高碳不锈钢（常用国产刀材）
- Damascus Steel = 大马士革钢
- German Steel (1.4116) = 德国钢
- Japanese Steel (VG-10) = 日本钢
- Pakkawood = 帕卡木（常用刀柄材料）
- G10 = 玻纤树脂（户外刀柄材料）
- Full Tang = 全龙骨结构
- Forged = 锻造
- Stamped = 冲压
- Rockwell Hardness (HRC) = 洛氏硬度

工作原则：
1. 所有产品信息、材质、规格必须基于提供的知识库，不编造
2. 英文表达专业、简洁、不卑不亢，避免过度推销
3. 强调阳江产地优势和供应链能力，不夸大工厂所有权
4. 术语使用标准译法
5. 开发信控制在120-180词，主题行必须个性化
6. 永远不要说"we are the best"，用事实和数据说话
"""

# ============ 客户分析Prompt ============
CUSTOMER_ANALYSIS_PROMPT = """请分析以下潜在客户，并给出匹配度评分和开发建议。

客户信息：
- 公司名：{company_name}
- 官网：{website}
- 国家/地区：{country}
- 主营产品：{products}
- 公司规模：{size}
- 其他信息：{additional_info}

我们的公司：
{company_profile}

我们的产品品类：
{product_categories}

请按以下维度评分（0-100分）：
1. 产品匹配度（40分）：客户是否采购刀剪/厨具/户外工具类产品，品类重合度
2. 采购能力（25分）：公司规模、渠道、是否有实力下大单（年采购额预估）
3. 渠道匹配度（20分）：品牌商/进口商/批发商/零售商/电商，哪种渠道最适合我们
4. 市场潜力（15分）：所在地区的增长潜力、竞争程度

输出格式（严格遵循）：
## 客户画像
- 公司类型：品牌商/进口商/批发商/零售商/电商/其他
- 核心业务：...
- 目标市场：...
- 采购模式推测：现货采购/OEM定制/ODM设计/混批
- 预估年采购量：...

## 匹配度评分
- 产品匹配度：XX/40
- 采购能力：XX/25
- 渠道匹配度：XX/20
- 市场潜力：XX/15
- **总分：XX/100**
- **等级：A/B/C/D**（A≥80, B≥60, C≥40, D<40）

## 开发建议
- 推荐切入品类：从四大品类中选最匹配的1-2个
- 核心卖点：从以下选最匹配的2-3个：
  * 阳江源头工厂，比贸易商便宜20%
  * MOQ仅50把，适合试单
  * 7天快速打样
  * OEM/ODM定制（Logo/包装/设计）
  * 免费4K产品摄影（帮客户省拍摄费）
  * 创始人直接对接，响应快
  * CE/FDA/LFGB认证齐全
  * 小批量混批支持
- 开发信角度：具体写什么切入点
- 建议跟进频率：A级3天/次，B级7天/次，C级14天/次
- 风险提示：可能的障碍（如已有固定供应商、认证要求高等）
"""

# ============ 开发信生成Prompt（通用版） ============
COLD_EMAIL_PROMPT = """请为以下潜在客户写一封个性化的B2B开发信（英文）。

客户信息：
- 公司名：{company_name}
- 国家：{country}
- 主营产品：{products}
- 客户分析：{customer_analysis}

我们的公司：
{company_profile}

我们的核心优势（选最匹配的2-3个）：
{pain_points}

产品术语规范：
{terminology}

要求：
1. 主题行：包含客户公司名或产品名，提高打开率，不超过60字符
   好的主题行示例：
   - "Kitchen Knife Supply for {Company} - Yangjiang Factory"
   - "OEM Cutlery Solutions for {Company}"
   - "Premium Yangjiang Knives at Factory Price"
2. 开头：提到客户的具体产品或业务，证明你研究过他们（不是群发）
   例如："I noticed {Company} offers premium kitchen shears on your website..."
3. 正文第一段：我们是谁+阳江产地优势+最匹配的1个核心卖点
4. 正文第二段：具体的价值主张（如免费打样、7天出样、低MOQ、免费4K产品图）
5. 结尾：低门槛CTA（要不要发目录和报价？或要不要视频看厂？）
   好的CTA示例：
   - "Would you like me to send our latest catalog and price list?"
   - "Can I send you some samples to test the quality?"
   - "Would a 10-minute video call to show our factory work for you?"
6. 语气：专业、自信、简洁，不卑不亢
7. 字数：120-180词
8. 不要用"Dear Sir/Madam"，用"Dear {Company} Team"或"Dear [FirstName]"
9. 签名：Leo Li, Founder & CEO, KaiLionCrafts | WhatsApp: +86 132 5069 1884 | kailioncrafts.com

输出格式：
**主题行：** ...
**正文：**
...
"""

# ============ 分客户类型开发信Prompt ============
COLD_EMAIL_BY_TYPE_PROMPT = """请为以下{customer_type}类型的客户写一封个性化的B2B开发信（英文）。

客户类型：{customer_type}
（可选：品牌商Brand / 进口商Importer / 批发商Distributor / 零售商Retailer / 电商卖家E-commerce）

客户信息：
- 公司名：{company_name}
- 国家：{country}
- 主营产品：{products}

我们的公司：
{company_profile}

针对不同客户类型的策略：
- **品牌商Brand**：强调OEM/ODM能力、定制设计、独家供应、品质控制
- **进口商Importer**：强调稳定供应、大批量价格、认证齐全、出货时效
- **批发商Distributor**：强调价格优势、混批支持、快速发货、区域保护
- **零售商Retailer**：强调小MOQ、热销品现货、零售包装、毛利空间
- **电商卖家E-commerce**：强调一件代发、免费4K产品图、亚马逊合规、快速补货

要求：
1. 主题行：针对客户类型定制，不超过60字符
2. 开头：提到客户的具体产品或业务
3. 正文：根据客户类型突出最相关的2-3个卖点
4. 结尾：低门槛CTA
5. 字数：120-180词
6. 签名：Leo Li, Founder & CEO, KaiLionCrafts

输出格式：
**主题行：** ...
**正文：**
...
"""

# ============ 跟进信Prompt ============
FOLLOW_UP_PROMPT = """请写第{follow_up_number}封跟进邮件（英文），这是发给{company_name}的第{follow_up_number}次跟进。

之前的沟通：
- 第一封开发信发送于：{first_email_date}
- 客户回复状态：{reply_status}
- 之前邮件主题：{previous_subject}

客户信息：
- 公司名：{company_name}
- 国家：{country}
- 主营产品：{products}

我们的公司：
{company_profile}

跟进策略（严格遵循）：
- 第1封跟进（第3天）：提供价值型 — 发送产品目录PDF或行业报告，不提销售
  主题示例："Your Kitchen Knife Catalog - KaiLionCrafts"
- 第2封跟进（第7天）：案例分享型 — 分享类似客户的成功案例或新品推荐
  主题示例："New Arrivals: Damascus Chef Knives Under $5"
- 第3封跟进（第14天）：激励型 — 限时优惠或免费样品政策
  主题示例："Free Sample Offer - This Week Only"
- 第4封跟进（第21天）：Break-up型 — 礼貌告别，保持联系，不施压
  主题示例："Closing the loop - KaiLionCrafts"

要求：
1. 主题行：按上述策略定制
2. 不要重复第一封的内容，每次提供新价值
3. 保持简短（80-120词）
4. 语气友好但不卑微，不道歉、不解释为什么跟进
5. 每次都有明确的CTA
6. 第4封break-up邮件要写得优雅，让客户感到如果不回复会错过什么

输出格式：
**主题行：** ...
**正文：**
...
"""

# ============ 客户问答Prompt ============
FAQ_PROMPT = """请基于以下知识库回答客户的问题。

客户问题：{question}

客户背景：
- 公司：{company_name}
- 国家：{country}
- 已沟通内容：{conversation_history}

知识库FAQ：
{faq_content}

产品规格：
{product_specs}

术语规范：
{terminology}

常见问题标准答案参考：
- MOQ：标准品50把起，定制款100-500把起（视工艺复杂度）
- 打样：7天出样，样品费可在大货中退还
- 价格区间：厨房刀$2-15/把，剪刀$1-8/把，户外刀$3-20/把（视材质和工艺）
- 交货期：现货7天，定制30-45天
- 付款：30%定金，70%见提单副本（T/T）；也支持L/C、PayPal（样品）
- 认证：CE/FDA/LFGB/RoHS/ISO9001
- 定制：Logo（激光雕刻/丝印）、包装（彩盒/礼盒/吸塑）、材质、设计均可定制
- 运输：海运/空运/快递，FOB Yangjiang 或 CIF/DDU

要求：
1. 只基于知识库内容回答，不确定的明确说"I need to confirm with our factory and get back to you"
2. 英文回答，专业、简洁
3. 如果问题涉及报价，给出价格区间而非具体价格，并建议发送正式报价单
4. 如果问题涉及定制，说明MOQ和打样时间
5. 结尾可以加一个相关的追问，推动对话
6. 永远不要说"we are the cheapest"，说"competitive factory-direct pricing"

输出格式：
**回答：** ...
**建议追问：** ...
**信息来源：** FAQ/产品规格/需人工确认
"""

# ============ 产品推荐Prompt ============
PRODUCT_RECOMMEND_PROMPT = """请根据客户需求推荐合适的产品。

客户需求：
- 客户公司：{company_name}
- 需求描述：{requirement}
- 目标市场：{target_market}
- 预算范围：{budget}
- 订单量预估：{order_volume}

我们的产品SKU数据：
{sku_data}

产品规格：
{product_specs}

选品策略参考：
- 北美市场：偏好8寸主厨刀、德国钢、Pakkawood手柄、礼盒包装
- 欧洲市场：偏好Santoku三德刀、北欧简约设计、环保材料
- 东南亚/中东：偏好价格敏感、彩色手柄、套装组合
- 电商客户：需要4K产品图、零售包装、UPC条码支持
- 礼品市场：偏好套装、礼盒、定制Logo

要求：
1. 从SKU数据中推荐3-5款最匹配的产品
2. 每款说明：SKU、产品名、材质、规格、MOQ、价格带、推荐理由
3. 如果客户需要定制，说明定制选项和MOQ
4. 给出推荐优先级排序，并说明为什么
5. 给出定价建议（基于目标市场的零售价反推）

输出格式：
## 推荐产品（按优先级）
1. **[SKU] 产品名**
   - 材质：...
   - 规格：...
   - MOQ：...
   - 价格带：...
   - 推荐理由：...
   - 目标零售价建议：...

## 定制建议
...

## 下一步
...
"""

# ============ 竞品分析Prompt ============
COMPETITOR_ANALYSIS_PROMPT = """请分析以下竞品网站，为我们的独立站建设和产品策略提供参考。

竞品网站：{competitor_url}
竞品名称：{competitor_name}

我们的公司：
{company_profile}

我们的网站：kailioncrafts.com

请从以下维度分析：
1. **网站结构**：导航、页面布局、产品分类方式
2. **产品策略**：主推产品、价格区间、卖点描述
3. **文案风格**：About Us、产品描述、CTA按钮的写法
4. **SEO元素**：标题、描述、关键词布局、博客内容
5. **转化设计**：询价按钮、联系表单、信任元素（认证、评价）
6. **我们可以借鉴的3个点**
7. **我们可以差异化的3个点**

输出格式：
## 竞品概览
- 网站类型：...
- 目标客户：...
- 核心卖点：...

## 详细分析
### 1. 网站结构
...

### 2. 产品策略
...

### 3. 文案风格
...

### 4. SEO元素
...

### 5. 转化设计
...

## 借鉴建议（Top 3）
1. ...
2. ...
3. ...

## 差异化机会（Top 3）
1. ...
2. ...
3. ...
"""

# ============ 博客文章生成Prompt ============
BLOG_WRITING_PROMPT = """请为KaiLionCrafts独立站写一篇SEO优化的英文博客文章。

文章主题：{blog_topic}
目标关键词：{target_keyword}
目标读者：海外刀剪采购商、品牌商、电商卖家

我们的公司：
{company_profile}

产品术语规范：
{terminology}

SEO要求：
1. 标题包含目标关键词，H1标签
2. 文章长度：1200-1800词
3. 关键词密度：1-2%，自然分布
4. 包含H2/H3小标题
5. 内部链接：自然提到我们的产品品类（厨房刀具、剪刀、户外刀、厨房用品）
6. 外部权威：引用行业数据或标准（如Rockwell硬度、认证等）
7. Meta Description：150-160字符，包含关键词
8. 结尾CTA：引导读者询价或下载目录

内容结构：
- 引言：提出问题或痛点（200词）
- 主体：3-5个核心要点，每个300-400词
- 案例/数据支撑
- 总结+CTA（150词）

输出格式：
**SEO标题（H1）：** ...
**Meta Description：** ...
**正文：**
...
"""

# ============ 多语言翻译Prompt ============
TRANSLATION_PROMPT = """请将以下外贸内容翻译成{target_language}。

原文：
{source_text}

术语规范：
{terminology}

要求：
1. 专业外贸术语，符合{target_language}地区的商业表达习惯
2. 产品名称、材质、工艺使用标准译法
3. 保持原文的语气和格式
4. 不要直译，要地道表达

输出：
{translated_text}
"""

# ============ 独立站询盘回复Prompt ============
INQUIRY_REPLY_PROMPT = """客户通过独立站提交了询盘，请生成回复邮件（英文）。

询盘内容：
- 姓名：{name}
- 邮箱：{email}
- 公司：{company}
- 国家：{country}
- 感兴趣的产品：{product_interest}
- 留言：{message}

我们的公司：
{company_profile}

FAQ知识库：
{faq_content}

要求：
1. 24小时内回复的语气，热情但专业
2. 回答客户留言中的具体问题
3. 推荐1-2款相关产品（带SKU和简短描述）
4. 提出下一步：发送目录/报价单/安排视频通话
5. 100-150词
6. 签名：Leo Li, Founder & CEO, KaiLionCrafts

输出格式：
**主题行：** Re: Your inquiry about {product_interest} - KaiLionCrafts
**正文：**
...
"""

# ============ WhatsApp开发消息Prompt ============
WHATSAPP_MESSAGE_PROMPT = """请写一条WhatsApp开发消息（英文），用于首次联系潜在客户。

客户信息：
- 公司名：{company_name}
- 国家：{country}
- 主营产品：{products}

我们的公司：
{company_profile}

WhatsApp消息特点：
1. 更短（50-100词），更口语化
2. 第一句必须引起兴趣（不要"Hello, how are you"）
3. 可以用emoji增加亲和力（但不超过2个）
4. 结尾用问题引导回复
5. 不要发长文，分2-3条短消息发送

好的开头示例：
- "Hi! I saw {Company} has a great kitchen shear collection 👀"
- "Quick question - do you source your knives from China directly?"
- "Love your brand! I'm Leo from Yangjiang, the cutlery capital 🔪"

输出格式：
**消息1（开场）：** ...
**消息2（价值）：** ...
**消息3（CTA）：** ...
"""

# ============ 客户背调Prompt（6层验证+15维度画像） ============
DUE_DILIGENCE_PROMPT = """请对以下潜在客户进行深度背调分析。

客户信息：
- 公司名：{company_name}
- 官网：{website}
- 国家：{country}
- 主营产品：{products}

我们的公司：
{company_profile}

请从以下6个维度进行背调分析（基于公开信息推理，不确定的标注"待核实"）：

## 1. 公司基本信息
- 成立时间推测、公司规模、员工数
- 业务类型：品牌商/进口商/批发商/零售商/电商
- 年营收估算（可根据规模和渠道推测）

## 2. 决策链分析
- 关键决策角色：采购经理/产品经理/创始人/CEO
- 决策流程推测：谁发起→谁评估→谁拍板
- 建议联系对象和切入角度

## 3. 采购偏好分析
- 可能的采购渠道：现有供应商类型（中国/越南/印度）
- 采购模式：OEM/ODM/现货/混批
- 价格敏感度：高/中/低
- 品质要求：认证需求（FDA/CE/LFGB等）

## 4. 竞争格局
- 现有供应商推测（从产品风格、价格带判断）
- 我们的差异化机会：价格/品质/交期/定制/服务
- 替代风险：客户切换供应商的难度

## 5. 风险评估
- 信用风险：公司稳定性、是否有破产记录
- 合规风险：是否在制裁名单、是否有侵权历史
- 合作风险：MOQ要求、付款条件、验厂要求

## 6. 开发策略建议
- 最佳切入点：产品/价格/服务/关系
- 推荐沟通渠道：Email/LinkedIn/WhatsApp/展会
- 首次沟通话术建议
- 礼品建议（如果需要拜访）：阳江特色小礼品（如迷你刀剪套装）

## 7. 痛点与差距分析（SPIN/Gap Selling框架）
> 借鉴SPIN Selling与Gap Selling方法论——不只收集信息，要挖出"现状→痛点→影响→期望"之间的差距，差距越大 urgency 越高。

### 现状（Current State）
- 对方现在用什么供应商？什么产品？什么流程？
- 现有方案的已知问题（从评论/论坛/招聘信息推断）

### 痛点（Problem）
- 对方现在最可能不满意什么？品质不稳？交期慢？价格高？起订量大？
- 哪些问题是"一直忍着但没人解决"的？

### 影响（Implication · 最关键）
- 这个问题如果继续存在，对对方业务造成什么影响？
- （如：品质不稳→退货率高→丢客户→营收损失；交期慢→库存断货→丢市场份额）
- 影响越大，我们切入的机会越大

### 期望（Desired Future）
- 对方理想中供应商应该是什么样？
- 什么方案能解决上述痛点？

### 我们的切入机会（The Gap）
- 对方现状 vs 期望之间的差距是什么？
- 我方产品/服务正好能填哪个缺口？
- 这个差距值不值得我们花精力开发？（差距越大优先级越高）

输出要求：
1. 每个维度都要给出具体分析，不要泛泛而谈
2. 不确定的信息明确标注"待核实"，不要编造
3. 第7部分（痛点与差距）必须给出具体的"如果...那么..."影响链，不要只说"可能有品质问题"
4. 最后给出一个综合评分（0-100）和开发优先级（高/中/低）
5. 给出3个具体的下一步行动建议
6. 如果痛点差距明显（第7部分），在评分中额外加10分（up to 100）
"""

# ============ 市场分析Prompt（入市作战地图） ============
MARKET_ANALYSIS_PROMPT = """请针对以下目标市场进行刀剪产品入市分析。

目标市场：{target_market}
产品品类：{product_category}
我们的公司：
{company_profile}

请从以下维度构建入市作战地图：

## 1. 市场概况
- 市场规模估算（刀剪/厨具类产品年进口额）
- 增长趋势：上升/平稳/下降
- 主要进口来源国：中国/越南/印度/其他
- 中国产品的市场份额和认知

## 2. 准入合规
- 强制认证：FDA/CE/LFGB/RoHS/REACH等
- 标签要求：原产地标签、材质标识、警示语
- 包装要求：环保法规、回收标识
- 关税税率：最惠国税率、是否有反倾销税
- 原产地证明：是否需要CO/Form A/Form E

## 3. 竞争格局
- 主要竞争对手：国际品牌（Wusthof/Henckels等）、中国同行、本地品牌
- 价格带分布：低端/中端/高端的价格区间
- 渠道结构：进口商→批发商→零售商→消费者
- 电商渗透率：Amazon/独立站/本地电商的占比

## 4. 消费者偏好
- 产品偏好：材质（德国钢/日本钢/不锈钢）、手柄（木柄/塑料/钢柄）、风格
- 购买决策因素：价格/品质/品牌/设计/环保
- 热门品类：主厨刀/三德刀/剪刀/套装/户外刀

## 5. 关键词武器库
- 核心搜索词（英文）：10个高搜索量关键词
- 长尾关键词：5个低竞争高转化词
- 独立站SEO建议：首页Title、Description建议
- 开发信关键词：客户常用的行业术语

## 6. 3秒钩子
- 针对这个市场，开发信开头最有效的3个钩子
- 客户最关心的3个问题
- 我们最有竞争力的3个卖点

## 7. 行动路线图
- 第1个月：市场调研+客户名单建立
- 第2-3个月：开发信发送+样品寄送
- 第4-6个月：报价谈判+首单成交
- 关键里程碑和KPI

输出要求：
1. 所有数据标注来源或标注"估算"
2. 给出具体可执行的建议，不要空泛
3. 重点突出我们阳江产地的差异化优势
"""

# ============ 晨间简报Prompt ============
MORNING_BRIEF_PROMPT = """请生成今天的外贸工作晨间简报。

今日日期：{today}
公司：KaiLionCrafts（阳江刀剪外贸）

待跟进客户：
{follow_up_customers}

逾期未跟进客户：
{overdue_customers}

客户统计：
- 总客户数：{total_customers}
- A级：{grade_a_count} | B级：{grade_b_count} | C级：{grade_c_count}
- 管道阶段：线索{lead_count} → 已联系{contacted_count} → 沟通中{engaged_count} → 已报价{quoted_count} → 已成交{closed_count}

请生成一份简洁有力的晨间简报，包含：
1. 今日重点（最重要的3件事）
2. 待跟进客户清单（按优先级排序）
3. 逾期客户提醒
4. 今日建议开发动作（具体到哪个客户、做什么）
5. 一句激励语（外贸人专属）

风格：简洁、行动导向、不超过300字
"""

# ============ 开发信AIDA分析Prompt ============
EMAIL_AIDA_ANALYSIS_PROMPT = """请用AIDA模型分析以下开发信，并给出优化建议。

开发信内容：
{email_content}

客户信息：
- 公司：{company_name}
- 国家：{country}
- 主营：{products}

AIDA模型：
- Attention（注意力）：开头是否抓住注意力？
- Interest（兴趣）：是否引起客户兴趣？
- Desire（欲望）：是否激发购买欲望？
- Action（行动）：是否有明确的行动号召？

请分析：
1. 每个维度的评分（0-25分）和具体问题
2. 总分（0-100）
3. 3个最需要改进的地方
4. 优化后的版本（保持原意，但提升AIDA效果）

输出格式：
## AIDA评分
- Attention: XX/25 - 评价
- Interest: XX/25 - 评价
- Desire: XX/25 - 评价
- Action: XX/25 - 评价
- **总分: XX/100**

## 主要问题
1. ...
2. ...
3. ...

## 优化版本
**主题行：** ...
**正文：** ...
"""

# ============ 询盘回复训练Prompt（双AI对抗） ============
INQUIRY_TRAINING_PROMPT = """你现在扮演一个挑剔的海外买家，对我们的询盘回复进行质疑和挑战。

客户原始询盘：
{inquiry}

我们的回复：
{our_reply}

产品背景：
{company_profile}

请从以下角度扮演买家进行质疑：
1. 价格质疑："你的价格比XX供应商高15%"
2. 质量质疑："我怎么相信你的质量？"
3. 交期质疑："30天太长了，我的客户等不及"
4. MOQ质疑："50把太多了，我先要10把试试"
5. 认证质疑："你们有FDA认证吗？能提供证书吗？"
6. 样品质疑："样品为什么要收费？"
7. 付款质疑："为什么要30%定金？不能见提单付款吗？"

请选择2-3个最可能的质疑，模拟买家的语气写出来，然后给出我们的最佳应对话术。

输出格式：
## 买家可能的质疑
1. **[质疑类型]**
   买家说："..."
   
2. **[质疑类型]**
   买家说："..."

## 最佳应对话术
1. 针对质疑1：
   回复："..."
   策略：...

2. 针对质疑2：
   回复："..."
   策略：...
"""
