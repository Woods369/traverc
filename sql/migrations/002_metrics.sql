-- Phase 1 metrics: per-run aggregates that feed character stats and legacies.
-- Idempotent — safe to re-run.

alter table public.runs
  add column if not exists death_biome  text,
  add column if not exists total_moves  integer not null default 0,
  add column if not exists beast_kills  integer not null default 0,
  add column if not exists bandit_kills integer not null default 0;

-- death_biome is constrained to known tile types (matches src/world.ts).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'runs_death_biome_check'
  ) then
    alter table public.runs
      add constraint runs_death_biome_check check (
        death_biome is null
        or death_biome in (
          'plains','sand','forest','hills','swamp','water','mountain','shrine'
        )
      );
  end if;
end$$;

-- Refresh the leaderboard view so future UI can render kill counts +
-- step counts directly. Filter (outcome = 'win') so death_biome stays out.
create or replace view public.leaderboard_today as
  select
    r.id,
    r.seed_date,
    r.outcome,
    r.turns,
    r.tiles_explored,
    r.total_moves,
    r.beast_kills,
    r.bandit_kills,
    r.character_name,
    r.character_color,
    r.finished_at,
    p.display_name
  from public.runs r
  join public.players p on p.id = r.player_id
  where r.seed_date = current_date
    and r.outcome = 'win'
  order by r.turns asc, r.tiles_explored desc, r.finished_at asc
  limit 100;

grant select on public.leaderboard_today to anon, authenticated;
