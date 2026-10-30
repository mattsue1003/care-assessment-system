"""跨專業紀錄模組定義（照服員每日照顧、營養評估…）。

選項依 care99 實際兩季紀錄（115/04–09，約 3,300 筆／模組）整理：
- 「今日照顧紀錄」合併 care99 的 D71 生命徵象、D72 如廁、D75 照顧紀錄，一人一列批次登打
- 呼吸、體重在 care99 幾乎都是 0（沒量）→ 改為選填；「個別化」3,344 筆全為未記錄 → 改選填
"""
import re

DAILY_FIELDS = [
    # key, label, type, options, group
    ("time", "時間", "time", None, "生命徵象"),
    ("temp", "體溫", "num", None, "生命徵象"),
    ("pulse", "脈搏", "num", None, "生命徵象"),
    ("sbp", "收縮壓", "num", None, "生命徵象"),
    ("dbp", "舒張壓", "num", None, "生命徵象"),
    ("bp2", "複測血壓", "text", None, "生命徵象"),
    ("weight", "體重", "num", None, "每月量測"),
    ("mac", "臂中圍", "num", None, "每月量測"),   # 護理師 10/30 意見：無法量體重的長輩改量臂中圍、小腿圍（公分），每月一次
    ("cc", "小腿圍", "num", None, "每月量測"),
    ("stool", "大便", "sel", ["無", "1次", "2次", "3次以上"], "如廁"),
    ("urine", "小便", "sel", ["無", "1次", "2次", "3次", "4次", "5次", "6次", "7次以上"], "如廁"),
    ("mental", "精神", "sel", ["好", "普通", "疲倦", "嗜睡"], "照顧"),
    ("mood", "情緒", "sel", ["愉快", "沮喪", "焦慮不安", "易發怒"], "照顧"),
    ("activity", "活動", "sel", ["認真參與", "部分參與", "未參與"], "照顧"),
    ("eat_help", "進食協助", "sel", ["自行", "部份協助", "完全協助", "未記錄"], "照顧"),
    ("eat_amt", "進食量", "sel", ["全部吃完", "吃完8分", "吃完5分", "吃完3分", "未進食", "未記錄"], "照顧"),
    ("brush", "刷牙", "sel", ["自行", "部份協助", "拒絕", "未記錄"], "照顧"),
    ("nap", "午休", "sel", ["臥床休息", "坐椅休息", "遊走", "沒睡", "未記錄"], "照顧"),
    ("water_help", "飲水協助", "sel", ["自行", "部份協助", "未記錄"], "照顧"),
    ("water_amt", "飲水量", "sel", ["0-250", "250-500", "500-750", "750-1000", "1000-1500", "1500以上", "未記錄"], "照顧"),
    ("note", "備註／異常", "text", None, "照顧"),
]
DAILY_KEYS = [f[0] for f in DAILY_FIELDS]
DAILY_DEFAULT = {"stool": "無", "urine": "5次", "mental": "好", "mood": "愉快", "activity": "認真參與", "eat_help": "部份協助",
                 "eat_amt": "全部吃完", "brush": "自行", "nap": "臥床休息", "water_help": "部份協助", "water_amt": "750-1000"}
DAILY_NOTE_TPL = ["請假未到", "提早離開", "複測血壓", "體溫偏高，已通知護理師", "跌倒，已通知護理師與家屬", "拒絕刷牙", "食慾不佳", "腹瀉", "便祕"]


def daily_alerts(d):
    """回傳異常提示（需通知護理師）"""
    out = []
    num = lambda k: float(d[k]) if re.match(r"^\d+(\.\d+)?$", str(d.get(k) or "")) else None
    t, p, s, di = num("temp"), num("pulse"), num("sbp"), num("dbp")
    if t is not None and t >= 37.5:
        out.append(f"體溫 {t:g}")
    if s is not None and (s >= 160 or s < 90):
        out.append(f"收縮壓 {s:g}")
    if di is not None and di >= 100:
        out.append(f"舒張壓 {di:g}")
    if p is not None and (p > 100 or p < 50):
        out.append(f"脈搏 {p:g}")
    if d.get("mood") in ("焦慮不安", "易發怒"):
        out.append("情緒" + d["mood"])
    if d.get("eat_amt") in ("吃完3分", "未進食"):
        out.append("進食" + d["eat_amt"])
    m, c = num("mac"), num("cc")
    if m is not None and m < 21:
        out.append(f"臂中圍 {m:g} 偏低")
    if c is not None and c < 31:
        out.append(f"小腿圍 {c:g} 偏低")
    if d.get("stool") in ("3次以上",):
        out.append("大便 3 次以上")
    return out


# ---------- care99 → 今日照顧紀錄 ----------
def _split2(v):
    a = [x.strip() for x in (v or "").split("/")]
    return (a + ["", ""])[:2]


