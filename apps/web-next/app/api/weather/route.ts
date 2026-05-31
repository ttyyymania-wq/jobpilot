import { NextRequest, NextResponse } from 'next/server';
import { callMcp } from '../_mcp';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const args: Record<string, unknown> = {};

  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const place = searchParams.get('place');
  const datetime = searchParams.get('datetime');

  if (lat) args.lat = parseFloat(lat);
  if (lng) args.lng = parseFloat(lng);
  if (place) args.place = place;
  if (datetime) args.datetime = datetime;

  const result = await callMcp('commute', 'get_weather', args);

  if (result.source === 'error') {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
