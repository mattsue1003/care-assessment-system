"""評估表單定義、自動判定、建議用語與敘述產生。

D61 欄位與 care99 系統 D61.職能治療評估 一致（方便對照登打）；
六力（ICOPE）依中心紙本「福喜緣日間照顧中心 職能治療 ICOPE 評估」。
"""

HOBBIES = ["運動", "下棋/打牌", "麻將", "唱歌", "聽歌", "閱報/閱讀", "散步", "園藝",
           "烹飪", "家事", "手工藝活動", "養寵物"]
ADL = ["進食", "穿脫衣物", "個人衛生", "轉移位/行走", "上廁所", "家務維持", "寫字/畫圖"]
FUNC = ["無支撐維持坐姿", "坐姿地面取物", "無支撐維持站姿", "可雙腳合併站立", "站立地面取物",
        "扶持輔具下坐站", "無支撐下坐站", "協助走一段距離", "獨立輔具下行走", "獨立行走無輔具", "可自行推輪"]
BPSD = ["妄想", "幻覺", "激動/攻擊行為", "憂鬱/情緒不佳", "焦慮", "冷漠/毫不在意", "異常動作/遊走", "言行失控不恰當"]
GOALS = ["提升日常功能", "促進活動參與", "問題行為改善", "降低照顧負擔"]
PLANS = ["家屬/服務員衛教", "認知刺激訓練", "日常功能訓練", "活動安排規劃", "肌力訓練", "平衡訓練",
         "行走能力訓練", "輔具建議適配", "環境改造", "精細動作訓練", "粗大動作訓練", "社交互動安排"]

NC = ["正常", "缺損"]
SIDES = [("ue_r", "U/E 右側"), ("ue_l", "U/E 左側"), ("le_r", "L/E 右側"), ("le_l", "L/E 左側")]


def _radio(key, label, options, note=False):
    return {"key": key, "label": label, "type": "radio", "options": options, "note": note}


def _multi(key, label, options, other=True, hint=""):
    return {"key": key, "label": label, "type": "multi", "options": options, "other": other, "hint": hint}


D61 = [
    {"no": "01", "title": "興趣嗜好", "fields": [
        _multi("hobby_past", "過去", HOBBIES), _multi("hobby_now", "現在", HOBBIES)]},
    {"no": "02", "title": "日常生活", "fields": [
        _multi("adl_help", "ADL 日常生活評估", ADL, hint="勾選［需他人協助］項目；全部獨立則不勾")]},
    {"no": "03", "title": "功能性動作", "fields": [
        _multi("func", "功能性動作表現層級", FUNC)]},
    {"no": "04", "title": "社會參與", "fields": [
        _radio("soc_coop", "活動配合度", NC), _radio("soc_motiv", "活動參與動機", NC)]},
    {"no": "05", "title": "ROM", "fields": [_radio("rom_" + k, l, ["正常", "限制"]) for k, l in SIDES]},
    {"no": "06", "title": "MMT", "fields": [_radio("mmt_" + k, l, ["正常", "不足", "受損"]) for k, l in SIDES]},
    {"no": "07", "title": "肌肉張力", "fields": [
        _radio("tone_ue", "U/E", ["正常", "高張", "低張"]), _radio("tone_le", "L/E", ["正常", "高張", "低張"])]},
    {"no": "08", "title": "感官精神", "fields": [
        _radio("sense_touch", "感覺", ["正常", "異常", "缺損"], note=True),
        _radio("sense_hear", "聽覺", ["正常", "異常", "缺損"], note=True),
        _radio("sense_vision", "視覺", ["正常", "異常", "缺損"], note=True),
        _multi("bpsd", "精神行為評估", BPSD, hint="無則不勾")]},
    {"no": "09", "title": "認知評估", "fields": [
        _radio("cog_alert", "警醒度", ["正常", "嗜睡"]), _radio("cog_orient", "定向感", NC),
        _radio("cog_attn", "專注力", NC), _radio("cog_mem_s", "記憶力-短期", NC),
        _radio("cog_mem_l", "記憶力-長期", NC), _radio("cog_expr", "語言表達", NC),
        _radio("cog_comp", "語言理解", NC), _radio("cog_read", "文字理解", NC),
        _radio("cog_solve", "問題解決能力", NC)]},
    {"no": "10", "title": "治療目標計畫", "fields": [
        _multi("ot_goal", "職能治療目標", GOALS), _multi("ot_plan", "職能治療計畫", PLANS)]},
    {"no": "11", "title": "個別日常職能活動安排", "fields": [
        {"key": "sched_am", "label": "早上", "type": "text"},
        {"key": "sched_pm", "label": "下午", "type": "text"},
        {"key": "sched_ev", "label": "晚上", "type": "text"}]},
]

