#!/usr/bin/env node
// 評測腳本：用「標準答案（CSV）」當考卷，讓編目工作臺的 AI 分析影像，再逐欄計分。
// 需要：Node 18 以上、編目工作臺的伺服器正在執行（start.bat）。說明與範例見 eval/README.md
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCSV, toCSV } = require('./lib/csv');
const { normText, normPage } = require('./lib/normalize');
const { scoreImage, aggregate } = require('./lib/score');

// ---------- 參數 ----------
const argv = process.argv.slice(2);
const opt = { base: 'http://localhost:8080', runs: 1, mode: 'batch', group: 4, split: 'all', delay: 1500, engine: 'api', thread: '^線裝書/', stripRemark: true };
const usage = () => { console.log(fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8').split('\n').slice(0, 60).join('\n')); process.exit(0); };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], nx = () => argv[++i];
  if (a === '--gold') opt.gold = nx(); else if (a === '--base') opt.base = nx().replace(/\/$/, ''); else if (a === '--tag') opt.tag = nx();
  else if (a === '--runs') opt.runs = +nx(); else if (a === '--mode') opt.mode = nx(); else if (a === '--group') opt.group = +nx();
  else if (a === '--model') opt.model = nx(); else if (a === '--engine') opt.engine = nx(); else if (a === '--limit') opt.limit = +nx();
  else if (a === '--split') opt.split = nx(); else if (a === '--delay') opt.delay = +nx(); else if (a === '--thread') opt.thread = nx();
  else if (a === '--api-key') opt.apiKey = nx(); else if (a === '--variants') opt.variants = nx();
  else if (a === '--keep-remark') opt.stripRemark = false; else if (a === '--rescore') opt.rescore = true; else if (a === '--force') opt.force = true;
  else if (a === '--dry-run') opt.dry = true; else if (a === '--help' || a === '-h') usage();
  else { console.error('不認得的參數：' + a); process.exit(1); }
}
if (!opt.gold) usage();
if (opt.variants) require('./lib/normalize').loadVariants(opt.variants);
opt.apiKey = opt.apiKey || process.env.GEMINI_API_KEY || '';
opt.tag = opt.tag || path.basename(opt.gold).replace(/\.[^.]+$/, '') + (opt.model ? '_' + opt.model : '');
const OUT = path.join(__dirname, 'out', opt.tag), CACHE = path.join(__dirname, 'cache', opt.tag);

// ---------- 欄目標題（和 config.php 的 SECTION_TITLE_BOOKS 一致）----------
// 這些刊物的 AI 輸出會多一個 section_title（版面印出的欄目標題）；題名 = 欄目標題 + 連接符號 + 篇名。
// 注意：評測抽樣的影像不是連續的頁面，所以只評「這一頁印出了欄目標題」的情況；「沒印就延用上一頁」要用連續頁面另外測。
const SECTION_BOOKS = { '大陸匪情季報': ' - ' };
const sectionJoiner = book => { const k = Object.keys(SECTION_BOOKS).find(n => book.includes(n)); return k ? SECTION_BOOKS[k] : null; };
const withSection = (book, arts) => { const j = sectionJoiner(book); return j == null ? arts : (arts || []).map(a => a.section_title && a.title && !String(a.title).startsWith(a.section_title) ? { ...a, title: a.section_title + j + a.title } : a); };

// ---------- 讀標準答案 ----------
const ALIASES = {
  book: ['book', '資料夾', '資料', '期刊', '書名路徑', '刊名路徑'], image: ['image', '影像', '影像編號', '影像檔名', '檔名'],
  title: ['title', '題名', '主要題名', '篇名'], author: ['author', '作者'], role: ['role', '作者角色', '角色', '作者角色頭銜'],
  column: ['column', '專欄', '專欄名稱'], ad: ['ad', '廣告', '是否廣告'], page: ['page', '頁碼', '印刷頁碼', '起始頁碼', '起頁'],
  split: ['split', '集', '分集'], group: ['group', '分組', '年代'],
};
const { header, records } = parseCSV(fs.readFileSync(opt.gold, 'utf8'));
const col = {}; for (const [k, names] of Object.entries(ALIASES)) col[k] = names.find(n => header.includes(n));
for (const need of ['book', 'image']) if (!col[need]) { console.error(`標準答案缺少「${ALIASES[need].join('／')}」欄位。目前的欄位：${header.join('、')}`); process.exit(1); }
const stripExt = s => String(s).replace(/\.(jpe?g|png|gif|webp|tiff?)$/i, '');
const images = new Map();
for (const r of records) {
  const book = r[col.book], image = stripExt(r[col.image]); if (!book || !image) continue;
  const key = book + '|' + image;
  if (!images.has(key)) images.set(key, { key, book, image, split: (col.split && r[col.split]) || 'eval', group: (col.group && r[col.group]) || '', articles: [] });
  images.get(key).articles.push({ title: col.title ? r[col.title] : '', author: col.author ? r[col.author] : '', role: col.role ? r[col.role] : '', column: col.column ? r[col.column] : '', ad: col.ad ? r[col.ad] : '', page: col.page ? r[col.page] : '' });
}
let list = [...images.values()].filter(g => opt.split === 'all' || g.split === opt.split);
if (opt.limit) list = list.slice(0, opt.limit);
console.log(`標準答案：${records.length} 列 → ${images.size} 張影像；本次評測 ${list.length} 張（split=${opt.split}${opt.limit ? '，limit=' + opt.limit : ''}）`);
const unmapped = ['title', 'author', 'role', 'column', 'ad', 'page'].filter(k => !col[k]);
if (unmapped.length) console.log('（沒有對應欄位，這些項目不評：' + unmapped.join('、') + '）');

// ---------- 呼叫 analyze.php ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(endpoint, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(opt.base + '/' + endpoint, { method: 'POST', body, signal: AbortSignal.timeout(300000) });
  const text = await res.text();
  if (!res.ok) { const e = new Error(text || String(res.status)); e.status = res.status; throw e; }
  return text;
}
async function analyze(params) {
  if (opt.apiKey) params.api_key = opt.apiKey;
  if (opt.model) params.model = opt.model;
  if (opt.engine === 'local') params.engine = 'local';
  for (let t = 1; ; t++) {
    try { return JSON.parse(await post('analyze.php', params)); }
    catch (e) {
      if (/今天的免費額度|金鑰|尚未設定/.test(e.message)) { e.fatal = true; throw e; }
      if (t >= 3 || !/頻繁|忙碌|high demand|連線|timed out|timeout|fetch failed|503|429/i.test(e.message)) throw e;
      console.log(`  （${e.message.slice(0, 60)}…，${20 * t} 秒後重試）`); await sleep(20000 * t);
    }
  }
}
const firstCache = {};
async function firstImage(book) {
  if (!(book in firstCache)) { try { const l = JSON.parse(await post('givePageNum.php', { book })); firstCache[book] = l[0] || ''; } catch (e) { firstCache[book] = ''; } }
  return firstCache[book];
}

