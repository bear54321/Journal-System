<?php
// 期刊目次 AI 辨識：analyzeToc.php  images[]=<JPEG base64>（最多 3 張：封面／目錄頁）  [name=<檔名，只當提示>]  [api_key]
// 回傳 {ISSN, 卷, 期, 號, 年, 月, 刊名, model}；印刷上沒有的欄位回空字串。結果只是草稿，由前端填入表單，人工核對後才儲存。
require_once __DIR__ . '/lib.php';
require_post();

$apiKey = trim((string)($_POST['api_key'] ?? ''));
if ($apiKey !== '' && !preg_match('/^[A-Za-z0-9_.\-]{20,200}$/', $apiKey)) out('金鑰格式不正確，請重新貼上。', 400);
if ($apiKey === '') $apiKey = GEMINI_API_KEY;
if ($apiKey === '') out('尚未設定 AI 金鑰：請按左側「AI 設定」輸入您自己的 Gemini API 金鑰。', 401);
if (!function_exists('curl_init')) out('PHP 沒有啟用 curl 擴充', 500);

$imgs = $_POST['images'] ?? [];
if (!is_array($imgs) || !$imgs || count($imgs) > 3) out('請提供 1～3 張影像', 400);
$hint = mb_substr(trim((string)($_POST['name'] ?? '')), 0, 120);

$prompt = "這是一份期刊的封面或目錄頁影像（可能是簡體或繁體中文）。請讀出下列資料，只填影像上實際印出來的內容；看不到就回空字串，不要推測、不要編造。\n"
  . "- ISSN：格式如 1005-1597（只在影像上有印 ISSN 時才填；常見於封面、版權頁或刊名旁）。\n"
  . "- 刊名：期刊名稱（簡體字照原樣，不要轉成繁體）。\n"
  . "- 卷：印有「第N卷」或 Vol. 時的數字，只填阿拉伯數字。\n"
  . "- 期：印有「第N期」時的 N，只填阿拉伯數字。若同時印有「總第M期」，期填 N，不要把 M 填進來。\n"
  . "- 號：只有影像上明確印有「第N號」或 No. N 時才填數字；「總第M期」不是號，留空。\n"
  . "- 年：出版年，西元四位數字。民國年請換算成西元（民國N年 = N+1911）。\n"
  . "- 月：出版月份，只填數字 1～12；若是「4-6月」這類範圍，填「4-6」。\n"
  . ($hint !== '' ? "檔名「{$hint}」可當參考：影像上有印的以影像為準；影像上沒有年或月、而檔名有 YYYYMM（如 202605 = 2026 年 5 月）時，可採用檔名的年月。\n" : '')
  . '以 JSON 回答。';

$parts = [['text' => $prompt]];
foreach ($imgs as $b64) {
  $b64 = (string)$b64;
  if ($b64 === '' || strlen($b64) > 9 * 1024 * 1024 || !preg_match('/^[A-Za-z0-9+\/=\r\n]+$/', $b64)) out('影像資料不正確', 400);
  $parts[] = ['inline_data' => ['mime_type' => 'image/jpeg', 'data' => preg_replace('/\s+/', '', $b64)]];
}

$str = ['type' => 'STRING'];
$schema = ['type' => 'OBJECT', 'properties' => ['ISSN' => $str, '刊名' => $str, '卷' => $str, '期' => $str, '號' => $str, '年' => $str, '月' => $str],
  'required' => ['ISSN', '刊名', '卷', '期', '號', '年', '月']];
$gen = ['responseMimeType' => 'application/json', 'responseSchema' => $schema, 'temperature' => 0.1];

function call_model_toc($model, $body, $key) {
  $ch = curl_init('https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent');
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $key],
    CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 120,
  ] + (is_file(__DIR__ . '/php/cacert.pem') ? [CURLOPT_CAINFO => __DIR__ . '/php/cacert.pem'] : []));
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $err = curl_error($ch);
  curl_close($ch);
  return [$code, $resp === false ? null : json_decode($resp, true), $err];
}

// 依序試每個模型：額度用完(429)或模型不可用(404)換下一個；忙碌(503)等一下重試
$data = null; $used = ''; $quota = 0; $lastErr = '';
foreach (GEMINI_MODELS as $model) {
  for ($try = 0; $try < 3; $try++) {
    list($code, $json, $err) = call_model_toc($model, ['contents' => [['parts' => $parts]], 'generationConfig' => $gen], $apiKey);
    if ($code === 503) { sleep(3 * ($try + 1)); continue; }
    break;
  }
  if ($json === null && $err !== '') { $lastErr = '連線 Gemini 失敗：' . $err; break; }
  if ($code === 200) { $data = $json; $used = $model; break; }
  if ($code === 429) { $quota++; continue; }
  if ($code === 404 || $code === 503) continue;
  $lastErr = 'Gemini 錯誤（' . $model . '）：' . mb_substr($json['error']['message'] ?? ('HTTP ' . $code), 0, 400);
  break;
}
if ($data === null) {
  if ($quota) out('免費額度暫時用完或請求太頻繁（已嘗試 ' . $quota . ' 個模型），請稍後再試。', 429);
  out($lastErr ?: 'Gemini 沒有回應', 502);
}

$text = '';
foreach (($data['candidates'][0]['content']['parts'] ?? []) as $p) if (isset($p['text']) && empty($p['thought'])) $text .= $p['text'];
$r = json_decode($text, true);
if (!is_array($r)) out('Gemini 沒有回傳可讀的結果', 502);

$res = [];
foreach (['ISSN', '刊名', '卷', '期', '號', '年', '月'] as $k) $res[$k] = str_replace(['<', '>'], ['＜', '＞'], trim((string)($r[$k] ?? '')));
if ($res['ISSN'] !== '' && !preg_match('/^\d{4}-\d{3}[\dXx]$/', $res['ISSN'])) $res['ISSN'] = ''; // 格式不對就不填，避免填入錯誤的 ISSN
$res['model'] = $used;
out_json($res);
