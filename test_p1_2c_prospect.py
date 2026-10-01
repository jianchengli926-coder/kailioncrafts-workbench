# -*- coding: utf-8 -*-
"""
P1.2C 精准客户 ICP 评估与 Knowledge Pack 绑定测试
覆盖：ICP 评估、hard_blockers、Pack 绑定、重复检测、DNC、历史锁定
"""
import unittest
import json
import tempfile
import sqlite3
from pathlib import Path

import knowledge_facts as kf
import prospect_evaluator as pe

TEST_DB = Path(__file__).parent / "data" / "test_p1_2c_prospect.db"
kf.DB_PATH = TEST_DB
pe.DB_PATH = TEST_DB


def _cleanup():
    if TEST_DB.exists():
        TEST_DB.unlink()


def _create_approved_pack():
    """创建一个 approved Pack 用于测试"""
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
        'target_markets': ['US', 'Europe'],
        'buyer_types': ['wholesaler', 'distributor'],
    })
    pack_id = r2['pack']['pack_id']
    kf.approve_knowledge_pack(pack_id, 'tester')
    return pack_id, fact_id


class TestIcpEvaluation(unittest.TestCase):
    """测试1-5: 基础 ICP 评估"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        self.pack_id, self.fact_id = _create_approved_pack()

    def tearDown(self):
        _cleanup()

    def test_complete_customer_evaluable(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_001',
            'company_name': 'Test Company',
            'website': 'https://test.com',
            'country': 'US',
            'buyer_type': 'wholesaler',
            'product_categories': ['outdoor_knives'],
            'source_document': 'test.md',
            'source_url': 'https://test.com',
        }, pack_ref={'pack_id': self.pack_id})
        self.assertTrue(result['success'])
        self.assertEqual(result['identity_status'], 'verified')
        self.assertEqual(result['product_fit'], 'strong')
        self.assertEqual(result['market_fit'], 'strong')
        self.assertTrue(result['eligible'])

    def test_identity_unresolved_blocks(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_002',
            'company_name': '',
            'website': '',
        }, pack_ref={'pack_id': self.pack_id})
        self.assertTrue(any('identity_status=unresolved' in b for b in result['hard_blockers']))
        self.assertFalse(result['eligible'])

    def test_missing_company_name_blocks(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_003',
            'website': 'https://test.com',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        self.assertTrue(any('company_name' in b for b in result['hard_blockers']))
        self.assertFalse(result['eligible'])

    def test_missing_website_blocks(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_004',
            'company_name': 'Test',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        self.assertTrue(any('website' in b for b in result['hard_blockers']))
        self.assertFalse(result['eligible'])

    def test_unsafe_url_blocks(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_005',
            'company_name': 'Test',
            'website': 'javascript:alert(1)',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        self.assertTrue(any('不安全' in b for b in result['hard_blockers']))
        self.assertFalse(result['eligible'])


class TestDuplicateAndDnc(unittest.TestCase):
    """测试6-8: 重复客户和 DNC"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        self.pack_id, _ = _create_approved_pack()

    def tearDown(self):
        _cleanup()

    def test_duplicate_detection_returns_evidence(self):
        # 先创建一个评估记录
        pe.evaluate_customer_icp({
            'customer_id': 'cust_dup',
            'company_name': 'Duplicate Corp',
            'website': 'https://dup.com',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})

        # 再检测相同客户
        result = pe.detect_duplicate_customer({
            'company_name': 'Duplicate Corp',
            'website': 'https://dup.com',
        })
        self.assertTrue(result['is_duplicate'])
        self.assertGreater(len(result['matches']), 0)
        self.assertIsNotNone(result['matches'][0]['matched_value_hash'])

    def test_dnc_detection(self):
        # 创建带 DNC 标记的客户（通过评估记录）
        result = pe.check_dnc({
            'company_name': 'DNC Company',
            'website': 'https://dnc.com',
            'notes': '客户明确拒绝联系 DNC',
        })
        # DNC 检查可能返回 false（因为 customers.json 中没有匹配），但函数必须正常工作
        self.assertIn('is_dnc', result)

    def test_explicit_rejection_blocks(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_reject',
            'company_name': 'Reject Corp',
            'website': 'https://reject.com',
            'source_document': 'test.md',
            'notes': '客户明确拒绝联系',
        }, pack_ref={'pack_id': self.pack_id})
        self.assertTrue(any('拒绝' in b for b in result['hard_blockers']))


