-- ============================================================================
-- Football Duel — apply migrations 0007 + 0008 to an EXISTING cloud project.
--
-- Safe to paste into the Supabase Dashboard → SQL Editor and run as-is.
--   * Idempotent (re-runnable).
--   * Does NOT touch rooms/players/matches or the imported football data
--     (no TRUNCATE, no seed) — only adds columns and (re)creates functions.
--
-- Contents:
--   0007  both-players-ready gate (ready_next_round)
--   0008  random difficulty (easy/medium/hard) + Player Pick advance on an
--         invalid combination (no common player / same club)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0007 — both-players-ready gate for advancing to the next round
-- ---------------------------------------------------------------------------

alter table public.rounds
  add column if not exists ready_1 boolean not null default false,
  add column if not exists ready_2 boolean not null default false;

-- ---------------------------------------------------------------------------
-- 0008 — difficulty + Player Pick invalid-combination advance
-- ---------------------------------------------------------------------------

alter table public.rooms
  add column if not exists difficulty text not null default 'medium';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_difficulty_check'
  ) then
    alter table public.rooms
      add constraint rooms_difficulty_check
      check (difficulty in ('easy', 'medium', 'hard'));
  end if;
end$$;

drop function if exists public.create_round(uuid, text, int, text);

create or replace function public.create_round(
  p_match_id uuid,
  p_mode text,
  p_round_number int,
  p_challenge_type text default 'random',
  p_difficulty text default 'medium'
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
  v_target int := greatest(2, 8 - (p_round_number - 1));
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

  if p_mode = 'national_club' then
    select t.national_team_id, t.club_id into v_nt, v_c1
    from (
      with combos as (
        select national_team_id, club_id, count(*)::int as c
        from public.country_club_answers
        group by national_team_id, club_id
      ),
      avail as (
        select * from combos
        where (national_team_id, club_id) not in (
          select national_team_id, club_1_id from public.rounds
          where match_id = p_match_id and mode = 'national_club'
            and national_team_id is not null and club_1_id is not null
        )
      ),
      pool as (
        select * from avail
        union all
        select * from combos where not exists (select 1 from avail)
      )
      select national_team_id, club_id, c from pool
    ) t
    order by
      case p_difficulty
        when 'easy' then (case when t.c >= 6 then 0 else 1 end)
        when 'hard' then (case when t.c <= 3 then 0 else 1 end)
        else abs(t.c - v_target)
      end,
      case p_difficulty
        when 'easy' then -t.c
        when 'hard' then t.c
        else 0
      end,
      random()
    limit 1;

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
    select t.club_1_id, t.club_2_id into v_c1, v_c2
    from (
      with combos as (
        select club_1_id, club_2_id, count(*)::int as c
        from public.club_club_answers
        group by club_1_id, club_2_id
      ),
      avail as (
        select * from combos
        where (club_1_id, club_2_id) not in (
          select club_1_id, club_2_id from public.rounds
          where match_id = p_match_id and mode = 'club_club'
            and club_1_id is not null and club_2_id is not null
        )
      ),
      pool as (
        select * from avail
        union all
        select * from combos where not exists (select 1 from avail)
      )
      select club_1_id, club_2_id, c from pool
    ) t
    order by
      case p_difficulty
        when 'easy' then (case when t.c >= 6 then 0 else 1 end)
        when 'hard' then (case when t.c <= 3 then 0 else 1 end)
        else abs(t.c - v_target)
      end,
      case p_difficulty
        when 'easy' then -t.c
        when 'hard' then t.c
        else 0
      end,
      random()
    limit 1;

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
  v_diff text;
  v_players int;
  v_match_id uuid;
  v_round_id uuid;
begin
  perform public.assert_host(v_user, p_room_id);

  select count(*) into v_players from public.room_players where room_id = p_room_id;
  if v_players < 2 then
    return json_build_object('status', 'not_enough_players');
  end if;

  select game_mode, challenge_type, difficulty into v_mode, v_ctype, v_diff
  from public.rooms where id = p_room_id;

  update public.rooms set status = 'playing' where id = p_room_id;

  insert into public.matches (room_id, status)
  values (p_room_id, 'active')
  returning id into v_match_id;

  v_round_id := public.create_round(v_match_id, v_mode, 1, v_ctype, v_diff);

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
  v_diff text;
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

  select game_mode, challenge_type, difficulty into v_mode, v_ctype, v_diff
  from public.rooms where id = p_room_id;
  select coalesce(max(round_number), 0) + 1 into v_num
  from public.rounds where match_id = v_match.id;

  v_round_id := public.create_round(v_match.id, v_mode, v_num, v_ctype, v_diff);
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
  v_diff text;
  v_match_id uuid;
  v_round_id uuid;
begin
  perform public.assert_host(v_user, p_room_id);

  update public.matches set status = 'finished'
  where room_id = p_room_id and status = 'active';

  select game_mode, challenge_type, difficulty into v_mode, v_ctype, v_diff
  from public.rooms where id = p_room_id;
  update public.rooms set status = 'playing' where id = p_room_id;

  insert into public.matches (room_id, status)
  values (p_room_id, 'active')
  returning id into v_match_id;

  v_round_id := public.create_round(v_match_id, v_mode, 1, v_ctype, v_diff);

  return json_build_object('status', 'ok', 'match_id', v_match_id,
                           'round_id', v_round_id);
end;
$$;

create or replace function public.ready_next_round(
  p_user_id uuid,
  p_round_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_round public.rounds;
  v_match public.matches;
  v_room public.rooms;
  v_slot int;
  v_num int;
  v_existing uuid;
  v_round_id uuid;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;
  if v_round.state <> 'finished' then
    return json_build_object('status', 'not_finished');
  end if;

  select * into v_match from public.matches where id = v_round.match_id;
  select * into v_room from public.rooms where id = v_match.room_id;

  select slot into v_slot from public.room_players
  where room_id = v_room.id and user_id = v_user;
  if v_slot is null then
    return json_build_object('status', 'not_participant');
  end if;

  update public.rounds
    set ready_1 = case when v_slot = 1 then true else ready_1 end,
        ready_2 = case when v_slot = 2 then true else ready_2 end
  where id = p_round_id
  returning * into v_round;

  if v_match.status <> 'active' or v_room.status <> 'playing' then
    return json_build_object('status', 'match_over');
  end if;

  if not (v_round.ready_1 and v_round.ready_2) then
    return json_build_object('status', 'waiting',
      'ready_1', v_round.ready_1, 'ready_2', v_round.ready_2);
  end if;

  select id into v_existing from public.rounds
  where match_id = v_match.id and state <> 'finished'
  order by round_number desc
  limit 1;
  if found then
    return json_build_object('status', 'advanced', 'round_id', v_existing);
  end if;

  select coalesce(max(round_number), 0) + 1 into v_num
  from public.rounds where match_id = v_match.id;

  v_round_id := public.create_round(
    v_match.id, v_room.game_mode, v_num, v_room.challenge_type, v_room.difficulty
  );
  return json_build_object('status', 'advanced', 'round_id', v_round_id);
end;
$$;

grant execute on function public.ready_next_round(uuid, uuid)
  to anon, authenticated;

drop function if exists public.set_room_settings(uuid, uuid, text, int, text);

create or replace function public.set_room_settings(
  p_user_id uuid,
  p_room_id uuid,
  p_game_mode text,
  p_win_target int,
  p_challenge_type text default null,
  p_difficulty text default null
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
        challenge_type = coalesce(p_challenge_type, challenge_type),
        difficulty = coalesce(p_difficulty, difficulty)
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

grant execute on function public.set_room_settings(uuid, uuid, text, int, text, text)
  to anon, authenticated;

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
    return json_build_object('status', 'already_revealed');
  end if;

  select role, slot into v_role, v_slot
  from public.round_selections
  where round_id = p_round_id and user_id = v_user;
  if not found then
    return json_build_object('status', 'not_participant');
  end if;

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
    update public.rounds
      set state = 'finished',
          finished_at = now(),
          no_winner = true,
          invalid_reason = v_reason
    where id = p_round_id;
    return json_build_object('status', 'invalid', 'reason', v_reason);
  end if;

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
