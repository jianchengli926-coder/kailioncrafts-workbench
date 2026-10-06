# -*- coding: utf-8 -*-
"""Build results_batch2_group3.json — 19 no-website Canton Fair hardware customers."""
import json

OUT = "/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/外贸获客AI工作台/广交会分析_分组数据/results_batch2_group3.json"
TS = "2026-10-06T00:00:00Z"
SIG = ("Best,\nLeo Li\nKaiLionCrafts | WhatsApp: +86 131-3800-6564\n"
       "kailioncrafts.com/yangjiang-advantage/")

def cust(**kw):
    base = {
        "id": kw["id"], "company": kw["company"], "website": "",
        "source": "广交会139届-五金制品", "type": "潜在客户", "status": "待开发",
        "createdAt": TS,
        "contact": {"name": kw.get("contact",""), "title": kw.get("title",""),
                    "email": kw.get("email",""), "phone": kw.get("phone",""),
                    "whatsapp": "", "linkedin": ""},
        "scores": kw["scores"], "tags": kw["tags"], "notes": kw["notes"],
        "country": kw["country"], "customerType": kw["customerType"],
        "productCategory": kw["productCategory"], "products": kw["products"],
        "profile": kw["profile"], "backgroundCheck": kw["bg"], "portrait": kw["portrait"],
        "intentCategories": kw["intentCategories"], "leadSource": "广交会139届-五金制品",
        "leadScore": kw["scores"]["total"], "companySize": kw.get("size",""),
        "decisionMaker": kw.get("decisionMaker",""), "annualPurchase": "",
    }
    return base

# scores helper
def sc(i,p,ct,ps,cq):
    total = round(i*0.22 + p*0.24 + ct*0.2 + ps*0.18 + cq*0.16)
    grade = "A" if total>=80 else ("B" if total>=60 else "C")
    return {"industry":i,"product":p,"companyType":ct,"purchaseSignal":ps,
            "contactQuality":cq,"total":total,"grade":grade}

customers = []

# 001 KUMHO HARDWARE (Korea)
customers.append(cust(
 id="canton_b2_g3_001", company="KUMHO HARDWARE CO.,LTD.",
 contact="PIAO CHENG XU", title="", email="lntwmkr@chollim.net", phone="0082 31 9054673",
 scores=sc(60,50,65,50,55),
 tags=["广交会139届","五金工具","中意向"],
 notes="韩国五金公司(금호하드웨어)，官网kumhohardware.com存在(注：广交会登记为空)，首尔地区五金批发/分销商。联系人姓名PIAO CHENG XU为韩裔华人，邮箱chollim.net为韩国ISP。主营综合五金流通，与刀剪有一定交集但偏通用五金。",
 country="South Korea", customerType="分销商", productCategory="综合五金",
 products="综合五金批发与流通（推断）",
 profile={"business":"韩国首尔地区老牌五金流通/批发商","productLine":"综合五金制品",
   "needs":"补充高性价比中国五金/刀剪货源","painPoints":["依赖中国进口，需稳定直供","需OEM能力","价格敏感"],
   "angle":"阳江刀剪工厂直供价+韩文沟通友好(韩裔联系人)"},
 bg={"companyOverview":"韩国五金流通企业，约2002年即有公司网站(kumhohardware.com)","decisionMaker":"PIAO CHENG XU，职位待确认",
   "contactInfo":"电话0082-31-9054673(京畿道号码)，邮箱chollim.net，有效性待确认",
   "painPoints":["综合五金需多品类采购","寻找有价格优势的中国货源"],
   "purchaseIntent":"中：广交会五金展区登记，韩国A级市场，有补充刀剪/工具可能",
   "competitorAnalysis":"无网站详查，待确认","supplyChain":"推断以中国/东亚供应商为主",
   "entryPoint":"工厂直供价+OEM MOQ 100pcs+免费营销素材"},
 portrait={"intentLevel":"中","customerType":"分销商","countryTier":"A","categoryMatch":"中","priorityScore":sc(60,50,65,50,55)["total"],
   "recommendedStrategy":"发通用五金/刀剪OEM开发信，附目录，强调工厂直供价"},
 intentCategories=["五金工具"]))

# 002 Kovametalli-IN Oy (Finland)
customers.append(cust(
 id="canton_b2_g3_002", company="Kovametalli-IN Oy",
 contact="Ilkka Nikula", title="", email="kovametalli.in@megabaud.fi", phone="00358 9 54 89 16 90",
 scores=sc(40,20,60,45,60),
 tags=["广交会139届","五金工具","低意向"],
 notes="芬兰Espoo钨钢(tungsten carbide)工业材料分销商，成立2010-12-13，主营硬质合金棒材、车刀、锯片、调整钳等工业耐磨件(alihankinta.fi/profinder.fi收录)。属工业金属批发，与消费刀剪/厨房用品基本不相关。",
 country="Finland", customerType="分销商", productCategory="不匹配",
 products="钨钢/硬质合金工业材料与刀具(棒材、车刀、锯片)",
 profile={"business":"芬兰工业硬质合金材料批发商，服务机械制造行业","productLine":"钨钢棒材、合金车刀、锯片",
   "needs":"工业耐磨材料，非消费品刀剪","painPoints":["产品线为工业硬质合金","与阳江消费刀剪无交集"],
   "angle":"仅以通用切削/刀具材料角度弱接触，优先级低"},
 bg={"companyOverview":"Tungsten Carbide Finland Ltd，30+年行业经验，工业硬质合金伙伴","decisionMaker":"Ilkka Nikula，职位待确认",
   "contactInfo":"电话+358-9-54891690与登记一致，邮箱megabaud.fi",
   "painPoints":["纯工业材料分销","无消费品零售渠道"],
   "purchaseIntent":"低：工业硬质合金，非刀剪/厨房用品目标客户",
   "competitorAnalysis":"无","supplyChain":"推断欧洲/中国工业合金供应商",
   "entryPoint":"匹配度低，仅保留弱联系，若其采购通用五金工具可再跟进"},
 portrait={"intentLevel":"低","customerType":"分销商","countryTier":"A","categoryMatch":"低","priorityScore":sc(40,20,60,45,60)["total"],
   "recommendedStrategy":"低优先级，发通用五金工具角度开发信，不强推刀剪"},
 intentCategories=["五金工具"]))

# 003 Kirkby Jig & Tool (UK)
customers.append(cust(
 id="canton_b2_g3_003", company="Kirkby Jig & Tool Co. Ltd",
 contact="K. Roche", title="", email="kroche@kjat.fsnet.co.uk", phone="0044 151 546 2681",
 scores=sc(38,22,55,42,55),
 tags=["广交会139届","五金工具","低意向"],
 notes="英国利物浦Knowsley工业 jig & tool(夹具/工装)制造商，多家英国工商目录收录其为Tool Manufacture，Trademo显示有进出口记录。属工业工装制造，与消费刀剪不相关。",
 country="United Kingdom", customerType="制造商", productCategory="不匹配",
 products="工业夹具、工装与工具制造",
 profile={"business":"英国利物浦地区工业工装(jig & tool)制造商","productLine":"定制夹具、工装、精密工具",
   "needs":"工业制造配套，非消费品","painPoints":["工装定制为主","与阳江刀剪品类不匹配"],
   "angle":"匹配度低，弱接触"},
 bg={"companyOverview":"英国Knowsley Industrial Park工业工具/工装制造企业","decisionMaker":"K. Roche，职位待确认",
   "contactInfo":"电话0151 546 2681与目录一致，邮箱fsnet.co.uk(英国老ISP)",
   "painPoints":["工业工装制造，无消费品类渠道"],
   "purchaseIntent":"低：工业工装，非刀剪/厨房用品目标",
   "competitorAnalysis":"无","supplyChain":"推断英国本地+欧洲",
   "entryPoint":"弱联系，若需通用五金加工件可再探"},
 portrait={"intentLevel":"低","customerType":"制造商","countryTier":"S","categoryMatch":"低","priorityScore":sc(38,22,55,42,55)["total"],
   "recommendedStrategy":"低优先级，通用五金角度轻触达"},
 intentCategories=["五金工具"]))

