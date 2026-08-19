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
