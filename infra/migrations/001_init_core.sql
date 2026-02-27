create extension if not exists pgcrypto;

create table if not exists customers (
  id text primary key,
  full_name text not null,
  phone text,
  email text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customers_phone on customers(phone);

create table if not exists assistance_tickets (
  id text primary key,
  customer_id text references customers(id),
  provisional_customer boolean not null default false,
  phone_lookup text not null,
  device_type text not null,
  issue text not null,
  diagnosis text,
  outcome text,
  inferred_signals jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists offers (
  id text primary key,
  category text not null,
  source_type text not null,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists manager_objectives (
  id text primary key,
  name text not null,
  active boolean not null default true,
  period_start timestamptz,
  period_end timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id text primary key,
  kind text not null,
  status text not null,
  assignee_role text not null,
  title text not null,
  priority int not null,
  customer_id text,
  ticket_id text,
  offer_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_tasks_kind on tasks(kind);

create table if not exists outbox_messages (
  id text primary key,
  channel text not null,
  audience text not null,
  status text not null,
  customer_id text,
  related_offer_id text,
  draft jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_outbox_status on outbox_messages(status);

create table if not exists campaigns (
  id text primary key,
  name text not null,
  offer_id text,
  segment text,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id text primary key,
  actor text not null,
  type text not null,
  payload jsonb not null,
  timestamp timestamptz not null default now()
);
create index if not exists idx_audit_type on audit_log(type);
create index if not exists idx_audit_actor on audit_log(actor);

create table if not exists admin_settings (
  key text primary key,
  category text not null,
  type text not null,
  source text not null,
  value jsonb,
  updated_at timestamptz not null default now()
);
