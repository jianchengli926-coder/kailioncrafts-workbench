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
