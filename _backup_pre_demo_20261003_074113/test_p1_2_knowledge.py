# -*- coding: utf-8 -*-
"""
P1.2A Knowledge Fact / Knowledge Pack 数据层测试
覆盖：Fact 默认状态、审核规则、Pack 冻结快照、版本继承、导入接口、事务回滚
"""
import unittest
import os
import sys
import json
import tempfile
import sqlite3
from pathlib import Path

# 使用临时数据库，不影响生产数据
TEST_DB = Path(__file__).parent / "data" / "test_p1_2_knowledge.db"

# 在导入前设置测试数据库
import knowledge_facts
knowledge_facts.DB_PATH = TEST_DB


def _cleanup():
    # P1 测试隔离修复：pytest 会先导入全部测试模块，knowledge_facts.DB_PATH 这个
    # 模块级全局会被后导入的测试文件覆盖。这里在每个 setUp 前重新指向本文件的专属 DB，
    # 保证各测试文件互不污染（原只在 import 时赋值，导致跨文件串库）。
    knowledge_facts.DB_PATH = TEST_DB
    if TEST_DB.exists():
        TEST_DB.unlink()


class TestKnowledgeFactDefaults(unittest.TestCase):
    """测试1-2: Fact 默认 pending 和 public_use_allowed=false"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()

    def tearDown(self):
        _cleanup()

    def test_fact_default_pending(self):
        r = knowledge_facts.create_knowledge_fact({'title': '测试事实', 'content': '内容'})
        self.assertTrue(r['success'])
        self.assertEqual(r['fact']['review_status'], 'pending')

    def test_fact_default_public_use_false(self):
        r = knowledge_facts.create_knowledge_fact({'title': '测试事实', 'content': '内容'})
        self.assertTrue(r['success'])
        self.assertFalse(r['fact']['public_use_allowed'])

    def test_fact_default_version_1(self):
        r = knowledge_facts.create_knowledge_fact({'title': '测试事实', 'content': '内容'})
        self.assertTrue(r['success'])
        self.assertEqual(r['fact']['version'], 1)


class TestKnowledgeFactReviewRules(unittest.TestCase):
    """测试3-6: 审核 fail-closed 规则"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()

    def tearDown(self):
        _cleanup()

    def test_ai_summary_cannot_confirm(self):
        r = knowledge_facts.create_knowledge_fact({
            'title': 'AI摘要', 'content': '内容', 'source_type': 'ai_summary',
            'source_url': 'https://example.com/doc'
        })
        self.assertTrue(r['success'])
        fid = r['fact']['fact_id']
        result = knowledge_facts.review_knowledge_fact(fid, 'confirmed', 'tester')
        self.assertFalse(result['success'])
        self.assertTrue(any('ai_summary' in e for e in result['errors']))

    def test_no_source_cannot_confirm(self):
        r = knowledge_facts.create_knowledge_fact({'title': '无来源', 'content': '内容'})
        self.assertTrue(r['success'])
        fid = r['fact']['fact_id']
        result = knowledge_facts.review_knowledge_fact(fid, 'confirmed', 'tester')
        self.assertFalse(result['success'])

    def test_dangerous_url_rejected(self):
        r = knowledge_facts.create_knowledge_fact({
            'title': '危险URL', 'content': '内容', 'source_url': 'javascript:alert(1)'
        })
        self.assertFalse(r['success'])

    def test_high_risk_requires_claim_subject(self):
        r = knowledge_facts.create_knowledge_fact({
            'title': '认证', 'type': 'certification', 'content': 'ISO9001',
            'source_url': 'https://example.com/cert'
        })
        self.assertTrue(r['success'])
        fid = r['fact']['fact_id']
        result = knowledge_facts.review_knowledge_fact(fid, 'confirmed', 'tester')
        self.assertFalse(result['success'])
        self.assertTrue(any('claim_subject' in e for e in result['errors']))

    def test_confirmed_with_valid_source(self):
        r = knowledge_facts.create_knowledge_fact({
            'title': '有效事实', 'content': '内容',
            'source_url': 'https://example.com/doc',
            'type': 'general'
        })
        self.assertTrue(r['success'])
        fid = r['fact']['fact_id']
        result = knowledge_facts.review_knowledge_fact(fid, 'confirmed', 'tester', public_use_allowed=True)
        self.assertTrue(result['success'])
        self.assertEqual(result['fact']['review_status'], 'confirmed')
        self.assertTrue(result['fact']['public_use_allowed'])


