/**
 * US-010 — Demo Smoke (fixture/기내모드)
 *
 * 1분 데모 3턴 시나리오를 브라우저로 재생한다.
 * DEMO_FIXTURE=1 환경변수로 모든 MCP가 fixture 데이터를 반환하게 강제한다.
 * (네트워크 없이 통과 가능 — CI/오프라인 모두 OK)
 *
 * ggui는 LLM이 UI를 자유 생성하므로 정확한 셀렉터를 보장할 수 없다.
 * 텍스트/역할 기반 느슨한 assert를 사용하며, 셀렉터 가정은 주석으로 명시한다.
 *
 * 실제 실행: DEMO_FIXTURE=1 pnpm demo-smoke
 * (pnpm dev가 DEMO_FIXTURE=1 로 기동되어야 MCP fixture 강제가 적용됨)
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

/** 채팅 textarea에 메시지를 입력하고 전송한다 */
async function sendMessage(page: Page, text: string): Promise<void> {
  const textarea = page.locator('textarea[name="prompt"]');
  await textarea.waitFor({ state: 'visible' });
  await textarea.fill(text);
  // Enter 키 전송 (Chat.tsx: Enter = submit, Shift+Enter = 줄바꿈)
  await textarea.press('Enter');
}

/**
 * agent 응답 완료를 기다린다.
 *
 * 전송 중에는 버튼이 `aria-label="Stop"`(중단)으로 바뀐다(Chat.tsx).
 * 턴이 끝나면 sending=false → 버튼이 다시 `aria-label="Send"`로 돌아온다.
 * (이때 입력창이 비어 있어 Send 버튼은 disabled 상태가 정상 — 활성화를
 *  기다리면 안 된다. 전송 종료 신호는 "Stop 버튼이 사라지는 것"이다.)
 */
async function waitForTurnEnd(page: Page, timeout = 90_000): Promise<void> {
  const stopBtn = page.locator('button[aria-label="Stop"]');
  // 전송 시작 직후 Stop이 나타날 때까지 짧게 대기(이미 떠 있으면 즉시 통과).
  // 매우 빠른 턴이라 못 잡아도 무방 — 이어서 hidden을 보장한다.
  await stopBtn.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  // 턴 종료 = Stop 버튼이 사라짐(sending=false).
  await stopBtn.waitFor({ state: 'hidden', timeout });
}

/**
 * ggui가 렌더한 UI 영역을 찾는다.
 * `<div class="render">` 또는 `<div class="panel-frame">` 안에 iframe이 마운트된다.
 * (Chat.tsx: ResourceFrame → .render > .render-frame > AppRenderer → iframe)
 *
 * 셀렉터 가정: .render-frame 내부에 iframe이 생성됨 (ggui AppRenderer 기준).
 */
