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

모든 도구 응답이 ggui의 `ggui_render`로 동적 UI를 생성합니다(UI 코드를 직접 작성하지 않음).

## 기술 스택
GGUI · Claude Agent SDK · MCP 4종(rocketpunch / commute / gcal / profile) · Vite SPA · Supabase
스폰서/외부 API: 로켓펀치 · 스윙(SWING Playground) · ODsay · 기상청 · Google Calendar

## 아키텍처 (pnpm 모노레포)
| 경로 | 역할 | 포트 |
| --- | --- | --- |
| `apps/web` | Vite SPA — `@ggui-ai/react` `<AppRenderer>` 채팅 셸 | 6890 |
| `servers/agent` | Claude Agent SDK 백엔드 (HTTP `/agent`) | 6790 |
| `servers/ggui` | ggui serve — 에이전트의 자연어 묘사로 UI 생성 | 6781 |
| `servers/mcps/rocketpunch` | 공고 검색 MCP | 6783 |
| `servers/mcps/commute` | 통근(스윙+ODsay)+날씨(기상청) MCP | 6784 |
| `servers/mcps/profile` | 이력서 파싱·매칭 MCP | 6785 |
| `servers/mcps/gcal` | 구글 캘린더 MCP (토큰 없으면 `.ics` fallback) | 6786 |

## 실행법

### 1. 설치
```bash
pnpm install
```

### 2. 환경변수
```bash
cp .env.example .env.local   # 키 채우기 (절대 커밋 금지)
```
`.env.local` 필수 항목:
- `ANTHROPIC_API_KEY` — 에이전트 + ggui UI 생성 둘 다 사용
- `ROCKETPUNCH_API_KEY`, `SWING_API_KEY`, `ODSAY_API_KEY`, `KMA_SERVICE_KEY` — 라이브 도메인 API
- `GGUI_ROCKETPUNCH_MCP_URL` / `GGUI_COMMUTE_MCP_URL` / `GGUI_PROFILE_MCP_URL` / `GGUI_GCAL_MCP_URL` — `http://localhost:6783~6786/mcp`
- (선택) `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` — 미설정 시 캘린더는 `.ics` fallback(정상 경로)

### 3. 개발 서버 (한 번에 4서버 + 에이전트 + ggui)
```bash
pnpm dev          # ggui + mcps + agent + web 모두 기동 후 브라우저 오픈
pnpm dev --verbose  # 서버 로그 스트리밍
```
열린 뒤 http://localhost:6890 에서 프롬프트 입력.

### 4. 검증 (typecheck / build)
```bash
pnpm typecheck    # 전체 워크스페이스 tsc
pnpm build        # 전체 빌드
```

### 5. 데모 스모크 (Playwright)
`playwright.config.ts`의 webServer가 `pnpm dev`를 자동 spawn/teardown 한다(직접 서버를 띄울 필요 없음).
```bash
pnpm demo-smoke         # 기내(fixture) 모드 — 네트워크 없이 3턴 데모 (DEMO_FIXTURE=1)
pnpm demo-smoke:live    # 라이브 게이트 — source:"live" 도메인 도구 ≥3종 검증 (DEMO_LIVE=1)
```
라이브 게이트는 fixture로 통과 불가하며, 실제 응답 로그에서 `source:"live"`인 서로 다른 도구가
3종 이상(예: `search_jobs` + `get_commute` + `get_weather`) 등장해야 PASS. 캘린더(턴3)는 OAuth 토큰이
없으면 `.ics` fallback이 정상 경로로 인정된다.

## 수동 1회 절차

### US-008 — Supabase 스키마 마이그레이션 (수동 SQL)
DB 비밀번호/psql 없이 자동 적용이 불가하여, Supabase 콘솔 SQL Editor에서 한 번 실행해야 한다.
1. https://supabase.com/dashboard 에서 jobpilot 프로젝트(`cacrjgioedkwxqhxiqbn`) 선택
2. **SQL Editor** 열기
3. `supabase/migrations/0001_init.sql` 내용을 붙여넣고 **Run**
   - `profiles` / `applications` / `interviews` / `commute_cache` 4테이블 (`IF NOT EXISTS`, 재실행 안전)
4. **Table Editor**에서 4테이블 생성 확인
앱은 테이블이 없어도 graceful 동작하므로 데모 자체에는 영향 없음(쓰기 경로만 비활성).

### Google Calendar OAuth (선택)
캘린더를 `.ics` fallback이 아닌 실제 Google API 등록으로 쓰려면:
1. `.env.local`에 `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` 설정
2. 에이전트가 `gcal_get_oauth_url`로 동의 URL을 만들고, 사용자 승인 후 토큰이 저장되면 이후 `source:"google"`로 등록됨

## 문서
- [docs/PRD.md](docs/PRD.md) — 제품 요구사항
- [docs/RALPH-HARNESS-RULES.md](docs/RALPH-HARNESS-RULES.md) — 자율 빌드 하네스 규칙 (v0.2, 검증 ACCEPT)
- [README.ggui.md](README.ggui.md) — GGUI 템플릿 원본 안내
