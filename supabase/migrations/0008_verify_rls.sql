-- 0008: assert the security posture, rather than trusting that 0007 ran.
--
-- Run this after every migration and in CI. It raises if anything is wrong, so a
-- table added later without RLS fails loudly instead of quietly serving data to
-- the public anon key.

do $$
declare
  bad text[];
begin
  -- 1. Every public table must have RLS enabled.
  select array_agg(tablename order by tablename) into bad
  from pg_tables
  where schemaname = 'public' and not rowsecurity;

  if bad is not null then
    raise exception
      'RLS DISABLED on: %. The anon key is public and ships in the browser bundle; '
      'a table without RLS is readable by anyone who opens devtools.', bad;
  end if;

  -- 2. Every RLS-enabled table must actually have at least one policy. RLS on
  --    with no policies denies everything, which is safe but silently breaks the
  --    app - worth catching here rather than in production.
  select array_agg(t.tablename order by t.tablename) into bad
  from pg_tables t
  where t.schemaname = 'public'
    and t.rowsecurity
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = t.tablename
    );

  if bad is not null then
    raise exception 'RLS enabled but NO POLICIES on: %. These tables deny all access.', bad;
  end if;

  -- 3. No policy on a user-scoped table may be unconditionally true.
  select array_agg(p.tablename || '.' || p.policyname order by p.policyname) into bad
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('sessions','rankings','ranking_items','feedback','outcomes')
    and coalesce(p.qual, 'true') = 'true'
    and p.cmd = 'SELECT';

  if bad is not null then
    raise exception 'Unconditional SELECT policy on user-scoped table: %', bad;
  end if;

  raise notice 'RLS verification passed: all public tables protected and policied.';
end $$;
