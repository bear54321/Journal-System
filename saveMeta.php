<?php
// 雜誌編目
//   action=get             → 回傳該期的編目 JSON（沒有時 {}）
//   meta=<JSON>            → 儲存，只收下方欄位
require_once __DIR__ . '/lib.php';

const META_FIELDS = [
  '刊名', '報刊名第一字', '報刊第一字筆畫', '關鍵詞主題', '專刊名稱', '刊期', '出版者', '出版地',
  '卷號', '西元出版日期(完整)', '出版年', '出版月', '出版日', '條碼號', '語言', '典藏單位',
  '目錄顯示', '數位物件前台開放權限', '數位物件開放限制', '前台可否下載', '是否製作浮水印', '線裝書', '資料類型',
];

require_post();
$book = get_book();
$path = book_dir(DATA_DIR, $book) . DIRECTORY_SEPARATOR . 'meta.json';

if (($_POST['action'] ?? '') === 'get') {
  $meta = read_json_file($path, []);
  out($meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : '{}');
}

$in = json_decode((string)($_POST['meta'] ?? ''), true);
if (!is_array($in)) out('bad meta', 400);

$meta = [];
foreach (META_FIELDS as $field) {
  if (!isset($in[$field]) || !is_scalar($in[$field])) continue;
  // 前端會把內容當 HTML 插入，< > 換成全形
  $meta[$field] = str_replace(['<', '>'], ['＜', '＞'], trim((string)$in[$field]));
}

with_lock(book_dir(DATA_DIR, $book), function () use ($path, $meta) {
  write_json_file($path, $meta);
});
out('ok');
