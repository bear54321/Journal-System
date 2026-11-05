const KEY = 'journal-catalog-proto-v2';
const $ = id => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now() + Math.random().toString(16).slice(2));
const YES_NO = ['目錄顯示', '數位物件前台開放權限', '前台可否下載', '是否製作浮水印'];
const META_GROUPS = [
  ['書目', ['刊名', '報刊名第一字', '報刊第一字筆畫', '關鍵詞主題', '專刊名稱', '刊期', '出版者', '出版地', '卷號', '條碼號']],
  ['出版日期', ['西元出版日期(完整)', '出版年', '出版月', '出版日']],
  ['館藏與開放', ['語言', '典藏單位', '目錄顯示', '數位物件前台開放權限', '數位物件開放限制', '前台可否下載', '是否製作浮水印']]
];
const META_DEFAULT = { '語言': '中文', '典藏單位': '中研院近史所', '目錄顯示': '是', '數位物件前台開放權限': '是', '數位物件開放限制': '限登入/IP範圍', '前台可否下載': '是', '是否製作浮水印': '是', '線裝書': '否' };

/* ---------- 與後端溝通 ---------- */
// 使用者自己的 Gemini 金鑰：只存在這個瀏覽器（localStorage），呼叫 analyze.php 時才帶上
const KEY_STORE = 'journal-gemini-key';
const getUserKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } };
const setUserKey = k => { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); return true; } catch (e) { return false; } };
const api = (ep, data) => fetch(ep, { method: 'POST', body: new URLSearchParams(ep === 'analyze.php' && !(data && data.api_key) && getUserKey() ? { ...data, api_key: getUserKey() } : data) })
  .then(r => r.text().then(t => { if (!r.ok) throw new Error(t || r.status); return t; }));
const parse = (t, fallback) => { try { const v = JSON.parse(t); return v == null ? fallback : v; } catch (e) { return fallback; } };
const imgUrl = (book, label) => 'giveimg.php?b=' + encodeURIComponent(book) + '&p=' + encodeURIComponent(label);

const newIssue = name => ({ id: name, name, meta: { ...META_DEFAULT }, pages: [], entries: [], rec: {}, recSaved: '', loaded: false, saved: '' });
const EMPTY = newIssue('');
let state = { issueId: '', pageIdx: 0, issues: (window.BOOKS || []).map(newIssue) };

// 伺服器是以 uid 為鍵的扁平物件，靠 pid、sort 組成樹；這裡轉成巢狀樹來操作
function toTree(flat) {
  const nodes = {};
  Object.keys(flat).forEach(id => {
    const d = flat[id];
    nodes[id] = { id, title: d.title || '', column: d.column_name || '', ad: parseInt(d.if_cm) > 0, author: d.author || '', role: d.author_app || '',
      page1: d.page1 || '', page2: d.page2 || d.page1 || '', pageList: Array.isArray(d.page_list) ? d.page_list : [],
      collapsed: false, children: [], _sort: parseInt(d.sort) || 0, _pid: d.pid };
  });
  const roots = [];
  Object.values(nodes).forEach(n => {
    const p = nodes[n._pid];
    (p && p !== n ? p.children : roots).push(n); // 頂層（start、0、空）或上層不存在的都放頂層
  });
  const order = list => { list.sort((a, b) => a._sort - b._sort); list.forEach(n => order(n.children)); };
  order(roots);
  return roots;
}
function flatten(list, pid, out) {
  list.forEach((n, i) => {
    out[n.id] = { title: n.title, column_name: n.column, if_cm: n.ad ? 1 : 0, author: n.author, author_app: n.role,
      page_list: n.pageList.length ? n.pageList : '', page1: n.page1, page2: n.page2, pid, sort: i + 1 };
    flatten(n.children, n.id, out);
  });
  return out;
}

// 篇目有變動就延遲 0.4 秒存檔；內容和上次存的一樣就不送出
let pendingIssue = null, saveTimer = null;
function persist() { pendingIssue = issue(); clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 400); }
function flushSave() {
  clearTimeout(saveTimer);
  const is = pendingIssue; pendingIssue = null;
  if (!is || !is.loaded) return;
  const body = JSON.stringify(flatten(is.entries, 'start', {}));
  if (body === is.saved) return;
  api('saveIndex.php', { book: is.id, tmpData: body }).then(() => { is.saved = body; }).catch(e => toast('存檔失敗：' + e.message));
}
window.addEventListener('beforeunload', flushSave);

