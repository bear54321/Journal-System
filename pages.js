/* ---------- 逐頁核對：每頁一筆紀錄，AI 整期批次分析，人工逐頁確認 ---------- */
/* 每頁紀錄 rec[影像編號] = { own, title, column, author, role, ad, ok, unsure[], more[], ai }
   own=false 表示這頁沒有新標題，沿用前面最近一頁的標題；ok 表示人工確認過 */

const ST_LABEL = { ok: '已確認', review: '待檢查', inh: '沿用前頁', bad: '缺題名', none: '未分析' };
const PV = { sel: 0, filter: 'all', batch: null, lastSrc: '', saving: false, dirty: new Set(), timer: null };
const pvView = { s: 1, x: 0, y: 0, nw: 1, nh: 1, fit: 1, moved: false };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

const pvRec = () => issue().rec;
const pvTail = label => (label.length > 12 ? label.slice(-7) : label); // …00001-00022 → 1-00022
function pvResolved(i) { // 這頁實際歸屬的標題：自己有標題就用自己的，否則往前找
  const pages = issue().pages;
  for (let k = i; k >= 0; k--) { const r = pvRec()[pages[k].label]; if (r && r.own && r.title) return r; }
  return null;
}
function pvStatus(i) {
  const r = pvRec()[issue().pages[i].label];
  if (!r) return 'none';
  if (!r.own) return 'inh';
  if (!r.title) return 'bad';
  return r.ok ? 'ok' : 'review';
}
const blankRec = () => ({ own: false, title: '', column: '', author: '', role: '', ad: false, ok: false, unsure: [], more: [], ai: null, pnoAi: false, pnoAuto: false });

/* ---------- 頁碼：印在書上的頁碼，統一存阿拉伯數字（和「編輯頁碼」是同一份資料 pages[].pno） ---------- */
// 回傳阿拉伯數字字串；空白回傳 ''；看不懂回傳 null。「二十一」→21、「廿三」→23、「iv」→4、「（15）」→15
function normalizePageNo(s) {
  s = String(s || '').trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[\s　()（）\[\]【】第頁页pP.\-—－~～・]+/g, '');
  if (!s) return '';
  if (/^\d{1,4}$/.test(s)) return String(parseInt(s, 10));
  if (/^[ivxlc]{1,6}$/i.test(s)) {
    const v = { i: 1, v: 5, x: 10, l: 50, c: 100 }; let n = 0; s = s.toLowerCase();
    for (let k = 0; k < s.length; k++) { const a = v[s[k]], b = v[s[k + 1]] || 0; n += a < b ? -a : a; }
    return n > 0 ? String(n) : null;
  }
  if (/^[〇零一二三四五六七八九十百廿卅]+$/.test(s)) {
    const d = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    if (!/[十百廿卅]/.test(s)) { const str = [...s].map(c => d[c]).join(''); return str.length <= 4 ? String(parseInt(str, 10)) : null; }
    let total = 0, cur = 0;
    for (const c of s) {
      if (c in d) cur = d[c];
      else if (c === '廿') { total += 20; cur = 0; } else if (c === '卅') { total += 30; cur = 0; }
      else if (c === '十') { total += (cur || 1) * 10; cur = 0; } else if (c === '百') { total += (cur || 1) * 100; cur = 0; }
    }
    total += cur;
    return total > 0 ? String(total) : null;
  }
  return null;
}
const pnoQueue = { is: null, map: {}, timer: null };
function pnoSaveSoon(is, label, value) {
  if (pnoQueue.is && pnoQueue.is !== is) pnoFlush();
  pnoQueue.is = is; pnoQueue.map[label] = value;
  clearTimeout(pnoQueue.timer); pnoQueue.timer = setTimeout(pnoFlush, 500);
}
async function pnoFlush() {
  clearTimeout(pnoQueue.timer);
  const { is, map } = pnoQueue; pnoQueue.is = null; pnoQueue.map = {};
  if (!is || !Object.keys(map).length) return;
  try { await api('savePageno.php', { book: is.id, data: JSON.stringify(map) }); }
  catch (e) { toast('頁碼存檔失敗：' + e.message); }
}
window.addEventListener('beforeunload', () => { pnoFlush(); });
function setPno(is, p, value) { p.pno = value; pnoSaveSoon(is, p.label, value); }
// AI 辨識的頁碼只填空白的頁，不會蓋掉已經有的（可能是人工填的）
function applyAiPno(is, p, rec, printed, model) {
  if (/lite/i.test(model || '')) return; // lite 模型的頁碼常是推算出來的，不採用
  const n = normalizePageNo(printed);
  if (n && !p.pno) { setPno(is, p, n); rec.pnoAi = true; }
}

