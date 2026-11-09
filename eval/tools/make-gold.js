#!/usr/bin/env node
// 範例庫 Excel → 每張影像的標準答案，並分層抽樣出「基準評測」用的樣本。不呼叫 AI、不耗額度。
// 用法：node eval/tools/make-gold.js [--lib z/期刊] [--per-folder 12] [--folders 2] [--dev 3] [--no-copy]
// 輸出（都在 eval/gold/，已被 .gitignore 擋住）：
//   qikan_all.csv     所有「可推算每張影像頁碼」的影像（題名、作者、專欄、廣告只標在紀錄的第一張影像）
//   qikan_sample.csv  抽樣結果（含 split 欄位：dev＝開發集、eval＝評測集）
// 抽樣的影像會複製到 img/期刊/<資料夾>/，讓編目工作臺的 analyze.php 讀得到。
'use strict';
const fs = require('fs');
const path = require('path');
const { readXlsx } = require('../lib/xlsx');
const { toCSV } = require('../lib/csv');

const ROOT = path.join(__dirname, '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; };
const LIB = path.resolve(ROOT, arg('lib', path.join('z', '期刊')));
const PER_FOLDER = +arg('per-folder', 12), FOLDERS = +arg('folders', 2), DEV = +arg('dev', 3);
const COPY = !process.argv.includes('--no-copy');
const GROUP = '期刊'; // 在 img/ 底下的分類資料夾（下拉選單會顯示成「期刊」分類）

// ---- 本機影像索引 ----
const index = new Map();
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.jpe?g$/i.test(e.name)) index.set(e.name.toLowerCase(), { path: p, folder: path.basename(path.dirname(p)), name: e.name }); } })(LIB);

let seed = 20261109; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---- 逐個 Excel 轉成「影像」層級 ----
const images = new Map(); // key = 影像完整路徑
const stat = {};
for (const f of fs.readdirSync(LIB).filter(x => x.endsWith('.xlsx'))) {
  const journal = f.replace(/\.xlsx$/, '').replace(/_[A-Za-z0-9]{7}$/, '').replace(/_/g, ' ');
  const { header, records } = readXlsx(path.join(LIB, f));
  const fileCol = ['數位物件檔案名稱', '檔案上傳'].find(c => header.includes(c));
  const s = stat[journal] = { 紀錄: records.length, 可用紀錄: 0, 影像: 0, 括號頁碼紀錄: 0, 缺影像紀錄: 0, 張數不符: 0 };
  if (!fileCol) continue;
  for (const r of records) {
    const pg = r['頁數'] || ''; const m = pg.match(/^(\[?)(\d+)(\]?)(?:\s*-\s*(\[?)(\d+)(\]?))?$/); if (!m) continue;
    const bracket = !!(m[1] || m[3] || m[4] || m[6]); const a = +m[2], b = m[5] ? +m[5] : a;
    const files = (r[fileCol] || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).map(x => x.replace(/\.jpe?g$/i, ''));
    if (!files.length) continue;
    const found = files.map(x => index.get((x + '.jpg').toLowerCase())); if (found.some(x => !x)) { s.缺影像紀錄++; continue; }
    if (b < a || files.length !== b - a + 1) { s.張數不符++; continue; }
    s.可用紀錄++; if (bracket) s.括號頁碼紀錄++;
    const ad = r['是否為廣告'] === '是';
    found.forEach((im, i) => {
      if (!images.has(im.path)) images.set(im.path, { journal, folder: im.folder, name: im.name.replace(/\.jpe?g$/i, ''), path: im.path, pages: new Set(), articles: [] });
      const g = images.get(im.path);
      g.pages.add(bracket ? '*' : String(a + i)); // 括號頁碼（編目者推算、版面上不一定印著）→ 這張影像不評頁碼
      if (i === 0) g.articles.push({ 題名: r['主要題名'] || '', 作者: r['作者'] || '', 作者角色: r['作者角色頭銜'] || '', 專欄: r['專欄名稱'] || '', 廣告: ad ? '是' : '否' });
      else if (ad) g.cont_ad = true;
    });
    s.影像 += files.length;
  }
}
// 頁碼互相矛盾的影像（不同紀錄推算出不同頁碼）→ 不用
let conflicts = 0; const pool = [];
for (const g of images.values()) { const ps = [...g.pages]; if (ps.length > 1) { conflicts++; continue; } g.page = ps[0]; g.kind = g.articles.length ? (g.articles.some(a => a.廣告 === '是') ? 'start_ad' : 'start') : 'cont'; pool.push(g); }

