# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - 客户网站证据采集 MVP
P1.3: 安全的公开网站证据采集（SSRF 防护 / robots 合规 / 无 JS 执行）

安全原则：
- 仅抓取公开 http/https 页面，绝不访问内网/回环/链路本地地址
- DNS 解析后校验每个 IP，防止 DNS rebinding
- 重定向目标同样经过 SSRF 校验
- 不执行 JavaScript（纯 urllib + html.parser）
- 抓取失败时所有提取字段为空，绝不返回 AI 猜测内容
- 证据字段分级：verified（抓取）/ customer_input / inferred / missing
"""
import ipaddress
import json
import hashlib
import re
import socket
import sqlite3
import urllib.request
import urllib.parse
import urllib.robotparser
import urllib.error
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple

DB_PATH = Path(__file__).parent / "data" / "workbench.db"

# ============ 抓取控制常量 ============
USER_AGENT = "KaiLionCrafts-Bot/1.0 (+https://kailioncrafts.com)"
CONNECT_TIMEOUT = 5  # 秒
READ_TIMEOUT = 15     # 秒
MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5MB
MAX_SUBPAGES = 3      # 首页之外最多再抓 3 个同域链接

# ============ 关键词表（刀剪/厨具/户外） ============
PRODUCT_KEYWORDS = [
    "knife", "knives", "scissors", "cutlery", "kitchen knife", "kitchen",
    "outdoor", "blade", "chef knife", "chef", "santoku", "butcher",
    "cleaver", "paring knife", "bread knife", "utility knife",
    "hunting knife", "pocket knife", "folding knife", "tactical",
    "cutlery set", "kitchenware", "cookware", "damascus", "carbon steel",
    "stainless steel", "knife set", "steak knife", "boning knife",
]

POSITIONING_KEYWORDS = {
    "premium": ["premium", "luxury", "high-end", "professional grade", "top quality"],
    "professional": ["professional", "pro", "commercial grade", "chef grade"],
    "wholesale": ["wholesale", "bulk", "distributor", "dealer"],
    "manufacturer": ["manufacturer", "factory", "oem", "odm", "producer", "supplier"],
    "custom": ["custom", "personalized", "bespoke", "tailored"],
    "affordable": ["affordable", "budget", "cheap", "value", "best price"],
}

# TLD → 国家（常见）
TLD_COUNTRY = {
    ".de": "Germany", ".fr": "France", ".uk": "United Kingdom",
    ".co.uk": "United Kingdom", ".jp": "Japan", ".us": "United States",
    ".au": "Australia", ".at": "Austria", ".ca": "Canada",
    ".it": "Italy", ".es": "Spain", ".nl": "Netherlands",
    ".be": "Belgium", ".ch": "Switzerland", ".se": "Sweden",
    ".no": "Norway", ".dk": "Denmark", ".fi": "Finland",
    ".pl": "Poland", ".cn": "China", ".tw": "Taiwan",
    ".kr": "South Korea", ".nz": "New Zealand", ".pt": "Portugal",
    ".ie": "Ireland", ".mx": "Mexico", ".br": "Brazil",
}

# lang 属性 → 国家
LANG_COUNTRY = {
    "de": "Germany", "fr": "France", "ja": "Japan", "en": None,
    "es": "Spain", "it": "Italy", "nl": "Netherlands", "sv": "Sweden",
    "ko": "South Korea", "pt": "Portugal",
}

# 邮箱正则
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
# 国际电话正则（+ 或 00 开头）
_PHONE_RE = re.compile(
    r"(?:\+|00)\d{1,3}[\s\-().]?\d{1,4}[\s\-()]?\d{3,4}[\s\-()]?\d{3,4}"
)
# 地址关键词
_ADDRESS_HINTS = ["address:", "headquarters", "factory:", "warehouse:",
                  "located at", "our office", "contact us"]


# ============ SSRF 安全防护 ============

def _is_private_ip(ip_str: str) -> bool:
    """判断 IP 是否为私有/回环/链路本地/保留地址"""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # 无法解析视为不安全
    return (ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_multicast or ip.is_reserved or ip.is_unspecified)


def _dns_resolve_host(hostname: str) -> List[str]:
    """DNS 解析主机名，返回所有 IP 列表；失败返回空列表"""
    try:
        infos = socket.getaddrinfo(hostname, None)
        ips = list({info[4][0] for info in infos})
        return ips
    except socket.gaierror:
        return []
    except Exception:
        return []


def is_safe_url(url: str) -> Tuple[bool, str]:
    """检查 URL 是否安全（SSRF 防护）。

    仅允许 http/https；阻止 localhost、127.0.0.1、0.0.0.0、::1、
    所有私有 IP 段、file://、ftp:// 等。
    对域名做 DNS 解析后校验解析出的每个 IP（防止 DNS rebinding）。

    Returns:
        (safe, reason) — safe=True 时 reason 为空；
        safe=False 时 reason 说明拒绝原因。
    """
    if not url or not isinstance(url, str):
        return False, "空 URL"

    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False, "URL 解析失败"

    # scheme 检查
    if parsed.scheme not in ("http", "https"):
        return False, f"不允许的 scheme: {parsed.scheme}"

    if not parsed.netloc:
        return False, "缺少 netloc"

    hostname = parsed.hostname or ""
    if not hostname:
        return False, "无法提取主机名"

    # 直接检查 hostname 是否为字面 IP 或 localhost
    lowered = hostname.lower()
    if lowered in ("localhost", "localhost.localdomain"):
        return False, "禁止访问 localhost"

    # 如果 hostname 本身是 IP 字面量
    try:
        ip = ipaddress.ip_address(lowered)
        if _is_private_ip(str(ip)):
            return False, f"禁止访问私有/回环地址: {lowered}"
    except ValueError:
        pass  # 不是 IP 字面量，继续 DNS 解析

    # DNS 解析并检查每个 IP（防 DNS rebinding）
    ips = _dns_resolve_host(hostname)
    if not ips:
        return False, f"DNS 解析失败: {hostname}"
    for ip in ips:
        if _is_private_ip(ip):
            return False, f"域名解析到私有/回环地址: {hostname} -> {ip}"

    return True, ""


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """安全重定向处理器：每个 redirect target 都经过 SSRF 校验"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe, reason = is_safe_url(newurl)
        if not safe:
            raise urllib.error.URLError(f"Blocked redirect to unsafe URL: {newurl} ({reason})")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


