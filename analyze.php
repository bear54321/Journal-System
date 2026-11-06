<?php
if (function_exists('ini_set')) @ini_set('memory_limit', '512M'); // 大尺寸掃描檔（數千萬像素）縮圖時需要較多記憶體
// 用 Gemini 辨識影像，回傳篇目草稿（不會寫入任何資料，是否採用由使用者在前端決定）
//   mode=page  + page=<影像編號>             → {"articles":[{title,column_name,author,author_role,is_ad,uncertain}]}
//   mode=toc   + page=<影像編號>             → {"entries":[{title,column_name,author,author_role,is_ad,page,level}]}
//   mode=batch + pages=<JSON 影像編號陣列>   → {"pages":{"<影像編號>":{"articles":[...]}}}（一次請求處理多頁，節省免費額度）
// 回傳都會附 "model"：實際使用的模型。免費額度用完（429）時依序改用 GEMINI_MODELS 裡的下一個模型。
require_once __DIR__ . '/lib.php';

require_post();
set_time_limit(300); // Gemini 回應可能要數十秒，預設的 30 秒會被 PHP 中斷

// 框選辨識（本機 OCR）：把裁好的小圖轉給本機 OCR 服務（ocr/server.py），不需要 Gemini 金鑰，也不耗 API 額度
if (($_POST['mode'] ?? '') === 'ocr') { // 框選辨識一律走本機 OCR
  if (!function_exists('curl_init')) out('PHP 沒有啟用 curl 擴充', 500);
  $raw = base64_decode((string)($_POST['image'] ?? ''), true);
  if ($raw === false || $raw === '' || strlen($raw) > 6 * 1024 * 1024) out('框選的影像無法使用', 400);
  // 服務剛啟動時模型還在載入（約 10 秒）：連不上就等一下再試，最多約 10 秒
  for ($try = 0; $try < 5; $try++) {
    $ch = curl_init(OCR_LOCAL_URL . '/ocr');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $raw, CURLOPT_HTTPHEADER => ['Content-Type: application/octet-stream'], CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 90]);
    $resp = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    if ($resp !== false && $code !== 0) break;
    sleep(2);
  }
  if ($resp === false || $code === 0) out('本機 OCR 服務沒有啟動：請用 start.bat 啟動系統，或雙擊 ocr 資料夾裡的「啟動OCR.bat」。', 502);
  $j = json_decode($resp, true);
  if ($code !== 200 || !is_array($j)) out('本機 OCR 失敗：' . mb_substr((string)($j['error'] ?? $resp), 0, 200), 502);
  out_json(['text' => trim(str_replace(["\r", "\n"], '', (string)($j['text'] ?? ''))), 'model' => '本機 OCR']);
}

