<?php
// 取得某期的逐頁核對資料：{"<影像編號>":{own,title,column,author,role,ad,ok,unsure,more,ai}}；沒有時回傳 {}
require_once __DIR__ . '/lib.php';

$book = get_book();
$data = read_json_file(book_dir(DATA_DIR, $book) . DIRECTORY_SEPARATOR . 'pagerec.json', []);
out($data ? json_encode($data, JSON_UNESCAPED_UNICODE) : '{}');
