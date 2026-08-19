"use client";

import { useEffect, useRef, useState } from "react";
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
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import {
  getPlayersForClubClub,
  getPlayersForCountryClub,
  type LookupPlayer,
} from "@/features/lookup/api";
import { ROUND_SECONDS, type RoundRow } from "@/types/game";
import type { GameRoomApi } from "@/features/room/useGameRoom";

export function GameScreen({ api }: { api: GameRoomApi }) {
  const { room, round, players, scores, userId, isHost, mySlot, searchPlayers } =
    api;
  const now = useNow();
  const phase = getRoundPhase(round, now);
  const finishedForRound = useRef<string | null>(null);

  // Common (valid) players revealed once the round is over.
  const [commonPlayers, setCommonPlayers] = useState<LookupPlayer[] | null>(
    null,
  );

  // At the deadline, the host ends the round with no winner. The server
  // re-checks the authoritative deadline.
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

  // Once a round is finished, fetch the players that WERE valid for it. This
  // reuses the public lookup RPCs and only runs after the round is over, so it
  // never reveals answers during play.
  useEffect(() => {
    if (phase !== "finished" || !round || round.invalid_reason) {
      setCommonPlayers(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const db = getSupabaseBrowserClient();
        let data: LookupPlayer[] = [];
        if (round.mode === "national_club" && round.national_team_id && round.club_1_id) {
          data = await getPlayersForCountryClub(
            db,
            round.national_team_id,
            round.club_1_id,
          );
        } else if (round.club_1_id && round.club_2_id) {
          data = await getPlayersForClubClub(db, round.club_1_id, round.club_2_id);
        }
        if (!cancelled) setCommonPlayers(data);
      } catch {
        if (!cancelled) setCommonPlayers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, round?.id]);

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

  const myReady = mySlot === 1 ? round.ready_1 : round.ready_2;
  const opponentReady = mySlot === 1 ? round.ready_2 : round.ready_1;

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
          <div className="space-y-2">
            <div
              className={clsx(
                "text-center font-black tabular-nums transition-colors",
                urgent ? "text-5xl text-red-400" : "text-4xl text-white",
              )}
              aria-live="polite"
            >
              {formatClock(secondsLeft ?? 0)}
            </div>
            <TimerBar round={round} now={now} />
          </div>
          <AnswerInput
            round={round}
            onSubmit={api.submitAnswer}
            searchPlayers={searchPlayers}
          />
        </div>
      )}

      {phase === "finished" && (
        <div className="space-y-4 py-2 text-center">
          {round.invalid_reason ? (
            <>
              <div className="text-3xl font-black uppercase text-amber-400">
                Invalid pick
              </div>
              <p className="text-white/60">
                {round.invalid_reason === "same_club"
                  ? "Both players picked the same club."
                  : "These two teams have no common player."}
              </p>
              <p className="text-sm text-white/40">
                No points — moving to the next round.
              </p>
            </>
          ) : round.winner_user_id ? (
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

          {!round.invalid_reason && <CommonPlayers players={commonPlayers} />}

          {room.status === "playing" && (
            <div className="space-y-3 pt-2">
              <Button onClick={() => api.readyNextRound()} disabled={myReady}>
                {myReady ? "Waiting for opponent…" : "Ready — next round"}
              </Button>
              <div className="flex items-center justify-center gap-6 text-sm">
                <span
                  className={clsx(
                    "font-semibold",
                    myReady ? "text-accent" : "text-white/40",
                  )}
                >
                  You {myReady ? "✓" : "…"}
                </span>
                <span
                  className={clsx(
                    "font-semibold",
                    opponentReady ? "text-accent" : "text-white/40",
                  )}
                >
                  Opponent {opponentReady ? "✓" : "…"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Depleting time bar for the active round, driven by the server deadline. */
function TimerBar({ round, now }: { round: RoundRow; now: number }) {
  const totalMs = ROUND_SECONDS * 1000;
  const endsAt = round.ends_at ? Date.parse(round.ends_at) : now;
  const msLeft = Math.max(0, endsAt - now);
  const frac = Math.max(0, Math.min(1, msLeft / totalMs));
  const secs = Math.ceil(msLeft / 1000);
  const color =
    secs <= 5 ? "bg-red-500" : secs <= 10 ? "bg-amber-400" : "bg-accent";
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={ROUND_SECONDS}
      aria-valuenow={secs}
    >
      <div
        className={clsx(
          "h-full rounded-full transition-[width] duration-200 ease-linear",
          color,
        )}
        style={{ width: `${frac * 100}%` }}
      />
    </div>
  );
}

/** Read-only list of the players that were valid answers for the finished round. */
function CommonPlayers({ players }: { players: LookupPlayer[] | null }) {
  if (players === null) {
    return <p className="text-sm text-white/40">Loading answers…</p>;
  }
  if (players.length === 0) return null;
  return (
    <div className="card p-4 text-left">
      <p className="mb-2 text-xs uppercase tracking-widest text-white/40">
        Common players ({players.length})
      </p>
      <ul className="flex flex-wrap gap-2">
        {players.map((p) => (
          <li
            key={p.player_id}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-sm text-white/80"
          >
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