async function loadIssue(is) {
  const [nums, pn, data, meta, recs] = await Promise.all([
    api('givePageNum.php', { book: is.id }), api('givePageno.php', { book: is.id, page: 'all' }),
    api('giveData.php', { book: is.id }), api('saveMeta.php', { book: is.id, action: 'get' }), api('givePageRec.php', { book: is.id })]);
  const map = parse(pn, {});
  is.pages = parse(nums, []).map(String).map(l => ({ id: l, label: l, pno: (map[l] && map[l][3]) || '' }));
  const flat = parse(data, {});
  is.entries = toTree(Array.isArray(flat) ? {} : flat);
  is.meta = { ...META_DEFAULT, ...parse(meta, {}) };
  is.saved = JSON.stringify(flatten(is.entries, 'start', {}));
  sortEntries(is.entries, is.pages); // 載入後依影像順序排好（下次存檔時才會寫回）
  is.rec = parse(recs, {}); if (Array.isArray(is.rec)) is.rec = {};
  is.recSaved = JSON.stringify(is.rec);
  is.loaded = true;
}
let rootCollapsed = false;
let selectedId = null, editingId = null, confirmDeleteId = null, flashId = null, customMode = false, pageTouched = false, dragId = null, pickedList = [], pickOrder = [];
const issue = () => state.issues.find(i => i.id === state.issueId) || EMPTY;
const curPage = () => issue().pages[state.pageIdx];

function locate(id, list = issue().entries, parent = null) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return { node: list[i], list, index: i, parent };
    const hit = locate(id, list[i].children, list[i]);
    if (hit) return hit;
  }
  return null;
}
function walk(fn, list = issue().entries) { list.forEach(n => { fn(n); walk(fn, n.children); }); }
function contains(node, id) { return node.id === id || node.children.some(c => contains(c, id)); }

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, Math.max(2600, msg.length * 120));
}

const pageSrc = p => imgUrl(issue().id, p.label);

/* ---------- 影像檢視：滾輪縮放、拖曳、旋轉 ---------- */
const view = { cx: 0, cy: 0, s: 1, r: 0, fit: 1, moved: false };
function applyView() {
  const img = $('pageImg'), w = img.naturalWidth, h = img.naturalHeight;
  img.style.transform = `translate(${view.cx - w / 2}px, ${view.cy - h / 2}px) rotate(${view.r}deg) scale(${view.s})`;
  $('viewer').classList.toggle('zoomed', view.s > view.fit * 1.01);
  const n = issue().pages.length;
  $('readout').textContent = `${curPage() ? curPage().label : '-'}（第 ${state.pageIdx + 1}/${n} 張）${Math.round(view.s * 100)}%`;
}
function fitView() {
  const box = $('viewer').getBoundingClientRect(), img = $('pageImg');
  if (!img.naturalWidth || !box.width) return;
  const side = view.r % 180 !== 0;
  const w = side ? img.naturalHeight : img.naturalWidth, h = side ? img.naturalWidth : img.naturalHeight;
  view.fit = view.s = Math.min((box.width - 16) / w, (box.height - 16) / h);
  view.cx = box.width / 2; view.cy = box.height / 2; view.moved = false;
  applyView();
}
function zoomAt(factor, px, py) {
  const next = Math.min(Math.max(view.s * factor, view.fit * .5), 6);
  const k = next / view.s;
  view.cx = px - (px - view.cx) * k; view.cy = py - (py - view.cy) * k;
  view.s = next; view.moved = true; applyView();
}
function zoomCenter(f) { const b = $('viewer').getBoundingClientRect(); zoomAt(f, b.width / 2, b.height / 2); }
$('pageImg').addEventListener('load', () => { view.r = 0; fitView(); });
$('viewer').addEventListener('wheel', e => {
  e.preventDefault();
  const b = $('viewer').getBoundingClientRect();
  zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - b.left, e.clientY - b.top);
}, { passive: false });
let drag = null;
$('viewer').addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' && view.s <= view.fit * 1.01) return;
  drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
  $('viewer').setPointerCapture(e.pointerId); $('viewer').classList.add('dragging');
});
$('viewer').addEventListener('pointermove', e => {
  if (!drag) return;
  view.cx = drag.cx + e.clientX - drag.x; view.cy = drag.cy + e.clientY - drag.y; view.moved = true; applyView();
});
const endDrag = () => { drag = null; $('viewer').classList.remove('dragging'); };
$('viewer').addEventListener('pointerup', endDrag);
$('viewer').addEventListener('pointercancel', endDrag);
new ResizeObserver(() => { if (!view.moved) fitView(); }).observe($('viewer'));
$('zoomIn').onclick = () => zoomCenter(1.25);
$('zoomOut').onclick = () => zoomCenter(1 / 1.25);
$('zoomFit').onclick = fitView;
$('rotate').onclick = () => { view.r = (view.r + 90) % 360; fitView(); };

/* 拖曳中間分隔線調整左右寬度 */
function setRight(px) {
  const max = Math.max(430, $('app').clientWidth - 340);
  document.documentElement.style.setProperty('--right', Math.min(Math.max(px, 430), max) + 'px');
}
let resizing = false;
$('divider').addEventListener('pointerdown', e => { resizing = true; $('divider').setPointerCapture(e.pointerId); });
$('divider').addEventListener('pointermove', e => { if (resizing) setRight($('app').getBoundingClientRect().right - parseFloat(getComputedStyle($('app')).paddingRight) - e.clientX); });
$('divider').addEventListener('pointerup', () => { resizing = false; });
$('divider').addEventListener('pointercancel', () => { resizing = false; });
$('divider').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  setRight(document.querySelector('.side').offsetWidth + (e.key === 'ArrowLeft' ? 30 : -30));
});

