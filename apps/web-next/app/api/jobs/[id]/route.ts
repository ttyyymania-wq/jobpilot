import { NextRequest, NextResponse } from 'next/server';
import { callMcp } from '../../_mcp';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const result = await callMcp('rocketpunch', 'get_job', { id });

  if (result.source === 'error') {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
