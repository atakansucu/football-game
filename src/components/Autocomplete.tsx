"use client";

import { useMemo, useRef, useState } from "react";
import { clsx } from "@/lib/clsx";
import { normalizePlayerName } from "@/lib/football/normalize";
import { DropdownPortal } from "@/components/DropdownPortal";
import { onFieldFocus } from "@/lib/keyboard";
import { TeamBadge } from "@/components/TeamBadge";
import type { NamedEntity } from "@/features/lookup/api";

// While typing we cap results so filtering stays snappy. With no query we show
// EVERY team (scrollable). Generated badges keep the list network-independent.
const MAX_RESULTS = 300;

interface AutocompleteProps {
  label: string;
  placeholder?: string;
  items: NamedEntity[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** When set, each option shows a flag or generated club badge. */
  iconKind?: "club" | "national";
}

export function Autocomplete({
  label,
  placeholder,
  items,
  value,
  onChange,
  iconKind,
}: AutocompleteProps) {
  const selected = items.find((i) => i.id === value) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // What is shown in the input: the typed query while searching, otherwise the
  // selected item's name.
  const display = open ? query : (selected?.name ?? "");

  // With no query, list ALL teams (scrollable). While typing, filter and cap so
  // keystrokes stay snappy.
  const suggestions = useMemo(() => {
    const q = normalizePlayerName(query);
    if (!q) return items;
    return items
      .filter((i) => normalizePlayerName(i.name).includes(q))
      .slice(0, MAX_RESULTS);
  }, [items, query]);

  function choose(item: NamedEntity) {
    onChange(item.id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = suggestions[highlight];
      if (item) choose(item);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between text-xs uppercase tracking-widest text-white/40">
        <span>{label}</span>
        {items.length > 0 && <span>{items.length} total</span>}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          className="field"
          placeholder={placeholder ?? "Search..."}
          value={display}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
            if (selected) onChange(null);
          }}
          onFocus={() => {
            onFieldFocus(inputRef.current);
            setQuery("");
            setOpen(true);
            setHighlight(0);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />

        <DropdownPortal
          anchorRef={inputRef}
          open={open}
          className="max-h-64 overflow-auto rounded-xl border border-white/15 bg-pitch-900/95 p-1 shadow-xl backdrop-blur"
          onMouseDown={(e) => {
            // Prevent input blur from closing before click registers.
            e.preventDefault();
            if (blurTimer.current) clearTimeout(blurTimer.current);
          }}
        >
          {suggestions.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-white/40">
              {items.length === 0 ? "Loading teams…" : "No matches"}
            </li>
          ) : (
            suggestions.map((item, idx) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => choose(item)}
                  onMouseEnter={() => setHighlight(idx)}
                  className={clsx(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-base",
                    idx === highlight
                      ? "bg-accent/20 text-white"
                      : "text-white/80",
                  )}
                >
                  {iconKind && (
                    <TeamBadge
                      name={item.name}
                      national={iconKind === "national"}
                      size={22}
                    />
                  )}
                  <span className="min-w-0 truncate">{item.name}</span>
                </button>
              </li>
            ))
          )}
        </DropdownPortal>
      </div>
    </div>
  );
}