_PREFIX = {"05": "ROM ", "06": "MMT ", "07": "肌肉張力 "}
for _s in D61:
    for _f in _s["fields"]:
        _f["qlabel"] = _PREFIX.get(_s["no"], "") + _f["label"]
D61_FIELDS = {f["key"]: f for s in D61 for f in s["fields"]}
D61_RADIOS = [f for f in D61_FIELDS.values() if f["type"] == "radio"]


# ---------------------------------------------------------------- 六力 ICOPE
ICOPE_DOMAINS = [
    ("cog", "認知"), ("mob", "行動"), ("nut", "營養"), ("vis", "視力"), ("hear", "聽力"), ("dep", "憂鬱"),
]
ICOPE_FOLLOW = [("med", "用藥評估"), ("soc", "社會照護與支持")]
ICOPE_ALL = ICOPE_DOMAINS + ICOPE_FOLLOW

# 後續處置只列介入／團體／轉介（中心不做標準化複評）
SUGGEST = {
    "cog": ["參加認知團體", "每日現實導向（日曆、白板）", "個別認知訓練（手工藝、稍有挑戰的作業）", "告知家屬協助居家認知刺激"],
    "mob": ["參加運動團體（下肢肌力、平衡、行走訓練）", "個別坐站運動 10 下 × 2–3 組／天", "防跌衛教",
            "檢查行走輔具的高度與狀態", "輔具建議適配"],
    "nut": ["告知護理人員追蹤體重與飲食", "用餐時觀察進食量", "轉介營養師"],
    "vis": ["鼓勵眼科就醫", "持續觀察，適時鼓勵就醫", "活動空間照明充足；標示、字卡放大", "協助配戴老花眼鏡"],
    "hear": ["說話時面對面、放慢速度", "團體活動安排座位靠近帶領者", "鼓勵耳鼻喉科／聽力檢查", "告知家屬留意助聽器使用"],
    "dep": ["參加社交團體", "告知社工關懷", "告知護理人員追蹤情緒與睡眠", "安排有興趣的活動，增加成就感"],
    "med": ["告知護理人員追蹤用藥", "告知護理人員追蹤疼痛與止痛藥使用", "OT：姿勢與活動調整，避免久坐"],
    "soc": ["告知社工評估照顧資源", "日常生活自立支援訓練", "提供家屬照顧技巧衛教"],
}

ICOPE_PLAN_MAP = {  # 六力異常 → D61 治療計畫
    "cog": ["認知刺激訓練"], "mob": ["肌力訓練", "平衡訓練", "行走能力訓練"],
    "dep": ["社交互動安排"], "soc": ["日常功能訓練"],
}


def icope_auto(d):
    """依作答自動判定各面向；回傳 {domain: '正常'/'異常'/''}。手動判定優先。"""
    g = lambda k: (d.get(k) or "").strip()
    r = {}
    ans = [g("cog_memory")] + [g(k) for k in ("cog_year", "cog_month", "cog_day", "cog_place")]
    r["cog"] = "" if not any(ans) else ("異常" if g("cog_memory") == "有錯誤" or "錯" in ans[1:] else "正常")
    sec = g("mob_seconds")
    try:
        secv = float(sec)
    except ValueError:
        secv = None
    if secv is None and not g("mob_method"):
        r["mob"] = ""
    else:
        r["mob"] = "異常" if (secv is not None and secv > 12) or g("mob_method") in ("雙手扶扶手", "無法完成") else "正常"
    def yes_any(keys, bad="是"):
        vals = [g(k) for k in keys]
        return "" if not any(vals) else ("異常" if bad in vals else "正常")
    r["nut"] = yes_any(["nut_weight", "nut_appetite"])
    r["vis"] = yes_any(["vis_far", "vis_near"], "有困難")
    r["hear"] = yes_any(["hear_r", "hear_l"], "聽不到")
    r["dep"] = yes_any(["dep_low", "dep_interest"])
    r["med"] = {"異常": "需追蹤", "正常": "無異常"}.get(yes_any(["med_10", "med_sleep", "med_pain"]), "")
    r["soc"] = {"異常": "需追蹤", "正常": "無異常"}.get(yes_any(["soc_adl"]), "")
    for k, _ in ICOPE_ALL:
        if g(k + "_judge"):
            r[k] = g(k + "_judge")
    return r