# ============ HTML 解析器 ============

class _PageParser(HTMLParser):
    """从 HTML 中提取 title / meta / h1 / 链接 / 可见文本（跳过 script/style）"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta_description = ""
        self.meta_keywords = ""
        self.h1_text = ""
        self.lang = ""
        self.links: List[str] = []
        self._text_parts: List[str] = []
        self._in_title = False
        self._in_h1 = False
        self._skip_depth = 0  # script/style 嵌套计数

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        if tag == "html":
            self.lang = attrs_d.get("lang", "").lower()
        elif tag == "title":
            self._in_title = True
        elif tag == "h1":
            self._in_h1 = True
        elif tag == "meta":
            name = (attrs_d.get("name") or "").lower()
            content = attrs_d.get("content", "")
            if name == "description":
                self.meta_description = content
            elif name == "keywords":
                self.meta_keywords = content
        elif tag == "a":
            href = attrs_d.get("href", "")
            if href:
                self.links.append(href)
        elif tag in ("script", "style"):
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "h1":
            self._in_h1 = False
        elif tag in ("script", "style") and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth > 0:
            return
        text = data.strip()
        if not text:
            return
        if self._in_title:
            self.title += text
        if self._in_h1:
            self.h1_text += text
        self._text_parts.append(text)

    @property
    def visible_text(self) -> str:
        return " ".join(self._text_parts)


# ============ 抓取底层 ============

def _build_opener() -> urllib.request.OpenerDirector:
    """构建带安全重定向处理的 opener"""
    opener = urllib.request.build_opener(_SafeRedirectHandler)
    return opener


def _fetch(url: str) -> Dict[str, Any]:
    """抓取单个 URL，返回 {html, final_url, status, truncated, response_size, error}"""
    result = {
        "html": "",
        "final_url": url,
        "status": "success",
        "truncated": False,
        "response_size": 0,
        "error": "",
    }
    opener = _build_opener()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        resp = opener.open(req, timeout=CONNECT_TIMEOUT)
        result["final_url"] = resp.geturl()
        # 分块读取，限制最大大小
        chunks = []
        total = 0
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_RESPONSE_BYTES:
                chunks.append(chunk[:MAX_RESPONSE_BYTES - (total - len(chunk))])
                result["truncated"] = True
                result["status"] = "too_large"
                break
            chunks.append(chunk)
        resp.close()
        raw = b"".join(chunks)
        result["response_size"] = len(raw)
        # 尝试多种编码解码
        for enc in ("utf-8", "latin-1"):
            try:
                result["html"] = raw.decode(enc)
                break
            except (UnicodeDecodeError, ValueError):
                continue
    except socket.timeout:
        result["status"] = "timeout"
        result["error"] = f"请求超时（连接{CONNECT_TIMEOUT}s/读取{READ_TIMEOUT}s）"
    except urllib.error.HTTPError as e:
        result["status"] = "failed"
        result["error"] = f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        reason = str(e.reason)
        if "timed out" in reason.lower():
            result["status"] = "timeout"
        else:
            result["status"] = "failed"
        result["error"] = f"URL 错误: {reason}"
    except Exception as e:
        result["status"] = "failed"
        result["error"] = f"抓取异常: {type(e).__name__}: {e}"
    return result


def _check_robots(url: str) -> Tuple[bool, str]:
    """检查 robots.txt 是否允许抓取该 URL（User-agent: *）"""
    try:
        parsed = urllib.parse.urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        # P0修复：rp.read()无超时可永久阻塞，改用带timeout的手动抓取
        rp = urllib.robotparser.RobotFileParser()
        try:
            opener = urllib.request.build_opener()
            opener.addheaders = [("User-agent", USER_AGENT)]
            with opener.open(robots_url, timeout=CONNECT_TIMEOUT) as r:
                rp.parse(r.read().decode("utf-8", "ignore").splitlines())
        except Exception:
            # robots.txt 抓取失败时，保守允许（fail-open，与原策略一致）
            return True, ""
        allowed = rp.is_allowed(USER_AGENT, url)
        if not allowed:
            return False, f"robots.txt 禁止抓取: {url}"
        return True, ""
    except Exception as e:
        return True, ""


# ============ 信息提取 ============

def _extract_same_domain_links(base_url: str, links: List[str]) -> List[str]:
    """从 <a href> 中提取同域 http/https 链接，去重，返回完整 URL 列表"""
    base = urllib.parse.urlparse(base_url)
    base_host = base.netloc.lower()
    if base_host.startswith("www."):
        base_host = base_host[4:]

    seen = set()
    result = []
    for href in links:
        href = href.strip()
        if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
            continue
        absolute = urllib.parse.urljoin(base_url, href)
        try:
            parsed = urllib.parse.urlparse(absolute)
        except Exception:
            continue
        if parsed.scheme not in ("http", "https"):
            continue
        host = parsed.netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        # 同域判断（含 www 变体）
        if host != base_host:
            continue
        # 去掉 fragment
        clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        if parsed.query:
            clean += f"?{parsed.query}"
        if clean == base_url or clean.rstrip("/") == base_url.rstrip("/"):
            continue  # 跳过首页自身
        if clean in seen:
            continue
        seen.add(clean)
        result.append(clean)
    return result


def _detect_products(text: str) -> List[str]:
    """从页面文本中匹配产品关键词"""
    found = []
    lower = text.lower()
    for kw in PRODUCT_KEYWORDS:
        if kw in lower and kw not in found:
            found.append(kw)
    return found[:10]  # 限制数量


def _detect_positioning(text: str, title: str, h1: str) -> str:
    """从 title/h1/文本推断品牌定位标签"""
    combined = f"{title} {h1} {text}".lower()
    hits = []
    for label, keywords in POSITIONING_KEYWORDS.items():
        for kw in keywords:
            if kw in combined:
                hits.append(label)
                break
    return ", ".join(hits) if hits else ""


def _detect_country(url: str, lang: str, text: str) -> str:
    """从 TLD / lang 属性 / 页面文本推断国家"""
    # 1. TLD
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc.lower()
        for tld, country in sorted(TLD_COUNTRY.items(), key=lambda x: -len(x[0])):
            if host.endswith(tld):
                return country
    except Exception:
        pass

    # 2. lang 属性
    if lang and lang in LANG_COUNTRY and LANG_COUNTRY[lang]:
        return LANG_COUNTRY[lang]

    # 3. 页面文本中的国家名
    text_lower = text.lower()
    country_map = {
        "germany": "Germany", "france": "France", "japan": "Japan",
        "united states": "United States", "usa": "United States",
        "united kingdom": "United Kingdom", "uk": "United Kingdom",
        "australia": "Australia", "canada": "Canada", "italy": "Italy",
        "spain": "Spain", "netherlands": "Netherlands",
    }
    for needle, country in country_map.items():
        if needle in text_lower:
            return country

    return ""


def _extract_contacts(text: str) -> Dict[str, List[str]]:
    """从页面文本中正则提取 email / phone / address 线索"""
    emails = list(dict.fromkeys(_EMAIL_RE.findall(text)))
    phones = list(dict.fromkeys(_PHONE_RE.findall(text)))
    addresses = []
    lower = text.lower()
    for hint in _ADDRESS_HINTS:
        idx = lower.find(hint)
        if idx >= 0:
            # 截取 hint 后 120 字符作为地址片段
            snippet = text[idx:idx + 120].strip()
            addresses.append(snippet)
    return {
        "emails": emails[:10],
        "phones": phones[:10],
        "addresses": addresses[:5],
    }


# ============ SQLite 存储 ============

def _conn(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    return c


def init_evidence_db(db_path: Optional[Path] = None):
    """初始化 evidence 表，可重复执行"""
    c = _conn(db_path)
    cur = c.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS evidence (
        evidence_id TEXT PRIMARY KEY,
        customer_id TEXT,
        url TEXT,
        fetched_at TEXT,
        status TEXT,
        title TEXT,
        description TEXT,
        main_products TEXT,
        brand_positioning TEXT,
        country TEXT,
        contact_clues TEXT,
        evidence_snippets TEXT,
        error_message TEXT,
        response_size INTEGER DEFAULT 0,
        pages_fetched_count INTEGER DEFAULT 0,
        created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_customer ON evidence(customer_id);
    """)
    c.commit()
    c.close()


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _gen_evidence_id() -> str:
    raw = f"ev_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{hashlib.md5(_now_iso().encode()).hexdigest()[:8]}"
    return raw