# 004 Kim Guan Metals (Singapore)
customers.append(cust(
 id="canton_b2_g3_004", company="KIM GUAN METALS PTE LTD",
 contact="KANG YOON", title="", email="kimguan@singnet.com.sg", phone="0065 62848488",
 scores=sc(42,25,60,45,60),
 tags=["广交会139届","五金工具","低意向"],
 notes="新加坡金属贸易商，成立1963-08-15，主营mild steel/stainless steel/有色钢材，提供不锈钢卷分条剪切服务(yelu.sg/singaporedb收录)，次级行业为general hardware(锁、铰链)。属钢材流通服务中心，与消费刀剪不相关。",
 country="Singapore", customerType="分销商", productCategory="不匹配",
 products="钢材(冷轧钢/不锈钢/有色)贸易与分条剪切服务",
 profile={"business":"新加坡老牌钢材贸易与加工服务公司(1963年成立)","productLine":"钢材卷材、不锈钢、金属加工",
   "needs":"工业钢材，非消费刀剪","painPoints":["钢材服务为主","与刀剪成品无关"],
   "angle":"匹配度低，弱接触"},
 bg={"companyOverview":"1963年成立的新加坡钢材贸易商，服务东亚/中国市场","decisionMaker":"KANG YOON，职位待确认",
   "contactInfo":"电话62848488/传真62800823与目录一致，singnet.com.sg",
   "painPoints":["钢材加工服务，无消费品渠道"],
   "purchaseIntent":"低：钢材流通，非刀剪/厨房用品",
   "competitorAnalysis":"无","supplyChain":"中国/东亚钢材",
   "entryPoint":"弱联系"},
 portrait={"intentLevel":"低","customerType":"分销商","countryTier":"A","categoryMatch":"低","priorityScore":sc(42,25,60,45,60)["total"],
   "recommendedStrategy":"低优先级，通用五金角度轻触达"},
 intentCategories=["五金工具"]))

# 005 Kian Sin Cheong (Singapore)
customers.append(cust(
 id="canton_b2_g3_005", company="KIAN SIN CHEONG HARDWARE TRADING",
 contact="SIMON P. C. TEO", title="", email="ksc@magis.com.sg", phone="0065 62826789",
 scores=sc(58,48,55,50,62),
 tags=["广交会139届","五金工具","中意向"],
 notes="新加坡Joo Seng路五金贸易商/门店，ACRA注册约1991年，进出口各类五金(recordowl/nipponpaint门店目录收录)。属综合五金零售与贸易，可能采购通用工具/刀具类产品。",
 country="Singapore", customerType="五金零售商", productCategory="综合五金",
 products="各类综合五金进出口与零售",
 profile={"business":"新加坡经营30+年的综合五金贸易商兼零售","productLine":"综合五金、建材、工具",
   "needs":"补充高性价比中国五金/工具","painPoints":["零售为主，量小","需价格优势货源"],
   "angle":"小批量OEM+工厂直供价"},
 bg={"companyOverview":"新加坡老牌五金进出口商，服务多行业","decisionMaker":"SIMON P. C. TEO，职位待确认",
   "contactInfo":"电话62826789与门店目录一致，magis.com.sg",
   "painPoints":["零售/小批量为主","价格敏感"],
   "purchaseIntent":"中：五金进出口商，广交会找货，通用工具有补单可能",
   "competitorAnalysis":"无","supplyChain":"推断中国/东南亚",
   "entryPoint":"MOQ 100pcs灵活小批量+工厂直供价"},
 portrait={"intentLevel":"中","customerType":"五金零售商","countryTier":"A","categoryMatch":"中","priorityScore":sc(58,48,55,50,62)["total"],
   "recommendedStrategy":"发小批量灵活OEM开发信，附目录"},
 intentCategories=["五金工具"]))

# 006 Kheng Hin Hardware (Singapore)
customers.append(cust(
 id="canton_b2_g3_006", company="Kheng Hin Hardware(Pte)Ltd",
 contact="Teo Joo Hiam", title="", email="khenghin@singnet.com.sg", phone="0065 62924133",
 scores=sc(50,35,58,45,60),
 tags=["广交会139届","五金工具","低意向"],
 notes="新加坡Hamilton Road五金公司，成立1975-05-05，产品为管材管件、阀门(chemicalcluster收录)，带制造属性。偏水暖/工业五金，与刀剪交集弱。",
 country="Singapore", customerType="分销商", productCategory="综合五金",
 products="管材管件、阀门、水暖五金",
 profile={"business":"新加坡老牌五金/水暖供应公司(1975年)","productLine":"Pipe & Fittings、Valves",
   "needs":"水暖工业五金，刀剪非主类","painPoints":["水暖品类为主","与刀剪交集弱"],
   "angle":"以通用五金/厨房用品角度弱接触"},
 bg={"companyOverview":"1975年成立，新加坡Hamilton Road，产品管材阀门","decisionMaker":"Teo Joo Hiam，职位待确认",
   "contactInfo":"电话62924133/传真62983582一致，singnet.com.sg，曾有官网khenghin.com.sg",
   "painPoints":["水暖五金专业方向"],
   "purchaseIntent":"低-中：水暖五金为主，刀剪非核心",
   "competitorAnalysis":"无","supplyChain":"推断中国/东南亚",
   "entryPoint":"厨房用品/刀具作为补充品类试推"},
 portrait={"intentLevel":"低","customerType":"分销商","countryTier":"A","categoryMatch":"低","priorityScore":sc(50,35,58,45,60)["total"],
   "recommendedStrategy":"低优先级，厨房用品补充角度轻触达"},
 intentCategories=["五金工具"]))

# 007 KEY HARDWARE (New Zealand)
customers.append(cust(
 id="canton_b2_g3_007", company="KEY HARDWARE",
 contact="DARYL BROWN", title="", email="daryl_brown@chubb.co.nz", phone="0064 9 2707288/800654711",
 scores=sc(48,32,58,45,62),
 tags=["广交会139届","五金工具","低意向"],
 notes="新西兰奥克兰Mt Wellington，邮箱后缀chubb.co.nz → Chubb(安全/锁具品牌)，推断为Chubb NZ旗下锁具/安防五金分支。属安防/建筑五金，与消费刀剪交集弱。",
 country="New Zealand", customerType="分销商", productCategory="综合五金",
 products="安防/锁具/建筑五金(Chubb体系)（推断）",
 profile={"business":"新西兰Chubb体系下安防/建筑五金分支，奥克兰Mt Wellington","productLine":"锁具、安防五金、建筑五金",
   "needs":"安防/建筑五金，刀剪非主类","painPoints":["安防专业方向","与刀剪交集弱"],
   "angle":"通用五金角度弱接触"},
 bg={"companyOverview":"邮箱@chubb.co.nz，推断为Chubb新西兰锁具/安防业务","decisionMaker":"DARYL BROWN，职位待确认",
   "contactInfo":"电话+64-9-2707288/免费电话800654711，chubb.co.nz企业邮箱",
   "painPoints":["安防五金专业方向"],
   "purchaseIntent":"低：锁具/安防五金，非刀剪",
   "competitorAnalysis":"Chubb自有品牌","supplyChain":"推断澳洲/本地/海外",
   "entryPoint":"弱联系，通用五金角度"},
 portrait={"intentLevel":"低","customerType":"分销商","countryTier":"A","categoryMatch":"低","priorityScore":sc(48,32,58,45,62)["total"],
   "recommendedStrategy":"低优先级，轻触达"},
 intentCategories=["五金工具"]))

# 008 JASCO TOOLS INC. (US)
customers.append(cust(
 id="canton_b2_g3_008", company="JASCO TOOLS INC.",
 contact="JOHN M SUMMERS", title="", email="dutch175@aol.com", phone="001 585 5466830",
 scores=sc(40,25,62,45,50),
 tags=["广交会139届","五金工具","低意向"],
 notes="美国纽约州罗切斯特工业刀具制造商，成立1951年，约125人、年收入约$52M(zippia)，主营HSS精密圆盘切割片、硬质合金切削刀具、精密机加工件，2014年被ARCH Global收购(mergr)。属工业切削刀具，非消费刀剪。",
 country="United States", customerType="制造商", productCategory="不匹配",
 products="工业HSS切割圆盘、硬质合金切削刀具、精密机加工件",
 profile={"business":"美国罗切斯特老牌工业切削刀具制造商(1951)，ARCH Global旗下","productLine":"工业切割片、合金刀具",
   "needs":"工业切削，非消费刀剪","painPoints":["工业制造自有产线","与阳江消费刀剪不相关"],
   "angle":"匹配度低，弱接触"},
 bg={"companyOverview":"Jasco Tools Inc，1951年创立，服务热交换器行业切割圆盘，约125人","decisionMaker":"JOHN M SUMMERS，职位待确认；邮箱dutch175@aol.com为个人AOL邮箱",
   "contactInfo":"电话+1-585-5466830(Rochester)，个人AOL邮箱，沟通有效性待确认",
   "painPoints":["工业刀具制造，自有技术","个人邮箱，非正式采购渠道"],
   "purchaseIntent":"低：工业切削刀具制造商，非消费刀剪买家",
   "competitorAnalysis":"ARCH Global体系","supplyChain":"自有制造+全球采购",
   "entryPoint":"弱联系"},
 portrait={"intentLevel":"低","customerType":"制造商","countryTier":"S","categoryMatch":"低","priorityScore":sc(40,25,62,45,50)["total"],
   "recommendedStrategy":"低优先级，通用五金角度轻触达"},
 intentCategories=["五金工具"]))

