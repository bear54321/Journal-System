<?php
// 儲存整期篇目：saveIndex.php  book=<期刊>  tmpData=<JSON，以 uid 為鍵的扁平物件>
require_once __DIR__ . '/lib.php';

require_post();
$book = get_book();
$raw = isset($_POST['tmpData']) ? (string)$_POST['tmpData'] : '';
if ($raw === '' || strlen($raw) > INDEX_MAX_BYTES) out('bad tmpData', 400);

$in = json_decode($raw, true);
if (!is_array($in) || count($in) > 5000) out('bad tmpData', 400);

// 前端會把內容當 HTML 插入，這裡把 < > 換成全形，不留下可執行的標籤
function clean_text($v) {
  if (!is_scalar($v)) return '';
  return str_replace(['<', '>'], ['＜', '＞'], preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', '', (string)$v));
}

$out = [];
foreach ($in as $uid => $node) {
  $uid = (string)$uid;
  if (!preg_match('/^[A-Za-z0-9_.-]{1,64}$/', $uid) || !is_array($node)) out('bad node: ' . $uid, 400);

  $pageList = '';
  if (isset($node['page_list']) && is_array($node['page_list'])) {
    $pageList = array_values(array_filter(array_map('clean_text', $node['page_list']), 'strlen')) ?: '';
  }

  $item = [
    'title'       => clean_text($node['title'] ?? ''),
    'column_name' => clean_text($node['column_name'] ?? ''),
    'if_cm'       => empty($node['if_cm']) ? 0 : 1,
    'author'      => clean_text($node['author'] ?? ''),
    'author_app'  => clean_text($node['author_app'] ?? ''),
    'page_list'   => $pageList,
    'page1'       => clean_text($node['page1'] ?? ''),
    'page2'       => clean_text($node['page2'] ?? ''),
    'pid'         => clean_text($node['pid'] ?? 'start'),
  ];
  if ($item['title'] === '') out('empty title: ' . $uid, 400);
  // 自訂範圍用 page_list，起訖頁要留空；一般範圍則相反
  if ($pageList !== '') { $item['page1'] = ''; $item['page2'] = ''; }
  if (isset($node['sort'])) $item['sort'] = (int)$node['sort'];
  $out[$uid] = $item;
}

$dir = book_dir(DATA_DIR, $book);
with_lock($dir, function () use ($dir, $out) {
  $path = $dir . DIRECTORY_SEPARATOR . 'index.json';
  if (INDEX_HISTORY_KEEP > 0 && is_file($path)) {
    $hist = $dir . DIRECTORY_SEPARATOR . 'history';
    ensure_dir($hist);
    copy($path, $hist . DIRECTORY_SEPARATOR . 'index-' . date('Ymd-His') . '-' . substr(md5_file($path), 0, 6) . '.json');
    $old = glob($hist . DIRECTORY_SEPARATOR . 'index-*.json');
    sort($old);
    foreach (array_slice($old, 0, max(0, count($old) - INDEX_HISTORY_KEEP)) as $f) @unlink($f);
  }
  write_json_file($path, $out);
});
out('ok');
