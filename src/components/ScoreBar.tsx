import { clsx } from "@/lib/clsx";
import type { RoomPlayerRow } from "@/types/game";

interface ScoreBarProps {
  players: RoomPlayerRow[];
  scores: Record<string, number>;
  userId: string | null;
  winTarget: number;
}

export function ScoreBar({ players, scores, userId, winTarget }: ScoreBarProps) {
  return (
    <div className="card p-4">
      <div className="space-y-2">
        {players.map((p) => {
          const isMe = p.user_id === userId;
          return (
            <div
              key={p.id}
              className="flex items-center justify-between text-lg"
            >
              <span
                className={clsx(
                  "truncate font-semibold uppercase tracking-wide",
                  isMe ? "text-accent-soft" : "text-white/80",
                )}
              >
                {p.display_name}
                {isMe && <span className="ml-1 text-xs text-white/40">(you)</span>}
              </span>
              <span className="ml-3 tabular-nums text-2xl font-bold">
                {scores[p.user_id] ?? 0}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 border-t border-white/10 pt-2 text-center text-xs uppercase tracking-widest text-white/40">
        First to {winTarget}
      </div>
    </div>
  );
}