/* ---------- 期刊與頁面切換 ---------- */
function renderIssueSelect() {
  $('issueSelect').replaceChildren(new Option('選擇資料', '', false, !state.issueId), ...state.issues.map(i => new Option(i.name, i.id, false, i.id === state.issueId)));
}
function renderPageSelect() {
  $('pageSelect').replaceChildren(...issue().pages.map((p, i) => new Option(p.label, i, false, i === state.pageIdx)));
}
function showPage(i) {
  if (typeof cancelPick === 'function') cancelPick();
  const n = issue().pages.length;
  if (!n) {
    $('pageImg').removeAttribute('src'); $('pnoTag').textContent = ''; $('readout').textContent = '';
    $('prevPage').disabled = $('nextPage').disabled = true;
    return;
  }
  state.pageIdx = Math.max(0, Math.min(i, n - 1));
  $('pageSelect').value = state.pageIdx;
  $('prevPage').disabled = state.pageIdx === 0;
  $('nextPage').disabled = state.pageIdx === n - 1;
  $('pageImg').src = pageSrc(curPage());
  $('pageImg').alt = '掃描影像：' + curPage().label;
  followPage(); showPno();
}
// 比照原系統：題名空白時起訖一起跟著翻頁；已有題名時只有結束影像跟著翻頁
function followPage() {
  if (editingId || customMode) return;
  const label = curPage().label;
  if (!$('fTitle').value.trim()) { $('fPage1').value = $('fPage2').value = label; pageTouched = false; }
  else if (!pageTouched) $('fPage2').value = label;
}
function showPno() {
  const tag = $('pnoTag'), pno = curPage().pno;
  tag.textContent = pno ? `第 ${pno} 頁` : '無頁碼';
  tag.classList.remove('flash'); void tag.offsetWidth; tag.classList.add('flash');
}
$('prevPage').onclick = () => showPage(state.pageIdx - 1);
$('nextPage').onclick = () => showPage(state.pageIdx + 1);
$('pageSelect').onchange = e => showPage(+e.target.value);
$('issueSelect').onchange = async e => {
  flushSave();
  state.issueId = e.target.value; state.pageIdx = 0;
  selectedId = null; confirmDeleteId = null;
  const is = issue();
  if (is.id && !is.loaded) {
    $('app').classList.add('is-loading'); $('issueSelect').disabled = true;
    try { await loadIssue(is); } catch (err) { toast('讀取失敗：' + err.message); }
    $('app').classList.remove('is-loading'); $('issueSelect').disabled = false;
  }
  resetForm(); renderAll();
};
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'PageDown') { e.preventDefault(); showPage(state.pageIdx + 1); }
  if (e.key === 'PageUp') { e.preventDefault(); showPage(state.pageIdx - 1); }
});

