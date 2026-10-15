"""Collect the previous session's market indicators for the morning briefing.

Usage: python scripts/fetch_daily.py [--date YYYY-MM-DD] [--force] [OUT.json]

For briefing date D every series uses its last daily close *before* D, taken
from Naver Finance's daily history, so the numbers are right no matter when
this runs (GitHub's scheduler can be hours late). Sector moves have no
history, so they are only included while D's Korean session hasn't started.
An existing file is never overwritten unless --force is given.
"""
import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0"}

DOMESTIC = [("국내", "코스피", "KOSPI"), ("국내", "코스닥", "KOSDAQ")]
WORLD = [("미국", "다우", ".DJI"), ("미국", "S&P 500", ".INX"),
         ("미국", "나스닥", ".IXIC"), ("미국", "필라델피아 반도체", ".SOX")]
MARKET_INDEX = [("환율", "원/달러", "exchange", "FX_USDKRW", "원"),
                ("금리", "미국 국채 10년", "bond", "US10YT=RR", "%"),
                ("금리", "미국 국채 30년", "bond", "US30YT=RR", "%"),
                ("금리", "한국 국채 10년", "bond", "KR10YT=RR", "%"),
                ("유가", "WTI", "energy", "CLcv1", "달러"),
                ("유가", "브렌트유", "energy", "LCOcv1", "달러")]
SECTORS = "https://m.stock.naver.com/api/stocks/industry?page=1&pageSize=100"


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.load(res)


def num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def last_before(rows, date):
    """Most recent daily row whose session date is before the briefing date."""
    for r in rows:
        if r["localTradedAt"][:10] < date:
            return r
    raise ValueError(f"no session before {date}")


def indicator(group, name, row, unit=""):
    return {
        "group": group,
        "name": name,
        "value": num(row.get("closePrice")),
        "diff": num(row.get("compareToPreviousClosePrice", row.get("fluctuations"))),
        "rate": num(row.get("fluctuationsRatio")),
        "unit": unit,
        "date": row["localTradedAt"][:10],
        "asOf": row["localTradedAt"],
    }


def collect(date):
    out, errors = [], []
    kr_latest = None
    for group, name, code in DOMESTIC:
        try:
            rows = get_json(f"https://m.stock.naver.com/api/index/{code}/price?pageSize=10&page=1")
            kr_latest = kr_latest or rows[0]["localTradedAt"][:10]
            out.append(indicator(group, name, last_before(rows, date)))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")
    for group, name, cat, code, unit in MARKET_INDEX:
        try:
            rows = get_json(f"https://m.stock.naver.com/front-api/marketIndex/prices?category={cat}&reutersCode={code}&page=1&pageSize=10")
            item = indicator(group, name, last_before(rows["result"] if isinstance(rows, dict) else rows, date), unit)
            if cat == "bond":
                item["kind"] = "yield"  # 변동폭은 %p
            out.append(item)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")
    for group, name, code in WORLD:
        try:
            rows = get_json(f"https://api.stock.naver.com/index/{code}/price?pageSize=10&page=1")
            out.append(indicator(group, name, last_before(rows, date)))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")

    # 업종 등락은 과거 이력이 없어서, D일 장이 아직 시작되지 않았을 때만 '전날' 값이다
    sectors = None
    if kr_latest and kr_latest < date:
        try:
            groups = [
                {"name": g["name"], "rate": num(g["changeRate"]), "rise": g.get("riseCount"), "fall": g.get("fallCount")}
                for g in get_json(SECTORS)["groups"] if num(g.get("changeRate")) is not None
            ]
            groups.sort(key=lambda g: g["rate"], reverse=True)
            sectors = {"top": groups[:5], "bottom": groups[::-1][:5]}
        except Exception as e:  # noqa: BLE001
            errors.append(f"업종: {e}")
    else:
        errors.append("업종: 당일 장이 이미 시작되어 전날 업종 등락을 구할 수 없음")

    return {
        "date": date,
        "fetchedAt": datetime.now(KST).isoformat(timespec="minutes"),
        "indicators": out,
        "sectors": sectors,
        "errors": errors,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?")
    ap.add_argument("--date", default=datetime.now(KST).strftime("%Y-%m-%d"))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    path = args.out or f"data/daily/{args.date}.json"
    if os.path.exists(path) and not args.force:
        print(f"{path} already exists; skipping (use --force to overwrite)")
        return
    data = collect(args.date)
    if not data["indicators"]:
        print(f"no indicators collected: {data['errors']}", file=sys.stderr)
        sys.exit(1)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"wrote {path}: {len(data['indicators'])} indicators, errors={data['errors']}")


if __name__ == "__main__":
    main()
