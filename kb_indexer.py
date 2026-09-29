#!/usr/bin/env python3
"""
KaiLionCrafts 完整版知识库索引器 V77.0
- PyYAML frontmatter 解析
- 全量重建（默认），确保正确性
- 临时文件原子替换
- FAQ/邮件模板/表格/SOP 特殊切片
- Manifest / Tree / Index / Policy / Report
- 冲突审核标记
"""

import os, sys, json, hashlib, re, time, traceback
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML not installed. Run: pip3 install pyyaml")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent.resolve()
CONFIG_PATH = SCRIPT_DIR / "kb_config.json"

DEFAULT_CONFIG = {
    "kbRoot": "", "kbVersion": "v7.0", "schemaVersion": "v2.0", "chunkerVersion": "v2.0",
    "outputPath": "kb_index.json", "manifestPath": "kb_manifest.json", "treePath": "kb_tree.json",
    "reportPath": "kb_build_report.json", "maxChunkChars": 1500, "minChunkChars": 100,
    "faqOneQOneA": True, "emailTemplateOneChunk": True, "tableKeepHeader": True, "sopByStep": True,
    "defaultSensitivity": "confidential", "defaultStatus": "pending", "conflictReviewPaths": []
}

def load_config():
    if not CONFIG_PATH.exists():
        print(f"ERROR: 配置文件不存在: {CONFIG_PATH}")
        sys.exit(1)
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        user_config = json.load(f)
    config = DEFAULT_CONFIG.copy()
    config.update(user_config)
    kb_root = config.get("kbRoot", "")
    if not kb_root:
        print("ERROR: kbRoot 为空")
        sys.exit(1)
    kb_root_path = Path(kb_root)
    if not kb_root_path.exists() or not kb_root_path.is_dir():
        print(f"ERROR: 知识库路径无效: {kb_root}")
        sys.exit(1)
    config["_kbRootPath"] = kb_root_path
    config["_kbRootResolved"] = str(kb_root_path.resolve())
    return config