/* ---------- 頁碼連續性檢查：AI 把直排「二〇」讀成「110」這類錯誤，會讓頁碼突然跳號 ---------- */
// 兩個有數字頁碼的頁之間，頁碼差應該等於頁數差（中間的空白頁也算一頁），不符就是「不連續」
function pnoJunctions(is) {
  const out = {}; let prev = -1;
  is.pages.forEach((p, i) => {
    if (!/^\d+$/.test(p.pno || '')) return;
    if (prev >= 0) { const exp = +is.pages[prev].pno + (i - prev); if (+p.pno !== exp) out[i] = { prev, expected: exp }; }
    prev = i;
  });
  return out;
}
// 只標示 AI 填的、還沒人工確認的頁碼；有些書本來就分章重新編號，確認過就不再提醒
function pnoFlagged(is, i) {
  const j = PV.junc && PV.junc[i], r = is.rec[is.pages[i].label];
  return j && r && r.pnoAi && !r.ok && j.expected >= 1 ? j : null;
}
// 這一頁和後面「照原本順序連續」的頁，一起平移到正確的頁碼（例如 110、111、112 → 20、21、22）
function fixJunction(i) {
  const is = issue(), j = PV.junc[i]; if (!j) return;
  const base = +is.pages[i].pno, delta = j.expected - base; let n = 0;
  for (let k = i; k < is.pages.length; k++) {
    const q = is.pages[k];
    if (!/^\d+$/.test(q.pno || '')) continue;
    if (+q.pno !== base + (k - i)) break;
    setPno(is, q, String(+q.pno + delta)); n++;
  }
  PV.junc = pnoJunctions(is); pvRender();
  toast(`已修正 ${n} 頁的頁碼`);
}
function refreshAllPno() { PV.junc = pnoJunctions(issue()); Object.keys(rowRefs).forEach(k => updateRowSummary(+k)); }
function pnoRunLength(i) {
  const is = issue(), base = +is.pages[i].pno; let n = 0;
  for (let k = i; k < is.pages.length; k++) { const q = is.pages[k]; if (!/^\d+$/.test(q.pno || '')) continue; if (+q.pno !== base + (k - i)) break; n++; }
  return n;
}

/* ---------- 存檔（延遲、不重疊） ---------- */
function recSaveSoon(is) { PV.dirty.add(is); clearTimeout(PV.timer); PV.timer = setTimeout(recFlush, 600); }
async function recFlush() {
  clearTimeout(PV.timer);
  if (PV.saving) { PV.timer = setTimeout(recFlush, 400); return; }
  PV.saving = true;
  const list = [...PV.dirty]; PV.dirty.clear();
  for (const is of list) {
    const body = JSON.stringify(is.rec);
    if (body === is.recSaved) continue;
    try { await api('savePageRec.php', { book: is.id, data: body }); is.recSaved = body; }
    catch (e) { toast('存檔失敗：' + e.message); PV.dirty.add(is); }
  }
  PV.saving = false;
}
window.addEventListener('beforeunload', () => { recFlush(); });

/* ---------- AI 分析 ---------- */
function toRec(res) {
  const list = (res.articles || []).filter(a => a.title);
  if (!list.length) return blankRec();
  const a = list[0], pick = x => ({ title: x.title || '', column: x.column_name || '', author: x.author || '', role: x.author_role || '' });
  const r = { ...blankRec(), ...pick(a), own: true, ad: !!a.is_ad };
  r.unsure = (a.uncertain || []).map(k => (k === 'column_name' ? 'column' : k));
  r.more = list.slice(1).map(pick);
  r.ai = pick(a);
  return r;
}
const RETRYABLE = /頻繁|忙碌|high demand|連線/; // 「今天的免費額度已用完」不重試，重試也沒有用
async function callAnalyze(is, params) {
  if (!hasKey()) { openAiDlg('請先輸入您的 Gemini API 金鑰，才能使用 AI 辨識。'); throw new Error('尚未設定 AI 金鑰'); }
  for (let tries = 1; ; tries++) {
    try {
      const res = parse(await api('analyze.php', { book: is.id, ...(isThread(is) ? { thread: '1' } : {}), ...params }), null);
      if (!res) throw new Error('結果無法解析');
      return res;
    } catch (e) {
      if (tries < 3 && RETRYABLE.test(e.message)) { await sleep(8000 * tries); continue; }
      throw e;
    }
  }
}
const analyzeOne = async (is, p) => { const res = await callAnalyze(is, { page: p.label, mode: 'page' }); const r = toRec(res); applyAiPno(is, p, r, res.printed_page, res.model); return r; };