def icope_abnormal(d):
    j = icope_auto(d)
    return [lbl for k, lbl in ICOPE_DOMAINS if j.get(k) == "異常"]


def icope_to_d61(d, base=None):
    """六力結果帶入 D61 對應欄位（不覆蓋其他欄位）。"""
    out = dict(base or {})
    j = icope_auto(d)
    g = lambda k: (d.get(k) or "").strip()
    if any(g(k) == "錯" for k in ("cog_year", "cog_month", "cog_day", "cog_place")):
        out["cog_orient"] = "缺損"
        wrong = [n for k, n in (("cog_year", "年"), ("cog_month", "月"), ("cog_day", "日"), ("cog_place", "地點")) if g(k) == "錯"]
        out["s09_note"] = "定向：" + "、".join(wrong) + "錯誤"
    elif j.get("cog") == "正常":
        out["cog_orient"] = "正常"
    if g("cog_memory"):
        out["cog_mem_s"] = "缺損" if g("cog_memory") == "有錯誤" else "正常"
    if j.get("hear"):
        out["sense_hear"] = "正常" if j["hear"] == "正常" else "異常"
        if g("hear_note"):
            out["sense_hear_note"] = g("hear_note")
    if j.get("vis"):
        out["sense_vision"] = "正常" if j["vis"] == "正常" else "異常"
        parts = []
        if g("vis_far") == "有困難":
            parts.append("遠距有困難")
        if g("vis_near") == "有困難":
            parts.append("近距有困難")
        if g("vis_exam") == "否":
            parts.append("一年內未做眼科檢查")
        if parts:
            out["sense_vision_note"] = "，".join(parts)
    if j.get("dep") == "異常":
        out["bpsd"] = sorted(set((out.get("bpsd") or []) + ["憂鬱/情緒不佳"]), key=BPSD.index)
    func = set(out.get("func") or [])
    if g("mob_method") == "雙手抱胸":
        func.add("無支撐下坐站"); func.discard("扶持輔具下坐站")
    elif g("mob_method") == "雙手扶扶手":
        func.add("扶持輔具下坐站"); func.discard("無支撐下坐站")
    if g("mob_aid") and g("mob_aid") not in ("無", "不需"):
        func.add("獨立輔具下行走") if g("mob_supervise") != "需監視" else func.add("協助走一段距離")
    elif g("mob_aid") in ("無", "不需"):
        func.add("獨立行走無輔具")
    out["func"] = [x for x in FUNC if x in func]
    plans = set(out.get("ot_plan") or [])
    for k, ps in ICOPE_PLAN_MAP.items():
        if j.get(k) in ("異常", "需追蹤"):
            plans.update(ps)
    out["ot_plan"] = [x for x in PLANS if x in plans]
    return out


# ---------------------------------------------------------------- 比較
def _rank(field, v):
    try:
        return field["options"].index(v)
    except (ValueError, KeyError):
        return None


def compare_d61(prev, cur):
    """回傳 [(label, 前次, 本次, '進步'/'退步'/'變更')]"""
    if not prev:
        return []
    out = []
    for f in D61_RADIOS:
        a, b = prev.get(f["key"]), cur.get(f["key"])
        if a and b and a != b:
            ra, rb = _rank(f, a), _rank(f, b)
            out.append((f["qlabel"], a, b, "退步" if rb > ra else "進步"))
    a, b = set(prev.get("adl_help") or []), set(cur.get("adl_help") or [])
    for x in sorted(b - a):
        out.append(("ADL：" + x, "獨立", "需協助", "退步"))
    for x in sorted(a - b):
        out.append(("ADL：" + x, "需協助", "獨立", "進步"))
    a, b = set(prev.get("bpsd") or []), set(cur.get("bpsd") or [])
    for x in sorted(b - a):
        out.append(("精神行為：" + x, "無", "有", "退步"))
    for x in sorted(a - b):
        out.append(("精神行為：" + x, "有", "無", "進步"))
    a, b = set(prev.get("func") or []), set(cur.get("func") or [])
    for x in sorted(b - a):
        out.append(("功能性動作：" + x, "—", "可", "變更"))
    for x in sorted(a - b):
        out.append(("功能性動作：" + x, "可", "—", "變更"))
    return out


# ---------------------------------------------------------------- 敘述產生
def _join(xs):
    xs = [x for x in xs if x]
    return "、".join(xs[:-1]) + "及" + xs[-1] if len(xs) > 1 else (xs[0] if xs else "")


