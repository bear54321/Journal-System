<?php
// 圖書館後台（libAdmin）請求共用函式：以 cookie 檔保存登入狀態，結束後刪除
require_once __DIR__ . '/lib.php';

// ---- 後台請求（以 cookie 檔保存登入狀態，結束後刪除）----
$jar = tempnam(sys_get_temp_dir(), 'toc');
register_shutdown_function(function () use ($jar) { @unlink($jar); });
function site_call($url, $post = null, $ajax = false) {
  global $jar;
  $u = parse_url(TOC_SITE_BASE);
  $h = ['Accept: ' . ($ajax ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,*/*;q=0.8'),
        'Origin: ' . $u['scheme'] . '://' . $u['host'], 'Referer: ' . TOC_SITE_BASE . 'Journal.action'];
  if ($ajax) $h[] = 'X-Requested-With: XMLHttpRequest';
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 5,
    CURLOPT_TIMEOUT => 120, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_HTTPHEADER => $h,
    CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0 Safari/537.36',
  ]);
  if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, $post); }
  $cainfo = __DIR__ . '/php/cacert.pem';
  if (is_file($cainfo)) curl_setopt($ch, CURLOPT_CAINFO, $cainfo);
  $body = curl_exec($ch);
  $err = curl_error($ch); $eff = (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL); $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($body === false) throw new RuntimeException('連線失敗：' . $err);
  return [$body, $http, $eff];
}
function site_login() {
  site_call(TOC_SITE_BASE . 'Login.action'); // 先取得 JSESSIONID
  [, , $eff] = site_call(TOC_SITE_BASE . 'Login.action', http_build_query(['account' => TOC_SITE_USER, 'pass' => TOC_SITE_PASS]));
  if (substr($eff, -strlen('Main.action')) !== 'Main.action') throw new RuntimeException('登入失敗（請確認帳密；不要連續重試以免帳號被鎖）');
}
function site_rows($endpoint, $orderColumn, $filters) {
  $payload = ['dataDTO.startIndex' => 0, 'dataDTO.pageSize' => 1000, 'dataDTO.draw' => 1, 'dataDTO.orderDir' => 'desc', 'dataDTO.orderColumn' => $orderColumn] + $filters;
  [$body, $http] = site_call(TOC_SITE_BASE . $endpoint, http_build_query($payload), true);
  $j = json_decode($body, true);
  if ($http !== 200 || !is_array($j) || ($j['code'] ?? 0) !== 200) throw new RuntimeException($endpoint . ' 回應異常' . (is_array($j) && !empty($j['msg']) ? '：' . $j['msg'] : ''));
  return $j['pageData']['data'] ?? [];
}


function search_journals($title) {
  $f = ['rqDTO.theme' => '', 'rqDTO.title' => $title, 'rqDTO.houseArea' => '', 'rqDTO.area' => '', 'rqDTO.issn' => '', 'rqDTO.isuse' => '', 'rqDTO.lang' => '', 'rqDTO.frequency' => '', 'rqDTO.barcodeNo' => ''];
  $items = [];
  foreach (site_rows('Journal_data.action', 'journalId', $f) as $r) {
    $items[] = ['journalId' => $r['journalId'] ?? null, 'title' => trim((string)($r['title'] ?? '')), 'issn' => trim((string)($r['issn'] ?? ''))];
    if (count($items) >= 20) break;
  }
  return $items;
}

// 簡體刊名 → 繁體（只在後台查不到時才用；要 AI 金鑰，沒有就略過）
function to_traditional($title) {
  $key = trim((string)($_POST['api_key'] ?? ''));
  if ($key !== '' && !preg_match('/^[A-Za-z0-9_.\-]{20,200}$/', $key)) return '';
  if ($key === '') $key = GEMINI_API_KEY;
  if ($key === '') return '';
  $body = ['contents' => [['parts' => [['text' => "把下列期刊名稱轉成台灣慣用的繁體中文，只回答轉換後的名稱，不要加任何說明或標點：\n" . $title]]]], 'generationConfig' => ['temperature' => 0]];
  foreach (GEMINI_MODELS as $model) {
    $ch = curl_init('https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body), CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $key],
      CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 40] + (is_file(__DIR__ . '/php/cacert.pem') ? [CURLOPT_CAINFO => __DIR__ . '/php/cacert.pem'] : []));
    $resp = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    if ($code !== 200 || $resp === false) continue;
    $j = json_decode($resp, true); $t = '';
    foreach (($j['candidates'][0]['content']['parts'] ?? []) as $p) if (isset($p['text']) && empty($p['thought'])) $t .= $p['text'];
    $t = trim(preg_replace('/[\s《》「」]+/u', '', $t));
    if ($t !== '' && mb_strlen($t) <= 80) return $t;
  }
  return '';
}

