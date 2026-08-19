"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import type { GameRoomApi } from "@/features/room/useGameRoom";

export function MatchResult({ api }: { api: GameRoomApi }) {
  const { match, players, scores, isHost } = api;
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const winnerId = match?.winner_user_id ?? null;
  const winner = players.find((p) => p.user_id === winnerId);
  const ordered = [...players].sort((a, b) => a.slot - b.slot);
  const scoreLine = ordered.map((p) => scores[p.user_id] ?? 0).join(" - ");

  async function onPlayAgain() {
    setBusy(true);
    try {
      await api.playAgain();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8 py-10 text-center">
      <p className="text-sm uppercase tracking-[0.4em] text-white/40">
        Match over
      </p>
      <h1 className="text-4xl font-black uppercase text-accent">
        {winner ? `${winner.display_name} wins` : "Match complete"}
      </h1>
      <div className="text-6xl font-black tabular-nums">{scoreLine}</div>

      <div className="space-y-3">
        {isHost ? (
          <Button onClick={onPlayAgain} disabled={busy}>
            Play Again
          </Button>
        ) : (
          <p className="text-white/50">Waiting for host to restart...</p>
        )}
        <Button variant="ghost" onClick={() => router.push("/")}>
          Leave Room
        </Button>
      </div>
    </div>
  );
}