/* ---------- 篇目表單 ---------- */
function setCustom(on) {
  customMode = on;
  $('rangeBox').hidden = on; $('rangeBox').style.display = on ? 'none' : '';
  $('pickedBox').hidden = !on;
  $('pickedBox').textContent = on ? pickedList.join('、') : '';
}
function updateSaveLabel() {
  const loc = selectedId ? locate(selectedId) : null;
  if (editingId) { $('saveBtn').textContent = '確定修改'; return; }
  if ($('levelOn').checked && loc) {
    const t = loc.node.title;
    $('saveBtn').textContent = `存到「${t.length > 10 ? t.slice(0, 9) + '…' : t}」`;
  } else $('saveBtn').textContent = '存檔';
}
function showError(msg) {
  $('formError').textContent = msg || ''; $('formError').hidden = !msg;
  ['fTitle', 'fPage1', 'fPage2'].forEach(id => $(id).classList.remove('invalid'));
  if (!msg) return;
  if (/題名/.test(msg)) $('fTitle').classList.add('invalid');
  if (/影像|範圍|起始|結束/.test(msg)) ['fPage1', 'fPage2'].forEach(id => $(id).classList.add('invalid'));
}
// 一開始輸入就清除錯誤標示（即時回饋）
['fTitle', 'fPage1', 'fPage2'].forEach(id => $(id).addEventListener('input', () => { $(id).classList.remove('invalid'); if (!$('formError').hidden) $('formError').hidden = true; }));
function resetForm() {
  editingId = null; pageTouched = false;
  ['fTitle', 'fColumn', 'fAuthor', 'fRole'].forEach(id => { $(id).value = ''; });
  $('fAd').checked = false;
  pickedList = [];
  setCustom(false); showError('');
  const p = curPage();
  $('fPage1').value = $('fPage2').value = p ? p.label : '';
  updateSaveLabel();
  $('editingTag').hidden = true; if ($('formSum')) $('formSum').textContent = '';
}
function loadForm(n) {
  editingId = n.id; pageTouched = true;
  $('fTitle').value = n.title; $('fColumn').value = n.column; $('fAd').checked = n.ad;
  $('fAuthor').value = n.author; $('fRole').value = n.role;
  $('fPage1').value = n.page1; $('fPage2').value = n.page2;
  pickedList = [...n.pageList];
  setCustom(n.pageList.length > 0); showError('');
  updateSaveLabel();
  $('editingTag').hidden = false; if ($('formSum')) $('formSum').textContent = n.title;
  $('fTitle').focus();
}
function labelIndex(label) { return issue().pages.findIndex(p => p.label === label); }
function checkPages() {
  if (customMode) return pickedList.length ? null : '請按「自訂範圍」勾選至少一張影像。';
  const a = $('fPage1').value.trim(), b = $('fPage2').value.trim() || a;
  if (!a) return '請填寫起始影像。';
  if (labelIndex(a) < 0) return `這一期沒有影像「${a}」。`;
  if (labelIndex(b) < 0) return `這一期沒有影像「${b}」。`;
  if (labelIndex(a) > labelIndex(b)) return '起始影像在結束影像之後，請對調。';
  return null;
}
$('entryForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('fTitle').value.trim();
  if (!title) { showError('請填寫主要題名。'); $('fTitle').focus(); return; }
  const err = checkPages();
  if (err) { showError(err); return; }
  const data = {
    title, column: $('fColumn').value.trim(), ad: $('fAd').checked,
    author: $('fAuthor').value.trim(), role: $('fRole').value.trim(),
    page1: customMode ? '' : $('fPage1').value.trim(),
    page2: customMode ? '' : ($('fPage2').value.trim() || $('fPage1').value.trim()),
    pageList: customMode ? [...pickedList] : []
  };
  if (editingId) {
    const loc = locate(editingId);
    if (loc) { Object.assign(loc.node, data); flashId = loc.node.id; syncEntryToRec(loc.node); }
    toast('已更新篇目');
  } else {
    const node = { id: uid(), collapsed: false, children: [], ...data };
    const parent = $('levelOn').checked && selectedId ? locate(selectedId) : null;
    if (parent) { parent.node.children.push(node); parent.node.collapsed = false; }
    else issue().entries.push(node);
    flashId = node.id; syncEntryToRec(node);
    toast(parent ? `已存到「${parent.node.title}」之下` : '已存檔');
  }
  sortEntries(); resetForm(); renderTree(); persist();
});
$('resetBtn').onclick = resetForm;
$('levelOn').addEventListener('change', updateSaveLabel);
$('useStart').onclick = () => { pageTouched = true; $('fPage1').value = curPage().label; };
$('useEnd').onclick = () => { pageTouched = true; $('fPage2').value = curPage().label; };
['fPage1', 'fPage2'].forEach(id => $(id).addEventListener('input', () => { pageTouched = true; }));
$('pageReset').onclick = () => {
  pickedList = []; setCustom(false); pageTouched = false; showError('');
  $('fPage1').value = $('fPage2').value = curPage().label;
};

/* ---------- 自訂範圍：依勾選順序組成 page_list ---------- */
function refreshPickOrder() {
  document.querySelectorAll('#pickBody [data-pick]').forEach(cb => {
    const k = pickOrder.indexOf(cb.dataset.pick);
    cb.checked = k >= 0;
    cb.parentElement.querySelector('.pick-order').textContent = k >= 0 ? `順序 ${k + 1}` : '';
  });
}
$('pageSetting').onclick = () => {
  pickOrder = [...pickedList];
  $('pickError').hidden = true;
  const body = $('pickBody');
  body.replaceChildren();
  issue().pages.forEach((p, i) => {
    const row = make('div', 'page-row');
    const img = make('img'); img.loading = 'lazy'; img.src = pageSrc(p, i); img.alt = '';
    const col = make('div', 'col');
    const lab = make('label', 'check');
    const cb = make('input'); cb.type = 'checkbox'; cb.dataset.pick = p.label;
    cb.onchange = () => {
      if (cb.checked) pickOrder.push(p.label);
      else pickOrder = pickOrder.filter(x => x !== p.label);
      refreshPickOrder();
    };
    lab.append(cb, make('span', 'seq', p.label), make('span', 'pick-order'));
    col.append(lab, make('span', 'seq', p.pno ? `第 ${p.pno} 頁` : '無頁碼'));
    row.append(img, col); body.append(row);
  });
  refreshPickOrder();
  $('pickDlg').showModal();
};
$('pickSave').onclick = () => {
  if (!pickOrder.length) { $('pickError').textContent = '請至少勾選一張影像。'; $('pickError').hidden = false; return; }
  pickedList = [...pickOrder]; pageTouched = true;
  setCustom(true); showError('');
  $('pickDlg').close();
};

