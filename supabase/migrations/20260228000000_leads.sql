create table leads (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  handle       text not null default '',
  bio          text not null default '',
  platform     text not null,
  followers    int  not null default 0,
  following    int,
  avatar_url   text,
  profile_url  text,
  linkedin_url text,
  email        text,

  -- CRM fields
  priority     text not null default 'P1',
  dm_comfort   boolean not null default false,
  the_ask      text not null default '',
  has_dmed     boolean not null default false,
  replied      boolean not null default false,
  in_outreach  boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Upsert key: same person on same platform = same row
create unique index leads_handle_platform_idx on leads(handle, platform);
