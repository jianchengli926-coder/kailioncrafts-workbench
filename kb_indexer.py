#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KaiLionCrafts 知识库索引器
扫描知识库Markdown文件，按标题层级切片，输出kb_index.json
支持增量更新、敏感级别、权威标记、财务屏蔽
"""

import os
import sys
import json
import hashlib
import re
import time
from datetime import datetime
from pathlib import Path

# 配置
KB_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '公司知识库备份_v5.7_2026-09-28')
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kb_index.json')
HASH_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.kb_hash_cache.json')

# 排除规则
EXCLUDE_DIRS = {'99_归档', '99_原始资料索引与映射'}
EXCLUDE_FILES = {'.DS_Store'}
EXCLUDE_EXTENSIONS = {'.zip', '.html', '.png', '.jpg', '.jpeg', '.gif', '.pdf'}

# 权威文件标记（authority=high）
AUTHORITY_FILES = {
    '00_导航与规范/02_公司核心事实速查表.md',
    '02_产品知识库/厨房刀具/04_SKU完整参数表.md',
    '02_产品知识库/专业剪刀/04_SKU完整参数表.md',
    '02_产品知识库/户外刀具/04_SKU完整参数表.md',
    '02_产品知识库/厨房配件/04_SKU完整参数表.md',
    '02_产品知识库/术语与材质/刀剪行业术语词典.md',
}

# 财务屏蔽关键词（no_outbound=true）
FINANCIAL_BLOCK_KEYWORDS = ['成本', '底价', '利润', '供应商结算价', '采购价', '出厂价', '毛利', '净利']


def file_sha256(filepath):
    """计算文件SHA256哈希"""
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def parse_frontmatter(content):
    """解析YAML frontmatter"""
    fm = {}
    if not content.startswith('---'):
        return fm, content
    end = content.find('---', 3)
    if end == -1:
        return fm, content
    fm_text = content[3:end].strip()
    body = content[end + 3:].strip()
    for line in fm_text.split('\n'):
        line = line.strip()
        if ':' in line and not line.startswith('#'):
            key, _, value = line.partition(':')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            # 处理数组
            if value.startswith('[') and value.endswith(']'):
                value = [v.strip().strip('"').strip("'") for v in value[1:-1].split(',') if v.strip()]
            fm[key] = value
    return fm, body


def split_by_headings(body, min_chars=300, max_chars=800, merge_threshold=100):
    """按标题层级切片，每片300-800字，过短切片(少于100字)与相邻片合并"""
    lines = body.split('\n')
    raw_slices = []
    current_title_chain = []
    current_text = []
    current_chars = 0

    def flush_slice():
        nonlocal current_text, current_chars
        text = '\n'.join(current_text).strip()
        if text and len(text) > 20:
            raw_slices.append({
                'title_chain': list(current_title_chain),
                'text': text,
                'char_count': len(text)
            })
        current_text = []
        current_chars = 0

    for line in lines:
        stripped = line.strip()
        heading_match = re.match(r'^(#{1,4})\s+(.+)$', stripped)
        if heading_match:
            level = len(heading_match.group(1))
            title = heading_match.group(2).strip()
            if level <= len(current_title_chain):
                current_title_chain = current_title_chain[:level - 1]
            current_title_chain.append(title)
            if current_chars >= min_chars:
                flush_slice()
            current_text.append(line)
            current_chars += len(line)
        else:
            current_text.append(line)
            current_chars += len(line)
            if current_chars >= max_chars:
                flush_slice()

    flush_slice()

    # 合并过短切片（少于merge_threshold字）
    if len(raw_slices) <= 1:
        return raw_slices

    merged = []
    i = 0
    while i < len(raw_slices):
        current = raw_slices[i]
        # 如果当前切片过短，尝试与下一片合并
        if current['char_count'] < merge_threshold and i + 1 < len(raw_slices):
            next_slice = raw_slices[i + 1]
            merged_text = current['text'] + '\n\n' + next_slice['text']
            merged.append({
                'title_chain': current['title_chain'] if current['title_chain'] else next_slice['title_chain'],
                'text': merged_text,
                'char_count': len(merged_text)
            })
            i += 2
        else:
            merged.append(current)
            i += 1

    return merged


def is_deprecated(content, fm):
    """判断文件是否已归档/过时"""
    if fm.get('status') == 'deprecated' or fm.get('status') == 'archived':
        return True
    if '已归档' in content[:500] or '已废弃' in content[:500]:
        return True
    if '主版本' in content[:500] and ('→' in content[:500] or '指向' in content[:500]):
        return True
    return False


def has_financial_block(text):
    """判断切片是否包含财务敏感内容"""
    for kw in FINANCIAL_BLOCK_KEYWORDS:
        if kw in text:
            return True
    return False


def scan_knowledge_base(kb_root, use_cache=True):
    """扫描知识库，返回切片列表和统计信息"""
    if not os.path.exists(kb_root):
        print(f"❌ 知识库路径不存在: {kb_root}")
        sys.exit(1)

    # 加载哈希缓存
    hash_cache = {}
    if use_cache and os.path.exists(HASH_CACHE_FILE):
        try:
            with open(HASH_CACHE_FILE, 'r', encoding='utf-8') as f:
                hash_cache = json.load(f)
        except Exception:
            hash_cache = {}

    all_slices = []
    stats = {
        'total_files': 0,
        'processed_files': 0,
        'skipped_files': 0,
        'total_slices': 0,
        'by_category': {},
        'by_sensitivity': {'public': 0, 'internal': 0, 'confidential': 0},
        'authority_high': 0,
        'deprecated': 0,
        'no_outbound': 0,
        'changed_files': 0,
        'unchanged_files': 0
    }

    # 收集所有md文件
    md_files = []
    for root, dirs, files in os.walk(kb_root):
        # 排除目录
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        rel_root = os.path.relpath(root, kb_root)
        for fname in files:
            if fname in EXCLUDE_FILES:
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext in EXCLUDE_EXTENSIONS:
                continue
            if ext != '.md':
                continue
            full_path = os.path.join(root, fname)
            rel_path = os.path.join(rel_root, fname).replace(os.sep, '/')
            md_files.append((full_path, rel_path))

    stats['total_files'] = len(md_files)
    print(f"📂 发现 {len(md_files)} 个Markdown文件")

    for full_path, rel_path in sorted(md_files):
        try:
            # 计算哈希
            file_hash = file_sha256(full_path)

            # 增量更新：哈希未变则跳过
            if use_cache and rel_path in hash_cache and hash_cache[rel_path] == file_hash:
                stats['unchanged_files'] += 1
                # 仍然需要读取旧的切片数据？不，跳过处理
                continue

            stats['changed_files'] += 1

            # 读取文件
            with open(full_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # 解析frontmatter
            fm, body = parse_frontmatter(content)

            # 敏感级别：缺失默认confidential
            sensitivity = fm.get('sensitivity', 'confidential').lower()
            if sensitivity not in ('public', 'internal', 'confidential'):
                sensitivity = 'confidential'

            # 分类
            category = fm.get('category', '')
            if not category:
                # 从路径推断
                parts = rel_path.split('/')
                if parts:
                    category = parts[0]

            # 权威标记
            authority = 'normal'
            if rel_path in AUTHORITY_FILES:
                authority = 'high'
            # 也检查文件名包含"核心事实"或"SKU完整参数"或"术语词典"
            elif '核心事实' in rel_path or 'SKU完整参数' in rel_path or '术语词典' in rel_path:
                authority = 'high'

            # deprecated标记
            deprecated = is_deprecated(content, fm)

            # 文件修改时间
            mtime = os.path.getmtime(full_path)
            mtime_str = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d')

            # 切片
            slices = split_by_headings(body)

            for i, sl in enumerate(slices):
                slice_id = hashlib.md5(f"{rel_path}:{i}:{sl['title_chain']}".encode('utf-8')).hexdigest()[:16]

                # 财务屏蔽标记
                no_outbound = False
                if category and category.startswith('11'):
                    if has_financial_block(sl['text']):
                        no_outbound = True

                slice_data = {
                    'id': slice_id,
                    'filePath': rel_path,
                    'fileName': os.path.basename(rel_path),
                    'category': category,
                    'subcategory': fm.get('subcategory', ''),
                    'titleChain': sl['title_chain'],
                    'text': sl['text'],
                    'charCount': sl['char_count'],
                    'sensitivity': sensitivity,
                    'authority': authority,
                    'deprecated': deprecated,
                    'noOutbound': no_outbound,
                    'version': fm.get('version', ''),
                    'lastUpdated': fm.get('last_updated', mtime_str),
                    'fileHash': file_hash,
                    'sliceIndex': i,
                    'tags': fm.get('tags', []),
                    'type': fm.get('type', '')
                }
                all_slices.append(slice_data)

                # 统计
                stats['total_slices'] += 1
                if category:
                    stats['by_category'][category] = stats['by_category'].get(category, 0) + 1
                stats['by_sensitivity'][sensitivity] = stats['by_sensitivity'].get(sensitivity, 0) + 1
                if authority == 'high':
                    stats['authority_high'] += 1
                if deprecated:
                    stats['deprecated'] += 1
                if no_outbound:
                    stats['no_outbound'] += 1

            stats['processed_files'] += 1
            hash_cache[rel_path] = file_hash

            if stats['processed_files'] % 50 == 0:
                print(f"  已处理 {stats['processed_files']}/{len(md_files)} 文件...")

        except Exception as e:
            print(f"  ⚠️ 处理失败 {rel_path}: {e}")
            stats['skipped_files'] += 1

    # 保存哈希缓存
    with open(HASH_CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(hash_cache, f, ensure_ascii=False, indent=2)

    return all_slices, stats


def build_index(slices, stats):
    """构建完整索引对象"""
    return {
        'version': '1.0',
        'kbVersion': 'v5.7',
        'generatedAt': datetime.now().isoformat(),
        'generatedAtReadable': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'stats': stats,
        'slices': slices
    }


def main():
    print("=" * 60)
    print("KaiLionCrafts 知识库索引器")
    print("=" * 60)
    print(f"知识库路径: {KB_ROOT}")
    print(f"输出文件: {OUTPUT_FILE}")
    print()

    # 检查路径
    if not os.path.exists(KB_ROOT):
        print(f"❌ 错误：知识库路径不存在")
        print(f"   请确认路径: {KB_ROOT}")
        sys.exit(1)

    # 扫描
    start_time = time.time()
    slices, stats = scan_knowledge_base(KB_ROOT, use_cache=True)
    elapsed = time.time() - start_time

    # 构建索引
    index = build_index(slices, stats)

    # 写入文件
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    file_size = os.path.getsize(OUTPUT_FILE)

    # 输出统计
    print()
    print("=" * 60)
    print("✅ 索引生成完成")
    print("=" * 60)
    print(f"  总文件数:     {stats['total_files']}")
    print(f"  已处理:       {stats['processed_files']}")
    print(f"  跳过:         {stats['skipped_files']}")
    print(f"  变化文件:     {stats['changed_files']}")
    print(f"  未变化文件:   {stats['unchanged_files']}")
    print(f"  总切片数:     {stats['total_slices']}")
    print(f"  权威(high):   {stats['authority_high']}")
    print(f"  已归档:       {stats['deprecated']}")
    print(f"  财务屏蔽:     {stats['no_outbound']}")
    print(f"  输出大小:     {file_size / 1024:.1f} KB")
    print(f"  耗时:         {elapsed:.1f} 秒")
    print()
    print("  按敏感级别:")
    for sens, count in stats['by_sensitivity'].items():
        print(f"    {sens}: {count}")
    print()
    print("  按分类:")
    for cat, count in sorted(stats['by_category'].items()):
        print(f"    {cat}: {count}")


if __name__ == '__main__':
    main()
