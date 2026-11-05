<?php
// 取得印刷頁碼
//   page=all  → 整期對照表 {"<影像編號>":[影像編號, 期刊, 序號, 印刷頁碼], ...}，沒有資料時回傳空字串
//   page=<影像編號> → 該張的印刷頁碼，沒有時回傳空字串
// 前端只讀陣列的第 4 個元素 [3]，其餘欄位是為了和舊格式相容
require_once __DIR__ . '/lib.php';

$book = get_book();
$page = isset($_REQUEST['page']) ? (string)$_REQUEST['page'] : '';
$map = read_json_file(book_dir(DATA_DIR, $book) . DIRECTORY_SEPARATOR . 'pageno.json', []);

if ($page === 'all') {
  out($map ? json_encode($map, JSON_UNESCAPED_UNICODE) : '');
}
out(isset($map[$page][3]) ? (string)$map[$page][3] : '');
