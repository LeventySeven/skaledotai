create table projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table project_leads (
  project_id uuid not null references projects(id) on delete cascade,
  lead_id    uuid not null references leads(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (project_id, lead_id)
);
