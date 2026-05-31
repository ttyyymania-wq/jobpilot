/**
 * MCP tool registrations for the profile MCP server.
 *
 * Two tools:
 *   - `parse_resume`  — parse resume text → structured profile via Claude Haiku
 *   - `match_jobs`    — match skills/jobCategories against Rocketpunch job listings
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve fixtures relative to project root (walk up from src/)
function loadFixtureJobs(): RocketpunchJob[] {
  const candidates = [
    join(__dirname, '../../../../../../fixtures/rocketpunch.jobs.json'),
    join(__dirname, '../../../../../fixtures/rocketpunch.jobs.json'),
    join(__dirname, '../../../../fixtures/rocketpunch.jobs.json'),
    join(__dirname, '../../../fixtures/rocketpunch.jobs.json'),
    join(__dirname, '../../fixtures/rocketpunch.jobs.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw) as { items?: RocketpunchJob[] };
      return parsed.items ?? [];
    } catch {
      // try next
    }
  }
  return [];
}

interface ParsedProfile {
  name: string;
  email?: string;
  skills: string[];
  yearsExperience: number;
  jobCategories: string[];
  summary: string;
}

interface RocketpunchJob {
  jobId: number;
  title: string | null;
  subtitle?: string | null;
  jobCategory: string | null;
  seniorities?: string[] | null;
  employmentTypes?: string[] | null;
  workType?: string | null;
  company: {
    id: string | null;
    name: string | null;
    logoUrl?: string | null;
    industry?: string | null;
    size?: string | null;
  } | null;
  endAt?: string | null;
  webUrl?: string | null;
}

// Normalized shape that matches the outputSchema (no nulls)
interface NormalizedRocketpunchJob {
  jobId: number;
  title: string;
  subtitle: string;
  jobCategory: string;
  company: {
    id: string;
    name: string;
    logoUrl: string;
    industry: string;
    size: string;
  };
  endAt: string;
  webUrl: string;
}

interface JobMatch {
  job: NormalizedRocketpunchJob;
  score: number;
  reason: string;
}

function normalizeRocketpunchJob(raw: RocketpunchJob): NormalizedRocketpunchJob {
  return {
    jobId: raw.jobId,
    title: raw.title ?? '',
    subtitle: raw.subtitle ?? '',
    jobCategory: raw.jobCategory ?? '',
    company: {
      id: raw.company?.id ?? '',
      name: raw.company?.name ?? '',
      logoUrl: raw.company?.logoUrl ?? '',
      industry: raw.company?.industry ?? '',
      size: raw.company?.size ?? '',
    },
    endAt: raw.endAt ?? '',
    webUrl: raw.webUrl ?? '',
  };
}

function scoreJob(job: NormalizedRocketpunchJob, skills: string[], jobCategories: string[]): { score: number; reason: string } {
  const haystack = [
    job.title,
    job.subtitle,
    job.company.name,
    job.jobCategory,
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;
  const matchedSkills: string[] = [];
  const matchedCategories: string[] = [];

  for (const skill of skills) {
    if (haystack.includes(skill.toLowerCase())) {
      score += 2;
      matchedSkills.push(skill);
    }
  }

  for (const cat of jobCategories) {
    if (job.jobCategory.toLowerCase() === cat.toLowerCase()) {
      score += 3;
      matchedCategories.push(cat);
    } else if (haystack.includes(cat.toLowerCase())) {
      score += 1;
      matchedCategories.push(cat);
    }
  }

  const parts: string[] = [];
  if (matchedSkills.length > 0) parts.push(`skills: ${matchedSkills.join(', ')}`);
  if (matchedCategories.length > 0) parts.push(`categories: ${matchedCategories.join(', ')}`);
  const reason = parts.length > 0 ? `Matched ${parts.join('; ')}` : 'No direct match';

  return { score, reason };
}

export function registerProfileTools(server: McpServer): void {
  // --- parse_resume ---
  server.registerTool(
    'parse_resume',
    {
      title: 'Profile · Parse Resume',
      description:
        'Parse resume text into a structured profile object. Uses Claude Haiku to extract name, email, skills, years of experience, job categories, and a summary. Pass either `text` (raw text) or `fileText` (pre-read file contents). Returns `{ profile, source }` on success, `{ profile: null, error, source }` on failure.',
      inputSchema: {
        text: z
          .string()
          .optional()
          .describe('Raw resume text. Provide either this or fileText.'),
        fileText: z
          .string()
          .optional()
          .describe('Pre-read file contents of the resume. Provide either this or text.'),
      },
      outputSchema: {
        profile: z
          .object({
            name: z.string(),
            email: z.string().optional(),
            skills: z.array(z.string()),
            yearsExperience: z.number(),
            jobCategories: z.array(z.string()),
            summary: z.string(),
          })
          .nullable(),
        error: z.string().optional(),
        source: z.string(),
      },
    },
    async (input) => {
      const resumeText = input.text ?? input.fileText ?? '';

      if (!resumeText.trim()) {
        const result = { profile: null, error: 'No resume text provided', source: 'none' };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const result = { profile: null, error: 'ANTHROPIC_API_KEY not configured', source: 'error' };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }

      const client = new Anthropic({ apiKey });

      let profile: ParsedProfile | null = null;
      let error: string | undefined;

      try {
        const response = await client.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          system: `You are a resume parser. Extract the following fields from the resume text and return ONLY valid JSON, no explanation, no markdown fences:
{
  "name": "string",
  "email": "string or omit if not present",
  "skills": ["array of technical skills"],
  "yearsExperience": number,
  "jobCategories": ["array of job category strings like dev, dataAi, designUX, marketingPr, manage"],
  "summary": "one-sentence professional summary"
}`,
          messages: [
            {
              role: 'user',
              content: resumeText,
            },
          ],
        });

        const textBlock = response.content.find((b) => b.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
          throw new Error('No text response from Claude');
        }

        // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
        let raw = textBlock.text.trim();
        const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(raw);
        if (fenceMatch?.[1] !== undefined) {
          raw = fenceMatch[1].trim();
        }
        profile = JSON.parse(raw) as ParsedProfile;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      const result = {
        profile: profile ?? null,
        ...(error !== undefined ? { error } : {}),
        source: 'live' as const,
      };
      return {
        structuredContent: result,
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // --- match_jobs ---
  server.registerTool(
    'match_jobs',
    {
      title: 'Profile · Match Jobs',
      description:
        'Fetch job listings from Rocketpunch and score them against the given skills and job categories. Returns the top matches sorted by score. Falls back to a local fixture file if the API is unavailable. Returns `{ matches, source }`.',
      inputSchema: {
        skills: z
          .array(z.string())
          .describe('List of technical skills to match against job listings.'),
        jobCategories: z
          .array(z.string())
          .describe('List of job category strings (e.g. "dev", "dataAi") to match.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum number of matches to return. Defaults to 10.'),
      },
      outputSchema: {
        matches: z.array(
          z.object({
            job: z.object({
              jobId: z.number(),
              title: z.string(),
              subtitle: z.string(),
              jobCategory: z.string(),
              company: z.object({
                id: z.string(),
                name: z.string(),
                logoUrl: z.string(),
                industry: z.string(),
                size: z.string(),
              }),
              endAt: z.string(),
              webUrl: z.string(),
            }),
            score: z.number(),
            reason: z.string(),
          }),
        ),
        source: z.string(),
      },
    },
    async (input) => {
      const { skills, jobCategories, limit = 10 } = input;
      let jobs: RocketpunchJob[] = [];
      let source = 'live';

      const baseUrl = process.env.ROCKETPUNCH_BASE_URL;
      const apiKey = process.env.ROCKETPUNCH_API_KEY;

      if (baseUrl && apiKey) {
        try {
          const url = `${baseUrl.replace(/\/$/, '')}/api/v1/jobs?pageSize=50`;
          const res = await fetch(url, {
            headers: {
              'X-OBA-API-Key': apiKey,
            },
          });
          if (!res.ok) {
            throw new Error(`Rocketpunch API error: ${res.status} ${res.statusText}`);
          }
          const data = (await res.json()) as { items?: RocketpunchJob[] };
          jobs = data.items ?? [];
        } catch {
          // Fall through to fixture
          jobs = loadFixtureJobs();
          source = 'fixture';
        }
      } else {
        jobs = loadFixtureJobs();
        source = 'fixture';
      }

      const scored: JobMatch[] = jobs.map((job) => {
        const normalized = normalizeRocketpunchJob(job);
        const { score, reason } = scoreJob(normalized, skills, jobCategories);
        return { job: normalized, score, reason };
      });

      scored.sort((a, b) => b.score - a.score);

      const matches = scored.slice(0, limit);

      const result = { matches, source };
      return {
        structuredContent: result,
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
