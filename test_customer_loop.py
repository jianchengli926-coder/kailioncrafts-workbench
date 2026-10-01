# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - 客户开发闭环一期 集成测试

覆盖 14 个测试组：
 1. SSRF/私网地址阻断          8. 客户 ID 关联
 2. 网站超时与大响应限制        9. 草稿人工审核状态
 3. 网站证据保存               10. 状态迁移
 4. 失败时禁止猜测事实          11. 跟进任务逾期
 5. 重复客户检测               12. 统计数据不使用假数据
 6. DNC 阻断                   13. 数据迁移
 7. ICP hard blocker           14. 向后兼容性

设计原则：
- 全部使用临时 SQLite（tempfile.mkdtemp），不污染生产 data/workbench.db
- 所有 HTTP 访问均被 mock（urllib opener），不发起真实网络请求
- 对写生产库的模块（prospect_evaluator / content_draft_generator）用 patch 隔离

独立运行：
    python3 -m pytest test_customer_loop.py -v
    python3 test_customer_loop.py
"""
import io
import os
import sys
import json
import shutil
import socket
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

# 确保可以导入工作台模块
WORKBENCH_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WORKBENCH_DIR))

import website_evidence as wv            # noqa: E402
import customer_status as cs             # noqa: E402
import repository as repo_mod            # noqa: E402
from repository import CustomerRepository  # noqa: E402

CUSTOMERS_JSON = WORKBENCH_DIR / "data" / "customers.json"


# ---------------------------------------------------------------------------
# 工具：临时目录用例基类
# ---------------------------------------------------------------------------
class TempDBCase(unittest.TestCase):
    """每个测试用例一个干净的临时目录与 SQLite 文件。"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="customer_loop_test_")
        self.db_path = Path(self.tmpdir) / "test_workbench.db"

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _repo(self):
        return CustomerRepository(self.db_path)


# ---------------------------------------------------------------------------
# 1. SSRF / 私网地址阻断测试
# ---------------------------------------------------------------------------
class TestSSRFProtection(unittest.TestCase):
    """is_safe_url 仅允许公网 http/https；localhost/私网/file/ftp 一律拒绝。"""

    def setUp(self):
        # 所有合法公网域名的 DNS 解析统一打补丁为一个公网 IP，避免真实网络
        self._patcher = patch.object(
            wv, "_dns_resolve_host", return_value=["8.8.8.8"])
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_localhost_blocked(self):
        self.assertFalse(wv.is_safe_url("http://localhost/")[0])

    def test_127_blocked(self):
        self.assertFalse(wv.is_safe_url("http://127.0.0.1/")[0])

    def test_private_ip_10_blocked(self):
        self.assertFalse(wv.is_safe_url("http://10.0.0.5/")[0])

    def test_private_ip_172_blocked(self):
        self.assertFalse(wv.is_safe_url("http://172.16.0.1/")[0])

    def test_private_ip_192_blocked(self):
        self.assertFalse(wv.is_safe_url("http://192.168.1.1/")[0])

    def test_file_scheme_blocked(self):
        self.assertFalse(wv.is_safe_url("file:///etc/passwd")[0])

    def test_ftp_scheme_blocked(self):
        self.assertFalse(wv.is_safe_url("ftp://example.com")[0])

    def test_https_allowed(self):
        self.assertTrue(wv.is_safe_url("https://example.com")[0])

    def test_http_allowed(self):
        self.assertTrue(wv.is_safe_url("http://example.com")[0])

    def test_empty_url_blocked(self):
        self.assertFalse(wv.is_safe_url("")[0])


# ---------------------------------------------------------------------------
# 2. 网站超时和大响应限制测试
# ---------------------------------------------------------------------------
class _FakeHttpResponse(io.BytesIO):
    """模拟 urllib 响应对象：read()/geturl()。"""

    def __init__(self, content: bytes, final_url: str = "https://example.com/"):
        super().__init__(content)
        self._url = final_url
        self.status = 200

    def geturl(self):
        return self._url


