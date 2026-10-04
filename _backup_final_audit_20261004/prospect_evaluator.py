# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - 精准客户 ICP 评估与 Knowledge Pack 绑定
P1.2C: 知识驱动的客户资格评估

安全规则：
- hard_blockers 优先级高于 ICP 分数
- 高 ICP 分数不能绕过任何 hard blocker
- 只有 approved Pack 可以绑定
- 历史评估锁定原始 snapshot，不被后续 Fact 更新覆盖
- 重复客户和 DNC 检测必须返回证据，不泄露完整联系方式
"""
import sqlite3
import json
import hashlib
import os
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple
from urllib.parse import urlparse

import knowledge_facts as kf

# ============ repository / website_evidence 可选导入 ============
# 新模块不可用时，现有评估流程不受影响
try:
    import repository as _repo
    _REPO_AVAILABLE = True
except Exception:  # pragma: no cover - 降级路径
    _repo = None
    _REPO_AVAILABLE = False

try:
    import website_evidence as _we
    _WEBSITE_EVIDENCE_AVAILABLE = True
except Exception:  # pragma: no cover - 降级路径
    _we = None
    _WEBSITE_EVIDENCE_AVAILABLE = False


def _get_repo():
    """惰性创建 CustomerRepository；不可用返回 None。"""
    if not _REPO_AVAILABLE:
        return None
    try:
        return _repo.CustomerRepository()
    except Exception:
        return None

DB_PATH = Path(os.environ.get("WORKBENCH_DB_PATH",
    str(Path(__file__).parent / "data" / "workbench.db")))

IDENTITY_STATUSES = ["verified", "partial", "unresolved"]
PRODUCT_FIT_LEVELS = ["strong", "possible", "weak", "unknown"]
MARKET_FIT_LEVELS = ["strong", "possible", "weak", "unknown"]
BUYER_TYPES = ["wholesaler", "distributor", "retailer", "brand_owner", "ecommerce", "oem_buyer", "odm_buyer", "unknown"]


def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=5000")
    return c


def _now():
    return datetime.utcnow().isoformat() + "Z"


def _gen_id(prefix: str) -> str:
    return f"{prefix}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{hashlib.md5(_now().encode()).hexdigest()[:8]}"


def _safe_url(url: str) -> bool:
    """检查 URL 是否为安全的 http/https"""
    if not url:
        return False
    try:
        parsed = urlparse(url)
        return parsed.scheme in ('http', 'https') and bool(parsed.netloc)
    except Exception:
        return False


def _normalize_company_name(name: str) -> str:
    """标准化公司名称用于重复检测"""
    if not name:
        return ""
    name = name.lower().strip()
    # 移除常见后缀
    for suffix in [' co., ltd', ' co ltd', ' co.,ltd', ' ltd', ' inc', ' corp', ' corporation', ' gmbh', ' s.a.', ' s.a', ' llc']:
        if name.endswith(suffix):
            name = name[:-len(suffix)].strip()
    # 移除特殊字符
    name = re.sub(r'[^a-z0-9\s]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


def _normalize_website(url: str) -> str:
    """标准化网站用于重复检测"""
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain
    except Exception:
        return ""


def init_db():
    """初始化评估相关表，可重复执行"""
    c = _conn()
    cur = c.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS prospect_evaluations (
        evaluation_id TEXT PRIMARY KEY,
        customer_id TEXT,
        company_name TEXT,
        website TEXT,
        country TEXT,
        buyer_type TEXT,
        identity_status TEXT,
        company_type TEXT,
        product_fit TEXT,
        market_fit TEXT,
        icp_score INTEGER DEFAULT 0,
        eligible INTEGER DEFAULT 0,
        hard_blockers TEXT,
        risk_flags TEXT,
        missing_evidence TEXT,
        evidence TEXT,
        recommended_next_action TEXT,
        knowledge_pack_id TEXT,
        knowledge_pack_version INTEGER,
        knowledge_snapshot_hash TEXT,
        fact_ids TEXT,
        fact_versions TEXT,
        evaluated_at TEXT,
        evaluated_by TEXT,
        created_at TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS customer_pack_bindings (
        binding_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        knowledge_pack_id TEXT NOT NULL,
        knowledge_pack_version INTEGER NOT NULL,
        knowledge_snapshot_hash TEXT NOT NULL,
        knowledge_bound_at TEXT,
        knowledge_bound_by TEXT,
        frozen_fact_ids TEXT,
        frozen_fact_versions TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS duplicate_detections (
        detection_id TEXT PRIMARY KEY,
        customer_id TEXT,
        matched_customer_id TEXT,
        matched_field TEXT,
        matched_value_hash TEXT,
        detected_at TEXT,
        confidence REAL DEFAULT 0.0,
        details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_eval_customer ON prospect_evaluations(customer_id);
    CREATE INDEX IF NOT EXISTS idx_binding_customer ON customer_pack_bindings(customer_id);
    CREATE INDEX IF NOT EXISTS idx_dup_customer ON duplicate_detections(customer_id);
    """)
    c.commit()
    c.close()


