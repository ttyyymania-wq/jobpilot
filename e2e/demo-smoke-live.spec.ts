/**
 * US-011 — Demo Smoke Live (라이브 게이트)
 *
 * DEMO_LIVE=1 환경변수가 설정되어야 실행된다.
 * fixture 모드 비활성, 실제 네트워크 ON.
 *
 * 동일한 3턴 시나리오를 실행하며, 응답에서 source:"live" 도구가
 * ≥3종 호출됐음을 검증한다.
 *
 * fixture만으로는 절대 통과 불가 — 각 도구의 source 필드를 확인하기 때문.
 * (tool-call 로그에서 JSON 파싱 또는 agent endpoint의 응답 구조 활용)
 *
 * 실제 실행: DEMO_LIVE=1 pnpm demo-smoke:live
 *
 * 주의: 실제 API 키(ROCKETPUNCH_API_KEY, SWING_API_KEY, KMA_SERVICE_KEY 등)가
 * .env.local에 설정되어 있어야 source:"live" 경로가 동작한다.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// ---------------------------------------------------------------------------
// 라이브 게이트: DEMO_LIVE=1 이 없으면 전체 스킵
// ---------------------------------------------------------------------------
test.beforeAll(() => {
  if (process.env.DEMO_LIVE !== '1') {
    // eslint-disable-next-line no-console
    console.log('[demo-smoke-live] DEMO_LIVE!=1 — 스킵. DEMO_LIVE=1 로 실행하세요.');
    test.skip();
  }
});

// ---------------------------------------------------------------------------
// 헬퍼 (demo-smoke.spec.ts와 동일 패턴)
// ---------------------------------------------------------------------------

async function sendMessage(page: Page, text: string): Promise<void> {
  const textarea = page.locator('textarea[name="prompt"]');
  await textarea.waitFor({ state: 'visible' });
  await textarea.fill(text);
  await textarea.press('Enter');
}

async function waitForTurnEnd(page: Page, timeout = 120_000): Promise<void> {
  // 전송 중엔 버튼이 aria-label="Stop". 턴 종료 시 Stop이 사라진다.
  // (종료 후 Send 버튼은 입력창이 비어 disabled가 정상이므로 enabled를
  //  기다리면 안 된다.)
  const stopBtn = page.locator('button[aria-label="Stop"]');
  await stopBtn.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  await stopBtn.waitFor({ state: 'hidden', timeout });
}

async function waitForRenderFrame(page: Page, timeout = 120_000): Promise<void> {
  await page.locator('.render-frame').first().waitFor({ state: 'visible', timeout });
}

// ---------------------------------------------------------------------------
// tool-call 로그에서 결과 JSON을 파싱해 source 필드를 추출한다
//
// Chat.tsx ToolCallView → `.tool-call-json` pre 태그 안에
// result JSON이 렌더됨. 이를 파싱해 source:"live" 개수를 센다.
//
// 셀렉터 가정:
//   .tool-call-section:last-child .tool-call-json  →  result JSON pre
//   (각 ToolCallView에 input + result 두 섹션이 있음)
// ---------------------------------------------------------------------------

interface ToolCallResult {
  source?: 'live' | 'fixture' | 'google' | 'ics' | 'none';
  [key: string]: unknown;
}

/**
 * 모든 tool-call 카드를 펼쳐서 result JSON을 읽고,
 * source:"live" 인 도구 이름 목록을 반환한다.
 */
