<?php
// 期刊目次檔案（toc/ 資料夾裡的圖檔與 PDF）
//   uploadToc.php?action=list            → [{name, size, type}]
//   uploadToc.php?action=file&f=<檔名>    → 回傳檔案內容（預覽用）
//   POST action=dryrun, f=<檔名>         → 試送：登入後台、用 ISSN（沒有就用刊名）找期刊、檢查重複，但不儲存
//   POST action=upload, f=<檔名>         → 登入圖書館後台（lib.mh.sinica.edu.tw/libAdmin）並送出「新增目次」表單（JournalItem_save.action）
//   POST action=info|savemeta|attach     → 這個檔案的欄位資料、儲存欄位、加附件
// 後台沒有 API，這裡依瀏覽器送出的表單請求模擬；帳密在 config.local.php（TOC_SITE_USER、TOC_SITE_PASS），只留在伺服器。
require_once __DIR__ . '/lib.php';

$TYPES = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp', 'pdf' => 'application/pdf'];
$dir = __DIR__ . DIRECTORY_SEPARATOR . 'toc';
$logPath = $dir . DIRECTORY_SEPARATOR . '.upload-log.json';

// 只認資料夾裡實際掃到的檔名，使用者輸入不會直接組成路徑
function toc_files($dir, $TYPES) {
  $found = [];
  if (is_dir($dir)) foreach (scandir($dir) as $f) {
    $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
    if ($f[0] !== '.' && is_file($dir . DIRECTORY_SEPARATOR . $f) && isset($TYPES[$ext])) $found[$f] = $TYPES[$ext];
  }
  uksort($found, 'strnatcasecmp');
  return $found;
}

$action = (string)($_REQUEST['action'] ?? 'list');
$files = toc_files($dir, $TYPES);

if ($action === 'list') {
  $list = [];
  foreach ($files as $f => $t) $list[] = ['name' => $f, 'size' => filesize($dir . DIRECTORY_SEPARATOR . $f), 'type' => $t];
  out_json($list);
}

$metaPath = $dir . DIRECTORY_SEPARATOR . '.meta.json';
$who = (string)($_SERVER['REMOTE_USER'] ?? '') ?: 'local';

// 附件：把選的檔案存進 toc/（不覆蓋同名檔）
if ($action === 'attach') {
  require_post();
  $up = $_FILES['file'] ?? null;
  if (!$up || $up['error'] !== UPLOAD_ERR_OK) out('上傳失敗', 400);
  $base = preg_replace('/[\x00-\x1f\\\\\/:*?"<>|]/u', '_', basename((string)$up['name']));
  $ext = strtolower(pathinfo($base, PATHINFO_EXTENSION));
  if ($base === '' || $base[0] === '.' || !isset($TYPES[$ext])) out('只接受 PDF 或圖檔（jpg、png、gif、webp）', 400);
  if ($up['size'] > 100 * 1024 * 1024) out('檔案超過 100 MB', 400);
  ensure_dir($dir);
  $stem = pathinfo($base, PATHINFO_FILENAME); $n = 0; $final = $base;
  while (file_exists($dir . DIRECTORY_SEPARATOR . $final)) $final = $stem . '-' . (++$n) . '.' . $ext;
  if (!move_uploaded_file($up['tmp_name'], $dir . DIRECTORY_SEPARATOR . $final)) out('儲存失敗', 500);
  out_json(['name' => $final]);
}

$name = (string)($_REQUEST['f'] ?? '');
if (!isset($files[$name])) out('not found', 404);
$path = $dir . DIRECTORY_SEPARATOR . $name;

if ($action === 'file') {
  header('Content-Type: ' . $files[$name]);
  header('Content-Length: ' . filesize($path));
  header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode($name));
  header('Cache-Control: private, max-age=300');
  readfile($path);
  exit;
}

