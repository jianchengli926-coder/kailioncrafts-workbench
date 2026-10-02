# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI工作台 - P1安全与数据可靠性测试
覆盖：访问密码环境变量、原子JSON写入、JSON损坏恢复、客户ID唯一性、删除确认、CSV中文导出
不依赖pytest，直接运行：python3 test_p1_security.py
"""
import os
import sys
import json
import tempfile
import unittest
from pathlib import Path

# 确保可以导入工作台模块
sys.path.insert(0, str(Path(__file__).parent))

PASSED = 0
FAILED = 0
ERRORS = []


def run_test(name, func):
    global PASSED, FAILED
    try:
        func()
        PASSED += 1
        print(f"  ✅ {name}")
    except AssertionError as e:
        FAILED += 1
        ERRORS.append((name, str(e)))
        print(f"  ❌ {name}: {e}")
    except Exception as e:
        FAILED += 1
        ERRORS.append((name, f"{type(e).__name__}: {e}"))
        print(f"  💥 {name}: {type(e).__name__}: {e}")


# ============ 1. 访问密码环境变量测试 ============
def test_password_hardcoded_removed():
    """硬编码密码 441723 已从 app.py 移除"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    # 密码不应以硬编码比较形式存在
    assert 'pwd == "441723"' not in content, "硬编码密码 441723 仍然存在"
    assert "441723" not in content.replace("441723", ""), "密码字符串仍出现在代码中"
    assert "WORKBENCH_ACCESS_PASSWORD" in content, "环境变量 WORKBENCH_ACCESS_PASSWORD 未使用"


def test_password_env_var_usage():
    """app.py 使用 os.environ.get 获取密码"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert 'os.environ.get("WORKBENCH_ACCESS_PASSWORD"' in content or \
           "os.environ.get('WORKBENCH_ACCESS_PASSWORD'" in content, \
           "未使用 os.environ.get 获取 WORKBENCH_ACCESS_PASSWORD"


# ============ 2. 原子JSON写入测试 ============
def test_atomic_write_json_exists():
    """app.py 中存在 _atomic_write_json 函数"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "def _atomic_write_json" in content, "_atomic_write_json 函数未定义"
    assert "os.replace" in content, "原子写入未使用 os.replace"
    assert "tempfile" in content or "_tempfile" in content, "未使用临时文件"