/* ---------- 篇目樹 ---------- */
function make(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function pagesText(n) {
  if (n.pageList.length) return n.pageList.join('、');
  return n.page1 === n.page2 ? n.page1 : `${n.page1}–${n.page2}`;
}
// 清單用的簡短影像範圍：去掉與資料編號相同的前綴，例如 0MHC0019320-01-0001 → 01-0001
function shortLabel(l) { const id = issue().id + '-'; return l.startsWith(id) ? l.slice(id.length) : l; }
function pagesShort(n) {
  if (n.pageList.length) { const a = n.pageList.map(shortLabel); return a.length > 3 ? a.slice(0, 3).join('、') + '…（共 ' + a.length + ' 張）' : a.join('、'); }
  return n.page1 === n.page2 ? shortLabel(n.page1) : `${shortLabel(n.page1)} ～ ${shortLabel(n.page2)}`;
}
function pnoText(n) {
  if (n.pageList.length) return '';
  const pno = l => { const p = issue().pages[labelIndex(l)]; return p ? p.pno : ''; };
  const a = pno(n.page1), b = pno(n.page2);
  if (!a && !b) return '';
  return a === b ? `第 ${a} 頁` : `第 ${a || '?'}–${b || '?'} 頁`;
}
function firstLabel(n) { return n.pageList[0] || n.page1; }

function renderRow(n) {
  const li = make('li');
  const row = make('div', 'row');
  row.dataset.id = n.id;
  if (n.id === selectedId) row.classList.add('selected');
  if (n.id === flashId) row.classList.add('flash');
  if (n.children.length) row.classList.add('has-kids');

  const tg = make('button', 'toggle' + (n.children.length ? '' : ' none'), n.collapsed ? '▶' : '▼');
  tg.type = 'button';
  tg.setAttribute('aria-label', (n.collapsed ? '展開' : '收合') + n.title);
  tg.setAttribute('aria-expanded', String(!n.collapsed));
  tg.onclick = e => { e.stopPropagation(); n.collapsed = !n.collapsed; renderTree(); persist(); };
  row.append(tg);

  const main = make('div', 'row-main');
  const t = make('div', 'row-title');
  if (n.ad) t.append(make('span', 'tag-ad', '廣告'));
  t.append(n.title);
  main.append(t);
  const sub = make('div', 'row-sub');
  sub.append(make('span', 'row-pages', pagesShort(n)));
  const extra = [pnoText(n), n.column && '專欄：' + n.column, n.author && n.author + (n.role ? `（${n.role}）` : '')].filter(Boolean).join('・');
  if (extra) sub.append('・' + extra);
  main.append(sub);
  row.append(main);
  if (n.children.length) row.append(make('span', 'kid-count', `${n.children.length} 筆子項`));

  const act = make('div', 'row-actions');
  if (confirmDeleteId === n.id) {
    const count = (function c(x) { return x.children.reduce((s, k) => s + 1 + c(k), 0); })(n);
    const yes = make('button', 'link-btn del', count ? `連同 ${count} 筆子層刪除` : '確定刪除');
    yes.type = 'button';
    yes.onclick = e => {
      e.stopPropagation();
      const loc = locate(n.id); loc.list.splice(loc.index, 1);
      if (selectedId && contains(n, selectedId)) selectedId = null;
      if (editingId && contains(n, editingId)) resetForm();
      confirmDeleteId = null; renderTree(); persist(); toast('已刪除篇目');
    };
    const no = make('button', 'link-btn', '取消');
    no.type = 'button';
    no.onclick = e => { e.stopPropagation(); confirmDeleteId = null; renderTree(); };
    act.append(yes, no);
  } else {
    const mk = (label, cls, fn) => { const b = make('button', 'link-btn ' + cls, label); b.type = 'button'; b.onclick = e => { e.stopPropagation(); fn(); }; return b; };
    act.append(
      mk('刪除', 'del', () => { confirmDeleteId = n.id; renderTree(); })
    );
  }
  row.append(act);
  row.title = n.title + '\n影像 ' + pagesText(n);
  row.onclick = () => { const i = labelIndex(firstLabel(n)); if (i >= 0) showPage(i); else toast('這一期找不到這張影像'); selectedId = n.id; loadForm(n); renderTree(); };
  li.append(row);

  if (n.children.length && !n.collapsed) {
    const ul = make('ul');
    n.children.forEach(c => ul.append(renderRow(c)));
    li.append(ul);
  }
  return li;
}
function renderTree() {
  const box = $('treeScroll'), roots = issue().entries, top = box.scrollTop;
  box.replaceChildren();
  if (roots.length) {
    const ul = make('ul', 'tree');
    if (roots.some(function f(n) { return n.children.length > 0; })) ul.classList.add('has-hier');
    roots.forEach(n => ul.append(renderRow(n)));
    // 最上層（只在畫面顯示，不存進篇目資料）：雜誌編目裡的「刊名」，所有篇目都歸在它底下
    const bookName = ((issue().meta || {})['刊名'] || '').trim();
    if (bookName) {
      let cnt = 0; walk(() => cnt++);
      const head = make('div', 'root-head' + (rootCollapsed ? ' collapsed' : ''));
      head.setAttribute('role', 'button'); head.tabIndex = 0;
      head.setAttribute('aria-expanded', String(!rootCollapsed));
      head.title = '最上層：雜誌編目的刊名（只用來顯示，不會存進篇目資料）。點一下可收合全部篇目。';
      head.append(make('span', 'root-arrow', rootCollapsed ? '▶' : '▼'), make('span', 'root-name', bookName), make('span', 'kid-count', cnt + ' 筆'));
      const flip = () => { rootCollapsed = !rootCollapsed; renderTree(); };
      head.onclick = flip; head.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
      ul.classList.add('under-root'); ul.hidden = rootCollapsed;
      box.append(head, ul);
    } else box.append(ul);
  } else {
    box.append(make('div', 'empty', '這一期還沒有篇目。在上方填入題名和頁碼後按「存檔」，就會出現在這裡。'));
  }
  box.scrollTop = top;
  let count = 0; walk(() => count++);
  $('treeCount').textContent = `共 ${count} 筆`;
  // 展開／收合只對「有子層級」的篇目有作用；沒有子層級時停用並說明原因，避免按了沒反應
  const hasKids = (function f(l) { return l.some(n => n.children.length || f(n.children)); })(issue().entries);
  ['expandAll', 'collapseAll'].forEach(id => {
    $(id).disabled = !hasKids;
    $(id).title = hasKids ? '' : '目前沒有子層級，沒有可展開或收合的項目。（選一筆後按「降一層」可建立子層級）';
  });
  const loc = selectedId ? locate(selectedId) : null;
  $('outdent').disabled = !loc || !loc.parent;
  $('indent').disabled = !loc || loc.index === 0;
  updateSaveLabel();
  flashId = null;
}
// 篇目依「起始影像」的順序自動排列（同一層之內）；找不到對應影像的排在最後，彼此維持原順序
function sortEntries(list, pages) {
  list = list || issue().entries; pages = pages || issue().pages;
  const key = n => { const l = n.pageList[0] || n.page1; const i = pages.findIndex(p => p.label === l); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  list.sort((a, b) => key(a) - key(b));
  list.forEach(n => sortEntries(n.children, pages));
}
$('outdent').onclick = () => {
  const l = locate(selectedId); if (!l || !l.parent) return;
  const p = locate(l.parent.id);
  l.list.splice(l.index, 1); p.list.splice(p.index + 1, 0, l.node);
  sortEntries(); flashId = l.node.id; renderTree(); persist();
};
$('indent').onclick = () => {
  const l = locate(selectedId); if (!l || l.index === 0) return;
  const prev = l.list[l.index - 1];
  l.list.splice(l.index, 1); prev.children.push(l.node); prev.collapsed = false;
  sortEntries(); flashId = l.node.id; renderTree(); persist();
};
$('expandAll').onclick = () => { walk(n => { n.collapsed = false; }); renderTree(); persist(); };
$('collapseAll').onclick = () => { walk(n => { n.collapsed = n.children.length > 0; }); renderTree(); persist(); };

/* ---------- 雜誌編目 ---------- */
document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
function parseDate(v) { const m = v.trim().match(/^(\d{4})(?:[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?)?$/); return m ? [m[1], m[2] ? String(+m[2]) : '', m[3] ? String(+m[3]) : ''] : ['', '', '']; }
function buildMeta() {
  const meta = issue().meta, body = $('metaBody');
  body.replaceChildren();
  META_GROUPS.forEach(([legend, keys]) => {
    const fs = make('fieldset'); fs.append(make('legend', '', legend));
    const grid = make('div', 'meta-grid');
    keys.forEach(k => {
      const lab = make('label', '', k); let ctl;
      if (YES_NO.includes(k)) {
        ctl = make('select');
        ['是', '否'].forEach(o => ctl.append(new Option(o, o, false, (meta[k] || (k === '線裝書' ? '否' : '是')) === o)));
      } else {
        ctl = make('input'); ctl.type = 'text'; ctl.value = meta[k] || '';
        if (['出版年', '出版月', '出版日'].includes(k)) ctl.disabled = true;
      }
      ctl.dataset.key = k; lab.append(ctl); grid.append(lab);
    });
    fs.append(grid); body.append(fs);
  });
  const field = k => body.querySelector(`[data-key="${k}"]`);
  field('西元出版日期(完整)').addEventListener('input', e => {
    const [y, m, d] = parseDate(e.target.value);
    field('出版年').value = y; field('出版月').value = m; field('出版日').value = d;
  });
  field('刊名').addEventListener('input', e => { field('報刊名第一字').value = [...e.target.value.trim()][0] || ''; });
}
$('openMeta').onclick = () => { if (!issue().id) return toast('請先選擇期刊'); buildMeta(); $('metaDlg').showModal(); };
$('metaSave').onclick = () => {
  const is = issue(), meta = { ...is.meta };
  $('metaBody').querySelectorAll('[data-key]').forEach(c => { meta[c.dataset.key] = c.value.trim(); });
  api('saveMeta.php', { book: is.id, meta: JSON.stringify(meta) })
    .then(() => { is.meta = meta; $('metaDlg').close(); toast('已存檔雜誌編目'); renderTree(); })
    .catch(e => toast('存檔失敗：' + e.message));
};

/* ---------- 編輯頁碼（原系統是獨立的 page_work 頁面） ---------- */
function buildPages() {
  const body = $('pagesBody');
  body.replaceChildren();
  $('pagesError').hidden = true;
  issue().pages.forEach((p, i) => {
    const row = make('div', 'page-row');
    const img = make('img'); img.loading = 'lazy'; img.src = pageSrc(p, i); img.alt = '';
    const col = make('div', 'col');
    col.append(make('span', 'seq', `影像 ${p.label}`));
    const input = make('input'); input.type = 'text'; input.value = p.pno; input.dataset.pid = p.id;
    input.placeholder = '無頁碼';
    input.setAttribute('aria-label', `影像 ${p.label} 的頁碼`);
    col.append(input);
    const links = make('div', 'inline');
    const go = make('button', 'link-btn', '前往'); go.type = 'button';
    go.onclick = () => { $('pagesDlg').close(); showPage(i); };
    const seq = make('button', 'link-btn', '由此連續編號'); seq.type = 'button';
    seq.onclick = () => {
      const start = parseInt(input.value, 10);
      if (Number.isNaN(start)) { $('pagesError').textContent = '請先在這張影像填入數字頁碼，再連續編號。'; $('pagesError').hidden = false; return; }
      $('pagesError').hidden = true;
      [...body.querySelectorAll('input')].slice(i).forEach((el, k) => { el.value = String(start + k); });
    };
    links.append(go, seq); col.append(links);
    row.append(img, col); body.append(row);
  });
}
$('openPages').onclick = () => { if (!issue().pages.length) return toast('這一期沒有影像'); buildPages(); $('pagesDlg').showModal(); };
$('pagesSave').onclick = () => {
  const is = issue(), data = {};
  $('pagesBody').querySelectorAll('input').forEach(el => { data[el.dataset.pid] = el.value.trim(); });
  api('savePageno.php', { book: is.id, data: JSON.stringify(data) }).then(() => {
    is.pages.forEach(p => { p.pno = data[p.id] || ''; });
    $('pagesDlg').close(); showPage(state.pageIdx); renderTree(); toast('已更新頁碼');
  }).catch(e => { $('pagesError').textContent = '存檔失敗：' + e.message; $('pagesError').hidden = false; });
};
/* ---------- 匯出（目前這一期，格式同 saveIndex.php 收到的資料） ---------- */
function exportData() {
  const is = issue();
  return JSON.stringify({ book: is.name, meta: is.meta, pages: is.pages.map(p => ({ page: p.label, pageno: p.pno })), tmpData: flatten(is.entries, 'start', {}) }, null, 2);
}
$('openExport').onclick = () => {
  if (!issue().id) return toast('請先選擇期刊');
  $('exportText').value = exportData();
  $('exportDlg').showModal();
};
$('copyJson').onclick = () => {
  const ta = $('exportText');
  const fallback = () => { ta.focus(); ta.select(); toast('無法直接複製，已全選內容，請按 Ctrl+C'); };
  if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(() => toast('已複製 JSON'), fallback);
  else fallback();
};
function renderAll() { renderIssueSelect(); renderPageSelect(); showPage(state.pageIdx); renderTree(); if (typeof pvRender === 'function') pvRender(); }
resetForm();
renderAll();
(function () {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h && state.issues.some(i => i.id === h)) { $('issueSelect').value = h; $('issueSelect').onchange({ target: $('issueSelect') }); }
})();

/* ---------- AI 辨識（呼叫 analyze.php，結果只是草稿，要人工確認才會存） ---------- */
// 注意：pages.js 也有一個 callAnalyze（逐頁核對用），同名函式會被後載入的蓋掉，所以這裡叫 analyzeCurrent
async function analyzeCurrent(mode, btn) {
  const is = issue(), p = curPage();
  if (!is.id || !p) { toast('請先選擇資料與影像'); return null; }
  const eng = await askEngine();   // 先問：API（Gemini）或本機 OCR
  if (!eng) return null;
  const label = btn.textContent;
  document.querySelectorAll('#aiPage,#aiToc').forEach(b => { b.disabled = true; });
  btn.textContent = '辨識中…'; btn.classList.add('loading');
  toast(eng === 'local' ? '本機 OCR 辨識中，請稍候…' : 'AI 辨識中，請稍候…');
  try {
    const params = { book: is.id, page: p.label, mode };
    if (eng === 'local') { params.engine = 'local'; if (isThread(is)) params.thread = '1'; }
    return parse(await api('analyze.php', params), null);
  }
  catch (e) { toast('辨識失敗：' + e.message); return null; }
  finally { btn.textContent = label; btn.classList.remove('loading'); document.querySelectorAll('#aiPage,#aiToc').forEach(b => { b.disabled = false; }); }
}

function fillFromArticle(a) {
  $('fTitle').value = a.title || ''; $('fColumn').value = a.column_name || ''; $('fAd').checked = !!a.is_ad;
  $('fAuthor').value = a.author || ''; $('fRole').value = a.author_role || '';
  showError('');
}
$('aiPage').onclick = async () => {
  const box = $('candBox'); box.hidden = true; box.replaceChildren();
  const r = await analyzeCurrent('page', $('aiPage'));
  if (!r) return;
  const list = (r.articles || []).filter(a => a.title);
  if (!list.length) { toast('這一頁沒有辨識到篇目標題'); return; }
  fillFromArticle(list[0]);
  if (list.length > 1) {
    box.append(make('span', 'notice', '這一頁還有：'));
    list.slice(1).forEach(a => {
      const b = make('button', 'link-btn', a.title + (a.author ? `（${a.author}）` : '')); b.type = 'button';
      b.onclick = () => fillFromArticle(a);
      box.append(b);
    });
    box.hidden = false;
  }
  toast('已預填，請核對後再存檔');
};

let tocDraft = [];
function tocIndexOf(printed, base) {
  const pages = issue().pages, s = String(printed || '').trim();
  if (!s) return -1;
  const exact = pages.findIndex(p => p.pno === s);
  if (exact >= 0) return exact;
  const n = parseInt(s, 10);
  if (Number.isNaN(n) || n < 1) return -1;
  const k = base + n - 1;
  return k < pages.length ? k : -1;
}
function tocRecompute() {
  const pages = issue().pages, base = +$('tocBase').value;
  const idx = tocDraft.map(d => tocIndexOf(d.page, base));
  tocDraft.forEach((d, i) => {
    d.s = idx[i] >= 0 ? pages[idx[i]].label : '';
    let e = idx[i];
    const nxt = idx[i + 1];
    if (e >= 0 && nxt >= 0 && nxt - 1 > e) e = nxt - 1;
    d._e = e;
  });
  tocDraft.forEach((d, i) => { // 專題的結束頁要涵蓋底下的子篇目
    if (d.level === 0) for (let j = i + 1; j < tocDraft.length && tocDraft[j].level === 1; j++) d._e = Math.max(d._e, tocDraft[j]._e);
    d.e = d._e >= 0 ? pages[d._e].label : d.s;
  });
  drawTocRows();
}
function drawTocRows() {
  const box = $('tocRows'); box.replaceChildren();
  const head = make('div', 'toc-row head');
  ['', '題名', '作者', '專欄', '頁碼', '起始影像', '結束影像', '層級'].forEach(t => head.append(make('span', '', t)));
  box.append(head);
  tocDraft.forEach(d => {
    const row = make('div', 'toc-row' + (d.level ? ' lv1' : '') + (d.s ? '' : ' bad'));
    const cb = make('input'); cb.type = 'checkbox'; cb.checked = d.on; cb.onchange = () => { d.on = cb.checked; countToc(); };
    const txt = (key, cls) => { const i = make('input', cls); i.type = 'text'; i.value = d[key] || ''; i.oninput = () => { d[key] = i.value; }; return i; };
    const t = make('span', 't'); t.append(txt('title'));
    const lv = make('select'); [['0', '頂層'], ['1', '子層']].forEach(([v, l]) => lv.append(new Option(l, v, false, String(d.level) === v)));
    lv.onchange = () => { d.level = +lv.value; tocRecompute(); };
    row.append(cb, t, txt('author'), txt('column'), txt('page'), txt('s', 's'), txt('e'), lv);
    row.children[4].onchange = tocRecompute;
    box.append(row);
  });
  countToc();
}
function countToc() { $('tocCount').textContent = `已勾選 ${tocDraft.filter(d => d.on).length} / ${tocDraft.length} 筆`; }

$('aiToc').onclick = async () => {
  const r = await analyzeCurrent('toc', $('aiToc'));
  if (!r) return;
  const list = (r.entries || []).filter(e => e.title);
  if (!list.length) { toast('這一頁沒有辨識到目錄內容'); return; }
  const pages = issue().pages;
  const firstNo = pages.findIndex(p => p.pno === '1');
  const sel = $('tocBase'); sel.replaceChildren(...pages.map((p, i) => new Option(p.label, i)));
  sel.value = firstNo >= 0 ? firstNo : Math.min(state.pageIdx + 1, pages.length - 1);
  tocDraft = list.map(e => ({ on: true, title: e.title, column: e.column_name || '', author: e.author || '', role: e.author_role || '', ad: !!e.is_ad,
    page: e.page || '', level: e.level === 1 ? 1 : 0, s: '', e: '', _e: -1 }));
  $('tocError').hidden = true;
  sel.onchange = tocRecompute;
  tocRecompute();
  $('tocDlg').showModal();
};

$('tocAdd').onclick = () => {
  const pages = issue().pages, has = l => pages.some(p => p.label === l);
  const rows = tocDraft.filter(d => d.on);
  if (!rows.length) { $('tocError').textContent = '請至少勾選一筆。'; $('tocError').hidden = false; return; }
  const bad = rows.filter(d => !d.title.trim() || !has(d.s.trim()) || !has((d.e || d.s).trim()));
  if (bad.length) { $('tocError').textContent = `有 ${bad.length} 筆的起始或結束影像不存在（標紅的欄位），請修正或取消勾選。`; $('tocError').hidden = false; return; }
  let parent = null, added = 0;
  rows.forEach(d => {
    const node = { id: uid(), title: d.title.trim(), column: d.column.trim(), ad: d.ad, author: d.author.trim(), role: d.role || '',
      page1: d.s.trim(), page2: (d.e || d.s).trim(), pageList: [], collapsed: false, children: [] };
    if (d.level === 1 && parent) parent.children.push(node);
    else { issue().entries.push(node); parent = node; }
    added++;
  });
  sortEntries(); $('tocDlg').close(); renderTree(); persist();
  toast(`已加入 ${added} 筆篇目，請再逐筆核對`);
};