"""福喜緣照護評估系統 — 本機執行（資料存在 data/care.db，不上傳雲端）。"""
import io
import json
import os
import shutil
import sqlite3
import zipfile
from datetime import date, datetime, timedelta
from functools import wraps

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template, request, send_file, session,
                   url_for)
from werkzeug.security import check_password_hash, generate_password_hash

import schema as S

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
DB_PATH = os.environ.get("CARE_DB") or os.path.join(DATA_DIR, "care.db")
os.makedirs(DATA_DIR, exist_ok=True)
DEMO = os.environ.get("CARE_DEMO") == "1"  # 示範版：關閉名冊匯入與帳號修改（避免真實資料進入公開網站）

app = Flask(__name__)
app.config["SECRET_KEY"] = None  # set in init


# ================================================================== DB
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, name TEXT, title TEXT,
  pw_hash TEXT, role TEXT DEFAULT 'staff', active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY, case_no TEXT, name TEXT, gender TEXT, birth TEXT,
  services TEXT, supervisor TEXT, living TEXT, identity TEXT, phone TEXT, phone2 TEXT, address TEXT,
  diagnosis TEXT, status TEXT DEFAULT '在案', note TEXT, created TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS assessments (id INTEGER PRIMARY KEY, client_id INTEGER, type TEXT, date TEXT,
  assessor TEXT, kind TEXT, data TEXT, summary TEXT, note TEXT, next_due TEXT, keyed INTEGER DEFAULT 0,
  created TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS aids (id INTEGER PRIMARY KEY, client_id INTEGER, item TEXT, category TEXT, source TEXT,
  start_date TEXT, end_date TEXT, status TEXT DEFAULT '使用中', fit_date TEXT, train_date TEXT, check_date TEXT,
  note TEXT, created TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY, client_id INTEGER, domain TEXT, goal TEXT, method TEXT,
  baseline TEXT, start_date TEXT, review_date TEXT, status TEXT DEFAULT '進行中', assessment_id INTEGER,
  created TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS goal_reviews (id INTEGER PRIMARY KEY, goal_id INTEGER, date TEXT, progress TEXT,
  note TEXT, reviewer TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, ts TEXT, name TEXT, role TEXT, page TEXT,
  kind TEXT, content TEXT, status TEXT DEFAULT '未處理', reply TEXT);
CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, ts TEXT, user TEXT, action TEXT, detail TEXT);
"""

DEFAULT_PASSWORD = "1111"  # 預設帳號 1111／密碼 1111，登入後請到「設定」修改

DEFAULT_SETTINGS = {
    "center_name": "福喜緣日間照顧中心",
    "supervisor": "",
    "supervisor_title": "護理師",
    "reeval_months": "6",
}


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def _close(_):
    d = g.pop("db", None)
    if d is not None:
        d.close()


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA_SQL)
    for k, v in DEFAULT_SETTINGS.items():
        con.execute("INSERT OR IGNORE INTO settings VALUES (?,?)", (k, v))
    if not con.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        con.execute("INSERT INTO users (username,name,title,pw_hash,role) VALUES ('1111','管理者','',?, 'admin')",
                    (generate_password_hash(DEFAULT_PASSWORD),))
    row = con.execute("SELECT value FROM settings WHERE key='secret'").fetchone()
    if not row:
        con.execute("INSERT INTO settings VALUES ('secret', ?)", (os.urandom(24).hex(),))
        row = con.execute("SELECT value FROM settings WHERE key='secret'").fetchone()
    con.commit()
    con.close()
    app.config["SECRET_KEY"] = row[0]


def setting(key):
    r = db().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else DEFAULT_SETTINGS.get(key, "")


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(action, detail=""):
    db().execute("INSERT INTO logs (ts,user,action,detail) VALUES (?,?,?,?)",
                 (now(), session.get("name", ""), action, detail))


# ================================================================== 日期工具
def to_date(s):
    if not s:
        return None
    if isinstance(s, (date, datetime)):
        return s if isinstance(s, date) and not isinstance(s, datetime) else s.date()
    s = str(s).strip().replace(".", "/").replace("-", "/")
    parts = s.split("/")
    try:
        y, m, d = (int(p) for p in parts[:3])
    except ValueError:
        return None
    if y < 1000:
        y += 1911
    try:
        return date(y, m, d)
    except ValueError:
        return None


def iso(s):
    d = to_date(s)
    return d.isoformat() if d else ""


def roc(s, sep="/"):
    d = to_date(s)
    return f"{d.year - 1911}{sep}{d.month:02d}{sep}{d.day:02d}" if d else ""


def roc_long(s):
    d = to_date(s)
    return f"{d.year - 1911} 年 {d.month} 月 {d.day} 日" if d else "　　 年　 月　 日"


def add_months(d, n):
    d = to_date(d)
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    last = [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return date(y, m, min(d.day, last))


def age_at(birth, on=None):
    b = to_date(birth)
    if not b:
        return None
    on = to_date(on) or date.today()
    return on.year - b.year - ((on.month, on.day) < (b.month, b.day))


def boxes(text):
    """☑／☐ 選項不斷行，勾選的標成藍色粗體（其餘內容先跳脫）"""
    import re
    from markupsafe import Markup, escape
    t = str(escape(text))
    t = re.sub(r"☑([^　☐☑（\s]+)", r'<b class="v nw">☑\1</b>', t)
    t = re.sub(r"☐([^　☐☑（\s<]+)", r'<span class="nw">☐\1</span>', t)
    return Markup(t)


app.jinja_env.filters.update(roc=roc, roc_long=roc_long, boxes=boxes)
app.jinja_env.globals.update(S=S, today=lambda: date.today().isoformat(),
                             css_ver=lambda: int(os.path.getmtime(os.path.join(BASE, "static", "app.css"))))


# ================================================================== 資料存取
def client_dict(row, on=None):
    c = dict(row)
    c["age"] = age_at(c.get("birth"), on)
    c["label"] = f"{c['name']}（{c['case_no']}）" if c.get("case_no") else c["name"]
    return c


def get_client(cid):
    r = db().execute("SELECT * FROM clients WHERE id=?", (cid,)).fetchone()
    if not r:
        abort(404)
    return client_dict(r)


def assess_dict(row):
    a = dict(row)
    a["data"] = json.loads(a["data"] or "{}")
    return a


def get_assess(aid):
    r = db().execute("SELECT * FROM assessments WHERE id=?", (aid,)).fetchone()
    if not r:
        abort(404)
    return assess_dict(r)


def client_assess(cid, types=None):
    q = "SELECT * FROM assessments WHERE client_id=?"
    args = [cid]
    if types:
        q += " AND type IN (%s)" % ",".join("?" * len(types))
        args += list(types)
    rows = [assess_dict(r) for r in db().execute(q + " ORDER BY date DESC, id DESC", args)]
    real = {(a["type"], a["date"]) for a in rows if "HIST" not in a["type"]}
    return [a for a in rows if not ("HIST" in a["type"] and (a["type"].replace("_HIST", ""), a["date"]) in real)]


def client_aids(cid):
    return [dict(r) for r in db().execute(
        "SELECT * FROM aids WHERE client_id=? ORDER BY status, start_date DESC", (cid,))]


def client_goals(cid):
    gs = [dict(r) for r in db().execute("SELECT * FROM goals WHERE client_id=? ORDER BY status, start_date DESC", (cid,))]
    for gl in gs:
        gl["reviews"] = [dict(r) for r in db().execute(
            "SELECT * FROM goal_reviews WHERE goal_id=? ORDER BY date DESC", (gl["id"],))]
    return gs


def due_info(cid, months=None):
    months = months or int(setting("reeval_months") or 6)
    rows = db().execute("SELECT type,date,next_due FROM assessments WHERE client_id=? ORDER BY date DESC", (cid,)).fetchall()
    if not rows:
        return {"last": "", "next": "", "status": "未評估", "last_d61": "", "last_icope": ""}
    last = rows[0]
    nxt = to_date(last["next_due"]) or add_months(last["date"], months)
    today = date.today()
    st = "逾期" if nxt < today else ("30天內到期" if nxt <= today + timedelta(days=30) else "正常")
    ld = next((r["date"] for r in rows if r["type"] in ("D61", "D61_HIST")), "")
    li = next((r["date"] for r in rows if r["type"] in ("ICOPE", "ICOPE_HIST")), "")
    return {"last": last["date"], "next": nxt.isoformat(), "status": st, "last_d61": ld, "last_icope": li}


def active_clients(status="在案"):
    q = "SELECT * FROM clients"
    args = []
    if status:
        q += " WHERE status=?"
        args.append(status)
    cs = [client_dict(r) for r in db().execute(q + " ORDER BY case_no, name", args)]
    for c in cs:
        c["due"] = due_info(c["id"])
    return cs


# ================================================================== 登入
def login_required(f):
    @wraps(f)
    def w(*a, **k):
        if not session.get("uid"):
            return redirect(url_for("login", next=request.path))
        return f(*a, **k)
    return w


@app.context_processor
def _ctx():
    if not session.get("uid"):
        return {"center": setting("center_name"), "demo": DEMO}
    return {"center": setting("center_name"), "demo": DEMO,
            "me": {"name": session.get("name"), "title": session.get("title")}}


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        u = db().execute("SELECT * FROM users WHERE username=? AND active=1", (request.form.get("username", "").strip(),)).fetchone()
        if u and check_password_hash(u["pw_hash"], request.form.get("password", "")):
            session.clear()
            session.update(uid=u["id"], name=u["name"], title=u["title"] or "", role=u["role"])
            if not DEMO and check_password_hash(u["pw_hash"], DEFAULT_PASSWORD):
                flash("目前仍使用預設密碼 1111，請到「設定」修改密碼", "err")
            log("登入")
            db().commit()
            nxt = request.args.get("next", "")
            return redirect(nxt if nxt.startswith("/") else url_for("home"))
        flash("帳號或密碼錯誤", "err")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ================================================================== 首頁
@app.route("/")
@login_required
def home():
    cs = active_clients()
    counts = {k: sum(1 for c in cs if c["due"]["status"] == k) for k in ("逾期", "30天內到期", "未評估", "正常")}
    todo = sorted([c for c in cs if c["due"]["status"] != "正常"],
                  key=lambda c: ({"逾期": 0, "未評估": 1, "30天內到期": 2}[c["due"]["status"]], c["due"]["next"] or ""))
    recent = db().execute("""SELECT a.*, c.name, c.case_no FROM assessments a JOIN clients c ON c.id=a.client_id
        WHERE a.type IN ('D61','ICOPE') ORDER BY a.updated DESC LIMIT 8""").fetchall()
    unkeyed = db().execute("""SELECT a.*, c.name, c.case_no FROM assessments a JOIN clients c ON c.id=a.client_id
        WHERE a.type='D61' AND a.keyed=0 ORDER BY a.date""").fetchall()
    ind = indicators(cs)
    return render_template("home.html", cs=cs, counts=counts, todo=todo[:15], recent=recent, unkeyed=unkeyed, ind=ind)


def indicators(cs=None):
    """評鑑指標（115 年 附件2-3）完成度"""
    cs = cs if cs is not None else active_clients()
    n = len(cs) or 1
    since = (date.today() - timedelta(days=183)).isoformat()
    b1 = [c for c in cs if c["due"]["last"] and c["due"]["last"] >= since]
    aids = [dict(r) for r in db().execute("SELECT a.*, c.status cst FROM aids a JOIN clients c ON c.id=a.client_id WHERE c.status='在案' AND a.status='使用中'")]
    aid_ok = [a for a in aids if a["start_date"] and a["fit_date"] and a["train_date"]]
    gl = [dict(r) for r in db().execute("SELECT g.* FROM goals g JOIN clients c ON c.id=g.client_id WHERE c.status='在案' AND g.status='進行中'")]
    with_goal = {x["client_id"] for x in gl}
    reviewed = set()
    for x in gl:
        r = db().execute("SELECT MAX(date) d FROM goal_reviews WHERE goal_id=?", (x["id"],)).fetchone()
        if r["d"] and r["d"] >= (date.today() - timedelta(days=92)).isoformat():
            reviewed.add(x["id"])
    return {
        "n": len(cs),
        "b1": (len(b1), round(len(b1) * 100 / n)),
        "b9": (len(aid_ok), len(aids), round(len(aid_ok) * 100 / (len(aids) or 1))),
        "b10": (len(with_goal), round(len(with_goal) * 100 / n), len(reviewed), len(gl)),
    }


# ================================================================== 個案
CLIENT_FIELDS = ["case_no", "name", "gender", "birth", "services", "supervisor", "living", "identity", "phone",
                 "phone2", "address", "diagnosis", "status", "note"]


@app.route("/clients")
@login_required
def clients():
    st = request.args.get("status", "在案")
    cs = active_clients(None if st == "全部" else st)
    q = request.args.get("q", "").strip()
    if q:
        cs = [c for c in cs if q in (c["name"] or "") or q.upper() in (c["case_no"] or "").upper()]
    due = request.args.get("due", "")
    if due:
        cs = [c for c in cs if c["due"]["status"] == due]
    return render_template("clients.html", cs=cs, st=st, q=q, due=due)


@app.route("/clients/new", methods=["GET", "POST"])
@app.route("/clients/<int:cid>/edit", methods=["GET", "POST"])
@login_required
def client_edit(cid=None):
    c = get_client(cid) if cid else {"status": "在案"}
    if request.method == "POST":
        vals = {k: request.form.get(k, "").strip() for k in CLIENT_FIELDS}
        vals["birth"] = iso(vals["birth"])
        if not vals["name"]:
            flash("請輸入姓名", "err")
            return render_template("client_form.html", c=vals)
        if cid:
            db().execute("UPDATE clients SET %s, updated=? WHERE id=?" % ",".join(f"{k}=?" for k in CLIENT_FIELDS),
                         [vals[k] for k in CLIENT_FIELDS] + [now(), cid])
        else:
            cur = db().execute("INSERT INTO clients (%s, created, updated) VALUES (%s)" % (
                ",".join(CLIENT_FIELDS), ",".join("?" * (len(CLIENT_FIELDS) + 2))),
                [vals[k] for k in CLIENT_FIELDS] + [now(), now()])
            cid = cur.lastrowid
        log("個案資料", vals["name"])
        db().commit()
        flash("已儲存", "ok")
        return redirect(url_for("client_view", cid=cid))
    return render_template("client_form.html", c=c)


@app.route("/clients/<int:cid>")
@login_required
def client_view(cid):
    c = get_client(cid)
    allas = client_assess(cid)
    d61s = [a for a in allas if a["type"] == "D61"]
    icopes = [a for a in allas if a["type"] == "ICOPE"]
    changes = S.compare_d61(d61s[1]["data"], d61s[0]["data"]) if len(d61s) > 1 else []
    return render_template("client.html", c=c, allas=allas, d61s=d61s, icopes=icopes, changes=changes,
                           aids=client_aids(cid), goals=client_goals(cid), due=due_info(cid),
                           trend=icope_trend(icopes), d61trend=d61_trend(d61s))


def icope_trend(icopes):
    cols = list(reversed(icopes))[-6:]
    rows = []
    for k, lbl in S.ICOPE_ALL:
        rows.append((lbl, [S.icope_auto(a["data"]).get(k, "") for a in cols]))
    secs = []
    for a in cols:
        try:
            secs.append(float(a["data"].get("mob_seconds")))
        except (TypeError, ValueError):
            secs.append(None)
    return {"dates": [a["date"] for a in cols], "rows": rows, "secs": secs}


def d61_trend(d61s):
    cols = list(reversed(d61s))[-6:]
    rows = []
    for f in S.D61_RADIOS:
        vals = [a["data"].get(f["key"], "") for a in cols]
        if any(vals):
            rows.append((f["qlabel"], vals, f["options"]))
    rows.append(("ADL 需協助項目", ["、".join(a["data"].get("adl_help") or []) or "獨立" for a in cols], None))
    return {"dates": [a["date"] for a in cols], "rows": rows}


# ================================================================== 評估（D61 / 六力）
META = {"client_id", "date", "assessor", "kind", "summary", "note", "next_due", "keyed", "_action"}
LIST_KEYS = {f["key"] for f in S.D61_FIELDS.values() if f["type"] == "multi"} | {k + "_actions" for k, _ in S.ICOPE_ALL}


def parse_data(form):
    d = {}
    for k in form.keys():
        if k in META:
            continue
        vals = [v.strip() for v in form.getlist(k)]
        d[k] = [v for v in vals if v] if k in LIST_KEYS else (vals[-1] if vals else "")
    for k in LIST_KEYS:
        d.setdefault(k, [])
    return {k: v for k, v in d.items() if v not in ("", None)}


@app.route("/assess/<typ>")
@login_required
def assess_list(typ):
    typ = typ.upper()
    if typ not in ("D61", "ICOPE"):
        abort(404)
    f, t, q = request.args.get("from", ""), request.args.get("to", ""), request.args.get("q", "").strip()
    sql = """SELECT a.*, c.name, c.case_no FROM assessments a JOIN clients c ON c.id=a.client_id WHERE a.type IN (?,?)"""
    args = [typ, typ + "_HIST"]
    if f:
        sql += " AND a.date>=?"; args.append(iso(f))
    if t:
        sql += " AND a.date<=?"; args.append(iso(t))
    if q:
        sql += " AND (c.name LIKE ? OR c.case_no LIKE ? OR a.assessor LIKE ?)"; args += [f"%{q}%"] * 3
    rows = [assess_dict(r) for r in db().execute(sql + " ORDER BY a.date DESC, a.id DESC", args)]
    for r in rows:
        if typ == "ICOPE" and r["type"] == "ICOPE":
            r["abn"] = S.icope_abnormal(r["data"])
    return render_template("assess_list.html", typ=typ, rows=rows, f=f, t=t, q=q, cs=active_clients())


@app.route("/assess/<typ>/new")
@app.route("/assess/<typ>/<int:aid>")
@login_required
def assess_edit(typ, aid=None):
    typ = typ.upper()
    if typ not in ("D61", "ICOPE"):
        abort(404)
    a = get_assess(aid) if aid else None
    if a and a["type"] != typ:
        if "HIST" in a["type"]:
            flash("這是從 care99／紙本匯入的歷史日期，沒有內容可編輯", "err")
            return redirect(url_for("client_view", cid=a["client_id"]))
        return redirect(url_for("assess_edit", typ=a["type"].lower(), aid=aid))
    cid = int(request.values.get("client") or (a and a["client_id"]) or 0)
    c = get_client(cid) if cid else None
    data, prev, src = (a["data"] if a else {}), None, ""
    if c:
        same = [x for x in client_assess(cid, [typ]) if not a or x["id"] != a["id"]]
        older = [x for x in same if not a or (x["date"], x["id"]) < (a["date"], a["id"])]
        prev = older[0] if older else None
        if not a:
            frm = request.args.get("from", "")
            if frm == "last" and prev:
                data = {k: v for k, v in prev["data"].items()}
                src = f"已帶入上次（{roc(prev['date'])}）內容，請逐項確認修改"
            if typ == "D61" and frm == "icope":
                ic = client_assess(cid, ["ICOPE"])
                if ic:
                    base = prev["data"] if prev else {}
                    data = S.icope_to_d61(ic[0]["data"], base)
                    src = f"已依六力評估（{roc(ic[0]['date'])}）帶入認知、感官、功能性動作與治療計畫" + ("，其餘沿用上次 D61" if prev else "")
    defaults = {
        "date": a["date"] if a else date.today().isoformat(),
        "assessor": a["assessor"] if a else f"{session.get('name')}",
        "kind": a["kind"] if a else ("再評估" if prev else "初評"),
        "summary": a["summary"] if a else "", "note": a["note"] if a else "",
        "next_due": a["next_due"] if a else add_months(date.today(), int(setting("reeval_months") or 6)).isoformat(),
        "keyed": a["keyed"] if a else 0,
    }
    ic_latest = client_assess(cid, ["ICOPE"])[:1] if c else []
    tpl = "d61_form.html" if typ == "D61" else "icope_form.html"
    return render_template(tpl, a=a, c=c, data=data, prev=prev, src=src, m=defaults, cs=active_clients(),
                           aids=client_aids(cid) if c else [], ic_latest=ic_latest[0] if ic_latest else None,
                           judge=S.icope_auto(data) if typ == "ICOPE" else None)


@app.route("/assess/<typ>/save", methods=["POST"])
@app.route("/assess/<typ>/<int:aid>/save", methods=["POST"])
@login_required
def assess_save(typ, aid=None):
    typ = typ.upper()
    f = request.form
    cid = int(f.get("client_id") or 0)
    if not cid or not f.get("date"):
        flash("請選擇評估對象並填寫評估日期", "err")
        return redirect(request.referrer or url_for("assess_list", typ=typ.lower()))
    data = parse_data(f)
    row = (cid, typ, iso(f["date"]), f.get("assessor", "").strip(), f.get("kind", ""), json.dumps(data, ensure_ascii=False),
           f.get("summary", "").strip(), f.get("note", "").strip(), iso(f.get("next_due", "")), 1 if f.get("keyed") else 0)
    if aid:
        db().execute("""UPDATE assessments SET client_id=?,type=?,date=?,assessor=?,kind=?,data=?,summary=?,note=?,
            next_due=?,keyed=?,updated=? WHERE id=?""", row + (now(), aid))
    else:
        aid = db().execute("""INSERT INTO assessments (client_id,type,date,assessor,kind,data,summary,note,next_due,keyed,
            created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", row + (now(), now())).lastrowid
    log(f"儲存{typ}", f"#{aid}")
    db().commit()
    flash("已儲存。可直接匯出 Word / PDF。", "ok")
    if f.get("_action") == "goals" and typ == "ICOPE":
        return redirect(url_for("goals_from_icope", aid=aid))
    return redirect(url_for("assess_view", aid=aid))


@app.route("/a/<int:aid>")
@login_required
def assess_view(aid):
    a = get_assess(aid)
    c = get_client(a["client_id"])
    c["age"] = age_at(c.get("birth"), a["date"])
    prev = None
    if a["type"] == "D61":
        older = [x for x in client_assess(c["id"], ["D61"]) if (x["date"], x["id"]) < (a["date"], a["id"])]
        prev = older[0] if older else None
    return render_template("assess_view.html", a=a, c=c, prev=prev,
                           changes=S.compare_d61(prev["data"], a["data"]) if prev else [],
                           judge=S.icope_auto(a["data"]) if a["type"] == "ICOPE" else None)


@app.route("/a/<int:aid>/keyed", methods=["POST"])
@login_required
def assess_keyed(aid):
    db().execute("UPDATE assessments SET keyed=1-keyed, updated=? WHERE id=?", (now(), aid))
    db().commit()
    return redirect(request.referrer or url_for("assess_view", aid=aid))


@app.route("/a/<int:aid>/delete", methods=["POST"])
@login_required
def assess_delete(aid):
    a = get_assess(aid)
    db().execute("DELETE FROM assessments WHERE id=?", (aid,))
    log("刪除評估", f"{a['type']} #{aid}")
    db().commit()
    flash("已刪除該筆評估", "ok")
    return redirect(url_for("client_view", cid=a["client_id"]))


@app.route("/api/narrative", methods=["POST"])
@login_required
def api_narrative():
    cid = int(request.form.get("client_id") or 0)
    c = get_client(cid) if cid else {}
    if c:
        c["age"] = age_at(c.get("birth"), request.form.get("date"))
    data = parse_data(request.form)
    ic = None
    if cid and request.form.get("with_icope"):
        lst = client_assess(cid, ["ICOPE"])
        ic = lst[0]["data"] if lst else None
    return jsonify(text=S.d61_narrative(c, data, client_aids(cid) if cid else [], ic))


@app.route("/api/icope", methods=["POST"])
@login_required
def api_icope():
    data = parse_data(request.form)
    j = S.icope_auto(data)
    ab = [lbl for k, lbl in S.ICOPE_DOMAINS if j.get(k) == "異常"]
    ok = [lbl for k, lbl in S.ICOPE_DOMAINS if j.get(k) == "正常"]
    return jsonify(judge=j, abnormal=ab, normal=ok, plan=S.icope_plan_text(data))


# ================================================================== 輔具（B9）
AID_FIELDS = ["client_id", "item", "category", "source", "start_date", "end_date", "status", "fit_date",
              "train_date", "check_date", "note"]


@app.route("/aids")
@login_required
def aids():
    rows = [dict(r) for r in db().execute("""SELECT a.*, c.name, c.case_no FROM aids a JOIN clients c ON c.id=a.client_id
        WHERE c.status='在案' ORDER BY c.case_no, a.status, a.item""")]
    miss = request.args.get("miss")
    if miss:
        rows = [r for r in rows if r["status"] == "使用中" and not (r["start_date"] and r["fit_date"] and r["train_date"])]
    return render_template("aids.html", rows=rows, cs=active_clients(), miss=miss)


@app.route("/aids/save", methods=["POST"])
@app.route("/aids/<int:xid>/save", methods=["POST"])
@login_required
def aid_save(xid=None):
    v = {k: request.form.get(k, "").strip() for k in AID_FIELDS}
    for k in ("start_date", "end_date", "fit_date", "train_date", "check_date"):
        v[k] = iso(v[k])
    if not v["client_id"] or not v["item"]:
        flash("請選擇個案並填寫輔具名稱", "err")
    elif xid:
        db().execute("UPDATE aids SET %s, updated=? WHERE id=?" % ",".join(f"{k}=?" for k in AID_FIELDS),
                     [v[k] for k in AID_FIELDS] + [now(), xid])
    else:
        db().execute("INSERT INTO aids (%s,created,updated) VALUES (%s)" % (",".join(AID_FIELDS), ",".join("?" * (len(AID_FIELDS) + 2))),
                     [v[k] for k in AID_FIELDS] + [now(), now()])
    db().commit()
    return redirect(request.form.get("back") or url_for("aids"))


@app.route("/aids/<int:xid>/delete", methods=["POST"])
@login_required
def aid_delete(xid):
    db().execute("DELETE FROM aids WHERE id=?", (xid,))
    db().commit()
    return redirect(request.form.get("back") or url_for("aids"))


# ================================================================== 自立支援／復能目標（B10）
GOAL_FIELDS = ["client_id", "domain", "goal", "method", "baseline", "start_date", "review_date", "status"]
GOAL_DOMAINS = ["行動／肌力平衡", "認知", "日常生活自立", "社會參與", "感官", "情緒", "營養", "其他"]


@app.route("/goals")
@login_required
def goals():
    st = request.args.get("status", "進行中")
    sql = """SELECT g.*, c.name, c.case_no FROM goals g JOIN clients c ON c.id=g.client_id WHERE c.status='在案'"""
    args = []
    if st != "全部":
        sql += " AND g.status=?"; args.append(st)
    rows = [dict(r) for r in db().execute(sql + " ORDER BY g.review_date, c.case_no", args)]
    for r in rows:
        rv = db().execute("SELECT * FROM goal_reviews WHERE goal_id=? ORDER BY date DESC LIMIT 1", (r["id"],)).fetchone()
        r["last"] = dict(rv) if rv else None
        r["overdue"] = r["status"] == "進行中" and r["review_date"] and r["review_date"] < date.today().isoformat()
    return render_template("goals.html", rows=rows, cs=active_clients(), st=st, domains=GOAL_DOMAINS)


@app.route("/goals/save", methods=["POST"])
@app.route("/goals/<int:xid>/save", methods=["POST"])
@login_required
def goal_save(xid=None):
    v = {k: request.form.get(k, "").strip() for k in GOAL_FIELDS}
    v["start_date"], v["review_date"] = iso(v["start_date"]), iso(v["review_date"])
    v["status"] = v["status"] or "進行中"
    if not v["client_id"] or not v["goal"]:
        flash("請選擇個案並填寫目標", "err")
    elif xid:
        db().execute("UPDATE goals SET %s, updated=? WHERE id=?" % ",".join(f"{k}=?" for k in GOAL_FIELDS),
                     [v[k] for k in GOAL_FIELDS] + [now(), xid])
    else:
        db().execute("INSERT INTO goals (%s,created,updated) VALUES (%s)" % (",".join(GOAL_FIELDS), ",".join("?" * (len(GOAL_FIELDS) + 2))),
                     [v[k] for k in GOAL_FIELDS] + [now(), now()])
    db().commit()
    return redirect(request.form.get("back") or url_for("goals"))


@app.route("/goals/<int:xid>/review", methods=["POST"])
@login_required
def goal_review(xid):
    f = request.form
    db().execute("INSERT INTO goal_reviews (goal_id,date,progress,note,reviewer,created) VALUES (?,?,?,?,?,?)",
                 (xid, iso(f.get("date")) or date.today().isoformat(), f.get("progress", ""), f.get("note", "").strip(),
                  session.get("name"), now()))
    if f.get("progress") in ("達成", "未達成停止"):
        db().execute("UPDATE goals SET status=?, updated=? WHERE id=?", ("達成" if f["progress"] == "達成" else "停止", now(), xid))
    elif f.get("next_review"):
        db().execute("UPDATE goals SET review_date=?, updated=? WHERE id=?", (iso(f["next_review"]), now(), xid))
    db().commit()
    return redirect(f.get("back") or url_for("goals"))


@app.route("/goals/<int:xid>/delete", methods=["POST"])
@login_required
def goal_delete(xid):
    db().execute("DELETE FROM goal_reviews WHERE goal_id=?", (xid,))
    db().execute("DELETE FROM goals WHERE id=?", (xid,))
    db().commit()
    return redirect(request.form.get("back") or url_for("goals"))


@app.route("/goals/from-icope/<int:aid>", methods=["GET", "POST"])
@login_required
def goals_from_icope(aid):
    """依六力異常面向建議自立支援目標，勾選後一次建立。"""
    a = get_assess(aid)
    c = get_client(a["client_id"])
    j = S.icope_auto(a["data"])
    tmpl = {
        "mob": ("行動／肌力平衡", "起立坐下 5 次縮短至 12 秒內，維持安全行走", "運動團體＋個別坐站運動 10 下 × 2–3 組／天",
                f"起立坐下 {a['data'].get('mob_seconds', '—')} 秒（{a['data'].get('mob_method', '')}）"),
        "cog": ("認知", "能正確說出今天的月、日（現實導向）", "認知團體；每日日曆、白板現實導向", "定向／記憶有錯誤"),
        "dep": ("情緒", "每週主動參與社交團體至少 2 次", "社交團體；安排有興趣的活動", "情緒低落或失去興趣"),
        "soc": ("日常生活自立", "在提示下自行完成能力所及的日常活動（如穿脫外套）", "自立支援：給予時間、口頭提示，不代勞", "日常生活需協助"),
        "nut": ("營養", "維持體重，三個月內不再下降", "告知護理人員追蹤；用餐觀察", "體重減輕或食慾不佳"),
        "vis": ("感官", "活動中能看清字卡、安全移動", "照明充足、字卡放大；鼓勵就醫", "視力有困難"),
        "hear": ("感官", "團體活動中能聽清楚指令並參與", "面對面溝通、座位安排", "聽力異常"),
    }
    sug = [(k, *tmpl[k]) for k, _ in S.ICOPE_ALL if k in tmpl and j.get(k) in ("異常", "需追蹤")]
    if request.method == "POST":
        n = 0
        review = add_months(a["date"], 3).isoformat()
        for k, dom, _, _, _ in sug:
            if request.form.get("use_" + k):
                db().execute("""INSERT INTO goals (client_id,domain,goal,method,baseline,start_date,review_date,status,
                    assessment_id,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                             (c["id"], dom, request.form.get("goal_" + k, ""), request.form.get("method_" + k, ""),
                              request.form.get("base_" + k, ""), a["date"], review, "進行中", aid, now(), now()))
                n += 1
        db().commit()
        flash(f"已建立 {n} 項自立支援目標（3 個月後檢討）", "ok")
        return redirect(url_for("client_view", cid=c["id"]))
    return render_template("goals_from.html", a=a, c=c, sug=sug)


# ================================================================== 報表／匯出
import exports as X  # noqa: E402


def _bundle(aid):
    a = get_assess(aid)
    c = get_client(a["client_id"])
    c["age"] = age_at(c.get("birth"), a["date"])
    return a, c


def _fname(c, a=None, kind=""):
    nm = f"{c.get('case_no') or ''}_{c['name']}"
    if a:
        label = {"D61": "職能治療評估D61", "ICOPE": "六力ICOPE評估"}[a["type"]]
        return f"{nm}_{label}_{roc(a['date'], '')}"
    return f"{nm}_{kind}"


def print_html(tpl, **kw):
    return render_template(f"print_{tpl}.html", setting=setting, **kw)


@app.route("/print/a/<int:aid>")
@login_required
def print_assess(aid):
    a, c = _bundle(aid)
    return print_html("d61" if a["type"] == "D61" else "icope", a=a, c=c, aids=client_aids(c["id"]),
                      judge=S.icope_auto(a["data"]), screen=True)


@app.route("/export/a/<int:aid>.<fmt>")
@login_required
def export_assess(aid, fmt):
    a, c = _bundle(aid)
    name = _fname(c, a)
    if fmt == "docx":
        buf = X.docx_d61(a, c, setting) if a["type"] == "D61" else X.docx_icope(a, c, setting)
        return send_file(buf, as_attachment=True, download_name=name + ".docx")
    if fmt == "pdf":
        html = print_html("d61" if a["type"] == "D61" else "icope", a=a, c=c, aids=client_aids(c["id"]),
                          judge=S.icope_auto(a["data"]), screen=False)
        return send_file(io.BytesIO(X.html_to_pdf(html)), as_attachment=True, download_name=name + ".pdf",
                         mimetype="application/pdf")
    abort(404)


def client_bundle(cid):
    c = get_client(cid)
    allas = client_assess(cid)
    d61s = [a for a in allas if a["type"] == "D61"]
    icopes = [a for a in allas if a["type"] == "ICOPE"]
    return dict(c=c, allas=allas, d61s=d61s, icopes=icopes, aids=client_aids(cid), goals=client_goals(cid),
                due=due_info(cid), trend=icope_trend(icopes), d61trend=d61_trend(d61s),
                changes=S.compare_d61(d61s[1]["data"], d61s[0]["data"]) if len(d61s) > 1 else [])


@app.route("/print/client/<int:cid>")
@login_required
def print_client(cid):
    return print_html("client", screen=True, **client_bundle(cid))


@app.route("/export/client/<int:cid>.<fmt>")
@login_required
def export_client(cid, fmt):
    b = client_bundle(cid)
    name = _fname(b["c"], kind=f"個案評估彙整_{roc(date.today(), '')}")
    if fmt == "docx":
        return send_file(X.docx_client(b, setting), as_attachment=True, download_name=name + ".docx")
    if fmt == "pdf":
        return send_file(io.BytesIO(X.html_to_pdf(print_html("client", screen=False, **b))), as_attachment=True,
                         download_name=name + ".pdf", mimetype="application/pdf")
    abort(404)


@app.route("/reports")
@login_required
def reports():
    cs = active_clients()
    return render_template("reports.html", ind=indicators(cs), cs=cs,
                           f=(date.today() - timedelta(days=365)).isoformat(), t=date.today().isoformat())


def excel_payload(f, t):
    cs = active_clients()
    allc = active_clients(None)
    sql = "SELECT a.*, c.name, c.case_no, c.birth, c.gender FROM assessments a JOIN clients c ON c.id=a.client_id WHERE a.date BETWEEN ? AND ?"
    d61 = [assess_dict(r) for r in db().execute(sql + " AND a.type='D61' ORDER BY a.date", (f, t))]
    ic = [assess_dict(r) for r in db().execute(sql + " AND a.type='ICOPE' ORDER BY a.date", (f, t))]
    aids_ = [dict(r) for r in db().execute("SELECT a.*, c.name, c.case_no FROM aids a JOIN clients c ON c.id=a.client_id WHERE c.status='在案' ORDER BY c.case_no")]
    gl = [dict(r) for r in db().execute("SELECT g.*, c.name, c.case_no FROM goals g JOIN clients c ON c.id=g.client_id ORDER BY c.case_no, g.start_date")]
    for x in gl:
        x["reviews"] = [dict(r) for r in db().execute("SELECT * FROM goal_reviews WHERE goal_id=? ORDER BY date", (x["id"],))]
    return dict(cs=cs, allc=allc, d61=d61, ic=ic, aids=aids_, goals=gl, f=f, t=t, ind=indicators(cs), center=setting("center_name"))


@app.route("/export/excel")
@login_required
def export_excel():
    f, t = iso(request.args.get("from")) or "1900-01-01", iso(request.args.get("to")) or "2999-12-31"
    buf = X.xlsx_all(excel_payload(f, t), roc, age_at)
    return send_file(buf, as_attachment=True, download_name=f"評鑑佐證總表_{roc(date.today(), '')}.xlsx")


@app.route("/print/list/<kind>")
@login_required
def print_list(kind):
    if kind not in ("aids", "goals", "roster"):
        abort(404)
    p = excel_payload("1900-01-01", "2999-12-31")
    return print_html("list", kind=kind, p=p, screen=True)


@app.route("/export/pack")
@login_required
def export_pack():
    """評鑑佐證包：Excel 總表＋每位個案的評估 PDF/Word，依指標分資料夾。"""
    f, t = iso(request.args.get("from")) or "1900-01-01", iso(request.args.get("to")) or "2999-12-31"
    fmt = request.args.get("fmt", "pdf")
    p = excel_payload(f, t)
    buf = io.BytesIO()
    root = f"評鑑佐證包_{roc(f, '')}-{roc(t, '')}"
    jobs = []  # (path, html) for pdf
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{root}/00_總表/評鑑佐證總表.xlsx", X.xlsx_all(p, roc, age_at).getvalue())
        for c in p["cs"]:
            b = client_bundle(c["id"])
            folder = f"{root}/B1_評估與再評估/{c.get('case_no') or ''}_{c['name']}"
            items = [a for a in b["allas"] if a["type"] in ("D61", "ICOPE") and f <= a["date"] <= t]
            if not items:
                continue
            for a in items:
                cc = dict(c); cc["age"] = age_at(c.get("birth"), a["date"])
                nm = f"{folder}/{_fname(cc, a)}"
                if fmt == "docx":
                    z.writestr(nm + ".docx", (X.docx_d61 if a["type"] == "D61" else X.docx_icope)(a, cc, setting).getvalue())
                else:
                    jobs.append((nm + ".pdf", print_html("d61" if a["type"] == "D61" else "icope", a=a, c=cc,
                                                         aids=b["aids"], judge=S.icope_auto(a["data"]), screen=False)))
            sm = f"{folder}/{_fname(c, kind='個案評估彙整')}"
            if fmt == "docx":
                z.writestr(sm + ".docx", X.docx_client(b, setting).getvalue())
            else:
                jobs.append((sm + ".pdf", print_html("client", screen=False, **b)))
        jobs.append((f"{root}/B9_輔具/輔具使用清單.pdf", print_html("list", kind="aids", p=p, screen=False)))
        jobs.append((f"{root}/B10_自立支援/自立支援目標追蹤表.pdf", print_html("list", kind="goals", p=p, screen=False)))
        jobs.append((f"{root}/00_總表/在案個案評估追蹤名冊.pdf", print_html("list", kind="roster", p=p, screen=False)))
        for path, pdf in X.html_to_pdf_many(jobs):
            z.writestr(path, pdf)
    buf.seek(0)
    log("匯出評鑑佐證包", root)
    db().commit()
    return send_file(buf, as_attachment=True, download_name=root + ".zip")


# ================================================================== 意見回饋
FB_KINDS = ["希望增加", "希望刪減", "操作不順／看不懂", "錯誤（壞掉）", "其他"]


@app.route("/feedback", methods=["GET", "POST"])
@login_required
def feedback():
    if request.method == "POST":
        f = request.form
        if f.get("content", "").strip():
            db().execute("INSERT INTO feedback (ts,name,role,page,kind,content) VALUES (?,?,?,?,?,?)",
                         (now(), f.get("name", "").strip()[:30], f.get("role", "")[:20], f.get("page", "")[:60],
                          f.get("kind", ""), f["content"].strip()[:2000]))
            db().commit()
            flash("謝謝您的意見！已送出", "ok")
        return redirect(url_for("feedback"))
    rows = db().execute("SELECT * FROM feedback ORDER BY id DESC").fetchall()
    return render_template("feedback.html", rows=rows, kinds=FB_KINDS, page=request.args.get("page", ""))


@app.route("/feedback/<int:xid>/status", methods=["POST"])
@login_required
def feedback_status(xid):
    db().execute("UPDATE feedback SET status=?, reply=? WHERE id=?",
                 (request.form.get("status", "未處理"), request.form.get("reply", "").strip(), xid))
    db().commit()
    return redirect(url_for("feedback"))


@app.route("/feedback.xlsx")
@login_required
def feedback_xlsx():
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active; ws.title = "意見回饋"
    ws.append(["時間", "姓名", "職稱", "頁面", "類型", "內容", "處理狀態", "回覆"])
    for r in db().execute("SELECT * FROM feedback ORDER BY id"):
        ws.append([r["ts"], r["name"], r["role"], r["page"], r["kind"], r["content"], r["status"], r["reply"]])
    for col, w in zip("ABCDEFGH", (18, 10, 10, 16, 14, 60, 10, 30)):
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return send_file(buf, as_attachment=True, download_name=f"試用意見回饋_{roc(date.today(), '')}.xlsx")


# ================================================================== 系統設定
@app.route("/settings", methods=["GET", "POST"])
@login_required
def settings():
    if request.method == "POST":
        for k in ("center_name", "supervisor", "supervisor_title", "reeval_months"):
            db().execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (k, request.form.get(k, "").strip()))
        db().commit()
        flash("設定已儲存", "ok")
        return redirect(url_for("settings"))
    users = db().execute("SELECT * FROM users ORDER BY id").fetchall()
    logs = db().execute("SELECT * FROM logs ORDER BY id DESC LIMIT 30").fetchall()
    return render_template("settings.html", s={k: setting(k) for k in DEFAULT_SETTINGS}, users=users, logs=logs)


@app.route("/settings/user", methods=["POST"])
@login_required
def user_save():
    if DEMO:
        flash("示範版不開放修改帳號", "err")
        return redirect(url_for("settings"))
    f = request.form
    if session.get("role") != "admin" and str(session.get("uid")) != f.get("id"):
        abort(403)
    if f.get("id"):
        db().execute("UPDATE users SET name=?, title=?, active=? WHERE id=?",
                     (f["name"], f.get("title", ""), 1 if f.get("active", "1") == "1" else 0, f["id"]))
        if f.get("password"):
            db().execute("UPDATE users SET pw_hash=? WHERE id=?", (generate_password_hash(f["password"]), f["id"]))
    else:
        if not f.get("username") or len(f.get("password", "")) < 4:
            flash("新帳號需填帳號，密碼至少 4 碼", "err")
            return redirect(url_for("settings"))
        db().execute("INSERT INTO users (username,name,title,pw_hash,role) VALUES (?,?,?,?,?)",
                     (f["username"].strip(), f["name"], f.get("title", ""), generate_password_hash(f["password"]), f.get("role", "staff")))
    db().commit()
    flash("帳號已更新", "ok")
    return redirect(url_for("settings"))


@app.route("/settings/import", methods=["POST"])
@login_required
def import_roster():
    if DEMO:
        flash("示範版不開放匯入名冊（避免真實資料進入示範網站）", "err")
        return redirect(url_for("settings"))
    import importer
    fs = request.files.get("file")
    path = None
    if fs and fs.filename:
        path = os.path.join(DATA_DIR, "_upload.xlsx")
        fs.save(path)
    else:
        path = importer.default_roster()
    if not path or not os.path.exists(path):
        flash("找不到名冊檔", "err")
        return redirect(url_for("settings"))
    msg = importer.run(db(), path)
    db().commit()
    flash(msg, "ok")
    return redirect(url_for("settings"))


@app.route("/settings/backup")
@login_required
def backup():
    bdir = os.path.join(DATA_DIR, "備份")
    os.makedirs(bdir, exist_ok=True)
    out = os.path.join(bdir, f"care_{datetime.now():%Y%m%d_%H%M%S}.db")
    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(out)
    src.backup(dst)
    src.close(); dst.close()
    return send_file(out, as_attachment=True, download_name=os.path.basename(out))


def auto_backup():
    """每天第一次啟動自動備份一份（保留 30 份）。"""
    bdir = os.path.join(DATA_DIR, "備份")
    os.makedirs(bdir, exist_ok=True)
    tag = f"auto_{date.today():%Y%m%d}.db"
    if os.path.exists(DB_PATH) and not os.path.exists(os.path.join(bdir, tag)):
        shutil.copy2(DB_PATH, os.path.join(bdir, tag))
    autos = sorted(x for x in os.listdir(bdir) if x.startswith("auto_"))
    for x in autos[:-30]:
        os.remove(os.path.join(bdir, x))


init_db()

if __name__ == "__main__":
    import sys
    auto_backup()
    host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 5050
    app.run(host=host, port=port, debug="--debug" in sys.argv)