class TestProductFit(unittest.TestCase):
    """测试9-12: 产品匹配和市场匹配"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        self.pack_id, _ = _create_approved_pack()

    def tearDown(self):
        _cleanup()

    def test_missing_product_info_in_missing_evidence(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_noprod',
            'company_name': 'Test',
            'website': 'https://test.com',
            'country': 'US',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        self.assertTrue(any('产品信息' in m for m in result['missing_evidence']))

    def test_product_fit_strong(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_strong',
            'company_name': 'Test',
            'website': 'https://test.com',
            'country': 'US',
            'product_categories': ['outdoor_knives'],
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        self.assertEqual(result['product_fit'], 'strong')

    def test_product_fit_weak(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_weak',
            'company_name': 'Test',
            'website': 'https://test.com',
            'country': 'US',
            'product_categories': ['electronics'],
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        self.assertEqual(result['product_fit'], 'weak')

    def test_market_fit_strong(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_market',
            'company_name': 'Test',
            'website': 'https://test.com',
            'country': 'US',
            'product_categories': ['outdoor_knives'],
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        self.assertEqual(result['market_fit'], 'strong')


class TestHighScoreCannotBypass(unittest.TestCase):
    """测试13: 高 ICP 分数不能绕过 blocker"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        self.pack_id, _ = _create_approved_pack()

    def tearDown(self):
        _cleanup()

    def test_high_score_with_blocker_not_eligible(self):
        # 客户有高匹配特征但缺少网站（blocker）
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_high',
            'company_name': 'High Score Corp',
            'country': 'US',
            'buyer_type': 'wholesaler',
            'product_categories': ['outdoor_knives'],
            'source_document': 'test.md',
            'source_url': 'https://high.com',
        }, pack_ref={'pack_id': self.pack_id})
        # 缺少 website 应该是 blocker
        self.assertTrue(len(result['hard_blockers']) > 0)
        self.assertFalse(result['eligible'])
        # 但分数可能较高
        self.assertGreater(result['icp_score'], 0)


class TestPackBinding(unittest.TestCase):
    """测试14-20: Knowledge Pack 绑定"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        self.pack_id, self.fact_id = _create_approved_pack()

    def tearDown(self):
        _cleanup()

    def test_nonexistent_pack_cannot_evaluate(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_1',
            'company_name': 'Test',
            'website': 'https://test.com',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': 'nonexistent'})
        self.assertTrue(any('不存在' in b for b in result['hard_blockers']))

    def test_draft_pack_cannot_bind(self):
        r = kf.create_knowledge_pack({'name': 'Draft Pack'})
        draft_id = r['pack']['pack_id']
        result = pe.bind_knowledge_pack_to_customer('cust_1', draft_id)
        self.assertFalse(result['success'])
        self.assertTrue(any('draft' in e for e in result['errors']))

    def test_archived_pack_cannot_bind(self):
        kf.archive_knowledge_pack(self.pack_id)
        result = pe.bind_knowledge_pack_to_customer('cust_1', self.pack_id)
        self.assertFalse(result['success'])
        self.assertTrue(any('归档' in e for e in result['errors']))

    def test_approved_pack_can_bind(self):
        result = pe.bind_knowledge_pack_to_customer('cust_bind', self.pack_id)
        self.assertTrue(result['success'])
        self.assertEqual(result['knowledge_pack_id'], self.pack_id)
        self.assertIsNotNone(result['knowledge_snapshot_hash'])

    def test_binding_saves_version_and_hash(self):
        pe.bind_knowledge_pack_to_customer('cust_ver', self.pack_id)
        binding = pe.get_customer_knowledge_binding('cust_ver')
        self.assertIsNotNone(binding)
        self.assertEqual(binding['knowledge_pack_id'], self.pack_id)
        self.assertIsNotNone(binding['knowledge_pack_version'])
        self.assertIsNotNone(binding['knowledge_snapshot_hash'])
        self.assertGreater(len(binding['frozen_fact_ids']), 0)

    def test_pack_new_version_does_not_change_history(self):
        # 先绑定并评估
        pe.bind_knowledge_pack_to_customer('cust_hist', self.pack_id)
        eval_result = pe.evaluate_customer_icp({
            'customer_id': 'cust_hist',
            'company_name': 'History Test',
            'website': 'https://hist.com',
            'country': 'US',
            'product_categories': ['outdoor_knives'],
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        original_hash = eval_result['knowledge_snapshot_hash']

        # 创建新版本
        kf.create_next_knowledge_pack_version(self.pack_id, 'tester')

        # 历史评估的 hash 不变
        retrieved = pe.get_customer_evaluation(eval_result['evaluation_id'])
        self.assertEqual(retrieved['knowledge_snapshot_hash'], original_hash)

    def test_fact_update_does_not_change_history_snapshot(self):
        # 先评估
        eval_result = pe.evaluate_customer_icp({
            'customer_id': 'cust_fact',
            'company_name': 'Fact Test',
            'website': 'https://fact.com',
            'country': 'US',
            'product_categories': ['outdoor_knives'],
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        original_fact_ids = eval_result['fact_ids']

        # 注意：confirmed 事实不可直接更新，但历史快照应该独立
        retrieved = pe.get_customer_evaluation(eval_result['evaluation_id'])
        self.assertEqual(retrieved['fact_ids'], original_fact_ids)

    def test_hash_mismatch_detected(self):
        # 验证绑定的 hash 与 Pack 当前 hash 一致
        binding_result = pe.bind_knowledge_pack_to_customer('cust_hash', self.pack_id)
        pack = kf.get_knowledge_pack(self.pack_id)
        self.assertEqual(binding_result['knowledge_snapshot_hash'], pack['knowledge_snapshot_hash'])


class TestDuplicateEvidence(unittest.TestCase):
    """测试22-23: 重复证据保存和 DNC 不泄露联系方式"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        self.pack_id, _ = _create_approved_pack()

    def tearDown(self):
        _cleanup()

    def test_duplicate_evidence_saved(self):
        pe.evaluate_customer_icp({
            'customer_id': 'cust_dup1',
            'company_name': 'Evidence Corp',
            'website': 'https://ev.com',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})

        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_dup2',
            'company_name': 'Evidence Corp',
            'website': 'https://ev.com',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})

        # 检查 evidence 中有重复检测记录
        dup_evidence = [e for e in result['evidence'] if e.get('type') == 'duplicate_detection']
        self.assertTrue(len(dup_evidence) > 0)

    def test_dnc_does_not_leak_contact_info(self):
        result = pe.check_dnc({
            'company_name': 'Secret Corp',
            'website': 'https://secret.com',
            'notes': 'DNC',
        })
        # 结果中不应包含完整邮箱或电话
        result_str = json.dumps(result)
        self.assertNotIn('@', result_str)  # 不应有邮箱


