/* ---------- 逐頁核對：每頁一筆紀錄，AI 整期批次分析，人工逐頁確認 ---------- */
/* 每頁紀錄 rec[影像編號] = { own, title, column, author, role, ad, ok, unsure[], more[], ai }
   own=false 表示這頁沒有新標題，沿用前面最近一頁的標題；ok 表示人工確認過 */

const ST_LABEL = { ok: '已確認', review: '待檢查', inh: '沿用前頁', bad: '缺題名', none: '未分析' };
const PV = { flash: new Set(), sel: 0, filter: 'all', batch: null, lastSrc: '', saving: false, dirty: new Set(), timer: null, collapsed: false, sub: null };
const pvView = { s: 1, x: 0, y: 0, nw: 1, nh: 1, fit: 1, moved: false };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// AI 辨識中：在影像檢視器外緣出現流動的彩虹光環與掃描光帶（Apple Intelligence 風格）
function aiScan(box, on, text) {
  let el = box.querySelector(':scope > .ai-scan');
  if (on && el) { const t = el.querySelector('.ai-label span'); if (t && text) t.textContent = text; } // 只更新文字（例如整期分析的進度）
  if (!on) {
    box.classList.remove('ai-busy');
    if (el) { el.classList.remove('on'); setTimeout(() => { if (!el.classList.contains('on')) el.remove(); }, 450); }
    return;
  }
  if (!el) {
    el = h('div', 'ai-scan'); el.append(h('i', 'ai-sweep'));
    const lab = h('div', 'ai-label'); lab.append(h('i', 'ai-dot'), h('span', '', text || 'AI 分析中…')); el.append(lab);
    box.append(el);
  }
  void el.offsetWidth; el.classList.add('on'); box.classList.add('ai-busy');
}
// 題名候選：整句（點一下換成該版本）＋ 有疑問的字（點一下換掉那個字）。cands = { alts: [...], diff: [{ i, chars: [...] }] }
function renderCands(box, cands, getVal, setVal) {
  box.replaceChildren();
  if (!cands || (!(cands.alts || []).length && !(cands.diff || []).length)) { box.hidden = true; return; }
  box.hidden = false;
  const cur = getVal();
  const again = () => renderCands(box, cands, getVal, setVal);
  const chip = (text, on, fn, cls) => { const b = h('button', 'cand-chip' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = fn; return b; };
  const all = [cur, ...(cands.alts || []).filter(t => t !== cur)];
  if (all.length > 1) {
    const row = h('div', 'cand-row'); row.append(h('span', 'cand-label', '候選題名'));
    all.forEach(t => row.append(chip(t, t === cur, () => { setVal(t); again(); })));
    box.append(row);
  }
  (cands.diff || []).forEach(d => {
    if (d.i >= cur.length) return;
    const row = h('div', 'cand-row'); row.append(h('span', 'cand-label', '第 ' + (d.i + 1) + ' 字'));
    d.chars.forEach(c => row.append(chip(c, cur[d.i] === c, () => { const v = getVal(); setVal(v.slice(0, d.i) + c + v.slice(d.i + 1)); again(); }, 'cand-char')));
    box.append(row);
  });
}
const pvRec = () => issue().rec;
const pvTail = label => (label.length > 12 ? label.slice(-7) : label); // …00001-00022 → 1-00022
function pvResolved(i) { // 這頁實際歸屬的標題：自己有標題就用自己的，否則往前找
  const pages = issue().pages;
  for (let k = i; k >= 0; k--) {
    const r = pvRec()[pages[k].label];
    if (r && r.own) { const all = [r, ...(r.more || [])].filter(x => x.title); if (all.length) return all[all.length - 1]; } // 同一張影像有多個題名時，後面接續的是最後一個
  }
  return null;
}
function pvStatus(i) {
  const r = pvRec()[issue().pages[i].label];
  if (!r) return 'none';
  if (!r.own) return 'inh';
  if (!r.title || (r.more || []).some(m => !m.title)) return 'bad';
  return r.ok && (r.more || []).every(m => m.ok) ? 'ok' : 'review';
}
// 同一張影像的其他題名（子列）的狀態
const subStatus = m => (!m.title ? 'bad' : m.ok ? 'ok' : 'review');
const blankSub = () => ({ title: '', column: '', author: '', role: '', ad: false, ok: false });
const blankRec = () => ({ own: false, title: '', column: '', author: '', role: '', ad: false, ok: false, unsure: [], more: [], ai: null, pnoAi: false, pnoAuto: false, pnoSuggest: '', titleRaw: '', titleAuto: '', section: '', sectionPrinted: '', sectionSrc: '', sectionNote: '' });

/* ---------- 頁碼：印在書上的頁碼，統一存阿拉伯數字（和「編輯頁碼」是同一份資料 pages[].pno） ---------- */
// 回傳阿拉伯數字字串；空白回傳 ''；看不懂回傳 null。「二十一」→21、「廿三」→23、「iv」→4、「（15）」→15
// 一張影像有兩個頁碼（左右跨頁）時存成「小-大」，例如「1-2」；兩個都要是看得懂的數字，且後者較大
const PNO_SPLIT = /\s*[-–—－~～至]\s*/;
function normalizePageNo(s) {
  s = String(s || '').trim();
  const parts = s.split(PNO_SPLIT);
  if (parts.length === 2 && parts[0] && parts[1]) {
    const a = normalizeOnePageNo(parts[0]), b = normalizeOnePageNo(parts[1]);
    if (!a || !b) return null;
    return +b > +a ? a + '-' + b : (a === b ? a : null);
  }
  return normalizeOnePageNo(s);
}
// 數字頁碼（單一「12」或範圍「1-2」）的起、迄、平移
const isNumPno = s => /^\d+(-\d+)?$/.test(s || '');
const pnoFirst = s => parseInt(String(s).split('-')[0], 10);
const pnoLast = s => parseInt(String(s).split('-').pop(), 10);
const shiftPno = (s, d) => String(s).split('-').map(x => String(+x + d)).join('-');
function normalizeOnePageNo(s) {
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
async function pnoFlush(unloading) {
  clearTimeout(pnoQueue.timer);
  const { is, map } = pnoQueue; pnoQueue.is = null; pnoQueue.map = {};
  if (!is || !Object.keys(map).length) return true;
  const params = { book: is.id, data: JSON.stringify(map) };
  const fits = encLen(params) < 60000;
  try { await api('savePageno.php', params, unloading === true ? { keepalive: true } : undefined); }
  catch (e) { toast('頁碼存檔失敗：' + e.message); }
  return unloading !== true || fits;
}
// 離開頁面：頁碼與逐頁核對資料用 keepalive 送出；太大送不完時請瀏覽器詢問是否離開
window.addEventListener('beforeunload', e => {
  const okPno = pnoQueue.is ? encLen({ book: pnoQueue.is.id, data: JSON.stringify(pnoQueue.map) }) < 60000 : true;
  pnoFlush(true);
  const okRec = recFlushUnload();
  if (!okPno || !okRec) { e.preventDefault(); e.returnValue = ''; }
});
function setPno(is, p, value) { p.pno = value; pnoSaveSoon(is, p.label, value); }
// AI 辨識的頁碼只填空白的頁，不會蓋掉已經有的（可能是人工填的）
// 重新分析會換掉整筆紀錄，先把舊紀錄裡「頁碼是誰填的」的旗標帶過來
function carryPnoFlags(old, rec) { if (old) { rec.pnoAi = old.pnoAi; rec.pnoAuto = old.pnoAuto; } }
// AI 辨識到的頁碼：這頁還沒有頁碼就直接填；已經有不同的頁碼（而且還沒確認）就不覆蓋，列為「AI 建議」讓使用者決定
function applyAiPno(is, p, rec, printed, model) {
  const n = normalizePageNo(printed);
  if (!n) return;
  if (/lite/i.test(model || '') && !isThread(is)) return; // lite 在一般書上的頁碼常是推算的；線裝書讀中縫時實測可用
  if (!p.pno) { setPno(is, p, n); rec.pnoAi = true; rec.pnoSuggest = ''; return; }
  // 原本只有單一頁碼（如「1」），這次辨識到它所在的跨頁（「1-2」）：視為補全，直接採用
  if (!rec.ok && /^\d+$/.test(p.pno) && /^\d+-\d+$/.test(n) && (pnoFirst(n) === +p.pno || pnoLast(n) === +p.pno)) { setPno(is, p, n); rec.pnoAi = true; rec.pnoSuggest = ''; return; }
  if (p.pno !== n && !rec.ok) rec.pnoSuggest = n;
}
function pnoSuggested(is, i) {
  const p = is.pages[i], r = is.rec[p.label];
  return r && r.pnoSuggest && r.pnoSuggest !== p.pno && !r.ok ? r.pnoSuggest : '';
}
const suggCount = () => { const is = issue(); return is.pages.filter((p, i) => pnoSuggested(is, i)).length; };

/* ---------- 頁碼連續性檢查：AI 把直排「二〇」讀成「110」這類錯誤，會讓頁碼突然跳號 ---------- */
// 兩個有數字頁碼的頁之間，頁碼差應該等於頁數差（中間的空白頁也算一頁），不符就是「不連續」
function pnoJunctions(is) {
  const out = {}; let prev = -1;
  is.pages.forEach((p, i) => {
    if (!isNumPno(p.pno)) return;
    // 上一個有頁碼的頁若是「1-2」這種跨頁，下一頁應接在它的迄頁之後
    if (prev >= 0) { const exp = pnoLast(is.pages[prev].pno) + (i - prev); if (pnoFirst(p.pno) !== exp) out[i] = { prev, expected: exp }; }
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
  const delta = j.expected - pnoFirst(is.pages[i].pno); let n = 0, pk = -1, pl = 0;
  for (let k = i; k < is.pages.length; k++) {
    const q = is.pages[k];
    if (!isNumPno(q.pno)) continue;
    if (pk >= 0 && pnoFirst(q.pno) !== pl + (k - pk)) break; // 不再接續（「1-2」的下一頁要接在 2 之後）
    pk = k; pl = pnoLast(q.pno);
    setPno(is, q, shiftPno(q.pno, delta)); n++;
  }
  PV.junc = pnoJunctions(is); pvRender();
  toast(`已修正 ${n} 頁的頁碼`);
}
function refreshAllPno() { PV.junc = pnoJunctions(issue()); Object.keys(rowRefs).forEach(k => updateRowSummary(+k)); }
function pnoRunLength(i) {
  const is = issue(); let n = 0, pk = -1, pl = 0;
  for (let k = i; k < is.pages.length; k++) { const q = is.pages[k]; if (!isNumPno(q.pno)) continue; if (pk >= 0 && pnoFirst(q.pno) !== pl + (k - pk)) break; pk = k; pl = pnoLast(q.pno); n++; }
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
// 離開頁面時同步送出尚未存的逐頁資料（不等 PV.saving）；回傳 false 表示資料太大、可能送不完
function recFlushUnload() {
  clearTimeout(PV.timer);
  let ok = true;
  [...PV.dirty].forEach(is => {
    const body = JSON.stringify(is.rec);
    if (body === is.recSaved) return;
    const params = { book: is.id, data: body };
    if (encLen(params) >= 60000) ok = false;
    api('savePageRec.php', params, { keepalive: true }).then(() => { is.recSaved = body; }).catch(() => {});
  });
  PV.dirty.clear();
  return ok;
}

/* ---------- AI 分析 ---------- */
function toRec(res) {
  const list = (res.articles || []).filter(a => a.title);
  if (!list.length) return blankRec();
  const a = list[0], pick = x => ({ title: x.title || '', column: x.column_name || '', author: x.author || '', role: x.author_role || '' });
  const r = { ...blankRec(), ...pick(a), own: true, ad: !!a.is_ad };
  r.unsure = (a.uncertain || []).map(k => (k === 'column_name' ? 'column' : k));
  r.more = []; // AI 辨識到同一頁有多個題名時，只採用第一個；其他題名不再自動新增子列，需要時由使用者按「＋」自行新增
  r.ai = pick(a);
  r.titleRaw = r.title; r.sectionPrinted = String(a.section_title || '').trim(); // 欄目標題：AI 只回報這一頁印出來的，題名的組合由 applySectionCarry 負責
  Object.defineProperty(r, 'cands', { value: { alts: a.alts || [], diff: a.diff || [] }, enumerable: false, writable: true });
  return r;
}
const RETRYABLE = /頻繁|忙碌|high demand|連線/; // 「今天的免費額度已用完」不重試，重試也沒有用
async function callAnalyze(is, params) {
  if (params.engine !== 'local' && !hasKey()) { openAiDlg('請先輸入您的 Gemini API 金鑰，才能使用 AI 辨識。'); throw new Error('尚未設定 AI 金鑰'); }
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
const analyzeOne = async (is, p) => { const res = await callAnalyze(is, { page: p.label, mode: 'page', ...engineParam(), ...firstParam(is, [p]) }); const r = toRec(res); carryPnoFlags(is.rec[p.label], r); applyAiPno(is, p, r, res.printed_page, res.model); return r; };

const engineParam = () => (PV.engine === 'local' ? { engine: 'local' } : {});
// 這一批的第一張是整本資料的第一頁時，告訴 AI（用來判斷封面）
const firstParam = (is, group) => (is.pages.length && group.length && group[0].label === is.pages[0].label ? { first: '1' } : {});
const GROUP = 4; // 每次請求送幾頁；免費額度是限制「請求次數」，多頁合併可以大幅節省
// 把這一批的清單列標成「分析中」（只更新樣式，不重畫清單，避免打斷正在編輯的欄位）
function markWorking(is, group, b) {
  if (is !== issue()) return;
  group.forEach(p => {
    const i = is.pages.indexOf(p), ref = rowRefs[i]; if (!ref) return;
    ref.row.classList.toggle('ai-working', b.active.has(p.label)); updateRowSummary(i);
  });
}
// 線裝書：葉次有些頁辨識得到、有些頁讀不到。已讀到的頁碼若和影像順序呈固定差距（例如第 2 張是 1、第 4 張是 3），
// 就把「夾在兩個同差距頁碼之間、還沒有頁碼」的頁依序補上（標為「自動接續」，之後仍可核對、修改）
function fillPnoByOffset(is) {
  const P = is.pages, anchors = [];
  P.forEach((p, i) => { const r = is.rec[p.label]; if (r && r.pnoAi && /^\d+$/.test(p.pno || '')) anchors.push({ i, off: +p.pno - i }); });
  let n = 0;
  for (let a = 0; a + 1 < anchors.length; a++) {
    const x = anchors[a], y = anchors[a + 1];
    if (x.off !== y.off || y.i - x.i < 2) continue;
    for (let i = x.i + 1; i < y.i; i++) {
      const p = P[i], r = is.rec[p.label];
      if (p.pno) continue;
      setPno(is, p, String(i + x.off));
      const rr = r || (is.rec[p.label] = blankRec());
      rr.pnoAi = false; rr.pnoAuto = true; n++;
    }
  }
  if (n) { recSaveSoon(is); PV.junc = pnoJunctions(is); pvRender({ keepScroll: true }); toast('線裝書：已依葉次的規律補上 ' + n + ' 頁頁碼（標為「自動」，請核對）'); }
}
async function runBatch(redo) {
  const is = issue();
  if (PV.batch || !is.id) return;
  const todo = is.pages.filter(p => { const r = is.rec[p.label]; return redo ? !(r && r.ok) : !r; });
  if (!todo.length) { toast('沒有需要分析的頁面'); return; }
  const groups = [];
  const gsz = PV.engine === 'local' ? 2 : GROUP; // 本機 OCR 一次兩頁，進度條走得比較順
  for (let k = 0; k < todo.length; k += gsz) groups.push(todo.slice(k, k + gsz));
  const b = PV.batch = { is, total: todo.length, done: 0, fail: [], stop: false, error: '', models: new Set(), active: new Set() };
  let next = 0;
  const worker = async () => {
    while (!b.stop && next < groups.length) {
      const g = groups[next++];
      g.forEach(p => b.active.add(p.label)); markWorking(is, g, b); // 這一批開始：清單上標示「分析中」
      try {
        const res = await callAnalyze(is, { pages: JSON.stringify(g.map(p => p.label)), mode: 'batch', ...engineParam(), ...firstParam(is, g) });
        if (res.model) b.models.add(res.model);
        g.forEach(p => { const x = res.pages && res.pages[p.label]; if (x) { const old = is.rec[p.label], nr = toRec(x); carryPnoFlags(old, nr); is.rec[p.label] = nr; applyAiPno(is, p, nr, x.printed_page, res.model); } else b.fail.push(p.label); });
      } catch (e) {
        g.forEach(p => b.fail.push(p.label)); b.error = e.message;
        if (/今天的免費額度|金鑰|尚未設定|API key|PERMISSION|UNAUTHENTICATED|沒有啟動/i.test(e.message)) { b.stop = true; if (/API key|PERMISSION|UNAUTHENTICATED|金鑰無效/i.test(e.message)) openAiDlg('這把金鑰無法使用：' + e.message); }
      }
      g.forEach(p => { b.active.delete(p.label); PV.flash.add(p.label); }); // 這一批完成：之後重畫時淡淡閃一下
      b.done += g.length; recSaveSoon(is);
      aiScan($('pvViewer'), true, `AI 分析中 ${b.done}／${b.total}`);
      if (is === issue()) pvRender({ keepScroll: true });
    }
  };
  pvRender({ keepScroll: true });
  aiScan($('pvViewer'), true, `AI 分析中 0／${b.total}`);
  await Promise.all(PV.engine === 'local' ? [worker()] : [worker(), worker()]); // API：同時 2 組，避免超過每分鐘請求數；本機 OCR 吃 CPU，一次一組
  PV.batch = null; aiScan($('pvViewer'), false); applySectionCarry(is); recFlush();
  if (isThread(is) && !b.stop) fillPnoByOffset(is);
  const left = todo.filter(p => !is.rec[p.label]).length;
  pvRender({ keepScroll: true });
  // 主模型的免費額度用完時會自動改用備援模型（lite）；一般書不採用 lite 的頁碼（常是亂推的），所以這時頁碼會全部空白 → 明確告訴使用者原因
  if (PV.engine !== 'local' && !isThread(is) && [...b.models].some(m => /lite/i.test(m))) showNotice('⚠ 這次用的是備援模型（主模型今天的免費額度已用完），它的頁碼不準，系統沒有採用，所以頁碼是空的。額度恢復後，按「重新分析未確認的頁面」可補上頁碼。');
  if (b.error && left) toast(b.error + `（尚餘 ${left} 頁，已分析的都已保留，之後可按「繼續分析」）`);
  else toast((b.stop ? '已暫停，之後可按「繼續分析」' : left ? `完成，但有 ${left} 頁失敗，可按「繼續分析」重試` : '整期分析完成，請逐頁核對'));
  if (!b.stop && !left && sectionJoiner(is) != null && PV.engine !== 'local') { // B：用目錄頁檢查欄目標題
    toast('正在讀取目錄頁，校正欄目標題…'); const t = await buildTocMap(is); const n = applySectionCarry(is); if (is === issue()) pvRender({ keepScroll: true });
    toast(t.pages ? `已用 ${t.pages} 個目錄頁校正欄目標題（${t.added} 筆對照，${n} 處變動）` : '沒有找到可用的目錄頁，欄目標題是依版面與前一頁判斷的，請逐頁核對');
  }
  if (!b.stop && !left) await pnoRecheck(is);
}
// 頁碼不連續（AI 填的、還沒確認）的頁：用只找頁碼的專用方式（較高解析度、逐半檢查頁眉頁腳）自動重辨一次。
// 只用 API 分析；一次最多重辨 10 頁（每頁一次請求）；結果不同才更新，仍不連續的頁照舊標示給人工核對。
const PNO_RECHECK_MAX = 10;
async function pnoRecheck(is) {
  if (PV.engine === 'local' || PV.rechecking) return;
  PV.junc = pnoJunctions(is);
  const idx = is.pages.map((p, i) => i).filter(i => pnoFlagged(is, i)).slice(0, PNO_RECHECK_MAX);
  if (!idx.length) return;
  PV.rechecking = true;
  let fixed = 0, done = 0;
  try {
    for (const i of idx) {
      const p = is.pages[i], r = is.rec[p.label];
      if (!r || r.ok) continue;
      toast(`頁碼不連續，正在重新辨識頁碼（${++done}／${idx.length}）…`);
      try {
        const res = await callAnalyze(is, { page: p.label, mode: 'pageno' });
        const n = normalizePageNo(res.printed_page);
        if (n && n !== p.pno) { setPno(is, p, n); r.pnoAi = true; r.pnoAuto = false; r.pnoSuggest = ''; fixed++; }
      } catch (e) { toast('重新辨識頁碼中斷：' + e.message); break; }
    }
  } finally { PV.rechecking = false; }
  PV.junc = pnoJunctions(is); recSaveSoon(is);
  if (is === issue()) pvRender({ keepScroll: true });
  const still = is.pages.filter((p, i) => pnoFlagged(is, i)).length;
  toast(fixed ? `已重新辨識頁碼，修正 ${fixed} 頁` + (still ? `；還有 ${still} 頁不連續，請人工核對` : '') : `已重新辨識頁碼，沒有變動；${still} 頁仍不連續，請人工核對`);
}// 分析前先問：API（Gemini）或本機 OCR（免費）
function askEngine() {
  return new Promise(resolve => {
    const d = $('engineDlg'); let pick = null;
    const done = v => { pick = v; resolve(v); if (d.open) d.close(); }; // 不依賴 close 事件，直接回傳選擇
    $('engApi').onclick = () => done('api'); $('engLocal').onclick = () => done('local'); $('engCancel').onclick = () => done(null);
    d.onclose = () => { d.onclose = null; resolve(pick); };
    d.showModal();
  });
}
$('pvBatch').onclick = async () => {
  const is = issue();
  if (!is.id) return toast('請先選擇期刊');
  const eng = await askEngine();
  if (!eng) return;
  PV.engine = eng;
  const unanalyzed = is.pages.filter(p => !is.rec[p.label]).length;
  runBatch(unanalyzed === 0);
};
$('pvToc').onclick = async () => {
  const is = issue(); if (!is.id || sectionJoiner(is) == null) return;
  if (!hasKey()) { openAiDlg('請先輸入您的 Gemini API 金鑰，才能讀取目錄頁。'); return; }
  const btn = $('pvToc'); btn.disabled = true; btn.textContent = '讀取目錄頁…';
  try { PV.engine = 'api'; const t = await buildTocMap(is, true); const n = applySectionCarry(is); pvRender({ keepScroll: true }); toast(t.pages ? `已用 ${t.pages} 個目錄頁校正欄目標題（${t.added} 筆對照，${n} 處變動）` : '這一期沒有找到題名以「目錄」開頭的頁面，請先分析整期'); }
  catch (e) { toast(e.message); }
  btn.disabled = false; btn.textContent = '用目錄校正欄目';
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
  if (src !== PV.lastSrc) { cancelPick(); PV.lastSrc = src; $('pvImg').src = src; }
  $('pvTag').textContent = `第 ${PV.sel + 1} 頁・…${pvTail(p.label)}` + (p.pno ? `・頁碼 ${p.pno}` : '');
}

/* ---------- 清單與編輯 ---------- */
function pvSelect(i, opts = {}) {
  const n = issue().pages.length; if (!n) return;
  PV.sel = Math.max(0, Math.min(n - 1, i)); PV.collapsed = false; PV.sub = null; // 選到另一頁（或用鍵盤換頁）一律展開編輯區
  pvRender(opts);
}
function pvConfirm(i) {
  const p = issue().pages[i], r = pvRec()[p.label];
  if (!r) { pvRec()[p.label] = Object.assign(blankRec(), { ok: true }); }
  else if (r.own && !r.title) { toast('這一頁缺題名：請填寫，或改為「沿用前頁」'); return false; }
  else if (r.own && (r.more || []).some(m => !m.title.trim())) { PV.sub = r.more.findIndex(m => !m.title.trim()); PV.sel = i; PV.collapsed = false; toast('這一張影像有題名空白的題名：請填寫，或刪除它'); pvRender({ keepScroll: true }); return false; }
  else { r.ok = true; (r.more || []).forEach(m => { m.ok = true; }); }
  recSaveSoon(issue());
  propagatePno(i);
  return true;
}
// 找出這筆題名（主題名或子列）屬於哪一張影像：回傳 { label, k, main }，k = -1 是主題名，0 起是第幾個其他題名
function pvFindRec(r) {
  const is = issue();
  for (const label of Object.keys(is.rec)) {
    const x = is.rec[label];
    if (x === r) return { label, k: -1, main: x };
    const k = (x.more || []).indexOf(r);
    if (k >= 0) return { label, k, main: x };
  }
  return null;
}
function touch(r) {
  r.ok = false;
  const f = pvFindRec(r); if (f && f.k >= 0) f.main.ok = false;
  recSaveSoon(issue()); syncRecToEntry(r);
}

/* ---------- 逐頁核對 ⇄ 篇目目錄 雙向同步 ---------- */
// 逐頁核對改了某一頁的題名／作者等 → 即時更新篇目目錄裡「起始影像就是這一頁」的那一筆
// 同一張影像有多筆時，依序對應：主題名＝第 1 筆，第 k 個其他題名＝第 k+2 筆
function syncRecToEntry(r) {
  const is = issue(); if (!is.id || !r.title) return;
  const f = pvFindRec(r); if (!f || (f.k < 0 && !r.own)) return;
  const hits = []; const walkAll = list => list.forEach(n => { if (n.page1 === f.label) hits.push(n); walkAll(n.children); }); walkAll(is.entries);
  const n = hits[f.k + 1]; if (!n) return;
  Object.assign(n, { title: r.title, column: r.column || '', author: r.author || '', role: r.role || '', ad: !!r.ad });
  persist();
}
// 篇目目錄存檔／修改一筆 → 即時更新逐頁核對裡它的起始影像那一頁（視為已確認）
// oldTitle：修改前的題名，用來分辨這筆對應的是這張影像的哪一個題名；這張影像已經有別的題名時，新的一筆會成為「其他題名」（子列）
function syncEntryToRec(n, oldTitle) {
  const is = issue(); if (!is.id || !n.page1 || !is.pages.some(p => p.label === n.page1)) return;
  const f = { title: n.title, column: n.column || '', author: n.author || '', role: n.role || '', ad: !!n.ad };
  const r = is.rec[n.page1];
  if (!r || !r.own || !r.title) {
    const x = r || (is.rec[n.page1] = blankRec());
    Object.assign(x, f, { own: true, ok: true, unsure: [] });
  } else {
    const key = oldTitle != null ? oldTitle : n.title;
    r.more = r.more || [];
    const m = r.title === key ? null : r.more.find(x => x.title === key);
    if (r.title === key) Object.assign(r, f, { ok: true, unsure: [] });
    else if (m) Object.assign(m, f, { ok: true });
    else if (r.more.length < 6) r.more.push({ ...f, ok: true });
    else Object.assign(r, f, { ok: true, unsure: [] });
  }
  recSaveSoon(is);
}

function pnoField(i) {
  const is = issue(), p = is.pages[i], r = is.rec[p.label];
  const f = h('div', 'f full');
  const lab = h('label', '', '頁碼（印在書上的數字）');
  if (r && r.pnoAi && p.pno) lab.append(h('span', 'unsure-tag', 'AI 辨識，請核對'));
  if (r && r.pnoAuto && p.pno) lab.append(h('span', 'unsure-tag auto-tag', '自動接續'));
  const row = h('div', 'pno-row');
  const inp = h('input'); inp.type = 'text'; inp.inputMode = 'text'; // 跨頁要能輸入「1-2」 inp.value = p.pno || ''; inp.placeholder = '無頁碼'; inp.dataset.k = 'pno';
  const commit = () => {
    const n = normalizePageNo(inp.value);
    if (n === null) { toast('頁碼請填數字（中文數字、羅馬數字會自動換成阿拉伯數字）'); inp.value = p.pno || ''; return; }
    if (n !== (p.pno || '')) { setPno(is, p, n); if (r) { r.pnoAi = false; r.pnoAuto = false; r.pnoSuggest = ''; recSaveSoon(is); } }
    inp.value = n; lab.querySelector('.unsure-tag')?.remove(); refreshAllPno(); pvShowImage();
  };
  inp.onchange = commit;
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); if (pvConfirm(i)) pvSelect(i + 1); }
    if (e.key === 'Escape') inp.blur();
  };
  const plus = h('button', 'link-btn', '接續前頁 +1'); plus.type = 'button';
  plus.onclick = () => { const q = is.pages[i - 1]; if (!q || !isNumPno(q.pno)) return toast('前一頁沒有數字頁碼'); inp.value = String(pnoLast(q.pno) + 1); commit(); };
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
  const sg = pnoSuggested(is, i);
  if (sg) {
    const hint = h('div', 'pv-hint full pno-warn');
    hint.append(h('div', '', `AI 這次辨識到的頁碼是 ${sg}，目前是 ${p.pno}。請對照影像決定要不要改。`));
    const bar = h('div', 'pv-acts'); bar.style.marginTop = '6px';
    const use = h('button', 'btn primary', `改成 ${sg}`); use.type = 'button';
    use.onclick = () => { setPno(is, p, sg); r.pnoSuggest = ''; r.pnoAi = false; r.pnoAuto = false; recSaveSoon(is); PV.junc = pnoJunctions(is); pvRender(); };
    const skip = h('button', 'btn', `保留 ${p.pno}`); skip.type = 'button';
    skip.onclick = () => { r.pnoSuggest = ''; recSaveSoon(is); pvRender(); };
    bar.append(use, skip); hint.append(bar); frag.append(hint);
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
    one.onclick = async () => { const eng = await askEngine(); if (!eng) return; PV.engine = eng; one.disabled = true; one.textContent = '辨識中…'; aiScan($('pvViewer'), true); try { is.rec[p.label] = await analyzeOne(is, p); applySectionCarry(is); recSaveSoon(is); } catch (e) { toast(e.message); } aiScan($('pvViewer'), false); pvRender(); };
    const man = h('button', 'btn', '手動填寫'); man.type = 'button';
    man.onclick = () => { is.rec[p.label] = { ...blankRec(), own: true }; recSaveSoon(is); pvRender({ focus: true }); };
    const inh = h('button', 'btn', i === 0 ? '前面沒有標題' : '沿用前頁'); inh.type = 'button';
    inh.onclick = () => { is.rec[p.label] = blankRec(); recSaveSoon(is); pvRender(); };
    acts.append(one, man, inh); wrap.append(acts);
    return wrap;
  }
  const refresh = () => { updateRowSummary(i); };
  if (!r.own) {
    const res = pvResolved(i);
    wrap.append(h('div', 'pv-hint full', i === 0 ? '這是第一頁，前面沒有任何一頁，沒有標題可以沿用。若這一頁是封面或有標題，請按「這頁有新標題」，或按「重新分析這一頁」讓 AI 判斷是否為封面。' : (res ? `↳ 這一頁沒有新標題，歸入前面的「${res.title}」。` : '↳ 這一頁沒有新標題，但前面也沒有標題可以沿用。')));
  } else {
    if (r.sectionSrc && r.sectionSrc !== 'printed' && r.section) { // 欄目標題不是這一頁印出來的：請館員核對
      const msg = r.sectionSrc === 'carried' ? `欄目標題「${r.section}」是沿用前面頁面的（這一頁沒有印出欄目標題），請核對；不對就直接修改題名。` : r.sectionSrc === 'toc' ? `欄目標題「${r.section}」來自本期目錄（這一頁沒有印出），請核對。` : `已依目錄校正欄目：${r.sectionNote}。請核對。`;
      wrap.append(h('div', 'pv-hint full', msg));
    }
    const field = (label, key, full) => {
      const f = h('div', 'f' + (full ? ' full' : '') + (r.unsure.includes(key) ? ' unsure' : ''));
      const lab = h('label', '', label); if (r.unsure.includes(key)) lab.append(h('span', 'unsure-tag', 'AI 不確定'));
      const inp = h('input'); inp.type = 'text'; inp.value = r[key] || ''; inp.dataset.k = key;
      inp.oninput = () => { r[key] = inp.value; touch(r); refresh(); };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (pvConfirm(i)) pvSelect(i + 1); } if (e.key === 'Escape') inp.blur(); };
      const row = h('div', 'fi-row'); row.append(aiPickBtn(key, inp, r, refresh), inp); f.append(lab, row); return f;
    };
    const titleField = field('主要題名', 'title', true);
    const titleInp = titleField.querySelector('input');
    const candBox = h('div', 'cands'); titleField.append(candBox);
    const showCands = () => renderCands(candBox, r.cands, () => r.title || '', v => { titleInp.value = v; r.title = v; touch(r); refresh(); });
    showCands(); titleInp.addEventListener('input', showCands);
    wrap.append(titleField, field('作者', 'author'), field('專欄名稱', 'column'));
    const adl = h('label', 'f'); const cb = h('input'); cb.type = 'checkbox'; cb.checked = !!r.ad; cb.onchange = () => { r.ad = cb.checked; touch(r); refresh(); };
    adl.style.flexDirection = 'row'; adl.style.alignItems = 'center'; adl.style.gap = '6px'; adl.append(cb, document.createTextNode('廣告／啟事'));
    const rl = field('作者角色（如「譯」）', 'role'); wrap.append(rl, adl);
  }
  const acts = h('div', 'pv-acts full');
  const ok = h('button', 'btn primary'); ok.type = 'button'; ok.innerHTML = '確認，下一頁 <kbd>Enter</kbd>';
  ok.onclick = () => { if (pvConfirm(i)) pvSelect(i + 1); };
  const tog = h('button', 'btn', r.own ? '改為沿用前頁' : '這頁有新標題'); tog.type = 'button';
  tog.hidden = i === 0 && r.own; // 第一頁沒有前一頁，不能改為沿用前頁
  tog.onclick = () => { r.own = !r.own; touch(r); pvRender({ focus: r.own }); };
  acts.append(ok, tog);
  const re = h('button', 'btn', '重新分析這一頁'); re.type = 'button';
  re.onclick = async () => {
    const eng = await askEngine();   // 先問：API（Gemini）或本機 OCR
    if (!eng) return;
    if ((r.ok || (r.more || []).length) && !confirm('這一頁已確認過或有多個題名，重新分析會覆蓋目前的題名、作者等內容（包含新增的題名）。確定重新分析？')) return;
    PV.engine = eng;
    re.disabled = true; re.textContent = '辨識中…'; aiScan($('pvViewer'), true);
    try { const nr = await analyzeOne(is, p); is.rec[p.label] = nr; applySectionCarry(is); recSaveSoon(is); syncRecToEntry(nr); toast('已重新分析這一頁'); } catch (e) { toast(e.message); }
    aiScan($('pvViewer'), false);
    pvRender({ focus: true });
  };
  acts.append(re);
  if (r.ai && r.own) {
    const rev = h('button', 'btn', '還原 AI 結果'); rev.type = 'button';
    rev.onclick = () => { Object.assign(r, r.ai); touch(r); pvRender(); };
    acts.append(rev);
  }
  wrap.append(acts);
  return wrap;
}

// 同一張影像的其他題名（子列）的編輯區
function pvSubEditor(i, k) {
  const is = issue(), p = is.pages[i], r = is.rec[p.label], m = r.more[k];
  const wrap = h('div', 'pv-edit'); wrap.onclick = e => e.stopPropagation();
  const refresh = () => updateSubRow(i, k);
  const goNext = () => { if (k + 1 < r.more.length) { PV.sub = k + 1; PV.collapsed = false; pvRender({ keepScroll: true, focus: true }); } else if (pvConfirm(i)) pvSelect(i + 1); };
  const confirmSub = () => { if (!m.title.trim()) { toast('題名不能空白：請填寫，或刪除這個題名'); return; } m.ok = true; recSaveSoon(is); goNext(); };
  const field = (label, key, full) => {
    const f = h('div', 'f' + (full ? ' full' : '')), lab = h('label', '', label);
    const inp = h('input'); inp.type = 'text'; inp.value = m[key] || ''; inp.dataset.k = key;
    inp.oninput = () => { m[key] = inp.value; touch(m); refresh(); };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); confirmSub(); } if (e.key === 'Escape') inp.blur(); };
    const row = h('div', 'fi-row'); row.append(aiPickBtn(key, inp, m, refresh), inp); f.append(lab, row); return f;
  };
  wrap.append(h('div', 'pv-hint full', `這是影像 ${i + 1} 上的第 ${k + 2} 個題名（和上一列是同一張影像，右邊顯示的是同一張圖）。`));
  wrap.append(field('題名', 'title', true), field('作者', 'author'), field('專欄名稱', 'column'), field('作者角色（如「譯」）', 'role'));
  const adl = h('label', 'f'); const cb = h('input'); cb.type = 'checkbox'; cb.checked = !!m.ad; cb.onchange = () => { m.ad = cb.checked; touch(m); refresh(); };
  adl.style.flexDirection = 'row'; adl.style.alignItems = 'center'; adl.style.gap = '6px'; adl.append(cb, document.createTextNode('廣告／啟事'));
  wrap.append(adl);
  const acts = h('div', 'pv-acts full');
  const ok = h('button', 'btn primary'); ok.type = 'button'; ok.innerHTML = (k + 1 < r.more.length ? '確認，下一個題名' : '確認，下一頁') + ' <kbd>Enter</kbd>';
  ok.onclick = confirmSub;
  const del = h('button', 'btn danger', '刪除這個題名'); del.type = 'button';
  del.onclick = () => { r.more.splice(k, 1); PV.sub = null; recSaveSoon(is); pvRender({ keepScroll: true }); toast('已刪除這個題名（篇目目錄裡已存在的那一筆不會被刪除）'); };
  acts.append(ok, del); wrap.append(acts);
  return wrap;
}
const subRefs = {};
function updateSubRow(i, k) {
  const ref = subRefs[i + '-' + k], r = pvRec()[issue().pages[i].label], m = r && r.more && r.more[k]; if (!ref || !m) return;
  ref.tt.className = 'pv-tt'; ref.tt.textContent = m.title || '（請補題名）';
  ref.sub.textContent = [m.column, m.author, m.ad ? '廣告' : ''].filter(Boolean).join('・') || '—';
  const st = subStatus(m); ref.badge.className = 'badge b-' + st; ref.badge.textContent = ST_LABEL[st];
  updateRowSummary(i); // 影像本身的狀態（所有題名都確認才算已確認）
}
// 新增題名：貼在目前這一頁左側的藍色直線上（蘋果風格的圓形「＋」）
function addTitleBtn(i, r) {
  const b = h('button', 'add-title-btn'); b.type = 'button';
  b.title = '新增題名：這張影像上還有另一個題名（例如同一頁有兩篇）'; b.setAttribute('aria-label', '新增題名');
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';
  b.onclick = e => { e.stopPropagation(); r.more = r.more || []; r.more.push(blankSub()); r.ok = false; PV.sel = i; PV.sub = r.more.length - 1; PV.collapsed = false; recSaveSoon(issue()); pvRender({ focus: true }); };
  return b;
}
function pvSubRow(i, k, m) {
  const is = issue(), p = is.pages[i], sel = i === PV.sel && PV.sub === k;
  const row = h('div', 'pv-row sub' + (sel ? ' sel' : '')); row.dataset.i = i; row.dataset.k = k;
  const pg = h('div', 'pv-pg', `${i + 1}-${k + 2}`); pg.append(h('small', '', pvTail(p.label)));
  const mid = h('div'), tt = h('div', 'pv-tt'), sub = h('div', 'pv-sub'), badge = h('span', 'badge');
  mid.append(tt, sub); row.append(pg, h('div', 'pv-pno none', ''), mid, badge);
  subRefs[i + '-' + k] = { tt, sub, badge }; updateSubRow(i, k);
  if (sel && !PV.collapsed) row.append(pvSubEditor(i, k));
  if (sel) row.title = PV.collapsed ? '點一下展開編輯區' : '點一下收合編輯區';
  row.onclick = () => { if (sel) PV.collapsed = !PV.collapsed; else { PV.sel = i; PV.sub = k; PV.collapsed = false; } pvRender({ keepScroll: true }); };
  return row;
}

