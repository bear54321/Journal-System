// 自我檢查：node eval/test.js（不呼叫 API）
'use strict';
const assert = require('assert');
const { normText, normPage, normDate, normBool, cer, sim } = require('./lib/normalize');
const { parseCSV, toCSV } = require('./lib/csv');
const { scoreImage, aggregate } = require('./lib/score');
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log('  ✔ ' + name); } catch (e) { console.error('  ✘ ' + name + '\n    ' + e.message); process.exitCode = 1; } };

t('頁碼：多個數字取最小', () => { assert.strictEqual(normPage('2484、2485'), '2484'); assert.strictEqual(normPage('2485/2484'), '2484'); assert.strictEqual(normPage('1-2'), '1'); assert.strictEqual(normPage('2484 2485'), '2484'); });
t('頁碼：各種寫法', () => {
  assert.strictEqual(normPage('—2484—'), '2484'); assert.strictEqual(normPage('第12頁'), '12'); assert.strictEqual(normPage('二十一'), '21');
  assert.strictEqual(normPage('廿三'), '23'); assert.strictEqual(normPage('iv'), '4'); assert.strictEqual(normPage('二〇'), '20'); assert.strictEqual(normPage('２４８４'), '2484');
  assert.strictEqual(normPage(''), ''); assert.strictEqual(normPage(null), ''); assert.strictEqual(normPage('無'), '');
});
t('文字：全形半形、標點、異體字', () => {
  assert.strictEqual(normText('臺灣　省 政府'), normText('台灣省政府'));
  assert.strictEqual(normText('河北省政府訓令第三五四七號(不另行文)', { stripRemark: true }), normText('河北省政府訓令第三五四七號'));
  assert.notStrictEqual(normText('河北省政府訓令第三五四七號(不另行文)'), normText('河北省政府訓令第三五四七號'));
  assert.strictEqual(normText('ＡＢＣ１２３'), 'ABC123');
});
t('日期：民國與西元', () => {
  assert.strictEqual(normDate('中華民國五十二年三月五日'), '1963-03-05'); assert.strictEqual(normDate('民國52年3月5日'), '1963-03-05');
  assert.strictEqual(normDate('1963-3-5'), '1963-03-05'); assert.strictEqual(normDate('中華民國三十年十月二十六日'), '1941-10-26'); assert.strictEqual(normDate('不是日期'), '');
});
t('錯字率與相似度', () => { assert.strictEqual(cer('糟坊', '糟坊'), 0); assert.strictEqual(cer('糟坊', '精坊'), 0.5); assert.strictEqual(cer('', ''), 0); assert.ok(sim('abcd', 'abce') === 0.75); });
t('是否廣告', () => { assert.strictEqual(normBool('是'), '1'); assert.strictEqual(normBool('否'), '0'); assert.strictEqual(normBool(''), ''); });
t('CSV：BOM、引號、逗號、換行', () => {
  const csv = '﻿題名,備註\r\n"甲,乙","第一行\n第二行"\r\n丙,\r\n';
  const { records } = parseCSV(csv);
  assert.strictEqual(records.length, 2); assert.strictEqual(records[0]['題名'], '甲,乙'); assert.strictEqual(records[0]['備註'], '第一行\n第二行'); assert.strictEqual(records[1]['題名'], '丙');
  assert.strictEqual(parseCSV(toCSV(records, ['題名', '備註'])).records[0]['題名'], '甲,乙');
});
t('計分：頁碼編造、題名、欄位', () => {
  const gold = { book: 'b', image: '1', articles: [{ title: '河北省政府訓令第三五四七號(不另行文)', author: '王樹常', role: '主席', column: '訓令', ad: '否', page: '2484' }] };
  const good = scoreImage(gold, { page: '2484', articles: [{ title: '河北省政府訓令第三五四七號', author: '王樹常', author_role: '主席', column_name: '訓令', is_ad: false }] }, { stripRemark: true });
  assert.deepStrictEqual(good.fields, { 頁碼: 'correct', '題名(首篇)': 'correct', 作者: 'correct', 作者角色: 'correct', 專欄: 'correct', 是否廣告: 'correct' });
  const bad = scoreImage(gold, { page: '5123', articles: [{ title: '河北省政府訓令第三五四號', author: '', author_role: '', column_name: '', is_ad: false }] }, { stripRemark: true });
  assert.strictEqual(bad.fields['頁碼'], 'wrong'); assert.strictEqual(bad.fields['題名(首篇)'], 'wrong'); assert.strictEqual(bad.fields['作者'], 'null'); assert.ok(bad.cer > 0 && bad.cer < 0.2);
  const none = scoreImage({ book: 'b', image: '2', articles: [{ title: '', page: '' }] }, { page: '13', articles: [] });
  assert.strictEqual(none.fields['頁碼'], 'extra'); // 答案是空白，AI 編了一個頁碼
  const miss = scoreImage(gold, { page: '', articles: [] }, {}); assert.strictEqual(miss.fields['頁碼'], 'null'); assert.strictEqual(miss.fn, 1);
});
t('彙總：準確率、編造率', () => {
  const g1 = { book: 'b', image: '1', articles: [{ title: '甲', page: '10' }] }, g2 = { book: 'b', image: '2', articles: [{ title: '乙', page: '' }] };
  const agg = aggregate([scoreImage(g1, { page: '10', articles: [{ title: '甲' }] }), scoreImage(g2, { page: '99', articles: [{ title: '乙' }] })]);
  assert.strictEqual(agg.fields['頁碼'].準確率, 1); assert.strictEqual(agg.fields['頁碼'].編造率, 1); assert.strictEqual(agg.篇目.f1, 1);
});
t('評測修正：艷／豔視為同字', () => { assert.strictEqual(normText('艷骨記'), normText('豔骨記')); });
t('評測修正：題名結尾的日期期間，有沒有括號都一起去除', () => {
  const o = { stripRemark: true };
  assert.strictEqual(normText('一週匪情大事紀要(八月十八日至八月廿四日)', o), normText('一周匪情大事紀要八月十八日至八月廿四日', o));
  assert.strictEqual(normText('一週重要匪情大事紀要(五月十八日起廿四日止)', o), normText('一週重要匪情大事紀要', o));
  assert.strictEqual(normText('一週匪情大事紀要(八月十八日至八月廿四日)'), normText('一周匪情大事紀要八月十八日至八月廿四日')); // 不去除附註時，括號本身是標點，也會被忽略
});
t('評測修正：配對不到的篇目，不算在專欄／廣告的「沒輸出」', () => {
  const gold = { book: 'b', image: '9', articles: [{ title: '一週匪情大事紀要', author: '', role: '', column: '', ad: '否', page: '*' }] };
  const r = scoreImage(gold, { page: '', articles: [{ title: '完全不同的題名', author: '', author_role: '', column_name: '', is_ad: false }] }, { stripRemark: true });
  assert.strictEqual(r.fields['是否廣告'], undefined); assert.strictEqual(r.fields['專欄'], undefined); assert.strictEqual(r.fn, 1);
});
t('作者角色：多位作者逐位比對', () => {
  const gold = { book: 'b', image: '1', articles: [{ title: '貝隆夫人與阿根廷(下篇)', author: 'John Lear\n胡海', role: '原作\n譯', column: '', ad: '否', page: '45' }] };
  const mk = (author, role) => ({ page: '45', articles: [{ title: '貝隆夫人與阿根廷(下篇)', author, author_role: role, column_name: '', is_ad: false }] });
  const good = scoreImage(gold, mk('John Lear、胡海', '原作、譯'));
  assert.strictEqual(good.fields['作者角色'], 'correct'); assert.strictEqual(good.fields['角色逐位對應'], 'correct'); assert.strictEqual(good.fields['作者'], 'correct');
  const partial = scoreImage(gold, mk('John Lear、胡海', '譯')); // 兩位作者只回一個角色
  assert.strictEqual(partial.fields['作者角色'], 'wrong'); assert.strictEqual(partial.fields['角色逐位對應'], 'wrong');
  const swapped = scoreImage(gold, mk('John Lear、胡海', '譯、原作')); assert.strictEqual(swapped.fields['作者角色'], 'wrong'); assert.strictEqual(swapped.fields['角色逐位對應'], 'correct');
  const single = scoreImage({ book: 'b', image: '2', articles: [{ title: '甲', author: '張三', role: '撰', column: '', ad: '否', page: '1' }] }, { page: '1', articles: [{ title: '甲', author: '張三', author_role: '撰', column_name: '', is_ad: false }] });
  assert.strictEqual(single.fields['作者角色'], 'correct'); assert.strictEqual(single.fields['角色逐位對應'], undefined);
  const none = scoreImage({ book: 'b', image: '3', articles: [{ title: '乙', author: '', role: '', column: '', ad: '否', page: '1' }] }, { page: '1', articles: [{ title: '乙', author: '', author_role: '', column_name: '', is_ad: false }] });
  assert.strictEqual(none.fields['作者角色'], 'blank_ok');
});
console.log(process.exitCode ? '\n有測試失敗' : `\n全部通過（${n} 項）`);
