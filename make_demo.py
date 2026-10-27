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

    fam_names = set()
    if con.execute("SELECT name FROM sqlite_master WHERE name='records'").fetchone():
        for (data,) in con.execute("SELECT data FROM records"):
            for m in re.finditer(r"([\u4e00-\u9fff]{2,4})\s*[/／-]\s*(案|配偶|母|父|女|子|妻|夫|媳|孫|兄|弟|姊|姐|妹|前妻|外傭|看護)", data):
                fam_names.add(m.group(1))
    for (p2,) in con.execute("SELECT phone2 FROM clients"):
        for m in re.finditer(r"/([\u4e00-\u9fff]{2,4})/", p2 or ""):
            fam_names.add(m.group(1))
    fam_names = {n for n in fam_names if not n.startswith("案") and not re.search(r"(配偶|家屬|本人|其他|服務員|照顧|同住|外傭|看護|司機)", n)}
    staff |= fam_names

    used = set()
    def fake_name():
        while True:
            n = rng.choice(SURNAMES) + "".join(rng.choice(GIVEN) for _ in range(rng.choice((1, 2, 2))))
            if n not in used and not any(x in n or n in x for x in real_names | staff if len(x) >= 2):
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

    # ---- 跨專業紀錄：只保留本系統格式（今日照顧、營養、家訪、電訪、異常事件），自由文字改成產生的示範文字 ----
    import modules as M
    import schema as S
    has_rec = con.execute("SELECT name FROM sqlite_master WHERE name='records'").fetchone()
    if has_rec:
        con.execute("DELETE FROM records WHERE module NOT IN ('DAILY','MNA','HV','PC','IR','MS','CL','EA')")
        rels = ["案子", "案女", "案妻", "案夫", "案媳", "案孫"]
        fake_fam = lambda: fake_name() + "/" + rng.choice(rels)
        PC_TXT = {"定期電訪": "電聯家屬了解案主近況，表示在家生活作息正常，無特殊狀況。", "請假追蹤": "家屬表示案主身體不適，今日請假在家休息。",
                  "出勤調查": "詢問家屬下週出勤安排，家屬表示照常到中心。", "服務異動通知": "通知家屬中心服務異動事宜，家屬表示了解。"}
        IR_TXT = {"身體狀況異常": "案主今早至中心量測血壓偏高，詢問無不適，持續觀察並追蹤。", "跌倒": "案主於中心行走時不慎跌倒，評估無明顯外傷。"}
        for rid, cid, mod, dt, data in con.execute("SELECT id, client_id, module, date, data FROM records").fetchall():
            d = json.loads(data)
            off = offsets.get(cid, 0)
            if mod == "DAILY":
                if d.get("note"):
                    d["note"] = scrub(d["note"])
            elif mod == "MNA":
                d.pop("note", None)
            elif mod == "HV":
                age = age_at(births[cid], iso_shift(dt, off)) if births.get(cid) and dt else ""
                g = con.execute("SELECT gender FROM clients WHERE id=?", (cid,)).fetchone()[0]
                d = {k: d[k] for k in ("target", "items", "problems", "days", "codes") + tuple(f"cause_{i}" for i in range(5)) if d.get(k)}
                d.update({"family_member": fake_fam(), "process": "案主規律至日照中心接受服務，整體適應良好。",
                          "basic": f"{age}歲{ {'男': '男性', '女': '女性'}.get(g, '')}，長照福利身分別為一般戶，常用語言為國語及台語。",
                          "family": rng.choice(["與配偶同住，子女假日返家探視，主要照顧者為配偶。", "與子女同住，主要照顧者為案子，白天需上班。", "與案女同住，案女為主要照顧者。"]),
                          "health": rng.choice(["有高血壓病史，規律服藥並固定回診。", "有糖尿病及高血壓病史，固定於醫院回診。", "曾有跌倒經驗，目前行走使用助行器。"]),
                          "living": rng.choice(["居住於透天厝，臥室位於一樓，浴室已設置扶手及防滑墊。", "居住於公寓二樓，有電梯，居家環境整潔。"]),
                          "economy": rng.choice(M.HV_ECONOMY), "social": rng.choice(["平日多在家中看電視，規律至日照中心參與活動。", "喜歡與人聊天，於中心參與團體活動意願高。"])})
                d["conclusion"] = M.hv_conclusion(d)
            elif mod in ("PC", "IR"):
                keep = {k: d[k] for k in ("time", "mode", "target", "items", "kind", "notify") if d.get(k)}
                if mod == "PC":
                    keep["desc"] = next((PC_TXT[i] for i in d.get("items", []) if i in PC_TXT), PC_TXT["定期電訪"])
                    keep["followup"] = "持續追蹤。"
                else:
                    keep["desc"] = next((IR_TXT[i] for i in d.get("kind", []) if i in IR_TXT), "案主於中心出現身體不適，經觀察後狀況穩定。")
                    keep["handling"] = "已通知家屬，持續監測生命徵象。"
                    keep["followup"] = "隔日電聯家屬追蹤。"
                if d.get("family"):
                    keep["family"] = fake_fam()
                d = keep
            elif mod in ("MS", "CL"):
                d = {k: d[k] for k in ("target", "svc", "reason") if d.get(k)}
            elif mod == "EA":
                d = {k: d[k] for k, _ in M.EA_ITEMS if d.get(k)}
                d["desc"] = M.adapt_summary(d)
            con.execute("UPDATE records SET date=?, staff='示範人員', data=?, source_id='', created=NULL WHERE id=?",
                        (iso_shift(dt, off), json.dumps(d, ensure_ascii=False), rid))
        # 月照顧摘要、結案：用去識別化後的每日紀錄重新產生文字
        for rid, cid, mod, dt, data in con.execute("SELECT id, client_id, module, date, data FROM records WHERE module IN ('MS','CL')").fetchall():
            d = json.loads(data)
            if mod == "MS":
                ym = dt[:7]
                daily = [json.loads(x[0]) for x in con.execute("SELECT data FROM records WHERE module='DAILY' AND client_id=? AND date LIKE ?", (cid, ym + "%"))]
                d["month"] = ym
                d["desc"] = M.month_summary(daily) if daily else "案主本月規律至中心參與活動，精神及情緒穩定。"
                d["followup"] = "持續觀察並紀錄。"
            else:
                d["desc"] = M.closure_stats("—", dt, 0, 0, 0)
            con.execute("UPDATE records SET data=? WHERE id=?", (json.dumps(d, ensure_ascii=False), rid))
    # D61：整體評估建議改用系統依勾選產生的文字（原文可能含家屬、病史細節）
    for aid, cid, dt, data in con.execute("SELECT id, client_id, date, data FROM assessments WHERE type='D61'").fetchall():
        d = json.loads(data or "{}")
        d = {k: (scrub(v) if isinstance(v, str) else v) for k, v in d.items()}
        crow = con.execute("SELECT gender, birth FROM clients WHERE id=?", (cid,)).fetchone()
        c = {"gender": crow[0], "age": age_at(crow[1], dt) if crow[1] and dt else None}
        con.execute("UPDATE assessments SET data=?, summary=? WHERE id=?",
                    (json.dumps(d, ensure_ascii=False), S.d61_narrative(c, d), aid))
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
    leaks = [n for n in real_names | staff if len(n) >= 2 and n.encode() in blob and n not in ("家屬", "本人", "其他")]
    if leaks:
        dump = "\n".join(sqlite3.connect(DST).iterdump())
        for n in leaks:
            i = dump.find(n)
            print("LEAK", n, "…", dump[max(0, i - 60):i + 20].replace("\n", " "))
        os.remove(DST)
        raise SystemExit(f"去識別化失敗，仍含真實姓名 {len(leaks)} 筆，已刪除輸出檔")
    print(f"完成：{DST}（個案 {len(clients)} 位，已確認不含真實姓名）")


if __name__ == "__main__":
    main()
