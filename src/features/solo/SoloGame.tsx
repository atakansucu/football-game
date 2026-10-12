"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AnswerInput } from "@/components/AnswerInput";
import { ChallengeCard } from "@/components/ChallengeCard";
import { DropdownPortal } from "@/components/DropdownPortal";
import { BackButton, TopNav } from "@/components/TopNav";
import { clsx } from "@/lib/clsx";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import {
  checkSoloAnswer,
  getSoloChallenge,
  searchPlayers as searchPlayersRpc,
} from "@/server/game/actions";
import {
  LEAGUES,
  ROUND_SECONDS,
  type Difficulty,
  type GameMode,
  type League,
  type RoundRow,
  type SoloChallenge,
  type SubmitAnswerResult,
} from "@/types/game";
import { formatClock, useNow } from "@/features/game/useRoundPhase";
import { EASE_OUT } from "@/lib/easing";

type Phase = "setup" | "playing" | "over";

const COUNTDOWN_MS = 3000;
// How long the correct player's name stays on screen before the next round.
const REVEAL_MS = 1800;

const MODES: { value: GameMode; label: string }[] = [
  { value: "national_club", label: "National × Club" },
  { value: "club_club", label: "Club × Club" },
];

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const bestKey = (mode: GameMode, diff: Difficulty) =>
  `fd_solo_best_${mode}_${diff}`;

/** Identity of a challenge request — used to match a prefetch to loadNext(). */
const challengeKey = (m: GameMode, d: Difficulty, l: League | null) =>
  `${m}|${d}|${l ?? ""}`;

function readBest(mode: GameMode, diff: Difficulty): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(bestKey(mode, diff));
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Minimal RoundRow so ChallengeCard / AnswerInput render a solo challenge. */
function soloRound(challenge: SoloChallenge, key: number): RoundRow {
  return {
    id: `solo-${key}`,
    mode: challenge.mode,
    national_team_id: challenge.national_team_id,
    national_team_name: challenge.national_team_name,
    club_1_id: challenge.club_1_id,
    club_1_name: challenge.club_1_name,
    club_2_id: challenge.club_2_id,
    club_2_name: challenge.club_2_name,
    state: "active",
  } as unknown as RoundRow;
}