// 整頁分析（本機 OCR）：mode=page / batch + engine=local。用 ocr/server.py 的規則式分析，不需要 Gemini 金鑰
if (($_POST['engine'] ?? '') === 'local' && in_array($_POST['mode'] ?? 'page', ['page', 'batch', 'toc'], true)) {
  if (!function_exists('curl_init')) out('PHP 沒有啟用 curl 擴充', 500);
  $lbook = get_book();
  ensure_initial($lbook); // 第一次 AI 分析前，先記下這一期的最初狀態（可用「還原本期到最初狀態」回復）
  $limgs = list_images($lbook);
  $lmode = in_array($_POST['mode'] ?? 'page', ['batch', 'toc'], true) ? $_POST['mode'] : 'page';
  $lpath = $lmode === 'toc' ? '/toc' : '/analyze';
  $llabels = $lmode === 'batch' ? json_decode((string)($_POST['pages'] ?? ''), true) : [(string)($_POST['page'] ?? '')];
  if (!is_array($llabels) || !$llabels || count($llabels) > 8) out('pages 需為 1–8 張影像編號', 400);
  $lthread = (($_POST['thread'] ?? '') === '1') ? '1' : '0';
  $lout = [];
  foreach (array_values($llabels) as $lk => $l) {
    $l = (string)$l;
    if (!isset($limgs[$l])) out('找不到影像：' . $l, 400);
    $bytes = @file_get_contents(img_dir($lbook) . DIRECTORY_SEPARATOR . $limgs[$l]);
    if ($bytes === false || $bytes === '') out('讀不到影像：' . $l, 500);
    $resp = false; $code = 0;
    for ($try = 0; $try < 5; $try++) { // 服務剛啟動時模型還在載入：連不上就等一下再試
      $ch = curl_init(OCR_LOCAL_URL . $lpath . '?thread=' . $lthread . '&first=' . ((($_POST['first'] ?? '') === '1' && $lk === 0) ? '1' : '0'));
      curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $bytes, CURLOPT_HTTPHEADER => ['Content-Type: application/octet-stream'], CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 180]);
      $resp = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
      if ($resp !== false && $code !== 0) break;
      sleep(2);
    }
    if ($resp === false || $code === 0) out('本機 OCR 服務沒有啟動：請用 start.bat 啟動系統，或雙擊 ocr 資料夾裡的「start-ocr.bat」。', 502);
    $j = json_decode($resp, true);
    if ($code !== 200 || !is_array($j)) out('本機 OCR 失敗：' . mb_substr((string)($j['error'] ?? $resp), 0, 200), 502);
    if ($lmode === 'toc') {
      $ents = [];
      foreach (($j['entries'] ?? []) as $e) $ents[] = ['title' => (string)($e['title'] ?? ''), 'column_name' => '', 'author' => '', 'author_role' => '', 'is_ad' => false, 'page' => (string)($e['page'] ?? ''), 'level' => (int)($e['level'] ?? 0)];
      out_json(['entries' => $ents, 'model' => '本機 OCR']);
    }
    $arts = [];
    foreach (($j['articles'] ?? []) as $a) {
      $arts[] = ['title' => (string)($a['title'] ?? ''), 'column_name' => (string)($a['column_name'] ?? ''), 'author' => (string)($a['author'] ?? ''), 'author_role' => (string)($a['author_role'] ?? ''), 'is_ad' => false, 'uncertain' => [], 'alts' => array_values(array_map('strval', (array)($a['alts'] ?? []))), 'diff' => (array)($a['diff'] ?? [])];
    }
    $lout[$l] = ['articles' => $arts, 'printed_page' => ai_page($j['printed_page'] ?? ''), 'printed_raw' => (string)($j['printed_page'] ?? '')];
  }
  if ($lmode === 'page') { $one = $lout[(string)$llabels[0]]; unset($one['printed_raw']); $one['model'] = '本機 OCR'; out_json($one); }
  out_json(['pages' => (object)$lout, 'model' => '本機 OCR']);
}
// 金鑰：使用者在前端「AI 設定」輸入的優先（額度各自計算），沒有才用伺服器 config.local.php 裡的預設金鑰
$apiKey = trim((string)($_POST['api_key'] ?? ''));
if ($apiKey !== '' && !preg_match('/^[A-Za-z0-9_.\-]{20,200}$/', $apiKey)) out('金鑰格式不正確，請重新貼上。', 400);
if ($apiKey === '') $apiKey = GEMINI_API_KEY;
if ($apiKey === '') out('尚未設定 AI 金鑰：請按右上角「AI 設定」輸入您自己的 Gemini API 金鑰。', 401);
if (!function_exists('curl_init')) out('PHP 沒有啟用 curl 擴充', 500);

// 測試金鑰：只查詢模型清單，不會消耗生成額度
if (($_POST['mode'] ?? '') === 'test') {
  $ch = curl_init('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1');
  curl_setopt_array($ch, [CURLOPT_HTTPHEADER => ['x-goog-api-key: ' . $apiKey], CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 30]
    + (is_file(__DIR__ . '/php/cacert.pem') ? [CURLOPT_CAINFO => __DIR__ . '/php/cacert.pem'] : []));
  $resp = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $err = curl_error($ch); curl_close($ch);
  if ($resp === false) out('無法連線到 Google：' . $err, 502);
  if ($code === 200) out('ok');
  $m = json_decode($resp, true)['error']['message'] ?? ('HTTP ' . $code);
  out((in_array($code, [400, 401, 403], true) ? '金鑰無效或沒有權限：' : 'Google 回應錯誤：') . mb_substr($m, 0, 200), 400);
}

