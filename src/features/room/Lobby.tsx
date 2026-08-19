"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { clsx } from "@/lib/clsx";
import type { ChallengeType, Difficulty, GameMode } from "@/types/game";
import type { GameRoomApi } from "./useGameRoom";

const MODE_LABEL: Record<GameMode, string> = {
  national_club: "Nation × Club",
  club_club: "Club × Club",
};

const CHALLENGE_LABEL: Record<ChallengeType, string> = {
  random: "Random",
  player_pick: "Player Pick",
};

const DIFFICULTIES: { value: Difficulty; label: string; hint: string }[] = [
  { value: "easy", label: "Easy", hint: "Many common players" },
  { value: "medium", label: "Medium", hint: "Fewer each round" },
  { value: "hard", label: "Hard", hint: "Very few players" },
];

const WIN_TARGETS = [3, 5, 7];

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white/80">
      {children}
    </span>
  );
}

export function Lobby({ api }: { api: GameRoomApi }) {
  const { room, players, isHost } = api;
  const [busy, setBusy] = useState(false);
  // Optimistic overrides so the segmented buttons highlight instantly, before
  // the RPC + realtime round-trip updates `room`.
  const [optDifficulty, setOptDifficulty] = useState<Difficulty | null>(null);
  const [optWinTarget, setOptWinTarget] = useState<number | null>(null);

  const roomDifficulty = room?.difficulty;
  const roomWinTarget = room?.win_target;
  useEffect(() => setOptDifficulty(null), [roomDifficulty]);
  useEffect(() => setOptWinTarget(null), [roomWinTarget]);

  if (!room) return null;

  const bothReady = players.length === 2;
  const isRandom = room.challenge_type === "random";
  const activeDifficulty = optDifficulty ?? room.difficulty;
  const activeWinTarget = optWinTarget ?? room.win_target;
  const difficultyHint = DIFFICULTIES.find(
    (d) => d.value === activeDifficulty,
  )?.hint;

  function changeWinTarget(target: number) {
    if (!isHost || !room) return;
    setOptWinTarget(target);
    void api.updateSettings(
      room.game_mode,
      target,
      room.challenge_type,
      room.difficulty,
    );
  }

  function changeDifficulty(difficulty: Difficulty) {
    if (!isHost || !room) return;
    setOptDifficulty(difficulty);
    void api.updateSettings(
      room.game_mode,
      room.win_target,
      room.challenge_type,
      difficulty,
    );
  }

  async function onStart() {
    setBusy(true);
    try {
      await api.startMatch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Room code hero */}
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">
          Room code
        </p>
        <p className="mt-1 font-display text-5xl font-black tracking-[0.35em] text-accent">
          {room.code}
        </p>
        <p className="mt-1 text-sm text-white/40">
          Share this code with your opponent
        </p>
      </div>

      {/* Players */}
      <div className="card space-y-1 p-2">
        {[1, 2].map((slot) => {
          const p = players.find((pl) => pl.slot === slot);
          const isRoomHost = p && p.user_id === room.host_user_id;
          return (
            <div
              key={slot}
              className="flex items-center justify-between rounded-xl px-3 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={clsx(
                    "h-2.5 w-2.5 rounded-full",
                    p
                      ? "bg-accent shadow-[0_0_10px] shadow-accent/60"
                      : "bg-white/15",
                  )}
                />
                <span
                  className={clsx(
                    "text-lg font-semibold",
                    p ? "text-white" : "text-white/40",
                  )}
                >
                  {p ? p.display_name : `Waiting for Player ${slot}…`}
                </span>
                {isRoomHost && (
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">
                    Host
                  </span>
                )}
              </div>
              <span
                className={clsx("text-sm", p ? "text-accent" : "text-white/25")}
              >
                {p ? "Ready" : "…"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Locked match summary (chosen when the room was created) */}
      <div className="card p-4">
        <p className="mb-3 text-xs uppercase tracking-widest text-white/30">
          Match
        </p>
        <div className="flex flex-wrap gap-2">
          <Chip>{MODE_LABEL[room.game_mode]}</Chip>
          <Chip>{CHALLENGE_LABEL[room.challenge_type]}</Chip>
        </div>
      </div>

      {/* Winning score (host-adjustable in the lobby) */}
      <div>
        <p className="mb-2 px-1 text-xs uppercase tracking-widest text-white/40">
          Winning score
        </p>
        <div
          className="seg"
          style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}
        >
          {WIN_TARGETS.map((t) => (
            <button
              key={t}
              type="button"
              disabled={!isHost}
              data-active={activeWinTarget === t}
              onClick={() => changeWinTarget(t)}
              className="seg-item"
            >
              First to {t}
            </button>
          ))}
        </div>
      </div>

      {/* Difficulty (Random only) */}
      {isRandom && (
        <div>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <p className="text-xs uppercase tracking-widest text-white/40">
              Difficulty
            </p>
            {difficultyHint && (
              <p className="text-[11px] text-white/35">{difficultyHint}</p>
            )}
          </div>
          <div
            className="seg"
            style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}
          >
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                type="button"
                disabled={!isHost}
                data-active={activeDifficulty === d.value}
                onClick={() => changeDifficulty(d.value)}
                className="seg-item"
              >
                {d.label}
              </button>
            ))}
          </div>
          {!isHost && (
            <p className="mt-1 px-1 text-[11px] text-white/30">
              Only the host can change this.
            </p>
          )}
        </div>
      )}

      {isHost ? (
        <Button onClick={onStart} disabled={!bothReady || busy}>
          {busy
            ? "Starting…"
            : bothReady
              ? "Start game"
              : "Waiting for opponent…"}
        </Button>
      ) : (
        <p className="text-center text-sm text-white/50">
          {bothReady
            ? "Waiting for the host to start…"
            : "Waiting for opponent…"}
        </p>
      )}
    </div>
  );
}
