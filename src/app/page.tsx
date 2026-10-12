import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-center gap-12">
      <div className="text-center">
        <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-3xl shadow-[0_0_40px] shadow-accent/20">
          ⚽️
        </span>
        <h1 className="font-display text-5xl font-black uppercase leading-none tracking-tight">
          Football
          <span className="mt-1 block text-accent">Duel</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xs text-balance text-white/50">
          Two players. One challenge. Fastest correct answer wins.
        </p>
      </div>

      <div className="space-y-3">
        <Link href="/play" className="btn-primary w-full">
          Play
        </Link>
        <Link href="/lookup" className="btn-ghost w-full">
          Player Lookup
        </Link>
        <Link
          href="/settings"
          className="block pt-2 text-center text-sm text-white/40 underline-offset-4 hover:text-white/70 hover:underline"
        >
          Settings &amp; Privacy
        </Link>
      </div>
    </main>
  );
}
