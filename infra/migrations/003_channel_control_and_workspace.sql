create table if not exists channel_control_peers (
  channel text not null,
  peer_id text not null,
  profile jsonb not null default '{}'::jsonb,
  last_panel text not null,
  awaiting_input_for text,
  last_session_id text,
  updated_at timestamptz not null default now(),
  primary key (channel, peer_id)
);
create index if not exists idx_channel_control_peers_updated on channel_control_peers(updated_at desc);

create table if not exists channel_control_events (
  id text primary key,
  channel text not null,
  peer_id text not null,
  kind text not null,
  label text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_channel_control_events_channel_created on channel_control_events(channel, created_at desc);
create index if not exists idx_channel_control_events_peer_created on channel_control_events(peer_id, created_at desc);

create table if not exists workspace_sync_runs (
  id text primary key,
  source text not null,
  reason text not null,
  status text not null,
  summary jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_workspace_sync_runs_created on workspace_sync_runs(created_at desc);

create table if not exists workspace_sheet_rows (
  source_key text not null,
  spreadsheet_id text not null,
  range_name text not null,
  kind text not null,
  row_id text not null,
  row_index int not null,
  title text not null,
  searchable_text text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (source_key, row_id)
);
create index if not exists idx_workspace_sheet_rows_kind on workspace_sheet_rows(kind);
create index if not exists idx_workspace_sheet_rows_updated on workspace_sheet_rows(updated_at desc);

create table if not exists workspace_calendar_events (
  source_key text not null,
  calendar_id text not null,
  event_id text not null,
  kind text not null,
  summary text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  attendees jsonb not null default '[]'::jsonb,
  searchable_text text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (source_key, event_id)
);
create index if not exists idx_workspace_calendar_events_kind on workspace_calendar_events(kind);
create index if not exists idx_workspace_calendar_events_starts on workspace_calendar_events(starts_at asc);
create index if not exists idx_workspace_calendar_events_updated on workspace_calendar_events(updated_at desc);
