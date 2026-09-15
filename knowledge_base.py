# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - 知识库加载器
从标准化知识库中加载公司资料、产品数据、FAQ等
"""
import csv
import json
import re
from pathlib import Path
from config import KB_FILES, COMPANY, KB_SOURCES, KB_SEARCH_CONFIG, KB_DIR


class KnowledgeBase:
    """知识库加载器 - 懒加载，缓存已读取的内容"""

    def __init__(self):
        self._cache = {}

    def _read_file(self, filepath, max_chars=8000):
        """读取文件内容，限制长度避免上下文溢出"""
        if filepath in self._cache:
            return self._cache[filepath]
        try:
            p = Path(filepath)
            if not p.exists():
                return f"[文件不存在: {filepath}]"
            content = p.read_text(encoding="utf-8", errors="ignore")
            if len(content) > max_chars:
                content = content[:max_chars] + "\n\n... [内容已截断，完整内容请查阅原文件]"
            self._cache[filepath] = content
            return content
        except Exception as e:
            return f"[读取失败: {e}]"

    def get_company_profile(self):
        """获取公司简介"""
        return self._read_file(KB_FILES["company_profile"], 6000)

    def get_factory_info(self):
        """获取工厂与供应链信息"""
        return self._read_file(KB_FILES["factory"], 6000)

    def get_pain_points(self):
        """获取客户痛点与公司卖点"""
        return self._read_file(KB_FILES["pain_points"], 4000)

    def get_faq(self):
        """获取FAQ知识库"""
        return self._read_file(KB_FILES["faq"], 8000)

    def get_email_templates(self):
        """获取外贸邮件模板"""
        return self._read_file(KB_FILES["email_templates"], 4000)

    def get_terminology(self):
        """获取术语库"""
        return self._read_file(KB_FILES["terminology"], 5000)

    def get_product_specs(self):
        """获取产品规格参数"""
        return self._read_file(KB_FILES["product_specs"], 4000)

    def get_marketing_copy(self):
        """获取营销文案"""
        return self._read_file(KB_FILES["marketing"], 3000)

    def get_market_strategy(self):
        """获取市场策略"""
        return self._read_file(KB_FILES["market_strategy"], 5000)

    def get_sku_data(self, limit=50):
        """获取SKU产品数据，返回列表"""
        try:
            p = Path(KB_FILES["sku_data"])
            if not p.exists():
                return []
            with open(p, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                rows = []
                for i, row in enumerate(reader):
                    if i >= limit:
                        break
                    rows.append(dict(row))
                return rows
        except Exception as e:
            return [{"error": str(e)}]

    def get_sku_by_category(self, category, limit=20):
        """按品类获取SKU"""
        try:
            p = Path(KB_FILES["sku_data"])
            if not p.exists():
                return []
            with open(p, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                rows = []
                for row in reader:
                    if category in row.get("一级类目", "") or category in row.get("二级分类", ""):
                        rows.append(dict(row))
                        if len(rows) >= limit:
                            break
                return rows
        except Exception:
            return []

    def get_all_categories(self):
        """获取所有产品品类"""
        return COMPANY["categories"]

    def get_company_brief(self):
        """获取公司简介精简版（用于Prompt）"""
        return f"""KaiLionCrafts（锴利匠心）