/* ---------- 欄目標題（只有 config.php 的 SECTION_TITLE_BOOKS 裡的刊物）----------
   題名 = 欄目標題 + 連接符號 + 篇名（例：「一、專題研究 - 共匪的核子研究」）。
   A：AI 回報「這一頁版面印出來的」欄目標題（sectionPrinted）；沒印的頁面，延用前面最近一頁的欄目。
   B：用目錄頁（目錄對照 tocMap）檢查：目錄上這一篇所屬的欄目和目前採用的不同，就以目錄為準並標示；沒有欄目就補上。
   題名被使用者改過（和 AI 的篇名、系統組合的題名都不同）就不再自動改。 */
function sectionJoiner(is) { const m = window.SECTION_BOOKS || {}; const k = Object.keys(m).find(n => is.id.includes(n)); return k ? m[k] : null; }
const secKey = s => String(s || '').normalize('NFKC').replace(/^[一二三四五六七八九十0-9]+[、．.\s]*/, '').replace(/[\s\p{P}\p{S}]+/gu, '');
const secSim = (a, b) => { a = [...a]; b = [...b]; const m = Math.max(a.length, b.length); if (!m) return 1; let prev = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return 1 - prev[b.length] / m; };
function tocLookup(is, raw) { // 目錄上最像這個篇名的一筆（相似度 ≥ 0.75）
  const k = secKey(raw); if (!k || !is.tocMap || !is.tocMap.length) return null;
  let best = null, bs = 0; for (const e of is.tocMap) { const s = secSim(k, secKey(e.title)); if (s > bs) { bs = s; best = e; } }
  return best && bs >= 0.75 ? best : null;
}
// 依頁面順序重新計算每一篇的欄目標題與題名。回傳有變動的頁數。
function applySectionCarry(is) {
  const joiner = sectionJoiner(is); if (joiner == null) return 0;
  let last = '', changed = 0;
  for (const p of is.pages) {
    const r = is.rec[p.label]; if (!r || !r.own) continue;
    if (!r.titleRaw) { if (r.sectionPrinted) last = r.sectionPrinted; continue; } // 手動填寫的：不組合題名
    const raw = r.titleRaw, printed = String(r.sectionPrinted || '').trim();
    let section = printed, src = printed ? 'printed' : '', note = '';
    if (printed) last = printed; else if (last) { section = last; src = 'carried'; }
    const hit = tocLookup(is, raw);
    if (hit) {
      if (!section) { section = hit.section; src = 'toc'; note = '目錄上這一篇屬於「' + hit.section + '」'; }
      else if (secKey(hit.section) !== secKey(section)) { note = '目錄上這一篇屬於「' + hit.section + '」，原本是「' + section + '」'; section = hit.section; src = 'toc-fix'; }
      else note = '與目錄相符';
      last = section;
    }
    const compose = section && !raw.startsWith(section) ? section + joiner + raw : raw;
    const unedited = r.title === raw || r.title === r.titleAuto || !r.title;
    if (unedited && r.title !== compose) { r.title = compose; changed++; }
    if (unedited) r.titleAuto = compose;
    if (r.section !== section || r.sectionSrc !== src || r.sectionNote !== note) { r.section = section; r.sectionSrc = src; r.sectionNote = note; changed++; }
  }
  if (changed) recSaveSoon(is);
  return changed;
}
// B：找出目錄頁（題名以「目錄」開頭），用「分析目錄」讀出欄目與篇名的對照，存起來。force＝重新分析所有目錄頁
async function buildTocMap(is, force) {
  if (sectionJoiner(is) == null) return { pages: 0, added: 0 };
  const done = new Set(force ? [] : (is.tocMap || []).map(e => e.tocPage));
  const tocPages = is.pages.filter(p => { const r = is.rec[p.label]; return r && r.own && /^目錄/.test(r.titleRaw || r.title || '') && !done.has(p.label); }).slice(0, 15);
  const keep = (is.tocMap || []).filter(e => !force && !tocPages.some(p => p.label === e.tocPage)); let added = 0; const fresh = [];
  for (const p of tocPages) {
    let res; try { res = await callAnalyze(is, { page: p.label, mode: 'toc', ...engineParam() }); } catch (e) { toast('分析目錄頁失敗：' + e.message); break; }
    const ents = (res.entries || []).filter(e => e.title); if (!ents.some(e => e.level === 0) || !ents.some(e => e.level === 1)) continue; // 沒有「欄目 → 篇名」兩層就不用
    let sec = ''; for (const e of ents) { if (e.level === 0) sec = e.title; else if (sec) { fresh.push({ tocPage: p.label, section: sec, title: e.title }); added++; } }
  }
  if (tocPages.length) { is.tocMap = [...keep, ...fresh]; try { await api('saveTocMap.php', { book: is.id, data: JSON.stringify(is.tocMap) }); } catch (e) { toast('目錄對照存檔失敗：' + e.message); } }
  return { pages: tocPages.length, added };
}

