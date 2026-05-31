"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  Bike,
  CalendarPlus,
  CloudRain,
  CloudSun,
  Download,
  MapPin,
  RefreshCw,
  Train,
  Umbrella,
  Wind,
} from "lucide-react";

import { AppShell } from "@/app/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { buildGoogleCalendarUrl, downloadIcs } from "@/lib/calendar";
import { cn } from "@/lib/utils";

// ── Mock interview record ────────────────────────────────────────────────────
// Demo data lives here (Supabase wiring is V2-007). Place names include a
// district keyword so geocode_place resolves accurately ("강남" not "토스").
interface Interview {
  id: string;
  company: string;
  role: string;
  /** ISO8601 interview start (KST wall-clock encoded as a real instant). */
  startsAt: string;
  /** Minutes the interview is expected to run — used for the calendar end. */
  durationMin: number;
  /** Geocodable place string (district keyword recommended). */
  placeLabel: string;
  /** Human-friendly location shown in the header. */
  placeDisplay: string;
}

const MOCK_INTERVIEW: Interview = {
  id: "test",
  company: "토스",
  role: "프론트엔드 엔지니어",
  // 2026-06-05 14:00 KST → 05:00Z
  startsAt: "2026-06-05T05:00:00.000Z",
  durationMin: 60,
  placeLabel: "강남역",
  placeDisplay: "서울 강남구 강남역 인근 토스 오피스",
};

// ── API response shapes (V2-002) ─────────────────────────────────────────────
type CommuteOption =
  | { mode: "taxi"; durationMin: number; fare: number; source: string }
  | {
      mode: "transit";
      durationMin: number;
      fare: number;
      transfers: number;
      firstStation: string;
      lastStation: string;
      source: string;
    }
  | { mode: "scooter"; count: number; source: string };

interface CommuteResult {
  options: CommuteOption[];
  recommendedMode: "taxi" | "transit" | "scooter";
}

interface DepartureResult {
  baseDurationMin: number;
  weather: { isRain: boolean; pop: number; condition: string };
  bufferMin: number;
  recommendedDepartAt: string;
  reason: string;
}

interface CommuteResponse {
  commute: CommuteResult | { error: string };
  departure: DepartureResult | { error: string };
}

interface WeatherResult {
  tempC: number;
  pop: number;
  sky: string;
  isRain: boolean;
  condition: string;
}

interface Geocoded {
  lat: number;
  lng: number;
  displayName: string;
}

const HOME_KEY = "jobpilot/home-origin";

// ── Date helpers (KST display) ───────────────────────────────────────────────
const KST = "Asia/Seoul";

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: KST,
  }).format(new Date(iso));
}

function formatDateLong(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: KST,
  }).format(new Date(iso));
}

function dDay(iso: string): number {
  const target = new Date(iso);
  const now = new Date();
  const startOf = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // Compare on KST calendar days (shift by +9h).
  const shift = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000);
  const diffMs = startOf(shift(target)) - startOf(shift(now));
  return Math.round(diffMs / (24 * 3600 * 1000));
}

// ─────────────────────────────────────────────────────────────────────────────

export default function InterviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const interview = { ...MOCK_INTERVIEW, id };

  return (
    <AppShell>
      <InterviewDetail interview={interview} />
    </AppShell>
  );
}

type Status = "idle" | "loading" | "ready" | "error";