export function SoloGame() {
  const now = useNow();
  const reduce = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("setup");
  const [mode, setMode] = useState<GameMode>("national_club");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  // null = "All leagues" (no filter). Restricts Random selection to one league.
  const [league, setLeague] = useState<League | null>(null);

  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [challenge, setChallenge] = useState<SoloChallenge | null>(null);
  const [roundKey, setRoundKey] = useState(0);
  const [activateAt, setActivateAt] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [loading, setLoading] = useState(false);
  // Brief pause after a correct guess so the ✓ is visible before advancing.
  const [frozen, setFrozen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreRef = useRef(0);
  // Prefetched first challenge (see the setup effect below). loadNext() reuses
  // it so tapping Start is instant instead of paying the query cost then.
  const prefetchRef = useRef<{
    key: string;
    promise: Promise<SoloChallenge>;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  // While the user is still choosing on the setup screen, fetch the challenge
  // their current selection would produce. The (cold) query then resolves
  // before they tap Start, and loadNext() reuses this promise — so Start feels
  // instant. Fire-and-forget; re-runs whenever a selection changes.
  useEffect(() => {
    if (phase !== "setup") return;
    const db = getSupabaseBrowserClient();
    const key = challengeKey(mode, difficulty, league);
    const promise = getSoloChallenge(db, { mode, difficulty, league });
    promise.catch(() => {});
    prefetchRef.current = { key, promise };
  }, [phase, mode, difficulty, league]);

  const loadNext = useCallback(async () => {
    setLoading(true);
    setFrozen(false);
    setLoadError(null);
    try {
      const db = getSupabaseBrowserClient();
      const key = challengeKey(mode, difficulty, league);
      const pending = prefetchRef.current;
      let next: SoloChallenge;
      if (pending && pending.key === key) {
        // Consume the setup-screen prefetch (single-use); fall back to a fresh
        // request if that warm-up happened to fail.
        prefetchRef.current = null;
        try {
          next = await pending.promise;
        } catch {
          next = await getSoloChallenge(db, { mode, difficulty, league });
        }
      } else {
        next = await getSoloChallenge(db, { mode, difficulty, league });
      }
      const activate = Date.now() + COUNTDOWN_MS;
      setChallenge(next);
      setRoundKey((k) => k + 1);
      setActivateAt(activate);
      setDeadline(activate + ROUND_SECONDS * 1000);
      setLoading(false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load challenge");
      setLoading(false);
    }
  }, [mode, difficulty, league]);

  const start = useCallback(() => {
    // Pre-warm the iOS text-input subsystem inside this user gesture so the
    // FIRST focus on the answer field (after the countdown) doesn't pay the
    // one-time keyboard init cost. Synchronous focus+blur warms the machinery
    // without actually presenting the keyboard. Best-effort; harmless if no-op.
    try {
      const warm = document.createElement("input");
      warm.type = "text";
      warm.setAttribute("autocomplete", "off");
      warm.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
      document.body.appendChild(warm);
      warm.focus();
      warm.blur();
      warm.remove();
    } catch {
      /* non-fatal */
    }

    scoreRef.current = 0;
    setScore(0);
    setNewBest(false);
    setBest(readBest(mode, difficulty));
    setActivateAt(0);
    setDeadline(0);
    setChallenge(null);
    setPhase("playing");
    void loadNext();
  }, [loadNext, mode, difficulty]);

  const endGame = useCallback(() => {
    const finalScore = scoreRef.current;
    const prevBest = readBest(mode, difficulty);
    if (finalScore > prevBest) {
      window.localStorage.setItem(bestKey(mode, difficulty), String(finalScore));
      setBest(finalScore);
      setNewBest(true);
    } else {
      setBest(prevBest);
      setNewBest(false);
    }
    setPhase("over");
  }, [mode, difficulty]);

  const counting = !!challenge && !loading && now < activateAt;
  const active = !!challenge && !loading && now >= activateAt;
  const countdownNum = Math.max(0, Math.ceil((activateAt - now) / 1000));
  const secondsLeft = active
    ? Math.max(0, Math.ceil((deadline - now) / 1000))
    : ROUND_SECONDS;

  // Racing the clock: when the deadline passes with no correct answer, it's over.
  useEffect(() => {
    if (phase !== "playing" || loading || frozen || !challenge) return;
    if (activateAt > 0 && now >= deadline) endGame();
  }, [phase, loading, frozen, challenge, now, deadline, activateAt, endGame]);

  const onSubmit = useCallback(
    async (answer: string): Promise<SubmitAnswerResult> => {
      const roundId = `solo-${roundKey}`;
      const db = getSupabaseBrowserClient();
      const res = await checkSoloAnswer(db, {
        mode,
        nationalTeamId: challenge?.national_team_id ?? null,
        club1Id: challenge?.club_1_id ?? null,
        club2Id: challenge?.club_2_id ?? null,
        answer,
      });

      const mapped: SubmitAnswerResult = {
        status: res.is_correct
          ? "won"
          : res.status === "ambiguous"
            ? "ambiguous"
            : "incorrect",
        is_correct: res.is_correct,
        player_name: res.player_name,
        checks: null,
        round_id: roundId,
        winner_user_id: null,
      };

      if (res.is_correct) {
        scoreRef.current += 1;
        setScore(scoreRef.current);
        setFrozen(true); // hold the clock while the ✓ shows, then advance
        if (advanceTimer.current) clearTimeout(advanceTimer.current);
        advanceTimer.current = setTimeout(() => void loadNext(), REVEAL_MS);
      }

      return mapped;
    },
    [challenge, mode, roundKey, loadNext],
  );

  const searchPlayers = useCallback((q: string) => {
    const db = getSupabaseBrowserClient();
    return searchPlayersRpc(db, q);
  }, []);

  // ---- Setup -------------------------------------------------------------
  if (phase === "setup") {
    return (
      <div className="space-y-6">
        <TopNav />
        <div>
          <h1 className="text-3xl font-black uppercase">Single Player</h1>
          <p className="mt-1 text-white/50">
            Solve as many as you can — each challenge gives you {ROUND_SECONDS}s.
            One miss and it&apos;s game over.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-white/40">
            Game mode
          </p>
          <Segmented
            options={MODES}
            value={mode}
            onChange={(v) => setMode(v as GameMode)}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-white/40">
            Difficulty
          </p>
          <Segmented
            options={DIFFICULTIES}
            value={difficulty}
            onChange={(v) => setDifficulty(v as Difficulty)}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-white/40">
            League
          </p>
          <LeagueSelect value={league} onChange={setLeague} />
        </div>

        <button type="button" onClick={start} className="btn-primary w-full">
          Start
        </button>
      </div>
    );
  }

  // ---- Game over ---------------------------------------------------------
  if (phase === "over") {
    return (
      <div className="space-y-6 text-center">
        <TopNav />
        <div>
          <p className="text-sm uppercase tracking-widest text-white/40">
            Game over
          </p>
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "scale(0.6)" }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, transform: "scale(1)" }}
            transition={
              reduce
                ? { duration: 0.2 }
                : { type: "spring", duration: 0.6, bounce: 0.35 }
            }
            className="mt-2 text-7xl font-black text-accent tabular-nums"
          >
            {scoreRef.current}
          </motion.div>
          <p className="mt-1 text-white/50">
            correct answer{scoreRef.current === 1 ? "" : "s"}
          </p>
        </div>

        <div className="card px-5 py-4">
          {newBest ? (
            <p className="text-lg font-bold text-accent">New best! 🎉</p>
          ) : (
            <p className="text-white/60">
              Best: <span className="font-bold text-white">{best}</span>
            </p>
          )}
          <p className="mt-1 text-xs uppercase tracking-widest text-white/30">
            {MODES.find((m) => m.value === mode)?.label} ·{" "}
            {DIFFICULTIES.find((d) => d.value === difficulty)?.label}
          </p>
        </div>

        <div className="space-y-3">
          <button type="button" onClick={start} className="btn-primary w-full">
            Play again
          </button>
          <button
            type="button"
            onClick={() => setPhase("setup")}
            className="btn-ghost w-full"
          >
            Change settings
          </button>
        </div>
      </div>
    );
  }

  // ---- Playing -----------------------------------------------------------
  const urgent = active && secondsLeft <= 5;
  const totalMs = ROUND_SECONDS * 1000;
  const frac = active
    ? Math.max(0, Math.min(1, Math.max(0, deadline - now) / totalMs))
    : 1;
  const barColor =
    secondsLeft <= 5 ? "bg-red-500" : secondsLeft <= 10 ? "bg-amber-400" : "bg-accent";

  return (
    <div className="space-y-5">
      {/* Back + score pinned to the top so they stay visible while the field is
          lifted above the keyboard (the challenge/input scroll under this bar). */}
      <div className="sticky top-[var(--safe-top)] z-20 -mx-5 flex items-center gap-3 border-b border-white/5 bg-pitch-950/80 px-5 py-2 backdrop-blur">
        <BackButton className="h-9 w-9" />
        <div className="flex flex-1 items-center justify-between">
          <div>
            <p className="text-[0.65rem] uppercase tracking-widest text-white/40">
              Score
            </p>
            <p className="text-2xl font-black leading-none tabular-nums text-accent">
              {score}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[0.65rem] uppercase tracking-widest text-white/40">
              Best
            </p>
            <p className="text-2xl font-black leading-none tabular-nums text-white/70">
              {best}
            </p>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="card space-y-3 p-5 text-center">
          <p className="text-red-400">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadNext()}
            className="btn-primary w-full"
          >
            Retry
          </button>
        </div>
      ) : !challenge || loading ? (
        <div className="py-16 text-center">
          <div className="text-2xl font-black uppercase tracking-widest text-white/60">
            Get ready…
          </div>
        </div>
      ) : (
        <>
          <ChallengeCard round={soloRound(challenge, roundKey)} compact />

          {counting ? (
            <div className="py-6 text-center">
              <motion.div
                key={countdownNum}
                initial={
                  reduce ? { opacity: 0 } : { opacity: 0, transform: "scale(0.5)" }
                }
                animate={
                  reduce ? { opacity: 1 } : { opacity: 1, transform: "scale(1)" }
                }
                transition={
                  reduce
                    ? { duration: 0.15 }
                    : { type: "spring", duration: 0.45, bounce: 0.35 }
                }
                className="text-7xl font-black text-accent"
              >
                {countdownNum || "GO"}
              </motion.div>
              <p className="mt-2 text-white/50">Get ready…</p>
            </div>
          ) : (
            <motion.div
              className="space-y-5"
              initial={
                reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px)" }
              }
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
            >
              <div className="space-y-2">
                <div
                  className={clsx(
                    "text-center font-black tabular-nums transition-colors",
                    urgent ? "text-5xl text-red-400" : "text-4xl text-white",
                  )}
                  aria-live="polite"
                >
                  {formatClock(secondsLeft)}
                </div>
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={ROUND_SECONDS}
                  aria-valuenow={secondsLeft}
                >
                  <div
                    className={clsx(
                      "h-full w-full origin-left rounded-full transition-transform duration-200 ease-linear",
                      barColor,
                    )}
                    style={{ transform: `scaleX(${frac})` }}
                  />
                </div>
              </div>

              <AnswerInput
                key={roundKey}
                round={soloRound(challenge, roundKey)}
                disabled={frozen}
                onSubmit={onSubmit}
                searchPlayers={searchPlayers}
              />
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * In-app league dropdown. Deliberately NOT a native `<select>`: on iOS the very
 * first time a `<select>` is opened the OS spins up its picker UI, which froze
 * the app for a beat. This custom list reuses DropdownPortal (no OS picker) so
 * it opens instantly and matches the rest of the UI. `null` = "All leagues".
 */
function LeagueSelect({
  value,
  onChange,
}: {
  value: League | null;
  onChange: (v: League | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const label = LEAGUES.find((l) => (l.value ?? "") === (value ?? ""))?.label ??
    "All leagues";

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm font-semibold text-white transition focus:border-accent focus:outline-none"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{label}</span>
        <span aria-hidden className="ml-2 text-white/40">
          ▾
        </span>
      </button>

      <DropdownPortal
        anchorRef={btnRef}
        open={open}
        className="max-h-64 overflow-auto rounded-xl border border-white/15 bg-pitch-900/95 p-1 shadow-xl backdrop-blur"
        onMouseDown={(e) => {
          e.preventDefault();
          if (blurTimer.current) clearTimeout(blurTimer.current);
        }}
      >
        {LEAGUES.map((l) => {
          const selected = (l.value ?? "") === (value ?? "");
          return (
            <li key={l.label}>
              <button
                type="button"
                onClick={() => {
                  onChange(l.value ?? null);
                  setOpen(false);
                }}
                className={clsx(
                  "w-full rounded-lg px-3 py-2.5 text-left text-base",
                  selected ? "bg-accent/20 text-white" : "text-white/80",
                )}
              >
                {l.label}
              </button>
            </li>
          );
        })}
      </DropdownPortal>
    </div>
  );
}

interface SegOption {
  value: string;
  label: string;
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-xl border px-3 py-3 text-sm font-semibold transition active:scale-[0.98]",
            value === o.value
              ? "border-accent bg-accent/15 text-white"
              : "border-white/10 bg-white/5 text-white/60",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
