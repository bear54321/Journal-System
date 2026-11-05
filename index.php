<?php
require_once __DIR__ . '/config.php';

// 期刊清單：影像資料夾與已有篇目的資料夾合併，自然排序
$books = [];
foreach ([IMG_DIR, DATA_DIR] as $base) {
  if (!is_dir($base)) continue;
  foreach (scandir($base) as $d) {
    if ($d[0] === '.' || !is_dir($base . '/' . $d)) continue;
    $books[rawurldecode($d)] = true;
  }
}
$books = array_keys($books);
natcasesort($books);
?><!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>期刊編目工作台</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@600;700&display=swap">
<style>
/* 版面：左側像閱片台（深色影像區），右側是編目卡與篇目樹；窄螢幕改為上下堆疊 */
:root {
  --bg: #f4f1ea; --panel: #fdfcf9; --sunken: #ebe7dd; --fg: #1d2b2f; --muted: #5f6d70;
  --line: #d8d2c4; --accent: #1b5b66; --accent-fg: #ffffff; --accent-soft: #d7e7e9;
  --ad: #8a5a12; --ad-soft: #f6e8cd; --danger: #a8322a; --danger-soft: #f8dfdc;
  --flash: #f7e39a; --stage: #20282b; --stage-fg: #dfe7ea; --stage-btn: #36434a;
  --serif: "Noto Serif TC", "PMingLiU", serif;
  --sans: "Noto Sans TC", "Microsoft JhengHei", sans-serif;
  --mono: "IBM Plex Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #141b1e; --panel: #1c2529; --sunken: #111719; --fg: #e4ebee; --muted: #9db0b8;
    --line: #36444a; --accent: #6db7d4; --accent-fg: #0d2029; --accent-soft: #24414e;
    --ad: #e9bd6f; --ad-soft: #41331a; --danger: #f0968e; --danger-soft: #4a2320;
    --flash: #6a5a1c; --stage: #0c1113; --stage-fg: #dfe7ea; --stage-btn: #2a353a;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #141b1e; --panel: #1c2529; --sunken: #111719; --fg: #e4ebee; --muted: #9db0b8;
  --line: #36444a; --accent: #6db7d4; --accent-fg: #0d2029; --accent-soft: #24414e;
  --ad: #e9bd6f; --ad-soft: #41331a; --danger: #f0968e; --danger-soft: #4a2320;
  --flash: #6a5a1c; --stage: #0c1113; --stage-fg: #dfe7ea; --stage-btn: #2a353a;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { background: var(--bg); color: var(--fg); font-family: var(--sans); font-size: 14px; line-height: 1.5; }
button, input, select, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.app { height: 100%; display: flex; flex-direction: column; gap: 10px; padding-block: 10px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.brand { font-family: var(--serif); font-size: 20px; font-weight: 700; margin: 0; }
.notice { font-size: 12px; color: var(--muted); }
.spacer { flex: 1 1 auto; }
.nav { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.nav label { display: flex; align-items: center; gap: 6px; min-width: 0; }
.nav select { max-width: 100%; }
.work { flex: 1 1 auto; min-height: 0; display: grid; gap: 2px; grid-template-columns: minmax(0, 1fr) 10px minmax(0, var(--right, 540px)); }
.divider { cursor: col-resize; border-radius: 3px; position: relative; touch-action: none; }
.divider::after { content: ""; position: absolute; left: 4px; top: 40%; bottom: 40%; width: 2px; background: var(--line); }
.divider:hover::after, .divider:focus-visible::after { background: var(--accent); top: 0; bottom: 0; }
.pno-tag { font-weight: 500; padding: 0 6px; border-radius: 3px; }
.pno-tag.flash { animation: flash 1.1s ease-out 1; }
.picked { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
.pick-order { color: var(--accent); font-weight: 700; }
.side { min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 10px; }

input[type="text"], select, textarea { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 4px 8px; }
textarea { resize: vertical; width: 100%; display: block; }
.btn { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 4px 10px; cursor: pointer; white-space: nowrap; }
.btn:hover:not(:disabled) { background: var(--accent-soft); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 500; }
.btn.primary:hover:not(:disabled) { background: var(--accent); filter: brightness(1.12); }
.btn.danger { color: var(--danger); border-color: var(--danger); background: var(--danger-soft); }
.file-btn { display: inline-block; }
.file-btn input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.file-btn input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 1px; }

/* 影像區 */
.viewer-wrap { min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--stage); color: var(--stage-fg); border-radius: 6px; overflow: hidden; }
.viewer { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; cursor: grab; touch-action: pan-y; }
.viewer.zoomed { touch-action: none; }
.viewer.dragging { cursor: grabbing; }
.viewer img { position: absolute; left: 0; top: 0; max-width: none; transform-origin: center; user-select: none; -webkit-user-drag: none; box-shadow: 0 4px 24px rgba(0,0,0,.5); }
.viewer-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; }
.viewer-bar .btn { background: var(--stage-btn); border-color: var(--stage-btn); color: var(--stage-fg); }
.viewer-bar .btn:hover:not(:disabled) { background: var(--stage-btn); filter: brightness(1.25); }
.readout { font-family: var(--mono); font-size: 12px; font-variant-numeric: tabular-nums; }

/* 編目卡 */
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
.card h2 { font-family: var(--serif); font-size: 15px; margin: 0; }
.card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; margin-bottom: 8px; }
.field { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 6px 8px; align-items: center; }
.fields { display: flex; flex-direction: column; gap: 6px; }
.field > label, .field > .lab { color: var(--muted); font-size: 13px; }
.field input[type="text"] { width: 100%; min-width: 0; }
.inline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.inline > input[type="text"] { flex: 1 1 110px; width: auto; }
.check { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.link-btn { background: none; border: 0; padding: 0 2px; color: var(--accent); cursor: pointer; font-size: 12px; text-decoration: underline; white-space: nowrap; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
.error { color: var(--danger); background: var(--danger-soft); border-radius: 4px; padding: 4px 8px; margin-top: 8px; font-size: 13px; }
.editing-tag { font-size: 12px; color: var(--accent-fg); background: var(--accent); border-radius: 3px; padding: 0 6px; }

/* 篇目樹 */
.tree-card { flex: 1 1 auto; min-height: 240px; display: flex; flex-direction: column; }
.tree-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.tree-tools .btn { font-size: 12px; padding: 2px 8px; }
.tree-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; background: var(--sunken); border-radius: 4px; padding: 8px; }
.tree, .tree ul { list-style: none; margin: 0; padding: 0; }
.tree ul { margin-left: 22px; position: relative; }
.tree ul::before { content: ""; position: absolute; left: -12px; top: 0; bottom: 18px; width: 1px; background: var(--line); }
.tree li { position: relative; margin-top: 4px; }
.tree ul > li::before { content: ""; position: absolute; left: -12px; top: 18px; width: 10px; height: 1px; background: var(--line); }
.row { display: flex; align-items: flex-start; gap: 6px; background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 5px 6px; cursor: pointer; }
.row:hover { border-color: var(--accent); }
.row.selected { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
.row.flash { animation: flash 1.1s ease-out 1; }
@keyframes flash { 0%, 40% { background: var(--flash); } }
.row.drop-before { box-shadow: 0 -3px 0 var(--accent); }
.row.drop-after { box-shadow: 0 3px 0 var(--accent); }
.row.drop-inside { outline: 2px dashed var(--accent); outline-offset: 1px; }
.row.is-dragging { opacity: .45; }
.toggle { flex: none; width: 20px; height: 20px; line-height: 18px; text-align: center; padding: 0; border: 1px solid var(--line); border-radius: 3px; background: var(--bg); font-size: 10px; cursor: pointer; }
.toggle.none { visibility: hidden; }
.row-main { flex: 1 1 auto; min-width: 0; }
.row-title { overflow-wrap: anywhere; font-weight: 500; }
.row-sub { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.row-pages { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.tag-ad { font-size: 11px; color: var(--ad); background: var(--ad-soft); border-radius: 3px; padding: 0 5px; margin-right: 4px; font-weight: 500; }
.row-actions { flex: none; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 2px 6px; max-width: 120px; }
.row-actions .link-btn.del { color: var(--danger); }
.empty { color: var(--muted); padding: 16px 8px; text-align: center; }

/* 對話框 */
dialog { background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 8px; padding: 0; width: min(680px, calc(100vw - 32px)); max-height: 85vh; }
dialog[open] { display: flex; flex-direction: column; }
dialog::backdrop { background: rgba(10, 20, 25, .5); }
.dlg-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.dlg-head h2 { font-family: var(--serif); font-size: 16px; margin: 0; }
.dlg-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px 14px; }
.dlg-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--line); }
fieldset { border: 0; padding: 0; margin: 0 0 14px; }
legend { font-weight: 700; padding: 0; margin-bottom: 6px; color: var(--accent); }
.meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; }
.meta-grid label { display: flex; flex-direction: column; gap: 2px; color: var(--muted); font-size: 12px; min-width: 0; }
.meta-grid input, .meta-grid select { width: 100%; color: var(--fg); font-size: 14px; }
.meta-grid input:disabled { background: var(--sunken); }
.page-row { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.page-row img { width: 76px; height: 104px; object-fit: contain; background: var(--sunken); border-radius: 2px; }
.page-row .col { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
.page-row input { width: 130px; max-width: 100%; font-family: var(--mono); }
.seq { font-family: var(--mono); color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
#exportText { font-family: var(--mono); font-size: 12px; height: 46vh; }
.toast { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); background: var(--fg); color: var(--bg); border-radius: 4px; padding: 6px 14px; z-index: 20; max-width: calc(100vw - 32px); }

.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--sunken); }
.seg button { border: 0; background: transparent; padding: 5px 14px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); font-weight: 500; }
.app.mode-pages .work, .app.mode-pages .only-catalog { display: none !important; }
.app.mode-catalog .pv { display: none !important; }
:root { --ok: #2f7d4f; --ok-soft: #dcefe2; --rev: #9a6200; --rev-soft: #fbebc8; --inh: #6d7679; --inh-soft: #e4e6e4; --none: #8f9a9d; --none-soft: #eceeed; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ok: #7bd09a; --ok-soft: #1d3a29; --rev: #ecbf6a; --rev-soft: #41331a; --inh: #aab4b7; --inh-soft: #2a3336; --none: #8a9598; --none-soft: #263033; } }
.pv { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.pv-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.pv-prog { display: flex; height: 8px; width: 240px; border-radius: 4px; overflow: hidden; background: var(--sunken); }
.pv-prog i { display: block; height: 100%; }
.pv-count { font-size: 12px; color: var(--muted); }
.pv-main { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(420px, 600px) minmax(0, 1fr); gap: 10px; }
.pv-list { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.pv-filters { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.chip { border: 1px solid var(--line); border-radius: 14px; padding: 1px 12px; background: var(--panel); cursor: pointer; font-size: 13px; }
.chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.pv-rows { overflow: auto; flex: 1; }
.pv-row { display: grid; grid-template-columns: 56px 54px minmax(0, 1fr) 84px; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); cursor: pointer; border-left: 4px solid transparent; }
.pv-row:hover { background: var(--bg); }
.pv-row.sel { background: var(--accent-soft); border-left-color: var(--accent); }
.pv-pg { font: 500 14px var(--mono); }
.pv-pg small { display: block; color: var(--muted); font-size: 10px; }
.pv-pno { font: 600 17px var(--mono); color: var(--accent); text-align: center; align-self: start; }
.pv-pno::before { content: '頁碼'; display: block; font: 400 10px var(--sans); color: var(--muted); }
.pv-pno.none { color: var(--none); font-weight: 400; }
.pv-pno.warn { color: var(--rev); }
.pv-pno.auto::after { content: '自動'; display: block; font: 400 10px var(--sans); color: var(--muted); }
.auto-tag { background: var(--accent-soft); color: var(--accent); }
.pv-pno.warn::after { content: '⚠ 不連續'; display: block; font: 400 10px var(--sans); }
.pno-warn { background: var(--rev-soft); border-color: #d6b24a; color: var(--fg); }
.pno-row { display: flex; gap: 10px; align-items: center; }
.pno-row input { width: 110px; font: 500 15px var(--mono); }
.pv-tt { font: 600 15px var(--serif); overflow-wrap: anywhere; }
.pv-tt.inh { color: var(--inh); font-weight: 400; }
.pv-tt.none { color: var(--none); font-weight: 400; font-family: var(--sans); }
.pv-sub { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.badge { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 10px; font-size: 12px; white-space: nowrap; align-self: start; justify-self: end; }
.b-ok { background: var(--ok-soft); color: var(--ok); } .b-review { background: var(--rev-soft); color: var(--rev); }
.b-inh { background: var(--inh-soft); color: var(--inh); } .b-bad { background: var(--danger-soft); color: var(--danger); } .b-none { background: var(--none-soft); color: var(--none); }
.pv-edit { grid-column: 3 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; cursor: default; }
.pv-edit .full { grid-column: 1 / -1; }
.pv-edit .f { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pv-edit label { font-size: 12px; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.pv-edit input[type="text"] { width: 100%; }
.pv-edit .f.unsure input { border-color: #d6b24a; background: #fffaf0; color: #1d2b2f; }
.unsure-tag { font-size: 11px; color: var(--rev); background: var(--rev-soft); padding: 0 6px; border-radius: 4px; }
.pv-hint { background: var(--sunken); border: 1px dashed var(--line); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.pv-more { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
.pv-acts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
kbd { font: 11px var(--mono); border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; background: var(--panel); color: var(--muted); }
.btn.primary kbd { background: rgba(255,255,255,.2); border-color: rgba(255,255,255,.4); color: #fff; }
.pv-viewer { position: relative; background: var(--stage); border-radius: 8px; overflow: hidden; cursor: grab; touch-action: none; min-height: 0; }
.pv-viewer img { position: absolute; left: 0; top: 0; max-width: none; user-select: none; -webkit-user-drag: none; box-shadow: 0 6px 28px rgba(0,0,0,.5); }
.pv-tag { position: absolute; left: 12px; top: 10px; background: rgba(0,0,0,.55); color: #fff; border-radius: 6px; padding: 2px 10px; font-size: 12px; font-family: var(--mono); }
.pv-zoom { position: absolute; right: 12px; bottom: 10px; display: flex; gap: 4px; }
.pv-zoom button { background: rgba(255,255,255,.14); color: #fff; border: 0; border-radius: 6px; padding: 3px 10px; cursor: pointer; }
@media (max-width: 899px) { .pv-main { grid-template-columns: minmax(0, 1fr); } .pv-viewer { height: 60vh; } }@media (max-width: 899px) {
  html, body { height: auto; }
  .app { height: auto; }
  .work { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .divider { display: none; }
  .viewer { height: 62vh; min-height: 340px; flex: none; }
  .tree-scroll { max-height: 60vh; }
  .meta-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .row.flash { animation: none; outline: 2px solid var(--accent); } .pno-tag.flash { animation: none; } }
.toc-row { display: grid; grid-template-columns: 24px minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 64px 90px 90px 60px; gap: 4px; align-items: center; padding: 3px 0; border-bottom: 1px solid var(--line); }
.toc-row.head { font-size: 12px; color: var(--muted); }
.toc-row input[type="text"], .toc-row select { width: 100%; min-width: 0; }
.toc-row.lv1 > .t { padding-left: 14px; }
.toc-row.bad input.s { border-color: var(--danger); }</style>
</head>
<body>
<div class="app mode-pages" id="app">
  <header class="top">
    <h1 class="brand">期刊編目工作台</h1>
    <span class="notice">資料存在伺服器（data/ 與 img/ 資料夾）・<a href="classic.php">舊版介面</a></span>
    <span class="spacer"></span>
    <div class="seg" id="modeSeg" role="group" aria-label="切換工作模式"><button type="button" data-m="pages" aria-pressed="true">逐頁核對</button><button type="button" data-m="catalog" aria-pressed="false">篇目目錄</button></div>
    <button class="btn" id="openAi" type="button" title="輸入您自己的 Gemini API 金鑰">AI 設定</button>
    <button class="btn" id="openMeta" type="button">雜誌編目</button>
    <button class="btn" id="openPages" type="button">編輯頁碼</button>
    <button class="btn" id="openExport" type="button">匯出與還原</button>
  </header>

  <nav class="nav" aria-label="切換期刊與頁面">
    <label>期刊 <select id="issueSelect"></select></label>
    <label class="only-catalog">影像 <select id="pageSelect"></select></label>
    <span class="pno-tag only-catalog" id="pnoTag" aria-live="polite"></span>
    <button class="btn only-catalog" id="prevPage" type="button">上一頁</button>
    <button class="btn only-catalog" id="nextPage" type="button">下一頁</button>
    <button class="btn only-catalog" id="aiPage" type="button" title="用 AI 辨識這一頁的篇目，預填到表單">分析本頁</button>
    <button class="btn only-catalog" id="aiToc" type="button" title="這一頁是目錄時，用 AI 一次產生整期篇目草稿">分析目錄</button>
  </nav>

  <section class="pv" id="viewPages" aria-label="逐頁核對">
    <div class="pv-bar">
      <button class="btn primary" id="pvBatch" type="button">分析整期</button>
      <button class="btn" id="pvStop" type="button" hidden>暫停</button>
      <div class="pv-prog" id="pvProg" title="核對進度"></div>
      <span class="pv-count" id="pvCount"></span>
      <span class="spacer"></span>
      <label class="check" title="線裝書的頁碼印在書葉中縫（版心）：分析時以中縫的頁碼為主；只要確認篇目首頁的頁碼，後面的頁會自動接續"><input type="checkbox" id="pvThread"> 線裝書（頁碼在中縫）</label>
      <button class="link-btn" id="pvKeyBtn" type="button" title="按一下設定 AI 金鑰"></button>
      <button class="btn" id="pvApply" type="button" title="把逐頁資料合併成篇目目錄（連續同題名的頁會併成一筆）">套用到篇目目錄</button>
    </div>
    <div class="pv-main">
      <div class="pv-list">
        <div class="pv-filters" id="pvFilters"></div>
        <div class="pv-rows" id="pvRows"></div>
      </div>
      <div class="pv-viewer" id="pvViewer"><img id="pvImg" alt="" draggable="false"><span class="pv-tag" id="pvTag"></span>
        <div class="pv-zoom"><button type="button" id="pvOut" aria-label="縮小">−</button><button type="button" id="pvFit">符合視窗</button><button type="button" id="pvIn" aria-label="放大">＋</button></div>
      </div>
    </div>
  </section>
  <main class="work">
    <section class="viewer-wrap" aria-label="掃描影像">
      <div class="viewer" id="viewer"><img id="pageImg" alt="" draggable="false"></div>
      <div class="viewer-bar">
        <button class="btn" id="zoomOut" type="button" aria-label="縮小">−</button>
        <button class="btn" id="zoomIn" type="button" aria-label="放大">＋</button>
        <button class="btn" id="zoomFit" type="button">符合視窗</button>
        <button class="btn" id="rotate" type="button">旋轉 90°</button>
        <span class="spacer"></span>
        <span class="readout" id="readout" aria-live="polite"></span>
      </div>
    </section>

    <div class="divider" id="divider" role="separator" aria-orientation="vertical" aria-label="調整左右寬度" tabindex="0"></div>

    <div class="side">
      <form class="card" id="entryForm" autocomplete="off">
        <div class="card-head">
          <h2>篇目</h2>
          <span class="editing-tag" id="editingTag" hidden>修改中</span>
          <label class="check"><input type="checkbox" id="levelOn"> <span>啟用層級設定</span></label>
        </div>
        <div class="fields">
          <div class="field"><label for="fTitle">主要題名</label><textarea id="fTitle" rows="2"></textarea></div>
          <div class="field"><label for="fColumn">專欄名稱</label>
            <div class="inline"><input type="text" id="fColumn"><label class="check"><input type="checkbox" id="fAd"> 廣告</label></div></div>
          <div class="field"><label for="fAuthor">作者</label>
            <div class="inline"><input type="text" id="fAuthor"><input type="text" id="fRole" aria-label="作者角色頭銜" placeholder="角色頭銜，如：譯"></div></div>
          <div class="field"><span class="lab">影像範圍</span>
            <div class="fields">
              <div class="inline" id="rangeBox">
                <input type="text" id="fPage1" aria-label="起始影像">
                <button class="link-btn" type="button" id="useStart">用目前影像</button>
                <span>至</span>
                <input type="text" id="fPage2" aria-label="結束影像">
                <button class="link-btn" type="button" id="useEnd">用目前影像</button>
              </div>
              <div class="picked" id="pickedBox" hidden></div>
              <div class="inline"><button class="link-btn" type="button" id="pageSetting">自訂範圍</button><button class="link-btn" type="button" id="pageReset">預設範圍</button></div>
            </div>
          </div>
        </div>
        <div class="error" id="formError" role="alert" hidden></div>
        <div class="inline" id="candBox" hidden></div>
        <div class="actions">
          <button class="btn primary" type="submit" id="saveBtn">存檔</button>
          <button class="btn" type="button" id="resetBtn">清空</button>
        </div>
      </form>

      <section class="card tree-card" aria-label="篇目目錄">
        <div class="card-head"><h2>篇目目錄</h2><span class="readout" id="treeCount"></span></div>
        <div class="tree-tools">
          <button class="btn" type="button" id="moveUp">上移</button>
          <button class="btn" type="button" id="moveDown">下移</button>
          <button class="btn" type="button" id="outdent">升一層</button>
          <button class="btn" type="button" id="indent">降一層</button>
          <span class="spacer"></span>
          <button class="btn" type="button" id="expandAll">全部展開</button>
          <button class="btn" type="button" id="collapseAll">全部收合</button>
        </div>
        <div class="tree-scroll" id="treeScroll"></div>
      </section>
    </div>
  </main>
</div>

<dialog id="metaDlg" aria-labelledby="metaTitle">
  <div class="dlg-head"><h2 id="metaTitle">雜誌編目</h2><button class="btn" type="button" data-close>關閉</button></div>
  <div class="dlg-body" id="metaBody"></div>
  <div class="dlg-foot"><button class="btn primary" type="button" id="metaSave">存檔</button></div>
</dialog>

<dialog id="pickDlg" aria-labelledby="pickTitle">
  <div class="dlg-head"><h2 id="pickTitle">自訂範圍：依勾選順序</h2><button class="btn" type="button" data-close>關閉</button></div>
  <div class="dlg-body" id="pickBody"></div>
  <div class="error" id="pickError" role="alert" hidden style="margin:0 14px 8px"></div>
  <div class="dlg-foot"><button class="btn primary" type="button" id="pickSave">存檔</button></div>
</dialog>

<dialog id="pagesDlg" aria-labelledby="pagesTitle">
  <div class="dlg-head"><h2 id="pagesTitle">編輯頁碼</h2><button class="btn" type="button" data-close>關閉</button></div>
  <div class="dlg-body" id="pagesBody"></div>
  <div class="error" id="pagesError" role="alert" hidden style="margin:0 14px 8px"></div>
  <div class="dlg-foot"><button class="btn primary" type="button" id="pagesSave">存檔</button></div>
</dialog>

<dialog id="exportDlg" aria-labelledby="exportTitle">
  <div class="dlg-head"><h2 id="exportTitle">匯出與還原</h2><button class="btn" type="button" data-close>關閉</button></div>
  <div class="dlg-body"><textarea id="exportText" readonly aria-label="匯出的 JSON 資料"></textarea></div>
  <div class="dlg-foot">
    <button class="btn primary" type="button" id="copyJson">複製 JSON</button>
    <span class="spacer"></span>
  </div>
</dialog>

<dialog id="tocDlg" aria-labelledby="tocTitle" style="width:min(980px, calc(100vw - 32px))">
  <div class="dlg-head"><h2 id="tocTitle">目錄分析草稿（AI 辨識，請核對後再加入）</h2><button class="btn" type="button" data-close>關閉</button></div>
  <div class="dlg-body">
    <div class="inline" style="margin-bottom:8px"><label>印刷頁碼 1 對應影像 <select id="tocBase"></select></label><span class="notice">已有頁碼對照的影像會直接依頁碼比對；沒有時才用這個換算。</span></div>
    <div id="tocRows"></div>
  </div>
  <div class="error" id="tocError" role="alert" hidden style="margin:0 14px 8px"></div>
  <div class="dlg-foot"><button class="btn primary" type="button" id="tocAdd">加入篇目樹</button><span class="notice" id="tocCount"></span></div>
</dialog>
<dialog id="aiDlg" aria-labelledby="aiTitle" style="width:min(560px, calc(100vw - 32px))">
  <div class="dlg-head"><h2 id="aiTitle">AI 設定</h2><button class="btn" type="button" data-close>關閉</button></div>
  <div class="dlg-body">
    <p style="margin-top:0">辨識功能使用 Google Gemini。每位使用者可以輸入自己的 API 金鑰，額度各自計算；沒有輸入時，會使用伺服器設定的預設金鑰（如果有的話）。</p>
    <div class="field" style="display:flex;flex-direction:column;gap:4px">
      <label for="aiKey">Gemini API 金鑰</label>
      <div class="inline"><input type="password" id="aiKey" autocomplete="off" spellcheck="false" placeholder="貼上您的金鑰" style="flex:1 1 auto"><button class="btn" type="button" id="aiShow">顯示</button></div>
    </div>
    <p id="aiState" class="notice" style="margin:8px 0"></p>
    <div class="error" id="aiError" role="alert" hidden></div>
    <p class="notice">金鑰只儲存在這個瀏覽器，辨識時才隨請求送到本系統的伺服器、再轉給 Google，不會寫入伺服器檔案。請勿在公用電腦儲存。若不是在本機使用，建議以 https 連線。<br><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">到 Google AI Studio 申請金鑰</a></p>
  </div>
  <div class="dlg-foot">
    <button class="btn primary" type="button" id="aiSaveTest">測試並儲存</button>
    <button class="btn" type="button" id="aiSave">只儲存</button>
    <span class="spacer"></span>
    <button class="btn danger" type="button" id="aiClear">清除我的金鑰</button>
  </div>
</dialog>
<div class="toast" id="toast" role="status" hidden></div>
<script>window.BOOKS = <?= json_encode(array_values($books), JSON_UNESCAPED_UNICODE) ?>; window.SERVER_KEY = <?= GEMINI_API_KEY !== '' ? 'true' : 'false' ?>;</script>
<script src="app.js?v=4"></script>
<script src="pages.js?v=5"></script>
</body></html>