const rowRefs = {};
function updateRowSummary(i) {
  const ref = rowRefs[i]; if (!ref) return;
  const r = pvRec()[issue().pages[i].label], s = pvStatus(i), res = pvResolved(i);
  ref.tt.className = 'pv-tt' + (!r ? ' none' : (!r.own ? ' inh' : ''));
  ref.tt.textContent = !r ? '（尚未分析）' : (r.own ? (r.title || '（請補題名）') : (i === 0 ? '（前面沒有標題）' : '↳ ' + (res ? res.title : '（前面沒有標題）')));
  ref.sub.textContent = r && r.own ? ([r.column, r.author, r.ad ? '廣告' : ''].filter(Boolean).join('・') || '—') : '';
  const working = PV.batch && PV.batch.is === issue() && PV.batch.active && PV.batch.active.has(issue().pages[i].label);
  ref.badge.className = 'badge b-' + (working ? 'working' : s); ref.badge.textContent = working ? '分析中' : ((i === 0 && s === 'inh') ? '無標題' : ST_LABEL[s]);
  const pn = issue().pages[i].pno, fl = pnoFlagged(issue(), i), sg = pnoSuggested(issue(), i); ref.pno.textContent = pn || '—'; ref.pno.className = 'pv-pno' + (pn ? '' : ' none') + (fl ? ' warn' : '') + (r && r.pnoAuto && pn ? ' auto' : '') + (sg ? ' sugg' : ''); if (sg) ref.pno.dataset.sugg = sg; else delete ref.pno.dataset.sugg; ref.pno.title = fl ? `頁碼和前面不連續（照順序應為 ${fl.expected}），可能是辨識錯誤` : pn ? '印在書上的頁碼：' + pn : '沒有頁碼';
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
  if (opts.focus) PV.collapsed = false;
  const is = issue(), box = $('pvRows'), top = box.scrollTop;
  const n = is.pages.length;
  PV.sel = Math.min(PV.sel, Math.max(0, n - 1));
  PV.junc = pnoJunctions(is);
  $('dataType').value = dataType(is); $('dataType').disabled = !is.id; $('pvToc').hidden = sectionJoiner(is) == null;
  const sc = suggCount(); $('pvAdoptAll').hidden = !sc; $('pvAdoptAll').textContent = '採用全部 AI 頁碼建議（' + sc + '）';
  const c = pvProgress();
  // 統計卡
  $('stTotal').textContent = n; $('stOk').textContent = c.ok; $('stOkPct').textContent = (n ? Math.round(c.ok / n * 100) : 0) + '%';
  $('stRev').textContent = c.review; $('stBad').textContent = '缺題名 ' + c.bad; $('stInh').textContent = c.inh; $('stNone').textContent = '未分析 ' + c.none;
  // 頂端按鈕
  const b = PV.batch && PV.batch.is === is ? PV.batch : null;
  $('pvStop').hidden = !b; $('pvBatch').disabled = !!b || !n; $('pvBatch').classList.toggle('loading', !!b); $('app').classList.toggle('batch-running', !!b);
  $('pvBatch').textContent = b ? `分析中 ${b.done}／${b.total}` : (c.none === n ? `分析整期（${n} 頁）` : c.none > 0 ? `繼續分析（尚餘 ${c.none} 頁）` : '重新分析未確認的頁面');
  // 篩選
  const fb = $('pvFilters'); fb.replaceChildren();
  [['all', '全部', n], ['none', '未分析', c.none], ['review', '待檢查', c.review], ['inh', '沿用前頁', c.inh], ['bad', '缺題名', c.bad], ['ok', '已確認', c.ok], ['sugg', 'AI 頁碼建議', suggCount()], ['jump', '頁碼不連續', is.pages.filter((p, i) => pnoFlagged(is, i)).length], ['nopno', '無頁碼', is.pages.filter(p => !p.pno).length]].forEach(([k, l, cnt]) => {
    const chip = h('button', 'chip', `${l} ${cnt}`); chip.type = 'button'; chip.setAttribute('aria-pressed', PV.filter === k);
    chip.onclick = () => { PV.filter = k; pvRender(); }; fb.append(chip);
  });
  // 清單
  box.replaceChildren();
  for (const k in rowRefs) delete rowRefs[k];
  for (const k in subRefs) delete subRefs[k];
  { const sr = is.rec[(is.pages[PV.sel] || {}).label]; if (PV.sub != null && !(sr && sr.own && sr.more && PV.sub < sr.more.length)) PV.sub = null; }
  if (!n) box.append(h('div', 'empty', is.id ? '這一期沒有影像。請把圖檔放進 img 資料夾裡這一期的資料夾。' : '請先在左下角的「資料」選單選擇一筆資料。'));
  is.pages.forEach((p, i) => {
    const s = pvStatus(i);
    if (PV.filter !== 'all' && s !== PV.filter && !(PV.filter === 'nopno' && !p.pno) && !(PV.filter === 'jump' && pnoFlagged(is, i)) && !(PV.filter === 'sugg' && pnoSuggested(is, i)) && i !== PV.sel) return;
    const working = PV.batch && PV.batch.is === is && PV.batch.active && PV.batch.active.has(p.label);
    const row = h('div', 'pv-row' + (i === PV.sel && PV.sub == null ? ' sel' : '') + (working ? ' ai-working' : '') + (PV.flash.has(p.label) ? ' ai-done' : '')); row.dataset.i = i;
    const pg = h('div', 'pv-pg', String(i + 1)); pg.append(h('small', '', pvTail(p.label)));
    const mid = h('div'), tt = h('div', 'pv-tt'), sub = h('div', 'pv-sub'), badge = h('span', 'badge');
    const pno = h('div', 'pv-pno'); mid.append(tt, sub); row.append(pg, pno, mid, badge);
    rowRefs[i] = { tt, sub, badge, pno, row }; updateRowSummary(i);
    const mainSel = i === PV.sel && PV.sub == null;
    if (mainSel && !PV.collapsed) row.append(pvEditor(i));
    if (mainSel) row.title = PV.collapsed ? '點一下展開編輯區' : '點一下收合編輯區';
    row.onclick = () => { if (mainSel) { PV.collapsed = !PV.collapsed; pvRender({ keepScroll: true }); } else if (i === PV.sel) { PV.sub = null; PV.collapsed = false; pvRender({ keepScroll: true }); } else pvSelect(i); }; // 再點一次目前這一頁：收合 ⇄ 展開
    const rr = is.rec[p.label];
    if (i === PV.sel && rr && rr.own && (rr.more || []).length < 6) row.append(addTitleBtn(i, rr)); // 目前這一頁：藍色直線上的「＋」，新增這張影像的另一個題名
    box.append(row);
    if (rr && rr.own && rr.more) rr.more.forEach((m, k) => box.append(pvSubRow(i, k, m))); // 同一張影像的其他題名：接在這一頁下面
  });
  PV.flash.clear();
  pvShowImage();
  const selRow = box.querySelector('.pv-row.sel');
  if (opts.focus && selRow) selRow.querySelector('input[type="text"]')?.focus();
  if (opts.keepScroll) box.scrollTop = top;
  else if (selRow) { const r = selRow.getBoundingClientRect(), br = box.getBoundingClientRect(); if (r.top < br.top || r.bottom > br.bottom) selRow.scrollIntoView({ block: 'nearest' }); else box.scrollTop = top; }
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
      if (cur && cur.title === r.title && cur.author === r.author) cur.page2 = p.label; // 同題名同作者的連續頁併成一筆
      else { cur = { id: uid(), title: r.title, column: r.column, ad: !!r.ad, author: r.author, role: r.role, page1: p.label, page2: p.label, pageList: [], collapsed: false, children: [] }; entries.push(cur); }
      // 同一張影像的其他題名：各自一筆（只在這張影像）；後面「沿用前頁」的頁接在最後一個題名之後
      (r.more || []).filter(m => m.title).forEach(m => {
        cur = { id: uid(), title: m.title, column: m.column || '', ad: !!m.ad, author: m.author || '', role: m.role || '', page1: p.label, page2: p.label, pageList: [], collapsed: false, children: [] };
        entries.push(cur);
      });
    } else if (cur) cur.page2 = p.label;
    else orphan++;
  });
  if (orphan) notes.push(`開頭 ${orphan} 頁沒有標題可歸屬，不會出現在篇目裡`);
  const msg = `將產生 ${entries.length} 筆篇目` + (is.entries.length ? `，並取代目前篇目目錄裡的 ${is.entries.length} 筆（含層級與排序）` : '') + '。' + (notes.length ? '\n\n注意：\n・' + notes.join('\n・') : '') + '\n\n確定套用？';
  if (!confirm(msg)) return;
  is.entries = entries; selectedId = null; sortEntries(is.entries, is.pages);
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
const dataType = is => { const m = is.meta || {}; return m['資料類型'] || (m['線裝書'] === '是' ? '線裝書' : '期刊'); };
const isThread = is => dataType(is) === '線裝書';

