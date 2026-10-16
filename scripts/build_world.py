"""Merge the routine's Korean picks with the raw feed data.

Usage: python scripts/build_world.py YYYY-MM-DD

The routine writes data/world/<date>.json as {"items": [{"id", "title",
"summary", "region"?}, ...]} — only what needs judgement and translation
(region only when the article is about another region than its feed). Everything
that must be copied exactly (link, source, region, time, English title) is
filled in here from data/world/raw/<date>.json, so a small model can't attach
one article's summary to another article's link. Exits non-zero on unknown or
duplicate ids, or missing Korean text.
"""
import json
import sys
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
REGIONS = ["미국", "유럽", "중국", "아시아", "글로벌"]


def main(date):
    raw = {i["id"]: i for i in json.load(open(f"data/world/raw/{date}.json", encoding="utf-8"))["items"]}
    path = f"data/world/{date}.json"
    picks = json.load(open(path, encoding="utf-8"))["items"]
    out, seen, problems = [], set(), []
    for p in picks:
        r = raw.get(p.get("id"))
        if not r:
            problems.append(f"unknown id {p.get('id')!r}")
            continue
        if r["id"] in seen:
            problems.append(f"duplicate id {r['id']}")
            continue
        if not p.get("title") or not p.get("summary"):
            problems.append(f"{r['id']}: missing title or summary")
            continue
        region = p.get("region") or r["region"]
        if region not in REGIONS:
            problems.append(f"{r['id']}: region must be one of {REGIONS}")
            continue
        # 같은 사건을 다룬 다른 언론사 기사 ('관련 기사'로 표시)
        also = []
        for aid in p.get("also", []):
            a = raw.get(aid)
            if not a or aid == r["id"]:
                problems.append(f"{r['id']}: bad also id {aid!r}")
            else:
                also.append({"source": a["source"], "url": a["url"], "original": a["title"]})
        seen.add(r["id"])
        seen.update(p.get("also", []))
        out.append({
            "id": r["id"],
            "region": region,
            "title": p["title"].strip(),
            "summary": p["summary"].strip(),
            "original": r["title"],
            "source": r["source"],
            "url": r["url"],
            "published": r["published"],
            **({"also": also} if also else {}),
        })
    if problems:
        print("problems:", *problems, sep="\n  ", file=sys.stderr)
        sys.exit(1)
    out.sort(key=lambda x: (REGIONS.index(x["region"]) if x["region"] in REGIONS else 99, x["published"] or ""))
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"date": date, "generatedAt": datetime.now(KST).isoformat(timespec="minutes"), "items": out},
                  f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"wrote {path}: {len(out)} items")


if __name__ == "__main__":
    main(sys.argv[1])
