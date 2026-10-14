"""Collect the previous session's market indicators for the morning briefing.

Usage: python scripts/fetch_daily.py            -> data/daily/<KST today>.json
       python scripts/fetch_daily.py OUT.json

Numbers come straight from Naver Finance so the briefing's figures are exact;
the news routine only writes the commentary.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0"}

DOMESTIC = [("국내", "코스피", "https://m.stock.naver.com/api/index/KOSPI/basic"),
            ("국내", "코스닥", "https://m.stock.naver.com/api/index/KOSDAQ/basic")]
WORLD = [("미국", "다우", ".DJI"), ("미국", "S&P 500", ".INX"),
         ("미국", "나스닥", ".IXIC"), ("미국", "필라델피아 반도체", ".SOX")]
MARKET_INDEX = [("환율", "원/달러", "exchange", "FX_USDKRW", "원"),
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


def indicator(group, name, d, unit=""):
    return {
        "group": group,
        "name": name,
        "value": num(d.get("closePrice")),
        "diff": num(d.get("compareToPreviousClosePrice", d.get("fluctuations"))),
        "rate": num(d.get("fluctuationsRatio")),
        "unit": unit,
        "asOf": d.get("localTradedAt"),
    }


def collect():
    out, errors = [], []
    for group, name, url in DOMESTIC:
        try:
            out.append(indicator(group, name, get_json(url)))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")
    for group, name, cat, code, unit in MARKET_INDEX:
        try:
            d = get_json(f"https://m.stock.naver.com/front-api/marketIndex/productDetail?category={cat}&reutersCode={code}")["result"]
            out.append(indicator(group, name, d, unit))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")
    for group, name, code in WORLD:
        try:
            out.append(indicator(group, name, get_json(f"https://api.stock.naver.com/index/{code}/basic")))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")

    sectors = {"top": [], "bottom": []}
    try:
        groups = [
            {"name": g["name"], "rate": num(g["changeRate"]), "rise": g.get("riseCount"), "fall": g.get("fallCount")}
            for g in get_json(SECTORS)["groups"] if num(g.get("changeRate")) is not None
        ]
        groups.sort(key=lambda g: g["rate"], reverse=True)
        sectors = {"top": groups[:5], "bottom": groups[::-1][:5]}
    except Exception as e:  # noqa: BLE001
        errors.append(f"업종: {e}")

    now = datetime.now(KST)
    return {
        "date": now.strftime("%Y-%m-%d"),
        "fetchedAt": now.isoformat(timespec="minutes"),
        "indicators": out,
        "sectors": sectors,
        "errors": errors,
    }


def main():
    data = collect()
    path = sys.argv[1] if len(sys.argv) > 1 else f"data/daily/{data['date']}.json"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"wrote {path}: {len(data['indicators'])} indicators, errors={data['errors']}")


if __name__ == "__main__":
    main()
