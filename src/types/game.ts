import type { GameMode } from "@/lib/football/types";

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
/** Role a player is assigned during a Player Pick selection phase. */
export type SelectionRole = "national_team" | "club";

export const DEFAULT_WIN_TARGET = 5;
/** Seconds each active round lasts, mirrored from the server deadline. */
export const ROUND_SECONDS = 30;

export interface RoomRow {
  id: string;
  code: string;
  status: RoomStatus;
  game_mode: GameMode;
  win_target: number;
  challenge_type: ChallengeType;
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

export interface ScoreRow {
  user_id: string;
  wins: number;
}
