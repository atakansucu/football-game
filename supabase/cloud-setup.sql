-- Football Duel — tek seferde cloud kurulum (0001..0006 + seed)
-- Supabase Dashboard > SQL Editor icine yapistirip Run edin. Tekrar calistirilabilir (idempotent).

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
-- ============================================================================
-- Football Duel — functions & RPCs
-- The database is the single source of truth. Winners are assigned atomically
-- under a row lock so two simultaneous correct answers can never both win.
-- ============================================================================

-- Mirrors src/lib/football/normalize.ts exactly.
create or replace function public.normalize_name(input text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(extensions.unaccent(coalesce(input, ''))),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

-- Auto-populate normalized columns so plain inserts (seed, imports) always
-- satisfy the NOT NULL constraint and stay consistent with the game's rules.
create or replace function public.set_normalized_name()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.normalized_name := public.normalize_name(new.name);
  return new;
end;
$$;

create or replace function public.set_normalized_alias()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.normalized_alias := public.normalize_name(new.alias);
  return new;
end;
$$;

create or replace trigger players_set_normalized
  before insert or update of name on public.players
  for each row execute function public.set_normalized_name();

create or replace trigger clubs_set_normalized
  before insert or update of name on public.clubs
  for each row execute function public.set_normalized_name();

create or replace trigger national_teams_set_normalized
  before insert or update of name on public.national_teams
  for each row execute function public.set_normalized_name();

create or replace trigger player_aliases_set_normalized
  before insert or update of alias on public.player_aliases
  for each row execute function public.set_normalized_alias();

-- Whether a player is a valid answer for a given round's challenge.
create or replace function public.pl_is_valid_for_round(
  p_player uuid,
  p_round public.rounds
)
returns boolean
language sql
stable
as $$
  select case
    when p_round.mode = 'national_club' then
      exists (
        select 1 from public.player_national_teams pnt
        where pnt.player_id = p_player
          and pnt.national_team_id = p_round.national_team_id
      )
      and exists (
        select 1 from public.player_club_history pch
        where pch.player_id = p_player
          and pch.club_id = p_round.club_1_id
          and pch.appearances >= 1
      )
    else
      exists (
        select 1 from public.player_club_history a
        where a.player_id = p_player
          and a.club_id = p_round.club_1_id
          and a.appearances >= 1
      )
      and exists (
        select 1 from public.player_club_history b
        where b.player_id = p_player
          and b.club_id = p_round.club_2_id
          and b.appearances >= 1
      )
  end;
$$;

-- Per-condition breakdown, used for player-only feedback on wrong answers.
create or replace function public.pl_checks_for_round(
  p_player uuid,
  p_round public.rounds
)
returns json
language sql
stable
as $$
  select case
    when p_round.mode = 'national_club' then
      json_build_object(
        'national_team', exists (
          select 1 from public.player_national_teams pnt
          where pnt.player_id = p_player
            and pnt.national_team_id = p_round.national_team_id
        ),
        'club', exists (
          select 1 from public.player_club_history pch
          where pch.player_id = p_player
            and pch.club_id = p_round.club_1_id
            and pch.appearances >= 1
        )
      )
    else
      json_build_object(
        'club_a', exists (
          select 1 from public.player_club_history a
          where a.player_id = p_player
            and a.club_id = p_round.club_1_id
            and a.appearances >= 1
        ),
        'club_b', exists (
          select 1 from public.player_club_history b
          where b.player_id = p_player
            and b.club_id = p_round.club_2_id
            and b.appearances >= 1
        )
      )
  end;
$$;

-- ----------------------------------------------------------------------------
-- Room lifecycle
-- ----------------------------------------------------------------------------

create or replace function public.gen_room_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  i int;
begin
  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.create_room(
  p_user_id uuid,
  p_display_name text,
  p_game_mode text,
  p_win_target int
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_code text := public.gen_room_code();
  v_room_id uuid;
begin
  insert into public.users (id, display_name)
  values (v_user, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  insert into public.rooms (code, status, game_mode, win_target, host_user_id)
  values (v_code, 'waiting', coalesce(p_game_mode, 'national_club'),
          coalesce(p_win_target, 5), v_user)
  returning id into v_room_id;

  insert into public.room_players (room_id, user_id, slot, display_name)
  values (v_room_id, v_user, 1, p_display_name);

  return json_build_object('status', 'ok', 'room_id', v_room_id, 'code', v_code);
end;
$$;

create or replace function public.join_room(
  p_user_id uuid,
  p_display_name text,
  p_code text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_room public.rooms;
  v_slot int;
  v_count int;
begin
  select * into v_room from public.rooms where upper(code) = upper(btrim(p_code));
  if not found then
    return json_build_object('status', 'not_found');
  end if;

  insert into public.users (id, display_name)
  values (v_user, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  -- Already a member? Return current slot (reconnect).
  select slot into v_slot from public.room_players
  where room_id = v_room.id and user_id = v_user;
  if found then
    update public.room_players
      set connected = true, last_seen = now()
      where room_id = v_room.id and user_id = v_user;
    return json_build_object('status', 'ok', 'room_id', v_room.id,
                             'code', v_room.code, 'slot', v_slot);
  end if;

  select count(*) into v_count from public.room_players where room_id = v_room.id;
  if v_count >= 2 then
    return json_build_object('status', 'full');
  end if;

  select s into v_slot
  from (values (1), (2)) as t(s)
  where s not in (select slot from public.room_players where room_id = v_room.id)
  order by s
  limit 1;

  insert into public.room_players (room_id, user_id, slot, display_name)
  values (v_room.id, v_user, v_slot, p_display_name);

  update public.rooms set status = 'ready'
  where id = v_room.id
    and (select count(*) from public.room_players where room_id = v_room.id) = 2;

  return json_build_object('status', 'ok', 'room_id', v_room.id,
                           'code', v_room.code, 'slot', v_slot);
end;
$$;

create or replace function public.set_room_settings(
  p_user_id uuid,
  p_room_id uuid,
  p_game_mode text,
  p_win_target int
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_updated int;
begin
  update public.rooms
    set game_mode = coalesce(p_game_mode, game_mode),
        win_target = coalesce(p_win_target, win_target)
  where id = p_room_id
    and host_user_id = v_user
    and status in ('waiting', 'ready');
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return json_build_object('status', 'forbidden');
  end if;
  return json_build_object('status', 'ok');
end;
$$;

create or replace function public.heartbeat(
  p_user_id uuid,
  p_room_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
begin
  update public.room_players
    set connected = true, last_seen = now()
  where room_id = p_room_id and user_id = v_user;
  return json_build_object('status', 'ok');
end;
$$;

-- ----------------------------------------------------------------------------
-- Rounds: challenge selection guarantees at least one valid answer.
-- ----------------------------------------------------------------------------

create or replace function public.create_round(
  p_match_id uuid,
  p_mode text,
  p_round_number int
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_round_id uuid;
  v_nt uuid;
  v_c1 uuid;
  v_c2 uuid;
begin
  if p_mode = 'national_club' then
    -- Prefer combinations with >= 2 answers, exclude ones already played.
    select s.national_team_id, s.club_id into v_nt, v_c1
    from (
      select national_team_id, club_id, count(*) c
      from public.country_club_answers
      group by national_team_id, club_id
    ) s
    where (s.national_team_id, s.club_id) not in (
      select national_team_id, club_1_id from public.rounds
      where match_id = p_match_id and mode = 'national_club'
        and national_team_id is not null and club_1_id is not null
    )
    order by (s.c >= 2) desc, random()
    limit 1;

    if v_nt is null then
      -- Everything already played; fall back to any playable combo.
      select s.national_team_id, s.club_id into v_nt, v_c1
      from (
        select national_team_id, club_id, count(*) c
        from public.country_club_answers
        group by national_team_id, club_id
      ) s
      order by (s.c >= 2) desc, random()
      limit 1;
    end if;

    if v_nt is null then
      raise exception 'No playable national_club challenge available';
    end if;

    insert into public.rounds (
      match_id, round_number, mode, national_team_id, club_1_id,
      national_team_name, club_1_name, state, activated_at
    )
    values (
      p_match_id, p_round_number, 'national_club', v_nt, v_c1,
      (select name from public.national_teams where id = v_nt),
      (select name from public.clubs where id = v_c1),
      'countdown', now() + interval '3 seconds'
    )
    returning id into v_round_id;
  else
    select s.club_1_id, s.club_2_id into v_c1, v_c2
    from (
      select club_1_id, club_2_id, count(*) c
      from public.club_club_answers
      group by club_1_id, club_2_id
    ) s
    where (s.club_1_id, s.club_2_id) not in (
      select club_1_id, club_2_id from public.rounds
      where match_id = p_match_id and mode = 'club_club'
        and club_1_id is not null and club_2_id is not null
    )
    order by (s.c >= 2) desc, random()
    limit 1;

    if v_c1 is null then
      select s.club_1_id, s.club_2_id into v_c1, v_c2
      from (
        select club_1_id, club_2_id, count(*) c
        from public.club_club_answers
        group by club_1_id, club_2_id
      ) s
      order by (s.c >= 2) desc, random()
      limit 1;
    end if;

    if v_c1 is null then
      raise exception 'No playable club_club challenge available';
    end if;

    insert into public.rounds (
      match_id, round_number, mode, club_1_id, club_2_id,
      club_1_name, club_2_name, state, activated_at
    )
    values (
      p_match_id, p_round_number, 'club_club', v_c1, v_c2,
      (select name from public.clubs where id = v_c1),
      (select name from public.clubs where id = v_c2),
      'countdown', now() + interval '3 seconds'
    )
    returning id into v_round_id;
  end if;

  return v_round_id;
end;
$$;

-- Host-only guard shared by start/play-again.
create or replace function public.assert_host(p_user uuid, p_room_id uuid)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.rooms where id = p_room_id and host_user_id = p_user
  ) then
    raise exception 'Only the host can perform this action';
  end if;
end;
$$;

create or replace function public.start_match(
  p_user_id uuid,
  p_room_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_mode text;
  v_players int;
  v_match_id uuid;
  v_round_id uuid;
begin
  perform public.assert_host(v_user, p_room_id);

  select count(*) into v_players from public.room_players where room_id = p_room_id;
  if v_players < 2 then
    return json_build_object('status', 'not_enough_players');
  end if;

  select game_mode into v_mode from public.rooms where id = p_room_id;

  update public.rooms set status = 'playing' where id = p_room_id;

  insert into public.matches (room_id, status)
  values (p_room_id, 'active')
  returning id into v_match_id;

  v_round_id := public.create_round(v_match_id, v_mode, 1);

  return json_build_object('status', 'ok', 'match_id', v_match_id,
                           'round_id', v_round_id);
end;
$$;

create or replace function public.start_round(
  p_user_id uuid,
  p_room_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_match public.matches;
  v_mode text;
  v_num int;
  v_existing uuid;
  v_round_id uuid;
begin
  perform public.assert_host(v_user, p_room_id);

  select * into v_match from public.matches
  where room_id = p_room_id and status = 'active'
  order by created_at desc
  limit 1;
  if not found then
    return json_build_object('status', 'no_active_match');
  end if;

  -- If a non-finished round already exists, return it (idempotent).
  select id into v_existing from public.rounds
  where match_id = v_match.id and state <> 'finished'
  order by round_number desc
  limit 1;
  if found then
    return json_build_object('status', 'ok', 'match_id', v_match.id,
                             'round_id', v_existing);
  end if;

  select game_mode into v_mode from public.rooms where id = p_room_id;
  select coalesce(max(round_number), 0) + 1 into v_num
  from public.rounds where match_id = v_match.id;

  v_round_id := public.create_round(v_match.id, v_mode, v_num);
  return json_build_object('status', 'ok', 'match_id', v_match.id,
                           'round_id', v_round_id);
end;
$$;

-- Flips due countdown rounds to active. Any client may call this at t=0 so both
-- devices switch to the input UI via realtime at the same time.
create or replace function public.activate_due_rounds()
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count int;
begin
  update public.rounds
    set state = 'active'
  where state = 'countdown'
    and activated_at is not null
    and now() >= activated_at;
  get diagnostics v_count = row_count;
  return json_build_object('status', 'ok', 'activated', v_count);
end;
$$;

-- ----------------------------------------------------------------------------
-- The authoritative, race-safe answer submission.
-- ----------------------------------------------------------------------------

create or replace function public.submit_answer(
  p_user_id uuid,
  p_round_id uuid,
  p_raw_answer text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_round public.rounds;
  v_norm text := public.normalize_name(p_raw_answer);
  v_candidates uuid[];
  v_player_id uuid;
  v_player_name text;
  v_is_valid boolean := false;
  v_checks json := null;
  v_valid_count int;
  v_valid_pid uuid;
  v_sub_id uuid;
  v_win_target int;
  v_winner_wins int;
  v_room_id uuid;
begin
  -- Lock the round so concurrent submissions are serialized.
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    return json_build_object('status', 'round_not_active', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  -- Reject if already decided or still counting down.
  if v_round.state = 'finished' or v_round.winner_user_id is not null then
    return json_build_object('status', 'round_not_active', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', v_round.winner_user_id);
  end if;
  if v_round.activated_at is null or now() < v_round.activated_at then
    return json_build_object('status', 'round_not_active', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  -- Self-heal: the countdown is over, so the round is active now.
  if v_round.state = 'countdown' then
    update public.rounds set state = 'active' where id = p_round_id;
    v_round.state := 'active';
  end if;

  -- Resolve candidates: exact full-name first, else alias.
  select array_agg(id) into v_candidates
  from public.players where normalized_name = v_norm;

  if v_candidates is null then
    select array_agg(distinct player_id) into v_candidates
    from public.player_aliases where normalized_alias = v_norm;
  end if;

  if v_candidates is null then
    -- No player recognized at all.
    insert into public.submissions (round_id, user_id, raw_answer,
      normalized_answer, player_id, is_valid)
    values (p_round_id, v_user, p_raw_answer, v_norm, null, false);
    return json_build_object('status', 'incorrect', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  if array_length(v_candidates, 1) = 1 then
    v_player_id := v_candidates[1];
  else
    -- Disambiguate: accept only if exactly one candidate is valid.
    select count(*), min(pid) into v_valid_count, v_valid_pid
    from unnest(v_candidates) as pid
    where public.pl_is_valid_for_round(pid, v_round);

    if v_valid_count = 1 then
      v_player_id := v_valid_pid;
    else
      insert into public.submissions (round_id, user_id, raw_answer,
        normalized_answer, player_id, is_valid)
      values (p_round_id, v_user, p_raw_answer, v_norm, null, false);
      return json_build_object('status', 'ambiguous', 'is_correct', false,
        'player_name', null, 'checks', null, 'round_id', p_round_id,
        'winner_user_id', null);
    end if;
  end if;

  v_is_valid := public.pl_is_valid_for_round(v_player_id, v_round);
  v_checks := public.pl_checks_for_round(v_player_id, v_round);
  select name into v_player_name from public.players where id = v_player_id;

  insert into public.submissions (round_id, user_id, raw_answer,
    normalized_answer, player_id, is_valid)
  values (p_round_id, v_user, p_raw_answer, v_norm, v_player_id, v_is_valid)
  returning id into v_sub_id;

  if not v_is_valid then
    return json_build_object('status', 'incorrect', 'is_correct', false,
      'player_name', v_player_name, 'checks', v_checks, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  -- Valid answer. Atomically claim the win only if nobody has yet.
  update public.rounds
    set winner_user_id = v_user,
        winner_submission_id = v_sub_id,
        winner_player_name = v_player_name,
        state = 'finished',
        finished_at = now()
  where id = p_round_id and winner_user_id is null;

  if not found then
    -- Someone else won in the meantime (shouldn't happen under the lock).
    return json_build_object('status', 'correct_but_late', 'is_correct', true,
      'player_name', v_player_name, 'checks', v_checks, 'round_id', p_round_id,
      'winner_user_id', (select winner_user_id from public.rounds where id = p_round_id));
  end if;

  -- Update match score / completion.
  select r.win_target, m.room_id into v_win_target, v_room_id
  from public.matches m join public.rooms r on r.id = m.room_id
  where m.id = v_round.match_id;

  select count(*) into v_winner_wins
  from public.rounds
  where match_id = v_round.match_id and winner_user_id = v_user;

  if v_winner_wins >= v_win_target then
    update public.matches set status = 'finished', winner_user_id = v_user
    where id = v_round.match_id;
    update public.rooms set status = 'finished' where id = v_room_id;
  end if;

  return json_build_object('status', 'won', 'is_correct', true,
    'player_name', v_player_name, 'checks', v_checks, 'round_id', p_round_id,
    'winner_user_id', v_user);
end;
$$;

create or replace function public.play_again(
  p_user_id uuid,
  p_room_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_mode text;
  v_match_id uuid;
  v_round_id uuid;
begin
  perform public.assert_host(v_user, p_room_id);

  -- Close any lingering active match.
  update public.matches set status = 'finished'
  where room_id = p_room_id and status = 'active';

  select game_mode into v_mode from public.rooms where id = p_room_id;
  update public.rooms set status = 'playing' where id = p_room_id;

  insert into public.matches (room_id, status)
  values (p_room_id, 'active')
  returning id into v_match_id;

  v_round_id := public.create_round(v_match_id, v_mode, 1);

  return json_build_object('status', 'ok', 'match_id', v_match_id,
                           'round_id', v_round_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants: allow anon + authenticated clients to call the RPCs.
-- ----------------------------------------------------------------------------

grant execute on function public.create_room(uuid, text, text, int) to anon, authenticated;
grant execute on function public.join_room(uuid, text, text) to anon, authenticated;
grant execute on function public.set_room_settings(uuid, uuid, text, int) to anon, authenticated;
grant execute on function public.heartbeat(uuid, uuid) to anon, authenticated;
grant execute on function public.start_match(uuid, uuid) to anon, authenticated;
grant execute on function public.start_round(uuid, uuid) to anon, authenticated;
grant execute on function public.activate_due_rounds() to anon, authenticated;
grant execute on function public.submit_answer(uuid, uuid, text) to anon, authenticated;
grant execute on function public.play_again(uuid, uuid) to anon, authenticated;
-- ============================================================================
-- Football Duel — precomputed answer rebuild
-- Call public.rebuild_answers() after importing/seeding football data. It
-- derives the playable answer tables purely from the base relations, using only
-- official first-team appearances (appearances >= 1) and senior national teams.
-- ============================================================================

create or replace function public.rebuild_answers()
returns json
language plpgsql
set search_path = public, extensions
as $$
declare
  v_cc int;
  v_clubclub int;
begin
  truncate table public.country_club_answers;
  truncate table public.club_club_answers;

  -- National team x Club: represented the national team AND >= 1 club appearance.
  insert into public.country_club_answers (national_team_id, club_id, player_id)
  select distinct pnt.national_team_id, pch.club_id, pnt.player_id
  from public.player_national_teams pnt
  join public.player_club_history pch on pch.player_id = pnt.player_id
  where pch.appearances >= 1;

  -- Club x Club: >= 1 appearance for both clubs, canonical order club_1 < club_2.
  insert into public.club_club_answers (club_1_id, club_2_id, player_id)
  select distinct
    least(a.club_id, b.club_id),
    greatest(a.club_id, b.club_id),
    a.player_id
  from public.player_club_history a
  join public.player_club_history b
    on a.player_id = b.player_id and a.club_id < b.club_id
  where a.appearances >= 1 and b.appearances >= 1;

  select count(*) into v_cc from public.country_club_answers;
  select count(*) into v_clubclub from public.club_club_answers;

  return json_build_object(
    'status', 'ok',
    'country_club_answers', v_cc,
    'club_club_answers', v_clubclub
  );
end;
$$;

grant execute on function public.rebuild_answers() to anon, authenticated;
-- ============================================================================
-- Football Duel — lookup / explorer RPCs
-- These power the /lookup page. They read the SAME source of truth as the game
-- (the precomputed answer tables + player_club_history / player_national_teams),
-- so there is no separate lookup-specific football logic.
-- ============================================================================

-- All players valid for a National Team x Club combination, with the player's
-- national teams and their appearance count for the selected club.
create or replace function public.get_players_for_country_club(
  p_national_team_id uuid,
  p_club_id uuid
)
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(json_agg(row_to_json(t) order by t.name), '[]'::json)
  from (
    select
      p.id as player_id,
      p.name,
      (
        select coalesce(json_agg(nt.name order by nt.name), '[]'::json)
        from public.player_national_teams pn
        join public.national_teams nt on nt.id = pn.national_team_id
        where pn.player_id = p.id
      ) as national_teams,
      json_build_array(
        json_build_object('name', c.name, 'appearances', pch.appearances)
      ) as clubs
    from public.country_club_answers a
    join public.players p on p.id = a.player_id
    join public.clubs c on c.id = a.club_id
    join public.player_club_history pch
      on pch.player_id = p.id and pch.club_id = a.club_id
    where a.national_team_id = p_national_team_id
      and a.club_id = p_club_id
  ) t;
$$;

-- All players valid for a Club x Club combination, with the player's national
-- teams and their appearance counts for both clubs.
create or replace function public.get_players_for_club_club(
  p_club_a_id uuid,
  p_club_b_id uuid
)
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  with ordered as (
    select least(p_club_a_id, p_club_b_id) as c1,
           greatest(p_club_a_id, p_club_b_id) as c2
  )
  select coalesce(json_agg(row_to_json(t) order by t.name), '[]'::json)
  from (
    select
      p.id as player_id,
      p.name,
      (
        select coalesce(json_agg(nt.name order by nt.name), '[]'::json)
        from public.player_national_teams pn
        join public.national_teams nt on nt.id = pn.national_team_id
        where pn.player_id = p.id
      ) as national_teams,
      json_build_array(
        json_build_object('name', c1.name, 'appearances', h1.appearances),
        json_build_object('name', c2.name, 'appearances', h2.appearances)
      ) as clubs
    from ordered o
    join public.club_club_answers a
      on a.club_1_id = o.c1 and a.club_2_id = o.c2
    join public.players p on p.id = a.player_id
    join public.clubs c1 on c1.id = a.club_1_id
    join public.clubs c2 on c2.id = a.club_2_id
    join public.player_club_history h1
      on h1.player_id = p.id and h1.club_id = a.club_1_id
    join public.player_club_history h2
      on h2.player_id = p.id and h2.club_id = a.club_2_id
  ) t;
$$;

grant execute on function public.get_players_for_country_club(uuid, uuid) to anon, authenticated;
grant execute on function public.get_players_for_club_club(uuid, uuid) to anon, authenticated;
-- ============================================================================
-- Football Duel — Player Pick challenge type + 30s server-authoritative timer
-- Extends the existing round/answer system; does NOT replace Random mode.
-- Private player selections live in a table clients cannot read; the reveal +
-- validation happen exactly once inside a row-locked RPC.
-- ============================================================================

-- ---- Schema additions (idempotent) -----------------------------------------

alter table public.rooms
  add column if not exists challenge_type text not null default 'random'
    check (challenge_type in ('random', 'player_pick'));

alter table public.rounds
  add column if not exists challenge_type text not null default 'random';
alter table public.rounds
  add column if not exists ends_at timestamptz;
alter table public.rounds
  add column if not exists sel1_confirmed boolean not null default false;
alter table public.rounds
  add column if not exists sel2_confirmed boolean not null default false;
alter table public.rounds
  add column if not exists sel1_role text;
alter table public.rounds
  add column if not exists sel2_role text;
alter table public.rounds
  add column if not exists invalid_reason text;
alter table public.rounds
  add column if not exists no_winner boolean not null default false;
alter table public.rounds
  add column if not exists winner_time_ms int;

-- Extend the allowed round states.
alter table public.rounds drop constraint if exists rounds_state_check;
alter table public.rounds add constraint rounds_state_check
  check (state in ('selection', 'revealed', 'countdown', 'active', 'finished'));

-- Private per-player selections. RLS is enabled with NO policies, so clients
-- can never read this table (no select, no realtime). All access is through
-- SECURITY DEFINER RPCs. This is what keeps a selection hidden before reveal.
create table if not exists public.round_selections (
  round_id uuid not null references public.rounds (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  slot int not null check (slot in (1, 2)),
  role text not null check (role in ('national_team', 'club')),
  selection_id uuid,
  confirmed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (round_id, user_id)
);
alter table public.round_selections enable row level security;
-- Intentionally NO policies and NOT added to the realtime publication.

-- create_room now records the chosen challenge_type (defaults to random).
create or replace function public.create_room(
  p_user_id uuid,
  p_display_name text,
  p_game_mode text,
  p_win_target int,
  p_challenge_type text default 'random'
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_code text := public.gen_room_code();
  v_room_id uuid;
begin
  insert into public.users (id, display_name)
  values (v_user, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  insert into public.rooms (code, status, game_mode, win_target,
                            challenge_type, host_user_id)
  values (v_code, 'waiting', coalesce(p_game_mode, 'national_club'),
          coalesce(p_win_target, 5),
          coalesce(p_challenge_type, 'random'), v_user)
  returning id into v_room_id;

  insert into public.room_players (room_id, user_id, slot, display_name)
  values (v_room_id, v_user, 1, p_display_name);

  return json_build_object('status', 'ok', 'room_id', v_room_id, 'code', v_code);
end;
$$;

grant execute on function public.create_room(uuid, text, text, int, text)
  to anon, authenticated;

-- ---- Roles ------------------------------------------------------------------
-- Deterministic, PUBLIC role assignment (roles are not secret; selections are).
--   national_club: roles alternate each round.
--     odd  round -> slot1 = national_team, slot2 = club
--     even round -> slot1 = club,          slot2 = national_team
--   club_club: both players choose a club.
create or replace function public.pp_role_for_slot(
  p_mode text,
  p_round_number int,
  p_slot int
)
returns text
language sql
immutable
as $$
  select case
    when p_mode = 'club_club' then 'club'
    when (p_round_number % 2 = 1) then
      case when p_slot = 1 then 'national_team' else 'club' end
    else
      case when p_slot = 1 then 'club' else 'national_team' end
  end;
$$;

-- ---- create_round: branch on challenge_type --------------------------------

create or replace function public.create_round(
  p_match_id uuid,
  p_mode text,
  p_round_number int,
  p_challenge_type text default 'random'
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_round_id uuid;
  v_nt uuid;
  v_c1 uuid;
  v_c2 uuid;
  v_room_id uuid;
  v_role1 text;
  v_role2 text;
  r record;
begin
  if p_challenge_type = 'player_pick' then
    v_role1 := public.pp_role_for_slot(p_mode, p_round_number, 1);
    v_role2 := public.pp_role_for_slot(p_mode, p_round_number, 2);

    insert into public.rounds (
      match_id, round_number, mode, challenge_type, state,
      sel1_role, sel2_role
    )
    values (
      p_match_id, p_round_number, p_mode, 'player_pick', 'selection',
      v_role1, v_role2
    )
    returning id into v_round_id;

    -- Seed a (still empty) private selection row for each player.
    select room_id into v_room_id from public.matches where id = p_match_id;
    for r in
      select user_id, slot from public.room_players where room_id = v_room_id
    loop
      insert into public.round_selections (round_id, user_id, slot, role)
      values (
        v_round_id, r.user_id, r.slot,
        public.pp_role_for_slot(p_mode, p_round_number, r.slot)
      )
      on conflict do nothing;
    end loop;

    return v_round_id;
  end if;

  -- -------- Random mode (unchanged behavior, now with a 30s deadline) --------
  if p_mode = 'national_club' then
    select s.national_team_id, s.club_id into v_nt, v_c1
    from (
      select national_team_id, club_id, count(*) c
      from public.country_club_answers
      group by national_team_id, club_id
    ) s
    where (s.national_team_id, s.club_id) not in (
      select national_team_id, club_1_id from public.rounds
      where match_id = p_match_id and mode = 'national_club'
        and national_team_id is not null and club_1_id is not null
    )
    order by (s.c >= 2) desc, random()
    limit 1;

    if v_nt is null then
      select s.national_team_id, s.club_id into v_nt, v_c1
      from (
        select national_team_id, club_id, count(*) c
        from public.country_club_answers
        group by national_team_id, club_id
      ) s
      order by (s.c >= 2) desc, random()
      limit 1;
    end if;

    if v_nt is null then
      raise exception 'No playable national_club challenge available';
    end if;

    insert into public.rounds (
      match_id, round_number, mode, challenge_type, national_team_id, club_1_id,
      national_team_name, club_1_name, state, activated_at, ends_at
    )
    values (
      p_match_id, p_round_number, 'national_club', 'random', v_nt, v_c1,
      (select name from public.national_teams where id = v_nt),
      (select name from public.clubs where id = v_c1),
      'countdown', now() + interval '3 seconds',
      now() + interval '3 seconds' + interval '30 seconds'
    )
    returning id into v_round_id;
  else
    select s.club_1_id, s.club_2_id into v_c1, v_c2
    from (
      select club_1_id, club_2_id, count(*) c
      from public.club_club_answers
      group by club_1_id, club_2_id
    ) s
    where (s.club_1_id, s.club_2_id) not in (
      select club_1_id, club_2_id from public.rounds
      where match_id = p_match_id and mode = 'club_club'
        and club_1_id is not null and club_2_id is not null
    )
    order by (s.c >= 2) desc, random()
    limit 1;

    if v_c1 is null then
      select s.club_1_id, s.club_2_id into v_c1, v_c2
      from (
        select club_1_id, club_2_id, count(*) c
        from public.club_club_answers
        group by club_1_id, club_2_id
      ) s
      order by (s.c >= 2) desc, random()
      limit 1;
    end if;

    if v_c1 is null then
      raise exception 'No playable club_club challenge available';
    end if;

    insert into public.rounds (
      match_id, round_number, mode, challenge_type, club_1_id, club_2_id,
      club_1_name, club_2_name, state, activated_at, ends_at
    )
    values (
      p_match_id, p_round_number, 'club_club', 'random', v_c1, v_c2,
      (select name from public.clubs where id = v_c1),
      (select name from public.clubs where id = v_c2),
      'countdown', now() + interval '3 seconds',
      now() + interval '3 seconds' + interval '30 seconds'
    )
    returning id into v_round_id;
  end if;

  return v_round_id;
end;
$$;

-- start_match / start_round / play_again must forward the room challenge_type.

create or replace function public.start_match(
  p_user_id uuid,
  p_room_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_mode text;
  v_ctype text;
  v_players int;
  v_match_id uuid;
  v_round_id uuid;
begin
  perform public.assert_host(v_user, p_room_id);

  select count(*) into v_players from public.room_players where room_id = p_room_id;
  if v_players < 2 then
    return json_build_object('status', 'not_enough_players');
  end if;

  select game_mode, challenge_type into v_mode, v_ctype
  from public.rooms where id = p_room_id;

  update public.rooms set status = 'playing' where id = p_room_id;

  insert into public.matches (room_id, status)
  values (p_room_id, 'active')
  returning id into v_match_id;

  v_round_id := public.create_round(v_match_id, v_mode, 1, v_ctype);

  return json_build_object('status', 'ok', 'match_id', v_match_id,
                           'round_id', v_round_id);
end;
$$;

create or replace function public.start_round(
  p_user_id uuid,
  p_room_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_match public.matches;
  v_mode text;
  v_ctype text;
  v_num int;
  v_existing uuid;
  v_round_id uuid;
begin
  perform public.assert_host(v_user, p_room_id);

  select * into v_match from public.matches
  where room_id = p_room_id and status = 'active'
  order by created_at desc
  limit 1;
  if not found then
    return json_build_object('status', 'no_active_match');
  end if;

  select id into v_existing from public.rounds
  where match_id = v_match.id and state <> 'finished'
  order by round_number desc
  limit 1;
  if found then
    return json_build_object('status', 'ok', 'match_id', v_match.id,
                             'round_id', v_existing);
  end if;

  select game_mode, challenge_type into v_mode, v_ctype
  from public.rooms where id = p_room_id;
  select coalesce(max(round_number), 0) + 1 into v_num
  from public.rounds where match_id = v_match.id;

  v_round_id := public.create_round(v_match.id, v_mode, v_num, v_ctype);
  return json_build_object('status', 'ok', 'match_id', v_match.id,
                           'round_id', v_round_id);
end;
$$;

create or replace function public.play_again(
  p_user_id uuid,
  p_room_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_mode text;
  v_ctype text;
  v_match_id uuid;
  v_round_id uuid;
begin
  perform public.assert_host(v_user, p_room_id);

  update public.matches set status = 'finished'
  where room_id = p_room_id and status = 'active';

  select game_mode, challenge_type into v_mode, v_ctype
  from public.rooms where id = p_room_id;
  update public.rooms set status = 'playing' where id = p_room_id;

  insert into public.matches (room_id, status)
  values (p_room_id, 'active')
  returning id into v_match_id;

  v_round_id := public.create_round(v_match_id, v_mode, 1, v_ctype);

  return json_build_object('status', 'ok', 'match_id', v_match_id,
                           'round_id', v_round_id);
end;
$$;

-- Allow choosing challenge_type in the lobby (host only, before playing).
create or replace function public.set_room_settings(
  p_user_id uuid,
  p_room_id uuid,
  p_game_mode text,
  p_win_target int,
  p_challenge_type text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_updated int;
begin
  update public.rooms
    set game_mode = coalesce(p_game_mode, game_mode),
        win_target = coalesce(p_win_target, win_target),
        challenge_type = coalesce(p_challenge_type, challenge_type)
  where id = p_room_id
    and host_user_id = v_user
    and status in ('waiting', 'ready');
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return json_build_object('status', 'forbidden');
  end if;
  return json_build_object('status', 'ok');
end;
$$;

grant execute on function public.set_room_settings(uuid, uuid, text, int, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Player Pick: confirm a private selection. When BOTH players are confirmed
-- this reveals + validates the combination exactly once under a row lock.
-- Selections are never returned to the caller (only the caller's own choice is
-- known to their client). The opponent's choice only becomes visible via the
-- revealed challenge fields on public.rounds after a valid reveal.
-- ----------------------------------------------------------------------------

create or replace function public.confirm_selection(
  p_user_id uuid,
  p_round_id uuid,
  p_selection_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_round public.rounds;
  v_role text;
  v_slot int;
  v_confirmed_count int;
  v_ready_count int;
  v_nt uuid;
  v_club uuid;
  v_a uuid;
  v_b uuid;
  v_answers int;
  v_reason text;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  if v_round.challenge_type <> 'player_pick' then
    return json_build_object('status', 'not_player_pick');
  end if;
  if v_round.state <> 'selection' then
    -- Already revealed / counting down. Idempotent no-op.
    return json_build_object('status', 'already_revealed');
  end if;

  select role, slot into v_role, v_slot
  from public.round_selections
  where round_id = p_round_id and user_id = v_user;
  if not found then
    return json_build_object('status', 'not_participant');
  end if;

  -- Validate the selection matches the caller's assigned role.
  if v_role = 'national_team' then
    if not exists (select 1 from public.national_teams where id = p_selection_id) then
      return json_build_object('status', 'invalid_selection');
    end if;
  else
    if not exists (select 1 from public.clubs where id = p_selection_id) then
      return json_build_object('status', 'invalid_selection');
    end if;
  end if;

  update public.round_selections
    set selection_id = p_selection_id, confirmed = true, updated_at = now()
  where round_id = p_round_id and user_id = v_user;

  update public.rounds
    set sel1_confirmed = case when v_slot = 1 then true else sel1_confirmed end,
        sel2_confirmed = case when v_slot = 2 then true else sel2_confirmed end,
        invalid_reason = null
  where id = p_round_id;

  select count(*) filter (where confirmed),
         count(*) filter (where confirmed and selection_id is not null)
    into v_confirmed_count, v_ready_count
  from public.round_selections where round_id = p_round_id;

  if v_ready_count < 2 then
    return json_build_object('status', 'waiting');
  end if;

  -- Both confirmed: reveal + validate exactly once (we hold the round lock).
  if v_round.mode = 'national_club' then
    select selection_id into v_nt from public.round_selections
      where round_id = p_round_id and role = 'national_team';
    select selection_id into v_club from public.round_selections
      where round_id = p_round_id and role = 'club';

    select count(*) into v_answers from public.country_club_answers
      where national_team_id = v_nt and club_id = v_club;

    if v_answers = 0 then
      v_reason := 'no_answers';
    end if;
  else
    select selection_id into v_a from public.round_selections
      where round_id = p_round_id and slot = 1;
    select selection_id into v_b from public.round_selections
      where round_id = p_round_id and slot = 2;

    if v_a = v_b then
      v_reason := 'same_club';
    else
      select count(*) into v_answers from public.club_club_answers
        where club_1_id = least(v_a, v_b) and club_2_id = greatest(v_a, v_b);
      if v_answers = 0 then
        v_reason := 'no_answers';
      end if;
    end if;
  end if;

  if v_reason is not null then
    -- Reset both players back to private selection.
    update public.round_selections
      set selection_id = null, confirmed = false, updated_at = now()
    where round_id = p_round_id;
    update public.rounds
      set sel1_confirmed = false, sel2_confirmed = false, invalid_reason = v_reason
    where id = p_round_id;
    return json_build_object('status', 'invalid', 'reason', v_reason);
  end if;

  -- Valid: publish the revealed challenge + start the countdown.
  if v_round.mode = 'national_club' then
    update public.rounds set
      national_team_id = v_nt,
      club_1_id = v_club,
      national_team_name = (select name from public.national_teams where id = v_nt),
      club_1_name = (select name from public.clubs where id = v_club),
      state = 'countdown',
      invalid_reason = null,
      activated_at = now() + interval '3 seconds',
      ends_at = now() + interval '3 seconds' + interval '30 seconds'
    where id = p_round_id;
  else
    update public.rounds set
      club_1_id = v_a,
      club_2_id = v_b,
      club_1_name = (select name from public.clubs where id = v_a),
      club_2_name = (select name from public.clubs where id = v_b),
      state = 'countdown',
      invalid_reason = null,
      activated_at = now() + interval '3 seconds',
      ends_at = now() + interval '3 seconds' + interval '30 seconds'
    where id = p_round_id;
  end if;

  return json_build_object('status', 'revealed');
end;
$$;

grant execute on function public.confirm_selection(uuid, uuid, uuid)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Finish an active/countdown round whose 30s deadline has passed with no
-- winner. Idempotent; any client may call it at t=0.
-- ----------------------------------------------------------------------------

create or replace function public.finish_round_if_expired(
  p_round_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_round public.rounds;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  if v_round.state = 'finished' then
    return json_build_object('status', 'already_finished',
      'no_winner', v_round.no_winner);
  end if;
  if v_round.ends_at is null or now() <= v_round.ends_at then
    return json_build_object('status', 'not_expired');
  end if;
  if v_round.winner_user_id is not null then
    return json_build_object('status', 'has_winner');
  end if;

  update public.rounds
    set state = 'finished', finished_at = now(), no_winner = true
  where id = p_round_id and winner_user_id is null and state <> 'finished';

  return json_build_object('status', 'timed_out', 'no_winner', true);
end;
$$;

grant execute on function public.finish_round_if_expired(uuid)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Re-defined submit_answer: adds the 30s deadline, a lightweight per-player
-- rate limit, and stores the winner's answer time. Server timestamp decides
-- races near t=0. Everything else is identical to the original.
-- ----------------------------------------------------------------------------

create or replace function public.submit_answer(
  p_user_id uuid,
  p_round_id uuid,
  p_raw_answer text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_round public.rounds;
  v_norm text := public.normalize_name(p_raw_answer);
  v_candidates uuid[];
  v_player_id uuid;
  v_player_name text;
  v_is_valid boolean := false;
  v_checks json := null;
  v_valid_count int;
  v_valid_pid uuid;
  v_sub_id uuid;
  v_win_target int;
  v_winner_wins int;
  v_room_id uuid;
  v_time_ms int;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    return json_build_object('status', 'round_not_active', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  if v_round.state in ('finished', 'selection', 'revealed')
     or v_round.winner_user_id is not null then
    return json_build_object('status', 'round_not_active', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', v_round.winner_user_id);
  end if;
  if v_round.activated_at is null or now() < v_round.activated_at then
    return json_build_object('status', 'round_not_active', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  -- Deadline: the server timestamp is authoritative for races near t=0.
  if v_round.ends_at is not null and now() > v_round.ends_at then
    update public.rounds
      set state = 'finished', finished_at = now(), no_winner = true
    where id = p_round_id and winner_user_id is null and state <> 'finished';
    return json_build_object('status', 'expired', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  -- Lightweight anti-spam: at most ~4 submissions/sec per player.
  if exists (
    select 1 from public.submissions
    where round_id = p_round_id and user_id = v_user
      and server_received_at > clock_timestamp() - interval '250 milliseconds'
  ) then
    return json_build_object('status', 'rate_limited', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  if v_round.state = 'countdown' then
    update public.rounds set state = 'active' where id = p_round_id;
    v_round.state := 'active';
  end if;

  select array_agg(id) into v_candidates
  from public.players where normalized_name = v_norm;
  if v_candidates is null then
    select array_agg(distinct player_id) into v_candidates
    from public.player_aliases where normalized_alias = v_norm;
  end if;

  if v_candidates is null then
    insert into public.submissions (round_id, user_id, raw_answer,
      normalized_answer, player_id, is_valid)
    values (p_round_id, v_user, p_raw_answer, v_norm, null, false);
    return json_build_object('status', 'incorrect', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  if array_length(v_candidates, 1) = 1 then
    v_player_id := v_candidates[1];
  else
    select count(*), min(pid) into v_valid_count, v_valid_pid
    from unnest(v_candidates) as pid
    where public.pl_is_valid_for_round(pid, v_round);
    if v_valid_count = 1 then
      v_player_id := v_valid_pid;
    else
      insert into public.submissions (round_id, user_id, raw_answer,
        normalized_answer, player_id, is_valid)
      values (p_round_id, v_user, p_raw_answer, v_norm, null, false);
      return json_build_object('status', 'ambiguous', 'is_correct', false,
        'player_name', null, 'checks', null, 'round_id', p_round_id,
        'winner_user_id', null);
    end if;
  end if;

  v_is_valid := public.pl_is_valid_for_round(v_player_id, v_round);
  v_checks := public.pl_checks_for_round(v_player_id, v_round);
  select name into v_player_name from public.players where id = v_player_id;

  insert into public.submissions (round_id, user_id, raw_answer,
    normalized_answer, player_id, is_valid)
  values (p_round_id, v_user, p_raw_answer, v_norm, v_player_id, v_is_valid)
  returning id into v_sub_id;

  if not v_is_valid then
    return json_build_object('status', 'incorrect', 'is_correct', false,
      'player_name', v_player_name, 'checks', v_checks, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  v_time_ms := floor(extract(epoch from (now() - v_round.activated_at)) * 1000)::int;

  update public.rounds
    set winner_user_id = v_user,
        winner_submission_id = v_sub_id,
        winner_player_name = v_player_name,
        winner_time_ms = v_time_ms,
        state = 'finished',
        finished_at = now()
  where id = p_round_id and winner_user_id is null;

  if not found then
    return json_build_object('status', 'correct_but_late', 'is_correct', true,
      'player_name', v_player_name, 'checks', v_checks, 'round_id', p_round_id,
      'winner_user_id', (select winner_user_id from public.rounds where id = p_round_id));
  end if;

  select r.win_target, m.room_id into v_win_target, v_room_id
  from public.matches m join public.rooms r on r.id = m.room_id
  where m.id = v_round.match_id;

  select count(*) into v_winner_wins
  from public.rounds
  where match_id = v_round.match_id and winner_user_id = v_user;

  if v_winner_wins >= v_win_target then
    update public.matches set status = 'finished', winner_user_id = v_user
    where id = v_round.match_id;
    update public.rooms set status = 'finished' where id = v_room_id;
  end if;

  return json_build_object('status', 'won', 'is_correct', true,
    'player_name', v_player_name, 'checks', v_checks, 'round_id', p_round_id,
    'winner_user_id', v_user, 'winner_time_ms', v_time_ms);
end;
$$;

grant execute on function public.create_round(uuid, text, int, text)
  to anon, authenticated;
grant execute on function public.pp_role_for_slot(text, int, int)
  to anon, authenticated;
-- ============================================================================
-- Global footballer autocomplete search.
-- IMPORTANT: this searches the ENTIRE player table and knows nothing about the
-- current round's valid answers. It must never be used to reveal which players
-- are valid for the active challenge.
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

-- Trigram index for fast fuzzy matching on normalized names.
create index if not exists players_normalized_trgm_idx
  on public.players using gin (normalized_name extensions.gin_trgm_ops);

-- Deterministic ranking: exact > prefix > token-prefix (contains) > fuzzy.
create or replace function public.search_players(p_query text)
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select public.normalize_name(p_query) as nq
  )
  select coalesce(
    json_agg(json_build_object('id', t.id, 'name', t.name)
             order by t.rank, t.sim desc, t.name),
    '[]'::json)
  from (
    select p.id, p.name,
      case
        when p.normalized_name = (select nq from q) then 0
        when p.normalized_name like (select nq from q) || '%' then 1
        when p.normalized_name like '% ' || (select nq from q) || '%' then 2
        when p.normalized_name like '%' || (select nq from q) || '%' then 3
        else 4
      end as rank,
      extensions.similarity(p.normalized_name, (select nq from q)) as sim
    from public.players p
    where (select nq from q) <> ''
      and (
        p.normalized_name like '%' || (select nq from q) || '%'
        or extensions.similarity(p.normalized_name, (select nq from q)) > 0.3
      )
    order by rank, sim desc, p.name
    limit 8
  ) t;
$$;

grant execute on function public.search_players(text) to anon, authenticated;
-- ============================================================================
-- Football Duel — demo seed data (real players)
-- Enough coverage for every example challenge in the brief. Names are inserted
-- verbatim; normalized_name is computed with the same rules the game uses.
-- Runs after migrations on `supabase db reset`.
--
-- Idempotent: the football reference tables are cleared first so re-running the
-- seed (or the combined cloud-setup.sql) never produces duplicate players/clubs.
-- This only touches football/answer data (and, via cascade, any in-progress
-- rounds); it does not remove rooms or players from a lobby.
-- ============================================================================

truncate table
  public.country_club_answers,
  public.club_club_answers,
  public.player_aliases,
  public.player_club_history,
  public.player_national_teams,
  public.players,
  public.clubs,
  public.national_teams
restart identity cascade;

insert into public.clubs (name) values
  ('Real Madrid'),
  ('Arsenal'),
  ('Barcelona'),
  ('Juventus'),
  ('Manchester United'),
  ('Chelsea'),
  ('Manchester City')
on conflict do nothing;

insert into public.national_teams (name) values
  ('Turkey'),
  ('Germany'),
  ('France'),
  ('Brazil'),
  ('Portugal'),
  ('England'),
  ('Argentina'),
  ('Croatia'),
  ('Sweden'),
  ('Czech Republic'),
  ('Spain'),
  ('Chile')
on conflict do nothing;

insert into public.players (name) values
  ('Arda Güler'),
  ('Toni Kroos'),
  ('Mesut Özil'),
  ('Cristiano Ronaldo'),
  ('David Beckham'),
  ('Ángel Di María'),
  ('Sami Khedira'),
  ('Luka Modrić'),
  ('Thierry Henry'),
  ('Cesc Fàbregas'),
  ('Alexis Sánchez'),
  ('Olivier Giroud'),
  ('Petr Čech'),
  ('David Luiz'),
  ('Laurent Koscielny'),
  ('Ronaldinho'),
  ('Dani Alves'),
  ('Neymar'),
  ('Zlatan Ibrahimović'),
  ('İlkay Gündoğan'),
  ('Leroy Sané')
on conflict do nothing;

update public.clubs set normalized_name = public.normalize_name(name);
update public.national_teams set normalized_name = public.normalize_name(name);
update public.players set normalized_name = public.normalize_name(name);

-- Official first-team appearances (>= 1 only).
insert into public.player_club_history (player_id, club_id, appearances)
select p.id, c.id, v.appearances
from (values
  ('Arda Güler', 'Real Madrid', 30),
  ('Toni Kroos', 'Real Madrid', 250),
  ('Mesut Özil', 'Real Madrid', 105),
  ('Mesut Özil', 'Arsenal', 184),
  ('Cristiano Ronaldo', 'Manchester United', 196),
  ('Cristiano Ronaldo', 'Real Madrid', 292),
  ('Cristiano Ronaldo', 'Juventus', 98),
  ('David Beckham', 'Manchester United', 265),
  ('David Beckham', 'Real Madrid', 116),
  ('Ángel Di María', 'Real Madrid', 124),
  ('Ángel Di María', 'Manchester United', 27),
  ('Sami Khedira', 'Real Madrid', 95),
  ('Sami Khedira', 'Juventus', 82),
  ('Luka Modrić', 'Real Madrid', 400),
  ('Thierry Henry', 'Arsenal', 258),
  ('Thierry Henry', 'Barcelona', 80),
  ('Cesc Fàbregas', 'Arsenal', 212),
  ('Cesc Fàbregas', 'Barcelona', 96),
  ('Cesc Fàbregas', 'Chelsea', 156),
  ('Alexis Sánchez', 'Arsenal', 122),
  ('Alexis Sánchez', 'Barcelona', 65),
  ('Olivier Giroud', 'Arsenal', 180),
  ('Olivier Giroud', 'Chelsea', 75),
  ('Petr Čech', 'Chelsea', 333),
  ('Petr Čech', 'Arsenal', 139),
  ('David Luiz', 'Chelsea', 248),
  ('David Luiz', 'Arsenal', 73),
  ('Laurent Koscielny', 'Arsenal', 353),
  ('Ronaldinho', 'Barcelona', 207),
  ('Dani Alves', 'Barcelona', 391),
  ('Dani Alves', 'Juventus', 33),
  ('Neymar', 'Barcelona', 186),
  ('Zlatan Ibrahimović', 'Barcelona', 46),
  ('Zlatan Ibrahimović', 'Juventus', 117),
  ('Zlatan Ibrahimović', 'Manchester United', 53),
  ('İlkay Gündoğan', 'Manchester City', 304),
  ('İlkay Gündoğan', 'Barcelona', 50),
  ('Leroy Sané', 'Manchester City', 135)
) as v(player_name, club_name, appearances)
join public.players p on p.name = v.player_name
join public.clubs c on c.name = v.club_name
on conflict do nothing;

-- Senior national teams.
insert into public.player_national_teams (player_id, national_team_id)
select p.id, n.id
from (values
  ('Arda Güler', 'Turkey'),
  ('Toni Kroos', 'Germany'),
  ('Mesut Özil', 'Germany'),
  ('Cristiano Ronaldo', 'Portugal'),
  ('David Beckham', 'England'),
  ('Ángel Di María', 'Argentina'),
  ('Sami Khedira', 'Germany'),
  ('Luka Modrić', 'Croatia'),
  ('Thierry Henry', 'France'),
  ('Cesc Fàbregas', 'Spain'),
  ('Alexis Sánchez', 'Chile'),
  ('Olivier Giroud', 'France'),
  ('Petr Čech', 'Czech Republic'),
  ('David Luiz', 'Brazil'),
  ('Laurent Koscielny', 'France'),
  ('Ronaldinho', 'Brazil'),
  ('Dani Alves', 'Brazil'),
  ('Neymar', 'Brazil'),
  ('Zlatan Ibrahimović', 'Sweden'),
  ('İlkay Gündoğan', 'Germany'),
  ('Leroy Sané', 'Germany')
) as v(player_name, nt_name)
join public.players p on p.name = v.player_name
join public.national_teams n on n.name = v.nt_name
on conflict do nothing;

-- A few aliases / short forms.
insert into public.player_aliases (player_id, alias, normalized_alias)
select p.id, v.alias, public.normalize_name(v.alias)
from (values
  ('Cristiano Ronaldo', 'CR7'),
  ('Cristiano Ronaldo', 'Cristiano'),
  ('Zlatan Ibrahimović', 'Ibra'),
  ('Zlatan Ibrahimović', 'Zlatan'),
  ('Cesc Fàbregas', 'Cesc'),
  ('Neymar', 'Neymar Jr'),
  ('Ángel Di María', 'Di Maria'),
  ('İlkay Gündoğan', 'Gundogan')
) as v(player_name, alias)
join public.players p on p.name = v.player_name
on conflict do nothing;

select public.rebuild_answers();
