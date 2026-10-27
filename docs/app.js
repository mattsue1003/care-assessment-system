/* 照護評估系統（GitHub Pages 試用版）
 * 全部在瀏覽器執行；資料存在本機瀏覽器（localStorage），每個人各自一份。
 * 邏輯與 Python 正式版（schema.py / app.py）一致。 */
(function () {
'use strict';
const S = window.SCHEMA;
const STORE = 'care_trial_v1';
const D61_FIELDS = {}; S.D61.forEach(s => s.fields.forEach(f => D61_FIELDS[f.key] = f));
const D61_RADIOS = Object.values(D61_FIELDS).filter(f => f.type === 'radio');
const LIST_KEYS = new Set(Object.values(D61_FIELDS).filter(f => f.type === 'multi').map(f => f.key)
  .concat(S.ICOPE_ALL.map(([k]) => k + '_actions')));
const BAD_OPTS = ['是', '有錯誤', '錯', '有困難', '聽不到', '雙手扶扶手', '無法完成', '需監視'];

/* ============================== 工具 ============================== */
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function toDate(s) {
  if (!s) return null; s = String(s).trim().replace(/[.\-]/g, '/'); const p = s.split('/').map(Number);
  if (p.length < 3 || p.some(isNaN)) return null; let [y, m, d] = p; if (y < 1000) y += 1911;
  const dt = new Date(y, m - 1, d); return dt.getMonth() === m - 1 ? dt : null;
}
const iso = s => { const d = toDate(s); return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ''; };
const roc = (s, sep = '/') => { const d = toDate(s); return d ? `${d.getFullYear() - 1911}${sep}${pad(d.getMonth() + 1)}${sep}${pad(d.getDate())}` : ''; };
const rocLong = s => { const d = toDate(s); return d ? `${d.getFullYear() - 1911} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日` : '　　 年　 月　 日'; };
function addMonths(s, n) {
  const d = toDate(s); const m = d.getMonth() + n; const y = d.getFullYear() + Math.floor(m / 12); const mm = ((m % 12) + 12) % 12;
  const last = new Date(y, mm + 1, 0).getDate(); return `${y}-${pad(mm + 1)}-${pad(Math.min(d.getDate(), last))}`;
}
const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`); };
function ageAt(birth, on) {
  const b = toDate(birth); if (!b) return null; const o = toDate(on) || new Date();
  return o.getFullYear() - b.getFullYear() - ((o.getMonth() < b.getMonth() || (o.getMonth() === b.getMonth() && o.getDate() < b.getDate())) ? 1 : 0);
}
const join = xs => { xs = xs.filter(Boolean); return xs.length > 1 ? xs.slice(0, -1).join('、') + '及' + xs[xs.length - 1] : (xs[0] || ''); };
const nowStr = () => new Date().toLocaleString('sv-SE').slice(0, 19);

/* ============================== 資料 ============================== */
let DB;
function load() {
  try { DB = JSON.parse(localStorage.getItem(STORE)); } catch (e) { DB = null; }
  if (!DB || !DB.clients) DB = JSON.parse(JSON.stringify(window.DEMO_DATA));
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(DB)); } catch (e) { alert('瀏覽器儲存空間無法使用，資料將無法保存'); } }
const nextId = () => DB.seq++;
const setting = k => (DB.settings || {})[k] || '';
function client(id) {
  const c = DB.clients.find(x => x.id === +id); if (!c) return null;
  return Object.assign({}, c, { age: ageAt(c.birth), label: c.case_no ? `${c.name}（${c.case_no}）` : c.name });
}
const assess = id => DB.assessments.find(x => x.id === +id);
function clientAssess(cid, types) {
  let rows = DB.assessments.filter(a => a.client_id === +cid && (!types || types.includes(a.type)));
  rows.sort((a, b) => (b.date + pad(b.id).padStart(6, '0')).localeCompare(a.date + pad(a.id).padStart(6, '0')));
  const real = new Set(rows.filter(a => !a.type.includes('HIST')).map(a => a.type + a.date));
  return rows.filter(a => !(a.type.includes('HIST') && real.has(a.type.replace('_HIST', '') + a.date)));
}
const aidsOf = cid => DB.aids.filter(x => x.client_id === +cid).sort((a, b) => (a.status || '').localeCompare(b.status || ''));
function goalsOf(cid) {
  return DB.goals.filter(x => x.client_id === +cid).map(g => Object.assign({}, g, {
    reviews: DB.reviews.filter(r => r.goal_id === g.id).sort((a, b) => b.date.localeCompare(a.date))
  }));
}
function dueInfo(cid) {
  const months = +setting('reeval_months') || 6;
  const rows = DB.assessments.filter(a => a.client_id === +cid).sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length) return { last: '', next: '', status: '未評估', last_d61: '', last_icope: '' };
  const last = rows[0]; const next = iso(last.next_due) || addMonths(last.date, months); const t = todayISO();
  const status = next < t ? '逾期' : (next <= addDays(t, 30) ? '30天內到期' : '正常');
  return { last: last.date, next, status, last_d61: (rows.find(r => r.type.startsWith('D61')) || {}).date || '',
    last_icope: (rows.find(r => r.type.startsWith('ICOPE')) || {}).date || '' };
}
function activeClients(status = '在案') {
  return DB.clients.filter(c => !status || c.status === status).map(c => Object.assign(client(c.id), { due: dueInfo(c.id) }))
    .sort((a, b) => (a.case_no || '').localeCompare(b.case_no || ''));
}
function indicators(cs) {
  cs = cs || activeClients(); const n = cs.length || 1; const since = addDays(todayISO(), -183);
  const b1 = cs.filter(c => c.due.last && c.due.last >= since).length;
  const ids = new Set(cs.map(c => c.id));
  const aids = DB.aids.filter(a => ids.has(a.client_id) && a.status === '使用中');
  const aidOk = aids.filter(a => a.start_date && a.fit_date && a.train_date).length;
  const gl = DB.goals.filter(g => ids.has(g.client_id) && g.status === '進行中');
  const withGoal = new Set(gl.map(g => g.client_id)).size; const since3 = addDays(todayISO(), -92);
  const reviewed = gl.filter(g => DB.reviews.some(r => r.goal_id === g.id && r.date >= since3)).length;
  return { n: cs.length, b1: [b1, Math.round(b1 * 100 / n)], b9: [aidOk, aids.length, Math.round(aidOk * 100 / (aids.length || 1))],
    b10: [withGoal, Math.round(withGoal * 100 / n), reviewed, gl.length] };
}

/* ============================== 評估邏輯（同 schema.py） ============================== */
const box = (sel, opts) => opts.map(o => (o === sel ? '☑' : '☐') + o).join('　');
function icopeAuto(d) {
  const g = k => (typeof d[k] === 'string' ? d[k].trim() : ''); const r = {};
  const ori = ['cog_year', 'cog_month', 'cog_day', 'cog_place'].map(g);
  r.cog = ![g('cog_memory'), ...ori].some(Boolean) ? '' : (g('cog_memory') === '有錯誤' || ori.includes('錯') ? '異常' : '正常');
  const sv = parseFloat(g('mob_seconds')); const sec = isNaN(sv) ? null : sv;
  r.mob = (sec === null && !g('mob_method')) ? '' : ((sec !== null && sec > 12) || ['雙手扶扶手', '無法完成'].includes(g('mob_method')) ? '異常' : '正常');
  const yesAny = (keys, bad = '是') => { const v = keys.map(g); return !v.some(Boolean) ? '' : (v.includes(bad) ? '異常' : '正常'); };
  r.nut = yesAny(['nut_weight', 'nut_appetite']); r.vis = yesAny(['vis_far', 'vis_near'], '有困難');
  r.hear = yesAny(['hear_r', 'hear_l'], '聽不到'); r.dep = yesAny(['dep_low', 'dep_interest']);
  r.med = { 異常: '需追蹤', 正常: '無異常' }[yesAny(['med_10', 'med_sleep', 'med_pain'])] || '';
  r.soc = { 異常: '需追蹤', 正常: '無異常' }[yesAny(['soc_adl'])] || '';
  S.ICOPE_ALL.forEach(([k]) => { if (g(k + '_judge')) r[k] = g(k + '_judge'); });
  return r;
}
const icopeAbn = d => { const j = icopeAuto(d); return S.ICOPE_DOMAINS.filter(([k]) => j[k] === '異常').map(x => x[1]); };
const icopeOk = d => { const j = icopeAuto(d); return S.ICOPE_DOMAINS.filter(([k]) => j[k] === '正常').map(x => x[1]); };
function icopeToD61(d, base) {
  const out = JSON.parse(JSON.stringify(base || {})); const j = icopeAuto(d); const g = k => (d[k] || '').trim();
  const ok = [['cog_year', '年'], ['cog_month', '月'], ['cog_day', '日'], ['cog_place', '地點']];
  if (ok.some(([k]) => g(k) === '錯')) { out.cog_orient = '缺損'; out.s09_note = '定向：' + ok.filter(([k]) => g(k) === '錯').map(x => x[1]).join('、') + '錯誤'; }
  else if (j.cog === '正常') out.cog_orient = '正常';
  if (g('cog_memory')) out.cog_mem_s = g('cog_memory') === '有錯誤' ? '缺損' : '正常';
  if (j.hear) { out.sense_hear = j.hear === '正常' ? '正常' : '異常'; if (g('hear_note')) out.sense_hear_note = g('hear_note'); }
  if (j.vis) {
    out.sense_vision = j.vis === '正常' ? '正常' : '異常'; const p = [];
    if (g('vis_far') === '有困難') p.push('遠距有困難'); if (g('vis_near') === '有困難') p.push('近距有困難');
    if (g('vis_exam') === '否') p.push('一年內未做眼科檢查'); if (p.length) out.sense_vision_note = p.join('，');
  }
  if (j.dep === '異常') out.bpsd = S.BPSD.filter(x => (out.bpsd || []).concat(['憂鬱/情緒不佳']).includes(x));
  const func = new Set(out.func || []);
  if (g('mob_method') === '雙手抱胸') { func.add('無支撐下坐站'); func.delete('扶持輔具下坐站'); }
  else if (g('mob_method') === '雙手扶扶手') { func.add('扶持輔具下坐站'); func.delete('無支撐下坐站'); }
  if (g('mob_aid') && !['無', '不需'].includes(g('mob_aid'))) func.add(g('mob_supervise') !== '需監視' ? '獨立輔具下行走' : '協助走一段距離');
  else if (['無', '不需'].includes(g('mob_aid'))) func.add('獨立行走無輔具');
  out.func = S.FUNC.filter(x => func.has(x));
  const plans = new Set(out.ot_plan || []);
  Object.entries(S.ICOPE_PLAN_MAP).forEach(([k, ps]) => { if (['異常', '需追蹤'].includes(j[k])) ps.forEach(p => plans.add(p)); });
  out.ot_plan = S.PLANS.filter(x => plans.has(x));
  return out;
}
function compareD61(prev, cur) {
  if (!prev) return []; const out = [];
  D61_RADIOS.forEach(f => { const a = prev[f.key], b = cur[f.key];
    if (a && b && a !== b) out.push([f.qlabel, a, b, f.options.indexOf(b) > f.options.indexOf(a) ? '退步' : '進步']); });
  const diff = (key, lbl, on, off) => { const a = new Set(prev[key] || []), b = new Set(cur[key] || []);
    [...b].filter(x => !a.has(x)).sort().forEach(x => out.push([lbl + x, off, on, key === 'func' ? '變更' : '退步']));
    [...a].filter(x => !b.has(x)).sort().forEach(x => out.push([lbl + x, on, off, key === 'func' ? '變更' : '進步'])); };
  diff('adl_help', 'ADL：', '需協助', '獨立'); diff('bpsd', '精神行為：', '有', '無'); diff('func', '功能性動作：', '可', '—');
  return out;
}
function limbs(keys) {
  const out = []; [['ue', '上肢'], ['le', '下肢']].forEach(([l, n]) => { const r = keys.includes(l + '_r'), lf = keys.includes(l + '_l');
    if (r && lf) out.push('雙側' + n); else if (r || lf) out.push((r ? '右' : '左') + n); }); return out;
}
function d61Narrative(c, d, aids, ic) {
  const g = k => d[k] || ''; const s = [];
  let head = '個案為' + (c.age ? c.age + '歲' : '') + ({ 男: '男性', 女: '女性' }[c.gender] || '長者');
  const adl = d.adl_help || []; head += adl.length ? `，日常生活中${join(adl)}需他人協助` : '，日常生活獨立';
  const func = d.func || []; let an = (aids || []).filter(a => (a.status || '使用中') === '使用中' && (a.category || '行動') === '行動').map(a => a.item);
  if (!an.length && ic && ic.mob_aid && !['無', '不需'].includes(ic.mob_aid)) an = [ic.mob_aid];
  if (func.includes('獨立行走無輔具')) head += '，可獨立行走'; else if (func.includes('獨立輔具下行走')) head += `，行走使用${join(an) || '輔具'}`;
  else if (func.includes('協助走一段距離')) head += '，需他人協助行走一段距離'; else if (func.includes('可自行推輪')) head += '，以輪椅代步，可自行推輪';
  if (func.includes('無支撐下坐站')) head += '，可無支撐完成坐站'; else if (func.includes('扶持輔具下坐站')) head += '，坐站需扶持';
  s.push(head + '。');
  if (ic) { const ab = icopeAbn(ic); let p = '六力評估' + (ab.length ? `${join(ab)}異常` : '六大面向皆正常');
    const sec = parseFloat(ic.mob_seconds); if (!isNaN(sec)) p += `；起立坐下 5 次需 ${sec} 秒` + (ic.mob_method === '雙手扶扶手' ? '，且需雙手扶扶手' : ''); s.push(p + '。'); }
  const body = []; const lim = limbs(S.SIDES.filter(([k]) => g('rom_' + k) === '限制').map(x => x[0]));
  if (lim.length) body.push(`${join(lim)}關節活動度受限`);
  const weak = limbs(S.SIDES.filter(([k]) => ['不足', '受損'].includes(g('mmt_' + k))).map(x => x[0]));
  if (weak.length) body.push(`${join(weak)}肌力` + (S.SIDES.some(([k]) => g('mmt_' + k) === '受損') ? '受損' : '不足'));
  [['tone_ue', '上肢'], ['tone_le', '下肢']].forEach(([k, l]) => { if (['高張', '低張'].includes(g(k))) body.push(`${l}肌肉張力${g(k)}`); });
  [['sense_touch', '感覺'], ['sense_hear', '聽力'], ['sense_vision', '視力']].forEach(([k, l]) => {
    if (['異常', '缺損'].includes(g(k))) body.push(`${l}${g(k)}` + (g(k + '_note') ? `（${g(k + '_note')}）` : '')); });
  if (body.length) s.push(body.join('、') + '。');
  const bp = (d.bpsd || []).concat(g('bpsd_other') ? [g('bpsd_other')] : []); if (bp.length) s.push(`精神行為方面有${join(bp)}的情形。`);
  const cogDef = ['cog_orient', 'cog_attn', 'cog_mem_s', 'cog_mem_l', 'cog_expr', 'cog_comp', 'cog_read', 'cog_solve'].filter(k => g(k) === '缺損').map(k => D61_FIELDS[k].label);
  if (g('cog_alert') === '嗜睡') cogDef.unshift('警醒度（嗜睡）');
  if (cogDef.length) s.push(`認知方面，${join(cogDef)}有缺損` + (cogDef.length < 6 ? '，其餘大致正常。' : '。')); else if (g('cog_orient')) s.push('認知功能大致正常。');
  const now = (d.hobby_now || []).concat(g('hobby_now_other') ? [g('hobby_now_other')] : []);
  const past = (d.hobby_past || []).concat(g('hobby_past_other') ? [g('hobby_past_other')] : []).filter(x => !now.includes(x));
  if (now.length) s.push(`目前興趣為${join(now)}` + (past.length ? `，過去喜歡${join(past)}` : '') + '。'); else if (past.length) s.push(`過去喜歡${join(past)}。`);
  if (g('soc_coop') || g('soc_motiv')) s.push(g('soc_coop') !== '缺損' && g('soc_motiv') !== '缺損' ? '活動配合度與參與動機良好。' : '活動配合度或參與動機較低，需多鼓勵。');
  const plans = new Set(d.ot_plan || []); const rec = []; const has = (...xs) => xs.some(x => plans.has(x));
  if (has('肌力訓練', '平衡訓練', '行走能力訓練')) rec.push('建議平時可以多參加體適能運動，延緩身體的退化，並且促進下肢的肌力，幫助行走的安全性及耐力。');
  if (has('認知刺激訓練')) rec.push('認知方面，建議平時多參與團體認知活動，個別可以提供手工藝或稍有挑戰的認知訓練。');
  if (has('日常功能訓練')) rec.push('日常生活中鼓勵個案自行完成能力所及的事情（自立支援），以維持日常功能。');
  if (has('精細動作訓練')) rec.push('可透過手工藝、夾物等活動進行手部精細動作訓練。');
  if (has('粗大動作訓練') && !has('肌力訓練', '平衡訓練')) rec.push('建議安排粗大動作活動，維持身體活動量。');
  if (has('社交互動安排')) rec.push('建議安排社交團體，增加與他人互動的機會。');
  if (has('活動安排規劃')) rec.push(`建議依個案興趣${(now.length || past.length) ? '（' + join(now.length ? now : past) + '）' : ''}安排活動，提升參與動機。`);
  if (has('輔具建議適配')) rec.push(`建議定期檢查${join(an) || '輔具'}的高度與狀態，確保使用安全。`);
  if (has('環境改造')) rec.push('建議評估居家環境，必要時加裝扶手、止滑等環境改造。');
  if (has('家屬/服務員衛教')) rec.push('並提供家屬及照顧服務員相關衛教。');
  const sch = [['sched_am', '早上'], ['sched_pm', '下午'], ['sched_ev', '晚上']].filter(([k]) => g(k)).map(([k, l]) => l + g(k));
  if (sch.length) rec.push('個別日常職能活動安排：' + sch.join('；') + '。');
  return s.concat(rec).join('');
}
function icopePlanText(d) {
  const j = icopeAuto(d);
  return S.ICOPE_ALL.filter(([k]) => ['異常', '需追蹤'].includes(j[k])).map(([k, l]) => {
    const acts = (d[k + '_actions'] || []).concat(d[k + '_actions_other'] ? [d[k + '_actions_other']] : []);
    return acts.length ? `${l}：${acts.join('；')}。` : ''; }).filter(Boolean).join('\n');
}
function icopeRows(d) {
  const g = k => (d[k] || ''); const Q = S.ICOPE_Q; const q = k => `${Q[k][0]}　${box(g(k), Q[k][1])}`;
  const lines = {
    cog: [q('cog_memory'), '定向：今天是哪年、哪月、哪日？現在在哪裡？　' + ['cog_year', 'cog_month', 'cog_day', 'cog_place'].map(k => `${Q[k][0]} ${box(g(k), ['對', '錯'])}`).join('　')],
    mob: [`起立坐下 5 次（標準：雙手抱胸、12 秒內完成）　完成時間：${g('mob_seconds') || '＿＿'} 秒`, box(g('mob_method'), Q.mob_method[1]),
      `日常行走：${g('mob_aid') || '＿＿＿'}　${box(g('mob_supervise'), Q.mob_supervise[1])}`],
    nut: ['1. ' + q('nut_weight'), '2. ' + q('nut_appetite')],
    vis: ['看遠、看近或閱讀時，是否有困難？', q('vis_far') + '　　' + q('vis_near'), q('vis_glasses') + '　　' + q('vis_exam') + (g('vis_exam_note') ? `（${g('vis_exam_note')}）` : '')],
    hear: ['氣音測試（6-1-9／2-5-7）', q('hear_r') + '　　' + q('hear_l')].concat(g('hear_note') ? [`原因／說明：${g('hear_note')}`] : []),
    dep: [q('dep_low'), q('dep_interest')].concat(g('dep_note') ? [`情緒狀況：${g('dep_note')}`] : []),
    med: ['1. ' + q('med_10'), '2. ' + q('med_sleep'), '3. ' + q('med_pain')].concat(g('med_note') ? [`說明：${g('med_note')}`] : []),
    soc: [q('soc_adl')].concat(g('soc_note') ? [`說明：${g('soc_note')}`] : []),
  };
  return S.ICOPE_ALL.map(([k, l]) => [k, l, lines[k], g(k + '_finding'), (d[k + '_actions'] || []).concat(d[k + '_actions_other'] ? [d[k + '_actions_other']] : [])]);
}
function icopeTrend(ics) {
  const cols = ics.slice().reverse().slice(-6);
  return { dates: cols.map(a => a.date), rows: S.ICOPE_ALL.map(([k, l]) => [l, cols.map(a => icopeAuto(a.data)[k] || '')]),
    secs: cols.map(a => { const v = parseFloat(a.data.mob_seconds); return isNaN(v) ? null : v; }) };
}
function d61Trend(ds) {
  const cols = ds.slice().reverse().slice(-6); const rows = [];
  D61_RADIOS.forEach(f => { const v = cols.map(a => a.data[f.key] || ''); if (v.some(Boolean)) rows.push([f.qlabel, v, f.options]); });
  rows.push(['ADL 需協助項目', cols.map(a => (a.data.adl_help || []).join('、') || '獨立'), null]);
  return { dates: cols.map(a => a.date), rows };
}
function bundle(cid) {
  const c = client(cid); const all = clientAssess(cid); const d61s = all.filter(a => a.type === 'D61'); const ics = all.filter(a => a.type === 'ICOPE');
  return { c, all, d61s, ics, aids: aidsOf(cid), goals: goalsOf(cid), due: dueInfo(cid), trend: icopeTrend(ics), d61trend: d61Trend(d61s),
    changes: d61s.length > 1 ? compareD61(d61s[1].data, d61s[0].data) : [] };
}

/* ============================== 版面 ============================== */
let FLASH = null;
const flash = (m, cat = 'ok') => { FLASH = [m, cat]; };
const badge = (v, cls) => v ? `<span class="b ${h(cls ?? v)}">${h(v)}</span>` : '—';
const typName = { D61: 'D61 職能治療評估', ICOPE: '六力 ICOPE', D61_HIST: 'D61（歷史）', ICOPE_HIST: '六力（歷史）' };
function layout(active, body) {
  const nav = (href, key, code, label, cls = '') => `<a href="#${href}" class="${active === key ? 'on' : ''} ${cls}"><code>${code}</code><span>${label}</span></a>`;
  const tab = (href, key, ic, label) => `<a href="#${href}" class="${active === key ? 'on' : ''}"><b>${ic}</b>${label}</a>`;
  const f = FLASH; FLASH = null;
  return `<div class="top">
    <button class="menu-btn" type="button" onclick="App.nav(true)">☰</button>
    <a class="logo" href="#/"><i>福</i><span>照護評估系統</span></a>
    <span class="small hide-m">單位：${h(setting('center_name'))}</span>
    <span class="b demo-tag">試用版<span class="hide-m">｜資料皆為假名</span></span>
    <span class="sp"></span>
    <a class="btn sm acc fb-btn" href="#/feedback">💬<span class="hide-m"> 意見回饋</span></a>
    <span class="small hide-m">示範治療師</span><a class="small hide-m" href="#" onclick="return App.logout()">登出</a>
  </div>
  <div class="nav-mask" onclick="App.nav(false)"></div>
  <div class="wrap"><nav class="side">
    <div class="side-me show-m"><b>示範治療師</b><div class="small muted">${h(setting('center_name'))}</div></div>
    ${nav('/', 'home', '🏠', '首頁／待辦')}
    <div class="grp">基本資料</div>${nav('/clients', 'clients', 'B2', '個案名冊')}${nav('/aids', 'aids', 'B2c', '輔具管理')}
    <div class="grp">照顧評估</div>${nav('/assess/D61', 'D61', 'D61', '職能治療評估')}${nav('/assess/ICOPE', 'ICOPE', '六力', 'ICOPE 評估')}
    <div class="grp">自立支援</div>${nav('/goals', 'goals', 'B10', '復能目標追蹤')}
    <div class="grp">評鑑與報表</div>${nav('/reports', 'reports', '📦', '評鑑佐證／匯出')}
    <div class="grp">系統</div>${nav('/feedback', 'feedback', '💬', '試用意見回饋')}${nav('/settings', 'settings', '⚙️', '設定／重設資料')}
    <a href="#" class="show-m" onclick="return App.logout()"><code>↩︎</code><span>登出</span></a>
  </nav><main>
    ${f ? `<div class="flash ${f[1]}">${h(f[0])}</div>` : ''}${body}
  </main></div>
  <nav class="tabbar">${tab('/', 'home', '🏠', '首頁')}${tab('/clients', 'clients', '👥', '個案')}${tab('/assess/ICOPE', 'ICOPE', '🧭', '六力')}${tab('/assess/D61', 'D61', '📝', 'D61')}
    <a href="#" onclick="App.nav(true);return false"><b>☰</b>更多</a></nav>`;
}
function cardify(root) {
  root.querySelectorAll('table.t:not(.trend)').forEach(t => {
    const hdr = [...t.rows].find(r => r.querySelector('th')); if (!hdr) return; hdr.classList.add('hdr');
    const labels = [...hdr.cells].map(c => c.textContent.trim());
    [...t.rows].forEach(r => { if (r === hdr) return; let i = 0; [...r.cells].forEach(td => { td.dataset.label = td.colSpan > 1 ? '' : (labels[i] || ''); i += td.colSpan || 1; }); });
    t.classList.add('cards');
  });
}
const clientOpts = (sel) => activeClients().map(x => `<option value="${x.id}" ${x.id === +sel ? 'selected' : ''}>${h(x.label)}</option>`).join('');
const opt = (list, sel) => list.map(o => `<option ${o === sel ? 'selected' : ''}>${h(o)}</option>`).join('');

/* ============================== 頁面 ============================== */
const V = {};
V.login = () => `<div class="login-bg"><form class="login" onsubmit="return App.login(event)">
  <div style="text-align:center;font-size:40px">🏡</div>
  <h1>照護評估系統<br><span style="font-size:15px;font-weight:400">試用版</span></h1>
  ${FLASH ? `<div class="flash err">${h(FLASH[0])}</div>` : ''}
  <label class="f">帳號</label><input type="text" name="u" autocomplete="username" inputmode="numeric">
  <label class="f">密碼</label><input type="password" name="p" autocomplete="current-password" inputmode="numeric">
  <button class="btn pri">登入</button>
  <p class="small" style="text-align:center;margin:14px 0 0;background:#fff4d6;padding:8px;border-radius:8px">帳號 <b>1111</b>　密碼 <b>1111</b><br>
  個案皆為假名；您的操作只存在自己的瀏覽器</p></form></div>`;

V.home = () => {
  const cs = activeClients(); const cnt = k => cs.filter(c => c.due.status === k).length; const ind = indicators(cs);
  const rank = { 逾期: 0, 未評估: 1, '30天內到期': 2 };
  const todo = cs.filter(c => c.due.status !== '正常').sort((a, b) => rank[a.due.status] - rank[b.due.status] || (a.due.next || '').localeCompare(b.due.next || '')).slice(0, 15);
  const recent = DB.assessments.filter(a => ['D61', 'ICOPE'].includes(a.type)).sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).slice(0, 8);
  const unkeyed = DB.assessments.filter(a => a.type === 'D61' && !a.keyed);
  const bar = (p) => `<div class="bar"><i style="width:${p}%"></i></div>`;
  return layout('home', `<div class="demo-note">👋 歡迎試用！這是去識別化的示範資料，可以隨意新增、修改。用完請按右上角 <b>💬</b> 告訴我們哪裡要增加或減少。</div>
  <div class="pagehead"><div><h1>今日待辦</h1><div class="muted">${rocLong(todayISO())}　在案 ${cs.length} 位</div></div><span class="sp"></span>
  <div class="btns"><a class="btn pri" href="#/assess/ICOPE/new">＋ 六力評估</a><a class="btn pri" href="#/assess/D61/new">＋ D61 評估</a></div></div>
  <div class="grid g4">
    <a class="stat bad" href="#/clients?due=逾期"><span>再評估逾期</span><b>${cnt('逾期')}</b><span class="small muted">超過 6 個月未評估</span></a>
    <a class="stat info" href="#/clients?due=30天內到期"><span>30 天內到期</span><b>${cnt('30天內到期')}</b><span class="small muted">請排入本月</span></a>
    <a class="stat warn" href="#/clients?due=未評估"><span>從未評估</span><b>${cnt('未評估')}</b><span class="small muted">需完成初評</span></a>
    <a class="stat ok" href="#/clients?due=正常"><span>期限內</span><b>${cnt('正常')}</b><span class="small muted">&nbsp;</span></a></div>
  <div class="grid g2" style="margin-top:16px"><div class="card"><h2>需安排評估（依急迫性）</h2>
    ${todo.length ? `<table class="t"><tr><th>個案</th><th>最近評估</th><th>應評估日</th><th>狀態</th><th></th></tr>
    ${todo.map(c => `<tr><td class="ttl"><a href="#/clients/${c.id}">${h(c.label)}</a></td><td>${roc(c.due.last) || '—'}</td><td>${roc(c.due.next) || '—'}</td>
      <td>${badge(c.due.status)}</td><td class="btns"><a class="btn sm" href="#/assess/ICOPE/new?client=${c.id}">評估</a></td></tr>`).join('')}</table>`
      : '<div class="empty">全部個案都在評估期限內 👍</div>'}</div>
  <div><div class="card"><h2>評鑑指標進度 <span class="small muted">（115 年 小規模多機能 附件2-3）</span></h2>
    <div style="margin-bottom:12px"><b>B1</b> 近 6 個月內完成評估　<span class="muted">${ind.b1[0]}／${ind.n} 位</span>${bar(ind.b1[1])}</div>
    <div style="margin-bottom:12px"><b>B9</b> 輔具佐證完整　<span class="muted">${ind.b9[0]}／${ind.b9[1]} 件</span>${bar(ind.b9[2])}</div>
    <div><b>B10</b> 有自立支援目標　<span class="muted">${ind.b10[0]}／${ind.n} 位；近 3 個月檢討 ${ind.b10[2]}／${ind.b10[3]} 項</span>${bar(ind.b10[1])}</div>
    <p style="margin:12px 0 0"><a href="#/reports">前往評鑑佐證／一鍵匯出 →</a></p></div>
  <div class="card"><h2>D61 尚未登打 care99 <span class="b warn">${unkeyed.length}</span></h2>
    ${unkeyed.length ? '<ul style="margin:0;padding-left:18px">' + unkeyed.map(a => { const c = client(a.client_id); return `<li><a href="#/a/${a.id}">${h(c.label)} ${roc(a.date)}</a></li>`; }).join('') + '</ul>' : '<div class="muted">都已登打完成</div>'}</div>
  <div class="card"><h2>最近編輯</h2>${recent.map(a => `<div><a href="#/a/${a.id}">${roc(a.date)}　${h(client(a.client_id).name)}　${a.type === 'ICOPE' ? '六力' : 'D61'}</a></div>`).join('') || '<div class="muted">尚無紀錄</div>'}</div>
  </div></div>`);
};

V.clients = (q) => {
  const st = q.status || '在案'; let cs = activeClients(st === '全部' ? null : st);
  if (q.q) cs = cs.filter(c => c.name.includes(q.q) || (c.case_no || '').toUpperCase().includes(q.q.toUpperCase()));
  if (q.due) cs = cs.filter(c => c.due.status === q.due);
  return layout('clients', `<div class="pagehead"><div><h1>B2 個案名冊</h1><div class="muted">共 ${cs.length} 位</div></div><span class="sp"></span>
  <a class="btn pri" href="#/clients/new">＋ 新增個案</a></div>
  <form class="card fr" onsubmit="return App.filter(event,'/clients')">
    <div><label class="f">狀態</label><select name="status">${opt(['在案', '暫停', '結案', '全部'], st)}</select></div>
    <div><label class="f">評估狀態</label><select name="due"><option value="">全部</option>${opt(['逾期', '30天內到期', '未評估', '正常'], q.due)}</select></div>
    <div><label class="f">姓名／案號</label><input type="search" name="q" value="${h(q.q || '')}"></div>
    <div><button class="btn pri">查詢</button></div></form>
  <div class="tbl-wrap"><table class="t"><tr><th>案號</th><th>姓名</th><th>性別</th><th class="c">年齡</th><th>現有服務</th><th>最近 D61</th><th>最近六力</th><th>下次應評估</th><th>狀態</th><th></th></tr>
  ${cs.map(c => `<tr><td class="hide-m">${h(c.case_no)}</td><td class="ttl"><a href="#/clients/${c.id}"><b>${h(c.name)}</b></a> <span class="m-only muted small">${h(c.case_no)}・${h(c.gender)}・${c.age ?? '?'} 歲</span></td>
    <td class="hide-m">${h(c.gender)}</td><td class="c hide-m">${c.age ?? ''}</td><td class="small hide-m">${h(c.services)}</td>
    <td>${roc(c.due.last_d61) || '—'}</td><td>${roc(c.due.last_icope) || '—'}</td><td>${roc(c.due.next) || '—'}</td><td>${badge(c.due.status)}</td>
    <td class="btns wide"><a class="btn sm" href="#/assess/ICOPE/new?client=${c.id}">六力</a><a class="btn sm" href="#/assess/D61/new?client=${c.id}${c.due.last_icope ? '&from=icope' : ''}">D61</a></td></tr>`).join('')
    || '<tr><td colspan="10" class="empty">沒有資料</td></tr>'}</table></div>`);
};

V.clientForm = (id) => {
  const c = id ? DB.clients.find(x => x.id === +id) : { status: '在案' };
  const F = [['case_no', '案號'], ['name', '姓名'], ['birth', '出生日期（民國 例 32/10/10）']];
  const G = [['services', '現有服務'], ['supervisor', '主責督導'], ['living', '居住情況'], ['identity', '身份別／收入別'], ['diagnosis', '診斷／病史'], ['phone', '電話（主）'], ['phone2', '電話（次）／聯絡人']];
  const inp = ([k, l]) => `<div><label class="f">${l}</label><input type="text" name="${k}" value="${h(k === 'birth' ? roc(c[k]) : c[k])}" style="width:100%"></div>`;
  return layout('clients', `<div class="pagehead"><h1>${id ? '編輯個案' : '新增個案'}</h1></div>
  <form class="card" onsubmit="return App.saveClient(event,${id || 0})"><div class="grid g3">${F.map(inp).join('')}
    <div><label class="f">性別</label><select name="gender" style="width:100%">${opt(['', '女', '男'], c.gender)}</select></div>
    <div><label class="f">狀態</label><select name="status" style="width:100%">${opt(['在案', '暫停', '結案'], c.status)}</select></div>${G.map(inp).join('')}</div>
    <div style="margin-top:12px"><label class="f">通訊地址</label><input type="text" name="address" value="${h(c.address)}" style="width:100%"></div>
    <div style="margin-top:12px"><label class="f">OT 備註</label><textarea name="note">${h(c.note)}</textarea></div>
    <div class="btns" style="margin-top:14px"><button class="btn pri">儲存</button>${id ? `<a class="btn" href="#/clients/${id}">取消</a>` : ''}</div></form>`);
};

function aidForm(x, cid, back, withClient) {
  const cats = ['行動', '進食', '如廁沐浴', '穿著', '溝通', '擺位', '其他'];
  return `<form class="fr" style="margin:8px 0" onsubmit="return App.saveAid(event,${x.id || 0},'${back}')">
  ${withClient ? `<div><label class="f">個案</label><select name="client_id" required><option value="">請選擇</option>${clientOpts(x.client_id)}</select></div>` : `<input type="hidden" name="client_id" value="${cid}">`}
  <div><label class="f">輔具／用品</label><input type="text" name="item" value="${h(x.item)}" list="aidlist" required></div>
  <div><label class="f">類別</label><select name="category">${opt(cats, x.category)}</select></div>
  <div><label class="f">來源</label><select name="source">${opt(['', '中心提供', '自備', '租借', '政府補助'], x.source)}</select></div>
  ${[['start_date', '開始使用'], ['fit_date', '適配評估日'], ['train_date', '使用訓練日'], ['check_date', '最近檢查日']].map(([k, l]) => `<div><label class="f">${l}</label><input type="date" name="${k}" value="${h(x[k])}"></div>`).join('')}
  <div><label class="f">狀態</label><select name="status">${opt(['使用中', '停用'], x.status)}</select></div>
  <div style="flex:1"><label class="f">備註</label><input type="text" name="note" value="${h(x.note)}"></div>
  <div class="btns"><button class="btn pri">${x.id ? '更新' : '新增'}</button>${x.id ? `<button type="button" class="btn danger" onclick="App.delAid(${x.id},'${back}')">刪除</button>` : ''}</div></form>
  <datalist id="aidlist">${['助行器', '四腳助行器', '帶輪助行器', '單手拐杖', '單手四腳拐杖', '輪椅', '高背輪椅', '爬梯機', '洗澡椅', '便盆椅', '扶手', '防滑墊', '加粗握柄湯匙', '彎角湯匙', '防滑碗', '斜口杯', '穿襪輔具', '長柄取物夾', '助聽器', '老花眼鏡'].map(s => `<option>${s}</option>`).join('')}</datalist>`;
}
const DOMAINS = ['行動／肌力平衡', '認知', '日常生活自立', '社會參與', '感官', '情緒', '營養', '其他'];
function goalForm(x, cid, back, withClient) {
  return `<form class="fr" style="margin:8px 0" onsubmit="return App.saveGoal(event,${x.id || 0},'${back}')">
  ${withClient ? `<div><label class="f">個案</label><select name="client_id" required><option value="">請選擇</option>${clientOpts(x.client_id)}</select></div>` : `<input type="hidden" name="client_id" value="${cid}">`}
  <div><label class="f">面向</label><select name="domain">${opt(DOMAINS, x.domain)}</select></div>
  <div style="flex:2 1 240px"><label class="f">目標（具體、可觀察）</label><input type="text" name="goal" value="${h(x.goal)}" required placeholder="例：起立坐下 5 次縮短至 12 秒內"></div>
  <div style="flex:2 1 220px"><label class="f">方法</label><input type="text" name="method" value="${h(x.method)}"></div>
  <div style="flex:1 1 160px"><label class="f">基準（目前表現）</label><input type="text" name="baseline" value="${h(x.baseline)}"></div>
  <div><label class="f">開始日</label><input type="date" name="start_date" value="${h(x.start_date || todayISO())}"></div>
  <div><label class="f">預定檢討日</label><input type="date" name="review_date" value="${h(x.review_date || addMonths(todayISO(), 3))}"></div>
  ${x.id ? `<div><label class="f">狀態</label><select name="status">${opt(['進行中', '達成', '停止'], x.status)}</select></div>` : ''}
  <div class="btns"><button class="btn pri">${x.id ? '更新' : '新增目標'}</button>${x.id ? `<button type="button" class="btn danger" onclick="App.delGoal(${x.id},'${back}')">刪除</button>` : ''}</div></form>`;
}
const reviewForm = (gl, back) => `<form class="fr" style="margin:6px 0" onsubmit="return App.saveReview(event,${gl.id},'${back}')">
  <div><label class="f">檢討日</label><input type="date" name="date" value="${todayISO()}"></div>
  <div><label class="f">進展</label><select name="progress">${opt(['進步', '維持', '退步', '達成', '未達成停止'])}</select></div>
  <div style="flex:1 1 220px"><label class="f">說明（具體表現）</label><input type="text" name="note" placeholder="例：坐站 5 次 13.2 秒，仍需扶手"></div>
  <div><label class="f">下次檢討</label><input type="date" name="next_review"></div>
  <div class="btns"><button class="btn">＋ 新增檢討</button></div></form>`;

V.client = (id) => {
  const b = bundle(id); const c = b.c; if (!c) return V.notFound(); const back = `/clients/${id}`;
  const newIc = `#/assess/ICOPE/new?client=${id}${b.ics.length ? '&from=last' : ''}`;
  const newD = `#/assess/D61/new?client=${id}${b.ics.length ? '&from=icope' : (b.d61s.length ? '&from=last' : '')}`;
  const tl = b.all.map(a => a.type.includes('HIST')
    ? `<li class="hist"><b>${roc(a.date)}</b>　${a.type.startsWith('D61') ? 'D61' : '六力'}（歷史紀錄）<span class="muted small">${h(a.note)}</span></li>`
    : `<li><a href="#/a/${a.id}"><b>${roc(a.date)}</b>　${a.type === 'D61' ? 'D61 職能治療評估' : '六力 ICOPE 評估'}</a> <span class="muted small">${h(a.kind)}・${h(a.assessor)}</span>
      ${a.type === 'ICOPE' ? `<div class="small">${icopeAbn(a.data).length ? '異常：' + icopeAbn(a.data).map(x => badge(x, '異常')).join(' ') : badge('六力皆正常', '正常')}</div>` : (!a.keyed ? badge('未登打 care99', 'warn') : '')}</li>`).join('') || '<li class="hist">尚無評估紀錄</li>';
  const tr = b.trend, dt = b.d61trend;
  return layout('clients', `<div class="pagehead"><div><h1>${h(c.name)} <span class="muted" style="font-size:16px">${h(c.case_no)}</span> ${badge('評估：' + b.due.status, b.due.status)}</h1>
    <div class="muted">${h(c.gender)}・${c.age ?? '?'} 歲・${h(c.services)}・${h(c.status)}</div></div><span class="sp"></span>
    <div class="btns"><a class="btn pri" href="${newIc}">＋ 六力評估</a><a class="btn pri" href="${newD}">＋ D61 評估</a><a class="btn" href="#/clients/${id}/edit">編輯資料</a></div></div>
  <div class="card btns"><b>個案評估彙整（評鑑用）：</b><button class="btn sm" onclick="App.preview('client',${id})">預覽／列印／PDF</button><button class="btn sm" onclick="App.word('client',${id})">下載 Word</button></div>
  <div class="grid g2"><div class="card"><h2>基本資料</h2><dl class="kv">
    ${[['出生日期', roc(c.birth)], ['主責督導', c.supervisor], ['居住情況', c.living], ['身份別', c.identity], ['診斷／病史', c.diagnosis], ['電話', [c.phone, c.phone2].filter(Boolean).join(' ')], ['地址', c.address], ['OT 備註', c.note], ['最近評估', roc(b.due.last)]]
      .map(([k, v]) => `<dt>${k}</dt><dd>${h(v) || '—'}</dd>`).join('')}<dt>下次應評估</dt><dd><b>${roc(b.due.next) || '—'}</b> ${badge(b.due.status)}</dd></dl></div>
  <div class="card"><h2>評估歷程</h2><ul class="tl">${tl}</ul></div></div>
  ${tr.dates.length ? `<div class="card"><h2>六力歷次結果</h2><div class="tbl-wrap"><table class="t trend"><tr><th>面向</th>${tr.dates.map(d => `<th class="c">${roc(d)}</th>`).join('')}</tr>
    ${tr.rows.map(([l, v]) => `<tr><td><b>${l}</b></td>${v.map(x => `<td class="c">${badge(x)}</td>`).join('')}</tr>`).join('')}
    <tr><td><b>起立坐下（秒）</b><div class="small muted">標準 ≤12 秒</div></td>${tr.secs.map(v => `<td class="c">${v === null ? '—' : `<b style="color:${v > 12 ? '#c0392b' : '#2e7d4f'}">${v}</b>`}</td>`).join('')}</tr></table></div></div>` : ''}
  ${dt.dates.length ? `<div class="card"><h2>D61 歷次比較</h2>
    ${b.changes.length ? `<div class="src">最近兩次的變化：<ul class="changes" style="margin:4px 0 0">${b.changes.map(([l, a1, a2, k]) => `<li class="${k}">${h(l)}：${h(a1)} → <b>${h(a2)}</b>（${k}）</li>`).join('')}</ul></div>` : ''}
    <div class="tbl-wrap"><table class="t trend"><tr><th>項目</th>${dt.dates.map(d => `<th class="c">${roc(d)}</th>`).join('')}</tr>
    ${dt.rows.map(([l, v, o]) => `<tr><td>${h(l)}</td>${v.map(x => `<td class="c">${o && x && x !== o[0] ? badge(x, 'bad') : (h(x) || '—')}</td>`).join('')}</tr>`).join('')}</table></div></div>` : ''}
  <div class="card"><h2>B9 輔具使用</h2>${b.aids.length ? `<div class="tbl-wrap"><table class="t"><tr><th>輔具</th><th>類別</th><th>來源</th><th>開始使用</th><th>適配評估</th><th>使用訓練</th><th>最近檢查</th><th>狀態</th><th>備註</th><th></th></tr>
    ${b.aids.map(x => `<tr><td class="ttl"><b>${h(x.item)}</b></td><td>${h(x.category)}</td><td>${h(x.source) || '—'}</td>
      ${['start_date', 'fit_date', 'train_date', 'check_date'].map(k => `<td>${x[k] ? roc(x[k]) : (x.status === '使用中' && k !== 'check_date' ? badge('待補', 'warn') : '—')}</td>`).join('')}
      <td>${h(x.status)}</td><td class="small wide">${h(x.note)}</td><td class="wide"><details><summary class="btn sm">編輯</summary>${aidForm(x, id, back)}</details></td></tr>`).join('')}</table></div>` : ''}
    <details class="box" style="margin-top:8px"><summary>＋ 新增輔具</summary>${aidForm({}, id, back)}</details></div>
  <div class="card"><h2>B10 自立支援／復能目標</h2>
    ${b.goals.map(gl => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:10px">
      <div>${badge(gl.status, gl.status === '達成' ? 'ok' : (gl.status === '進行中' ? 'info' : ''))} <b>【${h(gl.domain)}】${h(gl.goal)}</b></div>
      <div class="small muted">方法：${h(gl.method) || '—'}｜基準：${h(gl.baseline) || '—'}｜開始 ${roc(gl.start_date)}｜檢討日 ${roc(gl.review_date) || '—'}</div>
      ${gl.reviews.length ? `<ul class="small" style="margin:6px 0">${gl.reviews.map(r => `<li>${roc(r.date)} ${badge(r.progress)} ${h(r.note)}</li>`).join('')}</ul>` : ''}
      ${gl.status === '進行中' ? reviewForm(gl, back) : ''}<details><summary class="small muted">編輯／刪除</summary>${goalForm(gl, id, back)}</details></div>`).join('')
      || `<div class="muted">尚未建立目標。${b.ics.length ? `可從 <a href="#/goals/from/${b.ics[0].id}">最近一次六力結果自動建議目標</a>。` : ''}</div>`}
    <details class="box"><summary>＋ 新增目標</summary>${goalForm({}, id, back)}</details></div>`);
};

V.assessList = (typ, q) => {
  let rows = DB.assessments.filter(a => a.type === typ || a.type === typ + '_HIST');
  if (q.from) rows = rows.filter(a => a.date >= q.from); if (q.to) rows = rows.filter(a => a.date <= q.to);
  if (q.q) rows = rows.filter(a => { const c = client(a.client_id); return c.name.includes(q.q) || (c.case_no || '').includes(q.q) || (a.assessor || '').includes(q.q); });
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return layout(typ, `<div class="pagehead"><div><h1>${typ === 'D61' ? 'D61 職能治療評估' : '六力 ICOPE 評估'}</h1><div class="muted">共 ${rows.length} 筆</div></div>
  <span class="sp"></span><a class="btn pri" href="#/assess/${typ}/new">＋ 新增資料</a></div>
  <form class="card fr" onsubmit="return App.filter(event,'/assess/${typ}')">
    <div><label class="f">評估日期</label><span><input type="date" name="from" value="${h(q.from || '')}"> 至 <input type="date" name="to" value="${h(q.to || '')}"></span></div>
    <div><label class="f">評估對象／填表人</label><input type="search" name="q" value="${h(q.q || '')}"></div><div class="btns"><button class="btn pri">🔍 查詢</button></div></form>
  <div class="tbl-wrap"><table class="t"><tr><th>評估日期</th><th>評估對象</th><th>填表人</th><th>類別</th>${typ === 'D61' ? '<th>整體評估建議</th><th>care99</th>' : '<th>異常面向</th><th>下次再評估</th>'}<th></th></tr>
  ${rows.map(r => { const c = client(r.client_id);
    const head = `<td>${roc(r.date)}</td><td class="ttl"><a href="#/clients/${c.id}">${h(c.name)}</a> <span class="muted small">${h(c.case_no)}</span></td><td>${h(r.assessor)}</td><td>${h(r.kind)}</td>`;
    if (r.type.includes('HIST')) return `<tr>${head}<td colspan="2" class="muted small wide">${h(r.note)}</td><td class="hide-m"></td></tr>`;
    const mid = typ === 'D61' ? `<td class="small wide">${h((r.summary || '').slice(0, 90))}${(r.summary || '').length > 90 ? '…' : ''}</td><td>${r.keyed ? badge('已登打', 'ok') : badge('未登打', 'warn')}</td>`
      : `<td class="wide">${icopeAbn(r.data).map(x => badge(x, '異常')).join(' ') || badge('皆正常', '正常')}</td><td>${roc(r.next_due)}</td>`;
    return `<tr>${head}${mid}<td class="btns wide"><a class="btn sm" href="#/a/${r.id}">檢視</a><a class="btn sm" href="#/assess/${typ}/${r.id}/edit">修改</a></td></tr>`; }).join('')
    || '<tr><td colspan="7" class="empty">查無資料</td></tr>'}</table></div>`);
};

/* ---------- 評估表單 ---------- */
function formbar(c, m, isEdit, typ) {
  return `<div class="formbar"><div class="fr">
    <div><label class="f">評估對象</label><select name="client_id" required ${isEdit ? '' : `onchange="App.go('/assess/${typ}/new?client='+this.value)"`} style="min-width:200px">
      <option value="">— 請選擇個案 —</option>${clientOpts(c && c.id)}</select></div>
    <div><label class="f">評估日期</label><input type="date" name="date" value="${h(m.date)}" required></div>
    <div><label class="f">類別</label><select name="kind">${opt(['初評', '再評估', '提前再評估（跌倒/住院/退化）'], m.kind)}</select></div>
    <div><label class="f">評估者</label><input type="text" name="assessor" value="${h(m.assessor)}" style="width:120px"></div>
    <span style="flex:1"></span><div class="btns hide-m"><button class="btn pri">💾 儲存</button></div></div></div>
    ${c ? '<button class="fab-save" type="submit">💾 儲存</button>' : ''}`;
}
function prepForm(typ, id, q) {
  const a = id ? assess(id) : null; const cid = +(q.client || (a && a.client_id) || 0); const c = cid ? client(cid) : null;
  let data = a ? a.data : {}, prev = null, src = '';
  if (c) {
    const same = clientAssess(cid, [typ]).filter(x => !a || x.id !== a.id);
    prev = same.find(x => !a || x.date < a.date || (x.date === a.date && x.id < a.id)) || null;
    if (!a && q.from === 'last' && prev) { data = JSON.parse(JSON.stringify(prev.data)); src = `已帶入上次（${roc(prev.date)}）內容，請逐項確認修改`; }
    if (!a && typ === 'D61' && q.from === 'icope') { const ic = clientAssess(cid, ['ICOPE'])[0];
      if (ic) { data = icopeToD61(ic.data, prev ? prev.data : {}); src = `已依六力評估（${roc(ic.date)}）帶入認知、感官、功能性動作與治療計畫` + (prev ? '，其餘沿用上次 D61' : ''); } }
  }
  const m = { date: a ? a.date : todayISO(), assessor: a ? a.assessor : '示範治療師', kind: a ? a.kind : (prev ? '再評估' : '初評'),
    summary: a ? a.summary : '', note: a ? a.note : '', next_due: a ? a.next_due : addMonths(todayISO(), +setting('reeval_months') || 6), keyed: a ? a.keyed : 0 };
  return { a, c, data, prev, src, m, icLatest: c ? clientAssess(cid, ['ICOPE'])[0] : null };
}
V.d61Form = (id, q) => {
  const { a, c, data, prev, src, m, icLatest } = prepForm('D61', id, q);
  const secs = S.D61.map(sec => {
    const hasRadio = sec.fields.some(f => f.type === 'radio');
    return `<div class="card sec"><div><div class="no">序號 ${sec.no}</div><div class="ttl">${sec.title}</div>
      ${hasRadio ? '<button type="button" class="btn sm" style="margin-top:6px" onclick="App.allNormal(this)">本區全部正常</button>' : ''}</div><div>
      ${sec.fields.map(f => { const v = data[f.key]; const pv = prev ? prev.data[f.key] : null;
        let inner;
        if (f.type === 'multi') inner = `<div class="pills">${f.options.map(o => `<label class="pill ${['adl_help', 'bpsd'].includes(f.key) ? 'bad' : ''}"><input type="checkbox" name="${f.key}" value="${h(o)}" ${(v || []).includes(o) ? 'checked' : ''}><span>${h(o)}</span></label>`).join('')}</div>
          ${f.other ? `<input type="text" class="other" name="${f.key}_other" value="${h(data[f.key + '_other'])}" placeholder="其他：">` : ''}${pv && pv.length ? `<div class="small muted" style="margin-top:4px">上次：${h(pv.join('、'))}</div>` : ''}`;
        else if (f.type === 'radio') inner = `<div class="pills" data-prev="${h(pv || '')}">${f.options.map((o, i) => `<label class="pill ${i ? 'bad' : ''}"><input type="radio" name="${f.key}" value="${h(o)}" ${v === o ? 'checked' : ''}><span>${h(o)}</span></label>`).join('')}</div>
          ${f.note ? `<input type="text" class="note-in" name="${f.key}_note" value="${h(data[f.key + '_note'])}" placeholder="備註部位／說明">` : ''}`;
        else inner = `<input type="text" name="${f.key}" value="${h(v)}" style="width:100%">`;
        return `<div class="fld ${f.type !== 'radio' ? 'wide' : ''}"><div class="lb">${h(f.label)}${f.hint ? `<div class="hint">${h(f.hint)}</div>` : ''}</div><div>${inner}</div>
          ${f.type === 'radio' ? `<div class="prev">${pv ? '上次：' + h(pv) : ''}</div>` : ''}</div>`; }).join('')}
      <div class="fld wide"><div class="lb muted">備註</div><input type="text" name="s${sec.no}_note" value="${h(data['s' + sec.no + '_note'])}" style="width:100%"></div></div></div>`;
  }).join('');
  return layout('D61', `<div class="pagehead"><div><h1>D61 職能治療評估 ${a ? '（編輯）' : '（新增）'}</h1><div class="muted small">欄位與 care99 D61 相同，存檔後可對照登打、匯出 Word／PDF</div></div></div>
  <form id="f" onsubmit="return App.saveAssess(event,'D61',${id || 0})">${formbar(c, m, !!a, 'D61')}
  ${!c ? '<div class="card empty">請先在上方選擇評估對象</div>' : `${src ? `<div class="src">ℹ️ ${h(src)}</div>` : ''}
  ${!a ? `<div class="card btns small">快速帶入：${prev ? `<a class="btn sm" href="#/assess/D61/new?client=${c.id}&from=last">📋 帶入上次 D61（${roc(prev.date)}）</a>` : ''}
    ${icLatest ? `<a class="btn sm" href="#/assess/D61/new?client=${c.id}&from=icope">🧭 依六力結果帶入（${roc(icLatest.date)}）</a>` : ''}
    ${!prev && !icLatest ? '<span class="muted">此個案尚無前次評估，建議先做六力評估再帶入。</span>' : ''}</div>` : ''}
  ${secs}
  <div class="card sum-box"><div class="fr" style="justify-content:space-between"><h2 style="margin:0">整體評估建議</h2>
    <div class="btns"><label class="small"><input type="checkbox" id="with_icope" ${icLatest ? 'checked' : ''}> 納入最近六力結果</label>
    <button type="button" class="btn acc" onclick="App.genNarr()">✨ 依勾選自動產生</button></div></div>
    <p class="muted small" style="margin:4px 0 8px">自動產生的是初稿，請依個案狀況修改。</p>
    <textarea name="summary" id="summary" style="min-height:160px">${h(m.summary)}</textarea>
    <div class="grid g3" style="margin-top:12px"><div><label class="f">備註</label><input type="text" name="note" value="${h(m.note)}" style="width:100%"></div>
      <div><label class="f">下次再評估日（預設 6 個月後）</label><input type="date" name="next_due" value="${h(m.next_due)}"></div>
      <div><label class="f">care99 登打</label><label><input type="checkbox" name="keyed" value="1" ${m.keyed ? 'checked' : ''}> 已登打到 care99 D61</label></div></div>
    <div class="btns" style="margin-top:14px"><button class="btn pri">💾 儲存評估</button></div></div>`}</form>`);
};
V.icopeForm = (id, q) => {
  const { a, c, data, prev, src, m } = prepForm('ICOPE', id, q); const j = icopeAuto(data); const Q = S.ICOPE_Q;
  const radio = k => `<div class="pills">${Q[k][1].map(o => `<label class="pill ${BAD_OPTS.includes(o) ? 'bad' : ''}"><input type="radio" name="${k}" value="${h(o)}" ${data[k] === o ? 'checked' : ''}><span>${h(o)}</span></label>`).join('')}</div>`;
  const qq = k => `<div class="q"><div class="ql">${h(Q[k][0])}</div>${radio(k)}</div>`;
  const txt = (k, lbl, ph = '') => `<div class="q"><div class="ql" style="flex:0 0 auto">${lbl}</div><input type="text" name="${k}" value="${h(data[k])}" style="flex:1" placeholder="${h(ph)}"></div>`;
  const dom = (k, label, sub, inner) => `<div class="card dom ${j[k] || ''}" id="dom_${k}">
    <div class="fr" style="justify-content:space-between;align-items:center;margin-bottom:4px"><h2 style="margin:0">${label} <span class="small muted" style="font-weight:400">${sub}</span></h2>
      <div class="btns small">判定：<span class="b judge ${j[k] || ''}" id="j_${k}">${j[k] || '未填'}</span>
      <select name="${k}_judge" style="font-size:13px;padding:3px 6px">${(['med', 'soc'].includes(k) ? ['', '無異常', '需追蹤'] : ['', '正常', '異常']).map(o => `<option value="${o}" ${(data[k + '_judge'] || '') === o ? 'selected' : ''}>${o || '自動判定'}</option>`).join('')}</select></div></div>
    ${inner}${txt(k + '_finding', '說明', '結果說明（會印在表單上）')}
    <div class="act"><div class="small muted" style="margin-bottom:4px">後續處置（只列介入／團體／轉介）</div>
      <div class="pills">${S.SUGGEST[k].map(s => `<label class="pill"><input type="checkbox" name="${k}_actions" value="${h(s)}" ${(data[k + '_actions'] || []).includes(s) ? 'checked' : ''}><span>${h(s)}</span></label>`).join('')}</div>
      <input type="text" class="other" name="${k}_actions_other" value="${h(data[k + '_actions_other'])}" placeholder="其他處置" style="width:100%"></div></div>`;
  const aid0 = c ? (aidsOf(c.id).find(x => x.status === '使用中' && x.category === '行動') || {}).item : '';
  const left = dom('cog', '認知', '', qq('cog_memory') + `<div class="q"><div class="ql">定向：今天是哪年、哪月、哪日？現在在哪裡？</div></div>
      <div class="q" style="border-top:0;padding-top:0">${['cog_year', 'cog_month', 'cog_day', 'cog_place'].map(k => `<span style="display:flex;gap:6px;align-items:center"><b>${Q[k][0]}</b>${radio(k)}</span>`).join('')}</div>`)
    + dom('mob', '行動', '起立坐下 5 次，標準：雙手抱胸、12 秒內完成', `<div class="q"><div class="ql">完成時間</div><input type="number" step="0.1" min="0" inputmode="decimal" name="mob_seconds" value="${h(data.mob_seconds)}" style="width:100px"> 秒</div>
      <div class="q"><div class="ql">方式</div>${radio('mob_method')}</div>
      <div class="q"><div class="ql">日常行走（輔具）</div><input type="text" name="mob_aid" value="${h(data.mob_aid ?? aid0 ?? '')}" list="mobaids" style="width:130px" placeholder="無／助行器…">${radio('mob_supervise')}</div>
      <datalist id="mobaids">${['無', '單手拐杖', '單手四腳拐杖', '助行器', '帶輪助行器', '輪椅'].map(s => `<option>${s}</option>`).join('')}</datalist>`)
    + dom('nut', '營養', '', qq('nut_weight') + qq('nut_appetite'))
    + dom('med', '用藥評估', '後續評估', qq('med_10') + qq('med_sleep') + qq('med_pain') + txt('med_note', '用藥說明', '例：偶爾服用止痛藥'));
  const right = dom('vis', '視力', '看遠、看近或閱讀時，是否有困難？', `<div class="q"><div class="ql">看遠</div>${radio('vis_far')}</div><div class="q"><div class="ql">看近／閱讀</div>${radio('vis_near')}</div>
      <div class="q"><div class="ql">老花眼鏡</div>${radio('vis_glasses')}</div><div class="q"><div class="ql">過去一年做過眼科檢查</div>${radio('vis_exam')}<input type="text" name="vis_exam_note" value="${h(data.vis_exam_note)}" placeholder="原因（如：個案不想）" style="width:160px"></div>`)
    + dom('hear', '聽力', '氣音測試 6-1-9／2-5-7', `<div class="q"><div class="ql">右耳</div>${radio('hear_r')}</div><div class="q"><div class="ql">左耳</div>${radio('hear_l')}</div>${txt('hear_note', '原因／說明', '例：右耳先天聽損，已用左耳代償')}`)
    + dom('dep', '憂鬱（情緒）', '', qq('dep_low') + qq('dep_interest') + txt('dep_note', '情緒狀況', '例：穩定'))
    + dom('soc', '社會照護與支持', '後續評估', qq('soc_adl') + txt('soc_note', '說明', '例：獨立'));
  return layout('ICOPE', `<div class="pagehead"><div><h1>六力 ICOPE 評估 ${a ? '（編輯）' : '（新增）'}</h1><div class="muted small">依國健署「長者功能評估」六大面向；系統自動判定，可手動修正</div></div></div>
  <form id="f" onsubmit="return App.saveAssess(event,'ICOPE',${id || 0})"><input type="hidden" name="_action" id="_action" value="">${formbar(c, m, !!a, 'ICOPE')}
  ${!c ? '<div class="card empty">請先在上方選擇評估對象</div>' : `${src ? `<div class="src">ℹ️ ${h(src)}</div>` : ''}
  ${!a && prev ? `<div class="card btns small">上次六力：${roc(prev.date)}（異常：${icopeAbn(prev.data).join('、') || '無'}）${!src ? `<a class="btn sm" href="#/assess/ICOPE/new?client=${c.id}&from=last">📋 帶入上次內容再修改</a>` : ''}</div>` : ''}
  <div class="grid g2"><div>${left}</div><div>${right}</div></div>
  <div class="card sum-box"><h2>本次結果：<span id="sumline">—</span></h2>
    <div class="grid g2"><div><label class="f">目標</label><textarea name="goal_text" style="min-height:70px">${h(data.goal_text)}</textarea></div>
      <div><label class="f">資源連結</label><textarea name="resource_text" style="min-height:70px" placeholder="例：社工排入運動團體、認知團體">${h(data.resource_text)}</textarea></div></div>
    <div class="fr" style="justify-content:space-between;margin-top:10px"><label class="f" style="margin:0">職能治療處置建議</label><div class="btns"><button type="button" class="btn sm acc" onclick="App.genPlan()">✨ 依勾選的後續處置產生</button></div></div>
    <textarea name="plan_text" id="plan_text" style="min-height:120px;margin-top:4px">${h(data.plan_text)}</textarea>
    <div class="fr" style="margin-top:12px"><div><label class="f">下次再評估（預設 6 個月）</label><input type="date" name="next_due" value="${h(m.next_due)}"></div>
      <div style="flex:1"><label class="f">備註</label><input type="text" name="note" value="${h(m.note)}" style="width:100%"></div></div>
    <div class="btns" style="margin-top:14px"><button class="btn pri">💾 儲存</button><button class="btn acc" onclick="document.getElementById('_action').value='goals'">💾 儲存並建立自立支援目標 →</button></div></div>`}</form>`);
};

V.assessView = (id) => {
  const a = assess(id); if (!a || a.type.includes('HIST')) return V.notFound(); const c = client(a.client_id); const j = icopeAuto(a.data);
  let prev = null, changes = [];
  if (a.type === 'D61') { prev = clientAssess(c.id, ['D61']).find(x => x.date < a.date || (x.date === a.date && x.id < a.id)); if (prev) changes = compareD61(prev.data, a.data); }
  return layout(a.type, `<div class="pagehead"><div><h1>${a.type === 'D61' ? 'D61 職能治療評估' : '六力 ICOPE 評估'}</h1>
    <div class="muted"><a href="#/clients/${c.id}">${h(c.label)}</a>・${rocLong(a.date)}・${h(a.kind)}・${h(a.assessor)}</div></div><span class="sp"></span>
    <div class="btns"><a class="btn" href="#/assess/${a.type}/${a.id}/edit">✏️ 編輯</a><button class="btn" onclick="App.preview('a',${a.id})">🖨 列印／PDF</button><button class="btn pri" onclick="App.word('a',${a.id})">Word</button></div></div>
  <div class="grid view-grid">
    <div class="card show-m"><button class="btn pri" style="width:100%;justify-content:center" onclick="App.preview('a',${a.id})">📄 全螢幕預覽表單（可雙指放大）</button>
      <h3 style="margin-top:14px">${a.type === 'D61' ? '整體評估建議' : '職能治療處置建議'}</h3><p style="white-space:pre-wrap;margin:0">${h((a.type === 'D61' ? a.summary : a.data.plan_text) || '（未填）')}</p>
      <p class="small muted" style="margin:8px 0 0">下次再評估：${roc(a.next_due) || '—'}</p></div>
    <div class="card frame-card hide-m" style="padding:0;overflow:hidden"><iframe class="preview" id="pv"></iframe></div>
    <div>${a.type === 'D61' ? `<div class="card"><h2>care99 登打</h2>${a.keyed ? badge('已登打', 'ok') : badge('尚未登打', 'warn')}
        <button class="btn sm ${a.keyed ? '' : 'pri'}" onclick="App.toggleKeyed(${a.id})">${a.keyed ? '改為未登打' : '標記為已登打'}</button>
        <p class="small muted">表單欄位順序與 care99 D61 相同，可對照逐項勾選。</p><button class="btn sm" onclick="App.copy(${a.id},this)">複製「整體評估建議」</button></div>
      ${changes.length ? `<div class="card"><h2>與上次（${roc(prev.date)}）比較</h2><ul class="changes small" style="padding-left:18px;margin:0">${changes.map(([l, a1, a2, k]) => `<li class="${k}">${h(l)}：${h(a1)} → <b>${h(a2)}</b>（${k}）</li>`).join('')}</ul></div>` : ''}`
      : `<div class="card"><h2>判定</h2>${S.ICOPE_ALL.map(([k, l]) => `<div style="display:flex;justify-content:space-between;padding:3px 0"><span>${l}</span>${badge(j[k])}</div>`).join('')}</div>
      <div class="card"><h2>下一步</h2><a class="btn pri" href="#/assess/D61/new?client=${c.id}&from=icope">→ 依此結果建立 D61</a> <a class="btn" style="margin-top:8px" href="#/goals/from/${a.id}">→ 建立自立支援目標</a></div>`}
      <div class="card"><button class="btn sm danger" onclick="App.delAssess(${a.id})">刪除此評估</button></div></div></div>`);
};

V.aids = (q) => {
  const ids = new Set(activeClients().map(c => c.id)); let rows = DB.aids.filter(a => ids.has(a.client_id));
  if (q.miss) rows = rows.filter(r => r.status === '使用中' && !(r.start_date && r.fit_date && r.train_date));
  rows.sort((a, b) => (client(a.client_id).case_no || '').localeCompare(client(b.client_id).case_no || ''));
  return layout('aids', `<div class="pagehead"><div><h1>B2c 輔具管理 <span class="small muted">（評鑑 B9）</span></h1><div class="muted">評鑑佐證需有：開始使用日、適配評估、使用訓練；定期檢查保養</div></div><span class="sp"></span>
  <div class="btns"><a class="btn ${q.miss ? 'pri' : ''}" href="#/aids?miss=1">只看待補資料</a><a class="btn" href="#/aids">全部</a><button class="btn" onclick="App.preview('list','aids')">🖨 列印清單</button></div></div>
  <details class="card box"><summary>＋ 新增輔具</summary>${aidForm({}, 0, '/aids', true)}</details>
  <div class="tbl-wrap"><table class="t"><tr><th>案號</th><th>姓名</th><th>輔具／用品</th><th>類別</th><th>來源</th><th>開始使用</th><th>適配評估</th><th>使用訓練</th><th>最近檢查</th><th>狀態</th><th>備註</th><th></th></tr>
  ${rows.map(x => { const c = client(x.client_id); return `<tr><td class="hide-m">${h(c.case_no)}</td><td class="ttl"><b>${h(x.item)}</b>　<a href="#/clients/${c.id}">${h(c.name)}</a> <span class="m-only muted small">${h(c.case_no)}</span></td><td class="hide-m"><b>${h(x.item)}</b></td>
    <td>${h(x.category)}</td><td>${h(x.source) || '—'}</td>${['start_date', 'fit_date', 'train_date', 'check_date'].map(k => `<td>${x[k] ? roc(x[k]) : (x.status === '使用中' && k !== 'check_date' ? badge('待補', 'warn') : '—')}</td>`).join('')}
    <td>${h(x.status)}</td><td class="small wide">${h(x.note)}</td><td class="wide"><details><summary class="btn sm">編輯</summary>${aidForm(x, x.client_id, '/aids')}</details></td></tr>`; }).join('')
    || '<tr><td colspan="12" class="empty">沒有資料</td></tr>'}</table></div>`);
};

V.goals = (q) => {
  const st = q.status || '進行中'; const ids = new Set(activeClients().map(c => c.id));
  let rows = DB.goals.filter(g => ids.has(g.client_id) && (st === '全部' || g.status === st)).sort((a, b) => (a.review_date || '').localeCompare(b.review_date || ''));
  return layout('goals', `<div class="pagehead"><div><h1>自立支援／復能目標追蹤 <span class="small muted">（評鑑 B10）</span></h1><div class="muted">每個目標建議 3 個月檢討一次；檢討紀錄就是評鑑佐證</div></div><span class="sp"></span>
  <div class="btns">${['進行中', '達成', '停止', '全部'].map(s => `<a class="btn ${s === st ? 'pri' : ''}" href="#/goals?status=${s}">${s}</a>`).join('')}<button class="btn" onclick="App.preview('list','goals')">🖨 列印</button></div></div>
  <details class="card box"><summary>＋ 新增目標</summary>${goalForm({}, 0, '/goals', true)}</details>
  <div class="tbl-wrap"><table class="t"><tr><th>個案</th><th>面向</th><th>目標</th><th>方法</th><th>開始</th><th>檢討日</th><th>最近檢討</th><th>狀態</th></tr>
  ${rows.map(gl => { const c = client(gl.client_id); const last = DB.reviews.filter(r => r.goal_id === gl.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const over = gl.status === '進行中' && gl.review_date && gl.review_date < todayISO();
    return `<tr><td class="ttl"><a href="#/clients/${c.id}">${h(c.name)}</a> <span class="muted small">${h(c.case_no)}</span></td><td>${h(gl.domain)}</td>
      <td class="wide"><b>${h(gl.goal)}</b><div class="small muted">基準：${h(gl.baseline) || '—'}</div></td><td class="small wide">${h(gl.method)}</td><td>${roc(gl.start_date)}</td>
      <td>${over ? badge(roc(gl.review_date) + ' 已到期', 'bad') : roc(gl.review_date)}</td>
      <td class="small wide">${last ? `${roc(last.date)} ${badge(last.progress)} ${h(last.note)}` : '—'}${gl.status === '進行中' ? `<details><summary class="small">＋ 檢討</summary>${reviewForm(gl, '/goals')}</details>` : ''}</td><td>${h(gl.status)}</td></tr>`; }).join('')
    || '<tr><td colspan="8" class="empty">沒有資料。可從六力評估結果一鍵建立目標。</td></tr>'}</table></div>`);
};

const GOAL_TMPL = {
  mob: ['行動／肌力平衡', '起立坐下 5 次縮短至 12 秒內，維持安全行走', '運動團體＋個別坐站運動 10 下 × 2–3 組／天'],
  cog: ['認知', '能正確說出今天的月、日（現實導向）', '認知團體；每日日曆、白板現實導向'],
  dep: ['情緒', '每週主動參與社交團體至少 2 次', '社交團體；安排有興趣的活動'],
  soc: ['日常生活自立', '在提示下自行完成能力所及的日常活動（如穿脫外套）', '自立支援：給予時間、口頭提示，不代勞'],
  nut: ['營養', '維持體重，三個月內不再下降', '告知護理人員追蹤；用餐觀察'],
  vis: ['感官', '活動中能看清字卡、安全移動', '照明充足、字卡放大；鼓勵就醫'],
  hear: ['感官', '團體活動中能聽清楚指令並參與', '面對面溝通、座位安排'],
};
const goalSug = a => { const j = icopeAuto(a.data);
  return S.ICOPE_ALL.filter(([k]) => GOAL_TMPL[k] && ['異常', '需追蹤'].includes(j[k])).map(([k]) => [k, ...GOAL_TMPL[k],
    k === 'mob' ? `起立坐下 ${a.data.mob_seconds || '—'} 秒（${a.data.mob_method || ''}）` : ({ cog: '定向／記憶有錯誤', dep: '情緒低落或失去興趣', soc: '日常生活需協助', nut: '體重減輕或食慾不佳', vis: '視力有困難', hear: '聽力異常' }[k])]); };
V.goalsFrom = (aid) => {
  const a = assess(aid); const c = client(a.client_id); const sug = goalSug(a);
  return layout('goals', `<div class="pagehead"><div><h1>依六力結果建立自立支援目標</h1><div class="muted">${h(c.label)}・六力評估 ${roc(a.date)}・勾選要建立的目標，可直接修改；預設 3 個月後檢討</div></div></div>
  <form class="card" onsubmit="return App.createGoals(event,${aid})">${sug.map(([k, dom, goal, method, base]) => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:10px">
    <label><input type="checkbox" name="use_${k}" checked> <b>${dom}</b></label><div class="grid g3" style="margin-top:6px">
    <div><label class="f">目標</label><input type="text" name="goal_${k}" value="${h(goal)}" style="width:100%"></div>
    <div><label class="f">方法</label><input type="text" name="method_${k}" value="${h(method)}" style="width:100%"></div>
    <div><label class="f">基準（目前表現）</label><input type="text" name="base_${k}" value="${h(base)}" style="width:100%"></div></div></div>`).join('') || '<div class="empty">此次六力沒有異常面向，不需建立目標。</div>'}
  <div class="btns"><button class="btn pri">建立勾選的目標</button><a class="btn" href="#/clients/${c.id}">略過</a></div></form>`);
};

V.reports = () => {
  const cs = activeClients(); const ind = indicators(cs); const f = addDays(todayISO(), -365), t = todayISO(); const bar = p => `<div class="bar"><i style="width:${p}%"></i></div>`;
  return layout('reports', `<div class="pagehead"><div><h1>評鑑佐證／匯出中心</h1><div class="muted">對應 115 年社區式「小規模多機能」評鑑基準（附件2-3）：B1、B9、B10</div></div></div>
  <div class="grid g3"><div class="card"><h3>B1 評估／再評估（每 6 個月）</h3><b style="font-size:28px">${ind.b1[1]}%</b>${bar(ind.b1[1])}<div class="small muted">${ind.b1[0]}／${ind.n} 位近 6 個月內有評估</div></div>
    <div class="card"><h3>B9 輔具佐證完整</h3><b style="font-size:28px">${ind.b9[2]}%</b>${bar(ind.b9[2])}<div class="small muted">${ind.b9[0]}／${ind.b9[1]} 件</div></div>
    <div class="card"><h3>B10 自立支援目標</h3><b style="font-size:28px">${ind.b10[1]}%</b>${bar(ind.b10[1])}<div class="small muted">${ind.b10[0]}／${ind.n} 位有目標；近 3 個月檢討 ${ind.b10[2]}／${ind.b10[3]}</div></div></div>
  <div class="card"><h2>📦 一鍵匯出評鑑佐證包（ZIP）</h2><p class="muted small" style="margin-top:0">內含 Excel 總表、每位個案期間內的 D61／六力表單與評估彙整（Word），依 B1／B9／B10 分資料夾。</p>
    <form class="fr" onsubmit="return App.pack(event)"><div><label class="f">期間</label><span><input type="date" name="from" value="${f}"> 至 <input type="date" name="to" value="${t}"></span></div><div class="btns"><button class="btn pri">下載佐證包</button></div></form></div>
  <div class="grid g2"><div class="card"><h2>📊 Excel 總表</h2><p class="muted small" style="margin-top:0">指標摘要、在案個案追蹤、D61、六力、六力統計、B9 輔具、B10 目標</p>
    <form class="fr" onsubmit="return App.excel(event)"><div><label class="f">期間</label><span><input type="date" name="from" value="${f}"> 至 <input type="date" name="to" value="${t}"></span></div><div class="btns"><button class="btn pri">下載 Excel</button></div></form></div>
  <div class="card"><h2>🖨 單張清單（列印或另存 PDF）</h2><div class="btns"><button class="btn" onclick="App.preview('list','roster')">在案個案評估追蹤名冊</button>
    <button class="btn" onclick="App.preview('list','aids')">B9 輔具使用清單</button><button class="btn" onclick="App.preview('list','goals')">B10 自立支援目標追蹤表</button></div>
    <p class="muted small">PDF：在預覽畫面按「列印／另存 PDF」，印表機選「另存為 PDF」。</p></div></div>
  <div class="card"><h2>個案評估彙整（每人一份）</h2><div class="tbl-wrap"><table class="t"><tr><th>案號</th><th>姓名</th><th>最近評估</th><th>狀態</th><th>匯出</th></tr>
  ${cs.map(c => `<tr><td class="hide-m">${h(c.case_no)}</td><td class="ttl">${h(c.name)} <span class="m-only muted small">${h(c.case_no)}</span></td><td>${roc(c.due.last) || '—'}</td><td>${badge(c.due.status)}</td>
    <td class="btns wide"><button class="btn sm" onclick="App.preview('client',${c.id})">預覽／PDF</button><button class="btn sm" onclick="App.word('client',${c.id})">Word</button></td></tr>`).join('')}</table></div></div>`);
};

V.feedback = (q) => {
  const rows = DB.feedback.slice().reverse();
  return layout('feedback', `<div class="pagehead"><div><h1>💬 試用意見回饋</h1><div class="muted">哪裡想增加、想刪掉、看不懂或壞掉，都歡迎寫下來</div></div></div>
  <div class="demo-note">意見會先存在您的瀏覽器裡。寫完後按下方 <b>「📋 複製全部意見」</b>，貼到 LINE 或訊息傳給治療師就完成了。</div>
  <form class="card" onsubmit="return App.saveFeedback(event)"><div class="grid g4">
    <div><label class="f">您的姓名（可不填）</label><input type="text" name="name" style="width:100%" value="${h(localStorage.getItem('fb_name') || '')}"></div>
    <div><label class="f">職稱</label><select name="role" style="width:100%">${opt(['', '職能治療師', '物理治療師', '護理師', '社工', '照服員', '主管', '行政', '其他'], localStorage.getItem('fb_role') || '')}</select></div>
    <div><label class="f">類型</label><select name="kind" style="width:100%">${opt(['希望增加', '希望刪減', '操作不順／看不懂', '錯誤（壞掉）', '其他'])}</select></div>
    <div><label class="f">哪個畫面</label><input type="text" name="page" value="${h(q.page || '')}" style="width:100%" placeholder="例：六力評估"></div></div>
    <label class="f" style="margin-top:10px">意見內容</label><textarea name="content" required placeholder="例：D61 希望多一個「吞嚥」欄位…"></textarea>
    <div class="btns" style="margin-top:10px"><button class="btn pri">送出意見</button></div></form>
  <div class="card"><div class="fr" style="justify-content:space-between"><h2 style="margin:0">我寫的意見（${rows.length}）</h2>
    <div class="btns"><button class="btn acc" onclick="App.copyFeedback(this)" ${rows.length ? '' : 'disabled'}>📋 複製全部意見</button></div></div>
  ${rows.map(r => `<div style="border-top:1px dashed var(--line);padding:10px 0"><div class="small muted">${h(r.ts)}　${h(r.name || '匿名')} ${h(r.role)}　${badge(r.kind, r.kind === '希望增加' ? 'warn' : (r.kind.includes('錯誤') ? 'bad' : ''))}　${h(r.page)}</div>
    <div style="white-space:pre-wrap">${h(r.content)}</div><button class="btn sm danger" style="margin-top:4px" onclick="App.delFeedback(${r.id})">刪除</button></div>`).join('') || '<div class="empty">還沒有意見</div>'}</div>`);
};

V.settings = () => layout('settings', `<div class="pagehead"><h1>設定／重設資料</h1></div>
  <div class="grid g2"><form class="card" onsubmit="return App.saveSettings(event)"><h2>單位設定</h2>
    <label class="f">單位名稱（印在表單抬頭）</label><input type="text" name="center_name" value="${h(setting('center_name'))}" style="width:100%">
    <div class="grid g2" style="margin-top:8px"><div><label class="f">六力表單「督導」姓名</label><input type="text" name="supervisor" value="${h(setting('supervisor'))}" style="width:100%"></div>
      <div><label class="f">督導職稱</label><input type="text" name="supervisor_title" value="${h(setting('supervisor_title'))}" style="width:100%"></div></div>
    <label class="f" style="margin-top:8px">再評估週期（月）</label><input type="number" name="reeval_months" value="${h(setting('reeval_months'))}" min="1" max="24">
    <div style="margin-top:12px"><button class="btn pri">儲存設定</button></div></form>
  <div class="card"><h2>試用資料</h2><p class="small muted" style="margin-top:0">試用版的資料只存在這個瀏覽器。換手機或清除瀏覽器資料就會回到初始示範資料。</p>
    <div class="btns"><button class="btn" onclick="App.backup()">⬇ 下載我的資料（備份）</button>
      <label class="btn">⬆ 載入備份<input type="file" accept=".json" style="display:none" onchange="App.restore(this)"></label>
      <button class="btn danger" onclick="App.reset()">↺ 重設為初始示範資料</button></div>
    <h2 style="margin-top:18px">正式版</h2><p class="small muted" style="margin:0">正式使用請下載 GitHub 上的 Python 版，資料只存在單位自己的電腦，並可匯入 Excel 名冊、產生 PDF。</p>
    <p><a href="https://github.com/mattsue1003/care-assessment-system" target="_blank" rel="noopener">github.com/mattsue1003/care-assessment-system</a></p></div></div>`);
V.notFound = () => layout('', '<div class="card empty">找不到這個頁面。<a href="#/">回首頁</a></div>');

/* ============================== 列印版面（預覽、PDF、Word 共用） ============================== */
let PRINT_CSS = '';
fetch('print.css?v=3').then(r => r.text()).then(t => { PRINT_CSS = t; }).catch(() => {});
const o = (sel, opts) => opts.map(x => `<span class="o ${x === sel || (Array.isArray(sel) && sel.includes(x)) ? 'on' : ''}">${x === sel || (Array.isArray(sel) && sel.includes(x)) ? '☑' : '□'} ${h(x)}</span>`).join('');
const boxes = t => h(t).replace(/☑([^　☐☑（\s]+)/g, '<b class="v o">☑$1</b>').replace(/☐([^　☐☑（\s<]+)/g, '<span class="o">☐$1</span>');
const nl = t => h(t).replace(/\n/g, '<br>');
function printD61(a, c) {
  const d = a.data;
  const rows = S.D61.map(sec => {
    const radios = sec.fields.filter(f => f.type === 'radio'); const per = sec.no === '08' ? 3 : 2; let rt = '';
    for (let i = 0; i < radios.length; i += per) rt += '<tr>' + radios.slice(i, i + per).map(f => `<td><span class="lbl">${h(f.label)}</span>　${o(d[f.key], f.options)}</td>`).join('') + '</tr>';
    const others = sec.fields.filter(f => f.type !== 'radio').map(f => f.type === 'multi'
      ? `<div class="sub2">${h(f.label)}${f.hint ? ` <small>（${h(f.hint)}）</small>` : ''}</div><div>${o(d[f.key] || [], f.options)}</div>${f.other ? `<div class="sm">其他：<b class="v">${h(d[f.key + '_other'])}</b></div>` : ''}`
      : `<div style="border-bottom:1px solid #000;padding-top:2mm"><b>${h(f.label)}</b>　<span class="v sm">${h(d[f.key])}</span></div>`).join('');
    const notes = sec.fields.filter(f => d[f.key + '_note']).map(f => `${h(f.label)}：${h(d[f.key + '_note'])}`).concat(d['s' + sec.no + '_note'] ? [h(d['s' + sec.no + '_note'])] : []).join('<br>');
    return `<tr><td class="no">${sec.no}</td><td class="topic">${h(sec.title)}</td><td>${rt ? `<table class="row2">${rt}</table>` : ''}${others}</td><td class="note">${notes}</td></tr>`;
  }).join('');
  return `<div class="page"><header><div class="org">${h(setting('center_name'))}</div><h1>職能治療評估表</h1></header>
  <table class="info"><tr><th>評估對象</th><td class="v">${h(c.label)}　<span class="sm">${h(c.gender)}／${ageAt(c.birth, a.date) ?? ''} 歲</span></td><th>評估日期</th><td class="v" style="width:52mm">${rocLong(a.date)}</td></tr>
    <tr><th>填表人</th><td class="v">${h(a.assessor)}</td><th>評估類別</th><td class="v">${h(a.kind)}</td></tr>
    <tr><th>整體評估<br>建議</th><td colspan="3" class="v sm" style="line-height:1.55">${nl(a.summary)}</td></tr><tr><th>備註</th><td colspan="3" class="v sm">${h(a.note)}</td></tr></table>
  <table class="main mt"><thead><tr><th class="no">序號</th><th class="topic">主題</th><th>評估項目</th><th class="note" style="color:#000">備註</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="sign"><span>職能治療師簽章：＿＿＿＿＿＿＿＿</span><span>主管覆核：＿＿＿＿＿＿＿＿</span></div>
  <div class="foot">對應系統：care99 D61.職能治療評估　｜　下次再評估：${roc(a.next_due)}</div></div>`;
}
function printIcope(a, c) {
  const d = a.data; const j = icopeAuto(d); const ab = icopeAbn(d), ok = icopeOk(d);
  return `<div class="page"><header><div class="org">${h(setting('center_name'))}</div><h1>職能治療 ICOPE 評估</h1><div class="sub">依國健署「長者功能評估」（ICOPE）六大面向：認知、行動、營養、視力、聽力、憂鬱</div></header>
  <table class="info"><tr><th>個案姓名</th><td class="v">${h(c.name)}</td><th>案號</th><td class="v">${h(c.case_no)}</td><th>性別／年齡</th><td class="v">${h(c.gender)}／${ageAt(c.birth, a.date) ?? ''} 歲</td></tr>
    <tr><th>出生日期</th><td class="v">${roc(c.birth)}</td><th>評估日期</th><td class="v" colspan="3">${rocLong(a.date)}　${o((a.kind || '').startsWith('初評') ? '初評' : '再評估', ['初評', '再評估'])}</td></tr>
    <tr><th>督導<br><span class="xs">（${h(setting('supervisor_title'))}）</span></th><td class="v">${h(setting('supervisor'))}</td><th>評估者</th><td class="v">${h(a.assessor)}</td><th>行動輔具</th><td class="v">${h(d.mob_aid)}</td></tr></table>
  <table class="main mt"><thead><tr><th>面向</th><th>評估內容與結果</th><th>判定</th><th>後續處置／建議</th></tr></thead><tbody>
  ${icopeRows(d).map(([k, l, lines, fin, acts]) => `${k === 'med' ? '<tr class="sep"><td colspan="4">後續評估（初評有任一項異常時填寫）</td></tr>' : ''}
    <tr><td class="dom">${h(l)}</td><td class="sm">${lines.map(x => `<div>${boxes(x)}</div>`).join('')}${fin ? `<div class="v">說明：${h(fin)}</div>` : ''}</td>
    <td class="jd ${['異常', '需追蹤'].includes(j[k]) ? 'bad' : ''}">${h(j[k] || '')}</td><td class="act">${acts.map(x => `<div>▸ ${h(x)}</div>`).join('')}</td></tr>`).join('')}</tbody></table>
  <table class="info mt"><tr><th>本次結果</th><td><span class="bad">異常 ${ab.length} 項</span>（${ab.join('、') || '無'}）　正常 ${ok.length} 項（${ok.join('、') || '無'}）</td></tr>
    <tr><th>目標</th><td class="v sm">${nl(d.goal_text)}</td></tr><tr><th>職能治療<br>處置建議</th><td class="v sm" style="line-height:1.55">${nl(d.plan_text)}</td></tr>
    <tr><th>資源連結</th><td class="v sm">${nl(d.resource_text)}</td></tr><tr><th>下次再評估</th><td><span class="v">${rocLong(a.next_due)}</span>　<span class="sm">（如跌倒、住院或功能明顯退化，要提前再評估）</span></td></tr></table>
  <div class="sign"><span>評估者簽章：＿＿＿＿＿＿</span><span>個案／家屬：＿＿＿＿＿＿</span><span>主管覆核：＿＿＿＿＿＿</span></div>
  <div class="foot">${h(c.case_no)} ${h(c.name)}｜六力 ICOPE 評估｜${roc(a.date)}</div></div>`;
}
function printClient(cid) {
  const b = bundle(cid); const c = b.c; const tr = b.trend, dt = b.d61trend;
  return `<div class="page"><header><div class="org">${h(setting('center_name'))}</div><h1>個案職能治療評估彙整</h1><div class="sub">製表日期：${rocLong(todayISO())}</div></header>
  <table class="info"><tr><th>姓名</th><td class="v">${h(c.name)}</td><th>案號</th><td class="v">${h(c.case_no)}</td><th>性別／年齡</th><td class="v">${h(c.gender)}／${c.age ?? ''} 歲</td></tr>
    <tr><th>出生日期</th><td>${roc(c.birth)}</td><th>現有服務</th><td>${h(c.services)}</td><th>主責督導</th><td>${h(c.supervisor)}</td></tr>
    <tr><th>最近評估</th><td>${roc(b.due.last)}</td><th>下次應評估</th><td class="${b.due.status === '逾期' ? 'bad' : ''}">${roc(b.due.next)}（${b.due.status}）</td><th>居住情況</th><td>${h(c.living)}</td></tr></table>
  <h2 class="s">一、歷次評估一覽（評鑑 B1）</h2><table class="t"><thead><tr><th style="width:20mm">日期</th><th style="width:30mm">評估</th><th style="width:22mm">評估者</th><th>摘要</th></tr></thead>
  ${b.all.map(a => `<tr><td class="c">${roc(a.date)}</td><td>${typName[a.type]}</td><td>${h(a.assessor)}</td><td class="sm">${a.type === 'ICOPE' ? `異常：${icopeAbn(a.data).join('、') || '無'}${a.data.mob_seconds ? `；起立坐下 ${h(a.data.mob_seconds)} 秒` : ''}` : h((a.summary || a.note || '').slice(0, 150))}</td></tr>`).join('') || '<tr><td colspan="4" class="c">尚無紀錄</td></tr>'}</table>
  ${tr.dates.length ? `<h2 class="s">二、六力歷次結果</h2><table class="t"><thead><tr><th>面向</th>${tr.dates.map(x => `<th class="c">${roc(x)}</th>`).join('')}</tr></thead>
    ${tr.rows.map(([l, v]) => `<tr><td><b>${l}</b></td>${v.map(x => `<td class="c ${['異常', '需追蹤'].includes(x) ? 'bad' : ''}">${x || '—'}</td>`).join('')}</tr>`).join('')}
    <tr><td><b>起立坐下（秒）</b></td>${tr.secs.map(v => `<td class="c ${v > 12 ? 'bad' : ''}">${v ?? '—'}</td>`).join('')}</tr></table>` : ''}
  ${dt.dates.length ? `<h2 class="s">三、D61 職能治療評估歷次比較</h2><table class="t"><thead><tr><th>項目</th>${dt.dates.map(x => `<th class="c">${roc(x)}</th>`).join('')}</tr></thead>
    ${dt.rows.map(([l, v, op]) => `<tr><td>${h(l)}</td>${v.map(x => `<td class="c ${op && x && x !== op[0] ? 'bad' : ''}">${h(x) || '—'}</td>`).join('')}</tr>`).join('')}</table>
    ${b.changes.length ? `<div class="sm" style="margin-top:2mm"><b>最近兩次變化：</b>${b.changes.map(([l, a1, a2, k]) => `${h(l)} ${h(a1)}→${h(a2)}（${k}）`).join('；')}</div>` : ''}` : ''}
  <h2 class="s">四、輔具使用（評鑑 B9）</h2><table class="t"><thead><tr><th>輔具</th><th>來源</th><th>開始使用</th><th>適配評估</th><th>使用訓練</th><th>最近檢查</th><th>狀態</th><th>備註</th></tr></thead>
  ${b.aids.map(x => `<tr><td><b>${h(x.item)}</b></td><td>${h(x.source)}</td>${['start_date', 'fit_date', 'train_date', 'check_date'].map(k => `<td class="c">${roc(x[k]) || '—'}</td>`).join('')}<td>${h(x.status)}</td><td class="sm">${h(x.note)}</td></tr>`).join('') || '<tr><td colspan="8" class="c">無使用輔具</td></tr>'}</table>
  <h2 class="s">五、自立支援／復能目標（評鑑 B10）</h2><table class="t"><thead><tr><th style="width:22mm">面向</th><th>目標／方法</th><th style="width:20mm">開始</th><th>檢討紀錄</th><th style="width:17mm">狀態</th></tr></thead>
  ${b.goals.map(gl => `<tr><td>${h(gl.domain)}</td><td><b>${h(gl.goal)}</b><div class="sm">方法：${h(gl.method)}</div><div class="sm">基準：${h(gl.baseline)}</div></td><td class="c">${roc(gl.start_date)}</td>
    <td class="sm">${gl.reviews.map(r => `<div>${roc(r.date)} ${h(r.progress)}：${h(r.note)}</div>`).join('') || '—'}</td><td class="c">${h(gl.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="c">尚未建立目標</td></tr>'}</table>
  <div class="sign"><span>職能治療師：＿＿＿＿＿＿</span><span>督導（護理師）：＿＿＿＿＿＿</span><span>主管：＿＿＿＿＿＿</span></div></div>`;
}
function printList(kind) {
  const cs = activeClients(); const ids = new Set(cs.map(c => c.id)); const title = { aids: 'B9 輔具使用清單', goals: 'B10 自立支援目標追蹤表', roster: '在案個案評估追蹤名冊' }[kind];
  let body;
  if (kind === 'aids') body = `<table class="t"><thead><tr><th>案號</th><th>姓名</th><th>輔具／用品</th><th>類別</th><th>來源</th><th>開始使用</th><th>適配評估</th><th>使用訓練</th><th>最近檢查</th><th>狀態</th><th>備註</th></tr></thead>
    ${DB.aids.filter(x => ids.has(x.client_id)).map(x => { const c = client(x.client_id); return `<tr><td>${h(c.case_no)}</td><td>${h(c.name)}</td><td><b>${h(x.item)}</b></td><td>${h(x.category)}</td><td>${h(x.source)}</td>
      ${['start_date', 'fit_date', 'train_date', 'check_date'].map(k => `<td class="c">${roc(x[k]) || '—'}</td>`).join('')}<td>${h(x.status)}</td><td>${h(x.note)}</td></tr>`; }).join('')}</table>`;
  else if (kind === 'goals') body = `<table class="t"><thead><tr><th>案號</th><th>姓名</th><th>面向</th><th>目標</th><th>方法</th><th>基準</th><th>開始</th><th>檢討紀錄</th><th>狀態</th></tr></thead>
    ${DB.goals.filter(g => ids.has(g.client_id)).map(gl => { const c = client(gl.client_id); return `<tr><td>${h(c.case_no)}</td><td>${h(c.name)}</td><td>${h(gl.domain)}</td><td><b>${h(gl.goal)}</b></td><td>${h(gl.method)}</td><td>${h(gl.baseline)}</td>
      <td class="c">${roc(gl.start_date)}</td><td>${DB.reviews.filter(r => r.goal_id === gl.id).map(r => `<div>${roc(r.date)} ${h(r.progress)}：${h(r.note)}</div>`).join('') || '—'}</td><td class="c">${h(gl.status)}</td></tr>`; }).join('') || '<tr><td colspan="9" class="c">尚無目標</td></tr>'}</table>`;
  else body = `<table class="t"><thead><tr><th>案號</th><th>姓名</th><th>性別</th><th>年齡</th><th>現有服務</th><th>主責督導</th><th>最近 D61</th><th>最近六力</th><th>下次應評估</th><th>狀態</th></tr></thead>
    ${cs.map(c => `<tr><td>${h(c.case_no)}</td><td>${h(c.name)}</td><td class="c">${h(c.gender)}</td><td class="c">${c.age ?? ''}</td><td>${h(c.services)}</td><td>${h(c.supervisor)}</td>
      <td class="c">${roc(c.due.last_d61) || '—'}</td><td class="c">${roc(c.due.last_icope) || '—'}</td><td class="c">${roc(c.due.next) || '—'}</td><td class="c ${c.due.status === '逾期' ? 'bad' : ''}">${c.due.status}</td></tr>`).join('')}</table>`;
  return `<div class="page"><header><div class="org">${h(setting('center_name'))}</div><h1>${title}</h1><div class="sub">製表日期：${rocLong(todayISO())}</div></header>${body}</div>`;
}
function printDoc(kind, id) {
  if (kind === 'a') { const a = assess(id); const c = client(a.client_id); return { title: `${c.case_no}_${c.name}_${a.type === 'D61' ? '職能治療評估D61' : '六力ICOPE評估'}_${roc(a.date, '')}`, html: a.type === 'D61' ? printD61(a, c) : printIcope(a, c) }; }
  if (kind === 'client') { const c = client(id); return { title: `${c.case_no}_${c.name}_個案評估彙整_${roc(todayISO(), '')}`, html: printClient(id) }; }
  return { title: { aids: '輔具使用清單', goals: '自立支援目標追蹤表', roster: '在案個案評估追蹤名冊' }[id], html: printList(id), land: true };
}
function fullHTML(doc, screen) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h(doc.title)}</title>
  <style>${PRINT_CSS}${doc.land ? '@page{size:A4 landscape}' : ''}</style></head><body class="${doc.land ? 'land' : ''}">
  ${screen ? '<div class="bar"><span>預覽（列印時選「另存為 PDF」即可存成 PDF）</span><span style="flex:1"></span><button onclick="print()">🖨 列印／另存 PDF</button></div>' : ''}${doc.html}
  ${screen ? `<script>(function(){var w=document.body.classList.contains('land')?1160:830;var z=Math.min(1,(innerWidth-4)/w);if(z<1)document.body.style.zoom=z;})()<\/script>` : ''}</body></html>`;
}
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function wordBlob(doc) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta charset="utf-8"><title>${h(doc.title)}</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
  <style>${PRINT_CSS.replace(/@media screen[\s\S]*?\n}\n/g, '')} body{background:#fff} .page{width:auto;margin:0;padding:0;box-shadow:none} @page Section1{size:${doc.land ? '29.7cm 21cm;mso-page-orientation:landscape' : '21cm 29.7cm'};margin:1.2cm 1.5cm} div.Section1{page:Section1}</style></head>
  <body><div class="Section1">${doc.html}</div></body></html>`;
  return new Blob(['﻿', html], { type: 'application/msword' });
}
function loadScript(src) { return new Promise((ok, no) => { if ([...document.scripts].some(s => s.src === src)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('無法載入 ' + src)); document.head.appendChild(s); }); }
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
function buildWorkbook(f, t) {
  const XL = window.XLSX; const wb = XL.utils.book_new(); const cs = activeClients(); const ind = indicators(cs);
  const add = (name, aoa, widths) => { const ws = XL.utils.aoa_to_sheet(aoa); if (widths) ws['!cols'] = widths.map(w => ({ wch: w })); XL.utils.book_append_sheet(wb, ws, name); };
  const inR = a => a.date >= f && a.date <= t;
  const d61 = DB.assessments.filter(a => a.type === 'D61' && inR(a)).sort((a, b) => a.date.localeCompare(b.date));
  const ic = DB.assessments.filter(a => a.type === 'ICOPE' && inR(a)).sort((a, b) => a.date.localeCompare(b.date));
  add('指標摘要', [[`${setting('center_name')}　評鑑佐證總表`], ['資料期間', `${roc(f)} ～ ${roc(t)}`], ['製表日期', roc(todayISO())], [],
    ['指標（115 年 附件2-3 小規模多機能）', '現況'], ['在案個案數', `${ind.n} 位`], ['B1 近 6 個月內完成評估／再評估', `${ind.b1[0]} 位（${ind.b1[1]}%）`],
    ['B9 使用中輔具：開始日期＋適配評估＋使用訓練 皆有紀錄', `${ind.b9[0]}／${ind.b9[1]} 件（${ind.b9[2]}%）`], ['B10 有進行中自立支援目標的個案', `${ind.b10[0]} 位（${ind.b10[1]}%）`],
    ['B10 近 3 個月內有檢討紀錄的目標', `${ind.b10[2]}／${ind.b10[3]} 項`], [], ['期間內 D61 職能治療評估', `${d61.length} 筆`], ['期間內 六力 ICOPE 評估', `${ic.length} 筆`]], [58, 30]);
  add('在案個案評估追蹤', [['案號', '姓名', '性別', '年齡', '現有服務', '主責督導', '最近D61', '最近六力', '最近評估', '下次應評估', '評估狀態', '使用中輔具', '進行中目標']]
    .concat(cs.map(c => [c.case_no, c.name, c.gender, c.age, c.services, c.supervisor, roc(c.due.last_d61), roc(c.due.last_icope), roc(c.due.last), roc(c.due.next), c.due.status,
      aidsOf(c.id).filter(x => x.status === '使用中').map(x => x.item).join('、'), DB.goals.filter(g => g.client_id === c.id && g.status === '進行中').length])), [8, 10, 5, 5, 16, 9, 10, 10, 10, 10, 11, 18, 8]);
  const keys = ['hobby_now', 'adl_help', 'func', 'soc_coop', 'soc_motiv', ...S.SIDES.map(([k]) => 'rom_' + k), ...S.SIDES.map(([k]) => 'mmt_' + k), 'tone_ue', 'tone_le',
    'sense_touch', 'sense_hear', 'sense_vision', 'bpsd', 'cog_alert', 'cog_orient', 'cog_attn', 'cog_mem_s', 'cog_mem_l', 'cog_expr', 'cog_comp', 'cog_read', 'cog_solve', 'ot_goal', 'ot_plan', 'sched_am', 'sched_pm', 'sched_ev'];
  const names = { hobby_now: '興趣(現在)', adl_help: 'ADL需協助', func: '功能性動作', bpsd: '精神行為', ot_goal: '治療目標', ot_plan: '治療計畫' };
  const brief = (d, k) => Array.isArray(d[k]) ? d[k].concat(d[k + '_other'] ? [d[k + '_other']] : []).join('、') : (d[k] || '');
  add('D61職能治療評估', [['日期', '案號', '姓名', '填表人', '類別', ...keys.map(k => names[k] || D61_FIELDS[k].qlabel), '整體評估建議', '已登打care99']]
    .concat(d61.map(a => { const c = client(a.client_id); return [roc(a.date), c.case_no, c.name, a.assessor, a.kind, ...keys.map(k => brief(a.data, k)), a.summary, a.keyed ? '是' : '否']; })));
  add('六力ICOPE評估', [['日期', '案號', '姓名', '年齡', '評估者', '類別', ...S.ICOPE_ALL.map(x => x[1]), '起立坐下秒數', '異常項數', '異常面向', '處置建議', '下次再評估']]
    .concat(ic.map(a => { const c = client(a.client_id); const j = icopeAuto(a.data); const ab = icopeAbn(a.data);
      return [roc(a.date), c.case_no, c.name, ageAt(c.birth, a.date), a.assessor, a.kind, ...S.ICOPE_ALL.map(([k]) => j[k] || ''), a.data.mob_seconds || '', ab.length, ab.join('、'), a.data.plan_text || '', roc(a.next_due)]; })));
  const latest = {}; ic.forEach(a => latest[a.client_id] = a); const stat = {}; S.ICOPE_ALL.forEach(([k]) => stat[k] = [0, 0]);
  Object.values(latest).forEach(a => { const j = icopeAuto(a.data); S.ICOPE_ALL.forEach(([k]) => { if (j[k]) { stat[k][1]++; if (['異常', '需追蹤'].includes(j[k])) stat[k][0]++; } }); });
  add('六力統計', [[`六力統計（每位個案取期間內最近一次，共 ${Object.keys(latest).length} 位）`], [], ['面向', '異常／需追蹤人數', '受評人數', '比例']]
    .concat(S.ICOPE_ALL.map(([k, l]) => [l, stat[k][0], stat[k][1], stat[k][1] ? Math.round(stat[k][0] * 100 / stat[k][1]) + '%' : '—'])), [18, 16, 10, 10]);
  const ids = new Set(cs.map(c => c.id));
  add('B9輔具清單', [['案號', '姓名', '輔具／用品', '類別', '來源', '開始使用', '適配評估日', '使用訓練日', '最近檢查日', '狀態', '備註', '佐證完整性']]
    .concat(DB.aids.filter(x => ids.has(x.client_id)).map(x => { const c = client(x.client_id); const miss = [['start_date', '開始日期'], ['fit_date', '適配評估'], ['train_date', '使用訓練']].filter(([k]) => !x[k]).map(y => y[1]);
      return [c.case_no, c.name, x.item, x.category, x.source, roc(x.start_date), roc(x.fit_date), roc(x.train_date), roc(x.check_date), x.status, x.note, miss.length && x.status === '使用中' ? '缺漏：' + miss.join('、') : '完整']; })),
    [7, 9, 16, 8, 9, 10, 10, 10, 10, 8, 20, 22]);
  add('B10自立支援目標', [['案號', '姓名', '面向', '目標', '方法', '基準', '開始日', '預定檢討', '狀態', '檢討紀錄']]
    .concat(DB.goals.map(gl => { const c = client(gl.client_id); return [c.case_no, c.name, gl.domain, gl.goal, gl.method, gl.baseline, roc(gl.start_date), roc(gl.review_date), gl.status,
      DB.reviews.filter(r => r.goal_id === gl.id).map(r => `${roc(r.date)} ${r.progress}：${r.note || ''}`).join('\n')]; })), [7, 9, 12, 30, 28, 20, 10, 10, 8, 40]);
  return wb;
}

/* ============================== 動作 ============================== */
const fd2obj = (form) => { const fd = new FormData(form); const o = {}; for (const k of new Set(fd.keys())) { const v = fd.getAll(k).map(x => typeof x === 'string' ? x.trim() : x); o[k] = v.length > 1 ? v : v[0]; } return o; };
function parseData(form) {
  const META = new Set(['client_id', 'date', 'assessor', 'kind', 'summary', 'note', 'next_due', 'keyed', '_action']); const fd = new FormData(form); const d = {};
  for (const k of new Set(fd.keys())) { if (META.has(k)) continue; const v = fd.getAll(k).map(x => String(x).trim());
    d[k] = LIST_KEYS.has(k) ? v.filter(Boolean) : (v[v.length - 1] || ''); }
  LIST_KEYS.forEach(k => { if (!d[k]) d[k] = []; });
  Object.keys(d).forEach(k => { if (d[k] === '') delete d[k]; }); return d;
}
let dirty = false;
const App = window.App = {
  go(p) { dirty = false; location.hash = '#' + p; return false; },
  nav(open) { document.body.classList.toggle('nav-open', open); },
  login(e) { e.preventDefault(); const f = fd2obj(e.target);
    if (f.u === '1111' && f.p === '1111') { sessionStorage.setItem('care_login', '1'); route(); } else { flash('帳號或密碼錯誤', 'err'); route(); } return false; },
  logout() { sessionStorage.removeItem('care_login'); route(); return false; },
  filter(e, base) { e.preventDefault(); const p = new URLSearchParams(); for (const [k, v] of new FormData(e.target)) if (v) p.set(k, v); return App.go(base + (p.toString() ? '?' + p : '')); },
  saveClient(e, id) { e.preventDefault(); const f = fd2obj(e.target); if (!f.name) { alert('請輸入姓名'); return false; } f.birth = iso(f.birth);
    if (id) Object.assign(DB.clients.find(x => x.id === id), f); else { id = nextId(); DB.clients.push(Object.assign({ id }, f)); }
    save(); flash('已儲存'); return App.go('/clients/' + id); },
  allNormal(btn) { btn.closest('.sec').querySelectorAll('.pills').forEach(p => { const r = p.querySelector('input[type=radio]'); if (r) r.checked = true; }); markPrev(); dirty = true; },
  genNarr() { const f = document.getElementById('f'); const cid = +f.client_id.value; const c = client(cid) || {}; c.age = ageAt(c.birth, f.date.value);
    const ta = document.getElementById('summary'); if (ta.value.trim() && !confirm('要用自動產生的內容取代目前的文字嗎？')) return;
    const ic = document.getElementById('with_icope').checked ? (clientAssess(cid, ['ICOPE'])[0] || {}).data : null;
    ta.value = d61Narrative(c, parseData(f), aidsOf(cid), ic); dirty = true; },
  genPlan() { const t = document.getElementById('plan_text'); const v = icopePlanText(parseData(document.getElementById('f')));
    if (t.value.trim() && !confirm('要用產生的內容取代目前文字嗎？')) return; t.value = v || '（尚未勾選任何後續處置）'; dirty = true; },
  saveAssess(e, typ, id) { e.preventDefault(); const form = e.target; const f = fd2obj(form); const cid = +f.client_id;
    if (!cid || !f.date) { alert('請選擇評估對象並填寫評估日期'); return false; }
    const rec = { client_id: cid, type: typ, date: iso(f.date), assessor: f.assessor || '', kind: f.kind || '', data: parseData(form), summary: f.summary || '',
      note: f.note || '', next_due: iso(f.next_due), keyed: f.keyed ? 1 : 0, updated: nowStr() };
    if (id) Object.assign(assess(id), rec); else { id = nextId(); DB.assessments.push(Object.assign({ id }, rec)); }
    save(); flash('已儲存。可直接列印、存 PDF 或下載 Word。');
    return App.go(f._action === 'goals' && typ === 'ICOPE' ? '/goals/from/' + id : '/a/' + id); },
  delAssess(id) { if (!confirm('確定刪除這筆評估？')) return; const a = assess(id); DB.assessments = DB.assessments.filter(x => x.id !== id); save(); flash('已刪除'); App.go('/clients/' + a.client_id); },
  toggleKeyed(id) { const a = assess(id); a.keyed = a.keyed ? 0 : 1; save(); route(); },
  copy(id, btn) { navigator.clipboard.writeText(assess(id).summary || '').then(() => btn.textContent = '已複製 ✓'); },
  saveAid(e, id, back) { e.preventDefault(); const f = fd2obj(e.target); f.client_id = +f.client_id; if (!f.client_id || !f.item) { alert('請選擇個案並填寫輔具名稱'); return false; }
    if (id) Object.assign(DB.aids.find(x => x.id === id), f); else DB.aids.push(Object.assign({ id: nextId() }, f)); save(); flash('輔具已儲存'); route(); return false; },
  delAid(id) { if (!confirm('確定刪除此輔具紀錄？')) return; DB.aids = DB.aids.filter(x => x.id !== id); save(); route(); },
  saveGoal(e, id) { e.preventDefault(); const f = fd2obj(e.target); f.client_id = +f.client_id; f.status = f.status || '進行中'; if (!f.client_id || !f.goal) { alert('請選擇個案並填寫目標'); return false; }
    if (id) Object.assign(DB.goals.find(x => x.id === id), f); else DB.goals.push(Object.assign({ id: nextId() }, f)); save(); flash('目標已儲存'); route(); return false; },
  delGoal(id) { if (!confirm('確定刪除此目標與檢討紀錄？')) return; DB.goals = DB.goals.filter(x => x.id !== id); DB.reviews = DB.reviews.filter(r => r.goal_id !== id); save(); route(); },
  saveReview(e, gid) { e.preventDefault(); const f = fd2obj(e.target); DB.reviews.push({ id: nextId(), goal_id: gid, date: iso(f.date) || todayISO(), progress: f.progress, note: f.note || '', reviewer: '示範治療師' });
    const g = DB.goals.find(x => x.id === gid); if (f.progress === '達成') g.status = '達成'; else if (f.progress === '未達成停止') g.status = '停止'; else if (f.next_review) g.review_date = iso(f.next_review);
    save(); flash('已新增檢討紀錄'); route(); return false; },
  createGoals(e, aid) { e.preventDefault(); const a = assess(aid); const f = fd2obj(e.target); let n = 0;
    goalSug(a).forEach(([k, dom]) => { if (f['use_' + k]) { DB.goals.push({ id: nextId(), client_id: a.client_id, domain: dom, goal: f['goal_' + k], method: f['method_' + k], baseline: f['base_' + k],
      start_date: a.date, review_date: addMonths(a.date, 3), status: '進行中', assessment_id: aid }); n++; } });
    save(); flash(`已建立 ${n} 項自立支援目標（3 個月後檢討）`); return App.go('/clients/' + a.client_id); },
  saveFeedback(e) { e.preventDefault(); const f = fd2obj(e.target); localStorage.setItem('fb_name', f.name || ''); localStorage.setItem('fb_role', f.role || '');
    DB.feedback.push({ id: nextId(), ts: nowStr().slice(0, 16), name: f.name, role: f.role, kind: f.kind, page: f.page, content: f.content }); save(); flash('已存下！記得按「複製全部意見」傳給治療師'); route(); return false; },
  delFeedback(id) { DB.feedback = DB.feedback.filter(x => x.id !== id); save(); route(); },
  copyFeedback(btn) { const t = '【照護評估系統 試用意見】\n' + DB.feedback.map((r, i) => `${i + 1}. [${r.kind}]${r.page ? '（' + r.page + '）' : ''} ${r.content}${r.name || r.role ? ` —— ${r.name || ''}${r.role ? ' ' + r.role : ''}` : ''}`).join('\n');
    navigator.clipboard.writeText(t).then(() => { btn.textContent = '已複製 ✓ 請貼到 LINE'; }, () => prompt('請複製以下文字：', t)); },
  saveSettings(e) { e.preventDefault(); Object.assign(DB.settings, fd2obj(e.target)); save(); flash('設定已儲存'); route(); return false; },
  backup() { download(`照護評估試用資料_${roc(todayISO(), '')}.json`, new Blob([JSON.stringify(DB)], { type: 'application/json' })); },
  restore(inp) { const file = inp.files[0]; if (!file) return; file.text().then(t => { const d = JSON.parse(t); if (!d.clients) throw 0; DB = d; save(); flash('已載入備份'); route(); }).catch(() => alert('檔案格式不正確')); },
  reset() { if (!confirm('確定重設？您在這個瀏覽器做的所有修改（含意見）都會清除。')) return; localStorage.removeItem(STORE); load(); flash('已重設為初始示範資料'); App.go('/'); },
  preview(kind, id) { const w = window.open('', '_blank'); if (!w) { alert('請允許此網站開啟新視窗'); return; } w.document.open(); w.document.write(fullHTML(printDoc(kind, id), true)); w.document.close(); },
  word(kind, id) { const d = printDoc(kind, id); download(d.title + '.doc', wordBlob(d)); },
  async excel(e) { e.preventDefault(); const f = fd2obj(e.target); try { await loadScript(XLSX_URL); } catch (err) { alert(err.message); return false; }
    window.XLSX.writeFile(buildWorkbook(iso(f.from) || '1900-01-01', iso(f.to) || '2999-12-31'), `評鑑佐證總表_${roc(todayISO(), '')}.xlsx`); return false; },
  async pack(e) { e.preventDefault(); const btn = e.target.querySelector('button'); const old = btn.textContent; btn.textContent = '產生中…';
    const f = fd2obj(e.target); const from = iso(f.from) || '1900-01-01', to = iso(f.to) || '2999-12-31';
    try { await loadScript(XLSX_URL); await loadScript(JSZIP_URL); } catch (err) { alert(err.message); btn.textContent = old; return false; }
    const zip = new window.JSZip(); const root = `評鑑佐證包_${roc(from, '')}-${roc(to, '')}`;
    zip.file(`${root}/00_總表/評鑑佐證總表.xlsx`, window.XLSX.write(buildWorkbook(from, to), { type: 'array', bookType: 'xlsx' }));
    zip.file(`${root}/00_總表/在案個案評估追蹤名冊.doc`, wordBlob(printDoc('list', 'roster')));
    activeClients().forEach(c => { const items = clientAssess(c.id, ['D61', 'ICOPE']).filter(a => a.date >= from && a.date <= to); if (!items.length) return;
      const folder = `${root}/B1_評估與再評估/${c.case_no}_${c.name}`;
      items.forEach(a => { const d = printDoc('a', a.id); zip.file(`${folder}/${d.title}.doc`, wordBlob(d)); });
      const d = printDoc('client', c.id); zip.file(`${folder}/${d.title}.doc`, wordBlob(d)); });
    zip.file(`${root}/B9_輔具/輔具使用清單.doc`, wordBlob(printDoc('list', 'aids')));
    zip.file(`${root}/B10_自立支援/自立支援目標追蹤表.doc`, wordBlob(printDoc('list', 'goals')));
    download(root + '.zip', await zip.generateAsync({ type: 'blob' })); btn.textContent = old; return false; },
};
function markPrev() {
  document.querySelectorAll('.pills[data-prev]').forEach(p => { const pv = p.dataset.prev, cur = (p.querySelector('input:checked') || {}).value || '';
    const tag = p.closest('.fld').querySelector('.prev'); if (tag) tag.classList.toggle('diff', !!pv && !!cur && pv !== cur); });
}
function refreshIcope() {
  const f = document.getElementById('f'); if (!f || !document.getElementById('sumline')) return; const d = parseData(f); const j = icopeAuto(d);
  Object.entries(j).forEach(([k, v]) => { const b = document.getElementById('j_' + k); if (!b) return; b.textContent = v || '未填'; b.className = 'b judge ' + (v || ''); document.getElementById('dom_' + k).className = 'card dom ' + (v || ''); });
  const ab = icopeAbn(d), ok = icopeOk(d);
  document.getElementById('sumline').innerHTML = `<span class="b 異常">異常 ${ab.length} 項</span> ${ab.join('、')}　<span class="b 正常">正常 ${ok.length} 項</span> ${ok.join('、')}`;
}

/* ============================== 路由 ============================== */
function route() {
  const root = document.getElementById('app'); document.body.classList.remove('nav-open');
  if (!sessionStorage.getItem('care_login')) { root.innerHTML = V.login(); FLASH = null; document.title = '登入｜照護評估系統（試用版）'; return; }
  const raw = (location.hash || '#/').slice(1); const [path, qs] = raw.split('?'); const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const p = path.split('/').filter(Boolean); let html;
  if (!p.length) html = V.home();
  else if (p[0] === 'clients') html = !p[1] ? V.clients(q) : (p[1] === 'new' ? V.clientForm(0) : (p[2] === 'edit' ? V.clientForm(+p[1]) : V.client(+p[1])));
  else if (p[0] === 'assess' && ['D61', 'ICOPE'].includes(p[1])) {
    const form = p[1] === 'D61' ? V.d61Form : V.icopeForm;
    html = !p[2] ? V.assessList(p[1], q) : (p[2] === 'new' ? form(0, q) : form(+p[2], q));
  }
  else if (p[0] === 'a') html = V.assessView(+p[1]);
  else if (p[0] === 'aids') html = V.aids(q);
  else if (p[0] === 'goals') html = p[1] === 'from' ? V.goalsFrom(+p[2]) : V.goals(q);
  else if (p[0] === 'reports') html = V.reports();
  else if (p[0] === 'feedback') html = V.feedback(q);
  else if (p[0] === 'settings') html = V.settings();
  else html = V.notFound();
  root.innerHTML = html; cardify(root); window.scrollTo(0, 0); dirty = false;
  const f = document.getElementById('f');
  if (f) { f.addEventListener('input', () => { dirty = true; }); f.addEventListener('change', () => { markPrev(); refreshIcope(); }); markPrev(); refreshIcope(); }
  const pv = document.getElementById('pv'); if (pv) { const go = () => { pv.srcdoc = fullHTML(printDoc('a', +p[1]), true); }; PRINT_CSS ? go() : setTimeout(go, 400); }
  document.title = (document.querySelector('main h1') || {}).textContent?.trim() + '｜照護評估系統（試用版）';
}
let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  if (dirty && !confirm('這頁有尚未儲存的修改，確定要離開嗎？')) { history.replaceState(null, '', lastHash || '#/'); return; }
  lastHash = location.hash; route();
});
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
load(); route();
})();
