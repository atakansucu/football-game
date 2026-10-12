"use client";

import Link from "next/link";
import { clsx } from "@/lib/clsx";

const NAV_BTN =
  "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 transition hover:bg-white/10 active:scale-95";

function ChevronLeft() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

interface TopNavProps {
  /**
   * In-room screens pass this to confirm before leaving and returning to the
   * main menu. Everywhere else a plain back link is shown, since Back and Home
   * lead to the same place.
   */
  onExit?: () => void;
}

/**
 * The bare back button (no nav wrapper), so it can be dropped into custom
 * headers — e.g. the sticky score bar during a solo game.
 */
export function BackButton({
  onExit,
  className,
}: TopNavProps & { className?: string }) {
  const cls = clsx(NAV_BTN, className);
  if (onExit) {
    return (
      <button
        type="button"
        onClick={onExit}
        className={cls}
        aria-label="Leave game"
      >
        <ChevronLeft />
      </button>
    );
  }
  return (
    <Link href="/" className={cls} aria-label="Back to main menu">
      <ChevronLeft />
    </Link>
  );
}

/** Minimal single icon back button shown at the top of every screen. */
export function TopNav({ onExit }: TopNavProps) {
  return (
    <nav className="mb-3 flex">
      <BackButton onExit={onExit} />
    </nav>
  );
}
