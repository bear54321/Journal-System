<?php
// 取得某期的「目錄對照」（欄目標題 ↔ 篇名，由目錄頁分析而來，用來校正逐頁核對的欄目標題）；沒有時回傳 []
require_once __DIR__ . '/lib.php';

$book = get_book();
$data = read_json_file(book_dir(DATA_DIR, $book) . DIRECTORY_SEPARATOR . 'tocmap.json', []);
out($data ? json_encode(array_values($data), JSON_UNESCAPED_UNICODE) : '[]');
