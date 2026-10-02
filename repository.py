# -*- coding: utf-8 -*-
"""
repository.py — 客户开发闭环一期 SQLite 数据访问层

设计原则：
- 一期不重写工作台，新增 repository 层，新数据写入 SQLite
- 旧 customers.json 保留兼容读取
- 提供迁移和回滚方案
- 所有表使用 CREATE TABLE IF NOT EXISTS，可重复执行
"""

import sqlite3
import json
import hashlib
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DB_PATH = Path(os.environ.get("WORKBENCH_DB_PATH",
    str(Path(__file__).parent / "data" / "workbench.db")))

# 旧中文状态 -> 新英文状态映射
# 优先从 customer_status.py 导入，导入失败则使用内置映射
LEGACY_STATUS_MIGRATION: Dict[str, str] = {
    "新客户": "new_lead",
    "潜在客户": "potential",
    "已联系": "contacted",
    "跟进中": "following_up",
    "已报价": "quoted",
    "打样中": "sampling",
    "已成交": "closed_won",
    "已流失": "closed_lost",
    "无效": "invalid",
    "拒绝联系": "dnc",
    "待核实": "pending_verification",
}

try:  # pragma: no cover - 可选导入
    from customer_status import LEGACY_STATUS_MIGRATION as _EXT_MAP  # type: ignore
    if isinstance(_EXT_MAP, dict) and _EXT_MAP:
        LEGACY_STATUS_MIGRATION.update(_EXT_MAP)
except Exception:
    pass

# 销售漏斗阶段映射（status -> pipeline stage）
PIPELINE_STAGES = [
    ("lead", {"new_lead", "pending_verification"}),
    ("contacted", {"contacted", "first_sent"}),
    ("engaged", {"replied", "following_up", "engaged"}),
    ("quoted", {"quoted", "sampling"}),
    ("closed", {"closed_won"}),
]

# 有效客户状态（用于计算有效率）
NON_EFFECTIVE_STATUSES = {"new_lead", "pending_verification", "invalid", "dnc"}


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def _now() -> str:
    """返回 UTC ISO 时间字符串（与 prospect_evaluator.py 一致）。"""
    return datetime.utcnow().isoformat() + "Z"


def _today_str() -> str:
    """返回今天日期字符串 YYYY-MM-DD（UTC）。"""
    return datetime.utcnow().strftime("%Y-%m-%d")


def _dump_json(value: Any) -> Optional[str]:
    """将 list/dict 序列化为 JSON 字符串；None 原样返回。"""
    if value is None:
        return None
    if isinstance(value, (str, int, float)):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return None


def _load_json(value: Any) -> Any:
    """尝试将字符串解析为 JSON；失败则原样返回。"""
    if value is None:
        return None
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, ValueError):
        return value


# ---------------------------------------------------------------------------
# Repository 类
# ---------------------------------------------------------------------------

