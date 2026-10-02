# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - 客户管理（轻量CRM）v2.0
新增：销售管道阶段、跟进提醒、活动日志、客户背调
"""
import json
import os
import tempfile
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from config import CUSTOMERS_FILE, CUSTOMER_GRADES

# ============ 统一状态机（P1.3）可选导入 ============
# 新模块不可用时，现有 JSON 功能不受影响：降级为直通/空映射
try:
    from customer_status import (
        CUSTOMER_STATUSES,
        LEGACY_STATUS_MIGRATION,
        is_outreach_blocked,
        validate_transition,
        STATUS_TO_PIPELINE_V2,
        migrate_legacy_status,
    )
    _UNIFIED_STATUS_AVAILABLE = True
except Exception:  # pragma: no cover - 降级路径
    CUSTOMER_STATUSES = []
    LEGACY_STATUS_MIGRATION = {}
    STATUS_TO_PIPELINE_V2 = {}
    _UNIFIED_STATUS_AVAILABLE = False

    def is_outreach_blocked(status_key):  # type: ignore
        return (False, "")

    def validate_transition(from_status, to_status):  # type: ignore
        return (True, "")

    def migrate_legacy_status(legacy_status):  # type: ignore
        return legacy_status or "new_lead"

# ============ repository（SQLite）可选导入 ============
try:
    import repository as _repo
    _REPO_AVAILABLE = True
except Exception:  # pragma: no cover - 降级路径
    _repo = None
    _REPO_AVAILABLE = False


def _get_repo():
    """惰性创建 CustomerRepository；不可用时返回 None。"""
    if not _REPO_AVAILABLE:
        return None
    try:
        return _repo.CustomerRepository()
    except Exception:
        return None


# 销售管道5阶段
PIPELINE_STAGES = [
    {"key": "lead", "name": "线索", "color": "#6c757d", "description": "刚发现，尚未联系"},
    {"key": "contacted", "name": "已联系", "color": "#007bff", "description": "已发开发信，等待回复"},
    {"key": "engaged", "name": "沟通中", "color": "#ffc107", "description": "客户有回复，正在洽谈"},
    {"key": "quoted", "name": "已报价", "color": "#fd7e14", "description": "已发送报价单/样品"},
    {"key": "closed", "name": "已成交", "color": "#28a745", "description": "已下单成交"},
]

# 客户状态映射到管道阶段（旧中文状态，向后兼容）
STATUS_TO_PIPELINE = {
    "新客户": "lead",
    "跟进中": "contacted",
    "已报价": "quoted",
    "已成交": "closed",
    "已流失": "lead",
}


def _valid_status_keys():
    """返回所有合法新状态 key 集合。"""
    return {s["key"] for s in CUSTOMER_STATUSES}


def _normalize_status(raw_status):
    """将传入状态规范化为新状态 key。

    - 已是合法新状态 key：原样保留
    - 旧中文状态：用 migrate_legacy_status 迁移
    - 空/未知：回退 new_lead
    - 状态机不可用：原样返回（向后兼容）
    """
    if not raw_status:
        return "new_lead"
    s = str(raw_status).strip()
    if not _UNIFIED_STATUS_AVAILABLE:
        return s or "new_lead"
    if s in _valid_status_keys():
        return s
    if s in LEGACY_STATUS_MIGRATION:
        return migrate_legacy_status(s)
    return "new_lead"


class CustomerManager:
    """轻量CRM - P1-9：SQLite 为写权威，customers.json 只读合并。

    - 所有写操作（add/update/delete/move_stage/add_email/add_activity）写入 SQLite prospects/activity_log
    - 读取时合并：SQLite 活跃客户 + JSON legacy 客户（按 id 去重，SQLite 优先）
    - customers.json 文件本身不被修改（MD5 保持不变）
    """

    def __init__(self):
        # P1-9：不再创建/写入 customers.json；确保目录存在即可
        CUSTOMERS_FILE.parent.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ #
    # P1-9：SQLite ↔ JSON 字段映射辅助
    # ------------------------------------------------------------------ #

    def _row_to_customer_dict(self, row):
        """将 SQLite prospects 行转换为与 customers.json 兼容的客户 dict。

        - id：优先 legacy_id（迁移客户保持原 JSON id），否则用 customer_id
        - emails/activities：从 activity_log 加载（get_customer 时才加载，list 视图为空列表）
        """
        cid = row.get("legacy_id") or row.get("customer_id")
        customer = {
            "id": cid,
            "customer_id": row.get("customer_id"),  # SQLite 主键（额外字段，向后兼容不影响）
            "company_name": row.get("company_name") or "",
            "website": row.get("website") or "",
            "country": row.get("country") or "",
            "source": row.get("source") or "",
            "status": row.get("status") or "new_lead",
            "pipeline_stage": row.get("pipeline_stage") or "lead",
            "grade": row.get("grade") or "C",
            "score": row.get("score") or 0,
            "notes": row.get("notes") or "",
            "created_at": row.get("created_at") or "",
            "updated_at": row.get("updated_at") or "",
            "last_contact": row.get("last_contact") or "",
            "next_follow_up": row.get("next_follow_up") or "",
            "analysis": row.get("analysis") or "",
            "due_diligence": row.get("due_diligence") or "",
            "contact_person": row.get("contact_person") or "",
            "email": row.get("email") or "",
            "phone": row.get("phone") or "",
            "emails": [],
            "activities": [],
        }
        return customer

    def _resolve_customer_id(self, identifier):
        """将外部 id（可能是 legacy_id 或 customer_id）解析为 SQLite 主键 customer_id。

        Returns:
            (actual_customer_id, row_dict) 或 (None, None)
        """
        repo = _get_repo()
        if repo is None:
            return None, None
        # 先直接按 customer_id 查
        row = repo.get_prospect(identifier)
        if row:
            return row["customer_id"], row
        # 再按 legacy_id 查
        conn = repo._connect()
        try:
            cur = conn.execute(
                "SELECT * FROM prospects WHERE legacy_id=?", (identifier,)
            )
            r = cur.fetchone()
            if r:
                return r["customer_id"], dict(r)
        finally:
            conn.close()
        return None, None

    def _load_json_legacy(self):
        """P1-9：只读读取 customers.json（legacy），不写入。

        返回 JSON 中的客户列表（未去重，未合并 SQLite）。
        """
        try:
            data = json.loads(CUSTOMERS_FILE.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                return []
            return data
        except Exception:
            return []

    def _load(self):
        """P1-9：合并读取——SQLite 活跃客户 + JSON legacy 客户。

        合并规则：
        1. 从 SQLite prospects 读取所有 status != 'invalid' 的客户
        2. 从 customers.json 读取 legacy 客户
        3. 按 id 去重：SQLite 中已有对应 legacy_id 的，跳过 JSON 版本（SQLite 优先）
        4. SQLite 行转换为 JSON 兼容 dict 格式
        """
        result = []
        seen_ids = set()

        # 1. 从 SQLite 读取
        repo = _get_repo()
        sqlite_ids = set()  # SQLite 中的 customer_id 和 legacy_id
        if repo is not None:
            try:
                rows = repo.list_all_active_prospects()
                for row in rows:
                    cust = self._row_to_customer_dict(row)
                    result.append(cust)
                    seen_ids.add(cust["id"])
                    if row.get("legacy_id"):
                        sqlite_ids.add(row["legacy_id"])
                    sqlite_ids.add(row["customer_id"])
            except Exception:
                pass

        # 2. 从 JSON 读取 legacy 客户（SQLite 中没有的才加入）
        for raw in self._load_json_legacy():
            rid = raw.get("id")
            if rid in seen_ids or rid in sqlite_ids:
                continue  # SQLite 已有此客户（迁移版本优先）
            # 补充缺失字段，保持与 SQLite 转换结果一致的结构
            merged = dict(raw)
            merged.setdefault("emails", [])
            merged.setdefault("activities", [])
            merged.setdefault("pipeline_stage", self._resolve_pipeline_stage(
                raw.get("status", ""), "lead"))
            merged.setdefault("last_contact", "")
            merged.setdefault("next_follow_up", "")
            merged.setdefault("analysis", "")
            merged.setdefault("due_diligence", "")
            merged.setdefault("notes", "")
            merged.setdefault("grade", "C")
            merged.setdefault("score", 0)
            result.append(merged)
            seen_ids.add(rid)

        return result

    def _gen_unique_id(self, existing_ids):
        """生成不重复的客户ID（cust_前缀+8位UUID，与存量客户格式统一，冲突时重试）"""
        for _ in range(10):
            cid = "cust_" + str(uuid.uuid4())[:8]
            if cid not in existing_ids:
                return cid
        # 极端情况：10次都冲突，用更长的ID
        return "cust_" + str(uuid.uuid4())[:12]

    def _resolve_pipeline_stage(self, status, default="lead"):
        """根据状态解析管道阶段：新状态用 V2 映射，旧中文用旧映射。"""
        if _UNIFIED_STATUS_AVAILABLE and status in STATUS_TO_PIPELINE_V2:
            return STATUS_TO_PIPELINE_V2.get(status, default)
        return STATUS_TO_PIPELINE.get(status, default)

    def _primary_email_of(self, customer):
        """从客户记录中提取主邮箱（兼容 emails 列表与 email 字段）。"""
        emails = customer.get("emails")
        if isinstance(emails, list) and emails:
            for e in emails:
                if isinstance(e, dict) and e.get("email"):
                    return e["email"]
                if isinstance(e, str) and e:
                    return e
        return customer.get("email") or None

    def add_customer(self, customer_data, check_duplicate=True):
        """添加客户——P1-9：写入 SQLite prospects 表为权威源。

        check_duplicate=True 时先调用 repository 做重复检测，
        命中重复则不写入，返回 {'success': False, 'error': 'duplicate', 'matches': [...]}。
        status 默认 "new_lead"；传入旧中文状态时自动迁移为新状态 key。

        Returns:
            新增后的客户 dict（JSON 兼容格式）；重复时返回错误 dict。
        """
        # 可选：重复检测（repository 不可用时跳过）
        if check_duplicate:
            dup = self.check_duplicate_customer(
                company_name=customer_data.get("company_name"),
                website=customer_data.get("website"),
                email=self._primary_email_of(customer_data) or customer_data.get("email"),
            )
            if dup and dup.get("is_duplicate"):
                return {
                    "success": False,
                    "error": "duplicate",
                    "matches": dup.get("matches", []),
                }

        repo = _get_repo()
        if repo is None:
            return {"success": False, "error": "repository_unavailable"}

        # 生成客户 ID（保持 cust_ + 8位UUID 格式，与存量一致）
        existing = self._load()
        existing_ids = {c.get("id") for c in existing}
        customer_id = self._gen_unique_id(existing_ids)

        # 状态规范化
        status = _normalize_status(customer_data.get("status", "new_lead"))
        if "pipeline_stage" in customer_data:
            pipeline_stage = customer_data.get("pipeline_stage")
        else:
            pipeline_stage = self._resolve_pipeline_stage(status, "lead")

        now = datetime.now().isoformat()
        # 构造写入 SQLite 的数据
        prospect_data = {
            "customer_id": customer_id,
            "company_name": customer_data.get("company_name", ""),
            "website": customer_data.get("website", ""),
            "country": customer_data.get("country", ""),
            "source": customer_data.get("source", ""),
            "status": status,
            "grade": customer_data.get("grade", "C"),
            "score": customer_data.get("score", 0),
            "contact_person": customer_data.get("contact_person", ""),
            "email": customer_data.get("email", "") or self._primary_email_of(customer_data),
            "phone": customer_data.get("phone", ""),
            "notes": customer_data.get("notes", ""),
            "analysis": customer_data.get("analysis", ""),
            "due_diligence": customer_data.get("due_diligence", ""),
            "last_contact": customer_data.get("last_contact", ""),
            "next_follow_up": customer_data.get("next_follow_up", ""),
            "pipeline_stage": pipeline_stage,
            "created_at": now,
        }

        try:
            # 事务写入 + 写入后验证
            record = repo.add_prospect(prospect_data)
            # 验证：读回确认
            expected = {
                "company_name": prospect_data["company_name"],
                "status": status,
                "grade": prospect_data["grade"],
                "pipeline_stage": pipeline_stage,
            }
            if not repo.verify_prospect_write(customer_id, expected):
                return {"success": False, "error": "write_verification_failed"}
        except Exception as e:
            return {"success": False, "error": str(e)}

        # 返回 JSON 兼容格式的客户 dict
        customer = {
            "id": customer_id,
            "customer_id": customer_id,
            "created_at": now,
            "updated_at": now,
            "status": status,
            "pipeline_stage": pipeline_stage,
            "grade": prospect_data["grade"],
            "score": prospect_data["score"],
            "analysis": prospect_data["analysis"],
            "due_diligence": prospect_data["due_diligence"],
            "last_contact": prospect_data["last_contact"],
            "next_follow_up": prospect_data["next_follow_up"],
            "emails": [],
            "activities": [],
            "notes": prospect_data["notes"],
            "company_name": prospect_data["company_name"],
            "website": prospect_data["website"],
            "country": prospect_data["country"],
            "source": prospect_data["source"],
            "contact_person": prospect_data["contact_person"],
            "email": prospect_data["email"],
            "phone": prospect_data["phone"],
            **customer_data,
        }
        customer["status"] = status
        customer["pipeline_stage"] = pipeline_stage
        customer["id"] = customer_id
        return customer

    def _write_update(self, customer_id, updates):
        """P1-9：无状态校验地写入更新到 SQLite（move_stage 等粗粒度操作走此路径）。"""
        repo = _get_repo()
        if repo is None:
            return None
        # 解析实际 SQLite customer_id
        actual_id, row = self._resolve_customer_id(customer_id)
        if actual_id is None:
            return None

        # 如果更新了 status 但没指定 pipeline_stage，自动解析
        if "status" in updates and "pipeline_stage" not in updates:
            updates["pipeline_stage"] = self._resolve_pipeline_stage(
                updates["status"], row.get("pipeline_stage", "lead") if row else "lead")

        try:
            updated = repo.update_prospect(actual_id, updates)
            if updated is None:
                return None
            # 返回 JSON 兼容格式
            return self._row_to_customer_dict(updated)
        except Exception:
            return None

    def update_customer(self, customer_id, updates):
        """更新客户信息——P1-9：写入 SQLite prospects 表。

        若更新 status，先校验状态转移合法性。
        转移不合法时不更新，返回 None。
        """
        repo = _get_repo()
        if repo is None:
            return None

        actual_id, row = self._resolve_customer_id(customer_id)
        if actual_id is None:
            return None

        # 状态转移校验
        current_status = row.get("status", "new_lead")
        if "status" in updates:
            old_norm = _normalize_status(current_status)
            new_norm = _normalize_status(updates["status"])
            if _UNIFIED_STATUS_AVAILABLE and old_norm != new_norm:
                ok, reason = validate_transition(old_norm, new_norm)
                if not ok:
                    # 记录拒绝原因到 notes
                    existing_notes = row.get("notes", "") or ""
                    new_notes = (existing_notes
                                 + f" [状态转移被拒绝: {current_status}→{updates['status']} ({reason})]").strip()
                    repo.update_prospect(actual_id, {"notes": new_notes})
                    return None
            updates["status"] = new_norm

        # 如果更新了status，同步更新pipeline_stage
        if "status" in updates and "pipeline_stage" not in updates:
            updates["pipeline_stage"] = self._resolve_pipeline_stage(
                updates["status"], row.get("pipeline_stage", "lead"))

        try:
            updated = repo.update_prospect(actual_id, updates)
            if updated is None:
                return None
            return self._row_to_customer_dict(updated)
        except Exception:
            return None

    def move_stage(self, customer_id, new_stage):
        """移动客户到新的管道阶段（保留现有逻辑，支持新状态 key）。

        管道阶段为粗粒度视图，直接写库不经过严格状态机校验，
        映射到对应新状态 key。
        P1修复：终态(dnc/invalid/closed_won)客户不允许被拖拽复活。
        """
        # 终态保护：DNC/无效/已成交客户不允许通过拖拽改变状态
        data = self._load()
        current = None
        for c in data:
            if c.get("id") == customer_id:
                current = c
                break
        if current:
            current_status = _normalize_status(current.get("status", ""))
            if current_status in {"dnc", "invalid", "closed_won"}:
                print(f"[customer_manager] 拒绝移动终态客户 {customer_id} (status={current_status})",
                      file=__import__('sys').stderr)
                return None
        stage_map = {s["key"]: s["name"] for s in PIPELINE_STAGES}
        # 新状态 key 映射（旧中文映射保留在 STATUS_TO_PIPELINE 中兼容）
        status_map = {"lead": "new_lead", "contacted": "sent", "engaged": "in_communication",
                      "quoted": "quoted", "closed": "closed_won"}
        return self._write_update(customer_id, {
            "pipeline_stage": new_stage,
            "status": status_map.get(new_stage, "new_lead"),
        })

    def delete_customer(self, customer_id):
        """P1-9：删除客户——SQLite 软删除（status=invalid）+ 级联关闭任务。

        注意：customers.json 保持只读不变，删除仅影响 SQLite。
        """
        repo = _get_repo()
        if repo is None:
            return
        actual_id, _row = self._resolve_customer_id(customer_id)
        if actual_id is None:
            return
        try:
            repo.cascade_delete_prospect(actual_id)
        except Exception:
            pass

    def get_customer(self, customer_id):
        """获取单个客户——P1-9：从合并源读取，从 activity_log 加载 emails/activities。"""
        # 先尝试 SQLite
        repo = _get_repo()
        if repo is not None:
            actual_id, row = self._resolve_customer_id(customer_id)
            if actual_id is not None:
                cust = self._row_to_customer_dict(row)
                # 从 activity_log 加载活动和邮件
                try:
                    logs = repo.list_activities(actual_id, limit=200)
                    emails = []
                    activities = []
                    for log in logs:
                        if log.get("activity_type") == "email":
                            emails.append({
                                "type": log.get("description", "").split(":", 1)[0] if ":" in log.get("description", "") else "email",
                                "subject": "",
                                "body": log.get("description", ""),
                                "sent_at": log.get("created_at", ""),
                                "status": "已发送",
                            })
                        else:
                            activities.append({
                                "type": log.get("activity_type", ""),
                                "description": log.get("description", ""),
                                "created_at": log.get("created_at", ""),
                            })
                    cust["emails"] = emails
                    cust["activities"] = activities
                except Exception:
                    pass
                return cust
        # fallback：从 JSON legacy 读取
        for c in self._load_json_legacy():
            if c.get("id") == customer_id:
                return c
        return None

    def list_customers(self, grade=None, status=None, pipeline_stage=None):
        """列出客户，可按等级/状态/管道阶段筛选"""
        data = self._load()
        if grade:
            data = [c for c in data if c.get("grade") == grade]
        if status:
            data = [c for c in data if c.get("status") == status]
        if pipeline_stage:
            data = [c for c in data if c.get("pipeline_stage", "lead") == pipeline_stage]
        # 按分数排序
        data.sort(key=lambda x: x.get("score", 0), reverse=True)
        return data

    def add_email(self, customer_id, email_type, subject, body):
        """P1-9：记录邮件——写入 SQLite activity_log + 更新 prospects.last_contact。"""
        repo = _get_repo()
        if repo is None:
            return None
        actual_id, row = self._resolve_customer_id(customer_id)
        if actual_id is None:
            return None
        now = datetime.now().isoformat()
        try:
            # 事务：写 activity_log + 更新 prospects.last_contact
            with repo.transaction() as conn:
                log_id = repo._gen_id("log")
                conn.execute(
                    """INSERT INTO activity_log
                       (log_id, customer_id, activity_type, description, metadata, created_at, created_by)
                       VALUES (?,?,?,?,?,?,?)""",
                    (log_id, actual_id, "email",
                     f"[{email_type}] {subject}",
                     json.dumps({"type": email_type, "subject": subject, "body": body}, ensure_ascii=False),
                     now, "system"),
                )
                conn.execute(
                    "UPDATE prospects SET last_contact=?, updated_at=? WHERE customer_id=?",
                    (now, now, actual_id),
                )
        except Exception:
            return None
        return self.get_customer(customer_id)

    def add_activity(self, customer_id, activity_type, description):
        """P1-9：记录活动日志——写入 SQLite activity_log 表。"""
        repo = _get_repo()
        if repo is None:
            return None
        actual_id, row = self._resolve_customer_id(customer_id)
        if actual_id is None:
            return None
        try:
            repo.add_activity(actual_id, activity_type, description)
        except Exception:
            return None
        return self.get_customer(customer_id)

    def add_note(self, customer_id, note):
        """添加备注"""
        return self.update_customer(customer_id, {"notes": note})

    def set_next_follow_up(self, customer_id, days=3):
        """设置下次跟进时间"""
        next_date = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")
        return self.update_customer(customer_id, {"next_follow_up": next_date})

    def get_follow_up_today(self):
        """获取今天需要跟进的客户"""
        today = datetime.now().strftime("%Y-%m-%d")
        data = self._load()
        return [c for c in data if c.get("next_follow_up", "") == today]

    def get_overdue_follow_up(self):
        """获取逾期未跟进的客户"""
        today = datetime.now().strftime("%Y-%m-%d")
        data = self._load()
        return [c for c in data if c.get("next_follow_up", "") and c["next_follow_up"] < today
                and c.get("status") not in ["closed_won", "dnc", "invalid", "cold_storage", "已成交", "已流失"]]

    def get_statistics(self):
        """获取统计数据"""
        data = self._load()
        stats = {
            "total": len(data),
            "by_grade": {},
            "by_status": {},
            "by_pipeline": {},
            "avg_score": 0,
            "follow_up_today": len(self.get_follow_up_today()),
            "overdue_follow_up": len(self.get_overdue_follow_up()),
        }
        for c in data:
            g = c.get("grade", "C")
            stats["by_grade"][g] = stats["by_grade"].get(g, 0) + 1
            s = c.get("status", "新客户")
            stats["by_status"][s] = stats["by_status"].get(s, 0) + 1
            p = c.get("pipeline_stage", "lead")
            stats["by_pipeline"][p] = stats["by_pipeline"].get(p, 0) + 1
        if data:
            stats["avg_score"] = sum(c.get("score", 0) for c in data) / len(data)
        return stats

    def get_pipeline_data(self):
        """获取销售管道数据"""
        result = {}
        for stage in PIPELINE_STAGES:
            customers = self.list_customers(pipeline_stage=stage["key"])
            result[stage["key"]] = {
                "name": stage["name"],
                "color": stage["color"],
                "count": len(customers),
                "customers": customers,
                "total_value": sum(c.get("estimated_value", 0) for c in customers),
            }
        return result

    def export_csv(self, filepath):
        """导出客户数据为CSV"""
        import csv
        data = self._load()
        if not data:
            return False
        keys = ["id", "company_name", "country", "products", "grade", "score",
                "status", "pipeline_stage", "website", "contact_person", "email",
                "last_contact", "next_follow_up", "created_at", "notes"]
        with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(data)
        return True

    # ============ DNC / 重复检测（repository） ============

    def check_duplicate_customer(self, company_name=None, website=None, email=None):
        """重复客户检测，调用 repository.check_duplicate()。"""
        repo = _get_repo()
        if repo is None:
            return {"is_duplicate": False, "matches": [], "error": "repository_unavailable"}
        try:
            return repo.check_duplicate(company_name=company_name, website=website, email=email)
        except Exception as e:
            return {"is_duplicate": False, "matches": [], "error": str(e)}

    def check_dnc(self, company_name=None, website=None, email=None):
        """DNC 检测，调用 repository.check_dnc()。"""
        repo = _get_repo()
        if repo is None:
            return {"is_dnc": False, "matches": [], "error": "repository_unavailable"}
        try:
            return repo.check_dnc(company_name=company_name, website=website, email=email)
        except Exception as e:
            return {"is_dnc": False, "matches": [], "error": str(e)}

    def is_outreach_allowed(self, customer_id):
        """检查客户是否允许触达：状态阻断 + DNC 名单。

        Returns:
            {'allowed': bool, 'reason': str, 'source': str}
        """
        c = self.get_customer(customer_id)
        if not c:
            return {"allowed": False, "reason": "customer_not_found", "source": "customer_manager"}

        status = _normalize_status(c.get("status", "new_lead"))
        blocked, reason = is_outreach_blocked(status)
        if blocked:
            return {"allowed": False, "reason": reason, "source": "customer_status"}

        dnc = self.check_dnc(
            company_name=c.get("company_name"),
            website=c.get("website"),
            email=self._primary_email_of(c),
        )
        if dnc.get("is_dnc"):
            return {
                "allowed": False,
                "reason": "客户在 DNC / 不联系名单中",
                "source": "suppression_list",
                "matches": dnc.get("matches", []),
            }
        return {"allowed": True, "reason": "", "source": ""}

    # ============ 跟进任务（repository follow_up_tasks） ============

    def add_follow_up_task(self, customer_id, action, due_date, owner="", priority="medium"):
        """新增跟进任务，调用 repository.add_task()。"""
        repo = _get_repo()
        if repo is None:
            return {"success": False, "error": "repository_unavailable"}
        try:
            return repo.add_task(customer_id, action, due_date, owner=owner, priority=priority)
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_customer_tasks(self, customer_id):
        """获取某客户的全部任务，调用 repository.list_tasks()。"""
        repo = _get_repo()
        if repo is None:
            return []
        try:
            return repo.list_tasks(customer_id=customer_id)
        except Exception:
            return []

    def get_today_follow_up_tasks(self):
        """获取今天到期的待办任务，调用 repository.get_today_tasks()。"""
        repo = _get_repo()
        if repo is None:
            return []
        try:
            return repo.get_today_tasks()
        except Exception:
            return []

    def get_overdue_tasks(self):
        """获取逾期任务，调用 repository.get_overdue_tasks()。"""
        repo = _get_repo()
        if repo is None:
            return []
        try:
            return repo.get_overdue_tasks()
        except Exception:
            return []

    # ============ 活动日志（repository activity_log） ============

    def log_activity(self, customer_id, activity_type, description, metadata=None):
        """写 SQLite activity_log 表（与现有 JSON activities 字段互补）。"""
        repo = _get_repo()
        if repo is None:
            return {"success": False, "error": "repository_unavailable"}
        try:
            return repo.add_activity(customer_id, activity_type, description, metadata=metadata)
        except Exception as e:
            return {"success": False, "error": str(e)}


# 全局单例
cm = CustomerManager()