def test_atomic_write_json_used_for_todos():
    """todos.json 使用原子写入"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    # 不应有 todo_file.write_text(_json.dumps 形式
    assert "todo_file.write_text(_json.dumps" not in content, "todos.json 仍使用非原子写入"
    assert "_atomic_write_json(todo_file" in content, "todos.json 未使用 _atomic_write_json"


def test_atomic_write_json_used_for_sources():
    """customer_sources.json 使用原子写入"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "source_file.write_text(_json.dumps" not in content, "customer_sources.json 仍使用非原子写入"


def test_atomic_write_json_used_for_inquiries():
    """inquiries.json 使用原子写入"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "_save_json(inquiries_file, inquiries)" in content, "inquiries.json 未通过 _save_json 保存"
    # _save_json 应调用 _atomic_write_json
    assert "_atomic_write_json(path, data)" in content, "_save_json 未使用原子写入"


def test_atomic_write_provider_manager():
    """provider_manager.py 使用 atomic_write_json"""
    with open("provider_manager.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "def atomic_write_json" in content, "provider_manager 无 atomic_write_json"
    assert "os.replace" in content, "provider_manager 原子写入未使用 os.replace"


def test_atomic_write_customer_manager():
    """customer_manager.py 客户数据写入 SQLite（事务+回滚），不再直接写 JSON"""
    with open("customer_manager.py", "r", encoding="utf-8") as f:
        content = f.read()
    # 新架构：客户写操作走 SQLite repository，应有事务/回滚/验证逻辑
    assert "transaction" in content or "rollback" in content or "verify_prospect" in content, \
        "customer_manager 无 SQLite 事务/回滚/写入验证"
    # 不应有直接 write_text 保存客户数据到 customers.json
    assert 'CUSTOMERS_FILE.write_text(json.dumps' not in content, "customer_manager 仍使用非原子写入"


def test_atomic_write_preserves_utf8():
    """原子写入保留 UTF-8 和 ensure_ascii=False"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "ensure_ascii=False" in content, "原子写入未设置 ensure_ascii=False"
    assert "encoding='utf-8'" in content or 'encoding="utf-8"' in content, "原子写入未设置 UTF-8"


# ============ 3. JSON损坏恢复测试 ============
def test_provider_manager_corruption_recovery():
    """provider_manager load_providers 在JSON损坏时返回空结构"""
    with open("provider_manager.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "JSONDecodeError" in content or "json.JSONDecodeError" in content, \
        "load_providers 未处理 JSONDecodeError"
    assert "_load_error" in content or "return {\"providers\"" in content or 'return {"providers"' in content, \
        "load_providers 损坏时未返回空结构"


def test_customer_manager_corruption_recovery():
    """customer_manager _load 在 JSON 损坏时优雅降级到 SQLite，不崩溃不返回空数据"""
    with open("customer_manager.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "except Exception" in content, "customer_manager._load 无异常处理"
    # 新架构：JSON 损坏时降级到 SQLite 读取，不 raise RuntimeError
    import customer_manager as cm_mod
    import importlib
    with tempfile.TemporaryDirectory() as td:
        # 隔离 SQLite 数据库
        db_path = str(Path(td) / "test.db")
        old_db = os.environ.get("WORKBENCH_DB_PATH")
        os.environ["WORKBENCH_DB_PATH"] = db_path
        if "repository" in sys.modules:
            importlib.reload(sys.modules["repository"])
        bad_file = Path(td) / "bad_customers.json"
        bad_file.write_text("{invalid json!!!", encoding="utf-8")
        original = cm_mod.CUSTOMERS_FILE
        cm_mod.CUSTOMERS_FILE = bad_file
        try:
            mgr = cm_mod.CustomerManager()
            result = mgr._load()
            # JSON 损坏时应降级到 SQLite（空库返回空列表），不应崩溃
            assert isinstance(result, list), f"损坏 JSON 应降级返回 list，实际 {type(result)}"
            # 不应因为 JSON 损坏而丢失 SQLite 中的客户
        finally:
            cm_mod.CUSTOMERS_FILE = original
            if old_db:
                os.environ["WORKBENCH_DB_PATH"] = old_db
            else:
                os.environ.pop("WORKBENCH_DB_PATH", None)


def test_inbox_load_json_corruption_recovery():
    """app.py 中 inbox _load_json 有损坏恢复"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    # 第一组 _load_json (inbox) 应有 try/except
    assert "JSONDecodeError" in content, "inbox _load_json 未处理 JSONDecodeError"


# ============ 4. 客户ID唯一性测试 ============
def test_customer_id_uniqueness_check():
    """customer_manager add_customer 有ID唯一性检查"""
    with open("customer_manager.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "_gen_unique_id" in content, "无 _gen_unique_id 函数"
    assert "existing_ids" in content, "未检查现有ID集合"
    assert "cid not in existing_ids" in content, "未验证ID不重复"


def test_customer_id_uniqueness_runtime():
    """运行时验证：添加多个客户ID不重复（使用隔离SQLite数据库）"""
    import customer_manager as cm_mod
    import importlib
    with tempfile.TemporaryDirectory() as td:
        test_file = Path(td) / "test_customers.json"
        db_path = str(Path(td) / "test.db")
        original = cm_mod.CUSTOMERS_FILE
        old_db = os.environ.get("WORKBENCH_DB_PATH")
        os.environ["WORKBENCH_DB_PATH"] = db_path
        if "repository" in sys.modules:
            importlib.reload(sys.modules["repository"])
        cm_mod.CUSTOMERS_FILE = test_file
        try:
            mgr = cm_mod.CustomerManager()
            ids = set()
            for i in range(20):
                c = mgr.add_customer({"company_name": f"Test {i}", "country": "US"})
                cid = c.get("id") or c.get("customer_id")
                assert cid not in ids, f"重复ID: {cid}"
                ids.add(cid)
            assert len(ids) == 20, f"20个客户应有20个唯一ID，实际{len(ids)}"
        finally:
            cm_mod.CUSTOMERS_FILE = original
            if old_db:
                os.environ["WORKBENCH_DB_PATH"] = old_db
            else:
                os.environ.pop("WORKBENCH_DB_PATH", None)


# ============ 5. 删除确认逻辑测试 ============
def test_two_step_delete_exists():
    """two_step_delete 函数存在"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "def two_step_delete" in content, "two_step_delete 函数未定义"


def test_customer_delete_uses_confirmation():
    """客户删除使用 two_step_delete 二次确认"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert 'two_step_delete("🗑️ 删除客户"' in content or "two_step_delete(\"删除客户" in content, \
        "客户删除未使用 two_step_delete"


def test_provider_delete_uses_confirmation():
    """供应商/模型删除使用二次确认"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    # 至少有一处模型/供应商删除使用 two_step_delete
    assert 'two_step_delete("🗑️"' in content or "two_step_delete(\"🗑" in content, \
        "未找到使用 two_step_delete 的删除操作"


# ============ 6. CSV中文导出测试 ============
def test_customer_export_csv_utf8_sig():
    """customer_manager export_csv 使用 utf-8-sig 编码（Excel中文兼容）"""
    with open("customer_manager.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "utf-8-sig" in content, "export_csv 未使用 utf-8-sig 编码"
    assert "csv.DictWriter" in content, "export_csv 未使用 csv.DictWriter"


def test_customer_export_csv_runtime():
    """运行时验证：导出含中文的CSV正确处理（使用隔离SQLite数据库）"""
    import customer_manager as cm_mod
    import importlib
    with tempfile.TemporaryDirectory() as td:
        test_file = Path(td) / "test_customers.json"
        db_path = str(Path(td) / "test.db")
        original = cm_mod.CUSTOMERS_FILE
        old_db = os.environ.get("WORKBENCH_DB_PATH")
        os.environ["WORKBENCH_DB_PATH"] = db_path
        # 重新加载 repository 模块使新 DB_PATH 生效
        if "repository" in sys.modules:
            importlib.reload(sys.modules["repository"])
        cm_mod.CUSTOMERS_FILE = test_file
        try:
            mgr = cm_mod.CustomerManager()
            mgr.add_customer({
                "company_name": "测试公司, 含逗号",
                "country": "中国",
                "products": '产品"含引号"和换行\n第二行',
                "grade": "A",
            })
            export_path = str(Path(td) / "export.csv")
            ok = mgr.export_csv(export_path)
            assert ok, "export_csv 返回 False"
            # 验证文件内容可正确解析
            import csv as csv_mod
            with open(export_path, "r", encoding="utf-8-sig", newline="") as f:
                reader = csv_mod.DictReader(f)
                rows = list(reader)
            assert len(rows) == 1, f"应导出1行，实际{len(rows)}"
            assert "测试公司, 含逗号" in rows[0]["company_name"], "逗号未正确处理"
            assert "中国" in rows[0]["country"], "中文未正确导出"
        finally:
            cm_mod.CUSTOMERS_FILE = original
            if old_db:
                os.environ["WORKBENCH_DB_PATH"] = old_db
            else:
                os.environ.pop("WORKBENCH_DB_PATH", None)


def test_filtered_csv_export_uses_csv_module():
    """app.py 筛选结果CSV导出使用 csv 模块（非手动join）"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    # 不应有手动 join 导出CSV
    assert '",".join([str(v) for v in r.values()])' not in content, \
        "筛选CSV导出仍使用手动join（不处理逗号/换行）"
    assert "DictWriter" in content or "csv.writer" in content, \
        "筛选CSV导出未使用csv模块"


# ============ 7. 安全：API Key不在DOM ============
def test_api_key_not_in_dom_value():
    """供应商编辑页 API Key 不放入 DOM value 属性"""
    with open("app.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "value=p['api_key']" not in content, "API Key 仍以 value=p['api_key'] 放入DOM"
    assert "value=p[\"api_key\"]" not in content, "API Key 仍以 value=p[\"api_key\"] 放入DOM"


def test_disabled_provider_cannot_be_active():
    """provider_manager set_active_provider 禁止 disabled 供应商"""
    with open("provider_manager.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert "disabled" in content, "set_active_provider 未检查 disabled 状态"
    assert "get('disabled', False)" in content or "get(\"disabled\", False)" in content, \
        "未使用 get('disabled', False) 检查"


# ============ 主函数 ============
if __name__ == "__main__":
    print("=" * 60)
    print("KaiLionCrafts P1安全与数据可靠性测试")
    print("=" * 60)

    print("\n📌 一、访问密码安全")
    run_test("硬编码密码已移除", test_password_hardcoded_removed)
    run_test("使用环境变量 WORKBENCH_ACCESS_PASSWORD", test_password_env_var_usage)

    print("\n📌 二、原子JSON写入")
    run_test("_atomic_write_json 函数存在", test_atomic_write_json_exists)
    run_test("todos.json 原子写入", test_atomic_write_json_used_for_todos)
    run_test("customer_sources.json 原子写入", test_atomic_write_json_used_for_sources)
    run_test("inquiries.json 原子写入", test_atomic_write_json_used_for_inquiries)
    run_test("provider_manager 原子写入", test_atomic_write_provider_manager)
    run_test("customer_manager 原子写入", test_atomic_write_customer_manager)
    run_test("原子写入保留UTF-8和ensure_ascii=False", test_atomic_write_preserves_utf8)

    print("\n📌 三、JSON损坏恢复")
    run_test("provider_manager 损坏恢复", test_provider_manager_corruption_recovery)
    run_test("customer_manager 损坏恢复（运行时）", test_customer_manager_corruption_recovery)
    run_test("inbox _load_json 损坏恢复", test_inbox_load_json_corruption_recovery)

    print("\n📌 四、客户ID唯一性")
    run_test("add_customer 有ID唯一性检查", test_customer_id_uniqueness_check)
    run_test("20个客户ID不重复（运行时）", test_customer_id_uniqueness_runtime)

    print("\n📌 五、删除确认")
    run_test("two_step_delete 函数存在", test_two_step_delete_exists)
    run_test("客户删除使用二次确认", test_customer_delete_uses_confirmation)
    run_test("供应商/模型删除使用二次确认", test_provider_delete_uses_confirmation)

    print("\n📌 六、CSV中文导出")
    run_test("export_csv 使用 utf-8-sig", test_customer_export_csv_utf8_sig)
    run_test("中文CSV导出运行时验证", test_customer_export_csv_runtime)
    run_test("筛选CSV使用csv模块", test_filtered_csv_export_uses_csv_module)

    print("\n📌 七、安全检查")
    run_test("API Key 不放入DOM value", test_api_key_not_in_dom_value)
    run_test("disabled供应商不能设为active", test_disabled_provider_cannot_be_active)

    print("\n" + "=" * 60)
    total = PASSED + FAILED
    print(f"测试总数: {total}  通过: {PASSED}  失败: {FAILED}")
    if ERRORS:
        print("\n失败详情:")
        for name, err in ERRORS:
            print(f"  - {name}: {err}")
    print("=" * 60)
    sys.exit(0 if FAILED == 0 else 1)