function toastUndo(msg, undo) {
  const t = $('toast');
  t.replaceChildren(document.createTextNode(msg + '　'));
  const b = h('button', 'link-btn', '復原'); b.type = 'button';
  b.style.color = 'inherit'; b.style.textDecoration = 'underline';
  b.onclick = () => { undo(); t.hidden = true; };
  t.append(b); t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 10000);
}

// 任何一頁按「確認」時，只要這一頁有數字頁碼：同一篇目後面「沿用前頁」的頁，依序更新成 N+1、N+2……（一張影像算一頁）
// 一般書：遇到下一個有新標題的頁就停止（下一篇的首頁不自動接續）；線裝書：葉次一路連續，不受篇目分界影響。遇到還沒分析的頁、或和預期頁碼不吻合的已確認頁就停止。
// 已經有頁碼的頁：只要還沒確認就會被更新（舊資料分不清是人工填或 AI 填的，所以只用「已確認」當保護）；已確認的頁不動。
function propagatePno(i) {
  const is = issue(), P = is.pages, p = P[i], r = is.rec[p.label];
  if (!r || !/^\d+$/.test(p.pno || '')) return;
  const base = +p.pno, snap = [], thread = isThread(is); // 「1-2」這種跨頁不會通過上一行的 ^\d+$ 檢查，所以不自動接續
  for (let k = i + 1; k < P.length; k++) {
    const q = P[k], rq = is.rec[q.label];
    if (!rq) break;                       // 還沒分析的頁：停止
    if (rq.own && !thread) break;         // 一般書：下一篇的首頁不接續；線裝書同一冊葉次連續，繼續往下
    const want = String(base + (k - i));
    if (rq.ok) { if (q.pno === want) continue; break; } // 已確認的頁是定錨：頁碼吻合就繼續；不吻合（可能這裡重新編號）就停止，不硬蓋
    if (q.pno === want) continue;
    snap.push({ label: q.label, pno: q.pno || '', pnoAi: !!rq.pnoAi, pnoAuto: !!rq.pnoAuto, sug: rq.pnoSuggest || '' });
    setPno(is, q, want); rq.pnoAi = false; rq.pnoAuto = true; rq.pnoSuggest = '';
  }
  if (!snap.length) return;
  PV.junc = pnoJunctions(is); recSaveSoon(is); pvRender();
  toastUndo(`已自動接續後面 ${snap.length} 頁的頁碼（${base + 1} 起）`, () => {
    snap.forEach(s0 => { const q = P.find(x => x.label === s0.label), rq = is.rec[s0.label]; setPno(is, q, s0.pno); rq.pnoAi = s0.pnoAi; rq.pnoAuto = s0.pnoAuto; rq.pnoSuggest = s0.sug; });
    PV.junc = pnoJunctions(is); recSaveSoon(is); pvRender();
  });
}

