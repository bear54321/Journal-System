# 本機整頁分析：只靠 OCR 的文字與位置，用規則推測篇目（不呼叫任何 API）
# 這是「粗略」的做法：能抓到「目錄頁」「第○章／節 標題」「封面大字」「版心頁碼」，
# 抓不到的頁一律回傳空陣列（前端會視為沿用前頁）。結果都應該由人逐頁核對。
import re

CN = "〇零一二兩三四五六七八九十百廿卅"
HEAD = re.compile(r"^第[%s0-9]+[章節編篇卷回部款項]" % CN)
HEAD_SPLIT = re.compile(r"^(第[%s0-9]+[章節編篇卷回部款項])\s*(.*)$" % CN)
TOC_KEY = re.compile(r"(總目|目錄|目次)")
CJK = re.compile(r"[㐀-䶿一-鿿豈-﫿]")


def _is_text(t):
    """是不是「真的文字」：古籍的句讀圈點（。）常被 OCR 讀成 OOCC、000、DOOODOO 這類字母數字，沒有漢字就不當作文字。"""
    t = t.replace(" ", "")
    if not t:
        return False
    n = len(CJK.findall(t))
    return n >= 1 and n / len(t) >= 0.5


NOISE = re.compile(r"^[0OoＯ○〇△▽▲AΔ\-—_\s]{1,8}$")
NUM_CN = re.compile(r"^[%s]{1,4}$" % CN)
ROLE = re.compile(r"^(.{2,10}?)(著|撰|譯|述|編|輯|纂|撰述|編譯|口述|筆述)$")
CN_DIGIT = {"〇": 0, "零": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _to_arabic(s):
    s = s.strip()
    if re.fullmatch(r"\d{1,4}", s):
        return str(int(s))
    if not NUM_CN.match(s):
        return ""
    if "廿" in s or "卅" in s:
        base = 20 if "廿" in s else 30
        rest = s.replace("廿", "").replace("卅", "")
        return str(base + (CN_DIGIT.get(rest, 0) if rest else 0))
    if "百" in s:
        a, _, b = s.partition("百")
        n = (CN_DIGIT.get(a, 1) if a else 1) * 100
        if b:
            if "十" in b:
                x, _, y = b.partition("十")
                n += (CN_DIGIT.get(x, 1) if x else 1) * 10 + (CN_DIGIT.get(y, 0) if y else 0)
            else:
                n += sum(CN_DIGIT.get(c, 0) for c in b) if len(b) == 1 else int("".join(str(CN_DIGIT.get(c, 0)) for c in b))
        return str(n)
    if "十" in s:
        a, _, b = s.partition("十")
        return str((CN_DIGIT.get(a, 1) if a else 1) * 10 + (CN_DIGIT.get(b, 0) if b else 0))
    if len(s) == 1:
        return str(CN_DIGIT.get(s, 0)) if CN_DIGIT.get(s, 0) else ""
    try:
        return str(int("".join(str(CN_DIGIT[c]) for c in s)))
    except KeyError:
        return ""


def _fix_head(t):
    m = HEAD_SPLIT.match(t)
    return (m.group(1) + (" " + m.group(2) if m.group(2) else "")) if m else t


def _fix_with_refs(title, refs):
    """用同一頁版心的書名／篇名校正標題裡讀錯的一個字（例如標題讀成「…而德斯鳩…」，版心是「孟德斯鳩學說」→ 改成「孟德斯鳩」）。
    只在「長度 4 以上的片段只差 1 個字」時才改，避免亂改。"""
    best = title
    for ref in refs:
        n = len(ref)
        for L in range(min(n, 6), 3, -1):
            for a in range(0, n - L + 1):
                sub = ref[a:a + L]
                for b in range(0, len(best) - L + 1):
                    seg = best[b:b + L]
                    if sum(1 for x, y in zip(sub, seg) if x != y) == 1:
                        return best[:b] + sub + best[b + L:]  # 只校正一處，避免連鎖亂改
    return best


def analyze(items, W, H, thread=False, first=False):
    res = _analyze_raw(items, W, H, thread, first)
    if thread and W > H * 1.1 and res.get("articles"):
        refs = [i["text"].replace(" ", "") for i in items
                if abs(i["x"] + i["w"] / 2 - W / 2) < 0.025 * W and _is_text(i["text"]) and i["h"] > i["w"] * 2 and i["h"] < 0.4 * H and i["score"] >= 0.6]
        if refs:
            for art in res["articles"]:
                art["raw"] = art["title"]  # 校正前的原始結果（當作候選之一）
                art["title"] = _fix_with_refs(art["title"], refs)
    return res


def _analyze_raw(items, W, H, thread=False, first=False):
    items = [i for i in items if i["score"] >= 0.5 and i["text"].strip()]
    if not items:
        return {"articles": [], "printed_page": ""}
    vertical = sum(1 for i in items if i["h"] > i["w"] * 1.2) > len(items) / 2

    def geom(i):  # 沿著文字行的起點 / 長度 / 粗細 / 閱讀順序的跨行位置
        if vertical:
            return i["y"], i["h"], i["w"], -(i["x"] + i["w"] / 2)
        return i["x"], i["w"], i["h"], i["y"] + i["h"] / 2

    # 版心（線裝書左右攤開的跨頁中央）：不當作內文，另外找頁碼
    band, main = [], []
    spread = W > H * 1.1
    for i in items:
        cx = i["x"] + i["w"] / 2
        (band if (thread and spread and abs(cx - W / 2) < 0.05 * W) else main).append(i)

    printed = ""
    if thread and band:
        cand = sorted(band, key=lambda i: i["y"] if vertical else i["x"])
        nums = [(_to_arabic(i["text"].replace(" ", "")), i) for i in cand]
        nums = [(n, i) for n, i in nums if n and 1 <= int(n) <= 999]
        if nums:
            printed = nums[-1][0]  # 版心上最下面（最靠近魚尾以下）的數字

    clean = [i for i in main if not NOISE.match(i["text"].strip()) and _is_text(i["text"])]
    if not clean:
        return {"articles": [], "printed_page": printed}
    gs = {id(i): geom(i) for i in clean}
    max_len = max(gs[id(i)][1] for i in clean)
    long_items = [i for i in clean if gs[id(i)][1] >= 0.6 * max_len]
    body_top = sorted(gs[id(i)][0] for i in long_items)[len(long_items) // 2] if long_items else min(gs[id(i)][0] for i in clean)
    ts = sorted(gs[id(i)][2] for i in clean)
    med_t = ts[len(ts) // 2]
    texts = [i["text"].replace(" ", "") for i in clean]

    # 1) 目錄頁
    toc_title = ""
    for i, t in zip(clean, texts):
        if len(t) <= 14 and TOC_KEY.search(t) and re.search(r"(總目|目錄|目次)$", t):
            toc_title = t
            break
    if not toc_title and any(t in ("目錄", "目次", "目 錄") for t in texts):
        toc_title = "目錄"
    if not toc_title and thread and any(re.fullmatch(r"目[錄次]", i["text"].replace(" ", "")) for i in band):
        toc_title = "目錄"
    if toc_title:
        return {"articles": [{"title": toc_title, "column_name": "目錄", "author": "", "author_role": "", "is_ad": False}], "printed_page": printed}

    # 1.5) 整本資料的第一頁：先看是不是封面——整頁最大的字（例如書名）明顯比其他字大，就當封面，優先於「縮排短行」之類的規則
    #     （封面上常有「四十四年第四號」這類小字，不能把它當成題名）
    if first:
        big0 = max(clean, key=lambda i: gs[id(i)][2])
        t0 = big0["text"].replace(" ", "")
        if gs[id(big0)][2] >= 1.8 * med_t and 2 <= len(t0) <= 24:
            return {"articles": [{"title": t0 + "-封面", "column_name": "", "author": "", "author_role": "", "is_ad": False}], "printed_page": printed}

    # 2) 「第○章／節」標題，以及縮排的短行（可能是小標）
    heads = []
    for i, t in zip(clean, texts):
        a, ln, th, _ = gs[id(i)]
        if HEAD.match(t) and ln <= 0.75 * max_len and len(t) <= 40:
            heads.append(i)
        elif (2 <= len(t) <= 20 and ln <= 0.5 * max_len and 0.8 * med_t <= a - body_top <= 0.25 * max_len
              and th <= 1.6 * med_t and i["score"] >= 0.8 and not re.search(r"[。，、；：]$", t)):
            heads.append(i)
    heads.sort(key=lambda i: gs[id(i)][3])
    if heads:
        arts = []
        for i in heads:
            t = i["text"].replace(" ", "")
            m = ROLE.match(t)
            if m and not HEAD.match(t):  # 「某某著」不是標題，是作者
                continue
            arts.append({"title": _fix_head(t), "column_name": "", "author": "", "author_role": "", "is_ad": False})
        # 作者：標題之外、短行且以「著／撰／譯」結尾
        author, role = "", ""
        for i, t in zip(clean, texts):
            m = ROLE.match(t)
            if m and gs[id(i)][1] <= 0.4 * max_len:
                author, role = m.group(1), m.group(2)[0]
                break
        if arts and author:
            arts[0]["author"], arts[0]["author_role"] = author, role
        seen, uniq = set(), []
        for x in arts:
            if x["title"] not in seen:
                seen.add(x["title"]); uniq.append(x)
        arts = uniq
        if arts:
            return {"articles": arts[:6], "printed_page": printed}

    # 3) 封面／書名頁：整頁最大的字
    big = max(clean, key=lambda i: gs[id(i)][2])
    if gs[id(big)][2] >= 1.8 * med_t and 2 <= len(big["text"]) <= 20:
        return {"articles": [{"title": big["text"].replace(" ", "") + ("-封面" if first else ""), "column_name": "", "author": "", "author_role": "", "is_ad": False}], "printed_page": printed}

    return {"articles": [], "printed_page": printed}


def toc(items, W, H, thread=False):
    """目錄頁 → entries：[{title, page, level}]。規則：依閱讀順序逐行；行尾的數字（含「……」「　」分隔）視為頁碼；縮排較深的行視為第二層。"""
    items = [i for i in items if i["score"] >= 0.5 and i["text"].strip() and not NOISE.match(i["text"].strip()) and _is_text(i["text"])]
    if not items:
        return {"entries": []}
    vertical = sum(1 for i in items if i["h"] > i["w"] * 1.2) > len(items) / 2
    spread = W > H * 1.1
    if thread and spread:  # 版心不是目錄內容
        items = [i for i in items if abs(i["x"] + i["w"] / 2 - W / 2) >= 0.05 * W]
    if vertical:
        items.sort(key=lambda i: (-(i["x"] + i["w"] / 2)))
        along = lambda i: i["y"]; thick = lambda i: i["w"]
    else:
        items.sort(key=lambda i: (round((i["y"] + i["h"] / 2) / max(8.0, i["h"] * 0.6)), i["x"]))
        along = lambda i: i["x"]; thick = lambda i: i["h"]
    base = sorted(along(i) for i in items)[len(items) // 4]  # 以第 25 百分位當基準，避免頁首零星小字把整頁都判成縮排
    med_t = sorted(thick(i) for i in items)[len(items) // 2]
    lead = r"[\s.．。·‧…‥・\-_—~～]"
    pat_ar = re.compile(r"^(.{2,}?)%s*?(\d{1,4})$" % lead)
    pat_cn = re.compile(r"^(.{2,}?)%s+([%s]{1,4})$" % (lead, CN))
    out = []
    for i in items:
        t = i["text"].replace(" ", "").strip()
        if len(t) < 2 or re.fullmatch(r"[0-9〇一二三四五六七八九十]+", t) or (len(t) <= 14 and re.search(r"(總目|目錄|目次)$", t)):
            continue
        page = ""
        m = pat_cn.match(t)
        if m:
            t, page = m.group(1), _to_arabic(m.group(2))
        else:
            m = pat_ar.match(t)
            if m and re.search(r"[.．。·‧…‥・\s]\d", i["text"]) or (m and not HEAD.match(t) and len(m.group(2)) >= 1 and re.search(r"[^\d第]\d{1,4}$", t)):
                t, page = m.group(1).rstrip(".．。·‧…‥・ -_—~～"), str(int(m.group(2)))
        level = 1 if (along(i) - base) > 1.2 * max(1.0, med_t) else 0
        out.append({"title": _fix_head(t), "page": page, "level": level})
    return {"entries": out[:200]}


def leaf_number(img, items, run_rec):
    """線裝書的葉次：印在書葉中央版心、下魚尾的上方，是很小的一個字（一、二、三…）。
    一般 OCR 的文字偵測常漏掉它，所以從版心那一欄直接找：先找最下面的黑口，往上找魚尾，緊貼魚尾上方的小字就是葉次。
    一～三用橫畫數量判斷；其他數字裁出該字再單獨辨識。找不到就回傳空字串。"""
    import cv2
    import numpy as np
    h, w = img.shape[:2]
    if w < h * 1.1:
        return ""
    band = [i for i in items if abs(i["x"] + i["w"] / 2 - w / 2) < 0.025 * w and _is_text(i["text"]) and i["h"] > i["w"] * 2 and i["h"] < 0.4 * h and i["score"] >= 0.5]
    if band:
        t = max(band, key=lambda i: i["h"])
        cx = int(t["x"] + t["w"] / 2)
        half = int(max(70, t["w"] * 1.0))
    else:
        cx, half = w // 2, 80
    x0, x1 = max(0, cx - half), min(w, cx + half)
    gray = cv2.cvtColor(img[:, x0:x1], cv2.COLOR_BGR2GRAY)
    ratio = (gray < 140).mean(axis=1)
    ratio = np.convolve(ratio, np.ones(9) / 9, mode="same")  # 黑口是網點狀的，逐列比例會忽高忽低，先平滑
    rows = ratio > 0.22
    runs, i = [], 0
    while i < h:
        if rows[i]:
            j = i
            while j < h and rows[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    blocks = [r for r in runs if r[1] - r[0] >= 60 and r[0] > h * 0.5]
    if not blocks:
        return ""
    yb = blocks[-1][0]
    # 黑口上方緊貼著的是魚尾（較短的一段黑色），葉次就在魚尾的正上方
    prev = [r for r in runs if r[1] <= yb and yb - r[1] <= 45 and r[1] - r[0] >= 20]
    fish_top = prev[-1][0] if prev else yb
    yt = max(0, fish_top - 170)
    win = gray[yt:fish_top - 3, :]
    bin_ = (win < 140).astype("uint8") * 255
    n, lab, st, cen = cv2.connectedComponentsWithStats(bin_, 8)
    comps = [(int(st[k][0]), int(st[k][1]), int(st[k][2]), int(st[k][3]), int(st[k][4])) for k in range(1, n)]
    # 只看版心這一欄正中央（左右兩邊是內文與欄線，會混進雜訊）
    lo, hi = max(0, cx - x0 - 27), min(bin_.shape[1], cx - x0 + 27)
    central = np.zeros_like(bin_)
    central[:, lo:hi] = 255
    ink = cv2.bitwise_and(bin_, central)
    # 一、二、三是橫畫：用橫向開運算只留下夠長的橫線（魚尾上方斜的裝飾線會被濾掉）
    bars = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1)))
    nb, _, sb, _ = cv2.connectedComponentsWithStats(bars, 8)
    bl = sorted([(int(sb[k][1]), int(sb[k][3]), int(sb[k][0]), int(sb[k][2]), int(sb[k][4])) for k in range(1, nb) if sb[k][2] >= 16 and sb[k][3] <= 14], key=lambda t: t[0])
    if not bl:
        return ""
    ty0, ty1 = bl[0][0] - 4, max(b[0] + b[1] for b in bl) + 4
    bar_area = sum(b[4] for b in bl)
    ink_area = int((ink[max(0, ty0):ty1] > 0).sum())
    gaps_ok = all(bl[k + 1][0] - (bl[k][0] + bl[k][1]) >= 5 for k in range(len(bl) - 1))
    if 1 <= len(bl) <= 3 and gaps_ok and ink_area <= 1.45 * bar_area:
        return str(len(bl))
    # 其他數字：把這一小塊裁出來單獨辨識
    xs = [b[2] for b in bl] + [b[2] + b[3] for b in bl]
    gx0, gx1 = min(xs), max(xs)
    rows_ink = np.where(ink[max(0, ty0 - 12):ty1 + 12].sum(axis=1) > 0)[0]
    gy0 = max(0, ty0 - 12) + (int(rows_ink.min()) if len(rows_ink) else 0)
    gy1 = max(0, ty0 - 12) + (int(rows_ink.max()) + 1 if len(rows_ink) else ty1 - ty0)
    m = 8
    crop = img[yt + max(0, gy0 - m): yt + gy1 + m, x0 + max(0, gx0 - m): x0 + gx1 + m]
    if crop.size == 0:
        return ""
    crop = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    crop = cv2.copyMakeBorder(crop, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    txt = "".join(run_rec(crop)).replace(" ", "")
    return _to_arabic(txt)
