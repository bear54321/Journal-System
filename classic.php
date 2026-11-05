<?php
require_once __DIR__ . '/config.php';

// 期刊清單：影像資料夾與已有篇目的資料夾，合併後自然排序
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
  <title>舊版介面｜郭廷以圖書館數位化資料編目工作臺</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.13.2/themes/base/jquery-ui.min.css">
  <link rel="stylesheet" href="ui.css?v=25">
  <link rel="stylesheet" href="base.css?v=2">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.13.2/jquery-ui.min.js"></script>
  <script src="base.js?v=1"></script>
</head>
<body>
  <div class="topbar">
    <span>郭廷以圖書館數位化資料編目工作臺</span><span class="badge-classic">舊版介面</span>
    <select id="bookSelect">
      <option value="">選擇資料</option>
      <?php foreach ($books as $b): ?>
        <option value="<?= htmlspecialchars($b, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($b, ENT_QUOTES, 'UTF-8') ?></option>
      <?php endforeach; ?>
    </select>
    <a id="page_work" target="_blank"></a>
    <select id="pageSelect" hidden></select>
    <a class="back" href="index.php">‹ 回新版介面</a>
  </div>

  <div class="main">
    <div class="leftArea">
      <div id="viewer" class="viewer"><img id="viewerImg" alt=""></div>
      <div class="viewer_btns">
        <button id="zoomOut">－</button><button id="zoomFit">符合視窗</button><button id="zoomIn">＋</button>
      </div>
    </div>

    <div class="rightArea">
      <div class="buttons">
        <label class="level_setting"><input type="checkbox" id="level_on">啟用層級設定</label>
        <span id="updatePageno"></span>
        <input type="button" value="上一頁" id="goPrev">
        <input type="button" value="下一頁" id="goNext">
        <input type="button" value="雜誌編目" id="metaData_maz">
        <span id="saveDataLog"></span>
      </div>

      <table class="textData" id="textData">
        <tr><td class="td1">主要題名</td><td><textarea id="textarea" class="input_data" c="title"></textarea></td></tr>
        <tr><td class="td1">專欄名稱</td><td><input type="text" class="input_data" c="column_name"> <label><input type="checkbox" class="input_data" c="if_cm">廣告</label></td></tr>
        <tr><td class="td1">作者</td><td><input type="text" class="input_data" c="author"> 作者角色頭銜 <input type="text" class="input_data" c="author_app"></td></tr>
        <tr><td class="td1">起始頁</td><td>
          <span class="page_easy"><input type="text" id="page1"> ~ <input type="text" id="page2"></span>
          <textarea class="d-none" id="page_list"></textarea>
          <button id="page_setting">自訂範圍</button><button id="page_reset">預設範圍</button>
        </td></tr>
        <tr><td colspan="2">
          <button class="update_tree d-none">確定修改</button>
          <button class="add_tree">存檔</button>
          <button id="resetData">清空</button>
        </td></tr>
      </table>

      <div id="done_list"></div>
    </div>
  </div>

  <div id="mask" class="d-none"></div>

  <div id="meta_div" class="dialog d-none">
    <div class="dialog_ctrl"><button id="meta_close_btn">關閉</button></div>
    <table id="meta_table"></table>
    <button id="meta_save_btn">存檔</button>
  </div>

  <div id="page_div" class="dialog d-none">
    <div class="dialog_ctrl"><button id="page_close_btn">關閉</button></div>
    <div id="page_div_list"></div>
    <button id="page_save_btn">存檔</button>
  </div>
</body>
</html>
