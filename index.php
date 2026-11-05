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
<title>郭廷以圖書館數位化資料編目工作臺</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="ui.css?v=31">
<link rel="stylesheet" href="theme.css?v=3">
<script src="theme.js?v=1"></script>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><linearGradient id="aiGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5f6d"/><stop offset=".3" stop-color="#ffb347"/><stop offset=".55" stop-color="#47d1a4"/><stop offset=".78" stop-color="#4facfe"/><stop offset="1" stop-color="#a56cff"/></linearGradient></defs></svg>
<div class="app mode-pages" id="app">
  <aside class="sidebar" id="sidebar" aria-label="主選單">
    <div class="sb-brand">
      <span class="logo" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/></svg></span>
      <div><div class="sb-title">郭廷以圖書館</div><div class="sb-sub">數位化資料編目工作臺</div></div>
    </div>
    <nav class="sb-nav" id="modeSeg" role="group" aria-label="工作模式">
      <button class="sb-item" type="button" data-m="pages" aria-pressed="true"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6.5l1.5 1.5 2.5-3M3.5 12.5L5 14l2.5-3M3.5 18.5L5 20l2.5-3"/></svg><span>逐頁核對</span></button>
      <button class="sb-item" type="button" data-m="catalog" aria-pressed="false"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6v4H4zM14 11h6v4h-6zM14 17h6v4h-6z"/><path d="M7 9v10h7M7 13h7"/></svg><span>篇目目錄</span></button>
    </nav>
    <div class="sb-label">工具</div>
    <nav class="sb-nav" aria-label="工具">
      <button class="sb-item" id="openMeta" type="button"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg><span>載體編目</span></button>
      <button class="sb-item" id="openPages" type="button"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg><span>編輯頁碼</span></button>
      <button class="sb-item" id="openExport" type="button"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>匯出與還原</span></button>
      <button class="sb-item" id="openAi" type="button" title="輸入您自己的 Gemini API 金鑰"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg><span>AI 設定</span></button>
    </nav>
    <div class="sb-spacer"></div>
    <div class="sb-card">
      <label>資料 <select id="issueSelect"></select></label>
      <label>資料類型 <select id="dataType" title="不同資料類型會套用不同的 AI 辨識規則"><option>一般類型</option><option>期刊</option><option>線裝書</option><option>公報</option><option>報紙</option></select></label>
      <div class="sb-note">資料存放於伺服器（data/ 與 img/ 資料夾）</div>
    </div>
  </aside>
  <div class="sb-backdrop" id="sbBackdrop"></div>

  <div class="content">
    <header class="page-head">
      <button class="btn icon-only menu-toggle" id="menuToggle" type="button" aria-label="開啟選單" aria-controls="sidebar"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
      <div class="ph-title">
        <h1 class="t-pages">逐頁核對</h1><h1 class="t-catalog">篇目目錄</h1>
      </div>
      <span class="spacer"></span>
      <div class="head-actions">
        <button class="link-btn" id="pvAdoptAll" type="button" hidden></button>
        <button class="link-btn" id="pvKeyBtn" type="button" title="按一下設定 AI 金鑰"></button>
        <button class="btn" id="pvApply" type="button" title="把逐頁資料合併成篇目目錄（連續同題名的頁會併成一筆）">套用到篇目目錄</button>
        <button class="btn" id="pvStop" type="button" hidden>暫停</button>
        <button class="btn primary" id="pvBatch" type="button">分析整期</button>
      </div>
      <div class="theme-switch" role="group" aria-label="外觀">
        <button type="button" data-theme-set="light" aria-pressed="false" title="白底版型" aria-label="白底版型"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><span>白底</span></button>
        <button type="button" data-theme-set="dark" aria-pressed="true" title="黑底版型" aria-label="黑底版型"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><span>黑底</span></button>
      </div>
    </header>

    <nav class="nav toolbar" aria-label="切換頁面">
      <label class="only-catalog">影像 <select id="pageSelect"></select></label>
      <span class="pno-tag only-catalog" id="pnoTag" aria-live="polite"></span>
      <button class="btn only-catalog" id="prevPage" type="button" aria-label="上一頁">‹ 上一頁</button>
      <button class="btn only-catalog" id="nextPage" type="button" aria-label="下一頁">下一頁 ›</button>
      <span class="spacer"></span>
      <button class="btn only-catalog" id="aiPage" type="button" title="用 AI 辨識這一頁的篇目，預填到表單">分析本頁</button>
      <button class="btn only-catalog" id="aiToc" type="button" title="這一頁是目錄時，用 AI 一次產生整期篇目草稿">分析目錄</button>
    </nav>

    <section class="pv" id="viewPages" aria-label="逐頁核對">
      <div class="stats" id="pvStats">
        <div class="stat"><div class="stat-h">全部頁數</div><div class="stat-v" id="stTotal">0</div><div class="pv-prog" id="pvProg" title="核對進度"></div><span class="pv-count" id="pvCount" hidden></span></div>
        <div class="stat"><div class="stat-h">已確認</div><div class="stat-row"><div class="stat-v" id="stOk">0</div><span class="pill ok" id="stOkPct">0%</span></div></div>
        <div class="stat"><div class="stat-h">待檢查</div><div class="stat-row"><div class="stat-v" id="stRev">0</div><span class="pill warn" id="stBad">缺題名 0</span></div></div>
        <div class="stat"><div class="stat-h">沿用前頁</div><div class="stat-row"><div class="stat-v" id="stInh">0</div><span class="pill" id="stNone">未分析 0</span></div></div>
      </div>
    <div class="pv-main">
      <div class="pv-list">
        <div class="pv-filters" id="pvFilters"></div>
        <div class="pv-thead" aria-hidden="true"><span>影像</span><span>頁碼</span><span>題名・作者・專欄</span><span>狀態</span></div>
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
          <span class="form-sum" id="formSum"></span>
          <label class="check level-check"><input type="checkbox" id="levelOn"> <span>啟用層級設定</span></label>
          <button class="btn ghost sm" id="formToggle" type="button" aria-expanded="true" aria-controls="entryForm" title="收合或展開表單，讓篇目目錄有更大的空間"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg><span>收合</span></button>
        </div>
        <div class="fields">
          <div class="field"><label for="fTitle" class="req">主要題名</label><textarea id="fTitle" rows="2"></textarea><div class="cands" id="titleCands" hidden></div></div>
          <div class="field"><label for="fColumn">專欄名稱</label><input type="text" id="fColumn"></div>
          <div class="field"><label for="fAuthor">作者</label><input type="text" id="fAuthor"></div>
          <div class="field"><label for="fRole">作者角色頭銜</label><input type="text" id="fRole" placeholder="如：譯"></div>
          <div class="field"><label>其他</label><label class="check ad-check"><input type="checkbox" id="fAd"> 廣告</label></div>
          <div class="field field-range"><span class="lab req">影像範圍</span>
            <div class="range-grid" id="rangeBox">
              <span class="rg-l">起</span><input type="text" id="fPage1" aria-label="起始影像"><span class="rg-l">迄</span><input type="text" id="fPage2" aria-label="結束影像">
            </div>
            <div class="picked" id="pickedBox" hidden></div>
            <div hidden>
              <button class="link-btn" type="button" id="useStart">用目前影像</button><button class="link-btn" type="button" id="useEnd">用目前影像</button>
              <button class="link-btn" type="button" id="pageSetting">自訂範圍</button><button class="link-btn" type="button" id="pageReset">預設範圍</button>
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
</div>

