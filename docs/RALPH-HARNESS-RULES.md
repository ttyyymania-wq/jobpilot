# RALPH 하네스 엔지니어링 규칙 (v0.2 — critic 검증 반영)

> 대상 빌드: **GGUI 생성형 UI 채용 커리어 에이전트** (PRD: `PRD-ggui-career-agent.md`)
> 목적: 무인 자율 루프(Ralph)가 **멈추지 않으면서(anti-stall)** + **검증 가능한 진짜 완성에서만 종료(objective DoD)** 하도록 강제.
> 이 문서 = 루프가 매 이터레이션 읽는 **계약서**. PRD와 충돌 시 PRD가 상위, 이 문서가 실행 규율.
> v0.2 변경: critic의 Critical 4 + Major 5 + 누락 규칙 반영. ⭐ = 무인 루프 핵심 안전장치.

---

## 0. 글로벌 루프 규칙 (하네스 자체)

### 0.0 ⭐ 프리플라이트 (루프 시작 전 1회, 통과 못 하면 루프 시작 금지)
- `.env` 존재 + 필수 키(`ANTHROPIC_API_KEY`, `SWING_API_KEY`, `ROCKETPUNCH_*`, `SUPABASE_*`, `GOOGLE_OAUTH_*`, 날씨키) 채워짐 확인. 빠진 키는 mock 대상으로 명시 후 진행.
- `pnpm install` 성공 + Supabase 연결 핑 + Anthropic 키 1콜 핑. 실패 시 그것부터 해결(루프 본체 진입 금지).
- 빠진 키로 루프를 돌려 3-strike만 쌓는 사태 방지.

### 0.1 단일 진실원천 (SSOT)
- 스펙 = `PRD-ggui-career-agent.md`. 진행상태 = `.omc/notepad.md` 진행 원장(progress ledger). "할 일/완료" 상태를 다른 어디에도 중복 기록 안 함.
- 매 이터레이션 시작 시 **반드시** 읽는다: (1) 이 규칙 (2) PRD §8 MoSCoW + §4 KPI (3) notepad 원장.

### 0.2 ⭐ 종료 조건 (이것 전부 GREEN일 때만 STOP)
하나라도 RED면 계속 돈다. **단, 0.4의 예산 상한 도달 시 DoD 미충족이어도 HALT(사람 인계).**
- [ ] 빌드(`pnpm build` 또는 §0.8 정의 빌드) **에러 0** 성공
- [ ] `pnpm verify`(5계층, §3B) **전부 통과**
- [ ] `demo-smoke` (기내모드/네트워크 차단) 통과 — 픽스처 경로 완주
- [ ] ⭐ `demo-smoke:live` (네트워크 ON, fallback 비활성) 통과 — **라이브 도구 ≥3종(로켓펀치/통근/캘린더)이 `source:"live"` 로그를 남기며 동작.** 이 게이트는 fallback으로 대체 불가(§0.3, C4/M2).
- [ ] Must 기능(§PRD 8) 전부 동작. **단 KPI가 라이브를 요구하는 항목은 fallback만으론 GREEN 불가**(위 라이브 게이트로 검증).
- [ ] lint/typecheck 에러 0
- [ ] ⭐ verifier가 **별도 컨텍스트 + 증거 재실행**으로 GO 판정(§3B, 자기승인·로그신뢰 금지)
- [ ] 사람 데모 리허설 **3회 연속 완주**(§3C) 기록

### 0.3 "가짜 완료" 금지 (최우선)
- 빌드/verify/demo-smoke를 **실제 실행한 출력(종료코드·stdout) 없이** "완료" 기록 절대 금지. 주장 = 재현 가능한 증거.
- 테스트/게이트를 통과시키려 **테스트 약화·삭제·skip·assert 무력화 금지.** 기능을 고쳐 통과시킨다.
- **mock으로 빠뜨려 게이트를 통과시키는 것 = 가짜 완료**다. 라이브 게이트(§0.2)는 mock 우회 불가.
- "동작할 것이다" ≠ 완료. "방금 실행해 확인했다"만 완료.

