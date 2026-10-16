"""Collect recent global economic headlines from free RSS feeds.

Usage: python scripts/fetch_world.py [--date YYYY-MM-DD] [--force]
       -> data/world/raw/<date>.json

Each item keeps the headline, the feed's short summary and the opening of the
article text (when the site allows it), trimmed to the last ~30 hours.
Same-event headlines from different outlets are collapsed, articles already
shown in the previous days' briefing are dropped, and the total is capped, so
the routine that translates/summarises them reads a bounded amount of text.
An existing file is never overwritten unless --force is given.
"""
import argparse
import glob
import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"}
WINDOW_HOURS = 30
PER_SOURCE = 15
MAX_ITEMS = 70
SUMMARY_CHARS = 280
BODY_CHARS = 900
NO_BODY = {"MarketWatch", "Financial Times"}  # 본문 접근 차단(401/403)

# (region, source, url)
FEEDS = [
    ("미국", "CNBC", "https://www.cnbc.com/id/20910258/device/rss/rss.html"),          # Economy
    ("미국", "CNBC", "https://www.cnbc.com/id/15839069/device/rss/rss.html"),          # Markets
    ("미국", "MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("미국", "Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("유럽", "BBC", "https://feeds.bbci.co.uk/news/business/rss.xml"),
    ("유럽", "The Guardian", "https://www.theguardian.com/uk/business/rss"),
    ("유럽", "DW", "https://rss.dw.com/rdf/rss-en-bus"),
    ("유럽", "ECB", "https://www.ecb.europa.eu/rss/press.html"),
    ("중국", "SCMP", "https://www.scmp.com/rss/318421/feed"),                          # China economy
    ("아시아", "CNBC", "https://www.cnbc.com/id/100727362/device/rss/rss.html"),       # World / Asia
    ("아시아", "Nikkei Asia", "https://asia.nikkei.com/rss/feed/nar"),
    ("글로벌", "Financial Times", "https://www.ft.com/world?format=rss"),
]

STOP = {"the", "and", "for", "with", "from", "that", "this", "says", "said", "after", "over", "into",
        "amid", "will", "its", "are", "has", "have", "what", "why", "how", "new", "more", "than"}


def text(s):
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s or "", flags=re.S)
    s = re.sub(r"<[^>]+>", " ", html.unescape(s))
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def tag(block, *names):
    for n in names:
        m = re.search(rf"<{n}(?:\s[^>]*)?>(.*?)</{n}>", block, re.S)
        if m:
            return m.group(1)
    m = re.search(r'<link[^>]*href="([^"]+)"', block)  # Atom
    return m.group(1) if m and "link" in names else ""


def when(s):
    s = text(s)
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def norm(t):
    return re.sub(r"[^0-9a-z]", "", t.lower())


def words(t):
    return {w for w in re.findall(r"[a-z0-9$%]+", t.lower()) if len(w) > 2 and w not in STOP}


def same_event(a, b):
    wa, wb = words(a), words(b)
    return bool(wa and wb) and len(wa & wb) / len(wa | wb) >= 0.45


def fetch(region, source, url, since):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as res:
        xml = res.read().decode("utf-8", "replace")
    out = []
    for block in re.findall(r"<item[\s>].*?</item>|<entry[\s>].*?</entry>", xml, re.S):
        title = text(tag(block, "title"))
        link = text(tag(block, "link", "guid"))
        published = when(tag(block, "pubDate", "dc:date", "published", "updated"))
        if not title or not link.startswith("http"):
            continue
        if published and published < since:
            continue
        summary = text(tag(block, "description", "summary", "content:encoded"))
        if len(summary) > SUMMARY_CHARS:
            summary = summary[:SUMMARY_CHARS].rsplit(" ", 1)[0] + "…"
        out.append({
            "region": region,
            "source": source,
            "title": title,
            "summary": summary if norm(summary) != norm(title) else "",
            "url": link,
            "published": published.astimezone(KST).isoformat(timespec="minutes") if published else None,
        })
        if len(out) >= PER_SOURCE:
            break
    return out


