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
