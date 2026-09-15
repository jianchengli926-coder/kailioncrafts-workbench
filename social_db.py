"""海外社媒矩阵：品类 / 账号 / 内容记录。复用 data/workbench.db。"""
import sqlite3
from pathlib import Path
from datetime import date, datetime

DB_PATH = Path(__file__).parent / "data" / "workbench.db"
COVER_DIR = Path(__file__).parent / "data" / "social_covers"

CATEGORIES = {
    "Outdoor Knives": "Leo Li",
    "Kitchen Knives": "Jason Li",
    "Professional Scissors": "Owen Li",
    "Kitchen Accessories": "Julia Zhong",
}
PLATFORMS = ["Facebook", "Instagram", "YouTube", "TikTok", "X", "LinkedIn", "Pinterest", "WhatsApp"]
CONTENT_TYPES = ["Video", "Shorts", "Reels", "Image", "Graphic Post"]
STATUS = ["策划", "拍摄", "剪辑", "待发布", "已发布", "下架"]


def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    return c


def init_db():
    c = _conn(); cur = c.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS social_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT, owner TEXT, platform TEXT,
        account_name TEXT, account_url TEXT, email TEXT,
        status TEXT DEFAULT 'Active', notes TEXT,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS content_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_no TEXT UNIQUE,
        category TEXT, owner TEXT, platform TEXT, account_id INTEGER,
        cover_path TEXT, title TEXT, content_type TEXT,
        publish_url TEXT, landing_url TEXT, publish_date TEXT,
        views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0,
        saves INTEGER DEFAULT 0, comments INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0, inquiries INTEGER DEFAULT 0,
        orders INTEGER DEFAULT 0, status TEXT DEFAULT '策划',
        shoot_script TEXT, notes TEXT,
        updated_at TEXT
    );
    """)
    # 轻量迁移：补齐后加字段（SQLite 不支持 IF NOT EXISTS for columns）
    existing = {r["name"] for r in cur.execute("PRAGMA table_info(content_records)").fetchall()}
    add_cols = {
        "editing_script": "TEXT", "caption": "TEXT", "hashtags": "TEXT",
        "link_clicks": "INTEGER DEFAULT 0", "website_visits": "INTEGER DEFAULT 0",
        "followers_gained": "INTEGER DEFAULT 0", "multi_links": "TEXT",
    }
    for col, typ in add_cols.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE content_records ADD COLUMN {col} {typ}")
    c.commit(); c.close()


# ---------- 账号 ----------
def add_account(**kw):
    init_db()
    c = _conn()
    c.execute("""INSERT INTO social_accounts
        (category,owner,platform,account_name,account_url,email,status,notes,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)""",
        (kw.get("category"), kw.get("owner"), kw.get("platform"), kw.get("account_name"),
         kw.get("account_url"), kw.get("email"), kw.get("status", "Active"), kw.get("notes"),
         datetime.now().strftime("%Y-%m-%d %H:%M")))
    c.commit(); c.close()


def list_accounts():
    init_db()
    c = _conn(); rows = c.execute("SELECT * FROM social_accounts ORDER BY category, platform").fetchall(); c.close()
    return [dict(r) for r in rows]


def delete_account(aid):
    init_db()
    c = _conn(); c.execute("DELETE FROM social_accounts WHERE id=?", (aid,)); c.commit(); c.close()


# ---------- 内容 ----------
def _next_content_no(cur):
    cur.execute("SELECT COUNT(*) n FROM content_records")
    n = (cur.fetchone()["n"] or 0) + 1
    return f"VID-{n:03d}"


def add_content(**kw):
    init_db()
    c = _conn(); cur = c.cursor()
    no = _next_content_no(cur)
    cur.execute("""INSERT INTO content_records
        (content_no,category,owner,platform,account_id,cover_path,title,content_type,
         publish_url,landing_url,publish_date,views,likes,saves,comments,shares,
         inquiries,orders,status,shoot_script,editing_script,caption,hashtags,
         link_clicks,website_visits,followers_gained,multi_links,notes,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (no, kw.get("category"), kw.get("owner"), kw.get("platform"), kw.get("account_id"),
         kw.get("cover_path"), kw.get("title"), kw.get("content_type", "Video"),
         kw.get("publish_url"), kw.get("landing_url"),
         kw.get("publish_date") or date.today().strftime("%Y-%m-%d"),
         kw.get("views", 0), kw.get("likes", 0), kw.get("saves", 0), kw.get("comments", 0),
         kw.get("shares", 0), kw.get("inquiries", 0), kw.get("orders", 0),
         kw.get("status", "策划"), kw.get("shoot_script"), kw.get("editing_script"),
         kw.get("caption"), kw.get("hashtags"), kw.get("link_clicks", 0),
         kw.get("website_visits", 0), kw.get("followers_gained", 0), kw.get("multi_links"),
         kw.get("notes"), datetime.now().strftime("%Y-%m-%d %H:%M")))
    c.commit(); c.close()
    return no