$book = get_book();
$mode = in_array($_POST['mode'] ?? '', ['toc', 'batch', 'ocr', 'pageno'], true) ? $_POST['mode'] : 'page'; // pageno：只重新辨識頁碼（頁碼不連續的頁自動重辨用）
if ($mode !== 'ocr') ensure_initial($book); // 第一次 AI 分析前，先記下這一期的最初狀態
$thread = (($_POST['thread'] ?? '') === '1'); // 線裝書模式：頁碼以中縫（版心）為主
$first = (($_POST['first'] ?? '') === '1');   // 這次的第一張影像是整本資料的第一頁（用來判斷封面）
$images = list_images($book);

$labels = [];
if ($mode === 'batch') {
  $labels = json_decode((string)($_POST['pages'] ?? ''), true);
  if (!is_array($labels) || !$labels || count($labels) > 8) out('pages 需為 1–8 張影像編號', 400);
  $labels = array_map('strval', array_values($labels));
} else {
  $labels = $mode === 'ocr' ? [] : [isset($_POST['page']) ? (string)$_POST['page'] : '']; // ocr：前端框選的小圖，不對應整張影像
}
foreach ($labels as $l) if (!isset($images[$l])) out('找不到影像：' . $l, 400);

// Gemini 的結果沒有「候選」：用本機 OCR（如果服務有開）重讀一次這張影像，把它讀到的標題當成候選，讓使用者可以點選替換
function add_local_cands(&$arts, $path, $thread, $first) {
  if (!$arts || !function_exists('curl_init') || !is_file($path)) return;
  $title = (string)($arts[0]['title'] ?? '');
  if ($title === '') return;
  $bytes = @file_get_contents($path);
  if ($bytes === false || $bytes === '') return;
  $ch = curl_init(OCR_LOCAL_URL . '/analyze?thread=' . ($thread ? '1' : '0') . '&first=' . ($first ? '1' : '0'));
  curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $bytes, CURLOPT_HTTPHEADER => ['Content-Type: application/octet-stream'], CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 1, CURLOPT_TIMEOUT => 60]);
  $resp = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
  if ($resp === false || $code !== 200) return;
  $j = json_decode($resp, true);
  if (!is_array($j)) return;
  $norm = function ($t) { return str_replace(' ', '', (string)$t); };
  $alts = [];
  foreach (($j['articles'] ?? []) as $la) {
    foreach (array_merge([$la['title'] ?? ''], (array)($la['alts'] ?? [])) as $t) {
      $t = (string)$t;
      if ($t === '' || $norm($t) === $norm($title)) continue;
      foreach ($alts as $x) if ($norm($x) === $norm($t)) continue 2;
      $alts[] = $t;
    }
  }
  $alts = array_slice($alts, 0, 6);
  $diff = [];
  if (strpos($title, ' ') === false) {
    $tc = preg_split('//u', $title, -1, PREG_SPLIT_NO_EMPTY);
    $same = [$tc];
    foreach ($alts as $a) { $ac = preg_split('//u', $a, -1, PREG_SPLIT_NO_EMPTY); if (count($ac) === count($tc)) $same[] = $ac; }
    for ($p = 0; $p < count($tc); $p++) {
      $chars = [];
      foreach ($same as $c) if (!in_array($c[$p], $chars, true)) $chars[] = $c[$p];
      if (count($chars) > 1) $diff[] = ['i' => $p, 'chars' => $chars];
    }
  }
  $arts[0]['alts'] = $alts;
  $arts[0]['diff'] = array_slice($diff, 0, 8);
}

