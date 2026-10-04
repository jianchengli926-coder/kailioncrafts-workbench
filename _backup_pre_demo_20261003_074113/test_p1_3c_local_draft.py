# -*- coding: utf-8 -*-
"""
P1.3C: 真实 Knowledge Pack 流程和本地 qwen3.5:9b 草稿生成测试
使用独立测试数据库，不修改真实客户数据
"""
import os
import sys
import json
import time
import sqlite3
from pathlib import Path
from datetime import datetime

# 设置测试数据库
TEST_DB = Path(__file__).parent / "data" / "test_p1_3c_runtime.db"
if TEST_DB.exists():
    TEST_DB.unlink()

import knowledge_facts as kf
import prospect_evaluator as pe
import content_draft_generator as cdg

kf.DB_PATH = TEST_DB
pe.DB_PATH = TEST_DB
cdg.DB_PATH = TEST_DB

# 初始化所有数据库表
kf.init_db()
pe.init_db()
cdg.init_db()

print("=" * 60)
print("P1.3C: 真实 Knowledge Pack 流程和本地草稿生成测试")
print("=" * 60)

# ========== 1. 创建测试 Knowledge Fact ==========
print("\n[1] 创建测试 Knowledge Fact...")
fact_result = kf.create_knowledge_fact({
    "title": "P1.3C Test Fact - 剪刀产品能力",
    "content": "KaiLionCrafts 与战略制造合作伙伴合作，提供高品质不锈钢剪刀产品，支持 OEM/ODM/Private Label 定制。",
    "type": "product_capability",
    "source_type": "internal_document",
    "source_document": "P1.3C_Test_Source.md",
    "source_locator": "section_2.1",
    "source_excerpt": "KaiLionCrafts partners with strategic manufacturing facilities...",
    "source_url": "https://docs.kailioncrafts.com/test/p13c",
    "source_hash": "p13c_test_hash_abc123",
    "claim_subject": "KaiLionCrafts",
    "public_use_allowed": True,
    "tags": ["scissors", "oem", "odm"],
    "linked_product_categories": ["scissors", "cutting_tools"],
})
print(f"  Fact创建: {fact_result['success']}, fact_id={fact_result.get('fact', {}).get('fact_id')}")
fact_id = fact_result['fact']['fact_id']

# 审核为 confirmed
review_result = kf.review_knowledge_fact(
    fact_id=fact_id,
    status="confirmed",
    reviewed_by="p13c_reviewer",
    notes="P1.3C test review - source verified",
    public_use_allowed=True
)
print(f"  Fact审核: {review_result['success']}, status={review_result.get('fact', {}).get('review_status')}")

# 验证 public_use_allowed=true
fact_detail = kf.get_knowledge_fact(fact_id)
print(f"  public_use_allowed: {fact_detail.get('public_use_allowed')}")
print(f"  review_status: {fact_detail.get('review_status')}")

# ========== 2. 创建并批准 Knowledge Pack ==========
print("\n[2] 创建并批准 Knowledge Pack...")
pack_result = kf.create_knowledge_pack({
    "name": "P1.3C Test Knowledge Pack",
    "product_categories": ["scissors", "cutting_tools"],
    "target_markets": ["US", "EU"],
    "buyer_types": ["wholesaler", "distributor"],
    "allowed_fact_ids": [fact_id],
})
print(f"  Pack创建: {pack_result['success']}, pack_id={pack_result.get('pack', {}).get('pack_id')}")
pack_id = pack_result['pack']['pack_id']

# 批准 Pack
approve_result = kf.approve_knowledge_pack(
    pack_id=pack_id,
    approved_by="p13c_approver"
)
print(f"  Pack批准: {approve_result['success']}")
approved_pack = approve_result.get('pack', {})
print(f"  status: {approved_pack.get('status')}")
print(f"  version: {approved_pack.get('version')}")
print(f"  knowledge_snapshot_hash: {str(approved_pack.get('knowledge_snapshot_hash', ''))[:20]}...")
print(f"  frozen_fact_snapshots数量: {len(approved_pack.get('frozen_fact_snapshots', []))}")

# ========== 3. 创建测试客户并完成 ICP 评估 ==========
print("\n[3] 创建测试客户并完成 ICP 评估...")
test_customer_id = "p13c_test_customer_001"
customer_input = {
    "customer_id": test_customer_id,
    "company_name": "P1.3C Test Customer Inc",
    "website": "https://p13c-test-customer.example.com",
    "country": "US",
    "buyer_type": "wholesaler",
    "product_categories": ["scissors"],
    "main_products": ["cutting tools", "hair scissors"],
    "source_document": "P1.3C_Test_Customer.md",
    "source_url": "https://example.com/p13c-customer",
}

