<?php
// 儲存整期的逐頁核對資料：savePageRec.php  book=<期刊>  data=<JSON，以影像編號為鍵>
// 這份資料是「逐頁檢查」用的工作資料；要變成正式篇目，由前端合併後走 saveIndex.php
require_once __DIR__ . '/lib.php';

require_post();
$book = get_book();
$raw = isset($_POST['data']) ? (string)$_POST['data'] : '';
if ($raw === '' || strlen($raw) > INDEX_MAX_BYTES) out('bad data', 400);
$in = json_decode($raw, true);
if (!is_array($in)) out('bad data', 400);

$images = array_map('strval', array_keys(list_images($book)));
$valid = array_flip($images);

function t($v) {
  if (!is_scalar($v)) return '';
  return str_replace(['<', '>'], ['＜', '＞'], preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', '', (string)$v));
}
function article($a) {
  $a = is_array($a) ? $a : [];
  return ['title' => t($a['title'] ?? ''), 'column' => t($a['column'] ?? ''), 'author' => t($a['author'] ?? ''), 'role' => t($a['role'] ?? '')];
}

$out = [];
foreach ($in as $label => $r) {
  $label = (string)$label;
  if (!isset($valid[$label])) out('unknown page: ' . $label, 400);
  if (!is_array($r)) continue;
  $rec = article($r);
  $rec['own'] = empty($r['own']) ? 0 : 1;
  $rec['ad'] = empty($r['ad']) ? 0 : 1;
  $rec['ok'] = empty($r['ok']) ? 0 : 1;
  $rec['pnoAi'] = empty($r['pnoAi']) ? 0 : 1;
  $rec['pnoAuto'] = empty($r['pnoAuto']) ? 0 : 1;
  $rec['unsure'] = array_values(array_intersect(is_array($r['unsure'] ?? null) ? $r['unsure'] : [], ['title', 'author', 'column']));
  $rec['more'] = array_map('article', array_slice(is_array($r['more'] ?? null) ? $r['more'] : [], 0, 6));
  $rec['ai'] = isset($r['ai']) && is_array($r['ai']) ? article($r['ai']) : null;
  $out[$label] = $rec;
}

$dir = book_dir(DATA_DIR, $book);
with_lock($dir, function () use ($dir, $out) {
  write_json_file($dir . DIRECTORY_SEPARATOR . 'pagerec.json', $out);
});
out('ok');
