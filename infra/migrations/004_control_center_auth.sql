create table if not exists control_center_users (
  id text primary key,
  email text not null unique,
  full_name text not null,
  role text not null,
  status text not null default 'active',
  password_hash text not null,
  preferences jsonb not null default '{}'::jsonb,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_control_center_users_role on control_center_users(role);
create index if not exists idx_control_center_users_status on control_center_users(status);

create table if not exists control_center_sessions (
  token text primary key,
  user_id text not null references control_center_users(id) on delete cascade,
  role text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index if not exists idx_control_center_sessions_user on control_center_sessions(user_id);
create index if not exists idx_control_center_sessions_expiry on control_center_sessions(expires_at);
