#!/usr/bin/env node
// OCR 頁碼試驗：只用「本機 OCR」讀頁眉、頁腳的數字，看能不能找出印刷頁碼（不呼叫 Gemini，不耗額度）。
// 用法：node eval/ocr-pageno.js [--gold eval/gold/pageno_experiment.csv] [--pct 20] [--full] [--limit N]
// 需要：本機 OCR 服務正在執行（http://127.0.0.1:8765），標準答案先用 node eval/tools/make-pageno-gold.js 產生
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseCSV, toCSV } = require('./lib/csv');
const { pageOne } = require('./lib/normalize');

const argv = process.argv.slice(2);
const opt = { gold: path.join(__dirname, 'gold', 'pageno_experiment.csv'), pct: 20, full: false, ocr: 'http://127.0.0.1:8765', limit: 0 };
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--gold') opt.gold = argv[++i]; else if (a === '--pct') opt.pct = +argv[++i]; else if (a === '--full') opt.full = true; else if (a === '--margins') opt.margins = true; else if (a === '--limit') opt.limit = +argv[++i]; else if (a === '--ocr') opt.ocr = argv[++i]; }
const ROOT = path.join(__dirname, '..');
const STRIPS = path.join(__dirname, 'cache', 'ocr-pageno', 'strips' + opt.pct);
const OCRCACHE = path.join(__dirname, 'cache', 'ocr-pageno', `ocr${opt.pct}.json`);
const OUT = path.join(__dirname, 'out', 'ocr-pageno');

let { records } = parseCSV(fs.readFileSync(opt.gold, 'utf8'));
if (opt.limit) records = records.slice(0, opt.limit);
console.log(`標準答案 ${records.length} 張；裁切上下各 ${opt.pct}%${opt.full ? '，另測整頁（縮到 3200）' : ''}`);

// ---- 1. 裁切（PHP GD，原解析度）----
const phpExe = fs.existsSync(path.join(ROOT, 'php', 'php.exe')) ? path.join(ROOT, 'php', 'php.exe') : 'php';
const phpArgs = fs.existsSync(path.join(ROOT, 'php', 'php.ini')) ? ['-c', path.join(ROOT, 'php', 'php.ini'), '-d', 'extension_dir=' + path.join(ROOT, 'php', 'ext')] : [];
const tmpCsv = path.join(__dirname, 'cache', 'ocr-pageno', 'rows.csv'); fs.mkdirSync(path.dirname(tmpCsv), { recursive: true });
fs.writeFileSync(tmpCsv, toCSV(records, ['id', '刊物', '影像', '檔案路徑', '印刷頁碼', '來源']));
const cr = spawnSync(phpExe, [...phpArgs, path.join(__dirname, 'tools', 'crop-strips.php'), tmpCsv, STRIPS, `--pct=${opt.pct}`, ...(opt.full ? ['--full'] : []), ...(opt.margins ? ['--margins'] : [])], { encoding: 'utf8' });
if (cr.status !== 0) { console.error(cr.stdout, cr.stderr); process.exit(1); }
console.log(cr.stdout.trim()); if (cr.stderr.trim()) console.warn(cr.stderr.trim().split('\n').slice(0, 3).join('\n'));

