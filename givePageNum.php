<?php
// 取得某期的影像編號清單，例：["001","002","003"]
require_once __DIR__ . '/lib.php';

$book = get_book();
out_json(array_map('strval', array_keys(list_images($book))));
