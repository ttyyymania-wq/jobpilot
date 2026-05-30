-- JobPilot US-008: Initial Schema Migration
-- 재실행 안전: 모든 테이블 CREATE TABLE IF NOT EXISTS 사용

-- 1. profiles
create table if not exists profiles (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid,
  name                text,
  email               text,
  skills              text[] default '{}',
  years_experience    numeric,
  job_categories      text[] default '{}',
  preferred_locations text[] default '{}',
  summary             text,
  resume_file_url     text,
  home_address        text,
  created_at          timestamptz default now()
);

-- 2. applications
create table if not exists applications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid,
  profile_id        uuid references profiles(id),
  rocketpunch_job_id text,
  company_name      text,
  job_title         text,
  company_address   text,
  apply_url         text,
  status            text not null default 'applied'
                      check (status in ('applied','doc_passed','interview','final','rejected')),
  applied_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- 3. interviews
create table if not exists interviews (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid references applications(id) on delete cascade,
  round           int default 1,
  scheduled_at    timestamptz,
  location        text,
  gcal_event_id   text,
  gcal_html_link  text,
  created_at      timestamptz default now()
);

-- 4. commute_cache
create table if not exists commute_cache (
  id           uuid primary key default gen_random_uuid(),
  interview_id uuid references interviews(id) on delete cascade,
  origin       text,
  destination  text,
  arrival_time timestamptz,
  result       jsonb,
  computed_at  timestamptz default now()
);

-- 인덱스
create index if not exists idx_app_user_status   on applications(user_id, status);
create index if not exists idx_interview_app      on interviews(application_id);
create index if not exists idx_commute_interview  on commute_cache(interview_id);
