-- ----------------------------------------------------------------------------
-- 0012 — Difficulty by REAL fame, not a derived player count.
--
-- The prominence count ("how many capped players passed through") ranked gateway
-- clubs (Benfica, Genoa, Ajax) above giants (Real Madrid, Bayern), so it did not
-- reflect recognizability. Instead we assign popularity_rank from a hand-curated
-- fame list (matched to the real dataset names). Teams NOT on the list get a huge
-- rank, so they only ever appear in HARD.
--
-- Tiers combine fame rank AND common-player count (t.c):
--   national team:  easy <= 21   medium <= 42   hard = all
--   club:           easy <= 30   medium <= 60   hard = all
--   common players: easy >= 5    medium >= 3    hard >= 1
-- A combo must satisfy BOTH its fame caps and its count threshold; if none do
-- (rare), the round still falls back to any playable pair rather than failing.
-- ----------------------------------------------------------------------------

alter table public.clubs
  add column if not exists popularity_rank int not null default 0;
alter table public.national_teams
  add column if not exists popularity_rank int not null default 0;

-- New rooms default to Easy difficulty.
alter table public.rooms alter column difficulty set default 'easy';

-- Prominence (kept as an informational metric) + curated fame rank.
create or replace function public.rebuild_prominence()
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  -- Informational only: distinct capped players seen at the club / nation.
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

  -- Fame rank: curated. Anything unlisted -> 9999 (hard only).
  update public.national_teams set popularity_rank = 9999;
  update public.national_teams n set popularity_rank = v.rn
  from (values
    ('Brazil',1),('Argentina',2),('Germany',3),('France',4),('Spain',5),
    ('England',6),('Italy',7),('Portugal',8),('Netherlands',9),('Belgium',10),
    ('Croatia',11),('Uruguay',12),('Mexico',13),('United States',14),('Colombia',15),
    ('Denmark',16),('Sweden',17),('Switzerland',18),('Poland',19),('Japan',20),
    ('Morocco',21),
    ('Serbia',22),('Türkiye',23),('Wales',24),('Scotland',25),('Nigeria',26),
    ('Senegal',27),('Ghana',28),('Austria',29),('Ukraine',30),('Czech Republic',31),
    ('Greece',32),('Norway',33),('Russia',34),('Ireland',35),('Chile',36),
    ('Ecuador',37),('Australia',38),('Korea, South',39),('Algeria',40),('Egypt',41),
    ('Hungary',42)
  ) as v(name, rn)
  where n.name = v.name;

  update public.clubs set popularity_rank = 9999;
  update public.clubs c set popularity_rank = v.rn
  from (values
    ('Real Madrid',1),('FC Barcelona',2),('Manchester United',3),('Liverpool FC',4),
    ('Bayern Munich',5),('Manchester City',6),('Paris Saint-Germain',7),('Juventus FC',8),
    ('Chelsea FC',9),('Arsenal FC',10),('AC Milan',11),('Inter Milan',12),
    ('Borussia Dortmund',13),('Atlético de Madrid',14),('Tottenham Hotspur',15),('SSC Napoli',16),
    ('Ajax Amsterdam',17),('FC Porto',18),('SL Benfica',19),('Sporting CP',20),
    ('Sevilla FC',21),('AS Monaco',22),('Olympique Marseille',23),('Olympique Lyon',24),
    ('Associazione Sportiva Roma',25),('Società Sportiva Lazio S.p.A.',26),('Valencia CF',27),('Villarreal CF',28),
    ('Bayer 04 Leverkusen',29),('RB Leipzig',30),('Atalanta BC',31),('Galatasaray',32),
    ('Fenerbahce',33),('Beşiktaş Jimnastik Kulübü',34),('Celtic FC',35),('Rangers FC',36),
    ('Feyenoord Rotterdam',37),('PSV Eindhoven',38),('Newcastle United',39),('Leicester City',40),
    ('Everton FC',41),('Aston Villa',42),('West Ham United',43),('Real Sociedad',44),
    ('Real Betis Balompié',45),('Wolverhampton Wanderers',46),('Leeds United',47),('RC Lens',48),
    ('LOSC Lille',49),('OGC Nice',50),('Stade Rennais FC',51),('FC Schalke 04',52),
    ('VfB Stuttgart',53),('Eintracht Frankfurt',54),('Borussia Mönchengladbach',55),('VfL Wolfsburg',56),
    ('1.FC Köln',57),('SV Werder Bremen',58),('Hamburger SV',59),('ACF Fiorentina',60),
    ('Torino FC',61),('Bologna Football Club 1909',62),('Udinese Calcio',63),('Genoa CFC',64),
    ('UC Sampdoria',65),('Club Brugge KV',66),('RSC Anderlecht',67),('Standard Liège',68),
    ('KAA Gent',69),('FC Shakhtar Donetsk',70),('Dynamo Kyiv',71),('AO FK Zenit Sankt-Peterburg',72),
    ('FK Spartak Moskva',73),('PFK CSKA Moskva',74),('Trabzonspor',75),('FC Copenhagen',76),
    ('Panathinaikos Athlitikos Omilos',77),('Olympiakos Syndesmos Filathlon Peiraios',78),
    ('GNK Dinamo Zagreb',79),('Red Star Belgrade',80)
  ) as v(name, rn)
  where c.name = v.name;

  update public.clubs set is_popular = (popularity_rank between 1 and 40);
  update public.national_teams set is_popular = (popularity_rank between 1 and 21);
end;
$$;

grant execute on function public.rebuild_prominence() to anon, authenticated;

-- create_round already reads popularity_rank tiers (0011). Re-declared here so
-- running 0012 alone is sufficient.
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

-- Apply curated fame ranking to the data already in this project.
select public.rebuild_prominence();
