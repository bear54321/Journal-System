<?php
// 用刊名到圖書館後台查期刊，取得 ISSN：lookupJournal.php  title=<刊名>  [api_key]
// 回傳 {items:[{journalId, title, issn}], note}。後台刊名是繁體；查不到而且有 AI 金鑰時，會請 AI 把刊名轉成繁體再查一次。
// 只做查詢，不會寫入後台。
require_once __DIR__ . '/lib.php';
require_post();
require_once __DIR__ . '/tocsite.php';

$title = trim((string)($_POST['title'] ?? ''));
if ($title === '' || mb_strlen($title) > 80) out('請先填寫刊名', 400);
if (TOC_SITE_USER === '' || TOC_SITE_PASS === '') out('尚未設定後台帳密（請在 config.local.php 設定 TOC_SITE_USER、TOC_SITE_PASS）', 400);
if (!function_exists('curl_init')) out('伺服器 PHP 未啟用 curl 擴充', 500);

try {
  site_login();
  $title = preg_replace('/[\s《》「」]+/u', '', $title);
  $items = search_journals($title);
  $note = '';
  if (!$items) {
    $trad = to_traditional($title);
    if ($trad !== '' && $trad !== $title) { $items = search_journals($trad); $note = "已把刊名轉成繁體「{$trad}」再查"; }
  }
  out_json(['items' => $items, 'note' => $note]);
} catch (RuntimeException $e) {
  out($e->getMessage(), 502);
}