async function expandAndCollectLiveSources(
  page: Page,
): Promise<{ toolName: string; source: string }[]> {
  // 모든 tool-call 헤더 버튼을 찾아 클릭 (토글 열기)
  const headers = page.locator('.tool-call-header');
  const count = await headers.count();

  for (let i = 0; i < count; i++) {
    const header = headers.nth(i);
    const expanded = await header.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await header.click();
      // 애니메이션 없음 — 클릭 즉시 열림
    }
  }

  // 각 tool-call 카드에서 result JSON 읽기
  const cards = page.locator('.msg.tool-call');
  const cardCount = await cards.count();
  const results: { toolName: string; source: string }[] = [];

  for (let i = 0; i < cardCount; i++) {
    const card = cards.nth(i);
    const nameEl = card.locator('.tool-call-name');
    const toolName = (await nameEl.textContent()) ?? '';

    // result JSON은 두 번째 .tool-call-section 의 pre.tool-call-json
    const sections = card.locator('.tool-call-section');
    const sectionCount = await sections.count();
    if (sectionCount < 2) continue;

    const resultSection = sections.nth(1);
    const pre = resultSection.locator('pre.tool-call-json');
    const jsonText = await pre.textContent();
    if (!jsonText || jsonText.trim() === '(awaiting)') continue;

    try {
      const parsed = JSON.parse(jsonText) as ToolCallResult;
      if (parsed.source !== undefined) {
        results.push({ toolName, source: String(parsed.source) });
      }
    } catch {
      // JSON 파싱 실패 — 건너뜀
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

test.describe('US-011 · Demo Smoke Live (라이브 게이트)', () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (text.includes('net::ERR_FAILED') && text.includes('blob:')) return;
        consoleErrors.push(text);
      }
    });

    await page.goto('/');
    await expect(page.locator('text=Provisioning guest session')).toBeHidden({
      timeout: 15_000,
    });
  });

  test('3턴 라이브: source:live 도구 ≥3종 검증', async ({ page }) => {
    // 턴 1
    await sendMessage(page, '3년차 프론트엔드 공고 찾아줘');
    await waitForTurnEnd(page);
    await waitForRenderFrame(page);

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

    // ── 라이브 소스 검증 ──────────────────────────────────────────────
    const liveResults = await expandAndCollectLiveSources(page);

    // source:"live" 도구 목록 (ggui 내부 도구 제외)
    const liveDomainTools = liveResults.filter(
      (r) =>
        r.source === 'live' &&
        !r.toolName.startsWith('ggui_') &&
        r.toolName !== 'ggui_render' &&
        r.toolName !== 'ggui_consume',
    );

    // 라이브 게이트: fixture 모드에서는 source:"fixture"이므로 반드시 실패함
    // 실제 API 키 없이 실행하면 여기서 실패 → 의도된 동작
    expect(
      liveDomainTools.length,
      `라이브 도구 source:"live" 가 ${liveDomainTools.length}개 감지됨 (필요: 3개 이상).\n` +
        `감지된 도구: ${JSON.stringify(liveResults, null, 2)}\n` +
        `API 키(.env.local)와 DEMO_LIVE=1 환경변수를 확인하세요.`,
    ).toBeGreaterThanOrEqual(3);

    // 어떤 도구가 라이브로 호출됐는지 주석 기록
    test.info().annotations.push({
      type: 'live-tools',
      description: liveDomainTools.map((r) => `${r.toolName}(${r.source})`).join(', '),
    });

    // 콘솔 에러 없음
    expect(consoleErrors).toHaveLength(0);
  });

  // fixture 전용 assert: DEMO_LIVE=1 상태에서 fixture만 돌리면 실패해야 함을 문서화
  test('라이브 게이트 확인: DEMO_FIXTURE=1 이면 이 테스트는 실패해야 한다', async () => {
    // 이 테스트는 검증 목적의 메타 테스트.
    // DEMO_LIVE=1 + DEMO_FIXTURE=1 조합으로 실행하면 위 테스트가 실패 → 라이브 게이트 정상 동작 증명.
    // 정상 실행(DEMO_LIVE=1, DEMO_FIXTURE 미설정)에서는 이 assert가 통과.
    const isFixtureForced = process.env.DEMO_FIXTURE === '1';
    if (isFixtureForced) {
      throw new Error(
        'DEMO_FIXTURE=1 과 DEMO_LIVE=1 을 동시에 사용하면 라이브 게이트를 우회할 수 없습니다.' +
          ' DEMO_FIXTURE 를 제거하거나 0으로 설정하세요.',
      );
    }
    // fixture 강제가 아니면 통과
    expect(isFixtureForced).toBe(false);
  });
});