def _limbs(keys):
    """['ue_r','ue_l','le_r'] → ['雙側上肢', '右下肢']"""
    out = []
    for limb, name in (("ue", "上肢"), ("le", "下肢")):
        r, l = limb + "_r" in keys, limb + "_l" in keys
        if r and l:
            out.append("雙側" + name)
        elif r or l:
            out.append(("右" if r else "左") + name)
    return out


def d61_narrative(client, d, aids=None, icope=None):
    """依勾選內容產生「整體評估建議」初稿（可再修改）。"""
    g = lambda k: (d.get(k) or "") if not isinstance(d.get(k), list) else d.get(k)
    s = []
    head = "個案為"
    if client.get("age"):
        head += f"{client['age']}歲"
    head += {"男": "男性", "女": "女性"}.get(client.get("gender"), "長者")
    adl = g("adl_help") or []
    head += "，日常生活獨立" if not adl else f"，日常生活中{_join(adl)}需他人協助"
    func = g("func") or []
    aid_names = [a["item"] for a in (aids or []) if a.get("status", "使用中") == "使用中" and a.get("category", "行動") == "行動"]
    if not aid_names and icope and (icope.get("mob_aid") or "") not in ("", "無", "不需"):
        aid_names = [icope["mob_aid"]]
    if "獨立行走無輔具" in func:
        head += "，可獨立行走"
    elif "獨立輔具下行走" in func:
        head += f"，行走使用{_join(aid_names) or '輔具'}"
    elif "協助走一段距離" in func:
        head += "，需他人協助行走一段距離"
    elif "可自行推輪" in func:
        head += "，以輪椅代步，可自行推輪"
    if "無支撐下坐站" in func:
        head += "，可無支撐完成坐站"
    elif "扶持輔具下坐站" in func:
        head += "，坐站需扶持"
    s.append(head + "。")

    if icope:
        j = icope_auto(icope)
        ab = [lbl for k, lbl in ICOPE_DOMAINS if j.get(k) == "異常"]
        part = "六力評估" + (f"{_join(ab)}異常" if ab else "六大面向皆正常")
        try:
            sec = float(icope.get("mob_seconds") or "")
            part += f"；起立坐下 5 次需 {sec:g} 秒" + ("，且需雙手扶扶手" if icope.get("mob_method") == "雙手扶扶手" else "")
        except ValueError:
            pass
        s.append(part + "。")

    body = []
    lim = _limbs([k for k, _ in SIDES if g("rom_" + k) == "限制"])
    if lim:
        body.append(f"{_join(lim)}關節活動度受限")
    weak = _limbs([k for k, _ in SIDES if g("mmt_" + k) in ("不足", "受損")])
    if weak:
        body.append(f"{_join(weak)}肌力" + ("受損" if any(g("mmt_" + k) == "受損" for k, _ in SIDES) else "不足"))
    for k, l in (("tone_ue", "上肢"), ("tone_le", "下肢")):
        if g(k) in ("高張", "低張"):
            body.append(f"{l}肌肉張力{g(k)}")
    for k, l in (("sense_touch", "感覺"), ("sense_hear", "聽力"), ("sense_vision", "視力")):
        if g(k) in ("異常", "缺損"):
            note = g(k + "_note")
            body.append(f"{l}{g(k)}" + (f"（{note}）" if note else ""))
    if body:
        s.append("、".join(body) + "。")
    bp = (g("bpsd") or []) + ([g("bpsd_other")] if g("bpsd_other") else [])
    if bp:
        s.append(f"精神行為方面有{_join(bp)}的情形。")
    cog_def = [D61_FIELDS[k]["label"] for k in ("cog_orient", "cog_attn", "cog_mem_s", "cog_mem_l", "cog_expr",
                                                 "cog_comp", "cog_read", "cog_solve") if g(k) == "缺損"]
    if g("cog_alert") == "嗜睡":
        cog_def.insert(0, "警醒度（嗜睡）")
    if cog_def:
        s.append(f"認知方面，{_join(cog_def)}有缺損" + ("，其餘大致正常。" if len(cog_def) < 6 else "。"))
    elif g("cog_orient"):
        s.append("認知功能大致正常。")
    now = (g("hobby_now") or []) + ([g("hobby_now_other")] if g("hobby_now_other") else [])
    past = (g("hobby_past") or []) + ([g("hobby_past_other")] if g("hobby_past_other") else [])
    past = [x for x in past if x not in now]
    if now:
        s.append(f"目前興趣為{_join(now)}" + (f"，過去喜歡{_join(past)}" if past else "") + "。")
    elif past:
        s.append(f"過去喜歡{_join(past)}。")
    if g("soc_coop") or g("soc_motiv"):
        ok = g("soc_coop") != "缺損" and g("soc_motiv") != "缺損"
        s.append("活動配合度與參與動機良好。" if ok else "活動配合度或參與動機較低，需多鼓勵。")

    plans = set(g("ot_plan") or [])
    rec = []
    if plans & {"肌力訓練", "平衡訓練", "行走能力訓練"}:
        rec.append("建議平時可以多參加體適能運動，延緩身體的退化，並且促進下肢的肌力，幫助行走的安全性及耐力。")
    if "認知刺激訓練" in plans:
        rec.append("認知方面，建議平時多參與團體認知活動，個別可以提供手工藝或稍有挑戰的認知訓練。")
    if "日常功能訓練" in plans:
        rec.append("日常生活中鼓勵個案自行完成能力所及的事情（自立支援），以維持日常功能。")
    if "精細動作訓練" in plans:
        rec.append("可透過手工藝、夾物等活動進行手部精細動作訓練。")
    if "粗大動作訓練" in plans and not plans & {"肌力訓練", "平衡訓練"}:
        rec.append("建議安排粗大動作活動，維持身體活動量。")
    if "社交互動安排" in plans:
        rec.append("建議安排社交團體，增加與他人互動的機會。")
    if "活動安排規劃" in plans:
        rec.append(f"建議依個案興趣{('（' + _join(now or past) + '）') if (now or past) else ''}安排活動，提升參與動機。")
    if "輔具建議適配" in plans:
        rec.append(f"建議定期檢查{_join(aid_names) or '輔具'}的高度與狀態，確保使用安全。")
    if "環境改造" in plans:
        rec.append("建議評估居家環境，必要時加裝扶手、止滑等環境改造。")
    if "家屬/服務員衛教" in plans:
        rec.append("並提供家屬及照顧服務員相關衛教。")
    sched = [(l, g(k)) for k, l in (("sched_am", "早上"), ("sched_pm", "下午"), ("sched_ev", "晚上")) if g(k)]
    if sched:
        rec.append("個別日常職能活動安排：" + "；".join(f"{l}{v}" for l, v in sched) + "。")
    return "".join(s + rec)


