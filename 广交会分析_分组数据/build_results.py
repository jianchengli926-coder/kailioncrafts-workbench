#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build results_batch1_group2.json for 11 Canton Fair hardware customers."""
import json

OUT = "/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/外贸获客AI工作台/广交会分析_分组数据/results_batch1_group2.json"
TS = "2026-10-06T00:00:00Z"

customers = []
drafts = []

def sig(page):
    return ("Best,\n"
            "Leo Li\n"
            "KaiLionCrafts | WhatsApp: +86 131-3800-6564\n"
            f"kailioncrafts.com/{page}")

# ---------- 001 Stampe Metalvare (Denmark) ----------
customers.append({
    "id": "canton_b1_g2_001",
    "company": "Stampe Metalvare",
    "website": "http://www.stampemetal.dk",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "", "title": "", "email": "stampemetal@industri.dk",
                 "phone": "0045 97 56 18 44", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 50, "product": 20, "companyType": 40, "purchaseSignal": 25,
               "contactQuality": 30, "total": 35, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "低意向"],
    "notes": "网站stampemetal.dk已过期/停放(one.com主机页)，无在线内容可查。公司名Metalvare=丹麦语金属制品，地址Frilandsvej 23C, Roedding, DK-7860 Spoettrup(丹麦中部日德兰)。推断为小型金属制品加工/贸易企业。无具名联系人，邮箱为industri.dk企业域名邮箱。具体产品线待确认。曾到139届广交会五金展位。",
    "country": "Denmark",
    "customerType": "制造商",
    "productCategory": "不匹配",
    "products": "金属制品(待确认具体品类)",
    "profile": {
        "business": "丹麦小型金属制品公司，家族经营可能性高(Stampe为常见丹麦姓氏)，地址位于日德兰中部Spøttrup/Rødding一带。规模、产品线待确认。",
        "productLine": "待确认；从公司名Metalvare推断为金属冲压/加工制品",
        "needs": "可能寻找中国金属制品OEM或原材料/五金件供应商",
        "painPoints": "1) 网站已失效，线上存在感弱；2) 无具名采购联系人，触达难；3) 丹麦本地制造成本高",
        "angle": "以阳江产业带OEM、工厂直供价切入，先索取catalog建立联系"
    },
    "backgroundCheck": {
        "companyOverview": "丹麦金属制品公司，具体规模与产品线待确认(网站已过期)",
        "decisionMaker": "未知(无具名联系人)",
        "contactInfo": "邮箱stampemetal@industri.dk，电话0045 97 56 18 44，传真0045 97 56 18 78；来自广交会登记，有效性待确认",
        "painPoints": "网站失效；触达联系人不明；丹麦制造成本高",
        "purchaseIntent": "低 - 无网站、无具名联系人，仅靠广交会登记，采购品类为泛五金",
        "competitorAnalysis": "待确认(网站无内容)",
        "supplyChain": "待确认；丹麦金属制品企业常见从中国/波兰采购五金件",
        "entryPoint": "通用五金OEM/金属件代工，工厂直供价(低于贸易商20%)"
    },
    "portrait": {"intentLevel": "低", "customerType": "制造商", "countryTier": "A",
                 "categoryMatch": "不匹配", "priorityScore": 35,
                 "recommendedStrategy": "低优先级，群发式开发信试探，索取catalog；回复再跟进"},
    "intentCategories": ["综合五金"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 35,
    "companySize": "待确认",
    "decisionMaker": "未知",
    "annualPurchase": ""
})
b1 = ("Dear Sir/Madam,\n\n"
      "I noticed Stampe Metalvare visited the hardware section of the 139th Canton Fair, "
      "and I wanted to reach out directly.\n\n"
      "I'm Leo Li, founder of KaiLionCrafts, a manufacturing partner based in Yangjiang, "
      "China — the region that produces around 75% of China's knives and metal cutlery. "
      "Working with four partner factories on a family-ownership model, we offer OEM/ODM "
      "from 100 pcs, SGS / LFGB / FDA certifications, and factory-direct pricing about "
      "20% below typical trading houses.\n\n"
      "If you ever review supply options for metal components or cutting tools, I'd be "
      "glad to send our catalog. You can reach me anytime on WhatsApp at +86 131-3800-6564.\n\n"
      + sig("oem-odm/"))
drafts.append({
    "id": "draft_canton_b1_g2_001", "customerId": "canton_b1_g2_001",
    "customerName": "Stampe Metalvare", "country": "Denmark", "language": "英语",
    "subject": "Yangjiang OEM hardware partner for Danish metalware",
    "body": b1, "content": b1, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["网站已过期，背调有限，按通用五金OEM角度", "无具名联系人，用Dear Sir/Madam"],
    "subjectOptions": ["Yangjiang OEM hardware partner for Danish metalware",
                       "Cutlery & metal component supply from Yangjiang",
                       "Factory-direct metalware OEM from China"],
    "chineseVersion": "尊敬的先生/女士：\n\n我注意到Stampe Metalvare参观了第139届广交会五金展区，因此直接与您联系。\n\n我是KaiLionCrafts创始人Leo Li，公司位于中国阳江——阳江生产了中国约75%的刀具和金属制品。我们以家族股权模式合作4家工厂，提供100件起订的OEM/ODM服务，具备SGS/LFGB/FDA认证，工厂直供价较贸易商低约20%。\n\n如果贵司在评估金属件或切割工具的供应渠道，我很乐意寄送目录。您可随时通过WhatsApp +86 131-3800-6564联系我。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
    "sellingPointsUsed": ["阳江产业带", "4家合作工厂家族股权", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "工厂直供价低20%"],
    "linksUsed": ["https://kailioncrafts.com/oem-odm/"],
    "wordCount": len(b1.split())
})

