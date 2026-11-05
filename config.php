<?php
// 期刊線上編目系統 後端設定
// 資料與影像都放在網站根目錄以外最理想；若不行，請用 .htaccess 擋掉 DATA_DIR

// 篇目、編目、印刷頁碼的存放處（需可寫入）
define('DATA_DIR', __DIR__ . '/data');

// 影像存放處，結構：IMG_DIR/<期刊名>/<影像編號>.jpg
define('IMG_DIR', __DIR__ . '/img');

// 找不到影像時顯示的預設圖（對應前端 img/show.jpg）
define('IMG_PLACEHOLDER', __DIR__ . '/img/show.jpg');

// 每期保留幾份 saveIndex 歷史版本（避免整期覆蓋後無法還原）；0 = 不保留
define('INDEX_HISTORY_KEEP', 20);

// tmpData 大小上限（位元組）
define('INDEX_MAX_BYTES', 2 * 1024 * 1024);

// AI 辨識（Gemini）：金鑰放在 config.local.php，不要寫在這裡
if (is_file(__DIR__ . '/config.local.php')) require_once __DIR__ . '/config.local.php';
if (!defined('GEMINI_API_KEY')) define('GEMINI_API_KEY', '');
if (!defined('GEMINI_MODEL')) define('GEMINI_MODEL', 'gemini-3.5-flash');
// 依序嘗試的模型：免費額度（每個模型各自計算，每天有請求次數上限）用完時改用下一個
if (!defined('GEMINI_MODELS')) define('GEMINI_MODELS', [GEMINI_MODEL, 'gemini-3-flash-preview', 'gemini-3.5-flash-lite']); // lite 最便宜但頁碼常常辨識錯誤，排在最後
// 送出前把影像縮到長邊不超過這個像素（需要 GD 擴充），可加快速度並節省額度
if (!defined('ANALYZE_MAX_EDGE')) define('ANALYZE_MAX_EDGE', 2000);
// 本機 OCR 服務（ocr/server.py）的位址；框選辨識選「本機 OCR」時使用
if (!defined('OCR_LOCAL_URL')) define('OCR_LOCAL_URL', 'http://127.0.0.1:8765');