def find_body(obj):
    if isinstance(obj, dict):
        b = obj.get("articleBody")
        if isinstance(b, str) and len(b) > 200:
            return b
        obj = list(obj.values())
    if isinstance(obj, list):
        for v in obj:
            b = find_body(v)
            if b:
                return b
    return None


def article_text(url):
    """Opening of the article: JSON-LD articleBody if present, else sentence-like <p> text."""
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as res:
        page = res.read().decode("utf-8", "replace")
    body = None
    for blk in re.findall(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", page, re.S):
        try:
            body = find_body(json.loads(blk))
        except ValueError:
            continue
        if body:
            break
    if body:
        body = text(body)
    else:
        page = re.sub(r"<(script|style|noscript|nav|header|footer|aside)\b[^>]*>.*?</\1>", "", page, flags=re.S)
        paras = [text(p) for p in re.findall(r"<p\b[^>]*>(.*?)</p>", page, re.S)]
        body = " ".join(p for p in paras if len(p) > 80 and re.search(r"[.!?][\"”’)]?$", p))
    if len(body) > BODY_CHARS:
        cut = body[:BODY_CHARS]
        body = cut[: cut.rfind(". ") + 1] or cut
    return body


def shown_before(date, days=3):
    """URLs and English titles already used in the last few days' Korean briefings."""
    first = (datetime.fromisoformat(date) - timedelta(days=days)).strftime("%Y-%m-%d")
    urls, titles = set(), []
    for p in glob.glob("data/world/*.json"):
        d = os.path.basename(p)[:10]
        if not first <= d < date:
            continue
        try:
            for it in json.load(open(p, encoding="utf-8")).get("items", []):
                urls.add(it.get("url"))
                titles.append(it.get("original", ""))
                for a in it.get("also", []):
                    urls.add(a.get("url"))
        except (ValueError, OSError):
            pass
    return urls, titles


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.now(KST).strftime("%Y-%m-%d"))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    path = f"data/world/raw/{args.date}.json"
    if os.path.exists(path) and not args.force:
        print(f"{path} already exists; skipping (use --force to overwrite)")
        return
    since = datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)
    old_urls, old_titles = shown_before(args.date)
    per_feed, errors = [], []
    for region, source, url in FEEDS:
        try:
            per_feed.append(fetch(region, source, url, since))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{source} {url}: {e}")
    # 피드를 번갈아 담아 한 언론사에 쏠리지 않게 하고, 같은 사건·이미 보여준 기사는 뺀다
    items, dropped = [], 0
    for rnd in range(PER_SOURCE):
        for feed in per_feed:
            if rnd >= len(feed) or len(items) >= MAX_ITEMS:
                continue
            it = feed[rnd]
            if it["url"] in old_urls or any(same_event(it["title"], t) for t in old_titles):
                dropped += 1
                continue
            if any(norm(it["title"]) == norm(x["title"]) or same_event(it["title"], x["title"]) for x in items):
                dropped += 1
                continue
            it["id"] = f"w{len(items) + 1}"  # 루틴은 이 id로만 기사를 가리킨다
            items.append(it)
    for it in items:
        if it["source"] in NO_BODY:
            continue
        try:
            it["body"] = article_text(it["url"])
        except Exception as e:  # noqa: BLE001
            errors.append(f"body {it['id']} {it['source']}: {e}")
    if not items:
        print(f"no items collected: {errors}", file=sys.stderr)
        sys.exit(1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"date": args.date, "fetchedAt": datetime.now(KST).isoformat(timespec="minutes"),
                   "items": items, "errors": errors}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with_body = sum(1 for i in items if i.get("body"))
    print(f"wrote {path}: {len(items)} items ({with_body} with body), dropped {dropped} duplicates/repeats, errors={len(errors)}")


if __name__ == "__main__":
    main()
