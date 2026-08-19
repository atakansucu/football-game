-- ----------------------------------------------------------------------------
-- 0011 — Difficulty = how well-known the teams are (fame tiers by rank).
--
-- Each club / national team gets a popularity_rank (1 = most prominent). Random
-- mode then filters combinations by rank tier:
--
--   national team:  easy <= 21   medium <= 42   hard = all
--   club:           easy <= 40   medium <= 80   hard = all
--
-- In national_club mode BOTH the club and the national team must be within the
-- tier; in club_club mode BOTH clubs must. Hard has no cap (any teams, so the
-- most obscure pairings can appear). Selection is still uniformly random inside
-- the tier.
-- ----------------------------------------------------------------------------

alter table public.clubs
  add column if not exists popularity_rank int not null default 0;

alter table public.national_teams
  add column if not exists popularity_rank int not null default 0;

create or replace function public.rebuild_prominence()
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  -- Prominence: distinct internationally-capped players who appeared there.
  update public.clubs set prominence = 0;
  update public.clubs c set prominence = s.n
  from (
    select pch.club_id, count(distinct pch.player_id) as n
    from public.player_club_history pch
    where pch.appearances >= 1
      and exists (
        select 1 from public.player_national_teams pnt
        where pnt.player_id = pch.player_id
      )
    group by pch.club_id
  ) s
  where c.id = s.club_id;

  update public.national_teams set prominence = 0;
  update public.national_teams n set prominence = s.n
  from (
    select national_team_id, count(distinct player_id) as n
    from public.player_national_teams
    group by national_team_id
  ) s
  where n.id = s.national_team_id;

  -- Rank (1 = most prominent) drives the difficulty tiers.
  update public.clubs c set popularity_rank = r.rn
  from (
    select id, row_number() over (order by prominence desc, name) as rn
    from public.clubs
  ) r
  where r.id = c.id;

  update public.national_teams n set popularity_rank = r.rn
  from (
    select id, row_number() over (order by prominence desc, name) as rn
    from public.national_teams
  ) r
  where r.id = n.id;

  -- Kept for reference/back-compat (easy tier).
  update public.clubs set is_popular = (popularity_rank between 1 and 40);
  update public.national_teams set is_popular = (popularity_rank between 1 and 21);
end;
$$;

grant execute on function public.rebuild_prominence() to anon, authenticated;

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
    join public.clubs cl on cl.id = t.club_id
    join public.national_teams ntt on ntt.id = t.national_team_id
    order by
      case p_difficulty
        when 'easy' then
          (case when cl.popularity_rank <= 40 and ntt.popularity_rank <= 21
                then 0 else 1 end)
        when 'hard' then 0
        else
          (case when cl.popularity_rank <= 80 and ntt.popularity_rank <= 42
                then 0 else 1 end)
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
    join public.clubs ca on ca.id = t.club_1_id
    join public.clubs cb on cb.id = t.club_2_id
    order by
      case p_difficulty
        when 'easy' then
          (case when ca.popularity_rank <= 40 and cb.popularity_rank <= 40
                then 0 else 1 end)
        when 'hard' then 0
        else
          (case when ca.popularity_rank <= 80 and cb.popularity_rank <= 80
                then 0 else 1 end)
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

-- Populate popularity_rank for the data already in this project.
select public.rebuild_prominence();
