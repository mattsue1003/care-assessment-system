"""把 care99 匯出的 JSON（data/care99_export/care99_*.json）匯入正式資料庫。

用法：.venv/bin/python import_care99.py
- 個案以姓名對應；B2 有的人（含結案）都會建立
- D61 轉成本系統的 D61 評估（取代只有日期的歷史紀錄）
- 其他模組（護理、社工、照服、營養…）存進 records 表，保留全部欄位
可重複執行：以 care99 的系統 ID 判斷是否已匯入。
"""
import glob
import json
import os
import re
import sqlite3
from datetime import datetime

import modules as M
import schema as S

BASE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.join(BASE, "data", "care99_export")
DB = os.environ.get("CARE_DB") or os.path.join(BASE, "data", "care.db")
TS = datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def iso(s):
    m = re.match(r"(\d{2,4})/(\d{1,2})/(\d{1,2})", (s or "").strip())
    if not m:
        return ""
    y, mo, d = (int(x) for x in m.groups())
    return f"{y + 1911 if y < 1000 else y:04d}-{mo:02d}-{d:02d}"


def load(mod):
    p = os.path.join(EXPORT, f"care99_{mod}.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None


# D61：care99 欄位順序 → 本系統欄位
D61_ORDER = (["hobby_past", "hobby_now", "adl_help", "func", "soc_coop", "soc_motiv"]
             + ["rom_" + k for k, _ in S.SIDES] + ["mmt_" + k for k, _ in S.SIDES]
             + ["tone_ue", "tone_le", "sense_touch", "sense_hear", "sense_vision", "bpsd",
                "cog_alert", "cog_orient", "cog_attn", "cog_mem_s", "cog_mem_l", "cog_expr", "cog_comp", "cog_read", "cog_solve",
                "ot_goal", "ot_plan", "sched_am", "sched_pm", "sched_ev"])
SEC_OF = {f["key"]: s["no"] for s in S.D61 for f in s["fields"]}


def d61_data(rows):
    d = {}
    for key, r in zip(D61_ORDER, rows):
        f = S.D61_FIELDS[key]
        ans = [a.strip() for a in (r.get("ans") or "").split(",") if a.strip() and a.strip() != "N/A"]
        rem = (r.get("rem") or "").strip()
        if f["type"] == "multi":
            d[key] = [a for a in ans if a in f["options"]]
            other = [a for a in ans if a not in f["options"]]
            if other:
                d[key + "_other"] = "、".join(other)
            if rem:
                k = f"s{SEC_OF[key]}_note"
                d[k] = (d.get(k, "") + "；" if d.get(k) else "") + rem
        elif f["type"] == "radio":
            if ans:
                d[key] = ans[0]
            if rem:
                d[key + "_note"] = rem
        else:
            v = "、".join(ans)
            if rem:
                v = (v + "；" if v else "") + rem
            if v:
                d[key] = v
    return d


def ensure_tables(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, client_id INTEGER, module TEXT, date TEXT, staff TEXT,
      data TEXT, source_id TEXT, created TEXT);
    CREATE INDEX IF NOT EXISTS ix_records ON records(module, client_id, date);
    """)
    cols = [r[1] for r in con.execute("PRAGMA table_info(assessments)")]
    if "source_id" not in cols:
        con.execute("ALTER TABLE assessments ADD COLUMN source_id TEXT")


def client_map(con):
    return {r[1]: r[0] for r in con.execute("SELECT id, name FROM clients")}


def import_b2(con):
    b2 = load("B2")
    if not b2:
        return "B2 尚未匯出"
    hdr = b2["hdr"]
    ix = {h: i for i, h in enumerate(hdr)}
    added = 0
    names = client_map(con)
    for row in b2["rows"]:
        g = lambda k: row[ix[k]].strip() if k in ix and ix[k] < len(row) else ""
        name = g("姓名")
        if not name or name in names:
            continue
        st = g("狀態")
        status = "在案" if st in ("正常", "") else ("暫停" if "暫停" in st else "結案")
        con.execute("""INSERT INTO clients (case_no,name,gender,birth,services,supervisor,living,identity,phone,phone2,address,status,
            note,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (g("內部案號"), name, g("性別"), iso(g("生日")), g("現有服務"), g("主責督導"), g("居住情況"),
                     "／".join(x for x in (g("身份別"), g("收入別")) if x), g("電話(主)"), g("電話(次)"),
                     g("完整通訊地址"), status, f"care99 狀態：{st}", TS, TS))
        names[name] = con.execute("SELECT last_insert_rowid()").fetchone()[0]
        added += 1
    return f"B2 新增個案 {added} 位（care99 共 {len(b2['rows'])} 位）"


def import_d61(con):
    d61 = load("D61")
    if not d61:
        return "D61 尚未匯出"
    names = client_map(con)
    n = skip = 0
    for r in d61:
        cid = names.get(r["name"])
        if not cid:
            skip += 1
            continue
        if con.execute("SELECT 1 FROM assessments WHERE source_id=?", ("care99:" + r["id"],)).fetchone():
            continue
        date = iso(r["date"])
        # 取代同日只有日期的歷史紀錄
        con.execute("DELETE FROM assessments WHERE client_id=? AND type='D61_HIST' AND date=?", (cid, date))
        exists = con.execute("SELECT id FROM assessments WHERE client_id=? AND type='D61' AND date=?", (cid, date)).fetchone()
        if exists:  # 本系統已有同日 D61（例如已手動輸入）就不覆蓋
            con.execute("UPDATE assessments SET source_id=?, keyed=1 WHERE id=?", ("care99:" + r["id"], exists[0]))
            continue
        con.execute("""INSERT INTO assessments (client_id,type,date,assessor,kind,data,summary,note,next_due,keyed,created,updated,source_id)
            VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)""", (cid, "D61", date, r["member"], "care99 匯入", json.dumps(d61_data(r["rows"]), ensure_ascii=False),
                                                   r.get("overall", ""), r.get("remark", ""), "", TS, TS, "care99:" + r["id"]))
        n += 1
    return f"D61 匯入 {n} 筆（對不到個案 {skip} 筆）"


def import_generic(con, mod):
    """其他模組：每列（含明細）存成一筆 records，欄位名稱保留 care99 原名。"""
    j = load(mod)
    if not j:
        return None
    names = client_map(con)
    hdr = j["hdr"]
    dets = {tuple(d["row"]): d.get("fv") for d in j.get("details", [])}
    name_cols = [i for i, h in enumerate(hdr) if h in ("姓名", "使用者", "評估對象", "訪視對象")]
    date_cols = [i for i, h in enumerate(hdr) if h in ("日期", "評估日期", "訪視日期", "開始日期")]
    staff_cols = [i for i, h in enumerate(hdr) if h in ("評估人員", "訪視人員", "填表人", "記錄人", "主持人")]
    con.execute("DELETE FROM records WHERE module=?", (mod,))
    n = 0
    for row in j["rows"]:
        rec = {h: v for h, v in zip(hdr, row) if h and v}
        fv = dets.get(tuple(row))
        if fv:
            rec["_detail"] = fv
        name = row[name_cols[0]] if name_cols else ""
        cid = names.get(name.strip()) if name else None
        date = iso(row[date_cols[0]]) if date_cols else ""
        staff = row[staff_cols[0]] if staff_cols else ""
        con.execute("INSERT INTO records (client_id,module,date,staff,data,source_id,created) VALUES (?,?,?,?,?,?,?)",
                    (cid, mod, date, staff, json.dumps(rec, ensure_ascii=False), "", TS))
        n += 1
    return f"{mod} {n} 筆"


def import_daily(con):
    """D71＋D72＋D75 → 今日照顧紀錄（同一人同一天合併成一筆）"""
    names = client_map(con)
    merged = {}
    for mod in ("D71", "D72", "D75"):
        j = load(mod)
        if not j:
            continue
        hdr = j["hdr"]
        for row in j["rows"]:
            rec = dict(zip(hdr, row))
            key = (rec.get("使用者", "").strip(), iso(rec.get("日期", "")))
            merged.setdefault(key, {})[mod] = rec
    con.execute("DELETE FROM records WHERE module='DAILY' AND source_id='care99'")
    n = skip = 0
    for (name, date), parts in merged.items():
        cid = names.get(name)
        if not cid or not date:
            skip += 1
            continue
        if con.execute("SELECT 1 FROM records WHERE module='DAILY' AND client_id=? AND date=?", (cid, date)).fetchone():
            continue
        d = M.from_care99(parts.get("D71"), parts.get("D72"), parts.get("D75"))
        staff = (parts.get("D75") or parts.get("D71") or {}).get("建檔", "")
        con.execute("INSERT INTO records (client_id,module,date,staff,data,source_id,created) VALUES (?,?,?,?,?,?,?)",
                    (cid, "DAILY", date, staff.split()[-1] if staff else "", json.dumps(d, ensure_ascii=False), "care99", TS))
        n += 1
    return f"今日照顧紀錄（D71+D72+D75 合併）{n} 筆，對不到個案 {skip} 筆"


MNA_Q = {"過去三個月是否因食慾": "A", "近三個月體重變化": "B", "行動力": "C", "過去三個月內曾有精神性壓力": "D", "神經精神問題": "E",
         "可獨立生活": "G", "每天服用三種以上": "H", "有褥瘡": "I", "一整天可吃幾餐": "J", "蛋白質攝取量": "K", "每天至少攝取二份": "L",
         "每天攝取多少液體": "M", "進食的形式": "N", "他們覺得自己營養": "O", "與其他同年齡": "P"}


def import_mna(con):
    j = load("D60a")
    if not j:
        return None
    names = client_map(con)
    con.execute("DELETE FROM records WHERE module='MNA' AND source_id='care99'")
    n = 0
    for det in j.get("details", []):
        row = det["row"]
        rec = dict(zip(j["hdr"], row))
        cid = names.get(rec.get("評估對象", "").strip())
        if not cid:
            continue
        d = {}
        for r in ((det.get("fv") or {}).get("grids") or {}).get("GridViewInterView", []):
            q, a = r[0], (r[1] if len(r) > 1 else "")
            rem = r[3] if len(r) > 3 else ""
            if q == "身高" and a:
                d["height"] = a
            elif q == "體重" and a:
                d["weight"] = a
            elif q.startswith("臂中圍") and rem:
                d["mac"] = rem
            elif q.startswith("小腿圍") and rem:
                d["cc"] = rem
            elif q.startswith("營養師建議") and a:
                d["advice"] = a
            else:
                for frag, k in MNA_Q.items():
                    if q.startswith(frag) and a:
                        d[k] = [x for x in a.split(",") if x] if k == "K" else a.replace("BMI＞27", "").strip()
        if rec.get("評估備註"):
            d["note"] = rec["評估備註"]
        con.execute("INSERT INTO records (client_id,module,date,staff,data,source_id,created) VALUES (?,?,?,?,?,?,?)",
                    (cid, "MNA", iso(rec.get("日期", "")), rec.get("評估人員", ""), json.dumps(d, ensure_ascii=False), "care99", TS))
        n += 1
    return f"營養評估（MNA）{n} 筆"


def import_hv(con):
    j = load("D21")
    if not j:
        return None
    names = client_map(con)
    con.execute("DELETE FROM records WHERE module='HV' AND source_id='care99'")
    n = 0
    for det in j.get("details", []):
        f = (det.get("fv") or {}).get("fields") or {}
        cid = names.get((f.get("ID_NumberX") or "").strip())
        if not cid:
            continue
        con.execute("INSERT INTO records (client_id,module,date,staff,data,source_id,created) VALUES (?,?,?,?,?,?,?)",
                    (cid, "HV", iso(f.get("Service_Date", "")), f.get("Duty_MemberX", ""), json.dumps(M.hv_from_care99(f), ensure_ascii=False), "care99", TS))
        n += 1
    return f"社工家訪紀錄 {n} 筆"


def import_simple(con, mod, src):
    j = load(src)
    if not j:
        return None
    names = client_map(con)
    con.execute("DELETE FROM records WHERE module=? AND source_id='care99'", (mod,))
    n = 0
    for det in j.get("details", []):
        f = (det.get("fv") or {}).get("fields") or {}
        cid = names.get((f.get("ID_NumberX") or "").strip())
        if not cid:
            continue
        con.execute("INSERT INTO records (client_id,module,date,staff,data,source_id,created) VALUES (?,?,?,?,?,?,?)",
                    (cid, mod, iso(f.get("Service_Date", "")), f.get("Duty_MemberX", ""), json.dumps(M.simple_from_care99(mod, f), ensure_ascii=False), "care99", TS))
        n += 1
    return f"{M.SIMPLE[mod]['title']} {n} 筆"


def import_ms_cl(con):
    names = client_map(con)
    msgs = []
    for mod, src in (("MS", "D25"), ("CL", "D29")):
        j = load(src)
        if not j:
            continue
        con.execute("DELETE FROM records WHERE module=? AND source_id='care99'", (mod,))
        n = 0
        for det in j.get("details", []):
            f = (det.get("fv") or {}).get("fields") or {}
            cid = names.get((f.get("ID_NumberX") or "").strip())
            if not cid:
                continue
            dt = iso(f.get("Service_Date", ""))
            if mod == "MS":
                d = {"month": dt[:7], "target": [x for x in (f.get("Target") or "").split(",") if x], "desc": f.get("Service_Desc1", ""), "followup": f.get("Service_Desc2", "")}
            else:
                d = {"svc": f.get("Service_TypeX", ""), "reason": f.get("Service_Item", ""), "desc": f.get("Service_Desc1", "")}
            con.execute("INSERT INTO records (client_id,module,date,staff,data,source_id,created) VALUES (?,?,?,?,?,?,?)",
                        (cid, mod, dt, f.get("Duty_MemberX", ""), json.dumps({k: v for k, v in d.items() if v}, ensure_ascii=False), "care99", TS))
            n += 1
        msgs.append(f"{M.SIMPLE[mod]['title']} {n} 筆")
    return "、".join(msgs)


def import_ea(con):
    j = load("D63")
    if not j:
        return None
    names = client_map(con)
    con.execute("DELETE FROM records WHERE module='EA' AND source_id='care99'")
    lab = {l: k for k, l in M.EA_ITEMS}
    n = 0
    for det in j.get("details", []):
        fv = det.get("fv") or {}
        f = fv.get("fields") or {}
        cid = names.get((f.get("Name_CH") or "").strip())
        if not cid:
            continue
        d = {lab[r[0]]: r[1] for r in (fv.get("grids") or {}).get("GridView2", []) if len(r) > 1 and r[0] in lab and r[1]}
        if f.get("OverAllDesc"):
            d["desc"] = f["OverAllDesc"]
        con.execute("INSERT INTO records (client_id,module,date,staff,data,source_id,created) VALUES (?,?,?,?,?,?,?)",
                    (cid, "EA", iso(f.get("Service_Date", "")), f.get("Srv_MemberX", ""), json.dumps(d, ensure_ascii=False), "care99", TS))
        n += 1
    return f"環境適應評估 {n} 筆"


def main():
    con = sqlite3.connect(DB)
    ensure_tables(con)
    msgs = [import_b2(con), import_d61(con), import_daily(con), import_mna(con), import_hv(con), import_simple(con, "PC", "D22"), import_simple(con, "IR", "D23"), import_ms_cl(con), import_ea(con)]
    for p in sorted(glob.glob(os.path.join(EXPORT, "care99_*.json"))):
        mod = os.path.basename(p)[7:-5]
        if mod not in ("D61",):
            msgs.append(import_generic(con, mod))
    con.commit()
    con.close()
    print("\n".join(m for m in msgs if m))


if __name__ == "__main__":
    main()
