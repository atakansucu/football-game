"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import {
  ensureAnonymousUser,
  getSupabaseBrowserClient,
} from "@/lib/supabase/browserClient";
import {
  claimAbandonedMatch,
  confirmSelection as confirmSelectionRpc,
  finishRoundIfExpired as finishRoundRpc,
  heartbeat,
  leaveRoom as leaveRoomRpc,
  markStalePresence,
  playAgain as playAgainRpc,
  readyNextRound as readyNextRoundRpc,
  searchPlayers as searchPlayersRpc,
  setRoomSettings as setRoomSettingsRpc,
  startMatch as startMatchRpc,
  startRound as startRoundRpc,
  submitRoundAnswer,
} from "@/server/game/actions";
import type {
  ChallengeType,
  ConfirmSelectionResult,
  Difficulty,
  GameMode,
  MatchRow,
  PlayerSuggestion,
  ReadyNextResult,
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
  online: boolean;
}

export interface GameRoomApi extends GameRoomState {
  /** This player's slot (1 or 2) in the room, or null. */
  mySlot: number | null;
  updateSettings: (
    mode: GameMode,
    winTarget: number,
    challengeType?: ChallengeType,
    difficulty?: Difficulty,
  ) => Promise<void>;
  startMatch: () => Promise<void>;
  startNextRound: () => Promise<void>;
  submitAnswer: (answer: string) => Promise<SubmitAnswerResult>;
  confirmSelection: (selectionId: string) => Promise<ConfirmSelectionResult>;
  readyNextRound: () => Promise<ReadyNextResult>;
  finishRound: () => Promise<void>;
  searchPlayers: (query: string) => Promise<PlayerSuggestion[]>;
  playAgain: () => Promise<void>;
  leaveRoom: () => Promise<void>;
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
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const abandonClaimRef = useRef<string | null>(null);

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

  const refreshSnapshot = useCallback(async () => {
    const r = await fetchRoom();
    if (!r) {
      setError("Room not found");
      return;
    }
    setRoom(r);
    await fetchPlayers(r.id);
    const m = await fetchLatestMatch(r.id);
    setMatch(m);
    if (m) {
      await Promise.all([fetchLatestRound(m.id), fetchScores(m.id)]);
    } else {
      setRound(null);
      setScores({});
    }
    setError(null);
  }, [
    fetchLatestMatch,
    fetchLatestRound,
    fetchPlayers,
    fetchRoom,
    fetchScores,
  ]);

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
        markStalePresence(supabase, r.id).catch(() => {});

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
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              void refreshSnapshot();
            }
          });
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
  }, [code, refreshSnapshot]);

  // Realtime can miss changes while iOS is suspended or the network is down.
  // Always reconcile from authoritative database rows after foregrounding or
  // reconnecting instead of trusting the next Realtime event to arrive.
  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    const resync = () => {
      if (!disposed) void refreshSnapshot();
    };

    if (typeof document !== "undefined") {
      const onVisibility = () => {
        if (document.visibilityState === "visible") resync();
      };
      const onOnline = () => {
        setOnline(true);
        resync();
      };
      const onOffline = () => setOnline(false);
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      cleanups.push(() =>
        document.removeEventListener("visibilitychange", onVisibility),
      );
      cleanups.push(() => window.removeEventListener("online", onOnline));
      cleanups.push(() => window.removeEventListener("offline", onOffline));
    }

    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) resync();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else cleanups.push(() => void handle.remove());
    });

    void Network.addListener("networkStatusChange", ({ connected }) => {
      setOnline(connected);
      if (connected) resync();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else cleanups.push(() => void handle.remove());
    });
    void Network.getStatus().then(({ connected }) => {
      if (!disposed) setOnline(connected);
    });

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [refreshSnapshot]);

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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void Promise.all([
            fetchLatestRound(matchId),
            fetchScores(matchId),
          ]);
        }
      });

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
      markStalePresence(getDb(), room.id).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [getDb, userId, room]);

  useEffect(() => {
    if (!userId || !room || room.status !== "playing") return;
    const opponent = players.find((player) => player.user_id !== userId);
    if (!opponent || opponent.connected) {
      abandonClaimRef.current = null;
      return;
    }
    if (abandonClaimRef.current === room.id) return;
    abandonClaimRef.current = room.id;
    claimAbandonedMatch(getDb(), { userId, roomId: room.id })
      .then(() => refreshSnapshot())
      .catch(() => {
        abandonClaimRef.current = null;
      });
  }, [getDb, players, refreshSnapshot, room, userId]);

  // ---- Actions ------------------------------------------------------------

  const updateSettings = useCallback(
    async (
      mode: GameMode,
      winTarget: number,
      challengeType?: ChallengeType,
      difficulty?: Difficulty,
    ) => {
      if (!userId || !room) return;
      await setRoomSettingsRpc(getDb(), {
        userId,
        roomId: room.id,
        gameMode: mode,
        winTarget,
        challengeType,
        difficulty,
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

  const readyNextRound = useCallback(async (): Promise<ReadyNextResult> => {
    if (!userId || !round) throw new Error("Not ready");
    return readyNextRoundRpc(getDb(), { userId, roundId: round.id });
  }, [getDb, userId, round]);

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

  const leaveRoom = useCallback(async () => {
    if (!userId || !room) return;
    await leaveRoomRpc(getDb(), { userId, roomId: room.id });
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
    online,
    mySlot,
    updateSettings,
    startMatch,
    startNextRound,
    submitAnswer,
    confirmSelection,
    readyNextRound,
    finishRound,
    searchPlayers,
    playAgain,
    leaveRoom,
  };
}
