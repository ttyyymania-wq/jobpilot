import { NextRequest, NextResponse } from 'next/server';
import { callMcp } from '../_mcp';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { text } = body as { text?: string };

  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  const result = await callMcp('profile', 'parse_resume', { text });

  if (result.source === 'error') {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
