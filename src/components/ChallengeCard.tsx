"use client";

import { type Variants, motion, useReducedMotion } from "motion/react";
import type { RoundRow } from "@/types/game";
import { TeamBadge } from "@/components/TeamBadge";
import { clsx } from "@/lib/clsx";

interface Side {
  name: string;
  national: boolean;
}

function sides(round: RoundRow): { a: Side; b: Side } {
  if (round.mode === "national_club") {
    return {
      a: { name: round.national_team_name ?? "?", national: true },
      b: { name: round.club_1_name ?? "?", national: false },
    };
  }
  return {
    a: { name: round.club_1_name ?? "?", national: false },
    b: { name: round.club_2_name ?? "?", national: false },
  };
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

function TeamRow({
  side,
  variants,
  compact,
}: {
  side: Side;
  variants: Variants;
  compact: boolean;
}) {
  return (
    <motion.div
      variants={variants}
      className="flex flex-col items-center gap-2"
    >
      <TeamBadge
        name={side.name}
        national={side.national}
        size={compact ? 40 : 56}
      />
      <span
        className={clsx(
          "font-extrabold uppercase leading-tight tracking-tight",
          compact ? "text-xl" : "text-2xl sm:text-3xl",
        )}
      >
        {side.name}
      </span>
    </motion.div>
  );
}

/**
 * `compact` shrinks the card so the whole challenge (both badges + names)
 * stays visible above the on-screen keyboard while the player is typing.
 */
export function ChallengeCard({
  round,
  compact = false,
}: {
  round: RoundRow;
  compact?: boolean;
}) {
  const { a, b } = sides(round);
  const reduce = useReducedMotion();

  // Keying by round id replays the entrance whenever a new challenge loads, so
  // each round "arrives" instead of snapping in. Occasional → standard motion.
  const container: Variants = {
    hidden: reduce
      ? { opacity: 0 }
      : { opacity: 0, transform: "translateY(8px) scale(0.98)" },
    show: {
      opacity: 1,
      transform: "translateY(0px) scale(1)",
      transition: {
        duration: 0.28,
        ease: EASE_OUT,
        staggerChildren: reduce ? 0 : 0.06,
        delayChildren: reduce ? 0 : 0.06,
      },
    },
  };

  const child: Variants = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(6px)" },
    show: {
      opacity: 1,
      transform: "translateY(0px)",
      transition: { duration: 0.25, ease: EASE_OUT },
    },
  };

  return (
    <motion.div
      key={round.id}
      variants={container}
      initial="hidden"
      animate="show"
      className={clsx(
        "card flex flex-col items-center text-center",
        compact ? "gap-2 px-4 py-4" : "gap-3 px-4 py-7",
      )}
    >
      <TeamRow side={a} variants={child} compact={compact} />
      <motion.span variants={child} className="text-2xl font-black text-accent">
        ×
      </motion.span>
      <TeamRow side={b} variants={child} compact={compact} />
    </motion.div>
  );
}
