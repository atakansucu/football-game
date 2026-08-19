import type { RoundRow } from "@/types/game";

function label(round: RoundRow): { a: string; b: string } {
  if (round.mode === "national_club") {
    return {
      a: round.national_team_name ?? "?",
      b: round.club_1_name ?? "?",
    };
  }
  return {
    a: round.club_1_name ?? "?",
    b: round.club_2_name ?? "?",
  };
}

export function ChallengeCard({ round }: { round: RoundRow }) {
  const { a, b } = label(round);
  return (
    <div className="card flex flex-col items-center gap-2 px-4 py-8 text-center">
      <span className="text-3xl font-extrabold uppercase leading-tight tracking-tight sm:text-4xl">
        {a}
      </span>
      <span className="text-2xl font-black text-accent">×</span>
      <span className="text-3xl font-extrabold uppercase leading-tight tracking-tight sm:text-4xl">
        {b}
      </span>
    </div>
  );
}