# ============ 重复客户与 DNC 检测 ============

def detect_duplicate_customer(customer_input: Dict, exclude_customer_id: Optional[str] = None) -> Dict:
    """检测重复客户，返回证据（不泄露完整联系方式）。
    P1修复：增加exclude_customer_id参数，重新评估已有客户时排除自身匹配。
    """
    init_db()
    results = []

    company_norm = _normalize_company_name(customer_input.get('company_name', ''))
    website_norm = _normalize_website(customer_input.get('website', ''))

    def _is_excluded(cid):
        """判断是否为需要排除的自身记录"""
        if not exclude_customer_id:
            return False
        return cid == exclude_customer_id

    # 检查现有 customers.json
    customers_file = Path(__file__).parent / "data" / "customers.json"
    if customers_file.exists():
        try:
            with open(customers_file, 'r', encoding='utf-8') as f:
                existing = json.load(f)
            for cust in existing:
                if not isinstance(cust, dict):
                    continue
                cid = cust.get('id', 'unknown')
                if _is_excluded(cid):
                    continue
                # 公司名称匹配
                if company_norm and _normalize_company_name(cust.get('company_name', '')) == company_norm:
                    results.append({
                        'matched_customer_id': cid,
                        'matched_field': 'company_name',
                        'matched_value_hash': hashlib.md5(company_norm.encode()).hexdigest()[:16],
                        'confidence': 0.9,
                    })
                # 网站匹配
                if website_norm and _normalize_website(cust.get('website', '')) == website_norm:
                    results.append({
                        'matched_customer_id': cid,
                        'matched_field': 'website',
                        'matched_value_hash': hashlib.md5(website_norm.encode()).hexdigest()[:16],
                        'confidence': 0.95,
                    })
        except Exception:
            return {'is_duplicate': True, 'matches': [], 'detection_count': 0, 'error': 'detection_failed'}

    # 检查数据库中的评估记录
    c = _conn()
    try:
        rows = c.execute("SELECT DISTINCT customer_id, company_name, website FROM prospect_evaluations").fetchall()
        for row in rows:
            cid = row['customer_id']
            if _is_excluded(cid):
                continue
            if company_norm and _normalize_company_name(row['company_name'] or '') == company_norm:
                results.append({
                    'matched_customer_id': cid,
                    'matched_field': 'company_name',
                    'matched_value_hash': hashlib.md5(company_norm.encode()).hexdigest()[:16],
                    'confidence': 0.85,
                })
            if website_norm and _normalize_website(row['website'] or '') == website_norm:
                results.append({
                    'matched_customer_id': cid,
                    'matched_field': 'website',
                    'matched_value_hash': hashlib.md5(website_norm.encode()).hexdigest()[:16],
                    'confidence': 0.9,
                })
    finally:
        c.close()

    # 检查 repository prospects 表（统一 SQLite 层）
    repo = _get_repo()
    if repo is not None:
        try:
            dup = repo.check_duplicate(
                company_name=customer_input.get('company_name'),
                website=customer_input.get('website'),
                email=customer_input.get('email'),
            )
            for m in dup.get('matches', []):
                cid = m.get('customer_id', 'unknown')
                if _is_excluded(cid):
                    continue
                results.append({
                    'matched_customer_id': cid,
                    'matched_field': m.get('field', 'unknown'),
                    'matched_value_hash': hashlib.md5(
                        str(cid).encode()).hexdigest()[:16],
                    'confidence': m.get('confidence', 0.9),
                    'source': 'repository',
                })
        except Exception:
            return {'is_duplicate': True, 'matches': [], 'detection_count': 0, 'error': 'detection_failed'}

    # 去重
    seen = set()
    unique_results = []
    for r in results:
        key = (r['matched_customer_id'], r['matched_field'])
        if key not in seen:
            seen.add(key)
            unique_results.append(r)

    return {
        'is_duplicate': len(unique_results) > 0,
        'matches': unique_results,
        'detection_count': len(unique_results),
    }