# ---------- 002 Soon Aik Hardware (Singapore) ----------
customers.append({
    "id": "canton_b1_g2_002",
    "company": "SOON AIK HARDWARE (PTE) LTD.",
    "website": "http://www.soonaik.com.sg",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "ALBERT CHAN", "title": "", "email": "soonaik@cyberway.com.sg",
                 "phone": "0065 68423822/68426966", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 45, "product": 15, "companyType": 65, "purchaseSignal": 40,
               "contactQuality": 70, "total": 45, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "低意向"],
    "notes": "Soon Aik Group官网(soonaik.com.sg)显示：起源于1970年代初的 spare parts 店，现为汽车及重型机械零配件零售/进口/出口/批发/分销集团。旗下有Autozone零售门店(新加坡Sin Ming、Ang Mo Kio等)、Traczone(滤清器、润滑油、电池、重型柴油发动机B2C零售分销)。业务以汽车后市场为主，非刀剪。联系人Albert Chan。",
    "country": "Singapore",
    "customerType": "分销商",
    "productCategory": "不匹配",
    "products": "汽车零配件、滤清器、润滑油、电池、重型机械零件",
    "profile": {
        "business": "新加坡老牌(1970年代起家)汽车后市场集团，零售+进口+出口+批发+分销一体化，旗下Autozone零售门店、Traczone品牌。",
        "productLine": "汽车/重型机械零配件、滤清器、润滑油、电池",
        "needs": "以汽车零配件为主，五金工具仅为配套；非刀剪目标客户",
        "painPoints": "1) 业务集中在汽车后市场，五金品类有限；2) 多门店零售需要稳定补货",
        "angle": "若其有五金/工具零售需求，可补充切割工具/手动工具OEM；否则维持泛泛联系"
    },
    "backgroundCheck": {
        "companyOverview": "新加坡汽车零配件集团，1970年代起家，集团化运营零售(Autozone)+分销(Traczone)",
        "decisionMaker": "Albert Chan(联系人，职位待确认)",
        "contactInfo": "邮箱soonaik@cyberway.com.sg(ISP邮箱)，电话0065 68423822/68426966，地址12 Tannery Lane Soon Aik Industrial Building",
        "painPoints": "业务聚焦汽车后市场；五金工具非主业",
        "purchaseIntent": "低 - 主业汽车零配件，刀剪/厨房用品不相关",
        "competitorAnalysis": "自有Autozone/Traczone品牌；同时分销其他品牌滤清器、电池",
        "supplyChain": "汽车零配件全球采购；新加坡区域分销枢纽",
        "entryPoint": "通用五金/手动工具OEM补充其零售品类；切入难度较高"
    },
    "portrait": {"intentLevel": "低", "customerType": "分销商", "countryTier": "A",
                 "categoryMatch": "不匹配", "priorityScore": 45,
                 "recommendedStrategy": "低优先级；群发开发信，若回复关注其五金/工具零售线"},
    "intentCategories": ["综合五金"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 45,
    "companySize": "中型(多门店集团)",
    "decisionMaker": "Albert Chan",
    "annualPurchase": ""
})
b2 = ("Dear Albert,\n\n"
      "I came across Soon Aik Group and its Autozone and Traczone retail network while "
      "researching Singaporean hardware distributors visiting the 139th Canton Fair.\n\n"
      "I'm Leo Li from KaiLionCrafts, based in Yangjiang, China's cutlery capital. We "
      "manufacture and OEM hand tools, cutting tools and kitchen metalware for distributors "
      "across 130+ countries — MOQ from 100 pcs, with SGS / LFGB / FDA certifications and "
      "factory-direct pricing about 20% below trading houses. Our founder handles every "
      "account directly, no sales middle layer.\n\n"
      "If you ever want to test a complementary tool or cutting range for your retail stores, "
      "I can send a short catalog. Message me on WhatsApp at +86 131-3800-6564.\n\n"
      + sig("oem-odm/"))
drafts.append({
    "id": "draft_canton_b1_g2_002", "customerId": "canton_b1_g2_002",
    "customerName": "SOON AIK HARDWARE (PTE) LTD.", "country": "Singapore", "language": "英语",
    "subject": "Yangjiang tool & cutlery OEM for Singapore distributors",
    "body": b2, "content": b2, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["主业汽车零配件，五金匹配度低", "提及Autozone/Traczone证明做过功课"],
    "subjectOptions": ["Yangjiang tool & cutlery OEM for Singapore distributors",
                       "Hand-tool & cutting-tool supply from China's cutlery capital",
                       "Factory-direct OEM for your hardware retail range"],
    "chineseVersion": "Albert 您好：\n\n我在研究参观第139届广交会的新加坡五金经销商时，注意到了Soon Aik集团及其Autozone、Traczone零售网络。\n\n我是KaiLionCrafts的Leo Li，位于中国阳江——中国刀剪之都。我们为130多个国家的经销商生产并OEM手动工具、切割工具和厨房金属制品——MOQ 100件起，具备SGS/LFGB/FDA认证，工厂直供价较贸易商低约20%。创始人直接对接每个客户，无销售中间层。\n\n如果贵司想为零售门店补充工具或切割品类，我可寄送简版目录。欢迎WhatsApp联系：+86 131-3800-6564。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
    "sellingPointsUsed": ["阳江产业带", "出口130+国家", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "工厂直供价低20%", "创始人直接对接"],
    "linksUsed": ["https://kailioncrafts.com/oem-odm/"],
    "wordCount": len(b2.split())
})

# ---------- 003 Sing Huat Hardware & Machinery (Singapore) ----------
customers.append({
    "id": "canton_b1_g2_003",
    "company": "Sing Huat Hardware & Machinery Pte Ltd",
    "website": "http://www.singhuat.com",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "Yip Choong Cheong", "title": "", "email": "singhuat@singnet.com.sg",
                 "phone": "0065 62936861", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 55, "product": 25, "companyType": 65, "purchaseSignal": 40,
               "contactQuality": 70, "total": 50, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "低意向"],
    "notes": "官网singhuat.com为Magento工业五金电商，品类极广：磨料、胶粘剂、清洁设备、钻头、电气、紧固件、手动工具(含CUTTING/PLIER/SPANNER)、气动、安全防护、起重、物料搬运、工具车等。总部327-329 Jalan Besar, Singapore。提供技术培训、扭矩校准、售后。是新加坡工业五金分销商+电商。",
    "country": "Singapore",
    "customerType": "分销商",
    "productCategory": "不匹配",
    "products": "工业五金、手动工具、磨料、紧固件、气动工具、安全防护、起重物料",
    "profile": {
        "business": "新加坡老牌工业五金分销商，运营在线商城(Magento)，品类覆盖20+大类，提供技术培训与扭矩校准等增值服务。",
        "productLine": "手动工具(含切割/钳子/扳手)、磨料、钻头、气动、安全、紧固件",
        "needs": "需要持续补充工业手动工具、切割类工具以丰富电商SKU",
        "painPoints": "1) 品类极宽但单品类深度有限；2) 电商需要高性价比补货；3) 工业客户对品质/认证要求高",
        "angle": "其手动工具/CUTTING品类与阳江切割工具相邻，可切入厨刀/剪刀/工业切割工具OEM"
    },
    "backgroundCheck": {
        "companyOverview": "新加坡工业五金分销商+电商，总部Jalan Besar，20+品类，提供培训/校准服务",
        "decisionMaker": "Yip Choong Cheong(联系人，职位待确认)",
        "contactInfo": "邮箱singhuat@singnet.com.sg(ISP邮箱)，电话0065 62936861，地址327/329 Jalan Besar 208981",
        "painPoints": "品类宽需补货；工业客户要求认证；电商价格敏感",
        "purchaseIntent": "低-中 - 工业五金分销商，切割/手动工具相邻但非刀剪",
        "competitorAnalysis": "多品牌分销；电商为B2B模式(需登录报价)",
        "supplyChain": "典型从中国/台湾/日本/德国采购工业工具",
        "entryPoint": "切割类手动工具、剪刀、厨刀OEM补充其CUTTING品类；免费营销素材助其电商上架"
    },
    "portrait": {"intentLevel": "低", "customerType": "分销商", "countryTier": "A",
                 "categoryMatch": "不匹配", "priorityScore": 50,
                 "recommendedStrategy": "中低优先级；以切割工具/剪刀品类切入，附免费产品图/视频素材促上架"},
    "intentCategories": ["综合五金", "剪刀"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 50,
    "companySize": "中型(电商+实体)",
    "decisionMaker": "Yip Choong Cheong",
    "annualPurchase": ""
})
b3 = ("Dear Mr. Yip,\n\n"
      "I was browsing Sing Huat's online catalog and noticed your strong Hand Tool and "
      "Cutting range — that is exactly the space we manufacture in.\n\n"
      "I'm Leo Li, founder of KaiLionCrafts in Yangjiang, China's cutlery capital. We OEM "
      "professional scissors, kitchen knives and hand cutting tools for hardware distributors "
      "in 130+ countries, MOQ from 100 pcs, with SGS / LFGB / FDA certifications. As a bonus, "
      "we provide a free marketing kit — product photos, videos and factory footage — so "
      "your e-commerce team can list new SKUs quickly.\n\n"
      "Would a short catalog of our cutting-tool range be useful? Reach me on WhatsApp at "
      "+86 131-3800-6564.\n\n"
      + sig("professional-scissors/"))