def icope_plan_text(d):
    """六力 → 職能治療處置建議初稿"""
    j = icope_auto(d)
    lines = []
    for k, lbl in ICOPE_ALL:
        if j.get(k) in ("異常", "需追蹤"):
            acts = (d.get(k + "_actions") or []) + ([d.get(k + "_actions_other")] if d.get(k + "_actions_other") else [])
            if acts:
                lines.append(f"{lbl}：" + "；".join(acts) + "。")
    return "\n".join(lines)


# ---------------------------------------------------------------- 六力題目（畫面／PDF／Word 共用）
def box(sel, opts):
    return "　".join(("☑" if o == sel else "☐") + o for o in opts)


ICOPE_Q = {  # key: (題目, 選項)
    "cog_memory": ("記憶：說出三個詞語（鉛筆、汽車、書），稍後回想", ["全部答對", "有錯誤"]),
    "cog_year": ("年", ["對", "錯"]), "cog_month": ("月", ["對", "錯"]),
    "cog_day": ("日", ["對", "錯"]), "cog_place": ("地點", ["對", "錯"]),
    "mob_method": ("方式", ["雙手抱胸", "雙手扶扶手", "無法完成"]),
    "mob_supervise": ("行走", ["不需監視", "需監視"]),
    "nut_weight": ("過去 3 個月，沒有刻意減重，體重卻減輕 3 公斤以上？", ["是", "否"]),
    "nut_appetite": ("過去 3 個月，是否曾經食慾不好？", ["是", "否"]),
    "vis_far": ("看遠", ["無困難", "有困難"]), "vis_near": ("看近／閱讀", ["無困難", "有困難"]),
    "vis_glasses": ("老花眼鏡", ["有", "無"]), "vis_exam": ("過去一年做過眼科檢查", ["是", "否"]),
    "hear_r": ("右耳", ["可聽到", "聽不到"]), "hear_l": ("左耳", ["可聽到", "聽不到"]),
    "dep_low": ("過去兩週，是否常常覺得心情低落、沒有希望？", ["是", "否"]),
    "dep_interest": ("過去兩週，是否對事情失去興趣、做事沒有愉悅感？", ["是", "否"]),
    "med_10": ("每天使用的藥物（含中藥、成藥、保健食品）達 10 種以上？", ["是", "否"]),
    "med_sleep": ("是否使用安眠／鎮靜藥物？", ["是", "否"]),
    "med_pain": ("是否使用止痛藥？", ["是", "否"]),
    "soc_adl": ("日常生活（洗澡、穿衣、如廁、移位、進食）是否需要他人協助？", ["是", "否"]),
}