def check_dnc(customer_input: Dict) -> Dict:
    """检查 DNC / 不联系名单（不泄露完整联系方式）"""
    init_db()
    dnc_matches = []

    # 检查客户备注中的 DNC 标记
    customers_file = Path(__file__).parent / "data" / "customers.json"
    if customers_file.exists():
        try:
            with open(customers_file, 'r', encoding='utf-8') as f:
                existing = json.load(f)
            company_norm = _normalize_company_name(customer_input.get('company_name', ''))
            website_norm = _normalize_website(customer_input.get('website', ''))
            for cust in existing:
                if not isinstance(cust, dict):
                    continue
                notes = (cust.get('notes', '') or '').lower()
                status = (cust.get('status', '') or '').lower()
                is_dnc = any(kw in notes or kw in status for kw in ['dnc', 'do not contact', '不联系', '拒绝联系', '退订', 'unsubscribe', 'opt-out', 'opt out'])
                if is_dnc:
                    if (company_norm and _normalize_company_name(cust.get('company_name', '')) == company_norm) or \
                       (website_norm and _normalize_website(cust.get('website', '')) == website_norm):
                        dnc_matches.append({
                            'matched_customer_id': cust.get('id', 'unknown'),
                            'reason': 'DNC标记',
                            'detected_at': _now(),
                        })
        except Exception:
            return {'is_dnc': True, 'matches': [], 'error': 'dnc_check_failed'}

    # 检查 repository suppression_list + prospects.status=dnc
    repo = _get_repo()
    if repo is not None:
        try:
            d = repo.check_dnc(
                company_name=customer_input.get('company_name'),
                website=customer_input.get('website'),
                email=customer_input.get('email'),
            )
            for m in d.get('matches', []):
                dnc_matches.append({
                    'matched_customer_id': m.get('customer_id') or m.get('suppression_id') or 'unknown',
                    'reason': m.get('reason') or m.get('source') or 'suppression_list',
                    'detected_at': _now(),
                    'source': 'repository',
                })
        except Exception:
            return {'is_dnc': True, 'matches': [], 'error': 'dnc_check_failed'}

    return {
        'is_dnc': len(dnc_matches) > 0,
        'matches': dnc_matches,
    }


# ============ Knowledge Pack 绑定 ============

def validate_customer_pack_binding(pack_id: str, pack_version: Optional[int] = None) -> Dict:
    """验证 Pack 是否可用于绑定"""
    pack = kf.get_knowledge_pack(pack_id)
    if not pack:
        return {'valid': False, 'errors': ['Knowledge Pack 不存在']}

    if pack['status'] == 'draft':
        return {'valid': False, 'errors': ['Knowledge Pack 为 draft，不能绑定']}

    if pack['status'] == 'archived':
        return {'valid': False, 'errors': ['Knowledge Pack 已归档，不能用于新绑定']}

    if pack['status'] != 'approved':
        return {'valid': False, 'errors': [f'Knowledge Pack 状态为 {pack["status"]}，不能绑定']}

    if not pack.get('knowledge_snapshot_hash'):
        return {'valid': False, 'errors': ['Knowledge Pack 缺少 snapshot hash']}

    if not pack.get('frozen_fact_snapshots'):
        return {'valid': False, 'errors': ['Knowledge Pack 缺少冻结事实快照']}

    if pack_version and pack['version'] != pack_version:
        return {'valid': False, 'errors': [f'版本不匹配：期望 {pack_version}，实际 {pack["version"]}']}

    return {'valid': True, 'pack': pack}


