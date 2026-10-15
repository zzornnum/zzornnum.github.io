"""Fill in direct article links for briefing headlines that have no URL.

Usage: python scripts/resolve_news_urls.py [data/news/2026-10-15.json ...]
       (no args: the 3 most recent briefings)

The briefing's headlines come from a news feed that has titles but no links.
Each headline is matched by title, first against Naver's per-stock news list
(direct n.news.naver.com link), then against a Google News search for the
exact title. Only near-identical titles are accepted. Headlines that still
don't match get "urlChecked" so later runs don't search them again; the site
then links them to the stock's Naver news list.
"""
import difflib
import glob
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0"}
NEWS = "https://m.stock.naver.com/api/news/stock/{code}?pageSize=20&page={page}"
PAGES = 5


def norm(title):
    # 따옴표·말줄임표·괄호 등 표기 차이를 없애고 글자와 숫자만 비교
    return re.sub(r"[^0-9a-z가-힣]", "", html.unescape(title).lower())


def naver_articles(code, cache={}):
    if code not in cache:
        found = []
        for page in range(1, PAGES + 1):
            try:
                req = urllib.request.Request(NEWS.format(code=code, page=page), headers=UA)
                with urllib.request.urlopen(req, timeout=20) as res:
                    clusters = json.load(res)
            except Exception as e:  # noqa: BLE001
                print(f"  {code} page {page}: {e}", file=sys.stderr)
                break
            if not clusters:
                break
            for c in clusters:
                for a in c.get("items", []):
                    found.append({
                        "key": norm(a.get("titleFull") or a["title"]),
                        "url": a.get("mobileNewsUrl") or f"https://n.news.naver.com/mnews/article/{a['officeId']}/{a['articleId']}",
                        "source": a.get("officeName"),
                    })
            time.sleep(0.2)
        cache[code] = found
    return cache[code]


def google_news(title):
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": title, "hl": "ko", "gl": "KR", "ceid": "KR:ko"})
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=20) as res:
            xml = res.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print(f"  google news: {e}", file=sys.stderr)
        return []
    time.sleep(0.5)
    found = []
    for t, link, src in re.findall(r"<item><title>(.*?)</title><link>(.*?)</link>.*?<source[^>]*>(.*?)</source>", xml, re.S)[:5]:
        t, src = html.unescape(t), html.unescape(src)
        if t.endswith(f" - {src}"):
            t = t[: -len(src) - 3]
        found.append({"key": norm(t), "url": link, "source": src})
    return found


def match(title, articles):
    key = norm(title)
    if not key:
        return None
    best, score = None, 0.0
    for a in articles:
        if a["key"] == key:
            return a
        if len(key) >= 12 and (key in a["key"] or a["key"] in key):
            s = 0.95
        else:
            s = difflib.SequenceMatcher(None, key, a["key"]).ratio()
        if s > score:
            best, score = a, s
    return best if score >= 0.85 else None


def resolve(path):
    with open(path, encoding="utf-8") as f:
        day = json.load(f)
    linked = missing = 0
    changed = False
    for item in day.get("items", []):
        for h in item.get("headlines", []):
            if h.get("url") or h.get("urlChecked"):
                continue
            a = match(h.get("title", ""), naver_articles(item["code"])) or match(h.get("title", ""), google_news(h.get("title", "")))
            changed = True
            if a:
                h["url"] = a["url"]
                if a["source"]:
                    h["source"] = a["source"]  # 링크가 실제로 여는 언론사
                linked += 1
            else:
                h["urlChecked"] = True
                missing += 1
    if changed:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(day, f, ensure_ascii=False, indent=2)
            f.write("\n")
    print(f"{path}: linked {linked}, unmatched {missing}")
    return linked


def main():
    paths = sys.argv[1:] or sorted(p for p in glob.glob("data/news/*.json") if not p.endswith("index.json"))[-3:]
    for p in paths:
        resolve(p)


if __name__ == "__main__":
    main()
