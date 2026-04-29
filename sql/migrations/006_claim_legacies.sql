-- Phase 4: claim newly earned legacies on the active character.
-- Idempotent — safe to re-run.

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

  -- Set difference: ids that aren't already on the character.
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
