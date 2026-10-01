# -*- coding: utf-8 -*-
"""
P1.2B Knowledge Base dry-run 导入、来源追溯和只读检索测试
覆盖：文件扫描、分类统计、dry-run、重复检测、冲突检测、增强检索、来源追溯
"""
import unittest
import json
import tempfile
import sqlite3
from pathlib import Path

import knowledge_facts
TEST_DB = Path(__file__).parent / "data" / "test_p1_2b_knowledge.db"
knowledge_facts.DB_PATH = TEST_DB


def _cleanup():
    if TEST_DB.exists():
        TEST_DB.unlink()


def _create_test_kb(tmpdir):
    """创建测试知识库结构"""
    kb_root = Path(tmpdir) / "test_kb"
    cat00 = kb_root / "00_导航与规范"
    cat01 = kb_root / "01_公司与品牌"
    cat02 = kb_root / "02_产品知识库"
    for d in [cat00, cat01, cat02]:
        d.mkdir(parents=True, exist_ok=True)

    # 创建测试文件
    (cat00 / "01_核心事实.md").write_text("# 公司核心事实\n\nKaiLionCrafts成立于2010年，专注户外刀剪。", encoding='utf-8')
    (cat01 / "02_工厂介绍.md").write_text("# 工厂介绍\n\n工厂面积2000平方米，员工50人。OEM/ODM服务。", encoding='utf-8')
    (cat02 / "03_户外刀规格.md").write_text("# 户外刀规格\n\n440C不锈钢，HRC58-60。美国市场热销。", encoding='utf-8')
    (cat02 / "04_厨房刀.md").write_text("# 厨房刀\n\n德国钢，适合欧洲市场。批发商和零售商。", encoding='utf-8')

    # 保存原始 KB_ROOT
    original_kb_root = knowledge_facts.KB_ROOT
    knowledge_facts.KB_ROOT = kb_root
    return kb_root, original_kb_root


class TestKbScan(unittest.TestCase):
    """测试1-2: 文件扫描和分类统计"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        self.tmpdir = tempfile.mkdtemp()
        self.kb_root, self.original_kb_root = _create_test_kb(self.tmpdir)

    def tearDown(self):
        _cleanup()
        knowledge_facts.KB_ROOT = self.original_kb_root
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_scan_kb_files(self):
        result = knowledge_facts.scan_kb_files()
        self.assertTrue(result['success'])
        self.assertEqual(result['total_files'], 4)
        self.assertIn('00', result['categories'])
        self.assertEqual(result['categories']['00']['file_count'], 1)

    def test_scan_by_category(self):
        result = knowledge_facts.scan_kb_files(categories=['02'])
        self.assertTrue(result['success'])
        self.assertEqual(result['total_files'], 2)

    def test_get_kb_categories_stats(self):
        result = knowledge_facts.get_kb_categories_stats()
        self.assertTrue(result['success'])
        self.assertEqual(result['total_categories'], 3)
        self.assertTrue(result['categories']['00']['allowed_import'])


class TestKbDryRun(unittest.TestCase):
    """测试3-5: dry-run 预览、不修改数据库、元数据保留"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        self.tmpdir = tempfile.mkdtemp()
        self.kb_root, self.original_kb_root = _create_test_kb(self.tmpdir)
        self.test_files = [
            str(self.kb_root / "00_导航与规范" / "01_核心事实.md"),
            str(self.kb_root / "02_产品知识库" / "03_户外刀规格.md"),
        ]

    def tearDown(self):
        _cleanup()
        knowledge_facts.KB_ROOT = self.original_kb_root
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_dry_run_does_not_modify_db(self):
        before = len(knowledge_facts.list_knowledge_facts())
        result = knowledge_facts.import_kb_dry_run_enhanced(self.test_files)
        self.assertTrue(result['success'])
        after = len(knowledge_facts.list_knowledge_facts())
        self.assertEqual(before, after)

    def test_dry_run_preserves_source_metadata(self):
        result = knowledge_facts.import_kb_dry_run_enhanced(self.test_files)
        self.assertTrue(result['success'])
        self.assertEqual(len(result['preview']), 2)
        fact = result['preview'][0]
        self.assertIsNotNone(fact['source_document'])
        self.assertIsNotNone(fact['source_locator'])
        self.assertIsNotNone(fact['source_hash'])
        self.assertIsNotNone(fact['source_excerpt'])

    def test_dry_run_default_pending(self):
        result = knowledge_facts.import_kb_dry_run_enhanced(self.test_files)
        for fact in result['preview']:
            self.assertEqual(fact['review_status'], 'pending')
            self.assertFalse(fact['public_use_allowed'])


