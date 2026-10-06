#!/usr/bin/env python3
"""
Phase 6 Customer Import Script
Converts 4 category JSON files into workbench-compatible customer + draft data,
then generates a JavaScript injection script for the browser.
"""
import json
import os
import re
from datetime import datetime, timezone

BASE = "/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/外贸获客AI工作台"
FILES = [
    ("第六阶段_户外刀客户.json", "outdoor_knives", "户外刀"),
    ("第六阶段_厨房刀客户.json", "kitchen_knives", "厨房刀"),
    ("第六阶段_剪刀客户.json", "professional_scissors", "专业剪刀"),
    ("第六阶段_厨房用品客户.json", "kitchen_accessories", "厨房用品"),
]

CATEGORY_LINKS = {
    "outdoor_knives": "https://kailioncrafts.com/outdoor-knives/",
    "kitchen_knives": "https://kailioncrafts.com/kitchen-knives/",
    "professional_scissors": "https://kailioncrafts.com/professional-scissors/",
    "kitchen_accessories": "https://kailioncrafts.com/kitchen-accessories/",
}

def gen_id(prefix, idx):
    return f"p6_{prefix}_{idx:03d}"

def extract_domain(url):
    if not url:
        return ""
    url = url.replace("https://", "").replace("http://", "").replace("www.", "")
    return url.split("/")[0].lower()

def grade_from_score(score):
    if score >= 85:
        return "A"
    elif score >= 70:
        return "B"
    elif score >= 55:
        return "C"
    return "D"

def country_grade(country):
    c = country.lower()
    if "usa" in c or "united states" in c or "美国" in c:
        return "S"
    if any(x in c for x in ["germany", "uk", "britain", "australia", "canada", "japan", "france", "德国", "英国", "澳大利亚", "加拿大", "日本", "法国"]):
        return "A"
    return "B"

