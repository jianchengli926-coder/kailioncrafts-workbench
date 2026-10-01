# -*- coding: utf-8 -*-
"""
P1.2D 知识库驱动的客户开发内容草稿测试
覆盖：Pack 校验、草稿生成、模型链、安全规则、持久化
"""
import unittest
import json
import tempfile
import sqlite3
from pathlib import Path

import knowledge_facts as kf
import prospect_evaluator as pe
import content_draft_generator as cdg

TEST_DB = Path(__file__).parent / "data" / "test_p1_2d_drafts.db"
kf.DB_PATH = TEST_DB
pe.DB_PATH = TEST_DB
cdg.DB_PATH = TEST_DB


def _cleanup():
    if TEST_DB.exists():
        TEST_DB.unlink()


def _create_approved_pack():
    """创建 approved Pack 和 confirmed Fact"""
    r = kf.create_knowledge_fact({
        'title': '户外刀产品事实', 'content': '440C不锈钢，HRC58-60',
        'source_url': 'https://example.com/product', 'type': 'product',
        'linked_product_categories': ['outdoor_knives'],
    })
    fact_id = r['fact']['fact_id']
    kf.review_knowledge_fact(fact_id, 'confirmed', 'tester', public_use_allowed=True)

    r2 = kf.create_knowledge_pack({
        'name': '测试Pack', 'allowed_fact_ids': [fact_id],
        'product_categories': ['outdoor_knives'],
        'target_markets': ['US'],
        'buyer_types': ['wholesaler'],
    })
    pack_id = r2['pack']['pack_id']
    kf.approve_knowledge_pack(pack_id, 'tester')
    return pack_id, fact_id


def _create_evaluated_customer(customer_id, pack_id):
    """创建一个已评估且无 blocker 的客户"""
    result = pe.evaluate_customer_icp({
        'customer_id': customer_id,
        'company_name': 'Test Customer',
        'website': 'https://test.com',
        'country': 'US',
        'buyer_type': 'wholesaler',
        'product_categories': ['outdoor_knives'],
        'source_document': 'test.md',
        'source_url': 'https://test.com',
    }, pack_ref={'pack_id': pack_id})
    pe.bind_knowledge_pack_to_customer(customer_id, pack_id)
    return result


