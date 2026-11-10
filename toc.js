/* ---------- 期刊目次：toc/ 資料夾的圖檔與 PDF；左側編輯欄位，右側預覽，可試送／上傳到圖書館後台（uploadToc.php） ---------- */
const TOC = { files: [], cur: '' };
const tocUrl = f => 'uploadToc.php?action=file&f=' + encodeURIComponent(f);
const tocMode = () => $('app').classList.contains('mode-toc');
const TM = { 刊名: 'tmName', ISSN: 'tmIssn', 狀態: 'tmStatus', 卷: 'tmVol', 期: 'tmIssue', 號: 'tmNo', 年: 'tmYear', 月: 'tmMonth' };

function tocStatusText(s) {
  return s && s.time ? `最近${s.dry ? '試送' : '上傳'}：${s.time}，${s.ok ? '成功' : '失敗'}${s.message ? '：' + s.message : ''}` : '這個檔案尚未上傳過。';
}
function tocFillSelect() {
  $('issueSelect').replaceChildren(new Option('選擇目次檔案', '', false, !TOC.cur), ...TOC.files.map(f => new Option(f.name, f.name, false, f.name === TOC.cur)));
}
function tocFillForm(m, f) {
  m = m || {};
  Object.keys(TM).forEach(k => { $(TM[k]).value = m[k] || ''; $(TM[k]).disabled = !f; });
  $('tmNewYes').checked = m['新到狀態'] ? m['新到狀態'] === 'yes' : !!f; // 後台表單預設 yes
  $('tmNewNo').checked = m['新到狀態'] === 'no';
  $('tmNewYes').disabled = $('tmNewNo').disabled = $('tmSave').disabled = !f;
  $('tmAttach').textContent = f ? f.name : '（請先從左側「資料」選擇目次檔案）';
  [['tmCreator', '建立者'], ['tmCreated', '建立時間'], ['tmUpdater', '更新者'], ['tmUpdated', '更新時間']].forEach(([id, k]) => { $(id).textContent = m[k] || ''; });
}
async function tocRender() {
  try { TOC.files = parse(await api('uploadToc.php', { action: 'list' }), []); } catch (e) { TOC.files = []; toast('讀取 toc 資料夾失敗：' + e.message); }
  if (!TOC.files.some(f => f.name === TOC.cur)) TOC.cur = '';
  tocFillSelect(); tocShow();
}
/* ---------- 影像檢視器：和逐頁核對相同的樣式與操作（滾輪縮放、拖曳移動、符合視窗）。PDF 用 pdf.js 轉成頁面影像 ---------- */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
let tvObs = null;
const TV = { images: null }; // images(max)：目前顯示的檔案前幾頁的 base64（AI 辨識用）
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  return new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = PDFJS + 'build/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'build/pdf.worker.min.js'; ok(); };
    s.onerror = () => no(new Error('無法載入 PDF 檢視元件（需要網路）'));
    document.head.append(s);
  });
}
function tvMount(f) {
  TV.images = null;
  if (tvObs) { tvObs.disconnect(); tvObs = null; }
  const box = $('tocTable'), vw = make('div', 'pv-viewer toc-viewer'), img = make('img'), tag = make('span', 'pv-tag'), zoom = make('div', 'pv-zoom');
  img.alt = f.name; img.draggable = false;
  const V = { x: 0, y: 0, s: 1, fit: 1, nw: 0, nh: 0, moved: false };
  const apply = () => { img.style.width = V.nw * V.s + 'px'; img.style.height = V.nh * V.s + 'px'; img.style.left = V.x + 'px'; img.style.top = V.y + 'px'; };
  const fit = () => {
    if (!img.naturalWidth || !vw.clientWidth || !vw.clientHeight) return;
    V.nw = img.naturalWidth; V.nh = img.naturalHeight;
    V.fit = V.s = Math.min((vw.clientWidth - 16) / V.nw, (vw.clientHeight - 16) / V.nh);
    V.x = (vw.clientWidth - V.nw * V.s) / 2; V.y = (vw.clientHeight - V.nh * V.s) / 2; V.moved = false; apply();
  };
  const zoomBy = (k, cx, cy) => {
    const s = Math.min(8, Math.max(V.fit * 0.5, V.s * k)), r = s / V.s;
    V.x = cx - (cx - V.x) * r; V.y = cy - (cy - V.y) * r; V.s = s; V.moved = true; apply();
  };
  img.addEventListener('load', fit);
  vw.addEventListener('wheel', e => { e.preventDefault(); const r = vw.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  let drag = null;
  vw.addEventListener('pointerdown', e => {
    if (e.target.closest('.pv-zoom') || e.target.closest('.qs-menu') || e.button === 2) return;
    // 左鍵拖曳＝框選文字（本機 OCR，見 tocqs.js）；移動影像改用 Shift＋拖曳或滑鼠中鍵（和逐頁核對相同）
    if (e.button === 0 && !e.shiftKey && img.naturalWidth) { tqStart(e, vw, img, V); return; }
    tqClose();
    drag = { x: e.clientX - V.x, y: e.clientY - V.y }; vw.setPointerCapture(e.pointerId); vw.classList.add('panning');
  });
  vw.addEventListener('pointermove', e => { if (drag) { V.x = e.clientX - drag.x; V.y = e.clientY - drag.y; V.moved = true; apply(); } });
  vw.addEventListener('pointerup', () => { drag = null; vw.classList.remove('panning'); });

  const btn = (text, fn, label) => { const b = make('button', '', text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); b.onclick = fn; zoom.append(b); return b; };
  const prev = btn('‹ 上一頁', () => go(idx - 1)), next = btn('下一頁 ›', () => go(idx + 1));
  btn('−', () => zoomBy(0.8, vw.clientWidth / 2, vw.clientHeight / 2), '縮小');
  btn('符合視窗', fit);
  btn('＋', () => zoomBy(1.25, vw.clientWidth / 2, vw.clientHeight / 2), '放大');
  vw.append(img, tag, zoom); box.replaceChildren(vw);
  tvObs = new ResizeObserver(() => { if (!V.moved) fit(); }); tvObs.observe(vw);

  let pages = [], idx = 0, pdf = null;
  const alive = () => TOC.cur === f.name && vw.isConnected;
  async function go(i) {
    if (i < 0 || i >= pages.length) return;
    idx = i; prev.disabled = i === 0; next.disabled = i === pages.length - 1;
    tag.textContent = `第 ${i + 1}${pages.length > 1 ? ' / ' + pages.length : ''} 頁・${f.name}`;
    if (!pages[i].url) {
      tag.textContent += '（轉換中…）';
      await ensure(i);
      if (!alive() || idx !== i) return;
      tag.textContent = `第 ${i + 1}${pages.length > 1 ? ' / ' + pages.length : ''} 頁・${f.name}`;
    }
    img.src = pages[i].url;
  }
  async function ensure(i) {
    if (pages[i].url) return;
    const pg = await pdf.getPage(i + 1), vp0 = pg.getViewport({ scale: 1 });
    const sc = Math.min(3, 3200 / Math.max(vp0.width, vp0.height)), vp = pg.getViewport({ scale: sc });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    pages[i].url = cv.toDataURL('image/jpeg', 0.92);
  }
  // 給 AI 辨識用：前 max 頁（封面、目錄頁）縮成長邊 2000 的 JPEG（base64）
  TV.images = async max => {
    const out = [];
    for (let i = 0; i < Math.min(max, pages.length); i++) {
      await ensure(i);
      const im = await new Promise((ok, no) => { const x = new Image(); x.onload = () => ok(x); x.onerror = () => no(new Error('影像載入失敗')); x.src = pages[i].url; });
      const k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas');
      cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
      out.push(cv.toDataURL('image/jpeg', 0.9).split(',')[1]);
    }
    return out;
  };
  (async () => {
    try {
      if (f.type === 'application/pdf') {
        tag.textContent = '載入 PDF 中…';
        await loadPdfJs();
        pdf = await pdfjsLib.getDocument({ url: tocUrl(f.name), cMapUrl: PDFJS + 'cmaps/', cMapPacked: true }).promise;
        if (!alive()) return;
        pages = Array.from({ length: pdf.numPages }, () => ({ url: '' }));
      } else pages = [{ url: tocUrl(f.name) }];
      await go(0);
    } catch (e) {
      if (!alive()) return;
      tag.textContent = '無法顯示：' + e.message;
      if (f.type === 'application/pdf') { const fr = make('iframe', 'toc-frame'); fr.title = f.name; fr.src = tocUrl(f.name); box.replaceChildren(fr); } // 備援：瀏覽器內建的 PDF 檢視
    }
  })();
}
async function tocShow() {
  const box = $('tocTable'), f = TOC.files.find(x => x.name === TOC.cur);
  $('tocInfo').textContent = f ? f.name : ''; $('tocStatus').textContent = '';
  ['tocOpen', 'tocUpload', 'tocDry', 'tocAi'].forEach(id => { $(id).disabled = !f; });
  tocFillForm(null, f);
  if (!f) { box.replaceChildren(make('div', 'toc-empty', TOC.files.length ? '請從左側「資料」選擇目次檔案' : 'toc 資料夾裡沒有圖檔或 PDF')); return; }
  tvMount(f);
  try {
    const r = parse(await api('uploadToc.php', { action: 'info', f: f.name }), {});
    if (TOC.cur !== f.name) return;
    tocFillForm(r.meta, f); $('tocStatus').textContent = tocStatusText(r.upload);
  } catch (e) {}
}

// 目次模式下，側欄的「資料」下拉選單改列 toc 資料夾的檔案
const tocOrigChange = $('issueSelect').onchange;
$('issueSelect').onchange = e => {
  if (!tocMode()) return tocOrigChange.call($('issueSelect'), e);
  TOC.cur = $('issueSelect').value; tocShow();
};

/* ---------- 用刊名到後台查 ISSN（封面沒印 ISSN 時） ---------- */
function tocSetIssn(it) {
  const el = $('tmIssn'); el.value = it.issn;
  el.classList.add('ai-filled'); setTimeout(() => el.classList.remove('ai-filled'), 1800);
  $('tmIssnCands').hidden = true;
  toast('已填入 ISSN：' + it.issn + '（後台：' + it.title + '），請核對後按「儲存」');
}
// 回傳 true 表示 ISSN 欄位已填好
async function tocFindIssn() {
  const name = $('tmName').value.trim(), btn = $('tmIssnFind'), cands = $('tmIssnCands');
  if (!name) { toast('請先填寫刊名，才能到後台查 ISSN'); return false; }
  btn.disabled = true; btn.textContent = '查詢中…'; cands.hidden = true; cands.replaceChildren();
  try {
    const body = new URLSearchParams({ title: name }); const k = getUserKey(); if (k) body.append('api_key', k);
    const r = await fetch('lookupJournal.php', { method: 'POST', body });
    const txt = await r.text(); if (!r.ok) throw new Error(txt || r.status);
    const d = parse(txt, { items: [] }), items = (d.items || []).filter(x => x.issn);
    if (!items.length) { toast(d.items && d.items.length ? '後台有這本期刊，但沒有登錄 ISSN' : '後台找不到「' + name + '」：請確認刊名（後台用繁體），或直接輸入 ISSN'); return false; }
    if (items.length === 1) { tocSetIssn(items[0]); return true; }
    items.forEach(it => { const b2 = make('button', 'btn', it.title + '・' + it.issn); b2.type = 'button'; b2.onclick = () => tocSetIssn(it); cands.append(b2); });
    cands.hidden = false; toast('後台有 ' + items.length + ' 本符合，請選一本');
    return false;
  } catch (e) { toast('查詢 ISSN 失敗：' + e.message); return false; }
  finally { btn.disabled = false; btn.textContent = '查詢'; }
}
$('tmIssnFind').onclick = tocFindIssn;
$('tmNewYes').onchange = () => { if ($('tmNewYes').checked) $('tmNewNo').checked = false; };
$('tmNewNo').onchange = () => { if ($('tmNewNo').checked) $('tmNewYes').checked = false; };
function tocMeta() {
  const meta = {};
  Object.keys(TM).forEach(k => { meta[k] = $(TM[k]).value.trim(); });
  meta['新到狀態'] = $('tmNewYes').checked ? 'yes' : $('tmNewNo').checked ? 'no' : '';
  return meta;
}
// 儲存欄位；伺服器會依「刊名-年月-第O期」把 toc/ 裡的檔案改名，這裡同步更新畫面。回傳 {renamed, note}
async function tocSave() {
  const old = TOC.cur, f = TOC.files.find(x => x.name === old);
  const r = parse(await api('uploadToc.php', { action: 'savemeta', f: old, meta: JSON.stringify(tocMeta()) }), {});
  let renamed = false;
  if (r._name && r._name !== old && f) { // 同一個 f 物件改名，檢視器（已載入的頁面）不用重新載入
    f.name = r._name; TOC.cur = r._name; renamed = true;
    tocFillSelect(); $('tocInfo').textContent = r._name;
    const tag = document.querySelector('.toc-viewer .pv-tag'); if (tag) tag.textContent = tag.textContent.split(old).join(r._name);
  }
  tocFillForm(r, f);
  return { renamed, note: r._note || '' };
}
$('tocForm').onsubmit = async e => {
  e.preventDefault();
  if (!TOC.cur) return;
  try { const s = await tocSave(); toast(s.renamed ? '已儲存，檔名已改為：' + TOC.cur : s.note ? '已儲存目次資料。' + s.note : '已儲存目次資料'); } catch (err) { toast('儲存失敗：' + err.message); }
};
$('tocRefresh').onclick = tocRender;
$('tocOpen').onclick = () => { if (TOC.cur) window.open(tocUrl(TOC.cur), '_blank', 'noopener'); };
async function tocSend(action, btn, label) {
  if (!TOC.cur) return;
  btn.disabled = true; btn.textContent = '處理中…';
  try {
    if (!$('tmIssn').value.trim() && $('tmName').value.trim()) await tocFindIssn(); // 順便把查到的 ISSN 填進欄位；查不到也不擋，伺服器會直接用刊名找期刊
    await tocSave(); // 先把畫面上的欄位存起來，送出的就是畫面上看到的
    const r = parse(await api('uploadToc.php', { action, f: TOC.cur }), {});
    $('tocStatus').textContent = tocStatusText(r);
    toast(r.message || (r.ok ? '完成' : '失敗'));
  } catch (e) { $('tocStatus').textContent = '失敗：' + e.message; toast(e.message); }
  finally { btn.disabled = false; btn.textContent = label; }
}
$('tocDry').onclick = () => tocSend('dryrun', $('tocDry'), '試送（不儲存）');
$('tocUpload').onclick = () => {
  if (!TOC.cur) return;
  if (!confirm('確定要把「' + TOC.cur + '」新增到圖書館後台的期刊目次嗎？\n\n送出後要到後台才能刪除。建議先按「試送」確認。')) return;
  tocSend('upload', $('tocUpload'), '上傳目次');
};

/* ---------- AI 辨識：讀封面／目錄頁，自動填入左側欄位（草稿，核對後按「儲存」） ---------- */
$('tocAi').onclick = async () => {
  if (!TOC.cur || !TV.images) return toast('影像還沒載入完成');
  const btn = $('tocAi'), label = btn.textContent, box = $('tocTable').querySelector('.toc-viewer');
  btn.disabled = true; btn.textContent = '辨識中…'; btn.classList.add('loading');
  if (box && typeof aiScan === 'function') aiScan(box, true);
  try {
    const images = await TV.images(2);
    const body = new URLSearchParams(); images.forEach(x => body.append('images[]', x)); body.append('name', TOC.cur.replace(/.[^.]+$/, ''));
    const k = getUserKey(); if (k) body.append('api_key', k);
    const r = await fetch('analyzeToc.php', { method: 'POST', body });
    const txt = await r.text(); if (!r.ok) throw new Error(txt || r.status);
    const a = parse(txt, {}), filled = [];
    Object.keys(TM).forEach(key => {
      const v = (a[key] || '').trim(); if (!v || !(key in a)) return;
      const el = $(TM[key]); if (el.tagName === 'SELECT') return;
      el.value = v; filled.push(key);
      el.classList.add('ai-filled'); setTimeout(() => el.classList.remove('ai-filled'), 1800);
    });
    toast(filled.length ? `AI 已填入：${filled.join('、')}，請核對後按「儲存」` : 'AI 沒有在影像上找到卷期年月資料');
    // 封面通常不印 ISSN：讀到刊名、ISSN 還是空的，就用刊名到後台查
    if (!$('tmIssn').value.trim() && $('tmName').value.trim()) await tocFindIssn();
  } catch (e) { toast('AI 辨識失敗：' + e.message); }
  finally { if (box && typeof aiScan === 'function') aiScan(box, false); btn.disabled = false; btn.textContent = label; btn.classList.remove('loading'); }
};
