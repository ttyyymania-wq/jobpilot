# RALPH 작업 지시서 — JobPilot 빌드

> Ralph 루프의 출발 좌표. 매 이터레이션 이 문서 + `docs/RALPH-HARNESS-RULES.md`(계약서) + `docs/PRD.md`(스펙) + `.omc/notepad.md`(진행원장)를 읽어라.
> **목표**: GGUI 생성형 UI 채용 에이전트 "JobPilot"을 데모 가능한 완성품으로 빌드. 절대 끊기지 말고(anti-stall), 가짜 완료 금지(라이브 게이트), 11h/120iter/$10/K30 상한 도달 시 HALT.

---

## 0. 지금 상태 (부트스트랩 완료)
- GGUI 템플릿 스캐폴딩 완료: `apps/web`(Vite SPA) + `servers/agent`(Claude Agent SDK) + `servers/ggui`(UI 생성) + `servers/mcps/todo`(예시).
- `pnpm install / typecheck / build` 전부 GREEN.
- `.env.local`에 6종 라이브 키 검증 완료. `.mcp.json`에 supabase(jobpilot) + ggui-docs.
- **핵심 원리(CLAUDE.md): UI 코드를 짜지 마라. MCP 도구 + 시스템 프롬프트만 만들면 ggui가 UI를 생성한다.** `ggui_render`에 자연어로 UI를 묘사 → ggui가 React UI 생성 → 사용자 클릭은 `ggui_consume`로 회수.

## 1. 빌드 목표 (PRD §8 MoSCoW 순서로)
**Must (이것부터 100%)**
1. `servers/mcps/todo`를 복제해 **4개 도메인 MCP** 작성:
   - `rocketpunch` — 공고 검색 (search_jobs / get_job / search_events)
   - `commute` — 통근+날씨 통합 (get_commute / get_weather / plan_departure)
   - `gcal` — 구글 캘린더 (get_oauth_url / create_event / list_events)
   - `profile` — 이력서 파싱 (parse_resume / match_jobs)
   각 MCP를 `servers/agent/src/index.ts`(URL env) + `agent.ts`(tool prefix allowlist)에 등록.
2. agent 시스템 프롬프트 = **채용 에이전트 posture** (검색→지원추적→면접→통근+날씨 선제제안→캘린더). `active_application_id` 멀티턴 컨텍스트 유지 규칙 포함.
3. 생성형 UI 7종이 발화별로 떠야 함 (ProfileCard/JobCardGrid/KanbanTracker/CommuteRouteCard/WeatherWidget/DeparturePlanCard/CalendarConfirmCard).
4. Supabase 스키마 (profiles/applications/interviews/commute_cache) 마이그레이션.
5. `demo-smoke`(기내) + `demo-smoke:live`(라이브≥3종) Playwright 스크립트.

**Should**: 칸반 상태추적, 젠랭크 배지(옵션)
**Could/Won't**: PRD §8 참조. 컷 순서 준수.

## 2. ⚠️ 검증된 API 함정 (이대로 어댑터 작성 — 추측 금지)
키는 전부 `.env.local`, `process.env`로만 참조. **평문 절대 금지(하네스 0.7).**

### 로켓펀치 (✅ 검증)
- 헤더: `X-OBA-API-Key: $ROCKETPUNCH_API_KEY`, base `$ROCKETPUNCH_BASE_URL` (openapi.rocketpunch.com)
- ⚠️ **엔드포인트는 `/api/v1/jobs?keyword=`** (콘솔이 알려준 `/v1/jobs/search`는 C9999로 죽음 — 쓰지 마라)
- ⚠️ **keyword 검색이 0건 반환** (샌드박스 한계) → **keyword 없이 `/api/v1/jobs`로 전체(710건) 받아 클라이언트단에서 필터링**
- ⚠️ pageSize 최대 50
- 응답: `{totalItems, page, items:[{jobId,title,subtitle,jobCategory,seniorities,employmentTypes,workType,company:{name,logoUrl,industry,size},endAt,webUrl}]}`
- posts: `/api/v1/posts` (10000건), events: `/api/v1/events` (13건). companies는 가끔 C9999 → fallback.

