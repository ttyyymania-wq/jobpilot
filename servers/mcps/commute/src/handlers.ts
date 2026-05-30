/**
 * Commute MCP 도구 등록 (US-003)
 *
 * 도구 3개:
 *   - get_commute    : 멀티모달 교통수단 비교 (택시/대중교통/킥보드)
 *   - get_weather    : 기상청 단기예보
 *   - plan_departure : 날씨+혼잡 버퍼를 고려한 최적 출발시각 계산
 *
 * 모든 외부 호출은 3초 타임아웃 + fixture fallback.
 * throw 금지, graceful degrade.
 */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

// DEMO_FIXTURE=1 → 항상 fixture 사용 (E2E 스모크 테스트용, 네트워크 호출 없음)
const FORCE_FIXTURE = process.env.DEMO_FIXTURE === '1';

/** 타임아웃 fetch: 3초 초과 시 AbortError */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 3000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** fixture JSON 로드 */
async function loadFixture<T>(name: string): Promise<T> {
  const raw = await readFile(join(FIXTURES_DIR, name), 'utf-8');
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// 기상청 위경도 → 격자(nx, ny) 변환 (DFS LCC 투영, 기상청 공식)
// 강남(37.4979, 127.0276) → nx=61, ny=125 검증
// ---------------------------------------------------------------------------

const RE = 6371.00877; // 지구 반경 (km)
const GRID = 5.0;      // 격자 간격 (km)
const SLAT1 = 30.0;   // 표준위도 1
const SLAT2 = 60.0;   // 표준위도 2
const OLON = 126.0;   // 기준 경도 (°E)
const OLAT = 38.0;    // 기준 위도 (°N)
const XO = 43.0;      // 기준점 x 격자
const YO = 136.0;     // 기준점 y 격자

function latLngToGrid(lat: number, lng: number): { nx: number; ny: number } {
  const DEGRAD = Math.PI / 180.0;

  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  const ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  const raVal = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const nx = Math.floor(raVal * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - raVal * Math.cos(theta) + YO + 0.5);
  return { nx, ny };
}

// ---------------------------------------------------------------------------
// 기상청 base_time 계산 (가장 가까운 이전 발표 시각)
// ---------------------------------------------------------------------------

function getKmaBaseTime(now: Date): { base_date: string; base_time: string } {
  const KST_OFFSET = 9 * 60; // KST = UTC+9
  const kst = new Date(now.getTime() + KST_OFFSET * 60 * 1000);

  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = kst.getUTCHours();

  const TIMES = [2, 5, 8, 11, 14, 17, 20, 23];
  let baseHour = TIMES[0]!;
  for (const t of TIMES) {
    if (hh >= t) baseHour = t;
  }

  // 발표 후 10분 이내이면 이전 타임으로 후퇴
  const minNow = hh * 60 + kst.getUTCMinutes();
  if (minNow < baseHour * 60 + 10) {
    const idx = TIMES.indexOf(baseHour);
    if (idx > 0) {
      baseHour = TIMES[idx - 1]!;
    } else {
      // 자정 직후 → 전날 2300
      const prev = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
      const pyyyy = prev.getUTCFullYear();
      const pmm = String(prev.getUTCMonth() + 1).padStart(2, '0');
      const pdd = String(prev.getUTCDate()).padStart(2, '0');
      return {
        base_date: `${pyyyy}${pmm}${pdd}`,
        base_time: '2300',
      };
    }
  }

  return {
    base_date: `${yyyy}${mm}${dd}`,
    base_time: String(baseHour).padStart(2, '0') + '00',
  };
}

// ---------------------------------------------------------------------------
// 날씨 카테고리 해석
// ---------------------------------------------------------------------------

function skyLabel(skyVal: number): string {
  if (skyVal === 1) return '맑음';
  if (skyVal === 3) return '구름많음';
  if (skyVal === 4) return '흐림';
  return '알 수 없음';
}

function ptyLabel(ptyVal: number): string {
  if (ptyVal === 0) return '없음';
  if (ptyVal === 1) return '비';
  if (ptyVal === 2) return '비/눈';
  if (ptyVal === 3) return '눈';
  if (ptyVal === 5) return '빗방울';
  if (ptyVal === 6) return '빗방울/눈날림';
  if (ptyVal === 7) return '눈날림';
  return '알 수 없음';
}

// ---------------------------------------------------------------------------
// 외부 API 호출 함수 (각각 fallback 포함)
// ---------------------------------------------------------------------------

interface SwingTaxiResult {
  distance: number;
  spendTimeSec: number;
  tollFare: number;
  taxiFare: number;
  source: 'live' | 'fixture';
}

async function fetchSwingTaxi(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): Promise<SwingTaxiResult> {
  const baseUrl = process.env.SWING_BASE_URL ?? 'https://stage.playground.endpoint.swingmobility.dev';
  const apiKey = process.env.SWING_API_KEY ?? '';

  if (!FORCE_FIXTURE && apiKey) {
    try {
      const resp = await fetchWithTimeout(
        `${baseUrl}/v1/taxi/eta`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': apiKey,
          },
          body: JSON.stringify({ startLat, startLng, endLat, endLng }),
        },
      );
      if (resp.ok) {
        const data = await resp.json() as {
          distance?: number;
          spendTime?: number;
          tollFare?: number;
          taxiFare?: number;
        };
        return {
          distance: data.distance ?? 0,
          spendTimeSec: data.spendTime ?? 0,
          tollFare: data.tollFare ?? 0,
          taxiFare: data.taxiFare ?? 0,
          source: 'live',
        };
      }
    } catch {
      // fallthrough to fixture
    }
  }

  const fixture = await loadFixture<{
    distance: number;
    spendTime: number;
    tollFare: number;
    taxiFare: number;
  }>('swing.taxi.json');
  return {
    distance: fixture.distance,
    spendTimeSec: fixture.spendTime,
    tollFare: fixture.tollFare,
    taxiFare: fixture.taxiFare,
    source: 'fixture',
  };
}