_HTML_OK = (
    "<html lang='en'><head>"
    "<title>Acme Cutlery Co</title>"
    "<meta name='description' content='Premium kitchen knives and scissors'>"
    "</head><body><h1>Welcome to Acme</h1>"
    "We make chef knives, bread knives and scissors. "
    "Contact us at info@acme-example.test."
    "</body></html>"
).encode("utf-8")


class TestWebsiteFetchLimits(TempDBCase):
    """fetch_website_evidence 的超时/过大/成功/失败分支（opener 全部 mock）。"""

    def _patch_passes(self):
        """让 SSRF / robots 检查直接放行，聚焦抓取本身。"""
        return [
            patch.object(wv, "is_safe_url", return_value=(True, "")),
            patch.object(wv, "_check_robots", return_value=(True, "")),
        ]

    def test_connect_timeout(self):
        opener = MagicMock()
        opener.open.side_effect = socket.timeout("connect timed out")
        p1, p2 = self._patch_passes()
        p1.start(); p2.start()
        with patch.object(wv, "_build_opener", return_value=opener):
            ev = wv.fetch_website_evidence("cust_t", "https://example.com",
                                            db_path=self.db_path)
        p1.stop(); p2.stop()
        self.assertEqual(ev["status"], "timeout")
        self.assertTrue(ev["error_message"])

    def test_max_response_size(self):
        # 直接模拟 _fetch 返回 truncated/too_large，验证证据组装阶段正确传播
        big = {
            "html": "<html></html>",
            "final_url": "https://example.com/",
            "status": "too_large",
            "truncated": True,
            "response_size": wv.MAX_RESPONSE_BYTES + 1024,
            "error": "",
        }
        p1, p2 = self._patch_passes()
        p1.start(); p2.start()
        with patch.object(wv, "_fetch", return_value=big):
            ev = wv.fetch_website_evidence("cust_t", "https://example.com",
                                            db_path=self.db_path)
        p1.stop(); p2.stop()
        self.assertEqual(ev["status"], "too_large")
        self.assertTrue(ev["response_size"] > wv.MAX_RESPONSE_BYTES)

    def test_fetch_returns_evidence_dict(self):
        opener = MagicMock()
        opener.open.return_value = _FakeHttpResponse(_HTML_OK)
        p1, p2 = self._patch_passes()
        p1.start(); p2.start()
        with patch.object(wv, "_build_opener", return_value=opener):
            ev = wv.fetch_website_evidence("cust_t", "https://example.com",
                                            db_path=self.db_path)
        p1.stop(); p2.stop()
        for key in ("evidence_id", "customer_id", "url", "status", "fetched_at"):
            self.assertIn(key, ev, f"缺少字段 {key}")
        self.assertEqual(ev["status"], "success")
        self.assertEqual(ev["customer_id"], "cust_t")
        self.assertIn("Acme", ev["title"])

    def test_failed_fetch_no_guessing(self):
        opener = MagicMock()
        opener.open.side_effect = urllib.error.URLError("connection refused")
        p1, p2 = self._patch_passes()
        p1.start(); p2.start()
        with patch.object(wv, "_build_opener", return_value=opener):
            ev = wv.fetch_website_evidence("cust_t", "https://example.com",
                                            db_path=self.db_path)
        p1.stop(); p2.stop()
        # 失败时所有提取字段必须为空/None，error_message 必须非空
        self.assertEqual(ev["status"], "failed")
        self.assertEqual(ev["title"], "")
        self.assertEqual(ev["description"], "")
        self.assertEqual(ev["main_products"], [])
        self.assertEqual(ev["country"], "")
        self.assertTrue(ev["error_message"])