# 009 K&K DEVELOPMENT (US, kitchenware)
customers.append(cust(
 id="canton_b2_g3_009", company="K&K DEVELOPMENT COMPANY",
 contact="", title="", email="mikew@usfinser.com", phone="001 3019868887",
 scores=sc(55,55,55,45,45),
 tags=["广交会139届","厨房用品","低意向"],
 notes="美国马里兰州Bethesda，无联系人，邮箱mikew@usfinser.com(US Financial Services域名)，地址4712 Rosedale Ave。无公开企业信息，推断为小型贸易/采购公司，登记品类为厨房用品。注意：与本组canton_b2_g3_011为同地址同邮箱同传真，疑似重复登记。",
 country="United States", customerType="进口商", productCategory="厨房用品",
 products="厨房用品/五金采购（推断）",
 profile={"business":"美国马里兰小型贸易/采购公司，信息少","productLine":"厨房用品、五金",
   "needs":"补充中国厨房用品/刀剪货源","painPoints":["无公开信息，规模不明","通用邮箱"],
   "angle":"通用厨房用品+刀剪一站式采购"},
 bg={"companyOverview":"无网站，公开信息有限，推断小型进口/贸易商","decisionMaker":"无联系人；邮箱前缀mikew疑为Mike",
   "contactInfo":"电话+1-301-9868887(Bethesda MD)，邮箱usfinser.com，有效性待确认",
   "painPoints":["无网站、无联系人，信息不透明"],
   "purchaseIntent":"低-中：登记厨房用品品类，但无明确采购信号",
   "competitorAnalysis":"无","supplyChain":"待确认",
   "entryPoint":"厨房用品+刀剪一站式，免费目录"},
 portrait={"intentLevel":"低","customerType":"进口商","countryTier":"S","categoryMatch":"中","priorityScore":sc(55,55,55,45,45)["total"],
   "recommendedStrategy":"发厨房用品通用开发信，附目录；与011去重勿重复发送"},
 intentCategories=["厨房用品"]))

# 010 KPL Precision Tool & Die (UK)
customers.append(cust(
 id="canton_b2_g3_010", company="K P L Precision Tool & Die Sinking (Aberdare) Ltd",
 contact="L. Chidge", title="", email="kpl.twoling@tiscali.co.uk", phone="0044 1685 814434",
 scores=sc(35,20,55,40,55),
 tags=["广交会139届","五金工具","低意向"],
 notes="英国威尔士Aberdare精密工程/工具模具(tool & die sinking)公司，位于Hirwaun工业区。属精密模具加工，与消费刀剪不相关。",
 country="United Kingdom", customerType="制造商", productCategory="不匹配",
 products="精密工程、工具与模具加工(tool & die)",
 profile={"business":"威尔士Aberdare精密工程与模具加工企业","productLine":"精密工装、模具",
   "needs":"工业精密加工，非消费刀剪","painPoints":["模具加工专业方向","与阳江刀剪不相关"],
   "angle":"匹配度低"},
 bg={"companyOverview":"英国威尔士精密工程/tool & die企业","decisionMaker":"L. Chidge，职位待确认",
   "contactInfo":"电话+44-1685-814434，邮箱tiscali.co.uk(英国老ISP)",
   "painPoints":["工业模具加工"],
   "purchaseIntent":"低：精密模具，非刀剪/厨房用品",
   "competitorAnalysis":"无","supplyChain":"英国本地/欧洲",
   "entryPoint":"弱联系"},
 portrait={"intentLevel":"低","customerType":"制造商","countryTier":"S","categoryMatch":"低","priorityScore":sc(35,20,55,40,55)["total"],
   "recommendedStrategy":"低优先级，轻触达"},
 intentCategories=["五金工具"]))

# 011 K AND K DEVELOPMENT (dup of 009)
customers.append(cust(
 id="canton_b2_g3_011", company="K AND K DEVELOPMENT COMPANY",
 contact="", title="", email="mikew@usfinser.com", phone="001 3017183639",
 scores=sc(55,55,55,45,45),
 tags=["广交会139届","厨房用品","低意向"],
 notes="【疑似重复客户】美国马里兰州Bethesda，与canton_b2_g3_009(K&K DEVELOPMENT)地址完全相同(4712 Rosedale Ave)、邮箱相同(mikew@usfinser.com)、传真相同(001 3019868831)，仅电话与写法不同。建议合并为同一客户，勿重复发送。登记品类厨房用品。",
 country="United States", customerType="进口商", productCategory="厨房用品",
 products="厨房用品/五金采购（推断）",
 profile={"business":"与009同一公司，马里兰小型贸易/采购商","productLine":"厨房用品、五金",
   "needs":"补充中国厨房用品/刀剪货源","painPoints":["与009重复，勿重复联系"],
   "angle":"合并到009统一开发"},
 bg={"companyOverview":"与canton_b2_g3_009为同一主体(同地址/邮箱/传真)","decisionMaker":"无联系人；疑为Mike",
   "contactInfo":"电话+1-301-7183639，邮箱mikew@usfinser.com",
   "painPoints":["重复登记"],
   "purchaseIntent":"低-中：同009",
   "competitorAnalysis":"无","supplyChain":"待确认",
   "entryPoint":"合并到009"},
 portrait={"intentLevel":"低","customerType":"进口商","countryTier":"S","categoryMatch":"中","priorityScore":sc(55,55,55,45,45)["total"],
   "recommendedStrategy":"与009合并，仅发一封开发信"},
 intentCategories=["厨房用品"]))

# 012 JAPAN NOP CO LTD
customers.append(cust(
 id="canton_b2_g3_012", company="JAPAN NOP CO LTD",
 contact="MUNEKIYO, MASAYA", title="", email="japannop@hct.zaq.ne.jp", phone="0081 729 65 1391",
 scores=sc(35,18,55,40,55),
 tags=["广交会139届","厨房用品","低意向"],
 notes="日本东大阪市企业。NOP = Nippon Oil Pump，Alibaba/made-in-china显示该品牌为转子油泵/液压trochoid泵(TOP系列)制造商。属液压/工业泵业，与登记的'厨房用品'严重不符，匹配度极低。",
 country="Japan", customerType="制造商", productCategory="不匹配",
 products="液压/转子油泵(Nippon Oil Pump类工业泵)",
 profile={"business":"日本东大阪工业油泵/液压部件相关企业","productLine":"转子油泵、液压泵",
   "needs":"工业液压，非消费刀剪/厨房用品","painPoints":["工业泵业，与厨房用品品类不符"],
   "angle":"匹配度极低，不建议重点开发"},
 bg={"companyOverview":"NOP对应Nippon Oil Pump工业泵品牌，东大阪","decisionMaker":"MUNEKIYO MASAYA，职位待确认",
   "contactInfo":"电话+81-729-65-1391(东大阪)，邮箱hct.zaq.ne.jp(日本ISP)",
   "painPoints":["工业液压泵，无消费品类"],
   "purchaseIntent":"低：工业油泵，与刀剪/厨房用品不相关",
   "competitorAnalysis":"Nippon Oil Pump体系","supplyChain":"日本本土",
   "entryPoint":"不匹配，可放弃或极弱联系"},
 portrait={"intentLevel":"低","customerType":"制造商","countryTier":"S","categoryMatch":"低","priorityScore":sc(35,18,55,40,55)["total"],
   "recommendedStrategy":"不匹配，低优先级，仅存档"},
 intentCategories=["厨房用品"]))