const GROUP = 4; // 每次請求送幾頁；免費額度是限制「請求次數」，多頁合併可以大幅節省
async function runBatch(redo) {
  const is = issue();
  if (PV.batch || !is.id) return;
  const todo = is.pages.filter(p => { const r = is.rec[p.label]; return redo ? !(r && r.ok) : !r; });
  if (!todo.length) { toast('沒有需要分析的頁面'); return; }
  const groups = [];
  for (let k = 0; k < todo.length; k += GROUP) groups.push(todo.slice(k, k + GROUP));
  const b = PV.batch = { is, total: todo.length, done: 0, fail: [], stop: false, error: '', models: new Set() };
  let next = 0;
  const worker = async () => {
    while (!b.stop && next < groups.length) {
      const g = groups[next++];
      try {
        const res = await callAnalyze(is, { pages: JSON.stringify(g.map(p => p.label)), mode: 'batch' });
        if (res.model) b.models.add(res.model);
        g.forEach(p => { const x = res.pages && res.pages[p.label]; if (x) { is.rec[p.label] = toRec(x); applyAiPno(is, p, is.rec[p.label], x.printed_page, res.model); } else b.fail.push(p.label); });
      } catch (e) {
        g.forEach(p => b.fail.push(p.label)); b.error = e.message;
        if (/今天的免費額度|金鑰|尚未設定|API key|PERMISSION|UNAUTHENTICATED/i.test(e.message)) { b.stop = true; if (/API key|PERMISSION|UNAUTHENTICATED|金鑰無效/i.test(e.message)) openAiDlg('這把金鑰無法使用：' + e.message); }
      }
      b.done += g.length; recSaveSoon(is);
      if (is === issue()) pvRender();
    }
  };
  pvRender();
  await Promise.all([worker(), worker()]); // 同時 2 組，避免超過每分鐘請求數
  PV.batch = null; recFlush();
  const left = todo.filter(p => !is.rec[p.label]).length;
  pvRender();
  if (b.error && left) toast(b.error + `（尚餘 ${left} 頁，已分析的都已保留，之後可按「繼續分析」）`);
  else toast(b.stop ? '已暫停，之後可按「繼續分析」' : left ? `完成，但有 ${left} 頁失敗，可按「繼續分析」重試` : '整期分析完成，請逐頁核對');
}$('pvBatch').onclick = () => {
  const is = issue();
  if (!is.id) return toast('請先選擇期刊');
  const unanalyzed = is.pages.filter(p => !is.rec[p.label]).length;
  runBatch(unanalyzed === 0);
};
$('pvStop').onclick = () => { if (PV.batch) PV.batch.stop = true; };