def from_care99(d71=None, d72=None, d75=None):
    """各為 {欄名: 值}；回傳 DAILY data"""
    o = {}
    if d71:
        o["time"] = d71.get("時間", "")
        for k, c in (("temp", "體溫"), ("pulse", "脈搏"), ("weight", "體重")):
            v = d71.get(c, "")
            if v and v != "0":
                o[k] = v
        s, di = _split2(d71.get("收縮壓/舒張壓"))
        if s and s != "0":
            o["sbp"], o["dbp"] = s, di
        if d71.get("備註"):
            o["bp2"] = d71["備註"]
    if d72:
        o["stool"] = {"無": "無", "1次": "1次", "2次": "2次"}.get(d72.get("大便", ""), "3次以上" if d72.get("大便") else "")
        o["urine"] = d72.get("小便", "")
        if d72.get("異常備註"):
            o["note"] = d72["異常備註"]
    if d75:
        o["mental"], o["mood"], o["activity"] = d75.get("精神狀況", ""), d75.get("情緒表現", ""), d75.get("活動表現", "")
        o["eat_help"], o["eat_amt"] = _split2(d75.get("進食"))
        o["water_help"], o["water_amt"] = _split2(d75.get("飲水"))
        o["brush"], o["nap"] = d75.get("刷牙", ""), d75.get("午休", "")
        extra = "；".join(x for x in (d75.get("其他"), d75.get("備註")) if x and x != "未記錄")
        if extra:
            o["note"] = (o.get("note", "") + "；" if o.get("note") else "") + extra
    return {k: v for k, v in o.items() if v}


# ---------- 營養評估（MNA，care99 D60a；選項與分數依中心 130 筆實際紀錄） ----------
MNA_SCREEN = [
    ("A", "過去三個月是否因食慾不佳、消化問題、咀嚼或吞嚥困難致進食量越來越少？", [("嚴重食慾不佳", 0), ("中度食慾不佳", 1), ("食慾無變化", 2)]),
    ("B", "近三個月體重變化？", [("體重減輕＞3公斤", 0), ("不知道", 1), ("體重減輕1-3公斤", 2), ("體重無變化", 3)]),
    ("C", "行動力？", [("臥床或輪椅", 0), ("可下床活動或離開輪椅但無法自由走動", 1), ("可以自由走動", 2)]),
    ("D", "過去三個月內曾有精神性壓力或急性疾病發作？", [("是", 0), ("否", 2)]),
    ("E", "神經精神問題？", [("嚴重失智或抑鬱", 0), ("輕度失智", 1), ("無精神問題", 2)]),
]  # F：BMI 由身高體重自動計分
MNA_FULL = [
    ("G", "可獨立生活（非住護理之家或醫院）", [("否", 0), ("是", 1)]),
    ("H", "每天服用三種以上的處方藥物", [("是", 0), ("否", 1)]),
    ("I", "有褥瘡或皮膚潰瘍", [("是", 0), ("否", 1)]),
    ("J", "一整天可吃幾餐完整的餐食", [("一餐", 0), ("兩餐", 1), ("三餐", 2)]),
    ("K", "蛋白質攝取量（勾選符合項目）", "protein"),
    ("L", "每天至少攝取二份或以上的蔬菜或水果", [("否", 0), ("是", 1)]),
    ("M", "每天攝取多少液體（一杯約 240 c.c.）", [("少於三杯", 0), ("3~5杯", 0.5), ("大於5杯", 1)]),
    ("N", "進食的形式", [("無人協助則無法進食", 0), ("可以自己進食但較吃力", 1), ("可以自己進食", 2)]),
    ("O", "他們覺得自己營養方面有沒有問題？", [("覺得自己營養非常不好", 0), ("不太清楚或營養不太好", 1), ("覺得自己沒有營養問題", 2)]),
    ("P", "與其他同年齡的人比較，他們認為自己的健康狀況如何？", [("不如同年齡的人", 0), ("不知道", 0.5), ("和同年齡的人差不多", 1), ("比同年齡的人好", 2)]),
]  # Q：臂中圍、R：小腿圍 由實測公分自動計分
PROTEIN = ["每天至少攝取一份乳製品", "每週攝取兩份以上的豆或蛋類", "每天均吃些肉類、魚、雞鴨類"]
DIET_TEXTURE = ["普通飲食", "一般軟質飲食", "軟質飲食", "細碎飲食", "剪碎飲食", "半流質飲食", "管灌飲食"]


def bmi_band(h, w):
    """中心使用的 BMI 計分：≦18.5=0、18.5–24=1、24–27=2、＞27=3"""
    try:
        b = round(float(w) / (float(h) / 100) ** 2, 1)
    except (TypeError, ValueError, ZeroDivisionError):
        return None, None, ""
    sc = 0 if b <= 18.5 else 1 if b <= 24 else 2 if b <= 27 else 3
    return b, sc, ("體位過輕" if b < 18.5 else "體位正常" if b < 24 else "體位過重" if b < 27 else "肥胖")


