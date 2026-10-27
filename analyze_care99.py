"""分析 care99 匯出資料中「重複輸入的文字」，找出適合做成選項或文字範本的欄位。

用法：.venv/bin/python analyze_care99.py > data/care99_export/重複文字分析.txt
"""
import collections
import glob
import json
import os
import re

EXPORT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "care99_export")
SKIP = re.compile(r"^(Company_ID|DC_|MD_|Data_ID|Person_ID|Service_No|Temp_Code|lbDataCount|CountMX|.*_ID$|.*Member$|ID_Number)")
SKIP_COLS = {"", "檢視", "編輯", "刪除", "功能", "建檔", "異動", "修改", "修改日", "建檔日", "使用者", "姓名", "評估對象", "訪視對象", "日期",
             "評估日期", "訪視日期", "時間", "案號", "內部案號", "生日", "電話(主)", "電話(次)", "完整通訊地址", "身份證號", "行動電話1", "行動電話2",
             "EMail", "通訊地址", "審核", "人"}


def report(mod, field, values):
    vals = [v.strip() for v in values if v and v.strip() and v.strip() not in ("N/A", "-", "無")]
    if len(vals) < 5:
        return
    c = collections.Counter(vals)
    distinct, top = len(c), c.most_common(12)
    rep = sum(n for _, n in c.items() if n > 1)
    if rep / len(vals) < 0.3 or distinct <= 1:
        return
    kind = "選項" if distinct <= 15 else "文字範本"
    print(f"\n[{mod}] {field}　填寫 {len(vals)} 次／不同內容 {distinct} 種／重複輸入占 {rep * 100 // len(vals)}% → 建議做成{kind}")
    for v, n in top:
        if n > 1:
            print(f"    {n:>5}  {v[:70]}")


for p in sorted(glob.glob(os.path.join(EXPORT, "care99_*.json"))):
    mod = os.path.basename(p)[7:-5]
    j = json.load(open(p, encoding="utf-8"))
    if mod == "D61":
        continue
    print(f"\n==================== {mod}：{len(j['rows'])} 列／明細 {len(j.get('details', []))} 筆 ====================")
    hdr = j["hdr"]
    for i, h in enumerate(hdr):
        if h in SKIP_COLS:
            continue
        report(mod, "列表：" + h, [r[i] for r in j["rows"] if i < len(r)])
    fields = collections.defaultdict(list)
    for d in j.get("details", []):
        fv = d.get("fv") or {}
        for k, v in (fv.get("fields") or {}).items():
            if not SKIP.match(k):
                fields[k].append(v)
        for k, v in (fv.get("checks") or {}).items():
            fields["勾選:" + k].append("、".join(v))
        for g, rows in (fv.get("grids") or {}).items():
            for r in rows:
                if len(r) >= 2:
                    fields[f"{g}:{r[0][:20]}"].append(" | ".join(r[1:]))
    for k, vals in fields.items():
        report(mod, "明細：" + k, vals)