### 0.4 ⭐ Anti-Stall + 하드 예산 상한 (안 끊김 ↔ 무한가동 둘 다 방지)
- **이터레이션당 측정 가능한 진척 1개 이상**(파일 변경 + 검증 로그). 없으면 그 이터는 실패로 기록.
- **태스크별 3-strike**: 한 태스크가 (같은 에러든 다른 에러든) 누적 3회 실패하면 → ① 접근법 변경(대안 라이브러리/우회/mock) ② notepad `BLOCKER:` 기록 ③ ledger 상태 `[blocked]`로 전환 → `next_incomplete`가 **건너뜀**(재선택 금지). 같은 벽 무한반복 금지.
- **블로커 격리 우선순위**: Must를 막으면 → 선언된 fallback(mock)으로 데모 경로 먼저 살리고, 라이브 연동은 별도 태스크로 큐에 남겨 라이브 게이트(§0.2) 대상으로 재시도(드롭 아님).
- 외부 대기(키 승인 등)는 대기 대신 **mock으로 진행** + 키 도착 시 교체 태스크 큐.
- ⭐ **하드 상한(셋 중 하나라도 도달 시 즉시 HALT)**: (a) 최대 **40 이터레이션** (b) 누적 벽시계 **6시간** (c) 누적 LLM 토큰 예산 **B 토큰**(시작 시 설정). HALT 시 notepad에 `HALT: budget exceeded` + 현재 GREEN 상태·남은 RED 요약 + 다음 액션을 남기고 **사람에게 인계**. (DoD 미충족이어도 강제 종료 — 비용 폭발·무한루프 차단)
- ⭐ **전역 실패 누계 K회**(예 15) 도달 시도 HALT(서로 다른 에러가 번갈아 나는 무한 시나리오 차단).

### 0.5 재개 가능성 (Resumability)
- 모든 진척 = **원자적 커밋**(`feat:`/`fix:`/`chore:` + 무엇을 검증했는지 한 줄). 죽어도 마지막 GREEN 커밋에서 재개.
- 절반 작업 커밋 금지. 커밋 = 그 시점 빌드 GREEN.
- ledger 상태: `[x] 완료(증거 위치)` / `[~] 진행중` / `[ ] 대기` / `[blocked] (BLOCKER 사유)`.
- ⭐ **DB 스키마는 git 밖**이므로(§M4): 재개 시 `list_migrations`로 적용분 확인 → 미적용분만 실행. 코드-스키마 불일치 시 코드 기준으로 마이그레이션 동기화.

### 0.6 스코프 가드 (오버엔지니어링 금지)
- PRD §8 MoSCoW 밖 기능 **추가 금지.** Could/Won't 손대기 전 Must/Should 100%.
- 단일 사용처 추상화·미요청 설정화·불가능 시나리오 방어코드 금지(전역 CLAUDE.md §2).
- "남는 시간"(=예산 상한 도달 전 모든 게이트 GREEN 상태) → 새 기능 금지, **데모 안정성·리허설·fallback 견고화**에만 사용. 그래도 게이트 다 GREEN이면 STOP(무한 견고화 금지).

### 0.7 ⭐ 비밀/키 취급 (C1)
- 모든 키는 **`.env`에만**. `.env`는 `.gitignore`. 코드/커밋/로그/notepad/스크린샷/픽스처/에러메시지에 **평문 절대 금지**. 참조는 `process.env`로만.
- ⭐ **스펙 문서 평문 키 발견 시**: 즉시 `.env`로 이전하고 원문서를 `<KEY_NAME>` 플레이스홀더로 치환 후 진행. 키 값을 컨텍스트에 보존하지 않는다. (PRD는 v 현재 redaction 완료)
- ⭐ **키 스캔 시점**: 커밋 직전뿐 아니라 (1) 로그 기록 전 (2) 스크린샷 저장 전 (3) notepad 기록 전 (4) 픽스처 저장 전 — 매번. 패턴: `sk-`, `af_sk_`, 36자 UUID형 키, 이메일/PII.
- ⭐ **픽스처/스크린샷 정제**: 실응답 픽스처와 데모 스크린샷에서 토큰·이메일·이력서 PII를 마스킹/제거 후 저장. 정제 안 된 픽스처 커밋 금지.

### 0.8 빌드/툴체인 고정
- 패키지 매니저·빌드·테스트·검증 명령을 루프 시작 시 1회 확정해 notepad에 박는다(GGUI 템플릿이 npm 락파일을 만들면 그걸 따름 — `pnpm` 박제 금지). 이후 모든 게이트는 그 명령 사용.
- 검증 러너 명시: `demo-smoke`/통합스모크는 **Playwright(헤드리스)** 로 DOM·콘솔 캡처. 러너 미정 상태로 "DOM assert" 주장 금지.