def mna_score(d):
    """回傳 (篩檢分 /14, 完整評估小計 /16 或 None, 合計 /30 或 None, BMI, 判讀)"""
    def pick(key, opts):
        return dict(opts).get(d.get(key), 0)
    s = sum(pick(k, o) for k, _, o in MNA_SCREEN)
    b, bsc, bl = bmi_band(d.get("height"), d.get("weight"))
    s += bsc or 0
    full = None
    if any(d.get(k) for k, _, _ in MNA_FULL) or d.get("mac") or d.get("cc"):
        f = 0.0
        for k, _, o in MNA_FULL:
            if o == "protein":
                n = len(d.get("K") or [])
                f += 1 if n == 3 else 0.5 if n == 2 else 0
            else:
                f += pick(k, o)
        try:
            mac = float(d.get("mac"))
            f += 1 if mac >= 22 else 0.5 if mac >= 21 else 0
        except (TypeError, ValueError):
            pass
        try:
            f += 1 if float(d.get("cc")) >= 31 else 0
        except (TypeError, ValueError):
            pass
        full = f
    total = s + full if full is not None else None
    if total is not None:
        level = "營養狀況良好" if total >= 24 else "有營養不良危險" if total >= 17 else "營養不良"
    else:
        level = "正常（≧12）" if s >= 12 else "可能營養不良，建議完成完整評估／營養師介入"
    return s, full, total, b, bl, level


def mna_advice(d):
    """營養師建議句（依中心既有寫法）"""
    b, _, bl = bmi_band(d.get("height"), d.get("weight"))
    parts = []
    if b:
        parts.append(f"BMI:{b:g}({bl})")
    tex = d.get("texture") or ""
    if tex:
        parts.append("採" + ("減重、" if bl in ("體位過重", "肥胖") and d.get("reduce") else "") + tex + (f"(蛋白質{d['protein_g']}g)" if d.get("protein_g") else ""))
    if d.get("kcal"):
        parts.append(f"一日{d['kcal']}大卡")
    port = [f"{n}{d[k]}份" for k, n in (("p_staple", "主食"), ("p_protein", "蛋白質"), ("p_veg", "蔬菜"), ("p_snack", "點心")) if d.get(k)]
    if port:
        parts.append("建議" + "、".join(port))
    if d.get("water"):
        parts.append(f"日照給水{d['water']}毫升")
    return "，".join(parts)


# ---------- 社工家訪紀錄（care99 D21）：分段＋沿用上次＋自動結論 ----------
# 依 133 筆實際家訪：48% 句子與同個案上一次完全相同；問題分析、結論多為固定句型
HV_TARGETS = ["本人", "家屬", "其他"]
HV_ITEMS = ["定期評估", "討論照顧計畫", "修正照顧計畫", "新案評估", "異常狀況追蹤", "結案評估"]
HV_SECTIONS = [  # key, 標題, 是否沿用上次
    ("process", "壹、過程與處遇", True),
    ("basic", "貳、個案摘要－個案基本資料", True),
    ("family", "　家庭狀況", True),
    ("health", "　身體狀況", True),
    ("living", "　居住狀況", True),
    ("economy", "　經濟狀況", True),
    ("social", "　社交情形", True),
    ("update", "本次訪視重點（新增）", False),
]
HV_PROBLEMS = [
    ("自我照顧能力缺失", ["因後天疾病導致", "因疾病及老化影響身體機能", "因失智症導致"]),
    ("家中照顧人力不足", ["僅兩老同住", "獨居", "子女需工作"]),
    ("跌倒高危險", ["因年邁身體機能退化及疾病導致", "因下肢無力", "曾有跌倒經驗"]),
    ("社會參與不足", ["平日多在家中少與他人互動"]),
    ("照顧者負荷高", ["主要照顧者年邁", "照顧者身體不適"]),
]
HV_ECONOMY = ["由子女供應", "退休金及子女供應", "退休金", "中低收入戶補助", "低收入戶補助", "老人年金"]
WEEKDAYS = ["一", "二", "三", "四", "五", "六"]
SERVICE_CODES = [("BB03", "日間照顧服務"), ("BB05", "日間照顧服務"), ("BB07", "日間照顧服務"), ("BB09", "日間照顧服務"),
                 ("BD03", "社區式交通接送服務"), ("GA03", "日間照顧喘息服務")]


def hv_days(days):
    days = [d for d in WEEKDAYS if d in (days or [])]
    if not days:
        return ""
    idx = [WEEKDAYS.index(d) for d in days]
    if len(days) >= 3 and idx == list(range(idx[0], idx[-1] + 1)):
        return f"周{days[0]}至周{days[-1]}"
    return "周" + "、".join(days)


