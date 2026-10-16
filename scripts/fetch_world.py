"""Collect recent global economic headlines from free RSS feeds.

Usage: python scripts/fetch_world.py [--date YYYY-MM-DD] [--force]
       -> data/world/raw/<date>.json

Only headline + the feed's own short summary are kept (no article bodies),
trimmed to the last ~30 hours, de-duplicated and capped per source, so the
routine that translates/summarises them reads as few tokens as possible.
An existing file is never overwritten unless --force is given.
"""
import argparse
import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"}
WINDOW_HOURS = 30
PER_SOURCE = 12
SUMMARY_CHARS = 280

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
    items, errors, seen = [], [], set()
    for region, source, url in FEEDS:
        try:
            for it in fetch(region, source, url, since):
                k = norm(it["title"])
                if k in seen:
                    continue
                seen.add(k)
                items.append(it)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{source} {url}: {e}")
    if not items:
        print(f"no items collected: {errors}", file=sys.stderr)
        sys.exit(1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"date": args.date, "fetchedAt": datetime.now(KST).isoformat(timespec="minutes"),
                   "items": items, "errors": errors}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {path}: {len(items)} items, errors={errors}")


if __name__ == "__main__":
    main()
