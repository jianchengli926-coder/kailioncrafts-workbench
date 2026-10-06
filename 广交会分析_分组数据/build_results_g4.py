#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build results_batch1_group4.json — 14 Canton Fair hardware customer profiles + drafts."""
import json

CUSTOMERS = []
DRAFTS = []

def cust(i, company, website, country, country_tier, contact_name, contact_title, email, phone,
         industry, product, company_type_score, purchase_signal, contact_quality, grade,
         tags, notes, customer_type, product_category, products, profile, bg, portrait,
         intent_categories, lead_score, company_size, decision_maker, annual_purchase,
         whatsapp="", linkedin=""):
    total = round((industry + product + company_type_score + purchase_signal + contact_quality) / 5)
    CUSTOMERS.append({
        "id": f"canton_b1_g4_{i:03d}",
        "company": company,
        "website": website,
        "source": "广交会139届-五金制品",
        "type": "潜在客户",
        "status": "待开发",
        "createdAt": "2026-10-06T00:00:00Z",
        "contact": {
            "name": contact_name,
            "title": contact_title,
            "email": email,
            "phone": phone,
            "whatsapp": whatsapp,
            "linkedin": linkedin
        },
        "scores": {
            "industry": industry,
            "product": product,
            "companyType": company_type_score,
            "purchaseSignal": purchase_signal,
            "contactQuality": contact_quality,
            "total": total,
            "grade": grade
        },
        "tags": tags,
        "notes": notes,
        "country": country,
        "customerType": customer_type,
        "productCategory": product_category,
        "products": products,
        "profile": profile,
        "backgroundCheck": bg,
        "portrait": portrait,
        "intentCategories": intent_categories,
        "leadSource": "广交会139届-五金制品",
        "leadScore": lead_score,
        "companySize": company_size,
        "decisionMaker": decision_maker,
        "annualPurchase": annual_purchase
    })
    return total

def draft(i, customer_name, country, subject, body, ai_notes, subject_options,
          chinese_version, selling_points_used, links_used, word_count):
    DRAFTS.append({
        "id": f"draft_canton_b1_g4_{i:03d}",
        "customerId": f"canton_b1_g4_{i:03d}",
        "customerName": customer_name,
        "country": country,
        "language": "英语",
        "subject": subject,
        "body": body,
        "content": body,
        "status": "待检查",
        "createdAt": "2026-10-06T00:00:00Z",
        "sentAt": None,
        "aiNotes": ai_notes,
        "subjectOptions": subject_options,
        "chineseVersion": chinese_version,
        "sellingPointsUsed": selling_points_used,
        "linksUsed": links_used,
        "wordCount": word_count
    })

SIG = ("Best,\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\n")

# ============ 1. KINCAID FURNITURE ============
cust(1, "KINCAID FURNITURE COMPANY, INC.", "https://www.kincaidfurniture.com",
     "USA", "S", "Mr. MARVIN L. OLIVER", "待确认", "marvin oliver@kincaidfurniture.com",
     "001 828 7262814", 25, 10, 60, 30, 70, "C",
     ["广交会139届", "家具制造", "低意向"],
     "美国北卡州实木家具与定制软包制造商，主营床、餐椅、餐桌、沙发等，品牌定位中高端美国家具。"
     "采购品类为家具五金（铰链、拉手），非刀剪。联系人Marvin L. Oliver。邮箱中含空格，发送前需核实正确拼写(marvin.oliver@kincaidfurniture.com待确认)。",
     "制造商", "不匹配",
     "实木卧房/餐厅家具、定制软包沙发",
     {"business": "美国北卡州历史悠久的实木家具品牌，主打solid wood与custom upholstery，通过家具零售商渠道销售。",
      "productLine": "Plank Road、Weatherford等系列实木家具+定制软包。",
      "needs": "家具五金配件（铰链、拉手、滑轨），非刀剪类。",
      "painPoints": "1)家具五金采购成本；2)供应链稳定性；3)定制交期。",
      "angle": "刀剪品类匹配度低，可从阳江产业带的厨房/餐桌配套小五金OEM角度轻触达，或列为低优先级。"},
     {"companyOverview": "北卡州Budson NC的实木家具制造商，官网展示多系列卧房餐厅家具及定制软包。",
      "decisionMaker": "Marvin L. Oliver（职位待确认）。",
      "contactInfo": "邮箱marvin oliver@kincaidfurniture.com（原始含空格，疑似格式问题，待核实）；电话828-726-2814。",
      "painPoints": "家具五金采购成本、交期与品质稳定。",
      "purchaseIntent": "低 — 主营家具制造，采购需求为家具五金，与刀剪/厨房用品匹配度低。",
      "competitorAnalysis": "官网为自有品牌家具，未零售第三方五金品牌。",
      "supplyChain": "美国本土制造为主，五金配件来源待确认。",
      "entryPoint": "以阳江OEM小五金/餐桌配套厨具角度轻触，不主推刀剪。"},
     {"intentLevel": "低", "customerType": "制造商", "countryTier": "S",
      "categoryMatch": "低（家具制造，非刀剪）", "priorityScore": 30,
      "recommendedStrategy": "低优先级，通用五金OEM角度轻触，不投入过多资源。"},
     ["不匹配"], 30, "待确认", "Marvin L. Oliver", "")

body1 = ("Dear Mr. Oliver,\n\n"
         "I noticed Kincaid Furniture has built a respected name in solid wood and custom upholstered furniture from North Carolina. "
         "While reviewing your collections, I wanted to reach out from Yangjiang, China.\n\n"
         "KaiLionCrafts is a factory-direct partner for OEM/ODM hardware and kitchen-table accessories, "
         "with SGS LFGB and FDA certification. We support furniture and home brands with low MOQ (100 pcs), "
         "free marketing photos and videos, and founder-direct communication.\n\n"
         "Would you be open to a short WhatsApp call or a quick catalog review? "
         "I would be glad to send samples for your evaluation.\n\n" + SIG + "kailioncrafts.com/oem-odm/")
