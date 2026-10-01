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
    """轻量CRM - 基于JSON文件存储"""

    def __init__(self):
        self._ensure_file()

    def _ensure_file(self):
        CUSTOMERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        if not CUSTOMERS_FILE.exists():
            self._atomic_write([])

    def _atomic_write(self, data):
        """原子写入：临时文件+os.replace，失败保留原文件"""
        content = json.dumps(data, ensure_ascii=False, indent=2)
        fd, tmp = tempfile.mkstemp(dir=str(CUSTOMERS_FILE.parent), suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, str(CUSTOMERS_FILE))
        except Exception:
            try: os.unlink(tmp)
            except OSError: pass
            raise

    def _load(self):
        try:
            return json.loads(CUSTOMERS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []

    def _save(self, data):
        self._atomic_write(data)

    def _gen_unique_id(self, existing_ids):
        """生成不重复的客户ID（8位UUID，冲突时重试）"""
        for _ in range(10):
            cid = str(uuid.uuid4())[:8]
            if cid not in existing_ids:
                return cid
        # 极端情况：10次都冲突，用更长的ID
        return str(uuid.uuid4())[:12]

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
        """添加客户。

        check_duplicate=True 时先调用 repository 做重复检测，
        命中重复则不写入，返回 {'success': False, 'error': 'duplicate', 'matches': [...]}。
        status 默认 "new_lead"；传入旧中文状态时自动迁移为新状态 key。
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

        data = self._load()
        existing_ids = {c.get("id") for c in data}
        # 状态规范化：默认 new_lead，旧中文状态自动迁移
        status = _normalize_status(customer_data.get("status", "new_lead"))
        if "pipeline_stage" in customer_data:
            pipeline_stage = customer_data.get("pipeline_stage")
        else:
            pipeline_stage = self._resolve_pipeline_stage(status, "lead")
        customer = {
            "id": self._gen_unique_id(existing_ids),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "status": status,
            "pipeline_stage": pipeline_stage,
            "grade": customer_data.get("grade", "C"),
            "score": customer_data.get("score", 0),
            "analysis": customer_data.get("analysis", ""),
            "due_diligence": customer_data.get("due_diligence", ""),
            "last_contact": customer_data.get("last_contact", ""),
            "next_follow_up": customer_data.get("next_follow_up", ""),
            "emails": [],
            "activities": [],
            "notes": "",
            **customer_data,
        }
        # **customer_data 可能覆盖 status/pipeline_stage，这里再以规范化结果为准
        customer["status"] = status
        customer["pipeline_stage"] = pipeline_stage
        data.append(customer)
        self._save(data)
        return customer

    def _write_update(self, customer_id, updates):
        """无状态校验地写入更新（move_stage 等粗粒度操作走此路径）。"""
        data = self._load()
        for c in data:
            if c["id"] == customer_id:
                if "status" in updates and "pipeline_stage" not in updates:
                    updates["pipeline_stage"] = self._resolve_pipeline_stage(
                        updates["status"], c.get("pipeline_stage", "lead"))
                c.update(updates)
                c["updated_at"] = datetime.now().isoformat()
                self._save(data)
                return c
        return None

    def update_customer(self, customer_id, updates):
        """更新客户信息；若更新 status，先校验状态转移合法性。

        转移不合法时不更新，返回 None，并在 notes 中记录拒绝原因。
        """
        data = self._load()
        for c in data:
            if c["id"] == customer_id:
                # 状态转移校验
                if "status" in updates:
                    old_norm = _normalize_status(c.get("status", "new_lead"))
                    new_norm = _normalize_status(updates["status"])
                    if _UNIFIED_STATUS_AVAILABLE and old_norm != new_norm:
                        ok, reason = validate_transition(old_norm, new_norm)
                        if not ok:
                            c["notes"] = (
                                (c.get("notes", "") or "")
                                + f" [状态转移被拒绝: {c.get('status')}→{updates['status']} ({reason})]"
                            ).strip()
                            c["updated_at"] = datetime.now().isoformat()
                            self._save(data)
                            return None
                    updates["status"] = new_norm
                # 如果更新了status，同步更新pipeline_stage
                if "status" in updates and "pipeline_stage" not in updates:
                    updates["pipeline_stage"] = self._resolve_pipeline_stage(
                        updates["status"], c.get("pipeline_stage", "lead"))
                c.update(updates)
                c["updated_at"] = datetime.now().isoformat()
                self._save(data)
                return c
        return None

    def move_stage(self, customer_id, new_stage):
        """移动客户到新的管道阶段（保留现有逻辑，支持新状态 key）。

        管道阶段为粗粒度视图，直接写库不经过严格状态机校验，
        映射到对应新状态 key。
        """
        stage_map = {s["key"]: s["name"] for s in PIPELINE_STAGES}
        # 新状态 key 映射（旧中文映射保留在 STATUS_TO_PIPELINE 中兼容）
        status_map = {"lead": "new_lead", "contacted": "sent", "engaged": "in_communication",
                      "quoted": "quoted", "closed": "closed_won"}
        return self._write_update(customer_id, {
            "pipeline_stage": new_stage,
            "status": status_map.get(new_stage, "new_lead"),
        })

    def delete_customer(self, customer_id):
        """删除客户"""
        data = self._load()
        data = [c for c in data if c["id"] != customer_id]
        self._save(data)

    def get_customer(self, customer_id):
        """获取单个客户"""
        data = self._load()
        for c in data:
            if c["id"] == customer_id:
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
        """记录邮件"""
        data = self._load()
        for c in data:
            if c["id"] == customer_id:
                c["emails"].append({
                    "type": email_type,
                    "subject": subject,
                    "body": body,
                    "sent_at": datetime.now().isoformat(),
                    "status": "草稿",
                })
                c["last_contact"] = datetime.now().isoformat()
                c["updated_at"] = datetime.now().isoformat()
                self._save(data)
                return c
        return None

    def add_activity(self, customer_id, activity_type, description):
        """记录活动日志"""
        data = self._load()
        for c in data:
            if c["id"] == customer_id:
                c.setdefault("activities", []).append({
                    "type": activity_type,
                    "description": description,
                    "created_at": datetime.now().isoformat(),
                })
                c["updated_at"] = datetime.now().isoformat()
                self._save(data)
                return c
        return None

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
                and c.get("status") not in ["已成交", "已流失"]]

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