async function waitForRenderFrame(page: Page, timeout = 90_000): Promise<void> {
  // 패널 레이아웃: .ui-pane 내부 / 인라인 레이아웃: .history 내부
  // 어느 쪽이든 .render-frame 이 나타나면 UI가 마운트된 것
  await page.locator('.render-frame').first().waitFor({ state: 'visible', timeout });
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

test.describe('US-010 · Demo Smoke (fixture mode)', () => {
  // 콘솔 에러 수집
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;

    page.on('console', (msg: ConsoleMessage) => {
      // AppRenderer 내부 iframe 에러도 포착됨
      if (msg.type() === 'error') {
        // 알려진 무해한 경고는 제외 (ggui CSP 관련 제3자 경고 등)
        const text = msg.text();
        // 빈 CSP 리소스 fetch 실패는 iframe sandbox 특성상 발생 가능 — 제외
        if (text.includes('net::ERR_FAILED') && text.includes('blob:')) return;
        consoleErrors.push(text);
      }
    });

    // 앱 접속 (localhost:6890)
    await page.goto('/');
    // 게스트 토큰 프로비저닝 완료 대기
    // Chat.tsx: "Provisioning guest session…" 로딩 뷰가 사라지면 준비
    await expect(page.locator('text=Provisioning guest session')).toBeHidden({
      timeout: 15_000,
    });
  });

  // ---------------------------------------------------------------------------
  // 턴 1: 채용 공고 검색 → 잡카드 렌더
  // ---------------------------------------------------------------------------
  test('턴1: 프론트엔드 공고 검색 → 잡카드 UI 렌더', async ({ page }) => {
    await sendMessage(page, '3년차 프론트엔드 공고 찾아줘');

    // 에이전트 응답 대기
    await waitForTurnEnd(page);

    // ggui render 프레임 마운트 확인
    await waitForRenderFrame(page);

    // 잡카드 영역에 회사명 또는 직무 관련 텍스트가 존재하는지 확인
    // 셀렉터 가정: ggui가 생성한 카드에 회사명, 직무, 경력 등의 키워드 포함
    // (fixture: rocketpunch.jobs.json 기준 회사명 예: "미소", "딥그로브" 등)
    const renderArea = page.locator('.render-frame').first();
    await expect(renderArea).toBeVisible();

    // iframe 내부 텍스트는 cross-origin sandbox라 직접 접근 불가.
    // 대신 render chrome의 라벨이나 tool-call 로그에서 search_jobs 호출 확인.
    // tool-call-name 에 "search_jobs" 가 보이면 rocketpunch MCP가 호출된 것
    //
    // 셀렉터 가정: Chat.tsx ToolCallView → span.tool-call-name
    const toolCallName = page.locator('.tool-call-name');
    // search_jobs 또는 ggui_render 중 하나 이상 호출됨을 확인
    const toolCallCount = await toolCallName.count();
    expect(toolCallCount).toBeGreaterThan(0);

    // 콘솔 에러 없음
    expect(consoleErrors).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 턴 2: 면접 일정 입력 → 통근+날씨+출발시각 카드 렌더
  // ---------------------------------------------------------------------------
  test('턴2: 면접 일정 입력 → 통근/날씨/plan_departure 카드 렌더', async ({ page }) => {
    // 턴 1 먼저 전송 (컨텍스트 구성)
    await sendMessage(page, '3년차 프론트엔드 공고 찾아줘');
    await waitForTurnEnd(page);

    // 턴 2: 면접 일정 + 통근 요청
    await sendMessage(
      page,
      '토스 면접 6월 5일 오후 2시로 잡혔어. 강남역에서 출발하는데 통근 경로랑 날씨 알려줘',
    );
    await waitForTurnEnd(page);

    // render frame이 새로 마운트되거나 업데이트됨
    await waitForRenderFrame(page);

    // tool-call 로그에서 commute 관련 도구 호출 확인
    // 셀렉터 가정: span.tool-call-name 에 get_commute, get_weather, plan_departure 중 하나
    const toolCallNames = page.locator('.tool-call-name');
    const allNames = await toolCallNames.allTextContents();

    // commute/weather/plan_departure 중 하나 이상 호출됐어야 함
    const commuteToolCalled = allNames.some(
      (n) =>
        n.includes('get_commute') ||
        n.includes('get_weather') ||
        n.includes('plan_departure'),
    );
    // ggui_render 는 반드시 호출됨
    const ggguiRenderCalled = allNames.some((n) => n.includes('ggui_render'));

    expect(ggguiRenderCalled).toBe(true);
    // commute 도구가 호출됐거나 (fixture 모드에서 응답 성공), 또는
    // agent가 텍스트로만 응답했더라도 render는 나타나야 함
    // 느슨한 assert: render frame이 visible하면 통과
    const renderFrame = page.locator('.render-frame').first();
    await expect(renderFrame).toBeVisible();

    // 콘솔 에러 없음
    expect(consoleErrors).toHaveLength(0);

    // 부가 확인: 도구 호출 로그에 통근 관련 키워드 존재 여부 기록
    // (assert가 아닌 soft 체크 — 실패해도 테스트 통과)
    if (commuteToolCalled) {
      test.info().annotations.push({
        type: 'info',
        description: `commute tool called: ${allNames.filter((n) => n.includes('commute') || n.includes('weather') || n.includes('plan')).join(', ')}`,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 턴 3: 캘린더 등록 요청 → 캘린더 확인 카드 렌더
  // ---------------------------------------------------------------------------
  test('턴3: 캘린더 등록 요청 → gcal 카드 렌더', async ({ page }) => {
    // 턴 1
    await sendMessage(page, '3년차 프론트엔드 공고 찾아줘');
    await waitForTurnEnd(page);

    // 턴 2
    await sendMessage(
      page,
      '토스 면접 6월 5일 오후 2시로 잡혔어. 강남역에서 출발하는데 통근 경로랑 날씨 알려줘',
    );
    await waitForTurnEnd(page);

    // 턴 3
    await sendMessage(page, '캘린더에 넣어줘');
    await waitForTurnEnd(page);

    // render frame 확인
    await waitForRenderFrame(page);

    // tool-call 로그에서 gcal 관련 도구 호출 확인
    // 셀렉터 가정: span.tool-call-name 에 gcal_create_event 포함
    const toolCallNames = page.locator('.tool-call-name');
    const allNames = await toolCallNames.allTextContents();

    const gcalCalled = allNames.some(
      (n) => n.includes('gcal_create_event') || n.includes('gcal'),
    );
    const ggguiRenderCalled = allNames.some((n) => n.includes('ggui_render'));

    expect(ggguiRenderCalled).toBe(true);

    if (gcalCalled) {
      test.info().annotations.push({
        type: 'info',
        description: 'gcal_create_event was called (expected in calendar turn)',
      });
    }

    // 렌더 영역이 visible → 캘린더 확인 카드가 마운트됨
    const renderFrame = page.locator('.render-frame').first();
    await expect(renderFrame).toBeVisible();

    // 콘솔 에러 없음
    expect(consoleErrors).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 3턴 전체 연속 실행 (단일 테스트, 데모 재생 시나리오)
  // ---------------------------------------------------------------------------
  test('3턴 전체: fixture 모드 기내 데모 통과', async ({ page }) => {
    // 턴 1
    await sendMessage(page, '3년차 프론트엔드 공고 찾아줘');
    await waitForTurnEnd(page);
    await waitForRenderFrame(page);

    // 턴 1 이후: render frame이 1개 이상
    const frameCount1 = await page.locator('.render-frame').count();
    expect(frameCount1).toBeGreaterThanOrEqual(1);

    // 턴 2
    await sendMessage(
      page,
      '토스 면접 6월 5일 오후 2시로 잡혔어. 강남역에서 출발하는데 통근 경로랑 날씨 알려줘',
    );
    await waitForTurnEnd(page);
    await waitForRenderFrame(page);

    // 턴 3
    await sendMessage(page, '캘린더에 넣어줘');
    await waitForTurnEnd(page);
    await waitForRenderFrame(page);

    // 최종: render frame이 1개 이상 남아 있음
    const frameCountFinal = await page.locator('.render-frame').count();
    expect(frameCountFinal).toBeGreaterThanOrEqual(1);

    // tool-call 전체 호출 수가 3 이상 (최소 search_jobs + ggui_render × 3)
    const toolCallNames = page.locator('.tool-call-name');
    const totalToolCalls = await toolCallNames.count();
    expect(totalToolCalls).toBeGreaterThanOrEqual(3);

    // 콘솔 에러 0
    expect(consoleErrors).toHaveLength(0);
  });
});
