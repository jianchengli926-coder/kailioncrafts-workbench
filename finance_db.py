"""订单与财务中心：SQLite 持久化层（4 表）。
销售订单 / 采购订单 / 收付款流水 / 利润(自动计算)。单文件 data/workbench.db。
"""
import sqlite3
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent / "data" / "workbench.db"

MEMBERS = ["Leo", "Jason", "Owen", "Julia"]
ORDER_STATUS = ["待生产", "生产中", "待验货", "待装柜", "已发货(在途)", "已到港", "已完成", "已取消"]


def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    return c


def init_db():
    c = _conn()
    cur = c.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS sales_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT UNIQUE,
        owner TEXT,
        customer TEXT,
        country TEXT,
        product_summary TEXT,
        qty INTEGER DEFAULT 0,
        total_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT '询价',
        order_date TEXT,
        delivery_date TEXT,
        logistics_fee REAL DEFAULT 0,
        other_fee REAL DEFAULT 0,
        notes TEXT
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_no TEXT UNIQUE,
        sales_order_no TEXT,
        factory TEXT,
        cost_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        pay_status TEXT DEFAULT '未付',
        delivery_status TEXT DEFAULT '未交',
        po_date TEXT,
        notes TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pay_date TEXT,
        direction TEXT,
        ref_order_no TEXT,
        amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        exchange_rate REAL DEFAULT 1,
        method TEXT DEFAULT 'T/T',
        notes TEXT
    );
    """)
    # 轻量迁移：sales_orders 补 trade_extra（JSON：装货港/目的港/Consignee/HS/箱规等）
    existing = {r["name"] for r in c.execute("PRAGMA table_info(sales_orders)").fetchall()}
    if "trade_extra" not in existing:
        c.execute("ALTER TABLE sales_orders ADD COLUMN trade_extra TEXT")
    c.commit()
    c.close()


def _next_no(cur, table, prefix, date_col="order_date"):
    year = datetime.now().strftime("%Y")
    cur.execute(f"SELECT COUNT(*) n FROM {table} WHERE {date_col} LIKE ?", (f"{year}%",))
    n = (cur.fetchone()["n"] or 0) + 1
    return f"{prefix}-{year}-{n:03d}"


# ---------- 销售订单 ----------
def add_sales_order(**kw):
    init_db()
    c = _conn(); cur = c.cursor()
    order_no = _next_no(cur, "sales_orders", "KL", "order_date")
    cur.execute("""INSERT INTO sales_orders
        (order_no,owner,customer,country,product_summary,qty,total_amount,currency,status,
         order_date,delivery_date,logistics_fee,other_fee,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (order_no, kw.get("owner"), kw.get("customer"), kw.get("country"),
         kw.get("product_summary"), kw.get("qty", 0), kw.get("total_amount", 0),
         kw.get("currency", "USD"), kw.get("status", "询价"),
         kw.get("order_date") or datetime.now().strftime("%Y-%m-%d"),
         kw.get("delivery_date"), kw.get("logistics_fee", 0),
         kw.get("other_fee", 0), kw.get("notes")))
    c.commit();
    if kw.get("trade_extra"):
        c.execute("UPDATE sales_orders SET trade_extra=? WHERE order_no=?",
                  (kw["trade_extra"], order_no))
        c.commit()
    c.close()
    return order_no


def list_sales_orders():
    init_db()
    c = _conn(); rows = c.execute("SELECT * FROM sales_orders ORDER BY id DESC").fetchall(); c.close()
    return [dict(r) for r in rows]


def update_sales_status(order_no, status):
    init_db()
    c = _conn(); c.execute("UPDATE sales_orders SET status=? WHERE order_no=?", (status, order_no)); c.commit(); c.close()


# ---------- 采购订单 ----------
def add_purchase_order(**kw):
    init_db()
    c = _conn(); cur = c.cursor()
    po_no = _next_no(cur, "purchase_orders", "PO", "po_date")
    cur.execute("""INSERT INTO purchase_orders
        (po_no,sales_order_no,factory,cost_amount,currency,pay_status,delivery_status,po_date,notes)
        VALUES (?,?,?,?,?,?,?,?,?)""",
        (po_no, kw.get("sales_order_no"), kw.get("factory"), kw.get("cost_amount", 0),
         kw.get("currency", "USD"), kw.get("pay_status", "未付"), kw.get("delivery_status", "未交"),
         kw.get("po_date") or datetime.now().strftime("%Y-%m-%d"), kw.get("notes")))
    c.commit(); c.close()
    return po_no


def list_purchase_orders():
    init_db()
    c = _conn(); rows = c.execute("SELECT * FROM purchase_orders ORDER BY id DESC").fetchall(); c.close()
    return [dict(r) for r in rows]