class CustomerRepository:
    """客户开发闭环 SQLite 数据访问层。"""

    def __init__(self, db_path: Optional[Path] = None):
        """
        初始化 Repository。

        Args:
            db_path: SQLite 数据库文件路径，默认使用模块级 DB_PATH。
        """
        self.db_path = Path(db_path) if db_path else DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    # ------------------------------------------------------------------ #
    # 连接管理
    # ------------------------------------------------------------------ #

    def _connect(self) -> sqlite3.Connection:
        """建立数据库连接，启用外键与 Row 工厂。"""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    # ------------------------------------------------------------------ #
    # ID 生成
    # ------------------------------------------------------------------ #

    def _gen_id(self, prefix: str) -> str:
        """
        生成通用 ID：{prefix}_{YYYYMMDDHHMMSS}_{md5[:8]}。

        Args:
            prefix: ID 前缀，如 cust、ev、draft、task、log、sup。

        Returns:
            生成的 ID 字符串。
        """
        ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        rand = hashlib.md5((_now() + prefix + ts).encode()).hexdigest()[:8]
        return f"{prefix}_{ts}_{rand}"

    def _gen_customer_id(self) -> str:
        """
        生成统一格式客户 ID：cust_{YYYYMMDD}_{md5[:6]}。

        Returns:
            新的 customer_id。
        """
        day = datetime.utcnow().strftime("%Y%m%d")
        rand = hashlib.md5((_now() + "cust" + day).encode()).hexdigest()[:6]
        return f"cust_{day}_{rand}"

    # ------------------------------------------------------------------ #
    # 建表
    # ------------------------------------------------------------------ #

    def init_db(self) -> None:
        """执行所有 CREATE TABLE IF NOT EXISTS 语句，可重复调用。"""
        ddl_statements = [
            # 1. prospects
            """
            CREATE TABLE IF NOT EXISTS prospects (
                customer_id TEXT PRIMARY KEY,
                company_name TEXT,
                website TEXT,
                country TEXT,
                source TEXT,
                status TEXT DEFAULT 'new_lead',
                grade TEXT DEFAULT 'C',
                score INTEGER DEFAULT 0,
                buyer_type TEXT,
                product_categories TEXT,
                main_products TEXT,
                contact_person TEXT,
                email TEXT,
                phone TEXT,
                notes TEXT,
                created_at TEXT,
                updated_at TEXT,
                legacy_id TEXT,
                migrated_at TEXT
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);",
            "CREATE INDEX IF NOT EXISTS idx_prospects_grade ON prospects(grade);",
            "CREATE INDEX IF NOT EXISTS idx_prospects_website ON prospects(website);",

            # 2. organizations
            """
            CREATE TABLE IF NOT EXISTS organizations (
                org_id TEXT PRIMARY KEY,
                customer_id TEXT,
                legal_name TEXT,
                brand_name TEXT,
                country TEXT,
                region TEXT,
                company_type TEXT,
                employee_range TEXT,
                revenue_range TEXT,
                founded_year TEXT,
                business_registration TEXT,
                created_at TEXT,
                updated_at TEXT
            );
            """,

            # 3. contacts
            """
            CREATE TABLE IF NOT EXISTS contacts (
                contact_id TEXT PRIMARY KEY,
                customer_id TEXT,
                full_name TEXT,
                job_title TEXT,
                email TEXT,
                phone TEXT,
                linkedin TEXT,
                is_primary INTEGER DEFAULT 0,
                created_at TEXT,
                updated_at TEXT
            );
            """,

            # 4. evidence（与 website_evidence.py 保持完全一致）
            """
            CREATE TABLE IF NOT EXISTS evidence (
                evidence_id TEXT PRIMARY KEY,
                customer_id TEXT,
                url TEXT,
                fetched_at TEXT,
                status TEXT,
                title TEXT,
                description TEXT,
                main_products TEXT,
                brand_positioning TEXT,
                country TEXT,
                contact_clues TEXT,
                evidence_snippets TEXT,
                error_message TEXT,
                response_size INTEGER DEFAULT 0,
                pages_fetched_count INTEGER DEFAULT 0,
                created_at TEXT
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_evidence_customer ON evidence(customer_id);",

            # 5. evaluations（统一评估表，不修改现有 prospect_evaluations）
            """
            CREATE TABLE IF NOT EXISTS evaluations (
                evaluation_id TEXT PRIMARY KEY,
                customer_id TEXT,
                company_name TEXT,
                website TEXT,
                country TEXT,
                buyer_type TEXT,
                identity_status TEXT,
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
                fact_snapshot TEXT,
                evaluated_at TEXT,
                evaluated_by TEXT,
                created_at TEXT
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_evaluations_customer ON evaluations(customer_id);",

            # 6. outreach_drafts（统一草稿表，不修改现有 content_drafts）
            """
            CREATE TABLE IF NOT EXISTS outreach_drafts (
                draft_id TEXT PRIMARY KEY,
                customer_id TEXT,
                draft_type TEXT,
                channel TEXT DEFAULT 'email',
                subject TEXT,
                body TEXT,
                language TEXT DEFAULT 'en',
                status TEXT DEFAULT 'draft',
                version INTEGER DEFAULT 1,
                internal_only INTEGER DEFAULT 0,
                knowledge_pack_id TEXT,
                knowledge_pack_version INTEGER,
                customer_snapshot TEXT,
                confirmed_claims TEXT,
                inferred_claims TEXT,
                missing_information TEXT,
                evidence_refs TEXT,
                risk_flags TEXT,
                model TEXT,
                reviewed_by TEXT,
                reviewed_at TEXT,
                created_at TEXT,
                updated_at TEXT
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_outreach_drafts_customer ON outreach_drafts(customer_id);",
            "CREATE INDEX IF NOT EXISTS idx_outreach_drafts_status ON outreach_drafts(status);",

            # 7. outreach_events
            """
            CREATE TABLE IF NOT EXISTS outreach_events (
                event_id TEXT PRIMARY KEY,
                customer_id TEXT,
                draft_id TEXT,
                channel TEXT,
                event_type TEXT,
                status TEXT,
                sent_at TEXT,
                delivered_at TEXT,
                replied_at TEXT,
                reply_content TEXT,
                is_positive_reply INTEGER DEFAULT 0,
                metadata TEXT,
                created_at TEXT
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_outreach_events_customer ON outreach_events(customer_id);",

            # 8. follow_up_tasks
            """
            CREATE TABLE IF NOT EXISTS follow_up_tasks (
                task_id TEXT PRIMARY KEY,
                customer_id TEXT,
                action TEXT,
                due_date TEXT,
                owner TEXT,
                priority TEXT DEFAULT 'medium',
                status TEXT DEFAULT 'pending',
                completed_at TEXT,
                close_reason TEXT,
                created_at TEXT,
                updated_at TEXT
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_follow_up_customer ON follow_up_tasks(customer_id);",
            "CREATE INDEX IF NOT EXISTS idx_follow_up_status ON follow_up_tasks(status);",
            "CREATE INDEX IF NOT EXISTS idx_follow_up_due ON follow_up_tasks(due_date);",

            # 9. suppression_list
            """
            CREATE TABLE IF NOT EXISTS suppression_list (
                suppression_id TEXT PRIMARY KEY,
                customer_id TEXT,
                company_name TEXT,
                website TEXT,
                email TEXT,
                phone TEXT,
                reason TEXT,
                source TEXT,
                added_at TEXT,
                added_by TEXT,
                is_active INTEGER DEFAULT 1
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_suppression_website ON suppression_list(website);",
            "CREATE INDEX IF NOT EXISTS idx_suppression_email ON suppression_list(email);",

            # 10. activity_log
            """
            CREATE TABLE IF NOT EXISTS activity_log (
                log_id TEXT PRIMARY KEY,
                customer_id TEXT,
                activity_type TEXT,
                description TEXT,
                metadata TEXT,
                created_at TEXT,
                created_by TEXT
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_activity_customer ON activity_log(customer_id);",
        ]

        conn = self._connect()
        try:
            for stmt in ddl_statements:
                conn.execute(stmt)
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------ #
    # Prospects CRUD
    # ------------------------------------------------------------------ #

    def add_prospect(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        新增客户。

        Args:
            data: 客户字段字典，可包含 company_name/website/country/source/grade/score 等。

        Returns:
            新增后的完整客户字典（含 customer_id、created_at、updated_at）。
        """
        customer_id = data.get("customer_id") or self._gen_customer_id()
        now = _now()
        record = {
            "customer_id": customer_id,
            "company_name": data.get("company_name"),
            "website": data.get("website"),
            "country": data.get("country"),
            "source": data.get("source"),
            "status": data.get("status") or "new_lead",
            "grade": data.get("grade") or "C",
            "score": data.get("score") or 0,
            "buyer_type": data.get("buyer_type"),
            "product_categories": data.get("product_categories"),
            "main_products": data.get("main_products"),
            "contact_person": data.get("contact_person"),
            "email": data.get("email"),
            "phone": data.get("phone"),
            "notes": data.get("notes"),
            "created_at": data.get("created_at") or now,
            "updated_at": now,
            "legacy_id": data.get("legacy_id"),
            "migrated_at": data.get("migrated_at"),
        }

        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO prospects
                   (customer_id, company_name, website, country, source, status, grade, score,
                    buyer_type, product_categories, main_products, contact_person, email, phone,
                    notes, created_at, updated_at, legacy_id, migrated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                tuple(record.values()),
            )
            conn.commit()
        finally:
            conn.close()
        return record

    def get_prospect(self, customer_id: str) -> Optional[Dict[str, Any]]:
        """
        按 customer_id 查询客户。

        Args:
            customer_id: 客户 ID。

        Returns:
            客户字典；不存在返回 None。
        """
        conn = self._connect()
        try:
            cur = conn.execute(
                "SELECT * FROM prospects WHERE customer_id=?", (customer_id,)
            )
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def update_prospect(self, customer_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        更新客户字段。

        Args:
            customer_id: 客户 ID。
            updates: 待更新字段字典。

        Returns:
            更新后的客户字典；不存在返回 None。
        """
        allowed = {
            "company_name", "website", "country", "source", "status", "grade", "score",
            "buyer_type", "product_categories", "main_products", "contact_person",
            "email", "phone", "notes",
        }
        fields = {k: v for k, v in updates.items() if k in allowed}
        if not fields:
            return self.get_prospect(customer_id)

        fields["updated_at"] = _now()
        set_clause = ", ".join(f"{k}=?" for k in fields)
        params = list(fields.values()) + [customer_id]

        conn = self._connect()
        try:
            cur = conn.execute(
                f"UPDATE prospects SET {set_clause} WHERE customer_id=?", params
            )
            conn.commit()
            if cur.rowcount == 0:
                return None
        finally:
            conn.close()
        return self.get_prospect(customer_id)

    def list_prospects(
        self,
        status: Optional[str] = None,
        grade: Optional[str] = None,
        source: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        按条件筛选客户列表。

        Args:
            status: 客户状态。
            grade: 客户等级。
            source: 客户来源。
            limit: 返回条数上限。

        Returns:
            客户字典列表。
        """
        sql = "SELECT * FROM prospects WHERE 1=1"
        params: List[Any] = []
        if status:
            sql += " AND status=?"
            params.append(status)
        if grade:
            sql += " AND grade=?"
            params.append(grade)
        if source:
            sql += " AND source=?"
            params.append(source)
        sql += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)

        conn = self._connect()
        try:
            cur = conn.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    def delete_prospect(self, customer_id: str) -> bool:
        """
        软删除客户：将 status 设为 invalid，不真正删除记录。

        Args:
            customer_id: 客户 ID。

        Returns:
            是否成功。
        """
        conn = self._connect()
        try:
            cur = conn.execute(
                "UPDATE prospects SET status='invalid', updated_at=? WHERE customer_id=?",
                (_now(), customer_id),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def find_by_website(self, website: str) -> List[Dict[str, Any]]:
        """
        按网站地址查找客户（精确匹配）。

        Args:
            website: 客户网站。

        Returns:
            匹配的客户列表。
        """
        if not website:
            return []
        conn = self._connect()
        try:
            cur = conn.execute(
                "SELECT * FROM prospects WHERE website=? ORDER BY updated_at DESC",
                (website,),
            )
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    def find_by_company_name(self, name: str) -> List[Dict[str, Any]]:
        """
        按公司名模糊查找客户。

        Args:
            name: 公司名关键词。

        Returns:
            匹配的客户列表。
        """
        if not name:
            return []
        conn = self._connect()
        try:
            cur = conn.execute(
                "SELECT * FROM prospects WHERE company_name LIKE ? ORDER BY updated_at DESC",
                (f"%{name}%",),
            )
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    def get_statistics(self) -> Dict[str, Dict[str, int]]:
        """
        返回客户统计：各状态数量、各等级数量、各来源数量。

        Returns:
            {"by_status": {...}, "by_grade": {...}, "by_source": {...}}
        """
        result: Dict[str, Dict[str, int]] = {
            "by_status": {},
            "by_grade": {},
            "by_source": {},
        }
        conn = self._connect()
        try:
            for label, col in (
                ("by_status", "status"),
                ("by_grade", "grade"),
                ("by_source", "source"),
            ):
                cur = conn.execute(
                    f"SELECT {col} AS k, COUNT(*) AS c FROM prospects GROUP BY {col}"
                )
                for row in cur.fetchall():
                    key = row["k"] or "unknown"
                    result[label][key] = row["c"]
        finally:
            conn.close()
        return result

    # ------------------------------------------------------------------ #
    # 重复与 DNC 检测
    # ------------------------------------------------------------------ #

    def _load_json_customers(self, json_path: Optional[Path] = None) -> List[Dict[str, Any]]:
        """读取旧 customers.json，失败返回空列表。"""
        path = Path(json_path) if json_path else Path(__file__).parent / "data" / "customers.json"
        if not path.exists():
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except (json.JSONDecodeError, OSError):
            return []

    def check_duplicate(
        self,
        company_name: Optional[str] = None,
        website: Optional[str] = None,
        email: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        重复客户检测：同时查 SQLite prospects 表和旧 customers.json。

        Args:
            company_name: 公司名。
            website: 网站地址。
            email: 邮箱。

        Returns:
            {"is_duplicate": bool, "matches": [{"customer_id", "field", "confidence"}]}
        """
        matches: List[Dict[str, Any]] = []

        # 1) 查 SQLite
        conn = self._connect()
        try:
            sql = "SELECT customer_id, company_name, website, email FROM prospects WHERE 1=0"
            conditions = []
            params: List[Any] = []
            if website:
                conditions.append("website=?")
                params.append(website)
            if email:
                conditions.append("email=?")
                params.append(email)
            if company_name:
                conditions.append("company_name=?")
                params.append(company_name)
            if conditions:
                sql = "SELECT customer_id, company_name, website, email FROM prospects WHERE " + " OR ".join(conditions)
                cur = conn.execute(sql, params)
                for row in cur.fetchall():
                    field_hit = "website" if website and row["website"] == website else (
                        "email" if email and row["email"] == email else "company_name"
                    )
                    matches.append({
                        "customer_id": row["customer_id"],
                        "field": field_hit,
                        "confidence": 0.95,
                        "source": "sqlite",
                    })
        finally:
            conn.close()

        # 2) 查旧 customers.json
        for cust in self._load_json_customers():
            hit = False
            field = ""
            if website and cust.get("website") == website:
                hit, field = True, "website"
            elif email:
                # P1修复：emails是dict列表[{email:..., type:...}]，不是字符串列表
                emails_raw = cust.get("emails") or []
                email_strings = []
                for e in emails_raw:
                    if isinstance(e, dict):
                        email_strings.append(e.get("email", ""))
                    elif isinstance(e, str):
                        email_strings.append(e)
                if cust.get("email"):
                    email_strings.append(cust["email"])
                if email in email_strings:
                    hit, field = True, "email"
            elif company_name and cust.get("company_name") == company_name:
                hit, field = True, "company_name"
            if hit:
                matches.append({
                    "customer_id": cust.get("id"),
                    "field": field,
                    "confidence": 0.8,
                    "source": "customers.json",
                })

        return {"is_duplicate": len(matches) > 0, "matches": matches}

    def check_dnc(
        self,
        company_name: Optional[str] = None,
        website: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        DNC 检测：查 suppression_list（is_active=1）+ prospects 中 status=dnc 的记录。

        Returns:
            {"is_dnc": bool, "matches": [...]}
        """
        matches: List[Dict[str, Any]] = []
        conn = self._connect()
        try:
            # suppression_list - P1修复：字段间用OR而非AND，否则只存website的记录永远不命中
            conditions = ["is_active=1"]
            params: List[Any] = []
            field_conditions = []
            if website:
                field_conditions.append("website=?")
                params.append(website)
            if email:
                field_conditions.append("email=?")
                params.append(email)
            if phone:
                field_conditions.append("phone=?")
                params.append(phone)
            if company_name:
                field_conditions.append("company_name=?")
                params.append(company_name)
            if field_conditions:
                conditions.append(f"({' OR '.join(field_conditions)})")
            cur = conn.execute(
                f"SELECT suppression_id, customer_id, company_name, website, email, phone, reason "
                f"FROM suppression_list WHERE {' AND '.join(conditions)}",
                params,
            )
            for row in cur.fetchall():
                matches.append({
                    "suppression_id": row["suppression_id"],
                    "customer_id": row["customer_id"],
                    "company_name": row["company_name"],
                    "reason": row["reason"],
                    "source": "suppression_list",
                })

            # prospects.status=dnc - P1修复：字段间用OR
            dnc_cond = ["status='dnc'"]
            dnc_params: List[Any] = []
            dnc_field_conditions = []
            if website:
                dnc_field_conditions.append("website=?")
                dnc_params.append(website)
            if email:
                dnc_field_conditions.append("email=?")
                dnc_params.append(email)
            if company_name:
                dnc_field_conditions.append("company_name=?")
                dnc_params.append(company_name)
            if dnc_field_conditions:
                dnc_cond.append(f"({' OR '.join(dnc_field_conditions)})")
            cur = conn.execute(
                f"SELECT customer_id, company_name, website, email FROM prospects "
                f"WHERE {' AND '.join(dnc_cond)}",
                dnc_params,
            )
            for row in cur.fetchall():
                matches.append({
                    "customer_id": row["customer_id"],
                    "company_name": row["company_name"],
                    "website": row["website"],
                    "source": "prospects.dnc",
                })
        finally:
            conn.close()
        return {"is_dnc": len(matches) > 0, "matches": matches}

    def add_to_suppression(
        self,
        customer_id: Optional[str] = None,
        reason: str = "",
        source: str = "manual",
        **extra: Any,
    ) -> Dict[str, Any]:
        """
        将客户加入屏蔽名单。

        Args:
            customer_id: 客户 ID（可选，若仅屏蔽邮箱/网站可留空）。
            reason: 屏蔽原因。
            source: 来源，默认 manual。
            **extra: 可附带 company_name/website/email/phone/added_by。

        Returns:
            新增的屏蔽记录字典。
        """
        suppression_id = self._gen_id("sup")
        now = _now()
        record = {
            "suppression_id": suppression_id,
            "customer_id": customer_id,
            "company_name": extra.get("company_name"),
            "website": extra.get("website"),
            "email": extra.get("email"),
            "phone": extra.get("phone"),
            "reason": reason,
            "source": source,
            "added_at": now,
            "added_by": extra.get("added_by", "system"),
            "is_active": 1,
        }
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO suppression_list
                   (suppression_id, customer_id, company_name, website, email, phone,
                    reason, source, added_at, added_by, is_active)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                tuple(record.values()),
            )
            conn.commit()
        finally:
            conn.close()
        return record

    def remove_from_suppression(self, suppression_id: str) -> bool:
        """
        取消屏蔽（软删除：is_active=0）。

        Args:
            suppression_id: 屏蔽记录 ID。

        Returns:
            是否成功。
        """
        conn = self._connect()
        try:
            cur = conn.execute(
                "UPDATE suppression_list SET is_active=0 WHERE suppression_id=?",
                (suppression_id,),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    # ------------------------------------------------------------------ #
    # Evaluations
    # ------------------------------------------------------------------ #

    def save_evaluation(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        保存 ICP 评估结果。

        Args:
            data: 评估字段字典。

        Returns:
            保存后的完整评估记录。
        """
        evaluation_id = data.get("evaluation_id") or self._gen_id("ev")
        now = _now()
        record = {
            "evaluation_id": evaluation_id,
            "customer_id": data.get("customer_id"),
            "company_name": data.get("company_name"),
            "website": data.get("website"),
            "country": data.get("country"),
            "buyer_type": data.get("buyer_type"),
            "identity_status": data.get("identity_status"),
            "product_fit": data.get("product_fit"),
            "market_fit": data.get("market_fit"),
            "icp_score": data.get("icp_score") or 0,
            "eligible": data.get("eligible") or 0,
            "hard_blockers": _dump_json(data.get("hard_blockers")),
            "risk_flags": _dump_json(data.get("risk_flags")),
            "missing_evidence": _dump_json(data.get("missing_evidence")),
            "evidence": _dump_json(data.get("evidence")),
            "recommended_next_action": data.get("recommended_next_action"),
            "knowledge_pack_id": data.get("knowledge_pack_id"),
            "knowledge_pack_version": data.get("knowledge_pack_version"),
            "fact_snapshot": _dump_json(data.get("fact_snapshot")),
            "evaluated_at": data.get("evaluated_at") or now,
            "evaluated_by": data.get("evaluated_by") or "system",
            "created_at": now,
        }
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO evaluations
                   (evaluation_id, customer_id, company_name, website, country, buyer_type,
                    identity_status, product_fit, market_fit, icp_score, eligible,
                    hard_blockers, risk_flags, missing_evidence, evidence,
                    recommended_next_action, knowledge_pack_id, knowledge_pack_version,
                    fact_snapshot, evaluated_at, evaluated_by, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                tuple(record.values()),
            )
            conn.commit()
        finally:
            conn.close()
        return record

    def get_latest_evaluation(self, customer_id: str) -> Optional[Dict[str, Any]]:
        """
        获取客户最新一次评估。

        Args:
            customer_id: 客户 ID。

        Returns:
            评估字典；无记录返回 None。
        """
        conn = self._connect()
        try:
            cur = conn.execute(
                "SELECT * FROM evaluations WHERE customer_id=? ORDER BY evaluated_at DESC LIMIT 1",
                (customer_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def list_evaluations(self, customer_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """
        列出评估记录。

        Args:
            customer_id: 可选，按客户过滤。
            limit: 返回条数上限。

        Returns:
            评估字典列表。
        """
        sql = "SELECT * FROM evaluations"
        params: List[Any] = []
        if customer_id:
            sql += " WHERE customer_id=?"
            params.append(customer_id)
        sql += " ORDER BY evaluated_at DESC LIMIT ?"
        params.append(limit)
        conn = self._connect()
        try:
            cur = conn.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    # ------------------------------------------------------------------ #
    # Outreach Drafts
    # ------------------------------------------------------------------ #

    def save_draft(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        保存开发信草稿。

        Args:
            data: 草稿字段字典。

        Returns:
            保存后的完整草稿记录。
        """
        draft_id = data.get("draft_id") or self._gen_id("draft")
        now = _now()
        record = {
            "draft_id": draft_id,
            "customer_id": data.get("customer_id"),
            "draft_type": data.get("draft_type"),
            "channel": data.get("channel") or "email",
            "subject": data.get("subject"),
            "body": data.get("body"),
            "language": data.get("language") or "en",
            "status": data.get("status") or "draft",
            "version": data.get("version") or 1,
            "internal_only": data.get("internal_only") or 0,
            "knowledge_pack_id": data.get("knowledge_pack_id"),
            "knowledge_pack_version": data.get("knowledge_pack_version"),
            "customer_snapshot": _dump_json(data.get("customer_snapshot")),
            "confirmed_claims": _dump_json(data.get("confirmed_claims")),
            "inferred_claims": _dump_json(data.get("inferred_claims")),
            "missing_information": _dump_json(data.get("missing_information")),
            "evidence_refs": _dump_json(data.get("evidence_refs")),
            "risk_flags": _dump_json(data.get("risk_flags")),
            "model": data.get("model"),
            "reviewed_by": data.get("reviewed_by"),
            "reviewed_at": data.get("reviewed_at"),
            "created_at": now,
            "updated_at": now,
        }
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO outreach_drafts
                   (draft_id, customer_id, draft_type, channel, subject, body, language,
                    status, version, internal_only, knowledge_pack_id, knowledge_pack_version,
                    customer_snapshot, confirmed_claims, inferred_claims, missing_information,
                    evidence_refs, risk_flags, model, reviewed_by, reviewed_at,
                    created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                tuple(record.values()),
            )
            conn.commit()
        finally:
            conn.close()
        return record

    def get_draft(self, draft_id: str) -> Optional[Dict[str, Any]]:
        """按 ID 查询草稿。"""
        conn = self._connect()
        try:
            cur = conn.execute("SELECT * FROM outreach_drafts WHERE draft_id=?", (draft_id,))
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def update_draft_status(self, draft_id: str, status: str, reviewed_by: str = "system") -> bool:
        """
        更新草稿状态。

        Args:
            draft_id: 草稿 ID。
            status: 新状态。
            reviewed_by: 审核人，默认 system。

        Returns:
            是否成功。
        """
        now = _now()
        conn = self._connect()
        try:
            cur = conn.execute(
                "UPDATE outreach_drafts SET status=?, reviewed_by=?, reviewed_at=?, updated_at=? "
                "WHERE draft_id=?",
                (status, reviewed_by, now, now, draft_id),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def list_drafts(
        self,
        customer_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """列出草稿。"""
        sql = "SELECT * FROM outreach_drafts WHERE 1=1"
        params: List[Any] = []
        if customer_id:
            sql += " AND customer_id=?"
            params.append(customer_id)
        if status:
            sql += " AND status=?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        conn = self._connect()
        try:
            cur = conn.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    # ------------------------------------------------------------------ #
    # Follow-up Tasks
    # ------------------------------------------------------------------ #

    def add_task(
        self,
        customer_id: str,
        action: str,
        due_date: str,
        owner: str = "",
        priority: str = "medium",
    ) -> Dict[str, Any]:
        """
        新增跟进任务。

        Args:
            customer_id: 客户 ID。
            action: 任务动作描述。
            due_date: 截止日期 YYYY-MM-DD。
            owner: 负责人。
            priority: 优先级 low/medium/high。

        Returns:
            新增的任务记录。
        """
        task_id = self._gen_id("task")
        now = _now()
        record = {
            "task_id": task_id,
            "customer_id": customer_id,
            "action": action,
            "due_date": due_date,
            "owner": owner,
            "priority": priority,
            "status": "pending",
            "completed_at": None,
            "close_reason": None,
            "created_at": now,
            "updated_at": now,
        }
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO follow_up_tasks
                   (task_id, customer_id, action, due_date, owner, priority, status,
                    completed_at, close_reason, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                tuple(record.values()),
            )
            conn.commit()
        finally:
            conn.close()
        return record

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """按 ID 查询任务。"""
        conn = self._connect()
        try:
            cur = conn.execute("SELECT * FROM follow_up_tasks WHERE task_id=?", (task_id,))
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def update_task(self, task_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """更新任务字段。"""
        allowed = {"action", "due_date", "owner", "priority", "status", "completed_at", "close_reason"}
        fields = {k: v for k, v in updates.items() if k in allowed}
        if not fields:
            return self.get_task(task_id)
        fields["updated_at"] = _now()
        set_clause = ", ".join(f"{k}=?" for k in fields)
        params = list(fields.values()) + [task_id]
        conn = self._connect()
        try:
            cur = conn.execute(
                f"UPDATE follow_up_tasks SET {set_clause} WHERE task_id=?", params
            )
            conn.commit()
            if cur.rowcount == 0:
                return None
        finally:
            conn.close()
        return self.get_task(task_id)

    def complete_task(self, task_id: str, close_reason: str = "") -> bool:
        """
        完成任务。

        Args:
            task_id: 任务 ID。
            close_reason: 关闭原因。

        Returns:
            是否成功。
        """
        now = _now()
        conn = self._connect()
        try:
            cur = conn.execute(
                "UPDATE follow_up_tasks SET status='completed', completed_at=?, close_reason=?, "
                "updated_at=? WHERE task_id=?",
                (now, close_reason, now, task_id),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def list_tasks(
        self,
        customer_id: Optional[str] = None,
        status: Optional[str] = None,
        overdue_only: bool = False,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        列出任务。

        Args:
            customer_id: 按客户过滤。
            status: 按状态过滤。
            overdue_only: 为 True 时只返回 due_date < 今天 且 status=pending 的任务。
            limit: 返回条数上限。

        Returns:
            任务列表。
        """
        sql = "SELECT * FROM follow_up_tasks WHERE 1=1"
        params: List[Any] = []
        if customer_id:
            sql += " AND customer_id=?"
            params.append(customer_id)
        if overdue_only:
            sql += " AND status='pending' AND due_date < ?"
            params.append(_today_str())
        elif status:
            sql += " AND status=?"
            params.append(status)
        sql += " ORDER BY due_date ASC LIMIT ?"
        params.append(limit)
        conn = self._connect()
        try:
            cur = conn.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    def get_today_tasks(self) -> List[Dict[str, Any]]:
        """返回今天到期的待办任务（due_date = 今天，status=pending）。"""
        today = _today_str()
        conn = self._connect()
        try:
            cur = conn.execute(
                "SELECT * FROM follow_up_tasks WHERE status='pending' AND due_date <= ? "
                "ORDER BY due_date ASC",
                (today,),
            )
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    def get_overdue_tasks(self) -> List[Dict[str, Any]]:
        """返回逾期任务（due_date < 今天，status=pending）。"""
        return self.list_tasks(overdue_only=True, limit=200)

    # ------------------------------------------------------------------ #
    # Activity Log
    # ------------------------------------------------------------------ #

    def add_activity(
        self,
        customer_id: str,
        activity_type: str,
        description: str,
        metadata: Optional[Dict[str, Any]] = None,
        created_by: str = "system",
    ) -> Dict[str, Any]:
        """
        记录一条活动日志。

        Args:
            customer_id: 客户 ID。
            activity_type: 活动类型。
            description: 描述。
            metadata: 附加元数据（dict）。
            created_by: 操作人。

        Returns:
            新增的日志记录。
        """
        log_id = self._gen_id("log")
        now = _now()
        record = {
            "log_id": log_id,
            "customer_id": customer_id,
            "activity_type": activity_type,
            "description": description,
            "metadata": _dump_json(metadata),
            "created_at": now,
            "created_by": created_by,
        }
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO activity_log
                   (log_id, customer_id, activity_type, description, metadata, created_at, created_by)
                   VALUES (?,?,?,?,?,?,?)""",
                tuple(record.values()),
            )
            conn.commit()
        finally:
            conn.close()
        return record

    def list_activities(self, customer_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """列出某客户的活动日志。"""
        conn = self._connect()
        try:
            cur = conn.execute(
                "SELECT * FROM activity_log WHERE customer_id=? ORDER BY created_at DESC LIMIT ?",
                (customer_id, limit),
            )
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    # ------------------------------------------------------------------ #
    # 迁移
    # ------------------------------------------------------------------ #

    def is_migrated(self) -> bool:
        """检查 prospects 表是否已有数据。"""
        conn = self._connect()
        try:
            cur = conn.execute("SELECT 1 FROM prospects LIMIT 1")
            return cur.fetchone() is not None
        finally:
            conn.close()

    def migrate_from_json(self, json_path: Optional[Path] = None) -> Dict[str, Any]:
        """
        从 customers.json 迁移到 prospects 表。

        迁移规则：
        - 逐条读取旧记录，通过 legacy_id 检查是否已迁移（幂等）。
        - 旧 status 通过 LEGACY_STATUS_MIGRATION 映射为英文状态。
        - 新 customer_id 使用统一格式 cust_{YYYYMMDD}_{md5[:6]}。
        - 保留原 created_at，设置 migrated_at。

        Args:
            json_path: customers.json 路径，默认 data/customers.json。

        Returns:
            {"migrated": int, "skipped": int, "errors": [...]}
        """
        raw_list = self._load_json_customers(json_path)
        migrated = 0
        skipped = 0
        errors: List[str] = []

        conn = self._connect()
        try:
            # 已迁移的 legacy_id 集合
            cur = conn.execute("SELECT legacy_id FROM prospects WHERE legacy_id IS NOT NULL")
            existing_legacy = {r["legacy_id"] for r in cur.fetchall()}
        finally:
            conn.close()

        for raw in raw_list:
            legacy_id = raw.get("id")
            if not legacy_id:
                errors.append("记录缺少 id，跳过")
                skipped += 1
                continue
            if legacy_id in existing_legacy:
                skipped += 1
                continue

            try:
                old_status = raw.get("status", "") or ""
                new_status = LEGACY_STATUS_MIGRATION.get(old_status, "new_lead")

                emails = raw.get("emails") or []
                primary_email = emails[0] if isinstance(emails, list) and emails else None

                self.add_prospect({
                    "company_name": raw.get("company_name"),
                    "website": raw.get("website"),
                    "country": raw.get("country"),
                    "source": raw.get("source"),
                    "status": new_status,
                    "grade": raw.get("grade") or "C",
                    "score": raw.get("score") or 0,
                    "product_categories": raw.get("products"),
                    "email": primary_email,
                    "notes": raw.get("notes") or raw.get("additional_info"),
                    "created_at": raw.get("created_at"),
                    "legacy_id": legacy_id,
                    "migrated_at": _now(),
                })
                migrated += 1
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{legacy_id}: {exc}")
                skipped += 1

        return {"migrated": migrated, "skipped": skipped, "errors": errors}

    def rollback_migration(self, migrated_at: str) -> Dict[str, Any]:
        """
        回滚指定迁移时间点写入的 prospects 记录。

        Args:
            migrated_at: 迁移时记录的 migrated_at 时间字符串。

        Returns:
            {"deleted": int}
        """
        conn = self._connect()
        try:
            conn.execute(
                "DELETE FROM evaluations WHERE customer_id IN "
                "(SELECT customer_id FROM prospects WHERE migrated_at=?)",
                (migrated_at,),
            )
            conn.execute(
                "DELETE FROM outreach_drafts WHERE customer_id IN "
                "(SELECT customer_id FROM prospects WHERE migrated_at=?)",
                (migrated_at,),
            )
            conn.execute(
                "DELETE FROM activity_log WHERE customer_id IN "
                "(SELECT customer_id FROM prospects WHERE migrated_at=?)",
                (migrated_at,),
            )
            cur = conn.execute(
                "DELETE FROM prospects WHERE migrated_at=?", (migrated_at,)
            )
            conn.commit()
            return {"deleted": cur.rowcount}
        finally:
            conn.close()

    # ------------------------------------------------------------------ #
    # 仪表盘统计
    # ------------------------------------------------------------------ #

    def _stage_of(self, status: Optional[str]) -> Optional[str]:
        """将 status 映射到漏斗阶段。"""
        if not status:
            return None
        for stage, statuses in PIPELINE_STAGES:
            if status in statuses:
                return stage
        return None

    def get_dashboard_stats(self) -> Dict[str, Any]:
        """
        返回仪表盘聚合统计。所有统计在无数据时返回 0 或空 dict，不返回示例数据。

        Returns:
            包含 by_source / source_effective_rate / by_grade / by_stage /
            first_outreach_count / reply_count / positive_reply_count /
            quote_count / closed_count / conversion_rates /
            avg_follow_up_interval / last_30_days_new / last_30_days_closed / historical_imported 的字典。
        """
        stats: Dict[str, Any] = {
            "by_source": {},
            "source_effective_rate": {},
            "by_grade": {},
            "by_stage": {},
            "first_outreach_count": 0,
            "reply_count": 0,
            "positive_reply_count": 0,
            "quote_count": 0,
            "closed_count": 0,
            "conversion_rates": {},
            "avg_follow_up_interval": None,
            "last_30_days_new": 0,
            "last_30_days_closed": 0,
            "historical_imported": 0,
        }

        conn = self._connect()
        try:
            # by_source + 计算有效数
            cur = conn.execute(
                "SELECT source, status, COUNT(*) AS c FROM prospects GROUP BY source, status"
            )
            source_total: Dict[str, int] = {}
            source_effective: Dict[str, int] = {}
            for row in cur.fetchall():
                src = row["source"] or "unknown"
                stats["by_source"][src] = stats["by_source"].get(src, 0) + row["c"]
                source_total[src] = source_total.get(src, 0) + row["c"]
                if row["status"] not in NON_EFFECTIVE_STATUSES:
                    source_effective[src] = source_effective.get(src, 0) + row["c"]
            for src, total in source_total.items():
                eff = source_effective.get(src, 0)
                stats["source_effective_rate"][src] = round(eff / total, 4) if total else 0.0

            # by_grade
            cur = conn.execute(
                "SELECT grade, COUNT(*) AS c FROM prospects GROUP BY grade"
            )
            for row in cur.fetchall():
                stats["by_grade"][row["grade"] or "unknown"] = row["c"]

            # by_stage（基于 status 映射）
            cur = conn.execute("SELECT status FROM prospects")
            stage_counts: Dict[str, int] = {}
            for row in cur.fetchall():
                stage = self._stage_of(row["status"])
                if stage:
                    stage_counts[stage] = stage_counts.get(stage, 0) + 1
            stats["by_stage"] = stage_counts

            # outreach_events 统计
            cur = conn.execute(
                "SELECT event_type, replied_at, is_positive_reply FROM outreach_events"
            )
            for row in cur.fetchall():
                if row["event_type"] == "first_send":
                    stats["first_outreach_count"] += 1
                if row["replied_at"]:
                    stats["reply_count"] += 1
                if row["is_positive_reply"]:
                    stats["positive_reply_count"] += 1

            # quote / closed
            cur = conn.execute(
                "SELECT status, COUNT(*) AS c FROM prospects "
                "WHERE status IN ('quoted','sampling','closed_won') GROUP BY status"
            )
            for row in cur.fetchall():
                if row["status"] in ("quoted", "sampling"):
                    stats["quote_count"] += row["c"]
                elif row["status"] == "closed_won":
                    stats["closed_count"] = row["c"]

            # 转化率漏斗：lead -> contacted -> engaged -> quoted -> closed
            lead_n = stage_counts.get("lead", 0)
            contacted_n = stage_counts.get("contacted", 0)
            engaged_n = stage_counts.get("engaged", 0)
            quoted_n = stage_counts.get("quoted", 0)
            closed_n = stage_counts.get("closed", 0)

            def _safe_rate(num: int, den: int) -> float:
                return round(num / den, 4) if den else 0.0

            stats["conversion_rates"] = {
                "lead_to_contacted": _safe_rate(contacted_n, lead_n),
                "contacted_to_engaged": _safe_rate(engaged_n, contacted_n),
                "engaged_to_quoted": _safe_rate(quoted_n, engaged_n),
                "quoted_to_closed": _safe_rate(closed_n, quoted_n),
                "lead_to_closed": _safe_rate(closed_n, lead_n),
            }

            # 平均跟进间隔（天）：follow_up_tasks created_at -> completed_at
            cur = conn.execute(
                "SELECT created_at, completed_at FROM follow_up_tasks "
                "WHERE status='completed' AND completed_at IS NOT NULL AND created_at IS NOT NULL"
            )
            intervals: List[float] = []
            for row in cur.fetchall():
                try:
                    created = datetime.fromisoformat(row["created_at"].rstrip("Z"))
                    completed = datetime.fromisoformat(row["completed_at"].rstrip("Z"))
                    intervals.append((completed - created).total_seconds() / 86400.0)
                except (ValueError, AttributeError):
                    continue
            if intervals:
                stats["avg_follow_up_interval"] = round(sum(intervals) / len(intervals), 2)

            # 近 30 天新增 / 成交
            # 注意：迁移客户（migrated_at IS NOT NULL）不计入"近30天新增"，
            # 因为它们是历史导入数据，不是系统内新增。
            cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
            cur = conn.execute(
                "SELECT COUNT(*) AS c FROM prospects "
                "WHERE created_at >= ? AND migrated_at IS NULL", (cutoff,)
            )
            stats["last_30_days_new"] = cur.fetchone()["c"]
            cur = conn.execute(
                "SELECT COUNT(*) AS c FROM prospects "
                "WHERE status='closed_won' AND updated_at >= ?", (cutoff,)
            )
            stats["last_30_days_closed"] = cur.fetchone()["c"]
            # 历史导入客户总数（用于看板区分展示）
            cur = conn.execute(
                "SELECT COUNT(*) AS c FROM prospects WHERE migrated_at IS NOT NULL"
            )
            stats["historical_imported"] = cur.fetchone()["c"]
        finally:
            conn.close()

        return stats


# ---------------------------------------------------------------------------
# 模块自测入口
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    repo = CustomerRepository()
    print(f"[OK] DB initialized at: {repo.db_path}")
    print(f"[OK] is_migrated: {repo.is_migrated()}")
    print(f"[OK] statistics: {repo.get_statistics()}")
    print(f"[OK] dashboard: {repo.get_dashboard_stats()}")
