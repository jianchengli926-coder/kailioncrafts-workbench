# -*- coding: utf-8 -*-
"""
FE-054 回归测试：ICP 评估后自动建档时，SQLite 不得因 list/dict 字段报错。

根因：repository.add_prospect / update_prospect 的防御性序列化只覆盖了
product_categories，未覆盖 main_products / analysis / due_diligence。
当 ICP 流程或其他调用方传入 list/dict 时，SQLite 报：
  Error binding parameter 10: type 'list' is not supported
"""
import os
import json
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def repo(tmp_path):
    """使用临时 DB 的 CustomerRepository，绝不触碰生产数据。"""
    os.environ["WORKBENCH_ACCESS_PASSWORD"] = "test"
    import repository as repo_mod
    r = repo_mod.CustomerRepository(db_path=tmp_path / "test.db")
    r.init_db()
    return r


def test_add_prospect_with_list_main_products(repo):
    """main_products 为 list 时应自动序列化为 JSON 字符串。"""
    rec = repo.add_prospect({
        "customer_id": "cust_test_list_main",
        "company_name": "Test List Main Co",
        "main_products": ["Chef Knife", "Paring Knife", "Scissors"],
    })
    assert isinstance(rec["main_products"], str)
    assert json.loads(rec["main_products"]) == ["Chef Knife", "Paring Knife", "Scissors"]
    # 回读验证
    stored = repo.get_prospect("cust_test_list_main")
    assert json.loads(stored["main_products"]) == ["Chef Knife", "Paring Knife", "Scissors"]


def test_add_prospect_with_dict_analysis(repo):
    """analysis 为 dict 时应自动序列化为 JSON 字符串。"""
    rec = repo.add_prospect({
        "customer_id": "cust_test_dict_analysis",
        "company_name": "Test Dict Analysis Co",
        "analysis": {"fit": "strong", "score": 85, "tags": ["wholesale", "oem"]},
    })
    assert isinstance(rec["analysis"], str)
    parsed = json.loads(rec["analysis"])
    assert parsed["fit"] == "strong"
    assert parsed["tags"] == ["wholesale", "oem"]


def test_add_prospect_with_list_product_categories(repo):
    """product_categories 为 list 时仍正确序列化（回归）。"""
    rec = repo.add_prospect({
        "customer_id": "cust_test_list_cats",
        "company_name": "Test List Cats Co",
        "product_categories": ["Kitchen Knives", "Scissors"],
    })
    assert json.loads(rec["product_categories"]) == ["Kitchen Knives", "Scissors"]


def test_update_prospect_with_list_field(repo):
    """update_prospect 传入 list 字段时也应序列化。"""
    repo.add_prospect({
        "customer_id": "cust_test_upd",
        "company_name": "Test Update Co",
        "main_products": "initial string",
    })
    updated = repo.update_prospect("cust_test_upd", {
        "main_products": ["Bread Knife", "Cleaver"],
        "analysis": {"updated": True},
    })
    assert json.loads(updated["main_products"]) == ["Bread Knife", "Cleaver"]
    assert json.loads(updated["analysis"]) == {"updated": True}


def test_add_prospect_string_fields_unchanged(repo):
    """字符串字段不应被序列化逻辑破坏（回归）。"""
    rec = repo.add_prospect({
        "customer_id": "cust_test_str",
        "company_name": "Test String Co",
        "main_products": "Plain string products",
        "product_categories": "Knives, Scissors",
    })
    assert rec["main_products"] == "Plain string products"
    assert rec["product_categories"] == "Knives, Scissors"
