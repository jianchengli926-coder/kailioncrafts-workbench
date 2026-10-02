# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - Knowledge Fact / Knowledge Pack 数据层
P1.2A: 可审核事实与版本化知识包

安全规则：
- 新建事实默认 pending、public_use_allowed=false
- ai_summary 不得直接 confirmed
- confirmed 必须有可复核来源
- 高风险事实必须有有效 claim_subject
- public_use_allowed=false 的事实不能进入对外 Pack
- approved Pack 不可编辑，冻结快照不可变
- 所有外部使用判断 fail-closed
"""
import sqlite3
import json
import hashlib
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple

DB_PATH = Path(__file__).parent / "data" / "workbench.db"

FACT_STATUSES = ["pending", "confirmed", "rejected", "conflict"]
PACK_STATUSES = ["draft", "approved", "archived"]
HIGH_RISK_TYPES = ["certification", "testimonial", "factory_capability"]
ALLOWED_SOURCE_TYPES = ["document", "url", "internal_record", "ai_summary", "user_input"]

# ============ 权威公司简介事实（对外/对内统一口径） ============
# 来源：data/company_kb_v7/01_公司与品牌/05a_对外材料最新版数据_9.26.md（9.26 Company Profile/Catalog）
# 硬约束：
#   - "合作工厂网络" ≠ "自有工厂"，禁止表述为自有/自营工厂
#   - 认证清单不含 ISO9001（无此认证）
#   - 任何对外文案数字以本结构为准，旧版（4工厂/130国）作废
COMPANY_BRIEF_FACTS = {
    "partner_factory_count": 36,          # 36 家归档合作工厂网络
    "family_core_factory_count": 4,       # 其中 4 家为家族深度绑定核心工厂
    "export_country_count": 160,          # 出口 160+ 国家/地区
    "listed_sku_count": 127,             # 127+ listed SKUs
    # 权威认证/第三方检测（不含 ISO9001）
    "certifications": ["CE", "FDA", "LFGB", "RoHS", "FSC", "BSCI", "TÜV SÜD", "SGS"],
    "prohibited_claims": ["自有工厂", "自营工厂", "ISO9001", "ISO 9001"],
    "source_doc": "data/company_kb_v7/01_公司与品牌/05a_对外材料最新版数据_9.26.md",
}


def get_company_brief_facts():
    """返回权威公司简介事实（只读副本）。

    knowledge_base.get_company_brief() 等模块统一从这里读取数字与认证，
    避免在多处硬编码旧口径（4工厂/130国/ISO9001）。
    """
    return {
        "partner_factory_count": COMPANY_BRIEF_FACTS["partner_factory_count"],
        "family_core_factory_count": COMPANY_BRIEF_FACTS["family_core_factory_count"],
        "export_country_count": COMPANY_BRIEF_FACTS["export_country_count"],
        "listed_sku_count": COMPANY_BRIEF_FACTS["listed_sku_count"],
        "certifications": list(COMPANY_BRIEF_FACTS["certifications"]),
    }


def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    return c


def init_db():
    """初始化知识库表，可重复执行，不破坏现有数据"""
    c = _conn()
    cur = c.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS knowledge_facts (
        fact_id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'general',
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'user_input',
        source_document TEXT,
        source_locator TEXT,
        source_excerpt TEXT,
        source_url TEXT,
        source_hash TEXT,
        source_captured_at TEXT,
        review_status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by TEXT,
        reviewed_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        confidence REAL NOT NULL DEFAULT 0.0,
        claim_subject TEXT,
        public_use_allowed INTEGER NOT NULL DEFAULT 0,
        tags TEXT,
        linked_product_categories TEXT,
        review_notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_packs (
        pack_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft',
        product_categories TEXT,
        target_markets TEXT,
        buyer_types TEXT,
        prohibited_claim_rules TEXT,
        excluded_rules TEXT,
        allowed_fact_ids TEXT,
        frozen_fact_snapshots TEXT,
        knowledge_snapshot_hash TEXT,
        approved_by TEXT,
        approved_at TEXT,
        root_pack_id TEXT,
        previous_pack_version INTEGER,
        cloned_from_pack_id TEXT,
        cloned_from_version INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_facts_status ON knowledge_facts(review_status);
    CREATE INDEX IF NOT EXISTS idx_facts_type ON knowledge_facts(type);
    CREATE INDEX IF NOT EXISTS idx_packs_status ON knowledge_packs(status);
    CREATE INDEX IF NOT EXISTS idx_packs_root ON knowledge_packs(root_pack_id);
    """)
    c.commit()
    c.close()


def _now():
    return datetime.utcnow().isoformat() + "Z"


def _gen_id(prefix: str) -> str:
    return f"{prefix}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{hashlib.md5(_now().encode()).hexdigest()[:8]}"


def _safe_url(url: str) -> bool:
    """检查 URL 是否为安全的 http/https"""
    if not url:
        return True
    return bool(re.match(r'^https?://', url, re.IGNORECASE))


