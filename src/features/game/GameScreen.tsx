"use client";

import { useEffect, useRef } from "react";
import { AnswerInput } from "@/components/AnswerInput";
import { ChallengeCard } from "@/components/ChallengeCard";
import { ScoreBar } from "@/components/ScoreBar";
import { Button } from "@/components/Button";
import { SelectionPhase } from "./SelectionPhase";
import {
  countdownSecondsLeft,
  formatClock,
  getRoundPhase,
  remainingSeconds,
  useNow,
} from "./useRoundPhase";
import { clsx } from "@/lib/clsx";
import type { GameRoomApi } from "@/features/room/useGameRoom";

export function GameScreen({ api }: { api: GameRoomApi }) {
  const { room, round, players, scores, userId, isHost, searchPlayers } = api;
  const now = useNow();
  const phase = getRoundPhase(round, now);
  const advancedForRound = useRef<string | null>(null);
  const finishedForRound = useRef<string | null>(null);

  // Host auto-advances to the next round shortly after a result.
  useEffect(() => {
    if (
      phase === "finished" &&
      isHost &&
      round &&
      room?.status === "playing" &&
      advancedForRound.current !== round.id
    ) {
      advancedForRound.current = round.id;
      const id = setTimeout(() => {
        api.startNextRound().catch(() => {});
      }, 3500);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isHost, round?.id, room?.status]);

  // At the deadline, any client (guarded to the host to avoid churn) ends the
  // round with no winner. The server re-checks the authoritative deadline.
  const secondsLeft = phase === "active" ? remainingSeconds(round, now) : null;
  useEffect(() => {
    if (
      phase === "active" &&
      isHost &&
      round &&
      secondsLeft === 0 &&
      !round.winner_user_id &&
      finishedForRound.current !== round.id
    ) {
      finishedForRound.current = round.id;
      api.finishRound().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isHost, round?.id, secondsLeft]);

  if (!room || !round) {
    return <p className="text-center text-white/50">Preparing round...</p>;
  }

  if (phase === "selection") {
    return (
      <div className="space-y-5">
        <ScoreBar
          players={players}
          scores={scores}
          userId={userId}
          winTarget={room.win_target}
        />
        <SelectionPhase api={api} />
      </div>
    );
  }

  const winnerName =
    players.find((p) => p.user_id === round.winner_user_id)?.display_name ??
    "Winner";
  const urgent = secondsLeft !== null && secondsLeft <= 5;

  return (
    <div className="space-y-5">
      <ScoreBar
        players={players}
        scores={scores}
        userId={userId}
        winTarget={room.win_target}
      />

      <p className="text-center text-sm uppercase tracking-widest text-white/40">
        Round {round.round_number}
      </p>

      <ChallengeCard round={round} />

      {phase === "countdown" && (
        <div className="py-6 text-center">
          <div className="text-7xl font-black text-accent">
            {countdownSecondsLeft(round, now) || "GO"}
          </div>
          <p className="mt-2 text-white/50">Get ready...</p>
        </div>
      )}

      {phase === "active" && (
        <div className="space-y-4">
          <div
            className={clsx(
              "text-center font-black tabular-nums transition-colors",
              urgent ? "text-6xl text-red-400" : "text-4xl text-white",
            )}
            aria-live="polite"
          >
            {formatClock(secondsLeft ?? 0)}
          </div>
          <AnswerInput
            round={round}
            onSubmit={api.submitAnswer}
            searchPlayers={searchPlayers}
          />
        </div>
      )}

      {phase === "finished" && (
        <div className="space-y-4 py-4 text-center">
          {round.winner_user_id ? (
            <>
              <div className="text-3xl font-black uppercase text-accent">
                {round.winner_player_name} <span aria-hidden>✓</span>
              </div>
              <p className="text-xl font-semibold">{winnerName} wins the round</p>
              {round.winner_time_ms != null && (
                <p className="text-sm text-white/50">
                  Time: {(round.winner_time_ms / 1000).toFixed(1)}s
                </p>
              )}
            </>
          ) : (
            <>
              <div className="text-3xl font-black uppercase text-white/70">
                Time&apos;s up
              </div>
              <p className="text-white/50">No winner this round.</p>
            </>
          )}
          {isHost && room.status === "playing" && (
            <Button variant="ghost" onClick={() => api.startNextRound()}>
              Next round
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
