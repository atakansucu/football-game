"use client";

import Link from "next/link";
import { clsx } from "@/lib/clsx";

const NAV_BTN =
  "self-start rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white/70 transition hover:bg-white/10 active:scale-[0.98]";

interface TopNavProps {
  /**
   * In-room screens pass this to render a single destructive "Exit" that
   * confirms and returns to the main menu. Everywhere else a single "Back"
   * link is shown, since Back and Home lead to the same place.
   */
  onExit?: () => void;
}

/** Minimal single-action navigation shown at the top of every screen. */
export function TopNav({ onExit }: TopNavProps) {
  if (onExit) {
    return (
      <nav className="mb-5">
        <button
          type="button"
          onClick={onExit}
          className={clsx(
            NAV_BTN,
            "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
          )}
          aria-label="Exit game"
        >
          Exit ✕
        </button>
      </nav>
    );
  }

  return (
    <nav className="mb-5">
      <Link href="/" className={NAV_BTN} aria-label="Main menu">
        ← Back
      </Link>
    </nav>
  );
}
