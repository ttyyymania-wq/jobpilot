import { NextRequest, NextResponse } from 'next/server';
import { callMcp } from '../_mcp';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { query } = body as { query?: string };

  if (!query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }

  const result = await callMcp('commute', 'geocode_place', { query });

  if (result.source === 'error') {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