def hv_conclusion(d):
    """依勾選的服務天數與代碼產生結論（中心慣用句型）"""
    codes = d.get("codes") or []
    bb = [c for c in codes if c.startswith("BB")]
    out = []
    main = []
    if bb:
        main.append(f"日間照顧服務({bb[0]})")
    if "BD03" in codes:
        main.append("社區式交通接送服務(BD03)")
    if main:
        out.append(f"持續提供{hv_days(d.get('days'))}" + "及".join(main))
    if "GA03" in codes:
        out.append("必要時提供日間照顧喘息服務(GA03)")
    if d.get("concl_extra"):
        out.append(d["concl_extra"])
    return "。".join(f"{'一二三四五六七八'[i]}、{s}" for i, s in enumerate(out)) + ("。" if out else "")


def hv_problems_text(d):
    out = []
    for i, (p, _) in enumerate(HV_PROBLEMS):
        if p in (d.get("problems") or []):
            cause = d.get(f"cause_{i}") or ""
            out.append(p + (f"/{cause}" if cause else ""))
    if d.get("problem_other"):
        out.append(d["problem_other"])
    return "；".join(f"{'一二三四五六七八'[i]}、{s}" for i, s in enumerate(out))


def hv_from_care99(fields):
    """把 care99 家訪全文切成各段（盡量），切不出來就整段放在「過程與處遇」"""
    t1 = (fields.get("Service_Desc1") or "").replace("\t", "")
    t2 = (fields.get("Service_Desc2") or "").replace("\t", "")
    d = {"target": [x for x in (fields.get("Target") or "").split(",") if x], "item_text": fields.get("Service_Item", ""),
         "family_member": fields.get("Family", "")}
    marks = [("process", r"過程與處遇[：:]?"), ("basic", r"個案基本資料[：:]?"), ("family", r"家庭狀況[：:]?"), ("health", r"身體狀況[：:]?"),
             ("living", r"居住狀況[：:]?"), ("economy", r"經濟狀況[：:]?"), ("social", r"社交情形[：:]?"), ("_problem", r"問題分析[：:]?")]
    pos = []
    for k, pat in marks:
        m = re.search(pat, t1)
        if m:
            pos.append((m.start(), m.end(), k))
    pos.sort()
    if not pos:
        d["process"] = t1.strip()
    for i, (st, en, k) in enumerate(pos):
        seg = t1[en:(pos[i + 1][0] if i + 1 < len(pos) else len(t1))].strip(" 、，。\n貳參肆壹一二三四五六七八九十（）()0123456789.")
        if k == "_problem":
            d["problem_other"] = seg
        else:
            d[k] = seg
    d["conclusion"] = re.sub(r"^[肆、\s]*結論[：:]?", "", t2).strip()
    return {k: v for k, v in d.items() if v}


# ---------- 簡易紀錄（電訪 D22、異常事件 D23）：欄位定義驅動，畫面自動產生 ----------
# 依 970 筆電訪：家屬姓名／關係手打 935 次（改下拉）、事由「定期電訪」520 次、後續「持續追蹤。」149 次
SIMPLE = {
    "PC": {"title": "電訪紀錄", "care99": "D22", "fields": [
        {"key": "time", "label": "時間", "type": "time"},
        {"key": "mode", "label": "方式", "type": "radio", "options": ["電話", "LINE", "面談", "其他"], "default": "電話"},
        {"key": "target", "label": "對象", "type": "multi", "options": ["本人", "家屬", "服務員", "其他"], "default": ["家屬"]},
        {"key": "family", "label": "聯絡家屬（姓名／關係）", "type": "family"},
        {"key": "items", "label": "事由", "type": "multi", "options": ["定期電訪", "請假追蹤", "出勤調查", "健康狀況追蹤", "服務異動通知", "費用說明", "其他"]},
        {"key": "desc", "label": "內容", "type": "textarea", "templates": [
            "電聯家屬了解案主近況，表示在家生活作息正常，無特殊狀況。", "家屬表示案主身體不適，今日請假。", "通知家屬中心服務異動事宜，家屬表示了解。",
            "家屬表示對中心服務滿意，無其他需求。"]},
        {"key": "followup", "label": "後續處理", "type": "textarea", "templates": [
            "持續追蹤。", "定期追蹤。", "持續追蹤案主狀況。", "通知司機及相關照顧人員。", "轉知護理師追蹤健康狀況。"]},
    ]},
    "IR": {"title": "異常事件紀錄", "care99": "D23", "fields": [
        {"key": "time", "label": "發生時間", "type": "time"},
        {"key": "kind", "label": "事件類型", "type": "multi", "options": ["身體狀況異常", "血壓異常", "跌倒", "嗆咳／進食異常", "抽搐／意識改變", "走失／未接到", "服務異常", "其他"]},
        {"key": "target", "label": "相關對象", "type": "multi", "options": ["本人", "家屬", "服務員", "其他"], "default": ["本人", "家屬"]},
        {"key": "family", "label": "聯絡家屬（姓名／關係）", "type": "family"},
        {"key": "desc", "label": "事件經過", "type": "textarea", "templates": ["案主今早至中心量測血壓偏高，詢問無不適，持續觀察並追蹤。",
            "案主於中心行走時不慎跌倒，評估無明顯外傷。"]},
        {"key": "notify", "label": "已通知", "type": "multi", "options": ["家屬", "護理師", "社工", "主管", "司機", "119", "A 單位個管師"]},
        {"key": "sent", "label": "是否送醫（B6）", "type": "radio", "options": ["否", "119 送醫", "中心協助送醫", "家屬帶回就醫"], "default": "否"},
        {"key": "family_time", "label": "聯繫家屬時間（B6 即時聯繫）", "type": "time"},
        {"key": "handling", "label": "處置", "type": "textarea", "templates": ["持續監測生命徵象。", "協助送醫。", "請家屬帶回就醫。", "已通知家屬，家屬表示會帶回就醫。"]},
        {"key": "followup", "label": "後續追蹤", "type": "textarea", "templates": ["持續追蹤。", "隔日電聯家屬追蹤就醫結果。", "提醒照服員加強觀察。"]},
    ]},
}


