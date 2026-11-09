評測腳本：用「標準答案」當考卷，量測編目工作臺的 AI 準不準
==========================================================
用法：node eval/evaluate.js --gold <標準答案.csv> [選項]

選項
  --gold <檔>        標準答案（CSV，UTF-8）。必填
  --base <網址>      編目工作臺的位址，預設 http://localhost:8080（要先用 start.bat 啟動）
  --tag <名稱>       這次評測的名稱，結果存在 eval/out/<名稱>/；預設用檔名（加上模型名）
  --runs <N>         重複跑幾輪，預設 1。建議 2～3 輪，才看得出結果穩不穩定
  --mode <batch|page> batch＝整期批次（正式流程，預設）；page＝單頁
  --group <N>        batch 模式每次送幾張，預設 4（和正式流程一樣）
  --model <模型 ID>  只用這個模型（必須在 config.php 的 GEMINI_MODELS 清單裡）
  --engine <api|local> api＝Gemini（預設）；local＝本機 OCR
  --split <eval|dev|all> 只評哪一集（標準答案有 split 欄位時），預設 all
  --limit <N>        只跑前 N 張（試跑用）
  --dry-run          不呼叫 API，只估算要送幾次請求
  --rescore          不呼叫 API，只用快取重新計分（改了正規化規則之後用）
  --force            忽略快取，重新分析
  --keep-remark      題名比對時保留結尾的括號附註（預設會去掉「(不另行文)」這類）
  --api-key <金鑰>   使用自己的 Gemini 金鑰（也可用環境變數 GEMINI_API_KEY）；不給就用伺服器預設金鑰
  --thread <正規式>  資料夾路徑符合者用線裝書模式，預設 ^線裝書/
  --variants <檔>    異體字對照檔（預設 eval/variants.json，有的話會併入內建對照）

標準答案怎麼準備（CSV，第一列是欄位名稱，一個篇目一列）
  必要欄位   資料夾（例如 公報/貴州省政府公報）、影像（影像編號或檔名）
  選用欄位   題名、作者、作者角色、專欄名稱、是否廣告、印刷頁碼、split（dev 或 eval）、分組（年代等）
  欄位名稱可以用中文或英文（book/image/title/author/role/column/ad/page/split/group）。
  沒有的欄位就不評那一項。同一張影像有多個題名，就寫成多列。
  印刷頁碼寫「2484」或「2484-2485」都可以，評測時會取較小的（和系統的規則相同）；寫「*」＝這張影像不評頁碼。
  請見 eval/sample/gold_sample.csv

流程建議
  1. 欄位盤點：只評「版面上看得到」的欄位。館藏號、主題詞這類編目時推斷的欄位不要放進來。
  2. 抽樣：依刊物、年代分層，抽 100～200 張當評測集（split=eval）；另外抽 20～30 張當開發集（split=dev）
     用來調提示。調提示時只看 dev，不要反覆拿 eval 調整，分數才不會虛高。
  3. 先試跑：  node eval/evaluate.js --gold eval/gold/xxx.csv --dry-run
               node eval/evaluate.js --gold eval/gold/xxx.csv --limit 8
  4. 正式跑：  node eval/evaluate.js --gold eval/gold/xxx.csv --runs 2 --split eval
  5. 看 eval/out/<名稱>/report.md，再抽樣看 mismatches.csv 的錯誤：
     讀錯字／換算錯／抓錯位置／過度修正／標準答案本身有誤（這種要回頭修正編目紀錄）。

結果怎麼看（每個欄位）
  準確率   正規化後相符 ÷ 標準答案有值的頁數
  讀錯     AI 有輸出但不相符
  漏填     標準答案有值，AI 回空白
  編造     標準答案是空的，AI 卻填了東西（頁碼最要緊：這就是憑空編出來的頁碼）
  題名錯字率（CER）＝ 編輯距離 ÷ 標準答案字數，越低越好

注意
  - 評測會真的呼叫 Gemini，消耗免費額度（每個模型每天約 20 次請求）。額度用完會自動中止並存檔，
    之後用同一個指令重跑，會從中斷的地方接續（結果存在 eval/cache/）。
  - eval/gold/、eval/cache/、eval/out/ 放的是機構的編目資料，已加入 .gitignore，請勿上傳到 GitHub。
  - 這個腳本只在本機執行，標準答案不會被送出；只有影像（和系統一般分析時一樣）會送給 Gemini。

自我檢查： node eval/test.js

計分規則版本 2（2026-11-09 起）
  - 異體字「艷／豔」視為同字（其他異體字可在 eval/variants.json 增加）。
  - 題名結尾的日期期間（如「…紀要八月十八日至八月廿四日」），有沒有括號都視為附註，標準答案與 AI 兩邊一起去除（--keep-remark 則保留）。
  - 題名配對不到的篇目，不計入作者、角色、專欄、廣告這幾個欄位（只算在篇目層級的 recall）。
  - 改規則後可用 --rescore 用快取重新計分，不需要重新呼叫 AI。