/* ---------- 影像（滾輪縮放、拖曳） ---------- */
function pvApplyView() { const i = $('pvImg'); i.style.width = pvView.nw * pvView.s + 'px'; i.style.height = pvView.nh * pvView.s + 'px'; i.style.left = pvView.x + 'px'; i.style.top = pvView.y + 'px'; }
function pvFit() {
  const box = $('pvViewer'), img = $('pvImg');
  if (!box.clientWidth || !box.clientHeight) { setTimeout(pvFit, 200); return; }
  if (!img.naturalWidth) return;
  pvView.nw = img.naturalWidth; pvView.nh = img.naturalHeight;
  pvView.fit = pvView.s = Math.min((box.clientWidth - 16) / pvView.nw, (box.clientHeight - 16) / pvView.nh);
  pvView.x = (box.clientWidth - pvView.nw * pvView.s) / 2; pvView.y = (box.clientHeight - pvView.nh * pvView.s) / 2; pvView.moved = false;
  pvApplyView();
}
function pvZoom(f, cx, cy) {
  const s = Math.min(8, Math.max(pvView.fit * 0.5, pvView.s * f)), k = s / pvView.s;
  pvView.x = cx - (cx - pvView.x) * k; pvView.y = cy - (cy - pvView.y) * k; pvView.s = s; pvView.moved = true; pvApplyView();
}
(function () {
  const box = $('pvViewer'); let drag = null;
  $('pvImg').addEventListener('load', pvFit);
  box.addEventListener('wheel', e => { e.preventDefault(); const r = box.getBoundingClientRect(); pvZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  box.addEventListener('pointerdown', e => { if (e.target.closest('.pv-zoom')) return; drag = { x: e.clientX - pvView.x, y: e.clientY - pvView.y }; box.setPointerCapture(e.pointerId); });
  box.addEventListener('pointermove', e => { if (drag) { pvView.x = e.clientX - drag.x; pvView.y = e.clientY - drag.y; pvView.moved = true; pvApplyView(); } });
  box.addEventListener('pointerup', () => { drag = null; });
  $('pvIn').onclick = () => pvZoom(1.25, box.clientWidth / 2, box.clientHeight / 2);
  $('pvOut').onclick = () => pvZoom(0.8, box.clientWidth / 2, box.clientHeight / 2);
  $('pvFit').onclick = pvFit;
  new ResizeObserver(() => { if (!pvView.moved) pvFit(); }).observe(box);
})();
function pvShowImage() {
  const is = issue(), p = is.pages[PV.sel];
  if (!p) { $('pvImg').removeAttribute('src'); $('pvTag').textContent = ''; PV.lastSrc = ''; return; }
  const src = imgUrl(is.id, p.label);
  if (src !== PV.lastSrc) { PV.lastSrc = src; $('pvImg').src = src; }
  $('pvTag').textContent = `第 ${PV.sel + 1} 頁・…${pvTail(p.label)}` + (p.pno ? `・頁碼 ${p.pno}` : '');
}

/* ---------- 清單與編輯 ---------- */
function pvSelect(i, opts = {}) {
  const n = issue().pages.length; if (!n) return;
  PV.sel = Math.max(0, Math.min(n - 1, i));
  pvRender(opts);
}
function pvConfirm(i) {
  const p = issue().pages[i], r = pvRec()[p.label];
  if (!r) { pvRec()[p.label] = Object.assign(blankRec(), { ok: true }); }
  else if (r.own && !r.title) { toast('這一頁缺題名：請填寫，或改為「沿用前頁」'); return false; }
  else r.ok = true;
  recSaveSoon(issue());
  propagatePno(i);
  return true;
}
function touch(r) { r.ok = false; recSaveSoon(issue()); }

function pnoField(i) {
  const is = issue(), p = is.pages[i], r = is.rec[p.label];
  const f = h('div', 'f full');
  const lab = h('label', '', '頁碼（印在書上的數字）');
  if (r && r.pnoAi && p.pno) lab.append(h('span', 'unsure-tag', 'AI 辨識，請核對'));
  if (r && r.pnoAuto && p.pno) lab.append(h('span', 'unsure-tag auto-tag', '自動接續'));
  const row = h('div', 'pno-row');
  const inp = h('input'); inp.type = 'text'; inp.inputMode = 'numeric'; inp.value = p.pno || ''; inp.placeholder = '無頁碼'; inp.dataset.k = 'pno';
  const commit = () => {
    const n = normalizePageNo(inp.value);
    if (n === null) { toast('頁碼請填數字（中文數字、羅馬數字會自動換成阿拉伯數字）'); inp.value = p.pno || ''; return; }
    if (n !== (p.pno || '')) { setPno(is, p, n); if (r) { r.pnoAi = false; r.pnoAuto = false; recSaveSoon(is); } }
    inp.value = n; lab.querySelector('.unsure-tag')?.remove(); refreshAllPno(); pvShowImage();
  };
  inp.onchange = commit;
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); if (pvConfirm(i)) pvSelect(i + 1); }
    if (e.key === 'Escape') inp.blur();
  };
  const plus = h('button', 'link-btn', '接續前頁 +1'); plus.type = 'button';
  plus.onclick = () => { const q = is.pages[i - 1]; if (!q || !/^\d+$/.test(q.pno || '')) return toast('前一頁沒有數字頁碼'); inp.value = String(+q.pno + 1); commit(); };
  const clr = h('button', 'link-btn', '清除'); clr.type = 'button';
  clr.onclick = () => { inp.value = ''; commit(); };
  row.append(inp, plus, clr); f.append(lab, row);
  const fl = pnoFlagged(is, i), frag = document.createDocumentFragment();
  if (fl) {
    const hint = h('div', 'pv-hint full pno-warn');
    const prevNo = is.pages[fl.prev].pno;
    hint.append(h('div', '', `⚠ 這一頁的頁碼 ${p.pno} 和前面不連續：第 ${fl.prev + 1} 頁是 ${prevNo}，照順序這一頁應為 ${fl.expected}。可能是 AI 讀錯（例如把「二〇」讀成「一一〇」），請對照影像。`));
    const bar = h('div', 'pv-acts'); bar.style.marginTop = '6px';
    const fix = h('button', 'btn primary', `改成 ${fl.expected}，並一起修正後面連續的 ${pnoRunLength(i)} 頁`); fix.type = 'button';
    fix.onclick = () => fixJunction(i);
    const okb = h('button', 'btn', '沒問題（這裡本來就重新編號）'); okb.type = 'button';
    okb.onclick = () => { if (r) { r.pnoAi = false; recSaveSoon(is); } pvRender(); };
    bar.append(fix, okb); hint.append(bar); frag.append(hint);
  }
  frag.append(f);
  return frag;
}

