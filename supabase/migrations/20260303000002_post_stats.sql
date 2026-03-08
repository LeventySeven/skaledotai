create table if not exists post_stats (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  fetched_at   timestamptz not null default now(),
  post_count   int not null default 0,
  avg_views    numeric(12,2),
  avg_likes    numeric(12,2),
  avg_replies  numeric(12,2),
  avg_retweets numeric(12,2),
  top_topics   text[],
  unique(lead_id)
);