drafts.append({
    "id": "draft_canton_b1_g2_003", "customerId": "canton_b1_g2_003",
    "customerName": "Sing Huat Hardware & Machinery Pte Ltd", "country": "Singapore", "language": "英语",
    "subject": "Cutting tools & scissors OEM for Sing Huat's hand-tool range",
    "body": b3, "content": b3, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["其电商有CUTTING/HAND TOOL品类，相邻度最高", "免费营销素材卖点对电商客户最有效"],
    "subjectOptions": ["Cutting tools & scissors OEM for Sing Huat's hand-tool range",
                       "Professional scissors supply from China's cutlery capital",
                       "New hand-cutting SKUs with free marketing assets"],
    "chineseVersion": "Yip 先生您好：\n\n我浏览了Sing Huat的在线目录，注意到贵司手动工具与切割工具品类很强——这正是我们生产的领域。\n\n我是KaiLionCrafts创始人Leo Li，位于中国阳江——中国刀剪之都。我们为130多个国家的五金经销商OEM专业剪刀、厨刀和手动切割工具，MOQ 100件起，具备SGS/LFGB/FDA认证。此外，我们提供免费营销素材包——产品图、视频和工厂影像——方便贵司电商团队快速上架新品。\n\n不知我们切割工具品类的简版目录是否对您有用？欢迎WhatsApp联系：+86 131-3800-6564。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/professional-scissors/",
    "sellingPointsUsed": ["阳江产业带", "出口130+国家", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "免费营销素材套餐"],
    "linksUsed": ["https://kailioncrafts.com/professional-scissors/"],
    "wordCount": len(b3.split())
})

# ---------- 004 Simon's Hardware & Bath (USA) ----------
customers.append({
    "id": "canton_b1_g2_004",
    "company": "SIMON'S HARDWARE & BATH, INC.",
    "website": "http://www.simons-hardware.com",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "WALTER RESS", "title": "", "email": "wress@simons-hardware.com",
                 "phone": "001 212 532 9220", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 40, "product": 10, "companyType": 55, "purchaseSignal": 30,
               "contactQuality": 80, "total": 40, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "低意向"],
    "notes": "搜索确认：Simon's Hardware & Bath(simonsny.com)是纽约市高端厨房/浴室装饰五金展厅，创立于1908年，服务建筑师、设计师、开发商、承包商和高端业主。代理400+美国及欧洲品牌(Fantini, Hansgrohe, Colonial Bronze, Water Street Brass等)。旗舰展厅421 Third Ave, NY 10016，另有Hamptons分店。属奢侈品展厅/零售商，非大宗商品进口商。",
    "country": "USA",
    "customerType": "五金零售商",
    "productCategory": "不匹配",
    "products": "高端装饰五金、 plumbing卫浴、厨卫配件、家具配饰",
    "profile": {
        "business": "纽约百年(1908)高端厨卫装饰五金展厅，面向设计师/建筑师/豪宅市场，代理400+欧美奢侈品牌。",
        "productLine": "装饰五金、卫浴龙头、厨卫配件、高端furnishings",
        "needs": "以代理欧美奢侈品牌为主，几乎不从中国直接OEM大宗商品",
        "painPoints": "1) 定位高端，与中国OEM价格带错配；2) 客户群追求欧美品牌调性；3) 选品由设计师驱动",
        "angle": "切入难度高；若需高端定制厨刀/手工刀具自有品牌可试探，但预期低"
    },
    "backgroundCheck": {
        "companyOverview": "纽约高端厨卫展厅，1908年创立，代理400+欧美品牌，服务豪宅/建筑师市场",
        "decisionMaker": "Walter Ress(联系人，邮箱wress@simons-hardware.com为个人直邮)",
        "contactInfo": "电话212-532-9220，地址421 Third Ave NY 10016；另Hamptons分店631-297-7822",
        "painPoints": "高端定位与中国OEM错配；品牌调性要求高",
        "purchaseIntent": "低 - 奢侈展厅代理欧美品牌，非中国OEM目标客群",
        "competitorAnalysis": "代理Fantini/Hansgrohe/Colonial Bronze/Water Street Brass等",
        "supplyChain": "美国及欧洲高端制造商",
        "entryPoint": "低优先级；若推高端手工厨刀/定制品牌可邮件试探"
    },
    "portrait": {"intentLevel": "低", "customerType": "五金零售商", "countryTier": "S",
                 "categoryMatch": "不匹配", "priorityScore": 40,
                 "recommendedStrategy": "低优先级；客户质量高(S级美国+直邮联系人)但品类错配，试探性邮件即可"},
    "intentCategories": ["厨房用品"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 40,
    "companySize": "中型(展厅连锁)",
    "decisionMaker": "Walter Ress",
    "annualPurchase": ""
})
b4 = ("Dear Walter,\n\n"
      "I've followed Simon's Hardware & Bath for a while — your 100-year legacy serving "
      "New York's architects and designers is remarkable, and your curated mix of 400+ "
      "European and American brands speaks for itself.\n\n"
      "I'm Leo Li, founder of KaiLionCrafts in Yangjiang, China. We manufacture premium "
      "kitchen knives and cutlery on an OEM / private-label basis, MOQ from 100 pcs, with "
      "SGS / LFGB / FDA certifications. While most of your lines are European, I wanted to "
      "introduce a factory-direct option for a private-label kitchen cutlery range if that "
      "ever fits your assortment.\n\n"
      "Happy to send a curated catalog. You can reach me on WhatsApp at +86 131-3800-6564.\n\n"
      + sig("kitchen-knives/"))
drafts.append({
    "id": "draft_canton_b1_g2_004", "customerId": "canton_b1_g2_004",
    "customerName": "SIMON'S HARDWARE & BATH, INC.", "country": "USA", "language": "英语",
    "subject": "Private-label kitchen cutlery option for Simon's curated range",
    "body": b4, "content": b4, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["高端展厅，语气需克制专业，不硬推", "提及1908历史与400+品牌做个性化"],
    "subjectOptions": ["Private-label kitchen cutlery option for Simon's curated range",
                       "Premium kitchen knife OEM from Yangjiang",
                       "Factory-direct cutlery for your kitchen assortment"],
    "chineseVersion": "Walter 您好：\n\n我一直关注Simon's Hardware & Bath——贵司服务纽约建筑师与设计师的百年传承令人敬佩，精选400+欧美品牌的选品能力有目共睹。\n\n我是KaiLionCrafts创始人Leo Li，位于中国阳江。我们以OEM/自有品牌方式生产高端厨刀和刀具，MOQ 100件起，具备SGS/LFGB/FDA认证。虽然贵司多数产品线来自欧洲，我仍想介绍一个工厂直供选项，供贵司未来若考虑自有品牌厨刀系列时参考。\n\n我很乐意寄送精选目录。欢迎WhatsApp联系：+86 131-3800-6564。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/kitchen-knives/",
    "sellingPointsUsed": ["阳江产业带", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "工厂直供价"],
    "linksUsed": ["https://kailioncrafts.com/kitchen-knives/"],
    "wordCount": len(b4.split())
})

