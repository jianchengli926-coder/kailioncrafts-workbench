# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - 客户管理（轻量CRM）v2.0
新增：销售管道阶段、跟进提醒、活动日志、客户背调
"""
import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from config import CUSTOMERS_FILE, CUSTOMER_GRADES

# 销售管道5阶段
PIPELINE_STAGES = [
    {"key": "lead", "name": "线索", "color": "#6c757d", "description": "刚发现，尚未联系"},
    {"key": "contacted", "name": "已联系", "color": "#007bff", "description": "已发开发信，等待回复"},
    {"key": "engaged", "name": "沟通中", "color": "#ffc107", "description": "客户有回复，正在洽谈"},
    {"key": "quoted", "name": "已报价", "color": "#fd7e14", "description": "已发送报价单/样品"},
    {"key": "closed", "name": "已成交", "color": "#28a745", "description": "已下单成交"},
]

# 客户状态映射到管道阶段
STATUS_TO_PIPELINE = {
    "新客户": "lead",
    "跟进中": "contacted",
    "已报价": "quoted",
    "已成交": "closed",
    "已流失": "lead",
}


class CustomerManager:
    """轻量CRM - 基于JSON文件存储"""

    def __init__(self):
        self._ensure_file()

    def _ensure_file(self):
        CUSTOMERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        if not CUSTOMERS_FILE.exists():
            CUSTOMERS_FILE.write_text("[]", encoding="utf-8")

    def _load(self):
        try:
            return json.loads(CUSTOMERS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []

    def _save(self, data):
        CUSTOMERS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def add_customer(self, customer_data):
        """添加客户"""
        data = self._load()
        # 确保有pipeline_stage
        status = customer_data.get("status", "新客户")
        pipeline_stage = customer_data.get("pipeline_stage", STATUS_TO_PIPELINE.get(status, "lead"))
        customer = {
            "id": str(uuid.uuid4())[:8],
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
        data.append(customer)
        self._save(data)
        return customer

    def update_customer(self, customer_id, updates):
        """更新客户信息"""
        data = self._load()
        for c in data:
            if c["id"] == customer_id:
                # 如果更新了status，同步更新pipeline_stage
                if "status" in updates and "pipeline_stage" not in updates:
                    updates["pipeline_stage"] = STATUS_TO_PIPELINE.get(updates["status"], c.get("pipeline_stage", "lead"))
                c.update(updates)
                c["updated_at"] = datetime.now().isoformat()
                self._save(data)
                return c
        return None

    def move_stage(self, customer_id, new_stage):
        """移动客户到新的管道阶段"""
        stage_map = {s["key"]: s["name"] for s in PIPELINE_STAGES}
        status_map = {"lead": "新客户", "contacted": "跟进中", "engaged": "跟进中",
                      "quoted": "已报价", "closed": "已成交"}
        return self.update_customer(customer_id, {
            "pipeline_stage": new_stage,
            "status": status_map.get(new_stage, "新客户"),
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


# 全局单例
cm = CustomerManager()
