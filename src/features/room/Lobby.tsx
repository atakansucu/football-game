"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { clsx } from "@/lib/clsx";
import type { ChallengeType, GameMode } from "@/types/game";
import type { GameRoomApi } from "./useGameRoom";

const MODES: { value: GameMode; label: string }[] = [
  { value: "national_club", label: "National Team × Club" },
  { value: "club_club", label: "Club × Club" },
];

const CHALLENGE_TYPES: { value: ChallengeType; label: string }[] = [
  { value: "random", label: "Random" },
  { value: "player_pick", label: "Player Pick" },
];

export function Lobby({ api }: { api: GameRoomApi }) {
  const { room, players, isHost } = api;
  const [busy, setBusy] = useState(false);

  if (!room) return null;

  const bothReady = players.length === 2;

  async function changeMode(mode: GameMode) {
    if (!isHost || !room) return;
    await api.updateSettings(mode, room.win_target, room.challenge_type);
  }

  async function changeChallengeType(type: ChallengeType) {
    if (!isHost || !room) return;
    await api.updateSettings(room.game_mode, room.win_target, type);
  }

  async function changeWinTarget(target: number) {
    if (!isHost || !room) return;
    await api.updateSettings(room.game_mode, target, room.challenge_type);
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
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-white/40">
          Room code
        </p>
        <p className="text-5xl font-black tracking-[0.3em] text-accent">
          {room.code}
        </p>
        <p className="mt-1 text-sm text-white/40">
          Share this code with your opponent
        </p>
      </div>

      <div className="card space-y-3 p-5">
        {[1, 2].map((slot) => {
          const p = players.find((pl) => pl.slot === slot);
          return (
            <div key={slot} className="flex items-center justify-between">
              <span className="text-lg font-semibold">
                {p ? p.display_name : `Player ${slot}`}
              </span>
              <span
                className={clsx(
                  "text-xl",
                  p ? "text-accent" : "text-white/25",
                )}
              >
                {p ? "✓" : "…"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="card space-y-4 p-5">
        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-white/40">
            Game mode
          </p>
          <div className="grid grid-cols-1 gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                disabled={!isHost}
                onClick={() => changeMode(m.value)}
                className={clsx(
                  "rounded-xl border px-4 py-3 text-left font-semibold transition",
                  room.game_mode === m.value
                    ? "border-accent bg-accent/15 text-white"
                    : "border-white/10 bg-white/5 text-white/70",
                  !isHost && "opacity-70",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-white/40">
            Challenge type
          </p>
          <div className="flex items-center gap-2">
            {CHALLENGE_TYPES.map((c) => (
              <button
                key={c.value}
                type="button"
                disabled={!isHost}
                onClick={() => changeChallengeType(c.value)}
                className={clsx(
                  "flex-1 rounded-xl border px-3 py-2 font-semibold transition",
                  room.challenge_type === c.value
                    ? "border-accent bg-accent/15"
                    : "border-white/10 bg-white/5 text-white/70",
                  !isHost && "opacity-70",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-white/40">
            Winning condition
          </p>
          <div className="flex items-center gap-2">
            {[3, 5, 7].map((t) => (
              <button
                key={t}
                type="button"
                disabled={!isHost}
                onClick={() => changeWinTarget(t)}
                className={clsx(
                  "flex-1 rounded-xl border px-3 py-2 font-semibold transition",
                  room.win_target === t
                    ? "border-accent bg-accent/15"
                    : "border-white/10 bg-white/5 text-white/70",
                  !isHost && "opacity-70",
                )}
              >
                First to {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isHost ? (
        <Button onClick={onStart} disabled={!bothReady || busy}>
          {bothReady ? "Start Game" : "Waiting for opponent..."}
        </Button>
      ) : (
        <p className="text-center text-white/50">
          {bothReady
            ? "Waiting for host to start..."
            : "Waiting for opponent..."}
        </p>
      )}
    </div>
  );
}