# ---------- 005 Signature Hardware / Design Hardware (USA) ----------
customers.append({
    "id": "canton_b1_g2_005",
    "company": "SIGNATURE HARDWARE",
    "website": "www.designhardware.net",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "MIKE DOWLIN", "title": "", "email": "mikedowlin@aol.com",
                 "phone": "001 6365799904", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 45, "product": 10, "companyType": 45, "purchaseSignal": 25,
               "contactQuality": 55, "total": 35, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "低意向"],
    "notes": "官网designhardware.net显示：Design Hardware是商业级建筑门用五金制造商(闭门器door closer等)，强调speed-to-market、in-house工程设计、field tested、多种finish。客户为分销商(Distribution GM评价)。地址Chesterfield, MO。注意：客户本身是制造商(门用五金)，非刀剪买家。联系邮箱为个人AOL邮箱(mikedowlin@aol.com)，暗示小规模/业主直接运营。",
    "country": "USA",
    "customerType": "制造商",
    "productCategory": "不匹配",
    "products": "商业建筑门用五金(闭门器、门控硬件)",
    "profile": {
        "business": "美国密苏里州Chesterfield的商业级建筑门用五金制造商，in-house设计，面向分销商渠道。",
        "productLine": "闭门器、门控、商业门用五金",
        "needs": "自身为制造商，非刀剪采购方；可能采购原材料/金属配件",
        "painPoints": "1) 自身是品牌制造商，互补品类需求弱；2) 个人AOL邮箱暗示规模小",
        "angle": "切入难度高；泛泛OEM邮件试探"
    },
    "backgroundCheck": {
        "companyOverview": "商业建筑门用五金制造商(闭门器等)，in-house工程，分销渠道",
        "decisionMaker": "Mike Dowlin(联系人，个人AOL邮箱，可能为业主/高管)",
        "contactInfo": "邮箱mikedowlin@aol.com，电话001 6365799904，地址16017 Wilson Manor Drive, Chesterfield MO 63005",
        "painPoints": "自身为制造商；品类与刀剪不相关",
        "purchaseIntent": "低 - 自身制造门用五金，非刀剪买家",
        "competitorAnalysis": "自有Design Hardware品牌；服务分销商",
        "supplyChain": "美国本土制造；可能从中国采购部分金属配件",
        "entryPoint": "低优先级；通用金属件/五金OEM邮件"
    },
    "portrait": {"intentLevel": "低", "customerType": "制造商", "countryTier": "S",
                 "categoryMatch": "不匹配", "priorityScore": 35,
                 "recommendedStrategy": "低优先级；群发试探，不投入过多精力"},
    "intentCategories": ["综合五金"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 35,
    "companySize": "小型(个人邮箱)",
    "decisionMaker": "Mike Dowlin",
    "annualPurchase": ""
})
b5 = ("Dear Mike,\n\n"
      "I noticed Signature Hardware / Design Hardware at the 139th Canton Fair and "
      "appreciated your focus on commercial-grade door hardware with fast speed-to-market.\n\n"
      "I'm Leo Li, founder of KaiLionCrafts in Yangjiang, China's cutlery and metalware "
      "capital. We work as an OEM partner for hardware brands that need factory-direct "
      "metal components, cutting tools or private-label ranges — MOQ from 100 pcs, SGS / "
      "LFGB / FDA certified, and pricing about 20% below trading houses. I handle every "
      "account directly as the founder.\n\n"
      "If you ever evaluate a complementary OEM line or a China sourcing partner, I'd be "
      "glad to share our catalog. WhatsApp: +86 131-3800-6564.\n\n"
      + sig("oem-odm/"))
drafts.append({
    "id": "draft_canton_b1_g2_005", "customerId": "canton_b1_g2_005",
    "customerName": "SIGNATURE HARDWARE", "country": "USA", "language": "英语",
    "subject": "China OEM partner for hardware brands — Yangjiang factory direct",
    "body": b5, "content": b5, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["客户自身是门用五金制造商，泛泛OEM角度", "个人AOL邮箱，语气可直接"],
    "subjectOptions": ["China OEM partner for hardware brands — Yangjiang factory direct",
                       "Factory-direct metal component OEM from Yangjiang",
                       "Private-label hardware supply at 20% below trading houses"],
    "chineseVersion": "Mike 您好：\n\n我在第139届广交会上注意到Signature Hardware / Design Hardware，欣赏贵司专注商业级门用五金并强调快速上市。\n\n我是KaiLionCrafts创始人Leo Li，位于中国阳江——中国刀剪与金属制品之都。我们为需要工厂直供金属件、切割工具或自有品牌系列的五金品牌做OEM伙伴——MOQ 100件起，SGS/LFGB/FDA认证，价格较贸易商低约20%。我作为创始人直接对接每个客户。\n\n如果贵司未来评估互补OEM产线或中国采购伙伴，我很乐意分享目录。WhatsApp：+86 131-3800-6564。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
    "sellingPointsUsed": ["阳江产业带", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "工厂直供价低20%", "创始人直接对接"],
    "linksUsed": ["https://kailioncrafts.com/oem-odm/"],
    "wordCount": len(b5.split())
})

# ---------- 006 Sierra Wholesale Hardware (USA) ----------
customers.append({
    "id": "canton_b1_g2_006",
    "company": "SIERRA WHOLESALE HARDWARE INC.",
    "website": "http://www.sierrahardware.com",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "HAROLD H. HAHN", "title": "", "email": "sierrahardware@sierrahardware.com",
                 "phone": "001 909 8848644", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 55, "product": 15, "companyType": 70, "purchaseSignal": 35,
               "contactQuality": 65, "total": 48, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "低意向"],
    "notes": "官网sierrahardware.com仍在建(awesome idea页面)。搜索(YellowBot)确认：Sierra Wholesale Hardware位于280 E Drake Dr, San Bernardino, CA 92408，电话909-386-1201，主营Builders Hardware、Building Materials、门窗(Doors/Frames)、Steel Doors、建筑材料批发、政府承包商。属建筑五金批发商。",
    "country": "USA",
    "customerType": "分销商",
    "productCategory": "不匹配",
    "products": "建筑五金、建材、门窗、钢门",
    "profile": {
        "business": "美国加州San Bernardino的建筑五金批发商，服务建筑商、政府承包商，主营门窗、建材、建筑五金。",
        "productLine": "Builders hardware、门窗、钢门、建材批发",
        "needs": "批发商需要高性价比货源，可能补充手动工具/切割工具线",
        "painPoints": "1) 网站在建，线上化刚起步；2) 批发价格敏感",
        "angle": "批发商属性好(高companyType)，以工厂直供价、一站式采购切入"
    },
    "backgroundCheck": {
        "companyOverview": "加州San Bernardino建筑五金批发商，主营门窗/建材/建筑五金，服务承包商与政府项目",
        "decisionMaker": "Harold H. Hahn(联系人)",
        "contactInfo": "邮箱sierrahardware@sierrahardware.com，电话001 909 8848644，地址P.O. Box 5158 San Bernardino CA 92412",
        "painPoints": "网站在建；价格敏感；品类以建材门窗为主",
        "purchaseIntent": "低 - 建筑五金批发，非刀剪",
        "competitorAnalysis": "区域批发商，品牌待确认",
        "supplyChain": "美国本土+可能从中国进口门窗五金/紧固件",
        "entryPoint": "工厂直供价、一站式五金采购、免费营销素材"
    },
    "portrait": {"intentLevel": "低", "customerType": "分销商", "countryTier": "S",
                 "categoryMatch": "不匹配", "priorityScore": 48,
                 "recommendedStrategy": "中低优先级；批发商属性较好，以工厂直供价+一站式采购切入"},
    "intentCategories": ["综合五金"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 48,
    "companySize": "中型(批发)",
    "decisionMaker": "Harold H. Hahn",
    "annualPurchase": ""
})
b6 = ("Dear Harold,\n\n"
      "I came across Sierra Wholesale Hardware while researching US builders-hardware "
      "wholesalers at the 139th Canton Fair.\n\n"
      "I'm Leo Li, founder of KaiLionCrafts in Yangjiang, China's cutlery and metalware "
      "capital. We supply wholesalers with factory-direct hand tools, cutting tools, knives "
      "and kitchen metalware — MOQ from 100 pcs, SGS / LFGB / FDA certified, pricing about "
      "20% below typical trading houses. As a one-stop partner, we can bundle outdoor knives, "
      "kitchen knives, scissors and kitchen accessories into one shipment.\n\n"
      "If you'd like to compare a factory-direct quote, I can send our catalog. WhatsApp: "
      "+86 131-3800-6564.\n\n"
      + sig("oem-odm/"))
