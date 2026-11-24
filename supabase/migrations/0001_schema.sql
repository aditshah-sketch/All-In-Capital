-- All In Capital inbound triage: core schema.
-- Run on BOTH the test and the live project (they are separate databases).
-- The browser never talks to the database: RLS is on for every table with no
-- policies, and anon/authenticated have no grants. Only server code, holding
-- the service-role key, reads or writes.

create extension if not exists vector;
create extension if not exists pgmq;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Versioned config: thesis, rubric and prompts. Edits create new rows.
-- ---------------------------------------------------------------------------
create table config_versions (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('thesis', 'rubric', 'prompts')),
  version     int  not null,
  body        jsonb not null,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (kind, version)
);

-- ---------------------------------------------------------------------------
-- Applications and their documents
-- ---------------------------------------------------------------------------
create table applications (
  id            uuid primary key default gen_random_uuid(),
  external_id   text unique,                 -- e.g. A01
  company       text not null,
  one_liner     text,
  sector        text,
  stage         text,
  form_fields   jsonb not null default '{}', -- parsed form, PII fields removed
  status        text not null default 'queued'
                check (status in ('queued', 'reading', 'ready', 'needs_look')),
  status_reason text,                        -- plain reason when needs_look
  bucket        text check (bucket in ('clear', 'flagged', 'outside')),
  lane          text check (lane in ('yes', 'your_call', 'no')),
  rank          int,
  coverage      numeric,                     -- share of criteria with evidence
  submitted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Founder personal data lives only here. Never sent to a model.
create table founders (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  idx            int  not null,              -- 1 => [F1]
  name           text not null,
  email          text,
  phone          text,
  linkedin       text,
  role           text,
  background     text,                       -- redacted before any prompt
  unique (application_id, idx)
);

create table documents (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  kind           text not null check (kind in ('form', 'deck')),
  storage_path   text,
  page_count     int,
  created_at     timestamptz not null default now(),
  unique (application_id, kind)
);

create table document_pages (
  document_id uuid not null references documents (id) on delete cascade,
  page        int  not null,
  text        text not null,
  primary key (document_id, page)
);

-- ---------------------------------------------------------------------------
-- Pipeline outputs
-- ---------------------------------------------------------------------------
create table claims (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  document_id    uuid not null references documents (id) on delete cascade,
  short_id       text not null,              -- c01, c02... cited by the scorer
  metric         text not null,
  value          numeric,
  raw_value      text,
  unit           text,
  period         text,
  is_target      boolean not null default false,
  quote          text not null,              -- verbatim on its page
  page           int  not null,
  unique (application_id, short_id)
);

create table reconcile_checks (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  check_name     text not null,
  severity       text not null check (severity in ('red', 'warn', 'info')),
  formula        text not null,
  detail         text not null,
  sources        jsonb not null default '[]'
);

create table research_queries (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  purpose        text not null,              -- company | founder | conflict
  query          text not null,
  result_count   int  not null default 0,
  created_at     timestamptz not null default now()
);

create table research_findings (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  url            text not null,
  title          text,
  source_type    text check (source_type in ('primary', 'aggregator')),
  claim          text,
  quote          text,
  same_person    boolean,
  set_aside      text,                       -- reason if set aside
  created_at     timestamptz not null default now()
);

create table gate_results (
  application_id uuid not null references applications (id) on delete cascade,
  gate           text not null check (gate in ('G1', 'G2', 'G3', 'G4')),
  tripped        boolean not null,
  reason         text not null,              -- one plain line
  method         text not null check (method in ('code', 'model', 'both')),
  citations      jsonb not null default '[]',
  primary key (application_id, gate)
);

create table scores (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references applications (id) on delete cascade,
  view              text not null check (view in ('revealed', 'written')),
  criterion         text not null check (criterion in ('C1','C2','C3','C4','C5','C6')),
  score             numeric not null check (score between 0 and 10),
  confidence        text not null check (confidence in ('high', 'med', 'low')),
  rationale         text not null,
  ask               text,
  gap               text,                    -- named when evidence is missing
  citations         jsonb not null default '[]',
  rubric_version    int not null,
  prompt_version    int not null,
  created_at        timestamptz not null default now(),
  unique (application_id, view, criterion)
);

create table recommendations (
  application_id    uuid not null references applications (id) on delete cascade,
  view              text not null check (view in ('revealed', 'written')),
  weighted          numeric not null,
  recommendation    text not null check (recommendation in ('take_call', 'dig_first', 'pass')),
  lane              text not null check (lane in ('yes', 'your_call', 'no')),
  lean              text check (lean in ('yes', 'no')),
  detail            jsonb not null default '{}', -- why, yes_if, no_if, for/against, questions
  precedent_memo_id bigint,
  rubric_version    int not null,
  created_at        timestamptz not null default now(),
  primary key (application_id, view)
);

-- One row per pipeline step per application; steps are idempotent.
create table jobs (
  id             bigint generated always as identity primary key,
  application_id uuid not null references applications (id) on delete cascade,
  step           text not null,
  status         text not null check (status in ('running', 'done', 'failed')),
  attempt        int  not null default 1,
  error          text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  unique (application_id, step)
);

-- ---------------------------------------------------------------------------
-- Riya's decisions and the corrections loop
-- ---------------------------------------------------------------------------
create table decisions (
  id                     uuid primary key default gen_random_uuid(),
  application_id         uuid not null references applications (id) on delete cascade,
  decision               text not null check (decision in ('advance', 'hold', 'pass')),
  note                   text,
  decided_by             text not null,
  recommendation         text,
  against_recommendation boolean not null default false,
  created_at             timestamptz not null default now()
);

create table corrections (
  id               uuid primary key default gen_random_uuid(),
  decision_id      uuid not null references decisions (id) on delete cascade,
  redacted_summary text not null,           -- application name removed
  recommendation   text not null,
  decision         text not null,
  note             text,
  embedding        vector(1536),
  reused_count     int not null default 0,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Knowledge: memos, partner meetings, portfolio
-- ---------------------------------------------------------------------------
create table memos (
  id          bigint generated always as identity primary key,
  external_id text unique not null,         -- M01
  company     text not null,
  sector      text,
  stage       text,
  outcome     text not null check (outcome in ('invested', 'passed')),
  decided_on  date,
  sections    jsonb not null                -- {what, founder, risks, why}
);

create table meeting_notes (
  id         bigint generated always as identity primary key,
  held_on    date not null unique,
  body       text not null
);

create table knowledge_chunks (
  id          bigint generated always as identity primary key,
  source_kind text not null check (source_kind in ('memo', 'meeting')),
  source_id   bigint not null,
  section     text,
  text        text not null,                -- names already redacted
  embedding   vector(1536)
);
create index on knowledge_chunks using hnsw (embedding vector_cosine_ops);

create table portfolio (
  id          bigint generated always as identity primary key,
  name        text unique not null,
  one_liner   text not null default '',
  sector      text,
  status      text not null check (status in ('active', 'exited', 'shut down')),
  tags        text[] not null default '{}',
  source_url  text,
  source_note text,
  domain      text,
  embedding   vector(1536),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Email, threads and meetings
-- ---------------------------------------------------------------------------
create table email_drafts (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  template       text not null check (template in ('invite', 'dig', 'pass', 'follow_up')),
  version        int  not null,
  subject        text not null,
  body           text not null,
  offered_slots  jsonb not null default '[]',
  lint           jsonb not null default '[]',
  attempts       int  not null default 1,
  edited_by_riya boolean not null default false,
  status         text not null default 'draft' check (status in ('draft', 'sent')),
  created_at     timestamptz not null default now(),
  unique (application_id, template, version)
);

create table style_examples (
  id           bigint generated always as identity primary key,
  source       text not null check (source in ('sent', 'loop2_export')),
  founder_type text,
  sector       text,
  subject      text,
  body         text not null,                -- founder names masked
  embedding    vector(1536),
  created_at   timestamptz not null default now()
);

create table email_threads (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid not null references applications (id) on delete cascade,
  draft_id         uuid references email_drafts (id),
  gmail_thread_id  text unique not null,
  to_email         text not null,
  sent_at          timestamptz not null default now(),
  state            text not null default 'awaiting_reply'
                   check (state in ('awaiting_reply', 'new_times_offered', 'needs_riya', 'booked', 'closed')),
  offered_slots    jsonb not null default '[]',
  last_seen_msg_id text,
  claimed_until    timestamptz,
  claimed_by       text,
  followup_ready   boolean not null default false,
  updated_at       timestamptz not null default now()
);

create table thread_messages (
  id              bigint generated always as identity primary key,
  thread_id       uuid not null references email_threads (id) on delete cascade,
  gmail_msg_id    text unique not null,
  direction       text not null check (direction in ('in', 'out')),
  kind            text,                      -- pick | proposal | unclear | confirmation | new_times
  parsed          jsonb,
  received_at     timestamptz not null
);

create table meetings_booked (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  thread_id      uuid not null unique references email_threads (id), -- one booking per thread
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  event_id       text not null,
  hangout_link   text,
  html_link      text,
  with_partner   boolean not null default false,
  created_at     timestamptz not null default now()
);

create table oauth_tokens (
  email         text primary key,
  refresh_token text not null,
  scopes        text not null,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Model calls, cache, calibration
-- ---------------------------------------------------------------------------
create table llm_calls (
  id                bigint generated always as identity primary key,
  step              text not null,
  application_id    uuid references applications (id) on delete set null,
  model             text not null,
  prompt_tokens     int not null default 0,
  completion_tokens int not null default 0,
  cost_usd          numeric(12, 6) not null default 0,
  latency_ms        int not null default 0,
  retries           int not null default 0,
  fell_back         boolean not null default false,
  cached            boolean not null default false,
  ok                boolean not null,
  error             text,
  trace_id          text,
  created_at        timestamptz not null default now()
);
create index on llm_calls (created_at);

-- Logs are a second copy of founder data: entries expire after 30 days.
create table llm_cache (
  key        text primary key,               -- sha256(model + system + user)
  model      text not null,
  response   jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create table calibration_runs (
  id         bigint generated always as identity primary key,
  results    jsonb not null,
  report_md  text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lock everything down: no browser access at all.
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Functions (service role only)
-- ---------------------------------------------------------------------------

-- Spend since midnight IST, for the daily cap.
create function spend_today_usd() returns numeric
language sql stable as $$
  select coalesce(sum(cost_usd), 0) from llm_calls
  where created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
$$;

-- Claim a thread for one scheduler run. Returns false if someone else holds it.
create function claim_thread(p_thread uuid, p_worker text, p_seconds int default 120)
returns boolean language plpgsql as $$
declare n int;
begin
  update email_threads
     set claimed_until = now() + make_interval(secs => p_seconds), claimed_by = p_worker
   where id = p_thread and (claimed_until is null or claimed_until < now() or claimed_by = p_worker);
  get diagnostics n = row_count;
  return n = 1;
end $$;

create function release_thread(p_thread uuid, p_worker text) returns void
language sql as $$
  update email_threads set claimed_until = null, claimed_by = null
  where id = p_thread and claimed_by = p_worker;
$$;

-- Queue wrappers around pgmq.
select pgmq.create('applications');

create function queue_send(p_application uuid) returns bigint
language sql security definer set search_path = public, pgmq as $$
  select * from pgmq.send('applications', jsonb_build_object('application_id', p_application));
$$;

create function queue_read(p_vt int default 300, p_qty int default 1)
returns table (msg_id bigint, read_ct int, message jsonb)
language sql security definer set search_path = public, pgmq as $$
  select msg_id, read_ct, message from pgmq.read('applications', p_vt, p_qty);
$$;

create function queue_archive(p_msg bigint) returns boolean
language sql security definer set search_path = public, pgmq as $$
  select pgmq.archive('applications', p_msg);
$$;

-- Vector search helpers.
create function match_knowledge(p_embedding vector(1536), p_k int default 4, p_kind text default null)
returns table (id bigint, source_kind text, source_id bigint, section text, text text, similarity float)
language sql stable as $$
  select id, source_kind, source_id, section, text, 1 - (embedding <=> p_embedding)
  from knowledge_chunks
  where embedding is not null and (p_kind is null or source_kind = p_kind)
  order by embedding <=> p_embedding limit p_k;
$$;

create function match_portfolio(p_embedding vector(1536), p_k int default 18)
returns table (id bigint, name text, one_liner text, status text, similarity float)
language sql stable as $$
  select id, name, one_liner, status, 1 - (embedding <=> p_embedding)
  from portfolio where embedding is not null
  order by embedding <=> p_embedding limit p_k;
$$;

create function match_corrections(p_embedding vector(1536), p_k int default 3)
returns table (id uuid, redacted_summary text, recommendation text, decision text, note text, similarity float)
language sql stable as $$
  select id, redacted_summary, recommendation, decision, note, 1 - (embedding <=> p_embedding)
  from corrections where embedding is not null
  order by embedding <=> p_embedding limit p_k;
$$;

create function match_style_examples(p_embedding vector(1536), p_k int default 3)
returns table (id bigint, subject text, body text, similarity float)
language sql stable as $$
  select id, subject, body, 1 - (embedding <=> p_embedding)
  from style_examples where embedding is not null
  order by embedding <=> p_embedding limit p_k;
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
