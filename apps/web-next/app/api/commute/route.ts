import { NextRequest, NextResponse } from 'next/server';
import { callMcp } from '../_mcp';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    originLat,
    originLng,
    originPlace,
    destLat,
    destLng,
    destPlace,
    arrivalTime,
  } = body as Record<string, unknown>;

  const commuteArgs: Record<string, unknown> = {};
  if (originLat !== undefined) commuteArgs.originLat = originLat;
  if (originLng !== undefined) commuteArgs.originLng = originLng;
  if (originPlace !== undefined) commuteArgs.originPlace = originPlace;
  if (destLat !== undefined) commuteArgs.destLat = destLat;
  if (destLng !== undefined) commuteArgs.destLng = destLng;
  if (destPlace !== undefined) commuteArgs.destPlace = destPlace;
  if (arrivalTime !== undefined) commuteArgs.arrivalTime = arrivalTime;

  const [commuteResult, departureResult] = await Promise.all([
    callMcp('commute', 'get_commute', commuteArgs),
    callMcp('commute', 'plan_departure', commuteArgs),
  ]);

  return NextResponse.json({
    commute: commuteResult.source === 'error' ? { error: commuteResult.error } : commuteResult.data,
    departure: departureResult.source === 'error' ? { error: departureResult.error } : departureResult.data,
  });
}