---

## 1. 개발 영역

### 1A. 프론트엔드 (GGUI 생성형 UI)
**MUST**
- GGUI 템플릿(`@ggui-ai/create-agentic-app@alpha`) 렌더러 규약 준수: 도구 반환 `{data, _ui}`의 `_ui`를 **변형 없이** 렌더.
- 동적 컴포넌트는 `_ui.target`(`replace`|`append`) 존중 → 멀티턴 UI 중복/유실 금지.
- 영속 뷰(칸반)는 **Supabase SSOT 재투영**, 로컬 상태를 진실원천 삼지 않음.
- 모든 데이터 컴포넌트에 로딩/에러/빈상태 3종(스켈레톤·에러카드·empty). 데모 중 흰 화면 금지.

**MUST NOT**
- 하드코딩 가짜 데이터를 "라이브처럼" 위장(데모 mock은 §3A `source` 플래그로 식별 가능하게).
- 콘솔 에러/경고 방치한 채 완료 선언.

**DoD**
- [ ] 아래 **7종 중 ≥6종** 렌더 확인: ProfileCard / JobCardGrid / KanbanTracker / CommuteRouteCard / WeatherWidget / DeparturePlanCard / CalendarConfirmCard
- [ ] 멀티턴에서 `replace`/`append` 정상(Playwright DOM assert)
- [ ] 콘솔 에러 0 (Playwright 콘솔 캡처)

### 1B. 백엔드 / MCP 서버
**MUST**
- MCP는 `@modelcontextprotocol/sdk` 표준. 도구별 입력 zod 검증, 잘못된 입력은 **에러 객체 반환**(throw로 루프 죽이지 않기).
- 모든 외부 API는 **어댑터 레이어** 통과(스키마·필드명 변동 흡수). 로켓펀치 등 불확실 스키마 정규화.
- **타임아웃(2~3s) + fallback**: 초과 시 선언된 fallback(캐시/픽스처)로 무중단 전환. 호출 전 `commute_cache` 등 캐시 우선.
- 멱등성: 같은 입력→같은 출력(캐시 키). 면접/지원 쓰기는 upsert로 중복 방지.
- ⭐ **DB 스키마 변경은 버전드 마이그레이션 파일로만**(`supabase/migrations/`), `IF NOT EXISTS`/재실행 안전. 커밋에 마이그레이션 파일 + 적용 로그 포함(§M4).

**MUST NOT**
- 외부 실패를 throw로 전파해 턴 전체 깨기. 반드시 graceful degrade.
- rate limit 무시 반복 호출(스윙 taxi 30/min·vehicles 60/min, 로켓펀치/마리트립 한도 — 전역 메모리 §외부 API 최소화).

**DoD**
- [ ] MCP 4종(rocketpunch/commute/gcal/profile) 각 도구가 **정상·잘못된입력·API다운** 3케이스에서 안 죽음(단위 스모크)
- [ ] 모든 외부 호출에 타임아웃·fallback·캐시 경로 존재
- [ ] ⭐ **콜드 캐시** 부하 스모크: 캐시 비운 상태에서 **데모 발화의 정확한 좌표/시간 3턴** 연속 호출 시 429 미발생(§M5)

---

## 2. 디자인 영역

### 2A. UX
**MUST**
- 핵심가치 "선제 제안": 면접 등록 직후 `plan_departure` 카드가 **사용자 요청 없이 자동** 노출.
- 멀티턴 지시어("이거/그 회사")가 `active_application_id`로 해석 → **재입력 0회**.
- 1분 데모 기준 **3턴 내 클라이맥스**. 불필요 입력 제거.
- 막다른 길 금지: API 실패 → "예상값으로 안내" 카드로 흐름 유지.

**DoD**
- [ ] 면접 등록 → 통근/날씨/출발플랜 자동 제안 **무클릭 연쇄** 확인
- [ ] 지시어 멀티턴 시나리오 통과(재입력 없음)

