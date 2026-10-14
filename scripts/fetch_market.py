"""Fetch price and market cap for every KOSPI/KOSDAQ stock from Naver Finance.

Usage: python scripts/fetch_market.py data/market.json

If Naver cannot be reached, falls back to the copy currently deployed on the
site so a failed fetch never breaks the deploy.
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://m.stock.naver.com/api/stocks/marketValue/{market}?page={page}&pageSize=100"
FALLBACK = "https://zzornnum.github.io/data/market.json"
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0"}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.load(res)


def num(v, default=0.0):
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return default


def fetch_market(market):
    rows, page = [], 1
    while True:
        data = get_json(API.format(market=market, page=page))
        for s in data["stocks"]:
            if s.get("stockEndType") != "stock":  # ETF/ETN 제외
                continue
            price, ratio = num(s["closePriceRaw"]), num(s["fluctuationsRatio"])
            cap = num(s["marketValueRaw"])
            # 장전·장후(NXT, 08:00–20:00) 시세가 정규장보다 최신이면 그 가격을 쓴다
            over = s.get("overMarketPriceInfo") or {}
            over_price = num(over.get("overPriceRaw"), 0)
            if over_price and over.get("localTradedAt", "") > s.get("localTradedAt", ""):
                if price:
                    cap = cap * over_price / price
                price, ratio = over_price, num(over.get("fluctuationsRatio"), ratio)
            rows.append({
                "c": s["itemCode"],
                "n": s["stockName"],
                "p": int(price),
                "r": ratio,
                # 시가총액, 억원 단위
                "cap": round(cap / 1e8),
            })
        if page * 100 >= data["totalCount"] or not data["stocks"]:
            break
        page += 1
        time.sleep(0.2)
    rows.sort(key=lambda r: r["cap"], reverse=True)
    return rows


def main(out_path):
    try:
        result = {
            "updatedAt": datetime.now(KST).isoformat(timespec="minutes"),
            "KOSPI": fetch_market("KOSPI"),
            "KOSDAQ": fetch_market("KOSDAQ"),
        }
        print(f"fetched KOSPI={len(result['KOSPI'])} KOSDAQ={len(result['KOSDAQ'])}")
    except Exception as e:  # noqa: BLE001
        print(f"naver fetch failed ({e}); using deployed copy", file=sys.stderr)
        result = get_json(FALLBACK)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1])
