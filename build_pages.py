"""產生 GitHub Pages 網頁版需要的檔案（docs/）：表單定義、去識別化示範資料、樣式。

用法：.venv/bin/python build_pages.py
示範資料來源一律是 demo/demo.db（去識別化），不會讀取正式資料庫。
"""
import json
import os
import sqlite3

import schema as S

BASE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(BASE, "docs")
os.makedirs(DOCS, exist_ok=True)

schema = {
    "D61": S.D61, "SIDES": S.SIDES, "BPSD": S.BPSD, "FUNC": S.FUNC, "PLANS": S.PLANS,
    "ICOPE_DOMAINS": S.ICOPE_DOMAINS, "ICOPE_FOLLOW": S.ICOPE_FOLLOW, "ICOPE_ALL": S.ICOPE_ALL,
    "SUGGEST": S.SUGGEST, "ICOPE_PLAN_MAP": S.ICOPE_PLAN_MAP, "ICOPE_Q": S.ICOPE_Q,
}
with open(os.path.join(DOCS, "schema.js"), "w", encoding="utf-8") as fh:
    fh.write("// 自動產生（build_pages.py），請勿手動修改\nwindow.SCHEMA = " + json.dumps(schema, ensure_ascii=False) + ";\n")

con = sqlite3.connect(os.path.join(BASE, "demo", "demo.db"))
con.row_factory = sqlite3.Row
rows = lambda q: [dict(r) for r in con.execute(q)]
demo = {
    "clients": rows("SELECT id,case_no,name,gender,birth,services,supervisor,living,identity,phone,phone2,address,diagnosis,status,note FROM clients"),
    "assessments": [], "aids": rows("SELECT id,client_id,item,category,source,start_date,end_date,status,fit_date,train_date,check_date,note FROM aids"),
    "goals": rows("SELECT id,client_id,domain,goal,method,baseline,start_date,review_date,status,assessment_id FROM goals"),
    "reviews": rows("SELECT id,goal_id,date,progress,note,reviewer FROM goal_reviews"),
    "feedback": [],
    "settings": {r["key"]: r["value"] for r in con.execute("SELECT key,value FROM settings WHERE key!='secret'")},
}
for a in rows("SELECT id,client_id,type,date,assessor,kind,data,summary,note,next_due,keyed,updated FROM assessments"):
    a["data"] = json.loads(a["data"] or "{}")
    demo["assessments"].append(a)
demo["seq"] = 1 + max([0] + [x["id"] for k in ("clients", "assessments", "aids", "goals", "reviews") for x in demo[k]])
with open(os.path.join(DOCS, "demo-data.js"), "w", encoding="utf-8") as fh:
    fh.write("// 去識別化示範資料（由 demo/demo.db 產生）\nwindow.DEMO_DATA = " + json.dumps(demo, ensure_ascii=False) + ";\n")

with open(os.path.join(BASE, "static", "app.css"), encoding="utf-8") as fh:
    css = fh.read()
with open(os.path.join(DOCS, "app.css"), "w", encoding="utf-8") as fh:
    fh.write(css)
print(f"docs/ 已更新：個案 {len(demo['clients'])}、評估 {len(demo['assessments'])}、輔具 {len(demo['aids'])}")
