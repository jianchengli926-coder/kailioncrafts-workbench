# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - 配置文件
"""
import os
from pathlib import Path

# 加载.env文件
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

# ============ 路径配置 ============
BASE_DIR = Path(__file__).parent
KB_DIR = BASE_DIR.parent  # 标准化知识库根目录
DATA_DIR = BASE_DIR / "data"
CUSTOMERS_FILE = DATA_DIR / "customers.json"

# 多知识库源
KB_SOURCES = {
    "standard": {
        "name": "标准化知识库（AI优化版）",
        "path": KB_DIR,
        "description": "经过AI整理的核心文档，含独立站知识库、外贸技巧，推荐优先使用",
    },
    "feishu": {
        "name": "飞书公司知识库（完整版）",
        "path": Path("/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/飞书锴利公司知识库_副本/02_精简版飞书上传包_KailionCrafts知识库"),
        "description": "16000+文件的完整公司知识库，含产品图片、SEO资料、财务等",
    },
    "trade_learning": {
        "name": "外贸学习资料库（456份）",
        "path": Path("/Users/a123/Desktop/锴利外贸学习初文档"),
        "description": "外贸学习文档456份，含谈客户技巧、谈判报价、邮件开发、社媒运营等",
    },
    "website": {
        "name": "独立站知识库（159页）",
        "path": KB_DIR / "11_独立站知识库",
        "description": "从kailioncrafts.com备份提取，24个页面+128个产品+7篇博客",
    },
    "codex": {
        "name": "Codex工作流库（亚马逊运营）",
        "path": Path("/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/Codex-工作流Skill_副本"),
        "description": "659个md文档，含蓝海产品调研、关键词库、Listing优化、广告策略、VOC洞察等15个Skill",
    },
    "website_materials": {
        "name": "独立站前期资料库（176份）",
        "path": Path("/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/独立站资料转markdown"),
        "description": "独立站建设前期积累的176份资料，含About页面多版本、建站全案、行业指南",
    },
    "sku_seo": {
        "name": "SKU产品与SEO知识库",
        "path": KB_DIR / "14_SKU产品与SEO知识库",
        "description": "220种钢材、289+个SKU、186个SEO关键词文件、2094张产品图片索引",
    },
    "products": {
        "name": "产品图片与SEO知识库（127个产品）",
        "path": KB_DIR / "15_产品图片与SEO知识库",
        "description": "127个已上架产品，827张SEO优化图片，含完整SEO标题/描述/替代文本",
    },
    "customer_service": {
        "name": "客服问答与翻译知识库",
        "path": KB_DIR / "16_客服问答与翻译知识库",
        "description": "客户常见问答FAQ、产品规格、专业术语、外贸邮件表达、Dify工作流配置",
    },
    "blog": {
        "name": "博客文章与内容营销知识库",
        "path": KB_DIR / "17_博客文章与内容营销知识库",
        "description": "6大内容方向、100+文章标题、标准化生成指令、SEO规范",
    },
    "yangjiang": {
        "name": "阳江项目与创始人知识库",
        "path": KB_DIR / "18_阳江项目与创始人知识库",
        "description": "公司创始人介绍、创业大赛、采访纪要、协会讲座课程、演讲稿、政府项目",
    },
}

# 知识库搜索配置
KB_SEARCH_CONFIG = {
    "max_results": 20,
    "max_content_length": 3000,
    "supported_extensions": [".md", ".txt", ".csv"],
    "skip_dirs": ["node_modules", ".git", "__pycache__", "99_技术缓存", "98_待人工确认", "08_财务对账"],
}

# ============ AI模型配置 ============
# 支持豆包（火山引擎方舟）和OpenAI兼容接口
AI_PROVIDER = os.getenv("AI_PROVIDER", "doubao")  # doubao / openai

# 豆包配置（火山引擎方舟）
DOUBAO_API_KEY = os.getenv("DOUBAO_API_KEY", "")
DOUBAO_BASE_URL = os.getenv("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
DOUBAO_MODEL = os.getenv("DOUBAO_MODEL", "doubao-pro-32k")  # 主力模型
DOUBAO_MODEL_LITE = os.getenv("DOUBAO_MODEL_LITE", "doubao-lite-32k")  # 轻量任务

# OpenAI兼容配置（如Codex/GPT/DeepSeek/Kimi/通义/智谱等）
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
OPENAI_MODEL_LITE = os.getenv("OPENAI_MODEL_LITE", os.getenv("OPENAI_MODEL", "gpt-4o"))

# ============ 公司信息 ============
COMPANY = {
    "name_cn": "阳江市锴利国际贸易有限公司",
    "name_en": "Yangjiang Kaili International Trading Co., Ltd.",
    "brand": "KaiLionCrafts",
    "brand_cn": "锴利匠心",
    "founder": "李建成 (Leo Li)",
    "location": "广东省阳江市阳东区",
    "website": "https://kailioncrafts.com",
    "email": "sales@kailioncrafts.com",
    "positioning": "AI驱动的数字化五金刀剪供应链服务商",
    "slogan": "Forged in Yangjiang, Trusted Worldwide",
    "categories": ["厨房刀具", "专业剪刀", "户外刀具", "厨房用品"],
}

# ============ 团队成员配置 ============
TEAM_MEMBERS = {
    "leo": {
        "name": "Leo Li",
        "name_cn": "李建成",
        "role": "创始人 / CEO",
        "role_en": "Founder & CEO",
        "category": "户外刀具",
        "category_en": "Outdoor Knives",
        "avatar": "",  # 预留照片位置
        "contacts": {
            "gmail": "kailioncrafts01@gmail.com",
            "outlook": "kailioncrafts01@outlook.com",
            "company_email": "founder@kailioncrafts.com",
            "whatsapp": "+8613421295360",
            "wechat": "+8613138006564",
        },
        "social_media": {
            "facebook": "kailioncrafts01@outlook.com",
            "instagram": "kailioncrafts01@outlook.com",
            "youtube": "kailioncrafts01@gmail.com",
            "tiktok": "kailioncrafts01@gmail.com",
            "x": "kailioncrafts01@gmail.com",
            "linkedin": "kailioncrafts01@gmail.com",
            "pinterest": "kailioncrafts01@gmail.com",
            "message": "kailioncrafts01@outlook.com",
        },
        "workspace_dir": "team_workspaces/leo",
    },
    "jason": {
        "name": "Jason Li",
        "name_cn": "李杰森",
        "role": "厨房刀具负责人",
        "role_en": "Kitchen Knives Manager",
        "category": "厨房刀具",
        "category_en": "Kitchen Knives",
        "avatar": "",
        "contacts": {
            "gmail": "kailioncrafts01@gmail.com",
            "outlook": "kailioncrafts01@outlook.com",
            "company_email": "founder@kailioncrafts.com",
            "whatsapp": "+8615622003719",
            "wechat": "+8619328869295",
        },
        "social_media": {
            "facebook": "kailioncrafts02@outlook.com",
            "instagram": "kailioncrafts02@outlook.com",
            "youtube": "kailioncrafts01@gmail.com",
            "tiktok": "kailioncrafts01@gmail.com",
            "x": "kailioncrafts01@gmail.com",
            "linkedin": "kailioncrafts01@gmail.com",
            "pinterest": "kailioncrafts01@gmail.com",
            "message": "kailioncrafts01@outlook.com",
        },
        "workspace_dir": "team_workspaces/jason",
    },
    "owen": {
        "name": "Owen Li",
        "name_cn": "李欧文",
        "role": "专业剪刀负责人",
        "role_en": "Professional Scissors Manager",
        "category": "专业剪刀",
        "category_en": "Professional Scissors",
        "avatar": "",
        "contacts": {
            "gmail": "kailioncrafts01@gmail.com",
            "outlook": "kailioncrafts01@outlook.com",
            "company_email": "founder@kailioncrafts.com",
            "whatsapp": "+8613250692628",
            "wechat": "+8613302492373",
        },
        "social_media": {
            "facebook": "kailioncrafts01@gmail.com",
            "instagram": "kailioncrafts01@gmail.com",
            "youtube": "kailioncrafts01@gmail.com",
            "tiktok": "kailioncrafts01@gmail.com",
            "x": "kailioncrafts01@gmail.com",
            "linkedin": "kailioncrafts01@gmail.com",
            "pinterest": "kailioncrafts01@gmail.com",
            "message": "kailioncrafts01@gmail.com",
        },
        "workspace_dir": "team_workspaces/owen",
    },
    "julia": {
        "name": "Julia Zhong",
        "name_cn": "钟朱莉",
        "role": "厨房用品负责人",
        "role_en": "Kitchen Accessories Manager",
        "category": "厨房用品",
        "category_en": "Kitchen Accessories",
        "avatar": "",
        "contacts": {
            "gmail": "kailioncrafts01@gmail.com",
            "outlook": "kailioncrafts01@outlook.com",
            "company_email": "founder@kailioncrafts.com",
            "whatsapp": "+8613078380629",
            "wechat": "+8615622003619",
        },
        "social_media": {
            "facebook": "kailioncrafts01@gmail.com",
            "instagram": "kailioncrafts01@gmail.com",
            "youtube": "kailioncrafts01@gmail.com",
            "tiktok": "kailioncrafts01@gmail.com",
            "x": "kailioncrafts01@gmail.com",
            "linkedin": "kailioncrafts01@gmail.com",
            "pinterest": "kailioncrafts01@gmail.com",
            "message": "kailioncrafts01@gmail.com",
        },
        "workspace_dir": "team_workspaces/julia",
    },
}

# 社交媒体图标和链接模板
SOCIAL_MEDIA_ICONS = {
    "facebook": {"icon": "📘", "name": "Facebook", "url_template": "https://facebook.com/{}"},
    "instagram": {"icon": "📷", "name": "Instagram", "url_template": "https://instagram.com/{}"},
    "youtube": {"icon": "▶️", "name": "YouTube", "url_template": "https://youtube.com/@{}"},
    "tiktok": {"icon": "🎵", "name": "TikTok", "url_template": "https://tiktok.com/@{}"},
    "x": {"icon": "🐦", "name": "X (Twitter)", "url_template": "https://x.com/{}"},
    "linkedin": {"icon": "💼", "name": "LinkedIn", "url_template": "https://linkedin.com/in/{}"},
    "pinterest": {"icon": "📌", "name": "Pinterest", "url_template": "https://pinterest.com/{}"},
    "whatsapp": {"icon": "💬", "name": "WhatsApp", "url_template": "https://wa.me/{}"},
    "email": {"icon": "📧", "name": "Email", "url_template": "mailto:{}"},
    "wechat": {"icon": "💚", "name": "WeChat", "url_template": ""},
    "message": {"icon": "✉️", "name": "Message", "url_template": "mailto:{}"},
}

# ============ 开发信配置 ============
EMAIL_CONFIG = {
    "max_length": 200,  # 开发信最大词数
    "follow_up_days": [1, 3, 7, 14],  # 跟进天数
    "languages": ["English", "Spanish", "French", "German", "Japanese"],
}

# ============ 客户分级 ============
CUSTOMER_GRADES = {
    "A": {"score_min": 80, "label": "高价值客户", "color": "green", "action": "立即重点跟进"},
    "B": {"score_min": 60, "label": "潜力客户", "color": "blue", "action": "常规跟进"},
    "C": {"score_min": 40, "label": "一般客户", "color": "orange", "action": "低频触达"},
    "D": {"score_min": 0, "label": "低优先级", "color": "gray", "action": "暂不跟进"},
}

# ============ 知识库文件路径 ============
KB_FILES = {
    "company_profile": KB_DIR / "01_公司与品牌" / "公司简介与创始人_超级融合最终版.md",
    "factory": KB_DIR / "02_工厂与供应链" / "工厂背景资料.md",
    "pain_points": KB_DIR / "06_营销与客户开发" / "客户痛点" / "Why_Global_Buyers_Choose_KaiLionCrafts.md",
    "faq": KB_DIR / "06_营销与客户开发" / "FAQ" / "客户常见问答库FAQ.md",
    "email_templates": KB_DIR / "06_营销与客户开发" / "外贸邮件" / "外贸邮件回复与表达库.md",
    "terminology": KB_DIR / "03_产品知识库" / "术语库" / "KaiLion标准术语库.md",
    "product_specs": KB_DIR / "03_产品知识库" / "规格参数" / "产品规格参数库.md",
    "sku_data": KB_DIR / "03_产品知识库" / "SKU数据" / "四大品类SKU_SEO产品目录_200条.csv",
    "marketing": KB_DIR / "06_营销与客户开发" / "营销文案" / "五金刀剪行业营销文案库.md",
    "market_strategy": KB_DIR / "06_营销与客户开发" / "市场策略" / "市场主攻策略.md",
}

# ============ 配置保存功能 ============
ENV_FILE = BASE_DIR / ".env"

# 所有支持的AI提供商（绝大多数提供OpenAI兼容接口）
ALL_PROVIDERS = {
    "doubao": {
        "name": "豆包（火山引擎方舟）",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "models": [
            {"name": "doubao-seed-2-1-turbo-260628", "desc": "推理模型（推荐，能力强）"},
            {"name": "doubao-pro-32k", "desc": "专业版（长上下文）"},
            {"name": "doubao-lite-32k", "desc": "轻量版（速度快、成本低）"},
            {"name": "doubao-1-5-pro-32k-250115", "desc": "1.5专业版"},
            {"name": "doubao-1-5-lite-32k-250115", "desc": "1.5轻量版"},
            {"name": "doubao-vision-pro-32k", "desc": "视觉理解模型"},
        ],
        "signup_url": "https://console.volcengine.com/ark",
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "models": [
            {"name": "gpt-4o", "desc": "GPT-4o（多模态、能力强）"},
            {"name": "gpt-4o-mini", "desc": "GPT-4o mini（速度快、成本低）"},
            {"name": "gpt-4-turbo", "desc": "GPT-4 Turbo"},
            {"name": "gpt-3.5-turbo", "desc": "GPT-3.5 Turbo（性价比高）"},
        ],
        "signup_url": "https://platform.openai.com/api-keys",
    },
    "deepseek": {
        "name": "DeepSeek（深度求索）",
        "base_url": "https://api.deepseek.com/v1",
        "models": [
            {"name": "deepseek-chat", "desc": "DeepSeek-V3（通用对话）"},
            {"name": "deepseek-reasoner", "desc": "DeepSeek-R1（推理模型）"},
        ],
        "signup_url": "https://platform.deepseek.com/api_keys",
    },
    "moonshot": {
        "name": "月之暗面（Kimi）",
        "base_url": "https://api.moonshot.cn/v1",
        "models": [
            {"name": "moonshot-v1-128k", "desc": "Kimi（128K长上下文）"},
            {"name": "moonshot-v1-32k", "desc": "Kimi（32K上下文）"},
            {"name": "moonshot-v1-8k", "desc": "Kimi（8K上下文，速度快）"},
        ],
        "signup_url": "https://platform.moonshot.cn/console/api-keys",
    },
    "qwen": {
        "name": "通义千问（阿里DashScope）",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "models": [
            {"name": "qwen-max", "desc": "Qwen-Max（旗舰模型）"},
            {"name": "qwen-plus", "desc": "Qwen-Plus（均衡型）"},
            {"name": "qwen-turbo", "desc": "Qwen-Turbo（速度快、成本低）"},
            {"name": "qwen-long", "desc": "Qwen-Long（超长上下文）"},
            {"name": "qwen-vl-max", "desc": "Qwen-VL（视觉理解）"},
        ],
        "signup_url": "https://dashscope.console.aliyun.com/apiKey",
    },
    "zhipu": {
        "name": "智谱清言（GLM）",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "models": [
            {"name": "glm-4-plus", "desc": "GLM-4 Plus（旗舰）"},
            {"name": "glm-4", "desc": "GLM-4"},
            {"name": "glm-4-air", "desc": "GLM-4 Air（轻量高速）"},
            {"name": "glm-4-flash", "desc": "GLM-4 Flash（免费/极快）"},
            {"name": "glm-4v", "desc": "GLM-4V（视觉理解）"},
        ],
        "signup_url": "https://open.bigmodel.cn/usercenter/apikeys",
    },
    "ernie": {
        "name": "文心一言（百度）",
        "base_url": "https://qianfan.baidubce.com/v2",
        "models": [
            {"name": "ernie-4.5-turbo", "desc": "文心4.5 Turbo"},
            {"name": "ernie-4.0", "desc": "文心4.0"},
            {"name": "ernie-3.5-turbo", "desc": "文心3.5 Turbo（性价比高）"},
            {"name": "ernie-speed", "desc": "文心Speed（速度快）"},
        ],
        "signup_url": "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application",
    },
    "spark": {
        "name": "讯飞星火",
        "base_url": "https://spark-api-open.xf-yun.com/v1",
        "models": [
            {"name": "generalv3.5", "desc": "星火V3.5"},
            {"name": "generalv3", "desc": "星火V3.0"},
            {"name": "4.0Ultra", "desc": "星火4.0 Ultra"},
        ],
        "signup_url": "https://console.xfyun.cn/services/bm35",
    },
    "claude": {
        "name": "Claude（Anthropic）",
        "base_url": "https://api.anthropic.com/v1",
        "models": [
            {"name": "claude-3-5-sonnet-20241022", "desc": "Claude 3.5 Sonnet（推荐）"},
            {"name": "claude-3-opus-20240229", "desc": "Claude 3 Opus（最强）"},
            {"name": "claude-3-haiku-20240307", "desc": "Claude 3 Haiku（速度快）"},
        ],
        "signup_url": "https://console.anthropic.com/settings/keys",
        "note": "Claude使用非标准API格式，建议通过OpenAI兼容代理接入",
    },
    "gemini": {
        "name": "Gemini（Google）",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "models": [
            {"name": "gemini-1.5-pro", "desc": "Gemini 1.5 Pro"},
            {"name": "gemini-1.5-flash", "desc": "Gemini 1.5 Flash（速度快）"},
            {"name": "gemini-2.0-flash", "desc": "Gemini 2.0 Flash"},
        ],
        "signup_url": "https://aistudio.google.com/apikey",
    },
    "minimax": {
        "name": "MiniMax（海螺）",
        "base_url": "https://api.minimax.chat/v1",
        "models": [
            {"name": "MiniMax-Text-01", "desc": "MiniMax文本模型"},
            {"name": "abab6.5s-chat", "desc": "abab6.5s（速度快）"},
            {"name": "abab6.5-chat", "desc": "abab6.5"},
        ],
        "signup_url": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    },
    "stepfun": {
        "name": "阶跃星辰（StepFun）",
        "base_url": "https://api.stepfun.com/v1",
        "models": [
            {"name": "step-2", "desc": "Step 2（推理模型）"},
            {"name": "step-1-8k", "desc": "Step 1（8K）"},
            {"name": "step-1-32k", "desc": "Step 1（32K）"},
            {"name": "step-1-256k", "desc": "Step 1（256K超长上下文）"},
        ],
        "signup_url": "https://platform.stepfun.com/account/keys",
    },
    "yi": {
        "name": "零一万物（Yi）",
        "base_url": "https://api.lingyiwanwu.com/v1",
        "models": [
            {"name": "yi-large", "desc": "Yi-Large（旗舰）"},
            {"name": "yi-medium", "desc": "Yi-Medium（均衡）"},
            {"name": "yi-spark", "desc": "Yi-Spark（轻量高速）"},
            {"name": "yi-vision", "desc": "Yi-Vision（视觉理解）"},
        ],
        "signup_url": "https://platform.lingyiwanwu.com/apikeys",
    },
    "sensenova": {
        "name": "商汤日日新（SenseNova）",
        "base_url": "https://api.sensenova.cn/v1/llm",
        "models": [
            {"name": "SenseChat-5", "desc": "SenseChat 5.0"},
            {"name": "SenseChat-Turbo", "desc": "SenseChat Turbo（速度快）"},
        ],
        "signup_url": "https://console.sensetime.com/",
    },
    "ollama": {
        "name": "Ollama（本地模型）",
        "base_url": "http://localhost:11434/v1",
        "models": [
            {"name": "llama3.1", "desc": "Llama 3.1（Meta开源）"},
            {"name": "qwen2.5", "desc": "Qwen 2.5（阿里开源）"},
            {"name": "deepseek-r1", "desc": "DeepSeek R1（推理）"},
            {"name": "mistral", "desc": "Mistral"},
            {"name": "gemma2", "desc": "Gemma 2（Google开源）"},
        ],
        "signup_url": "https://ollama.com/download",
        "note": "需要本地安装Ollama并拉取模型，完全离线免费",
    },
    "custom": {
        "name": "自定义/其他OpenAI兼容接口",
        "base_url": "",
        "models": [],
        "signup_url": "",
        "note": "任何提供OpenAI兼容接口的服务都可以填入",
    },
}

def save_config(provider, api_key, base_url, model, model_lite=""):
    """
    保存AI配置到.env文件（统一使用OpenAI兼容接口格式）
    Args:
        provider: 提供商key（如doubao, deepseek, qwen等）
        api_key: API密钥
        base_url: API地址
        model: 主力模型
        model_lite: 轻量模型（可选，默认同主力模型）
    """
    if not model_lite:
        model_lite = model

    provider_name = ALL_PROVIDERS.get(provider, {}).get("name", provider)

    content = f"""# KaiLionCrafts AI客户开发工作台 - 环境变量配置