def simple_from_care99(mod, fields):
    """care99 D22／D23 明細 → 本系統欄位"""
    f = fields
    d = {"time": f.get("Service_Time1", ""), "target": [x for x in (f.get("Target") or "").split(",") if x],
         "family": f.get("Family") or f.get("Other1") or "", "desc": f.get("Service_Desc1", ""), "followup": f.get("Service_Desc2", "")}
    items = [x for x in (f.get("Service_Item") or "").split(",") if x]
    if mod == "PC":
        d["mode"] = {"電話": "電話", "OUT": "其他"}.get(f.get("Service_Cls2", ""), "其他")
        opts = SIMPLE["PC"]["fields"][4]["options"]
        d["items"] = [x for x in items if x in opts] or (["其他"] if items else [])
        if any(x not in opts for x in items):
            d["desc"] = "【" + "、".join(x for x in items if x not in opts) + "】" + d["desc"]
    else:
        d["kind"] = ["身體狀況異常"] if any("身體" in x or "不適" in x for x in items) else (["跌倒"] if any("跌倒" in x for x in items) else ["其他"])
        if items:
            d["desc"] = "【" + "、".join(items) + "】" + d["desc"]
        d["handling"] = d.pop("followup")
    return {k: v for k, v in d.items() if v}


def family_options(client, past_values):
    """聯絡家屬下拉：個案資料「電話（次）」＋過去紀錄中出現過的"""
    out = []
    for part in re.split(r"\s+", client.get("phone2") or ""):
        bits = part.split("/")
        if len(bits) >= 3:
            out.append(f"{bits[1]}/{bits[2]}")
    for v in past_values:
        if v and v not in out:
            out.append(v)
    return out[:8]


# ---------- 月照顧摘要（取代 care99 D25「其他日常」月底照顧紀錄）：由每日照顧紀錄自動產生草稿 ----------
def _most(rows, k):
    import collections
    c = collections.Counter(r.get(k) for r in rows if r.get(k) and r.get(k) != "未記錄")
    return [v for v, _ in c.most_common(2)]


def _rng(vals):
    vals = [v for v in vals if v is not None]
    return (min(vals), max(vals)) if vals else None


