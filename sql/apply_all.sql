-- traverc: one-shot consolidated migration.
-- Safe to run on a fresh project after `sql/schema.sql`, AND safe to re-run
-- on a project where some-but-not-all migrations were applied. Brings the
-- database to the current code's expected schema.
--
-- This file folds in: 002_metrics + 003_characters + 004_daily_seeds_insert
-- + 005_xp_levels + 006_claim_legacies.
--
-- Run after sql/schema.sql.

-- ---------------------------------------------------------------------------
-- runs: metric columns + death_biome check
-- ---------------------------------------------------------------------------

alter table public.runs
  add column if not exists death_biome  text,
  add column if not exists total_moves  integer not null default 0,
  add column if not exists beast_kills  integer not null default 0,
  add column if not exists bandit_kills integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'runs_death_biome_check'
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

-- ---------------------------------------------------------------------------
-- characters table + RLS + runs.character_id
-- ---------------------------------------------------------------------------

create table if not exists public.characters (
  id              uuid primary key default gen_random_uuid (),
  player_id       uuid not null references public.players (id) on delete cascade,
  name            text not null check (length(name) between 1 and 24),
  color           integer not null,
  level           integer not null default 1 check (level between 1 and 99),
  xp              integer not null default 0 check (xp >= 0),
  retired         boolean not null default false,
  created_at      timestamptz not null default now(),
  total_runs      integer not null default 0,
  total_wins      integer not null default 0,
  total_deaths    integer not null default 0,
  total_moves     integer not null default 0,
  total_tiles     integer not null default 0,
  biome_deaths    jsonb not null default '{}'::jsonb,
  encounter_kills jsonb not null default '{"beast":0,"bandit":0}'::jsonb,
  current_streak  integer not null default 0,
  longest_streak  integer not null default 0,
  earned_legacies text[] not null default '{}'
);

create index if not exists characters_player_active_idx
  on public.characters (player_id) where (retired = false);

alter table public.runs
  add column if not exists character_id uuid references public.characters (id) on delete set null;

alter table public.characters enable row level security;

drop policy if exists characters_self_read   on public.characters;
drop policy if exists characters_self_insert on public.characters;
drop policy if exists characters_self_update on public.characters;

create policy characters_self_read on public.characters
  for select using (
    exists (
      select 1 from public.players p
      where p.id = characters.player_id and p.auth_user_id = auth.uid()
    )
  );

create policy characters_self_insert on public.characters
  for insert with check (
    exists (
      select 1 from public.players p
      where p.id = characters.player_id and p.auth_user_id = auth.uid()
    )
  );

create policy characters_self_update on public.characters
  for update using (
    exists (
      select 1 from public.players p
      where p.id = characters.player_id and p.auth_user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.players p
      where p.id = characters.player_id and p.auth_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- daily_seeds: client-self-insert policy for today's row
-- ---------------------------------------------------------------------------

drop policy if exists daily_seeds_self_insert on public.daily_seeds;
create policy daily_seeds_self_insert on public.daily_seeds
  for insert with check (
    auth.uid() is not null and seed_date = current_date
  );

-- ---------------------------------------------------------------------------
-- leaderboard_today view (refreshed with new columns)
-- ---------------------------------------------------------------------------

drop view if exists public.leaderboard_today;
create view public.leaderboard_today as
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

-- ---------------------------------------------------------------------------
-- apply_run_outcome — drop ALL overloads then create the 8-arg version.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_run_outcome'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end$$;

create or replace function public.apply_run_outcome (
  p_character_id   uuid,
  p_outcome        text,
  p_total_moves    integer,
  p_tiles_explored integer,
  p_death_biome    text,
  p_beast_kills    integer,
  p_bandit_kills   integer,
  p_xp_award       integer default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
begin
  select c.player_id into v_player_id
  from public.characters c
  join public.players p on p.id = c.player_id
  where c.id = p_character_id and p.auth_user_id = auth.uid();

  if v_player_id is null then
    raise exception 'character not found or not owned by current user';
  end if;

  update public.characters set
    total_runs   = total_runs + 1,
    total_moves  = total_moves + coalesce(p_total_moves, 0),
    total_tiles  = total_tiles + coalesce(p_tiles_explored, 0),
    total_wins   = total_wins   + (case when p_outcome = 'win'   then 1 else 0 end),
    total_deaths = total_deaths + (case when p_outcome = 'death' then 1 else 0 end),
    current_streak = case
      when p_outcome = 'win'   then current_streak + 1
      else 0
    end,
    longest_streak = greatest(
      longest_streak,
      case when p_outcome = 'win' then current_streak + 1 else longest_streak end
    ),
    biome_deaths = case
      when p_outcome = 'death' and p_death_biome is not null then
        jsonb_set(
          biome_deaths,
          array[p_death_biome],
          to_jsonb(coalesce((biome_deaths->>p_death_biome)::int, 0) + 1),
          true
        )
      else biome_deaths
    end,
    encounter_kills = encounter_kills || jsonb_build_object(
      'beast',
      coalesce((encounter_kills->>'beast')::int, 0) + coalesce(p_beast_kills, 0),
      'bandit',
      coalesce((encounter_kills->>'bandit')::int, 0) + coalesce(p_bandit_kills, 0)
    ),
    xp = xp + greatest(0, coalesce(p_xp_award, 0)),
    level = case
      when xp + greatest(0, coalesce(p_xp_award, 0)) >= 4500 then 10
      when xp + greatest(0, coalesce(p_xp_award, 0)) >= 3600 then 9
      when xp + greatest(0, coalesce(p_xp_award, 0)) >= 2800 then 8
      when xp + greatest(0, coalesce(p_xp_award, 0)) >= 2100 then 7
      when xp + greatest(0, coalesce(p_xp_award, 0)) >= 1500 then 6
      when xp + greatest(0, coalesce(p_xp_award, 0)) >= 1000 then 5
      when xp + greatest(0, coalesce(p_xp_award, 0)) >= 600  then 4
      when xp + greatest(0, coalesce(p_xp_award, 0)) >= 300  then 3
      when xp + greatest(0, coalesce(p_xp_award, 0)) >= 100  then 2
      else 1
    end
  where id = p_character_id;
end;
$$;

grant execute on function public.apply_run_outcome (
  uuid, text, integer, integer, text, integer, integer, integer
) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_legacies — append earned legacy ids on the active character.
-- ---------------------------------------------------------------------------

create or replace function public.claim_legacies (
  p_character_id uuid,
  p_legacy_ids   text[]
) returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_existing  text[];
  v_added     text[];
begin
  select c.player_id, c.earned_legacies
    into v_player_id, v_existing
  from public.characters c
  join public.players p on p.id = c.player_id
  where c.id = p_character_id and p.auth_user_id = auth.uid();

  if v_player_id is null then
    raise exception 'character not found or not owned by current user';
  end if;

  v_added := coalesce(
    array(
      select x from unnest(coalesce(p_legacy_ids, '{}'::text[])) x
      except
      select y from unnest(coalesce(v_existing, '{}'::text[])) y
    ),
    '{}'::text[]
  );

  if array_length(v_added, 1) is null then
    return '{}'::text[];
  end if;

  update public.characters
  set earned_legacies = coalesce(earned_legacies, '{}'::text[]) || v_added
  where id = p_character_id;

  return v_added;
end;
$$;

grant execute on function public.claim_legacies (uuid, text[]) to anon, authenticated;

-- Schema cache reload hint to PostgREST (forces immediate refresh).
notify pgrst, 'reload schema';