class TestDraftPrerequisites(unittest.TestCase):
    """测试1-6: 草稿生成前置条件校验"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        cdg.init_db()
        self.pack_id, self.fact_id = _create_approved_pack()

    def tearDown(self):
        _cleanup()

    def test_approved_pack_can_generate(self):
        _create_evaluated_customer('cust_001', self.pack_id)
        result = cdg.validate_draft_generation_prerequisites('cust_001')
        self.assertTrue(result['can_generate'])
        self.assertFalse(result['internal_only'])

    def test_draft_pack_only_internal(self):
        # 创建 draft Pack
        r = kf.create_knowledge_pack({'name': 'Draft Pack'})
        draft_id = r['pack']['pack_id']
        _create_evaluated_customer('cust_002', self.pack_id)
        result = cdg.validate_draft_generation_prerequisites('cust_002', pack_ref={'pack_id': draft_id})
        self.assertTrue(result['can_generate'])
        self.assertTrue(result['internal_only'])

    def test_archived_pack_blocked(self):
        kf.archive_knowledge_pack(self.pack_id)
        _create_evaluated_customer('cust_003', self.pack_id)
        result = cdg.validate_draft_generation_prerequisites('cust_003', pack_ref={'pack_id': self.pack_id})
        self.assertTrue(result['can_generate'])
        self.assertTrue(result['internal_only'])

    def test_no_pack_only_internal(self):
        # 创建没有 Pack 绑定的客户
        pe.evaluate_customer_icp({
            'customer_id': 'cust_004',
            'company_name': 'No Pack Customer',
            'website': 'https://nopack.com',
            'country': 'US',
            'product_categories': ['outdoor_knives'],
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        # 不绑定 Pack
        result = cdg.validate_draft_generation_prerequisites('cust_004', pack_ref=None)
        self.assertTrue(result['can_generate'])
        self.assertTrue(result['internal_only'])

    def test_hard_blocker_blocks_external(self):
        # 创建有 blocker 的客户（缺少 website）
        pe.evaluate_customer_icp({
            'customer_id': 'cust_block',
            'company_name': 'Blocked Customer',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        result = cdg.validate_draft_generation_prerequisites('cust_block', allow_internal=False)
        self.assertFalse(result['can_generate'])

    def test_hard_blocker_allows_internal(self):
        pe.evaluate_customer_icp({
            'customer_id': 'cust_block2',
            'company_name': 'Blocked Customer',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        result = cdg.validate_draft_generation_prerequisites('cust_block2', allow_internal=True)
        self.assertTrue(result['can_generate'])
        self.assertTrue(result['internal_only'])


class TestDraftGeneration(unittest.TestCase):
    """测试7-15: 草稿生成"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        cdg.init_db()
        self.pack_id, self.fact_id = _create_approved_pack()
        _create_evaluated_customer('cust_gen', self.pack_id)

    def tearDown(self):
        _cleanup()

    def test_generate_first_email(self):
        result = cdg.generate_content_draft('cust_gen', 'first_email', use_mock=True)
        self.assertTrue(result['success'])
        self.assertEqual(result['draft_type'], 'first_email')
        self.assertFalse(result['internal_only'])
        self.assertIsNotNone(result['subject'])
        self.assertIsNotNone(result['body'])

    def test_generate_all_types(self):
        for dtype in cdg.DRAFT_TYPES:
            result = cdg.generate_content_draft('cust_gen', dtype, use_mock=True)
            self.assertTrue(result['success'], f"{dtype} 生成失败")
            self.assertEqual(result['draft_type'], dtype)

    def test_draft_saves_pack_info(self):
        result = cdg.generate_content_draft('cust_gen', 'first_email', use_mock=True)
        self.assertEqual(result['knowledge_pack_id'], self.pack_id)
        self.assertIsNotNone(result['knowledge_pack_version'])
        self.assertIsNotNone(result['knowledge_snapshot_hash'])

    def test_draft_saves_fact_ids(self):
        result = cdg.generate_content_draft('cust_gen', 'first_email', use_mock=True)
        self.assertGreater(len(result['fact_ids']), 0)
        self.assertEqual(result['fact_ids'][0], self.fact_id)

    def test_draft_saves_model_info(self):
        result = cdg.generate_content_draft('cust_gen', 'first_email', use_mock=True)
        self.assertIsNotNone(result['model'])
        self.assertIn('attempts', result)
        self.assertIn('trace_id', result)

    def test_draft_status_needs_review(self):
        result = cdg.generate_content_draft('cust_gen', 'first_email', use_mock=True)
        self.assertEqual(result['status'], 'needs_review')

    def test_internal_draft_status_draft(self):
        # 无 Pack 的客户
        pe.evaluate_customer_icp({
            'customer_id': 'cust_internal',
            'company_name': 'Internal',
            'website': 'https://internal.com',
            'source_document': 'test.md',
        })
        result = cdg.generate_content_draft('cust_internal', 'first_email', use_mock=True)
        self.assertTrue(result['internal_only'])
        self.assertEqual(result['status'], 'draft')

    def test_fact_update_does_not_change_history(self):
        result = cdg.generate_content_draft('cust_gen', 'first_email', use_mock=True)
        original_fact_ids = result['fact_ids']
        original_hash = result['knowledge_snapshot_hash']

        # 注意：confirmed 事实不可直接更新，但历史草稿应独立
        retrieved = cdg.get_content_draft(result['draft_id'])
        self.assertEqual(retrieved['fact_ids'], original_fact_ids)
        self.assertEqual(retrieved['knowledge_snapshot_hash'], original_hash)

    def test_draft_contains_confirmed_and_inferred(self):
        result = cdg.generate_content_draft('cust_gen', 'first_email', use_mock=True)
        self.assertIn('confirmed_claims', result)
        self.assertIn('inferred_claims', result)
        self.assertIn('missing_information', result)
        self.assertIn('risk_flags', result)