# ---------------------------------------------------------------------------
# 3. 网站证据保存测试
# ---------------------------------------------------------------------------
class TestEvidencePersistence(TempDBCase):

    def test_save_and_get_evidence(self):
        ev = {
            "evidence_id": "ev_test_001",
            "customer_id": "cust_persist_1",
            "url": "https://acme.test",
            "fetched_at": "2026-10-01T00:00:00Z",
            "status": "success",
            "title": "Acme Test",
            "description": "desc",
        }
        wv.save_evidence(ev, db_path=self.db_path)
        got = wv.get_evidence("cust_persist_1", db_path=self.db_path)
        self.assertIsNotNone(got)
        self.assertEqual(got["evidence_id"], "ev_test_001")
        self.assertEqual(got["title"], "Acme Test")
        self.assertEqual(got["url"], "https://acme.test")

    def test_evidence_json_fields(self):
        ev = {
            "evidence_id": "ev_test_002",
            "customer_id": "cust_persist_2",
            "url": "https://acme.test",
            "status": "success",
            "main_products": ["knife", "scissors"],
            "contact_clues": {"emails": ["a@b.test"], "phones": ["+1 555"],
                              "addresses": ["street 1"]},
            "evidence_snippets": [{"page_url": "/", "text_excerpt": "hi",
                                  "field_type": "title"}],
        }
        wv.save_evidence(ev, db_path=self.db_path)
        got = wv.get_evidence("cust_persist_2", db_path=self.db_path)
        self.assertEqual(got["main_products"], ["knife", "scissors"])
        self.assertEqual(got["contact_clues"]["emails"], ["a@b.test"])
        self.assertIsInstance(got["evidence_snippets"], list)
        self.assertEqual(got["evidence_snippets"][0]["field_type"], "title")

    def test_get_evidence_returns_latest(self):
        old = {
            "evidence_id": "ev_old", "customer_id": "cust_latest",
            "url": "https://a.test", "status": "success",
            "fetched_at": "2026-09-01T00:00:00Z", "title": "OLD",
        }
        new = {
            "evidence_id": "ev_new", "customer_id": "cust_latest",
            "url": "https://b.test", "status": "success",
            "fetched_at": "2026-10-01T00:00:00Z", "title": "NEW",
        }
        wv.save_evidence(old, db_path=self.db_path)
        wv.save_evidence(new, db_path=self.db_path)
        got = wv.get_evidence("cust_latest", db_path=self.db_path)
        self.assertEqual(got["evidence_id"], "ev_new")
        self.assertEqual(got["title"], "NEW")


# ---------------------------------------------------------------------------
# 4. 无法验证时禁止生成确定性事实
# ---------------------------------------------------------------------------
class TestNoGuessingOnFailure(unittest.TestCase):

    def test_build_prompt_context_marks_unverified(self):
        customer_data = {
            "company_name": "Some Co",
            "website": "https://some.test",
        }
        # 抓取失败的证据：verified_facts 必须为空，缺失字段进入 missing
        bad_evidence = {"status": "timeout", "title": "", "main_products": []}
        ctx = wv.build_evidence_aware_prompt_context(customer_data, bad_evidence)
        self.assertEqual(ctx["verified_facts"], {})
        self.assertIn("missing", ctx)
        # 客户输入仍归 customer_input，但不产生任何“已验证”网站事实
        self.assertNotIn("website_title", ctx["verified_facts"])

    def test_classify_evidence_field_missing(self):
        self.assertEqual(wv.classify_evidence_field(None, "fetch"), "missing")

    def test_classify_evidence_field_verified(self):
        self.assertEqual(wv.classify_evidence_field("some value", "fetch"),
                         "verified")

    def test_classify_evidence_field_customer_input(self):
        # 函数约定 source='customer' 时返回 'customer_input'
        self.assertEqual(
            wv.classify_evidence_field("some value", "customer"),
            "customer_input",
        )


# ---------------------------------------------------------------------------
# 5. 重复客户检测测试
# ---------------------------------------------------------------------------
class TestDuplicateDetection(TempDBCase):
    """通过 repository.check_duplicate 检测；使用唯一公司名避免命中真实 customers.json。"""

    UNIQUE_COMPANY = "ZZ NoSuch DupCompany 2099"
    UNIQUE_WEBSITE = "https://zz-unique-dup-2099.example.com"

    def setUp(self):
        super().setUp()
        self.repo = self._repo()
        self.repo.add_prospect({
            "company_name": self.UNIQUE_COMPANY,
            "website": self.UNIQUE_WEBSITE,
            "country": "Germany",
        })

    def test_detect_by_company_name(self):
        res = self.repo.check_duplicate(company_name=self.UNIQUE_COMPANY)
        self.assertTrue(res["is_duplicate"])

    def test_detect_by_website(self):
        res = self.repo.check_duplicate(website=self.UNIQUE_WEBSITE)
        self.assertTrue(res["is_duplicate"])

    def test_no_duplicate(self):
        res = self.repo.check_duplicate(
            company_name="ZZ Totally Different 9999",
            website="https://zz-different-9999.example.com",
        )
        self.assertFalse(res["is_duplicate"])

    def test_duplicate_returns_matches(self):
        res = self.repo.check_duplicate(company_name=self.UNIQUE_COMPANY)
        self.assertTrue(res["matches"])
        m = res["matches"][0]
        self.assertIn("customer_id", m)
        self.assertIn("field", m)


