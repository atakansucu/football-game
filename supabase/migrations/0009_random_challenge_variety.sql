-- ----------------------------------------------------------------------------
-- 0009 — Randomize Random-mode challenge selection within a difficulty band.
--
-- Previously medium ordered by abs(count - target) (and easy/hard by count),
-- which is deterministic and kept surfacing the same popular teams. Now each
-- difficulty defines a BAND of acceptable common-player counts and we pick a
-- uniformly random combination inside it (falling back to any combo if the band
-- is empty). Difficulty still controls how hard the combo is, but the specific
-- teams are shuffled every round/match.
--
--   easy   : >= 5 common players
--   medium :  2..4 common players
--   hard   :  exactly 1 common player
-- ----------------------------------------------------------------------------

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
        when 'easy' then (case when t.c >= 5 then 0 else 1 end)
        when 'hard' then (case when t.c <= 1 then 0 else 1 end)
        else (case when t.c between 2 and 4 then 0 else 1 end)
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
        when 'easy' then (case when t.c >= 5 then 0 else 1 end)
        when 'hard' then (case when t.c <= 1 then 0 else 1 end)
        else (case when t.c between 2 and 4 then 0 else 1 end)
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
