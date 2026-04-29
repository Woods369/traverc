-- Phase 2: persistent characters owned by a player.
-- Idempotent — safe to re-run.

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
  total_moves    integer not null default 0,
  total_tiles    integer not null default 0,
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.characters enable row level security;

drop policy if exists characters_self_read on public.characters;
create policy characters_self_read on public.characters
  for select using (
    exists (
      select 1 from public.players p
      where p.id = characters.player_id and p.auth_user_id = auth.uid()
    )
  );

drop policy if exists characters_self_insert on public.characters;
create policy characters_self_insert on public.characters
  for insert with check (
    exists (
      select 1 from public.players p
      where p.id = characters.player_id and p.auth_user_id = auth.uid()
    )
  );

drop policy if exists characters_self_update on public.characters;
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
-- apply_run_outcome RPC: atomic aggregate update on run end
-- ---------------------------------------------------------------------------

create or replace function public.apply_run_outcome (
  p_character_id   uuid,
  p_outcome        text,
  p_total_moves    integer,
  p_tiles_explored integer,
  p_death_biome    text,
  p_beast_kills    integer,
  p_bandit_kills   integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
begin
  -- Ownership check via the auth context.
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
    )
  where id = p_character_id;
end;
$$;

grant execute on function public.apply_run_outcome (
  uuid, text, integer, integer, text, integer, integer
) to anon, authenticated;
