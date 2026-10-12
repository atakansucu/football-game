-- ============================================================================
-- Football Duel — player profile RPC
-- Powers the "tap a player to see full details" feature on /lookup. Returns a
-- player's ENTIRE club history (all clubs + appearances) and national teams,
-- not just the two teams that matched the current combination.
-- ============================================================================

create or replace function public.get_player_profile(p_player_id uuid)
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  select json_build_object(
    'player_id', p.id,
    'name', p.name,
    'national_teams', (
      select coalesce(json_agg(nt.name order by nt.name), '[]'::json)
      from public.player_national_teams pn
      join public.national_teams nt on nt.id = pn.national_team_id
      where pn.player_id = p.id
    ),
    'clubs', (
      select coalesce(
        json_agg(
          json_build_object('name', c.name, 'appearances', pch.appearances)
          order by pch.appearances desc, c.name
        ),
        '[]'::json
      )
      from public.player_club_history pch
      join public.clubs c on c.id = pch.club_id
      where pch.player_id = p.id
    )
  )
  from public.players p
  where p.id = p_player_id;
$$;

grant execute on function public.get_player_profile(uuid) to anon, authenticated;