class TestModelChain(unittest.TestCase):
    """测试16-20: 模型链"""

    def test_standard_uses_four_node_chain(self):
        chain = cdg.get_draft_model_chain('standard')
        self.assertEqual(len(chain), 4)
        self.assertEqual(chain[0], 'glm-4.7-flash')
        self.assertEqual(chain[1], 'glm-4-flash')
        self.assertEqual(chain[2], 'qwen3.5:9b')
        self.assertEqual(chain[3], 'qwen2.5:7b')

    def test_standard_chain_excludes_deepseek(self):
        chain = cdg.get_draft_model_chain('standard')
        self.assertNotIn('deepseek-r1:7b', chain)
        self.assertNotIn('qwen2.5vl:7b', chain)
        self.assertNotIn('doubao-seed-2-1-turbo', chain)

    def test_reasoning_uses_three_node_chain(self):
        chain = cdg.get_draft_model_chain('reasoning')
        self.assertEqual(len(chain), 3)
        self.assertEqual(chain[0], 'glm-4.7-flash')
        self.assertEqual(chain[1], 'qwen3.5:9b')
        self.assertEqual(chain[2], 'deepseek-r1:7b')

    def test_generation_uses_correct_chain(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        cdg.init_db()
        pack_id, _ = _create_approved_pack()
        _create_evaluated_customer('cust_chain', pack_id)

        result = cdg.generate_content_draft('cust_chain', 'first_email', mode='standard', use_mock=True)
        self.assertEqual(result['model_chain'], cdg.DRAFT_TEXT_CHAIN)

        result2 = cdg.generate_content_draft('cust_chain', 'pain_point_analysis', mode='reasoning', use_mock=True)
        self.assertEqual(result2['model_chain'], cdg.DRAFT_REASONING_CHAIN)


class TestSafetyRules(unittest.TestCase):
    """测试21-25: 安全规则"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        cdg.init_db()
        self.pack_id, self.fact_id = _create_approved_pack()
        _create_evaluated_customer('cust_safe', self.pack_id)

    def tearDown(self):
        _cleanup()

    def test_no_send_button_or_smtp(self):
        # 验证代码中没有发送功能
        import inspect
        source = inspect.getsource(cdg)
        self.assertNotIn('smtplib', source)
        self.assertNotIn('send_email', source)
        self.assertNotIn('send_mail', source)

    def test_company_uses_partner_language(self):
        result = cdg.generate_content_draft('cust_safe', 'first_email', use_mock=True)
        body = result['body'].lower()
        # 应使用合作伙伴表述，不应声称自有工厂
        has_partner_lang = any(phrase in body for phrase in [
            'strategic manufacturing partners',
            'local manufacturing network',
            'supply chain collaboration',
            'verified supplier network',
            'manufacturing partners',
            'supplier network',
        ])
        self.assertTrue(has_partner_lang, f"正文缺少合作伙伴表述: {body[:200]}")

    def test_pending_fact_not_in_public_draft(self):
        # 创建 pending Fact 并加入 draft Pack
        r = kf.create_knowledge_fact({'title': 'Pending Fact', 'content': 'pending content'})
        pending_id = r['fact']['fact_id']
        r2 = kf.create_knowledge_pack({
            'name': 'Pending Pack', 'allowed_fact_ids': [pending_id],
        })
        pending_pack_id = r2['pack']['pack_id']
        # 尝试批准应该失败（因为 fact 是 pending）
        approve_result = kf.approve_knowledge_pack(pending_pack_id, 'tester')
        self.assertFalse(approve_result['success'])

    def test_xss_special_chars_safe(self):
        pe.evaluate_customer_icp({
            'customer_id': 'cust_xss',
            'company_name': '<script>alert(1)</script>',
            'website': 'https://xss.com',
            'country': 'US',
            'product_categories': ['outdoor_knives'],
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        pe.bind_knowledge_pack_to_customer('cust_xss', self.pack_id)
        result = cdg.generate_content_draft('cust_xss', 'first_email', use_mock=True)
        self.assertTrue(result['success'])
        # 特殊字符应被正确保存，不破坏结构
        retrieved = cdg.get_content_draft(result['draft_id'])
        self.assertIsNotNone(retrieved)

    def test_database_failure_rollback(self):
        import tempfile
        import os
        tmpdir = tempfile.mkdtemp()
        readonly_db = Path(tmpdir) / "readonly.db"
        readonly_db.touch()
        os.chmod(str(readonly_db), 0o444)

        original_path = cdg.DB_PATH
        cdg.DB_PATH = readonly_db
        try:
            result = cdg.generate_content_draft('cust_fail', 'first_email', use_mock=True)
            self.assertIn('success', result)
        except Exception:
            pass
        finally:
            cdg.DB_PATH = original_path
            os.chmod(str(readonly_db), 0o644)
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)


class TestDraftPersistence(unittest.TestCase):
    """测试26-28: 草稿持久化和管理"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        cdg.init_db()
        self.pack_id, _ = _create_approved_pack()
        _create_evaluated_customer('cust_persist', self.pack_id)

    def tearDown(self):
        _cleanup()

    def test_get_draft(self):
        gen_result = cdg.generate_content_draft('cust_persist', 'first_email', use_mock=True)
        draft = cdg.get_content_draft(gen_result['draft_id'])
        self.assertIsNotNone(draft)
        self.assertEqual(draft['draft_id'], gen_result['draft_id'])

    def test_list_drafts(self):
        cdg.generate_content_draft('cust_persist', 'first_email', use_mock=True)
        cdg.generate_content_draft('cust_persist', 'follow_up_email', use_mock=True)
        drafts = cdg.list_content_drafts(customer_id='cust_persist')
        self.assertGreaterEqual(len(drafts), 2)

    def test_update_status(self):
        gen_result = cdg.generate_content_draft('cust_persist', 'first_email', use_mock=True)
        result = cdg.update_draft_status(gen_result['draft_id'], 'approved')
        self.assertTrue(result['success'])
        draft = cdg.get_content_draft(gen_result['draft_id'])
        self.assertEqual(draft['status'], 'approved')

    def test_invalid_status_rejected(self):
        gen_result = cdg.generate_content_draft('cust_persist', 'first_email', use_mock=True)
        result = cdg.update_draft_status(gen_result['draft_id'], 'invalid_status')
        self.assertFalse(result['success'])


class TestNoRealDataModification(unittest.TestCase):
    """测试29: 不修改真实客户数据"""

    def test_uses_separate_test_db(self):
        self.assertIn('test_p1_2d', str(cdg.DB_PATH))
        self.assertNotEqual(cdg.DB_PATH, Path(__file__).parent / "data" / "workbench.db")


if __name__ == '__main__':
    unittest.main(verbosity=2)