def convert_customer(raw, category_id, category_name, idx):
    """Convert raw customer JSON to workbench customer format."""
    cid = gen_id(category_id.replace("_", ""), idx)
    domain = extract_domain(raw.get("website", ""))
    score = raw.get("portrait", {}).get("priorityScore", 60)
    grade = grade_from_score(score)
    contact = raw.get("contact", {})
    bg = raw.get("backgroundCheck", {})
    portrait = raw.get("portrait", {})

    # Build notes with background check summary
    notes_parts = []
    notes_parts.append(f"【第六阶段批量开发】品类：{category_name}")
    notes_parts.append(f"意向等级：{portrait.get('intentLevel', '中')}")
    notes_parts.append(f"推荐策略：{portrait.get('recommendedStrategy', '')}")
    if bg.get("companyOverview"):
        notes_parts.append(f"公司概况：{bg['companyOverview'][:200]}")
    if bg.get("painPoints"):
        notes_parts.append(f"痛点分析：{bg['painPoints'][:200]}")
    if bg.get("entryAngle"):
        notes_parts.append(f"切入点：{bg['entryAngle'][:200]}")
    if raw.get("emailType") == "通用邮箱":
        notes_parts.append("⚠️ 通用邮箱，建议LinkedIn找采购负责人")
    notes = "\n".join(notes_parts)

    customer = {
        "id": cid,
        "company": raw.get("company", ""),
        "website": raw.get("website", ""),
        "source": f"第六阶段批量开发-{category_name}",
        "type": "潜在客户",
        "status": "待开发",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "contact": {
            "name": contact.get("name", ""),
            "title": contact.get("title", ""),
            "email": raw.get("email", ""),
            "phone": "",
            "whatsapp": "",
            "linkedin": contact.get("linkedin", ""),
        },
        "scores": {
            "industry": min(score + 5, 100),
            "product": min(score + 3, 100),
            "companyType": score,
            "purchaseSignal": max(score - 5, 30),
            "contactQuality": 70 if raw.get("emailType") == "通用邮箱" else 85,
            "total": score,
            "grade": grade,
        },
        "tags": [f"第六阶段", category_name, portrait.get("intentLevel", "中") + "意向"],
        "notes": notes,
        "nextFollowUp": None,
        "communications": [],
        "riskLevel": "low",
        "riskChecklist": {
            "acq": [1, 1, 1],
            "bg": [1, 1, 0],
            "contract": [1, 1, 1],
            "pay": [0, 0, 0],
            "ship": [0, 0],
            "after": [0, 0],
        },
        "identityKey": f"domain:{domain}" if domain else f"company:{raw.get('company','').lower()}",
        "identityAliases": [
            f"domain:{domain}" if domain else "",
            f"company:{raw.get('company','').lower()}",
        ],
        "stableId": f"cust_p6_{category_id.replace('_','')}_{idx:03d}",
        "intentCategories": [category_name],
        "lastInteraction": datetime.now(timezone.utc).isoformat(),
        "timeline": [{
            "t": datetime.now(timezone.utc).isoformat(),
            "type": "system",
            "title": "客户创建",
            "desc": f"第六阶段批量开发导入 — {category_name}品类",
        }],
        "quoteHistory": [],
        "sampleHistory": [],
        "orderHistory": [],
        "blacklisted": False,
        "unsubscribe": False,
        "leadSource": f"第六阶段批量开发-{category_name}",
        "leadScore": score,
        "companySize": "",
        "decisionMaker": contact.get("name", ""),
        "annualPurchase": "",
        "country": raw.get("country", ""),
        "customerType": raw.get("customerType", portrait.get("customerType", "")),
        "productCategory": category_name,
        "products": category_name,
        "profile": {
            "business": bg.get("companyOverview", "")[:150],
            "productLine": category_name,
            "needs": bg.get("purchaseIntent", "")[:150],
            "painPoints": bg.get("painPoints", "")[:150],
            "angle": bg.get("entryAngle", "")[:100],
        },
        "matchReasons": [
            f"官网产品匹配{category_name}品类",
            f"国家等级{country_grade(raw.get('country',''))}",
            f"客户类型：{raw.get('customerType','')}",
        ],
        "backgroundCheck": bg,
        "portrait": portrait,
        "phase6Email": raw.get("email", {}),
    }
    # Remove empty identityAliases
    customer["identityAliases"] = [a for a in customer["identityAliases"] if a]
    return customer

def convert_draft(customer, raw, category_id, category_name, idx):
    """Convert email data to workbench draft format."""
    email_data = raw.get("email", {})
    subject = email_data.get("subjectLines", [""])[0] if email_data.get("subjectLines") else ""
    body = email_data.get("english", "")

    # Build full body with subject line options note
    full_body = body
    if email_data.get("subjectLines") and len(email_data["subjectLines"]) > 1:
        alt_subjects = " | ".join(email_data["subjectLines"][1:])
        full_body = body  # Keep clean, subjects stored separately

    draft = {
        "id": f"draft_p6_{category_id.replace('_','')}_{idx:03d}",
        "customerId": customer["id"],
        "customerName": customer["company"],
        "country": raw.get("country", ""),
        "language": "英语",
        "subject": subject,
        "body": full_body,
        "content": full_body,
        "status": "待检查",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sentAt": None,
        "aiNotes": [
            f"第六阶段批量开发 — {category_name}",
            f"切入点：{raw.get('portrait',{}).get('recommendedStrategy','')}",
            f"卖点：{', '.join(email_data.get('sellingPointsUsed', []))}",
            f"英文词数：{email_data.get('wordCount', 'N/A')}",
            "中文审核版见客户notes",
        ],
        "phase6": True,
        "category": category_name,
        "subjectOptions": email_data.get("subjectLines", []),
        "chineseVersion": email_data.get("chinese", ""),
        "sellingPointsUsed": email_data.get("sellingPointsUsed", []),
        "linksUsed": email_data.get("linksUsed", []),
        "wordCount": email_data.get("wordCount", 0),
    }
    return draft

