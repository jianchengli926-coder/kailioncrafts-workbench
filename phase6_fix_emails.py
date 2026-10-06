#!/usr/bin/env python3
"""
Phase 6 Fix: Extract email addresses from backgroundCheck.contactInfo
and update the injected customer data in the browser.
"""
import json
import re
import os
from datetime import datetime, timezone

BASE = "/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/外贸获客AI工作台"

# Known email addresses from sub-agent summaries (fallback)
KNOWN_EMAILS = {
    # Outdoor knives
    "ok_001": "webcontact@crkt.com",
    "ok_002": "info@outdooredge.com",
    "ok_003": "info@boker.com",
    "ok_004": "orders@survivalsupplies.com.au",
    "ok_005": "info@tsg.ca",
    # Kitchen knives
    "kk_001": "orders@messermeister.com",
    "kk_002": "support@matsato.com",
    "kk_003": "info@katogroup.eu",
    "kk_004": "sales@kitchencraft.co.uk",
    "kk_005": "info@kanetsune.com",
    # Scissors
    "ps_001": "support@hausandgarten.com",
    "ps_002": "customerservice@acmeunited.com",
    "ps_003": "germanyshop@gewesotopcut-solingen.com",
    "ps_004": "mail@hairtechnic.co.uk",
    "ps_005": "direct@locau.com",
    # Kitchen accessories
    "ka_001": "order@norpro.com",
    "ka_002": "smulligan@haroldimport.com",
    "ka_003": "info@harms-import.de",
    "ka_004": "info@heatgrill.com.au",
    "ka_005": "sales@dexam.co.uk",
}

FILES = [
    ("第六阶段_户外刀客户.json", "outdoor_knives", "户外刀", "ok"),
    ("第六阶段_厨房刀客户.json", "kitchen_knives", "厨房刀", "kk"),
    ("第六阶段_剪刀客户.json", "professional_scissors", "专业剪刀", "ps"),
    ("第六阶段_厨房用品客户.json", "kitchen_accessories", "厨房用品", "ka"),
]

def extract_email_from_contact_info(contact_info):
    """Extract email address from contactInfo text."""
    if not contact_info:
        return None
    # Find first email-like pattern
    match = re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', contact_info)
    if match:
        return match.group(0)
    return None

def main():
    # Build email mapping: p6_id -> email_address
    email_map = {}
    
    for filename, cat_id, cat_name, prefix in FILES:
        filepath = os.path.join(BASE, filename)
        if not os.path.exists(filepath):
            continue
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        for idx, raw in enumerate(data.get("customers", []), 1):
            raw_id = raw.get("id", f"{prefix}_{idx:03d}")
            p6_id = f"p6_{cat_id.replace('_','')}_{idx:03d}"
            
            # Try to extract from contactInfo
            contact_info = raw.get("backgroundCheck", {}).get("contactInfo", "")
            email = extract_email_from_contact_info(contact_info)
            
            # Fallback to known emails
            if not email:
                email = KNOWN_EMAILS.get(raw_id, "")
            
            email_map[p6_id] = email
            print(f"  {p6_id}: {raw.get('company','')[:40]} -> {email}")
    
    print(f"\nTotal email mappings: {len(email_map)}")
    
    # Generate JavaScript fix script
    js = f"""
(function() {{
  const PREFIX = 'kailion_ark_';
  const emailMap = {json.dumps(email_map, ensure_ascii=False)};
  
  const customers = JSON.parse(localStorage.getItem(PREFIX + 'customers') || '[]');
  let updated = 0;
  
  customers.forEach(c => {{
    if (emailMap[c.id]) {{
      if (!c.contact) c.contact = {{}};
      c.contact.email = emailMap[c.id];
      updated++;
    }}
  }});
  
  localStorage.setItem(PREFIX + 'customers', JSON.stringify(customers));
  console.log('Fixed emails for ' + updated + ' customers');
  return JSON.stringify({{updated: updated, total: customers.length}});
}})();
"""
    
    js_path = os.path.join(BASE, "phase6_fix_emails.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"\nFix script saved to: {js_path}")
    
    # Also update the consolidated JSON
    cons_path = os.path.join(BASE, "第六阶段_全部客户汇总.json")
    with open(cons_path, "r", encoding="utf-8") as f:
        cons = json.load(f)
    for c in cons.get("customers", []):
        if c["id"] in email_map:
            if "contact" not in c:
                c["contact"] = {}
            c["contact"]["email"] = email_map[c["id"]]
    with open(cons_path, "w", encoding="utf-8") as f:
        json.dump(cons, f, ensure_ascii=False, indent=2)
    
    # Update phase6_data.json too
    data_path = os.path.join(BASE, "phase6_data.json")
    with open(data_path, "w", encoding="utf-8") as f:
        json.dump(cons, f, ensure_ascii=False, indent=2)
    
    print("Consolidated JSON updated with email addresses")
    return email_map

if __name__ == "__main__":
    main()
