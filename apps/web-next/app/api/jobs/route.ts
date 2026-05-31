import { NextRequest, NextResponse } from 'next/server';
import { callMcp } from '../_mcp';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q') ?? '';
  const location = searchParams.get('location') ?? undefined;
  const experience = searchParams.get('experience') ?? undefined;

  const args: Record<string, unknown> = { query };
  if (location) args.location = location;
  if (experience) args.experience = experience;

  const result = await callMcp('rocketpunch', 'search_jobs', args);

  if (result.source === 'error') {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
