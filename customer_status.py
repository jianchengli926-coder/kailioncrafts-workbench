# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - 统一客户开发状态定义
P1.3: 15态统一状态机，兼容旧 JSON 客户状态与 PIPELINE_STAGES v2

状态分类（category）:
- intake: 线索摄入阶段
- approval: 人工审批阶段
- outreach: 外发触达阶段
- engagement: 客户互动阶段
- sales: 销售推进阶段
- closed: 成交阶段
- dormant: 冷藏休眠
- suppressed: 抑制（DNC/无效）
"""
from typing import List, Dict, Any, Tuple, Optional

# ============ 15个状态定义 ============

CUSTOMER_STATUSES = [
    {"key": "new_lead", "name": "新线索", "category": "intake", "order": 1},
    {"key": "pending_verification", "name": "待验证", "category": "intake", "order": 2},
    {"key": "verified", "name": "已验证", "category": "intake", "order": 3},
    {"key": "pending_review", "name": "待人工审核", "category": "approval", "order": 4},
    {"key": "approved_outreach", "name": "已批准触达", "category": "approval", "order": 5},
    {"key": "sent", "name": "已发送", "category": "outreach", "order": 6},
    {"key": "delivered", "name": "已送达", "category": "outreach", "order": 7},
    {"key": "replied", "name": "已回复", "category": "engagement", "order": 8},
    {"key": "in_communication", "name": "沟通中", "category": "engagement", "order": 9},
    {"key": "quoted", "name": "已报价", "category": "sales", "order": 10},
    {"key": "sampling", "name": "样品中", "category": "sales", "order": 11},
    {"key": "closed_won", "name": "已成交", "category": "closed", "order": 12},
    {"key": "cold_storage", "name": "冷藏", "category": "dormant", "order": 13},
    {"key": "dnc", "name": "DNC", "category": "suppressed", "order": 14},
    {"key": "invalid", "name": "无效", "category": "suppressed", "order": 15},
]

# 旧状态（中文，customer_manager.py JSON 存储）→ 新状态 key
LEGACY_STATUS_MIGRATION = {
    "新客户": "new_lead",
    "跟进中": "in_communication",
    "已报价": "quoted",
    "已成交": "closed_won",
    "已流失": "cold_storage",
}

# 状态 → 管道阶段 v2（兼容现有 PIPELINE_STAGES）
STATUS_TO_PIPELINE_V2 = {
    "new_lead": "lead",
    "pending_verification": "lead",
    "verified": "lead",
    "pending_review": "lead",
    "approved_outreach": "lead",
    "sent": "contacted",
    "delivered": "contacted",
    "replied": "engaged",
    "in_communication": "engaged",
    "quoted": "quoted",
    "sampling": "quoted",
    "closed_won": "closed",
    "cold_storage": "lead",
    "dnc": "lead",
    "invalid": "lead",
}

# 终态（禁止再转出）
TERMINAL_STATES = {"dnc", "invalid", "closed_won"}

# 禁止触达的状态（外发邮件/开发信前必须检查）
NO_OUTREACH_STATES = {
    "dnc": "客户明确要求不联系（Do Not Contact）",
    "invalid": "客户信息无效（邮箱/网站无效）",
    "cold_storage": "客户处于冷藏休眠期，暂不触达",
}

# ============ 合法状态转移表 ============
# 基于 category 顺序推进 + 特殊规则（冷藏可复活，DNC/无效为终态）
_VALID_TRANSITIONS: Dict[str, List[str]] = {
    "new_lead": ["pending_verification", "invalid", "dnc"],
    "pending_verification": ["verified", "invalid", "cold_storage"],
    "verified": ["pending_review", "cold_storage"],
    "pending_review": ["approved_outreach", "cold_storage"],
    "approved_outreach": ["sent", "cold_storage"],
    "sent": ["delivered", "replied", "cold_storage", "dnc", "invalid"],
    "delivered": ["replied", "in_communication", "cold_storage", "dnc", "invalid"],
    "replied": ["in_communication", "cold_storage", "dnc", "invalid"],
    "in_communication": ["quoted", "cold_storage", "dnc", "invalid"],
    "quoted": ["sampling", "cold_storage", "dnc", "invalid"],
    "sampling": ["closed_won", "cold_storage", "dnc", "invalid"],
    "closed_won": [],  # 终态
    "cold_storage": ["new_lead", "verified"],  # 可复活
    "dnc": [],  # 终态
    "invalid": [],  # 终态
}


# ============ 辅助函数 ============

def get_status_info(status_key: str) -> Optional[Dict[str, Any]]:
    """返回状态的完整 dict；未知 key 返回 None"""
    for s in CUSTOMER_STATUSES:
        if s["key"] == status_key:
            return dict(s)
    return None


def get_all_statuses() -> List[Dict[str, Any]]:
    """返回全部 15 个状态列表（按 order 排序）"""
    return sorted(CUSTOMER_STATUSES, key=lambda s: s["order"])


def migrate_legacy_status(legacy_status: str) -> str:
    """将旧中文状态迁移为新状态 key；未知值回退为 new_lead"""
    if not legacy_status:
        return "new_lead"
    return LEGACY_STATUS_MIGRATION.get(str(legacy_status).strip(), "new_lead")


def is_outreach_blocked(status_key: str) -> Tuple[bool, str]:
    """检查状态是否禁止触达。

    Returns:
        (blocked, reason) — blocked=True 时 reason 说明原因；
        blocked=False 时 reason 为空字符串。
    """
    if status_key in NO_OUTREACH_STATES:
        return True, NO_OUTREACH_STATES[status_key]
    return False, ""


def get_valid_transitions(status_key: str) -> List[str]:
    """返回从当前状态可合法转移到的状态 key 列表"""
    return list(_VALID_TRANSITIONS.get(status_key, []))


def validate_transition(from_status: str, to_status: str) -> Tuple[bool, str]:
    """校验状态转移是否合法。

    Returns:
        (ok, reason) — ok=True 时 reason 为空；
        ok=False 时 reason 说明不合法原因。
    """
    if from_status == to_status:
        return False, f"状态未变化（{from_status} → {to_status}）"

    if not get_status_info(from_status):
        return False, f"未知起始状态: {from_status}"
    if not get_status_info(to_status):
        return False, f"未知目标状态: {to_status}"

    if from_status in TERMINAL_STATES:
        return False, f"{from_status} 为终态，不允许再转移"

    allowed = _VALID_TRANSITIONS.get(from_status, [])
    if to_status not in allowed:
        return False, f"不允许从 {from_status} 转移到 {to_status}（合法目标: {allowed}）"

    return True, ""