function InterviewDetail({ interview }: { interview: Interview }) {
  const [home, setHome] = useState<string | null>(null);
  const [homeChecked, setHomeChecked] = useState(false);

  const [commute, setCommute] = useState<CommuteResult | null>(null);
  const [commuteStatus, setCommuteStatus] = useState<Status>("idle");

  const [departure, setDeparture] = useState<DepartureResult | null>(null);
  const [departureStatus, setDepartureStatus] = useState<Status>("idle");

  const [weather, setWeather] = useState<WeatherResult | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<Status>("idle");

  const [calendarBusy, setCalendarBusy] = useState(false);

  // Read saved home origin once on mount.
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? localStorage.getItem(HOME_KEY) : null;
    if (saved) setHome(saved);
    setHomeChecked(true);
  }, []);

  // Auto chain: geocode(home) + geocode(company) → /api/commute + /api/weather.
  const runChain = useCallback(
    async (origin: string) => {
      setCommuteStatus("loading");
      setDepartureStatus("loading");
      setWeatherStatus("loading");

      // 1. Geocode both endpoints in parallel (no user clicks).
      const geocode = async (query: string): Promise<Geocoded | null> => {
        try {
          const res = await fetch("/api/geocode", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query }),
          });
          if (!res.ok) return null;
          return (await res.json()) as Geocoded;
        } catch {
          return null;
        }
      };

      const [originGeo, destGeo] = await Promise.all([
        geocode(origin),
        geocode(interview.placeLabel),
      ]);

      if (!destGeo) {
        setCommuteStatus("error");
        setDepartureStatus("error");
        setWeatherStatus("error");
        return;
      }

      // 2. Commute (+ plan_departure) and weather fire in parallel, no clicks.
      const commutePromise = (async () => {
        try {
          const res = await fetch("/api/commute", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              originLat: originGeo?.lat,
              originLng: originGeo?.lng,
              originPlace: originGeo ? undefined : origin,
              destLat: destGeo.lat,
              destLng: destGeo.lng,
              arrivalTime: interview.startsAt,
            }),
          });
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as CommuteResponse;

          if ("error" in data.commute) {
            setCommuteStatus("error");
          } else {
            setCommute(data.commute);
            setCommuteStatus("ready");
          }
          if ("error" in data.departure) {
            setDepartureStatus("error");
          } else {
            setDeparture(data.departure);
            setDepartureStatus("ready");
          }
        } catch {
          setCommuteStatus("error");
          setDepartureStatus("error");
        }
      })();

      const weatherPromise = (async () => {
        try {
          const qs = new URLSearchParams({
            lat: String(destGeo.lat),
            lng: String(destGeo.lng),
            place: interview.placeLabel,
            datetime: interview.startsAt,
          });
          const res = await fetch(`/api/weather?${qs.toString()}`);
          if (!res.ok) throw new Error(String(res.status));
          setWeather((await res.json()) as WeatherResult);
          setWeatherStatus("ready");
        } catch {
          setWeatherStatus("error");
        }
      })();

      await Promise.all([commutePromise, weatherPromise]);
    },
    [interview.placeLabel, interview.startsAt],
  );

  // Kick the chain once we know the home origin.
  useEffect(() => {
    if (homeChecked && home) {
      void runChain(home);
    }
  }, [homeChecked, home, runChain]);

  const saveHome = useCallback((value: string) => {
    localStorage.setItem(HOME_KEY, value);
    setHome(value);
  }, []);

  const retryCommute = useCallback(() => {
    if (home) void runChain(home);
  }, [home, runChain]);

  // Calendar actions.
  const calendarEnd = useMemo(() => {
    const end = new Date(
      new Date(interview.startsAt).getTime() + interview.durationMin * 60000,
    );
    return end.toISOString();
  }, [interview.startsAt, interview.durationMin]);

  const calendarSummary = `${interview.company} ${interview.role} 면접`;

  const openGoogleCalendar = useCallback(() => {
    const url = buildGoogleCalendarUrl(
      calendarSummary,
      interview.startsAt,
      calendarEnd,
      interview.placeDisplay,
      "JobPilot이 등록한 면접 일정",
    );
    window.open(url, "_blank", "noopener");
  }, [calendarSummary, interview.startsAt, calendarEnd, interview.placeDisplay]);

  const downloadCalendar = useCallback(async () => {
    setCalendarBusy(true);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: calendarSummary,
          location: interview.placeDisplay,
          start: interview.startsAt,
          end: calendarEnd,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { icsContent?: string };
      if (data.icsContent) downloadIcs(data.icsContent, calendarSummary);
    } finally {
      setCalendarBusy(false);
    }
  }, [calendarSummary, interview.placeDisplay, interview.startsAt, calendarEnd]);

  const needsHome = homeChecked && !home;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <HeaderCard
        interview={interview}
        onGoogle={openGoogleCalendar}
        onIcs={downloadCalendar}
        calendarBusy={calendarBusy}
      />

      {needsHome ? (
        <HomeOriginForm onSave={saveHome} />
      ) : (
        <DepartureBanner
          status={departureStatus}
          departure={departure}
          weather={weather}
          interviewStart={interview.startsAt}
          recommendedMode={commute?.recommendedMode}
          onRetry={retryCommute}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <CommuteSection
          status={commuteStatus}
          commute={commute}
          onRetry={retryCommute}
          blocked={needsHome}
        />
        <WeatherWidget
          status={weatherStatus}
          weather={weather}
          interviewStart={interview.startsAt}
          blocked={needsHome}
        />
      </div>
    </div>
  );
}