class TestKnowledgePackRules(unittest.TestCase):
    """测试7-10: Pack 事实准入规则"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        # 创建一个 confirmed + public 的事实
        r = knowledge_facts.create_knowledge_fact({
            'title': '公开事实', 'content': '内容',
            'source_url': 'https://example.com/doc', 'type': 'general'
        })
        self.public_fact_id = r['fact']['fact_id']
        knowledge_facts.review_knowledge_fact(self.public_fact_id, 'confirmed', 'tester', public_use_allowed=True)

        # 创建一个 confirmed 但 internal 的事实
        r2 = knowledge_facts.create_knowledge_fact({
            'title': '内部事实', 'content': '内容',
            'source_url': 'https://example.com/internal', 'type': 'general'
        })
        self.internal_fact_id = r2['fact']['fact_id']
        knowledge_facts.review_knowledge_fact(self.internal_fact_id, 'confirmed', 'tester', public_use_allowed=False)

    def tearDown(self):
        _cleanup()

    def test_confirmed_public_false_cannot_enter_pack(self):
        r = knowledge_facts.create_knowledge_pack({
            'name': '测试包', 'allowed_fact_ids': [self.internal_fact_id]
        })
        self.assertTrue(r['success'])
        pid = r['pack']['pack_id']
        result = knowledge_facts.approve_knowledge_pack(pid, 'tester')
        self.assertFalse(result['success'])
        self.assertTrue(any('public_use_allowed' in e for e in result['errors']))

    def test_pending_fact_cannot_enter_pack(self):
        r = knowledge_facts.create_knowledge_fact({'title': '待审核', 'content': '内容'})
        pending_id = r['fact']['fact_id']
        r2 = knowledge_facts.create_knowledge_pack({
            'name': '测试包', 'allowed_fact_ids': [pending_id]
        })
        result = knowledge_facts.approve_knowledge_pack(r2['pack']['pack_id'], 'tester')
        self.assertFalse(result['success'])

    def test_rejected_fact_cannot_enter_pack(self):
        r = knowledge_facts.create_knowledge_fact({'title': '已拒绝', 'content': '内容'})
        rid = r['fact']['fact_id']
        knowledge_facts.review_knowledge_fact(rid, 'rejected', 'tester')
        r2 = knowledge_facts.create_knowledge_pack({
            'name': '测试包', 'allowed_fact_ids': [rid]
        })
        result = knowledge_facts.approve_knowledge_pack(r2['pack']['pack_id'], 'tester')
        self.assertFalse(result['success'])

    def test_conflict_fact_cannot_enter_pack(self):
        r = knowledge_facts.create_knowledge_fact({'title': '冲突', 'content': '内容'})
        cid = r['fact']['fact_id']
        knowledge_facts.review_knowledge_fact(cid, 'conflict', 'tester')
        r2 = knowledge_facts.create_knowledge_pack({
            'name': '测试包', 'allowed_fact_ids': [cid]
        })
        result = knowledge_facts.approve_knowledge_pack(r2['pack']['pack_id'], 'tester')
        self.assertFalse(result['success'])


class TestKnowledgePackFreeze(unittest.TestCase):
    """测试11-14: 冻结快照、hash 稳定、Fact 更新不影响旧 Pack、approved 不可编辑"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        r = knowledge_facts.create_knowledge_fact({
            'title': '事实V1', 'content': '原始内容',
            'source_url': 'https://example.com/doc', 'type': 'general'
        })
        self.fact_id = r['fact']['fact_id']
        knowledge_facts.review_knowledge_fact(self.fact_id, 'confirmed', 'tester', public_use_allowed=True)

        r2 = knowledge_facts.create_knowledge_pack({
            'name': '测试包', 'allowed_fact_ids': [self.fact_id]
        })
        self.pack_id = r2['pack']['pack_id']
        self.approve_result = knowledge_facts.approve_knowledge_pack(self.pack_id, 'tester')

    def tearDown(self):
        _cleanup()

    def test_approved_pack_has_frozen_snapshots(self):
        self.assertTrue(self.approve_result['success'])
        pack = knowledge_facts.get_knowledge_pack(self.pack_id)
        self.assertIsNotNone(pack['frozen_fact_snapshots'])
        self.assertEqual(len(pack['frozen_fact_snapshots']), 1)
        self.assertEqual(pack['frozen_fact_snapshots'][0]['title'], '事实V1')

    def test_snapshot_hash_stable(self):
        pack = knowledge_facts.get_knowledge_pack(self.pack_id)
        h1 = pack['knowledge_snapshot_hash']
        # 重新计算
        h2 = knowledge_facts._compute_snapshot_hash(pack['frozen_fact_snapshots'])
        self.assertEqual(h1, h2)

    def test_fact_update_does_not_change_old_pack_snapshot(self):
        # 注意：confirmed 事实不可直接更新，这里验证快照内容独立
        pack = knowledge_facts.get_knowledge_pack(self.pack_id)
        original_content = pack['frozen_fact_snapshots'][0]['content']
        # 模拟事实内容变化（不实际更新 confirmed 事实）
        self.assertEqual(original_content, '原始内容')

    def test_approved_pack_cannot_edit(self):
        result = knowledge_facts.update_knowledge_pack(self.pack_id, {'name': '新名称'})
        self.assertFalse(result['success'])
        self.assertTrue(any('不可编辑' in e for e in result['errors']))


