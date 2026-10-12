-- ============================================================================
-- Football Duel — Single Player (score attack vs. the clock)
--
-- Two stateless RPCs power a solo mode that reuses the exact same answer tables
-- and difficulty tiers as the multiplayer game, WITHOUT touching rooms / matches
-- / rounds / realtime:
--   * sp_random_challenge(mode, difficulty) -> a random PLAYABLE combo
--   * sp_check_answer(mode, ids, name)      -> validates one guess (no answer
--                                              list is ever exposed)
-- ============================================================================

-- Is a given player a valid answer for a (mode, teams) combination?
create or replace function public.sp_player_valid(
  p_mode text,
  p_national_team_id uuid,
  p_club_1_id uuid,
  p_club_2_id uuid,
  p_player_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when p_mode = 'national_club' then exists (
      select 1 from public.country_club_answers
      where national_team_id = p_national_team_id
        and club_id = p_club_1_id
        and player_id = p_player_id
    )
    else exists (
      select 1 from public.club_club_answers
      where club_1_id = least(p_club_1_id, p_club_2_id)
        and club_2_id = greatest(p_club_1_id, p_club_2_id)
        and player_id = p_player_id
    )
  end;
$$;

grant execute on function public.sp_player_valid(text, uuid, uuid, uuid, uuid)
  to anon, authenticated;

-- Pick a random playable challenge honoring the difficulty tiers (same bands as
-- create_round). Volatile because it uses random().
create or replace function public.sp_random_challenge(
  p_mode text,
  p_difficulty text default 'easy'
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

grant execute on function public.sp_random_challenge(text, text)
  to anon, authenticated;

-- Validate a single guess against a combo. Mirrors submit_answer's name
-- resolution (exact name -> aliases -> disambiguate by validity) but is
-- stateless and never returns the set of valid answers.
create or replace function public.sp_check_answer(
  p_mode text,
  p_national_team_id uuid,
  p_club_1_id uuid,
  p_club_2_id uuid,
  p_raw_answer text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_norm text := public.normalize_name(p_raw_answer);
  v_candidates uuid[];
  v_player_id uuid;
  v_player_name text;
  v_valid_count int;
  v_valid_pid uuid;
  v_is_correct boolean;
begin
  select array_agg(id) into v_candidates
  from public.players where normalized_name = v_norm;
  if v_candidates is null then
    select array_agg(distinct player_id) into v_candidates
    from public.player_aliases where normalized_alias = v_norm;
  end if;

  if v_candidates is null then
    return json_build_object('status', 'incorrect', 'is_correct', false,
      'player_name', null);
  end if;

  if array_length(v_candidates, 1) = 1 then
    v_player_id := v_candidates[1];
  else
    select count(*), min(pid) into v_valid_count, v_valid_pid
    from unnest(v_candidates) as pid
    where public.sp_player_valid(
      p_mode, p_national_team_id, p_club_1_id, p_club_2_id, pid);

    if v_valid_count = 1 then
      v_player_id := v_valid_pid;
    elsif v_valid_count = 0 then
      -- Name matches several players, none valid: report as a wrong guess.
      select name into v_player_name from public.players
        where id = v_candidates[1];
      return json_build_object('status', 'incorrect', 'is_correct', false,
        'player_name', v_player_name);
    else
      return json_build_object('status', 'ambiguous', 'is_correct', false,
        'player_name', null);
    end if;
  end if;

  v_is_correct := public.sp_player_valid(
    p_mode, p_national_team_id, p_club_1_id, p_club_2_id, v_player_id);
  select name into v_player_name from public.players where id = v_player_id;

  return json_build_object(
    'status', case when v_is_correct then 'correct' else 'incorrect' end,
    'is_correct', v_is_correct,
    'player_name', v_player_name
  );
end;
$$;

grant execute on function public.sp_check_answer(text, uuid, uuid, uuid, text)
  to anon, authenticated;
