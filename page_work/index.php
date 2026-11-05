<?php
require_once __DIR__ . '/../lib.php';

$book = isset($_GET['no']) ? trim((string)$_GET['no']) : '';
if ($book === '' || preg_match('/[\x00-\x1f\/\\\\]/', $book) || strpos($book, '..') !== false) {
  http_response_code(400);
  exit('bad book');
}
$images = array_map('strval', array_keys(list_images($book)));
$map = read_json_file(book_dir(DATA_DIR, $book) . DIRECTORY_SEPARATOR . 'pageno.json', []);
$h = function ($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); };
?><!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <title>修改頁碼 - <?= $h($book) ?></title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="../ui.css?v=25">
  <style>
    body { height: auto; }
    .pw-bar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px var(--gutter); background: var(--glass); -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px); border-bottom: 1px solid var(--line); }
    .pw-bar h1 { font-size: var(--t-section); margin: 0; font-weight: 600; }
    .pw-wrap { max-width: 880px; margin: var(--s4) auto; padding: 0 var(--gutter) var(--s6); }
    .pw-table { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); overflow: hidden; box-shadow: var(--sh-1); }
    .pw-table td { padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }
    .pw-table tr:last-child td { border-bottom: 0; }
    .pw-table img { height: 120px; border-radius: 6px; background: var(--sunken); }
    .pw-table .lbl { font-family: var(--mono); font-size: 12px; color: var(--fg-2); }
    .pw-table input { width: 110px; font-family: var(--mono); }
    #msg { font-size: 13px; color: var(--ok); }
  </style>
</head>
<body>
  <div class="pw-bar" id="bar">
    <a class="btn ghost" href="../index.php#<?= rawurlencode($book) ?>">‹ 回編目頁面</a>
    <h1><?= $h($book) ?>・修改頁碼</h1>
    <span class="notice">空白＝無頁碼</span>
    <span class="spacer"></span>
    <span id="msg" role="status"></span>
    <button class="btn primary" id="save" type="button">存檔</button>
  </div>
  <div class="pw-wrap">
  <table class="pw-table">
    <?php foreach ($images as $p): ?>
      <tr>
        <td class="lbl"><?= $h($p) ?></td>
        <td><img loading="lazy" src="../giveimg.php?b=<?= rawurlencode($book) ?>&p=<?= rawurlencode($p) ?>"></td>
        <td><input type="text" class="pno" aria-label="頁碼" data-p="<?= $h($p) ?>" value="<?= $h(isset($map[$p][3]) ? $map[$p][3] : '') ?>"></td>
      </tr>
    <?php endforeach; ?>
  </table>
  </div>
  <script>
    var book = <?= json_encode($book, JSON_UNESCAPED_UNICODE) ?>;
    document.getElementById('save').onclick = function () {
      var btn = this; btn.classList.add('loading');
      var data = {};
      document.querySelectorAll('.pno').forEach(function (i) { data[i.dataset.p] = i.value; });
      fetch('../savePageno.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ book: book, data: JSON.stringify(data) })
      }).then(function (r) { return r.text(); }).then(function (t) {
        btn.classList.remove('loading');
        var m = document.getElementById('msg');
        m.textContent = t === 'ok' ? '已儲存' : '失敗：' + t; m.style.color = t === 'ok' ? '' : 'var(--danger)';
      }).catch(function (e) { btn.classList.remove('loading'); var m = document.getElementById('msg'); m.textContent = '失敗：' + e.message; m.style.color = 'var(--danger)'; });
    };
  </script>
</body>
</html>
