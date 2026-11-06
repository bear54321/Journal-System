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
  // 允許以「/」表示資料夾階層（如「公報/河北省政府公報」），但不能有空的層級、「.」「..」或反斜線
  if ($book === '' || $book === '0' || strlen($book) > 200
      || preg_match('/[\x00-\x1f\\\\]/', $book) || strpos($book, '..') !== false
      || $book[0] === '/' || substr($book, -1) === '/' || strpos($book, '//') !== false
      || in_array('.', explode('/', $book), true)) {
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

// 資料清單：img/ 底下依資料夾階層掃描。有影像（或沒有子資料夾）的資料夾是一筆資料；
// 只含子資料夾的是「分類」，不單獨成為一筆。回傳以「/」連接的路徑，例如「公報/河北省政府公報」。
// 已有編目資料（data/）但影像資料夾不見的，也會列出（資料夾名稱是網址編碼，「/」存成 %2F）。
function scan_books($dir, $prefix, &$out, $depth = 0) {
  foreach (scandir($dir) as $d) {
    if ($d[0] === '.' || !is_dir($dir . '/' . $d)) continue;
    $sub = $dir . '/' . $d;
    $hasImg = false; $hasDir = false;
    foreach (scandir($sub) as $f) {
      if ($f[0] === '.') continue;
      if (is_dir($sub . '/' . $f)) $hasDir = true;
      elseif (preg_match('/\.(jpe?g|png|gif|webp)$/i', $f)) $hasImg = true;
    }
    $name = rawurldecode($d); // 影像資料夾也可能是網址編碼的名稱（img_dir 兩種都接受）
    if ($hasImg || !$hasDir || $depth >= 3) $out[$prefix . $name] = true;
    else scan_books($sub, $prefix . $name . '/', $out, $depth + 1);
  }
}
function list_books() {
  $books = [];
  if (is_dir(IMG_DIR)) scan_books(IMG_DIR, '', $books);
  if (is_dir(DATA_DIR)) {
    foreach (scandir(DATA_DIR) as $d) {
      if ($d[0] !== '.' && is_dir(DATA_DIR . '/' . $d)) $books[rawurldecode($d)] = true;
    }
  }
  $books = array_keys($books);
  natcasesort($books);
  return array_values($books);
}

// ---- 「最初狀態」：第一次 AI 分析前的樣子（逐頁核對資料、篇目、頁碼） ----
// 第一次用 AI 分析這一期時（analyze.php）自動記下，存在 data/<期>/initial/。之後可用 restoreInitial.php 一鍵還原。
// 舊資料（這個功能加入前就已經分析過）沒有真正的最初狀態，改用推測的：逐頁核對資料視為「未分析」、
// 頁碼移除 AI 填的（逐頁核對資料裡標為 AI 辨識／自動接續的頁）、篇目回到最早的備份版本（沒有備份就維持現況）。
const INITIAL_FILES = ['index.json', 'pageno.json', 'pagerec.json'];
function initial_dir($book) { return book_dir(DATA_DIR, $book) . DIRECTORY_SEPARATOR . 'initial'; }
function ensure_initial($book) {
  $dir = book_dir(DATA_DIR, $book); $ini = initial_dir($book);
  if (is_file($ini . DIRECTORY_SEPARATOR . 'info.json')) return;
  with_lock($dir, function () use ($dir, $ini) {
    if (is_file($ini . DIRECTORY_SEPARATOR . 'info.json')) return;
    ensure_dir($ini);
    $S = DIRECTORY_SEPARATOR;
    $legacy = is_file($dir . $S . 'pagerec.json');
    $rec = $legacy ? read_json_file($dir . $S . 'pagerec.json', []) : [];
    if (is_file($dir . $S . 'pageno.json')) {
      $map = read_json_file($dir . $S . 'pageno.json', []);
      if ($legacy) foreach ($rec as $label => $r) if (is_array($r) && (!empty($r['pnoAi']) || !empty($r['pnoAuto']))) unset($map[$label]);
      write_json_file($ini . $S . 'pageno.json', $map);
    }
    if (is_file($dir . $S . 'index.json')) {
      $src = $dir . $S . 'index.json';
      if ($legacy) { $h = glob($dir . $S . 'history' . $S . 'index-*.json') ?: []; sort($h); if ($h) $src = $h[0]; }
      copy($src, $ini . $S . 'index.json');
    }
    write_json_file($ini . $S . 'info.json', ['created' => date('Y-m-d H:i'), 'legacy' => $legacy]);
  });
}
