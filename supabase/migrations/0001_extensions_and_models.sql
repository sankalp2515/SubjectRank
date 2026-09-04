-- 0001: extensions + the model registry
--
-- The models table is not user-scoped and is deliberately readable by everyone:
-- the app shows which model version produced a ranking, and the model card is
-- public. Writes are service-role only.

create extension if not exists "pgcrypto";

create type model_status as enum ('champion', 'challenger', 'archived');

create table public.models (
  id                    uuid primary key default gen_random_uuid(),
  version               text not null unique,
  feature_spec_version  int  not null,
  algorithm             text not null,
  status                model_status not null default 'challenger',

  -- Metrics, stored as the run report emitted them. Kept as jsonb rather than
  -- flattened columns because the metric set will change and a schema migration
  -- per metric is worse than a documented shape.
  metrics               jsonb not null default '{}'::jsonb,
  hyperparameters       jsonb not null default '{}'::jsonb,

  -- Provenance. n_training_pairs/n_training_tests are the honest corpus size and
  -- are what MODEL_CARD.md and the app footer quote (Q-001).
  n_training_pairs      int,
  n_training_tests      int,
  training_subsets      text[],
  z_test_alpha          numeric,

  -- Features the model actually uses. Excluded features (D-012) are recorded so
  -- the UI can be certain never to attribute anything to them.
  feature_names         text[] not null,
  excluded_features     text[] not null default '{}',

  artifact_path         text,
  artifact_sha256       text,
  notes                 text,
  created_at            timestamptz not null default now(),
  promoted_at           timestamptz
);

-- At most one champion at a time. Enforced by the database rather than by
-- application discipline, because "two champions" is the kind of bug that only
-- shows up as inconsistent predictions between requests.
create unique index models_one_champion
  on public.models ((status))
  where status = 'champion';

create index models_created_at_idx on public.models (created_at desc);

comment on table public.models is
  'Model registry. Exactly one champion enforced by partial unique index.';
