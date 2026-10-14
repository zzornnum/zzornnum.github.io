# 투자는 경영이다

https://zzornnum.github.io — 보유종목·관심종목 기록과 매일의 뉴스 함의.

- `data/portfolio.json` — 보유/관심종목과 기록. 사이트의 **편집 설정**에 GitHub fine-grained 토큰(이 저장소 Contents 읽기/쓰기)을 넣으면 브라우저에서 바로 수정·커밋됩니다.
- `data/market.json` — 코스피·코스닥 전 종목 시세/시가총액. 저장소에 커밋하지 않고, 배포 워크플로가 평일 08:00–20:00 사이 30분마다 네이버 금융에서 받아 함께 배포합니다.
- `data/news/YYYY-MM-DD.json` — 매일 한 번 Claude 예약 작업이 작성하는 뉴스 브리핑. `data/news/index.json`에 날짜 목록.

뉴스 파일 형식:

```json
{
  "date": "2026-10-15",
  "generatedAt": "2026-10-15T07:30:00+09:00",
  "summary": "오늘의 총평",
  "items": [
    {
      "code": "005930", "name": "삼성전자", "group": "holdings",
      "implication": "이 뉴스가 투자 판단에 주는 함의",
      "headlines": [{ "title": "...", "url": "https://...", "source": "언론사", "date": "2026-10-15" }]
    }
  ]
}
```
