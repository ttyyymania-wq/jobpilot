/**
 * Playwright E2E 설정 — JobPilot demo-smoke 테스트
 *
 * webServer 블록이 pnpm dev를 spawn → teardown한다.
 * 직접 서버를 백그라운드로 올리지 말 것.
 *
 * 포트 정리:
 *   6781 — ggui MCP
 *   6782 — mcps (commute, rocketpunch, gcal, profile…)
 *   6790 — agent backend
 *   6890 — web (Vite SPA)
 */
import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = Number(process.env.WEB_PORT ?? 6890);
const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  // 한 테스트가 3턴까지 연속 실행하며, 각 턴은 에이전트 응답 + ggui의
  // 런타임 UI 생성(LLM)을 포함한다. 실측 백엔드 소요: 턴1~27s / 턴2~68s /
  // 턴3~42s (합계 ~140s) + 브라우저 iframe 렌더 오버헤드. 3턴 테스트가
  // 한 테스트 타임아웃 안에 끝나도록 넉넉히 설정.
  timeout: 360_000,          // 테스트당 최대 6분 (3턴 + 렌더 여유)
  expect: { timeout: 90_000 }, // 단일 UI 렌더 대기 최대 90초

  // 각 spec 파일을 독립 실행 (병렬 시 API 키 공유 충돌 방지)
  workers: 1,
  fullyParallel: false,
  retries: 0,

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    // 콘솔 에러 캡처를 위해 headless 유지
    headless: true,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 브라우저→agent 호출 타임아웃
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /**
   * pnpm dev가 4개 서버(ggui + mcps + agent + web)를 모두 기동한다.
   * reuseExistingServer: true → 이미 올라가 있으면 재사용 (개발자 편의).
   * 60초 대기 후 web(6890)이 응답하면 테스트 시작.
   */
  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    timeout: 90_000,
    reuseExistingServer: true,
    // 환경변수는 각 spec이 process.env를 통해 주입
    env: {
      // 기본값: fixture 모드 OFF (spec에서 override)
      DEMO_FIXTURE: process.env.DEMO_FIXTURE ?? '0',
      DEMO_LIVE: process.env.DEMO_LIVE ?? '0',
    },
  },
});
