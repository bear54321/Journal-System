<?php
// 還原本期到最初狀態（第一次 AI 分析前的樣子）
//   info=1            → {"exists":bool,"created":"…","legacy":bool}
//   POST（無 info）   → 還原：逐頁核對資料、篇目、頁碼回到最初狀態；還原前先把目前狀態備份到 data/<期>/before-restore/<時間>/
require_once __DIR__ . '/lib.php';

$book = get_book();
$dir = book_dir(DATA_DIR, $book);
$ini = initial_dir($book);
$S = DIRECTORY_SEPARATOR;
$info = read_json_file($ini . $S . 'info.json', null);

if (isset($_REQUEST['info'])) {
  out_json($info ? ['exists' => true, 'created' => (string)($info['created'] ?? ''), 'legacy' => !empty($info['legacy'])] : ['exists' => false]);
}
require_post();
if (!$info) out('這一期還沒有「最初狀態」備份：第一次用 AI 分析這一期時才會自動建立。', 404);

$stamp = date('Ymd-His');
with_lock($dir, function () use ($dir, $ini, $S, $stamp) {
  // 先備份目前狀態，按錯了還能找回來（只保留最近 5 份）
  $bk = $dir . $S . 'before-restore' . $S . $stamp;
  ensure_dir($bk);
  foreach (INITIAL_FILES as $f) if (is_file($dir . $S . $f)) copy($dir . $S . $f, $bk . $S . $f);
  $old = glob($dir . $S . 'before-restore' . $S . '*', GLOB_ONLYDIR) ?: [];
  sort($old);
  foreach (array_slice($old, 0, max(0, count($old) - 5)) as $d) {
    foreach (glob($d . $S . '*') ?: [] as $x) @unlink($x);
    @rmdir($d);
  }
  // 還原：最初狀態有這個檔就換回去；沒有（當時還不存在）就刪掉目前的
  foreach (INITIAL_FILES as $f) {
    $src = $ini . $S . $f; $dst = $dir . $S . $f;
    if (is_file($src)) {
      $tmp = $dst . '.' . bin2hex(random_bytes(4)) . '.tmp';
      if (!copy($src, $tmp) || !rename($tmp, $dst)) { @unlink($tmp); out('還原失敗：' . $f, 500); }
    } elseif (is_file($dst)) {
      @unlink($dst);
    }
  }
});
out_json(['ok' => 1, 'backup' => $stamp]);
