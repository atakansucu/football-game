-- ----------------------------------------------------------------------------
-- 0017_solo_challenge_combos
--
-- Problem: sp_random_challenge (solo "Start") recomputed a full GROUP BY over
-- country_club_answers / club_club_answers on EVERY call. Those answer tables
-- have 100k+ rows, so the first call after a cold cache scanned + aggregated the
-- whole table and took 5–10s (felt like a freeze on Start). Client-side warm-ups
-- only masked it.
--
-- Fix: precompute the distinct combos + answer counts into materialized views.
-- These are only a few thousand rows each, so selection is instant even on a
-- cold cache. sp_random_challenge now reads from the matviews instead of the raw
-- answer tables. Refresh them with public.refresh_solo_combos() whenever the
-- answer tables change (e.g. after a data import).
-- ----------------------------------------------------------------------------

-- Precomputed (national_team, club) combos with their answer count. Populated
-- immediately (CREATE MATERIALIZED VIEW ... AS SELECT is WITH DATA by default).
create materialized view if not exists public.country_club_combos as
  select national_team_id, club_id, count(*)::int as c
  from public.country_club_answers
  group by national_team_id, club_id;

-- Unique index enables REFRESH MATERIALIZED VIEW CONCURRENTLY.
create unique index if not exists country_club_combos_pk
  on public.country_club_combos (national_team_id, club_id);
create index if not exists country_club_combos_club_idx
  on public.country_club_combos (club_id);

-- Precomputed (club, club) combos with their answer count.
create materialized view if not exists public.club_club_combos as
  select club_1_id, club_2_id, count(*)::int as c
  from public.club_club_answers
  group by club_1_id, club_2_id;

create unique index if not exists club_club_combos_pk
  on public.club_club_combos (club_1_id, club_2_id);
create index if not exists club_club_combos_c1_idx
  on public.club_club_combos (club_1_id);
create index if not exists club_club_combos_c2_idx
  on public.club_club_combos (club_2_id);

-- ----------------------------------------------------------------------------
-- refresh_solo_combos(): rebuild both combo matviews. Call after any change to
-- the answer tables (data import). CONCURRENTLY keeps them queryable during the
-- rebuild (requires the unique indexes above).
-- ----------------------------------------------------------------------------
create or replace function public.refresh_solo_combos()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  refresh materialized view concurrently public.country_club_combos;
  refresh materialized view concurrently public.club_club_combos;
end;
$$;

-- ----------------------------------------------------------------------------
-- sp_random_challenge: same signature / same JSON shape / same difficulty tiers
-- as 0016 — but selects from the precomputed combo matviews instead of doing a
-- live GROUP BY on the answer tables.
-- ----------------------------------------------------------------------------
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
    from public.country_club_combos t
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
    from public.club_club_combos t
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
grant execute on function public.refresh_solo_combos()
  to anon, authenticated;
