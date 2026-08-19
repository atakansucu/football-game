-- ----------------------------------------------------------------------------
-- Both-players-ready gate for advancing to the next round.
--
-- After a round finishes, each player marks themselves "ready" and the next
-- round is created only once BOTH have confirmed (instead of the host auto-
-- advancing). Ready flags live on the round so they ride the existing realtime
-- subscription; the next round is created atomically under a row lock so two
-- near-simultaneous confirmations can never create duplicate rounds.
-- ----------------------------------------------------------------------------

alter table public.rounds
  add column if not exists ready_1 boolean not null default false,
  add column if not exists ready_2 boolean not null default false;

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
  -- Lock the finished round so the two confirmations are serialized.
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

  -- The match may already be over (someone reached the win target).
  if v_match.status <> 'active' or v_room.status <> 'playing' then
    return json_build_object('status', 'match_over');
  end if;

  if not (v_round.ready_1 and v_round.ready_2) then
    return json_build_object('status', 'waiting',
      'ready_1', v_round.ready_1, 'ready_2', v_round.ready_2);
  end if;

  -- Both ready: reuse any already-created next round, otherwise create it once.
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
    v_match.id, v_room.game_mode, v_num, v_room.challenge_type
  );
  return json_build_object('status', 'advanced', 'round_id', v_round_id);
end;
$$;

grant execute on function public.ready_next_round(uuid, uuid)
  to anon, authenticated;
