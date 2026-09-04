-- 0009: indexes for the two queries that scan by time alone
--
-- Additive only. No table, column, constraint or policy changes, so nothing this
-- migration does can alter what the application returns - only how long it takes
-- to return it.
--
-- Both of these were written against small tables and both degrade linearly with
-- total rows rather than with the rows they return, which is the shape of problem
-- that is invisible in development and arrives all at once.

-- 1. ranking_items ordered by time, ignoring the user.
--
--    Two callers do this, and neither can use ranking_items_user_idx because
--    neither filters on user_id:
--
--      SupabaseDataLayer.liveFeatureSamples()  - order by created_at desc limit 2000
--      SupabaseDataLayer.adminSummary()        - order by created_at desc limit 500
--
--    The existing index is (user_id, created_at desc). With no user_id predicate
--    Postgres cannot use it for ordering, so both queries become a sequential scan
--    of every ranking_items row ever written plus a top-N sort - to return the
--    newest 2,000. At a million comparisons that is five million rows read, each
--    carrying a jsonb feature map, for a page of results.
--
--    The drift cron is the one that matters: it is a scheduled job with a request
--    timeout, so this is the query that eventually stops finishing rather than
--    merely getting slow.
create index if not exists ranking_items_created_idx
  on public.ranking_items (created_at desc);

-- 2. events filtered by time alone, for the admin funnel.
--
--      SupabaseDataLayer.adminSummary() - select name where created_at > now()-24h
--
--    events_name_created_idx is (name, created_at desc). A predicate on the
--    SECOND column of a composite index without the first is not a range scan,
--    so this reads the whole events table. events is the highest-volume table in
--    the schema by a wide margin - eleven event names, several fired per page
--    view, no retention policy - which makes it the first table where a full scan
--    becomes a timeout.
create index if not exists events_created_idx
  on public.events (created_at desc);

comment on index public.ranking_items_created_idx is
  'For time-ordered reads with no user_id predicate: drift sampling and the admin summary.';
comment on index public.events_created_idx is
  'For the 24h funnel count. The composite (name, created_at) index cannot serve a created_at-only range.';

-- NOT DONE HERE, and deliberately so: retention.
--
-- Neither of these indexes fixes the underlying growth. events and ranking_items
-- both accumulate without bound and nothing ever deletes from them, so the honest
-- next step is a retention decision - not a bigger index. That decision has a
-- product consequence (the subject lines users paste ARE the next training set,
-- which the interface says out loud) and therefore belongs in DECISIONS.md before
-- it belongs in a migration.
