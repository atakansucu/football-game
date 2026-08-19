-- ============================================================================
-- Football Duel — demo seed data (real players)
-- Enough coverage for every example challenge in the brief. Names are inserted
-- verbatim; normalized_name is computed with the same rules the game uses.
-- Runs after migrations on `supabase db reset`.
--
-- Idempotent: the football reference tables are cleared first so re-running the
-- seed (or the combined cloud-setup.sql) never produces duplicate players/clubs.
-- This only touches football/answer data (and, via cascade, any in-progress
-- rounds); it does not remove rooms or players from a lobby.
-- ============================================================================

truncate table
  public.country_club_answers,
  public.club_club_answers,
  public.player_aliases,
  public.player_club_history,
  public.player_national_teams,
  public.players,
  public.clubs,
  public.national_teams
restart identity cascade;

insert into public.clubs (name) values
  ('Real Madrid'),
  ('Arsenal'),
  ('Barcelona'),
  ('Juventus'),
  ('Manchester United'),
  ('Chelsea'),
  ('Manchester City')
on conflict do nothing;

insert into public.national_teams (name) values
  ('Turkey'),
  ('Germany'),
  ('France'),
  ('Brazil'),
  ('Portugal'),
  ('England'),
  ('Argentina'),
  ('Croatia'),
  ('Sweden'),
  ('Czech Republic'),
  ('Spain'),
  ('Chile')
on conflict do nothing;

insert into public.players (name) values
  ('Arda Güler'),
  ('Toni Kroos'),
  ('Mesut Özil'),
  ('Cristiano Ronaldo'),
  ('David Beckham'),
  ('Ángel Di María'),
  ('Sami Khedira'),
  ('Luka Modrić'),
  ('Thierry Henry'),
  ('Cesc Fàbregas'),
  ('Alexis Sánchez'),
  ('Olivier Giroud'),
  ('Petr Čech'),
  ('David Luiz'),
  ('Laurent Koscielny'),
  ('Ronaldinho'),
  ('Dani Alves'),
  ('Neymar'),
  ('Zlatan Ibrahimović'),
  ('İlkay Gündoğan'),
  ('Leroy Sané')
on conflict do nothing;

update public.clubs set normalized_name = public.normalize_name(name);
update public.national_teams set normalized_name = public.normalize_name(name);
update public.players set normalized_name = public.normalize_name(name);

-- Official first-team appearances (>= 1 only).
insert into public.player_club_history (player_id, club_id, appearances)
select p.id, c.id, v.appearances
from (values
  ('Arda Güler', 'Real Madrid', 30),
  ('Toni Kroos', 'Real Madrid', 250),
  ('Mesut Özil', 'Real Madrid', 105),
  ('Mesut Özil', 'Arsenal', 184),
  ('Cristiano Ronaldo', 'Manchester United', 196),
  ('Cristiano Ronaldo', 'Real Madrid', 292),
  ('Cristiano Ronaldo', 'Juventus', 98),
  ('David Beckham', 'Manchester United', 265),
  ('David Beckham', 'Real Madrid', 116),
  ('Ángel Di María', 'Real Madrid', 124),
  ('Ángel Di María', 'Manchester United', 27),
  ('Sami Khedira', 'Real Madrid', 95),
  ('Sami Khedira', 'Juventus', 82),
  ('Luka Modrić', 'Real Madrid', 400),
  ('Thierry Henry', 'Arsenal', 258),
  ('Thierry Henry', 'Barcelona', 80),
  ('Cesc Fàbregas', 'Arsenal', 212),
  ('Cesc Fàbregas', 'Barcelona', 96),
  ('Cesc Fàbregas', 'Chelsea', 156),
  ('Alexis Sánchez', 'Arsenal', 122),
  ('Alexis Sánchez', 'Barcelona', 65),
  ('Olivier Giroud', 'Arsenal', 180),
  ('Olivier Giroud', 'Chelsea', 75),
  ('Petr Čech', 'Chelsea', 333),
  ('Petr Čech', 'Arsenal', 139),
  ('David Luiz', 'Chelsea', 248),
  ('David Luiz', 'Arsenal', 73),
  ('Laurent Koscielny', 'Arsenal', 353),
  ('Ronaldinho', 'Barcelona', 207),
  ('Dani Alves', 'Barcelona', 391),
  ('Dani Alves', 'Juventus', 33),
  ('Neymar', 'Barcelona', 186),
  ('Zlatan Ibrahimović', 'Barcelona', 46),
  ('Zlatan Ibrahimović', 'Juventus', 117),
  ('Zlatan Ibrahimović', 'Manchester United', 53),
  ('İlkay Gündoğan', 'Manchester City', 304),
  ('İlkay Gündoğan', 'Barcelona', 50),
  ('Leroy Sané', 'Manchester City', 135)
) as v(player_name, club_name, appearances)
join public.players p on p.name = v.player_name
join public.clubs c on c.name = v.club_name
on conflict do nothing;

-- Senior national teams.
insert into public.player_national_teams (player_id, national_team_id)
select p.id, n.id
from (values
  ('Arda Güler', 'Turkey'),
  ('Toni Kroos', 'Germany'),
  ('Mesut Özil', 'Germany'),
  ('Cristiano Ronaldo', 'Portugal'),
  ('David Beckham', 'England'),
  ('Ángel Di María', 'Argentina'),
  ('Sami Khedira', 'Germany'),
  ('Luka Modrić', 'Croatia'),
  ('Thierry Henry', 'France'),
  ('Cesc Fàbregas', 'Spain'),
  ('Alexis Sánchez', 'Chile'),
  ('Olivier Giroud', 'France'),
  ('Petr Čech', 'Czech Republic'),
  ('David Luiz', 'Brazil'),
  ('Laurent Koscielny', 'France'),
  ('Ronaldinho', 'Brazil'),
  ('Dani Alves', 'Brazil'),
  ('Neymar', 'Brazil'),
  ('Zlatan Ibrahimović', 'Sweden'),
  ('İlkay Gündoğan', 'Germany'),
  ('Leroy Sané', 'Germany')
) as v(player_name, nt_name)
join public.players p on p.name = v.player_name
join public.national_teams n on n.name = v.nt_name
on conflict do nothing;

-- A few aliases / short forms.
insert into public.player_aliases (player_id, alias, normalized_alias)
select p.id, v.alias, public.normalize_name(v.alias)
from (values
  ('Cristiano Ronaldo', 'CR7'),
  ('Cristiano Ronaldo', 'Cristiano'),
  ('Zlatan Ibrahimović', 'Ibra'),
  ('Zlatan Ibrahimović', 'Zlatan'),
  ('Cesc Fàbregas', 'Cesc'),
  ('Neymar', 'Neymar Jr'),
  ('Ángel Di María', 'Di Maria'),
  ('İlkay Gündoğan', 'Gundogan')
) as v(player_name, alias)
join public.players p on p.name = v.player_name
on conflict do nothing;

select public.rebuild_answers();