interface SwingVehicle {
  id: string;
  lat: number;
  lng: number;
  battery?: number;
  status?: string;
}

interface SwingVehiclesResult {
  vehicles: SwingVehicle[];
  source: 'live' | 'fixture';
}

async function fetchSwingVehicles(lat: number, lng: number): Promise<SwingVehiclesResult> {
  const baseUrl = process.env.SWING_BASE_URL ?? 'https://stage.playground.endpoint.swingmobility.dev';
  const apiKey = process.env.SWING_API_KEY ?? '';

  if (!FORCE_FIXTURE && apiKey) {
    try {
      const resp = await fetchWithTimeout(
        `${baseUrl}/v1/vehicles/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': apiKey,
          },
          body: JSON.stringify({ lat, lng, radius: 500, count: 5 }),
        },
      );
      if (resp.ok) {
        const data = await resp.json() as { vehicles?: SwingVehicle[] };
        return { vehicles: data.vehicles ?? [], source: 'live' };
      }
    } catch {
      // fallthrough to fixture
    }
  }

  const fixture = await loadFixture<{ vehicles: SwingVehicle[] }>('swing.vehicles.json');
  return { vehicles: fixture.vehicles, source: 'fixture' };
}

interface OdsayPathInfo {
  totalTime: number;
  payment: number;
  subwayTransitCount: number;
  firstStartStation: string;
  lastEndStation: string;
}

interface OdsayResult {
  info: OdsayPathInfo | null;
  source: 'live' | 'fixture';
}

async function fetchOdsayTransit(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<OdsayResult> {
  const apiKey = process.env.ODSAY_API_KEY ?? '';

  if (!FORCE_FIXTURE && apiKey) {
    try {
      // SX=경도(lng), SY=위도(lat)
      const encodedKey = encodeURIComponent(apiKey);
      const url =
        `https://api.odsay.com/v1/api/searchPubTransPathT` +
        `?SX=${originLng}&SY=${originLat}&EX=${destLng}&EY=${destLat}&apiKey=${encodedKey}`;
      const resp = await fetchWithTimeout(url, { method: 'GET' });
      if (resp.ok) {
        const data = await resp.json() as {
          result?: { path?: Array<{ info: OdsayPathInfo }> };
        };
        const path = data.result?.path?.[0];
        return { info: path?.info ?? null, source: 'live' };
      }
    } catch {
      // fallthrough to fixture (IP 화이트리스트 문제 포함)
    }
  }

  const fixture = await loadFixture<{
    result: { path: Array<{ info: OdsayPathInfo }> };
  }>('odsay.path.json');
  const info = fixture.result.path[0]?.info ?? null;
  return { info, source: 'fixture' };
}

interface KmaItem {
  category: string;
  fcstValue: string;
  fcstDate: string;
  fcstTime: string;
}

interface WeatherResult {
  tempC: number;
  pop: number;
  sky: string;
  isRain: boolean;
  condition: string;
  source: 'live' | 'fixture';
}

async function fetchKmaWeather(
  lat: number,
  lng: number,
  datetime?: Date,
): Promise<WeatherResult> {
  const serviceKey = process.env.KMA_SERVICE_KEY ?? '';
  const baseUrl = process.env.KMA_BASE_URL ?? 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';
  const { nx, ny } = latLngToGrid(lat, lng);
  const now = datetime ?? new Date();
  const { base_date, base_time } = getKmaBaseTime(now);

  const parseItems = (items: KmaItem[]): WeatherResult => {
    let tempC = 20;
    let pop = 0;
    let skyVal = 1;
    let ptyVal = 0;

    for (const item of items) {
      const val = Number(item.fcstValue);
      if (item.category === 'TMP') tempC = val;
      else if (item.category === 'POP') pop = val;
      else if (item.category === 'SKY') skyVal = val;
      else if (item.category === 'PTY') ptyVal = val;
    }

    const isRain = ptyVal > 0;
    const sky = skyLabel(skyVal);
    const condition = isRain
      ? `${sky}, ${ptyLabel(ptyVal)} (강수확률 ${pop}%)`
      : `${sky} (강수확률 ${pop}%)`;

    return { tempC, pop, sky, isRain, condition, source: 'live' };
  };

  if (!FORCE_FIXTURE && serviceKey) {
    try {
      const url =
        `${baseUrl}/getVilageFcst` +
        `?serviceKey=${serviceKey}` +
        `&pageNo=1&numOfRows=300&dataType=JSON` +
        `&base_date=${base_date}&base_time=${base_time}` +
        `&nx=${nx}&ny=${ny}`;
      const resp = await fetchWithTimeout(url, { method: 'GET' });
      if (resp.ok) {
        const data = await resp.json() as {
          response?: { body?: { items?: { item?: KmaItem[] } } };
        };
        const items = data.response?.body?.items?.item ?? [];
        if (items.length > 0) {
          const result = parseItems(items);
          return result;
        }
      }
    } catch {
      // fallthrough to fixture
    }
  }

  const fixture = await loadFixture<{
    response: { body: { items: { item: KmaItem[] } } };
  }>('kma.forecast.json');
  const items = fixture.response.body.items.item;
  const result = parseItems(items);
  return { ...result, source: 'fixture' };
}

// ---------------------------------------------------------------------------
// 도구 등록
// ---------------------------------------------------------------------------

export function registerCommuteTools(server: McpServer): void {
  // -------------------------------------------------------------------
  // get_commute
  // -------------------------------------------------------------------
  server.registerTool(
    'get_commute',
    {
      title: 'Commute · 멀티모달 교통수단 비교',
      description:
        '출발지→목적지 경로에 대해 택시(스윙), 대중교통(ODsay), 킥보드(스윙) 세 가지 수단을 비교합니다. ' +
        '각 수단의 소요시간(분)·요금을 반환하고 최적 수단을 추천합니다. ' +
        '소요시간이 가장 중요한 경우 택시, 비용이 중요하면 대중교통을 추천합니다.',
      inputSchema: {
        originLat: z.number().describe('출발지 위도 (예: 37.4979)'),
        originLng: z.number().describe('출발지 경도 (예: 127.0276)'),
        destLat: z.number().describe('목적지 위도'),
        destLng: z.number().describe('목적지 경도'),
        arrivalTime: z
          .string()
          .optional()
          .describe('도착 희망 시각 ISO8601 (선택). 예: 2026-05-30T09:00:00'),
      },
      outputSchema: {
        options: z.array(
          z.union([
            z.object({
              mode: z.literal('taxi'),
              durationMin: z.number(),
              fare: z.number(),
              source: z.enum(['live', 'fixture']),
            }),
            z.object({
              mode: z.literal('transit'),
              durationMin: z.number(),
              fare: z.number(),
              transfers: z.number(),
              firstStation: z.string(),
              lastStation: z.string(),
              source: z.enum(['live', 'fixture']),
            }),
            z.object({
              mode: z.literal('scooter'),
              count: z.number(),
              source: z.enum(['live', 'fixture']),
            }),
          ]),
        ),
        recommendedMode: z.enum(['taxi', 'transit', 'scooter']),
      },
    },
    async (input) => {
      const { originLat, originLng, destLat, destLng } = input;

      // 세 호출을 병렬로
      const [taxiResult, vehiclesResult, odsayResult] = await Promise.all([
        fetchSwingTaxi(originLat, originLng, destLat, destLng),
        fetchSwingVehicles(originLat, originLng),
        fetchOdsayTransit(originLat, originLng, destLat, destLng),
      ]);

      // spendTime은 초 단위 → 분으로 변환
      const taxiMin = Math.round(taxiResult.spendTimeSec / 60);

      const options: Array<
        | { mode: 'taxi'; durationMin: number; fare: number; source: 'live' | 'fixture' }
        | { mode: 'transit'; durationMin: number; fare: number; transfers: number; firstStation: string; lastStation: string; source: 'live' | 'fixture' }
        | { mode: 'scooter'; count: number; source: 'live' | 'fixture' }
      > = [
        {
          mode: 'taxi',
          durationMin: taxiMin,
          fare: taxiResult.taxiFare,
          source: taxiResult.source,
        },
        {
          mode: 'transit',
          durationMin: odsayResult.info?.totalTime ?? 40,
          fare: odsayResult.info?.payment ?? 1500,
          transfers: odsayResult.info?.subwayTransitCount ?? 0,
          firstStation: odsayResult.info?.firstStartStation ?? '알 수 없음',
          lastStation: odsayResult.info?.lastEndStation ?? '알 수 없음',
          source: odsayResult.source,
        },
        {
          mode: 'scooter',
          count: vehiclesResult.vehicles.length,
          source: vehiclesResult.source,
        },
      ];

      // 추천: 택시가 가장 빠르면 택시, 아니면 대중교통
      const transitMin = odsayResult.info?.totalTime ?? 40;
      const recommendedMode: 'taxi' | 'transit' | 'scooter' =
        taxiMin <= transitMin ? 'taxi' : 'transit';

      const result = { options, recommendedMode };
      return {
        structuredContent: result,
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -------------------------------------------------------------------
  // get_weather
  // -------------------------------------------------------------------
  server.registerTool(
    'get_weather',
    {
      title: 'Weather · 현재 날씨 조회',
      description:
        '위경도로 기상청 단기예보를 조회합니다. 기온(°C), 강수확률(%), 하늘상태, 강수여부를 반환합니다. ' +
        '통근 계획 시 날씨 버퍼를 추가할지 판단하는 데 사용합니다.',
      inputSchema: {
        lat: z.number().describe('위도 (예: 37.4979)'),
        lng: z.number().describe('경도 (예: 127.0276)'),
        datetime: z
          .string()
          .optional()
          .describe('조회 기준 시각 ISO8601 (선택). 미입력 시 현재 시각 기준.'),
      },
      outputSchema: {
        tempC: z.number(),
        pop: z.number(),
        sky: z.string(),
        isRain: z.boolean(),
        condition: z.string(),
        nx: z.number(),
        ny: z.number(),
        source: z.enum(['live', 'fixture']),
      },
    },
    async (input) => {
      const { lat, lng, datetime } = input;
      const dt = datetime ? new Date(datetime) : undefined;
      const { nx, ny } = latLngToGrid(lat, lng);
      const weather = await fetchKmaWeather(lat, lng, dt);

      const result = { ...weather, nx, ny };
      return {
        structuredContent: result,
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -------------------------------------------------------------------
  // plan_departure  ⭐ 클라이맥스 도구
  // -------------------------------------------------------------------
  server.registerTool(
    'plan_departure',
    {
      title: 'Commute · 최적 출발시각 계산',
      description:
        '도착 목표 시각을 입력하면 날씨·혼잡 버퍼를 반영한 최적 출발 시각을 한국어로 안내합니다. ' +
        '강수확률 60% 이상이면 +15분, 출근시간대(07-09시)면 +10분을 추가합니다. ' +
        'plan_departure를 호출하면 내부에서 get_commute + get_weather를 모두 처리하므로 별도 호출이 필요 없습니다.',
      inputSchema: {
        originLat: z.number().describe('출발지 위도'),
        originLng: z.number().describe('출발지 경도'),
        destLat: z.number().describe('목적지 위도'),
        destLng: z.number().describe('목적지 경도'),
        arrivalTime: z
          .string()
          .describe('도착 희망 시각 ISO8601. 예: 2026-05-30T09:00:00'),
      },
      outputSchema: {
        baseDurationMin: z.number(),
        weather: z.object({
          isRain: z.boolean(),
          pop: z.number(),
          condition: z.string(),
        }),
        bufferMin: z.number(),
        recommendedDepartAt: z.string(),
        reason: z.string(),
      },
    },
    async (input) => {
      const { originLat, originLng, destLat, destLng, arrivalTime } = input;

      // 내부에서 commute + weather 병렬 호출
      const [commuteData, weatherData] = await Promise.all([
        (async () => {
          const [taxiResult, , odsayResult] = await Promise.all([
            fetchSwingTaxi(originLat, originLng, destLat, destLng),
            fetchSwingVehicles(originLat, originLng),
            fetchOdsayTransit(originLat, originLng, destLat, destLng),
          ]);
          const taxiMin = Math.round(taxiResult.spendTimeSec / 60);
          const transitMin = odsayResult.info?.totalTime ?? 40;
          return {
            baseDurationMin: Math.min(taxiMin, transitMin),
          };
        })(),
        fetchKmaWeather(originLat, originLng),
      ]);

      const { baseDurationMin } = commuteData;
      const { isRain, pop, condition } = weatherData;

      // 버퍼 계산
      const arrival = new Date(arrivalTime);
      const arrivalHourKST = (arrival.getUTCHours() + 9) % 24;
      const isRushHour = arrivalHourKST >= 7 && arrivalHourKST <= 9;

      const rainBuffer = pop >= 60 ? 15 : 0;
      const rushBuffer = isRushHour ? 10 : 0;
      const bufferMin = rainBuffer + rushBuffer;

      // 출발 시각 = 도착시각 - (기본소요 + 버퍼)
      const totalMin = baseDurationMin + bufferMin;
      const departMs = arrival.getTime() - totalMin * 60 * 1000;
      const departAt = new Date(departMs);
      const recommendedDepartAt = departAt.toISOString();

      // 한국어 이유 문자열
      const parts: string[] = [];
      if (rainBuffer > 0) parts.push(`강수확률 ${pop}% → +${rainBuffer}분`);
      if (rushBuffer > 0) parts.push(`출근 혼잡시간대 → +${rushBuffer}분`);

      let reason: string;
      if (parts.length > 0) {
        reason = `${parts.join(' + ')} → ${bufferMin}분 일찍 출발 권장`;
      } else {
        reason = `날씨와 혼잡도 양호 — 기본 소요시간(${baseDurationMin}분) 기준 출발`;
      }

      const result = {
        baseDurationMin,
        weather: { isRain, pop, condition },
        bufferMin,
        recommendedDepartAt,
        reason,
      };

      return {
        structuredContent: result,
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// 격자변환 검증용 export (단위테스트, 임시 CLI 검증에 사용)
// ---------------------------------------------------------------------------
export { latLngToGrid };
