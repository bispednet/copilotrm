create table if not exists channel_dispatches (
  id text primary key,
  source text not null,
  draft_id text,
  channel text not null,
  status text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists idx_channel_dispatches_status on channel_dispatches(status);
create index if not exists idx_channel_dispatches_channel on channel_dispatches(channel);

create table if not exists media_jobs (
  id text primary key,
  kind text not null,
  title text not null,
  brief text not null,
  channel text,
  status text not null,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists idx_media_jobs_status on media_jobs(status);
create index if not exists idx_media_jobs_kind on media_jobs(kind);
