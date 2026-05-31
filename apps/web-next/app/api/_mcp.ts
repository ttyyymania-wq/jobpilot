// Server-only MCP helper — do NOT import from client components.
// MCP 서버에 HTTP(SSE) 요청을 보내고 structuredContent 또는 content[0].text를 반환.

const MCP_URLS = {
  rocketpunch: 'http://localhost:6783/mcp',
  commute: 'http://localhost:6784/mcp',
  profile: 'http://localhost:6785/mcp',
  gcal: 'http://localhost:6786/mcp',
} as const;

type McpServer = keyof typeof MCP_URLS;

const ALLOWED: Record<McpServer, string[]> = {
  rocketpunch: ['search_jobs', 'get_job', 'search_events'],
  commute: ['get_commute', 'get_weather', 'plan_departure', 'geocode_place'],
  profile: ['match_jobs', 'parse_resume'],
  gcal: ['gcal_create_event'],
};

export type McpResult =
  | { data: unknown; source: string; error?: never }
  | { error: string; source: 'error'; data?: never };

function parseSseResponse(text: string): unknown {
  // SSE 형식: "event: message\ndata: {...}\n\n"
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        // not JSON, continue
      }
    }
  }
  // SSE 아닌 경우 plain JSON 시도
  return JSON.parse(text);
}

function extractContent(parsed: unknown): unknown {
  const obj = parsed as Record<string, unknown>;

  // result.structuredContent 우선
  const result = obj?.result as Record<string, unknown> | undefined;
  if (result?.structuredContent !== undefined) {
    return result.structuredContent;
  }

  // result.content[0].text 파싱
  const content = result?.content;
  if (Array.isArray(content) && content.length > 0) {
    const text = (content[0] as Record<string, unknown>)?.text;
    if (typeof text === 'string') {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }

  // error 처리
  if (obj?.error) {
    throw new Error(JSON.stringify(obj.error));
  }

  return result;
}

export async function callMcp(
  server: McpServer,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<McpResult> {
  // 화이트리스트 검사
  if (!ALLOWED[server]?.includes(tool)) {
    return { error: `Tool "${tool}" not allowed on server "${server}"`, source: 'error' };
  }

  const url = MCP_URLS[server];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    const parsed = parseSseResponse(text);
    const data = extractContent(parsed);

    // structuredContent나 content에 source 필드가 있으면 보존
    const rawSource =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>).source
        : undefined;
    const source: string = typeof rawSource === 'string' ? rawSource : 'mcp';

    return { data, source };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, source: 'error' };
  } finally {
    clearTimeout(timeout);
  }
}