# ---------------------------------------------------------------------------
# 6. DNC 阻断测试
# ---------------------------------------------------------------------------
class TestDNCBlocking(TempDBCase):

    def setUp(self):
        super().setUp()
        self.repo = self._repo()

    def test_add_to_suppression(self):
        rec = self.repo.add_to_suppression(
            company_name="Another DNC", website="https://dnc-zz2.example.com",
            reason="unsubscribe", source="manual")
        self.assertTrue(rec["suppression_id"])
        self.assertEqual(rec["is_active"], 1)

    def test_check_dnc_hit(self):
        self.repo.add_to_suppression(
            company_name="DNC Co", website="https://dnc-zz.example.com",
            reason="unsubscribe", source="manual")
        res = self.repo.check_dnc(website="https://dnc-zz.example.com")
        self.assertTrue(res["is_dnc"])

    def test_check_dnc_miss(self):
        res = self.repo.check_dnc(website="https://clean-zz.example.com")
        self.assertFalse(res["is_dnc"])

    def test_dnc_status_blocks_outreach(self):
        blocked, reason = cs.is_outreach_blocked("dnc")
        self.assertTrue(blocked)
        self.assertTrue(reason)

    def test_invalid_status_blocks(self):
        blocked, _ = cs.is_outreach_blocked("invalid")
        self.assertTrue(blocked)


# ---------------------------------------------------------------------------
# 7. ICP hard blocker 测试
# ---------------------------------------------------------------------------
class TestICPHardBlocker(unittest.TestCase):
    """evaluate_customer_icp 的纯逻辑分支；隔离数据库写入与外部检测。"""

    def _eval(self, customer_input, dup_result=None, dnc_result=None):
        import prospect_evaluator as pe
        dup_result = dup_result or {
            "is_duplicate": False, "matches": [], "detection_count": 0}
        dnc_result = dnc_result or {"is_dnc": False, "matches": []}
        fake_conn = MagicMock()
        with patch.object(pe, "_conn", return_value=fake_conn), \
             patch.object(pe, "detect_duplicate_customer", return_value=dup_result), \
             patch.object(pe, "check_dnc", return_value=dnc_result), \
             patch.object(pe, "_get_repo", return_value=None):
            return pe.evaluate_customer_icp(customer_input)

    def test_missing_company_name_is_blocker(self):
        res = self._eval({})
        self.assertTrue(any("company_name 缺失" in b for b in res["hard_blockers"]))

    def test_missing_website_is_blocker(self):
        res = self._eval({"company_name": "Some Co"})
        self.assertTrue(any("website 缺失" in b for b in res["hard_blockers"]))

    def test_unsafe_url_is_blocker(self):
        res = self._eval({"company_name": "Some Co", "website": "ftp://bad.com"})
        self.assertTrue(any("不安全" in b for b in res["hard_blockers"]))

    def test_high_score_does_not_bypass_blocker(self):
        # 身份可验证、买家类型加分，但 URL 不安全 → 仍必须 blocked / 不可准入
        res = self._eval({
            "company_name": "Some Co",
            "website": "ftp://bad.com",
            "source_document": "pdf",
            "buyer_type": "wholesaler",
        })
        self.assertTrue(len(res["hard_blockers"]) > 0)
        self.assertFalse(res["eligible"])
        # 分数再高也不能绕过
        self.assertGreaterEqual(res["icp_score"], 0)

    def test_duplicate_is_blocker(self):
        dup = {"is_duplicate": True, "detection_count": 1,
               "matches": [{"matched_customer_id": "cust_other",
                            "matched_field": "company_name"}]}
        res = self._eval(
            {"company_name": "Dup Co", "website": "https://dup.test",
             "source_document": "x"},
            dup_result=dup)
        self.assertTrue(any("duplicate" in b.lower() for b in res["hard_blockers"]))


