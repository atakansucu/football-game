"use client";

import { useMemo, useRef, useState } from "react";
import { clsx } from "@/lib/clsx";
import { normalizePlayerName } from "@/lib/football/normalize";
import { DropdownPortal } from "@/components/DropdownPortal";
import type { NamedEntity } from "@/features/lookup/api";

interface AutocompleteProps {
  label: string;
  placeholder?: string;
  items: NamedEntity[];
  value: string | null;
  onChange: (id: string | null) => void;
}

export function Autocomplete({
  label,
  placeholder,
  items,
  value,
  onChange,
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

  // Show the full list (scrollable) when nothing is typed; otherwise filter.
  const suggestions = useMemo(() => {
    const q = normalizePlayerName(query);
    return q
      ? items.filter((i) => normalizePlayerName(i.name).includes(q))
      : items;
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
          open={open && suggestions.length > 0}
          className="max-h-64 overflow-auto rounded-xl border border-white/15 bg-pitch-900/95 p-1 shadow-xl backdrop-blur"
          onMouseDown={(e) => {
            // Prevent input blur from closing before click registers.
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
    </div>
  );
}