// 頁碼一律轉成阿拉伯數字字串：「二十一」→21、「廿三」→23、「iv」→4、「（15）」→15；沒有或看不懂就回傳空字串
// 一張影像有兩個頁碼（左右跨頁）：「1-2」「一–二」都轉成「1-2」；兩個都要看得懂，且後者較大，否則回傳空字串
// AI 回傳的頁碼 → 單一頁碼：同一張影像若有兩個頁碼（例如左右跨頁印著 2484 和 2485，或回傳「2484-2485」「2484、2485」），只取數字較小的那一個
function ai_page($s) {
  $s = trim((string)$s);
  if ($s === '') return '';
  $best = '';
  foreach (preg_split('#[\s,，、;；/|\-–—－~～至]+#u', $s, -1, PREG_SPLIT_NO_EMPTY) as $p) {
    $n = normalize_page_one($p);
    if ($n !== '' && ($best === '' || (int)$n < (int)$best)) $best = $n;
  }
  return $best;
}
function normalize_page($s) {
  $s = trim((string)$s);
  $parts = preg_split('/\s*[-–—－~～至]\s*/u', $s);
  if (count($parts) === 2 && trim($parts[0]) !== '' && trim($parts[1]) !== '') {
    $a = normalize_page_one($parts[0]); $b = normalize_page_one($parts[1]);
    if ($a === '' || $b === '') return '';
    return (int)$b > (int)$a ? $a . '-' . $b : ($a === $b ? $a : '');
  }
  return normalize_page_one($s);
}
function normalize_page_one($s) {
  $s = trim((string)$s);
  if ($s === '') return '';
  $s = strtr($s, ['０'=>'0','１'=>'1','２'=>'2','３'=>'3','４'=>'4','５'=>'5','６'=>'6','７'=>'7','８'=>'8','９'=>'9']);
  $s = preg_replace('/[\s　()（）\[\]【】第頁页pP\.\-—－~～・]+/u', '', $s);
  if ($s === '') return '';
  if (preg_match('/^\d{1,4}$/', $s)) return (string)(int)$s;
  if (preg_match('/^[ivxlc]{1,6}$/i', $s)) {
    $v = ['i' => 1, 'v' => 5, 'x' => 10, 'l' => 50, 'c' => 100]; $n = 0; $s = strtolower($s); $len = strlen($s);
    for ($k = 0; $k < $len; $k++) { $a = $v[$s[$k]]; $b = $k + 1 < $len ? $v[$s[$k + 1]] : 0; $n += $a < $b ? -$a : $a; }
    return $n > 0 ? (string)$n : '';
  }
  if (preg_match('/^[〇零一二三四五六七八九十百廿卅]+$/u', $s)) {
    $d = ['〇'=>0,'零'=>0,'一'=>1,'二'=>2,'三'=>3,'四'=>4,'五'=>5,'六'=>6,'七'=>7,'八'=>8,'九'=>9];
    $chars = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
    if (!preg_match('/[十百廿卅]/u', $s)) { // 逐位數字，如「二〇」「一二」
      $str = ''; foreach ($chars as $c) $str .= $d[$c];
      return strlen($str) <= 4 ? (string)(int)$str : '';
    }
    $total = 0; $cur = 0;
    foreach ($chars as $c) {
      if (isset($d[$c])) { $cur = $d[$c]; }
      elseif ($c === '廿') { $total += 20; $cur = 0; }
      elseif ($c === '卅') { $total += 30; $cur = 0; }
      elseif ($c === '十') { $total += ($cur ?: 1) * 10; $cur = 0; }
      elseif ($c === '百') { $total += ($cur ?: 1) * 100; $cur = 0; }
    }
    $total += $cur;
    return $total > 0 ? (string)$total : '';
  }
  return '';
}
// php.ini 的容量寫法（128M、1G、-1）轉成位元組；-1 代表不限制，回傳 0
function php_ini_bytes($v) {
  $v = trim((string)$v);
  if ($v === '' || $v === '-1') return 0;
  $n = (float)$v;
  switch (strtolower(substr($v, -1))) { case 'g': $n *= 1024; case 'm': $n *= 1024; case 'k': $n *= 1024; }
  return (int)$n;
}
// 縮圖：大圖掃描檔動輒數 MB，縮到長邊 ANALYZE_MAX_EDGE 再送，辨識效果差異很小
function load_image($path, $edge) {
  $raw = file_get_contents($path);
  if (function_exists('imagecreatefromstring')) {
    // GD 解開影像要用「寬×高×約 5 位元組」的記憶體：先估算，不夠就嘗試調高上限，仍不夠就回明確訊息（否則 PHP 會直接當掉，只看到 500）
    $info = @getimagesizefromstring($raw);
    if ($info) {
      $need = (int)($info[0] * $info[1] * 5) + 48 * 1024 * 1024;
      $limit = php_ini_bytes(ini_get('memory_limit'));
      if ($limit > 0 && $need > $limit) {
        if (function_exists('ini_set')) @ini_set('memory_limit', (string)min($need, 1024 * 1024 * 1024));
        $limit = php_ini_bytes(ini_get('memory_limit'));
      }
      if ($limit > 0 && $need > $limit) {
        out('影像太大（' . $info[0] . '×' . $info[1] . '），伺服器記憶體不足以縮圖。請調高 php.ini 的 memory_limit，或先把掃描檔縮小。', 400);
      }
    }
    $im = @imagecreatefromstring($raw);
    if ($im) {
      $w = imagesx($im); $h = imagesy($im);
      $k = min(1, $edge / max($w, $h));
      if ($k < 1) {
        $scaled = imagescale($im, max(1, (int)round($w * $k)), max(1, (int)round($h * $k)));
        if ($scaled) $im = $scaled;
      }
      ob_start();
      imagejpeg($im, null, 85);
      return ['image/jpeg', ob_get_clean()];
    }
  }
  if (strlen($raw) > 6 * 1024 * 1024) out('影像太大，且伺服器沒有 GD 擴充可縮圖', 400);
  $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
  $types = ['png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'];
  return [$types[$ext] ?? 'image/jpeg', $raw];
}


