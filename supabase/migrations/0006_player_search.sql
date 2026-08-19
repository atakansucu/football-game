-- ============================================================================
-- Global footballer autocomplete search.
-- IMPORTANT: this searches the ENTIRE player table and knows nothing about the
-- current round's valid answers. It must never be used to reveal which players
-- are valid for the active challenge.
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

-- Trigram index for fast fuzzy matching on normalized names.
create index if not exists players_normalized_trgm_idx
  on public.players using gin (normalized_name extensions.gin_trgm_ops);

-- Deterministic ranking: exact > prefix > token-prefix (contains) > fuzzy.
create or replace function public.search_players(p_query text)
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select public.normalize_name(p_query) as nq
  )
  select coalesce(
    json_agg(json_build_object('id', t.id, 'name', t.name)
             order by t.rank, t.sim desc, t.name),
    '[]'::json)
  from (
    select p.id, p.name,
      case
        when p.normalized_name = (select nq from q) then 0
        when p.normalized_name like (select nq from q) || '%' then 1
        when p.normalized_name like '% ' || (select nq from q) || '%' then 2
        when p.normalized_name like '%' || (select nq from q) || '%' then 3
        else 4
      end as rank,
      extensions.similarity(p.normalized_name, (select nq from q)) as sim
    from public.players p
    where (select nq from q) <> ''
      and (
        p.normalized_name like '%' || (select nq from q) || '%'
        or extensions.similarity(p.normalized_name, (select nq from q)) > 0.3
      )
    order by rank, sim desc, p.name
    limit 8
  ) t;
$$;

grant execute on function public.search_players(text) to anon, authenticated;
