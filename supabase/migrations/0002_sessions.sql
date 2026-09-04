-- 0002: sessions
--
-- Anonymous-first (§3). Supabase anonymous auth mints a real auth.users row with
-- a stable auth.uid(), so an anonymous visitor and a signed-up user are the same
-- shape here. Upgrading an anonymous account keeps the same uid, which is why
-- there is no merge step: history follows the user automatically.

create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  is_anonymous    boolean not null default true,
  upgraded_at     timestamptz,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  user_agent      text,
  -- Coarse referrer only (host, not full URL) so a shared link's query string
  -- never lands in the database.
  referrer_host   text
);

create unique index sessions_user_id_key on public.sessions (user_id);
create index sessions_last_seen_idx on public.sessions (last_seen_at desc);

comment on column public.sessions.referrer_host is
  'Host only, never the full referrer URL - query strings can carry personal data.';