$article = [
  'type' => 'OBJECT',
  'properties' => [
    'title'       => ['type' => 'STRING'],
    'column_name' => ['type' => 'STRING'],
    'author'      => ['type' => 'STRING'],
    'author_role' => ['type' => 'STRING'],
    'is_ad'       => ['type' => 'BOOLEAN'],
  ],
  'required' => ['title'],
];
$rules = "規則：\n"
  . "- 使用影像中的原文，保留繁體字與異體字，不要轉成簡體，也不要自行改寫或補字。\n"
  . "- 看不清楚或沒有的欄位留空字串，不要猜測。\n"
  . "- column_name 是專欄、欄目名稱（如「專題」「書評」「詩」）；author 是作者姓名；author_role 是作者的角色（如「譯」「撰」「編」）；is_ad 是廣告或啟事。\n"
  . "- 作者有多位時，用「、」連接。\n"
  . "- 每頁上緣或下緣重複出現的刊名、期數、頁碼（頁眉頁腳）不是專欄名稱，也不是篇目，請忽略。圖片說明、插圖標題也不是篇目。";
$pageRules = "- 只列這一頁上「開頭」的文章或廣告（有標題的那些），依版面主要程度排序；只是接續上一頁的內文不要列。\n"
  . "- uncertain 列出你沒有把握的欄位（title、author、column_name），字跡模糊、被遮住或不確定時才列。\n"
  . "- 【目錄頁優先】若這一頁是目錄頁（版面是一條條篇名加頁碼的清單，或頁首印有「目錄」「目次」「總目」「…彙編總目」等字樣），articles 只回傳一筆：title 填這一頁上印的目錄標題原文（例如「新民叢報彙編總目」，要連刊名一併照抄）；找不到印出的標題才填「目錄」；column_name 填「目錄」，author 留空。目錄裡列出的各篇篇名一律不要當成 articles 列出，也不要拿第一篇篇名當 title。
"
  . "- 若這一頁沒有任何文章標題，articles 回傳空陣列。\n"
  . "- printed_page 是這一頁上實際印的頁碼（多在上緣或下緣，如「21」「二」「(三)」），一律轉成阿拉伯數字（二十一→21、iv→4）；沒有頁碼或看不清楚時留空字串。頁碼通常是單獨一個小數字或中文數字，印在版面邊緣（上緣、下緣或書口），很不起眼，請仔細找。直排的中文數字要逐字讀：「二〇」是 20（「二」有兩橫，不要拆成兩個「一」；「〇」是零）、「二一」是 21、「一〇」是 10、「十」開頭的如「十二」是 12。空白頁、封面、版權頁、圖版頁通常沒有頁碼，一律留空。若同一張影像上看得到兩個頁碼（例如左右攤開的跨頁，左右頁各印一個，如 2484 和 2485），請兩個都寫出來，用「、」連接（填「2484、2485」），不用自己挑選，系統會自動取數字較小的那一個；只有一個頁碼就只寫那一個。每一頁都要獨立辨識：只填你在那張影像上真的看見的頁碼，不要用前後頁推算、不要依序編號、不要把影像順序當成頁碼，也不要把頁眉上的期數當頁碼；看不到就留空字串。\n";

