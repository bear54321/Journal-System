<?php
// 儲存印刷頁碼（給「修改頁碼」頁面用，原本的 page_work 不在 base.js 裡，這支是補上的）
//   book + page + pageno         → 改一張
//   book + data（JSON：{"<影像編號>":"<印刷頁碼>"}） → 一次改多張
require_once __DIR__ . '/lib.php';

require_post();
$book = get_book();
$images = list_images($book);

$changes = [];
if (isset($_POST['data'])) {
  $decoded = json_decode((string)$_POST['data'], true);
  if (!is_array($decoded)) out('bad data', 400);
  $changes = $decoded;
} elseif (isset($_POST['page'])) {
  $changes[(string)$_POST['page']] = isset($_POST['pageno']) ? (string)$_POST['pageno'] : '';
} else {
  out('bad request', 400);
}

$dir = book_dir(DATA_DIR, $book);
with_lock($dir, function () use ($dir, $book, $images, $changes) {
  $path = $dir . DIRECTORY_SEPARATOR . 'pageno.json';
  $map = read_json_file($path, []);
  $order = array_flip(array_map('strval', array_keys($images)));
  foreach ($changes as $img => $pno) {
    $img = (string)$img;
    if (!isset($order[$img])) out('unknown page: ' . $img, 400);
    $pno = trim(strip_tags((string)$pno));
    if ($pno === '') unset($map[$img]);
    else $map[$img] = [$img, $book, $order[$img] + 1, $pno];
  }
  write_json_file($path, $map);
});
out('ok');