// 一次採用全部 AI 頁碼建議（已確認的頁不動）；採用的頁碼標「AI 辨識，請核對」，並可復原
function adoptAllSuggestions() {
  const is = issue(), snap = [];
  is.pages.forEach((p, i) => {
    const sg = pnoSuggested(is, i), r = is.rec[p.label]; if (!sg) return;
    snap.push({ label: p.label, pno: p.pno, pnoAi: !!r.pnoAi, pnoAuto: !!r.pnoAuto, sug: r.pnoSuggest });
    setPno(is, p, sg); r.pnoSuggest = ''; r.pnoAi = true; r.pnoAuto = false;
  });
  if (!snap.length) return;
  recSaveSoon(is); PV.junc = pnoJunctions(is); pvRender();
  toastUndo(`已採用 ${snap.length} 頁的 AI 頁碼建議`, () => {
    snap.forEach(s0 => { const q = is.pages.find(x => x.label === s0.label), rq = is.rec[s0.label]; setPno(is, q, s0.pno); rq.pnoAi = s0.pnoAi; rq.pnoAuto = s0.pnoAuto; rq.pnoSuggest = s0.sug; });
    recSaveSoon(is); PV.junc = pnoJunctions(is); pvRender();
  });
}
$('pvAdoptAll').onclick = adoptAllSuggestions;