// 線裝書：頁碼印在書葉中央的中縫（版心），不是版面邊緣。影像常是左右攤開的跨頁，頁碼在兩半之間
if ($thread) $pageRules .= "- 【線裝書】這一本的頁碼不是印在版面邊緣，而是在書葉中央的中縫（版心）上，通常與書名、卷次、魚尾符號一起，為直排小字（例如「卷二　十五」或單獨的「十五」）。影像可能是左右攤開的跨頁，兩半之間的中縫就是版心。printed_page 請以版心上的頁（葉）次數字為準（本條優先於上一條關於版面邊緣的說明）；卷次不是頁碼；版心上看不到、被書口遮住或太模糊就留空字串，不要讀內文裡的數字。影像外緣角落（左下、右下）旋轉的小數字（例如「13」「14」）是面次，不是頁碼，請忽略。\n";
if ($thread) $pageRules .= "- 【線裝書的題名】title 要填「文章開頭的完整標題行」：它通常印在書葉最右側第一欄的最上方，字數較多（例如「法理學大家孟德斯鳩之學說」），要整行完整抄寫，不能只抄一部分，也不要把內文第一句併進去。版心（書葉中央的縫）上的文字（例如「孟德斯鳩學說」）只是書名或篇名的簡稱，不是這一頁的完整題名；只有在這一頁完全找不到標題行時，才可以拿版心文字當題名。若有多個標題（例如章與節），照由右到左、由上到下的順序各列一筆。\n";
if ($first) $pageRules .= "- 【封面判斷】這一批的第 1 張影像是整本資料的第一頁，前面沒有任何一頁，所以不可能沿用前頁。若它是封面（內容主要是書名、刊名、期數、作者、出版資訊，沒有文章內容），articles 只回傳一筆：title 填「封面上的主要題名-封面」（例如「新民叢報彙編卷一-封面」），其他欄位留空，封面上的其他文字不要另外列出。若它不是封面（直接就是目錄或文章），照一般規則辨識。\n";

