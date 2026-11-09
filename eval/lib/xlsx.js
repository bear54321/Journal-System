// 極簡 .xlsx 讀取（不需要安裝套件）：xlsx 是 zip，裡面是 XML。只讀第一個工作表，回傳 { header, records }。
// 限制：不處理公式結果以外的格式、日期會是 Excel 序號（本專案的欄位多為文字）。
'use strict';
const fs = require('fs');
const zlib = require('zlib');

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 xlsx（找不到 zip 目錄）');
  const total = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const files = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    files[name] = { method, csize, off };
    p += 46 + nlen + elen + clen;
  }
  const get = name => {
    const f = files[name]; if (!f) return '';
    const lh = f.off, start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
    const raw = buf.subarray(start, start + f.csize);
    return (f.method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
  };
  return { files, get };
}

const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const colIndex = letters => letters.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function readXlsx(file) {
  const zip = readZip(fs.readFileSync(file));
  const sst = [];
  for (const m of zip.get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) sst.push(unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  const sheetName = Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const rows = [];
  for (const rm of zip.get(sheetName).matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[2], inner = cm[3] || '';
      let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (/t="s"/.test(attrs) && v != null) v = sst[+v];
      else if (/t="inlineStr"/.test(attrs) || v == null) v = unesc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
      else v = unesc(v);
      row[colIndex(cm[1])] = v;
    }
    rows.push(row);
  }
  if (!rows.length) return { header: [], records: [] };
  const header = (rows[0] || []).map(h => (h || '').trim());
  const records = rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] == null ? '' : String(r[i])).trim()]).filter(([h]) => h)));
  return { header, records };
}

module.exports = { readXlsx };