def delete_content(cid):
    init_db()
    c = _conn(); c.execute("DELETE FROM content_records WHERE id=?", (cid,)); c.commit(); c.close()


def update_content(cid, **kw):
    init_db()
    fields = []
    args = []
    for k in ["title", "status", "views", "likes", "comments", "saves", "shares",
              "inquiries", "orders", "link_clicks", "website_visits", "publish_url",
              "landing_url", "shoot_script", "editing_script", "caption", "hashtags", "notes"]:
        if k in kw:
            fields.append(f"{k}=?"); args.append(kw[k])
    if not fields:
        return
    fields.append("updated_at=?"); args.append(datetime.now().strftime("%Y-%m-%d %H:%M"))
    args.append(cid)
    c = _conn(); c.execute(f"UPDATE content_records SET {','.join(fields)} WHERE id=?", args); c.commit(); c.close()


def contents_of_account(aid):
    init_db()
    c = _conn(); rows = c.execute("SELECT * FROM content_records WHERE account_id=? ORDER BY id DESC", (aid,)).fetchall(); c.close()
    return [dict(r) for r in rows]


def list_contents(category=None, platform=None, owner=None, status=None):
    init_db()
    sql = "SELECT * FROM content_records WHERE 1=1"
    args = []
    if category and category != "全部":
        sql += " AND category=?"; args.append(category)
    if platform and platform != "全部":
        sql += " AND platform=?"; args.append(platform)
    if owner and owner != "全部":
        sql += " AND owner=?"; args.append(owner)
    if status and status != "全部":
        sql += " AND status=?"; args.append(status)
    sql += " ORDER BY id DESC"
    c = _conn(); rows = c.execute(sql, args).fetchall(); c.close()
    return [dict(r) for r in rows]


def interaction_rate(r):
    v = r.get("views", 0) or 0
    if v <= 0:
        return None
    return round((r.get("likes", 0) + r.get("comments", 0) + r.get("saves", 0) + r.get("shares", 0)) / v * 100, 1)


def click_rate(r):
    v = r.get("views", 0) or 0
    return round((r.get("link_clicks", 0) or 0) / v * 100, 2) if v > 0 else None


def inquiry_rate(r):
    lc = r.get("link_clicks", 0) or 0
    return round((r.get("inquiries", 0) or 0) / lc * 100, 1) if lc > 0 else None


# ---------- 驾驶舱 ----------
def dashboard():
    accs = list_accounts()
    active = len([a for a in accs if a["status"] == "Active"])
    contents = list_contents()
    this_month = datetime.now().strftime("%Y-%m")
    pub_this_month = [c for c in contents if (c.get("publish_date") or "").startswith(this_month)]
    s = {
        "accounts": len(accs), "active": active,
        "contents": len(contents), "pub_month": len(pub_this_month),
        "views": sum(c.get("views", 0) for c in contents),
        "likes": sum(c.get("likes", 0) for c in contents),
        "inquiries": sum(c.get("inquiries", 0) for c in contents),
        "orders": sum(c.get("orders", 0) for c in contents),
    }
    # 四品类汇总
    by_cat = {}
    for cat in CATEGORIES:
        cs = [c for c in contents if c["category"] == cat]
        by_cat[cat] = {
            "owner": CATEGORIES[cat],
            "accounts": len([a for a in accs if a["category"] == cat]),
            "pub_month": len([c for c in cs if (c.get("publish_date") or "").startswith(this_month)]),
            "views": sum(c.get("views", 0) for c in cs),
            "inquiries": sum(c.get("inquiries", 0) for c in cs),
            "orders": sum(c.get("orders", 0) for c in cs),
        }
    return s, by_cat