// ── 1. Header card ───────────────────────────────────────────────────────────
function HeaderCard({
  interview,
  onGoogle,
  onIcs,
  calendarBusy,
}: {
  interview: Interview;
  onGoogle: () => void;
  onIcs: () => void;
  calendarBusy: boolean;
}) {
  const d = dDay(interview.startsAt);
  const ddayLabel = d === 0 ? "D-DAY" : d > 0 ? `D-${d}` : `D+${Math.abs(d)}`;

  return (
    <Card className="jp-fade-up jp-d-1 overflow-hidden border-jp-outline bg-jp-card p-6 sm:p-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge
              variant={d <= 1 ? "destructive" : "default"}
              className="px-3 py-1 text-xs font-semibold tracking-wide"
            >
              {ddayLabel}
            </Badge>
            <span className="text-xs font-medium text-jp-fg-muted">
              면접 일정
            </span>
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">
              {interview.company}
            </h1>
            <p className="mt-1 text-base text-jp-fg-muted">{interview.role}</p>
          </div>

          <div className="mt-1 flex flex-col gap-1.5 text-sm text-jp-fg-muted sm:flex-row sm:items-center sm:gap-5">
            <span className="flex items-center gap-1.5">
              <AlarmClock className="size-4 text-jp-blue" />
              {formatDateLong(interview.startsAt)} ·{" "}
              {formatTime(interview.startsAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4 text-jp-blue" />
              {interview.placeDisplay}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <Button onClick={onGoogle} className="w-full font-medium sm:w-auto">
            <CalendarPlus className="size-4" />
            Google 캘린더
          </Button>
          <Button
            variant="outline"
            onClick={onIcs}
            disabled={calendarBusy}
            className="w-full font-medium sm:w-auto"
          >
            <Download className="size-4" />
            {calendarBusy ? "생성 중…" : ".ics 다운로드"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── Home origin form (one-time) ──────────────────────────────────────────────
function HomeOriginForm({ onSave }: { onSave: (value: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <Card className="jp-fade-up jp-d-2 border-dashed border-jp-outline bg-jp-card/60 p-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-jp-blue/15">
            <MapPin className="size-4 text-jp-blue" />
          </span>
          <div>
            <p className="font-semibold">출발지(집)를 알려주세요</p>
            <p className="text-sm text-jp-fg-muted">
              한 번만 입력하면 다음부터 자동으로 출발 시각을 계산해 드려요.
            </p>
          </div>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const v = value.trim();
            if (v) onSave(v);
          }}
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="예: 잠실역, 판교역, 서울시 마포구"
            className="flex-1"
            autoFocus
          />
          <Button type="submit" disabled={!value.trim()} className="font-medium">
            저장하고 계산
          </Button>
        </form>
      </div>
    </Card>
  );
}

// ── 2. ⭐ Departure recommendation banner (climax) ────────────────────────────
function DepartureBanner({
  status,
  departure,
  weather,
  interviewStart,
  recommendedMode,
  onRetry,
}: {
  status: Status;
  departure: DepartureResult | null;
  weather: WeatherResult | null;
  interviewStart: string;
  recommendedMode?: "taxi" | "transit" | "scooter";
  onRetry: () => void;
}) {
  // Loading skeleton — never flash an empty red box.
  if (status === "loading" || status === "idle") {
    return (
      <Card className="overflow-hidden border-jp-outline bg-jp-card p-6 sm:p-7">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Card>
    );
  }

  // Hard failure with nothing to show — degrade with a retry, not a blank banner.
  if (status === "error" || !departure) {
    return (
      <Card className="border-jp-outline bg-jp-card p-6">
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-jp-fg-muted">
            출발 시각을 계산하지 못했어요.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="size-4" />
            다시 시도
          </Button>
        </div>
      </Card>
    );
  }

  const departTime = formatTime(departure.recommendedDepartAt);
  const rain = weather?.isRain || departure.weather.isRain;
  const modeLabel =
    recommendedMode === "transit"
      ? "지하철"
      : recommendedMode === "scooter"
        ? "킥보드"
        : "택시";

  return (
    <div
      className="jp-banner-in jp-red-glow relative overflow-hidden rounded-2xl border border-[var(--jp-red)]/60 p-6 sm:p-8"
      style={{
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--jp-red) 26%, var(--jp-card)) 0%, color-mix(in srgb, var(--jp-red) 12%, var(--jp-card)) 100%)",
      }}
      role="status"
    >
      {/* Ambient red bloom */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-[var(--jp-red)]/25 blur-3xl"
      />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color-mix(in_srgb,var(--jp-red)_30%,white)]">
            <span className="jp-dot-pulse inline-block size-2 rounded-full bg-[var(--jp-red)]" />
            출발 권장
          </span>

          <div className="flex items-baseline gap-3">
            <AlarmClock className="size-8 shrink-0 text-white" />
            <p className="text-4xl font-extrabold leading-none tracking-tight text-white sm:text-5xl">
              {departTime}
            </p>
            <span className="text-lg font-semibold text-white/90">
              출발 권장
            </span>
          </div>

          <p className="max-w-xl text-sm leading-relaxed text-white/85 sm:text-[15px]">
            {departure.reason}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1.5 text-xs font-medium text-white">
            {rain ? (
              <Umbrella className="size-3.5" />
            ) : (
              <CloudSun className="size-3.5" />
            )}
            {rain ? "비 예보" : departure.weather.condition || "맑음"}
          </span>
          {departure.bufferMin > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1.5 text-xs font-medium text-white">
              <Wind className="size-3.5" />
              여유 +{departure.bufferMin}분
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white">
            추천 · {modeLabel}
          </span>
          <span className="text-[11px] text-white/70">
            도착 목표 {formatTime(interviewStart)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── 3a. Commute multimodal cards ─────────────────────────────────────────────
function CommuteSection({
  status,
  commute,
  onRetry,
  blocked,
}: {
  status: Status;
  commute: CommuteResult | null;
  onRetry: () => void;
  blocked: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-jp-fg-muted">통근 경로</h2>

      {blocked || status === "loading" || status === "idle" ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
          ))}
        </div>
      ) : status === "error" || !commute ? (
        <Card className="flex flex-col items-start gap-3 border-jp-outline bg-jp-card p-6">
          <p className="text-sm text-jp-fg-muted">
            경로를 불러오지 못했어요.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="size-4" />
            재시도
          </Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {commute.options.map((opt, i) => (
            <CommuteCard
              key={opt.mode}
              option={opt}
              recommended={opt.mode === commute.recommendedMode}
              index={i}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const MODE_META: Record<
  CommuteOption["mode"],
  { label: string; icon: typeof Train; emoji: string }
> = {
  taxi: { label: "택시", icon: Wind, emoji: "🚕" },
  transit: { label: "지하철", icon: Train, emoji: "🚇" },
  scooter: { label: "킥보드", icon: Bike, emoji: "🛴" },
};

function CommuteCard({
  option,
  recommended,
  index,
}: {
  option: CommuteOption;
  recommended: boolean;
  index: number;
}) {
  const meta = MODE_META[option.mode];

  return (
    <Card
      className={cn(
        "jp-fade-up flex items-center gap-4 p-4 transition-all",
        index === 0 && "jp-d-2",
        index === 1 && "jp-d-3",
        index === 2 && "jp-d-4",
        recommended
          ? "border-jp-blue bg-[color-mix(in_srgb,var(--jp-blue)_10%,var(--jp-card))] ring-1 ring-jp-blue/40"
          : "border-jp-outline bg-jp-card hover:border-jp-fg-muted/40",
      )}
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-jp-surface text-2xl">
        {meta.emoji}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{meta.label}</span>
          {recommended && (
            <Badge className="gap-1 px-2 py-0 text-[11px]">⭐ 추천</Badge>
          )}
        </div>

        {option.mode === "scooter" ? (
          <p className="text-sm text-jp-fg-muted">
            주변 이용 가능 {option.count}대
          </p>
        ) : option.mode === "transit" ? (
          <p className="truncate text-sm text-jp-fg-muted">
            {option.firstStation} → {option.lastStation} · 환승{" "}
            {option.transfers}회
          </p>
        ) : (
          <p className="text-sm text-jp-fg-muted">최단 경로 직행</p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end">
        {option.mode === "scooter" ? (
          <span className="text-sm font-medium text-jp-fg-muted">
            도보 연계
          </span>
        ) : (
          <>
            <span className="text-lg font-bold tabular-nums">
              {option.durationMin}
              <span className="ml-0.5 text-xs font-medium text-jp-fg-muted">
                분
              </span>
            </span>
            <span className="text-xs text-jp-fg-muted tabular-nums">
              {option.fare.toLocaleString("ko-KR")}원
            </span>
          </>
        )}
      </div>
    </Card>
  );
}

// ── 3b. Weather widget ───────────────────────────────────────────────────────
function WeatherWidget({
  status,
  weather,
  interviewStart,
  blocked,
}: {
  status: Status;
  weather: WeatherResult | null;
  interviewStart: string;
  blocked: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-jp-fg-muted">면접 당일 날씨</h2>

      {blocked || status === "loading" || status === "idle" ? (
        <Skeleton className="h-[220px] w-full rounded-xl" />
      ) : status === "error" || !weather ? (
        <Card className="flex h-[220px] flex-col items-center justify-center gap-2 border-jp-outline bg-jp-card p-6 text-center">
          <CloudSun className="size-8 text-jp-fg-muted/60" />
          <p className="text-sm text-jp-fg-muted">날씨 정보를 불러오지 못했어요</p>
        </Card>
      ) : (
        <Card className="jp-fade-up jp-d-3 flex flex-col gap-4 border-jp-outline bg-jp-card p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-jp-fg-muted">
              {formatTime(interviewStart)} 도착 기준
            </span>
            {weather.isRain ? (
              <CloudRain className="size-7 text-jp-blue" />
            ) : (
              <CloudSun className="size-7 text-jp-warn" />
            )}
          </div>

          <div className="flex items-end gap-2">
            <span className="text-5xl font-extrabold tabular-nums leading-none">
              {Math.round(weather.tempC)}°
            </span>
            <span className="pb-1 text-sm text-jp-fg-muted">
              {weather.condition || weather.sky}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-jp-surface px-3 py-2">
            <Umbrella
              className={cn(
                "size-4",
                weather.pop >= 60 ? "text-jp-red" : "text-jp-fg-muted",
              )}
            />
            <span className="text-sm">
              강수확률{" "}
              <span className="font-semibold tabular-nums">{weather.pop}%</span>
            </span>
          </div>

          <p className="text-sm leading-relaxed text-jp-fg-muted">
            {weather.pop >= 60
              ? "☔ 비 예보가 있어요. 우산을 챙기고 평소보다 일찍 나서는 걸 추천해요."
              : weather.tempC >= 28
                ? "🌡️ 더운 날씨예요. 가벼운 옷차림과 물을 챙기세요."
                : "🌤️ 날씨가 무난해요. 편안한 마음으로 면접에 집중하세요."}
          </p>
        </Card>
      )}
    </section>
  );
}