### 2B. UI (BX)
**MUST**
- 비주얼 일관성: 컬러/타이포/간격 토큰화, 인라인 스타일 산발 금지(참고 ORCA `orca-bx`, 채용 도메인 중립화).
- 카드 동일 그리드/라운드/섀도. 클라이맥스 카드(DeparturePlan)는 **시각 강조**(빨강 배너)로 시선 유도.
- 반응형: 발표 스크린 해상도에서 잘림/오버플로 0.
- 접근성 최소선: 대비 AA, 포커스 가시, 의미있는 alt/aria.

**MUST NOT**
- 미완성 플레이스홀더("Lorem"·깨진 이미지·TODO)를 데모 화면 노출.

**DoD**
- [ ] 발표 해상도 스크린샷 레이아웃 깨짐 0
- [ ] 디자인 토큰 단일 소스(하드코딩 컬러 산발 없음)
- [ ] 클라이맥스 카드가 시각적으로 가장 두드러짐

---

## 3. 그 외 영역

### 3A. 데이터/API 연동 계약
**MUST**
- 각 스폰서 API는 **시작 시 1회 실호출로 실응답 픽스처 캡처** → `fixtures/`(0.7 정제 후). 이후 fallback·테스트는 이 실데이터 기반.
- 키/엔드포인트(검증 완료, 키 값은 `.env`):
  - 스윙 stage `https://stage.playground.endpoint.swingmobility.dev`, `X-API-KEY=<SWING_API_KEY>`, `/v1/taxi/eta`{startLat,startLng,endLat,endLng}→{distance,spendTime,tollFare,taxiFare}, `/v1/vehicles/search`. ⚠️stage=mock값 가능.
  - 로켓펀치: 샌드박스(시작 즉시 키·스키마 확인, 0순위).
  - 날씨: 기상청 주력 + OWM fallback. 캘린더: Google OAuth Testing 모드 + 테스트 유저.
- **source 플래그**: 응답마다 `source: live|cache|fixture` 기록(화면엔 자연스럽게, 로그엔 명시).
- ⭐ **OAuth 토큰 수명 관리(§M3)**: Google OAuth Testing 모드 refresh token은 **7일 만료**. 데모 직전 토큰 유효성 체크(refresh 시도) → 실패 시 **`.ics` 생성 fallback**으로 CalendarConfirmCard를 채운다. `.ics` 경로를 demo-smoke 정식 통과 경로로 등록.

**DoD**
- [ ] 모든 사용 API 실응답 픽스처 존재(정제됨)
- [ ] 라이브 다운 시 픽스처 전환 통합 스모크 통과
- [ ] gcal 토큰 만료 시 `.ics` fallback 통과

### 3B. ⭐ QA / 검증 루프 (작성≠검증, 증거 재실행)
**MUST**
- 빌더 패스와 verifier 패스 **분리**. 매 Must 완료 시 **별도 verifier 에이전트** 독립 판정(전역 OMC 자기승인 금지).
- ⭐ **verifier는 빌더 로그를 신뢰하지 않는다.** 깨끗한 작업트리에서 `pnpm verify`(5계층) + `demo-smoke` + `demo-smoke:live`를 **자기 손으로 재실행**하고 그 stdout·종료코드만 근거로 GO/NO-GO. 빌더 로그와 재실행 결과 불일치 시 즉시 NO-GO + `BLOCKER: evidence-mismatch`.
- 5계층: ① typecheck/lint ② 단위 스모크 ③ 통합 스모크(API+fallback) ④ demo-smoke(기내) + demo-smoke:live ⑤ verifier 종합. 상위는 하위 GREEN 후.
- 회귀 방지: GREEN→RED 되면 **최우선 수정**(새 기능보다 우선).

**DoD**
- [ ] `pnpm verify` 단일 명령으로 5계층 실행
- [ ] verifier가 **재실행 기반** GO + 근거(종료코드/해시)

### 3C. ⭐ 데모 준비성 (최종 산출물)
**MUST**
- `demo-smoke`: 1분 데모 3턴 코드 재생 → 각 턴 기대 UI/상태 assert. 깨지면 전체 RED.
- 두 변종 필수: **`demo-smoke`(기내모드, 픽스처 완주)** + **`demo-smoke:live`(네트워크 ON, fallback 비활성, 라이브 ≥3종 `source:"live"`)**. 둘 다 GREEN이어야 종료(§0.2).
- 데모 발화 = 사전 스니펫 고정(오타·즉흥 금지). 라이브 API는 데모 직전 워밍업 1회 + 캐시. 워밍업 캐시 키 = **데모 발화의 정확한 좌표/시간**.
- "데모는 무조건 돈다": 네트워크 끊겨도 픽스처로 3턴 완주.
- ⭐ **사람 리허설**: demo-smoke 통과 후, 사람이 **발표 스크린 해상도 + 실제 네트워크**에서 1분 데모를 **3회 연속 완주**해야 종료(§0.2). demo-smoke ≠ 발표 환경.