def parse_frontmatter(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return None, None, f"读取失败: {e}"
    if not content.startswith('---'):
        return {}, content, None
    end_match = re.search(r'^---\s*$', content[3:], re.MULTILINE)
    if not end_match:
        return {}, content, "frontmatter未闭合"
    fm_text = content[3:3 + end_match.start()]
    body = content[3 + end_match.end():]
    try:
        metadata = yaml.safe_load(fm_text)
        if metadata is None: metadata = {}
        if not isinstance(metadata, dict): metadata = {"_raw": metadata}
    except yaml.YAMLError as e:
        metadata = {}
        for line in fm_text.split('\n'):
            line = line.strip()
            if ':' in line and not line.startswith('-') and not line.startswith('#'):
                key, _, value = line.partition(':')
                metadata[key.strip()] = value.strip().strip('"').strip("'")
        metadata["_yamlWarn"] = str(e)[:80]
    return metadata, body, None

def safe_str(v, d=""):
    if v is None: return d
    if isinstance(v, list): return ", ".join(str(x) for x in v)
    return str(v)

def safe_list(v):
    if v is None: return []
    if isinstance(v, list): return v
    if isinstance(v, str):
        if v.startswith('[') and v.endswith(']'):
            try:
                p = yaml.safe_load(v)
                if isinstance(p, list): return p
            except: pass
        return [x.strip() for x in v.split(',') if x.strip()]
    return [v]

def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for c in iter(lambda: f.read(8192), b''): h.update(c)
    return h.hexdigest()

def normalize_doc(meta, body, fpath, kb_root, cfg):
    rel = str(fpath.relative_to(kb_root))
    parts = rel.split('/')
    cat = parts[0] if len(parts) > 0 else "未分类"
    sub = parts[1] if len(parts) > 1 else "根目录"
    sens = safe_str(meta.get('sensitivity'), cfg['defaultSensitivity']).lower().strip()
    status = safe_str(meta.get('status'), cfg['defaultStatus']).lower().strip()
    title = safe_str(meta.get('title'), fpath.name.replace('.md',''))
    deprecated = bool(meta.get('deprecated')) or 'deprecated' in status or 'archived' in status
    pending = 'pending' in status or '待' in status
    demo = bool(meta.get('demo')) or 'demo' in safe_str(meta.get('type','')).lower() or '示例' in title or '模板' in title
    no_out = bool(meta.get('noOutbound')) or bool(meta.get('no_outbound'))
    conflict = any(p in rel for p in cfg.get('conflictReviewPaths', []))
    if any(k in rel for k in ['旧版','归档','历史报告','v5.7','V5.7','备份']): conflict = True
    doc_id = hashlib.md5(rel.encode()).hexdigest()[:16]
    return {
        "documentId": doc_id, "relativePath": rel, "fileName": fpath.name, "title": title,
        "category": safe_str(meta.get('category'), cat), "subcategory": safe_str(meta.get('subcategory'), sub),
        "tags": safe_list(meta.get('tags')), "region": safe_str(meta.get('region')),
        "type": safe_str(meta.get('type'), 'article'), "sensitivity": sens, "status": status,
        "version": safe_str(meta.get('version')), "confidence": safe_str(meta.get('confidence')),
        "dataSource": safe_str(meta.get('data_source')), "source": safe_str(meta.get('source')),
        "useCase": safe_str(meta.get('use_case')), "summary": safe_str(meta.get('summary')),
        "keywords": safe_list(meta.get('keywords')), "lastUpdated": safe_str(meta.get('last_updated')),
        "sourceUrl": safe_str(meta.get('source_url')), "sourceName": safe_str(meta.get('source_name')),
        "fetchDate": safe_str(meta.get('fetch_date')), "expiryHint": safe_str(meta.get('expiry_hint')),
        "contentHash": file_hash(fpath),
        "modifiedTime": datetime.fromtimestamp(fpath.stat().st_mtime, tz=timezone.utc).isoformat(),
        "authorityLevel": safe_str(meta.get('authority_level')),
        "deprecated": deprecated, "pending": pending, "demo": demo, "noOutbound": no_out,
        "conflictReview": conflict, "charCount": len(body)
    }, body

def is_faq(doc):
    t = doc.get('title','').lower(); ty = doc.get('type','').lower()
    return 'faq' in t or 'faq' in ty or '问答' in doc.get('title','') or '常见问题' in doc.get('title','')

def is_email(doc):
    ty = doc.get('type','').lower()
    return 'email' in ty or '邮件' in doc.get('title','') or '开发信' in doc.get('title','')

def chunk_doc(doc, body, cfg):
    chunks = []
    max_c = cfg.get('maxChunkChars', 1500)
    min_c = cfg.get('minChunkChars', 100)
    if not body or not body.strip(): return chunks

    def flush(hp, text, idx):
        text = text.strip()
        if len(text) < min_c and chunks:
            chunks[-1]["text"] += "\n\n" + text
            chunks[-1]["charCount"] = len(chunks[-1]["text"])
            return idx
        if not text: return idx
        cid = f"{doc['documentId']}_{idx:04d}"
        chunks.append({
            "chunkId": cid, "documentId": doc["documentId"], "relativePath": doc["relativePath"],
            "title": doc["title"], "headingPath": " > ".join(hp) if hp else doc["title"],
            "category": doc["category"], "subcategory": doc["subcategory"], "tags": doc["tags"],
            "region": doc["region"], "sensitivity": doc["sensitivity"], "status": doc["status"],
            "confidence": doc["confidence"], "authorityLevel": doc["authorityLevel"],
            "version": doc["version"], "lastUpdated": doc["lastUpdated"], "sourceUrl": doc["sourceUrl"],
            "contentHash": doc["contentHash"], "chunkIndex": idx, "text": text, "charCount": len(text),
            "noOutbound": doc["noOutbound"], "pending": doc["pending"], "deprecated": doc["deprecated"], "demo": doc["demo"]
        })
        return idx + 1

    if cfg.get('faqOneQOneA') and is_faq(doc):
        blocks = re.split(r'\n(?=(?:#{1,4}\s*(?:Q[：:]|问[：:]|问题)|Q[：:]|问[：:]))', body)
        ci = 0
        for b in blocks:
            if b.strip(): ci = flush([doc["title"]], b, ci)
        return chunks

    if cfg.get('emailTemplateOneChunk') and is_email(doc):
        blocks = re.split(r'\n---\n|\n(?=#{1,4}\s*(?:邮件|Email|开发信|模板))', body)
        ci = 0
        for b in blocks:
            if len(b.strip()) > min_c: ci = flush([doc["title"]], b, ci)
        if not chunks: flush([doc["title"]], body, 0)
        return chunks

    lines = body.split('\n')
    hp = []; cur = ""; ci = 0; in_table = False; tbl_buf = ""
    for line in lines:
        s = line.strip()
        if s.startswith('|') and '---' in s:
            in_table = True; tbl_buf = cur; cur = ""; continue
        if in_table:
            if s.startswith('|'): cur += line + "\n"; continue
            else: in_table = False; cur = tbl_buf + "\n" + cur
        hm = re.match(r'^(#{1,6})\s+(.+)$', s)
        if hm:
            if cur.strip(): ci = flush(hp, cur, ci); cur = ""
            lv = len(hm.group(1)); ht = hm.group(2).strip()
            while len(hp) >= lv: hp.pop()
            hp.append(ht); continue
        cur += line + "\n"
        if len(cur) > max_c:
            paras = cur.split('\n\n'); buf = ""
            for p in paras:
                if len(buf) + len(p) > max_c and buf.strip():
                    ci = flush(hp, buf, ci); buf = p
                else: buf += "\n\n" + p if buf else p
            cur = buf
    if cur.strip(): flush(hp, cur, ci)
    return chunks

def build_tree(docs):
    tree = {}
    for d in docs:
        c = d.get('category','未分类'); s = d.get('subcategory','根目录')
        if c not in tree:
            tree[c] = {"name":c, "subcategories":{}, "documentCount":0,
                        "sensitivity":{"public":0,"internal":0,"confidential":0},
                        "status":{"active":0,"pending":0,"deprecated":0}}
        if s not in tree[c]["subcategories"]:
            tree[c]["subcategories"][s] = {"name":s, "documents":[], "documentCount":0,
                                             "sensitivity":{"public":0,"internal":0,"confidential":0}}
        tree[c]["documentCount"] += 1
        tree[c]["subcategories"][s]["documentCount"] += 1
        sn = d.get('sensitivity','confidential')
        if sn in tree[c]["sensitivity"]:
            tree[c]["sensitivity"][sn] += 1
            tree[c]["subcategories"][s]["sensitivity"][sn] += 1
        st = d.get('status','pending')
        sk = 'active' if 'active' in st else ('pending' if 'pending' in st else ('deprecated' if 'deprecated' in st or 'archived' in st else 'active'))
        tree[c]["status"][sk] += 1
        tree[c]["subcategories"][s]["documents"].append({
            "documentId":d["documentId"], "title":d["title"], "relativePath":d["relativePath"],
            "sensitivity":d["sensitivity"], "status":d["status"]})
    return tree

def build_policy(cfg):
    return {
        "schemaVersion": cfg["schemaVersion"],
        "accessScopes": {"local":["public","internal","confidential"], "lan":["public","internal"], "public":["public"]},
        "aiModelScopes": {"online_glm":["public"], "local_ollama":["public","internal"],
                           "confidential":"仅本机人工查看，默认不发送给任何AI"},
        "outboundRules": {"allowedSensitivity":["public"], "allowedStatus":["active","confirmed"],
                          "excludedFlags":["pending","noOutbound","deprecated","demo"],
                          "unconfirmedNumbers":"输出'待确认'，不得猜测"},
        "factAuthority": {
            "coreFacts": {"founder":"利建成 / Leo Li", "company":"阳江市锴利国际贸易有限公司",
                           "brand":"KaiLionCrafts",
                           "coreCategories":["Kitchen Knives","Professional Scissors","Outdoor Knives","Kitchen Accessories"],
                           "factoryRelation":["Strategic manufacturing partners","Local manufacturing network","Integrated supply chain collaboration"]},
            "forbiddenDefaults":["家族工厂","自有工厂","4 家工厂","SKU 数量","MOQ","交期","成本优势","出口国家数量","产能","客户案例","订单金额","销售额","利润率"]
        }
    }

def build_report(docs, chunks, errs, cfg, t0, t1):
    sd = {"public":0,"internal":0,"confidential":0,"other":0}
    std = {"active":0,"pending":0,"deprecated":0,"other":0}
    cd = {}; mm = []; cr = []; no = []; pen = []; dep = []; dem = []
    for d in docs:
        s = d.get('sensitivity','confidential')
        if s in sd: sd[s] += 1
        else: sd["other"] += 1
        st = d.get('status','pending')
        if 'active' in st: std["active"] += 1
        elif 'pending' in st or '待' in st: std["pending"] += 1
        elif 'deprecated' in st or 'archived' in st: std["deprecated"] += 1
        else: std["other"] += 1
        c = d.get('category','未分类'); cd[c] = cd.get(c,0)+1
        if not d.get('lastUpdated'): mm.append(d["relativePath"])
        if d.get('conflictReview'): cr.append(d["relativePath"])
        if d.get('noOutbound'): no.append(d["relativePath"])
        if d.get('pending'): pen.append(d["relativePath"])
        if d.get('deprecated'): dep.append(d["relativePath"])
        if d.get('demo'): dem.append(d["relativePath"])
    no_chunks = sum(1 for c in chunks if c.get('noOutbound'))
    return {
        "buildStartTime":t0, "buildEndTime":t1, "buildDurationSeconds":round(t1-t0,2),
        "schemaVersion":cfg["schemaVersion"], "chunkerVersion":cfg["chunkerVersion"],
        "kbVersion":cfg["kbVersion"], "kbRoot":cfg["_kbRootResolved"],
        "scannedFiles":len(docs)+len(errs), "successfulFiles":len(docs), "failedFiles":len(errs),
        "totalChunks":len(chunks), "sensitivityDistribution":sd, "statusDistribution":std,
        "categoryDistribution":cd, "missingLastUpdated":len(mm), "missingLastUpdatedSamples":mm[:20],
        "conflictReviewCount":len(cr), "conflictReviewFiles":cr,
        "noOutboundDocuments":len(no), "noOutboundChunks":no_chunks,
        "pendingDocuments":len(pen), "deprecatedDocuments":len(dep), "demoDocuments":len(dem),
        "parseErrors":errs,
        "mindmapComparison": {"expected":{"total":588,"public":198,"internal":315,"confidential":75},
                               "actual":{"total":len(docs), **sd},
                               "difference":{"total":len(docs)-588, "public":sd["public"]-198, "internal":sd["internal"]-315, "confidential":sd["confidential"]-75}}
    }

def build_index(cfg, dry=False):
    t0 = time.time()
    kb = cfg["_kbRootPath"]
    print(f"[BUILD] 根目录: {kb}")
    files = sorted(kb.rglob("*.md"))
    print(f"[BUILD] 扫描到 {len(files)} 个 Markdown")
    docs = []; chunks = []; errs = []
    for i, fp in enumerate(files):
        if fp.name.startswith('.'): continue
        try:
            meta, body, pe = parse_frontmatter(fp)
            if meta is None: errs.append({"path":str(fp.relative_to(kb)),"error":pe}); continue
            d, body = normalize_doc(meta, body, fp, kb, cfg)
            docs.append(d)
            chunks.extend(chunk_doc(d, body, cfg))
            if (i+1) % 100 == 0: print(f"[BUILD] {i+1}/{len(files)} 文件, {len(chunks)} 切片")
        except Exception as e:
            errs.append({"path":str(fp.relative_to(kb)),"error":f"{type(e).__name__}:{str(e)[:150]}"})
            print(f"[WARN] 失败: {fp.name} - {e}")
    t1 = time.time()
    print(f"[BUILD] 完成: {len(docs)} 文档, {len(chunks)} 切片, {len(errs)} 错误, {round(t1-t0,2)}秒")
    tree = build_tree(docs); policy = build_policy(cfg)
    report = build_report(docs, chunks, errs, cfg, t0, t1)
    idx = {
        "version":2, "kbVersion":cfg["kbVersion"], "schemaVersion":cfg["schemaVersion"],
        "chunkerVersion":cfg["chunkerVersion"], "generatedAt":datetime.now(timezone.utc).isoformat(),
        "kbRoot":cfg["_kbRootResolved"], "totalFiles":len(docs), "totalChunks":len(chunks),
        "stats":{"documents":len(docs),"chunks":len(chunks),"sensitivity":report["sensitivityDistribution"],
                 "status":report["statusDistribution"],"categories":len(tree),"errors":len(errs)},
        "documents":docs, "chunks":chunks, "tree":tree, "policy":policy, "report":report
    }
    if dry:
        print("[DRY-RUN] 不写入"); return idx, report
    out = SCRIPT_DIR / cfg["outputPath"]; tmp = out.with_suffix('.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(idx, f, ensure_ascii=False, separators=(',',':'))
    with open(tmp, 'r', encoding='utf-8') as f: v = json.load(f)
    assert v["totalFiles"] == len(docs) and v["totalChunks"] == len(chunks) and len(v["chunks"]) > 0
    os.replace(tmp, out)
    print(f"[BUILD] 索引写入: {out}")
    for name, data in [("manifestPath", {"schemaVersion":cfg["schemaVersion"],"totalFiles":len(docs),"documents":[{k:v for k,v in d.items() if k!='charCount'} for d in docs]}),
                        ("treePath", tree), ("reportPath", report)]:
        try:
            p = SCRIPT_DIR / cfg[name]; pt = p.with_suffix('.json.tmp')
            with open(pt, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, separators=(',',':'))
            os.replace(pt, p); print(f"[BUILD] {name} 写入: {p}")
        except Exception as e: print(f"[WARN] {name} 失败: {e}")
    return idx, report

def validate(cfg):
    out = SCRIPT_DIR / cfg["outputPath"]
    if not out.exists(): print("[VALIDATE] 不存在"); return False
    with open(out, 'r', encoding='utf-8') as f: d = json.load(f)
    errs = []
    if d.get("totalChunks",0) == 0: errs.append("切片为0")
    for i, c in enumerate(d.get("chunks",[])):
        if not c.get("documentId") or not c.get("relativePath") or not c.get("sensitivity"):
            errs.append(f"chunk[{i}] 缺字段")
        if len(errs) > 10: break
    if errs: print(f"[VALIDATE] {len(errs)} 错误"); return False
    print("[VALIDATE] 通过"); return True

def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--validate', action='store_true')
    a = p.parse_args()
    cfg = load_config()
    if a.validate: sys.exit(0 if validate(cfg) else 1)
    if a.dry_run:
        print("=== DRY RUN ===")
        idx, rep = build_index(cfg, dry=True)
        print(f"文档: {idx['totalFiles']}, 切片: {idx['totalChunks']}")
        print(f"sensitivity: {json.dumps(rep['sensitivityDistribution'], ensure_ascii=False)}")
        return
    print("=== 正式构建 ===")
    idx, rep = build_index(cfg, dry=False)
    print("\n=== 验证 ==="); validate(cfg)
    print(f"\n文档: {rep['scannedFiles']}, 成功: {rep['successfulFiles']}, 失败: {rep['failedFiles']}")
    print(f"切片: {rep['totalChunks']}")
    print(f"sensitivity: {json.dumps(rep['sensitivityDistribution'], ensure_ascii=False)}")
    print(f"冲突审核: {rep['conflictReviewCount']}, noOutbound: {rep['noOutboundDocuments']}")

if __name__ == '__main__':
    main()