# 013 JAPAN LOTUS CHINA
customers.append(cust(
 id="canton_b2_g3_013", company="JAPAN LOTUS CHINA CO.,LTD",
 contact="ZHOU HE", title="", email="zhou@h.email.ne.jp", phone="0081 3 56930193",
 scores=sc(58,58,62,55,60),
 tags=["广交会139届","厨房用品","中意向"],
 notes="日本东京江户川区，联系人ZHOU HE为中文名，公司名'Lotus China'推断为在日华人经营的中日贸易公司，从中国采购商品输入日本。登记品类厨房用品，华人联系人利于沟通，潜力较好。",
 country="Japan", customerType="进口商", productCategory="厨房用品",
 products="中日贸易：从中国进口厨房用品/家居杂货（推断）",
 profile={"business":"在日华人经营的中日贸易公司，东京江户川","productLine":"中国进口厨房用品/家居杂货",
   "needs":"从中国直采厨房用品/刀剪，价格敏感","painPoints":["需稳定中国直供","希望小批量灵活"],
   "angle":"华人沟通+中国直采+OEM混柜"},
 bg={"companyOverview":"'Lotus China'+华人联系人ZHOU HE，推断中国-日本贸易进口商","decisionMaker":"ZHOU HE(周贺/周河等)，职位待确认，中文沟通",
   "contactInfo":"电话+81-3-56930193，传真同号，邮箱h.email.ne.jp(日本ISP)",
   "painPoints":["依赖中国货源","需性价比与灵活MOQ"],
   "purchaseIntent":"中-高：华人贸易商从中国采购，广交会找厨房用品货源，匹配度较好",
   "competitorAnalysis":"无","supplyChain":"中国(其主业即中国进口)",
   "entryPoint":"中文沟通友好+阳江直供价+OEM MOQ100pcs+一站式混柜"},
 portrait={"intentLevel":"中","customerType":"进口商","countryTier":"S","categoryMatch":"中","priorityScore":sc(58,58,62,55,60)["total"],
   "recommendedStrategy":"本组较优质线索，用中文友好+阳江直采角度重点开发，附目录并提议样品"},
 intentCategories=["厨房用品"]))

# 014 J.E.Z. INTERNATIONAL TRADING (US)
customers.append(cust(
 id="canton_b2_g3_014", company="J.E.Z. INTERNATIONAL TRADING COMPANY",
 contact="", title="", email="janice_zh_115@netzero.net", phone="001 3046172865",
 scores=sc(52,50,55,42,45),
 tags=["广交会139届","厨房用品","低意向"],
 notes="美国，仅P.O. Box 803，无联系人，邮箱janice_zh_115@netzero.net(netzero免费邮箱，zh疑为中文拼音)。电话西弗吉尼亚/俄亥俄。无公开企业信息，推断小型个人/华人贸易商，登记厨房用品。",
 country="United States", customerType="进口商", productCategory="厨房用品",
 products="厨房用品/五金贸易（推断）",
 profile={"business":"美国小型贸易公司，信息少，疑华人经营","productLine":"厨房用品、五金",
   "needs":"从中国采购高性价比厨房用品","painPoints":["仅PO Box+免费邮箱，规模小","无网站"],
   "angle":"通用厨房用品+刀剪直供价"},
 bg={"companyOverview":"无网站，PO Box，netzero个人邮箱，规模小","decisionMaker":"无联系人；邮箱janice_zh疑为Janice(华人)",
   "contactInfo":"电话+1-304-6172865，传真+1-740-3774857，netzero.net",
   "painPoints":["小型个人贸易，渠道与规模有限"],
   "purchaseIntent":"低-中：登记厨房用品但信号弱",
   "competitorAnalysis":"无","supplyChain":"推断中国",
   "entryPoint":"免费目录+工厂直供价"},
 portrait={"intentLevel":"低","customerType":"进口商","countryTier":"S","categoryMatch":"中","priorityScore":sc(52,50,55,42,45)["total"],
   "recommendedStrategy":"低-中优先级，通用厨房用品开发信"},
 intentCategories=["厨房用品"]))

# 015 J&N Hardware & Engineering (Singapore)
customers.append(cust(
 id="canton_b2_g3_015", company="J & N HARDWARE AND ENGINEERING",
 contact="MR.NELSON NG", title="", email="janhw@singnet.com.sg", phone="0065 67810040",
 scores=sc(55,45,55,48,60),
 tags=["广交会139届","五金工具","低意向"],
 notes="新加坡Yishun合伙企业，成立2000-04-18(sgpbusiness收录)，小型五金与工程公司，联系人Nelson Ng。规模小，综合五金工程配套。",
 country="Singapore", customerType="五金零售商", productCategory="综合五金",
 products="综合五金与工程配套",
 profile={"business":"新加坡Yishun小型五金工程合伙企业(2000)","productLine":"综合五金、工程配套",
   "needs":"补充高性价比五金/工具","painPoints":["规模小","工程配套为主"],
   "angle":"小批量灵活供应"},
 bg={"companyOverview":"2000年成立的新加坡小型五金工程合伙","decisionMaker":"MR. NELSON NG，职位待确认",
   "contactInfo":"电话67810040/传真67870020，singnet.com.sg",
   "painPoints":["小企业采购量有限"],
   "purchaseIntent":"低-中：小型五金商，广交会找货",
   "competitorAnalysis":"无","supplyChain":"推断中国/本地",
   "entryPoint":"MOQ灵活+直供价"},
 portrait={"intentLevel":"低","customerType":"五金零售商","countryTier":"A","categoryMatch":"中","priorityScore":sc(55,45,55,48,60)["total"],
   "recommendedStrategy":"低优先级，小批量灵活角度"},
 intentCategories=["五金工具"]))

# 016 IRWIN INDUSTRIAL TOOL (US)
customers.append(cust(
 id="canton_b2_g3_016", company="IRWIN INDUSTRIAL TOOL COMPANY",
 contact="", title="", email="peter.zou@irwin.com", phone="001 7049874417",
 scores=sc(72,55,85,55,70),
 tags=["广交会139届","五金工具","高意向"],
 notes="全球知名工具品牌IRWIN(Vise-Grip、Quick-Grip夹具、电锯片、航空剪)，2002年Newell Brands，2017年并入Stanley Black & Decker。联系邮箱peter.zou@irwin.com(Peter Zou，中文名)，推断为其中国采购/供应链人员。航空剪/切削工具与剪刀品类相关，S级市场，但作为大品牌自有供应链成熟，切入难度高、周期长。",
 country="United States", customerType="品牌商", productCategory="综合五金",
 products="手工具：夹具(Vise-Grip/Quick-Grip)、锯片、航空剪、麻花钻等",
 profile={"business":"Stanley Black & Decker旗下全球手工具品牌，百年历史，销往120+国家","productLine":"夹具、锯片、剪切工具、麻花钻",
   "needs":"可能寻找具成本优势的OEM/ODM代工或补充切削/剪切工具","painPoints":["大品牌供应链成熟，门槛高","需合规/验厂/认证齐全"],
   "angle":"以认证齐全(SGS LFGB/FDA)+OEM+工厂宣传片打Logo切入其剪切/剪刀类补充线"},
 bg={"companyOverview":"IRWIN Tools，1884年起源，Vise-Grip 1924年专利，Stanley Black & Decker旗下","decisionMaker":"Peter Zou(peter.zou@irwin.com)，推断中国采购/供应链",
   "contactInfo":"电话+1-704-9874417(北卡Huntersville)，企业邮箱irwin.com，质量高",
   "painPoints":["大型品牌，采购流程严格、需验厂与认证","现有供应链成熟"],
   "purchaseIntent":"中：S级品牌且有华人采购联系人，航空剪与剪刀品类相关，但决策链长",
   "competitorAnalysis":"Stanley/DeWALT/Bostitch同集团","supplyChain":"全球成熟代工体系(中国为主)",
   "entryPoint":"认证齐全+OEM代工+工厂宣传片打客户Logo，针对剪切/剪刀类补充品类"},
 portrait={"intentLevel":"中","customerType":"品牌商","countryTier":"S","categoryMatch":"中","priorityScore":sc(72,55,85,55,70)["total"],
   "recommendedStrategy":"本组最高价值线索，精心撰写OEM/认证角度开发信，争取进入其剪切工具供应链评估；预期周期长"},
 intentCategories=["五金工具"]))

# 017 International Hardware Electrical & Construction (SG)
customers.append(cust(
 id="canton_b2_g3_017", company="International Hardware Electrical & Construction Co.(Pte)Lt",
 contact="", title="", email="annreguay@hotmail.com", phone="0065 62982900",
 scores=sc(45,30,55,42,45),
 tags=["广交会139届","五金工具","低意向"],
 notes="新加坡建筑/五金电气公司，注册主业building construction(RecordOwl 197200737R)，在Jalan Lembah Kallang有7层厂房。属建筑施工/五金电气配套，hotmail个人邮箱，与消费刀剪不相关。",
 country="Singapore", customerType="分销商", productCategory="综合五金",
 products="建筑施工、五金电气配套",
 profile={"business":"新加坡建筑/五金电气工程公司","productLine":"建筑、五金电气",
   "needs":"建筑工程五金配套，非消费刀剪","painPoints":["建筑工程方向","hotmail个人邮箱"],
   "angle":"弱接触"},
 bg={"companyOverview":"新加坡建筑施工/五金电气公司，Kallang厂房","decisionMaker":"无联系人；hotmail邮箱",
   "contactInfo":"电话62982900/传真62984327，annreguay@hotmail.com(个人邮箱)",
   "painPoints":["建筑工程为主","个人邮箱非正式采购"],
   "purchaseIntent":"低：建筑/五金电气，非刀剪",
   "competitorAnalysis":"无","supplyChain":"本地/中国",
   "entryPoint":"弱联系"},
 portrait={"intentLevel":"低","customerType":"分销商","countryTier":"A","categoryMatch":"低","priorityScore":sc(45,30,55,42,45)["total"],
   "recommendedStrategy":"低优先级，轻触达"},
 intentCategories=["五金工具"]))