**DoD**
- [ ] `demo-smoke`(기내) 통과
- [ ] `demo-smoke:live`(라이브 ≥3종) 통과
- [ ] 사람 리허설 3회 연속 완주 기록(notepad)

### 3D. 관측성 / 로깅
**MUST**
- 외부 호출·fallback 전환·에러를 구조화 로그(`{ts, tool, source, ms, ok}`)로. 데모 후 어디서 mock이 동작했는지 추적.
- 루프 로그는 `.omc/logs/`. **0.7 마스킹 적용 후** 기록.

**DoD**
- [ ] 1회 데모 로그에서 각 도구 source(live/cache/fixture) 식별 가능

### 3E. 시간 박스 / 컷 규율 (솔로·1분 데모)
**MUST**
- 컷 순서(PRD §8): `tobl.ai → 칸반드래그 → 젠랭크배지 → 로켓펀치라이브 → 통근라이브`. **절대 안 버림: 생성형UI + 멀티턴 + 통근/날씨/캘린더 클라이맥스 + demo-smoke(+live).**
- ⚠️ **단, 라이브 게이트(§0.2)가 요구하는 라이브 ≥3종은 컷 대상 아님.** 컷은 "추가 라이브"에만 적용, KPI 최소 라이브는 보존.
- 예산 상한 임박 시 추가 라이브를 픽스처로 강등하되 **demo-smoke:live 최소 3종은 유지**, 데모 완주 보장에 집중.

**DoD**
- [ ] 임의 시점 "지금 멈춰도 데모 가능"(매 GREEN 커밋 = 데모 가능 상태)

---

## 4. 이터레이션 루프 의사코드 (수정판)

```
preflight()                                   # 0.0 — 실패 시 루프 시작 안 함
iter = 0; total_fails = 0
same_err = {}                                 # task -> count
loop:
  if iter >= 40 or wallclock >= 6h or tokens >= B or total_fails >= 15:
     HALT("budget exceeded", green_summary)   # 0.4 하드 상한
  iter++
  read(rules, PRD §8+§4, notepad ledger)
  task = next_incomplete(Must → Should → Could, skip [blocked])   # 0.4/0.6
  if task == none and all_gates_green(): goto FINALIZE
  if task blocked by external(key 미도착): task = mock_path(task)  # + 라이브 교체 태스크 큐
  implement(task)                                       # 빌더 패스
  run: typecheck → lint → unit → integ → demo-smoke → demo-smoke:live  # 0.3 증거
  if any RED:
     total_fails++; same_err[task]++
     if same_err[task] >= 3:                            # 0.4 task별 3-strike
        change_approach(task) ; if still fail: ledger[task]=[blocked]; notepad BLOCKER
     continue loop
  same_err[task] = 0
  if verifier_rerun(task) == GO:                        # 3B 증거 재실행, 자기승인 금지
     atomic_commit(task, evidence) ; ledger[task]=[x]   # 0.5 (+migration 동기화)
  continue loop

FINALIZE:
  if verifier_rerun(global)==GO and human_rehearsal>=3:  # 0.2 / 3C
     STOP   # 유일한 정상 종료
  else: continue loop
```

---

## 5. 종료 직전 최종 체크리스트 (verifier가 재실행으로 확인)
- [ ] 0.2 DoD 전부 GREEN + **재실행** 증거(종료코드/해시)
- [ ] `demo-smoke`(기내) + `demo-smoke:live`(라이브 ≥3종 `source:"live"`) 둘 다 통과
- [ ] 사람 리허설 3회 연속 완주
- [ ] 키 누출 스캔 통과(코드/커밋/로그/픽스처/스크린샷)
- [ ] DB 마이그레이션 적용분 = 코드 기대치 일치
- [ ] notepad에 미완 Must 0, `[blocked]` Must 0
- [ ] 마지막 커밋이 빌드 GREEN
- [ ] verifier 종합 GO + 한 줄 사유