const toRows = (g, extra = {}) => (g.articles.length ? g.articles : [{ 題名: '', 作者: '', 作者角色: '', 專欄: '', 廣告: '' }]).map(a => ({ 資料夾: `${GROUP}/${g.folder}`, 影像: g.name, 題名: a.題名, 作者: a.作者, 作者角色: a.作者角色, 專欄名稱: a.專欄, 是否廣告: a.廣告, 印刷頁碼: g.page, 分組: g.journal, 類別: g.kind, ...extra }));
const COLS = ['資料夾', '影像', '題名', '作者', '作者角色', '專欄名稱', '是否廣告', '印刷頁碼', '分組', '類別', 'split'];
fs.mkdirSync(path.join(ROOT, 'eval', 'gold'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'eval', 'gold', 'qikan_all.csv'), toCSV(pool.flatMap(g => toRows(g, { split: '' })), COLS));

// ---- 分層抽樣：每個刊物挑 FOLDERS 個資料夾（分散在不同冊），每個資料夾 PER_FOLDER 張 ----
// 同一個資料夾的影像會一起送（每 4 張一次請求），所以集中在少數資料夾可以減少請求次數
const sample = []; const sel = {};
const byJournal = new Map(); for (const g of pool) { if (!byJournal.has(g.journal)) byJournal.set(g.journal, new Map()); const m = byJournal.get(g.journal); if (!m.has(g.folder)) m.set(g.folder, []); m.get(g.folder).push(g); }
for (const [journal, folders] of byJournal) {
  const names = [...folders.keys()].filter(k => folders.get(k).length >= PER_FOLDER).sort();
  const picks = names.length <= FOLDERS ? names : Array.from({ length: FOLDERS }, (_, i) => names[Math.floor((i + 0.5) * names.length / FOLDERS)]);
  for (const folder of picks) {
    const all = folders.get(folder); const take = [];
    const quota = { start: Math.round(PER_FOLDER * 0.5), start_ad: Math.round(PER_FOLDER * 0.17), cont: PER_FOLDER };
    for (const kind of ['start', 'start_ad', 'cont']) { const c = shuffle(all.filter(g => g.kind === kind && !take.includes(g))); take.push(...c.slice(0, kind === 'cont' ? PER_FOLDER - Math.min(PER_FOLDER, take.length + 0) : quota[kind])); }
    // 不夠的用其他影像補滿
    if (take.length < PER_FOLDER) take.push(...shuffle(all.filter(g => !take.includes(g))).slice(0, PER_FOLDER - take.length));
    const chosen = take.slice(0, PER_FOLDER); const devSet = new Set(shuffle(chosen).slice(0, DEV));
    for (const g of chosen) { g.split = devSet.has(g) ? 'dev' : 'eval'; sample.push(g); }
    sel[`${journal}｜${folder}`] = chosen.length;
  }
}
fs.writeFileSync(path.join(ROOT, 'eval', 'gold', 'qikan_sample.csv'), toCSV(sample.flatMap(g => toRows(g, { split: g.split })), COLS));

// ---- 複製抽樣的影像到 img/期刊/<資料夾>/ ----
let copied = 0;
if (COPY) for (const g of sample) { const dir = path.join(ROOT, 'img', GROUP, g.folder); fs.mkdirSync(dir, { recursive: true }); const dst = path.join(dir, g.name + '.jpg'); if (!fs.existsSync(dst)) { fs.copyFileSync(g.path, dst); copied++; } }

// ---- 報告 ----
console.log(`範例庫：${LIB}\n本機影像 ${index.size} 張\n`);
console.table(stat);
console.log(`\n可用影像（頁碼可推算、沒有矛盾）：${pool.length} 張；頁碼互相矛盾而略過：${conflicts} 張`);
const kinds = {}; pool.forEach(g => kinds[g.kind] = (kinds[g.kind] || 0) + 1); console.log('   類別：', JSON.stringify(kinds), '（start＝紀錄的第一張，start_ad＝廣告，cont＝續頁）');
console.log(`   頁碼不評（括號頁碼）：${pool.filter(g => g.page === '*').length} 張`);
const by = {}; for (const g of sample) { const k = g.journal; by[k] = by[k] || { 影像: 0, dev: 0, eval: 0, 資料夾: new Set() }; by[k].影像++; by[k][g.split]++; by[k].資料夾.add(g.folder); }
console.log(`\n抽樣 ${sample.length} 張（每個資料夾 ${PER_FOLDER} 張，開發集 ${DEV} 張）：`);
console.table(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { ...v, 資料夾: v.資料夾.size }])));
const reqs = Object.values(sel).reduce((n, c) => n + Math.ceil(c / 4), 0);
console.log(`\n預估請求次數：每輪約 ${reqs} 次（每 4 張一次）。${COPY ? `已複製 ${copied} 張影像到 img/${GROUP}/。` : '（未複製影像）'}`);
console.log('輸出：eval/gold/qikan_all.csv、eval/gold/qikan_sample.csv');
