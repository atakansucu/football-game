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
