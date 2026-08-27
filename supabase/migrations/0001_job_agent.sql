-- Job-hunting agent: Gmail scanning, review/approval queue, CV generation.
create extension if not exists pgcrypto;

-- Single-row table holding the Gmail OAuth refresh token for the mailbox being scanned.
create table if not exists gmail_tokens (
  id int primary key default 1,
  email text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  updated_at timestamptz default now(),
  constraint gmail_tokens_singleton check (id = 1)
);

-- Single-row table replicating the "CV creation" Claude project: its instructions
-- (system prompt) plus the base resume/knowledge it works from. Edited from the UI.
create table if not exists cv_profile (
  id int primary key default 1,
  instructions text not null default '',
  base_resume text not null default '',
  updated_at timestamptz default now(),
  constraint cv_profile_singleton check (id = 1)
);
insert into cv_profile (id, instructions, base_resume)
values (1, '', '')
on conflict (id) do nothing;

create table if not exists job_offers (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text unique not null,
  gmail_thread_id text,
  received_at timestamptz,
  from_email text,
  subject text,
  snippet text,
  body_text text,
  apply_links jsonb not null default '[]'::jsonb,
  apply_email text,
  company text,
  role text,
  -- new -> digested -> approved|rejected -> cv_generated -> drafted|manual_apply_needed -> applied
  status text not null default 'new',
  action_token text,
  generated_cv text,
  generated_cover_note text,
  gmail_draft_id text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists job_offers_status_idx on job_offers (status);
create index if not exists job_offers_received_at_idx on job_offers (received_at desc);
