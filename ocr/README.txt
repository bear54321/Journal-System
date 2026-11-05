本機 OCR（框選圖片文字用，不連網、不耗 API 額度）
====================================================
- 引擎：RapidOCR（onnxruntime）＋ PP-OCR 模型，隨附可攜式 Python，放在 ocr/python/。
- 啟動：start.bat 會自動一併啟動（視窗標題 Local OCR，最小化）；也可雙擊 ocr/start-ocr.bat。
- 停止：stop.bat，或關閉 Local OCR 視窗。
- 換電腦：整個資料夾（含 ocr/python）複製過去，雙擊 start.bat 即可，不需要另外安裝 Python。
- 如果複製時沒有帶 ocr/python（例如從 git 取得）：雙擊 ocr/install-ocr.bat，會下載約 400 MB。
- 服務只聽 127.0.0.1:8765，不對外開放。
- 欄位旁的彩色「AI」按鈕（框選圖片文字）一律只用本機 OCR，不呼叫任何 API；服務沒啟動時會顯示提示，不會改用 Gemini。
