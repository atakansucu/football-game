import Link from "next/link";
import { TopNav } from "@/components/TopNav";

const CARD =
  "flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left transition active:scale-[0.99] hover:border-accent/40 hover:bg-accent/10";

export default function PlayPage() {
  return (
    <main className="flex flex-1 flex-col gap-6">
      <TopNav />
      <div>
        <h1 className="text-3xl font-black uppercase">Play</h1>
        <p className="mt-1 text-white/50">Choose how you want to play.</p>
      </div>

      <div className="space-y-3">
        <Link href="/solo" className={CARD}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-2xl">
            ⏱️
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-bold text-white">
              Single Player
            </span>
            <span className="block text-sm text-white/50">
              Race the clock and chase your best score
            </span>
          </span>
        </Link>

        <Link href="/multiplayer" className={CARD}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-2xl">
            ⚔️
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-bold text-white">
              Multiplayer
            </span>
            <span className="block text-sm text-white/50">
              Duel a friend — fastest correct answer wins
            </span>
          </span>
        </Link>
      </div>
    </main>
  );
}
