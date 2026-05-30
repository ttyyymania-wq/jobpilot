# JobPilot (잡파일럿)

> 대화 한 번으로 공고 매칭 → 지원 추적 → 면접 당일 통근·날씨까지 챙기는 **생성형 UI 채용 에이전트**

이직 준비 직장인을 위해, JobPilot은 검색에서 멈추지 않습니다. 1차 면접에 합격하면 통근 경로(스윙·ODsay)와 날씨(기상청)를 합쳐 **"비 오고 막히니 15분 일찍 출발하세요"를 먼저 알려주고** 구글 캘린더에 등록합니다.

해커톤: GGUI Track · 솔로 빌드 · 1분 데모

## 핵심 기능
1. 이력서 PDF 업로드 → 프로필 카드 자동 생성
2. 로켓펀치 공고 매칭 → 잡카드 그리드 (발화로 필터링)
3. 지원 현황 칸반 추적
4. 1차 합격 → 면접 일정 등록
5. **선제 제안**: 통근(스윙+ODsay) + 날씨(기상청) 합성 → 출발 시각 추천
6. 구글 캘린더 자동 등록

모든 도구 응답이 `_ui` 디렉티브로 동적 컴포넌트를 생성합니다.

## 기술 스택
GGUI · Claude Agent SDK · MCP(4종: rocketpunch / commute / gcal / profile) · Next.js · Supabase
스폰서/외부 API: 로켓펀치 · 스윙(SWING Playground) · ODsay · 기상청 · Google Calendar

## 문서
- [docs/PRD.md](docs/PRD.md) — 제품 요구사항
- [docs/RALPH-HARNESS-RULES.md](docs/RALPH-HARNESS-RULES.md) — 자율 빌드 하네스 규칙 (v0.2, 검증 ACCEPT)

## 셋업
```bash
cp .env.example .env   # 키 채우기 (절대 커밋 금지)
pnpm install           # 또는 GGUI 템플릿이 정한 PM
```
