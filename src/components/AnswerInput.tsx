"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "@/lib/clsx";
import { DropdownPortal } from "@/components/DropdownPortal";
import type {
  PlayerSuggestion,
  RoundRow,
  SubmitAnswerResult,
} from "@/types/game";

interface AnswerInputProps {
  round: RoundRow;
  disabled?: boolean;
  onSubmit: (answer: string) => Promise<SubmitAnswerResult>;
  /**
   * Global footballer search. Deliberately unaware of the current challenge's
   * valid answers — it must NOT be used to reveal which players are correct.
   */
  searchPlayers?: (query: string) => Promise<PlayerSuggestion[]>;
}

interface CheckLine {
  label: string;
  ok: boolean;
}

interface Attempt {
  key: number;
  raw: string;
  result: SubmitAnswerResult;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 150;

function buildCheckLines(
  round: RoundRow,
  result: SubmitAnswerResult,
): CheckLine[] {
  if (!result.checks) return [];
  if (round.mode === "national_club") {
    return [
      {
        label: round.national_team_name ?? "National team",
        ok: !!result.checks.national_team,
      },
      { label: round.club_1_name ?? "Club", ok: !!result.checks.club },
    ];
  }
  return [
    { label: round.club_1_name ?? "Club A", ok: !!result.checks.club_a },
    { label: round.club_2_name ?? "Club B", ok: !!result.checks.club_b },
  ];
}

function headline(result: SubmitAnswerResult): string {
  if (result.player_name) return result.player_name;
  switch (result.status) {
    case "ambiguous":
      return "Be more specific";
    case "round_not_active":
      return "Round not active";
    case "expired":
      return "Time's up";
    case "rate_limited":
      return "Slow down";
    case "error":
      return "Couldn't submit";
    default:
      return "No match";
  }
}

/** Short, friendly explanation shown under the guessed name. */
function subtitle(result: SubmitAnswerResult): string {
  if (result.is_correct) return "Correct answer";
  switch (result.status) {
    case "correct_but_late":
      return "Right player — but time was up";
    case "ambiguous":
      return "Several players match — add more of the name";
    case "expired":
      return "The round already ended";
    case "rate_limited":
      return "Too many guesses — wait a moment";
    case "round_not_active":
      return "The round isn't active yet";
    case "error":
      return "Something went wrong, try again";
    default:
      return result.player_name
        ? "Not in this challenge"
        : "No player found with that name";
  }
}

export function AnswerInput({
  round,
  disabled,
  onSubmit,
  searchPlayers,
}: AnswerInputProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [suggestions, setSuggestions] = useState<PlayerSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  // -1 means "nothing highlighted" so a plain Enter submits the typed text.
  const [highlight, setHighlight] = useState(-1);
  const counter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced global search. Only runs after MIN_QUERY chars.
  useEffect(() => {
    if (!searchPlayers) return;
    const q = value.trim();
    if (q.length < MIN_QUERY) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++reqIdRef.current;
      try {
        const results = await searchPlayers(q);
        if (reqId !== reqIdRef.current) return; // a newer query superseded us
        setSuggestions(results);
        setOpen(results.length > 0);
        setHighlight(-1);
      } catch {
        /* search is best-effort; typing still works */
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, searchPlayers]);

  const submitAnswer = useCallback(
    async (answer: string) => {
      const trimmed = answer.trim();
      if (!trimmed || submitting || disabled) return;
      setSubmitting(true);
      setOpen(false);
      try {
        const result = await onSubmit(trimmed);
        setAttempts((prev) => [
          { key: counter.current++, raw: trimmed, result },
          ...prev,
        ]);
        if (!result.is_correct) {
          setValue("");
          setSuggestions([]);
          inputRef.current?.focus();
        }
      } catch (err) {
        // Surface failures instead of silently swallowing them, otherwise a
        // rejected submit looks like "nothing happened".
        setAttempts((prev) => [
          {
            key: counter.current++,
            raw: trimmed,
            result: {
              status: "error",
              is_correct: false,
              player_name:
                err instanceof Error ? err.message : "Submit failed",
              checks: null,
              round_id: round.id,
              winner_user_id: null,
            } as SubmitAnswerResult,
          },
          ...prev,
        ]);
        setValue("");
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit, submitting, disabled],
  );

  function choose(item: PlayerSuggestion) {
    setValue(item.name);
    setOpen(false);
    setSuggestions([]);
    void submitAnswer(item.name);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // A highlighted suggestion takes precedence over the raw text.
    if (open && highlight >= 0 && suggestions[highlight]) {
      choose(suggestions[highlight]);
      return;
    }
    void submitAnswer(value);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
    // Enter is handled by the form's onSubmit so manual submits keep working.
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative">
        <input
          ref={inputRef}
          className="field text-xl"
          placeholder="Type a player..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          disabled={disabled || submitting}
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label="Player name answer"
        />

        <DropdownPortal
          anchorRef={inputRef}
          open={open && suggestions.length > 0}
          className="max-h-64 overflow-auto rounded-xl border border-white/15 bg-pitch-900/95 p-1 shadow-xl backdrop-blur"
          onMouseDown={(e) => {
            e.preventDefault();
            if (blurTimer.current) clearTimeout(blurTimer.current);
          }}
        >
          {suggestions.map((item, idx) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => choose(item)}
                onMouseEnter={() => setHighlight(idx)}
                className={clsx(
                  "w-full rounded-lg px-3 py-2 text-left",
                  idx === highlight
                    ? "bg-accent/20 text-white"
                    : "text-white/80",
                )}
              >
                {item.name}
              </button>
            </li>
          ))}
        </DropdownPortal>
      </div>

      {attempts.length > 0 && (
        <div className="space-y-2">
          <LatestFeedback round={round} attempt={attempts[0]} />
          {attempts.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {attempts.slice(1).map((a) => (
                <span
                  key={a.key}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                    a.result.is_correct
                      ? "border-accent/30 bg-accent/10 text-accent-soft"
                      : "border-white/10 bg-white/5 text-white/50",
                  )}
                >
                  <span aria-hidden>{a.result.is_correct ? "✓" : "✕"}</span>
                  <span className="max-w-[10rem] truncate">
                    {a.result.player_name ?? a.raw}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </form>
  );
}

/** Prominent, animated result card for the most recent guess. */
function LatestFeedback({
  round,
  attempt,
}: {
  round: RoundRow;
  attempt: Attempt;
}) {
  const correct = attempt.result.is_correct;
  const lines = buildCheckLines(round, attempt.result);
  return (
    <div
      key={attempt.key}
      className={clsx(
        "animate-pop rounded-2xl border p-4 text-left",
        correct
          ? "border-accent/40 bg-accent/10"
          : "animate-shake border-red-500/30 bg-red-500/10",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-black",
            correct
              ? "bg-accent text-pitch-950"
              : "bg-red-500/20 text-red-300",
          )}
          aria-hidden
        >
          {correct ? "✓" : "✕"}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={clsx(
              "truncate text-lg font-bold leading-tight",
              correct ? "text-accent-soft" : "text-white",
            )}
          >
            {headline(attempt.result)}
          </p>
          <p className="truncate text-sm text-white/50">
            {subtitle(attempt.result)}
          </p>
        </div>
      </div>

      {lines.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lines.map((line) => (
            <span
              key={line.label}
              className={clsx(
                "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium",
                line.ok
                  ? "border-accent/30 bg-accent/10 text-accent-soft"
                  : "border-white/10 bg-black/20 text-white/45",
              )}
            >
              <span aria-hidden>{line.ok ? "✓" : "✕"}</span>
              <span className="uppercase tracking-wide">{line.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