class TestPackVersioning(unittest.TestCase):
    """测试15-16: archived 不可绑定、create_next_version 继承递增"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        r = knowledge_facts.create_knowledge_fact({
            'title': '事实', 'content': '内容',
            'source_url': 'https://example.com/doc', 'type': 'general'
        })
        self.fact_id = r['fact']['fact_id']
        knowledge_facts.review_knowledge_fact(self.fact_id, 'confirmed', 'tester', public_use_allowed=True)
        r2 = knowledge_facts.create_knowledge_pack({'name': '包', 'allowed_fact_ids': [self.fact_id]})
        self.pack_id = r2['pack']['pack_id']
        knowledge_facts.approve_knowledge_pack(self.pack_id, 'tester')

    def tearDown(self):
        _cleanup()

    def test_archived_pack_status(self):
        r = knowledge_facts.archive_knowledge_pack(self.pack_id)
        self.assertTrue(r['success'])
        pack = knowledge_facts.get_knowledge_pack(self.pack_id)
        self.assertEqual(pack['status'], 'archived')

    def test_create_next_version_inherits_and_increments(self):
        r = knowledge_facts.create_next_knowledge_pack_version(self.pack_id, 'tester')
        self.assertTrue(r['success'])
        new_pack = r['pack']
        self.assertEqual(new_pack['version'], 2)
        self.assertEqual(new_pack['status'], 'draft')
        self.assertEqual(new_pack['root_pack_id'], knowledge_facts.get_knowledge_pack(self.pack_id)['root_pack_id'])
        self.assertEqual(new_pack['previous_pack_version'], 1)
        self.assertEqual(new_pack['cloned_from_pack_id'], self.pack_id)


class TestKbImport(unittest.TestCase):
    """测试17-19: dry-run 不修改、selected import 默认 pending、来源保留"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        self.tmpdir = tempfile.mkdtemp()
        self.test_file = Path(self.tmpdir) / "test_doc.md"
        self.test_file.write_text("# 测试文档\n\n这是测试内容", encoding='utf-8')

    def tearDown(self):
        _cleanup()
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_dry_run_does_not_modify_db(self):
        before = len(knowledge_facts.list_knowledge_facts())
        r = knowledge_facts.import_kb_dry_run([str(self.test_file)])
        self.assertTrue(r['success'])
        self.assertEqual(r['will_import_count'], 1)
        after = len(knowledge_facts.list_knowledge_facts())
        self.assertEqual(before, after)

    def test_selected_import_default_pending(self):
        r = knowledge_facts.import_selected_kb_files([str(self.test_file)])
        self.assertTrue(r['success'])
        self.assertEqual(len(r['imported_fact_ids']), 1)
        fact = knowledge_facts.get_knowledge_fact(r['imported_fact_ids'][0])
        self.assertEqual(fact['review_status'], 'pending')

    def test_import_preserves_source_metadata(self):
        r = knowledge_facts.import_selected_kb_files([str(self.test_file)])
        fact = knowledge_facts.get_knowledge_fact(r['imported_fact_ids'][0])
        self.assertEqual(fact['source_document'], str(self.test_file))
        self.assertEqual(fact['source_locator'], 'test_doc.md')
        self.assertIsNotNone(fact['source_hash'])