def _compute_snapshot_hash(snapshots: List[Dict]) -> str:
    """计算冻结快照的稳定 hash"""
    canonical = json.dumps(snapshots, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def _row_to_fact(row) -> Dict:
    d = dict(row)
    d['public_use_allowed'] = bool(d['public_use_allowed'])
    d['tags'] = json.loads(d['tags']) if d.get('tags') else []
    d['linked_product_categories'] = json.loads(d['linked_product_categories']) if d.get('linked_product_categories') else []
    return d


def _row_to_pack(row) -> Dict:
    d = dict(row)
    for field in ['product_categories', 'target_markets', 'buyer_types', 'prohibited_claim_rules',
                  'excluded_rules', 'allowed_fact_ids', 'frozen_fact_snapshots']:
        if d.get(field):
            d[field] = json.loads(d[field])
        else:
            d[field] = [] if field != 'frozen_fact_snapshots' else None
    return d


# ============ Knowledge Fact ============

def validate_knowledge_fact(fact: Dict, for_confirm: bool = False) -> Tuple[bool, List[str]]:
    """验证事实，返回 (是否通过, 错误列表)"""
    errors = []

    if not fact.get('title'):
        errors.append("title 不能为空")

    if fact.get('source_type') == 'ai_summary' and for_confirm:
        errors.append("ai_summary 类型不得直接 confirmed")

    if for_confirm:
        # confirmed 必须有可复核来源
        has_url = fact.get('source_url') and _safe_url(fact.get('source_url', ''))
        has_doc_locator = fact.get('source_document') and fact.get('source_locator')
        has_hash = fact.get('source_hash')
        if not (has_url or has_doc_locator or has_hash):
            errors.append("confirmed 事实必须有可复核来源（安全URL 或 document+locator 或 source_hash）")

        if fact.get('source_url') and not _safe_url(fact['source_url']):
            errors.append("source_url 只允许安全的 http/https 协议")

        # 高风险事实必须有 claim_subject
        if fact.get('type') in HIGH_RISK_TYPES and not fact.get('claim_subject'):
            errors.append(f"{fact['type']} 类型高风险事实必须有有效 claim_subject")

    if fact.get('source_url') and not _safe_url(fact['source_url']):
        errors.append("source_url 只允许安全的 http/https 协议")

    return (len(errors) == 0, errors)


def create_knowledge_fact(data: Dict) -> Dict:
    """创建新知识事实，默认 pending、public_use_allowed=false、version=1"""
    init_db()
    now = _now()
    fact_id = _gen_id("fact")

    fact = {
        'fact_id': fact_id,
        'type': data.get('type', 'general'),
        'title': data.get('title', '').strip(),
        'content': data.get('content', ''),
        'source_type': data.get('source_type', 'user_input'),
        'source_document': data.get('source_document'),
        'source_locator': data.get('source_locator'),
        'source_excerpt': data.get('source_excerpt'),
        'source_url': data.get('source_url'),
        'source_hash': data.get('source_hash'),
        'source_captured_at': data.get('source_captured_at', now),
        'review_status': 'pending',  # 强制默认 pending
        'reviewed_by': None,
        'reviewed_at': None,
        'version': 1,
        'confidence': float(data.get('confidence', 0.0)),
        'claim_subject': data.get('claim_subject'),
        'public_use_allowed': False,  # 强制默认 false
        'tags': json.dumps(data.get('tags', []), ensure_ascii=False),
        'linked_product_categories': json.dumps(data.get('linked_product_categories', []), ensure_ascii=False),
        'review_notes': None,
        'created_at': now,
        'updated_at': now,
    }

    valid, errors = validate_knowledge_fact(fact)
    if not valid:
        return {'success': False, 'errors': errors}

    c = _conn()
    try:
        c.execute("""INSERT INTO knowledge_facts
            (fact_id, type, title, content, source_type, source_document, source_locator,
             source_excerpt, source_url, source_hash, source_captured_at, review_status,
             reviewed_by, reviewed_at, version, confidence, claim_subject, public_use_allowed,
             tags, linked_product_categories, review_notes, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (fact['fact_id'], fact['type'], fact['title'], fact['content'], fact['source_type'],
             fact['source_document'], fact['source_locator'], fact['source_excerpt'],
             fact['source_url'], fact['source_hash'], fact['source_captured_at'],
             fact['review_status'], fact['reviewed_by'], fact['reviewed_at'], fact['version'],
             fact['confidence'], fact['claim_subject'], int(fact['public_use_allowed']),
             fact['tags'], fact['linked_product_categories'], fact['review_notes'],
             fact['created_at'], fact['updated_at']))
        c.commit()
        return {'success': True, 'fact': _row_to_fact(c.execute("SELECT * FROM knowledge_facts WHERE fact_id=?", (fact_id,)).fetchone())}
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f"数据库错误: {str(e)}"]}
    finally:
        c.close()


def get_knowledge_fact(fact_id: str) -> Optional[Dict]:
    """获取单个事实"""
    init_db()
    c = _conn()
    row = c.execute("SELECT * FROM knowledge_facts WHERE fact_id=?", (fact_id,)).fetchone()
    c.close()
    return _row_to_fact(row) if row else None


def list_knowledge_facts(status: Optional[str] = None, fact_type: Optional[str] = None,
                         public_only: bool = False, limit: int = 100) -> List[Dict]:
    """列出事实，可按状态、类型、公开权限筛选"""
    init_db()
    c = _conn()
    query = "SELECT * FROM knowledge_facts WHERE 1=1"
    params = []
    if status:
        query += " AND review_status=?"
        params.append(status)
    if fact_type:
        query += " AND type=?"
        params.append(fact_type)
    if public_only:
        query += " AND public_use_allowed=1 AND review_status='confirmed'"
    query += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)
    rows = c.execute(query, params).fetchall()
    c.close()
    return [_row_to_fact(r) for r in rows]


def update_knowledge_fact(fact_id: str, data: Dict) -> Dict:
    """更新事实（仅 pending 或 rejected 可更新内容；confirmed 更新需创建新版本）"""
    init_db()
    c = _conn()
    try:
        row = c.execute("SELECT * FROM knowledge_facts WHERE fact_id=?", (fact_id,)).fetchone()
        if not row:
            return {'success': False, 'errors': ['事实不存在']}
        fact = _row_to_fact(row)

        if fact['review_status'] == 'confirmed':
            return {'success': False, 'errors': ['confirmed 事实不可直接更新，请创建新版本']}

        now = _now()
        updates = {}
        for field in ['type', 'title', 'content', 'source_type', 'source_document',
                      'source_locator', 'source_excerpt', 'source_url', 'source_hash',
                      'confidence', 'claim_subject']:
            if field in data:
                updates[field] = data[field]
        if 'tags' in data:
            updates['tags'] = json.dumps(data['tags'], ensure_ascii=False)
        if 'linked_product_categories' in data:
            updates['linked_product_categories'] = json.dumps(data['linked_product_categories'], ensure_ascii=False)

        updates['updated_at'] = now

        # 验证
        test_fact = {**fact, **updates}
        valid, errors = validate_knowledge_fact(test_fact)
        if not valid:
            return {'success': False, 'errors': errors}

        set_clause = ", ".join([f"{k}=?" for k in updates.keys()])
        c.execute(f"UPDATE knowledge_facts SET {set_clause} WHERE fact_id=?",
                  list(updates.values()) + [fact_id])
        c.commit()
        return {'success': True, 'fact': _row_to_fact(c.execute("SELECT * FROM knowledge_facts WHERE fact_id=?", (fact_id,)).fetchone())}
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f"数据库错误: {str(e)}"]}
    finally:
        c.close()


def review_knowledge_fact(fact_id: str, status: str, reviewed_by: str,
                          notes: str = "", public_use_allowed: bool = False) -> Dict:
    """审核事实：pending -> confirmed/rejected/conflict"""
    if status not in FACT_STATUSES:
        return {'success': False, 'errors': [f"无效状态: {status}，允许: {FACT_STATUSES}"]}

    init_db()
    c = _conn()
    try:
        row = c.execute("SELECT * FROM knowledge_facts WHERE fact_id=?", (fact_id,)).fetchone()
        if not row:
            return {'success': False, 'errors': ['事实不存在']}
        fact = _row_to_fact(row)

        now = _now()
        updates = {
            'review_status': status,
            'reviewed_by': reviewed_by,
            'reviewed_at': now,
            'review_notes': notes,
            'updated_at': now,
        }

        if status == 'confirmed':
            test_fact = {**fact, **updates}
            valid, errors = validate_knowledge_fact(test_fact, for_confirm=True)
            if not valid:
                return {'success': False, 'errors': errors}
            updates['public_use_allowed'] = int(public_use_allowed)
        else:
            updates['public_use_allowed'] = 0  # rejected/conflict 强制不可对外

        set_clause = ", ".join([f"{k}=?" for k in updates.keys()])
        c.execute(f"UPDATE knowledge_facts SET {set_clause} WHERE fact_id=?",
                  list(updates.values()) + [fact_id])
        c.commit()
        return {'success': True, 'fact': _row_to_fact(c.execute("SELECT * FROM knowledge_facts WHERE fact_id=?", (fact_id,)).fetchone())}
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f"数据库错误: {str(e)}"]}
    finally:
        c.close()


def search_knowledge_facts(query: str, status: Optional[str] = None,
                           public_only: bool = False, limit: int = 50) -> List[Dict]:
    """搜索事实（标题、内容、标签）"""
    init_db()
    c = _conn()
    sql = "SELECT * FROM knowledge_facts WHERE (title LIKE ? OR content LIKE ? OR tags LIKE ?)"
    params = [f"%{query}%", f"%{query}%", f"%{query}%"]
    if status:
        sql += " AND review_status=?"
        params.append(status)
    if public_only:
        sql += " AND public_use_allowed=1 AND review_status='confirmed'"
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)
    rows = c.execute(sql, params).fetchall()
    c.close()
    return [_row_to_fact(r) for r in rows]


# ============ Knowledge Pack ============

def validate_knowledge_pack(pack: Dict, for_approve: bool = False) -> Tuple[bool, List[str]]:
    """验证 Pack，返回 (是否通过, 错误列表)"""
    errors = []

    if not pack.get('name'):
        errors.append("name 不能为空")

    if for_approve:
        fact_ids = pack.get('allowed_fact_ids', [])
        if not fact_ids:
            errors.append("approved Pack 必须包含至少一个事实")

        # 检查每个事实是否符合对外使用条件
        for fid in fact_ids:
            fact = get_knowledge_fact(fid)
            if not fact:
                errors.append(f"事实不存在: {fid}")
                continue
            if fact['review_status'] != 'confirmed':
                errors.append(f"事实 {fid} 状态为 {fact['review_status']}，不是 confirmed")
            if not fact['public_use_allowed']:
                errors.append(f"事实 {fid} public_use_allowed=false，不能进入对外 Pack")
            if fact.get('source_type') == 'ai_summary':
                errors.append(f"事实 {fid} 为 ai_summary，不能进入对外 Pack")

    return (len(errors) == 0, errors)


def create_knowledge_pack(data: Dict) -> Dict:
    """创建 Pack，默认 draft、version=1"""
    init_db()
    now = _now()
    pack_id = _gen_id("pack")

    pack = {
        'pack_id': pack_id,
        'name': data.get('name', '').strip(),
        'version': 1,
        'status': 'draft',
        'product_categories': json.dumps(data.get('product_categories', []), ensure_ascii=False),
        'target_markets': json.dumps(data.get('target_markets', []), ensure_ascii=False),
        'buyer_types': json.dumps(data.get('buyer_types', []), ensure_ascii=False),
        'prohibited_claim_rules': json.dumps(data.get('prohibited_claim_rules', []), ensure_ascii=False),
        'excluded_rules': json.dumps(data.get('excluded_rules', []), ensure_ascii=False),
        'allowed_fact_ids': json.dumps(data.get('allowed_fact_ids', []), ensure_ascii=False),
        'frozen_fact_snapshots': None,
        'knowledge_snapshot_hash': None,
        'approved_by': None,
        'approved_at': None,
        'root_pack_id': data.get('root_pack_id', pack_id),
        'previous_pack_version': None,
        'cloned_from_pack_id': data.get('cloned_from_pack_id'),
        'cloned_from_version': data.get('cloned_from_version'),
        'created_at': now,
        'updated_at': now,
    }

    valid, errors = validate_knowledge_pack(pack)
    if not valid:
        return {'success': False, 'errors': errors}

    c = _conn()
    try:
        c.execute("""INSERT INTO knowledge_packs
            (pack_id, name, version, status, product_categories, target_markets, buyer_types,
             prohibited_claim_rules, excluded_rules, allowed_fact_ids, frozen_fact_snapshots,
             knowledge_snapshot_hash, approved_by, approved_at, root_pack_id, previous_pack_version,
             cloned_from_pack_id, cloned_from_version, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (pack['pack_id'], pack['name'], pack['version'], pack['status'],
             pack['product_categories'], pack['target_markets'], pack['buyer_types'],
             pack['prohibited_claim_rules'], pack['excluded_rules'], pack['allowed_fact_ids'],
             pack['frozen_fact_snapshots'], pack['knowledge_snapshot_hash'],
             pack['approved_by'], pack['approved_at'], pack['root_pack_id'],
             pack['previous_pack_version'], pack['cloned_from_pack_id'],
             pack['cloned_from_version'], pack['created_at'], pack['updated_at']))
        c.commit()
        return {'success': True, 'pack': _row_to_pack(c.execute("SELECT * FROM knowledge_packs WHERE pack_id=?", (pack_id,)).fetchone())}
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f"数据库错误: {str(e)}"]}
    finally:
        c.close()


