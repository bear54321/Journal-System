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
  <style>
    body { font-family: "Microsoft JhengHei", sans-serif; margin: 12px; }
    table { border-collapse: collapse; }
    td { border-bottom: 1px solid #999; padding: 4px 8px; vertical-align: middle; }
    img { height: 120px; }
    input { width: 90px; }
    #bar { position: sticky; top: 0; background: #fff; padding: 8px 0; }
  </style>
</head>
<body>
  <div id="bar">
    <a href="../index.php#<?= rawurlencode($book) ?>">回編目頁面</a>
    <b><?= $h($book) ?></b> 修改頁碼（空白＝無頁碼）
    <button id="save">存檔</button> <span id="msg"></span>
  </div>
  <table>
    <?php foreach ($images as $p): ?>
      <tr>
        <td><?= $h($p) ?></td>
        <td><img loading="lazy" src="../giveimg.php?b=<?= rawurlencode($book) ?>&p=<?= rawurlencode($p) ?>"></td>
        <td><input class="pno" data-p="<?= $h($p) ?>" value="<?= $h(isset($map[$p][3]) ? $map[$p][3] : '') ?>"></td>
      </tr>
    <?php endforeach; ?>
  </table>
  <script>
    var book = <?= json_encode($book, JSON_UNESCAPED_UNICODE) ?>;
    document.getElementById('save').onclick = function () {
      var data = {};
      document.querySelectorAll('.pno').forEach(function (i) { data[i.dataset.p] = i.value; });
      fetch('../savePageno.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ book: book, data: JSON.stringify(data) })
      }).then(function (r) { return r.text(); }).then(function (t) {
        document.getElementById('msg').textContent = t === 'ok' ? '已儲存' : '失敗：' + t;
      });
    };
  </script>
</body>
</html>