function pvEditor(i) {
  const is = issue(), p = is.pages[i], wrap = h('div', 'pv-edit');
  wrap.onclick = e => e.stopPropagation();
  wrap.append(pnoField(i));
  let r = is.rec[p.label];
  if (!r) {
    wrap.append(Object.assign(h('div', 'pv-hint full', '這一頁還沒有分析。'), {}));
    const acts = h('div', 'pv-acts full');
    const one = h('button', 'btn primary', '分析這一頁'); one.type = 'button';
    one.onclick = async () => { one.disabled = true; one.textContent = '辨識中…'; try { is.rec[p.label] = await analyzeOne(is, p); recSaveSoon(is); } catch (e) { toast(e.message); } pvRender(); };
    const man = h('button', 'btn', '手動填寫'); man.type = 'button';
    man.onclick = () => { is.rec[p.label] = { ...blankRec(), own: true }; recSaveSoon(is); pvRender({ focus: true }); };
    const inh = h('button', 'btn', '沿用前頁'); inh.type = 'button';
    inh.onclick = () => { is.rec[p.label] = blankRec(); recSaveSoon(is); pvRender(); };
    acts.append(one, man, inh); wrap.append(acts);
    return wrap;
  }
  const refresh = () => { updateRowSummary(i); };
  if (!r.own) {
    const res = pvResolved(i);
    wrap.append(h('div', 'pv-hint full', res ? `↳ 這一頁沒有新標題，歸入前面的「${res.title}」。` : '↳ 這一頁沒有新標題，但前面也沒有標題可以沿用。'));
  } else {
    const field = (label, key, full) => {
      const f = h('div', 'f' + (full ? ' full' : '') + (r.unsure.includes(key) ? ' unsure' : ''));
      const lab = h('label', '', label); if (r.unsure.includes(key)) lab.append(h('span', 'unsure-tag', 'AI 不確定'));
      const inp = h('input'); inp.type = 'text'; inp.value = r[key] || ''; inp.dataset.k = key;
      inp.oninput = () => { r[key] = inp.value; touch(r); refresh(); };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (pvConfirm(i)) pvSelect(i + 1); } if (e.key === 'Escape') inp.blur(); };
      f.append(lab, inp); return f;
    };
    wrap.append(field('主要題名', 'title', true), field('作者', 'author'), field('專欄名稱', 'column'));
    const adl = h('label', 'f'); const cb = h('input'); cb.type = 'checkbox'; cb.checked = !!r.ad; cb.onchange = () => { r.ad = cb.checked; touch(r); refresh(); };
    adl.style.flexDirection = 'row'; adl.style.alignItems = 'center'; adl.style.gap = '6px'; adl.append(cb, document.createTextNode('廣告／啟事'));
    const rl = field('作者角色（如「譯」）', 'role'); wrap.append(rl, adl);
    if (r.more && r.more.length) {
      const m = h('div', 'pv-more full'); m.append('這一頁還有：');
      r.more.forEach((a, k) => {
        const b = h('button', 'link-btn', a.title + (a.author ? `（${a.author}）` : '')); b.type = 'button';
        b.onclick = () => { const cur = { title: r.title, column: r.column, author: r.author, role: r.role }; Object.assign(r, a); r.more[k] = cur; r.unsure = []; touch(r); pvRender(); };
        m.append(b);
      });
      wrap.append(m);
    }
  }
  const acts = h('div', 'pv-acts full');
  const ok = h('button', 'btn primary'); ok.type = 'button'; ok.innerHTML = '確認，下一頁 <kbd>Enter</kbd>';
  ok.onclick = () => { if (pvConfirm(i)) pvSelect(i + 1); };
  const tog = h('button', 'btn', r.own ? '改為沿用前頁' : '這頁有新標題'); tog.type = 'button';
  tog.onclick = () => { r.own = !r.own; touch(r); pvRender({ focus: r.own }); };
  acts.append(ok, tog);
  if (r.ai && r.own) {
    const rev = h('button', 'btn', '還原 AI 結果'); rev.type = 'button';
    rev.onclick = () => { Object.assign(r, r.ai); touch(r); pvRender(); };
    acts.append(rev);
  }
  wrap.append(acts);
  return wrap;
}