def month_summary(daily, irs=(), pcs=(), weekdays=""):
    """daily: 該月 DAILY data 清單；irs/pcs: 該月異常事件／電訪 data 清單"""
    num = lambda r, k: float(r[k]) if re.match(r"^\d+(\.\d+)?$", str(r.get(k) or "")) else None
    present = [r for r in daily if not r.get("absent")]
    out = []
    out.append(f"案主{('規律' + weekdays + '至') if weekdays else '至'}中心接受照顧及參與活動，本月出席 {len(present)} 天"
               + (f"、請假 {len(daily) - len(present)} 天" if len(daily) > len(present) else "") + "。")
    t = _rng([num(r, "temp") for r in present]); s = _rng([num(r, "sbp") for r in present]); d = _rng([num(r, "dbp") for r in present])
    p = _rng([num(r, "pulse") for r in present])
    vit = []
    if t:
        vit.append(f"體溫介於 {t[0]:g}–{t[1]:g}℃")
    if s and d:
        vit.append(f"血壓介於 {s[0]:g}–{s[1]:g}／{d[0]:g}–{d[1]:g} mmHg")
    if p:
        vit.append(f"脈搏 {p[0]:g}–{p[1]:g} 次/分")
    if vit:
        out.append("量測生命徵象" + "，".join(vit) + "。")
    meas = [r for r in present if r.get("weight") or r.get("mac") or r.get("cc")]
    if meas:
        r = meas[-1]
        parts = [f"{l} {r[k]} {u}" for k, l, u in (("weight", "體重", "kg"), ("mac", "臂中圍", "cm"), ("cc", "小腿圍", "cm")) if r.get(k)]
        out.append("本月量測：" + "、".join(parts) + "。")
    alerts = sum(1 for r in present if daily_alerts(r))
    if alerts:
        out.append(f"本月有 {alerts} 天生命徵象或狀況異常，已通知護理師追蹤。")
    act = _most(present, "activity")
    if act:
        out.append(f"活動參與多為{'、'.join(act)}。")
    eat = [f"{a}{'、' + b if b else ''}" for a, b in zip(_most(present, "eat_help")[:1], (_most(present, "eat_amt") + [""])[:1])]
    water = _most(present, "water_amt")
    if eat or water:
        out.append("飲食多為" + "".join(eat) + (f"；飲水約 {water[0]} c.c." if water else "") + "。")
    mood, mental = _most(present, "mood"), _most(present, "mental")
    if mood or mental:
        out.append(f"精神多為{'、'.join(mental)}，情緒多為{'、'.join(mood)}。")
    for r in irs:
        out.append("異常事件：" + "、".join(r.get("kind") or []) + "。" + (r.get("desc") or "")[:60])
    if pcs:
        out.append(f"本月電訪家屬 {len(pcs)} 次。")
    return "\n".join(f"{i + 1}.{x}" for i, x in enumerate(out))


SIMPLE["MS"] = {"title": "月照顧摘要", "care99": "D25", "fields": [
    {"key": "month", "label": "月份", "type": "month"},
    {"key": "target", "label": "對象", "type": "multi", "options": ["本人", "家屬", "服務員"], "default": ["本人", "服務員"]},
    {"key": "desc", "label": "照顧摘要（依每日照顧紀錄自動產生，可修改）", "type": "textarea", "auto": "month_summary"},
    {"key": "followup", "label": "後續", "type": "textarea", "templates": ["持續觀察並紀錄。", "依職能治療評估建議持續安排團體活動。", "依營養評估建議提供餐點。"]},
]}
SIMPLE["CL"] = {"title": "結案紀錄", "care99": "D29", "fields": [
    {"key": "svc", "label": "服務類別", "type": "radio", "options": ["日照", "喘息"], "default": "日照"},
    {"key": "reason", "label": "結案原因", "type": "radio", "options": ["無服務使用意願", "聘僱外籍看護照顧", "入住安養護機構", "案主過世",
                                                                  "暫停服務超過三個月以上", "遷居他縣市", "轉介其他服務", "其他"]},
    {"key": "desc", "label": "說明（服務起訖與家訪、電訪、申訴次數會自動帶入）", "type": "textarea", "auto": "closure_stats"},
]}


def closure_stats(first_date, last_date, n_hv, n_pc, n_ir):
    return f"1.服務開始：{first_date}\n2.服務結束：{last_date}\n3.家訪次數：{n_hv}次\n4.電訪次數：{n_pc}次\n5.異常事件：{n_ir}次\n6.申訴次數：0次"


# care99 明細欄位代號 → 中文（歷史紀錄檢視用）
FIELD_LABELS = {
    "Service_Date": "日期", "Service_Time1": "開始時間", "Service_Time2": "結束時間", "Duty_MemberX": "社工／督導／人員", "Srv_MemberX": "記錄人",
    "Target": "對象", "Family": "家屬", "Service_Item": "事由", "Service_Desc1": "內容", "Service_Desc2": "後續處理", "Service_Cls2": "方式",
    "Other_People": "其他人員", "DayCarePlan": "照顧計畫", "Remark": "備註", "OverAllDesc": "整體評估建議", "Coach_Type": "督導類型",
    "Coach_Date": "日期", "Coach_Place": "地點", "Coach_Type2": "方式", "Coach_Subject": "主題", "Coach_Target": "目標", "Coach_Desc": "內容",
    "Follow_Desc": "後續追蹤", "Assess_Date": "評估日期", "Need_Desc": "需求說明", "ADL": "ADL", "IADL": "IADL", "CDR": "CDR",
    "Service_TypeX": "服務類別", "Life_Type": "居住狀況", "Income_TypeX": "收入別", "Ability_LvX": "失能程度", "Pension_TypeX": "補助別",
    "Get_Date": "接案日期", "Start_Date": "開案日期", "Next_Date": "下次評估", "Close_DateX": "結案日",
}


