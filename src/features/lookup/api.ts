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

/** A player's full profile (entire career) for the lookup detail view. */
export interface PlayerProfile {
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

// Player profiles are immutable within a session, so we cache them by id and
// dedupe concurrent requests. This lets the /lookup detail view render the full
// career instantly once it's been prefetched (or opened once).
const profileCache = new Map<string, PlayerProfile | null>();
const profileInflight = new Map<string, Promise<PlayerProfile | null>>();

/** Last-known full profile for a player, if already fetched this session. */
export function getCachedProfile(playerId: string): PlayerProfile | null {
  return profileCache.get(playerId) ?? null;
}

/**
 * A single player's full profile: every club they've played for (with
 * appearances) and all their national teams. Used by the tap-to-expand detail
 * view on /lookup. Cached + deduped so repeat/prefetched reads are instant.
 */
export function getPlayerProfile(
  supabase: SupabaseClient,
  playerId: string,
): Promise<PlayerProfile | null> {
  return prefetchPlayerProfile(supabase, playerId);
}

/**
 * Fetch (and cache) a player's profile without needing the result — used to
 * warm the detail view before the user taps to expand.
 */
export function prefetchPlayerProfile(
  supabase: SupabaseClient,
  playerId: string,
): Promise<PlayerProfile | null> {
  if (profileCache.has(playerId)) {
    return Promise.resolve(profileCache.get(playerId) ?? null);
  }
  const existing = profileInflight.get(playerId);
  if (existing) return existing;

  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc("get_player_profile", {
        p_player_id: playerId,
      });
      if (error) throw new Error(error.message);
      const profile = (data as unknown as PlayerProfile) ?? null;
      profileCache.set(playerId, profile);
      return profile;
    } finally {
      profileInflight.delete(playerId);
    }
  })();
  profileInflight.set(playerId, p);
  return p;
}

// Reference data barely changes, so we cache it aggressively:
//  - a module-level in-flight promise dedupes concurrent requests,
//  - localStorage persists it across app restarts so the Lookup / selection
//    screens can render their lists INSTANTLY (from the last session) and then
//    refresh in the background.
let clubsCache: Promise<NamedEntity[]> | null = null;
let nationalTeamsCache: Promise<NamedEntity[]> | null = null;

const CLUBS_KEY = "fd-ref-clubs";
const NT_KEY = "fd-ref-nt";

function readLS(key: string): NamedEntity[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return null;

    // Keep only factual fields and migrate older caches that included logo URLs.
    const entities = parsed.flatMap((value): NamedEntity[] => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("id" in value) ||
        !("name" in value) ||
        typeof value.id !== "string" ||
        typeof value.name !== "string"
      ) {
        return [];
      }
      return [{ id: value.id, name: value.name }];
    });
    if (entities.length === 0) return null;
    if (raw !== JSON.stringify(entities)) writeLS(key, entities);
    return entities;
  } catch {
    return null;
  }
}

function writeLS(key: string, value: NamedEntity[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

/** Synchronous last-known clubs (from localStorage) for instant first paint. */
export function getCachedClubs(): NamedEntity[] {
  return readLS(CLUBS_KEY) ?? [];
}

/** Synchronous last-known national teams for instant first paint. */
export function getCachedNationalTeams(): NamedEntity[] {
  return readLS(NT_KEY) ?? [];
}

export function fetchClubs(supabase: SupabaseClient): Promise<NamedEntity[]> {
  if (!clubsCache) {
    clubsCache = (async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name")
        .order("name");
      if (error) {
        clubsCache = null; // allow a retry on failure
        throw new Error(error.message);
      }
      const rows = (data as NamedEntity[]) ?? [];
      writeLS(CLUBS_KEY, rows);
      return rows;
    })();
  }
  return clubsCache;
}

export function fetchNationalTeams(
  supabase: SupabaseClient,
): Promise<NamedEntity[]> {
  if (!nationalTeamsCache) {
    nationalTeamsCache = (async () => {
      const { data, error } = await supabase
        .from("national_teams")
        .select("id, name")
        .order("name");
      if (error) {
        nationalTeamsCache = null;
        throw new Error(error.message);
      }
      const rows = (data as NamedEntity[]) ?? [];
      writeLS(NT_KEY, rows);
      return rows;
    })();
  }
  return nationalTeamsCache;
}