const rowRefs = {};
function updateRowSummary(i) {
  const ref = rowRefs[i]; if (!ref) return;
  const r = pvRec()[issue().pages[i].label], s = pvStatus(i), res = pvResolved(i);
  ref.tt.className = 'pv-tt' + (!r ? ' none' : (!r.own ? ' inh' : ''));
  ref.tt.textContent = !r ? '（尚未分析）' : (r.own ? (r.title || '（請補題名）') : '↳ ' + (res ? res.title : '（前面沒有標題）'));
  ref.sub.textContent = r && r.own ? ([r.column, r.author, r.ad ? '廣告' : ''].filter(Boolean).join('・') || '—') : '';
  ref.badge.className = 'badge b-' + s; ref.badge.textContent = ST_LABEL[s];
  const pn = issue().pages[i].pno, fl = pnoFlagged(issue(), i); ref.pno.textContent = pn || '—'; ref.pno.className = 'pv-pno' + (pn ? '' : ' none') + (fl ? ' warn' : '') + (r && r.pnoAuto && pn ? ' auto' : ''); ref.pno.title = fl ? `頁碼和前面不連續（照順序應為 ${fl.expected}），可能是辨識錯誤` : pn ? '印在書上的頁碼：' + pn : '沒有頁碼';
  pvProgress();
}
function pvProgress() {
  const is = issue(), n = is.pages.length, c = { ok: 0, review: 0, inh: 0, bad: 0, none: 0 };
  is.pages.forEach((p, i) => c[pvStatus(i)]++);
  const colors = { ok: 'var(--ok)', review: '#d29a1c', inh: '#a9b0b2', bad: 'var(--danger)', none: 'var(--sunken)' };
  $('pvProg').replaceChildren(...['ok', 'review', 'inh', 'bad', 'none'].map(k => { const i = h('i'); i.style.width = (n ? c[k] / n * 100 : 0) + '%'; i.style.background = colors[k]; return i; }));
  $('pvCount').textContent = n ? `已確認 ${c.ok}／待檢查 ${c.review}／沿用 ${c.inh}／缺題名 ${c.bad}／未分析 ${c.none}` : '';
  return c;
}

function pvRender(opts = {}) {
  const is = issue(), box = $('pvRows'), top = box.scrollTop;
  const n = is.pages.length;
  PV.sel = Math.min(PV.sel, Math.max(0, n - 1));
  PV.junc = pnoJunctions(is);
  $('pvThread').checked = isThread(is); $('pvThread').disabled = !is.id;
  const c = pvProgress();
  // 頂端按鈕
  const b = PV.batch && PV.batch.is === is ? PV.batch : null;
  $('pvStop').hidden = !b; $('pvBatch').disabled = !!b || !n;
  $('pvBatch').textContent = b ? `分析中 ${b.done}／${b.total}` : (c.none === n ? `分析整期（${n} 頁）` : c.none > 0 ? `繼續分析（尚餘 ${c.none} 頁）` : '重新分析未確認的頁面');
  // 篩選
  const fb = $('pvFilters'); fb.replaceChildren();
  [['all', '全部', n], ['none', '未分析', c.none], ['review', '待檢查', c.review], ['inh', '沿用前頁', c.inh], ['bad', '缺題名', c.bad], ['ok', '已確認', c.ok], ['jump', '頁碼不連續', is.pages.filter((p, i) => pnoFlagged(is, i)).length], ['nopno', '無頁碼', is.pages.filter(p => !p.pno).length]].forEach(([k, l, cnt]) => {
    const chip = h('button', 'chip', `${l} ${cnt}`); chip.type = 'button'; chip.setAttribute('aria-pressed', PV.filter === k);
    chip.onclick = () => { PV.filter = k; pvRender(); }; fb.append(chip);
  });
  // 清單
  box.replaceChildren();
  for (const k in rowRefs) delete rowRefs[k];
  if (!n) box.append(Object.assign(h('div', 'pv-hint', is.id ? '這一期沒有影像。請把圖檔放進 img 資料夾裡這一期的資料夾。' : '請先在上方選擇期刊。'), { style: 'margin:12px' }));
  is.pages.forEach((p, i) => {
    const s = pvStatus(i);
    if (PV.filter !== 'all' && s !== PV.filter && !(PV.filter === 'nopno' && !p.pno) && !(PV.filter === 'jump' && pnoFlagged(is, i)) && i !== PV.sel) return;
    const row = h('div', 'pv-row' + (i === PV.sel ? ' sel' : '')); row.dataset.i = i;
    const pg = h('div', 'pv-pg', String(i + 1)); pg.append(h('small', '', pvTail(p.label)));
    const mid = h('div'), tt = h('div', 'pv-tt'), sub = h('div', 'pv-sub'), badge = h('span', 'badge');
    const pno = h('div', 'pv-pno'); mid.append(tt, sub); row.append(pg, pno, mid, badge);
    rowRefs[i] = { tt, sub, badge, pno }; updateRowSummary(i);
    if (i === PV.sel) row.append(pvEditor(i));
    row.onclick = () => pvSelect(i);
    box.append(row);
  });
  pvShowImage();
  const selRow = box.querySelector('.pv-row.sel');
  if (opts.focus && selRow) selRow.querySelector('input[type="text"]')?.focus();
  if (selRow && !opts.keepScroll) { const r = selRow.getBoundingClientRect(), br = box.getBoundingClientRect(); if (r.top < br.top || r.bottom > br.bottom) selRow.scrollIntoView({ block: 'nearest' }); else box.scrollTop = top; }
}

