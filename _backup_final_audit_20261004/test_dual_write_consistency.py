# -*- coding: utf-8 -*-
"""
P1-9：JSON/SQLite 双写一致性测试

验证：
1. 新增客户同步到 SQLite（JSON 只读，SQLite 为权威写源）
2. 更新客户同步到 SQLite
3. 删除客户级联处理关联表
4. 写入失败完整回滚，不产生半成功状态
5. 重复提交不产生重复记录
6. 并发写入不丢数据

设计原则：
- 全部使用临时 SQLite 文件，不污染生产 data/workbench.db
- customers.json 保持只读，MD5 不可变
- 每个测试独立隔离，测试后清理

独立运行：
    python3 -m pytest test_dual_write_consistency.py -v
"""
import os
import sys
import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# 确保可以导入工作台模块
WORKBENCH_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WORKBENCH_DIR))

import repository as repo_mod            # noqa: E402
from repository import CustomerRepository  # noqa: E402
import customer_manager as cm_mod         # noqa: E402
from customer_manager import CustomerManager  # noqa: E402

CUSTOMERS_JSON = WORKBENCH_DIR / "data" / "customers.json"


class TempDBTempJSONCase(unittest.TestCase):
    """每个测试用例：临时 SQLite + 临时 JSON 文件（隔离生产数据）。"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="dual_write_test_")
        self.db_path = Path(self.tmpdir) / "test_workbench.db"
        # 临时 JSON：从生产 customers.json 复制一份（只读，不修改原文件）
        self.json_path = Path(self.tmpdir) / "customers.json"
        shutil.copy2(CUSTOMERS_JSON, self.json_path)

        # 创建真实的临时仓库
        self.repo = CustomerRepository(self.db_path)

        # Patch customer_manager._get_repo 返回临时仓库
        self._repo_patcher = patch.object(
            cm_mod, "_get_repo", return_value=self.repo)
        self._repo_patcher.start()

        # Patch CUSTOMERS_FILE 指向临时 JSON
        self._cm_patcher = patch.object(
            cm_mod, "CUSTOMERS_FILE", self.json_path)
        self._cm_patcher.start()

        # 创建 CustomerManager（不依赖全局单例）
        self.cm = CustomerManager()

    def tearDown(self):
        self._repo_patcher.stop()
        self._cm_patcher.stop()
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _count_sqlite_customers(self):
        """统计 SQLite 中非 invalid 的客户数。"""
        conn = self.repo._connect()
        try:
            cur = conn.execute(
                "SELECT COUNT(*) AS c FROM prospects WHERE status != 'invalid' OR status IS NULL")
            return cur.fetchone()["c"]
        finally:
            conn.close()

    def _get_sqlite_row(self, customer_id):
        """直接从 SQLite 查一行。"""
        return self.repo.get_prospect(customer_id)


# ---------------------------------------------------------------------------
# 1. 新增客户同步到 SQLite
# ---------------------------------------------------------------------------
class TestAddCustomerSyncsToSQLite(TempDBTempJSONCase):

    def test_add_customer_visible_in_sqlite(self):
        """通过 CustomerManager.add_customer 新增后，SQLite prospects 表可见。"""
        result = self.cm.add_customer({
            "company_name": "Test Co Ltd",
            "website": "https://testco.example.com",
            "country": "United States",
            "grade": "B",
            "score": 75,
        }, check_duplicate=False)

        # add_customer 返回客户 dict
        self.assertIsInstance(result, dict)
        cid = result["id"]

        # SQLite 中应有此记录
        row = self._get_sqlite_row(cid)
        self.assertIsNotNone(row, "新增客户应出现在 SQLite prospects 表")
        self.assertEqual(row["company_name"], "Test Co Ltd")
        self.assertEqual(row["status"], "new_lead")
        self.assertEqual(row["grade"], "B")

        # 通过 CustomerManager.get_customer 也能读到
        fetched = self.cm.get_customer(cid)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["company_name"], "Test Co Ltd")

    def test_add_customer_json_not_modified(self):
        """新增客户不应修改 customers.json 文件。"""
        # 记录 JSON 修改前的 MD5
        import hashlib
        md5_before = hashlib.md5(self.json_path.read_bytes()).hexdigest()

        self.cm.add_customer({
            "company_name": "No JSON Write Co",
            "website": "https://nojson.example.com",
        }, check_duplicate=False)

        # JSON 文件 MD5 不变
        md5_after = hashlib.md5(self.json_path.read_bytes()).hexdigest()
        self.assertEqual(md5_before, md5_after,
                         "customers.json 不应被修改")

    def test_list_customers_includes_new(self):
        """list_customers 应包含新增的 SQLite 客户。"""
        before = len(self.cm.list_customers())
        self.cm.add_customer({
            "company_name": "List Test Co",
            "website": "https://listtest.example.com",
        }, check_duplicate=False)
        after = len(self.cm.list_customers())
        self.assertEqual(after, before + 1,
                         "list_customers 应包含新增的 SQLite 客户")


# ---------------------------------------------------------------------------
# 2. 更新客户同步到 SQLite
# ---------------------------------------------------------------------------
class TestUpdateCustomerSyncs(TempDBTempJSONCase):

    def test_update_customer_updates_sqlite(self):
        """update_customer 后 SQLite 数据同步更新。"""
        # 先新增
        added = self.cm.add_customer({
            "company_name": "Update Test Co",
            "website": "https://updatetest.example.com",
        }, check_duplicate=False)
        cid = added["id"]

        # 更新
        updated = self.cm.update_customer(cid, {
            "grade": "A",
            "score": 90,
            "notes": "Updated notes",
        })
        self.assertIsNotNone(updated)

        # SQLite 中验证
        row = self._get_sqlite_row(cid)
        self.assertEqual(row["grade"], "A")
        self.assertEqual(row["score"], 90)
        self.assertEqual(row["notes"], "Updated notes")

    def test_move_stage_updates_sqlite(self):
        """move_stage 后 SQLite 的 status 和 pipeline_stage 更新。"""
        added = self.cm.add_customer({
            "company_name": "Stage Move Co",
            "website": "https://stagemove.example.com",
        }, check_duplicate=False)
        cid = added["id"]

        result = self.cm.move_stage(cid, "contacted")
        self.assertIsNotNone(result)

        row = self._get_sqlite_row(cid)
        self.assertEqual(row["pipeline_stage"], "contacted")
        self.assertEqual(row["status"], "sent")  # contacted → sent


# ---------------------------------------------------------------------------
# 3. 删除客户级联处理
# ---------------------------------------------------------------------------
class TestDeleteCustomerCascades(TempDBTempJSONCase):

    def test_delete_customer_soft_deletes_in_sqlite(self):
        """删除客户后 SQLite 中 status=invalid。"""
        added = self.cm.add_customer({
            "company_name": "Delete Test Co",
            "website": "https://deletetest.example.com",
        }, check_duplicate=False)
        cid = added["id"]

        # 确认删除前存在
        self.assertIsNotNone(self._get_sqlite_row(cid))

        # 删除
        self.cm.delete_customer(cid)

        # SQLite 中 status=invalid
        row = self._get_sqlite_row(cid)
        self.assertIsNotNone(row)  # 记录仍在（软删除）
        self.assertEqual(row["status"], "invalid")

    def test_delete_customer_closes_pending_tasks(self):
        """删除客户后关联的 pending 任务被关闭。"""
        added = self.cm.add_customer({
            "company_name": "Task Cascade Co",
            "website": "https://taskcascade.example.com",
        }, check_duplicate=False)
        cid = added["id"]

        # 添加一个任务
        self.repo.add_task(cid, "Follow up", "2026-12-31", priority="high")

        # 删除客户
        self.cm.delete_customer(cid)

        # 验证任务被关闭
        tasks = self.repo.list_tasks(customer_id=cid)
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["status"], "closed")

    def test_deleted_customer_not_in_list(self):
        """删除后 list_customers 不包含该客户。"""
        added = self.cm.add_customer({
            "company_name": "Hidden Co",
            "website": "https://hidden.example.com",
        }, check_duplicate=False)
        cid = added["id"]

        before = len([c for c in self.cm.list_customers() if c["id"] == cid])
        self.assertEqual(before, 1)

        self.cm.delete_customer(cid)

        after = len([c for c in self.cm.list_customers() if c["id"] == cid])
        self.assertEqual(after, 0, "已删除客户不应出现在 list_customers")


# ---------------------------------------------------------------------------
# 4. 写入失败完整回滚
# ---------------------------------------------------------------------------
class TestWriteFailureRollback(TempDBTempJSONCase):

    def test_add_customer_db_failure_no_half_state(self):
        """模拟 SQLite 写入失败时，不产生半成功状态。"""
        # 先记录当前客户数
        count_before = self._count_sqlite_customers()

        # Mock add_prospect 抛出异常
        with patch.object(self.repo, "add_prospect", side_effect=OSError("Simulated DB failure")):
            result = self.cm.add_customer({
                "company_name": "Fail Write Co",
                "website": "https://failwrite.example.com",
            }, check_duplicate=False)

        # 应返回错误
        self.assertFalse(result.get("success", True) if isinstance(result, dict) else True)

        # SQLite 中客户数不变（没有半成功写入）
        count_after = self._count_sqlite_customers()
        self.assertEqual(count_after, count_before,
                         "写入失败不应产生半成功状态")

    def test_update_customer_failure_no_partial_update(self):
        """更新失败时不产生部分更新。"""
        added = self.cm.add_customer({
            "company_name": "Partial Update Co",
            "website": "https://partial.example.com",
            "grade": "C",
        }, check_duplicate=False)
        cid = added["id"]

        original_grade = self._get_sqlite_row(cid)["grade"]

        # Mock update_prospect 抛出异常
        with patch.object(self.repo, "update_prospect", side_effect=RuntimeError("DB locked")):
            result = self.cm.update_customer(cid, {"grade": "A"})

        self.assertIsNone(result)

        # 数据不变
        row = self._get_sqlite_row(cid)
        self.assertEqual(row["grade"], original_grade,
                         "更新失败时数据不应被修改")


# ---------------------------------------------------------------------------
# 5. 重复提交不产生重复
# ---------------------------------------------------------------------------
class TestDuplicateSubmitNoDuplicate(TempDBTempJSONCase):

    def test_duplicate_website_detected(self):
        """相同网站地址的客户第二次提交被拒绝。"""
        self.cm.add_customer({
            "company_name": "First Submission",
            "website": "https://unique.example.com",
            "email": "contact@unique.example.com",
        }, check_duplicate=True)

        # 第二次提交相同网站
        result = self.cm.add_customer({
            "company_name": "Second Submission",
            "website": "https://unique.example.com",
        }, check_duplicate=True)

        self.assertFalse(result.get("success", True) if isinstance(result, dict) else False,
                         "重复网站应被检测到")
        if isinstance(result, dict):
            self.assertEqual(result.get("error"), "duplicate")

    def test_no_duplicate_rows_in_sqlite(self):
        """重复提交后 SQLite 中只有一条记录。"""
        self.cm.add_customer({
            "company_name": "Dup Check Co",
            "website": "https://dupcheck.example.com",
        }, check_duplicate=True)

        # 尝试再次添加（不同公司名但同网站）
        self.cm.add_customer({
            "company_name": "Dup Check Co II",
            "website": "https://dupcheck.example.com",
        }, check_duplicate=True)

        # SQLite 中按网站查只有一条
        rows = self.repo.find_by_website("https://dupcheck.example.com")
        self.assertEqual(len(rows), 1,
                         "相同网站不应产生重复记录")


# ---------------------------------------------------------------------------
# 6. 并发写入不丢数据
# ---------------------------------------------------------------------------
class TestConcurrentWritesNoLoss(TempDBTempJSONCase):

    def test_concurrent_adds_all_present(self):
        """多线程并发新增客户，所有记录都应存在。"""
        num_threads = 5
        results = []
        errors = []

        def add_worker(thread_id):
            try:
                r = self.cm.add_customer({
                    "company_name": f"Concurrent Co {thread_id}",
                    "website": f"https://concurrent-{thread_id}.example.com",
                }, check_duplicate=False)
                results.append(r)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=add_worker, args=(i,))
                   for i in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        # 无异常
        self.assertEqual(len(errors), 0, f"并发写入出现异常: {errors}")

        # 所有记录都在 SQLite 中
        success_count = sum(1 for r in results if isinstance(r, dict) and "id" in r)
        self.assertEqual(success_count, num_threads,
                         f"期望 {num_threads} 条记录，成功 {success_count} 条")

        # 每条都能在 SQLite 中查到
        for r in results:
            if isinstance(r, dict) and "id" in r:
                row = self._get_sqlite_row(r["id"])
                self.assertIsNotNone(row, f"客户 {r['id']} 应在 SQLite 中")


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    unittest.main(verbosity=2)
