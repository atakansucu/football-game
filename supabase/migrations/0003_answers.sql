-- ============================================================================
-- Football Duel — precomputed answer rebuild
-- Call public.rebuild_answers() after importing/seeding football data. It
-- derives the playable answer tables purely from the base relations, using only
-- official first-team appearances (appearances >= 1) and senior national teams.
-- ============================================================================

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

  -- National team x Club: represented the national team AND >= 1 club appearance.
  insert into public.country_club_answers (national_team_id, club_id, player_id)
  select distinct pnt.national_team_id, pch.club_id, pnt.player_id
  from public.player_national_teams pnt
  join public.player_club_history pch on pch.player_id = pnt.player_id
  where pch.appearances >= 1;

  -- Club x Club: >= 1 appearance for both clubs, canonical order club_1 < club_2.
  insert into public.club_club_answers (club_1_id, club_2_id, player_id)
  select distinct
    least(a.club_id, b.club_id),
    greatest(a.club_id, b.club_id),
    a.player_id
  from public.player_club_history a
  join public.player_club_history b
    on a.player_id = b.player_id and a.club_id < b.club_id
  where a.appearances >= 1 and b.appearances >= 1;

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
