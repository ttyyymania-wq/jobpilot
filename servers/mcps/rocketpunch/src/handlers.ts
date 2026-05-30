/**
 * MCP tool registrations for the Rocketpunch MCP server.
 *
 * Three tools:
 *   - `search_jobs`   — search Rocketpunch job listings (client-side keyword filter)
 *   - `get_job`       — retrieve a single job by jobId
 *   - `search_events` — search Rocketpunch event listings
 *
 * Live API calls use X-OBA-API-Key header. On failure (timeout / non-200 / error),
 * falls back to local fixture files. Every response includes a `source` field:
 * "live" or "fixture".
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const BASE_URL = process.env.ROCKETPUNCH_BASE_URL ?? 'https://openapi.rocketpunch.com';
const API_KEY = process.env.ROCKETPUNCH_API_KEY ?? '';
const TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Fixture loader — searches upward from cwd to find the fixtures directory
// ---------------------------------------------------------------------------

function findFixturesDir(): string {
  // Try cwd first, then walk up up to 4 levels
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'fixtures');
    try {
      readFileSync(join(candidate, 'rocketpunch.jobs.json'), 'utf-8');
      return candidate;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  // Fallback: relative to this file's location
  return join(dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', 'fixtures');
}

let _fixturesDir: string | null = null;
function getFixturesDir(): string {
  if (_fixturesDir === null) _fixturesDir = findFixturesDir();
  return _fixturesDir;
}

function loadJobsFixture(): RawJob[] {
  const raw = readFileSync(join(getFixturesDir(), 'rocketpunch.jobs.json'), 'utf-8');
  const parsed = JSON.parse(raw) as { items: RawJob[] };
  return parsed.items ?? [];
}

function loadEventsFixture(): RawEvent[] {
  const raw = readFileSync(join(getFixturesDir(), 'rocketpunch.events.json'), 'utf-8');
  const parsed = JSON.parse(raw) as { items: RawEvent[] };
  return parsed.items ?? [];
}

// ---------------------------------------------------------------------------
// Raw API response shapes
// ---------------------------------------------------------------------------

interface RawCompany {
  id: string;
  name: string;
  logoUrl: string;
  industry: string;
  size: string;
}

interface RawJob {
  jobId: number;
  title: string;
  subtitle: string;
  jobCategory: string;
  seniorities: string[];
  employmentTypes: string[];
  workType: string;
  company: RawCompany;
  endAt: string;
  webUrl: string;
}

interface RawEvent {
  eventId: string;
  eventName: string;
  eventCategories: string[];
  eventSubjects: string[];
  startAt: string;
  endAt: string;
  eventOpenType: string;
  location: { country?: string; region?: string; locality?: string; address?: string } | null;
  bannerUrl: string;
  hosts: Array<{ hostType: string; name: string; id: string; profileImageUrl: string; roles: string[] }>;
  stats: { viewCount: number; guestCount: number | null };
  webUrl: string;
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

interface NormalizedJob {
  id: number;
  title: string;
  subtitle: string;
  company: string;
  companyLogo: string;
  industry: string;
  companySize: string;
  category: string;
  seniorities: string[];
  employmentTypes: string[];
  workType: string;
  endsAt: string;
  applyUrl: string;
}

interface NormalizedEvent {
  id: string;
  name: string;
  categories: string[];
  subjects: string[];
  startAt: string;
  endAt: string;
  openType: string;
  location: string | null;
  bannerUrl: string;
  organizer: string;
  viewCount: number;
  eventUrl: string;
}

function normalizeJob(raw: RawJob): NormalizedJob {
  return {
    id: raw.jobId,
    title: raw.title,
    subtitle: raw.subtitle,
    company: raw.company.name,
    companyLogo: raw.company.logoUrl,
    industry: raw.company.industry,
    companySize: raw.company.size,
    category: raw.jobCategory,
    seniorities: raw.seniorities,
    employmentTypes: raw.employmentTypes,
    workType: raw.workType,
    endsAt: raw.endAt,
    applyUrl: raw.webUrl,
  };
}

function normalizeEvent(raw: RawEvent): NormalizedEvent {
  const organizer = raw.hosts.find((h) => h.roles.includes('ORGANIZER'))?.name ?? raw.hosts[0]?.name ?? '';
  const locationStr = raw.location
    ? [raw.location.locality, raw.location.region, raw.location.country].filter(Boolean).join(', ')
    : null;
  return {
    id: raw.eventId,
    name: raw.eventName,
    categories: raw.eventCategories,
    subjects: raw.eventSubjects,
    startAt: raw.startAt,
    endAt: raw.endAt,
    openType: raw.eventOpenType,
    location: locationStr,
    bannerUrl: raw.bannerUrl,
    organizer,
    viewCount: raw.stats.viewCount,
    eventUrl: raw.webUrl,
  };
}

// ---------------------------------------------------------------------------
// HTTP fetch helpers with timeout + fallback
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildHeaders(): Record<string, string> {
  return {
    'X-OBA-API-Key': API_KEY,
    'Content-Type': 'application/json',
  };
}

// ---------------------------------------------------------------------------
// API call functions
// ---------------------------------------------------------------------------

// DEMO_FIXTURE=1 → 항상 fixture 사용 (E2E 스모크 테스트용, 네트워크 호출 없음)
const FORCE_FIXTURE = process.env.DEMO_FIXTURE === '1';

async function fetchJobsFromApi(pageSize = 50): Promise<{ items: RawJob[]; totalItems: number } | null> {
  if (FORCE_FIXTURE) return null;
  try {
    const url = `${BASE_URL}/api/v1/jobs?pageSize=${pageSize}`;
    const res = await fetchWithTimeout(url, { headers: buildHeaders() });
    if (!res.ok) return null;
    const data = await res.json() as { totalItems: number; items: RawJob[] };
    return data;
  } catch {
    return null;
  }
}

async function fetchEventsFromApi(): Promise<{ items: RawEvent[]; totalItems: number } | null> {
  if (FORCE_FIXTURE) return null;
  try {
    const url = `${BASE_URL}/api/v1/events`;
    const res = await fetchWithTimeout(url, { headers: buildHeaders() });
    if (!res.ok) return null;
    const data = await res.json() as { totalItems: number; items: RawEvent[] };
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Client-side keyword filter (avoids broken keyword param bug in the API)
// ---------------------------------------------------------------------------

function filterJobs(items: RawJob[], query?: string): RawJob[] {
  if (!query || query.trim() === '') return items;
  const q = query.toLowerCase();
  return items.filter(
    (job) =>
      job.title.toLowerCase().includes(q) ||
      job.company.name.toLowerCase().includes(q) ||
      job.jobCategory.toLowerCase().includes(q) ||
      job.subtitle.toLowerCase().includes(q),
  );
}

function filterEvents(items: RawEvent[], query?: string): RawEvent[] {
  if (!query || query.trim() === '') return items;
  const q = query.toLowerCase();
  return items.filter(
    (ev) =>
      ev.eventName.toLowerCase().includes(q) ||
      ev.eventCategories.some((c) => c.toLowerCase().includes(q)) ||
      ev.eventSubjects.some((s) => s.toLowerCase().includes(q)),
  );
}

// ---------------------------------------------------------------------------
// Tool registrations
// ---------------------------------------------------------------------------

export function registerRocketpunchTools(server: McpServer): void {
  // ─── search_jobs ──────────────────────────────────────────────────────────
  server.registerTool(
    'search_jobs',
    {
      title: 'Rocketpunch · Search Jobs',
      description:
        'Search Rocketpunch job listings. Fetches live data from the Rocketpunch Open API and filters results by query/category/location on the client side. Falls back to cached fixture data if the API is unavailable. The response includes a `source` field: "live" or "fixture".',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Keyword to filter jobs by title, company name, or category.'),
        jobCategory: z
          .string()
          .optional()
          .describe('Filter by job category (e.g. "dev", "dataAi", "designUX", "marketingPr").'),
        location: z
          .string()
          .optional()
          .describe('Filter by work type keyword (e.g. "REMOTE", "HYBRID", "ONSITE").'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .default(20)
          .describe('Maximum number of results to return (default 20).'),
      },
      outputSchema: {
        source: z.enum(['live', 'fixture']),
        total: z.number(),
        jobs: z.array(
          z.object({
            id: z.number(),
            title: z.string(),
            subtitle: z.string(),
            company: z.string(),
            companyLogo: z.string(),
            industry: z.string(),
            companySize: z.string(),
            category: z.string(),
            seniorities: z.array(z.string()),
            employmentTypes: z.array(z.string()),
            workType: z.string(),
            endsAt: z.string(),
            applyUrl: z.string(),
          }),
        ),
      },
    },
    async (input) => {
      let rawItems: RawJob[];
      let source: 'live' | 'fixture';

      const liveData = await fetchJobsFromApi(50);
      if (liveData !== null) {
        rawItems = liveData.items;
        source = 'live';
      } else {
        rawItems = loadJobsFixture();
        source = 'fixture';
      }

      // Client-side filtering
      let filtered = filterJobs(rawItems, input.query);
      if (input.jobCategory) {
        const cat = input.jobCategory.toLowerCase();
        filtered = filtered.filter((j) => j.jobCategory.toLowerCase().includes(cat));
      }
      if (input.location) {
        const loc = input.location.toUpperCase();
        filtered = filtered.filter((j) => j.workType.toUpperCase().includes(loc));
      }

      // Fixture/demo mode: the cached fixtures are a fixed catalog whose
      // titles/categories may not substring-match a free-form (e.g. Korean)
      // query, which would leave the demo with zero cards to render. When a
      // filter empties the result in fixture mode, fall back to the
      // unfiltered fixture set so the agent always has jobs to render.
      if (source === 'fixture' && filtered.length === 0 && rawItems.length > 0) {
        filtered = rawItems;
      }

      const limit = input.limit ?? 20;
      const jobs = filtered.slice(0, limit).map(normalizeJob);

      const result = { source, total: filtered.length, jobs };
      return {
        structuredContent: result,
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  // ─── get_job ──────────────────────────────────────────────────────────────
  server.registerTool(
    'get_job',
    {
      title: 'Rocketpunch · Get Job',
      description:
        'Retrieve a single Rocketpunch job posting by its numeric jobId. Fetches all jobs from the live API and finds the matching entry; falls back to fixture data on failure. Returns null if no job matches.',
      inputSchema: {
        jobId: z.number().int().positive().describe('The numeric jobId from Rocketpunch.'),
      },
      outputSchema: {
        source: z.enum(['live', 'fixture']),
        job: z
          .object({
            id: z.number(),
            title: z.string(),
            subtitle: z.string(),
            company: z.string(),
            companyLogo: z.string(),
            industry: z.string(),
            companySize: z.string(),
            category: z.string(),
            seniorities: z.array(z.string()),
            employmentTypes: z.array(z.string()),
            workType: z.string(),
            endsAt: z.string(),
            applyUrl: z.string(),
          })
          .nullable(),
      },
    },
    async (input) => {
      let rawItems: RawJob[];
      let source: 'live' | 'fixture';

      const liveData = await fetchJobsFromApi(50);
      if (liveData !== null) {
        rawItems = liveData.items;
        source = 'live';
      } else {
        rawItems = loadJobsFixture();
        source = 'fixture';
      }

      const found = rawItems.find((j) => j.jobId === input.jobId) ?? null;
      const job = found !== null ? normalizeJob(found) : null;

      const result = { source, job };
      return {
        structuredContent: result,
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  // ─── search_events ────────────────────────────────────────────────────────
  server.registerTool(
    'search_events',
    {
      title: 'Rocketpunch · Search Events',
      description:
        'Search Rocketpunch tech/startup events. Fetches live event data and optionally filters by query keyword. Falls back to cached fixture data on API failure. Includes `source: "live" | "fixture"` in the response.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Keyword to filter events by name or category.'),
      },
      outputSchema: {
        source: z.enum(['live', 'fixture']),
        total: z.number(),
        events: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            categories: z.array(z.string()),
            subjects: z.array(z.string()),
            startAt: z.string(),
            endAt: z.string(),
            openType: z.string(),
            location: z.string().nullable(),
            bannerUrl: z.string(),
            organizer: z.string(),
            viewCount: z.number(),
            eventUrl: z.string(),
          }),
        ),
      },
    },
    async (input) => {
      let rawItems: RawEvent[];
      let source: 'live' | 'fixture';

      const liveData = await fetchEventsFromApi();
      if (liveData !== null) {
        rawItems = liveData.items;
        source = 'live';
      } else {
        rawItems = loadEventsFixture();
        source = 'fixture';
      }

      const filtered = filterEvents(rawItems, input.query);
      const events = filtered.map(normalizeEvent);

      const result = { source, total: events.length, events };
      return {
        structuredContent: result,
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