$log = read_json_file($logPath, []);
const TOC_META_FIELDS = ['刊名', 'ISSN', '狀態', '卷', '期', '號', '年', '月', '新到狀態'];
$allMeta = read_json_file($metaPath, []);
if ($action === 'status') out_json($log[$name] ?? new stdClass());
if ($action === 'info') out_json(['meta' => $allMeta[$name] ?? new stdClass(), 'upload' => $log[$name] ?? new stdClass()]);
if ($action === 'savemeta') {
  require_post();
  $in = json_decode((string)($_POST['meta'] ?? ''), true);
  if (!is_array($in)) out('bad meta', 400);
  $m = $allMeta[$name] ?? [];
  foreach (TOC_META_FIELDS as $k) if (isset($in[$k]) && is_scalar($in[$k])) $m[$k] = str_replace(['<', '>'], ['＜', '＞'], trim((string)$in[$k]));
  $now = date('Y-m-d H:i:s');
  if (empty($m['建立時間'])) { $m['建立者'] = $who; $m['建立時間'] = $now; }
  else { $m['更新者'] = $who; $m['更新時間'] = $now; }
  // 儲存後把 toc/ 裡的檔名改成「刊名-年月-第O期」（如 齊魯學刊-202605-第3期.pdf）；刊名、年、月、期沒填齊就不改
  $newName = $name; $note = '';
  $jn = preg_replace('/[\s《》「」\\\\\/:*?"<>|]+/u', '', (string)($m['刊名'] ?? ''));
  $yy = (string)($m['年'] ?? ''); $pp = (string)($m['期'] ?? '');
  $okMonth = preg_match('/^(\d{1,2})/', (string)($m['月'] ?? ''), $mm) && (int)$mm[1] >= 1 && (int)$mm[1] <= 12;
  if ($jn !== '' && preg_match('/^\d{4}$/', $yy) && $okMonth && $pp !== '') {
    $cand = sprintf('%s-%s%02d-第%s期.%s', mb_substr($jn, 0, 80), $yy, (int)$mm[1], preg_replace('/[\\\\\/:*?"<>|\s]+/u', '', $pp), strtolower(pathinfo($name, PATHINFO_EXTENSION)));
    if ($cand !== $name) {
      if (strcasecmp($cand, $name) !== 0 && file_exists($dir . DIRECTORY_SEPARATOR . $cand)) $note = '已有同名檔案「' . $cand . '」，這個檔案沒有改名';
      else $newName = $cand;
    }
  } else $note = '刊名、年、月、期填齊後，儲存時會把檔名改成「刊名-年月-第O期」';
  with_lock($dir, function () use ($dir, $metaPath, $logPath, $name, &$newName, &$note, $m) {
    if ($newName !== $name && !@rename($dir . DIRECTORY_SEPARATOR . $name, $dir . DIRECTORY_SEPARATOR . $newName)) { $note = '檔案改名失敗（可能正被其他程式開啟）'; $newName = $name; }
    $a = read_json_file($metaPath, []); unset($a[$name]); $a[$newName] = $m; write_json_file($metaPath, $a);
    if ($newName !== $name) { $l = read_json_file($logPath, []); if (isset($l[$name])) { $l[$newName] = $l[$name]; unset($l[$name]); write_json_file($logPath, $l); } }
  });
  out_json($m + ['_name' => $newName, '_note' => $note]);
}
if ($action !== 'upload' && $action !== 'dryrun') out('bad action', 400);
require_post();
$dry = $action === 'dryrun';

if (TOC_SITE_USER === '' || TOC_SITE_PASS === '') out('尚未設定後台帳密（請在 config.local.php 設定 TOC_SITE_USER、TOC_SITE_PASS）', 400);
if (!function_exists('curl_init')) out('伺服器 PHP 未啟用 curl 擴充', 500);

// 後台請求函式（site_call / site_login / site_rows）放在 tocsite.php，查詢期刊（lookupJournal.php）也共用
require_once __DIR__ . '/tocsite.php';