# ---------------------------------------------------------------------------
# 8. 客户 ID 关联测试
# ---------------------------------------------------------------------------
class TestCustomerIDAssociation(TempDBCase):

    CID = "cust_link_001"

    def test_evaluation_links_customer_id(self):
        repo = self._repo()
        repo.save_evaluation({"customer_id": self.CID, "company_name": "Link Co",
                              "icp_score": 50})
        ev = repo.get_latest_evaluation(self.CID)
        self.assertIsNotNone(ev)
        self.assertEqual(ev["customer_id"], self.CID)

    def test_draft_links_customer_id(self):
        repo = self._repo()
        rec = repo.save_draft({"customer_id": self.CID,
                               "draft_type": "first_email", "subject": "hi"})
        got = repo.get_draft(rec["draft_id"])
        self.assertEqual(got["customer_id"], self.CID)

    def test_task_links_customer_id(self):
        repo = self._repo()
        t = repo.add_task(self.CID, "follow up", "2026-10-05")
        got = repo.get_task(t["task_id"])
        self.assertEqual(got["customer_id"], self.CID)

    def test_evidence_links_customer_id(self):
        wv.save_evidence({
            "evidence_id": "ev_link", "customer_id": self.CID,
            "url": "https://link.test", "status": "success"},
            db_path=self.db_path)
        got = wv.get_evidence(self.CID, db_path=self.db_path)
        self.assertEqual(got["customer_id"], self.CID)


# ---------------------------------------------------------------------------
# 9. 草稿人工审核状态测试
# ---------------------------------------------------------------------------
class TestDraftReviewStatus(TempDBCase):

    def _make_draft(self, status="draft"):
        repo = self._repo()
        rec = repo.save_draft({
            "customer_id": "cust_draft", "draft_type": "first_email",
            "subject": "subj", "body": "body", "status": status})
        return repo, rec["draft_id"]

    def test_draft_default_status(self):
        # save_draft 不传 status 时默认 draft
        repo = self._repo()
        rec = repo.save_draft({"customer_id": "cust_d", "draft_type": "first_email"})
        self.assertIn(rec["status"], ("draft", "needs_review"))
        self.assertNotEqual(rec["status"], "approved")

    def test_update_to_approved(self):
        repo, did = self._make_draft()
        self.assertTrue(repo.update_draft_status(did, "approved"))
        self.assertEqual(repo.get_draft(did)["status"], "approved")

    def test_update_to_rejected(self):
        repo, did = self._make_draft()
        self.assertTrue(repo.update_draft_status(did, "rejected"))
        self.assertEqual(repo.get_draft(did)["status"], "rejected")

    def test_invalid_status_rejected(self):
        # content_draft_generator.update_draft_status 自带 DRAFT_STATUSES 白名单校验
        import content_draft_generator as cdg
        res = cdg.update_draft_status("nonexistent_draft_id_zz", "sent")
        self.assertFalse(res["success"])

    def test_low_evidence_forces_draft(self):
        import sqlite3
        import content_draft_generator as cdg

        def _temp_conn():
            c = sqlite3.connect(str(self.db_path))
            c.row_factory = sqlite3.Row
            return c

        qual = {
            "success": True,
            "icp_evaluation": {
                "identity_status": "unresolved",
                "company_name": "Low Ev Co",
                "website": "", "country": "", "buyer_type": "",
                "hard_blockers": [],
            },
        }
        with patch.object(cdg, "_conn", side_effect=_temp_conn), \
             patch.object(cdg.pe, "get_customer_qualification",
                          return_value=qual):
            res = cdg.generate_content_draft(
                "cust_low_ev", "first_email",
                customer_input={"company_name": "Low Ev Co",
                                "country": "Germany"},
                use_mock=True,
                website_evidence={"status": "failed", "title": "",
                                   "main_products": []})
        self.assertTrue(res["success"])
        self.assertEqual(res["status"], "draft")
        self.assertTrue(any("低证据" in f for f in res["risk_flags"]))