draft(1, "KINCAID FURNITURE COMPANY, INC.", "USA",
      "Yangjiang OEM hardware partner for furniture brands",
      body1,
      ["家具制造商，刀剪匹配度低，采用通用OEM五金角度", "邮箱含空格，发送前需核实"],
      ["Yangjiang OEM hardware for furniture brands", "Factory-direct hardware from Yangjiang", "OEM/ODM supply for home brands"],
      "尊敬的Oliver先生：\n\n我们注意到Kincaid Furniture在北卡实木家具与定制软包领域享有盛誉。在浏览您的系列产品时，我想从中国阳江与您联系。\n\nKaiLionCrafts是OEM/ODM五金及餐桌配套用品的工厂直供伙伴，拥有SGS LFGB与FDA认证。我们以低起订量(100件)、免费营销图片视频、创始人直接对接支持家具与家居品牌。\n\n您是否愿意进行简短的WhatsApp通话或快速查看产品目录？我很乐意寄送样品供您评估。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
      ["阳江产业带", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA认证", "免费营销素材"],
      ["https://kailioncrafts.com/oem-odm/"], 120)

# ============ 2. KIM GUAN HUAT HARDWARE ============
cust(2, "KIM GUAN HUAT HARDWARE CO., PTE. LTD.", "https://www.kimguanhuat.com",
     "Singapore", "A", "NG SEE SING", "待确认", "kimguanhuat@pacific.com.sg",
     "0065 62871386", 55, 40, 70, 60, 60, "C",
     ["广交会139届", "五金工具", "中意向"],
     "新加坡五金进口商/分销商，位于Defu Industrial Park。据Volza数据，有约70票进口记录，主要从中国4家供应商采购，"
     "是活跃的中国采购方。联系人Ng See Sing。与第3家Kim Bee Huat信息高度重合（同联系人/电话/地址），疑为关联公司。",
     "进口商", "综合五金",
     "五金工具、建材、综合五金进口分销",
     {"business": "新加坡本地五金进口分销商，Defu工业区，长期从中国进口五金产品。",
      "productLine": "综合五金、工具、建材类进口分销。",
      "needs": "持续从中国采购高性价比五金工具，可能扩充品类。",
      "painPoints": "1)需要稳定中国供应商；2)价格竞争力；3)品类扩充。",
      "angle": "以阳江刀剪/厨房用品工厂直供价+中国采购经验切入，作为其现有中国供应链的补充。"},
     {"companyOverview": "新加坡五金进口商，Volza记录70票进口，来自中国4家供应商。",
      "decisionMaker": "Ng See Sing（职位待确认）。",
      "contactInfo": "邮箱kimguanhuat@pacific.com.sg；电话+65 6287 1386。官网当前无法访问。",
      "painPoints": "需要稳定、有价格优势的中国五金货源。",
      "purchaseIntent": "中 — 有明确从中国进口记录，是活跃采购方，但品类为综合五金。",
      "competitorAnalysis": "待确认（官网无法访问）。",
      "supplyChain": "主要从中国进口（Volza数据）。",
      "entryPoint": "工厂直供价低于贸易商20%+阳江刀剪产业带，作为其中国供应链补充。"},
     {"intentLevel": "中", "customerType": "进口商", "countryTier": "A",
      "categoryMatch": "中（综合五金进口，可扩充刀剪/厨房用品）", "priorityScore": 57,
      "recommendedStrategy": "中优先级，以中国采购经验+工厂直供价切入，索取catalog。"},
     ["综合五金", "厨房用品"], 57, "待确认", "Ng See Sing", "")

body2 = ("Dear Mr. Ng,\n\n"
         "I see Kim Guan Huat has been a steady hardware importer in Singapore, sourcing a wide range of hardware from China. "
         "I am reaching out from Yangjiang, the heart of China's cutlery industry.\n\n"
         "KaiLionCrafts supplies factory-direct kitchen knives, scissors and kitchen accessories, "
         "at prices typically 20% below trading companies. We offer OEM/ODM from 100 pcs, SGS LFGB and FDA certification, "
         "and free product photos and videos for your marketing.\n\n"
         "Could I send you our latest catalog and a few sample units? Happy to discuss on WhatsApp.\n\n" + SIG + "kailioncrafts.com/kitchen-knives/")
draft(2, "KIM GUAN HUAT HARDWARE CO., PTE. LTD.", "Singapore",
      "Yangjiang cutlery supply for Singapore hardware importers",
      body2,
      ["活跃中国进口商，Volza有70票进口记录", "与Kim Bee Huat疑为关联公司，注意去重"],
      ["Yangjiang cutlery supply for Singapore importers", "Factory-direct knives from China's cutlery capital", "OEM kitchen knives & scissors, MOQ 100pcs"],
      "尊敬的Ng先生：\n\n我们了解到Kim Guan Huat是新加坡稳健的五金进口商，长期从中国采购各类五金产品。我从中国刀剪之都阳江与您联系。\n\nKaiLionCrafts工厂直供厨房刀、剪刀及厨房用品，价格通常比贸易商低20%。我们提供100件起订的OEM/ODM、SGS LFGB与FDA认证，并免费提供产品图片和视频用于营销。\n\n我能否寄送最新目录和少量样品？欢迎在WhatsApp上沟通。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/kitchen-knives/",
      ["阳江产业带", "工厂直供价低于贸易商20%", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA", "免费营销素材"],
      ["https://kailioncrafts.com/kitchen-knives/"], 118)

# ============ 3. KIM BEE HUAT HARDWARE ============
cust(3, "KIM BEE HUAT HARDWARE (M) SDN. BHD.", "http://www.kimguanhuat.com",
     "Singapore", "A", "NG SEE SING", "待确认", "kimguanhuat@pacific.net.sg",
     "0065 62871386", 50, 38, 65, 55, 55, "C",
     ["广交会139届", "五金工具", "中意向", "关联公司"],
     "与第2家Kim Guan Huat共用联系人Ng See Sing、电话、地址(Defu Lane 12)，疑为同一集团的马来西亚注册实体(SDN.BHD.)。"
     "邮箱域名为pacific.net.sg（第2家为pacific.com.sg）。建议与第2家合并跟进，避免重复开发。",
     "进口商", "综合五金",
     "五金工具、建材进口分销（与Kim Guan Huat关联）",
     {"business": "马来西亚注册(SDN.BHD.)但登记于新加坡地址，与Kim Guan Huat高度关联。",
      "productLine": "综合五金、工具进口。",
      "needs": "同关联公司，从中国采购五金。",
      "painPoints": "同关联公司。",
      "angle": "与Kim Guan Huat合并跟进，避免重复打扰。"},
     {"companyOverview": "与Kim Guan Huat共用联系人/电话/地址，疑为关联马来西亚实体。",
      "decisionMaker": "Ng See Sing。",
      "contactInfo": "邮箱kimguanhuat@pacific.net.sg；电话+65 6287 1386。",
      "painPoints": "同关联公司。",
      "purchaseIntent": "中 — 关联活跃进口商，但需避免与第2家重复开发。",
      "competitorAnalysis": "待确认。",
      "supplyChain": "主要从中国进口（推断）。",
      "entryPoint": "与Kim Guan Huat合并，统一对接。"},
     {"intentLevel": "中", "customerType": "进口商", "countryTier": "A",
      "categoryMatch": "中（综合五金）", "priorityScore": 52,
      "recommendedStrategy": "与Kim Guan Huat合并跟进，避免重复开发。"},
     ["综合五金"], 52, "待确认", "Ng See Sing", "")

body3 = ("Dear Mr. Ng,\n\n"
         "I understand Kim Bee Huat works closely with the Singapore hardware trade, sourcing quality hardware and tools from overseas. "
         "I am writing from Yangjiang, China's cutlery capital.\n\n"
         "KaiLionCrafts offers factory-direct kitchen knives, scissors and kitchen accessories with OEM/ODM from 100 pcs, "
         "SGS LFGB and FDA certification, and free marketing photos and videos. Our direct factory pricing typically beats trading companies by around 20%.\n\n"
         "May I send a catalog and samples for your review? I am glad to connect on WhatsApp at your convenience.\n\n" + SIG + "kailioncrafts.com/professional-scissors/")
draft(3, "KIM BEE HUAT HARDWARE (M) SDN. BHD.", "Singapore",
      "Factory-direct scissors & knives for your hardware range",
      body3,
      ["与Kim Guan Huat关联，建议合并跟进", "邮箱域名为pacific.net.sg"],
      ["Factory-direct scissors & knives from Yangjiang", "OEM cutlery supply, MOQ 100 pcs", "Yangjiang cutlery for hardware distributors"],
      "尊敬的Ng先生：\n\n我们了解到Kim Bee Huat与新加坡五金贸易往来密切，从海外采购优质五金工具。我从中国刀剪之都阳江致信。\n\nKaiLionCrafts工厂直供厨房刀、剪刀及厨房用品，100件起订OEM/ODM，SGS LFGB与FDA认证，免费营销图片视频。我们的工厂直供价通常比贸易商低约20%。\n\n我能否寄送目录和样品供您审阅？欢迎在您方便时通过WhatsApp联系。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/professional-scissors/",
      ["阳江产业带", "工厂直供价低于贸易商20%", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA"],
      ["https://kailioncrafts.com/professional-scissors/"], 115)

# ============ 4. KENG WAH HARDWARE ============
cust(4, "KENG WAH HARDWARE CO. PTE. LTD.", "http://www.kengwah.com",
     "Singapore", "A", "GOH TUAN PAY", "待确认", "kengwah1@singnet.com.sg",
     "0065 63924896", 30, 15, 55, 30, 60, "C",
     ["广交会139届", "船用五金/起重设备", "低意向"],
     "新加坡成立于1983年的五金公司，主营船具/索具/轮船用品(ship chandlery)及起重产品，服务油田、起重机、海事、石化等行业。"
     "约15名员工。官网已失效(Plesk默认页)。注意：有记录显示该UEN实体已停止运营，需核实。刀剪匹配度低。",
     "分销商", "不匹配",
     "船用五金、起重设备、索具、小五金、工具、油漆、钢材",
     {"business": "1983年成立，船用(chandlery)+工业起重产品分销商，服务海事/油田/石化。",
      "productLine": "船具索具、起重产品、小五金工具、油漆钢材。",
      "needs": "船用及工业五金，非刀剪。",
      "painPoints": "海事/工业供应链专业要求高。",
      "angle": "刀剪匹配度低，仅可从通用五金OEM角度轻触。"},
     {"companyOverview": "1983年成立，船用五金与起重产品分销商，约15人，服务海事/油田/石化。",
      "decisionMaker": "Goh Tuan Pay（职位待确认）。",
      "contactInfo": "邮箱kengwah1@singnet.com.sg；电话+65 6392 4896。官网已失效。",
      "painPoints": "专业海事/工业五金供应链。",
      "purchaseIntent": "低 — 主营船用与起重设备，与刀剪匹配度低；且有停止运营记录待核实。",
      "competitorAnalysis": "待确认。",
      "supplyChain": "待确认。",
      "entryPoint": "通用五金OEM角度轻触，优先核实公司是否仍在运营。"},
     {"intentLevel": "低", "customerType": "分销商", "countryTier": "A",
      "categoryMatch": "低（船用/起重设备）", "priorityScore": 35,
      "recommendedStrategy": "低优先级，先核实运营状态，通用五金角度轻触。"},
     ["不匹配"], 35, "约15人", "Goh Tuan Pay", "")

body4 = ("Dear Mr. Goh,\n\n"
         "I understand Keng Wah Hardware has served Singapore's marine, oilfield and industrial sectors with chandlery and lifting supplies since 1983. "
         "I am reaching out from Yangjiang, China.\n\n"
         "KaiLionCrafts is a factory-direct OEM/ODM partner for hardware and kitchen accessories, "
         "with SGS LFGB and FDA certification, low MOQ from 100 pcs, and free product photos and videos. "
         "We support distributors looking to add reliable, cost-effective product lines.\n\n"
         "Would you be open to a brief WhatsApp chat or a catalog review? I would be glad to share samples.\n\n" + SIG + "kailioncrafts.com/oem-odm/")
draft(4, "KENG WAH HARDWARE CO. PTE. LTD.", "Singapore",
      "Reliable OEM hardware supply from Yangjiang",
      body4,
      ["船用/起重设备商，刀剪匹配度低", "有停止运营记录，需先核实"],
      ["OEM hardware supply from Yangjiang, China", "Factory-direct hardware, MOQ 100 pcs", "Reliable hardware partner for distributors"],
      "尊敬的Goh先生：\n\n我们了解到Keng Wah Hardware自1983年起为新加坡海事、油田及工业领域提供船用及起重用品。我从中国阳江致信。\n\nKaiLionCrafts是工厂直供的OEM/ODM五金及厨房用品伙伴，拥有SGS LFGB与FDA认证，100件起订，免费产品图片视频。我们支持希望增加可靠、高性价比产品线的分销商。\n\n您是否愿意进行简短的WhatsApp通话或查看目录？我很乐意分享样品。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
      ["阳江产业带", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA", "免费营销素材"],
      ["https://kailioncrafts.com/oem-odm/"], 112)

# ============ 5. JACKDAW TOOLS ============
cust(5, "Jackdaw Tools Ltd", "http://www.jackdaw.co.uk",
     "UK", "S", "S. Paskin", "待确认", "jackd@ukindustry.co.uk",
     "0044 1902 366551", 50, 25, 60, 40, 65, "C",
     ["广交会139届", "工业工具", "低意向"],
     "英国Willenhall/Telford的工业工具供应商(engineer's merchant)，面向制造业，销售切削刀具、钻头、FFP2口罩、切削液、金刚石锯片等。"
     "有两个大型trade counter/showroom。属工业MRO工具分销，非刀剪。",
     "分销商", "不匹配",
     "工业切削刀具、钻头、PPE、切削液、金刚石锯片等MRO工具",
     {"business": "英国中部工业工具供应商，两个门店，服务制造业客户。",
      "productLine": "切削刀具、孔锯、切割油、金刚石锯片、PPE口罩。",
      "needs": "工业MRO工具，非消费刀剪。",
      "painPoints": "工业工具供应链、技术支持。",
      "angle": "可从实用刀/美工刀/工业刀具角度轻触，匹配度有限。"},
     {"companyOverview": "英国Willenhall总部+Telford分店的工业工具供应商，定位manufacturing supply solutions。",
      "decisionMaker": "S. Paskin（职位待确认）。",
      "contactInfo": "邮箱jackd@ukindustry.co.uk；电话+44 1902 366551。",
      "painPoints": "工业工具品类扩充与价格。",
      "purchaseIntent": "低 — 主营工业MRO切削工具，与消费刀剪匹配度低。",
      "competitorAnalysis": "自有trade counter零售多品牌工业工具。",
      "supplyChain": "待确认。",
      "entryPoint": "以工业实用刀/美工刀/户外刀角度轻触。"},
     {"intentLevel": "低", "customerType": "分销商", "countryTier": "S",
      "categoryMatch": "低（工业MRO工具）", "priorityScore": 42,
      "recommendedStrategy": "低优先级，以工业/户外刀具角度轻触。"},
     ["不匹配"], 42, "待确认", "S. Paskin", "")

body5 = ("Dear Mr. Paskin,\n\n"
         "I see Jackdaw Tools supplies manufacturing businesses across the West Midlands with cutting tools, drills and workshop consumables from your Willenhall and Telford trade counters.\n\n"
         "KaiLionCrafts is a Yangjiang-based factory-direct partner for OEM/ODM knives and hand tools, "
         "with SGS LFGB and FDA certification, MOQ from 100 pcs, and free product photos and videos. "
         "We could support your range with utility, outdoor and kitchen knives at direct factory pricing.\n\n"
         "May I send our catalog and a few samples for your trade counter? Happy to discuss on WhatsApp.\n\n" + SIG + "kailioncrafts.com/outdoor-knives/")
draft(5, "Jackdaw Tools Ltd", "UK",
      "OEM knives & hand tools for your trade counter",
      body5,
      ["工业MRO工具商，刀剪匹配度低", "可从实用刀/户外刀角度切入"],
      ["OEM knives & hand tools from Yangjiang", "Factory-direct utility & outdoor knives", "Cutlery supply for UK tool distributors"],
      "尊敬的Paskin先生：\n\n我们了解到Jackdaw Tools通过Willenhall和Telford门店为西米德兰兹制造业供应切削刀具、钻头及车间耗材。\n\nKaiLionCrafts是阳江工厂直供的OEM/ODM刀具及手动工具伙伴，拥有SGS LFGB与FDA认证，100件起订，免费产品图片视频。我们可以工厂直供价为您的产品线提供实用刀、户外刀和厨房刀。\n\n我能否寄送目录和少量样品供您门店参考？欢迎在WhatsApp上沟通。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/outdoor-knives/",
      ["阳江产业带", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA", "工厂直供价"],
      ["https://kailioncrafts.com/outdoor-knives/"], 118)

# ============ 6. INTERSTATE HARDWARE ============
cust(6, "INTERSTATE HARDWARE CO", "http://www.interstatehardware.com",
     "USA", "S", "DAVE LYTLE", "Owner/Manager(待确认)", "inthard@aol.com",
     "001 303 755 4590", 55, 40, 50, 35, 70, "C",
     ["广交会139届", "五金批发", "中意向"],
     "美国丹佛(CO)小型五金批发商/零售店。据Cortera/Moody's数据：私营，销售额低于50万美元，员工5-10人。"
     "联系人Dave Lytle。官网域名已出售(Afternic)，邮箱为AOL个人邮箱，规模较小。",
     "五金零售商", "综合五金",
     "综合五金、电气、工业用品、水暖",
     {"business": "丹佛小型五金批发/零售，5-10人，年销售额低于50万美元。",
      "productLine": "综合五金、电气、工业及水暖用品。",
      "needs": "补充高性价比五金品类，可能含刀剪/厨房用品。",
      "painPoints": "小规模采购议价能力弱，需要小MOQ供应商。",
      "angle": "以低MOQ(100pcs)+工厂直供价切入，适合小批量补货。"},
     {"companyOverview": "丹佛小型五金商，Cortera记录5-10人，销售额低于50万美元。",
      "decisionMaker": "Dave Lytle（职位待确认，疑为业主）。",
      "contactInfo": "邮箱inthard@aol.com(AOL个人邮箱)；电话303-755-4590。官网域名已出售。",
      "painPoints": "小规模采购、议价能力有限。",
      "purchaseIntent": "中 — 五金零售/批发，可补充刀剪品类，但规模小。",
      "competitorAnalysis": "待确认。",
      "supplyChain": "待确认。",
      "entryPoint": "低MOQ+工厂直供价，适合小批量补货。"},
     {"intentLevel": "中", "customerType": "五金零售商", "countryTier": "S",
      "categoryMatch": "中（综合五金零售可含刀剪）", "priorityScore": 48,
      "recommendedStrategy": "中低优先级，以低MOQ小批量补货角度切入。"},
     ["综合五金", "厨房用品"], 48, "5-10人", "Dave Lytle", "低于50万美元/年(待确认)")

body6 = ("Dear Mr. Lytle,\n\n"
         "I understand Interstate Hardware serves the Denver area with general hardware, electrical and plumbing supplies. "
         "I am reaching out from Yangjiang, China's cutlery capital.\n\n"
         "KaiLionCrafts supplies factory-direct kitchen knives, scissors and kitchen accessories with low MOQ from 100 pcs, "
         "SGS LFGB and FDA certification, and free product photos and videos. Our direct pricing suits smaller hardware buyers looking to add quality cutlery without large inventory risk.\n\n"
         "Could I send a catalog and samples? I am glad to discuss on WhatsApp.\n\n" + SIG + "kailioncrafts.com/kitchen-accessories/")
draft(6, "INTERSTATE HARDWARE CO", "USA",
      "Low-MOQ kitchen cutlery for your hardware store",
      body6,
      ["小型五金商，5-10人，年销<50万刀", "AOL个人邮箱，规模小"],
      ["Low-MOQ kitchen cutlery for hardware stores", "Factory-direct knives & scissors, MOQ 100 pcs", "Yangjiang cutlery for small hardware buyers"],
      "尊敬的Lytle先生：\n\n我们了解到Interstate Hardware在丹佛地区供应综合五金、电气及水暖用品。我从中国刀剪之都阳江致信。\n\nKaiLionCrafts工厂直供厨房刀、剪刀及厨房用品，100件起订，SGS LFGB与FDA认证，免费产品图片视频。我们的直供价适合希望增加优质刀剪而不承担大库存风险的小型五金采购商。\n\n我能否寄送目录和样品？欢迎在WhatsApp上沟通。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/kitchen-accessories/",
      ["阳江产业带", "低MOQ 100pcs", "SGS LFGB+FDA", "工厂直供价", "免费营销素材"],
      ["https://kailioncrafts.com/kitchen-accessories/"], 116)

# ============ 7. INTERNATIONAL HARDWARE INC ============
cust(7, "INTERNATIONAL HARDWARE INC.", "http://www.ihinc.com",
     "USA", "S", "RON BRANDWEIN", "待确认", "info@ihinc.com",
     "001 847 827 7000", 55, 40, 65, 35, 50, "C",
     ["广交会139届", "五金进口", "中意向"],
     "美国伊利诺伊州Glenview的五金公司，联系人Ron Brandwein。官网ihinc.com域名已被中国域名中介挂售，"
     "公司现状信息有限。从公司名'International Hardware'推断为五金进口/批发商。邮箱为通用info@。",
     "进口商", "综合五金",
     "综合五金进口/批发（推断）",
     {"business": "伊利诺伊州Glenview五金公司，疑为进口/批发商。",
      "productLine": "综合五金（待确认）。",
      "needs": "进口五金产品。",
      "painPoints": "待确认。",
      "angle": "以进口商角度，阳江工厂直供刀剪品类切入。"},
     {"companyOverview": "Glenview IL五金公司，Ron Brandwein。官网域名已出售，现状待确认。",
      "decisionMaker": "Ron Brandwein（职位待确认）。",
      "contactInfo": "邮箱info@ihinc.com(通用)；电话847-827-7000。",
      "painPoints": "待确认。",
      "purchaseIntent": "中 — 名称含International，疑为进口商，但现状待确认。",
      "competitorAnalysis": "待确认。",
      "supplyChain": "待确认。",
      "entryPoint": "以进口商工厂直供刀剪角度切入。"},
     {"intentLevel": "中", "customerType": "进口商", "countryTier": "S",
      "categoryMatch": "中（综合五金进口）", "priorityScore": 48,
      "recommendedStrategy": "中低优先级，先邮件试探回复率。"},
     ["综合五金"], 48, "待确认", "Ron Brandwein", "")

body7 = ("Dear Mr. Brandwein,\n\n"
         "I understand International Hardware has supplied the US hardware market from the Chicago area. "
         "I am reaching out from Yangjiang, China's cutlery capital.\n\n"
         "KaiLionCrafts is a factory-direct OEM/ODM partner for kitchen knives, scissors and kitchen accessories, "
         "with SGS LFGB and FDA certification, MOQ from 100 pcs, and free product photos and videos. "
         "Our direct factory pricing typically saves importers around 20% versus trading companies.\n\n"
         "May I send you our latest catalog? I would be glad to discuss potential cooperation on WhatsApp.\n\n" + SIG + "kailioncrafts.com/kitchen-knives/")
draft(7, "INTERNATIONAL HARDWARE INC.", "USA",
      "Factory-direct cutlery for US hardware importers",
      body7,
      ["官网域名已出售，现状待确认", "通用info@邮箱"],
      ["Factory-direct cutlery for US importers", "OEM kitchen knives, MOQ 100 pcs", "Yangjiang cutlery supply, 20% below traders"],
      "尊敬的Brandwein先生：\n\n我们了解到International Hardware从芝加哥地区供应美国五金市场。我从中国刀剪之都阳江致信。\n\nKaiLionCrafts是工厂直供的OEM/ODM厨房刀、剪刀及厨房用品伙伴，拥有SGS LFGB与FDA认证，100件起订，免费产品图片视频。我们的工厂直供价通常为进口商节省约20%(相比贸易商)。\n\n我能否寄送最新目录？欢迎在WhatsApp上探讨合作。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/kitchen-knives/",
      ["阳江产业带", "工厂直供价低于贸易商20%", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA"],
      ["https://kailioncrafts.com/kitchen-knives/"], 113)

# ============ 8. IJSSELTOOLS ============
cust(8, "IJsseltools CV", "http://www.ijsseltools.com",
     "Netherlands", "A", "W.G. Kalkman", "待确认", "sales@ijsseltools.nl",
     "0031 180 592929", 55, 30, 60, 35, 55, "C",
     ["广交会139届", "工具批发", "低意向"],
     "荷兰Krimpen a.d. IJssel的工具公司，联系人W.G. Kalkman。从公司名(IJssel tools)推断为工具批发/分销商。"
     "官网已死链。荷兰为A级市场。",
     "分销商", "综合五金",
     "工具批发/分销（推断）",
     {"business": "荷兰Krimpen aan den IJssel工具公司，疑为批发商。",
      "productLine": "工具（待确认）。",
      "needs": "补充工具品类。",
      "painPoints": "待确认。",
      "angle": "以阳江刀剪/剪刀/手动工具工厂直供切入。"},
     {"companyOverview": "荷兰工具公司，地址Parallelweg 1A, Krimpen a.d. IJssel。官网死链。",
      "decisionMaker": "W.G. Kalkman（职位待确认）。",
      "contactInfo": "邮箱sales@ijsseltools.nl；电话+31 180 592929。",
      "painPoints": "待确认。",
      "purchaseIntent": "低-中 — 工具分销商，可补充刀剪/手动工具，信息有限。",
      "competitorAnalysis": "待确认。",
      "supplyChain": "待确认。",
      "entryPoint": "以剪刀/手动工具工厂直供切入。"},
     {"intentLevel": "中", "customerType": "分销商", "countryTier": "A",
      "categoryMatch": "中（工具分销可含刀剪）", "priorityScore": 45,
      "recommendedStrategy": "中低优先级，邮件试探。"},
     ["综合五金", "剪刀"], 45, "待确认", "W.G. Kalkman", "")

body8 = ("Dear Mr. Kalkman,\n\n"
         "I understand IJsseltools supplies the Dutch market from Krimpen aan den IJssel. "
         "I am reaching out from Yangjiang, China's cutlery capital.\n\n"
         "KaiLionCrafts is a factory-direct OEM/ODM partner for professional scissors, kitchen knives and hand tools, "
         "with SGS LFGB and FDA certification, MOQ from 100 pcs, and free product photos and videos. "
         "Our direct factory pricing helps European distributors add quality lines competitively.\n\n"
         "May I send our catalog and samples for your review? Happy to connect on WhatsApp.\n\n" + SIG + "kailioncrafts.com/professional-scissors/")
draft(8, "IJsseltools CV", "Netherlands",
      "Professional scissors & knives from Yangjiang",
      body8,
      ["荷兰A级市场，工具分销商", "官网死链，信息有限"],
      ["Professional scissors & knives from Yangjiang", "OEM hand tools for European distributors", "Factory-direct cutlery, MOQ 100 pcs"],
      "尊敬的Kalkman先生：\n\n我们了解到IJsseltools从Krimpen aan den IJssel供应荷兰市场。我从中国刀剪之都阳江致信。\n\nKaiLionCrafts是工厂直供的OEM/ODM专业剪刀、厨房刀及手动工具伙伴，拥有SGS LFGB与FDA认证，100件起订，免费产品图片视频。我们的工厂直供价帮助欧洲分销商有竞争力地增加优质产品线。\n\n我能否寄送目录和样品供您审阅？欢迎在WhatsApp上联系。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/professional-scissors/",
      ["阳江产业带", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA", "工厂直供价"],
      ["https://kailioncrafts.com/professional-scissors/"], 110)

# ============ 9. HWALETT HARDWARE ============
cust(9, "Hwalett Hardware Pte Ltd", "http://www.hweco.sg",
     "Singapore", "A", "", "", "hwabo@singnet.com.sg",
     "0065 63668118", 50, 35, 55, 30, 30, "C",
     ["广交会139届", "五金贸易", "低意向"],
     "新加坡Mandai Estate的五金公司(HWECO)，无具体联系人姓名。官网hweco.sg无法访问。"
     "从公司名推断为新加坡五金贸易商。联系方式质量较低(无联系人名)。",
     "分销商", "综合五金",
     "五金贸易（推断）",
     {"business": "新加坡五金贸易商，Mandai Estate。",
      "productLine": "五金（待确认）。",
      "needs": "五金采购。",
      "painPoints": "待确认。",
      "angle": "以综合五金/刀剪工厂直供切入，但因无联系人，回复率可能低。"},
     {"companyOverview": "新加坡五金公司，Hua Yu Ind Building, Mandai Estate。官网无法访问。",
      "decisionMaker": "无具体联系人，待确认。",
      "contactInfo": "邮箱hwabo@singnet.com.sg；电话+65 6366 8118。",
      "painPoints": "待确认。",
      "purchaseIntent": "低 — 信息有限，无联系人。",
      "competitorAnalysis": "待确认。",
      "supplyChain": "待确认。",
      "entryPoint": "通用五金角度轻触。"},
     {"intentLevel": "低", "customerType": "分销商", "countryTier": "A",
      "categoryMatch": "中（综合五金）", "priorityScore": 38,
      "recommendedStrategy": "低优先级，通用角度批量发送。"},
     ["综合五金"], 38, "待确认", "待确认", "")

body9 = ("Dear Purchasing Team,\n\n"
         "I understand Hwalett Hardware supplies the Singapore market from Mandai Estate. "
         "I am reaching out from Yangjiang, China's cutlery capital.\n\n"
         "KaiLionCrafts is a factory-direct OEM/ODM partner for kitchen knives, scissors and kitchen accessories, "
         "with SGS LFGB and FDA certification, MOQ from 100 pcs, and free product photos and videos. "
         "We help hardware traders add reliable, cost-effective cutlery lines.\n\n"
         "May I send our catalog and samples? I am glad to discuss on WhatsApp at your convenience.\n\n" + SIG + "kailioncrafts.com/kitchen-knives/")
draft(9, "Hwalett Hardware Pte Ltd", "Singapore",
      "Factory-direct cutlery supply for hardware traders",
      body9,
      ["无具体联系人，回复率可能低", "官网无法访问"],
      ["Factory-direct cutlery for hardware traders", "OEM knives & scissors, MOQ 100 pcs", "Yangjiang cutlery supply"],
      "尊敬的采购团队：\n\n我们了解到Hwalett Hardware从Mandai Estate供应新加坡市场。我从中国刀剪之都阳江致信。\n\nKaiLionCrafts是工厂直供的OEM/ODM厨房刀、剪刀及厨房用品伙伴，拥有SGS LFGB与FDA认证，100件起订，免费产品图片视频。我们帮助五金贸易商增加可靠、高性价比的刀剪产品线。\n\n我能否寄送目录和样品？欢迎在您方便时通过WhatsApp沟通。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/kitchen-knives/",
      ["阳江产业带", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA", "免费营销素材"],
      ["https://kailioncrafts.com/kitchen-knives/"], 105)

# ============ 10. HUNTER TOOLS ============
cust(10, "Hunter Tools Ltd", "https://www.huntertools.co.uk",
     "UK", "S", "Nicholas Jones", "待确认", "sales@huntertools.co.uk",
     "0044 1275 851333", 55, 30, 60, 40, 60, "C",
     ["广交会139届", "工具分销", "低意向"],
     "英国Weston-super-Mare的工具分销商，联系人Nicholas Jones。有2024产品目录，销售手动/电动工具及配件。"
     "官网无法直接访问。英国S级市场。",
     "分销商", "综合五金",
     "手动/电动工具及配件分销",
     {"business": "英国Weston-super-Mare工具分销商，有年度目录。",
      "productLine": "手动/电动工具、配件、工业安全设备。",
      "needs": "补充工具品类。",
      "painPoints": "工具品类扩充与价格。",
      "angle": "以手动刀剪/实用刀/户外刀工厂直供切入。"},
     {"companyOverview": "英国工具分销商，Weston-super-Mare，有2024目录。",
      "decisionMaker": "Nicholas Jones（职位待确认）。",
      "contactInfo": "邮箱sales@huntertools.co.uk；电话+44 1275 851333。",
      "painPoints": "工具品类扩充。",
      "purchaseIntent": "低-中 — 工具分销商，可补充刀剪/手动工具。",
      "competitorAnalysis": "目录含多品牌工具。",
      "supplyChain": "待确认。",
      "entryPoint": "以手动刀剪/户外刀工厂直供切入。"},
     {"intentLevel": "中", "customerType": "分销商", "countryTier": "S",
      "categoryMatch": "中（工具分销可含刀剪）", "priorityScore": 46,
      "recommendedStrategy": "中低优先级，以手动工具/刀剪角度切入。"},
     ["综合五金", "户外刀"], 46, "待确认", "Nicholas Jones", "")

body10 = ("Dear Mr. Jones,\n\n"
         "I see Hunter Tools supplies the UK trade from Weston-super-Mare with a broad range of hand and power tools. "
         "I am reaching out from Yangjiang, China's cutlery capital.\n\n"
         "KaiLionCrafts is a factory-direct OEM/ODM partner for outdoor knives, scissors and hand tools, "
         "with SGS LFGB and FDA certification, MOQ from 100 pcs, and free product photos and videos. "
         "Our direct factory pricing helps UK distributors add quality cutlery competitively.\n\n"
         "May I send our latest catalog and samples? Happy to discuss on WhatsApp.\n\n" + SIG + "kailioncrafts.com/outdoor-knives/")
draft(10, "Hunter Tools Ltd", "UK",
      "OEM outdoor knives & hand tools for UK trade",
      body10,
      ["英国S级市场，工具分销商", "有2024目录"],
      ["OEM outdoor knives & hand tools for UK trade", "Factory-direct cutlery, MOQ 100 pcs", "Yangjiang knives for tool distributors"],
      "尊敬的Jones先生：\n\n我们了解到Hunter Tools从Weston-super-Mare向英国贸易供应广泛的手动和电动工具。我从中国刀剪之都阳江致信。\n\nKaiLionCrafts是工厂直供的OEM/ODM户外刀、剪刀及手动工具伙伴，拥有SGS LFGB与FDA认证，100件起订，免费产品图片视频。我们的工厂直供价帮助英国分销商有竞争力地增加优质刀剪。\n\n我能否寄送最新目录和样品？欢迎在WhatsApp上沟通。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/outdoor-knives/",
      ["阳江产业带", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA", "工厂直供价"],
      ["https://kailioncrafts.com/outdoor-knives/"], 108)

# ============ 11. HSM PANEL ============
cust(11, "HSM Panel", "http://www.hsmpanelinc.com",
     "USA", "S", "Darmento Sentoso", "Owner", "smdbmp@hotmail.com",
     "001 909-595-6329", 25, 10, 55, 25, 60, "C",
     ["广交会139届", "木工板材/橱柜", "低意向"],
     "美国Walnut(CA)的木板材加工厂，35年以上历史，定制裁切抽屉部件及厨房橱柜供家具行业。Owner为Darmento Sentoso。"
     "主营胶合板/木板材裁切，非刀剪。邮箱为Hotmail个人邮箱。",
     "制造商", "不匹配",
     "定制裁切木板材、抽屉部件、厨房橱柜",
     {"business": "35年以上历史的木板材裁切与橱柜制造商，服务家具行业。",
      "productLine": "按尺寸裁切木板材、抽屉部件、厨房橱柜。",
      "needs": "木工刀具/锯片可能相关，但非消费刀剪。",
      "painPoints": "家具行业供应链。",
      "angle": "刀剪匹配度极低，仅可从通用五金/木工刀具角度轻触。"},
     {"companyOverview": "Walnut CA木板材加工厂，35年以上，定制裁切供家具行业。",
      "decisionMaker": "Darmento Sentoso（Owner）。",
      "contactInfo": "邮箱smdbmp@hotmail.com；电话909-595-6329。",
      "painPoints": "木加工供应链。",
      "purchaseIntent": "低 — 木板材/橱柜制造，与刀剪匹配度极低。",
      "competitorAnalysis": "待确认。",
      "supplyChain": "待确认。",
      "entryPoint": "通用五金角度轻触。"},
     {"intentLevel": "低", "customerType": "制造商", "countryTier": "S",
      "categoryMatch": "低（木板材/橱柜）", "priorityScore": 30,
      "recommendedStrategy": "低优先级，通用五金角度轻触。"},
     ["不匹配"], 30, "待确认", "Darmento Sentoso", "")

body11 = ("Dear Mr. Sentoso,\n\n"
         "I understand HSM Panel has specialized for over 35 years in custom cut-to-size wood panels, drawer parts and kitchen cabinets for the furniture industry.\n\n"
         "KaiLionCrafts is a Yangjiang-based factory-direct OEM/ODM partner for hardware and kitchen accessories, "
         "with SGS LFGB and FDA certification, low MOQ from 100 pcs, and free product photos and videos. "
         "We support furniture and cabinet makers with reliable, cost-effective sourcing.\n\n"
         "Would you be open to a brief WhatsApp call or a catalog review? I would be glad to share samples.\n\n" + SIG + "kailioncrafts.com/oem-odm/")
draft(11, "HSM Panel", "USA",
      "Reliable OEM hardware sourcing for cabinet makers",
      body11,
      ["木板材/橱柜制造商，刀剪匹配度极低", "Owner直接对接"],
      ["OEM hardware sourcing for cabinet makers", "Factory-direct hardware, MOQ 100 pcs", "Yangjiang supply for furniture makers"],
      "尊敬的Sentoso先生：\n\n我们了解到HSM Panel 35多年来专注于为家具行业定制裁切木板材、抽屉部件及厨房橱柜。\n\nKaiLionCrafts是阳江工厂直供的OEM/ODM五金及厨房用品伙伴，拥有SGS LFGB与FDA认证，100件起订，免费产品图片视频。我们以可靠、高性价比的采购支持家具和橱柜制造商。\n\n您是否愿意进行简短的WhatsApp通话或查看目录？我很乐意分享样品。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
      ["阳江产业带", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA", "免费营销素材"],
      ["https://kailioncrafts.com/oem-odm/"], 108)

# ============ 12. HOUSE-HASSON HARDWARE (STAR) ============
cust(12, "HOUSE-HASSON HARDWARE CO", "https://www.househasson.com",
     "USA", "S", "DONALD HASSON", "待确认", "info@househasson.com",
     "001 865 525 0471", 75, 60, 85, 50, 55, "B",
     ["广交会139届", "五金批发", "高意向", "重点客户"],
     "美国Knoxville(TN)百年五金批发巨头，7万+SKU，服务全美独立五金店。官网明确'YOUR PARTNER IN RETAIL SUCCESS'，"
     "支持独立五金店开店/转型。近期任命Jeff Land为CEO。联系人Donald Hasson。本组最高价值客户——真正的五金批发商，刀剪/厨房用品可作为SKU补充。",
     "分销商", "综合五金",
     "7万+SKU综合五金批发，服务独立五金零售店",
     {"business": "百年历史五金批发分销商，7万+SKU，全美独立五金店供应商。",
      "productLine": "全品类五金、工具、家居、厨房用品。",
      "needs": "持续扩充SKU，需要有价格优势的中国货源。",
      "painPoints": "1)SKU扩充成本；2)供应链价格；3)为独立零售店提供有竞争力品类。",
      "angle": "以阳江刀剪产业带+工厂直供价+免费营销素材切入，作为其厨房用品/五金SKU补充。"},
     {"companyOverview": "Knoxville TN百年五金批发商，7万+SKU，服务独立五金店，CEO Jeff Land。",
      "decisionMaker": "Donald Hasson（家族成员，职位待确认）；CEO Jeff Land。",
      "contactInfo": "邮箱info@househasson.com；电话865-525-0471 / 800-333-0520。",
      "painPoints": "SKU扩充成本、供应链价格、零售竞争力。",
      "purchaseIntent": "高 — 真正的五金批发商，持续扩充SKU，刀剪/厨房用品可作为新品类补充。",
      "competitorAnalysis": "分销多品牌五金，服务独立零售店。",
      "supplyChain": "多源采购，可能含中国进口。",
      "entryPoint": "阳江刀剪产业带+工厂直供价(低于贸易商20%)+免费营销素材，作为厨房用品SKU补充。"},
     {"intentLevel": "高", "customerType": "分销商", "countryTier": "S",
      "categoryMatch": "高（五金批发可含刀剪/厨房用品SKU）", "priorityScore": 65,
      "recommendedStrategy": "高优先级(B级)，重点跟进，索取catalog+样品，强调批发价与营销素材支持。"},
     ["综合五金", "厨房用品", "剪刀"], 65, "200-500人(待确认)", "Donald Hasson / Jeff Land(CEO)", "")

body12 = ("Dear Mr. Hasson,\n\n"
         "I have followed House-Hasson's long-standing partnership with independent hardware stores, supporting over 70,000 SKUs across the US. "
         "I am reaching out from Yangjiang, China's cutlery capital.\n\n"
         "KaiLionCrafts is a factory-direct OEM/ODM partner for kitchen knives, scissors and kitchen accessories, "
         "with SGS LFGB and FDA certification, MOQ from 100 pcs, and free product photos, videos and even factory films with your logo. "
         "Our direct factory pricing typically beats trading companies by around 20%.\n\n"
         "Could I send our catalog and samples for your buyers? I would welcome a WhatsApp call to discuss.\n\n" + SIG + "kailioncrafts.com/kitchen-accessories/")
draft(12, "HOUSE-HASSON HARDWARE CO", "USA",
      "Yangjiang cutlery supply for your 70,000+ SKU program",
      body12,
      ["本组最高价值客户，百年五金批发商", "强调批发价+免费营销素材+客户Logo工厂片"],
      ["Yangjiang cutlery for your hardware SKU program", "Factory-direct knives & scissors, 20% below traders", "OEM cutlery with free marketing assets, MOQ 100 pcs"],
      "尊敬的Hasson先生：\n\n我们一直关注House-Hasson与全美独立五金店的长期合作，支持超过7万个SKU。我从中国刀剪之都阳江致信。\n\nKaiLionCrafts是工厂直供的OEM/ODM厨房刀、剪刀及厨房用品伙伴，拥有SGS LFGB与FDA认证，100件起订，免费提供产品图片、视频，甚至可制作带您Logo的工厂宣传片。我们的工厂直供价通常比贸易商低约20%。\n\n我能否为您的采购团队寄送目录和样品？欢迎通过WhatsApp通话探讨。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/kitchen-accessories/",
      ["阳江产业带", "工厂直供价低于贸易商20%", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA", "免费营销素材/工厂片打客户Logo"],
      ["https://kailioncrafts.com/kitchen-accessories/"], 128)

# ============ 13. HOPKINS-CARTER MARINE ============
cust(13, "HOPKINS-CARTER MARINE HARDWARE", "https://www.hopkins-carter.com",
     "USA", "S", "PARKS MASTERSON", "待确认", "info@hopkins-carter.com",
     "001 305 6357377", 35, 30, 45, 35, 55, "C",
     ["广交会139届", "船用/渔具", "低意向"],
     "美国迈阿密船用供应与渔具零售商，自1916年经营。销售船用五金、渔具(Penn/Shimano)、Gopro、导航等。"
     "品牌包括Shimano, Penn, Garmin等。虽为船用/渔具，但渔具场景可切入鱼片刀/渔刀。",
     "五金零售商", "不匹配",
     "船用五金、渔具、垂钓用品、船舶维护",
     {"business": "迈阿密1916年成立的船用供应与渔具零售商，服务游艇客和钓鱼客。",
      "productLine": "船用五金、渔具卷线器(Penn/Shimano)、导航、垂钓配件。",
      "needs": "渔具/户外用品，鱼片刀/渔刀可匹配。",
      "painPoints": "渔具品类扩充。",
      "angle": "以鱼片刀/渔刀/户外刀切入，契合渔具场景。"},
     {"companyOverview": "迈阿密船用供应与渔具零售商，1916年成立，家族经营。",
      "decisionMaker": "Parks Masterson（职位待确认）。",
      "contactInfo": "邮箱info@hopkins-carter.com / sale@hopkins-carter.com；电话305-635-7377。",
      "painPoints": "渔具/户外品类扩充。",
      "purchaseIntent": "低-中 — 船用/渔具零售，鱼片刀/渔刀有场景匹配。",
      "competitorAnalysis": "售Shimano, Penn, Okuma, Mustad, Gamakatsu等渔具品牌。",
      "supplyChain": "多品牌分销。",
      "entryPoint": "以鱼片刀/渔刀/户外刀切入渔具场景。"},
     {"intentLevel": "中", "customerType": "五金零售商", "countryTier": "S",
      "categoryMatch": "低-中（船用/渔具，鱼片刀角度）", "priorityScore": 38,
      "recommendedStrategy": "低优先级，以鱼片刀/渔刀角度差异化切入。"},
     ["户外刀"], 38, "待确认", "Parks Masterson", "")

body13 = ("Dear Mr. Masterson,\n\n"
         "I see Hopkins-Carter has served South Florida boaters and anglers since 1916, with an impressive range from Penn and Shimano tackle to marine hardware.\n\n"
         "KaiLionCrafts is a Yangjiang-based factory-direct partner for OEM/ODM fillet and outdoor knives, "
         "with SGS LFGB and FDA certification, MOQ from 100 pcs, and free product photos and videos. "
         "We could supply reliable, cost-effective fillet knives for your fishing tackle customers.\n\n"
         "May I send our knife catalog and samples? Happy to discuss on WhatsApp.\n\n" + SIG + "kailioncrafts.com/outdoor-knives/")
draft(13, "HOPKINS-CARTER MARINE HARDWARE", "USA",
      "OEM fillet & outdoor knives for fishing tackle stores",
      body13,
      ["船用/渔具零售商，以鱼片刀角度差异化切入", "售Shimano/Penn等品牌"],
      ["OEM fillet & outdoor knives for tackle stores", "Factory-direct fillet knives, MOQ 100 pcs", "Yangjiang knives for marine & fishing"],
      "尊敬的Masterson先生：\n\n我们了解到Hopkins-Carter自1916年起服务南佛罗里达的船客和钓鱼客，产品涵盖Penn、Shimano渔具到船用五金。\n\nKaiLionCrafts是阳江工厂直供的OEM/ODM鱼片刀及户外刀伙伴，拥有SGS LFGB与FDA认证，100件起订，免费产品图片视频。我们可以为您的渔具客户供应可靠、高性价比的鱼片刀。\n\n我能否寄送刀具目录和样品？欢迎在WhatsApp上沟通。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/outdoor-knives/",
      ["阳江产业带", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA", "工厂直供价"],
      ["https://kailioncrafts.com/outdoor-knives/"], 115)

# ============ 14. HIRONICHI KOGYO ============
cust(14, "HIRONICHI KOGYO KK", "https://www.hironichi.co.jp",
     "Japan", "S", "UMEDA MINORU", "待确认", "info@hironichi.co.jp",
     "0081 82 293 8333", 25, 10, 55, 25, 55, "C",
     ["广交会139届", "建材/保安器材", "低意向"],
     "日本广岛的土木建筑资材/工事保安器材商。主营土木建筑材料、工事用保安器材、交通安全器材、物加工品(钢铁/铝/不锈钢)。"
     "与刀剪完全不匹配。日本S级市场。",
     "分销商", "不匹配",
     "土木建筑资材、工事保安器材、交通安全器材、钢铁/铝/不锈钢加工品",
     {"business": "广岛县土木建筑资材与工事保安器材商。",
      "productLine": "建材、保安器材、交通安全标识、金属加工品。",
      "needs": "建材/保安器材，非刀剪。",
      "painPoints": "建筑资材供应。",
      "angle": "刀剪匹配度极低，仅通用五金角度。"},
     {"companyOverview": "广岛市西区土木建筑资材/保安器材商。",
      "decisionMaker": "Umeda Minoru（职位待确认）。",
      "contactInfo": "邮箱info@hironichi.co.jp；电话082-293-8333。",
      "painPoints": "建筑资材供应。",
      "purchaseIntent": "低 — 建材/保安器材，与刀剪完全不匹配。",
      "competitorAnalysis": "待确认。",
      "supplyChain": "日本国内为主。",
      "entryPoint": "通用五金角度轻触。"},
     {"intentLevel": "低", "customerType": "分销商", "countryTier": "S",
      "categoryMatch": "低（建材/保安器材）", "priorityScore": 28,
      "recommendedStrategy": "低优先级，通用五金角度轻触。"},
     ["不匹配"], 28, "待确认", "Umeda Minoru", "")

body14 = ("Dear Mr. Umeda,\n\n"
         "I understand Hironichi Kogyo supplies civil engineering and construction safety materials in the Hiroshima area. "
         "I am reaching out from Yangjiang, China.\n\n"
         "KaiLionCrafts is a factory-direct OEM/ODM partner for hardware and cutlery, "
         "with SGS LFGB and FDA certification, MOQ from 100 pcs, and free product photos and videos. "
         "We support Japanese trading partners with reliable, cost-effective sourcing from China's cutlery capital.\n\n"
         "Would you be open to a brief WhatsApp chat or a catalog review? I would be glad to share samples.\n\n" + SIG + "kailioncrafts.com/oem-odm/")
draft(14, "HIRONICHI KOGYO KK", "Japan",
      "Reliable OEM hardware sourcing from Yangjiang",
      body14,
      ["建材/保安器材商，刀剪完全不匹配", "日本S级市场"],
      ["OEM hardware sourcing from Yangjiang, China", "Factory-direct cutlery, MOQ 100 pcs", "Reliable China supply for Japanese buyers"],
      "尊敬的Umeda先生：\n\n我们了解到Hironichi Kogyo在广岛地区供应土木建筑及工事保安器材。我从中国阳江致信。\n\nKaiLionCrafts是工厂直供的OEM/ODM五金及刀剪伙伴，拥有SGS LFGB与FDA认证，100件起订，免费产品图片视频。我们以来自中国刀剪之都的可靠、高性价比采购支持日本贸易伙伴。\n\n您是否愿意进行简短的WhatsApp通话或查看目录？我很乐意分享样品。\n\n此致\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\nkailioncrafts.com/oem-odm/",
      ["阳江产业带", "OEM/ODM MOQ 100pcs", "SGS LFGB+FDA", "免费营销素材"],
      ["https://kailioncrafts.com/oem-odm/"], 105)

out = {"customers": CUSTOMERS, "drafts": DRAFTS}
path = "/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/外贸获客AI工作台/广交会分析_分组数据/results_batch1_group4.json"
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("WROTE", path)
print("customers:", len(CUSTOMERS), "drafts:", len(DRAFTS))
print("grades:", [(c["company"][:25], c["scores"]["total"], c["scores"]["grade"]) for c in CUSTOMERS])
