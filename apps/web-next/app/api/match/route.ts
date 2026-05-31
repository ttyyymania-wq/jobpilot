import { NextRequest, NextResponse } from 'next/server';
import { callMcp } from '../_mcp';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { skills, jobCategories } = body as {
    skills?: string[];
    jobCategories?: string[];
  };

  const result = await callMcp('profile', 'match_jobs', {
    skills: skills ?? [],
    jobCategories: jobCategories ?? [],
  });

  if (result.source === 'error') {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