# ---------- 環境適應評估（care99 D63）：6 項 1–5 分，整體評估建議自動產生 ----------
EA_ITEMS = [("ea_exit", "找出口、回家頻率"), ("ea_act", "活動參與頻率"), ("ea_peer", "與中心個案互動頻率"),
            ("ea_staff", "與中心同仁互動頻率"), ("ea_face", "臉部表情、言語"), ("ea_behav", "外在行為")]
SIMPLE["EA"] = {"title": "環境適應評估", "care99": "D63", "fields":
    [{"key": k, "label": l + "（5＝最好）", "type": "radio", "options": ["1", "2", "3", "4", "5"]} for k, l in EA_ITEMS]
    + [{"key": "desc", "label": "整體評估建議（依分數與近期照顧紀錄自動產生，可修改）", "type": "textarea", "auto": "adapt_summary"}]}


def adapt_summary(d, daily=(), start=""):
    sc = [int(d[k]) for k, _ in EA_ITEMS if str(d.get(k, "")).isdigit()]
    if not sc:
        return "（請先勾選 6 項分數）"
    total, avg = sum(sc), sum(sc) / len(sc)
    level = "適應良好" if avg >= 4 else "適應狀況逐漸進步" if avg >= 3 else "適應狀況待加強"
    out = [f"案主{(start + '收托') if start else ''}至今{level}（總分 {total}/{len(sc) * 5}）"]
    pres = [r for r in daily if not r.get("absent")]
    if pres:
        out.append("情緒平穩" if sum(r.get("mood") == "愉快" for r in pres) >= len(pres) * 0.7 else "情緒時有起伏")
        out.append("生命徵象穩定" if not any(daily_alerts(r) for r in pres) else "生命徵象偶有異常，持續追蹤")
        out.append("早點及午餐皆吃完" if sum(r.get("eat_amt") == "全部吃完" for r in pres) >= len(pres) * 0.7 else "進食量時有不足")
    g = lambda k: int(d.get(k) or 0)
    out.append("中心活動能主動參與" if g("ea_act") >= 4 else "中心活動經邀請後可參與" if g("ea_act") == 3 else "活動參與較被動，需多鼓勵")
    if g("ea_peer") >= 4:
        out.append("團體活動時會與其他長輩互動")
    if g("ea_exit") <= 2:
        out.append("偶有找出口、想回家情形，需加強安撫與陪伴")
    return "，".join(out) + "。"


# ================= 跨專業評估（依 115 年附件2-3 B1：生理、心理認知、家庭及社會支持；每 6 個月再評估；每季跨專業個案討論 ≥3 專業） =================
DISCIPLINES = [  # key, 名稱, 負責模組（任一完成即算該專業已評估）
    ("nurse", "護理", ["HA"]),
    ("social", "社工", ["HV"]),
    ("ot", "職能治療", ["D61", "ICOPE"]),
    ("diet", "營養", ["MNA"]),
]
PROFESSIONS = ["照顧服務", "社會工作", "護理", "職能治療", "營養", "物理治療", "主管", "家屬", "其他"]

# ---------- 護理：健康評估／慢性疾病追蹤（護理師 10/28 試用意見；兼顧 B4 入托前體檢） ----------
DISEASES = ["高血壓", "糖尿病", "高血脂", "心臟病", "中風", "失智症", "巴金森氏症", "慢性腎臟病", "骨質疏鬆", "退化性關節炎",
            "慢性阻塞性肺病", "癌症", "憂鬱症", "白內障／青光眼", "聽力障礙", "攝護腺肥大", "痛風", "甲狀腺疾病"]