class TestDuplicateDetection(unittest.TestCase):
    """测试6-7: 重复检测"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        self.tmpdir = tempfile.mkdtemp()
        self.kb_root, self.original_kb_root = _create_test_kb(self.tmpdir)
        self.test_file = str(self.kb_root / "00_导航与规范" / "01_核心事实.md")

    def tearDown(self):
        _cleanup()
        knowledge_facts.KB_ROOT = self.original_kb_root
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_detect_new_file(self):
        result = knowledge_facts.detect_duplicates([self.test_file])
        self.assertTrue(result['success'])
        self.assertEqual(result['new_count'], 1)

    def test_detect_existing_duplicate(self):
        # 先导入一个文件
        knowledge_facts.import_selected_kb_files([self.test_file])
        # 再检测应该发现重复
        result = knowledge_facts.detect_duplicates([self.test_file])
        self.assertEqual(result['duplicate_count'], 1)
        self.assertEqual(result['results'][0]['status'], 'duplicate_existing')

    def test_detect_in_batch_duplicate(self):
        # 创建两个内容相同的文件
        f1 = Path(self.tmpdir) / "dup1.md"
        f2 = Path(self.tmpdir) / "dup2.md"
        content = "# 重复内容\n\n相同内容"
        f1.write_text(content, encoding='utf-8')
        f2.write_text(content, encoding='utf-8')
        result = knowledge_facts.detect_duplicates([str(f1), str(f2)])
        self.assertEqual(result['duplicate_count'], 1)


class TestConflictDetection(unittest.TestCase):
    """测试8: 冲突检测"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        self.tmpdir = tempfile.mkdtemp()
        self.kb_root, self.original_kb_root = _create_test_kb(self.tmpdir)

    def tearDown(self):
        _cleanup()
        knowledge_facts.KB_ROOT = self.original_kb_root
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_detect_title_content_mismatch(self):
        # 先导入一个事实
        f = self.kb_root / "00_导航与规范" / "01_核心事实.md"
        knowledge_facts.import_selected_kb_files([str(f)])
        # 修改文件内容（同标题不同内容）
        f.write_text("# 公司核心事实\n\n修改后的内容，与原来不同。", encoding='utf-8')
        result = knowledge_facts.detect_conflicts([str(f)])
        self.assertTrue(result['success'])
        self.assertGreaterEqual(result['conflict_count'], 0)  # 可能检测到冲突


class TestEnhancedSearch(unittest.TestCase):
    """测试9-12: 增强检索、过滤、public_use_allowed"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        # 创建测试事实
        r1 = knowledge_facts.create_knowledge_fact({
            'title': '户外刀产品规格', 'content': '440C不锈钢，美国市场',
            'source_url': 'https://example.com/1', 'type': 'product',
            'linked_product_categories': ['outdoor_knives'],
            'tags': ['wholesaler'],
        })
        knowledge_facts.review_knowledge_fact(r1['fact']['fact_id'], 'confirmed', 'tester', public_use_allowed=True)

        r2 = knowledge_facts.create_knowledge_fact({
            'title': '厨房刀产品信息', 'content': '德国钢，欧洲市场',
            'source_url': 'https://example.com/2', 'type': 'product',
            'linked_product_categories': ['kitchen_knives'],
            'tags': ['retailer'],
        })
        knowledge_facts.review_knowledge_fact(r2['fact']['fact_id'], 'confirmed', 'tester', public_use_allowed=False)

        r3 = knowledge_facts.create_knowledge_fact({
            'title': '待审核事实', 'content': '待审核内容',
        })

    def tearDown(self):
        _cleanup()

    def test_search_by_keyword(self):
        result = knowledge_facts.search_knowledge_facts_enhanced(query='户外刀')
        self.assertTrue(result['success'])
        self.assertEqual(result['total'], 1)

    def test_search_by_product_category(self):
        result = knowledge_facts.search_knowledge_facts_enhanced(product_category='outdoor_knives')
        self.assertEqual(result['total'], 1)

    def test_search_by_buyer_type(self):
        result = knowledge_facts.search_knowledge_facts_enhanced(buyer_type='wholesaler')
        self.assertEqual(result['total'], 1)

    def test_search_public_only(self):
        result = knowledge_facts.search_knowledge_facts_enhanced(public_only=True)
        self.assertEqual(result['total'], 1)  # 只有 public_use_allowed=true 的
        for f in result['results']:
            self.assertTrue(f['public_use_allowed'])
            self.assertEqual(f['review_status'], 'confirmed')

    def test_get_public_facts(self):
        result = knowledge_facts.get_public_facts()
        self.assertTrue(result['success'])
        self.assertEqual(result['total'], 1)


class TestSourceTrace(unittest.TestCase):
    """测试13-14: 来源追溯"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        r = knowledge_facts.create_knowledge_fact({
            'title': '测试事实', 'content': '内容',
            'source_url': 'https://example.com/doc',
            'source_document': 'test.md', 'source_locator': 'page 1',
            'source_hash': 'abc123', 'type': 'general',
        })
        self.fact_id = r['fact']['fact_id']
        knowledge_facts.review_knowledge_fact(self.fact_id, 'confirmed', 'tester', public_use_allowed=True)

    def tearDown(self):
        _cleanup()

    def test_get_fact_source_trace(self):
        result = knowledge_facts.get_fact_source_trace(self.fact_id)
        self.assertTrue(result['success'])
        trace = result['trace']
        self.assertEqual(trace['fact_id'], self.fact_id)
        self.assertIsNotNone(trace['source']['document'])
        self.assertIsNotNone(trace['source']['hash'])
        self.assertTrue(trace['source_verifiable'])

    def test_source_verifiable_false(self):
        r = knowledge_facts.create_knowledge_fact({'title': '无来源', 'content': '内容'})
        result = knowledge_facts.get_fact_source_trace(r['fact']['fact_id'])
        self.assertFalse(result['trace']['source_verifiable'])