// ---- 2. OCR（有快取，可中斷續跑）----
const cache = fs.existsSync(OCRCACHE) ? JSON.parse(fs.readFileSync(OCRCACHE, 'utf8')) : {};
async function ocr(file) {
  const res = await fetch(opt.ocr + '/ocr', { method: 'POST', body: fs.readFileSync(file), headers: { 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error('OCR 服務回應 ' + res.status + '：' + (await res.text()).slice(0, 100));
  const j = await res.json();
  return (j.items || []).map(i => ({ t: i.text, s: i.score, x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w), h: Math.round(i.h) }));
}
const strips = ['top', 'bottom', ...(opt.margins ? ['left', 'right', 'bcenter'] : []), ...(opt.full ? ['full'] : [])];
(async () => {
  try { await fetch(opt.ocr + '/ping', { signal: AbortSignal.timeout(5000) }); } catch (e) { console.error('連不到本機 OCR 服務（' + opt.ocr + '）。請先啟動：ocr\\start-ocr.bat 或 start.bat'); process.exit(1); }
  let done = 0; const total = records.length * strips.length; const t0 = Date.now();
  for (const r of records) for (const st of strips) {
    const key = `${r.id}_${st}`; done++;
    if (cache[key]) continue;
    const f = path.join(STRIPS, key + '.jpg'); if (!fs.existsSync(f)) continue;
    try { cache[key] = await ocr(f); } catch (e) { console.error(`\n${key}：${e.message}`); continue; }
    if (done % 5 === 0) { fs.writeFileSync(OCRCACHE, JSON.stringify(cache)); process.stdout.write(`\rOCR ${done}/${total}（${Math.round((Date.now() - t0) / 1000)} 秒）`); }
  }
  fs.writeFileSync(OCRCACHE, JSON.stringify(cache)); console.log(`\nOCR 完成（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  report();
})();

// ---- 3. 從 OCR 文字框挑出「單獨的數字」當頁碼候選 ----
function pureNumber(text, score) {
  if (score < 0.5) return null;
  let s = String(text).normalize('NFKC').replace(/[\s\-—–_~・.()\[\]【】<>《》「」『』:：,，、]/g, '').replace(/^第|頁$/g, '');
  if (!s) return null;
  if (/^\d{1,4}$/.test(s)) return String(parseInt(s, 10));
  if (/^[〇零一二三四五六七八九十廿卅百]{1,4}$/.test(s)) { const n = pageOne(s); return n || null; }
  return null;
}
const cands = items => (items || []).map(i => pureNumber(i.t, i.s)).filter(Boolean);
const min = a => a.length ? String(Math.min(...a.map(Number))) : '';

function report() {
  // 區域：頁腳(下方 20%)、頁眉(上方 20%)、左右外緣(寬 15%)、下方中央、整頁(縮到 3200)
  const REG = { 頁腳: 'B', 頁眉: 'T', 右外緣: 'R', 左外緣: 'L', 下方中央: 'C', 整頁: 'F' };
  const has = k => opt.margins || !['R', 'L', 'C'].includes(k);
  const strategies = [];
  for (const [label, k] of Object.entries(REG)) { if (k === 'F' && !opt.full) continue; if (!has(k)) continue; strategies.push({ label: '【單一區域】' + label, regions: [k], mode: 'union' }); }
  if (opt.margins) {
    strategies.push({ label: '下方＋左右外緣（合併取最小）', regions: ['B', 'R', 'L'], mode: 'union' });
    strategies.push({ label: '下方＋下方中央＋左右外緣（合併取最小）', regions: ['B', 'C', 'R', 'L'], mode: 'union' });
    strategies.push({ label: '所有裁切區域含頁眉（合併取最小）', regions: ['B', 'C', 'R', 'L', 'T'], mode: 'union' });
    strategies.push({ label: '依序找：下方中央→頁腳→右外緣→左外緣→頁眉', regions: ['C', 'B', 'R', 'L', 'T'], mode: 'priority' });
  }
  const rows = records.map(r => ({ ...r, R: { B: cands(cache[r.id + '_bottom']), T: cands(cache[r.id + '_top']), R: cands(cache[r.id + '_right']), L: cands(cache[r.id + '_left']), C: cands(cache[r.id + '_bcenter']), F: cands(cache[r.id + '_full']) } }));
  const pick = (r, st) => st.mode === 'union' ? min(st.regions.flatMap(k => r.R[k])) : (st.regions.map(k => min(r.R[k])).find(Boolean) || '');
  const pool = (r, st) => st.regions.flatMap(k => r.R[k]);
  const pct = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '–';
  const groups = new Map([['全部', rows]]); rows.forEach(r => { if (!groups.has(r.刊物)) groups.set(r.刊物, []); groups.get(r.刊物).push(r); });
  let md = `# OCR 頁碼試驗\n\n- 時間：${new Date().toLocaleString('zh-TW')}；影像 ${rows.length} 張；上下裁切各 ${opt.pct}%${opt.margins ? '；左右外緣寬 15%；下方中央＝下方區域的中間 40%' : ''}（都是原解析度）\n- 只用本機 OCR；候選＝文字框內容是「單獨的數字」的框；有多個候選時取最小的（跨頁取較小者）\n- 答案：公報是人工核對過的頁碼；其他刊物由 Excel 的頁數與影像順序推算\n- 「候選裡有答案」＝該方法找到的所有數字裡有正確頁碼（上限）；「正確」＝取最小的剛好是答案\n\n`;
  const errors = [];
  for (const [name, rs] of groups) {
    md += `## ${name}（${rs.length} 張）\n\n| 方法 | 正確 | 候選裡有答案 | 讀到數字但不對 | 沒讀到 |\n|---|---|---|---|---|\n`;
    for (const st of strategies) {
      let ok = 0, hasAns = 0, wrong = 0, none = 0;
      for (const r of rs) {
        const got = pick(r, st);
        if (pool(r, st).includes(r.印刷頁碼)) hasAns++;
        if (got === r.印刷頁碼) ok++; else if (got) wrong++; else none++;
        if (name === '全部' && st.mode === 'priority' && got !== r.印刷頁碼) errors.push({ id: r.id, 刊物: r.刊物, 影像: r.影像, 答案: r.印刷頁碼, 下方中央: r.R.C.join(' '), 頁腳: r.R.B.join(' '), 右外緣: r.R.R.join(' '), 左外緣: r.R.L.join(' '), 頁眉: r.R.T.join(' '), 結果: got ? '讀錯' : '沒讀到', 讀到: got });
      }
      md += `| ${st.label} | ${ok}（${pct(ok, rs.length)}） | ${hasAns}（${pct(hasAns, rs.length)}） | ${wrong}（${pct(wrong, rs.length)}） | ${none}（${pct(none, rs.length)}） |\n`;
    }
    md += '\n';
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  fs.writeFileSync(path.join(OUT, 'errors.csv'), toCSV(errors, ['id', '刊物', '影像', '答案', '下方中央', '頁腳', '右外緣', '左外緣', '頁眉', '結果', '讀到']));
  console.log('\n' + md + `報告：${path.join(OUT, 'report.md')}\n錯誤清單：${path.join(OUT, 'errors.csv')}`);
}
