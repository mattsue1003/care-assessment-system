"""把正式資料庫轉成「去識別化示範資料庫」。

用法：.venv/bin/python make_demo.py [來源 data/care.db] [輸出 demo/demo.db]

去識別化方式：
- 姓名改為隨機假名、案號重編（D001…）
- 出生日期隨機偏移 ±2 年；每位個案的評估／輔具／目標日期另外整體偏移 ±3 週（前後間隔不變）
- 刪除電話、地址、身份別、診斷、OT 備註；督導、評估者等工作人員姓名改為代稱
- 自由文字中若出現真實姓名一律替換；刪除操作紀錄、帳號、系統金鑰，最後 VACUUM 清除殘留
"""
import json
import os
import random
import re
import sqlite3
import sys
from datetime import date, timedelta

from werkzeug.security import generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "data", "care.db")
DST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(BASE, "demo", "demo.db")

SURNAMES = "陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董温唐藍石蔣古紀姚連馮歐程湯黃田康姜白汪鄒尤巫鐘黎涂龔嚴韓袁金童陸夏柳凃邵"
GIVEN = "秀玉美麗淑惠英珠雲蘭月鳳金春梅芳嬌華明志文德正國家建清榮俊仁義忠信和平安福祥順興旺水木火土松柏竹菊桂香琴珍貞雪霞燕"
rng = random.SystemRandom()


def iso_shift(s, days):
    if not s:
        return s
    try:
        y, m, d = (int(x) for x in s[:10].split("-"))
        return (date(y, m, d) + timedelta(days=days)).isoformat()
    except ValueError:
        return ""


def age_at(birth, on):
    b, o = date.fromisoformat(birth), date.fromisoformat(on)
    return o.year - b.year - ((o.month, o.day) < (b.month, b.day))


def main():
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    if os.path.exists(DST):
        os.remove(DST)
    src = sqlite3.connect(SRC)
    con = sqlite3.connect(DST)
    src.backup(con)
    src.close()
    con.row_factory = sqlite3.Row

    clients = con.execute("SELECT * FROM clients ORDER BY case_no, id").fetchall()
    real_names = {c["name"] for c in clients if c["name"]}
    staff = set()
    for q in ("SELECT DISTINCT supervisor FROM clients", "SELECT DISTINCT assessor FROM assessments",
              "SELECT DISTINCT name FROM users", "SELECT DISTINCT reviewer FROM goal_reviews",
              "SELECT value FROM settings WHERE key='supervisor'"):
        staff |= {r[0].strip() for r in con.execute(q) if r[0] and r[0].strip()}
    staff = {re.sub(r"（.*?）", "", s) for s in staff}

    used = set()
    def fake_name():
        while True:
            n = rng.choice(SURNAMES) + "".join(rng.choice(GIVEN) for _ in range(rng.choice((1, 2, 2))))
            if n not in used and n not in real_names and n not in staff:
                used.add(n)
                return n

    sup_map = {s: f"督導{'甲乙丙丁戊己庚辛'[i]}" for i, s in enumerate(sorted({c["supervisor"] for c in clients if c["supervisor"]}))}
    name_map, offsets = {}, {}
    for i, c in enumerate(clients, 1):
        nm = fake_name()
        name_map[c["name"]] = nm
        off = rng.randint(-21, 21)
        offsets[c["id"]] = off
        birth = iso_shift(c["birth"], rng.randint(-730, 730)) if c["birth"] else ""
        con.execute("""UPDATE clients SET case_no=?, name=?, birth=?, supervisor=?, phone='', phone2='', address='',
            identity='', diagnosis='', note='', created=NULL, updated=NULL WHERE id=?""",
                    (f"D{i:03d}", nm, birth, sup_map.get(c["supervisor"], ""), c["id"]))

    def scrub(text):
        if not isinstance(text, str):
            return text
        for real, fake in name_map.items():
            text = text.replace(real, fake)
        for s in staff:
            text = text.replace(s, "工作人員")
        return text

    births = {r["id"]: r["birth"] for r in con.execute("SELECT id, birth FROM clients")}
    for a in con.execute("SELECT * FROM assessments").fetchall():
        off = offsets.get(a["client_id"], 0)
        d = iso_shift(a["date"], off)
        data = json.loads(a["data"] or "{}")
        data = {k: ([scrub(x) for x in v] if isinstance(v, list) else scrub(v)) for k, v in data.items()}
        summary = scrub(a["summary"] or "")
        if births.get(a["client_id"]) and d:
            summary = re.sub(r"\d{2,3}歲", f"{age_at(births[a['client_id']], d)}歲", summary, count=1)
        con.execute("""UPDATE assessments SET date=?, next_due=?, assessor=?, data=?, summary=?, note=?, created=NULL,
            updated=? WHERE id=?""", (d, iso_shift(a["next_due"], off), "示範治療師" if a["assessor"] else "",
                                      json.dumps(data, ensure_ascii=False), summary, scrub(a["note"] or ""), d, a["id"]))
    for x in con.execute("SELECT * FROM aids").fetchall():
        off = offsets.get(x["client_id"], 0)
        con.execute("""UPDATE aids SET start_date=?, end_date=?, fit_date=?, train_date=?, check_date=?, note=?,
            created=NULL, updated=NULL WHERE id=?""", tuple(iso_shift(x[k], off) for k in
                                                            ("start_date", "end_date", "fit_date", "train_date", "check_date")) + (scrub(x["note"] or ""), x["id"]))
    for g in con.execute("SELECT * FROM goals").fetchall():
        off = offsets.get(g["client_id"], 0)
        con.execute("UPDATE goals SET start_date=?, review_date=?, goal=?, method=?, baseline=? WHERE id=?",
                    (iso_shift(g["start_date"], off), iso_shift(g["review_date"], off), scrub(g["goal"]), scrub(g["method"]),
                     scrub(g["baseline"]), g["id"]))
        for r in con.execute("SELECT * FROM goal_reviews WHERE goal_id=?", (g["id"],)).fetchall():
            con.execute("UPDATE goal_reviews SET date=?, note=?, reviewer='示範治療師' WHERE id=?",
                        (iso_shift(r["date"], off), scrub(r["note"]), r["id"]))

    con.execute("DELETE FROM logs")
    con.execute("DELETE FROM users")
    con.execute("INSERT INTO users (username,name,title,pw_hash,role) VALUES ('1111','示範治療師','職能治療師',?, 'admin')",
                (generate_password_hash("1111"),))
    con.execute("DELETE FROM settings WHERE key='secret'")
    con.execute("UPDATE settings SET value='示範日間照顧中心' WHERE key='center_name'")
    con.execute("UPDATE settings SET value='示範護理師' WHERE key='supervisor'")
    con.commit()
    con.execute("VACUUM")
    con.close()

    # 驗證：輸出檔裡不可出現任何真實姓名
    blob = open(DST, "rb").read()
    leaks = [n for n in real_names | staff if len(n) >= 2 and n.encode() in blob]
    if leaks:
        os.remove(DST)
        raise SystemExit(f"去識別化失敗，仍含真實姓名 {len(leaks)} 筆，已刪除輸出檔")
    print(f"完成：{DST}（個案 {len(clients)} 位，已確認不含真實姓名）")


if __name__ == "__main__":
    main()