$edge = $thread ? max(ANALYZE_MAX_EDGE, 2400) : ANALYZE_MAX_EDGE; // 中縫的字很小，線裝書用較高解析度
$parts = [];
if ($mode === 'ocr') {
  // 框選辨識：前端把使用者框選的區域裁成小圖送來，只轉錄裡面的文字，用來填單一欄位
  $fieldNames = ['title' => '主要題名', 'author' => '作者', 'column' => '專欄名稱', 'role' => '作者角色（如「譯」「撰」「編」）'];
  $field = (string)($_POST['field'] ?? 'title');
  if (!isset($fieldNames[$field])) out('field 不正確', 400);
  $raw = base64_decode((string)($_POST['image'] ?? ''), true);
  if ($raw === false || $raw === '' || strlen($raw) > 6 * 1024 * 1024) out('框選的影像無法使用', 400);
  $info = @getimagesizefromstring($raw);
  if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG], true)) out('框選的影像格式不正確', 400);
  $schema = ['type' => 'OBJECT', 'properties' => ['text' => ['type' => 'STRING']], 'required' => ['text']];
  $hint = ['title' => '標題文字', 'author' => '作者姓名（有多位用「、」連接；不要包含「撰」「著」「譯」等角色字）', 'column' => '專欄或欄目名稱', 'role' => '作者的角色字（如「譯」「撰」「編」）'][$field];
  $parts[] = ['text' => "這是從一份中文期刊、圖書或古籍掃描影像中框選出來的一小塊區域（可能是直排、繁體、舊字體）。請逐字轉錄區域內的文字，用來填入「" . $fieldNames[$field] . "」欄位，內容應是" . $hint . "。\n"
    . "- 直排文字由右到左、由上到下讀；多行連成一段，不要加空白或換行。\n"
    . "- 使用影像中的原文，保留繁體字與異體字，不要轉成簡體，也不要改寫、補字或加標點。\n"
    . "- 只回傳區域內看得見的文字；看不清楚或沒有文字就回傳空字串，不要猜測。"];
  $parts[] = ['inline_data' => ['mime_type' => image_type_to_mime_type($info[2]), 'data' => base64_encode($raw)]];
} elseif ($mode === 'pageno') {
  // 只找頁碼：用較高解析度（小字不被縮掉），提示專心找頁碼，不分心辨識篇目
  $edge = max($edge, 3200);
  $schema = ['type' => 'OBJECT', 'properties' => ['printed_page' => ['type' => 'STRING'], 'note' => ['type' => 'STRING']], 'required' => ['printed_page']];
  $parts[] = ['text' => "這是一份中文期刊或公報的掃描影像（可能是直排、繁體、舊字體）。這次只需要找出「印在書上的頁碼」，不用辨識篇目。\n"
    . "- 頁碼一律轉成阿拉伯數字（二十一→21、iv→4）；直排中文數字逐字讀：「二〇」是 20、「二一」是 21、「一〇」是 10、「十二」是 12。\n"
    . "- 只填你在這張影像上真的看見的頁碼：不要用前後頁推算、不要依序編號、不要把頁眉上的期數、卷次、文號當頁碼；看不到就留空字串。\n"
    . "- note 用一句話寫出你在哪裡看到頁碼（例如「頁眉」「頁腳」「外緣」），沒有看到就寫「無」。\n"
    . ($thread ? "- 【線裝書】頁碼在書葉中央的中縫（版心）。\n" : '')];
} elseif ($mode === 'toc') {
  $article['properties']['page'] = ['type' => 'STRING'];
  $article['properties']['level'] = ['type' => 'INTEGER'];
  $article['required'] = ['title', 'page'];
  $schema = ['type' => 'OBJECT', 'properties' => ['entries' => ['type' => 'ARRAY', 'items' => $article]], 'required' => ['entries']];
  $parts[] = ['text' => "這是一份中文期刊的目錄頁掃描影像（可能是直排、繁體、舊字體）。請依目錄由上到下、由右到左的閱讀順序，列出每一筆篇目。\n"
    . "- page 是目錄上標示的印刷頁碼，照原樣填寫（如「12」「附錄 3」），沒有就留空。\n"
    . "- level：頂層篇目為 0；縮排、歸屬於上一個專題或欄目底下的子篇目為 1。\n"
    . "- 若這一頁不是目錄，entries 回傳空陣列。\n" . $rules];
} else {
  $article['properties']['uncertain'] = ['type' => 'ARRAY', 'items' => ['type' => 'STRING', 'enum' => ['title', 'author', 'column_name']]];
  if ($mode === 'page') {
    $schema = ['type' => 'OBJECT', 'properties' => ['articles' => ['type' => 'ARRAY', 'items' => $article], 'printed_page' => ['type' => 'STRING']], 'required' => ['articles']];
    $parts[] = ['text' => "這是一份中文期刊的單頁掃描影像（可能是直排、繁體、舊字體）。\n" . $pageRules . $rules];
  } else {
    $edge = min($edge, $thread ? 2400 : 2000); // 多張一起送：頁碼是很小的字，縮太小會讀錯（原本 1600 對大尺寸掃描檔不夠），所以和單頁用同樣的解析度
    $page = ['type' => 'OBJECT', 'properties' => ['index' => ['type' => 'INTEGER'], 'articles' => ['type' => 'ARRAY', 'items' => $article], 'printed_page' => ['type' => 'STRING']], 'required' => ['index', 'articles']];
    $schema = ['type' => 'OBJECT', 'properties' => ['pages' => ['type' => 'ARRAY', 'items' => $page]], 'required' => ['pages']];
    $parts[] = ['text' => '以下是同一期中文期刊連續的 ' . count($labels) . " 張掃描影像（可能是直排、繁體、舊字體），依序編號 1 到 " . count($labels) . "。"
      . "請對每一張影像各回傳 pages 的一筆資料，index 是該影像的編號。\n" . $pageRules . $rules];
  }
}
foreach ($labels as $k => $l) {
  list($mime, $bytes) = load_image(img_dir($book) . DIRECTORY_SEPARATOR . $images[$l], $edge);
  if ($mode === 'batch') $parts[] = ['text' => '第 ' . ($k + 1) . ' 張影像：'];
  $parts[] = ['inline_data' => ['mime_type' => $mime, 'data' => base64_encode($bytes)]];
}

$gen = ['responseMimeType' => 'application/json', 'responseSchema' => $schema, 'temperature' => 0.1, 'thinkingConfig' => ['thinkingLevel' => 'low']];

function call_model($model, $body, $key) {
  $ch = curl_init('https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent');
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($body),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $key],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT => 200,
  ] + (is_file(__DIR__ . '/php/cacert.pem') ? [CURLOPT_CAINFO => __DIR__ . '/php/cacert.pem'] : []));
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $err = curl_error($ch);
  curl_close($ch);
  return [$code, $resp === false ? null : json_decode($resp, true), $err];
}

