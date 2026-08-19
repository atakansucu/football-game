-- ============================================================================
-- Football Duel — schema
-- Football data tables, precomputed answer tables, and game tables.
-- ============================================================================

create extension if not exists unaccent with schema extensions;

-- ----------------------------------------------------------------------------
-- Football data
-- ----------------------------------------------------------------------------

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null
);
create index if not exists players_normalized_name_idx
  on public.players (normalized_name);

create table if not exists public.player_aliases (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  alias text not null,
  normalized_alias text not null
);
create index if not exists player_aliases_normalized_idx
  on public.player_aliases (normalized_alias);

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null
);
create index if not exists clubs_normalized_name_idx
  on public.clubs (normalized_name);

create table if not exists public.national_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null
);
create index if not exists national_teams_normalized_name_idx
  on public.national_teams (normalized_name);

-- Only rows with >= 1 official first-team appearance are ever stored here.
create table if not exists public.player_club_history (
  player_id uuid not null references public.players (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  appearances int not null check (appearances >= 1),
  primary key (player_id, club_id)
);

-- Only senior national teams.
create table if not exists public.player_national_teams (
  player_id uuid not null references public.players (id) on delete cascade,
  national_team_id uuid not null references public.national_teams (id) on delete cascade,
  appearances int not null default 1 check (appearances >= 0),
  primary key (player_id, national_team_id)
);

-- ----------------------------------------------------------------------------
-- Precomputed valid answers
-- ----------------------------------------------------------------------------

create table if not exists public.country_club_answers (
  national_team_id uuid not null references public.national_teams (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  primary key (national_team_id, club_id, player_id)
);
create index if not exists country_club_answers_combo_idx
  on public.country_club_answers (national_team_id, club_id);

-- club_1_id < club_2_id is enforced so each pair is stored once.
create table if not exists public.club_club_answers (
  club_1_id uuid not null references public.clubs (id) on delete cascade,
  club_2_id uuid not null references public.clubs (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  primary key (club_1_id, club_2_id, player_id),
  check (club_1_id < club_2_id)
);
create index if not exists club_club_answers_combo_idx
  on public.club_club_answers (club_1_id, club_2_id);

-- ----------------------------------------------------------------------------
-- Game tables
-- ----------------------------------------------------------------------------

-- Lightweight profile for each anonymous auth user (no FK to auth.users so the
-- logic is testable with the service role without provisioning auth users).
create table if not exists public.users (
  id uuid primary key,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status text not null default 'waiting'
    check (status in ('waiting', 'ready', 'playing', 'finished')),
  game_mode text not null default 'national_club'
    check (game_mode in ('national_club', 'club_club')),
  win_target int not null default 5 check (win_target between 1 and 50),
  host_user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- slot in (1,2) + unique(room_id, slot) caps the room at two players.
create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  slot int not null check (slot in (1, 2)),
  display_name text not null,
  connected boolean not null default true,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (room_id, slot),
  unique (room_id, user_id)
);
create index if not exists room_players_room_idx on public.room_players (room_id);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'finished')),
  winner_user_id uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index if not exists matches_room_idx on public.matches (room_id);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  round_number int not null,
  mode text not null check (mode in ('national_club', 'club_club')),
  national_team_id uuid references public.national_teams (id),
  club_1_id uuid references public.clubs (id),
  club_2_id uuid references public.clubs (id),
  national_team_name text,
  club_1_name text,
  club_2_name text,
  state text not null default 'countdown'
    check (state in ('countdown', 'active', 'finished')),
  winner_user_id uuid references public.users (id),
  winner_submission_id uuid,
  winner_player_name text,
  activated_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (match_id, round_number)
);
create index if not exists rounds_match_idx on public.rounds (match_id);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  raw_answer text not null,
  normalized_answer text not null,
  player_id uuid references public.players (id),
  is_valid boolean not null default false,
  server_received_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default now()
);
create index if not exists submissions_round_idx on public.submissions (round_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- All writes go through SECURITY DEFINER RPCs (which bypass RLS as table
-- owner). Clients only get read access so realtime + selects work. Submissions
-- are intentionally NOT world-readable to avoid leaking opponents' attempts.
-- ----------------------------------------------------------------------------

alter table public.players enable row level security;
alter table public.player_aliases enable row level security;
alter table public.clubs enable row level security;
alter table public.national_teams enable row level security;
alter table public.player_club_history enable row level security;
alter table public.player_national_teams enable row level security;
alter table public.country_club_answers enable row level security;
alter table public.club_club_answers enable row level security;
alter table public.users enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.matches enable row level security;
alter table public.rounds enable row level security;
alter table public.submissions enable row level security;

-- Public read for football reference data.
drop policy if exists "read players" on public.players;
create policy "read players" on public.players for select using (true);
drop policy if exists "read clubs" on public.clubs;
create policy "read clubs" on public.clubs for select using (true);
drop policy if exists "read national_teams" on public.national_teams;
create policy "read national_teams" on public.national_teams for select using (true);

-- Public read for live game state (needed for realtime + reconnection).
drop policy if exists "read rooms" on public.rooms;
create policy "read rooms" on public.rooms for select using (true);
drop policy if exists "read room_players" on public.room_players;
create policy "read room_players" on public.room_players for select using (true);
drop policy if exists "read matches" on public.matches;
create policy "read matches" on public.matches for select using (true);
drop policy if exists "read rounds" on public.rounds;
create policy "read rounds" on public.rounds for select using (true);

-- ----------------------------------------------------------------------------
-- Realtime: broadcast live game tables. Submissions are excluded on purpose.
-- ----------------------------------------------------------------------------

do $$
begin
  execute 'alter publication supabase_realtime add table public.rooms';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table public.room_players';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table public.matches';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table public.rounds';
exception when duplicate_object then null;
end $$;