/* ---------- 套用到篇目目錄 ---------- */
function applyToCatalog() {
  const is = issue(); if (!is.id) return toast('請先選擇期刊');
  const c = pvProgress();
  if (c.bad > 0) { toast(`還有 ${c.bad} 頁缺題名，請先補上或改為沿用前頁`); PV.filter = 'bad'; pvRender(); return; }
  if (c.ok + c.review + c.inh === 0) return toast('還沒有任何分析結果');
  const notes = [];
  if (c.none > 0) notes.push(`${c.none} 頁尚未分析，會視為沿用前頁`);
  if (c.review > 0) notes.push(`${c.review} 頁還是「待檢查」`);
  const entries = []; let cur = null, orphan = 0;
  is.pages.forEach(p => {
    const r = is.rec[p.label];
    if (r && r.own && r.title) {
      if (cur && cur.title === r.title && cur.author === r.author) { cur.page2 = p.label; return; } // 同題名同作者的連續頁併成一筆
      cur = { id: uid(), title: r.title, column: r.column, ad: !!r.ad, author: r.author, role: r.role, page1: p.label, page2: p.label, pageList: [], collapsed: false, children: [] };
      entries.push(cur);
    } else if (cur) cur.page2 = p.label;
    else orphan++;
  });
  if (orphan) notes.push(`開頭 ${orphan} 頁沒有標題可歸屬，不會出現在篇目裡`);
  const msg = `將產生 ${entries.length} 筆篇目` + (is.entries.length ? `，並取代目前篇目目錄裡的 ${is.entries.length} 筆（含層級與排序）` : '') + '。' + (notes.length ? '\n\n注意：\n・' + notes.join('\n・') : '') + '\n\n確定套用？';
  if (!confirm(msg)) return;
  is.entries = entries; selectedId = null;
  persist(); setMode('catalog'); toast(`已套用，共 ${entries.length} 筆篇目`);
}
$('pvApply').onclick = applyToCatalog;

/* ---------- 模式切換與快速鍵 ---------- */
function setMode(m) {
  $('app').classList.toggle('mode-pages', m === 'pages'); $('app').classList.toggle('mode-catalog', m === 'catalog');
  document.querySelectorAll('#modeSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
  if (m === 'catalog') renderAll(); else { pvRender(); pvFit(); }
}
document.querySelectorAll('#modeSeg button').forEach(b => { b.onclick = () => setMode(b.dataset.m); });
document.addEventListener('keydown', e => {
  if (!$('app').classList.contains('mode-pages') || document.querySelector('dialog[open]')) return;
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); pvSelect(PV.sel + 1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); pvSelect(PV.sel - 1); }
  if (e.key === 'Enter') { e.preventDefault(); if (pvConfirm(PV.sel)) pvSelect(PV.sel + 1); }
});

