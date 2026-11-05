<?php
// 取得影像：giveimg.php?b=<期刊>&p=<影像編號>
require_once __DIR__ . '/lib.php';

$book = get_book('b');
$page = isset($_GET['p']) ? (string)$_GET['p'] : '';

// 只認 list_images 掃到的檔名，使用者輸入不會直接組成路徑
$images = list_images($book);
$file = isset($images[$page]) ? img_dir($book) . DIRECTORY_SEPARATOR . $images[$page] : null;
if ($file === null && is_file(IMG_PLACEHOLDER)) $file = IMG_PLACEHOLDER;
if ($file === null) out('not found', 404);

$types = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'];
$ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
header('Content-Length: ' . filesize($file));
header('Cache-Control: private, max-age=3600');
readfile($file);