drafts.append({
    "id": "draft_canton_b1_g2_006", "customerId": "canton_b1_g2_006",
    "customerName": "SIERRA WHOLESALE HARDWARE INC.", "country": "USA", "language": "英语",
    "subject": "Factory-direct hand tools & cutlery for US hardware wholesalers",
    "body": b6, "content": b6, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["批发商属性好，强调工厂直供价+一站式拼柜", "网站在建，背调来自YellowBot"],
    "subjectOptions": ["Factory-direct hand tools & cutlery for US hardware wholesalers",
                       "One-stop cutlery & hardware supply from Yangjiang",
                       "Wholesale pricing 20% below trading houses — Yangjiang"],
    "chineseVersion": "Harold 您好：\n\n我在研究第139届广交会的美国建筑五金批发商时注意到了Sierra Wholesale Hardware。\n\n我是KaiLionCrafts创始人Leo Li，位于中国阳江——中国刀剪与金属制品之都。我们以工厂直供方式为批发商提供手动工具、切割工具、刀具和厨房金属制品——MOQ 100件起，SGS/LFGB/FDA认证，价格较贸易商低约20%。作为一站式伙伴，我们可将户外刀、厨刀、剪刀和厨房用品拼为一个货柜。\n\n如果贵司想比较工厂直供报价，我可寄送目录。WhatsApp：+86 131-3800-6564。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
    "sellingPointsUsed": ["阳江产业带", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "工厂直供价低20%", "一站式采购"],
    "linksUsed": ["https://kailioncrafts.com/oem-odm/"],
    "wordCount": len(b6.split())
})

# ---------- 007 Shepherd Hardware (USA) ----------
customers.append({
    "id": "canton_b1_g2_007",
    "company": "SHEPHERD HARDWARE LLC",
    "website": "www.shepherdhardware.com",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "JEFF WESOLOWSKI", "title": "", "email": "customerservice@shepherdhardware.com",
                 "phone": "001 269 756 3830", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 40, "product": 5, "companyType": 50, "purchaseSignal": 25,
               "contactQuality": 50, "total": 32, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "低意向"],
    "notes": "官网shepherdhardware.com：Shepherd Hardware是Colson Group(芝加哥)旗下部门，1950年代起，北美脚轮(caster)与地面保护/表面防护产品领导者。主营脚轮、毛毡垫(felt)、车库挂钩、搬运车(dolly)、家具腿套。品牌商/制造商，非刀剪买家。邮箱为通用客服邮箱。",
    "country": "USA",
    "customerType": "品牌商",
    "productCategory": "不匹配",
    "products": "脚轮、毛毡垫、地面保护、车库挂钩、搬运车",
    "profile": {
        "business": "Colson Group(芝加哥)旗下品牌，北美脚轮与表面防护产品领导者，1950年代起家，Three Oaks, MI。",
        "productLine": "脚轮、毛毡、地面保护、车库收纳挂钩、搬运车",
        "needs": "品牌商全球采购，但品类为脚轮/表面防护，与刀剪不相关",
        "painPoints": "1) 品类高度聚焦(脚轮/防护)；2) 自有品牌，互补需求弱",
        "angle": "切入难度高；泛泛品牌商OEM邮件"
    },
    "backgroundCheck": {
        "companyOverview": "Colson Group旗下品牌，脚轮与地面防护产品北美领导者",
        "decisionMaker": "Jeff Wesolowski(联系人；邮箱为通用customerservice)",
        "contactInfo": "电话269-756-3830，地址6961 US Highway 12, Three Oaks, MI 49128",
        "painPoints": "品类聚焦脚轮/表面防护；非刀剪",
        "purchaseIntent": "低 - 自有品牌脚轮制造商，非刀剪买家",
        "competitorAnalysis": "自有Shepherd品牌；母公司Colson Group",
        "supplyChain": "全球采购(Colson集团)，可能从中国/越南采购脚轮组件",
        "entryPoint": "低优先级；若其扩展家居五金线可补充厨刀/工具"
    },
    "portrait": {"intentLevel": "低", "customerType": "品牌商", "countryTier": "S",
                 "categoryMatch": "不匹配", "priorityScore": 32,
                 "recommendedStrategy": "低优先级；品牌商但品类错配，群发试探"},
    "intentCategories": ["综合五金"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 32,
    "companySize": "中型(集团旗下)",
    "decisionMaker": "Jeff Wesolowski",
    "annualPurchase": ""
})
b7 = ("Dear Jeff,\n\n"
      "I've followed Shepherd Hardware's caster and surface-protection line — your "
      "50-year leadership in North American floor care products is impressive.\n\n"
      "I'm Leo Li, founder of KaiLionCrafts in Yangjiang, China's cutlery capital. We "
      "manufacture on an OEM / private-label basis for hardware brands that want to add "
      "cutting tools, kitchen knives or metalware to their assortment — MOQ from 100 pcs, "
      "SGS / LFGB / FDA certified, with factory-direct pricing about 20% below trading "
      "houses. We also supply free product photos and videos to support brand partners.\n\n"
      "If you ever consider a complementary hand-tool or kitchen range, I'd be glad to send "
      "a catalog. WhatsApp: +86 131-3800-6564.\n\n"
      + sig("oem-odm/"))
drafts.append({
    "id": "draft_canton_b1_g2_007", "customerId": "canton_b1_g2_007",
    "customerName": "SHEPHERD HARDWARE LLC", "country": "USA", "language": "英语",
    "subject": "Private-label OEM for hardware brands — Yangjiang factory",
    "body": b7, "content": b7, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["Colson集团旗下脚轮品牌，品类错配", "提及50年历史做个性化"],
    "subjectOptions": ["Private-label OEM for hardware brands — Yangjiang factory",
                       "Cutting tools & kitchen knives OEM for hardware brands",
                       "Free product assets with factory-direct cutlery OEM"],
    "chineseVersion": "Jeff 您好：\n\n我一直关注Shepherd Hardware的脚轮与表面防护产品线——贵司在北美地面防护领域50年的领导地位令人敬佩。\n\n我是KaiLionCrafts创始人Leo Li，位于中国阳江——中国刀剪之都。我们为希望在产品组合中增加切割工具、厨刀或金属制品的五金品牌提供OEM/自有品牌制造——MOQ 100件起，SGS/LFGB/FDA认证，工厂直供价较贸易商低约20%。我们还为品牌伙伴提供免费产品图和视频。\n\n如果贵司未来考虑互补的手动工具或厨房系列，我很乐意寄送目录。WhatsApp：+86 131-3800-6564。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
    "sellingPointsUsed": ["阳江产业带", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "工厂直供价低20%", "免费营销素材"],
    "linksUsed": ["https://kailioncrafts.com/oem-odm/"],
    "wordCount": len(b7.split())
})