# 由工作台设置页面自动生成
# 当前提供商：{provider_name}

# ============ AI提供商选择 ============
AI_PROVIDER={provider}

# ============ API配置（OpenAI兼容接口） ============
OPENAI_API_KEY={api_key}
OPENAI_BASE_URL={base_url}
OPENAI_MODEL={model}
OPENAI_MODEL_LITE={model_lite}

# ============ 豆包配置（保留兼容） ============
DOUBAO_API_KEY={api_key if provider == "doubao" else ""}
DOUBAO_BASE_URL={base_url if provider == "doubao" else "https://ark.cn-beijing.volces.com/api/v3"}
DOUBAO_MODEL={model if provider == "doubao" else "doubao-pro-32k"}
DOUBAO_MODEL_LITE={model_lite if provider == "doubao" else "doubao-lite-32k"}
"""

    ENV_FILE.write_text(content, encoding="utf-8")

    # 更新当前运行时的配置
    global AI_PROVIDER, DOUBAO_API_KEY, DOUBAO_BASE_URL, DOUBAO_MODEL, DOUBAO_MODEL_LITE
    global OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL

    AI_PROVIDER = provider
    OPENAI_API_KEY = api_key
    OPENAI_BASE_URL = base_url
    OPENAI_MODEL = model

    if provider == "doubao":
        DOUBAO_API_KEY = api_key
        DOUBAO_BASE_URL = base_url
        DOUBAO_MODEL = model
        DOUBAO_MODEL_LITE = model_lite

    return True


def get_current_config():
    """获取当前配置（用于设置页面回显）"""
    provider = AI_PROVIDER
    if provider == "doubao":
        return {
            "provider": "doubao",
            "api_key": DOUBAO_API_KEY,
            "base_url": DOUBAO_BASE_URL,
            "model": DOUBAO_MODEL,
            "model_lite": DOUBAO_MODEL_LITE,
        }
    else:
        return {
            "provider": provider if provider in ALL_PROVIDERS else "custom",
            "api_key": OPENAI_API_KEY,
            "base_url": OPENAI_BASE_URL,
            "model": OPENAI_MODEL,
            "model_lite": "",
        }


# 兼容旧接口
MODEL_PRESETS = {k: v["models"] for k, v in ALL_PROVIDERS.items() if v["models"]}
BASE_URL_PRESETS = {k: [v["base_url"]] for k, v in ALL_PROVIDERS.items() if v["base_url"]}
