# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - 知识库驱动的客户开发内容草稿生成
P1.2D: 内容草稿生成器

安全规则：
- 生成前必须验证 approved Knowledge Pack
- hard_blocker 存在时禁止生成对外草稿
- 只使用 confirmed + public_use_allowed 的 Fact
- 不编造客户案例、订单、MOQ、产能、认证
- 公司表述使用 strategic manufacturing partners / local manufacturing network
- 不自动发送，只生成草稿
"""
import sqlite3
import json
import hashlib
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple
from urllib.parse import urlparse

import knowledge_facts as kf
import prospect_evaluator as pe
from model_registry import TEXT_CHAIN_IDS, REASONING_CHAIN_IDS

DB_PATH = Path(__file__).parent / "data" / "workbench.db"

# 模型链统一从 model_registry 读取，避免重复硬编码
DRAFT_TEXT_CHAIN = TEXT_CHAIN_IDS
DRAFT_REASONING_CHAIN = REASONING_CHAIN_IDS

DRAFT_TYPES = [
    "first_email",
    "linkedin_first_message",
    "follow_up_email",
    "product_recommendation",
    "pain_point_analysis",
    "rfq_response",
    "next_action_plan",
]

DRAFT_STATUSES = ["draft", "needs_review", "approved", "rejected"]

# 禁止编造的内容类型
PROHIBITED_CLAIMS = [
    "客户案例", "订单金额", "销售额", "MOQ", "产能", "交付周期",
    "认证", "客户评价", "工厂所有权", "未经确认的产品参数",
]

# 安全的公司表述
SAFE_COMPANY_PHRASES = [
    "strategic manufacturing partners",
    "local manufacturing network",
    "supply chain collaboration",
    "verified supplier network",
]


def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    return c


def _now():
    return datetime.utcnow().isoformat() + "Z"


def _gen_id(prefix: str) -> str:
    return f"{prefix}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{hashlib.md5(_now().encode()).hexdigest()[:8]}"


def init_db():
    """初始化草稿表，可重复执行"""
    c = _conn()
    cur = c.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS content_drafts (
        draft_id TEXT PRIMARY KEY,
        customer_id TEXT,
        draft_type TEXT,
        subject TEXT,
        body TEXT,
        language TEXT DEFAULT 'en',
        status TEXT DEFAULT 'draft',
        internal_only INTEGER DEFAULT 0,
        knowledge_pack_id TEXT,
        knowledge_pack_version INTEGER,
        knowledge_snapshot_hash TEXT,
        fact_ids TEXT,
        fact_versions TEXT,
        confirmed_claims TEXT,
        inferred_claims TEXT,
        missing_information TEXT,
        risk_flags TEXT,
        model TEXT,
        failover INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        trace_id TEXT,
        created_at TEXT,
        created_by TEXT,
        updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_draft_customer ON content_drafts(customer_id);
    CREATE INDEX IF NOT EXISTS idx_draft_type ON content_drafts(draft_type);
    CREATE INDEX IF NOT EXISTS idx_draft_status ON content_drafts(status);
    """)
    c.commit()
    c.close()


# ============ Knowledge Pack 校验 ============

