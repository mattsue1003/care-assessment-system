/* 照護評估系統（GitHub Pages 試用版）
 * 全部在瀏覽器執行；資料存在本機瀏覽器（localStorage），每個人各自一份。
 * 邏輯與 Python 正式版（schema.py / app.py）一致。 */
(function () {
'use strict';
const S = window.SCHEMA;
const STORE = 'care_trial_v2';
const D61_FIELDS = {}; S.D61.forEach(s => s.fields.forEach(f => D61_FIELDS[f.key] = f));
const D61_RADIOS = Object.values(D61_FIELDS).filter(f => f.type === 'radio');
const LIST_KEYS = new Set(Object.values(D61_FIELDS).filter(f => f.type === 'multi').map(f => f.key)
  .concat(S.ICOPE_ALL.map(([k]) => k + '_actions')));
const EXTRA = new Set(S.EXTRA_OPTS || []);
const tplChips = (key, target) => (S.TEMPLATES || {})[key] ? `<div class="tpl" data-for="${target}">${S.TEMPLATES[key].map(t => `<button type="button" class="tchip">${h(t)}</button>`).join('')}</div>` : '';
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
  DB.records = DB.records || [];
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
    <span class="small hide-m">${h(me())}</span><a class="small hide-m" href="#" onclick="return App.logout()">登出</a>
  </div>
  <div class="nav-mask" onclick="App.nav(false)"></div>
  <div class="wrap"><nav class="side">
    <div class="side-me show-m"><b>${h(me())}</b><div class="small muted">${h(setting('center_name'))}</div></div>
    ${nav('/', 'home', '🏠', '首頁／今日工作')}${nav('/clients', 'clients', '👥', '個案名冊')}
    <div class="grp">跨專業評估（B1）</div>${nav('/ia', 'ia', '總表', '跨專業評估總表')}${nav('/rec/CC', 'CC', '討論', '個案討論會')}${nav('/goals', 'goals', '計畫', '照顧計畫／自立支援')}
    <div class="grp">各專業評估</div>${nav('/rec/HA', 'HA', '護理', '健康評估／慢性病')}${nav('/rec/HV', 'HV', '社工', '家訪（含家系圖）')}${nav('/assess/ICOPE', 'ICOPE', '職能', '六力 ICOPE')}${nav('/assess/D61', 'D61', '職能', 'D61 職能治療評估')}${nav('/rec/MNA', 'MNA', '營養', '營養評估')}${nav('/rec/EA', 'EA', '適應', '環境適應（新案）')}
    <div class="grp">日常照顧</div>${nav('/daily', 'DAILY', '照服', '今日照顧紀錄')}${nav('/attendance', 'att', '出勤', '出勤統計')}${nav('/rec/IR', 'IR', '⚠️', '異常事件／送醫')}${nav('/aids', 'aids', '輔具', '輔具管理')}${nav('/acts', 'acts', '活動', '活動紀錄')}
    <div class="grp">家屬聯繫</div>${nav('/rec/PC', 'PC', '電訪', '電訪／群組電訪')}${nav('/rec/MS', 'MS', '月報', '月照顧摘要')}${nav('/rec/CL', 'CL', '結案', '結案紀錄')}
    <div class="grp">人員</div>${nav('/training', 'train', '訓練', '我的教育訓練')}${nav('/library', 'lib', '📚', '資料庫')}
    <div class="grp">評鑑與系統</div>${nav('/reports', 'reports', '📦', '評鑑對照／匯出')}${nav('/feedback', 'feedback', '💬', '試用意見回饋')}${nav('/settings', 'settings', '⚙️', '設定')}
    <a href="#" class="show-m" onclick="return App.logout()"><code>↩︎</code><span>登出</span></a>
  </nav><main>
    ${f ? `<div class="flash ${f[1]}">${h(f[0])}</div>` : ''}${body}
  </main></div>
  <nav class="tabbar">${tab('/', 'home', '🏠', '首頁')}${tab('/clients', 'clients', '👥', '個案')}${tab('/ia', 'ia', '🧭', '評估')}${tab('/daily', 'DAILY', '📋', '照顧')}
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
const clientOpts = (sel) => { const list = activeClients(); if (sel && !list.some(x => x.id === +sel) && client(sel)) list.unshift(Object.assign(client(sel), { label: client(sel).label + '（' + client(sel).status + '）' }));
  return list.map(x => `<option value="${x.id}" ${x.id === +sel ? 'selected' : ''}>${h(x.label)}</option>`).join(''); };
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
  const cs = activeClients(); const t = todayISO(); const ind = indicatorRows();
  const dailySaved = DB.records.filter(r => r.module === 'DAILY' && r.date === t).length;
  const due = cs.map(c => Object.assign(c, { ds: discStatus(c.id), cc: ccThisQuarter(c.id) })).filter(c => Object.values(c.ds).some(x => x.status !== '正常') || !c.cc)
    .sort((a, b) => Object.values(b.ds).filter(x => x.status !== '正常').length - Object.values(a.ds).filter(x => x.status !== '正常').length).slice(0, 12);
  const comm = (DB.acts || []).filter(a => a.date.startsWith(t.slice(0, 7)) && a.type === '社區活動').length;
  const hrs = (DB.trainings || []).filter(x => x.staff === me() && x.date.startsWith(t.slice(0, 4))).reduce((a, x) => a + (+x.hours || 0), 0);
  const irOpen = DB.records.filter(r => r.module === 'IR' && r.date >= addDays(t, -7)).length;
  return layout('home', `<div class="demo-note">👋 歡迎試用！這是去識別化的示範資料，可以隨意新增、修改。用完請按右上角 <b>💬</b> 告訴我們哪裡要增加或減少。</div>
  <div class="pagehead"><div><h1>今日工作</h1><div class="muted">${rocLong(t)}　在案 ${cs.length} 位</div></div></div>
  <div class="grid g4">
    <a class="stat ${dailySaved >= cs.length ? 'ok' : 'warn'}" href="#/daily"><span>今日照顧紀錄（B3 體溫）</span><b>${dailySaved}/${cs.length}</b><span class="small muted">點此登打</span></a>
    <a class="stat ${due.length ? 'bad' : 'ok'}" href="#/ia?f=due"><span>跨專業評估待辦</span><b>${due.length}</b><span class="small muted">有專業逾期或本季未討論</span></a>
    <a class="stat ${comm ? 'ok' : 'warn'}" href="#/acts"><span>本月社區活動（B7）</span><b>${comm}</b><span class="small muted">每月至少 1 次</span></a>
    <a class="stat ${hrs >= 20 ? 'ok' : 'info'}" href="#/training"><span>我的教育訓練（B11）</span><b>${hrs}<small style="font-size:14px"> / 20 時</small></b><span class="small muted">${irOpen ? `近 7 天異常事件 ${irOpen} 件` : '&nbsp;'}</span></a></div>
  <div class="grid g2" style="margin-top:16px"><div class="card"><h2>跨專業評估待辦</h2>
    ${due.length ? `<table class="t"><tr><th>個案</th><th>需補的專業</th><th>本季討論</th><th></th></tr>${due.map(c => `<tr><td class="ttl"><a href="#/ia/${c.id}">${h(c.label)}</a></td>
      <td>${Object.entries(c.ds).filter(([, x]) => x.status !== '正常').map(([k, x]) => `<a href="${DISC_MOD[k].add(c.id)}">${badge(DISC_MOD[k].name + (x.status === '逾期' ? '逾期' : '未評'), x.status)}</a>`).join(' ') || badge('四專業完成', 'ok')}</td>
      <td>${c.cc ? badge('已討論', 'ok') : badge('未討論', 'bad')}</td><td class="btns"><a class="btn sm" href="#/ia/${c.id}">總覽</a></td></tr>`).join('')}</table>` : '<div class="empty">全部個案都已完成跨專業評估與本季討論 👍</div>'}
    <p style="margin:10px 0 0"><a href="#/ia">看完整跨專業評估總表 →</a></p></div>
  <div class="card"><h2>115 年評鑑指標即時檢核</h2>${ind.map(([code, name, txt, st, link]) => `<a href="${link}" style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px dashed var(--line);color:inherit;text-decoration:none">
      <span class="b ${st}" style="min-width:42px;text-align:center">${code}</span><span><b>${name}</b><div class="small muted">${txt}</div></span></a>`).join('')}
    <p style="margin:10px 0 0"><a href="#/reports">評鑑對照／匯出 →</a></p></div></div>`);
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
  <div class="card btns" style="background:var(--brand-l)"><b>跨專業評估：</b><a class="btn sm pri" href="#/ia/${id}">🧭 跨專業評估總覽</a><a class="btn sm" href="#/s/CC/new?client=${id}">＋ 個案討論會</a><a class="btn sm" href="#/s/HA/new?client=${id}">＋ 健康評估</a></div>
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
  <div class="card"><h2>跨專業紀錄</h2><div class="btns" style="margin-bottom:8px"><a class="btn sm pri" href="#/nutri/new?client=${id}">＋ 營養評估</a><a class="btn sm pri" href="#/hv/new?client=${id}">＋ 家訪紀錄</a><a class="btn sm" href="#/s/PC/new?client=${id}">＋ 電訪</a><a class="btn sm" href="#/s/IR/new?client=${id}">＋ 異常事件</a><a class="btn sm" href="#/daily">今日照顧紀錄</a></div>
    <div class="tbl-wrap"><table class="t"><tr><th>紀錄</th><th>筆數</th><th>最近</th><th></th></tr>${ALL_MODS.map(m => { const rs = recs(m, id); return rs.length ? `<tr><td class="ttl">${MOD_NAME[m]}</td><td>${rs.length}</td><td>${roc(rs[0].date)}</td><td class="btns wide"><a class="btn sm" href="#/rec/${m}?client=${id}">查看</a></td></tr>` : ''; }).join('') || '<tr><td colspan="4" class="empty">尚無紀錄</td></tr>'}</table></div></div>
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
        if (f.type === 'multi') inner = `<div class="pills">${f.options.map(o => `<label class="pill ${['adl_help', 'bpsd'].includes(f.key) ? 'bad' : ''}"><input type="checkbox" name="${f.key}" value="${h(o)}" ${(v || []).includes(o) ? 'checked' : ''}><span>${h(o)}${EXTRA.has(o) ? '<sup class="new" title="依過去紀錄新增；care99 請寫在「其他」">新</sup>' : ''}</span></label>`).join('')}</div>
          ${f.other ? `<input type="text" class="other" name="${f.key}_other" value="${h(data[f.key + '_other'])}" placeholder="其他：">` : ''}${tplChips(f.key, f.key + '_other')}${pv && pv.length ? `<div class="small muted" style="margin-top:4px">上次：${h(pv.join('、'))}</div>` : ''}`;
        else if (f.type === 'radio') inner = `<div class="pills" data-prev="${h(pv || '')}">${f.options.map((o, i) => `<label class="pill ${i ? 'bad' : ''}"><input type="radio" name="${f.key}" value="${h(o)}" ${v === o ? 'checked' : ''}><span>${h(o)}</span></label>`).join('')}</div>
          ${f.note ? `<input type="text" class="note-in" name="${f.key}_note" value="${h(data[f.key + '_note'])}" placeholder="備註">` : ''}${tplChips(f.key, f.key + '_note')}`;
        else inner = `<input type="text" name="${f.key}" value="${h(v)}" style="width:100%">${tplChips(f.key, f.key)}`;
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
  const indTbl = `<div class="card"><h2>115 年附件2-3 指標對照（專業照護品質 B1–B12、A10）</h2><div class="tbl-wrap"><table class="t"><tr><th>指標</th><th>名稱</th><th>系統佐證現況</th><th>狀態</th><th></th></tr>
    ${indicatorRows().map(([c0, n0, t0, s0, l0]) => `<tr><td><b>${c0}</b></td><td class="ttl">${n0}</td><td class="small wide">${t0}</td><td>${badge({ ok: '符合', warn: '部分', bad: '待補' }[s0], s0)}</td><td class="btns wide"><a class="btn sm" href="${l0}">前往</a></td></tr>`).join('')}</table></div></div>`;
  return layout('reports', indTbl + `<div class="pagehead"><div><h1>評鑑佐證／匯出中心</h1><div class="muted">對應 115 年社區式「小規模多機能」評鑑基準（附件2-3）：B1、B9、B10</div></div></div>
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
    <div class="grid g2" style="margin-top:8px"><div><label class="f">我的姓名（教育訓練登打用）</label><input type="text" name="me_name" value="${h(me())}" style="width:100%"></div>
      <div><label class="f">身分</label><select name="role" style="width:100%">${opt(['admin', 'staff'], setting('role') || 'admin')}</select></div></div>
    <label class="f" style="margin-top:8px">再評估週期（月）</label><input type="number" name="reeval_months" value="${h(setting('reeval_months'))}" min="1" max="24">
    <div style="margin-top:12px"><button class="btn pri">儲存設定</button></div></form>
  <div class="card"><h2>試用資料</h2><p class="small muted" style="margin-top:0">試用版的資料只存在這個瀏覽器。換手機或清除瀏覽器資料就會回到初始示範資料。</p>
    <div class="btns"><button class="btn" onclick="App.backup()">⬇ 下載我的資料（備份）</button>
      <label class="btn">⬆ 載入備份<input type="file" accept=".json" style="display:none" onchange="App.restore(this)"></label>
      <button class="btn danger" onclick="App.reset()">↺ 重設為初始示範資料</button></div>
    <h2 style="margin-top:18px">正式版</h2><p class="small muted" style="margin:0">正式使用請下載 GitHub 上的 Python 版，資料只存在單位自己的電腦，並可匯入 Excel 名冊、產生 PDF。</p>
    <p><a href="https://github.com/mattsue1003/care-assessment-system" target="_blank" rel="noopener">github.com/mattsue1003/care-assessment-system</a></p></div></div>`);
V.notFound = () => layout('', '<div class="card empty">找不到這個頁面。<a href="#/">回首頁</a></div>');

/* ============================== 跨專業紀錄：今日照顧、營養評估、家訪 ============================== */
const recs = (mod, cid) => DB.records.filter(r => r.module === mod && (!cid || r.client_id === +cid)).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
const MOD_NAME = { DAILY: '今日照顧紀錄', MNA: '營養評估（MNA）', HV: '社工家訪紀錄', PC: '電訪紀錄', IR: '異常事件紀錄', MS: '月照顧摘要', CL: '結案紀錄', EA: '環境適應評估', HA: '健康評估／慢性疾病追蹤', CC: '跨專業個案討論會' };
const ALL_MODS = ['DAILY', 'MNA', 'HV', 'PC', 'IR', 'MS', 'CL', 'EA', 'HA', 'CC'];
const EA_KEYS = ['ea_exit', 'ea_act', 'ea_peer', 'ea_staff', 'ea_face', 'ea_behav'];
function adaptSummary(d, cid) {
  const sc = EA_KEYS.map(k => parseInt(d[k])).filter(x => !isNaN(x)); if (!sc.length) return '（請先勾選 6 項分數）';
  const total = sc.reduce((a, b) => a + b, 0), avg = total / sc.length; const level = avg >= 4 ? '適應良好' : avg >= 3 ? '適應狀況逐漸進步' : '適應狀況待加強';
  const o = [`案主至今${level}（總分 ${total}/${sc.length * 5}）`]; const pres = recs('DAILY', cid).slice(0, 10).map(r => r.data).filter(r => !r.absent);
  if (pres.length) { o.push(pres.filter(r => r.mood === '愉快').length >= pres.length * 0.7 ? '情緒平穩' : '情緒時有起伏'); o.push(pres.some(r => dailyAlerts(r).length) ? '生命徵象偶有異常，持續追蹤' : '生命徵象穩定');
    o.push(pres.filter(r => r.eat_amt === '全部吃完').length >= pres.length * 0.7 ? '早點及午餐皆吃完' : '進食量時有不足'); }
  const g = k => parseInt(d[k]) || 0; o.push(g('ea_act') >= 4 ? '中心活動能主動參與' : g('ea_act') === 3 ? '中心活動經邀請後可參與' : '活動參與較被動，需多鼓勵');
  if (g('ea_peer') >= 4) o.push('團體活動時會與其他長輩互動'); if (g('ea_exit') && g('ea_exit') <= 2) o.push('偶有找出口、想回家情形，需加強安撫與陪伴'); return o.join('，') + '。';
}
function monthSummary(cid, ym) {
  const inM = r => r.date.startsWith(ym); const daily = recs('DAILY', cid).filter(inM).reverse(); if (!daily.length) return '（這個月沒有每日照顧紀錄）';
  const pres = daily.filter(r => !r.data.absent).map(r => r.data); const num = (r, k) => { const v = parseFloat(r[k]); return isNaN(v) ? null : v; };
  const rng = k => { const v = pres.map(r => num(r, k)).filter(x => x !== null); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
  const most = k => { const c = {}; pres.forEach(r => { if (r[k] && r[k] !== '未記錄') c[r[k]] = (c[r[k]] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]); };
  const wd = [...new Set(daily.filter(r => !r.data.absent).map(r => toDate(r.date).getDay()))].sort(); const nm = '日一二三四五六';
  const wds = wd.length >= 5 ? '周一至周五' : wd.length ? '周' + wd.map(i => nm[i]).join('、') : '';
  const o = [`案主${wds ? '規律' + wds + '至' : '至'}中心接受照顧及參與活動，本月出席 ${pres.length} 天${daily.length > pres.length ? `、請假 ${daily.length - pres.length} 天` : ''}。`];
  const t = rng('temp'), sb = rng('sbp'), db = rng('dbp'), pu = rng('pulse'); const vit = [];
  if (t) vit.push(`體溫介於 ${t[0]}–${t[1]}℃`); if (sb && db) vit.push(`血壓介於 ${sb[0]}–${sb[1]}／${db[0]}–${db[1]} mmHg`); if (pu) vit.push(`脈搏 ${pu[0]}–${pu[1]} 次/分`);
  if (vit.length) o.push('量測生命徵象' + vit.join('，') + '。'); const al = pres.filter(r => dailyAlerts(r).length).length; if (al) o.push(`本月有 ${al} 天生命徵象或狀況異常，已通知護理師追蹤。`);
  if (most('activity').length) o.push(`活動參與多為${most('activity').join('、')}。`);
  const eh = most('eat_help')[0], ea = most('eat_amt')[0], wa = most('water_amt')[0]; if (eh || wa) o.push(`飲食多為${eh || ''}${ea ? '、' + ea : ''}${wa ? `；飲水約 ${wa} c.c.` : ''}。`);
  if (most('mood').length) o.push(`精神多為${most('mental').join('、')}，情緒多為${most('mood').join('、')}。`);
  recs('IR', cid).filter(inM).forEach(r => o.push('異常事件：' + (r.data.kind || []).join('、') + '。' + (r.data.desc || '').slice(0, 60)));
  const npc = recs('PC', cid).filter(inM).length; if (npc) o.push(`本月電訪家屬 ${npc} 次。`);
  return o.map((x, i) => `${i + 1}.${x}`).join('\n');
}
function closureStats(cid) { const d = recs('DAILY', cid); const n = m => recs(m, cid).length;
  return `1.服務開始：${d.length ? roc(d[d.length - 1].date) : '—'}\n2.服務結束：${d.length ? roc(d[0].date) : '—'}\n3.家訪次數：${n('HV')}次\n4.電訪次數：${n('PC')}次\n5.異常事件：${n('IR')}次\n6.申訴次數：0次`; }
function familyOpts(c) { const out = []; (c.phone2 || '').split(/\s+/).forEach(p => { const b = p.split('/'); if (b.length >= 3) out.push(b[1] + '/' + b[2]); });
  DB.records.filter(r => ['PC', 'IR'].includes(r.module) && r.client_id === c.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).forEach(r => { if (r.data.family && !out.includes(r.data.family)) out.push(r.data.family); });
  return out.slice(0, 8); }
function simpleField(f, d, fam) {
  const v = d[f.key]; let inner;
  if (f.type === 'multi') inner = `<div class="pills">${f.options.map(o => `<label class="pill"><input type="checkbox" name="${f.key}" value="${h(o)}" ${(v || []).includes(o) ? 'checked' : ''}><span>${h(o)}</span></label>`).join('')}</div>`;
  else if (f.type === 'radio') inner = `<div class="pills">${f.options.map(o => `<label class="pill"><input type="radio" name="${f.key}" value="${h(o)}" ${v === o ? 'checked' : ''}><span>${h(o)}</span></label>`).join('')}</div>`;
  else if (f.type === 'time') inner = `<input type="time" name="${f.key}" value="${h(v)}">`;
  else if (f.type === 'date') inner = `<input type="date" name="${f.key}" value="${h(v)}">`;
  else if (f.type === 'text' && f.chips === 'hospital') { const past = [...new Set(DB.records.filter(r => r.module === 'HA' && r.data.hospital).map(r => r.data.hospital))].slice(0, 8);
    inner = `<input type="text" name="${f.key}" value="${h(v)}" style="width:100%">${past.length ? `<div class="tpl" data-for="${f.key}" data-replace="1">${past.map(x => `<button type="button" class="tchip">${h(x)}</button>`).join('')}</div>` : ''}`; }
  else if (f.type === 'month') inner = `<input type="month" name="${f.key}" value="${h(v || todayISO().slice(0, 7))}">`;
  else if (f.type === 'family') inner = `<input type="text" name="${f.key}" value="${h(v)}" placeholder="姓名／關係" style="width:100%">${fam.length ? `<div class="tpl" data-for="${f.key}" data-replace="1">${fam.map(x => `<button type="button" class="tchip">${h(x)}</button>`).join('')}</div>` : ''}`;
  else if (f.type === 'textarea') inner = `${f.auto ? `<div class="btns" style="margin-bottom:6px"><button type="button" class="btn sm acc" onclick="App.autoGen('${f.key}','${f.auto}')">✨ 自動產生</button></div>` : ''}<textarea name="${f.key}" id="ta_${f.key}" style="min-height:${f.auto ? 160 : 80}px">${h(v)}</textarea>${f.templates ? `<div class="tpl" data-for="${f.key}" data-nosep="1">${f.templates.map(t => `<button type="button" class="tchip">${h(t)}</button>`).join('')}</div>` : ''}`;
  else inner = `<input type="text" name="${f.key}" value="${h(v)}" style="width:100%">`;
  return `<div class="fld wide"><div class="lb">${h(f.label)}</div><div>${inner}</div></div>`;
}
V.simpleForm = (mod, id, q, batch) => {
  const spec = S.SIMPLE[mod]; const r = id ? DB.records.find(x => x.id === +id) : null; const cid = +(q.client || (r && r.client_id) || 0); const c = cid ? client(cid) : null;
  const d = r ? r.data : Object.fromEntries(spec.fields.filter(f => f.default).map(f => [f.key, f.default])); if (batch) d.items = ['服務異動通知'];
  const fam = c ? familyOpts(c) : []; if (!r && fam.length && !d.family) d.family = fam[0];
  const who = batch ? `<div class="card"><h2>通知對象 <label class="small" style="font-weight:400"><input type="checkbox" onclick="document.querySelectorAll('[name=clients]').forEach(x=>x.checked=this.checked)"> 全選</label></h2><div class="grid g3">${activeClients().map(x => { const fo = familyOpts(x);
    return `<div style="display:flex;gap:6px;align-items:center"><label><input type="checkbox" name="clients" value="${x.id}"> ${h(x.name)}</label><input type="text" name="family_${x.id}" value="${h(fo[0] || '')}" placeholder="家屬" style="flex:1;font-size:13px;padding:4px 6px;min-height:0"></div>`; }).join('')}</div></div>` : '';
  const bar = batch ? `<div class="formbar"><div class="fr"><div><label class="f">日期</label><input type="date" name="date" value="${todayISO()}" required></div><span style="flex:1"></span><div class="btns hide-m"><button class="btn pri">💾 儲存</button></div></div></div><button class="fab-save" type="submit">💾 儲存</button>`
    : recFormBar(mod, c, r ? r.date : todayISO(), !!r, `/s/${mod}/new`);
  return layout(mod, `<div class="pagehead"><div><h1>${batch ? '群組電訪（一次通知多位家屬）' : spec.title}</h1><div class="muted">${batch ? '勾選要通知的個案，內容寫一次，系統會為每位個案各建一筆電訪紀錄' : '常用內容點一下就帶入；聯絡家屬從過去紀錄自動帶出'}</div></div>
    <span class="sp"></span>${mod === 'PC' && !batch ? '<a class="btn" href="#/s/PC/batch">群組電訪</a>' : ''}</div>
    <form id="f" onsubmit="return App.saveSimple(event,'${mod}',${id || 0},${batch ? 1 : 0})">${bar}${(c || batch) ? who + `<div class="card">${spec.fields.filter(f => !(batch && f.type === 'family')).map(f => simpleField(f, d, fam)).join('')}
      <div class="btns" style="margin-top:12px"><button class="btn pri">💾 儲存</button></div></div>` : '<div class="card empty">請先選擇個案</div>'}</form>`);
};
function dailyAlerts(d) {
  const n = k => { const v = parseFloat(d[k]); return isNaN(v) ? null : v; }; const o = [];
  const t = n('temp'), p = n('pulse'), s = n('sbp'), di = n('dbp');
  if (t !== null && t >= 37.5) o.push('體溫 ' + t); if (s !== null && (s >= 160 || s < 90)) o.push('收縮壓 ' + s);
  if (di !== null && di >= 100) o.push('舒張壓 ' + di); if (p !== null && (p > 100 || p < 50)) o.push('脈搏 ' + p);
  if (['焦慮不安', '易發怒'].includes(d.mood)) o.push('情緒' + d.mood); if (['吃完3分', '未進食'].includes(d.eat_amt)) o.push('進食' + d.eat_amt);
  if (d.stool === '3次以上') o.push('大便 3 次以上'); return o;
}
function usualDaily(cid) {
  const rows = recs('DAILY', cid).slice(0, 20).map(r => r.data); const out = Object.assign({}, S.DAILY_DEFAULT);
  Object.keys(S.DAILY_DEFAULT).forEach(k => { const c = {}; rows.forEach(r => { if (r[k] && r[k] !== '未記錄') c[r[k]] = (c[r[k]] || 0) + 1; });
    const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; if (best) out[k] = best[0]; });
  return out;
}
function bmiBand(h, w) { const b = Math.round(parseFloat(w) / Math.pow(parseFloat(h) / 100, 2) * 10) / 10; if (!isFinite(b) || !b) return [null, null, ''];
  return [b, b <= 18.5 ? 0 : b <= 24 ? 1 : b <= 27 ? 2 : 3, b < 18.5 ? '體位過輕' : b < 24 ? '體位正常' : b < 27 ? '體位過重' : '肥胖']; }
function mnaScore(d) {
  const pick = (k, o) => { const m = (o || []).find(x => x[0] === d[k]); return m ? m[1] : 0; };
  let s = S.MNA_SCREEN.reduce((a, [k, , o]) => a + pick(k, o), 0); const [b, bsc, bl] = bmiBand(d.height, d.weight); s += bsc || 0;
  let full = null;
  if (S.MNA_FULL.some(([k]) => d[k] && (!Array.isArray(d[k]) || d[k].length)) || d.mac || d.cc) {
    full = 0; S.MNA_FULL.forEach(([k, , o]) => { if (o === 'protein') { const n = (d.K || []).length; full += n === 3 ? 1 : n === 2 ? 0.5 : 0; } else full += pick(k, o); });
    const mac = parseFloat(d.mac); if (!isNaN(mac)) full += mac >= 22 ? 1 : mac >= 21 ? 0.5 : 0; const cc = parseFloat(d.cc); if (!isNaN(cc)) full += cc >= 31 ? 1 : 0;
  }
  const total = full === null ? null : s + full;
  const level = total !== null ? (total >= 24 ? '營養狀況良好' : total >= 17 ? '有營養不良危險' : '營養不良') : (s >= 12 ? '正常（≧12）' : '可能營養不良，建議完成完整評估／營養師介入');
  return { s, full, total, b, bl, level };
}
function mnaAdvice(d) {
  const [b, , bl] = bmiBand(d.height, d.weight); const p = []; if (b) p.push(`BMI:${b}(${bl})`);
  if (d.texture) p.push('採' + (['體位過重', '肥胖'].includes(bl) && d.reduce ? '減重、' : '') + d.texture + (d.protein_g ? `(蛋白質${d.protein_g}g)` : ''));
  if (d.kcal) p.push(`一日${d.kcal}大卡`);
  const port = [['p_staple', '主食'], ['p_protein', '蛋白質'], ['p_veg', '蔬菜'], ['p_snack', '點心']].filter(([k]) => d[k]).map(([k, n]) => `${n}${d[k]}份`);
  if (port.length) p.push('建議' + port.join('、')); if (d.water) p.push(`日照給水${d.water}毫升`); return p.join('，');
}
const CN = '一二三四五六七八';
function hvDays(days) { const ds = S.WEEKDAYS.filter(d => (days || []).includes(d)); if (!ds.length) return ''; const ix = ds.map(d => S.WEEKDAYS.indexOf(d));
  return ds.length >= 3 && ix.every((v, i) => v === ix[0] + i) ? `周${ds[0]}至周${ds[ds.length - 1]}` : '周' + ds.join('、'); }
function hvConclusion(d) {
  const codes = d.codes || []; const bb = codes.filter(c => c.startsWith('BB')); const out = []; const main = [];
  if (bb.length) main.push(`日間照顧服務(${bb[0]})`); if (codes.includes('BD03')) main.push('社區式交通接送服務(BD03)');
  if (main.length) out.push(`持續提供${hvDays(d.days)}` + main.join('及')); if (codes.includes('GA03')) out.push('必要時提供日間照顧喘息服務(GA03)');
  if (d.concl_extra) out.push(d.concl_extra); return out.map((s, i) => `${CN[i]}、${s}`).join('。') + (out.length ? '。' : '');
}
function hvProblems(d) {
  const out = S.HV_PROBLEMS.map(([p], i) => (d.problems || []).includes(p) ? p + (d['cause_' + i] ? '/' + d['cause_' + i] : '') : '').filter(Boolean);
  if (d.problem_other) out.push(d.problem_other); return out.map((s, i) => `${CN[i]}、${s}`).join('；');
}
function recData(form, lists) { const fd = new FormData(form); const d = {};
  for (const k of new Set(fd.keys())) { if (['client_id', 'date'].includes(k)) continue; const v = fd.getAll(k).map(x => String(x).trim()).filter(Boolean); if (!v.length) continue; d[k] = lists.includes(k) ? v : v[v.length - 1]; }
  return d; }
function saveRec(mod, id, cid, date, data) {
  const rec = { client_id: +cid, module: mod, date, staff: '示範人員', data };
  if (id) Object.assign(DB.records.find(r => r.id === id), rec); else { id = nextId(); DB.records.push(Object.assign({ id }, rec)); } save(); return id;
}

V.daily = (q) => {
  const day = iso(q.date) || todayISO(); const cs = activeClients(); let saved = 0;
  const cards = cs.map(c => { const ex = DB.records.find(r => r.module === 'DAILY' && r.client_id === c.id && r.date === day); if (ex) saved++;
    const usual = usualDaily(c.id); const d = ex ? ex.data : usual; const p = `c${c.id}_`;
    const sels = S.DAILY_FIELDS.filter(f => f[2] === 'sel').map(([k, l, , opts]) => `<label>${l}<select name="${p}${k}" data-k="${k}">${opts.map(o => `<option ${d[k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`).join('');
    const num = (k, l, ph = '', step = '1') => `<label>${l}<input type="number" step="${step}" inputmode="decimal" name="${p}${k}" value="${h(d[k])}" placeholder="${ph}"></label>`;
    return `<div class="card daily ${d.absent ? 'absent' : ''}" data-usual='${h(JSON.stringify(usual))}'>
      <div class="dhead"><label class="present"><input type="checkbox" name="${p}present" value="1" ${d.absent ? '' : 'checked'}> 到中心</label>
        <a href="#/clients/${c.id}"><b>${h(c.name)}</b></a> <span class="muted small">${h(c.case_no)}</span>${ex ? ' ' + badge('已存', 'ok') : ''}<span class="alerts">${ex ? dailyAlerts(d).map(a => badge(a, 'bad')).join(' ') : ''}</span></div>
      <div class="dgrid"><div class="vit"><label>時間<input type="time" name="${p}time" value="${h(d.time)}"></label>${num('temp', '體溫', '36.5', '0.1')}${num('pulse', '脈搏')}
        <label>血壓<span class="bp"><input type="number" inputmode="numeric" name="${p}sbp" value="${h(d.sbp)}" placeholder="收縮">/<input type="number" inputmode="numeric" name="${p}dbp" value="${h(d.dbp)}" placeholder="舒張"></span></label>
        <label class="opt">複測血壓<input type="text" name="${p}bp2" value="${h(d.bp2)}" placeholder="例 11:50 106/58"></label>${num('weight', '體重', '每月', '0.1').replace('<label>', '<label class="opt">')}</div>
        <div class="sels">${sels}</div><div class="dnote"><input type="text" name="${p}note" value="${h(d.note)}" placeholder="備註／異常（沒事不用填）" list="dailyTpl"></div></div></div>`; }).join('');
  return layout('DAILY', `<div class="pagehead"><div><h1>今日照顧紀錄</h1><div class="muted">生命徵象＋如廁＋照顧紀錄合併一頁；已依每位長輩「平常的狀況」帶好，只要改有變化的</div></div><span class="sp"></span>
    <div class="btns"><a class="btn" href="#/daily?date=${addDays(day, -1)}">◀ 前一天</a><input type="date" value="${day}" onchange="App.go('/daily?date='+this.value)"><a class="btn" href="#/daily?date=${addDays(day, 1)}">後一天 ▶</a></div></div>
    <div class="card fr" style="align-items:center"><div><b>${rocLong(day)}</b>　<span class="muted">在案 ${cs.length} 位・已儲存 ${saved} 位</span></div><span style="flex:1"></span>
      <div class="btns"><label class="small"><input type="checkbox" id="onlyAlert" onchange="App.dailyFilter(this.checked)"> 只看異常／已修改</label><a class="btn sm" href="#/rec/DAILY">歷史紀錄</a></div></div>
    <form id="df" onsubmit="return App.saveDaily(event,'${day}')">${cards}<datalist id="dailyTpl">${S.DAILY_NOTE_TPL.map(t => `<option>${t}</option>`).join('')}</datalist>
    <button class="fab-save" style="display:block" type="submit">💾 儲存全部</button><div class="btns" style="margin:16px 0 80px"><button class="btn pri">💾 儲存全部（${cs.length} 位）</button></div></form>`);
};
function dailyCheck(card) {
  const usual = JSON.parse(card.dataset.usual || '{}'); let changed = false;
  card.querySelectorAll('select[data-k]').forEach(s => { const diff = usual[s.dataset.k] && s.value !== usual[s.dataset.k]; s.classList.toggle('chg', !!diff); if (diff) changed = true; });
  const d = {}; card.querySelectorAll('[name]').forEach(e => { d[e.name.replace(/^c\d+_/, '')] = e.value; });
  card.querySelector('.alerts').innerHTML = dailyAlerts(d).map(a => badge(a, 'bad')).join(' ');
  const absent = !card.querySelector('.present input').checked; card.classList.toggle('absent', absent);
  card.dataset.flag = (dailyAlerts(d).length || changed || absent || (d.note || '').trim()) ? '1' : '';
}
V.recList = (mod, q) => {
  const cid = q.client ? +q.client : null; const c = cid ? client(cid) : null; let rows = recs(mod, cid).slice(0, 300);
  let head, body;
  if (mod === 'DAILY') { head = '<tr><th>日期</th><th>個案</th><th>體溫</th><th>脈搏</th><th>血壓</th><th>大小便</th><th>精神／情緒</th><th>進食</th><th>備註</th><th>提醒</th></tr>';
    body = rows.map(r => { const d = r.data, x = client(r.client_id); return `<tr><td>${roc(r.date)}</td><td class="ttl">${h(x.name)}</td>${d.absent ? `<td colspan="7" class="muted">未到中心 ${h(d.note)}</td>` :
      `<td>${h(d.temp) || '—'}</td><td>${h(d.pulse) || '—'}</td><td>${h(d.sbp) || '—'}/${h(d.dbp) || '—'}</td><td>${h(d.stool)}／${h(d.urine)}</td><td>${h(d.mental)}／${h(d.mood)}</td><td>${h(d.eat_help)} ${h(d.eat_amt)}</td><td class="small wide">${h(d.note)}</td>`}
      <td>${dailyAlerts(d).map(a => badge(a, 'bad')).join(' ')}</td></tr>`; }).join(''); }
  else if (mod === 'MNA') { head = '<tr><th>日期</th><th>個案</th><th>BMI</th><th>篩檢分</th><th>合計</th><th>判讀</th><th>營養師建議</th><th></th></tr>';
    body = rows.map(r => { const s = mnaScore(r.data), x = client(r.client_id); return `<tr><td>${roc(r.date)}</td><td class="ttl">${h(x.name)}</td><td>${s.b ?? '—'}</td><td>${s.s}</td><td>${s.total ?? '—'}</td>
      <td>${badge(s.level, /良好|正常/.test(s.level) ? 'ok' : 'bad')}</td><td class="small wide">${h(r.data.advice)}</td><td class="btns wide"><a class="btn sm" href="#/r/${r.id}">檢視</a></td></tr>`; }).join(''); }
  else if (S.SIMPLE[mod]) { const fs = S.SIMPLE[mod].fields.filter(f => f.type !== 'time').slice(0, 5); head = `<tr><th>日期</th><th>個案</th>${fs.map(f => `<th>${f.label}</th>`).join('')}<th></th></tr>`;
    body = rows.map(r => { const x = client(r.client_id); return `<tr><td>${roc(r.date)}</td><td class="ttl">${h(x.name)}</td>${fs.map(f => { const v = r.data[f.key]; return `<td class="small ${f.type === 'textarea' ? 'wide' : ''}">${h(Array.isArray(v) ? v.join('、') : (v || '').slice(0, 60))}</td>`; }).join('')}
      <td class="btns wide"><a class="btn sm" href="#/r/${r.id}">檢視</a></td></tr>`; }).join(''); }
  else { head = '<tr><th>日期</th><th>個案</th><th>對象</th><th>事由</th><th>結論</th><th></th></tr>';
    body = rows.map(r => { const x = client(r.client_id); return `<tr><td>${roc(r.date)}</td><td class="ttl">${h(x.name)}</td><td>${h((r.data.target || []).join('、'))}</td><td>${h((r.data.items || []).join('、'))}</td>
      <td class="small wide">${h((r.data.conclusion || '').slice(0, 80))}</td><td class="btns wide"><a class="btn sm" href="#/r/${r.id}">檢視</a><a class="btn sm" href="#/hv/new?client=${r.client_id}">新家訪</a></td></tr>`; }).join(''); }
  const add = S.SIMPLE[mod] ? `<a class="btn pri" href="#/s/${mod}/new${cid ? '?client=' + cid : ''}">＋ 新增</a>${mod === 'PC' ? '<a class="btn" href="#/s/PC/batch">群組電訪</a>' : ''}` : mod === 'MNA' ? `<a class="btn pri" href="#/nutri/new${cid ? '?client=' + cid : ''}">＋ 營養評估</a>` : mod === 'HV' ? `<a class="btn pri" href="#/hv/new${cid ? '?client=' + cid : ''}">＋ 家訪紀錄</a>` : `<a class="btn pri" href="#/daily">今日照顧紀錄</a>`;
  return layout(mod, `<div class="pagehead"><div><h1>${MOD_NAME[mod]}</h1><div class="muted">${c ? h(c.label) + '・' : ''}最近 ${rows.length} 筆</div></div><span class="sp"></span><div class="btns">${add}${c ? `<a class="btn" href="#/clients/${cid}">回個案</a>` : ''}</div></div>
    <div class="tbl-wrap"><table class="t">${head}${body || '<tr><td colspan="10" class="empty">沒有資料</td></tr>'}</table></div>`);
};
V.recView = (id) => {
  const r = DB.records.find(x => x.id === +id); if (!r) return V.notFound(); const c = client(r.client_id); const d = r.data; let body;
  if (r.module === 'MNA') { const s = mnaScore(d);
    body = `<div class="grid g2"><div class="card"><h2>結果</h2><dl class="kv"><dt>身高／體重</dt><dd>${h(d.height) || '—'} cm／${h(d.weight) || '—'} kg</dd><dt>BMI</dt><dd>${s.b ?? '—'} ${s.bl}</dd>
      <dt>篩檢分</dt><dd><b>${s.s}</b> / 14</dd><dt>完整評估</dt><dd>${s.full ?? '未做'}</dd><dt>合計</dt><dd>${s.total ?? '—'}</dd><dt>判讀</dt><dd><b>${s.level}</b></dd></dl></div>
      <div class="card"><h2>營養師建議</h2><p style="white-space:pre-wrap">${h(d.advice) || '（未填）'}</p></div></div>
      <div class="card"><h2>作答</h2><table class="t">${S.MNA_SCREEN.concat(S.MNA_FULL).filter(([k]) => d[k]).map(([k, q]) => `<tr><td>${k}. ${h(q)}</td><td><b>${h(Array.isArray(d[k]) ? d[k].join('、') : d[k])}</b></td></tr>`).join('')}</table></div>`; }
  else if (S.SIMPLE[r.module]) body = `<div class="card"><dl class="kv">${S.SIMPLE[r.module].fields.filter(f => d[f.key]).map(f => `<dt>${f.label}</dt><dd style="white-space:pre-wrap">${h(Array.isArray(d[f.key]) ? d[f.key].join('、') : d[f.key])}</dd>`).join('')}</dl></div>`;
  else body = `${(d.genogram || []).length ? `<div class="card"><h2>家系圖</h2>${genoSVG(d.genogram, c)}</div>` : ''}<div class="card"><dl class="kv"><dt>訪視對象</dt><dd>${h((d.target || []).join('、'))} ${h(d.family_member)}</dd><dt>事由</dt><dd>${h((d.items || []).join('、'))}</dd></dl></div>
    <div class="card">${S.HV_SECTIONS.filter(([k]) => d[k]).map(([k, t]) => `<h3 style="margin-top:10px">${t}</h3><p style="white-space:pre-wrap;margin:4px 0">${h(d[k])}</p>`).join('')}
    <h3 style="margin-top:10px">參、問題分析</h3><p>${h(hvProblems(d)) || '—'}</p><h3 style="margin-top:10px">肆、結論</h3><p style="white-space:pre-wrap">${h(d.conclusion || hvConclusion(d))}</p></div>`;
  const edit = S.SIMPLE[r.module] ? `#/s/${r.module}/${r.id}/edit` : r.module === 'MNA' ? `#/nutri/${r.id}/edit` : `#/hv/${r.id}/edit`;
  return layout(r.module, `<div class="pagehead"><div><h1>${MOD_NAME[r.module]}</h1><div class="muted"><a href="#/clients/${c.id}">${h(c.label)}</a>・${rocLong(r.date)}</div></div><span class="sp"></span>
    <div class="btns"><a class="btn" href="${edit}">✏️ 編輯</a>${r.module === 'HV' ? `<a class="btn pri" href="#/hv/new?client=${c.id}">＋ 新家訪（沿用本次）</a>` : ''}<button class="btn danger" onclick="App.delRec(${r.id})">刪除</button></div></div>${body}`);
};
function recFormBar(mod, c, day, isEdit, route) {
  return `<div class="formbar"><div class="fr"><div><label class="f">個案</label><select name="client_id" required ${isEdit ? '' : `onchange="App.go('${route}?client='+this.value)"`} style="min-width:200px">
    <option value="">— 請選擇 —</option>${clientOpts(c && c.id)}</select></div><div><label class="f">日期</label><input type="date" name="date" value="${day}" required></div>
    <span style="flex:1"></span><div class="btns hide-m"><button class="btn pri">💾 儲存</button></div></div></div>${c ? '<button class="fab-save" type="submit">💾 儲存</button>' : ''}`;
}
V.nutriForm = (id, q) => {
  const r = id ? DB.records.find(x => x.id === +id) : null; const cid = +(q.client || (r && r.client_id) || 0); const c = cid ? client(cid) : null;
  let d = r ? r.data : {}; if (!r && c) { const last = recs('MNA', cid)[0]; if (last) ['height', 'texture', 'p_staple', 'p_protein', 'p_veg', 'water'].forEach(k => { if (last.data[k]) d[k] = last.data[k]; }); }
  const qq = ([k, t, o]) => `<div class="mna-q"><div><b>${k}.</b> ${h(t)}</div><div class="pills" style="margin-top:6px">${o === 'protein'
    ? S.PROTEIN.map(x => `<label class="pill"><input type="checkbox" name="K" value="${h(x)}" ${(d.K || []).includes(x) ? 'checked' : ''}><span>${h(x)}</span></label>`).join('')
    : o.map(([x, sc]) => `<label class="pill"><input type="radio" name="${k}" value="${h(x)}" ${d[k] === x ? 'checked' : ''}><span>${h(x)} <small>(${sc})</small></span></label>`).join('')}</div></div>`;
  const sel = (name, opts) => `<select name="${name}">${opts.map(o => `<option ${d[name] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  return layout('MNA', `<div class="pagehead"><div><h1>營養評估（MNA）</h1><div class="muted">BMI、分數、營養師建議句都會自動算；選項與分數沿用中心 care99 的版本</div></div></div>
  <form id="f" data-kind="mna" onsubmit="return App.saveMNA(event,${id || 0})">${recFormBar('MNA', c, r ? r.date : todayISO(), !!r, '/nutri/new')}
  ${!c ? '<div class="card empty">請先選擇個案</div>' : `<div class="grid view-grid"><div>
    <div class="card"><h2>身體測量</h2><div class="fr"><div><label class="f">身高 cm</label><input type="number" step="0.1" inputmode="decimal" name="height" value="${h(d.height)}"></div>
      <div><label class="f">體重 kg</label><input type="number" step="0.1" inputmode="decimal" name="weight" value="${h(d.weight)}"></div><div><label class="f">BMI（自動）</label><input type="text" id="bmi" readonly style="width:150px;background:#f3f6f5"></div>
      <div><label class="f">臂中圍 MAC（cm）</label><input type="number" step="0.1" inputmode="decimal" name="mac" value="${h(d.mac)}" style="width:100px"><div class="small muted" id="macBand">≥22＝1分；21–21.9＝0.5分</div></div>
      <div><label class="f">小腿圍 CC（cm）</label><input type="number" step="0.1" inputmode="decimal" name="cc" value="${h(d.cc)}" style="width:100px"><div class="small muted" id="ccBand">≥31＝1分</div></div></div>
      <div class="small muted" style="margin-top:6px">${(() => { const prev = recs('MNA', cid).filter(x => !r || x.id !== r.id)[0]; return prev ? `上次（${roc(prev.date)}）：身高 ${h(prev.data.height) || '—'}、體重 ${h(prev.data.weight) || '—'}、MAC ${h(prev.data.mac) || '—'}、CC ${h(prev.data.cc) || '—'}` : ''; })()}</div></div>
    <div class="card"><h2>營養篩檢（A–F，滿分 14）</h2>${S.MNA_SCREEN.map(qq).join('')}<div class="mna-q"><b>F.</b> 身體質量指數（BMI）<span class="muted">　依身高體重自動計分</span></div></div>
    <details class="card box" id="full" ${d.G || d.mac ? 'open' : ''}><summary>完整評估（G–R，篩檢 ≦11 分時建議填寫）</summary>${S.MNA_FULL.map(qq).join('')}
      <div class="mna-q small muted">Q 臂中圍、R 小腿圍已移到上方「身體測量」，填了會自動計分</div></details>
    <div class="card"><h2>營養師建議</h2><div class="fr"><div><label class="f">飲食質地</label>${sel('texture', [''].concat(S.DIET_TEXTURE))}</div><div><label class="f">減重</label><label><input type="checkbox" name="reduce" value="1" ${d.reduce ? 'checked' : ''}> 需減重</label></div>
      <div><label class="f">主食（份）</label>${sel('p_staple', ['', '1', '1.5', '2', '2.5', '3', '3.5', '4'])}</div><div><label class="f">蛋白質（份）</label>${sel('p_protein', ['', '1', '1.5', '2', '2.5', '3'])}</div>
      <div><label class="f">蔬菜（份）</label>${sel('p_veg', ['', '0.5', '1', '1.5', '2'])}</div><div><label class="f">點心（份）</label>${sel('p_snack', ['', '0.5', '1', '1.5', '2'])}</div><div><label class="f">一日熱量（大卡）</label>${sel('kcal', ['', '1200', '1300', '1400', '1500', '1600', '1700', '1800', '1900', '2000'])}</div>
      <div><label class="f">蛋白質（g）</label><input type="text" name="protein_g" value="${h(d.protein_g)}" placeholder="例 25-26" style="width:90px"></div>
      <div><label class="f">日照給水（毫升）</label>${sel('water', ['', '500~600', '700~800', '900~1000', '1000~1100', '1100~1200', '1200~1300'])}</div></div>
      <div class="btns" style="margin:10px 0 6px"><button type="button" class="btn sm acc" onclick="App.genAdvice()">✨ 產生建議句</button></div><textarea name="advice" id="advice" style="min-height:70px">${h(d.advice)}</textarea></div></div>
    <div><div class="card score-box sum-box"><div class="muted small">篩檢分（/14）</div><b class="big" id="s_screen">—</b><div class="muted small" style="margin-top:6px">合計（/30）</div><b id="s_total">—</b>
      <div style="margin-top:8px"><span class="b" id="s_level">—</span></div><div class="small muted" style="margin-top:8px">≧12 正常；≦11 可能營養不良，建議完成完整評估或營養師介入</div></div></div></div>`}</form>`);
};
function mnaRefresh() { const f = document.getElementById('f'); if (!f || f.dataset.kind !== 'mna' || !document.getElementById('bmi')) return; const d = recData(f, ['K']); const s = mnaScore(d);
  document.getElementById('bmi').value = s.b ? `${s.b}（${s.bl}）` : '';
  const mac = parseFloat(d.mac), cc = parseFloat(d.cc); const mb = document.getElementById('macBand'), cb = document.getElementById('ccBand');
  if (mb) mb.textContent = isNaN(mac) ? '≥22＝1分；21–21.9＝0.5分' : `${mac >= 22 ? 1 : mac >= 21 ? 0.5 : 0} 分${mac < 21 ? '（偏低，留意肌肉量流失）' : ''}`;
  if (cb) cb.textContent = isNaN(cc) ? '≥31＝1分' : `${cc >= 31 ? 1 : 0} 分${cc < 31 ? '（偏低，肌少症風險）' : ''}`; document.getElementById('s_screen').textContent = s.s; document.getElementById('s_total').textContent = s.total ?? '—';
  const lv = document.getElementById('s_level'); lv.textContent = s.level; lv.className = 'b ' + (/良好|正常/.test(s.level) ? 'ok' : 'bad'); if (s.s <= 11) document.getElementById('full').open = true; }
V.hvForm = (id, q) => {
  const r = id ? DB.records.find(x => x.id === +id) : null; const cid = +(q.client || (r && r.client_id) || 0); const c = cid ? client(cid) : null;
  const last = c ? recs('HV', cid).filter(x => !r || x.id !== r.id)[0] : null; let d = r ? r.data : {};
  if (!r && last) { d = {}; S.HV_SECTIONS.forEach(([k, , carry]) => { if (carry && last.data[k]) d[k] = last.data[k]; });
    ['target', 'family_member', 'problems', 'days', 'codes', 'genogram'].concat(S.HV_PROBLEMS.map((_, i) => 'cause_' + i)).forEach(k => { if (last.data[k]) d[k] = last.data[k]; }); }
  GENO = JSON.parse(JSON.stringify(d.genogram || []));
  if (c && !d.basic) d.basic = `${c.age ?? ''}歲${{ 男: '男性', 女: '女性' }[c.gender] || ''}，長照福利身分別為${c.identity || '—'}。`;
  const pills = (name, list, sel) => `<div class="pills">${list.map(t => `<label class="pill"><input type="checkbox" name="${name}" value="${h(t)}" ${(sel || []).includes(t) ? 'checked' : ''}><span>${h(name === 'days' ? '週' + t : t)}</span></label>`).join('')}</div>`;
  return layout('HV', `<div class="pagehead"><div><h1>社工家訪紀錄</h1><div class="muted">各段自動沿用上次內容，只改有變化的地方；問題分析、結論用勾選自動產生</div></div></div>
  <form id="f" data-kind="hv" onsubmit="return App.saveHV(event,${id || 0})">${recFormBar('HV', c, r ? r.date : todayISO(), !!r, '/hv/new')}
  ${!c ? '<div class="card empty">請先選擇個案</div>' : `${last && !r ? `<div class="src">ℹ️ 已帶入上次家訪（${roc(last.date)}）的內容；與上次不同的段落會標成黃色</div>` : ''}
  <div class="card"><div class="grid g3"><div><label class="f">訪視對象</label>${pills('target', S.HV_TARGETS, d.target)}</div>
    <div><label class="f">家屬（姓名／關係）</label><input type="text" name="family_member" value="${h(d.family_member)}" style="width:100%"></div><div><label class="f">事由</label>${pills('items', S.HV_ITEMS, d.items)}</div></div></div>
  <div class="card"><div class="fr" style="justify-content:space-between"><h2 style="margin:0">家系圖</h2><div class="btns"><button type="button" class="btn sm acc" onclick="App.genoToText()">✨ 依家系圖寫入「家庭狀況」</button><button type="button" class="btn sm" onclick="App.genoPrint()">🖨 列印家系圖</button></div></div>
    <div class="small muted" style="margin:4px 0 8px">點按鈕加家人、勾同住／主要照顧者，圖會自動畫好；下次家訪自動沿用</div>
    <div class="grid geno-grid"><div id="genoEd"></div><div id="genoPv"></div></div><input type="hidden" name="genogram" id="genoData"></div>
  <div class="card"><h2>內容</h2>${S.HV_SECTIONS.map(([k, t]) => `<div class="hvsec" data-last="${h(last ? last.data[k] || '' : '')}"><label class="f" style="font-weight:700;color:var(--text)">${t} <span class="hvtag small"></span></label>
    <textarea name="${k}" style="min-height:${['economy', 'living', 'social'].includes(k) ? 70 : 110}px" placeholder="${k === 'update' ? '本次訪視的新狀況、處遇' : ''}">${h(d[k])}</textarea>
    ${k === 'economy' ? `<div class="tpl" data-for="economy" data-replace="1">${S.HV_ECONOMY.map(e => `<button type="button" class="tchip">${e}</button>`).join('')}</div>` : ''}</div>`).join('')}</div>
  <div class="card"><h2>參、問題分析</h2>${S.HV_PROBLEMS.map(([p, causes], i) => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0">
    <label class="pill"><input type="checkbox" name="problems" value="${h(p)}" ${(d.problems || []).includes(p) ? 'checked' : ''}><span>${h(p)}</span></label>
    <select name="cause_${i}"><option value="">（原因）</option>${causes.map(x => `<option ${d['cause_' + i] === x ? 'selected' : ''}>${h(x)}</option>`).join('')}</select></div>`).join('')}
    <input type="text" name="problem_other" value="${h(d.problem_other)}" placeholder="其他問題" style="width:100%;margin-top:6px"><div class="small muted" style="margin-top:6px">產生的文字：<span id="ptext"></span></div></div>
  <div class="card sum-box"><h2>肆、結論</h2><div class="fr"><div><label class="f">服務日</label>${pills('days', S.WEEKDAYS, d.days)}</div><div><label class="f">服務代碼</label>${pills('codes', S.SERVICE_CODES.map(x => x[0]), d.codes)}</div></div>
    <input type="text" name="concl_extra" value="${h(d.concl_extra)}" placeholder="其他結論" style="width:100%;margin-top:8px"><div class="btns" style="margin:10px 0 6px"><button type="button" class="btn sm acc" onclick="App.genConcl()">✨ 產生結論</button></div>
    <textarea name="conclusion" id="conclusion" style="min-height:80px">${h(d.conclusion)}</textarea><div class="btns" style="margin-top:12px"><button class="btn pri">💾 儲存家訪紀錄</button></div></div>`}</form>`);
};
const HV_LISTS = ['target', 'items', 'problems', 'days', 'codes'];
function hvRefresh() { const f = document.getElementById('f'); if (!f || f.dataset.kind !== 'hv') return; const d = recData(f, HV_LISTS);
  const p = document.getElementById('ptext'); if (p) p.textContent = hvProblems(d) || '（未勾選）';
  document.querySelectorAll('.hvsec').forEach(s => { const last = s.dataset.last, v = s.querySelector('textarea').value.trim(), tag = s.querySelector('.hvtag');
    if (!last) { tag.textContent = ''; s.classList.remove('chgd'); return; } const same = v === last.trim(); tag.textContent = same ? '（與上次相同）' : '（已更新）'; tag.style.color = same ? '#66756f' : '#b7791f'; s.classList.toggle('chgd', !same); }); }

/* ============================== 跨專業評估（115 年附件2-3 B1） ============================== */
const DISC_MOD = { nurse: { name: '護理', mods: ['HA'], add: c => `#/s/HA/new?client=${c}` }, social: { name: '社工', mods: ['HV'], add: c => `#/hv/new?client=${c}` },
  ot: { name: '職能治療', mods: ['D61', 'ICOPE'], add: c => `#/assess/ICOPE/new?client=${c}` }, diet: { name: '營養', mods: ['MNA'], add: c => `#/nutri/new?client=${c}` } };
function lastOf(cid, mods) {
  const ds = []; mods.forEach(m => { if (m === 'D61' || m === 'ICOPE') { const a = clientAssess(cid, [m, m + '_HIST'])[0]; if (a) ds.push(a.date); } else { const r = recs(m, cid)[0]; if (r) ds.push(r.date); } });
  return ds.sort().pop() || '';
}
function discStatus(cid) {
  const out = {}; const lim = addMonths(todayISO(), -(+setting('reeval_months') || 6));
  Object.entries(DISC_MOD).forEach(([k, v]) => { const d = lastOf(cid, v.mods); out[k] = { date: d, status: !d ? '未評估' : d < lim ? '逾期' : '正常' }; });
  return out;
}
const qStart = (iso0 = todayISO()) => { const d = toDate(iso0); return `${d.getFullYear()}-${pad(Math.floor(d.getMonth() / 3) * 3 + 1)}-01`; };
function ccThisQuarter(cid) { const q = qStart(); return recs('CC', cid).find(r => r.date >= q); }
function conferenceSummary(cid) {
  const c = client(cid); const o = [];
  const ha = recs('HA', cid)[0]; if (ha) o.push(`【護理】${roc(ha.date)}：疾病史 ${(ha.data.diseases || []).join('、') || '無'}${ha.data.disease_other ? '、' + ha.data.disease_other : ''}；${ha.data.regular_med || ''}；就醫：${ha.data.hospital || '—'}。`);
  const pres = recs('DAILY', cid).slice(0, 20).map(r => r.data).filter(r => !r.absent);
  if (pres.length) { const al = pres.filter(r => dailyAlerts(r).length).length; o.push(`【照顧服務】近 ${pres.length} 次出席：${al ? `${al} 次生命徵象或狀況異常` : '生命徵象穩定'}；活動多為${(() => { const c2 = {}; pres.forEach(r => { if (r.activity) c2[r.activity] = (c2[r.activity] || 0) + 1; }); return Object.entries(c2).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '—'; })()}。`); }
  const ic = clientAssess(cid, ['ICOPE'])[0]; const d61 = clientAssess(cid, ['D61'])[0];
  if (ic || d61) o.push(`【職能治療】${ic ? `${roc(ic.date)} 六力異常：${icopeAbn(ic.data).join('、') || '無'}${ic.data.mob_seconds ? `（起立坐下 ${ic.data.mob_seconds} 秒）` : ''}。` : ''}${d61 && d61.summary ? 'D61：' + d61.summary.slice(0, 80) + '…' : ''}`);
  const mna = recs('MNA', cid)[0]; if (mna) { const s = mnaScore(mna.data); o.push(`【營養】${roc(mna.date)}：BMI ${s.b ?? '—'}，篩檢 ${s.s} 分（${s.level}）。${mna.data.advice ? '建議：' + mna.data.advice : ''}`); }
  const hv = recs('HV', cid)[0]; if (hv) o.push(`【社工】${roc(hv.date)} 家訪：${hvProblems(hv.data) || '—'}。主要照顧者：${((hv.data.genogram || []).find(m => m.caregiver) || {}).name || hv.data.family_member || '—'}。`);
  const ea = recs('EA', cid)[0]; if (ea) o.push(`【適應】${roc(ea.date)}：${(ea.data.desc || '').slice(0, 60)}`);
  const ir = recs('IR', cid).filter(r => r.date >= addMonths(todayISO(), -3)); if (ir.length) o.push(`【異常事件】近 3 個月 ${ir.length} 件：${ir.map(r => (r.data.kind || []).join('、')).join('；')}。`);
  return o.join('\n') || '（此個案尚無各專業評估紀錄）';
}
function careNotes(d) { const L = (d.diseases || []).filter(x => S.DISEASE_CARE[x]).map(x => S.DISEASE_CARE[x]);
  if ((d.regular_med || '').startsWith('否')) L.push('服藥規律性不佳，與家屬討論服藥提醒方式。'); if (['否', '不定期'].includes(d.regular_visit)) L.push('鼓勵家屬安排定期回診追蹤慢性病。');
  return L.map((x, i) => `${i + 1}. ${x}`).join('\n') || '（請先勾選疾病史）'; }
const discCell = (cid, k, st) => `<a href="${DISC_MOD[k].add(cid)}" title="新增${DISC_MOD[k].name}評估">${st.date ? roc(st.date) : '—'}</a> ${badge(st.status)}`;
V.ia = (q) => {
  let cs = activeClients(); const all = cs.map(c => Object.assign(c, { ds: discStatus(c.id), cc: ccThisQuarter(c.id) }));
  const done3 = all.filter(c => Object.values(c.ds).filter(x => x.status === '正常').length >= 3).length; const ccN = all.filter(c => c.cc).length;
  if (q.f === 'due') cs = all.filter(c => Object.values(c.ds).some(x => x.status !== '正常')); else if (q.f === 'cc') cs = all.filter(c => !c.cc); else cs = all;
  return layout('ia', `<div class="pagehead"><div><h1>跨專業評估總表</h1><div class="muted">評鑑 B1：生理、心理認知、家庭社會支持評估；每 6 個月再評估；每季跨專業個案討論（≥3 專業）</div></div></div>
  <div class="grid g3"><div class="stat ${done3 === all.length ? 'ok' : 'warn'}"><span>近 6 個月有 ≥3 專業評估</span><b>${done3}/${all.length}</b></div>
    <div class="stat ${ccN === all.length ? 'ok' : 'bad'}"><span>本季已開個案討論</span><b>${ccN}/${all.length}</b><span class="small muted">每季每人至少 1 次</span></div>
    <a class="stat info" href="#/s/CC/new"><span>＋ 召開個案討論</span><b>📋</b><span class="small muted">自動彙整各專業最新評估</span></a></div>
  <div class="card btns" style="margin-top:12px">${[['', '全部'], ['due', '有專業逾期／未評估'], ['cc', '本季尚未討論']].map(([k, l]) => `<a class="btn sm ${(q.f || '') === k ? 'pri' : ''}" href="#/ia${k ? '?f=' + k : ''}">${l}</a>`).join('')}</div>
  <div class="tbl-wrap"><table class="t"><tr><th>個案</th><th>護理</th><th>社工</th><th>職能治療</th><th>營養</th><th>本季個案討論</th><th></th></tr>
  ${cs.map(c => `<tr><td class="ttl"><a href="#/ia/${c.id}"><b>${h(c.name)}</b></a> <span class="muted small">${h(c.case_no)}</span></td>
    ${['nurse', 'social', 'ot', 'diet'].map(k => `<td>${discCell(c.id, k, c.ds[k])}</td>`).join('')}
    <td>${c.cc ? `<a href="#/r/${c.cc.id}">${roc(c.cc.date)}</a> ${badge('已討論', 'ok')}` : badge('未討論', 'bad')}</td>
    <td class="btns wide"><a class="btn sm pri" href="#/ia/${c.id}">總覽</a><a class="btn sm" href="#/s/CC/new?client=${c.id}">個案討論</a></td></tr>`).join('')}</table></div>`);
};
V.iaClient = (cid) => {
  const c = client(cid); if (!c) return V.notFound(); const ds = discStatus(cid);
  const card = (k, title, body, links) => `<div class="card dom ${ds[k] ? ds[k].status : ''}"><div class="fr" style="justify-content:space-between;align-items:center"><h2 style="margin:0">${title}</h2>
    <div class="btns small">${ds[k] ? `最近 ${roc(ds[k].date) || '—'} ${badge(ds[k].status)}` : ''}</div></div><div style="margin-top:8px">${body}</div><div class="btns" style="margin-top:10px">${links}</div></div>`;
  const ha = recs('HA', cid)[0], hv = recs('HV', cid)[0], mna = recs('MNA', cid)[0], ic = clientAssess(cid, ['ICOPE'])[0], d61 = clientAssess(cid, ['D61'])[0], ea = recs('EA', cid)[0];
  const goals = DB.goals.filter(g => g.client_id === cid);
  return layout('ia', `<div class="pagehead"><div><h1>${h(c.name)}｜跨專業評估總覽</h1><div class="muted">${h(c.case_no)}・${h(c.gender)}・${c.age ?? '?'} 歲・<a href="#/clients/${cid}">個案資料</a></div></div><span class="sp"></span>
    <div class="btns"><a class="btn pri" href="#/s/CC/new?client=${cid}">＋ 召開個案討論</a></div></div>
  <div class="grid g2">
  ${card('nurse', '🩺 護理｜健康評估・慢性疾病', ha ? `<div>疾病史：<b>${h((ha.data.diseases || []).join('、') || '無')}</b>${ha.data.disease_other ? '、' + h(ha.data.disease_other) : ''}</div><div class="small">定期就醫：${h(ha.data.regular_visit) || '—'}｜${h(ha.data.hospital) || ''}｜服藥：${h(ha.data.regular_med) || '—'}｜體檢：${roc(ha.data.exam_date) || '未填'} X光 ${h(ha.data.xray) || '—'}</div>${ha.data.care_notes ? `<p class="small" style="white-space:pre-wrap;margin:6px 0 0">${h(ha.data.care_notes)}</p>` : ''}` : '<div class="muted">尚未評估</div>',
    `<a class="btn sm pri" href="#/s/HA/new?client=${cid}">＋ 健康評估</a>${ha ? `<a class="btn sm" href="#/r/${ha.id}">檢視</a>` : ''}`)}
  ${card('social', '🏠 社工｜家訪・家庭與社會支持', hv ? `<div class="small">${roc(hv.date)}：${h(hvProblems(hv.data) || hv.data.family || '') || '—'}</div>${(hv.data.genogram || []).length ? `<div style="margin-top:6px">${genoSVG(hv.data.genogram, c, 0.7)}</div>` : '<div class="small muted">尚未畫家系圖</div>'}` : '<div class="muted">尚未家訪</div>',
    `<a class="btn sm pri" href="#/hv/new?client=${cid}">＋ 家訪（沿用上次）</a>${hv ? `<a class="btn sm" href="#/r/${hv.id}">檢視</a>` : ''}`)}
  ${card('ot', '🧭 職能治療｜六力・D61', `${ic ? `<div>六力 ${roc(ic.date)}：異常 ${icopeAbn(ic.data).map(x => badge(x, '異常')).join(' ') || badge('皆正常', '正常')}</div>` : '<div class="muted">尚無六力</div>'}${d61 ? `<p class="small" style="margin:6px 0 0">D61 ${roc(d61.date)}：${h((d61.summary || '').slice(0, 90))}…</p>` : ''}`,
    `<a class="btn sm pri" href="#/assess/ICOPE/new?client=${cid}${ic ? '&from=last' : ''}">＋ 六力</a><a class="btn sm pri" href="#/assess/D61/new?client=${cid}${ic ? '&from=icope' : ''}">＋ D61</a>${ic ? `<a class="btn sm" href="#/a/${ic.id}">檢視</a>` : ''}`)}
  ${card('diet', '🥣 營養｜MNA・飲食建議（B12）', mna ? (() => { const s = mnaScore(mna.data); return `<div>BMI ${s.b ?? '—'}（${s.bl}）｜篩檢 ${s.s} 分 ${badge(s.level, /良好|正常/.test(s.level) ? 'ok' : 'bad')}</div><p class="small" style="margin:6px 0 0">${h(mna.data.advice || '')}</p>`; })() : '<div class="muted">尚未評估</div>',
    `<a class="btn sm pri" href="#/nutri/new?client=${cid}">＋ 營養評估</a>${mna ? `<a class="btn sm" href="#/r/${mna.id}">檢視</a>` : ''}`)}
  </div>
  <div class="card"><div class="fr" style="justify-content:space-between"><h2 style="margin:0">🤝 適應（B2）</h2><a class="btn sm" href="#/s/EA/new?client=${cid}">＋ 環境適應評估</a></div><p class="small" style="margin:6px 0 0">${ea ? roc(ea.date) + '：' + h(ea.data.desc || '') : '<span class="muted">新案收托初期請每日評估</span>'}</p></div>
  <div class="card"><div class="fr" style="justify-content:space-between"><h2 style="margin:0">📋 跨專業個案討論（每季）</h2><a class="btn sm pri" href="#/s/CC/new?client=${cid}">＋ 召開</a></div>
    ${recs('CC', cid).map(r => `<div style="border-top:1px dashed var(--line);padding:8px 0"><a href="#/r/${r.id}"><b>${roc(r.date)}</b></a> ${(r.data.professions || []).map(x => badge(x, 'info')).join(' ')} ${(r.data.professions || []).length < 3 ? badge('未達 3 專業', 'bad') : ''}<div class="small" style="white-space:pre-wrap">${h((r.data.decision || '').slice(0, 120))}</div></div>`).join('') || '<div class="muted small" style="margin-top:6px">尚無紀錄</div>'}</div>
  <div class="card"><div class="fr" style="justify-content:space-between"><h2 style="margin:0">🎯 照顧計畫／自立支援目標（B1、B10）</h2><a class="btn sm" href="#/clients/${cid}">管理目標</a></div>
    ${goals.map(g => `<div class="small" style="padding:4px 0">${badge(g.status, g.status === '達成' ? 'ok' : 'info')} 【${h(g.domain)}】${h(g.goal)}</div>`).join('') || '<div class="muted small" style="margin-top:6px">尚未建立目標；可在個案討論後依決議建立</div>'}</div>`);
};

/* ---------- 家系圖（護理師意見：要好用的） ---------- */
const GENO_REL = [['父', 'M', -1], ['母', 'F', -1], ['配偶（夫）', 'M', 0], ['配偶（妻）', 'F', 0], ['兄弟', 'M', 0], ['姊妹', 'F', 0], ['兒子', 'M', 1], ['女兒', 'F', 1],
  ['媳婦', 'F', 1], ['女婿', 'M', 1], ['孫子', 'M', 2], ['孫女', 'F', 2], ['外籍看護', 'F', 9]];
const relInfo = r => GENO_REL.find(x => x[0] === r) || [r, 'F', 9];
function genoLayout(members, c) {
  const S2 = 78, P = []; const me = { id: 'me', name: c.name, sex: c.gender === '男' ? 'M' : 'F', age: c.age, me: true, cohabit: true };
  const kids = members.filter(m => ['兒子', '女兒'].includes(m.rel)); const sp = members.find(m => m.rel.startsWith('配偶'));
  const units = kids.map(k => { const inlaw = members.find(m => ['媳婦', '女婿'].includes(m.rel) && m.of === k.id); const gk = members.filter(m => ['孫子', '孫女'].includes(m.rel) && m.of === k.id);
    return { k, inlaw, gk, w: Math.max(inlaw ? 2 : 1, gk.length || 1) }; });
  const totalW = units.reduce((a, u) => a + u.w, 0); const sib = members.filter(m => ['兄弟', '姊妹'].includes(m.rel));
  const cx = Math.max(totalW, 2 + sib.length * 2) * S2 / 2 + 60; const pos = {};
  pos.me = [sp ? cx - S2 / 2 : cx, 150]; if (sp) pos[sp.id] = [cx + S2 / 2, 150];
  sib.forEach((s, i) => { pos[s.id] = [pos.me[0] - S2 * (i + 1), 150]; });
  const fa = members.find(m => m.rel === '父'), mo = members.find(m => m.rel === '母'); const sibC = sib.length ? (pos.me[0] + pos[sib[sib.length - 1].id][0]) / 2 : pos.me[0];
  if (fa) pos[fa.id] = [sibC - S2 / 2, 40]; if (mo) pos[mo.id] = [sibC + S2 / 2, 40];
  let x = cx - totalW * S2 / 2 + S2 / 2;
  units.forEach(u => { const ux = x + (u.w - 1) * S2 / 2 - (u.inlaw ? S2 / 2 : 0); pos[u.k.id] = [Math.max(x, ux), 270]; if (u.inlaw) pos[u.inlaw.id] = [pos[u.k.id][0] + S2, 270];
    const mid = u.inlaw ? pos[u.k.id][0] + S2 / 2 : pos[u.k.id][0]; u.gk.forEach((g, i) => { pos[g.id] = [mid + (i - (u.gk.length - 1) / 2) * S2, 390]; }); x += u.w * S2; });
  const others = members.filter(m => !pos[m.id]); others.forEach((m, i) => { pos[m.id] = [cx + (sp ? S2 * 1.5 : S2) + 40 + i * S2, 150]; });
  return { me, pos, kids, sp, sib, fa, mo, units, others, width: Math.max(cx * 2, 380, ...Object.values(pos).map(p => p[0] + 60)), height: members.some(m => ['孫子', '孫女'].includes(m.rel)) ? 480 : kids.length ? 360 : 240 };
}
function genoSVG(members, c, scale = 1) {
  members = members || []; const L = genoLayout(members, c); const all = [L.me, ...members]; const R = 18; let s = '';
  const line = (x1, y1, x2, y2, dash) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#333" stroke-width="1.5" ${dash ? 'stroke-dasharray="4 3"' : ''}/>`;
  const couple = (a, b) => { if (!a || !b) return null; const p1 = L.pos[a.id], p2 = L.pos[b.id]; const [l, r] = p1[0] < p2[0] ? [p1, p2] : [p2, p1];
    s += line(l[0] + R, l[1], r[0] - R, r[1]); return [(p1[0] + p2[0]) / 2, p1[1]]; };
  const kidsLine = (from, kids) => { if (!from || !kids.length) return; const xs = kids.map(k => L.pos[k.id][0]); const y = L.pos[kids[0].id][1] - R - 18;
    s += line(from[0], from[1], from[0], y) + line(Math.min(from[0], ...xs), y, Math.max(from[0], ...xs), y); kids.forEach(k => { s += line(L.pos[k.id][0], y, L.pos[k.id][0], L.pos[k.id][1] - R); }); };
  const par = couple(L.fa, L.mo) || (L.fa || L.mo ? [L.pos[(L.fa || L.mo).id][0], L.pos[(L.fa || L.mo).id][1] + R] : null); kidsLine(par, [L.me, ...L.sib]);
  const cp = L.sp ? couple(L.me, L.sp) : [L.pos.me[0], L.pos.me[1] + R]; kidsLine(cp, L.kids);
  L.units.forEach(u => { const up = u.inlaw ? couple(u.k, u.inlaw) : [L.pos[u.k.id][0], L.pos[u.k.id][1] + R]; kidsLine(up, u.gk); });
  all.forEach(m => { const [x, y] = L.pos[m.id]; const sex = m.me ? m.sex : (m.sex || relInfo(m.rel)[1]); const fill = m.cohabit ? '#dff1e8' : '#fff'; const stroke = m.caregiver ? '#e8893a' : '#333'; const sw = m.caregiver ? 3.5 : 1.6;
    s += sex === 'M' ? `<rect x="${x - R}" y="${y - R}" width="${R * 2}" height="${R * 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>` + (m.me ? `<rect x="${x - R + 4}" y="${y - R + 4}" width="${R * 2 - 8}" height="${R * 2 - 8}" fill="none" stroke="#333"/>` : '')
      : `<circle cx="${x}" cy="${y}" r="${R}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>` + (m.me ? `<circle cx="${x}" cy="${y}" r="${R - 5}" fill="none" stroke="#333"/>` : '');
    if (m.deceased) s += line(x - R, y - R, x + R, y + R) + line(x + R, y - R, x - R, y + R);
    if (m.caregiver) s += `<text x="${x + R + 2}" y="${y - R + 6}" font-size="11" fill="#e8893a" font-weight="700">主</text>`;
    s += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="11" fill="#333">${m.age ? h(m.age) : ''}</text><text x="${x}" y="${y + R + 15}" text-anchor="middle" font-size="12" font-weight="${m.me ? 700 : 400}">${h(m.me ? m.name : (m.name || m.rel))}</text>
      ${m.me ? '' : `<text x="${x}" y="${y + R + 29}" text-anchor="middle" font-size="10" fill="#777">${h(m.rel)}</text>`}`; });
  const leg = `<g font-size="11" fill="#555"><rect x="10" y="${L.height - 22}" width="12" height="12" fill="#dff1e8" stroke="#333"/><text x="26" y="${L.height - 12}">同住</text>
    <rect x="66" y="${L.height - 22}" width="12" height="12" fill="#fff" stroke="#e8893a" stroke-width="3"/><text x="82" y="${L.height - 12}">主要照顧者</text>
    <line x1="160" y1="${L.height - 22}" x2="172" y2="${L.height - 10}" stroke="#333"/><line x1="172" y1="${L.height - 22}" x2="160" y2="${L.height - 10}" stroke="#333"/><text x="178" y="${L.height - 12}">歿</text>
    <text x="206" y="${L.height - 12}">□男 ○女 雙框＝個案</text></g>`;
  return `<svg viewBox="0 0 ${L.width} ${L.height}" style="width:100%;max-width:${L.width * scale}px;background:#fff;border:1px solid var(--line);border-radius:8px" xmlns="http://www.w3.org/2000/svg">${s}${leg}</svg>`;
}
let GENO = [];
function genoEditor() {
  const kids = GENO.filter(m => ['兒子', '女兒'].includes(m.rel));
  return `<div class="pills" style="margin-bottom:8px">${GENO_REL.map(([r]) => `<button type="button" class="btn sm" onclick="App.genoAdd('${r}')">＋${r}</button>`).join('')}</div>
    ${GENO.map(m => `<div class="geno-row">
      <b style="width:64px">${h(m.rel)}</b><input type="text" placeholder="姓名" value="${h(m.name)}" oninput="App.genoSet('${m.id}','name',this.value)" style="width:110px">
      <input type="text" placeholder="年齡" value="${h(m.age)}" oninput="App.genoSet('${m.id}','age',this.value)" style="width:56px">
      ${['媳婦', '女婿', '孫子', '孫女'].includes(m.rel) ? `<select onchange="App.genoSet('${m.id}','of',this.value)"><option value="">（屬於哪位子女）</option>${kids.map(k => `<option value="${k.id}" ${m.of === k.id ? 'selected' : ''}>${h(k.name || k.rel)}</option>`).join('')}</select>` : ''}
      <label class="small"><input type="checkbox" ${m.cohabit ? 'checked' : ''} onchange="App.genoSet('${m.id}','cohabit',this.checked)"> 同住</label>
      <label class="small"><input type="checkbox" ${m.caregiver ? 'checked' : ''} onchange="App.genoSet('${m.id}','caregiver',this.checked)"> 主要照顧者</label>
      <label class="small"><input type="checkbox" ${m.deceased ? 'checked' : ''} onchange="App.genoSet('${m.id}','deceased',this.checked)"> 歿</label>
      <button type="button" class="btn sm danger" onclick="App.genoDel('${m.id}')">✕</button></div>`).join('') || '<div class="muted small">點上方按鈕新增家人，圖會自動畫好</div>'}`;
}
function genoRefresh() { const ed = document.getElementById('genoEd'), pv = document.getElementById('genoPv'), inp = document.getElementById('genoData'); if (!ed) return;
  const c = client(+document.getElementById('f').client_id.value) || { name: '個案' }; ed.innerHTML = genoEditor(); pv.innerHTML = genoSVG(GENO, c); inp.value = JSON.stringify(GENO); }
function genoFamilyText() { const cg = GENO.find(m => m.caregiver); const co = GENO.filter(m => m.cohabit && !m.deceased);
  return `${co.length ? '與' + co.map(m => m.rel + (m.name ? m.name : '')).join('、') + '同住' : '獨居或未填同住者'}；主要照顧者為${cg ? cg.rel + (cg.name || '') + (cg.age ? `（${cg.age}歲）` : '') : '—'}。` +
    (GENO.filter(m => ['兒子', '女兒'].includes(m.rel)).length ? `育有${GENO.filter(m => m.rel === '兒子').length}子${GENO.filter(m => m.rel === '女兒').length}女。` : ''); }

/* ---------- 出勤統計（護理師意見：統計＋匯出） ---------- */
function attendData(ym) {
  const days = [...new Set(DB.records.filter(r => r.module === 'DAILY' && r.date.startsWith(ym)).map(r => r.date))].sort();
  const rows = activeClients().map(c => { const m = {}; DB.records.filter(r => r.module === 'DAILY' && r.client_id === c.id && r.date.startsWith(ym)).forEach(r => { m[r.date] = r.data.absent ? '假' : '✓'; });
    const p = Object.values(m).filter(v => v === '✓').length, a = Object.values(m).filter(v => v === '假').length; return { c, m, p, a }; });
  return { days, rows };
}
V.attendance = (q) => {
  const ym = q.m || todayISO().slice(0, 7); const { days, rows } = attendData(ym); const tot = rows.reduce((a, r) => a + r.p, 0);
  return layout('att', `<div class="pagehead"><div><h1>出勤統計</h1><div class="muted">由「今日照顧紀錄」的「到中心」自動統計；可匯出 Excel</div></div><span class="sp"></span>
    <div class="btns"><input type="month" value="${ym}" onchange="App.go('/attendance?m='+this.value)"><button class="btn pri" onclick="App.attendXlsx('${ym}')">⬇ 匯出 Excel</button></div></div>
  <div class="grid g3"><div class="stat"><span>本月開放日數</span><b>${days.length}</b></div><div class="stat ok"><span>總出席人次</span><b>${tot}</b></div><div class="stat info"><span>平均每日出席</span><b>${days.length ? Math.round(tot / days.length * 10) / 10 : 0}</b></div></div>
  <div class="card" style="margin-top:12px;padding:0;overflow:auto"><table class="t trend" style="font-size:13px"><tr><th>個案</th><th>出席</th><th>請假</th>${days.map(d => `<th class="c">${+d.slice(8)}</th>`).join('')}</tr>
    ${rows.map(r => `<tr><td><a href="#/clients/${r.c.id}">${h(r.c.name)}</a></td><td class="c"><b>${r.p}</b></td><td class="c">${r.a || ''}</td>${days.map(d => `<td class="c" style="${r.m[d] === '假' ? 'color:#b7791f' : ''}">${r.m[d] || ''}</td>`).join('')}</tr>`).join('')}</table></div>
  ${!days.length ? '<div class="card empty">這個月還沒有今日照顧紀錄</div>' : ''}`);
};

/* ---------- 活動紀錄（B7；表單為草案，待討論） ---------- */
V.acts = (q) => {
  DB.acts = DB.acts || []; const ym = q.m || todayISO().slice(0, 7); const rows = DB.acts.filter(a => a.date.startsWith(ym)).sort((a, b) => b.date.localeCompare(a.date));
  const comm = rows.filter(a => a.type === '社區活動').length;
  return layout('acts', `<div class="pagehead"><div><h1>活動紀錄 <span class="b warn">草案・待討論</span></h1><div class="muted">評鑑 B7：個別、團體、社區活動（社區活動每月至少 1 次）；B8 照顧者支持活動每年至少 1 次</div></div><span class="sp"></span>
    <div class="btns"><input type="month" value="${ym}" onchange="App.go('/acts?m='+this.value)"><a class="btn pri" href="#/acts/new">＋ 新增活動</a></div></div>
  <div class="grid g3"><div class="stat"><span>本月活動</span><b>${rows.length}</b></div><div class="stat ${comm ? 'ok' : 'bad'}"><span>本月社區活動（B7 ≥1）</span><b>${comm}</b></div>
    <div class="stat ${DB.acts.some(a => a.type === '照顧者支持活動' && a.date.slice(0, 4) === todayISO().slice(0, 4)) ? 'ok' : 'warn'}"><span>今年照顧者支持活動（B8 ≥1）</span><b>${DB.acts.filter(a => a.type === '照顧者支持活動' && a.date.slice(0, 4) === todayISO().slice(0, 4)).length}</b></div></div>
  <div class="tbl-wrap" style="margin-top:12px"><table class="t"><tr><th>日期</th><th>活動</th><th>類型</th><th>類別</th><th>帶領</th><th>參與</th><th></th></tr>
  ${rows.map(a => `<tr><td>${roc(a.date)}</td><td class="ttl"><b>${h(a.title)}</b></td><td>${h(a.type)}</td><td>${h((a.cats || []).join('、'))}</td><td>${h(a.leader)}</td><td>${Object.values(a.part || {}).filter(v => v !== '未參與').length} 人</td>
    <td class="btns wide"><a class="btn sm" href="#/acts/${a.id}">編輯</a></td></tr>`).join('') || '<tr><td colspan="7" class="empty">這個月還沒有活動紀錄</td></tr>'}</table></div>`);
};
V.actForm = (id, q = {}) => {
  DB.acts = DB.acts || []; const a = id ? DB.acts.find(x => x.id === +id) : { date: iso(q.date) || todayISO(), type: '團體活動', cats: [], part: {} }; if (!a) return V.notFound();
  const present = new Set(DB.records.filter(r => r.module === 'DAILY' && r.date === a.date && !r.data.absent).map(r => r.client_id));
  return layout('acts', `<div class="pagehead"><div><h1>活動紀錄 <span class="b warn">草案</span></h1><div class="muted">參與者預設帶入當天有到中心的長輩；可逐一標示參與程度</div></div></div>
  <form id="af" onsubmit="return App.saveAct(event,${id || 0})"><div class="card"><div class="grid g3">
    <div><label class="f">日期</label><input type="date" name="date" value="${a.date}" required onchange="App.actDate(this.value,${id || 0})"></div>
    <div><label class="f">時間</label><input type="time" name="time" value="${h(a.time)}"></div><div><label class="f">帶領人</label><input type="text" name="leader" value="${h(a.leader)}" style="width:100%"></div></div>
    <label class="f" style="margin-top:8px">活動名稱</label><input type="text" name="title" value="${h(a.title)}" required style="width:100%" placeholder="例：手作書籤、坐式體操、社區市場採買">
    <div class="fld wide"><div class="lb">類型</div><div class="pills">${S.ACT_TYPES.map(t => `<label class="pill"><input type="radio" name="type" value="${t}" ${a.type === t ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
    <div class="fld wide"><div class="lb">類別</div><div class="pills">${S.ACT_CATS.map(t => `<label class="pill"><input type="checkbox" name="cats" value="${t}" ${(a.cats || []).includes(t) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
    <label class="f">活動內容／鼓勵參與策略</label><textarea name="content">${h(a.content)}</textarea></div>
  <div class="card"><h2>參與者</h2><div class="small muted" style="margin-bottom:6px">「主動參與／引導後參與」也會成為 B10 自我照顧與 D61 活動參與的佐證</div>
    ${activeClients().map(c => { const v = (a.part || {})[c.id] || (id ? '' : (present.has(c.id) ? '主動參與' : '')); return `<div class="geno-row"><b style="width:96px">${h(c.name)}</b>
      <select name="p_${c.id}"><option value="">（未到）</option>${S.ACT_LEVELS.map(l => `<option ${v === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`; }).join('')}</div>
  <div class="btns" style="margin-bottom:60px"><button class="btn pri">💾 儲存</button>${id ? `<button type="button" class="btn danger" onclick="App.delAct(${id})">刪除</button>` : ''}</div></form>`);
};

/* ---------- 教育訓練與資料庫（B11、A10；護理師意見：個人登打＋分類資料庫） ---------- */
const me = () => setting('me_name') || '示範治療師';
V.training = (q) => {
  DB.trainings = DB.trainings || []; const yr = q.y || todayISO().slice(0, 4); const mine = DB.trainings.filter(t => t.staff === me() && t.date.startsWith(yr)).sort((a, b) => b.date.localeCompare(a.date));
  const hrs = mine.reduce((s, t) => s + (parseFloat(t.hours) || 0), 0); const cpr = DB.trainings.filter(t => t.staff === me() && t.cpr_exp).map(t => t.cpr_exp).sort().pop();
  const staff = [...new Set(DB.trainings.map(t => t.staff))];
  return layout('train', `<div class="pagehead"><div><h1>我的教育訓練</h1><div class="muted">只顯示與登打「${h(me())}」本人的紀錄（B11：每年繼續教育 ≥20 小時、CPR 證明在有效期內）</div></div><span class="sp"></span>
    <div class="btns"><select onchange="App.go('/training?y='+this.value)">${[0, 1, 2].map(i => String(+todayISO().slice(0, 4) - i)).map(y => `<option ${y === yr ? 'selected' : ''}>${y}</option>`).join('')}</select><a class="btn pri" href="#/training/new">＋ 新增</a></div></div>
  <div class="grid g3"><div class="stat ${hrs >= 20 ? 'ok' : 'warn'}"><span>${+yr - 1911} 年累計時數</span><b>${hrs}</b><span class="small muted">目標 20 小時</span><div class="bar"><i style="width:${Math.min(100, hrs * 5)}%"></i></div></div>
    <div class="stat ${cpr && cpr >= todayISO() ? 'ok' : 'bad'}"><span>CPR／BLS 有效期限</span><b style="font-size:20px">${cpr ? roc(cpr) : '未登錄'}</b>${cpr && cpr < todayISO() ? '<span class="small">已過期</span>' : ''}</div>
    <div class="stat"><span>感控時數（需 ≥4）</span><b>${mine.filter(t => t.cat === '感染控制').reduce((s, t) => s + (parseFloat(t.hours) || 0), 0)}</b></div></div>
  <div class="tbl-wrap" style="margin-top:12px"><table class="t"><tr><th>日期</th><th>課程</th><th>類別</th><th>時數</th><th>主辦單位</th><th>積分認證</th><th></th></tr>
    ${mine.map(t => `<tr><td>${roc(t.date)}</td><td class="ttl">${h(t.course)}</td><td>${h(t.cat)}</td><td>${h(t.hours)}</td><td>${h(t.org)}</td><td>${h(t.credit)}</td><td class="btns wide"><a class="btn sm" href="#/training/${t.id}">編輯</a></td></tr>`).join('') || '<tr><td colspan="7" class="empty">今年還沒有紀錄</td></tr>'}</table></div>
  ${setting('role') !== 'staff' && staff.length ? `<div class="card" style="margin-top:12px"><h2>全體時數（主管檢視）</h2><table class="t"><tr><th>人員</th><th>${+yr - 1911} 年時數</th><th>達標</th></tr>
    ${staff.map(s => { const hh = DB.trainings.filter(t => t.staff === s && t.date.startsWith(yr)).reduce((a, t) => a + (parseFloat(t.hours) || 0), 0); return `<tr><td class="ttl">${h(s)}</td><td>${hh}</td><td>${badge(hh >= 20 ? '達標' : '未達標', hh >= 20 ? 'ok' : 'warn')}</td></tr>`; }).join('')}</table></div>` : ''}`);
};
V.trainForm = (id) => {
  DB.trainings = DB.trainings || []; const t = id ? DB.trainings.find(x => x.id === +id) : { date: todayISO(), credit: '是' }; if (!t || (id && t.staff !== me())) return layout('train', '<div class="card empty">只能編輯自己的教育訓練紀錄</div>');
  return layout('train', `<div class="pagehead"><h1>${id ? '編輯' : '新增'}教育訓練（${h(me())}）</h1></div><form class="card" onsubmit="return App.saveTrain(event,${id || 0})"><div class="grid g3">
    <div><label class="f">日期</label><input type="date" name="date" value="${t.date}" required></div><div><label class="f">時數</label><input type="number" step="0.5" name="hours" value="${h(t.hours)}" required></div>
    <div><label class="f">類別</label><select name="cat">${opt(S.TRAIN_CATS, t.cat)}</select></div></div>
    <label class="f" style="margin-top:8px">課程名稱</label><input type="text" name="course" value="${h(t.course)}" required style="width:100%">
    <div class="grid g3" style="margin-top:8px"><div><label class="f">主辦單位</label><input type="text" name="org" value="${h(t.org)}" style="width:100%"></div>
      <div><label class="f">長照積分認證</label><select name="credit">${opt(['是', '否'], t.credit)}</select></div><div><label class="f">CPR／BLS 有效期限（如為急救課程）</label><input type="date" name="cpr_exp" value="${h(t.cpr_exp)}"></div></div>
    <label class="f" style="margin-top:8px">心得／備註</label><textarea name="note">${h(t.note)}</textarea>
    <div class="btns" style="margin-top:12px"><button class="btn pri">💾 儲存</button>${id ? `<button type="button" class="btn danger" onclick="App.delTrain(${id})">刪除</button>` : ''}</div></form>`);
};
V.library = (q) => {
  DB.library = DB.library || []; const cat = q.c || ''; const kw = q.q || ''; const rows = DB.library.filter(x => (!cat || x.cat === cat) && (!kw || (x.title + x.note).includes(kw)));
  return layout('lib', `<div class="pagehead"><div><h1>資料庫</h1><div class="muted">教材、衛教單張、操作影片連結，依主題分類</div></div><span class="sp"></span><a class="btn pri" href="#" onclick="document.getElementById('libAdd').open=true;return false">＋ 新增資料</a></div>
  <div class="card btns"><a class="btn sm ${!cat ? 'pri' : ''}" href="#/library">全部</a>${S.LIB_CATS.map(c => `<a class="btn sm ${cat === c ? 'pri' : ''}" href="#/library?c=${encodeURIComponent(c)}">${c}（${DB.library.filter(x => x.cat === c).length}）</a>`).join('')}</div>
  <details class="card box" id="libAdd"><summary>＋ 新增資料</summary><form class="fr" style="margin-top:8px" onsubmit="return App.saveLib(event)">
    <div><label class="f">分類</label><select name="cat">${opt(S.LIB_CATS, cat || S.LIB_CATS[0])}</select></div><div style="flex:2 1 220px"><label class="f">標題</label><input type="text" name="title" required></div>
    <div style="flex:2 1 220px"><label class="f">連結（網址）</label><input type="url" name="url" placeholder="https://"></div><div style="flex:3 1 260px"><label class="f">說明</label><input type="text" name="note"></div><div class="btns"><button class="btn pri">新增</button></div></form></details>
  <div class="tbl-wrap"><table class="t"><tr><th>分類</th><th>標題</th><th>說明</th><th>新增者</th><th></th></tr>
    ${rows.map(x => `<tr><td>${badge(x.cat, 'info')}</td><td class="ttl">${x.url ? `<a href="${h(x.url)}" target="_blank" rel="noopener">${h(x.title)} ↗</a>` : h(x.title)}</td><td class="small wide">${h(x.note)}</td><td>${h(x.by)}</td>
      <td class="btns wide">${x.by === me() ? `<button class="btn sm danger" onclick="App.delLib(${x.id})">刪除</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">還沒有資料，按「新增資料」開始建立</td></tr>'}</table></div>`);
};

/* ---------- 評鑑指標對照（115 年附件2-3） ---------- */
function indicatorRows() {
  const cs = activeClients(); const n = cs.length || 1; const t = todayISO(); const ym = t.slice(0, 7); const yr = t.slice(0, 4);
  const ds = cs.map(c => discStatus(c.id)); const b1a = ds.filter(d => Object.values(d).filter(x => x.status === '正常').length >= 3).length; const b1b = cs.filter(c => ccThisQuarter(c.id)).length;
  const last30 = DB.records.filter(r => r.module === 'DAILY' && r.date >= addDays(t, -30) && !r.data.absent); const temp = last30.filter(r => r.data.temp).length;
  const ha = cs.filter(c => { const r = recs('HA', c.id)[0]; return r && r.data.exam_date && r.data.xray && r.data.xray !== '未提供'; }).length;
  const ir = DB.records.filter(r => r.module === 'IR' && r.date.startsWith(yr)); const sent = ir.filter(r => r.data.sent && r.data.sent !== '否');
  const acts = (DB.acts || []).filter(a => a.date.startsWith(ym)); const comm = acts.filter(a => a.type === '社區活動').length; const sup = (DB.acts || []).filter(a => a.type === '照顧者支持活動' && a.date.startsWith(yr)).length;
  const pc3 = cs.filter(c => recs('PC', c.id).some(r => r.date >= addMonths(t, -3))).length;
  const aids = DB.aids.filter(a => a.status === '使用中' && cs.some(c => c.id === a.client_id)); const aidOk = aids.filter(a => a.start_date && a.fit_date && a.train_date).length;
  const goals = cs.filter(c => DB.goals.some(g => g.client_id === c.id && g.status === '進行中')).length;
  const staff = [...new Set((DB.trainings || []).map(x => x.staff))]; const st20 = staff.filter(s => (DB.trainings || []).filter(x => x.staff === s && x.date.startsWith(yr)).reduce((a, x) => a + (+x.hours || 0), 0) >= 20).length;
  const mna = cs.filter(c => { const r = recs('MNA', c.id)[0]; return r && r.data.texture; }).length;
  const newc = cs.filter(c => { const f = DB.records.filter(r => r.client_id === c.id && r.module === 'DAILY').map(r => r.date).sort()[0]; return f && f >= addMonths(t, -3); });
  const ea = newc.filter(c => recs('EA', c.id).length).length;
  const P = (a, b) => b ? Math.round(a * 100 / b) : 0; const st = p => p >= 90 ? 'ok' : p >= 60 ? 'warn' : 'bad';
  return [
    ['B1', '服務計畫及跨專業服務', `近 6 個月 ≥3 專業評估 ${b1a}/${cs.length}；本季個案討論 ${b1b}/${cs.length}`, st(Math.min(P(b1a, n), P(b1b, n))), '#/ia'],
    ['B2', '適應輔導或支持措施', `近 3 個月新案 ${newc.length} 位，已做環境適應評估 ${ea} 位`, newc.length ? st(P(ea, newc.length)) : 'ok', '#/rec/EA'],
    ['B3', '感染預防（體溫每日量測）', `近 30 天出席 ${last30.length} 人次，有量體溫 ${temp}（${P(temp, last30.length)}%）`, st(P(temp, last30.length)), '#/daily'],
    ['B4', '健康檢查及健康管理', `有入托體檢與胸部 X 光紀錄 ${ha}/${cs.length}`, st(P(ha, n)), '#/rec/HA'],
    ['B5', '意外／緊急事件處理', `${+yr - 1911} 年異常事件 ${ir.length} 件（需年度分析檢討）`, ir.length ? 'warn' : 'ok', '#/rec/IR'],
    ['B6', '緊急送醫服務', `${+yr - 1911} 年送醫 ${sent.length} 件，已記錄家屬聯繫時間 ${sent.filter(r => r.data.family_time).length} 件`, sent.length && sent.some(r => !r.data.family_time) ? 'warn' : 'ok', '#/rec/IR'],
    ['B7', '服務對象參與活動', `本月活動 ${acts.length} 場，社區活動 ${comm} 場（需 ≥1）`, comm ? 'ok' : 'bad', '#/acts'],
    ['B8', '照顧者支持性服務', `近 3 個月有主動聯繫家屬 ${pc3}/${cs.length}；今年照顧者支持活動 ${sup} 場（需 ≥1）`, sup && P(pc3, n) >= 60 ? 'ok' : 'warn', '#/rec/PC'],
    ['B9', '生活輔助（輔具）', `使用中輔具佐證完整 ${aidOk}/${aids.length}`, st(P(aidOk, aids.length || 1)), '#/aids'],
    ['B10', '維持自我照顧能力', `有進行中自立支援目標 ${goals}/${cs.length}`, st(P(goals, n)), '#/goals'],
    ['B11', '長照人員專業知能', `已登錄 ${staff.length} 人，年度 ≥20 小時 ${st20} 人`, staff.length && st20 === staff.length ? 'ok' : 'warn', '#/training'],
    ['B12', '營養餐點服務', `有營養評估與飲食質地建議 ${mna}/${cs.length}`, st(P(mna, n)), '#/rec/MNA'],
    ['A10', '新進人員職前訓練', '新進 3 個月內完成 16 小時（類別選「職前訓練」）', 'warn', '#/training'],
  ];
}

/* ============================== 列印版面（預覽、PDF、Word 共用） ============================== */
let PRINT_CSS = '';
fetch('print.css?v=5').then(r => r.text()).then(t => { PRINT_CSS = t; }).catch(() => {});
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
  saveDaily(e, day) { e.preventDefault(); let n = 0;
    activeClients().forEach(c => { const p = `c${c.id}_`; const f = e.target; const get = k => ((f.elements[p + k] || {}).value || '').trim();
      let d; if (!(f.elements[p + 'present'] || {}).checked) d = { absent: '1', note: get('note') }; else { d = {}; S.DAILY_FIELDS.forEach(([k]) => { const v = get(k); if (v) d[k] = v; }); }
      Object.keys(d).forEach(k => { if (!d[k]) delete d[k]; });
      const ex = DB.records.find(r => r.module === 'DAILY' && r.client_id === c.id && r.date === day); saveRec('DAILY', ex ? ex.id : 0, c.id, day, d); n++; });
    flash(`${roc(day)} 照顧紀錄已儲存（${n} 人）`); route(); return false; },
  dailyFilter(on) { document.querySelectorAll('.daily').forEach(c => { c.style.display = on && !c.dataset.flag ? 'none' : ''; }); },
  saveMNA(e, id) { e.preventDefault(); const f = e.target; const cid = +f.client_id.value; if (!cid) { alert('請選擇個案'); return false; }
    id = saveRec('MNA', id, cid, iso(f.date.value), recData(f, ['K'])); flash('營養評估已儲存'); return App.go('/r/' + id); },
  genAdvice() { const t = document.getElementById('advice'); if (t.value.trim() && !confirm('取代目前文字？')) return; t.value = mnaAdvice(recData(document.getElementById('f'), ['K'])); dirty = true; },
  saveHV(e, id) { e.preventDefault(); const f = e.target; const cid = +f.client_id.value; if (!cid) { alert('請選擇個案'); return false; }
    const d = recData(f, HV_LISTS); try { d.genogram = JSON.parse(d.genogram || '[]'); } catch (err) { d.genogram = []; }
    id = saveRec('HV', id, cid, iso(f.date.value), d); flash('家訪紀錄已儲存'); return App.go('/r/' + id); },
  genoAdd(rel) { const info = relInfo(rel); GENO.push({ id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), rel, sex: info[1], name: '', age: '', cohabit: false, caregiver: false, deceased: false,
      of: ['媳婦', '女婿', '孫子', '孫女'].includes(rel) ? ((GENO.filter(m => (rel === '媳婦' ? ['兒子'] : rel === '女婿' ? ['女兒'] : ['兒子', '女兒']).includes(m.rel)).slice(-1)[0]) || {}).id || '' : '' }); dirty = true; genoRefresh(); },
  genoSet(id, k, v) { const m = GENO.find(x => x.id === id); if (!m) return; m[k] = v; if (k === 'caregiver' && v) GENO.forEach(x => { if (x.id !== id) x.caregiver = false; }); dirty = true;
    if (k === 'name' || k === 'age') { document.getElementById('genoPv').innerHTML = genoSVG(GENO, client(+document.getElementById('f').client_id.value)); document.getElementById('genoData').value = JSON.stringify(GENO); } else genoRefresh(); },
  genoDel(id) { GENO = GENO.filter(x => x.id !== id && x.of !== id); dirty = true; genoRefresh(); },
  genoToText() { const t = document.querySelector('[name=family]'); if (!t) return; const add = genoFamilyText(); t.value = t.value.trim() ? t.value.trim() + '\n' + add : add; dirty = true; hvRefresh(); },
  genoPrint() { const c = client(+document.getElementById('f').client_id.value); const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>家系圖</title><body style="font-family:sans-serif;padding:20px"><h2>${h(setting('center_name'))}｜${h(c.name)} 家系圖</h2>${genoSVG(GENO, c)}<p>${h(genoFamilyText())}</p><script>print()<\/script></body>`); w.document.close(); },
  genConcl() { const t = document.getElementById('conclusion'); if (t.value.trim() && !confirm('取代目前的結論？')) return; t.value = hvConclusion(recData(document.getElementById('f'), HV_LISTS)); dirty = true; },
  saveSimple(e, mod, id, batch) { e.preventDefault(); const f = e.target; const lists = S.SIMPLE[mod].fields.filter(x => x.type === 'multi').map(x => x.key);
    const d = recData(f, lists.concat(['clients'])); const date = iso(f.date.value);
    if (batch) { const ids = d.clients || []; delete d.clients; Object.keys(d).filter(k => k.startsWith('family_')).forEach(k => delete d[k]);
      if (!ids.length) { alert('請勾選通知對象'); return false; }
      ids.forEach(cid => { const x = Object.assign({}, d); const fam = (f.elements['family_' + cid] || {}).value; if (fam) x.family = fam; saveRec('PC', 0, cid, date, x); });
      flash(`已建立 ${ids.length} 筆電訪紀錄`); return App.go('/rec/PC'); }
    const cid = +f.client_id.value; if (!cid) { alert('請選擇個案'); return false; }
    if (mod === 'CC' && (d.professions || []).length < 3 && !confirm('評鑑 B1 要求至少 3 種專業參與，目前只有 ' + (d.professions || []).length + ' 種，仍要儲存？')) return false;
    id = saveRec(mod, id, cid, date, d); flash(S.SIMPLE[mod].title + '已儲存'); return App.go('/r/' + id); },
  autoGen(k, kind) { const f = document.getElementById('f'); const cid = +f.client_id.value; const t = document.getElementById('ta_' + k); if (!cid) return;
    if (t.value.trim() && !confirm('用自動產生的內容取代？')) return; t.value = kind === 'month_summary' ? monthSummary(cid, (f.elements.month || {}).value || todayISO().slice(0, 7)) : kind === 'adapt_summary' ? adaptSummary(recData(f, []), cid) : kind === 'care_notes' ? careNotes(recData(f, ['diseases'])) : kind === 'conference_summary' ? conferenceSummary(cid) : closureStats(cid); dirty = true; },
  attendXlsx(ym) { loadScript(XLSX_URL).then(() => { const { days, rows } = attendData(ym); const XL = window.XLSX; const wb = XL.utils.book_new();
      const aoa = [['個案', '案號', '出席', '請假', ...days.map(d => roc(d))]].concat(rows.map(r => [r.c.name, r.c.case_no, r.p, r.a, ...days.map(d => r.m[d] || '')]));
      aoa.push([]); aoa.push(['開放日數', days.length, '總出席人次', rows.reduce((a, r) => a + r.p, 0)]); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet(aoa), '出勤統計');
      XL.writeFile(wb, `出勤統計_${roc(ym + '-01', '').slice(0, 5)}.xlsx`); }).catch(e => alert(e.message)); },
  actDate(d, id) { if (!id) { App.go('/acts/new?date=' + d); } },
  saveAct(e, id) { e.preventDefault(); DB.acts = DB.acts || []; const f = e.target; const fd = new FormData(f); const a = { date: fd.get('date'), time: fd.get('time'), title: fd.get('title'), type: fd.get('type'), cats: fd.getAll('cats'), leader: fd.get('leader'), content: fd.get('content'), part: {} };
    activeClients().forEach(c => { const v = fd.get('p_' + c.id); if (v) a.part[c.id] = v; });
    if (id) Object.assign(DB.acts.find(x => x.id === id), a); else DB.acts.push(Object.assign({ id: nextId() }, a)); save(); flash('活動紀錄已儲存'); return App.go('/acts?m=' + a.date.slice(0, 7)); },
  delAct(id) { if (!confirm('刪除這筆活動紀錄？')) return; DB.acts = DB.acts.filter(x => x.id !== id); save(); App.go('/acts'); },
  saveTrain(e, id) { e.preventDefault(); DB.trainings = DB.trainings || []; const t = Object.assign(fd2obj(e.target), { staff: me() });
    if (id) Object.assign(DB.trainings.find(x => x.id === id), t); else DB.trainings.push(Object.assign({ id: nextId() }, t)); save(); flash('教育訓練已儲存'); return App.go('/training'); },
  delTrain(id) { if (!confirm('刪除這筆紀錄？')) return; DB.trainings = DB.trainings.filter(x => x.id !== id); save(); App.go('/training'); },
  saveLib(e) { e.preventDefault(); DB.library = DB.library || []; DB.library.push(Object.assign({ id: nextId(), by: me(), date: todayISO() }, fd2obj(e.target))); save(); flash('已新增'); route(); return false; },
  delLib(id) { if (!confirm('刪除這筆資料？')) return; DB.library = DB.library.filter(x => x.id !== id); save(); route(); },
  delRec(id) { if (!confirm('確定刪除這筆紀錄？')) return; const r = DB.records.find(x => x.id === id); DB.records = DB.records.filter(x => x.id !== id); save(); flash('已刪除'); App.go('/rec/' + r.module); },
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
  else if (p[0] === 'daily') html = V.daily(q);
  else if (p[0] === 'ia') html = p[1] ? V.iaClient(+p[1]) : V.ia(q);
  else if (p[0] === 'attendance') html = V.attendance(q);
  else if (p[0] === 'acts') html = p[1] === 'new' ? V.actForm(0, q) : p[1] ? V.actForm(+p[1]) : V.acts(q);
  else if (p[0] === 'training') html = p[1] === 'new' ? V.trainForm(0) : p[1] ? V.trainForm(+p[1]) : V.training(q);
  else if (p[0] === 'library') html = V.library(q);
  else if (p[0] === 'rec' && ALL_MODS.includes(p[1])) html = V.recList(p[1], q);
  else if (p[0] === 'r') html = V.recView(+p[1]);
  else if (p[0] === 'nutri') html = p[1] === 'new' ? V.nutriForm(0, q) : V.nutriForm(+p[1], q);
  else if (p[0] === 's' && S.SIMPLE[p[1]]) html = p[2] === 'batch' ? V.simpleForm('PC', 0, q, true) : (p[2] === 'new' ? V.simpleForm(p[1], 0, q) : V.simpleForm(p[1], +p[2], q));
  else if (p[0] === 'hv') html = p[1] === 'new' ? V.hvForm(0, q) : V.hvForm(+p[1], q);
  else if (p[0] === 'aids') html = V.aids(q);
  else if (p[0] === 'goals') html = p[1] === 'from' ? V.goalsFrom(+p[2]) : V.goals(q);
  else if (p[0] === 'reports') html = V.reports();
  else if (p[0] === 'feedback') html = V.feedback(q);
  else if (p[0] === 'settings') html = V.settings();
  else html = V.notFound();
  root.innerHTML = html; cardify(root); window.scrollTo(0, 0); dirty = false;
  const f = document.getElementById('f');
  if (f) { f.addEventListener('input', () => { dirty = true; mnaRefresh(); hvRefresh(); }); f.addEventListener('change', () => { markPrev(); refreshIcope(); mnaRefresh(); hvRefresh(); }); markPrev(); refreshIcope(); mnaRefresh(); hvRefresh(); }
  const df = document.getElementById('df');
  if (df) { const h2 = e => { dirty = true; const c = e.target.closest('.daily'); if (c) dailyCheck(c); }; df.addEventListener('input', h2); df.addEventListener('change', h2); df.querySelectorAll('.daily').forEach(dailyCheck); }
  if (document.getElementById('genoEd')) genoRefresh();
  const pv = document.getElementById('pv'); if (pv) { const go = () => { pv.srcdoc = fullHTML(printDoc('a', +p[1]), true); }; PRINT_CSS ? go() : setTimeout(go, 400); }
  document.title = (document.querySelector('main h1') || {}).textContent?.trim() + '｜照護評估系統（試用版）';
}
let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  if (dirty && !confirm('這頁有尚未儲存的修改，確定要離開嗎？')) { history.replaceState(null, '', lastHash || '#/'); return; }
  lastHash = location.hash; route();
});
document.addEventListener('click', e => { const b = e.target.closest('.tchip'); if (!b) return;
  const inp = document.querySelector(`[name="${b.parentElement.dataset.for}"]`); if (!inp) return;
  const t = b.textContent.trim(); if (b.parentElement.dataset.replace) inp.value = t; else if (!inp.value.includes(t)) inp.value = inp.value ? inp.value + (b.parentElement.dataset.nosep ? '' : '；') + t : t;
  dirty = true; hvRefresh(); });
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
load(); route();
})();