# ---------- 008 Sheng Lee Hardware & Trading (Singapore) ----------
customers.append({
    "id": "canton_b1_g2_008",
    "company": "SHENG LEE HARDWARE & TRADING",
    "website": "http://www.shenglee.com",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "NG CHEE HER(RICHARD)", "title": "", "email": "shenglee@pacific.net.sg",
                 "phone": "0065 67529866/96386798", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 40, "product": 10, "companyType": 45, "purchaseSignal": 25,
               "contactQuality": 70, "total": 38, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "低意向"],
    "notes": "官网shenglee.com：新加坡领先的wrought iron(熟铁/铁艺)加工与贸易公司，主营定制铁艺门、格栅、大门、楼梯；采用德国进口机器，$800以上免费安装。同时销售户外家具套装、墙面艺术。属铁艺定制加工商/零售商。",
    "country": "Singapore",
    "customerType": "五金零售商",
    "productCategory": "不匹配",
    "products": "定制铁艺门/格栅/大门/楼梯、户外家具、墙面艺术",
    "profile": {
        "business": "新加坡铁艺定制加工与贸易商，服务住宅安防(门/格栅/楼梯)，兼售户外家具与墙面装饰。",
        "productLine": "熟铁构件、定制铁艺门窗、户外家具",
        "needs": "定制铁艺为主，兼售户外家具；与刀剪不相关",
        "painPoints": "1) 定制铁艺为主业；2) 兼营户外家具可能需补充品类",
        "angle": "切入难；泛泛五金/金属制品OEM"
    },
    "backgroundCheck": {
        "companyOverview": "新加坡铁艺定制专家，德国设备，服务住宅安防与装饰",
        "decisionMaker": "Ng Chee Her (Richard)(联系人)",
        "contactInfo": "邮箱shenglee@pacific.net.sg(ISP邮箱)，电话0065 67529866/96386798，地址Blk 22 Woodlands Link #01-57/58",
        "painPoints": "定制铁艺为主；品类与刀剪不相关",
        "purchaseIntent": "低 - 铁艺加工/家具零售，非刀剪",
        "competitorAnalysis": "自有铁艺品牌；兼售家具",
        "supplyChain": "铁艺件本地加工；家具可能从中国/东南亚采购",
        "entryPoint": "低优先级；若户外家具线扩展可切入"
    },
    "portrait": {"intentLevel": "低", "customerType": "五金零售商", "countryTier": "A",
                 "categoryMatch": "不匹配", "priorityScore": 38,
                 "recommendedStrategy": "低优先级；群发试探"},
    "intentCategories": ["综合五金"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 38,
    "companySize": "小型(定制加工)",
    "decisionMaker": "Ng Chee Her (Richard)",
    "annualPurchase": ""
})
b8 = ("Dear Richard,\n\n"
      "I came across Sheng Lee Hardware & Trading at the 139th Canton Fair and appreciated "
      "your reputation as Singapore's wrought-iron specialist for custom doors, grilles and "
      "staircases.\n\n"
      "I'm Leo Li, founder of KaiLionCrafts in Yangjiang, China's metalware capital. We "
      "OEM metal products, cutting tools, knives and kitchen metalware for hardware traders "
      "and retailers — MOQ from 100 pcs, SGS / LFGB / FDA certified, with factory-direct "
      "pricing about 20% below trading houses. If you ever add a complementary metal or "
      "cutting line alongside your furniture range, we're a flexible partner.\n\n"
      "Happy to share our catalog. WhatsApp: +86 131-3800-6564.\n\n"
      + sig("oem-odm/"))
drafts.append({
    "id": "draft_canton_b1_g2_008", "customerId": "canton_b1_g2_008",
    "customerName": "SHENG LEE HARDWARE & TRADING", "country": "Singapore", "language": "英语",
    "subject": "Yangjiang metalware OEM partner for hardware traders",
    "body": b8, "content": b8, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["铁艺定制商，品类错配", "提及铁艺专家做个性化"],
    "subjectOptions": ["Yangjiang metalware OEM partner for hardware traders",
                       "Factory-direct cutting tools & metalware from China",
                       "Flexible OEM supply for your hardware range"],
    "chineseVersion": "Richard 您好：\n\n我在第139届广交会上注意到Sheng Lee Hardware & Trading，欣赏贵司作为新加坡铁艺专家在定制门、格栅和楼梯领域的声誉。\n\n我是KaiLionCrafts创始人Leo Li，位于中国阳江——中国金属制品之都。我们为五金贸易商和零售商OEM金属制品、切割工具、刀具和厨房金属制品——MOQ 100件起，SGS/LFGB/FDA认证，工厂直供价较贸易商低约20%。如果贵司未来在家具产品线之外补充金属或切割品类，我们是灵活的伙伴。\n\n我很乐意分享目录。WhatsApp：+86 131-3800-6564。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
    "sellingPointsUsed": ["阳江产业带", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "工厂直供价低20%"],
    "linksUsed": ["https://kailioncrafts.com/oem-odm/"],
    "wordCount": len(b8.split())
})

# ---------- 009 Shanghai Tong Lee (Singapore) ----------
customers.append({
    "id": "canton_b1_g2_009",
    "company": "SHANGHAI TONG LEE HARDWARE PTE. LTD.",
    "website": "WWW.SHANGHAITONGLEE.COM.SG",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "JACOB TEE", "title": "", "email": "sales@shanghaitonglee.com.sg",
                 "phone": "0065 62917288/97633377", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 55, "product": 20, "companyType": 65, "purchaseSignal": 35,
               "contactQuality": 65, "total": 47, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "低意向"],
    "notes": "官网shanghaitonglee.com.sg：Shanghai Tong Lee自1936年起为新加坡建筑五金与家具配件专家。产品包括厨房橱柜拉篮(organized pull-out baskets)、门锁(door locks)、建筑五金、家具配件。老牌(1936)建筑/家具五金分销商。",
    "country": "Singapore",
    "customerType": "分销商",
    "productCategory": "不匹配",
    "products": "建筑五金、家具配件、厨房橱柜拉篮、门锁",
    "profile": {
        "business": "新加坡老牌(1936)建筑五金与家具配件分销商，服务橱柜/建筑/家具行业。",
        "productLine": "橱柜拉篮、门锁、建筑五金、家具配件",
        "needs": "厨房橱柜配件与厨房用品相邻，可能补充厨房小工具/厨刀",
        "painPoints": "1) 品类以建筑/家具五金为主；2) 厨房用品仅橱柜收纳",
        "angle": "厨房橱柜配件相邻度较高，可切入厨房用品/厨刀配套"
    },
    "backgroundCheck": {
        "companyOverview": "1936年创立的新加坡建筑五金与家具配件分销商，近90年历史",
        "decisionMaker": "Jacob Tee(联系人)",
        "contactInfo": "邮箱sales@shanghaitonglee.com.sg，电话0065 62917288/97633377，地址200 Jalan Sultan #01-01 Textile Centre 199018",
        "painPoints": "厨房品类仅限橱柜收纳；需补充厨房用品",
        "purchaseIntent": "低-中 - 建筑五金分销，厨房配件相邻",
        "competitorAnalysis": "多品牌分销建筑/家具五金",
        "supplyChain": "欧洲/台湾/中国建筑五金品牌",
        "entryPoint": "厨房用品/厨刀与橱柜拉篮配套销售；免费营销素材"
    },
    "portrait": {"intentLevel": "低", "customerType": "分销商", "countryTier": "A",
                 "categoryMatch": "不匹配", "priorityScore": 47,
                 "recommendedStrategy": "中低优先级；以厨房用品/厨刀配套橱柜拉篮切入"},
    "intentCategories": ["厨房用品"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 47,
    "companySize": "中型(老牌分销)",
    "decisionMaker": "Jacob Tee",
    "annualPurchase": ""
})
b9 = ("Dear Jacob,\n\n"
      "I was impressed by Shanghai Tong Lee's nearly 90-year history as Singapore's "
      "architecture hardware and furniture fittings specialist, and your kitchen cabinet "
      "organizer range.\n\n"
      "I'm Leo Li, founder of KaiLionCrafts in Yangjiang, China's cutlery capital. We "
      "manufacture kitchen knives, kitchen accessories and scissors on an OEM / private-label "
      "basis — MOQ from 100 pcs, SGS / LFGB / FDA certified, factory-direct pricing about "
      "20% below trading houses. These naturally complement cabinet organizer lines, and we "
      "provide free product photos and videos to support your catalog.\n\n"
      "Would a short kitchen-range catalog be useful? Reach me on WhatsApp at "
      "+86 131-3800-6564.\n\n"
      + sig("kitchen-accessories/"))
