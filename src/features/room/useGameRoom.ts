"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ensureAnonymousUser,
  getSupabaseBrowserClient,
} from "@/lib/supabase/browserClient";
import {
  confirmSelection as confirmSelectionRpc,
  finishRoundIfExpired as finishRoundRpc,
  heartbeat,
  playAgain as playAgainRpc,
  searchPlayers as searchPlayersRpc,
  setRoomSettings as setRoomSettingsRpc,
  startMatch as startMatchRpc,
  startRound as startRoundRpc,
  submitRoundAnswer,
} from "@/server/game/actions";
import type {
  ChallengeType,
  ConfirmSelectionResult,
  GameMode,
  MatchRow,
  PlayerSuggestion,
  RoomPlayerRow,
  RoomRow,
  RoundRow,
  SubmitAnswerResult,
} from "@/types/game";

export interface GameRoomState {
  loading: boolean;
  error: string | null;
  userId: string | null;
  room: RoomRow | null;
  players: RoomPlayerRow[];
  match: MatchRow | null;
  round: RoundRow | null;
  /** wins per user id in the current match */
  scores: Record<string, number>;
  isHost: boolean;
}

export interface GameRoomApi extends GameRoomState {
  /** This player's slot (1 or 2) in the room, or null. */
  mySlot: number | null;
  updateSettings: (
    mode: GameMode,
    winTarget: number,
    challengeType?: ChallengeType,
  ) => Promise<void>;
  startMatch: () => Promise<void>;
  startNextRound: () => Promise<void>;
  submitAnswer: (answer: string) => Promise<SubmitAnswerResult>;
  confirmSelection: (selectionId: string) => Promise<ConfirmSelectionResult>;
  finishRound: () => Promise<void>;
  searchPlayers: (query: string) => Promise<PlayerSuggestion[]>;
  playAgain: () => Promise<void>;
}