# 018 HUANG HARDWARE TRADING (SG)
customers.append(cust(
 id="canton_b2_g3_018", company="HUANG HARDWARE TRADING PTE LTD",
 contact="RICHARD ANG", title="", email="huanghwt@singnet.com.sg", phone="0065 62858567",
 scores=sc(52,42,52,40,60),
 tags=["广交会139届","五金工具","低意向"],
 notes="新加坡Defu Lane五金零售/贸易，成立2000-03-15，主业零售五金(链条、镰刀、斧头)。注意：RecordOwl显示该公司(200002153C)状态为Struck Off(已注销)，需核实是否仍经营。",
 country="Singapore", customerType="五金零售商", productCategory="综合五金",
 products="五金零售(链条、斧头、农具等)",
 profile={"business":"新加坡Defu工业区五金零售/贸易公司","productLine":"通用五金、农具、工具",
   "needs":"通用五金/工具货源","painPoints":["登记显示已注销(Struck Off)，需核实经营状态"],
   "angle":"先核实状态再开发"},
 bg={"companyOverview":"2000年成立，五金零售；RecordOwl显示Struck Off","decisionMaker":"RICHARD ANG，职位待确认",
   "contactInfo":"电话62858567/传真68411176，singnet.com.sg",
   "painPoints":["公司状态疑已注销，有效性待核实"],
   "purchaseIntent":"低：状态存疑，零售五金",
   "competitorAnalysis":"无","supplyChain":"推断中国",
   "entryPoint":"先电话/邮件核实是否仍经营，再决定"},
 portrait={"intentLevel":"低","customerType":"五金零售商","countryTier":"A","categoryMatch":"中","priorityScore":sc(52,42,52,40,60)["total"],
   "recommendedStrategy":"低优先级，发送前先核实公司存续状态"},
 intentCategories=["五金工具"]))

# 019 HTL Hardware Ltd (NZ)
customers.append(cust(
 id="canton_b2_g3_019", company="HTL Hardware Ltd",
 contact="Kevin Botherway", title="", email="wallan@htlhardware.co.nz", phone="0064 6 843 9074",
 scores=sc(55,45,52,48,62),
 tags=["广交会139届","五金工具","中意向"],
 notes="新西兰Napier(Onekawa)本地五金店，htlhardware.co.nz，经营手工具、建材、园艺工具、锁具、钉子螺栓、油漆、管道、厨房水槽等(servicefinder/cylex收录)，评分4.6。属本地五金零售，可能补充中国工具/刀剪货源。",
 country="New Zealand", customerType="五金零售商", productCategory="综合五金",
 products="手工具、建材、园艺、锁具、管道、厨房水槽等五金零售",
 profile={"business":"新西兰Napier本地社区五金零售店","productLine":"手工具、建材、园艺、厨卫五金",
   "needs":"补充高性价比中国手工具/厨房用品","painPoints":["零售采购量小","依赖批发渠道"],
   "angle":"小批量+直供价+免费营销素材"},
 bg={"companyOverview":"新西兰Hawke's Bay地区本地五金店，服务Onekawa/Napier","decisionMaker":"Kevin Botherway；邮箱wallan@htlhardware.co.nz",
   "contactInfo":"电话+64-6-8439074/传真8433195，企业域名邮箱，质量较好",
   "painPoints":["本地零售，量小","需差异化货源"],
   "purchaseIntent":"中：本地五金零售，广交会找货，手工具/厨具有补充可能",
   "competitorAnalysis":"Mitre 10/Bunnings等大连锁为其竞品","supplyChain":"推断本地批发/中国进口",
   "entryPoint":"差异化OEM小批量+免费产品图/视频素材"},
 portrait={"intentLevel":"中","customerType":"五金零售商","countryTier":"A","categoryMatch":"中","priorityScore":sc(55,45,52,48,62)["total"],
   "recommendedStrategy":"发手工具/厨房用品小批量开发信，附免费营销素材"},
 intentCategories=["五金工具"]))

# ---------------- Drafts ----------------
def draft(idx, c, subject, body_paras, ai_notes, subjects, cn, sp, link):
    body = "\n\n".join(body_paras) + "\n\n" + SIG
    wc = len(body.replace(SIG,"").split())
    return {
        "id": f"draft_canton_b2_g3_{idx:03d}", "customerId": c["id"],
        "customerName": c["company"], "country": c["contact"] and _country_cn(c["country"]),
        "language": "英语", "subject": subject, "body": body, "content": body,
        "status": "待检查", "createdAt": TS, "sentAt": None, "aiNotes": ai_notes,
        "subjectOptions": subjects, "chineseVersion": cn, "sellingPointsUsed": sp,
        "linksUsed": [link], "wordCount": wc,
    }

def _country_cn(en):
    return {"South Korea":"韩国","Finland":"芬兰","United Kingdom":"英国","Singapore":"新加坡",
            "New Zealand":"新西兰","United States":"美国","Japan":"日本"}.get(en,en)

drafts = []

# 001 Kumho Korea
drafts.append(draft(1, customers[0],
 "Yangjiang cutlery supply for Korean hardware distributors",
 ["Dear Mr. Piao,\n\nI came across Kumho Hardware while researching Korean hardware distributors at the 139th Canton Fair. We are KaiLionCrafts, a direct cutlery and scissors supplier based in Yangjiang, China - the source of roughly 75% of China's knife and scissors output.",
 "We work with hardware distributors on OEM/ODM from 100 pcs, backed by SGS LFGB and FDA certifications and four partner factories under direct founder management. Factory-direct pricing runs about 20% below trading companies, and we provide free product photos and videos for your marketing.",
 "May I send our catalog and quote on the knife, scissors or kitchen items you currently source?"],
 ["无网站，通用五金分销商角度","强调OEM+直供价","韩裔联系人，可后续尝试韩文"],
 ["Yangjiang cutlery supply for Korean hardware distributors",
  "OEM knives & scissors - factory-direct from Yangjiang",
  "Cutlery OEM from China's cutlery capital (MOQ 100 pcs)"],
 "您好朴先生，\n\n我们在139届广交会期间了解到Kumho Hardware。KaiLionCrafts是位于中国阳江的刀剪直供商，阳江约占中国刀剪产量的75%。\n\n我们为五金分销商提供OEM/ODM（100件起），具备SGS LFGB与FDA认证，由4家合作工厂、创始人直接管理，工厂直供价较贸易商低约20%，并免费提供产品图片与视频素材。\n\n能否寄送目录，并针对您现有采购的刀剪/厨房品类报价？",
 ["阳江产业带","OEM/ODM MOQ 100pcs","工厂直供价","免费营销素材"],
 "https://kailioncrafts.com/oem-odm/"))

# 002 Kovametalli Finland (low match, generic)
drafts.append(draft(2, customers[1],
 "Yangjiang cutting tools & hardware - direct factory supply",
 ["Dear Mr. Nikula,\n\nWe noted Kovametalli-IN Oy at the 139th Canton Fair as a specialist in hard-metal and cutting solutions for Finnish industry. KaiLionCrafts is a China-based manufacturer of knives, scissors and cutting tools from Yangjiang.",
 "Beyond industrial grades, we supply general-purpose hand cutting tools and kitchen cutlery with OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing. If your range ever needs general hardware or cutting-tool additions, we can support with flexible MOQs.",
 "Happy to send a catalog or samples for evaluation."],
 ["匹配度低(工业硬质合金)","仅以通用切削/五金角度弱接触","不主推消费刀剪"],
 ["Yangjiang cutting tools & hardware - factory direct",
  "General hardware & cutlery OEM from Yangjiang",
  "Flexible OEM cutting-tool supply (MOQ 100 pcs)"],
 "您好Nikula先生，\n\n我们在139届广交会注意到贵司为芬兰工业提供硬质合金与切削方案。KaiLionCrafts是中国阳江的刀剪与切削工具制造商。\n\n除工业级外，我们供应通用手动切削工具与厨房刀剪，支持OEM/ODM（100件起）、SGS LFGB/FDA认证、工厂直供价。若贵司产品线需补充通用五金或切削工具，我们可提供灵活小批量。\n\n可寄送目录或样品供评估。",
 ["OEM/ODM MOQ 100pcs","工厂直供价","认证齐全"],
 "https://kailioncrafts.com/yangjiang-advantage/"))

