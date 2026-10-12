import type { GameMode } from "../lib/football/types";

export type { GameMode };

export type RoomStatus = "waiting" | "ready" | "playing" | "finished";
export type MatchStatus = "active" | "finished";
export type RoundState =
  | "selection"
  | "revealed"
  | "countdown"
  | "active"
  | "finished";
export type ChallengeType = "random" | "player_pick";
/** Random-mode difficulty (affects how many common players a combo has). */
export type Difficulty = "easy" | "medium" | "hard";
/** Role a player is assigned during a Player Pick selection phase. */
export type SelectionRole = "national_team" | "club";

/**
 * Optional league restriction for Random challenges. `null` = "All leagues"
 * (no filter). The non-null values must match the `clubs.league` strings
 * assigned in migration 0016.
 */
export type League = string;

/**
 * Shared league options for both Single Player and multiplayer create flows so
 * they stay in sync. `value: null` is "All leagues" (the default, no filter).
 */
export const LEAGUES: { value: League | null; label: string }[] = [
  { value: null, label: "All leagues" },
  { value: "Süper Lig", label: "Süper Lig" },
  { value: "Premier League", label: "Premier League" },
  { value: "La Liga", label: "La Liga" },
  { value: "Serie A", label: "Serie A" },
  { value: "Bundesliga", label: "Bundesliga" },
  { value: "Ligue 1", label: "Ligue 1" },
  { value: "Eredivisie", label: "Eredivisie" },
  { value: "Primeira Liga", label: "Primeira Liga" },
  { value: "Championship", label: "Championship" },
];

/** Human label for a stored league value (`null` -> "All leagues"). */
export function leagueLabel(league: League | null): string {
  return LEAGUES.find((l) => l.value === league)?.label ?? "All leagues";
}

export const DEFAULT_WIN_TARGET = 3;
/** Seconds each active round lasts, mirrored from the server deadline. */
export const ROUND_SECONDS = 30;

export interface RoomRow {
  id: string;
  code: string;
  status: RoomStatus;
  game_mode: GameMode;
  win_target: number;
  challenge_type: ChallengeType;
  difficulty: Difficulty;
  /** Optional league restriction for Random challenges (null = All leagues). */
  league: League | null;
  host_user_id: string;
  created_at: string;
}

export interface RoomPlayerRow {
  id: string;
  room_id: string;
  user_id: string;
  slot: number;
  display_name: string;
  connected: boolean;
  last_seen: string;
  created_at: string;
}

export interface MatchRow {
  id: string;
  room_id: string;
  status: MatchStatus;
  winner_user_id: string | null;
  created_at: string;
}

export interface RoundRow {
  id: string;
  match_id: string;
  round_number: number;
  mode: GameMode;
  challenge_type: ChallengeType;
  national_team_id: string | null;
  club_1_id: string | null;
  club_2_id: string | null;
  state: RoundState;
  winner_user_id: string | null;
  winner_submission_id: string | null;
  winner_player_name: string | null;
  winner_time_ms: number | null;
  activated_at: string | null;
  ends_at: string | null;
  finished_at: string | null;
  created_at: string;
  // Denormalized challenge labels for display.
  national_team_name: string | null;
  club_1_name: string | null;
  club_2_name: string | null;
  // Player Pick: public confirmation status + roles (never the selections).
  sel1_confirmed: boolean;
  sel2_confirmed: boolean;
  sel1_role: SelectionRole | null;
  sel2_role: SelectionRole | null;
  invalid_reason: string | null;
  no_winner: boolean;
  // Both-players-ready gate for advancing to the next round.
  ready_1: boolean;
  ready_2: boolean;
}

/** Result returned by the `ready_next_round` RPC. */
export interface ReadyNextResult {
  status:
    | "waiting"
    | "advanced"
    | "match_over"
    | "not_finished"
    | "not_participant"
    | "not_found";
  round_id?: string;
  ready_1?: boolean;
  ready_2?: boolean;
}

/** Result returned by the `submit_answer` RPC. */
export interface SubmitAnswerResult {
  status:
    | "won"
    | "correct_but_late"
    | "incorrect"
    | "ambiguous"
    | "expired"
    | "rate_limited"
    | "round_not_active"
    | "not_participant"
    // Client-only: a thrown/rejected submit surfaced as a visible attempt.
    | "error";
  is_correct: boolean;
  player_name: string | null;
  /** Per-condition feedback for the submitting player only. */
  checks: {
    national_team?: boolean;
    club?: boolean;
    club_a?: boolean;
    club_b?: boolean;
  } | null;
  round_id: string;
  winner_user_id: string | null;
  winner_time_ms?: number | null;
}

/** Result returned by the `confirm_selection` RPC. */
export interface ConfirmSelectionResult {
  status:
    | "waiting"
    | "revealed"
    | "invalid"
    | "already_revealed"
    | "not_participant"
    | "invalid_selection"
    | "not_player_pick"
    | "not_selecting"
    | "not_found";
  reason?: "no_answers" | "same_club";
}

/** A single global player-search suggestion. */
export interface PlayerSuggestion {
  id: string;
  name: string;
}

/** A random single-player challenge returned by `sp_random_challenge`. */
export interface SoloChallenge {
  mode: GameMode;
  national_team_id: string | null;
  national_team_name: string | null;
  club_1_id: string | null;
  club_1_name: string | null;
  club_2_id: string | null;
  club_2_name: string | null;
}

/** Result of validating one single-player guess via `sp_check_answer`. */
export interface SoloCheckResult {
  status: "correct" | "incorrect" | "ambiguous";
  is_correct: boolean;
  player_name: string | null;
}

export interface ScoreRow {
  user_id: string;
  wins: number;
}