<dialog id="metaDlg" aria-labelledby="metaTitle">
  <div class="dlg-head"><h2 id="metaTitle">載體編目</h2><button class="btn ghost" type="button" data-close>關閉</button></div>
  <div class="dlg-body" id="metaBody"></div>
  <div class="dlg-foot"><button class="btn primary" type="button" id="metaSave">存檔</button></div>
</dialog>

<dialog id="pickDlg" aria-labelledby="pickTitle">
  <div class="dlg-head"><h2 id="pickTitle">自訂範圍：依勾選順序</h2><button class="btn ghost" type="button" data-close>關閉</button></div>
  <div class="dlg-body" id="pickBody"></div>
  <div class="error" id="pickError" role="alert" hidden style="margin:0 14px 8px"></div>
  <div class="dlg-foot"><button class="btn primary" type="button" id="pickSave">存檔</button></div>
</dialog>

<dialog id="pagesDlg" aria-labelledby="pagesTitle">
  <div class="dlg-head"><h2 id="pagesTitle">編輯頁碼</h2><button class="btn ghost" type="button" data-close>關閉</button></div>
  <div class="dlg-body" id="pagesBody"></div>
  <div class="error" id="pagesError" role="alert" hidden style="margin:0 14px 8px"></div>
  <div class="dlg-foot"><button class="btn primary" type="button" id="pagesSave">存檔</button></div>