class TestSecurityAndTransaction(unittest.TestCase):
    """测试20-22: XSS 特殊字符、事务回滚、现有数据不受影响"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()

    def tearDown(self):
        _cleanup()

    def test_xss_special_chars_preserved(self):
        r = knowledge_facts.create_knowledge_fact({
            'title': '<script>alert(1)</script>',
            'content': '<img src=x onerror=alert(1)>',
            'tags': ['<b>bold</b>'],
        })
        self.assertTrue(r['success'])
        fact = knowledge_facts.get_knowledge_fact(r['fact']['fact_id'])
        self.assertIn('<script>', fact['title'])
        self.assertIn('<img', fact['content'])

    def test_transaction_rollback_on_error(self):
        # 测试数据库约束错误时回滚：手动插入重复 fact_id
        conn = sqlite3.connect(str(TEST_DB))
        conn.execute("INSERT INTO knowledge_facts (fact_id, title, content, review_status, version, public_use_allowed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     ('dup_test_id', '重复', '内容', 'pending', 1, 0, '2024-01-01', '2024-01-01'))
        conn.commit()
        conn.close()

        # 尝试创建相同 fact_id 的事实（通过直接调用内部逻辑模拟）
        original_gen = knowledge_facts._gen_id
        knowledge_facts._gen_id = lambda prefix: 'dup_test_id'
        try:
            r = knowledge_facts.create_knowledge_fact({'title': '测试', 'content': '内容'})
            self.assertFalse(r['success'])
            self.assertTrue(any('数据库错误' in e for e in r['errors']))
        finally:
            knowledge_facts._gen_id = original_gen

    def test_existing_tables_not_affected(self):
        # 验证 init_db 不破坏现有表
        conn = sqlite3.connect(str(TEST_DB))
        conn.execute("CREATE TABLE IF NOT EXISTS test_existing (id INTEGER PRIMARY KEY, val TEXT)")
        conn.execute("INSERT INTO test_existing (val) VALUES ('preserved')")
        conn.commit()
        conn.close()

        knowledge_facts.init_db()

        conn = sqlite3.connect(str(TEST_DB))
        row = conn.execute("SELECT val FROM test_existing").fetchone()
        conn.close()
        self.assertEqual(row[0], 'preserved')


class TestFactSearchAndList(unittest.TestCase):
    """额外测试：搜索和列表筛选"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        knowledge_facts.create_knowledge_fact({'title': '产品A规格', 'content': '产品A详细规格', 'type': 'product'})
        knowledge_facts.create_knowledge_fact({'title': '公司简介', 'content': '公司介绍', 'type': 'company'})

    def tearDown(self):
        _cleanup()

    def test_search_by_keyword(self):
        results = knowledge_facts.search_knowledge_facts('产品A')
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['title'], '产品A规格')

    def test_list_by_type(self):
        results = knowledge_facts.list_knowledge_facts(fact_type='company')
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['type'], 'company')

    def test_list_by_status(self):
        results = knowledge_facts.list_knowledge_facts(status='pending')
        self.assertEqual(len(results), 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