- 公司：{COMPANY['name_en']}
- 位置：{COMPANY['location']}（中国刀剪之都）
- 定位：{COMPANY['positioning']}
- 品牌：{COMPANY['brand']}
- 创始人：{COMPANY['founder']}
- 四大品类：{', '.join(COMPANY['categories'])}
- 核心优势：阳江源头工厂、MOQ 50把起、OEM/ODM定制、免费4K产品摄影、创始人直接对接
- 认证：CE/FDA/LFGB/RoHS/ISO9001
- 官网：{COMPANY['website']}"""

    def build_context(self, modules=None):
        """构建AI上下文，按需加载知识库模块"""
        if modules is None:
            modules = ["company", "pain_points", "terminology"]
        parts = []
        if "company" in modules:
            parts.append(f"【公司简介】\n{self.get_company_brief()}")
        if "factory" in modules:
            parts.append(f"【工厂与供应链】\n{self.get_factory_info()}")
        if "pain_points" in modules:
            parts.append(f"【客户痛点与卖点】\n{self.get_pain_points()}")
        if "faq" in modules:
            parts.append(f"【FAQ知识库】\n{self.get_faq()}")
        if "email" in modules:
            parts.append(f"【邮件模板】\n{self.get_email_templates()}")
        if "terminology" in modules:
            parts.append(f"【术语规范】\n{self.get_terminology()}")
        if "product_specs" in modules:
            parts.append(f"【产品规格】\n{self.get_product_specs()}")
        if "marketing" in modules:
            parts.append(f"【营销文案】\n{self.get_marketing_copy()}")
        return "\n\n".join(parts)

    # ============ 全文搜索 ============
    def search(self, query, source="all", max_results=None):
        """
        全文搜索知识库
        Args:
            query: 搜索关键词
            source: standard / feishu / all
            max_results: 最大返回结果数
        Returns:
            list of dict: {file, path, category, snippet, score}
        """
        if not query or not query.strip():
            return []

        max_results = max_results or KB_SEARCH_CONFIG["max_results"]
        keywords = [k.lower() for k in re.split(r'\s+', query.strip()) if k]

        # 确定搜索范围
        if source == "all":
            # 全部知识库：遍历所有已挂载的源（重复文件靠 seen_files 去重）
            sources_to_search = [(k, v["path"]) for k, v in KB_SOURCES.items()]
        elif source in KB_SOURCES:
            sources_to_search = [(source, KB_SOURCES[source]["path"])]
        else:
            sources_to_search = [("standard", KB_SOURCES["standard"]["path"])]

        results = []
        seen_files = set()

        for src_key, kb_path in sources_to_search:
            if not kb_path.exists():
                continue
            for ext in KB_SEARCH_CONFIG["supported_extensions"]:
                for filepath in kb_path.rglob(f"*{ext}"):
                    # 跳过指定目录
                    if any(skip in str(filepath) for skip in KB_SEARCH_CONFIG["skip_dirs"]):
                        continue
                    if str(filepath) in seen_files:
                        continue
                    seen_files.add(str(filepath))

                    try:
                        content = filepath.read_text(encoding="utf-8", errors="ignore")
                        content_lower = content.lower()

                        # 计算匹配分数
                        score = 0
                        matched_keywords = 0
                        for kw in keywords:
                            count = content_lower.count(kw)
                            if count > 0:
                                matched_keywords += 1
                                score += count * 10
                                # 标题中匹配加分
                                first_line = content.split('\n')[0].lower() if content else ""
                                if kw in first_line:
                                    score += 20
                                # 文件名中匹配加分
                                if kw in filepath.name.lower():
                                    score += 30

                        if matched_keywords == 0:
                            continue

                        # 提取上下文片段
                        snippet = self._extract_snippet(content, keywords)

                        # 确定分类
                        category = self._get_category(filepath, kb_path)

                        results.append({
                            "file": filepath.name,
                            "path": str(filepath),
                            "category": category,
                            "snippet": snippet,
                            "score": score,
                            "source": src_key,
                        })
                    except Exception:
                        continue

        # 按分数排序
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:max_results]

    def _extract_snippet(self, content, keywords, context_chars=200):
        """提取包含关键词的上下文片段"""
        content_lower = content.lower()
        positions = []
        for kw in keywords:
            pos = content_lower.find(kw)
            if pos >= 0:
                positions.append(pos)

        if not positions:
            return content[:300] + "..."

        # 取第一个匹配位置的上下文
        pos = min(positions)
        start = max(0, pos - context_chars // 2)
        end = min(len(content), pos + context_chars)
        snippet = content[start:end]

        # 高亮关键词
        for kw in keywords:
            snippet = re.sub(
                re.escape(kw),
                f"**{kw}**",
                snippet,
                flags=re.IGNORECASE
            )

        if start > 0:
            snippet = "..." + snippet
        if end < len(content):
            snippet = snippet + "..."

        return snippet

    def _get_category(self, filepath, kb_path):
        """根据路径确定分类"""
        try:
            rel = filepath.relative_to(kb_path)
            parts = rel.parts
            if parts:
                return parts[0]
        except ValueError:
            pass
        return "其他"

    # ============ 知识库浏览 ============
    def list_categories(self, source="standard"):
        """列出知识库的分类目录"""
        kb_path = KB_SOURCES.get(source, KB_SOURCES["standard"])["path"]
        if not kb_path.exists():
            return []
        categories = []
        for item in sorted(kb_path.iterdir()):
            if item.is_dir() and not item.name.startswith('.') and not item.name.startswith('99'):
                file_count = len([f for f in item.rglob('*') if f.is_file()])
                categories.append({
                    "name": item.name,
                    "path": str(item),
                    "file_count": file_count,
                })
        return categories

    def list_files(self, category_path, extensions=None):
        """列出某个分类下的文件"""
        extensions = extensions or KB_SEARCH_CONFIG["supported_extensions"]
        p = Path(category_path)
        if not p.exists():
            return []
        files = []
        for ext in extensions:
            for f in p.rglob(f"*{ext}"):
                if any(skip in str(f) for skip in KB_SEARCH_CONFIG["skip_dirs"]):
                    continue
                try:
                    size = f.stat().st_size
                    files.append({
                        "name": f.name,
                        "path": str(f),
                        "size": size,
                        "size_kb": round(size / 1024, 1),
                        "category": self._get_category(f, p.parent if p.parent.name.startswith(('0', '9')) else p),
                    })
                except Exception:
                    continue
        files.sort(key=lambda x: x["name"])
        return files

    def get_kb_sources(self):
        """获取所有知识库源"""
        return KB_SOURCES

    def read_file_by_path(self, filepath, max_chars=8000):
        """按路径读取文件"""
        return self._read_file(filepath, max_chars)

    # ============ 客户开发技巧模块 ============
    def get_negotiation_tips(self):
        """获取谈客户技巧汇总"""
        tips_dir = KB_DIR / "10_外贸学习与客户开发技巧" / "01_谈客户技巧"
        if not tips_dir.exists():
            return "[谈客户技巧目录不存在]"
        parts = ["# 谈客户技巧汇总\n"]
        for f in sorted(tips_dir.glob("*.md")):
            content = self._read_file(str(f), max_chars=3000)
            parts.append(f"\n## {f.stem}\n{content}\n")
        return "\n".join(parts)

    def get_pricing_tips(self):
        """获取谈判报价技巧汇总"""
        tips_dir = KB_DIR / "10_外贸学习与客户开发技巧" / "02_谈判与报价技巧"
        if not tips_dir.exists():
            return "[谈判报价技巧目录不存在]"
        parts = ["# 谈判与报价技巧汇总\n"]
        for f in sorted(tips_dir.glob("*.md")):
            content = self._read_file(str(f), max_chars=3000)
            parts.append(f"\n## {f.stem}\n{content}\n")
        return "\n".join(parts)

    def get_email_tips(self):
        """获取邮件开发技巧汇总"""
        tips_dir = KB_DIR / "10_外贸学习与客户开发技巧" / "03_邮件开发技巧"
        if not tips_dir.exists():
            return "[邮件开发技巧目录不存在]"
        parts = ["# 邮件开发技巧汇总\n"]
        for f in sorted(tips_dir.glob("*.md")):
            content = self._read_file(str(f), max_chars=3000)
            parts.append(f"\n## {f.stem}\n{content}\n")
        return "\n".join(parts)

    def get_marketing_tips(self):
        """获取营销攻略"""
        tips_dir = KB_DIR / "10_外贸学习与客户开发技巧" / "01_谈客户技巧"
        target = tips_dir / "外贸SOHO高手营销攻略.md"
        if target.exists():
            return self._read_file(str(target), max_chars=8000)
        return "[营销攻略文档不存在]"


# 全局单例
kb = KnowledgeBase()