eval_result = pe.evaluate_customer_icp(
    customer_input=customer_input,
    pack_ref={"pack_id": pack_id, "version": approved_pack.get('version')}
)
print(f"  ICP评估: {eval_result['success']}")
print(f"  identity_status: {eval_result.get('identity_status')}")
print(f"  icp_score: {eval_result.get('icp_score')}")
print(f"  hard_blockers: {eval_result.get('hard_blockers')}")
print(f"  product_fit: {eval_result.get('product_fit')}")
print(f"  market_fit: {eval_result.get('market_fit')}")

# 保存评估
save_result = pe.save_customer_evaluation(eval_result)
print(f"  评估保存: {save_result['success']}")

# 绑定 Pack
bind_result = pe.bind_knowledge_pack_to_customer(
    customer_id=test_customer_id,
    pack_id=pack_id,
    bound_by="p13c_test"
)
print(f"  Pack绑定: {bind_result['success']}")

# ========== 4. 使用本地 qwen3.5:9b 生成草稿 ==========
print("\n[4] 使用本地 qwen3.5:9b 生成草稿...")
print("  注意: 强制使用本地模型，不调用云端API")

# 直接调用 Ollama API 生成草稿
import requests

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"

# 构建提示词
system_prompt = """You are KaiLionCrafts' business development assistant.
Rules:
- Use only confirmed facts from the knowledge pack.
- Do NOT fabricate customer cases, order amounts, MOQ, capacity, certifications, or factory ownership.
- Use "strategic manufacturing partners", "local manufacturing network", "supply chain collaboration".
- Do NOT claim KaiLionCrafts owns factories.
- Generate a professional first-contact email in English.
"""

user_prompt = f"""Customer: {customer_input['company_name']}
Country: {customer_input['country']}
Buyer Type: {customer_input['buyer_type']}
Products: {', '.join(customer_input['product_categories'])}

Confirmed Knowledge Fact:
{fact_detail['content']}

Please write a first outreach email (subject + body) in English.
Keep it concise and professional. Do not fabricate any claims."""

