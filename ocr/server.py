# 本機 OCR 服務（RapidOCR + PP-OCR 模型，全部在本機執行，不連網、不耗 API 額度）
#   POST /ocr   body = 圖片位元組（JPEG/PNG）  → {"text": "...", "items": [{"text":..., "score":..., "box":[x,y,w,h]}]}
#   GET  /ping                                 → ok
# 只監聽 127.0.0.1。由 start.bat 啟動，也可雙擊 ocr\啟動OCR.bat。
import json
import os
import sys
import threading
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
PORT = int(os.environ.get("OCR_PORT", sys.argv[1] if len(sys.argv) > 1 else "8765"))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # 內嵌版 Python 預設不會把腳本所在資料夾放進模組搜尋路徑
import analyze_local  # noqa: E402
from rapidocr import RapidOCR  # noqa: E402

ENGINE = RapidOCR()
LOCK = threading.Lock()  # onnxruntime session 一次只處理一張，簡單且穩


def run_engine(img, **kw):
    with LOCK:
        r = ENGINE(img, **kw)
    boxes = getattr(r, 'boxes', None)  # 只做辨識（不偵測）時沒有 boxes
    txts = getattr(r, 'txts', None)
    scores = getattr(r, 'scores', None)
    txts = [] if txts is None else list(txts)
    boxes = [[[0, 0]]] * len(txts) if boxes is None else list(boxes)
    scores = [1.0] * len(txts) if scores is None else list(scores)
    items = []
    for b, t, s in zip(boxes, txts, scores):
        xs = [float(p[0]) for p in b]
        ys = [float(p[1]) for p in b]
        items.append({"text": t, "score": round(float(s), 3), "x": min(xs), "y": min(ys), "w": max(xs) - min(xs), "h": max(ys) - min(ys)})
    return items


def prepare(img):
    """裁得很緊的小圖：補白邊讓偵測抓得到；太小的放大。"""
    h, w = img.shape[:2]
    k = 1.0
    if max(h, w) < 400:
        k = 400.0 / max(h, w)
    if k != 1.0:
        img = cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_CUBIC)
    pad = 24
    img = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    return img


def join_reading_order(items):
    """直排（欄由右到左、字由上到下）或橫排（列由上到下），依多數文字框的形狀判斷。"""
    if not items:
        return ""
    vertical = sum(1 for i in items if i["h"] > i["w"] * 1.2) > len(items) / 2
    if vertical:
        items = sorted(items, key=lambda i: -(i["x"] + i["w"] / 2))
    else:
        items = sorted(items, key=lambda i: (round((i["y"] + i["h"] / 2) / max(8.0, i["h"] * 0.6)), i["x"]))
    return "".join(i["text"] for i in items)


def cells_fallback(img):
    """偵測不到時：細長的直排單欄，切成一格一字再各自辨識。"""
    h, w = img.shape[:2]
    if h > w * 1.4:
        n = max(1, round(h / w))
        out = []
        for k in range(n):
            cell = img[int(k * h / n): int((k + 1) * h / n), :]
            cell = cv2.copyMakeBorder(cell, 12, 12, 12, 12, cv2.BORDER_CONSTANT, value=(255, 255, 255))
            its = run_engine(cell, use_det=False, use_cls=False, use_rec=True)
            out.append("".join(i["text"] for i in its))
        return "".join(out)
    its = run_engine(img, use_det=False, use_cls=False, use_rec=True)
    return "".join(i["text"] for i in its)


def ocr_bytes(data):
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("無法解讀圖片")
    img = prepare(img)
    items = run_engine(img)
    text = join_reading_order(items)
    if not text:
        text = cells_fallback(img)
    return text, items


def analyze_bytes(data, thread):
    """整頁分析：OCR 後用規則推測篇目與頁碼（粗略，結果需人工核對）。"""
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("無法解讀圖片")
    h, w = img.shape[:2]
    k = min(1.0, 3200.0 / max(h, w))
    if k < 1.0:
        img = cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
        h, w = img.shape[:2]
    items = run_engine(img)
    return analyze_local.analyze(items, w, h, thread)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        raw = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.startswith("/ping"):
            return self._send(200, "ok", "text/plain")
        self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        u = urlparse(self.path)
        if u.path not in ("/ocr", "/analyze"):
            return self._send(404, json.dumps({"error": "not found"}))
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 40 * 1024 * 1024:
                raise ValueError("圖片大小不正確")
            data = self.rfile.read(n)
            if u.path == "/analyze":
                thread = parse_qs(u.query).get("thread", ["0"])[0] == "1"
                self._send(200, json.dumps(analyze_bytes(data, thread), ensure_ascii=False))
            else:
                text, items = ocr_bytes(data)
                self._send(200, json.dumps({"text": text, "items": items}, ensure_ascii=False))
        except Exception as e:  # noqa: BLE001
            self._send(500, json.dumps({"error": str(e)}, ensure_ascii=False))

    def log_message(self, *a):  # 安靜
        pass


if __name__ == "__main__":
    ThreadingHTTPServer.allow_reuse_address = False  # Windows 上若允許重複綁定，會同時有兩個服務搶同一個連接埠
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print("本機 OCR 服務已經在執行（連接埠 %d 已被使用），不需要重複啟動。" % PORT, flush=True)
        sys.exit(0)
    print("本機 OCR 服務已啟動：http://127.0.0.1:%d（關閉這個視窗即停止）" % PORT, flush=True)
    srv.serve_forever()
