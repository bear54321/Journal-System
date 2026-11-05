# 本機整頁分析：只靠 OCR 的文字與位置，用規則推測篇目（不呼叫任何 API）
# 這是「粗略」的做法：能抓到「目錄頁」「第○章／節 標題」「封面大字」「版心頁碼」，
# 抓不到的頁一律回傳空陣列（前端會視為沿用前頁）。結果都應該由人逐頁核對。
import re

CN = "〇零一二兩三四五六七八九十百廿卅"
HEAD = re.compile(r"^第[%s0-9]+[章節編篇卷回部款項]" % CN)
HEAD_SPLIT = re.compile(r"^(第[%s0-9]+[章節編篇卷回部款項])\s*(.*)$" % CN)
TOC_KEY = re.compile(r"(總目|目錄|目次)")
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


def analyze(items, W, H, thread=False):
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

    clean = [i for i in main if not NOISE.match(i["text"].strip())]
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
        return {"articles": [{"title": big["text"].replace(" ", ""), "column_name": "", "author": "", "author_role": "", "is_ad": False}], "printed_page": printed}

    return {"articles": [], "printed_page": printed}
