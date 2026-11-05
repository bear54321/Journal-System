<?php
// 取得某期的篇目，格式：{"<uid>":{title, column_name, if_cm, author, author_app, page1, page2, page_list, pid, sort}, ...}
// 還沒有篇目時回傳 {}，不回傳空字串，前端才會照常綁定換頁事件、也會清掉上一期的畫面資料
require_once __DIR__ . '/lib.php';

$book = get_book();
$data = read_json_file(book_dir(DATA_DIR, $book) . DIRECTORY_SEPARATOR . 'index.json', []);
out($data ? json_encode($data, JSON_UNESCAPED_UNICODE) : '{}');
