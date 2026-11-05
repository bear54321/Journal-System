<?php
require_once __DIR__ . '/config.php';

// $.post 的回應若是 application/json，jQuery 會先解析成物件，
// 前端再 JSON.parse(data) 就會壞掉，所以一律用 text/plain 回傳
function out($text, $status = 200) {
  http_response_code($status);
  header('Content-Type: text/plain; charset=utf-8');
  header('Cache-Control: no-store');
  echo $text;
  exit;
}

function out_json($data) {
  out(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function require_post() {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') out('POST only', 405);
}

// 期刊名如「海外黨務通訊 v.18 no.09x10」，只擋會跳出目錄或含控制字元的值
function get_book($key = 'book') {
  $book = isset($_REQUEST[$key]) ? trim((string)$_REQUEST[$key]) : '';
  if ($book === '' || $book === '0' || strlen($book) > 200
      || preg_match('/[\x00-\x1f\/\\\\]/', $book) || strpos($book, '..') !== false) {
    out('bad book', 400);
  }
  return $book;
}

// 期刊名編碼後當資料夾名，避免檔案系統不認的字元
function book_dir($base, $book) {
  return rtrim($base, '/\\') . DIRECTORY_SEPARATOR . rawurlencode($book);
}

function ensure_dir($dir) {
  if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) out('cannot create dir', 500);
}

function read_json_file($path, $default) {
  if (!is_file($path)) return $default;
  $fp = fopen($path, 'rb');
  if (!$fp) return $default;
  flock($fp, LOCK_SH);
  $raw = stream_get_contents($fp);
  flock($fp, LOCK_UN);
  fclose($fp);
  $data = json_decode($raw, true);
  return is_array($data) ? $data : $default;
}

// 先寫暫存檔再改名，寫到一半斷線也不會留下壞檔
function write_json_file($path, $data) {
  ensure_dir(dirname($path));
  $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
  $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if ($json === false || file_put_contents($tmp, $json, LOCK_EX) === false) out('write failed', 500);
  if (!rename($tmp, $path)) {
    @unlink($tmp);
    out('write failed', 500);
  }
}

// 存檔期間鎖住該期，避免兩個請求同時讀改寫
function with_lock($dir, $fn) {
  ensure_dir($dir);
  $fp = fopen($dir . DIRECTORY_SEPARATOR . '.lock', 'c');
  if (!$fp) out('lock failed', 500);
  flock($fp, LOCK_EX);
  try {
    return $fn();
  } finally {
    flock($fp, LOCK_UN);
    fclose($fp);
  }
}

// 該期的影像檔，key = 影像編號（檔名去掉副檔名），依自然排序
function img_dir($book) {
  // 影像資料夾可直接用期刊名（中文）命名，也接受網址編碼後的名稱
  $plain = rtrim(IMG_DIR, '/\\') . DIRECTORY_SEPARATOR . $book;
  return is_dir($plain) ? $plain : book_dir(IMG_DIR, $book);
}

function list_images($book) {
  $dir = img_dir($book);
  $found = [];
  if (is_dir($dir)) {
    foreach (scandir($dir) as $f) {
      if (preg_match('/^(.+)\.(jpe?g|png|gif|webp)$/i', $f, $m)) $found[$m[1]] = $f;
    }
  }
  uksort($found, 'strnatcasecmp');
  return $found;
}