def get_knowledge_pack(pack_id: str) -> Optional[Dict]:
    """获取单个 Pack"""
    init_db()
    c = _conn()
    row = c.execute("SELECT * FROM knowledge_packs WHERE pack_id=?", (pack_id,)).fetchone()
    c.close()
    return _row_to_pack(row) if row else None


def list_knowledge_packs(status: Optional[str] = None, root_pack_id: Optional[str] = None,
                         limit: int = 100) -> List[Dict]:
    """列出 Pack"""
    init_db()
    c = _conn()
    query = "SELECT * FROM knowledge_packs WHERE 1=1"
    params = []
    if status:
        query += " AND status=?"
        params.append(status)
    if root_pack_id:
        query += " AND root_pack_id=?"
        params.append(root_pack_id)
    query += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)
    rows = c.execute(query, params).fetchall()
    c.close()
    return [_row_to_pack(r) for r in rows]


def update_knowledge_pack(pack_id: str, data: Dict) -> Dict:
    """更新 Pack（仅 draft 可编辑）"""
    init_db()
    c = _conn()
    try:
        row = c.execute("SELECT * FROM knowledge_packs WHERE pack_id=?", (pack_id,)).fetchone()
        if not row:
            return {'success': False, 'errors': ['Pack 不存在']}
        pack = _row_to_pack(row)

        if pack['status'] != 'draft':
            return {'success': False, 'errors': [f"Pack 状态为 {pack['status']}，不可编辑"]}

        now = _now()
        updates = {}
        for field in ['name', 'product_categories', 'target_markets', 'buyer_types',
                      'prohibited_claim_rules', 'excluded_rules', 'allowed_fact_ids']:
            if field in data:
                val = data[field]
                if isinstance(val, list):
                    val = json.dumps(val, ensure_ascii=False)
                updates[field] = val
        updates['updated_at'] = now

        test_pack = {**pack, **updates}
        valid, errors = validate_knowledge_pack(test_pack)
        if not valid:
            return {'success': False, 'errors': errors}

        set_clause = ", ".join([f"{k}=?" for k in updates.keys()])
        c.execute(f"UPDATE knowledge_packs SET {set_clause} WHERE pack_id=?",
                  list(updates.values()) + [pack_id])
        c.commit()
        return {'success': True, 'pack': _row_to_pack(c.execute("SELECT * FROM knowledge_packs WHERE pack_id=?", (pack_id,)).fetchone())}
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f"数据库错误: {str(e)}"]}
    finally:
        c.close()


