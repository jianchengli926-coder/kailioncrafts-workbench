# -*- coding: utf-8 -*-
"""
P1.4A: 真实 qwen3.5:9b 草稿生成验证
使用独立测试数据库，不修改真实客户数据
"""
import os
import sys
import json
import tempfile
from pathlib import Path

# 使用独立测试数据库
TEST_DB = Path(__file__).parent / "data" / "test_p1_4a_runtime.db"

# 清理旧测试数据库
if TEST_DB.exists():
    TEST_DB.unlink()

# 设置环境变量使用测试数据库
os.environ["WORKBENCH_DB_PATH"] = str(TEST_DB)

# 导入模块
import knowledge_facts
import prospect_evaluator
import content_draft_generator
from ai_client import AIClient

def run_test():
    print("=" * 60)
    print("P1.4A: 真实 qwen3.5:9b 草稿生成验证")
    print("=" * 60)

    # 1. 初始化数据库
    print("\n[1] 初始化测试数据库...")
    knowledge_facts.init_db()
    prospect_evaluator.init_db()
    content_draft_generator.init_db()
    print(f"    数据库: {TEST_DB}")

    # 2. 创建测试 Fact
    print("\n[2] 创建测试 Knowledge Fact...")
    fact_result = knowledge_facts.create_knowledge_fact({
        "title": "P1.4A Test Fact - Handcrafted Wooden Crafts",
        "content": "KaiLionCrafts specializes in handcrafted wooden crafts including cutting boards, utensils, and home decor items. Products are made from sustainable bamboo and beech wood.",
        "type": "product_capability",
        "source_type": "document",
        "source_document": "product_catalog_v1.pdf",
        "source_locator": "page 3",
        "source_excerpt": "Handcrafted wooden crafts made from sustainable bamboo and beech wood.",
        "source_url": "",
        "source_hash": "test_hash_p1_4a_001",
        "claim_subject": "KaiLionCrafts",
        "public_use_allowed": False,
        "tags": ["wooden", "crafts", "bamboo"],
        "linked_product_categories": ["wooden_crafts"],
    })
    fact = fact_result["fact"]
    fact_id = fact["fact_id"]
    print(f"    fact_id: {fact_id}")
    print(f"    review_status: {fact['review_status']}")
    print(f"    public_use_allowed: {fact['public_use_allowed']}")

    # 3. 审核为 confirmed + public_use_allowed=true
    print("\n[3] 审核为 confirmed + public_use_allowed=true...")
    review_result = knowledge_facts.review_knowledge_fact(
        fact_id=fact_id,
        status="confirmed",
        reviewed_by="test_reviewer_p1_4a",
        notes="Source verified, approved for public use",
        public_use_allowed=True,
    )
    print(f"    success: {review_result.get('success')}")
    if review_result.get('success'):
        reviewed_fact = review_result['fact']
        print(f"    review_status: {reviewed_fact['review_status']}")
        print(f"    public_use_allowed: {reviewed_fact['public_use_allowed']}")
        print(f"    reviewed_by: {reviewed_fact['reviewed_by']}")
    else:
        print(f"    errors: {review_result.get('errors')}")

    # 4. 创建并批准测试 Knowledge Pack
    print("\n[4] 创建并批准测试 Knowledge Pack...")
    pack_result = knowledge_facts.create_knowledge_pack({
        "name": "P1.4A Test Pack",
        "product_categories": ["wooden_crafts"],
        "target_markets": ["US", "EU"],
        "buyer_types": ["importer", "distributor"],
        "allowed_fact_ids": [fact_id],
    })
    pack = pack_result.get("pack", pack_result)
    pack_id = pack["pack_id"]
    print(f"    pack_id: {pack_id}")
    print(f"    status: {pack['status']}")

    approve_result = knowledge_facts.approve_knowledge_pack(
        pack_id=pack_id,
        approved_by="test_approver_p1_4a",
    )
    print(f"    success: {approve_result.get('success')}")
    if approve_result.get('success'):
        approved_pack = approve_result['pack']
        print(f"    approved status: {approved_pack['status']}")
        print(f"    version: {approved_pack['version']}")
        snapshots = approved_pack.get('frozen_fact_snapshots', [])
        if isinstance(snapshots, str):
            import json
            snapshots = json.loads(snapshots)
        print(f"    frozen_fact_snapshots: {len(snapshots)}")
        print(f"    knowledge_snapshot_hash: {str(approved_pack.get('knowledge_snapshot_hash', ''))[:16]}...")

    # 5. 创建测试客户
    print("\n[5] 创建测试客户...")
    customer_input = {
        "customer_id": "p1_4a_test_customer_001",
        "company_name": "P1.4A Test Import Co",
        "website": "https://www.p14a-test-import.example.com",
        "country": "US",
        "region": "North America",
        "buyer_type": "importer",
        "product_categories": ["wooden_crafts"],
        "main_products": ["wooden kitchen utensils"],
        "existing_brands": ["TestBrand"],
        "procurement_scenario": "bulk_import",
        "known_pain_points": ["looking for sustainable wood products"],
        "contact_info": {"email": "test@p14a-example.com"},
        "source_document": "test_input",
        "source_url": "",
        "source_captured_at": "2026-10-01T00:00:00Z",
    }

    # 6. ICP 评估
    print("\n[6] ICP 评估...")
    eval_result = prospect_evaluator.evaluate_customer_icp(
        customer_input=customer_input,
        pack_ref={"pack_id": pack_id, "version": 1},
    )
    print(f"    identity_status: {eval_result['identity_status']}")
    print(f"    icp_score: {eval_result['icp_score']}")
    print(f"    hard_blockers: {eval_result['hard_blockers']}")
    print(f"    product_fit: {eval_result['product_fit']}")
    print(f"    market_fit: {eval_result['market_fit']}")

    if eval_result["hard_blockers"]:
        print("    ❌ 存在 hard_blockers，无法生成对外草稿")
        return False

    # 7. 绑定 Knowledge Pack
    print("\n[7] 绑定 Knowledge Pack...")
    bind_result = prospect_evaluator.bind_knowledge_pack_to_customer(
        customer_id=customer_input["customer_id"],
        pack_id=pack_id,
        bound_by="test_user_p1_4a",
    )
    print(f"    knowledge_pack_id: {bind_result.get('knowledge_pack_id', bind_result)}")

    # 8. 保存评估结果
    print("\n[8] 保存评估结果...")
    eval_result["customer_id"] = customer_input["customer_id"]
    eval_result["evaluated_by"] = "test_user_p1_4a"
    save_result = prospect_evaluator.save_customer_evaluation(eval_result)
    print(f"    evaluation_id: {save_result.get('evaluation_id', save_result)}")

    # 9. 使用 qwen3.5:9b 生成草稿
    print("\n[9] 使用 qwen3.5:9b 生成 first_email 草稿...")
    print("    模式: standard (thinking=False)")
    print("    num_ctx: 8192")
    print("    keep_alive: 0")

    # 直接使用 AIClient 调用 qwen3.5:9b
    ai = AIClient()
    system_prompt = """You are a professional B2B outreach email writer for KaiLionCrafts, a wooden crafts manufacturer.
Write a concise first-contact email in English. Use only confirmed facts.
Do not invent customer cases, order amounts, MOQ, capacity, certifications, or factory ownership.
Use phrases like 'strategic manufacturing partners' or 'local manufacturing network' instead of claiming owned factories.
Format: Subject: <subject>\n\n<body>"""

    user_prompt = """Customer: P1.4A Test Import Co (US importer)
Their interest: wooden kitchen utensils, sustainable wood products
Our confirmed fact: KaiLionCrafts specializes in handcrafted wooden crafts including cutting boards, utensils, and home decor items, made from sustainable bamboo and beech wood.
Write a first outreach email."""

    print("    正在调用 Ollama qwen3.5:9b...")
    response = ai.chat(
        user_prompt,
        system_prompt=system_prompt,
        temperature=0.7,
        manual_model="qwen3.5:9b",
        mode="standard",
    )

    print(f"    response type: {type(response)}")
    if isinstance(response, dict):
        print(f"    model: {response.get('model', 'N/A')}")
        print(f"    failover: {response.get('failover', False)}")
        print(f"    attempts: {response.get('attempts', 1)}")
        content = response.get("content", "")
    else:
        content = str(response)

    print(f"    content length: {len(content)}")
    print(f"    content preview: {content[:200]}...")

    # 10. 检查 response 是否包含 thinking 内容
    print("\n[10] 检查 response/thinking 处理...")
    if not content or len(content.strip()) < 2:
        print("    ❌ response 为空，未使用 thinking 替代")
        print("    这是正确的 fail-closed 行为")
        draft_success = False
    else:
        print("    ✅ response 有正文内容")
        # 检查是否包含 thinking 标记
        if "[推理模型响应]" in content or "thinking" in content.lower()[:100]:
            print("    ⚠️ 可能包含 thinking 内容")
        else:
            print("    ✅ 未检测到 thinking 内容混入")
        draft_success = True

    # 11. 检查禁止编造内容
    print("\n[11] 检查禁止编造内容...")
    content_lower = content.lower()
    prohibited = ["our factory", "we own", "owned factory", "moq:", "minimum order",
                  "capacity:", "certified", "iso 9001", "customer case", "order amount"]
    found_prohibited = [p for p in prohibited if p in content_lower]
    if found_prohibited:
        print(f"    ⚠️ 检测到可能编造的内容: {found_prohibited}")
    else:
        print("    ✅ 未检测到禁止编造的内容")

    # 12. 检查安全表述
    print("\n[12] 检查安全表述...")
    safe_phrases = ["strategic manufacturing", "manufacturing partner", "supply chain"]
    found_safe = [p for p in safe_phrases if p in content_lower]
    if found_safe:
        print(f"    ✅ 使用了安全表述: {found_safe}")
    else:
        print("    ℹ️ 未使用特定安全表述（不强制）")

    # 13. 使用 content_draft_generator 保存草稿
    if draft_success:
        print("\n[13] 通过 content_draft_generator 保存草稿...")
        # 由于 content_draft_generator 内部会调用 AI，这里直接构造草稿记录
        # 实际使用时应调用 generate_content_draft(use_mock=False)
        draft_result = content_draft_generator.generate_content_draft(
            customer_id=customer_input["customer_id"],
            draft_type="first_email",
            customer_input=customer_input,
            pack_ref={"pack_id": pack_id, "version": 1},
            language="en",
            mode="standard",
            created_by="test_user_p1_4a",
            use_mock=True,  # 使用 mock 避免重复调用 Ollama
        )
        if draft_result.get("success"):
            print(f"    ✅ 草稿保存成功")
            print(f"    draft_id: {draft_result.get('draft_id')}")
            print(f"    status: {draft_result.get('status')}")
            print(f"    internal_only: {draft_result.get('internal_only')}")
            print(f"    knowledge_pack_id: {draft_result.get('knowledge_pack_id')}")
            print(f"    knowledge_pack_version: {draft_result.get('knowledge_pack_version')}")
            print(f"    fact_ids: {draft_result.get('fact_ids')}")
        else:
            print(f"    ⚠️ 草稿保存: {draft_result.get('errors')}")

    # 14. 检查模型释放
    print("\n[14] 检查模型释放...")
    import subprocess
    try:
        result = subprocess.run(["ollama", "ps"], capture_output=True, text=True, timeout=10)
        print(f"    ollama ps 输出:\n{result.stdout}")
        if "qwen3.5" in result.stdout:
            print("    ⚠️ qwen3.5:9b 可能仍在运行")
        else:
            print("    ✅ 未检测到 qwen3.5:9b 残留（已释放）")
    except Exception as e:
        print(f"    无法检查 ollama ps: {e}")

    # 15. 清理测试数据
    print("\n[15] 清理测试数据...")
    if TEST_DB.exists():
        TEST_DB.unlink()
        print(f"    ✅ 已删除测试数据库: {TEST_DB}")

    print("\n" + "=" * 60)
    print("P1.4A 验证完成")
    print("=" * 60)
    return draft_success

if __name__ == "__main__":
    success = run_test()
    sys.exit(0 if success else 1)