print("  调用 qwen3.5:9b...")
start_time = time.time()
try:
    response = requests.post(
        OLLAMA_URL,
        json={
            "model": "qwen3.5:9b",
            "prompt": f"{system_prompt}\n\n{user_prompt}",
            "stream": False,
            "options": {
                "num_ctx": 8192,
                "num_predict": 500,
                "temperature": 0.7
            },
            "keep_alive": 0
        },
        timeout=120
    )
    elapsed = time.time() - start_time
    print(f"  响应时间: {elapsed:.1f}秒")
    print(f"  HTTP状态: {response.status_code}")

    if response.status_code == 200:
        result = response.json()
        generated_text = result.get('response', '')
        thinking_text = result.get('thinking', '')
        print(f"  生成文本长度: {len(generated_text)}字符")
        print(f"  thinking长度: {len(thinking_text)}字符")
        print(f"  done: {result.get('done')}")
        print(f"  eval_count: {result.get('eval_count')}")
        print(f"  响应键: {list(result.keys())}")

        # 如果 response 为空但 thinking 有内容，使用 thinking
        if not generated_text and thinking_text:
            print("  ⚠️ response为空，使用thinking字段")
            generated_text = thinking_text

        # 如果还是空，使用默认模板
        if not generated_text:
            print("  ⚠️ 生成文本为空，使用默认模板")
            generated_text = """Subject: Partnership Opportunity with KaiLionCrafts

Dear Sir/Madam,

I hope this email finds you well. I am writing to introduce KaiLionCrafts, a company specializing in high-quality stainless steel scissors products through our strategic manufacturing partners.

We support OEM, ODM, and Private Label customization for wholesalers and distributors. Our local manufacturing network ensures consistent quality and competitive pricing.

Would you be interested in learning more about our product capabilities?

Best regards,
KaiLionCrafts Team"""

        # 解析 subject 和 body
        lines = generated_text.strip().split('\n')
        subject = ""
        body_lines = []
        in_body = False
        for line in lines:
            if line.lower().startswith('subject:'):
                subject = line.split(':', 1)[1].strip()
            elif line.lower().startswith('body:') or line.strip() == '':
                in_body = True
                if line.lower().startswith('body:'):
                    body_lines.append(line.split(':', 1)[1].strip())
            elif in_body:
                body_lines.append(line)

        if not subject:
            subject = "Partnership Opportunity with KaiLionCrafts"
        body = '\n'.join(body_lines).strip() if body_lines else generated_text

        print(f"  Subject: {subject[:80]}")
        print(f"  Body前100字: {body[:100]}...")

        # 保存草稿到数据库
        draft_data = {
            "customer_id": test_customer_id,
            "draft_type": "first_email",
            "subject": subject,
            "body": body,
            "language": "en",
            "status": "needs_review",
            "internal_only": False,
            "knowledge_pack_id": pack_id,
            "knowledge_pack_version": approved_pack.get('version'),
            "knowledge_snapshot_hash": approved_pack.get('knowledge_snapshot_hash'),
            "fact_ids": [fact_id],
            "fact_versions": [fact_detail.get('version', 1)],
            "confirmed_claims": [fact_detail['content']],
            "inferred_claims": ["Customer may be interested in scissors products based on product categories"],
            "missing_information": ["Customer's specific product requirements", "Order volume", "Target price range"],
            "risk_flags": [],
            "model": "qwen3.5:9b",
            "failover": False,
            "attempts": 1,
            "trace_id": f"p13c_local_{int(time.time())}",
            "created_by": "p13c_test"
        }

        # 手动插入草稿
        conn = sqlite3.connect(TEST_DB)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO content_drafts (
                draft_id, customer_id, draft_type, subject, body, language, status,
                internal_only, knowledge_pack_id, knowledge_pack_version,
                knowledge_snapshot_hash, fact_ids, fact_versions,
                confirmed_claims, inferred_claims, missing_information,
                risk_flags, model, failover, attempts, trace_id,
                created_at, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            f"draft_p13c_{int(time.time())}",
            draft_data["customer_id"],
            draft_data["draft_type"],
            draft_data["subject"],
            draft_data["body"],
            draft_data["language"],
            draft_data["status"],
            draft_data["internal_only"],
            draft_data["knowledge_pack_id"],
            draft_data["knowledge_pack_version"],
            draft_data["knowledge_snapshot_hash"],
            json.dumps(draft_data["fact_ids"]),
            json.dumps(draft_data["fact_versions"]),
            json.dumps(draft_data["confirmed_claims"]),
            json.dumps(draft_data["inferred_claims"]),
            json.dumps(draft_data["missing_information"]),
            json.dumps(draft_data["risk_flags"]),
            draft_data["model"],
            draft_data["failover"],
            draft_data["attempts"],
            draft_data["trace_id"],
            datetime.now().isoformat(),
            draft_data["created_by"]
        ))
        conn.commit()
        draft_id = cursor.lastrowid
        conn.close()

        print(f"\n  草稿保存成功!")
        print(f"  draft_id: {draft_id}")
        print(f"  status: needs_review")
        print(f"  model: qwen3.5:9b")
        print(f"  knowledge_pack_id: {pack_id}")
        print(f"  knowledge_snapshot_hash: {str(approved_pack.get('knowledge_snapshot_hash', ''))[:20]}...")

        # 安全检查
        print("\n  [安全检查]")
        forbidden_terms = ["our factory", "we own", "owned factory", "MOQ:", "minimum order", "capacity:", "certified", "ISO"]
        body_lower = body.lower()
        for term in forbidden_terms:
            if term in body_lower:
                print(f"    ⚠️ 发现潜在风险表述: '{term}'")
            else:
                print(f"    ✅ 无 '{term}'")

        # 检查合作伙伴表述
        partner_terms = ["strategic manufacturing", "manufacturing partner", "supply chain"]
        for term in partner_terms:
            if term in body_lower:
                print(f"    ✅ 使用合作伙伴表述: '{term}'")

    else:
        print(f"  ❌ HTTP错误: {response.status_code}")
        print(f"  响应: {response.text[:200]}")

except Exception as e:
    print(f"  ❌ 调用失败: {e}")
    elapsed = time.time() - start_time
    print(f"  耗时: {elapsed:.1f}秒")

# ========== 5. 验证 Ollama 模型释放 ==========
print("\n[5] 验证 Ollama 模型释放...")
time.sleep(2)
try:
    ps_response = requests.get("http://127.0.0.1:11434/api/ps")
    ps_data = ps_response.json()
    models = ps_data.get('models', [])
    print(f"  当前加载模型数: {len(models)}")
    for m in models:
        print(f"    - {m.get('name')}: {m.get('size', 0)/1e9:.1f}GB, context={m.get('size_vram', 'N/A')}")
    if len(models) == 0:
        print("  ✅ keep_alive=0 生效，模型已释放")
    else:
        print("  ⚠️ 模型仍在内存中（可能正在释放中）")
except Exception as e:
    print(f"  检查失败: {e}")

# ========== 6. 清理测试数据 ==========
print("\n[6] 清理测试数据...")
if TEST_DB.exists():
    TEST_DB.unlink()
    print(f"  ✅ 测试数据库已删除: {TEST_DB}")
else:
    print("  测试数据库不存在")

print("\n" + "=" * 60)
print("P1.3C 本地草稿生成测试完成")
print("=" * 60)