drafts.append({
    "id": "draft_canton_b1_g2_009", "customerId": "canton_b1_g2_009",
    "customerName": "SHANGHAI TONG LEE HARDWARE PTE. LTD.", "country": "Singapore", "language": "英语",
    "subject": "Kitchen knives & accessories to complement your cabinet organizers",
    "body": b9, "content": b9, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["橱柜拉篮与厨房用品相邻，切入角度自然", "提及1936历史做个性化"],
    "subjectOptions": ["Kitchen knives & accessories to complement your cabinet organizers",
                       "OEM kitchen range from China's cutlery capital",
                       "Free product assets for your kitchen hardware catalog"],
    "chineseVersion": "Jacob 您好：\n\nShanghai Tong Lee作为新加坡建筑五金与家具配件专家近90年的历史令人敬佩，贵司的厨房橱柜拉篮产品线也很有特色。\n\n我是KaiLionCrafts创始人Leo Li，位于中国阳江——中国刀剪之都。我们以OEM/自有品牌方式生产厨刀、厨房用品和剪刀——MOQ 100件起，SGS/LFGB/FDA认证，工厂直供价较贸易商低约20%。这些产品与橱柜收纳系列天然配套，我们还提供免费产品图和视频支持贵司目录。\n\n不知我们厨房系列的简版目录是否对您有用？欢迎WhatsApp联系：+86 131-3800-6564。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/kitchen-accessories/",
    "sellingPointsUsed": ["阳江产业带", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "工厂直供价低20%", "免费营销素材"],
    "linksUsed": ["https://kailioncrafts.com/kitchen-accessories/"],
    "wordCount": len(b9.split())
})

# ---------- 010 Seawalk Hardware Trading (Singapore) ----------
customers.append({
    "id": "canton_b1_g2_010",
    "company": "SEAWALK HARDWARE TRADING PTE LTD",
    "website": "WWW.SEAWALKHARDWARE.COM",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "CAREN CHEN", "title": "", "email": "purchase@seawalkhardware.com",
                 "phone": "0065 67442328", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 60, "product": 25, "companyType": 70, "purchaseSignal": 65,
               "contactQuality": 75, "total": 58, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "中意向"],
    "notes": "官网seawalkhardware.com：'Your One Stop Hardware Supply'，服务builder/handyman/home innovator。品类：家具五金、建筑五金、工业五金、家居、通用、清仓。热销品：APLUS品牌气钉枪/码钉枪/无线钉枪、10J气钉、自攻螺丝、HLL膨胀管、尼龙墙塞、laminate cutter。自有品牌'SEAWALK HARDWARE 海步五金'(中文名暗示中国采购)。邮箱为purchase@专用采购邮箱——强采购信号。本组中最有潜力。",
    "country": "Singapore",
    "customerType": "分销商",
    "productCategory": "不匹配",
    "products": "气动工具、钉枪、螺丝、膨胀管、墙塞、建筑五金",
    "profile": {
        "business": "新加坡一站式五金供应商，自有品牌(海步五金/APLUS)，服务建筑商/handyman/家庭翻新，明显从中国采购自有品牌产品。",
        "productLine": "气动钉枪、紧固件(螺丝/膨胀管/墙塞)、建筑五金、laminate cutter",
        "needs": "自有品牌需要持续的中国OEM货源；purchase@邮箱说明有专职采购",
        "painPoints": "1) 自有品牌需稳定OEM工厂；2) 需要产品图/视频支持零售；3) 多品类拼柜需求",
        "angle": "自有品牌OEM+免费营销素材+工厂打客户Logo视频，最对路"
    },
    "backgroundCheck": {
        "companyOverview": "新加坡一站式五金贸易商，自有品牌(海步五金/APLUS)，中国采购特征明显",
        "decisionMaker": "Caren Chen(联系人；purchase@专用采购邮箱，强信号)",
        "contactInfo": "邮箱purchase@seawalkhardware.com，电话0065 6744 2328，地址223 Kaki Bukit Ave 1 Shun Li Industrial Park 416046",
        "painPoints": "自有品牌需OEM工厂；需要营销素材；多品类拼柜",
        "purchaseIntent": "中 - 自有品牌+采购专用邮箱，明显从中国OEM采购",
        "competitorAnalysis": "自有APLUS/海步品牌；分销WCSCO等",
        "supplyChain": "明显从中国采购(海步五金中文名、APLUS工具)",
        "entryPoint": "自有品牌OEM、工厂宣传片打客户Logo、免费产品图/视频、一站式拼柜"
    },
    "portrait": {"intentLevel": "中", "customerType": "分销商", "countryTier": "A",
                 "categoryMatch": "不匹配", "priorityScore": 58,
                 "recommendedStrategy": "本组最高优先级；自有品牌OEM角度，突出免费营销素材+客户Logo工厂视频，争取样品订单"},
    "intentCategories": ["综合五金", "厨房用品"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 58,
    "companySize": "中型(自有品牌贸易)",
    "decisionMaker": "Caren Chen",
    "annualPurchase": ""
})
b10 = ("Dear Caren,\n\n"
      "I noticed Seawalk Hardware's own-brand range — the APLUS air tools and the 海步 "
      "Seawalk brand — and it's clear you already source private-label products directly "
      "from China. That's exactly what we do best.\n\n"
      "I'm Leo Li, founder of KaiLionCrafts in Yangjiang, China's cutlery capital. We run "
      "four partner factories on a family-ownership model and OEM private-label hand tools, "
      "cutting tools, knives and kitchen metalware — MOQ from 100 pcs, SGS / LFGB / FDA "
      "certified, factory-direct pricing about 20% below trading houses. We also give brand "
      "partners a free marketing kit — product photos, videos, and even a factory promo "
      "video shot with your logo.\n\n"
      "Could I send our catalog and arrange a sample? Message me on WhatsApp at "
      "+86 131-3800-6564.\n\n"
      + sig("oem-odm/"))
