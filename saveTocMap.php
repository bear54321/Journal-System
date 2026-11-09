<?php
// 儲存某期的「目錄對照」：saveTocMap.php  book=<期刊>  data=<JSON 陣列：[{tocPage, section, title}]>
require_once __DIR__ . '/lib.php';

require_post();
$book = get_book();
$raw = isset($_POST['data']) ? (string)$_POST['data'] : '';
if ($raw === '' || strlen($raw) > INDEX_MAX_BYTES) out('bad data', 400);
$in = json_decode($raw, true);
if (!is_array($in) || count($in) > 3000) out('bad data', 400);

function clean_str($v) {
  if (!is_scalar($v)) return '';
  return mb_substr(str_replace(['<', '>'], ['＜', '＞'], preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', '', (string)$v)), 0, 200);
}
$out = [];
foreach ($in as $e) {
  if (!is_array($e)) continue;
  $title = clean_str($e['title'] ?? ''); $section = clean_str($e['section'] ?? '');
  if ($title === '' || $section === '') continue;
  $out[] = ['tocPage' => clean_str($e['tocPage'] ?? ''), 'section' => $section, 'title' => $title];
}
$dir = book_dir(DATA_DIR, $book);
with_lock($dir, function () use ($dir, $out) { write_json_file($dir . DIRECTORY_SEPARATOR . 'tocmap.json', $out); });
out('ok');
