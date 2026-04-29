-- traverc Tier 1 schema
-- Run this in the Supabase SQL editor (or via `psql`) once you've created
-- a project. Idempotent: safe to run multiple times.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.players (
  id uuid primary key default gen_random_uuid (),
  auth_user_id uuid unique references auth.users (id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 24),
  created_at timestamptz not null default now(),
  total_runs integer not null default 0,
  total_wins integer not null default 0,
  total_tiles integer not null default 0,
  longest_streak integer not null default 0,
  current_streak integer not null default 0,
  last_finished_date date
);

create table if not exists public.daily_seeds (
  seed_date date primary key,
  seed text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid (),
  player_id uuid not null references public.players (id) on delete cascade,
  seed_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null check (outcome in ('win', 'death')),
  turns integer not null check (turns >= 0),
  tiles_explored integer not null check (tiles_explored >= 0),
  character_color integer not null,
  character_name text not null check (length(character_name) between 1 and 24)
);

create index if not exists runs_seed_date_outcome_turns_idx
  on public.runs (seed_date, outcome, turns asc);

create table if not exists public.tile_notes (
  id uuid primary key default gen_random_uuid (),
  seed_date date not null,
  q integer not null,
  r integer not null,
  player_id uuid not null references public.players (id) on delete cascade,
  body text not null check (length(body) between 1 and 140),
  created_at timestamptz not null default now(),
  hearts integer not null default 0
);

create index if not exists tile_notes_seed_qr_idx
  on public.tile_notes (seed_date, q, r);

create table if not exists public.tile_visits (
  seed_date date not null,
  q integer not null,
  r integer not null,
  count integer not null default 0,
  primary key (seed_date, q, r)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.players      enable row level security;
alter table public.daily_seeds  enable row level security;
alter table public.runs         enable row level security;
alter table public.tile_notes   enable row level security;
alter table public.tile_visits  enable row level security;

-- daily_seeds: world-readable, written only by service role.
drop policy if exists daily_seeds_read on public.daily_seeds;
create policy daily_seeds_read on public.daily_seeds
  for select using (true);

-- players: a player can read their own row and update their display name.
-- Reads of other players are allowed but limited to display fields via a view.
drop policy if exists players_self_read on public.players;
create policy players_self_read on public.players
  for select using (auth.uid() = auth_user_id);

drop policy if exists players_self_insert on public.players;
create policy players_self_insert on public.players
  for insert with check (auth.uid() = auth_user_id);

drop policy if exists players_self_update on public.players;
create policy players_self_update on public.players
  for update using (auth.uid() = auth_user_id);

-- runs: a player can insert their own runs; everyone can read.
drop policy if exists runs_world_read on public.runs;
create policy runs_world_read on public.runs
  for select using (true);

drop policy if exists runs_self_insert on public.runs;
create policy runs_self_insert on public.runs
  for insert with check (
    exists (
      select 1 from public.players p
      where p.id = runs.player_id and p.auth_user_id = auth.uid()
    )
  );

-- tile_notes: world-readable, players post their own, can delete their own.
drop policy if exists tile_notes_world_read on public.tile_notes;
create policy tile_notes_world_read on public.tile_notes
  for select using (true);

drop policy if exists tile_notes_self_insert on public.tile_notes;
create policy tile_notes_self_insert on public.tile_notes
  for insert with check (
    exists (
      select 1 from public.players p
      where p.id = tile_notes.player_id and p.auth_user_id = auth.uid()
    )
  );

drop policy if exists tile_notes_self_delete on public.tile_notes;
create policy tile_notes_self_delete on public.tile_notes
  for delete using (
    exists (
      select 1 from public.players p
      where p.id = tile_notes.player_id and p.auth_user_id = auth.uid()
    )
  );

-- tile_visits: world-readable; written via RPC below.
drop policy if exists tile_visits_world_read on public.tile_visits;
create policy tile_visits_world_read on public.tile_visits
  for select using (true);

-- ---------------------------------------------------------------------------
-- Helper RPC: increment a tile_visits row atomically.
-- ---------------------------------------------------------------------------

create or replace function public.increment_tile_visit (
  p_seed_date date,
  p_q integer,
  p_r integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tile_visits (seed_date, q, r, count)
  values (p_seed_date, p_q, p_r, 1)
  on conflict (seed_date, q, r) do update set count = public.tile_visits.count + 1;
end;
$$;

grant execute on function public.increment_tile_visit (date, integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public leaderboard view: hides player_id, exposes display_name.
-- ---------------------------------------------------------------------------

create or replace view public.leaderboard_today as
  select
    r.id,
    r.seed_date,
    r.outcome,
    r.turns,
    r.tiles_explored,
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
