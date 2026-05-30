#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * `@jobpilot/mcp-gcal` — 구글 캘린더 MCP 서버 (streamable-HTTP).
 *
 * 기본 포트: 6786 (PORT 환경변수 또는 --port 인자로 재지정 가능).
 *
 * 엔드포인트:
 *   - POST /mcp      — JSON-RPC, streamable-HTTP transport
 *   - GET  /healthz  — 헬스체크 (200 OK)
 *
 * 환경변수:
 *   - GOOGLE_OAUTH_CLIENT_ID       Google OAuth 클라이언트 ID
 *   - GOOGLE_OAUTH_CLIENT_SECRET   Google OAuth 클라이언트 시크릿
 *   - GOOGLE_OAUTH_REDIRECT_URI    OAuth 콜백 URI (기본: http://localhost:3000/api/oauth/callback)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerGcalTools } from './handlers.js';

function parsePort(): number {
  const argIdx = process.argv.indexOf('--port');
  if (argIdx >= 0 && argIdx + 1 < process.argv.length) {
    const n = Number.parseInt(process.argv[argIdx + 1]!, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const env = process.env.PORT;
  if (env !== undefined) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 6786;
}

async function main(): Promise<void> {
  const port = parsePort();

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      console.error('[mcp-gcal] request handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`internal error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`[mcp-gcal] ready: http://localhost:${port}/mcp`);
      resolve();
    });
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/mcp') {
    const body = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return;
    }

    const mcp = new McpServer({
      name: '@jobpilot/mcp-gcal',
      version: '0.0.1',
      description: 'Google Calendar MCP server — gcal_get_oauth_url, gcal_create_event, gcal_list_events.',
    });
    registerGcalTools(mcp);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      transport.close().catch(() => undefined);
      mcp.close().catch(() => undefined);
    });

    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (err) {
      console.error('[mcp-gcal] mcp handle failed:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        );
      }
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

main().catch((err) => {
  console.error('[mcp-gcal] fatal:', err);
  process.exit(1);
});