def bind_knowledge_pack_to_customer(customer_id: str, pack_id: str,
                                    bound_by: str = "system") -> Dict:
    """为客户绑定 Knowledge Pack，保存版本和 snapshot hash"""
    init_db()

    validation = validate_customer_pack_binding(pack_id)
    if not validation['valid']:
        return {'success': False, 'errors': validation['errors']}

    pack = validation['pack']
    binding_id = _gen_id("binding")
    now = _now()

    # 提取冻结事实 ID 和版本
    frozen_fact_ids = []
    frozen_fact_versions = []
    for snap in pack.get('frozen_fact_snapshots', []):
        frozen_fact_ids.append(snap.get('fact_id'))
        frozen_fact_versions.append(snap.get('version'))

    c = _conn()
    try:
        c.execute("""INSERT INTO customer_pack_bindings
            (binding_id, customer_id, knowledge_pack_id, knowledge_pack_version,
             knowledge_snapshot_hash, knowledge_bound_at, knowledge_bound_by,
             frozen_fact_ids, frozen_fact_versions, status, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (binding_id, customer_id, pack_id, pack['version'],
             pack['knowledge_snapshot_hash'], now, bound_by,
             json.dumps(frozen_fact_ids), json.dumps(frozen_fact_versions),
             'active', now, now))
        c.commit()
        return {
            'success': True,
            'binding_id': binding_id,
            'knowledge_pack_id': pack_id,
            'knowledge_pack_version': pack['version'],
            'knowledge_snapshot_hash': pack['knowledge_snapshot_hash'],
        }
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f'数据库错误: {str(e)}']}
    finally:
        c.close()


def get_customer_knowledge_binding(customer_id: str) -> Optional[Dict]:
    """获取客户的当前有效 Pack 绑定"""
    init_db()
    c = _conn()
    row = c.execute("""SELECT * FROM customer_pack_bindings
        WHERE customer_id=? AND status='active' ORDER BY created_at DESC LIMIT 1""",
        (customer_id,)).fetchone()
    c.close()
    if not row:
        return None
    d = dict(row)
    d['frozen_fact_ids'] = json.loads(d['frozen_fact_ids']) if d.get('frozen_fact_ids') else []
    d['frozen_fact_versions'] = json.loads(d['frozen_fact_versions']) if d.get('frozen_fact_versions') else []
    return d


# ============ ICP 评估 ============

def _evaluate_product_fit(customer_input: Dict, pack: Dict) -> Tuple[str, List[str], List[str]]:
    """评估产品匹配度，返回 (fit_level, evidence, missing_evidence)"""
    evidence = []
    missing = []
    customer_products = customer_input.get('product_categories', []) or customer_input.get('main_products', [])
    pack_products = pack.get('product_categories', [])

    if not customer_products:
        missing.append('客户产品类别缺失')
        return 'unknown', evidence, missing

    if not pack_products:
        missing.append('Knowledge Pack 未定义产品范围')
        return 'unknown', evidence, missing

    # 计算匹配
    customer_set = set(str(p).lower() for p in customer_products)
    pack_set = set(str(p).lower() for p in pack_products)
    overlap = customer_set & pack_set

    if overlap:
        evidence.append(f"产品类别匹配: {', '.join(overlap)}")
        if len(overlap) >= min(len(customer_set), len(pack_set)) * 0.5:
            return 'strong', evidence, missing
        return 'possible', evidence, missing

    missing.append(f"客户产品 {customer_products} 与 Pack 产品范围 {pack_products} 无直接匹配")
    return 'weak', evidence, missing


def _evaluate_market_fit(customer_input: Dict, pack: Dict) -> Tuple[str, List[str], List[str]]:
    """评估市场匹配度"""
    evidence = []
    missing = []
    customer_country = (customer_input.get('country') or '').lower()
    customer_region = (customer_input.get('region') or '').lower()
    pack_markets = [str(m).lower() for m in pack.get('target_markets', [])]

    if not customer_country and not customer_region:
        missing.append('客户国家/地区缺失')
        return 'unknown', evidence, missing

    if not pack_markets:
        return 'possible', ['Pack 未限定目标市场，默认可用'], missing

    for market in pack_markets:
        if market in customer_country or market in customer_region:
            evidence.append(f"目标市场匹配: {market}")
            return 'strong', evidence, missing

    missing.append(f"客户市场 {customer_country or customer_region} 不在 Pack 目标市场 {pack_markets} 中")
    return 'weak', evidence, missing


def _check_product_facts_available(pack: Dict, customer_input: Dict) -> Tuple[bool, List[str]]:
    """检查所需产品类别是否有可对外使用的 confirmed Fact"""
    missing = []
    frozen_facts = pack.get('frozen_fact_snapshots', [])
    if not frozen_facts:
        return False, ['Pack 没有冻结事实']

    customer_products = customer_input.get('product_categories', [])
    if not customer_products:
        return True, []  # 没有指定产品，不阻断

    for product in customer_products:
        product_lower = str(product).lower()
        found = False
        for fact in frozen_facts:
            fact_categories = [str(c).lower() for c in fact.get('linked_product_categories', [])]
            fact_tags = [str(t).lower() for t in fact.get('tags', [])]
            if product_lower in fact_categories or product_lower in fact_tags:
                if fact.get('public_use_allowed') and fact.get('review_status') == 'confirmed':
                    found = True
                    break
        if not found:
            missing.append(f"产品类别 '{product}' 没有可对外使用的 confirmed Fact")

    return len(missing) == 0, missing


def evaluate_customer_icp(customer_input: Dict, pack_ref: Optional[Dict] = None,
                          evaluated_by: str = "system",
                          website_evidence: Optional[Dict] = None) -> Dict:
    """
    评估客户 ICP，返回完整评估结果。
    pack_ref: {'pack_id': ..., 'pack_version': ...} 或 None
    website_evidence: 外部已抓取的网站证据（dict），传入则不重复抓取；
                      若 customer_input.fetch_website=True 且本参数为 None，则自动抓取。
    """
    init_db()
    now = _now()
    evaluation_id = _gen_id("eval")

    hard_blockers = []
    risk_flags = []
    evidence = []
    missing_evidence = []

    # 0. 可选：抓取网站证据（SSRF/robots 安全检查在 website_evidence 内部完成）
    if website_evidence is None and customer_input.get("fetch_website") and _WEBSITE_EVIDENCE_AVAILABLE:
        try:
            _url = customer_input.get("website", "")
            _cid = customer_input.get("customer_id", "")
            if _url and _we.is_safe_url(_url)[0]:
                website_evidence = _we.fetch_website_evidence(_cid, _url)
        except Exception:
            website_evidence = None
    if website_evidence:
        evidence.append({
            'type': 'website_evidence',
            'status': website_evidence.get('status'),
            'title': website_evidence.get('title', ''),
            'main_products': website_evidence.get('main_products', []),
            'country': website_evidence.get('country', ''),
        })
        if website_evidence.get('status') not in ('success', 'too_large'):
            risk_flags.append(f"网站证据抓取失败/受限: {website_evidence.get('status')}")

    # 1. 身份验证检查
    identity_status = 'unresolved'
    has_company = bool(customer_input.get('company_name'))
    has_website = bool(customer_input.get('website'))
    has_source = bool(customer_input.get('source_document') or customer_input.get('source_url'))

    if has_company and has_website and has_source:
        identity_status = 'verified'
    elif has_company and (has_website or has_source):
        identity_status = 'partial'
    else:
        identity_status = 'unresolved'

    if identity_status == 'unresolved':
        hard_blockers.append('identity_status=unresolved：客户身份无法确认')

    # 2. 公司名称检查
    if not has_company:
        hard_blockers.append('company_name 缺失')

    # 3. 网站检查
    if not has_website:
        hard_blockers.append('website 缺失')
    elif not _safe_url(customer_input.get('website', '')):
        hard_blockers.append('website URL 不安全（仅允许 http/https）')

    # 4. 资料来源检查
    if not has_source:
        hard_blockers.append('资料来源不可验证（缺少 source_document 或 source_url）')

    # 5. 重复客户检测（P1修复：排除当前客户自身，避免重新评估时被判为重复）
    dup_result = detect_duplicate_customer(customer_input,
        exclude_customer_id=customer_input.get('customer_id') or customer_input.get('id'))
    if dup_result['is_duplicate']:
        hard_blockers.append(f'duplicate customer：检测到 {dup_result["detection_count"]} 个匹配记录')
        evidence.append({
            'type': 'duplicate_detection',
            'matches': dup_result['matches'],
        })

    # 6. DNC 检查
    dnc_result = check_dnc(customer_input)
    if dnc_result['is_dnc']:
        hard_blockers.append('DNC / do-not-contact：客户在不联系名单中')

    # 7. 明确拒绝联系检查
    notes = (customer_input.get('notes') or '').lower()
    if any(kw in notes for kw in ['拒绝联系', 'do not contact', 'dnc', '退订']):
        hard_blockers.append('明确拒绝联系')

    # 8. Knowledge Pack 检查
    pack = None
    pack_id = None
    pack_version = None
    snapshot_hash = None
    fact_ids = []
    fact_versions = []

    if pack_ref and pack_ref.get('pack_id'):
        pack_id = pack_ref['pack_id']
        validation = validate_customer_pack_binding(pack_id, pack_ref.get('pack_version'))
        if not validation['valid']:
            for err in validation['errors']:
                hard_blockers.append(f'Knowledge Pack: {err}')
        else:
            pack = validation['pack']
            pack_version = pack['version']
            snapshot_hash = pack['knowledge_snapshot_hash']
            for snap in pack.get('frozen_fact_snapshots', []):
                fact_ids.append(snap.get('fact_id'))
                fact_versions.append(snap.get('version'))
    else:
        risk_flags.append('未绑定 Knowledge Pack，仅可生成内部评估，不能进入对外开发流程')

    # 9. 产品信息检查
    if not customer_input.get('product_categories') and not customer_input.get('main_products'):
        missing_evidence.append('关键产品信息缺失')

    # 10. 产品 Fact 可用性检查
    if pack:
        facts_ok, facts_missing = _check_product_facts_available(pack, customer_input)
        if not facts_ok:
            for m in facts_missing:
                hard_blockers.append(f'产品 Fact 不可用: {m}')

    # 11. 产品匹配评估
    product_fit = 'unknown'
    if pack:
        product_fit, prod_evidence, prod_missing = _evaluate_product_fit(customer_input, pack)
        evidence.extend(prod_evidence)
        missing_evidence.extend(prod_missing)

    # 12. 市场匹配评估
    market_fit = 'unknown'
    if pack:
        market_fit, market_evidence, market_missing = _evaluate_market_fit(customer_input, pack)
        evidence.extend(market_evidence)
        missing_evidence.extend(market_missing)

    # 13. 高风险/合规检查
    buyer_type = customer_input.get('buyer_type', 'unknown')
    if buyer_type not in BUYER_TYPES:
        risk_flags.append(f'未知买家类型: {buyer_type}')

    # 14. 计算 ICP 分数（仅建议，不绕过 blocker）
    score = 0
    if identity_status == 'verified':
        score += 25
    elif identity_status == 'partial':
        score += 10
    if product_fit == 'strong':
        score += 30
    elif product_fit == 'possible':
        score += 15
    if market_fit == 'strong':
        score += 25
    elif market_fit == 'possible':
        score += 10
    if buyer_type in ['wholesaler', 'distributor', 'brand_owner', 'oem_buyer']:
        score += 10
    if has_source:
        score += 10
    score = min(score, 100)

    # 15. 推荐下一步
    if hard_blockers:
        recommended_next_action = '解决 hard blockers 后重新评估'
    elif not pack:
        recommended_next_action = '绑定 approved Knowledge Pack 后进行完整评估'
    elif product_fit == 'strong' and market_fit == 'strong':
        recommended_next_action = '可进入开发信草稿生成流程'
    elif product_fit == 'possible' or market_fit == 'possible':
        recommended_next_action = '补充产品/市场信息后重新评估'
    else:
        recommended_next_action = '客户匹配度较低，建议收集更多信息或调整目标'

    eligible = len(hard_blockers) == 0 and pack is not None

    # 保存评估结果
    c = _conn()
    try:
        c.execute("""INSERT INTO prospect_evaluations
            (evaluation_id, customer_id, company_name, website, country, buyer_type,
             identity_status, company_type, product_fit, market_fit, icp_score, eligible,
             hard_blockers, risk_flags, missing_evidence, evidence, recommended_next_action,
             knowledge_pack_id, knowledge_pack_version, knowledge_snapshot_hash,
             fact_ids, fact_versions, evaluated_at, evaluated_by, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (evaluation_id, customer_input.get('customer_id', ''),
             customer_input.get('company_name', ''), customer_input.get('website', ''),
             customer_input.get('country', ''), buyer_type,
             identity_status, customer_input.get('company_type', 'unknown'),
             product_fit, market_fit, score, int(eligible),
             json.dumps(hard_blockers, ensure_ascii=False),
             json.dumps(risk_flags, ensure_ascii=False),
             json.dumps(missing_evidence, ensure_ascii=False),
             json.dumps(evidence, ensure_ascii=False),
             recommended_next_action,
             pack_id, pack_version, snapshot_hash,
             json.dumps(fact_ids), json.dumps(fact_versions),
             now, evaluated_by, now, now))
        c.commit()
    except Exception as e:
        c.rollback()
        return {'success': False, 'errors': [f'数据库错误: {str(e)}']}
    finally:
        c.close()

    # 同步保存到统一 evaluations 表（repository），失败不影响主流程
    repo = _get_repo()
    if repo is not None:
        try:
            repo.save_evaluation({
                'customer_id': customer_input.get('customer_id', ''),
                'company_name': customer_input.get('company_name', ''),
                'website': customer_input.get('website', ''),
                'country': customer_input.get('country', ''),
                'buyer_type': buyer_type,
                'identity_status': identity_status,
                'product_fit': product_fit,
                'market_fit': market_fit,
                'icp_score': score,
                'eligible': int(eligible),
                'hard_blockers': hard_blockers,
                'risk_flags': risk_flags,
                'missing_evidence': missing_evidence,
                'evidence': evidence,
                'recommended_next_action': recommended_next_action,
                'knowledge_pack_id': pack_id,
                'knowledge_pack_version': pack_version,
                'evaluated_by': evaluated_by,
            })
        except Exception:
            pass

    return {
        'success': True,
        'evaluation_id': evaluation_id,
        'identity_status': identity_status,
        'company_type': customer_input.get('company_type', 'unknown'),
        'buyer_type': buyer_type,
        'product_fit': product_fit,
        'market_fit': market_fit,
        'icp_score': score,
        'eligible': eligible,
        'hard_blockers': hard_blockers,
        'risk_flags': risk_flags,
        'missing_evidence': missing_evidence,
        'evidence': evidence,
        'recommended_next_action': recommended_next_action,
        'knowledge_pack_id': pack_id,
        'knowledge_pack_version': pack_version,
        'knowledge_snapshot_hash': snapshot_hash,
        'fact_ids': fact_ids,
        'fact_versions': fact_versions,
        'evaluated_at': now,
        'evaluated_by': evaluated_by,
    }


def get_customer_qualification(customer_id: str, pack_ref: Optional[Dict] = None) -> Dict:
    """获取客户资格评估（组合 campaign eligibility 与 ICP evaluation）"""
    init_db()
    c = _conn()
    rows = c.execute("""SELECT * FROM prospect_evaluations
        WHERE customer_id=? ORDER BY evaluated_at DESC LIMIT 1""",
        (customer_id,)).fetchall()
    c.close()

    if not rows:
        return {'success': False, 'errors': ['未找到客户评估记录']}

    eval_row = dict(rows[0])
    for field in ['hard_blockers', 'risk_flags', 'missing_evidence', 'evidence', 'fact_ids', 'fact_versions']:
        if eval_row.get(field):
            eval_row[field] = json.loads(eval_row[field])
    eval_row['eligible'] = bool(eval_row['eligible'])

    return {
        'success': True,
        'customer_id': customer_id,
        'icp_evaluation': eval_row,
        'hard_blockers': eval_row['hard_blockers'],
        'eligible': eval_row['eligible'],
        'note': 'ICP 分数仅为建议，hard_blockers 优先级更高',
    }


def save_customer_evaluation(evaluation: Dict) -> Dict:
    """保存评估结果（通常由 evaluate_customer_icp 内部调用）"""
    # evaluate_customer_icp 已经保存，这里提供显式接口
    return {'success': True, 'note': '评估已在 evaluate_customer_icp 中保存'}


def get_customer_evaluation(evaluation_id: str) -> Optional[Dict]:
    """获取单个评估结果"""
    init_db()
    c = _conn()
    row = c.execute("SELECT * FROM prospect_evaluations WHERE evaluation_id=?", (evaluation_id,)).fetchone()
    c.close()
    if not row:
        return None
    d = dict(row)
    for field in ['hard_blockers', 'risk_flags', 'missing_evidence', 'evidence', 'fact_ids', 'fact_versions']:
        if d.get(field):
            d[field] = json.loads(d[field])
    d['eligible'] = bool(d['eligible'])
    return d


def list_customer_evaluations(customer_id: Optional[str] = None, limit: int = 50) -> List[Dict]:
    """列出评估结果"""
    init_db()
    c = _conn()
    if customer_id:
        rows = c.execute("SELECT * FROM prospect_evaluations WHERE customer_id=? ORDER BY evaluated_at DESC LIMIT ?",
                         (customer_id, limit)).fetchall()
    else:
        rows = c.execute("SELECT * FROM prospect_evaluations ORDER BY evaluated_at DESC LIMIT ?",
                         (limit,)).fetchall()
    c.close()
    results = []
    for row in rows:
        d = dict(row)
        for field in ['hard_blockers', 'risk_flags', 'missing_evidence', 'evidence']:
            if d.get(field):
                d[field] = json.loads(d[field])
        d['eligible'] = bool(d['eligible'])
        results.append(d)
    return results


# ============ 网站证据 + ICP 评估（P1.3 增强） ============

def evaluate_with_website_evidence(customer_input: Dict,
                                   pack_ref: Optional[Dict] = None) -> Dict:
    """先抓取网站证据，再执行 ICP 评估，返回合并结果。

    不自动发送任何消息；抓取失败时返回空/失败证据，评估照常进行。
    """
    website_evidence = None
    if _WEBSITE_EVIDENCE_AVAILABLE:
        _url = customer_input.get('website', '')
        _cid = customer_input.get('customer_id', '')
        if _url:
            try:
                if _we.is_safe_url(_url)[0]:
                    website_evidence = _we.fetch_website_evidence(_cid, _url)
            except Exception:
                website_evidence = None
    result = evaluate_customer_icp(customer_input, pack_ref=pack_ref,
                                   website_evidence=website_evidence)
    result['website_evidence'] = website_evidence
    return result


def get_customer_evaluation_summary(customer_id: str) -> Dict:
    """从 repository evaluations 表获取最新评估，返回精简摘要。

    Returns:
        {success, icp_score, eligible, hard_blockers, product_fit,
         market_fit, recommended_next_action}
    """
    repo = _get_repo()
    if repo is None:
        return {'success': False, 'error': 'repository_unavailable'}
    try:
        ev = repo.get_latest_evaluation(customer_id)
    except Exception as e:
        return {'success': False, 'error': str(e)}
    if not ev:
        return {'success': False, 'error': 'no_evaluation'}

    def _load(v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, ValueError):
                return v
        return v

    return {
        'success': True,
        'customer_id': customer_id,
        'icp_score': ev.get('icp_score', 0),
        'eligible': bool(ev.get('eligible', 0)),
        'hard_blockers': _load(ev.get('hard_blockers')) or [],
        'product_fit': ev.get('product_fit', 'unknown'),
        'market_fit': ev.get('market_fit', 'unknown'),
        'recommended_next_action': ev.get('recommended_next_action', ''),
    }
