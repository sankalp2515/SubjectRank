-- 0005: drift monitoring and the funnel
--
-- Drift is EXPECTED to fire immediately and dramatically: 2026 email subject
-- lines do not look like 2013-2015 Upworthy headlines. That is the finding, not
-- an incident. The schema stores per-feature statistics so the shift can be
-- charted and written up rather than merely alarmed on.

create table public.monitoring_runs (
  id                uuid primary key default gen_random_uuid(),
  model_version     text not null,
  window_start      timestamptz not null,
  window_end        timestamptz not null,
  n_rankings        int not null,
  n_items           int not null,

  -- {feature_name: {psi, ks_statistic, ks_p, live_mean, live_std,
  --                 train_mean, train_std}}
  feature_stats     jsonb not null default '{}'::jsonb,

  -- Distribution of predicted pairwise probabilities. A pile-up at 0.5 means the
  -- model has stopped discriminating, which is the genuinely alarming pattern -
  -- unlike input drift, which is the expected one.
  prediction_stats  jsonb not null default '{}'::jsonb,

  -- Features whose PSI crossed the threshold, for quick reads without unpacking
  -- the jsonb.
  flagged_features  text[] not null default '{}',
  max_psi           numeric,
  notes             text,
  created_at        timestamptz not null default now()
);

create index monitoring_created_idx on public.monitoring_runs (created_at desc);
create index monitoring_model_idx   on public.monitoring_runs (model_version);

comment on table public.monitoring_runs is
  'Input drift is expected on day one. Prediction pile-up at 0.5 is the real alarm.';

-- The funnel. Deliberately narrow: an event name, an optional ranking, and a
-- small properties blob. No page URLs, no referrer query strings, no IP.
create table public.events (
  id           bigserial primary key,
  user_id      uuid references auth.users(id) on delete cascade,
  name         text not null check (name in (
                 'landed', 'example_seen', 'input_focused', 'compare_clicked',
                 'ranking_shown', 'attribution_expanded', 'disagreed',
                 'account_prompt_shown', 'account_created',
                 'outcome_prompt_shown', 'outcome_reported'
               )),
  ranking_id   uuid references public.rankings(id) on delete set null,
  properties   jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index events_name_created_idx on public.events (name, created_at desc);
create index events_user_idx         on public.events (user_id, created_at desc);

comment on column public.events.name is
  'Closed enum. A new event needs a migration, which is the point: it forces a decision about what is worth recording.';