def approve_knowledge_pack(pack_id: str, approved_by: str) -> Dict:
    """批准 Pack：验证事实、生成冻结快照、计算 hash"""
    init_db()
    c = _conn()
    try:
        row = c.execute("SELECT * FROM knowledge_packs WHERE pack_id=?", (pack_id,)).fetchone()
        if not row:
            return {'success': False, 'errors': ['Pack 不存在']}
        pack = _row_to_pack(row)

        if pack['status'] != 'draft':
            return {'success': False, 'errors': [f"Pack 状态为 {pack['status']}，只能批准 draft"]}

        # 验证所有事实
        fact_ids = pack.get('allowed_fact_ids', [])
        valid, errors = validate_knowledge_pack(pack, for_approve=True)
        if not valid:
            return {'success': False, 'errors': errors}

        # 生成冻结快照
        snapshots = []
        for fid in fact_ids:
            fact = get_knowledge_fact(fid)
            if fact:
                snapshots.append({
                    'fact_id': fact['fact_id'],
                    'version': fact['version'],
                    'title': fact['title'],
                    'content': fact['content'],
                    'type': fact['type'],
                    'claim_subject': fact.get('claim_subject'),
                    'source_document': fact.get('source_document'),
                    'source_locator': fact.get('source_locator'),
                    'source_excerpt': fact.get('source_excerpt'),
                    'source_url': fact.get('source_url'),
                    'source_hash': fact.get('source_hash'),
                    'source_captured_at': fact.get('source_captured_at'),
                    'review_status': fact['review_status'],
                    'public_use_allowed': fact['public_use_allowed'],
                    'tags': fact.get('tags', []),
                    'linked_product_categories': fact.get('linked_product_categories', []),
                    'confidence': fact.get('confidence'),
                })

        snapshot_hash = _compute_snapshot_hash(snapshots)
        now = _now()

        c.execute("""UPDATE knowledge_packs SET
            status='approved', approved_by=?, approved_at=?,
            frozen_fact_snapshots=?, knowledge_snapshot_hash=?, updated_at=?
            WHERE pack_id=?""",
            (approved_by, now, json.dumps(snapshots, ensure_ascii=False), snapshot_hash, now, pack_id))
        c.commit()
        return {'success': True, 'pack': _row_to_pack(c.execute("SELECT * FROM knowledge_packs WHERE pack_id=?", (pack_id,)).fetchone())}
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f"数据库错误: {str(e)}"]}
    finally:
        c.close()