# ---------------------------------------------------------------------------
# 10. 状态迁移测试
# ---------------------------------------------------------------------------
class TestStatusMigration(unittest.TestCase):

    def test_legacy_new_customer(self):
        self.assertEqual(cs.migrate_legacy_status("新客户"), "new_lead")

    def test_legacy_following(self):
        self.assertEqual(cs.migrate_legacy_status("跟进中"), "in_communication")

    def test_legacy_quoted(self):
        self.assertEqual(cs.migrate_legacy_status("已报价"), "quoted")

    def test_legacy_closed(self):
        self.assertEqual(cs.migrate_legacy_status("已成交"), "closed_won")

    def test_legacy_lost(self):
        self.assertEqual(cs.migrate_legacy_status("已流失"), "cold_storage")

    def test_unknown_legacy_default(self):
        # 未知旧状态回退 new_lead，不报错
        self.assertEqual(cs.migrate_legacy_status("未知状态"), "new_lead")

    def test_all_15_statuses_exist(self):
        self.assertEqual(len(cs.CUSTOMER_STATUSES), 15)

    def test_valid_transition(self):
        ok, _ = cs.validate_transition("new_lead", "pending_verification")
        self.assertTrue(ok)

    def test_invalid_transition(self):
        ok, reason = cs.validate_transition("new_lead", "quoted")
        self.assertFalse(ok)
        self.assertTrue(reason)

    def test_dnc_terminal(self):
        ok, _ = cs.validate_transition("dnc", "new_lead")
        self.assertFalse(ok)