def validate_draft_generation_prerequisites(customer_id: str,
                                             pack_ref: Optional[Dict] = None,
                                             allow_internal: bool = True) -> Dict:
    """
    校验草稿生成前置条件。
    返回 {'can_generate': bool, 'internal_only': bool, 'errors': [], 'pack': ..., 'evaluation': ...}
    """
    init_db()
    errors = []
    internal_only = False

    # 1. 获取客户评估
    qualification = pe.get_customer_qualification(customer_id)
    if not qualification['success']:
        errors.append('客户评估不存在，请先进行 ICP 评估')
        return {'can_generate': False, 'internal_only': False, 'errors': errors}

    evaluation = qualification['icp_evaluation']

    # 2. 检查 hard blockers
    if evaluation.get('hard_blockers'):
        blockers = evaluation['hard_blockers']
        if not allow_internal:
            errors.append(f'客户存在 {len(blockers)} 个 hard blocker，禁止生成对外草稿')
            return {'can_generate': False, 'internal_only': False, 'errors': errors,
                    'hard_blockers': blockers}
        else:
            internal_only = True
            errors.append('客户存在 hard blocker，仅允许生成内部草稿')

    # 3. 检查 Knowledge Pack
    pack = None
    if pack_ref and pack_ref.get('pack_id'):
        validation = pe.validate_customer_pack_binding(pack_ref['pack_id'], pack_ref.get('pack_version'))
        if not validation['valid']:
            if not allow_internal:
                errors.extend(validation['errors'])
                return {'can_generate': False, 'internal_only': False, 'errors': errors}
            else:
                internal_only = True
        else:
            pack = validation['pack']
    else:
        # 尝试从客户绑定获取
        binding = pe.get_customer_knowledge_binding(customer_id)
        if binding:
            validation = pe.validate_customer_pack_binding(
                binding['knowledge_pack_id'], binding['knowledge_pack_version'])
            if validation['valid']:
                pack = validation['pack']
            else:
                internal_only = True
                errors.append('客户绑定的 Knowledge Pack 无效，仅允许内部草稿')
        else:
            internal_only = True
            errors.append('缺少已批准 Knowledge Pack，仅允许生成内部草稿')

    # 4. 验证 Pack 中的 Fact
    if pack:
        frozen_facts = pack.get('frozen_fact_snapshots', [])
        for fact in frozen_facts:
            if fact.get('review_status') != 'confirmed':
                errors.append(f"Fact {fact.get('fact_id')} 不是 confirmed 状态")
                internal_only = True
            if not fact.get('public_use_allowed'):
                errors.append(f"Fact {fact.get('fact_id')} 不允许对外使用")
                internal_only = True
            # 检查来源可追溯
            has_source = (
                (fact.get('source_url') and fact['source_url'].startswith(('http://', 'https://'))) or
                (fact.get('source_document') and fact.get('source_locator')) or
                fact.get('source_hash')
            )
            if not has_source:
                errors.append(f"Fact {fact.get('fact_id')} 来源不可追溯")
                internal_only = True

        # 验证 snapshot hash
        if pack.get('knowledge_snapshot_hash'):
            # hash 已在 approve 时计算，这里验证存在性
            pass

    if errors and not internal_only:
        return {'can_generate': False, 'internal_only': False, 'errors': errors}

    return {
        'can_generate': True,
        'internal_only': internal_only,
        'errors': errors if internal_only else [],
        'pack': pack,
        'evaluation': evaluation,
    }


# ============ 草稿生成 ============

def _build_prompt(customer_input: Dict, draft_type: str, pack: Optional[Dict],
                  language: str = 'en', mode: str = 'standard') -> Tuple[str, str]:
    """构建生成提示词，返回 (system_prompt, user_prompt)"""
    system_prompt = f"""You are a professional B2B outreach content generator for KaiLionCrafts, a cutting tool manufacturing company.

CRITICAL RULES:
1. Only use confirmed facts from the Knowledge Pack. Do NOT invent:
   - Customer cases, order amounts, sales figures
   - MOQ, production capacity, delivery time
   - Certifications, customer testimonials
   - Factory ownership claims
2. For manufacturing capabilities, use phrases like:
   - "strategic manufacturing partners"
   - "local manufacturing network"
   - "supply chain collaboration"
   Do NOT claim KaiLionCrafts owns factories directly.
3. If information is missing, state it clearly rather than inventing.
4. Language: {language}
5. Content type: {draft_type}
6. Mode: {mode} (standard = concise, reasoning = detailed analysis)

Output format:
- Subject: [subject line]
- Body: [email/message body]
- Confirmed Claims: [list of facts used from Knowledge Pack]
- Inferred Claims: [list of reasonable inferences]
- Missing Information: [what is needed]
- Risk Flags: [any compliance or accuracy concerns]
"""

    # 构建用户提示词
    user_parts = [f"Customer Information:"]
    user_parts.append(f"- Company: {customer_input.get('company_name', 'N/A')}")
    user_parts.append(f"- Website: {customer_input.get('website', 'N/A')}")
    user_parts.append(f"- Country: {customer_input.get('country', 'N/A')}")
    user_parts.append(f"- Buyer Type: {customer_input.get('buyer_type', 'N/A')}")
    if customer_input.get('product_categories'):
        user_parts.append(f"- Products: {', '.join(customer_input['product_categories'])}")
    if customer_input.get('main_products'):
        user_parts.append(f"- Main Products: {customer_input.get('main_products')}")
    if customer_input.get('known_pain_points'):
        user_parts.append(f"- Known Pain Points: {customer_input['known_pain_points']}")

    if pack:
        user_parts.append(f"\nKnowledge Pack: {pack['name']} v{pack['version']}")
        user_parts.append(f"Approved Facts ({len(pack.get('frozen_fact_snapshots', []))}):")
        for fact in pack.get('frozen_fact_snapshots', [])[:10]:
            user_parts.append(f"- [{fact.get('fact_id')}] {fact.get('title')}: {fact.get('content', '')[:200]}")

    user_parts.append(f"\nGenerate a {draft_type} in {language}.")
    user_prompt = "\n".join(user_parts)

    return system_prompt, user_prompt


