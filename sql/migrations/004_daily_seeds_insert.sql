-- Phase 0/2 hotfix: clients self-seed today's daily_seeds row when none
-- exists. The original schema only allowed SELECT, so the insert returned
-- 403. Allow any authenticated user (including anonymous sessions) to
-- insert ONLY today's row. The seed value is deterministic
-- (`daily-YYYY-MM-DD`) so the first writer wins and subsequent reads
-- return a stable seed for everyone.
--
-- Idempotent — safe to re-run.

drop policy if exists daily_seeds_self_insert on public.daily_seeds;
create policy daily_seeds_self_insert on public.daily_seeds
  for insert
  with check (
    auth.uid() is not null
    and seed_date = current_date
  );
