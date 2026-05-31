import { NextRequest, NextResponse } from 'next/server';
import { callMcp } from '../_mcp';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { summary, location, start, end } = body as {
    summary?: string;
    location?: string;
    start?: string;
    end?: string;
  };

  if (!summary || !start || !end) {
    return NextResponse.json({ error: 'summary, start, end are required' }, { status: 400 });
  }

  const args: Record<string, unknown> = { summary, start, end };
  if (location) args.location = location;

  const result = await callMcp('gcal', 'gcal_create_event', args);

  if (result.source === 'error') {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