// ---------- 跑一輪（有快取，中斷後重跑會接續） ----------
async function runOnce(run) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `run${run}.json`);
  const cache = fs.existsSync(file) && !opt.force ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (opt.rescore) return cache;
  const todo = list.filter(g => !cache[g.key]);
  const byBook = new Map(); for (const g of todo) { if (!byBook.has(g.book)) byBook.set(g.book, []); byBook.get(g.book).push(g); }
  let done = 0;
  for (const [book, gs] of byBook) {
    const isThread = new RegExp(opt.thread).test(book), first = await firstImage(book);
    const chunks = opt.mode === 'page' ? gs.map(g => [g]) : Array.from({ length: Math.ceil(gs.length / opt.group) }, (_, i) => gs.slice(i * opt.group, (i + 1) * opt.group));
    for (const ch of chunks) {
      const params = { book };
      if (isThread) params.thread = '1';
      if (opt.mode === 'page') { params.mode = 'page'; params.page = ch[0].image; if (ch[0].image === first) params.first = '1'; }
      else { params.mode = 'batch'; params.pages = JSON.stringify(ch.map(g => g.image)); if (ch[0].image === first) params.first = '1'; }
      let res;
      try { res = await analyze(params); }
      catch (e) {
        fs.writeFileSync(file, JSON.stringify(cache, null, 1));
        if (e.fatal) { console.error('\n中止：' + e.message + '\n已分析的結果都存在快取，額度恢復後用同一個指令重跑，會從中斷的地方接續。'); process.exit(2); }
        console.error(`  失敗（${book}：${ch.map(g => g.image).join(',')}）：${e.message.slice(0, 120)}`); continue;
      }
      for (const g of ch) {
        const p = opt.mode === 'page' ? res : (res.pages || {})[g.image];
        cache[g.key] = p ? { articles: p.articles || [], page: p.printed_page || '', model: res.model || '' } : { error: true };
      }
      done += ch.length; process.stdout.write(`\r第 ${run} 輪：${done}/${todo.length} 張`);
      fs.writeFileSync(file, JSON.stringify(cache, null, 1));
      await sleep(opt.delay);
    }
  }
  if (todo.length) process.stdout.write('\n');
  return cache;
}