def main():
    all_customers = []
    all_drafts = []

    for filename, cat_id, cat_name in FILES:
        filepath = os.path.join(BASE, filename)
        if not os.path.exists(filepath):
            print(f"WARNING: {filepath} not found, skipping")
            continue
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        for idx, raw in enumerate(data.get("customers", []), 1):
            customer = convert_customer(raw, cat_id, cat_name, idx)
            draft = convert_draft(customer, raw, cat_id, cat_name, idx)
            all_customers.append(customer)
            all_drafts.append(draft)
            print(f"  {customer['id']}: {customer['company']} ({customer['country']}) — score={customer['leadScore']}")

    print(f"\nTotal: {len(all_customers)} customers, {len(all_drafts)} drafts")

    # Generate JavaScript injection script
    js_content = f"""// Phase 6 Customer Import — Auto-generated {datetime.now().strftime('%Y-%m-%d %H:%M')}
// Run this in browser console on http://localhost:8080/
(function() {{
  const PREFIX = 'kailion_ark_';
  const newCustomers = {json.dumps(all_customers, ensure_ascii=False)};
  const newDrafts = {json.dumps(all_drafts, ensure_ascii=False)};

  // Load existing customers
  let existingCustomers = [];
  try {{
    const raw = localStorage.getItem(PREFIX + 'customers');
    if (raw) existingCustomers = JSON.parse(raw);
  }} catch(e) {{ console.warn('Failed to load customers:', e); }}

  // Load existing drafts
  let existingDrafts = [];
  try {{
    const raw = localStorage.getItem(PREFIX + 'drafts');
    if (raw) existingDrafts = JSON.parse(raw);
  }} catch(e) {{ console.warn('Failed to load drafts:', e); }}

  // Check for duplicates by company name
  const existingCompanies = new Set(existingCustomers.map(c => c.company ? c.company.toLowerCase() : ''));
  const addedCustomers = [];
  const skippedCustomers = [];

  newCustomers.forEach(c => {{
    if (existingCompanies.has(c.company.toLowerCase())) {{
      skippedCustomers.push(c.company);
    }} else {{
      existingCustomers.push(c);
      addedCustomers.push(c.company);
    }}
  }});

  // Add drafts only for customers that were added
  const addedIds = new Set(newCustomers.filter(c => addedCustomers.includes(c.company)).map(c => c.id));
  newDrafts.forEach(d => {{
    if (addedIds.has(d.customerId)) {{
      existingDrafts.push(d);
    }}
  }});

  // Save
  localStorage.setItem(PREFIX + 'customers', JSON.stringify(existingCustomers));
  localStorage.setItem(PREFIX + 'drafts', JSON.stringify(existingDrafts));

  console.log('=== Phase 6 Import Complete ===');
  console.log('Added customers:', addedCustomers.length, addedCustomers);
  console.log('Skipped (duplicates):', skippedCustomers.length, skippedCustomers);
  console.log('Added drafts:', existingDrafts.length - (existingDrafts.length - newDrafts.length));
  console.log('Total customers now:', existingCustomers.length);
  console.log('Total drafts now:', existingDrafts.length);

  // Return summary
  return {{
    added: addedCustomers.length,
    skipped: skippedCustomers.length,
    totalCustomers: existingCustomers.length,
    totalDrafts: existingDrafts.length,
  }};
}})();
"""

    js_path = os.path.join(BASE, "phase6_inject.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write(js_content)
    print(f"\nJavaScript injection script saved to: {js_path}")

    # Also save consolidated JSON for reference
    consolidated = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "totalCustomers": len(all_customers),
        "totalDrafts": len(all_drafts),
        "customers": all_customers,
        "drafts": all_drafts,
    }
    cons_path = os.path.join(BASE, "第六阶段_全部客户汇总.json")
    with open(cons_path, "w", encoding="utf-8") as f:
        json.dump(consolidated, f, ensure_ascii=False, indent=2)
    print(f"Consolidated JSON saved to: {cons_path}")

    return all_customers, all_drafts

if __name__ == "__main__":
    main()
