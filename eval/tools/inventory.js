#!/usr/bin/env node
// 範例庫盤點：逐個 Excel 檢查資料品質與影像對應。不呼叫 AI、不耗額度。
// 用法：node eval/tools/inventory.js [範例庫資料夾，預設 z/期刊]
'use strict';
const fs = require('fs');
const path = require('path');
const { readXlsx } = require('../lib/xlsx');

const ROOT = path.join(__dirname, '..', '..');
const dir = path.resolve(process.argv[2] || path.join(ROOT, 'z', '期刊'));

const index = new Map(); const byFolder = new Map();
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.jpe?g$/i.test(e.name)) { index.set(e.name.toLowerCase(), p); const f = path.basename(path.dirname(p)); byFolder.set(f, (byFolder.get(f) || 0) + 1); } } })(dir);
console.log(`資料夾：${dir}\n本機影像：${index.size} 張，分佈在 ${byFolder.size} 個資料夾\n`);

const rows = [];
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.xlsx'))) {
  const { header, records } = readXlsx(path.join(dir, f));
  const fileCols = ['數位物件檔案名稱', '檔案上傳'].filter(c => header.includes(c));
  const r = { Excel: f.replace(/\.xlsx$/, ''), 筆數: records.length, 有頁數: 0, 頁數格式異常: 0, 檔名欄位: fileCols.length ? '有' : '無', 檔名數: 0, 本機找得到: 0, 可轉標準答案: 0, 條碼號: new Set(), 刊名: new Set(), 有題名: 0, 有專欄: 0, 有作者: 0, 廣告: 0 };
  const bad = [];
  for (const rec of records) {
    if (rec['條碼號']) r.條碼號.add(rec['條碼號']); if (rec['刊名']) r.刊名.add(rec['刊名']);
    if (rec['主要題名']) r.有題名++; if (rec['專欄名稱']) r.有專欄++; if (rec['作者']) r.有作者++; if (rec['是否為廣告'] === '是') r.廣告++;
    const pg = rec['頁數'] || ''; if (pg) r.有頁數++;
    const m = pg.match(/^\[?(\d+)\]?(?:\s*-\s*\[?(\d+)\]?)?$/);
    if (pg && !m) { r.頁數格式異常++; if (bad.length < 4) bad.push(pg); }
    const files = fileCols.length ? (rec[fileCols[0]] || rec[fileCols[1]] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => s.replace(/\.jpe?g$/i, '')) : [];
    r.檔名數 += files.length;
    const found = files.filter(x => index.has((x + '.jpg').toLowerCase())).length; r.本機找得到 += found;
    if (m && files.length && found === files.length) { const a = +m[1], b = m[2] ? +m[2] : a; if (b >= a && files.length === b - a + 1) r.可轉標準答案 += files.length; }
  }
  r.異常範例 = bad.join(' / '); rows.push(r);
}
for (const r of rows) {
  console.log(`== ${r.Excel}`);
  console.log(`   刊名：${[...r.刊名].join('、') || '–'}；條碼號 ${r.條碼號.size} 個；筆數 ${r.筆數}（題名 ${r.有題名}、專欄 ${r.有專欄}、作者 ${r.有作者}、廣告 ${r.廣告}）`);
  console.log(`   頁數：有 ${r.有頁數} 筆，格式異常 ${r.頁數格式異常} 筆${r.異常範例 ? '（例：' + r.異常範例 + '）' : ''}`);
  console.log(`   影像檔名欄位：${r.檔名欄位}；Excel 列出 ${r.檔名數} 個檔名，本機找得到 ${r.本機找得到} 個；可直接轉成標準答案的影像：${r.可轉標準答案} 張`);
  const missing = [...r.條碼號].filter(b => ![...byFolder.keys()].some(f => f.includes(b)));
  if (missing.length) console.log(`   ⚠ 這些條碼號在本機沒有對應資料夾：${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …共 ' + missing.length + ' 個' : ''}`);
}
