create table if not exists customer_resolution_cases (
  id text primary key,
  customer_id text,
  matched_customer_id text,
  status text not null,
  input_name text,
  input_phone text,
  input_email text,
  duplicate_candidates jsonb not null default '[]'::jsonb,
  created_by text not null,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customer_resolution_cases_customer on customer_resolution_cases(customer_id);
create index if not exists idx_customer_resolution_cases_status on customer_resolution_cases(status);

create table if not exists customer_opportunities (
  id text primary key,
  customer_id text not null references customers(id),
  source text not null,
  status text not null,
  title text not null,
  summary text not null,
  offer_ids jsonb not null default '[]'::jsonb,
  ticket_id text,
  run_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customer_opportunities_customer on customer_opportunities(customer_id);
create index if not exists idx_customer_opportunities_status on customer_opportunities(status);
create index if not exists idx_customer_opportunities_source on customer_opportunities(source);
