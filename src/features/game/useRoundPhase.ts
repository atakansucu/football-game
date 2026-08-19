"use client";

import { useEffect, useState } from "react";
import type { RoundRow } from "@/types/game";

export type RoundPhase =
  | "none"
  | "selection"
  | "countdown"
  | "active"
  | "finished";

/** Ticking clock so countdown/timer re-render smoothly. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function getRoundPhase(round: RoundRow | null, nowMs: number): RoundPhase {
  if (!round) return "none";
  if (round.state === "selection") return "selection";
  if (round.state === "finished" || round.winner_user_id) return "finished";
  if (!round.activated_at) return "countdown";
  const activatedAt = Date.parse(round.activated_at);
  if (nowMs < activatedAt) return "countdown";
  return "active";
}

/**
 * Seconds left before the server round deadline. Derived from the authoritative
 * `ends_at` so reconnects/rerenders show the true remaining time.
 */
export function remainingSeconds(
  round: RoundRow | null,
  nowMs: number,
): number {
  if (!round?.ends_at) return 30;
  const endsAt = Date.parse(round.ends_at);
  return Math.max(0, Math.ceil((endsAt - nowMs) / 1000));
}

export function countdownSecondsLeft(
  round: RoundRow | null,
  nowMs: number,
): number {
  if (!round?.activated_at) return 3;
  const activatedAt = Date.parse(round.activated_at);
  return Math.max(0, Math.ceil((activatedAt - nowMs) / 1000));
}

export function elapsedSeconds(round: RoundRow | null, nowMs: number): number {
  if (!round?.activated_at) return 0;
  const activatedAt = Date.parse(round.activated_at);
  return Math.max(0, Math.floor((nowMs - activatedAt) / 1000));
}

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
