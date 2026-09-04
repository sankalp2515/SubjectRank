-- 0006: admin gating and helper functions
--
-- The admin route is for Sankalp, not for users (§8). Role membership lives in a
-- table rather than in a JWT claim so that revoking access takes effect on the
-- next request instead of whenever the token happens to expire.

create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so the function can read public.admins while RLS is denying
-- direct reads. search_path is pinned: without it, a caller could shadow
-- `admins` with a temp table and grant themselves the role.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

-- One-click deletion (§7). Deletes everything the caller owns.
-- Cascades handle the children, but they are listed explicitly so that adding a
-- user-scoped table without updating this function shows up in review.
create or replace function public.delete_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  deleted jsonb;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  with
    e as (delete from public.events        where user_id = uid returning 1),
    o as (delete from public.outcomes      where user_id = uid returning 1),
    f as (delete from public.feedback      where user_id = uid returning 1),
    ri as (delete from public.ranking_items where user_id = uid returning 1),
    r as (delete from public.rankings      where user_id = uid returning 1),
    s as (delete from public.sessions      where user_id = uid returning 1)
  select jsonb_build_object(
    'events',        (select count(*) from e),
    'outcomes',      (select count(*) from o),
    'feedback',      (select count(*) from f),
    'ranking_items', (select count(*) from ri),
    'rankings',      (select count(*) from r),
    'sessions',      (select count(*) from s)
  ) into deleted;

  return deleted;
end;
$$;

revoke all on function public.delete_my_data() from public;
grant execute on function public.delete_my_data() to authenticated;

comment on function public.delete_my_data() is
  'One-click deletion. Users are told plainly that their subject lines become training data; this is the other half of that bargain.';

-- Rate limiting support for /api/rank. Counts a caller's rankings in a window so
-- the API route can refuse cheaply without a separate store.
create or replace function public.rankings_in_window(window_seconds int)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.rankings
  where user_id = auth.uid()
    and created_at > now() - make_interval(secs => window_seconds);
$$;

revoke all on function public.rankings_in_window(int) from public;
grant execute on function public.rankings_in_window(int) to authenticated, anon;
