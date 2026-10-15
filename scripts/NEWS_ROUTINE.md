# 일일 뉴스 브리핑 작성 지침

이 문서는 매일 아침 실행되는 Claude 예약 작업(클라우드 루틴)의 지침입니다.

## 할 일

1. `data/portfolio.json`을 읽어 `holdings`(보유종목)와 `watchlist`(관심종목)의 종목명·코드를 확인한다. 둘 다 비어 있으면 아무것도 커밋하지 않고 종료한다.
2. 오늘 날짜(KST, `TZ=Asia/Seoul date +%F`)를 구한다. `data/news/<오늘>.json`이 이미 있으면 종료한다.
3. 종목마다 최근 48시간(주말·휴일 직후면 직전 거래일 이후)의 뉴스와 공시를 모은다. 출처 우선순위:
   1. **play_mcp `koreaStock-market_get_news`** (`stock_code`=종목코드, `limit` 10~20) — 종목별 최신 헤드라인. 주 출처로 쓴다. `date`/`time` 필드로 기간을 거른다.
   2. **play_mcp `koreaStock-dart_search_filings`** — 최근 공시(실적, 배당, 자사주, 유상증자, 지분변동 등). 공시는 `source`를 "DART 공시"로 쓴다.
   3. 내용 파악이 더 필요하면 WebSearch(`mode: "extended"`)로 같은 제목을 검색해 원문 URL과 본문을 확인한다.
   - 도구는 `ToolSearch`로 `select:mcp__play_mcp__koreaStock-market_get_news,mcp__play_mcp__koreaStock-dart_search_filings`를 먼저 불러온다(이름 접두사가 다르면 `koreaStock` 키워드로 검색).
   - 실제로 존재하는 기사·공시만 사용하고, 제목은 출처 그대로 옮긴다. 지어내지 않는다.
   - URL을 확인하지 못한 헤드라인은 `url`을 생략한다(사이트가 네이버 금융 종목 뉴스로 연결한다). URL을 추측해서 만들지 않는다.
   - 단순 시황·수급 기사("외국인 순매수 상위" 등)보다 실적·사업·지배구조·주주환원·업황 기사를 우선한다.
   - 의미 있는 새 뉴스가 없는 종목은 `items`에서 제외한다.
4. 종목별로 `implication`을 작성한다: 뉴스 요약이 아니라 **투자자에게 주는 함의** — 실적·밸류에이션·업황·수급·리스크 측면에서 무엇이 달라졌는지, 기존 투자 논리(해당 종목의 `notes` 기록 참고)를 강화하는지 약화하는지, 다음에 확인할 지표는 무엇인지. 3~6문장, 단정적 매수·매도 권유는 하지 않는다.
5. **전날 시장 분석**을 쓴다.
   - 숫자는 `data/daily/<오늘>.json`(GitHub Actions가 네이버 금융에서 수집한 직전 거래일 종가)을 기준으로 한다. **이 작업 환경은 네이버에 직접 접속할 수 없으므로 `fetch_daily.py`를 직접 실행하지 않는다.**
   - 파일이 없으면 수집을 요청한다: `TZ=Asia/Seoul date +%F > data/requests/daily.txt` 후 이 파일만 커밋(`시장 지표 요청: <오늘>`)해 main에 push한다. GitHub Actions가 1~2분 안에 `data/daily/<오늘>.json`을 커밋한다. 30초 간격으로 `git pull --rebase`하며 최대 8분 기다린다(종목 뉴스 수집을 먼저 해 두면 기다리는 시간을 줄일 수 있다).
   - 8분이 지나도 없으면 play_mcp `koreaStock-market_get_index`(mode `history`)·`koreaStock-market_get_sector`와 WebSearch로 확인한 숫자만 쓴다. 확인 못 한 숫자는 쓰지 않는다.
   - 사이트가 이 파일의 숫자로 화살표 표(▲ 붉은색 / ▼ 파란색)를 직접 그리므로, 뉴스 파일에는 숫자표를 다시 넣지 않고 **글**만 쓴다.
   - `market.sections`에 아래 6개 항목을 이 순서로 쓴다. 각 2~5문장, 숫자를 인용할 땐 수집 파일 값과 일치시킨다. 변동의 **원인**(뉴스·수급·정책·실적)과 **보유 포트폴리오에 주는 의미**를 함께 쓴다.
     1. `국내 증시` — 코스피·코스닥 등락과 그 이유, 외국인·기관 수급
     2. `환율` — 원/달러 움직임과 배경, 수출주·내수주 영향
     3. `금리` — 미국 국채 10년·30년, 한국 국채 10년 금리 움직임(변동폭은 %p로 표기)과 배경(연준·한은 정책 기대, 물가·고용 지표), 성장주·가치주·금융주·배당주 영향
     4. `유가` — WTI·브렌트 움직임과 배경, 정유·화학·운송 영향
     5. `업종` — 강세·약세 업종(수집 파일의 `sectors.top`/`sectors.bottom`)과 그 이유
     6. `미국 증시` — 다우·S&P 500·나스닥·필라델피아 반도체 등락과 이유, 오늘 국내 증시에 줄 영향
   - market_get_news로 시황 헤드라인을 함께 확인해 원인을 근거 있게 쓴다.
6. `summary`에 오늘 전체 총평을 2~4문장으로 쓴다(시장 분위기, 보유 포트폴리오에 가장 중요한 이슈).
7. 아래 형식으로 `data/news/<오늘>.json`을 쓰고, `data/news/index.json`의 `dates` 배열 맨 앞에 오늘 날짜를 추가한다(중복 금지).
8. `data/news/<오늘>.json`, `data/news/index.json`만 커밋하고(`data/daily`는 GitHub Actions가 커밋하므로 건드리지 않는다) `main` 브랜치에 push한다. 커밋 메시지: `뉴스 브리핑: <오늘>`. push가 거절되면 `git pull --rebase` 후 다시 push한다.

## 파일 형식

```json
{
  "date": "2026-10-15",
  "generatedAt": "2026-10-15T07:30:00+09:00",
  "summary": "오늘의 총평",
  "items": [
    {
      "code": "005930",
      "name": "삼성전자",
      "group": "holdings",
      "implication": "투자 판단에 주는 함의",
      "headlines": [
        { "title": "기사 제목", "url": "https://... (확인된 경우만)", "source": "언론사", "date": "2026-10-15" }
      ]
    }
  ],
  "market": {
    "sections": [
      { "title": "국내 증시", "body": "..." },
      { "title": "환율", "body": "..." },
      { "title": "금리", "body": "..." },
      { "title": "유가", "body": "..." },
      { "title": "업종", "body": "..." },
      { "title": "미국 증시", "body": "..." }
    ]
  }
}
```

- `group`은 `holdings` 또는 `watchlist`.
- `headlines`는 종목당 1~5개, 중요도 순.
- JSON은 UTF-8, 2칸 들여쓰기. 커밋 전에 `python -m json.tool`로 유효성을 확인한다.
- 위에 적은 파일(과 5단계의 `data/requests/daily.txt`) 외에는 수정하지 않는다.
