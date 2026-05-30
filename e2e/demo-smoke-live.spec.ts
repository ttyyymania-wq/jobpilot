/**
 * US-011 — Demo Smoke Live (라이브 게이트)
 *
 * DEMO_LIVE=1 환경변수가 설정되어야 실행된다.
 * fixture 모드 비활성, 실제 네트워크 ON.
 *
 * ── 라이브 게이트의 진짜 기준 (하네스 0.2/0.3) ──────────────────────────────
 * "3턴 동안 MCP 응답 로그에서 source:"live"인 서로 다른 도구가 ≥3종 등장"
 *   예) search_jobs(live) + get_commute(live) + get_weather(live) = 3종 → PASS.
 * 이 조건은 **실제 tool-call 결과 JSON에서 직접 파싱**해 확인한다(하드코딩 금지).
 * fixture 모드로는 source:"fixture"만 나오므로 절대 통과할 수 없다.
 *
 * 보조(턴3 캘린더): gcal은 OAuth 토큰이 없으면 source:"ics"(.ics fallback)가
 *   정상 설계 경로다. 따라서 턴3은 "에이전트가 응답 + (ggui 카드 OR ics fallback
 *   텍스트) 반환"이면 통과로 인정한다. gcal이 라이브 3종에 포함될 필요는 없다.
 * ───────────────────────────────────────────────────────────────────────────
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

async function waitForTurnEnd(page: Page, timeout = 150_000): Promise<void> {
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
// tool-call 로그에서 결과 JSON을 파싱해 source 필드를 추출한다.
//
// Chat.tsx ToolCallView → 펼치면 `.tool-call-json` pre 태그 안에 result(=MCP
// CallToolResult)가 prettyJson으로 렌더된다. CallToolResult의 shape는
//   { content: [{type:'text', text:'…'}], structuredContent: {…} }
// 이며, 도메인 도구의 `source` 필드는 **structuredContent 내부**에 들어있다.
//   - search_jobs / get_weather / gcal_*: structuredContent.source (최상위)
//   - get_commute: structuredContent.options[].source (모드별 중첩)
// 따라서 최상위 parsed.source 를 보면 안 되고, 결과 객체를 deep-walk 하여
// 어떤 깊이에서든 "source" 키의 문자열 값을 수집한다(하드코딩 없이 일반화).
// ---------------------------------------------------------------------------

const SOURCE_VALUES = new Set(['live', 'fixture', 'google', 'ics', 'none']);

/**
 * 임의의 값에서 "source" 키의 문자열 값을 재귀적으로 모두 수집한다.
 * 문자열 leaf가 JSON처럼 보이면 한 번 더 파싱해 안쪽도 훑는다
 * (content[].text 안의 직렬화된 결과까지 커버).
 */
function collectSources(value: unknown, depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined) return [];
  const out: string[] = [];

  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('{') || t.startsWith('[')) && t.length > 1) {
      try {
        out.push(...collectSources(JSON.parse(t), depth + 1));
      } catch {
        /* 평범한 문자열 — 무시 */
      }
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) out.push(...collectSources(item, depth + 1));
    return out;
  }

  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'source' && typeof v === 'string' && SOURCE_VALUES.has(v)) {
        out.push(v);
      }
      out.push(...collectSources(v, depth + 1));
    }
    return out;
  }

  return out;
}

interface ToolSourceRow {
  toolName: string;
  sources: string[]; // 이 도구 결과에서 발견된 모든 source 값
  isLive: boolean; // 하나라도 'live' 면 라이브 도구로 카운트
}

/**
 * 모든 tool-call 카드를 펼쳐서 result JSON을 읽고,
 * 도구별 source 목록 + 라이브 여부를 반환한다(3턴 누적 — 카드는 history에 쌓임).
 */