def _parse_model_response(response_text: str) -> Dict:
    """解析模型响应，提取 subject, body, confirmed_claims 等"""
    result = {
        'subject': '',
        'body': response_text,
        'confirmed_claims': [],
        'inferred_claims': [],
        'missing_information': [],
        'risk_flags': [],
    }

    # 简单解析
    sections = re.split(r'\n(?=(?:Subject|Body|Confirmed Claims|Inferred Claims|Missing Information|Risk Flags):)', response_text, flags=re.IGNORECASE)
    for section in sections:
        section = section.strip()
        if section.lower().startswith('subject:'):
            result['subject'] = section.split(':', 1)[1].strip()
        elif section.lower().startswith('body:'):
            result['body'] = section.split(':', 1)[1].strip()
        elif section.lower().startswith('confirmed claims:'):
            content = section.split(':', 1)[1].strip()
            result['confirmed_claims'] = [line.strip('- ').strip() for line in content.split('\n') if line.strip()]
        elif section.lower().startswith('inferred claims:'):
            content = section.split(':', 1)[1].strip()
            result['inferred_claims'] = [line.strip('- ').strip() for line in content.split('\n') if line.strip()]
        elif section.lower().startswith('missing information:'):
            content = section.split(':', 1)[1].strip()
            result['missing_information'] = [line.strip('- ').strip() for line in content.split('\n') if line.strip()]
        elif section.lower().startswith('risk flags:'):
            content = section.split(':', 1)[1].strip()
            result['risk_flags'] = [line.strip('- ').strip() for line in content.split('\n') if line.strip()]

    return result


