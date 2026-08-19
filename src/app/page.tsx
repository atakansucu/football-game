import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-center gap-10">
      <div className="text-center">
        <h1 className="text-5xl font-black uppercase tracking-tight">
          Football
          <span className="block text-accent">Duel</span>
        </h1>
        <p className="mt-3 text-white/50">
          Two players. One challenge. Fastest correct answer wins.
        </p>
      </div>

      <div className="space-y-3">
        <Link href="/create" className="btn-primary w-full">
          Create Game
        </Link>
        <Link href="/join" className="btn-ghost w-full">
          Join Game
        </Link>
        <Link href="/lookup" className="btn-ghost w-full">
          Player Lookup
        </Link>
      </div>
    </main>
  );
}
