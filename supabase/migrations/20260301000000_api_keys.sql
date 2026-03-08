create table api_keys (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  key_hash   text not null unique,
  prefix     text not null,
  created_at timestamptz not null default now(),
  last_used  timestamptz
);
