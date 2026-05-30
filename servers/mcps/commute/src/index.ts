#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * `@jobpilot/mcp-commute` — 통근+날씨 통합 MCP 서버 (US-003)
 *
 * 기본 포트: 6784 (PORT 환경변수 또는 --port N으로 오버라이드)
 * 엔드포인트:
 *   - POST /mcp        — streamable-HTTP MCP 핸들러
 *   - GET  /health     — 헬스체크 { ok: true }
 *   - GET  /admin/grid — 격자변환 디버그 (lat, lng 쿼리파라미터)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerCommuteTools, latLngToGrid } from './handlers.js';

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
  return 6784;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // 헬스체크
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // 격자변환 디버그
  if (req.method === 'GET' && url.pathname === '/admin/grid') {
    const lat = Number(url.searchParams.get('lat') ?? '37.4979');
    const lng = Number(url.searchParams.get('lng') ?? '127.0276');
    const grid = latLngToGrid(lat, lng);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ lat, lng, ...grid }));
    return;
  }

  // MCP 핸들러
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
      name: '@jobpilot/mcp-commute',
      version: '0.0.1',
      description: '통근 + 날씨 통합 MCP 서버 (US-003): get_commute, get_weather, plan_departure',
    });
    registerCommuteTools(mcp);

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
      console.error('[mcp-commute] mcp handle failed:', err);
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

async function main(): Promise<void> {
  const port = parsePort();

  // 격자변환 단위 검증 (강남: 37.4979, 127.0276 → nx=61, ny=125)
  const gangnam = latLngToGrid(37.4979, 127.0276);
  console.log(`[mcp-commute] 격자변환 검증 강남(37.4979,127.0276) → nx=${gangnam.nx}, ny=${gangnam.ny}`);
  if (gangnam.nx !== 61 || gangnam.ny !== 125) {
    console.warn(`[mcp-commute] ⚠️  격자변환 불일치! 예상 nx=61,ny=125, 실제 nx=${gangnam.nx},ny=${gangnam.ny}`);
  } else {
    console.log('[mcp-commute] ✓ 격자변환 검증 통과');
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      console.error('[mcp-commute] request handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`internal error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`[mcp-commute] ready: http://localhost:${port}/mcp`);
      resolve();
    });
  });
}

main().catch((err) => {
  console.error('[mcp-commute] fatal:', err);
  process.exit(1);
});