def icope_rows(d):
    """回傳 [(key, 面向, [題目與作答行], 說明, [處置])]"""
    g = lambda k: (d.get(k) or "").strip() if isinstance(d.get(k, ""), str) else d.get(k)
    q = lambda k: f"{ICOPE_Q[k][0]}　{box(g(k), ICOPE_Q[k][1])}"
    sec = g("mob_seconds")
    lines = {
        "cog": [q("cog_memory"), "定向：今天是哪年、哪月、哪日？現在在哪裡？　" + "　".join(
            f"{ICOPE_Q[k][0]} {box(g(k), ['對', '錯'])}" for k in ("cog_year", "cog_month", "cog_day", "cog_place"))],
        "mob": [f"起立坐下 5 次（標準：雙手抱胸、12 秒內完成）　完成時間：{sec or '＿＿'} 秒",
                box(g("mob_method"), ICOPE_Q["mob_method"][1]),
                f"日常行走：{g('mob_aid') or '＿＿＿'}　{box(g('mob_supervise'), ICOPE_Q['mob_supervise'][1])}"],
        "nut": ["1. " + q("nut_weight"), "2. " + q("nut_appetite")],
        "vis": ["看遠、看近或閱讀時，是否有困難？", q("vis_far") + "　　" + q("vis_near"),
                q("vis_glasses") + "　　" + q("vis_exam") + (f"（{g('vis_exam_note')}）" if g("vis_exam_note") else "")],
        "hear": ["氣音測試（6-1-9／2-5-7）", q("hear_r") + "　　" + q("hear_l")]
                + ([f"原因／說明：{g('hear_note')}"] if g("hear_note") else []),
        "dep": [q("dep_low"), q("dep_interest")] + ([f"情緒狀況：{g('dep_note')}"] if g("dep_note") else []),
        "med": ["1. " + q("med_10"), "2. " + q("med_sleep"), "3. " + q("med_pain")]
               + ([f"說明：{g('med_note')}"] if g("med_note") else []),
        "soc": [q("soc_adl")] + ([f"說明：{g('soc_note')}"] if g("soc_note") else []),
    }
    out = []
    for k, lbl in ICOPE_ALL:
        acts = list(d.get(k + "_actions") or []) + ([d[k + "_actions_other"]] if d.get(k + "_actions_other") else [])
        out.append((k, lbl, lines[k], g(k + "_finding") or "", acts))
    return out


def d61_rows(d):
    """D61 各序號的勾選文字（Word / Excel 用）：[(no, title, [lines], note)]"""
    out = []
    for sec in D61:
        lines, notes = [], []
        for f in sec["fields"]:
            v = d.get(f["key"])
            if f["type"] == "multi":
                v = v or []
                ln = f"{f['label']}：" + "　".join(("☑" if o in v else "☐") + o for o in f["options"])
                if d.get(f["key"] + "_other"):
                    ln += f"　☑其他：{d[f['key'] + '_other']}"
                lines.append(ln)
            elif f["type"] == "radio":
                lines.append(f"{f['label']}：" + box(v or "", f["options"]))
                if d.get(f["key"] + "_note"):
                    notes.append(f"{f['label']}：{d[f['key'] + '_note']}")
            else:
                lines.append(f"{f['label']}：{v or ''}")
        if d.get(f"s{sec['no']}_note"):
            notes.append(d[f"s{sec['no']}_note"])
        out.append((sec["no"], sec["title"], lines, "\n".join(notes)))
    return out


def d61_brief(d, keys):
    """Excel 用：單一欄位的精簡值"""
    out = {}
    for k in keys:
        v = d.get(k)
        if isinstance(v, list):
            v = "、".join(v + ([d[k + "_other"]] if d.get(k + "_other") else []))
        out[k] = v or ""
    return out


def icope_normal(d):
    j = icope_auto(d)
    return [lbl for k, lbl in ICOPE_DOMAINS if j.get(k) == "正常"]
