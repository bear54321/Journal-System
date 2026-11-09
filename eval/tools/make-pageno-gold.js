#!/usr/bin/env node
// 產生「OCR 頁碼試驗」用的標準答案：
//   1. 公報（貴州、河北）：用我們逐張核對過的頁碼（取兩個頁碼中較小者）
//   2. z/ 範例庫的各刊物：從 Excel 的「頁數」與「數位物件檔案名稱」推算每張影像的印刷頁碼
//      （只用「影像張數 = 頁數範圍」的紀錄，例如頁數 3-6、4 張影像 → 3、4、5、6；而且影像都在本機）
// 輸出：eval/gold/pageno_experiment.csv（含「檔案路徑」欄，給裁切程式用）
'use strict';
const fs = require('fs');
const path = require('path');
const { readXlsx } = require('../lib/xlsx');
const { toCSV } = require('../lib/csv');

const ROOT = path.join(__dirname, '..', '..');
const N = +(process.argv.find(a => a.startsWith('--per='))?.slice(6) || 20);
const Z = path.join(ROOT, 'z');

// 本機所有 jpg 的索引（檔名小寫 → 路徑）
const index = new Map();
(function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.jpe?g$/i.test(e.name)) index.set(e.name.toLowerCase(), p); } })(Z);

// 可重現的亂數
let seed = 20261109; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const rows = [];
// ---- 1. 公報（已核對的頁碼）----
const GZ = 'MC01878-00-00000-00169-', HB = 'MC01510-00-00000-01451-';
const gz = path.join(ROOT, 'img', '公報', '貴州省政府公報'), hb = path.join(ROOT, 'img', '公報', '河北省政府公報');
const gazette = [];
if (fs.existsSync(gz)) for (let n = 1; n <= 15; n++) gazette.push(['貴州省政府公報', gz, GZ + String(n).padStart(4, '0'), n === 1 ? '' : String(2482 + 2 * (n - 2))]);
if (fs.existsSync(hb)) [[3, '1'], [4, '2'], [5, '4'], [6, '6']].forEach(([n, p]) => gazette.push(['河北省政府公報', hb, HB + String(n).padStart(4, '0'), p]));
for (const [j, dir, name, page] of gazette) rows.push({ 刊物: j, 影像: name, 檔案路徑: path.join(dir, name + '.jpg'), 印刷頁碼: page, 來源: '人工核對' });

// ---- 2. 範例庫（Excel 推算）----
const stat = {};
for (const f of fs.existsSync(Z) ? fs.readdirSync(Z).filter(x => x.endsWith('.xlsx')) : []) {
  let data; try { data = readXlsx(path.join(Z, f)); } catch (e) { console.warn('略過', f, e.message); continue; }
  const fileCol = ['數位物件檔案名稱', '檔案上傳'].find(c => data.header.includes(c)); if (!fileCol) { stat[f] = '沒有檔名欄位'; continue; }
  const journal = f.replace(/\.xlsx$/, '').replace(/_[A-Za-z0-9]{7}$/, '');
  const cand = [];
  for (const r of data.records) {
    const m = (r['頁數'] || '').match(/^\[?(\d+)\]?(?:\s*-\s*\[?(\d+)\]?)?$/); if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    const files = (r[fileCol] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => s.replace(/\.jpe?g$/i, ''));
    if (!files.length || b < a || files.length !== b - a + 1) continue;
    const paths = files.map(x => index.get((x + '.jpg').toLowerCase())); if (paths.some(p => !p)) continue;
    files.forEach((x, i) => cand.push({ 刊物: journal, 影像: x, 檔案路徑: paths[i], 印刷頁碼: String(a + i), 來源: 'Excel 推算' }));
  }
  stat[f] = `${cand.length} 張可用`;
  rows.push(...shuffle(cand).slice(0, N));
}
rows.forEach((r, i) => { r.id = String(i + 1).padStart(4, '0'); });
fs.mkdirSync(path.join(ROOT, 'eval', 'gold'), { recursive: true });
const out = path.join(ROOT, 'eval', 'gold', 'pageno_experiment.csv');
fs.writeFileSync(out, toCSV(rows, ['id', '刊物', '影像', '檔案路徑', '印刷頁碼', '來源']));
console.log('各 Excel：'); for (const [k, v] of Object.entries(stat)) console.log('  ' + k + ' → ' + v);
const by = {}; rows.forEach(r => by[r.刊物] = (by[r.刊物] || 0) + 1);
console.log(`\n輸出 ${rows.length} 張（每個刊物最多 ${N} 張）：`); console.table(by); console.log(out);