def archive_knowledge_pack(pack_id: str) -> Dict:
    """归档 Pack：approved -> archived"""
    init_db()
    c = _conn()
    try:
        row = c.execute("SELECT * FROM knowledge_packs WHERE pack_id=?", (pack_id,)).fetchone()
        if not row:
            return {'success': False, 'errors': ['Pack 不存在']}
        pack = _row_to_pack(row)

        if pack['status'] != 'approved':
            return {'success': False, 'errors': [f"只能归档 approved Pack，当前状态: {pack['status']}"]}

        now = _now()
        c.execute("UPDATE knowledge_packs SET status='archived', updated_at=? WHERE pack_id=?", (now, pack_id))
        c.commit()
        return {'success': True, 'pack': _row_to_pack(c.execute("SELECT * FROM knowledge_packs WHERE pack_id=?", (pack_id,)).fetchone())}
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f"数据库错误: {str(e)}"]}
    finally:
        c.close()


def create_next_knowledge_pack_version(pack_id: str, actor: str) -> Dict:
    """创建下一版本：从 approved Pack 克隆为新的 draft"""
    init_db()
    c = _conn()
    try:
        row = c.execute("SELECT * FROM knowledge_packs WHERE pack_id=?", (pack_id,)).fetchone()
        if not row:
            return {'success': False, 'errors': ['Pack 不存在']}
        pack = _row_to_pack(row)

        if pack['status'] not in ['approved', 'archived']:
            return {'success': False, 'errors': [f"只能从 approved/archived Pack 创建新版本，当前: {pack['status']}"]}

        now = _now()
        new_pack_id = _gen_id("pack")
        new_version = pack['version'] + 1

        c.execute("""INSERT INTO knowledge_packs
            (pack_id, name, version, status, product_categories, target_markets, buyer_types,
             prohibited_claim_rules, excluded_rules, allowed_fact_ids, frozen_fact_snapshots,
             knowledge_snapshot_hash, approved_by, approved_at, root_pack_id, previous_pack_version,
             cloned_from_pack_id, cloned_from_version, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (new_pack_id, pack['name'], new_version, 'draft',
             json.dumps(pack.get('product_categories', []), ensure_ascii=False),
             json.dumps(pack.get('target_markets', []), ensure_ascii=False),
             json.dumps(pack.get('buyer_types', []), ensure_ascii=False),
             json.dumps(pack.get('prohibited_claim_rules', []), ensure_ascii=False),
             json.dumps(pack.get('excluded_rules', []), ensure_ascii=False),
             json.dumps(pack.get('allowed_fact_ids', []), ensure_ascii=False),
             None, None, None, None,
             pack.get('root_pack_id', pack_id), pack['version'],
             pack_id, pack['version'], now, now))
        c.commit()
        return {'success': True, 'pack': _row_to_pack(c.execute("SELECT * FROM knowledge_packs WHERE pack_id=?", (new_pack_id,)).fetchone())}
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f"数据库错误: {str(e)}"]}
    finally:
        c.close()


def get_frozen_fact_snapshots(pack_id: str) -> Optional[List[Dict]]:
    """获取 Pack 的冻结事实快照（approved Pack 才有）"""
    pack = get_knowledge_pack(pack_id)
    if not pack:
        return None
    return pack.get('frozen_fact_snapshots')


# ============ 知识库导入接口（dry-run 为主） ============

def import_kb_dry_run(file_paths: List[str]) -> Dict:
    """知识库导入预览：不修改正式数据，返回将创建的事实列表和冲突报告"""
    results = []
    conflicts = []
    for fp in file_paths:
        p = Path(fp)
        if not p.exists():
            conflicts.append({'file': fp, 'error': '文件不存在'})
            continue
        try:
            content = p.read_text(encoding='utf-8', errors='ignore')
            content_hash = hashlib.md5(content.encode('utf-8')).hexdigest()
            # 简单标题提取
            title = p.stem
            for line in content.split('\n')[:5]:
                if line.startswith('#'):
                    title = line.lstrip('#').strip()
                    break

            # 检查重复
            init_db()
            c = _conn()
            existing = c.execute("SELECT fact_id FROM knowledge_facts WHERE source_hash=?", (content_hash,)).fetchone()
            c.close()

            fact_preview = {
                'title': title,
                'content': content[:500],
                'source_type': 'document',
                'source_document': str(p),
                'source_locator': p.name,
                'source_hash': content_hash,
                'source_captured_at': _now(),
                'review_status': 'pending',
                'public_use_allowed': False,
            }
            if existing:
                conflicts.append({'file': fp, 'existing_fact_id': existing['fact_id'], 'reason': '内容重复'})
            else:
                results.append(fact_preview)
        except Exception as e:
            conflicts.append({'file': fp, 'error': str(e)})

    return {'success': True, 'preview': results, 'conflicts': conflicts, 'will_import_count': len(results)}


def import_selected_kb_files(file_paths: List[str], actor: str = "system") -> Dict:
    """导入选定的知识库文件，全部标记为 pending"""
    imported = []
    errors = []
    for fp in file_paths:
        result = create_knowledge_fact({
            'title': Path(fp).stem,
            'content': Path(fp).read_text(encoding='utf-8', errors='ignore')[:2000],
            'source_type': 'document',
            'source_document': fp,
            'source_locator': Path(fp).name,
            'source_hash': hashlib.md5(Path(fp).read_text(encoding='utf-8', errors='ignore').encode()).hexdigest(),
            'source_captured_at': _now(),
        })
        if result['success']:
            imported.append(result['fact']['fact_id'])
        else:
            errors.append({'file': fp, 'errors': result['errors']})
    return {'success': len(errors) == 0, 'imported_fact_ids': imported, 'errors': errors}


# ============ P1.2B: 知识库扫描、统计、增强导入和只读检索 ============

KB_ROOT = Path(__file__).parent / "data" / "company_kb_v7"

# 首批允许导入的分类
ALLOWED_IMPORT_CATEGORIES = ['00', '01', '02', '03']

# 产品品类映射（从目录名推断）
PRODUCT_CATEGORY_MAP = {
    '户外刀': 'outdoor_knives',
    '厨房刀': 'kitchen_knives',
    '工具刀': 'tool_knives',
    '剪刀': 'scissors',
    '刀剪': 'cutting_tools',
}

# 目标市场关键词映射
MARKET_KEYWORDS = {
    '美国': 'US', 'USA': 'US', '北美': 'North_America',
    '欧洲': 'Europe', '欧盟': 'EU', '德国': 'DE', '英国': 'UK',
    '日本': 'JP', '澳洲': 'AU', '澳大利亚': 'AU',
    '东南亚': 'SEA', '中东': 'Middle_East',
}

# 买家类型关键词映射
BUYER_TYPE_KEYWORDS = {
    '批发商': 'wholesaler', 'distributor': 'distributor', '经销商': 'distributor',
    '零售商': 'retailer', 'retailer': 'retailer',
    '品牌商': 'brand_owner', 'brand': 'brand_owner',
    '电商': 'ecommerce', 'Amazon': 'ecommerce', '亚马逊': 'ecommerce',
    'OEM': 'oem_buyer', 'ODM': 'odm_buyer', '贴牌': 'oem_buyer',
}


def scan_kb_files(categories: Optional[List[str]] = None,
                  include_subdirs: bool = True) -> Dict:
    """扫描知识库 Markdown 文件，返回完整清单和分类统计"""
    if not KB_ROOT.exists():
        return {'success': False, 'errors': [f'知识库目录不存在: {KB_ROOT}']}

    all_files = []
    category_stats = {}

    for cat_dir in sorted(KB_ROOT.iterdir()):
        if not cat_dir.is_dir():
            continue
        cat_id = cat_dir.name.split('_')[0]
        cat_name = cat_dir.name.split('_', 1)[1] if '_' in cat_dir.name else cat_dir.name

        if categories and cat_id not in categories:
            continue

        files = []
        if include_subdirs:
            for f in cat_dir.rglob('*.md'):
                files.append(f)
        else:
            for f in cat_dir.glob('*.md'):
                files.append(f)

        file_infos = []
        for f in files:
            try:
                stat = f.stat()
                content = f.read_text(encoding='utf-8', errors='ignore')
                file_hash = hashlib.md5(content.encode('utf-8')).hexdigest()
                # 提取标题
                title = f.stem
                for line in content.split('\n')[:10]:
                    if line.startswith('#'):
                        title = line.lstrip('#').strip()
                        break
                # 提取摘要（前200字符）
                excerpt = content[:300].replace('\n', ' ').strip()
                file_infos.append({
                    'path': str(f),
                    'relative_path': str(f.relative_to(KB_ROOT)),
                    'filename': f.name,
                    'category_id': cat_id,
                    'category_name': cat_name,
                    'title': title,
                    'size': stat.st_size,
                    'hash': file_hash,
                    'excerpt': excerpt,
                    'modified_at': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
            except Exception as e:
                file_infos.append({
                    'path': str(f), 'filename': f.name,
                    'category_id': cat_id, 'category_name': cat_name,
                    'error': str(e),
                })

        all_files.extend(file_infos)
        category_stats[cat_id] = {
            'name': cat_name,
            'file_count': len(file_infos),
            'total_size': sum(fi.get('size', 0) for fi in file_infos),
        }

    return {
        'success': True,
        'total_files': len(all_files),
        'categories': category_stats,
        'files': all_files,
    }


def get_kb_categories_stats() -> Dict:
    """获取知识库分类统计（只读，不扫描内容）"""
    if not KB_ROOT.exists():
        return {'success': False, 'errors': ['知识库目录不存在']}

    stats = {}
    for cat_dir in sorted(KB_ROOT.iterdir()):
        if not cat_dir.is_dir():
            continue
        cat_id = cat_dir.name.split('_')[0]
        cat_name = cat_dir.name.split('_', 1)[1] if '_' in cat_dir.name else cat_dir.name
        md_files = list(cat_dir.rglob('*.md'))
        stats[cat_id] = {
            'name': cat_name,
            'dir': cat_dir.name,
            'file_count': len(md_files),
            'allowed_import': cat_id in ALLOWED_IMPORT_CATEGORIES,
        }
    return {'success': True, 'categories': stats, 'total_categories': len(stats)}


def get_fact_by_source_hash(source_hash: str) -> Optional[Dict]:
    """按 source_hash 查找事实（用于重复检测）"""
    init_db()
    c = _conn()
    row = c.execute("SELECT * FROM knowledge_facts WHERE source_hash=?", (source_hash,)).fetchone()
    c.close()
    return _row_to_fact(row) if row else None


def detect_duplicates(file_paths: List[str]) -> Dict:
    """检测文件内容重复：与已有事实对比，以及文件之间对比"""
    init_db()
    results = []
    file_hashes = {}

    for fp in file_paths:
        p = Path(fp)
        if not p.exists():
            results.append({'file': fp, 'status': 'error', 'reason': '文件不存在'})
            continue
        content = p.read_text(encoding='utf-8', errors='ignore')
        fhash = hashlib.md5(content.encode('utf-8')).hexdigest()

        # 检查与已有事实重复
        existing = get_fact_by_source_hash(fhash)
        if existing:
            results.append({
                'file': fp, 'hash': fhash, 'status': 'duplicate_existing',
                'existing_fact_id': existing['fact_id'],
                'existing_title': existing['title'],
            })
        # 检查与本次其他文件重复
        elif fhash in file_hashes:
            results.append({
                'file': fp, 'hash': fhash, 'status': 'duplicate_in_batch',
                'duplicate_of': file_hashes[fhash],
            })
        else:
            file_hashes[fhash] = fp
            results.append({'file': fp, 'hash': fhash, 'status': 'new'})

    return {'success': True, 'results': results,
            'new_count': sum(1 for r in results if r['status'] == 'new'),
            'duplicate_count': sum(1 for r in results if r['status'] != 'new')}


def detect_conflicts(file_paths: List[str]) -> Dict:
    """检测内容冲突：同标题但内容不同，或同来源但 hash 不同"""
    init_db()
    conflicts = []
    file_titles = {}

    for fp in file_paths:
        p = Path(fp)
        if not p.exists():
            continue
        content = p.read_text(encoding='utf-8', errors='ignore')
        title = p.stem
        for line in content.split('\n')[:10]:
            if line.startswith('#'):
                title = line.lstrip('#').strip()
                break

        # 检查同标题已有事实
        c = _conn()
        existing = c.execute("SELECT fact_id, title, source_hash FROM knowledge_facts WHERE title=?", (title,)).fetchall()
        c.close()

        for row in existing:
            new_hash = hashlib.md5(content.encode('utf-8')).hexdigest()
            if row['source_hash'] != new_hash:
                conflicts.append({
                    'file': fp, 'title': title, 'type': 'title_content_mismatch',
                    'existing_fact_id': row['fact_id'],
                    'existing_hash': row['source_hash'],
                    'new_hash': new_hash,
                })

        # 检查本次批次内同标题
        if title in file_titles:
            conflicts.append({
                'file': fp, 'title': title, 'type': 'duplicate_title_in_batch',
                'duplicate_of': file_titles[title],
            })
        else:
            file_titles[title] = fp

    return {'success': True, 'conflicts': conflicts, 'conflict_count': len(conflicts)}


def import_kb_dry_run_enhanced(file_paths: List[str],
                               detect_dup: bool = True,
                               detect_conf: bool = True) -> Dict:
    """增强版 dry-run：包含重复检测、冲突检测、来源元数据"""
    results = []
    all_conflicts = []

    # 先做重复和冲突检测
    if detect_dup:
        dup_result = detect_duplicates(file_paths)
        dup_map = {r['file']: r for r in dup_result['results']}
    else:
        dup_map = {}

    if detect_conf:
        conf_result = detect_conflicts(file_paths)
        conf_map = {}
        for c in conf_result['conflicts']:
            conf_map.setdefault(c['file'], []).append(c)
    else:
        conf_map = {}

    for fp in file_paths:
        p = Path(fp)
        if not p.exists():
            all_conflicts.append({'file': fp, 'error': '文件不存在'})
            continue

        try:
            content = p.read_text(encoding='utf-8', errors='ignore')
            content_hash = hashlib.md5(content.encode('utf-8')).hexdigest()

            title = p.stem
            for line in content.split('\n')[:10]:
                if line.startswith('#'):
                    title = line.lstrip('#').strip()
                    break

            excerpt = content[:500].replace('\n', ' ').strip()

            # 推断产品品类
            product_categories = []
            for keyword, cat in PRODUCT_CATEGORY_MAP.items():
                if keyword in title or keyword in content[:1000]:
                    product_categories.append(cat)

            # 推断目标市场
            target_markets = []
            for keyword, market in MARKET_KEYWORDS.items():
                if keyword in title or keyword in content[:2000]:
                    if market not in target_markets:
                        target_markets.append(market)

            # 推断买家类型
            buyer_types = []
            for keyword, btype in BUYER_TYPE_KEYWORDS.items():
                if keyword in title or keyword in content[:2000]:
                    if btype not in buyer_types:
                        buyer_types.append(btype)

            fact_preview = {
                'title': title,
                'content': content[:2000],
                'source_type': 'document',
                'source_document': str(p),
                'source_locator': p.name,
                'source_excerpt': excerpt,
                'source_hash': content_hash,
                'source_captured_at': _now(),
                'review_status': 'pending',
                'public_use_allowed': False,
                'inferred_product_categories': product_categories,
                'inferred_target_markets': target_markets,
                'inferred_buyer_types': buyer_types,
                'duplicate_status': dup_map.get(fp, {}).get('status', 'not_checked'),
                'conflict_count': len(conf_map.get(fp, [])),
            }

            if fp in dup_map and dup_map[fp]['status'] != 'new':
                fact_preview['duplicate_info'] = dup_map[fp]
            if fp in conf_map:
                fact_preview['conflicts'] = conf_map[fp]

            results.append(fact_preview)
        except Exception as e:
            all_conflicts.append({'file': fp, 'error': str(e)})

    return {
        'success': True,
        'preview': results,
        'conflicts': all_conflicts,
        'will_import_count': sum(1 for r in results if r['duplicate_status'] == 'new' and r['conflict_count'] == 0),
        'duplicate_count': sum(1 for r in results if r['duplicate_status'] != 'new'),
        'conflict_file_count': sum(1 for r in results if r['conflict_count'] > 0),
    }


def import_selected_kb_files_enhanced(file_paths: List[str],
                                      actor: str = "system",
                                      skip_duplicates: bool = True,
                                      skip_conflicts: bool = True) -> Dict:
    """增强版导入：保留完整元数据，支持跳过重复和冲突"""
    # 先做 dry-run 检查
    dry_run = import_kb_dry_run_enhanced(file_paths)
    imported = []
    skipped = []
    errors = []

    for item in dry_run['preview']:
        fp = item['source_document']

        if skip_duplicates and item['duplicate_status'] != 'new':
            skipped.append({'file': fp, 'reason': 'duplicate', 'info': item.get('duplicate_info')})
            continue

        if skip_conflicts and item['conflict_count'] > 0:
            skipped.append({'file': fp, 'reason': 'conflict', 'conflicts': item.get('conflicts')})
            continue

        result = create_knowledge_fact({
            'title': item['title'],
            'content': item['content'],
            'source_type': 'document',
            'source_document': item['source_document'],
            'source_locator': item['source_locator'],
            'source_excerpt': item['source_excerpt'],
            'source_hash': item['source_hash'],
            'source_captured_at': item['source_captured_at'],
            'tags': item.get('inferred_buyer_types', []),
            'linked_product_categories': item.get('inferred_product_categories', []),
        })
        if result['success']:
            imported.append(result['fact']['fact_id'])
        else:
            errors.append({'file': fp, 'errors': result['errors']})

    return {
        'success': len(errors) == 0,
        'imported_fact_ids': imported,
        'imported_count': len(imported),
        'skipped': skipped,
        'skipped_count': len(skipped),
        'errors': errors,
    }


def search_knowledge_facts_enhanced(query: str = "",
                                    product_category: Optional[str] = None,
                                    target_market: Optional[str] = None,
                                    buyer_type: Optional[str] = None,
                                    status: Optional[str] = None,
                                    public_only: bool = False,
                                    fact_type: Optional[str] = None,
                                    limit: int = 50) -> Dict:
    """增强检索：按关键词、产品品类、目标市场、买家类型、状态、公开权限筛选"""
    init_db()
    c = _conn()

    sql = "SELECT * FROM knowledge_facts WHERE 1=1"
    params = []

    if query:
        sql += " AND (title LIKE ? OR content LIKE ? OR tags LIKE ? OR source_document LIKE ?)"
        params.extend([f"%{query}%"] * 4)

    if product_category:
        sql += " AND linked_product_categories LIKE ?"
        params.append(f"%{product_category}%")

    if buyer_type:
        sql += " AND tags LIKE ?"
        params.append(f"%{buyer_type}%")

    if status:
        sql += " AND review_status=?"
        params.append(status)

    if fact_type:
        sql += " AND type=?"
        params.append(fact_type)

    if public_only:
        sql += " AND public_use_allowed=1 AND review_status='confirmed'"

    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)

    rows = c.execute(sql, params).fetchall()
    c.close()

    facts = [_row_to_fact(r) for r in rows]

    # 目标市场过滤（在内容中搜索市场关键词）
    if target_market:
        filtered = []
        for f in facts:
            if target_market.lower() in f.get('content', '').lower() or \
               target_market.lower() in f.get('title', '').lower():
                filtered.append(f)
        facts = filtered

    return {
        'success': True,
        'results': facts,
        'total': len(facts),
        'filters': {
            'query': query, 'product_category': product_category,
            'target_market': target_market, 'buyer_type': buyer_type,
            'status': status, 'public_only': public_only, 'fact_type': fact_type,
        },
    }


def get_public_facts(limit: int = 100) -> Dict:
    """获取所有可对外使用的事实（confirmed + public_use_allowed=true）"""
    facts = list_knowledge_facts(public_only=True, limit=limit)
    return {
        'success': True,
        'facts': facts,
        'total': len(facts),
        'note': '仅返回 confirmed 且 public_use_allowed=true 的事实',
    }


def get_fact_source_trace(fact_id: str) -> Dict:
    """获取事实的完整来源追溯信息"""
    fact = get_knowledge_fact(fact_id)
    if not fact:
        return {'success': False, 'errors': ['事实不存在']}

    trace = {
        'fact_id': fact['fact_id'],
        'title': fact['title'],
        'review_status': fact['review_status'],
        'public_use_allowed': fact['public_use_allowed'],
        'source': {
            'type': fact.get('source_type'),
            'document': fact.get('source_document'),
            'locator': fact.get('source_locator'),
            'excerpt': fact.get('source_excerpt'),
            'url': fact.get('source_url'),
            'hash': fact.get('source_hash'),
            'captured_at': fact.get('source_captured_at'),
        },
        'review': {
            'reviewed_by': fact.get('reviewed_by'),
            'reviewed_at': fact.get('reviewed_at'),
            'notes': fact.get('review_notes'),
        },
        'version': fact['version'],
        'confidence': fact.get('confidence'),
        'claim_subject': fact.get('claim_subject'),
    }

    # 验证来源可复核性
    source_verifiable = (
        (fact.get('source_url') and _safe_url(fact['source_url'])) or
        (fact.get('source_document') and fact.get('source_locator')) or
        fact.get('source_hash')
    )
    trace['source_verifiable'] = bool(source_verifiable)

    return {'success': True, 'trace': trace}


def get_kb_import_readiness_report() -> Dict:
    """知识库导入就绪报告：统计可导入、已导入、重复、冲突"""
    init_db()

    # 扫描所有文件
    scan_result = scan_kb_files(categories=ALLOWED_IMPORT_CATEGORIES)
    if not scan_result['success']:
        return scan_result

    all_files = scan_result['files']
    total_files = len(all_files)

    # 检查已导入
    c = _conn()
    imported_count = c.execute("SELECT COUNT(*) as cnt FROM knowledge_facts WHERE source_type='document'").fetchone()['cnt']
    c.close()

    # 检测重复（抽样前100个避免太慢）
    sample_files = [f['path'] for f in all_files[:100]]
    dup_result = detect_duplicates(sample_files)

    return {
        'success': True,
        'allowed_categories': ALLOWED_IMPORT_CATEGORIES,
        'total_files_in_allowed_categories': total_files,
        'already_imported': imported_count,
        'sample_duplicate_check': {
            'sample_size': len(sample_files),
            'new': dup_result['new_count'],
            'duplicates': dup_result['duplicate_count'],
        },
        'categories': scan_result['categories'],
        'recommendation': f'可导入 {total_files} 个文件，建议分批导入并人工审核',
    }
