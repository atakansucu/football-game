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
      return "Too ambiguous — be more specific";
    case "round_not_active":
      return "Round not active";
    case "expired":
      return "Too late — time's up";
    case "rate_limited":
      return "Slow down a moment";
    default:
      return "Unknown player";
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
        <ul className="space-y-2">
          {attempts.map((a) => {
            const correct = a.result.is_correct;
            const lines = buildCheckLines(round, a.result);
            return (
              <li key={a.key} className="card space-y-1 p-3 text-left">
                <div
                  className={clsx(
                    "flex items-center justify-between text-base font-semibold",
                    correct ? "text-accent" : "text-red-400",
                  )}
                >
                  <span className="truncate">{headline(a.result)}</span>
                  <span aria-hidden className="ml-2">
                    {correct ? "✓" : "✕"}
                  </span>
                </div>
                <div className="text-xs text-white/40">you typed: {a.raw}</div>
                {lines.map((line) => (
                  <div
                    key={line.label}
                    className={clsx(
                      "flex items-center justify-between text-sm",
                      line.ok ? "text-accent-soft" : "text-red-400",
                    )}
                  >
                    <span className="uppercase tracking-wide">
                      {line.label}
                    </span>
                    <span aria-hidden>{line.ok ? "✓" : "✕"}</span>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