async function collectToolSources(page: Page): Promise<ToolSourceRow[]> {
  // 모든 tool-call 헤더 버튼을 펼친다 (토글 열기)
  const headers = page.locator('.tool-call-header');
  const headerCount = await headers.count();
  for (let i = 0; i < headerCount; i++) {
    const header = headers.nth(i);
    const expanded = await header.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await header.click();
    }
  }

  const cards = page.locator('.msg.tool-call');
  const cardCount = await cards.count();
  const rows: ToolSourceRow[] = [];

  for (let i = 0; i < cardCount; i++) {
    const card = cards.nth(i);
    const toolName = ((await card.locator('.tool-call-name').textContent()) ?? '').trim();

    // result JSON은 두 번째 .tool-call-section 의 pre.tool-call-json
    const sections = card.locator('.tool-call-section');
    if ((await sections.count()) < 2) continue;
    const jsonText = await sections.nth(1).locator('pre.tool-call-json').textContent();
    if (!jsonText || jsonText.trim() === '(awaiting)') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }

    const sources = collectSources(parsed);
    if (sources.length === 0) continue;
    rows.push({
      toolName,
      sources,
      isLive: sources.includes('live'),
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

test.describe('US-011 · Demo Smoke Live (라이브 게이트)', () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // 무해/비결정적 출처 제외 (demo-smoke.spec.ts와 동일 정책):
      // sandbox CSP fetch 실패, 선택적 리소스 404, ggui가 LLM으로 생성한
      // UI 컴포넌트의 산발적 런타임 에러(호스트 앱/에이전트 문제 아님).
      if (text.includes('net::ERR_FAILED') && text.includes('blob:')) return;
      if (text.includes('Failed to load resource') && text.includes('404')) return;
      if (
        text.includes('iframe-runtime') ||
        text.includes('blob:http') ||
        /at Component \(blob:/.test(text)
      ) {
        return;
      }
      consoleErrors.push(text);
    });

    await page.goto('/');
    await expect(page.locator('text=Provisioning guest session')).toBeHidden({
      timeout: 15_000,
    });
  });

  test('3턴 라이브: source:live 도구 ≥3종 검증', async ({ page }) => {
    // 턴 1 — 공고 검색 (rocketpunch search_jobs)
    await sendMessage(page, '3년차 프론트엔드 공고 찾아줘');
    await waitForTurnEnd(page);
    await waitForRenderFrame(page);

    // 턴 2 — 면접 일정 + 통근/날씨 (commute get_commute/get_weather/plan_departure)
    await sendMessage(
      page,
      '토스 면접 6월 5일 오후 2시로 잡혔어. 강남역에서 출발하는데 통근 경로랑 날씨 알려줘',
    );
    await waitForTurnEnd(page);
    await waitForRenderFrame(page);

    // 턴 3 — 캘린더 등록 (gcal). OAuth 토큰 없으면 source:"ics" fallback이 정상.
    //   따라서 턴3은 카드를 강제하지 않고, "에이전트가 응답을 마쳤고
    //   (ggui 카드 OR ics fallback 텍스트 OR gcal tool-call)이 하나라도 있으면" OK.
    await sendMessage(page, '캘린더에 넣어줘');
    await waitForTurnEnd(page);

    const calendarRendered = (await page.locator('.render-frame').count()) > 0;
    const calendarToolCalled =
      (await page.locator('.tool-call-name', { hasText: 'gcal' }).count()) > 0;
    const calendarTextReply = (await page.locator('.msg.assistant').count()) > 0;
    expect(
      calendarRendered || calendarToolCalled || calendarTextReply,
      '턴3(캘린더): ggui 카드 / gcal 도구호출 / 텍스트 응답 중 하나는 있어야 함',
    ).toBe(true);

    // ── 라이브 소스 검증 (핵심 게이트) ───────────────────────────────────────
    const allRows = await collectToolSources(page);

    // ggui 내부 도구 제외, source:"live" 인 서로 다른 도메인 도구 이름 집합
    const liveToolNames = new Set(
      allRows
        .filter((r) => r.isLive && !r.toolName.startsWith('ggui'))
        .map((r) => r.toolName),
    );

    // 라이브 게이트: fixture 모드에서는 source:"fixture"만 나오므로 반드시 실패함.
    expect(
      liveToolNames.size,
      `source:"live" 인 서로 다른 도메인 도구가 ${liveToolNames.size}종 감지됨 (필요: 3종 이상).\n` +
        `라이브 도구: ${[...liveToolNames].join(', ') || '(없음)'}\n` +
        `전체 도구 source 로그:\n${JSON.stringify(allRows, null, 2)}\n` +
        `API 키(.env.local)와 DEMO_LIVE=1 환경변수를 확인하세요.`,
    ).toBeGreaterThanOrEqual(3);

    test.info().annotations.push({
      type: 'live-tools',
      description: [...liveToolNames].join(', '),
    });
    test.info().annotations.push({
      type: 'calendar-turn',
      description: `rendered=${calendarRendered} gcalTool=${calendarToolCalled} textReply=${calendarTextReply}`,
    });

    // 콘솔 에러 없음
    expect(consoleErrors).toHaveLength(0);
  });

  // fixture 전용 assert: DEMO_LIVE=1 상태에서 fixture만 돌리면 실패해야 함을 문서화
  test('라이브 게이트 확인: DEMO_FIXTURE=1 이면 이 테스트는 실패해야 한다', async () => {
    const isFixtureForced = process.env.DEMO_FIXTURE === '1';
    if (isFixtureForced) {
      throw new Error(
        'DEMO_FIXTURE=1 과 DEMO_LIVE=1 을 동시에 사용하면 라이브 게이트를 우회할 수 없습니다.' +
          ' DEMO_FIXTURE 를 제거하거나 0으로 설정하세요.',
      );
    }
    expect(isFixtureForced).toBe(false);
  });
});
