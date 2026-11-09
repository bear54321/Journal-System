// 計分：把 AI 的辨識結果和標準答案逐欄比對。
// 每個欄位的結果分五類：
//   correct  正規化後相符
//   wrong    有輸出但不相符
//   null     AI 沒輸出（標準答案有值）
//   extra    標準答案是空的，AI 卻填了東西（頁碼上特別要注意：這就是「編造」）
//   blank_ok 兩邊都是空的
'use strict';
const { normText, normPage, normBool, cer, sim } = require('./normalize');

const outcome = (g, p) => (!g && !p) ? 'blank_ok' : (!g && p) ? 'extra' : (g && !p) ? 'null' : g === p ? 'correct' : 'wrong';

// 標準答案的一張影像：{ book, image, articles:[{title,author,role,column,ad,page}] }；AI 的結果：{ articles:[{title,author,author_role,column_name,is_ad}], page }
function scoreImage(gold, pred, opts = {}) {
  const thr = opts.matchThreshold ?? 0.8, pairThr = opts.pairThreshold ?? 0.5;
  const nt = s => normText(s, { stripRemark: opts.stripRemark });
  const rec = { book: gold.book, image: gold.image, fields: {}, details: [] };
  const add = (field, g, p, extra = {}) => {
    const o = outcome(g, p); rec.fields[field] = o;
    if (o === 'wrong' || o === 'null' || o === 'extra') rec.details.push({ field, outcome: o, gold: g, pred: p, ...extra });
  };

  // 頁碼
  // 標準答案的頁碼寫「*」＝這張影像不評頁碼（例如 Excel 的頁數是括號［1］，編目者推算的，版面上不一定印著）
  const rawPage = gold.articles.map(a => a.page).find(Boolean) || '';
  if (rawPage !== '*') add('頁碼', normPage(rawPage), normPage(pred.page));

  // 篇目
  const goldArts = gold.articles.filter(a => nt(a.title));
  if (!goldArts.length) return rec;
  const predArts = (pred.articles || []).map(a => ({ title: nt(a.title), rawTitle: a.title || '', author: nt(a.author), role: nt(a.author_role), column: nt(a.column_name), ad: a.is_ad ? '1' : '0' }));

  // 首篇題名（逐頁核對預設採用的那一筆）
  const g0 = nt(goldArts[0].title), p0 = predArts[0] ? predArts[0].title : '';
  add('題名(首篇)', g0, p0);
  rec.cer = p0 ? cer(g0, p0) : 1;

  // 篇目層級的 TP / FP / FN：題名相似度 ≥ 門檻視為找到
  const used = new Set(); let tp = 0;
  const pairs = [];
  for (const ga of goldArts) {
    const gt = nt(ga.title); let best = -1, bi = -1;
    predArts.forEach((pa, i) => { if (used.has(i)) return; const s = sim(gt, pa.title); if (s > best) { best = s; bi = i; } });
    if (bi >= 0 && best >= pairThr) { used.add(bi); pairs.push([ga, predArts[bi], best]); if (best >= thr) tp++; } else pairs.push([ga, null, 0]);
  }
  rec.tp = tp; rec.fn = goldArts.length - tp; rec.fp = Math.max(0, predArts.length - tp);

  // 配對上的篇目：逐欄比對
  for (const [ga, pa] of pairs) {
    if (!pa) continue; // 配對不到（AI 沒輸出這一篇，或題名差太多）：只算在篇目層級的漏找，不在這些欄位算「沒輸出」
    const get = (a, k) => a ? a[k] : '';
    add('作者', nt(ga.author), get(pa, 'author'), { title: ga.title });
    add('作者角色', nt(ga.role), get(pa, 'role'), { title: ga.title });
    add('專欄', nt(ga.column), get(pa, 'column'), { title: ga.title });
    const gad = normBool(ga.ad);
    if (gad !== '') add('是否廣告', gad, pa ? pa.ad : '', { title: ga.title });
  }
  return rec;
}

// 彙總：records 是 scoreImage 的結果陣列
function aggregate(records) {
  const fields = {}; let cerSum = 0, cerN = 0, tp = 0, fp = 0, fn = 0, images = records.length;
  for (const r of records) {
    for (const [f, o] of Object.entries(r.fields)) { fields[f] = fields[f] || { correct: 0, wrong: 0, null: 0, extra: 0, blank_ok: 0 }; fields[f][o]++; }
    if (r.cer != null) { cerSum += r.cer; cerN++; }
    tp += r.tp || 0; fp += r.fp || 0; fn += r.fn || 0;
  }
  const rows = {};
  for (const [f, c] of Object.entries(fields)) {
    const withGold = c.correct + c.wrong + c.null, noGold = c.extra + c.blank_ok;
    rows[f] = { ...c, 有答案的頁數: withGold, 準確率: withGold ? c.correct / withGold : null, 漏填率: withGold ? c.null / withGold : null, 讀錯率: withGold ? c.wrong / withGold : null, 編造率: noGold ? c.extra / noGold : null };
  }
  const p = tp + fp ? tp / (tp + fp) : null, r = tp + fn ? tp / (tp + fn) : null;
  return { images, fields: rows, 首篇題名平均錯字率: cerN ? cerSum / cerN : null, 篇目: { tp, fp, fn, precision: p, recall: r, f1: p != null && r != null && p + r ? 2 * p * r / (p + r) : null } };
}

module.exports = { scoreImage, aggregate, outcome };