### 스윙 (✅ 검증)
- 헤더 `X-API-KEY: $SWING_API_KEY`, base `$SWING_BASE_URL` (stage)
- `POST /v1/taxi/eta` body `{startLat,startLng,endLat,endLng}` → `{distance(m),spendTime(초),tollFare,taxiFare}` (강남→삼성 4281m/540s/9090원 확인). **spendTime은 초 → /60 분변환**
- `POST /v1/vehicles/search` body `{lat,lng,radius,count}` → `{vehicles:[{qr,lat,lng,type,battery,isBroken}]}`
- rate: taxi 30/min, vehicles 60/min → 캐시 필수
- ⚠️ stage라 행사 종료 시 중단. 값은 좌표기반 실계산(mock 아님).

### ODsay (✅ 검증)
- `GET https://api.odsay.com/v1/api/searchPubTransPathT?SX={경도}&SY={위도}&EX={경도}&EY={위도}&apiKey={인코딩된키}`
- ⚠️ **apiKey URL 인코딩 필수** (`/`,`+`,`=` 포함). ⚠️ **SX=경도, SY=위도 순서**
- ⚠️ **IP 화이트리스트** — 현재 등록 IP에서만 작동. 현장/배포 시 IP 재등록 필요 → **fallback 픽스처 필수**
- 응답: `result.path[].info{totalTime(분),payment,subwayTransitCount,firstStartStation,lastEndStation}` (강남→삼성 20분/1550원/2환승 확인)

### 기상청 (✅ 검증)
- `GET $KMA_BASE_URL/getVilageFcst?serviceKey=$KMA_SERVICE_KEY&pageNo=1&numOfRows=300&dataType=JSON&base_date=YYYYMMDD&base_time=0500&nx=61&ny=125`
- ⚠️ **위경도→격자 nx/ny 변환 필요** (강남=nx61,ny125 확인). DFS 변환공식 구현.
- ⚠️ base_time은 0200/0500/0800/1100/1400/1700/2000/2300 중 현재 이전. POP는 3시간 단위.
- 응답 카테고리: POP(강수확률), TMP(기온), PTY(강수형태), SKY(하늘), PCP(강수량)
- ⚠️ 오늘은 강수확률 0% → "비 오는 날" 데모는 **강수확률 높은 픽스처**를 따로 캡처해 쓸 것

### Google Calendar (키 있음, 미실호출)
- OAuth Testing 모드, `$GOOGLE_OAUTH_CLIENT_ID/SECRET`, redirect `http://localhost:3000/api/oauth/callback`
- ⚠️ **refresh token 7일 만료** → 만료 시 **`.ics` 생성 fallback** (하네스 M3). 테스트 유저 = 본인 Gmail만.

### Supabase (✅ 검증)
- `$SUPABASE_URL`(cacrjgioedkwxqhxiqbn), anon=`$SUPABASE_ANON_KEY`(sb_publishable_), service=`$SUPABASE_SERVICE_ROLE_KEY`(sb_secret_)
- ⚠️ **신형 키**: anon은 `apikey` 헤더만 (Authorization Bearer 동봉 시 401). 스키마는 SQL Editor 또는 supabase MCP(`.mcp.json`에 jobpilot 프로젝트 연결됨)로.

### Anthropic (✅ 검증)
- `$ANTHROPIC_API_KEY`, 크레딧 정상. 앱 호출은 **claude-haiku-4-5 우선**(비용 $10 가드, 하네스 0.4.1).

## 3. 작업 순서 (권장)
1. 0순위: 각 API 실응답을 `fixtures/`에 캡처(PII 정제) → fallback·테스트 기반
2. rocketpunch MCP → commute MCP(스윙+ODsay+기상청) → profile MCP → gcal MCP
3. agent 등록 + 시스템 프롬프트
4. Supabase 마이그레이션
5. ggui.json 테마(JobPilot 브랜드)
6. demo-smoke + demo-smoke:live (Playwright)
7. 매 Must 완료마다 verifier 재실행 검증 → 원자적 커밋

## 4. 절대 규칙 (하네스에서)
- 가짜 완료 금지: 라이브 게이트(로켓펀치/통근/캘린더 ≥3종 `source:"live"`)는 mock 우회 불가
- 키 평문 금지, 커밋/로그/픽스처/스크린샷 스캔
- 태스크 3회 실패 → 접근 변경 or `[blocked]` skip (무한반복 금지)
- 11h/120iter/$10/K30 도달 → HALT + notepad 인계
- 매 GREEN 커밋 = 데모 가능 상태 유지