</dialog>

<dialog id="exportDlg" aria-labelledby="exportTitle">
  <div class="dlg-head"><h2 id="exportTitle">匯出與還原</h2><button class="btn ghost" type="button" data-close>關閉</button></div>
  <div class="dlg-body"><textarea id="exportText" readonly aria-label="匯出的 JSON 資料"></textarea></div>
  <div class="dlg-foot">
    <button class="btn primary" type="button" id="copyJson">複製 JSON</button>
    <span class="spacer"></span>
  </div>
</dialog>

<dialog id="tocDlg" aria-labelledby="tocTitle" style="width:min(980px, calc(100vw - 32px))">
  <div class="dlg-head"><h2 id="tocTitle">目錄分析草稿（AI 辨識，請核對後再加入）</h2><button class="btn ghost" type="button" data-close>關閉</button></div>
  <div class="dlg-body">
    <div class="inline" style="margin-bottom:8px"><label>印刷頁碼 1 對應影像 <select id="tocBase"></select></label><span class="notice">已有頁碼對照的影像會直接依頁碼比對；沒有時才用這個換算。</span></div>
    <div id="tocRows"></div>
  </div>
  <div class="error" id="tocError" role="alert" hidden style="margin:0 14px 8px"></div>
  <div class="dlg-foot"><button class="btn primary" type="button" id="tocAdd">加入篇目樹</button><span class="notice" id="tocCount"></span></div>
</dialog>
<dialog id="aiDlg" aria-labelledby="aiTitle" style="width:min(560px, calc(100vw - 32px))">
  <div class="dlg-head"><h2 id="aiTitle">AI 設定</h2><button class="btn ghost" type="button" data-close>關閉</button></div>
  <div class="dlg-body">
    <p style="margin-top:0">整頁辨識（分析整期、重新分析、分析本頁／目錄）使用 Google Gemini；欄位旁的彩色 AI 按鈕（框選圖片文字）只用本機 OCR，不使用金鑰。每位使用者可以輸入自己的 API 金鑰，額度各自計算；沒有輸入時，會使用伺服器設定的預設金鑰（如果有的話）。</p>
    <div class="field" style="display:flex;flex-direction:column;align-items:stretch;gap:6px">
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
<dialog id="engineDlg" aria-labelledby="engTitle" style="width:min(520px, calc(100vw - 32px))">
  <div class="dlg-head"><h2 id="engTitle">選擇分析方式</h2></div>
  <div class="dlg-body choices">
    <button class="choice" type="button" id="engApi"><strong>API 分析（Gemini）</strong><span>較準確，能判斷題名、作者、專欄；會耗用 API 額度，需要金鑰。</span></button>
    <button class="choice primary" type="button" id="engLocal"><strong>本機 OCR 分析（free）</strong><span>免費、不連網、不耗額度。以文字位置與「第○節」「目錄」等規則推測篇目與頁碼，較粗略；結果都會標為「待檢查」，請逐頁核對。</span></button>
  </div>
  <div class="dlg-foot"><span class="spacer"></span><button class="btn" type="button" id="engCancel">取消</button></div>
</dialog>
<dialog id="imgPreview" class="img-preview" aria-label="影像預覽">
  <div class="img-bar"><span class="img-cap" id="imgPreviewCap"></span><span class="spacer"></span><span class="notice" id="imgPreviewHint">點圖片可放大／縮小・Esc 關閉</span><button class="btn ghost" type="button" data-close>關閉</button></div>
  <div class="img-stage" id="imgStage"><img id="imgPreviewImg" alt=""></div>
</dialog>
<div class="toast" id="toast" role="status" hidden></div>
<script>window.BOOKS = <?= json_encode(array_values($books), JSON_UNESCAPED_UNICODE) ?>; window.SERVER_KEY = <?= GEMINI_API_KEY !== '' ? 'true' : 'false' ?>;</script>
<script src="app.js?v=18"></script>
<script src="pages.js?v=31"></script>
</body></html>