# 003 Kirkby Jig & Tool UK (low match)
drafts.append(draft(3, customers[2],
 "General hardware & cutlery sourcing from Yangjiang, China",
 ["Dear Mr. Roche,\n\nWe noted Kirkby Jig & Tool at the 139th Canton Fair. KaiLionCrafts is a direct manufacturer of knives, scissors and general hardware based in Yangjiang, China.",
 "We support British buyers with OEM/ODM from 100 pcs, SGS LFGB and FDA certifications, and factory-direct pricing about 20% below traders. If you ever source general hand tools or cutlery alongside your precision tooling, we can offer reliable, cost-effective supply.",
 "May I send our latest catalog for your reference?"],
 ["匹配度低(工业工装制造)","通用五金角度轻触达"],
 ["General hardware & cutlery sourcing from Yangjiang",
  "Yangjiang OEM for UK hardware buyers",
  "Factory-direct cutlery & hand tools (MOQ 100 pcs)"],
 "您好Roche先生，\n\n我们在139届广交会注意到Kirkby Jig & Tool。KaiLionCrafts是中国阳江的刀剪与通用五金直供制造商。\n\n我们为英国采购商提供OEM/ODM（100件起）、SGS LFGB与FDA认证，工厂直供价较贸易商低约20%。若贵司在精密工装之外需补充通用手动工具或刀剪，我们可提供稳定、高性价比供货。\n\n能否寄送最新目录供参考？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","认证齐全"],
 "https://kailioncrafts.com/yangjiang-advantage/"))

# 004 Kim Guan Metals (low match)
drafts.append(draft(4, customers[3],
 "Yangjiang cutlery & general hardware - direct supply",
 ["Dear Mr. Kang,\n\nWe noted Kim Guan Metals at the 139th Canton Fair. KaiLionCrafts is a Yangjiang-based manufacturer of knives, scissors and kitchen hardware, serving hardware and trading companies across Asia.",
 "We offer OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing roughly 20% below traders. Alongside your steel service business, we can supply finished cutlery or general hardware if your customers ask.",
 "May I send a catalog or quote on any finished hardware items?"],
 ["匹配度低(钢材贸易)","通用成品五金角度弱接触"],
 ["Yangjiang cutlery & general hardware - direct supply",
  "Finished hardware OEM from China's cutlery capital",
  "Factory-direct cutlery (MOQ 100 pcs)"],
 "您好Kang先生，\n\n我们在139届广交会注意到Kim Guan Metals。KaiLionCrafts是阳江刀剪与厨房五金制造商，服务亚洲五金与贸易公司。\n\n我们提供OEM/ODM（100件起）、SGS LFGB/FDA认证，工厂直供价较贸易商低约20%。在钢材业务之外，若客户需要成品刀剪或通用五金，我们可供货。\n\n能否寄送目录，或针对成品五金报价？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","一站式采购"],
 "https://kailioncrafts.com/yangjiang-advantage/"))

# 005 Kian Sin Cheong (medium, small batch)
drafts.append(draft(5, customers[4],
 "Flexible small-batch cutlery OEM for Singapore hardware traders",
 ["Dear Mr. Teo,\n\nWe noted Kian Sin Cheong Hardware Trading at the 139th Canton Fair. KaiLionCrafts is a direct cutlery and scissors manufacturer in Yangjiang, China - home to about 75% of China's cutlery production.",
 "We specialise in flexible orders: OEM/ODM from just 100 pcs, SGS LFGB and FDA certifications, and factory-direct pricing. We also provide free product photos and videos to help you sell.",
 "May I send our catalog and offer small-batch pricing on knives, scissors or kitchen tools?"],
 ["综合五金进出口商","强调小批量灵活MOQ+免费素材"],
 ["Flexible small-batch cutlery OEM for SG hardware traders",
  "Yangjiang cutlery - OEM from 100 pcs",
  "Factory-direct knives & scissors for hardware traders"],
 "您好Teo先生，\n\n我们在139届广交会注意到Kian Sin Cheong Hardware Trading。KaiLionCrafts是中国阳江刀剪直供制造商，阳江约占中国刀剪产量75%。\n\n我们主打灵活订单：OEM/ODM仅100件起，SGS LFGB与FDA认证，工厂直供价，并免费提供产品图片与视频帮助销售。\n\n能否寄送目录，并提供刀剪/厨房工具的小批量报价？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","免费营销素材"],
 "https://kailioncrafts.com/free-marketing-assets/"))

# 006 Kheng Hin (low, plumbing)
drafts.append(draft(6, customers[5],
 "Kitchen & cutlery supply from Yangjiang - OEM available",
 ["Dear Mr. Teo,\n\nWe noted Kheng Hin Hardware at the 139th Canton Fair. KaiLionCrafts is a Yangjiang-based manufacturer of kitchen knives, scissors and kitchen accessories, supplied with OEM/ODM from 100 pcs.",
 "We hold SGS LFGB and FDA certifications and offer factory-direct pricing about 20% below traders. As you carry pipes, valves and hardware, adding a kitchen or cutlery line could be a simple upsell for your customers.",
 "May I send a catalog for your team to review?"],
 ["水暖五金为主，刀剪非核心","以厨房用品补充品类角度"],
 ["Kitchen & cutlery supply from Yangjiang - OEM available",
  "Add a kitchen cutlery line - factory direct",
  "Yangjiang kitchen knives OEM (MOQ 100 pcs)"],
 "您好Teo先生，\n\n我们在139届广交会注意到Kheng Hin Hardware。KaiLionCrafts是阳江厨房刀、剪刀与厨房用品制造商，支持OEM/ODM（100件起）。\n\n我们具备SGS LFGB与FDA认证，工厂直供价较贸易商低约20%。在管材阀门业务之外，补充一条厨房/刀剪产品线，可作为客户连带销售。\n\n能否寄送目录供团队参考？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","认证齐全"],
 "https://kailioncrafts.com/kitchen-accessories/"))

# 007 Key Hardware / Chubb NZ (low)
drafts.append(draft(7, customers[6],
 "General hardware & cutlery sourcing from Yangjiang, China",
 ["Dear Mr. Brown,\n\nWe noted Key Hardware at the 139th Canton Fair. KaiLionCrafts is a direct manufacturer of knives, scissors and general hardware based in Yangjiang, China.",
 "We supply hardware and security retailers with OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing about 20% below traders, plus free product imagery.",
 "May I send our catalog in case you ever add cutlery or general hand tools to your range?"],
 ["Chubb安防/锁具背景","通用五金角度弱接触"],
 ["General hardware & cutlery sourcing from Yangjiang",
  "Factory-direct cutlery & hand tools for NZ retailers",
  "Yangjiang OEM (MOQ 100 pcs)"],
 "您好Brown先生，\n\n我们在139届广交会注意到Key Hardware。KaiLionCrafts是中国阳江刀剪与通用五金直供制造商。\n\n我们为五金与安防零售商提供OEM/ODM（100件起）、SGS LFGB/FDA认证，工厂直供价较贸易商低约20%，并免费提供产品图片。\n\n若贵司未来补充刀剪或通用手动工具，能否寄送目录？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","免费营销素材"],
 "https://kailioncrafts.com/yangjiang-advantage/"))

# 008 Jasco Tools US (low, industrial)
drafts.append(draft(8, customers[7],
 "Cutting tool & hardware supply from Yangjiang, China",
 ["Dear Mr. Summers,\n\nWe noted Jasco Tools at the 139th Canton Fair. KaiLionCrafts is a Yangjiang-based manufacturer of knives, scissors and hand cutting tools, working with tool companies on OEM/ODM.",
 "We offer OEM/ODM from 100 pcs, SGS LFGB and FDA certifications, and factory-direct pricing about 20% below trading companies, with free marketing assets.",
 "If you ever need a cost-competitive additional source for general cutting or edge tools, I would be glad to send a catalog."],
 ["工业切削刀具制造，匹配度低","通用切削/刃具角度弱接触","个人AOL邮箱"],
 ["Cutting tool & hardware supply from Yangjiang",
  "OEM edge tools - factory direct from China",
  "Yangjiang cutlery OEM (MOQ 100 pcs)"],
 "您好Summers先生，\n\n我们在139届广交会注意到Jasco Tools。KaiLionCrafts是阳江刀剪与手动切削工具制造商，为工具公司提供OEM/ODM。\n\n我们提供OEM/ODM（100件起）、SGS LFGB与FDA认证，工厂直供价较贸易商低约20%，并免费提供营销素材。\n\n若贵司需要高性价比的通用切削/刃具补充货源，我乐意寄送目录。",
 ["OEM/ODM MOQ 100pcs","工厂直供价","免费营销素材"],
 "https://kailioncrafts.com/yangjiang-advantage/"))

