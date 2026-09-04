-- 0004: feedback and outcomes
--
-- feedback = "this ranking is wrong", one click, no form. Disagreement is the
-- most valuable signal the product collects, so the control never gets a modal
-- and free text is optional.
--
-- outcomes = what actually happened when the user sent one of the lines. This is
-- how the transfer hypothesis (D-011, Q-003) eventually gets tested.

create table public.feedback (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  ranking_id       uuid not null references public.rankings(id) on delete cascade,
  ranking_item_id  uuid references public.ranking_items(id) on delete cascade,
  model_version    text not null,
  -- Optional, and genuinely optional: the click alone is a complete signal.
  comment          text check (comment is null or char_length(comment) <= 2000),
  created_at       timestamptz not null default now()
);

create index feedback_ranking_idx on public.feedback (ranking_id);
create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_model_idx   on public.feedback (model_version);

create table public.outcomes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  ranking_id       uuid not null references public.rankings(id) on delete cascade,
  sent_item_id     uuid not null references public.ranking_items(id) on delete cascade,

  list_size        int    check (list_size is null or list_size > 0),
  opens            int    check (opens is null or opens >= 0),
  clicks           int    check (clicks is null or clicks >= 0),
  provider         text,

  -- Q-004: Apple Mail Privacy Protection pre-fetches tracking pixels, so a
  -- reported open rate is measured through a distorted instrument. Recording the
  -- user's estimate of their Apple Mail share is what makes the number
  -- interpretable later; clicks are collected because they are what the training
  -- data actually measured, which keeps the two commensurable.
  apple_mail_share_estimate numeric check (
    apple_mail_share_estimate is null
    or (apple_mail_share_estimate between 0 and 1)),

  notes            text check (notes is null or char_length(notes) <= 2000),
  created_at       timestamptz not null default now(),

  constraint outcomes_have_some_signal
    check (opens is not null or clicks is not null)
);

create index outcomes_ranking_idx on public.outcomes (ranking_id);
create index outcomes_created_idx on public.outcomes (created_at desc);

comment on table public.outcomes is
  'User-reported results. The only path toward testing the transfer hypothesis in D-011.';
