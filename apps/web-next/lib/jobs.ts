// 공고/매칭 관련 공유 타입과 헬퍼. /api/jobs · /api/match · /api/resume 응답 스키마에 맞춤.

/** GET /api/jobs 의 jobs[] 원소 (rocketpunch search_jobs 정규화 형태). */
export interface Job {
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

export interface JobsResponse {
  source: string;
  total: number;
  jobs: Job[];
}

/** POST /api/match 의 matches[] 원소 (profile match_jobs 형태). */
export interface JobMatch {
  job: {
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
  };
  score: number;
  reason: string;
}

export interface MatchResponse {
  matches: JobMatch[];
  source: string;
}

export interface ResumeProfile {
  name: string;
  email?: string;
  skills: string[];
  yearsExperience: number;
  jobCategories: string[];
  summary: string;
}

export interface ResumeResponse {
  profile: ResumeProfile | null;
  error?: string;
  source: string;
}

/**
 * UI 그리드가 렌더링하는 통합 카드 모델. 검색(/jobs)과 매칭(/match)의
 * 서로 다른 응답 형태를 하나로 합친다. matchScore 는 0–100로 정규화된 값(없으면 null).
 */
export interface JobCardModel {
  id: number;
  title: string;
  subtitle: string;
  company: string;
  companyLogo: string;
  category: string;
  workType: string;
  applyUrl: string;
  matchScore: number | null;
}

export function jobToCard(job: Job): JobCardModel {
  return {
    id: job.id,
    title: job.title,
    subtitle: job.subtitle,
    company: job.company,
    companyLogo: job.companyLogo,
    category: job.category,
    workType: job.workType,
    applyUrl: job.applyUrl,
    matchScore: null,
  };
}

/**
 * match_jobs 의 raw score(스킬 +2 / 카테고리 exact +3 누적, 소수의 정수)를
 * 응답 내 최고 점수 대비 0–100 백분율로 정규화한다. 최고점이 0이면 모두 0.
 */
export function matchesToCards(matches: JobMatch[]): JobCardModel[] {
  const maxScore = matches.reduce((m, x) => Math.max(m, x.score), 0);
  return matches.map((m) => ({
    id: m.job.jobId,
    title: m.job.title,
    subtitle: m.job.subtitle,
    company: m.job.company.name,
    companyLogo: m.job.company.logoUrl,
    category: m.job.jobCategory,
    workType: "",
    applyUrl: m.job.webUrl,
    matchScore:
      maxScore > 0 ? Math.round((m.score / maxScore) * 100) : 0,
  }));
}

/** 직무 카테고리 코드 → 한글 라벨. 미지정 코드는 원문 그대로. */
const CATEGORY_LABELS: Record<string, string> = {
  dev: "개발",
  dataAi: "데이터/AI",
  designUX: "디자인",
  marketingPr: "마케팅/PR",
  manage: "경영/기획",
  sales: "영업",
  hr: "인사",
};

export function categoryLabel(code: string): string {
  if (!code) return "";
  return CATEGORY_LABELS[code] ?? code;
}

const WORKTYPE_LABELS: Record<string, string> = {
  REMOTE: "재택",
  HYBRID: "하이브리드",
  ONSITE: "출근",
};

export function workTypeLabel(code: string): string {
  if (!code) return "";
  return WORKTYPE_LABELS[code.toUpperCase()] ?? code;
}