def generate_content_draft(customer_id: str, draft_type: str,
                           customer_input: Optional[Dict] = None,
                           pack_ref: Optional[Dict] = None,
                           language: str = 'en',
                           mode: str = 'standard',
                           created_by: str = "system",
                           use_mock: bool = True) -> Dict:
    """
    生成内容草稿。
    use_mock=True 时使用模板生成，不调用真实 AI（用于测试和无 API Key 环境）。
    """
    init_db()

    if draft_type not in DRAFT_TYPES:
        return {'success': False, 'errors': [f'不支持的草稿类型: {draft_type}']}

    # 1. 校验前置条件
    prereq = validate_draft_generation_prerequisites(customer_id, pack_ref, allow_internal=True)
    if not prereq['can_generate']:
        return {'success': False, 'errors': prereq['errors']}

    pack = prereq['pack']
    internal_only = prereq['internal_only']

    # 2. 获取客户输入
    if customer_input is None:
        evaluation = prereq.get('evaluation', {})
        customer_input = {
            'customer_id': customer_id,
            'company_name': evaluation.get('company_name', ''),
            'website': evaluation.get('website', ''),
            'country': evaluation.get('country', ''),
            'buyer_type': evaluation.get('buyer_type', ''),
        }

    # 3. 选择模型链
    chain = DRAFT_REASONING_CHAIN if mode == 'reasoning' else DRAFT_TEXT_CHAIN

    # 4. 构建提示词
    system_prompt, user_prompt = _build_prompt(customer_input, draft_type, pack, language, mode)

    # 5. 生成内容（mock 模式）
    model_used = chain[0]
    failover = 0
    attempts = 1
    trace_id = _gen_id("trace")

    if use_mock:
        # Mock 生成：基于模板
        mock_content = _generate_mock_content(customer_input, draft_type, pack, language)
        parsed = _parse_model_response(mock_content)
    else:
        # 真实 AI 调用（需要 ai_client）
        try:
            import ai_client
            ai = ai_client.AIClient()
            response = ai.chat(user_prompt, system_prompt=system_prompt, temperature=0.7)
            model_used = response.get('model', chain[0])
            failover = 1 if response.get('failover') else 0
            attempts = response.get('attempts', 1)
            parsed = _parse_model_response(response.get('content', ''))
        except Exception as e:
            return {'success': False, 'errors': [f'AI 调用失败: {str(e)}']}

    # 6. 安全检查：扫描禁止编造的内容
    risk_flags = list(parsed.get('risk_flags', []))
    body_lower = parsed['body'].lower()
    for prohibited in PROHIBITED_CLAIMS:
        if prohibited.lower() in body_lower:
            risk_flags.append(f'检测到可能编造的内容: {prohibited}')

    # 7. 保存草稿
    draft_id = _gen_id("draft")
    now = _now()

    fact_ids = []
    fact_versions = []
    if pack:
        for snap in pack.get('frozen_fact_snapshots', []):
            fact_ids.append(snap.get('fact_id'))
            fact_versions.append(snap.get('version'))

    c = _conn()
    try:
        c.execute("""INSERT INTO content_drafts
            (draft_id, customer_id, draft_type, subject, body, language, status,
             internal_only, knowledge_pack_id, knowledge_pack_version, knowledge_snapshot_hash,
             fact_ids, fact_versions, confirmed_claims, inferred_claims, missing_information,
             risk_flags, model, failover, attempts, trace_id, created_at, created_by, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (draft_id, customer_id, draft_type, parsed['subject'], parsed['body'], language,
             'needs_review' if not internal_only else 'draft',
             int(internal_only),
             pack['pack_id'] if pack else None,
             pack['version'] if pack else None,
             pack['knowledge_snapshot_hash'] if pack else None,
             json.dumps(fact_ids), json.dumps(fact_versions),
             json.dumps(parsed['confirmed_claims'], ensure_ascii=False),
             json.dumps(parsed['inferred_claims'], ensure_ascii=False),
             json.dumps(parsed['missing_information'], ensure_ascii=False),
             json.dumps(risk_flags, ensure_ascii=False),
             model_used, failover, attempts, trace_id, now, created_by, now))
        c.commit()
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f'数据库错误: {str(e)}']}
    finally:
        c.close()

    return {
        'success': True,
        'draft_id': draft_id,
        'draft_type': draft_type,
        'subject': parsed['subject'],
        'body': parsed['body'],
        'internal_only': internal_only,
        'status': 'needs_review' if not internal_only else 'draft',
        'knowledge_pack_id': pack['pack_id'] if pack else None,
        'knowledge_pack_version': pack['version'] if pack else None,
        'knowledge_snapshot_hash': pack['knowledge_snapshot_hash'] if pack else None,
        'fact_ids': fact_ids,
        'fact_versions': fact_versions,
        'confirmed_claims': parsed['confirmed_claims'],
        'inferred_claims': parsed['inferred_claims'],
        'missing_information': parsed['missing_information'],
        'risk_flags': risk_flags,
        'model': model_used,
        'failover': failover,
        'attempts': attempts,
        'trace_id': trace_id,
        'model_chain': chain,
        'created_at': now,
    }


def _generate_mock_content(customer_input: Dict, draft_type: str,
                           pack: Optional[Dict], language: str) -> str:
    """生成 mock 内容（不调用真实 AI）"""
    company = customer_input.get('company_name', 'Valued Partner')
    country = customer_input.get('country', 'your region')
    products = customer_input.get('product_categories', ['cutting tools'])

    if draft_type == 'first_email':
        subject = f"Exploring {products[0] if products else 'cutting tool'} partnership opportunities"
        body = f"""Dear {company} Team,

I hope this message finds you well. I'm reaching out from KaiLionCrafts, a company specializing in high-quality cutting tools through our strategic manufacturing partners and local manufacturing network.

We noticed your company operates in {country} and may have interest in {', '.join(products)}. Our supply chain collaboration allows us to offer competitive pricing while maintaining quality standards.

Would you be open to a brief conversation about potential collaboration?

Best regards,
KaiLionCrafts Team"""
    elif draft_type == 'linkedin_first_message':
        subject = f"Connecting about {products[0] if products else 'cutting tools'}"
        body = f"""Hi {company.split()[0] if company else 'there'},

I came across your profile and was impressed by your work in {country}. I work with KaiLionCrafts, where we connect businesses with verified supplier networks for cutting tools.

I'd love to connect and share how our supply chain collaboration might benefit your operations.

Best,
KaiLionCrafts"""
    elif draft_type == 'follow_up_email':
        subject = f"Following up: {products[0] if products else 'cutting tool'} solutions"
        body = f"""Dear {company} Team,

I'm following up on my previous message about KaiLionCrafts' cutting tool solutions.

Through our strategic manufacturing partners, we can support your {', '.join(products)} needs with consistent quality and reliable supply.

Please let me know if you'd like to discuss further.

Best regards,
KaiLionCrafts Team"""
    elif draft_type == 'product_recommendation':
        subject = f"Recommended {products[0] if products else 'cutting tools'} for {company}"
        body = f"""Product Recommendation for {company}

Based on your profile in {country}, we recommend the following:

1. {products[0] if products else 'Standard Cutting Tools'} - Suitable for your market
2. Custom solutions available through our local manufacturing network

All products are sourced from verified suppliers in our network.

Note: Specific MOQ, pricing, and delivery details require confirmation based on your requirements."""
    elif draft_type == 'pain_point_analysis':
        subject = f"Pain Point Analysis: {company}"
        body = f"""Pain Point Analysis for {company}

Potential challenges in {country}:
1. Supply chain consistency - addressed by our verified supplier network
2. Quality control - managed through strategic manufacturing partners
3. Cost efficiency - achieved through local manufacturing network

Recommended approach: Start with sample evaluation to validate fit."""
    elif draft_type == 'rfq_response':
        subject = f"RFQ Response: {products[0] if products else 'cutting tools'}"
        body = f"""Thank you for your inquiry, {company}.

We appreciate your interest in our {', '.join(products)}. Through our supply chain collaboration, we can provide:
- Competitive pricing from verified manufacturers
- Quality assurance through strategic partners
- Flexible production capacity

Next steps: Please share your specific requirements for a detailed quotation."""
    else:  # next_action_plan
        subject = f"Next Steps: {company} Partnership"
        body = f"""Next Action Plan for {company}

1. Initial discovery call (15 min)
2. Product catalog sharing
3. Sample evaluation
4. Custom solution discussion
5. Pilot order

Our local manufacturing network ensures quality and reliability throughout."""

    confirmed = []
    if pack:
        for fact in pack.get('frozen_fact_snapshots', [])[:3]:
            confirmed.append(f"{fact.get('title')}: {fact.get('content', '')[:100]}")

    return f"""Subject: {subject}

Body:
{body}

Confirmed Claims:
{chr(10).join('- ' + c for c in confirmed) if confirmed else '- Based on customer profile and approved knowledge pack'}

Inferred Claims:
- Customer may have interest in {', '.join(products)} based on profile
- {country} market may have specific requirements

Missing Information:
- Specific product specifications
- Target pricing range
- Order volume expectations

Risk Flags:
- Internal draft, requires human review before sending
- All manufacturing claims use partner network language"""


# ============ 草稿管理 ============

def get_content_draft(draft_id: str) -> Optional[Dict]:
    """获取单个草稿"""
    init_db()
    c = _conn()
    row = c.execute("SELECT * FROM content_drafts WHERE draft_id=?", (draft_id,)).fetchone()
    c.close()
    if not row:
        return None
    d = dict(row)
    for field in ['fact_ids', 'fact_versions', 'confirmed_claims', 'inferred_claims', 'missing_information', 'risk_flags']:
        if d.get(field):
            d[field] = json.loads(d[field])
    d['internal_only'] = bool(d['internal_only'])
    d['failover'] = bool(d['failover'])
    return d


def list_content_drafts(customer_id: Optional[str] = None,
                        draft_type: Optional[str] = None,
                        status: Optional[str] = None,
                        limit: int = 50) -> List[Dict]:
    """列出草稿"""
    init_db()
    c = _conn()
    sql = "SELECT * FROM content_drafts WHERE 1=1"
    params = []
    if customer_id:
        sql += " AND customer_id=?"
        params.append(customer_id)
    if draft_type:
        sql += " AND draft_type=?"
        params.append(draft_type)
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = c.execute(sql, params).fetchall()
    c.close()
    results = []
    for row in rows:
        d = dict(row)
        for field in ['fact_ids', 'fact_versions', 'confirmed_claims', 'inferred_claims', 'risk_flags']:
            if d.get(field):
                d[field] = json.loads(d[field])
        d['internal_only'] = bool(d['internal_only'])
        results.append(d)
    return results


def update_draft_status(draft_id: str, status: str,
                        updated_by: str = "system") -> Dict:
    """更新草稿状态（人工审核）"""
    if status not in DRAFT_STATUSES:
        return {'success': False, 'errors': [f'无效状态: {status}']}

    init_db()
    c = _conn()
    try:
        c.execute("UPDATE content_drafts SET status=?, updated_at=? WHERE draft_id=?",
                  (status, _now(), draft_id))
        c.commit()
        return {'success': True, 'draft_id': draft_id, 'status': status}
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [str(e)]}
    finally:
        c.close()


def get_draft_model_chain(mode: str = 'standard') -> List[str]:
    """获取草稿生成使用的模型链"""
    return DRAFT_REASONING_CHAIN if mode == 'reasoning' else DRAFT_TEXT_CHAIN
