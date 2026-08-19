-- ----------------------------------------------------------------------------
-- 0010 — Easy difficulty prefers well-known teams (not just "many overlaps").
--
-- "Many common players" often means two OBSCURE clubs where lots of journeymen
-- happened to overlap. That made easy mode surface unrecognizable teams. Instead
-- we score each club / national team by prominence and, in easy mode, only pick
-- combinations where BOTH sides are "popular" (recognizable), still random.
--
--   * clubs.prominence          = distinct internationally-capped players who
--                                 actually appeared for the club (star power).
--   * national_teams.prominence = distinct capped players.
--   * *.is_popular              = flagged for the most prominent (easy pool).
-- ----------------------------------------------------------------------------

alter table public.clubs
  add column if not exists prominence int not null default 0,
  add column if not exists is_popular boolean not null default false;

alter table public.national_teams
  add column if not exists prominence int not null default 0,
  add column if not exists is_popular boolean not null default false;

-- Recompute prominence + popularity from the base relations. Cheap; safe to run
-- after any import/seed. Top-N thresholds keep the easy pool recognizable but
-- still varied.
create or replace function public.rebuild_prominence()
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
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

  update public.clubs set is_popular = false;
  update public.clubs c set is_popular = true
  from (
    select id, row_number() over (order by prominence desc, name) as rn
    from public.clubs
  ) r
  where r.id = c.id and r.rn <= 80;

  update public.national_teams set is_popular = false;
  update public.national_teams n set is_popular = true
  from (
    select id, row_number() over (order by prominence desc, name) as rn
    from public.national_teams
  ) r
  where r.id = n.id and r.rn <= 40;
end;
$$;

grant execute on function public.rebuild_prominence() to anon, authenticated;

-- Keep prominence fresh automatically: rebuild it whenever answers are rebuilt
-- (called by the importer and the seed).
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

  insert into public.country_club_answers (national_team_id, club_id, player_id)
  select distinct pnt.national_team_id, pch.club_id, pnt.player_id
  from public.player_national_teams pnt
  join public.player_club_history pch on pch.player_id = pnt.player_id
  where pch.appearances >= 1;

  insert into public.club_club_answers (club_1_id, club_2_id, player_id)
  select distinct
    least(a.club_id, b.club_id),
    greatest(a.club_id, b.club_id),
    a.player_id
  from public.player_club_history a
  join public.player_club_history b
    on a.player_id = b.player_id and a.club_id < b.club_id
  where a.appearances >= 1 and b.appearances >= 1;

  perform public.rebuild_prominence();

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

-- create_round: easy now filters on popularity; medium/hard keep count bands.
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
        when 'easy' then (case when cl.is_popular and ntt.is_popular then 0 else 1 end)
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
    join public.clubs ca on ca.id = t.club_1_id
    join public.clubs cb on cb.id = t.club_2_id
    order by
      case p_difficulty
        when 'easy' then (case when ca.is_popular and cb.is_popular then 0 else 1 end)
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

-- Populate prominence for the data already in this project.
select public.rebuild_prominence();
