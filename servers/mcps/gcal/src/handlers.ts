/**
 * MCP 도구 등록 — Google Calendar MCP 서버.
 *
 * 도구 3개:
 *   - gcal_get_oauth_url  — Google OAuth 동의 URL 생성
 *   - gcal_create_event   — 캘린더 일정 등록 (토큰 없으면 .ics fallback)
 *   - gcal_list_events    — 등록 일정 조회 (토큰 없으면 빈 배열)
 *
 * 설계 원칙: throw 금지, graceful degrade. 토큰 없는 경로가 정상 경로.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OAuth2Client } from 'google-auth-library';
import { loadToken } from './token-store.js';
import { buildIcsContent } from './ics.js';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function makeOAuth2Client(redirectUri?: string): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
  const redirect =
    redirectUri ??
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    'http://localhost:3000/api/oauth/callback';
  return new OAuth2Client(clientId, clientSecret, redirect);
}

export function registerGcalTools(server: McpServer): void {
  // ─── 1. gcal_get_oauth_url ─────────────────────────────────────────────────
  server.registerTool(
    'gcal_get_oauth_url',
    {
      title: 'GCal · OAuth URL 생성',
      description:
        'Google Calendar OAuth 동의 URL을 생성합니다. 반환된 authUrl을 브라우저에서 열면 사용자가 캘린더 접근을 승인할 수 있습니다. state 값은 CSRF 방지용입니다.',
      inputSchema: {
        redirectUri: z
          .string()
          .url()
          .optional()
          .describe(
            'OAuth 콜백 URI. 기본값: GOOGLE_OAUTH_REDIRECT_URI 환경변수 또는 http://localhost:3000/api/oauth/callback',
          ),
      },
      outputSchema: {
        authUrl: z.string().describe('브라우저에서 열어야 할 OAuth 동의 URL'),
        state: z.string().describe('CSRF 방지용 랜덤 state 값'),
      },
    },
    async (input) => {
      const redirectUri = input.redirectUri as string | undefined;
      const oauth2Client = makeOAuth2Client(redirectUri);
      const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [CALENDAR_SCOPE],
        state,
      });

      return {
        structuredContent: { authUrl, state },
        content: [{ type: 'text', text: JSON.stringify({ authUrl, state }) }],
      };
    },
  );

  // ─── 2. gcal_create_event ─────────────────────────────────────────────────
  server.registerTool(
    'gcal_create_event',
    {
      title: 'GCal · 일정 등록',
      description:
        '구글 캘린더에 일정을 등록합니다. 저장된 OAuth 토큰이 있으면 Google Calendar API로 직접 등록합니다. 토큰이 없거나 만료된 경우 .ics 파일 콘텐츠를 생성해 반환합니다(fallback). source 필드로 어떤 경로로 처리됐는지 확인하세요.',
      inputSchema: {
        summary: z.string().min(1).describe('일정 제목 (필수)'),
        location: z.string().optional().describe('장소'),
        start: z
          .string()
          .describe('시작 일시 (ISO 8601, 예: 2024-06-01T10:00:00+09:00)'),
        end: z
          .string()
          .describe('종료 일시 (ISO 8601, 예: 2024-06-01T11:00:00+09:00)'),
        description: z.string().optional().describe('일정 설명'),
        reminderMinutes: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('팝업 알림 몇 분 전 (생략 시 기본값 사용)'),
      },
      outputSchema: {
        eventId: z.string().nullable().describe('Google 이벤트 ID (google 경로일 때만)'),
        htmlLink: z.string().nullable().describe('Google 캘린더 이벤트 링크 (google 경로일 때만)'),
        icsContent: z.string().describe('.ics 파일 내용 (항상 생성됨)'),
        source: z.enum(['google', 'ics']).describe('google: API 등록 성공, ics: fallback'),
      },
    },
    async (input) => {
      const summary = String(input.summary);
      const start = String(input.start);
      const end = String(input.end);
      const location = input.location as string | undefined;
      const description = input.description as string | undefined;
      const reminderMinutes = input.reminderMinutes as number | undefined;

      // .ics는 항상 생성 (fallback + 다운로드 용도)
      const icsContent = buildIcsContent({
        summary,
        start,
        end,
        location,
        description,
        reminderMinutes,
      });

      // 토큰 확인
      const token = loadToken();
      if (token === null) {
        // 토큰 없음 — .ics fallback (정상 경로)
        const result = { eventId: null, htmlLink: null, icsContent, source: 'ics' as const };
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }

      // 토큰 있음 — Google Calendar API 시도
      try {
        const oauth2Client = makeOAuth2Client();
        oauth2Client.setCredentials({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expiry_date: token.expiry_date,
        });

        const eventBody: Record<string, unknown> = {
          summary,
          start: { dateTime: start },
          end: { dateTime: end },
        };
        if (location) eventBody.location = location;
        if (description) eventBody.description = description;
        if (reminderMinutes !== undefined) {
          eventBody.reminders = {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: reminderMinutes }],
          };
        }

        const accessToken = await oauth2Client.getAccessToken();
        const response = await fetch(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(eventBody),
          },
        );

        if (!response.ok) {
          // API 실패 → .ics fallback
          const result = { eventId: null, htmlLink: null, icsContent, source: 'ics' as const };
          return {
            structuredContent: result,
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        }

        const data = (await response.json()) as { id?: string; htmlLink?: string };
        const result = {
          eventId: data.id ?? null,
          htmlLink: data.htmlLink ?? null,
          icsContent,
          source: 'google' as const,
        };
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch {
        // 네트워크/파싱 오류 → .ics fallback
        const result = { eventId: null, htmlLink: null, icsContent, source: 'ics' as const };
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
    },
  );

  // ─── 3. gcal_list_events ─────────────────────────────────────────────────
  server.registerTool(
    'gcal_list_events',
    {
      title: 'GCal · 일정 조회',
      description:
        '구글 캘린더의 일정 목록을 조회합니다. OAuth 토큰이 있어야 합니다. 토큰이 없으면 빈 배열을 반환합니다. source 필드로 상태를 확인하세요.',
      inputSchema: {
        timeMin: z
          .string()
          .optional()
          .describe('조회 시작 일시 (ISO 8601). 생략 시 현재 시각'),
        timeMax: z
          .string()
          .optional()
          .describe('조회 종료 일시 (ISO 8601). 생략 시 30일 후'),
      },
      outputSchema: {
        events: z.array(
          z.object({
            id: z.string(),
            summary: z.string(),
            start: z.string(),
            end: z.string(),
            htmlLink: z.string().optional(),
          }),
        ),
        source: z.enum(['google', 'none']).describe('google: 실제 조회, none: 토큰 없음'),
      },
    },
    async (input) => {
      const token = loadToken();

      if (token === null) {
        const result = { events: [], source: 'none' as const };
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }

      try {
        const oauth2Client = makeOAuth2Client();
        oauth2Client.setCredentials({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expiry_date: token.expiry_date,
        });

        const now = new Date();
        const timeMin = (input.timeMin as string | undefined) ?? now.toISOString();
        const timeMax =
          (input.timeMax as string | undefined) ??
          new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '50',
        });

        const accessToken = await oauth2Client.getAccessToken();
        const response = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
          {
            headers: { Authorization: `Bearer ${accessToken.token}` },
          },
        );

        if (!response.ok) {
          const result = { events: [], source: 'none' as const };
          return {
            structuredContent: result,
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        }

        const data = (await response.json()) as {
          items?: Array<{
            id?: string;
            summary?: string;
            start?: { dateTime?: string; date?: string };
            end?: { dateTime?: string; date?: string };
            htmlLink?: string;
          }>;
        };

        const events = (data.items ?? []).map((item) => ({
          id: item.id ?? '',
          summary: item.summary ?? '(제목 없음)',
          start: item.start?.dateTime ?? item.start?.date ?? '',
          end: item.end?.dateTime ?? item.end?.date ?? '',
          htmlLink: item.htmlLink,
        }));

        const result = { events, source: 'google' as const };
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch {
        const result = { events: [], source: 'none' as const };
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
    },
  );
}