DISEASE_CARE = {  # 勾選疾病 → 照顧計畫與生活注意事項（範本，可修改）
    "高血壓": "每日量測血壓，留意頭暈、頭痛；飲食少鹽。",
    "糖尿病": "留意低血糖症狀（冒冷汗、手抖），點心與甜食適量；定期追蹤血糖。",
    "高血脂": "飲食少油炸、少動物性脂肪，鼓勵規律運動。",
    "心臟病": "活動強度循序漸進，出現胸悶、喘時立即休息並通知護理師。",
    "中風": "注意患側擺位與保護，預防跌倒；鼓勵患側參與日常活動。",
    "失智症": "維持規律作息與現實導向，給予簡單明確指令；留意遊走與情緒。",
    "巴金森氏症": "按時服藥，起身動作放慢，預防姿勢性低血壓與跌倒。",
    "慢性腎臟病": "依醫囑控制水分、蛋白質與鹽分攝取。",
    "骨質疏鬆": "預防跌倒，避免彎腰提重物；適度日曬與負重運動。",
    "退化性關節炎": "避免久站久蹲，活動前暖身；疼痛時告知護理師。",
    "慢性阻塞性肺病": "留意呼吸喘與痰液，活動時適時休息；按時使用吸入劑。",
    "憂鬱症": "留意情緒與睡眠變化，鼓勵參與社交活動。",
    "白內障／青光眼": "活動空間照明充足，按時點眼藥。",
    "聽力障礙": "面對面、放慢速度說話，確認理解。",
    "攝護腺肥大": "留意排尿狀況，提醒定時如廁。",
}
SIMPLE["HA"] = {"title": "健康評估／慢性疾病追蹤", "discipline": "護理", "fields": [
    {"key": "diseases", "label": "疾病史（勾選）", "type": "multi", "options": DISEASES},
    {"key": "disease_other", "label": "其他疾病史", "type": "text"},
    {"key": "regular_visit", "label": "是否定期就醫", "type": "radio", "options": ["是", "否", "不定期"]},
    {"key": "hospital", "label": "平日就醫地點", "type": "text", "chips": "hospital"},
    {"key": "regular_med", "label": "是否規律服藥", "type": "radio", "options": ["是，自行服藥", "是，需家屬協助", "是，中心協助服藥", "否／常忘記", "無服藥"]},
    {"key": "allergy", "label": "過敏史（藥物／食物）", "type": "text"},
    {"key": "exam_date", "label": "入托前體檢日期（B4：6 個月內）", "type": "date"},
    {"key": "xray", "label": "胸部 X 光", "type": "radio", "options": ["正常", "異常（已追蹤）", "未提供"]},
    {"key": "care_notes", "label": "照顧計畫與生活注意事項（依勾選疾病自動產生，可修改）", "type": "textarea", "auto": "care_notes"},
    {"key": "referral", "label": "轉介（B1）", "type": "multi", "options": ["醫療院所回診", "復健", "營養師", "牙科", "眼科", "身心科", "其他"]},
]}


def care_notes(d):
    lines = [DISEASE_CARE[x] for x in (d.get("diseases") or []) if x in DISEASE_CARE]
    if d.get("regular_med", "").startswith("否"):
        lines.append("服藥規律性不佳，與家屬討論服藥提醒方式。")
    if d.get("regular_visit") in ("否", "不定期"):
        lines.append("鼓勵家屬安排定期回診追蹤慢性病。")
    return "\n".join(f"{i + 1}. {x}" for i, x in enumerate(lines)) or "（請先勾選疾病史）"


# ---------- 跨專業個案討論會（B1：每季至少 1 次、≥3 種專業） ----------
SIMPLE["CC"] = {"title": "跨專業個案討論會", "fields": [
    {"key": "professions", "label": "參與專業（至少 3 種）", "type": "multi", "options": PROFESSIONS},
    {"key": "attendees", "label": "出席人員", "type": "text"},
    {"key": "summary", "label": "各專業評估摘要（自動彙整最近一次各專業評估，可修改）", "type": "textarea", "auto": "conference_summary"},
    {"key": "problems", "label": "討論問題", "type": "textarea", "templates": ["跌倒風險增加", "認知功能退化", "營養狀況需改善", "情緒低落、參與動機下降", "家屬照顧負荷高"]},
    {"key": "decision", "label": "決議與照顧計畫修正", "type": "textarea", "templates": ["增加運動團體參與次數", "安排認知團體與現實導向", "依營養師建議調整餐食質地", "由社工聯繫家屬討論照顧安排", "護理師追蹤就醫與服藥"]},
    {"key": "referral", "label": "轉介", "type": "multi", "options": ["醫療院所", "復健", "營養師", "輔具資源中心", "社會資源", "其他"]},
    {"key": "next_date", "label": "下次討論日期（每季）", "type": "date"},
]}

# ---------- 活動紀錄（B7；護理師意見：表單待討論 → 先提供草案） ----------
ACT_TYPES = ["團體活動", "個別活動", "社區活動", "照顧者支持活動"]
ACT_CATS = ["認知", "體能", "社交", "手作", "音樂", "園藝", "宗教", "節慶", "懷舊", "輔療", "衛教", "其他"]
ACT_LEVELS = ["主動參與", "引導後參與", "被動參與", "未參與"]

# ---------- 教育訓練（B11：每人每年繼續教育 ≥20 小時、CPR 有效期；A10：新進 3 個月內 16 小時） ----------
TRAIN_CATS = ["感染控制", "失智症照顧", "自立支援", "轉移位／照顧技巧", "活動帶領", "急救（CPR／BLS）", "職業安全衛生", "營養與吞嚥",
              "多元文化／原住民族／多元性別", "長照法規", "職前訓練", "其他"]
LIB_CATS = ["失智症", "轉移位", "活動帶領", "感染控制", "營養與吞嚥", "急救", "自立支援", "職能治療", "衛教單張", "其他"]