/* ---------- AI 設定：使用者自己的 Gemini 金鑰 ---------- */
const hasKey = () => !!getUserKey() || window.SERVER_KEY === true;
function keyState() {
  const k = getUserKey();
  if (k) return '自己的金鑰（…' + k.slice(-4) + '）';
  return window.SERVER_KEY ? '伺服器預設金鑰' : '尚未設定';
}
function updateKeyState() {
  const st = keyState();
  $('pvKeyBtn').textContent = 'AI 金鑰：' + st;
  $('aiState').textContent = '目前使用：' + st;
}
function openAiDlg(msg) {
  const inp = $('aiKey'); inp.value = ''; inp.type = 'password'; $('aiShow').textContent = '顯示';
  $('aiError').textContent = msg || ''; $('aiError').hidden = !msg;
  updateKeyState();
  if (!$('aiDlg').open) $('aiDlg').showModal();
  inp.focus();
}
async function saveKey(test) {
  const k = $('aiKey').value.trim(), err = $('aiError'), fail = m => { err.textContent = m; err.hidden = false; };
  err.hidden = true;
  if (!k) return fail('請貼上金鑰。');
  if (!/^[A-Za-z0-9_.\-]{20,200}$/.test(k)) return fail('金鑰格式不正確（只能有英數字、底線、句點、減號）。');
  if (test) {
    const btn = $('aiSaveTest'); btn.disabled = true; btn.textContent = '測試中…';
    try { await api('analyze.php', { mode: 'test', api_key: k }); }
    catch (e) { return fail(e.message); }
    finally { btn.disabled = false; btn.textContent = '測試並儲存'; }
  }
  if (!setUserKey(k)) return fail('這個瀏覽器不允許儲存（可能是無痕模式或停用了網站資料）。');
  updateKeyState(); $('aiDlg').close(); toast(test ? '金鑰有效，已儲存' : '已儲存金鑰');
}
$('openAi').onclick = () => openAiDlg();
$('pvKeyBtn').onclick = () => openAiDlg();
$('aiShow').onclick = () => { const i = $('aiKey'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('aiShow').textContent = show ? '隱藏' : '顯示'; };
$('aiKey').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); saveKey(true); } };
$('aiSaveTest').onclick = () => saveKey(true);
$('aiSave').onclick = () => saveKey(false);
$('aiClear').onclick = () => { setUserKey(''); $('aiError').hidden = true; updateKeyState(); toast(window.SERVER_KEY ? '已清除，之後會使用伺服器預設金鑰' : '已清除金鑰，要使用 AI 辨識請重新輸入'); };
/* ---------- 線裝書：頁碼在中縫，只填篇目首頁，後面的頁自動接續 ---------- */
const isThread = is => (is.meta || {})['線裝書'] === '是';

function toastUndo(msg, undo) {
  const t = $('toast');
  t.replaceChildren(document.createTextNode(msg + '　'));
  const b = h('button', 'link-btn', '復原'); b.type = 'button';
  b.style.color = 'inherit'; b.style.textDecoration = 'underline';
  b.onclick = () => { undo(); t.hidden = true; };
  t.append(b); t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 10000);
}

// 按「確認」確認的是篇目首頁、且有數字頁碼時：同一篇目後面「沿用前頁」的頁，依序填成 N+1、N+2……（一張影像算一頁）
// 遇到下一個有新標題的頁，或還沒分析的頁就停止（下一篇的首頁不自動接續）。
// 已經有頁碼的頁：AI 辨識或先前自動填、而且還沒確認的會被覆蓋；人工填的、或已確認的不動。
function propagatePno(i) {
  const is = issue(), P = is.pages, p = P[i], r = is.rec[p.label];
  if (!r || !r.own || !r.title || !/^\d+$/.test(p.pno || '')) return;
  const base = +p.pno, snap = [];
  for (let k = i + 1; k < P.length; k++) {
    const q = P[k], rq = is.rec[q.label];
    if (!rq || rq.own) break;
    const want = String(base + (k - i));
    if (q.pno === want) continue;
    if (q.pno && !((rq.pnoAi || rq.pnoAuto) && !rq.ok)) continue; // 人工填的或已確認的：不動，但後面仍照順序編號
    snap.push({ label: q.label, pno: q.pno || '', pnoAi: !!rq.pnoAi, pnoAuto: !!rq.pnoAuto });
    setPno(is, q, want); rq.pnoAi = false; rq.pnoAuto = true;
  }
  if (!snap.length) return;
  recSaveSoon(is); pvRender();
  toastUndo(`已自動接續後面 ${snap.length} 頁的頁碼（${base + 1} 起）`, () => {
    snap.forEach(s0 => { const q = P.find(x => x.label === s0.label), rq = is.rec[s0.label]; setPno(is, q, s0.pno); rq.pnoAi = s0.pnoAi; rq.pnoAuto = s0.pnoAuto; });
    recSaveSoon(is); pvRender();
  });
}

$('pvThread').onchange = () => {
  const is = issue(); if (!is.id) return;
  const on = $('pvThread').checked, meta = { ...is.meta, '線裝書': on ? '是' : '否' };
  api('saveMeta.php', { book: is.id, meta: JSON.stringify(meta) })
    .then(() => { is.meta = meta; toast(on ? '已設為線裝書：之後分析會以中縫（版心）的頁碼為主；已分析過的頁不會重辨識' : '已取消線裝書設定'); })
    .catch(e => { toast('存檔失敗：' + e.message); pvRender(); });
};

updateKeyState();
pvRender();