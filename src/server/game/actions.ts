import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChallengeType,
  ConfirmSelectionResult,
  Difficulty,
  GameMode,
  PlayerSuggestion,
  ReadyNextResult,
  SubmitAnswerResult,
} from "@/types/game";

/**
 * Typed wrappers around the authoritative Postgres RPCs. These are isomorphic
 * (they take a Supabase client) so they can run from client components with the
 * anon key or from server-side scripts/tests with the service role key. All
 * game logic lives in the database, not here.
 */

type Client = SupabaseClient;

export interface CreateRoomResult {
  status: "ok";
  room_id: string;
  code: string;
}

export async function createRoom(
  supabase: Client,
  params: {
    userId: string;
    displayName: string;
    gameMode: GameMode;
    winTarget: number;
    challengeType?: ChallengeType;
  },
): Promise<CreateRoomResult> {
  const { data, error } = await supabase.rpc("create_room", {
    p_user_id: params.userId,
    p_display_name: params.displayName,
    p_game_mode: params.gameMode,
    p_win_target: params.winTarget,
    p_challenge_type: params.challengeType ?? "random",
  });
  if (error) throw new Error(error.message);
  return data as unknown as CreateRoomResult;
}

export interface JoinRoomResult {
  status: "ok" | "not_found" | "full";
  room_id?: string;
  code?: string;
  slot?: number;
}

export async function joinRoom(
  supabase: Client,
  params: { userId: string; displayName: string; code: string },
): Promise<JoinRoomResult> {
  const { data, error } = await supabase.rpc("join_room", {
    p_user_id: params.userId,
    p_display_name: params.displayName,
    p_code: params.code,
  });
  if (error) throw new Error(error.message);
  return data as unknown as JoinRoomResult;
}

export async function setRoomSettings(
  supabase: Client,
  params: {
    userId: string;
    roomId: string;
    gameMode: GameMode;
    winTarget: number;
    challengeType?: ChallengeType;
    difficulty?: Difficulty;
  },
): Promise<{ status: "ok" | "forbidden" }> {
  const { data, error } = await supabase.rpc("set_room_settings", {
    p_user_id: params.userId,
    p_room_id: params.roomId,
    p_game_mode: params.gameMode,
    p_win_target: params.winTarget,
    p_challenge_type: params.challengeType ?? null,
    p_difficulty: params.difficulty ?? null,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { status: "ok" | "forbidden" };
}

export async function startMatch(
  supabase: Client,
  params: { userId: string; roomId: string },
): Promise<{ status: string; match_id?: string; round_id?: string }> {
  const { data, error } = await supabase.rpc("start_match", {
    p_user_id: params.userId,
    p_room_id: params.roomId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as {
    status: string;
    match_id?: string;
    round_id?: string;
  };
}

export async function startRound(
  supabase: Client,
  params: { userId: string; roomId: string },
): Promise<{ status: string; match_id?: string; round_id?: string }> {
  const { data, error } = await supabase.rpc("start_round", {
    p_user_id: params.userId,
    p_room_id: params.roomId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as {
    status: string;
    match_id?: string;
    round_id?: string;
  };
}

export async function activateDueRounds(
  supabase: Client,
): Promise<{ status: "ok"; activated: number }> {
  const { data, error } = await supabase.rpc("activate_due_rounds");
  if (error) throw new Error(error.message);
  return data as unknown as { status: "ok"; activated: number };
}

export async function submitRoundAnswer(
  supabase: Client,
  params: { userId: string; roundId: string; answer: string },
): Promise<SubmitAnswerResult> {
  const { data, error } = await supabase.rpc("submit_answer", {
    p_user_id: params.userId,
    p_round_id: params.roundId,
    p_raw_answer: params.answer,
  });
  if (error) throw new Error(error.message);
  return data as unknown as SubmitAnswerResult;
}

export async function playAgain(
  supabase: Client,
  params: { userId: string; roomId: string },
): Promise<{ status: string; match_id?: string; round_id?: string }> {
  const { data, error } = await supabase.rpc("play_again", {
    p_user_id: params.userId,
    p_room_id: params.roomId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as {
    status: string;
    match_id?: string;
    round_id?: string;
  };
}

/**
 * Player Pick: store + confirm this player's private selection. The opponent's
 * selection is never returned. If both players are now confirmed the server
 * reveals + validates the combination exactly once and returns the outcome.
 */
export async function confirmSelection(
  supabase: Client,
  params: { userId: string; roundId: string; selectionId: string },
): Promise<ConfirmSelectionResult> {
  const { data, error } = await supabase.rpc("confirm_selection", {
    p_user_id: params.userId,
    p_round_id: params.roundId,
    p_selection_id: params.selectionId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as ConfirmSelectionResult;
}

/**
 * Mark the caller ready to advance after a finished round. When BOTH players are
 * ready the server creates the next round exactly once and returns its id.
 */
export async function readyNextRound(
  supabase: Client,
  params: { userId: string; roundId: string },
): Promise<ReadyNextResult> {
  const { data, error } = await supabase.rpc("ready_next_round", {
    p_user_id: params.userId,
    p_round_id: params.roundId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as ReadyNextResult;
}

/** End a round whose 30s deadline passed with no winner (idempotent). */
export async function finishRoundIfExpired(
  supabase: Client,
  params: { roundId: string },
): Promise<{ status: string; no_winner?: boolean }> {
  const { data, error } = await supabase.rpc("finish_round_if_expired", {
    p_round_id: params.roundId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { status: string; no_winner?: boolean };
}

/**
 * Global footballer autocomplete. Deliberately knows nothing about the current
 * challenge's valid answers — it searches the whole player table.
 */
export async function searchPlayers(
  supabase: Client,
  query: string,
): Promise<PlayerSuggestion[]> {
  const { data, error } = await supabase.rpc("search_players", {
    p_query: query,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as PlayerSuggestion[]) ?? [];
}

export async function heartbeat(
  supabase: Client,
  params: { userId: string; roomId: string },
): Promise<{ status: "ok" }> {
  const { data, error } = await supabase.rpc("heartbeat", {
    p_user_id: params.userId,
    p_room_id: params.roomId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { status: "ok" };
}