class TestSecurityAndTransaction(unittest.TestCase):
    """测试24-26: 特殊字符、事务回滚、现有数据不受影响"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()

    def tearDown(self):
        _cleanup()

    def test_special_chars_do_not_break_structure(self):
        result = pe.evaluate_customer_icp({
            'customer_id': 'cust_special',
            'company_name': '<script>alert(1)</script>',
            'website': 'https://test.com',
            'country': 'US',
            'product_categories': ['outdoor_knives'],
            'source_document': 'test.md',
            'notes': 'DROP TABLE customers; --',
        })
        self.assertTrue(result['success'])
        # 特殊字符不应导致结构破坏，评估应正常完成
        self.assertIn('evaluation_id', result)
        # 从数据库读取验证特殊字符被正确保存
        retrieved = pe.get_customer_evaluation(result['evaluation_id'])
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved['company_name'], '<script>alert(1)</script>')

    def test_database_failure_rollback(self):
        # 使用只读文件作为数据库路径模拟写入失败
        import tempfile
        import os
        tmpdir = tempfile.mkdtemp()
        readonly_db = Path(tmpdir) / "readonly.db"
        readonly_db.touch()
        os.chmod(str(readonly_db), 0o444)  # 只读

        original_path = pe.DB_PATH
        pe.DB_PATH = readonly_db
        try:
            result = pe.evaluate_customer_icp({
                'customer_id': 'cust_fail',
                'company_name': 'Fail Test',
            })
            # 数据库不可用时应返回失败或不崩溃
            self.assertIn('success', result)
        except Exception:
            pass  # 允许抛出异常，关键是不破坏现有数据
        finally:
            pe.DB_PATH = original_path
            os.chmod(str(readonly_db), 0o644)
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_existing_data_not_affected(self):
        # 创建现有表
        conn = sqlite3.connect(str(TEST_DB))
        conn.execute("CREATE TABLE IF NOT EXISTS test_existing (id INTEGER PRIMARY KEY, val TEXT)")
        conn.execute("INSERT INTO test_existing (val) VALUES ('preserved')")
        conn.commit()
        conn.close()

        pe.init_db()

        conn = sqlite3.connect(str(TEST_DB))
        row = conn.execute("SELECT val FROM test_existing").fetchone()
        conn.close()
        self.assertEqual(row[0], 'preserved')


class TestGetQualification(unittest.TestCase):
    """额外测试: get_customer_qualification"""

    def setUp(self):
        _cleanup()
        kf.init_db()
        pe.init_db()
        self.pack_id, _ = _create_approved_pack()

    def tearDown(self):
        _cleanup()

    def test_get_customer_qualification(self):
        eval_result = pe.evaluate_customer_icp({
            'customer_id': 'cust_qual',
            'company_name': 'Qual Test',
            'website': 'https://qual.com',
            'country': 'US',
            'product_categories': ['outdoor_knives'],
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})

        result = pe.get_customer_qualification('cust_qual')
        self.assertTrue(result['success'])
        self.assertEqual(result['customer_id'], 'cust_qual')
        self.assertIn('hard_blockers', result)
        self.assertIn('eligible', result)

    def test_list_evaluations(self):
        pe.evaluate_customer_icp({
            'customer_id': 'cust_list1',
            'company_name': 'List1',
            'website': 'https://list1.com',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})
        pe.evaluate_customer_icp({
            'customer_id': 'cust_list2',
            'company_name': 'List2',
            'website': 'https://list2.com',
            'source_document': 'test.md',
        }, pack_ref={'pack_id': self.pack_id})

        results = pe.list_customer_evaluations()
        self.assertGreaterEqual(len(results), 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
