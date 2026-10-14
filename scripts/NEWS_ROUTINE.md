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
5. `summary`에 오늘 전체 총평을 2~4문장으로 쓴다(시장 분위기, 보유 포트폴리오에 가장 중요한 이슈).
6. 아래 형식으로 `data/news/<오늘>.json`을 쓰고, `data/news/index.json`의 `dates` 배열 맨 앞에 오늘 날짜를 추가한다(중복 금지).
7. 두 파일만 커밋하고 `main` 브랜치에 push한다. 커밋 메시지: `뉴스 브리핑: <오늘>`. push가 거절되면 `git pull --rebase` 후 다시 push한다.

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
  ]
}
```

- `group`은 `holdings` 또는 `watchlist`.
- `headlines`는 종목당 1~5개, 중요도 순.
- JSON은 UTF-8, 2칸 들여쓰기. 커밋 전에 `python -m json.tool`로 유효성을 확인한다.
- 다른 파일은 수정하지 않는다.