def save_evidence(evidence: Dict[str, Any], db_path: Optional[Path] = None) -> str:
    """保存证据到 SQLite evidence 表，返回 evidence_id。

    list/dict 字段（main_products, contact_clues, evidence_snippets）以 JSON 字符串存储。
    """
    init_evidence_db(db_path)
    c = _conn(db_path)
    try:
        # P1修复：先生成确定的eid，入库和返回用同一个值
        eid = evidence.get("evidence_id") or _gen_evidence_id()
        evidence = {**evidence, "evidence_id": eid}
        c.execute(
            """INSERT OR REPLACE INTO evidence
               (evidence_id, customer_id, url, fetched_at, status, title, description,
                main_products, brand_positioning, country, contact_clues, evidence_snippets,
                error_message, response_size, pages_fetched_count, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                eid,
                evidence.get("customer_id", ""),
                evidence.get("url", ""),
                evidence.get("fetched_at", _now_iso()),
                evidence.get("status", "failed"),
                evidence.get("title", ""),
                evidence.get("description", ""),
                json.dumps(evidence.get("main_products", []), ensure_ascii=False),
                evidence.get("brand_positioning", ""),
                evidence.get("country", ""),
                json.dumps(evidence.get("contact_clues", {}), ensure_ascii=False),
                json.dumps(evidence.get("evidence_snippets", []), ensure_ascii=False),
                evidence.get("error_message", ""),
                evidence.get("response_size", 0),
                evidence.get("pages_fetched_count", 0),
                _now_iso(),
            ),
        )
        c.commit()
        return eid
    finally:
        c.close()


def get_evidence(customer_id: str, db_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    """获取客户最新一条证据记录；无记录返回 None"""
    init_evidence_db(db_path)
    c = _conn(db_path)
    try:
        row = c.execute(
            "SELECT * FROM evidence WHERE customer_id = ? ORDER BY fetched_at DESC LIMIT 1",
            (customer_id,),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        # JSON 字段还原
        for f in ("main_products", "contact_clues", "evidence_snippets"):
            try:
                d[f] = json.loads(d[f]) if d[f] else ({} if f == "contact_clues" else [])
            except (json.JSONDecodeError, TypeError):
                d[f] = {} if f == "contact_clues" else []
        return d
    finally:
        c.close()


# ============ 主采集函数 ============

def _empty_evidence(customer_id: str, url: str, status: str, error: str) -> Dict[str, Any]:
    """构造失败证据（所有提取字段为空，error_message 写明原因）"""
    return {
        "evidence_id": _gen_evidence_id(),
        "customer_id": customer_id,
        "url": url,
        "fetched_at": _now_iso(),
        "status": status,
        "title": "",
        "description": "",
        "main_products": [],
        "brand_positioning": "",
        "country": "",
        "contact_clues": {"emails": [], "phones": [], "addresses": []},
        "evidence_snippets": [],
        "error_message": error,
        "response_size": 0,
        "pages_fetched_count": 0,
    }


def fetch_website_evidence(customer_id: str, url: str,
                            db_path: Optional[Path] = None) -> Dict[str, Any]:
    """主函数：执行安全检查→robots检查→抓取首页→提取链接→抓取最多3个→
    提取信息→保存证据→返回 evidence dict。

    任何失败阶段都会返回对应 status 的证据，绝不返回 AI 猜测内容。
    """
    # 1. SSRF 安全检查
    safe, reason = is_safe_url(url)
    if not safe:
        ev = _empty_evidence(customer_id, url, "blocked", f"SSRF 检查拒绝: {reason}")
        save_evidence(ev, db_path)
        return ev

    # 2. robots.txt 检查（首页）
    allowed, reason = _check_robots(url)
    if not allowed:
        ev = _empty_evidence(customer_id, url, "blocked", reason)
        save_evidence(ev, db_path)
        return ev

    # 3. 抓取首页
    home = _fetch(url)
    if home["status"] in ("timeout", "failed"):
        ev = _empty_evidence(customer_id, url, home["status"], home["error"])
        save_evidence(ev, db_path)
        return ev

    # 4. 解析首页
    parser = _PageParser()
    try:
        parser.feed(home["html"])
    except Exception:
        pass

    evidence_snippets = []
    pages_fetched = 1

    # 记录首页证据片段
    if parser.title:
        evidence_snippets.append({
            "page_url": home["final_url"],
            "text_excerpt": parser.title[:200],
            "field_type": "title",
        })

    # 5. 提取同域链接并抓取最多 3 个
    sub_links = _extract_same_domain_links(home["final_url"], parser.links)[:MAX_SUBPAGES]
    sub_pages_html = []
    for link in sub_links:
        # 每个子链接也做 SSRF + robots 检查
        s_safe, s_reason = is_safe_url(link)
        if not s_safe:
            continue
        s_allowed, s_reason = _check_robots(link)
        if not s_allowed:
            continue
        sub = _fetch(link)
        if sub["status"] in ("timeout", "failed"):
            continue
        sub_pages_html.append((link, sub["html"]))
        pages_fetched += 1
        # 记录子页面片段
        sub_parser = _PageParser()
        try:
            sub_parser.feed(sub["html"])
        except Exception:
            pass
        if sub_parser.title:
            evidence_snippets.append({
                "page_url": link,
                "text_excerpt": sub_parser.title[:200],
                "field_type": "title",
            })

    # 6. 汇总文本（首页 + 子页面）
    all_text_parts = [parser.visible_text]
    all_title = parser.title
    all_h1 = parser.h1_text
    all_meta_desc = parser.meta_description
    all_meta_kw = parser.meta_keywords
    for _, sub_html in sub_pages_html:
        sp = _PageParser()
        try:
            sp.feed(sub_html)
        except Exception:
            pass
        all_text_parts.append(sp.visible_text)
        if not all_h1 and sp.h1_text:
            all_h1 = sp.h1_text
    combined_text = " ".join(all_text_parts)

    # 7. 提取结构化信息
    main_products = _detect_products(combined_text)
    positioning = _detect_positioning(combined_text, all_title, all_h1)
    country = _detect_country(home["final_url"], parser.lang, combined_text)
    contacts = _extract_contacts(combined_text)

    # 如果 meta description 为空，尝试用 h1 兜底（仍为真实抓取内容）
    description = all_meta_desc or all_h1 or ""

    # 8. 组装证据
    ev = {
        "evidence_id": _gen_evidence_id(),
        "customer_id": customer_id,
        "url": home["final_url"],
        "fetched_at": _now_iso(),
        "status": home["status"],  # success 或 too_large
        "title": all_title,
        "description": description[:500],
        "main_products": main_products,
        "brand_positioning": positioning,
        "country": country,
        "contact_clues": contacts,
        "evidence_snippets": evidence_snippets[:20],
        "error_message": "响应超过5MB已截断" if home["truncated"] else "",
        "response_size": home["response_size"],
        "pages_fetched_count": pages_fetched,
    }
    save_evidence(ev, db_path)
    return ev


# ============ 证据分级辅助 ============

def classify_evidence_field(value: Any, source: str) -> str:
    """对单个字段的值进行证据分级。

    Args:
        value: 字段值
        source: 来源 — "fetch"（网站抓取）/ "customer"（客户输入）/ "infer"（AI 推测）

    Returns:
        "verified" | "customer_input" | "inferred" | "missing"
    """
    # 空值一律 missing
    if value is None or value == "" or value == [] or value == {}:
        return "missing"
    if source == "fetch":
        return "verified"
    if source == "customer":
        return "customer_input"
    if source == "infer":
        return "inferred"
    return "missing"


def build_evidence_aware_prompt_context(customer_data: Dict[str, Any],
                                         website_evidence: Optional[Dict[str, Any]]
                                         ) -> Dict[str, Any]:
    """将客户信息按证据等级分类，用于开发信 Prompt。

    Args:
        customer_data: 客户输入字典（含 company_name, website, country, contact 等）
        website_evidence: fetch_website_evidence 返回的证据 dict（可为 None）

    Returns:
        {
            "verified_facts": {...},      # 来自网站抓取的已验证事实
            "customer_input": {...},      # 客户自行提供、未经验证的信息
            "inferred": {...},            # AI 推测信息
            "missing": [...],             # 缺失字段列表
        }
    """
    verified = {}
    customer_input = {}
    inferred = {}
    missing = []

    # 从网站证据中提取已验证事实
    if website_evidence and website_evidence.get("status") in ("success", "too_large"):
        if website_evidence.get("title"):
            verified["website_title"] = website_evidence["title"]
        if website_evidence.get("main_products"):
            verified["main_products"] = website_evidence["main_products"]
        if website_evidence.get("brand_positioning"):
            verified["brand_positioning"] = website_evidence["brand_positioning"]
        if website_evidence.get("country"):
            verified["country"] = website_evidence["country"]
        if website_evidence.get("contact_clues", {}).get("emails"):
            verified["website_emails"] = website_evidence["contact_clues"]["emails"]
        if website_evidence.get("contact_clues", {}).get("phones"):
            verified["website_phones"] = website_evidence["contact_clues"]["phones"]

    # 客户输入字段
    field_source_map = {
        "company_name": "customer",
        "website": "customer",
        "contact_name": "customer",
        "email": "customer",
        "phone": "customer",
        "address": "customer",
        "notes": "customer",
    }
    for field, src in field_source_map.items():
        val = customer_data.get(field)
        grade = classify_evidence_field(val, src)
        if grade == "customer_input":
            customer_input[field] = val
        elif grade == "missing":
            missing.append(field)

    # 已验证字段不重复列入客户输入
    # 标记缺失的关键字段
    key_fields = ["company_name", "website", "country", "email", "main_products"]
    for f in key_fields:
        if f not in verified and f not in customer_input and f not in missing:
            missing.append(f)

    return {
        "verified_facts": verified,
        "customer_input": customer_input,
        "inferred": inferred,
        "missing": missing,
    }
