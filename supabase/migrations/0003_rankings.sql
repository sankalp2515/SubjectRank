-- 0003: rankings and ranking_items
--
-- One rankings row per submission; one ranking_items row per subject line.
--
-- The subject lines users paste ARE the future training set, which is the whole
-- point of collecting them. The privacy copy says so plainly and deletion is one
-- click (see 0007). Storing them quietly would not be acceptable.

create table public.rankings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  model_id         uuid references public.models(id) on delete set null,
  model_version    text not null,
  feature_spec_version int not null,

  n_lines          int not null check (n_lines between 2 and 5),
  -- Server-side latency for the inference call, so the <50ms claim in the
  -- architecture is something we measure rather than assert.
  inference_ms     numeric,
  created_at       timestamptz not null default now()
);

create index rankings_user_idx    on public.rankings (user_id, created_at desc);
create index rankings_created_idx on public.rankings (created_at desc);
create index rankings_model_idx   on public.rankings (model_version);

create table public.ranking_items (
  id                uuid primary key default gen_random_uuid(),
  ranking_id        uuid not null references public.rankings(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,

  position_in_input int  not null,
  text              text not null check (char_length(text) between 1 and 300),

  -- Extracted features, stored as {feature_name: value}. Named rather than
  -- positional: a positional array would silently mean something different after
  -- a feature_spec_version bump, and this table outlives model versions.
  features          jsonb not null,

  score             numeric not null,
  rank              int not null,
  -- P(this line beats each other line), keyed by the other line's input position.
  pairwise          jsonb not null default '{}'::jsonb,
  confidence        numeric,

  created_at        timestamptz not null default now()
);

create index ranking_items_ranking_idx on public.ranking_items (ranking_id);
create index ranking_items_user_idx    on public.ranking_items (user_id, created_at desc);

comment on column public.ranking_items.features is
  'Named feature map, not a positional array: this row outlives the feature spec that produced it.';