export function useGameRoom(code: string): GameRoomApi {
  // The Supabase client is created lazily (browser-only) so this hook is safe
  // to server-render; it is only ever instantiated inside effects/callbacks.
  const getDb = useCallback(() => getSupabaseBrowserClient(), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<RoomPlayerRow[]>([]);
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [round, setRound] = useState<RoundRow | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Fetchers -----------------------------------------------------------

  const fetchRoom = useCallback(async (): Promise<RoomRow | null> => {
    const { data } = await getDb()
      .from("rooms")
      .select("*")
      .eq("code", code.toUpperCase())
      .maybeSingle();
    return (data as RoomRow | null) ?? null;
  }, [getDb, code]);

  const fetchPlayers = useCallback(
    async (roomId: string) => {
      const { data } = await getDb()
        .from("room_players")
        .select("*")
        .eq("room_id", roomId)
        .order("slot");
      setPlayers((data as RoomPlayerRow[]) ?? []);
    },
    [getDb],
  );

  const fetchLatestMatch = useCallback(
    async (roomId: string): Promise<MatchRow | null> => {
      const { data } = await getDb()
        .from("matches")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as MatchRow | null) ?? null;
    },
    [getDb],
  );

  const fetchLatestRound = useCallback(
    async (matchId: string) => {
      const { data } = await getDb()
        .from("rounds")
        .select("*")
        .eq("match_id", matchId)
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      setRound((data as RoundRow | null) ?? null);
    },
    [getDb],
  );

  const fetchScores = useCallback(
    async (matchId: string) => {
      const { data } = await getDb()
        .from("rounds")
        .select("winner_user_id")
        .eq("match_id", matchId)
        .not("winner_user_id", "is", null);
      const tally: Record<string, number> = {};
      for (const row of (data as { winner_user_id: string }[] | null) ?? []) {
        tally[row.winner_user_id] = (tally[row.winner_user_id] ?? 0) + 1;
      }
      setScores(tally);
    },
    [getDb],
  );

  // ---- Initial load + room-level realtime ---------------------------------

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      try {
        const supabase = getDb();
        const uid = await ensureAnonymousUser();
        if (cancelled) return;
        setUserId(uid);

        const r = await fetchRoom();
        if (cancelled) return;
        if (!r) {
          setError("Room not found");
          setLoading(false);
          return;
        }
        setRoom(r);
        await fetchPlayers(r.id);
        const m = await fetchLatestMatch(r.id);
        if (cancelled) return;
        setMatch(m);
        setLoading(false);

        heartbeat(supabase, { userId: uid, roomId: r.id }).catch(() => {});

        channel = supabase
          .channel(`room:${r.id}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "rooms",
              filter: `id=eq.${r.id}`,
            },
            (payload) => setRoom(payload.new as RoomRow),
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "room_players",
              filter: `room_id=eq.${r.id}`,
            },
            () => fetchPlayers(r.id),
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "matches",
              filter: `room_id=eq.${r.id}`,
            },
            async () => {
              const nm = await fetchLatestMatch(r.id);
              setMatch(nm);
            },
          )
          .subscribe();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load room");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (channel) getDb().removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ---- Match-level realtime (rounds) --------------------------------------

  useEffect(() => {
    const matchId = match?.id ?? null;
    if (!matchId) {
      setRound(null);
      setScores({});
      return;
    }

    fetchLatestRound(matchId);
    fetchScores(matchId);

    const channel = getDb()
      .channel(`match:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rounds",
          filter: `match_id=eq.${matchId}`,
        },
        async () => {
          await fetchLatestRound(matchId);
          await fetchScores(matchId);
        },
      )
      .subscribe();

    return () => {
      getDb().removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id]);

  // ---- Heartbeat ----------------------------------------------------------

  useEffect(() => {
    if (!userId || !room) return;
    const id = setInterval(() => {
      heartbeat(getDb(), { userId, roomId: room.id }).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [getDb, userId, room]);

  // ---- Actions ------------------------------------------------------------

  const updateSettings = useCallback(
    async (mode: GameMode, winTarget: number, challengeType?: ChallengeType) => {
      if (!userId || !room) return;
      await setRoomSettingsRpc(getDb(), {
        userId,
        roomId: room.id,
        gameMode: mode,
        winTarget,
        challengeType,
      });
    },
    [getDb, userId, room],
  );

  const startMatch = useCallback(async () => {
    if (!userId || !room) return;
    await startMatchRpc(getDb(), { userId, roomId: room.id });
  }, [getDb, userId, room]);

  const startNextRound = useCallback(async () => {
    if (!userId || !room) return;
    await startRoundRpc(getDb(), { userId, roomId: room.id });
  }, [getDb, userId, room]);

  const submitAnswer = useCallback(
    async (answer: string): Promise<SubmitAnswerResult> => {
      if (!userId || !round) {
        throw new Error("Not ready to submit");
      }
      return submitRoundAnswer(getDb(), {
        userId,
        roundId: round.id,
        answer,
      });
    },
    [getDb, userId, round],
  );

  const confirmSelection = useCallback(
    async (selectionId: string): Promise<ConfirmSelectionResult> => {
      if (!userId || !round) throw new Error("Not ready to confirm");
      return confirmSelectionRpc(getDb(), {
        userId,
        roundId: round.id,
        selectionId,
      });
    },
    [getDb, userId, round],
  );

  const finishRound = useCallback(async () => {
    if (!round) return;
    await finishRoundRpc(getDb(), { roundId: round.id });
  }, [getDb, round]);

  const searchPlayers = useCallback(
    async (query: string): Promise<PlayerSuggestion[]> => {
      return searchPlayersRpc(getDb(), query);
    },
    [getDb],
  );

  const playAgain = useCallback(async () => {
    if (!userId || !room) return;
    await playAgainRpc(getDb(), { userId, roomId: room.id });
  }, [getDb, userId, room]);

  const isHost = useMemo(
    () => !!room && !!userId && room.host_user_id === userId,
    [room, userId],
  );

  const mySlot = useMemo(() => {
    if (!userId) return null;
    return players.find((p) => p.user_id === userId)?.slot ?? null;
  }, [players, userId]);

  return {
    loading,
    error,
    userId,
    room,
    players,
    match,
    round,
    scores,
    isHost,
    mySlot,
    updateSettings,
    startMatch,
    startNextRound,
    submitAnswer,
    confirmSelection,
    finishRound,
    searchPlayers,
    playAgain,
  };
}