# 009 K&K Development (kitchenware, US)
drafts.append(draft(9, customers[8],
 "Kitchenware & cutlery sourcing from Yangjiang, China",
 ["Dear K&K Development team,\n\nWe noted your company at the 139th Canton Fair in the kitchenware category. KaiLionCrafts is a direct cutlery and kitchenware supplier based in Yangjiang, China - home to about 75% of China's knife production.",
 "We help US buyers consolidate kitchen knives, scissors and kitchen accessories from four partner factories, with OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing about 20% below traders.",
 "May I send our latest catalog and quote on the kitchen items you currently buy?"],
 ["无联系人，泛化称呼","厨房用品角度","与011为同一客户，勿重复发送"],
 ["Kitchenware & cutlery sourcing from Yangjiang, China",
  "Yangjiang kitchen knives OEM for US buyers",
  "Factory-direct kitchenware - OEM from 100 pcs"],
 "您好K&K Development团队，\n\n我们在139届广交会厨房用品展区注意到贵司。KaiLionCrafts是位于中国阳江的刀剪与厨房用品直供商，阳江约占中国刀具产量75%。\n\n我们帮助美国采购商集中采购厨房刀、剪刀及厨房用品，来自4家合作工厂，支持OEM/ODM（100件起），SGS LFGB/FDA认证，工厂直供价较贸易商低约20%。\n\n能否寄送最新目录，并针对您现有采购的厨房品类报价？",
 ["阳江产业带","一站式采购","OEM/ODM MOQ 100pcs","工厂直供价"],
 "https://kailioncrafts.com/kitchen-accessories/"))

# 010 KPL Precision (low)
drafts.append(draft(10, customers[9],
 "General hardware & cutlery supply from Yangjiang, China",
 ["Dear Mr. Chidge,\n\nWe noted KPL Precision Tool & Die at the 139th Canton Fair. KaiLionCrafts is a Yangjiang-based manufacturer of knives, scissors and general hardware.",
 "We support UK buyers with OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing about 20% below traders, plus free product imagery.",
 "If your network ever needs general hardware or cutlery at factory-direct prices, I would be glad to send our catalog."],
 ["精密模具制造，匹配度低","通用五金角度弱接触"],
 ["General hardware & cutlery supply from Yangjiang",
  "Yangjiang OEM for UK hardware buyers",
  "Factory-direct cutlery (MOQ 100 pcs)"],
 "您好Chidge先生，\n\n我们在139届广交会注意到KPL Precision Tool & Die。KaiLionCrafts是阳江刀剪与通用五金制造商。\n\n我们为英国采购商提供OEM/ODM（100件起）、SGS LFGB/FDA认证，工厂直供价较贸易商低约20%，并免费提供产品图片。\n\n若贵司业务网络需高性价比通用五金或刀剪，我乐意寄送目录。",
 ["OEM/ODM MOQ 100pcs","工厂直供价","免费营销素材"],
 "https://kailioncrafts.com/yangjiang-advantage/"))

# 011 K and K Development (duplicate of 009 - note in aiNotes)
drafts.append(draft(11, customers[10],
 "Kitchenware & cutlery sourcing from Yangjiang, China",
 ["Dear K and K Development team,\n\nWe noted your company at the 139th Canton Fair in the kitchenware category. KaiLionCrafts is a direct cutlery and kitchenware supplier based in Yangjiang, China.",
 "We supply kitchen knives, scissors and kitchen accessories with OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing about 20% below traders.",
 "May I send our latest catalog for your reference?"],
 ["【重复客户】与canton_b2_g3_009同地址同邮箱同传真，建议仅发送一封，勿重复联系",
  "厨房用品角度"],
 ["Kitchenware & cutlery sourcing from Yangjiang, China",
  "Yangjiang kitchen knives OEM for US buyers",
  "Factory-direct kitchenware (MOQ 100 pcs)"],
 "您好K and K Development团队，\n\n我们在139届广交会厨房用品展区注意到贵司。KaiLionCrafts是位于中国阳江的刀剪与厨房用品直供商。\n\n我们供应厨房刀、剪刀及厨房用品，支持OEM/ODM（100件起）、SGS LFGB/FDA认证，工厂直供价较贸易商低约20%。\n\n【注意：该客户与K&K DEVELOPMENT为同一公司，建议只发一封，勿重复联系】\n\n能否寄送最新目录供参考？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","认证齐全"],
 "https://kailioncrafts.com/kitchen-accessories/"))

# 012 Japan NOP (very low - mismatch)
drafts.append(draft(12, customers[11],
 "Cutlery & hardware OEM from Yangjiang, China",
 ["Dear Mr. Munekiyo,\n\nWe noted your company at the 139th Canton Fair. KaiLionCrafts is a Yangjiang-based manufacturer of knives, scissors and kitchenware, supplying the Japanese market under OEM/ODM.",
 "We offer OEM/ODM from 100 pcs, SGS LFGB and FDA certifications and factory-direct pricing. If your group ever trades general hardware or kitchen goods alongside your industrial line, we can support with reliable supply.",
 "May I send our catalog for reference?"],
 ["工业油泵(NOP=Nippon Oil Pump)，与登记厨房用品不符，匹配度极低","仅存档弱触达"],
 ["Cutlery & hardware OEM from Yangjiang, China",
  "Yangjiang OEM supply for Japanese buyers",
  "Factory-direct kitchenware (MOQ 100 pcs)"],
 "您好Munekiyo先生，\n\n我们在139届广交会注意到贵司。KaiLionCrafts是阳江刀剪与厨房用品制造商，以OEM/ODM供应日本市场。\n\n我们提供OEM/ODM（100件起）、SGS LFGB与FDA认证、工厂直供价。若贵司在工业产品之外也经营通用五金或厨房用品，我们可提供稳定供货。\n\n【备注：该司实际为工业油泵方向，匹配度低】\n\n能否寄送目录供参考？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","认证齐全"],
 "https://kailioncrafts.com/yangjiang-advantage/"))

# 013 Japan Lotus China (best lead, Chinese contact)
drafts.append(draft(13, customers[12],
 "中国阳江直采刀剪/厨房用品 - 供日本市场OEM",
 ["Dear Zhou He,\n\nWe noted Japan Lotus China at the 139th Canton Fair. As a China-Japan trading company, you likely source kitchen goods from China - KaiLionCrafts is a direct cutlery and kitchenware factory in Yangjiang, China, the source of about 75% of China's knives.",
 "We support export to Japan with OEM/ODM from 100 pcs, SGS LFGB and FDA certifications, factory-direct pricing about 20% below traders, and free product photos and videos. We can also brand our factory video with your logo.",
 "Could I send a catalog and quote? Happy to discuss on WhatsApp in Chinese."],
 ["本组优质线索，在日华人贸易商","中文沟通友好+中国直采","强调出口日本认证齐全"],
 ["中国阳江直采刀剪/厨房用品 - 供日本OEM",
  "Yangjiang cutlery factory - OEM for Japan market",
  "直供日本：厨房刀剪OEM，MOQ 100件起"],
 "您好周先生，\n\n我们在139届广交会注意到Japan Lotus China。作为中日贸易公司，贵司应从中国采购厨房用品——KaiLionCrafts是位于中国阳江的刀剪与厨房用品直供工厂，阳江约占中国刀具产量75%。\n\n我们支持对日出口：OEM/ODM（100件起）、SGS LFGB与FDA认证，工厂直供价较贸易商低约20%，免费提供产品图片与视频，并可在工厂宣传片上打贵司Logo。\n\n能否寄送目录并报价？可在WhatsApp用中文详谈。",
 ["阳江产业带","对日出口认证齐全","OEM/ODM MOQ 100pcs","工厂直供价","免费营销素材/工厂视频打Logo"],
 "https://kailioncrafts.com/oem-odm/"))