$m = $allMeta[$name] ?? [];
$v = function ($k) use ($m) { return trim((string)($m[$k] ?? '')); };
$result = null;
try {
  foreach (['期', '年', '月'] as $need) if ($v($need) === '') throw new RuntimeException("請先填寫並儲存「{$need}」");
  if ($v('ISSN') === '' && $v('刊名') === '') throw new RuntimeException('請先填寫「刊名」或「ISSN」（後台靠它找出是哪一本期刊）');
  site_login();

  if ($v('ISSN') !== '') { // 有 ISSN：精確查
    $f = ['rqDTO.theme' => '', 'rqDTO.title' => '', 'rqDTO.houseArea' => '', 'rqDTO.area' => '', 'rqDTO.issn' => $v('ISSN'), 'rqDTO.isuse' => '', 'rqDTO.lang' => '', 'rqDTO.frequency' => '', 'rqDTO.barcodeNo' => ''];
    $rows = site_rows('Journal_data.action', 'journalId', $f);
    $exact = array_values(array_filter($rows, function ($x) use ($v) { return trim((string)($x['issn'] ?? '')) === $v('ISSN'); }));
    $rows = $exact ?: $rows;
    if (count($rows) === 0) throw new RuntimeException('找不到 ISSN ' . $v('ISSN') . ' 的期刊');
    if (count($rows) > 1) throw new RuntimeException('ISSN ' . $v('ISSN') . ' 對應到 ' . count($rows) . ' 本期刊，無法判斷');
  } else { // 沒有 ISSN：用刊名查（後台刊名是繁體；優先取名稱完全相同的）
    $tname = preg_replace('/[\s《》「」]+/u', '', $v('刊名'));
    $rows = search_journals($tname);
    if (!$rows && ($trad = to_traditional($tname)) !== '' && $trad !== $tname) { $tname = $trad; $rows = search_journals($tname); }
    $exact = array_values(array_filter($rows, function ($x) use ($tname) { return $x['title'] === $tname; }));
    $rows = $exact ?: $rows;
    if (count($rows) === 0) throw new RuntimeException('後台找不到刊名「' . $v('刊名') . '」（後台刊名是繁體，也可以改填 ISSN）');
    if (count($rows) > 1) throw new RuntimeException('刊名「' . $v('刊名') . '」對應到 ' . count($rows) . ' 本期刊（' . implode('、', array_map(function ($x) { return $x['title']; }, array_slice($rows, 0, 5))) . '），請改填 ISSN');
    $rows = [['journalId' => $rows[0]['journalId'], 'title' => $rows[0]['title']]];
  }
  $jid = $rows[0]['journalId'];
  $jname = (string)($rows[0]['title'] ?? '');

  $dupId = null;
  $items = site_rows('JournalItem_data.action', 'itemId', ['rqDTO.status' => '', 'rqDTO.volume' => '', 'rqDTO.period' => '', 'rqDTO.year' => $v('年'), 'rqDTO.journalId' => $jid]);
  foreach ($items as $x) if (trim((string)($x['volume'] ?? '')) === $v('卷') && trim((string)($x['period'] ?? '')) === $v('期') && trim((string)($x['year'] ?? '')) === $v('年')) { $dupId = $x['itemId']; break; }
  if ($dupId) throw new RuntimeException("後台已有這一期（itemId {$dupId}），不重複新增");

  $label = ($jname !== '' ? "《{$jname}》" : '') . "journalId {$jid}・" . ($v('卷') !== '' ? '卷' . $v('卷') . ' ' : '') . '期' . $v('期') . '・' . $v('年') . '年' . $v('月') . '月';
  if ($dry) {
    $result = ['time' => date('Y-m-d H:i:s'), 'ok' => true, 'dry' => true, 'message' => '試送通過（未儲存）：將新增到 ' . $label . '，附件 ' . $name];
  } else {
    $data = [
      'rqDTO.status' => $v('狀態'), 'rqDTO.volume' => $v('卷'), 'rqDTO.period' => $v('期'), 'rqDTO.no' => $v('號'),
      'rqDTO.year' => $v('年'), 'rqDTO.month' => $v('月'), 'rqDTO.itemId' => '', 'rqDTO.actionType' => 'add',
      'rqDTO.journalId' => $jid, 'rqDTO.newStatus' => $v('新到狀態') === 'no' ? 'no' : 'yes',
      'files' => new CURLFile($path, $files[$name], $name),
    ];
    [$body, $http] = site_call(TOC_SITE_BASE . 'JournalItem_save.action', $data, true);
    $j = json_decode($body, true);
    $itemId = is_array($j) ? ($j['result']['itemId'] ?? null) : null;
    if ($http !== 200 || !is_array($j) || ($j['code'] ?? 0) !== 200 || !$itemId) throw new RuntimeException('儲存失敗' . (is_array($j) && !empty($j['msg']) ? '：' . $j['msg'] : "（HTTP {$http}）"));
    $result = ['time' => date('Y-m-d H:i:s'), 'ok' => true, 'dry' => false, 'itemId' => $itemId, 'message' => '已新增到 ' . $label . '（itemId ' . $itemId . '）'];
  }
} catch (RuntimeException $e) {
  $result = ['time' => date('Y-m-d H:i:s'), 'ok' => false, 'dry' => $dry, 'message' => $e->getMessage()];
}
with_lock($dir, function () use ($logPath, $name, $result) { $l = read_json_file($logPath, []); $l[$name] = $result; write_json_file($logPath, $l); });
out_json($result);