# ---------------------------------------------------------------------------
# 11. 跟进任务逾期测试
# ---------------------------------------------------------------------------
class TestFollowUpOverdue(TempDBCase):

    def _utc_yesterday(self):
        return (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")

    def _utc_today(self):
        return datetime.utcnow().strftime("%Y-%m-%d")

    def test_add_task(self):
        repo = self._repo()
        t = repo.add_task("cust_t", "call back", "2026-10-05")
        self.assertEqual(t["status"], "pending")
        self.assertEqual(t["customer_id"], "cust_t")

    def test_overdue_detection(self):
        repo = self._repo()
        repo.add_task("cust_od", "old follow", self._utc_yesterday())
        overdue = repo.get_overdue_tasks()
        self.assertTrue(any(t["customer_id"] == "cust_od" for t in overdue))

    def test_not_overdue_if_completed(self):
        repo = self._repo()
        t = repo.add_task("cust_od2", "old follow", self._utc_yesterday())
        repo.complete_task(t["task_id"])
        overdue = repo.get_overdue_tasks()
        self.assertFalse(any(x["task_id"] == t["task_id"] for x in overdue))

    def test_complete_task(self):
        repo = self._repo()
        t = repo.add_task("cust_done", "do", "2026-10-05")
        self.assertTrue(repo.complete_task(t["task_id"]))
        got = repo.get_task(t["task_id"])
        self.assertEqual(got["status"], "completed")
        self.assertTrue(got["completed_at"])

    def test_today_tasks(self):
        repo = self._repo()
        repo.add_task("cust_today", "today's task", self._utc_today())
        today = repo.get_today_tasks()
        self.assertTrue(any(t["customer_id"] == "cust_today" for t in today))


# ---------------------------------------------------------------------------
# 12. 统计数据不使用假数据
# ---------------------------------------------------------------------------
class TestStatsNoFakeData(TempDBCase):

    def setUp(self):
        super().setUp()
        self.stats = self._repo().get_dashboard_stats()

    def test_dashboard_stats_returns_zeros(self):
        for f in ("first_outreach_count", "reply_count", "positive_reply_count",
                  "quote_count", "closed_count", "last_30_days_new",
                  "last_30_days_closed"):
            self.assertEqual(self.stats[f], 0, f"{f} 应为 0")
        self.assertEqual(self.stats["by_source"], {})
        self.assertEqual(self.stats["by_stage"], {})

    def test_no_example_data(self):
        def walk(obj):
            if isinstance(obj, dict):
                for v in obj.values():
                    yield from walk(v)
            elif isinstance(obj, list):
                for v in obj:
                    yield from walk(v)
            elif isinstance(obj, str):
                yield obj
        for s in walk(self.stats):
            low = s.lower()
            self.assertNotIn("example", low)
            self.assertNotIn("示例", s)
            self.assertNotIn("sample", low)

    def test_conversion_rate_zero_denominator(self):
        rates = self.stats["conversion_rates"]
        for v in rates.values():
            self.assertEqual(v, 0.0)

    def test_avg_interval_none(self):
        self.assertIsNone(self.stats["avg_follow_up_interval"])

    def test_by_grade_all_zero(self):
        for grade in ("A", "B", "C", "D"):
            self.assertEqual(self.stats["by_grade"].get(grade, 0), 0)


# ---------------------------------------------------------------------------
# 13. 数据迁移测试
# ---------------------------------------------------------------------------
class TestDataMigration(TempDBCase):

    def test_migration_creates_prospects(self):
        repo = self._repo()
        res = repo.migrate_from_json(json_path=CUSTOMERS_JSON)
        self.assertGreater(res["migrated"], 0)
        self.assertTrue(repo.is_migrated())

    def test_migration_idempotent(self):
        repo = self._repo()
        first = repo.migrate_from_json(json_path=CUSTOMERS_JSON)
        second = repo.migrate_from_json(json_path=CUSTOMERS_JSON)
        self.assertGreater(first["migrated"], 0)
        self.assertEqual(second["migrated"], 0)

    def test_migration_status_mapping(self):
        repo = self._repo()
        repo.migrate_from_json(json_path=CUSTOMERS_JSON)
        rows = repo.list_prospects(limit=100)
        self.assertTrue(rows)
        # 原数据全部是“新客户” → new_lead
        for r in rows:
            self.assertEqual(r["status"], "new_lead")

    def test_migration_preserves_legacy_id(self):
        repo = self._repo()
        repo.migrate_from_json(json_path=CUSTOMERS_JSON)
        rows = repo.list_prospects(limit=100)
        for r in rows:
            self.assertTrue(r["legacy_id"], "legacy_id 不应为空")
            self.assertTrue(str(r["legacy_id"]).startswith("cust_"))

    def test_rollback_migration(self):
        repo = self._repo()
        repo.migrate_from_json(json_path=CUSTOMERS_JSON)
        rows = repo.list_prospects(limit=1)
        target = rows[0]
        deleted = repo.rollback_migration(target["migrated_at"])
        self.assertGreaterEqual(deleted["deleted"], 1)
        self.assertIsNone(repo.get_prospect(target["customer_id"]))


# ---------------------------------------------------------------------------
# 14. 向后兼容性测试
# ---------------------------------------------------------------------------
class TestBackwardCompatibility(unittest.TestCase):

    def test_customer_manager_imports(self):
        import customer_manager as cm_mod
        self.assertTrue(hasattr(cm_mod, "cm"))
        self.assertIsNotNone(cm_mod.cm)

    def test_prospect_evaluator_imports(self):
        import prospect_evaluator  # noqa: F401

    def test_content_draft_imports(self):
        import content_draft_generator  # noqa: F401

    def test_existing_functions_exist(self):
        from customer_manager import CustomerManager
        for m in ("add_customer", "update_customer", "get_customer",
                  "list_customers"):
            self.assertTrue(hasattr(CustomerManager, m), f"缺少方法 {m}")

    def test_draft_types_includes_existing(self):
        from content_draft_generator import DRAFT_TYPES
        self.assertIn("first_email", DRAFT_TYPES)
        self.assertIn("follow_up_email", DRAFT_TYPES)

    def test_draft_statuses_unchanged(self):
        from content_draft_generator import DRAFT_STATUSES
        self.assertEqual(DRAFT_STATUSES,
                         ["draft", "needs_review", "approved", "rejected"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