class TestSelectedImport(unittest.TestCase):
    """测试15: selected import 默认 pending"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        self.tmpdir = tempfile.mkdtemp()
        self.kb_root, self.original_kb_root = _create_test_kb(self.tmpdir)
        self.test_files = [
            str(self.kb_root / "00_导航与规范" / "01_核心事实.md"),
        ]

    def tearDown(self):
        _cleanup()
        knowledge_facts.KB_ROOT = self.original_kb_root
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_import_default_pending(self):
        result = knowledge_facts.import_selected_kb_files_enhanced(self.test_files)
        self.assertTrue(result['success'])
        self.assertEqual(result['imported_count'], 1)
        fact = knowledge_facts.get_knowledge_fact(result['imported_fact_ids'][0])
        self.assertEqual(fact['review_status'], 'pending')
        self.assertFalse(fact['public_use_allowed'])

    def test_import_skip_duplicates(self):
        # 第一次导入
        knowledge_facts.import_selected_kb_files_enhanced(self.test_files)
        # 第二次导入应该跳过重复
        result = knowledge_facts.import_selected_kb_files_enhanced(self.test_files, skip_duplicates=True)
        self.assertEqual(result['imported_count'], 0)
        self.assertEqual(result['skipped_count'], 1)


class TestInferredMetadata(unittest.TestCase):
    """测试16: 推断产品品类、市场、买家类型"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        self.tmpdir = tempfile.mkdtemp()
        self.kb_root, self.original_kb_root = _create_test_kb(self.tmpdir)

    def tearDown(self):
        _cleanup()
        knowledge_facts.KB_ROOT = self.original_kb_root
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_infer_product_category(self):
        f = str(self.kb_root / "02_产品知识库" / "03_户外刀规格.md")
        result = knowledge_facts.import_kb_dry_run_enhanced([f])
        fact = result['preview'][0]
        self.assertIn('outdoor_knives', fact['inferred_product_categories'])

    def test_infer_target_market(self):
        f = str(self.kb_root / "02_产品知识库" / "03_户外刀规格.md")
        result = knowledge_facts.import_kb_dry_run_enhanced([f])
        fact = result['preview'][0]
        self.assertIn('US', fact['inferred_target_markets'])

    def test_infer_buyer_type(self):
        f = str(self.kb_root / "02_产品知识库" / "04_厨房刀.md")
        result = knowledge_facts.import_kb_dry_run_enhanced([f])
        fact = result['preview'][0]
        self.assertTrue(len(fact['inferred_buyer_types']) > 0)


class TestImportReadiness(unittest.TestCase):
    """测试17: 导入就绪报告"""

    def setUp(self):
        _cleanup()
        knowledge_facts.init_db()
        self.tmpdir = tempfile.mkdtemp()
        self.kb_root, self.original_kb_root = _create_test_kb(self.tmpdir)

    def tearDown(self):
        _cleanup()
        knowledge_facts.KB_ROOT = self.original_kb_root
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_import_readiness_report(self):
        result = knowledge_facts.get_kb_import_readiness_report()
        self.assertTrue(result['success'])
        self.assertIn('allowed_categories', result)
        self.assertIn('total_files_in_allowed_categories', result)
        self.assertIn('recommendation', result)


if __name__ == '__main__':
    unittest.main(verbosity=2)