// 依序試每個模型：額度用完(429)或模型不可用(404)就換下一個；忙碌(503)等一下重試
$models = (isset($_POST['model']) && in_array($_POST['model'], GEMINI_MODELS, true)) ? [$_POST['model']] : GEMINI_MODELS; // model 參數只能指定清單內的模型（測試與比較用）
$quota = []; $lastErr = '';
$data = null; $usedModel = '';
foreach ($models as $model) {
  $g = $gen;
  for ($try = 0; $try < 3; $try++) {
    list($code, $json, $err) = call_model($model, ['contents' => [['parts' => $parts]], 'generationConfig' => $g], $apiKey);
    if ($code === 400 && isset($g['thinkingConfig']) && stripos($json['error']['message'] ?? '', 'think') !== false) { unset($g['thinkingConfig']); continue; }
    if ($code === 503) { sleep(3 * ($try + 1)); continue; }
    break;
  }
  if ($json === null && $err !== '') { $lastErr = '連線 Gemini 失敗：' . $err; break; }
  if ($code === 200) { $data = $json; $usedModel = $model; break; }
  $msg = $json['error']['message'] ?? ('HTTP ' . $code);
  if ($code === 429) { $quota[] = $msg; continue; }
  if ($code === 404) continue;
  $lastErr = 'Gemini 錯誤（' . $model . '）：' . mb_substr($msg, 0, 600);
  if ($code === 503) continue;
  break;
}

if ($data === null) {
  if ($lastErr !== '' && !$quota) out($lastErr, 502);
  if ($quota) {
    $perDay = false; $retry = '';
    foreach ($quota as $q) { if (stripos($q, 'per day') !== false) $perDay = true; if (preg_match('/retry in ([0-9hms\.]+)/i', $q, $m)) $retry = $m[1]; }
    if ($perDay) out('今天的免費額度已用完（已嘗試 ' . count($quota) . ' 個模型），' . ($retry ? '約 ' . preg_replace('/\.\d+s/', 's', $retry) . ' 後恢復。' : '請明天再試。'), 429);
    out('請求太頻繁，請稍後再試。', 429);
  }
  out($lastErr ?: 'Gemini 沒有回應', 502);
}

$text = '';
foreach (($data['candidates'][0]['content']['parts'] ?? []) as $part) {
  if (isset($part['text']) && empty($part['thought'])) $text .= $part['text'];
}
$result = json_decode($text, true);
if (!is_array($result)) out('Gemini 沒有回傳可讀的結果', 502);

// 頁眉的刊名常被誤當成專欄：專欄名稱若就是期刊名的一部分，清空它
$bookName = basename($book); // 資料夾階層（如「公報/河北省政府公報」）只拿最後一層比對刊名
$clean = function (&$rows) use ($bookName) {
  if (!is_array($rows)) return;
  foreach ($rows as &$row) {
    if (!empty($row['column_name']) && mb_strlen($row['column_name']) >= 2 && mb_strpos($bookName, $row['column_name']) !== false) $row['column_name'] = '';
  }
  unset($row);
};
if (isset($result['articles'])) $clean($result['articles']);
if ($mode === 'page' && isset($result['articles'])) add_local_cands($result['articles'], img_dir($book) . DIRECTORY_SEPARATOR . $images[$labels[0]], $thread, $first);
if (isset($result['entries'])) $clean($result['entries']);
if ($mode === 'ocr') $result['text'] = trim(str_replace(["\r", "\n"], '', (string)($result['text'] ?? '')));
if (isset($result['printed_page'])) $result['printed_page'] = ai_page($result['printed_page']);
if ($mode === 'batch') {
  $byLabel = [];
  foreach (($result['pages'] ?? []) as $p) {
    $i = (int)($p['index'] ?? 0) - 1;
    if (!isset($labels[$i])) continue;
    $a = $p['articles'] ?? [];
    $clean($a);
    $byLabel[$labels[$i]] = ['articles' => $a, 'printed_page' => ai_page($p['printed_page'] ?? ''), 'printed_raw' => (string)($p['printed_page'] ?? '')];
  }
  $kk = 0;
  foreach ($byLabel as $lb => &$pg) { add_local_cands($pg['articles'], img_dir($book) . DIRECTORY_SEPARATOR . $images[$lb], $thread, $first && $kk === 0); $kk++; }
  unset($pg);
  $result = ['pages' => (object)$byLabel];
}
$result['model'] = $usedModel;
out_json($result);