// ---------- 報表 ----------
const pct = v => v == null ? '–' : (v * 100).toFixed(1) + '%';
function table(rows, headers) { return ['| ' + headers.join(' | ') + ' |', '|' + headers.map(() => '---').join('|') + '|', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n'); }
function fieldTable(agg) {
  const order = ['頁碼', '題名(首篇)', '作者', '作者角色', '角色逐位對應', '專欄', '是否廣告'];
  const rows = order.filter(f => agg.fields[f]).map(f => { const x = agg.fields[f]; return [f, x.有答案的頁數, pct(x.準確率), pct(x.讀錯率), pct(x.漏填率), pct(x.編造率)]; });
  return table(rows, ['欄位', '有答案', '準確率', '讀錯', '漏填(AI 回空白)', '編造(答案是空卻填了)']);
}

(async () => {
  if (opt.dry) {
    const perBook = {}; list.forEach(g => { perBook[g.book] = (perBook[g.book] || 0) + 1; });
    const per = opt.mode === 'page' ? list.length : Object.values(perBook).reduce((n, c) => n + Math.ceil(c / opt.group), 0); // 同一個資料夾的影像才會一起送
    console.log(`（預演，不呼叫 API）每輪約 ${per} 次請求，共 ${opt.runs} 輪 ≈ ${per * opt.runs} 次。免費額度每個模型每天約 20 次，請先確認。`); return;
  }
  const allRuns = [];
  for (let r = 1; r <= opt.runs; r++) allRuns.push(await runOnce(r));

  fs.mkdirSync(OUT, { recursive: true });
  const mism = []; let md = `# 評測報告：${opt.tag}\n\n- 時間：${new Date().toLocaleString('zh-TW')}\n- 影像：${list.length} 張；輪數：${opt.runs}；模式：${opt.mode}${opt.mode === 'batch' ? '（每 ' + opt.group + ' 張一次）' : ''}${opt.model ? '；指定模型：' + opt.model : ''}\n- 題名比對${opt.stripRemark ? '已去除結尾括號附註（如「(不另行文)」）' : '保留結尾括號附註'}；文字已正規化（全形半形、標點、異體字）\n\n`;
  const summary = [];
  allRuns.forEach((cache, ri) => {
    const recs = [];
    for (const g of list) {
      const p = cache[g.key]; if (!p || p.error) continue;
      const s = scoreImage(g, { articles: withSection(g.book, p.articles), page: p.page }, { stripRemark: opt.stripRemark });
      s.group = g.group; s.model = p.model; recs.push(s);
      for (const d of s.details) mism.push({ run: ri + 1, book: g.book, image: g.image, 欄位: d.field, 結果: d.outcome, 標準答案: d.gold, AI: d.pred, 所屬題名: d.title || '' });
    }
    const failed = list.filter(g => !cache[g.key] || cache[g.key].error).length;
    const agg = aggregate(recs); summary.push({ run: ri + 1, agg, failed, models: [...new Set(recs.map(r => r.model))] });
    md += `## 第 ${ri + 1} 輪（成功 ${recs.length} 張${failed ? '、失敗或未跑 ' + failed + ' 張' : ''}；實際模型：${[...new Set(recs.map(r => r.model))].join('、') || '–'}）\n\n${fieldTable(agg)}\n\n- 首篇題名平均錯字率（CER）：${agg.首篇題名平均錯字率 == null ? '–' : (agg.首篇題名平均錯字率 * 100).toFixed(1) + '%'}\n- 篇目層級（題名相似度 ≥ 0.8 算找到）：precision ${pct(agg.篇目.precision)}、recall ${pct(agg.篇目.recall)}、F1 ${pct(agg.篇目.f1)}\n\n`;
    // 依資料夾（刊物）與分組分別統計
    for (const [title, keyFn] of [['依資料夾（刊物）', r => r.book], ['依分組欄位', r => r.group]]) {
      const groups = new Map(); for (const r of recs) { const k = keyFn(r); if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      if (groups.size > 1 || (title === '依資料夾（刊物）' && groups.size === 1)) {
        md += `**${title}**\n\n` + table([...groups].map(([k, rs]) => { const a = aggregate(rs); const f = a.fields; return [k, rs.length, pct(f['頁碼'] && f['頁碼'].準確率), pct(f['頁碼'] && f['頁碼'].編造率), pct(f['題名(首篇)'] && f['題名(首篇)'].準確率), a.首篇題名平均錯字率 == null ? '–' : (a.首篇題名平均錯字率 * 100).toFixed(1) + '%']; }), ['分組', '影像數', '頁碼準確', '頁碼編造', '首篇題名準確', '題名錯字率']) + '\n\n';
      }
    }
  });
  if (opt.runs >= 2) { // 穩定度：同一張影像，各輪的頁碼、首篇題名是否一致
    let same = 0, sameT = 0, n = 0;
    for (const g of list) { const ps = allRuns.map(c => c[g.key]).filter(p => p && !p.error); if (ps.length < allRuns.length) continue; n++; if (new Set(ps.map(p => normPage(p.page))).size === 1) same++; if (new Set(ps.map(p => normText((p.articles[0] || {}).title, { stripRemark: opt.stripRemark }))).size === 1) sameT++; }
    md += `## 穩定度（各輪都成功的 ${n} 張）\n\n- 頁碼各輪相同：${same}/${n}（${pct(n ? same / n : null)}）\n- 首篇題名各輪相同：${sameT}/${n}（${pct(n ? sameT / n : null)}）\n\n`;
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  fs.writeFileSync(path.join(OUT, 'scores.json'), JSON.stringify(summary, null, 1));
  fs.writeFileSync(path.join(OUT, 'mismatches.csv'), toCSV(mism, ['run', 'book', 'image', '欄位', '結果', '標準答案', 'AI', '所屬題名']));
  console.log('\n' + md);
  console.log(`報告：${path.join(OUT, 'report.md')}\n錯誤清單（請抽樣看原圖，分辨是 AI 讀錯還是標準答案有誤）：${path.join(OUT, 'mismatches.csv')}`);
})().catch(e => { console.error(e); process.exit(1); });
