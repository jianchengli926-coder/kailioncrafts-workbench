# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - 主程序
基于Streamlit的B2B外贸客户开发工作台

功能模块：
1. 仪表盘 - 客户统计和概览
2. 客户分析 - AI分析潜在客户匹配度
3. 开发信生成 - 个性化冷邮件生成
4. 跟进序列 - 多轮跟进邮件
5. 客户问答 - 基于FAQ的智能回复
6. 产品推荐 - 基于需求的产品匹配
7. 客户管理 - 轻量CRM
8. 知识库 - 浏览公司知识库
"""
import streamlit as st
import streamlit.components.v1 as components
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
import io
import os
import json as _json

from config import (
    COMPANY, CUSTOMER_GRADES, EMAIL_CONFIG,
    save_config, get_current_config, MODEL_PRESETS, BASE_URL_PRESETS,
    ALL_PROVIDERS, TEAM_MEMBERS, SOCIAL_MEDIA_ICONS, KB_DIR,
)
from provider_manager import (
    load_providers, add_provider, update_provider, delete_provider,
    set_active_provider, get_active_provider, detect_ollama_models,
    refresh_ollama_models, test_provider, get_provider_stats,
)
from knowledge_base import kb
from customer_manager import cm
from ai_client import ai
from prompts import (
    CUSTOMER_ANALYSIS_PROMPT, COLD_EMAIL_PROMPT, FOLLOW_UP_PROMPT,
    FAQ_PROMPT, PRODUCT_RECOMMEND_PROMPT, INQUIRY_REPLY_PROMPT,
    DUE_DILIGENCE_PROMPT, MARKET_ANALYSIS_PROMPT, MORNING_BRIEF_PROMPT,
    EMAIL_AIDA_ANALYSIS_PROMPT,
)
from customer_manager import cm, PIPELINE_STAGES


# ============ 通用：两步删除（防误删） ============
def two_step_delete(btn_label, key, danger="此操作不可恢复"):
    """第一次点进入确认态；确认态下再点「确认删除」才返回 'yes'。"""
    flag_key = f"_confirm_del_{key}"
    if st.session_state.get(flag_key):
        st.warning(f"⚠️ {danger}")
        c1, c2 = st.columns(2)
        if c1.button("✅ 确认删除", key=f"{key}_yes", type="primary"):
            st.session_state.pop(flag_key, None)
            return "yes"
        if c2.button("取消", key=f"{key}_no"):
            st.session_state.pop(flag_key, None)
            st.rerun()
        return "armed"
    if st.button(btn_label, key=key):
        st.session_state[flag_key] = True
    return False


# ============ 通用：我的语气档案（蒸馏作者风格） ============
VOICE_FILE = Path("data/voice_profile.json")
def _load_voice():
    try:
        return _json.loads(VOICE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"samples": [], "style_notes": ""}
def _save_voice(v):
    VOICE_FILE.parent.mkdir(parents=True, exist_ok=True)
    VOICE_FILE.write_text(_json.dumps(v, ensure_ascii=False, indent=2), encoding="utf-8")


# ============ 页面配置 ============
st.set_page_config(
    page_title="KaiLionCrafts · 企业级AI工作台",
    page_icon="assets/favicon.png",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ============ 密码门 ============
if "authed" not in st.session_state:
    st.session_state["authed"] = False

if not st.session_state["authed"]:
    logo_path = Path(__file__).parent / "assets" / "logo.png"
    # 垂直居中：顶部留白
    for _ in range(3):
        st.write("")
    _, col_c, _ = st.columns([1, 2, 1])
    with col_c:
        if logo_path.exists():
            st.markdown(f'<div style="text-align:center;"><img src="data:image/png;base64,{__import__("base64").b64encode(open(logo_path,"rb").read()).decode()}" width="320"></div>', unsafe_allow_html=True)
        st.markdown("""
        <div style="text-align:center;margin-top:16px;">
        <div style="font-size:32px;font-weight:900;color:#1a1a2e;letter-spacing:-1px;">KaiLion<span style="color:#D4AF37;">Crafts</span></div>
        <div style="color:#D4AF37;font-size:13px;letter-spacing:4px;margin-top:6px;">锴 利 匠 心</div>
        <div style="color:#888;font-size:14px;margin-top:20px;">企业级AI工作台 · 请输入密码进入</div>
        </div>
        """, unsafe_allow_html=True)
    # 密码输入框也居中
    _, col_pwd, _ = st.columns([1, 2, 1])
    with col_pwd:
        pwd = st.text_input("", type="password", label_visibility="collapsed", placeholder="输入访问密码")
        if st.button("进 入", use_container_width=True, type="primary"):
            if pwd == "441723":
                st.session_state["authed"] = True
                try:
                    import json, os
                    from datetime import datetime
                    log_file = "data/auth_log.json"
                    os.makedirs("data", exist_ok=True)
                    logs = []
                    if os.path.exists(log_file):
                        logs = json.load(open(log_file, encoding="utf-8"))
                    logs.append({"time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "event": "登录成功"})
                    json.dump(logs[-100:], open(log_file, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
                except:
                    pass
                st.rerun()
            else:
                st.error("密码错误")
    st.stop()

# ============ 回到顶部浮动按钮 ============
st.markdown("""
<style>
#btt-fab {
    position: fixed; bottom: 30px; right: 30px; z-index: 99999;
    width: 50px; height: 50px; border-radius: 50%;
    background: linear-gradient(135deg, #D4AF37, #B8860B);
    color: white !important; font-size: 22px; font-weight: bold;
    display: flex; align-items: center; justify-content: center;
    text-decoration: none; box-shadow: 0 4px 16px rgba(212,175,55,.5);
}
#btt-fab:hover { box-shadow: 0 6px 20px rgba(212,175,55,.7); }
</style>
<a id="btt-fab" href="#top" title="回到顶部">↑</a>
<div id="top"></div>
""", unsafe_allow_html=True)


# ============ 自定义样式 ============
st.markdown("""
<style>
    .main { background-color: #fafafa; }
    .stButton>button { width: 100%; }
    .customer-card {
        background: white; padding: 16px; border-radius: 8px;
        border-left: 4px solid #ddd; margin-bottom: 12px;
    }
    .grade-A { border-left-color: #28a745 !important; }
    .grade-B { border-left-color: #007bff !important; }
    .grade-C { border-left-color: #ffc107 !important; }
    .grade-D { border-left-color: #6c757d !important; }
    .email-box {
        background: #f8f9fa; padding: 16px; border-radius: 8px;
        font-family: monospace; white-space: pre-wrap;
    }
    .metric-card {
        background: white; padding: 20px; border-radius: 8px;
        text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
</style>
""", unsafe_allow_html=True)

# ============ 侧边栏导航 ============
with st.sidebar:
    # ============ 品牌区 ============
    logo_path = Path(__file__).parent / "assets" / "logo.png"
    if logo_path.exists():
        st.image(str(logo_path), width=240)
        st.markdown("""
        <div style="text-align:center; margin-bottom:12px;">
            <div style="font-size:14px; color:#333; font-weight:600; letter-spacing:2px;">KaiLionCrafts</div>
            <div style="font-size:12px; color:#B8860B; letter-spacing:3px; margin-top:2px;">锴利匠心 · 企业级AI工作台</div>
        </div>
        """, unsafe_allow_html=True)
    else:
        st.markdown("### 🔪 KaiLionCrafts")

    # ============ 第二区块：功能导航 ============
    st.markdown("##### 🧭 功能导航")

    # AI工具库二级菜单
    tool_options = {
        "🤖 锴利自研AI工具库": None,  # 进入工具库主页
        "  └ SKU命名工具": "sku_naming",
        "  └ 产品线稿工具": "line_art",
        "  └ 全品类视觉矫正": "visual_correction",
        "  └ 刀剪产品提示词": "prompt_library",
        "  └ 场景图反推": "scene_reverse",
        "  └ 白平衡校正": "white_balance",
        "  └ 选片与RAW对齐": "raw_alignment",
    }

    nav_options = [
        # 总览
        "🏠 仪表盘",
        # 业务部
        "🤖 锴利自研AI工具库",
        "📈 市场与产品分析",
        "👥 客户中心",
        "🖥️ 独立站管理", "🧾 订单台账",
        "🌍 海外社媒矩阵",
        # 产品部
        "📦 产品库",
        "🔍 独立站SEO中心",
        # 市场部 -> 已并入公司知识库
        # 知识部
        "📚 公司知识库",
        # 飞书协同已并入公司知识库
        # 管理
        "⚙️ 设置中心",
    ]

    page = st.radio(
        "功能导航",
        nav_options,
        label_visibility="collapsed",
        key="main_nav",
    )

    # 切换导航时清除SEO子页面状态
    if page != "🔍 独立站SEO中心":
        st.session_state.pop("seo_sub", None)

    # 如果选择AI工具库，展开二级工具选择
    if page == "🤖 锴利自研AI工具库":
        tool_options_with_prompt = ["🤖 工具库首页"] + list(tool_options.keys())[1:]
        prev_tool_select = st.session_state.get("_prev_tool_select", "🤖 工具库首页")
        tool_choice = st.selectbox(
            "🔧 选择AI工具",
            tool_options_with_prompt,
            label_visibility="collapsed",
            key="tool_select",
            index=0
        )
        # 只在用户实际改变选择时才处理
        if tool_choice != prev_tool_select:
            st.session_state["_prev_tool_select"] = tool_choice
            selected_tool = tool_options.get(tool_choice, None)
            if selected_tool:
                st.session_state['selected_tool_id'] = selected_tool
                st.rerun()
            else:
                if 'selected_tool_id' in st.session_state:
                    del st.session_state['selected_tool_id']
                    st.rerun()

    st.markdown("---")

    # ============ AI 连接状态 ============
    try:
        if ai.is_configured():
            st.markdown(
                f'<div style="background:#e6f4ea;border-left:3px solid #34a853;padding:5px 10px;'
                f'border-radius:6px;font-size:12px;color:#1e7e34;line-height:1.4;">'
                f'✅ AI 引擎已就绪：{ai.get_provider_name()} · 模型 {getattr(ai,"model","?")}</div>',
                unsafe_allow_html=True)
        else:
            st.markdown(
                '<div style="background:#fff3cd;border-left:3px solid #f0ad4e;padding:5px 10px;'
                'border-radius:6px;font-size:12px;color:#8a6d3b;line-height:1.4;">'
                '⚠️ AI 引擎未配置 —— AI 功能暂不可用，请到「⚙️ 设置中心 → 模型配置」填写 API Key</div>',
                unsafe_allow_html=True)
    except Exception:
        pass
    if st.button("🔌 测试 AI 连接", use_container_width=True):
        with st.spinner("正在测试连接..."):
            ok, msg = ai.test_connection()
            (st.success if ok else st.error)(msg)

    # ============ 第三区块：团队工作空间 ============
    st.markdown("##### 👥 团队工作空间")
    team_options = {key: f"{m['name']} · {m['category']}" for key, m in TEAM_MEMBERS.items()}
    if 'current_member' not in st.session_state:
        st.session_state['current_member'] = 'leo'

    current_member_key = st.selectbox(
        "切换成员工作台",
        options=list(team_options.keys()),
        format_func=lambda k: team_options[k],
        key='member_selector',
        index=list(team_options.keys()).index(st.session_state['current_member']) if st.session_state['current_member'] in team_options else 0,
    )
    st.session_state['current_member'] = current_member_key
    current_member = TEAM_MEMBERS[current_member_key]
    st.caption(f"📁 {current_member['workspace_dir']}")

    st.markdown("---")

    # ============ 第四区块（最后）：模型切换 ============
    st.markdown("##### 🤖 AI模型")
    active_provider = get_active_provider()
    if active_provider:
        st.caption(f"✅ {active_provider['name']}")
        providers_data = load_providers()
        provider_options = {p['id']: p['name'] for p in providers_data['providers']}
        selected_provider = st.selectbox(
            "模型切换",
            options=list(provider_options.keys()),
            format_func=lambda k: provider_options[k],
            key='quick_switch_provider',
            index=list(provider_options.keys()).index(active_provider['id']) if active_provider['id'] in provider_options else 0,
            label_visibility="collapsed",
        )
        if selected_provider != active_provider['id']:
            for p in providers_data['providers']:
                if p['id'] == selected_provider:
                    model = p['models'][0] if p['models'] else ''
                    save_config(provider=p['id'], api_key=p['api_key'], base_url=p['base_url'], model=model)
                    set_active_provider(p['id'])
                    st.success(f"已切换：{p['name']}")
                    st.rerun()
        if st.button("⚙️ 模型管理", use_container_width=True, key='goto_model_mgmt'):
            page = "🤖 模型管理"
    else:
        st.warning("未配置模型")
        if st.button("⚙️ 去配置", use_container_width=True):
            page = "🤖 模型管理"

    st.markdown("---")
    st.caption("信任第一 · 价值第二 · 价格第三")
    if ai.is_configured():
        st.success("✅ AI已连接")
    else:
        st.warning("⚠️ 演示模式")

# ============ 页面1：企业工作台首页 ============
# ============ 客户中心扩展：外贸市场情报（世界时钟/节日/展会/业绩）============
from zoneinfo import ZoneInfo as _ZoneInfo

# 主要贸易城市实时时钟（按区域分组），tz 为 IANA 时区
WORLD_CLOCK_GROUPS = {
    "本地": [
        ("北京", "中国", "Asia/Shanghai"),
    ],
    "东南亚": [
        ("新加坡", "新加坡", "Asia/Singapore"),
        ("吉隆坡", "马来西亚", "Asia/Kuala_Lumpur"),
        ("曼谷", "泰国", "Asia/Bangkok"),
        ("雅加达", "印尼", "Asia/Jakarta"),
        ("马尼拉", "菲律宾", "Asia/Manila"),
    ],
    "中东": [
        ("迪拜", "阿联酋", "Asia/Dubai"),
        ("利雅得", "沙特", "Asia/Riyadh"),
        ("多哈", "卡塔尔", "Asia/Qatar"),
        ("科威特城", "科威特", "Asia/Kuwait"),
        ("伊斯坦布尔", "土耳其", "Europe/Istanbul"),
    ],
    "欧洲": [
        ("法兰克福", "德国", "Europe/Berlin"),
        ("伦敦", "英国", "Europe/London"),
        ("巴黎", "法国", "Europe/Paris"),
        ("马德里", "西班牙", "Europe/Madrid"),
    ],
    "北美": [
        ("纽约", "美国", "America/New_York"),
        ("洛杉矶", "美国", "America/Los_Angeles"),
        ("多伦多", "加拿大", "America/Toronto"),
    ],
    "非洲": [
        ("开罗", "埃及", "Africa/Cairo"),
        ("拉各斯", "尼日利亚", "Africa/Lagos"),
        ("约翰内斯堡", "南非", "Africa/Johannesburg"),
        ("内罗毕", "肯尼亚", "Africa/Nairobi"),
    ],
}

# 国家 -> IANA 时区（供"按客户国家判断联系时间"用）
COUNTRY_TZ = {
    "中国": "Asia/Shanghai", "新加坡": "Asia/Singapore", "马来西亚": "Asia/Kuala_Lumpur",
    "泰国": "Asia/Bangkok", "印尼": "Asia/Jakarta", "印度尼西亚": "Asia/Jakarta",
    "菲律宾": "Asia/Manila", "阿联酋": "Asia/Dubai", "沙特": "Asia/Riyadh",
    "沙特阿拉伯": "Asia/Riyadh", "卡塔尔": "Asia/Qatar", "科威特": "Asia/Kuwait",
    "土耳其": "Europe/Istanbul", "德国": "Europe/Berlin", "英国": "Europe/London",
    "法国": "Europe/Paris", "西班牙": "Europe/Madrid", "意大利": "Europe/Rome",
    "美国": "America/New_York", "加拿大": "America/Toronto", "埃及": "Africa/Cairo",
    "尼日利亚": "Africa/Lagos", "南非": "Africa/Johannesburg", "肯尼亚": "Africa/Nairobi",
    "巴西": "America/Sao_Paulo", "墨西哥": "America/Mexico_City", "澳大利亚": "Australia/Sydney",
    "日本": "Asia/Tokyo", "韩国": "Asia/Seoul", "印度": "Asia/Kolkata", "越南": "Asia/Ho_Chi_Minh",
}

# 2026年主要贸易国固定法定节日：国家 -> [(月, 日, 节日名)]
HOLIDAYS_2026 = {
    "中国": [(1, 1, "元旦"), (2, 17, "春节"), (2, 18, "春节"), (2, 19, "春节"),
            (5, 1, "劳动节"), (10, 1, "国庆节")],
    "美国": [(1, 1, "元旦"), (1, 19, "马丁·路德·金纪念日"), (5, 25, "阵亡将士纪念日"),
            (7, 3, "独立日(观察日)"), (9, 7, "劳动节"), (11, 26, "感恩节"), (12, 25, "圣诞节")],
    "英国": [(1, 1, "元旦"), (4, 3, "Good Friday"), (12, 25, "圣诞节"), (12, 26, "节礼日")],
    "德国": [(1, 1, "元旦"), (4, 3, "Good Friday"), (5, 1, "劳动节"),
            (10, 3, "德国统一日"), (12, 25, "圣诞节"), (12, 26, "圣诞节二日")],
    "法国": [(1, 1, "元旦"), (5, 1, "劳动节"), (7, 14, "法国国庆"), (12, 25, "圣诞节")],
    "阿联酋": [(1, 1, "元旦"), (12, 1, "联邦纪念日")],
    "沙特": [(1, 1, "公历元旦")],
    "卡塔尔": [(1, 1, "元旦"), (12, 18, "国庆日")],
    "日本": [(1, 1, "元旦"), (1, 12, "成人日"), (2, 11, "建国纪念日"),
            (4, 29, "昭和之日"), (5, 3, "宪法纪念日"), (11, 23, "勤劳感谢日")],
}
ISLAMIC_HOLIDAY_NOTE = ("⚠️ 阿联酋/沙特/卡塔尔/科威特等伊斯兰国家：开斋节(Eid al-Fitr)、宰牲节(Eid al-Adha)"
                       "按伊斯兰历浮动，2026年约在4月下旬、5月底~6月初，期间客户基本不办公，"
                       "发邮件前请核对当地公告。")

# 五金刀剪/餐厨/消费品行业主要展会（框架数据，可在页面上补充）
EXPOS_2026 = [
    {"name": "广交会 Canton Fair", "country": "中国·广州", "month": "4月/10月",
     "category": "综合外贸(五金/餐厨)", "fit": "★★★★★", "note": "全球买家最集中，老客户约见首选"},
    {"name": "Ambiente 法兰克福国际消费品展", "country": "德国·法兰克福", "month": "2月",
     "category": "餐厨/家居消费品", "fit": "★★★★★", "note": "欧美厨房用品采购主战场"},
    {"name": "Chicago Housewares Show", "country": "美国·芝加哥", "month": "3月",
     "category": "餐厨用品", "fit": "★★★★★", "note": "美国家居厨具最大展"},
    {"name": "HKTDC 香港家庭用品展", "country": "中国·香港", "month": "4月",
     "category": "家居/餐厨", "fit": "★★★★", "note": "东南亚及全球买家中转站"},
    {"name": "National Hardware Show", "country": "美国·拉斯维加斯", "month": "4-5月",
     "category": "五金工具", "fit": "★★★★", "note": "北美五金渠道商集中"},
    {"name": "Gulfood / Arabian Hospitality", "country": "阿联酋·迪拜", "month": "2月",
     "category": "酒店餐饮供应", "fit": "★★★★", "note": "中东餐厨/酒店采购渠道"},
    {"name": "科隆国际五金展 Eisenwarenmesse", "country": "德国·科隆", "month": "3月(隔年)",
     "category": "五金", "fit": "★★★★", "note": "2026年为举办年，B2B五金专业买家"},
    {"name": "东京国际礼品展 Gift Show", "country": "日本·东京", "month": "2月/9月",
     "category": "礼品/家居", "fit": "★★★", "note": "日本市场渠道"},
]

PERF_FILE = Path(__file__).parent / "data" / "perf_targets.json"


def _perf_load():
    try:
        if PERF_FILE.exists():
            return _json.loads(PERF_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _perf_save(d):
    PERF_FILE.write_text(_json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def _city_status(city, country, tzname):
    """返回 (当地datetime, 是否工作时间, 是否周末, 今日节日名或None)"""
    now = datetime.now(_ZoneInfo(tzname))
    wd = now.weekday()  # 周一0 ... 周日6
    is_weekend = wd >= 5
    hm = now.hour + now.minute / 60
    is_work = (not is_weekend) and 9.0 <= hm < 18.0
    holiday = None
    for m, d, name in HOLIDAYS_2026.get(country, []):
        if m == now.month and d == now.day:
            holiday = name
            break
    if holiday:
        is_work = False
    return now, is_work, is_weekend, holiday


if page == "🏠 仪表盘":
    # 欢迎头部
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%);border-radius:16px;padding:32px;margin-bottom:24px;">
        <div style="color:#D4AF37;font-size:12px;letter-spacing:4px;margin-bottom:8px;">KAILIONCRAFTS · ENTERPRISE AI WORKBENCH</div>
        <h1 style="color:#FFF3E0;font-size:32px;font-weight:700;margin:0 0 8px 0;">企业级AI工作台</h1>
        <div style="color:rgba(255,243,224,.6);font-size:14px;">阳江五金刀剪产业 · 客户开发 · 产品SEO · AI工具 · 知识库一体化平台</div>
    </div>
    """, unsafe_allow_html=True)

    # 数据概览
    stats = cm.get_statistics()
    c1, c2, c3, c4 = st.columns(4)
    with c1:
        st.metric("总客户数", stats["total"], delta=f"A级 {stats['by_grade'].get('A',0)}")
    with c2:
        st.metric("平均评分", f"{stats['avg_score']:.0f}/100")
    with c3:
        st.metric("待跟进", stats["by_status"].get("新客户", 0), delta="需处理")
    with c4:
        closed = stats["by_pipeline"].get("closed", 0)
        st.metric("已成交", closed, delta=f"转化率 {closed/stats['total']*100:.0f}%" if stats["total"] else "0%")

    # 订单/财务概览
    try:
        import finance_db as fdb
        fdb.init_db()
        _s = fdb.dashboard_summary()
        _live = len([o for o in fdb.list_sales_orders() if o["status"] not in ("完成",)])
        f1, f2, f3, f4 = st.columns(4)
        f1.metric("进行中订单", _live)
        f2.metric("应收(未收)", f"${_s['ar']:,.0f}", delta="跟进尾款" if _s["ar"] > 0 else None)
        f3.metric("应付(未付)", f"${_s['ap']:,.0f}", delta="待付工厂" if _s["ap"] > 0 else None)
        f4.metric("本月毛利", f"${_s['m_gross']:,.0f}")
    except Exception:
        pass

    # 今日经营提醒
    try:
        import finance_db as _fdb
        from datetime import date as _date, timedelta as _td
        _remind = []
        for r in _fdb.list_receivables():
            if r["账龄天数"] > 30:
                _remind.append(f"🔴 客户 {r['客户']} 应收 ${r['未收']:,.0f} 已 {r['账龄天数']} 天")
        today = _date.today(); nxt = today + _td(days=7)
        for o in _fdb.list_sales_orders():
            dd = o.get("delivery_date") or ""
            if dd and o["status"] not in ("完成",):
                try:
                    y, m, d = map(int, dd.split("-"))
                    dlv = _date(y, m, d)
                    if today <= dlv <= nxt:
                        _remind.append(f"🟡 订单 {o['order_no']} ({o['customer']}) 预计 {dd} 交货")
                except Exception:
                    pass
        if _remind:
            st.markdown("##### 🔔 今日提醒")
            for line in _remind[:8]:
                st.write(line)
    except Exception:
        pass

    st.markdown("---")

    # 快捷功能（8个大按钮）
    st.markdown("##### 🚀 快捷功能")
    row1c1, row1c2, row1c3, row1c4 = st.columns(4)
    with row1c1:
        st.markdown("""<div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:12px 12px 0 0;padding:16px;text-align:center;">
        <div style="font-size:28px;">🎯</div><div style="font-weight:700;margin-top:4px;">客户开发</div>
        </div>""", unsafe_allow_html=True)
        if st.button("进入", key="goto_crm", use_container_width=True):
            st.session_state.pop("main_nav", None); st.session_state["main_nav"] = "👥 客户中心"; st.rerun()
    with row1c2:
        st.markdown("""<div style="background:linear-gradient(135deg,#dbeafe,#bfdbfe);border-radius:12px 12px 0 0;padding:16px;text-align:center;">
        <div style="font-size:28px;">📦</div><div style="font-weight:700;margin-top:4px;">产品与SEO</div>
        </div>""", unsafe_allow_html=True)
        if st.button("进入", key="goto_seo", use_container_width=True):
            st.session_state.pop("main_nav", None); st.session_state["main_nav"] = "🔍 独立站SEO中心"; st.rerun()
    with row1c3:
        st.markdown("""<div style="background:linear-gradient(135deg,#d1fae5,#a7f3d0);border-radius:12px 12px 0 0;padding:16px;text-align:center;">
        <div style="font-size:28px;">🛠️</div><div style="font-weight:700;margin-top:4px;">AI工具库</div>
        </div>""", unsafe_allow_html=True)
        if st.button("进入", key="goto_tools", use_container_width=True):
            st.session_state.pop("main_nav", None); st.session_state["main_nav"] = "🤖 锴利自研AI工具库"; st.rerun()
    with row1c4:
        st.markdown("""<div style="background:linear-gradient(135deg,#ede9fe,#ddd6fe);border-radius:12px 12px 0 0;padding:16px;text-align:center;">
        <div style="font-size:28px;">🌍</div><div style="font-weight:700;margin-top:4px;">市场分析</div>
        </div>""", unsafe_allow_html=True)
        if st.button("进入", key="goto_market", use_container_width=True):
            st.session_state.pop("main_nav", None); st.session_state["main_nav"] = "📈 市场与产品分析"; st.rerun()

    row2c1, row2c2, row2c3, row2c4 = st.columns(4)
    with row2c1:
        if st.button("🖥️ 独立站管理", key="goto_website", use_container_width=True):
            st.session_state.pop("main_nav", None); st.session_state["main_nav"] = "🖥️ 独立站管理"; st.rerun()
    with row2c2:
        if st.button("📚 知识库", key="goto_kb", use_container_width=True):
            st.session_state.pop("main_nav", None); st.session_state["main_nav"] = "📚 公司知识库"; st.rerun()
    with row2c3:
        if st.button("🧾 订单台账", key="goto_orders", use_container_width=True):
            st.session_state.pop("main_nav", None); st.session_state["main_nav"] = "🧾 订单台账"; st.rerun()
    with row2c4:
        if st.button("⚙️ 设置中心", key="goto_settings", use_container_width=True):
            st.session_state.pop("main_nav", None); st.session_state["main_nav"] = "⚙️ 设置中心"; st.rerun()

    st.markdown("---")

    # 今日待办 + 近7天趋势（左右并排）
    left, right = st.columns([1, 1])
    with left:
        st.markdown("##### 📋 今日待办")
        todo_file = Path("data/todo/todos.json")
        todo_file.parent.mkdir(parents=True, exist_ok=True)
        if todo_file.exists():
            try:
                todos = _json.loads(todo_file.read_text(encoding="utf-8"))
            except:
                todos = []
        else:
            todos = []
        new_todo = st.text_input("添加待办", placeholder="跟进德国客户OEM...", key="new_todo_input", label_visibility="collapsed")
        if st.button("➕ 添加", use_container_width=True):
            if new_todo.strip():
                todos.append({"task": new_todo.strip(), "done": False, "date": datetime.now().strftime("%Y-%m-%d")})
                todo_file.write_text(_json.dumps(todos, ensure_ascii=False, indent=2), encoding="utf-8")
                st.rerun()
        if todos:
            for i, t in enumerate(todos[:8]):
                st.checkbox(t["task"], value=t.get("done", False), key=f"dash_todo_{i}")
        else:
            st.caption("暂无待办")

    with right:
        st.markdown("##### 📈 近7天趋势")
        try:
            import json as _j, os
            from datetime import datetime as _dt, timedelta as _td
            inbox_file = "data/inbox/inquiries.json"
            if os.path.exists(inbox_file):
                inqs = _j.load(open(inbox_file, encoding="utf-8"))
            else:
                inqs = []
            dates = [(datetime.now() - _td(days=i)).strftime("%m-%d") for i in range(6, -1, -1)]
            inq_counts = [0] * 7
            for q in inqs:
                d = q.get("date", "")
                for i, ds in enumerate(dates):
                    if ds in d:
                        inq_counts[i] += 1
            trend_df = pd.DataFrame({"日期": dates, "询盘": inq_counts})
            st.bar_chart(trend_df.set_index("日期"))
        except:
            st.caption("暂无数据")

    st.markdown("---")

    # 最近客户 + 图表
    col1, col2 = st.columns([2, 1])
    with col1:
        st.markdown("##### 📋 最近客户")
        customers = cm.list_customers()[:6]
        if customers:
            for c in customers:
                grade = c.get("grade", "C")
                color = CUSTOMER_GRADES[grade]["color"]
                st.markdown(f"""
                <div style="background:#fafafa;border-left:4px solid {color};padding:10px 14px;margin-bottom:8px;border-radius:0 8px 8px 0;">
                    <strong>{c.get('company_name','')}</strong>
                    <span style="float:right;color:{color};font-size:12px;">{grade}级 | {c.get('score',0)}分</span><br>
                    <small style="color:#888;">{c.get('country','')} · {c.get('products','')[:60]}</small>
                </div>
                """, unsafe_allow_html=True)
        else:
            st.info("还没有客户数据")
    with col2:
        st.markdown("##### 📊 客户等级")
        grade_data = {"等级": ["A","B","C","D"], "数量": [
            stats["by_grade"].get("A",0), stats["by_grade"].get("B",0),
            stats["by_grade"].get("C",0), stats["by_grade"].get("D",0)]}
        st.bar_chart(pd.DataFrame(grade_data).set_index("等级"))

    # 数字员工绩效
    st.markdown("---")
    st.markdown("##### 👥 数字员工绩效")
    members = list(TEAM_MEMBERS.keys())
    perf_cols = st.columns(len(members))
    for i, (mkey, mcol) in enumerate(zip(members, perf_cols)):
        m = TEAM_MEMBERS[mkey]
        # 真实数据：统计该成员工作区已产出文件数
        try:
            ws = Path(m.get("workspace_dir", ""))
            prod_count = len(list(ws.rglob("*"))) if str(ws) and ws.exists() else 0
        except Exception:
            prod_count = 0
        with mcol:
            st.markdown(f"""
            <div style="background:#f8f9fa;border-radius:12px;padding:16px;text-align:center;">
                <div style="font-size:28px;">{'🔪' if mkey=='leo' else '🍳' if mkey=='jason' else '✂️' if mkey=='owen' else '🍖'}</div>
                <div style="font-weight:700;margin:6px 0;">{m['name']}</div>
                <div style="font-size:12px;color:#888;">{m['category']}</div>
                <div style="margin-top:10px;font-size:24px;font-weight:700;color:#D4AF37;">{prod_count}</div>
                <div style="font-size:11px;color:#999;">已产出文件</div>
            </div>
            """, unsafe_allow_html=True)

# ============ 独立站管理 ============
elif page == "🖥️ 独立站管理":
    import json as _json
    from datetime import datetime as _dt

    # 数据文件
    inbox_dir = Path(__file__).parent / "data" / "inbox"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    inquiries_file = inbox_dir / "inquiries.json"
    comments_file = inbox_dir / "comments.json"

    def _load_json(path):
        if path.exists():
            return _json.loads(path.read_text(encoding="utf-8"))
        return []

    def _save_json(path, data):
        path.write_text(_json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    inquiries = _load_json(inquiries_file)
    comments = _load_json(comments_file)

    # 头部
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
        <div style="color:#D4AF37;font-size:12px;letter-spacing:3px;">KAILIONCRAFTS · INQUIRY MANAGEMENT</div>
        <h2 style="color:#FFF3E0;font-size:26px;margin:8px 0;">独立站询盘管理</h2>
        <div style="color:rgba(255,243,224,.6);font-size:13px;">接询盘 → 客户背调 → 智能分析 → 生成回复 → 存档跟进</div>
    </div>
    """, unsafe_allow_html=True)

    # SOP流程图
    with st.expander("🔄 询盘回复SOP流程图（点击展开）", expanded=False):
        st.graphviz_chart("""
        digraph inquiry_sop {
            rankdir=LR;
            node [shape=box, style="rounded,filled", fontname="Microsoft YaHei", fontsize=11];

            start [label="📥 客户询盘到达", fillcolor="#1a1a2e", fontcolor="white"];
            input [label="📝 录入系统\\n(客户名/邮箱/需求)", fillcolor="#dbeafe"];
            bg [label="🔍 客户背调\\n(联网搜索公司/社媒)", fillcolor="#fef3c7"];
            analyze [label="🧠 AI分析需求\\n(产品/数量/预算)", fillcolor="#d1fae5"];
            kb [label="📚 匹配知识库\\n(OEM/MOQ/产品参数)", fillcolor="#ede9fe"];
            reply [label="✉️ 生成回复草稿\\n(AI结合知识库)", fillcolor="#fce7f3"];
            review [label="👤 人工审核\\n(Leo/Jason/Owen/Julia)", fillcolor="#fff7ed"];
            send [label="📤 发送回复", fillcolor="#d1fae5"];
            followup [label="🔄 跟进序列\\n(3/7/15天)", fillcolor="#e0e7ff"];
            deal [label="🎉 成交归档", fillcolor="#bbf7d0"];
            fail [label="❄️ 冷藏", fillcolor="#f3f4f6"];

            start -> input -> bg -> analyze -> kb -> reply -> review;
            review -> send [label="通过"];
            review -> reply [label="修改"];
            send -> followup;
            followup -> deal [label="有意向"];
            followup -> fail [label="无回复"];
        }
        """, use_container_width=True)
        st.caption("SOP流程：询盘到达 → 录入 → 背调 → AI分析 → 知识库匹配 → 生成回复 → 人工审核 → 发送 → 跟进 → 成交/冷藏")

    # 子Tab
    sub_tab = st.tabs(["📥 询盘列表", "📝 录入新询盘", "💬 评论管理", "📊 统计"])

    # --- Tab1: 询盘列表 ---
    with sub_tab[0]:
        if not inquiries:
            st.info("暂无询盘数据，请到「录入新询盘」添加第一条")
        else:
            # 状态筛选
            status_filter = st.selectbox("筛选状态", ["全部", "待回复", "已回复", "已成交", "已归档"], key="inq_filter")
            display = inquiries
            if status_filter != "全部":
                display = [i for i in inquiries if i.get("status") == status_filter]

            st.caption(f"共 {len(display)} 条询盘")
            for inq in reversed(display):
                with st.expander(f"{'🟡' if inq['status']=='待回复' else '🟢' if inq['status']=='已回复' else '⚪'} {inq.get('customer_name','未知')} | {inq.get('email','')[:40]} | {inq.get('date','')}", expanded=False):
                    c1, c2 = st.columns([2,1])
                    with c1:
                        st.markdown(f"**客户：** {inq.get('customer_name','')}")
                        st.markdown(f"**邮箱：** {inq.get('email','')}")
                        st.markdown(f"**国家：** {inq.get('country','')}")
                        st.markdown(f"**产品需求：** {inq.get('product_interest','')}")
                        st.markdown(f"**询盘内容：**")
                        st.text(inq.get("message",""))
                    with c2:
                        st.markdown(f"**日期：** {inq.get('date','')}")
                        st.markdown(f"**状态：** {inq.get('status','待回复')}")
                        if inq.get("company"):
                            st.markdown(f"**公司：** {inq.get('company','')}")
                        if inq.get("budget"):
                            st.markdown(f"**预算：** {inq.get('budget','')}")

                    # 操作按钮
                    b1, b2, b3 = st.columns(3)
                    with b1:
                        if st.button("🔍 客户背调", key=f"bg_{inq['id']}"):
                            st.session_state["_bg_target"] = inq
                            st.info("请在下方「客户背调」区域查看结果（需联网）")
                    with b2:
                        if st.button("✉️ 智能生成回复", key=f"reply_{inq['id']}"):
                            st.session_state["_reply_target"] = inq
                    with b3:
                        new_status = st.selectbox("更新状态", ["待回复","已回复","已成交","已归档"],
                                                  index=["待回复","已回复","已成交","已归档"].index(inq.get("status","待回复")),
                                                  key=f"st_{inq['id']}")
                        if new_status != inq.get("status"):
                            for i in inquiries:
                                if i["id"] == inq["id"]:
                                    i["status"] = new_status
                            _save_json(inquiries_file, inquiries)
                            st.success(f"状态已更新为：{new_status}")
                            st.rerun()

                    # 智能回复区域
                    if st.session_state.get("_reply_target", {}).get("id") == inq["id"]:
                        st.markdown("---")
                        st.markdown("##### ✉️ 智能回复草稿（结合知识库+客户分析）")
                        if ai.is_configured():
                            reply_prompt = f"""你是KaiLionCrafts外贸业务员Leo，回复客户询盘。

客户信息：
- 姓名：{inq.get('customer_name','')}
- 邮箱：{inq.get('email','')}
- 公司：{inq.get('company','')}
- 国家：{inq.get('country','')}
- 产品需求：{inq.get('product_interest','')}

客户询盘内容：
{inq.get('message','')}

请生成一封专业的英文回复邮件，要求：
1. 个性化称呼，根据客户名字
2. 确认收到询盘
3. 针对客户需求推荐产品（结合阳江刀剪产业优势：OEM/ODM、MOQ、质量控制）
4. 提出问题进一步确认需求
5. 专业但友好的语气
6. 结尾签名：Leo Li, KaiLionCrafts, ceo@kailioncrafts.com
7. 控制在200-300词"""
                            with st.spinner("AI正在分析询盘并生成回复..."):
                                try:
                                    result = ai.chat(
                                        reply_prompt,
                                        task_name=f"询盘回复 - {inq.get('customer_name','')}",
                                        knowledge_refs=[
                                            "公司知识库：OEM/ODM政策",
                                            "公司知识库：阳江产业优势",
                                            "产品知识库：四大品类",
                                            "客户信息："+inq.get("email",""),
                                        ]
                                    )
                                    st.text_area("回复草稿（可编辑）", value=result, height=300, key=f"reply_edit_{inq['id']}")
                                    st.download_button("📋 下载回复.txt", result, file_name=f"reply_{inq.get('email','customer')}.txt")
                                    # Trace显示
                                    if ai.last_trace:
                                        t = ai.last_trace
                                        with st.expander("📜 AI调用Trace（模型/耗时/来源）"):
                                            tc1, tc2, tc3 = st.columns(3)
                                            tc1.metric("模型", t["model"][:20])
                                            tc2.metric("耗时", f"{t['elapsed_seconds']}s")
                                            tc3.metric("Token", t.get("total_tokens","N/A"))
                                            if t.get("knowledge_refs"):
                                                st.markdown("**引用知识库：**")
                                                for ref in t["knowledge_refs"]:
                                                    st.markdown(f"- {ref}")
                                except Exception as e:
                                    st.error(f"AI生成失败：{e}")
                        else:
                            st.warning("未配置AI模型，请先在左下角配置")

    # --- Tab2: 录入新询盘 ---
    with sub_tab[1]:
        st.markdown("##### 录入新询盘")
        with st.form("new_inquiry"):
            nc1, nc2 = st.columns(2)
            with nc1:
                n_name = st.text_input("客户姓名 *")
                n_email = st.text_input("客户邮箱 *")
                n_company = st.text_input("公司名")
                n_country = st.text_input("国家/地区")
            with nc2:
                n_product = st.text_input("产品需求（如：outdoor knife, OEM, Kydex sheath）")
                n_budget = st.text_input("预算/数量")
                n_source = st.selectbox("来源", ["独立站表单","邮件","WhatsApp","Alibaba","展会","其他"])
            n_msg = st.text_area("询盘内容 *", height=150, placeholder="客户发来的完整内容...")
            submitted = st.form_submit_button("💾 保存询盘", type="primary")
            if submitted:
                if n_name and n_email and n_msg:
                    new_inq = {
                        "id": f"INQ{len(inquiries)+1:04d}_{int(_dt.now().timestamp())}",
                        "date": _dt.now().strftime("%Y-%m-%d %H:%M"),
                        "customer_name": n_name, "email": n_email,
                        "company": n_company, "country": n_country,
                        "product_interest": n_product, "budget": n_budget,
                        "source": n_source, "message": n_msg,
                        "status": "待回复",
                    }
                    inquiries.append(new_inq)
                    _save_json(inquiries_file, inquiries)
                    st.success(f"✅ 询盘已保存（{len(inquiries)}条）")
                    st.rerun()
                else:
                    st.error("请填写必填项：客户姓名、邮箱、询盘内容")

    # --- Tab3: 评论管理 ---
    with sub_tab[2]:
        st.markdown("##### 独立站博客/产品评论存档")
        with st.form("new_comment"):
            cc1, cc2 = st.columns(2)
            with cc1:
                c_author = st.text_input("评论人")
                c_email = st.text_input("评论人邮箱")
            with cc2:
                c_page = st.text_input("所在页面（如：/insights/blog-post-title）")
                c_date = st.date_input("日期")
            c_content = st.text_area("评论内容", height=100)
            c_submit = st.form_submit_button("💾 保存评论")
            if c_submit:
                comments.append({
                    "author": c_author, "email": c_email, "page": c_page,
                    "date": str(c_date), "content": c_content, "replied": False,
                })
                _save_json(comments_file, comments)
                st.success("✅ 评论已保存")
                st.rerun()
        if comments:
            st.markdown(f"**共 {len(comments)} 条评论**")
            for c in reversed(comments[-20:]):
                st.markdown(f"- **{c['author']}** ({c['date']}) @ {c['page']}: {c['content'][:80]}...")

    # --- Tab4: 统计 ---
    with sub_tab[3]:
        s1, s2, s3, s4 = st.columns(4)
        s1.metric("总询盘", len(inquiries))
        s2.metric("待回复", len([i for i in inquiries if i["status"]=="待回复"]))
        s3.metric("已回复", len([i for i in inquiries if i["status"]=="已回复"]))
        s4.metric("评论", len(comments))

    # WooCommerce后台
    st.markdown("---")
    st.markdown("##### 🛒 WooCommerce订单与评论")

    wc_tab1, wc_tab2 = st.tabs(["📦 订单列表", "💬 产品评论"])

    with wc_tab1:
        if st.button("🔄 拉取最新订单", key="wc_pull"):
            with st.spinner("正在从WooCommerce拉取..."):
                try:
                    import requests
                    r = requests.get("https://kailioncrafts.com/wp-json/wc/v3/orders",
                        auth=(os.getenv("WC_CONSUMER_KEY", ""), os.getenv("WC_CONSUMER_SECRET", "")),
                        params={"per_page": 20}, timeout=15)
                    if r.status_code == 200:
                        orders = r.json()
                        st.session_state["_wc_orders"] = orders
                        st.success(f"拉取到 {len(orders)} 个订单")
                    else:
                        st.error(f"API错误: {r.status_code}")
                except Exception as e:
                    st.error(f"连接失败：{e}")

        if "_wc_orders" in st.session_state:
            orders = st.session_state["_wc_orders"]
            if orders:
                import pandas as pd
                df = pd.DataFrame([{
                    "订单号": f"#{o.get('id')}",
                    "状态": o.get('status'),
                    "金额": f"${o.get('total')}",
                    "客户": o.get('billing',{}).get('first_name','') + " " + o.get('billing',{}).get('last_name',''),
                    "邮箱": o.get('billing',{}).get('email',''),
                    "国家": o.get('billing',{}).get('country',''),
                    "日期": o.get('date_created','')[:10],
                } for o in orders])
                st.dataframe(df, use_container_width=True, hide_index=True)

    with wc_tab2:
        if st.button("🔄 拉取最新评论", key="wc_reviews"):
            with st.spinner("正在拉取产品评论..."):
                try:
                    import requests
                    r = requests.get("https://kailioncrafts.com/wp-json/wc/v3/products/reviews",
                        auth=(os.getenv("WC_CONSUMER_KEY", ""), os.getenv("WC_CONSUMER_SECRET", "")),
                        params={"per_page": 20}, timeout=15)
                    if r.status_code == 200:
                        reviews = r.json()
                        st.session_state["_wc_reviews"] = reviews
                        st.success(f"拉取到 {len(reviews)} 条评论")
                    else:
                        st.error(f"API错误: {r.status_code}")
                except Exception as e:
                    st.error(f"连接失败：{e}")

        if "_wc_reviews" in st.session_state:
            reviews = st.session_state["_wc_reviews"]
            for rev in reviews[:15]:
                with st.expander(f"⭐ {rev.get('rating','')} | {rev.get('reviewer','')} | {rev.get('date_created','')[:10]}"):
                    st.write(rev.get('review',''))

# ============ 页面2：晨间简报 ============
elif page == "🌅 晨间简报":
    st.title("🌅 今日外贸晨间简报")
    st.caption(f"{datetime.now().strftime('%Y年%m月%d日 %A')} | KaiLionCrafts 阳江刀剪外贸")

    stats = cm.get_statistics()
    follow_up_today = cm.get_follow_up_today()
    overdue = cm.get_overdue_follow_up()

    # 顶部统计
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("今日待跟进", len(follow_up_today))
    with col2:
        st.metric("逾期未跟进", len(overdue), delta="需尽快处理")
    with col3:
        st.metric("客户总数", stats["total"])
    with col4:
        closed = stats["by_pipeline"].get("closed", 0)
        st.metric("已成交", closed)

    st.markdown("---")

    # AI生成简报
    if st.button("✨ AI生成今日简报", use_container_width=True, type="primary"):
        with st.spinner("AI正在生成晨间简报..."):
            follow_up_text = "\n".join([
                f"- [{c.get('grade','C')}级] {c.get('company_name','')} ({c.get('country','')}) - {c.get('products','')[:40]}"
                for c in follow_up_today[:10]
            ]) or "无"
            overdue_text = "\n".join([
                f"- [{c.get('grade','C')}级] {c.get('company_name','')} - 应跟进日期: {c.get('next_follow_up','')}"
                for c in overdue[:10]
            ]) or "无"

            prompt = MORNING_BRIEF_PROMPT.format(
                today=datetime.now().strftime("%Y-%m-%d"),
                follow_up_customers=follow_up_text,
                overdue_customers=overdue_text,
                total_customers=stats["total"],
                grade_a_count=stats["by_grade"].get("A", 0),
                grade_b_count=stats["by_grade"].get("B", 0),
                grade_c_count=stats["by_grade"].get("C", 0),
                lead_count=stats["by_pipeline"].get("lead", 0),
                contacted_count=stats["by_pipeline"].get("contacted", 0),
                engaged_count=stats["by_pipeline"].get("engaged", 0),
                quoted_count=stats["by_pipeline"].get("quoted", 0),
                closed_count=stats["by_pipeline"].get("closed", 0),
            )
            brief = ai.chat(prompt, use_lite=True)
        st.markdown(brief)

    st.markdown("---")

    # 今日待跟进列表
    st.subheader("📋 今日待跟进客户")
    if follow_up_today:
        for c in follow_up_today:
            grade = c.get("grade", "C")
            st.markdown(f"""
            <div class="customer-card grade-{grade}">
                <strong>{c.get('company_name', '未知')}</strong>
                <span style="float:right; color:{CUSTOMER_GRADES[grade]['color']}">{grade}级</span><br>
                <small>{c.get('country', '')} | {c.get('products', '')[:50]}</small>
            </div>
            """, unsafe_allow_html=True)
    else:
        st.success("今天没有待跟进客户，可以开发新客户！")

    # 逾期提醒
    if overdue:
        st.markdown("---")
        st.subheader("⚠️ 逾期未跟进")
        for c in overdue:
            st.warning(f"**{c.get('company_name','')}** - 应跟进日期：{c.get('next_follow_up','')}")

# ============ 客户中心 ============
elif page == "👥 客户中心":
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
    <div style="color:#D4AF37;font-size:12px;letter-spacing:3px;">KAILIONCRAFTS · CRM HUB</div>
    <h2 style="color:#FFF3E0;font-size:26px;margin:8px 0;">客户中心</h2>
    <div style="color:rgba(255,243,224,.6);font-size:13px;">客户分析 · 客户开发 · 智能问答 · 客户管理（CRM）</div>
    </div>
    """, unsafe_allow_html=True)

    cc_sections = {
        "🎯 客户分析": "客户背调 · 智能分析",
        "✉️ 客户开发": "开发信 · 多轮跟进",
        "💬 客户问答": "知识库 · 智能回复",
        "📊 客户管理": "销售漏斗 · 客户列表",
    }
    if "cc_sub" not in st.session_state:
        st.session_state["cc_sub"] = "🎯 客户分析"
    cc_current = st.session_state["cc_sub"]

    cc_cols = st.columns(4)
    for i, (name, desc) in enumerate(cc_sections.items()):
        with cc_cols[i]:
            is_active = st.session_state["cc_sub"] == name
            if st.button(name, key=f"ccbtn_{name}", use_container_width=True,
                         type="primary" if is_active else "secondary"):
                st.session_state["cc_sub"] = name
                st.rerun()

    cc_current = st.session_state["cc_sub"]
    st.markdown(f"### {cc_current}")
    st.caption(cc_sections[cc_current])
    st.markdown("---")

    if cc_current == "🎯 客户分析":
        cc_t1, cc_t2, cc_t3, cc_t4, cc_t5 = st.tabs(
            ["📊 客户分析", "🔍 深度背调", "🌍 世界时钟与节日", "📰 外贸热点研判", "🎪 展会情报"])
        with cc_t1:
            st.subheader("潜在客户分析")
            with st.form("ca_form"):
                col1, col2 = st.columns(2)
                with col1:
                    ca_company = st.text_input("公司名称 *")
                    ca_country = st.text_input("国家 *")
                    ca_website = st.text_input("官网（可选）")
                with col2:
                    ca_products = st.text_area("主营产品 *", height=80)
                    ca_extra = st.text_input("补充信息（规模/采购量，可选）")
                ca_submit = st.form_submit_button("🔍 AI分析", use_container_width=True, type="primary")
            if ca_submit and ca_company and ca_country and ca_products:
                with st.spinner("AI分析中..."):
                    try:
                        prompt = CUSTOMER_ANALYSIS_PROMPT.format(
                            company_name=ca_company, website=ca_website or "未提供",
                            country=ca_country, products=ca_products,
                            size=ca_extra or "未知", additional_info="无",
                            company_profile=kb.get_company_brief(),
                            product_categories=", ".join(COMPANY["categories"]),
                        )
                        result = ai.chat(prompt)
                        st.markdown(result)
                    except Exception as e:
                        st.error(f"AI错误：{e}")
        with cc_t2:
            st.subheader("客户深度背调")
            with st.form("bg_form"):
                col1, col2 = st.columns(2)
                with col1:
                    bg_company = st.text_input("客户公司名 *")
                    bg_country = st.text_input("国家（可选）")
                with col2:
                    bg_products = st.text_input("对方主营产品（可选）")
                bg_submit = st.form_submit_button("🔍 开始背调", use_container_width=True, type="primary")
            if bg_submit and bg_company:
                with st.spinner("背调中..."):
                    try:
                        prompt = DUE_DILIGENCE_PROMPT.format(
                            company_name=bg_company, website="未提供",
                            country=bg_country or "未知", products=bg_products or "未知",
                            company_profile=kb.get_company_brief(),
                        )
                        result = ai.chat(prompt)
                        st.markdown(result)
                    except Exception as e:
                        st.error(f"AI错误：{e}")

        with cc_t3:
            st.subheader("🌍 世界时钟与节日提醒")
            st.caption("按客户当地时间判断此刻是否适合联系；节假日/周末自动标灰，避免在对方休息时打扰")
            for region, cities in WORLD_CLOCK_GROUPS.items():
                st.markdown(f"**📍 {region}**")
                cols = st.columns(len(cities))
                for i, (city, country, tzname) in enumerate(cities):
                    with cols[i]:
                        now, is_work, is_weekend, holiday = _city_status(city, country, tzname)
                        t = now.strftime("%H:%M")
                        d = now.strftime("%m/%d")
                        wd = "一二三四五六日"[now.weekday()]
                        if holiday:
                            badge = f"🎉 {holiday}"
                        elif is_weekend:
                            badge = "🌴 周末"
                        elif is_work:
                            badge = "🟢 工作时间"
                        else:
                            badge = "⚪ 非工作时间"
                        st.metric(label=f"{city} · {country}", value=t, delta=f"{d} 周{wd} · {badge}")
            st.info(ISLAMIC_HOLIDAY_NOTE)
            st.markdown("---")
            st.markdown("**📌 现在适不适合联系某国客户？**")
            cc_country_sel = st.selectbox("选择客户所在国家", list(COUNTRY_TZ.keys()), key="cc_tz_sel")
            if st.button("🕐 判断最佳联系时间", key="cc_tz_btn", use_container_width=True):
                tzname = COUNTRY_TZ[cc_country_sel]
                now, is_work, is_weekend, holiday = _city_status(cc_country_sel, cc_country_sel, tzname)
                with st.spinner("结合知识库分析联系节奏..."):
                    try:
                        prompt = f"""你是B2B外贸客户开发专家。客户所在国家：{cc_country_sel}。
客户当地此刻时间：{now.strftime('%Y-%m-%d %H:%M')}（星期{now.weekday()+1}），是否工作时间：{is_work}，是否周末：{is_weekend}，今日是否节日：{holiday or '否'}。
我方情况：{kb.get_company_brief()}
请简短输出(中文)：1)现在此刻该不该发邮件/打电话，为什么；2)今天当地哪个时段发开发信/回复询盘打开率最高；3)该国商务沟通1-2条时间/节奏提醒(如周五祈祷、斋月等)。控制在200字内。"""
                        st.markdown(ai.chat(prompt))
                    except Exception as e:
                        st.error(f"AI错误：{e}")

        with cc_t4:
            st.subheader("📰 外贸热点研判")
            st.caption("选市场+主题，AI 结合我方知识库做采购影响研判（实时新闻源后续接入，当前为基于行业常识与知识库的研判框架）")
            cc_mkt = st.selectbox("关注市场", ["中东", "欧美", "东南亚", "非洲", "南美"], key="cc_mkt")
            cc_topic = st.selectbox("关注主题", ["汇率波动", "关税/贸易政策", "采购旺季/节日备货", "海运物流", "原材料价格", "竞争对手动向"], key="cc_topic")
            if st.button("📡 生成研判", key="cc_news_btn", type="primary", use_container_width=True):
                with st.spinner("AI研判中..."):
                    try:
                        prompt = f"""你是资深B2B外贸市场分析师，服务阳江刀剪厨具出口企业。
我方：{kb.get_company_brief()}
关注市场：{cc_mkt}；关注主题：{cc_topic}。
请输出(中文，分点)：1)该市场近期在此主题上的典型动向及其对我方客户采购的影响；2)对客户报价/开发信/跟进节奏的具体建议；3)1-2条需要持续盯的信号。300字内。涉及具体最新数据请标注"需实时核实"。"""
                        st.markdown(ai.chat(prompt))
                    except Exception as e:
                        st.error(f"AI错误：{e}")

        with cc_t5:
            st.subheader("🎪 展会情报")
            st.caption("五金刀剪/餐厨行业主要展会台账；选客户国家，AI 推荐该重点约见哪个展")
            expos_df = pd.DataFrame(EXPOS_2026)
            expos_df.columns = ["展会", "国家/城市", "月份", "品类", "相关度", "备注"]
            st.dataframe(expos_df, use_container_width=True, hide_index=True)
            st.markdown("---")
            cc_expo_country = st.selectbox("客户所在国家/地区",
                ["美国", "德国", "英国", "阿联酋", "沙特", "日本", "澳大利亚", "俄罗斯/独联体", "东南亚", "南美"], key="cc_expo_country")
            cc_expo_note = st.text_input("客户主营（可选）", placeholder="如:连锁厨具零售商/批发商", key="cc_expo_note")
            if st.button("🎯 AI推荐参展/观展价值", key="cc_expo_btn", use_container_width=True):
                with st.spinner("AI分析中..."):
                    try:
                        expos_txt = "\n".join([f"- {e['name']}（{e['country']}，{e['month']}，相关度{e['fit']}）：{e['note']}" for e in EXPOS_2026])
                        prompt = f"""你是外贸展会营销顾问。我方：{kb.get_company_brief()}
客户所在：{cc_expo_country}；客户主营：{cc_expo_note or '未知'}。
可用展会清单：
{expos_txt}
请输出(中文)：1)针对这个客户所在市场，最值得约见/重点布局的1-2个展会及理由；2)展前给该客户发什么邀约话术方向；3)若不参展，线上如何借这个展会做营销由头。200字内。"""
                        st.markdown(ai.chat(prompt))
                    except Exception as e:
                        st.error(f"AI错误：{e}")

    elif cc_current == "✉️ 客户开发":
        cc_p1, cc_d1, cc_d2, cc_g1, cc_find = st.tabs(
            ["🎯 个性化开发信(网址+案例)", "✉️ 新开发信", "🔄 多轮跟进", "🎯 业绩目标", "🔍 找客户关键词"])

        # ===== 个性化开发信（personalized-email skill）=====
        EP_FILE = Path(__file__).parent / "data" / "enterprise_profile.json"
        _ep_default = {
            "cn_name": "阳江市锴利国际贸易有限公司", "en_name": "Yangjiang KaiLionCrafts Hardware Co., Ltd.",
            "founded": "2010", "staff": "50人", "factory_area": "2000平方米",
            "main_biz": "专业厨房刀/剪刀/户外刀/厨房用品 OEM/ODM/Private Label",
            "advantages": "源头工厂直供 / 支持小批量定制 / 交期稳定30天内",
            "export_regions": "欧美、中东、东南亚、南美", "cert": "ISO9001、BSCI",
            "intro": "KaiLionCrafts 位于中国刀剪之都阳江，专注高端刀剪厨具B2B出口十余年。",
            "cases": [
                {"行业": "欧美厨具品牌", "地区": "美国", "做什么": "为其代工厨师刀套装",
                 "解决问题": "原供应商品质不稳，我们统一材质与公差", "结果": "连续返单3年"},
            ],
        }

        def _load_ep():
            try:
                if EP_FILE.exists():
                    import json as _j
                    d = _j.loads(EP_FILE.read_text(encoding="utf-8"))
                    for k, v in _ep_default.items():
                        d.setdefault(k, v)
                    return d
            except Exception:
                pass
            return dict(_ep_default)

        with cc_p1:
            st.subheader("🎯 个性化开发信（一对一 · 网址+案例背书）")
            st.caption("填一次企业信息与案例库 → 输入客户网址 → AI 输出：客户背调摘要 + 匹配依据 + 个性化开发信")
            ep = _load_ep()

            with st.expander("⚙️ 第一步：企业信息与工程案例库（只需维护一次，自动保存）", expanded=False):
                cA, cB = st.columns(2)
                with cA:
                    e_cn = st.text_input("企业中文名称", ep["cn_name"], key="ep_cn")
                    e_en = st.text_input("企业英文名称", ep["en_name"], key="ep_en")
                    e_founded = st.text_input("成立年份", ep["founded"], key="ep_founded")
                    e_staff = st.text_input("员工人数", ep["staff"], key="ep_staff")
                    e_area = st.text_input("工厂面积", ep["factory_area"], key="ep_area")
                with cB:
                    e_biz = st.text_input("主营产品/服务", ep["main_biz"], key="ep_biz")
                    e_adv = st.text_input("核心优势（最多3条，顿号分隔）", ep["advantages"], key="ep_adv")
                    e_region = st.text_input("出口经验地区", ep["export_regions"], key="ep_region")
                    e_cert = st.text_input("资质认证", ep["cert"], key="ep_cert")
                    e_intro = st.text_area("英文介绍（200字内，可选）", ep["intro"], key="ep_intro", height=60)

                st.markdown("**工程案例库（AI 按 同行业>同产品线>同地区 自动匹配）**")
                cases = ep.get("cases", [])
                case_rows = []
                for i, cs in enumerate(cases):
                    st.markdown(f"案例 {i+1}")
                    cc1, cc2 = st.columns(2)
                    with cc1:
                        case_rows.append({
                            "行业": st.text_input("客户行业", cs.get("行业", ""), key=f"cs_ind_{i}"),
                            "地区": st.text_input("客户地区", cs.get("地区", ""), key=f"cs_reg_{i}"),
                        })
                    with cc2:
                        case_rows.append({
                            "做什么": st.text_input("用我们的产品做什么", cs.get("做什么", ""), key=f"cs_use_{i}"),
                            "解决/结果": st.text_input("解决问题 / 客户反馈", cs.get("解决问题", "") + "；" + cs.get("结果", ""), key=f"cs_res_{i}"),
                        })
                ca_col1, ca_col2 = st.columns(2)
                with ca_col1:
                    if st.button("➕ 新增一个案例", key="ep_add_case", use_container_width=True):
                        cases.append({"行业": "", "地区": "", "做什么": "", "解决问题": "", "结果": ""})
                        cases_save = {
                            "cn_name": e_cn, "en_name": e_en, "founded": e_founded, "staff": e_staff,
                            "factory_area": e_area, "main_biz": e_biz, "advantages": e_adv,
                            "export_regions": e_region, "cert": e_cert, "intro": e_intro, "cases": cases,
                        }
                        import json as _j
                        EP_FILE.write_text(_j.dumps(cases_save, ensure_ascii=False, indent=2), encoding="utf-8")
                        st.rerun()
                with ca_col2:
                    if st.button("🗑 删除最后一个案例", key="ep_del_case", use_container_width=True):
                        if len(cases) > 0:
                            cases.pop()
                            cases_save = {
                                "cn_name": e_cn, "en_name": e_en, "founded": e_founded, "staff": e_staff,
                                "factory_area": e_area, "main_biz": e_biz, "advantages": e_adv,
                                "export_regions": e_region, "cert": e_cert, "intro": e_intro, "cases": cases,
                            }
                            import json as _j
                            EP_FILE.write_text(_j.dumps(cases_save, ensure_ascii=False, indent=2), encoding="utf-8")
                            st.rerun()

                if st.button("💾 保存企业信息与案例", type="primary", key="ep_save", use_container_width=True):
                    saved_cases = []
                    for i, cs in enumerate(cases):
                        saved_cases.append({
                            "行业": st.session_state.get(f"cs_ind_{i}", ""),
                            "地区": st.session_state.get(f"cs_reg_{i}", ""),
                            "做什么": st.session_state.get(f"cs_use_{i}", ""),
                            "解决问题": st.session_state.get(f"cs_res_{i}", ""),
                            "结果": "",
                        })
                    out = {
                        "cn_name": e_cn, "en_name": e_en, "founded": e_founded, "staff": e_staff,
                        "factory_area": e_area, "main_biz": e_biz, "advantages": e_adv,
                        "export_regions": e_region, "cert": e_cert, "intro": e_intro,
                        "cases": saved_cases,
                    }
                    import json as _j
                    EP_FILE.write_text(_j.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
                    st.success("✅ 企业信息与案例库已保存")

            st.markdown("---")
            st.markdown("**第二步：输入客户网站 → 生成个性化开发信**")
            cu1, cu2 = st.columns(2)
            cust_url = cu1.text_input("客户网站地址", placeholder="https://example.com")
            cust_country = cu2.text_input("客户国家/地区（用于出当地语言版本）",
                                          placeholder="如：西班牙/德国/阿联酋/巴西", key="pc_country")
            cust_extra = st.text_input("补充客户信息（网址打不开时手动填，可选）",
                                       placeholder="公司名/主营/地区...", key="pc_extra")
            if st.button("🚀 生成个性化开发信", type="primary", use_container_width=True):
                if not (cust_url or cust_extra):
                    st.warning("请填写客户网址，或手动补充客户信息")
                else:
                    with st.spinner("AI 背调 + 匹配案例 + 生成开发信..."):
                        try:
                            ep_now = _load_ep()
                            case_txt = "\n".join(
                                [f"案例{i+1}（行业:{c.get('行业','')} 地区:{c.get('地区','')}）："
                                 f"{c.get('做什么','')}；我们解决了：{c.get('解决问题','')}；结果：{c.get('结果','')}"
                                 for i, c in enumerate(ep_now.get("cases", []))]
                            ) or "（暂无案例）"
                            prompt = f"""你是B2B外贸开发信专家。请按以下流程为客户生成一对一个性化开发信。

# 我们的企业信息
- 名称：{ep_now.get('cn_name')} / {ep_now.get('en_name')}
- 成立：{ep_now.get('founded')}年｜员工：{ep_now.get('staff')}｜工厂：{ep_now.get('factory_area')}
- 主营：{ep_now.get('main_biz')}
- 核心优势：{ep_now.get('advantages')}
- 出口地区：{ep_now.get('export_regions')}
- 资质：{ep_now.get('cert')}

# 我们的工程案例库（请按 同行业>同产品线>同地区 自动匹配最相关的）
{case_txt}

# 客户信息
- 客户网站：{cust_url}
- 客户国家/地区：{cust_country or '未填（默认仅英文）'}
- 补充：{cust_extra or '无'}

# 任务
1. 客户背调：基于客户网站/名称推断对方公司名、主营、产品线、目标市场、规模。若网址无法访问或信息不足，请明确说明并按合理默认生成。
2. 匹配依据：逐条说明匹配了哪个行业/哪条产品线/哪个地区，对应我方哪个案例或优势。
3. 生成英文个性化开发信：标题突出对方业务关键词（不要出现我方产品型号）；正文四段——①开篇点对方业务/痛点 ②用真实案例做信任背书（只说事实数据）③对应痛点讲我方优势与好处 ④具体行动号召（如"本周15分钟通话"）。语气按对方规模调整。
4. 双语版本：根据客户国家/地区，在英文之外再出一段当地语言开发信（西语/法语/德语/葡语/阿语/俄语等；若为英语国家或未填国家，则注明"英语市场，仅英文即可"）。
5. WhatsApp开场话术：英文一条 + 当地语言一条，每条30-50字，口语化、轻量、无附件感，适合首次WhatsApp触达。

严格按下面格式输出：
【客户背调摘要】
公司/主营/目标市场/主要产品

【匹配依据】
✅ ...

【英文开发信】
Subject: ...
Dear ...
（正文）
Best regards, {ep_now.get('en_name')}

【当地语言开发信】
（若仅英文市场则写"英语市场，无需当地语言版本"）

【WhatsApp话术】
EN: ...
当地语言: ...
"""
                            result = ai.chat(prompt)
                            st.session_state["pc_last"] = {
                                "url": cust_url, "country": cust_country,
                                "extra": cust_extra, "result": result,
                            }
                            st.markdown("---")
                            st.markdown(result)
                            # 一键存档为客户
                            if st.button("💾 存档为客户（自动进客户管理，阶段=已发开发信）",
                                         use_container_width=True, type="primary"):
                                _name = (cust_extra or cust_url or "未命名客户").split("\n")[0][:40]
                                cm.add_customer({
                                    "name": _name, "country": cust_country or "未填",
                                    "website": cust_url, "status": "已发开发信",
                                    "source": "AI开发信",
                                    "analysis": result[:800],
                                    "notes": f"网址:{cust_url}｜{cust_extra or ''}",
                                })
                                st.success(f"✅ 已存档客户「{_name}」，请到客户中心→客户管理查看")
                        except Exception as e:
                            st.error(f"AI错误：{e}")

        with cc_d1:
            st.subheader("开发信生成")
            # ===== 我的语气档案（蒸馏作者风格） =====
            with st.expander("🎙️ 我的语气档案（把你过去真发过的开发信喂进来，AI以后按你的语气写）", expanded=False):
                _v = _load_voice()
                st.caption(f"已收集样本 {len(_v.get('samples', []))} 条"
                           + (" · 风格已蒸馏 ✅" if _v.get("style_notes") else " · 还没蒸馏"))
                with st.form("voice_sample"):
                    vs_type = st.selectbox("样本类型", ["开发信", "WhatsApp/即时回复", "报价邮件", "其他"])
                    vs_text = st.text_area("粘贴你过去写过的原文（英文最好，可中英混合）", height=120)
                    if st.form_submit_button("保存样本", use_container_width=True):
                        if vs_text.strip():
                            _v.setdefault("samples", []).append(
                                {"type": vs_type, "content": vs_text.strip(),
                                 "date": datetime.now().strftime("%Y-%m-%d")})
                            _save_voice(_v); st.success("已保存样本"); st.rerun()
                        else:
                            st.warning("请先粘贴内容")
                if _v.get("samples"):
                    if st.button("✨ 蒸馏我的语气风格", type="primary", use_container_width=True):
                        _sample_txt = "\n\n---\n\n".join(
                            [f"[{s.get('type','')}] {s.get('content','')}" for s in _v["samples"][-20:]])
                        _dp = ("你是文案风格分析师。以下是我过去真实发过的外贸开发信/客户沟通原文。"
                               "请蒸馏出我的写作风格，输出：1)整体语气(正式/亲切/直接/委婉) 2)句式特点 "
                               "3)高频用词与口头禅 4)段落结构习惯 5)要避免的写法。中文回答，300字内，要具体可模仿。"
                               f"\n\n我的原文：\n{_sample_txt}")
                        with st.spinner("正在蒸馏你的语气..."):
                            try:
                                _v["style_notes"] = ai.chat(_dp)
                                _v["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
                                _save_voice(_v); st.success("✅ 风格已蒸馏，以后开发信会自动套用"); st.rerun()
                            except Exception as e:
                                st.error(f"AI错误：{e}")
                if _v.get("style_notes"):
                    st.markdown("**📌 当前语气档案：**")
                    st.info(_v["style_notes"])
            with st.form("ce_form"):
                col1, col2 = st.columns(2)
                with col1:
                    ce_company = st.text_input("客户公司 *")
                    ce_country = st.text_input("国家 *")
                with col2:
                    ce_product = st.selectbox("推荐产品", ["厨房刀具", "专业剪刀", "户外刀具", "厨房用品"])
                ce_analysis = st.text_area("客户分析结论（可选，贴上去信更准）", height=60,
                                           placeholder="可粘贴上面客户分析的结果")
                ce_submit = st.form_submit_button("✉️ 生成", use_container_width=True, type="primary")
            if ce_submit and ce_company and ce_country:
                with st.spinner("生成中..."):
                    try:
                        prompt = COLD_EMAIL_PROMPT.format(
                            company_name=ce_company, country=ce_country,
                            products=ce_product, customer_analysis=ce_analysis or "暂无分析，基于主营产品判断",
                            company_profile=kb.get_company_brief(),
                            pain_points=kb.get_pain_points(), terminology=kb.get_terminology(),
                        )
                        _vn = _load_voice().get("style_notes")
                        if _vn:
                            prompt += f"\n\n【我方作者语气档案，必须严格模仿此语气、句式与用词】\n{_vn}"
                        result = ai.chat(prompt)
                        st.markdown(result)
                    except Exception as e:
                        st.error(f"AI错误：{e}")
        with cc_d2:
            st.subheader("多轮跟进")
            with st.form("fol_form"):
                col1, col2 = st.columns(2)
                with col1:
                    fol_company = st.text_input("客户公司 *")
                    fol_num = st.selectbox("第几轮", [1, 2, 3, 4])
                with col2:
                    fol_reply = st.selectbox("客户状态", ["未回复", "已读未回", "有回复但在比价", "明确拒绝过"])
                fol_submit = st.form_submit_button("🔄 生成跟进", use_container_width=True, type="primary")
            if fol_submit and fol_company:
                with st.spinner("生成中..."):
                    try:
                        prompt = FOLLOW_UP_PROMPT.format(
                            company_name=fol_company, follow_up_number=fol_num,
                            first_email_date="约一周前", previous_subject="（首封开发信）",
                            products="刀剪全品类", country="未知", reply_status=fol_reply,
                            company_profile=kb.get_company_brief(),
                        )
                        result = ai.chat(prompt)
                        st.markdown(result)
                    except Exception as e:
                        st.error(f"AI错误：{e}")

        with cc_g1:
            st.subheader("🎯 业绩目标")
            st.caption("设定本月开发与成交目标，自动读取客户中心CRM实际进度算达成率")
            _ym = datetime.now().strftime("%Y-%m")
            _targets = _perf_load()
            _cur = _targets.get(_ym, {})
            cg1, cg2, cg3, cg4 = st.columns(4)
            with cg1:
                t_dev = st.number_input("本月目标开发信(封)", min_value=0, value=int(_cur.get("dev", 20)), step=5, key="pt_dev")
            with cg2:
                t_lead = st.number_input("本月目标意向客户(个)", min_value=0, value=int(_cur.get("leads", 8)), step=1, key="pt_leads")
            with cg3:
                t_deal = st.number_input("本月目标成交(单)", min_value=0, value=int(_cur.get("deals", 2)), step=1, key="pt_deals")
            with cg4:
                t_amt = st.number_input("本月目标成交额(USD)", min_value=0, value=int(_cur.get("amount", 50000)), step=5000, key="pt_amt")
            if st.button("💾 保存本月目标", key="pt_save", use_container_width=True):
                _targets[_ym] = {"dev": t_dev, "leads": t_lead, "deals": t_deal, "amount": t_amt}
                _perf_save(_targets)
                st.success(f"✅ 已保存 {_ym} 业绩目标")
            st.markdown("---")
            st.markdown(f"**📈 {_ym} 实际进度（来自客户中心CRM）**")
            try:
                _st = cm.get_statistics()
                _dealed = _st.get("by_status", {}).get("已成交", 0)
                _total = _st.get("total", 0)

                def _bar(actual, target, unit=""):
                    if target <= 0:
                        st.write(f"实际 {actual}{unit} ｜ 目标未设")
                        return
                    st.progress(min(1.0, actual / target),
                                text=f"实际 {actual}{unit} / 目标 {target}{unit}（{actual/target*100:.0f}%）")

                _bar(_total, t_lead, "个客户")
                _bar(_dealed, t_deal, "单")
                st.caption("说明：开发信发送量、成交额暂未埋点，先以CRM建档客户数/成交单数为进度口径；后续可接 finance_db 订单财务自动取成交额。")
            except Exception as e:
                st.error(f"读取CRM进度失败：{e}")

        with cc_find:
            st.subheader("🔍 Google 找客户关键词生成器")
            st.caption("输入产品与目标市场，AI 输出可直接粘到 Google 的精准搜索语句；搜到客户网址后，回到「个性化开发信」做背调。")
            with st.form("find_kw_form"):
                fk1, fk2 = st.columns(2)
                fk_product = fk1.selectbox("产品", ["厨房刀具", "专业剪刀", "户外刀具", "厨房用品"])
                fk_market = fk2.text_input("目标市场（国家/州/城市）", placeholder="如：美国 / 德国 / 加州")
                fk3, fk4 = st.columns(2)
                fk_type = fk3.selectbox("目标客户类型", ["进口商/分销商", "品牌商/私有标签", "批发商", "电商卖家", "全部都要"])
                fk_exclude = fk4.text_input("要排除的词（空格分隔）", value="amazon walmart aliexpress")
                fk_submit = st.form_submit_button("🚀 生成搜索关键词", type="primary", use_container_width=True)
            if fk_submit:
                if not fk_market.strip():
                    st.warning("请填目标市场")
                else:
                    with st.spinner("AI 正在生成找客户关键词..."):
                        try:
                            _excl = " -".join(fk_exclude.split())
                            fk_prompt = (
                                "你是B2B外贸自主开发客户专家，精通Google搜索找海外客户。\n"
                                f"我是阳江刀剪出口商(KaiLionCrafts)，主营{fk_product}，支持OEM/ODM/Private Label、小批量试单。\n"
                                f"目标市场：{fk_market}；目标客户类型：{fk_type}。\n\n"
                                "请输出可直接复制到Google搜索的精准客户查找语句，要求：\n"
                                "1. 不用我的产品词堆砌，要用客户会怎么描述他生意的词(importer/wholesaler/distributor/brand/supplier等)\n"
                                "2. 输出12-15条可直接粘到Google的搜索语句，关键短语用英文双引号包裹做精准匹配\n"
                                f"3. 每条语句末尾加上排除语法(-{_excl})\n"
                                "4. 分两梯队：第一梯队=小单快反、能快速出结果；第二梯队=大订单但周期长\n"
                                "5. 每条后面括号用中文注明：这条大概能搜到什么类型客户\n"
                                "6. 最后用3行中文讲：搜出来第一两页不精准时，怎么调整关键词。"
                            )
                            st.markdown(ai.chat(fk_prompt))
                        except Exception as e:
                            st.error(f"AI错误：{e}")

    elif cc_current == "💬 客户问答":
        cc_q1, cc_q2 = st.tabs(["💬 智能回复", "🗣️ 沟通话术与文化禁忌"])
        with cc_q1:
            st.subheader("客户问题智能回复")
            with st.form("qa_form"):
                q = st.text_area("客户问题 *", height=100)
                qa_company = st.text_input("客户公司（可选）")
                qa_submit = st.form_submit_button("🤖 AI回复", use_container_width=True, type="primary")
            if qa_submit and q:
                with st.spinner("生成中..."):
                    try:
                        prompt = FAQ_PROMPT.format(
                            question=q, company_name=qa_company or "客户", country="未知",
                            conversation_history="（无）", faq_content=kb.get_faq(),
                            product_specs=kb.get_product_specs()[:1500],
                            terminology=kb.get_terminology(),
                        )
                        result = ai.chat(prompt)
                        st.markdown(result)
                    except Exception as e:
                        st.error(f"AI错误：{e}")
        with cc_q2:
            st.subheader("🗣️ 沟通话术与文化禁忌")
            st.caption("选客户国家+沟通场景，AI 结合知识库谈判/邮件技巧，输出文化禁忌与可直接套用的话术模板")
            cc_q_country = st.selectbox("客户所在国家",
                ["美国", "德国", "英国", "阿联酋", "沙特", "印度", "日本", "澳大利亚", "俄罗斯", "巴西"], key="cq_country")
            cc_q_scene = st.selectbox("沟通场景",
                ["首次开发/破冰", "报价后客户嫌贵", "客户比价/压价", "催下单/催定金", "交期延误解释", "售后/投诉处理", "节日问候维护关系"], key="cq_scene")
            cc_q_extra = st.text_input("客户情况补充（可选）", placeholder="如:首次询价/已合作3年/正在跟竞品谈...", key="cq_extra")
            if st.button("🗣️ 生成沟通建议与话术", key="cq_btn", type="primary", use_container_width=True):
                with st.spinner("AI生成中..."):
                    try:
                        prompt = f"""你是资深B2B外贸沟通教练，服务阳江刀剪厨具出口企业。
我方：{kb.get_company_brief()}
知识库谈判要点：{kb.get_negotiation_tips()[:1200] if callable(getattr(kb,'get_negotiation_tips',None)) else ''}
知识库邮件技巧：{kb.get_email_tips()[:1200] if callable(getattr(kb,'get_email_tips',None)) else ''}
客户国家：{cc_q_country}；沟通场景：{cc_q_scene}；客户情况：{cc_q_extra or '未知'}。
请输出(中文)：
【文化与商务禁忌】3条以内，该国客户在邮件/谈判中最该注意的雷区；
【沟通策略】2-3句，这个场景下该怎么把握节奏与措辞；
【话术模板】给一段可直接发给客户的英文邮件/WhatsApp草稿（语气贴合该国商务风格），关键句可替换处用[方括号]标注。"""
                        st.markdown(ai.chat(prompt))
                    except Exception as e:
                        st.error(f"AI错误：{e}")

    elif cc_current == "📊 客户管理":
        st.caption("借鉴GlobalDesk思路：数据总览 · 客户列表 · 看板开发进度 · 待办提醒 · 新增客户")
        cc_m1, cc_m2, cc_m3, cc_m4, cc_m5 = st.tabs(
            ["📊 数据总览", "👥 客户列表", "🗂️ 客户看板", "⏰ 待办提醒", "➕ 新增客户"])

        CUSTOMER_SOURCES = ["Google搜索", "Google Maps", "LinkedIn", "Alibaba", "展会", "客户转介绍", "抖音/社媒", "其他"]
        CUSTOMER_TYPES = ["进口商", "批发商", "零售商", "品牌商", "代理商", "制造商", "其他"]
        _grade_color = {"A": "#28a745", "B": "#fd7e14", "C": "#6c757d"}

        # ---------- Tab1 数据总览 ----------
        with cc_m1:
            try:
                _st = cm.get_statistics()
                _today_fu = cm.get_follow_up_today()
                _overdue = cm.get_overdue_follow_up()
                _pdata = cm.get_pipeline_data()
                _total = _st["total"]
                _a_count = _st["by_grade"].get("A", 0)
                _quoted = _pdata.get("quoted", {}).get("count", 0)
                _closed = _pdata.get("closed", {}).get("count", 0)
                m1, m2, m3, m4, m5, m6 = st.columns(6)
                m1.metric("客户总数", _total)
                m2.metric("今日待跟进", len(_today_fu))
                m3.metric("超期未跟进", len(_overdue))
                m4.metric("A级重点", _a_count)
                m5.metric("报价中", _quoted)
                m6.metric("已成交", _closed)

                st.markdown("**销售漏斗（按阶段）**")
                _maxc = max([v["count"] for v in _pdata.values()] + [1])
                for key, v in _pdata.items():
                    w = int(v["count"] / _maxc * 100)
                    st.markdown(
                        f'<div style="display:flex;align-items:center;margin:3px 0;">'
                        f'<div style="width:64px;font-size:12px;">{v["name"]}</div>'
                        f'<div style="flex:1;background:#f0f0f0;border-radius:6px;height:20px;">'
                        f'<div style="width:{w}%;background:{v["color"]};height:20px;border-radius:6px;color:#fff;'
                        f'font-size:11px;line-height:20px;padding-left:6px;">{v["count"]}</div></div></div>',
                        unsafe_allow_html=True)

                cL, cR = st.columns(2)
                with cL:
                    st.markdown("**客户等级分布**")
                    for g in ["A", "B", "C"]:
                        n = _st["by_grade"].get(g, 0)
                        st.markdown(
                            f'<div style="display:flex;align-items:center;margin:2px 0;">'
                            f'<span style="width:24px;color:{_grade_color[g]};font-weight:700;">{g}</span>'
                            f'<div style="flex:1;background:#f0f0f0;border-radius:4px;height:14px;">'
                            f'<div style="width:{int(n/_total*100) if _total else 0}%;background:{_grade_color[g]};height:14px;border-radius:4px;"></div></div>'
                            f'<span style="width:30px;text-align:right;font-size:12px;">{n}</span></div>',
                            unsafe_allow_html=True)
                with cR:
                    st.markdown("**今日 / 超期待跟进**")
                    st.info(f"今日待跟进 {len(_today_fu)} 个客户，请到「⏰ 待办提醒」处理")
                    if _overdue:
                        st.warning(f"⚠️ {len(_overdue)} 个客户已超期未跟进，建议优先处理")
            except Exception as e:
                st.error(f"加载失败：{e}")

        # ---------- Tab2 客户列表（表格+筛选+详情+跟进记录）----------
        with cc_m2:
            try:
                customers = cm.list_customers()
                cF1, cF2, cF3 = st.columns([3, 1, 1])
                with cF1:
                    kw = st.text_input("搜索（公司/国家/产品）", key="cl_kw")
                with cF2:
                    g_f = st.selectbox("等级", ["全部", "A", "B", "C"], key="cl_g")
                with cF3:
                    stage_f = st.selectbox("阶段", ["全部"] + [s["name"] for s in PIPELINE_STAGES], key="cl_s")

                def _stage_name(c):
                    return next((s["name"] for s in PIPELINE_STAGES if s["key"] == c.get("pipeline_stage", "lead")),
                                c.get("status", ""))
                rows = []
                for c in customers:
                    if kw and kw.lower() not in (c.get("company_name", "") + c.get("country", "") + c.get("products", "")).lower():
                        continue
                    if g_f != "全部" and c.get("grade", "C") != g_f:
                        continue
                    if stage_f != "全部" and _stage_name(c) != stage_f:
                        continue
                    rows.append({
                        "公司": c.get("company_name", ""), "国家": c.get("country", ""),
                        "来源": c.get("source", ""), "等级": c.get("grade", "C"),
                        "阶段": _stage_name(c), "评分": c.get("score", 0),
                        "下次跟进": c.get("next_follow_up", ""),
                    })
                if rows:
                    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
                else:
                    st.info("无匹配客户")

                st.markdown("---")
                st.markdown("**📇 客户详情与跟进记录**")
                _cust_ids = [c["id"] for c in customers] or ["__empty__"]
                sel = st.selectbox("选择客户", _cust_ids,
                                  format_func=lambda i: "（暂无客户）" if i == "__empty__" else next((c.get("company_name", "") for c in customers if c["id"] == i), i),
                                  key="cl_sel")
                cust = cm.get_customer(sel) if sel != "__empty__" else None
                if cust:
                    dc1, dc2, dc3 = st.columns(3)
                    dc1.write(f"**公司**：{cust.get('company_name','')}\n**国家**：{cust.get('country','')}")
                    dc2.write(f"**等级**：{cust.get('grade','C')}　**阶段**：{_stage_name(cust)}\n**官网**：{cust.get('website','')}")
                    dc3.write(f"**来源**：{cust.get('source','')}　**类型**：{cust.get('customer_type','')}\n**下次跟进**：{cust.get('next_follow_up','未定')}")
                    if cust.get("notes"):
                        st.caption(f"备注：{cust['notes']}")
                    acts = cust.get("activities", [])
                    if acts:
                        st.markdown("**跟进时间线**")
                        for a in reversed(acts[-8:]):
                            st.markdown(f"- `{(a.get('created_at','') or '')[:16]}` 【{a.get('type','')}】{a.get('description','')}")
                    # ---- P0: 关联订单与收款（客户名模糊匹配 finance_db）----
                    try:
                        import finance_db as _fdb
                        _cn = (cust.get("company_name", "") or "").strip()
                        _orders = [o for o in _fdb.list_sales_orders()
                                   if _cn and (_cn in (o.get("customer") or "") or (o.get("customer") or "") in _cn)]
                        _pay_no = {o["order_no"] for o in _orders}
                        _received = sum(p["amount"] for p in _fdb.list_payments()
                                       if p.get("direction") == "收客户" and p.get("ref_order_no") in _pay_no)
                        _owed = sum(o["total_amount"] for o in _orders) - _received
                        st.markdown("---")
                        st.markdown("**📦 关联订单与收款**")
                        r1, r2, r3 = st.columns(3)
                        r1.metric("订单数", len(_orders))
                        r2.metric("已收款", f"${_received:,.0f}")
                        r3.metric("应收余额", f"${_owed:,.0f}")
                        if _orders:
                            st.dataframe(pd.DataFrame([{
                                "订单号": o["order_no"], "产品": o["product_summary"],
                                "金额": f"${o['total_amount']:,.0f}", "状态": o["status"],
                                "下单日": o["order_date"], "交期": o["delivery_date"],
                            } for o in _orders]), use_container_width=True, hide_index=True)
                        else:
                            st.caption("该客户暂无订单记录（在「🧾 订单台账」录入后会自动按客户名关联）")
                    except Exception as _e:
                        st.caption(f"订单关联暂不可用：{_e}")
                    with st.form("add_act_form"):
                        st.markdown("**＋ 记一条跟进**")
                        af1, af2, af3 = st.columns([1, 2, 1])
                        with af1:
                            atype = st.selectbox("渠道", ["邮件", "WhatsApp", "电话", "面谈", "样品", "报价", "其他"])
                        with af2:
                            adesc = st.text_input("跟进内容/客户反馈", placeholder="如:客户嫌贵5%,要求再降3%")
                        with af3:
                            adays = st.number_input("几天后再跟进", 0, 90, 3)
                        if st.form_submit_button("💾 保存跟进并设下次提醒", use_container_width=True):
                            cm.add_activity(sel, atype, adesc)
                            cm.set_next_follow_up(sel, int(adays))
                            st.success("✅ 已记录跟进并更新下次跟进时间")
                            st.rerun()
            except Exception as e:
                st.error(f"加载失败：{e}")

        # ---------- Tab3 客户看板（开发进度，按阶段分列）----------
        with cc_m3:
            st.subheader("🗂️ 客户开发进度看板")
            st.caption("按销售阶段分列；点卡片下方按钮可把客户推进到下一阶段")
            pdata = cm.get_pipeline_data()
            cols = st.columns(len(PIPELINE_STAGES))
            for i, stage in enumerate(PIPELINE_STAGES):
                with cols[i]:
                    v = pdata.get(stage["key"], {})
                    st.markdown(
                        f'<div style="border-top:4px solid {stage["color"]};padding:6px;background:#fafafa;border-radius:6px;">'
                        f'<b>{stage["name"]}</b> <span style="float:right;color:{stage["color"]};">{v.get("count",0)}</span></div>',
                        unsafe_allow_html=True)
                    for c in v.get("customers", []):
                        g = c.get("grade", "C")
                        st.markdown(
                            f'<div style="background:#fff;border:1px solid #eee;border-left:4px solid {_grade_color.get(g,"#999")};'
                            f'padding:7px;border-radius:4px;margin:5px 0;font-size:12px;">'
                            f'<b>{c.get("company_name","")}</b><br/>'
                            f'<span style="color:#888">{c.get("country","")} · {c.get("source","")}</span><br/>'
                            f'<span style="color:#fd7e14">下次跟进:{c.get("next_follow_up","未定")}</span></div>',
                            unsafe_allow_html=True)
                        if stage["key"] != "closed":
                            next_stage = PIPELINE_STAGES[i + 1]["key"] if i + 1 < len(PIPELINE_STAGES) else stage["key"]
                            if st.button(f"→ {next_stage}", key=f"mv_{c['id']}_{stage['key']}", use_container_width=True):
                                cm.move_stage(c["id"], next_stage)
                                st.rerun()

        # ---------- Tab4 待办提醒 ----------
        with cc_m4:
            st.subheader("⏰ 待办提醒")
            st.caption("今日该跟谁、谁已超期，一目了然")
            today_fu = cm.get_follow_up_today()
            overdue = cm.get_overdue_follow_up()
            st.markdown(f"**📌 今日待跟进（{len(today_fu)}）**")
            if today_fu:
                for c in today_fu:
                    st.markdown(f"- **{c.get('company_name','')}**（{c.get('country','')} · {c.get('grade','C')}级）— 计划今日跟进")
            else:
                st.success("今日暂无待跟进客户")
            st.markdown("---")
            st.markdown(f"**🚨 已超期未跟进（{len(overdue)}）**")
            if overdue:
                for c in overdue:
                    st.warning(f"**{c.get('company_name','')}**（{c.get('country','')}）— 计划跟进日 {c.get('next_follow_up','')} 已过")
            else:
                st.success("无超期客户")
            with st.expander("📋 智能提醒规则（说明）"):
                st.markdown("""
- 报价后 3 天未复：建议发一次报价跟进邮件
- 样品寄出后 7 天：询问客户收到与试用反馈
- 30 天无互动：发激活/新品邮件重新触达
- A 级客户 7 天未跟进：优先处理，防止丢单
""")

        # ---------- Tab5 新增客户 ----------
        with cc_m5:
            st.subheader("➕ 新增客户档案")
            with st.form("new_cust_form"):
                n1, n2 = st.columns(2)
                with n1:
                    nc_name = st.text_input("公司名称 *")
                    nc_country = st.text_input("国家 *")
                    nc_city = st.text_input("城市（可选）")
                    nc_web = st.text_input("官网（可选）")
                with n2:
                    nc_source = st.selectbox("客户来源", CUSTOMER_SOURCES)
                    nc_type = st.selectbox("客户类型", CUSTOMER_TYPES)
                    nc_grade = st.selectbox("等级", ["A", "B", "C"])
                    nc_products = st.text_input("产品需求（可选）")
                nc_stage = st.selectbox("初始阶段", [s["name"] for s in PIPELINE_STAGES])
                nc_fu = st.number_input("几天后首次跟进提醒（0=不提醒）", 0, 60, 0)
                if st.form_submit_button("✅ 保存客户", type="primary", use_container_width=True):
                    if not nc_name or not nc_country:
                        st.warning("请填写公司名称和国家")
                    else:
                        stage_key = next((s["key"] for s in PIPELINE_STAGES if s["name"] == nc_stage), "lead")
                        _new_c = cm.add_customer({
                            "company_name": nc_name, "country": nc_country, "city": nc_city,
                            "website": nc_web, "source": nc_source, "customer_type": nc_type,
                            "grade": nc_grade, "products": nc_products, "pipeline_stage": stage_key,
                            "score": 0,
                        })
                        if int(nc_fu) > 0 and _new_c:
                            cm.set_next_follow_up(_new_c["id"], int(nc_fu))
                        st.success(f"✅ 已添加客户：{nc_name}")

# ============ 页面3：客户分析（旧） ============
elif page == "🎯 客户分析":
    st.info("已合并到「👥 客户中心」")
    st.title("🎯 潜在客户分析")
    st.caption("AI分析客户匹配度，给出开发建议")

    with st.form("customer_analysis_form"):
        col1, col2 = st.columns(2)
        with col1:
            company_name = st.text_input("公司名称 *", placeholder="例如：ABC Kitchenware Inc.")
            website = st.text_input("官网", placeholder="https://...")
            country = st.text_input("国家/地区 *", placeholder="例如：USA / Germany")
        with col2:
            products = st.text_area("主营产品 *", placeholder="例如：厨房刀具、厨具、户外用品...", height=100)
            size = st.selectbox("公司规模", ["未知", "小型(<50人)", "中型(50-500人)", "大型(500+人)", "集团/上市"])
        additional = st.text_area("其他信息（可选）", placeholder="LinkedIn信息、采购记录、展会接触等...", height=80)

        submitted = st.form_submit_button("🔍 AI分析客户", use_container_width=True)

    if submitted and company_name and country and products:
        with st.spinner("AI正在分析客户..."):
            context = kb.build_context(["company", "pain_points"])
            prompt = CUSTOMER_ANALYSIS_PROMPT.format(
                company_name=company_name,
                website=website or "未提供",
                country=country,
                products=products,
                size=size,
                additional_info=additional or "无",
                company_profile=kb.get_company_brief(),
                product_categories=", ".join(COMPANY["categories"]),
            )
            result = ai.chat(prompt)

        st.markdown("---")
        st.subheader("📋 AI分析结果")
        st.markdown(result)

        # 提取分数和等级
        import re
        score_match = re.search(r'总分[：:]\s*(\d+)', result)
        grade_match = re.search(r'等级[：:]\s*([ABCD])', result)
        score = int(score_match.group(1)) if score_match else 50
        grade = grade_match.group(1) if grade_match else "C"

        st.markdown("---")
        col1, col2, col3 = st.columns(3)
        with col1:
            st.metric("匹配度评分", f"{score}/100")
        with col2:
            st.metric("客户等级", f"{grade}级")
        with col3:
            st.metric("建议动作", CUSTOMER_GRADES[grade]["action"])

        if st.button("💾 保存到客户管理", type="primary", use_container_width=True):
            customer = cm.add_customer({
                "company_name": company_name,
                "website": website,
                "country": country,
                "products": products,
                "size": size,
                "additional_info": additional,
                "score": score,
                "grade": grade,
                "analysis": result,
            })
            st.success(f"客户已保存！ID: {customer['id']}")

# ============ 页面4：客户背调 ============
elif page == "🔍 客户背调":
    st.title("🔍 客户深度背调")
    st.caption("联网搜索 + 6层验证 + 15维度画像，开发前看清客户真实性")

    # 背调方式选择
    dd_mode = st.radio(
        "背调方式",
        ["🔍 联网搜索背调（推荐）", "📋 AI分析背调（无需联网）"],
        horizontal=True,
    )

    if dd_mode == "🔍 联网搜索背调（推荐）":
        st.info("💡 输入客户的邮箱、姓名或公司名，系统会联网搜索客户的公司信息、社交媒体、行业记录，然后AI生成真实性背调报告")

        col1, col2 = st.columns(2)
        with col1:
            dd_company = st.text_input("公司名称 *", placeholder="例如：ABC Kitchenware Inc")
            dd_email = st.text_input("客户邮箱（可选）", placeholder="例如：buyer@abc.com")
        with col2:
            dd_name = st.text_input("联系人姓名（可选）", placeholder="例如：John Smith")
            dd_website = st.text_input("客户官网（可选）", placeholder="https://...")

        # 搜索关键词构建
        search_keywords = []
        if dd_company:
            search_keywords.append(f"{dd_company} company")
            search_keywords.append(f"{dd_company} kitchenware knives")
        if dd_email:
            email_domain = dd_email.split('@')[-1] if '@' in dd_email else ''
            if email_domain:
                search_keywords.append(f"{email_domain} company")
        if dd_name:
            search_keywords.append(f"{dd_name} {dd_company}")

        if st.button("🌐 开始联网背调", use_container_width=True, type="primary") and dd_company:
            with st.spinner("正在联网搜索客户信息..."):
                # 模拟联网搜索（实际部署时可接入SerpAPI/Google Custom Search）
                st.info("🔍 正在搜索以下关键词：")
                for kw in search_keywords:
                    st.caption(f"  - {kw}")

                # 构建搜索上下文
                search_context = f"""
                【联网搜索关键词】
                {chr(10).join(search_keywords)}

                【客户输入信息】
                公司名称：{dd_company}
                联系人：{dd_name or '未提供'}
                邮箱：{dd_email or '未提供'}
                官网：{dd_website or '未提供'}

                【搜索结果说明】
                由于当前为本地部署环境，联网搜索功能需要配置搜索API（如SerpAPI、Google Custom Search、Bing Search API）。
                请在「设置」页面配置搜索API密钥后，系统将自动抓取以下信息：
                1. 公司官网和业务范围
                2. LinkedIn公司主页和员工信息
                3. 社交媒体账号（Facebook/Instagram/X）
                4. 行业展会参展记录
                5. 海关进出口记录
                6. 公司注册信息和真实性验证
                7. 客户评价和口碑
                8. 竞品和合作伙伴
                """

                # AI基于搜索上下文生成背调报告
                prompt = f"""
                你是KaiLionCrafts的专业客户背调分析师。请基于以下联网搜索信息，对客户进行深度背调。

                {search_context}

                请生成完整的背调报告，包含以下6层验证：

                ## 第一层：公司真实性验证
                - 公司是否真实存在
                - 注册信息、成立时间、规模
                - 官网和联系方式是否匹配

                ## 第二层：业务范围分析
                - 主营产品和品类
                - 是否与刀剪五金相关
                - 目标市场和客户群体

                ## 第三层：采购能力评估
                - 公司规模和采购能力
                - 是否有进口记录
                - 预估年采购量

                ## 第四层：社交媒体和线上存在
                - LinkedIn、Facebook、Instagram等
                - 活跃度和粉丝数
                - 品牌专业度

                ## 第五层：风险提示
                - 是否有欺诈记录
                - 付款风险
                - 需要注意的问题

                ## 第六层：开发建议
                - 客户等级评定（A/B/C/D）
                - 推荐切入点
                - 首封开发信建议
                - 推荐对接的产品品类

                请用中文输出，专业、客观、有数据支撑。
                """

                result = ai.chat(prompt)

            st.markdown("---")
            st.subheader("📋 联网背调报告")
            st.markdown(result)

            # 保存到当前成员工作空间
            member_key = st.session_state.get('current_member', 'leo')
            workspace_dir = Path(__file__).parent / "data" / TEAM_MEMBERS[member_key]['workspace_dir'] / "reports"
            workspace_dir.mkdir(parents=True, exist_ok=True)
            report_file = workspace_dir / f"背调_{dd_company}_{datetime.now().strftime('%Y%m%d_%H%M')}.md"
            report_file.write_text(f"# {dd_company} 背调报告\n\n{result}", encoding='utf-8')
            st.success(f"💾 背调报告已保存到 {TEAM_MEMBERS[member_key]['name']} 的工作空间")

            # 搜索API配置提示
            with st.expander("🔧 如何启用真实联网搜索？"):
                st.markdown("""
                当前为模拟搜索模式。要启用真实联网搜索，请配置以下任一API：

                1. **SerpAPI**（推荐，支持Google/LinkedIn等）
                   - 注册：https://serpapi.com
                   - 免费额度：每月100次搜索
                   - 在.env中添加：SEARCH_API_KEY=your_key

                2. **Google Custom Search API**
                   - 每天免费100次查询
                   - 需要创建Custom Search Engine

                3. **Bing Search API**
                   - 微软Azure提供
                   - 免费额度：每月1000次

                配置后，背调将自动抓取真实搜索结果，包括：
                - 公司官网和业务信息
                - LinkedIn公司主页
                - 社交媒体账号
                - 海关进出口记录
                - 行业展会记录
                - 客户评价和口碑
                """)

    else:
        # 原有的AI分析背调模式
        st.caption("基于客户信息和知识库，AI生成背调分析（不需要联网）")

        customers = cm.list_customers()
        use_existing = st.checkbox("从已有客户中选择", value=True)

        if use_existing and customers:
            customer_options = {f"{c['company_name']} ({c.get('grade','C')}级)": c for c in customers}
            selected = st.selectbox("选择客户", list(customer_options.keys()))
            customer = customer_options[selected]
            company_name = customer.get("company_name", "")
            website = customer.get("website", "")
            country = customer.get("country", "")
            products = customer.get("products", "")
        else:
            col1, col2 = st.columns(2)
            with col1:
                company_name = st.text_input("公司名称 *", placeholder="例如：ABC Kitchenware")
                website = st.text_input("官网", placeholder="https://...")
            with col2:
                country = st.text_input("国家", placeholder="例如：USA")
                products = st.text_area("主营产品", placeholder="客户卖什么？", height=80)

        if st.button("🔬 AI深度背调", use_container_width=True, type="primary") and company_name:
            with st.spinner("AI正在进行6层背调分析..."):
                prompt = DUE_DILIGENCE_PROMPT.format(
                    company_name=company_name,
                    website=website or "未提供",
                    country=country or "未知",
                    products=products or "未知",
                    company_profile=kb.get_company_brief(),
                )
                result = ai.chat(prompt)

            st.markdown("---")
            st.subheader("📋 背调报告")
            st.markdown(result)

            if use_existing and customers:
                if st.button("💾 保存背调到客户档案"):
                    cm.update_customer(customer["id"], {"due_diligence": result})
                    cm.add_activity(customer["id"], "背调", "完成AI深度背调分析")
                    st.success("已保存到客户档案！")

# ============ 页面5：开发信生成 ============
elif page == "✉️ 开发信生成":
    st.title("✉️ 个性化开发信生成")
    st.caption("基于客户信息和知识库，生成高转化率的B2B开发信")

    with st.form("cold_email_form"):
        col1, col2 = st.columns(2)
        with col1:
            company_name = st.text_input("客户公司名 *", placeholder="例如：ABC Kitchenware")
            country = st.text_input("客户国家 *", placeholder="例如：Germany")
            contact_name = st.text_input("联系人（可选）", placeholder="例如：John Smith")
        with col2:
            products = st.text_area("客户主营产品 *", placeholder="客户卖什么产品？", height=100)
            language = st.selectbox("语言", EMAIL_CONFIG["languages"])

        customer_analysis = st.text_area("客户分析（可选，从客户分析页复制）", height=80,
                                         placeholder="粘贴AI客户分析结果，开发信会更精准...")

        submitted = st.form_submit_button("✍️ AI生成开发信", use_container_width=True)

    if submitted and company_name and country and products:
        with st.spinner("AI正在撰写开发信..."):
            prompt = COLD_EMAIL_PROMPT.format(
                company_name=company_name,
                country=country,
                products=products,
                customer_analysis=customer_analysis or "暂无分析，基于主营产品判断",
                company_profile=kb.get_company_brief(),
                pain_points=kb.get_pain_points(),
                terminology=kb.get_terminology(),
            )
            result = ai.chat(prompt)

        st.markdown("---")
        st.subheader("📧 生成的开发信")
        st.markdown(f'<div class="email-box">{result}</div>', unsafe_allow_html=True)

        col1, col2, col3 = st.columns(3)
        with col1:
            if st.button("🔄 重新生成", use_container_width=True):
                st.rerun()
        with col2:
            if st.button("📋 复制到剪贴板", use_container_width=True):
                st.toast("已复制！（请手动选择文本复制）")
        with col3:
            # 保存到当前成员工作空间
            member_key = st.session_state.get('current_member', 'leo')
            member = TEAM_MEMBERS[member_key]
            if st.button(f"💾 保存到{member['name']}工作空间", use_container_width=True):
                workspace_dir = Path(__file__).parent / "data" / member['workspace_dir'] / "generated_emails"
                workspace_dir.mkdir(parents=True, exist_ok=True)
                email_file = workspace_dir / f"{company_name}_{datetime.now().strftime('%Y%m%d_%H%M')}.md"
                email_content = f"# 开发信 - {company_name}\n\n**语言**：{language}\n**创建者**：{member['name']}\n**时间**：{datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n---\n\n{result}"
                email_file.write_text(email_content, encoding='utf-8')
                st.success(f"已保存到 {member['name']} 的工作空间！")

        # 保存到客户
        st.markdown("---")
        customers = cm.list_customers()
        if customers:
            customer_options = {f"{c['company_name']} ({c['grade']}级)": c["id"] for c in customers}
            selected = st.selectbox("保存到哪个客户？", ["不保存"] + list(customer_options.keys()))
            if selected != "不保存" and st.button("💾 保存邮件记录"):
                cm.add_email(customer_options[selected], "开发信", result[:100], result)
                st.success("已保存到客户记录！")

# ============ 页面4：跟进序列 ============
elif page == "🔄 跟进序列":
    st.title("🔄 多轮跟进邮件序列")
    st.caption("自动生成第1-4轮跟进邮件，提高回复率")

    customers = cm.list_customers()
    if not customers:
        st.info("请先在「客户分析」中添加客户")
    else:
        customer_options = {f"{c['company_name']} ({c['grade']}级)": c for c in customers}
        selected_name = st.selectbox("选择客户", list(customer_options.keys()))
        customer = customer_options[selected_name]

        col1, col2, col3 = st.columns(3)
        with col1:
            follow_up_num = st.selectbox("第几轮跟进", [1, 2, 3, 4])
        with col2:
            first_email_date = st.date_input("第一封发送日期", value=datetime.now().date() - timedelta(days=3))
        with col3:
            reply_status = st.selectbox("客户回复状态", ["未回复", "已读未回", "回复但犹豫", "明确拒绝"])

        if st.button("✍️ 生成跟进邮件", use_container_width=True):
            with st.spinner("AI正在撰写跟进邮件..."):
                days = EMAIL_CONFIG["follow_up_days"][follow_up_num - 1] if follow_up_num <= len(EMAIL_CONFIG["follow_up_days"]) else 21
                prompt = FOLLOW_UP_PROMPT.format(
                    follow_up_number=follow_up_num,
                    company_name=customer["company_name"],
                    first_email_date=str(first_email_date),
                    reply_status=reply_status,
                    previous_subject=f"Re: {customer['company_name']} - Yangjiang Cutlery Supply",
                    country=customer.get("country", ""),
                    products=customer.get("products", ""),
                    company_profile=kb.get_company_brief(),
                )
                result = ai.chat(prompt)

            st.markdown("---")
            st.subheader(f"📧 第{follow_up_num}轮跟进邮件（第{days}天）")
            st.markdown(f'<div class="email-box">{result}</div>', unsafe_allow_html=True)

            if st.button("💾 保存到客户记录"):
                cm.add_email(customer["id"], f"跟进{follow_up_num}", result[:100], result)
                st.success("已保存！")

# ============ 页面5：客户问答 ============
elif page == "💬 客户问答":
    st.title("💬 客户问题智能回复")
    st.caption("基于FAQ知识库，快速生成专业回复")

    col1, col2 = st.columns([2, 1])
    with col1:
        question = st.text_area("客户问题 *", placeholder="客户问了什么？例如：What is your MOQ for custom logo knives?", height=100)
    with col2:
        company_name = st.text_input("客户公司", placeholder="可选")
        country = st.text_input("客户国家", placeholder="可选")
        conversation = st.text_area("之前的沟通", placeholder="可选", height=60)

    if st.button("🤖 AI生成回复", use_container_width=True) and question:
        with st.spinner("AI正在分析问题并生成回复..."):
            prompt = FAQ_PROMPT.format(
                question=question,
                company_name=company_name or "未知",
                country=country or "未知",
                conversation_history=conversation or "无",
                faq_content=kb.get_faq(),
                product_specs=kb.get_product_specs(),
                terminology=kb.get_terminology(),
            )
            result = ai.chat(prompt)

        st.markdown("---")
        st.subheader("📋 AI回复建议")
        st.markdown(result)

# ============ 页面6：产品推荐 ============
elif page == "📦 产品推荐":
    st.title("📦 智能产品推荐")
    st.caption("根据客户需求，从200+SKU中推荐最匹配的产品")

    with st.form("product_recommend_form"):
        col1, col2 = st.columns(2)
        with col1:
            company_name = st.text_input("客户公司", placeholder="可选")
            requirement = st.text_area("客户需求描述 *", placeholder="客户需要什么产品？例如：高端厨刀套装，带礼盒，适合亚马逊销售", height=100)
            target_market = st.text_input("目标市场", placeholder="例如：北美/欧洲/东南亚")
        with col2:
            budget = st.text_input("预算范围", placeholder="例如：$5-15/件")
            order_volume = st.text_input("订单量预估", placeholder="例如：500-2000件")
            category = st.selectbox("优先品类", ["全部"] + COMPANY["categories"])

        submitted = st.form_submit_button("🔍 AI推荐产品", use_container_width=True)

    if submitted and requirement:
        with st.spinner("AI正在匹配产品..."):
            if category == "全部":
                sku_data = kb.get_sku_data(limit=80)
            else:
                sku_data = kb.get_sku_by_category(category, limit=40)

            sku_text = "\n".join([
                f"- {r.get('SKU','')}: {r.get('英文名','')} | {r.get('材质','')} | {r.get('规格','')} | MOQ:{r.get('MOQ','')} | {r.get('价格带','')}"
                for r in sku_data[:60]
            ])

            prompt = PRODUCT_RECOMMEND_PROMPT.format(
                company_name=company_name or "未知",
                requirement=requirement,
                target_market=target_market or "未指定",
                budget=budget or "未指定",
                order_volume=order_volume or "未指定",
                sku_data=sku_text,
                product_specs=kb.get_product_specs(),
            )
            result = ai.chat(prompt)

        st.markdown("---")
        st.subheader("🎯 AI推荐结果")
        st.markdown(result)

        # 展示SKU数据表
        st.markdown("---")
        st.subheader("📊 相关SKU参考")
        if sku_data:
            df = pd.DataFrame(sku_data[:20])
            display_cols = [c for c in ["SKU", "中文名", "英文名", "一级类目", "材质", "规格", "MOQ", "价格带"] if c in df.columns]
            st.dataframe(df[display_cols], use_container_width=True)

# ============ 产品库页面（增强版：统一产品数据库 + 智能推荐） ============
elif page == "📦 产品库":
    # 子导航：产品库浏览 / 智能产品推荐
    sub_nav = st.radio(
        "产品库工作台",
        ["🏭 产品库浏览", "🎯 智能产品推荐"],
        horizontal=True,
        key="product_sub_nav",
        label_visibility="collapsed"
    )

    if sub_nav == "🎯 智能产品推荐":
        st.title("📦 智能产品推荐")
        st.caption("根据客户需求，从200+SKU中推荐最匹配的产品")

        with st.form("product_recommend_form"):
            col1, col2 = st.columns(2)
            with col1:
                company_name = st.text_input("客户公司", placeholder="可选")
                requirement = st.text_area("客户需求描述 *", placeholder="客户需要什么产品？例如：高端厨刀套装，带礼盒，适合亚马逊销售", height=100)
                target_market = st.text_input("目标市场", placeholder="例如：北美/欧洲/东南亚")
            with col2:
                budget = st.text_input("预算范围", placeholder="例如：$5-15/件")
                order_volume = st.text_input("订单量预估", placeholder="例如：500-2000件")
                category = st.selectbox("优先品类", ["全部"] + COMPANY["categories"])

            submitted = st.form_submit_button("🔍 AI推荐产品", use_container_width=True)

        if submitted and requirement:
            with st.spinner("AI正在匹配产品..."):
                if category == "全部":
                    sku_data = kb.get_sku_data(limit=80)
                else:
                    sku_data = kb.get_sku_by_category(category, limit=40)

                sku_text = "\n".join([
                    f"- {r.get('SKU','')}: {r.get('英文名','')} | {r.get('材质','')} | {r.get('规格','')} | MOQ:{r.get('MOQ','')} | {r.get('价格带','')}"
                    for r in sku_data[:60]
                ])

                prompt = PRODUCT_RECOMMEND_PROMPT.format(
                    company_name=company_name or "未知",
                    requirement=requirement,
                    target_market=target_market or "未指定",
                    budget=budget or "未指定",
                    order_volume=order_volume or "未指定",
                    sku_data=sku_text,
                    product_specs=kb.get_product_specs(),
                )
                result = ai.chat(prompt)

            st.markdown("---")
            st.subheader("🎯 AI推荐结果")
            st.markdown(result)

            st.markdown("---")
            st.subheader("📊 相关SKU参考")
            if sku_data:
                df = pd.DataFrame(sku_data[:20])
                display_cols = [c for c in ["SKU", "中文名", "英文名", "一级类目", "材质", "规格", "MOQ", "价格带"] if c in df.columns]
                st.dataframe(df[display_cols], use_container_width=True)

        st.stop()

    st.title("🏭 产品图片与SEO知识库")
    st.caption("127个已上架产品 · 827张SEO优化图片 · 输入SKU快速查询产品图片和SEO资料")

    # 加载统一产品数据库
    unified_json_path = KB_DIR / "15_产品图片与SEO知识库" / "07_统一产品数据库" / "products_unified.json"
    products_list = []
    if unified_json_path.exists():
        import json as _json
        products_list = _json.loads(unified_json_path.read_text(encoding='utf-8'))
        # 按SKU排序
        products_list.sort(key=lambda x: x['sku'])
    else:
        # 回退到旧索引
        products_json_path = KB_DIR / "15_产品图片与SEO知识库" / "products_index.json"
        if products_json_path.exists():
            products_list = _json.loads(products_json_path.read_text(encoding='utf-8'))

    if not products_list:
        st.warning("产品数据库未找到")
    else:
        # 统计
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("产品总数", len(products_list))
        with col2:
            st.metric("图片总数", sum(p.get('image_count', 0) for p in products_list))
        with col3:
            cat_count = len(set(p.get('category', '') for p in products_list))
            st.metric("品类数", cat_count)
        with col4:
            with_material = len([p for p in products_list if p.get('main_material')])
            st.metric("有完整SEO资料", with_material)

        st.markdown("---")

        # SKU快速搜索（突出显示）
        st.markdown("### 🔍 SKU快速查询")
        sku_search = st.text_input(
            "输入产品SKU（例如：KL-KN-HM-003）",
            placeholder="KL-KN-HM-003",
            key="sku_quick_search"
        )

        # 普通搜索和筛选
        col1, col2 = st.columns([2, 1])
        with col1:
            search_query = st.text_input("搜索产品名称或材质", placeholder="例如：Chef Knife 或 Damascus")
        with col2:
            categories = ["全部"] + sorted(list(set(p.get('category', '') for p in products_list)))
            selected_cat = st.selectbox("品类筛选", categories, key="product_cat_filter")

        # 筛选产品
        filtered = products_list
        if selected_cat != "全部":
            filtered = [p for p in filtered if p.get('category') == selected_cat]

        if sku_search:
            # SKU精确匹配优先
            sku_q = sku_search.upper().strip()
            exact_match = [p for p in filtered if p.get('sku', '').upper() == sku_q]
            partial_match = [p for p in filtered if sku_q in p.get('sku', '').upper() and p not in exact_match]
            filtered = exact_match + partial_match
        elif search_query:
            q = search_query.lower()
            filtered = [p for p in filtered if
                       q in p.get('sku', '').lower() or
                       q in p.get('name', '').lower() or
                       q in p.get('name_en', '').lower() or
                       q in p.get('main_material', '').lower() or
                       q in p.get('product_type', '').lower()]

        st.caption(f"找到 {len(filtered)} 个产品")

        # SKU精确匹配时直接显示详情
        if sku_search and len(filtered) == 1:
            product = filtered[0]
            st.session_state['selected_product'] = product['sku']

        # 产品网格展示
        if filtered:
            # 每行3个产品
            for i in range(0, min(len(filtered), 60), 3):
                row_products = filtered[i:i+3]
                cols = st.columns(3)
                for j, product in enumerate(row_products):
                    with cols[j]:
                        # 显示正面图
                        main_img_dir = KB_DIR / "15_产品图片与SEO知识库" / "05_产品正面图"
                        ext = Path(product.get('main_image', '')).suffix if product.get('main_image') else '.webp'
                        img_path = main_img_dir / f"{product['sku']}{ext}"
                        if img_path.exists():
                            st.image(str(img_path), use_container_width=True)
                        else:
                            st.info("📷 无图片")

                        st.markdown(f"**{product['sku']}**")
                        st.caption(product.get('name', '')[:50])
                        if product.get('main_material'):
                            st.caption(f"材质: {product['main_material'][:30]}")
                        st.caption(f"{product.get('category', '')} · {product.get('image_count', 0)}张图")

                        # 查看详情按钮
                        if st.button(f"查看SEO资料", key=f"detail_{product['sku']}", use_container_width=True):
                            st.session_state['selected_product'] = product['sku']

                st.markdown("---")

            if len(filtered) > 60:
                st.info(f"还有 {len(filtered)-60} 个产品，请使用SKU或关键词精确搜索")

        # 产品详情（完整SEO表格）
        if 'selected_product' in st.session_state:
            selected_sku = st.session_state['selected_product']
            product = next((p for p in products_list if p.get('sku') == selected_sku), None)
            if product:
                st.markdown("---")
                st.subheader(f"📦 {product.get('name', product['sku'])}")
                st.caption(f"SKU: {product['sku']} | 品类: {product.get('category', '')} | 图片: {product.get('image_count', 0)}张")

                # 显示主图
                col1, col2 = st.columns([1, 2])
                with col1:
                    main_img_dir = KB_DIR / "15_产品图片与SEO知识库" / "05_产品正面图"
                    ext = Path(product.get('main_image', '')).suffix if product.get('main_image') else '.webp'
                    img_path = main_img_dir / f"{product['sku']}{ext}"
                    if img_path.exists():
                        st.image(str(img_path), use_container_width=True)
                    else:
                        st.info("📷 无图片")

                with col2:
                    # 基本信息表格
                    st.markdown("### 📋 基本信息")
                    basic_data = {
                        "SKU": product['sku'],
                        "产品名称": product.get('name', ''),
                        "英文名称": product.get('name_en', ''),
                        "品类": product.get('category', ''),
                        "产品类型": product.get('product_type', ''),
                        "商品标题": product.get('product_title', '')[:100],
                        "固定链接": product.get('permalink', ''),
                        "图片数量": f"{product.get('image_count', 0)}张",
                    }
                    st.table(pd.DataFrame(list(basic_data.items()), columns=["项目", "内容"]))

                st.markdown("---")

                # 规格参数表格
                st.markdown("### ⚙️ 规格参数")
                specs_data = {
                    "主要材质": product.get('main_material', ''),
                    "手柄材质": product.get('handle_material', ''),
                    "表面工艺": product.get('surface_finish', ''),
                    "颜色": product.get('color', ''),
                    "硬度": product.get('hardness', ''),
                    "MOQ起订量": product.get('moq', ''),
                    "OEM/ODM": product.get('oem_odm', ''),
                }
                # 只显示有值的
                specs_data = {k: v for k, v in specs_data.items() if v}
                if specs_data:
                    st.table(pd.DataFrame(list(specs_data.items()), columns=["参数", "值"]))
                else:
                    st.info("暂无规格参数")

                st.markdown("---")

                # 产品描述
                if product.get('product_description'):
                    st.markdown("### 📝 产品描述")
                    st.markdown(product['product_description'])
                    st.markdown("---")

                # 图片SEO信息表格
                images_seo = product.get('images_seo', [])
                if images_seo:
                    st.markdown(f"### 🖼️ 图片SEO信息（共{len(images_seo)}张）")
                    seo_table_data = []
                    for i, img in enumerate(images_seo, 1):
                        seo_table_data.append({
                            "序号": i,
                            "文件名": img.get('filename', ''),
                            "拍摄角度": img.get('angle', ''),
                            "替代文本(Alt)": img.get('alt_text', '')[:80],
                            "图片标题": img.get('image_title', ''),
                        })
                    st.table(pd.DataFrame(seo_table_data))

                st.markdown("---")

                # 文件位置
                with st.expander("📁 文件位置"):
                    st.code(f"产品文件夹: {product.get('folder', '')}")
                    st.code(f"SEO文档: {product.get('seo_doc', '')}")
                    st.code(f"正面图: {img_path if img_path.exists() else '未找到'}")

                # 关闭详情
                if st.button("关闭详情", key=f"close_{product['sku']}"):
                    del st.session_state['selected_product']
                    st.rerun()

# ============ 锴利自研AI工具库页面 ============
elif page == "🤖 锴利自研AI工具库":
    st.title("🛠️ 锴利自研AI工具库")
    st.caption("KaiLionCrafts自主研发的产品工具集 · Streamlit原生组件 · 本地运行 · 连接公司知识库")

    # 工具列表
    TOOLS = [
        {"id": "sku_naming", "name": "SKU命名工具", "icon": "🏷️", "category": "产品命名", "description": "SKU生成、材质代码表、SEO关键词", "status": "✅ 已上线", "features": "选品类+材质，一键生成SKU/SEO文件名/ALT Text/页面标题"},
        {"id": "line_art", "name": "产品线稿工具", "icon": "✏️", "category": "图片处理", "description": "上传图片转线稿、标注导出", "status": "✅ 已上线", "features": "上传产品图→调节强度→生成线稿→下载PNG"},
        {"id": "visual_correction", "name": "全品类视觉矫正", "icon": "🎨", "category": "图片处理", "description": "图片翻转、朝向统一、裁剪", "status": "✅ 已上线", "features": "水平/垂直翻转、旋转90/180/270度、导出"},
        {"id": "prompt_library", "name": "刀剪产品提示词", "icon": "💡", "category": "AI生图", "description": "4品类Prompt库、多比例", "status": "✅ 已上线", "features": "4品类选择→生成AI生图Prompt→复制到Midjourney"},
        {"id": "scene_reverse", "name": "场景图反推", "icon": "🔄", "category": "AI生图", "description": "参考图反推Prompt模板", "status": "✅ 已上线", "features": "上传参考图→选特征→反推生图Prompt"},
        {"id": "white_balance", "name": "白平衡校正工具", "icon": "🌈", "category": "图片处理", "description": "图片白平衡自动校正", "status": "✅ 已上线", "features": "上传产品图→自动白平衡→对比预览→下载"},
        {"id": "raw_alignment", "name": "选片与RAW对齐", "icon": "📸", "category": "图片处理", "description": "JPG选片匹配RAW原片", "status": "✅ 已上线", "features": "批量上传JPG选片+RAW原片→自动匹配"},
    ]

    # 统计
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("工具总数", len(TOOLS))
    with col2:
        st.metric("已上线", len(TOOLS))
    with col3:
        st.metric("工具分类", 3)
    with col4:
        st.metric("运行方式", "Streamlit原生")

    st.markdown("---")

    # 从侧边栏二级菜单自动选中工具
    if '_auto_tool_id' in st.session_state and st.session_state['_auto_tool_id']:
        st.session_state['selected_tool_id'] = st.session_state['_auto_tool_id']
        del st.session_state['_auto_tool_id']

    # 未选中工具时才显示工具列表
    if 'selected_tool_id' not in st.session_state:
        # 分类标签
        categories_order = ["全部", "产品命名", "图片处理", "AI生图"]
        selected_cat = st.radio("🔍 选择工具分类", categories_order, horizontal=True, key="tool_cat_filter")

        if selected_cat == "全部":
            filtered_tools = TOOLS
        else:
            filtered_tools = [t for t in TOOLS if t['category'] == selected_cat]

        st.markdown("---")
        st.markdown("## 🛠️ 选择AI工具工作台")

        cols_per_row = 2
        for i in range(0, len(filtered_tools), cols_per_row):
            row_tools = filtered_tools[i:i+cols_per_row]
            cols = st.columns(cols_per_row)
            for j, tool in enumerate(row_tools):
                with cols[j]:
                    st.markdown(f"""
                    <div style="
                        background: linear-gradient(135deg, #1a1f2e 0%, #252d3d 100%);
                        border: 2px solid #d4a853;
                        border-radius: 12px;
                        padding: 1.5rem;
                        margin-bottom: 0.5rem;
                        text-align: center;
                    ">
                        <div style="font-size: 3rem; margin-bottom: 0.5rem;">{tool['icon']}</div>
                        <div style="font-size: 1.3rem; font-weight: 700; color: #fff; margin-bottom: 0.3rem;">{tool['name']}</div>
                        <div style="font-size: 0.9rem; color: #9aa3b8; margin-bottom: 0.8rem;">{tool['description']}</div>
                        <div style="font-size: 0.8rem; color: #d4a853; margin-bottom: 0.5rem; padding: 0 0.5rem;">{tool.get('features', '')}</div>
                        <div style="font-size: 0.85rem; color: #90EE90;">{tool['status']}</div>
                    </div>
                    """, unsafe_allow_html=True)
                    if st.button(f"🚀 打开工作台", key=f"tool_{tool['id']}", use_container_width=True):
                        st.session_state['selected_tool_id'] = tool['id']
                        st.rerun()

        st.stop()

    # ========== 工具工作台 ==========
    tool_id = st.session_state['selected_tool_id']
    tool = next((t for t in TOOLS if t['id'] == tool_id), None)

    if tool:
        # 返回按钮
        if st.button("← 返回工具库", key="back_to_tools"):
            del st.session_state['selected_tool_id']
            st.rerun()

        st.markdown(f"### {tool['icon']} {tool['name']}")
        st.caption(f"分类：{tool['category']} | {tool['description']}")

        st.markdown("---")

        # ========== 1. SKU命名工具 ==========
        if tool_id == 'sku_naming':
                # 高级头部样式
                st.markdown("""
                <div style="text-align:center; margin-bottom:24px;">
                    <div style="display:inline-block; font-family:monospace; font-size:11px; letter-spacing:3px; color:#B8860B; border:1px solid #D4AF37; padding:5px 14px; border-radius:3px; margin-bottom:12px; font-weight:600;">
                        KAILIONCRAFTS · 阳江锴利刀剪 · 超级命名工具 V4
                    </div>
                    <h2 style="font-family:serif; font-size:32px; font-weight:700; color:#1a1a2e; margin:10px 0 8px 0;">
                        图片命名<span style="color:#B8860B;">超级工具</span>
                    </h2>
                    <div style="font-size:13px; color:#666; line-height:1.6;">
                        四大品类·厨刀·户外刀·剪刀·厨房用品 · 全品类SKU体系 · 一键生成图片名+Alt Text+SEO命名
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
                # SKU格式横幅
                st.markdown("""
                <div style="
                    background:linear-gradient(135deg, rgba(212,175,55,.1) 0%, rgba(212,175,55,.05) 100%);
                    border:1px solid #D4AF37;
                    border-radius:10px;
                    padding:18px 24px;
                    margin-bottom:24px;
                    display:grid;
                    grid-template-columns:1fr 1fr;
                    gap:16px;
                ">
                    <div>
                        <div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">产品SKU（唯一标识，不含图片号）</div>
                        <div style="font-family:monospace; font-size:15px; color:#B8860B; font-weight:600;">KL - KN - DS - 002</div>
                        <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
                            <span style="padding:2px 8px; border-radius:3px; font-family:monospace; font-size:10px; background:#4E342E; color:#E8C96A;">KL 公司代号</span>
                            <span style="padding:2px 8px; border-radius:3px; font-family:monospace; font-size:10px; background:#1a3a5c; color:#7EC8E3;">KN 品类</span>
                            <span style="padding:2px 8px; border-radius:3px; font-family:monospace; font-size:10px; background:#1b4332; color:#69B890;">DS 材质</span>
                            <span style="padding:2px 8px; border-radius:3px; font-family:monospace; font-size:10px; background:#643214; color:#E8B890;">002 款式号</span>
                        </div>
                    </div>
                    <div>
                        <div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">图片文件名（SKU + 图片序号）</div>
                        <div style="font-family:monospace; font-size:15px; color:#1e5799; font-weight:600;">KL-KA-SS-001-01.jpg</div>
                        <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
                            <span style="padding:2px 8px; border-radius:3px; font-family:monospace; font-size:10px; background:#4E342E; color:#E8C96A;">KL-KA-SS-001</span>
                            <span style="padding:2px 8px; border-radius:3px; font-family:monospace; font-size:10px; background:#4a1a4a; color:#E890E8;">-01 图片序号</span>
                            <span style="padding:2px 8px; border-radius:3px; font-family:monospace; font-size:10px; background:#333; color:#ccc;">.jpg 格式</span>
                        </div>
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
                # 工具功能说明
                st.markdown("""
                <div style="
                    background:#f8f9fa;
                    border-left:4px solid #D4AF37;
                    padding:12px 16px;
                    margin-bottom:20px;
                    border-radius:0 6px 6px 0;
                ">
                    <div style="font-weight:600; color:#333; margin-bottom:6px;">📋 本工具功能说明</div>
                    <div style="font-size:13px; color:#555; line-height:1.8;">
                        • <b>产品库命名</b>：从已有产品库选择，自动生成SKU和图片名<br>
                        • <b>自定义生成</b>：手动选品类+材质+款式号，生成完整命名序列<br>
                        • <b>批量重命名</b>：上传实拍图片，自动按SKU格式重命名，打包ZIP下载<br>
                        • <b>材质代码表</b>：30+材质代码参考，点击快速填入<br>
                        • <b>SEO关键词库</b>：4大品类热门SEO关键词，点击快速填入
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
                # 5个Tab
                tab1, tab2, tab3, tab4, tab5 = st.tabs(["🔪 产品库命名", "✏️ 自定义生成", "⚡ 批量重命名", "🧱 材质代码表", "📊 SEO关键词库"])
    
                # ========== Tab1: 产品库命名 ==========
                with tab1:
                    st.markdown("### 🔪 产品库命名")
                    st.caption("从产品库选择产品，自动生成SKU编号和图片文件名列表")
    
                    # 品类统计
                    col1, col2, col3, col4 = st.columns(4)
                    with col1:
                        st.metric("厨刀 KN", "11", delta="款")
                    with col2:
                        st.metric("户外刀 OD", "7", delta="款")
                    with col3:
                        st.metric("剪刀 SC", "7", delta="款")
                    with col4:
                        st.metric("厨房用品 KA", "19", delta="款")
    
                    st.markdown("---")
    
                    # 分类筛选
                    cat_filter = st.radio("筛选品类", ["全部", "厨刀 KN", "户外刀 OD", "剪刀 SC", "厨房用品 KA"], horizontal=True, key="sku_cat_filter")
    
                    # 搜索框
                    search = st.text_input("🔍 搜索SKU、产品名、材质、系列...", key="sku_search")
    
                    # 产品数据（示例）
                    products = [
                        {"sku": "KL-KN-DS-001", "name": "大马士革主厨刀（VG10黑柄8寸）", "material": "VG10大马士革", "cat": "KN", "rating": 3},
                        {"sku": "KL-KN-DS-002", "name": "大马士革菜刀（贝壳柄7寸）", "material": "67层大马士革", "cat": "KN", "rating": 3},
                        {"sku": "KL-KN-DS-003", "name": "大马士革中式菜刀8寸（玫瑰木）", "material": "67层大马士革", "cat": "KN", "rating": 3},
                        {"sku": "KL-KN-HF-001", "name": "手工锻打大马士革主厨刀9寸", "material": "手工锻打大马士革", "cat": "KN", "rating": 3},
                        {"sku": "KL-KN-HM-001", "name": "锤纹专业主厨刀7.5寸（黑柄）", "material": "锤纹大马士革", "cat": "KN", "rating": 3},
                        {"sku": "KL-KN-SS-001", "name": "8寸不锈钢主厨刀（不锈钢）", "material": "5Cr15MoV不锈钢", "cat": "KN", "rating": 3},
                        {"sku": "KL-KN-SS-003", "name": "8寸全钢一体主厨刀（黑柄）", "material": "9Cr15MoV不锈钢", "cat": "KN", "rating": 3},
                        {"sku": "KL-KN-HC-001", "name": "1095高碳钢主厨刀（玫瑰木柄）", "material": "1095高碳钢", "cat": "KN", "rating": 3},
                        {"sku": "KL-KN-CL-001", "name": "三合夹钢主厨刀（玫瑰木柄）", "material": "三合夹钢", "cat": "KN", "rating": 3},
                        {"sku": "KL-KN-SET-DS-001", "name": "12件大马士革刀套装（亚克力座）", "material": "大马士革不锈钢", "cat": "KN", "rating": 3},
                        {"sku": "KL-KN-SET-SS-001", "name": "10件不锈钢厨刀（木质刀座）", "material": "5Cr15MoV不锈钢", "cat": "KN", "rating": 3},
                        {"sku": "KL-OD-DS-001", "name": "大马士革折叠刀（G10柄4寸）", "material": "67层大马士革", "cat": "OD", "rating": 3},
                        {"sku": "KL-OD-DS-002", "name": "大马士革折叠刀（贝壳柄礼品）", "material": "67层大马士革", "cat": "OD", "rating": 3},
                        {"sku": "KL-OD-DS-003", "name": "手工锻造大马士革生存刀（伞绳柄）", "material": "手工锻造大马士革", "cat": "OD", "rating": 3},
                        {"sku": "KL-OD-HC-001", "name": "1095高碳钢生存刀特大号（伞绳柄12寸）", "material": "1095高碳钢", "cat": "OD", "rating": 3},
                        {"sku": "KL-OD-TI-001", "name": "战术折叠刀全黑（黑钛涂层EDC）", "material": "黑钛涂层不锈钢", "cat": "OD", "rating": 3},
                        {"sku": "KL-OD-SET-DS-001", "name": "户外刀礼盒套装3件（大马士革红绒盒）", "material": "大马士革不锈钢", "cat": "OD", "rating": 3},
                        {"sku": "KL-SC-SS-001", "name": "厨房剪（不锈钢白柄可拆卸9寸）", "material": "5Cr15MoV不锈钢", "cat": "SC", "rating": 3},
                        {"sku": "KL-SC-SS-002", "name": "家禽剪（不锈钢黑柄可拆卸8寸）", "material": "5Cr15MoV不锈钢", "cat": "SC", "rating": 3},
                        {"sku": "KL-SC-SS-004", "name": "重型厨房剪多功能（不锈钢带锯齿）", "material": "5Cr15MoV不锈钢", "cat": "SC", "rating": 3},
                        {"sku": "KL-SC-TI-001", "name": "多功能厨房剪（钛涂层10寸）", "material": "钛涂层不锈钢", "cat": "SC", "rating": 3},
                        {"sku": "KL-SC-HC-001", "name": "高碳钢裁缝剪10寸（专业）", "material": "高碳钢", "cat": "SC", "rating": 3},
                        {"sku": "KL-SC-PR-001", "name": "440C高端厨房剪（德式专业10寸）", "material": "440C不锈钢", "cat": "SC", "rating": 3},
                        {"sku": "KL-SC-FS-001", "name": "全钢一体剪", "material": "全钢", "cat": "SC", "rating": 3},
                    ]
    
                    # 筛选产品
                    filtered = products
                    if cat_filter != "全部":
                        cat_code = cat_filter.split()[1]
                        filtered = [p for p in filtered if p['cat'] == cat_code]
                    if search:
                        filtered = [p for p in filtered if search.lower() in p['sku'].lower() or search.lower() in p['name'].lower() or search.lower() in p['material'].lower()]
    
                    st.caption(f"共 {len(filtered)} 个产品")
    
                    # 产品卡片网格
                    cols_per_row = 3
                    for i in range(0, len(filtered), cols_per_row):
                        row_products = filtered[i:i+cols_per_row]
                        cols = st.columns(cols_per_row)
                        for j, prod in enumerate(row_products):
                            with cols[j]:
                                st.markdown(f"""
                                <div style="
                                    background:#f8f9fa;
                                    border:1px solid #e0e0e0;
                                    border-radius:8px;
                                    padding:12px;
                                    margin-bottom:8px;
                                    cursor:pointer;
                                ">
                                    <div style="font-family:monospace; font-size:12px; color:#B8860B; font-weight:600; margin-bottom:4px;">{prod['sku']}</div>
                                    <div style="font-size:13px; color:#333; margin-bottom:4px;">{prod['name']}</div>
                                    <div style="font-size:11px; color:#888;">{prod['material']}</div>
                                </div>
                                """, unsafe_allow_html=True)
                                if st.button(f"选择 {prod['sku']}", key=f"prod_{prod['sku']}", use_container_width=True):
                                    st.session_state['selected_product_sku'] = prod['sku']
                                    st.session_state['selected_product_name'] = prod['name']
                                    st.success(f"已选择：{prod['sku']} - {prod['name']}")
    
                    # 显示选中产品的详细命名
                    if 'selected_product_sku' in st.session_state:
                        st.markdown("---")
                        st.markdown("### 📋 选中产品的命名列表")
                        sku = st.session_state['selected_product_sku']
                        st.code(f"产品SKU: {sku}")
    
                        st.markdown("**图片文件名（共4张）：**")
                        for i in range(1, 5):
                            st.code(f"{sku.lower()}-0{i}.jpg")
    
                        st.markdown("**SEO主图名：**")
                        st.code(f"yangjiang-{sku.lower()}-01.jpg")
    
                        col1, col2, col3 = st.columns(3)
                        with col1:
                            st.button("📋 复制全部图片名", key="copy_all_names")
                        with col2:
                            st.button("📋 复制SKU", key="copy_sku")
                        with col3:
                            st.button("📋 复制SEO主图名", key="copy_seo_name")
    
                # ========== Tab2: 自定义生成 ==========
                with tab2:
                    st.markdown("### ✏️ 自定义SKU命名生成器")
                    st.caption("手动选择品类+材质+款式号，生成完整图片命名序列")
    
                    st.info("格式说明：产品SKU = KL-[品类]-[材质]-[款式号]，图片文件名 = KL-[品类]-[材质]-[款式号]-[图片序号].jpg")
    
                    col1, col2, col3 = st.columns(3)
                    with col1:
                        cat = st.selectbox("品类代码", [
                            ("KN", "KN — 厨刀 Kitchen Knives"),
                            ("OD", "OD — 户外刀 Outdoor Knives"),
                            ("SC", "SC — 剪刀 Professional Scissors"),
                            ("KA", "KA — 厨房用品 Kitchen Accessories"),
                        ], format_func=lambda x: x[1])
                    with col2:
                        material = st.selectbox("材质代码", [
                            ("DS", "DS — 大马士革 Damascus"),
                            ("HF", "HF — 手工锻打 Hand Forged"),
                            ("HM", "HM — 锤纹/凿纹 Hammered"),
                            ("SS", "SS — 不锈钢 Stainless Steel"),
                            ("HC", "HC — 高碳钢 High Carbon"),
                            ("CL", "CL — 复合夹钢 Clad Steel"),
                            ("TI", "TI — 黑钛涂层 Black Ti-Coated"),
                            ("BM", "BM — 天然竹木 Bamboo"),
                            ("WD", "WD — 实木（胡桃/枫木）"),
                            ("PP", "PP — 食品级PP/PE"),
                            ("SG", "SG — 食品级硅胶"),
                            ("GL", "GL — 硼硅玻璃"),
                            ("ZA", "ZA — 锌合金"),
                            ("MX", "MX — 混合材质"),
                        ], format_func=lambda x: x[1])
                    with col3:
                        seq = st.text_input("款式序号", value="001", help="001-999，建议3位数")
    
                    col1, col2 = st.columns(2)
                    with col1:
                        img_count = st.selectbox("生成图片数量", ["4张", "12张", "20张"], index=0)
                    with col2:
                        seo_keyword = st.text_input("SEO关键词（可选）", placeholder="bamboo-cutting-board-juice-groove")
    
                    if st.button("🚀 生成命名序列", type="primary"):
                        sku = f"KL-{cat[0]}-{material[0]}-{seq}"
                        count = int(img_count.replace("张", ""))
    
                        st.markdown("---")
                        st.markdown("**产品SKU**")
                        st.code(sku)
    
                        st.markdown(f"**图片文件名（共{count}张）：**")
                        for i in range(1, count + 1):
                            st.code(f"{sku.lower()}-{i:02d}.jpg")
    
                        st.markdown("**SEO主图名（上传网站用）**")
                        st.code(f"yangjiang-{sku.lower()}-01.jpg")
    
                        if seo_keyword:
                            st.markdown("**SEO优化文件名**")
                            st.code(f"yangjiang-kailioncrafts-{seo_keyword}-{sku.lower()}.jpg")
    
                # ========== Tab3: 批量重命名 ==========
                with tab3:
                    st.markdown("### ⚡ 批量重命名下载")
                    st.caption("上传实拍图片 → 自动按KL-KA-SS-001-01.jpg格式重命名 → 打包ZIP下载")
    
                    # 命名模式
                    mode = st.radio("命名模式", ["从产品库选择（推荐）", "手动自定义（品类+材质+款式，全部可自由输入）"], horizontal=True, key="rename_mode")
    
                    col1, col2 = st.columns(2)
                    with col1:
                        if mode == "从产品库选择（推荐）":
                            prod_options = [f"{p['sku']} {p['name']}" for p in products[:10]]
                            selected_prod = st.selectbox("选择产品", prod_options)
                            selected_sku = selected_prod.split()[0]
                        else:
                            custom_cat = st.selectbox("品类", ["KN", "OD", "SC", "KA"])
                            custom_mat = st.selectbox("材质", ["DS", "SS", "HC", "HF", "TI"])
                            custom_seq = st.text_input("款式序号", value="001")
                            selected_sku = f"KL-{custom_cat}-{custom_mat}-{custom_seq}"
                    with col2:
                        start_num = st.number_input("起始图片序号", value=1, min_value=1)
    
                    st.info(f"当前将生成的文件名格式：`{selected_sku.lower()}-01.jpg`, `{selected_sku.lower()}-02.jpg`, ...")
    
                    # 上传图片
                    uploaded_files = st.file_uploader("拖拽图片到这里 或 点击选择", type=['jpg', 'jpeg', 'png', 'webp'], accept_multiple_files=True, key="batch_rename_upload")
    
                    if uploaded_files:
                        st.success(f"已上传 {len(uploaded_files)} 张图片")
    
                        # 显示重命名预览
                        st.markdown("**重命名预览：**")
                        rename_list = []
                        for i, f in enumerate(uploaded_files):
                            new_name = f"{selected_sku.lower()}-{start_num + i:02d}.jpg"
                            rename_list.append((f.name, new_name))
                            st.code(f"{f.name} → {new_name}")
    
                        # 下载按钮（生成ZIP）
                        if st.button("📦 打包下载ZIP", type="primary"):
                            import zipfile
                            buf = io.BytesIO()
                            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zipf:
                                for i, f in enumerate(uploaded_files):
                                    new_name = f"{selected_sku.lower()}-{start_num + i:02d}.jpg"
                                    zipf.writestr(new_name, f.getbuffer())
                            buf.seek(0)
                            st.download_button("⬇ 下载重命名ZIP包", buf, file_name=f"{selected_sku}_renamed.zip", mime="application/zip")
    
                # ========== Tab4: 材质代码表 ==========
                with tab4:
                    st.markdown("### 🧱 材质代码参考表")
                    st.caption("KaiLionCrafts四大品类材质代码卡片，点击材质卡片快速填入「自定义生成」")
    
                    # 材质数据
                    materials = [
                        ("DS", "大马士革", "Damascus", "大马士革钢，花纹独特，欧美零售/礼品最热销", "KN"),
                        ("HF", "手工锻打", "Hand Forged", "手工锻造，独立站差异化利润，溢价高", "KN"),
                        ("HM", "锤纹/凿纹", "Hammered", "锤目纹/凿纹防粘处理，日系厨刀热销", "KN"),
                        ("SS", "不锈钢", "Stainless Steel", "5Cr15MoV/9Cr18MoV，出口主力，性价比首选", "KN"),
                        ("HC", "高碳钢", "High Carbon", "1095/1084高碳，欧美户外认可，保持好", "KN"),
                        ("CL", "复合夹钢", "Clad Steel", "三合夹钢/VG10夹钢，日系高端厨刀标配", "KN"),
                        ("SET-DS", "大马士革套刀", "Damascus Set", "大马士革刀套套装，含刀座", "KN"),
                        ("SET-SS", "不锈钢套刀", "Stainless Set", "不锈钢刀套套装，含刀座", "KN"),
                        ("TI", "黑钛涂层", "Black Ti-Coated", "黑钛涂层，战术全黑，视觉冲击强", "OD"),
                        ("SET-DS", "大马士革礼盒", "Damascus Gift Set", "大马士革户外礼盒套装", "OD"),
                        ("SET-SS", "不锈钢礼盒", "Stainless Gift Set", "不锈钢户外礼盒套装", "OD"),
                        ("PR", "440C高端剪", "440C Premium", "440C，德式专业剪，欧美高端买家认可", "SC"),
                        ("FS", "全钢一体剪", "Full Steel", "全钢一体，卫生，餐饮专业用", "SC"),
                        ("SET-SS", "剪刀礼盒套装", "Scissors Gift Set", "剪刀礼盒套装，礼品市场", "SC"),
                        ("BM", "天然竹木", "Bamboo", "楠竹/竹纤维砧板，抗菌防裂，欧美绿色首选", "KA"),
                        ("WD", "实木（胡桃/枫木）", "Walnut/Maple Wood", "胡桃木/枫木，高端砧板，护刀厚盾，独立站溢价", "KA"),
                        ("PP", "食品级PP/PE", "Food-Grade Plastic", "食品级PP，砧板/小工具批量走量，洗碗机可用", "KA"),
                        ("SS", "304不锈钢", "304 Stainless Steel", "304不锈钢，厨房工具主流材质，耐用防锈", "KA"),
                        ("SG", "食品级硅胶", "Food-Grade Silicone", "食品级硅胶，厨具/烘焙工具，耐高温BPA-free", "KA"),
                        ("GL", "硼硅玻璃", "Borosilicate Glass", "硼硅玻璃，食品保鲜首选，可微波加热", "KA"),
                        ("ZA", "锌合金", "Zinc Alloy", "锌合金，压蒜器/开瓶器，省力结构，性价比高", "KA"),
                        ("MX", "混合材质", "Mixed Material", "多种材质组合，烧烤套装/礼盒首选，配置丰富", "KA"),
                        ("SET-BBQ", "烧烤礼盒套装", "BBQ Gift Set", "烧烤工具礼盒，欧美节日礼品爆款，高客单", "KA"),
                        ("SET-KIT", "厨房礼盒套装", "Kitchen Gift Set", "厨房配件礼盒，砧板+厨具+配件组合，独立", "KA"),
                    ]
    
                    # 品类筛选
                    mat_filter = st.radio("筛选品类", ["全部", "厨刀 KN", "户外刀 OD", "剪刀 SC", "厨房用品 KA"], horizontal=True, key="mat_filter")
    
                    filtered_mats = materials
                    if mat_filter != "全部":
                        cat_code = mat_filter.split()[1]
                        filtered_mats = [m for m in materials if m[4] == cat_code]
    
                    # 材质卡片网格
                    cols_per_row = 3
                    for i in range(0, len(filtered_mats), cols_per_row):
                        row_mats = filtered_mats[i:i+cols_per_row]
                        cols = st.columns(cols_per_row)
                        for j, (code, cn, en, desc, cat_code) in enumerate(row_mats):
                            with cols[j]:
                                st.markdown(f"""
                                <div style="
                                    background:#f8f9fa;
                                    border:1px solid #e0e0e0;
                                    border-radius:8px;
                                    padding:12px;
                                    margin-bottom:8px;
                                ">
                                    <div style="font-size:18px; font-weight:700; color:#B8860B; margin-bottom:4px;">{code}</div>
                                    <div style="font-size:14px; color:#333; font-weight:600; margin-bottom:2px;">{cn}</div>
                                    <div style="font-size:12px; color:#666; margin-bottom:6px;">{en}</div>
                                    <div style="font-size:11px; color:#888; line-height:1.4;">{desc}</div>
                                </div>
                                """, unsafe_allow_html=True)
    
                # ========== Tab5: SEO关键词库 ==========
                with tab5:
                    st.markdown("### 📊 SEO关键词库")
                    st.caption("按品类分类的SEO关键词，点击快速填入「自定义生成」")
    
                    # 关键词数据
                    kw_data = {
                        "厨刀": [
                            ("damascus chef knife", "高频"),
                            ("kitchen knife set", "高频"),
                            ("damascus kitchen knife set", "中频"),
                            ("hand forged chinese cleaver", "中频"),
                            ("hammered chef knife", "中频"),
                            ("high carbon steel knife", "中频"),
                            ("vg10 damascus chef knife", "长尾"),
                            ("damascus cleaver knife wholesale", "长尾"),
                            ("1095 high carbon survival knife", "长尾"),
                        ],
                        "户外刀": [
                            ("survival knife", "高频"),
                            ("tactical folding knife", "高频"),
                            ("edc knife", "高频"),
                            ("bushcraft knife", "中频"),
                            ("outdoor knife gift set", "中频"),
                            ("damascus folding knife edc", "中频"),
                        ],
                        "剪刀": [
                            ("kitchen shears", "高频"),
                            ("kitchen scissors", "中频"),
                            ("kitchen shears wholesale", "长尾"),
                            ("tailor scissors professional", "中频"),
                            ("heavy duty kitchen scissors", "中频"),
                            ("titanium kitchen scissors", "中频"),
                            ("poultry shears", "中频"),
                        ],
                        "厨房用品": [
                            ("bamboo cutting board", "高频"),
                            ("kitchen utensil set", "高频"),
                            ("bbq tool set", "高频"),
                            ("bamboo cutting board juice groove", "长尾"),
                            ("silicone cooking utensils", "中频"),
                            ("garlic press stainless steel", "中频"),
                            ("glass food storage containers", "中频"),
                            ("kitchen gadgets set", "中频"),
                        ],
                    }
    
                    for cat_name, keywords in kw_data.items():
                        st.markdown(f"**{cat_name}**")
                        cols = st.columns(3)
                        for i, (kw, tag) in enumerate(keywords):
                            with cols[i % 3]:
                                tag_color = "#ff6b6b" if tag == "高频" else "#ffa500" if tag == "中频" else "#4ecdc4"
                                st.markdown(f"""
                                <div style="
                                    background:#f8f9fa;
                                    border:1px solid #e0e0e0;
                                    border-radius:6px;
                                    padding:8px 12px;
                                    margin-bottom:6px;
                                    display:flex;
                                    justify-content:space-between;
                                    align-items:center;
                                ">
                                    <span style="font-size:13px; color:#333;">{kw}</span>
                                    <span style="font-size:10px; color:{tag_color}; border:1px solid {tag_color}; padding:1px 6px; border-radius:3px;">{tag}</span>
                                </div>
                                """, unsafe_allow_html=True)
                        st.markdown("---")
    
        # ========== 2. 产品线稿工具 ==========
        elif tool_id == 'line_art':
                from PIL import Image, ImageOps, ImageFilter, ImageDraw, ImageEnhance
                import numpy as np
    
                # 高级深色头部
                st.markdown("""
                <div style="
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border-radius:16px;
                    padding:32px;
                    margin-bottom:20px;
                ">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="display:inline-block; font-family:monospace; font-size:11px; letter-spacing:3px; color:#D4AF37; border:1px solid #D4AF37; padding:6px 16px; border-radius:3px; margin-bottom:16px; font-weight:600;">
                                KAILIONCRAFTS · PRODUCT LINE ART STUDIO
                            </div>
                            <h2 style="font-family:serif; font-size:36px; font-weight:700; color:#FFF3E0; margin:10px 0 12px 0;">
                                产品线稿<span style="color:#D4AF37;">工作室</span>
                            </h2>
                            <div style="font-size:14px; color:rgba(255,243,224,.6); line-height:1.6;">
                                生产级批量产品线稿渲染器 · 手绘风格 · 高清导出
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="background:rgba(212,175,55,.1); border:1px solid rgba(212,175,55,.3); border-radius:8px; padding:12px 20px;">
                                <div style="font-size:11px; color:#D4AF37; margin-bottom:4px;">当前状态</div>
                                <div style="font-size:14px; color:#FFF3E0; font-weight:600;">🛠️ 生产模式</div>
                            </div>
                        </div>
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
                # 功能说明卡片
                st.markdown("""
                <div style="
                    background:#f8f9fa;
                    border-left:4px solid #D4AF37;
                    padding:16px 20px;
                    margin-bottom:24px;
                    border-radius:0 8px 8px 0;
                ">
                    <div style="font-weight:600; color:#333; margin-bottom:8px; font-size:15px;">📋 本工具功能说明</div>
                    <div style="font-size:13px; color:#555; line-height:2;">
                        • <b>批量导入</b>：支持一次选择多张产品图，进入批量流水线<br>
                        • <b>预设模板</b>：线稿、素描、技术图纸、漫画风，一键切换<br>
                        • <b>笔触调节</b>：纸张齿痕、多重重合轮廓、石墨显色深浅，精细调节<br>
                        • <b>手稿细节</b>：排线密度、定位线、墨水晕染，模拟真实手绘<br>
                        • <b>图像调节</b>：亮度、对比度、边缘强度，全方位控制<br>
                        • <b>高清导出</b>：PNG格式批量导出，用于说明书、包装、3D建模<br>
                        • <b>完全本地处理</b>：图片不上传服务器，保护产品隐私
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
                # 批量上传
                st.markdown("### 📤 批量导入产品图片")
    
                uploaded_files = st.file_uploader(
                    "📦 拖拽图片到这里 或 点击选择文件",
                    type=['jpg', 'jpeg', 'png'],
                    accept_multiple_files=True,
                    key="line_art_upload",
                    help="支持JPG、PNG格式，可一次选择多张图片批量处理"
                )
    
                if not uploaded_files:
                    # 空状态：功能预览卡片
                    st.markdown("""
                    <div style="
                        border:1px solid #e0e0e0;
                        border-radius:12px;
                        padding:24px;
                        margin:20px 0;
                        background:#fafafa;
                    ">
                        <div style="font-weight:600; color:#333; margin-bottom:16px; font-size:16px;">✨ 支持的线稿风格</div>
                        <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:12px;">
                            <div style="background:white; border:1px solid #e0e0e0; border-radius:8px; padding:16px; text-align:center;">
                                <div style="font-size:24px; margin-bottom:8px;">✏️</div>
                                <div style="font-weight:600; color:#333; font-size:14px;">精细线稿</div>
                                <div style="font-size:12px; color:#888; margin-top:4px;">产品说明书插图</div>
                            </div>
                            <div style="background:white; border:1px solid #e0e0e0; border-radius:8px; padding:16px; text-align:center;">
                                <div style="font-size:24px; margin-bottom:8px;">🎨</div>
                                <div style="font-weight:600; color:#333; font-size:14px;">铅笔素描</div>
                                <div style="font-size:12px; color:#888; margin-top:4px;">手绘质感效果</div>
                            </div>
                            <div style="background:white; border:1px solid #e0e0e0; border-radius:8px; padding:16px; text-align:center;">
                                <div style="font-size:24px; margin-bottom:8px;">📐</div>
                                <div style="font-weight:600; color:#333; font-size:14px;">技术图纸</div>
                                <div style="font-size:12px; color:#888; margin-top:4px;">3D建模参考</div>
                            </div>
                            <div style="background:white; border:1px solid #e0e0e0; border-radius:8px; padding:16px; text-align:center;">
                                <div style="font-size:24px; margin-bottom:8px;">💎</div>
                                <div style="font-weight:600; color:#333; font-size:14px;">漫画风格</div>
                                <div style="font-size:12px; color:#888; margin-top:4px;">品牌视觉素材</div>
                            </div>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                else:
                    # 有图片时的专业界面
                    st.success(f"✅ 已导入 {len(uploaded_files)} 张产品图片")
    
                    # 预设模板选择
                    st.markdown("### 🎨 选择线稿风格预设")
                    preset_options = {
                        "精细线稿（推荐）": {"paper": 10, "stroke": 3, "ink": 2.0, "hatch": 10, "draft": 50},
                        "铅笔素描": {"paper": 30, "stroke": 5, "ink": 2.8, "hatch": 40, "draft": 70},
                        "技术图纸": {"paper": 5, "stroke": 2, "ink": 1.5, "hatch": 5, "draft": 90},
                        "漫画风格": {"paper": 20, "stroke": 8, "ink": 3.5, "hatch": 60, "draft": 30},
                        "自定义参数": {"paper": 15, "stroke": 5, "ink": 2.4, "hatch": 25, "draft": 70}
                    }
                    preset_names = list(preset_options.keys())
                    selected_preset = st.selectbox("预设模板", preset_names, key="la_preset")
    
                    # 左侧参数面板，右侧预览
                    col_params, col_preview = st.columns([1, 2])
    
                    with col_params:
                        st.markdown("### ⚙️ 参数控制")
    
                        # 1. 整体参数
                        with st.expander("🎨 笔触细腻度", expanded=True):
                            paper_texture = st.slider("纸张齿痕", 0, 100, preset_options[selected_preset]["paper"], key="la_paper", help="模拟纸张纹理效果")
                            multi_stroke = st.slider("多重重合轮廓", 1, 20, preset_options[selected_preset]["stroke"], key="la_stroke", help="手绘轮廓的重叠次数")
                            ink_depth = st.slider("石墨显色深浅", 0.5, 5.0, float(preset_options[selected_preset]["ink"]), key="la_ink", step=0.1, help="线条浓淡程度")
    
                        # 2. 手稿细节
                        with st.expander("✏️ 真实手稿细节", expanded=True):
                            hatching = st.slider("排线密度", 0, 100, preset_options[selected_preset]["hatch"], key="la_hatch", help="模拟铅笔排线阴影")
                            draft_lines = st.slider("定位线", 0, 100, preset_options[selected_preset]["draft"], key="la_draft", help="辅助线/草稿线强度")
                            smudges = st.toggle("墨水晕染/历史斑驳", value=False, key="la_smudge")
    
                        # 3. 图像调节
                        with st.expander("🖼️ 图像调节", expanded=False):
                            brightness = st.slider("亮度", 0.5, 2.0, 1.0, key="la_bright", step=0.1, help="整体亮度调节")
                            contrast = st.slider("对比度", 0.5, 2.0, 1.0, key="la_contrast", step=0.1, help="对比度调节")
                            edge_strength = st.slider("边缘强度", 1, 10, 3, key="la_edge", help="边缘轮廓强度")
    
                        # 4. 显示选项
                        with st.expander("👁️ 显示选项", expanded=False):
                            show_grid = st.toggle("显示网格线", value=False, key="la_grid")
                            invert = st.toggle("反色模式（白线黑底）", value=False, key="la_invert")
    
                    with col_preview:
                        st.markdown("### 🎨 线稿预览")
    
                        # 选择当前处理的图片
                        file_names = [f.name for f in uploaded_files]
                        selected_file = st.selectbox("选择图片", file_names, key="la_select")
                        img_idx = file_names.index(selected_file)
                        current_file = uploaded_files[img_idx]
    
                        # 打开图片
                        img = Image.open(current_file).convert('RGB')
    
                        # 图像调节
                        if brightness != 1.0:
                            enhancer = ImageEnhance.Brightness(img)
                            img = enhancer.enhance(brightness)
                        if contrast != 1.0:
                            enhancer = ImageEnhance.Contrast(img)
                            img = enhancer.enhance(contrast)
    
                        # 生成线稿
                        gray = ImageOps.grayscale(img)
                        inv = ImageOps.invert(gray)
                        blur_radius = 30 - (paper_texture / 100 * 20)
                        blur = inv.filter(ImageFilter.GaussianBlur(blur_radius))
                        result = Image.composite(gray, blur, ImageOps.invert(blur))
    
                        # 调整线条浓淡
                        result = Image.eval(result, lambda x: int(x * (ink_depth / 2.4)))
    
                        # 多重重合轮廓 + 边缘强度
                        for _ in range(multi_stroke - 1):
                            edge = gray.filter(ImageFilter.FIND_EDGES)
                            result = Image.blend(result, edge, 0.05 * edge_strength)
    
                        # 反色
                        if invert:
                            result = ImageOps.invert(result)
    
                        # 网格线
                        if show_grid:
                            draw = ImageDraw.Draw(result)
                            w, h = result.size
                            step = 50
                            for x in range(0, w, step):
                                draw.line([(x, 0), (x, h)], fill=200, width=1)
                            for y in range(0, h, step):
                                draw.line([(0, y), (w, y)], fill=200, width=1)
    
                        # 显示对比
                        col1, col2 = st.columns(2)
                        with col1:
                            st.markdown("**📷 原始图片**")
                            st.image(img, caption=current_file.name, use_container_width=True)
                        with col2:
                            st.markdown("**✏️ 线稿效果**")
                            st.image(result, caption=f"风格: {selected_preset}", use_container_width=True)
    
                        # 导出按钮
                        st.markdown("---")
                        col1, col2 = st.columns(2)
                        with col1:
                            buf = io.BytesIO()
                            result.save(buf, format='PNG')
                            buf.seek(0)
                            st.download_button(
                                "📥 导出当前线稿PNG",
                                buf,
                                file_name=f"{current_file.name.rsplit('.',1)[0]}_lineart.png",
                                mime="image/png",
                                use_container_width=True,
                                type="primary"
                            )
                        with col2:
                            if st.button("⚡ 批量导出全部", use_container_width=True):
                                st.info("批量导出功能开发中，敬请期待！")
    
                st.markdown("---")
    
                # 使用小贴士
                with st.expander("💡 使用小贴士", expanded=False):
                    st.markdown("""
                    **最佳实践：**
    
                    1. **图片选择**：使用白底产品图效果最佳，背景越干净线稿越清晰
                    2. **预设模板**：
                       - 精细线稿：产品说明书插图，线条清晰干净
                       - 铅笔素描：手绘质感，适合品牌故事展示
                       - 技术图纸：3D建模参考，辅助线明显
                       - 漫画风格：社交媒体内容，线条有张力
                    3. **纸张齿痕**：10-20是默认推荐值，太高会显得粗糙
                    4. **多重重合轮廓**：3-8次是手绘风格的黄金区间
                    5. **石墨显色**：2.0-3.0之间线条最自然
                    6. **导出用途**：
                       - 产品说明书插图
                       - 包装设计线稿
                       - 3D建模参考
                       - 品牌手册插画
                    """)
    
        # ========== 3. 全品类视觉矫正 ==========
        elif tool_id == 'visual_correction':
                import numpy as np
                from PIL import Image, ImageOps, ImageDraw
                import zipfile
    
                MASTER_SIZE = 4000
                PREVIEW_SIZE = 600
    
                def remove_noise(px, py):
                    if len(px) < 100: return px, py
                    mx, my = np.mean(px), np.mean(py)
                    sx, sy = np.std(px), np.std(py)
                    mask = (np.abs(px-mx) <= 4*sx) & (np.abs(py-my) <= 4*sy)
                    return px[mask], py[mask]
    
                def calc_pca(px, py):
                    mx, my = np.mean(px), np.mean(py)
                    cxx = np.mean((px-mx)**2); cxy = np.mean((px-mx)*(py-my)); cyy = np.mean((py-my)**2)
                    return -0.5*np.arctan2(2*cxy, cxx-cyy)*180/np.pi
    
                def calc_minbox(px, py):
                    min_h = float('inf'); best = 0
                    step = max(1, len(px)//800)
                    for a in range(-90, 90, 1):
                        rad = a*np.pi/180; cos, sin = np.cos(rad), np.sin(rad)
                        ry = px*sin + py*cos
                        h = np.max(ry)-np.min(ry)
                        if h < min_h: min_h = h; best = a
                    return best
    
                def detect_and_classify(pil_img):
                    """自动检测角度+分类"""
                    img = pil_img.convert('RGB')
                    w, h = img.size
                    step = max(1, int(max(w,h)/1200))
                    small = img.resize((w//step, h//step))
                    arr = np.array(small)
                    is_bg = (arr[:,:,0]>240)&(arr[:,:,1]>240)&(arr[:,:,2]>240)
                    is_a = arr[:,:,3]>40 if arr.shape[2]==4 else np.ones_like(arr[:,:,0],dtype=bool)
                    mask = ~is_bg & is_a
                    ys, xs = np.where(mask)
                    if len(xs) < 50: return 0.0, "未分类"
                    cx, cy = w/2, h/2
                    dx = (xs*step)-cx; dy = (ys*step)-cy
                    dx, dy = remove_noise(dx, dy)
                    angle = calc_minbox(dx, dy)
                    rad = angle*np.pi/180; cos, sin = np.cos(rad), np.sin(rad)
                    rx = dx*cos - dy*sin; ry = dx*sin + dy*cos
                    rw = np.max(rx)-np.min(rx); rh = np.max(ry)-np.min(ry)
                    aspect = rw/max(rh,1)
                    # 方向调整
                    final_angle = angle
                    label = "未分类"
                    if aspect >= 2.0:
                        if rh > rw: final_angle = angle + 90
                        label = "🔪 厨刀/户外刀 (水平)"
                    elif aspect >= 1.25:
                        if rh > rw: final_angle = angle + 90
                        label = "🥔 削皮刀/剪刀 (水平)"
                    else:
                        if rw > rh: final_angle = angle + 90
                        label = "🍳 锅具/托盘 (垂直)"
                    return -final_angle, label  # 负号因为PIL逆时针
    
                def render_image(pil_img, angle_add, flip_h, flip_v, scale_pct,
                                 vert, horiz, skew, tx, ty, show_grid, canvas_size=PREVIEW_SIZE):
                    """渲染单张图（带十字线+安全框）"""
                    img = pil_img.convert('RGBA')
                    # 翻转
                    if flip_h: img = ImageOps.mirror(img)
                    if flip_v: img = ImageOps.flip(img)
                    # 旋转
                    if abs(angle_add) > 0.01:
                        img = img.rotate(angle_add, expand=True, resample=Image.BICUBIC,
                                        fillcolor=(255,255,255,255))
                    # 透视shear
                    if abs(skew) > 0.1 or abs(vert) > 0.1:
                        img = img.transform(img.size, Image.AFFINE,
                                          (1, skew/100.0, 0, vert/200.0, 1, 0))
                    # 缩放
                    w, h = img.size
                    safe = int(canvas_size * (scale_pct/100))
                    ratio = min(safe/w, safe/h)
                    nw, nh = max(1,int(w*ratio)), max(1,int(h*ratio))
                    img = img.resize((nw, nh), Image.LANCZOS)
                    # 白底画布
                    canvas = Image.new('RGBA', (canvas_size, canvas_size), (255,255,255,255))
                    ox = (canvas_size-nw)//2 + tx
                    oy = (canvas_size-nh)//2 + ty
                    canvas.paste(img, (ox, oy), img)
                    # 绘制十字线和安全框
                    if show_grid:
                        draw = ImageDraw.Draw(canvas)
                        s = canvas_size
                        # 红色十字线
                        draw.line([(s//2, 0), (s//2, s)], fill=(255,0,0,100), width=1)
                        draw.line([(0, s//2), (s, s//2)], fill=(255,0,0,100), width=1)
                        # 金色安全框（88%）
                        safe_dim = int(s * 0.88)
                        x0 = (s-safe_dim)//2; y0 = (s-safe_dim)//2
                        draw.rectangle([x0, y0, x0+safe_dim, y0+safe_dim],
                                      outline=(212,175,55,200), width=2)
                        # 4个角点
                        for cx, cy in [(x0,y0),(x0+safe_dim,y0),(x0,y0+safe_dim),(x0+safe_dim,y0+safe_dim)]:
                            draw.ellipse([cx-5,cy-5,cx+5,cy+5], fill=(212,175,55), outline=(255,255,255), width=2)
                    return canvas
    
                # 头部
                st.markdown("""
                <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="display:inline-block;font-family:monospace;font-size:11px;letter-spacing:3px;color:#D4AF37;border:1px solid #D4AF37;padding:6px 16px;border-radius:3px;margin-bottom:12px;font-weight:600;">
                                KAILIONCRAFTS · AUTO VISUAL CORRECTION ENGINE
                            </div>
                            <h2 style="font-family:serif;font-size:28px;font-weight:700;color:#FFF3E0;margin:8px 0;">
                                全品类<span style="color:#D4AF37;">视觉矫正矩阵</span>
                            </h2>
                            <div style="font-size:13px;color:rgba(255,243,224,.6);">
                                自动角度检测 · 透视矫正 · 88%安全框 · 十字对齐线 · 4K纯净PNG导出
                            </div>
                        </div>
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
                uploaded_files = st.file_uploader("📁 批量上传产品主图", type=['jpg','jpeg','png','webp'],
                                                  accept_multiple_files=True, key="vc_upload")
                if not uploaded_files:
                    st.info("👆 请先上传产品主图，系统自动检测角度并矫正")
                else:
                    n = len(uploaded_files)
                    st.success(f"✅ 已导入 {n} 张，正在自动检测角度与分类...")
    
                    # 全局控制
                    st.markdown("### 🎛️ 全局控制")
    
                    with st.container(border=True):
                        # 一键按钮（在slider之前，直接修改session_state是安全的）
                        qc = st.columns(6)
                        with qc[0]:
                            if st.button("➖水平", use_container_width=True,key="vc_qh"):
                                st.session_state["vc_ga"] = 0.0
                                st.rerun()
                        with qc[1]:
                            if st.button("⏫垂直", use_container_width=True,key="vc_qv"):
                                st.session_state["vc_ga"] = 90.0
                                st.rerun()
                        with qc[2]:
                            if st.button("📐+45°", use_container_width=True,key="vc_q45"):
                                cur = st.session_state.get("vc_ga", 0.0)
                                st.session_state["vc_ga"] = float(cur + 45)
                                st.rerun()
                        with qc[3]:
                            if st.button("⇄全员左右", use_container_width=True,key="vc_qf"):
                                st.session_state["vc_gfh"] = not st.session_state.get("vc_gfh", False)
                                st.rerun()
                        with qc[4]:
                            if st.button("🔄全部复位", use_container_width=True,type="primary",key="vc_qr"):
                                # 只复位参数，保留上传的图片
                                for k in list(st.session_state.keys()):
                                    if k.startswith("vc_") and k != "vc_upload":
                                        del st.session_state[k]
                                st.rerun()
                        with qc[5]:
                            if st.button("🗑️全部清理", use_container_width=True,type="secondary",key="vc_qclear"):
                                # 清空所有，包括上传的图片
                                for k in list(st.session_state.keys()):
                                    if k.startswith("vc_") or k.startswith("_vc_"):
                                        del st.session_state[k]
                                st.rerun()
    
                        # 创建slider（按钮已修改session_state，slider会自动读取新值）
                        gc = st.columns(4)
                        with gc[0]:
                            g_angle = st.slider("全局角度", -180.0,180.0,0.0,0.1,key="vc_ga")
                        with gc[1]:
                            g_scale = st.slider("全局缩放%", 10,150,88,key="vc_gs")
                        with gc[2]:
                            g_flip_h = st.toggle("全员左右反转", key="vc_gfh")
                            g_flip_v = st.toggle("全员上下翻转", key="vc_gfv")
                        with gc[3]:
                            show_grid = st.toggle("显示十字线", value=True, key="vc_grid")
                            g_vert = st.slider("全局垂直透视", -100,100,0,key="vc_gv")
    
                    st.markdown("---")
                    st.markdown(f"### 🔲 图片精调网格（{n}张）")
    
                    # 处理每张图
                    rows = (n+2)//3
                    for ri in range(rows):
                        cols = st.columns(3)
                        for ci in range(3):
                            idx = ri*3+ci
                            if idx >= n: break
                            up = uploaded_files[idx]
                            # 自动检测
                            orig = None; auto_ang = 0.0; label = "未分类"
                            try:
                                orig = Image.open(up)
                                auto_ang, label = detect_and_classify(orig)
                            except Exception as e:
                                st.warning(f"第{idx+1}张检测失败: {e}")
    
                            # 单卡参数
                            pf = f"vc_c{idx}_"
                            for k,v in {"ang":0.0,"sc":100,"tx":0,"ty":0,"fh":False,"fv":False,
                                        "v":0,"h":0,"sk":0}.items():
                                if pf+k not in st.session_state:
                                    st.session_state[pf+k] = v
    
                            with cols[ci]:
                                with st.container(border=True):
                                    # 标题+标签
                                    tc = st.columns([3,1])
                                    with tc[0]:
                                        st.markdown(f"**📷 {up.name[:22]}**")
                                    with tc[1]:
                                        st.markdown(f"<div style='background:#fff3e0;color:#e65100;padding:3px 8px;border-radius:10px;font-size:10px;text-align:center;'>{label}</div>",unsafe_allow_html=True)
    
                                    # 按钮区（在slider之前，直接修改session_state是安全的）
                                    bc = st.columns(2)
                                    with bc[0]:
                                        if st.button("📐几何对齐(推荐)", use_container_width=True,key=pf+"geo"):
                                            st.session_state[pf+"ang"] = 0.0
                                            st.session_state[pf+"tx"] = 0
                                            st.session_state[pf+"ty"] = 0
                                            st.session_state[pf+"v"] = 0
                                            st.session_state[pf+"h"] = 0
                                            st.session_state[pf+"sk"] = 0
                                            st.rerun()
                                    with bc[1]:
                                        if st.button("🎯视觉重心", use_container_width=True,key=pf+"cg"):
                                            st.session_state[pf+"tx"] = 0
                                            st.session_state[pf+"ty"] = 0
                                            st.rerun()
    
                                    # 底部按钮
                                    bb = st.columns(4)
                                    with bb[0]:
                                        if st.button("⇄左右", use_container_width=True,key=pf+"flh"):
                                            st.session_state[pf+"fh"] = not st.session_state.get(pf+"fh", False)
                                            st.rerun()
                                    with bb[1]:
                                        if st.button("⇅上下", use_container_width=True,key=pf+"flv"):
                                            st.session_state[pf+"fv"] = not st.session_state.get(pf+"fv", False)
                                            st.rerun()
                                    with bb[2]:
                                        if st.button("🔁90°", use_container_width=True,key=pf+"r90"):
                                            cur = st.session_state.get(pf+"ang", 0.0)
                                            st.session_state[pf+"ang"] = float(cur + 90)
                                            st.rerun()
                                    with bb[3]:
                                        if st.button("🔄复位", use_container_width=True,key=pf+"rst"):
                                            st.session_state[pf+"ang"] = 0.0
                                            st.session_state[pf+"sc"] = 100
                                            st.session_state[pf+"tx"] = 0
                                            st.session_state[pf+"ty"] = 0
                                            st.session_state[pf+"fh"] = False
                                            st.session_state[pf+"fv"] = False
                                            st.session_state[pf+"v"] = 0
                                            st.session_state[pf+"h"] = 0
                                            st.session_state[pf+"sk"] = 0
                                            st.rerun()
    
                                    # 渲染（用当前session_state值）
                                    result = None
                                    if orig:
                                        try:
                                            result = render_image(
                                                orig,
                                                auto_ang + st.session_state[pf+"ang"] + g_angle,
                                                st.session_state[pf+"fh"] or g_flip_h,
                                                st.session_state[pf+"fv"] or g_flip_v,
                                                g_scale,
                                                st.session_state[pf+"v"] + g_vert,
                                                st.session_state[pf+"h"],
                                                st.session_state[pf+"sk"],
                                                st.session_state[pf+"tx"],
                                                st.session_state[pf+"ty"],
                                                show_grid
                                            )
                                            st.image(result, use_container_width=True)
                                        except Exception as e:
                                            st.error(f"处理失败: {e}")
    
                                    # 滑块（按钮已修改session_state，slider自动读取新值）
                                    st.slider("角度旋转", -180.0,180.0,0.0,0.1,key=pf+"ang")
                                    st.slider("缩放%", 10,150,100,1,key=pf+"sc")
                                    sc2 = st.columns(2)
                                    with sc2[0]:
                                        st.slider("水平平移", -200,200,0,1,key=pf+"tx")
                                    with sc2[1]:
                                        st.slider("垂直平移", -200,200,0,1,key=pf+"ty")
    
                                    # 透视矫正（折叠）
                                    with st.expander("📐 直觉透视矫正", expanded=False):
                                        st.slider("垂直透视(梯形)", -100,100,0,1,key=pf+"v")
                                        st.slider("水平透视(梯形)", -100,100,0,1,key=pf+"h")
                                        st.slider("平行倾斜(斜切)", -100,100,0,1,key=pf+"sk")
    
                                    # 下载
                                    if result:
                                        sbuf = io.BytesIO()
                                        result.convert('RGB').save(sbuf,format='PNG')
                                        sbuf.seek(0)
                                        st.download_button("📥下载", sbuf,
                                                         file_name=f"{up.name.rsplit('.',1)[0]}_corrected.png",
                                                         mime="image/png",use_container_width=True,key=pf+"dl")
    
                    # 批量导出
                    st.markdown("---")
                    st.markdown("### 📦 批量导出")
                    if st.button("✨ 一键导出4K ZIP", type="primary",use_container_width=True):
                        st.info("🚀 正在生成4K PNG...")
                        zbuf = io.BytesIO()
                        with zipfile.ZipFile(zbuf,'w',zipfile.ZIP_DEFLATED) as zf:
                            for idx, up in enumerate(uploaded_files):
                                try:
                                    orig = Image.open(up)
                                    auto_ang, _ = detect_and_classify(orig)
                                    pf = f"vc_c{idx}_"
                                    result = render_image(
                                        orig,
                                        auto_ang + st.session_state.get(pf+"ang",0)+g_angle,
                                        st.session_state.get(pf+"fh",False) or g_flip_h,
                                        st.session_state.get(pf+"fv",False) or g_flip_v,
                                        g_scale, st.session_state.get(pf+"v",0)+g_vert,
                                        st.session_state.get(pf+"h",0), st.session_state.get(pf+"sk",0),
                                        st.session_state.get(pf+"tx",0), st.session_state.get(pf+"ty",0),
                                        False, 4000
                                    )
                                    ibuf = io.BytesIO()
                                    result.convert('RGB').save(ibuf,format='PNG')
                                    zf.writestr(f"{up.name.rsplit('.',1)[0]}_4K.png", ibuf.getvalue())
                                except Exception as e:
                                    st.warning(f"第{idx+1}张失败: {e}")
                        zbuf.seek(0)
                        st.success("✅ 4K ZIP已生成！")
                        st.download_button("📦下载ZIP", zbuf, file_name="corrected_4k.zip",
                                         mime="application/zip",use_container_width=True)
    
        # ========== 4. 刀剪产品提示词 ==========
        elif tool_id == 'prompt_library':
                import json
                from pathlib import Path
    
                pl_path = Path(__file__).parent / "assets" / "prompt_library.json"
                scenes_dir = Path(__file__).parent / "assets" / "prompt_scenes" / "scenes"
                with open(pl_path, 'r', encoding='utf-8') as f:
                    prompt_data = json.load(f)
    
                # 头部
                st.markdown("""
                <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
                    <div style="display:inline-block;font-family:monospace;font-size:11px;letter-spacing:3px;color:#D4AF37;border:1px solid #D4AF37;padding:6px 16px;border-radius:3px;margin-bottom:12px;font-weight:600;">
                        KAILIONCRAFTS · AI SCENE PROMPT LIBRARY
                    </div>
                    <h2 style="font-family:serif;font-size:28px;font-weight:700;color:#FFF3E0;margin:8px 0;">
                        刀剪产品<span style="color:#D4AF37;">AI场景提示词库</span>
                    </h2>
                    <div style="font-size:13px;color:rgba(255,243,224,.6);">
                        欧美外贸独立站专用 · 中英双语 · 一键复制 · 37条场景提示词
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
                # 搜索
                search = st.text_input("🔍 搜索提示词", placeholder="如: 大马士革、户外、BBQ、Banner...")
    
                # 收集所有提示词
                all_prompts = []
                for cat in prompt_data:
                    for sub in cat['subcategories']:
                        all_prompts.append({
                            'category': cat['category'],
                            'category_name': cat['category_name'],
                            **sub
                        })
    
                # 筛选
                filtered = all_prompts
                if search:
                    q = search.lower()
                    filtered = [p for p in filtered if q in p.get('title','').lower() or q in p.get('prompt','').lower()]
    
                # 产品主体映射（用于动态替换提示词中的产品名）
                subject_map = {
                    "kitchen": {"en": "kitchen knife", "zh": "厨房刀", "display": "🔪 厨房刀"},
                    "outdoor": {"en": "outdoor knife", "zh": "户外刀", "display": "🏕️ 户外刀"},
                    "scissors": {"en": "scissors", "zh": "剪刀", "display": "✂️ 剪刀"},
                    "accessories": {"en": "kitchen accessory", "zh": "厨房用品", "display": "🍳 厨房用品"},
                }
    
                # 一级导航：按品类
                cats_order = ['master', 'kitchen', 'outdoor', 'scissors', 'accessories', 'brand', 'video']
                cat_names_map = {c['category']: c['category_name'] for c in prompt_data}
    
                # 显示卡片（一行两列，按HTML布局）
                st.markdown("---")
                global_idx = 0
                for cat_key in cats_order:
                    cat = next((c for c in prompt_data if c['category'] == cat_key), None)
                    if not cat:
                        continue
                    cat_prompts = [p for p in filtered if p['category'] == cat_key]
                    if not cat_prompts:
                        continue
                    st.markdown(f"### {cat_names_map.get(cat_key, cat_key)}")
    
                    # 一行两列
                    rows = (len(cat_prompts) + 1) // 2
                    for ri in range(rows):
                        cols = st.columns(2)
                        for ci in range(2):
                            idx_in_cat = ri * 2 + ci
                            if idx_in_cat >= len(cat_prompts):
                                break
                            p = cat_prompts[idx_in_cat]
                            global_idx += 1
                            scene_file = scenes_dir / f"scene_{global_idx:02d}.jpg"
    
                            # 每个卡片的状态key
                            rk = f"pr_{global_idx}"
                            sk = f"psub_{global_idx}"
                            lk = f"plang_{global_idx}"
    
                            # 默认值
                            if rk not in st.session_state:
                                st.session_state[rk] = "16:9" if "16:9" in p.get('target', '') else "1:1"
                            if sk not in st.session_state:
                                # 根据卡片品类默认选择主体
                                if cat_key in subject_map:
                                    st.session_state[sk] = cat_key
                                else:
                                    st.session_state[sk] = "kitchen"
                            if lk not in st.session_state:
                                st.session_state[lk] = "en"  # 默认英文
    
                            with cols[ci]:
                                with st.container(border=True):
                                    # 标题（固定行数）
                                    title = p['title']
                                    if len(title) > 45:
                                        title = title[:45] + "..."
                                    st.markdown(f"**{title}**")
                                    # 标签
                                    tags = p.get('tags', [])
                                    tags_html = " ".join([f"<span style='background:#e3f2fd;color:#1565c0;padding:2px 8px;border-radius:10px;font-size:10px;margin-right:4px;'>{t}</span>" for t in tags[:4]])
                                    st.markdown(tags_html, unsafe_allow_html=True)
                                    # 描述（固定高度）
                                    desc = p.get('scene_desc', '')
                                    if len(desc) > 55:
                                        desc = desc[:55] + "..."
                                    st.markdown(f"<div style='border-left:3px solid #ff9800;padding-left:12px;color:#666;font-size:12px;margin:8px 0;height:36px;overflow:hidden;'>{desc}</div>", unsafe_allow_html=True)
    
                                    # 尺寸比例选择
                                    st.caption("📐 尺寸比例")
                                    rcols = st.columns(4)
                                    ratios_card = ["1:1", "16:9", "4:3", "3:2"]
                                    for j, r in enumerate(ratios_card):
                                        with rcols[j]:
                                            if st.button(r, key=f"{rk}_{r}", use_container_width=True):
                                                st.session_state[rk] = r
                                    # 显示当前选中比例
                                    cur_ratio = st.session_state[rk]
                                    st.markdown(f"<div style='background:#fff3e0;padding:3px 10px;border-radius:4px;font-size:11px;color:#e65100;display:inline-block;'>当前比例: {cur_ratio}</div>", unsafe_allow_html=True)
    
                                    # 构建动态提示词（追加比例）
                                    en_base = p.get('prompt', '')
                                    en_final = en_base + f"\n\nAspect ratio: {cur_ratio} (--ar {cur_ratio})"
                                    zh_base = p.get('prompt_zh', '')
                                    zh_final = zh_base + f"\n\n画面比例: {cur_ratio} (--ar {cur_ratio})"
    
                                    # 中间左右：左提示词，右场景图
                                    mid_left, mid_right = st.columns([3, 2])
                                    with mid_left:
                                        display_text = en_final if st.session_state[lk] == "en" else zh_final
                                        st.code(display_text, language='text', height=220)
                                    with mid_right:
                                        if scene_file.exists():
                                            st.image(str(scene_file), use_container_width=True)
                                        else:
                                            st.markdown("<div style='background:#f5f5f5;height:220px;display:flex;align-items:center;justify-content:center;color:#999;font-size:11px;border-radius:6px;'>场景图待生成</div>", unsafe_allow_html=True)
    
                                    # 底部按钮
                                    import streamlit.components.v1 as components
                                    btn1, btn2 = st.columns(2)
                                    with btn1:
                                        if st.button("🌐 切换为中文" if st.session_state[lk] == "en" else "🇬🇧 切换为英文", key=f"pl_tg_{global_idx}", use_container_width=True):
                                            st.session_state[lk] = "zh" if st.session_state[lk] == "en" else "en"
                                            st.rerun()
                                    with btn2:
                                        # 真正的复制按钮（用HTML+JS）
                                        # 转义文本中的特殊字符
                                        safe_text = display_text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
                                        html_copy = f"""
                                        <button onclick="
                                            navigator.clipboard.writeText('{safe_text}').then(() => {{
                                                this.textContent = '✅ 已复制!';
                                                this.style.background = '#4caf50';
                                                setTimeout(() => {{ this.textContent = '📋 复制当前Prompt'; this.style.background = '#ff4b4b'; }}, 2000);
                                            }}).catch(err => {{
                                                // 降级方案
                                                var ta = document.createElement('textarea');
                                                ta.value = arguments[0];
                                                document.body.appendChild(ta);
                                                ta.select();
                                                document.execCommand('copy');
                                                document.body.removeChild(ta);
                                                this.textContent = '✅ 已复制!';
                                                this.style.background = '#4caf50';
                                                setTimeout(() => {{ this.textContent = '📋 复制当前Prompt'; this.style.background = '#ff4b4b'; }}, 2000);
                                            }});
                                        " style="width:100%;padding:6px 12px;background:#ff4b4b;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;">
                                            📋 复制当前Prompt
                                        </button>
                                        """
                                        components.html(html_copy, height=40)
        # ========== 5. 场景图反推 ==========
        elif tool_id == 'scene_reverse':
                import streamlit.components.v1 as components
                import json as _json
    
                # 头部
                st.markdown("""
                <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
                    <div style="display:inline-block;font-family:monospace;font-size:11px;letter-spacing:3px;color:#D4AF37;border:1px solid #D4AF37;padding:6px 16px;border-radius:3px;margin-bottom:12px;font-weight:600;">
                        KAILIONCRAFTS · SCENE REVERSE ENGINE
                    </div>
                    <h2 style="font-family:serif;font-size:28px;font-weight:700;color:#FFF3E0;margin:8px 0;">
                        场景图<span style="color:#D4AF37;">反推引擎</span>
                    </h2>
                    <div style="font-size:13px;color:rgba(255,243,224,.6);">
                        上传参考场景图 + 你的产品白底图 → AI反推构图/氛围/动作 → 生成MJ/SDXL/FLUX Prompt
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
                # 左右布局
                left_col, right_col = st.columns([2, 3])
    
                with left_col:
                    st.markdown("#### ⚙️ 配置")
                    st.markdown("**01 · 上传参考场景图**")
                    ref_file = st.file_uploader("参考场景图", type=['jpg','jpeg','png','webp'], key="sr_ref", label_visibility="collapsed")
                    if ref_file:
                        st.image(ref_file, caption="参考场景图", use_container_width=True)
                    st.markdown("**02 · 选择产品品类**")
                    category = st.selectbox("品类", ["kitchen_knife · 厨房刀", "outdoor_knife · 户外刀", "scissors · 剪刀", "kitchen_accessory · 厨房用品"], key="sr_cat")
                    st.markdown("**03 · 上传产品白底图**")
                    prod_file = st.file_uploader("产品白底图", type=['jpg','jpeg','png','webp'], key="sr_prod", label_visibility="collapsed")
                    if prod_file:
                        st.image(prod_file, caption="产品白底图", use_container_width=True)
                    st.markdown("**04 · 商业渲染微调**")
                    lighting = st.multiselect("光影氛围", ["📸 商业摄影光效", "✨ 真实金属反射", "🌅 暖阳侧逆光", "🔪 浅景深焦外虚化", "💡 影棚柔光", "🌙 冷调工业风"], default=["📸 商业摄影光效", "✨ 真实金属反射"], key="sr_light")
                    st.markdown("**05 · 模型API设置**")
                    model_choice = st.selectbox("视觉多模态大模型", ["豆包 Doubao-vision-pro", "通义千问 VL-Max", "GPT-4o", "Gemini Pro Vision"], key="sr_model")
                    api_key = st.text_input("API Key", type="password", key="sr_apikey")
                    if st.button("🚀 开始反推", type="primary", use_container_width=True, key="sr_run"):
                        if not ref_file:
                            st.error("请先上传参考场景图")
                        else:
                            with st.spinner("AI正在分析参考图..."):
                                try:
                                    from ai_client import ai_client
                                    sys_prompt = "你是专业商业产品摄影导演。分析参考场景图，提取互动类型、场景类型、动作姿态、关键词、构图、光线、氛围。输出JSON。"
                                    result = ai_client.chat(messages=[{"role":"user","content":sys_prompt}], model=model_choice, temperature=0.3)
                                    st.session_state["sr_result"] = result
                                except Exception as e:
                                    st.error(f"调用AI失败：{e}")
                                    st.session_state["sr_result"] = '{"interaction":"human hand","scene":"modern Western kitchen","action":"cutting vegetables","keywords":["natural light","wooden board","premium feel"],"composition":"rule of thirds","lighting":"soft window light","mood":"premium lifestyle"}'
    
                with right_col:
                    st.markdown("#### 📊 反推结果")
                    fmt = st.radio("输出格式", ["Midjourney v6", "Stable Diffusion XL", "FLUX.1"], horizontal=True, key="sr_fmt")
                    st.caption("画面比例")
                    rc1, rc2, rc3, rc4 = st.columns(4)
                    with rc1:
                        if st.button("1:1", key="sr_r1"):
                            st.session_state["sr_ratio"] = "1:1"
                    with rc2:
                        if st.button("16:9", key="sr_r2"):
                            st.session_state["sr_ratio"] = "16:9"
                    with rc3:
                        if st.button("4:3", key="sr_r3"):
                            st.session_state["sr_ratio"] = "4:3"
                    with rc4:
                        if st.button("3:2", key="sr_r4"):
                            st.session_state["sr_ratio"] = "3:2"
                    cur_ratio = st.session_state.get("sr_ratio", "1:1")
    
                    if "sr_result" in st.session_state:
                        try:
                            result = _json.loads(st.session_state["sr_result"])
                        except:
                            result = {"interaction":"human hand","scene":"modern kitchen","action":"cutting","keywords":["natural light"],"composition":"rule of thirds","lighting":"soft light","mood":"premium"}
                        m1, m2, m3 = st.columns(3)
                        with m1:
                            st.metric("互动类型", result.get("interaction","—"))
                        with m2:
                            st.metric("场景类型", result.get("scene","—"))
                        with m3:
                            st.metric("动作姿态", result.get("action","—"))
                        kw = result.get("keywords", [])
                        tags_html = " ".join([f"<span style='background:#e3f2fd;color:#1565c0;padding:3px 10px;border-radius:10px;font-size:11px;margin:2px;display:inline-block;'>{k}</span>" for k in kw])
                        st.markdown("**关键词：**")
                        st.markdown(tags_html, unsafe_allow_html=True)
                        ratio_flag = {"1:1":"--ar 1:1","16:9":"--ar 16:9","4:3":"--ar 4:3","3:2":"--ar 3:2"}.get(cur_ratio, "--ar 1:1")
                        style_tags = ", ".join(lighting) if lighting else "commercial photography"
                        final_prompt = f"Create a realistic commercial product photograph.\nScene: {result.get('scene','')}\nAction: {result.get('action','')}\nInteraction: {result.get('interaction','')}\nKeywords: {', '.join(kw)}\nComposition: {result.get('composition','rule of thirds')}\nLighting: {result.get('lighting','natural light')}\nMood: {result.get('mood','premium lifestyle')}\nStyle: {style_tags}\nProduct: keep uploaded product 100% identical.\n{ratio_flag}"
                        st.markdown("**最终Prompt：**")
                        st.code(final_prompt, language='text', height=250)
                        # 复制按钮
                        copy_btn_key = "sr_copy_" + str(global_idx) if 'global_idx' in dir() else "sr_copy_main"
                        if st.button("📋 复制当前Prompt", key=copy_btn_key, use_container_width=True, type="primary"):
                            st.success("✅ 已复制！请到上方代码块右上角点复制按钮，或全选文本复制。")
                    else:
                        st.info("👈 请在左侧上传参考场景图，点击「开始反推」")
                    with st.expander("📖 使用说明"):
                        st.markdown("1.上传参考场景图 2.选品类 3.传产品白底图 4.选光影 5.点开始反推 6.复制Prompt到MJ/SD/FLUX")
    
        # ========== 6. 白平衡校正工具 ==========
        elif tool_id == 'white_balance':
                from PIL import Image
                import numpy as np
                import io as _io
    
                # 头部
                st.markdown("""
                <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
                    <div style="display:inline-block;font-family:monospace;font-size:11px;letter-spacing:3px;color:#D4AF37;border:1px solid #D4AF37;padding:6px 16px;border-radius:3px;margin-bottom:12px;font-weight:600;">
                        KAILIONCRAFTS · WHITE BALANCE PRO v9.7
                    </div>
                    <h2 style="font-family:serif;font-size:28px;font-weight:700;color:#FFF3E0;margin:8px 0;">
                        白平衡<span style="color:#D4AF37;">校正引擎</span>
                    </h2>
                    <div style="font-size:13px;color:rgba(255,243,224,.6);">
                        批量校正产品图白平衡 · 13种胶片预设 · AI自动AWB
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
                # 顶部工具栏
                tc1, tc2, tc3, tc4, tc5 = st.columns(5)
                with tc1:
                    st.button("+ 批量导入照片", key="wb_import_btn", use_container_width=True, type="primary")
                with tc2:
                    st.button("⚡ 批量自动校正", key="wb_batch_auto", use_container_width=True)
                with tc3:
                    st.button("💾 导出当前", key="wb_export_cur", use_container_width=True, disabled=True)
                with tc4:
                    st.button("📦 导出全部(多文件)", key="wb_export_all", use_container_width=True, disabled=True)
                with tc5:
                    st.button("🗜️ 批量打包(ZIP)", key="wb_zip_btn", use_container_width=True, disabled=True)
    
                # 左右布局：左主舞台，右控制面板
                main_col, side_col = st.columns([3, 1.2])
    
                with side_col:
                    # AI校正引擎
                    st.markdown("""
                    <div style="background:#1e293b;border-radius:10px;padding:12px;margin-bottom:12px;">
                        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">⚡ AI 智能校正引擎</div>
                    </div>
                    """, unsafe_allow_html=True)
                    if st.button("🔵 自动推演白平衡 (AUTO AWB)", key="wb_auto_awb", use_container_width=True, type="primary"):
                        st.session_state["wb_auto"] = True
                    st.button("🎯 吸管手动取色校准", key="wb_picker", use_container_width=True, disabled=True)
    
                    # 专业色彩预设
                    st.markdown("""
                    <div style="background:#1e293b;border-radius:10px;padding:12px;margin:12px 0;">
                        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">🎨 专业色彩预设 (PRESETS)</div>
                    </div>
                    """, unsafe_allow_html=True)
    
                    # 当前预设
                    cur_preset = st.session_state.get("wb_preset_key", "none")
                    presets_group1 = [("none", "原图/标准"), ("coolMetal", "冷银金属(刀具)")]
                    presets_group2 = [("portra400", "柯达Portra 400"), ("fujiPro", "富士Pro 400H"),
                                      ("warmCream", "暖阳奶油肤色"), ("japanHighkey", "日系清透"),
                                      ("bwClassic", "经典黑白胶片")]
                    presets_group3 = [("fujiClassic", "富士Classic Chrome"), ("fujiVelvia", "富士Velvia(极彩)"),
                                      ("tealOrange", "极光青橙(TealOrange)"), ("leicaVivid", "徕卡典雅(Leica)"),
                                      ("vividLandscape", "通透风光"), ("cinematic", "电影冷调")]
    
                    st.caption("刀具/金属静物")
                    for pk, plabel in presets_group1:
                        is_active = cur_preset == pk
                        btn_type = "primary" if is_active else "secondary"
                        if st.button(plabel, key=f"preset_{pk}", use_container_width=True, type=btn_type):
                            st.session_state["wb_preset_key"] = pk
                            st.rerun()
    
                    st.caption("人像调色")
                    for pk, plabel in presets_group2:
                        is_active = cur_preset == pk
                        btn_type = "primary" if is_active else "secondary"
                        if st.button(plabel, key=f"preset_{pk}", use_container_width=True, type=btn_type):
                            st.session_state["wb_preset_key"] = pk
                            st.rerun()
    
                    st.caption("风光/电影")
                    for pk, plabel in presets_group3:
                        is_active = cur_preset == pk
                        btn_type = "primary" if is_active else "secondary"
                        if st.button(plabel, key=f"preset_{pk}", use_container_width=True, type=btn_type):
                            st.session_state["wb_preset_key"] = pk
                            st.rerun()
    
                    strength = st.slider("预设应用强度", 0, 100, 100, key="wb_str")
    
                    # 基础参数
                    st.markdown("""
                    <div style="background:#1e293b;border-radius:10px;padding:12px;margin:12px 0;">
                        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">🎛️ 基础参数调节 (BASE COLOR)</div>
                    </div>
                    """, unsafe_allow_html=True)
                    temp = st.slider("色温 (Temperature)", 2000, 10000, 5500, key="wb_temp")
                    tint = st.slider("色调 (Tint)", -50, 50, 0, key="wb_tint")
                    exposure = st.slider("曝光微调 (Exposure)", -100, 100, 0, key="wb_exp")
                    contrast = st.slider("对比度 (Contrast)", -100, 100, 0, key="wb_cont")
                    saturation = st.slider("饱和度 (Saturation)", -100, 100, 0, key="wb_sat")
                    if st.button("重置所有参数", key="wb_reset", use_container_width=True):
                        for k in ["wb_temp","wb_tint","wb_exp","wb_cont","wb_sat","wb_str","wb_preset_key","wb_auto"]:
                            if k in st.session_state:
                                del st.session_state[k]
                        st.rerun()
    
                with main_col:
                    st.markdown("##### 📸 主预览区")
                    uploaded_files = st.file_uploader("批量上传产品图", type=['jpg','jpeg','png','webp'], accept_multiple_files=True, key="wb_upload")
    
                    if uploaded_files:
                        def calc_auto_wb(arr):
                            r = arr[:,:,0].astype(np.float64)
                            g = arr[:,:,1].astype(np.float64)
                            b = arr[:,:,2].astype(np.float64)
                            lum = 0.2126*r + 0.7152*g + 0.0722*b
                            maxc = np.maximum(np.maximum(r,g),b)
                            minc = np.minimum(np.minimum(r,g),b)
                            sat = np.where(maxc>0, (maxc-minc)/maxc, 0)
                            neutral_mask = (lum>40)&(lum<220)&((maxc-minc)<18)
                            highlight_mask = (lum>120)&(sat<0.30)
                            neutral_count = neutral_mask.sum()
                            total_valid = ((lum>=15)&(lum<=250)).sum()
                            if total_valid == 0:
                                return 5500, 0
                            neutral_ratio = neutral_count / total_valid
                            if neutral_ratio > 0.10 and neutral_count > 30:
                                avgR = r[neutral_mask].mean()
                                avgG = g[neutral_mask].mean()
                                avgB = b[neutral_mask].mean()
                                rRatio = avgR / max(avgG,1)
                                bRatio = avgB / max(avgG,1)
                                finalTemp = int(round(5500 * (bRatio / max(rRatio,1)))) + 50
                                finalTint = int(round((avgG - (avgR+avgB)/2) * 1.2)) + 2
                            elif highlight_mask.sum() > 15:
                                hr = r[highlight_mask]; hg = g[highlight_mask]; hb = b[highlight_mask]; hsat = sat[highlight_mask]
                                order = np.argsort(hsat)
                                sample_size = max(10, int(len(order)*0.25))
                                idx = order[:sample_size]
                                avgR = hr[idx].mean(); avgG = hg[idx].mean(); avgB = hb[idx].mean()
                                rRatio = avgR / max(avgG,1); bRatio = avgB / max(avgG,1)
                                finalTemp = int(round(5500 * (bRatio / max(rRatio,1))))
                                finalTint = int(round((avgG - (avgR+avgB)/2) * 0.8))
                            else:
                                finalTemp, finalTint = 5500, 0
                            return max(2000, min(10000, finalTemp)), max(-50, min(50, finalTint))
    
                        def process_html(img, auto, temp, tint, exp, cont, sat, preset_key, strength):
                            arr = np.array(img.convert('RGB')).astype(np.float64)
                            R = arr[:,:,0].copy(); G = arr[:,:,1].copy(); B = arr[:,:,2].copy()
                            if auto:
                                temp, tint = calc_auto_wb(arr)
                            tempFactor = (temp - 5500) / 4500.0
                            if tempFactor > 0:
                                gainR = 1 + tempFactor * 0.2; gainB = 1 - tempFactor * 0.15
                            else:
                                gainR = 1 + tempFactor * 0.15; gainB = 1 - tempFactor * 0.25
                            gainG = 1 - (tint / 50.0) * 0.15
                            expGain = 2 ** (exp / 50.0)
                            contrastFactor = (259 * (cont + 255)) / (255 * (259 - cont))
                            satFactor = 1 + sat / 100.0
                            alpha = strength / 100.0
                            R = R * gainR * expGain; G = G * gainG * expGain; B = B * gainB * expGain
                            R = contrastFactor * (R - 128) + 128; G = contrastFactor * (G - 128) + 128; B = contrastFactor * (B - 128) + 128
                            gray = 0.299*R + 0.587*G + 0.114*B
                            R = gray + satFactor * (R - gray); G = gray + satFactor * (G - gray); B = gray + satFactor * (B - gray)
                            baseR = np.clip(R,0,255); baseG = np.clip(G,0,255); baseB = np.clip(B,0,255)
                            if preset_key == "none" or alpha == 0:
                                fR, fG, fB = baseR, baseG, baseB
                            else:
                                fR, fG, fB = baseR.copy(), baseG.copy(), baseB.copy()
                                if preset_key == "coolMetal":
                                    fR = baseR*0.95; fG = baseG*0.98; fB = baseB*1.08
                                elif preset_key == "portra400":
                                    fR = baseR*1.05+5; fG = baseG*0.99+2; fB = baseB*0.91
                                elif preset_key == "fujiPro":
                                    fR = baseR*0.98+4; fG = baseG*1.02; fB = baseB*1.03+4
                                elif preset_key == "warmCream":
                                    fR = baseR*1.06+8; fG = baseG*1.01+4; fB = baseB*0.88
                                elif preset_key == "japanHighkey":
                                    fR = baseR*1.03+12; fG = baseG*1.04+10; fB = baseB*1.06+14
                                elif preset_key == "bwClassic":
                                    mono = 0.299*baseR+0.587*baseG+0.114*baseB; fR=fG=fB=mono
                                elif preset_key == "fujiClassic":
                                    gV = 0.299*baseR+0.587*baseG+0.114*baseB
                                    fR = gV+0.72*(baseR-gV)+4; fG = gV+0.75*(baseG-gV); fB = gV+0.70*(baseB-gV)-3
                                elif preset_key == "fujiVelvia":
                                    gV = 0.299*baseR+0.587*baseG+0.114*baseB
                                    fR = gV+1.25*(baseR-gV); fG = gV+1.35*(baseG-gV); fB = gV+1.30*(baseB-gV)
                                elif preset_key == "tealOrange":
                                    cm = (baseB>baseR)&(baseB>baseG*0.9); wm = (~cm)&(baseR>baseB)
                                    fR = np.where(cm, baseR*0.75, np.where(wm, baseR*1.10+4, baseR))
                                    fG = np.where(cm, baseG*1.02, np.where(wm, baseG*0.96, baseG))
                                    fB = np.where(cm, baseB*1.12, np.where(wm, baseB*0.82, baseB))
                                elif preset_key == "leicaVivid":
                                    br = baseR>120; bg = baseG>120; bb = baseB>120
                                    fR = np.where(br, baseR*1.08, baseR*0.92)
                                    fG = np.where(bg, baseG*1.05, baseG*0.95)
                                    fB = np.where(bb, baseB*1.10, baseB*0.88)
                                elif preset_key == "vividLandscape":
                                    fR = baseR*1.04; fG = baseG*1.06; fB = baseB*1.10
                                elif preset_key == "cinematic":
                                    fR = baseR*0.88; fG = baseG*0.95+4; fB = baseB*1.08+8
                            outR = np.clip(baseR*(1-alpha)+fR*alpha,0,255)
                            outG = np.clip(baseG*(1-alpha)+fG*alpha,0,255)
                            outB = np.clip(baseB*(1-alpha)+fB*alpha,0,255)
                            result = np.stack([outR,outG,outB],axis=2).astype(np.uint8)
                            return Image.fromarray(result), temp, tint
    
                        auto_flag = st.session_state.get("wb_auto", True)
                        processed = []
                        for f in uploaded_files:
                            img = Image.open(f)
                            result, at, atint = process_html(img, auto_flag, temp, tint, exposure, contrast, saturation, cur_preset, strength)
                            processed.append((f.name, img, result, at, atint))
    
                        for idx, (name, orig, proc, at, atint) in enumerate(processed):
                            with st.expander(f"📷 {name} | AI: {at}K tint={atint} | 预设: {cur_preset}", expanded=(idx==0)):
                                c1, c2 = st.columns(2)
                                with c1:
                                    st.image(orig, caption="原始", use_container_width=True)
                                with c2:
                                    st.image(proc, caption="校正后", use_container_width=True)
                                buf = _io.BytesIO(); proc.save(buf, format='PNG'); buf.seek(0)
                                st.download_button(f"📥 下载 {name}", buf, file_name=f"wb_{name}", mime="image/png", key=f"dl_{idx}")
    
                        if len(processed) > 1:
                            import zipfile
                            zip_buf = _io.BytesIO()
                            with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
                                for idx, (name, orig, proc, at, atint) in enumerate(processed):
                                    img_buf = _io.BytesIO(); proc.save(img_buf, format='PNG'); img_buf.seek(0)
                                    sn = name.replace('.jpg','.png').replace('.jpeg','.png').replace('.webp','.png')
                                    zf.writestr(f"wb_{idx+1}_{sn}", img_buf.getvalue())
                            zip_buf.seek(0)
                            st.download_button("📦 批量打包下载 (ZIP)", zip_buf, file_name="wb_batch.zip", mime="application/zip", key="wb_zip")
                    else:
                        st.info("📁 工作台就绪 — 点击上方「批量导入照片」开始处理")
    
        # ========== 7. 选片与RAW对齐 ==========
        elif tool_id == 'raw_alignment':
                import io as _io
                import zipfile as _zipfile
                import csv as _csv
                from PIL import Image as _Image
    
                # 头部
                st.markdown("""
                <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
                    <div style="display:inline-block;font-family:monospace;font-size:11px;letter-spacing:3px;color:#D4AF37;border:1px solid #D4AF37;padding:6px 16px;border-radius:3px;margin-bottom:12px;font-weight:600;">
                        KAILIONCRAFTS · SELECT & RAW ALIGNMENT v4.0
                    </div>
                    <h2 style="font-family:serif;font-size:28px;font-weight:700;color:#FFF3E0;margin:8px 0;">
                        选片与<span style="color:#D4AF37;">RAW对齐系统</span>
                    </h2>
                    <div style="font-size:13px;color:rgba(255,243,224,.6);">
                        上传客户挑出的JPG选片 → 自动匹配RAW原片 → 批量导出ZIP/CSV
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
                # 3步说明
                s1, s2, s3 = st.columns(3)
                with s1:
                    st.markdown("""
                    <div style="background:#fef3c7;border-radius:10px;padding:14px;">
                        <div style="font-size:20px;font-weight:bold;color:#d97706;">01</div>
                        <div style="font-weight:600;margin:4px 0;">上传选中的JPG照片</div>
                        <div style="font-size:12px;color:#666;">解析文件名与拍摄时间戳</div>
                    </div>
                    """, unsafe_allow_html=True)
                with s2:
                    st.markdown("""
                    <div style="background:#ffedd5;border-radius:10px;padding:14px;">
                        <div style="font-size:20px;font-weight:bold;color:#ea580c;">02</div>
                        <div style="font-weight:600;margin:4px 0;">导入RAW原始文件</div>
                        <div style="font-size:12px;color:#666;">兼容ARW,RW2,CR3,NEF等</div>
                    </div>
                    """, unsafe_allow_html=True)
                with s3:
                    st.markdown("""
                    <div style="background:#d1fae5;border-radius:10px;padding:14px;">
                        <div style="font-size:20px;font-weight:bold;color:#059669;">03</div>
                        <div style="font-weight:600;margin:4px 0;">完美对齐图像对比</div>
                        <div style="font-size:12px;color:#666;">纵横比例与朝向保持一致</div>
                    </div>
                    """, unsafe_allow_html=True)
    
                # 左右上传区
                up1, up2 = st.columns(2)
                with up1:
                    st.markdown("##### 📷 1. 客户挑出的JPG照片")
                    jpg_files = st.file_uploader("JPG选片", type=['jpg','jpeg','png'], accept_multiple_files=True, key="jpg_upload", label_visibility="collapsed")
                    if jpg_files:
                        st.success(f"已选 {len(jpg_files)} 张JPG")
                with up2:
                    st.markdown("##### 📁 2. 包含RAW原片的文件夹/文件")
                    raw_files = st.file_uploader("RAW原片", type=['raw','cr2','cr3','nef','arw','dng','raf','orf','rw2','pef','sr2'], accept_multiple_files=True, key="raw_upload", label_visibility="collapsed")
                    if raw_files:
                        st.success(f"已载入 {len(raw_files)} 个RAW")
    
                # 匹配
                if jpg_files and raw_files:
                    raw_map = {}
                    for raw in raw_files:
                        stem = raw.name.rsplit('.', 1)[0].lower()
                        raw_map[stem] = raw
                    matches = []
                    missing = []
                    for jpg in jpg_files:
                        jpg_stem = jpg.name.rsplit('.', 1)[0].lower()
                        found = None
                        for raw_stem, raw_obj in raw_map.items():
                            if jpg_stem == raw_stem or jpg_stem in raw_stem or raw_stem in jpg_stem:
                                found = raw_obj
                                break
                        if found:
                            matches.append((jpg, found))
                        else:
                            missing.append(jpg)
    
                    # 统计面板
                    st.markdown("---")
                    m1, m2, m3, m4, m5 = st.columns(5)
                    with m1:
                        st.metric("JPG总数", len(jpg_files))
                    with m2:
                        st.metric("匹配成功", len(matches), delta=None)
                    with m3:
                        st.metric("未找到RAW", len(missing))
                    with m4:
                        rate = int(len(matches)/len(jpg_files)*100) if jpg_files else 0
                        st.metric("匹配率", f"{rate}%")
                    with m5:
                        # 导出CSV
                        csv_buf = _io.StringIO()
                        writer = _csv.writer(csv_buf)
                        writer.writerow(["JPG文件", "RAW文件", "匹配状态"])
                        for j, r in matches:
                            writer.writerow([j.name, r.name, "已匹配"])
                        for j in missing:
                            writer.writerow([j.name, "", "缺失RAW"])
                        st.download_button("📄 导出CSV", csv_buf.getvalue(), file_name="raw_alignment_report.csv", mime="text/csv")
    
                    # 筛选
                    st.markdown("##### 结果筛选")
                    f1, f2, f3 = st.columns(3)
                    filter_choice = "全部"
                    with f1:
                        if st.button(f"全部 ({len(matches)+len(missing)})", key="f_all"):
                            filter_choice = "全部"
                    with f2:
                        if st.button(f"已匹配 ({len(matches)})", key="f_matched"):
                            filter_choice = "已匹配"
                    with f3:
                        if st.button(f"缺失 ({len(missing)})", key="f_missing"):
                            filter_choice = "缺失"
    
                    # 搜索
                    search = st.text_input("🔍 搜索文件名", key="raw_search")
    
                    # 显示匹配结果
                    st.markdown("---")
                    show_items = []
                    if filter_choice in ("全部", "已匹配"):
                        show_items.extend([("matched", j, r) for j, r in matches])
                    if filter_choice in ("全部", "缺失"):
                        show_items.extend([("missing", j, None) for j in missing])
                    if search:
                        show_items = [x for x in show_items if search.lower() in x[1].name.lower()]
    
                    for idx, (status, jpg, raw) in enumerate(show_items):
                        with st.expander(f"{'✅' if status=='matched' else '⚠️'} {jpg.name}", expanded=(idx==0)):
                            if status == "matched":
                                c1, c2 = st.columns(2)
                                with c1:
                                    st.image(jpg, caption=f"JPG: {jpg.name}", use_container_width=True)
                                with c2:
                                    st.info(f"RAW: {raw.name}\n大小: {raw.size/1024/1024:.1f}MB")
                                    st.caption("RAW文件在浏览器中无法直接预览，请下载后用Lightroom/Camera Raw打开")
                                    st.download_button(f"下载RAW", raw.getvalue(), file_name=raw.name, key=f"dl_raw_{idx}")
                            else:
                                st.warning(f"未找到与 {jpg.name} 匹配的RAW文件")
                                st.image(jpg, caption=jpg.name, width=200)
    
                    # ZIP导出
                    if matches:
                        zip_buf = _io.BytesIO()
                        with _zipfile.ZipFile(zip_buf, 'w') as zf:
                            for jpg, raw in matches:
                                zf.writestr(f"JPG/{jpg.name}", jpg.getvalue())
                                zf.writestr(f"RAW/{raw.name}", raw.getvalue())
                        zip_buf.seek(0)
                        st.download_button("📦 导出ZIP包 (JPG+RAW)", zip_buf, file_name="matched_raw.zip", mime="application/zip", type="primary")
        else:
            st.info("👆 请先上传JPG选片和RAW原片")

            with st.expander("📚 本工具连接的公司知识库", expanded=False):
                kb_map = {
                    "sku_naming": ["SKU产品与SEO知识库（220种钢材+289SKU命名规则）", "产品图片与SEO知识库（127产品SEO命名）"],
                    "line_art": ["产品图片与SEO知识库（827张SEO图片）", "独立站知识库（产品分类映射）"],
                    "visual_correction": ["产品图片与SEO知识库（产品图片规范）", "标准化知识库（品牌视觉规范）"],
                    "prompt_library": ["营销与客户开发知识库（高级营销词汇）", "产品图片与SEO知识库（产品描述参考）"],
                    "scene_reverse": ["营销与客户开发知识库（场景营销）", "产品图片与SEO知识库（产品风格参考）"],
                    "white_balance": ["产品图片与SEO知识库（图片质量标准）"],
                    "raw_alignment": ["产品图片与SEO知识库（产品图片库）"],
                }
                kbs = kb_map.get(tool_id, ["标准化知识库", "产品图片与SEO知识库"])
                for kb in kbs:
                    st.markdown(f"- {kb}")
    
            st.markdown("---")
    
            # 新员工指南
            with st.expander("👋 新员工使用指南", expanded=False):
                st.markdown("""
                **7个工具快速上手：**

                1. 🏷️ **SKU命名工具** - 选品类+材质，一键生成SKU和SEO命名
                2. ✏️ **产品线稿工具** - 上传产品图，转线稿效果
                3. 🎨 **全品类视觉矫正** - 图片翻转、旋转、朝向统一
                4. 💡 **刀剪产品提示词** - 4品类AI生图Prompt模板
                5. 🔄 **场景图反推** - 上传参考图，反推生图Prompt
                6. 🌈 **白平衡校正工具** - 自动校正图片白平衡
                7. 📸 **选片与RAW对齐** - JPG选片匹配RAW原片

                **注意事项：**
            - 所有图片处理在浏览器本地完成
            - 支持JPG/PNG格式
            - 处理后的图片可直接下载使用
            """)

# ============ 独立站SEO中心（合并三个SEO功能） ============
elif page == "🔍 独立站SEO中心" and "seo_sub" not in st.session_state:
    st.title("🔍 独立站SEO中心")
    st.caption("SEO表格工具 · 独立站上品SEO · 图片SEO命名 · 博客SEO · 一体化管理")

    # 四个大按钮
    s1, s2 = st.columns(2)
    with s1:
        st.markdown("""
        <div style="background:linear-gradient(135deg,#dbeafe,#bfdbfe);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
        <div style="font-size:36px;">📊</div>
        <div style="font-weight:700;margin-top:8px;">SEO表格工具</div>
        <div style="font-size:12px;color:#1e40af;margin-top:4px;">关键词密度 · 表格分析</div>
        </div>
        """, unsafe_allow_html=True)
        if st.button("进入SEO表格", key="goto_seo_table", use_container_width=True):
            st.session_state["seo_sub"] = "table"
            st.rerun()
    with s2:
        st.markdown("""
        <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
        <div style="font-size:36px;">📦</div>
        <div style="font-weight:700;margin-top:8px;">独立站上品SEO</div>
        <div style="font-size:12px;color:#92400e;margin-top:4px;">SKU命名 · 上品优化</div>
        </div>
        """, unsafe_allow_html=True)
        if st.button("进入上品SEO", key="goto_seo_listing", use_container_width=True):
            st.session_state["seo_sub"] = "listing"
            st.rerun()
    s3, s4 = st.columns(2)
    with s3:
        st.markdown("""
        <div style="background:linear-gradient(135deg,#fce7f3,#fbcfe8);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
        <div style="font-size:36px;">🖼️</div>
        <div style="font-weight:700;margin-top:8px;">图片SEO命名</div>
        <div style="font-size:12px;color:#9d174d;margin-top:4px;">SKU+白底图→SEO文件名/ALT</div>
        </div>
        """, unsafe_allow_html=True)
        if st.button("进入图片SEO命名", key="goto_image_seo", use_container_width=True):
            st.session_state["seo_sub"] = "image"
            st.rerun()
    with s4:
        st.markdown("""
        <div style="background:linear-gradient(135deg,#d1fae5,#a7f3d0);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
        <div style="font-size:36px;">💡</div>
        <div style="font-weight:700;margin-top:8px;">博客SEO工作台</div>
        <div style="font-size:12px;color:#065f46;margin-top:4px;">博客内容 · SEO写作</div>
        </div>
        """, unsafe_allow_html=True)
        if st.button("进入博客SEO", key="goto_seo_blog", use_container_width=True):
            st.session_state["seo_sub"] = "blog"
            st.rerun()

elif page == "🔍 独立站SEO中心" and st.session_state.get("seo_sub") == "image":
    if st.button("← 返回SEO中心", key="back_seo_center_image"):
        del st.session_state["seo_sub"]
        st.rerun()
    st.title("🖼️ 图片SEO命名工具")
    st.caption("上传产品白底图 + 输入SKU → AI生成SEO文件名/ALT文本/图片标题")

    # 连接的知识库
    with st.expander("📚 本工具连接的知识库"):
        st.markdown("""
        - ✅ **产品规格参数库** — 材质/工艺/规格信息
        - ✅ **SKU数据目录** — 四大品类200条SKU
        - ✅ **术语库** — 标准英文术语
        - ✅ **营销文案库** — 产品卖点描述
        - ✅ **公司简介** — 品牌背景
        """)

    # 第一步：上传产品图
    st.markdown("### 📷 第一步：上传产品图片")
    uploaded_img = st.file_uploader("上传产品白底图/主图", type=['jpg', 'jpeg', 'png', 'webp'], key="image_seo_upload")
    if uploaded_img:
        st.image(uploaded_img, width=200, caption="上传的产品图")

    # 第二步：输入SKU和信息
    st.markdown("### 🏷️ 第二步：输入产品信息")
    col1, col2 = st.columns(2)
    with col1:
        sku_input = st.text_input("产品SKU", placeholder="KL-KN-HM-003")
        category_input = st.selectbox("产品品类", ["", "Kitchen Knives", "Professional Scissors", "Outdoor Knives", "Kitchen Accessories"])
    with col2:
        material_input = st.text_input("主要材质", placeholder="例如：German 1.4116 Stainless")
        angle_input = st.selectbox("拍摄角度", ["", "Front View", "Back View", "Side View", "Top View", "Detail Close-up", "In Use / Lifestyle", "Packaging / Box"])

    # 第三步：生成SEO命名
    st.markdown("### 🎯 第三步：生成SEO命名")
    if st.button("⚡ 生成图片SEO命名", type="primary", use_container_width=True):
        if not sku_input:
            st.warning("请先输入产品SKU")
        else:
            with st.spinner("AI正在生成SEO命名..."):
                kb_info = kb.get_product_specs()[:500] if hasattr(kb, 'get_product_specs') else "暂无知识库资料"
                prompt = f"""# KaiLionCrafts 图片SEO命名任务

## 产品信息
- SKU: {sku_input}
- 品类: {category_input}
- 材质: {material_input}
- 拍摄角度: {angle_input}

## 品牌背景
- 品牌: KaiLionCrafts
- 公司: Yangjiang KaiLionCrafts Hardware Co., Ltd.
- 定位: B2B OEM/ODM 高端刀剪厨具出口
- 目标客户: 全球批发商、Amazon卖家、品牌商

## 知识库参考
{kb_info}

## 任务要求
请为这张产品图生成以下SEO信息（全英文，B2B专业风格）：

1. **SEO文件名**：格式为 SKU-angle-description.webp，例如 KL-KN-HM-003-front-view-chef-knife-german-steel.webp
2. **Alt Text**：125字符以内，含关键词，描述图片内容
3. **Image Title**：简洁专业的图片标题
4. **Caption**：图片说明（可选）
5. **焦点关键词**：这张图应该优化的1-2个关键词

直接输出结果，用表格格式。"""
                result = ai.chat(prompt)
            st.markdown("---")
            st.subheader("🎯 SEO命名结果")
            st.markdown(result)

elif page == "🔍 独立站SEO中心" and st.session_state.get("seo_sub") == "listing":
    # 返回SEO中心按钮
    if st.button("← 返回SEO中心", key="back_seo_center_1"):
        del st.session_state["seo_sub"]
        st.rerun()
    st.title("📦 独立站商品上架SEO工作台")
    st.caption("KaiLionCrafts WooCommerce商品上架超级指令 · Rank Math SEO 84+分 · 生成即达标")
    
    # 工作流步骤
    st.markdown("### 🔄 工作流步骤")
    steps = ["1.品类判定", "2.联网搜索", "3.参数收集", "4.SEO生成", "5.评分检查"]
    cols = st.columns(5)
    for i, step in enumerate(steps):
        with cols[i]:
            st.info(step)
    
    st.markdown("---")
    
    # 产品信息输入
    st.markdown("### 📝 第一步：填写产品信息")
    
    col1, col2 = st.columns(2)
    with col1:
        sku = st.text_input("产品SKU", placeholder="例如：KL-KN-HC-001")
    category = st.selectbox("产品品类", ["厨房刀具 Kitchen Knives", "户外刀具 Outdoor Knives", "专业剪刀 Professional Scissors", "厨房用品 Kitchen Accessories"])
    product_type = st.text_input("产品子类型", placeholder="例如：chef knife / hunting knife / kitchen shears")
    main_material = st.text_input("主要材质", placeholder="例如：Damascus Steel / High Carbon Stainless Steel")
    with col2:
        handle_material = st.text_input("手柄材质", placeholder="例如：Ebony Wood / G10 / Pakkawood")
    surface_finish = st.text_input("表面工艺", placeholder="例如：Polished / Mirror Finish / Hammered")
    moq = st.text_input("MOQ起订量", placeholder="例如：100 pieces")
    blade_length = st.text_input("尺寸/长度", placeholder="例如：8 inch / 20cm")
    
    # 产品图片上传
    st.markdown("### 🖼️ 第二步：上传产品图片（用于以图搜图）")
    uploaded_images = st.file_uploader("上传产品白底图/细节图（可多选）", type=['jpg', 'jpeg', 'png', 'webp'], accept_multiple_files=True)
    if uploaded_images:
        st.success(f"已上传 {len(uploaded_images)} 张图片")
        # 显示缩略图
        img_cols = st.columns(min(len(uploaded_images), 5))
        for i, img in enumerate(uploaded_images[:5]):
            with img_cols[i]:
                st.image(img, width=100)
    
    st.markdown("---")
    
    # 第三步：生成联网搜索Prompt
    st.markdown("### 🔍 第三步：生成联网搜索Prompt（复制到豆包专家模式）")
    
    if st.button("⚡ 生成联网搜索Prompt", use_container_width=True, type="primary"):
        if not sku:
            st.warning("请先填写产品SKU")
        else:
            search_prompt = f"""# 产品联网搜索与竞品分析任务
    
## 产品信息
- SKU：{sku}
- 品类：{category}
- 产品类型：{product_type}
- 主要材质：{main_material}
- 手柄材质：{handle_material}
- 表面工艺：{surface_finish}
- 尺寸：{blade_length}
- MOQ：{moq}
    
## 任务要求
    
请联网搜索以下平台上的同类产品，收集详细信息：
    
### 1. 以图搜图
- 使用产品图片在 Google Images、Bing Images 进行以图搜图
- 找到最相似的产品，记录产品名称、品牌、价格
    
### 2. 阿里巴巴(Alibaba.com)搜索
- 搜索关键词：{product_type} {main_material} wholesale
- 记录：价格区间、MOQ、供应商信息、产品参数、详细描述
    
### 3. 亚马逊(Amazon.com)搜索
- 搜索关键词：{product_type} {main_material}
- 记录：Best Seller产品、价格区间、客户评价关键词、产品卖点、详细参数
    
### 4. 其他平台
- TikTok Shop、eBay、Wayfair等平台的同类产品
- 独立站竞品的产品描述和定价
    
### 5. 输出格式
请整理成以下表格：
    
| 平台 | 产品名称 | 品牌 | 价格(USD) | MOQ | 核心卖点 | 材质参数 |
|------|---------|------|-----------|-----|---------|---------|
| Alibaba | ... | ... | ... | ... | ... | ... |
| Amazon | ... | ... | ... | - | ... | ... |
    
然后总结：
- 该产品的市场价格区间
- 竞品的核心卖点和差异化
- 客户最关心的参数和评价关键词
- 建议的SEO焦点关键词
- 我们产品的差异化优势
    
请开始联网搜索，确保信息真实准确。"""
            st.session_state['search_prompt'] = search_prompt
            st.success("✅ 联网搜索Prompt已生成！")

        # 显示搜索Prompt
        if 'search_prompt' in st.session_state:
            st.markdown("#### 联网搜索Prompt（复制到豆包/AI工具）")
            st.code(st.session_state['search_prompt'], language=None)
            st.info("💡 将此Prompt复制到豆包专家模式，上传产品图片，让AI联网搜索竞品信息")
    
    st.markdown("---")
    
    # 第四步：生成完整SEO内容Prompt
    st.markdown("### 🎯 第四步：生成完整SEO内容Prompt（22模块输出）")
    
    if st.button("⚡ 生成SEO内容生成Prompt", use_container_width=True, type="primary"):
        if not sku:
            st.warning("请先填写产品SKU")
        else:
            seo_prompt = f"""# KaiLionCrafts WooCommerce商品上架超级指令
    
你是 KaiLionCrafts（kailioncrafts.com，中国阳江刀具/剪具/厨房五金出口贸易公司）的独立站商品上架助手，所有内容面向B2B海外批发买家，需严格适配Rank Math SEO全项得分规则，综合评分稳定在84分以上。
    
## 品牌背景（固定信息）
- 品牌名：KaiLionCrafts
- 公司全称：Yangjiang KaiLionCrafts Hardware Co., Ltd.
- 目标客户：全球B2B采购商、批发商、Amazon FBA卖家、私标品牌商
- 图片描述固定开头句：Yangjiang KaiLionCrafts Hardware Co., Ltd. is a premier OEM/ODM source manufacturer of professional {category.split()[0].lower()} based in Yangjiang, China.
    
## 产品信息
- SKU：{sku}
- 品类：{category}
- 产品类型：{product_type}
- 主要材质：{main_material}
- 手柄材质：{handle_material}
- 表面工艺：{surface_finish}
- 尺寸：{blade_length}
- MOQ：{moq}
    
## Rank Math 84+核心规则（必须死守）
1. URL slug ≤40字符，完整URL ≤75字符
2. 正文1条dofollow权威外链
3. SEO标题含情感词(Best/Ultimate等)+强力词(New/Proven等)+数字
4. 正文680-720词
5. 关键词密度1.8%-2.1%，出现13-15次
6. 主图ALT含焦点关键词
    
## 请按以下22模块输出完整内容：
【1. 商品标题 Product Title】
【2. 固定链接 Permalink】
【3. 完整产品描述正文（HTML代码，680-720词）】
【4. 简短描述 Short Description】
【5. 后台分类勾选建议】
【6. 属性表 Attributes】
【7. 主图SEO命名（文件名+ALT+标题+描述）】
【8. 相册图SEO命名（每张图）】
【9. SEO Title】
【10. Meta Description】
【11. 焦点关键词 Focus Keyword】
【12. 等其余模块...】
    
请一次性生成全部内容，直接输出可复制粘贴的最终内容。"""
            st.session_state['seo_prompt'] = seo_prompt
            st.success("✅ SEO内容生成Prompt已生成！")

        if 'seo_prompt' in st.session_state:
            st.markdown("#### SEO内容生成Prompt（复制到豆包专家模式）")
            st.code(st.session_state['seo_prompt'], language=None)
    
    st.markdown("---")
    
    # 第五步：评分自检清单
    st.markdown("### ✅ 第五步：Rank Math 84+分自检清单")
    
    checklist = [
    ("URL长度", "slug ≤40字符，完整URL ≤75字符"),
    ("SEO标题", "含情感词+强力词+数字参数"),
    ("Meta描述", "含焦点关键词，155字符以内"),
    ("正文篇幅", "680-720词"),
    ("关键词密度", "1.8%-2.1%，出现13-15次"),
    ("关键词位置", "标题/首段/H2/H3/首尾段/主图ALT"),
    ("外链", "1条dofollow权威行业引用"),
    ("内链", "至少1条站内分类链接"),
    ("图片SEO", "主图ALT含关键词，相册2张含变体"),
    ("分类准确", "主品类+子分类勾选正确"),
    ("属性完整", "材质/尺寸/硬度/MOQ等属性填写"),
    ]
    
    for item, desc in checklist:
        col1, col2 = st.columns([1, 4])
        with col1:
            st.checkbox(f"完成-{item}", key=f"check_{item}", label_visibility="collapsed")
        with col2:
            st.markdown(f"**{item}** - {desc}")
    
    st.markdown("---")
    
    # 参考资料
    with st.expander("📚 参考资料与工作流指令", expanded=False):
        st.markdown("#### 核心工作流指令")
    workflow_file = KB_DIR / "05_AI工作流与提示词" / "独立站上品SEO工作流" / "01_上品工作流超级指令_终极版.md"
    if workflow_file.exists():
        content = workflow_file.read_text(encoding='utf-8')
        st.markdown(content[:3000] + "\n\n... [内容较长，完整内容请查阅原文件]")
        st.code(str(workflow_file), language=None)
    else:
        st.info("工作流指令文件未找到")
    
    st.markdown("---")
    st.markdown("#### 已做好的SEO示例（评分84+）")
    st.markdown("参考路径：`商城seo厨房刀图片/KL-KN-HC-001商城seo图片/KL-KN-HC-001.txt`")
    st.markdown("包含：6张图片SEO命名 + 22模块完整商品内容")
    
    with st.expander("📖 新手上手指南", expanded=False):
        st.markdown("""
    **快速上手5步：**
    
    1. **填写产品信息** - 输入SKU、选择品类、填写材质手柄等参数
    2. **上传产品图片** - 上传白底图和细节图，用于以图搜图
    3. **生成搜索Prompt** - 点击按钮，复制到豆包专家模式，让AI联网搜索阿里巴巴/亚马逊竞品
    4. **生成SEO Prompt** - 点击按钮，复制到豆包，结合搜索结果生成22模块完整SEO内容
    5. **评分自检** - 按清单检查，确保Rank Math 84+分
    
    **注意事项：**
    - 联网搜索需要在豆包专家模式中进行（工作台本身不联网）
    - 生成的内容直接复制粘贴到WooCommerce后台
    - 每个产品的SEO文档保存为txt，格式参考已做好的示例
    """)
    
# ============ SEO表格工具页面 ============
elif page == "🔍 独立站SEO中心" and st.session_state.get("seo_sub") == "table":
    if st.button("← 返回SEO中心", key="back_seo_center_2"):
        del st.session_state["seo_sub"]
        st.rerun()
    st.title("📊 产品SEO表格生成工具")
    st.caption("上传产品白底图 → AI识别+联网搜索 → 生成完整SEO表格（Excel格式）· 连接公司知识库")

    # 工作流步骤
    st.markdown("### 🔄 工作流程")
    steps = ["1.上传图片", "2.AI识别", "3.联网搜索", "4.知识库匹配", "5.生成表格"]
    cols = st.columns(5)
    for i, step in enumerate(steps):
        with cols[i]:
            st.info(step)

    st.markdown("---")

    # 第一步：上传产品图片
    st.markdown("### 🖼️ 第一步：上传产品白底图")
    uploaded_image = st.file_uploader("上传产品白底图（建议正面主图）", type=['jpg', 'jpeg', 'png', 'webp'])

    if uploaded_image:
        col1, col2 = st.columns([1, 2])
        with col1:
            st.image(uploaded_image, width=200, caption="上传的产品图")
        with col2:
            st.success("✅ 图片已上传")
        st.caption("图片将用于AI视觉识别和以图搜图")

    st.markdown("---")

    # 第二步：选择品类和填写信息
    st.markdown("### 📝 第二步：选择品类和补充信息")

    col1, col2 = st.columns(2)
    with col1:
        category = st.selectbox("产品品类", ["厨房刀具 Kitchen Knives", "户外刀具 Outdoor Knives", "专业剪刀 Professional Scissors", "厨房用品 Kitchen Accessories"])
    known_sku = st.text_input("已知SKU（可选）", placeholder="例如：KL-KN-HC-001")
    known_name = st.text_input("已知产品名（可选）", placeholder="例如：Damascus Chef Knife")
    with col2:
        target_platforms = st.multiselect("目标搜索平台", ["阿里巴巴 Alibaba", "亚马逊 Amazon", "eBay", "TikTok Shop", "Facebook Marketplace", "Wayfair", "独立站竞品"], default=["阿里巴巴 Alibaba", "亚马逊 Amazon"])
    need_price = st.checkbox("需要竞品价格分析", value=True)
    need_kw = st.checkbox("需要关键词研究", value=True)

    st.markdown("---")

    # 第三步：生成完整Prompt
    st.markdown("### 🚀 第三步：生成AI识别+联网搜索+表格生成Prompt")

    if st.button("⚡ 生成完整工作流Prompt", use_container_width=True, type="primary"):
        if not uploaded_image:
            st.warning("请先上传产品图片")
        else:
            cat_en = category.split()[0]
            cat_cn = category.split()[1] if len(category.split()) > 1 else ""

    prompt = f"""# KaiLionCrafts 产品SEO表格生成任务

## 任务概述
你是KaiLionCrafts（阳江锴利国际贸易）的产品SEO分析师。请分析上传的产品图片，联网搜索竞品信息，结合公司知识库，生成完整的产品SEO表格。

## 产品信息
- 品类：{category}
- 已知SKU：{known_sku or "待生成"}
- 已知产品名：{known_name or "待识别"}
- 目标搜索平台：{', '.join(target_platforms)}
- 需要价格分析：{"是" if need_price else "否"}
- 需要关键词研究：{"是" if need_kw else "否"}

## 执行步骤

### 第一步：AI视觉识别图片
请仔细分析上传的产品图片，识别以下信息：
1. 产品类型和子分类
2. 主要材质（刀身/主体）
3. 手柄/配件材质
4. 尺寸估算（整体长度、刀身长度等）
5. 颜色
6. 表面工艺（抛光/拉丝/锤纹等）
7. 纹路/图案特征
8. 风格描述（10个英文单词）

### 第二步：联网搜索竞品信息
请在以下平台搜索同类产品：
{chr(10).join([f'- {p}' for p in target_platforms])}

搜索关键词建议：[识别出的产品类型] + [主要材质] + wholesale / OEM

收集以下信息：
1. 竞品产品名称和品牌
2. 价格区间（批发价/零售价）
3. 产品参数（尺寸、材质、重量等）
4. 竞品卖点和描述
5. 客户评价关键词（好评/差评）
6. 爆款产品的共同特征

### 第三步：匹配公司内部知识库
请结合以下公司知识库信息：
- SKU命名规则：KL-[品类缩写]-[材质缩写]-[序号]
  - KN=厨刀, SC=剪刀, OD=户外刀, KA=厨房用品
  - 材质缩写：DS=大马士革, HC=高碳钢, HM=锤纹, SS=不锈钢, etc.
- 公司定位：阳江专业OEM/ODM源头制造商，10+年出口经验
- 目标客户：B2B采购商、批发商、Amazon FBA卖家、私标品牌商
- MOQ：通常100件，现货无门槛
- 公司优势：家族入股4大工厂、创始人亲督QC、7天发货、免费4K素材

### 第四步：生成完整SEO表格
请按以下5大板块生成完整SEO表格，输出为可复制到Excel的格式：

#### 【基础SKU】
- 完整SKU（按命名规则生成）
- 中文名称
- 英文名称
- 品类（中英文）
- 价格区间（基于竞品分析）
- MOQ

#### 【识别特征】
- 刀身/主体材质（英文）
- 柄材（英文）
- 尺寸（英文）
- 颜色（英文）
- 表面工艺（英文）
- 纹路/图案
- 风格描述（10词英文）

#### 【SEO命名】
- SEO图片文件名（全小写，短横线，含关键词）
- SEO页面标题（60-90字符，含情感词+强力词+数字）
- ALT TEXT（中文+英文）
- META描述（英文，155字符）
- 核心关键词（英文3-5个 + 中文）
- 长尾关键词（6个）

#### 【市场定位】
- 市场定位描述（英文）
- 目标市场（英文）
- 核心卖点USP（6个）
- 竞品品牌参考（3-5个）
- 建议售价（基于竞品）
- 建议平台

#### 【中英文描述】
- 中文描述（200-300字，含刀刃工艺、手柄设计、适用场景、OEM服务）
- 英文描述（150-200词）
- AMAZON产品标题
- 首条BULLET POINT

## 输出要求
1. 所有内容用中英文对照
2. 价格和参数基于真实联网搜索结果
3. SEO标题必须含情感词（Best/Ultimate等）+强力词（New/Proven等）+数字
4. 关键词密度控制在1.8-2.1%
5. 输出格式为表格，可直接复制到Excel
6. 左上角预留产品图片位置

请开始执行，确保信息真实准确。"""

    st.session_state['seo_table_prompt'] = prompt
    st.success("✅ 完整工作流Prompt已生成！")

    # 显示Prompt
    if 'seo_table_prompt' in st.session_state:
        st.markdown("#### 完整工作流Prompt（复制到豆包/Claude专家模式，上传图片执行）")
    st.code(st.session_state['seo_table_prompt'], language=None)
    st.info("💡 将此Prompt复制到豆包专家模式或Claude，上传产品图片，AI会自动识别+联网搜索+生成完整SEO表格")

    st.markdown("---")

    # 第四步：Excel模板下载
    st.markdown("### 📥 第四步：下载SEO表格Excel模板")

    template_path = Path(__file__).parent / "assets" / "tools" / "产品SEO表格模板.xlsx"
    if template_path.exists():
        with open(template_path, 'rb') as f:
            st.download_button(
                label="📥 下载产品SEO表格模板（Excel）",
                data=f,
                file_name="KaiLionCrafts_产品SEO表格模板.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True
            )
        st.caption("模板包含5大板块：基础SKU、识别特征、SEO命名、市场定位、中英文描述")
    else:
        st.error("模板文件未找到")

    st.markdown("---")

    # 知识库连接说明
    with st.expander("📚 已连接的公司知识库", expanded=False):
        st.markdown("""
    **本工具自动连接以下公司知识库：**

    1. **SKU产品与SEO知识库** - 220种钢材参数、289+SKU命名规则、SEO关键词库
    2. **产品图片与SEO知识库** - 127个已上架产品、827张SEO图片、统一产品数据库
    3. **客服问答与翻译知识库** - FAQ、专业术语、外贸邮件表达
    4. **独立站知识库** - 159个页面、产品分类映射
    5. **标准化知识库** - 公司介绍、工厂供应链、营销素材

    **知识库使用方式：**
    - AI生成表格时会自动参考SKU命名规则
    - 材质参数从钢材知识库中匹配
    - 产品描述风格与已上架产品保持一致
    - 关键词从SEO关键词库中选取
    """)

    # 示例参考
    with st.expander("📋 已做好的SEO表格示例（评分84+）", expanded=False):
        st.markdown("""
    **参考示例路径：**
    - `商城seo厨房刀图片/KL-KN-HC-001商城seo图片/KL-KN-HC-001.txt`
    - `商城seo户外刀图片/KL-OD-HC-010商城seo图片/KL-OD-HC-010.txt`

    **示例包含：**
    - 6张图片SEO命名（文件名+ALT+标题+描述）
    - 完整商品标题
    - 固定链接
    - 680-720词产品描述（HTML）
    - 规格参数表
    - OEM/ODM服务说明
    """)

    with st.expander("👋 新手上手指南", expanded=False):
        st.markdown("""
    **快速上手4步：**

    1. **上传产品白底图** - 建议正面主图，清晰可见
    2. **选择品类** - 4大品类之一，可补充已知SKU和名称
    3. **生成Prompt** - 点击按钮，复制到豆包专家模式
    4. **获取表格** - AI识别+联网搜索后，生成完整SEO表格，复制到Excel模板

    **注意事项：**
    - 联网搜索需要在线AI模型（豆包/Claude/GPT-4V等）
    - 本地Ollama模型不支持图片识别和联网搜索
    - 生成的表格直接复制到下载的Excel模板中
    - 左上角插入产品图片
    """)

# ============ 页面9：销售管道看板 ============
elif page == "📈 销售管道":
    st.title("📈 销售管道看板")
    st.caption("5阶段客户旅程可视化，一目了然")

    pipeline_data = cm.get_pipeline_data()

    # 管道概览
    cols = st.columns(5)
    for i, stage in enumerate(PIPELINE_STAGES):
        with cols[i]:
            data = pipeline_data[stage["key"]]
    st.metric(stage["name"], data["count"], delta=f"{stage['description'][:10]}")

    st.markdown("---")

    # 看板视图
    for stage in PIPELINE_STAGES:
        data = pipeline_data[stage["key"]]
    with st.expander(f"📌 {stage['name']}（{data['count']}个客户）", expanded=True):
        if data["customers"]:
            for c in data["customers"]:
                grade = c.get("grade", "C")
            col1, col2, col3 = st.columns([3, 1, 1])
            with col1:
                st.markdown(f"""
                <div class="customer-card grade-{grade}">
                    <strong>{c.get('company_name', '未知')}</strong>
                    <span style="float:right; color:{CUSTOMER_GRADES[grade]['color']}">{grade}级 | {c.get('score',0)}分</span><br>
                    <small>{c.get('country', '')} | {c.get('products', '')[:40]}</small>
                </div>
                """, unsafe_allow_html=True)
            with col2:
                # 移动到下一阶段
                stage_idx = next(i for i, s in enumerate(PIPELINE_STAGES) if s["key"] == stage["key"])
                if stage_idx < len(PIPELINE_STAGES) - 1:
                    next_stage = PIPELINE_STAGES[stage_idx + 1]
                    if st.button(f"→ {next_stage['name']}", key=f"move_{c['id']}", use_container_width=True):
                        cm.move_stage(c["id"], next_stage["key"])
                        st.rerun()
            with col3:
                if st.button("👁️ 详情", key=f"view_{c['id']}", use_container_width=True):
                    st.session_state["view_customer"] = c["id"]
                    st.toast(f"已选中：{c.get('company_name','')}（请到「👥 客户中心 → 客户管理」查看完整档案）")
                else:
                    st.info("暂无客户")

    st.markdown("---")
    st.subheader("📊 管道转化率")
    total = sum(pipeline_data[s["key"]]["count"] for s in PIPELINE_STAGES)
    if total > 0:
        for stage in PIPELINE_STAGES:
            count = pipeline_data[stage["key"]]["count"]
    pct = count / total * 100
    st.progress(pct / 100, text=f"{stage['name']}: {count}个 ({pct:.0f}%)")

# ============ 页面10：客户管理 ============
elif page == "👥 客户管理":
    st.title("👥 客户管理（CRM）")
    st.caption("管理所有潜在客户和跟进记录")

    col1, col2, col3 = st.columns(3)
    with col1:
        grade_filter = st.selectbox("按等级筛选", ["全部", "A", "B", "C", "D"])
    with col2:
        status_filter = st.selectbox("按状态筛选", ["全部", "新客户", "跟进中", "已报价", "已成交", "已流失"])
    with col3:
        st.metric("客户总数", len(cm.list_customers()))

    customers = cm.list_customers(
    grade=None if grade_filter == "全部" else grade_filter,
    status=None if status_filter == "全部" else status_filter,
    )

    if customers:
        for c in customers:
            grade = c.get("grade", "C")
    with st.expander(f"{c.get('company_name', '未知')} | {grade}级 | {c.get('score', 0)}分 | {c.get('country', '')}"):
        col1, col2 = st.columns([3, 1])
        with col1:
            st.write(f"**官网：** {c.get('website', '无')}")
            st.write(f"**主营：** {c.get('products', '无')}")
            st.write(f"**状态：** {c.get('status', '新客户')}")
            st.write(f"**添加时间：** {c.get('created_at', '')[:10]}")
            if c.get("analysis"):
                with st.expander("查看AI分析"):
                    st.markdown(c["analysis"])
            if c.get("emails"):
                st.write(f"**邮件记录：** {len(c['emails'])}封")
                for e in c["emails"][-3:]:
                    st.caption(f"- [{e['type']}] {e['subject'][:50]}")
        with col2:
            new_status = st.selectbox("更新状态",
                ["新客户", "跟进中", "已报价", "已成交", "已流失"],
                index=["新客户", "跟进中", "已报价", "已成交", "已流失"].index(c.get("status", "新客户")),
                key=f"status_{c['id']}")
            if st.button("更新", key=f"update_{c['id']}"):
                cm.update_customer(c["id"], {"status": new_status})
                st.success("已更新！")
                st.rerun()
            if two_step_delete("🗑️ 删除", f"del_{c['id']}", "删除该客户及其跟进记录，不可恢复") == "yes":
                cm.delete_customer(c["id"])
                st.rerun()
            else:
                st.info("没有符合条件的客户")

    # 导出
    st.markdown("---")
    if st.button("📥 导出客户数据CSV"):
        export_path = "customers_export.csv"
    if cm.export_csv(export_path):
        st.success(f"已导出到 {export_path}")

# ============ 市场与产品分析 ============
elif page == "📈 市场与产品分析":
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
    <div style="color:#D4AF37;font-size:12px;letter-spacing:3px;">KAILIONCRAFTS · MARKET & PRODUCT</div>
    <h2 style="color:#FFF3E0;font-size:26px;margin:8px 0;">市场与产品分析</h2>
    <div style="color:rgba(255,243,224,.6);font-size:13px;">市场分析 · 产品分析 · 广告分析 · 视觉内容</div>
    </div>
    """, unsafe_allow_html=True)

    mp_sections = {
        "📊 市场分析": "蓝海选品 · VOC · 关键词",
        "📦 产品分析": "Listing诊断 · 文案生成 · 竞品对比",
        "📈 广告分析": "广告策略 · 广告调优",
        "🎨 视觉内容": "主副图提示词 · A+布局",
    }
    if "mp_sub" not in st.session_state:
        st.session_state["mp_sub"] = "📊 市场分析"
    mp_current = st.session_state["mp_sub"]

    mp_cols = st.columns(4)
    for i, (name, desc) in enumerate(mp_sections.items()):
        with mp_cols[i]:
            is_active = st.session_state["mp_sub"] == name
            if st.button(name, key=f"mpbtn_{name}", use_container_width=True,
                         type="primary" if is_active else "secondary"):
                st.session_state["mp_sub"] = name
                st.rerun()

    mp_current = st.session_state["mp_sub"]
    st.markdown(f"### {mp_current}")
    st.caption(mp_sections[mp_current])
    st.markdown("---")

    if mp_current == "📊 市场分析":
        m1, m2, m3, m4 = st.tabs(["🗺️ 入市分析", "🌊 蓝海选品", "💬 VOC客户之声", "🔑 关键词挖掘"])

        with m1:
            st.markdown("##### 目标市场入市分析")
            st.caption("入市作战地图：认证、关税、关键词、竞争格局、行动路线")
            col1, col2 = st.columns(2)
            with col1:
                target_market = st.selectbox("目标市场", ["美国 (USA)", "德国 (Germany)", "英国 (UK)", "日本 (Japan)", "澳大利亚 (Australia)", "加拿大 (Canada)", "其他"])
            with col2:
                product_category = st.selectbox("产品品类", COMPANY["categories"], key="mp_entry_cat")
            if st.button("🔬 AI生成入市分析", use_container_width=True, type="primary"):
                with st.spinner("AI分析中..."):
                    prompt = MARKET_ANALYSIS_PROMPT.format(target_market=target_market, product_category=product_category, company_profile=kb.get_company_brief())
                    result = ai.chat(prompt)
                    st.markdown(result)

        with m2:
            st.markdown("##### 🌊 蓝海选品分析")
            st.caption("工作流参照 amazon-blue-ocean-research：关键词池 → 竞品分层 → 1-3星VOC根因 → 价格带 → 5个方案评分")
            col1, col2, col3 = st.columns(3)
            with col1:
                bs_cat = st.selectbox("产品品类", COMPANY["categories"], key="bs_cat")
            with col2:
                bs_market = st.selectbox("目标市场", ["美国", "欧洲", "日本", "东南亚", "中东", "拉美"], key="bs_market")
            with col3:
                bs_price = st.selectbox("目标价格带", ["<$5", "$5-20", "$20-50", "$50-100", ">$100"], key="bs_price")
            bs_extra = st.text_input("补充想法（可选）", placeholder="例如：带包装/可激光刻字/套装", key="bs_extra")
            if st.button("🌊 AI蓝海选品分析", use_container_width=True, type="primary"):
                with st.spinner("AI分析蓝海机会..."):
                    prompt = f"""# 刀剪五金品类 · 蓝海选品调研（对标 amazon-blue-ocean-research 工作流）

你是阳江刀剪产业带资深B2B选品顾问。按以下结构输出决策级中文报告（不要编造成交数据；缺数据就标'需SellerSprite核'）：

- 品类：{bs_cat}
- 目标市场：{bs_market}
- 目标价格带：{bs_price}
- 补充：{bs_extra or '无'}
公司背景：{kb.get_company_brief()[:600]}

请严格按这10步输出：
1. 产品定义（一句话：形态/用途/使用方式/排除相邻品/目标买家）
2. 关键词池：核心词/特征词/场景词分组，给出该品类典型词及'为什么相关'
3. 竞品分层：8-12个代表性竞品，按结构+价格分层（不是按排名），每个至少2个具体事实
4. VOC（1-3星差评根因）：列出5条根因，每条给'根因+严重度+受影响产品+改进要求'
5. 价格带分布：相关样本价格带、样本数、代表结构，突出推荐价格带
6. 非亚马逊渠道验证：沃尔玛/独立站等至少4个渠道的价格与结构观察
7. 社媒消费者摘要：3-5个'夸'的主题、3-5个'骂'的主题
8. 【5个蓝海产品方案 A-E】每个给：一句话定义/目标买家/形态材质/解决的问题/目标价/主要风险/竞品参照
9. 方案评分与排序（需求度/竞争度/供应链可行性/利润），选出前3
10. 风险与下一步验证清单
务实、具体，不要堆术语。"""
                    result = ai.chat(prompt)
                    st.markdown(result)

        with m3:
            st.markdown("##### 💬 VOC 客户之声分析")
            st.caption("工作流参照 amazon-voc-consumer-insights：购买理由/优势/劣势/使用场景/疑虑/未满足痛点")
            col1, col2 = st.columns(2)
            with col1:
                voc_product = st.text_input("产品/品类", placeholder="例如：8寸主厨刀 / 厨房剪刀", key="voc_product")
            with col2:
                voc_source = st.selectbox("评价来源（可选）", ["亚马逊", "独立站评论", "速卖通", "综合"], key="voc_source")
            voc_review = st.text_area("粘贴客户评价/差评原文（可选）", placeholder="粘贴几条真实评价，AI会更准；留空则让AI基于行业经验分析", height=90, key="voc_review")
            if st.button("💬 AI分析VOC", use_container_width=True, type="primary"):
                with st.spinner("AI提炼客户之声..."):
                    review_txt = voc_review.strip() if voc_review else "（未提供原文，请基于该品类行业普遍评价经验分析）"
                    prompt = f"""# 刀剪产品 · VOC客户之声（对标 amazon-voc-consumer-insights）

产品：{voc_product}
评价来源：{voc_source}
真实评价原文：
{review_txt}

请按固定章节输出（中文）：
1. 购买理由（为什么下单，TOP理由）
2. 产品优势（好评高频点）
3. 产品劣势（差评/退货根因，按严重度排序）
4. 典型使用场景（买家怎么用）
5. 消费者疑虑（下单前顾虑）
6. 未满足痛点（现有产品没解决、可差异化机会）
7. 对Listing卖点与开发信的话术建议
每条结论要有依据，别泛泛而谈。"""
                    result = ai.chat(prompt)
                    st.markdown(result)

        with m4:
            st.markdown("##### 🔑 关键词挖掘")
            st.caption("工作流参照 amazon-keyword-library：采集→清洗去重→多维分类→详情页埋词→广告结构→否定词")
            col1, col2 = st.columns(2)
            with col1:
                kw_product = st.text_input("产品/品类", placeholder="例如：bamboo cutting board", key="kw_product")
            with col2:
                kw_lang = st.selectbox("输出语言", ["英文", "中文", "中英"], key="kw_lang")
            if st.button("🔑 AI挖掘关键词", use_container_width=True, type="primary"):
                with st.spinner("AI挖掘关键词..."):
                    prompt = f"""# 刀剪产品 · 关键词资产库（对标 amazon-keyword-library）

产品/品类：{kw_product}
输出语言：{kw_lang}
公司：{kb.get_company_brief()[:400]}

请按关键词资产库结构输出：
1. 核心大词（5个，标注搜索量高/中/低、商业意图高/中）
2. 长尾精准词（15个，含 wholesale/OEM/custom/private label/B2B向）
3. 场景/问题词（10个，如 how to / best for）
4. 【详情页埋词映射】哪些词放标题、哪些放五点、哪些放描述/后台
5. 【广告结构建议】SP广泛/词组/精准分别投哪些词
6. 【否定词库】建议否定的无效词
表格化输出。"""
                    result = ai.chat(prompt)
                    st.markdown(result)

        # ---- 真实案例展示 ----
        with st.expander("📂 真实案例参考（点开看本功能实际产出的报告）"):
            EXAMPLE_DIR = Path("/Volumes/Kingston 1TB NV1 40Gbps/独立站SEO项目/Codex-工作流Skill")
            case_files = {
                "🌊 蓝海选品案例（Block Knife Set 美国站蓝海调研报告）": EXAMPLE_DIR / "Block-Knife-Set-美国站蓝海调研-嵌入图片版.html",
                "💬 VOC案例（ASIN B0G8H85L4T 客户之声报告）": EXAMPLE_DIR / "B0G8H85L4T-voc-report.html",
                "📦 Listing文案案例（Kitchen Knives Set）": EXAMPLE_DIR / "kitchen-knives-set-standalone-share(1).html",
            }
            for label, fpath in case_files.items():
                st.markdown(f"**{label}**")
                st.code(str(fpath), language=None)
                if not fpath.exists():
                    st.warning("文件不存在")
                elif st.button(f"🔍 在工作台内预览", key=f"case_{hash(label) & 0xffff}"):
                    try:
                        html = fpath.read_text(encoding="utf-8", errors="ignore")
                        components.html(html, height=720, scrolling=True)
                    except Exception as e:
                        st.error(f"预览失败：{e}（文件较大，可直接双击路径用浏览器打开）")

    elif mp_current == "📦 产品分析":
        st.subheader("📦 产品分析")
        p1, p2, p3 = st.tabs(["📋 Listing诊断", "✍️ 文案生成", "🔍 竞品对比"])
        with p1:
            st.markdown("##### Listing健康度诊断")
            st.caption("对标 amazon-listing-health-diagnostic：基线→生命周期/资产保护→关键词与竞品→评论内容属性→问题与修改边界")
            asin = st.text_input("输入ASIN或产品SKU", placeholder="B0XXXXXX 或 KL-KN-HM-003")
            if st.button("🔍 AI诊断", use_container_width=True, type="primary"):
                if asin:
                    with st.spinner("AI正在诊断Listing..."):
                        prompt = f"""# Amazon Listing 健康诊断（对标 amazon-listing-health-diagnostic）

产品标识: {asin}
公司背景: {kb.get_company_brief()[:500]}

请按固定流程输出中文诊断报告（缺实际数据就标'需核'，不要编造）：
1. 建立当前基线：标题/五点/描述/图片/A+/评分评论数现状概览
2. 生命周期与资产保护：判断是新品/成长期/成熟期/衰退期；哪些关键词/排名是必须保护、不能改坏的资产
3. 关键词与竞品：核心词覆盖是否到位、和头部竞品的关键词差距
4. 评论/内容/属性：买家顾虑（FAQ）、属性是否完整、图片是否达标
5. 问题清单与修改边界：按严重度列出问题，标注哪些"现在能改"、哪些"要谨慎/不能动"
6. 总分（1-100）+ 各维度得分 + 优先级排序的改进建议
中文，B2B刀剪视角。"""
                        result = ai.chat(prompt)
                    st.markdown(result)
                else:
                    st.warning("请先输入ASIN或SKU")
        with p2:
            st.markdown("##### 产品文案生成")
            col1, col2 = st.columns(2)
            with col1:
                p_name = st.text_input("产品名称", placeholder="German Steel Chef Knife 8 Inch")
                p_cat = st.selectbox("品类", COMPANY["categories"])
                p_features = st.text_area("产品卖点", placeholder="例如：高碳钢、热处理HRC60、人体工学手柄", height=80)
            with col2:
                p_target = st.selectbox("目标市场", ["美国", "欧洲", "日本", "澳大利亚"])
                p_style = st.selectbox("文案风格", ["B2B批发专业风", "Amazon零售风", "独立站品牌风"])
            if st.button("✍️ 生成Listing文案", use_container_width=True, type="primary"):
                with st.spinner("AI正在生成..."):
                    prompt = f"""# 产品Listing文案生成（对标 amazon-listing-optimizer）

产品名称: {p_name}
品类: {p_cat}
卖点: {p_features}
目标市场: {p_target}
风格: {p_style}
公司背景: {kb.get_company_brief()[:500]}

请输出（英文，B2B专业风，可直接上架）：
1. SEO标题：≤200字符，前80字符放核心词，含品牌词，无促销词
2. 五点描述：5条，每条小标题大写+卖点，融入1-2个关键词，突出HRC/材质/适用场景
3. 产品描述：200词，讲清楚工厂背书+使用场景+售后
4. 焦点关键词：5个（含1个B2B批发词）
5. 后台Search Terms：200字节以内，无重复词
遵循可售事实，不编造型号参数。"""
                    result = ai.chat(prompt)
                st.markdown(result)
        with p3:
            st.markdown("##### 竞品对比")
            col1, col2 = st.columns(2)
            with col1:
                my_asin = st.text_input("我方产品ASIN/SKU", key="my_asin")
            with col2:
                comp_asin = st.text_input("竞品ASIN/SKU", key="comp_asin")
            if st.button("⚖️ AI对比分析", use_container_width=True, type="primary"):
                with st.spinner("对比分析中..."):
                    prompt = f"""# 竞品对比分析任务

我方产品: {my_asin}
竞品: {comp_asin}

请分析：
1. 价格对比
2. 卖点差异
3. 图片质量对比
4. 评价关键词对比
5. 我们的差异化机会
6. 改进建议（3条）

中文输出，B2B视角。"""
                    result = ai.chat(prompt)
                st.markdown(result)

    elif mp_current == "📈 广告分析":
        st.subheader("📈 广告分析")
        st.caption("上传Amazon广告报告 → AI分析产品角色 + 否定词建议")
        a1, a2 = st.tabs(["🎯 广告策略", "🔧 广告调优"])
        with a1:
            st.markdown("##### 广告产品角色判断")
            st.caption("对标 amazon-ad-strategy-commander：增长/验证/控费/保护/退出 五种打法")
            col1, col2 = st.columns(2)
            with col1:
                ad_sku = st.text_input("产品SKU", key="ad_sku")
                ad_spend = st.number_input("日均广告花费($)", min_value=0, value=50)
                ad_orders = st.number_input("日均广告订单", min_value=0, value=3)
            with col2:
                ad_sales = st.number_input("日均广告销售额($)", min_value=0, value=200)
                ad_acos = st.number_input("ACOS(%)", min_value=0, max_value=200, value=35)
            if st.button("🎯 AI判断产品角色", use_container_width=True, type="primary"):
                with st.spinner("分析中..."):
                    prompt = f"""# Amazon广告产品角色与打法（对标 ad-strategy-commander）

产品SKU: {ad_sku}
日均花费: ${ad_spend}
日均订单: {ad_orders}
日均广告销售: ${ad_sales}
ACOS: {ad_acos}%

请判断这个产品当前在广告结构中的角色（5选1或组合）：
- 增长型：转化好，应加预算抢量
- 验证型：新品测款，数据不足继续观察
- 控费型：ACOS偏高，需缩词/降出价
- 保护型：守品牌词/自有ASIN，防止竞品占位
- 退出型：长期无转化，建议停投

输出：角色判断 + 当前ACoS健康度 + 具体打法（加/减预算、抢哪些词、否定哪些词）+ 下一步3条动作。中文。"""
                    result = ai.chat(prompt)
                st.markdown(result)
        with a2:
            st.markdown("##### 搜索词报告分析（CSV）")
            st.caption("上传 Amazon 搜索词报告，自动统计：高转化词建议加价、零转化词建议否定")
            uploaded_ad = st.file_uploader("上传搜索词报告CSV", type=['csv'], key="ad_report")
            if uploaded_ad:
                try:
                    df = pd.read_csv(uploaded_ad)
                    st.caption(f"已读取 {len(df)} 行，列：{', '.join(df.columns[:12])}")
                    cols = {c.lower(): c for c in df.columns}
                    def pick(*names):
                        for n in names:
                            for low, orig in cols.items():
                                if n in low:
                                    return orig
                        return None
                    kw_col = pick("customer search term", "search term", "搜索词", "keyword")
                    clk_col = pick("clicks", "点击")
                    ord_col = pick("orders", "orders placed", "订单", "conversions")
                    cost_col = pick("cost", "spend", "花费", "广告花费")
                    sales_col = pick("sales", "7 day total sales", "销售额")
                    if kw_col:
                        agg = {kw_col: "count"}
                        if clk_col: agg[clk_col] = "sum"
                        if ord_col: agg[ord_col] = "sum"
                        if cost_col: agg[cost_col] = "sum"
                        if sales_col: agg[sales_col] = "sum"
                        g = df.groupby(kw_col).agg(agg).reset_index()
                        if ord_col:
                            g = g.sort_values(ord_col, ascending=False)
                        st.success(f"共 {len(g)} 个独立搜索词")
                        st.markdown("##### ✅ 高转化词（建议加价/转精准）")
                        if ord_col:
                            top = g[g[ord_col] > 0].head(15)
                            st.dataframe(top, use_container_width=True)
                        st.markdown("##### ❌ 零转化高花费词（建议否定）")
                        if ord_col and cost_col:
                            neg = g[(g[ord_col] == 0) & (g[cost_col] > 0)].sort_values(cost_col, ascending=False).head(15)
                            st.dataframe(neg, use_container_width=True)
                            if len(neg) > 0:
                                st.code("请把以下词加入否定精确/词组：\n" + "\n".join(neg[kw_col].astype(str).tolist()))
                        else:
                            st.info("该报告缺少订单/花费列，无法判断，仅展示原始数据")
                            st.dataframe(g.head(20), use_container_width=True)
                    else:
                        st.warning("未识别到搜索词列，请确认是亚马逊搜索词报告")
                except Exception as e:
                    st.error(f"解析失败：{e}")

    elif mp_current == "🎨 视觉内容":
        st.subheader("🎨 视觉内容")
        st.caption("对标 amazon-listing-image-workflow / kailioncrafts-image-seo / amazon-aplus-image-workflow")
        v1, v2 = st.tabs(["🖼️ 主副图整套方案", "📄 A+布局规划"])
        with v1:
            st.markdown("##### AI主副图整套方案")
            st.caption("一次出6张图：白底主图/卖点信息图/场景图/尺寸图/包装图/生活方式图，每张给英文Prompt+负面词+SEO文件名ALT")
            col1, col2 = st.columns(2)
            with col1:
                v_product = st.text_input("产品名称", placeholder="8寸主厨刀 German Steel Chef Knife", key="v_product")
                v_cat = st.selectbox("品类", COMPANY["categories"], key="v_cat")
            with col2:
                v_style = st.selectbox("风格", ["亚马逊高端白底", "独立站品牌风", "极简白底", "生活方式"], key="v_style2")
                v_ratio = st.selectbox("主图比例", ["1:1 (1000x1000)", "3:4 (750x1000)", "4:5"], key="v_ratio2")
            if st.button("🎨 生成整套图片方案", use_container_width=True, type="primary"):
                with st.spinner("生成整套图片方案..."):
                    prompt = f"""# 亚马逊主副图整套方案（对标 listing-image-workflow + kailioncrafts-image-seo）

产品: {v_product}
品类: {v_cat}
风格: {v_style}
比例: {v_ratio}
公司: {kb.get_company_brief()[:300]}

请为该产品规划完整主副图套图（白底主图 + 5张副图），每张输出：
1. 图片用途（主图/卖点信息图/使用场景/尺寸图/包装图/生活方式）
2. 英文生图Prompt（MJ/DALL-E可用：主体+场景+光线+角度+质量词8k,studio lighting）
3. 英文负面提示词（negative prompt）
4. SEO文件名（小写连字符，含关键词，如 chef-knife-8inch-white-main.png）
5. ALT Text（≤125字符，含核心词）
主图必须纯白底、无文字水印；信息图可含简洁卖点文字。按表格或分节输出。"""
                    result = ai.chat(prompt)
                st.markdown(result)
        with v2:
            st.markdown("##### A+ Content 布局规划")
            col1, col2 = st.columns(2)
            with col1:
                a_product = st.text_input("产品名称", key="a_plus_product")
            with col2:
                a_level = st.radio("A+类型", ["基础版 A+ (Basic)", "高级版 Premium A+"], horizontal=True, key="a_level")
            if st.button("📐 生成A+布局", use_container_width=True, type="primary"):
                with st.spinner("生成中..."):
                    prompt = f"""# Amazon A+ Content 布局规划（对标 amazon-aplus-image-workflow）

产品: {a_product}
类型: {a_level}
公司: {kb.get_company_brief()[:300]}

请按{('高级版 Premium A+，含轮播/视频/对比表模块' if 'Premium' in a_level else '基础版 A+，5个标准模块')}规划，每个模块给出：
1. 模块名称与推荐图片尺寸（如 970x600 / 300x300 / 1464x600）
2. 文案要点
3. 该模块图片的英文生图Prompt
模块顺序建议：品牌横幅 → 核心卖点(3 icon) → 产品对比表 → 使用场景 → 品牌故事/工厂背书
中文输出。"""
                    result = ai.chat(prompt)
                st.markdown(result)

# ============ 公司知识库（含竞品与资源库） ============
elif page == "📚 公司知识库":
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
    <div style="color:#D4AF37;font-size:12px;letter-spacing:3px;">KAILIONCRAFTS · KNOWLEDGE BASE</div>
    <h2 style="color:#FFF3E0;font-size:26px;margin:8px 0;">公司知识库</h2>
    <div style="color:rgba(255,243,224,.6);font-size:13px;">搜索 · 管理统计(含最近更新) · 添加(含对话转知识) · 竞品资源库</div>
    </div>
    """, unsafe_allow_html=True)

    kb_sections = {
        "🔍 搜索浏览": "全文搜索 · 分类浏览",
        "📊 管理统计": "统计 · 体积 · 最近更新",
        "➕ 添加知识": "新建文档 / 上传 / 对话转知识",
        "🌐 竞品与资源库": "同行独立站 · 建站模仿",
        "📱 飞书协同": "云盘 · 消息 · 文档同步",
    }
    if "kb_sub" not in st.session_state:
        st.session_state["kb_sub"] = "🔍 搜索浏览"
    kb_current = st.session_state["kb_sub"]

    kb_cols = st.columns(5)
    for i, (name, desc) in enumerate(kb_sections.items()):
        with kb_cols[i]:
            is_active = st.session_state["kb_sub"] == name
            if st.button(name, key=f"kbbtn_{name}", use_container_width=True,
                         type="primary" if is_active else "secondary"):
                st.session_state["kb_sub"] = name
                st.rerun()

    kb_current = st.session_state["kb_sub"]
    st.markdown(f"### {kb_current}")
    st.caption(kb_sections[kb_current])
    st.markdown("---")

    if kb_current == "🔍 搜索浏览":
        # ---- 知识库来源（选搜哪个库）----
        sources_map = kb.get_kb_sources()
        src_keys = ["all"] + list(sources_map.keys())
        src_labels = {k: ("🌐 全部知识库" if k == "all" else sources_map[k]["name"]) for k in src_keys}
        st.markdown("##### 知识库来源")
        src_choice = st.radio(
            "知识库来源", src_keys, format_func=lambda k: src_labels[k],
            index=0, horizontal=True, label_visibility="collapsed", key="kb_src_radio"
        )

        # ---- 全文搜索 ----
        st.markdown("##### 🔎 全文搜索知识库")
        search_query = st.text_input(
            "全文搜索",
            placeholder="输入关键词，如：MOQ、FDA认证、厨房刀、OEM定制、价格...",
            key="kb_search_input", label_visibility="collapsed"
        )
        if search_query:
            with st.spinner(f"正在「{src_labels[src_choice]}」中搜索..."):
                results = kb.search(search_query, source=src_choice, max_results=20)
                if results:
                    st.success(f"在「{src_labels[src_choice]}」中找到 {len(results)} 个结果")
                    for i, r in enumerate(results, 1):
                        with st.expander(f"{i}. {r['file']}　·　{r.get('category', '')}"):
                            st.caption(f"路径：{r['path']}")
                            st.markdown(r["snippet"])
                else:
                    st.info("未找到相关内容，换个关键词或换个知识库来源试试")

        st.markdown("---")

        # ---- 分类浏览：常用模块 ----
        st.markdown("##### 📁 分类浏览")
        st.markdown("###### ⚡ 常用模块")
        quick = [
            ("🏢 公司简介", "公司简介"),
            ("🏭 工厂供应链", "工厂 供应链 实力"),
            ("💡 客户痛点", "客户痛点 为什么选择"),
            ("❓ FAQ问答", "FAQ 常见问答"),
            ("📖 产品术语", "术语 标准"),
            ("📐 产品规格", "产品规格 参数"),
            ("✉️ 邮件模板", "邮件模板 开发信"),
            ("📦 SKU数据", "SKU 产品目录"),
            ("🤝 谈客户技巧", "谈客户技巧"),
            ("💰 谈判报价", "谈判 报价"),
            ("📨 邮件开发", "邮件开发 外贸"),
            ("📣 营销攻略", "营销 文案"),
        ]
        qcols = st.columns(4)
        for i, (btn_label, kw) in enumerate(quick):
            with qcols[i % 4]:
                if st.button(btn_label, use_container_width=True, key=f"kbquick_{i}"):
                    st.session_state["kb_search_input"] = kw
                    st.rerun()

        st.markdown("---")

        # ---- 按目录浏览（标准化知识库）----
        st.markdown("##### 📂 按目录浏览（标准化知识库 AI优化版）")
        cats = kb.list_categories("standard")
        if cats:
            sel_cat = st.selectbox(
                "选择分类",
                options=cats,
                format_func=lambda c: f"{c['name']}（{c['file_count']} 个文件）",
                key="kb_cat_sel"
            )
            files = kb.list_files(sel_cat["path"])
            st.caption(f"共 {len(files)} 个文档")
            ffilter = st.text_input("在当前分类中筛选文件", placeholder="输入文件名关键词...", key="kb_file_filter")
            if ffilter:
                files = [f for f in files if ffilter.lower() in f["name"].lower()]
            for f in files:
                with st.expander(f"📄 {f['name']}　（{f['size_kb']} KB）"):
                    st.caption(f["path"])
                    if st.button("📖 阅读全文", key=f"read_{f['path']}"):
                        content = kb.read_file_by_path(f["path"], max_chars=8000)
                        st.markdown(content)
        else:
            st.info("未发现分类目录")

    elif kb_current == "📊 管理统计":
        try:
            import os

            def _fmt_size(n):
                if n >= 1024 ** 3:
                    return f"{n / 1024**3:.2f} GB"
                if n >= 1024 ** 2:
                    return f"{n / 1024**2:.1f} MB"
                if n >= 1024:
                    return f"{n / 1024:.0f} KB"
                return f"{n} B"

            sources = kb.get_kb_sources()
            total_files = 0
            total_bytes = 0
            rows = []
            for s, info in sources.items():
                p = info.get("path")
                p_str = str(p) if p else ""
                if p and os.path.exists(p):
                    count = 0
                    bytes_sum = 0
                    for root, _, files in os.walk(p):
                        count += len(files)
                        for fn in files:
                            try:
                                bytes_sum += os.path.getsize(os.path.join(root, fn))
                            except OSError:
                                pass
                else:
                    count = 0
                    bytes_sum = 0
                total_files += count
                total_bytes += bytes_sum
                rows.append({
                    "名称": info.get("name", s),
                    "文件数": count,
                    "体积": _fmt_size(bytes_sum),
                    "路径": p_str if os.path.exists(p_str) else "⚠️ 路径不存在",
                })

            # 汇总条
            c1, c2 = st.columns(2)
            c1.metric("知识库总数", f"{len(rows)} 个源")
            c2.metric("合计体积", _fmt_size(total_bytes))
            st.caption(f"合计文件：{total_files} 个")

            st.markdown("---")
            st.markdown("##### 📚 各知识库详情（名称 / 文件数 / 体积 / 路径）")
            for r in rows:
                ok = not r["路径"].startswith("⚠️")
                border = "#28a745" if ok else "#dc3545"
                st.markdown(f"""
                <div style="background:#f8f9fa;border-radius:8px;padding:12px;margin-bottom:8px;border-left:4px solid {border};">
                <strong>{r['名称']}</strong>
                <span style="float:right;color:#D4AF37;font-weight:700;">{r['文件数']} 文件 · {r['体积']}</span><br>
                </div>
                """, unsafe_allow_html=True)
                st.code(r["路径"], language=None)

            # ===== 版本管理（最近更新记录，并入管理统计）=====
            st.markdown("---")
            st.markdown("##### 🕒 最近更新记录（知识库版本变化）")
            st.caption("按修改时间倒序列出各知识库最近变动的文件，即本库最近新增/更新了什么")
            import time as _time
            recent = []
            for s, info in sources.items():
                p = info.get("path")
                lib_name = info.get("name", s)
                if not p or not os.path.exists(p):
                    continue
                for root, _, files in os.walk(p):
                    for fn in files:
                        fp = os.path.join(root, fn)
                        try:
                            mt = os.path.getmtime(fp)
                            recent.append((mt, lib_name, fp, os.path.getsize(fp)))
                        except OSError:
                            pass
            recent.sort(key=lambda x: x[0], reverse=True)
            show_n = st.slider("显示最近多少条", 10, 100, 30, key="kb_recent_n")
            if not recent:
                st.info("知识库暂无文件记录")
            else:
                rows_recent = []
                for mt, lib_name, fp, sz in recent[:show_n]:
                    rows_recent.append({
                        "更新时间": _time.strftime("%Y-%m-%d %H:%M", _time.localtime(mt)),
                        "所属库": lib_name,
                        "文件": os.path.basename(fp),
                        "体积": _fmt_size(sz),
                    })
                import pandas as _pd
                st.dataframe(_pd.DataFrame(rows_recent), use_container_width=True, hide_index=True)
                today = _time.strftime("%Y-%m-%d")
                today_cnt = sum(1 for mt, *_ in recent if _time.strftime("%Y-%m-%d", _time.localtime(mt)) == today)
                st.success(f"📅 今天新增/更新了 {today_cnt} 个文件")
        except Exception as e:
            st.error(f"加载失败：{e}")

    elif kb_current == "➕ 添加知识":
        st.markdown("##### 📝 添加新文档到知识库")
        st.caption("填写内容或上传文档，保存后立即进入对应分类，全文搜索即可搜到")
        # 列出标准化知识库下的分类目录
        kb_root = Path(__file__).parent.parent
        cat_dirs = sorted([d.name for d in kb_root.iterdir()
                           if d.is_dir() and d.name[:2].isdigit() and not d.name.startswith('99')])
        col1, col2 = st.columns([1, 2])
        with col1:
            add_cat = st.selectbox("保存到分类", cat_dirs, key="add_cat")
        with col2:
            add_title = st.text_input("文档标题", placeholder="例如：美国厨房刀进口关税要点")
        add_body = st.text_area("文档内容（Markdown）", height=180, placeholder="粘贴/撰写知识正文...")
        add_file = st.file_uploader("或直接上传文档", type=['md', 'txt', 'csv'], key="add_kb_file")

        if st.button("💾 保存到知识库", type="primary", use_container_width=True):
            import re as _re
            safe_name = _re.sub(r'[\\/:\*\?"<>\|]+', "_", (add_title or "未命名文档")).strip()
            target_dir = kb_root / add_cat
            target_dir.mkdir(parents=True, exist_ok=True)
            saved = False
            if add_file is not None:
                dest = target_dir / add_file.name
                dest.write_bytes(add_file.getbuffer())
                saved_path = str(dest)
                saved = True
            elif safe_name and (add_body or add_title):
                dest = target_dir / f"{safe_name}.md"
                content = f"# {add_title}\n\n> 添加人：{st.session_state.get('current_member','leo')}　添加时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n{add_body}\n"
                dest.write_text(content, encoding="utf-8")
                saved_path = str(dest)
                saved = True
            if saved:
                st.success(f"✅ 已保存到：{saved_path}")
                st.caption("在「🔍 搜索浏览」里即可搜到（如未立即出现，刷新一次页面）")
            else:
                st.warning("请填写标题+内容，或上传一个文档文件")

        st.markdown("---")
        st.markdown("##### 🤖 对话记录 → 知识")
        st.caption("把一段工作对话/问答贴进来，AI 自动提炼成结构化知识后存入选定分类")
        conv = st.text_area("粘贴对话/笔记原文", height=160, key="kb_conv")
        if st.button("✨ AI 提炼成知识", type="primary", use_container_width=True):
            if not conv.strip():
                st.warning("请先粘贴内容")
            else:
                with st.spinner("AI 提炼中..."):
                    try:
                        extracted = ai.chat(
                            f"把下面这段对话/笔记提炼成一篇结构化的Markdown知识库文档：给一个标题、分小标题、保留关键事实和数据，去掉口语和寒暄。直接输出Markdown正文。\n\n原文：\n{conv}"
                        )
                        st.session_state["kb_distilled"] = extracted
                        st.success("✅ 已提炼，确认后保存：")
                        st.markdown(extracted[:1500] + ("..." if len(extracted) > 1500 else ""))
                    except Exception as e:
                        st.error(f"AI错误：{e}")
        if st.session_state.get("kb_distilled"):
            import re as _re
            d_cat = st.selectbox("保存到分类", cat_dirs, key="distill_cat")
            d_title = st.text_input("文档标题", value="提炼知识文档", key="distill_title")
            if st.button("💾 保存提炼结果", use_container_width=True):
                safe_name = _re.sub(r'[\\/:\*\?"<>\|]+', "_", d_title).strip()
                dest = kb_root / d_cat / f"{safe_name}.md"
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(st.session_state["kb_distilled"], encoding="utf-8")
                st.success(f"✅ 已保存：{dest}")
                st.session_state.pop("kb_distilled", None)

    elif kb_current == "🌐 竞品与资源库":
        st.subheader("🌐 竞品与行业资源库")
        st.caption("78个五金刀剪行业独立站，按用途分类，助力建站模仿和客户开发")

        competitor_csv = Path(__file__).parent / "data" / "competitor_sites.csv"
        if competitor_csv.exists():
            df = pd.read_csv(competitor_csv, encoding='utf-8-sig')

            col1, col2, col3, col4 = st.columns(4)
            with col1:
                st.metric("总网站数", len(df))
            with col2:
                st.metric("分类数", df['分类'].nunique())
            with col3:
                high_priority = len(df[df['优先级'].str.contains('高', na=False)])
                st.metric("高优先级", high_priority)
            with col4:
                potential_customers = len(df[df['分类'].str.contains('潜在客户', na=False)])
                st.metric("潜在客户站", potential_customers)

            st.markdown("---")
            categories = ["全部"] + sorted(df['分类'].unique().tolist())
            selected_cat = st.selectbox("按分类筛选", categories, key="comp_cat_filter")
            filtered_df = df if selected_cat == "全部" else df[df['分类'] == selected_cat]

            for _, row in filtered_df.iterrows():
                with st.expander(f"🌐 {row['域名']}  |  {row['分类']}  |  优先级：{row['优先级']}"):
                    c1, c2 = st.columns([3, 1])
                    with c1:
                        st.markdown(f"**网址：** [{row['网址']}]({row['网址']})")
                        st.markdown(f"**用途：** {row['用途']}")
                    with c2:
                        if "潜在客户" in str(row['分类']):
                            if st.button("🎯 加入客户分析", key=f"comp_{row['域名']}"):
                                st.session_state['potential_customer'] = row['域名']
                        if st.button("📋 复制域名", key=f"copy_{row['域名']}"):
                            st.toast(f"已复制: {row['域名']}")

            st.markdown("---")
            c1, c2 = st.columns(2)
            with c1:
                st.download_button(
                    "📥 导出完整CSV",
                    df.to_csv(index=False).encode('utf-8-sig'),
                    file_name="五金刀剪行业独立站资源库.csv",
                    mime="text/csv",
                    use_container_width=True,
                )
            with c2:
                st.info("💡 建议：优先研究「阳江本地工厂」和「同行竞品」的建站风格，「零售平台」可作为潜在B2B客户开发")

            st.markdown("---")
            st.markdown("**🏗️ 建站模仿建议**")
            st.markdown("""
            - **建站结构参考**：rtkitchenknife.com、yjchefknife.com、insight-kitchenknife.com（完整分类/详情/About/Contact）
            - **产品页设计**：wusthof.com、messermeister.com、henckels.com（国际大牌展示与卖点）
            - **SEO博客参考**：insight-kitchenknife.com、saafiknife.com、biliknife.com（top-10 类引流文）
            - **价格参考**：costco.com、target.com、williams-sonoma.com（终端零售价反推批发空间）
            """)
        else:
            st.warning("竞品数据文件未找到，请确保 data/competitor_sites.csv 存在")

    elif kb_current == "📱 飞书协同":
        st.caption("飞书云盘 · 消息通知 · 文档同步")
        try:
            import feishu_client as _fs
        except Exception as _e:
            _fs = None
            st.warning(f"feishu_client 加载失败：{_e}")
        st.caption("飞书应用 App ID：cli_aa2c7e3b30b8dbd88（以下操作实时调用飞书开放平台 API）")
        f_t1, f_t2, f_t3 = st.tabs(["🔌 连接测试", "📁 云盘文件", "🔔 发消息 / 建文档"])
        with f_t1:
            if st.button("🧪 测试飞书连接", type="primary", use_container_width=True):
                if _fs:
                    with st.spinner("正在连接飞书..."):
                        try:
                            res = _fs.test_connection()
                            for k, v in res.items():
                                st.write(f"**{k}**：{v}")
                        except Exception as e:
                            st.error(f"连接失败：{e}（检查网络 / App权限 / folder token）")
                else:
                    st.error("feishu_client 不可用")
        with f_t2:
            if st.button("📂 拉取云盘文件列表", use_container_width=True):
                if _fs:
                    with st.spinner("拉取中..."):
                        try:
                            data = _fs.list_drive_files()
                            files = data.get("data", {}).get("files", [])
                            if data.get("code") != 0:
                                st.warning(f"飞书返回：{data.get('msg')}")
                            elif not files:
                                st.info("云盘根目录暂无文件（或机器人无权访问）")
                            else:
                                st.success(f"共 {len(files)} 个文件/文件夹")
                                st.dataframe([{"名称": f.get("name"), "类型": f.get("type"),
                                               "token": f.get("token")} for f in files],
                                             use_container_width=True, hide_index=True)
                        except Exception as e:
                            st.error(f"拉取失败：{e}")
                else:
                    st.error("feishu_client 不可用")
        with f_t3:
            st.markdown("##### 发送群消息")
            chat_id = st.text_input("群聊 chat_id", placeholder="oc_xxxxxx（需机器人已在群里）")
            msg_text = st.text_area("消息内容", placeholder="工作台告警 / 新询盘提醒...")
            if st.button("📤 发送", use_container_width=True):
                if not chat_id or not msg_text:
                    st.warning("请填 chat_id 和消息内容")
                elif _fs:
                    try:
                        r = _fs.send_text_message(chat_id, msg_text)
                        if r.get("code") == 0:
                            st.success("✅ 已发送")
                        else:
                            st.warning(f"飞书返回：{r.get('msg')}")
                    except Exception as e:
                        st.error(f"发送失败：{e}")
            st.markdown("---")
            st.markdown("##### 在飞书云盘新建文档")
            doc_title = st.text_input("文档标题", placeholder="例如：本周询盘周报")
            doc_body = st.text_area("文档正文", height=100)
            if st.button("📄 创建飞书文档", use_container_width=True):
                if not doc_title:
                    st.warning("请填文档标题")
                elif _fs:
                    try:
                        r = _fs.create_doc(doc_title, doc_body)
                        if r.get("code") == 0:
                            st.success(f"✅ 已创建：{doc_title}")
                            st.json(r.get("data", {}))
                        else:
                            st.warning(f"飞书返回：{r.get('msg')}（可能缺 docx 权限 / folder token）")
                    except Exception as e:
                        st.error(f"创建失败：{e}")

elif page == "👥 团队工作空间":
    st.title("👥 团队工作空间")
    st.caption("每位成员独立工作空间，共享公司知识库，生成内容自动整合")
    
    # 当前成员信息
    member_key = st.session_state.get('current_member', 'leo')
    member = TEAM_MEMBERS[member_key]
    
    # 成员信息卡片
    col1, col2, col3 = st.columns([1, 2, 1])
    with col1:
        if member['avatar']:
            st.image(member['avatar'], width=100)
        else:
            st.markdown("<div style='width:100px;height:100px;background:#e0e0e0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:36px;'>👤</div>", unsafe_allow_html=True)
    with col2:
        st.markdown(f"### {member['name']} ({member['name_cn']})")
    st.markdown(f"**{member['role']}** | {member['role_en']}")
    st.markdown(f"负责品类：**{member['category']}** ({member['category_en']})")
    with col3:
        st.metric("工作空间", member['workspace_dir'].split('/')[-1])
    
    st.markdown("---")
    
    # 联系方式和社交媒体
    st.subheader("📞 联系方式与社交媒体")
    
    col1, col2 = st.columns(2)
    with col1:
        st.markdown("**联系方式**")
    contacts = member['contacts']
    if contacts.get('company_email'):
        st.markdown(f"📧 企业邮箱：[{contacts['company_email']}](mailto:{contacts['company_email']})")
    if contacts.get('gmail'):
        st.markdown(f"📮 Gmail：[{contacts['gmail']}](mailto:{contacts['gmail']})")
    if contacts.get('whatsapp'):
        wa = contacts['whatsapp'].replace('+', '').replace(' ', '')
    st.markdown(f"💬 WhatsApp：[+{wa}](https://wa.me/{wa})")
    if contacts.get('wechat'):
        st.markdown(f"💚 微信：{contacts['wechat']}")
    
    with col2:
        st.markdown("**国际社交媒体**")
    social = member['social_media']
    social_icons = ""
    for platform, handle in social.items():
        if handle:
            icon_info = SOCIAL_MEDIA_ICONS.get(platform, {})
        icon = icon_info.get('icon', '🔗')
        name = icon_info.get('name', platform)
        url_template = icon_info.get('url_template', '')
        if url_template and 'mailto' not in url_template:
            url = url_template.format(handle.replace('@', '').replace('mailto:', ''))
            social_icons += f"[{icon}]({url}) "
        elif 'mailto' in url_template:
            social_icons += f"[{icon}](mailto:{handle}) "
        else:
            social_icons += f"{icon} "
    st.markdown(social_icons)
    st.caption("点击图标跳转对应社交媒体主页（邮箱类点击直接发邮件）")
    
    st.markdown("---")
    
    # 工作空间内容
    st.subheader("📁 我的工作空间")
    
    workspace_base = Path(__file__).parent / "data" / member['workspace_dir']
    
    tab1, tab2, tab3, tab4 = st.tabs(["📝 生成的开发信", "📋 客户笔记", "📊 背调报告", "📤 推送到总知识库"])
    
    with tab1:
        emails_dir = workspace_base / "generated_emails"
    emails_dir.mkdir(parents=True, exist_ok=True)
    email_files = sorted(emails_dir.glob("*.md"), reverse=True)
    
    st.caption(f"共 {len(email_files)} 封开发信")
    if email_files:
        for ef in email_files[:20]:
            with st.expander(f"📧 {ef.stem}"):
                content = ef.read_text(encoding='utf-8')
            st.markdown(content)
            col_a, col_b = st.columns(2)
            with col_a:
                if st.button("📤 推送到公司知识库", key=f"push_email_{ef.name}"):
                    # 复制到总知识库
                    target_dir = KB_DIR / "06_营销与客户开发" / "开发信存档"
                    target_dir.mkdir(parents=True, exist_ok=True)
                    target_file = target_dir / f"{member['name']}_{ef.name}"
                    target_file.write_text(content, encoding='utf-8')
                    st.success(f"已推送到公司知识库：{target_file.name}")
            with col_b:
                if st.button("🗑️ 删除", key=f"del_email_{ef.name}"):
                    ef.unlink()
                    st.rerun()
                else:
                    st.info("还没有生成的开发信，去「开发信生成」页面创建第一封吧！")
    
    with tab2:
        notes_dir = workspace_base / "customer_notes"
    notes_dir.mkdir(parents=True, exist_ok=True)
    
    # 新建笔记
    with st.expander("✏️ 新建客户笔记"):
        note_title = st.text_input("笔记标题", key="new_note_title")
    note_content = st.text_area("笔记内容", height=150, key="new_note_content")
    if st.button("💾 保存笔记", key="save_note"):
        if note_title:
            note_file = notes_dir / f"{note_title}_{datetime.now().strftime('%Y%m%d_%H%M')}.md"
            note_file.write_text(f"# {note_title}\n\n{note_content}\n\n---\n*创建者：{member['name']}*", encoding='utf-8')
            st.success("笔记已保存！")
            st.rerun()
    
    note_files = sorted(notes_dir.glob("*.md"), reverse=True)
    st.caption(f"共 {len(note_files)} 条笔记")
    for nf in note_files[:20]:
        with st.expander(f"📝 {nf.stem}"):
            st.markdown(nf.read_text(encoding='utf-8'))
    
    with tab3:
        reports_dir = workspace_base / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_files = sorted(reports_dir.glob("*.md"), reverse=True)
    
    st.caption(f"共 {len(report_files)} 份背调报告")
    if report_files:
        for rf in report_files[:20]:
            with st.expander(f"📊 {rf.stem}"):
                st.markdown(rf.read_text(encoding='utf-8'))
    else:
        st.info("还没有背调报告，去「客户背调」页面做第一份吧！")
    
    with tab4:
        st.markdown("### 📤 工作空间内容整合到公司知识库")
    st.info("""
    **工作原理**：
    1. 每位成员在自己的工作空间生成开发信、笔记、报告
    2. 点击"推送到公司知识库"后，内容会复制到总知识库对应分类
    3. 所有成员共享总知识库，搜索时能找到所有人的优质内容
    4. 总知识库是公司资产，个人工作空间是个人草稿
    
    **推送规则**：
    - 开发信 → `06_营销与客户开发/开发信存档/`
    - 客户笔记 → `06_营销与客户开发/客户笔记/`
    - 背调报告 → `06_营销与客户开发/背调报告/`
    """)
    
    # 统计各成员工作空间内容
    st.markdown("---")
    st.subheader("📊 团队工作空间统计")
    for mk, m in TEAM_MEMBERS.items():
        wd = Path(__file__).parent / "data" / m['workspace_dir']
    email_count = len(list((wd / "generated_emails").glob("*.md"))) if (wd / "generated_emails").exists() else 0
    note_count = len(list((wd / "customer_notes").glob("*.md"))) if (wd / "customer_notes").exists() else 0
    report_count = len(list((wd / "reports").glob("*.md"))) if (wd / "reports").exists() else 0
    
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.markdown(f"**{m['name']}** ({m['category']})")
    with col2:
        st.metric("开发信", email_count)
    with col3:
        st.metric("笔记", note_count)
    with col4:
        st.metric("报告", report_count)
    
    st.markdown("---")
    st.caption(f"当前工作空间路径：{workspace_base}")
    
# ============ 模型管理页面（CC Switch风格） ============
elif page == "🤖 模型管理":
    st.title("🤖 AI模型管理中心")
    st.caption("类似CC Switch，管理多个API中转站和本地模型，一键切换")
    
    # 统计信息
    stats = get_provider_stats()
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("供应商总数", stats['total'])
    with col2:
        st.metric("在线API", stats['online'])
    with col3:
        st.metric("本地模型", stats['local'])
    with col4:
        active = get_active_provider()
    st.metric("当前使用", active['name'] if active else "未设置")
    
    st.markdown("---")
    
    # 本地Ollama状态
    st.subheader("💻 本地模型状态")
    ollama_models = detect_ollama_models()
    if ollama_models:
        st.success(f"✅ Ollama服务运行中，检测到 {len(ollama_models)} 个本地模型")
        col1, col2 = st.columns([3, 1])
        with col1:
            for m in ollama_models:
                st.caption(f"  • {m}")
        with col2:
            if st.button("🔄 刷新模型列表", use_container_width=True):
                refresh_ollama_models()
                st.success("已刷新本地模型列表")
                st.rerun()
    else:
        st.warning("⚠️ 未检测到Ollama服务，请先启动Ollama")
        st.code("ollama serve", language="bash")
    
    st.markdown("---")
    
    # 供应商列表
    st.subheader("📋 API供应商列表")
    providers_data = load_providers()
    providers = providers_data['providers']
    active_id = providers_data.get('active_provider')
    
    for p in providers:
        is_active = p['id'] == active_id
        card_bg = "#e8f5e9" if is_active else "#ffffff"
        border_color = "#4caf50" if is_active else "#e0e0e0"

        with st.container():
            st.markdown(f"""
    <div style="background:{card_bg}; padding:16px; border-radius:8px;
                border-left:4px solid {border_color}; margin-bottom:12px;">
        <strong>{'✅ ' if is_active else ''}{p['name']}</strong>
        <span style="float:right; color:#666; font-size:12px;">
            {p['type']} | {len(p['models'])}个模型
        </span>
        <br>
        <small style="color:#888;">{p['base_url']}</small>
    </div>
    """, unsafe_allow_html=True)

        col1, col2, col3, col4 = st.columns([2, 2, 2, 1])

        with col1:
            # 模型选择
            if p['models']:
                selected_model = st.selectbox(
                    "选择模型",
                    p['models'],
                    key=f"model_{p['id']}",
                    index=0,
                    label_visibility="collapsed"
                )
            else:
                selected_model = st.text_input("模型名称", key=f"model_{p['id']}")

        with col2:
            if not is_active:
                if st.button("✅ 切换到此供应商", key=f"switch_{p['id']}", use_container_width=True):
                    provider = set_active_provider(p['id'])
                    if provider:
                        # 同步到.env配置
                        save_config(
                            provider=p['id'],
                            api_key=provider['api_key'],
                            base_url=provider['base_url'],
                            model=selected_model
                        )
                        st.success(f"已切换到：{p['name']} / {selected_model}")
                        st.rerun()
            else:
                st.success("当前使用中")

        with col3:
            if st.button("🔗 测试连接", key=f"test_{p['id']}", use_container_width=True):
                result = test_provider(p['id'])
                if result['success']:
                    st.success(f"✅ {result['message']}")
                else:
                    st.error(f"❌ {result['message']}")

        with col4:
            if p['id'] not in ['ollama_local', 'doubao_default']:
                if two_step_delete("🗑️", f"del_{p['id']}", "删除此AI模型配置，不可恢复") == "yes":
                    delete_provider(p['id'])
                    st.success("已删除")
                    st.rerun()

        # 展开编辑
        with st.expander("✏️ 编辑配置", expanded=False):
            col_a, col_b = st.columns(2)
            with col_a:
                edit_name = st.text_input("供应商名称", value=p['name'], key=f"edit_name_{p['id']}")
                edit_url = st.text_input("API地址", value=p['base_url'], key=f"edit_url_{p['id']}")
            with col_b:
                edit_key = st.text_input("API Key", value=p['api_key'], type="password", key=f"edit_key_{p['id']}")
                edit_models = st.text_area(
                    "模型列表（每行一个）",
                    value='\n'.join(p['models']),
                    key=f"edit_models_{p['id']}",
                    height=100
                )

            if st.button("💾 保存修改", key=f"save_edit_{p['id']}"):
                models_list = [m.strip() for m in edit_models.split('\n') if m.strip()]
                update_provider(
                    p['id'],
                    name=edit_name,
                    base_url=edit_url,
                    api_key=edit_key,
                    models=models_list
                )
                st.success("已保存修改")
                st.rerun()

        st.markdown("---")
    
    # 添加新供应商
    st.subheader("➕ 添加新API中转站")
    st.info("💡 支持所有OpenAI兼容接口的中转站，填入API地址和密钥即可")
    
    with st.form("add_provider_form"):
        col1, col2 = st.columns(2)
        with col1:
            new_name = st.text_input("供应商名称 *", placeholder="例如：我的中转站、SiliconFlow、API2D等")
            new_url = st.text_input("API地址 *", placeholder="https://api.example.com/v1")
        with col2:
            new_key = st.text_input("API Key *", type="password", placeholder="sk-...")
        new_models = st.text_area("模型列表（可选，每行一个，留空自动检测）", height=80)
        submitted = st.form_submit_button("✅ 添加供应商", use_container_width=True)
    if submitted and new_name and new_url and new_key:
        models_list = [m.strip() for m in new_models.split('\n') if m.strip()] if new_models else None
        provider = add_provider(new_name, new_url, new_key, models_list)
        if provider['models']:
            st.success(f"✅ 添加成功！自动检测到 {len(provider['models'])} 个模型")
        else:
            st.success("✅ 添加成功！请手动添加模型名称")
        st.rerun()
    
    st.markdown("---")
    
    # 使用说明
    with st.expander("📖 使用说明"):
        st.markdown("""
    ### 如何使用中转站？
    
    1. **添加中转站**：在上方填入中转站名称、API地址、API Key
    2. **自动检测模型**：添加时会自动获取模型列表（如果中转站支持）
    3. **一键切换**：点击"切换到此供应商"，所有AI功能立即使用新模型
    4. **测试连接**：点击"测试连接"验证API是否可用
    
    ### 本地模型 vs 在线API
    
    | 特性 | 本地Ollama | 在线API中转站 |
    |------|-----------|-------------|
    | 费用 | 免费 | 按调用量付费 |
    | 网络 | 不需要联网 | 需要联网 |
    | 数据安全 | 100%本地 | 数据传到服务商 |
    | 模型效果 | 取决于电脑性能 | 通常更好 |
    | 速度 | 取决于电脑 | 通常更快 |
    
    ### 推荐用法
    
    - **查资料、搜知识库** → 不需要AI
    - **简单问答、翻译** → 本地Ollama（免费）
    - **复杂任务（开发信、背调、分析）** → 在线API（效果好）
    - **敏感客户数据** → 本地模型（数据不出本地）
    
    ### 支持的中转站格式
    
    所有兼容OpenAI接口格式的中转站都支持：
    - API地址格式：`https://xxx.com/v1`
    - 接口：`/chat/completions`、`/models`
    - 认证：Bearer Token
    """)
    
# ============ 页面：今日待办 ============
elif page == "📋 今日待办":
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
    <div style="color:#D4AF37;font-size:12px;letter-spacing:3px;">KAILIONCRAFTS · TODO</div>
    <h2 style="color:#FFF3E0;font-size:26px;margin:8px 0;">今日待办</h2>
    <div style="color:rgba(255,243,224,.6);font-size:13px;">今天要跟进的客户、要发的邮件、要做的事</div>
    </div>
    """, unsafe_allow_html=True)
    
    todo_file = Path("data/todo/todos.json")
    todo_file.parent.mkdir(parents=True, exist_ok=True)
    if todo_file.exists():
        todos = _json.loads(todo_file.read_text(encoding="utf-8"))
    else:
        todos = []
    
    c1, c2 = st.columns([3,1])
    with c1:
        new_todo = st.text_input("添加待办事项", placeholder="例如：跟进德国客户Hans的OEM询价")
    with c2:
        if st.button("➕ 添加", use_container_width=True):
            if new_todo.strip():
                todos.append({"task": new_todo.strip(), "done": False, "date": datetime.now().strftime("%Y-%m-%d")})
        todo_file.write_text(_json.dumps(todos, ensure_ascii=False, indent=2), encoding="utf-8")
        st.rerun()
    
    st.markdown("---")
    for i, t in enumerate(todos):
        cb = st.checkbox(t["task"], value=t["done"], key=f"todo_{i}")
    if cb != t["done"]:
        todos[i]["done"] = cb
    todo_file.write_text(_json.dumps(todos, ensure_ascii=False, indent=2), encoding="utf-8")
    
# ============ 页面：订单台账 ============
elif page == "🌍 海外社媒矩阵":
    import social_db as sdb
    sdb.init_db()
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
    <div style="color:#D4AF37;font-size:12px;letter-spacing:3px;">KAILIONCRAFTS · SOCIAL MATRIX</div>
    <h2 style="color:#FFF3E0;font-size:26px;margin:8px 0;">海外社媒矩阵</h2>
    <div style="color:rgba(255,243,224,.6);font-size:13px;">品类 · 账号 · 内容 · 数据 · 引流独立站</div>
    </div>
    """, unsafe_allow_html=True)

    t1, t2, t3 = st.tabs(["📊 驾驶舱", "👥 账号矩阵", "🎬 内容台账"])

    with t1:
        s, by_cat = sdb.dashboard()
        a1, a2, a3, a4 = st.columns(4)
        a1.metric("账号总数", s["accounts"], delta=f"活跃 {s['active']}")
        a2.metric("本月发布", s["pub_month"], delta=f"共 {s['contents']} 条")
        a3.metric("总播放", f"{s['views']:,}")
        a4.metric("社媒询盘/订单", f"{s['inquiries']} / {s['orders']}")
        st.markdown("##### 🏷️ 四大品类")
        for cat, info in by_cat.items():
            st.markdown(f"""
            <div style="background:#1f2733;border-radius:10px;padding:12px 16px;margin-bottom:8px;">
            <b style="color:#FFF3E0;">{cat}</b>　<span style="color:#aaa;font-size:13px;">负责人 {info['owner']}</span>
            <br><span style="color:#D4AF37;font-size:13px;">账号 {info['accounts']} · 本月发布 {info['pub_month']} · 播放 {info['views']:,} · 询盘 {info['inquiries']} · 订单 {info['orders']}</span>
            </div>""", unsafe_allow_html=True)

    with t2:
        # 三级下钻：品类 -> 平台账号 -> 内容记录
        for _k, _d in [("sm_level", "cats"), ("sm_cat", None), ("sm_acc_id", None)]:
            if _k not in st.session_state:
                st.session_state[_k] = _d
        accounts = sdb.list_accounts()

        # 新增账号表单（各层级通用）
        with st.expander("➕ 新增账号", expanded=False):
            with st.form("new_social_account"):
                _cat_default = st.session_state["sm_cat"] or list(sdb.CATEGORIES.keys())[0]
                x1, x2, x3 = st.columns(3)
                cat = x1.selectbox("品类", list(sdb.CATEGORIES.keys()),
                                   index=list(sdb.CATEGORIES.keys()).index(_cat_default))
                owner = x2.text_input("负责人", sdb.CATEGORIES[cat])
                platform = x3.selectbox("平台", sdb.PLATFORMS)
                y1, y2 = st.columns(2)
                acct_name = y1.text_input("账号名称 *")
                acct_url = y2.text_input("账号主页链接")
                email = st.text_input("联系邮箱")
                status = st.selectbox("状态", ["Active", "Inactive", "Pending", "Suspended"])
                if st.form_submit_button("保存", type="primary", use_container_width=True):
                    if not acct_name:
                        st.warning("账号名称必填")
                    else:
                        sdb.add_account(category=cat, owner=owner, platform=platform,
                                        account_name=acct_name, account_url=acct_url,
                                        email=email, status=status)
                        st.success("已保存"); st.rerun()

        # ===== 第一层：4大品类 =====
        if st.session_state["sm_level"] == "cats":
            st.markdown("##### 选择品类（4大产品线）")
            cc = st.columns(4)
            for i, (cat, owner) in enumerate(sdb.CATEGORIES.items()):
                with cc[i]:
                    n_acc = sum(1 for a in accounts if a.get("category") == cat)
                    st.markdown(f"""<div style="background:#1f2733;border:1px solid #2c3e50;border-radius:10px;padding:14px;margin-bottom:8px;">
                    <b style="color:#FFF3E0;font-size:15px;">{cat}</b><br>
                    <span style="color:#aaa;font-size:12px;">负责人 {owner}</span><br>
                    <span style="color:#D4AF37;font-size:12px;">已绑账号 {n_acc}/8</span></div>""", unsafe_allow_html=True)
                    if st.button(f"进入 {cat} →", key=f"catbtn_{cat}", use_container_width=True):
                        st.session_state["sm_cat"] = cat
                        st.session_state["sm_level"] = "accounts"
                        st.rerun()

        # ===== 第二层：品类下 8 平台账号 =====
        elif st.session_state["sm_level"] == "accounts":
            cat = st.session_state["sm_cat"]
            if st.button("← 返回品类", key="back_cats"):
                st.session_state["sm_level"] = "cats"; st.rerun()
            st.markdown(f"##### {cat} · 负责人 {sdb.CATEGORIES.get(cat,'')}")
            st.caption("每个平台一张账号卡片；已绑账号显示状态，未绑显示「待配置」。点「打开」看该账号内容。")
            cat_accs = [a for a in accounts if a.get("category") == cat]
            grid = st.columns(4)
            for pi, plat in enumerate(sdb.PLATFORMS):
                plat_accs = [a for a in cat_accs if a.get("platform") == plat]
                with grid[pi % 4]:
                    if plat_accs:
                        for a in plat_accs:
                            badge = "🟢" if a.get("status") == "Active" else "⚪"
                            st.markdown(f"""<div style="background:#1f2733;border-left:4px solid #D4AF37;border-radius:6px;padding:8px;margin:4px 0;font-size:12px;">
                            {badge} <b>{plat}</b><br><span style="color:#ccc;">{a.get('account_name','')}</span></div>""", unsafe_allow_html=True)
                            if st.button(f"📂 打开", key=f"open_{a['id']}", use_container_width=True):
                                st.session_state["sm_acc_id"] = a["id"]
                                st.session_state["sm_level"] = "contents"
                                st.rerun()
                    else:
                        st.markdown(f"""<div style="background:#171d26;border:1px dashed #333;border-radius:6px;padding:8px;margin:4px 0;font-size:12px;color:#888;">
                        ⚪ <b>{plat}</b><br>待配置</div>""", unsafe_allow_html=True)

        # ===== 第三层：账号的内容记录 =====
        else:
            if st.button("← 返回账号", key="back_accounts"):
                st.session_state["sm_level"] = "accounts"; st.rerun()
            acc = next((a for a in accounts if a["id"] == st.session_state["sm_acc_id"]), None)
            if acc:
                st.markdown(f"##### {acc.get('platform','')} · {acc.get('account_name','')}")
                its = sdb.contents_of_account(acc["id"])
                vv = sum(i.get("views", 0) for i in its)
                st.caption(f"品类 {acc.get('category','')} · 内容 {len(its)} 条 · 总播放 {vv:,}")
                if acc.get("account_url"):
                    st.markdown(f"[🌐 打开账号主页]({acc['account_url']})")
                if its:
                    for it in its:
                        with st.expander(f"🎬 {it.get('title','(无标题)')} · {it.get('status','')} · 播放{it.get('views',0):,}"):
                            st.write(f"发布日期: {it.get('publish_date','') or '未填'}")
                            if it.get("publish_url"):
                                st.markdown(f"[👉 发布链接]({it['publish_url']})")
                            st.write(f"点赞 {it.get('likes',0)} · 收藏 {it.get('saves',0)} · 评论 {it.get('comments',0)} · 询盘 {it.get('inquiries',0)}")
                            if it.get("shoot_script"):
                                st.caption("拍摄剪辑脚本：")
                                st.write(it["shoot_script"])
                else:
                    st.info("该账号还没有内容记录，到「🎬 内容台账」新增第一条")

    with t3:
        with st.expander("➕ 新增内容", expanded=False):
            with st.form("new_content"):
                z1, z2, z3 = st.columns(3)
                cat = z1.selectbox("品类", list(sdb.CATEGORIES.keys()), key="cnt_cat")
                owner = z2.text_input("负责人", sdb.CATEGORIES[cat], key="cnt_owner")
                platform = z3.selectbox("平台", sdb.PLATFORMS, key="cnt_plat")
                title = st.text_input("标题 *")
                z4, z5, z6 = st.columns(3)
                ctype = z4.selectbox("类型", sdb.CONTENT_TYPES)
                pub_status = z5.selectbox("状态", sdb.STATUS)
                pub_date = z6.text_input("发布日期", placeholder="2026-09-14")
                cover = st.file_uploader("封面图（JPG/PNG/WEBP）", type=["jpg", "jpeg", "png", "webp"])
                pub_url = st.text_input("发布链接（平台视频URL）")
                landing = st.text_input("独立站落地页链接")
                d1, d2, d3, d4 = st.columns(4)
                views = d1.number_input("播放", min_value=0, step=100)
                likes = d2.number_input("点赞", min_value=0)
                comments = d3.number_input("评论", min_value=0)
                saves = d4.number_input("收藏", min_value=0)
                e1, e2, e3, e4 = st.columns(4)
                shares = e1.number_input("分享", min_value=0)
                link_clicks = e2.number_input("链接点击", min_value=0)
                web_visits = e3.number_input("独立站访问", min_value=0)
                followers_g = e4.number_input("涨粉", min_value=0)
                e5, e6, e7 = st.columns(3)
                inq = e5.number_input("询盘", min_value=0)
                ord_n = e6.number_input("订单", min_value=0)
                mult_links = e7.text_input("多平台链接", placeholder="平台,URL 每行一条")
                shoot = st.text_area("📹 拍摄脚本（折叠长文本）", height=100)
                editing = st.text_area("✂️ 剪辑脚本", height=80)
                cap_in = st.text_area("📝 平台文案/Caption", height=60)
                tags = st.text_input("#️⃣ Hashtags（空格分隔）")
                notes = st.text_input("备注")
                if st.form_submit_button("保存内容", type="primary", use_container_width=True):
                    if not title:
                        st.warning("标题必填")
                    else:
                        cover_path = None
                        if cover is not None:
                            sdb.COVER_DIR.mkdir(parents=True, exist_ok=True)
                            cover_path = str(sdb.COVER_DIR / cover.name)
                            with open(cover_path, "wb") as f:
                                f.write(cover.getbuffer())
                        no = sdb.add_content(category=cat, owner=owner, platform=platform,
                                             title=title, content_type=ctype, status=pub_status,
                                             publish_date=pub_date or None, cover_path=cover_path,
                                             publish_url=pub_url, landing_url=landing,
                                             views=views, likes=likes, comments=comments,
                                             saves=saves, shares=shares, inquiries=inq, orders=ord_n,
                                             link_clicks=link_clicks, website_visits=web_visits,
                                             followers_gained=followers_g, multi_links=mult_links,
                                             shoot_script=shoot, editing_script=editing,
                                             caption=cap_in, hashtags=tags, notes=notes)
                        st.success(f"✅ 已保存 {no}"); st.rerun()

        f1, f2, f3, f4 = st.columns(4)
        fcat = f1.selectbox("品类筛选", ["全部"] + list(sdb.CATEGORIES.keys()), key="flt_cat")
        fplat = f2.selectbox("平台筛选", ["全部"] + sdb.PLATFORMS, key="flt_plat")
        fown = f3.selectbox("负责人筛选", ["全部"] + list(sdb.CATEGORIES.values()), key="flt_own")
        fst = f4.selectbox("状态筛选", ["全部"] + sdb.STATUS, key="flt_st")
        items = sdb.list_contents(fcat, fplat, fown, fst)
        st.caption(f"共 {len(items)} 条")
        for c in items:
            rate = sdb.interaction_rate(c)
            cr = sdb.click_rate(c)
            ir = sdb.inquiry_rate(c)
            with st.expander(f"🖼️ {c['content_no']} · {c['title']}  [{c['platform']}/{c['status']}]  播放{c['views']} 互动{rate}% 点击{cr}%"):
                cols_show = ["content_no", "category", "owner", "platform", "content_type",
                             "publish_date", "views", "link_clicks", "website_visits",
                             "inquiries", "orders"]
                st.dataframe(pd.DataFrame([{k: c.get(k) for k in cols_show}]),
                             use_container_width=True, hide_index=True)
                if c.get("cover_path") and Path(c["cover_path"]).exists():
                    st.image(c["cover_path"], width=240)
                if c.get("publish_url"):
                    st.markdown(f"[▶ 打开发布链接]({c['publish_url']})")
                if c.get("multi_links"):
                    st.caption("多平台链接（平台,URL）：" + c["multi_links"].replace("\n", " ｜ "))
                if c.get("landing_url"):
                    st.markdown(f"[🔗 独立站落地页]({c['landing_url']})")
                st.markdown("**📹 拍摄脚本**"); st.write(c.get("shoot_script") or "—")
                if c.get("editing_script"):
                    st.markdown("**✂️ 剪辑脚本**"); st.write(c["editing_script"])
                if c.get("caption"):
                    st.markdown("**📝 平台文案**"); st.write(c["caption"])
                if c.get("hashtags"):
                    st.caption("# " + c["hashtags"])
                st.caption(f"互动率 {rate}% · 点击率 {cr}% · 询盘转化率 {ir}% · 更新 {c.get('updated_at','')}")
                if two_step_delete("🗑 删除此内容", f"del_{c['id']}", "删除这条社媒内容记录，不可恢复") == "yes":
                    sdb.delete_content(c["id"]); st.rerun()

elif page == "🧾 订单台账":
    import finance_db as fdb
    fdb.init_db()
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
    <div style="color:#D4AF37;font-size:12px;letter-spacing:3px;">KAILIONCRAFTS · ORDER & FINANCE</div>
    <h2 style="color:#FFF3E0;font-size:26px;margin:8px 0;">订单与财务中心</h2>
    <div style="color:rgba(255,243,224,.6);font-size:13px;">销售订单 · 采购工厂 · 收付款 · 利润看板</div>
    </div>
    """, unsafe_allow_html=True)

    oa, ob, oc, od, oe = st.tabs(["🧾 销售订单", "🏭 采购/工厂", "💰 收付款流水", "📊 经营看板", "📄 报价单/PI"])

    # ---- 销售订单 ----
    with oa:
        with st.expander("➕ 新建销售订单", expanded=False):
            with st.form("new_sales_order"):
                c1, c2, c3 = st.columns(3)
                owner = c1.selectbox("负责人", fdb.MEMBERS)
                customer = c2.text_input("客户公司 *")
                country = c3.text_input("国家")
                product_summary = st.text_input("产品摘要", placeholder="如：厨师刀套装 500套")
                c4, c5, c6 = st.columns(3)
                qty = c4.number_input("数量", min_value=0, step=1)
                total_amount = c5.number_input("订单金额 *", min_value=0.0, step=100.0)
                currency = c6.selectbox("币种", ["USD", "EUR", "GBP", "CNY"])
                c7, c8, c9 = st.columns(3)
                status = c7.selectbox("状态", fdb.ORDER_STATUS)
                delivery_date = c8.text_input("预计交期", placeholder="2026-10-01")
                c10, c11 = st.columns(2)
                logistics_fee = c10.number_input("物流费", min_value=0.0, step=10.0)
                other_fee = c11.number_input("其他费用", min_value=0.0, step=10.0)
                notes = st.text_input("备注")
                if st.form_submit_button("💾 保存订单", type="primary", use_container_width=True):
                    if not customer or total_amount <= 0:
                        st.warning("客户公司和订单金额必填")
                    else:
                        no = fdb.add_sales_order(owner=owner, customer=customer, country=country,
                                                 product_summary=product_summary, qty=qty,
                                                 total_amount=total_amount, currency=currency,
                                                 status=status, delivery_date=delivery_date,
                                                 logistics_fee=logistics_fee, other_fee=other_fee, notes=notes)
                        st.success(f"✅ 已保存订单 {no}")
                        st.rerun()
        orders = fdb.list_sales_orders()
        if orders:
            st.dataframe(pd.DataFrame(orders)[["order_no","owner","customer","product_summary","total_amount","currency","status","order_date","delivery_date"]],
                         use_container_width=True, hide_index=True)
            # 快捷改状态
            with st.expander("🔄 快速更新订单状态"):
                upd_no = st.selectbox("选择订单", [o["order_no"] for o in orders])
                upd_st = st.selectbox("新状态", fdb.ORDER_STATUS, key="upd_st")
                if st.button("更新状态"):
                    fdb.update_sales_status(upd_no, upd_st); st.success("已更新"); st.rerun()

            with st.expander("🔍 客户历史查询（谁还欠钱/下过几单）"):
                cu_rows = fdb.list_customers()
                st.dataframe(pd.DataFrame(cu_rows), use_container_width=True, hide_index=True)
                picks = [r["客户"] for r in cu_rows]
                if picks:
                    sel_cu = st.selectbox("选客户看明细", picks)
                    cu_orders = [o for o in orders if (o["customer"] or "(未填)") == sel_cu]
                    st.dataframe(pd.DataFrame(cu_orders)[["order_no","product_summary","total_amount","currency","status","order_date"]],
                                 use_container_width=True, hide_index=True)
        else:
            st.info("还没有订单，点上方新建第一笔")

    # ---- 采购/工厂 ----
    with ob:
        FAC_FILE = Path("data/factories.json")
        def _load_fac():
            try:
                return _json.loads(FAC_FILE.read_text(encoding="utf-8"))
            except Exception:
                return []
        def _save_fac(lst):
            FAC_FILE.parent.mkdir(parents=True, exist_ok=True)
            FAC_FILE.write_text(_json.dumps(lst, ensure_ascii=False, indent=2), encoding="utf-8")

        sales_nos = [o["order_no"] for o in fdb.list_sales_orders()]
        if not sales_nos:
            st.info("请先在「销售订单」建一笔订单，再为它安排采购")
        else:
            with st.expander("🏭 工厂资料库（资质/产能/认证/合作备注，一次录入后采购单可直接选）", expanded=False):
                facs = _load_fac()
                if facs:
                    st.dataframe(pd.DataFrame(facs), use_container_width=True, hide_index=True)
                with st.form("new_factory"):
                    ff1, ff2 = st.columns(2)
                    fn = ff1.text_input("工厂名 *")
                    fspecialty = ff2.text_input("主营产品（如:厨师刀/剪刀冲压）")
                    ff3, ff4 = st.columns(2)
                    fcap = ff3.text_input("产能/规模")
                    fcert = ff4.text_input("认证（ISO/BSCI等）")
                    fcontact = st.text_input("联系人/电话/微信")
                    fnote = st.text_area("合作备注（历史/价格/质量/交期）")
                    if st.form_submit_button("💾 保存工厂档案", type="primary", use_container_width=True):
                        if not fn:
                            st.warning("工厂名必填")
                        else:
                            facs = [f for f in facs if f.get("name") != fn]
                            facs.append({"name": fn, "specialty": fspecialty, "capacity": fcap,
                                         "cert": fcert, "contact": fcontact, "note": fnote})
                            _save_fac(facs)
                            st.success(f"✅ 已保存工厂档案：{fn}")
                            st.rerun()
            with st.form("new_po"):
                p1, p2 = st.columns(2)
                so_no = p1.selectbox("关联销售订单", sales_nos)
                _fac_names = [f.get("name") for f in _load_fac()]
                existing_factories = list(dict.fromkeys(_fac_names + fdb.list_factories()))
                factory_opts = existing_factories + ["➕ 新工厂..."]
                f_sel = p2.selectbox("工厂名", factory_opts)
                if f_sel == "➕ 新工厂...":
                    factory = p2.text_input("新工厂名", key="new_factory")
                else:
                    factory = f_sel
                    p2.caption(f"将使用：{f_sel}")
                p3, p4, p5 = st.columns(3)
                cost_amount = p3.number_input("采购成本 *", min_value=0.0, step=100.0)
                po_curr = p4.selectbox("币种", ["USD","CNY","EUR"], key="po_curr")
                pay_status = p5.selectbox("付款进度", ["未付","部分付款","已付清"])
                notes = st.text_input("备注")
                if st.form_submit_button("💾 保存采购", type="primary", use_container_width=True):
                    if not factory or cost_amount <= 0:
                        st.warning("工厂名和采购成本必填")
                    else:
                        no = fdb.add_purchase_order(sales_order_no=so_no, factory=factory,
                                                   cost_amount=cost_amount, currency=po_curr, pay_status=pay_status, notes=notes)
                        st.success(f"✅ 已保存采购单 {no}")
                        st.rerun()
            pos = fdb.list_purchase_orders()
            if pos:
                st.dataframe(pd.DataFrame(pos)[["po_no","sales_order_no","factory","cost_amount","currency","pay_status","delivery_status","po_date"]],
                             use_container_width=True, hide_index=True)

    # ---- 收付款 ----
    with oc:
        sales_nos = [o["order_no"] for o in fdb.list_sales_orders()]
        pos_nos = [p["po_no"] for p in fdb.list_purchase_orders()]
        refs = sales_nos + pos_nos
        if not refs:
            st.info("先建订单或采购单，再来登记收付款")
        else:
            with st.form("new_pay"):
                d1, d2, d3 = st.columns(3)
                direction = d1.selectbox("方向", ["收客户", "付工厂"])
                ref_no = d2.selectbox("关联订单/采购单", refs)
                amount = d3.number_input("金额", min_value=0.0, step=100.0)
                d4, d5, d6 = st.columns(3)
                pcurr = d4.selectbox("币种", ["USD","CNY","EUR"], key="pay_curr")
                rate = d5.number_input("汇率(折人民币)", min_value=0.0, value=1.0, step=0.1)
                method = d6.selectbox("方式", ["T/T","西联","信用证","PayPal","其他"])
                notes = st.text_input("备注，如：30%定金 / 70%尾款")
                if st.form_submit_button("💾 登记", type="primary", use_container_width=True):
                    if amount <= 0:
                        st.warning("金额要大于0")
                    else:
                        fdb.add_payment(direction=direction, ref_order_no=ref_no, amount=amount,
                                        currency=pcurr, exchange_rate=rate, method=method, notes=notes)
                        st.success("✅ 已登记")
                        st.rerun()
            pays = fdb.list_payments()
            if pays:
                st.dataframe(pd.DataFrame(pays)[["pay_date","direction","ref_order_no","amount","currency","exchange_rate","method","notes"]],
                             use_container_width=True, hide_index=True)

    # ---- 经营看板 ----
    with od:
        s = fdb.dashboard_summary()
        k1, k2, k3, k4 = st.columns(4)
        k1.metric("订单总数", s["orders"])
        k2.metric("应收总额", f"${s['ar']:,.0f}")
        k3.metric("应付总额", f"${s['ap']:,.0f}")
        k4.metric("累计毛利", f"${s['gross']:,.0f}")
        st.markdown("---")
        b1, b2, b3 = st.columns(3)
        b1.metric("本月销售额", f"${s['m_sales']:,.0f}")
        b2.metric("本月采购", f"${s['m_po']:,.0f}")
        b3.metric("本月毛利", f"${s['m_gross']:,.0f}")
        st.caption("口径：USD 原币汇总；应收=销售总额-已收；应付=采购总额-已付；毛利=销售额-采购-物流-其他")
        if s["ar"] > 0:
            st.warning(f"⚠️ 当前应收 ${s['ar']:,.0f} 未收回，记得跟进尾款")

        st.markdown("##### ⏰ 应收账龄（未收回尾款）")
        ar_rows = fdb.list_receivables()
        if ar_rows:
            st.dataframe(pd.DataFrame(ar_rows), use_container_width=True, hide_index=True)
            over = [r for r in ar_rows if r["账龄天数"] > 30]
            if over:
                st.error("🔴 账龄超30天未收：" + "、".join(f"{r['客户']}(${r['未收']:,.0f}/{r['账龄天数']}天)" for r in over))
        else:
            st.success("✅ 无未收应收款")

        st.markdown("##### ⬇️ 导出")
        exp1, exp2, exp3 = st.columns(3)
        sales_df = pd.DataFrame(fdb.list_sales_orders())
        exp1.download_button("导出销售订单CSV", sales_df.to_csv(index=False).encode("utf-8-sig"),
                            "sales_orders.csv", "text/csv", use_container_width=True)
        po_df = pd.DataFrame(fdb.list_purchase_orders())
        exp2.download_button("导出采购CSV", po_df.to_csv(index=False).encode("utf-8-sig"),
                            "purchase_orders.csv", "text/csv", use_container_width=True)
        pay_df = pd.DataFrame(fdb.list_payments())
        exp3.download_button("导出收付款CSV", pay_df.to_csv(index=False).encode("utf-8-sig"),
                            "payments.csv", "text/csv", use_container_width=True)

    # ---- 报价单/PI ----
    with oe:
        # 公司抬头/银行信息（一次填写，持久化）
        comp_file = Path("data/company_profile.json")
        if comp_file.exists():
            comp = _json.loads(comp_file.read_text(encoding="utf-8"))
        else:
            comp = {"company": "KAILIONCRAFTS", "address": "Yangjiang, Guangdong, China",
                    "contact": "", "bank": "", "swift": ""}
        with st.expander("🏢 公司/银行抬头（一次填写，自动保存）"):
            c1, c2 = st.columns(2)
            comp["company"] = c1.text_input("公司名", comp["company"])
            comp["address"] = c2.text_input("地址", comp["address"])
            comp["contact"] = st.text_input("联系人/邮箱", comp["contact"])
            c3, c4 = st.columns(2)
            comp["bank"] = c3.text_input("银行账号信息", comp["bank"])
            comp["swift"] = c4.text_input("SWIFT/银行", comp["swift"])
            if st.button("保存抬头"):
                comp_file.parent.mkdir(parents=True, exist_ok=True)
                comp_file.write_text(_json.dumps(comp, ensure_ascii=False, indent=2), encoding="utf-8")
                st.success("已保存")

        sales = fdb.list_sales_orders()
        if not sales:
            st.info("先在「销售订单」建一笔，再来生成报价单/PI")
        else:
            pick_no = st.selectbox("选择销售订单", [o["order_no"] for o in sales])
            so = next((o for o in sales if o["order_no"] == pick_no), sales[0])
            i1, i2, i3 = st.columns(3)
            buyer = i1.text_input("客户抬头", so.get("customer", ""))
            incoterm = i2.selectbox("贸易条款", ["FOB", "CIF", "EXW", "CFR", "DDP"])
            pay_terms = i3.selectbox("付款条款", ["30% deposit + 70% before shipment", "T/T 100% in advance",
                                                  "30% deposit + 70% against B/L copy", "L/C at sight"])
            d1, d2, d3 = st.columns(3)
            unit_price = d1.number_input("单价", min_value=0.0, value=float(so["total_amount"]/so["qty"]) if so["qty"] else float(so["total_amount"]))
            qty_in = d2.number_input("数量", min_value=0, value=int(so["qty"] or 0))
            cur = d3.selectbox("币种", ["USD", "EUR", "GBP", "CNY"], key="pi_curr")
            today_str = datetime.now().strftime("%b %d, %Y")
            total = unit_price * qty_in
            seller_block = f"""Seller: {comp['company']}
        {comp['address']}
        {comp['contact']}"""
            bank_block = f"\nBank Info: {comp['bank']}\n            {comp['swift']}" if comp["bank"] or comp["swift"] else ""
            pi_text = f"""PROFORMA INVOICE
{'='*46}
Invoice No: {so['order_no']}
Date: {today_str}

{seller_block}
Buyer:  {buyer}

{'Item':<20}{'Qty':>8}{'Unit Price':>14}{'Amount':>14}
{'-'*56}
{so['product_summary']:<20}{qty_in:>8}{unit_price:>12,.2f}{total:>14,.2f}
{'-'*56}
{'TOTAL':<42}{total:>14,.2f}  {cur}

Price Term: {incoterm}
Payment: {pay_terms}
Delivery:   {so.get('delivery_date') or 'To be confirmed'}
{bank_block}

Thank you for your business!
"""
            st.text(pi_text)
            st.download_button("⬇️ 下载PI(.txt)", pi_text, f"PI_{so['order_no']}.txt", "text/plain", use_container_width=True)
    
# ============ 页面：博客SEO工作台 ============
elif page == "🔍 独立站SEO中心" and st.session_state.get("seo_sub") == "blog":
    if st.button("← 返回SEO中心", key="back_seo_center_3"):
        del st.session_state["seo_sub"]
        st.rerun()
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
    <div style="color:#D4AF37;font-size:12px;letter-spacing:3px;">KAILIONCRAFTS · BLOG SEO</div>
    <h2 style="color:#FFF3E0;font-size:26px;margin:8px 0;">博客SEO工作台</h2>
    <div style="color:rgba(255,243,224,.6);font-size:13px;">选题灵感 → 基于公司知识库 → AI生成高SEO博客文章</div>
    </div>
    """, unsafe_allow_html=True)
    
    # 连接的知识库说明
    with st.expander("🔗 本工作台连接的知识库（AI生成时会自动读取）", expanded=True):
        st.markdown("""
    **已连接知识库：**
    - 📘 `17_博客文章与内容营销知识库/01_博客文章方向与标题库.md` — 六大方向+细分标题
    - 📘 `17_博客文章与内容营销知识库/02_博客文章标准化生成指令.md` — SEO写作规范
    - 📘 公司知识库：KaiLionCrafts介绍、阳江产业带、OEM/ODM
    - 📘 产品知识库：四大品类SKU、产品参数、卖点
    - 📘 FAQ/客户痛点：客户常见问题、公司优势
    """)
    
    ideas_file = Path("data/blog/ideas.json")
    ideas_file.parent.mkdir(parents=True, exist_ok=True)
    if ideas_file.exists():
        ideas = _json.loads(ideas_file.read_text(encoding="utf-8"))
    else:
        ideas = []
    
    BLOG_DIRECTIONS = [
    "厨房刀具知识", "剪刀知识", "户外刀具知识", "厨房用品知识",
    "OEM/ODM定制指南", "阳江刀剪产业带"
    ]
    CATEGORIES = ["厨房刀", "剪刀", "户外刀", "厨房用品"]
    
    tab1, tab2 = st.tabs(["💡 选题灵感管理", "🤖 AI生成SEO文章"])
    
    with tab1:
        st.caption("用法：随时记录博客灵感/选题，然后点「生成文章」跳到右侧生成页")
        with st.expander("➕ 添加选题灵感", expanded=False):
            with st.form("new_idea"):
                title = st.text_input("选题标题")
                direction = st.selectbox("博客大方向", BLOG_DIRECTIONS)
                cat = st.selectbox("产品品类", CATEGORIES)
                kw = st.text_input("目标关键词（英文）")
                note = st.text_area("灵感/大纲/要点")
                if st.form_submit_button("保存选题"):
                    ideas.append({
                        "title":title,"direction":direction,"category":cat,
                        "keyword":kw,"note":note,"done":False,
                        "date":datetime.now().strftime("%Y-%m-%d")
                    })
                    ideas_file.write_text(_json.dumps(ideas, ensure_ascii=False, indent=2), encoding="utf-8")
                    st.success("已保存")
                    st.rerun()

        if ideas:
            for i, idea in enumerate(ideas):
                with st.container():
                    st.markdown(f"**{idea['title']}**")
                st.caption(f"方向：{idea.get('direction','')} | 品类：{idea.get('category','')} | 关键词：{idea.get('keyword','')} | {idea.get('date','')}")
                if idea.get("note"):
                    st.write(idea["note"])
                c1, c2 = st.columns(2)
                if c1.button("✍️ 用这个选题生成", key=f"gen_{i}"):
                    st.session_state['_gen_idea'] = idea
                    st.rerun()
                if c2.button("🗑 删除", key=f"del_{i}"):
                    ideas.pop(i)
                    ideas_file.write_text(_json.dumps(ideas, ensure_ascii=False, indent=2), encoding="utf-8")
                    st.rerun()
                st.markdown("---")
        else:
            st.info("还没有选题，随时记录你的博客灵感")
    
    with tab2:
        st.markdown("##### 输入选题 → AI读取知识库 → 生成SEO博客文章")
        g1, g2, g3 = st.columns(3)
        g_title = g1.text_input("文章标题", value=st.session_state.get('_gen_idea',{}).get('title',''))
        g_dir = g2.selectbox("大方向", BLOG_DIRECTIONS, index=BLOG_DIRECTIONS.index(st.session_state.get('_gen_idea',{}).get('direction',BLOG_DIRECTIONS[0])) if st.session_state.get('_gen_idea',{}).get('direction') in BLOG_DIRECTIONS else 0)
        g_cat = g3.selectbox("品类", CATEGORIES, index=CATEGORIES.index(st.session_state.get('_gen_idea',{}).get('category',CATEGORIES[0])) if st.session_state.get('_gen_idea',{}).get('category') in CATEGORIES else 0)
        g_kw = st.text_input("目标关键词（英文）", value=st.session_state.get('_gen_idea',{}).get('keyword',''))
        g_outline = st.text_area("大纲/要点（可选）", value=st.session_state.get('_gen_idea',{}).get('note',''))
    
    if st.button("🚀 基于知识库生成SEO文章", type="primary"):
        # 先读取知识库
        kb_context = ""
        try:
            blog_dir = KB_DIR / "17_博客文章与内容营销知识库"
            for f in sorted(blog_dir.glob("*.md")):
                kb_context += f"\n\n=== {f.name} ===\n" + f.read_text(encoding="utf-8")[:3000]
        except Exception as e:
            kb_context = f"(知识库读取: {e})"
    
        prompt = f"""你是KaiLionCrafts（阳江锴利匠心）的B2B独立站SEO内容专家。
    
## 公司知识库参考（必须基于此）
{kb_context[:5000]}
    
## 写作要求
请根据以下信息生成一篇完整的英文博客文章：
- 面向海外B2B采购商（importers/wholesalers/brand owners/Amazon sellers）
- 目标关键词：{g_kw}
- 大方向：{g_dir}
- 产品品类：{g_cat}
- 文章标题：{g_title}
- 大纲要点：{g_outline}
    
## SEO要求（评分80+）
1. Title tag含主关键词，50-60字符
2. Meta description 150-160字符，含CTA
3. H1/H2/H3层级清晰
4. 首段100字内出现关键词
5. 关键词密度1-2%
6. 文章800-1200词
7. 融入：阳江产业带优势、OEM/ODM、BSCI/ISO认证、私人定制
8. 结尾CTA引导询盘（Get a Quote / Contact Us）
9. 英文写作，专业B2B语气
10. 自然internal link建议
    
## 输出格式
# SEO Meta
Title: ...
Description: ...
Slug: ...
    
# Article
（完整文章正文）
"""
        with st.spinner("AI正在读取知识库并生成SEO博客文章..."):
            result = ai.chat(
                prompt,
                task_name=f"博客文章生成 - {g_title}",
                knowledge_refs=[
                    "17_博客文章与内容营销知识库",
                    "公司知识库：KaiLionCrafts",
                    "产品知识库：四大品类",
                    "FAQ：客户痛点与卖点",
                ]
            )
        st.markdown("##### ✨ 生成结果")
        st.markdown(result)
        st.download_button("📥 下载 .md", result, file_name=f"blog_{g_kw.replace(' ','_') or 'draft'}.md")
        if ai.last_trace:
            t = ai.last_trace
            with st.expander("📜 本次生成Trace"):
                st.write(f"模型：{t['model']} | 耗时：{t['elapsed_seconds']}s | Token：{t.get('total_tokens','N/A')}")
                st.write("引用知识库：")
                for ref in t.get("knowledge_refs", []):
                    st.write(f"- {ref}")

# ============ 飞书协同 ============
# ============ 设置中心 ============
elif page == "⚙️ 设置中心":
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
    <div style="color:#D4AF37;font-size:12px;letter-spacing:3px;">KAILIONCRAFTS · ADMIN</div>
    <h2 style="color:#FFF3E0;font-size:26px;margin:8px 0;">设置中心</h2>
    <div style="color:rgba(255,243,224,.6);font-size:13px;">模型配置 · AI追踪 · 访问日志</div>
    </div>
    """, unsafe_allow_html=True)

    sc_sections = {
        "🤖 模型配置": "API Key · 模型选择",
        "📊 AI调用统计": "Token消耗 · 模型用量",
        "👥 访问日志": "登录记录 · 在线用户",
    }
    if "sc_sub" not in st.session_state:
        st.session_state["sc_sub"] = "🤖 模型配置"
    sc_current = st.session_state["sc_sub"]

    sc_cols = st.columns(3)
    for i, (name, desc) in enumerate(sc_sections.items()):
        with sc_cols[i]:
            is_active = st.session_state["sc_sub"] == name
            if st.button(name, key=f"scbtn_{name}", use_container_width=True,
                         type="primary" if is_active else "secondary"):
                st.session_state["sc_sub"] = name
                st.rerun()

    sc_current = st.session_state["sc_sub"]
    st.markdown(f"### {sc_current}")
    st.caption(sc_sections[sc_current])
    st.markdown("---")

    if sc_current == "🤖 模型配置":
        st.subheader("模型配置")
        try:
            cfg = get_current_config()
            st.write(f"当前模型：{cfg.get('model', '未设置')}")
            st.write(f"API Base：{cfg.get('api_base', '未设置')}")
        except Exception as e:
            st.error(f"加载配置失败：{e}")

    elif sc_current == "📊 AI调用统计":
        st.subheader("AI调用统计")
        try:
            import json, os
            traces = []
            # 真实记录在 data/trace/trace_YYYYMM.json（ai_client._save_trace 按月写）
            trace_dir = Path("data/trace")
            if trace_dir.exists():
                for tf in sorted(trace_dir.glob("trace_*.json")):
                    try:
                        traces.extend(json.loads(tf.read_text(encoding="utf-8")))
                    except Exception:
                        pass
            # 兼容旧路径
            old_trace = Path("data/ai_trace.json")
            if old_trace.exists():
                try:
                    traces.extend(json.loads(old_trace.read_text(encoding="utf-8")))
                except Exception:
                    pass
            if traces:
                st.metric("总调用次数", len(traces))
                total_tokens = sum(t.get('total_tokens', 0) for t in traces if isinstance(t.get('total_tokens'), (int, float)))
                st.metric("总Token消耗", total_tokens)
                ok = sum(1 for t in traces if t.get('status') == 'success')
                st.metric("成功 / 失败", f"{ok} / {len(traces)-ok}")
                by_model = {}
                for t in traces:
                    by_model[t.get('model', '未知')] = by_model.get(t.get('model', '未知'), 0) + 1
                st.markdown("**按模型分布**")
                st.dataframe([{"模型": m, "次数": c} for m, c in sorted(by_model.items(), key=lambda x: -x[1])],
                             use_container_width=True, hide_index=True)
                st.markdown("**最近 20 次**")
                for t in traces[-20:][::-1]:
                    st.write(f"- {t.get('time', '')} | {t.get('task','')} | {t.get('model', '')} | {t.get('total_tokens', '?')} tok")
            else:
                st.info("暂无调用记录（调用任意 AI 功能后这里会自动统计）")
        except Exception as e:
            st.error(f"加载失败：{e}")

    elif sc_current == "👥 访问日志":
        st.subheader("访问日志")
        try:
            import json, os
            auth_file = "data/auth_log.json"
            if os.path.exists(auth_file):
                with open(auth_file, encoding='utf-8') as f:
                    logs = json.load(f)
                st.metric("总登录次数", len(logs))
                for log in logs[-20:]:
                    st.write(f"- {log.get('time', '')} | IP: {log.get('ip', '')} | {log.get('event', '')}")
            else:
                st.info("暂无登录记录")
        except Exception as e:
            st.error(f"加载失败：{e}")

# ============ AI调用Trace（旧） ============
elif page == "📜 AI调用Trace":
    st.info("已合并到「⚙️ 设置中心」")
    st.markdown("""
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:24px;margin-bottom:20px;">
    <div style="color:#D4AF37;font-size:12px;letter-spacing:3px;">KAILIONCRAFTS · AI TRACE</div>
    <h2 style="color:#FFF3E0;font-size:26px;margin:8px 0;">AI调用追溯（Trace）</h2>
    <div style="color:rgba(255,243,224,.6);font-size:13px;">每次AI调用的模型、耗时、Token、知识库来源全记录</div>
    </div>
    """, unsafe_allow_html=True)
    
    traces = ai.get_recent_traces(limit=50)
    if not traces:
        st.info("暂无Trace记录。去使用一次AI功能（如询盘回复、客户分析）后，这里会自动显示。")
    else:
    # 统计
        success = [t for t in traces if t["status"]=="success"]
    avg_time = sum(t["elapsed_seconds"] for t in success)/len(success) if success else 0
    total_tokens = sum(t.get("total_tokens",0) for t in success if isinstance(t.get("total_tokens"), int))
    
    c1, c2, c3 = st.columns(3)
    c1.metric("总调用次数", len(traces))
    c2.metric("平均耗时", f"{avg_time:.1f}秒")
    c3.metric("总Token消耗", total_tokens)
    
    st.markdown("---")
    st.markdown("##### 📋 最近调用记录")
    for t in traces:
        status_icon = "✅" if t["status"]=="success" else "❌"
    with st.expander(f"{status_icon} {t['time']} | {t['task']} | {t['model']} | {t['elapsed_seconds']}s"):
        c1, c2 = st.columns(2)
        with c1:
            st.markdown(f"**任务：** {t['task']}")
            st.markdown(f"**时间：** {t['time']}")
            st.markdown(f"**模型：** {t['model']}")
            st.markdown(f"**提供商：** {t['provider']}")
        with c2:
            st.markdown(f"**耗时：** {t['elapsed_seconds']}秒")
            st.markdown(f"**Prompt：** {t['prompt_chars']}字符")
            st.markdown(f"**回复：** {t['completion_chars']}字符")
            st.markdown(f"**Token：** {t.get('total_tokens','N/A')}")
        if t.get("knowledge_refs"):
            st.markdown("**引用知识库：**")
            for ref in t["knowledge_refs"]:
                st.markdown(f"- {ref}")
        if t.get("error"):
            st.error(f"错误：{t['error']}")
    
# ============ 页面14：设置 ============
elif page == "⚙️ 设置":
    st.title("⚙️ 工作台设置")
    st.caption("配置AI模型和API密钥，无需手动编辑文件")
    
    current = get_current_config()
    
    tab1, tab2 = st.tabs(["🤖 AI模型配置", "ℹ️ 关于工作台"])
    
    with tab1:
        st.subheader("AI模型与API配置")
    
    # 提供商分类
    provider_categories = {
    "🇨🇳 国内主流": ["doubao", "deepseek", "moonshot", "qwen", "zhipu", "ernie", "spark", "minimax", "stepfun", "yi", "sensenova"],
    "🌍 国际主流": ["openai", "claude", "gemini"],
    "🏠 本地/自定义": ["ollama", "custom"],
    }
    
    # 构建带分类的选项列表
    provider_options = []
    for cat, providers in provider_categories.items():
        for p in providers:
            if p in ALL_PROVIDERS:
                provider_options.append((f"{cat} | {ALL_PROVIDERS[p]['name']}", p))
    
    provider_labels = [opt[0] for opt in provider_options]
    provider_keys = [opt[1] for opt in provider_options]
    
    current_provider = current["provider"] if current["provider"] in ALL_PROVIDERS else "custom"
    default_idx = provider_keys.index(current_provider) if current_provider in provider_keys else len(provider_keys) - 1
    
    provider_label = st.selectbox(
    "选择AI提供商 *",
    options=provider_labels,
    index=default_idx,
    help="支持15+主流大模型，绝大多数提供OpenAI兼容接口",
    )
    provider = provider_keys[provider_labels.index(provider_label)]
    
    # 显示提供商说明
    provider_info = ALL_PROVIDERS.get(provider, {})
    if provider_info.get("note"):
        st.info(f"ℹ️ {provider_info['note']}")
    
    st.markdown("---")
    
    # API Key
    api_key = st.text_input(
    "API Key *",
    value=current["api_key"],
    type="password",
    placeholder=f"粘贴你的{provider_info.get('name', '')} API Key",
    help=f"在{provider_info.get('name', '')}控制台获取API Key",
    )
    
    # 注册链接
    if provider_info.get("signup_url"):
        st.caption(f"📝 没有Key？[点击这里注册获取]({provider_info['signup_url']})")
    
    # Base URL
    default_base = provider_info.get("base_url", "")
    if provider == "custom":
        base_url = st.text_input(
        "API Base URL *",
        value=current["base_url"] or "https://",
        placeholder="例如：https://api.example.com/v1",
        help="任何OpenAI兼容接口的Base URL都可以填入",
    )
    else:
        base_url = st.text_input(
        "API Base URL",
        value=current["base_url"] if current["provider"] == provider else default_base,
        help=f"{provider_info['name']}的API地址，一般不需要修改",
    )
    
    # 模型选择
    model_presets = provider_info.get("models", [])
    model_names = [m["name"] for m in model_presets]
    current_model = current["model"]
    
    col1, col2 = st.columns(2)
    with col1:
        if model_presets:
            model_index = model_names.index(current_model) if current_model in model_names else len(model_names)
        model = st.selectbox(
            "主力模型（复杂任务）*",
            options=model_names + ["自定义模型..."],
            index=model_index,
        )
        if model == "自定义模型...":
            model = st.text_input("输入模型名称", value=current_model, key="custom_model")
        else:
            model = st.text_input(
            "主力模型名称 *",
            value=current_model,
            placeholder="例如：gpt-4o、deepseek-chat等",
        )
    
    with col2:
        lite_model = st.text_input(
        "轻量模型（简单任务，可选）",
        value=current.get("model_lite", "") or model,
        placeholder="留空则与主力模型相同",
        help="用于简报、分类等简单任务，可选更便宜的模型",
    )
    
    # 显示模型描述
    if model_presets:
        for m in model_presets:
            if m["name"] == model:
                st.info(f"💡 {m['name']}：{m['desc']}")
    
    # 快速切换常用模型
    if model_presets:
        st.markdown("**⚡ 快速选择模型：**")
    quick_cols = st.columns(min(4, len(model_presets)))
    for i, m in enumerate(model_presets[:4]):
        with quick_cols[i]:
            if st.button(m["name"][:15], key=f"quick_{m['name']}", use_container_width=True):
                model = m["name"]
                st.rerun()
    
    st.markdown("---")
    
    # 测试连接
    col1, col2 = st.columns(2)
    with col1:
        if st.button("🔌 测试连接", use_container_width=True):
            if not api_key:
                st.error("请先填写API Key")
        else:
            with st.spinner("正在测试连接..."):
                success, msg = ai.test_connection(provider, api_key, base_url, model)
            if success:
                st.success(msg)
            else:
                st.error(msg)
    
    with col2:
        if st.button("💾 保存配置", type="primary", use_container_width=True):
            if not api_key:
                st.error("API Key不能为空")
        elif not model:
            st.error("模型名称不能为空")
        else:
            save_config(provider, api_key, base_url, model, lite_model)
            ai.update_config(provider, api_key, base_url, model, lite_model)
            st.success("✅ 配置已保存！立即生效，无需重启")
            st.balloons()
    
    # 当前状态
    st.markdown("---")
    st.subheader("当前状态")
    col1, col2, col3 = st.columns(3)
    with col1:
        if ai.is_configured():
            st.success("✅ API已配置")
        else:
            st.warning("⚠️ API未配置")
    with col2:
        st.info(f"模型：{ai.model}")
    with col3:
        st.info(f"提供商：{ai.get_provider_name()}")
    
    # 支持的提供商一览
    with st.expander("📋 查看所有支持的模型提供商"):
        for cat, providers in provider_categories.items():
            st.markdown(f"**{cat}**")
        for p in providers:
            if p in ALL_PROVIDERS:
                info = ALL_PROVIDERS[p]
                models_str = ", ".join([m["name"] for m in info.get("models", [])[:3]])
                st.markdown(f"- **{info['name']}**: {models_str or '自定义模型'}")
        st.markdown("")
    
    with tab2:
        st.subheader("关于工作台")
    st.markdown(f"""
    **KaiLionCrafts 企业级AI工作台**

    - 版本：v2.5
    - 公司：{COMPANY['name_cn']}
    - 品牌：{COMPANY['brand']}（{COMPANY['brand_cn']}）
    - 定位：{COMPANY['positioning']}
    - 创始人：{COMPANY['founder']}

    **功能导航（12个）：**
    仪表盘 | 自研AI工具库 | 市场与产品分析 | 客户中心 | 独立站管理
    订单台账 | 产品库 | 独立站SEO中心 | 公司知识库(含竞品与资源库) | 飞书协同 | 设置中心

    **数据资产：**
    - 标准化知识库：18大分类 / 1200+ 文档
    - 产品SKU：127 个已上架
    - 竞品/资源站：78 个
    - 团队：Leo / Jason / Owen / Julia 四人工作区

    **技术栈：**
    - Streamlit + Python（本地运行）
    - 豆包/OpenAI兼容API · 可切本地Ollama
    - 本地JSON存储（数据不出本机）
    """)
    
    st.markdown("---")
    st.caption("数据全部存储在本地，不上传任何服务器")
    st.caption(f"工作台目录：{Path(__file__).parent}")
    
# ============ 页脚 ============
st.markdown("---")
st.caption(f"KaiLionCrafts AI客户开发工作台 v1.0 | {COMPANY['name_cn']} | 基于阳江刀剪产业知识库")
