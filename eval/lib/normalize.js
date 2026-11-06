// 正規化：AI 輸出與標準答案都要先經過同一套規則，再比對。
// 規則都寫成程式，每次重跑結果才會一樣。可在 eval/variants.json 增加自己的異體字對照。
'use strict';
const fs = require('fs');
const path = require('path');

// ---- 異體字（左邊的字都換成右邊的字）----
const DEFAULT_VARIANTS = {
  '臺': '台', '著': '著', '着': '著', '爲': '為', '衆': '眾', '羣': '群', '峯': '峰', '綫': '線', '啓': '啟',
  '敍': '敘', '鎭': '鎮', '裏': '裡', '麽': '麼', '週': '周', '緖': '緒', '纔': '才', '遅': '遲', '册': '冊',
  '体': '體', '蹟': '跡', '迹': '跡', '覈': '核', '勅': '敕', '閒': '間', '搾': '榨',
};
let VARIANTS = { ...DEFAULT_VARIANTS };
function loadVariants(file) {
  const f = file || path.join(__dirname, '..', 'variants.json');
  if (fs.existsSync(f)) {
    try { VARIANTS = { ...DEFAULT_VARIANTS, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch (e) { console.warn('variants.json 讀取失敗，使用預設：' + e.message); }
  }
  return VARIANTS;
}

// ---- 文字：全形→半形、去空白與標點、異體字統一；可選擇去掉結尾的括號附註，如「(不另行文)」 ----
function normText(s, opts = {}) {
  s = String(s == null ? '' : s).normalize('NFKC');
  if (opts.stripRemark) s = s.replace(/\([^()]*\)\s*$/u, '');
  s = s.replace(/[\s\p{P}\p{S}]+/gu, '');
  return [...s].map(c => VARIANTS[c] || c).join('');
}

// ---- 頁碼：「二十一」→21、「廿三」→23、「iv」→4、「—2484—」→2484；有多個數字時取最小的（和 analyze.php 的 ai_page 相同）----
const CN_DIGIT = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
function pageOne(s) {
  s = String(s || '').normalize('NFKC').trim().replace(/[\s()\[\]【】第頁页pP.\-—~～・]+/g, '');
  if (!s) return '';
  if (/^\d{1,4}$/.test(s)) return String(parseInt(s, 10));
  if (/^[ivxlc]{1,6}$/i.test(s)) {
    const v = { i: 1, v: 5, x: 10, l: 50, c: 100 }; let n = 0; s = s.toLowerCase();
    for (let k = 0; k < s.length; k++) { const a = v[s[k]], b = v[s[k + 1]] || 0; n += a < b ? -a : a; }
    return n > 0 ? String(n) : '';
  }
  if (/^[〇零一二三四五六七八九十百廿卅]+$/.test(s)) {
    if (!/[十百廿卅]/.test(s)) { const str = [...s].map(c => CN_DIGIT[c]).join(''); return str.length <= 4 ? String(parseInt(str, 10)) : ''; }
    let total = 0, cur = 0;
    for (const c of s) {
      if (c in CN_DIGIT) cur = CN_DIGIT[c];
      else if (c === '廿') { total += 20; cur = 0; } else if (c === '卅') { total += 30; cur = 0; }
      else if (c === '十') { total += (cur || 1) * 10; cur = 0; } else if (c === '百') { total += (cur || 1) * 100; cur = 0; }
    }
    total += cur; return total > 0 ? String(total) : '';
  }
  return '';
}
function normPage(s) {
  s = String(s == null ? '' : s).normalize('NFKC').trim();
  if (!s) return '';
  let best = '';
  for (const p of s.split(/[\s,，、;；/|\-–—~～至]+/u).filter(Boolean)) {
    const n = pageOne(p);
    if (n !== '' && (best === '' || +n < +best)) best = n;
  }
  return best;
}

// ---- 日期（備用；目前編目工作臺沒有日期欄位，之後要評測報紙等資料時可用）：民國／西元 → YYYY-MM-DD ----
function cnNumber(s) {
  s = String(s).normalize('NFKC');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (/^[〇零一二三四五六七八九]+$/.test(s)) return parseInt([...s].map(c => CN_DIGIT[c]).join(''), 10);
  const p = pageOne(s); return p ? parseInt(p, 10) : NaN;
}
function normDate(s) {
  s = String(s || '').normalize('NFKC').replace(/\s+/g, '');
  let m = s.match(/(?:中華)?民國([\d〇零一二三四五六七八九十百廿卅]+)年([\d〇零一二三四五六七八九十廿卅]+)月([\d〇零一二三四五六七八九十廿卅]+)日?/);
  let y, mo, d;
  if (m) { y = cnNumber(m[1]) + 1911; mo = cnNumber(m[2]); d = cnNumber(m[3]); }
  else if ((m = s.match(/(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return '';
  if (![y, mo, d].every(Number.isFinite) || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---- 編輯距離、錯字率（CER）、相似度 ----
function lev(a, b) {
  a = [...a]; b = [...b];
  if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const cer = (gold, pred) => { const g = [...gold].length; return g ? lev(gold, pred) / g : (pred ? 1 : 0); };
const sim = (a, b) => { const m = Math.max([...a].length, [...b].length); return m ? 1 - lev(a, b) / m : 1; };

// ---- 是否廣告 ----
function normBool(s) {
  s = String(s == null ? '' : s).trim().toLowerCase();
  if (!s) return '';
  return /^(1|是|y|yes|true|廣告|啟事)$/.test(s) ? '1' : /^(0|否|n|no|false)$/.test(s) ? '0' : '';
}

loadVariants();
module.exports = { normText, normPage, normDate, normBool, cer, sim, lev, loadVariants, pageOne };