# ---------- 收付款 ----------
def add_payment(**kw):
    init_db()
    c = _conn()
    c.execute("""INSERT INTO payments (pay_date,direction,ref_order_no,amount,currency,exchange_rate,method,notes)
        VALUES (?,?,?,?,?,?,?,?)""",
        (kw.get("pay_date") or datetime.now().strftime("%Y-%m-%d"), kw.get("direction"),
         kw.get("ref_order_no"), kw.get("amount", 0), kw.get("currency", "USD"),
         kw.get("exchange_rate", 1), kw.get("method", "T/T"), kw.get("notes")))
    c.commit(); c.close()


def list_payments():
    init_db()
    c = _conn(); rows = c.execute("SELECT * FROM payments ORDER BY id DESC").fetchall(); c.close()
    return [dict(r) for r in rows]


def list_customers():
    """按客户汇总：客户名->订单数/订单总额/已收/未收。"""
    orders = list_sales_orders()
    pays = list_payments()
    received_by = {}
    for p in pays:
        if p["direction"] == "收客户":
            received_by[p["ref_order_no"]] = received_by.get(p["ref_order_no"], 0) + p["amount"]
    agg = {}
    for o in orders:
        cu = o["customer"] or "(未填)"
        d = agg.setdefault(cu, {"orders": 0, "total": 0, "received": 0, "last_date": ""})
        d["orders"] += 1
        d["total"] += o["total_amount"]
        d["received"] += received_by.get(o["order_no"], 0)
        if (o["order_date"] or "") > d["last_date"]:
            d["last_date"] = o["order_date"]
    rows = [{"客户": k, "订单数": v["orders"], "订单总额": round(v["total"], 0),
             "已收": round(v["received"], 0), "未收": round(v["total"] - v["received"], 0),
             "最近订单": v["last_date"]} for k, v in agg.items()]
    rows.sort(key=lambda r: r["未收"], reverse=True)
    return rows


def list_factories():
    """已用过的工厂名列表（去重）。"""
    pos = list_purchase_orders()
    seen = []
    for p in pos:
        if p["factory"] and p["factory"] not in seen:
            seen.append(p["factory"])
    return seen


def list_receivables():
    """按销售订单算应收余额与账龄（天数）。"""
    from datetime import date
    orders = list_sales_orders()
    pays = list_payments()
    received = {}
    for p in pays:
        if p["direction"] == "收客户":
            received[p["ref_order_no"]] = received.get(p["ref_order_no"], 0) + p["amount"]
    today = date.today()
    rows = []
    for o in orders:
        bal = o["total_amount"] - received.get(o["order_no"], 0)
        if bal > 0.5:
            days = 0
            if o["order_date"]:
                try:
                    y, m, d = map(int, o["order_date"].split("-"))
                    days = (today - date(y, m, d)).days
                except Exception:
                    days = 0
            rows.append({"订单号": o["order_no"], "客户": o["customer"],
                         "订单额": round(o["total_amount"], 0), "已收": round(received.get(o["order_no"], 0), 0),
                         "未收": round(bal, 0), "下单日": o["order_date"], "账龄天数": days,
                         "状态": o["status"]})
    rows.sort(key=lambda r: r["账龄天数"], reverse=True)
    return rows


# ---------- 汇总 ----------
def dashboard_summary():
    """返回 应收/应付/本月销售额/本月毛利(原币USD口径汇总)。"""
    init_db()
    orders = list_sales_orders()
    pos = list_purchase_orders()
    pays = list_payments()
    # 已收 = 收款方向合计；已付 = 付款方向合计（折人民币简化：按各自amount汇总原币，这里做USD为主近似）
    received = sum(p["amount"] for p in pays if p["direction"] == "收客户")
    paid = sum(p["amount"] for p in pays if p["direction"] == "付工厂")
    order_total = sum(o["total_amount"] for o in orders)
    po_total = sum(p["cost_amount"] for p in pos)
    logistics = sum(o["logistics_fee"] + o["other_fee"] for o in orders)
    ar = order_total - received          # 应收（简化：全部销售-已收）
    ap = po_total - paid                 # 应付
    gross = order_total - po_total - logistics
    this_month = datetime.now().strftime("%Y-%m")
    m_sales = sum(o["total_amount"] for o in orders if (o["order_date"] or "").startswith(this_month))
    m_log = sum((o["logistics_fee"] + o["other_fee"]) for o in orders if (o["order_date"] or "").startswith(this_month))
    m_po = sum(p["cost_amount"] for p in pos if (p["po_date"] or "").startswith(this_month))
    m_gross = m_sales - m_po - m_log
    return {
        "orders": len(orders), "po": len(pos), "payments": len(pays),
        "order_total": order_total, "received": received, "ar": ar,
        "po_total": po_total, "paid": paid, "ap": ap,
        "gross": gross, "m_sales": m_sales, "m_po": m_po, "m_gross": m_gross,
    }
