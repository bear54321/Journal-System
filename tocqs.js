/* ---------- 期刊目次：框選辨識。在影像上拖曳框選 → 本機 OCR → 選單 → 填入左側欄位（和逐頁核對相同的操作） ---------- */
const TQ = { cur: null, busy: false };
const TQ_FIELDS = ['刊名', 'ISSN', '卷', '期', '號', '年', '月'];
const TQ_INPUT = { 刊名: 'tmName', ISSN: 'tmIssn', 卷: 'tmVol', 期: 'tmIssue', 號: 'tmNo', 年: 'tmYear', 月: 'tmMonth' };
const CN_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_RE = /[〇零一二兩三四五六七八九十廿卅]+/;

// 一～九十九（含「十二」「二十三」「廿三」）
function cnToNum(s) {
  s = s.replace(/廿/g, '二十').replace(/卅/g, '三十');
  const m = s.match(/^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
  return /^[〇零一二兩三四五六七八九]+$/.test(s) ? Number([...s].map(c => CN_DIGIT[c]).join('')) : NaN;
}
function tqNum(txt) {
  const m = txt.match(/\d+/);
  if (m) return Number(m[0]);
  const c = txt.match(CN_RE);
  return c ? cnToNum(c[0]) : NaN;
}
// OCR 文字 → 欄位值：ISSN 取 1234-567X；卷／期／號取數字（支援「第三期」）；年取西元四位（民國年換算）；月取 1～12（或「4-6」）
function tqClean(key, raw) {
  const s = String(raw || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\s+/g, '');
  if (key === '刊名') return s.replace(/^[《〈「『“"']+|[》〉」』”"']+$/g, '');
  if (key === 'ISSN') {
    const m = s.match(/(\d{4})[-–—－]?(\d{3}[\dXx])/);
    return m ? m[1] + '-' + m[2].toUpperCase() : '';
  }
  if (key === '年') {
    const m = s.match(/(?:19|20)\d\d/);
    if (m) return m[0];
    const r = s.match(/民國?(\d{2,3})/);
    return r ? String(Number(r[1]) + 1911) : '';
  }
  if (key === '月') {
    const rg = s.match(/(\d{1,2})[-–—－~～至](\d{1,2})/);
    if (rg && +rg[1] >= 1 && +rg[2] <= 12) return rg[1] + '-' + rg[2];
    const um = s.match(new RegExp('(\\d{1,2}|' + CN_RE.source + ')月'));
    const n = um ? tqNum(um[1]) : tqNum(s);
    return n >= 1 && n <= 12 ? String(n) : '';
  }
  // 卷／期／號：優先取緊接在「卷／期／號」字樣前的數字（「2026年第3期（總第237期）」的期是 3，「總第…期」是累計期數，不取）
  const unit = { 卷: '卷', 期: '期', 號: '[號号]' }[key];
  const m = s.match(new RegExp('(?<![總总]第?)第?(\\d+|' + CN_RE.source + ')' + unit));
  if (m) { const n = tqNum(m[1]); return Number.isFinite(n) ? String(n) : ''; }
  const e = s.match(key === '卷' ? /vol\.?(\d+)/i : key === '號' ? /no\.?(\d+)/i : /$^/);
  if (e) return e[1];
  if (/[年月日總总]/.test(s) && !/^第?\d+$/.test(s)) return ''; // 文字裡有別的資料，卻找不到這個欄位
  const n = tqNum(s.replace(/^第/, ''));
  return Number.isFinite(n) ? String(n) : '';
}

function tqClose() {
  const q = TQ.cur;
  if (!q) return;
  TQ.cur = null;
  q.sel.classList.add('out');
  if (q.menu) q.menu.classList.add('out');
  setTimeout(() => { q.sel.remove(); if (q.menu) q.menu.remove(); }, 260);
}
// 畫面座標（相對檢視器）→ 影像座標，裁成 JPEG（長邊最多 1600）的 base64
function tqCrop(img, V, x, y, w, h) {
  const s = V.s, sx = Math.max(0, (x - V.x) / s), sy = Math.max(0, (y - V.y) / s);
  const ex = Math.min(img.naturalWidth, (x + w - V.x) / s), ey = Math.min(img.naturalHeight, (y + h - V.y) / s);
  const cw = ex - sx, ch = ey - sy;
  if (cw < 4 || ch < 4) return null;
  const k = Math.min(1, 1600 / Math.max(cw, ch)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(cw * k)); c.height = Math.max(1, Math.round(ch * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, sx, sy, cw, ch, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92).split(',')[1];
}
// 把文字裡能認出的值填進欄位；回傳實際填入的欄位名稱
function tqFill(keys, text) {
  const done = [];
  keys.forEach(key => {
    const v = tqClean(key, text);
    if (!v) return;
    const el = $(TQ_INPUT[key]);
    el.value = v; el.classList.add('ai-filled');
    setTimeout(() => el.classList.remove('ai-filled'), 1600);
    done.push(key + '：' + v);
  });
  toast(done.length ? '已填入 ' + done.join('、') + '，請核對後按「儲存」' : '「' + text + '」裡認不出這些欄位，請重新框選');
  if (done.length && keys.includes('刊名') && !$('tmIssn').value.trim() && typeof tocFindIssn === 'function') tocFindIssn(); // 框選了刊名、ISSN 還空著：用刊名到後台查
  return done.length > 0;
}

function tqStart(e, box, img, V) {
  tqClose();
  const br = box.getBoundingClientRect();
  const pos = ev => [Math.min(Math.max(ev.clientX - br.left, 0), br.width), Math.min(Math.max(ev.clientY - br.top, 0), br.height)];
  const [x0, y0] = pos(e), sel = make('div', 'pv-sel drawing qs-sel');
  box.append(sel);
  const q = TQ.cur = { sel, menu: null };
  const place = (x1, y1) => {
    sel.style.left = Math.min(x0, x1) + 'px'; sel.style.top = Math.min(y0, y1) + 'px';
    sel.style.width = Math.abs(x1 - x0) + 'px'; sel.style.height = Math.abs(y1 - y0) + 'px';
  };
  place(x0, y0);
  box.setPointerCapture(e.pointerId);
  const move = ev => { const [x, y] = pos(ev); place(x, y); };
  const up = async ev => {
    box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up);
    const [x, y] = pos(ev), rx = Math.min(x0, x), ry = Math.min(y0, y), rw = Math.abs(x - x0), rh = Math.abs(y - y0);
    if (rw < 10 || rh < 10) { if (TQ.cur === q) tqClose(); return; } // 太小視為點一下：取消
    const b64 = tqCrop(img, V, rx, ry, rw, rh);
    if (!b64) { tqClose(); toast('框選範圍在影像之外，請重新框選'); return; }
    TQ.busy = true; sel.className = 'pv-sel scan qs-sel';
    let text = '';
    try { text = String(parse(await api('analyze.php', { mode: 'ocr', engine: 'local', field: 'title', image: b64 }), {}).text || '').trim(); }
    catch (err) { toast(err.message || String(err)); }
    TQ.busy = false;
    if (TQ.cur !== q) return; // 辨識途中使用者已經框選別處或按了 Esc
    if (!text) {
      sel.className = 'pv-sel qs-sel qs-empty'; toast('框選範圍內沒有辨識到文字，請重新框選');
      setTimeout(() => { if (TQ.cur === q) tqClose(); }, 700);
      return;
    }
    sel.className = 'pv-sel done qs-sel';
    const menu = q.menu = make('div', 'qs-menu');
    menu.onpointerdown = ev => ev.stopPropagation();
    const head = make('div', 'qs-text', text); head.title = text;
    const list = make('div', 'qs-list');
    // 一行文字常含好幾個欄位（如「2026 年第 3 期」）：選單每一項都先顯示「會填入什麼」，第一項可一次填入全部認得出的欄位
    const found = TQ_FIELDS.filter(key => key !== '刊名' && tqClean(key, text)); // 刊名任何文字都「認得出」，不放進「全部填入」，要用就單獨點
    if (found.length > 1) {
      const all = make('button', 'qs-item all'); all.type = 'button';
      all.append(make('span', 'qs-star'), make('span', '', '全部填入'), make('span', 'qs-val', found.map(k => k + ' ' + tqClean(k, text)).join('・')));
      all.onclick = () => { if (tqFill(found, text)) tqClose(); };
      list.append(all);
    }
    TQ_FIELDS.forEach(key => {
      const v = tqClean(key, text), bt = make('button', 'qs-item' + (v ? '' : ' dim')); bt.type = 'button';
      bt.append(make('span', 'qs-star'), make('span', '', key), make('span', 'qs-val', v));
      bt.onclick = () => { // 單填一個欄位後選單保留，可以接著點同一行的其他欄位
        if (!v) return toast('「' + text + '」裡認不出「' + key + '」');
        tqFill([key], text); bt.classList.add('used');
      };
      list.append(bt);
    });
    const x2 = make('button', 'qs-close', '×'); x2.type = 'button'; x2.title = '關閉（Esc）'; x2.onclick = tqClose;
    menu.append(x2, head, list); box.append(menu);
    // 優先放在區域右側，其次左側、下方、上方，選第一個不蓋住區域、也不超出視窗的位置
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const clampY = v => Math.min(Math.max(6, v), br.height - mh - 6), clampX = v => Math.min(Math.max(6, v), br.width - mw - 6);
    const cands = [[rx + rw + 10, clampY(ry + rh / 2 - mh / 2)], [rx - mw - 10, clampY(ry + rh / 2 - mh / 2)], [clampX(rx), ry + rh + 10], [clampX(rx), ry - mh - 10]];
    const fit = c => c[0] >= 6 && c[1] >= 6 && c[0] + mw <= br.width - 6 && c[1] + mh <= br.height - 6;
    const [mx, my] = cands.find(fit) || [clampX(rx + rw + 10), clampY(ry + rh / 2 - mh / 2)];
    menu.style.left = mx + 'px'; menu.style.top = my + 'px';
  };
  box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && TQ.cur && !TQ.busy) tqClose(); });