drafts.append({
    "id": "draft_canton_b1_g2_010", "customerId": "canton_b1_g2_010",
    "customerName": "SEAWALK HARDWARE TRADING PTE LTD", "country": "Singapore", "language": "英语",
    "subject": "Private-label OEM partner for Seawalk's own-brand hardware",
    "body": b10, "content": b10, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["本组最佳：自有品牌+采购专用邮箱", "突出免费营销素材+客户Logo工厂视频", "直接请求样品"],
    "subjectOptions": ["Private-label OEM partner for Seawalk's own-brand hardware",
                       "Yangjiang factory direct for your own-brand tool range",
                       "Free marketing kit + factory video with your logo"],
    "chineseVersion": "Caren 您好：\n\n我注意到Seawalk Hardware的自有品牌系列——APLUS气动工具和海步Seawalk品牌——显然贵司已直接从中国采购自有品牌产品。这正是我们最擅长的。\n\n我是KaiLionCrafts创始人Leo Li，位于中国阳江——中国刀剪之都。我们以家族股权模式运营4家合作工厂，OEM自有品牌手动工具、切割工具、刀具和厨房金属制品——MOQ 100件起，SGS/LFGB/FDA认证，工厂直供价较贸易商低约20%。我们还为品牌伙伴提供免费营销素材包——产品图、视频，甚至带贵司Logo的工厂宣传片。\n\n我能否寄送目录并安排样品？欢迎WhatsApp联系：+86 131-3800-6564。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
    "sellingPointsUsed": ["阳江产业带", "4家合作工厂家族股权", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "工厂直供价低20%", "免费营销素材", "工厂宣传片打客户Logo"],
    "linksUsed": ["https://kailioncrafts.com/oem-odm/"],
    "wordCount": len(b10.split())
})

# ---------- 011 MPA Tools (Italy) ----------
customers.append({
    "id": "canton_b1_g2_011",
    "company": "MPA TOOLS",
    "website": "www.mpatools.it",
    "source": "广交会139届-五金制品",
    "type": "潜在客户",
    "status": "待开发",
    "createdAt": TS,
    "contact": {"name": "STEFANO PALLADINI", "title": "", "email": "mpatools@caltanet.it",
                 "phone": "0039 06 98579090", "whatsapp": "", "linkedin": ""},
    "scores": {"industry": 50, "product": 20, "companyType": 50, "purchaseSignal": 30,
               "contactQuality": 60, "total": 40, "grade": "C"},
    "tags": ["广交会139届", "五金工具", "低意向"],
    "notes": "官网mpatools.it已失效(link dead)。地址Via del Tridente 23, 00048 Nettuno (Roma)。联系人Stefano Palladini，邮箱mpatools@caltanet.it/caltanet.it为意大利ISP邮箱。从公司名'Tools'与地址推断为罗马Nettuno地区的工具经销商/五金店(ferramenta/utensileria)。注：搜索到的'利MPA'(Euromagroup旗下多轴头制造商)为不同公司，不应混淆。具体产品线待确认。",
    "country": "Italy",
    "customerType": "分销商",
    "productCategory": "不匹配",
    "products": "工具(待确认，推断为手动/电动工具经销)",
    "profile": {
        "business": "意大利罗马省Nettuno的工具类公司，推断为工具经销/五金店；具体规模与产品线待确认(网站已失效)。",
        "productLine": "待确认；从公司名推断为手动/电动工具",
        "needs": "可能寻找高性价比中国工具货源",
        "painPoints": "1) 网站失效，线上存在感弱；2) 具体品类待确认",
        "angle": "通用手动工具/切割工具OEM试探"
    },
    "backgroundCheck": {
        "companyOverview": "意大利Nettuno(罗马)工具公司，网站已失效，待确认是经销还是制造",
        "decisionMaker": "Stefano Palladini(联系人)",
        "contactInfo": "邮箱mpatools@caltanet.it，电话0039 06 98579090，地址Via del Tridente 23, 00048 Nettuno (Roma)",
        "painPoints": "网站失效；品类待确认",
        "purchaseIntent": "低 - 网站失效，仅靠广交会登记",
        "competitorAnalysis": "待确认",
        "supplyChain": "意大利工具经销商常见从中国/台湾采购",
        "entryPoint": "通用手动/切割工具OEM，工厂直供价"
    },
    "portrait": {"intentLevel": "低", "customerType": "分销商", "countryTier": "A",
                 "categoryMatch": "不匹配", "priorityScore": 40,
                 "recommendedStrategy": "低优先级；群发开发信试探，回复再深入"},
    "intentCategories": ["综合五金"],
    "leadSource": "广交会139届-五金制品",
    "leadScore": 40,
    "companySize": "待确认",
    "decisionMaker": "Stefano Palladini",
    "annualPurchase": ""
})
b11 = ("Dear Stefano,\n\n"
      "I came across MPA Tools at the 139th Canton Fair and wanted to introduce our "
      "manufacturing base here in China.\n\n"
      "I'm Leo Li, founder of KaiLionCrafts in Yangjiang, the city that produces around 75% "
      "of China's knives and metalware. We OEM hand tools, cutting tools, scissors and kitchen "
      "metalware for distributors across 130+ countries — MOQ from 100 pcs, SGS / LFGB / FDA "
      "certified, and factory-direct pricing about 20% below trading houses. I handle every "
      "account directly as the founder.\n\n"
      "If you'd like to compare a factory-direct quote for your tool range, I can send our "
      "catalog. WhatsApp: +86 131-3800-6564.\n\n"
      + sig("oem-odm/"))
drafts.append({
    "id": "draft_canton_b1_g2_011", "customerId": "canton_b1_g2_011",
    "customerName": "MPA TOOLS", "country": "Italy", "language": "英语",
    "subject": "Yangjiang hand tools & cutting tools OEM for Italian distributors",
    "body": b11, "content": b11, "status": "待检查", "createdAt": TS, "sentAt": None,
    "aiNotes": ["网站失效，背调有限", "注意与Euromagroup的MPA(机床部件)区分，未混淆"],
    "subjectOptions": ["Yangjiang hand tools & cutting tools OEM for Italian distributors",
                       "Cutting tools & scissors factory-direct from China",
                       "OEM tool supply at 20% below trading houses"],
    "chineseVersion": "Stefano 您好：\n\n我在第139届广交会上注意到MPA Tools，想向您介绍我们在中国的制造基地。\n\n我是KaiLionCrafts创始人Leo Li，位于阳江——中国约75%的刀剪和金属制品产自这里。我们为130多个国家的经销商OEM手动工具、切割工具、剪刀和厨房金属制品——MOQ 100件起，SGS/LFGB/FDA认证，工厂直供价较贸易商低约20%。我作为创始人直接对接每个客户。\n\n如果贵司想为工具产品线比较工厂直供报价，我可寄送目录。WhatsApp：+86 131-3800-6564。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
    "sellingPointsUsed": ["阳江产业带", "出口130+国家", "OEM/ODM MOQ100起", "SGS LFGB FDA认证", "工厂直供价低20%", "创始人直接对接"],
    "linksUsed": ["https://kailioncrafts.com/oem-odm/"],
    "wordCount": len(b11.split())
})

data = {"customers": customers, "drafts": drafts}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

# Quick validation summary
print("customers:", len(customers))
print("drafts:", len(drafts))
for d in drafts:
    wc = d["wordCount"]
    flag = "OK" if wc <= 150 else "OVER!"
    print(f"  {d['id']}: {wc} words {flag}")
