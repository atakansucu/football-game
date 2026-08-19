import type { GameMode } from "./types";

export type SelectionRole = "national_team" | "club";

/**
 * Deterministic Player Pick role assignment. Mirrors the SQL
 * `public.pp_role_for_slot` exactly so client and server always agree.
 *
 * - club_club: both players always choose a club.
 * - national_club: roles alternate every round.
 *     odd  round -> slot 1 = national_team, slot 2 = club
 *     even round -> slot 1 = club,          slot 2 = national_team
 */
export function roleForSlot(
  mode: GameMode,
  roundNumber: number,
  slot: 1 | 2,
): SelectionRole {
  if (mode === "club_club") return "club";
  const oddRound = roundNumber % 2 === 1;
  if (oddRound) return slot === 1 ? "national_team" : "club";
  return slot === 1 ? "club" : "national_team";
}
