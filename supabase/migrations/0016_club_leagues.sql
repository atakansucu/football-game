-- ============================================================================
-- 0016 — Optional LEAGUE filter for Random challenges (curated, no re-import).
--
-- Players can restrict Random challenges to a single league (e.g. "Premier
-- League"). "All leagues" = no filter (the previous behavior, league is null).
--
--   * clubs.league  : curated, hand-mapped by club NAME (same style as the
--                     0012 fame list / 0014 logo list). Clubs not mapped keep
--                     NULL and only ever appear under "All leagues".
--   * rooms.league  : lobby setting, threaded into create_round exactly like
--                     difficulty is (start_match / start_round / play_again /
--                     ready_next_round all forward it).
--
-- When a league is chosen, Random selection is restricted to clubs in that
-- league: in national_club mode the CLUB side must match; in club_club mode
-- BOTH clubs must match. Playability (>= 1 common player) is still guaranteed
-- because selection only ever draws from the precomputed answer tables.
--
-- Idempotent: safe to re-run (create or replace / add column if not exists /
-- the league UPDATE simply re-applies the same mapping).
-- ============================================================================

alter table public.clubs add column if not exists league text;
create index if not exists clubs_league_idx on public.clubs (league);

alter table public.rooms add column if not exists league text;

-- ----------------------------------------------------------------------------
-- Curated club -> league mapping. Names MUST match public.clubs.name exactly
-- (taken from the 0012 fame list and 0014 logo list). Unlisted clubs stay NULL.
-- ----------------------------------------------------------------------------
update public.clubs c set league = v.league
from (values
  -- ---- Süper Lig (Turkey) --------------------------------------------------
  ('Galatasaray', 'Süper Lig'),
  ('Fenerbahce', 'Süper Lig'),
  ('Beşiktaş Jimnastik Kulübü', 'Süper Lig'),
  ('Trabzonspor', 'Süper Lig'),
  ('Basaksehir FK', 'Süper Lig'),
  ('Adana Demirspor', 'Süper Lig'),
  ('Alanyaspor', 'Süper Lig'),
  ('Antalyaspor', 'Süper Lig'),
  ('Kasimpasa', 'Süper Lig'),
  ('Konyaspor', 'Süper Lig'),
  ('Sivasspor', 'Süper Lig'),
  ('Kayserispor', 'Süper Lig'),
  ('Caykur Rizespor', 'Süper Lig'),
  ('Gaziantep FK', 'Süper Lig'),
  ('Hatayspor', 'Süper Lig'),
  ('Samsunspor', 'Süper Lig'),
  ('Göztepe', 'Süper Lig'),
  ('Eyüpspor', 'Süper Lig'),
  ('Bodrum FK', 'Süper Lig'),
  ('MKE Ankaragücü', 'Süper Lig'),
  ('Fatih Karagümrük', 'Süper Lig'),
  ('Gençlerbirliği Spor Kulübü', 'Süper Lig'),
  ('Kocaelispor', 'Süper Lig'),
  ('Bursaspor', 'Süper Lig'),

  -- ---- Premier League (England) --------------------------------------------
  ('Arsenal FC', 'Premier League'),
  ('Aston Villa', 'Premier League'),
  ('AFC Bournemouth', 'Premier League'),
  ('Brentford FC', 'Premier League'),
  ('Brighton & Hove Albion', 'Premier League'),
  ('Chelsea FC', 'Premier League'),
  ('Crystal Palace', 'Premier League'),
  ('Everton FC', 'Premier League'),
  ('Fulham FC', 'Premier League'),
  ('Ipswich Town', 'Premier League'),
  ('Leicester City', 'Premier League'),
  ('Liverpool FC', 'Premier League'),
  ('Manchester City', 'Premier League'),
  ('Manchester United', 'Premier League'),
  ('Newcastle United', 'Premier League'),
  ('Nottingham Forest', 'Premier League'),
  ('Southampton FC', 'Premier League'),
  ('Tottenham Hotspur', 'Premier League'),
  ('West Ham United', 'Premier League'),
  ('Wolverhampton Wanderers', 'Premier League'),
  ('Leeds United', 'Premier League'),
  ('Burnley FC', 'Premier League'),
  ('Sunderland AFC', 'Premier League'),

  -- ---- English Championship (second tier) ----------------------------------
  ('Sheffield United', 'Championship'),
  ('West Bromwich Albion', 'Championship'),
  ('Middlesbrough FC', 'Championship'),
  ('Norwich City', 'Championship'),
  ('Watford FC', 'Championship'),
  ('Hull City', 'Championship'),
  ('Cardiff City', 'Championship'),
  ('Stoke City', 'Championship'),
  ('Queens Park Rangers', 'Championship'),
  ('Swansea City', 'Championship'),
  ('Luton Town', 'Championship'),
  ('Huddersfield Town', 'Championship'),
  ('Wigan Athletic', 'Championship'),
  ('Reading FC', 'Championship'),

  -- ---- La Liga (Spain) -----------------------------------------------------
  ('Real Madrid', 'La Liga'),
  ('FC Barcelona', 'La Liga'),
  ('Atlético de Madrid', 'La Liga'),
  ('Sevilla FC', 'La Liga'),
  ('Valencia CF', 'La Liga'),
  ('Villarreal CF', 'La Liga'),
  ('Real Sociedad', 'La Liga'),
  ('Real Betis Balompié', 'La Liga'),
  ('Athletic Bilbao', 'La Liga'),
  ('Celta de Vigo', 'La Liga'),
  ('CA Osasuna', 'La Liga'),
  ('Getafe CF', 'La Liga'),
  ('Rayo Vallecano', 'La Liga'),
  ('RCD Espanyol Barcelona', 'La Liga'),
  ('RCD Mallorca', 'La Liga'),
  ('Deportivo Alavés', 'La Liga'),
  ('Girona FC', 'La Liga'),
  ('UD Las Palmas', 'La Liga'),
  ('Granada CF', 'La Liga'),
  ('Elche CF', 'La Liga'),
  ('Real Valladolid CF', 'La Liga'),
  ('Levante UD', 'La Liga'),
  ('Real Oviedo', 'La Liga'),

  -- ---- Serie A (Italy) -----------------------------------------------------
  ('Juventus FC', 'Serie A'),
  ('AC Milan', 'Serie A'),
  ('Inter Milan', 'Serie A'),
  ('SSC Napoli', 'Serie A'),
  ('Associazione Sportiva Roma', 'Serie A'),
  ('Società Sportiva Lazio S.p.A.', 'Serie A'),
  ('ACF Fiorentina', 'Serie A'),
  ('Atalanta BC', 'Serie A'),
  ('Torino FC', 'Serie A'),
  ('Bologna Football Club 1909', 'Serie A'),
  ('Udinese Calcio', 'Serie A'),
  ('Genoa CFC', 'Serie A'),
  ('UC Sampdoria', 'Serie A'),
  ('US Sassuolo', 'Serie A'),
  ('US Lecce', 'Serie A'),
  ('Hellas Verona', 'Serie A'),
  ('Cagliari Calcio', 'Serie A'),
  ('Parma Calcio 1913', 'Serie A'),
  ('Como 1907', 'Serie A'),
  ('Venezia FC', 'Serie A'),
  ('FC Empoli', 'Serie A'),
  ('AC Monza', 'Serie A'),
  ('US Cremonese', 'Serie A'),
  ('US Salernitana 1919', 'Serie A'),
  ('Pisa Sporting Club', 'Serie A'),

  -- ---- Bundesliga (Germany) ------------------------------------------------
  ('Bayern Munich', 'Bundesliga'),
  ('Borussia Dortmund', 'Bundesliga'),
  ('RB Leipzig', 'Bundesliga'),
  ('Bayer 04 Leverkusen', 'Bundesliga'),
  ('Borussia Mönchengladbach', 'Bundesliga'),
  ('VfL Wolfsburg', 'Bundesliga'),
  ('Eintracht Frankfurt', 'Bundesliga'),
  ('VfB Stuttgart', 'Bundesliga'),
  ('SC Freiburg', 'Bundesliga'),
  ('TSG 1899 Hoffenheim', 'Bundesliga'),
  ('1.FC Köln', 'Bundesliga'),
  ('SV Werder Bremen', 'Bundesliga'),
  ('FC Augsburg', 'Bundesliga'),
  ('1.FSV Mainz 05', 'Bundesliga'),
  ('1.FC Union Berlin', 'Bundesliga'),
  ('VfL Bochum', 'Bundesliga'),
  ('FC Schalke 04', 'Bundesliga'),
  ('Hamburger SV', 'Bundesliga'),
  ('Hertha BSC', 'Bundesliga'),
  ('Hannover 96', 'Bundesliga'),
  ('Fortuna Düsseldorf', 'Bundesliga'),
  ('Holstein Kiel', 'Bundesliga'),
  ('FC St. Pauli', 'Bundesliga'),
  ('1. Fußballclub Heidenheim 1846', 'Bundesliga'),
  ('SV Darmstadt 98', 'Bundesliga'),

  -- ---- Ligue 1 (France) ----------------------------------------------------
  ('Paris Saint-Germain', 'Ligue 1'),
  ('Olympique Marseille', 'Ligue 1'),
  ('Olympique Lyon', 'Ligue 1'),
  ('AS Monaco', 'Ligue 1'),
  ('LOSC Lille', 'Ligue 1'),
  ('OGC Nice', 'Ligue 1'),
  ('Stade Rennais FC', 'Ligue 1'),
  ('RC Lens', 'Ligue 1'),
  ('RC Strasbourg Alsace', 'Ligue 1'),
  ('FC Nantes', 'Ligue 1'),
  ('Montpellier HSC', 'Ligue 1'),
  ('Stade Reims', 'Ligue 1'),
  ('Stade Brestois 29', 'Ligue 1'),
  ('FC Toulouse', 'Ligue 1'),
  ('FC Lorient', 'Ligue 1'),
  ('Angers SCO', 'Ligue 1'),
  ('AJ Auxerre', 'Ligue 1'),
  ('Le Havre AC', 'Ligue 1'),
  ('AS Saint-Étienne', 'Ligue 1'),
  ('FC Metz', 'Ligue 1'),
  ('FC Girondins Bordeaux', 'Ligue 1'),
  ('Paris FC', 'Ligue 1'),

  -- ---- Eredivisie (Netherlands) --------------------------------------------
  ('Ajax Amsterdam', 'Eredivisie'),
  ('PSV Eindhoven', 'Eredivisie'),
  ('Feyenoord Rotterdam', 'Eredivisie'),
  ('AZ Alkmaar', 'Eredivisie'),
  ('FC Twente Enschede', 'Eredivisie'),
  ('FC Utrecht', 'Eredivisie'),
  ('Vitesse Arnhem', 'Eredivisie'),
  ('SC Heerenveen', 'Eredivisie'),
  ('FC Groningen', 'Eredivisie'),
  ('NEC Nijmegen', 'Eredivisie'),
  ('Sparta Rotterdam', 'Eredivisie'),
  ('PEC Zwolle', 'Eredivisie'),
  ('Go Ahead Eagles', 'Eredivisie'),
  ('Willem II Tilburg', 'Eredivisie'),
  ('NAC Breda', 'Eredivisie'),
  ('Heracles Almelo', 'Eredivisie'),
  ('RKC Waalwijk', 'Eredivisie'),
  ('Almere City FC', 'Eredivisie'),
  ('FC Volendam', 'Eredivisie'),
  ('Excelsior Rotterdam', 'Eredivisie'),
  ('Fortuna Sittardia Combinatie', 'Eredivisie'),

  -- ---- Primeira Liga (Portugal) --------------------------------------------
  ('FC Porto', 'Primeira Liga'),
  ('SL Benfica', 'Primeira Liga'),
  ('Sporting CP', 'Primeira Liga'),
  ('SC Braga', 'Primeira Liga'),
  ('Vitória Guimarães SC', 'Primeira Liga'),
  ('Boavista FC', 'Primeira Liga'),
  ('Rio Ave FC', 'Primeira Liga'),
  ('GD Estoril Praia', 'Primeira Liga'),
  ('Gil Vicente FC', 'Primeira Liga'),
  ('Moreirense FC', 'Primeira Liga'),
  ('FC Famalicão', 'Primeira Liga'),
  ('CD Santa Clara', 'Primeira Liga'),
  ('FC Arouca', 'Primeira Liga'),
  ('Casa Pia AC', 'Primeira Liga'),
  ('GD Chaves', 'Primeira Liga'),
  ('Portimonense SC', 'Primeira Liga'),
  ('CD Nacional', 'Primeira Liga'),
  ('FC Paços de Ferreira', 'Primeira Liga'),
  ('CS Marítimo', 'Primeira Liga'),
  ('CD Tondela', 'Primeira Liga'),
  ('FC Alverca', 'Primeira Liga'),
  ('Avs Futebol', 'Primeira Liga'),
  ('CF Estrela Amadora', 'Primeira Liga')
) as v(name, league)
where c.name = v.name;

-- ----------------------------------------------------------------------------
-- create_round: Random selection with difficulty tiers (0012) + league filter.
-- Adds p_league (default null = All leagues). When set, restricts the CLUB side
-- (national_club) or BOTH clubs (club_club) to that league.
-- ----------------------------------------------------------------------------
drop function if exists public.create_round(uuid, text, int, text, text);

create or replace function public.create_round(
  p_match_id uuid,
  p_mode text,
  p_round_number int,
  p_challenge_type text default 'random',
  p_difficulty text default 'medium',
  p_league text default null
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
    where (p_league is null or cl.league = p_league)
    order by
      case p_difficulty
        when 'easy' then
          (case when cl.popularity_rank <= 30 and ntt.popularity_rank <= 21
                     and t.c >= 5
                then 0 else 1 end)
        when 'hard' then (case when t.c >= 1 then 0 else 1 end)
        else
          (case when cl.popularity_rank <= 60 and ntt.popularity_rank <= 42
                     and t.c >= 3
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
    where (p_league is null or (ca.league = p_league and cb.league = p_league))
    order by
      case p_difficulty
        when 'easy' then
          (case when ca.popularity_rank <= 30 and cb.popularity_rank <= 30
                     and t.c >= 5
                then 0 else 1 end)
        when 'hard' then (case when t.c >= 1 then 0 else 1 end)
        else
          (case when ca.popularity_rank <= 60 and cb.popularity_rank <= 60
                     and t.c >= 3
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

grant execute on function public.create_round(uuid, text, int, text, text, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Forward the room league everywhere create_round is called (mirrors 0008's
-- difficulty threading).
-- ----------------------------------------------------------------------------
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
  v_league text;
  v_players int;
  v_match_id uuid;
  v_round_id uuid;
begin
  perform public.assert_host(v_user, p_room_id);

  select count(*) into v_players from public.room_players where room_id = p_room_id;
  if v_players < 2 then
    return json_build_object('status', 'not_enough_players');
  end if;

  select game_mode, challenge_type, difficulty, league
    into v_mode, v_ctype, v_diff, v_league
  from public.rooms where id = p_room_id;

  update public.rooms set status = 'playing' where id = p_room_id;

  insert into public.matches (room_id, status)
  values (p_room_id, 'active')
  returning id into v_match_id;

  v_round_id := public.create_round(v_match_id, v_mode, 1, v_ctype, v_diff, v_league);

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
  v_league text;
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

  select game_mode, challenge_type, difficulty, league
    into v_mode, v_ctype, v_diff, v_league
  from public.rooms where id = p_room_id;
  select coalesce(max(round_number), 0) + 1 into v_num
  from public.rounds where match_id = v_match.id;

  v_round_id := public.create_round(v_match.id, v_mode, v_num, v_ctype, v_diff, v_league);
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
  v_league text;
  v_match_id uuid;
  v_round_id uuid;
begin
  perform public.assert_host(v_user, p_room_id);

  update public.matches set status = 'finished'
  where room_id = p_room_id and status = 'active';

  select game_mode, challenge_type, difficulty, league
    into v_mode, v_ctype, v_diff, v_league
  from public.rooms where id = p_room_id;
  update public.rooms set status = 'playing' where id = p_room_id;

  insert into public.matches (room_id, status)
  values (p_room_id, 'active')
  returning id into v_match_id;

  v_round_id := public.create_round(v_match_id, v_mode, 1, v_ctype, v_diff, v_league);

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
    v_match.id, v_room.game_mode, v_num, v_room.challenge_type,
    v_room.difficulty, v_room.league
  );
  return json_build_object('status', 'advanced', 'round_id', v_round_id);
end;
$$;

grant execute on function public.ready_next_round(uuid, uuid)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- create_room: record the chosen league (defaults to null = All leagues).
-- ----------------------------------------------------------------------------
drop function if exists public.create_room(uuid, text, text, int, text);

create or replace function public.create_room(
  p_user_id uuid,
  p_display_name text,
  p_game_mode text,
  p_win_target int,
  p_challenge_type text default 'random',
  p_league text default null
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
                            challenge_type, league, host_user_id)
  values (v_code, 'waiting', coalesce(p_game_mode, 'national_club'),
          coalesce(p_win_target, 5),
          coalesce(p_challenge_type, 'random'), p_league, v_user)
  returning id into v_room_id;

  insert into public.room_players (room_id, user_id, slot, display_name)
  values (v_room_id, v_user, 1, p_display_name);

  return json_build_object('status', 'ok', 'room_id', v_room_id, 'code', v_code);
end;
$$;

grant execute on function public.create_room(uuid, text, text, int, text, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- set_room_settings: accept league (host only, before playing). A null league
-- keeps the existing value (coalesce) so lobby difficulty / win-target changes
-- never wipe the league chosen at creation.
-- ----------------------------------------------------------------------------
drop function if exists public.set_room_settings(uuid, uuid, text, int, text, text);

create or replace function public.set_room_settings(
  p_user_id uuid,
  p_room_id uuid,
  p_game_mode text,
  p_win_target int,
  p_challenge_type text default null,
  p_difficulty text default null,
  p_league text default null
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
        difficulty = coalesce(p_difficulty, difficulty),
        league = coalesce(p_league, league)
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

grant execute on function public.set_room_settings(uuid, uuid, text, int, text, text, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- sp_random_challenge (solo): add an optional league filter. Same tiers as
-- 0013, but Random selection is restricted to the chosen league when set.
-- ----------------------------------------------------------------------------
drop function if exists public.sp_random_challenge(text, text);

create or replace function public.sp_random_challenge(
  p_mode text,
  p_difficulty text default 'easy',
  p_league text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nt uuid;
  v_c1 uuid;
  v_c2 uuid;
begin
  if p_mode = 'national_club' then
    select t.national_team_id, t.club_id into v_nt, v_c1
    from (
      select national_team_id, club_id, count(*)::int as c
      from public.country_club_answers
      group by national_team_id, club_id
    ) t
    join public.clubs cl on cl.id = t.club_id
    join public.national_teams ntt on ntt.id = t.national_team_id
    where (p_league is null or cl.league = p_league)
    order by
      case p_difficulty
        when 'easy' then
          (case when cl.popularity_rank <= 30 and ntt.popularity_rank <= 21
                     and t.c >= 5 then 0 else 1 end)
        when 'hard' then (case when t.c >= 1 then 0 else 1 end)
        else
          (case when cl.popularity_rank <= 60 and ntt.popularity_rank <= 42
                     and t.c >= 3 then 0 else 1 end)
      end,
      random()
    limit 1;

    if v_nt is null then
      raise exception 'No playable national_club challenge available';
    end if;

    return json_build_object(
      'mode', 'national_club',
      'national_team_id', v_nt,
      'national_team_name', (select name from public.national_teams where id = v_nt),
      'club_1_id', v_c1,
      'club_1_name', (select name from public.clubs where id = v_c1),
      'club_2_id', null,
      'club_2_name', null
    );
  else
    select t.club_1_id, t.club_2_id into v_c1, v_c2
    from (
      select club_1_id, club_2_id, count(*)::int as c
      from public.club_club_answers
      group by club_1_id, club_2_id
    ) t
    join public.clubs ca on ca.id = t.club_1_id
    join public.clubs cb on cb.id = t.club_2_id
    where (p_league is null or (ca.league = p_league and cb.league = p_league))
    order by
      case p_difficulty
        when 'easy' then
          (case when ca.popularity_rank <= 30 and cb.popularity_rank <= 30
                     and t.c >= 5 then 0 else 1 end)
        when 'hard' then (case when t.c >= 1 then 0 else 1 end)
        else
          (case when ca.popularity_rank <= 60 and cb.popularity_rank <= 60
                     and t.c >= 3 then 0 else 1 end)
      end,
      random()
    limit 1;

    if v_c1 is null then
      raise exception 'No playable club_club challenge available';
    end if;

    return json_build_object(
      'mode', 'club_club',
      'national_team_id', null,
      'national_team_name', null,
      'club_1_id', v_c1,
      'club_1_name', (select name from public.clubs where id = v_c1),
      'club_2_id', v_c2,
      'club_2_name', (select name from public.clubs where id = v_c2)
    );
  end if;
end;
$$;

grant execute on function public.sp_random_challenge(text, text, text)
  to anon, authenticated;
