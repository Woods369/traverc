-- Phase 3: extend apply_run_outcome to credit XP and recompute level.
-- The level thresholds here MUST stay in sync with src/leveling.ts.
-- Idempotent — safe to re-run.

drop function if exists public.apply_run_outcome (
  uuid, text, integer, integer, text, integer, integer
);

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