$('dataType').onchange = () => {
  const is = issue(); if (!is.id) return;
  const t = $('dataType').value, meta = { ...is.meta, '資料類型': t, '線裝書': t === '線裝書' ? '是' : '否' };
  api('saveMeta.php', { book: is.id, meta: JSON.stringify(meta) })
    .then(() => { is.meta = meta; toast('資料類型：' + t + (t === '線裝書' ? '（分析時以中縫版心的頁碼為主；已分析過的頁不會重辨識）' : '')); })
    .catch(e => { toast('存檔失敗：' + e.message); pvRender(); });
};

/* ---------- 框選圖片文字 → AI 辨識填入欄位（欄位左側的彩色「AI」按鈕） ---------- */
function cancelPick() {
  const k = PV.pick; if (!k) return;
  PV.pick = null; k.el.remove(); k.btn.classList.remove('on', 'busy');
  k.box.classList.remove('picking');
}
// 畫面座標（相對 viewer）→ 影像座標，裁成 JPEG（長邊最多 1600），回傳 base64
function cropToB64(x, y, w, h) {
  const img = $('pvImg'), s = pvView.s;
  const sx = Math.max(0, (x - pvView.x) / s), sy = Math.max(0, (y - pvView.y) / s);
  const ex = Math.min(img.naturalWidth, (x + w - pvView.x) / s), ey = Math.min(img.naturalHeight, (y + h - pvView.y) / s);
  const cw = ex - sx, ch = ey - sy; if (cw < 4 || ch < 4) return null;
  const k = Math.min(1, 1600 / Math.max(cw, ch)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(cw * k)); c.height = Math.max(1, Math.round(ch * k));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, sx, sy, cw, ch, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92).split(',')[1];
}
// 框選區域 → 文字：一律使用本機 OCR（不呼叫任何 API、不耗額度）
async function ocrRegion(key, b64) {
  return parse(await api('analyze.php', { book: issue().id, mode: 'ocr', engine: 'local', field: key, image: b64 }), {}).text || '';
}
// 影像檢視器：逐頁核對（pvViewer）與篇目目錄（viewer）各有自己的縮放／旋轉，各自提供「畫面座標 → 裁切」
const pvCtx = () => ({ box: $('pvViewer'), img: $('pvImg'), crop: cropToB64 });
function cropCatalog(x, y, w, h) {
  const img = $('pageImg'), s = view.s, nw = img.naturalWidth, nh = img.naturalHeight;
  const cw = w / s, ch = h / s; if (cw < 4 || ch < 4) return null;
  const k = Math.min(1, 1600 / Math.max(cw, ch)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(cw * k)); c.height = Math.max(1, Math.round(ch * k));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(k, 0, 0, k, 0, 0); g.translate((view.cx - x) / s, (view.cy - y) / s); g.rotate(view.r * Math.PI / 180); g.translate(-nw / 2, -nh / 2); g.drawImage(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.92).split(',')[1];
}
const catalogCtx = () => ({ box: $('viewer'), img: $('pageImg'), crop: cropCatalog });
function startPick(btn, run, vctx) {
  cancelPick();
  vctx = vctx || pvCtx();
  const box = vctx.box;
  if (!vctx.img.naturalWidth) return toast('這一頁的影像還沒載入');
  const el = h('div', 'pv-pick'), hint = h('div', 'pv-pick-hint', '拖曳框選要辨識的文字（可用滾輪放大）・Esc 取消'), sel = h('div', 'pv-sel');
  sel.hidden = true; el.append(hint, sel); box.append(el); box.classList.add('picking'); btn.classList.add('on');
  const k = PV.pick = { btn, el, box, busy: false };
  let st = null;
  const place = (x1, y1, x2, y2) => { sel.style.left = Math.min(x1, x2) + 'px'; sel.style.top = Math.min(y1, y2) + 'px'; sel.style.width = Math.abs(x2 - x1) + 'px'; sel.style.height = Math.abs(y2 - y1) + 'px'; };
  const pos = e => { const r = box.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  el.addEventListener('pointerdown', e => {
    if (k.busy) return;
    e.stopPropagation(); e.preventDefault();
    const [x, y] = pos(e); st = { x, y }; el.setPointerCapture(e.pointerId);
    sel.hidden = false; sel.className = 'pv-sel drawing'; place(x, y, x, y);
  });
  el.addEventListener('pointermove', e => { if (st && !k.busy) { const [x, y] = pos(e); place(st.x, st.y, x, y); } });
  el.addEventListener('pointerup', async e => {
    if (!st || k.busy) return;
    const [x, y] = pos(e), x0 = Math.min(st.x, x), y0 = Math.min(st.y, y), w = Math.abs(x - st.x), hh = Math.abs(y - st.y);
    st = null;
    if (w < 8 || hh < 8) { sel.hidden = true; return; } // 太小視為誤點，讓使用者重框
    const b64 = vctx.crop(x0, y0, w, hh);
    if (!b64) { sel.hidden = true; return toast('框選範圍在影像之外，請重新框選'); }
    k.busy = true; sel.className = 'pv-sel scan'; hint.textContent = 'AI 辨識中…'; btn.classList.add('busy');
    try { await run(b64); } catch (err) { toast(err.message || String(err)); }
    sel.classList.add('done'); hint.textContent = '完成';
    setTimeout(() => { if (PV.pick === k) cancelPick(); }, 700);
  });
}
function aiPickBtn(key, inp, r, refresh, vctx) {
  const b = h('button', 'ai-btn'); b.type = 'button';
  b.innerHTML = '<span class="ai-star" aria-hidden="true"></span>';
  b.title = '框選圖片中的文字，用 AI 辨識後填入這個欄位（本地OCR）'; b.setAttribute('aria-label', 'AI 框選辨識（本地OCR）');
  b.onclick = () => {
    if (PV.pick && PV.pick.btn === b) return cancelPick();
    startPick(b, async b64 => {
      const text = (await ocrRegion(key, b64)).trim();
      if (!text) return toast('框選範圍內沒有辨識到文字，請重新框選');
      inp.value = text;
      if (r) { r[key] = text; touch(r); refresh(); } else inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.classList.add('ai-filled'); setTimeout(() => inp.classList.remove('ai-filled'), 1600);
    }, vctx);
  };
  return b;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && PV.pick && !PV.pick.busy) cancelPick(); });

