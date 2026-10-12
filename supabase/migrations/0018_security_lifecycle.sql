-- ============================================================================
-- 0018 — authenticated multiplayer, lifecycle locking, and account cleanup
--
-- This migration is intentionally additive: existing RPC signatures used by
-- the web/Capacitor clients are preserved. Anonymous Supabase users still call
-- these RPCs as `authenticated`; bare anon-key calls no longer mutate games.
-- ============================================================================

-- Resolve the caller once and reject both unauthenticated calls and stale /
-- forged p_user_id values. Keep p_user_id in public signatures for old clients.
create or replace function public.require_game_caller(p_user_id uuid default null)
returns uuid
language plpgsql
stable
security invoker
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_user_id is not null and p_user_id <> v_user then
    raise exception using errcode = '42501', message = 'User identity mismatch';
  end if;
  return v_user;
end;
$$;

revoke all on function public.require_game_caller(uuid) from public, anon;
grant execute on function public.require_game_caller(uuid) to authenticated;

create or replace function public.create_room(
  p_user_id uuid,
  p_display_name text,
  p_game_mode text,
  p_win_target int,
  p_challenge_type text default 'random',
  p_league text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := public.require_game_caller(p_user_id);
  v_code text := public.gen_room_code();
  v_room_id uuid;
begin
  insert into public.users (id, display_name)
  values (v_user, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  insert into public.rooms (
    code, status, game_mode, win_target, challenge_type, league, host_user_id
  ) values (
    v_code, 'waiting', coalesce(p_game_mode, 'national_club'),
    coalesce(p_win_target, 5), coalesce(p_challenge_type, 'random'),
    p_league, v_user
  )
  returning id into v_room_id;

  insert into public.room_players (room_id, user_id, slot, display_name)
  values (v_room_id, v_user, 1, p_display_name);
  return json_build_object(
    'status', 'ok', 'room_id', v_room_id, 'code', v_code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Join is serialized on the room. New players may only enter a lobby; an
-- existing member may reconnect in every lifecycle state.
-- ---------------------------------------------------------------------------
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
  v_user uuid := public.require_game_caller(p_user_id);
  v_room public.rooms;
  v_slot int;
  v_count int;
begin
  select * into v_room
  from public.rooms
  where upper(code) = upper(btrim(p_code))
  for update;

  if not found then
    return json_build_object('status', 'not_found');
  end if;

  select slot into v_slot
  from public.room_players
  where room_id = v_room.id and user_id = v_user;

  if found then
    update public.room_players
      set connected = true,
          last_seen = clock_timestamp(),
          display_name = coalesce(nullif(btrim(p_display_name), ''), display_name)
    where room_id = v_room.id and user_id = v_user;
    return json_build_object('status', 'ok', 'room_id', v_room.id,
      'code', v_room.code, 'slot', v_slot);
  end if;

  if v_room.status not in ('waiting', 'ready') then
    return json_build_object('status', 'not_joinable');
  end if;

  select count(*) into v_count
  from public.room_players
  where room_id = v_room.id;
  if v_count >= 2 then
    return json_build_object('status', 'full');
  end if;

  insert into public.users (id, display_name)
  values (v_user, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name;

  select s into v_slot
  from (values (1), (2)) as t(s)
  where not exists (
    select 1 from public.room_players rp
    where rp.room_id = v_room.id and rp.slot = s
  )
  order by s
  limit 1;

  insert into public.room_players (room_id, user_id, slot, display_name)
  values (v_room.id, v_user, v_slot, p_display_name);

  update public.rooms
  set status = case
    when (select count(*) from public.room_players where room_id = v_room.id) = 2
      then 'ready'
    else 'waiting'
  end
  where id = v_room.id;

  return json_build_object('status', 'ok', 'room_id', v_room.id,
    'code', v_room.code, 'slot', v_slot);
end;
$$;

-- ---------------------------------------------------------------------------
-- Start/replay lock the room and enforce legal transitions. Concurrent retries
-- are idempotent and return the active match instead of creating another one.
-- ---------------------------------------------------------------------------
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
  v_user uuid := public.require_game_caller(p_user_id);
  v_room public.rooms;
  v_players int;
  v_match_id uuid;
  v_round_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  if v_room.host_user_id <> v_user then
    return json_build_object('status', 'forbidden');
  end if;

  select m.id, rd.id into v_match_id, v_round_id
  from public.matches m
  left join lateral (
    select id from public.rounds
    where match_id = m.id and state <> 'finished'
    order by round_number desc limit 1
  ) rd on true
  where m.room_id = p_room_id and m.status = 'active'
  order by m.created_at desc
  limit 1;
  if v_match_id is not null then
    return json_build_object('status', 'already_started',
      'match_id', v_match_id, 'round_id', v_round_id);
  end if;

  if v_room.status <> 'ready' then
    return json_build_object('status', 'invalid_state');
  end if;
  select count(*) into v_players from public.room_players where room_id = p_room_id;
  if v_players <> 2 then
    return json_build_object('status', 'not_enough_players');
  end if;

  insert into public.matches (room_id, status)
  values (p_room_id, 'active')
  returning id into v_match_id;

  v_round_id := public.create_round(
    v_match_id, v_room.game_mode, 1, v_room.challenge_type,
    v_room.difficulty, v_room.league
  );
  update public.rooms set status = 'playing' where id = p_room_id;

  return json_build_object('status', 'ok',
    'match_id', v_match_id, 'round_id', v_round_id);
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
  v_user uuid := public.require_game_caller(p_user_id);
  v_room public.rooms;
  v_players int;
  v_match_id uuid;
  v_round_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  if v_room.host_user_id <> v_user then
    return json_build_object('status', 'forbidden');
  end if;

  select m.id, rd.id into v_match_id, v_round_id
  from public.matches m
  left join lateral (
    select id from public.rounds
    where match_id = m.id and state <> 'finished'
    order by round_number desc limit 1
  ) rd on true
  where m.room_id = p_room_id and m.status = 'active'
  order by m.created_at desc
  limit 1;
  if v_match_id is not null then
    return json_build_object('status', 'already_started',
      'match_id', v_match_id, 'round_id', v_round_id);
  end if;

  if v_room.status <> 'finished' then
    return json_build_object('status', 'invalid_state');
  end if;
  select count(*) into v_players from public.room_players where room_id = p_room_id;
  if v_players <> 2 then
    return json_build_object('status', 'not_enough_players');
  end if;

  insert into public.matches (room_id, status)
  values (p_room_id, 'active')
  returning id into v_match_id;
  v_round_id := public.create_round(
    v_match_id, v_room.game_mode, 1, v_room.challenge_type,
    v_room.difficulty, v_room.league
  );
  update public.rooms set status = 'playing' where id = p_room_id;

  return json_build_object('status', 'ok',
    'match_id', v_match_id, 'round_id', v_round_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Presence and leaving.
-- ---------------------------------------------------------------------------
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
  v_user uuid := public.require_game_caller(p_user_id);
  v_updated int;
begin
  update public.room_players
  set connected = true, last_seen = clock_timestamp()
  where room_id = p_room_id and user_id = v_user;
  get diagnostics v_updated = row_count;
  return json_build_object(
    'status', case when v_updated = 1 then 'ok' else 'not_participant' end
  );
end;
$$;

create or replace function public.mark_stale_presence(
  p_room_id uuid,
  p_stale_after_seconds int default 45
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := public.require_game_caller(null);
  v_count int;
  v_seconds int := greatest(15, least(coalesce(p_stale_after_seconds, 45), 3600));
begin
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = v_user
  ) then
    return json_build_object('status', 'not_participant');
  end if;

  update public.room_players
  set connected = false
  where room_id = p_room_id
    and connected
    and last_seen < clock_timestamp() - make_interval(secs => v_seconds);
  get diagnostics v_count = row_count;
  return json_build_object('status', 'ok', 'marked_stale', v_count);
end;
$$;

create or replace function public.leave_room(
  p_user_id uuid,
  p_room_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := public.require_game_caller(p_user_id);
  v_room public.rooms;
  v_new_host uuid;
  v_count int;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = v_user
  ) then
    return json_build_object('status', 'not_participant');
  end if;

  if v_room.status in ('playing', 'finished') then
    update public.room_players
    set connected = false, last_seen = clock_timestamp()
    where room_id = p_room_id and user_id = v_user;
    return json_build_object('status', 'disconnected');
  end if;

  if v_room.host_user_id = v_user then
    select user_id into v_new_host
    from public.room_players
    where room_id = p_room_id and user_id <> v_user
    order by slot
    limit 1;
    if v_new_host is null then
      delete from public.rooms where id = p_room_id;
      return json_build_object('status', 'room_closed');
    end if;
    update public.rooms set host_user_id = v_new_host where id = p_room_id;
  end if;

  delete from public.room_players
  where room_id = p_room_id and user_id = v_user;
  select count(*) into v_count from public.room_players where room_id = p_room_id;
  update public.rooms
  set status = case when v_count = 2 then 'ready' else 'waiting' end
  where id = p_room_id;
  return json_build_object('status', 'left');
end;
$$;

create or replace function public.claim_abandoned_match(
  p_user_id uuid,
  p_room_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := public.require_game_caller(p_user_id);
  v_room public.rooms;
  v_match_id uuid;
  v_opponent uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  if v_room.status <> 'playing' then
    return json_build_object('status', 'not_playing');
  end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = v_user
  ) then
    return json_build_object('status', 'not_participant');
  end if;

  select user_id into v_opponent
  from public.room_players
  where room_id = p_room_id and user_id <> v_user
    and connected = false
    and last_seen < clock_timestamp() - interval '45 seconds'
  limit 1;
  if v_opponent is null then
    return json_build_object('status', 'opponent_active');
  end if;

  select id into v_match_id
  from public.matches
  where room_id = p_room_id and status = 'active'
  order by created_at desc
  limit 1
  for update;
  if v_match_id is null then
    return json_build_object('status', 'not_playing');
  end if;

  update public.rounds
  set state = 'finished', no_winner = true,
      finished_at = coalesce(finished_at, clock_timestamp())
  where match_id = v_match_id and state <> 'finished';
  update public.matches
  set status = 'finished', winner_user_id = v_user
  where id = v_match_id;
  update public.rooms set status = 'finished' where id = p_room_id;
  delete from public.room_players
  where room_id = p_room_id and user_id = v_opponent;

  return json_build_object(
    'status', 'won_by_disconnect',
    'match_id', v_match_id,
    'winner_user_id', v_user
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Participant-only, idempotent timeout finalization using a wall clock. now()
-- is transaction-stable and can accept an answer after a long transaction.
-- ---------------------------------------------------------------------------
create or replace function public.finish_round_if_expired(p_round_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := public.require_game_caller(null);
  v_round public.rounds;
  v_room_id uuid;
  v_now timestamptz;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;

  select m.room_id into v_room_id
  from public.matches m where m.id = v_round.match_id;
  if not exists (
    select 1 from public.room_players
    where room_id = v_room_id and user_id = v_user
  ) then
    return json_build_object('status', 'not_participant');
  end if;

  if v_round.state = 'finished' then
    return json_build_object('status', 'already_finished',
      'no_winner', v_round.no_winner);
  end if;
  v_now := clock_timestamp();
  if v_round.ends_at is null or v_now <= v_round.ends_at then
    return json_build_object('status', 'not_expired');
  end if;
  if v_round.winner_user_id is not null then
    return json_build_object('status', 'has_winner');
  end if;

  update public.rounds
  set state = 'finished', finished_at = v_now, no_winner = true
  where id = p_round_id and winner_user_id is null and state <> 'finished';
  return json_build_object('status', 'timed_out', 'no_winner', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Authoritative answer submission. Authentication and room membership are
-- checked while holding the round lock. All deadline decisions use one wall
-- clock sample.
-- ---------------------------------------------------------------------------
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
  v_user uuid := public.require_game_caller(p_user_id);
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
  v_now timestamptz;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    return json_build_object('status', 'round_not_active', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  select m.room_id into v_room_id from public.matches m where m.id = v_round.match_id;
  if not exists (
    select 1 from public.room_players
    where room_id = v_room_id and user_id = v_user
  ) then
    return json_build_object('status', 'not_participant', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  if v_round.state in ('finished', 'selection', 'revealed')
     or v_round.winner_user_id is not null then
    return json_build_object('status', 'round_not_active', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', v_round.winner_user_id);
  end if;

  v_now := clock_timestamp();
  if v_round.activated_at is null or v_now < v_round.activated_at then
    return json_build_object('status', 'round_not_active', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;
  if v_round.ends_at is not null and v_now > v_round.ends_at then
    update public.rounds
    set state = 'finished', finished_at = v_now, no_winner = true
    where id = p_round_id and winner_user_id is null and state <> 'finished';
    return json_build_object('status', 'expired', 'is_correct', false,
      'player_name', null, 'checks', null, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  if exists (
    select 1 from public.submissions
    where round_id = p_round_id and user_id = v_user
      and server_received_at > v_now - interval '250 milliseconds'
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
    insert into public.submissions (
      round_id, user_id, raw_answer, normalized_answer, player_id, is_valid,
      server_received_at
    ) values (p_round_id, v_user, p_raw_answer, v_norm, null, false, v_now);
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
      insert into public.submissions (
        round_id, user_id, raw_answer, normalized_answer, player_id, is_valid,
        server_received_at
      ) values (p_round_id, v_user, p_raw_answer, v_norm, null, false, v_now);
      return json_build_object('status', 'ambiguous', 'is_correct', false,
        'player_name', null, 'checks', null, 'round_id', p_round_id,
        'winner_user_id', null);
    end if;
  end if;

  v_is_valid := public.pl_is_valid_for_round(v_player_id, v_round);
  v_checks := public.pl_checks_for_round(v_player_id, v_round);
  select name into v_player_name from public.players where id = v_player_id;

  insert into public.submissions (
    round_id, user_id, raw_answer, normalized_answer, player_id, is_valid,
    server_received_at
  ) values (
    p_round_id, v_user, p_raw_answer, v_norm, v_player_id, v_is_valid, v_now
  ) returning id into v_sub_id;

  if not v_is_valid then
    return json_build_object('status', 'incorrect', 'is_correct', false,
      'player_name', v_player_name, 'checks', v_checks, 'round_id', p_round_id,
      'winner_user_id', null);
  end if;

  v_time_ms := greatest(
    0, floor(extract(epoch from (v_now - v_round.activated_at)) * 1000)::int
  );
  update public.rounds
  set winner_user_id = v_user,
      winner_submission_id = v_sub_id,
      winner_player_name = v_player_name,
      winner_time_ms = v_time_ms,
      state = 'finished',
      finished_at = v_now
  where id = p_round_id and winner_user_id is null;

  if not found then
    return json_build_object('status', 'correct_but_late', 'is_correct', true,
      'player_name', v_player_name, 'checks', v_checks, 'round_id', p_round_id,
      'winner_user_id',
        (select winner_user_id from public.rounds where id = p_round_id));
  end if;

  select r.win_target into v_win_target
  from public.rooms r where r.id = v_room_id;
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

-- Player Pick keeps an invalid pair in the same private selection round. This
-- matches the client UX ("choose again") and also binds identity to auth.uid().
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
  v_user uuid := public.require_game_caller(p_user_id);
  v_round public.rounds;
  v_role text;
  v_slot int;
  v_ready_count int;
  v_nt uuid;
  v_club uuid;
  v_a uuid;
  v_b uuid;
  v_answers int;
  v_reason text;
  v_now timestamptz;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  if v_round.challenge_type <> 'player_pick' then
    return json_build_object('status', 'not_player_pick');
  end if;
  if v_round.state <> 'selection' then
    return json_build_object('status', 'already_revealed');
  end if;

  select role, slot into v_role, v_slot
  from public.round_selections
  where round_id = p_round_id and user_id = v_user;
  if not found then
    return json_build_object('status', 'not_participant');
  end if;

  if v_role = 'national_team' then
    if not exists (
      select 1 from public.national_teams where id = p_selection_id
    ) then
      return json_build_object('status', 'invalid_selection');
    end if;
  elsif not exists (select 1 from public.clubs where id = p_selection_id) then
    return json_build_object('status', 'invalid_selection');
  end if;

  update public.round_selections
  set selection_id = p_selection_id, confirmed = true,
      updated_at = clock_timestamp()
  where round_id = p_round_id and user_id = v_user;

  update public.rounds
  set sel1_confirmed = case when v_slot = 1 then true else sel1_confirmed end,
      sel2_confirmed = case when v_slot = 2 then true else sel2_confirmed end,
      invalid_reason = null
  where id = p_round_id;

  select count(*) filter (where confirmed and selection_id is not null)
  into v_ready_count
  from public.round_selections where round_id = p_round_id;
  if v_ready_count < 2 then
    return json_build_object('status', 'waiting');
  end if;

  if v_round.mode = 'national_club' then
    select selection_id into v_nt from public.round_selections
    where round_id = p_round_id and role = 'national_team';
    select selection_id into v_club from public.round_selections
    where round_id = p_round_id and role = 'club';
    select count(*) into v_answers from public.country_club_answers
    where national_team_id = v_nt and club_id = v_club;
    if v_answers = 0 then v_reason := 'no_answers'; end if;
  else
    select selection_id into v_a from public.round_selections
    where round_id = p_round_id and slot = 1;
    select selection_id into v_b from public.round_selections
    where round_id = p_round_id and slot = 2;
    if v_a = v_b then
      v_reason := 'same_club';
    else
      select count(*) into v_answers from public.club_club_answers
      where club_1_id = least(v_a, v_b)
        and club_2_id = greatest(v_a, v_b);
      if v_answers = 0 then v_reason := 'no_answers'; end if;
    end if;
  end if;

  if v_reason is not null then
    update public.round_selections
    set selection_id = null, confirmed = false,
        updated_at = clock_timestamp()
    where round_id = p_round_id;
    update public.rounds
    set sel1_confirmed = false, sel2_confirmed = false,
        invalid_reason = v_reason
    where id = p_round_id;
    return json_build_object('status', 'invalid', 'reason', v_reason);
  end if;

  v_now := clock_timestamp();
  if v_round.mode = 'national_club' then
    update public.rounds set
      national_team_id = v_nt,
      club_1_id = v_club,
      national_team_name = (
        select name from public.national_teams where id = v_nt
      ),
      club_1_name = (select name from public.clubs where id = v_club),
      state = 'countdown', invalid_reason = null,
      activated_at = v_now + interval '3 seconds',
      ends_at = v_now + interval '33 seconds'
    where id = p_round_id;
  else
    update public.rounds set
      club_1_id = least(v_a, v_b),
      club_2_id = greatest(v_a, v_b),
      club_1_name = (
        select name from public.clubs where id = least(v_a, v_b)
      ),
      club_2_name = (
        select name from public.clubs where id = greatest(v_a, v_b)
      ),
      state = 'countdown', invalid_reason = null,
      activated_at = v_now + interval '3 seconds',
      ends_at = v_now + interval '33 seconds'
    where id = p_round_id;
  end if;
  return json_build_object('status', 'revealed');
end;
$$;

-- ---------------------------------------------------------------------------
-- Active-round answer-list protection. Explorer calls remain compatible after
-- the matching multiplayer round has finished.
-- ---------------------------------------------------------------------------
create or replace function public.get_players_for_country_club(
  p_national_team_id uuid,
  p_club_id uuid
)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_result json;
begin
  if exists (
    select 1 from public.rounds
    where state in ('countdown', 'active')
      and mode = 'national_club'
      and national_team_id = p_national_team_id
      and club_1_id = p_club_id
  ) then
    raise exception using errcode = '42501',
      message = 'Answers are hidden while this challenge is active';
  end if;

  select coalesce(json_agg(row_to_json(t) order by t.name), '[]'::json)
  into v_result
  from (
    select p.id as player_id, p.name,
      (select coalesce(json_agg(nt.name order by nt.name), '[]'::json)
       from public.player_national_teams pn
       join public.national_teams nt on nt.id = pn.national_team_id
       where pn.player_id = p.id) as national_teams,
      json_build_array(json_build_object(
        'name', c.name, 'appearances', pch.appearances
      )) as clubs
    from public.country_club_answers a
    join public.players p on p.id = a.player_id
    join public.clubs c on c.id = a.club_id
    join public.player_club_history pch
      on pch.player_id = p.id and pch.club_id = a.club_id
    where a.national_team_id = p_national_team_id and a.club_id = p_club_id
  ) t;
  return v_result;
end;
$$;

create or replace function public.get_players_for_club_club(
  p_club_a_id uuid,
  p_club_b_id uuid
)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_c1 uuid := least(p_club_a_id, p_club_b_id);
  v_c2 uuid := greatest(p_club_a_id, p_club_b_id);
  v_result json;
begin
  if exists (
    select 1 from public.rounds
    where state in ('countdown', 'active')
      and mode = 'club_club'
      and club_1_id = v_c1 and club_2_id = v_c2
  ) then
    raise exception using errcode = '42501',
      message = 'Answers are hidden while this challenge is active';
  end if;

  select coalesce(json_agg(row_to_json(t) order by t.name), '[]'::json)
  into v_result
  from (
    select p.id as player_id, p.name,
      (select coalesce(json_agg(nt.name order by nt.name), '[]'::json)
       from public.player_national_teams pn
       join public.national_teams nt on nt.id = pn.national_team_id
       where pn.player_id = p.id) as national_teams,
      json_build_array(
        json_build_object('name', ca.name, 'appearances', h1.appearances),
        json_build_object('name', cb.name, 'appearances', h2.appearances)
      ) as clubs
    from public.club_club_answers a
    join public.players p on p.id = a.player_id
    join public.clubs ca on ca.id = a.club_1_id
    join public.clubs cb on cb.id = a.club_2_id
    join public.player_club_history h1
      on h1.player_id = p.id and h1.club_id = a.club_1_id
    join public.player_club_history h2
      on h2.player_id = p.id and h2.club_id = a.club_2_id
    where a.club_1_id = v_c1 and a.club_2_id = v_c2
  ) t;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Account deletion. Anonymous auth users are deleted synchronously. Permanent
-- accounts create a request for a trusted server/admin flow, avoiding a public
-- RPC that could delete a password/OAuth account without reauthentication.
-- ---------------------------------------------------------------------------
create table if not exists public.account_deletion_requests (
  user_id uuid primary key,
  requested_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'cancelled'))
);
alter table public.account_deletion_requests enable row level security;

create or replace function public.delete_game_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  r record;
  v_new_host uuid;
begin
  -- Remove references that intentionally preserve historical matches.
  update public.matches set winner_user_id = null where winner_user_id = p_user_id;
  update public.rounds set winner_user_id = null where winner_user_id = p_user_id;

  -- Transfer hosted rooms when another participant exists; otherwise deleting
  -- the room is the only way to satisfy rooms.host_user_id safely.
  for r in
    select id from public.rooms where host_user_id = p_user_id for update
  loop
    select user_id into v_new_host
    from public.room_players
    where room_id = r.id and user_id <> p_user_id
    order by slot limit 1;
    if v_new_host is null then
      delete from public.rooms where id = r.id;
    else
      update public.rooms set host_user_id = v_new_host where id = r.id;
    end if;
  end loop;

  delete from public.room_players where user_id = p_user_id;
  delete from public.users where id = p_user_id;
end;
$$;

revoke all on function public.delete_game_user_data(uuid)
  from public, anon, authenticated;

create or replace function public.request_account_deletion()
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user uuid := public.require_game_caller(null);
  v_is_anonymous boolean;
begin
  select is_anonymous into v_is_anonymous from auth.users where id = v_user;
  if not found then
    return json_build_object('status', 'not_found');
  end if;

  if coalesce(v_is_anonymous, false) then
    perform public.delete_game_user_data(v_user);
    delete from auth.users where id = v_user and is_anonymous;
    return json_build_object('status', 'deleted');
  end if;

  insert into public.account_deletion_requests (user_id, requested_at, status)
  values (v_user, clock_timestamp(), 'pending')
  on conflict (user_id) do update
    set requested_at = excluded.requested_at, status = 'pending';
  return json_build_object('status', 'requires_server_deletion');
end;
$$;

-- Trusted backend completion hook for permanent accounts. It is intentionally
-- unavailable to anon/authenticated clients and should be called with service
-- role only after reauthentication/identity checks in the server flow.
create or replace function public.complete_account_deletion(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  perform public.delete_game_user_data(p_user_id);
  delete from auth.users where id = p_user_id;
  update public.account_deletion_requests
  set status = 'completed' where user_id = p_user_id;
  return json_build_object('status', 'deleted');
end;
$$;

revoke all on function public.complete_account_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_account_deletion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Live game rows are visible only to room participants. SECURITY DEFINER
-- helpers avoid recursive RLS evaluation on room_players.
-- ---------------------------------------------------------------------------
create or replace function public.is_room_participant(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1
    from public.room_players
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_match_participant(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1
    from public.matches m
    join public.room_players rp on rp.room_id = m.room_id
    where m.id = p_match_id and rp.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_room_participant(uuid) from public, anon;
revoke execute on function public.is_match_participant(uuid) from public, anon;
grant execute on function public.is_room_participant(uuid) to authenticated;
grant execute on function public.is_match_participant(uuid) to authenticated;

drop policy if exists "read rooms" on public.rooms;
create policy "participants read rooms"
  on public.rooms for select to authenticated
  using (public.is_room_participant(id));

drop policy if exists "read room_players" on public.room_players;
create policy "participants read room_players"
  on public.room_players for select to authenticated
  using (public.is_room_participant(room_id));

drop policy if exists "read matches" on public.matches;
create policy "participants read matches"
  on public.matches for select to authenticated
  using (public.is_room_participant(room_id));

drop policy if exists "read rounds" on public.rounds;
create policy "participants read rounds"
  on public.rounds for select to authenticated
  using (public.is_match_participant(match_id));

-- ---------------------------------------------------------------------------
-- Privileges. PUBLIC receives EXECUTE by default in PostgreSQL, so revoking
-- only anon/authenticated is insufficient.
-- ---------------------------------------------------------------------------
revoke execute on function public.create_room(uuid, text, text, int, text, text)
  from public, anon;
revoke execute on function public.join_room(uuid, text, text)
  from public, anon;
revoke execute on function public.set_room_settings(uuid, uuid, text, int, text, text, text)
  from public, anon;
revoke execute on function public.heartbeat(uuid, uuid) from public, anon;
revoke execute on function public.start_match(uuid, uuid) from public, anon;
revoke execute on function public.start_round(uuid, uuid) from public, anon;
revoke execute on function public.submit_answer(uuid, uuid, text) from public, anon;
revoke execute on function public.play_again(uuid, uuid) from public, anon;
revoke execute on function public.confirm_selection(uuid, uuid, uuid) from public, anon;
revoke execute on function public.ready_next_round(uuid, uuid) from public, anon;
revoke execute on function public.finish_round_if_expired(uuid) from public, anon;

grant execute on function public.create_room(uuid, text, text, int, text, text)
  to authenticated;
grant execute on function public.join_room(uuid, text, text) to authenticated;
grant execute on function public.set_room_settings(uuid, uuid, text, int, text, text, text)
  to authenticated;
grant execute on function public.heartbeat(uuid, uuid) to authenticated;
grant execute on function public.start_match(uuid, uuid) to authenticated;
grant execute on function public.start_round(uuid, uuid) to authenticated;
grant execute on function public.submit_answer(uuid, uuid, text) to authenticated;
grant execute on function public.play_again(uuid, uuid) to authenticated;
grant execute on function public.confirm_selection(uuid, uuid, uuid) to authenticated;
grant execute on function public.ready_next_round(uuid, uuid) to authenticated;
grant execute on function public.finish_round_if_expired(uuid) to authenticated;
grant execute on function public.mark_stale_presence(uuid, int) to authenticated;
grant execute on function public.leave_room(uuid, uuid) to authenticated;
grant execute on function public.claim_abandoned_match(uuid, uuid) to authenticated;
grant execute on function public.request_account_deletion() to authenticated;
revoke execute on function public.mark_stale_presence(uuid, int) from public, anon;
revoke execute on function public.leave_room(uuid, uuid) from public, anon;
revoke execute on function public.claim_abandoned_match(uuid, uuid) from public, anon;
revoke execute on function public.request_account_deletion() from public, anon;

-- Remove obsolete overloads left by earlier additive migrations. They are not
-- used by current clients and retaining EXECUTE would preserve spoofable paths.
revoke execute on function public.create_room(uuid, text, text, int)
  from public, anon, authenticated;
revoke execute on function public.set_room_settings(uuid, uuid, text, int)
  from public, anon, authenticated;

-- Internal/maintenance functions must never be client-callable.
revoke execute on function public.create_round(uuid, text, int, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.create_round(uuid, text, int)
  from public, anon, authenticated;
revoke execute on function public.activate_due_rounds()
  from public, anon, authenticated;
revoke execute on function public.rebuild_answers()
  from public, anon, authenticated;
revoke execute on function public.rebuild_prominence()
  from public, anon, authenticated;
revoke execute on function public.refresh_solo_combos()
  from public, anon, authenticated;
revoke execute on function public.pp_role_for_slot(text, int, int)
  from public, anon, authenticated;
revoke execute on function public.sp_player_valid(text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.pl_is_valid_for_round(uuid, public.rounds)
  from public, anon, authenticated;
revoke execute on function public.pl_checks_for_round(uuid, public.rounds)
  from public, anon, authenticated;

grant execute on function public.create_round(uuid, text, int, text, text, text)
  to service_role;
grant execute on function public.activate_due_rounds() to service_role;
grant execute on function public.rebuild_answers() to service_role;
grant execute on function public.rebuild_prominence() to service_role;
grant execute on function public.refresh_solo_combos() to service_role;

-- RLS policies filter rows but do not grant table access by themselves.
grant select on table
  public.players,
  public.clubs,
  public.national_teams
to anon, authenticated;

grant select on table
  public.rooms,
  public.room_players,
  public.matches,
  public.rounds
to authenticated;

-- Administrative scripts and local integration tests use the service role.
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

