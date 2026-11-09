<?php
// 把影像的上方、下方（預設各 20%）用「原解析度」裁出來，OCR 頁碼試驗用。
// 用法： php crop-strips.php <標準答案.csv> <輸出資料夾> [--full] [--pct=20]
//   輸出：<id>_top.jpg、<id>_bottom.jpg；加 --full 另外輸出整頁縮到長邊 3200 的 <id>_full.jpg
ini_set('memory_limit', '2000M');
[$_, $csv, $out] = $argv;
$full = in_array('--full', $argv, true); $margins = in_array('--margins', $argv, true);
$pct = 20; foreach ($argv as $a) if (strpos($a, '--pct=') === 0) $pct = (int)substr($a, 6);
if (!is_dir($out)) mkdir($out, 0777, true);
$fh = fopen($csv, 'r'); $head = fgetcsv($fh, 0, ',', '"', ''); $head[0] = ltrim($head[0], "\xEF\xBB\xBF");
$n = 0; $skipped = 0;
while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) {
  $row = array_combine($head, $r); $id = $row['id']; $src = $row['檔案路徑'];
  $need = ["$out/{$id}_top.jpg", "$out/{$id}_bottom.jpg"]; if ($full) $need[] = "$out/{$id}_full.jpg";
  if ($margins) array_push($need, "$out/{$id}_left.jpg", "$out/{$id}_right.jpg", "$out/{$id}_bcenter.jpg");
  if (count(array_filter($need, 'is_file')) === count($need)) { $skipped++; continue; }
  $im = @imagecreatefromjpeg($src); if (!$im) { fwrite(STDERR, "讀不到：$src\n"); continue; }
  $w = imagesx($im); $h = imagesy($im); $sh = max(1, (int)round($h * $pct / 100));
  $top = imagecrop($im, ['x' => 0, 'y' => 0, 'width' => $w, 'height' => $sh]); imagejpeg($top, "$out/{$id}_top.jpg", 92);
  $bot = imagecrop($im, ['x' => 0, 'y' => $h - $sh, 'width' => $w, 'height' => $sh]); imagejpeg($bot, "$out/{$id}_bottom.jpg", 92);
  if ($margins) { // 左右外緣（寬 15%、整個高度）與下方中央（下方 20% 的中間 40%）
    $mw = max(1, (int)round($w * 0.15));
    imagejpeg(imagecrop($im, ['x' => 0, 'y' => 0, 'width' => $mw, 'height' => $h]), "$out/{$id}_left.jpg", 92);
    imagejpeg(imagecrop($im, ['x' => $w - $mw, 'y' => 0, 'width' => $mw, 'height' => $h]), "$out/{$id}_right.jpg", 92);
    imagejpeg(imagecrop($im, ['x' => (int)round($w * 0.30), 'y' => $h - $sh, 'width' => (int)round($w * 0.40), 'height' => $sh]), "$out/{$id}_bcenter.jpg", 92);
  }
  if ($full) { $k = min(1, 3200 / max($w, $h)); $f = $k < 1 ? imagescale($im, (int)($w * $k), (int)($h * $k)) : $im; imagejpeg($f, "$out/{$id}_full.jpg", 90); }
  $n++;
}
echo "裁切 $n 張（已存在略過 $skipped 張）\n";