/* ---------- 載體編目：刊名欄位旁的 AI 按鈕（分析第一頁封面的標題，當作載體的題名；只用本機 OCR） ---------- */
function decorateMeta() {
  const inp = $('metaBody').querySelector('[data-key="刊名"]'); if (!inp) return;
  const stripCover = t => String(t || '').replace(/-封面$/, '');
  const row = h('div', 'fi-row'); inp.parentNode.insertBefore(row, inp);
  const btn = h('button', 'ai-btn'); btn.type = 'button';
  btn.title = '分析第一頁封面的標題，當作這個載體的題名（本地OCR）'; btn.setAttribute('aria-label', 'AI 分析封面題名（本地OCR）');
  btn.innerHTML = '<span class="ai-star" aria-hidden="true"></span>';
  const candBox = h('div', 'cands'); candBox.hidden = true;
  const setVal = v => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); };
  row.append(btn, inp); row.after(candBox);
  btn.onclick = async () => {
    const is = issue();
    if (!is.id || !is.pages.length) return toast('這一筆資料沒有影像');
    btn.classList.add('busy', 'on'); btn.disabled = true;
    try {
      const res = parse(await api('analyze.php', { book: is.id, page: is.pages[0].label, mode: 'page', engine: 'local', first: '1', ...(isThread(is) ? { thread: '1' } : {}) }), {});
      const a = (res.articles || [])[0];
      if (!a || !a.title) { toast('第一頁沒有辨識到封面題名'); return; }
      setVal(stripCover(a.title));
      renderCands(candBox, { alts: (a.alts || []).map(stripCover), diff: [] }, () => inp.value, setVal);
      toast('已填入第一頁封面的題名，請核對');
    } catch (e) { toast(e.message || String(e)); }
    finally { btn.classList.remove('busy', 'on'); btn.disabled = false; }
  };
}
/* ---------- 影像預覽：在「編輯頁碼」「自訂範圍」等清單裡點縮圖，放大檢視 ---------- */
(function () {
  const dlg = $('imgPreview'), img = $('imgPreviewImg'), stage = $('imgStage');
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('.page-row img'); if (!t) return;
    e.preventDefault();
    let label = ''; try { label = new URL(t.src, location.href).searchParams.get('p') || ''; } catch (err) { /* 略過 */ }
    $('imgPreviewCap').textContent = label ? '影像 ' + label : '影像';
    stage.classList.remove('zoomed'); stage.scrollTo(0, 0);
    img.src = t.src;
    if (!dlg.open) dlg.showModal();
  });
  // 點圖片：符合視窗 ⇄ 原始大小（可捲動檢視細節）；點圖片以外的空白處關閉
  img.addEventListener('click', e => { e.stopPropagation(); stage.classList.toggle('zoomed'); stage.scrollTo(0, 0); });
  dlg.addEventListener('click', e => { if (e.target === dlg || e.target === stage) dlg.close(); });
})();
/* ---------- 側欄（窄螢幕為抽屜） ---------- */
(function () {
  const open = v => { document.body.classList.toggle('sb-open', v); $('menuToggle').setAttribute('aria-expanded', String(v)); };
  $('menuToggle').onclick = () => open(!document.body.classList.contains('sb-open'));
  $('sbBackdrop').onclick = () => open(false);
  $('sidebar').addEventListener('click', e => { if (e.target.closest('.sb-item')) open(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') open(false); });
})();
/* ---------- 篇目目錄表單：每個文字欄位也有 AI 框選按鈕（只用本機 OCR） ---------- */
[['fTitle', 'title'], ['fColumn', 'column'], ['fAuthor', 'author'], ['fRole', 'role']].forEach(([id, key]) => {
  const inp = $(id), row = h('div', 'fi-row' + (id === 'fTitle' ? ' fi-top' : ''));
  inp.parentNode.insertBefore(row, inp);
  row.append(aiPickBtn(key, inp, null, null, catalogCtx()), inp);
});
/* ---------- 篇目表單可收合（記住選擇） ---------- */
(function () {
  const form = $('entryForm'), btn = $('formToggle');
  const set = (collapsed, save) => {
    form.classList.toggle('collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.querySelector('span').textContent = collapsed ? '展開' : '收合';
    btn.querySelector('svg').style.transform = collapsed ? 'rotate(180deg)' : '';
    if (save) { try { localStorage.setItem('journal-form-collapsed', collapsed ? '1' : '0'); } catch (e) { /* 略過 */ } }
  };
  let saved = false; try { saved = localStorage.getItem('journal-form-collapsed') === '1'; } catch (e) { /* 略過 */ }
  set(saved, false);
  btn.onclick = () => set(!form.classList.contains('collapsed'), true);
  window.expandEntryForm = () => set(false, false);
})();
updateKeyState();
pvRender();