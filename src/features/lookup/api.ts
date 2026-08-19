import type { SupabaseClient } from "@supabase/supabase-js";

export interface LookupClub {
  name: string;
  appearances: number | null;
}

export interface LookupPlayer {
  player_id: string;
  name: string;
  national_teams: string[];
  clubs: LookupClub[];
}

export interface NamedEntity {
  id: string;
  name: string;
}

/**
 * Players valid for a National Team x Club combination. Backed by the same
 * answer tables the multiplayer game uses (single source of truth).
 */
export async function getPlayersForCountryClub(
  supabase: SupabaseClient,
  nationalTeamId: string,
  clubId: string,
): Promise<LookupPlayer[]> {
  const { data, error } = await supabase.rpc("get_players_for_country_club", {
    p_national_team_id: nationalTeamId,
    p_club_id: clubId,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as LookupPlayer[]) ?? [];
}

/**
 * Players valid for a Club x Club combination (appeared for both clubs).
 */
export async function getPlayersForClubClub(
  supabase: SupabaseClient,
  clubAId: string,
  clubBId: string,
): Promise<LookupPlayer[]> {
  const { data, error } = await supabase.rpc("get_players_for_club_club", {
    p_club_a_id: clubAId,
    p_club_b_id: clubBId,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as LookupPlayer[]) ?? [];
}

export async function fetchClubs(
  supabase: SupabaseClient,
): Promise<NamedEntity[]> {
  const { data, error } = await supabase
    .from("clubs")
    .select("id, name")
    .order("name");
  if (error) throw new Error(error.message);
  return (data as NamedEntity[]) ?? [];
}

export async function fetchNationalTeams(
  supabase: SupabaseClient,
): Promise<NamedEntity[]> {
  const { data, error } = await supabase
    .from("national_teams")
    .select("id, name")
    .order("name");
  if (error) throw new Error(error.message);
  return (data as NamedEntity[]) ?? [];
}