# 014 J.E.Z. International (small, US)
drafts.append(draft(14, customers[13],
 "Kitchenware & cutlery factory-direct from Yangjiang, China",
 ["Dear J.E.Z. International Trading team,\n\nWe noted your company at the 139th Canton Fair in the kitchenware category. KaiLionCrafts is a direct cutlery and kitchenware supplier in Yangjiang, China.",
 "We help small importers buy kitchen knives, scissors and accessories with OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing about 20% below traders, plus free marketing images.",
 "May I send our catalog - it is easy to start with a small mixed order?"],
 ["小型个人贸易(netzero邮箱)","强调小批量混柜友好","泛化称呼"],
 ["Kitchenware & cutlery factory-direct from Yangjiang",
  "Yangjiang kitchenware OEM - small orders welcome",
  "Factory-direct cutlery (MOQ 100 pcs)"],
 "您好J.E.Z. International Trading团队，\n\n我们在139届广交会厨房用品展区注意到贵司。KaiLionCrafts是中国阳江刀剪与厨房用品直供商。\n\n我们帮助小型进口商采购厨房刀、剪刀及用品，支持OEM/ODM（100件起）、SGS LFGB/FDA认证，工厂直供价较贸易商低约20%，并免费提供营销图片。\n\n能否寄送目录？从小批量混单开始很方便。",
 ["OEM/ODM MOQ 100pcs","工厂直供价","一站式混柜","免费营销素材"],
 "https://kailioncrafts.com/kitchen-accessories/"))

# 015 J&N Hardware SG (small)
drafts.append(draft(15, customers[14],
 "Flexible hardware & cutlery supply from Yangjiang, China",
 ["Dear Mr. Ng,\n\nWe noted J&N Hardware & Engineering at the 139th Canton Fair. KaiLionCrafts is a Yangjiang-based manufacturer of knives, scissors and general hardware.",
 "We offer flexible OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing about 20% below traders, with free product imagery to support your sales.",
 "May I send a catalog and small-batch pricing for hardware or cutlery lines?"],
 ["小型五金工程合伙企业","小批量灵活角度"],
 ["Flexible hardware & cutlery supply from Yangjiang",
  "Yangjiang OEM for Singapore hardware firms",
  "Factory-direct cutlery (MOQ 100 pcs)"],
 "您好Ng先生，\n\n我们在139届广交会注意到J&N Hardware & Engineering。KaiLionCrafts是阳江刀剪与通用五金制造商。\n\n我们提供灵活OEM/ODM（100件起）、SGS LFGB/FDA认证，工厂直供价较贸易商低约20%，并免费提供产品图片支持销售。\n\n能否寄送目录，并提供五金/刀剪线的小批量报价？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","免费营销素材"],
 "https://kailioncrafts.com/yangjiang-advantage/"))

# 016 IRWIN (high value, brand/OEM angle)
drafts.append(draft(16, customers[15],
 "OEM cutting & shear tooling partner - Yangjiang, China (SGS/FDA)",
 ["Dear Peter,\n\nI noticed IRWIN's continued growth in hand tools and cutting instruments. KaiLionCrafts is a Yangjiang-based OEM manufacturer of knives, scissors and shear-type cutting tools, serving global tool brands under strict quality requirements.",
 "Our four partner factories hold SGS LFGB and FDA certifications, run OEM/ODM from 100 pcs with founder-direct management (no sales layer), and we provide factory videos that can carry your own branding - valuable for audit and onboarding. Yangjiang alone produces about 75% of China's cutlery.",
 "Would you be open to a short conversation about our capacity as an additional OEM source for your cutting/shear tooling?"],
 ["最高价值线索，Stanley/IRWIN大品牌","切入剪切/剪刀类补充供应链","强调认证/验厂/工厂视频打Logo","预期周期长"],
 ["OEM cutting & shear tooling partner - Yangjiang (SGS/FDA)",
  "Yangjiang OEM for hand-tool brands - audit-ready",
  "Additional cutlery/shear OEM source for IRWIN"],
 "您好Peter，\n\n我们关注到IRWIN在手工具与切削工具领域的持续发展。KaiLionCrafts是阳江的刀剪与剪切类工具OEM制造商，以严格品质要求服务全球工具品牌。\n\n我们4家合作工厂具备SGS LFGB与FDA认证，OEM/ODM 100件起，创始人直接对接（无销售中间层），并可提供打上贵司Logo的工厂视频，便于验厂与导入。阳江约占中国刀剪产量75%。\n\n是否方便简短沟通，了解我们作为贵司剪切/刃具类补充OEM货源的能力？",
 ["OEM/ODM","认证齐全(SGS LFGB/FDA)","工厂宣传片打客户Logo","创始人直接对接","阳江产业带"],
 "https://kailioncrafts.com/oem-odm/"))

# 017 Intl Hardware Electrical SG (low)
drafts.append(draft(17, customers[16],
 "Hardware & cutlery supply from Yangjiang, China",
 ["Dear International Hardware Electrical & Construction team,\n\nWe noted your company at the 139th Canton Fair. KaiLionCrafts is a Yangjiang-based manufacturer of knives, scissors and general hardware.",
 "We offer OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing about 20% below traders, plus free product imagery.",
 "If you ever need general hardware or cutlery at factory-direct prices, may I send our catalog?"],
 ["建筑/五金电气方向，匹配度低","hotmail个人邮箱","通用角度弱触达"],
 ["Hardware & cutlery supply from Yangjiang, China",
  "Factory-direct general hardware OEM",
  "Yangjiang cutlery (MOQ 100 pcs)"],
 "您好International Hardware Electrical & Construction团队，\n\n我们在139届广交会注意到贵司。KaiLionCrafts是阳江刀剪与通用五金制造商。\n\n我们提供OEM/ODM（100件起）、SGS LFGB/FDA认证，工厂直供价较贸易商低约20%，并免费提供产品图片。\n\n若贵司需要高性价比通用五金或刀剪，能否寄送目录？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","免费营销素材"],
 "https://kailioncrafts.com/yangjiang-advantage/"))

# 018 Huang Hardware SG (struck off - verify)
drafts.append(draft(18, customers[17],
 "Hardware & cutlery supply from Yangjiang, China",
 ["Dear Mr. Ang,\n\nWe noted Huang Hardware Trading at the 139th Canton Fair. KaiLionCrafts is a Yangjiang-based manufacturer of knives, scissors and general hardware.",
 "We support hardware traders with OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing about 20% below traders, plus free product images and videos.",
 "May I send our catalog and small-batch pricing?"],
 ["注意：RecordOwl显示该公司状态Struck Off(已注销)，发送前先核实经营状态","通用五金角度"],
 ["Hardware & cutlery supply from Yangjiang, China",
  "Yangjiang OEM for Singapore hardware traders",
  "Factory-direct cutlery (MOQ 100 pcs)"],
 "您好Ang先生，\n\n我们在139届广交会注意到Huang Hardware Trading。KaiLionCrafts是阳江刀剪与通用五金制造商。\n\n我们为五金贸易商提供OEM/ODM（100件起）、SGS LFGB/FDA认证，工厂直供价较贸易商低约20%，并免费提供产品图片与视频。\n\n【备注：公开记录显示该公司或已注销，发送前请先电话核实是否仍经营】\n\n能否寄送目录并提供小批量报价？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","免费营销素材"],
 "https://kailioncrafts.com/yangjiang-advantage/"))

# 019 HTL Hardware NZ (medium retail)
drafts.append(draft(19, customers[18],
 "Differentiated hand tools & kitchenware for NZ hardware stores",
 ["Dear Kevin,\n\nWe noted HTL Hardware at the 139th Canton Fair. KaiLionCrafts is a Yangjiang-based manufacturer of hand tools, knives, scissors and kitchen accessories, supplying hardware retailers.",
 "We offer OEM/ODM from 100 pcs, SGS LFGB/FDA certification and factory-direct pricing about 20% below traders. As a local retailer competing with the big chains, our free product photos, videos and factory branding can help you build your own range.",
 "May I send a catalog and small-batch pricing tailored to a local hardware store?"],
 ["新西兰本地五金零售","强调差异化+免费素材对抗连锁大连锁","企业域名邮箱质量好"],
 ["Differentiated hand tools & kitchenware for NZ hardware stores",
  "Yangjiang OEM for local NZ hardware retailers",
  "Factory-direct cutlery - free marketing assets included"],
 "您好Kevin，\n\n我们在139届广交会注意到HTL Hardware。KaiLionCrafts是阳江手动工具、刀剪与厨房用品制造商，供应五金零售门店。\n\n我们提供OEM/ODM（100件起）、SGS LFGB/FDA认证，工厂直供价较贸易商低约20%。作为与大连锁竞争的本地零售店，我们免费提供产品图片、视频与工厂品牌素材，帮助您打造自有产品线。\n\n能否寄送目录，并提供适合本地五金店的小批量报价？",
 ["OEM/ODM MOQ 100pcs","工厂直供价","免费营销素材/工厂视频打Logo"],
 "https://kailioncrafts.com/free-marketing-assets/"))

result = {"customers": customers, "drafts": drafts}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print("customers:", len(customs) if False else len(customers))
print("drafts:", len(drafts))
print("saved:", OUT)
# quick wordcount sanity
for d in drafts:
    assert d["wordCount"] <= 150, (d["id"], d["wordCount"])
print("all drafts <=150 words OK")
