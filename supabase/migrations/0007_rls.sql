-- 0007: Row Level Security
--
-- RLS on EVERY table. The anon key is public by design and ships in the browser
-- bundle; RLS is the only thing standing between it and everyone's data. A table
-- with RLS off is a data leak, not a configuration detail.
--
-- Policy shape throughout: a user may read and write rows where
-- user_id = auth.uid(), and nothing else. Service role bypasses RLS entirely and
-- is the only way the training and monitoring jobs touch these tables.

alter table public.models          enable row level security;
alter table public.sessions        enable row level security;
alter table public.rankings        enable row level security;
alter table public.ranking_items   enable row level security;
alter table public.feedback        enable row level security;
alter table public.outcomes        enable row level security;
alter table public.monitoring_runs enable row level security;
alter table public.events          enable row level security;
alter table public.admins          enable row level security;

-- Belt and braces: revoke the blanket grants Supabase gives these roles, so a
-- table added later without a policy is inaccessible rather than wide open.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;

-- --- models: public read, service-role write --------------------------------
-- The app shows which model version produced a ranking and links the model card,
-- so the registry is intentionally readable. There is no write policy at all,
-- which means nobody but the service role can insert or update.
grant select on public.models to anon, authenticated;
create policy models_public_read on public.models
  for select using (true);

-- --- sessions ---------------------------------------------------------------
grant select, insert, update on public.sessions to anon, authenticated;
create policy sessions_own_select on public.sessions
  for select using (user_id = auth.uid());
create policy sessions_own_insert on public.sessions
  for insert with check (user_id = auth.uid());
create policy sessions_own_update on public.sessions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- --- rankings ---------------------------------------------------------------
grant select, insert on public.rankings to anon, authenticated;
create policy rankings_own_select on public.rankings
  for select using (user_id = auth.uid());
create policy rankings_own_insert on public.rankings
  for insert with check (user_id = auth.uid());
-- No update, no delete: a ranking is a record of what the model said at a moment.
-- Users remove theirs via delete_my_data(), which runs as definer.

-- --- ranking_items ----------------------------------------------------------
grant select, insert on public.ranking_items to anon, authenticated;
create policy ranking_items_own_select on public.ranking_items
  for select using (user_id = auth.uid());
create policy ranking_items_own_insert on public.ranking_items
  for insert with check (
    user_id = auth.uid()
    -- The parent must also belong to the caller, or a user could attach items to
    -- someone else's ranking and read them back through the join.
    and exists (
      select 1 from public.rankings r
      where r.id = ranking_id and r.user_id = auth.uid()
    )
  );

-- --- feedback ---------------------------------------------------------------
grant select, insert on public.feedback to anon, authenticated;
create policy feedback_own_select on public.feedback
  for select using (user_id = auth.uid());
create policy feedback_own_insert on public.feedback
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.rankings r
      where r.id = ranking_id and r.user_id = auth.uid()
    )
  );

-- --- outcomes ---------------------------------------------------------------
grant select, insert, update on public.outcomes to anon, authenticated;
create policy outcomes_own_select on public.outcomes
  for select using (user_id = auth.uid());
create policy outcomes_own_insert on public.outcomes
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.rankings r
      where r.id = ranking_id and r.user_id = auth.uid()
    )
  );
-- Updatable because a user may correct a number they mistyped, and a wrong
-- outcome is worse than no outcome once these become training labels.
create policy outcomes_own_update on public.outcomes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- --- events -----------------------------------------------------------------
-- Insert-only for users: analytics you can read back is analytics you can mine.
grant insert on public.events to anon, authenticated;
grant usage, select on sequence public.events_id_seq to anon, authenticated;
create policy events_own_insert on public.events
  for insert with check (user_id = auth.uid() or user_id is null);
create policy events_admin_read on public.events
  for select using (public.is_admin());

-- --- monitoring_runs: admin read only ---------------------------------------
grant select on public.monitoring_runs to authenticated;
create policy monitoring_admin_read on public.monitoring_runs
  for select using (public.is_admin());

-- --- admins: readable only by admins ----------------------------------------
grant select on public.admins to authenticated;
create policy admins_self_read on public.admins
  for select using (public.is_admin());

-- --- admin overrides on user data -------------------------------------------
-- The admin route needs the feedback queue and ranking volume. Read only: there
-- is no reason for an admin to write a user's row, and not granting it means a
-- compromised admin session cannot forge one.
create policy rankings_admin_read on public.rankings
  for select using (public.is_admin());
create policy ranking_items_admin_read on public.ranking_items
  for select using (public.is_admin());
create policy feedback_admin_read on public.feedback
  for select using (public.is_admin());
create policy outcomes_admin_read on public.outcomes
  for select using (public.is_admin());
